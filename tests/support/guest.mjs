/**
 * The course pages sit behind the sign-in page, and the lesson is at
 * /course/python. A suite that is not about signing in enters the way the
 * "Continue as guest" button does: it sets the guest flag before the page loads
 * and goes straight to the lesson.
 *
 *   const page = await b.newPage()
 *   await asGuest(page)                      // before any goto
 *   await page.goto(LESSON, ...)
 */
export const ORIGIN = 'http://localhost:5173'
export const LESSON = `${ORIGIN}/course/python`

export const asGuest = (page) =>
  page.evaluateOnNewDocument(() => {
    try {
      sessionStorage.setItem('teaching-ide:guest', '1')
    } catch {
      /* storage blocked: the sign-in page will ask, and the suite will say so */
    }
  })
