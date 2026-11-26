import type { Lesson, Resource } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const HPA = "hpa ctrl"
const OP = "keda-operator"
const MS = "keda-metrics-apiserver"
const MQ = "RabbitMQ"
const METRIC = "s0-rabbitmq-jobs"
const QUEUE_URL = "GET /api/queues/%2F/jobs"

const so = (sub: string, state?: Resource["state"]): Resource => ({ kind: "scaledobject", name: "ScaledObject worker", sub, state })
const hpa = (sub: string, state?: Resource["state"]): Resource => ({ kind: "hpa", name: "HPA keda-hpa-worker", sub, state })
const dep = (n: number): Resource => ({ kind: "deployment", name: "Deployment worker", sub: `replicas ${n}` })


export const kedaScaleToZero: Lesson = {
  id: "keda-scale-to-zero",
  title: "Scale to zero with KEDA",
  subtitle: "Queue length and external metrics",
  category: "app",
  seo: {
    title: "Scale to zero on queue length with KEDA",
    description: "How KEDA scales a Kubernetes Deployment from zero on a RabbitMQ queue: activation, the HPA it creates, external metrics, cooldown and the cold start.",
  },
  actors: ["you", "cp", "node1", "node2", "rabbitmq", "worker-so", "worker-hpa", "worker-deploy"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  res: { "worker-deploy": dep(1) },
  lanes: {
    kubectl: "you",
    [API]: "control plane", [HPA]: "control plane",
    [OP]: "KEDA", [MS]: "KEDA",
    [MQ]: "RabbitMQ", checkout: "node-2",
    worker: "workers",
    "kubelet · node-2": "node-2",
  },
  overview: {
    body: "A worker Deployment takes jobs off a RabbitMQ queue called jobs. Most of the night the queue is empty, and a Horizontal Pod Autoscaler can't go below one replica, so one worker would sit idle. KEDA can take it to zero. It watches the queue itself, brings the Deployment from zero to one when work arrives, and hands the rest to an ordinary HPA fed with the queue's length through the external metrics API. Follow 30 jobs from arrival to an empty queue and back to zero.",
    facts: [
      ["KEDA", "v2.21 · keda-operator, keda-metrics-apiserver"],
      ["TRIGGER", "rabbitmq · queue jobs · 10 messages per worker"],
      ["RANGE", "0 to 10 worker Pods"],
      ["0 ↔ 1", "KEDA · 1 ↔ N: the HPA"],
    ],
  },
  steps: [
    {
      title: "THE SCALEDOBJECT",
      subtitle: "KEDA writes an HPA for you",
      body: "You apply a ScaledObject for the worker Deployment: between 0 and 10 replicas, one RabbitMQ trigger on queue jobs, a target of 10 messages per worker. KEDA's operator, running on node-1, sees it and creates an HPA named keda-hpa-worker. That HPA asks for an external metric, the queue's length, with minReplicas 1. Then the operator checks the queue, finds it empty, and scales the Deployment to zero itself.",
      facts: [
        ["SCALEDOBJECT", "worker · min 0 · max 10"],
        ["TRIGGER", "rabbitmq · mode QueueLength · value 10"],
        ["HPA", `keda-hpa-worker · external metric ${METRIC}`],
        ["DEFAULTS", "pollingInterval 30 s · cooldownPeriod 300 s"],
      ],
      view: "cluster",
      focus: ["you", "api", "node1", "worker-so", "worker-hpa", "worker-deploy"],
      events: [
        ev({
          id: "kd1", at: 0, src: "kubectl", dst: API, layer: "api", size: "0.6 KB", title: "APPLY THE SCALEDOBJECT", path: ["you", "api"],
          says: "You create a ScaledObject that points at the worker Deployment.",
          info: "POST /apis/keda.sh/v1alpha1/namespaces/default/scaledobjects  worker",
          res: { "worker-so": so("0–10 · queue jobs", "creating") },
          decoded: [
            sec("SPEC", [["scaleTargetRef.name", "worker"], ["minReplicaCount", "0", true], ["maxReplicaCount", "10"], ["pollingInterval · cooldownPeriod", "unset · 30 s · 300 s"]]),
            sec("TRIGGERS[0]", [["type", "rabbitmq"], ["queueName", "jobs"], ["mode · value", "QueueLength · 10", true], ["hostFromEnv", "RABBITMQ_URL · from the worker's own env"]]),
          ],
        }),
        ev({
          id: "kd2", at: 300, src: OP, dst: API, layer: "control", size: "1.2 KB", title: "KEDA CREATES AN HPA", path: ["node1", "api"],
          says: "The operator, on node-1, creates an HPA for the Deployment, fed by an external metric.",
          info: "POST /apis/autoscaling/v2/namespaces/default/horizontalpodautoscalers  keda-hpa-worker",
          res: { "worker-so": so("0–10 · queue jobs", "active"), "worker-hpa": hpa("minReplicas 1 · avg 10", "creating") },
          decoded: [sec("HPA SPEC", [["scaleTargetRef", "Deployment worker"], ["minReplicas · maxReplicas", "1 · 10", true], ["metrics[0].type", "External"], ["metric.name", METRIC], ["target", "AverageValue 10 · per Pod"], ["ownerReferences", "ScaledObject worker"]])],
          note: "The HPA's floor is 1, so KEDA does the step between 0 and 1 itself and leaves the rest to the HPA.",
        }),
        ev({
          id: "kd3", at: 800, src: OP, dst: MQ, layer: "net", size: "0.9 KB", title: "IS THERE WORK?", path: ["node1", "rabbitmq"],
          says: "The operator asks RabbitMQ how many messages are in jobs: none.",
          info: `${QUEUE_URL} → messages: 0`,
          decoded: [sec("SCALER", [["asks", "RabbitMQ's management API"], ["messages", "0", true], ["activationValue", "0 · active only above it"], ["result", "inactive"]])],
        }),
        ev({
          id: "kd4", at: 900, src: OP, dst: API, layer: "api", size: "0.2 KB", title: "SCALE TO ZERO", path: ["node1", "api"],
          says: "The queue is empty, so the operator scales the Deployment from one to zero.",
          info: "PATCH …/deployments/worker/scale  replicas 1 → 0",
          res: { "worker-deploy": dep(0), "worker-hpa": hpa("minReplicas 1 · idle", "active") },
          decoded: [sec("SCALE", [["spec.replicas", "1 → 0", true], ["who", "keda-operator · not the HPA"], ["HPA meanwhile", "ScalingActive=False · the target has 0 replicas"]])],
        }),
      ],
    },
    {
      title: "POLLING AT ZERO",
      subtitle: "nobody runs, KEDA keeps asking",
      body: "With no worker running, nothing would notice new jobs, so KEDA does. Every pollingInterval, 30 seconds by default, the operator asks RabbitMQ for the length of jobs. While it's 0 the scaler stays inactive and the Deployment stays at zero. The HPA does nothing either: it won't scale a target that has zero replicas. All night, the cost of the worker is one small HTTP request every 30 seconds.",
      facts: [
        ["POLL", "every 30 s · pollingInterval"],
        ["QUEUE", "0 messages"],
        ["WORKERS", "0 Pods"],
        ["HPA", "ScalingActive=False · nothing to scale"],
      ],
      view: "cluster",
      focus: ["node1", "node2", "rabbitmq", "worker-deploy", "worker-so", "worker-hpa"],
      events: [
        ev({
          id: "kd5", at: 30800, src: OP, dst: MQ, layer: "net", size: "0.9 KB", title: "STILL EMPTY", path: ["node1", "rabbitmq"],
          says: "Thirty seconds later: still nothing in the queue.",
          info: `${QUEUE_URL} → messages: 0`,
          decoded: [sec("POLL", [["interval", "30 s", true], ["messages", "0"], ["decision", "stay at 0"]])],
          note: "pollingInterval is also the worst-case delay before the first worker starts: a job that arrives just after a poll waits up to 30 s to be noticed.",
        }),
      ],
    },
    {
      title: "ACTIVATION",
      subtitle: "0 → 1, by KEDA",
      body: "At 06:00 the checkout service publishes 30 jobs. On its next poll the operator sees 30 messages. That is above the activation value of 0, so the scaler is active, and the operator itself scales the Deployment from zero to one. Only KEDA crosses between 0 and 1. The scheduler places the Pod on node-2, it starts, connects to RabbitMQ and takes its first job.",
      facts: [
        ["ARRIVED", "30 jobs"],
        ["ACTIVATION", "30 > activationValue 0 → active"],
        ["SCALE", "0 → 1 · by keda-operator"],
        ["FIRST POD", "worker-…-6pqzt · node-2"],
      ],
      view: "cluster",
      focus: ["node1", "node2", "rabbitmq", "worker-deploy", "worker-so", "worker-hpa"],
      events: [
        ev({
          id: "kd6", at: 600000, src: "checkout", dst: MQ, layer: "net", size: "30 × 1 KB", title: "30 JOBS ARRIVE", path: ["node2", "rabbitmq"],
          says: "The checkout service publishes 30 jobs to the queue.",
          info: "basic.publish × 30 · exchange \"\" · routing key jobs",
          decoded: [sec("QUEUE JOBS", [["messages", "0 → 30", true], ["consumers", "0"]])],
        }),
        ev({
          id: "kd7", at: 610800, src: OP, dst: MQ, layer: "net", size: "0.9 KB", title: "30 MESSAGES", path: ["node1", "rabbitmq"],
          says: "On its next poll, the operator sees 30 messages waiting.",
          info: `${QUEUE_URL} → messages: 30`,
          decoded: [sec("ACTIVATION", [["messages", "30", true], ["activationValue", "0"], ["30 > 0", "active"]])],
        }),
        ev({
          id: "kd8", at: 610900, src: OP, dst: API, layer: "api", size: "0.2 KB", title: "0 → 1", path: ["node1", "api"],
          says: "The operator scales the Deployment from zero to one.",
          info: "PATCH …/deployments/worker/scale  replicas 0 → 1",
          res: { "worker-deploy": dep(1) },
          decoded: [sec("SCALE", [["spec.replicas", "0 → 1", true], ["who", "keda-operator"], ["the HPA", "takes over now that there is 1"]])],
        }),
        ev({
          id: "kd9", at: 615000, src: "kubelet · node-2", dst: API, layer: "api", size: "1.3 KB", title: "THE FIRST WORKER", path: ["node2", "api"],
          says: "The worker starts on node-2 and is Ready.",
          info: "PATCH …/pods/worker-…-6pqzt/status  Ready=True",
          pods: { node2: ["other", "v1", "v1", "v2"] },
          decoded: [sec("COLD START", [["noticed", "10.8 s after the jobs arrived · the poll"], ["Pod start", "4.1 s · image already on node-2"], ["first job taken", "15 s after it was published", true]])],
        }),
      ],
    },
    {
      title: "THE HPA TAKES OVER",
      subtitle: "an external metric, one divide",
      body: "Every 15 seconds the HPA controller asks the API server for the metric "+METRIC+". external.metrics.k8s.io isn't served by the API server itself: an APIService registers KEDA's metrics server for it, and the API server forwards the request there. KEDA's metrics server gets the queue's length, 28 now, and returns it. The target is an average of 10 per Pod, so the HPA wants ceil(28 / 10) = 3 workers and scales the Deployment to three.",
      facts: [
        ["API", "external.metrics.k8s.io/v1beta1 · via an APIService"],
        ["SERVED BY", "keda-metrics-apiserver"],
        ["METRIC", `${METRIC} = 28`],
        ["DESIRED", "ceil(28 / 10) = 3"],
      ],
      view: "cluster",
      focus: ["api", "kcm", "node1", "node2", "rabbitmq", "worker-so", "worker-hpa", "worker-deploy"],
      events: [
        ev({
          id: "kd10", at: 621000, src: HPA, dst: API, layer: "control", size: "0.3 KB", title: "ASK FOR THE METRIC", path: ["kcm", "api"],
          says: "The HPA controller asks for the queue metric, like any other API request.",
          info: `GET /apis/external.metrics.k8s.io/v1beta1/namespaces/default/${METRIC}?labelSelector=scaledobject.keda.sh/name=worker`,
          decoded: [sec("HPA CONTROLLER", [["runs in", "kube-controller-manager"], ["every", "15 s · --horizontal-pod-autoscaler-sync-period"], ["asks", "the external metrics API", true]])],
        }),
        ev({
          id: "kd11", at: 621010, src: API, dst: MS, layer: "control", size: "0.3 KB", title: "FORWARDED TO KEDA", path: ["api", "node1"],
          says: "The API server forwards it to KEDA's metrics server, which registered for that API group.",
          info: "APIService v1beta1.external.metrics.k8s.io → Service keda/keda-metrics-apiserver",
          decoded: [sec("AGGREGATION", [["APIService", "v1beta1.external.metrics.k8s.io", true], ["service", "keda/keda-metrics-apiserver:443"], ["one per cluster", "only one adapter can serve external.metrics.k8s.io"]])],
          note: "Only one APIService can claim external.metrics.k8s.io. A cluster that already runs another external metrics adapter, such as the Prometheus adapter, has to choose.",
        }),
        ev({
          id: "kd12", at: 621200, src: MS, dst: MQ, layer: "net", size: "0.9 KB", title: "READ THE QUEUE", path: ["node1", "rabbitmq"],
          says: "KEDA reads the queue's length: 28, now that the first worker has taken two.",
          info: `${QUEUE_URL} → messages: 28`,
          decoded: [sec("SCALER", [["messages", "28", true], ["metric", `${METRIC}`]])],
        }),
        ev({
          id: "kd13", at: 621300, src: MS, dst: HPA, layer: "control", size: "0.4 KB", title: "28", path: ["api", "kcm"],
          says: "The answer goes back to the HPA through the API server.",
          info: `ExternalMetricValueList  ${METRIC} = 28`,
          decoded: [sec("ITEMS[0]", [["metricName", METRIC], ["value", "28", true], ["timestamp", "06:00:21"]])],
        }),
        ev({
          id: "kd14", at: 621400, src: HPA, dst: API, layer: "api", size: "0.2 KB", title: "SCALE TO THREE", path: ["kcm", "api"],
          says: "28 messages at 10 per Pod is 3 Pods. The HPA scales the Deployment.",
          info: "PATCH …/deployments/worker/scale  replicas 1 → 3",
          res: { "worker-deploy": dep(3), "worker-hpa": hpa("28 / 10 per Pod → 3") },
          pods: { node1: ["other", "v1", "starting", "starting"], node2: ["other", "v1", "v1", "v2"] },
          decoded: [sec("THE DIVIDE", [["target", "AverageValue 10"], ["metric", "28 · the whole queue"], ["desired", "ceil(28 / 10) = 3", true], ["limits", "within 1–10"]])],
        }),
      ],
    },
    {
      title: "DRAINING",
      subtitle: "the queue empties, the HPA waits",
      body: "Three workers take jobs off the queue. The metric falls: 18, 7, then 0. The HPA's answer falls with it, down to its floor of one, but it doesn't scale down at once. By default it waits until 300 seconds of recommendations all agree, so a short gap between bursts doesn't throw Pods away. Five minutes after the queue emptied, it scales the Deployment to one.",
      facts: [
        ["QUEUE", "28 → 0 in about 80 s"],
        ["HPA WANTS", "1 · its minimum"],
        ["STABILIZATION", "300 s before scaling down"],
        ["THEN", "3 → 1"],
      ],
      view: "cluster",
      focus: ["kcm", "node1", "node2", "rabbitmq", "worker-hpa", "worker-deploy", "worker-so"],
      events: [
        ev({
          id: "kd15", at: 626000, src: "worker", dst: MQ, layer: "net", size: "1 KB", title: "WORKERS TAKE JOBS", path: ["node1", "rabbitmq"],
          says: "All three workers take jobs and acknowledge each one when it's done.",
          info: "basic.consume jobs · prefetch 1 · basic.ack",
          pods: { node1: ["other", "v1", "v2", "v2"], node2: ["other", "v1", "v1", "v2"] },
          decoded: [sec("QUEUE JOBS", [["consumers", "3", true], ["each worker", "one job at a time · prefetch 1"], ["a job", "≈ 8 s"]])],
        }),
        ev({
          id: "kd16", at: 700000, src: MQ, dst: MS, layer: "net", size: "0.9 KB", title: "EMPTY AGAIN", path: ["rabbitmq", "node1"],
          says: "The queue is empty. The HPA's next look says one worker is enough.",
          info: `${METRIC} = 0 → desired 1 (its minimum)`,
          res: { "worker-hpa": hpa("0 / 10 → 1 · waiting 300 s") },
          decoded: [sec("HPA", [["metric", "0"], ["desired", "ceil(0 / 10) = 0 → 1, the minimum", true], ["scale down", "held · stabilization window 300 s"]])],
        }),
        ev({
          id: "kd17", at: 1000000, src: HPA, dst: API, layer: "api", size: "0.2 KB", title: "3 → 1", path: ["kcm", "api"],
          says: "Five minutes of low recommendations later, the HPA scales the Deployment to one.",
          info: "PATCH …/deployments/worker/scale  replicas 3 → 1",
          res: { "worker-deploy": dep(1), "worker-hpa": hpa("0 / 10 → 1") },
          pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1", "v2"] },
          decoded: [sec("SCALE DOWN", [["spec.replicas", "3 → 1", true], ["after", "behavior.scaleDown.stabilizationWindowSeconds 300"], ["the two Pods", "get SIGTERM · a worker should finish its job first"]])],
          note: "A worker killed in the middle of a job hasn't acknowledged it, so RabbitMQ gives the job to another worker. Long jobs need terminationGracePeriodSeconds to match, or a ScaledJob.",
        }),
      ],
    },
    {
      title: "BACK TO ZERO",
      subtitle: "cooldown, and the cost of a cold start",
      body: "The operator has seen an empty queue on every poll since the jobs ran out. Once cooldownPeriod, 300 seconds by default, has passed since the scaler was last active, it scales the Deployment from one to zero, and the HPA goes quiet again. That's the trade: nothing runs while there's nothing to do, and the first job after a quiet spell waits for a poll and a Pod start. For a model server, that start also includes loading the model.",
      facts: [
        ["COOLDOWN", "300 s since the last active poll"],
        ["SCALE", "1 → 0 · by keda-operator"],
        ["COLD START", "up to 30 s of polling + Pod start"],
        ["LONG JOBS", "ScaledJob · one Job per message"],
      ],
      view: "cluster",
      focus: ["api", "node1", "node2", "rabbitmq", "worker-so", "worker-deploy", "worker-hpa"],
      events: [
        ev({
          id: "kd18", at: 1005800, src: OP, dst: API, layer: "api", size: "0.2 KB", title: "1 → 0", path: ["node1", "api"],
          says: "Cooldown is over and the queue is still empty. The operator scales the worker to zero.",
          info: "PATCH …/deployments/worker/scale  replicas 1 → 0",
          res: { "worker-deploy": dep(0), "worker-hpa": hpa("minReplicas 1 · idle") },
          pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
          decoded: [
            sec("COOLDOWN", [["last active", "06:01:40"], ["cooldownPeriod", "300 s · only for going to 0", true], ["now", "06:06:45 · inactive"]]),
            sec("SCALEDJOB INSTEAD", [["for", "jobs that run for minutes or hours"], ["does", "creates a Kubernetes Job per message, which runs to completion"], ["avoids", "a scale-down killing a job halfway"]]),
          ],
          note: "Kubernetes's own HPA can also go to zero replicas with the HPAScaleToZero feature gate, but that still needs a metric that is reported while nothing runs. KEDA's polling is what provides it here.",
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "ScaledObject → HPA → 0", layer: "control", start: 0, duration: 900 },
    { value: "t2", label: "jobs wait for a poll", layer: "net", start: 600000, duration: 10800 },
    { value: "t3", label: "first worker starts", layer: "node", start: 610900, duration: 4100 },
    { value: "t4", label: "HPA: 1 → 3", layer: "control", start: 621000, duration: 400 },
    { value: "t5", label: "queue drains", layer: "net", start: 621400, duration: 78600 },
    { value: "t6", label: "HPA stabilization", layer: "control", start: 700000, duration: 300000 },
    { value: "t7", label: "cooldown → 0", layer: "control", start: 700000, duration: 305800 },
  ],
  timingNote: "Times from one illustrative run. The wait before the first worker starts depends on where in the polling interval the jobs arrive, and on the Pod's start time.",
  summary: {
    title: "ZERO IS KEDA'S, THE REST IS THE HPA'S",
    body: "KEDA splits scaling in two. Between zero and one, its operator polls the queue and scales the Deployment itself, because nothing else would notice work while no Pod runs. Above one, it hands over to an ordinary HPA, which reads the queue's length through the external metrics API that KEDA's metrics server answers, and divides by the target per Pod. Cooldown takes it back to zero, and the price is a cold start for the first job after a quiet spell.",
    facts: [
      ["0 ↔ 1", "keda-operator · polling every 30 s"],
      ["1 ↔ N", "HPA · external.metrics.k8s.io"],
      ["DOWN", "HPA waits 300 s · KEDA cools down 300 s"],
      ["NEXT", "ConfigMaps and Secrets"],
    ],
  },
}
