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

For one process serving everything: `npm start` builds the app and serves it, with
the API, on http://127.0.0.1:8000. The live site is split instead (see
[Deploying](#deploying)).

The app opens on a sign-in page, then a course page, then the lesson (see
[Pages](#pages)). With no Supabase project configured there is nothing to sign in
to, so it opens straight on the course page.

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
SUPABASE_URL=https://<project>.supabase.co   # the same URL: the API checks sign-ins with it
# SUPABASE_JWT_SECRET=...         # only for a project still on the legacy JWT secret
```

That turns on the sign-in page (email and password, with password reset),
per-exercise progress that survives a refresh, and automatic session recording: the observer's event log
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

Two settings in the Supabase dashboard matter to the sign-in page:

- **Authentication → URL Configuration → Redirect URLs:** add
  `<your origin>/reset-password` (and `http://localhost:5173/reset-password` for
  development). The link in a password-reset email comes back to that address; without it
  Supabase sends people to the project's Site URL instead.
- **Authentication → Providers → Email → Confirm email** can be on or off, and the
  sign-up form handles both: off signs them straight in, on shows "check your email" with
  a resend button. Supabase's built-in mailer is heavily rate-limited, so use your own SMTP
  provider before real learners arrive.

**Leave those blank and nothing changes.** No sign-in page appears, progress lives in
memory as before, and the API serves every call anonymously. Both tables are
row-level secured: a learner can only ever read or write their own rows.

The interruption budget of 8 is still enforced client-side only. Identity now
reaches `/api/teach`, so moving that check to the server is a small change, but
it is not done: anyone who can reach the API can still spend tokens freely.

## Pages

| Path | What it is |
|---|---|
| `/signin` | Email and password: sign in, create an account, forgot password. Or **Continue as guest** |
| `/courses` | Choose a course: Python (with your progress and Continue), and the ones to come, locked |
| `/course/python` | The lesson |
| `/reset-password` | Where the link in a password-reset email lands |

The course page and the lesson need someone to have signed in or chosen **Continue as
guest**. A guest gets the whole lesson; nothing is saved when the tab closes, and the choice
is per tab (a new tab asks again). Asking for a page while signed out sends you to
`/signin`, and signing in takes you where you were going, if it is a page on this site.

Courses are data in `src/lesson/courses.ts`, so a new card is one entry. Only Python has
anything behind it: the runner, the observer's code analysis, the error dictionary and
the teacher's prompt are Python's, so a second language is more than a card.

The pages are routes in the browser, so a production server has to send every path that
is not a file to `index.html`. `npm start` does (`server/main.py`), and so does Vercel
(the rewrite in `vercel.json`); if you host `dist/` anywhere else, configure the same
fallback there.

## Tests

```bash
npm test            # everything (needs both servers up)
npm test unit       # no browser, no network
npm test phase2     # one suite
npm test auth       # token handling, no network
npm test teacher    # what the teacher is told, what it may say, who may ask
npm test api        # the HTTP surface with the model stubbed
npm test accounts   # sign-in, saved progress and memory (a fake Supabase)
npm test pages      # sign-in, guest, the course page, routing, password reset (a fake Supabase)
npm test speaker    # the teacher read aloud (a fake speech engine)
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
  auth/         Supabase client, session lifecycle, who may see a page, guest entry (optional)
  pages/        one file per route: sign-in, reset password, courses, the lesson
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

## The teacher's voice

The speaker in the top bar reads the teacher aloud with the browser's own speech
engine: no server, no key, no cost, and it works with the backend down, so the
pre-written hints are read too. It is **off until the learner turns it on**, and
the choice is remembered per browser (`teaching-ide:voice`).

- **When:** each thing the teacher says is read once, after it has all arrived.
  Reading stops the moment it is dismissed or replaced, when the mic starts
  recording (or the mic would hear the teacher), and when the speaker is turned off.
- **Code:** a code span is said the way a person would say it: `:` as "colon",
  `print(total)` as "print total", `if score >= 60:` as "if score greater than or
  equal to 60 colon". Anything too long to follow by ear (square brackets, nested
  sums) is "the code on screen".
- **The voice:** the best English voice the device has (Edge's "Natural" voices,
  Chrome's Google voices, macOS's enhanced ones), never a novelty one. So it
  sounds as good as the device does: good on Windows, macOS and Chrome, robotic
  where only espeak is installed. A browser with no speech engine disables the
  speaker and says why.

Code: `src/teacher/voice.ts` (when to speak), `src/teacher/spoken.ts` (what to
say), `src/ui/VoiceToggle.tsx`. Tests: `npm test spoken` (unit) and `npm test
speaker` (browser, with a fake speech engine and a stubbed server).

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

The page and the API are hosted apart: the page on **Vercel** (`vercel.json`), the API
on **Render** (`render.yaml`). Nearly everything happens in the learner's browser, so
the page is static files on a CDN that never sleeps; only the teacher's own phrasing
and voice questions need the API. On Render's free plan the API sleeps after 15
minutes idle and takes about a minute to wake: the lesson pings it as it opens, and a
teacher call that gets no reply within 15 seconds gets the hand-written hint instead.

Set it up once, in this order, because each side needs the other's address:

1. **Render → New → Blueprint →** this repo. It creates `teaching-ide-api` and asks
   for `LLM_API_KEY`, `SUPABASE_URL`, and `ALLOWED_ORIGINS`: the page's address on
   Vercel, which is `https://<project name>.vercel.app` (fix it later if Vercel picks
   another).
2. **Vercel → Add New → Project →** this repo. `vercel.json` sets the build; add
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_API_URL` (the Render
   address from step 1, no trailing slash) under Environment Variables, then deploy.
3. **Supabase → Authentication → URL Configuration:** the Vercel address as the Site
   URL, and `<that address>/reset-password` under Redirect URLs.

After that, every push to `main` redeploys the page, and the API too when `server/`
or `requirements.txt` changed. The `VITE_` values are read when the page is built,
so changing one on Vercel needs a redeploy there.

If the teacher only ever gives the hand-written hints and the browser console says
**blocked by CORS policy**, `ALLOWED_ORIGINS` on Render does not match the address the
page is served from. Vercel's preview deployments have addresses of their own, so
they get the hand-written hints unless you add them there too.

To host it all in one place instead, the Dockerfile builds one image that serves both:

```bash
docker build -t teaching-ide \
  --build-arg VITE_SUPABASE_URL=... --build-arg VITE_SUPABASE_ANON_KEY=... .
docker run -p 8000:8000 --env-file .env teaching-ide
```

One container, one process, one origin. Put TLS in front of it (and set
`TRUST_PROXY=1` only if the proxy is yours, so rate limits see real addresses).
`.env.example` documents every setting.

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
