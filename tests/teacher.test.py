"""The teacher's server-side logic: what it is told, what it may say, and who
may ask. No network, no model.

Run with `npm test teacher`.
"""

from __future__ import annotations

import sys
from types import SimpleNamespace

from server import quota
from server.main import REQUIRED_ARGS, sanitise
from server.models import Interaction, LearnerProfile, RunResultIn, TeachRequest
from server.prompts import SYSTEM, build_context, render_profile
from server.tools import TOOL_NAMES, TOOLS

failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""))


LADDER = [
    "You need somewhere to keep the running total.",
    "Two things change: a new line above line 3.",
    "A variable created inside the loop is created again on every pass.",
    "Same shape on a different list.",
    "Above the loop type `total = 0`. Replace line 4 with `total = total + n`. Then `print(total)`.",
]


def req(**over) -> TeachRequest:
    base = dict(
        doc_version=1,
        buffer="nums = [3, 7]\nfor n in nums:\n    total = 0\n",
        exercise_id="sum-them",
        exercise_prompt="Add all four numbers together.",
        expected_stdout="27",
        exercise_concept="building up a running total across a loop",
        exercise_section="loops",
        tier=1,
        tier_texts=LADDER,
    )
    base.update(over)
    return TeachRequest(**base)


print("--- The prompt is about the exercise, not about loops ---------------")
check("the system prompt no longer says 'a for loop… nothing else'",
      "for` loop over a list" not in SYSTEM and "Nothing else" not in SYSTEM)
ctx = build_context(req(exercise_section="strings", exercise_concept="string methods, called with a dot"))
check("the exercise's own topic reaches the model", "string methods, called with a dot" in ctx)
check("...and its section", "EXERCISE (strings)" in ctx)
check("a missing topic is simply omitted", "It is about" not in build_context(req(exercise_concept="")))

print()
print("--- Who they are ---------------------------------------------------")
check("a first-time learner has no profile block", "WHO THEY ARE" not in build_context(req()))
p = LearnerProfile(solved=6, total=20, struggled=["Add two numbers"], recurring=["resets the total inside the loop"],
                   comfortable=["output"], begs=4)
lines = render_profile(p)
check("progress is stated", any("6 of 20" in l for l in lines))
check("what came easily is stated", any("output" in l for l in lines))
check("what took effort is stated", any("Add two numbers" in l for l in lines))
check("a recurring mistake is stated", any("resets the total" in l for l in lines))
check("asking for answers is stated once it is a habit", any("4 times" in l for l in lines))
check("...but not on the first couple of times", not any("asks to simply" in l.lower() for l in render_profile(LearnerProfile(begs=2))))
check("the profile reaches the prompt", "WHO THEY ARE SO FAR" in build_context(req(profile=p)))

print()
print("--- It remembers --------------------------------------------------")
thread = [Interaction(role="teacher" if i % 2 else "learner", text=f"turn {i}") for i in range(14)]
c = build_context(req(recent=thread))
check("the conversation is in the prompt", "THE CONVERSATION ON THIS EXERCISE SO FAR" in c)
check("the most recent turn is there", "turn 13" in c)
check("only the tail is paid for", "turn 5" not in c and "turn 6" in c, "last 8 of 14")
check("teacher turns read as 'you', the learner's as 'them'", "you: turn" in c and "them: turn" in c)
long_turn = Interaction(role="teacher", text="word " * 400)
check("a very long turn is clipped", len([l for l in build_context(req(recent=[long_turn])).split("\n") if l.startswith("  you:")][0]) < 400)
check("an unchanged buffer after a hint is called out", "DID NOT LAND" in build_context(req(previous_hint_failed=True)))
check("...and not otherwise", "DID NOT LAND" not in build_context(req()))
check("the current rung is marked as a ceiling", "the ceiling on what you may reveal" in build_context(req(tier=2)))

print()
print("--- explain: teaching is free, the answer is not --------------------")
check("explain is a tool the model can call", "explain" in TOOL_NAMES)
schema = next(t for t in TOOLS if t["function"]["name"] == "explain")["function"]["parameters"]
check("its optional parts are required strings, never nullable (null broke 22% of calls once)",
      set(schema["required"]) == {"text", "example", "followup_question"}
      and all(schema["properties"][k]["type"] == "string" for k in schema["properties"]))
check("only the prose is mandatory content", REQUIRED_ARGS["explain"] == ["text"])

ok_args = {"text": "A loop variable holds one item at a time, and changes on every pass.",
           "example": 'for c in ["red", "blue"]:\n    print(c)', "followup_question": ""}
clean, why = sanitise(req(), "explain", ok_args)
check("a good explanation passes", clean is not None, str(why))
check("an unused example may be empty", sanitise(req(), "explain", {**ok_args, "example": ""})[0] is not None)
check("an explanation with no text is rejected", sanitise(req(), "explain", {**ok_args, "text": ""})[0] is None)

