"""The HTTP surface, end to end, with the model stubbed out.

Real routes, real middleware, real limits — and no network and no tokens. What
this proves that the unit suites cannot is that the pieces are wired together:
a refused call is *answered*, not rejected, and the lesson never stalls.

Run with `npm test api`.
"""

from __future__ import annotations

import json
import sys

from fastapi.testclient import TestClient

from server import cache, llm, quota
from server.main import app

failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""))


def events(text: str) -> list[tuple[str, dict]]:
    """Parse an SSE body into (event, data) pairs."""
    out = []
    for frame in text.split("\n\n"):
        name, data = "message", ""
        for line in frame.split("\n"):
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                data += line[6:]
        if data:
            out.append((name, json.loads(data)))
    return out


def final(text: str) -> dict:
    return [d for e, d in events(text) if e == "done"][-1]


LADDER = [
    "You need somewhere to keep the running total.",
    "Two things change: a new line above line 3.",
    "A variable created inside the loop is created again on every pass.",
    "Same shape on a different list.",
    "Above the loop type `total = 0`. Replace line 4 with `total = total + n`. Then `print(total)`.",
]


def body(**over) -> dict:
    base = dict(
        doc_version=1, buffer="nums = [3, 7]\nfor n in nums:\n    total = 0\n",
        exercise_id="sum-them", exercise_prompt="Add them up.", expected_stdout="27",
        exercise_concept="a running total", exercise_section="loops",
        tier=2, tier_texts=LADDER, trigger="gate", session_id="sitting-1",
    )
    base.update(over)
    return base


# ------------------------------------------------------------ a stub model
class Model:
    """What the provider says next. Swapped per test."""

    def __init__(self) -> None:
        self.calls = 0
        self.script = None  # callable() -> list of events, or an Exception to raise

    async def complete(self, **_kw):
        self.calls += 1
        out = self.script() if self.script else []
        if isinstance(out, Exception):
            raise out

        async def gen():
            for ev in out:
                yield ev

        return gen()


def explain_stream(text="A loop variable holds one item at a time.", example=""):
    args = {"text": text, "example": example, "followup_question": ""}
    return [
        {"type": "tool", "tool": "explain"},
        {"type": "delta", "text": text},
        {"type": "done", "tool": "explain", "args": args, "raw": json.dumps(args)},
    ]


def hint_stream(text="Look at where the total is created."):
    args = {"tier": 2, "text": text, "target_line": 0}
    return [
        {"type": "tool", "tool": "give_hint"},
        {"type": "delta", "text": text},
        {"type": "done", "tool": "give_hint", "args": args, "raw": json.dumps(args)},
    ]


model = Model()
llm.complete = model.complete  # type: ignore[assignment]
cache.ENABLED = False
client = TestClient(app)


def fresh(**limits) -> None:
    quota.reset()
    model.calls = 0
    model.script = lambda: hint_stream()
    quota.PER_MINUTE = limits.get("per_minute", 100)
    quota.PER_DAY = limits.get("per_day", 1000)
    quota.GATE_BUDGET = limits.get("gate_budget", 8)


print("--- What the server exposes -----------------------------------------")
fresh()
check("health answers", client.get("/api/health").json()["ok"] is True)
# What matters is that the API's own docs are not there. /docs may answer with the app
# itself (an unknown page is the app's to route), which describes nothing.
docs = [client.get(p).text.lower() for p in ("/docs", "/redoc")]
check("the interactive API docs are not published", not any("swagger" in t or "redoc" in t for t in docs) and client.get("/openapi.json").status_code == 404)
r = client.get("/api/health")
check("responses carry hardening headers", r.headers.get("x-content-type-options") == "nosniff" and r.headers.get("x-frame-options") == "DENY")
check("an oversized buffer is refused before it reaches the model", client.post("/api/teach", json=body(buffer="x" * 9000)).status_code == 422)
check("an absurdly long conversation is refused",
      client.post("/api/teach", json=body(recent=[{"role": "learner", "text": "hi"}] * 41)).status_code == 422)
check("a bad tier is refused", client.post("/api/teach", json=body(tier=9)).status_code == 422)

print()
print("--- It teaches -------------------------------------------------------")
fresh()
model.script = lambda: explain_stream("A loop variable holds one item at a time.", 'for c in ["red"]:\n    print(c)')
d = final(client.post("/api/teach", json=body(trigger="ask", learner_question="what is n?")).text)
check("an explanation comes back as an explanation", d["tool"] == "explain" and d["source"] == "llm")
check("...with its example", "print(c)" in d["args"]["example"])

model.script = lambda: explain_stream("Just write total = 0 above the loop.")
d = final(client.post("/api/teach", json=body(trigger="ask", learner_question="what is n?")).text)
check("an 'explanation' that hands over the answer is replaced by the pre-written rung",
      d["tool"] == "give_hint" and d["source"] == "prewritten" and "gave away" in (d["note"] or ""), d.get("note", ""))

