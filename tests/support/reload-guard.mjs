/**
 * Browser suites drive a live dev server, and the dev server reloads the page
 * whenever a source file is saved. That resets every bit of app state mid-test
 * and surfaces as a baffling failure somewhere unrelated — a counter that
 * "went 1 → 0", a promise that "was collected". It is not a failure of what was
 * being tested, and it should say so.
 *
 *   const reloads = watchReloads(page)           // right after newPage()
 *   ...
 *   check('page was not reloaded mid-run', reloads() === 0, reloads.detail())
 *
 * Pass the number of navigations the suite makes on purpose (its own `goto`s
 * and `reload`s) so only the unexpected ones count.
 */
export function watchReloads(page, expected = 1) {
  const at = []
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) at.push(Date.now()) })
  const count = () => Math.max(0, at.length - expected)
  count.detail = () =>
    count() === 0
      ? ''
      : `${count()} unexpected reload(s) — a source file changed under the dev server; every result above this line is unreliable, re-run while nobody is saving files`
  return count
}
