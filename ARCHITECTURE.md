# Architecture

Teaching IDE is a browser Python editor with a teacher inside it. Twenty small
exercises take a complete beginner from `print` to functions. An **observer**
watches how the learner works and decides *when* the teacher may speak; a
**teacher** (a language model behind a set of guards) decides *what* to say.

This document describes how the system is built: the processes, the modules,
the contracts between them, and what happens when something fails. For the
reasoning behind the design see [EXPLAINER.md](EXPLAINER.md); for setup and
deployment see [README.md](README.md); for how to measure whether the teacher
speaks at the right moments see [docs/EVALUATION.md](docs/EVALUATION.md).

---

## 1. Principles

These explain most of the decisions below.

1. **The lesson never stalls.** Every failure path ends in either a hand-written
   hint or deliberate silence with a recorded reason. A slow, dead,
   rate-limited or wrong model must not leave a learner staring at nothing.
2. **Teaching is free; the answer is not.** The teacher may explain any idea. It
   may not hand over the solution to the exercise in front of the learner, and
   that is enforced in code, not only requested in a prompt.
3. **When to speak and what to say are separate problems.** The observer is
   deterministic and tunable. The teacher is probabilistic and guarded. Neither
   can bypass the other.
4. **Learner code never touches the server.** Python runs in the learner's own
   browser tab, in a disposable worker.
5. **Everything optional is optional.** With no Supabase project there are no
   accounts. With no model key there are only hand-written hints. With the API
   down the editor, the observer and the whole hint ladder still work.
6. **The model proposes, the server disposes.** Whatever the model returns is
   validated, clamped to the ladder position the client chose, and checked for
   leaks before anyone sees it.

---

## 2. System overview

```
┌────────────────────────────────── BROWSER ───────────────────────────────────┐
│  main thread: React 18 + Zustand + CodeMirror 6                                │
│                                                                                │
│   keystrokes   ┌────────┐ edit batches ┌──────────┐  250 ms tick  ┌──────┐     │
│  ────────────► │ editor │ ───────────► │ observer │ ────────────► │ gate │     │
│                └───┬────┘              └────┬─────┘               └──┬───┘     │
│        speech      │ Run                    │ AST snapshots          │ fires   │
│        widget ◄────┼────────────────────────┼────────────────────────┤         │
│                    ▼                        │                        ▼         │
│              ┌──────────┐ Comlink RPC       │                  ┌──────────┐    │
│              │  runner  │ ◄─────────────────┘                  │  bridge  │    │
│              └────┬─────┘                                      └────┬─────┘    │
│                   │                                                 │          │
│   auth + data (Supabase client, optional)   voice (MediaRecorder)   │          │
└───────────────────┼─────────────────────────────────────────────────┼──────────┘
                    ▼                                                 │ SSE
   ┌────────────────────────────┐                                     ▼
   │ WEB WORKER: Pyodide        │       ┌────────────────────────────────────────┐
   │ (CPython compiled to WASM) │       │ FASTAPI, one process, port 8000        │
   │  _teaching_ide_run         │       │  POST /api/teach           (SSE)       │
   │  _teaching_ide_ast         │       │  POST /api/translate-error             │
   │  _teaching_ide_diagnose    │       │  POST /api/transcribe      (voice)     │
   └────────────────────────────┘       │  POST /api/check-ladder                │
                                        │  GET  /api/health                      │
   ┌────────────────────────────┐       │  serves the built app (dist/)          │
   │ SUPABASE (optional)        │       └───────────────────┬────────────────────┘
   │  Auth, Postgres            │                           │ OpenAI-compatible
   │  progress, sessions (RLS)  │                           ▼
   └────────────────────────────┘          Groq (chat + Whisper) / Ollama / Gemini
```

**Main thread** owns the UI, the observer and all lesson state. It never runs
learner code.

**Web Worker** hosts Pyodide. It is the only place learner Python executes, and
it is disposable: Stop terminates it and boots a fresh one.

**FastAPI** is the teacher's voice. It turns a context snapshot into one tool
call from a model, validates it and streams it back. It can also serve the built
app as one process on one origin; deployed, the page is on Vercel and this runs
alone on Render (section 16).

**Supabase** is optional. The browser talks to it directly for sign-in, saved
progress and session logs; the server only verifies the token it issues.

---

## 3. Repository layout

