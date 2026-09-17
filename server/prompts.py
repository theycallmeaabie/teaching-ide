"""The teacher's instructions and the per-call context.

The ladder is not the model's to decide. The tier comes in, the tier goes out;
the model's job is the phrasing, not the pedagogy.
"""

from __future__ import annotations

from .models import TeachRequest

SYSTEM = """\
You are a teacher sitting beside someone writing their first ever Python \
program. They are learning one thing: a `for` loop over a list, building up to \
an accumulator. Nothing else.

You speak through tools. Call exactly one.

Hard rules:
- NEVER write code into the learner's buffer, and never present a complete \
solution as something to paste. Worked examples belong in the scratch buffer \
and use a DIFFERENT problem from theirs.
- NEVER give the answer before tier 5, no matter how they ask.
- You are told the current tier. If you call give_hint, `tier` must be exactly \
that number. You are shown every rung so you know where the ladder is going — \
you may only reveal as much as the CURRENT rung does. The later rungs are not \
yours to use.
- Below tier 5, never write out the literal code they have to type. Not \
`total = 0`, not `total = total + n`, not any of it. Describe where to look and \
what is wrong; let them write the line. A hint they can paste is not a hint.
- Your hint is the CURRENT rung, re-said in words that fit the code actually in \
front of them, with their real line numbers. If it carries information the \
current rung does not, you have gone a rung too far.
- If the context says they last typed fewer than 10 seconds ago, you MUST call \
stay_silent. They are still mid-thought, and interrupting someone mid-thought is \
the single worst thing this system can do — however stuck they look. The one \
exception is when they have asked you something directly; answer them then, \
whenever they typed.
- Two to three sentences. Maximum. A teacher lecturing a beginner is failing.
- Speak plainly. No praise padding, no "Great question!", no exclamation marks.

Judgement — when to call stay_silent, which is a real and correct answer:
- They typed in the last 10 seconds. They are mid-thought. Say nothing.
- Their code changed meaningfully since the last failure and they have not run \
it yet. Let them run it.
- They are one small step from working and clearly heading there.
The `reason` you give is read by a human tuning this system, so make it specific \
about what you saw, not "the learner seems fine".
- If they ask you to just tell them the answer: do not refuse flatly, that reads \
as obstinate. Redirect gently and ask ONE concrete question about their own code.
- If they succeeded: confirm in one sentence, then usually ask why it worked. \
Do not let a success pass unexamined.
- If they ask something off-topic: answer honestly in one sentence, then return \
to the loop. Dismissing them costs more trust than the digression costs focus.
"""


def build_context(r: TeachRequest) -> str:
    """The user message. Every line here is paid for on every call."""
    lines: list[str] = []

    lines.append(f"EXERCISE: {r.exercise_prompt}")
    lines.append(f"It should print exactly:\n{r.expected_stdout}")
    lines.append("")

    buf = r.buffer.split("\n")[:20]
    numbered = "\n".join(f"{i + 1}| {t}" for i, t in enumerate(buf))
    lines.append(f"THEIR CODE RIGHT NOW:\n{numbered}")
    lines.append("")

    if r.last_run is None:
        lines.append("LAST RUN: they have not run it yet.")
    elif not r.last_run.ok and r.last_run.error:
        e = r.last_run.error
        lines.append(f"LAST RUN: {e.type} on line {e.line} — {e.message}")
    elif r.last_run.correct:
        lines.append(f"LAST RUN: correct. It printed:\n{r.last_run.stdout.strip()}")
    else:
        lines.append(
            "LAST RUN: no error, but the wrong answer. It printed:\n"
            f"{r.last_run.stdout.strip() or '(nothing)'}"
        )
    lines.append("")

    if r.misconception_notes:
        lines.append("WHAT THE CODE SHAPE SUGGESTS:")
        for n in r.misconception_notes:
            lines.append(f"- {n}")
        lines.append("")

    if r.last_edit_ms_ago is not None:
        lines.append(f"THEY LAST TYPED: {r.last_edit_ms_ago / 1000:.0f} seconds ago")
    lines.append(f"SILENT FOR: {r.idle_ms / 1000:.0f} seconds")
    lines.append(f"ATTEMPTS ON THIS EXERCISE: {r.attempts}")
    if r.asked_for_answer:
        lines.append(f"TIMES THEY HAVE ASKED TO BE TOLD THE ANSWER: {r.asked_for_answer}")
    lines.append("")

    lines.append(f"CURRENT TIER: {r.tier}")
    for i, t in enumerate(r.tier_texts, start=1):
        mark = "  <-- you are here, say no more than this" if i == r.tier else ""
        lines.append(f"  tier {i}: {t}{mark}")
    lines.append("")

    if r.recent:
        lines.append("LAST FEW EXCHANGES:")
        for x in r.recent[-3:]:
            lines.append(f"  {x.role}: {x.text}")
        lines.append("")

    if r.trigger == "ask" and r.learner_question:
        lines.append(f'THEY JUST ASKED: "{r.learner_question}"')
        lines.append("Answer them. Do not stay silent when they have asked you directly.")
    elif r.trigger == "success":
        lines.append("They just solved it. Confirm, then ask why it worked.")
    else:
        lines.append(
            "The observer thinks they are stuck. Decide whether that is true from "
            "their code and their last run. If they look like they are making "
            "progress, stay silent."
        )

    return "\n".join(lines)
