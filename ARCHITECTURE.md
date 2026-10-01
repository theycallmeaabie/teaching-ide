# Architecture

The Teaching IDE is a browser Python editor with an embedded teacher that speaks
only when the learner appears stuck. This document describes how the system is
built: the processes, the modules, the contracts between them, and the data
that flows across those boundaries. For the *why* behind the design choices and
the concepts involved, see [EXPLAINER.md](EXPLAINER.md).

---

## 1. System overview

Three runtimes cooperate. Two live in the browser tab, one is a local server.

```
┌────────────────────────────────────────────────────────────────────────────┐
│  BROWSER — main thread (React + CodeMirror + Zustand)                      │
│                                                                            │
│   keystrokes  ┌──────────┐  edit batches  ┌──────────┐  tick / 250 ms      │
│  ────────────►│CodeMirror│───────────────►│ observer │───────────────┐     │
│               │  editor  │◄───────────────│          │               │     │
│               └────┬─────┘  speech widget └────┬─────┘               ▼     │
│                    │ Run                       │ astSnapshot    ┌─────────┐│
│                    ▼                           │ diagnose       │  gate   ││
│               ┌──────────┐                     │                └────┬────┘│
│               │  runner  │◄────────────────────┘                     │fire │
│               └────┬─────┘                                           ▼     │
│                    │ Comlink RPC                                ┌─────────┐│
│                    │                                            │ teacher ││
│                    │                                            │ bridge  ││
│                    │                                            └────┬────┘│
└────────────────────┼─────────────────────────────────────────────────┼─────┘
                     ▼                                                 │ SSE
       ┌──────────────────────────┐                                    ▼
       │  WEB WORKER — Pyodide    │                     ┌───────────────────────┐
       │  (CPython in WebAssembly)│                     │  FASTAPI  :8000       │
       │                          │                     │  /api/teach           │
       │  _teaching_ide_run       │                     │  cache → llm → guard  │
       │  _teaching_ide_ast       │                     │  /api/translate-error │
       │  _teaching_ide_diagnose  │                     │  /api/health          │
       └──────────────────────────┘                     └───────────┬───────────┘
                                                                    │ OpenAI-compatible
                                                                    ▼
                                                          Groq / Ollama / Gemini
```

**Main thread** owns the UI, the observer (stuck detection) and all lesson
state. It never runs learner code.

**Web Worker** hosts Pyodide. It is the only place learner Python executes, and
it is disposable: `Stop` terminates it and boots a fresh one.

**FastAPI server** is the teacher's voice. It turns a context snapshot into one
tool call from an LLM, validates it, and streams it back. Everything else works
with this server down.

---

## 2. Repository layout

```
src/
  main.tsx              entry; exposes dev handles on window in DEV
  App.tsx               wires runner ↔ observer ↔ teacher ↔ editor; Run/Stop
  store.ts              Zustand store — the only React-visible mutable state
  types.ts              RunResult, AstSnapshot, Misconception
  exec/                 Python execution
    runner.ts             PythonRunner singleton: spawn / run / stop / restart
    pyodide.worker.ts     worker body; Comlink-exposed API
    harness.ts            three Python programs shipped into the worker at boot
  observer/             stuck detection
    observer.ts           module state, edit batching, 250 ms tick, snapshot
    score.ts              pure: events → {score, contributions}
    gate.ts               pure: score + cooldown + budget → verdict
    semantics.ts          AST baseline; cosmetic / rename / changed
    log.ts                event log (module-level array) + JSON export
    config.ts             every weight/threshold, live-tunable
    annotations.ts        CodeMirror annotation marking app-driven edits
    types.ts              Event union, Contribution, SemanticVerdict
  lesson/               content and progression
    exercises.ts          20 exercises × 5 hint tiers; isCorrect(); indexOfExercise()
    teaching.ts           submitRun, askTeacherQuestion, goToExercise
  teacher/              talking to the server
    bridge.ts             requestTeaching: assemble context, stream, apply, fall back
    client.ts             fetch + hand-rolled SSE parser; translateError
    health.ts             /api/health → degraded flag for the top bar
  editor/
    Editor.tsx            CodeMirror 6 mount; doc swap on exercise change
    teacherWidget.ts      StateField + block widget that renders speech in-editor
  ui/                   LessonBar, OutputPane, AskBox, ScratchPane, DevPanel

server/
  main.py               FastAPI app; the four endpoints
  models.py             pydantic request/response shapes
  llm.py                the only provider-aware module (AsyncOpenAI)
  prompts.py            SYSTEM prompt + build_context()
  tools.py              the five tool schemas
  leakguard.py          answer-leak detection derived from tier-5 text
  errors.py             regex → plain-English error dictionary
  cache.py              sha256(context) → server/.cache/*.json
  validate_tools.py     30-call tool-calling reliability gate + behaviour probes

scripts/copy-pyodide.mjs   copies the Pyodide runtime into public/pyodide
tests/                     unit (Node + Pyodide) and browser (Puppeteer) suites
```

