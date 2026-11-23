import { useShortcut } from "@ui-sdk/react/shortcuts"
import { useEffect, useState } from "react"
import { lessonById } from "./data/lessons"
import type { ActorId } from "./data/types"
import { eventReadTime, STEP_GAP, stepReadTime, timeline, travelTime } from "./playback"
import { CARRY_MS, DIVE_MS, EMERGE_MS, entryPath, SURFACE_MS, surfaceAfter, transitionAfter } from "./scene/transition"
import { hasLegacyHash, HOME_PATH, LIBRARY_PATH, LIBRARY_ROUTE, lessonPath, readLocation } from "./route"
import { currentLesson, useApp } from "./store"

/** Moves playback forward: launches each event's marker, lands it, then moves to the next step. */
export function usePlayback() {
  const mode = useApp((s) => s.mode)
  const step = useApp((s) => s.step)
  const revealed = useApp((s) => s.revealed)
  const speed = useApp((s) => s.speed)
  const intro = useApp((s) => s.intro)
  const reading = useApp((s) => s.reading)
  const advancing = useApp((s) => s.advancing)
  const transit = useApp((s) => s.transit)
  const pauseAfter = useApp((s) => s.pauseAfter)
  const lessonId = useApp((s) => s.lessonId)

  useEffect(() => {
    if (!mode) return
    const { launch, land, advanceStep, endIntro, endReading, stop, setTransit } = useApp.getState()
    const lesson = currentLesson({ lessonId })
    const t = timeline(lesson)
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(fn, ms / speed)
      return () => window.clearTimeout(id)
    }

    // Play from the overview into a first step inside a node or Pod: focus each node or Pod on the way, then dive into it.
    if (step < 0) {
      if (mode !== "play") return
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      const portals = reduced ? [] : entryPath(lesson)
      const hop = (to: ActorId) => setTransit({ from: to, to, eventId: t.events[0].id, phase: "carry" })
      if (!transit) {
        if (!portals.length) return later(advanceStep, 0)
        hop(portals[0])
        return
      }
      if (transit.phase === "carry") return later(() => setTransit({ ...transit, phase: "dive" }), CARRY_MS)
      if (transit.phase === "dive") {
        const next = portals[portals.indexOf(transit.to) + 1]
        return later(next ? () => hop(next) : advanceStep, DIVE_MS)
      }
      return
    }

    if (transit?.phase === "emerge") return later(() => setTransit(null), EMERGE_MS)
    if (intro && mode === "play") return later(endIntro, STEP_GAP + stepReadTime(lesson.steps[step]))
    if (reading && mode === "play" && revealed > 0) return later(endReading, eventReadTime(t.events[revealed - 1]))

    if (revealed < t.end[step]) {
      const event = t.events[revealed]
      const travel = travelTime(event)
      launch({ id: event.id, duration: travel / speed, key: 0 })
      return later(land, travel)
    }

    if (mode === "event") return later(advanceStep, 0)
    const last = step >= lesson.steps.length - 1
    if (!last && !advancing && pauseAfter !== "none") {
      stop()
      return
    }

    const reduced = last || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

    // Going deeper: carry a marker to the node or Pod, zoom onto it, then switch to the inside.
    const zoom = reduced ? null : transitionAfter(lesson, step)
    if (zoom && !transit) {
      setTransit({ ...zoom, phase: zoom.from === zoom.to ? "dive" : "carry" })
      return
    }
    if (transit?.phase === "carry") return later(() => setTransit({ ...transit, phase: "dive" }), CARRY_MS)
    if (transit?.phase === "dive") return later(advanceStep, DIVE_MS)

    // Coming back out: shrink the inside away, then open the outer level with the camera on the node and pull back.
    const rise = reduced ? null : surfaceAfter(lesson, step)
    if (rise && !transit) {
      setTransit({ ...rise, phase: "surface" })
      return
    }
    if (transit?.phase === "surface") {
      return later(() => {
        advanceStep()
        setTransit({ ...transit, phase: "emerge" })
      }, SURFACE_MS)
    }
    return later(advanceStep, STEP_GAP)
  }, [mode, step, revealed, speed, intro, reading, advancing, transit, pauseAfter, lessonId])
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen?.()
}

