/**
 * Where the API lives.
 *
 * Unset, every call goes to this origin: in development Vite proxies /api, and
 * `npm start` or the Docker image serves the app and the API together. Set
 * VITE_API_URL at build time when the app is hosted apart from the API (the
 * page on Vercel, the API on Render); that API must then list this page's
 * origin in ALLOWED_ORIGINS or the browser refuses every response.
 */
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')

export const apiUrl = (path: string): string => BASE + path
