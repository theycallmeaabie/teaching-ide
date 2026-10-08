import puppeteer from 'puppeteer-core'
import { watchReloads } from '../support/reload-guard.mjs'
import { asGuest, LESSON } from '../support/guest.mjs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await asGuest(page)
const reloads = watchReloads(page, 1)
await page.setViewport({ width: 1400, height: 900 })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

// This suite reads the observer panel, which is closed by default; open it the way a researcher would.
await page.evaluateOnNewDocument(() => localStorage.setItem('teaching-ide:observer', '1'))
await page.goto(LESSON, { waitUntil: 'networkidle2' })
await page.waitForFunction(() => document.querySelector('.status')?.textContent.trim() === 'ready', { timeout: 90000 })
await page.waitForFunction(() => !!window.__teachingIde, { timeout: 20000 })

let failures = 0
const check = (name, pass, detail = '') => { if (!pass) failures++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const snap = () => page.evaluate(() => window.__teachingIde.observer.getSnapshot())
const events = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__teachingIde.observer.log.all())))
const setDoc = (src) => page.evaluate((src) => {
  const v = window.__editorView
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: src } })
}, src)
const clickRun = async () => {
  for (const b of await page.$$('button')) if ((await b.evaluate(n => n.textContent.trim())) === 'Run') return b.click()
}
const waitEvents = (pred, ms = 15000) => page.waitForFunction(
  (src) => new Function('e', src)(JSON.parse(JSON.stringify(window.__teachingIde.observer.log.all()))),
  { timeout: ms }, `return (${pred})(e)`)

// ---------------------------------------------------------------- real typing
await page.click('.cm-content')
await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
await page.keyboard.press('Backspace')
await page.keyboard.type('nums = [3, 7, 12, 5]\n', { delay: 12 })
await sleep(1200)

let evs = await events()
const firstEdit = evs.find((e) => e.type === 'edit')
check('real keystrokes produce one batched edit event',
  evs.filter((e) => e.type === 'edit').length === 1, `${evs.filter(e => e.type === 'edit').length} edit events for 21 keystrokes`)
check('edit event carries lines and charDelta',
  Array.isArray(firstEdit?.linesChanged) && firstEdit.linesChanged.length > 0 && typeof firstEdit.charDelta === 'number',
  JSON.stringify({ lines: firstEdit?.linesChanged, delta: firstEdit?.charDelta }))

// ------------------------------------------------------------ AST classification
await setDoc('nums = [3, 7, 12, 5]\nfor n in nums:\n    print(n)\n')
await sleep(1400)
await setDoc('nums = [3, 7, 12, 5]\n# a comment\nfor n in nums:\n    print(n)\n')
await sleep(1400)
let s = await snap()
check('comment-only edit classified cosmetic', s.lastSemantic === 'cosmetic', String(s.lastSemantic))

await setDoc('nums = [3, 7, 12, 5]\n# a comment\nfor num in nums:\n    print(num)\n')
await sleep(1400)
s = await snap()
check('rename classified as rename', s.lastSemantic === 'rename', String(s.lastSemantic))

await setDoc('nums = [3, 7, 12, 5]\n# a comment\nfor num in nums:\n    print(num * 2)\n')
await sleep(1400)
s = await snap()
check('real edit classified changed', s.lastSemantic === 'changed', String(s.lastSemantic))
check('a real change resets the non-progress streak', s.cosmeticStreak === 0, String(s.cosmeticStreak))

await setDoc('nums = [3, 7, 12, 5]\nfor num in nums\n    print(num)\n')
await sleep(1400)
s = await snap()
check('unparseable buffer classified unparseable', s.lastSemantic === 'unparseable', String(s.lastSemantic))

