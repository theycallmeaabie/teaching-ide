/**
 * The teacher read aloud. The browser's speech engine and audio playback are
 * replaced by stand-ins that write down what they are asked to do, so this checks
 * what is said, in which voice, and when, not how it sounds. The teacher's server
 * and /api/speak are stubbed too: nothing reaches a model or ElevenLabs.
 *
 * What matters about this feature, and so what is checked: it is off until the
 * learner turns it on and remembered after; each thing the teacher says is read
 * once, with its code said the way a person would; the ElevenLabs voice is used
 * when the server has it, and the browser's own voice when it does not; and it
 * stops the moment that thing is dismissed, the learner starts talking, or they
 * turn it off.
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
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})

/** A speech engine that says nothing and remembers everything. */
function fakeSpeech() {
  window.__said = []
  window.__cancels = 0
  const voices = [
    { name: 'Zarvox', lang: 'en-US', default: true, localService: true, voiceURI: 'zarvox' },
    { name: 'Google UK English Female', lang: 'en-GB', default: false, localService: false, voiceURI: 'g-uk' },
    { name: 'Google US English', lang: 'en-US', default: false, localService: false, voiceURI: 'g-us' },
    { name: 'Google Deutsch', lang: 'de-DE', default: false, localService: false, voiceURI: 'g-de' },
  ]
  const synth = {
    getVoices: () => voices,
    speak: (u) => window.__said.push({ text: u.text, voice: u.voice?.name ?? null, lang: u.lang }),
    cancel: () => { window.__cancels++ },
    addEventListener() {},
    removeEventListener() {},
  }
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true })
  window.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text }
  }
  // Audio clips: what type each one was, and every one played.
  window.__played = []
  const types = {}
  const make = URL.createObjectURL
  URL.createObjectURL = (b) => { const u = make(b); types[u] = b.type; return u }
  HTMLMediaElement.prototype.play = function () { window.__played.push(types[this.src] ?? this.src); return Promise.resolve() }
  HTMLMediaElement.prototype.pause = function () {}
}

const page = await b.newPage()
await asGuest(page)
const reloads = watchReloads(page, 2)
await page.setViewport({ width: 1500, height: 950 })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()) })
await page.evaluateOnNewDocument(fakeSpeech)

await page.goto(LESSON, { waitUntil: 'networkidle2' })
await page.waitForFunction(() => document.querySelector('.status')?.textContent.trim() === 'ready', { timeout: 90000 })
await page.waitForFunction(() => !!window.__store, { timeout: 20000 })

// The teacher's answers, one per question, in order. Interception starts only
// once Python has booted, as in the voice suite.
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('')
const answer = (text, followup = '') =>
  sse([
    ['tool', { tool: 'explain' }],
    ['delta', { text }],
    ['done', { tool: 'explain', source: 'llm', note: null, doc_version: 1, args: { text, example: '', followup_question: followup } }],
  ])
const answers = []
// /api/speak: 'down' is a server that cannot help this time, 'eleven' answers
// with audio, 'slow' answers with audio a second and a half later, 'no_credits'
// is ElevenLabs out of credits.
const speaker = { mode: 'down', texts: [] }
let intercepting = true
await page.setRequestInterception(true)
page.on('request', async (r) => {
  if (!intercepting) return
  if (new URL(r.url()).pathname === '/api/teach') {
    return r.respond({ status: 200, contentType: 'text/event-stream', body: answers.shift() ?? answer('Nothing more to say.') })
  }
  if (new URL(r.url()).pathname === '/api/speak') {
    speaker.texts.push(JSON.parse(r.postData() || '{}').text)
    if (speaker.mode === 'slow') {
      await sleep(1500)
      return r.respond({ status: 200, contentType: 'audio/mpeg', body: Buffer.alloc(2048) }).catch(() => {}) // the page may have given up on it
    }
    if (speaker.mode === 'eleven') return r.respond({ status: 200, contentType: 'audio/mpeg', body: Buffer.alloc(2048) })
    const kind = speaker.mode === 'no_credits' ? 'no_credits' : 'unavailable'
    return r.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'stubbed', kind }) })
  }
  return r.continue()
})