```
src/
  exec/                 learner code, in a worker
    pyodide.worker.ts     boots Pyodide, captures output, exposes 4 RPC methods
    runner.ts             main-thread singleton: run / stop / restart / snapshot
    harness.ts            three Python programs shipped into the worker at boot
  observer/             stuck detection
    observer.ts           module state, edit batching, 250 ms tick, snapshot
    score.ts              pure: events -> {score, contributions}
    gate.ts               pure: score + cooldown + budget -> verdict
    semantics.ts          AST baseline; cosmetic / rename / changed; "has started"
    log.ts                event log (module-level array) + JSON export
    config.ts             every weight and threshold, live-tunable
    annotations.ts        CodeMirror annotation marking app-driven edits
    types.ts              Event union, Contribution, SemanticVerdict
  lesson/               content and progression
    exercises.ts          20 exercises x 5 hint tiers; isCorrect(); indexOfExercise()
    courses.ts            the course page's catalogue: Python, and the ones to come
    teaching.ts           submitRun, askTeacherQuestion, goToExercise, resumeCourse, leaveLesson
    profile.ts            pure: per-exercise stats -> who this learner has been
  teacher/              talking to the server
    bridge.ts             requestTeaching: assemble, stream, validate, apply, fall back
    client.ts             fetch + hand-rolled SSE parser; translateError
    escalation.ts         pure: did the last hint land? (unchanged code -> climb)
    plain.ts              pure: takes the long dash out of teacher text
    health.ts             /api/health -> degraded flag for the top bar
  auth/                 supabase.ts (client, null if unconfigured), session.ts (lifecycle,
                        sign-in/up, password reset), access.ts (who may see a page),
                        guest.ts ("Continue as guest", per tab)
  pages/                one file per route: SignInPage, ResetPasswordPage, CoursesPage, CoursePage
  data/                 progress.ts (per-exercise rows), sessions.ts (event-log recording)
  editor/               Editor.tsx, teacherWidget.ts (speech inside the editor), theme.ts
  ui/                   App chrome and panels
    TopBar (brand, breadcrumb, theme, who is here), Splash, useTitle
    LessonBar, OutputPane, ScratchPane, AskBox, Conversation, AuthBar, DevPanel
    Splitter, useLayout   draggable panes, sizes remembered
    ThemeToggle, theme, prefs   light/dark, per-viewer preferences
    useVoice              microphone capture and transcription
    icons                 inline SVG icons (no third-party font or request)
  store.ts              Zustand store: low-frequency lesson state
  App.tsx, main.tsx     the router (wouter), the access guard, and boot

server/
  main.py               app, /api/teach, sanitise(), replay(), static serving (with
                        the single-page fallback), headers
  models.py             pydantic request/response shapes, with size bounds
  prompts.py            SYSTEM prompt + build_context()
  tools.py              the six tool schemas
  llm.py                the only provider-aware module; retry; streaming; transcribe()
  leakguard.py          answer-leak detection; instruction detection
  quota.py              per-caller rate limits; per-sitting interruption budget
  stt.py                POST /api/transcribe with its own limits
  errors.py             16-rule dictionary: Python error -> plain English
  cache.py              sha256(model + system + context) -> server/.cache/*.json
  auth.py               Supabase JWT verification (anonymous when unconfigured)
  validate_tools.py     30-call tool-calling reliability check

supabase/schema.sql     progress + sessions, both row-level secured
scripts/                copy-pyodide.mjs, verify-supabase.mjs
tests/                  unit (Node + Python) and browser (Puppeteer) suites
docs/EVALUATION.md      how to judge whether the teacher speaks at the right moments
Dockerfile              one image, one process
```

---

## 4. The execution layer (`src/exec/`)

### 4.1 Threading model

```
main thread                          worker
-----------                          ------
runner.run(src)  --Comlink RPC-->    _teaching_ide_run(src)
                                       compile, exec in a fresh namespace
                 <-- RunResult ----    capture stdout/stderr
runner.stop()    --terminate()-->    (gone)
                 spawn() again  -->  boots a new Pyodide
```

- Pyodide is loaded from `/pyodide/` at **runtime** (an `import()` the bundler
  cannot see), then the three harnesses are executed in order.
- `Stop` is a hard `worker.terminate()` plus a transparent respawn. There is no
  interrupt buffer. The pending run resolves with a synthetic `Stopped` result.
- Output is capped at 200,000 characters so `while True: print(x)` cannot take
  the worker down before Stop is pressed. `input()` raises `EOFError` rather
  than hanging, and the error dictionary explains it.
- A run taking over 3 seconds shows a slow-run banner with a Stop button.
- Runner states: `booting | idle | running | restarting | failed`.

### 4.2 The three harnesses (`harness.ts`)

| Function | Returns | Used for |
|---|---|---|
| `_teaching_ide_run(src)` | `{ok, type, message, line}` | Running the learner's code. A fresh namespace per run. `compile()` first, so a `SyntaxError` is distinguished from a runtime error. The reported line is the **last frame inside the learner's file**, never a harness frame. |
| `_teaching_ide_ast(src)` | `{parses, dump, shape}` | The observer. `dump` is `ast.dump`; `shape` is the same tree with learner identifiers renamed `v0, v1, ...` (builtins kept), so equal shape with a different dump means a pure rename. |
| `_teaching_ide_diagnose(src)` | `[{id, line}]` | Spotting beginner misconceptions from the AST (section 6.4). |

`astSnapshot()` and `diagnose()` return `null` while a run is pending, because
learner code owns the worker thread and would never yield.

### 4.3 Contract: `RunResult`

```ts
{ ok: boolean, stdout: string, durationMs: number,
  error?: { type: string, message: string, line: number | null } }
```

Line numbers refer to the learner's own buffer, so a hint can say "line 3" and
be right.

---

## 5. The observer (`src/observer/`)

The observer answers one question every 250 ms: **is this learner stuck, or
thinking?** It never speaks. It produces a number and a verdict.

### 5.1 Data flow

```
CodeMirror transaction
   │  (ignored if annotated programmaticEdit: an exercise swap is not behaviour)
   ▼
edit batch (closed by a 700 ms typing pause)   lines touched, net char delta
   ▼
flushBatch ──► log.append(edit)
   │            ├─ hash the buffer: has it returned to a state seen in the last 30 s?
   │            └─ classify(doc) via the worker's AST ──► changed | cosmetic | rename | unparseable
   ▼
tick (250 ms): computeScore(events, ...) ──► evaluateGate(...) ──► intervene handler
```

Batching matters: "the same line edited four times" must mean four separate
visits, not four characters typed on it.

### 5.2 The stuck score

A number in [0, 1], **recomputed from scratch every tick** from the event log
(not a decaying accumulator), so every contributing term stays individually
inspectable in the dev panel. Defaults:

