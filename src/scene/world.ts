import type { ActorId, Level, NodeId, PodLayout, Resource, ResourceKind } from "../data/types"
import { apiServer, chip, controllerManager, etcd, iso, laptop, loadBalancer, pod, rack, resourceCard, scheduler, workerNode, type Point } from "../iso/iso"

export const WORLD = { width: 1000, height: 640 }

export type Anchor = "start" | "middle" | "end"

export interface Actor {
  id: ActorId
  level: Level
  /** where it stands on its level's floor, in ground units: x runs to the lower right, y to the lower left */
  g: Point
  /** screen position, worked out from g */
  pos: Point
  /** half the footprint along x and y, in screen pixels: where a cable disappears under it */
  foot: [number, number]
  name: string
  sub: string
  about: string
  /** label position relative to pos */
  label: [dx: number, dy: number, anchor: Anchor]
  /** what the camera must keep in view, relative to pos: [left, top, right, bottom] */
  box: [number, number, number, number]
  art: (slots?: PodLayout[NodeId]) => string
  /** the level this actor opens when clicked */
  opens?: Level
  /** set for Kubernetes-object cards: they render only while a lesson's events have them on screen */
  kind?: ResourceKind
  /** set for a node that joins the cluster during a lesson: it is drawn once the lesson's Pod layout lists it */
  joins?: boolean
}

const S = 4.6
const below = (dy: number): Actor["label"] => [0, dy, "middle"]

const memo = (markup: string) => () => markup

type Def = Omit<Actor, "pos">

/** How each level's ground maps onto the screen: where ground (0, 0) lands, and the scale. */
const GEOMETRY: Record<Level, { origin: Point; k: number }> = {
  cluster: { origin: [460, 230], k: 1 },
  node1: { origin: [500, 320], k: 0.78 },
  node2: { origin: [500, 320], k: 0.78 },
  pod: { origin: [500, 320], k: 0.8 },
  mesh: { origin: [500, 320], k: 0.78 },
  ambient: { origin: [500, 320], k: 0.78 },
  admission: { origin: [500, 320], k: 0.78 },
  falco: { origin: [500, 320], k: 0.78 },
  gpu: { origin: [500, 320], k: 0.78 },
}

export const toScreen = (level: Level, [x, y]: Point): Point => {
  const { origin, k } = GEOMETRY[level]
  const p = iso(x, y, 0, S * k)
  return [origin[0] + p[0], origin[1] + p[1]]
}

/** The SVG matrix that draws ground units flat on a level's floor, for text lying on it. */
export const floorMatrix = (level: Level, at: Point) => {
  const { k } = GEOMETRY[level]
  const [ox, oy] = toScreen(level, at)
  const c = Math.cos(Math.PI / 6) * S * k
  const h = 0.5 * S * k
  return `matrix(${c.toFixed(3)} ${h.toFixed(3)} ${(-c).toFixed(3)} ${h.toFixed(3)} ${ox.toFixed(1)} ${oy.toFixed(1)})`
}

const CLUSTER: Def[] = [
  {
    id: "resolver", level: "cluster", g: [80, 55], foot: [18, 18], name: "DNS resolver", sub: "198.51.100.53",
    about: "A public DNS server outside the cluster. It turns shop.example.com into an IP address.",
    label: below(42), box: [-80, -60, 80, 80], art: memo(rack(S * 0.85, "DNS")),
  },
  {
    id: "visitor", level: "cluster", g: [80, 31], foot: [23, 28], name: "Visitor", sub: "198.51.100.7",
    about: "Someone on the internet opening your shop in a browser.",
    label: below(46), box: [-80, -75, 80, 85], art: memo(laptop(S, "browser")),
  },
  {
    id: "lb", level: "cluster", g: [80, -8], foot: [28, 28], name: "Load balancer", sub: "203.0.113.50",
    about: "A cloud load balancer created by a Service of type LoadBalancer. It forwards traffic to a NodePort on healthy nodes.",
    label: below(50), box: [-80, -55, 80, 90], art: memo(loadBalancer(S)),
  },
  {
    id: "you", level: "cluster", g: [0, 50], foot: [23, 28], name: "You · kubectl", sub: "192.168.1.10",
    about: "Your laptop. kubectl only ever talks to the API server, using the address and certificate in your kubeconfig.",
    label: below(46), box: [-80, -75, 80, 85], art: memo(laptop(S)),
  },
  {
    id: "sched", level: "cluster", g: [-28, 0], foot: [20, 20], name: "Scheduler", sub: "10.0.0.10:10259",
    about: "Watches the API server for Pods with no node, picks the best node for each, and writes the choice back.",
    label: below(38), box: [-80, -50, 60, 70], art: memo(scheduler(S)),
  },
  {
    id: "kcm", level: "cluster", g: [-28, -24], foot: [20, 20], name: "Controller manager", sub: "10.0.0.10:10257",
    about: "Runs the built-in controllers: Deployment, ReplicaSet, Job, node lifecycle and more. Each one watches the API server and works to make reality match what was asked for.",
    label: [0, -62, "middle"], box: [-90, -85, 90, 40], art: memo(controllerManager(S)),
  },
  {
    id: "etcd", level: "cluster", g: [0, -24], foot: [21, 21], name: "etcd", sub: "10.0.0.10:2379",
    about: "The cluster's database: a key-value store that only the API server talks to.",
    label: [34, -14, "start"], box: [-40, -60, 160, 30], art: memo(etcd(S)),
  },
  {
    id: "api", level: "cluster", g: [0, 0], foot: [23, 23], name: "API server", sub: "10.0.0.10:6443",
    about: "The front door to the cluster. Every other component reads and writes cluster state through it, and only it talks to etcd.",
    label: below(48), box: [-80, -70, 80, 80], art: memo(apiServer(S)),
  },
  {
    id: "node1", level: "cluster", g: [36, 10], foot: [37, 37], name: "node-1", sub: "10.0.1.11 · Pods 10.244.1.0/24", opens: "node1",
    about: "A worker node: a machine that runs Pods. Click to look inside.",
    label: below(58), box: [-90, -60, 90, 95], art: (slots) => workerNode(S, slots),
  },
  {
    id: "node2", level: "cluster", g: [36, -26], foot: [37, 37], name: "node-2", sub: "10.0.1.12 · Pods 10.244.2.0/24", opens: "node2",
    about: "A worker node: a machine that runs Pods. Click to look inside.",
    label: [76, -2, "start"], box: [-90, -60, 250, 60], art: (slots) => workerNode(S, slots),
  },
  {
    id: "node3", level: "cluster", g: [36, -62], foot: [37, 37], name: "node-3", sub: "10.0.1.13 · Pods 10.244.3.0/24", joins: true,
    about: "A worker node that joins the cluster during the lesson: a new machine, with nothing on it at first.",
    label: [76, -2, "start"], box: [-90, -60, 250, 60], art: (slots) => workerNode(S, slots),
  },
  {
    id: "cloud", level: "cluster", g: [84, -62], foot: [18, 18], name: "Cloud API", sub: "AWS · eu-west-1",
    about: "The cloud provider's API: Auto Scaling groups and EC2. It makes and removes the machines; it knows nothing about Pods.",
    label: below(42), box: [-80, -60, 80, 80], art: memo(rack(S * 0.85, "AWS")),
  },
]

interface NodeInfo {
  level: "node1" | "node2"
  prefix: "n1" | "n2"
  ip: string
  podCidrGateway: string
  flannelIp: string
  podA: [name: string, ip: string]
  podB: [name: string, ip: string]
}

