import type { Category } from "../data/types"
import { apiServer, box, controllerManager, etcd, faceTop, faceX, faceY, iso, scheduler } from "../iso/iso"

/* What each lesson category is about, standing on a square of the cluster floor: a packet and its
   headers, a worker node and its Pods, the control plane's four components, and a Deployment with a
   rollout under way. All four share one scale and one viewBox, so they line up and need no measuring. */

const S = 4.9
/** half the width of the floor square, in ground units */
const R = 13

const P = (x: number, y: number) => iso(x, y, 0, S).map((v) => v.toFixed(1)).join(" ")
const at = (x: number, y: number, art: string) => `<g transform="translate(${P(x, y)})">${art}</g>`

function floor() {
  let grid = ""
  for (let k = 3.25 - R; k < R; k += 3.25) grid += `M${P(k, -R)} L${P(k, R)} M${P(-R, k)} L${P(R, k)} `
  return box(-R, -R, -1.2, 2 * R, 2 * R, 1.2, S, "slab") + `<path class="layer-grid" d="${grid}"/>`
}

/** Text on a top face, reading up along y. */
const topLabel = (x: number, y: number, z: number, text: string, size: number) =>
  `<g transform="${faceTop(x, y, z, S)}"><text class="topt" transform="rotate(-90)" y="${(size * 0.35).toFixed(2)}" font-size="${size}" text-anchor="middle">${text}</text></g>`

/** A Pod as a glass case with its container inside. */
function podCase(x: number, y: number, z: number, w: number, h: number, kind: "v1" | "v2" | "other") {
  const inset = w * 0.22
  return `<g class="slot-${kind}">${box(x + inset, y + inset, z, w - inset * 2, w - inset * 2, h * 0.62, S)}<g class="glass">${box(x, y, z, w, w, h, S)}</g></g>`
}

/** A frame on the wire, cut at each header. */
function packet() {
  const parts: [label: string, width: number, tint: number][] = [["ETH", 4, 0], ["IP", 4.4, 14], ["TCP", 4.4, 26], ["HTTP", 7.2, 40]]
  const [y, d, h] = [-6.5, 13, 5.4]
  let x = -11.2
  let g = ""
  for (const [label, w, tint] of parts) {
    let ticks = ""
    for (let u = 1; u < w - 0.4; u += 1) ticks += `<line class="det" x1="${u.toFixed(1)}" y1="${h - 1.5}" x2="${u.toFixed(1)}" y2="${h - 0.7}"/>`
    g += `<g class="layer-tint" style="--tint:${tint}%">${box(x, y, 0, w, d, h, S)}</g>`
    g += `<g transform="${faceY(x, y + d, h, S)}">${ticks}</g>`
    g += topLabel(x + w / 2, y + d / 2, h, label, 2.9)
    x += w + 0.8
  }
  return g
}

/** A worker node: a machine with four Pods on its lid. */
function node() {
  const r = 10
  let g = box(-r, -r, 0, 2 * r, 2 * r, 4.6, S)
  let vents = ""
  for (let u = 2; u < 10; u += 1.1) vents += `<line class="det" x1="${u.toFixed(1)}" y1="1.4" x2="${u.toFixed(1)}" y2="3.2"/>`
  g += `<g transform="${faceY(-r, r, 4.6, S)}">${vents}<rect class="layer-bay" x="12" y="1.3" width="6" height="2" rx=".3"/></g>`
  const leds = [1.8, 3.2, 4.6].map((u, i) => `<circle class="led${i === 1 ? " b" : ""}" cx="${u}" cy="2.3" r=".45"/>`).join("")
  g += `<g transform="${faceX(r, r, 4.6, S)}">${leds}<line class="det" x1="8" y1="1.7" x2="18" y2="1.7"/><line class="det" x1="8" y1="2.9" x2="15" y2="2.9"/></g>`
  const spots: [number, number, "v1" | "v2" | "other"][] = [[-8.4, -8.4, "v1"], [1.2, -8.4, "other"], [-8.4, 1.2, "other"], [1.2, 1.2, "v1"]]
  for (const [x, y, kind] of spots) g += podCase(x, y, 4.6, 7.2, 5.2, kind)
  return g
}

/** Tall ones at the back, so none hides another. */
const controlPlane = () =>
  at(-6.2, -6.2, apiServer(S * 0.86)) + at(6.4, -6.4, etcd(S * 0.86)) + at(-6.4, 6.4, scheduler(S * 0.92)) + at(6.2, 6.2, controllerManager(S * 0.92))

/** A Deployment and its three Pods, the last one already on the new version. */
function deployment() {
  let g = `<g>${box(-12, -7, 0, 24, 14, 1.2, S)}${box(-11.4, -6.4, 1.2, 22.8, 12.8, 1, S)}</g>`
  const kinds = ["v1", "v1", "v2"] as const
  kinds.forEach((kind, i) => {
    g += podCase(-10.5 + i * 7.3, -5.2, 2.2, 6.4, 8, kind)
  })
  g += `<g transform="${faceTop(-11.4, -6.4, 2.2, S)}"><text class="topt" x="1.2" y="11.2" font-size="2.2">deployment/web</text></g>`
  return g
}

const FLOOR = floor()
const ART: Record<Category, string> = {
  network: FLOOR + packet(),
  node: FLOOR + node(),
  control: FLOOR + controlPlane(),
  app: FLOOR + deployment(),
}

export function LayerArt({ category }: { category: Category }) {
  return <svg className="iso layer-art" viewBox="-112 -92 224 168" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ART[category] }} />
}
