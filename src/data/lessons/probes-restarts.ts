import type { Lesson } from "../types"
import { ev, sec } from "./helpers"

const POD = "web-…-p8m4z"
const API = "kube-apiserver"
const KUBELET = "kubelet · node-2"
const CONTAINERD = "containerd · node-2"

export const probesRestarts: Lesson = {
  id: "probes-restarts",
  title: "Probes and restarts",
  subtitle: "CrashLoopBackOff, explained",
  category: "node",
  actors: ["you", "cp", "node2"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    [KUBELET]: "kubelet", [CONTAINERD]: "containerd", [POD]: "Pod p8m4z",
  },
  overview: {
    body: "Liveness and readiness probes, restart counts, and the backoff that doubles up to five minutes. A bad setting makes one web Pod crash on boot, again and again. Watch the kubelet try, wait, double the wait, and take the Pod out of the Service - until the fix lands and the clock resets.",
    facts: [
      ["POD", `${POD} · node-2`],
      ["RESTART POLICY", "Always - every exit earns a retry"],
      ["BACKOFF", "10 s → 20 → 40 → 80 → 160 → 300, capped"],
      ["PROBES", "readiness stops traffic · liveness forces restart"],
    ],
  },
  steps: [
    {
      title: "THE EXIT",
      subtitle: "400 ms after start",
      body: `Zoom into node-2. A rollout gave ${POD} a bad ConfigMap value, and its container is a sprinter: it starts, reads LOG_LEVEL=debugg, fails fast and exits 1 - 400 milliseconds in. containerd reports the exit to the kubelet over CRI, with the code and the start time. The Pod object still exists; only the process is gone.`,
      facts: [
        ["STARTED", "t=0 · /app/server --port 8080"],
        ["EXITED", "t=400 ms · code 1"],
        ["WHY", "unknown to the kubelet - it saw a code"],
      ],
      view: "node2",
      focus: ["n2.kubelet", "n2.containerd", "n2.podB"],
      events: [
        ev({
          id: "pr1", at: 0, src: KUBELET, dst: POD, layer: "node", size: "0.1 KB", title: "START CONTAINER", path: ["n2.kubelet", "n2.podB"],
          says: "The container starts for the first time with the broken setting.",
          info: "StartContainer web",
          decoded: [sec("ENV", [["LOG_LEVEL", "debugg (typo from ConfigMap)"], ["app", "reads config at boot, fails fast"]])],
        }),
        ev({
          id: "pr2", at: 400, src: POD, dst: CONTAINERD, layer: "drop", size: "0.1 KB", title: "EXIT 1", path: ["n2.podB", "n2.containerd"],
          says: "Four hundred milliseconds later the app gives up and exits 1.",
          info: "ExitHandler web · exitCode 1",
          decoded: [sec("CRI · EXITED", [["exitCode", "1", true], ["startedAt", "10:41:22.104"], ["finishedAt", "10:41:22.504"], ["reason", "Error"]])],
          note: "The kubelet never learns why. The why is in the app's logs - kubectl logs --previous shows this exact run.",
        }),
        ev({
          id: "pr3", at: 420, src: CONTAINERD, dst: KUBELET, layer: "node", size: "0.1 KB", title: "KUBELET NOTICED", path: ["n2.containerd", "n2.kubelet"],
          says: "The kubelet hears about the exit and reaches for the restart policy.",
          info: "ContainerEventsHandler → restartPolicy Always",
          decoded: [sec("DECISION", [["restartPolicy", "Always"], ["first exit", "wait 10 s before retry", true], ["restartCount", "0 → 1 (booked)"]])],
        }),
      ],
    },
    {
      title: "WAIT, RETRY, WAIT",
      subtitle: "the backoff begins",
      body: "The restart is not immediate: the kubelet starts a backoff clock at 10 seconds. The container sits in state Waiting with reason CrashLoopBackOff - a wait state, not an error in itself. At t=10 s the container starts again, reads the same broken env, and exits 1 again. The clock doubles.",
      facts: [
        ["STATE", "Waiting · reason CrashLoopBackOff"],
        ["RETRY 1", "t=10 s · crash #2"],
        ["NEXT WAIT", "20 s"],
      ],
      view: "node2",
      focus: ["n2.kubelet", "n2.podB"],
      events: [
        ev({
          id: "pr4", at: 500, src: KUBELET, dst: API, layer: "api", size: "0.9 KB", title: "WAITING: CRASHLOOPBACKOFF", path: ["n2.kubelet", "n2.api"],
          says: "The kubelet reports the container waiting, with the reason every operator knows by heart.",
          info: `PATCH …/pods/${POD}/status  waiting.reason=CrashLoopBackOff`,
          decoded: [sec("CONTAINER STATUS", [["state", "waiting", true], ["reason", "CrashLoopBackOff", true], ["restartCount", "1"], ["backoff", "10 s running"]])],
        }),
        ev({
          id: "pr5", at: 10400, src: KUBELET, dst: POD, layer: "node", size: "0.1 KB", title: "RETRY AFTER 10 S", path: ["n2.kubelet", "n2.podB"],
          says: "Ten seconds in, the container starts again - with the same environment.",
          info: "StartContainer web (attempt 2)",
          decoded: [sec("ATTEMPT 2", [["env", "unchanged - same ConfigMap"], ["result", "exit 1 after 400 ms"], ["backoff now", "10 → 20 s", true]])],
        }),
      ],
    },
    {
      title: "THE DOUBLING",
      subtitle: "up to five minutes, forever",
      body: "Every crash doubles the next wait: 10, 20, 40, 80, 160, then 300 seconds, where it caps. Nothing else escalates - no alert, no eviction, no Node selector. The Pod sits in this loop indefinitely, retrying every five minutes, while its ReplicaSet counts it as owned and the Service quietly routes around it. Only a change to the container's inputs breaks the cycle.",
      facts: [
        ["SCHEDULE", "10 · 20 · 40 · 80 · 160 · 300 · 300 · …"],
        ["CAP", "300 s - reached at crash 6"],
        ["POD LIFETIME", "unbounded - it loops for days if you let it"],
      ],
      view: "cluster",
      focus: ["cp", "node2"],
      events: [
        ev({
          id: "pr6", at: 152000, src: API, dst: "kubectl", layer: "api", size: "0.5 KB", title: "WHAT YOU SEE", path: ["cp", "cp"],
          says: "From the outside, the status never changes: CrashLoopBackOff, restartCount climbing.",
          info: "kubectl get pods → CrashLoopBackOff · RESTARTS 4",
          decoded: [sec("CRASH SCHEDULE", [["crash 1", "t=0.4 s"], ["crash 2", "t≈10 s"], ["crash 3", "t≈30 s"], ["crash 4", "t≈71 s"], ["crash 5", "t≈151 s"], ["crash 6+", "every 300 s, capped", true]])],
          note: "The name is a promise: crash, loop, back off. The kubelet assumes the fault is temporary and keeps trying on a human-patience schedule.",
        }),
        ev({
          id: "pr7", at: 311600, src: "endpointslice ctrl", dst: API, layer: "control", size: "0.7 KB", title: "ALREADY FORGOTTEN", path: ["cp", "cp"],
          says: "The Service dropped this Pod long ago; the loop is invisible to traffic.",
          info: "endpoints web: 10.244.1.12, 10.244.2.17 (p8m4z absent)",
          decoded: [sec("ENDPOINTSLICE", [["10.244.2.18", "removed at first readiness failure", true], ["serving", "2 of 3 endpoints"], ["users", "unaffected - retries hide the gap"]])],
        }),
      ],
    },
    {
      title: "TWO PROBES",
      subtitle: "traffic versus restart",
      body: "Probes are the two independent health opinions, and they act on different things. The readiness probe failed at 300 ms - before the first crash - so the endpoint was pulled: no traffic. The liveness probe never even ran, because the container dies first; had the app hung instead of exited, three liveness failures would have made the kubelet kill it and start a fresh one. Readiness owns the endpoints list; liveness owns the process.",
      facts: [
        ["READINESS", "failed 300 ms in → out of endpoints"],
        ["LIVENESS", "periodSeconds 10 · failureThreshold 3"],
        ["READINESS DOES", "stop traffic - nothing else"],
        ["LIVENESS DOES", "kill + restart - nothing else"],
      ],
      view: "node2",
      focus: ["n2.kubelet", "n2.podB"],
      events: [
        ev({
          id: "pr8", at: 312000, src: KUBELET, dst: POD, layer: "net", size: "0.2 KB", title: "READINESS PROBE", path: ["n2.kubelet", "n2.podB"],
          says: "Each attempt, the kubelet tries the health check first - and it never passes.",
          info: "GET http://10.244.2.18:8080/healthz → connection refused",
          decoded: [sec("HTTP PROBE · READINESS", [["result", "refused - nothing listening yet"], ["effect", "conditions.Ready=False"], ["effect on traffic", "endpoint absent"]])],
        }),
        ev({
          id: "pr9", at: 312100, src: KUBELET, dst: CONTAINERD, layer: "drop", size: " - ", title: "LIVENESS, BY CONTRAST", path: ["n2.kubelet", "n2.containerd"],
          says: "A liveness failure would mean kill and restart - a hammer readiness doesn't have.",
          info: "liveness ×3 failed → StopContainer + restart",
          decoded: [sec("THE DIFFERENCE", [["readiness fails", "remove from endpoints", true], ["liveness fails", "kill the container", true], ["this pod", "crashes before liveness gets a turn"], ["a hung app", "liveness is the one that fires"]])],
          note: "Swapping them is a classic outage: a liveness probe that checks a dependency, like the database, restarts every Pod at once the moment that dependency has a bad minute. Readiness absorbs; liveness amputates.",
        }),
      ],
    },
    {
      title: "THE FIX LANDS",
      subtitle: "clock reset, traffic returns",
      body: "Someone fixes the typo and the rollout updates the ConfigMap into the Pod's next container. This start reads LOG_LEVEL=debug and boots, because the kubelet resolves env from the ConfigMap afresh for every new container. The readiness probe passes on the second try, Ready flips true, the kubelet reports it, and the endpoint comes back. Once the container has run cleanly for 10 minutes, the kubelet resets the backoff clock. Total outage for this Pod: one bad deploy and about ten minutes of looping.",
      facts: [
        ["FIXED", "LOG_LEVEL debugg → debug"],
        ["BACKOFF", "resets after 10 min of clean running"],
        ["READY", "probe 200 on attempt 2"],
        ["ENDPOINT", "10.244.2.18 back in the slice"],
      ],
      view: "cluster",
      focus: ["you", "cp", "node2"],
      events: [
        ev({
          id: "pr10", at: 600000, src: "kubectl", dst: API, layer: "api", size: "0.2 KB", title: "FIX THE CONFIGMAP", path: ["you", "cp"],
          says: "The typo is fixed and applied.",
          info: "PATCH …/configmaps/web-config  LOG_LEVEL=debug",
          decoded: [sec("PATCH", [["data.LOG_LEVEL", "debugg → debug", true], ["reaches the Pod", "on the next container start"]])],
        }),
        ev({
          id: "pr11", at: 612400, src: KUBELET, dst: POD, layer: "node", size: "0.1 KB", title: "CLEAN START", path: ["node2", "node2"],
          says: "The next retry starts with the corrected environment - and it stays up.",
          info: "StartContainer web (attempt 7) · env LOG_LEVEL=debug",
          decoded: [sec("ATTEMPT 7", [["boot", "config parsed ✓"], ["listening", "0.0.0.0:8080"], ["backoff clock", "resets after 10 min up", true]])],
        }),
        ev({
          id: "pr12", at: 614600, src: KUBELET, dst: POD, layer: "net", size: "0.2 KB", title: "READINESS PASSES", path: ["node2", "node2"],
          says: "The health check passes, and the Pod is allowed back into the Service.",
          info: "GET /healthz → 200 OK",
          decoded: [sec("HTTP PROBE", [["attempt", "2 (first raced the boot)"], ["result", "200 OK"], ["conditions.Ready", "False → True", true]])],
        }),
        ev({
          id: "pr13", at: 614800, src: "endpointslice ctrl", dst: API, layer: "api", size: "0.7 KB", title: "ENDPOINT BACK", path: ["cp", "cp"],
          says: "The endpoint returns and traffic resumes, three of three again.",
          info: "PUT …/endpointslices/web-7xk2p  +10.244.2.18:8080 ready",
          decoded: [sec("ENDPOINTSLICE", [["10.244.2.18", "ready=true", true], ["serving", "3 of 3"], ["restartCount", "6 - history, not a verdict"]])],
          note: "restartCount never resets while the Pod lives; it's a record, not a status. Only a new Pod starts at zero.",
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "boot → exit 1", layer: "drop", start: 0, duration: 420 },
    { value: "t2", label: "backoff 10 s → crash #2", layer: "node", start: 500, duration: 9900 },
    { value: "t3", label: "20 · 40 · 80 · 160 · cap 300", layer: "node", start: 10400, duration: 301200 },
    { value: "t4", label: "probes: readiness vs liveness", layer: "net", start: 312000, duration: 300 },
    { value: "t5", label: "fix lands → Ready", layer: "control", start: 600000, duration: 14800 },
  ],
  summary: {
    title: "WAIT STATE",
    body: "CrashLoopBackOff is not an error - it's the kubelet patiently retrying a container whose inputs haven't changed, on a doubling schedule that tops out at five minutes. The two probes did their separate jobs the whole time: readiness kept traffic away, liveness stood by with the hammer. The moment the input changed, one clean boot ended the loop.",
    facts: [
      ["BACKOFF", "10 s → 300 s cap · resets after 10 min up"],
      ["PROBES", "readiness = traffic · liveness = restart"],
      ["NEXT", "OOMKilled"],
    ],
  },
}