---

## 3. The execution layer (`src/exec/`)

### 3.1 Threading model

Learner code is synchronous Python. Inside the worker, `while True:` blocks the
worker thread forever; nothing on that thread can interrupt it. The only escape
is `Worker.terminate()` from the main thread. The runner is built around this:

```
                 spawn()
  booting ─────────────────► idle ──run()──► running ──resolve──► idle
     │                        ▲                 │
     │ boot fails             │ spawn()         │ stop(): terminate()
     ▼                        │                 ▼
   failed                 restarting ◄──────────┘
```

`PythonRunner` (`src/exec/runner.ts`) holds one `Worker` and one Comlink proxy.
`run()` keeps a single pending deferred; `stop()` resolves it with a synthetic
`Stopped` error, terminates the worker, and immediately spawns a replacement so
the learner is never left without an interpreter.

### 3.2 Worker API (Comlink)

`src/exec/pyodide.worker.ts` exposes four methods:

| Method | Returns | Notes |
|---|---|---|
| `ready()` | `Promise<void>` | memoised boot: loads `/pyodide/pyodide.mjs`, installs stdout/stderr/stdin hooks, runs the three harnesses |
| `run(source)` | `RunResult` | fresh namespace per run; stdout capped at 200 000 chars |
| `astSnapshot(source)` | `AstSnapshot` | ~1 ms; **never called while a run is in flight** (the runner refuses and returns `null`) |
| `diagnose(source)` | `Misconception[]` | same caveat |

Pyodide is loaded by runtime URL (`new URL('/pyodide/pyodide.mjs', origin)`)
with `/* @vite-ignore */`, and excluded from Vite's dependency pre-bundler in
`vite.config.ts`. The runtime files are copied from `node_modules` into
`public/pyodide/` by the `predev`/`prebuild` hook so the JS glue and the `.wasm`
always match.

### 3.3 The harnesses (`src/exec/harness.ts`)

Three Python source strings executed once at boot, each defining one global
function that returns JSON:

- **`_teaching_ide_run(src)`** — `compile()` then `exec()` in
  `{'__name__': '__main__'}`. Distinguishes compile-time `SyntaxError` from
  runtime exceptions. Walks the traceback and reports the line number from the
  **deepest frame whose filename is `<learner>`**, so harness frames never leak
  into what the learner sees.
- **`_teaching_ide_ast(src)`** — returns `{parses, dump, shape}`. `dump` is
  `ast.dump(tree)`; `shape` is the same dump after a `NodeTransformer` renames
  every non-builtin identifier to `v0, v1, …` in order of first appearance.
- **`_teaching_ide_diagnose(src)`** — walks the AST for seven known beginner
  patterns and returns `[{id, line}]`. See §5.3.

### 3.4 Contract: `RunResult`

```ts
{ ok: boolean; stdout: string;
  error?: { type: string; message: string; line: number | null };
  durationMs: number }
```

Never raw text. `type` is the Python exception class name, which is what the
error dictionary keys on.

---

## 4. The observer (`src/observer/`)

The observer converts a stream of editor transactions into a single number in
`[0, 1]` — the stuck score — and decides, via a gate, when the teacher may
speak. It runs entirely on the main thread and never touches React state
except through a snapshot consumed by `useSyncExternalStore`.

### 4.1 Data flow

