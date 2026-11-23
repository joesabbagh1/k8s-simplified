// Isometric drawing helpers. World x runs to the lower right, y to the lower left, z up.
// Every builder returns SVG markup in screen pixels, centred on the shape's footprint.

const C30 = Math.cos(Math.PI / 6)

export type Point = [number, number]

export const iso = (x: number, y: number, z: number, s: number): Point => [(x - y) * C30 * s, (x + y) * 0.5 * s - z * s]

const pts = (a: Point[]) => a.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ")
const mtx = (...n: number[]) => `matrix(${n.map((v) => +v.toFixed(3)).join(" ")})`

const faceY = (x: number, y: number, z: number, s: number) => {
  const o = iso(x, y, z, s)
  return mtx(C30 * s, 0.5 * s, 0, s, o[0], o[1])
}
const faceX = (x: number, y: number, z: number, s: number) => {
  const o = iso(x, y, z, s)
  return mtx(C30 * s, -0.5 * s, 0, s, o[0], o[1])
}
export const faceTop = (x: number, y: number, z: number, s: number) => {
  const o = iso(x, y, z, s)
  return mtx(C30 * s, 0.5 * s, -C30 * s, 0.5 * s, o[0], o[1])
}

export function box(x: number, y: number, z: number, w: number, d: number, h: number, s: number, cls = "") {
  const p = (a: number, b: number, c: number) => iso(a, b, c, s)
  const top = [p(x, y, z + h), p(x + w, y, z + h), p(x + w, y + d, z + h), p(x, y + d, z + h)]
  const left = [p(x, y + d, z), p(x + w, y + d, z), p(x + w, y + d, z + h), p(x, y + d, z + h)]
  const right = [p(x + w, y, z), p(x + w, y + d, z), p(x + w, y + d, z + h), p(x + w, y, z + h)]
  return `<g class="${cls}"><polygon class="f-l" points="${pts(left)}"/><polygon class="f-r" points="${pts(right)}"/><polygon class="f-t" points="${pts(top)}"/></g>`
}

function cylinder(z: number, r: number, h: number, s: number) {
  const rx = 1.2247 * r * s
  const ry = 0.7071 * r * s
  const yb = -z * s
  const yt = -(z + h) * s
  return `<g><path class="f-l" d="M${-rx},${yb} A${rx},${ry} 0 0 0 ${rx},${yb} L${rx},${yt} A${rx},${ry} 0 0 1 ${-rx},${yt} Z"/><ellipse class="f-t" cx="0" cy="${yt}" rx="${rx}" ry="${ry}"/></g>`
}

function hiddenEdges(x: number, y: number, w: number, d: number, h: number, s: number) {
  const line = (a: Point, b: Point) =>
    `<line class="hid" x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"/>`
  const o = iso(x, y, 0, s)
  return line(o, iso(x, y, h, s)) + line(o, iso(x + w, y, 0, s)) + line(o, iso(x, y + d, 0, s))
}

function arrow(x1: number, y1: number, x2: number, y2: number) {
  const len = Math.hypot(x2 - x1, y2 - y1)
  const ux = (x2 - x1) / len
  const uy = (y2 - y1) / len
  const k = 1.1
  const head = (a: number) => [x2 - k * (ux * Math.cos(a) - uy * Math.sin(a)), y2 - k * (uy * Math.cos(a) + ux * Math.sin(a))]
  const [h1, h2] = [head(0.6), head(-0.6)]
  return `M${x1} ${y1} L${x2} ${y2} M${h1[0]} ${h1[1]} L${x2} ${y2} L${h2[0]} ${h2[1]}`
}

const leds = (positions: number[], v: number, accentIndex = 1) =>
  positions.map((u, i) => `<circle class="led${i === accentIndex ? " b" : ""}" cx="${u}" cy="${v}" r=".4"/>`).join("")

const TERMINAL =
  `<text class="scr" x="1.4" y="2.7" font-size="1.3">&gt;_ kubectl</text><text class="scr d" x="1.4" y="4.4" font-size="1.15">apply -f</text><text class="scr d" x="1.4" y="5.9" font-size="1.15">web.yaml</text>`
const BROWSER =
  `<rect class="bar" x="1.3" y="1.2" width="9.4" height="1.5" rx=".35"/><text class="scr d" x="1.8" y="2.28" font-size=".85">shop.example.com</text>` +
  `<line class="det" x1="1.4" y1="4" x2="8.6" y2="4"/><line class="det" x1="1.4" y1="5.1" x2="9.8" y2="5.1"/><line class="det" x1="1.4" y1="6.2" x2="6.4" y2="6.2"/>`

/** A laptop. The screen shows a terminal running kubectl, or a browser for a visitor. */
export function laptop(s: number, screen: "terminal" | "browser" = "terminal") {
  let g = box(-5, -6, 0, 10, 12, 0.8, s)
  let keys = ""
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 9; i++) keys += `<rect x="${(1.2 + row * 1.1).toFixed(2)}" y="${(1.4 + i * 1.05).toFixed(2)}" width=".8" height=".75"/>`
  g += `<g class="keys" transform="${faceTop(-4.4, -6, 0.8, s)}">${keys}<rect x="5.2" y="4" width="2.6" height="4"/></g>`
  g += box(-5, -6, 0.8, 0.6, 12, 7.8, s)
  g += `<g transform="${faceX(-4.4, 6, 8.6, s)}"><rect class="display-r" x=".7" y=".7" width="10.6" height="6.4"/>${screen === "browser" ? BROWSER : TERMINAL}</g>`
  return g
}

