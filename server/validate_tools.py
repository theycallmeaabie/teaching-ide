"""Reliability gate for open-weight tool calling.

Spec: 30 calls asking for give_hint, count valid JSON. Below ~95%, simplify the
schema or add a prose fallback parser. Run this BEFORE building on tool calls.

    .venv/bin/python -m server.validate_tools [model ...]
"""

from __future__ import annotations

import asyncio
import sys
from collections import Counter

from . import llm
from .models import RunErrorIn, RunResultIn, TeachRequest
from .prompts import SYSTEM, build_context
from .tools import TOOLS, TOOL_NAMES

STUCK = TeachRequest(
    doc_version=1,
    buffer="nums = [3, 7, 12, 5]\n\nfor n in nums:\n    total = 0\n    total = total + n\nprint(total)\n",
    exercise_id="sum-them",
    exercise_prompt="Add all four numbers together and print the total. It should print 27, once.",
    expected_stdout="27",
    tier=2,
    tier_texts=[
        "You need somewhere to keep the running total. Look at what happens before the loop starts.",
        "Two things change: a new line above line 3, and what line 4 does. The printing moves to the end.",
        "A variable created inside the loop is created again on every pass. The total has to exist once, before the loop begins.",
        "This is the same running total on a different list. Notice where each of the three lines sits.",
        "Above the loop type total = 0. Replace line 4 with total = total + n. Then print(total) at the bottom.",
    ],
    attempts=3,
    last_run=RunResultIn(ok=True, stdout="5\n", correct=False),
    idle_ms=48_000,
    last_edit_ms_ago=52_000,
    stuck_score=0.72,
    misconception_notes=[
        "Total reset on every pass. Runs clean, prints the last number.",
    ],
    trigger="gate",
)

#: An unambiguous "leave them alone" — mid-typing, no run yet, nothing wrong.
#: Used only to confirm stay_silent is reachable at all.
QUIET = STUCK.model_copy(
    update=dict(
        buffer="nums = [3, 7, 12, 5]\n\ntotal = 0\nfor n in nums:\n    total = total",
        attempts=0,
        tier=1,
        last_run=None,
        misconception_notes=[],
        idle_ms=1500,
        last_edit_ms_ago=1500,
    )
)

PROGRESSING = STUCK.model_copy(
    update=dict(
        buffer="nums = [3, 7, 12, 5]\n\ntotal = 0\nfor n in nums:\n    total = total + n\n",
        attempts=0,
        tier=1,
        last_run=None,
        misconception_notes=[],
        idle_ms=6000,
        last_edit_ms_ago=6000,
    )
)

BEGGING = STUCK.model_copy(
    update=dict(
        trigger="ask",
        learner_question="just tell me the answer",
        asked_for_answer=1,
    )
)

SOLVED = STUCK.model_copy(
    update=dict(
        trigger="success",
        buffer="nums = [3, 7, 12, 5]\n\ntotal = 0\nfor n in nums:\n    total = total + n\nprint(total)\n",
        last_run=RunResultIn(ok=True, stdout="27\n", correct=True),
        misconception_notes=[],
    )
)

WEIRD_ERROR = STUCK.model_copy(
    update=dict(
        buffer="nums = [3, 7, 12, 5]\n\nfor n in nums:\n    print(n.upper())\n",
        last_run=RunResultIn(
            ok=False,
            error=RunErrorIn(type="AttributeError", message="'int' object has no attribute 'upper'", line=4),
        ),
    )
)


