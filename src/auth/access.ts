import { useStore } from '../store'
import { authConfigured } from './supabase'

/**
 * Whether this person may see the course pages yet.
 *
 * `pending` until the first auth check settles, so someone who is already
 * signed in is never shown the sign-in form for a moment on the way past.
 * `signin` means they have neither signed in nor chosen to continue as a guest.
 *
 * With no Supabase project configured there is nothing to sign in to, so
 * everyone is let through, exactly as the app behaved before accounts existed.
 */
export type Access = 'pending' | 'allowed' | 'signin'

export function useAccess(): Access {
  const authReady = useStore((s) => s.authReady)
  const user = useStore((s) => s.user)
  const guest = useStore((s) => s.guest)

  if (!authConfigured) return 'allowed'
  if (!authReady) return 'pending'
  return user || guest ? 'allowed' : 'signin'
}

/**
 * Where to go after signing in. It comes from the URL, so it is untrusted:
 * only a path on this site is accepted, never another origin, and never the
 * sign-in page itself (that would loop).
 */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/courses'
  if (/^\/(signin|reset-password)(\/|\?|$)/.test(raw)) return '/courses'
  return raw
}