leaky = {**ok_args, "text": "Just write total = 0 above the loop and you are done."}
clean, why = sanitise(req(), "explain", leaky)
check("an 'explanation' that hands over the answer is rejected", clean is None, str(why))
leaky_ex = {**ok_args, "example": "total = 0\nfor n in nums:\n    total = total + n"}
clean, why = sanitise(req(), "explain", leaky_ex)
check("...even when the answer hides in the example", clean is None, str(why))
check("tier 5 may say it", sanitise(req(tier=5), "explain", leaky)[0] is not None)

print()
print("--- Rungs 1 and 2 say where to look, not what to do ------------------")
from server import leakguard

check("'try creating a variable… then add each number' is an instruction at tier 1",
      leakguard.instructs("You need a place to store the sum. Try creating a variable for the total before the loop starts, then add each number to it.", 1) is not None)
check("'Create the running total once' is an instruction at tier 2",
      leakguard.instructs("Create the running total once, before the loop starts.", 2) is not None)
check("pointing is not instructing",
      leakguard.instructs("Look at what happens to total on each pass. Where is it created?", 1) is None)
check("describing what the code does is not instructing",
      leakguard.instructs("Line 3 sets total to a fresh value on every pass, so it never builds up.", 2) is None)
check("a noun that merely contains a verb is not instructing",
      leakguard.instructs("The address of the list is what matters here.", 1) is None)
check("from tier 3 the mechanism may be explained", leakguard.instructs("Create the total before the loop.", 3) is None)

told = {"tier": 1, "text": "Try creating a variable for the total, then add each number to it.", "target_line": 0}
clean, why = sanitise(req(tier=1), "give_hint", told)
check("a hint that instructs is rejected, so the pre-written rung is served", clean is None and "told them what to do" in (why or ""), str(why))
clean, why = sanitise(req(tier=1), "ask_question", {"text": "Create the total before the loop first."})
check("...and so is a 'question' that is an instruction", clean is None, str(why))
check("an explanation of an idea is not held to it",
      sanitise(req(tier=1), "explain", {"text": "Add a dot after the name to call a method.", "example": "", "followup_question": ""})[0] is not None)
check("a good hint passes",
      sanitise(req(tier=1), "give_hint", {"tier": 1, "text": "Look at where the total gets its value on each pass.", "target_line": 3})[0] is not None)

print()
print("--- Nothing else regressed ------------------------------------------")
hint = {"tier": 3, "text": "Think about where the total is created.", "target_line": 0}
clean, _ = sanitise(req(tier=1), "give_hint", hint)
check("a hint's tier is still ours, not the model's", clean is not None and clean["args"]["tier"] == 1)
check("an unknown tool is still refused", sanitise(req(), "write_code", {"text": "x"})[0] is None)


print()
print("--- Who may ask -----------------------------------------------------")
def fake_request(host="1.2.3.4", fwd=None):
    headers = {"x-forwarded-for": fwd} if fwd else {}
    return SimpleNamespace(client=SimpleNamespace(host=host), headers=headers)

quota.reset()
me = quota.principal(None, fake_request())
check("an anonymous caller is identified by address", me == "ip:1.2.3.4")
check("a signed-in one by account, whatever the address", quota.principal("abc", fake_request()) == "user:abc")
check("a spoofed X-Forwarded-For is ignored unless a proxy is trusted",
      quota.principal(None, fake_request(fwd="9.9.9.9")) == "ip:1.2.3.4")

quota.reset()
allowed = [quota.check(me, "s1", "ask").ok for _ in range(quota.PER_MINUTE + 3)]
check(f"calls beyond {quota.PER_MINUTE} a minute are refused", allowed[: quota.PER_MINUTE] == [True] * quota.PER_MINUTE and not any(allowed[quota.PER_MINUTE:]))
v = quota.check(me, "s1", "ask")
check("...as a rate limit, which serves the pre-written rung", v.kind == "rate" and "rate limited" in (v.reason or ""))
check("another caller is unaffected", quota.check("ip:5.6.7.8", "s1", "ask").ok)
check("a cached answer does not count against the rate", all(quota.check("ip:9.9.9.9", "s", "ask", billable=False).ok for _ in range(50)))

quota.reset()
for _ in range(quota.GATE_BUDGET):
    quota.note_spoke(me, "s1", "gate")
v = quota.check(me, "s1", "gate")
check(f"after {quota.GATE_BUDGET} interruptions the observer is told to be silent", not v.ok and v.kind == "budget")
check("...a different sitting starts fresh", quota.check(me, "s2", "gate").ok)
check("...and the learner's own questions are never refused for it", quota.check(me, "s1", "ask").ok)
check("...even a cached answer respects the budget", not quota.check(me, "s1", "gate", billable=False).ok)
quota.reset()
quota.note_spoke(me, "s1", "ask")
check("a question does not spend the interruption budget", quota.check(me, "s1", "gate").ok and quota._spoken.get((me, "s1"), 0) == 0)

print()
if failures:
    print(f"{failures} FAILED")
    sys.exit(1)
print("ALL TEACHER CASES PASSED")