| Signal | Fires when | Weight |
|---|---|---|
| Idle after error | A run failed and nothing has been edited since. Ramps 4 s to 40 s, never windowed. | +0.70 |
| Idle after wrong answer | The run was clean but the output wrong. Same ramp. | +0.70 |
| Empty-buffer silence | They have not started: no program of their own yet. Ramps 25 s to 75 s. | +0.65 |
| Thrash: same line | One line touched 4 or more times in 30 s | +0.30 |
| No real change | Edits that leave the AST alone (comments, whitespace, renames count half) | +0.30 |
| Thrash: made and undone | The buffer hashed back to a recent state | +0.20 |
| Thrash: same error again | Consecutive runs fail with the same type on the same line | +0.15 |
| Solved it | A correct run in the last 60 s, decaying | -0.80 |
| Typing forward | 20 or more net characters in 15 s | -0.30 |
| Program changed | A `changed` edit in the last 60 s, decaying | -0.25 |

Two subtleties:

- **"Empty" is structural, not a character count.** A finished, correct answer to
  "Add two numbers" is 12 characters. `semantics.hasStarted()` compares the
  buffer's AST to the starter's, so comments and blank lines do not count as
  starting and any real statement does, at any length. The character count is
  only the fallback for a buffer that will not parse.
- **Unparseable is neutral.** Beginners' code fails to parse most of the time, so
  it leaves the non-progress streak untouched and does not replace the baseline.

### 5.3 The gate

The score alone does not let the teacher speak. `evaluateGate` requires all of:

- score above **0.6**, *or* **180 s** of total silence (the only bypass of the score);
- **45 s** since the teacher last spoke or the gate last fired;
- budget left: **8** interruptions per session.

When the gate fires, the cooldown starts immediately so it cannot re-fire while
a request is in flight, but the budget is only charged if the teacher actually
spoke. If the model chooses `stay_silent`, nothing was interrupted and nothing is
charged. A question the learner asks themselves skips the gate, resets the
cooldown and costs nothing.

### 5.4 Event log and configuration

- `log.ts` is a plain module-level array (deliberately outside React state so log
  growth never causes a render). Five event types: `edit`, `run`, `idle`, `ask`,
  `gate`. `exportJson` writes every event with a millisecond offset plus the
  configuration in force.
- `config.ts` holds 27 tunables, all live-editable from the dev panel. Tuning
  the observer is the main empirical work of the project.

---

## 6. The lesson layer (`src/lesson/`)

### 6.1 Content

Twenty exercises in eight sections, each with five hand-written hint rungs and a
`concept` (the topic, never the mechanics, because it goes into the prompt):

| Section | Exercises |
|---|---|
| output | say-hello, two-lines |
| variables | greet-by-name, add-two, rectangle-area, average-three |
| strings | shout-it, full-name, how-long |
| conditionals | is-it-big, pass-or-fail, grade-it |
| lists | first-and-last, how-many |
| loops | print-each, print-doubled, sum-them, count-above-ten |
| dicts | lookup-price |
| functions | make-a-function |

The rungs: **1** a nudge, **2** the line, **3** the concept, **4** a worked
example (in a read-only example pane, on a different problem), **5** a
walk-through that still ends with the learner typing it. Correctness is an exact
stdout match after trimming trailing whitespace. Exercises are addressed by `id`,
never by position, so the ramp can grow without repointing saved progress.

### 6.2 Progression (`teaching.ts`)

- **Tier belongs to the client.** It climbs by one when a run fails *after a hint
  has been given*, and by one on every third "just tell me". It is capped at 5.
- A run that exits cleanly with the wrong output counts as a failed attempt
  (ran without raising is not the same as solved). This is the accumulator
  lesson in one rule.
- `submitRun` re-reads the store after its `await`, and drops the result if the
  learner moved to another exercise meanwhile.
- `goToExercise` saves where they got to, cancels any in-flight teacher request,
  and restores everything remembered about the exercise they are entering.

### 6.3 The learner profile (`profile.ts`)

Pure function from per-exercise stats to the few lines the teacher is given:

| Field | Meaning |
|---|---|
| `solved / total` | Progress |
| `struggled` | Up to 3 exercises that reached tier 3, or took 4+ attempts (most recent) |
| `recurring` | Up to 2 mistakes seen in **more than one** exercise (a habit, not an accident) |
| `comfortable` | Up to 3 sections where everything touched was easy |
| `begs` | Times they asked to simply be told the answer |

Returns `null` for a newcomer, so nothing is invented.

### 6.4 Misconception detectors

Seven AST shapes: `no-loop`, `index-value-confusion`, `range-off-by-one`,
`accumulator-init-inside-loop`, `accumulator-reassigned`,
`accumulator-printed-inside-loop`, `loop-body-outside`. They are all
loop-shaped, so each exercise lists which it `watch`es, and a detection outside
that list is discarded (`no-loop` is true of every exercise before the loops
section).

### 6.5 Did the last hint land? (`escalation.ts`)

If the gate reopens and the buffer is byte-for-byte what it was when the last
hint was given, that hint did not land. The next hint climbs a rung, and the
request carries `previous_hint_failed` so the model is told not to say it again.
A question is answered where the ladder is, not pushed up it.

---

## 7. The teacher, client side (`src/teacher/bridge.ts`)

`requestTeaching(trigger, question?)` is the single entry point, with
`trigger` one of `gate` (the observer fired), `ask` (the learner asked) or
`success`.

```
1  guard: ignore a gate trigger on an exercise already solved
2  abort anything in flight; remember buffer, doc version, exercise index
3  did the last hint land?  (gate only: climb the tier and tell the model)
4  build the request: buffer, exercise + concept + section, tier + all 5 rungs,
   last run (and whether THIS run was correct), misconceptions, observer
   numbers, conversation tail, learner profile, session id
5  POST /api/teach, read the SSE stream
     tool  -> open the speech bubble (kind + tier)
     delta -> reveal text progressively (paced client-side; cosmetic)
6  decision arrives:
     null (network failed)  -> hand-written rung, noted "backend unreachable"
     stay_silent            -> no bubble; the model's reason goes to the dev panel
     exercise changed       -> discard
     buffer materially changed -> discard  (staleness guard)
     otherwise              -> re-key the bubble to the FINAL tool, set text,
                               target line, example, follow-up; record the turn;
                               charge the budget if it was a gate; save progress
```

