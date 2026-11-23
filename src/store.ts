import { create } from "zustand"
import { LESSONS, lessonById } from "./data/lessons"
import type { Category, Lesson, Level } from "./data/types"
import { revealedThrough, timeline } from "./playback"
import { LIBRARY_ROUTE, readLocation } from "./route"
import { entryPath, type Transit } from "./scene/transition"

export type Theme = "dark" | "light"
export type StageView = "cluster" | "sequence"
export type FlowTab = "events" | "timing"
export type Page = "home" | "lesson" | "library"
export type LibraryFilter = Category | "all"
/** "play" runs until the next pause; "event" animates a single event, then stops */
export type Mode = "play" | "event" | null
/** where Play stops on its own: after every event, after every step, or only at the end */
export type PauseAfter = "event" | "step" | "none"

const readTheme = (): Theme =>
  typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark"

export interface Flight {
  id: string
  duration: number
  /** changes on every launch, so the same event can animate again after a replay */
  key: number
}

interface AppState {
  page: Page
  /** the lessons page's search and category, kept while the reader is off in a lesson */
  libraryQuery: string
  libraryFilter: LibraryFilter
  lessonId: string
  /** -1 shows the lesson overview */
  step: number
  /** how many of the lesson's events are on screen */
  revealed: number
  finished: boolean
  mode: Mode
  flight: Flight | null
  /** true while the camera moves to a new step and the reader takes it in, before its first event */
  intro: boolean
  /** true while the reader takes in the event that just landed */
  reading: boolean
  /** the reader asked to go on to the next step; the driver does it, with a zoom if the view goes deeper */
  advancing: boolean
  /** a marker carrying playback into a node or Pod, between two steps */
  transit: Transit | null
  pauseAfter: PauseAfter
  speed: number
  selectedEvent: string | null
  /** a level the reader opened by clicking the diagram; cleared when the step changes */
  viewOverride: Level | null
  stageView: StageView
  flowTab: FlowTab
  theme: Theme
  /** the event table and decoder, in a drawer under the diagram */
  flowOpen: boolean
  diagramOnly: boolean

  openLesson: (id: string, step?: number) => void
  showHome: () => void
  showLibrary: () => void
  setLibraryQuery: (query: string) => void
  setLibraryFilter: (filter: LibraryFilter) => void
  goToStep: (step: number) => void
  nextStep: () => void
  prevStep: () => void
  stepEvent: () => void
  togglePlay: () => void
  restart: () => void
  showSummary: () => void
  /** playback driver only */
  launch: (flight: Flight | null) => void
  land: () => void
  advanceStep: () => void
  endIntro: () => void
  endReading: () => void
  stop: () => void
  setTransit: (transit: Omit<Transit, "key"> | null) => void
  /** the caption's Next button: cut a reading pause short, or carry on when paused */
  next: () => void

  setPauseAfter: (pause: PauseAfter) => void
  setSpeed: (speed: number) => void
  speedUp: () => void
  selectEvent: (id: string | null) => void
  drill: (level: Level | null) => void
  setStageView: (view: StageView) => void
  setFlowTab: (tab: FlowTab) => void
  setTheme: (theme: Theme) => void
  setFlowOpen: (open: boolean) => void
  toggleFlow: () => void
  toggleDiagramOnly: () => void
}

const lastId = (lesson: Lesson, revealed: number) => (revealed > 0 ? timeline(lesson).events[revealed - 1].id : null)

const shown = (lesson: Lesson, step: number) => {
  const revealed = revealedThrough(lesson, step)
  return { step, revealed, selectedEvent: lastId(lesson, revealed), finished: false, mode: null, flight: null, intro: false, reading: false, advancing: false, transit: null, viewOverride: null }
}

export const currentLesson = (s: Pick<AppState, "lessonId">) => lessonById(s.lessonId) ?? LESSONS[0]

let flightKey = 0

export const SPEEDS = [1, 2, 4]

/** Reads /lesson-id/step from the address bar, so a shared link opens straight on that step. */
function fromLocation(): Partial<AppState> {
  if (typeof window === "undefined") return {}
  const [id, part] = readLocation()
  if (id === LIBRARY_ROUTE) return { page: "library" }
  const lesson = id ? lessonById(id) : undefined
  if (!lesson) return {}
  if (part === "summary" && lesson.steps.length) {
    const all = timeline(lesson).events.length
    return { page: "lesson", lessonId: id, step: lesson.steps.length - 1, revealed: all, selectedEvent: lastId(lesson, all), finished: true }
  }
  const step = part ? Number(part) - 1 : -1
  if (Number.isNaN(step)) return { page: "lesson", lessonId: id }
  return { page: "lesson", lessonId: id, ...shown(lesson, Math.max(-1, Math.min(step, lesson.steps.length - 1))) }
}