function nodeActors(n: NodeInfo): Def[] {
  const id = (part: string) => `${n.prefix}.${part}`
  const L = n.level
  return [
    {
      id: id("api"), level: L, g: [-90, -44], foot: [14, 14], name: "API server", sub: "10.0.0.10:6443",
      about: "The way out to the control plane. The kubelet watches it for Pods and reports their status back.",
      label: below(36), box: [-70, -60, 70, 60], art: memo(apiServer(S * 0.6)),
    },
    {
      id: id("kubelet"), level: L, g: [-24, -44], foot: [21, 16], name: "kubelet", sub: "the node agent",
      about: "Runs on every node. It watches for Pods assigned here and makes them real through the container runtime.",
      label: below(36), box: [-70, -50, 70, 60], art: memo(chip(S, 9, 7, 3, "kubelet")),
    },
    {
      id: id("containerd"), level: L, g: [16, -44], foot: [25, 16], name: "containerd", sub: "container runtime · CRI",
      about: "Pulls images and starts containers when the kubelet asks over the CRI gRPC API. Calls the CNI plugin to wire up networking.",
      label: below(36), box: [-80, -50, 80, 60], art: memo(chip(S, 11, 7, 3, "containerd")),
    },
    {
      id: id("eth0"), level: L, g: [-60, 8], foot: [14, 12], name: "eth0", sub: `${n.ip} · the node's NIC`,
      about: "The node's real network card. Everything from outside the node arrives here.",
      label: below(30), box: [-80, -40, 80, 55], art: memo(chip(S, 6, 5, 1.6, "eth0")),
    },
    {
      id: id("iptables"), level: L, g: [-24, 8], foot: [21, 14], name: "iptables", sub: "rules written by kube-proxy",
      about: "Linux packet-filter rules. kube-proxy writes them; the kernel applies them to every packet, rewriting Service addresses to Pod addresses.",
      label: below(34), box: [-80, -45, 80, 60], art: memo(chip(S, 9, 6, 2.2, "iptables")),
    },
    {
      id: id("flannel"), level: L, g: [-24, 48], foot: [21, 14], name: "flannel.1", sub: `VXLAN device · ${n.flannelIp}`,
      about: "A virtual device from the flannel CNI plugin. It wraps packets for other nodes' Pods in UDP and unwraps the ones that arrive.",
      label: below(34), box: [-80, -45, 80, 60], art: memo(chip(S, 9, 6, 2.2, "flannel.1")),
    },
    {
      id: id("cni0"), level: L, g: [16, 8], foot: [35, 12], name: "cni0", sub: `bridge · ${n.podCidrGateway}`,
      about: "A Linux bridge, a virtual switch. Every Pod on this node is plugged into it through a veth pair.",
      label: below(30), box: [-90, -40, 90, 55], art: memo(chip(S, 15, 5, 1.4, "cni0 bridge")),
    },
    {
      id: id("podA"), level: L, g: [52, -20], foot: [20, 20], name: n.podA[0], sub: n.podA[1], opens: n.level === "node2" ? "pod" : undefined,
      about: n.level === "node2" ? "A Pod with its own network namespace. Click to look inside." : "A Pod with its own network namespace and IP.",
      label: below(46), box: [-90, -70, 90, 75], art: memo(pod(S * 0.85)),
    },
    {
      id: id("podB"), level: L, g: [52, 36], foot: [20, 20], name: n.podB[0], sub: n.podB[1],
      about: "Another Pod on the same node, plugged into the same bridge.",
      label: below(46), box: [-90, -70, 90, 75], art: memo(pod(S * 0.85)),
    },
  ]
}

const POD: Def[] = [
  {
    id: "p.veth", level: "pod", g: [-44, 24], foot: [16, 12], name: "veth3b1c", sub: "node side, on cni0",
    about: "One end of a virtual cable. This end sits on the node's bridge; the other end is the Pod's eth0.",
    label: below(30), box: [-80, -40, 80, 55], art: memo(chip(S, 7, 5, 1.6, "veth")),
  },
  {
    id: "p.eth0", level: "pod", g: [0, 24], foot: [14, 12], name: "eth0", sub: "10.244.2.17",
    about: "The Pod's only network interface, inside its own network namespace.",
    label: below(30), box: [-80, -40, 80, 55], art: memo(chip(S, 6, 5, 1.6, "eth0", "hot")),
  },
  {
    id: "p.pause", level: "pod", g: [0, -12], foot: [14, 14], name: "pause", sub: "holds the namespaces",
    about: "A tiny container that does nothing but sleep. It owns the Pod's network namespace, so app containers can restart without losing the IP.",
    label: below(36), box: [-70, -50, 70, 60], art: memo(chip(S, 6, 6, 3, "pause")),
  },
  {
    id: "p.app", level: "pod", g: [40, -12], foot: [21, 18], name: "web", sub: "your app · :8080",
    about: "Your container. It shares the network namespace with pause, so it sees eth0 and localhost as its own.",
    label: below(40), box: [-80, -80, 80, 60], art: memo(chip(S, 9, 8, 6, "web :8080", "hot")),
  },
]

/** Two Pods with a proxy beside each app, and the control plane that configures both proxies. */
const MESH: Def[] = [
  {
    id: "m.istiod", level: "mesh", g: [0, -54], foot: [23, 18], name: "istiod", sub: "the control plane · :15012",
    about: "Istio's control plane. It adds the proxies to new Pods, signs their certificates and pushes their configuration. Requests between apps never pass through it.",
    label: [52, -12, "start"], box: [-60, -60, 220, 40], art: memo(chip(S, 10, 8, 5, "istiod")),
  },
  {
    id: "m.web", level: "mesh", g: [-60, 16], foot: [18, 16], name: "web", sub: "the app",
    about: "The web container. It makes a plain HTTP call to api and knows nothing about the mesh.",
    label: below(34), box: [-60, -55, 60, 60], art: memo(chip(S, 8, 7, 5, "web", "hot")),
  },
  {
    id: "m.wipt", level: "mesh", g: [-60, -16], foot: [18, 14], name: "iptables", sub: "in the Pod's namespace",
    about: "Rules in the Pod's own network namespace. They send every TCP connection the app opens to the proxy instead.",
    label: [0, -48, "middle"], box: [-70, -75, 70, 30], art: memo(chip(S, 8, 6, 2.2, "iptables")),
  },
  {
    id: "m.wproxy", level: "mesh", g: [-24, -16], foot: [23, 16], name: "istio-proxy", sub: "Envoy · out :15001",
    about: "The sidecar: an Envoy proxy in the same Pod as web. It decides where each call goes and encrypts it.",
    label: [0, -60, "middle"], box: [-70, -85, 70, 30], art: memo(chip(S, 10, 7, 4, "istio-proxy")),
  },
  {
    id: "m.weth0", level: "mesh", g: [-24, 16], foot: [14, 12], name: "eth0", sub: "10.244.1.40",
    about: "The web Pod's network interface. Only encrypted traffic leaves through it.",
    label: below(30), box: [-60, -35, 60, 55], art: memo(chip(S, 6, 5, 1.6, "eth0")),
  },
  {
    id: "m.aeth0", level: "mesh", g: [24, 16], foot: [14, 12], name: "eth0", sub: "10.244.2.40",
    about: "The api Pod's network interface.",
    label: below(30), box: [-60, -35, 60, 55], art: memo(chip(S, 6, 5, 1.6, "eth0")),
  },
  {
    id: "m.aipt", level: "mesh", g: [24, -16], foot: [18, 14], name: "iptables", sub: "in the Pod's namespace",
    about: "Rules in the Pod's own network namespace. They send every TCP connection that arrives to the proxy instead.",
    label: [0, -48, "middle"], box: [-70, -75, 70, 30], art: memo(chip(S, 8, 6, 2.2, "iptables")),
  },
  {
    id: "m.aproxy", level: "mesh", g: [60, -16], foot: [23, 16], name: "istio-proxy", sub: "Envoy · in :15006",
    about: "The sidecar in the api Pod. It checks who is calling and whether they may, then hands the request to api.",
    label: [0, -60, "middle"], box: [-70, -85, 70, 30], art: memo(chip(S, 10, 7, 4, "istio-proxy")),
  },
  {
    id: "m.api", level: "mesh", g: [60, 16], foot: [18, 16], name: "api", sub: "the app · :8080",
    about: "The api container. It gets a plain HTTP request from its own proxy.",
    label: below(34), box: [-60, -55, 60, 60], art: memo(chip(S, 8, 7, 5, "api", "hot")),
  },
  {
    id: "m.busybox", level: "mesh", g: [-44, 54], foot: [18, 18], name: "busybox-…-c4t2m", sub: "10.244.1.30",
    about: "A Pod that has no business calling api.",
    label: below(40), box: [-80, -60, 80, 70], art: memo(pod(S * 0.75)),
  },
  {
    id: "m.v1b", level: "mesh", g: [20, 54], foot: [18, 18], name: "api-v1-…-m9x2t", sub: "10.244.1.42",
    about: "Another api Pod, the same version, with a sidecar of its own.",
    label: below(40), box: [-80, -60, 80, 70], art: memo(pod(S * 0.75)),
  },
  {
    id: "m.v2", level: "mesh", g: [62, 54], foot: [18, 18], name: "api-v2-…-q7zr5", sub: "10.244.2.43",
    about: "The new version of api, with a sidecar of its own.",
    label: below(40), box: [-80, -60, 80, 70], art: memo(pod(S * 0.75)),
  },
]

