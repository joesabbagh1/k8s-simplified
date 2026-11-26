import { describe, expect, test } from "vitest"
import { createdBy, lanesOf, podsAt, timeline } from "../playback"
import { actorById, expand, floorFor, FLOORS, GROUPS, groundRoute } from "../scene/world"
import { surfaceAfter, transitionAfter } from "../scene/transition"
import { LESSONS, lessonById } from "./lessons"

const playable = LESSONS.filter((l) => l.steps.length)

test("lesson ids are unique", () => {
  const ids = LESSONS.map((l) => l.id)
  expect(new Set(ids).size).toBe(ids.length)
})

test("every lesson is written", () => {
  expect(LESSONS.map((l) => l.id)).toEqual([
    "deploy-an-app", "request-finds-pod", "rolling-update",
    "pod-to-pod-same-node", "pod-to-pod-across-nodes", "pod-calls-service",
    "dns-in-cluster", "ingress-gateway", "network-policy", "cilium-ebpf", "service-mesh-istio",
    "starting-a-container", "image-pull", "probes-restarts",
    "oom-killed", "mounting-volume", "gpu-device-plugin", "list-and-watch",
    "the-scheduler", "reconcile-loops", "node-goes-dark", "node-joins", "etcd-backup-restore",
    "graceful-shutdown", "autoscaling", "configmaps-secrets",
    "statefulset-storage", "jobs-cronjobs", "rbac-tokens", "kyverno-policies", "falco-alerts",
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
      // a node that has left the cluster has no layout
      for (const slots of Object.values(layout ?? {})) expect(slots?.length ?? 0).toBeLessThanOrEqual(4)
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

describe("the Kyverno lesson", () => {
  const lesson = lessonById("kyverno-policies")!

  test("dives into the API server and comes back out of it", () => {
    const changes = lesson.steps.flatMap((step, i) => {
      const next = lesson.steps[i + 1]
      return next && next.view !== step.view ? [{ i, into: next.view === "admission" }] : []
    })
    expect(changes.some((c) => c.into) && changes.some((c) => !c.into)).toBe(true)
    for (const { i, into } of changes) {
      expect((into ? transitionAfter : surfaceAfter)(lesson, i)?.to, `after step ${i + 1}`).toBe("api")
    }
  })

  test("every card is created by an event that lands on the API server", () => {
    const { events } = timeline(lesson)
    const born = events.flatMap((e) => createdBy(lesson, e).map((id) => [id, e.path?.[1]]))
    expect(Object.fromEntries(born)).toEqual({ "kyv-vpol": "api", "kyv-report": "api", "kyv-mpol": "api", "kyv-gpol": "api", "kyv-netpol": "api" })
  })
})

describe("the node-joins lesson", () => {
  const lesson = lessonById("node-joins")!

  test("node-3 is there from the moment its instance launches until it is terminated", () => {
    const launched = lesson.steps.findIndex((s) => s.events.some((e) => e.pods?.node3))
    expect(podsAt(lesson, -1).node3).toBeUndefined()
    expect(podsAt(lesson, launched - 1).node3).toBeUndefined()
    expect(podsAt(lesson, launched).node3).toBeDefined()
    expect(podsAt(lesson, lesson.steps.length - 1).node3).toBeUndefined()
  })

  test("the cluster floor grows to take node-3 in", () => {
    const two = new Set(expand(["cp", "node1", "node2"]))
    const three = new Set([...two, "node3"])
    expect(floorFor("cluster", two)).toEqual(FLOORS.cluster)
    const [, y] = actorById("node3")!.g
    expect(floorFor("cluster", three).y0).toBeLessThan(y - 8)
  })
})