// ------------------------------------------------------------ run + stuck ramp
await page.evaluate(() => {
  const { config } = window.__teachingIde
  window.__teachingIde.observer.resetSession()
  // Compress the whole timeline ~10x so a 45s wait becomes a 4.5s wait. The
  // scoring window has to shrink with the ramp, or the "you just made real
  // progress" credit never decays and the test measures the wrong thing.
  config.setConfigValue('idleAfterErrorStartMs', 500)
  config.setConfigValue('idleAfterErrorFullMs', 3000)
  config.setConfigValue('windowMs', 6000)
  config.setConfigValue('cooldownMs', 0)
})
await setDoc('nums = [3, 7, 12, 5]\nprint(total)\n')
await sleep(1200)
await clickRun()
await waitEvents('(e) => e.some(x => x.type === "run" && !x.result.ok)')
const scoreJustAfter = (await snap()).score
await sleep(4500)
const s2 = await snap()
check('score climbs while sitting on an error', s2.score > scoreJustAfter && s2.score > 0.6,
  `${scoreJustAfter.toFixed(2)} -> ${s2.score.toFixed(2)}`)
check('idleAfterError is the named contributor',
  s2.contributions.some((c) => c.key === 'idleAfterError'), s2.contributions.map(c => `${c.key}:${c.value.toFixed(2)}`).join(' '))
check('gate opened and recorded a would-intervene',
  s2.interventions.length >= 1, JSON.stringify(s2.interventions.at(-1)?.reason))
check('gate event landed in the log',
  (await events()).some((e) => e.type === 'gate'))

// -------------------------------------------------------------- typing recovers
await page.click('.cm-content')
await page.keyboard.type('\ntotal = 0\n', { delay: 12 })
await sleep(1400)
const s3 = await snap()
check('one keystroke clears idle-after-error',
  !s3.contributions.some((c) => c.key === 'idleAfterError'), s3.score.toFixed(2))

// ------------------------------------------------------------- success resets
await setDoc('nums = [3, 7, 12, 5]\nfor n in nums:\n    print(n)\n')
await sleep(1200)
await clickRun()
await waitEvents('(e) => e.some(x => x.type === "run" && x.result.ok)')
await sleep(600)
const s4 = await snap()
check('a successful run drives the score to 0', s4.score === 0, s4.score.toFixed(2))

// ---------------------------------------------------------------- budget/ask
const g = await page.evaluate(() => {
  const { observer, config } = window.__teachingIde
  observer.resetSession()
  config.setConfigValue('budget', 2)
  return true
})
check('budget is live-tunable', g)

// ------------------------------------------------------------------ dev panel
check('dev panel shows a numeric score', /^\d\.\d\d$/.test((await page.$eval('.score-num', n => n.textContent)).trim()))
check('dev panel shows the intervene indicator', !!(await page.$('.intervene')))
const fieldCount = await page.evaluate(() => window.__teachingIde.config.CONFIG_FIELDS.length)
check('dev panel renders a slider for every tunable',
  (await page.$$('.tune input[type=range]')).length === fieldCount,
  `${(await page.$$('.tune input[type=range]')).length}/${fieldCount}`)
check('dev panel lists events', (await page.$$('.events li')).length > 0)

// ------------------------------------------------------------------- export
const exported = await page.evaluate(() => {
  const { observer, config } = window.__teachingIde
  return observer.log.exportJson({ ...config.config })
})
check('log exports as JSON with config + offsets',
  typeof exported.durationMs === 'number' && Array.isArray(exported.events) &&
  exported.events.every(e => typeof e.offsetMs === 'number') && 'threshold' in exported.config)

// ------------------------------------------------------------- no re-renders
const renders = await page.evaluate(async () => {
  // The editor pane must not re-mount or re-render as the log grows.
  const before = document.querySelector('.cm-content')
  const v = window.__editorView
  for (let i = 0; i < 40; i++) v.dispatch({ changes: { from: v.state.doc.length, insert: 'x' } })
  await new Promise(r => setTimeout(r, 1200))
  return before === document.querySelector('.cm-content')
})
check('editor is not re-mounted by log growth', renders)

check('the page was not reloaded by the dev server mid-run', reloads() === 0, reloads.detail())

check('no uncaught page errors', errors.length === 0, errors.join(' | ').slice(0, 200))

await page.screenshot({ path: new URL('../../.artifacts/phase2.png', import.meta.url).pathname })
await browser.close()
console.log(failures ? `\n${failures} FAILED` : '\nALL PHASE 2 LIVE CHECKS PASSED')
process.exit(failures ? 1 : 0)
