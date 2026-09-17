# Teaching IDE — proof of concept

A browser Python editor with a teacher embedded in it. The teacher watches the
edit stream and speaks only when the learner appears stuck. It does not
autocomplete, and it never writes into the learner's buffer.

The PoC exists to test one claim: **an observer watching the edit stream can
distinguish "stuck" from "thinking" well enough that a teacher speaking on that
signal feels helpful rather than intrusive.**

## Running it

```bash
npm install
python3 -m venv .venv && .venv/bin/pip install fastapi "uvicorn[standard]" openai python-dotenv

npm run dev     # editor on http://localhost:5173
npm run api     # teacher on http://127.0.0.1:8000  (second terminal)
```

Vite proxies `/api` to the backend. **The editor, the observer and the whole hint
ladder work with the backend down** — the teacher falls back to the pre-written
hints. Only the adapted phrasing needs the API.

Credentials live in `.env` (gitignored):

```
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=...
LLM_MODEL=openai/gpt-oss-120b
```

Switching provider is those three lines. `server/llm.py` is the only module that
imports `openai` or reads those variables. For Ollama or Gemini see `.env.example`.

## Tests

```bash
npm test            # everything (needs both servers up)
npm test unit       # no browser, no network
npm test phase2     # one suite
npm run validate-tools    # 30 live calls: does tool calling actually work
```

The browser suites drive a real Chrome against the real app.

## Layout

```
src/
  exec/         Pyodide in a Web Worker (Comlink), terminable + restartable
    harness.ts    the Python that runs learner code, diffs ASTs, spots misconceptions
  observer/     the stuck score — signals, weights, gate, event log
  lesson/       four hardcoded exercises, five pre-written rungs each
  teacher/      SSE client, staleness guard, reveal pacing
  editor/       CodeMirror 6 + the inline teacher widget
  ui/           panes, lesson bar, dev panel
server/
  llm.py        the only place the provider appears
  tools.py      give_hint / ask_question / translate_error / confirm_success / stay_silent
  prompts.py    system prompt + per-call context
  leakguard.py  stops the teacher handing over the answer early
  errors.py     plain-English error dictionary (no model, no tokens)
  cache.py      disk cache keyed on request context
  validate_tools.py
```

## The dev panel

Toggle with **Observer**. Live stuck score, every contributing signal and its
weight, the last 20 events, hint tier, budget remaining, why the teacher chose
silence, and a slider for every threshold and weight. Tuning the observer is the
project; it cannot be done blind.

**Export log** writes the session as JSON — that is the evidence.

## Build status

- [x] Phase 1 — editor and execution
- [x] Phase 2 — the observer (+ 2b AST comparison)
- [x] Phase 3 — lesson content
- [x] Phase 4 — the teacher
- [x] Phase 5 — presentation

## How we know it worked

Not "it runs". Three people who cannot code, fifteen minutes each. Count:

- times the teacher spoke while they were mid-thought
- times they sat visibly stuck while it stayed silent
- whether anyone completed exercise 3 without reaching tier 5

Both of the first two near zero, and at least one person clearing exercise 3,
means the premise holds.
