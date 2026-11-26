import type { CSSProperties } from "react"
import type { Category, ClusterEvent, Layer } from "./types"

export const LAYERS: Record<Layer, { label: string; color: string; meaning: string }> = {
  api: { label: "API", color: "var(--l-api)", meaning: "requests to the API server" },
  state: { label: "STATE", color: "var(--l-state)", meaning: "reads and writes in etcd" },
  control: { label: "CONTROL", color: "var(--l-control)", meaning: "watches, controllers, scheduler" },
  node: { label: "NODE", color: "var(--l-node)", meaning: "kubelet and the container runtime" },
  net: { label: "NETWORK", color: "var(--l-net)", meaning: "packets on the wire" },
  drop: { label: "DROP", color: "var(--l-drop)", meaning: "denied, failed or killed" },
}

/** An event's color, as the --c its badge or dot reads. */
export const layerStyle = (e: Pick<ClusterEvent, "layer">) => ({ "--c": LAYERS[e.layer].color }) as CSSProperties

export const LEGEND: Layer[] = ["api", "state", "control", "node", "net"]

/** The order lessons are grouped in: from the wire up to the app, then what guards all of it. */
export const CATEGORIES: Category[] = ["network", "node", "control", "app", "security"]

export const CATEGORY_NAME: Record<Category, string> = {
  network: "Network",
  node: "Node",
  control: "Control plane",
  app: "App",
  security: "Security",
}
