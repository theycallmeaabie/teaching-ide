"""The only module in the system that knows which LLM provider we are using.

Switching to Ollama, Gemini or anything else OpenAI-compatible is a change to
LLM_BASE_URL and LLM_MODEL in the environment. Nothing else imports `openai`,
and nothing else reads those variables.
"""

from __future__ import annotations

import asyncio
import os
import random
import re
from typing import Any, AsyncIterator

from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv()

BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.groq.com/openai/v1")
MODEL = os.environ.get("LLM_MODEL", "llama-3.3-70b-versatile")
API_KEY = os.environ.get("LLM_API_KEY", "")

_client = AsyncOpenAI(base_url=BASE_URL, api_key=API_KEY or "not-needed")

#: Last thing the provider did, so the UI can say when the teacher is running on
#: pre-written words. A tester who cannot tell the difference will evaluate the
#: wrong system.
last_outcome: dict[str, Any] = {"ok": None, "reason": None, "at": None, "retry_after_s": None}


def _note_outcome(ok: bool, reason: str | None = None, retry_after_s: float | None = None) -> None:
    import time

    last_outcome.update(ok=ok, reason=reason, at=time.time(), retry_after_s=retry_after_s)


async def complete(
    *,
    system: str,
    user: str,
    tools: list[dict[str, Any]],
    stream: bool = False,
    temperature: float = 0.3,
    max_tokens: int = 400,
) -> dict[str, Any] | AsyncIterator[dict[str, Any]]:
    """The single entry point for model access.

    Non-streaming: returns {"tool": name, "args": {...}, "raw": str|None}.
    Streaming: yields {"type": "delta"|"tool"|"done", ...} dicts.

    `args` is whatever the model produced; validating it against the tool
    schema is the caller's job, because the caller is the one that has to fall
    back when it is wrong.
    """
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    kwargs: dict[str, Any] = dict(
        model=MODEL,
        messages=messages,
        tools=tools,
        tool_choice="required",
        temperature=temperature,
        max_tokens=max_tokens,
    )

    if not stream:
        return await _once(kwargs)
    return _stream(kwargs)


#: Short, few retries on purpose. A learner is waiting; a slow correct hint is
#: worse than an instant pre-written one, so the caller falls back rather than
#: us retrying our way to a ten-second answer.
RETRY_DELAYS = (0.5, 1.5)

#: Groq's free tier is token-per-minute limited, and its 429 says how long the
#: bucket needs. Waiting that out is worth it when it is short; past this, the
#: pre-written hint is the better answer.
MAX_RETRY_AFTER_S = 3.0


def _retry_after(exc: Exception) -> float | None:
    """Seconds the provider asked us to wait, if it said."""
    resp = getattr(exc, "response", None)
    headers = getattr(resp, "headers", None) or {}
    for key in ("retry-after", "x-ratelimit-reset-tokens", "x-ratelimit-reset-requests"):
        raw = headers.get(key)
        if not raw:
            continue
        try:
            if raw.endswith("ms"):
                return float(raw[:-2]) / 1000
            if raw.endswith("s") and "m" not in raw and "h" not in raw:
                return float(raw[:-1])
            return float(raw)
        except ValueError:
            continue  # "4h26m24s" and friends — far too long to wait on
    return None


async def _create_with_retry(kwargs: dict[str, Any]):
    from openai import APIConnectionError, InternalServerError, RateLimitError

    last: Exception | None = None
    for attempt in range(len(RETRY_DELAYS) + 1):
        try:
            resp = await _client.chat.completions.create(**kwargs)
            _note_outcome(True)
            return resp
        except (RateLimitError, InternalServerError, APIConnectionError) as e:
            last = e
            if attempt == len(RETRY_DELAYS):
                break
            asked = _retry_after(e)
            if asked is not None and asked > MAX_RETRY_AFTER_S:
                break  # the learner should not wait this long; fall back instead
            delay = asked if asked is not None else RETRY_DELAYS[attempt]
            await asyncio.sleep(delay * (1 + random.random() * 0.3) + 0.05)
    assert last is not None
    _note_outcome(False, _short_reason(last), _seconds_until_retry(last))
    raise last


