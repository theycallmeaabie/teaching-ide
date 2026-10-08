/** Shown while the first auth check settles, so a signed-in learner is not shown
 *  a sign-in form for a moment on the way past. */
export function Splash() {
  return (
    <div className="splash" role="status" aria-label="Loading">
      <span className="spinner" />
    </div>
  )
}
