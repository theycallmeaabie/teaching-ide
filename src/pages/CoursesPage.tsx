import { Link } from 'wouter'
import { COURSES, solvedCount, type Course } from '../lesson/courses'
import { resumeCourse } from '../lesson/teaching'
import { useStore } from '../store'
import { ArrowRightIcon, CheckIcon, LockIcon } from '../ui/icons'
import { TopBar } from '../ui/TopBar'
import { useTitle } from '../ui/useTitle'

/** What the learner has done in a course, for the card. */
function useCourseProgress(course: Course) {
  const solved = useStore((s) => s.solved)
  const signedIn = useStore((s) => !!s.user)
  const progressLoaded = useStore((s) => s.progressLoaded)
  const progressError = useStore((s) => s.progressError)
  const started = useStore((s) => s.attempts > 0 || s.recent.length > 0 || s.exerciseIndex > 0)

  const total = course.exercises.length
  const done = solvedCount(course, solved)
  // A signed-in learner's ticks arrive a moment after they do. Until they have,
  // "0 solved" would be a claim, not a fact.
  const loading = signedIn && !progressLoaded && !progressError
  const label = done === total && total > 0 ? 'Review' : done > 0 || started ? 'Continue' : 'Start'
  return { total, done, loading, label }
}

function AvailableCard({ course }: { course: Course }) {
  const { total, done, loading, label } = useCourseProgress(course)

  return (
    <article className="course-card" data-course={course.id}>
      <div className="course-head">
        <span className="course-mark" aria-hidden="true">
          {course.mark}
        </span>
        <div>
          <h2>{course.title}</h2>
          <p className="course-meta">{total} exercises</p>
        </div>
      </div>

      <p className="course-tagline">{course.tagline}</p>

      <ul className="course-topics" aria-label="Topics">
        {course.topics.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>

      <div className="course-foot">
        <div className="course-progress">
          <div
            className="meter"
            role="progressbar"
            aria-label={`${course.title} progress`}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={loading ? undefined : done}
          >
            <span style={{ width: loading ? '0%' : `${(done / total) * 100}%` }} />
          </div>
          <span className="course-count">
            {loading ? (
              'Loading your progress…'
            ) : done === total ? (
              <>
                <CheckIcon size={13} /> All {total} solved
              </>
            ) : done > 0 ? (
              `${done} of ${total} solved`
            ) : (
              'Not started'
            )}
          </span>
        </div>
        <Link
          href={`/course/${course.id}`}
          className="btn btn-primary course-go"
          onClick={() => resumeCourse(course)}
        >
          {label}
          <ArrowRightIcon size={16} />
        </Link>
      </div>
    </article>
  )
}

/** A course that is not built yet. Shown so the page says where this is going,
 *  and locked so nobody expects it to open. */
function SoonCard({ course }: { course: Course }) {
  return (
    <article className="course-card soon" aria-disabled="true" data-course={course.id}>
      <div className="course-head">
        <span className="course-mark" aria-hidden="true">
          {course.mark}
        </span>
        <div>
          <h2>{course.title}</h2>
          <p className="course-meta">
            <LockIcon size={12} /> Coming soon
          </p>
        </div>
      </div>
      <p className="course-tagline">{course.tagline}</p>
    </article>
  )
}

export function CoursesPage() {
  const user = useStore((s) => s.user)
  useTitle('Courses')

  return (
    <div className="app">
      <TopBar />
      <main className="courses">
        <div className="courses-inner">
          <h1>Choose a course</h1>
          <p className="courses-sub">
            {user
              ? 'Your progress is saved on every course.'
              : 'You are browsing as a guest, so nothing is saved. Sign in to keep your progress.'}
          </p>
          <div className="course-grid">
            {COURSES.map((c) =>
              c.status === 'available' ? (
                <AvailableCard key={c.id} course={c} />
              ) : (
                <SoonCard key={c.id} course={c} />
              ),
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
