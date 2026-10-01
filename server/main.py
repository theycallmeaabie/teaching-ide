"""The teacher.

One endpoint, streaming. The model chooses a tool; we validate it, clamp it to
the ladder position we decided, and fall back to the pre-written hint whenever
it gives us something we cannot use. The lesson never stalls on a bad response.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, AsyncIterator

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from . import auth, cache, errors, leakguard, llm
from .models import RunErrorIn, TeachRequest
from .prompts import SYSTEM, build_context
from .tools import TOOLS, TOOL_NAMES

app = FastAPI(title="Teaching IDE")

# In development Vite proxies /api, so same-origin and this never comes up. It
# matters the moment a built bundle is served from anywhere else: without it
# every call fails in the browser with no useful error.
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

REQUIRED_ARGS = {
    "give_hint": ["tier", "text"],
    "ask_question": ["text"],
    "translate_error": ["plain_english"],
    "confirm_success": ["text"],
    "stay_silent": ["reason"],
}


def sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def prewritten(req: TeachRequest, note: str) -> dict[str, Any]:
    """What the teacher says when the model cannot be used.

    Phase 3's ladder verbatim. Less fluent, never wrong, always available.
    """
    if req.trigger == "success":
        return {
            "tool": "confirm_success",
            "args": {
                "text": "That is it exactly.",
                "followup_question": "Why did that work?",
            },
            "source": "prewritten",
            "note": note,
        }
    text = req.tier_texts[req.tier - 1] if 0 < req.tier <= len(req.tier_texts) else ""
    return {
        "tool": "give_hint",
        "args": {"tier": req.tier, "text": text},
        "source": "prewritten",
        "note": note,
    }


def sanitise(req: TeachRequest, tool: str | None, args: Any) -> tuple[dict[str, Any] | None, str | None]:
    """Reject anything we cannot act on, and clamp what we can.

    The tier is ours, not the model's. If it tries to jump down the ladder we
    pull it back, because the ladder is the product.
    """
    if tool is None:
        return None, "model returned no tool call"
    if tool not in TOOL_NAMES:
        return None, f"unknown tool {tool!r}"
    if not isinstance(args, dict):
        return None, "tool arguments were not valid JSON"

    missing = [k for k in REQUIRED_ARGS[tool] if k not in args or args[k] in (None, "")]
    if missing:
        return None, f"{tool} missing {missing}"

    if tool == "give_hint":
        if not str(args.get("text", "")).strip():
            return None, "give_hint text was empty"
        if args.get("tier") != req.tier:
            args = {**args, "tier": req.tier, "_clamped_from": args.get("tier")}

    # The ladder applies to everything the teacher says, not just hints. A
    # "question" that spells out the fix is the answer wearing a question mark.
    prose = " ".join(
        str(args.get(k, "")) for k in ("text", "plain_english", "followup_question")
    )
    if prose.strip():
        leaked = leakguard.leaks(prose, req.tier, req.tier_texts)
        if leaked:
            return None, f"tier {req.tier} {tool} gave away the answer ({leaked!r})"
    return {"tool": tool, "args": args}, None


async def replay(payload: dict[str, Any]) -> AsyncIterator[str]:
    """Emit a cached decision down the same path a live one takes, so the client
    has exactly one code path and streaming still looks like streaming."""
    yield sse("tool", {"tool": payload["tool"]})
    field = llm._PROSE_FIELD.get(payload["tool"])
    text = str(payload["args"].get(field, "")) if field else ""
    for i in range(0, len(text), 24):
        yield sse("delta", {"text": text[i : i + 24]})
        await asyncio.sleep(0.008)
    yield sse("done", payload)


@app.post("/api/teach")
async def teach(
    req: TeachRequest,
    user_id: str | None = Depends(auth.current_user),
) -> StreamingResponse:
    # Identity is observed, not required: an anonymous call is served exactly as
    # before. It is here so the budget can be enforced server-side later —
    # today the 8-interruption limit is client-side only.
    _ = user_id
    system = SYSTEM
    context = build_context(req)
    ck = cache.key(llm.MODEL, system, context)

    async def gen() -> AsyncIterator[str]:
        # Same context as last time means the same answer. During tuning that is
        # most calls, and the daily cap is about two sessions' worth of tokens.
        hit = cache.get(ck)
        if hit is not None:
            async for chunk in replay({**hit, "doc_version": req.doc_version, "cached": True}):
                yield chunk
            return

        tool: str | None = None
        args: Any = None
        try:
            stream = await llm.complete(system=system, user=context, tools=TOOLS, stream=True)
            async for ev in stream:  # type: ignore[union-attr]
                if ev["type"] == "tool":
                    tool = ev["tool"]
                    yield sse("tool", {"tool": tool})
                elif ev["type"] == "delta":
                    yield sse("delta", {"text": ev["text"]})
                elif ev["type"] == "done":
                    tool = ev["tool"] or tool
                    args = ev["args"]
        except Exception as e:  # noqa: BLE001 — any provider failure falls back
            payload = prewritten(req, f"{type(e).__name__}: {str(e)[:120]}")
            payload["doc_version"] = req.doc_version
            yield sse("fallback", {"note": payload["note"]})
            async for chunk in replay(payload):
                yield chunk
            return

        clean, why = sanitise(req, tool, args)
        if clean is None:
            payload = prewritten(req, why or "unusable response")
            payload["doc_version"] = req.doc_version
            yield sse("fallback", {"note": payload["note"]})
            async for chunk in replay(payload):
                yield chunk
            return

        payload = {**clean, "source": "llm", "note": None, "doc_version": req.doc_version}
        cache.put(ck, {"tool": payload["tool"], "args": payload["args"], "source": "llm", "note": None})
        yield sse("done", payload)

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/api/translate-error")
async def translate_error(err: RunErrorIn) -> dict[str, Any]:
    """Pure lookup. No model, no tokens, no gate — this is making the output
    legible, not interrupting anyone."""
    t = errors.translate(err.type, err.message, err.line)
    if t is None:
        return {"known": False}
    return {"known": True, "plain_english": t.plain_english, "line": t.line}


@app.post("/api/check-ladder")
async def check_ladder(payload: dict) -> dict[str, Any]:
    """Run the pre-written ladder past its own guard.

    The hand-written hints have to obey the rule the model is held to — an
    earlier draft of exercise 4 spelled out `count = count + 1` at tier 3.
    """
    texts: list[str] = payload.get("tier_texts", [])
    return {
        "forbidden": leakguard.forbidden_fragments(texts),
        "pairs": leakguard.forbidden_pairs(texts),
        "leaks": {
            str(i): leakguard.leaks(t, i, texts)
            for i, t in enumerate(texts, start=1)
        },
    }


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "base_url": llm.BASE_URL,
        "model": llm.MODEL,
        "key_present": bool(llm.API_KEY),
        "cache": cache.stats(),
        "llm": llm.last_outcome,
    }