Notes:

- **The server has the last word on the tool.** The bubble opens on the streamed
  tool name so the reveal can start early, but a guard can replace the model's
  choice with a hand-written rung, so the bubble is re-keyed at the end.
- **Staleness.** An answer arriving against a changed program is discarded: the
  target line's content changed, or the length moved by more than 12 characters,
  or the count of non-blank lines changed, or the exercise became solved while
  in flight. A tutor explaining a bug they already fixed costs more trust than
  five missed interventions.
- **Speech never writes to the buffer.** It renders inside the editor as a block
  widget below the target line (amber, never red, since half of these are not
  errors). An explanation's example goes to the read-only example pane.
- **Cleaning.** All teacher text passes through `plain()`, applied to the whole
  text so far while streaming (a dash and its spaces can arrive split).
- `translateError` is a pure dictionary lookup and is **not** gated, billed or
  counted as an interruption.

---

## 8. Editor and UI

- **Editor.tsx** mounts CodeMirror once, with static extensions (re-mounting
  would destroy the buffer). Exercise changes dispatch a whole-document swap
  tagged `programmaticEdit`; a `bufferEpoch` counter forces the swap when a
  different learner takes over on the same exercise.
- **teacherWidget.ts** keeps speech in a `StateField` and renders it as a block
  widget. Streaming updates patch the existing node, so a hint does not flicker.
- **Layout.** The workspace is code area | splitter | output. The code area is
  editor (and the example pane when open), a splitter, and the **dock** holding
  the conversation and the ask box. Three splitters are draggable (keyboard
  accessible); sizes persist per browser in `teaching-ide:layout`.
- **Conversation.tsx** shows the thread for the current exercise as chat bubbles,
  each teacher turn labelled with what it was (hint and tier, explanation,
  question, success). It opens itself when the learner speaks and shows a
  thinking indicator while a request is in flight.
- **Voice.** `useVoice` records with `MediaRecorder` only while the learner has
  asked, releasing the microphone the moment it stops. The audio goes to
  `/api/transcribe`; the words land in the ask box and are **never sent
  automatically**, because speech-to-text mangles code ("colon" is not "Colin").
- **Themes.** Light and dark, following the OS until a choice is made. Every
  colour is a CSS variable; the editor's syntax colours read the same ones, so
  switching never rebuilds the editor. `index.html` sets the theme before first
  paint.
- **Dev panel.** Closed by default (`teaching-ide:observer`). Live score and every
  contributing signal, the gate verdict and why, the last 20 events, the teacher's
  state and where its words came from, and a slider for each of the 27 tunables.
  Export log downloads the session as JSON.
- **Preferences** (theme, layout, panel) live in `localStorage` and are never
  load-bearing: storage may be blocked or throw.

---

## 9. State ownership

| State | Owner | Read by |
|---|---|---|
| Editor document | CodeMirror `EditorView` | observer (update listener), bridge (`observer.doc()`) |
| `docVersion` | `observer.ts` | bridge (staleness) |
| Event log, score, gate state, non-progress streak | `observer.ts`, `log.ts`, `semantics.ts` | dev panel via snapshot; bridge via `idleMs()` |
| Observer config | `config.ts` (mutable singleton) | score, gate, dev panel sliders |
| Runner status, last result | `runner.ts`, mirrored into the store | App, OutputPane |
| Exercise index, tier, attempts, hints given, solved, misconceptions, seen, begs, conversation, speech, health | Zustand store | components, `teaching.ts`, `bridge.ts` |
| Per-exercise saved rows (ladder, conversation, mistakes) | `data/progress.ts` map, mirrored to Supabase | profile, `goToExercise` |
| Last hint given on each exercise (and the code it was given against) | `bridge.ts` | escalation |
| Speech inside the editor | `speechField` (CodeMirror state) | decoration builder |
| AST baseline, starter structure | `semantics.ts` | `classify()`, `hasStarted()` |
| Rate-limit counters | server memory (`quota.py`, `stt.py`) | `/api/teach`, `/api/transcribe` |
| Response cache | `server/.cache/` on disk | `/api/teach` |

Rule of thumb: high-frequency data (keystrokes, ticks, events) stays in module
state and reaches React through `useSyncExternalStore`; low-frequency lesson
state lives in Zustand.

---

## 10. The server (`server/`)

### 10.1 Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/teach` | The one streaming endpoint (SSE: `tool`, `delta`, `fallback`, `done`) |
| `POST /api/translate-error` | Dictionary lookup, no model, no tokens, no gate |
| `POST /api/transcribe` | Raw audio in, text out (voice questions) |
| `POST /api/check-ladder` | Runs hand-written rungs through the leak and instruction guards |
| `GET /api/health` | Model, key present, cache size, last provider outcome |

Everything else is the built app (`dist/`), mounted last so every `/api` route
wins. The interactive API docs are off unless `ENABLE_DOCS=1`. Every response
carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` and
`X-Frame-Options: DENY`. CORS is configured for the Vite dev origins only; in a
deployment the app and API share an origin, so it never comes into play.

### 10.2 `POST /api/teach`

Request bounds (pydantic): buffer 8,000 characters, conversation 40 turns,
question 1,000 characters, tier 1 to 5.

```
principal = signed-in user, else caller address
hit       = cache.get(sha256(model + SYSTEM + context))
verdict   = quota.check(principal, session, trigger, billable = no cache hit)

