import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react"
import { WORLD, type Box } from "./world"

type Point = [number, number]

/** closest and furthest the reader can stand, as the width of the visible world box */
const W_MIN = 240
const W_MAX = 1500
/** how far a pointer must travel before a press turns into a pan, in CSS pixels */
const DRAG_SLOP = 4
/** wheel → zoom, tuned for both pixel deltas (trackpads) and line deltas (mice) */
const WHEEL_GAIN = 0.0016

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Keeps the camera inside useful bounds: a sane zoom range, and never fully off the world. */
export function clampBox([x, y, w]: Box): Box {
  w = clamp(w, W_MIN, W_MAX)
  const h = (w * WORLD.height) / WORLD.width
  const cx = clamp(x + w / 2, WORLD.width * -0.25, WORLD.width * 1.25)
  const cy = clamp(y + h / 2, WORLD.height * -0.25, WORLD.height * 1.25)
  return [cx - w / 2, cy - h / 2, w, h]
}

/** Zoom by `factor` (>1 draws closer), keeping the world point under viewBox point `p` fixed. */
export function zoomAt(box: Box, p: Point, factor: number): Box {
  const k = WORLD.width / box[2]
  const q: Point = [box[0] + p[0] / k, box[1] + p[1] / k]
  const w = clamp(box[2] / factor, W_MIN, W_MAX)
  const k2 = WORLD.width / w
  return clampBox([q[0] - p[0] / k2, q[1] - p[1] / k2, w, (w * WORLD.height) / WORLD.width])
}

/** Pan by a delta measured in viewBox units. */
export function panBy(box: Box, dx: number, dy: number): Box {
  const k = WORLD.width / box[2]
  return clampBox([box[0] - dx / k, box[1] - dy / k, box[2], box[3]])
}

export interface ExploreCamera {
  /** the box to show: the reader's once they pan or zoom, the scene's otherwise */
  box: Box
  /** true while the reader, not the lesson, is steering the camera */
  manual: boolean
  panning: boolean
  svgProps: {
    onPointerDown: (e: ReactPointerEvent<SVGSVGElement>) => void
    onPointerMove: (e: ReactPointerEvent<SVGSVGElement>) => void
    onPointerUp: (e: ReactPointerEvent<SVGSVGElement>) => void
    onPointerCancel: (e: ReactPointerEvent<SVGSVGElement>) => void
    onClickCapture: (e: ReactMouseEvent<SVGSVGElement>) => void
    onKeyDown: (e: ReactKeyboardEvent<SVGSVGElement>) => void
  }
  zoomBy: (factor: number) => void
  reset: () => void
}

