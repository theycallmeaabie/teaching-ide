import puppeteer from 'puppeteer-core'
import { watchReloads } from '../support/reload-guard.mjs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await b.newPage()
const reloads = watchReloads(page, 1)
await page.setViewport({ width: 1560, height: 950 })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2' })
await page.waitForFunction(() => document.querySelector('.status')?.textContent.trim() === 'ready', { timeout: 90000 })
await page.waitForFunction(() => !!window.__bridge, { timeout: 20000 })

let failures = 0
const check = (n, p, d = '') => { if (!p) failures++; console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }
const store = () => page.evaluate(() => { const s = window.__store.getState(); return { ...s, set: undefined } })
const setDoc = (src) => page.evaluate((src) => {
  const v = window.__editorView
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: src } })
}, src)
const clickRun = async () => { for (const x of await page.$$('button')) if ((await x.evaluate(n => n.textContent.trim())) === 'Run') return x.click() }
const runAndWait = async (src) => {
  const before = await page.evaluate(() => window.__teachingIde.observer.log.all().filter(e => e.type === 'run').length)
  await setDoc(src); await sleep(900); await clickRun()
  await page.waitForFunction((n) => window.__teachingIde.observer.log.all().filter(e => e.type === 'run').length > n, { timeout: 30000 }, before)
  await sleep(700)
}
const waitSpeech = (ms = 30000) => page.waitForFunction(() => !!window.__store.getState().speech, { timeout: ms })
const waitQuiet = (ms = 30000) => page.waitForFunction(() => !window.__store.getState().teacherBusy, { timeout: ms })
// Exercises are addressed by id, never by position — the ramp is allowed to grow.
const idx = (id) => page.evaluate(async (id) => (await import('/src/lesson/exercises.ts')).indexOfExercise(id), id)
const goTo = async (id) => { await page.evaluate((i) => window.__teaching.goToExercise(i), await idx(id)); await sleep(400) }

// ------------------------------------------------- error dictionary (no LLM)
await goTo('print-each')
await sleep(500)
await runAndWait('nums = [3, 7, 12, 5]\nfor n in nums:\nprint(n)\n')
await page.waitForFunction(() => !!window.__store.getState().errorPlain, { timeout: 15000 })
const plain = (await store()).errorPlain
check('error translated by the dictionary, no model call',
  /pushed in from the left/.test(plain), plain?.slice(0, 60))
check('plain-English reading is shown in the output pane', !!(await page.$('.err-plain')))

// ------------------------------------------------------ the teacher speaks
await goTo('sum-them')
await sleep(600)
await runAndWait('nums = [3, 7, 12, 5]\nfor n in nums:\n    total = 0\n    total = total + n\nprint(total)\n')
// The teacher is required to stay silent within 10s of a keystroke, so a
// gate-triggered request has to be made from a genuinely idle state.
console.log('   (waiting out the mid-thought guard…)')
await sleep(12000)
await page.evaluate(() => window.__bridge.requestTeaching('gate'))
await waitSpeech(); await waitQuiet()
let s = await store()
check('teacher returned a decision', !!s.speech, `${s.speech?.kind} / ${s.speech?.source}`)
check('hint is delivered at our tier, not the model\'s', s.speech?.tier === 1, `tier=${s.speech?.tier}`)

// --------------------------------------------- never gives the answer early
const spoken = s.speech.text
const leaks = /total\s*=\s*0|total\s*=\s*total\s*\+|total\s*\+=/.test(spoken)
check('tier-1 hint contains no literal solution code', !leaks, spoken.slice(0, 90))

// ------------------------------------------------------ inline presentation
check('hint renders inside the editor, not in a sidebar', !!(await page.$('.cm-editor .cm-speech')))
check('hint is dismissible', !!(await page.$('.cm-speech-x')))
const widgetBox = await page.$eval('.cm-speech', n => n.getBoundingClientRect().width)
check('hint is not modal (no overlay)', widgetBox > 0 && !(await page.$('.modal, .overlay')))

// -------------------------------------------------------- amber, never red
await page.evaluate(() => {
  const st = window.__store.getState()
  st.set({ speech: { ...st.speech, targetLine: 3 } })
})
await sleep(400)
check('target line gets a decoration', !!(await page.$('.cm-target-line')))
const bg = await page.$eval('.cm-target-line', n => getComputedStyle(n).backgroundColor)
const [r, g, bl] = bg.match(/[\d.]+/g).map(Number)
check('decoration is amber, not red', r > g && g > bl && !(r > 200 && g < 100), bg)

// --------------------------------------------------------------- dismissal
await page.click('.cm-speech-x')
await sleep(400)
check('dismiss clears the hint', (await store()).speech === null)