/** The same two Pods in ambient mode: no sidecars, one ztunnel per node and an optional waypoint. */
const AMBIENT: Def[] = [
  {
    id: "a.cni", level: "ambient", g: [-54, -22], foot: [18, 14], name: "istio-cni", sub: "one per node",
    about: "A DaemonSet that sets up the redirect inside each Pod's network namespace, from the node.",
    label: [0, -48, "middle"], box: [-70, -75, 70, 30], art: memo(chip(S, 8, 6, 2.2, "istio-cni")),
  },
  {
    id: "a.web", level: "ambient", g: [-54, 10], foot: [20, 20], name: "web-…-mv5tz", sub: "one container",
    about: "The web Pod, with nothing added to it.",
    label: below(44), box: [-80, -65, 80, 75], art: memo(pod(S * 0.85)),
  },
  {
    id: "a.zt1", level: "ambient", g: [-22, 10], foot: [20, 16], name: "ztunnel", sub: "one per node",
    about: "A small proxy shared by every Pod on the node. It does encryption, identity and connection-level rules, and doesn't read HTTP.",
    label: below(38), box: [-70, -50, 70, 65], art: memo(chip(S, 9, 7, 3, "ztunnel", "hot")),
  },
  {
    id: "a.waypoint", level: "ambient", g: [0, -44], foot: [23, 16], name: "waypoint", sub: "Envoy · optional",
    about: "An Envoy proxy that runs as its own Deployment. Add one for a Service or a namespace that needs HTTP routing, retries or rules.",
    label: [0, -60, "middle"], box: [-80, -85, 80, 30], art: memo(chip(S, 10, 7, 4, "waypoint")),
  },
  {
    id: "a.zt2", level: "ambient", g: [22, 10], foot: [20, 16], name: "ztunnel", sub: "one per node",
    about: "The proxy of the node api runs on. It ends the encrypted tunnel and hands the bytes to api.",
    label: below(38), box: [-70, -50, 70, 65], art: memo(chip(S, 9, 7, 3, "ztunnel", "hot")),
  },
  {
    id: "a.api", level: "ambient", g: [54, 10], foot: [20, 20], name: "api-v1-…-d4k8w", sub: "one container",
    about: "The api Pod, with nothing added to it.",
    label: below(44), box: [-80, -65, 80, 75], art: memo(pod(S * 0.85)),
  },
]

/** A write's way through the API server, and the admission webhook it can stop at. */
const ADMISSION: Def[] = [
  {
    id: "g.client", level: "admission", g: [-116, 14], foot: [18, 22], name: "You · kubectl", sub: "or any other client",
    about: "Whoever sends the request: kubectl, a controller, a CI job. They all take the same road.",
    label: below(40), box: [-70, -60, 70, 70], art: memo(laptop(S * 0.8)),
  },
  {
    id: "g.authn", level: "admission", g: [-60, 14], foot: [18, 16], name: "Authentication", sub: "who is it?",
    about: "Works out who sent the request, from a certificate or a token.",
    label: below(34), box: [-60, -45, 60, 60], art: memo(chip(S, 8, 7, 3, "authn")),
  },
  {
    id: "g.authz", level: "admission", g: [-32, 14], foot: [18, 16], name: "Authorization", sub: "may they?",
    about: "Asks RBAC whether this user may do this verb on this resource. It doesn't look inside the object.",
    label: below(34), box: [-60, -45, 60, 60], art: memo(chip(S, 8, 7, 3, "authz")),
  },
  {
    id: "g.mutate", level: "admission", g: [-4, 14], foot: [18, 16], name: "Mutating", sub: "change it?",
    about: "Mutating admission. Calls everything registered to change this kind of object, and applies the patches that come back.",
    label: below(34), box: [-70, -45, 70, 60], art: memo(chip(S, 8, 7, 4, "mutate", "hot")),
  },
  {
    id: "g.schema", level: "admission", g: [24, 14], foot: [18, 16], name: "Schema", sub: "is it legal?",
    about: "Checks the fields against the resource's definition: types, required values, ranges.",
    label: below(34), box: [-60, -45, 60, 60], art: memo(chip(S, 8, 7, 3, "schema")),
  },
  {
    id: "g.validate", level: "admission", g: [52, 14], foot: [18, 16], name: "Validating", sub: "accept it?",
    about: "Validating admission. Calls everything registered to check this kind of object. It can only say yes or no, and one no is enough.",
    label: below(34), box: [-70, -45, 70, 60], art: memo(chip(S, 8, 7, 4, "validate", "hot")),
  },
  {
    id: "g.etcd", level: "admission", g: [92, 14], foot: [18, 18], name: "etcd", sub: "saved",
    about: "The cluster's database. Until an object is here, no controller knows about it.",
    label: below(36), box: [-60, -50, 60, 60], art: memo(etcd(S * 0.85)),
  },
  {
    id: "g.kyverno", level: "admission", g: [16, -30], foot: [23, 18], name: "Admission controller", sub: "HTTPS :9443",
    about: "Kyverno's webhook server. The API server sends it an object and waits for an answer.",
    label: [0, -56, "middle"], box: [-80, -80, 80, 40], art: memo(chip(S, 10, 8, 4, "webhook")),
  },
  {
    id: "g.engine", level: "admission", g: [52, -30], foot: [20, 16], name: "CEL engine", sub: "your policies",
    about: "Runs the expressions in your policies, compiled ahead of time, on the object it's given.",
    label: [0, -50, "middle"], box: [-70, -75, 70, 40], art: memo(chip(S, 9, 7, 3, "CEL")),
  },
]

