/**
 * The mic, as the browser sees it. Chrome's fake microphone supplies real audio to
 * the real MediaRecorder, so the recording path under test is the real one; only
 * the transcription server is a stand-in. Nothing here reaches a model, and no
 * audio leaves the machine.
 *
 * What matters about this feature, and so what is checked: the words go into the
 * box and are never sent for the learner; the microphone is let go the moment it
 * stops; and every way it can fail says something a learner can act on.
 */
import puppeteer from 'puppeteer-core'
import { watchReloads } from '../support/reload-guard.mjs'
import { asGuest, LESSON } from '../support/guest.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (n, p, d = '') => {
  if (!p) failures++
  console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  | ' + d : ''}`)
}

const b = await puppeteer.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-fake-ui-for-media-stream', // grant the permission prompt
    '--use-fake-device-for-media-stream', // and give it a microphone that makes sound
  ],
})

const APP = LESSON
const booted = (p) =>
  p.waitForFunction(() => document.querySelector('.status')?.textContent.trim() === 'ready', { timeout: 90000 })

// ------------------------------------------------------------------ the main page
const page = await b.newPage()
await asGuest(page)
const reloads = watchReloads(page, 1)
await page.setViewport({ width: 1500, height: 950 })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()) })

// Let the test see every microphone track the page opens, to prove each is stopped.
await page.evaluateOnNewDocument(() => {
  window.__tracks = []
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = async (c) => {
    const s = await real(c)
    s.getTracks().forEach((t) => window.__tracks.push(t))
    return s
  }
})

await page.goto(APP, { waitUntil: 'networkidle2' })
await booted(page)
await page.waitForFunction(() => !!window.__store, { timeout: 20000 })

// The server's side of the conversation. Interception starts only once Python has
// booted: it would hold the runtime's own requests too, and it would never start.
const server = { status: 200, body: { text: 'what does the colon do' }, uploads: [], teach: 0, taught: [] }
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('')
const ANSWER = sse([
  ['tool', { tool: 'explain' }],
  ['delta', { text: 'The colon opens a block.' }],
  ['done', { tool: 'explain', source: 'llm', note: null, doc_version: 1, args: { text: 'The colon opens a block.', example: '', followup_question: '' } }],
])
await page.setRequestInterception(true)
page.on('request', async (r) => {
  const path = new URL(r.url()).pathname
  if (path === '/api/transcribe') {
    const data = (await r.fetchPostData().catch(() => '')) || ''
    server.uploads.push({ type: r.headers()['content-type'], bytes: data.length })
    return r.respond({ status: server.status, contentType: 'application/json', body: JSON.stringify(server.body) })
  }
  if (path === '/api/teach') {
    server.teach++ // a voice question must never reach the teacher by itself
    server.taught.push(JSON.parse(r.postData() || '{}'))
    return r.respond({ status: 200, contentType: 'text/event-stream', body: ANSWER })
  }
  return r.continue()
})

const mic = '.askfield .btn-icon'
const micInfo = () => page.$eval(mic, (m) => ({ rec: m.classList.contains('mic-rec'), pressed: m.getAttribute('aria-pressed'), disabled: m.disabled, title: m.title }))
const box = () => page.$eval('.askbox input', (i) => ({ value: i.value, placeholder: i.placeholder, focused: document.activeElement === i }))
const note = () => page.$eval('.ask-note', (n) => n.textContent).catch(() => null)
const recording = () => page.waitForFunction((s) => document.querySelector(s + '.mic-rec'), { timeout: 8000 }, mic)
const settled = () =>
  page.waitForFunction((s) => { const m = document.querySelector(s); return m && !m.disabled && !m.classList.contains('mic-rec') }, { timeout: 10000 }, mic)
const tracksStopped = () => page.evaluate(() => window.__tracks.length > 0 && window.__tracks.every((t) => t.readyState === 'ended'))
const turns = () => page.evaluate(() => window.__store.getState().recent.length)
const setText = (text) => { server.body = { text } }

/** Click the mic, talk for `ms`, click it again. */
async function speak(ms = 1400) {
  await page.click(mic)
  await recording()
  await sleep(ms)
  await page.click(mic)
}

// ------------------------------------------------------------------ the happy path
let m = await micInfo()
check('the mic is available and says what it does', !m.disabled && !m.rec && m.title === 'Ask by voice' && m.pressed === 'false', JSON.stringify(m))

const turnsBefore = await turns()
await page.click(mic)
await recording()
m = await micInfo()
check('clicking it starts listening, and shows it', m.rec && m.pressed === 'true' && /Stop/.test(m.title), JSON.stringify(m))
check('...in the box itself, with a clock', /^Listening… 0:0\d/.test((await box()).placeholder), (await box()).placeholder)
await sleep(1400)
await page.click(mic)
await page.waitForFunction(() => document.querySelector('.askbox input').value.length > 0, { timeout: 10000 })
await settled()

