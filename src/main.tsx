import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
