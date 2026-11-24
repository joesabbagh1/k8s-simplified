import type { Lesson } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const KUBELET = "kubelet · node-2"
const PROXY = "kube-proxy · node-1"
const POD = "web-…-x2kqp"

export const listAndWatch: Lesson = {
  id: "list-and-watch",
  title: "List and watch",
  subtitle: "How components stay in sync",
  category: "control",
  seo: {
    title: "Kubernetes list and watch, explained",
    description: "How Kubernetes components see every change without polling: resource versions, one LIST, long-lived watch streams and informers.",
  },
  actors: ["you", "cp", "etcd", "node1", "node2"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    [KUBELET]: "kubelet", [PROXY]: "kube-proxy",
  },
  overview: {
    body: "Resource versions, watch streams and informers: how every component sees changes without polling. Follow node-2's kubelet catching up after a restart - one LIST, one long-lived watch - and then one Deployment patch as it fans out to every listener in the cluster within milliseconds.",
    facts: [
      ["PATTERN", "LIST for state, WATCH for changes"],
      ["RESOURCE VERSION", "48211 · a logical clock from etcd"],
      ["POLLING", "none - the server pushes"],
      ["FAN-OUT", "one write → every listener, < 10 ms"],
    ],
  },
  steps: [
    {
      title: "THE FIRST LIST",
      subtitle: "catch me up",
      body: `node-2's kubelet restarts and knows nothing. It issues one request: list every Pod assigned to node-2. The API server answers with the full collection and one extra field - resourceVersion 48211, the etcd revision this snapshot reflects. That number is the contract: everything that has happened to these objects, ever, is numbered, and the kubelet is now up to date as of 48211.`,
      facts: [
        ["REQUEST", "GET /api/v1/pods?fieldSelector=spec.nodeName=node-2"],
        ["ITEMS", "3 (2 web, 1 tooling)"],
        ["RESOURCEVERSION", "48211"],
      ],
      view: "node2",
      focus: ["n2.api", "n2.kubelet"],
      events: [
        ev({
          id: "lw1", at: 0, src: KUBELET, dst: API, layer: "api", size: "0.3 KB", title: "LIST MY PODS", path: ["n2.kubelet", "n2.api"],
          says: "The restarted kubelet asks for its Pods in one request.",
          info: "GET /api/v1/pods?fieldSelector=spec.nodeName=node-2",
          decoded: [sec("HTTP/2 REQUEST", [["method", "GET"], ["fieldSelector", "spec.nodeName=node-2"], ["why", "the kubelet only ever sees its own node"]])],
        }),
        ev({
          id: "lw2", at: 120, src: API, dst: KUBELET, layer: "api", size: "9.6 KB", title: "SNAPSHOT + RV 48211", path: ["n2.api", "n2.kubelet"],
          says: "The answer carries the state and the number that dates it.",
          info: "200 OK · items: 3 · metadata.resourceVersion: 48211",
          decoded: [sec("RESPONSE", [["items", `${POD}, web-…-p8m4z, tool-…-g4n8s`], ["resourceVersion", "48211", true], ["meaning", "true as of etcd revision 48211"]])],
          note: "resourceVersion comes straight from etcd's MVCC revision counter. Every write cluster-wide bumps it - Pod events, ConfigMaps, everything.",
        }),
      ],
    },
    {
      title: "OPEN THE WATCH",
      subtitle: "a stream that never closes",
      body: "Catching up isn't enough; the kubelet needs changes as they happen. So it immediately re-asks with watch=true and resourceVersion=48211 - send me everything after 48211. The API server holds the HTTP/2 stream open and pushes framed events down it: ADDED, MODIFIED, DELETED. No component in Kubernetes polls. They all hold one of these streams open per resource type.",
      facts: [
        ["REQUEST", "GET …?watch=true&resourceVersion=48211"],
        ["EVENT TYPES", "ADDED · MODIFIED · DELETED · BOOKMARK"],
        ["CONNECTION", "long-lived HTTP/2 · heartbeats"],
      ],
      view: "node2",
      focus: ["n2.api", "n2.kubelet"],
      events: [
        ev({
          id: "lw3", at: 150, src: KUBELET, dst: API, layer: "api", size: "0.2 KB", title: "WATCH FROM 48211", path: ["n2.kubelet", "n2.api"],
          says: "The kubelet opens a watch that starts where the list ended.",
          info: "GET /api/v1/pods?fieldSelector=…&watch=true&resourceVersion=48211",
          decoded: [sec("WATCH REQUEST", [["watch", "true - stream, don't answer"], ["resourceVersion", "48211 - start after here", true], ["stream", "HTTP/2, stays open"]])],
        }),
        ev({
          id: "lw4", at: 170, src: API, dst: KUBELET, layer: "control", size: " - ", title: "THE STREAM IS QUIET", path: ["n2.api", "n2.kubelet"],
          says: "Nothing arrives until something changes - that's the point.",
          info: "idle · pings every ~10 s keep middleboxes from cutting it",
          decoded: [sec("EVENT FRAME SHAPE", [["type", "ADDED | MODIFIED | DELETED"], ["object", "the full object, post-change"], ["BOOKMARK", "a rv-only keepalive, sent periodically"]])],
        }),
      ],
    },
    {
      title: "ONE WRITE, MANY PUSHES",
      subtitle: "the fan-out",
      body: `Now you patch the Deployment - anywhere in the cluster. One write hits etcd, etcd's own watch fires inside the API server, and the API server walks its registry of open watchers and pushes the event to every one that matches: the deployment controller, the scheduler, both kubelets' Pod watches after the cascade, kube-proxy on every node. One write becomes as many pushes as there are listeners.`,
      facts: [
        ["WRITE", "1 (your patch)"],
        ["ETCD REVISION", "48211 → 48212"],
        ["PUSHED TO", "controllers, scheduler, kubelets, kube-proxy…"],
        ["LATENCY", "≈ 5 ms to every watcher"],
      ],
      view: "cluster",
      focus: ["you", "cp", "etcd"],
      events: [
        ev({
          id: "lw5", at: 800, src: "kubectl", dst: API, layer: "api", size: "0.3 KB", title: "ONE PATCH", path: ["you", "cp"],
          says: "You change one field of one object.",
          info: "PATCH …/deployments/web  replicas 3 → 4",
          decoded: [sec("HTTP/2 REQUEST", [["method", "PATCH"], ["resourceVersion", "48211 → 48212", true], ["stored", "etcd Txn, one revision"]])],
        }),
        ev({
          id: "lw6", at: 805, src: API, dst: "etcd", layer: "state", size: "0.4 KB", title: "ETCD'S OWN WATCH", path: ["cp", "etcd"],
          says: "etcd was watching itself; the API server hears its own write come back.",
          info: "WatchResponse revision 48212",
          decoded: [sec("INSIDE THE SERVER", [["etcd watch", "the API server holds one on /registry/…"], ["delivery", "async, in revision order"]])],
        }),
        ev({
          id: "lw7", at: 810, src: API, dst: "deployment ctrl", layer: "control", size: "1.3 KB", title: "PUSH 1 · CONTROLLERS", path: ["cp", "cp"],
          says: "The deployment controller gets the MODIFIED event.",
          info: "WATCH MODIFIED Deployment web (rv 48212)",
          decoded: [sec("FAN-OUT · 1 OF 3", [["deployment ctrl", "MODIFIED Deployment web", true], ["matched", "its watch on deployments"]])],
        }),
        ev({
          id: "lw8", at: 812, src: API, dst: KUBELET, layer: "control", size: "2.4 KB", title: "PUSH 2 · KUBELET", path: ["cp", "node2"],
          says: "Seconds later in story-time, the new Pod's binding reaches node-2's kubelet on the same stream.",
          info: "WATCH MODIFIED Pod web-…-t9c3k (nodeName node-2)",
          decoded: [sec("FAN-OUT · 2 OF 3", [["which watch", "pods, fieldSelector nodeName=node-2"], ["event", "MODIFIED (nodeName set by the scheduler)"]])],
        }),
        ev({
          id: "lw9", at: 814, src: API, dst: PROXY, layer: "control", size: "0.8 KB", title: "PUSH 3 · KUBE-PROXY", path: ["cp", "node1"],
          says: "And kube-proxy on node-1 hears about the endpoint that will follow.",
          info: "WATCH MODIFIED EndpointSlice web-7xk2p",
          decoded: [sec("FAN-OUT · 3 OF 3", [["kube-proxy node-1", "EndpointSlice change", true], ["its response", "rewrite iptables (the chains from Pod calls a Service)"], ["nothing polled", "everyone was already listening"]])],
        }),
      ],
    },
    {
      title: "THE INFORMER",
      subtitle: "the client-side machinery",
      body: `Nobody writes raw watch loops; every component embeds client-go's informer. The reflector drives the watch stream; every event lands in a delta queue; the store keeps the newest version of each object in memory; handler callbacks fire per change. Controllers read from that cache, not the API - which is why a controller can answer "what Pods exist?" instantly, forever, without a single extra request.`,
      facts: [
        ["REFLECTOR", "drives the watch stream"],
        ["STORE", "local cache, keyed by namespace/name"],
        ["HANDLERS", "OnAdd / OnUpdate / OnDelete"],
        ["READS", "from cache - not the API"],
      ],
      view: "node2",
      focus: ["n2.kubelet"],
      events: [
        ev({
          id: "lw10", at: 840, src: KUBELET, dst: KUBELET, layer: "control", size: " - ", title: "EVENT → CACHE → HANDLER", path: ["n2.kubelet", "n2.kubelet"],
          says: "Each pushed event updates a local cache and fires a handler.",
          info: "reflector → delta queue → store → handlers",
          decoded: [sec("INFORMER", [["reflector", "watch stream → delta queue"], ["store", "upsert Pod web-…-t9c3k", true], ["handler", "OnUpdate → syncPod()"], ["kubelet's response", "create the container (an earlier lesson)"]])],
          note: "The cache is eventually consistent, not transactional: a read may trail the newest write by milliseconds. Controllers are written to tolerate that - reconcile loops re-check.",
        }),
      ],
    },
    {
      title: "TOO FAR BEHIND",
      subtitle: "410 and the bookmark",
      body: "Watch buffers are finite. If a listener is too slow - or disconnects and reconnects with an old resourceVersion - the API server can no longer ship the missed range and returns 410 Gone. The client falls back to its only safe move: re-LIST from scratch, then re-watch from the fresh version. BOOKMARK events exist to make that rare: during quiet periods the server sends rv-only keepalives so clients never hold ancient versions.",
      facts: [
        ["FAILURE", "410 Gone - history compacted"],
        ["RECOVERY", "re-LIST, then re-watch"],
        ["BOOKMARKS", "rv-only keepalives between changes"],
      ],
      view: "node2",
      focus: ["n2.api", "n2.kubelet"],
      events: [
        ev({
          id: "lw11", at: 5000, src: API, dst: KUBELET, layer: "drop", size: "0.1 KB", title: "410 GONE", path: ["n2.api", "n2.kubelet"],
          says: "The kubelet reconnects with a version too old to resume, and the server refuses.",
          info: "watch from rv 48211 → 410 Gone (compacted)",
          decoded: [sec("WHY REFUSED", [["watch cache", "a window of recent events per resource type, not forever"], ["rv 48211", "older than the window, and etcd has compacted it"], ["only safe answer", "410 - refuse, don't lie"]])],
        }),
        ev({
          id: "lw12", at: 5150, src: KUBELET, dst: API, layer: "api", size: "9.8 KB", title: "RE-LIST, RE-WATCH", path: ["n2.kubelet", "n2.api"],
          says: "So the kubelet lists everything again and opens a fresh watch from the new version.",
          info: "LIST (rv 48470) → WATCH from 48470",
          decoded: [sec("RECOVERY", [["re-LIST", "full snapshot, rv 48470", true], ["re-watch", "from 48470"], ["cost", "one big request - rare, quiet-dependent"], ["bookmarks", "keep client rvs fresh so this stays rare"]])],
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "LIST snapshot", layer: "api", start: 0, duration: 120 },
    { value: "t2", label: "watch opened", layer: "api", start: 150, duration: 650 },
    { value: "t3", label: "one write, three pushes", layer: "control", start: 800, duration: 20 },
    { value: "t4", label: "informer: cache + handler", layer: "control", start: 840, duration: 60 },
    { value: "t5", label: "410 → re-list → re-watch", layer: "drop", start: 5000, duration: 160 },
  ],
  summary: {
    title: "PUSH, NOT POLL",
    body: "One LIST for the past, one watch stream for the future, and a local cache in between: that's how every component stays in sync. The API server is a broker between etcd's revision log and thousands of open streams, pushing each write to whoever's listening. Polling appears nowhere in the design - on a quiet cluster the streams carry little more than bookmarks and pings.",
    facts: [
      ["EVERY COMPONENT", "kubelets, controllers, kube-proxy - same machinery"],
      ["CONSISTENCY", "eventual, milliseconds behind"],
      ["NEXT", "The scheduler"],
    ],
  },
}