/** node-2 as Falco watches it: a Pod and the kernel under it, Falco's parts, and where its alerts go. */
const FALCO: Def[] = [
  {
    id: "f.web", level: "falco", g: [-88, -28], foot: [20, 20], name: "web-…-x2kqp", sub: "10.244.2.17",
    about: "An ordinary web Pod. Its processes run on the node's kernel, so every program they start goes through that kernel.",
    label: [-38, -8, "end"], box: [-140, -65, 60, 45], art: memo(pod(S * 0.85)),
  },
  {
    id: "f.containerd", level: "falco", g: [-44, -28], foot: [21, 14], name: "containerd", sub: "container runtime",
    about: "The container runtime. Falco asks it which image and which Pod a container ID belongs to.",
    label: [0, -42, "middle"], box: [-80, -70, 80, 30], art: memo(chip(S, 9, 6, 2.6, "containerd")),
  },
  {
    id: "f.sys", level: "falco", g: [-88, 40], foot: [21, 14], name: "Tracepoints", sub: "hooks to attach to",
    about: "Places in the Linux kernel made for tools to attach to. One of them, sched_process_exec, fires each time a process has started a program.",
    label: below(34), box: [-80, -40, 80, 60], art: memo(chip(S, 9, 6, 2, "tracepoint")),
  },
  {
    id: "f.probe", level: "falco", g: [-44, 40], foot: [21, 14], name: "eBPF probe", sub: "Falco's own code",
    about: "Small programs Falco loaded into the kernel. They copy the details of an event and never change or stop it.",
    label: below(34), box: [-80, -40, 80, 60], art: memo(chip(S, 9, 6, 2.6, "eBPF probe", "hot")),
  },
  {
    id: "f.ring", level: "falco", g: [0, 40], foot: [21, 14], name: "Ring buffers", sub: "8 MB per 2 CPUs",
    about: "Memory shared between the kernel and Falco. The probe writes events at one end and Falco reads them at the other.",
    label: below(34), box: [-80, -40, 80, 60], art: memo(chip(S, 9, 6, 2, "ring buffer")),
  },
  {
    id: "f.libs", level: "falco", g: [0, 4], foot: [18, 14], name: "libs", sub: "process table",
    about: "libscap and libsinsp. They read raw events and keep a table of the node's processes, so each event comes with its parent, user and terminal.",
    label: below(32), box: [-70, -40, 70, 55], art: memo(chip(S, 8, 6, 2.6, "libs")),
  },
  {
    id: "f.meta", level: "falco", g: [0, -28], foot: [18, 14], name: "container plugin", sub: "container ID → Pod",
    about: "A Falco plugin that keeps a cache of the node's containers: name, image, Pod and namespace.",
    label: [0, -42, "middle"], box: [-70, -70, 70, 30], art: memo(chip(S, 8, 6, 2.6, "plugin")),
  },
  {
    id: "f.rules", level: "falco", g: [40, 4], foot: [21, 16], name: "Rule engine", sub: "25 default rules",
    about: "Compares each event with the conditions of the loaded rules. A match becomes an alert.",
    label: [36, 0, "start"], box: [-40, -45, 170, 40], art: memo(chip(S, 9, 7, 4, "rules", "hot")),
  },
  {
    id: "f.out", level: "falco", g: [40, -28], foot: [18, 14], name: "Outputs", sub: "stdout · syslog · HTTP",
    about: "Where alerts leave Falco. Each one goes to every output that is turned on.",
    label: [0, -42, "middle"], box: [-70, -70, 70, 30], art: memo(chip(S, 8, 6, 2.6, "outputs")),
  },
  {
    id: "f.sidekick", level: "falco", g: [92, -28], foot: [23, 16], name: "Falcosidekick", sub: "Service :2801",
    about: "A small Deployment that receives every node's alerts and forwards them to chat, paging, storage or a response engine, each with its own minimum priority.",
    label: below(36), box: [-80, -45, 80, 60], art: memo(chip(S, 10, 7, 4, "sidekick", "hot")),
  },
  {
    id: "f.slack", level: "falco", g: [132, -28], foot: [18, 14], name: "Slack", sub: "hooks.slack.com",
    about: "Where people see the alert. It could be PagerDuty, Alertmanager, Loki or an email just as well.",
    label: below(32), box: [-70, -40, 70, 55], art: memo(chip(S, 8, 6, 2.6, "Slack")),
  },
  {
    id: "f.talon", level: "falco", g: [92, 14], foot: [18, 14], name: "Falco Talon", sub: "response engine · :2803",
    about: "Matches alerts with actions, such as labeling a Pod, cutting its network or deleting it. Falco itself never acts.",
    label: below(32), box: [-80, -40, 80, 55], art: memo(chip(S, 8, 6, 2.6, "Talon")),
  },
]

/** node-2 with its GPU: the kubelet and the device plugin it talks to, the runtime, and the card under the driver. */
const GPU: Def[] = [
  {
    id: "gp.api", level: "gpu", g: [-90, -44], foot: [14, 14], name: "API server", sub: "10.0.0.10:6443",
    about: "The way out to the control plane. The kubelet reports the node's GPUs to it and watches it for Pods.",
    label: below(36), box: [-70, -60, 70, 60], art: memo(apiServer(S * 0.6)),
  },
  {
    id: "gp.kubelet", level: "gpu", g: [-30, -44], foot: [21, 16], name: "kubelet", sub: "device manager · kubelet.sock",
    about: "The node agent. Its device manager serves the Registration socket, keeps the list of devices each plugin reports, and picks a device for each container that asks for one.",
    label: below(36), box: [-80, -50, 80, 60], art: memo(chip(S, 9, 7, 3, "kubelet")),
  },
  {
    id: "gp.containerd", level: "gpu", g: [16, -44], foot: [25, 16], name: "containerd", sub: "CRI · reads CDI specs",
    about: "The container runtime. Given a CDI device name, it looks the name up in the spec files and adds what they list to the container.",
    label: below(36), box: [-80, -50, 80, 60], art: memo(chip(S, 11, 7, 3, "containerd")),
  },
  {
    id: "gp.llm", level: "gpu", g: [56, -10], foot: [20, 20], name: "llm", sub: "nvidia.com/gpu: 1",
    about: "A Pod that asked for one GPU. Its container sees /dev/nvidia0 and the driver's libraries, and nothing else of the node's hardware.",
    label: [36, -4, "start"], box: [-60, -65, 170, 45], art: memo(pod(S * 0.85)),
  },
  {
    id: "gp.plugin", level: "gpu", g: [-30, 6], foot: [21, 16], name: "nvidia-device-plugin", sub: "a Pod · gRPC on its own socket",
    about: "NVIDIA's device plugin, one Pod per GPU node. It finds the GPUs through the driver, reports them to the kubelet and says how to hand one to a container.",
    label: below(36), box: [-90, -50, 90, 60], art: memo(chip(S, 9, 7, 4, "plugin", "hot")),
  },
  {
    id: "gp.cdi", level: "gpu", g: [16, 6], foot: [16, 12], name: "CDI spec", sub: "/var/run/cdi/*.json",
    about: "A Container Device Interface file: for each device name, the device nodes, libraries and environment a container needs to use it.",
    label: below(30), box: [-80, -40, 80, 55], art: memo(chip(S, 7, 5, 1.6, "CDI")),
  },
  {
    id: "gp.driver", level: "gpu", g: [-30, 38], foot: [21, 14], name: "NVIDIA driver", sub: "kernel modules · 580.95",
    about: "The kernel modules nvidia, nvidia-uvm and nvidia-modeset, and the user-space libraries that go with them. Nothing can use the GPU without them.",
    label: below(34), box: [-80, -40, 80, 60], art: memo(chip(S, 9, 6, 2.2, "nvidia.ko")),
  },
  {
    id: "gp.gpu", level: "gpu", g: [16, 38], foot: [25, 16], name: "NVIDIA L4", sub: "/dev/nvidia0 · 24 GB",
    about: "The GPU itself, a PCIe card. Linux shows it as the device file /dev/nvidia0 once the driver is loaded.",
    label: below(36), box: [-80, -45, 80, 60], art: memo(chip(S, 11, 7, 2, "L4", "hot")),
  },
]

const place = (d: Def): Actor => ({ ...d, pos: toScreen(d.level, d.g) })

export const ACTORS: Actor[] = [
  ...CLUSTER,
  ...nodeActors({ level: "node1", prefix: "n1", ip: "10.0.1.11", podCidrGateway: "10.244.1.1", flannelIp: "10.244.1.0", podA: ["web-…-kq9tw", "10.244.1.12"], podB: ["coredns-…-7fx2q", "10.244.1.3"] }),
  ...nodeActors({ level: "node2", prefix: "n2", ip: "10.0.1.12", podCidrGateway: "10.244.2.1", flannelIp: "10.244.2.0", podA: ["web-…-x2kqp", "10.244.2.17"], podB: ["web-…-p8m4z", "10.244.2.18"] }),
  ...POD,
  ...MESH,
  ...AMBIENT,
  ...ADMISSION,
  ...FALCO,
  ...GPU,
].map(place)

