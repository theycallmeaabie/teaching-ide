import { useState, type FormEvent } from 'react'
import { Redirect, useLocation, useSearch } from 'wouter'
import { safeNext } from '../auth/access'
import {
  continueAsGuest,
  requestPasswordReset,
  resendConfirmation,
  signIn,
  signUp,
} from '../auth/session'
import { authConfigured } from '../auth/supabase'
import { useStore } from '../store'
import { Splash } from '../ui/Splash'
import { Brand } from '../ui/TopBar'
import { ThemeToggle } from '../ui/ThemeToggle'
import { useTitle } from '../ui/useTitle'

type Mode = 'signin' | 'signup' | 'forgot'

const COPY: Record<Mode, { title: string; lede: string; submit: string }> = {
  signin: {
    title: 'Sign in',
    lede: 'Pick up where you left off.',
    submit: 'Sign in',
  },
  signup: {
    title: 'Create your account',
    lede: 'Keep your progress, and let the teacher remember how you learn.',
    submit: 'Create account',
  },
  forgot: {
    title: 'Reset your password',
    lede: 'Enter your email and we will send you a link to choose a new one.',
    submit: 'Send reset link',
  },
}

/**
 * Where everyone starts. Signing in keeps progress and records the session;
 * "Continue as guest" is the same lesson with neither, so this is an offer and
 * not a wall.
 */
export function SignInPage() {
  const user = useStore((s) => s.user)
  const authReady = useStore((s) => s.authReady)
  const [, navigate] = useLocation()
  const params = new URLSearchParams(useSearch())
  const next = safeNext(params.get('next'))

  const [mode, setMode] = useState<Mode>(params.get('mode') === 'forgot' ? 'forgot' : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Something they should read that is not an error: a link was sent. */
  const [notice, setNotice] = useState<string | null>(null)
  /** Sign-up is waiting on the email being confirmed. */
  const [awaitingConfirm, setAwaitingConfirm] = useState(false)

  useTitle(COPY[mode].title)

  // No project to sign in to: there is nothing to ask, so go straight in.
  if (!authConfigured) return <Redirect to={next} replace />
  if (!authReady) return <Splash />
  if (user) return <Redirect to={next} replace />

  function switchTo(m: Mode) {
    setMode(m)
    setError(null)
    setNotice(null)
    setAwaitingConfirm(false)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)

    const trimmed = email.trim()

    if (mode === 'signin') {
      const err = await signIn(trimmed, password)
      if (err) setError(err)
      // On success the session arrives through the auth listener, and `user`
      // above redirects. Nothing to do here.
    } else if (mode === 'signup') {
      const res = await signUp(trimmed, password)
      if ('error' in res) setError(res.error)
      else if (res.confirm) setAwaitingConfirm(true)
    } else {
      const err = await requestPasswordReset(trimmed)
      if (err) setError(err)
      // Said the same whether or not the address has an account, so this page
      // cannot be used to find out who does.
      else setNotice('If that address has an account, a reset link is on its way.')
    }
    setBusy(false)
  }

  async function resend() {
    setBusy(true)
    setError(null)
    const err = await resendConfirmation(email.trim())
    setBusy(false)
    if (err) setError(err)
    else setNotice('Sent again.')
  }

  function guest() {
    continueAsGuest()
    navigate(next, { replace: true })
  }

  const copy = COPY[mode]

  return (
    <div className="gate">
      <header className="gate-top">
        <Brand />
        <ThemeToggle />
      </header>

      <main className="gate-main">
        <div className="gate-card">
          {awaitingConfirm ? (
            <>
              <h1>Check your email</h1>
              <p className="gate-lede">
                We sent a confirmation link to <b>{email.trim()}</b>. Open it, then come back here
                and sign in.
              </p>
              {error && (
                <p className="gate-error" role="alert">
                  {error}
                </p>
              )}
              {notice && (
                <p className="gate-notice" role="status">
                  {notice}
                </p>
              )}
              <div className="gate-actions">
                <button className="btn btn-primary gate-submit" onClick={() => switchTo('signin')}>
                  Back to sign in
                </button>
                <button className="btn btn-ghost" onClick={() => void resend()} disabled={busy}>
                  Send it again
                </button>
              </div>
            </>
          ) : (
            <>
              <h1>{copy.title}</h1>
              <p className="gate-lede">{copy.lede}</p>

              <form className="gate-form" onSubmit={(e) => void submit(e)}>
                <label className="field">
                  <span>Email</span>
                  <input
                    type="email"
                    name="email"
                    value={email}
                    autoComplete="email"
                    required
                    autoFocus
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>

                {mode !== 'forgot' && (
                  <label className="field">
                    <span>Password</span>
                    <input
                      type="password"
                      name="password"
                      value={password}
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      required
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                )}

                {error && (
                  <p className="gate-error" role="alert">
                    {error}
                  </p>
                )}
                {notice && (
                  <p className="gate-notice" role="status">
                    {notice}
                  </p>
                )}

                <button className="btn btn-primary gate-submit" type="submit" disabled={busy}>
                  {busy ? 'One moment…' : copy.submit}
                </button>
              </form>

              <div className="gate-switch">
                {mode === 'signin' && (
                  <>
                    <button className="linkish" type="button" onClick={() => switchTo('forgot')}>
                      Forgot your password?
                    </button>
                    <span>
                      New here?{' '}
                      <button className="linkish" type="button" onClick={() => switchTo('signup')}>
                        Create an account
                      </button>
                    </span>
                  </>
                )}
                {mode === 'signup' && (
                  <span>
                    Already have an account?{' '}
                    <button className="linkish" type="button" onClick={() => switchTo('signin')}>
                      Sign in
                    </button>
                  </span>
                )}
                {mode === 'forgot' && (
                  <button className="linkish" type="button" onClick={() => switchTo('signin')}>
                    Back to sign in
                  </button>
                )}
              </div>
            </>
          )}

          <div className="gate-or" role="separator">
            <span>or</span>
          </div>

          <button className="btn gate-guest" type="button" onClick={guest}>
            Continue as guest
          </button>
          <p className="gate-fine">
            Guests get the whole lesson. Your progress isn’t saved when you close the tab.
          </p>
        </div>
      </main>
    </div>
  )
}
