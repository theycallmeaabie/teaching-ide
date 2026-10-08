/**
 * Accounts, saved progress and the teacher's memory, against a fake Supabase.
 *
 * Starts its own copy of the app on another port, wired to the fake, so it
 * touches neither your real project nor the dev server. Signing in happens on the
 * sign-in page (see pages.mjs for that page itself); here it is the way in to
 * what a signed-in learner keeps.
 */
import puppeteer from 'puppeteer-core'
import { watchReloads } from '../support/reload-guard.mjs'
import { asGuest } from '../support/guest.mjs'
import { spawn } from 'node:child_process'
import { start, db, uuidFor } from '../support/fake-supabase.mjs'

const APP = 5199
const FAKE = 54399
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (n, p, d = '') => { if (!p) failures++; console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

const fake = await start(FAKE)
const vite = spawn('npx', ['vite', '--port', String(APP), '--strictPort'], {
  env: { ...process.env, VITE_SUPABASE_URL: `http://127.0.0.1:${FAKE}`, VITE_SUPABASE_ANON_KEY: 'fake-anon-key' },
  stdio: 'ignore', detached: true,
})
const stopAll = () => { try { process.kill(-vite.pid) } catch { /* already gone */ } fake.close() }
process.on('exit', stopAll)

for (let i = 0; i < 60; i++) {
  if (await fetch(`http://localhost:${APP}/`).then((r) => r.ok).catch(() => false)) break
  await sleep(1000)
}

const A = 'a@test.dev', B = 'b@test.dev', C = 'c@test.dev'
const idA = uuidFor(A)
db.progress.push(
  { user_id: idA, exercise_id: 'say-hello', solved: true, tier: 1, attempts: 0, hints_given: 0, begs: 0, seen: [], thread: [] },
  { user_id: idA, exercise_id: 'sum-them', solved: false, tier: 4, attempts: 3, hints_given: 3, begs: 2, seen: ['accumulator-init-inside-loop'],
    thread: [{ role: 'learner', text: 'why is my total wrong?' }, { role: 'teacher', text: 'Look at where the total is created.' }] },
)

const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await b.newPage()
await asGuest(page)
const reloads = watchReloads(page, 2)
await page.setViewport({ width: 1500, height: 950 })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

const store = () => page.evaluate(() => { const s = window.__store.getState(); return { ...s, set: undefined } })
const setDoc = (src) => page.evaluate((src) => { const v = window.__editorView; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: src } }) }, src)
const doc = () => page.evaluate(() => window.__editorView.state.doc.toString())
const clickRun = async () => { for (const x of await page.$$('button')) if ((await x.evaluate(n => n.textContent.trim())) === 'Run') return x.click() }
const runAndWait = async (src) => {
  const before = await page.evaluate(() => window.__teachingIde.observer.log.all().filter(e => e.type === 'run').length)
  await setDoc(src); await sleep(900); await clickRun()
  await page.waitForFunction((n) => window.__teachingIde.observer.log.all().filter(e => e.type === 'run').length > n, { timeout: 30000 }, before)
  await sleep(700)
}
const idx = (id) => page.evaluate(async (id) => (await import('/src/lesson/exercises.ts')).indexOfExercise(id), id)
const goTo = async (id) => { await page.evaluate((i) => window.__teaching.goToExercise(i), await idx(id)); await sleep(500) }
const flush = () => page.evaluate(async () => (await import('/src/data/sessions.ts')).flushSession())
const boot = async () => {
  await page.goto(`http://localhost:${APP}/course/python`, { waitUntil: 'networkidle2' })
  await page.waitForFunction(() => document.querySelector('.status')?.textContent.trim() === 'ready', { timeout: 90000 })
  await page.waitForFunction(() => window.__store?.getState().authReady && !!window.__teaching, { timeout: 15000 })
}
const clickText = async (sel, text) => {
  for (const x of await page.$$(sel)) if ((await x.evaluate((n) => n.textContent.trim())) === text) return x.click()
  throw new Error(`no ${sel} reading "${text}"`)
}
const lessonReady = () => page.waitForFunction(() => document.querySelector('.status')?.textContent.trim() === 'ready', { timeout: 90000 })
// Signing in is a page of its own: from the lesson, the top bar's link goes there and
// brings them back to the lesson; after a sign-out they are already on it.
const signIn = async (email, { create = false } = {}) => {
  if (!(await page.evaluate(() => location.pathname === '/signin'))) {
    await page.click('.authbar a')
    await page.waitForFunction(() => location.pathname === '/signin', { timeout: 10000 })
  }
  if (create) await clickText('button.linkish', 'Create an account')
  await page.type('input[name=email]', email)
  await page.type('input[name=password]', 'pw-123456')
  await page.keyboard.press('Enter')
  await page.waitForFunction((e) => window.__store.getState().user?.email === e, { timeout: 15000 }, email)
  await page.waitForFunction(() => window.__store.getState().progressLoaded || window.__store.getState().progressError, { timeout: 15000 })
  await page.waitForFunction(() => location.pathname === '/course/python', { timeout: 15000 })
  await lessonReady()
  await sleep(800)
}
// After a sign-out they are on the sign-in page. A guest gets the lesson with nothing of theirs.
const continueAsGuest = async () => {
  await clickText('button', 'Continue as guest')
  await page.waitForFunction(() => location.pathname === '/course/python', { timeout: 10000 })
  await lessonReady()
  await sleep(500)
}
const signOut = async () => {
  await page.evaluate(() => import('/src/auth/session.ts').then((m) => m.signOut()))
  await page.waitForFunction(() => window.__store.getState().user === null, { timeout: 10000 })
  await sleep(600)
}