def _short_reason(exc: Exception) -> str:
    """The useful half of a provider error, without the JSON blob."""
    text = str(exc)
    for marker, label in (
        ("tokens per day", "daily token cap reached"),
        ("tokens per minute", "per-minute token limit"),
        ("requests per day", "daily request cap reached"),
        ("requests per minute", "per-minute request limit"),
    ):
        if marker in text:
            return label
    return f"{type(exc).__name__}"


def _seconds_until_retry(exc: Exception) -> float | None:
    m = re.search(r"try again in ((\d+)m)?([\d.]+)s", str(exc))
    if not m:
        return None
    return (int(m.group(2) or 0) * 60) + float(m.group(3))


async def _once(kwargs: dict[str, Any]) -> dict[str, Any]:
    import json

    resp = await _create_with_retry(kwargs)
    msg = resp.choices[0].message
    calls = msg.tool_calls or []
    if not calls:
        return {"tool": None, "args": None, "raw": msg.content}
    call = calls[0]
    try:
        args = json.loads(call.function.arguments or "{}")
    except json.JSONDecodeError:
        return {"tool": call.function.name, "args": None, "raw": call.function.arguments}
    return {"tool": call.function.name, "args": args, "raw": call.function.arguments}


async def _stream(kwargs: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
    import json

    name: str | None = None
    buffer = ""
    emitted = 0
    field: str | None = None

    stream = await _create_with_retry({**kwargs, "stream": True})
    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        for call in delta.tool_calls or []:
            if call.function and call.function.name:
                name = call.function.name
                field = _PROSE_FIELD.get(name)
                yield {"type": "tool", "tool": name}
            if call.function and call.function.arguments:
                buffer += call.function.arguments
                if field:
                    text = _partial_string(buffer, field)
                    if text is not None and len(text) > emitted:
                        yield {"type": "delta", "text": text[emitted:]}
                        emitted = len(text)

    try:
        args = json.loads(buffer or "{}")
    except json.JSONDecodeError:
        args = None
    yield {"type": "done", "tool": name, "args": args, "raw": buffer}


#: Which argument of each tool holds prose worth streaming to the learner.
_PROSE_FIELD = {
    "give_hint": "text",
    "ask_question": "text",
    "translate_error": "plain_english",
    "confirm_success": "text",
}


def _partial_string(buffer: str, key: str) -> str | None:
    """Pull a still-arriving JSON string value out of a half-written object.

    Tool arguments stream as JSON fragments, so the prose only exists inside an
    object that has not closed yet. This reads the value of `key` as far as it
    has arrived, unescaping as it goes, so the hint can appear progressively
    instead of landing all at once when the call completes.
    """
    marker = f'"{key}"'
    i = buffer.find(marker)
    if i < 0:
        return None
    i += len(marker)
    while i < len(buffer) and buffer[i] in ' \t\r\n':
        i += 1
    if i >= len(buffer) or buffer[i] != ':':
        return None
    i += 1
    while i < len(buffer) and buffer[i] in ' \t\r\n':
        i += 1
    if i >= len(buffer) or buffer[i] != '"':
        return None
    i += 1

    out: list[str] = []
    while i < len(buffer):
        ch = buffer[i]
        if ch == '\\':
            if i + 1 >= len(buffer):
                break  # escape only half-arrived; stop before it
            nxt = buffer[i + 1]
            out.append({'n': '\n', 't': '\t', 'r': '\r', '"': '"', '\\': '\\', '/': '/'}.get(nxt, nxt))
            i += 2
            continue
        if ch == '"':
            break
        out.append(ch)
        i += 1
    return "".join(out)
