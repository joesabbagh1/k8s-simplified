import type { Lesson } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const MS = "metrics-server"
const HPA = "hpa ctrl"
const RS = "web-6f7c9d8b4"

export const autoscaling: Lesson = {
  id: "autoscaling",
  title: "Autoscaling",
  subtitle: "HPA and metrics-server",
  category: "app",
  actors: ["you", "cp", "node1", "node2", "web-hpa", "web-deploy", "web-rs"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  res: {
    "web-hpa": { kind: "hpa", name: "HPA web", sub: "target 60% · 2–10" },
    "web-deploy": { kind: "deployment", name: "Deployment web", sub: "replicas 3" },
    "web-rs": { kind: "replicaset", name: "ReplicaSet …d8b4", sub: "3/3 Pods" },
  },
  lanes: {
    [MS]: "metrics-server", [HPA]: "HPA",
    "kubelet · node-1": "node-1", "kubelet · node-2": "node-2",
  },
  overview: {
    body: "CPU climbs, the Horizontal Pod Autoscaler does the math, and new Pods appear. A sale doubles traffic on Service web. Before the HPA can act, someone has to know how much CPU each Pod is using - so the lesson starts there: cAdvisor, inside every kubelet, feeding a pipeline that ends in one divide.",
    facts: [
      ["TRIGGER", "CPU usage per Pod: 600m of 500m requested"],
      ["TARGET", "60% of requests"],
      ["FORMULA", "desired = ceil(3 × 120% / 60%) = 6"],
      ["SOURCE", "metrics.k8s.io · scraped every 15 s"],
    ],
  },
  steps: [
    {
      title: "WHERE THE NUMBERS COME FROM",
      subtitle: "cAdvisor to metrics-server",
      body: "No component can see Pod CPU directly - it's scattered across /sys/fs/cgroup on every node. cAdvisor, embedded in each kubelet, reads those cgroups, and the kubelet serves the numbers at /metrics/resource. metrics-server, one small cluster add-on, scrapes that endpoint on every node every 15 seconds and republishes the result as an extra API group, metrics.k8s.io, through the API server's aggregation layer.",
      facts: [
        ["READS", "cgroup counters on each node"],
        ["SCRAPES", "kubelet /metrics/resource · every 15 s"],
        ["SERVES", "metrics.k8s.io via aggregation"],
        ["LAG", "metrics ≈ 15-45 s old"],
      ],
      view: "cluster",
      focus: ["cp", "node1", "node2"],
      events: [
        ev({
          id: "hp1", at: 0, src: "kubelet · node-1", dst: MS, layer: "control", size: "38 KB", title: "SCRAPE NODE-1", path: ["node1", "cp"],
          says: "metrics-server pulls each node's Pod metrics from its kubelet.",
          info: "GET https://10.0.1.11:10250/metrics/resource",
          decoded: [sec("RESOURCE SCRAPE", [["source", "cAdvisor inside the kubelet"], ["per Pod", "cpu usage (cumulative seconds) · memory working set"], ["interval", "15 s", true]])],
        }),
        ev({
          id: "hp2", at: 15, src: "kubelet · node-2", dst: MS, layer: "control", size: "52 KB", title: "SCRAPE NODE-2", path: ["node2", "cp"],
          says: "Node-2 answers the same pull - two web Pods live here.",
          info: "GET https://10.0.1.12:10250/metrics/resource",
          decoded: [sec("WHAT ARRIVED", [["web-…-x2kqp", "cpu 612m · mem 231Mi"], ["web-…-p8m4z", "cpu 588m · mem 226Mi"], ["staleness", "< 15 s"]])],
        }),
        ev({
          id: "hp3", at: 100, src: MS, dst: API, layer: "api", size: "1.8 KB", title: "METRICS PUBLISHED", path: ["cp", "cp"],
          says: "The aggregate is served through the API server like any other resource.",
          info: "GET /apis/metrics.k8s.io/v1beta1/namespaces/default/pods",
          decoded: [sec("AGGREGATION LAYER", [["apiservice", "v1beta1.metrics.k8s.io → metrics-server"], ["backed by", "memory, not etcd"], ["consumers", "HPA, kubectl top"]])],
        }),
      ],
    },
    {
      title: "THE MATH",
      subtitle: "one divide, rounded up",
      body: `The HPA controller reads its own object - target 60% CPU - and the fresh metrics, and does arithmetic you could do on paper. Usage 600m against request 500m is 120% utilization. Desired replicas = current × currentUtilization ÷ target, rounded up: 3 × 120 / 60 = 6. One detail does the heavy lifting: utilization is usage divided by REQUESTS. A Pod with no requests has no defined utilization and can't be autoscaled sensibly at all.`,
      facts: [
        ["USAGE", "600m average per Pod"],
        ["REQUEST", "500m → utilization 120%"],
        ["DESIRED", "ceil(3 × 120 / 60) = 6"],
        ["RULES", "minReplicas 2 · maxReplicas 10"],
      ],
      view: "cluster",
      focus: ["web-hpa", "web-deploy", "web-rs"],
      events: [
        ev({
          id: "hp4", at: 200, src: HPA, dst: HPA, layer: "control", size: " - ", title: "COMPUTE", path: ["web-hpa", "web-hpa"],
          says: "The HPA reads the metrics and its target, and computes six.",
          info: "3 × (600m / 500m) / 0.6 → 6",
          res: { "web-hpa": { kind: "hpa", name: "HPA web", sub: "120% → wants 6" } },
          decoded: [sec("THE RECONCILE MATH", [["current", "3 replicas"], ["utilization", "600m / 500m = 120%", true], ["target", "60%"], ["desired", "ceil(3 × 120/60) = 6", true], ["clamped", "2 ≤ 6 ≤ 10"]])],
          note: "Requests aren't a formality - they're the denominator. The same 600m with a 1000m request is 60%: healthy, no scaling. The HPA scales load relative to what you declared.",
        }),
      ],
    },
    {
      title: "ACT",
      subtitle: "a patch, then familiar machinery",
      body: `The HPA's only lever is a number: it patches Deployment web from 3 to 6 replicas. Everything after that is earlier lessons replayed - the Deployment controller scales the ReplicaSet, the ReplicaSet creates three Pods, the scheduler places them two on node-1, one on node-2, the kubelets run them. The HPA doesn't know Pods exist; it knows one integer.`,
      facts: [
        ["PATCH", "spec.replicas 3 → 6"],
        ["CASCADE", "Deployment → ReplicaSet → 3 Pods"],
        ["PLACED", "2 × node-1 · 1 × node-2"],
        ["TO READY", "≈ 12 s (images cached)"],
      ],
      view: "cluster",
      focus: ["web-hpa", "web-deploy", "web-rs", "node1", "node2"],
      pods: { node1: ["other", "v1", "starting", "starting"], node2: ["other", "v1", "v1", "starting"] },
      events: [
        ev({
          id: "hp5", at: 300, src: HPA, dst: API, layer: "api", size: "0.2 KB", title: "SCALE TO SIX", path: ["web-hpa", "web-deploy"],
          says: "The HPA writes its one number: six replicas.",
          info: "PATCH …/deployments/web  replicas 3 → 6",
          res: { "web-deploy": { kind: "deployment", name: "Deployment web", sub: "replicas 3 → 6" } },
          decoded: [sec("PATCH", [["spec.replicas", "3 → 6", true], ["by", "autoscaling/web (the HPA object)"], ["mechanism from here", "the deploy lesson, verbatim"]])],
        }),
        ev({
          id: "hp6", at: 380, src: "deployment ctrl", dst: API, layer: "control", size: "2.3 KB", title: "THREE NEW PODS", path: ["web-deploy", "web-rs"],
          says: "The familiar cascade creates three Pods and the scheduler spreads them.",
          info: `PATCH …/replicasets/${RS} replicas=6 · POST ×3 + bindings`,
          res: { "web-rs": { kind: "replicaset", name: "ReplicaSet …d8b4", sub: "6 Pods · 3 starting" } },
          decoded: [sec("THE CASCADE", [["RS scaled", "3 → 6"], ["created", "web-…-m8x4t, -q2k7v, -z9h3n"], ["placed", "node-1, node-1, node-2", true]])],
        }),
      ],
    },
    {
      title: "SETTLE",
      subtitle: "new Pods, new math",
      body: `The three newcomers are Running but count for nothing yet - no metrics for 15-45 seconds, and usage near zero while they boot. When their numbers arrive the average falls: six Pods sharing the sale's load sit at ~58% each. That's below target but inside the tolerance band, 54-66%, and inside the band the HPA deliberately does nothing. Oscillation is worse than imprecision.`,
      facts: [
        ["NEW PODS", "no metrics for ~40 s"],
        ["AVERAGE FALLS", "120% → 58%"],
        ["TOLERANCE", "±10% of target → no action"],
        ["BAND", "54% - 66%: hands off"],
      ],
      view: "cluster",
      focus: ["web-hpa", "web-deploy", "web-rs", "node1", "node2"],
      pods: { node1: ["other", "v1", "v1", "v1"], node2: ["other", "v1", "v1", "v1"] },
      events: [
        ev({
          id: "hp7", at: 60000, src: MS, dst: HPA, layer: "control", size: "3.4 KB", title: "FRESH MATH", path: ["web-hpa", "web-hpa"],
          says: "With all six Pods reporting, utilization lands just under target.",
          info: "6 Pods · avg 290m / 500m = 58%",
          res: {
            "web-hpa": { kind: "hpa", name: "HPA web", sub: "58% · inside band → hold" },
            "web-rs": { kind: "replicaset", name: "ReplicaSet …d8b4", sub: "6/6 Pods" },
          },
          decoded: [sec("SETTLED", [["per-Pod avg", "≈ 290m"], ["utilization", "58%", true], ["target", "60% ± 10% → 54-66"], ["decision", "hold - no action"]])],
          note: "Tolerance exists because two Pods at 59.5% and 60.5% are the same reality. Without it the HPA would scale up and down on noise, forever.",
        }),
      ],
    },
    {
      title: "SCALE DOWN, SLOWLY",
      subtitle: "the brake is bigger than the gas",
      body: `At 2 a.m. the sale ends; utilization slides to 30%. The math says ceil(6 × 30/60) = 3, but scaling down is deliberately slower: the HPA waits out a stabilization window - 300 s by default - using the highest desired value seen in that window, then removes replicas, newest Pods first. Fast up, slow down: a load spike shouldn't be answered by a later cliff.`,
      facts: [
        ["NIGHT", "avg 30% → desired 3"],
        ["STABILIZATION", "300 s, max of the window"],
        ["ORDER", "newest Pods first"],
        ["ASYMMETRY", "scale-up now · scale-down considered"],
      ],
      view: "cluster",
      focus: ["web-hpa", "web-deploy", "web-rs", "node1", "node2"],
      events: [
        ev({
          id: "hp8", at: 120000, src: HPA, dst: HPA, layer: "control", size: " - ", title: "CONSIDER SHRINKING", path: ["web-hpa", "web-hpa"],
          says: "Load fell; the math says three - but the decision waits five minutes.",
          info: "desired 3 · stabilization window opens",
          res: { "web-hpa": { kind: "hpa", name: "HPA web", sub: "30% → wants 3 · waiting" } },
          decoded: [sec("DOWNSCALE POLICY", [["utilization", "30%"], ["desired", "ceil(6 × 30/60) = 3", true], ["window", "300 s of history"], ["pick", "max desired in window (defensive)"]])],
        }),
        ev({
          id: "hp9", at: 420300, src: HPA, dst: API, layer: "api", size: "0.2 KB", title: "SCALE TO THREE", path: ["web-hpa", "web-deploy"],
          says: "The window holds, so three replicas it is - newest Pods retired first.",
          info: "PATCH …/deployments/web  replicas 6 → 3",
          res: {
            "web-hpa": { kind: "hpa", name: "HPA web", sub: "settled at 3 replicas" },
            "web-deploy": { kind: "deployment", name: "Deployment web", sub: "replicas 3" },
            "web-rs": { kind: "replicaset", name: "ReplicaSet …d8b4", sub: "3/3 Pods" },
          },
          decoded: [sec("AFTER 300 S", [["decision", "3 stands"], ["retired", "the three surge Pods", true], ["each exit", "the graceful-shutdown lesson"]])],
          note: "The HPA can't conjure capacity: six Pods fit on these two nodes, but scale past what the nodes can hold and new Pods sit Pending until a cluster autoscaler adds nodes - a different loop entirely.",
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "scrapes + metrics served", layer: "control", start: 0, duration: 100 },
    { value: "t2", label: "the divide", layer: "control", start: 200, duration: 100 },
    { value: "t3", label: "patch → 3 Pods to Ready", layer: "control", start: 300, duration: 11700 },
    { value: "t4", label: "new metrics → 58%, hold", layer: "control", start: 60000, duration: 300 },
    { value: "t5", label: "night: window then shrink", layer: "control", start: 120000, duration: 300300 },
  ],
  summary: {
    title: "A LOOP ON TOP OF A PIPELINE",
    body: "Autoscaling is the reconcile pattern aimed at a number nobody stores: per-Pod CPU. A scrape pipeline turns kernel cgroup counters into an API, the HPA divides by requests and rounds up, and its entire output is a single integer on the Deployment. Everything else - Pods, scheduling, endpoints - happens because of machinery this series already covered.",
    facts: [
      ["THE LEVER", "one integer: spec.replicas"],
      ["WHY REQUESTS", "they're the denominator"],
      ["NEXT", "ConfigMaps and Secrets"],
    ],
  },
}