def validate(tool: str | None, args: dict | None, *, expect_tier: int | None) -> tuple[bool, str]:
    if tool is None:
        return False, "no tool call"
    if tool not in TOOL_NAMES:
        return False, f"unknown tool {tool}"
    if args is None:
        return False, "arguments were not valid JSON"

    required = {
        "give_hint": ["tier", "text"],
        "ask_question": ["text"],
        "translate_error": ["plain_english"],
        "confirm_success": ["text"],
        "stay_silent": ["reason"],
    }[tool]
    missing = [k for k in required if k not in args]
    if missing:
        return False, f"{tool} missing {missing}"

    if tool == "give_hint":
        if not isinstance(args["text"], str) or not args["text"].strip():
            return False, "give_hint text empty"
        if expect_tier is not None and args.get("tier") != expect_tier:
            return False, f"tier {args.get('tier')} != {expect_tier}"
    return True, "ok"


#: Groq's free tier will 429 on burst. Throttle so we measure JSON validity,
#: not queueing.
_gate = asyncio.Semaphore(2)


async def one(req: TeachRequest, expect_tier: int | None):
  async with _gate:
    try:
        out = await llm.complete(system=SYSTEM, user=build_context(req), tools=TOOLS)
    except Exception as e:  # noqa: BLE001 - the whole point is to count failures
        return False, f"{type(e).__name__}: {str(e)[:90]}", None, None
    ok, why = validate(out["tool"], out["args"], expect_tier=expect_tier)
    return ok, why, out["tool"], out["args"]


async def run_model(model: str, n: int = 30) -> bool:
    llm.MODEL = model
    print(f"\n{'=' * 66}\n{model}\n{'=' * 66}")

    if n == 0:
        results = []
    else:
        results = await asyncio.gather(*(one(STUCK, 2) for _ in range(n)))

    # Transport failures are a different problem from malformed tool calls, and
    # they have a different fix. The 95% bar is about the schema.
    transport = [why for ok, why, *_ in results if not ok and "Error" in why and ":" in why]
    answered = [(ok, why, t, a) for ok, why, t, a in results if (ok or not any(
        why.startswith(p) for p in ("RateLimit", "APIConnection", "InternalServer", "APIStatus", "APITimeout")))]
    good = sum(1 for ok, *_ in answered if ok)
    rate = good / len(answered) if answered else 0.0
    reasons = Counter(why for ok, why, *_ in answered if not ok)
    tools_used = Counter(t for ok, _, t, _ in results if ok)

    if n:
      print(f"give_hint x {n}")
      print(f"  responses received:  {len(answered)}/{n}   ({n - len(answered)} transport failures)")
      print(f"  SCHEMA VALID:        {good}/{len(answered)}  ({rate:.0%})   <-- the 95% bar")
      print(f"  tools chosen:        {dict(tools_used)}")
      for why, c in reasons.most_common():
          print(f"  x {c}x {why}")
      if transport:
          print(f"  transport: {Counter(w.split(':')[0] for w in transport).most_common()}")

    print("\n  behaviour probes:")
    probes = [
        ("clearly mid-keystroke", QUIET, None, "stay_silent"),
        ("learner is progressing", PROGRESSING, None, "stay_silent"),
        ("'just tell me the answer'", BEGGING, None, "ask_question|give_hint"),
        ("they solved it", SOLVED, None, "confirm_success"),
        ("unrecognised error", WEIRD_ERROR, None, "translate_error|give_hint"),
    ]
    probe_out = await asyncio.gather(*(one(r, t) for _, r, t, _ in probes))
    for (label, _, _, want), (ok, why, tool, args) in zip(probes, probe_out):
        hit = tool in want.split("|")
        print(f"    {'✓' if hit else '·'} {label:28} -> {tool}  {'' if ok else '[' + why + ']'}")
        if tool == "stay_silent" and args:
            print(f"        reason: {args.get('reason', '')[:80]}")

    return rate >= 0.95 if n else True


async def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    probes_only = "--probes" in sys.argv
    models = args or ["openai/gpt-oss-120b"]
    for m in models:
        ok = await run_model(m, n=0 if probes_only else 30)
        print(f"\n  => {m}: {'PASSES the 95% bar' if ok else 'BELOW the 95% bar'}")


if __name__ == "__main__":
    asyncio.run(main())