const BADGE: Record<ResourceKind, string> = {
  deployment: "DEP", replicaset: "RS", service: "SVC", hpa: "HPA", statefulset: "STS",
  job: "JOB", cronjob: "CJ", configmap: "CM", secret: "SEC", ingress: "ING",
  pvc: "PVC", pv: "PV", daemonset: "DS", policy: "POL", policyreport: "REP", networkpolicy: "NP", csr: "CSR",
}

const resource = (id: string, kind: ResourceKind, name: string, sub: string, about: string, g: Point, label?: Actor["label"]): Actor =>
  place({
    id, level: "cluster", kind, g, foot: [23, 16], name, sub, about, label: label ?? below(42), box: [-80, -28, 80, 50],
    art: memo(resourceCard(S * 0.85, BADGE[kind])),
  })

/** Kubernetes objects, standing on the ground around the cluster. They only draw while a lesson's
 *  events put them on screen, and no lesson shows two groups at once, so groups may share a spot. */
const RESOURCES: Actor[] = [
  // workloads: a row behind the control plane, on the left
  resource("web-hpa", "hpa", "HPA web", "target 60% CPU", "The Horizontal Pod Autoscaler: reads Pod metrics, does one divide, and patches the Deployment's replica count.", [-66, 24]),
  resource("web-deploy", "deployment", "Deployment web", "replicas 3", "The record you applied: desired state in etcd. It owns ReplicaSets, never Pods directly.", [-66, -12]),
  resource("web-rs", "replicaset", "ReplicaSet …d8b4", "3 Pods", "Created by the Deployment for one Pod-template hash. It counts matching Pods and creates or deletes them until the count is right.", [-66, -54]),
  resource("web-rs2", "replicaset", "ReplicaSet …c9f6", "1 Pod", "The ReplicaSet for the new template hash. During a rollout it scales up while the old one scales down.", [-98, -12]),
  // traffic: in front of the nodes
  resource("web-svc", "service", "Service web", "10.96.120.15:80", "A stable virtual IP and DNS name. Its EndpointSlices list the Pod IPs that currently answer.", [44, 56]),
  resource("shop-ing", "ingress", "Ingress shop", "shop.example.com", "Layer-7 routing rules: hosts and paths to Services, served by an ingress controller behind a load balancer.", [44, 84]),
  // everything else: a row behind node-2, one lesson at a time
  resource("gpu-plugin-ds", "daemonset", "nvidia-device-plugin", "DaemonSet · gpu-operator", "Runs the device plugin on every node labelled as having an NVIDIA GPU, and on no other node.", [28, -68]),
  resource("falco-ds", "daemonset", "DaemonSet falco", "ns falco", "Runs one Falco Pod on every node it may run on, and adds one when a node joins.", [28, -68]),
  resource("db-sts", "statefulset", "StatefulSet db", "replicas 3", "Like a Deployment, but with stable identities: db-0, db-1, db-2 start one at a time and keep their volumes.", [28, -68]),
  resource("uploads-pvc", "pvc", "PVC uploads", "10Gi · fast-nvme", "A PersistentVolumeClaim: the app's ask for storage. The provisioner fulfils it with a volume that outlives the Pod.", [28, -68]),
  resource("uploads-pv", "pv", "PV pvc-3f8a91c2…", "10 Gi · nvme", "The PersistentVolume the driver carved out for the claim: a real disk, attachable to one node at a time.", [60, -68], [0, -52, "middle"]),
  resource("app-cm", "configmap", "ConfigMap app-config", "rev 2", "Key-value configuration stored in the API and projected into Pods as files or env vars.", [28, -68]),
  resource("app-secret", "secret", "Secret api-key", "base64", "Sensitive bytes in the API, delivered to Pods only through mounted or env sources.", [60, -68], [0, -52, "middle"]),
  resource("backup-cj", "cronjob", "CronJob backup", "0 2 * * *", "A schedule in the API. At each tick its controller creates a Job object.", [28, -68]),
  resource("backup-job", "job", "Job backup-28471", "completions 1/1", "Runs Pods until the completions count is reached, retrying failures up to backoffLimit.", [60, -68], [0, -52, "middle"]),
  resource("kyv-vpol", "policy", "disallow-latest-tag", "ValidatingPolicy", "A ValidatingPolicy: an expression that must be true for every Pod, and for everything that makes Pods.", [28, -68]),
  resource("kyv-mpol", "policy", "default-seccomp", "MutatingPolicy", "A MutatingPolicy: sets the seccomp profile on Pods on their way in.", [60, -68], [0, -52, "middle"]),
  resource("kyv-gpol", "policy", "default-deny", "GeneratingPolicy", "A GeneratingPolicy: puts a NetworkPolicy in every new namespace.", [-4, -68], [0, -52, "middle"]),
  resource("kyv-report", "policyreport", "PolicyReport tools", "results", "What the policies say about one object as it is now. Kyverno writes it; you read it with kubectl.", [28, -100], [0, -52, "middle"]),
  resource("kyv-netpol", "networkpolicy", "NetworkPolicy", "team-a/default-deny", "Created by Kyverno, not by you: blocks incoming traffic to every Pod in team-a until something allows it.", [-4, -100], [0, -52, "middle"]),
  resource("node3-csr", "csr", "CSR csr-7bq4z", "node-3's client certificate", "A CertificateSigningRequest: the kubelet's public key and the name it wants, waiting for a controller to approve and sign it.", [-4, -68], [0, -52, "middle"]),
  resource("nightly-job", "job", "Job nightly-report", "made by CronJob", "A Job stamped from a CronJob template on one schedule tick. Its name carries the tick's epoch-minutes.", [28, -100]),
]

const byId = new Map([...ACTORS, ...RESOURCES].map((a) => [a.id, a]))
export const actorById = (id: ActorId) => byId.get(id)
export const actorsAt = (level: Level) => ACTORS.filter((a) => a.level === level)

/* ── cables ─────────────────────────────────────────────────
   Every cable runs along the floor's two axes, so it bends at right angles in ground space.
   Shared stretches (a bus to both nodes) are drawn once per cable and simply overlap. */

export interface Cable { a: ActorId; b: ActorId; route: Point[] }

const cable = (a: ActorId, b: ActorId, ...route: Point[]): Cable => ({ a, b, route })

const nodeCables = (p: string): Cable[] => {
  const id = (s: string) => `${p}.${s}`
  return [
    cable(id("api"), id("kubelet"), [-90, -44], [-24, -44]),
    cable(id("kubelet"), id("containerd"), [-24, -44], [16, -44]),
    cable(id("containerd"), id("podA"), [16, -44], [52, -44], [52, -20]),
    cable(id("containerd"), id("cni0"), [16, -44], [16, 8]),
    cable(id("eth0"), id("iptables"), [-60, 8], [-24, 8]),
    cable(id("iptables"), id("flannel"), [-24, 8], [-24, 48]),
    cable(id("eth0"), id("flannel"), [-60, 8], [-60, 48], [-24, 48]),
    cable(id("iptables"), id("cni0"), [-24, 8], [16, 8]),
    cable(id("flannel"), id("cni0"), [-24, 48], [16, 48], [16, 8]),
    cable(id("cni0"), id("podA"), [16, 8], [34, 8], [34, -20], [52, -20]),
    cable(id("cni0"), id("podB"), [16, 8], [34, 8], [34, 36], [52, 36]),
  ]
}

