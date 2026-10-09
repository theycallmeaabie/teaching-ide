"""POST /api/speak: the teacher's words as audio, from ElevenLabs.

The browser asks for this only when the learner has turned the speaker on, and
if it cannot have it (no key here, the credits used up, ElevenLabs down, a limit
hit) it reads the words with its own speech engine instead. So a refusal here
is never something the learner sees, only a different voice. Every refusal says
which kind it is, so the browser knows whether trying again soon is worth it.

Every character spent here comes out of the ElevenLabs plan, and anyone who can
reach the API can call this, so it has limits of its own: per caller, a minute
and a day, and a number of characters a day for the whole key. When ElevenLabs
says the credits are gone or refuses the key, nothing more is sent to it for a
while: requests in that time are refused at once, without the round trip.

The text is held for the length of the request and not logged. Audio already
made is kept in memory and replayed, so a pre-written hint costs credits once.
"""

from __future__ import annotations

import os
import time
from collections import OrderedDict, deque
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import auth, cache, quota

load_dotenv()

router = APIRouter()

API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
#: George, one of the stock voices every account has. Any voice in the account's
#: library works; its id is on the voice's page.
VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
#: The cheapest and fastest. eleven_multilingual_v2 sounds better and costs twice as much.
MODEL = os.environ.get("ELEVENLABS_MODEL", "eleven_flash_v2_5")
#: Speech needs no more, and a smaller file starts playing sooner.
FORMAT = os.environ.get("ELEVENLABS_FORMAT", "mp3_44100_64")
BASE_URL = "https://api.elevenlabs.io/v1"
TIMEOUT_S = 15.0

PER_MINUTE = int(os.environ.get("TTS_PER_MINUTE", "12"))
PER_DAY = int(os.environ.get("TTS_PER_DAY", "300"))
#: Characters sent to ElevenLabs a day, for the whole key. Replays are free.
CHARS_PER_DAY = int(os.environ.get("TTS_CHARS_PER_DAY", "20000"))
#: How long to stop asking once ElevenLabs has said no for a reason that will
#: not change in a minute.
PAUSE_S = int(os.environ.get("TTS_PAUSE_S", "600"))
#: What the teacher says at once is a few sentences.
MAX_CHARS = 1000
#: Audio kept for replay. At 64 kbps a hint is 50-150 KB.
CACHE_BYTES = int(os.environ.get("TTS_CACHE_BYTES", str(16 * 1024 * 1024)))
MAX_TRACKED = 20_000

#: Refusals that mean "not for a while": the browser stops asking, and so does this.
LASTING = {"unconfigured", "no_credits", "refused"}


class TtsError(Exception):
    """kind: unconfigured, no_credits, refused, busy, bad_text, unavailable."""

    def __init__(self, kind: str, reason: str):
        super().__init__(reason)
        self.kind = kind
        self.reason = reason


_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=TIMEOUT_S)
    return _client


def _status(resp: httpx.Response) -> str:
    """ElevenLabs puts the reason in {"detail": {"status": ...}}."""
    try:
        detail = resp.json().get("detail")
    except ValueError:
        return ""
    return str(detail.get("status", "")) if isinstance(detail, dict) else ""


async def synthesize(text: str) -> bytes:
    """One call to ElevenLabs. MP3 bytes, or TtsError saying why not."""
    if not API_KEY:
        raise TtsError("unconfigured", "no ElevenLabs key is set")
    try:
        resp = await _http().post(
            f"{BASE_URL}/text-to-speech/{VOICE_ID}",
            params={"output_format": FORMAT},
            headers={"xi-api-key": API_KEY, "accept": "audio/mpeg"},
            json={"text": text, "model_id": MODEL},
        )
    except httpx.TimeoutException:
        raise TtsError("unavailable", "ElevenLabs took too long") from None
    except httpx.HTTPError:
        raise TtsError("unavailable", "could not reach ElevenLabs") from None

    if resp.status_code == 200 and resp.content:
        return resp.content
    status = _status(resp)
    # The credits running out comes back as a 401, like a bad key: the status
    # inside is what tells them apart.
    if status == "quota_exceeded" or resp.status_code == 402:
        raise TtsError("no_credits", "the ElevenLabs credits are used up")
    if status == "detected_unusual_activity":
        # What the free plan says to calls from cloud servers, among others.
        raise TtsError("refused", "ElevenLabs refused this server (detected unusual activity)")
    if resp.status_code in (401, 403) or status in ("invalid_api_key", "missing_permissions"):
        raise TtsError("unconfigured", "ElevenLabs refused the key")
    if resp.status_code == 404:
        raise TtsError("unconfigured", "ElevenLabs has no voice with that id")
    if resp.status_code == 429:
        raise TtsError("busy", "ElevenLabs is busy")
    if resp.status_code in (400, 422):
        raise TtsError("bad_text", "ElevenLabs could not read that text")
    raise TtsError("unavailable", f"ElevenLabs answered {resp.status_code}")


