import type { ActorId, Category, PodSlot } from "../data/types"
import { box, iso } from "../iso/iso"
import { actorById } from "../scene/world"

/* What each lesson category is about: the actors its lessons play out on, with the lessons' own art,
   on a square of the cluster floor. All four share one scale and one viewBox, so they line up and
   need no measuring. */

/** the cluster view's scale */
const S = 4.6
/** half the width of the floor square, in ground units */
const R = 14

const P = (x: number, y: number) => iso(x, y, 0, S).map((v) => v.toFixed(1)).join(" ")

function floor() {
  let grid = ""
  for (let k = 4 - R; k < R; k += 4) grid += `M${P(k, -R)} L${P(k, R)} M${P(-R, k)} L${P(R, k)} `
  return box(-R, -R, -1.4, 2 * R, 2 * R, 1.4, S, "slab") + `<path class="floor-grid" d="${grid}"/>`
}

type Placed = [id: ActorId, x: number, y: number, slots?: PodSlot[], scale?: number]

function actor([id, x, y, slots, scale = 1]: Placed) {
  const a = actorById(id)!
  return `<g class="${a.kind ? `res kind-${a.kind}` : ""}" transform="translate(${P(x, y)}) scale(${scale})">${a.art(slots)}</g>`
}

/** Back to front; tall ones at the back, so none hides another. */
const CAST: Record<Category, Placed[]> = {
  network: [["resolver", -7, -7], ["visitor", -7, 6.5], ["lb", 6.5, 0]],
  node: [["node2", 0, 0, ["other", "v1", "v1"], 1.3]],
  control: [["api", -6.5, -6.5], ["etcd", 7, -7], ["sched", -7, 7], ["kcm", 6.5, 6.5]],
  app: [["n2.podA", -6.5, -6.5], ["n2.podB", 7, -6.5], ["web-deploy", -6.5, 7], ["web-svc", 7, 7]],
}

const FLOOR = floor()
const ART = Object.fromEntries(Object.entries(CAST).map(([category, cast]) => [category, FLOOR + cast.map(actor).join("")])) as Record<Category, string>

export function LayerArt({ category }: { category: Category }) {
  return <svg className="iso layer-art" viewBox="-113 -92 226 168" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ART[category] }} />
}