export const CABLES: Record<Level, Cable[]> = {
  cluster: [
    cable("you", "api", [0, 50], [0, 0]),
    cable("api", "etcd", [0, 0], [0, -24]),
    cable("api", "sched", [0, 0], [-28, 0]),
    cable("api", "kcm", [0, 0], [-14, 0], [-14, -24], [-28, -24]),
    cable("api", "node1", [0, 0], [23, 0], [23, 10], [36, 10]),
    cable("api", "node2", [0, 0], [23, 0], [23, -26], [36, -26]),
    cable("node1", "node2", [36, 10], [36, -26]),
    cable("api", "node3", [0, 0], [23, 0], [23, -62], [36, -62]),
    cable("node2", "node3", [36, -26], [36, -62]),
    cable("cloud", "node3", [84, -62], [36, -62]),
    cable("lb", "node1", [80, -8], [54, -8], [54, 10], [36, 10]),
    cable("lb", "node2", [80, -8], [54, -8], [54, -26], [36, -26]),
    cable("visitor", "lb", [80, 31], [80, -8]),
    cable("visitor", "resolver", [80, 31], [80, 55]),
  ],
  node1: nodeCables("n1"),
  node2: nodeCables("n2"),
  pod: [
    cable("p.veth", "p.eth0", [-44, 24], [0, 24]),
    cable("p.eth0", "p.pause", [0, 24], [0, -12]),
    cable("p.pause", "p.app", [0, -12], [40, -12]),
    cable("p.eth0", "p.app", [0, 24], [40, 24], [40, -12]),
  ],
  mesh: [
    cable("m.istiod", "m.wproxy", [0, -54], [-24, -54], [-24, -16]),
    cable("m.istiod", "m.aproxy", [0, -54], [60, -54], [60, -16]),
    cable("m.web", "m.wipt", [-60, 16], [-60, -16]),
    cable("m.wipt", "m.wproxy", [-60, -16], [-24, -16]),
    cable("m.wproxy", "m.weth0", [-24, -16], [-24, 16]),
    cable("m.weth0", "m.aeth0", [-24, 16], [24, 16]),
    cable("m.aeth0", "m.aipt", [24, 16], [24, -16]),
    cable("m.aipt", "m.aproxy", [24, -16], [60, -16]),
    cable("m.aproxy", "m.api", [60, -16], [60, 16]),
    cable("m.weth0", "m.v1b", [-24, 16], [0, 16], [0, 38], [20, 38], [20, 54]),
    cable("m.weth0", "m.v2", [-24, 16], [0, 16], [0, 38], [62, 38], [62, 54]),
    cable("m.busybox", "m.aeth0", [-44, 54], [-44, 38], [0, 38], [0, 16], [24, 16]),
  ],
  ambient: [
    cable("a.cni", "a.web", [-54, -22], [-54, 10]),
    cable("a.web", "a.zt1", [-54, 10], [-22, 10]),
    cable("a.zt1", "a.zt2", [-22, 10], [22, 10]),
    cable("a.zt2", "a.api", [22, 10], [54, 10]),
    cable("a.zt1", "a.waypoint", [-22, 10], [-22, -44], [0, -44]),
    cable("a.waypoint", "a.zt2", [0, -44], [22, -44], [22, 10]),
  ],
  admission: [
    cable("g.client", "g.authn", [-116, 14], [-60, 14]),
    cable("g.authn", "g.authz", [-60, 14], [-32, 14]),
    cable("g.authz", "g.mutate", [-32, 14], [-4, 14]),
    cable("g.mutate", "g.schema", [-4, 14], [24, 14]),
    cable("g.schema", "g.validate", [24, 14], [52, 14]),
    cable("g.validate", "g.etcd", [52, 14], [92, 14]),
    cable("g.mutate", "g.kyverno", [-4, 14], [-4, -30], [16, -30]),
    cable("g.validate", "g.kyverno", [52, 14], [52, -9], [16, -9], [16, -30]),
    cable("g.kyverno", "g.engine", [16, -30], [52, -30]),
  ],
  gpu: [
    cable("gp.api", "gp.kubelet", [-90, -44], [-30, -44]),
    cable("gp.kubelet", "gp.containerd", [-30, -44], [16, -44]),
    cable("gp.kubelet", "gp.plugin", [-30, -44], [-30, 6]),
    cable("gp.containerd", "gp.cdi", [16, -44], [16, 6]),
    cable("gp.containerd", "gp.llm", [16, -44], [56, -44], [56, -10]),
    cable("gp.plugin", "gp.cdi", [-30, 6], [16, 6]),
    cable("gp.plugin", "gp.driver", [-30, 6], [-30, 38]),
    cable("gp.driver", "gp.gpu", [-30, 38], [16, 38]),
    cable("gp.llm", "gp.gpu", [56, -10], [56, 38], [16, 38]),
  ],
  falco: [
    cable("f.web", "f.sys", [-88, -28], [-88, 40]),
    cable("f.sys", "f.probe", [-88, 40], [-44, 40]),
    cable("f.probe", "f.ring", [-44, 40], [0, 40]),
    cable("f.ring", "f.libs", [0, 40], [0, 4]),
    cable("f.containerd", "f.web", [-44, -28], [-88, -28]),
    cable("f.containerd", "f.meta", [-44, -28], [0, -28]),
    cable("f.meta", "f.libs", [0, -28], [0, 4]),
    cable("f.libs", "f.rules", [0, 4], [40, 4]),
    cable("f.rules", "f.out", [40, 4], [40, -28]),
    cable("f.out", "f.sidekick", [40, -28], [92, -28]),
    cable("f.sidekick", "f.slack", [92, -28], [132, -28]),
    cable("f.sidekick", "f.talon", [92, -28], [92, 14]),
  ],
}

/** Where a bus splits: drawn as a small ring. */
export const JOINTS: Record<Level, Point[]> = {
  cluster: [[-14, 0], [23, 0], [54, -8]],
  node1: [[34, 8]],
  node2: [[34, 8]],
  pod: [],
  mesh: [[0, 16], [0, 38], [20, 38]],
  ambient: [],
  admission: [],
  falco: [],
  gpu: [],
}

/** The plate each level stands on, in ground units, and what is written on it (one line per \\n). */
export const FLOORS: Record<Level, { x0: number; x1: number; y0: number; y1: number; text: string; at: Point }> = {
  cluster: { x0: -51, x1: 58, y0: -43, y1: 30, text: "cluster", at: [2, 27.6] },
  node1: { x0: -70, x1: 66, y0: -58, y1: 60, text: "node-1 · 10.0.1.11", at: [8, 57] },
  node2: { x0: -70, x1: 66, y0: -58, y1: 60, text: "node-2 · 10.0.1.12", at: [8, 57] },
  pod: { x0: -14, x1: 54, y0: -34, y1: 38, text: "network namespace\nshared by pause and web", at: [-11, -30.8] },
  mesh: { x0: -80, x1: 80, y0: -68, y1: 70, text: "the mesh · namespace default", at: [-22, 66.6] },
  ambient: { x0: -78, x1: 78, y0: -58, y1: 46, text: "the mesh · namespace default", at: [-74, 42.6] },
  admission: { x0: -84, x1: 106, y0: -55, y1: 44, text: "cluster", at: [84, 40.6] },
  falco: { x0: -110, x1: 66, y0: -52, y1: 66, text: "node-2 · 10.0.1.12", at: [18, 62.6] },
  gpu: { x0: -70, x1: 76, y0: -58, y1: 68, text: "node-2 · 10.0.1.12", at: [36, 64.6] },
}

export type Floor = (typeof FLOORS)[Level]

/** Actors that belong together, standing on a plate of their own inside their level's floor. */
export interface Group {
  id: ActorId
  level: Level
  name: string
  about: string
  members: ActorId[]
  /** the member the others reach the rest of the cluster through */
  hub: ActorId
  floor: Floor
}

