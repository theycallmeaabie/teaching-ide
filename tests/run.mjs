/**
 * Runs every suite. Needs `npm run dev` (5173) and `npm run api` (8000) up;
 * the browser suites drive a real Chrome against the real app.
 *
 *   node tests/run.mjs            everything
 *   node tests/run.mjs unit       no browser, no network
 *   node tests/run.mjs phase2     one suite
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
mkdirSync(new URL('../.artifacts/', import.meta.url), { recursive: true })

const SUITES = [
  { name: 'harness', kind: 'unit', file: 'tests/harness.test.mjs', what: 'Python harness: error type, message, line' },
  { name: 'ast', kind: 'unit', file: 'tests/ast.test.mjs', what: 'cosmetic / rename / changed / unparseable' },
  { name: 'diagnose', kind: 'unit', file: 'tests/diagnose.test.mjs', what: 'misconception detectors' },
  { name: 'observer', kind: 'unit', file: 'tests/observer.test.ts', what: 'stuck score + gate scenarios' },
  { name: 'auth', kind: 'unit', file: 'tests/auth.test.py', what: 'who a caller is: anonymous, valid, rejected' },
  { name: 'teacher', kind: 'unit', file: 'tests/teacher.test.py', what: 'prompt, memory, explain, sanitising, quotas' },
  { name: 'api', kind: 'unit', file: 'tests/api.test.py', what: 'the HTTP surface with the model stubbed' },
  { name: 'stt', kind: 'unit', file: 'tests/stt.test.py', what: 'voice questions: limits, formats, provider errors (stubbed)' },
  { name: 'plain', kind: 'unit', file: 'tests/plain.test.ts', what: 'the long dash taken out of the teacher\'s words, even when a stream splits it' },
  { name: 'lesson', kind: 'unit', file: 'tests/lesson.test.ts', what: 'learner profile + did-my-hint-land rule' },
  { name: 'phase1', kind: 'browser', file: 'tests/browser/phase1.mjs', what: 'editor + execution' },
  { name: 'phase2', kind: 'browser', file: 'tests/browser/phase2.mjs', what: 'observer, live' },
  { name: 'phase3', kind: 'browser', file: 'tests/browser/phase3.mjs', what: 'lesson content + ladder' },
  { name: 'phase45', kind: 'browser', file: 'tests/browser/phase45.mjs', what: 'teacher + presentation (needs the API)' },
  { name: 'accounts', kind: 'browser', file: 'tests/browser/accounts.mjs', what: 'sign-in, saved progress and memory (fake Supabase)' },
  { name: 'pages', kind: 'browser', file: 'tests/browser/pages.mjs', what: 'sign-in, guest, the course page, routing, password reset, no-Supabase mode (fake Supabase; no model)' },
  { name: 'phase6', kind: 'browser', file: 'tests/browser/phase6.mjs', what: 'the product teacher: memory, explain, hints that did not land' },
  { name: 'voice', kind: 'browser', file: 'tests/browser/voice.mjs', what: 'the mic: record, transcribe into the box, never auto-send (fake mic, stubbed server)' },
]

const arg = process.argv[2]
const chosen = !arg
  ? SUITES
  : arg === 'unit'
    ? SUITES.filter((s) => s.kind === 'unit')
    : arg === 'browser'
      ? SUITES.filter((s) => s.kind === 'browser')
      : SUITES.filter((s) => s.name === arg)

if (!chosen.length) {
  console.error(`unknown suite ${arg}. one of: ${SUITES.map((s) => s.name).join(', ')}, unit, browser`)
  process.exit(2)
}

let failed = 0
for (const s of chosen) {
  if (s.kind === 'browser' && !CHROME) {
    console.log(`SKIP  ${s.name} — no Chrome found`)
    continue
  }
  console.log(`\n${'─'.repeat(64)}\n${s.name}  — ${s.what}\n${'─'.repeat(64)}`)
  try {
    if (s.file.endsWith('.py')) {
      // The venv is where the server's own dependencies live.
      execFileSync('.venv/bin/python', [s.file], { stdio: 'inherit', env: { ...process.env, PYTHONPATH: '.' } })
    } else if (s.file.endsWith('.ts')) {
      const out = new URL(`../.artifacts/${s.name}.test.mjs`, import.meta.url).pathname
      execFileSync('npx', ['esbuild', s.file, '--bundle', '--platform=node', '--format=esm', `--outfile=${out}`, '--log-level=warning'], { stdio: 'inherit' })
      execFileSync('node', [out], { stdio: 'inherit', env: { ...process.env, CHROME } })
    } else {
      execFileSync('node', [s.file], { stdio: 'inherit', env: { ...process.env, CHROME } })
    }
  } catch {
    failed++
  }
}

console.log(failed ? `\n${failed} suite(s) failed` : '\nall suites passed')
process.exit(failed ? 1 : 0)