const toggle = '.voice-toggle'
const toggleInfo = () => page.$eval(toggle, (t) => ({ pressed: t.getAttribute('aria-pressed'), disabled: t.disabled, title: t.title }))
const said = () => page.evaluate(() => window.__said.map((s) => s.text))
const cancels = () => page.evaluate(() => window.__cancels)
const clips = () => page.evaluate(() => window.__played.filter((t) => t === 'audio/mpeg').length)
/** Wait for the browser voice to have said at least n things: it speaks only
 *  after the server has had its chance. */
const heard = (n) => page.waitForFunction((n) => window.__said.length >= n, { timeout: 5000 }, n).catch(() => {})
const settled = () =>
  page.waitForFunction(() => { const s = window.__store.getState(); return !s.teacherBusy && s.speech && !s.speech.streaming }, { timeout: 15000 })

async function ask(question, reply) {
  answers.push(reply)
  await page.focus('.askbox input')
  await page.keyboard.type(question)
  await page.keyboard.press('Enter')
  await settled()
  await sleep(300) // time for anything that would be said twice to be said twice
}

// ------------------------------------------------------------------ off until asked
let t = await toggleInfo()
check('the speaker is there, off, and says what it does', t.pressed === 'false' && !t.disabled && t.title === 'Read the teacher aloud', JSON.stringify(t))

await ask('what does the colon do', answer('Put a `:` at the end of `for n in nums`. Then run it.', 'What does the colon start?'))
check('with it off, the teacher is not read aloud', (await said()).length === 0, JSON.stringify(await said()))

// ------------------------------------------------------------------ turning it on
await page.click(toggle)
t = await toggleInfo()
check('clicking it turns it on, and shows it', t.pressed === 'true' && /Stop/.test(t.title), JSON.stringify(t))
await heard(3)
let words = await said()
check('...and reads what is on screen straight away, code said the way a person says it',
  JSON.stringify(words) === JSON.stringify(['Put a colon at the end of for n in nums.', 'Then run it.', 'What does the colon start?']),
  JSON.stringify(words))
const voice = await page.evaluate(() => window.__said[0])
check('...in the best English voice there is, not the novelty default', voice.voice === 'Google US English' && voice.lang === 'en-US', JSON.stringify(voice))

// ------------------------------------------------------------------ each answer, once
let before = (await said()).length
await ask('and then?', answer('Line 2 needs `print(total)`.'))
words = (await said()).slice(before)
check('the next answer is read once it has all arrived, and only once', JSON.stringify(words) === JSON.stringify(['Line 2 needs print total.']), JSON.stringify(words))

// ------------------------------------------------------------------ ElevenLabs first
speaker.mode = 'eleven'
before = (await said()).length
let clipsBefore = await clips()
let asked = speaker.texts.length
await ask('what next?', answer('Use `print(total)` on line 3.'))
await page.waitForFunction((n) => window.__played.filter((t) => t === 'audio/mpeg').length > n, { timeout: 5000 }, clipsBefore).catch(() => {})
check('when the server has the ElevenLabs voice, that voice reads the answer', (await clips()) === clipsBefore + 1, `${(await clips()) - clipsBefore} clips`)
check('...sent the words the way they should sound', JSON.stringify(speaker.texts.slice(asked)) === JSON.stringify(['Use print total on line 3.']), JSON.stringify(speaker.texts.slice(asked)))
check('...and the browser voice stays quiet', (await said()).length === before, JSON.stringify((await said()).slice(before)))

