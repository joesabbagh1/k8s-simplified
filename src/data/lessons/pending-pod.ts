import type { Lesson } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const SCHED = "kube-scheduler"
const RC = "replicaset ctrl"
const DC = "deployment ctrl"
const K2 = "kubelet · node-2"
const OLD = "search-…-tjwq6"
const NEW = "search-…-59nsf"

export const pendingPod: Lesson = {
  id: "pending-pod",
  title: "Why is my Pod Pending?",
  subtitle: "Reading FailedScheduling",
  category: "control",
  seo: {
    title: "Kubernetes Pod stuck in Pending: why and fixes",
    description: "Debug a Kubernetes Pod stuck in Pending: read the FailedScheduling message, match each reason to its node, and fix taints, affinity and CPU requests.",
  },
  actors: ["you", "cp", "node1", "node2", "search-pod", "search-pod2"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: { [K2]: "node-2" },
  overview: {
    body: "A new Pod sits in Pending and nothing seems to be wrong with it. The answer is already in the cluster, in one dense sentence the scheduler wrote. Read it piece by piece, match each piece to the node it's about, fix one blocker - and find the next one that was hiding behind it.",
    facts: [
      ["POD", "search · 3 CPU · nodeSelector disk=ssd"],
      ["NODE-1", "1.1 CPU free · tainted for batch jobs"],
      ["NODE-2", "2.8 CPU free · has an SSD, has no label"],
      ["SYMPTOM", "0/2 nodes are available"],
    ],
  },
  steps: [
    {
      title: "A POD WITH NO NODE",
      subtitle: "created, saved, not running",
      body: `You apply a Deployment called search: one replica, 3 CPU requested, and a nodeSelector that only accepts nodes labelled disk=ssd. The API server saves it and the controllers create a Pod, all without complaint. But ${OLD} has an empty spec.nodeName, so no kubelet owns it and nothing will start it. kubectl get pods says Pending.`,
      facts: [
        ["POD", `${OLD} · Pending`],
        ["REQUESTS", "cpu 3 · memory 2Gi"],
        ["NODE SELECTOR", "disk=ssd"],
        ["SPEC.NODENAME", "empty"],
      ],
      view: "cluster",
      focus: ["you", "api", "kcm", "search-pod"],
      events: [
        ev({
          id: "pp1", at: 0, src: "kubectl", dst: API, layer: "api", size: "0.6 KB", title: "APPLY SEARCH", path: ["you", "api"],
          says: "You apply the search Deployment. The API server accepts it.",
          info: "POST /apis/apps/v1/namespaces/default/deployments",
          decoded: [
            sec("HTTP/2 REQUEST", [["method", "POST"], ["path", "/apis/apps/v1/namespaces/default/deployments"], ["response", "201 Created"]]),
            sec("BODY · DEPLOYMENT", [["spec.replicas", "1"], ["…nodeSelector", "disk: ssd", true], ["…requests.cpu", "3", true], ["…requests.memory", "2Gi"], ["…tolerations", "none set", true]]),
          ],
          note: "Nothing here checks whether any node could run the Pod. The API server validates the object's shape; whether it fits is the scheduler's question, asked later.",
        }),
        ev({
          id: "pp2", at: 18, src: RC, dst: API, layer: "api", size: "1.9 KB", title: "CREATE THE POD", path: ["kcm", "api"],
          says: "The Deployment and ReplicaSet controllers do their part: one Pod, with no node yet.",
          info: "POST /api/v1/namespaces/default/pods  search-5698d4f47c-tjwq6",
          res: { "search-pod": { kind: "pod", name: `Pod ${OLD}`, sub: "Pending · no node", state: "creating" } },
          decoded: [sec("BODY · POD", [["metadata.name", "search-5698d4f47c-tjwq6"], ["spec.nodeName", "(empty)", true], ["status.phase", "Pending"], ["priority", "0"]])],
        }),
      ],
    },
    {
      title: "TWO NODES, TWO VETOES",
      subtitle: "the first failed check ends it",
      body: "The scheduler runs its filters on each node, in order: taints, then node affinity, then resources. The first one that fails ends the check for that node. On node-1 that's the taint dedicated=batch:NoSchedule. On node-2 it's the missing disk=ssd label: the SSD is there, nobody labelled it. Neither node got as far as the CPU check, so nobody knows yet that 3 CPU wouldn't fit on either of them.",
      facts: [
        ["ORDER", "TaintToleration → NodeAffinity → NodeResourcesFit"],
        ["NODE-1", "TaintToleration ✗ · rest not checked"],
        ["NODE-2", "NodeAffinity ✗ · rest not checked"],
        ["FEASIBLE", "0 of 2"],
      ],
      view: "cluster",
      focus: ["api", "sched", "node1", "node2", "search-pod"],
      events: [
        ev({
          id: "pp3", at: 20, src: API, dst: SCHED, layer: "control", size: "1.9 KB", title: "UNSCHEDULED POD SEEN", path: ["api", "sched"],
          says: "The scheduler's watch delivers a Pod with no node.",
          info: `WATCH ADDED Pod ${OLD} (spec.nodeName "")`,
          decoded: [sec("SCHEDULING QUEUE", [["event", "UnscheduledPodAdd"], ["queue", "active", true], ["priority", "0"]])],
        }),
        ev({
          id: "pp4", at: 21, src: SCHED, dst: SCHED, layer: "drop", size: " - ", title: "NODE-1: TAINTED", path: ["node1", "node1"],
          says: "node-1 is out at the first filter: it has a taint this Pod doesn't tolerate.",
          info: "TaintToleration ✗ node-1 · dedicated=batch:NoSchedule",
          decoded: [sec("FILTERS ON NODE-1", [["NodeUnschedulable", "✓ not cordoned"], ["TaintToleration", "✗ dedicated=batch:NoSchedule", true], ["NodeAffinity", "not checked"], ["NodeResourcesFit", "not checked"]])],
          note: "The check runs inside the scheduler, on its cached copy of the node; nothing is sent to node-1. NoSchedule only stops new Pods, so the web Pod already there keeps running.",
        }),
        ev({
          id: "pp5", at: 21, src: SCHED, dst: SCHED, layer: "drop", size: " - ", title: "NODE-2: NO LABEL", path: ["node2", "node2"],
          says: "node-2 has no taint, but it isn't labelled disk=ssd, so it's out too.",
          info: "NodeAffinity ✗ node-2 · disk=ssd not found",
          decoded: [sec("FILTERS ON NODE-2", [["NodeUnschedulable", "✓ not cordoned"], ["TaintToleration", "✓ no taints"], ["NodeAffinity", "✗ no label disk=ssd", true], ["NodeResourcesFit", "not checked", true]])],
          note: "nodeSelector and nodeAffinity are handled by the same plugin, NodeAffinity. That's why the message says node affinity/selector even if you only set one of them.",
        }),
      ],
    },
    {
      title: "THE VERDICT IS SAVED",
      subtitle: "one condition, one event",
      body: "No node passed, so the scheduler asks whether evicting lower-priority Pods would help. It wouldn't: neither a taint nor a missing label goes away when Pods leave. It writes its answer down in two places, the Pod's PodScheduled condition and a FailedScheduling event, and parks the Pod in its unschedulable pool. It is not retrying in a loop. It waits for something in the cluster to change.",
      facts: [
        ["CONDITION", "PodScheduled=False · Unschedulable"],
        ["EVENT", "Warning · FailedScheduling"],
        ["PARKED IN", "the unschedulable pool"],
        ["WAITS ON", "NodeAffinity · TaintToleration"],
      ],
      view: "cluster",
      focus: ["api", "sched", "search-pod"],
      events: [
        ev({
          id: "pp6", at: 22, src: SCHED, dst: SCHED, layer: "control", size: " - ", title: "PREEMPTION WON'T HELP", path: ["sched", "sched"],
          says: "Could evicting other Pods make room? Not here: no Pod is in the way.",
          info: "preemption: 0/2 nodes · 2 Preemption is not helpful for scheduling",
          decoded: [sec("PREEMPTION", [["node-1", "not helpful - the taint would stay"], ["node-2", "not helpful - the label would still be missing"], ["candidates", "0", true]])],
        }),
        ev({
          id: "pp7", at: 24, src: SCHED, dst: API, layer: "api", size: "0.5 KB", title: "PODSCHEDULED=FALSE", path: ["sched", "api"],
          says: "The scheduler writes why onto the Pod itself, as a condition.",
          info: `PATCH …/pods/${OLD}/status  PodScheduled=False`,
          res: { "search-pod": { kind: "pod", name: `Pod ${OLD}`, sub: "Pending · Unschedulable", state: "creating" } },
          decoded: [sec("STATUS PATCH", [["conditions.type", "PodScheduled"], ["status", "False", true], ["reason", "Unschedulable", true], ["message", "0/2 nodes are available: 1 node(s) didn't match Pod's node affinity/selector, 1 node(s) had untolerated taint(s). preemption: 0/2 nodes are available: 2 Preemption is not helpful for scheduling.", true]])],
        }),
        ev({
          id: "pp8", at: 26, src: SCHED, dst: API, layer: "api", size: "0.7 KB", title: "FAILEDSCHEDULING", path: ["sched", "api"],
          says: "It records the same sentence as an event, the one kubectl describe will show you.",
          info: "POST /apis/events.k8s.io/v1/…/events  FailedScheduling",
          decoded: [sec("EVENT", [["type", "Warning"], ["reason", "FailedScheduling", true], ["reportingController", "default-scheduler"], ["regarding", `Pod ${OLD}`], ["note", "same text as the condition"]])],
          note: "Events are deleted after an hour by default (the API server's --event-ttl). The condition stays on the Pod, so check it when the events are gone: kubectl get pod <name> -o yaml.",
        }),
      ],
    },
    {
      title: "READ THE MESSAGE",
      subtitle: "a count and a reason, per node",
      body: "First look at Node in kubectl describe. If it's empty, the scheduler hasn't placed the Pod, and the event says why. If a node is named, scheduling worked and the hold-up is on that node's kubelet: an image pull, a volume. Here it's empty. Now read the event: 0/2 is how many nodes fit, and each number after it counts the nodes with that reason. It doesn't name the nodes. Their labels and taints do.",
      facts: [
        ["NODE", "<none> → look at the scheduler"],
        ["0/2", "nodes that fit / nodes in all"],
        ["1 DIDN'T MATCH", "node-2 · no disk=ssd"],
        ["1 UNTOLERATED TAINT(S)", "node-1 · dedicated=batch"],
      ],
      view: "cluster",
      focus: ["you", "api", "node1", "node2", "search-pod"],
      events: [
        ev({
          id: "pp9", at: 60000, src: "kubectl", dst: API, layer: "api", size: "4.1 KB", title: "DESCRIBE THE POD", path: ["you", "api"],
          says: "A minute later you ask. Node is empty, so this is the scheduler's answer to read.",
          info: `kubectl describe pod ${OLD}`,
          decoded: [
            sec("WHERE IT'S STUCK", [["Node", "<none>", true], ["PodScheduled", "False"]]),
            sec("EVENTS · FAILEDSCHEDULING", [["nodes that fit", "0/2 nodes are available"], ["node-2", "1 node(s) didn't match Pod's node affinity/selector", true], ["node-1", "1 node(s) had untolerated taint(s)", true], ["preemption", "2 Preemption is not helpful for scheduling"]]),
          ],
          note: "Up to Kubernetes 1.34 the message named the taint: 1 node(s) had untolerated taint {dedicated: batch}. From 1.35 it only counts, so you have to look at the nodes.",
        }),
        ev({
          id: "pp10", at: 75000, src: "kubectl", dst: API, layer: "api", size: "6.8 KB", title: "CHECK THE TAINTS", path: ["you", "api"],
          says: "You list the nodes' taints. The taint is on node-1.",
          info: "kubectl get nodes -o custom-columns=NAME:.metadata.name,TAINTS:.spec.taints",
          decoded: [sec("TAINTS", [["node-1", "dedicated=batch:NoSchedule", true], ["node-2", "<none>"]])],
        }),
        ev({
          id: "pp11", at: 90000, src: "kubectl", dst: API, layer: "api", size: "6.8 KB", title: "CHECK THE LABELS", path: ["you", "api"],
          says: "You list the disk label. No node has it, so the selector can't match anywhere.",
          info: "kubectl get nodes -L disk",
          decoded: [sec("LABEL DISK", [["node-1", "(none)"], ["node-2", "(none) - this is the one with the SSD", true]])],
        }),
      ],
    },
    {
      title: "FIX ONE, FIND ANOTHER",
      subtitle: "the label was hiding something",
      body: "node-1 is reserved for batch on purpose, so leave its taint alone. node-2 does have an SSD, so you give it the label. The parked Pod was waiting for exactly that: the node change reaches the scheduler, the NodeAffinity plugin says this one matters, and the Pod goes back in the queue. node-2 now passes the label check, reaches the CPU check for the first time, and fails it. Still 0/2, but the reason changed. That's progress.",
      facts: [
        ["FIX", "kubectl label node node-2 disk=ssd"],
        ["WOKEN BY", "NodeUpdateNodeLabel"],
        ["BEFORE", "1 didn't match · 1 untolerated taint(s)"],
        ["AFTER", "1 Insufficient cpu · 1 untolerated taint(s)"],
      ],
      view: "cluster",
      focus: ["you", "api", "sched", "node2", "search-pod"],
      events: [
        ev({
          id: "pp12", at: 120000, src: "kubectl", dst: API, layer: "api", size: "0.2 KB", title: "LABEL NODE-2", path: ["you", "api"],
          says: "You add the missing label to node-2.",
          info: "PATCH /api/v1/nodes/node-2  labels disk=ssd",
          decoded: [sec("PATCH", [["metadata.labels.disk", "(none) → ssd", true]])],
        }),
        ev({
          id: "pp13", at: 120004, src: API, dst: SCHED, layer: "control", size: "5.2 KB", title: "THE POD WAKES UP", path: ["api", "sched"],
          says: "The scheduler hears of the new label and puts the parked Pod back in its queue.",
          info: "WATCH MODIFIED Node node-2 → requeue",
          decoded: [sec("QUEUEING HINT", [["event", "NodeUpdateNodeLabel"], ["asked", "NodeAffinity, one of the plugins that rejected it"], ["old node", "didn't match"], ["new node", "matches", true], ["queue", "unschedulable → active", true]])],
          note: "Plugins answer these hints so unrelated changes don't wake every parked Pod. A Pod that failed moments ago backs off first, from 1 second up to 10, and one that has been parked for 5 minutes is tried again regardless.",
        }),
        ev({
          id: "pp14", at: 120005, src: SCHED, dst: SCHED, layer: "drop", size: " - ", title: "NODE-2: NOT ENOUGH CPU", path: ["node2", "node2"],
          says: "node-2 gets past the label check, and fails the next one: CPU.",
          info: "NodeResourcesFit ✗ node-2 · wants 3, 2.8 left",
          decoded: [sec("FILTERS ON NODE-2", [["TaintToleration", "✓ no taints"], ["NodeAffinity", "✓ disk=ssd", true], ["NodeResourcesFit", "✗ cpu: wants 3, 2.8 left", true]])],
        }),
        ev({
          id: "pp15", at: 120009, src: SCHED, dst: API, layer: "api", size: "0.7 KB", title: "A NEW REASON", path: ["sched", "api"],
          says: "Still 0/2, but the sentence is different: the CPU problem is now visible.",
          info: "FailedScheduling · 1 Insufficient cpu, 1 node(s) had untolerated taint(s)",
          res: { "search-pod": { kind: "pod", name: `Pod ${OLD}`, sub: "Pending · Insufficient cpu", state: "creating" } },
          decoded: [sec("EVENT", [["reason", "FailedScheduling"], ["nodes that fit", "0/2 nodes are available"], ["node-2", "1 Insufficient cpu", true], ["node-1", "1 node(s) had untolerated taint(s)"], ["preemption", "1 No preemption victims found for incoming pod, 1 Preemption is not helpful for scheduling"]])],
          note: "Evicting Pods would free CPU on node-2, so this time preemption is tried. It finds no victims: every Pod there has the same priority, 0.",
        }),
      ],
    },
    {
      title: "REQUESTS, NOT USAGE",
      subtitle: "an idle node can be full",
      body: "node-2 is barely busy: 340m of its 4 CPU are in use. The scheduler doesn't look at usage. It adds up the requests of the Pods on the node, 1.2 CPU, and calls the remaining 2.8 free. Three doesn't fit, whether or not anyone is using it. You measure search, find it peaks at 1.6 CPU, and lower the request to 2. A Deployment's Pods are replaced, not edited, so this creates a new Pod.",
      facts: [
        ["ALLOCATABLE", "4 CPU"],
        ["REQUESTED", "1200m (30%) · free 2.8"],
        ["IN USE", "340m · not considered"],
        ["REQUEST", "cpu 3 → 2"],
      ],
      view: "cluster",
      focus: ["you", "api", "kcm", "node2", "search-pod", "search-pod2"],
      events: [
        ev({
          id: "pp16", at: 180000, src: "kubectl", dst: API, layer: "api", size: "5.4 KB", title: "DESCRIBE NODE-2", path: ["you", "api"],
          says: "You check what node-2 has promised to its Pods, rather than what they use.",
          info: "kubectl describe node node-2 · Allocated resources",
          decoded: [
            sec("ALLOCATED RESOURCES", [["allocatable cpu", "4"], ["cpu requests", "1200m (30%)", true], ["left to request", "2.8"], ["search wants", "3", true]]),
            sec("KUBECTL TOP NODE", [["cpu in use", "340m (8%)"], ["used by the scheduler", "no", true]]),
          ],
          note: "The requests are two web Pods at 500m each and 200m of system Pods.",
        }),
        ev({
          id: "pp17", at: 240000, src: "kubectl", dst: API, layer: "api", size: "0.3 KB", title: "LOWER THE REQUEST", path: ["you", "api"],
          says: "You lower the CPU request from 3 to 2.",
          info: "kubectl set resources deployment search --requests=cpu=2,memory=2Gi",
          decoded: [sec("PATCH", [["…requests.cpu", "3 → 2", true], ["metadata.generation", "1 → 2"], ["template hash", "5698d4f47c → 75668fb989", true]])],
        }),
        ev({
          id: "pp18", at: 240018, src: RC, dst: API, layer: "api", size: "1.9 KB", title: "A REPLACEMENT POD", path: ["kcm", "api"],
          says: "A new ReplicaSet creates a new Pod. The old one stays Pending for now.",
          info: "POST /api/v1/namespaces/default/pods  search-75668fb989-59nsf",
          res: { "search-pod2": { kind: "pod", name: `Pod ${NEW}`, sub: "Pending · no node", state: "creating" } },
          decoded: [sec("BODY · POD", [["metadata.name", "search-75668fb989-59nsf"], ["…requests.cpu", "2", true], ["spec.nodeName", "(empty)"]])],
          note: "The default rolling update with one replica may add one Pod (maxSurge 25%, rounded up) and may not remove any (maxUnavailable 25%, rounded down), so the old Pod is kept until the new one is ready.",
        }),
      ],
    },
    {
      title: "BOUND",
      subtitle: "one fitting node is enough",
      body: "Same filters, new answer: node-1 still refuses, node-2 passes all of them, and one is all it takes. The scheduler binds the Pod to node-2. For a moment kubectl get pods still says Pending, but now with a node beside it: the kubelet has it and is starting the container. Once it's Ready, the Deployment scales its old ReplicaSet to zero and the stuck Pod is deleted at once, since it never ran anywhere.",
      facts: [
        ["FEASIBLE", "1 of 2 · node-2"],
        ["NODE-2 AFTER", "3.2 of 4 CPU requested"],
        ["NODE-1", "taint untouched"],
        ["OLD POD", "deleted · no grace period"],
      ],
      view: "cluster",
      focus: ["api", "sched", "kcm", "node2", "search-pod", "search-pod2"],
      events: [
        ev({
          id: "pp19", at: 240020, src: SCHED, dst: SCHED, layer: "control", size: " - ", title: "NODE-2 FITS", path: ["sched", "sched"],
          says: "The filters run again: node-1 still refuses, node-2 passes every one.",
          info: "evaluatedNodes=2 feasibleNodes=1",
          decoded: [sec("FILTER RESULTS", [["node-1", "✗ TaintToleration"], ["node-2", "✓ taints ✓ disk=ssd ✓ cpu 2 ≤ 2.8", true], ["scoring", "skipped - only one node left"]])],
        }),
        ev({
          id: "pp20", at: 240023, src: SCHED, dst: API, layer: "api", size: "0.3 KB", title: "BINDING → NODE-2", path: ["sched", "api"],
          says: "The scheduler binds the new Pod to node-2.",
          info: `POST …/pods/${NEW}/binding`,
          res: { "search-pod2": { kind: "pod", name: `Pod ${NEW}`, sub: "Pending · node-2" } },
          decoded: [sec("BODY · BINDING", [["target.name", "node-2", true], ["PodScheduled", "True", true], ["status.phase", "Pending - until its container starts"]])],
          note: "Phase Pending covers everything before the first container starts. Scheduled but still Pending means the image, volumes or network on that node.",
        }),
        ev({
          id: "pp21", at: 240030, src: API, dst: K2, layer: "control", size: "2.0 KB", title: "KUBELET PICKS IT UP", path: ["api", "node2"],
          says: "node-2's kubelet sees the Pod on its watch and starts it.",
          info: `WATCH ADDED Pod ${NEW} (nodeName node-2)`,
          pods: { node2: ["other", "v1", "v1", "starting"] },
          res: { "search-pod2": null },
          decoded: [sec("WATCH STREAM", [["nodeName", "node-2", true], ["next", "sandbox, network, image, container"]])],
        }),
        ev({
          id: "pp22", at: 243400, src: K2, dst: API, layer: "api", size: "1.1 KB", title: "READY", path: ["node2", "api"],
          says: "The container is up and the Pod is Ready.",
          info: `PATCH …/pods/${NEW}/status  Running · Ready=True`,
          pods: { node2: ["other", "v1", "v1", "v2"] },
          decoded: [sec("STATUS PATCH", [["status.phase", "Pending → Running", true], ["Ready", "True", true]])],
        }),
        ev({
          id: "pp23", at: 243430, src: DC, dst: API, layer: "api", size: "0.3 KB", title: "SCALE THE OLD ONE AWAY", path: ["kcm", "api"],
          says: "The Deployment scales its old ReplicaSet to zero, and the stuck Pod is gone.",
          info: "PATCH …/replicasets/search-5698d4f47c  replicas 1 → 0",
          res: { "search-pod": null },
          decoded: [sec("CLEANUP", [["old ReplicaSet", "replicas 1 → 0", true], [OLD, "deleted by the ReplicaSet controller", true], ["grace period", "0 - it never had a node"]])],
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "created → unschedulable", layer: "drop", start: 0, duration: 26 },
    { value: "t2", label: "parked · waiting for a change", layer: "state", start: 26, duration: 119974 },
    { value: "t3", label: "label added → new reason", layer: "drop", start: 120000, duration: 9 },
    { value: "t4", label: "parked again · you read the node", layer: "state", start: 120009, duration: 119991 },
    { value: "t5", label: "request lowered → bound", layer: "control", start: 240000, duration: 23 },
    { value: "t6", label: "bound → Ready", layer: "node", start: 240023, duration: 3377 },
  ],
  timingNote: "The minutes are you, reading and deciding. The scheduler's own answers took milliseconds.",
  summary: {
    title: "ONE SENTENCE, READ SLOWLY",
    body: "An empty Node means the scheduler is holding the Pod; a filled one means the kubelet is. FailedScheduling counts nodes by the first check each one failed, so a fix can reveal another reason, and a changed message is progress. If every reason is right and nothing should change, the cluster needs room: a cluster autoscaler can add a node, and a higher-priority Pod can preempt others.",
    facts: [
      ["INSUFFICIENT CPU / MEMORY", "lower the request, free some, or add a node"],
      ["UNTOLERATED TAINT(S)", "another node, or add a toleration"],
      ["DIDN'T MATCH SELECTOR", "fix the label or the selector"],
      ["WERE UNSCHEDULABLE", "cordoned · kubectl uncordon"],
      ["UNBOUND IMMEDIATE PVC", "the claim has no volume yet"],
      ["NEXT", "Reconcile loops"],
    ],
  },
}
