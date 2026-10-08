/**
 * An in-memory stand-in for the Supabase surfaces the app touches: password auth
 * (sign-in, sign-up, password reset, resend), /rest/v1/progress and /rest/v1/sessions.
 *
 * It exists to exercise the APP's state handling — what it restores, what it
 * saves, what it forgets when someone else sits down. It has no row-level
 * security and does not pretend to; `npm run verify-supabase` is the check
 * against the real thing.
 */
import http from 'node:http'
import { createHash } from 'node:crypto'

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')

export const uuidFor = (email) => {
  const h = createHash('sha1').update(email).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

// `progressWriteDelays` holds a delay, in ms, for each successive write to the progress
// table: [700, 0] makes the first write arrive after the second, as a real network can.
export const db = {
  progress: [], sessions: [], requests: [], failProgressReads: false, progressWriteDelays: [],
  // Sign-up behaves like a project with "Confirm email" on: the account is made, no session comes back.
  confirmSignups: false,
  // What the auth endpoints were asked to do, for the suites that check they were.
  recoveries: [], resends: [], passwordUpdates: [],
}

/** A password this fake refuses, so a suite can see a failed sign-in. */
export const WRONG_PASSWORD = 'wrong-password'

export function sessionFor(email) {
  const id = uuidFor(email)
  const now = Math.floor(Date.now() / 1000)
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, aud: 'authenticated', role: 'authenticated', email, exp: now + 3600 })}.${b64('sig')}`
  return {
    access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r-' + id,
    user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  }
}

export function start(port) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader('access-control-allow-headers', `${req.headers['access-control-request-headers'] ?? ''},authorization,apikey,content-type,prefer,accept,x-client-info`)
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }

    let raw = ''
    for await (const c of req) raw += c
    const body = raw ? JSON.parse(raw) : null
    const send = (code, data) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(data === undefined ? '' : JSON.stringify(data))
    }
    db.requests.push({ method: req.method, path: url.pathname, query: url.search })

    if (url.pathname === '/auth/v1/token' && body?.password === WRONG_PASSWORD) {
      return send(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
    }
    if (url.pathname === '/auth/v1/signup' && db.confirmSignups) {
      // The account exists but is not usable yet: a user, and no access token.
      return send(200, sessionFor(body?.email ?? 'new@test.dev').user)
    }
    if (url.pathname === '/auth/v1/token' || url.pathname === '/auth/v1/signup') {
      return send(200, sessionFor(body?.email ?? 'refresh@test.dev'))
    }
    if (url.pathname === '/auth/v1/logout') return send(204)

    if (url.pathname === '/auth/v1/recover') {
      db.recoveries.push({ email: body?.email, redirectTo: url.searchParams.get('redirect_to') })
      return send(200, {})
    }
    if (url.pathname === '/auth/v1/resend') {
      db.resends.push({ email: body?.email, type: body?.type })
      return send(200, {})
    }
    if (url.pathname === '/auth/v1/user') {
      // Who holds this token. The fake's tokens carry the email in their payload.
      const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '')
      let claims = null
      try { claims = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()) } catch { /* not one of ours */ }
      if (!claims?.email) return send(401, { code: 401, msg: 'invalid JWT' })
      if (req.method === 'PUT') db.passwordUpdates.push({ email: claims.email, password: body?.password })
      return send(200, sessionFor(claims.email).user)
    }

    if (url.pathname === '/rest/v1/progress') {
      if (req.method === 'GET') {
        if (db.failProgressReads) return send(500, { message: 'the read failed' })
        const uid = url.searchParams.get('user_id')?.replace('eq.', '')
        return send(200, db.progress.filter((r) => r.user_id === uid))
      }
      const wait = db.progressWriteDelays.shift() ?? 0
      if (wait) await new Promise((r) => setTimeout(r, wait))
      for (const row of [].concat(body)) {
        const i = db.progress.findIndex((r) => r.user_id === row.user_id && r.exercise_id === row.exercise_id)
        if (i >= 0) db.progress[i] = { ...db.progress[i], ...row }
        else db.progress.push(row)
      }
      return send(201)
    }

    if (url.pathname === '/rest/v1/sessions') {
      if (req.method === 'POST') {
        const row = { id: uuidFor('s' + db.sessions.length + Date.now()), ...body }
        db.sessions.push(row)
        const single = (req.headers.accept ?? '').includes('vnd.pgrst.object')
        return send(201, single ? { id: row.id } : [{ id: row.id }])
      }
      if (req.method === 'PATCH') {
        const id = url.searchParams.get('id')?.replace('eq.', '')
        const i = db.sessions.findIndex((r) => r.id === id)
        if (i >= 0) db.sessions[i] = { ...db.sessions[i], ...body }
        return send(204)
      }
    }
    send(404, { message: 'unhandled ' + url.pathname })
  })
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)))
}
