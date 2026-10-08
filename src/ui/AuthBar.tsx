import { useState } from 'react'
import { signIn, signOut, signUp } from '../auth/session'
import { authConfigured } from '../auth/supabase'
import { loadProgress } from '../data/progress'
import { useStore } from '../store'

/**
 * Sign-in lives in the topbar, not behind a wall. The lesson is usable signed
 * out — signing in only adds saved progress and a recorded session — so this
 * must never block the editor from rendering.
 */
export function AuthBar() {
  const user = useStore((s) => s.user)
  const authReady = useStore((s) => s.authReady)
  const progressError = useStore((s) => s.progressError)
  const progressLoaded = useStore((s) => s.progressLoaded)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (!authConfigured || !authReady) return null

  if (user) {
    return (
      <span className="authbar">
        {progressError && (
          <span className="auth-warn" role="alert">
            {progressError}{' '}
            {!progressLoaded && (
              <button className="auth-retry" onClick={() => void loadProgress()}>
                Try again
              </button>
            )}
          </span>
        )}
        <span className="auth-who" title={user.email ?? user.id}>
          {user.email ?? 'signed in'}
        </span>
        <button className="btn btn-ghost small" onClick={() => void signOut()}>
          Sign out
        </button>
      </span>
    )
  }

  async function submit(kind: 'in' | 'up') {
    setBusy(true)
    setMessage(null)
    const err = kind === 'in' ? await signIn(email, password) : await signUp(email, password)
    setBusy(false)
    if (err) {
      setMessage(err)
      return
    }
    setOpen(false)
    setEmail('')
    setPassword('')
  }

  return (
    <span className="authbar">
      {!open && (
        <button className="btn btn-ghost small" onClick={() => setOpen(true)}>
          Sign in
        </button>
      )}
      {open && (
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit('in')
          }}
        >
          <input
            type="email"
            placeholder="email"
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <input
            type="password"
            placeholder="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button className="btn btn-primary small" type="submit" disabled={busy}>
            {busy ? '…' : 'Sign in'}
          </button>
          <button
            className="btn btn-ghost small"
            type="button"
            disabled={busy}
            onClick={() => void submit('up')}
          >
            Create
          </button>
          <button className="btn btn-ghost small" type="button" onClick={() => setOpen(false)}>
            ×
          </button>
        </form>
      )}
      {message && <span className="auth-msg">{message}</span>}
    </span>
  )
}