const up = server.uploads.at(-1)
check('the recording was uploaded as audio', up && /^audio\//.test(up.type), JSON.stringify(up))
check('...and was a real recording, not an empty file', up && up.bytes > 800, `${up?.bytes} bytes`)
let f = await box()
check('what was said is in the box', f.value === 'what does the colon do', JSON.stringify(f.value))
check('...with the cursor in it, ready to edit', f.focused)
check('...and was NOT sent to the teacher', server.teach === 0 && (await turns()) === turnsBefore, `${server.teach} teach calls`)
check('the microphone was let go when it stopped', await tracksStopped())

setText('and the quotes')
await speak()
await page.waitForFunction(() => document.querySelector('.askbox input').value.includes('quotes'), { timeout: 10000 })
await settled()
f = await box()
check('a second question is added to what is there, not over it', f.value === 'what does the colon do and the quotes', JSON.stringify(f.value))
await page.focus('.askbox input')
await page.keyboard.type('?')
check('the learner can edit it like anything they typed', (await box()).value === 'what does the colon do and the quotes?', (await box()).value)
check('...and it still has not been sent', server.teach === 0)
await page.keyboard.press('Enter')
await page.waitForFunction(() => document.querySelector('.askbox input').value === '', { timeout: 10000 })
await page.waitForFunction(() => window.__store.getState().teacherBusy === false, { timeout: 10000 })
const asked = server.taught.at(-1) ?? {}
check('pressing Enter asks the teacher exactly what is in the box, as a question',
  server.teach === 1 && asked.learner_question === 'what does the colon do and the quotes?' && asked.trigger === 'ask', JSON.stringify({ q: asked.learner_question, t: asked.trigger }))

// ------------------------------------------------------------------ when it goes wrong
server.status = 503
server.body = { detail: 'this provider does not offer voice' }
await speak()
await page.waitForSelector('.ask-note', { timeout: 10000 })
await settled()
check('an unavailable server says so and points to typing', /isn't available.*type/i.test(await note()), await note())
check('...changes nothing in the box', (await box()).value === '')
check('...and the mic is ready to try again', !(await micInfo()).disabled)

server.status = 429
server.body = { detail: 'Too many voice questions this minute. Give it a moment.' }
await speak()
await page.waitForFunction(() => /moment/.test(document.querySelector('.ask-note')?.textContent || ''), { timeout: 10000 })
check("a limit is shown in the server's own words", /give it a moment/i.test(await note()), await note())
await settled()

server.status = 200
server.body = { text: '' }
await speak()
await page.waitForFunction(() => /catch/.test(document.querySelector('.ask-note')?.textContent || ''), { timeout: 10000 })
check('silence is "I didn\'t catch that", not an error', /didn't catch anything/.test(await note()), await note())
await settled()

const uploadsBefore = server.uploads.length
await page.click(mic)
await recording()
await page.click(mic) // straight back: a click, not a question
await page.waitForFunction(() => /too short/.test(document.querySelector('.ask-note')?.textContent || ''), { timeout: 5000 })
await settled()
check('a click with no question is told so, and costs nothing', server.uploads.length === uploadsBefore, `${server.uploads.length - uploadsBefore} uploads`)

setText('this should never appear')
server.body = { text: 'this should never appear' }
await page.click(mic)
await recording()
await sleep(900)
await page.keyboard.press('Escape')
await settled()
await sleep(300)
check('Escape abandons a recording without sending it', server.uploads.length === uploadsBefore && (await box()).value === '', `${server.uploads.length - uploadsBefore} uploads`)
check('...and still lets go of the microphone', await tracksStopped())

// -------------------------------------------------------- the microphone itself fails
async function withMic(fake, arg, fn) {
  const p = await b.newPage()
  await asGuest(p)
  await p.evaluateOnNewDocument(fake, arg) // an argument: a closure would not survive the trip into the page
  await p.setViewport({ width: 1500, height: 950 })
  await p.goto(APP, { waitUntil: 'domcontentloaded' })
  await p.waitForSelector('.askfield .btn-icon', { timeout: 20000 })
  try { return await fn(p) } finally { await p.close() }
}
const refuses = (name) => {
  navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('no', name))
}
for (const [name, expect, label] of [
  ['NotAllowedError', /blocked.*address bar/i, 'a blocked microphone says how to unblock it'],
  ['NotFoundError', /No microphone/i, 'a missing microphone says so'],
  ['NotReadableError', /another app/i, 'a busy microphone says what is using it'],
]) {
  await withMic(refuses, name, async (p) => {
    await p.click(mic)
    await p.waitForSelector('.ask-note', { timeout: 8000 })
    const text = await p.$eval('.ask-note', (n) => n.textContent)
    check(label, expect.test(text), text)
    check('...and the mic is not left stuck on', !(await p.$eval(mic, (x) => x.disabled || x.classList.contains('mic-rec'))))
  })
}

await withMic(() => { delete window.MediaRecorder }, undefined, async (p) => {
  const info = await p.$eval(mic, (x) => ({ disabled: x.disabled, title: x.title }))
  check('a browser that cannot record disables the mic and says why', info.disabled && /can't record/.test(info.title), JSON.stringify(info))
})

// ------------------------------------------------------------------------- hygiene
check('no page errors', errors.length === 0, errors.join(' | '))
check('page was not reloaded mid-run', reloads() === 0, reloads.detail())

await b.close()
console.log(failures ? `\n${failures} FAILED` : '\nALL VOICE CHECKS PASSED')
process.exit(failures ? 1 : 0)