```
CodeMirror transaction
   │  (ignored if annotated programmaticEdit)
   ▼
editorExtension()  ──── accumulate {lines touched, charDelta} ────┐
   │                                                              │ 700 ms pause
   ▼                                                              ▼
docVersion++, markActivity()                                 flushBatch(doc)
                                                                  │
                     ┌────────────────────────────────────────────┼─────────────┐
                     ▼                                            ▼             ▼
            log.append({type:'edit', semantic:'pending'})  hash(doc) vs     classify(doc)
                                                           docHistory           │ async
                                                           → revertedAt         ▼
                                                                        runner.astSnapshot
                                                                                │
                                                                                ▼
                                                              event.semantic = verdict
                                                              cosmeticStreak updated

every 250 ms: tick()
   │
   ├── log idle milestones (5 s, 15 s, 30 s, 60 s, 120 s, 180 s)
   ├── computeScore({now, config, events, lastActivityAt, lastEditAt,
   │                 learnerChars, cosmeticStreak, revertedAt})
   ├── evaluateGate(now, score, idleMs, gateState, config)
   ├── if allowed → log {type:'gate'}, start cooldown, onIntervene(v)
   └── publish ObserverSnapshot → subscribers (DevPanel)
```

### 4.2 Module responsibilities

| Module | Kind | Responsibility |
|---|---|---|
| `observer.ts` | stateful | owns all mutable observer state; the only module with timers; exposes `editorExtension()`, `recordRun()`, `recordAsk()`, `setStarter()`, `noteTeacherSpoke()`, `getSnapshot()` |
| `score.ts` | pure | `computeScore(input) → {score, contributions}` — recomputed from scratch each tick |
| `gate.ts` | pure | `evaluateGate(...) → GateVerdict` with `blockedBy[]` reasons |
| `semantics.ts` | stateful | AST baseline + generation counter; `seed()`, `classify()` |
| `log.ts` | stateful | append-only `Event[]`; `exportJson()` |
| `config.ts` | stateful | `config` object mutated in place by the dev panel; `CONFIG_FIELDS` drives the sliders |

The pure modules are what the unit tests target (`tests/observer.test.ts`).

### 4.3 The event log

A plain module-level array, deliberately outside the Zustand store so that
appending on every edit batch does not trigger React renders. Event types:

```ts
| { t, type:'edit', linesChanged:number[], charDelta:number, semantic?:SemanticVerdict }
| { t, type:'run',  result:RunResult, correct:boolean }
| { t, type:'idle', durationMs:number }
| { t, type:'ask',  text:string }
| { t, type:'gate', trigger:'score'|'hardIdle', score:number, reason:string }
```

`exportJson(config)` produces the session evidence: every event with an
`offsetMs` from session start, plus the config that was live at export.

### 4.4 Gate state

```ts
{ lastInterventionAt: number | null; used: number }
```

- The gate firing sets `lastInterventionAt` (cooldown starts) but does **not**
  increment `used`. Budget is only spent if the teacher actually speaks
  (`noteTeacherSpoke(consumesBudget)`), and only for gate-triggered speech.
- `recordAsk()` clears `lastInterventionAt` — a learner question resets the
  cooldown and never costs budget.

---

## 5. The lesson layer (`src/lesson/`)

### 5.1 Content shape

```ts
Exercise {
  id, title, prompt
  starter: string          // pre-seeded buffer; the learner never types the list
  expectedStdout: string   // compared after whitespace normalisation
  hints: HintTier[5]       // { tier, text, targetLine, scratch? }
  watch: { id: MisconceptionId, note: string }[]
}
```

Twenty exercises in a basics ramp — output, variables, arithmetic, strings,
conditionals, lists, `for` over a list → accumulator, dictionaries, functions.
A detector firing outside an exercise's `watch` list is filtered out rather than
reported: `no-loop` is true of every exercise before the loops section. Tiers 4
and 5 carry a `scratch` program — a worked example of the *same shape on a
different problem* — shown read-only in a third pane.

### 5.2 Progression state machine

Owned by `teaching.ts`, stored in Zustand:

```
submitRun(result, source)
  correct = result.ok && isCorrect(stdout, exercise)
  observer.recordRun(result, correct)            // synchronous, before anything else
  result.error ? explainError(error) : clear errorPlain
  misconceptions = runner.diagnose(source)
  if correct:
      solved[i] = true; speech = null
      requestTeaching('success')
  else:
      attempts++
      tier = hintsGiven > 0 ? min(5, tier + 1) : tier   // ladder only climbs once a hint was given
```

```
askTeacherQuestion(text)
  observer.recordAsk(text)                        // resets cooldown, free
  if isAskingForAnswer(text): askedForAnswer++
      every 3rd → tier = min(5, tier + 1)
  recent.push({learner, text}) (keep 6)
  requestTeaching('ask', text)
```

