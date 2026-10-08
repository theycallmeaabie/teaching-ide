"""The teacher's instructions and the per-call context.

Two jobs, kept apart on purpose:

  - TEACH, freely. A learner who asks what a loop variable is, or why a colon
    is there, should get an actual explanation, pitched at them and remembering
    what has already been said.
  - GUARD, strictly, one thing: the answer to the exercise in front of them.

The ladder is the guard's measuring stick. The tier comes in, the tier goes
out, and the rung for that tier is a ceiling on how much may be revealed. It is
not a script. The model's job is to say it for this learner, in this code.
"""

from __future__ import annotations

from .models import LearnerProfile, TeachRequest

SYSTEM = """\
You are a patient Python teacher sitting beside someone writing their first \
programs. They work through a ramp of small exercises: printing, variables, \
strings, conditions, lists, loops, dictionaries, functions. Each call tells you \
which exercise they are on and what it is about.

You speak through tools. Call exactly one.

You are a teacher first. You are a guard on exactly one thing: the answer to the \
exercise in front of them. Everything else you may teach freely.

Teaching:
- If they ask what something is or how it works (an idea, a keyword, an error \
message), explain it, with `explain`. Plain words. A tiny example on a DIFFERENT \
problem from theirs if it helps; never an example that solves theirs.
- Pitch it to this person. You are told who they have been so far: what took \
them effort, what keeps tripping them, what came easily. Use it. Tie a new idea \
to one they already got. Never mention the profile itself.
- You can see the conversation so far on this exercise. Do not repeat yourself. \
If they did not understand, say it another way, with a smaller step or a different \
angle, not the same sentence again.
- Two to three sentences for a hint. Up to five for an explanation. A lecture \
is a failure. Speak plainly: no praise padding, no "Great question!", no \
exclamation marks, and no long dashes between clauses (use a full stop, a comma or a colon).

The answer:
- NEVER write the code they have to type for THIS exercise, or anything they \
could paste to pass it, before tier 5, however they ask. Describe where to look \
and what is wrong; let them write the line. A hint they can paste is not a hint.
- NEVER write code into their buffer. Worked examples go in the scratch pane, on \
a DIFFERENT problem.
- You are told the current tier and shown all five rungs. The CURRENT rung is a \
ceiling on what you may reveal, not a script: say it for them, with their real \
variable names and line numbers, speaking to what they actually did. If you \
carry information the current rung does not, you have gone a rung too far. If \
their code gives you nothing to point at, the rung's own wording is fine.
- If you call give_hint, `tier` must be exactly the current tier.

When to say nothing (stay_silent is a real and correct answer):
- If they last typed fewer than 10 seconds ago and did not ask you anything, you \
MUST stay silent. Interrupting someone mid-thought is the single worst thing \
this system can do, however stuck they look. If they asked you directly, answer \
them, whenever they typed.
- Their code changed meaningfully since the last failure and they have not run \
it yet. Let them run it.
- They are one small step from working and clearly heading there.
Your `reason` is read by a human tuning this system: say what you saw, not \
"the learner seems fine".

Choosing the tool:
- give_hint: they are stuck on their code and the observer has noticed, or \
they asked for help with it.
- explain: they asked about an idea, not about their own code.
- ask_question: they asked to simply be told the answer. Do not refuse flatly, \
that reads as obstinate: ask ONE concrete question about their own code instead.
- translate_error: an error you were not told the meaning of.
- confirm_success: they solved it. Confirm in one sentence, then usually ask \
why it worked. If it connects to something they struggled with earlier, say so.
- stay_silent: see above.
- If they ask something unrelated, answer honestly in one sentence and bring \
them back. Dismissing them costs more trust than the digression costs focus.
"""

#: Turns of conversation shown to the model. The client keeps more.
THREAD_TURNS = 8
#: A teacher turn can be long; the model needs the gist, not the whole thing.
TURN_CHARS = 320


def render_profile(p: LearnerProfile | None) -> list[str]:
    """A few lines about who this is. Empty when there is nothing to say yet:
    a first-time learner has no profile, and inventing one would be worse."""
    if p is None:
        return []
    out: list[str] = []
    if p.total and p.solved:
        out.append(f"Solved {p.solved} of {p.total} exercises so far.")
    if p.comfortable:
        out.append(f"Came easily: {', '.join(p.comfortable)}.")
    if p.struggled:
        out.append(f"Took real effort: {'; '.join(p.struggled)}.")
    if p.recurring:
        out.append(f"Keeps making the same mistake: {'; '.join(p.recurring)}.")
    if p.begs >= 3:
        out.append(f"Often asks to simply be told the answer ({p.begs} times).")
    return out


def _clip(s: str, n: int = TURN_CHARS) -> str:
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def build_context(r: TeachRequest) -> str:
    """The user message. Every line here is paid for on every call."""
    lines: list[str] = []

    head = f"EXERCISE ({r.exercise_section}): " if r.exercise_section else "EXERCISE: "
    lines.append(f"{head}{r.exercise_prompt}")
    if r.exercise_concept:
        lines.append(f"It is about: {r.exercise_concept}.")
    lines.append(f"It should print exactly:\n{r.expected_stdout}")
    lines.append("")

    profile = render_profile(r.profile)
    if profile:
        lines.append("WHO THEY ARE SO FAR:")
        lines.extend(f"- {p}" for p in profile)
        lines.append("")

    buf = r.buffer.split("\n")[:30]
    numbered = "\n".join(f"{i + 1}| {t}" for i, t in enumerate(buf))
    lines.append(f"THEIR CODE RIGHT NOW:\n{numbered}")
    lines.append("")

    if r.last_run is None:
        lines.append("LAST RUN: they have not run it yet.")
    elif not r.last_run.ok and r.last_run.error:
        e = r.last_run.error
        lines.append(f"LAST RUN: {e.type} on line {e.line}: {e.message}")
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
        mark = "  <-- you are here: the ceiling on what you may reveal" if i == r.tier else ""
        lines.append(f"  tier {i}: {t}{mark}")
    lines.append("")

    if r.recent:
        lines.append("THE CONVERSATION ON THIS EXERCISE SO FAR (oldest first):")
        for x in r.recent[-THREAD_TURNS:]:
            who = "you" if x.role == "teacher" else "them"
            lines.append(f"  {who}: {_clip(x.text)}")
        lines.append("")

    if r.previous_hint_failed:
        lines.append(
            "YOUR LAST HINT DID NOT LAND: their code is unchanged since you gave it. "
            "Do not say it again. Come at it from a different angle."
        )
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
