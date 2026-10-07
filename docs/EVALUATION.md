# Evaluating the teacher

The project began as a proof of concept for one claim: **an observer watching
the edit stream can distinguish "stuck" from "thinking" well enough that a
teacher speaking on that signal feels helpful rather than intrusive.** That
claim is still the thing most worth measuring, because everything else — the
explanations, the memory, the profile — only matters if the teacher speaks at
the right moments.

## The test

Not "it runs". Three people who cannot code, fifteen minutes each. Count:

- times the teacher spoke while they were mid-thought
- times they sat visibly stuck while it stayed silent
- whether anyone reached the accumulator exercise without reaching tier 5

Both of the first two near zero, and at least one person clearing the
accumulator exercise, means the premise holds.

## What to look at

Open the observer panel (**Observer** in the top bar) while they work, and keep
the exported session logs: every event with a millisecond offset, plus the
configuration in force when it was recorded. With accounts enabled, sessions are
also written to the `sessions` table automatically.

Read a log by asking, for each time the teacher spoke: what was the learner doing
in the ten seconds before? And for each stretch of silence over ~45s: were they
stuck or thinking? Raise the threshold or lengthen the ramps if it interrupts
thinking; do the opposite if it misses stuck.

## What changed since the proof of concept

The teacher is no longer a fixed ladder with a phrasing layer. It remembers the
conversation, knows the learner's history, and can explain. That makes this
comparison harder, not easier: two learners can now get different help, so a
good result is a statement about the whole system, not about the observer alone.
To isolate the observer, run with `LLM_API_KEY` blank — every hint is then the
pre-written rung, and the only thing deciding *when* is the observer.