refused by budget  -> stay_silent        (the observer is told to be quiet)
refused by rate    -> hand-written rung  (with a "rate limited" note)
cache hit          -> replay the stored decision as a stream
otherwise          -> llm.complete(stream=True, tool_choice="required")
                        forward tool + delta events
                        sanitise(...)
                          rejected -> hand-written rung, event "fallback"
                          accepted -> done; write the cache
```

Refused calls are *answered*, never rejected, so the learner never sees an error
for something that is not theirs. Fallback and hand-written decisions are never
cached.

### 10.3 What the model is told (`prompts.py`)

The system prompt is static and says: you are a patient teacher of a beginner
across a ramp of exercises; teaching is free but the exercise's answer is not;
the current rung is a **ceiling** on what you may reveal, not a script; never
repeat yourself; stay silent when they typed in the last 10 seconds (unless
asked); use the learner's history without mentioning it; plain words, no
exclamation marks, no long dashes.

The per-call context, in order: the exercise and its section and topic; the
learner profile (if any); their code with line numbers (first 30 lines); the last
run; what the code shape suggests; timing from the observer; the current tier and
all five rungs with the current one marked; the conversation so far (last 8
turns, each clipped to 320 characters); a note when the previous hint did not
land; and a trigger-specific closing instruction.

### 10.4 Tools (`tools.py`)

The model never returns free prose; it must call exactly one tool.

| Tool | When | Notes |
|---|---|---|
| `give_hint` | Stuck on their code | `tier` must equal the requested tier; `target_line` is a required integer, 0 for none |
| `explain` | They asked about an idea | `text`, `example` (a different problem), `followup_question`; the last two are required strings, empty when unused |
| `ask_question` | They asked to be told the answer | One concrete question about their own code |
| `translate_error` | An error the dictionary did not know | |
| `confirm_success` | They solved it | Confirm, then usually ask why it worked |
| `stay_silent` | Mid-thought, progressing, one step away | `reason` is for the person tuning the system |

Schemas are deliberately flat. Optional and nullable fields were measured to
fail: the model emits `null` for "no value" however the schema is written, and
the provider rejects the whole call. Required fields with empty-string or
zero sentinels never do.

### 10.5 Guards (`sanitise` and `leakguard`)

`sanitise` runs on every model decision, in order: a tool was called; it is a
known tool; the arguments parsed; required arguments are present;
`give_hint` has text and its tier is **clamped** to the requested one; then:

1. **Instructions at rungs 1 and 2** (`give_hint`, `ask_question`). An action verb
   that opens a sentence or follows a connective ("then add", "try creating") is
   rejected. "Create the total before the loop, then add each number" is the
   whole solution in words, with no code for the next check to find. Concept
   explanations are exempt. The hand-written rungs pass the same rule, and
   `/api/check-ladder` lints them against it.
2. **Leaks** (every tool, over `text`, `plain_english`, `followup_question` and
   `example`). Below tier 5 it extracts code fragments (assignments, calls) and
   (name, value) pairs from the exercise's own tier-5 text, then rejects any
   text containing a fragment verbatim, or a variable name within 40 characters
   of its initial value (which catches "the line that sets total to zero").
   Nothing is configured per exercise: the ladder defines its own forbidden set.

Anything rejected becomes the hand-written rung with the reason as a note.

### 10.6 Limits (`quota.py`)

Per **principal** (signed-in user, else address; `X-Forwarded-For` only if
`TRUST_PROXY=1`), in memory:

| Limit | Default | Kind |
|---|---|---|
| Calls per minute | 10 | Cost control |
| Calls per day | 400 | Cost control |
| Observer interruptions per sitting | 8 | Courtesy |

The first two hold whatever the caller says about itself. The third is keyed by a
session id the **client** chooses, so a client that wants to can rotate it; it
keeps the observer polite to an honest learner and is not protection. Cached
answers skip the rate limits but not the budget. Counters reset on restart and
are per process: more than one worker multiplies them.

### 10.7 Other server modules

- **errors.py**: 16 regex rules across 9 exception types turn a Python error into
  plain English before any model is involved.
- **cache.py**: one JSON file per decision, keyed on model, system prompt and the
  full context. No TTL or eviction. Changing a tool schema does not invalidate it.
- **auth.py**: verification of a Supabase JWT with audience `authenticated`.
  The token's header picks the check: ES256/RS256 against the project's public
  keys (`SUPABASE_URL`, issuer `<url>/auth/v1`, key set cached five minutes and
  refetched on an unknown key id at most every 30 s), HS256 against the legacy
  `SUPABASE_JWT_SECRET`. A public key is never accepted as an HMAC secret. With
  neither configured every call is anonymous; with either, no header is
  anonymous, a valid token yields the user id, a bad token is a 401 (a presented
  identity must verify), and unreachable keys are a 503.
- **stt.py** and `llm.transcribe`: audio is held in memory for the request,
  passed to the provider (Whisper), and dropped; never logged or stored. Limits are
  separate from the teacher's (6 a minute, 150 a day, 4 MB, formats by
  content type), so talking cannot spend the hint budget. The prompt seeds Python
  vocabulary, and segments Whisper itself judges to be silence or repetition are
  discarded, because it invents text such as "Thank you." from noise. It does
  not update the health indicator.

### 10.8 The provider boundary (`llm.py`)

The only module that imports `openai` or reads `LLM_*`. Any OpenAI-compatible
endpoint with tool calling works; switching is `LLM_BASE_URL`, `LLM_API_KEY` and
`LLM_MODEL`.

- Streaming extracts the prose field from half-written JSON arguments so deltas
  can be emitted before the call completes. `stay_silent` has no prose field, so
  silence streams nothing.
- Retries: up to 3 attempts (0.5 s, 1.5 s, jittered) on rate limit, 5xx and
  connection errors only. A `Retry-After` over 3 s is not waited for. There is no
  explicit request timeout.
- `last_outcome` (ok, reason, retry-after) feeds `/api/health` and the top-bar
  "hints: pre-written" notice, with provider limit messages mapped to short
  reasons ("daily token cap reached").

---

## 11. Accounts and persistence (Supabase, optional)

The browser talks to Supabase directly; there is no application server in
between. With `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` unset, the client
is `null`, there is no sign-in page (the app opens on the course page) and
nothing is stored anywhere.

### Pages and access

The app is a small client-side router (wouter). Every path is the same
`index.html`; the production server falls back to it for any path that is not a
file (`SinglePageApp` in `server/main.py`), while a missing file or an `/api`
path stays a real 404.

```
/signin           email + password: sign in, create account, forgot password;
                  or Continue as guest. ?next=<path> is where to go afterwards
