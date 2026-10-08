"""Voice questions on the server: what it accepts, what it refuses, and what it
never touches. The provider is stubbed: no network, and no audio leaves the machine.

Run with `npm test stt`.
"""

from __future__ import annotations

import asyncio
import sys
from types import SimpleNamespace

import httpx
from fastapi.testclient import TestClient
from openai import APIConnectionError, BadRequestError, NotFoundError, RateLimitError

from server import llm, quota, stt
from server.main import app

failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  | {detail}" if detail else ""))


CLIP = b"\x1a\x45\xdf\xa3" + b"\x00" * 4000  # the right size and the right magic; the provider is stubbed
WEBM = {"content-type": "audio/webm;codecs=opus"}
client = TestClient(app)


class Provider:
    """Stands in for llm.transcribe at the route's seam."""

    def __init__(self) -> None:
        self.calls: list[tuple[int, str, str]] = []
        self.result: object = "what does the colon do"

    async def __call__(self, audio: bytes, filename: str, mime: str) -> str:
        self.calls.append((len(audio), filename, mime))
        if isinstance(self.result, Exception):
            raise self.result
        return str(self.result)


provider = Provider()
REAL_TRANSCRIBE = llm.transcribe
llm.transcribe = provider  # type: ignore[assignment]


def fresh(**limits) -> None:
    stt.reset()
    quota.reset()
    provider.calls.clear()
    provider.result = "what does the colon do"
    stt.PER_MINUTE = limits.get("per_minute", 100)
    stt.PER_DAY = limits.get("per_day", 1000)
    stt.MAX_BYTES = limits.get("max_bytes", 4 * 1024 * 1024)


print("--- A spoken question becomes text ------------------------------------")
fresh()
r = client.post("/api/transcribe", content=CLIP, headers=WEBM)
check("a recording comes back as text", r.status_code == 200 and r.json() == {"text": "what does the colon do"}, r.text)
check("the provider is handed the audio, named for its format", provider.calls == [(len(CLIP), "speech.webm", "audio/webm")], str(provider.calls))
for mime, ext in [("audio/ogg;codecs=opus", "ogg"), ("audio/mp4", "m4a"), ("audio/wav", "wav")]:
    fresh()
    client.post("/api/transcribe", content=CLIP, headers={"content-type": mime})
    check(f"{mime.split(';')[0]} is accepted as .{ext}", provider.calls and provider.calls[0][1] == f"speech.{ext}", str(provider.calls))
fresh()
provider.result = "x" * 900
check("a runaway transcript is cut to what an ask box holds",
      len(client.post("/api/transcribe", content=CLIP, headers=WEBM).json()["text"]) == stt.MAX_CHARS)
fresh()
provider.result = ""
r = client.post("/api/transcribe", content=CLIP, headers=WEBM)
check("silence is an empty answer, not an error", r.status_code == 200 and r.json() == {"text": ""})

print()
print("--- What it refuses before it spends anything -------------------------")
fresh()
check("something that is not audio is refused", client.post("/api/transcribe", json={"a": 1}).status_code == 415)
check("a request with no type is refused", client.post("/api/transcribe", content=CLIP).status_code == 415)
check("a click, not a question, is refused", client.post("/api/transcribe", content=b"tiny", headers=WEBM).status_code == 400)
check("...and none of those reached the provider", provider.calls == [])

fresh(max_bytes=10_000)
r = client.post("/api/transcribe", content=b"\x00" * 20_000, headers=WEBM)
check("a recording over the cap is refused up front", r.status_code == 413, str(r.status_code))
streamed = client.post("/api/transcribe", content=(b"\x00" * 4000 for _ in range(5)), headers=WEBM)
check("...even when the client does not say how long it is", streamed.status_code == 413, str(streamed.status_code))
check("...and the provider never saw either", provider.calls == [])

print()
print("--- Its limits are its own --------------------------------------------")
fresh(per_minute=2)
codes = [client.post("/api/transcribe", content=CLIP, headers=WEBM).status_code for _ in range(4)]
check("the per-minute limit holds", codes == [200, 200, 429, 429], str(codes))
r = client.post("/api/transcribe", content=CLIP, headers=WEBM)
check("...and says when to try again", r.headers.get("retry-after") == "30" and "moment" in r.json()["detail"])
check("...without the provider hearing the refused ones", len(provider.calls) == 2, f"{len(provider.calls)} calls")
check("talking does not spend the teacher's hint budget", quota._minute == {} and quota._day == {})

fresh(per_day=1)
codes = [client.post("/api/transcribe", content=CLIP, headers=WEBM).status_code for _ in range(2)]
check("the daily limit holds, and tells the learner they can still type",
      codes == [200, 429] and "type" in client.post("/api/transcribe", content=CLIP, headers=WEBM).json()["detail"], str(codes))