// The learner dismisses the hint while its audio is still on the way.
speaker.mode = 'slow'
before = (await said()).length
clipsBefore = await clips()
await ask('one more thing', answer('This arrives too late to be wanted.'))
await page.$eval('.cm-speech-x', (x) => x.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
await sleep(2200)
check('audio that arrives after the hint was dismissed is never played, in either voice',
  (await clips()) === clipsBefore && (await said()).length === before, `${(await clips()) - clipsBefore} clips, ${(await said()).length - before} said`)

speaker.mode = 'no_credits'
before = (await said()).length
clipsBefore = await clips()
await ask('and then?', answer('Then run it.'))
await heard(before + 1)
words = (await said()).slice(before)
check('out of credits, the browser voice reads it instead', JSON.stringify(words) === JSON.stringify(['Then run it.']) && (await clips()) === clipsBefore, JSON.stringify(words))
asked = speaker.texts.length
before = (await said()).length
await ask('anything else?', answer('Nothing else.'))
await heard(before + 1)
check('...and the server is not asked again for a while, so the next one is not kept waiting', speaker.texts.length === asked, `${speaker.texts.length - asked} more requests`)
check('...it goes straight to the browser voice', JSON.stringify((await said()).slice(before)) === JSON.stringify(['Nothing else.']), JSON.stringify((await said()).slice(before)))

let c = await cancels()
await page.$eval('.cm-speech-x', (x) => x.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
await page.waitForFunction(() => window.__store.getState().speech === null, { timeout: 5000 })
check('dismissing what the teacher said stops it being read', (await cancels()) > c, `${(await cancels()) - c} cancels`)

before = (await said()).length
await page.evaluate(() => window.__bridge.deliverPrewrittenHint())
await heard(before + 1)
words = (await said()).slice(before)
check('a pre-written hint is read too: the voice needs no server', words.length > 0 && words.every((w) => !w.includes('`')), JSON.stringify(words))

// ------------------------------------------------------------------ the mic
c = await cancels()
await page.click('.askfield .btn-icon')
await page.waitForFunction(() => document.querySelector('.askfield .btn-icon.mic-rec'), { timeout: 8000 })
check('starting to ask by voice stops the teacher talking over the question', (await cancels()) > c)
await page.keyboard.press('Escape')
await page.waitForFunction(() => !document.querySelector('.askfield .btn-icon.mic-rec'), { timeout: 8000 })

// ------------------------------------------------------------------ remembered
// Interception off while Python boots: it holds the runtime's own requests.
intercepting = false
await page.setRequestInterception(false)
await page.reload({ waitUntil: 'networkidle2' })
await page.waitForFunction(() => document.querySelector('.status')?.textContent.trim() === 'ready', { timeout: 90000 })
await page.setRequestInterception(true)
intercepting = true
t = await toggleInfo()
check('the choice survives a reload', t.pressed === 'true', JSON.stringify(t))

// ------------------------------------------------------------------ turning it off
await page.click(toggle)
t = await toggleInfo()
check('clicking it again turns it off', t.pressed === 'false', JSON.stringify(t))
check('...and stops anything being said', (await cancels()) > 0)
await ask('one more', answer('This should never be heard.'))
check('with it off again, nothing is read', (await said()).length === 0, JSON.stringify(await said()))

await page.$eval('.cm-speech-x', (x) => x.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
await page.waitForFunction(() => window.__store.getState().speech === null, { timeout: 5000 })
await page.click(toggle)
await heard(1)
words = await said()
check('turned on with nothing on screen, it says hello so the learner hears it working', words.length === 1 && /out loud/.test(words[0]), JSON.stringify(words))

// ------------------------------------------------------------------ no speech engine
// It can still play the ElevenLabs voice: only the fallback is missing.
const bare = await b.newPage()
await asGuest(bare)
await bare.evaluateOnNewDocument(() => {
  Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true })
})
await bare.goto(LESSON, { waitUntil: 'domcontentloaded' })
await bare.waitForSelector(toggle, { timeout: 20000 })
const bareInfo = await bare.$eval(toggle, (x) => ({ disabled: x.disabled, title: x.title }))
check('a browser with no speech engine of its own still offers the ElevenLabs voice', !bareInfo.disabled, JSON.stringify(bareInfo))
await bare.close()

// ------------------------------------------------------------------------- hygiene
check('no page errors', errors.length === 0, errors.join(' | '))
check('page was not reloaded mid-run', reloads() === 0, reloads.detail())

await b.close()
console.log(failures ? `\n${failures} FAILED` : '\nALL SPEAKER CHECKS PASSED')
process.exit(failures ? 1 : 0)