try {
  await boot()
  // The teacher is not what is under test; keep it off the real API.
  await page.setRequestInterception(true)
  page.on('request', (r) => {
    // A request already in flight when interception is switched off still
    // reaches this handler, and answering it then REJECTS (asynchronously, so a
    // try/catch would not see it). Nothing is lost by letting it go.
    const quiet = () => {}
    if (r.url().includes('/api/teach') && r.method() === 'POST') {
      const text = 'It holds one item at a time.'
      const done = { tool: 'explain', source: 'llm', note: null, doc_version: 1, args: { text, example: '', followup_question: '' } }
      r.respond({ status: 200, contentType: 'text/event-stream', body: `event: tool\ndata: {"tool":"explain"}\n\nevent: done\ndata: ${JSON.stringify(done)}\n\n` }).catch(quiet)
      return
    }
    r.continue().catch(quiet)
  })

  console.log('--- Signed out ---------------------------------------------------')
  db.requests.length = 0
  await sleep(2500)
  check('nothing is sent to Supabase while signed out', db.requests.length === 0, `${db.requests.length} requests`)
  check('a sign-in control is offered', !!(await page.$('.authbar')))
  check('the lesson is fully usable signed out', (await page.$$('.dot')).length === 20)

  console.log('\n--- Sign in as A, who has been here before -------------------------')
  await signIn(A)
  let s = await store()
  check('signed in as A', s.user?.email === A)
  check('what they solved is ticked', s.solved[0] === true && s.solved[1] === false)
  check('a session row is opened straight away', db.sessions.length === 1 && db.sessions[0].user_id === idA)

  await goTo('sum-them')
  s = await store()
  check('their place on the ladder comes back', s.tier === 4 && s.attempts === 3 && s.hintsGiven === 3, `tier=${s.tier} attempts=${s.attempts}`)
  check('...and how often they asked to be told the answer', s.askedForAnswer === 2)
  check('...and the mistake they made here', s.seen.includes('accumulator-init-inside-loop'))
  check('...and the conversation the teacher had with them', s.recent.length === 2 && /total wrong/.test(s.recent[0].text), `${s.recent.length} turns`)
  check('...which is on screen', (await page.$$('.convo')).length === 1)

  console.log('\n--- Work as A, and it is kept ---------------------------------------')
  await page.evaluate(() => window.__teaching.askTeacherQuestion('what is n?'))
  await page.waitForFunction(() => !window.__store.getState().teacherBusy, { timeout: 20000 })
  await sleep(1800)
  const row = db.progress.find((r) => r.user_id === idA && r.exercise_id === 'sum-them')
  check('a new question and its answer are saved with the exercise', row.thread.length === 4, `${row.thread.length} turns saved`)
  check("...in order, and as who said them", row.thread[2].role === 'learner' && row.thread[3].role === 'teacher')

  await goTo('two-lines')
  await runAndWait('print("Hello")\nprint("Goodbye")\n')
  await sleep(1200)
  const solved = db.progress.find((r) => r.user_id === idA && r.exercise_id === 'two-lines')
  check('solving writes a progress row', solved?.solved === true)

  await goTo('say-hello')
  await runAndWait('print("A was here")\n')

  // Two saves in quick succession, the first slowed so that on the wire it would land
  // AFTER the second. A real network does this; the fake is otherwise too orderly to.
  db.progressWriteDelays = [700, 0]
  await page.evaluate(async () => {
    const { saveProgress } = await import('/src/data/progress.ts')
    const st = window.__store
    const i = st.getState().exerciseIndex
    st.getState().set({ recent: [{ role: 'learner', text: 'first' }] })
    const a = saveProgress(i)
    st.getState().set({ recent: [{ role: 'learner', text: 'first' }, { role: 'teacher', text: 'second' }] })
    const b = saveProgress(i)
    await Promise.all([a, b])
  })
  await sleep(300)
  const raced = db.progress.find((r) => r.user_id === idA && r.exercise_id === 'say-hello')
  check('a slow early save cannot overwrite a newer one', raced.thread.length === 2 && raced.thread[1].text === 'second', `${raced.thread.length} turns, last "${raced.thread.at(-1)?.text}"`)

  await flush(); await sleep(500)
  const sessA = db.sessions.find((x) => x.user_id === idA)
  check('the event log reaches the session row', sessA.event_count >= 2 && sessA.events.some((e) => e.type === 'run'), `${sessA.event_count} events`)

  console.log('\n--- A refresh ---------------------------------------------------------')
  // One more run, and then straight to the refresh with NO manual flush: the 20 s timer
  // has not fired, so the only way this reaches the database is the write made as the
  // page goes away.
  await runAndWait('print("last stretch")\n')
  const firstSession = () => db.sessions.filter((x) => x.user_id === idA)[0]
  check('before the refresh the log does not yet hold that run', !JSON.stringify(firstSession().events).includes('last stretch'))
  // Interception holds the Pyodide worker's own requests, so it is off while
  // the page boots and back on afterwards.
  await page.setRequestInterception(false)
  await page.reload({ waitUntil: 'networkidle2' })
  await page.waitForFunction(() => document.querySelector('.status')?.textContent.trim() === 'ready', { timeout: 90000 })
  await page.waitForFunction(() => window.__store?.getState().progressLoaded, { timeout: 20000 })
  await page.setRequestInterception(true)
  s = await store()
  check('still signed in', s.user?.email === A)
  check('both solved exercises survive', s.solved[0] && s.solved[await idx('two-lines')])
  await sleep(500)
  check('a refresh does not lose the last stretch of the session', JSON.stringify(firstSession().events).includes('last stretch'), `${firstSession().event_count} events`)
  await goTo('sum-them')
  s = await store()
  check('the conversation survives', s.recent.length === 4, `${s.recent.length} turns`)

  console.log('\n--- A signs out, B sits down ------------------------------------------')
  await page.evaluate(() => { window.__store.getState().set({ askedForAnswer: 2 }) })
  await goTo('say-hello')
  await runAndWait('print("A again")\n')
  const aEventsBefore = await page.evaluate(() => window.__teachingIde.observer.log.all().length)
  await signOut()
  s = await store()
  check('A is gone', s.user === null)
  check('A\'s ticks are gone', s.solved.every((x) => !x))
  check("A's place on the ladder is gone", s.tier === 1 && s.attempts === 0 && s.hintsGiven === 0, `tier=${s.tier} attempts=${s.attempts}`)
  check("A's questions are gone", s.askedForAnswer === 0 && s.recent.length === 0 && s.seen.length === 0)
  check('they are back at the start', s.exerciseIndex === 0)
  check('signing out takes them to the sign-in page', await page.evaluate(() => location.pathname === '/signin'))
  // A refresh starts a new sitting, so A has two session rows by now: the one
  // from before the refresh, and the one this stretch belongs to.
  const aSessions = db.sessions.filter((x) => x.user_id === idA)
  const sessAfter = aSessions.at(-1)
  check('a refresh starts a new session row rather than overwriting the old one', aSessions.length === 2, `${aSessions.length} rows`)
  check("A's last stretch was written BEFORE signing out, not lost", JSON.stringify(sessAfter.events).includes('A again'), `${sessAfter.event_count} events`)
  check('the observer log starts empty for the next person', (await page.evaluate(() => window.__teachingIde.observer.log.all().length)) === 0, `was ${aEventsBefore}`)

  // The next person to sit down, as a guest, gets the lesson with nothing of A's on it.
  await continueAsGuest()
  check("A's conversation is gone from the screen", !(await page.$('.convo')))
  check("A's code is gone from the editor", !(await doc()).includes('A again'), JSON.stringify((await doc()).slice(0, 30)))

  await signIn(B)
  s = await store()
  const idB = s.user.id
  check('B starts clean', s.solved.every((x) => !x) && s.recent.length === 0)
  await flush(); await sleep(500)
  const sessB = db.sessions.filter((x) => x.user_id === idB).at(-1)
  check("B's session does not contain A's activity", !JSON.stringify(sessB.events).includes('A was here') && !JSON.stringify(sessB.events).includes('A again'))
  await signOut()

  console.log('\n--- A guest becomes a learner -------------------------------------------')
  await continueAsGuest()
  await runAndWait('print("Hello, world!")\n')
  s = await store()
  check('a guest solves the first exercise', s.solved[0] === true && s.user === null)
  await signIn(C, { create: true })
  const idC = uuidFor(C)
  check('a brand-new account keeps what the guest had done', db.progress.some((r) => r.user_id === idC && r.exercise_id === 'say-hello' && r.solved === true))
  check('...and it is still ticked on screen', (await store()).solved[0] === true)
  await signOut()

  console.log('\n--- The saved progress cannot be read ---------------------------------------')
  db.failProgressReads = true
  const writesBefore = db.requests.filter((r) => r.method === 'POST' && r.path === '/rest/v1/progress').length
  await signIn(A)
  s = await store()
  check('it says so, in plain words', /nothing is being saved/i.test(s.progressError ?? ''), s.progressError)
  check('...and the notice is on screen', /nothing is being saved/i.test(await page.$eval('.auth-warn', (n) => n.innerText).catch(() => '')))
  check('...with a way to try again', !!(await page.$('.auth-retry')))
  await goTo('two-lines')
  await runAndWait('print("Hello")\nprint("Goodbye")\n')
  await sleep(800)
  const writesDuring = db.requests.filter((r) => r.method === 'POST' && r.path === '/rest/v1/progress').length
  check('nothing is written meanwhile — it could overwrite what is really there', writesDuring === writesBefore, `${writesDuring - writesBefore} writes`)
  db.failProgressReads = false
  await page.click('.auth-retry')
  await page.waitForFunction(() => window.__store.getState().progressLoaded, { timeout: 10000 })
  s = await store()
  check('trying again works, and the notice goes', s.progressError === null && !(await page.$('.auth-warn')))
  check("...and A's saved progress is back", s.solved[0] === true)

  check('the page was not reloaded by the dev server mid-run', reloads() === 0, reloads.detail())

  const real = errors.filter((e) => !/status of 500/.test(e))
  check('no uncaught page errors (the injected 500 excluded)', real.length === 0, real.join(' | ').slice(0, 200))
} catch (e) {
  // A test that died part-way has not passed, whatever it had checked so far.
  failures++
  console.log(`FAIL  the suite crashed before finishing  — ${String(e.message).split('\n')[0]}`)
} finally {
  console.log(failures ? `\n${failures} check(s) failed` : '\nALL ACCOUNT CHECKS PASSED')
  await b.close()
  stopAll()
}
process.exit(failures ? 1 : 0)
