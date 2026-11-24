import { Button } from "@ui-sdk/react/button"
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control"
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { LAYERS } from "../data/layers"
import type { ActorId, ClusterEvent, Lesson, Level, PodSlot, Resource } from "../data/types"
import type { Point } from "../iso/iso"
import { useReducedMotion } from "../hooks"
import { CREATE_MS, createdBy, podsAt, resourcesAt, timeline } from "../playback"
import { useExploreCamera } from "../scene/camera"
import { CARRY_MS, DEPTH } from "../scene/transition"
import { actorById, actorsAt, CABLES, expand, floorCorners, floorFor, floorMatrix, frame, groundRoute, GROUPS, JOINTS, LEVEL_NAME, levelPath, ownRoute, RESOURCE_LINKS, screenRoute, toScreen, workloadNodes, WORLD, type Actor, type Box, type Cable, type Floor as FloorShape, type Group } from "../scene/world"
import { useApp, useLesson, type Flight, type StageView } from "../store"
import { sentence } from "../data/text"
import { Icon } from "./Icon"
import { Transport } from "./Transport"

const SequenceView = lazy(() => import("./SequenceView"))


/** anything the reader can point at for a caption: an actor, or a group of them */
type Described = Pick<Actor, "id" | "name" | "about">

interface SceneState {
  level: Level
  visible: Actor[]
  focus: Set<ActorId>
  dim: boolean
  frameIds: ActorId[]
  /** the camera is diving into a node or Pod: zoom right in on it */
  dive: boolean
}

function useSceneState(lesson: Lesson): SceneState {
  const step = useApp((s) => s.step)
  const finished = useApp((s) => s.finished)
  const override = useApp((s) => s.viewOverride)
  const transit = useApp((s) => s.transit)

  return useMemo(() => {
    const current = step >= 0 && !finished ? lesson.steps[step] : undefined
    // Play from the overview dives through each node or Pod on the way to the first step, on the level that holds it
    const entering = step < 0 && !finished && !!transit
    const level: Level = override ?? current?.view ?? (entering ? actorById(transit.to)?.level : undefined) ?? "cluster"
    const all = actorsAt(level)
    const used = expand(lesson.actors)
    const visible = level === "cluster" && used.length ? all.filter((a) => used.includes(a.id)) : all
    const following = !override && (!!current || entering)
    if (following && transit && transit.phase !== "surface") {
      const ids = transit.phase === "carry" ? [transit.from, transit.to] : [transit.to]
      return { level, visible, focus: new Set(ids), dim: true, frameIds: ids, dive: transit.phase === "dive" || transit.phase === "emerge" }
    }
    const focus = new Set(current && following ? current.focus : [])
    return {
      level,
      visible,
      focus,
      dim: !!current && following,
      frameIds: current && following ? current.focus : visible.map((a) => a.id),
      dive: false,
    }
  }, [lesson, step, finished, override, transit])
}

const d = (pts: Point[]) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ")

/** A cable on the floor, routed along its axes. Lit while both of its ends are in focus. */
function CableLine({ level, cable, on }: { level: Level; cable: Cable; on: boolean }) {
  const path = useMemo(() => d(cable.route.map((p) => toScreen(level, p))), [level, cable])
  return <path className="cable" data-on={on || undefined} d={path} />
}

