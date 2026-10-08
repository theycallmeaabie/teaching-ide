import { useState, type FormEvent } from 'react'
import { Link, Redirect, useLocation } from 'wouter'
import { updatePassword } from '../auth/session'
import { authConfigured } from '../auth/supabase'
import { useStore } from '../store'
import { Splash } from '../ui/Splash'
import { ThemeToggle } from '../ui/ThemeToggle'
import { Brand } from '../ui/TopBar'
import { useTitle } from '../ui/useTitle'

/**
 * Where the link in a reset email lands. Following it signs the person in far
 * enough to change their password, so this needs a session, and a visit without
 * one (an expired or already-used link, or someone typing the address) is told
 * so and sent back to ask for a new one.
 */
export function ResetPasswordPage() {
  const user = useStore((s) => s.user)
  const authReady = useStore((s) => s.authReady)
  const [, navigate] = useLocation()
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useTitle('Choose a new password')

  if (!authConfigured) return <Redirect to="/courses" replace />
  if (!authReady) return <Splash />

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (password !== again) {
      setError('Those two passwords are different.')
      return
    }
    setBusy(true)
    setError(null)
    const err = await updatePassword(password)
    setBusy(false)
    if (err) setError(err)
    else navigate('/courses', { replace: true })
  }

  return (
    <div className="gate">
      <header className="gate-top">
        <Brand />
        <ThemeToggle />
      </header>

      <main className="gate-main">
        <div className="gate-card">
          {user ? (
            <>
              <h1>Choose a new password</h1>
              <p className="gate-lede">You will be signed in with it straight away.</p>
              <form className="gate-form" onSubmit={(e) => void submit(e)}>
                <label className="field">
                  <span>New password</span>
                  <input
                    type="password"
                    name="password"
                    value={password}
                    autoComplete="new-password"
                    required
                    autoFocus
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Type it again</span>
                  <input
                    type="password"
                    name="password-again"
                    value={again}
                    autoComplete="new-password"
                    required
                    onChange={(e) => setAgain(e.target.value)}
                  />
                </label>
                {error && (
                  <p className="gate-error" role="alert">
                    {error}
                  </p>
                )}
                <button className="btn btn-primary gate-submit" type="submit" disabled={busy}>
                  {busy ? 'One moment…' : 'Save password'}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1>That link has expired</h1>
              <p className="gate-lede">
                Reset links work once, and only for a short while. Ask for a new one and we will
                send it.
              </p>
              <Link href="/signin?mode=forgot" className="btn btn-primary gate-submit">
                Get a new link
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
