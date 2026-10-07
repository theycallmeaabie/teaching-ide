/** Per-viewer conveniences. Storage can be blocked or throw (private windows,
 *  cleared site data), so nothing here may be load-bearing. */
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* the preference just won't survive a reload */
  }
}
