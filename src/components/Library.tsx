import { Button } from "@ui-sdk/react/button"
import { Input, InputClear, InputGroup } from "@ui-sdk/react/input"
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control"
import { type CSSProperties, useEffect, useMemo, useRef } from "react"
import { CATEGORIES, CATEGORY_NAME } from "../data/layers"
import { LESSONS } from "../data/lessons"
import { sentence } from "../data/text"
import type { Lesson } from "../data/types"
import { type LibraryFilter, useApp } from "../store"
import { lessonPath } from "../route"
import { Icon } from "./Icon"
import { LayerArt } from "./LayerArt"
import { Link } from "./Link"

interface Match {
  lesson: Lesson
  /** steps whose title matches the search, as [index, title] */
  steps: [number, string][]
}

const terms = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean)
const hasAll = (text: string, words: string[]) => words.every((w) => text.includes(w))

function search(query: string): Match[] {
  const words = terms(query)
  return LESSONS.flatMap((lesson) => {
    const titles = lesson.steps.map((step) => sentence(step.title))
    const text = [lesson.title, lesson.subtitle, CATEGORY_NAME[lesson.category], ...titles].join(" ").toLowerCase()
    if (!hasAll(text, words)) return []
    const steps = words.length
      ? titles.flatMap((title, i): [number, string][] => (hasAll(title.toLowerCase(), words) ? [[i, title]] : []))
      : []
    return [{ lesson, steps }]
  })
}

export function Library() {
  const query = useApp((s) => s.libraryQuery)
  const filter = useApp((s) => s.libraryFilter)
  const { setLibraryQuery, setLibraryFilter } = useApp.getState()
  const searchRef = useRef<HTMLInputElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const matches = useMemo(() => search(query), [query])
  const shown = filter === "all" ? matches : matches.filter((m) => m.lesson.category === filter)
  const count = (category: LibraryFilter) =>
    category === "all" ? matches.length : matches.filter((m) => m.lesson.category === category).length

  // Moving to a new page leaves focus on the link that was pressed, so put it on the heading.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  const clear = () => {
    setLibraryQuery("")
    setLibraryFilter("all")
    searchRef.current?.focus()
  }

  return (
    <main className="library" aria-labelledby="library-title">
      <div className="library-inner">
        <header className="library-head">
          <h1 id="library-title" ref={headingRef} tabIndex={-1} className="library-title">Kubernetes lessons</h1>
          <p className="library-lead">{LESSONS.length} lessons on how a cluster works, from packets on the wire up to the app</p>
        </header>

        <div className="library-filters">
          <InputGroup className="library-search">
            <Icon name="search" />
            <Input
              ref={searchRef}
              type="search"
              aria-label="Search lessons and steps"
              placeholder="Search lessons and steps"
              value={query}
              onValueChange={(value) => setLibraryQuery(value)}
            />
            <InputClear className="ibtn ghost sm" aria-label="Clear search">
              <Icon name="close" />
            </InputClear>
          </InputGroup>
          <SegmentedControl
            className="seg"
            aria-label="Category"
            value={filter}
            onValueChange={(value) => setLibraryFilter((value as LibraryFilter | null) ?? "all")}
          >
            <SegmentedControlIndicator className="seg-indicator" />
            {(["all", ...CATEGORIES] as const).map((category) => (
              <SegmentedControlItem key={category} value={category}>
                {category === "all" ? "All" : CATEGORY_NAME[category]}
                <span className="seg-count">{count(category)}</span>
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>

        <p className="sr-only" role="status">{shown.length === 1 ? "1 lesson" : `${shown.length} lessons`}</p>

        {shown.length === 0 ? (
          <div className="library-empty">
            <p>No lesson matches {query ? <>“{query}”</> : "that"}{filter !== "all" && <> in {CATEGORY_NAME[filter]}</>}.</p>
            <Button className="btn" onClick={clear}>Clear filters</Button>
          </div>
        ) : (
          CATEGORIES.map((category) => {
            const group = shown.filter((m) => m.lesson.category === category)
            if (!group.length) return null
            return (
              <section key={category} className="library-group" aria-labelledby={`group-${category}`}>
                <header className="library-group-head">
                  <h2 id={`group-${category}`} className="library-group-title">{CATEGORY_NAME[category]}</h2>
                  <p className="library-group-count">{group.length === 1 ? "1 lesson" : `${group.length} lessons`}</p>
                  {!query && <LayerArt category={category} />}
                </header>
                <ul className="lesson-list" style={{ "--rows": Math.ceil(group.length / 2) } as CSSProperties}>
                  {group.map(({ lesson, steps }) => (
                    <li key={lesson.id} className="lesson-item">
                      <div className="lesson-row">
                        <Link className="lesson-link" to={lessonPath(lesson.id)}>{lesson.title}</Link>
                        <p className="lesson-sub">{lesson.subtitle}</p>
                        <span className="lesson-meta">{lesson.steps.length} steps</span>
                      </div>
                      {steps.length > 0 && (
                        <ul className="lesson-steps" aria-label={`Matching steps in ${lesson.title}`}>
                          {steps.slice(0, 3).map(([i, title]) => (
                            <li key={i}>
                              <Link to={lessonPath(lesson.id, i + 1)}>
                                <span className="mono">{i + 1}</span>
                                {title}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )
          })
        )}
      </div>
    </main>
  )
}