// ------------------------------------------------------------- ask is free
const budgetBefore = await page.evaluate(() => window.__teachingIde.observer.gateSnapshot().used)
await page.type('.askbox input', 'what does the colon do')
await page.keyboard.press('Enter')
await waitQuiet(40000)
await sleep(600)
s = await store()
const budgetAfter = await page.evaluate(() => window.__teachingIde.observer.gateSnapshot().used)
check('a learner question costs no interruption budget', budgetAfter === budgetBefore, `${budgetBefore} -> ${budgetAfter}`)
check('a learner question resets the cooldown',
  await page.evaluate(() => window.__teachingIde.observer.gateSnapshot().lastInterventionAt !== null))
check('teacher answered the question', !!s.speech, `${s.speech?.kind}: ${s.speech?.text?.slice(0, 60)}`)
check('ask logged as an ask event',
  await page.evaluate(() => window.__teachingIde.observer.log.all().some(e => e.type === 'ask')))

// ----------------------------------------------- "just tell me" descends a tier
await page.evaluate(() => { window.__store.getState().set({ askedForAnswer: 0, tier: 1 }) })
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.__teaching.askTeacherQuestion('just tell me the answer'))
  await waitQuiet(40000); await sleep(300)
}
s = await store()
check('three requests for the answer descend exactly one tier', s.tier === 2, `tier=${s.tier}, begged=${s.askedForAnswer}`)
check('never a flat refusal — it still said something', !!s.speech, s.speech?.text?.slice(0, 70))

// ------------------------------------------------------------- staleness guard
const stale = await page.evaluate(() => {
  const m = window.__bridge.materiallyChanged
  return {
    identical: m('a = 1\nb = 2\n', 'a = 1\nb = 2\n', 1),
    oneChar: m('total = 0\nfor n in nums:\n', 'total = 0\nfor n in nums:\n', 2),
    targetLineEdited: m('total = 0\nprint(x)\n', 'total = 0\nprint(y)\n', 2),
    bigEdit: m('a = 1\n', 'a = 1\ntotal = 0\nfor n in nums:\n    total += n\n', null),
    lineAdded: m('a = 1\n', 'a = 1\nb = 2\n', null),
  }
})
check('staleness: identical buffer is not stale', stale.identical === false)
check('staleness: edit to the target line discards', stale.targetLineEdited === true)
check('staleness: a large edit discards', stale.bigEdit === true)
check('staleness: a new line discards', stale.lineAdded === true)

// ------------------------------------------------------------ success path
await goTo('print-each')
await sleep(600)
await runAndWait('nums = [3, 7, 12, 5]\nfor n in nums:\n    print(n)\n')
await waitQuiet(40000); await sleep(1200)
s = await store()
check('success is confirmed, not passed over', s.speech?.kind === 'success', s.speech?.text?.slice(0, 60))
check('...and it asks why it worked', !!s.speech?.followup, String(s.speech?.followup))

// ------------------- what the model is told about the run it is looking at
// "This exercise has been solved" and "this run was right" are different
// questions. Keep typing after solving, run something broken, and conflating
// them tells the model the wrong thing about the code in front of it.
const sent = []
const grabBody = (r) => {
  if (!r.url().includes('/api/teach')) return
  try { sent.push(JSON.parse(r.postData() ?? '{}')) } catch { /* not ours */ }
}
page.on('request', grabBody)
await runAndWait('nums = [3, 7, 12, 5]\nfor n in nums:\n    print(n * 99)\n')
sent.length = 0
await page.evaluate(() => window.__bridge.requestTeaching('ask', 'is this right?'))
await waitQuiet(40000); await sleep(600)
page.off('request', grabBody)
const body = sent[0]
check('the solved exercise is still marked solved', (await store()).solved[await idx('print-each')] === true)
check('but a wrong run after solving is not reported as correct',
  body?.last_run?.correct === false, `last_run.correct=${body?.last_run?.correct}`)
check('...and the wrong output is what gets sent',
  (body?.last_run?.stdout ?? '').startsWith('297'), JSON.stringify(body?.last_run?.stdout?.slice(0, 12)))

// --------------------------------- the server gets the last word on the tool
// The bubble opens on the streamed tool name so the reveal can start early, but
// leakguard can reject that choice and the server substitutes the pre-written
// rung. The widget must follow the server, not the model it overruled.
await goTo('sum-them')
await sleep(600)
await page.setRequestInterception(true)
// 'pass' forwards, 'override' serves a crafted stream, 'dead' kills the API.
let teachMode = 'override'
const OVERRIDE_SSE =
  'event: tool\ndata: {"tool": "translate_error"}\n\n' +
  'event: delta\ndata: {"text": "A variable created inside the loop is created again on every pass."}\n\n' +
  'event: done\ndata: {"tool": "give_hint", "args": {"tier": 4, "text": "A variable created inside the loop is created again on every pass."}, "source": "prewritten", "note": "tier 4 translate_error gave away the answer", "doc_version": 1}\n\n'
