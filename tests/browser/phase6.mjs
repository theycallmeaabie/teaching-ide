/**
 * The product teacher, as the browser sees it: what it is told, what it keeps,
 * what it does when a hint does not land. Deterministic — the model's side is a
 * crafted stream, so what is under test is this app's handling of the teacher,
 * not the weather at the provider.
 */
import puppeteer from 'puppeteer-core'
import { watchReloads } from '../support/reload-guard.mjs'
import { asGuest, LESSON } from '../support/guest.mjs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await b.newPage()
await asGuest(page)
const reloads = watchReloads(page, 1)
await page.setViewport({ width: 1500, height: 950 })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

// ------------------------------------------------ a stand-in for the model
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('')
const EXPLAIN = sse([
  ['tool', { tool: 'explain' }],
  ['delta', { text: 'print shows whatever is in the brackets on the screen.' }],
  ['done', { tool: 'explain', source: 'llm', note: null, doc_version: 1, args: {
    text: 'print shows whatever is in the brackets on the screen.',
    example: 'print("good morning")',
    followup_question: 'What do you think happens without the quotes?',
  } }],
])
const hintAt = (tier) => sse([
  ['tool', { tool: 'give_hint' }],
  ['delta', { text: `A hint at rung ${tier}.` }],
  ['done', { tool: 'give_hint', source: 'llm', note: null, doc_version: 1, args: { tier, text: `A hint at rung ${tier}.`, target_line: 0 } }],
])

const sent = []
let reply = () => EXPLAIN

await page.goto(LESSON, { waitUntil: 'networkidle2' })
await page.waitForFunction(() => document.querySelector('.status')?.textContent.trim() === 'ready', { timeout: 90000 })
await page.waitForFunction(() => !!window.__teaching && !!window.__bridge, { timeout: 20000 })

// Only once Python has booted: interception holds the worker's own requests too,
// and the runtime would never start.
await page.setRequestInterception(true)
page.on('request', (r) => {
  if (!r.url().includes('/api/teach') || r.method() !== 'POST') return r.continue()
  let body = {}
  try { body = JSON.parse(r.postData() ?? '{}') } catch { /* not ours */ }
  sent.push(body)
  r.respond({ status: 200, contentType: 'text/event-stream', body: reply(body) })
})

let failures = 0
const check = (n, p, d = '') => { if (!p) failures++; console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }
const store = () => page.evaluate(() => { const s = window.__store.getState(); return { ...s, set: undefined } })
const setDoc = (src) => page.evaluate((src) => { const v = window.__editorView; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: src } }) }, src)
const clickRun = async () => { for (const x of await page.$$('button')) if ((await x.evaluate(n => n.textContent.trim())) === 'Run') return x.click() }
const runAndWait = async (src) => {
  const before = await page.evaluate(() => window.__teachingIde.observer.log.all().filter(e => e.type === 'run').length)
  await setDoc(src); await sleep(900); await clickRun()
  await page.waitForFunction((n) => window.__teachingIde.observer.log.all().filter(e => e.type === 'run').length > n, { timeout: 30000 }, before)
  await sleep(500)
}
const idx = (id) => page.evaluate(async (id) => (await import('/src/lesson/exercises.ts')).indexOfExercise(id), id)
const goTo = async (id) => { await page.evaluate((i) => window.__teaching.goToExercise(i), await idx(id)); await sleep(500) }
const ask = async (q) => {
  const n = sent.length
  await page.evaluate((q) => window.__teaching.askTeacherQuestion(q), q)
  await page.waitForFunction(() => !window.__store.getState().teacherBusy, { timeout: 20000 })
  await sleep(1400) // the paced reveal
  return sent[n]
}
const gate = async () => {
  const n = sent.length
  await page.evaluate(() => window.__bridge.requestTeaching('gate'))
  await page.waitForFunction(() => !window.__store.getState().teacherBusy, { timeout: 20000 })
  await sleep(1400)
  return sent[n]
}

// ------------------------------------------------- what the model is told
console.log('--- What the teacher is told -----------------------------------')
await goTo('say-hello')
let body = await ask('what does print do?')
check('it is told which part of the ramp this is', body.exercise_section === 'output', body.exercise_section)
check('...and what the exercise is about', /printing text/.test(body.exercise_concept), body.exercise_concept)
check('a newcomer has no profile', body.profile === null)
check('the question itself arrives', body.learner_question === 'what does print do?' && body.trigger === 'ask')
check('a sitting has an id the server can count against', typeof body.session_id === 'string' && body.session_id.length >= 8, body.session_id)
check('nothing has been said yet that could have failed to land', body.previous_hint_failed === false)

// ----------------------------------------------------------------- explain
console.log('\n--- It can explain ---------------------------------------------')
let s = await store()
check('an explanation is an explanation, not a hint', s.speech?.kind === 'explain', s.speech?.kind)
check('...with no rung number', s.speech?.tier === null)
check('...and its text arrives', s.speech?.text.startsWith('print shows'), s.speech?.text?.slice(0, 40))
check('its example goes beside their code, not into it', s.speech?.scratch === 'print("good morning")', s.speech?.scratch)
check('...and the scratch pane shows it', !!(await page.$('.scratch-pane')))
check('its follow-up question is kept', /without the quotes/.test(s.speech?.followup ?? ''))
const label = await page.$eval('.cm-speech-label', n => n.innerText).catch((e) => 'ERR ' + e.message)
check('it is labelled as an explanation', /explanation/i.test(label), JSON.stringify(label))
check('explaining is not a rung on the ladder', s.hintsGiven === 0, `hintsGiven=${s.hintsGiven}`)
check('...and it does not move the ladder', s.tier === 1)

