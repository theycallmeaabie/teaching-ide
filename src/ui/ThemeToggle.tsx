import { useSyncExternalStore } from 'react'
import { getTheme, setTheme, subscribeTheme } from './theme'
import { MoonIcon, SunIcon } from './icons'

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme)
  const next = theme === 'dark' ? 'light' : 'dark'

  return (
    <button
      className="btn btn-ghost btn-icon"
      onClick={() => setTheme(next)}
      title={`Switch to the ${next} theme`}
    >
      {theme === 'dark' ? <SunIcon size={22} /> : <MoonIcon size={22} />}
      <span className="sr-only">{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  )
}