/** An ownership edge between a card and what it owns: a thin dashed L on the floor, arrow at the owned end. */
function OwnLink({ a, b, on, delay }: { a: Actor; b: Actor; on: boolean; delay: number }) {
  const pts = screenRoute(a.level, ownRoute(a, b), a, b)
  const [p, q] = [pts[pts.length - 2], pts[pts.length - 1]]
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
  const [ux, uy] = [(q[0] - p[0]) / len, (q[1] - p[1]) / len]
  const head = (ang: number) => [q[0] - 7 * (ux * Math.cos(ang) - uy * Math.sin(ang)), q[1] - 7 * (uy * Math.cos(ang) + ux * Math.sin(ang))]
  const [h1, h2] = [head(0.5), head(-0.5)]
  return (
    <g className="own" data-on={on || undefined} style={{ "--born": `${delay}ms` } as CSSProperties}>
      <path className="own-line" d={d(pts)} />
      <path d={`M${h1[0].toFixed(1)} ${h1[1].toFixed(1)} L${q[0].toFixed(1)} ${q[1].toFixed(1)} L${h2[0].toFixed(1)} ${h2[1].toFixed(1)}`} />
    </g>
  )
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

/** A point a fraction t of the way along a polyline. */
function along(pts: Point[], t: number): Point {
  const segs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]))
  let left = t * segs.reduce((a, b) => a + b, 0)
  for (let i = 0; i < segs.length; i++) {
    if (left <= segs[i] || i === segs.length - 1) {
      const k = segs[i] ? Math.min(1, left / segs[i]) : 0
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k]
    }
    left -= segs[i]
  }
  return pts[pts.length - 1]
}

/** The screen route an event's packet follows, or nothing when it stays on one actor. */
function useFlightRoute(event: ClusterEvent) {
  const [fromId, toId] = event.path ?? []
  return useMemo(() => {
    const from = fromId ? actorById(fromId) : undefined
    const to = toId ? actorById(toId) : undefined
    if (!from || !to || from.id === to.id) return { from, to, pts: [] as Point[] }
    return { from, to, pts: screenRoute(from.level, groundRoute(from.level, from.id, to.id), from, to) }
  }, [fromId, toId])
}

