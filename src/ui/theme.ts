import { readPref, writePref } from './prefs'

export type Theme = 'light' | 'dark'

/** index.html reads the same key to set the theme before first paint. */
const KEY = 'teaching-ide:theme'

const listeners = new Set<() => void>()

function stored(): Theme | null {
  const v = readPref(KEY)
  return v === 'light' || v === 'dark' ? v : null
}

function system(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function getTheme(): Theme {
  const set = document.documentElement.dataset.theme
  return set === 'light' || set === 'dark' ? set : (stored() ?? system())
}

function paint(t: Theme) {
  document.documentElement.dataset.theme = t
  for (const l of listeners) l()
}

/** An explicit choice sticks; until one is made the OS setting is followed. */
export function setTheme(t: Theme) {
  writePref(KEY, t)
  paint(t)
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function initTheme() {
  paint(getTheme())
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!stored()) paint(system())
  })
}