/reset-password   where the link in a reset email lands; needs the session that
                  link creates, and says so when there is none
/courses          the catalogue: Python (progress, Start/Continue) and the
                  courses to come, locked
/course/:id       the lesson. An unbuilt or unknown course goes back to /courses
/  and the rest   -> /courses
```

`/courses` and `/course/:id` are behind a guard (`useAccess`, `src/auth/access.ts`):
`pending` until the first auth check settles (a spinner, so a signed-in learner is
never shown the form), `allowed` when they are signed in or have chosen to continue
as a guest, otherwise they are sent to `/signin?next=...`. `next` comes from the URL,
so only a path on this site is followed (`safeNext`); `//host` and the sign-in pages
themselves are refused. With no Supabase project everyone is allowed.

"Continue as guest" is a per-tab choice in `sessionStorage`: a refresh keeps it, a new
tab asks again, a sign-out clears it. A guest has the whole lesson; progress lives in
memory for the sitting, as it always did.

Email confirmation may be on or off in the project. Sign-up returns `{ confirm }`:
false signs them in; true shows "check your email" with a resend. Password reset emails
a link to `/reset-password`, which must be among the project's allowed redirect URLs.

The lesson is a page that comes and goes, and the observer, runner and store are
module-level, so entering and leaving it has to be clean:

- **Arriving** starts the observer's attention from now (`observer.start`), because the
  module loaded with the app, possibly minutes before the lesson did. A run made before
  they left is not "untouched since": the editor comes back at the starter.