export const GROUPS: Group[] = [
  {
    id: "gp.hw", level: "gpu", name: "Kernel and hardware",
    about: "The driver in node-2's kernel and the card it drives. Every container on the node shares this one kernel, so the driver is installed once, on the node.",
    members: ["gp.driver", "gp.gpu"],
    hub: "gp.driver",
    floor: { x0: -48, x1: 36, y0: 26, y1: 60, text: "kernel and hardware", at: [-12, 57.6] },
  },
  {
    id: "cp", level: "cluster", name: "Control plane",
    about: "The components that run the cluster: the API server, etcd, the scheduler and the controller manager. They decide what should run; the worker nodes run it.",
    members: ["sched", "kcm", "etcd", "api"],
    hub: "api",
    floor: { x0: -45, x1: 17, y0: -37, y1: 22, text: "control plane", at: [-43, 19.6] },
  },
  {
    id: "m.webpod", level: "mesh", name: "The web Pod",
    about: "One Pod, one network namespace, two containers that matter: the app and its proxy. They share an IP and reach each other over localhost.",
    members: ["m.web", "m.wipt", "m.wproxy", "m.weth0"],
    hub: "m.weth0",
    floor: { x0: -74, x1: -10, y0: -29, y1: 31, text: "Pod web-…-mv5tz", at: [-53, 1] },
  },
  {
    id: "m.apipod", level: "mesh", name: "The api Pod",
    about: "The Pod being called, with a proxy of its own.",
    members: ["m.aeth0", "m.aipt", "m.aproxy", "m.api"],
    hub: "m.aeth0",
    floor: { x0: 10, x1: 74, y0: -29, y1: 31, text: "Pod api-v1-…-d4k8w", at: [30, 1] },
  },
  {
    id: "a.node1", level: "ambient", name: "node-1",
    about: "A worker node with one ztunnel, shared by all its Pods.",
    members: ["a.cni", "a.web", "a.zt1"],
    hub: "a.zt1",
    floor: { x0: -70, x1: -8, y0: -34, y1: 34, text: "node-1 · 10.0.1.11", at: [-51, -30] },
  },
  {
    id: "a.node2", level: "ambient", name: "node-2",
    about: "Another worker node, with its own ztunnel.",
    members: ["a.zt2", "a.api"],
    hub: "a.zt2",
    floor: { x0: 8, x1: 70, y0: -34, y1: 34, text: "node-2 · 10.0.1.12", at: [27, -30] },
  },
  {
    id: "g.apiserver", level: "admission", name: "API server",
    about: "Every write takes these stops in this order. A no at any of them ends the request, and nothing is saved.",
    members: ["g.authn", "g.authz", "g.mutate", "g.schema", "g.validate"],
    hub: "g.authn",
    floor: { x0: -75, x1: 70, y0: -4, y1: 36, text: "API server", at: [-54, 0.5] },
  },
  {
    id: "g.kyv", level: "admission", name: "Kyverno",
    about: "Ordinary Pods in the kyverno namespace. The API server reaches them through a Service.",
    members: ["g.kyverno", "g.engine"],
    hub: "g.kyverno",
    floor: { x0: 2, x1: 68, y0: -47, y1: -14, text: "kyverno namespace", at: [26, -16.5] },
  },
  {
    id: "f.kernel", level: "falco", name: "The kernel",
    about: "The one Linux kernel every container on node-2 shares. That is why a single probe sees all of them.",
    members: ["f.sys", "f.probe", "f.ring"],
    hub: "f.ring",
    floor: { x0: -104, x1: 16, y0: 28, y1: 58, text: "kernel", at: [-102, 55.6] },
  },
  {
    id: "f.falco", level: "falco", name: "The Falco Pod",
    about: "One privileged Pod per node. It runs beside the Pods it watches and adds nothing to them.",
    members: ["f.libs", "f.meta", "f.rules", "f.out"],
    hub: "f.libs",
    floor: { x0: -14, x1: 58, y0: -44, y1: 22, text: "Pod falco-x9k2v", at: [22, 19.6] },
  },
]

/** An actor list with each group written out as its members. */
export const expand = (ids: ActorId[]): ActorId[] => ids.flatMap((id) => GROUPS.find((g) => g.id === id)?.members ?? [id])

/** Who stands on a level's floor. When a lesson leaves some of them out, the floor shrinks to the rest. */
const ON_FLOOR: Partial<Record<Level, ActorId[]>> = { cluster: ["cp", "node1", "node2"] }

/** Who stands on the floor only in the lessons that show them: the floor grows to take them in. */
const GROWS: Partial<Record<Level, ActorId[]>> = { cluster: ["node3"] }

/** The ground a group or actor covers, as [x0, y0, x1, y1]. */
function covers(id: ActorId, margin = 0): Box {
  const plate = GROUPS.find((g) => g.id === id)?.floor
  if (plate) return [plate.x0 - margin / 2, plate.y0 - margin / 2, plate.x1 + margin / 2, plate.y1 + margin / 2]
  const a = actorById(id)!
  const unit = S * GEOMETRY[a.level].k
  return [a.g[0] - a.foot[0] / unit - margin, a.g[1] - a.foot[1] / unit - margin, a.g[0] + a.foot[0] / unit + margin, a.g[1] + a.foot[1] / unit + margin]
}

/** The floor as a lesson shows it: the full plate, or one fitted around the members it keeps. */
export function floorFor(level: Level, shown: Set<ActorId>): Floor {
  const base = fitted(level, shown)
  const extra = (GROWS[level] ?? []).filter((id) => shown.has(id)).map((id) => covers(id, 12))
  if (!extra.length) return base
  return {
    ...base,
    x0: Math.min(base.x0, ...extra.map((b) => b[0])),
    y0: Math.min(base.y0, ...extra.map((b) => b[1])),
    x1: Math.max(base.x1, ...extra.map((b) => b[2])),
    y1: Math.max(base.y1, ...extra.map((b) => b[3])),
  }
}

function fitted(level: Level, shown: Set<ActorId>): Floor {
  const full = FLOORS[level]
  const on = ON_FLOOR[level] ?? []
  const boxes = on.filter((id) => expand([id]).every((m) => shown.has(m))).map((id) => covers(id, 12))
  if (!boxes.length || boxes.length === on.length) return full
  const x0 = Math.max(full.x0, Math.min(...boxes.map((b) => b[0])))
  const y0 = Math.max(full.y0, Math.min(...boxes.map((b) => b[1])))
  const x1 = Math.min(full.x1, Math.max(...boxes.map((b) => b[2])))
  const y1 = Math.min(full.y1, Math.max(...boxes.map((b) => b[3])))
  return { ...full, x0, x1, y0, y1, at: [x0 + 2, y1 - 2.4] }
}

/** The floor's outline on screen, slab edge included, for framing the camera around it. */
export const floorCorners = (level: Level, f: Floor): Point[] =>
  [toScreen(level, [f.x0, f.y0]), toScreen(level, [f.x1, f.y0]), toScreen(level, [f.x1, f.y1]), toScreen(level, [f.x0, f.y1])].map(([x, y]) => [x, y + 6] as Point)

/** Pairs of actors that are cabled together, for anything that only needs to know who is connected. */
export const LINKS: Record<Level, [ActorId, ActorId][]> = Object.fromEntries(
  Object.entries(CABLES).map(([level, cables]) => [level, cables.map((c) => [c.a, c.b])]),
) as Record<Level, [ActorId, ActorId][]>

const length = (r: Point[]) => r.slice(1).reduce((sum, p, i) => sum + Math.abs(p[0] - r[i][0]) + Math.abs(p[1] - r[i][1]), 0)

/** An L along the floor's axes from one ground point to another: along x first, then y. */
const ell = (a: Point, b: Point): Point[] => (a[0] === b[0] || a[1] === b[1] ? [a, b] : [a, [b[0], a[1]], b])

/** Where a route without a cable may turn: the aisles between the actors on the cluster floor, in ground units. */
const AISLES = { x: [-54, -14, 23, 54], y: [-40, -12, 26] }

/** A route along the floor's axes between two actors that no cable connects: the shortest one that
 *  runs over the fewest other actors, turning at most twice. */
