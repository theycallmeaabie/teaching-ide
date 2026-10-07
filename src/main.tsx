import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/jetbrains-mono'
import App from './App'
import './styles.css'
import { initTheme } from './ui/theme'

initTheme()

if (import.meta.env.DEV) {
  // Dev handle so the observer can be driven and inspected from the console or
  // an automated tuning run, without going through the panel's sliders.
  void Promise.all([
    import('./observer/observer'),
    import('./observer/config'),
    import('./store'),
    import('./lesson/teaching'),
    import('./teacher/bridge'),
  ]).then(([observer, config, store, teaching, bridge]) => {
    Object.assign(window, {
      __teachingIde: { observer, config },
      __store: store.useStore,
      __teaching: teaching,
      __bridge: bridge,
    })
  })
}

// Mount once the two fonts are in (capped, so a font that fails can never block
// the app). CodeMirror measures the teacher's bubble on first paint and only
// waits for fonts that are already loading at that moment — Geist is not, since
// it is requested lazily — so a webfont arriving afterwards re-wraps the bubble
// a line taller than was measured, and every line number below it drifts away
// from the code it labels.
const fonts = ['400 15px "Geist Variable"', '400 15px "JetBrains Mono Variable"']
const fontsReady = Promise.race([
  Promise.all(fonts.map((f) => document.fonts?.load(f))).catch(() => undefined),
  new Promise((resolve) => setTimeout(resolve, 1500)),
])

void fontsReady.then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)
