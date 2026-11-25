import type { Lesson } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const K2 = "kubelet · node-2"
const LEASE = "kube-node-lease/node-2"

export const nodeGoesDark: Lesson = {
  id: "node-goes-dark",
  title: "A node goes dark",
  subtitle: "Heartbeats and eviction",
  category: "control",
  seo: {
    title: "What happens when a Kubernetes node fails",
    description: "A Kubernetes node loses power: its lease stops renewing, the node turns NotReady, taints start a clock, and its Pods are rescheduled.",
  },
  actors: ["cp", "node1", "node2"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    [K2]: "node-2", "kubelet · node-1": "node-1", "node-lifecycle ctrl": "controllers", "taint-eviction ctrl": "controllers",
  },
  overview: {
    body: "Node leases stop renewing, the node turns NotReady, and its Pods are rescheduled after the toleration runs out. node-2 loses power mid-morning. Nothing crashes, nothing is notified - the control plane notices an absence, waits out two timers, and rebuilds the missing third of the workload on node-1.",
    facts: [
      ["HEARTBEAT", "a Lease renewed every 10 s"],
      ["DETECTION", "40 s of silence → NotReady"],
      ["GRACE", "tolerationSeconds 300 on every Pod"],
      ["REPLACEMENTS", "node-1 · total ≈ 5 min 40 s"],
    ],
  },
  steps: [
    {
      title: "THE HEARTBEAT",
      subtitle: "a tiny object, renewed forever",
      body: "node-2's kubelet proves it's alive by renewing a Lease - a tiny object in the kube-node-lease namespace - every 10 seconds. The lease costs almost nothing to write, which is the point: node heartbeats used to patch the whole Node object, hammering etcd in big clusters. The full Node status is only re-sent when something changes, or every five minutes; the lease is the fast pulse.",
      facts: [
        ["OBJECT", LEASE],
        ["RENEWED", "every 10 s"],
        ["DEADLINE", "renew within 40 s or be forgotten"],
        ["SEPARATE", "status on change or every 5 min · lease every 10 s"],
      ],
      view: "cluster",
      focus: ["api", "node2"],
      events: [
        ev({
          id: "dk1", at: 0, src: K2, dst: API, layer: "api", size: "0.2 KB", title: "LEASE RENEWED", path: ["node2", "api"],
          says: "node-2 renews its lease - healthy, as it has been all morning.",
          info: `PUT ${LEASE}  renewTime 10:41:20Z`,
          decoded: [sec("BODY · LEASE", [["spec.holderIdentity", "node-2"], ["spec.renewTime", "10:41:20Z", true], ["leaseDurationSeconds", "40"], ["cost", "~200 B per 10 s"]])],
        }),
        ev({
          id: "dk2", at: 10000, src: K2, dst: K2, layer: "node", size: " - ", title: "POWER GONE", path: ["node2", "node2"],
          says: "Between one heartbeat and the next, node-2 loses power. Nothing is sent; the next renewal just never comes.",
          info: "node-2 down · 2 web Pods and tooling with it",
          decoded: [sec("WHAT DIED WITH IT", [["web-…-x2kqp", "10.244.2.17"], ["web-…-p8m4z", "10.244.2.18"], ["what's left running", "nothing on that machine"]])],
          note: "No component is told. The whole detection story is a countdown measured against a renewal that doesn't arrive.",
        }),
      ],
    },
    {
      title: "SILENCE MEASURES OUT",
      subtitle: "40 seconds to NotReady",
      body: "The node-lifecycle controller - a loop like any other - checks every node's lease against the clock. At 40 seconds of silence it acts twice: node-2's Ready condition flips to Unknown, and the taint node.kubernetes.io/unreachable:NoExecute lands on the node. It also marks node-2's Pods not ready. node-2's kubelet can't object; it's off.",
      facts: [
        ["SILENCE", "renewals due at +10, +20, +30: missed"],
        ["AT +40 S", "Ready=Unknown · taint unreachable"],
        ["WHO DECIDES", "node-lifecycle controller"],
      ],
      view: "cluster",
      focus: ["api", "kcm", "node2"],
      events: [
        ev({
          id: "dk3", at: 40000, src: "node-lifecycle ctrl", dst: API, layer: "control", size: "0.5 KB", title: "NOT READY", path: ["kcm", "node2"],
          says: "Forty seconds after the last renewal, the controller declares node-2 NotReady.",
          info: "PATCH …/nodes/node-2  Ready=Unknown + taint unreachable",
          decoded: [sec("NODE UPDATE", [["conditions.Ready", "True → Unknown", true], ["taint added", "node.kubernetes.io/unreachable:NoExecute", true], ["checked against", "lease renewTime + 40 s"], ["timer", "node-monitor-grace-period · 40 s in this cluster"]])],
        }),
        ev({
          id: "dk4", at: 41000, src: "endpointslice ctrl", dst: API, layer: "control", size: "0.7 KB", title: "ENDPOINTS DRAIN", path: ["kcm", "api"],
          says: "The dark node's Pods are marked not ready, so the Service stops sending them new traffic.",
          info: "endpoints web: 10.244.2.17, 10.244.2.18 → ready=false",
          decoded: [sec("ENDPOINTSLICE", [["10.244.2.17", "ready=true → false", true], ["10.244.2.18", "ready=true → false"], ["why", "node-lifecycle marked the Pods Ready=False"], ["serving now", "1 of 3 - capacity down, not down-time"]])],
        }),
      ],
    },
    {
      title: "THE GRACE",
      subtitle: "why the cluster waits five minutes",
      body: "The taint says execute nothing here - but existing Pods don't vanish, because every Pod carries an automatic toleration for unreachable that lasts 300 seconds. The wait is a bet: most failures are transient, and evicting a node's workload onto survivors is expensive. So the cluster holds its breath for five minutes - recover in time and the Pods never noticed.",
      facts: [
        ["AUTOMATIC TOLERATION", "unreachable:NoExecute · 300 s"],
        ["ALSO", "not-ready:NoExecute · 300 s"],
        ["THE BET", "most node failures are brief"],
        ["TUNABLE", "tolerationSeconds per Pod"],
      ],
      view: "cluster",
      focus: ["api", "kcm", "node2"],
      events: [
        ev({
          id: "dk5", at: 41500, src: "node-lifecycle ctrl", dst: "node-lifecycle ctrl", layer: "control", size: " - ", title: "COUNTING DOWN", path: ["kcm", "kcm"],
          says: "For five minutes, the system deliberately does nothing about the missing Pods.",
          info: "toleration expires at 10:47:40Z (taint + 300 s)",
          decoded: [sec("THE WAIT", [["taint", "unreachable since 10:42:40"], ["tolerationSeconds", "300 (every Pod's default)", true], ["expires", "10:47:40"], ["reason", "rescheduling a DB or a busy node on a blip is worse than waiting"]])],
        }),
      ],
    },
    {
      title: "EVICTED",
      subtitle: "deleted, stuck, replaced",
      body: `The toleration expires and the taint-eviction controller deletes the Pods. It's an ordinary graceful delete: deletionTimestamp is set and the API waits for the kubelet to confirm, which can't happen, so the objects sit in Terminating. That's enough for the ReplicaSet controller, which doesn't count terminating Pods. Seeing 1 of 3, it does exactly what the last lesson showed: creates replacements, and the scheduler places them on node-1. Detection 40 s, grace 300 s, rebuild ~7 s.`,
      facts: [
        ["AT +340 S", "Pods deleted · stuck Terminating"],
        ["REPLACEMENTS", "2 × web on node-1"],
        ["WHY STUCK", "no kubelet to confirm"],
        ["TIMELINE", "40 + 300 + 7 s"],
      ],
      view: "cluster",
      focus: ["api", "kcm", "node1"],
      pods: { node2: ["other", "terminating", "terminating"] },
      events: [
        ev({
          id: "dk6", at: 340000, src: "taint-eviction ctrl", dst: API, layer: "drop", size: "0.4 KB", title: "EVICT", path: ["kcm", "api"],
          says: "The grace runs out and the Pods are deleted. They stay Terminating, because no kubelet can confirm.",
          info: "DELETE …/pods web-…-x2kqp, web-…-p8m4z (grace 30 s)",
          decoded: [sec("EVICTION", [["deletionTimestamp", "set", true], ["confirmation", "needs node-2's kubelet - it's off"], ["state", "Terminating, until node-2 returns or someone force-deletes", true]])],
          note: "A StatefulSet wouldn't move on here: it waits for the old Pod to be truly gone before reusing its name, so its Pod stays down until node-2 returns or you force-delete it.",
        }),
        ev({
          id: "dk7", at: 340100, src: "replicaset ctrl", dst: API, layer: "control", size: "2.3 KB", title: "REBUILD ×2", path: ["kcm", "api"],
          says: "The ReplicaSet does its ordinary arithmetic: wants 3, has 1, creates 2.",
          info: "POST …/pods ×2 (scheduler → node-1)",
          decoded: [sec("RECONCILE, AGAIN", [["have", "1 (node-1) · terminating Pods don't count"], ["creates", "web-…-t4c8e, web-…-v7m2kp", true], ["placed", "node-1 - the only live node"]])],
          pods: { node2: ["other"], node1: ["other", "v1", "starting", "starting"] },
        }),
        ev({
          id: "dk8", at: 347000, src: "kubelet · node-1", dst: API, layer: "api", size: "0.9 KB", title: "BACK TO THREE", path: ["node1", "api"],
          says: "Seven seconds later, three web Pods are Ready again - all on node-1.",
          info: "PATCH …/pods/…/status Ready=True (×2)",
          decoded: [sec("RECOVERED", [["web serving", "3 of 3", true], ["elapsed since power loss", "≈ 5 min 47 s"], ["nobody migrated anything", "these are newborn Pods"]])],
          pods: { node1: ["other", "v1", "v1", "v1"] },
          note: "Nothing moves a running Pod between nodes. 'Rescheduling' means: delete the object, build a new Pod, with a new IP and no memory, somewhere that works.",
        }),
      ],
    },
    {
      title: "THE NODE RETURNS",
      subtitle: "power restored, slate clean",
      body: "Power comes back. node-2's kubelet starts, renews the lease, and the controller flips the node Ready and drops the taint - the reverse of step 2. The kubelet's first chore is cleanup: it sees the two Terminating Pods, confirms they're gone, and their objects are finally removed. The scheduler will use node-2 for future Pods; the web Pods that ran there are history, replaced on node-1 four minutes ago. A returned node contributes capacity, not continuity.",
      facts: [
        ["LEASE", "renewed on kubelet start"],
        ["READY", "Unknown → True · taint removed"],
        ["OLD PODS", "gone - replaced elsewhere"],
        ["BALANCE", "returns with future placements"],
      ],
      view: "cluster",
      focus: ["api", "kcm", "node1", "node2"],
      events: [
        ev({
          id: "dk9", at: 600000, src: K2, dst: API, layer: "api", size: "0.2 KB", title: "HEARTBEAT RETURNS", path: ["node2", "api"],
          says: "node-2's kubelet boots and renews its lease like nothing happened.",
          info: `PUT ${LEASE}  renewTime 10:51:20Z`,
          decoded: [sec("RENEWAL", [["spec.renewTime", "10:51:20Z", true], ["holder", "node-2 - same identity"], ["stuck Pods", "x2kqp, p8m4z confirmed gone · objects removed", true]])],
        }),
        ev({
          id: "dk10", at: 600100, src: "node-lifecycle ctrl", dst: API, layer: "control", size: "0.5 KB", title: "READY AGAIN", path: ["kcm", "node2"],
          says: "One update later the node is Ready and schedulable, empty and willing.",
          info: "PATCH …/nodes/node-2  Ready=True − taint",
          decoded: [sec("REJOIN", [["conditions.Ready", "Unknown → True", true], ["taint", "removed"], ["Pods on node-2", "only what the scheduler sends next"], ["cluster", "capacity 2 nodes again"]])],
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "last renewal → power loss", layer: "api", start: 0, duration: 10000 },
    { value: "t2", label: "silence → NotReady", layer: "control", start: 10000, duration: 30000 },
    { value: "t3", label: "toleration countdown", layer: "control", start: 40000, duration: 300000 },
    { value: "t4", label: "evict + rebuild on node-1", layer: "drop", start: 340000, duration: 7000 },
    { value: "t5", label: "node-2 back Ready", layer: "control", start: 600000, duration: 200 },
  ],
  summary: {
    title: "ABSENCE, HANDLED",
    body: "A dead node is detected as an absence, absorbed as a capacity loss, and repaired by ordinary reconcile loops once the grace expires: 40 seconds to notice, 300 to give it the benefit of the doubt, seven to rebuild. The two timers are the whole policy - shrink both for faster failover, raise both to ride out blips without churning your workload.",
    facts: [
      ["DETECTION", "40 s (lease deadline)"],
      ["GRACE", "300 s (tolerationSeconds)"],
      ["NEXT", "Draining a node"],
    ],
  },
}
