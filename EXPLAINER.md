# Explainer

What this project is, what it is built from, how you work on it, what happens
during a session, and the ideas it relies on. [ARCHITECTURE.md](ARCHITECTURE.md)
is the structural reference; this document is the one to read first.

---

## 1. What it is

A browser IDE for someone writing their first Python program, with a teacher
embedded in the editor. The teacher:

- watches how the learner edits, not just what they run;
- speaks only when the learner appears **stuck** — not when they are thinking;
- climbs a five-rung hint ladder rather than answering;
- never writes into the learner's buffer.

It is a proof of concept for one claim: *an observer watching the edit stream
can distinguish "stuck" from "thinking" well enough that a teacher speaking on
that signal feels helpful rather than intrusive.* Everything in the codebase
either tests that claim or keeps the lesson running while it is tested.

The lesson content is deliberately tiny — four exercises on one idea, `for`
over a list building up to an accumulator — so that the observer, not the
curriculum, is what gets evaluated.

---

## 2. Tech stack

### Frontend (browser)

| Piece | Version | Role |
|---|---|---|
| **TypeScript** | 5.7 | everything under `src/`; `strict`, `verbatimModuleSyntax` |
| **React** | 18.3 | UI shell — panes, lesson bar, dev panel |
| **Vite** | 6 | dev server, HMR, bundler, `/api` proxy, ES-module worker output |
| **CodeMirror 6** | `@codemirror/*` 6.x | the editor: Python syntax, keymaps, and the extension API the observer and teacher widget plug into |
| **Zustand** | 5 | one small store for lesson/UI state |
| **Pyodide** | 0.27.2 | CPython compiled to WebAssembly; runs learner code in the browser |
| **Comlink** | 4.4 | turns the Web Worker into an `await`-able object |

### Backend (local server)

| Piece | Version | Role |
|---|---|---|
| **Python** | 3.13 | |
| **FastAPI** | 0.141 | four endpoints; one streams |
| **uvicorn** | 0.53 | ASGI server, `--reload` in dev |
| **pydantic** | 2.13 | request/response validation |
| **openai** (SDK) | 3.14 | `AsyncOpenAI` against any OpenAI-compatible endpoint |
| **python-dotenv** | 1.2 | loads `.env` |

### LLM

Any OpenAI-compatible chat endpoint with **tool calling**. Default is Groq with
`openai/gpt-oss-120b`; `.env.example` shows Ollama and Gemini. The model is
never asked for prose — it is asked to call exactly one of five tools.

### Testing

| Piece | Role |
|---|---|
| **Node 20** + Pyodide | unit tests load the same Python harness the worker ships |
| **esbuild** (via `npx`) | bundles the one TypeScript unit test |
| **puppeteer-core** 24 | drives a real Chrome against the real dev server |

No test framework: each suite is a script that prints `PASS`/`FAIL` lines and
exits non-zero on failure. `tests/run.mjs` sequences them.

---

## 3. Workflow

