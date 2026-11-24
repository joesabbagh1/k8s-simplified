import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react"
import { LAYERS } from "../data/layers"
import type { Layer, PodSlot } from "../data/types"
import { useReducedMotion } from "../hooks"
import { box, faceTop, iso, type Point } from "../iso/iso"
import { actorById, CABLES as ALL_CABLES, FLOORS, groundRoute, GROUPS, JOINTS as ALL_JOINTS, type Actor, type Floor } from "../scene/world"

/* The home page scene: the same demo cluster the lessons play out on, drawn at the origin, with one
   packet replaying the first lesson hop by hop. Positions are ground coordinates: x runs to the
   lower right, y to the lower left. */

const S = 4.6
const P = (x: number, y: number, z = 0): Point => iso(x, y, z, S)
const pts = (a: Point[]) => a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")

/** Everyone in the scene, back to front. */
const CAST = ["kcm", "etcd", "sched", "api", "node2", "you", "node1", "lb", "visitor"]
/** Where the hero's label differs from the lessons': shorter, or in the way of something. */
const TAGS: Record<string, { sub?: string; label?: Actor["label"] }> = {
  node1: { sub: "10.0.1.11", label: [0, 62, "middle"] },
  node2: { sub: "10.0.1.12" },
  visitor: { label: [50, 22, "start"] },
}
const THINGS = CAST.map((id) => {
  const a = actorById(id)!
  return { id, at: a.g, name: a.name, sub: TAGS[id]?.sub ?? a.sub, label: TAGS[id]?.label ?? a.label, art: a.art }
})

const CABLES = ALL_CABLES.cluster.filter((c) => CAST.includes(c.a) && CAST.includes(c.b) && !(c.a === "node1" && c.b === "node2")).map((c) => c.route)
const JOINTS = ALL_JOINTS.cluster

type Hop = { layer: Layer; route: Point[]; who: string; what: string }

const hopRoute = (from: string, to: string) => groundRoute("cluster", from, to)

/** The first lesson, shortened to the hops you can see from this height. Strings come from the lessons. */
const HOPS: Hop[] = [
  { layer: "api", route: hopRoute("you", "api"), who: "kubectl → API server", what: "POST /apis/apps/v1/namespaces/default/deployments" },
  { layer: "state", route: hopRoute("api", "etcd"), who: "API server → etcd", what: "Txn put /registry/deployments/default/web" },
  { layer: "control", route: hopRoute("sched", "api"), who: "Scheduler → API server", what: "POST /api/v1/namespaces/default/pods/web-6f7c9d8b4-x2kqp/binding" },
  { layer: "control", route: hopRoute("api", "node2"), who: "API server → kubelet on node-2", what: "WATCH MODIFIED Pod web-6f7c9d8b4-x2kqp" },
  { layer: "node", route: [], who: "containerd on node-2", what: "StartContainer web · 10.244.2.17" },
  { layer: "net", route: hopRoute("visitor", "lb"), who: "Visitor → load balancer", what: "SYN 198.51.100.7 → 203.0.113.50:80" },
  { layer: "net", route: hopRoute("lb", "node2"), who: "Load balancer → node-2", what: "SYN 198.51.100.7 → 10.0.1.12:30080" },
]

const HOP_MS = 2200
const TRAVEL_MS = 1100
const REST_MS = 1800
const LOOP_MS = HOPS.length * HOP_MS + REST_MS
const STARTS = HOPS.findIndex((h) => h.layer === "node")

/** node-2's second Pod slot over the loop: absent until the kubelet hears about it, then starting, then running. */
function node2Slots(hop: number): PodSlot[] {
  if (hop < STARTS - 1) return ["v1"]
  if (hop === STARTS - 1) return ["v1", "starting"]
  return ["v1", "v1"]
}

function slots(id: string, hop: number): PodSlot[] | undefined {
  if (id === "node1") return ["v1", "other"]
  return id === "node2" ? node2Slots(hop) : undefined
}

function plate({ x0, x1, y0, y1, text, at }: Floor, cls = "") {
  let lines = ""
  for (let x = x0 + 4; x < x1; x += 4) {
    const [a, b] = [P(x, y0), P(x, y1)]
    lines += `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"/>`
  }
  for (let y = y0 + 4; y < y1; y += 4) {
    const [a, b] = [P(x0, y), P(x1, y)]
    lines += `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"/>`
  }
  const slab = box(x0, y0, -1.4, x1 - x0, y1 - y0, 1.4, S, "slab")
  const top = `<polygon class="floor-top" points="${pts([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)])}"/>`
  const name = `<g transform="${faceTop(...at, 0, S)}"><text class="floor-name" x="0" y="0" font-size="2.1">${text}</text></g>`
  return `<g class="floor ${cls}">${slab}${top}<g class="floor-grid">${lines}</g>${name}</g>`
}