print()
print("--- When the provider cannot ------------------------------------------")
for kind, status in [("rate", 429), ("unavailable", 503), ("bad_audio", 422)]:
    fresh()
    provider.result = llm.SttError(kind, f"reason for {kind}")
    r = client.post("/api/transcribe", content=CLIP, headers=WEBM)
    check(f"'{kind}' is a {status}, with a reason the learner can read",
          r.status_code == status and r.json()["detail"] == f"reason for {kind}", f"{r.status_code} {r.text}")

print()
print("--- The real provider call, against a stand-in client ------------------")
llm.transcribe = REAL_TRANSCRIBE  # the real one now; only the client under it is a stand-in


class Transcriptions:
    def __init__(self) -> None:
        self.kwargs: dict = {}
        self.outcome: object = None

    async def create(self, **kw):
        self.kwargs = kw
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


tx = Transcriptions()
llm._client = SimpleNamespace(audio=SimpleNamespace(transcriptions=tx))  # type: ignore[assignment]
llm.API_KEY = "test-key"
llm.STT_MODEL = "whisper-large-v3-turbo"
llm.STT_LANGUAGE = ""


def run(coro):
    return asyncio.run(coro)


def http_error(cls, status: int, message: str):
    req = httpx.Request("POST", "http://provider/audio/transcriptions")
    return cls(message, response=httpx.Response(status, request=req), body=None)


# What the real provider returned for a steady tone: one confident segment of ".".
tx.outcome = {"text": " .", "segments": [{"text": " .", "no_speech_prob": 0.0, "avg_logprob": -0.62, "compression_ratio": 0.2}]}
check("a tone that comes back as a lone full stop is silence, not a question", run(llm.transcribe(b"abc", "speech.webm", "audio/webm")) == "")
tx.outcome = {"text": " ...?!"}
check("...and so is punctuation from a provider that sends no segments", run(llm.transcribe(b"abc", "speech.webm", "audio/webm")) == "")
tx.outcome = {"text": "x", "segments": [{"text": " print(\"hi\")?", "no_speech_prob": 0.01, "avg_logprob": -0.3, "compression_ratio": 1.0}]}
check("punctuation around real words is kept", run(llm.transcribe(b"abc", "speech.webm", "audio/webm")) == 'print("hi")?')
tx.outcome = {"text": "x", "segments": [{"text": " ¿qué hace el dos puntos?", "no_speech_prob": 0.01, "avg_logprob": -0.3, "compression_ratio": 1.0}]}
check("other languages are speech too", run(llm.transcribe(b"abc", "speech.webm", "audio/webm")) == "¿qué hace el dos puntos?")

tx.outcome = {"text": "x", "segments": [{"text": " what is a loop", "no_speech_prob": 0.01, "avg_logprob": -0.2, "compression_ratio": 1.0}]}
before = dict(llm.last_outcome)
text = run(llm.transcribe(b"abc", "speech.webm", "audio/webm"))
check("speech comes back as its words", text == "what is a loop", repr(text))
check("it asks for the segments, so silence can be told from speech", tx.kwargs["response_format"] == "verbose_json")
check("it is steered toward Python words", "colon" in tx.kwargs["prompt"] and tx.kwargs["temperature"] == 0)
check("the audio is passed with its filename and type", tx.kwargs["file"] == ("speech.webm", b"abc", "audio/webm"))
check("no language is forced unless one is configured", "language" not in tx.kwargs)
llm.STT_LANGUAGE = "es"
run(llm.transcribe(b"abc", "speech.webm", "audio/webm"))
check("...and one is passed when configured", tx.kwargs.get("language") == "es")
llm.STT_LANGUAGE = ""

for exc, kind in [
    (http_error(RateLimitError, 429, "slow down"), "rate"),
    (http_error(NotFoundError, 404, "no such route"), "unavailable"),
    (http_error(BadRequestError, 400, "could not process file"), "bad_audio"),
    (http_error(BadRequestError, 400, "the model `whisper-x` does not exist"), "unavailable"),
    (APIConnectionError(request=httpx.Request("POST", "http://provider")), "unavailable"),
]:
    tx.outcome = exc
    try:
        run(llm.transcribe(b"abc", "speech.webm", "audio/webm"))
        got = "no error"
    except llm.SttError as e:
        got = e.kind
    check(f"{type(exc).__name__} is '{kind}'", got == kind, got)
check("a failed upload does not make the teacher look broken (health pill untouched)", llm.last_outcome == before)

llm.STT_MODEL = "none"
try:
    run(llm.transcribe(b"abc", "speech.webm", "audio/webm"))
    got = "no error"
except llm.SttError as e:
    got = e.kind
check("a provider with no speech model says so, rather than failing", got == "unavailable")
llm.STT_MODEL = "whisper-large-v3-turbo"
llm.API_KEY = ""
try:
    run(llm.transcribe(b"abc", "speech.webm", "audio/webm"))
    got = "no error"
except llm.SttError as e:
    got = e.kind
check("no key is 'unavailable' before anything is sent", got == "unavailable")

print()
if failures:
    print(f"{failures} FAILED")
    sys.exit(1)
print("ALL STT CASES PASSED")
