import type { Lesson, Resource } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const SCHED = "kube-scheduler"
const KCM = "kube-controller-manager"
const K1 = "kubelet · node-1"
const K2 = "kubelet · node-2"
const FIRST = "web-…-x2kqp"
const SECOND = "web-…-p8m4z"
const NEW1 = "web-…-h7c2d"
const NEW2 = "web-…-m3w9f"
const BLOCKED = "Cannot evict pod as it would violate the pod's disruption budget."

const pdb = (healthy: number, allowed: number, state?: Resource["state"]): Resource => ({
  kind: "pdb", name: "PDB web-pdb", sub: `${healthy} healthy · ${allowed} allowed`, state,
})
const rs = (sub: string): Resource => ({ kind: "replicaset", name: "ReplicaSet …d8b4", sub })

export const drainingANode: Lesson = {
  id: "draining-a-node",
  title: "Draining a node",
  subtitle: "Cordon, evict, PodDisruptionBudget",
  category: "control",
  seo: {
    title: "kubectl drain and PodDisruptionBudgets",
    description: "What kubectl drain does to a Kubernetes node: cordon, evict each Pod through the Eviction API, wait on a PodDisruptionBudget, and leave only DaemonSets.",
  },
  actors: ["you", "cp", "node1", "node2", "web-rs", "web-pdb"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  res: { "web-rs": rs("3 Pods") },
  lanes: {
    kubectl: "you",
    [API]: "control plane", [SCHED]: "control plane", [KCM]: "control plane",
    [K1]: "node-1", [K2]: "node-2",
  },
  overview: {
    body: "node-2 needs a kernel update. Before you reboot it, its Pods have to go somewhere else, without taking web below what it needs to serve. kubectl drain does that in two moves: it cordons the node so nothing new lands there, then evicts each Pod through the Eviction API. Every eviction is checked against web's PodDisruptionBudget, which says two of its three Pods must stay healthy. Two of them are on node-2, so one has to wait.",
    facts: [
      ["NODE", "node-2 · 2 of web's 3 Pods"],
      ["BUDGET", "web-pdb · minAvailable 2"],
      ["COMMAND", "kubectl drain node-2 --ignore-daemonsets"],
      ["DRAINED IN", "≈ 10 s in this run"],
    ],
  },
  steps: [
    {
      title: "THE BUDGET",
      subtitle: "how many Pods must stay up",
      body: "You give web a PodDisruptionBudget: at least two Pods matching app=web must be healthy, which means Ready. The disruption controller in the controller manager counts them and keeps the budget's status current: three healthy, two required, so one disruption is allowed. The budget only limits voluntary evictions that go through the Eviction API. A node that dies, a Pod you delete directly or an OOM kill doesn't ask it.",
      facts: [
        ["SELECTOR", "app=web"],
        ["MIN AVAILABLE", "2"],
        ["STATUS", "3 healthy · 1 disruption allowed"],
        ["LIMITS", "evictions only · not crashes or deletes"],
      ],
      view: "cluster",
      focus: ["you", "api", "kcm", "web-pdb", "web-rs"],
      events: [
        ev({
          id: "dr1", at: 0, src: "kubectl", dst: API, layer: "api", size: "0.3 KB", title: "CREATE THE BUDGET", path: ["you", "api"],
          says: "You create web-pdb: keep at least two web Pods healthy.",
          info: "POST /apis/policy/v1/namespaces/default/poddisruptionbudgets  web-pdb",
          res: { "web-pdb": pdb(0, 0, "creating") },
          decoded: [sec("BODY · PODDISRUPTIONBUDGET", [["apiVersion", "policy/v1"], ["spec.selector.matchLabels", "app: web"], ["spec.minAvailable", "2", true], ["spec.unhealthyPodEvictionPolicy", "unset · IfHealthyBudget"]])],
        }),
        ev({
          id: "dr2", at: 60, src: KCM, dst: API, layer: "control", size: "0.4 KB", title: "COUNT THE HEALTHY", path: ["kcm", "web-pdb"],
          says: "The disruption controller counts web's Ready Pods and writes the budget's status.",
          info: "PUT …/poddisruptionbudgets/web-pdb/status",
          res: { "web-pdb": pdb(3, 1, "active") },
          decoded: [sec("STATUS", [["expectedPods", "3 · from the ReplicaSet's replicas"], ["currentHealthy", "3 · Pods with Ready=True"], ["desiredHealthy", "2"], ["disruptionsAllowed", "1 · 3 − 2", true]])],
        }),
      ],
    },
    {
      title: "CORDON",
      subtitle: "no new Pods here",
      body: "You run kubectl drain node-2 --ignore-daemonsets. Its first move is a cordon: it sets spec.unschedulable on the Node. The node lifecycle controller turns that into a taint, node.kubernetes.io/unschedulable:NoSchedule, and the scheduler's NodeUnschedulable filter rules node-2 out for every new Pod. Nothing that is already running is touched. A cordon on its own changes nothing but where new Pods go.",
      facts: [
        ["FIELD", "spec.unschedulable: true"],
        ["TAINT", "node.kubernetes.io/unschedulable:NoSchedule"],
        ["RUNNING PODS", "untouched"],
        ["UNDO", "kubectl uncordon node-2"],
      ],
      view: "cluster",
      focus: ["you", "api", "kcm", "node2"],
      events: [
        ev({
          id: "dr3", at: 60000, src: "kubectl", dst: API, layer: "api", size: "0.2 KB", title: "CORDON NODE-2", path: ["you", "api"],
          says: "kubectl drain starts by marking node-2 unschedulable.",
          info: "PATCH /api/v1/nodes/node-2  spec.unschedulable=true",
          decoded: [sec("PATCH", [["spec.unschedulable", "false → true", true]]), sec("KUBECTL", [["prints", "node/node-2 cordoned"]])],
        }),
        ev({
          id: "dr4", at: 60100, src: KCM, dst: API, layer: "control", size: "0.3 KB", title: "THE UNSCHEDULABLE TAINT", path: ["kcm", "api"],
          says: "The node lifecycle controller adds the matching taint.",
          info: "PATCH /api/v1/nodes/node-2  taints +node.kubernetes.io/unschedulable:NoSchedule",
          decoded: [sec("NODE-2", [["spec.taints", "node.kubernetes.io/unschedulable:NoSchedule", true], ["kubectl get nodes", "Ready,SchedulingDisabled"]]), sec("SCHEDULER", [["NodeUnschedulable", "filters node-2 out of every new Pod"], ["DaemonSet Pods", "tolerate this taint"]])],
        }),
      ],
    },
    {
      title: "WHAT'S ON THE NODE",
      subtitle: "and what drain won't touch",
      body: "kubectl lists every Pod whose spec.nodeName is node-2 and sorts them. The kube-proxy and kube-flannel Pods belong to DaemonSets: evicting them is pointless, because their controller would put them straight back, so --ignore-daemonsets leaves them. Without that flag drain stops. It would also stop for a Pod with no controller, which nothing would recreate, unless you add --force, and for a Pod with an emptyDir volume, whose data would be lost, unless you add --delete-emptydir-data. That leaves web's two Pods.",
      facts: [
        ["ON NODE-2", "2 web Pods · kube-proxy · kube-flannel"],
        ["SKIPPED", "DaemonSet Pods · --ignore-daemonsets"],
        ["REFUSED WITHOUT --FORCE", "Pods with no controller"],
        ["TO EVICT", `${FIRST} · ${SECOND}`],
      ],
      view: "cluster",
      focus: ["you", "api", "node2"],
      events: [
        ev({
          id: "dr5", at: 60200, src: "kubectl", dst: API, layer: "api", size: "6.8 KB", title: "LIST NODE-2'S PODS", path: ["you", "api"],
          says: "kubectl asks for every Pod on node-2, in all namespaces.",
          info: "GET /api/v1/pods?fieldSelector=spec.nodeName=node-2",
          decoded: [sec("RESULT", [["default", `${FIRST} · ${SECOND} · owner ReplicaSet`, true], ["kube-system", "kube-proxy-b8x4n · owner DaemonSet"], ["kube-flannel", "kube-flannel-ds-l2v7k · owner DaemonSet"]])],
        }),
        ev({
          id: "dr6", at: 60210, src: "kubectl", dst: "kubectl", layer: "control", size: " - ", title: "FILTER", path: ["you", "you"],
          says: "DaemonSet Pods are skipped with a warning. The two web Pods will be evicted.",
          info: "Warning: ignoring DaemonSet-managed Pods: kube-flannel/kube-flannel-ds-l2v7k, kube-system/kube-proxy-b8x4n",
          decoded: [
            sec("FILTERS", [["DaemonSet-managed", "skipped · --ignore-daemonsets"], ["mirror (static) Pods", "skipped · the API can't delete them"], ["no controller", "none here · would need --force"], ["emptyDir", "none here · would need --delete-emptydir-data"]]),
            sec("WITHOUT THE FLAG", [["error", "cannot delete DaemonSet-managed Pods (use --ignore-daemonsets to ignore)"]]),
          ],
        }),
      ],
    },
    {
      title: "THE FIRST EVICTION",
      subtitle: "the budget allows one",
      body: "kubectl evicts both web Pods at once, each with a POST to the Pod's eviction subresource. For the first, the API server finds web-pdb and reads one disruption allowed. It lowers that to 0 and writes the Pod's name into the budget's disruptedPods before deleting anything, so a second eviction arriving in the same instant can't spend the same disruption. Then it deletes the Pod with its normal grace period, and node-2's kubelet starts shutting it down.",
      facts: [
        ["REQUEST", `POST …/pods/${FIRST}/eviction`],
        ["BUDGET", "1 allowed → 0"],
        ["ANSWER", "200 OK · Pod deleted gracefully"],
        ["GRACE", "terminationGracePeriodSeconds 30"],
      ],
      view: "cluster",
      focus: ["you", "api", "node2", "web-pdb"],
      events: [
        ev({
          id: "dr7", at: 60300, src: "kubectl", dst: API, layer: "api", size: "0.2 KB", title: "EVICT THE FIRST POD", path: ["you", "api"],
          says: "kubectl asks the API server to evict the first web Pod.",
          info: `POST /api/v1/namespaces/default/pods/${FIRST}/eviction`,
          decoded: [sec("BODY · EVICTION", [["apiVersion", "policy/v1"], ["kind", "Eviction"], ["metadata.name", FIRST, true], ["deleteOptions", "none · the Pod's own grace period"]])],
        }),
        ev({
          id: "dr8", at: 60310, src: API, dst: API, layer: "state", size: "0.5 KB", title: "SPEND THE DISRUPTION", path: ["api", "web-pdb"],
          says: "The API server takes the one allowed disruption and records the Pod in the budget.",
          info: "PUT …/poddisruptionbudgets/web-pdb/status  disruptionsAllowed 1 → 0",
          res: { "web-pdb": pdb(3, 0) },
          decoded: [sec("PDB STATUS", [["disruptionsAllowed", "1 → 0", true], [`disruptedPods.${FIRST}`, "the time of this eviction"], ["why first", "a racing eviction now reads 0"]])],
          note: "The status update uses the PDB's resourceVersion. If two evictions race, one update fails with a conflict and that eviction is checked again.",
        }),
        ev({
          id: "dr9", at: 60320, src: API, dst: K2, layer: "control", size: "2.4 KB", title: "DELETED, GRACEFULLY", path: ["api", "node2"],
          says: "The API server deletes the Pod. node-2's kubelet sees the deletion and begins the shutdown.",
          info: `200 OK · WATCH MODIFIED Pod ${FIRST} (deletionTimestamp)`,
          pods: { node2: ["other", "terminating", "v1"] },
          res: { "web-rs": rs("2 Pods · 1 more wanted") },
          decoded: [sec("POD", [["deletionTimestamp", "set", true], ["deletionGracePeriodSeconds", "30"], ["EndpointSlice", "10.244.2.17 · ready=false, terminating=true"], ["kubelet", "SIGTERM to web, as in Graceful shutdown"]])],
        }),
      ],
    },
    {
      title: "429",
      subtitle: "the second one has to wait",
      body: "The eviction for the second Pod arrives a moment later. The budget now allows 0 disruptions, so the API server refuses with 429 Too Many Requests and deletes nothing. 429 here doesn't mean the API server is overloaded: it means try again later. kubectl prints the error and retries the same eviction every five seconds, for as long as it takes, unless you gave drain a --timeout.",
      facts: [
        ["REQUEST", `POST …/pods/${SECOND}/eviction`],
        ["ANSWER", "429 Too Many Requests"],
        ["MESSAGE", BLOCKED],
        ["KUBECTL", "retries every 5 s · no timeout by default"],
      ],
      view: "cluster",
      focus: ["you", "api", "web-pdb"],
      events: [
        ev({
          id: "dr10", at: 60330, src: "kubectl", dst: API, layer: "api", size: "0.2 KB", title: "EVICT THE SECOND POD", path: ["you", "api"],
          says: "kubectl asks to evict the second web Pod.",
          info: `POST /api/v1/namespaces/default/pods/${SECOND}/eviction`,
          decoded: [sec("BODY · EVICTION", [["metadata.name", SECOND, true]]), sec("WEB-PDB RIGHT NOW", [["disruptionsAllowed", "0", true]])],
        }),
        ev({
          id: "dr11", at: 60335, src: API, dst: "kubectl", layer: "drop", size: "0.4 KB", title: "429 TOO MANY REQUESTS", path: ["api", "you"],
          says: "Refused: evicting it would leave web with fewer healthy Pods than the budget allows.",
          info: `429 · ${BLOCKED}`,
          decoded: [
            sec("STATUS", [["code", "429", true], ["reason", "TooManyRequests"], ["message", BLOCKED]]),
            sec("WEB-PDB STATUS", [["disruptionsAllowed", "0 · spent by the first eviction", true], ["currentHealthy", "still 3 · the controller hasn't recounted yet"]]),
            sec("KUBECTL PRINTS", [["stderr", `error when evicting pods/"${SECOND}" -n "default" (will retry after 5s): ${BLOCKED}`]]),
          ],
          note: "The API server doesn't count Pods itself. It reads disruptionsAllowed from the budget's status, which the first eviction set to 0, so it refuses even before the disruption controller has recounted.",
        }),
      ],
    },
    {
      title: "A REPLACEMENT",
      subtitle: "on node-1, because node-2 is cordoned",
      body: "Meanwhile the ReplicaSet counts two Pods where it wants three and creates a replacement. The scheduler's NodeUnschedulable filter rules out node-2, so the replacement lands on node-1. While it starts, the first Pod finishes shutting down. Once the replacement is Ready, the disruption controller counts three healthy Pods again and the budget allows one disruption.",
      facts: [
        ["NEW POD", `${NEW1} · node-1`],
        ["NODE-2", "filtered out · unschedulable"],
        ["FIRST POD", "gone after its shutdown"],
        ["BUDGET", "3 healthy · 1 allowed again"],
      ],
      view: "cluster",
      focus: ["api", "kcm", "sched", "node1", "node2", "web-rs", "web-pdb"],
      events: [
        ev({
          id: "dr12", at: 60360, src: KCM, dst: API, layer: "control", size: "2.1 KB", title: "A REPLACEMENT POD", path: ["kcm", "api"],
          says: "The ReplicaSet controller creates a Pod to get back to three.",
          info: `POST …/pods  ${NEW1}`,
          decoded: [sec("REPLICASET", [["spec.replicas", "3"], ["counted", "2 · a Pod being deleted doesn't count", true], ["creates", NEW1]])],
        }),
        ev({
          id: "dr13", at: 60400, src: SCHED, dst: API, layer: "api", size: "0.3 KB", title: "BIND TO NODE-1", path: ["sched", "api"],
          says: "node-2 is cordoned, so the scheduler places the replacement on node-1.",
          info: `POST …/pods/${NEW1}/binding  target node-1`,
          pods: { node1: ["other", "v1", "starting"] },
          decoded: [sec("FILTER", [["node-2", "✗ NodeUnschedulable", true], ["node-1", "✓"]])],
        }),
        ev({
          id: "dr14", at: 62500, src: K2, dst: API, layer: "api", size: "0.6 KB", title: "THE FIRST POD IS GONE", path: ["node2", "api"],
          says: "web exits after SIGTERM, and the kubelet finishes deleting the Pod.",
          info: `DELETE …/pods/${FIRST}  gracePeriodSeconds=0`,
          pods: { node2: ["other", "v1"] },
          decoded: [sec("SHUTDOWN", [["SIGTERM → exit", "2.2 s · well inside 30 s"], ["the kubelet", "confirms with a final delete", true], ["Pod object", "removed"]])],
        }),
        ev({
          id: "dr15", at: 64000, src: K1, dst: API, layer: "api", size: "1.3 KB", title: "THE REPLACEMENT IS READY", path: ["node1", "api"],
          says: "The replacement passes its readiness probe on node-1.",
          info: `PATCH …/pods/${NEW1}/status  Ready=True`,
          pods: { node1: ["other", "v1", "v1"] },
          res: { "web-rs": rs("3 Pods") },
          decoded: [sec("STATUS", [["Ready", "True", true], ["EndpointSlice", "10.244.1.14 added"]])],
        }),
        ev({
          id: "dr16", at: 64050, src: KCM, dst: API, layer: "control", size: "0.4 KB", title: "ONE ALLOWED AGAIN", path: ["kcm", "web-pdb"],
          says: "The disruption controller counts three healthy Pods, so one disruption is allowed again.",
          info: "PUT …/poddisruptionbudgets/web-pdb/status  disruptionsAllowed 0 → 1",
          res: { "web-pdb": pdb(3, 1) },
          decoded: [
            sec("IN BETWEEN", [["after the first delete", "2 healthy · 0 allowed · a Pod being deleted doesn't count"]]),
            sec("STATUS", [["currentHealthy", "3 · kq9tw, p8m4z, h7c2d", true], ["desiredHealthy", "2"], ["disruptionsAllowed", "0 → 1", true], [`disruptedPods.${FIRST}`, "dropped · the Pod is gone"]]),
          ],
        }),
      ],
    },
    {
      title: "THE SECOND EVICTION",
      subtitle: "the retry goes through",
      body: "kubectl's next retry arrives with one disruption allowed. The API server spends it and deletes the second Pod. Its shutdown is the same as the first's: the EndpointSlice marks it terminating, so the Service stops sending it new connections, the kubelet sends SIGTERM, and the container has up to 30 seconds. The ReplicaSet creates another replacement, which also goes to node-1.",
      facts: [
        ["RETRY", "5 s after the 429"],
        ["ANSWER", "200 OK · deleted"],
        ["REPLACEMENT", `${NEW2} · node-1`],
        ["WEB", "never below 2 Ready Pods"],
      ],
      view: "cluster",
      focus: ["you", "api", "kcm", "node1", "node2", "web-pdb"],
      events: [
        ev({
          id: "dr17", at: 65335, src: "kubectl", dst: API, layer: "api", size: "0.2 KB", title: "RETRY", path: ["you", "api"],
          says: "Five seconds later, kubectl tries the second eviction again.",
          info: `POST /api/v1/namespaces/default/pods/${SECOND}/eviction`,
          decoded: [sec("WEB-PDB", [["disruptionsAllowed", "1", true]])],
        }),
        ev({
          id: "dr18", at: 65345, src: API, dst: K2, layer: "control", size: "2.4 KB", title: "DELETED, GRACEFULLY", path: ["api", "node2"],
          says: "This time the budget allows it. The Pod is deleted and its shutdown starts.",
          info: `200 OK · WATCH MODIFIED Pod ${SECOND} (deletionTimestamp)`,
          pods: { node2: ["other", "terminating"] },
          res: { "web-pdb": pdb(3, 0), "web-rs": rs("2 Pods · 1 more wanted") },
          decoded: [sec("PDB STATUS", [["disruptionsAllowed", "1 → 0", true], [`disruptedPods.${SECOND}`, "recorded"]]), sec("POD", [["EndpointSlice", "10.244.2.18 · terminating"], ["kubelet", "SIGTERM · up to 30 s"]])],
        }),
        ev({
          id: "dr19", at: 65400, src: SCHED, dst: API, layer: "api", size: "0.3 KB", title: "ANOTHER REPLACEMENT", path: ["sched", "api"],
          says: "The ReplicaSet makes another replacement, and the scheduler puts it on node-1 too.",
          info: `POST …/pods/${NEW2}/binding  target node-1`,
          pods: { node1: ["other", "v1", "v1", "starting"] },
          decoded: [sec("FILTER", [["node-2", "✗ NodeUnschedulable"], ["node-1", "✓", true]])],
        }),
        ev({
          id: "dr20", at: 69000, src: K1, dst: API, layer: "api", size: "1.3 KB", title: "READY", path: ["node1", "api"],
          says: "The second replacement is Ready and the second old Pod is gone. web has three Pods, all on node-1.",
          info: `PATCH …/pods/${NEW2}/status  Ready=True`,
          pods: { node1: ["other", "v1", "v1", "v1"], node2: ["other"] },
          res: { "web-rs": rs("3 Pods"), "web-pdb": pdb(3, 1) },
          decoded: [sec("WEB", [["node-1", `kq9tw · ${NEW1.slice(-5)} · ${NEW2.slice(-5)}`, true], ["node-2", "none"], ["Ready Pods throughout", "never fewer than 2"]])],
        }),
      ],
    },
    {
      title: "EMPTY",
      subtitle: "maintenance, then uncordon",
      body: "Every Pod drain was going to evict is gone, so it prints node/node-2 drained and exits. Only the DaemonSet Pods are left, and you can reboot. When node-2 is back, kubectl uncordon removes the mark and the taint. Nothing moves back on its own: node-2 stays empty until new Pods are scheduled. Two traps are worth knowing. A budget whose minAvailable equals the replica count allows no disruption at all, so drain waits forever. And with one replica, any eviction is an outage.",
      facts: [
        ["LEFT ON NODE-2", "kube-proxy · kube-flannel"],
        ["AFTER MAINTENANCE", "kubectl uncordon node-2"],
        ["PODS MOVE BACK", "no · only new Pods land there"],
        ["TRAP", "minAvailable = replicas → drain never ends"],
      ],
      view: "cluster",
      focus: ["you", "api", "kcm", "node2", "web-pdb"],
      events: [
        ev({
          id: "dr21", at: 69500, src: "kubectl", dst: "kubectl", layer: "control", size: " - ", title: "DRAINED", path: ["you", "you"],
          says: "Both evictions have finished, and kubectl drain exits.",
          info: "node/node-2 drained",
          decoded: [
            sec("OUTPUT", [["evicting pod", `default/${FIRST} · default/${SECOND}`], ["then", "the 429 error, once"], ["evicted", `pod/${FIRST} · pod/${SECOND}`], ["last line", "node/node-2 drained", true]]),
            sec("TOOK", [["cordon to drained", "9.5 s in this run", true]]),
          ],
          note: "kubectl --timeout bounds the whole drain; by default it waits forever. --disable-eviction deletes Pods instead and skips PodDisruptionBudgets entirely.",
        }),
        ev({
          id: "dr22", at: 1800000, src: "kubectl", dst: API, layer: "api", size: "0.2 KB", title: "UNCORDON", path: ["you", "api"],
          says: "After the reboot, you make node-2 schedulable again.",
          info: "kubectl uncordon node-2  · PATCH spec.unschedulable=false",
          decoded: [sec("PATCH", [["spec.unschedulable", "true → false", true]]), sec("THEN", [["taint", "removed by the node lifecycle controller"], ["running Pods", "stay where they are"]])],
        }),
        ev({
          id: "dr23", at: 1800100, src: KCM, dst: API, layer: "control", size: "0.3 KB", title: "TAINT REMOVED", path: ["kcm", "api"],
          says: "The unschedulable taint comes off, and node-2 takes new Pods again.",
          info: "PATCH /api/v1/nodes/node-2  taints −node.kubernetes.io/unschedulable",
          decoded: [
            sec("NODE-2", [["spec.taints", "none", true], ["kubectl get nodes", "Ready"]]),
            sec("BUDGETS THAT BLOCK", [["minAvailable: 3 with 3 replicas", "0 allowed, always · every eviction gets 429"], ["one replica", "any eviction leaves 0 · use maxUnavailable: 1 and accept it, or run two"], ["Pods that aren't Ready", "unhealthyPodEvictionPolicy: AlwaysAllow lets them be evicted anyway"]]),
          ],
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "cordon + list", layer: "api", start: 60000, duration: 210 },
    { value: "t2", label: "first eviction", layer: "api", start: 60300, duration: 20 },
    { value: "t3", label: "429 → retry wait", layer: "drop", start: 60335, duration: 5000 },
    { value: "t4", label: "replacement Ready", layer: "node", start: 60360, duration: 3640 },
    { value: "t5", label: "second eviction → Ready", layer: "node", start: 65335, duration: 3665 },
  ],
  timingNote: "Times from one illustrative run. How long a drain takes depends on how fast replacements become Ready and how long Pods take to shut down.",
  summary: {
    title: "ONE AT A TIME, ON PURPOSE",
    body: "Draining is a cordon and a series of evictions. The cordon only stops new Pods. Each eviction is a request the API server can refuse: it checks the PodDisruptionBudget, spends a disruption before deleting anything, and answers 429 when none is left. kubectl just keeps asking. The pace is set by how fast replacements become Ready elsewhere, and a budget that can never be met keeps the node from ever being empty.",
    facts: [
      ["CORDON", "spec.unschedulable · NoSchedule taint"],
      ["EVICTION", "POST …/eviction · 200 or 429"],
      ["BUDGET", "spent before the delete · refilled by Ready Pods"],
      ["NEXT", "Upgrading the cluster"],
    ],
  },
}