`goToExercise(i)` resets attempts/tier/hintsGiven/speech/misconceptions/recent
and re-seeds the observer's starter and AST baseline.

### 5.3 Misconception detectors

Run in the worker on every failed run. Each is an AST shape, not an error type,
because several of them run clean:

| id | Shape |
|---|---|
| `no-loop` | no `For` node anywhere |
| `index-value-confusion` | `for x in nums:` and `nums[x]` inside the body (only when iterating a bare name; `range(len(nums))` is legitimate) |
| `range-off-by-one` | `range(...)` argument contains `+`/`-`, or starts at `1` with two args |
| `accumulator-init-inside-loop` | a name is assigned a constant **and** accumulated, both inside the loop body |
| `accumulator-reassigned` | initialised to a constant before the loop, then plainly reassigned inside it, never accumulated |
| `accumulator-printed-inside-loop` | `print(...)` inside the loop referencing an accumulator but not the loop variable |
| `loop-body-outside` | a top-level statement after the loop references the loop variable |

The exercise's `watch` list maps detected ids to prose notes; only those notes
are sent to the teacher.

---

## 6. The teacher — client side (`src/teacher/`)

### 6.1 `requestTeaching(trigger, question?)`

The single entry point. `trigger ∈ {'gate', 'ask', 'success'}`.

```
1. abort any in-flight request
2. snapshot: buffer = observer.doc(), version = observer.version(), tier, solvedBefore
3. notes = exercise.watch ∩ store.misconceptions → note strings
4. POST /api/teach with TeachRequestBody (see §8.1), streaming:
     'tool'  → open a Speech {kind, tier, text:'', streaming:true} in the store
               and start the paced reveal
     'delta' → append to revealTarget
     'done'  → decision
5. refresh /api/health
6. apply:
     decision == null       → fallbackToPrewritten (network died)
     tool == stay_silent    → speech = null, lastSilence = reason
     materiallyChanged(buffer, observer.doc(), targetLine)
       or solved-meanwhile  → discard, lastSilence = "buffer moved on (vN → vM)"
     otherwise              → finalize speech (targetLine, source, followup),
                              push to recent (keep 6), hintsGiven++,
                              observer.noteTeacherSpoke(trigger === 'gate')
```

### 6.2 Reveal pacing

Tool-call arguments arrive from the provider in one or two chunks, so true
streaming would land as a wall of text. `bridge.ts` reveals 4 characters every
12 ms from `revealTarget`, patching `speech.text` in the store. The widget's
`updateDOM` patches the existing node rather than recreating it.

### 6.3 Staleness

Every request carries `doc_version`. After the response, `materiallyChanged()`
compares the buffer the request was built from against the current buffer:
the target line changed, more than 12 characters net, or a different number of
non-blank lines → the answer is dropped. A tutor explaining a bug that has
already been fixed costs more trust than a missed hint.

### 6.4 Fallback

`fallbackToPrewritten()` delivers `exercise.hints[tier - 1]` verbatim with
`source: 'prewritten'`, choosing `targetLine` from the first detected
misconception with a line, else the hint's own. It is reached from: network
failure, and (server-side) any provider exception, unusable tool call, or leak.

### 6.5 SSE client

`client.ts` reads `res.body` as a `ReadableStream`, splits on blank lines,
parses `event:`/`data:` pairs, and dispatches to handlers. No EventSource — the
request is a POST with a JSON body.

---

## 7. Editor integration (`src/editor/`)

