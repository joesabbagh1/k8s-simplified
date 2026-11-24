import type { Lesson } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const SCHED = "kube-scheduler"
const NEW_POD = "web-…-t9c3k"

export const theScheduler: Lesson = {
  id: "the-scheduler",
  title: "The scheduler",
  subtitle: "Filter, score, bind",
  category: "control",
  seo: {
    title: "How the Kubernetes scheduler picks a node",
    description: "Watch the Kubernetes scheduler place one Pod: filter nodes by resources, affinity and taints, score the ones left, then bind the Pod to the winner.",
  },
  actors: ["you", "cp", "node1", "node2"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {},
  overview: {
    body: "The plugins that decide where a Pod runs: resources, affinity, taints and spreading. Traffic rises, so you scale web to four - and one new Pod has to be placed. Watch the scheduler filter two feasible nodes down to one winner, and write its single-sentence verdict into the cluster.",
    facts: [
      ["DECISION", "one Pod, two nodes, one Binding"],
      ["PHASES", "filter → score → reserve → bind"],
      ["INPUTS", "requests, taints, image locality, spreading"],
      ["RUN TIME", "≈ 40 ms for one Pod"],
    ],
  },
  steps: [
    {
      title: "THE QUEUE",
      subtitle: "a Pod with no node",
      body: `You scale the Deployment to four. The ReplicaSet creates ${NEW_POD} with an empty spec.nodeName - it exists, but nothing will run it until a node's name appears in that field. The scheduler watches every Pod, and files the ones with no node into its active queue. It decides one Pod at a time, in priority order.`,
      facts: [
        ["POD", `${NEW_POD} · Pending`],
        ["QUEUES", "Pods with spec.nodeName=\"\""],
        ["QUEUE", "active · priority 0"],
      ],
      view: "cluster",
      focus: ["you", "api", "sched"],
      events: [
        ev({
          id: "sd1", at: 0, src: "kubectl", dst: API, layer: "api", size: "0.2 KB", title: "SCALE TO FOUR", path: ["you", "api"],
          says: "You ask for a fourth web Pod.",
          info: "PATCH …/deployments/web  replicas 3 → 4",
          decoded: [sec("PATCH", [["spec.replicas", "3 → 4", true], ["cascade", "ReplicaSet → new Pod (earlier lesson)"]])],
        }),
        ev({
          id: "sd2", at: 40, src: API, dst: SCHED, layer: "control", size: "2.3 KB", title: "UNSCHEDULED POD SEEN", path: ["api", "sched"],
          says: "The scheduler's watch delivers the new Pod with no node.",
          info: `WATCH ADDED Pod ${NEW_POD} (spec.nodeName "")`,
          decoded: [sec("WATCH STREAM", [["request", "GET /api/v1/pods?fieldSelector=status.phase!=Succeeded,status.phase!=Failed&watch=true"], ["type", "ADDED"], ["nodeName", "empty - my problem now", true], ["enqueued", "active queue, priority 0"], ["Pods with a node", "kept in its cache, to know what each node holds"]])],
        }),
      ],
    },
    {
      title: "FILTER",
      subtitle: "can the node run it at all",
      body: "Filter plugins answer yes or no, one node at a time. NodeResourcesFit checks the Pod's requests - 500m CPU, 256 Mi - against each node's unreserved capacity. NodeUnschedulable, taints, node affinity and node ports each get a veto. Both nodes pass every filter here, but that's information: the feasible set is {node-1, node-2}.",
      facts: [
        ["REQUESTS", "cpu 500m · memory 256Mi"],
        ["NODE-1 FREE", "1.1 CPU · 9.5 Gi → fits"],
        ["NODE-2 FREE", "2.8 CPU · 21 Gi → fits"],
        ["FEASIBLE", "2 of 2"],
      ],
      view: "cluster",
      focus: ["api", "sched", "node1", "node2"],
      events: [
        ev({
          id: "sd3", at: 60, src: SCHED, dst: SCHED, layer: "control", size: " - ", title: "RUN THE FILTERS", path: ["sched", "sched"],
          says: "Six filter plugins run per node; both nodes survive all of them.",
          info: "NodeResourcesFit · TaintToleration · NodeAffinity · NodePorts · …",
          decoded: [sec("FILTER RESULTS", [["NodeResourcesFit", "node-1 ✓ · node-2 ✓"], ["TaintToleration", "no taints to respect ✓"], ["NodeAffinity", "no constraints ✓"], ["NodePorts", "no host ports used ✓"], ["feasible", "node-1, node-2", true]])],
          note: "A node full past a Pod's requests is filtered out before scoring - this is why requests matter even without limits. Zero requests fit anywhere.",
        }),
      ],
    },
    {
      title: "SCORE",
      subtitle: "which feasible node is best",
      body: "Scoring plugins rank what's left, 0 to 100 each, and the weighted sum picks. NodeResourcesFit prefers emptier nodes: node-2 is 41% allocated, node-1 is 62%. PodTopologySpread, which counts double, prefers node-1, which runs fewer web Pods. ImageLocality is a draw, because both nodes already have web:1.4.2. Add it up and node-2 wins by a hair, 337 to 332: its emptiness just outweighs the spreading.",
      facts: [
        ["LEAST ALLOCATED", "node-2 41% · node-1 62%"],
        ["SPREAD ×2", "node-1 (1 web · node-2 has 2)"],
        ["IMAGE LOCALITY", "a draw · both have web:1.4.2"],
        ["WINNER", "node-2 · 337 to 332"],
      ],
      view: "cluster",
      focus: ["api", "sched", "node1", "node2"],
      events: [
        ev({
          id: "sd4", at: 75, src: SCHED, dst: SCHED, layer: "control", size: " - ", title: "SCORE THE SURVIVORS", path: ["sched", "sched"],
          says: "The scoring plugins disagree; the weighted totals settle it.",
          info: "node-2: 337 · node-1: 332",
          decoded: [sec("SCORECARD · 0-100 PER PLUGIN", [["NodeResourcesFit ×1", "node-2 59 · node-1 38"], ["BalancedAllocation ×1", "node-2 90 · node-1 82"], ["ImageLocality ×1", "node-2 12 · node-1 12 · both have it"], ["PodTopologySpread ×2", "node-1 100 · node-2 88", true], ["total", "node-2 337 · node-1 332 → node-2", true]])],
          note: "The race is real math you can tilt: a topologySpreadConstraint with whenUnsatisfiable: DoNotSchedule turns spreading into a filter, and bigger requests make free room count for more.",
        }),
      ],
    },
    {
      title: "BIND",
      subtitle: "one field, written back",
      body: `The scheduler reserves node-2 for a few milliseconds while Permit plugins run, then does the only thing it can do: POST a Binding. That single object update sets spec.nodeName on the Pod. The scheduler never talks to node-2, never starts anything, tells no kubelet. It writes one field and moves to the next Pod in the queue.`,
      facts: [
        ["RESERVE", "node-2 assumed for ~10 ms"],
        ["WRITE", `POST …/pods/${NEW_POD}/binding`],
        ["EFFECT", "spec.nodeName = node-2"],
        ["THEN", "kubelet node-2 hears it via its watch"],
      ],
      view: "cluster",
      focus: ["api", "sched", "node2"],
      pods: { node2: ["other", "v1", "v1", "starting"] },
      events: [
        ev({
          id: "sd5", at: 90, src: SCHED, dst: API, layer: "api", size: "0.3 KB", title: "BINDING → NODE-2", path: ["sched", "api"],
          says: "The verdict is written as a Binding: node-2.",
          info: `POST …/pods/${NEW_POD}/binding`,
          decoded: [sec("BODY · BINDING", [["target.name", "node-2", true], ["effect", "spec.nodeName: \"\" → \"node-2\""], ["assumption", "kubelet node-2 will make it so"]])],
        }),
        ev({
          id: "sd6", at: 140, src: API, dst: "kubelet · node-2", layer: "control", size: "2.4 KB", title: "KUBELET PICKS IT UP", path: ["node2", "node2"],
          says: "node-2's kubelet sees the assignment on its own watch - nobody notified it directly.",
          info: `WATCH MODIFIED Pod ${NEW_POD} (nodeName node-2)`,
          decoded: [sec("HANDOFF", [["who told the kubelet", "nobody - its watch did", true], ["next", "sandbox, CNI, image, container (earlier lessons)"]])],
        }),
      ],
    },
    {
      title: "WHEN NOTHING FITS",
      subtitle: "Pending, or preempt",
      body: `If every node is filtered out, the scheduler doesn't error - it writes a condition and parks the Pod. The Pod sits Pending with PodScheduled=False until a change that could help wakes it: a Pod is deleted, a node is added, a cordoned node is uncordoned. One exception escalates: a Pod with a high PriorityClass may preempt - evict lower-priority Pods until it fits.`,
      facts: [
        ["PHASE", "Pending · PodScheduled=False"],
        ["RETRY", "when the cluster changes · or after 5 min"],
        ["PREEMPTION", "high priority evicts the low"],
        ["REASONS", "Insufficient cpu/memory · taints · affinity"],
      ],
      view: "cluster",
      focus: ["you", "api", "sched", "node1", "node2"],
      events: [
        ev({
          id: "sd7", at: 200, src: SCHED, dst: API, layer: "drop", size: "0.4 KB", title: "THE OTHER OUTCOME", path: ["sched", "api"],
          says: "On a full cluster, the same loop ends here instead: Pending, with the reason recorded.",
          info: "PodStatus conditions.PodScheduled=False (Unschedulable)",
          decoded: [sec("PENDING", [["reason", "0/2 nodes are available: 2 Insufficient cpu", true], ["who fixes it", "a cluster autoscaler adding a node, or you"], ["preemption", "only if priority demands it"], ["events", "FailedScheduling, visible in describe"]])],
          note: "Preemption picks the lowest-priority Pods whose removal frees enough room and deletes them gracefully. Their ReplicaSets create replacements, which then have to find room somewhere else.",
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "scale → queue", layer: "control", start: 0, duration: 60 },
    { value: "t2", label: "filter 2 nodes", layer: "control", start: 60, duration: 15 },
    { value: "t3", label: "score + decide", layer: "control", start: 75, duration: 15 },
    { value: "t4", label: "bind → kubelet watch", layer: "api", start: 90, duration: 60 },
    { value: "t5", label: "parked if nothing fits", layer: "drop", start: 200, duration: 200 },
  ],
  summary: {
    title: "ONE FIELD",
    body: "Filter to the possible, score to the preferable, bind by writing spec.nodeName. The scheduler's entire authority is that one field - every kubelet watches for its own name there. Its judgment lives in plugins whose weights you can tilt: requests and limits, taints and tolerations, affinities and spreading constraints.",
    facts: [
      ["DECIDED IN", "≈ 40 ms · 2 nodes, 9 plugins"],
      ["AUTHORITY", "writes spec.nodeName - nothing more"],
      ["NEXT", "Why is my Pod Pending?"],
    ],
  },
}
