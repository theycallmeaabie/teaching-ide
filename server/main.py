"""The teacher.

One endpoint, streaming. The model chooses a tool; we validate it, clamp it to
the ladder position we decided, and fall back to the pre-written hint whenever
it gives us something we cannot use. The lesson never stalls on a bad response.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

from . import auth, cache, errors, leakguard, llm, quota, stt
from .models import RunErrorIn, TeachRequest
from .prompts import SYSTEM, build_context
from .tools import TOOLS, TOOL_NAMES

# The interactive API docs describe every endpoint to anyone who asks. Fine on a
# laptop, not something to publish — opt in with ENABLE_DOCS=1.
_DOCS = os.environ.get("ENABLE_DOCS", "0") == "1"
app = FastAPI(
    title="Teaching IDE",
    docs_url="/docs" if _DOCS else None,
    redoc_url="/redoc" if _DOCS else None,
    openapi_url="/openapi.json" if _DOCS else None,
)

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
    "explain": ["text"],
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

    # Rungs 1 and 2 say where to look, never what to do. "Create the total
    # before the loop, then add each number" is the whole solution in words, and
    # there is no code in it for the fragment check below to find. Concept
    # explanations are exempt — teaching is free; this is about their exercise.
    if tool in ("give_hint", "ask_question"):
        told = leakguard.instructs(str(args.get("text", "")), req.tier)
        if told:
            return None, f"tier {req.tier} {tool} told them what to do ({told!r})"

    # The ladder applies to everything the teacher says, not just hints. A
    # "question" that spells out the fix is the answer wearing a question mark.
    prose = " ".join(
        str(args.get(k, ""))
        for k in ("text", "plain_english", "followup_question", "example")
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
    request: Request,
    user_id: str | None = Depends(auth.current_user),
) -> StreamingResponse:
    system = SYSTEM
    context = build_context(req)
    ck = cache.key(llm.MODEL, system, context)
    who = quota.principal(user_id, request)

    # A cached answer costs the provider nothing, so it is not rate-limited —
    # but the interruption budget is about the learner, and applies regardless.
    hit = cache.get(ck)
    verdict = quota.check(who, req.session_id, req.trigger, billable=hit is None)

    def spoke(payload: dict[str, Any]) -> None:
        if payload.get("tool") != "stay_silent":
            quota.note_spoke(who, req.session_id, req.trigger)

    async def gen() -> AsyncIterator[str]:
        # Refused calls are answered, not rejected: the lesson never stalls, and
        # a learner is never shown an error for something that is not theirs.
        if not verdict.ok:
            if verdict.kind == "budget":
                payload = {
                    "tool": "stay_silent",
                    "args": {"reason": verdict.reason},
                    "source": "prewritten",
                    "note": verdict.reason,
                    "doc_version": req.doc_version,
                }
            else:
                payload = prewritten(req, verdict.reason or "rate limited")
                payload["doc_version"] = req.doc_version
                yield sse("fallback", {"note": payload["note"]})
            spoke(payload)
            async for chunk in replay(payload):
                yield chunk
            return

        # Same context as last time means the same answer. During tuning that is
        # most calls, and the daily cap is about two sessions' worth of tokens.
        if hit is not None:
            payload = {**hit, "doc_version": req.doc_version, "cached": True}
            spoke(payload)
            async for chunk in replay(payload):
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
            spoke(payload)
            async for chunk in replay(payload):
                yield chunk
            return

        clean, why = sanitise(req, tool, args)
        if clean is None:
            payload = prewritten(req, why or "unusable response")
            payload["doc_version"] = req.doc_version
            yield sse("fallback", {"note": payload["note"]})
            spoke(payload)
            async for chunk in replay(payload):
                yield chunk
            return

        payload = {**clean, "source": "llm", "note": None, "doc_version": req.doc_version}
        cache.put(ck, {"tool": payload["tool"], "args": payload["args"], "source": "llm", "note": None})
        spoke(payload)
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
        # The first two rungs are held to "where to look, not what to do" too.
        "instructs": {
            str(i): leakguard.instructs(t, i)
            for i, t in enumerate(texts, start=1)
        },
    }


# Voice questions: audio in, text out. Its own limits, not the teacher's.
app.include_router(stt.router)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "base_url": llm.BASE_URL,
        "model": llm.MODEL,
        "key_present": bool(llm.API_KEY),
        "cache": cache.stats(),
        "llm": llm.last_outcome,
        # Whether a presented token must verify. False means every call is treated
        # as anonymous, which is the default until SUPABASE_JWT_SECRET is set.
        "verifies_tokens": auth.ENABLED,
    }


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    return resp


# One deployable: with a built bundle present, the API serves the app too, so
# there is no second origin, no CORS to get right, and no proxy to configure.
# Mounted last so every /api route above takes precedence. In development there
# is no dist/ worth serving and Vite does it instead.
DIST = Path(__file__).resolve().parent.parent / "dist"


class SinglePageApp(StaticFiles):
    """The built app, with one addition: a path that is not a file is a page.

    The app's pages (/signin, /courses, /course/python) are routes in the browser
    and exist nowhere on disk, so a refresh or a pasted link would otherwise be a
    404. Anything that looks like a file (it has an extension) or belongs to the
    API stays a real 404, so a missing script is reported as missing rather than
    answered with a web page it will fail to parse, and a mistyped API path is not
    answered with HTML that looks like success.
    """

    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404 or path == "api" or path.startswith("api/") or "." in Path(path).name:
                raise
            return await super().get_response("index.html", scope)


if (DIST / "index.html").is_file():
    app.mount("/", SinglePageApp(directory=DIST, html=True), name="web")
