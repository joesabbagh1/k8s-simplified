export type Layer = "api" | "state" | "control" | "node" | "net" | "drop"

export type Category = "network" | "node" | "control" | "app" | "security"

/** Zoom levels of the diagram: the whole cluster, inside one node, inside one Pod,
 *  two Pods in a service mesh, with sidecars ("mesh") or without ("ambient"), the stops a
 *  write makes inside the API server ("admission"), a node as Falco watches it, and node-2 with its GPU ("gpu"). */
export type Level = "cluster" | "node1" | "node2" | "pod" | "mesh" | "ambient" | "admission" | "falco" | "gpu"

/** An actor id from src/scene/world.ts, such as "api", "node2" or "n2.kubelet". */
export type ActorId = string

export type Fact = readonly [label: string, value: string]

export interface DecodedField {
  key: string
  value: string
  changed?: boolean
}

export interface DecodedSection {
  title: string
  fields: DecodedField[]
}

/** One header of a packet, outermost first. `bytes` sets its width in the frame diagram. */
export interface FrameLayer {
  name: string
  detail: string
  bytes: number
  inner?: boolean
}

export interface ClusterEvent {
  id: string
  /** milliseconds since the lesson started */
  at: number
  src: string
  dst: string
  layer: Layer
  info: string
  size: string
  title: string
  /** one plain sentence: what happens, for the caption under the diagram */
  says?: string
  decoded: DecodedSection[]
  /** packet headers, drawn as a frame diagram above the fields */
  frame?: FrameLayer[]
  /** where the marker travels in the step's view: [from, to]; the same actor twice pulses it */
  path?: [ActorId, ActorId]
  /** Pods on each node once this event lands */
  pods?: PodLayout
  /** Kubernetes objects on the cluster view once this event lands; null removes one */
  res?: ResourcePatch
  note?: string
}

/** What a Pod slot on a worker node shows. */
export type PodSlot = "other" | "v1" | "v2" | "starting" | "terminating"

/** The worker nodes. node-3 only exists in lessons where it joins the cluster. */
export type NodeId = "node1" | "node2" | "node3"

export type PodLayout = Partial<Record<NodeId, PodSlot[]>>

/** The Kubernetes objects drawn as cards on the cluster view. */
export type ResourceKind =
  | "deployment"
  | "replicaset"
  | "service"
  | "hpa"
  | "statefulset"
  | "daemonset"
  | "job"
  | "cronjob"
  | "configmap"
  | "secret"
  | "ingress"
  | "pvc"
  | "pv"
  | "policy"
  | "policyreport"
  | "networkpolicy"
  | "csr"
  | "pdb"
  | "scaledobject"

export interface Resource {
  kind: ResourceKind
  name: string
  /** one-line status under the name, e.g. "replicas 3/3" */
  sub?: string
  state?: "creating" | "active" | "terminating"
  /** for a DaemonSet that runs on some nodes only: the nodes it runs on */
  nodes?: NodeId[]
}

/** A snapshot of resource cards: keys not mentioned keep their previous value; null removes one. */
export type ResourcePatch = Record<string, Resource | null>

export interface Step {
  title: string
  subtitle: string
  body: string
  facts: Fact[]
  /** which zoom level the diagram shows */
  view: Level
  /** actors the camera frames and highlights */
  focus: ActorId[]
  /** Pods on each node when the step opens, before its events land */
  pods?: PodLayout
  /** resource cards on screen when the step opens, before its events land */
  res?: ResourcePatch
  events: ClusterEvent[]
}

export interface TimingSpan {
  value: string
  label: string
  layer: Layer
  start: number
  duration: number
}

export interface Lesson {
  id: string
  title: string
  subtitle: string
  category: Category
  /** the search result: a title of up to 48 characters (the site name is added) and a description of 110 to 160 */
  seo: { title: string; description: string }
  overview: { body: string; facts: Fact[] }
  /** cluster-level actors this lesson uses, with "cp" for the whole control plane; the overview camera frames them */
  actors: ActorId[]
  /** actors inside a node or Pod that only some lessons draw (those marked optional in world.ts) */
  extras?: ActorId[]
  /** actors that open a level in this lesson only, besides the nodes and Pods that always do */
  opens?: Record<ActorId, Level>
  /** Pods on each node before step 1 */
  pods?: PodLayout
  /** resource cards on screen before step 1 */
  res?: ResourcePatch
  steps: Step[]
  timing?: TimingSpan[]
  /** shown above the timing chart, for a lesson whose times could be mistaken for guarantees */
  timingNote?: string
  /** groups event sources and destinations into sequence-diagram lanes, e.g. "iptables" → "node-1" */
  lanes?: Record<string, string>
  summary?: { title: string; body: string; facts: Fact[] }
}
