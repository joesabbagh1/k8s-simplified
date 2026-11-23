import {
  Waterfall,
  WaterfallAxis,
  WaterfallBar,
  WaterfallCell,
  WaterfallColumnHeader,
  WaterfallHeaderRow,
  WaterfallRow,
  WaterfallRowHeader,
  WaterfallTick,
  type WaterfallData,
} from "@ui-sdk/react/waterfall"
import type { CSSProperties } from "react"
import { LAYERS } from "../data/layers"
import { useLesson } from "../store"

const took = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : ms >= 1 ? `${Math.round(ms)} ms` : `${(ms * 1000).toFixed(0)} µs`)

function niceEnd(ms: number) {
  for (const step of [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    if (ms / step <= 6) return Math.ceil(ms / step) * step
  }
  return Math.ceil(ms / 10000) * 10000
}

const axisLabel = (ms: number) => (ms === 0 ? "0" : ms >= 1000 ? `${ms / 1000} s` : `${ms} ms`)

export default function Timing() {
  const lesson = useLesson()
  const spans = lesson.timing ?? []
  if (!spans.length) return <p className="empty-row">No timing for this lesson yet.</p>

  const items: WaterfallData = spans.map((s) => ({ value: s.value, label: s.label, start: s.start, duration: s.duration }))
  const end = niceEnd(spans.reduce((m, s) => Math.max(m, s.start + s.duration), 0))
  const longest = spans.reduce((a, b) => (b.duration > a.duration ? b : a))

  return (
    <div className="timing">
      <p className="timing-note">
        Most of the time goes to <b>{longest.label.toLowerCase()}</b>: {took(longest.duration)}.
      </p>
      <Waterfall aria-label="Where the time goes" items={items} range={[0, end]} format={axisLabel} className="waterfall">
        <WaterfallHeaderRow className="wf-head">
          <WaterfallColumnHeader>SPAN</WaterfallColumnHeader>
          <WaterfallColumnHeader>TOOK</WaterfallColumnHeader>
          <WaterfallColumnHeader aria-label="Timeline">
            <WaterfallAxis maxTicks={6} className="wf-axis">
              {({ ticks }) =>
                ticks.map((tick) => (
                  <WaterfallTick key={tick.time} time={tick.time} className="wf-tick">
                    {tick.label}
                  </WaterfallTick>
                ))
              }
            </WaterfallAxis>
          </WaterfallColumnHeader>
        </WaterfallHeaderRow>
        {spans.map((s) => (
          <WaterfallRow key={s.value} value={s.value} className="wf-row" style={{ "--c": LAYERS[s.layer].color } as CSSProperties}>
            <WaterfallRowHeader className="wf-name">{s.label}</WaterfallRowHeader>
            <WaterfallCell className="wf-took">{took(s.duration)}</WaterfallCell>
            <WaterfallBar className="wf-bar" />
          </WaterfallRow>
        ))}
      </Waterfall>
    </div>
  )
}
