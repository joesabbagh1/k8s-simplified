import type { Lesson } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const KUBELET = "kubelet · node-2"
const PROXY = "kube-proxy · node-1"
const POD = "web-…-p8m4z"
const CLIENT = "198.51.100.7"

export const gracefulShutdown: Lesson = {
  id: "graceful-shutdown",
  title: "Graceful shutdown",
  subtitle: "SIGTERM and the endpoint race",
  category: "app",
  actors: ["cp", "node1", "node2"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    [KUBELET]: "node-2", "containerd · node-2": "node-2", [PROXY]: "kube-proxy",
    [POD]: "Pod p8m4z", "web-…-x2kqp": "Pod x2kqp", [CLIENT]: "client",
  },
  overview: {
    body: "preStop, SIGTERM, the 30-second grace period, and why requests can still arrive after shutdown starts. Deleting a Pod starts two clocks at once - the control plane removing it from the Service, and the kubelet stopping the container - and they are not synchronized. The whole craft of graceful shutdown is buying overlap between them. The times here belong to one example run; Kubernetes guarantees none of the propagation times.",
    facts: [
      ["POD", `${POD} · serving 12 rpm when deleted`],
      ["GRACE", "terminationGracePeriodSeconds 30"],
      ["PRESTOP", "sleep 5 · this example's choice"],
      ["THE RACE", "endpoint removal vs iptables · no fixed bound"],
      ["TIMINGS", "one example run, not limits"],
    ],
  },
  steps: [
    {
      title: "TWO CLOCKS START",
      subtitle: "nobody synchronizes them",
      body: `The delete lands and two sequences begin in parallel. Track one, control plane: the endpointslice controller drops 10.244.2.18 from the web Service. Track two, node: the kubelet begins the 30-second countdown to kill the container. Between them sits the actual race - kube-proxy on every node has to notice track one and rewrite its iptables rules before new connections stop landing here. How long that takes depends on three things: the watch delivering the change, kube-proxy's wait between syncs, and the time to program the rules. minSyncPeriod sets only the middle one.`,
      facts: [
        ["TRACK 1", "endpoint out of the slice"],
        ["TRACK 2", "kubelet: 30 s countdown starts"],
        ["BETWEEN THEM", "kube-proxy × N must rewrite rules"],
        ["GAP", "watch + sync wait + programming · no fixed bound"],
      ],
      view: "cluster",
      focus: ["cp", "node1", "node2"],
      pods: { node2: ["other", "v1", "terminating"] },
      events: [
        ev({
          id: "gs1", at: 0, src: "endpointslice ctrl", dst: API, layer: "api", size: "0.7 KB", title: "ENDPOINT OUT", path: ["cp", "cp"],
          says: "The Pod is marked not ready in the Service's endpoint list, so it should get no new traffic.",
          info: "PUT …/endpointslices/web-7xk2p  10.244.2.18 terminating",
          decoded: [sec("ENDPOINTSLICE", [["10.244.2.18", "ready=true → false · terminating=true", true], ["serving", "2 of 3 ready"]])],
        }),
        ev({
          id: "gs2", at: 10, src: API, dst: KUBELET, layer: "control", size: "2.4 KB", title: "COUNTDOWN STARTS", path: ["node2", "node2"],
          says: "The kubelet starts the 30-second clock - but the network doesn't know yet.",
          info: `WATCH MODIFIED Pod ${POD} (deletionTimestamp)`,
          decoded: [sec("SHUTDOWN BEGIN", [["gracePeriod", "30 s", true], ["step 1", "preStop hook (if any)"], ["step 2", "SIGTERM"], ["network right now", "still routing to 10.244.2.18 - see the race"]])],
        }),
        ev({
          id: "gs3", at: 25, src: PROXY, dst: PROXY, layer: "net", size: " - ", title: "HEARD, NOT YET APPLIED", path: ["node1", "node1"],
          says: "In this run node-1's kube-proxy hears within 25 ms, but its rules are not rewritten yet. Other nodes may hear later.",
          info: "EndpointSlice change queued · iptables not rewritten yet",
          decoded: [sec("PROPAGATION", [["watch push", "~15 ms here · not bounded"], ["minSyncPeriod", "1 s · minimum gap between syncs, not a deadline", true], ["programming", "takes its own time once a sync starts"], ["every node", "on its own schedule"], ["until then", "DNAT can still pick the dying Pod"]])],
          note: "minSyncPeriod spaces out rule syncs. It does not limit how late the watch event arrives or how long the rules take to program, so 1 s here does not mean updated within 1 s. This gap is why Pods behind a Service often use a preStop delay.",
        }),
      ],
    },
    {
      title: "THE RACE, LOST",
      subtitle: "without a preStop hook",
      body: `First, the version without a preStop hook - the default. The kubelet would send SIGTERM at once and the app would close its listener, while the rules on node-1 still point at it. Here's a request that finds that gap: DNAT'd to 10.244.2.18 by rules that were still live, it arrives at a listener that is already closing - connection refused, a reset mid-request at worst. The fix isn't to prevent this; it's to make it survivable: the client's library retries, this time draws a healthy endpoint, and the user sees a 40-ms wobble, not an error page. Until node-1's rules are rewritten, a retry could draw the dying Pod again.`,
      facts: [
        ["REQUEST", `GET /cart · ${CLIENT}`],
        ["DNAT", "→ 10.244.2.18:8080 (stale rule)"],
        ["RESULT", "connection reset"],
        ["RETRY", "→ 10.244.2.17 · 200 OK · +38 ms"],
      ],
      view: "cluster",
      focus: ["node1", "node2"],
      events: [
        ev({
          id: "gs4", at: 60, src: CLIENT, dst: POD, layer: "net", size: "0.4 KB", title: "INTO THE GAP", path: ["node1", "node2"],
          says: "Without a hook: one request, routed by rules that are out of date, reaches a Pod that already got SIGTERM.",
          info: "SYN → DNAT 10.244.2.18:8080 (rule still installed)",
          decoded: [sec("WHY IT LANDED HERE", [["rule state", "pre-change snapshot"], ["conntrack", "fresh connection - no old entry"]])],
        }),
        ev({
          id: "gs5", at: 80, src: POD, dst: CLIENT, layer: "drop", size: "0.1 KB", title: "RESET", path: ["node2", "node1"],
          says: "The Pod resets the connection - its listener is on the way out.",
          info: "RST 10.244.2.18:8080 → client",
          decoded: [sec("FAILURE", [["type", "ECONNRESET"], ["app's view", "SIGTERM at t=0 · listener already closed"]])],
        }),
        ev({
          id: "gs6", at: 118, src: CLIENT, dst: "web-…-x2kqp", layer: "net", size: "0.4 KB", title: "RETRY WINS", path: ["node1", "node2"],
          says: "This retry draws a healthy endpoint, so in this run the request costs 38 extra milliseconds.",
          info: "retry → 10.244.2.17:8080 · 200 OK",
          decoded: [sec("RECOVERY", [["retry policy", "client library, 3 attempts"], ["picked", "10.244.2.17 · a new random draw"], ["guaranteed", "no - stale rules can pick the dying Pod again"], ["user-visible cost", "≈ 38 ms in this run", true]])],
          note: "Zero downtime is a group project: the platform races the rules, and the app's clients must tolerate a retry. Neither half works alone.",
        }),
      ],
    },
    {
      title: "PRESTOP",
      subtitle: "buying time, not proof",
      body: `Now the version this Pod actually has. Back on node-2, the kubelet runs the preStop hook before anything terminal happens: sleep 5. Five seconds of deliberate nothing, while the container keeps serving normally. That gives the change from step 1 time to spread, but it confirms nothing: the kubelet never asks any kube-proxy whether its rules changed. When the timer ends, SIGTERM follows, even if a node is still behind. The sleep also spends the grace period: 30 total = 5 preStop + 25 for SIGTERM and drain.`,
      facts: [
        ["HOOK", "exec sleep 5"],
        ["SERVES DURING", "yes - listener stays open"],
        ["ARITHMETIC", "30 = 5 preStop + 25 drain"],
        ["CONFIRMS", "nothing - no node reports back"],
        ["IF NO HOOK", "SIGTERM at t=0, rules likely stale"],
      ],
      view: "node2",
      focus: ["n2.kubelet", "n2.podB"],
      events: [
        ev({
          id: "gs7", at: 200, src: KUBELET, dst: POD, layer: "node", size: " - ", title: "RUN THE HOOK", path: ["n2.kubelet", "n2.podB"],
          says: "Before any signal, the kubelet runs the preStop hook: five seconds for the change to spread.",
          info: "lifecycle.preStop.exec: sleep 5",
          decoded: [sec("LIFECYCLE BLOCK", [["preStop.exec", "sleep 5", true], ["runs", "before SIGTERM, serially"], ["why 5", "an assumed margin - measure your own cluster"], ["container state", "still serving traffic"]])],
        }),
        ev({
          id: "gs8", at: 5200, src: KUBELET, dst: POD, layer: "node", size: "0.1 KB", title: "HOOK DONE", path: ["n2.kubelet", "n2.podB"],
          says: "The sleep is over. The kubelet moves on without checking whether every node's rules have changed.",
          info: "preStop complete · ≈ 25 s of grace left",
          decoded: [sec("WHERE WE STAND", [["time bought", "5 s", true], ["rules on all nodes", "assumed updated · not checked"], ["a late node", "can still send new connections here"], ["grace remaining", "≈ 25 s"], ["next", "SIGTERM, either way"]])],
          note: "A finished sleep means five seconds passed, not that the cluster converged. Choose the delay from what you measure, keep it well inside the grace period, and let clients retry for the cases it misses.",
        }),
      ],
    },
    {
      title: "SIGTERM",
      subtitle: "PID 1 is on its own",
      body: `The kubelet asks containerd to stop the container, and the runtime sends SIGTERM to PID 1 - the app itself, if you used exec. A well-behaved server does three things: close the listener (no new requests), finish the ones in flight, flush and exit 0. The traps are everywhere: a shell wrapper eats the signal; a naive app exits mid-request; an eager one exits before the rules propagate and re-creates step 2's race single-handedly.`,
      facts: [
        ["SIGNAL", "SIGTERM → PID 1"],
        ["GOOD RESPONSE", "close listener · drain · exit 0"],
        ["TRAP 1", "shell wrapper swallows SIGTERM"],
        ["TRAP 2", "catch-and-ignore past the deadline"],
      ],
      view: "node2",
      focus: ["n2.kubelet", "n2.containerd", "n2.podB"],
      events: [
        ev({
          id: "gs9", at: 5300, src: KUBELET, dst: "containerd · node-2", layer: "node", size: "0.1 KB", title: "STOP CONTAINER", path: ["n2.kubelet", "n2.containerd"],
          says: "The kubelet asks containerd to stop the app, politely, with a timeout.",
          info: "StopContainer web · timeout ≈ 25 s",
          decoded: [sec("gRPC · runtime.v1.RuntimeService", [["method", "StopContainer"], ["signal", "SIGTERM to PID 1"], ["timeout", "grace minus preStop", true]])],
        }),
        ev({
          id: "gs10", at: 5350, src: POD, dst: POD, layer: "node", size: " - ", title: "CLOSE, DRAIN, EXIT", path: ["n2.podB", "n2.podB"],
          says: "The app closes its listener, finishes two in-flight requests, and exits cleanly.",
          info: "listener closed · 2 requests drained (1.6 s) · exit 0",
          decoded: [sec("A GOOD CITIZEN", [["1 · close(l)", "no new connections"], ["2 · drain", "2 in-flight → 200s", true], ["3 · flush + exit(0)", "logs shipped, exit 0"]])],
          note: "In the Dockerfile, use the exec form - CMD [\"/app/server\"] - or end a wrapper script with exec /app/server. Either way the app is PID 1 and receives the signal itself.",
        }),
      ],
    },
    {
      title: "THE DEADLINE",
      subtitle: "30 seconds, then the hammer",
      body: `Had the app hung, the story ends differently: the grace period expires and the runtime sends SIGKILL. Uncatchable - open requests die on the wire, half-written files stay half-written, and the exit code is 137. The grace period is a contract: the platform will wait exactly this long, and no longer. Workloads that genuinely need more - big flushes, long uploads - must raise terminationGracePeriodSeconds rather than hope.`,
      facts: [
        ["IF HUNG", "SIGKILL at t=30 s"],
        ["EXIT", "137 · requests cut mid-flight"],
        ["KNOB", "terminationGracePeriodSeconds"],
        ["CONTRACT", "the platform waits, but exactly"],
      ],
      view: "node2",
      focus: ["n2.kubelet", "n2.containerd"],
      events: [
        ev({
          id: "gs11", at: 7100, src: POD, dst: "containerd · node-2", layer: "node", size: " - ", title: "EXITED 0", path: ["n2.podB", "n2.containerd"],
          says: "Our app exited 0 at seven seconds; the hammer never came.",
          info: "web exited 0 · sandbox torn down · IP 10.244.2.18 freed",
          decoded: [sec("CLEAN EXIT", [["exitCode", "0"], ["SIGKILL needed", "no"], ["used of 30 s", "≈ 7 (5 hook + 2 drain)"]])],
        }),
        ev({
          id: "gs12", at: 30000, src: KUBELET, dst: POD, layer: "drop", size: " - ", title: "THE ALTERNATE ENDING", path: ["n2.kubelet", "n2.podB"],
          says: "In the timeline where the app hung, this is the 30-second mark: SIGKILL.",
          info: "grace expired → SIGKILL (alternate timeline)",
          decoded: [sec("WHAT THE HAMMER MEANS", [["signal", "SIGKILL - no handler runs"], ["in-flight requests", "severed", true], ["exit", "137"], ["fix", "raise the grace, or fix the hang"]])],
        }),
      ],
    },
  ],
  timingNote: "These times are assumptions of this example. Watch delivery and rule programming have no fixed bound, and the sleep ends on a timer, not when every node has updated.",
  timing: [
    { value: "t1", label: "endpoint out → kube-proxy hears it", layer: "net", start: 0, duration: 25 },
    { value: "t2", label: "without a hook: reset + retry", layer: "drop", start: 60, duration: 60 },
    { value: "t3", label: "preStop sleep 5", layer: "node", start: 200, duration: 5000 },
    { value: "t4", label: "SIGTERM → drain → exit 0", layer: "node", start: 5300, duration: 1800 },
    { value: "t5", label: "grace deadline (if hung)", layer: "drop", start: 30000, duration: 50 },
  ],
  summary: {
    title: "BOUGHT OVERLAP",
    body: "Shutdown is a distributed dance with no conductor: the control plane retires the endpoint, every node's rules converge at their own pace, and the process drains at its own. preStop buys time for those rules to change without confirming that they did, SIGTERM asks the process politely, and the 30-second grace is the exact width of the platform's patience. Together they make step 2's reset unlikely, not impossible, so clients still need to retry.",
    facts: [
      ["USED", "≈ 7 s of the 30 s budget, in this run"],
      ["PRESTOP", "time to propagate, not confirmation"],
      ["WITHOUT PRESTOP", "1 request reset · saved by a retry"],
      ["NEXT", "Autoscaling"],
    ],
  },
}
