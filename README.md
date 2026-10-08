# Teaching IDE

A browser Python editor with a teacher inside it. Twenty small exercises take a
complete beginner from `print` to functions, and the teacher sits beside them:
it watches *how* they work, not just what they run, and speaks when they are
stuck, not when they are thinking.

- **It knows when to speak.** An observer scores the edit stream every quarter
  of a second (idle after an error, the same line rewritten, edits that change
  nothing), and the teacher is only allowed to speak when that says stuck.
- **It remembers.** The whole conversation on each exercise is kept, and it knows
  the learner's history: what took effort, which mistake keeps coming back, whether
  they reach for the answer.
- **It explains.** Ask what a keyword means and you get an explanation, with an
  example on a different problem. What it will not do is hand over the answer to
  the exercise in front of you, and that is enforced in code, not just requested.
- **It never stalls.** If the model is slow, down, rate-limited or wrong, the
  learner gets the hand-written hint for where they are instead.

Python runs in the browser (Pyodide, in a worker), so learner code never touches
your server.

## Running it

```bash
npm install
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

npm run dev     # editor on http://localhost:5173
npm run api     # teacher on http://127.0.0.1:8000  (second terminal)
```

For one process serving everything, as in production: `npm start` builds the app
and serves it, with the API, on http://127.0.0.1:8000.

Vite proxies `/api` to the backend. **The editor, the observer and the whole hint
ladder work with the backend down**. The teacher falls back to the pre-written
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
survives a refresh, and automatic session recording: the observer's event log
written to the `sessions` table every 20 seconds instead of depending on
someone clicking **Export log**.

Prove it actually works before trusting it with a session:

```bash
npm run verify-supabase -- you@example.com 'your-password'
```

That round-trips a row through both tables, checks the `updated_at` trigger
fires, confirms row-level security hides your rows from a signed-out reader,
and, if the API is up, that it accepts a real token and rejects a forged one.
Those session rows are the evidence the whole premise is judged on, so "it
compiled" is not proof they are being written.

**Leave those blank and nothing changes.** No sign-in appears, progress lives in
memory as before, and the API serves every call anonymously. Both tables are
row-level secured: a learner can only ever read or write their own rows.

The interruption budget of 8 is still enforced client-side only. Identity now
reaches `/api/teach`, so moving that check to the server is a small change, but
it is not done: anyone who can reach the API can still spend tokens freely.

## Tests

```bash
npm test            # everything (needs both servers up)
npm test unit       # no browser, no network
npm test phase2     # one suite
npm test auth       # token handling, no network
npm test teacher    # what the teacher is told, what it may say, who may ask
npm test api        # the HTTP surface with the model stubbed
npm test accounts   # sign-in, saved progress and memory (a fake Supabase)
npm run validate-tools    # 30 live calls: does tool calling actually work
```

The browser suites drive a real Chrome against the real app.

## Layout

```
src/
  exec/         Pyodide in a Web Worker (Comlink), terminable + restartable
    harness.ts    the Python that runs learner code, diffs ASTs, spots misconceptions
  observer/     the stuck score: signals, weights, gate, event log
  lesson/       twenty exercises, five hand-written rungs each; the learner profile
  auth/         Supabase client and session lifecycle (optional)
  data/         saved progress and server-side session logs
  teacher/      SSE client, staleness guard, reveal pacing
  editor/       CodeMirror 6 + the inline teacher widget
  ui/           panes, lesson bar, dev panel
server/
  llm.py        the only place the provider appears
  tools.py      give_hint / explain / ask_question / translate_error / confirm_success / stay_silent
  prompts.py    system prompt + per-call context (exercise, profile, conversation)
  quota.py      per-caller rate limits and the per-sitting interruption budget
  leakguard.py  stops the teacher handing over the answer early: code and instructions
  errors.py     plain-English error dictionary (no model, no tokens)
  cache.py      disk cache keyed on request context
  auth.py       Supabase JWT verification; anonymous when unconfigured
  validate_tools.py
supabase/
  schema.sql    progress + sessions, both row-level secured
```

## Themes

Light and dark, switched with the button in the top bar. With no choice made it
follows the OS setting; once chosen it sticks. Every colour is a CSS variable in
`src/styles.css` (the dark theme is one block redefining them), and the editor's
syntax colours (`src/editor/theme.ts`) read the same variables, so switching theme
never rebuilds the editor or touches the learner's buffer.

The look comes from a Stitch design: layered navy surfaces (tone, not borders, separate
regions), emerald for actions, amber for the teacher. The dark values are the
design's own; the light theme is a companion. Fonts (Geist, JetBrains Mono) are
self-hosted via `@fontsource-variable/*` and the icons are inline SVG
(`src/ui/icons.tsx`), so a learner's browser makes no request off-site.

