import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { lessonById } from "./data/lessons"
import type { Lesson } from "./data/types"
import { usePlayback } from "./hooks"
import { eventReadTime, podsAt, resourcesAt, timeline } from "./playback"
import { useApp } from "./store"

const lesson = lessonById("deploy-an-app")!
const total = timeline(lesson).events.length

beforeEach(() => {
  useApp.setState({ pauseAfter: "step", speed: 1 })
  useApp.getState().openLesson("deploy-an-app")
})

test("picking a step shows all of its events and selects the last one", () => {
  useApp.getState().goToStep(4)
  const s = useApp.getState()
  expect(s.revealed).toBe(timeline(lesson).end[4])
  expect(s.selectedEvent).toBe("e13")
})

test("Play from the overview starts at step 1 with nothing on screen, giving time to read first", () => {
  useApp.getState().togglePlay()
  const s = useApp.getState()
  expect([s.mode, s.step, s.revealed, s.intro]).toEqual(["play", 0, 0, true])
})

test("next step past the end shows the summary, and back returns to the last step", () => {
  const { goToStep, nextStep, prevStep } = useApp.getState()
  goToStep(lesson.steps.length - 1)
  nextStep()
  expect(useApp.getState()).toMatchObject({ finished: true, revealed: total })
  prevStep()
  expect(useApp.getState()).toMatchObject({ finished: false, step: lesson.steps.length - 1 })
})

test("Pods appear on the nodes as the lesson goes", () => {
  expect(podsAt(lesson, -1)).toEqual({ node1: ["other"], node2: ["other"] })
  expect(podsAt(lesson, 4).node2).toContain("starting")
  expect(podsAt(lesson, 6).node2).toEqual(["other", "v1", "v1"])
})

test("an event's Pod changes apply when it lands, not when its step opens (rolling update)", () => {
  const rolling = lessonById("rolling-update")!
  const last = rolling.steps.length - 1
  const tl = timeline(rolling)
  // step 6 opens on the post-round-1 state, before rounds 2 and 3 are narrated
  expect(podsAt(rolling, last, tl.start[last])).toEqual({ node1: ["other", "v1", "v2"], node2: ["other", "v1"] })
  // round 2 lands: node-1's old Pod retires, node-2 surges a new one
  expect(podsAt(rolling, last, tl.start[last] + 1)).toEqual({ node1: ["other", "v2"], node2: ["other", "v1", "v2"] })
  // round 3 lands: node-2's last old Pod is replaced
  expect(podsAt(rolling, last, tl.start[last] + 2)).toEqual({ node1: ["other", "v2"], node2: ["other", "v2", "v2"] })
  // a step shown in full, or jumped to, still ends on the finished rollout
  expect(podsAt(rolling, last, tl.end[last])).toEqual({ node1: ["other", "v2"], node2: ["other", "v2", "v2"] })
  expect(podsAt(rolling, last)).toEqual({ node1: ["other", "v2"], node2: ["other", "v2", "v2"] })
})

test("resource cards appear as the events that create them land", () => {
  // the Service exists before the lesson starts; nothing else does
  expect(resourcesAt(lesson, -1)).toEqual({ "web-svc": { kind: "service", name: "Service web", sub: "endpoints: none" } })
  const tl = timeline(lesson)
  // e2 (the second event) creates the Deployment once it lands
  expect(resourcesAt(lesson, 0, 2)["web-deploy"]).toMatchObject({ kind: "deployment", state: "creating" })
  expect(resourcesAt(lesson, 0, 1)).not.toHaveProperty("web-deploy")
  // the ReplicaSet appears with CREATE REPLICASET (e9, the second event of step 4), not before
  expect(resourcesAt(lesson, 3, tl.start[3] + 1)).not.toHaveProperty("web-rs")
  expect(resourcesAt(lesson, 3, tl.start[3] + 2)["web-rs"]).toMatchObject({ kind: "replicaset", state: "creating" })
  // the Service's endpoints only grow once the last event of the lesson lands
  expect(resourcesAt(lesson, 6, tl.end[6] - 1)["web-svc"].sub).toBe("endpoints: none")
  expect(resourcesAt(lesson, 6)["web-svc"].sub).toBe("endpoints: 1 · 10.244.2.17")
})

test("a null patch removes a card, and step-opening patches apply before their events", () => {
  const base = lesson.steps[0]
  const e = base.events[0]
  const synthetic: Lesson = {
    ...lesson,
    steps: [
      { ...base, res: { cm: { kind: "configmap", name: "CM", sub: "v1" } }, events: [{ ...e, id: "x1", res: { cm: { kind: "configmap", name: "CM", sub: "v2" } } }] },
      { ...base, events: [{ ...e, id: "x2", res: { cm: null } }] },
    ],
  }
  expect(resourcesAt(synthetic, 0, 0).cm).toMatchObject({ sub: "v1" })
  expect(resourcesAt(synthetic, 0, 1).cm).toMatchObject({ sub: "v2" })
  expect(resourcesAt(synthetic, 1, 2)).not.toHaveProperty("cm")
  // a card's later absence doesn't leak backwards into earlier steps
  expect(resourcesAt(synthetic, 0, 1).cm).toMatchObject({ sub: "v2" })
})

