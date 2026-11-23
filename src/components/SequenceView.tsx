import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { LAYERS } from "../data/layers"
import { sentence } from "../data/text"
import { laneOf, lanesOf, timeline } from "../playback"
import { useApp, useLesson } from "../store"

const HEAD_H = 44
const ROW_H = 34
const STEP_H = 28
const GUTTER = 58

const clip = (text: string, px: number) => {
  const max = Math.max(8, Math.floor(px / 6.6))
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

type Row =
  | { kind: "step"; y: number; title: string; index: number }
  | { kind: "event"; y: number; index: number; id: string }

export default function SequenceView() {
  const lesson = useLesson()
  const revealed = useApp((s) => s.revealed)
  const flight = useApp((s) => s.flight)
  const selected = useApp((s) => s.selectedEvent)
  const selectEvent = useApp((s) => s.selectEvent)
  const scroller = useRef<HTMLDivElement>(null)

  const [available, setAvailable] = useState(800)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setAvailable(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { events } = timeline(lesson)
  const lanes = useMemo(() => lanesOf(lesson), [lesson])
  const LANE_W = Math.max(76, Math.min(170, (available - GUTTER - 16) / Math.max(lanes.length, 1)))
  const x = (lane: string) => GUTTER + lanes.indexOf(lane) * LANE_W + LANE_W / 2
  const width = GUTTER + lanes.length * LANE_W + 16

  const shownCount = flight ? revealed + 1 : revealed
  const rows: Row[] = []
  let y = 8
  let lastStep = -1
  for (const e of events.slice(0, shownCount)) {
    if (e.step !== lastStep) {
      rows.push({ kind: "step", y, title: lesson.steps[e.step].title, index: e.step })
      y += STEP_H
      lastStep = e.step
    }
    rows.push({ kind: "event", y, index: e.index, id: e.id })
    y += ROW_H
  }
  const height = Math.max(y + 16, 120)

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [shownCount])

  if (!lesson.steps.length) return <p className="placeholder">No events: this lesson isn't written yet.</p>

  return (
    <div className="sequence" ref={scroller}>
      <div className="seq-head" style={{ width, gridTemplateColumns: `${GUTTER}px repeat(${lanes.length}, ${LANE_W}px)`, height: HEAD_H }}>
        <span />
        {lanes.map((lane) => (
          <span key={lane} className="seq-lane" title={lane}>{lane}</span>
        ))}
      </div>
      {shownCount === 0 && <p className="seq-empty">Press Play or Step to start the sequence.</p>}
      <svg className="seq-body" width={width} height={height} role="img" aria-label={`Sequence diagram, ${revealed} events`}>
        <defs>
          <marker id="seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" />
          </marker>
        </defs>
        {lanes.map((lane) => (
          <line key={lane} className="lifeline" x1={x(lane)} x2={x(lane)} y1={0} y2={height} />
        ))}
        {rows.map((row) => {
          if (row.kind === "step") {
            return (
              <g key={`s${row.index}`} className="seq-step">
                <line x1={0} x2={width} y1={row.y + 4} y2={row.y + 4} />
                <text x={8} y={row.y + 19}>Step {row.index + 1} · {sentence(row.title)}</text>
              </g>
            )
          }
          const e = events[row.index]
          const pending = row.index >= revealed
          const x1 = x(laneOf(lesson, e.src))
          const x2 = x(laneOf(lesson, e.dst))
          const mid = row.y + ROW_H / 2 + 6
          const color = LAYERS[e.layer].color
          const self = x1 === x2
          const leftSide = self && x1 > width * 0.6
          const span = self ? (leftSide ? x1 - GUTTER - 16 : width - x1 - 40) : Math.max(Math.abs(x2 - x1) - 8, 200)
          const text = clip(e.info, span)
          const half = (text.length * 6.6) / 2
          const labelX = self ? (leftSide ? x1 - 32 : x1 + 32) : Math.min(Math.max((x1 + x2) / 2, GUTTER + half), width - 4 - half)
          return (
            <g
              key={e.id}
              className="seq-row"
              data-selected={e.id === selected || undefined}
              data-pending={pending || undefined}
              style={{ "--c": color } as CSSProperties}
              onClick={() => !pending && selectEvent(e.id)}
            >
              <rect className="seq-hit" x={0} y={row.y} width={width} height={ROW_H} />
              <text className="seq-time" x={8} y={mid + 4}>{(e.at / 1000).toFixed(3)}s</text>
              {self ? (
                <path className="seq-arrow" d={leftSide ? `M${x1} ${mid - 6} h-26 v12 h24` : `M${x1} ${mid - 6} h26 v12 h-24`} markerEnd="url(#seq-arrow)" />
              ) : (
                <line className="seq-arrow" x1={x1} x2={x2 + (x2 > x1 ? -3 : 3)} y1={mid} y2={mid} markerEnd="url(#seq-arrow)" />
              )}
              <text className="seq-label" x={labelX} y={self ? mid + 4 : mid - 6} textAnchor={self ? (leftSide ? "end" : "start") : "middle"}>
                {text}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
