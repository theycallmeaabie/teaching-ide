import { useEffect } from 'react'

const BASE = 'Teaching IDE'

/** One title per page, so the tab and the history say where you are. */
export function useTitle(page: string): void {
  useEffect(() => {
    document.title = `${page} · ${BASE}`
    return () => {
      document.title = BASE
    }
  }, [page])
}