function Driver() {
  usePlayback()
  return null
}

afterEach(() => vi.useRealTimers())

/** Each playback timer is only set after the previous one re-renders, so time has to pass in slices. */
function run(ms: number) {
  for (let t = 0; t < ms; t += 250) act(() => vi.advanceTimersByTime(250))
}

test("with Pause after: None, playback lands every event in order and ends on the summary", () => {
  vi.useFakeTimers()
  render(<Driver />)
  act(() => useApp.getState().setPauseAfter("none"))
  act(() => useApp.getState().togglePlay())
  const seen: string[] = []
  for (let i = 0; i < 2000 && !useApp.getState().finished; i++) {
    act(() => vi.advanceTimersByTime(250))
    const id = useApp.getState().selectedEvent
    if (id && seen.at(-1) !== id) seen.push(id)
  }
  expect(useApp.getState().finished).toBe(true)
  expect(seen).toEqual(timeline(lesson).events.map((e) => e.id))
})

test("by default, Play runs through a step by itself, then stops until Next step", () => {
  vi.useFakeTimers()
  render(<Driver />)
  act(() => useApp.getState().togglePlay())
  run(60_000)
  expect(useApp.getState()).toMatchObject({ mode: null, step: 0, revealed: timeline(lesson).end[0] })
  act(() => useApp.getState().togglePlay())
  run(1250)
  expect(useApp.getState()).toMatchObject({ mode: "play", step: 1 })
  run(60_000)
  expect(useApp.getState()).toMatchObject({ mode: null, step: 1, revealed: timeline(lesson).end[1] })
})

test("Pause after: Event waits for a click after every event", () => {
  vi.useFakeTimers()
  render(<Driver />)
  act(() => useApp.getState().setPauseAfter("event"))
  act(() => useApp.getState().togglePlay())
  run(20_000)
  expect(useApp.getState()).toMatchObject({ mode: null, step: 0, revealed: 1, selectedEvent: "e1" })
  act(() => useApp.getState().togglePlay())
  run(20_000)
  expect(useApp.getState()).toMatchObject({ mode: null, step: 0, revealed: 2, selectedEvent: "e2" })
})

test("nothing moves while the camera travels to a new step", () => {
  vi.useFakeTimers()
  render(<Driver />)
  act(() => useApp.getState().togglePlay())
  act(() => vi.advanceTimersByTime(500))
  expect(useApp.getState()).toMatchObject({ intro: true, flight: null, revealed: 0 })
})

test("after an event lands, playback waits longer for a longer caption", () => {
  vi.useFakeTimers()
  render(<Driver />)
  act(() => useApp.getState().goToStep(0))
  act(() => useApp.setState({ revealed: 0 }))
  act(() => useApp.getState().togglePlay())
  run(1150)
  const first = timeline(lesson).events[0]
  expect(useApp.getState()).toMatchObject({ revealed: 1, reading: true })
  run(eventReadTime(first) - 500)
  expect(useApp.getState()).toMatchObject({ reading: true, flight: null })
  // 0.4 s a word, but never under 1.5 s
  expect(eventReadTime({ ...first, says: "Pod ready." })).toBe(1500)
  expect(eventReadTime({ ...first, says: "The kubelet tells the API server it is running." })).toBe(3600)
  expect(eventReadTime({ ...first, says: "Short." })).toBeLessThan(eventReadTime({ ...first, says: "A much longer caption that takes a reader quite a few more seconds to get through properly." }))
  run(750)
  expect(useApp.getState().flight?.id).toBe("e2")
})

test("the › button cuts each pause short, and moves to the next step after the last one", () => {
  vi.useFakeTimers()
  render(<Driver />)
  act(() => useApp.getState().togglePlay())
  expect(useApp.getState().intro).toBe(true)
  act(() => useApp.getState().next())
  expect(useApp.getState().flight?.id).toBe("e1")
  run(1150)
  expect(useApp.getState().reading).toBe(true)
  act(() => useApp.getState().next())
  expect(useApp.getState().flight?.id).toBe("e2")
  run(1150)
  expect(useApp.getState()).toMatchObject({ step: 0, revealed: 2, reading: true })
  act(() => useApp.getState().next())
  expect(useApp.getState()).toMatchObject({ mode: null, step: 0 })
  act(() => useApp.getState().next())
  run(1250)
  expect(useApp.getState()).toMatchObject({ mode: "play", step: 1, intro: true })
})

test("Pause stops playback, and Next carries on from where it stopped", () => {
  vi.useFakeTimers()
  render(<Driver />)
  act(() => useApp.getState().togglePlay())
  act(() => useApp.getState().next())
  run(1150)
  act(() => useApp.getState().togglePlay())
  expect(useApp.getState().mode).toBe(null)
  act(() => useApp.getState().next())
  expect(useApp.getState().flight?.id).toBe("e2")
})

