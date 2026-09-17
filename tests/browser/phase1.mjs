import puppeteer from 'puppeteer-core'

const APP = 'http://localhost:5173/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })

const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto(APP, { waitUntil: 'networkidle2' })

const status = () => page.$eval('.status', (n) => n.textContent.trim())
const output = () => page.$eval('.output-pane .pane-body', (n) => n.innerText.trim())
const btn = async (label) => {
  const els = await page.$$('button')
  for (const e of els) {
    const t = await e.evaluate((n) => n.textContent.trim())
    if (t === label) return e
  }
  return null
}
const setDoc = (src) =>
  page.evaluate((src) => {
    const cm = window.__editorView
    cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: src } })
  }, src)

async function waitFor(fn, ms = 60000, label = '') {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await fn()) return true
    await sleep(200)
  }
  throw new Error('timeout waiting for ' + label)
}

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

// 1. Pyodide boots
const t0 = Date.now()
await waitFor(async () => (await status()) === 'ready', 90000, 'pyodide boot')
check('pyodide boots in worker', true, `${Date.now() - t0} ms`)

// 2. Syntax highlighting is active (python language mode produced tokens)
const tokens = await page.$$eval('.cm-content .tok-keyword, .cm-content .ͼb, .cm-content span[class]', (n) => n.length)
check('editor renders highlighted tokens', tokens > 0, `${tokens} styled spans`)

// 3. Run produces output
await setDoc('nums = [3, 7, 12, 5]\nfor n in nums:\n    print(n)\n')
;(await btn('Run')).click()
await waitFor(async () => (await output()).includes('12'), 30000, 'run output')
check('run prints loop output', (await output()).includes('3\n7\n12\n5'), JSON.stringify(await output()))

// 4. Structured error with line number
await setDoc('a = 1\nb = 2\nprint(c)\n')
;(await btn('Run')).click()
await waitFor(async () => (await output()).includes('NameError'), 30000, 'error output')
const errText = await output()
check('error is structured with line number', errText.includes('NameError') && errText.includes('line 3'), JSON.stringify(errText))

// 5. Infinite loop: page stays alive, Stop appears, Stop works
await setDoc('while True:\n    x = 1\n')
;(await btn('Run')).click()
await sleep(1000)
const aliveMid = await page.evaluate(() => { document.title = 'alive-' + Date.now(); return document.title.startsWith('alive-') })
check('page responsive during infinite loop', aliveMid)

await waitFor(async () => !!(await page.$('.slow-banner')), 12000, 'slow banner')
check('Stop affordance appears after ~3s', true)

const stopBtn = await btn('Stop')
await stopBtn.click()
await waitFor(async () => (await output()).toLowerCase().includes('stopped'), 15000, 'stop result')
check('Stop terminates the run', true, JSON.stringify((await output()).slice(0, 60)))

// 6. Worker restarts and runs again
await waitFor(async () => (await status()) === 'ready', 90000, 'worker restart')
await setDoc('print("back from the dead")\n')
;(await btn('Run')).click()
await waitFor(async () => (await output()).includes('back from the dead'), 30000, 'post-restart run')
check('worker restarts and executes again', true)

// 7. stdout before an error is preserved
await setDoc('nums = [3, 7, 12, 5]\nfor i in nums:\n    print(nums[i])\n')
;(await btn('Run')).click()
await waitFor(async () => (await output()).includes('IndexError'), 30000, 'index error')
const mixed = await output()
check('stdout before error preserved', mixed.includes('5') && mixed.includes('IndexError'), JSON.stringify(mixed))

await page.screenshot({ path: new URL('../../.artifacts/phase1.png', import.meta.url).pathname, fullPage: false })

check('no uncaught page errors', errors.length === 0, errors.join(' | ').slice(0, 300))

await browser.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