page.on('request', (r) => {
  if (!r.url().includes('/api/teach')) return r.continue()
  if (teachMode === 'dead') return r.abort()
  if (teachMode === 'override') {
    return r.respond({ status: 200, contentType: 'text/event-stream', body: OVERRIDE_SSE })
  }
  return r.continue()
})

// Tier 4 is the first rung with a worked example, so it is the one that proves
// the scratch pane survives the override too.
await page.evaluate(() => window.__store.getState().set({ tier: 4 }))
await page.evaluate(() => window.__bridge.requestTeaching('gate'))
await waitQuiet(20000); await sleep(800)
s = await store()
check('a tool the server overruled is re-labelled, not left as the model sent it',
  s.speech?.kind === 'hint', `kind=${s.speech?.kind}`)
check('...and carries the rung it was actually given', s.speech?.tier === 4, `tier=${s.speech?.tier}`)
check('...and still gets its worked example', !!s.speech?.scratch, String(!!s.speech?.scratch))
check('...and the scratch pane renders with it', !!(await page.$('.scratch-pane')))
check('the override reason reaches the dev panel',
  /gave away the answer/.test((await store()).lastSilence ?? ''), (await store()).lastSilence)

// ------------------------------------------- the lesson survives a dead backend
teachMode = 'dead'
// A real learner has edited something between two asks. On byte-identical code
// the teacher assumes its last hint did not land and climbs a rung — which is
// the point, and tested below — so this step needs different code to be asking
// the question it means to: "what does the fallback serve at tier 3?"
await setDoc('nums = [3, 7, 12, 5]\nfor n in nums:\n    total = 0\n    total = total + n\n')
await sleep(900)
await page.evaluate(() => window.__store.getState().set({ tier: 3, speech: null }))
await page.evaluate(() => window.__bridge.requestTeaching('gate'))
await waitQuiet(20000); await sleep(600)
s = await store()
check('backend unreachable falls back to the pre-written rung',
  s.speech?.source === 'prewritten', `${s.speech?.source} / tier ${s.speech?.tier}`)
check('fallback uses the correct rung of the ladder',
  s.speech?.tier === 3 && s.speech.text.startsWith('A variable created inside the loop'),
  s.speech?.text?.slice(0, 55))
check('fallback still renders inline', !!(await page.$('.cm-editor .cm-speech')))
check('the reason is recorded for the dev panel',
  /unreachable/.test((await store()).lastSilence ?? ''), (await store()).lastSilence)

// ------------------------------------------------------------- dev panel
// Closed by default — it is the researcher's instrument, not the learner's UI.
check('dev panel starts closed', !(await page.$('.devpanel')))
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Observer').click())
await page.waitForSelector('.devpanel')
check('dev panel reports where the words came from',
  (await page.$eval('.devpanel', n => n.innerText)).includes('words from'))

// ------------------------------------ the hand-written ladder obeys its own rule
const ladder = await page.evaluate(async () => {
  const { EXERCISES } = await import('/src/lesson/exercises.ts')
  const out = []
  for (const ex of EXERCISES) {
    const res = await fetch('/api/check-ladder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier_texts: ex.hints.map(h => h.text) }),
    })
    out.push({ id: ex.id, ...(await res.json()) })
  }
  return out
})
for (const ex of ladder) {
  const bad = Object.entries(ex.leaks).filter(([tier, leak]) => Number(tier) < 5 && leak)
  check(`pre-written ladder for "${ex.id}" never leaks early`, bad.length === 0,
    bad.length ? JSON.stringify(bad) : `guards: ${JSON.stringify(ex.forbidden)}`)
}
// The model is held to "rungs 1 and 2 say where to look, not what to do". The
// lesson's own rungs have to meet the same standard, or the guard would be
// stricter than the content it protects.
for (const ex of ladder) {
  const told = Object.entries(ex.instructs ?? {}).filter(([, v]) => v)
  check(`pre-written ladder for "${ex.id}" never instructs in its first two rungs`, told.length === 0, JSON.stringify(told))
}

// Aborting /api/teach is how the backend-down case is simulated above.
check('the page was not reloaded by the dev server mid-run', reloads() === 0, reloads.detail())
const real = errors.filter(e => !e.includes('net::ERR_FAILED'))
check('no uncaught page errors', real.length === 0, real.join(' | ').slice(0, 200))
await b.close()
console.log(failures ? `\n${failures} FAILED` : '\nALL PHASE 4+5 CHECKS PASSED')
process.exit(failures ? 1 : 0)
