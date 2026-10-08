/**
 * The pages around the lesson: sign-in, the course page, and the way between them.
 *
 * Starts its own copies of the app, one wired to a fake Supabase and one with no
 * Supabase at all, so it touches neither your real project nor the dev server, and
 * nothing here can create a real account. `/api/teach` is stubbed and counted:
 * one of the checks is that the teacher stays quiet, and none of them may reach a model.
 *
 * What matters about these pages, and so what is checked: nobody is shown the
 * sign-in form for a moment on the way past; a guest gets the whole lesson; where
 * someone was headed survives the sign-in, but only if it is a place on this site;
 * a returning learner continues, rather than starting again; and coming back to
 * the lesson does not have the teacher speak the instant they sit down.
 */
import puppeteer from 'puppeteer-core'
import { spawn } from 'node:child_process'
import { start, db, uuidFor, sessionFor, WRONG_PASSWORD } from '../support/fake-supabase.mjs'

const APP = 5198
const BARE = 5197
const FAKE = 54398
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (n, p, d = '') => { if (!p) failures++; console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

const fake = await start(FAKE)
const spawnVite = (port, env) =>
  spawn('npx', ['vite', '--port', String(port), '--strictPort'], { env: { ...process.env, ...env }, stdio: 'ignore', detached: true })
const vites = [
  spawnVite(APP, { VITE_SUPABASE_URL: `http://127.0.0.1:${FAKE}`, VITE_SUPABASE_ANON_KEY: 'fake-anon-key' }),
  // Blank values override whatever .env says: this one has no project to sign in to.
  spawnVite(BARE, { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' }),
]
const stopAll = () => { for (const v of vites) { try { process.kill(-v.pid) } catch { /* already gone */ } } fake.close() }
process.on('exit', stopAll)
for (const port of [APP, BARE]) {
  for (let i = 0; i < 60; i++) {
    if (await fetch(`http://localhost:${port}/`).then((r) => r.ok).catch(() => false)) break
    await sleep(1000)
  }
}

const A = 'a@test.dev'
const idA = uuidFor(A)
// A has been here before: the first exercise is solved.
db.progress.push({ user_id: idA, exercise_id: 'say-hello', solved: true, tier: 1, attempts: 0, hints_given: 0, begs: 0, seen: [], thread: [] })

const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const errors = []
// A fresh browser context is a fresh person: no stored session, no guest flag.
const person = async () => {
  const ctx = await b.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport({ width: 1400, height: 900 })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  return { ctx, page }
}

const url = (path, port = APP) => `http://localhost:${port}${path}`
const here = (p) => p.evaluate(() => location.pathname + location.search)
const waitPath = (p, path) => p.waitForFunction((x) => location.pathname + location.search === x, { timeout: 15000 }, path)
const ready = (p) => p.waitForFunction(() => document.querySelector('.status')?.textContent.trim() === 'ready', { timeout: 90000 })
const textOf = (p, sel) => p.$eval(sel, (n) => n.textContent.trim()).catch(() => null)
const store = (p) => p.evaluate(() => { const s = window.__store.getState(); return { ...s, set: undefined } })
const clickText = async (p, sel, t) => {
  for (const x of await p.$$(sel)) if ((await x.evaluate((n) => n.textContent.trim())) === t) return x.click()
  throw new Error(`no ${sel} reading "${t}"`)
}
const fill = async (p, email, password = 'pw-123456') => {
  // The address is kept when they switch between signing in, signing up and resetting,
  // so typing a different one means replacing what is there.
  await p.click('input[name=email]', { clickCount: 3 })
  await p.type('input[name=email]', email)
  if (password != null) await p.type('input[name=password]', password)
}
const signedIn = (p, email) => p.waitForFunction((e) => window.__store?.getState().user?.email === e, { timeout: 15000 }, email)

try {
  console.log('--- Someone who has not signed in --------------------------------')
  const first = await person()
  const p = first.page
  await p.goto(url('/'), { waitUntil: 'networkidle2' })
  await waitPath(p, '/signin')
  check('/ takes them to the sign-in page', true)
  check('...whose tab says where they are', (await p.title()) === 'Sign in · Teaching IDE', await p.title())
  check('...with a way in as a guest', await p.$$eval('button', (bs) => bs.some((x) => x.textContent.trim() === 'Continue as guest')))
  check('...and a way to create an account and to recover a password',
    (await p.$$eval('button.linkish', (bs) => bs.map((x) => x.textContent.trim()))).join('|') === 'Forgot your password?|Create an account')

  await p.goto(url('/course/python'), { waitUntil: 'networkidle2' })
  await waitPath(p, '/signin?next=%2Fcourse%2Fpython')
  check('a link to the lesson remembers where they were headed', true)
  await p.goto(url('/courses'), { waitUntil: 'networkidle2' })
  await waitPath(p, '/signin')
  check('/courses asks them to sign in first', true)
  await p.goto(url('/nothing-here'), { waitUntil: 'networkidle2' })
  await waitPath(p, '/signin')
  check('an address that is not a page ends up in the same place', true)

  console.log('\n--- Signing in ------------------------------------------------------')
  await p.goto(url('/course/python'), { waitUntil: 'networkidle2' })
  await waitPath(p, '/signin?next=%2Fcourse%2Fpython')
  await fill(p, A, WRONG_PASSWORD)
  await p.keyboard.press('Enter')
  await p.waitForSelector('[role=alert]', { timeout: 10000 })
  check('a wrong password says so and stays put', /invalid login credentials/i.test(await textOf(p, '[role=alert]')) && (await here(p)).startsWith('/signin'), await textOf(p, '[role=alert]'))
  await p.evaluate(() => { document.querySelector('input[name=password]').value = '' })
  await p.click('input[name=password]', { clickCount: 3 })
  await p.type('input[name=password]', 'pw-123456')
  await p.keyboard.press('Enter')
  await signedIn(p, A)
  await waitPath(p, '/course/python')
  check('signing in takes them where they were headed', true)
  await ready(p)
  check('...and the lesson is there', !!(await p.$('.lessonbar')))
  check('...with who they are in the top bar', (await textOf(p, '.auth-who')) === A)

  console.log('\n--- The course page --------------------------------------------------')
  await p.waitForFunction(() => window.__store.getState().progressLoaded, { timeout: 15000 })
  await clickText(p, '.crumbs a', 'Courses')
  await waitPath(p, '/courses')
  check('"Courses" in the top bar leads back', true)
  check('the tab says where they are', (await p.title()) === 'Courses · Teaching IDE')
  const cards = await p.$$eval('.course-card', (cs) => cs.map((c) => ({
    course: c.dataset.course, soon: c.classList.contains('soon'), links: c.querySelectorAll('a').length,
    disabled: c.getAttribute('aria-disabled'), text: c.textContent,
  })))
  check('Python is offered, and three more are on the way', cards.length === 4 && cards.filter((c) => c.soon).length === 3, cards.map((c) => c.course).join(', '))
  check('the ones to come are locked: no link, and marked disabled', cards.filter((c) => c.soon).every((c) => c.links === 0 && c.disabled === 'true' && /Coming soon/.test(c.text)))
  check('Python says how many exercises it holds', /20 exercises/.test(cards[0].text))
  check('their saved progress is on the card', /1 of 20 solved/.test(cards[0].text), cards[0].text.match(/\d+ of \d+ solved|Not started/)?.[0])
  check('...and the button says Continue', (await textOf(p, '.course-go')) === 'Continue')
  check('the progress bar says the same to a screen reader', await p.$eval('.meter', (m) => m.getAttribute('aria-valuenow') === '1' && m.getAttribute('aria-valuemax') === '20'))

  await p.click('.course-go')
  await waitPath(p, '/course/python')
  await ready(p)
  const where = await p.$eval('.lesson-count b', (n) => n.textContent)
  check('Continue opens the first exercise they have not solved, not the first', where === '2', `exercise ${where}`)

  // They are partway through exercise 4: Continue should leave them there.
  await p.evaluate(() => window.__teaching.goToExercise(3))
  await clickText(p, '.crumbs a', 'Courses')
  await waitPath(p, '/courses')
  await p.click('.course-go')
  await waitPath(p, '/course/python')
  await ready(p)
  check('...but a sitting that has moved on stays where it is', (await textOf(p, '.lesson-count b')) === '4', `exercise ${await textOf(p, '.lesson-count b')}`)

  console.log('\n--- Leaving the lesson and coming back ------------------------------------')
  // Nothing here may reach a model: the teacher is stubbed, and counted.
  let teachCalls = 0
  await p.setRequestInterception(true)
  p.on('request', (r) => {
    const quiet = () => {}
    if (r.url().includes('/api/teach')) { teachCalls++; r.abort().catch(quiet); return }
    r.continue().catch(quiet)
  })
  // Make "stuck on an error" quick to see, then fail a run and walk away at once.
  await p.evaluate(() => {
    const c = window.__teachingIde.config.config
    c.idleAfterErrorStartMs = 100
    c.idleAfterErrorFullMs = 1000
    window.__teachingIde.observer.recordRun({ ok: false, stdout: '', error: { type: 'NameError', message: "name 'x' is not defined", line: 1 }, durationMs: 1 }, false)
    window.__store.getState().set({ lastResult: { ok: false, stdout: '', error: { type: 'NameError', message: 'x', line: 1 }, durationMs: 1 }, errorPlain: 'x is not defined' })
  })
  await clickText(p, '.crumbs a', 'Courses')
  await waitPath(p, '/courses')
  let s = await store(p)
  check("what only made sense beside that code is let go: the last run's output", s.lastResult === null && s.errorPlain === null)
  check('...and the conversation and their place are kept', s.exerciseIndex === 3)

  await sleep(3500) // minutes, in effect: nobody is at the editor
  await p.click('.course-go')
  await waitPath(p, '/course/python')
  await ready(p)
  await sleep(1800)
  const idle = await p.evaluate(() => window.__teachingIde.observer.idleMs())
  const contributions = await p.evaluate(() => window.__teachingIde.observer.getSnapshot().contributions.map((c) => c.key))
  check('time spent elsewhere is not counted as being stuck', idle < 3000, `${Math.round(idle)} ms idle`)
  check('...so the run they walked away from does not read as "idle after error"', !contributions.includes('idleAfterError'), contributions.join(', ') || 'no signals')
  check('...and the teacher does not speak the moment they sit down', teachCalls === 0 && (await store(p)).speech === null, `${teachCalls} requests`)
  check('the editor is at the exercise they were on, with its starter', (await textOf(p, '.lesson-count b')) === '4')

  console.log('\n--- Signing in again does not show the form -----------------------------')
  await p.setRequestInterception(false)
  await p.evaluateOnNewDocument(() => {
    window.__sawGate = false
    new MutationObserver(() => { if (document.querySelector('.gate')) window.__sawGate = true }).observe(document, { childList: true, subtree: true })
  })
  await p.goto(url('/courses'), { waitUntil: 'networkidle2' })
  await p.waitForSelector('.course-card', { timeout: 15000 })
  check('a refresh as a signed-in learner lands on the courses, not the sign-in page', (await here(p)) === '/courses')
  check('...and the sign-in form was never shown on the way', (await p.evaluate(() => window.__sawGate)) === false)
  await p.goto(url('/signin'), { waitUntil: 'networkidle2' })
  await waitPath(p, '/courses')
  check('already signed in, /signin has nothing to ask: on to the courses', true)
  await p.goto(url('/signin?next=%2Fcourse%2Fpython'), { waitUntil: 'networkidle2' })
  await waitPath(p, '/course/python')
  check('...or to where they were headed', true)

  await clickText(p, 'button', 'Sign out')
  await p.waitForFunction(() => location.pathname === '/signin', { timeout: 15000 })
  check('signing out takes them to the sign-in page', (await store(p)).user === null)
  await first.ctx.close()

  console.log('\n--- A guest -------------------------------------------------------------')
  const g = await person()
  const gp = g.page
  await gp.goto(url('/signin?next=%2F%2Fevil.example.com'), { waitUntil: 'networkidle2' })
  await clickText(gp, 'button', 'Continue as guest')
  await waitPath(gp, '/courses')
  check('an address that is not on this site is not followed after sign-in', (await gp.evaluate(() => location.origin)) === url('').replace(/\/$/, ''), await gp.evaluate(() => location.href))
  check('a guest is told nothing is saved', /guest/i.test(await textOf(gp, '.courses-sub')) && /nothing is saved/i.test(await textOf(gp, '.courses-sub')))
  check('...and the top bar says Guest, with a way to sign in', (await textOf(gp, '.auth-who')) === 'Guest' && !!(await gp.$('.authbar a')))
  check('Python is not started', (await textOf(gp, '.course-go')) === 'Start' && /Not started/.test(await textOf(gp, '.course-count')))

  await gp.reload({ waitUntil: 'networkidle2' })
  await gp.waitForSelector('.course-card', { timeout: 15000 })
  check('a refresh keeps them in', (await here(gp)) === '/courses')

  await gp.evaluate(() => { const st = window.__store.getState(); st.set({ solved: st.solved.map((_, i) => i < 3) }) })
  check('what a guest solves shows on the card, for this sitting', /3 of 20 solved/.test(await textOf(gp, '.course-count')) && (await textOf(gp, '.course-go')) === 'Continue')

  const other = await g.ctx.newPage() // a new tab is a new sitting
  await other.goto(url('/courses'), { waitUntil: 'networkidle2' })
  await waitPath(other, '/signin')
  check('a new tab asks again', true)
  await other.close()

  await gp.goto(url('/course/javascript'), { waitUntil: 'networkidle2' })
  await waitPath(gp, '/courses')
  check('a course that is not built yet does not open', true)
  await gp.goto(url('/course/nope'), { waitUntil: 'networkidle2' })
  await waitPath(gp, '/courses')
  check('...nor does one that does not exist', true)

  await gp.click('.authbar a')
  await waitPath(gp, '/signin?next=%2Fcourses')
  check('"Sign in" from the guest top bar remembers the page they were on', true)
  await g.ctx.close()

  console.log('\n--- Creating an account -------------------------------------------------')
  const c = await person()
  const cp = c.page
  await cp.goto(url('/signin'), { waitUntil: 'networkidle2' })
  await clickText(cp, 'button.linkish', 'Create an account')
  check('the page changes to say so', (await textOf(cp, 'h1')) === 'Create your account' && (await cp.title()).startsWith('Create your account'))
  await fill(cp, 'new@test.dev')
  await cp.keyboard.press('Enter')
  await signedIn(cp, 'new@test.dev')
  await waitPath(cp, '/courses')
  check('without email confirmation, they are in and on the course page', true)
  await clickText(cp, 'button', 'Sign out')
  await cp.waitForFunction(() => location.pathname === '/signin', { timeout: 15000 })

  db.confirmSignups = true
  await clickText(cp, 'button.linkish', 'Create an account')
  await fill(cp, 'later@test.dev')
  await cp.keyboard.press('Enter')
  await cp.waitForFunction(() => document.querySelector('h1')?.textContent === 'Check your email', { timeout: 10000 })
  check('with confirmation on, they are told to check their email, and where it went', /later@test\.dev/.test(await textOf(cp, '.gate-lede')))
  check('...and are not signed in', (await store(cp)).user === null)
  await clickText(cp, 'button', 'Send it again')
  await cp.waitForSelector('[role=status]', { timeout: 10000 })
  check('...and can have it sent again', db.resends.length === 1 && db.resends[0].email === 'later@test.dev' && db.resends[0].type === 'signup', JSON.stringify(db.resends))
  await clickText(cp, 'button', 'Back to sign in')
  check('...and go back to signing in', (await textOf(cp, 'h1')) === 'Sign in')
  db.confirmSignups = false

  console.log('\n--- A forgotten password ------------------------------------------------')
  await clickText(cp, 'button.linkish', 'Forgot your password?')
  check('the page asks for an email and nothing else', (await textOf(cp, 'h1')) === 'Reset your password' && !(await cp.$('input[name=password]')))
  await fill(cp, 'forgot@test.dev', null)
  await cp.keyboard.press('Enter')
  await cp.waitForSelector('[role=status]', { timeout: 10000 })
  check('a reset link is requested, to come back to this site', db.recoveries.length === 1 && db.recoveries[0].redirectTo === url('/reset-password'), JSON.stringify(db.recoveries))
  check('...and the page says the same whoever the address belongs to', /if that address has an account/i.test(await textOf(cp, '[role=status]')))
  await c.ctx.close()

  console.log('\n--- The link in the reset email ------------------------------------------')
  const expired = await person()
  await expired.page.goto(url('/reset-password'), { waitUntil: 'networkidle2' })
  await expired.page.waitForFunction(() => document.querySelector('h1')?.textContent === 'That link has expired', { timeout: 15000 })
  check('with no session (an old or used link) they are told so', true)
  await expired.page.click('a.btn')
  await waitPath(expired.page, '/signin?mode=forgot')
  check('...and sent to ask for a new one', (await textOf(expired.page, 'h1')) === 'Reset your password')
  await expired.ctx.close()

  const r = await person()
  const rp = r.page
  const T = sessionFor('reset@test.dev')
  await rp.goto(url(`/reset-password#access_token=${T.access_token}&refresh_token=${T.refresh_token}&expires_in=3600&token_type=bearer&type=recovery`), { waitUntil: 'networkidle2' })
  await rp.waitForSelector('input[name=password]', { timeout: 15000 })
  check('following the link opens the new-password form', (await textOf(rp, 'h1')) === 'Choose a new password')
  await rp.type('input[name=password]', 'new-password-1')
  await rp.type('input[name=password-again]', 'something-else')
  await rp.keyboard.press('Enter')
  await rp.waitForSelector('[role=alert]', { timeout: 10000 })
  check('two different passwords are caught before anything is sent', /different/i.test(await textOf(rp, '[role=alert]')) && db.passwordUpdates.length === 0)
  await rp.click('input[name=password-again]', { clickCount: 3 })
  await rp.type('input[name=password-again]', 'new-password-1')
  await rp.keyboard.press('Enter')
  await waitPath(rp, '/courses')
  check('the new password is saved, and they are in', db.passwordUpdates.length === 1 && db.passwordUpdates[0].email === 'reset@test.dev' && db.passwordUpdates[0].password === 'new-password-1', JSON.stringify(db.passwordUpdates))
  await r.ctx.close()

  console.log('\n--- No Supabase project configured -------------------------------------------')
  const n = await person()
  const np = n.page
  await np.goto(url('/', BARE), { waitUntil: 'networkidle2' })
  await waitPath(np, '/courses')
  check('there is nothing to sign in to, so they go straight to the courses', true)
  check('...with no sign-in control at all', !(await np.$('.authbar')))
  await np.goto(url('/signin', BARE), { waitUntil: 'networkidle2' })
  await waitPath(np, '/courses')
  check('/signin does not strand them either', true)
  await np.goto(url('/reset-password', BARE), { waitUntil: 'networkidle2' })
  await waitPath(np, '/courses')
  check('...nor does /reset-password', true)
  await np.click('.course-go')
  await waitPath(np, '/course/python')
  await ready(np)
  check('the lesson runs as it always has', !!(await np.$('.lessonbar')))
  await n.ctx.close()

  const real = errors.filter((e) => !/status of (400|401|500)/.test(e) && !/ERR_FAILED|net::ERR/.test(e))
  check('no uncaught page errors', real.length === 0, real.join(' | ').slice(0, 240))
} catch (e) {
  // A test that died part-way has not passed, whatever it had checked so far.
  failures++
  console.log(`FAIL  the suite crashed before finishing  — ${String(e.message).split('\n')[0]}`)
} finally {
  console.log(failures ? `\n${failures} check(s) failed` : '\nALL PAGE CHECKS PASSED')
  await b.close()
  stopAll()
}
process.exit(failures ? 1 : 0)