test("going from Scheduling into node-2, a marker carries playback in and the camera dives after it", () => {
  vi.useFakeTimers()
  render(<Driver />)
  act(() => useApp.getState().goToStep(4))
  act(() => useApp.getState().togglePlay())
  // the Binding stays on the control plane, so a marker first carries the next event (the watch push) out to node-2
  expect(useApp.getState().transit).toMatchObject({ from: "api", to: "node2", eventId: "e14", phase: "carry" })
  expect(useApp.getState().step).toBe(4)
  run(1150)
  expect(useApp.getState().transit).toMatchObject({ to: "node2", phase: "dive" })
  run(900)
  expect(useApp.getState()).toMatchObject({ step: 5, transit: null, intro: true })
  expect(lesson.steps[5].view).toBe("node2")
})

test("coming out of node-2, the inside shrinks away and the camera pulls back from node-2", () => {
  vi.useFakeTimers()
  render(<Driver />)
  act(() => useApp.getState().goToStep(5))
  act(() => useApp.getState().togglePlay())
  expect(useApp.getState().transit).toMatchObject({ to: "node2", phase: "surface" })
  expect(useApp.getState().step).toBe(5)
  run(750)
  expect(useApp.getState()).toMatchObject({ step: 6, transit: { to: "node2", phase: "emerge" } })
  expect(lesson.steps[6].view).toBe("cluster")
  run(250)
  expect(useApp.getState().transit).toBe(null)
})

test("coming out of a Pod straight to the cluster pulls back from the node it's on", () => {
  const request = lessonById("request-finds-pod")!
  act(() => useApp.getState().openLesson(request.id, 6))
  vi.useFakeTimers()
  render(<Driver />)
  expect([request.steps[6].view, request.steps[7].view]).toEqual(["pod", "cluster"])
  act(() => useApp.getState().togglePlay())
  expect(useApp.getState().transit).toMatchObject({ to: "node2", phase: "surface" })
})

test("a step that stays on the same level moves on without a dive", () => {
  vi.useFakeTimers()
  render(<Driver />)
  act(() => useApp.getState().goToStep(0))
  act(() => useApp.getState().togglePlay())
  expect(useApp.getState().transit).toBe(null)
})

test("the speed-up button cycles 1×, 2×, 4×", () => {
  const { speedUp } = useApp.getState()
  speedUp()
  expect(useApp.getState().speed).toBe(2)
  speedUp()
  expect(useApp.getState().speed).toBe(4)
  speedUp()
  expect(useApp.getState().speed).toBe(1)
})

test("Step animates exactly one event, then stops", () => {
  vi.useFakeTimers()
  render(<Driver />)
  act(() => useApp.getState().stepEvent())
  expect(useApp.getState().flight?.id).toBe("e1")
  act(() => vi.advanceTimersByTime(5000))
  expect(useApp.getState()).toMatchObject({ mode: null, revealed: 1, selectedEvent: "e1" })
})

test("speed changes how long each event takes", () => {
  vi.useFakeTimers()
  render(<Driver />)
  act(() => useApp.getState().setSpeed(4))
  act(() => useApp.getState().stepEvent())
  act(() => vi.advanceTimersByTime(1150 / 4 + 10))
  expect(useApp.getState().revealed).toBe(1)
})

test("Play from the overview of a lesson that starts inside node-2 dives in to it before step 1", () => {
  const pull = lessonById("image-pull")!
  expect(pull.steps[0].view).toBe("node2")
  act(() => useApp.getState().openLesson(pull.id))
  vi.useFakeTimers()
  render(<Driver />)
  act(() => useApp.getState().togglePlay())
  const first = timeline(pull).events[0].id
  expect(useApp.getState()).toMatchObject({ mode: "play", step: -1, transit: { from: "node2", to: "node2", eventId: first, phase: "carry" } })
  run(1150)
  expect(useApp.getState().transit).toMatchObject({ to: "node2", phase: "dive" })
  run(900)
  expect(useApp.getState()).toMatchObject({ step: 0, transit: null, intro: true })
})

test("Play from the overview of a lesson that starts inside a Pod dives through node-2, then the Pod", () => {
  const dns = lessonById("dns-in-cluster")!
  expect(dns.steps[0].view).toBe("pod")
  act(() => useApp.getState().openLesson(dns.id))
  vi.useFakeTimers()
  render(<Driver />)
  act(() => useApp.getState().togglePlay())
  expect(useApp.getState().transit).toMatchObject({ to: "node2", phase: "carry" })
  run(1150 + 900)
  const pod = useApp.getState().transit
  expect(pod).toMatchObject({ phase: "carry" })
  expect(pod?.to).not.toBe("node2")
  run(1150)
  expect(useApp.getState().transit).toMatchObject({ phase: "dive" })
  run(900)
  expect(useApp.getState()).toMatchObject({ step: 0, transit: null, intro: true })
})