/** Puts the reader behind the camera: scroll to zoom at the cursor, drag or pinch to move. */
export function useExploreCamera(auto: Box, resetKey: string, svgRef: RefObject<SVGSVGElement | null>): ExploreCamera {
  /** the reader's framing, tagged with the level it belongs to; null box = the scene's camera */
  const [manual, setManual] = useState<{ level: string; box: Box } | null>(null)
  const [panning, setPanning] = useState(false)
  /** the scene's latest framing, so the first gesture starts from what's on screen */
  const autoRef = useRef(auto)
  useEffect(() => {
    autoRef.current = auto
  })
  /** pointers currently on the glass, by pointerId */
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef({ start: [0, 0] as Point, pinch: 0, pinchMid: [0, 0] as Point, moved: false, suppressClick: false })

  // a new level is a new picture: hand the camera back to the scene
  if (manual && manual.level !== resetKey) setManual(null)
  const box = manual && manual.level === resetKey ? manual.box : null

  const apply = useCallback(
    (fn: (b: Box) => Box) => setManual((m) => (m && m.level === resetKey ? { ...m, box: fn(m.box) } : { level: resetKey, box: fn(autoRef.current) })),
    [resetKey],
  )

  /** CSS-pixel position → viewBox coordinates; the world's centre when the stage has no layout yet */
  const toView = useCallback((x: number, y: number): Point => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return [WORLD.width / 2, WORLD.height / 2]
    const s = Math.min(rect.width / WORLD.width, rect.height / WORLD.height)
    return [
      (x - rect.left - (rect.width - WORLD.width * s) / 2) / s,
      (y - rect.top - (rect.height - WORLD.height * s) / 2) / s,
    ]
  }, [svgRef])

  const viewScale = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect()
    return rect && rect.width && rect.height ? Math.min(rect.width / WORLD.width, rect.height / WORLD.height) : 0
  }, [svgRef])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    // a plain non-passive listener, so the page behind the stage can be stopped from scrolling
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1
      const p = toView(e.clientX, e.clientY)
      apply((b) => zoomAt(b, p, Math.exp(-e.deltaY * unit * WHEEL_GAIN)))
    }
    svg.addEventListener("wheel", onWheel, { passive: false })
    return () => svg.removeEventListener("wheel", onWheel)
  }, [svgRef, apply, toView])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    // with touch-action pan-y one finger scrolls the page; two-finger gestures must not become page scroll too
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) e.preventDefault()
    }
    svg.addEventListener("touchmove", onTouchMove, { passive: false })
    return () => svg.removeEventListener("touchmove", onTouchMove)
  }, [svgRef])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return
      pointers.current.set(e.pointerId, [e.clientX, e.clientY])
      const g = gesture.current
      g.suppressClick = false
      if (pointers.current.size === 1) {
        g.start = [e.clientX, e.clientY]
        g.moved = false
      }
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()]
        g.pinch = Math.hypot(a[0] - b[0], a[1] - b[1])
        g.pinchMid = toView((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        g.moved = true
      }
    },
    [toView],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const prev = pointers.current.get(e.pointerId)
      if (!prev) return
      pointers.current.set(e.pointerId, [e.clientX, e.clientY])
      const g = gesture.current

      // two fingers: zoom by their separation, pan by the midpoint's travel
      if (pointers.current.size === 2 && g.pinch) {
        const [a, b] = [...pointers.current.values()]
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1])
        const mid = toView((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        const [pmx, pmy] = g.pinchMid
        apply((box) => panBy(zoomAt(box, mid, dist / g.pinch), mid[0] - pmx, mid[1] - pmy))
        g.pinch = dist
        g.pinchMid = mid
        return
      }

      // one: drag. the slop lets clicks on actors land untouched
      if (pointers.current.size === 1) {
        // on a touch screen one finger belongs to the page: it scrolls, and only two fingers steer the stage
        if (e.pointerType === "touch") return
        const s = viewScale()
        if (!s) return
        if (!g.moved) {
          const [sx, sy] = g.start
          if (Math.hypot(e.clientX - sx, e.clientY - sy) < DRAG_SLOP) return
          g.moved = true
          setPanning(true)
          // captured from here on, the drag and the click it swallows stay on the stage
          svgRef.current?.setPointerCapture?.(e.pointerId)
        }
        apply((box) => panBy(box, (e.clientX - prev[0]) / s, (e.clientY - prev[1]) / s))
      }
    },
    [svgRef, apply, toView, viewScale],
  )

  const endPointer = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (pointers.current.size < 2) g.pinch = 0
    if (!pointers.current.size && g.moved) {
      g.moved = false
      g.suppressClick = true
      setPanning(false)
    }
  }, [])

  // pointer capture already keeps the click off the actors; this catches the browsers it misses
  const onClickCapture = useCallback((e: ReactMouseEvent<SVGSVGElement>) => {
    if (!gesture.current.suppressClick) return
    gesture.current.suppressClick = false
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const zoomBy = useCallback(
    (factor: number) => apply((b) => zoomAt(b, [WORLD.width / 2, WORLD.height / 2], factor)),
    [apply],
  )

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<SVGSVGElement>) => {
      if (e.key === "+" || e.key === "=") {
        e.preventDefault()
        zoomBy(1.4)
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault()
        zoomBy(1 / 1.4)
      }
    },
    [zoomBy],
  )

  const reset = useCallback(() => setManual(null), [])

  return {
    box: box ?? auto,
    manual: box !== null,
    panning,
    svgProps: { onPointerDown, onPointerMove, onPointerUp: endPointer, onPointerCancel: endPointer, onClickCapture, onKeyDown },
    zoomBy,
    reset,
  }
}
