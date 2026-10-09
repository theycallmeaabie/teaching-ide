"""The teacher's voice on the server: when it spends ElevenLabs credits, when it
refuses, and how each refusal is named so the browser knows to use its own voice.
ElevenLabs is stubbed: no network, and no credits spent.

Run with `npm test tts`.
"""

from __future__ import annotations

import asyncio
import json
import sys

import httpx
from fastapi.testclient import TestClient

from server import quota, tts
from server.main import app

failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  | {detail}" if detail else ""))


MP3 = b"ID3" + b"\x00" * 2000
client = TestClient(app)


class Provider:
    """Stands in for tts.synthesize at the route's seam."""

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.result: object = MP3

    async def __call__(self, text: str) -> bytes:
        self.calls.append(text)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result  # type: ignore[return-value]


provider = Provider()
REAL_SYNTHESIZE = tts.synthesize
tts.synthesize = provider  # type: ignore[assignment]


def fresh(**limits) -> None:
    tts.reset()
    quota.reset()
    provider.calls.clear()
    provider.result = MP3
    tts.API_KEY = limits.get("key", "test-key")
    tts.PER_MINUTE = limits.get("per_minute", 100)
    tts.PER_DAY = limits.get("per_day", 1000)
    tts.CHARS_PER_DAY = limits.get("chars_per_day", 100_000)


def say(text: str) -> httpx.Response:
    return client.post("/api/speak", json={"text": text})


print("--- Words become audio -------------------------------------------------")
fresh()
r = say("Put a colon at the end.")
check("text comes back as MP3", r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and r.content == MP3, f"{r.status_code} {len(r.content)} bytes")
check("ElevenLabs is asked once, for exactly those words", provider.calls == ["Put a colon at the end."], str(provider.calls))
check("...and the browser is told not to keep it", r.headers.get("cache-control") == "no-store")
fresh()
say("  Put a colon\n\n at the end.  ")
check("spacing is tidied before it is spent on", provider.calls == ["Put a colon at the end."], str(provider.calls))

fresh()
say("That is it exactly.")
again = say("That is it exactly.")
check("the same words twice are made once: a pre-written hint costs credits once",
      again.status_code == 200 and again.content == MP3 and len(provider.calls) == 1, f"{len(provider.calls)} calls")
check("...and only the first counts against the day's characters", tts._chars_today() == len("That is it exactly."), str(tts._chars_today()))

print()
print("--- What it refuses before it spends anything -------------------------")
fresh(key="")
r = say("hello")
check("with no key set, it says so as 'unconfigured'", r.status_code == 503 and r.json()["kind"] == "unconfigured", r.text)
check("...without asking ElevenLabs", provider.calls == [])
fresh()
check("nothing to say is refused", say("").status_code == 422 and say("   ").status_code == 400)
check("an essay is refused", say("x" * (tts.MAX_CHARS + 1)).status_code == 422)
check("...and neither reached ElevenLabs", provider.calls == [])

fresh(chars_per_day=30)
first = say("This is twenty-five chars")
over = say("and this tips it over the day")
check("the day's characters for the whole key are a hard stop",
      first.status_code == 200 and over.status_code == 503 and over.json()["kind"] == "budget", f"{first.status_code} {over.text}")
check("...that ElevenLabs never sees", provider.calls == ["This is twenty-five chars"], str(provider.calls))

print()
print("--- Its limits are its own --------------------------------------------")
fresh(per_minute=2)
codes = [say(f"line {i}").status_code for i in range(4)]
check("the per-minute limit holds", codes == [200, 200, 429, 429], str(codes))
check("...says when to try again", say("again").headers.get("retry-after") == "30")
check("...and speaking does not spend the teacher's hint budget", quota._minute == {} and quota._day == {})
fresh(per_day=1)
codes = [say(f"line {i}").status_code for i in range(2)]
check("the daily limit holds", codes == [200, 429], str(codes))

