import type { ReactNode } from 'react'
import { Link } from 'wouter'
import { AuthBar } from './AuthBar'
import { TerminalIcon } from './icons'
import { ThemeToggle } from './ThemeToggle'

/** The product's name and mark. Not a link on pages where "home" is where you are. */
export function Brand({ home = false }: { home?: boolean }) {
  const inner = (
    <>
      <span className="brand-mark">
        <TerminalIcon size={18} />
      </span>
      Teaching IDE
    </>
  )
  return home ? (
    <Link href="/courses" className="brand brand-link">
      {inner}
    </Link>
  ) : (
    <div className="brand">{inner}</div>
  )
}

/**
 * The bar across the top of the course page and the lesson. `course` adds the
 * way back ("Courses / Python"); `children` are the page's own controls, shown
 * before the theme switch and the sign-in state that every page shares.
 */
export function TopBar({ course, children }: { course?: string; children?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <Brand home />
        {course && (
          <nav className="crumbs" aria-label="Breadcrumb">
            <Link href="/courses">Courses</Link>
            <span className="crumb-sep" aria-hidden="true">
              /
            </span>
            <span aria-current="page">{course}</span>
          </nav>
        )}
      </div>
      <div className="topbar-actions">
        {children}
        <ThemeToggle />
        <AuthBar />
      </div>
    </header>
  )
}