export function useKeyboard() {
  const s = useApp.getState
  const inLesson = { when: () => s().page === "lesson" }
  useShortcut("space", () => s().togglePlay(), { ...inLesson, description: "Play or pause" })
  useShortcut("arrowright", () => s().nextStep(), { ...inLesson, description: "Next step" })
  useShortcut("arrowleft", () => s().prevStep(), { ...inLesson, description: "Previous step" })
  useShortcut("n", () => s().next(), { ...inLesson, description: "Next" })
  useShortcut("]", () => s().speedUp(), { ...inLesson, description: "Speed up" })
  useShortcut("r", () => s().restart(), { ...inLesson, description: "Restart" })
  useShortcut("e", () => s().toggleFlow(), { ...inLesson, description: "Events drawer" })
  useShortcut("d", () => s().toggleDiagramOnly(), { ...inLesson, description: "Diagram only" })
  useShortcut("s", () => s().setStageView(s().stageView === "cluster" ? "sequence" : "cluster"), { ...inLesson, description: "Cluster or sequence" })
  useShortcut("f", toggleFullscreen, { description: "Fullscreen" })
}

export { toggleFullscreen }

type State = ReturnType<typeof useApp.getState>

const pathOf = (s: State) =>
  s.page === "home" ? HOME_PATH : s.page === "library" ? LIBRARY_PATH : lessonPath(s.lessonId, s.finished ? "summary" : s.step >= 0 ? s.step + 1 : undefined)

const SITE = "K8s Simplified"
const HOME_TITLE = `${SITE} · Every layer, from packet to pod`

/** The tab title for the page: the lesson, and where in it the reader stands. */
const titleOf = (s: State) => {
  if (s.page === "home") return HOME_TITLE
  if (s.page === "library") return `Lessons · ${SITE}`
  const lesson = currentLesson(s)
  const part = s.finished ? "Summary" : s.step < 0 ? null : `Step ${s.step + 1} of ${lesson.steps.length}`
  return part ? `${lesson.title} · ${part} · ${SITE}` : `${lesson.title} · ${SITE}`
}

/** Keeps the address bar in step with the page: /, /lessons, /deploy-an-app/5, or /deploy-an-app/summary. */
export function useRoute() {
  useEffect(() => {
    const apply = () => {
      const [id, part] = readLocation()
      if (!id) {
        if (useApp.getState().page !== "home") useApp.getState().showHome()
        return
      }
      if (id === LIBRARY_ROUTE) {
        if (useApp.getState().page !== "library") useApp.getState().showLibrary()
        return
      }
      const lesson = id ? lessonById(id) : undefined
      if (!lesson) return
      if (useApp.getState().page !== "lesson") useApp.setState({ page: "lesson" })
      const state = useApp.getState()
      if (part === "summary") {
        if (state.lessonId !== id) state.openLesson(id)
        useApp.getState().showSummary()
        return
      }
      const step = part ? Number(part) - 1 : -1
      if (Number.isNaN(step)) return
      if (state.lessonId !== id || state.step !== step) state.openLesson(id, step)
    }
    const write = (s: State) => {
      const path = pathOf(s)
      document.title = titleOf(s)
      // share previews follow the page the reader is on
      for (const el of document.querySelectorAll('meta[property="og:title"], meta[name="twitter:title"]')) el.setAttribute("content", document.title)
      if (window.location.pathname !== path || hasLegacyHash()) window.history.replaceState(null, "", path)
    }

    apply()
    write(useApp.getState())
    window.addEventListener("popstate", apply)
    const unsubscribe = useApp.subscribe((s, prev) => {
      if (s.page !== prev.page || s.lessonId !== prev.lessonId || s.step !== prev.step || s.finished !== prev.finished) write(s)
    })
    return () => {
      window.removeEventListener("popstate", apply)
      unsubscribe()
    }
  }, [])
}

export function useReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)"
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const on = () => setReduced(mq.matches)
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])
  return reduced
}
