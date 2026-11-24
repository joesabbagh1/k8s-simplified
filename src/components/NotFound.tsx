import { useEffect, useRef } from "react"
import { HOME_PATH, LIBRARY_PATH } from "../route"
import { Link } from "./Link"

export function NotFound() {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <main className="library" aria-labelledby="not-found-title">
      <div className="library-inner">
        <div className="library-empty">
          <h1 id="not-found-title" ref={headingRef} tabIndex={-1} className="library-title">Page not found</h1>
          <p>There is no lesson or step at this address.</p>
          <div className="hero-actions">
            <Link className="btn primary lg" to={LIBRARY_PATH}>Browse the lessons</Link>
            <Link className="btn lg" to={HOME_PATH}>Go to the homepage</Link>
          </div>
        </div>
      </div>
    </main>
  )
}