## Resizing

Three dividers can be dragged: code | output, editor | example, and the edge above
the conversation. The conversation and the question box sit in one dock that spans
the editor and the example pane. Double-click a divider to reset it; with it
focused, arrow keys move it 16px (Shift: 64px). Sizes are remembered per browser
(`teaching-ide:layout`). The code area, dock and splitters live in `src/App.tsx`,
`src/ui/Splitter.tsx` and `src/ui/useLayout.ts`.

## Voice questions

The mic in the question box records (click to start, click to stop, Esc cancels),
`POST /api/transcribe` turns the clip into text with Whisper through the same
provider and key as the teacher, and the words land in the box for the learner to
read. They are **never sent for them**, because speech-to-text mangles code ("colon" →
"Colin"), and a wrong question misleads the teacher. The microphone is released
the moment recording stops.

- **Privacy:** the audio goes to your provider (`LLM_BASE_URL`), is held in memory
  for the request and dropped; neither it nor the transcript is stored or logged.
- **Cost:** on Groq's free plan Whisper allows 20 requests a minute and 2,000 a day
  for the whole key (minimum 10 billed seconds each), separate from the token cap
  that limits the teacher. Per-caller limits sit far below that: `STT_PER_MINUTE`,
  `STT_PER_DAY`.
- **Config:** `STT_MODEL` (`none` for a provider with no speech endpoint: the mic
  then says voice is unavailable), `STT_LANGUAGE` (blank detects it).
- **Browsers:** anything with `MediaRecorder` and a secure page (https or
  localhost). Elsewhere the mic is disabled and says why.
- **Silence:** Whisper invents text from noise, so segments it is unsure of are
  dropped and so is anything with no letter or digit in it; the learner is told
  "I didn't catch anything".

Code: `src/ui/useVoice.ts`, `src/ui/AskBox.tsx`, `server/stt.py`, `transcribe()` in
`server/llm.py`. Tests: `npm test stt` (server) and `npm test voice` (browser, with a
fake microphone and a stubbed server).

## The dev panel

Closed by default; toggle with **Observer** (the choice is remembered, and the
observer records either way). Live stuck score, every contributing signal and its
weight, the last 20 events, hint tier, budget remaining, why the teacher chose
silence, and a slider for every threshold and weight. Tuning the observer is the
project; it cannot be done blind.

**Export log** writes the session as JSON, and that is the evidence.

## How the teacher works

Every hint has five hand-written rungs: a nudge, the line, the concept, a worked
example, a walk-through. The learner's place on the ladder belongs to the client,
and it climbs when a run fails after a hint, or when the observer reopens the gate
on code that has not changed since the last hint, because a hint that did not land
is not improved by repeating it.

The model's job is to say the current rung for *this* learner, in *their* code, and
to choose well among its tools: hint, explain, ask a question, translate an error,
confirm success, or say nothing. Its choices are checked before anyone sees them:

- **No code they could paste** below the last rung (`leakguard`), including the
  line said out loud ("the line that sets total to zero").
- **No instructions at rungs 1 and 2.** Those say where to look, never what to do.
  The hand-written rungs are held to the same rule.
- **The tier is not the model's to change.**
- **Silence is a real answer**, and mandatory if they typed in the last ten seconds.

Anything rejected falls back to the hand-written rung, and the dev panel records why.

## Deploying

```bash
docker build -t teaching-ide \
  --build-arg VITE_SUPABASE_URL=... --build-arg VITE_SUPABASE_ANON_KEY=... .
docker run -p 8000:8000 --env-file .env teaching-ide
```

One container, one process, one origin. Put TLS in front of it (and set
`TRUST_PROXY=1` only if the proxy is yours, so rate limits see real addresses).
`.env.example` documents every setting. **The Dockerfile has not been built on the
machine this was written on**. Build it once before relying on it.

### Limits to know about

- **Rate limits are in memory and per process** (`server/quota.py`). Run more than
  one worker and each keeps its own counters.
- **The interruption budget is a courtesy, not a defence.** A sitting is an id the
  client chooses. The per-minute and per-day limits are keyed to the caller and
  are the actual cost controls.
- **Capacity comes from your model provider's plan,** not from this code. A free
  tier allows a few teacher calls a minute across *all* learners; past that,
  everyone gets the hand-written hints, which is graceful but is not the product.
- **Hints that explain the concept in prose** are only checked at rungs 1 and 2.
  From rung 3 a hint may legitimately explain the mechanism; nothing stops one
  that explains more than the rung intends.
- **Existing Supabase projects** need `supabase/schema.sql` run again to gain the
  columns the teacher's memory is saved in.

See [docs/EVALUATION.md](docs/EVALUATION.md) for how to tell whether the teacher
speaks at the right moments.
