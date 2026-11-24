import { describe, expect, test } from "vitest"
import { lanesOf, timeline } from "../playback"
import { actorById, expand, FLOORS, GROUPS, groundRoute } from "../scene/world"
import { LESSONS } from "./lessons"

const playable = LESSONS.filter((l) => l.steps.length)

test("lesson ids are unique", () => {
  const ids = LESSONS.map((l) => l.id)
  expect(new Set(ids).size).toBe(ids.length)
})

test("every lesson is written", () => {
  expect(LESSONS.map((l) => l.id)).toEqual([
    "deploy-an-app", "request-finds-pod", "rolling-update",
    "pod-to-pod-same-node", "pod-to-pod-across-nodes", "pod-calls-service",
    "dns-in-cluster", "ingress-gateway", "network-policy", "cilium-ebpf",
    "starting-a-container", "image-pull", "probes-restarts",
    "oom-killed", "mounting-volume", "list-and-watch",
    "the-scheduler", "reconcile-loops", "node-goes-dark",
    "graceful-shutdown", "autoscaling", "configmaps-secrets",
    "statefulset-storage", "jobs-cronjobs", "rbac-tokens",
  ])
  expect(playable).toHaveLength(LESSONS.length)
})

describe.each(playable.map((l) => [l.id, l] as const))("%s", (_, lesson) => {
  const { events } = timeline(lesson)
  const actors = expand(lesson.actors)

  test("has a title and description that fit a search result", () => {
    expect(lesson.seo.title.length).toBeLessThanOrEqual(48)
    expect(lesson.seo.description.length).toBeGreaterThanOrEqual(110)
    expect(lesson.seo.description.length).toBeLessThanOrEqual(160)
  })

  test("event ids are unique", () => {
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length)
  })

  test("event times never go backwards", () => {
    for (let i = 1; i < events.length; i++) {
      expect(events[i].at, `${events[i].id} happens before ${events[i - 1].id}`).toBeGreaterThanOrEqual(events[i - 1].at)
    }
  })

  test("every cluster actor exists", () => {
    for (const id of actors) expect(actorById(id)?.level, id).toBe("cluster")
  })

  test.each(lesson.steps.map((s, i) => [i + 1, s] as const))("step %i points at actors on its own level", (_, step) => {
    expect(step.events.length).toBeGreaterThan(0)
    expect(step.facts.length).toBeGreaterThan(0)
    for (const id of step.focus) {
      expect(actorById(id)?.level, `focus ${id}`).toBe(step.view)
      if (step.view === "cluster") expect(actors, `focus ${id}`).toContain(id)
    }
    for (const e of step.events) {
      expect(e.decoded.length, `${e.id} has nothing to decode`).toBeGreaterThan(0)
      for (const id of e.path ?? []) {
        expect(actorById(id)?.level, `${e.id} path ${id}`).toBe(step.view)
        if (step.view === "cluster") expect(actors, `${e.id} path ${id}`).toContain(id)
      }
    }
  })

  test("pod layouts fit on a node", () => {
    for (const layout of [lesson.pods, ...lesson.steps.map((s) => s.pods), ...events.map((e) => e.pods)]) {
      for (const slots of Object.values(layout ?? {})) expect(slots.length).toBeLessThanOrEqual(4)
    }
  })

  test("has a summary and timing", () => {
    expect(lesson.summary?.body).toBeTruthy()
    expect(lesson.timing?.length).toBeGreaterThan(0)
    for (const span of lesson.timing ?? []) expect(span.duration).toBeGreaterThan(0)
  })

  test("the sequence diagram has room for its lanes", () => {
    expect(lanesOf(lesson).length).toBeLessThanOrEqual(9)
  })
})

test("packets between the control plane and a card go through the API server", () => {
  const route = groundRoute("cluster", "kcm", "web-svc")
  expect(route[0]).toEqual(actorById("kcm")!.g)
  expect(route).toContainEqual(actorById("api")!.g)
  expect(route.at(-1)).toEqual(actorById("web-svc")!.g)
})

test("every group stands inside its level's floor, with its members on its plate", () => {
  for (const { level, floor, members } of GROUPS) {
    const outer = FLOORS[level]
    expect(floor.x0 > outer.x0 && floor.x1 < outer.x1 && floor.y0 > outer.y0 && floor.y1 < outer.y1).toBe(true)
    for (const id of members) {
      const [x, y] = actorById(id)!.g
      expect(x > floor.x0 && x < floor.x1 && y > floor.y0 && y < floor.y1, id).toBe(true)
    }
  }
})
