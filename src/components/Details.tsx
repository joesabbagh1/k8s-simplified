import { Button } from "@ui-sdk/react/button"
import { Listbox, ListboxItem } from "@ui-sdk/react/listbox"
import { useEffect, useRef } from "react"
import { CATEGORY_NAME } from "../data/layers"
import { LESSONS } from "../data/lessons"
import { sentence } from "../data/text"
import type { Fact } from "../data/types"
import { stats } from "../playback"
import { lessonPath } from "../route"
import { useApp, useLesson } from "../store"
import { Icon } from "./Icon"
import { Link } from "./Link"

function Facts({ facts }: { facts: readonly Fact[] }) {
  if (!facts.length) return null
  return (
    <dl className="facts">
      {facts.map(([k, v]) => (
        <div key={k}>
          <dt>{sentence(k)}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Renders `code` spans for words that look like Kubernetes fields, e.g. spec.nodeName. */
function Prose({ text }: { text: string }) {
  const parts = text.split(/(\b[a-z]+(?:\.[a-zA-Z]+)+\b)/g)
  return <p className="body">{parts.map((p, i) => (i % 2 ? <code key={i}>{p}</code> : p))}</p>
}

const seconds = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`)

function Summary() {
  const lesson = useLesson()
  const togglePlay = useApp((s) => s.togglePlay)
  const openLesson = useApp((s) => s.openLesson)
  const s = stats(lesson)
  const next = LESSONS[(LESSONS.indexOf(lesson) + 1) % LESSONS.length]

  return (
    <>
      <div className="kicker ok">Lesson complete</div>
      <h1 className="display">{lesson.summary ? sentence(lesson.summary.title) : lesson.title}</h1>
      <p className="sub">{lesson.title}</p>
      {lesson.summary && <Prose text={lesson.summary.body} />}
      <dl className="stats">
        <div><dt>events</dt><dd>{s.events}</dd></div>
        <div><dt>API calls</dt><dd>{s.apiCalls}</dd></div>
        <div><dt>packets</dt><dd>{s.packets}</dd></div>
        <div><dt>elapsed</dt><dd>{seconds(s.duration)}</dd></div>
      </dl>
      <Facts facts={lesson.summary?.facts ?? []} />
      <div className="actions">
        <Button className="btn" onClick={togglePlay}>
          <Icon name="replay" size={13} />
          Replay
        </Button>
        {next !== lesson && (
          <Button className="btn primary" onClick={() => openLesson(next.id)}>
            Next lesson
            <Icon name="right" size={13} />
          </Button>
        )}
      </div>
    </>
  )
}

function Steps() {
  const lesson = useLesson()
  const step = useApp((s) => s.step)
  const finished = useApp((s) => s.finished)
  const goToStep = useApp((s) => s.goToStep)
  const current = step >= 0 && !finished ? String(step) : null

  return (
    <nav className="toc" aria-label="Lesson steps">
      <Listbox
        aria-label="Steps"
        className="toc-list"
        value={current}
        onValueChange={(v) => typeof v === "string" && goToStep(Number(v))}
      >
        {lesson.steps.map((s, i) => {
          const state = finished || (step >= 0 && i < step) ? "done" : String(i) === current ? "active" : undefined
          return (
            <ListboxItem key={String(i)} value={String(i)} label={sentence(s.title)} className="toc-item" data-state={state}>
              <span className="num" aria-hidden="true">{state === "done" ? <Icon name="check" size={10} /> : i + 1}</span>
              <span className="toc-title">{sentence(s.title)}</span>
            </ListboxItem>
          )
        })}
      </Listbox>
    </nav>
  )
}

/** The whole lesson as text, for reading straight through and for search engines, which don't press Play. */
function Transcript() {
  const lesson = useLesson()
  const next = LESSONS[(LESSONS.indexOf(lesson) + 1) % LESSONS.length]

  return (
    <details className="transcript">
      {/* Space opens it, rather than reaching the Play shortcut */}
      <summary onKeyDown={(e) => e.key === " " && e.stopPropagation()}>Read the whole lesson as text</summary>
      {lesson.steps.map((step, i) => (
        <section key={String(i)}>
          <h2>{i + 1}. {sentence(step.title)}</h2>
          <Prose text={step.body} />
          <ul>
            {step.events.map((e) => e.says && <li key={e.id}>{e.says}</li>)}
          </ul>
        </section>
      ))}
      {lesson.summary && (
        <section>
          <h2>Summary</h2>
          <Prose text={lesson.summary.body} />
        </section>
      )}
      <p>
        Next lesson: <Link to={lessonPath(next.id)}>{next.title}</Link>
      </p>
    </details>
  )
}

export function Details() {
  const lesson = useLesson()
  const step = useApp((s) => s.step)
  const finished = useApp((s) => s.finished)
  const goToStep = useApp((s) => s.goToStep)
  const togglePlay = useApp((s) => s.togglePlay)
  const current = step >= 0 && !finished ? lesson.steps[step] : undefined
  const storyRef = useRef<HTMLElement>(null)

  // a new lesson starts at its top, also from the "Next lesson" link at the bottom of the last one
  useEffect(() => {
    if (storyRef.current) storyRef.current.scrollTop = 0
  }, [lesson.id])

  return (
    <aside ref={storyRef} className="story" aria-label="Details">
      <div className="story-body" aria-live="polite">
        {finished ? (
          <Summary />
        ) : current ? (
          <div key={step} className="fade">
            <div className="kicker-row">
              <span className="kicker">Step {step + 1} of {lesson.steps.length}</span>
              <span className="dots" aria-hidden="true">
                {lesson.steps.map((_, i) => <i key={String(i)} data-on={i <= step || undefined} />)}
              </span>
              <Button className="link-btn" onClick={() => goToStep(-1)}>
                <Icon name="back" size={12} />
                Overview
              </Button>
            </div>
            <h1 className="display">{sentence(current.title)}</h1>
            <p className="sub">{current.subtitle}</p>
            <Prose text={current.body} />
            <Facts facts={current.facts} />
          </div>
        ) : (
          <>
            <div className="kicker">{CATEGORY_NAME[lesson.category]}</div>
            <h1 className="display">{lesson.title}</h1>
            <p className="sub">{lesson.subtitle}</p>
            <Prose text={lesson.overview.body} />
            <Facts facts={lesson.overview.facts} />
            <Button className="btn primary start" onClick={togglePlay}>
              <Icon name="play" size={12} />
              Play {lesson.steps.length} steps
            </Button>
          </>
        )}
      </div>
      <Steps />
      {!finished && !current && <Transcript key={lesson.id} />}
    </aside>
  )
}
