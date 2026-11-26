import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@ui-sdk/react/collapsible"
import { Listbox, ListboxItem } from "@ui-sdk/react/listbox"
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control"
import { lazy, Suspense, useEffect, useRef, type CSSProperties } from "react"
import { LAYERS, layerStyle, LEGEND } from "../data/layers"
import { timeline } from "../playback"
import { useApp, useLesson, type FlowTab } from "../store"
import { Decoder } from "./Decoder"
import { Icon } from "./Icon"

const Timing = lazy(() => import("./Timing"))

function Events() {
  const lesson = useLesson()
  const revealed = useApp((s) => s.revealed)
  const step = useApp((s) => s.step)
  const selected = useApp((s) => s.selectedEvent)
  const selectEvent = useApp((s) => s.selectEvent)
  const scroller = useRef<HTMLDivElement>(null)

  const events = timeline(lesson).events.slice(0, revealed)
  const index = events.findIndex((e) => e.id === selected)

  // Scroll only the table: scrollIntoView would also scroll the page, which jumps on phones.
  useEffect(() => {
    const box = scroller.current
    const row = box?.querySelector('[data-slot="listbox-item"][data-selected]')
    if (!box || !row) return
    const r = row.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    const head = 34
    if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom
    else if (r.top < b.top + head) box.scrollTop -= b.top + head - r.top
  }, [selected])

  return (
    <div className="flowbody" data-decoder={index >= 0 || undefined}>
      <div className="tablewrap" ref={scroller}>
        <div className="erow ehead" aria-hidden="true">
          <span>No.</span><span>From → to</span><span>Info</span><span>Size</span>
        </div>
        {events.length === 0 ? (
          <p className="empty-row">
            {step < 0 ? "Nothing on the wire yet. Press Play, or pick a step." : "Waiting for the first event…"}
          </p>
        ) : (
          <Listbox aria-label="Events" className="elist" value={selected} onValueChange={(v) => selectEvent(typeof v === "string" ? v : null)}>
            {events.map((e, i) => (
              <ListboxItem key={e.id} value={e.id} className="erow" label={`${i + 1} ${e.info}`} data-step-start={i > 0 && e.step !== events[i - 1].step ? "" : undefined}>
                <span><span className="badge" style={layerStyle(e)} title={LAYERS[e.layer].label}>{i + 1}</span></span>
                <span className="clip" title={`${e.src} → ${e.dst}`}>{e.src === e.dst ? e.src : `${e.src} → ${e.dst}`}</span>
                <span className="clip" title={e.info}>{e.info}</span>
                <span className="size">{e.size}</span>
              </ListboxItem>
            ))}
          </Listbox>
        )}
      </div>
      {index >= 0 && <Decoder event={events[index]} index={index} />}
    </div>
  )
}

function Progress() {
  const lesson = useLesson()
  const revealed = useApp((s) => s.revealed)
  const total = timeline(lesson).events.length
  return (
    <>
      <span className="count">{revealed} / {total}</span>
      <span className="progress" aria-hidden="true"><i style={{ width: `${total ? (revealed / total) * 100 : 0}%` }} /></span>
    </>
  )
}

/** The event table, decoder and timing, in a drawer under the diagram: closed until the reader asks for it. */
export function EventFlow() {
  const tab = useApp((s) => s.flowTab)
  const setTab = useApp((s) => s.setFlowTab)
  const open = useApp((s) => s.flowOpen)
  const setOpen = useApp((s) => s.setFlowOpen)

  return (
    <section className="flow" aria-label="Event flow">
      <Collapsible open={open} onOpenChange={setOpen} className="flow-collapsible">
        <div className="flow-bar">
          <CollapsibleTrigger className="flow-toggle" title="Show or hide the events (E)">
            <Icon name="right" size={14} className="flow-chevron" />
            Events
            <Progress />
          </CollapsibleTrigger>
          {open && (
            <SegmentedControl aria-label="Event flow view" className="seg sm" value={tab} onValueChange={(v) => v && setTab(v as FlowTab)}>
              <SegmentedControlIndicator className="seg-indicator" />
              <SegmentedControlItem value="events">Events</SegmentedControlItem>
              <SegmentedControlItem value="timing">Timing</SegmentedControlItem>
            </SegmentedControl>
          )}
          {open && (
            <div className="legend" aria-label="Layer colors">
              {LEGEND.map((l) => (
                <span key={l} style={{ "--c": LAYERS[l].color } as CSSProperties}>
                  <i aria-hidden="true" />
                  {LAYERS[l].label.toLowerCase()}
                </span>
              ))}
            </div>
          )}
        </div>
        <CollapsiblePanel className="flow-panel">
          {tab === "events" ? (
            <Events />
          ) : (
            <Suspense fallback={null}>
              <Timing />
            </Suspense>
          )}
        </CollapsiblePanel>
      </Collapsible>
    </section>
  )
}
