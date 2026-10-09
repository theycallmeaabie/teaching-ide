# Study Guide: Teaching IDE

A plain-language guide to everything this project is made of: what each part
does, how the parts talk to each other, which tools we picked and why, and what
we could have picked instead. Read it top to bottom once, then use the
**Pitch** section and the **Questions people might ask** section before a demo.

> **New words** are explained the first time they appear, and there is a
> **Glossary** at the end if you forget one.

---

## Contents

1. [The project in one minute](#1-the-project-in-one-minute)
2. [The big idea: when to speak vs. what to say](#2-the-big-idea-when-to-speak-vs-what-to-say)
3. [The parts of the system](#3-the-parts-of-the-system)
4. [How the parts connect: one learner's story](#4-how-the-parts-connect-one-learners-story)
5. [Features, one by one](#5-features-one-by-one)
6. [The ideas and methods behind it](#6-the-ideas-and-methods-behind-it)
7. [Every technology, why we chose it, and the alternatives](#7-every-technology-why-we-chose-it-and-the-alternatives)
8. [How it is hosted (deployment)](#8-how-it-is-hosted-deployment)
9. [How we know it works (testing)](#9-how-we-know-it-works-testing)
10. [Honest limits](#10-honest-limits)
11. [Pitch: how to explain it](#11-pitch-how-to-explain-it)
12. [Questions people might ask](#12-questions-people-might-ask)
13. [Glossary](#13-glossary)

---

## 1. The project in one minute

**Teaching IDE** is a website where a complete beginner learns to write Python,
with a teacher built into the code editor.

- An **IDE** ("integrated development environment") is just a program for
  writing code. Ours runs in the web browser, so there is nothing to install.
- There are **20 small exercises**, from printing "Hello, world!" up to writing
  your own function.
- A **teacher** (an AI language model, kept on a tight leash) sits inside the
  editor. It gives hints, explains ideas, and answers questions.

What makes it different from "ChatGPT next to an editor":

1. **It knows *when* to speak.** It watches *how* you work (typing, pausing,
   running, getting errors) and only speaks when you look **stuck**, not
   when you are **thinking**. A teacher who interrupts you mid-thought is
   annoying, and one who ignores you while you're stuck is useless.
2. **It never just hands you the answer.** Hints climb a five-step ladder,
   from a gentle nudge to a full walk-through. The answer only appears on the
   last step, and that rule is **enforced by code**, not just by asking the AI
   nicely.
3. **It never stops working.** If the AI is slow, broken, or out of free
   credits, you still get a hand-written hint instantly.
4. **It can talk and listen.** You can ask questions with your microphone, and
   the teacher can read its hints out loud.

---

## 2. The big idea: when to speak vs. what to say

The whole project rests on splitting the teacher's job into two separate
problems:

| Question | Who answers it | What kind of thing it is |
|---|---|---|
| **When** should the teacher speak? | The **Observer** | Plain rules and maths. Same input, same output, every time. You can see exactly why it decided. |
| **What** should the teacher say? | The **Teacher** (AI model + guards) | An AI that writes friendly, personal hints, checked by code before you ever see them. |

Think of a driving instructor. One part of their brain watches the road and
decides *"I need to say something now"*. Another part decides *what* to say.
We built those as two separate machines, so neither can mess up the other's job.

**Why this matters:** AI models are good with words but unpredictable. Rules are
predictable but can't write a friendly sentence about *your* code. We use each
for what it's good at.

---

## 3. The parts of the system

Here is the whole thing on one page. Arrows show who talks to whom.

```
 ┌───────────────────────── YOUR BROWSER (the website) ─────────────────────────┐
 │                                                                                │
 │   Editor (CodeMirror)  ──typing──►  Observer  ──"they're stuck!"──►  Gate      │
 │        ▲                              │                               │        │
 │        │ hint appears                 │ "what does the code           │ opens  │
 │        │ under your line              │  look like now?"              ▼        │
 │        │                              ▼                         Teacher Bridge │
 │   Speech bubble  ◄────────────  Python Runner (Pyodide,              │         │
 │   + voice                        in a Web Worker)                    │         │
 │                                                                      │         │
 │   Lesson (20 exercises, 5 hints each)     Mic (records your question)│         │
 └────────────────────────────┬─────────────────────────────────────────┼─────────┘
                              │ sign-in, saved progress                 │ "help this learner"
                              ▼                                         ▼
                 ┌──────────────────────┐              ┌──────────────────────────────┐
                 │ Supabase (optional)  │              │ Our server (FastAPI on Render)│
                 │ accounts + database  │              │ guards, limits, cache         │
                 └──────────────────────┘              └───────┬──────────────┬───────┘
                                                               ▼              ▼
                                                     Groq (AI model +   ElevenLabs
                                                     Whisper speech-    (teacher's
                                                     to-text)           voice)
```

Now each part, in plain words.

### 3.1 The website (the "frontend")

The **frontend** is everything you see and click. It is built with **React**
(a tool for building interfaces out of reusable pieces called *components*)
and written in **TypeScript** (JavaScript with type-checking, more on that in
section 7).

What's on the lesson screen:

- **Top bar:** the name, a status pill ("ready", "starting Python…"), the
  **speaker** button (teacher reads aloud), the **eye** button (the Observer
  panel), the light/dark theme switch, and sign-in.
- **Lesson bar:** which exercise you're on, its instructions, and dots showing
  which ones you've solved.
- **Editor:** where you type Python. The teacher's hints appear *inside* the
  editor, directly under the line they're about, with that line tinted amber.
- **Example pane:** a read-only side panel that shows worked examples on a
  *different* problem. They're there to copy the idea from, not the answer.
- **Output pane:** what your program printed, and errors translated into plain
  English.
- **Conversation dock:** the chat history with the teacher for this exercise,
  plus the **ask box** (type or speak a question).

There are four pages: **sign-in**, **courses** (pick Python), **the lesson**,
and **reset password**.

### 3.2 The Python Runner (running your code safely)

When you press **Run**, your Python code runs **inside your own browser**, not
on our server. We use **Pyodide**, which is the real Python language rebuilt to
run in a browser (using a technology called WebAssembly).

It runs inside a **Web Worker**: a separate background lane in the browser.
Why? If you write a loop that never ends (`while True:`), it would freeze the
whole page if it ran in the main lane. In a worker, the page stays responsive,
and the **Stop** button can simply *kill* the worker and start a fresh one.

The runner also does two clever jobs besides running code:

- **Takes "X-ray pictures" of your code** (called an *AST*, see glossary) so the
  Observer can tell if your edit actually changed the program or just moved
  some spaces around.
- **Spots common beginner mistakes** by the *shape* of the code, like
  resetting a total inside a loop. That mistake doesn't cause any error; it
  just gives the wrong answer. Seven of these "misconception detectors" exist.

### 3.3 The Observer (deciding *when* to help)

The Observer watches your editing like a patient teacher looking over your
shoulder. Four times a second it calculates a **stuck score** between 0 and 1.

Things that push the score **up** (looks stuck):

- You got an error and haven't touched the code since.
- Your program ran but printed the wrong answer, and you're just staring at it.
- You keep editing the same line over and over.
- You make an edit, then undo it, then make it again.
- You keep making edits that don't actually change what the program does.
- The editor is basically empty and you haven't started.

Things that pull the score **down** (looks fine):

- You just solved it.
- You just made a real change to the program.
- You're typing steadily forward.

Then there is a **Gate**, like a bouncer. The teacher may only speak if:

- the score is above **0.6** (or you've done nothing at all for **3 minutes**),
- the teacher hasn't spoken in the last **45 seconds** (the cooldown),
- and there are interruptions left in the budget (**8** per sitting).

**Your questions skip the gate.** Asking is always free.

### 3.4 The Lesson (the exercises and the hint ladder)

**20 exercises** in 8 topics: output, variables, strings, conditionals (if/else),
lists, loops, dictionaries, and functions.

Each exercise has **5 hand-written hints**, called a **ladder**, each saying a
bit more than the one before:

1. **A nudge:** what kind of thing is missing.
2. **The line:** where to look.
3. **The concept:** why it's wrong.
4. **A worked example:** the same idea on a different problem, in the example pane.
5. **Walk it through:** the exact steps. Even here, *you* type it.

You climb the ladder when a run fails after a hint, or when a hint clearly
didn't help (the code is exactly the same as when the hint was given). Asking
"just tell me the answer" three times also moves you up one step. You don't
get a flat "no", but begging doesn't get you there for free either.

The app also builds a small **learner profile**: which exercises you struggled
with, which mistakes keep coming back, which topics you find easy. The teacher
gets this so it can say things like "this is the same slip as last time".

### 3.5 The Teacher Bridge (the messenger in your browser)

When the gate opens (or you ask something), the **bridge** packs up everything
the teacher needs: your code with line numbers, what your last run printed vs.
what was expected, any detected mistakes, how long you've been idle, which
hint step you're on, the last 12 turns of conversation, and your profile.

It sends that to the server and **streams** the answer back (the words
arrive bit by bit, like a chat app). Then it does two safety checks:

- **Is this answer still relevant?** If you kept typing and changed the code
  while the AI was thinking, the answer is **thrown away**. A teacher
  confidently explaining a bug you already fixed is worse than silence.
- **Did anything go wrong?** If the server didn't reply in 15 seconds, or
  something failed, it shows the **hand-written hint** instead.

### 3.6 The Server (the "backend")

The **backend** is a program running on a computer in the cloud (on Render).
It's written in **Python** using **FastAPI**. The browser talks to it through
these **endpoints** (an endpoint is like a door with a specific job):

| Door | Job |
|---|---|
| `POST /api/teach` | "Help this learner." Asks the AI, checks the answer, streams it back. |
| `POST /api/translate-error` | Turns a Python error into plain English using a dictionary (no AI). |
| `POST /api/transcribe` | Turns your voice recording into text. |
| `POST /api/speak` | Turns the teacher's words into a voice clip (ElevenLabs). |
| `POST /api/check-ladder` | Lets us check our own hand-written hints for leaks. |
| `GET /api/health` | "Are you alive? Is the AI working? Is the voice set up?" |

Inside the server there are small modules, each with one job:

- **`llm.py`**: the *only* file that talks to the AI provider. Switching
  providers means changing 3 settings.
- **`prompts.py`**: writes the instructions and the context for the AI.
- **`tools.py`**: the 6 "buttons" the AI is allowed to press (see 3.7).
- **`sanitise` + `leakguard.py`**: the **guards** that check every AI answer.
- **`quota.py`**: rate limits (max 10 teacher calls a minute, 400 a day, per person).
- **`errors.py`**: the error dictionary: 16 rules that explain common errors
  in plain English, instantly and for free.
- **`cache.py`**: remembers answers so the exact same question isn't paid for twice.
- **`auth.py`**: checks that a signed-in user really is who they say.
- **`stt.py`** (speech-to-text) and **`tts.py`** (text-to-speech): the voice doors.

### 3.7 The AI Teacher (the model and its "tools")

The AI is **gpt-oss-120b**, an open-weight model (its internals are published),
running on **Groq**, a company with very fast AI chips and a free tier.

Here's the trick: **the AI is never allowed to just write text.** It must press
exactly one of 6 buttons (called **tool calling**):

| Tool | When |
|---|---|
| `give_hint` | You're stuck. Give the current step of the ladder, in your own code's words. |
| `explain` | You asked what something means. Explain it with an example on a *different* problem. |
| `ask_question` | You asked for the answer. Reply with one helpful question instead. |
| `translate_error` | An error the dictionary didn't know. |
| `confirm_success` | You solved it. Confirm, then ask *why* it worked. |
| `stay_silent` | You're making progress. Say nothing, and give a reason. |

`stay_silent` is the most important one. Without it, an AI *always* says
something, because that's what it was asked to do. The rules even force silence
if you typed in the last 10 seconds (unless you asked a question).

**The guards** then check the answer before you see it:

1. Is it a real tool with all its parts filled in?
2. Is the hint step the one *we* asked for? The AI can't skip ahead by lying.
3. **Leak check:** does the text contain code from the final answer, or even
   say it in words ("the line that sets total to zero")? If yes, it's thrown out
   and the hand-written hint is used.

### 3.8 Voice: listening and speaking

**Listening (your questions):** press the mic, ask your question, press it again.
The audio goes to the server, which uses **Whisper** (an AI that turns speech
into text) on Groq. The words appear **in the ask box** so you can check them
before sending. Speech-to-text often mishears code ("colon" becomes "Colin"),
and a wrong question would confuse the teacher. The audio is never saved.

**Speaking (the teacher's hints):** press the speaker in the top bar. Each hint
is read out once, after it has fully appeared. The voice comes from
**ElevenLabs** (very natural-sounding AI voices). If ElevenLabs can't be used
(no credits left, server asleep, too slow), your **browser's built-in voice**
reads it instead. You hear a different voice, never silence.

A neat detail: code is read **the way a person would say it**. `:` becomes
"colon", `print(total)` becomes "print total", and `if score >= 60:` becomes
"if score greater than or equal to 60 colon". Anything too long to follow by ear
becomes "the code on screen".

### 3.9 Accounts and saving (Supabase)

**Supabase** gives us two things: **accounts** (email + password, with password
reset) and a **database** (a Postgres database, a very common and reliable kind).

Two tables:

- **`progress`**: per exercise, what you solved, how many attempts, which hint
  step you reached, your conversation with the teacher. So you can come back
  tomorrow and carry on.
- **`sessions`**: the Observer's event log, saved every 20 seconds. This is
  the **evidence** used to judge whether the teacher speaks at the right moments.

**Row-level security** means the database itself checks that you can only ever
read or write *your own* rows, even though the browser talks to it directly.

You can also **continue as a guest**: everything works, but nothing is saved
when you close the tab.

**How the server knows it's you (JWT).** When you sign in, Supabase gives your
browser a **JWT** (JSON Web Token): a small digital ID card that says "this is
user X, valid until 3 pm", stamped with Supabase's signature. Your browser shows
it to our server on every request (`Authorization: Bearer <token>`). The server
checks the signature using Supabase's public keys, just like checking the
hologram on an ID card, so nobody can fake one. A forged or expired card gets
rejected (error 401). No card at all is fine: you're treated as a guest. The
server uses your identity for **fairness**: each person gets their own rate
limit.

### 3.10 The Observer panel (the developer's dashboard)

Click the **eye** in the top bar to see the Observer's brain live: the stuck
score, every signal pushing it up or down, the gate's decision and *why*, the
last 20 events, and **sliders** for every setting. **Export log** downloads the
whole session as a file. This is how we tune the Observer: by watching it, not
by guessing.

### 3.11 Where each part lives (the folders)

When someone asks "where's the code for X?", this is the map. The README's
**Layout** section lists every single file.

| Part (from this section) | Folder / file |
|---|---|
| The website's pages (sign-in, courses, lesson) | `src/pages/` |
| Screen pieces (top bar, ask box, output, Observer panel, speaker button) | `src/ui/` |
| The code editor and the hint bubble inside it | `src/editor/` |
| Python Runner (Pyodide in a Web Worker) | `src/exec/` |
| Observer, stuck score, gate | `src/observer/` |
| Exercises, hint ladders, learner profile | `src/lesson/` (the hints themselves are in `exercises.ts`) |
| Teacher Bridge, reading aloud | `src/teacher/` |
| Sign-in and guest mode | `src/auth/` |
| Saving progress and session logs | `src/data/` |
| App-wide state (the "store") | `src/store.ts` |
| The server: all its doors, guards, limits, AI and voice | `server/` |
| The database tables and their security rules | `supabase/schema.sql` |
| Tests | `tests/` (browser tests in `tests/browser/`) |
| Hosting settings | `vercel.json` (website), `render.yaml` (server) |
| All the settings and keys, explained | `.env.example` |

---

## 4. How the parts connect: one learner's story

Let's follow Maya through the exercise "Add them all up" (sum a list of numbers).

1. **The page loads.** Pyodide (Python) boots up in a Web Worker. The status pill
   says "ready". The page pings the server so a sleeping server starts waking up.
2. **Maya types.** The Observer collects her keystrokes. When she pauses for
   0.7 seconds, it counts that as one "edit" and takes an X-ray (AST) of her code
   to see if the program really changed. It did, so the stuck score stays low.
   Teacher stays quiet.
3. **She runs it.** Her code runs in the worker. It prints `5`, but the answer
   should be `27`. No error, just wrong. The mistake detector notices she
   resets `total = 0` *inside* the loop (so it starts over every time).
4. **She stares.** No typing. Every quarter second the stuck score climbs
   ("ran but wrong, untouched for 22 s… 40 s…"). It passes 0.6. The gate
   checks the cooldown and budget. **Gate opens.**
5. **The bridge asks the server** with all the context. The server asks the AI,
   which presses `give_hint` with a nudge: *"Every time the loop goes round,
   everything inside it starts again. Where does the total need to live so it
   survives?"* It points at line 4.
6. **The guards check it.** It's the right hint step and leaks no answer code. OK.
7. **It streams back.** The hint appears under line 4, which glows amber. If the
   speaker is on, ElevenLabs reads it out. Before showing it, the bridge
   checked that Maya hadn't changed line 4 in the meantime.
8. **She tries again, still wrong.** Since a hint was given and the run failed,
   the ladder climbs to step 2 ("the line"). Next time the gate opens, the hint
   is more specific.
9. **She asks a question** in the ask box: "why does it print the last number?"
   Questions skip the gate and cost nothing. The AI uses `explain`.
10. **She solves it.** The output is `27`. The exercise is marked solved and
    saved to Supabase. The teacher uses `confirm_success`: *"That's it! Why did
    moving the line fix it?"*

**What if the AI was down at step 5?** The server (or the browser, if the server
itself is unreachable) uses the hand-written step-1 hint instead. Maya never
notices anything broke. The top bar quietly says "hints: pre-written".

---

## 5. Features, one by one

| Feature | What it does | Why it's there |
|---|---|---|
| **Python in the browser** | Runs real Python with no install and no server | Free, private, safe, works offline after loading |
| **Stop button** | Kills runaway code instantly and restarts Python | Beginners write infinite loops; the page must never freeze |
| **Stuck detection** | Scores your behaviour 4 times a second | So help arrives when you're stuck, not while you think |
| **The gate** | Threshold, 45 s cooldown, 8 interruptions max | So the teacher is never naggy |
| **5-step hint ladder** | Nudge → line → concept → example → walk-through | Teaches you to find the answer instead of copying it |
| **Hint "didn't land" detection** | Same code as last hint → climb a step | Repeating a hint that didn't work is pointless |
| **Misconception detectors** | 7 shapes of classic loop mistakes | Some bugs make no error; only code shape reveals them |
| **Plain-English errors** | 16 rules turn scary errors into simple advice | Instant, free, never wrong |
| **Ask anything** | Type a question; the teacher explains | Explaining ideas is fine; handing over the answer isn't |
| **Voice questions** | Speak your question; it's typed into the box for you to check | Easier for some learners; checked so mistakes don't mislead |
| **Teacher reads aloud** | ElevenLabs voice, browser voice as backup | Accessibility and a friendlier feel |
| **Answer-leak guard** | Blocks answer code (even said in words) before step 5 | The core promise, enforced in code |
| **Staleness check** | Throws away answers about code you already changed | Out-of-date help destroys trust |
| **Memory** | Remembers your conversation per exercise and your profile | Help that knows your history |
| **Accounts + saved progress** | Sign in, pick up where you left off | Real course, not a toy |
| **Guest mode** | Try everything without signing up | No barrier for a first try |
| **Light/dark theme, resizable panes** | Personal comfort; choices remembered | Nice to use for a long session |
| **Observer panel + export log** | See and tune the brain; download evidence | You can't tune what you can't see |
| **Always-on fallback** | Hand-written hints whenever anything fails | "The lesson never stalls" |

---

## 6. The ideas and methods behind it

These are the "how we think" parts. They're often more impressive in a pitch
than any single tool.

### 6.1 Scaffolding (from education research)

**Scaffolding** means giving just enough support for the learner to climb the
next step themselves, then taking the support away. The 5-step ladder is
scaffolding. The `ask_question` tool is **Socratic questioning**: answering a
question with a better question so the learner does the thinking.

### 6.2 Separation of concerns

Every part has **one job**: the Observer decides *when*, the AI decides *what*,
the guards decide *if it's allowed*, and the runner runs code. When something
goes wrong, you know exactly where to look.

### 6.3 "The model proposes, the server disposes"

The AI makes suggestions. **Our code decides** what actually happens. The hint
step belongs to the browser, not the AI, and every answer is validated. This is
how you build something reliable on top of something unpredictable.

### 6.4 Defence in depth

"Never give the answer early" is protected in **three layers**: the prompt asks
the AI not to; `sanitise` checks the hint step; `leakguard` scans the actual
text. If one layer fails, the next catches it. (Same idea as a castle with a
moat, a wall and a gate.)

### 6.5 Graceful degradation (never stall)

Every possible failure (AI down, rate limited, broken answer, leaked answer,
server asleep, no voice credits) lands on something that still works:
hand-written hints, or the browser's voice. **Optional things are truly
optional**: no Supabase means no accounts, no AI key means only hand-written
hints, and the editor works even with the server off.

### 6.6 Structured output (tool calling)

Instead of asking the AI for free text and hoping, we make it fill in a form
(a tool with fixed fields). Forms can be checked by code. We even learned that
letting fields be "empty or a number" broke about 1 in 5 answers, so every
field is always filled with a clear value instead.

### 6.7 Deterministic vs. probabilistic

The Observer is **deterministic**: the same input always gives the same score,
and the panel shows exactly why. The AI is **probabilistic**: it might word
things differently each time. We keep the important decisions (when to speak,
which step) in the deterministic part.

### 6.8 Sandboxing and privacy by design

Learner code **never runs on our server**. It runs in a disposable worker in the
learner's own browser, so there's nothing to hack on our side. Voice recordings
are held in memory for one request and dropped. Fonts and icons are bundled in,
so drawing the page doesn't involve fetching anything from font or icon companies.

### 6.9 Cost control

AI calls cost money (or free-tier quota). So: **rate limits** per person,
**caching** (identical questions replay for free), a **daily character budget**
for the voice, the **dictionary before the AI** for errors, and a **pause** after
"out of credits" so we stop knocking on a closed door.

### 6.10 Evidence over vibes

The project began as a test of one claim: *can an observer tell "stuck" from
"thinking" well enough that a teacher speaking on that signal feels helpful?*
Every event is logged with timestamps, and the plan is to test with **three
people who can't code, 15 minutes each**, counting:

- times the teacher spoke while they were mid-thought (want: ~0),
- times they sat visibly stuck while it stayed silent (want: ~0),
- whether anyone finished the loop exercise before hint step 5 (want: at least one).

### 6.11 Built in phases

The test files are named after the phases the project was built in:
**phase 1** editor + running code → **phase 2** the Observer → **phase 3**
lessons + hint ladder → **phase 4/5** the AI teacher and how it's shown →
**phase 6** memory, explanations, and "did the hint land?". Then accounts,
pages, deployment, and voice. Each phase works on its own before the next one
is added. That's called **incremental development**.

### 6.12 Automated testing with fakes

Real services (the AI, ElevenLabs, Supabase, the microphone, the speech engine)
are replaced with **fakes** in tests, so tests are fast, free, and repeatable,
and can simulate failures (like "out of credits") on demand.

### 6.13 Continuous deployment

Push code to GitHub → Vercel and Render **automatically** rebuild and publish
it. No manual uploading.

---

## 7. Every technology, why we chose it, and the alternatives

For each one: **what it is**, **why we picked it**, and **what else we could
have used** (and when that would be better).

### 7.1 In the browser (frontend)

| Tech | What it is | Why we chose it | Alternatives (and when they'd be better) |
|---|---|---|---|
| **TypeScript** | JavaScript plus *types* (you declare "this is a number") | Catches mistakes before the code even runs; big projects stay sane | **Plain JavaScript**: quicker to start, but bugs show up later. For a project this size, TypeScript is the better choice. |
| **React 18** | Library for building UIs from components | Huge community, lots of help online, works well with editors and stores | **Svelte** or **SolidJS**: smaller and faster, could be better for performance. **Vue**: easier for beginners. React won on familiarity and ecosystem. |
| **Vite** | Dev server + bundler (packages the code for the web) | Starts instantly, reloads on save, handles Web Workers well, proxies `/api` to our server | **Webpack**: older and slower to configure. **Next.js**: adds server-side rendering we don't need since our pages are simple. Vite is the right fit. |
| **CodeMirror 6** | The code editor component | Light, and its extension system lets us plug in the Observer and put hints *inside* the editor | **Monaco** (the editor inside VS Code): more features like autocomplete, but much heavier and harder to put widgets inside. It's better if you want a "real IDE" feel. |
| **Zustand** | A tiny "store" holding app-wide state (hint step, solved, speech…) | Very small and simple, no boilerplate | **Redux**: more structure, more code. **React Context**: built in, but re-renders too much. Zustand is the sweet spot here. |
| **wouter** | A tiny page router (which URL shows which page) | Only a few KB; we have just 4 pages | **React Router**: the standard, more features, bigger. Better for big apps with many nested pages. |
| **Pyodide** | Real Python (CPython) compiled to WebAssembly | Real Python with the real standard library, runs free in the learner's browser, safe, private | **Server sandboxes** (Docker, or services like **Judge0**): faster first load and can run heavy libraries, but cost money and need security work. **Skulpt/Brython**: lighter, but not real Python, so behaviour differs. Pyodide's downside is a ~10 MB first download. |
| **Web Worker + Comlink** | A background lane for code, and a helper to talk to it easily | The only way to stop an infinite loop is to kill the worker | Running on the main thread would freeze the page. There's no real alternative for "Stop must always work". |
| **Web Speech API** (`speechSynthesis`) | The browser's built-in voice | Free, works with no server, perfect as a backup voice | Quality depends on the device; robotic on some Linux setups. That's why it's the *fallback*, not the main voice. |
| **MediaRecorder** | Built-in browser recording | Records the mic with no extra libraries | Browser speech *recognition* exists too, but not in every browser, and Chrome's sends your audio to Google anyway. Whisper is more accurate for code words. |
| **Self-hosted fonts + inline SVG icons** | Fonts and icons shipped with the site | No requests to other companies' servers (privacy, speed) | Google Fonts / icon fonts: easier, but every learner's browser would contact a third party. |

### 7.2 On the server (backend)

| Tech | What it is | Why we chose it | Alternatives (and when they'd be better) |
|---|---|---|---|
| **Python 3.13** | Programming language | Best AI/data ecosystem; matches the subject being taught | **Node.js** (JavaScript): one language for the whole project. Would be a fine choice too. |
| **FastAPI** | Web framework for building APIs | Fast, async (handles many waits at once), streams responses easily, validates input automatically | **Flask**: simpler but older style, weaker at streaming. **Django**: lots built in (admin, ORM) we don't need. **Express/Hono** (Node): good if we'd chosen Node. |
| **uvicorn** | The server program that runs FastAPI | Standard, fast, reloads on save during development | **Hypercorn**, **Gunicorn + workers**: for scaling to more processes later. |
| **Pydantic** | Data validation | Rejects badly-shaped requests before our code touches them | Hand-written checks: more code, more mistakes. |
| **openai Python SDK** | Library for talking to AI models | Groq, Ollama, Gemini and others all speak the same "OpenAI-compatible" format, so we can switch provider with 3 settings | Each provider's own SDK: ties you to one company. |
| **httpx** | Library for making web requests | Async, and it's what the openai SDK already uses; we use it to call ElevenLabs | **requests**: popular but not async; it would block the server while waiting. |
| **python-dotenv** | Loads secret settings from a `.env` file | Keeps keys out of the code | Setting environment variables by hand every time. |
| **Server-Sent Events (SSE)** | One-way stream from server to browser | Perfect for "words arriving bit by bit"; works over normal HTTP | **WebSockets**: two-way, more complex. Only better if the server needed to push things to the browser unprompted. |
| **PyJWT** | Checks login tokens | Verifies that a Supabase sign-in is real, without calling Supabase every time | Asking Supabase on each request: slower. |

### 7.3 AI and voice services

| Tech | What it is | Why we chose it | Alternatives (and when they'd be better) |
|---|---|---|---|
| **Groq** | AI cloud with very fast chips | Very fast answers (a learner is waiting) and a free tier | **Claude, GPT, Gemini** (paid APIs): usually smarter and better at following tricky rules. Better for quality, but they cost money. **Ollama**: run a model on your own computer, free and fully private, but slower and needs a good machine. |
| **gpt-oss-120b** | An open-weight AI model | Good at tool calling, free on Groq | Bigger paid models: better explanations. Smaller models: faster but more mistakes. We have a test (`validate-tools`) to check any model before trusting it. |
| **Whisper** (on Groq) | Speech-to-text AI | Accurate, can be hinted with Python words, uses the same key as the teacher | **Deepgram**, **AssemblyAI**: real-time streaming, can be better for live captions. Browser recognition: free, but missing in some browsers and weaker on code words. |
| **ElevenLabs** | AI voice generation | The most natural-sounding voices | **Groq Orpheus** or **OpenAI TTS**: cheaper (roughly half the price per character or less), slightly less natural. The **browser voice** is free but varies by device, which is why we kept it as the backup. |

### 7.4 Data, hosting and tools

| Tech | What it is | Why we chose it | Alternatives (and when they'd be better) |
|---|---|---|---|
| **Supabase** | Hosted Postgres database + login system | Real SQL database, row-level security so the browser can talk to it safely, generous free tier, open source | **Firebase**: similar, but a NoSQL database (less structured) and Google-only. **Our own Postgres + login code**: full control, far more work and more ways to get security wrong. |
| **Vercel** | Hosts the website | Puts the static site on a global CDN (fast everywhere), never sleeps, auto-deploys on every push | **Cloudflare Pages**: very similar and very generous free bandwidth, a good alternative. **Netlify**: also similar. **GitHub Pages**: free but fewer features (like the rewrite rules our pages need). |
| **Render** | Hosts the API server | Free tier, and the whole setup is in a file (`render.yaml`, "infrastructure as code") | **Railway**, **Fly.io**: small paid plans that don't sleep; better for a smooth live demo. A **paid Render plan** fixes the sleeping too. Render's free plan sleeps after 15 minutes idle and takes about a minute to wake. |
| **GitHub** | Stores the code and its history | Standard; Vercel and Render watch it and deploy on push | **GitLab**, **Bitbucket**: similar. |
| **Docker** (Dockerfile) | Packs the whole app into one container | Lets you host everything in one place if you want | Not used for the live site (and not yet tested). |
| **Puppeteer** | Controls a real Chrome browser from code | Tests click through the *real* app in a *real* browser | **Playwright**: can also test Firefox and Safari, better for cross-browser checks. **Cypress**: nicer test UI. |
| **Custom test scripts** | Each test prints PASS/FAIL | Simple, no framework to learn | **Vitest/Jest** (JS) and **pytest** (Python): nicer reports and tools; better as the project grows. |
| **esbuild** | Very fast bundler | Builds TypeScript tests in milliseconds | **tsc** alone: slower. |

---

## 8. How it is hosted (deployment)

```
   You push code to GitHub (main branch)
          │
          ├──►  Vercel builds the website  ──►  https://teaching-ide.vercel.app
          │       (static files on a CDN; never sleeps)
          │
          └──►  Render rebuilds the API (only if server files changed)
                  ──►  https://teaching-ide-api.onrender.com
```

- **Why split them?** Almost everything happens in the browser, so the website
  is just files. Files are cheap to serve and never need to "wake up". Only the
  AI phrasing and the voice need the server.
- **Settings and secrets** (AI key, ElevenLabs key, Supabase URL) live in each
  host's dashboard, never in the code.
- **CORS** (Cross-Origin Resource Sharing) is a browser safety rule. Our website
  and our server live at **different addresses** (vercel.app and onrender.com).
  Before the website talks to the server, the browser asks the server: "is
  this website allowed to read your replies?" The server answers from its
  guest list, `ALLOWED_ORIGINS`. If the website's address isn't on it, the
  browser blocks the replies and you only get hand-written hints. Note that CORS
  protects people's *browsers*; it doesn't stop a script from calling the
  server, which is why we also have rate limits.
- **The sleeping server:** on Render's free plan, the first visitor after 15
  quiet minutes waits about a minute for the API to wake. The lesson pings the
  server as it opens, and hints fall back to hand-written ones until it's awake.
  **Tip for a demo:** open the site a couple of minutes early.

---

## 9. How we know it works (testing)

There are **21 test suites**, run with `npm test`. Two kinds:

- **Unit tests** check one piece on its own with no browser or internet: the
  stuck score, the gate, the misconception detectors, the leak guard, the error
  dictionary, the server's limits, how code is turned into speech, and so on.
- **Browser tests** open a **real Chrome**, load the **real app**, and click
  through it like a person would: typing code, running it, getting hints,
  signing in, using the mic, turning on the voice.

Outside services are swapped for **fakes**: a fake AI, a fake Supabase, a fake
microphone, a fake speech engine, a fake ElevenLabs that can pretend to be
"working", "slow", "down" or "out of credits". That way the tests are free,
fast, and can test failures on purpose.

There's also `npm run validate-tools`, which fires 30 real requests at the AI to
check it fills in its "forms" correctly at least 95% of the time before we
trust a new model.

---

## 10. Honest limits

Knowing your weak spots makes you *more* convincing in a pitch.

- **Only Python works so far.** There's groundwork for a JavaScript runner, but
  the Observer's code analysis, error dictionary and teacher prompt are all
  Python-specific.
- **The free AI tier is small.** Only a few teacher calls a minute across *all*
  users; beyond that, everyone gets hand-written hints (still works, just less
  personal).
- **The server sleeps** on the free plan (about a minute to wake).
- **Rate limits live in memory,** so they reset if the server restarts and
  don't share between multiple server copies (a shared store like **Redis**
  would fix that).
- **The interruption budget is a courtesy, not security.** A determined person
  could get around it; the real cost protection is the per-person rate limit.
- **From hint step 3 up**, the leak guard only checks for code, not for an
  explanation that says too much in plain words.
- **The misconception detectors only know loop mistakes.**
- **Code in the editor isn't saved per exercise.** Leaving and coming back
  brings back the starter code (your progress and conversation *are* saved).
- **ElevenLabs' free plan** may refuse requests from cloud servers, in which case
  everyone hears the browser voice.
- **The real proof is a user study.** The plan is three non-programmers, 15
  minutes each (section 6.10). Until that's done, "it knows when you're stuck"
  is a well-built idea, not a proven result. If you haven't run it yet, say so
  and call it the next step.

---

## 11. Pitch: how to explain it

### The 30-second version

> "Most coding tutors either leave you stuck or give you the answer. Teaching
> IDE is a Python editor with a teacher built in that watches *how* you work.
> It can tell when you're stuck rather than thinking, and only then gives you a
> hint. Hints climb a five-step ladder, and code blocks the answer until the last
> step. Python runs right in your browser, the teacher can talk and listen, and
> if the AI ever fails, you still get a hand-written hint instantly. It never
> stalls."

### The 2-minute demo path

1. Open the lesson (opened a few minutes early so the server's awake). Turn on
   the **speaker**.
2. On "Say hello", type something wrong, run it, and see the **plain-English error**.
3. Sit still and let the **teacher speak on its own** (it takes about 30 to 40
   seconds after an error, by design). Meanwhile open the **eye** panel to show
   the stuck score climbing and the gate opening.
4. **Ask by voice**: "what do the quotes do?" Show it lands in the box, then send.
5. Type "just tell me the answer" and show it **asks a question back** instead.
6. Solve it and show the **success** message (read aloud).
7. Optional: point at the top bar's "hints: pre-written" to explain the fallback.

### Three things to emphasise

1. **When vs. what**: rules decide when, AI decides what, code checks it.
2. **Never the answer early**: enforced in three layers, not just a prompt.
3. **Never stalls**: every failure has a fallback.

---

## 12. Questions people might ask

**"Isn't this just ChatGPT in an editor?"**
No. ChatGPT answers whenever you ask and will give the answer if you push. Here,
a separate rule-based Observer decides *when* help appears, the hint step is
controlled by our code, and a guard blocks answer code before the last step.

**"How does it know I'm stuck?"**
It scores signals like idle time after an error, editing the same line again and
again, and edits that don't change the program, four times a second. A gate adds
a cooldown and a budget so it's never naggy.

**"What if the AI is wrong or down?"**
Every hint has a hand-written version. Any failure (slow, down, rate-limited,
leaked answer) falls back to it instantly.

**"Is running my code safe?"**
Your code runs inside your own browser in a disposable sandbox (a Web Worker),
never on our server. Infinite loops are killed with Stop.

**"How much does it cost to run?"**
Hosting is on free tiers. The AI is on Groq's free tier. The voice uses
ElevenLabs credits, but only for learners who turn the speaker on, and repeated
hints are replayed from memory for free. There are daily limits so costs can't
run away.

**"Why not use a paid AI like Claude or GPT?"**
We could, and they'd likely explain better. Switching is three settings. We
chose a fast free option to prototype, and the guards don't depend on which
model is used.

**"Is it secure?"**
Several layers: the server only accepts browser requests from our own website
(CORS); it checks sign-in tokens (JWTs) are genuinely from Supabase; the database
only lets you touch your own rows (row-level security); every person has rate
limits; secret keys live only on the server; and learner code never runs on the
server at all.

**"What about privacy?"**
Voice recordings aren't stored. Code runs locally. The database only lets each
person read their own rows. Guests can use it without an account.

**"How do you know it actually helps?"**
With a test of three non-programmers, 15 minutes each, counting how often the
teacher interrupted thinking or missed someone stuck. The app records every
event with timestamps, so the answer comes from evidence, not opinion. (Say
honestly whether you've run it yet.)

**"What would you build next?"**
More languages (JavaScript groundwork exists), more misconception detectors,
saving the editor's code per exercise, moving rate limits to a shared store,
and the real-user study if it hasn't been done.

---

## 13. Glossary

| Word | Meaning |
|---|---|
| **API** | A set of "doors" one program offers so other programs can ask it to do things. |
| **AST** (Abstract Syntax Tree) | A tree-shaped X-ray of code that shows its structure, ignoring spaces and comments. |
| **Async** | Code that can wait for something (like a network reply) without freezing everything else. |
| **Backend** | The part that runs on a server, not in your browser. |
| **Cache** | A memory of past answers so you don't have to work them out (or pay for them) again. |
| **CDN** | A network of servers around the world that serve website files from somewhere close to you. |
| **Component** | A reusable piece of interface (a button, a panel) in React. |
| **CORS** | A browser rule controlling which websites may read replies from an API. |
| **Deploy** | Publishing code so people can use it online. |
| **Endpoint** | One specific "door" on an API, like `/api/teach`. |
| **Environment variable** | A setting (often a secret key) given to a program from outside its code. |
| **Fallback** | The backup plan when the main plan fails. |
| **Origin** | A website's address: scheme + host + port, like `https://teaching-ide.vercel.app`. |
| **Frontend** | The part that runs in your browser: what you see and click. |
| **IDE** | A program for writing code. |
| **JWT** | A signed digital "ticket" proving who you are after signing in. |
| **LLM** | Large Language Model: the kind of AI that writes text (like ChatGPT). |
| **Open-weight model** | An AI model whose internals are published so anyone can run it. |
| **Prompt** | The instructions and context given to an AI. |
| **Rate limit** | A cap on how many requests someone can make in a time window. |
| **Row-level security (RLS)** | Database rules that check, row by row, who may read or change each row. |
| **SDK** | A ready-made library for talking to a service. |
| **SSE** (Server-Sent Events) | A way for a server to stream messages to a browser over one connection. |
| **Stub / fake** | A pretend version of a real service, used in tests. |
| **Tool calling** | Making an AI respond by "pressing a button" with filled-in fields, instead of free text. |
| **TTS / STT** | Text-to-speech (making a voice) / speech-to-text (understanding a voice). |
| **WebAssembly** | A fast, safe format that lets languages like Python run inside a browser. |
| **Web Worker** | A background lane in the browser that can run code without freezing the page. |