export function controlPlane(s: number) {
  let g = ""
  for (let k = 0; k < 3; k++) {
    const z = k * 2.7
    g += box(-5, -5, z, 10, 10, 2.2, s)
    g += `<g transform="${faceX(5, 5, z + 2.2, s)}">${leds([1.3, 2.5], 1.1)}<line class="det" x1="5" y1=".8" x2="8.8" y2=".8"/><line class="det" x1="5" y1="1.4" x2="8.8" y2="1.4"/></g>`
    g += `<g transform="${faceY(-5, 5, z + 2.2, s)}"><line class="det" x1="1" y1="1.1" x2="9" y2="1.1"/></g>`
  }
  g += `<g transform="${faceTop(-5, -5, 7.6, s)}"><text class="topt" x="5" y="5.9" font-size="2.6" text-anchor="middle">API</text></g>`
  return g
}

export function etcd(s: number) {
  let g = ""
  for (let k = 0; k < 3; k++) g += cylinder(k * 2.5, 4.4, 1.9, s)
  g += `<g transform="${faceTop(0, 0, 6.9, s)}"><text class="topt" x="0" y=".8" font-size="2" text-anchor="middle">etcd</text></g>`
  return g
}

export function workerNode(s: number, slots: readonly string[] = ["other", "other"]) {
  let g = box(-8, -8, 0, 16, 16, 2.4, s)
  g += `<g transform="${faceX(8, 8, 2.4, s)}">${leds([1.3, 2.6, 3.9], 1.2)}<line class="det" x1="6" y1=".9" x2="14.5" y2=".9"/><line class="det" x1="6" y1="1.6" x2="14.5" y2="1.6"/></g>`
  const spots: [number, number][] = [[-6.8, -6.8], [1.3, -6.8], [-6.8, 1.3], [1.3, 1.3]]
  slots.slice(0, 4).forEach((slot, i) => {
    const [x, y] = spots[i]
    g += box(x, y, 2.4, 5.5, 5.5, 4.4, s, `slot slot-${slot}`)
  })
  return g
}

/** A labelled box: the generic part inside a node or a Pod. */
export function chip(s: number, w: number, d: number, h: number, label: string, cls = "") {
  let g = box(-w / 2, -d / 2, 0, w, d, h, s, cls)
  const size = Math.min(2.1, (w * 1.45) / Math.max(label.length, 3))
  g += `<g transform="${faceTop(-w / 2, -d / 2, h, s)}"><text class="topt" x="${w / 2}" y="${d / 2 + size * 0.35}" font-size="${size.toFixed(2)}" text-anchor="middle">${label}</text></g>`
  g += `<g transform="${faceX(w / 2, d / 2, h, s)}">${leds([1, 2], Math.min(h / 2, 1.1), 0)}</g>`
  return g
}

/** A Kubernetes API object drawn as a stacked record card: kind initials on the top face. */
export function resourceCard(s: number, badge: string) {
  let g = box(-6, -4, 0, 12, 8, 1.6, s)
  g += box(-6, -4, 1.6, 12, 8, 1.1, s, "sheet")
  g += `<g transform="${faceTop(-6, -4, 2.7, s)}"><text class="topt" x="6" y="5.2" font-size="2.7" text-anchor="middle">${badge}</text></g>`
  return g
}

/** A server rack with a word on top, for things outside the cluster like a DNS resolver. */
export function rack(s: number, label: string) {
  let g = ""
  for (let k = 0; k < 2; k++) {
    const z = k * 2.7
    g += box(-4.5, -4.5, z, 9, 9, 2.2, s)
    g += `<g transform="${faceX(4.5, 4.5, z + 2.2, s)}">${leds([1.2, 2.4], 1.1)}<line class="det" x1="4.5" y1="1.1" x2="8" y2="1.1"/></g>`
  }
  g += `<g transform="${faceTop(-4.5, -4.5, 4.9, s)}"><text class="topt" x="4.5" y="5.4" font-size="2.3" text-anchor="middle">${label}</text></g>`
  return g
}

export function pod(s: number) {
  let g = hiddenEdges(-5, -5, 10, 10, 9, s)
  g += box(-3.8, -3.8, 0, 2.6, 2.6, 2.6, s)
  g += box(-1.2, -1.2, 0, 5, 5, 6.2, s, "hot")
  g += `<g transform="${faceY(-1.2, 3.8, 6.2, s)}"><text class="topt" x=".7" y="1.9" font-size="1.4">app</text></g>`
  g += box(-5, -5, 0, 10, 10, 9, s, "glass")
  return g
}

export function loadBalancer(s: number) {
  let g = box(-6, -6, 0, 12, 12, 2.6, s)
  g += `<g class="arrows" transform="${faceTop(-6, -6, 2.6, s)}"><path d="${arrow(1.6, 6, 5.2, 6)} ${arrow(5.2, 6, 10.2, 2.4)} ${arrow(5.2, 6, 10.4, 6)} ${arrow(5.2, 6, 10.2, 9.6)}"/></g>`
  g += `<g transform="${faceX(6, 6, 2.6, s)}">${leds([1.2, 2.4], 1.3)}<line class="det" x1="5" y1="1.3" x2="10.8" y2="1.3"/></g>`
  return g
}

export function logo(s: number) {
  return hiddenEdges(-5, -5, 10, 10, 10, s) + box(-2.2, -2.2, 0, 4.4, 4.4, 4.4, s, "hot") + box(-5, -5, 0, 10, 10, 10, s, "glass")
}