export const useApp = create<AppState>((set, get) => ({
  page: "home",
  libraryQuery: "",
  libraryFilter: "all",
  lessonId: LESSONS[0].id,
  step: -1,
  revealed: 0,
  finished: false,
  mode: null,
  flight: null,
  intro: false,
  reading: false,
  advancing: false,
  transit: null,
  pauseAfter: "none",
  speed: 1,
  selectedEvent: null,
  viewOverride: null,
  stageView: "cluster",
  flowTab: "events",
  theme: readTheme(),
  flowOpen: false,
  diagramOnly: false,

  openLesson: (id, step = -1) => {
    const lesson = lessonById(id)
    if (!lesson) return
    set({ page: "lesson", lessonId: id, ...shown(lesson, Math.min(step, lesson.steps.length - 1)) })
  },

  showHome: () => set({ page: "home", mode: null, flight: null, intro: false, reading: false, advancing: false, transit: null }),
  showLibrary: () => set({ page: "library", mode: null, flight: null, intro: false, reading: false, advancing: false, transit: null }),
  setLibraryQuery: (libraryQuery) => set({ libraryQuery }),
  setLibraryFilter: (libraryFilter) => set({ libraryFilter }),

  goToStep: (step) => {
    const lesson = currentLesson(get())
    set(shown(lesson, Math.max(-1, Math.min(step, lesson.steps.length - 1))))
  },

  nextStep: () => {
    const { step } = get()
    const lesson = currentLesson(get())
    if (step >= lesson.steps.length - 1) get().showSummary()
    else get().goToStep(step + 1)
  },

  prevStep: () => {
    const { step, finished } = get()
    if (finished) get().goToStep(step)
    else get().goToStep(step - 1)
  },

  stepEvent: () => {
    const lesson = currentLesson(get())
    if (!lesson.steps.length) return
    const { step, revealed, finished } = get()
    if (finished) return
    if (step < 0) set({ step: 0, revealed: 0, viewOverride: null })
    else if (revealed >= timeline(lesson).end[step] && step >= lesson.steps.length - 1) {
      get().showSummary()
      return
    }
    set({ mode: "event", intro: false, reading: false })
  },

  togglePlay: () => {
    const lesson = currentLesson(get())
    if (!lesson.steps.length) return
    const { mode, finished, step, revealed } = get()
    if (mode) {
      set({ mode: null, flight: null, intro: false, reading: false, advancing: false, transit: null })
      return
    }
    const end = timeline(lesson).end
    const last = lesson.steps.length - 1
    if (finished || step < 0) {
      // a first step inside a node or Pod waits on the overview while the driver dives in to it
      const fresh = { revealed: 0, selectedEvent: null, finished: false, viewOverride: null, mode: "play" as const, transit: null }
      if (entryPath(lesson).length) set({ ...fresh, step: -1, intro: false })
      else set({ ...fresh, step: 0, intro: true })
    } else if (revealed >= end[step] && step < last) {
      set({ mode: "play", advancing: true, viewOverride: null })
    } else if (revealed >= end[step]) {
      get().showSummary()
    } else {
      set({ mode: "play" })
    }
  },

  restart: () => set({ step: -1, revealed: 0, selectedEvent: null, finished: false, mode: null, flight: null, intro: false, reading: false, advancing: false, transit: null, viewOverride: null }),

  showSummary: () => {
    const lesson = currentLesson(get())
    if (!lesson.steps.length) return
    const all = timeline(lesson).events.length
    set({ step: lesson.steps.length - 1, revealed: all, selectedEvent: lastId(lesson, all), finished: true, mode: null, flight: null, intro: false, reading: false, advancing: false, transit: null, viewOverride: null })
  },

  launch: (flight) => set({ flight: flight && { ...flight, key: ++flightKey }, reading: false }),

  land: () => {
    const lesson = currentLesson(get())
    const revealed = get().revealed + 1
    const { mode, pauseAfter } = get()
    const pause = mode === "event" || (mode === "play" && pauseAfter === "event")
    set({ revealed, selectedEvent: lastId(lesson, revealed), flight: null, ...(pause ? { mode: null } : { reading: mode === "play" }) })
  },

  advanceStep: () => {
    const lesson = currentLesson(get())
    const { step, mode } = get()
    if (step >= lesson.steps.length - 1) set({ finished: true, mode: null, flight: null, intro: false, reading: false, advancing: false, transit: null })
    else set({ step: step + 1, viewOverride: null, intro: mode === "play", advancing: false, transit: null })
  },

  endIntro: () => set({ intro: false }),
  endReading: () => set({ reading: false }),
  stop: () => set({ mode: null, flight: null, intro: false, reading: false, advancing: false, transit: null }),
  setTransit: (transit) => set({ transit: transit && { ...transit, key: ++flightKey } }),
  next: () => {
    const { mode, intro, reading, flight, finished } = get()
    if (finished || flight) return
    if (mode && intro) set({ intro: false })
    else if (mode && reading) set({ reading: false })
    else if (!mode) get().togglePlay()
  },

  setPauseAfter: (pauseAfter) => set({ pauseAfter }),
  setSpeed: (speed) => set({ speed }),
  speedUp: () => set((s) => ({ speed: SPEEDS[(SPEEDS.indexOf(s.speed) + 1) % SPEEDS.length] ?? 1 })),
  selectEvent: (selectedEvent) => set({ selectedEvent }),
  drill: (viewOverride) => set({ viewOverride }),
  setStageView: (stageView) => set({ stageView }),
  setFlowTab: (flowTab) => set({ flowTab }),
  setTheme: (theme) => {
    document.documentElement.dataset.theme = theme
    // keep the browser chrome (address bar on phones) in step with the page
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f3f6fc" : "#080d1b")
    try {
      localStorage.setItem("k8s-theme", theme)
    } catch {
      // storage can be blocked; the theme still applies for this visit
    }
    set({ theme })
  },
  setFlowOpen: (flowOpen) => set({ flowOpen }),
  toggleFlow: () => set((s) => ({ flowOpen: !s.flowOpen })),
  toggleDiagramOnly: () => set((s) => ({ diagramOnly: !s.diagramOnly })),
  ...fromLocation(),
}))

export const useLesson = () => useApp(currentLesson)