### First-time setup

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install fastapi "uvicorn[standard]" openai python-dotenv
cp .env.example .env      # then fill in LLM_API_KEY
```

### Day-to-day

```bash
npm run dev     # terminal 1 — Vite on http://localhost:5173
npm run api     # terminal 2 — uvicorn on http://127.0.0.1:8000
```

`npm run dev` first runs `scripts/copy-pyodide.mjs`, which copies five files
from `node_modules/pyodide` into `public/pyodide/`. That directory is
gitignored and regenerated; never edit it.

Vite proxies `/api/*` to the backend, so the frontend only ever talks to its
own origin. **The backend is optional for development**: with it down, the
editor, execution, observer and the whole hint ladder still work — hints are
just the pre-written text instead of adapted phrasing, and the top bar says so.

### Switching the model or provider

Edit three lines in `.env`:

```
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=llama3.1
```

Restart `npm run api`. Nothing else references the provider.

Before trusting a new model, run the reliability gate:

```bash
npm run validate-tools                     # default model
.venv/bin/python -m server.validate_tools some/other-model
.venv/bin/python -m server.validate_tools --probes   # skip the 30-call burst
```

It fires 30 identical `give_hint` requests and reports what fraction came back
as valid tool calls. Below 95 %, the schema needs simplifying or the model is
not suitable. It then runs five behaviour probes to check that `stay_silent`,
`ask_question`, `confirm_success` and `translate_error` are all reachable.

### Testing

```bash
npm test            # everything — needs both servers up and Chrome installed
npm test unit       # harness, ast, diagnose, observer — no browser, no network
npm test browser    # phase1..phase45
npm test phase2     # one suite
```

The phase 1 and 2 browser suites save a screenshot to `.artifacts/`.

### Tuning the observer

This is the actual work of the project. Open the app, click **Observer** to
show the dev panel, and watch:

- the live stuck score and every signal contributing to it, signed;
- the gate verdict and *why* it is shut (`score 0.41 ≤ 0.60`, `cooldown 32s`,
  `budget spent`);
- the last 20 events (edits with their semantic verdict, runs, idle
  milestones, asks, gate firings);
- the teacher's state, where its words came from, and the reason for its last
  silence or discard;
- a slider for every weight and threshold in `src/observer/config.ts`.

**Export log** downloads the session as JSON — every event with a millisecond
offset plus the config in force. That file is the evidence the PoC is meant to
produce. **Reset session** clears the log and gate state without reloading.

To change a default permanently, edit `DEFAULT_CONFIG` in
`src/observer/config.ts`; the sliders read their ranges from `CONFIG_FIELDS`
in the same file.

### Linting the hint ladder

The hand-written hints must obey the same rule the model does: nothing below
tier 5 may spell out the answer. To check an exercise's five texts:

```bash
curl -s localhost:8000/api/check-ladder -H 'content-type: application/json' \
  -d '{"tier_texts": ["…","…","…","…","…"]}'
```

It returns the fragments derived from tier 5 and which earlier tiers leak them.

### Building

```bash
npm run typecheck   # tsc -b --force
npm run build       # tsc -b && vite build → dist/
```

---

## 4. How a session works

Follow one learner through exercise 3 ("Add them all up").

### 4.1 Boot

`main.tsx` renders `App`. Importing `exec/runner.ts` constructs the
`PythonRunner` singleton, which spawns the Web Worker immediately. The worker
fetches `/pyodide/pyodide.mjs`, loads the WebAssembly runtime, hooks stdout and
stderr into a buffer, makes `input()` raise `EOFError`, and executes the three
Python harnesses. Status goes `booting → idle`; the top bar says "ready".

Meanwhile `App` tells the observer which lines are the starter (so they never
count as learner-written), starts the 250 ms tick, seeds the AST baseline from
the starter, and fetches `/api/health` once.

### 4.2 The learner types

The buffer starts as:

```python
nums = [3, 7, 12, 5]

for n in nums:
    print(n)
```

They change line 4 to `total = 0`, then add `total = total + n` below it. Each
keystroke is a CodeMirror transaction; the observer's update listener records
which lines were touched and the net character delta, but does not log yet.
When typing pauses for 700 ms the batch closes: one `edit` event with
`linesChanged: [4, 5]` and `charDelta: +23`.

The observer then asks the worker for an AST snapshot and compares it with the
baseline. The structure changed, so the verdict is `changed`, the cosmetic
streak resets to 0, and — because a recent `changed` edit subtracts from the
score — the score stays near zero. The learner is working; the teacher is
silent.

### 4.3 They run it

Ctrl+Enter. `App.handleRun` sends the source to the worker. Pyodide compiles
and executes it in a fresh namespace, captures `5` on stdout, and returns
`{ok: true, stdout: "5\n"}`. No error — but `submitRun` compares the output to
`expectedStdout` (`27`) and finds it wrong.

Three things happen, in order:

1. `observer.recordRun(result, correct=false)` — the observer now knows the last
   run was **clean but wrong**, which is its own signal.
2. `runner.diagnose(source)` walks the AST and finds
   `accumulator-init-inside-loop` on line 4: `total` is set to a constant and
   accumulated inside the same loop. The exercise's `watch` list has a note for
   that id: *"Total reset on every pass. Runs clean, prints the last number."*
3. `attempts` becomes 1. The tier stays at 1 because no hint has been given yet.

### 4.4 They stall

They stare at the output. No keystrokes. Every 250 ms the observer recomputes:

```
+0.00  Idle after wrong answer   ramp starts at 4 s …
+0.35  Idle after wrong answer   ran clean but wrong 22s ago, untouched since
+0.70  Idle after wrong answer   ran clean but wrong 40s ago, untouched since
```

Around 35 s the signal passes the 0.6 threshold (it reaches its full 0.7 at
40 s). The gate checks: cooldown is clear (nothing has fired yet), budget
is 8/8. **Allowed.** It logs a `gate` event, starts the 45 s cooldown, and calls
`requestTeaching('gate')`.

### 4.5 The teacher is asked

`bridge.ts` assembles a context: the numbered buffer, the last run (clean,
printed `5`, expected `27`), the misconception note, `last_edit_ms_ago: 41000`,
`stuck_score: 0.70`, the current tier (1) alongside all five tier texts, and
`trigger: 'gate'`. It POSTs to `/api/teach` and starts reading the SSE stream.

Server side, the cache misses. `llm.complete()` sends the system prompt, the
context, and the five tool schemas with `tool_choice="required"`. The model
answers with a `give_hint` call:

```json
{"tier": 1, "text": "Every time the loop goes round, everything inside it starts again from scratch. Where does the running total need to live so it survives from one pass to the next?", "target_line": 4}
```

As the arguments stream in, the server pulls the `text` value out of the
half-written JSON and forwards it as `delta` events. The client opened a
speech widget on the first `tool` event and is now revealing text at four
characters per 12 ms.

When the call completes, `sanitise()` checks it: known tool, required
arguments present, `tier` equals the tier we sent, and the prose does not
contain any fragment that only tier 5 may say (`total = 0`, `total = total +
n`, `print(total)`, or "total" within 40 characters of "0"). Clean. The server
caches it and sends `done`.

### 4.6 Applying the answer

Back in the browser, `bridge.ts` checks that the buffer has not materially
changed since the request was built — line 4 is the same, no big net edit, same
line count. It finalises the speech: `targetLine: 4`, `source: 'llm'`. Line 4
gets an amber background and the hint sits as a block widget directly beneath
it. `hintsGiven` becomes 1, `recent` records the exchange, and the gate's
budget drops to 7.

Had the learner started typing during those two seconds and changed line 4,
the answer would have been thrown away and the dev panel would show
*"discarded — the buffer moved on (v14 → v17)"*.

### 4.7 The ladder climbs

They move `total = 0` above the loop but leave `print(total)` inside it. Run:
prints four lines, wrong. Because a hint has now been given, the tier climbs
to 2. The diagnoser flags `accumulator-printed-inside-loop`. When the observer
next opens the gate (after the 45 s cooldown, if the score is still high), the
teacher speaks at tier 2 — "the line" — with the new misconception note in its
context.

At tier 4 a third pane appears: a read-only worked example of a running total
over a *different* list, with comments on where each line sits. Tier 5 walks
through the exact lines to type, and is the only rung allowed to.

### 4.8 They ask

At any point they can type in the ask box: *"why does it print four times?"*
This is `trigger: 'ask'`. It resets the cooldown, costs no budget, and the
prompt tells the model it must answer rather than stay silent. If the question
matches the begging pattern (*"just tell me the answer"*), it counts; every
third one moves them down a rung — not a refusal, but not free.

### 4.9 Success

`print(total)` moves out of the loop. Run: `27`. `submitRun` marks the exercise
solved, clears any speech, and calls `requestTeaching('success')`. The teacher
confirms in one sentence and asks why it worked. A banner appears; the lesson
bar's dot fills with the accent colour.

---

## 5. Concepts

### 5.1 Running Python in the browser — and surviving it

**Pyodide** is CPython compiled to WebAssembly. Learner code runs at native-ish
speed with the real standard library, and nothing leaves the machine.

It runs inside a **Web Worker**, not the page. Python is synchronous; a
`while True:` never yields, and nothing on the same thread can interrupt it.
On the main thread that would freeze the tab. In a worker, the main thread
stays responsive and can call `worker.terminate()`, which is the *only* way to
kill a running interpreter. The runner then boots a replacement so the learner
is never without Python. Stop is not "cancel"; it is "kill and replace."

**Comlink** wraps the worker's `postMessage` in a proxy, so the main thread
writes `await api.run(source)` instead of managing message ids.

Pyodide is **self-hosted** (`public/pyodide/`) rather than loaded from a CDN,
and loaded by runtime URL rather than `import`. Both are to keep the JS glue
and the `.wasm` from ever disagreeing about versions, and to keep Vite's
dependency pre-bundler away from Pyodide's feature-detection code.

### 5.2 Structured results and learner-only line numbers

The worker never returns raw traceback text. It returns `{ok, stdout, error:
{type, message, line}}`. The `type` is the Python exception class, which the
error dictionary keys on. The `line` is resolved by walking the traceback and
keeping the deepest frame whose filename is `<learner>` — the harness's own
frames are skipped, so a beginner never sees a line number from code they did
not write.

### 5.3 Edit batches, not keystrokes

A signal like "the same line edited four times" has to mean four separate
*visits* to that line, not four characters typed on it. So raw CodeMirror
transactions are accumulated and only logged as one `edit` event when typing
pauses for 700 ms. Programmatic edits (swapping in an exercise's starter) are
tagged with a CodeMirror **annotation** and skipped; otherwise a whole-buffer
replacement would look like thrash across every line.

### 5.4 The stuck score

A number in `[0, 1]`, **recomputed from scratch every 250 ms** from the event
log — not carried as a decaying accumulator. Positive signals push toward
stuck; progress signals subtract. Each term is named and inspectable in the dev
panel, which a single accumulated number would not allow.

Positive (toward stuck), with defaults:

| Signal | What it measures | Weight |
|---|---|---|
| Idle after error | no edits since a failed run; ramps 4 s → 40 s. Not windowed: four minutes on an error is *more* stuck than one | 0.70 |
| Idle after wrong answer | same, but the run was clean and the output wrong | 0.70 |
| Thrash — same line | one line touched ≥ 4 times in 30 s | 0.30 |
| Thrash — made and undone | the buffer hashed back to a state it was in within 30 s | 0.20 |
| Thrash — same error again | consecutive runs failing with the same type on the same line | 0.15 |
| No semantic change | consecutive edit batches that did not change the AST (renames count half) | 0.30 |
| Empty-buffer silence | ≤ 25 learner characters and idle; ramps 25 s → 75 s. "Don't know where to start" is a different state from silence over half-written code | 0.65 |

Negative (toward fine):

| Signal | Weight |
|---|---|
| Solved it — a correct run in the last 60 s, decaying | −0.80 |
| Program changed — a `changed` edit in the last 60 s, decaying | −0.25 |
| Typing forward — ≥ 20 net characters in 15 s | −0.30 |

Two helpers shape these: `ramp(x, start, full)` is 0 below `start`, 1 at
`full`, linear between; `ageDecay(age, span)` is 1 when fresh, 0 after `span`.

### 5.5 The gate

The score alone does not open the teacher's mouth. `evaluateGate` requires all
of:

- **score > threshold** (0.6), *or* the **hard idle ceiling** (180 s of nothing
  at all — a score that low after that long means the observer missed
  something);
- **cooldown** elapsed (45 s since the teacher last spoke or the gate last
  fired);
- **budget** remaining (8 interruptions per session).

When the gate fires, the cooldown starts immediately (so it cannot fire again
while the request is in flight) but the budget is only charged if the teacher
actually speaks. If it chooses `stay_silent`, nothing was interrupted and
nothing is charged. Learner questions bypass the gate entirely: they reset the
cooldown and cost nothing.

### 5.6 Semantic diffing by AST

"Edits are happening but nothing is changing" needs a definition of *change*.
Text diffs cannot give one — adding a blank line, a comment, or retyping a line
as it was all look like edits. So every batch is parsed in the worker and
compared structurally:

- `dump` = `ast.dump(tree)`. Identical → **cosmetic**.
- `shape` = the same dump after renaming every non-builtin identifier to
  `v0, v1, …` in order of first appearance (α-renaming / canonicalisation).
  Identical shape but different dump → **rename**.
- Different shape → **changed**.
- Does not parse → **unparseable**, which leaves the streak alone: beginners'
  code fails to parse most of the time, so it is weak evidence either way.

The baseline is the last *parseable* snapshot, so a fix is judged against the
last state that meant something. A generation counter drops snapshots that
were in flight when the worker restarted or the exercise changed.

### 5.7 Misconceptions as AST shapes

Several beginner mistakes produce **no error at all** — an accumulator reset
inside the loop runs clean and prints the last number. An error type cannot
find those. Only the shape of the code can, so `DIAGNOSE_HARNESS` pattern-
matches the AST for seven known failure modes (listed in ARCHITECTURE §5.3).
Each exercise declares which of them it actually provokes and what each means
in prose; only those notes reach the teacher, so the model is told *"Total
reset on every pass"* rather than left to infer it.

### 5.8 The hint ladder

Five rungs per exercise, hand-written, each revealing strictly more than the
last:

1. **a nudge** — what kind of thing is missing
2. **the line** — where to look
3. **the concept** — why it is wrong
4. **a worked example** — the same shape on a different problem, in a read-only
   scratch pane
5. **walk it through** — the exact lines to type, still typed by the learner

The tier is **owned by the client**, not the model. It climbs on each failed run
once a hint has been given, and every third "just tell me" also climbs it. The
model is told the current tier, shown all five texts so it can see where the
ladder is going, and instructed to say no more than the current rung does.
Its job is the *phrasing* — real line numbers, the learner's actual variable
names — not the pedagogy.

### 5.9 The teacher as a tool-calling model

The model never returns free prose. It must call exactly one of:

| Tool | When |
|---|---|
| `give_hint` | the observer opened the gate and the learner really is stuck |
| `ask_question` | they asked for the answer outright — redirect with one concrete question |
| `translate_error` | an error the dictionary did not recognise |
| `confirm_success` | they solved it — confirm, then ask why it worked |
| `stay_silent` | they are mid-thought, progressing, or one step from working |

`stay_silent` is the important one. Without it the model always says
something, because saying something is what it has been asked to do. The
system prompt makes it mandatory when the learner typed in the last 10 seconds
(the exception being a direct question), and the `reason` it gives is shown in
the dev panel for the human tuning the system.

The schemas are deliberately **flat**: no nesting, no union types, optional
fields omitted rather than `null`. An earlier version with
`["integer", "null"]` produced malformed JSON on ~7 % of calls.

### 5.10 Defence in depth against giving the answer

"Never give the answer before tier 5" is the product, so it is enforced in
three places rather than requested once:

1. **The prompt** says so, with examples of what not to write.
2. **`sanitise()`** clamps the returned tier to the requested one — the model
   cannot skip rungs by lying about which rung it is on.
3. **`leakguard`** reads the prose itself. From the exercise's own tier-5 text
   it extracts code fragments (assignments, calls) and (variable, number) pairs.
   Below tier 5, any fragment appearing verbatim — or a variable name within 40
   characters of its initial value, which catches *"the line that sets total to
   0"* — rejects the response and the pre-written hint is used instead. Nothing
   is configured per exercise; the ladder defines its own forbidden set.

The same guard is exposed as `/api/check-ladder` so the hand-written hints can
be linted by the rule the model is held to.

### 5.11 Streaming and the paced reveal

The server streams **Server-Sent Events** (`tool`, `delta`, `fallback`,
`done`). To emit `delta`s before the tool call finishes, `llm.py` scans the
half-written JSON arguments for the prose field and extracts the string value
as far as it has arrived, unescaping as it goes.

In practice Groq delivers a tool call's arguments in one or two chunks, so the
text would land as a wall. The client therefore paces the reveal itself — four
characters every 12 ms — regardless of how the deltas arrived. Cached replies
are replayed through the same event sequence with small sleeps so the client
has exactly one code path.

### 5.12 Staleness

A response takes one to four seconds and the learner keeps typing. Each
request carries a monotonically increasing `doc_version`; when the answer
arrives, the buffer it was built from is compared with the current buffer. If
the target line changed, the net length moved by more than 12 characters, or
the number of non-blank lines differs, the answer is discarded — a tutor
confidently explaining a bug that was already fixed costs more trust than five
missed interventions.

### 5.13 Dictionary before model

Most beginner errors have a fixed plain-English reading. `errors.py` is a list
of `(exception type, regex, template)` rules — `IndentationError: expected an
indented block after 'for'` → *"The lines that belong inside your for need to
be pushed in from the left."* It runs on every failed run, costs nothing, is
never wrong, and is not gated by the observer: it is making the output
legible, not interrupting anyone. Only errors that fall through are worth a
model call.

### 5.14 Graceful degradation

Every failure lands on the pre-written ladder: server down, provider 429 or
5xx, malformed tool call, wrong tier, leaked answer, daily token cap. The
response's `source` field (`llm` / `prewritten` / `lookup`) and `note` tell the
UI what happened, and `/api/health` carries the provider's last outcome so the
top bar can say *"hints: pre-written · daily token cap reached"*. A tester who
cannot see the degradation will evaluate the wrong system.

Retries are short on purpose — at most two, and never waiting more than 3 s on
a `retry-after` — because a learner is waiting, and a slow correct hint is
worse than an instant pre-written one.

### 5.15 Response caching

The teacher's reply is a pure function of `(model, system prompt, context)`,
so identical context replays from disk (`server/.cache/`). Tuning the observer
means sending near-identical context hundreds of times against a free tier's
daily cap of roughly two sessions' worth of tokens. `LLM_CACHE=0` turns it off.

### 5.16 Provider abstraction

`server/llm.py` is the only file that imports `openai` or reads `LLM_*`. It
targets the OpenAI chat-completions wire format, which Groq, Ollama, Gemini and
most hosted providers speak. Switching is three environment variables, and
`validate_tools.py` exists to check that a candidate actually returns valid
tool calls before anything is built on it.

### 5.17 Keeping React out of the hot path

Keystrokes, ticks and events are high-frequency. They live in module-level
state (`observer.ts`, `log.ts`, `config.ts`) and reach React only through
`useSyncExternalStore` snapshots taken on the tick. The Zustand store holds the
low-frequency lesson state — tier, attempts, speech, solved — that components
actually render from. Nothing re-renders because the log grew.

### 5.18 The teacher lives inside the editor

Speech is not a sidebar. It is a CodeMirror block widget placed directly under
the line it is about (or under the last line when there is no target), with
the target line tinted amber — never red, because half of these are not
errors. The widget patches its own DOM as text streams in rather than being
recreated, so it does not flicker. The learner's buffer is never modified; the
worked example at tier 4 goes in a separate, read-only pane labelled *"yours to
copy, not to run."*

### 5.19 Evidence, not vibes

The point of the PoC is a measurement. The exported session log is a timeline
of every edit (with its semantic verdict), run (with correctness), silence
milestone, question, and gate decision (with the score and the reason), plus
the configuration in force. The success criteria in the README — how often the
teacher spoke mid-thought, how often it stayed silent while someone was visibly
stuck, whether anyone cleared exercise 3 before tier 5 — are all answerable
from that file plus a stopwatch and a human watching.
