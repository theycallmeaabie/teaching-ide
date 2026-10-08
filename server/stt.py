"""POST /api/transcribe: a learner's spoken question, as text.

The browser records, this turns it into words, and the words go into the ask box
for the learner to read before anything is sent. Nothing here writes to the
lesson, and nothing is kept: the audio is held in memory for the length of the
request, passed to the provider, and dropped. It is not logged, and neither is
what it said.

Its limits are its own. They are not `quota`'s, so talking cannot spend the
hint budget and a stuck mic loop cannot starve the teacher. They sit well under
the provider's free plan (20 requests a minute, 2,000 a day for the whole key)
because that allowance is shared by every learner, not per person.
"""

from __future__ import annotations

import os
import time
from collections import deque

from fastapi import APIRouter, Depends, HTTPException, Request

from . import auth, llm, quota

router = APIRouter()

PER_MINUTE = int(os.environ.get("STT_PER_MINUTE", "6"))
PER_DAY = int(os.environ.get("STT_PER_DAY", "150"))
#: A minute of speech is a few hundred KB; this is generous, and bounds what one
#: request can make the server hold.
MAX_BYTES = int(os.environ.get("STT_MAX_BYTES", str(4 * 1024 * 1024)))
#: Below this there is no speech in it. It is a click, not a question.
MIN_BYTES = 800
#: An ask box holds a question, not an essay.
MAX_CHARS = 500
MAX_TRACKED = 20_000

#: What a browser's MediaRecorder produces, and the extension the provider reads
#: the format from. Chrome and Edge: webm. Firefox: ogg. Safari: mp4.
_EXT = {
    "audio/webm": "webm",
    "video/webm": "webm",  # some browsers label audio-only webm this way
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "video/mp4": "mp4",
    "audio/x-m4a": "m4a",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/flac": "flac",
}

_minute: dict[str, deque[float]] = {}
_day: dict[str, tuple[int, int]] = {}


def _check(who: str) -> str | None:
    """None if this caller may transcribe (and records it), else why not."""
    if len(_minute) > MAX_TRACKED:
        _minute.clear()  # forgiving, never blocking, like quota's own pruning
    if len(_day) > MAX_TRACKED:
        _day.clear()
    now = time.monotonic()
    q = _minute.setdefault(who, deque())
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= PER_MINUTE:
        return "Too many voice questions this minute. Give it a moment."
    today = int(time.time() // 86400)
    day, n = _day.get(who, (today, 0))
    if day != today:
        day, n = today, 0
    if n >= PER_DAY:
        return "That is the voice limit for today. You can still type."
    q.append(now)
    _day[who] = (day, n + 1)
    return None


def reset() -> None:
    """For tests."""
    _minute.clear()
    _day.clear()


async def _read_capped(request: Request, limit: int) -> bytes:
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise HTTPException(413, "that recording is too long")
    buf = bytearray()
    async for chunk in request.stream():
        buf.extend(chunk)
        if len(buf) > limit:  # a client can lie about content-length
            raise HTTPException(413, "that recording is too long")
    return bytes(buf)


_STATUS = {"rate": 429, "unavailable": 503, "bad_audio": 422}


@router.post("/api/transcribe")
async def transcribe(
    request: Request,
    user_id: str | None = Depends(auth.current_user),
) -> dict[str, str]:
    mime = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    ext = _EXT.get(mime)
    if ext is None:
        raise HTTPException(415, "send the recording as audio")

    refusal = _check(quota.principal(user_id, request))
    if refusal:
        raise HTTPException(429, refusal, headers={"Retry-After": "30"})

    audio = await _read_capped(request, MAX_BYTES)
    if len(audio) < MIN_BYTES:
        raise HTTPException(400, "that recording was empty")

    try:
        text = await llm.transcribe(audio, f"speech.{ext}", mime)
    except llm.SttError as e:
        raise HTTPException(_STATUS.get(e.kind, 503), e.reason) from None
    return {"text": text[:MAX_CHARS]}