print()
print("--- The model failing never stalls the lesson ------------------------")
fresh()
model.script = lambda: RuntimeError("provider is down")
text = client.post("/api/teach", json=body()).text
check("a dead provider still answers", final(text)["tool"] == "give_hint" and final(text)["source"] == "prewritten")
check("...and says why", any(e == "fallback" for e, _ in events(text)))
check("...with the rung the ladder is on", final(text)["args"]["text"] == LADDER[1])

print()
print("--- Who may ask, enforced here --------------------------------------")
fresh(per_minute=3)
codes = [client.post("/api/teach", json=body(trigger="ask", learner_question=f"q{i}")) for i in range(5)]
check("every call is answered, however many", all(c.status_code == 200 for c in codes))
notes = [final(c.text).get("note") or "" for c in codes]
check("the first three reach the model", model.calls == 3, f"{model.calls} model calls")
check("the rest are told it is a rate limit", all("rate limited" in n for n in notes[3:]), notes[3])
check("...and are served the pre-written rung rather than an error", final(codes[4].text)["tool"] == "give_hint")

fresh(gate_budget=2)
told = [final(client.post("/api/teach", json=body(session_id="s1")).text) for _ in range(4)]
check("the first two interruptions are spoken", [t["tool"] for t in told[:2]] == ["give_hint", "give_hint"])
check("the third and fourth are silence, by the server's decision", [t["tool"] for t in told[2:]] == ["stay_silent", "stay_silent"], str([t["tool"] for t in told]))
check("...with the reason recorded", "budget" in told[2]["args"]["reason"])
check("...and the model was never asked", model.calls == 2, f"{model.calls} model calls")
d = final(client.post("/api/teach", json=body(session_id="s1", trigger="ask", learner_question="help")).text)
check("a learner's own question is still answered once the budget is spent", d["tool"] != "stay_silent")
d = final(client.post("/api/teach", json=body(session_id="s2")).text)
check("a new sitting starts fresh", d["tool"] == "give_hint")

fresh(gate_budget=2)
model.script = lambda: [{"type": "tool", "tool": "stay_silent"}, {"type": "done", "tool": "stay_silent", "args": {"reason": "they just typed"}, "raw": "{}"}]
for _ in range(5):
    final(client.post("/api/teach", json=body(session_id="s1")).text)
model.script = lambda: hint_stream()
d = final(client.post("/api/teach", json=body(session_id="s1")).text)
check("choosing silence does not spend the budget", d["tool"] == "give_hint")

# The interruption budget is per sitting, and a sitting is whatever id the
# client claims — so a client that wants to can rotate it and never be told to
# be quiet. That is why the budget is a courtesy to the learner and not a cost
# control. The cost controls are the rate limits, and those are keyed to the
# caller, not to anything the caller says about itself:
fresh(per_minute=3)
rotating = [
    client.post("/api/teach", json=body(trigger="ask", learner_question="q", session_id=f"new-{i}"))
    for i in range(6)
]
check("rotating the session id does not escape the rate limit", model.calls == 3, f"{model.calls} model calls for 6 requests")
check("...the rest are told it is a rate limit",
      all("rate limited" in (final(c.text).get("note") or "") for c in rotating[3:]))

print()
print("--- One deployable ---------------------------------------------------")
from pathlib import Path

if (Path(__file__).resolve().parent.parent / "dist" / "index.html").is_file():
    r = client.get("/")
    check("the built app is served from the same origin", r.status_code == 200 and "<div id=\"root\">" in r.text)
    check("...and the API still wins over it", client.get("/api/health").headers["content-type"].startswith("application/json"))
    check("an unknown API path is not answered with the app", client.get("/api/nope").status_code == 404)
    # The pages are routes in the browser and exist nowhere on disk: a refresh, or a
    # link pasted to someone, has to land on the app and not on a 404.
    for page in ("/signin", "/courses", "/course/python", "/reset-password"):
        r = client.get(page)
        check(f"a refresh on {page} gets the app", r.status_code == 200 and "<div id=\"root\">" in r.text, f"{r.status_code}")
    # ...but a file that is not there is reported as not there, or a missing script
    # would be answered with a web page it fails to parse.
    check("a missing script is a 404, not the app", client.get("/assets/missing.js").status_code == 404)
    check("...and so is a missing file in a folder", client.get("/pyodide/missing.mjs").status_code == 404)
else:
    print("SKIP  no dist/ — run `npm run build` to check the single-origin deployment")

print()
if failures:
    print(f"{failures} FAILED")
    sys.exit(1)
print("ALL API CASES PASSED")
