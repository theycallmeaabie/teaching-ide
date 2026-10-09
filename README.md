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
npm test tts        # the ElevenLabs voice on the server (stubbed)
npm run validate-tools    # 30 live calls: does tool calling actually work
```

The browser suites drive a real Chrome against the real app.

## Layout

Where each part of the project lives. The page is `src/`, the API is `server/`,
and everything at the top level is configuration, documentation or tooling.

### The page: `src/`

```
src/
  main.tsx            boots the app: theme, fonts, then React; in development it also
                      exposes the store and observer on window for the browser tests
  App.tsx             the router (wouter) and the access guard: which page, and
                      whether you may see it yet
  api.ts              apiUrl(): where the API is (VITE_API_URL, or /api on this origin)
  store.ts            the Zustand store: lesson state every component reads
                      (exercise, tier, attempts, speech, conversation, solved)
  types.ts            shapes shared across folders (RunResult and friends)
  styles.css          every style; colours are CSS variables, dark theme is one block

  pages/              one file per route
    SignInPage.tsx      /signin: sign in, create account, forgot password, guest
    ResetPasswordPage.tsx  /reset-password: where the reset email's link lands
    CoursesPage.tsx     /courses: the catalogue, with progress and Continue
    CoursePage.tsx      /course/python: the lesson; wires editor, runner, observer,
                        teacher and voice together

  exec/               running learner code, in a Web Worker
    pyodide.worker.ts   boots Pyodide (Python in WebAssembly), captures output
    runner.ts           main-thread side: run, stop (kill and replace), AST snapshots
    harness.ts          the Python shipped into the worker: run code, diff ASTs,
                        detect the seven misconceptions
    js.worker.ts, js/   a JavaScript runner (groundwork for a second course; not
                        used by any page yet)

  observer/           deciding WHEN the teacher may speak
    observer.ts         edit batching (700 ms), the 250 ms tick, wiring
    score.ts            pure: events -> stuck score and each signal's share
    gate.ts             pure: score + cooldown + budget -> may it speak?
    semantics.ts        cosmetic / rename / changed, by comparing ASTs
    log.ts              the event log, and Export log
    config.ts           every weight and threshold (the dev panel's sliders)
    annotations.ts      marks edits the app made, so they are not counted as the learner's
    types.ts            event and signal types

  lesson/             the course content and its rules
    exercises.ts        the 20 exercises, each with five hand-written hints
    courses.ts          the course cards (Python, and the ones to come)
    teaching.ts         what a run, a question or moving exercise does to the lesson
    profile.ts          pure: past exercises -> the learner profile the teacher sees

  teacher/            talking to the teacher, from the browser
    bridge.ts           requestTeaching(): build the context, stream, check, apply, fall back
    client.ts           the /api/teach call and its stream (SSE) parser
    escalation.ts       pure: did the last hint land?
    health.ts           /api/health -> the "hints: pre-written" pill
    plain.ts            pure: tidies the teacher's punctuation
    spoken.ts           pure: the teacher's words as they should sound (code in words)
    voice.ts            reads the teacher aloud: ElevenLabs, else the browser's voice

  editor/             the code editor
    Editor.tsx          CodeMirror 6 set up for Python, feeding the observer
    teacherWidget.ts    the teacher's bubble, drawn inside the editor under its line
    theme.ts            syntax colours, read from the CSS variables

  ui/                 the pieces of the screen
    TopBar.tsx, LessonBar.tsx, OutputPane.tsx, ScratchPane.tsx (the example pane),
    Conversation.tsx, AskBox.tsx (with the mic), DevPanel.tsx (the observer panel),
    AuthBar.tsx, Splash.tsx, Splitter.tsx, ThemeToggle.tsx, VoiceToggle.tsx (the speaker)
    useVoice.ts         recording a spoken question and getting it transcribed
    useLayout.ts        draggable pane sizes, remembered
    theme.ts, prefs.ts  light/dark, and per-browser preferences
    icons.tsx           inline SVG icons, useTitle.ts the tab title

  auth/               accounts (all optional)
    supabase.ts         the Supabase client (null when unconfigured), accessToken()
    session.ts          sign in, sign up, sign out, password reset
    access.ts           who may see which page
    guest.ts            "Continue as guest", per tab

  data/               what is saved
    progress.ts         per-exercise progress and the teacher's conversation
    sessions.ts         the observer's event log, written every 20 seconds
```

### The API: `server/`

```
server/
  main.py             the FastAPI app: CORS, security headers, /api/teach (the guards
                      sanitise() and the cached replay live here), /api/translate-error,
                      /api/check-ladder, /api/health, and serving the built page
  models.py           request and response shapes, with size limits (pydantic)
  prompts.py          the system prompt and each call's context
  tools.py            the six tools the model must choose from
  llm.py              the only file that talks to the model provider; transcribe()
  leakguard.py        stops the answer leaking early: code, and instructions at rungs 1-2
  quota.py            per-caller rate limits and the interruption budget
  errors.py           the plain-English error dictionary (16 rules, no model)
  cache.py            replays an identical request's answer from server/.cache/
  auth.py             checks Supabase sign-in tokens (JWT); anonymous when unconfigured
  stt.py              POST /api/transcribe: a spoken question, as text
  tts.py              POST /api/speak: the teacher's words as ElevenLabs audio
  validate_tools.py   npm run validate-tools: does this model call tools reliably?
```

### Tests: `tests/`

```
tests/
  run.mjs             runs the suites (npm test, npm test unit, npm test <name>)
  *.test.mjs, *.test.ts   unit suites for the browser code (no browser needed)
  *.test.py           unit suites for the server, with the model, ElevenLabs and
                      Supabase stubbed
  browser/            suites that drive a real Chrome against the running app
  support/            shared helpers: a fake Supabase, entering as a guest, and a
                      guard that notices the dev server reloading mid-test
```

### Everything else

| Path | What it is |
|---|---|
| `index.html` | The one HTML page; sets the theme before first paint |
| `vite.config.ts` | Vite: the dev server, the `/api` proxy to port 8000, the build |
| `package.json`, `package-lock.json` | Node dependencies and the `npm` scripts |
| `tsconfig*.json` | TypeScript settings for the page and for the Vite config |
| `requirements.txt`, `requirements-dev.txt` | Python dependencies for the API, and for its tests |
| `.env.example` | Every setting, explained. Copy to `.env` (gitignored) and fill in |
| `supabase/schema.sql` | The two tables (`progress`, `sessions`) and their row-level security |
| `scripts/copy-pyodide.mjs` | Copies Pyodide into `public/pyodide/` before dev and build |
| `scripts/verify-supabase.mjs` | `npm run verify-supabase`: proves saving and security work |
| `public/` | Files served as-is: the favicon, and Pyodide once copied |
| `vercel.json` | How Vercel builds and serves the page |
| `render.yaml` | How Render runs the API (a Blueprint) |
| `Dockerfile`, `.dockerignore` | One image serving page and API together (not used by the live site) |
| `ARCHITECTURE.md` | The structural reference: modules, contracts, failure modes |
| `EXPLAINER.md` | The ideas behind it, and one session followed end to end |
| `study.md` | A plain-language study guide to the whole project |
| `docs/EVALUATION.md` | How to measure whether the teacher speaks at the right moments |

Made by tools and not committed: `node_modules/`, `.venv/`, `dist/` (the built
page), `public/pyodide/`, `server/.cache/` (replayed answers), `.artifacts/`
(test screenshots).

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

The speaker in the top bar reads the teacher aloud. The voice is **ElevenLabs**,
through `POST /api/speak`. When that cannot be had, the **browser's own speech
engine** reads it instead, so the learner hears a different voice rather than
nothing. It is **off until the learner turns it on**, and the choice is
remembered per browser (`teaching-ide:voice`).

- **Setup:** set `ELEVENLABS_API_KEY` where the API runs (`.env` locally, the
  service's Environment tab on Render). `/api/health` shows `voice.key_present`.
  Without a key every learner gets the browser voice, with no wait.
- **When the browser voice takes over:** no key; the credits used up; ElevenLabs
  refusing the key or the server (its free plan can refuse calls from cloud
  hosts as "unusual activity"); the day's character budget spent; a limit hit; or
  the API asleep, down or slower than 8 s. After the first four, the server stops
  calling ElevenLabs and the browser stops asking, both for 10 minutes, so
  nobody waits on a request that will fail.
- **Cost:** only learners who turned the speaker on spend anything. The audio
  for words already spoken is kept in memory and replayed, so a pre-written hint
  costs credits once. Limits: `TTS_PER_MINUTE` / `TTS_PER_DAY` per caller, and
  `TTS_CHARS_PER_DAY` for the whole key (20,000 by default).
- **When it reads:** each thing the teacher says is read once, after it has all
  arrived. Reading stops the moment it is dismissed or replaced, when the mic
  starts recording (or the mic would hear the teacher), and when the speaker is
  turned off. Audio that arrives after any of those is dropped.
- **Code:** a code span is said the way a person would say it: `:` as "colon",
  `print(total)` as "print total", `if score >= 60:` as "if score greater than or
  equal to 60 colon". Anything too long to follow by ear (square brackets, nested
  sums) is "the code on screen". Both voices are sent the same words.
- **The browser voice:** the best English voice the device has (Edge's "Natural"
  voices, Chrome's Google voices, macOS's enhanced ones), never a novelty one.
- **Config:** `ELEVENLABS_VOICE_ID` (George by default; any voice in the
  account's library), `ELEVENLABS_MODEL` (`eleven_flash_v2_5`: the cheapest and
  fastest), `ELEVENLABS_FORMAT` (`mp3_44100_64`).

Code: `server/tts.py`, `src/teacher/voice.ts` (when to speak, and in which
voice), `src/teacher/spoken.ts` (what to say), `src/ui/VoiceToggle.tsx`. Tests:
`npm test tts` (server, ElevenLabs stubbed), `npm test spoken` (unit) and
`npm test speaker` (browser, with a fake speech engine and audio, and a stubbed
server).

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

## Security: CORS, sign-in tokens and limits

### CORS: which pages may read the API's replies

The live page (`teaching-ide.vercel.app`) and the API (`teaching-ide-api.onrender.com`)
are different **origins** (an origin is scheme + host + port). A browser will not let
a page read a reply from another origin unless that origin says it may. Before a
`POST` with JSON or an `Authorization` header, the browser first sends an `OPTIONS`
request (a *preflight*) asking "may this page send this?", and the API answers.

The API's answer is set in `server/main.py` (FastAPI's `CORSMiddleware`):

| Setting | Value | Why |
|---|---|---|
| `allow_origins` | `ALLOWED_ORIGINS`, comma-separated | Only the page's own address. Default: the Vite dev origins |
| `allow_methods` | `GET`, `POST`, `OPTIONS` | All the API uses |
| `allow_headers` | `Authorization`, `Content-Type` | The sign-in token, and JSON or audio bodies |
| `allow_credentials` | `true` | Permits requests sent with cookies. The app does not need it: its token travels in the `Authorization` header, which `allow_headers` covers |

- **In development it never comes up:** Vite proxies `/api` to port 8000, so the page
  and the API share an origin. Same with `npm start` and the Docker image.
- **If it is wrong,** the browser console says *blocked by CORS policy* and the teacher
  only gives hand-written hints. `ALLOWED_ORIGINS` must match the page's address exactly:
  `https://`, no trailing slash. Vercel preview deployments have their own addresses.
- **CORS is not a lock.** It stops *other websites* from using the API through a
  visitor's browser. It does nothing against a script or `curl`, which ignore it.
  That is what the rate limits below are for.

### Sign-in tokens (JWT): how the API knows who is asking

When someone signs in, Supabase (in the browser) hands them an **access token**: a
**JWT**, a signed, base64-encoded JSON note saying who they are (`sub`, the user id),
who it is for (`aud: authenticated`), who issued it and when it expires. The page
sends it to the API on every teacher, transcribe and speak call:

```
Authorization: Bearer <access token>
```

`server/auth.py` checks the signature before believing it. The token's header says
how it was signed:

- **ES256 / RS256** (new Supabase projects): checked against the project's public keys,
  fetched from `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`, kept for five minutes
  and refetched at most every 30 s when a new key id appears. Nothing secret is needed.
- **HS256** (older projects): checked with `SUPABASE_JWT_SECRET`.

The audience must be `authenticated` and the issuer `<SUPABASE_URL>/auth/v1`. A public
key is never accepted as an HS256 secret, which closes a well-known JWT forgery trick.

| What arrives | What happens |
|---|---|
| Nothing configured on the server | Every call is anonymous (the app works without accounts) |
| No `Authorization` header | Anonymous, still served |
| A valid token | The call is the user's |
| An expired, forged or malformed token | `401`: a client claiming an identity it cannot prove is a bug to surface |
| The public keys cannot be fetched | `503` |

The identity is used for **fairness, not access**: rate limits count per user instead
of per address. Everything is open to guests by design.

**Saved progress never goes through the API.** The browser reads and writes Supabase
directly with the public `anon` key, and **row-level security** in
`supabase/schema.sql` makes the database itself check that each row belongs to the
signed-in user. `npm run verify-supabase` proves that against the real project.

### Limits: what one caller can spend

Kept in memory (`server/quota.py`, `stt.py`, `tts.py`) and counted per **caller**: the
signed-in user, otherwise the address. Behind Render's proxy the real address is in
`X-Forwarded-For`, which is read only when `TRUST_PROXY=1`, or anyone could fake it.

| Door | Per minute | Per day | Also |
|---|---|---|---|
| `/api/teach` | 10 | 400 | 8 unprompted interruptions per sitting (a courtesy: the client picks the sitting id) |
| `/api/transcribe` | 6 | 150 | 4 MB a recording |
| `/api/speak` | 12 | 300 | 20,000 characters a day for the whole ElevenLabs key |

A refused call never shows the learner an error: they get the hand-written hint, the
typed question box, or the browser's voice.

### Secrets: where each setting lives

| Setting | Where | Secret? |
|---|---|---|
| `LLM_API_KEY`, `ELEVENLABS_API_KEY`, `SUPABASE_JWT_SECRET` | The API only: `.env` locally, Render's Environment tab live | **Yes.** Never in the page, never committed |
| `SUPABASE_URL`, `ALLOWED_ORIGINS`, `TRUST_PROXY` | The API | No |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` | Vercel, read **when the page is built** | No: anything named `VITE_` ends up in the page for anyone to read, so never put a secret in one |

`.env` is gitignored; `.env.example` lists every setting with no values.

### Other protections

- **Learner code never reaches the server to run.** It runs in a Web Worker in the
  learner's own tab; the server only sees it as text inside a hint request.
- **Request shapes are checked** (pydantic, `server/models.py`) with size caps: code up
  to 8,000 characters, a question up to 1,000, 40 conversation turns, 4 MB of audio,
  1,000 characters to speak.
- **Security headers** on the API (`server/main.py`) and the page (`vercel.json`):
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`,
  `X-Frame-Options: DENY` (no one can frame the app inside their own page).
- **The API's interactive docs are off** unless `ENABLE_DOCS=1`.
- **Voice is not kept:** recordings and the text sent to ElevenLabs are held for one
  request and not logged. Spoken audio is cached in memory only, to replay it.
- **The teacher cannot hand over the answer early**: see *How the teacher works*.
- **Not done yet:** a Content-Security-Policy header, and limits shared between
  server processes (they are per process; Redis behind `quota.py` would fix it).

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
