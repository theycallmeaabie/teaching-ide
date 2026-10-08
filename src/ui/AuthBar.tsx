import { Link, useLocation } from 'wouter'
import { signOut } from '../auth/session'
import { authConfigured } from '../auth/supabase'
import { loadProgress } from '../data/progress'
import { useStore } from '../store'

/**
 * Who is here, in the top bar of every page that has one. Signing in happens on
 * the sign-in page; this only shows the state and the way to change it.
 *
 * A guest can use everything, so "Sign in" is an offer and never a gate.
 */
export function AuthBar() {
  const user = useStore((s) => s.user)
  const authReady = useStore((s) => s.authReady)
  const progressError = useStore((s) => s.progressError)
  const progressLoaded = useStore((s) => s.progressLoaded)
  const [location] = useLocation()

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

  return (
    <span className="authbar">
      <Link
        href={`/signin?next=${encodeURIComponent(location)}`}
        className="btn btn-ghost small"
        title="Nothing is being saved. Sign in to keep your progress."
      >
        Sign in
      </Link>
    </span>
  )
}