`Editor.tsx` mounts CodeMirror 6 once per component lifetime. Extensions are
fixed at mount (remounting would destroy the learner's buffer). Exercise
switches dispatch a whole-document replacement tagged with the
`programmaticEdit` annotation so the observer ignores it.

`teacherWidget.ts` is a `StateField<Speech | null>` updated by
`setSpeechEffect`, plus a decoration computed from the field and the doc:

- a `Decoration.line({class:'cm-target-line'})` on the target line (amber, not
  red — half of these are not errors), and
- a `Decoration.widget({block:true, side:1})` after that line (or after the
  last line when no target) containing the speech DOM.

`App.tsx` bridges the two worlds: a `useEffect` on `store.speech` dispatches
`setSpeechEffect.of(speech)` into the view.

---

## 8. The server (`server/`)

### 8.1 `POST /api/teach` — the one streaming endpoint

Request (`models.TeachRequest`):

```
doc_version, buffer, exercise_id, exercise_prompt, expected_stdout,
tier (1–5), tier_texts[5], attempts,
last_run {ok, stdout, error?, correct} | null,
misconceptions[], misconception_notes[],
asked_for_answer, idle_ms, last_edit_ms_ago, stuck_score,
trigger ('gate'|'ask'|'success'), learner_question, recent[≤3]
```

Pipeline inside `gen()`:

```
ck = cache.key(MODEL, SYSTEM, build_context(req))
cache hit? ──yes──► replay(hit)  [tool → 24-char deltas → done{cached:true}]
   │ no
   ▼
llm.complete(stream=True)
   ├─ 'tool'  → sse('tool')
   ├─ 'delta' → sse('delta')          (prose field extracted from partial JSON)
   └─ 'done'  → (tool, args)
   │
   ├─ exception ──► sse('fallback') + replay(prewritten(req, reason))
   ▼
sanitise(req, tool, args)
   ├─ unknown tool / bad JSON / missing required args → fallback
   ├─ give_hint.tier ≠ req.tier → clamp to req.tier (record _clamped_from)
   ├─ leakguard.leaks(prose, req.tier, tier_texts) → fallback
   ▼
cache.put(ck, …); sse('done', {tool, args, source:'llm', doc_version})
```

SSE event vocabulary: `tool`, `delta`, `fallback`, `done`. The cached-replay
path emits the same events as the live path so the client has one code path.

### 8.2 Other endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/translate-error` | `errors.translate()` — regex dictionary, no model. Returns `{known:false}` on a miss. |
| `POST /api/check-ladder` | runs a hint ladder past `leakguard` — used to lint the hand-written hints |
| `GET /api/health` | model, key presence, cache stats, and `llm.last_outcome` (drives the "hints: pre-written" badge) |

### 8.3 `llm.py` — provider boundary

The only module that imports `openai` or reads `LLM_*` environment variables.
`complete()` sends `tool_choice="required"`, `temperature=0.3`,
`max_tokens=400`. The streaming path extracts the prose argument
(`_PROSE_FIELD[tool]`) from the half-written JSON with `_partial_string()` so
text can be forwarded before the object closes.

Retry policy: at most two retries (0.5 s, 1.5 s), honouring `retry-after` when
it is ≤ 3 s, otherwise giving up immediately — the client's prewritten hint is
faster than a slow correct one. Every outcome updates `last_outcome` for
`/api/health`.

### 8.4 `leakguard.py`

Derives, from the **tier-5 text of the current exercise**, the code fragments
that only tier 5 may say (`_CODE` regex: assignments, augmented assignments,
calls, ≥5 chars) and (name, number) pairs (`_INIT` regex, e.g. `("total","0")`).
`leaks(text, tier, tier_texts)` returns the offending fragment if tier < 5 and
either a fragment appears verbatim or a name and its number appear within 40
characters. Nothing is configured per exercise.

### 8.5 `cache.py`

`sha256(model ‖ system ‖ context)[:32]` → `server/.cache/<key>.json`. Disabled
with `LLM_CACHE=0`. Exists because tuning sessions replay near-identical
context hundreds of times against a daily token cap.

---

## 9. State ownership

| State | Owner | Read by |
|---|---|---|
| Editor document | CodeMirror `EditorView` | observer (via update listener), bridge (via `observer.doc()`) |
| `docVersion` | `observer.ts` | bridge (staleness) |
| Event log, score, gate state, cosmetic streak | `observer.ts` (+ `log.ts`, `semantics.ts`) | DevPanel via snapshot; bridge via `idleMs()`, `currentScore()` |
| Observer config | `config.ts` (mutable singleton) | score, gate, DevPanel sliders |
| Runner status, last result | `runner.ts` → mirrored into store | App, OutputPane |
| Exercise index, tier, attempts, hintsGiven, solved, misconceptions, speech, recent, askedForAnswer, health, lastSilence | Zustand store | React components; `teaching.ts`; `bridge.ts` |
| Speech inside the editor | `speechField` (CodeMirror state) | decoration builder |
| AST baseline | `semantics.ts` | `classify()` |
| LLM outcome, cache | server process | `/api/health` |

Rule of thumb: high-frequency data (keystrokes, ticks, events) stays in module
state and reaches React through `useSyncExternalStore`; low-frequency lesson
state lives in Zustand.

---

## 10. Failure modes and their handlers

| Failure | Where caught | Outcome |
|---|---|---|
| Infinite loop / runaway output | `runner.stop()`, 200 k-char cap in worker | worker terminated, fresh one booted, `Stopped` result; slow-run banner at 3 s |
| `input()` called | worker `setStdin` → `null` | clean `EOFError`, translated by dictionary |
| Pyodide fails to boot | `runner.spawn().catch` | status `failed`, Run disabled |
| AST snapshot while running | `runner.astSnapshot` returns `null` | verdict `pending`; streak untouched |
| Worker restart mid-snapshot | `semantics.generation` | stale snapshot dropped; baseline re-seeded |
| Server unreachable | `client.askTeacher` → `null` | prewritten hint, `source:'prewritten'` |
| Provider 429 / 5xx / connection | `llm._create_with_retry` | bounded retry, then `fallback` SSE + prewritten |
| Malformed / wrong tool call | `main.sanitise` | prewritten, note recorded |
| Model gives away the answer | `leakguard.leaks` | prewritten, note names the fragment |
| Model picks a lower tier | `main.sanitise` | clamped to request tier |
| Answer arrives after buffer changed | `bridge.materiallyChanged` | discarded, `lastSilence` explains |
| Daily token cap | `llm.last_outcome` → `/api/health` | top-bar badge "hints: pre-written · daily token cap reached" |

The invariant: **the lesson never stalls.** Every path ends in either speech
from the ladder or deliberate silence with a recorded reason.

---

## 11. Configuration and environment

| Variable | Read by | Default |
|---|---|---|
| `LLM_BASE_URL` | `server/llm.py` | `https://api.groq.com/openai/v1` |
| `LLM_API_KEY` | `server/llm.py` | `""` (sent as `not-needed` for local providers) |
| `LLM_MODEL` | `server/llm.py` | `llama-3.3-70b-versatile` (`.env.example` sets `openai/gpt-oss-120b`) |
| `LLM_CACHE` | `server/cache.py` | `1` |
| `CHROME` | `tests/run.mjs` | auto-detected |

Observer weights and thresholds live in `src/observer/config.ts`
(`DEFAULT_CONFIG`) and are mutated live from the dev panel; they are not
environment-driven.

Vite (`vite.config.ts`): React plugin, `optimizeDeps.exclude: ['pyodide']`,
ES-module workers, `/api` proxied to `127.0.0.1:8000`.

---

## 12. Testing architecture

```
tests/run.mjs ── selects suites ──┬── unit (Node)
                                  │     harness.test.mjs    loads Pyodide in Node, runs HARNESS
                                  │     ast.test.mjs        AST_HARNESS verdicts
                                  │     diagnose.test.mjs   DIAGNOSE_HARNESS detectors
                                  │     observer.test.ts    esbuild-bundled; computeScore + evaluateGate
                                  │
                                  └── browser (Puppeteer → real Chrome → http://localhost:5173)
                                        phase1.mjs   editor + execution + Stop
                                        phase2.mjs   observer, driven by real typing
                                        phase3.mjs   lesson content, success detection, ladder
                                        phase45.mjs  teacher (needs :8000), error dictionary, widget

server/validate_tools.py   30 live give_hint calls → JSON-validity rate vs 95 % bar,
                           plus 5 behaviour probes (silent / progressing / begging / solved / odd error)
```

The unit suites extract the Python harness strings directly from
`src/exec/harness.ts` by text search, so the tested code is the shipped code.
Browser suites reach into the app through `window.__teachingIde`, `__store`,
`__teaching`, `__bridge` and `__editorView`, which `main.tsx` exposes only in
DEV.

---

## 13. Build and serve

- **Dev:** `npm run dev` (Vite, 5173) + `npm run api` (uvicorn `--reload`, 8000).
  `predev` copies Pyodide into `public/pyodide/`.
- **Build:** `npm run build` → `tsc -b` (project references: `tsconfig.app.json`
  for `src/`, `tsconfig.node.json` for `vite.config.ts`) then `vite build` →
  `dist/`. The worker is emitted as a separate ES-module chunk.
- **Type-check only:** `npm run typecheck`.

There is no production deployment story yet; the server is run locally and the
frontend is served by Vite. `dist/` would need a static host plus a reverse
proxy for `/api`.
