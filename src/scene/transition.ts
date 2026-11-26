import type { ActorId, Lesson, Level } from "../data/types"
import { packetTime, timeline } from "../playback"
import { actorById, ACTORS, levelPath, type Actor } from "./world"

export const DEPTH: Record<Level, number> = { cluster: 0, node1: 1, node2: 1, pod: 2, mesh: 1, ambient: 1, admission: 1, falco: 1, gpu: 1 }

/** The level an actor opens in this lesson, if any. */
export const opensIn = (lesson: Lesson, actor: Actor): Level | undefined => lesson.opens?.[actor.id] ?? actor.opens

/** The actor on one level that opens another. */
const portalTo = (lesson: Lesson, level: Level, inner: Level) => ACTORS.find((a) => a.level === level && opensIn(lesson, a) === inner)

export interface Transit {
  /** where the marker sets off, on the current level */
  from: ActorId
  /** the node or Pod it dives into */
  to: ActorId
  /** the next step's first event, whose colour and title the marker carries */
  eventId: string
  /** carry → dive goes into a node or Pod; surface → emerge comes back out */
  phase: "carry" | "dive" | "surface" | "emerge"
  key: number
}

/** When the next step zooms back out, the node or Pod (on the outer level) the camera pulls back from. */
export function surfaceAfter(lesson: Lesson, step: number): Omit<Transit, "phase" | "key"> | null {
  const current = lesson.steps[step]
  const next = lesson.steps[step + 1]
  if (!current || !next || DEPTH[next.view] >= DEPTH[current.view]) return null
  const path = levelPath(current.view)
  const child = path[path.indexOf(next.view) + 1]
  const portal = portalTo(lesson, next.view, child)
  if (!portal) return null
  const t = timeline(lesson)
  const first = t.events[t.end[step]]
  return first ? { from: portal.id, to: portal.id, eventId: first.id } : null
}

/** When the next step zooms into a node or Pod, the path a marker takes on the current level to get there. */
export function transitionAfter(lesson: Lesson, step: number): Omit<Transit, "phase" | "key"> | null {
  const current = lesson.steps[step]
  const next = lesson.steps[step + 1]
  if (!current || !next || DEPTH[next.view] <= DEPTH[current.view]) return null
  const portal = portalTo(lesson, current.view, next.view)
  if (!portal) return null
  const t = timeline(lesson)
  const first = t.events[t.end[step]]
  if (!first) return null
  const landed = current.events.at(-1)?.path?.[1]
  const from = landed && actorById(landed)?.level === current.view ? landed : portal.id
  return { from, to: portal.id, eventId: first.id }
}

/** When a lesson's first step is inside a node or Pod, the portals Play dives through from the overview to get there, outermost first. */
export function entryPath(lesson: Lesson): ActorId[] {
  const first = lesson.steps[0]
  if (!first || !timeline(lesson).events.length) return []
  const path = levelPath(first.view)
  const portals = path.slice(0, -1).map((level, i) => portalTo(lesson, level, path[i + 1])?.id)
  return portals.every((id): id is ActorId => !!id) ? portals : []
}

/** How long each phase takes, at 1× speed. */
export const CARRY_MS = 1150
/** How long the carry takes: a pulse on one node or Pod, or a trip at the packets' speed. */
export const carryTime = (from: ActorId, to: ActorId) => (from === to ? CARRY_MS : packetTime(from, to))
export const DIVE_MS = 900
export const SURFACE_MS = 650
/** one frame with the camera parked on the node, so the pull-back has somewhere to start from */
export const EMERGE_MS = 60
