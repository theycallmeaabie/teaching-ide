/**
 * "Continue as guest" is a choice for this sitting, not a standing one: it
 * lives in sessionStorage, so a refresh keeps it, a new tab asks again, and
 * nothing about it outlives the person closing the tab.
 *
 * A per-viewer convenience, so storage that is blocked or throws must never be
 * load-bearing. The worst outcome is being asked to choose again after a refresh.
 */
const KEY = 'teaching-ide:guest'

export function readGuest(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function writeGuest(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(KEY, '1')
    else sessionStorage.removeItem(KEY)
  } catch {
    /* the choice just won't survive a reload */
  }
}