function openRoute(level: Level, A: Actor, B: Actor): Point[] {
  const [a, b] = [A.g, B.g]
  const aisles = level === "cluster" ? AISLES : { x: [], y: [] }
  const options: Point[][] = [
    ell(a, b),
    [a, [a[0], b[1]], b],
    ...aisles.x.map((x): Point[] => [a, [x, a[1]], [x, b[1]], b]),
    ...aisles.y.map((y): Point[] => [a, [a[0], y], [b[0], y], b]),
  ]
  const others = actorsAt(level).filter((o) => o.id !== A.id && o.id !== B.id).map((o) => covers(o.id))
  const hits = (r: Point[]) =>
    others.filter(([x0, y0, x1, y1]) =>
      r.slice(1).some((p, i) => {
        const q = r[i]
        return Math.max(p[0], q[0]) > x0 && Math.min(p[0], q[0]) < x1 && Math.max(p[1], q[1]) > y0 && Math.min(p[1], q[1]) < y1
      }),
    ).length
  const cost = (r: Point[]) => hits(r) * 10_000 + length(r)
  return options.reduce((best, r) => (cost(r) < cost(best) ? r : best))
}

/** The route a packet takes between two actors, in ground units: along the cables when they connect
 *  (through other actors if it must), otherwise across the open floor, passing the API server on the way out of the control plane. */
export function groundRoute(level: Level, from: ActorId, to: ActorId): Point[] {
  const A = actorById(from)
  const B = actorById(to)
  if (!A || !B) return []
  const edges = new Map<ActorId, { to: ActorId; route: Point[] }[]>()
  for (const c of CABLES[level]) {
    edges.set(c.a, [...(edges.get(c.a) ?? []), { to: c.b, route: c.route }])
    edges.set(c.b, [...(edges.get(c.b) ?? []), { to: c.a, route: [...c.route].reverse() }])
  }
  // shortest path by cable length, small enough to search exhaustively
  const dist = new Map<ActorId, number>([[from, 0]])
  const prev = new Map<ActorId, { from: ActorId; route: Point[] }>()
  const open = new Set<ActorId>([from])
  while (open.size) {
    const here = [...open].reduce((a, b) => (dist.get(a)! <= dist.get(b)! ? a : b))
    open.delete(here)
    if (here === to) break
    for (const e of edges.get(here) ?? []) {
      const d = dist.get(here)! + length(e.route)
      if (d < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, d)
        prev.set(e.to, { from: here, route: e.route })
        open.add(e.to)
      }
    }
  }
  if (!prev.has(to)) {
    const hubOf = (id: ActorId) => GROUPS.find((g) => g.members.includes(id) && g.hub !== id)?.hub
    const via = hubOf(from) ?? hubOf(to)
    return via ? [...groundRoute(level, from, via), ...groundRoute(level, via, to).slice(1)] : openRoute(level, A, B)
  }
  const legs: Point[][] = []
  for (let at = to; at !== from; at = prev.get(at)!.from) legs.unshift(prev.get(at)!.route)
  return legs.reduce<Point[]>((all, leg) => [...all, ...(all.length ? leg.slice(1) : leg)], [])
}

/** An ownership edge between a card and what it owns, in ground units. */
export const ownRoute = (a: Actor, b: Actor): Point[] => ell(a.g, b.g)

/** A ground route as screen points, trimmed so it starts and ends at the edges of the two footprints. */
export function screenRoute(level: Level, route: Point[], from?: Actor, to?: Actor): Point[] {
  const pts = route.map((p) => toScreen(level, p))
  const trim = (end: Point, next: Point, gEnd: Point, gNext: Point, actor?: Actor) => {
    if (!actor) return end
    const r = gEnd[0] !== gNext[0] ? actor.foot[0] : actor.foot[1]
    const len = Math.hypot(next[0] - end[0], next[1] - end[1])
    const k = Math.min(r, len * 0.45) / (len || 1)
    return [end[0] + (next[0] - end[0]) * k, end[1] + (next[1] - end[1]) * k] as Point
  }
  if (pts.length < 2) return pts
  const n = pts.length - 1
  const out = [...pts]
  out[0] = trim(pts[0], pts[1], route[0], route[1], from)
  out[n] = trim(pts[n], pts[n - 1], route[n], route[n - 1], to)
  return out
}

/** Card-to-card edges from an object to what it owns or makes, drawn while both endpoints are on screen. */
export const RESOURCE_LINKS: [ActorId, ActorId][] = [
  ["web-deploy", "web-rs"], ["web-deploy", "web-rs2"],
  ["web-hpa", "web-deploy"],
  ["shop-ing", "web-svc"],
  ["backup-cj", "backup-job"], ["backup-cj", "nightly-job"],
  ["uploads-pvc", "uploads-pv"],
  ["kyv-vpol", "kyv-report"], ["kyv-gpol", "kyv-netpol"],
]

/** The worker nodes, in the order they joined. */
export const NODES: NodeId[] = ["node1", "node2", "node3"]

/** Which worker nodes each workload card's Pods currently sit on, derived from the Pod-slot layout.
 *  With two ReplicaSets on screen the v1 slots belong to the first and v2/starting to the second.
 *  StatefulSet and Job lessons keep the standing web Pods in v1, so their own Pods are the v2/starting slots. */
export function workloadNodes(resources: Record<string, Resource>, pods: PodLayout): [ActorId, ActorId][] {
  const twoRs = Object.values(resources).filter((r) => r.kind === "replicaset").length > 1
  const edges: [ActorId, ActorId][] = []
  for (const node of NODES) {
    const slots = pods[node] ?? []
    const v1 = slots.includes("v1") || slots.includes("terminating")
    const v2 = slots.includes("v2") || slots.includes("starting")
    const any = slots.some((s) => s !== "other")
    const ready = slots.includes("v1") || slots.includes("v2")
    for (const [id, r] of Object.entries(resources)) {
      if (r.kind === "replicaset" && (twoRs ? (id === "web-rs" ? v1 : v2) : any)) edges.push([id, node])
      else if ((r.kind === "statefulset" || r.kind === "job") && v2) edges.push([id, node])
      else if (r.kind === "daemonset" && r.state !== "creating" && (!r.nodes || r.nodes.includes(node))) edges.push([id, node])
      else if (r.kind === "service" && ready) edges.push([id, node])
    }
  }
  return edges
}

export const LEVEL_NAME: Record<Level, string> = {
  cluster: "Cluster",
  node1: "node-1",
  node2: "node-2",
  pod: "Pod web-…-x2kqp",
  mesh: "Mesh, with sidecars",
  ambient: "Mesh, ambient mode",
  admission: "Inside the API server",
  falco: "node-2, with Falco",
  gpu: "node-2, with a GPU",
}

/** The chain of levels above and including this one, for the breadcrumb. */
export const levelPath = (level: Level): Level[] =>
  level === "cluster" ? ["cluster"] : level === "pod" ? ["cluster", "node2", "pod"] : ["cluster", level]

export type Box = [x: number, y: number, w: number, h: number]

/** The smallest world box that shows these actors, padded and kept at the stage's aspect ratio. */
export function frame(ids: ActorId[], minWidth = 520, also: Point[] = [], caption = true): Box {
  const actors = ids.map(actorById).filter((a): a is Actor => !!a)
  if (!actors.length) return [0, 0, WORLD.width, WORLD.height]
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of also) {
    ;[x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)]
  }
  for (const a of actors) {
    x0 = Math.min(x0, a.pos[0] + a.box[0])
    y0 = Math.min(y0, a.pos[1] + a.box[1])
    x1 = Math.max(x1, a.pos[0] + a.box[2])
    y1 = Math.max(y1, a.pos[1] + a.box[3])
  }
  const pad = 48
  // room under the actors for the caption bar that sits over the bottom of the stage, when there is one
  y1 += caption ? 70 : 24
  let w = Math.max(x1 - x0 + pad * 2, minWidth)
  let h = y1 - y0 + pad * 2
  const ratio = WORLD.width / WORLD.height
  if (w / h > ratio) h = w / ratio
  else w = h * ratio
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return [cx - w / 2, cy - h / 2, w, h]
}
