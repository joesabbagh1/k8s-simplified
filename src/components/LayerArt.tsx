import type { Category } from "../data/types"
import { apiServer, box, etcd, iso, loadBalancer, pod, workerNode, type Point } from "../iso/iso"

/* The piece of the demo cluster each lesson category is about, on a square of its floor. Everything
   shares one scale and one viewBox, so the four line up and need no measuring. Cable colors are the
   layer colors the lessons use. */

const S = 4
/** half the width of the floor square, in ground units */
const R = 14

const P = (x: number, y: number) => iso(x, y, 0, S).map((v) => v.toFixed(1)).join(" ")
const line = (...route: Point[]) => route.map(([x, y], i) => `${i ? "L" : "M"}${P(x, y)}`).join(" ")

function floor() {
  let grid = ""
  for (let k = 4 - R; k < R; k += 4) grid += `${line([k, -R], [k, R])} ${line([-R, k], [R, k])} `
  return box(-R, -R, -1.4, 2 * R, 2 * R, 1.4, S, "slab") + `<path class="layer-grid" d="${grid}"/>`
}

const at = (x: number, y: number, art: string) => `<g transform="translate(${P(x, y)})">${art}</g>`
const cable = (layer: string, ...route: Point[]) => `<path class="layer-cable" style="stroke:var(--l-${layer})" d="${line(...route)}"/>`

const FLOOR = floor()

const ART: Record<Category, string> = {
  network: FLOOR + cable("net", [R, 0], [-R, 0]) + cable("net", [0, 0], [0, R]) + at(0, 0, loadBalancer(S)),
  node: FLOOR + cable("node", [0, 0], [0, R]) + at(0, 0, workerNode(S, ["v1", "v1", "other", "v2"])),
  control: FLOOR + cable("api", [-7, 0], [-7, R]) + cable("state", [-7, 0], [7, 0]) + at(-7, 0, apiServer(S * 0.8)) + at(7, 0, etcd(S * 0.8)),
  app: FLOOR + cable("net", [0, 0], [0, R]) + at(0, 0, pod(S * 1.1)),
}

export function LayerArt({ category }: { category: Category }) {
  return <svg className="iso layer-art" viewBox="-100 -62 200 128" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ART[category] }} />
}
