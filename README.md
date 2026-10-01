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
python3 -m venv .venv && .venv/bin/pip install fastapi "uvicorn[standard]" openai python-dotenv "pyjwt[crypto]"

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

## Accounts and saved progress

Optional, and off until configured. Create a Supabase project, run
[`supabase/schema.sql`](supabase/schema.sql) in its SQL editor, and add to `.env`:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=...        # Project Settings -> API
SUPABASE_JWT_SECRET=...           # Project Settings -> API -> JWT Settings
```

That turns on a sign-in control in the top bar, per-exercise progress that
survives a refresh, and automatic session recording — the observer's event log
written to the `sessions` table every 20 seconds instead of depending on
someone clicking **Export log**.

**Leave those blank and nothing changes.** No sign-in appears, progress lives in
memory as before, and the API serves every call anonymously. Both tables are
row-level secured: a learner can only ever read or write their own rows.

The interruption budget of 8 is still enforced client-side only. Identity now
reaches `/api/teach`, so moving that check to the server is a small change, but
it is not done — anyone who can reach the API can still spend tokens freely.

## Tests

```bash
npm test            # everything (needs both servers up)
npm test unit       # no browser, no network
npm test phase2     # one suite
npm test auth       # token handling, no network
npm run validate-tools    # 30 live calls: does tool calling actually work
```

The browser suites drive a real Chrome against the real app.

## Layout

```
src/
  exec/         Pyodide in a Web Worker (Comlink), terminable + restartable
    harness.ts    the Python that runs learner code, diffs ASTs, spots misconceptions
  observer/     the stuck score — signals, weights, gate, event log
  lesson/       twenty hardcoded exercises, five pre-written rungs each
  auth/         Supabase client and session lifecycle (optional)
  data/         saved progress and server-side session logs
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
  auth.py       Supabase JWT verification; anonymous when unconfigured
  validate_tools.py
supabase/
  schema.sql    progress + sessions, both row-level secured
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
- [x] Phase 6 — twenty-exercise ramp, accounts, saved progress

## How we know it worked

Not "it runs". Three people who cannot code, fifteen minutes each. Count:

- times the teacher spoke while they were mid-thought
- times they sat visibly stuck while it stayed silent
- whether anyone reached the accumulator exercise without reaching tier 5

Both of the first two near zero, and at least one person clearing the
accumulator exercise, means the premise holds.
