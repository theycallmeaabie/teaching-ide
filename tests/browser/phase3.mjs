import puppeteer from 'puppeteer-core'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await b.newPage()
await page.setViewport({ width: 1500, height: 950 })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2' })
await page.waitForFunction(() => document.querySelector('.status')?.textContent.trim() === 'ready', { timeout: 90000 })
await page.waitForFunction(() => !!window.__teachingIde, { timeout: 20000 })

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
  await sleep(500)
}
const text = (sel) => page.$eval(sel, n => n.innerText.trim()).catch(() => null)

// ------------------------------------------------------------ content loaded
check('starter buffer is pre-seeded with the list',
  (await page.evaluate(() => window.__editorView.state.doc.toString())).startsWith('nums = [3, 7, 12, 5]'))
check('exercise prompt is shown', (await text('.lesson-prompt'))?.includes('Print each number'))
check('four exercises', (await page.$$('.dot')).length === 4)

// ------------------------------------------------------------ success detection
await runAndWait('nums = [3, 7, 12, 5]\nfor n in nums:\n    print(n)\n')
let s = await store()
check('correct solution marks the exercise solved', s.solved[0] === true)
check('solved banner appears', !!(await page.$('.solved-banner')))

// ------------------------------- the case that runs clean and is still wrong
await page.evaluate(() => window.__teaching.goToExercise(2))
await sleep(600)
check('exercise 3 loaded with its own starter',
  (await page.evaluate(() => window.__editorView.state.doc.toString())).includes('for n in nums'))
await runAndWait('nums = [3, 7, 12, 5]\nfor n in nums:\n    total = 0\n    total = total + n\nprint(total)\n')
s = await store()
check('clean run with wrong output still counts as a failed attempt', s.attempts === 1, `attempts=${s.attempts}`)
check('not marked solved', s.solved[2] === false)
check('accumulator-inside-loop detected from the AST',
  s.misconceptions.some(m => m.id === 'accumulator-init-inside-loop'),
  JSON.stringify(s.misconceptions))
check('...and no Python error was raised', (await store()).lastResult.ok === true)

// ------------------------------------------------------------- the hint ladder
await page.evaluate(() => window.__bridge.deliverPrewrittenHint('test'))
await sleep(300)
check('first hint is tier 1', (await store()).speech.tier === 1, await text('.cm-speech-label'))
check('tier 1 does not name the fix', !(await text('.cm-speech-text')).includes('total = 0'))

for (let i = 0; i < 4; i++) {
  await runAndWait('nums = [3, 7, 12, 5]\nfor n in nums:\n    total = 0\n    total = total + n\nprint(total)\n')
  await page.evaluate(() => window.__bridge.deliverPrewrittenHint('test'))
  await sleep(250)
}
s = await store()
check('ladder descends one tier per failed attempt, never jumps', s.speech.tier === 5, `tier=${s.speech.tier}`)

// ---------------------------------------------------------------- scratch pane
check('scratch pane appears at tier 4+', !!(await page.$('.scratch-pane')))
const scratchText = await page.$eval('.scratch-pane .cm-content', n => n.innerText)
check('scratch shows a parallel example, not the learner problem',
  scratchText.includes('scores') && !scratchText.includes('nums'), scratchText.split('\n')[1])
check('scratch editor is read-only',
  await page.$eval('.scratch-pane .cm-content', n => n.contentEditable !== 'true'))

// ------------------------------------------------- tier 5 still has them typing
const t5 = await text('.cm-speech-text')
check('tier 5 instructs typing, does not write the buffer',
  /type it yourself/i.test(t5), t5.slice(0, 70))
const bufBefore = await page.evaluate(() => window.__editorView.state.doc.toString())
await sleep(800)
check('learner buffer never written to by the teacher',
  bufBefore === await page.evaluate(() => window.__editorView.state.doc.toString()))

// ------------------------------------------------------------ tier resets
await page.evaluate(() => window.__teaching.goToExercise(3))
await sleep(500)
s = await store()
check('new exercise resets tier and attempts', s.tier === 1 && s.attempts === 0 && s.speech === null)
check('exercise 4 uses a longer list so the count cannot be guessed',
  (await page.evaluate(() => window.__editorView.state.doc.toString())).includes('18, 9, 21'))

await runAndWait('nums = [3, 7, 12, 5, 18, 9, 21, 4]\ncount = 0\nfor n in nums:\n    if n > 10:\n        count = count + 1\nprint(count)\n')
s = await store()
check('exercise 4 solution accepted', s.solved[3] === true)

// -------------------------------------------------------- dev panel shows tier
await page.evaluate(() => window.__teaching.goToExercise(2))
await sleep(600)
await runAndWait('nums = [3, 7, 12, 5]\nprint(oops)\n')
await page.evaluate(() => window.__bridge.deliverPrewrittenHint('test'))
await sleep(500)
const tierCell = await page.evaluate(() => {
  const ks = [...document.querySelectorAll('.kv span')]
  const i = ks.findIndex(n => n.textContent === 'hint tier')
  return ks[i]?.nextElementSibling?.textContent
})
check('dev panel reports the current hint tier', tierCell === '1', String(tierCell))

check('no uncaught page errors', errors.length === 0, errors.join(' | ').slice(0, 200))
await b.close()
console.log(failures ? `\n${failures} FAILED` : '\nALL PHASE 3 CHECKS PASSED')
process.exit(failures ? 1 : 0)