const floor = () => [plate(FLOORS.cluster), ...GROUPS.map((g) => plate(g.floor, "plate"))].join("")

const pathOf = (route: Point[]) => route.map(([x, y], i) => `${i ? "L" : "M"}${P(x, y).map((v) => v.toFixed(1)).join(" ")}`).join(" ")

/** A point a fraction t along a polyline of screen points. */
function along(points: Point[], t: number): Point {
  const segs = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]))
  let d = t * segs.reduce((a, b) => a + b, 0)
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i] || i === segs.length - 1) {
      const k = segs[i] ? Math.min(1, d / segs[i]) : 0
      const [a, b] = [points[i], points[i + 1]]
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
    }
    d -= segs[i]
  }
  return points[points.length - 1]
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

function usePlayback(enabled: boolean, ref: React.RefObject<SVGSVGElement | null>) {
  const [hop, setHop] = useState(enabled ? 0 : HOPS.length - 1)
  const packet = useRef<SVGCircleElement>(null)

  useEffect(() => {
    if (!enabled) return
    const svg = ref.current
    let visible = true
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([e]) => (visible = e.isIntersecting))
    if (svg) io?.observe(svg)
    let raf = 0
    let last = performance.now()
    let t = 0
    let shown = 0
    const tick = (now: number) => {
      if (visible) t = (t + Math.min(now - last, 64)) % LOOP_MS
      last = now
      const i = Math.min(HOPS.length - 1, Math.floor(t / HOP_MS))
      const resting = t >= HOPS.length * HOP_MS
      const next = resting ? -1 : i
      if (next !== shown) setHop((shown = next))
      const c = packet.current
      const route = next >= 0 ? HOPS[next].route : []
      const k = (t - i * HOP_MS) / TRAVEL_MS
      if (c) {
        if (route.length && k <= 1) {
          const [x, y] = along(route.map(([gx, gy]) => P(gx, gy)), ease(Math.max(0, k)))
          c.setAttribute("cx", x.toFixed(1))
          c.setAttribute("cy", y.toFixed(1))
          c.style.opacity = "1"
        } else c.style.opacity = "0"
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      io?.disconnect()
    }
  }, [enabled, ref])

  return { hop, packet }
}

export function HeroScene() {
  const reduced = useReducedMotion()
  const svg = useRef<SVGSVGElement>(null)
  const { hop, packet } = usePlayback(!reduced, svg)
  const current = hop >= 0 ? HOPS[hop] : null
  const ground = useMemo(() => floor(), [])
  const cables = useMemo(() => CABLES.map(pathOf).join(" "), [])
  const color = current ? LAYERS[current.layer].color : undefined

  return (
    <figure className="hero-figure">
      <svg ref={svg} className="iso hero-art" viewBox="-320 -200 760 520" aria-hidden="true">
        <g dangerouslySetInnerHTML={{ __html: ground }} />
        <path className="cable" d={cables} />
        {JOINTS.map(([x, y]) => {
          const [cx, cy] = P(x, y)
          return <circle key={`${x}-${y}`} className="joint" cx={cx} cy={cy} r="2.2" />
        })}
        {current && !reduced && current.route.length > 0 && (
          <path key={hop} className="cable-on" d={pathOf(current.route)} style={{ stroke: color }} />
        )}
        {!reduced && <circle ref={packet} className="hero-packet" r="4.5" style={{ fill: color, opacity: 0 }} />}
        {THINGS.map((t) => {
          const [x, y] = P(...t.at)
          const live = current?.layer === "node" && t.id === "node2"
          return (
            <g key={t.id} className="thing" data-live={live || undefined}>
              <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} dangerouslySetInnerHTML={{ __html: t.art(slots(t.id, hop < 0 ? HOPS.length - 1 : hop)) }} />
              <text className="tag" x={x + t.label[0]} y={y + t.label[1]} textAnchor={t.label[2]}>
                <tspan className="tag-n">{t.name}</tspan>
                <tspan className="tag-s" x={x + t.label[0]} dy="15">{t.sub}</tspan>
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption className="scene-cap" aria-hidden="true">
        {reduced || !current ? (
          <span className="cap-who">The demo cluster every lesson runs on</span>
        ) : (
          <span key={hop} className="cap-line" style={{ "--c": color } as CSSProperties}>
            <span className="cap-n">{String(hop + 1).padStart(2, "0")}/{String(HOPS.length).padStart(2, "0")}</span>
            <span className="cap-who">{current.who}</span>
            <code className="cap-what">{current.what}</code>
          </span>
        )}
      </figcaption>
    </figure>
  )
}