print()
print("--- When ElevenLabs says no -------------------------------------------")
for kind in ["no_credits", "refused", "unconfigured"]:
    fresh()
    say("cached before it went wrong")
    provider.result = tts.TtsError(kind, f"reason for {kind}")
    r = say("first words after")
    check(f"'{kind}' is passed on by name, with its reason", r.status_code == 503 and r.json() == {"detail": f"reason for {kind}", "kind": kind}, r.text)
    calls = len(provider.calls)
    r = say("second words after")
    check("...and ElevenLabs is not asked again for a while", r.status_code == 503 and r.json()["kind"] == kind and len(provider.calls) == calls, f"{len(provider.calls) - calls} more calls")
    check("...while audio it already made still plays", say("cached before it went wrong").status_code == 200)
    check("...and the pause shows on /api/health", client.get("/api/health").json()["voice"]["paused"] == kind)

for kind in ["busy", "unavailable", "bad_text"]:
    fresh()
    provider.result = tts.TtsError(kind, f"reason for {kind}")
    r = say("one")
    say("two")
    check(f"'{kind}' is passed on, and the next request still tries", r.json()["kind"] == kind and len(provider.calls) == 2, f"{len(provider.calls)} calls")

fresh()
health = client.get("/api/health").json()["voice"]
check("/api/health says whether the key is there, never what it is",
      health["key_present"] is True and "test-key" not in str(health) and health["paused"] is None, str(health))

print()
print("--- The real ElevenLabs call, against a stand-in transport -------------")
tts.synthesize = REAL_SYNTHESIZE
tts.API_KEY = "test-key"
seen: list[httpx.Request] = []


def respond(status: int, body: object = None, content: bytes = b""):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if body is not None:
            return httpx.Response(status, json=body)
        return httpx.Response(status, content=content)

    tts._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))


def outcome() -> str:
    try:
        asyncio.run(tts.synthesize("Hello there."))
        return "audio"
    except tts.TtsError as e:
        return e.kind


respond(200, content=MP3)
check("audio comes back as it was sent", outcome() == "audio")
req = seen[-1]
check("it asks for the configured voice, as MP3 at the configured quality",
      req.url.path == f"/v1/text-to-speech/{tts.VOICE_ID}" and req.url.params.get("output_format") == tts.FORMAT, str(req.url))
check("...with the key in the header ElevenLabs reads", req.headers.get("xi-api-key") == "test-key")
sent = json.loads(req.content)
check("...and the words and model in the body", sent == {"text": "Hello there.", "model_id": tts.MODEL}, str(sent))

for status, body, kind in [
    (401, {"detail": {"status": "quota_exceeded", "message": "This request exceeds your quota of 10000."}}, "no_credits"),
    (402, {"detail": {"status": "payment_required", "message": "pay"}}, "no_credits"),
    (401, {"detail": {"status": "detected_unusual_activity", "message": "Free Tier usage disabled"}}, "refused"),
    (401, {"detail": {"status": "invalid_api_key", "message": "Invalid API key"}}, "unconfigured"),
    (404, {"detail": {"status": "voice_not_found", "message": "no voice"}}, "unconfigured"),
    (429, {"detail": {"status": "too_many_concurrent_requests", "message": "slow down"}}, "busy"),
    (422, {"detail": [{"msg": "bad"}]}, "bad_text"),
    (500, {"detail": "oops"}, "unavailable"),
]:
    respond(status, body)
    got = outcome()
    check(f"a {status} {body['detail']['status'] if isinstance(body['detail'], dict) else ''} is '{kind}'".replace("  ", " "), got == kind, got)

respond(200, content=b"")
check("an empty 200 is not audio", outcome() == "unavailable")


def down(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("no route", request=request)


tts._client = httpx.AsyncClient(transport=httpx.MockTransport(down))
check("an unreachable ElevenLabs is 'unavailable'", outcome() == "unavailable")


def slow(request: httpx.Request) -> httpx.Response:
    raise httpx.ReadTimeout("slow", request=request)


tts._client = httpx.AsyncClient(transport=httpx.MockTransport(slow))
check("...and so is a slow one", outcome() == "unavailable")

tts.API_KEY = ""
check("with no key it never calls out", outcome() == "unconfigured")

print()
print("ALL TTS CASES PASSED" if not failures else f"{failures} FAILED")
sys.exit(1 if failures else 0)