// ------------------------------------------------------------------ memory
console.log('\n--- It remembers ----------------------------------------------')
check('both sides of the exchange are kept', s.recent.length === 2 && s.recent[0].role === 'learner' && s.recent[1].role === 'teacher', JSON.stringify(s.recent.map(t => t.role)))
check('the conversation panel appears', !!(await page.$('.convo')))
check('...and opens itself, because the learner just spoke', (await page.$$('.convo-turn')).length === 2)
check('...showing what was said', (await page.$eval('.convo-body', n => n.innerText)).includes('what does print do?'))
const chips = await page.$$eval('.convo-chip', (ns) => ns.map((n) => n.textContent))
check('the teacher\'s turn says what kind of reply it was', chips.length === 1 && /explanation/i.test(chips[0]), JSON.stringify(chips))
check('...and the learner\'s own turn carries no label of that kind', (await page.$$('.convo-learner .convo-chip')).length === 0)
check('a turn remembers its kind, so it survives a refresh', (await store()).recent[1].kind === 'explain', JSON.stringify((await store()).recent[1].kind))
const type = await page.evaluate(() => {
  const text = getComputedStyle(document.querySelector('.convo-text')).fontSize
  const small = [...document.querySelectorAll('.convo-who, .convo-chip')].map((n) => parseFloat(getComputedStyle(n).fontSize))
  const wraps = [...document.querySelectorAll('.convo-who, .convo-chip')].some((n) => n.getBoundingClientRect().height > 20)
  return { text, smallest: Math.min(...small), wraps }
})
check('conversation text is 15px', type.text === '15px', type.text)
check('labels are never below 11px and never wrap', type.smallest >= 11 && !type.wraps, `${type.smallest}px, wraps=${type.wraps}`)
check('the log still fills the dock, so dragging its edge keeps working',
  await page.$eval('.convo-body', (n) => { const c = getComputedStyle(n); return c.flexGrow === '1' && c.overflowY === 'auto' && c.minHeight === '0px' }))

body = await ask('and what are the quotes for?')
check('the next question carries the earlier exchange', body.recent.length === 3 && body.recent[0].text === 'what does print do?',
  JSON.stringify(body.recent.map(t => t.role)))
check('...including what the teacher answered', body.recent.some(t => t.role === 'teacher' && /brackets/.test(t.text)))

await goTo('two-lines')
s = await store()
check('another exercise starts its own conversation', s.recent.length === 0)
check('...and the panel goes away with it', !(await page.$('.convo')))
await goTo('say-hello')
s = await store()
check('coming back, the conversation is still there', s.recent.length === 4, `${s.recent.length} turns`)
check('...in the panel too', !!(await page.$('.convo')))

// ----------------------------------------------- a hint that did not land
console.log('\n--- A hint that did not land ------------------------------------')
reply = (body) => hintAt(body.tier)
await goTo('sum-them')
await setDoc('nums = [3, 7, 12, 5]\nfor n in nums:\n    total = 0\n    total = total + n\nprint(total)\n')
await sleep(900)
body = await gate()
check('the first hint goes out at the ladder as it stands', body.tier === 1 && body.previous_hint_failed === false, `tier=${body.tier}`)
s = await store()
check('...and lands as a hint', s.speech?.kind === 'hint' && s.speech.tier === 1)

body = await gate()
check('asked again on the SAME code, it is told the last hint did not land', body.previous_hint_failed === true)
check('...and the ladder climbs instead of repeating', body.tier === 2, `tier=${body.tier}`)
check('...for the learner as well as the model', (await store()).tier === 2)

body = await gate()
check('and keeps climbing while nothing changes', body.tier === 3 && body.previous_hint_failed === true, `tier=${body.tier}`)

await setDoc('nums = [3, 7, 12, 5]\nfor n in nums:\n    total = total + n\nprint(total)\n')
await sleep(900)
body = await gate()
check('once the code changes, the last hint might have helped', body.previous_hint_failed === false)
check('...so it does not climb again', body.tier === 3, `tier=${body.tier}`)

body = await ask('is this closer?')
check('a question is answered where the ladder is, not pushed up it', body.tier === 3)

// ------------------------------------------------------------ who they are
console.log('\n--- Who they are -----------------------------------------------')
await goTo('say-hello')
reply = () => EXPLAIN
await runAndWait('print("Hello, world!")\n')
await sleep(1500)
await goTo('two-lines')
body = await ask('how do I print two things?')
check('having solved something, they have a profile', body.profile && body.profile.solved === 1 && body.profile.total === 20, JSON.stringify(body.profile))

// ------------------------------------------------- leaving mid-answer
console.log('\n--- Leaving while it is thinking ---------------------------------')
let release
const held = new Promise((r) => { release = r })
page.removeAllListeners('request')
page.on('request', async (r) => {
  if (!r.url().includes('/api/teach') || r.method() !== 'POST') return r.continue()
  await held
  r.respond({ status: 200, contentType: 'text/event-stream', body: EXPLAIN })
})
await goTo('say-hello')
await page.evaluate(() => { window.__teaching.askTeacherQuestion('slow question') })
await sleep(400)
await goTo('add-two')
release()
await sleep(2000)
s = await store()
check('an answer to a question they have walked away from is not shown', s.speech === null, JSON.stringify(s.speech)?.slice(0, 80))
check('...and is not filed under the exercise they are on now', s.recent.length === 0, `${s.recent.length} turns`)

check('the page was not reloaded by the dev server mid-run', reloads() === 0, reloads.detail())

check('no uncaught page errors', errors.length === 0, errors.join(' | ').slice(0, 200))
console.log(failures ? `\n${failures} check(s) failed` : '\nALL PHASE 6 CHECKS PASSED')
await b.close()
process.exit(failures ? 1 : 0)