/** Runs t from 0 to 1 over the flight, eased, calling back every frame. */
function useProgress(key: string | number, duration: number, enabled: boolean, onFrame: (t: number) => void) {
  const reduced = useReducedMotion()
  const cb = useRef(onFrame)
  useLayoutEffect(() => {
    cb.current = onFrame
  })
  useEffect(() => {
    if (!enabled) return
    if (reduced) {
      cb.current(1)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      cb.current(ease(t))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    cb.current(0)
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [key, duration, enabled, reduced])
}

/** The cable an event travels, lighting up behind its packet. Drawn under the actors. */
function Trail({ flight, event }: { flight: Pick<Flight, "duration"> & { key: string | number }; event: ClusterEvent }) {
  const ref = useRef<SVGPathElement>(null)
  const { pts } = useFlightRoute(event)
  useProgress(flight.key, flight.duration, pts.length > 1, (t) => ref.current?.style.setProperty("stroke-dashoffset", String(1 - t)))
  if (pts.length < 2) return null
  return <path ref={ref} className="trail" d={d(pts)} pathLength={1} style={{ stroke: LAYERS[event.layer].color, strokeDashoffset: 1 }} />
}

const clip = (text: string, max = 44) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** The event in flight: a packet that travels the cables from one actor to another, or a ring that pulses on one. */
function Marker({ flight, event }: { flight: Pick<Flight, "duration"> & { key: string | number }; event: ClusterEvent }) {
  const ref = useRef<SVGGElement>(null)
  const textRef = useRef<SVGTextElement>(null)
  const rectRef = useRef<SVGRectElement>(null)
  const { from, to, pts } = useFlightRoute(event)
  const color = LAYERS[event.layer].color
  const pulse = from && to && from.id === to.id
  const label = clip(sentence(event.title), 34)

  useEffect(() => {
    const t = textRef.current
    const r = rectRef.current
    if (!t || !r) return
    const w = t.getComputedTextLength() + 18
    r.setAttribute("x", String(-w / 2))
    r.setAttribute("width", String(w))
  }, [label])

  useProgress(flight.key, flight.duration, pts.length > 1, (t) => {
    const [x, y] = along(pts, t)
    ref.current?.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`)
  })

  if (!from || !to) return null
  const chip = (
    <g className="chip" transform="translate(0 -24)">
      <rect ref={rectRef} x={-80} y={-11} width={160} height={21} rx={4} />
      <text ref={textRef} textAnchor="middle" y={4}>{label}</text>
    </g>
  )

  if (pulse) {
    return (
      <g className="marker pulse" style={{ "--c": color, "--d": `${flight.duration}ms` } as CSSProperties} transform={`translate(${from.pos[0]} ${from.pos[1] - 20})`}>
        <circle className="ring" r={16} />
        <circle className="ring r2" r={16} />
        <circle r={5} className="core" />
        <g transform="translate(0 -34)">{chip}</g>
      </g>
    )
  }

  const start = pts[0] ?? from.pos
  return (
    <g ref={ref} className="marker" style={{ "--c": color } as CSSProperties} transform={`translate(${start[0]} ${start[1]})`}>
      <circle r={5} className="core" />
      {chip}
    </g>
  )
}

function ActorNode({ actor, focused, dimmed, slots, onHover }: {
  actor: Actor
  focused: boolean
  dimmed: boolean
  slots?: PodSlot[]
  onHover: (a: Actor | null) => void
}) {
  const drill = useApp((s) => s.drill)
  const art = useMemo(() => actor.art(slots), [actor, slots])
  const [anchorX, anchorY, anchor] = actor.label
  const interactive = !!actor.opens
  const open = () => actor.opens && drill(actor.opens)

  return (
    <g
      className="actor"
      data-on={focused || undefined}
      data-dim={dimmed || undefined}
      data-interactive={interactive || undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `Look inside ${actor.name}` : undefined}
      onClick={interactive ? open : undefined}
      onKeyDown={interactive ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open()) : undefined}
      onPointerEnter={() => onHover(actor)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(actor)}
      onBlur={() => onHover(null)}
    >
      <g transform={`translate(${actor.pos[0]} ${actor.pos[1]})`} dangerouslySetInnerHTML={{ __html: art }} />
      <g className="alabel" transform={`translate(${actor.pos[0] + anchorX} ${actor.pos[1] + anchorY})`} textAnchor={anchor}>
        <text className="n">{actor.name}</text>
        <text className="ip" y="16">{actor.sub}</text>
      </g>
    </g>
  )
}

/** A Kubernetes object (Deployment, ReplicaSet, Service…) drawn as a card, materialized by the event that touched it. */
function ResourceNode({ actor, res, focused, dimmed, delay, onHover }: {
  actor: Actor
  res: Resource
  focused: boolean
  dimmed: boolean
  /** how long after its event lands the card appears, in milliseconds */
  delay: number
  onHover: (a: Actor | null) => void
}) {
  const art = useMemo(() => actor.art(), [actor])
  const [anchorX, anchorY, anchor] = actor.label
  return (
    <g
      className={`res kind-${res.kind}`}
      data-state={res.state ?? "active"}
      data-on={focused || undefined}
      data-dim={dimmed || undefined}
      style={{ "--born": `${delay}ms` } as CSSProperties}
      onPointerEnter={() => onHover(actor)}
      onPointerLeave={() => onHover(null)}
    >
      <g transform={`translate(${actor.pos[0]} ${actor.pos[1]})`} dangerouslySetInnerHTML={{ __html: art }} />
      <g className="alabel" transform={`translate(${actor.pos[0] + anchorX} ${actor.pos[1] + anchorY})`} textAnchor={anchor}>
        <text className="n">{res.name}</text>
        {res.sub && <text className="ip" y="16">{res.sub}</text>}
      </g>
    </g>
  )
}

/** The plate a level or a group stands on: a thin slab with a faint grid and its name lying on it. */
function Floor({ level, floor, group, onHover }: { level: Level; floor: FloorShape; group?: Group; onHover?: (g: Group | null) => void }) {
  const markup = useMemo(() => {
    const { x0, x1, y0, y1 } = floor
    const P = (x: number, y: number) => toScreen(level, [x, y])
    const pts = (a: Point[]) => a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")
    const down = (p: Point): Point => [p[0], p[1] + 6]
    const [a, b, c, e] = [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)]
    let grid = ""
    for (let x = x0 + 4; x < x1; x += 4) grid += `M${P(x, y0).map((v) => v.toFixed(1)).join(" ")}L${P(x, y1).map((v) => v.toFixed(1)).join(" ")}`
    for (let y = y0 + 4; y < y1; y += 4) grid += `M${P(x0, y).map((v) => v.toFixed(1)).join(" ")}L${P(x1, y).map((v) => v.toFixed(1)).join(" ")}`
    return { edge: [pts([e, c, down(c), down(e)]), pts([c, b, down(b), down(c)])], top: pts([a, b, c, e]), grid }
  }, [level, floor])
  return (
    <g className="floor" data-group={group?.id} onPointerEnter={() => group && onHover?.(group)} onPointerLeave={() => group && onHover?.(null)}>
      {markup.edge.map((p) => <polygon key={p} className="floor-edge" points={p} />)}
      <polygon className="floor-top" points={markup.top} />
      <path className="floor-grid" d={markup.grid} />
      <text className="floor-name" transform={floorMatrix(level, floor.at)} fontSize={level === "cluster" ? 2.1 : level === "pod" ? 2 : 2.4}>
        {floor.text.split("\n").map((line, i) => (
          <tspan key={line} x={0} dy={i ? 2.6 : 0}>{line}</tspan>
        ))}
      </text>
    </g>
  )
}

/** How wide a box the camera closes in to when it dives into a node or Pod, or pulls back out of one. */
const DIVE_W = 520

/** Inside a node or Pod, the camera sits this much further back than a tight fit, so the scene has room to breathe. */
const INSIDE_PULLBACK = 1.2

/** The same box, grown by `f` around its centre. */
const widen = ([x, y, w, h]: Box, f: number): Box => [x - (w * (f - 1)) / 2, y - (h * (f - 1)) / 2, w * f, h * f]

function ClusterScene() {
  const lesson = useLesson()
  const step = useApp((s) => s.step)
  const finished = useApp((s) => s.finished)
  const flight = useApp((s) => s.flight)
  const transit = useApp((s) => s.transit)
  const speed = useApp((s) => s.speed)
  const scene = useSceneState(lesson)
  const [hover, setHover] = useState<Described | null>(null)

  const [entered, setEntered] = useState<{ level: Level; direction: "in" | "out" | "emerge" }>({ level: scene.level, direction: "in" })
  if (entered.level !== scene.level) {
    const direction = transit?.phase === "emerge" ? "emerge" : DEPTH[scene.level] >= DEPTH[entered.level] ? "in" : "out"
    setEntered({ level: scene.level, direction })
  }

  const revealed = useApp((s) => s.revealed)
  const pods = useMemo(
    () => podsAt(lesson, finished ? lesson.steps.length - 1 : step, revealed),
    [lesson, step, finished, revealed],
  )
  const resources = useMemo(
    () => (scene.level === "cluster" ? resourcesAt(lesson, finished ? lesson.steps.length - 1 : step, revealed) : {}),
    [lesson, step, finished, revealed, scene.level],
  )
  const resIds = new Set(Object.keys(resources))
  const flightEvent = flight ? timeline(lesson).events.find((e) => e.id === flight.id) : undefined
  const ids = new Set(scene.visible.map((a) => a.id))
  const floor = useMemo(() => floorFor(scene.level, new Set(scene.visible.map((a) => a.id))), [scene.level, scene.visible])
  const cables = CABLES[scene.level].filter((c) => ids.has(c.a) && ids.has(c.b))
  // a marker may fly to a card that exists, or one this very event is about to create
  const shown = (id: ActorId) => ids.has(id) || resIds.has(id) || (!!flightEvent?.res?.[id] && !!actorById(id)?.kind)
  const flying = flightEvent?.path?.every(shown) ? flightEvent : undefined
  const transitEvent = transit ? timeline(lesson).events.find((e) => e.id === transit.eventId) : undefined
  const carried =
    transit && (transit.phase === "carry" || transit.phase === "dive") && transitEvent && ids.has(transit.from) && ids.has(transit.to)
      ? {
          event: { ...transitEvent, path: (transit.phase === "carry" ? [transit.from, transit.to] : [transit.to, transit.to]) as [ActorId, ActorId] },
          flight: { id: transitEvent.id, key: transit.key, duration: (transit.phase === "carry" ? CARRY_MS : 1400) / speed },
        }
      : undefined

  // Diving, the camera closes in on the node or Pod, centred on it, with a little of its surroundings still in view.
  const target = scene.dive ? actorById(scene.frameIds[0]) : undefined
  const diveH = (DIVE_W * WORLD.height) / WORLD.width
  const autoBox: Box = target
    ? [target.pos[0] - DIVE_W / 2, target.pos[1] - 16 - diveH / 2, DIVE_W, diveH]
    : widen(
        scene.dim
          ? frame(scene.frameIds, scene.level === "cluster" ? WORLD.width : 640, floorCorners(scene.level, floor))
          : frame([...scene.frameIds, ...resIds], scene.level === "cluster" ? WORLD.width : 640, floorCorners(scene.level, floor), finished || revealed > 0),
        scene.level === "cluster" ? 1 : INSIDE_PULLBACK,
      )

  // ownership edges: card-to-card from the catalog, card-to-node from the Pod-slot layout
  const onScreen = (id: ActorId) => ids.has(id) || resIds.has(id)
  const ownLinks =
    scene.level !== "cluster"
      ? []
      : [
          ...RESOURCE_LINKS.filter(([a, b]) => onScreen(a) && onScreen(b)),
          ...workloadNodes(resources, pods).filter(([a, b]) => resIds.has(a) && ids.has(b)),
        ]

  // the cards the event that just landed changed
  const { events } = timeline(lesson)
  const lastEvent = revealed > 0 ? events[revealed - 1] : undefined
  const touched = new Set(Object.entries(lastEvent?.res ?? {}).filter(([, r]) => r !== null).map(([id]) => id))

  // a card created somewhere other than where its event landed: a marker carries it the rest of the way
  const landed = useApp((s) => s.landed)
  const reduced = useReducedMotion()
  const origin = lastEvent?.path?.[1]
  const creating =
    lastEvent && landed === lastEvent.id && origin && onScreen(origin) && !reduced
      ? createdBy(lesson, lastEvent).filter((id) => id !== origin && resIds.has(id))
      : []
  const createMs = CREATE_MS / speed
  const births = creating.map((id) => ({
    flight: { key: `born-${lastEvent!.id}-${id}`, duration: createMs },
    event: { ...lastEvent!, title: resources[id].name, path: [origin, id] as [ActorId, ActorId] },
  }))
  const bornDelay = (id: ActorId) => (creating.includes(id) ? createMs : 0)
  const bornStyle = { "--born": `${createMs}ms` } as CSSProperties

  // the reader can take the camera: scroll to zoom, drag to move; a new level takes it back
  const svgRef = useRef<SVGSVGElement | null>(null)
  const cam = useExploreCamera(autoBox, scene.level, svgRef)
  const [x, y, w] = cam.box
  const scale = WORLD.width / w
  const camera: CSSProperties = { transform: `translate(${-x * scale}px, ${-y * scale}px) scale(${scale})` }

  return (
    <>
      <svg
        ref={svgRef}
        className="iso scene"
        data-panning={cam.panning || undefined}
        viewBox={`0 0 ${WORLD.width} ${WORLD.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        tabIndex={0}
        aria-label={`Diagram: ${LEVEL_NAME[scene.level].toLowerCase()}. Drag to move, scroll to zoom.`}
        {...cam.svgProps}
      >
        <g key={scene.level} className="camera" data-dive={scene.dive || undefined} data-manual={cam.manual || undefined} data-surface={transit?.phase === "surface" || undefined} style={camera}>
          <g className="level" data-enter={entered.direction}>
            <Floor level={scene.level} floor={floor} />
            {GROUPS.filter((g) => g.level === scene.level && g.members.every((m) => ids.has(m))).map((g) => (
              <Floor key={g.id} level={g.level} floor={g.floor} group={g} onHover={(h) => !cam.panning && setHover(h)} />
            ))}
            {cables.map((c) => (
                <CableLine key={`${c.a}-${c.b}`} level={scene.level} cable={c} on={scene.focus.has(c.a) && scene.focus.has(c.b)} />
              ))}
            {JOINTS[scene.level].filter((p) => cables.some((c) => c.route.some((q) => q[0] === p[0] && q[1] === p[1]))).map((p) => {
              const [cx, cy] = toScreen(scene.level, p)
              return <circle key={p.join()} className="joint" cx={cx} cy={cy} r={2.2} />
            })}
            {ownLinks.map(([a, b]) => (
              <OwnLink key={`own-${a}-${b}`} a={actorById(a)!} b={actorById(b)!} on={scene.focus.has(a) && scene.focus.has(b)} delay={Math.max(bornDelay(a), bornDelay(b))} />
            ))}
            {births.map((b) => (
              <g key={b.flight.key} className="birth" style={bornStyle}><Trail flight={b.flight} event={b.event} /></g>
            ))}
            {flight && flying && <Trail key={`trail-${flight.key}`} flight={flight} event={flying} />}
            {carried && <Trail key={`trail-${carried.flight.key}`} flight={carried.flight} event={carried.event} />}
            {scene.visible.map((actor) => (
              <ActorNode
                key={actor.id}
                actor={actor}
                focused={scene.focus.has(actor.id)}
                dimmed={scene.dim && !scene.focus.has(actor.id)}
                slots={actor.id === "node1" || actor.id === "node2" ? pods[actor.id] : undefined}
                onHover={(a) => !cam.panning && setHover(a)}
              />
            ))}
            {Object.entries(resources).map(([id, res]) => {
              const actor = actorById(id)
              if (!actor?.kind) return null
              return (
                <ResourceNode
                  key={id}
                  actor={actor}
                  res={res}
                  focused={scene.focus.has(id)}
                  dimmed={scene.dim && !scene.focus.has(id) && !touched.has(id)}
                  delay={bornDelay(id)}
                  onHover={(a) => !cam.panning && setHover(a)}
                />
              )
            })}
            {births.map((b) => (
              <g key={b.flight.key} className="birth" style={bornStyle}><Marker flight={b.flight} event={b.event} /></g>
            ))}
            {flight && flying && <Marker key={flight.key} flight={flight} event={flying} />}
            {carried && <Marker key={carried.flight.key} flight={carried.flight} event={carried.event} />}
          </g>
        </g>
      </svg>
      <div className="zoom-ui">
        <Button className="ibtn" onClick={() => cam.zoomBy(1.4)} aria-label="Zoom in" title="Zoom in (+)">
          <Icon name="plus" size={14} />
        </Button>
        <Button className="ibtn" onClick={() => cam.zoomBy(1 / 1.4)} aria-label="Zoom out" title="Zoom out (−)">
          <Icon name="minus" size={14} />
        </Button>
        {cam.manual && (
          <Button className="ibtn" onClick={cam.reset} aria-label="Reset view" title="Reset view">
            <Icon name="recenter" size={14} />
          </Button>
        )}
      </div>
      <Narration hover={hover} />
    </>
  )
}

/** The caption under the diagram: what's happening right now, in one plain sentence. */
function Narration({ hover }: { hover: Described | null }) {
  const lesson = useLesson()
  const step = useApp((s) => s.step)
  const intro = useApp((s) => s.intro)
  const flight = useApp((s) => s.flight)
  const selected = useApp((s) => s.selectedEvent)
  const finished = useApp((s) => s.finished)
  const transit = useApp((s) => s.transit)
  const next = useApp((s) => s.next)
  const { events } = timeline(lesson)
  const event = events.find((e) => e.id === (flight?.id ?? transit?.eventId ?? selected))

  let body: ReactNode = null
  let key = "none"
  if (hover) {
    key = `hover-${hover.id}`
    body = (
      <>
        <b>{hover.name}</b>
        <span>{hover.about}</span>
      </>
    )
  } else if (intro && step >= 0 && !finished) {
    const s = lesson.steps[step]
    key = `intro-${step}`
    body = (
      <>
        <b className="step-tag">Step {step + 1}</b>
        <span><strong>{sentence(s.title)}</strong></span>
      </>
    )
  } else if (event && step >= 0) {
    key = `event-${event.id}`
    body = (
      <>
        <Button
          className="badge badge-btn"
          style={{ "--c": LAYERS[event.layer].color } as CSSProperties}
          onClick={() => {
            useApp.getState().selectEvent(event.id)
            useApp.getState().setFlowOpen(true)
          }}
          aria-label={`Event ${event.index + 1}: show it decoded`}
          title="Show it decoded (E)"
        >
          {event.index + 1}
        </Button>
        <span>
          <em>{event.src} → {event.dst}</em>
          {event.says ?? sentence(event.title)}
        </span>
      </>
    )
  }

  return (
    <div className="caption" data-show={body ? "" : undefined} data-kind={hover ? "hover" : "narration"} aria-live="polite">
      <div key={key} className="caption-in">
        {body}
        {!hover && body && !finished && !flight && !transit && (
          <Button className="caption-next" onClick={next} aria-label="Next" title="Next (N)">
            <Icon name="right" size={16} />
          </Button>
        )}
      </div>
    </div>
  )
}

function Breadcrumb() {
  const lesson = useLesson()
  const scene = useSceneState(lesson)
  const override = useApp((s) => s.viewOverride)
  const drill = useApp((s) => s.drill)
  const path = levelPath(scene.level)
  if (path.length < 2 && !override) return null

  return (
    <nav className="crumbs" aria-label="Zoom level">
      {path.map((level, i) => (
        <span key={level} className="crumb">
          {i > 0 && <span className="sep" aria-hidden="true">/</span>}
          {i === path.length - 1 ? (
            <b aria-current="location">{LEVEL_NAME[level]}</b>
          ) : (
            <Button className="crumb-btn" onClick={() => drill(level)}>{LEVEL_NAME[level]}</Button>
          )}
        </span>
      ))}
      {override && (
        <Button className="btn sm follow" onClick={() => drill(null)}>
          <Icon name="replay" size={12} />
          Follow lesson
        </Button>
      )}
    </nav>
  )
}

export function Stage() {
  const view = useApp((s) => s.stageView)
  const setView = useApp((s) => s.setStageView)

  return (
    <section className="stage" id="stage" aria-label="Diagram" tabIndex={-1}>
      <div className="canvas">
        {view === "cluster" ? (
          <ClusterScene />
        ) : (
          <Suspense fallback={null}>
            <SequenceView />
          </Suspense>
        )}
        <div className="stage-tools">
          <SegmentedControl aria-label="Diagram view" className="seg" value={view} onValueChange={(v) => v && setView(v as StageView)}>
            <SegmentedControlIndicator className="seg-indicator" />
            <SegmentedControlItem value="cluster">
              <Icon name="layers" size={14} />
              Cluster
            </SegmentedControlItem>
            <SegmentedControlItem value="sequence">
              <Icon name="sequence" size={14} />
              Sequence
            </SegmentedControlItem>
          </SegmentedControl>
          {view === "cluster" && <Breadcrumb />}
        </div>
        <Transport />
      </div>
    </section>
  )
}
