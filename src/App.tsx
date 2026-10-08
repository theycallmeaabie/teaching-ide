import { useEffect, type ReactNode } from 'react'
import { Redirect, Route, Switch, useLocation } from 'wouter'
import { useAccess } from './auth/access'
import { initAuth } from './auth/session'
import { courseById } from './lesson/courses'
import { CoursePage } from './pages/CoursePage'
import { CoursesPage } from './pages/CoursesPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { SignInPage } from './pages/SignInPage'
import { Splash } from './ui/Splash'

/**
 * Lets a page through only once the person has signed in or chosen to continue
 * as a guest, and sends everyone else to the sign-in page, remembering where they
 * were headed so signing in takes them there.
 */
function Guarded({ children }: { children: ReactNode }) {
  const access = useAccess()
  const [location] = useLocation()

  if (access === 'pending') return <Splash />
  if (access === 'signin') {
    const next = location === '/courses' ? '' : `?next=${encodeURIComponent(location)}`
    return <Redirect to={`/signin${next}`} replace />
  }
  return <>{children}</>
}

/** `/course/:id` for a course that exists and is built; anything else is the course page. */
function CourseRoute({ id }: { id: string }) {
  const course = courseById(id)
  if (!course || course.status !== 'available') return <Redirect to="/courses" replace />
  return <CoursePage course={course} />
}

export default function App() {
  // The one place auth is started, so every page can rely on it. It settles
  // immediately into signed-out when Supabase is unconfigured.
  useEffect(() => initAuth(), [])

  return (
    <Switch>
      <Route path="/signin" component={SignInPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/courses">
        <Guarded>
          <CoursesPage />
        </Guarded>
      </Route>
      <Route path="/course/:id">
        {(params) => (
          <Guarded>
            <CourseRoute id={params.id} />
          </Guarded>
        )}
      </Route>
      {/* "/", and anything that is not a page: the course page decides whether
          they need to sign in first. */}
      <Route>
        <Redirect to="/courses" replace />
      </Route>
    </Switch>
  )
}
