import type { Lesson } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const OLD = "web-6f7c9d8b4"
const NEW = "web-7b5d4c9f6"

export const rollingUpdate: Lesson = {
  id: "rolling-update",
  title: "Rolling update",
  subtitle: "New version, zero downtime",
  category: "app",
  actors: ["you", "cp", "node1", "node2", "web-deploy", "web-rs", "web-rs2", "web-svc"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  res: {
    "web-deploy": { kind: "deployment", name: "Deployment web", sub: "1.4.2 · 3 replicas" },
    "web-rs": { kind: "replicaset", name: "ReplicaSet …d8b4", sub: "3/3 · v1.4.2" },
    "web-svc": { kind: "service", name: "Service web", sub: "endpoints: 3" },
  },
  lanes: {
    "kubelet · node-1": "node-1", "containerd · node-1": "node-1", [`${NEW}-h4vzn`]: "node-1",
    "kubelet · node-2": "node-2", "containerd · node-2": "node-2", [`${OLD}-p8m4z`]: "node-2",
  },
  overview: {
    body: "Change the image of a running Deployment and watch two ReplicaSets trade Pods one at a time. At every moment at least three Pods are ready to serve, so capacity never dips. Avoiding dropped requests also takes an app that shuts down politely and clients that retry.",
    facts: [
      ["COMMAND", "kubectl set image deployment/web web=…:1.5.0"],
      ["REPLICAS", "3"],
      ["STRATEGY", "RollingUpdate · maxSurge 25% · maxUnavailable 25%"],
      ["WHICH MEANS", "at most 4 Pods, never fewer than 3 ready"],
    ],
  },
  steps: [
    {
      title: "CHANGE THE IMAGE",
      subtitle: "A new Pod template, a new hash",
      body: "kubectl sends a patch that changes one field: the container image, from 1.4.2 to 1.5.0. Because the Pod template changed, the Deployment's generation goes up and the template gets a new hash. The Deployment controller sees that no ReplicaSet matches the new hash.",
      facts: [
        ["IMAGE", "1.4.2 → 1.5.0"],
        ["GENERATION", "1 → 2"],
        ["TEMPLATE HASH", "6f7c9d8b4 → 7b5d4c9f6"],
      ],
      view: "cluster",
      focus: ["you", "cp"],
      events: [
        ev({
          id: "u1", at: 0, src: "kubectl", dst: API, layer: "api", size: "0.3 KB", title: "PATCH THE DEPLOYMENT", path: ["you", "cp"],
          says: "kubectl changes one field in the Deployment: the image version.",
          info: "PATCH /apis/apps/v1/namespaces/default/deployments/web",
          res: { "web-deploy": { kind: "deployment", name: "Deployment web", sub: "1.5.0 · 3 replicas" } },
          decoded: [
            sec("HTTP/2 REQUEST", [["method", "PATCH"], ["content-type", "application/strategic-merge-patch+json"]]),
            sec("CHANGE", [["…containers[web].image", "…/web:1.4.2 → …/web:1.5.0", true], ["metadata.generation", "1 → 2", true]]),
          ],
        }),
        ev({
          id: "u2", at: 6, src: API, dst: "deployment ctrl", layer: "control", size: "1.3 KB", title: "TEMPLATE CHANGED", path: ["cp", "web-deploy"],
          says: "The Deployment controller notices the Pod template changed, and needs new Pods.",
          info: "WATCH MODIFIED Deployment web · new hash 7b5d4c9f6",
          decoded: [sec("DEPLOYMENT CONTROLLER", [["pod-template-hash", "6f7c9d8b4 → 7b5d4c9f6", true], ["matching ReplicaSet", "none yet"], ["old ReplicaSet", `${OLD} · 3 Pods`]])],
        }),
      ],
    },
    {
      title: "SURGE ONE",
      subtitle: "A second ReplicaSet appears",
      body: "The Deployment controller creates a ReplicaSet for the new template. How fast it can go comes from the strategy: 25% of 3 Pods is 0.75. maxSurge rounds up to 1, so one extra Pod is allowed. maxUnavailable rounds down to 0, so no old Pod may go until a new one is ready. The new Pod is scheduled onto node-1.",
      facts: [
        ["MAX SURGE", "25% of 3 → 1 extra Pod"],
        ["MAX UNAVAILABLE", "25% of 3 → 0"],
        ["NEW REPLICASET", `${NEW} · 1 Pod`],
        ["SCHEDULED ON", "node-1"],
      ],
      view: "cluster",
      focus: ["web-deploy", "web-rs", "web-rs2", "node1"],
      pods: { node1: ["other", "v1", "starting"] },
      events: [
        ev({
          id: "u3", at: 10, src: "deployment ctrl", dst: API, layer: "api", size: "1.4 KB", title: "CREATE NEW REPLICASET", path: ["web-deploy", "web-rs2"],
          says: "It creates a second ReplicaSet for the new version, starting with 1 Pod.",
          info: `POST …/replicasets  ${NEW} replicas=1`,
          res: { "web-rs2": { kind: "replicaset", name: "ReplicaSet …c9f6", sub: "wants 1 · v1.5.0", state: "creating" } },
          decoded: [sec("BODY · REPLICASET", [["metadata.name", NEW], ["spec.replicas", "1", true], ["labels.pod-template-hash", "7b5d4c9f6"]]), sec("BUDGET", [["max Pods", "3 + 1 surge = 4"], ["min ready", "3 − 0 = 3"]])],
        }),
        ev({
          id: "u4", at: 15, src: "replicaset ctrl", dst: API, layer: "api", size: "2.3 KB", title: "CREATE POD", path: ["web-rs2", "web-rs2"],
          says: "That ReplicaSet creates one new Pod.",
          info: `POST …/pods  ${NEW}-h4vzn`,
          res: { "web-rs2": { kind: "replicaset", name: "ReplicaSet …c9f6", sub: "1 Pod · v1.5" } },
          decoded: [sec("BODY · POD", [["metadata.name", `${NEW}-h4vzn`], ["image", "…/web:1.5.0"], ["status.phase", "Pending"]])],
        }),
        ev({
          id: "u5", at: 40, src: "kube-scheduler", dst: API, layer: "api", size: "0.3 KB", title: "BINDING", path: ["cp", "cp"],
          says: "The scheduler places the new Pod on node-1.",
          info: `POST …/pods/${NEW}-h4vzn/binding → node-1`,
          res: { "web-rs2": { kind: "replicaset", name: "ReplicaSet …c9f6", sub: "1 Pod · on node-1" } },
          decoded: [sec("BODY · BINDING", [["target.name", "node-1", true], ["why", "node-1 has fewer web Pods"]])],
        }),
      ],
    },
    {
      title: "WAIT FOR READY",
      subtitle: "Both versions serve, briefly",
      body: "node-1 pulls 1.5.0, which is quick because three of its five layers are already there from 1.4.2. The container starts, but the rollout waits for the readiness probe. Once it passes, the new Pod joins the Service's endpoints. For a short while both versions answer requests, so your app has to cope with that.",
      facts: [
        ["IMAGE PULL", "2 new layers · 6 MB"],
        ["PROBE DELAY", "initialDelaySeconds: 10"],
        ["ENDPOINTS", "4 · three v1, one v2"],
      ],
      view: "cluster",
      focus: ["cp", "node1"],
      pods: { node1: ["other", "v1", "v2"] },
      events: [
        ev({
          id: "u6", at: 300, src: "kubelet · node-1", dst: "containerd · node-1", layer: "node", size: "6 MB", title: "PULL NEW IMAGE", path: ["node1", "node1"],
          says: "node-1 pulls the new image. Most of it is already there, so it's quick.",
          info: "PullImage registry.example.com/shop/web:1.5.0",
          decoded: [sec("LAYERS", [["shared with 1.4.2", "3 (already on disk)"], ["downloaded", "2 · 6.1 MB", true], ["took", "0.7 s"]])],
        }),
        ev({
          id: "u7", at: 11100, src: "kubelet · node-1", dst: `${NEW}-h4vzn`, layer: "net", size: "0.2 KB", title: "READINESS PROBE", path: ["node1", "node1"],
          says: "The new Pod passes its health check.",
          info: "GET http://10.244.1.13:8080/healthz → 200 OK",
          decoded: [sec("HTTP PROBE", [["after", "initialDelaySeconds: 10"], ["result", "200 OK"]])],
        }),
        ev({
          id: "u8", at: 11110, src: "kubelet · node-1", dst: API, layer: "api", size: "0.9 KB", title: "NEW POD READY", path: ["node1", "cp"],
          says: "The new Pod is reported Ready.",
          info: `PATCH …/pods/${NEW}-h4vzn/status  Ready=True`,
          decoded: [sec("STATUS PATCH", [["conditions.Ready", "False → True", true]])],
        }),
        ev({
          id: "u9", at: 11125, src: "endpointslice ctrl", dst: API, layer: "api", size: "0.8 KB", title: "ADD TO ENDPOINTS", path: ["cp", "web-svc"],
          says: "It joins the Service's endpoints. Old and new versions now both serve traffic.",
          info: "PUT …/endpointslices/web-7xk2p  +10.244.1.13:8080",
          res: { "web-svc": { kind: "service", name: "Service web", sub: "endpoints: 4 · 3×v1 + 1×v2" } },
          decoded: [sec("ENDPOINTS", [["10.244.1.12", "v1 · ready"], ["10.244.2.17", "v1 · ready"], ["10.244.2.18", "v1 · ready"], ["10.244.1.13", "v2 · ready", true]])],
        }),
      ],
    },
    {
      title: "RETIRE ONE",
      subtitle: "The old ReplicaSet shrinks",
      body: "With one new Pod ready, there are 4 ready Pods and only 3 are needed. The Deployment controller scales the old ReplicaSet from 3 to 2. The ReplicaSet controller picks which Pod to delete: it prefers Pods that aren't ready, then Pods on a node crowded with web Pods, then the most recently ready. Here that's one on node-2. The Pod is marked for deletion and taken out of the endpoints right away.",
      facts: [
        ["OLD REPLICASET", "3 → 2"],
        ["DELETED", `${OLD}-p8m4z on node-2`],
        ["GRACE PERIOD", "30 s"],
      ],
      view: "cluster",
      focus: ["web-deploy", "web-rs", "node2"],
      pods: { node2: ["other", "v1", "terminating"] },
      events: [
        ev({
          id: "u10", at: 11130, src: "deployment ctrl", dst: API, layer: "api", size: "0.2 KB", title: "SCALE DOWN OLD", path: ["web-deploy", "web-rs"],
          says: "With an extra Pod ready, the old ReplicaSet can shrink from 3 to 2.",
          info: `PATCH …/replicasets/${OLD}  replicas 3 → 2`,
          res: { "web-rs": { kind: "replicaset", name: "ReplicaSet …d8b4", sub: "3 → 2 Pods" } },
          decoded: [sec("PATCH", [["spec.replicas", "3 → 2", true]]), sec("WHY NOW", [["ready Pods", "4"], ["needed", "3 − maxUnavailable 0 = 3"]])],
        }),
        ev({
          id: "u11", at: 11140, src: "replicaset ctrl", dst: API, layer: "api", size: "0.2 KB", title: "DELETE A POD", path: ["web-rs", "node2"],
          says: "It marks one old Pod, on node-2, for deletion.",
          info: `DELETE …/pods/${OLD}-p8m4z`,
          decoded: [sec("EFFECT", [["metadata.deletionTimestamp", "set", true], ["deletionGracePeriodSeconds", "30", true]])],
          note: "Deleting is a two-step affair: the API server only marks the Pod. The object stays until the kubelet confirms the container has stopped.",
        }),
        ev({
          id: "u12", at: 11152, src: "endpointslice ctrl", dst: API, layer: "api", size: "0.8 KB", title: "STOP SENDING TRAFFIC", path: ["cp", "web-svc"],
          says: "That Pod is taken out of the endpoints, so new traffic stops going to it.",
          info: "PUT …/endpointslices/web-7xk2p  10.244.2.18 terminating",
          res: { "web-svc": { kind: "service", name: "Service web", sub: "endpoints: 3 ready · 1 leaving" } },
          decoded: [sec("ENDPOINT 10.244.2.18", [["conditions.ready", "true → false", true], ["conditions.terminating", "true", true]])],
        }),
      ],
    },
    {
      title: "GRACEFUL SHUTDOWN",
      subtitle: "preStop, SIGTERM, then gone",
      body: "Zoom into node-2. The kubelet sees the deletion and starts shutting the Pod down. At the same moment kube-proxy on every node is removing the Pod from its rules, and those two things race. The preStop hook, a 5-second sleep, gives the rules time to catch up, though nothing checks that they have. Then the kubelet sends SIGTERM, the app finishes its open requests and exits. Had it ignored SIGTERM, SIGKILL would follow when the 30 seconds ran out.",
      facts: [
        ["PRESTOP", "sleep 5"],
        ["THEN", "SIGTERM to PID 1"],
        ["DEADLINE", "30 s total, then SIGKILL"],
        ["EXITED AFTER", "6.8 s"],
      ],
      view: "node2",
      focus: ["n2.api", "n2.kubelet", "n2.containerd", "n2.podB"],
      pods: { node2: ["other", "v1"] },
      events: [
        ev({
          id: "u13", at: 11160, src: API, dst: "kubelet · node-2", layer: "control", size: "2.4 KB", title: "KUBELET SEES THE DELETE", path: ["n2.api", "n2.kubelet"],
          says: "node-2's kubelet sees the deletion and starts shutting the Pod down.",
          info: `WATCH MODIFIED Pod ${OLD}-p8m4z (deletionTimestamp set)`,
          decoded: [sec("WATCH STREAM", [["type", "MODIFIED"], ["deletionTimestamp", "set"], ["grace", "30 s"]])],
        }),
        ev({
          id: "u14", at: 11170, src: "kubelet · node-2", dst: `${OLD}-p8m4z`, layer: "node", size: " - ", title: "RUN PRESTOP", path: ["n2.kubelet", "n2.podB"],
          says: "First, a 5-second pause, to give every node time to stop sending it traffic. Nothing checks that they did.",
          info: "preStop: exec sleep 5",
          decoded: [sec("lifecycle.preStop", [["exec", "sleep 5"], ["why", "time for nodes to drop 10.244.2.18 from their rules"], ["confirms", "nothing - a timer, not a check"]])],
        }),
        ev({
          id: "u15", at: 16170, src: "kubelet · node-2", dst: "containerd · node-2", layer: "node", size: "0.1 KB", title: "SIGTERM", path: ["n2.kubelet", "n2.containerd"],
          says: "Then the app gets SIGTERM: a polite request to finish up and exit.",
          info: "StopContainer web timeout=25s → SIGTERM",
          decoded: [sec("gRPC · runtime.v1.RuntimeService", [["method", "StopContainer"], ["timeout", "25 s (30 − 5 spent in preStop)", true], ["signal", "SIGTERM to PID 1"]])],
        }),
        ev({
          id: "u16", at: 17970, src: `${OLD}-p8m4z`, dst: "containerd · node-2", layer: "node", size: " - ", title: "APP EXITS", path: ["n2.podB", "n2.containerd"],
          says: "The app finishes its last requests and exits cleanly.",
          info: "web exited 0 after draining 2 open requests (1.8 s)",
          decoded: [sec("CONTAINER", [["exit code", "0"], ["drained", "2 in-flight requests"], ["SIGKILL needed", "no"]])],
        }),
        ev({
          id: "u17", at: 18000, src: "kubelet · node-2", dst: "containerd · node-2", layer: "net", size: "0.2 KB", title: "TEAR DOWN NETWORK", path: ["n2.containerd", "n2.cni0"],
          says: "The Pod's network is torn down and its IP freed.",
          info: "StopPodSandbox → CNI DEL 10.244.2.18",
          decoded: [sec("CNI DEL", [["ip released", "10.244.2.18", true], ["veth", "removed from cni0"]])],
        }),
        ev({
          id: "u18", at: 18020, src: "kubelet · node-2", dst: API, layer: "api", size: "0.2 KB", title: "POD GONE", path: ["n2.kubelet", "n2.api"],
          says: "The Pod is finally removed from the cluster.",
          info: `DELETE …/pods/${OLD}-p8m4z  gracePeriodSeconds=0`,
          decoded: [sec("FINAL DELETE", [["gracePeriodSeconds", "0"], ["result", "object removed from etcd", true]])],
        }),
      ],
    },
    {
      title: "REPEAT AND FINISH",
      subtitle: "Two more rounds, then done",
      body: "The same loop runs twice more: surge one new Pod, wait for it to be ready, retire one old Pod. Each round takes about 11 seconds, mostly the readiness delay. When the new ReplicaSet has 3 ready Pods, the old one sits at 0 Pods. It's kept, not deleted, so kubectl rollout undo can scale it back up.",
      facts: [
        ["ROUNDS", "3"],
        ["TOTAL", "≈ 33.5 s"],
        ["OLD REPLICASET", `${OLD} · 0 Pods, kept`],
        ["ROLLBACK", "kubectl rollout undo deployment/web"],
      ],
      view: "cluster",
      focus: ["you", "cp", "web-deploy", "web-rs", "web-rs2", "web-svc", "node1", "node2"],
      events: [
        ev({
          id: "u19", at: 22300, src: "deployment ctrl", dst: API, layer: "control", size: " - ", title: "ROUND 2", path: ["cp", "node2"],
          says: "Round 2: another new Pod becomes ready, another old one goes.",
          info: `+${NEW}-m2xbd on node-2 ready · −${OLD}-kq9tw`,
          res: {
            "web-rs": { kind: "replicaset", name: "ReplicaSet …d8b4", sub: "1 Pod · v1" },
            "web-rs2": { kind: "replicaset", name: "ReplicaSet …c9f6", sub: "2 Pods · v1.5.0" },
          },
          decoded: [sec("ROUND 2", [["new Pod", `${NEW}-m2xbd · node-2`, true], ["retired", `${OLD}-kq9tw · node-1`], ["ReplicaSets", "new 2 · old 1"]])],
          pods: { node1: ["other", "v2"], node2: ["other", "v1", "v2"] },
        }),
        ev({
          id: "u20", at: 33500, src: "deployment ctrl", dst: API, layer: "control", size: " - ", title: "ROUND 3", path: ["cp", "node2"],
          says: "Round 3: the last old Pod is replaced.",
          info: `+${NEW}-zq7wd on node-2 ready · −${OLD}-x2kqp`,
          res: {
            "web-rs": { kind: "replicaset", name: "ReplicaSet …d8b4", sub: "0 Pods" },
            "web-rs2": { kind: "replicaset", name: "ReplicaSet …c9f6", sub: "3/3 · v1.5.0" },
          },
          decoded: [sec("ROUND 3", [["new Pod", `${NEW}-zq7wd · node-2`, true], ["why node-2", "already has the 1.5.0 image"], ["retired", `${OLD}-x2kqp · node-2`], ["ReplicaSets", "new 3 · old 0"]])],
          pods: { node2: ["other", "v2", "v2"] },
        }),
        ev({
          id: "u21", at: 33520, src: "deployment ctrl", dst: API, layer: "api", size: "0.4 KB", title: "ROLLOUT COMPLETE", path: ["web-rs2", "web-rs2"],
          says: "All 3 Pods run the new version. The old ReplicaSet stays, at 0 Pods, for rollback.",
          info: "Deployment web: updated 3 · ready 3 · available 3",
          res: {
            "web-deploy": { kind: "deployment", name: "Deployment web", sub: "1.5.0 · rolled out" },
            "web-rs": { kind: "replicaset", name: "ReplicaSet …d8b4", sub: "0 · kept for rollback" },
            "web-rs2": { kind: "replicaset", name: "ReplicaSet …c9f6", sub: "3/3 Pods · v1.5.0" },
          },
          decoded: [sec("STATUS", [["updatedReplicas", "3", true], ["availableReplicas", "3"], ["conditions.Progressing", "NewReplicaSetAvailable"]]), sec("HISTORY", [["revisionHistoryLimit", "10"], [OLD, "kept at 0 for rollback"]])],
        }),
        ev({
          id: "u22", at: 33530, src: API, dst: "kubectl", layer: "api", size: "0.2 KB", title: "ROLLOUT STATUS", path: ["cp", "you"],
          says: "kubectl rollout status reports success.",
          info: "deployment \"web\" successfully rolled out",
          decoded: [sec("kubectl rollout status", [["watching", "Deployment web"], ["result", "successfully rolled out", true]])],
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "Patch + new ReplicaSet", layer: "api", start: 0, duration: 40 },
    { value: "t2", label: "Round 1 · v2 Pod starts", layer: "node", start: 40, duration: 1060 },
    { value: "t3", label: "Round 1 · readiness delay", layer: "node", start: 1100, duration: 10010 },
    { value: "t4", label: "Old Pod shuts down", layer: "drop", start: 11140, duration: 6880 },
    { value: "t5", label: "Round 2", layer: "control", start: 11140, duration: 11160 },
    { value: "t6", label: "Round 3", layer: "control", start: 22300, duration: 11200 },
  ],
  summary: {
    title: "ROLLED OUT",
    body: "Three rounds of surge, wait, retire, and the number of ready Pods never dropped below 3. The slow part was waiting for readiness, which is the point: the rollout only moves as fast as new Pods can prove they work. The other half of zero downtime is the app's: handle SIGTERM, and leave time for the endpoints to update.",
    facts: [
      ["READY PODS", "never fewer than 3"],
      ["MOST TIME", "readiness delay, 10 s per round"],
      ["NEXT", "Pod to Pod, same node"],
    ],
  },
}