# --------------------------------------------------------------------- state

_minute: dict[str, deque[float]] = {}
_day: dict[str, tuple[int, int]] = {}
_spent: tuple[int, int] = (0, 0)  # (day, characters sent to ElevenLabs)
_paused: tuple[float, str, str] | None = None  # (until, kind, reason)
_clips: OrderedDict[str, bytes] = OrderedDict()
_clip_bytes = 0


def reset() -> None:
    """For tests."""
    global _spent, _paused, _clip_bytes
    _minute.clear()
    _day.clear()
    _clips.clear()
    _spent, _paused, _clip_bytes = (0, 0), None, 0


def _today() -> int:
    return int(time.time() // 86400)


def _check(who: str) -> str | None:
    """None if this caller may have audio (and records it), else why not."""
    if len(_minute) > MAX_TRACKED:
        _minute.clear()
    if len(_day) > MAX_TRACKED:
        _day.clear()
    now = time.monotonic()
    q = _minute.setdefault(who, deque())
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= PER_MINUTE:
        return "too many in a minute"
    day, n = _day.get(who, (_today(), 0))
    if day != _today():
        day, n = _today(), 0
    if n >= PER_DAY:
        return "the daily limit is reached"
    q.append(now)
    _day[who] = (day, n + 1)
    return None


def _chars_today() -> int:
    day, n = _spent
    return n if day == _today() else 0


def _pause_left() -> tuple[str, str] | None:
    global _paused
    if _paused and time.monotonic() < _paused[0]:
        return _paused[1], _paused[2]
    _paused = None
    return None


def _remember(key: str, audio: bytes) -> None:
    global _clip_bytes
    if len(audio) > CACHE_BYTES:
        return
    _clips[key] = audio
    _clip_bytes += len(audio)
    while _clip_bytes > CACHE_BYTES:
        _, old = _clips.popitem(last=False)
        _clip_bytes -= len(old)


def _refuse(kind: str, reason: str) -> JSONResponse:
    return JSONResponse({"detail": reason, "kind": kind}, status_code=503)


def _audio(data: bytes) -> Response:
    return Response(content=data, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})


def status() -> dict[str, Any]:
    """For /api/health: whether the voice is set up, and whether it is paused."""
    paused = _pause_left()
    return {
        "provider": "elevenlabs",
        "key_present": bool(API_KEY),
        "model": MODEL,
        "voice_id": VOICE_ID,
        "paused": paused[0] if paused else None,
        "chars_today": _chars_today(),
        "chars_per_day": CHARS_PER_DAY,
    }


# --------------------------------------------------------------------- route


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_CHARS)


@router.post("/api/speak")
async def speak(
    body: SpeakRequest,
    request: Request,
    user_id: str | None = Depends(auth.current_user),
) -> Response:
    global _spent, _paused
    text = " ".join(body.text.split())
    if not text:
        raise HTTPException(400, "nothing to say")
    if not API_KEY:
        return _refuse("unconfigured", "no ElevenLabs key is set")

    refusal = _check(quota.principal(user_id, request))
    if refusal:
        raise HTTPException(429, refusal, headers={"Retry-After": "30"})

    key = cache.key(MODEL, VOICE_ID, FORMAT, text)
    if key in _clips:
        _clips.move_to_end(key)
        return _audio(_clips[key])

    paused = _pause_left()
    if paused:
        return _refuse(*paused)
    if _chars_today() + len(text) > CHARS_PER_DAY:
        return _refuse("budget", "today's voice budget is spent")

    try:
        audio = await synthesize(text)
    except TtsError as e:
        if e.kind in LASTING:
            _paused = (time.monotonic() + PAUSE_S, e.kind, e.reason)
        return _refuse(e.kind, e.reason)

    _spent = (_today(), _chars_today() + len(text))
    _remember(key, audio)
    return _audio(audio)