- **Leaving** (`leaveLesson`) banks progress for a signed-in learner, drops a teacher
  answer in flight, stops code still running in the worker, and clears what only made
  sense beside the code on screen (the speech bubble, the last run's output). The
  conversation and the ladder are kept, exactly as when moving between exercises.
- **Continue** on the course card (`resumeCourse`) opens the first unsolved exercise
  for someone who has just signed in; a sitting that has already moved is left where it is.

```
progress  (user_id, exercise_id) PK
          solved, tier, attempts, hints_given, begs, seen text[], thread jsonb,
          updated_at (trigger)
sessions  id PK, user_id, started_at, duration_ms, exercise_id,
          config jsonb, events jsonb, event_count, updated_at (trigger)
RLS       both tables: for all using / with check (auth.uid() = user_id)
Grants    authenticated only; the signed-out role has none, so the schema
          works whether or not the project auto-exposes new tables
```

Lifecycle (`src/auth/session.ts`, `src/data/progress.ts`, `src/data/sessions.ts`):

- **Sign-in:** read this user's rows into the store (restoring the current
  exercise's tier, conversation and mistakes), open a session row, and flush the
  observer log every 20 s and when the tab hides. A new account with no rows
  **adopts** what the guest already did.
- **Saving** is skipped until a read has succeeded (an empty store must never
  overwrite real rows). Failures are surfaced ("nothing is being saved", with a
  retry), not swallowed.
- **Sign-out** flushes the session log first (the token is gone by the time the
  auth event fires), then resets everything that belonged to the last learner:
  ticks, ladder, conversation, mistakes, the editor buffer and the observer log.
- A refresh starts a new session row rather than overwriting the old one.

Rows are keyed by exercise `id`, and the `thread` is capped at 40 turns. The
session `events` array is rewritten on every flush, which is fine for sessions of
minutes and would want an append-only table if they grew long.

---

## 12. End-to-end flows

**A stuck learner.** They run `total = 0` inside the loop and get 5, not 27. The
run is clean but wrong: attempts +1, the AST diagnosis flags the misconception.
They stop touching the code. The observer's idle-after-wrong-answer term ramps
from 4 s; at about 0.6 and with cooldown and budget clear, the gate fires. The
bridge builds the request (rung 1, the profile, the conversation so far) and
streams it. The server clears the quota, builds the prompt, and the model calls
`give_hint`. `sanitise` clamps the tier and finds no instruction or leak. The
bridge checks the buffer has not moved, reveals the hint in the editor, records
the turn in the conversation, charges the budget and saves progress. If they
still have not touched the code when the gate reopens, the next hint is rung 2
and the model is told the last one did not land.

**A question.** They type "what does `n` mean?" into the ask box. The question
joins the conversation, resets the cooldown and costs no budget. The model
calls `explain`; the example appears in the read-only pane and the explanation in
the bubble and the conversation.

**A voice question.** They press the mic. The browser records until they stop
(or 60 s), the microphone is released, the audio goes to `/api/transcribe`, and
the transcript appears in the ask box for them to read and edit. Nothing is sent
to the teacher until they press Ask.

**Signing in mid-lesson.** The guest's ticks and conversation are kept if the
account is new; for an existing account its saved state replaces them. Either
way a session row opens and recording starts.

---

## 13. Failure modes

| Failure | Where handled | Outcome |
|---|---|---|
| Infinite loop or runaway output | `runner.stop()`, 200k-character cap | Worker terminated, a fresh one boots, `Stopped` result; slow banner at 3 s |
| `input()` called | Worker stdin returns null | Clean `EOFError`, explained by the dictionary |
| Pyodide fails to boot | `runner.spawn()` | Status `failed`, Run disabled |
| AST snapshot while a run is pending | `runner.astSnapshot` returns null | Verdict `pending`; streak untouched |
| Worker restarts mid-snapshot | `semantics.generation` | Stale snapshot dropped; baseline re-seeded |
| API unreachable | `askTeacher` returns null | Hand-written rung, noted "backend unreachable" |
| Provider 429, 5xx, connection error | `llm._create_with_retry` | Bounded retry, then `fallback` event and a hand-written rung |
| Daily token cap reached | `llm.last_outcome` | Top-bar notice; hints are hand-written until it resets |
| Malformed, unknown or missing tool call | `sanitise` | Hand-written rung with the reason |
| Hint instructs at rung 1 or 2 | `leakguard.instructs` | Hand-written rung |
| Model gives away the answer | `leakguard.leaks` | Hand-written rung naming the fragment |
| Model picks a different tier | `sanitise` | Clamped to the requested tier |
| Per-minute or daily limit | `quota.check` | Hand-written rung, "rate limited" note |
| Interruption budget spent | `quota.check` | `stay_silent` with the reason |
| Answer arrives after the buffer changed | `bridge.materiallyChanged` | Discarded; reason in the dev panel |
| Answer arrives after leaving the exercise | `bridge` index check | Discarded |
| Supabase unconfigured | `supabase === null` | Signed-out mode, nothing stored |
| Progress cannot be read or saved | `data/progress.ts` | Visible notice with retry; no writes until a read succeeds |
| Voice unavailable, blocked or empty | `stt.py`, `useVoice` | A plain message; typing still works |

The invariant: **the lesson never stalls.** Every row above ends in speech from
the ladder or silence with a recorded reason.

---

## 14. Security and privacy

- **Untrusted code is sandboxed in the learner's own tab.** The server never
  executes or sees learner code except as text in a hint request.
- **Secrets stay on the server.** The model key is read only by `llm.py`. The two
  `VITE_` Supabase values are public by design; row-level security protects the
  data, and `scripts/verify-supabase.mjs` checks it against the real project.
- **Rate limits** (section 10.6) bound cost per caller. Capacity beyond that
  comes from the provider's plan.
- **Voice audio is not kept.** It lives in memory for one request.
- **Hardening:** API docs off, security headers, bounded request sizes, and a
  pydantic schema on `/api/teach`.
- **Anonymous use is allowed** by design; an unverifiable token is not.

---

## 15. Configuration

| Variable | Read by | Default |
|---|---|---|
| `LLM_BASE_URL` | `llm.py` | `https://api.groq.com/openai/v1` |
| `LLM_API_KEY` | `llm.py` | empty (all hints hand-written) |
| `LLM_MODEL` | `llm.py` | `llama-3.3-70b-versatile` in code; `.env.example` sets `openai/gpt-oss-120b` |
| `LLM_CACHE` | `cache.py` | `1` |
| `STT_MODEL` / `STT_LANGUAGE` | `llm.py` | `whisper-large-v3-turbo` / detect (`none` switches voice off) |
| `STT_PER_MINUTE` / `STT_PER_DAY` / `STT_MAX_BYTES` | `stt.py` | 6 / 150 / 4 MB |
| `TEACH_PER_MINUTE` / `TEACH_PER_DAY` / `TEACH_GATE_BUDGET` | `quota.py` | 10 / 400 / 8 |
| `TRUST_PROXY` | `quota.py` | `0` |
| `SUPABASE_URL` / `SUPABASE_JWT_SECRET` / `SUPABASE_JWT_AUDIENCE` | `auth.py` | empty / empty (both empty: anonymous) / `authenticated` |
| `ALLOWED_ORIGINS` | `main.py` | the Vite dev origins (deployed: the page's Vercel address) |
| `ENABLE_DOCS` | `main.py` | `0` |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | the browser, **at build time** | empty (signed-out mode) |
| `VITE_API_URL` | the browser (`src/api.ts`), **at build time** | empty (`/api` on the page's own origin) |
| `CHROME` | `tests/run.mjs` | auto-detected |

Observer weights and thresholds are in `src/observer/config.ts`, mutated live from
the dev panel, and are not environment-driven.

---

## 16. Build, run and deploy

| Command | Does |
|---|---|
| `npm run dev` | Vite on :5173, proxying `/api` to :8000 |
| `npm run api` | The API on :8000, reloading on `server/` changes only |
| `npm start` | Build, then one process serving the app and the API on :8000 |
| `npm run build` | Typecheck then Vite build into `dist/` |
| `npm test [suite]` | The test runner (section 17) |
| `npm run verify-supabase` | Round-trips both tables, RLS and the token path against a real project |
| `npm run validate-tools` | 30 live calls: does tool calling work on this model |

**Deployed, the page and the API are apart.** The page is static files on Vercel
(`vercel.json`: `npm ci`, `npm run build`, `dist/`, and a rewrite sending any path
that is not a file and not under `/api` to `index.html`, the same rule as
`SinglePageApp`). The API is a native Python web service on Render (`render.yaml`:
`pip install`, one `uvicorn` process, healthcheck on `/api/health`), with no
`dist/`, so it serves no HTML. The page reaches it at `VITE_API_URL`, and the API
names the page in `ALLOWED_ORIGINS` so the browser accepts its replies. Two things
follow from Render's free plan sleeping the API: the lesson calls `/api/health` as
it opens, which wakes it, and `askTeacher` gives up on a reply that has not started
within 15 seconds, so the learner gets the pre-written rung rather than a minute of
"thinking". The README has the setup order.

The **Dockerfile** is the all-in-one alternative, two stages: Node builds the bundle
(the two `VITE_` values are build arguments), then a slim Python image runs
`uvicorn` on one process as a non-root user, with a healthcheck on `/api/health`.
One process is deliberate, since the limits live in memory.

---

## 17. Testing architecture

`tests/run.mjs` runs named suites, or `unit`, or `browser`. Browser suites drive
real Chrome against the dev server and need `npm run dev` (and `npm run api` for
the live-teacher suite).

| Suite | Kind | Covers |
|---|---|---|
| harness, ast, diagnose | unit (Node + Pyodide) | The exact Python the worker ships: errors and lines, AST verdicts, detectors |
| observer | unit | Every score term, the gate, structural "empty" |
| lesson | unit | Learner profile, did-the-last-hint-land |
| plain | unit | The long dash taken out of teacher text, including across stream chunks |
| auth | unit (Python) | Token handling: anonymous, valid, expired, wrong audience |
| teacher | unit (Python) | Prompt contents, memory, `explain`, sanitising, instruction guard, quotas |
| api | unit (Python) | The HTTP surface with the model stubbed: limits, fallbacks, headers, cross-origin, single origin |
| stt | unit (Python) | Voice limits, formats, provider errors (stubbed) |
| phase1 | browser | Editor and execution, Stop, restart |
| phase2 | browser | The observer live, the dev panel |
| phase3 | browser | Lesson content and the ladder |
| phase45 | browser | The live teacher (spends model tokens) |
| phase6 | browser | The product teacher: memory, `explain`, hints that did not land, conversation panel |
| accounts | browser | Sign-in, saved progress, memory, reset on sign-out, against a fake Supabase |
| pages | browser | Redirects and the guard, guest, sign-in/up (confirmation on and off), password reset, the course page and Continue, coming back to the lesson, no-Supabase mode |
| voice | browser | The mic with a fake microphone and a stubbed server |

Techniques worth knowing:

- **Stubbed model.** Suites that test this app's handling of the teacher serve a
  crafted event stream, so what is under test is deterministic and spends no tokens.
- **Fake Supabase** (`tests/support/fake-supabase.mjs`). An in-memory stand-in for
  auth and the two tables. It has no row-level security and does not pretend to.
- **Reload guard** (`tests/support/reload-guard.mjs`). The dev server reloads the
  page whenever a source file is saved, which resets app state mid-test and shows
  up as a baffling failure elsewhere. Browser suites now report an unexpected
  reload as exactly that. It counts document loads, not navigations, so moving
  between the app's own pages is not mistaken for a reload.
- **Entering as a guest** (`tests/support/guest.mjs`). The lesson is behind the
  sign-in page, so suites that are not about signing in set the guest flag before
  the page loads and go to `/course/python`.
- **Interception off while Python boots.** Request interception holds the
  Pyodide worker's own requests, so suites enable it only after the runtime is
  ready.
- Test seams (`window.__store`, `__teaching`, `__bridge`, `__teachingIde`,
  `__editorView`) exist only in development builds.

---

## 18. Design decisions and known limits

**Decisions**

- **Tier is the client's, phrasing is the model's.** The ladder is the product,
  so the model cannot skip rungs by claiming it is on a different one.
- **Required-with-sentinel over optional-or-null** in every tool schema, because
  measurement showed `null` breaks calls (about 22% on the default model).
- **Recomputed score, not an accumulator,** so the dev panel can show exactly why.
- **Structural "empty", not a length.** Length is wrong at both ends of the ramp.
- **Refused calls are answered.** Limits degrade the experience to hand-written
  hints, never to an error.
- **Persistence is the browser's job.** There is no application server between the
  learner and Supabase, so the lesson works with the API down.

**Known limits**

- **Prose that explains more than a rung intends is only checked at rungs 1 and 2.**
  From rung 3 a hint may legitimately explain the mechanism, and nothing stops
  one that explains more. A model-based check would be needed to close this.
- **The instruction guard is lexical.** It catches action verbs opening a
  sentence or following a connective, not every way of telling someone what to do.
- **Rate limits are in memory and per process.** Use Redis behind `quota.py` for
  more than one worker.
- **The interruption budget is a courtesy,** because the session id is the client's.
- **Capacity is the provider's.** A free plan allows a few teacher calls a minute
  across all learners; beyond it everyone gets hand-written hints.
- **The default model in code disagrees with `.env.example`.** The code falls back
  to `llama-3.3-70b-versatile`; the example sets `openai/gpt-oss-120b`.
- **No explicit request timeout** on provider calls, and retries total about 2 s.
- **The misconception detectors are loop-shaped.** A `while`-based solution looks
  like `no-loop` on the loop exercises.
- **The response cache has no eviction or TTL,** and does not include tool schemas
  in its key.
- **Session logs rewrite the whole event array** on each flush.
- **Leaving the lesson for the course page loses the code in the editor.** It comes
  back at the exercise's starter, as it does moving between exercises. Nothing keeps a
  buffer per exercise.
- **Only Python is a course.** `courses.ts` is data, but the runner, the observer's code
  analysis, the error dictionary and the teacher's prompt are Python's, and the store
  and lesson flow address one ramp (`EXERCISES`). A second language is more than an entry.
  `progress` is keyed by exercise id alone, so a second course needs ids that are unique
  across courses, or a `course_id` column.
- **"Continue as guest" does not survive a closed tab,** by design.
- **The Dockerfile is unbuilt.**
