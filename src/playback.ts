import type { ClusterEvent, Lesson, PodLayout, Resource, Step } from "./data/types"

export interface Timeline {
  events: (ClusterEvent & { step: number; index: number })[]
  /** index of each step's first event */
  start: number[]
  /** index after each step's last event */
  end: number[]
}

const cache = new WeakMap<Lesson, Timeline>()

export function timeline(lesson: Lesson): Timeline {
  const hit = cache.get(lesson)
  if (hit) return hit
  const events: Timeline["events"] = []
  const start: number[] = []
  const end: number[] = []
  lesson.steps.forEach((step, s) => {
    start.push(events.length)
    for (const e of step.events) events.push({ ...e, step: s, index: events.length })
    end.push(events.length)
  })
  const t = { events, start, end }
  cache.set(lesson, t)
  return t
}

/** How many events are on screen once a step is shown in full. */
export const revealedThrough = (lesson: Lesson, step: number) => (step < 0 ? 0 : timeline(lesson).end[step] ?? 0)

/** How long the marker for one event travels, at 1× speed. */
export function travelTime(e: ClusterEvent) {
  if (!e.path) return 450
  return e.path[0] === e.path[1] ? 750 : 1150
}

const clamp = (ms: number, min: number, max: number) => Math.min(max, Math.max(min, ms))

/** Comfortable reading speed for short technical sentences, in words per minute. */
const WPM = 220
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length
const readingTime = (text: string) => (words(text) / WPM) * 60_000

/** How long each word of a caption holds playback. */
const CAPTION_PER_WORD_MS = 400
/** No caption rests less than this, however short it is. */
const CAPTION_MIN_MS = 1500

/** How long playback rests after an event lands, so its caption can be read, at 1× speed: 0.4 s a word, at least 1.5 s. */
export const eventReadTime = (e: ClusterEvent) => Math.max(CAPTION_MIN_MS, words(e.says ?? e.title) * CAPTION_PER_WORD_MS)

/** How long playback rests at the start of a step, for a quick read of its text, at 1× speed. */
export const stepReadTime = (step: Step) => clamp(readingTime(`${step.title} ${step.subtitle} ${step.body}`) * 0.4, 2000, 6000)

/** The pause between steps, while the camera moves. */
export const STEP_GAP = 1000

/** Pods on each node: the starting layout with every step's snapshots and every landed event's changes applied in order. */
export function podsAt(lesson: Lesson, step: number, revealed = Infinity): PodLayout {
  const layout: PodLayout = { ...lesson.pods }
  const { events, start, end } = timeline(lesson)
  for (let s = 0; s <= step && s < lesson.steps.length; s++) {
    Object.assign(layout, lesson.steps[s].pods)
    // a past step is over, so all its events count; the current step's events count once landed
    const through = s < step ? end[s] : Math.min(revealed, end[s])
    for (let i = start[s]; i < through; i++) Object.assign(layout, events[i].pods)
  }
  return layout
}

const applyRes = (into: Record<string, Resource>, patch?: Record<string, Resource | null>) => {
  if (!patch) return
  for (const [id, res] of Object.entries(patch)) {
    if (res) into[id] = res
    else delete into[id]
  }
}

/** Resource cards on screen: lesson start, step snapshots and landed event patches, applied in order. */
export function resourcesAt(lesson: Lesson, step: number, revealed = Infinity): Record<string, Resource> {
  const cards: Record<string, Resource> = {}
  const { events, start, end } = timeline(lesson)
  applyRes(cards, lesson.res)
  for (let s = 0; s <= step && s < lesson.steps.length; s++) {
    applyRes(cards, lesson.steps[s].res)
    // a past step is over, so all its events count; the current step's events count once landed
    const through = s < step ? end[s] : Math.min(revealed, end[s])
    for (let i = start[s]; i < through; i++) applyRes(cards, events[i].res)
  }
  return cards
}

export interface LessonStats {
  events: number
  apiCalls: number
  watchEvents: number
  packets: number
  duration: number
}

export function stats(lesson: Lesson): LessonStats {
  const { events } = timeline(lesson)
  return {
    events: events.length,
    apiCalls: events.filter((e) => e.layer === "api").length,
    watchEvents: events.filter((e) => e.layer === "control").length,
    packets: events.filter((e) => e.layer === "net").length,
    duration: events.at(-1)?.at ?? 0,
  }
}

const ALIAS: Record<string, string> = {
  "kube-apiserver": "API server",
  "kube-scheduler": "scheduler",
  "deployment ctrl": "controllers",
  "replicaset ctrl": "controllers",
  "endpointslice ctrl": "controllers",
}

export const laneOf = (lesson: Lesson, name: string) => lesson.lanes?.[name] ?? ALIAS[name] ?? name

/** Every sequence-diagram lane the lesson uses, in the order they first appear. */
export function lanesOf(lesson: Lesson) {
  const lanes: string[] = []
  for (const e of timeline(lesson).events) {
    for (const name of [e.src, e.dst]) {
      const lane = laneOf(lesson, name)
      if (!lanes.includes(lane)) lanes.push(lane)
    }
  }
  return lanes
}
