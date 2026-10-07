/**
 * An in-memory stand-in for the three Supabase surfaces the app touches:
 * password auth, /rest/v1/progress and /rest/v1/sessions.
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

export const db = { progress: [], sessions: [], requests: [], failProgressReads: false }

function sessionFor(email) {
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
    res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS')
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

    if (url.pathname === '/auth/v1/token' || url.pathname === '/auth/v1/signup') {
      return send(200, sessionFor(body?.email ?? 'refresh@test.dev'))
    }
    if (url.pathname === '/auth/v1/logout') return send(204)

    if (url.pathname === '/rest/v1/progress') {
      if (req.method === 'GET') {
        if (db.failProgressReads) return send(500, { message: 'the read failed' })
        const uid = url.searchParams.get('user_id')?.replace('eq.', '')
        return send(200, db.progress.filter((r) => r.user_id === uid))
      }
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
