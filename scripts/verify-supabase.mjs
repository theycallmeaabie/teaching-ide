/**
 * Proves a Supabase project is actually wired up, end to end.
 *
 *   node scripts/verify-supabase.mjs you@example.com 'some-password'
 *
 * Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env, signs in (or
 * creates the account), round-trips a row through each table, and checks that
 * row-level security actually refuses a signed-out reader. If
 * SUPABASE_JWT_SECRET is set and the API is up, it also confirms the server
 * accepts the token and still serves anonymous calls.
 *
 * Run this once after applying supabase/schema.sql. The session rows are the
 * evidence the whole proof of concept rests on; "it compiled" is not proof
 * they are being written.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const URL_ = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
const [email, password] = process.argv.slice(2)

let failures = 0
const check = (name, pass, detail = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

if (!URL_ || !KEY) {
  console.log('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set in .env.')
  console.log('Nothing to verify — the app runs signed-out, which is a supported mode.')
  process.exit(0)
}
if (!email || !password) {
  console.error('usage: node scripts/verify-supabase.mjs <email> <password>')
  process.exit(2)
}

const db = createClient(URL_, KEY)

// ----------------------------------------------------------------- sign in
let { data: auth, error } = await db.auth.signInWithPassword({ email, password })
if (error) {
  ;({ data: auth, error } = await db.auth.signUp({ email, password }))
  if (error) {
    check('sign in or sign up', false, error.message)
    process.exit(1)
  }
  if (!auth.session) {
    console.log('Account created, but the project requires email confirmation.')
    console.log('Confirm the address, then run this again.')
    process.exit(1)
  }
}
const userId = auth.session.user.id
check('signed in', !!userId, userId)

// ---------------------------------------------------------------- progress
const EX = '__verify__'
let r = await db
  .from('progress')
  .upsert(
    {
      user_id: userId, exercise_id: EX, solved: true, tier: 4, attempts: 2, hints_given: 3,
      begs: 2, seen: ['no-loop'], thread: [{ role: 'learner', text: 'why?' }, { role: 'teacher', text: 'because' }],
    },
    { onConflict: 'user_id,exercise_id' },
  )
check('progress row written', !r.error, r.error?.message ?? `exercise_id=${EX}`)

r = await db.from('progress').select('*').eq('user_id', userId).eq('exercise_id', EX).single()
check('progress row reads back', !r.error && r.data?.tier === 4, r.error?.message ?? `tier=${r.data?.tier}`)
check('updated_at is populated by the trigger', !!r.data?.updated_at, String(r.data?.updated_at))
check('the teacher\'s memory round-trips (begs, seen, thread)',
  r.data?.begs === 2 && r.data?.seen?.[0] === 'no-loop' && r.data?.thread?.length === 2,
  `begs=${r.data?.begs} seen=${JSON.stringify(r.data?.seen)} thread=${r.data?.thread?.length} turns — re-run supabase/schema.sql if these are missing`)

// ---------------------------------------------------------------- sessions
r = await db
  .from('sessions')
  .insert({
    user_id: userId,
    started_at: new Date().toISOString(),
    duration_ms: 1234,
    exercise_id: EX,
    config: { threshold: 0.6 },
    events: [{ t: 1, type: 'edit', offsetMs: 0 }],
    event_count: 1,
  })
  .select('id')
  .single()
check('session row written', !r.error, r.error?.message ?? `id=${r.data?.id}`)
const sessionId = r.data?.id

if (sessionId) {
  r = await db.from('sessions').update({ event_count: 2, duration_ms: 5678 }).eq('id', sessionId)
  check('session row updates (this is the 20s flush)', !r.error, r.error?.message ?? '')
  r = await db.from('sessions').select('event_count, events').eq('id', sessionId).single()
  check('session events read back as JSON', Array.isArray(r.data?.events), JSON.stringify(r.data?.events)?.slice(0, 60))
}

// --------------------------------------------------------------------- RLS
const anon = createClient(URL_, KEY)
const leaked = await anon.from('progress').select('*').eq('user_id', userId)
check('row-level security hides rows from a signed-out reader',
  (leaked.data ?? []).length === 0, `${(leaked.data ?? []).length} rows visible`)

// ------------------------------------------------------- the API, if it is up
const token = auth.session.access_token
const teach = async (headers) => {
  try {
    const res = await fetch('http://127.0.0.1:8000/api/health', { headers })
    return res.status
  } catch {
    return null
  }
}
const status = await teach({})
if (status == null) {
  console.log('SKIP  API not running on :8000 — start it with `npm run api` to check the token path')
} else {
  const withTok = await fetch('http://127.0.0.1:8000/api/teach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ buffer: '', exercise_id: 'x', exercise_prompt: '', expected_stdout: '', tier: 1, doc_version: 1 }),
  })
  check('the API accepts a real Supabase token', withTok.status !== 401, `status ${withTok.status}`)
  const withBad = await fetch('http://127.0.0.1:8000/api/teach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not.a.real.jwt' },
    body: JSON.stringify({ buffer: '', exercise_id: 'x', exercise_prompt: '', expected_stdout: '', tier: 1, doc_version: 1 }),
  })
  const secretSet = withBad.status === 401
  check('a forged token is rejected (needs SUPABASE_JWT_SECRET)', secretSet,
    secretSet ? 'rejected' : `status ${withBad.status} — SUPABASE_JWT_SECRET is probably unset`)
}

// ------------------------------------------------------------------- tidy up
await db.from('progress').delete().eq('user_id', userId).eq('exercise_id', EX)
if (sessionId) await db.from('sessions').delete().eq('id', sessionId)
await db.auth.signOut()

console.log(failures ? `\n${failures} check(s) failed` : '\nSupabase is wired up correctly.')
process.exit(failures ? 1 : 0)
