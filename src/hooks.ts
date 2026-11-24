import { useShortcut } from "@ui-sdk/react/shortcuts"
import { useEffect, useState } from "react"
import type { ActorId } from "./data/types"
import { eventReadTime, STEP_GAP, stepReadTime, timeline, travelTime } from "./playback"
import { CARRY_MS, DIVE_MS, EMERGE_MS, entryPath, SURFACE_MS, surfaceAfter, transitionAfter } from "./scene/transition"
import { applyMeta, metaFor } from "./meta"
import { hasLegacyHash, pathOf, readLocation } from "./route"
import { currentLesson, routeOf, useApp } from "./store"

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

/** Keeps the address bar and the page's title and description in step with the page: /, /lessons, /deploy-an-app/5, or /deploy-an-app/summary. */
export function useRoute() {
  useEffect(() => {
    const apply = () => {
      const route = readLocation()
      const state = useApp.getState()
      if (route.page !== "lesson") {
        if (state.page === route.page) return
        if (route.page === "home") state.showHome()
        else if (route.page === "library") state.showLibrary()
        else state.showNotFound()
        return
      }
      const { lesson, step, finished } = route
      if (state.page !== "lesson") useApp.setState({ page: "lesson" })
      if (finished) {
        if (state.lessonId !== lesson.id) state.openLesson(lesson.id)
        useApp.getState().showSummary()
      } else if (state.lessonId !== lesson.id || state.step !== step || state.finished) {
        state.openLesson(lesson.id, step)
      }
    }
    const write = (s: ReturnType<typeof useApp.getState>) => {
      const route = routeOf(s)
      applyMeta(metaFor(route))
      const path = pathOf(route)
      if (path !== null && (window.location.pathname !== path || hasLegacyHash())) window.history.replaceState(null, "", path)
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
