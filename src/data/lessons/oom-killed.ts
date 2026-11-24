import type { Lesson } from "../types"
import { ev, sec } from "./helpers"

const POD = "web-…-p8m4z"
const API = "kube-apiserver"
const KUBELET = "kubelet · node-2"
const CONTAINERD = "containerd · node-2"
const SCOPE = "cri-containerd-9c2f7a….scope"

export const oomKilled: Lesson = {
  id: "oom-killed",
  title: "OOMKilled",
  subtitle: "Memory limits in practice",
  category: "node",
  seo: {
    title: "OOMKilled (exit code 137) in Kubernetes",
    description: "What happens when a Kubernetes container passes its memory limit: the cgroup that holds it, the kernel that sends SIGKILL, and exit code 137.",
  },
  actors: ["you", "cp", "node2"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    [KUBELET]: "kubelet", [CONTAINERD]: "containerd", [POD]: "Pod p8m4z",
  },
  overview: {
    body: "A container crosses its memory limit and the kernel kills it. See where the limit lives - a single cgroup file - who does the killing, and who reports it. The whole journey of one web Pod that tried to load a 300 MB report with a 256 Mi limit: allocate, charge, exceed, SIGKILL, 137.",
    facts: [
      ["POD", `${POD} · node-2 · limit 256Mi`],
      ["LIMIT FILE", `/sys/fs/cgroup/…/${SCOPE}/memory.max`],
      ["KILLER", "the kernel's OOM killer, scoped to the cgroup"],
      ["EXIT CODE", "137 = 128 + SIGKILL(9)"],
    ],
  },
  steps: [
    {
      title: "WHERE THE LIMIT LIVES",
      subtitle: "one file, written once",
      body: `The 256 Mi limit isn't a program or a watcher - it's a byte count in the container's cgroup, written by runc when the container started. Every page the kernel charges to this process increments a counter. When a charge would push the counter past memory.max, the kernel first tries to reclaim memory inside the cgroup; only when nothing is left to reclaim does it summon the OOM killer.`,
      facts: [
        ["CGROUP", `/sys/fs/cgroup/kubepods.slice/…/${SCOPE}`],
        ["MEMORY.MAX", "268435456 bytes"],
        ["ENFORCED BY", "the kernel's memory controller"],
      ],
      view: "node2",
      focus: ["n2.kubelet", "n2.containerd"],
      events: [
        ev({
          id: "om1", at: 0, src: CONTAINERD, dst: "kernel", layer: "node", size: " - ", title: "THE FILE", path: ["n2.containerd", "n2.containerd"],
          says: "The limit is one file in the container's cgroup, written at start and read by the kernel ever after.",
          info: `…/${SCOPE}/memory.max = 268435456`,
          decoded: [sec("CGROUP V2", [["memory.max", "268435456 (256 Mi)", true], ["memory.current", "0 → grows with every page"], ["who checks", "the kernel, on each charge"], ["who wrote it", "runc, from the spec containerd built out of resources.limits"]])],
          note: "Nothing polls this file. The memory controller enforces it on the allocation path itself - which is why the kill is instantaneous and unfightable.",
        }),
      ],
    },
    {
      title: "MEMORY CLIMBS",
      subtitle: "pages, cache, and the limit",
      body: "The app builds a monthly report. Its heap grows as pages stream in: 180 Mi at the halfway mark, 240 Mi a few seconds later. File cache counts too - reading the report's images charges the same cgroup, though the kernel will drop that cache first when the cgroup gets tight. At 255 Mi the app asks for one more page, and the charge crosses 268435456.",
      facts: [
        ["HEAP AT 1 S", "≈ 180 Mi"],
        ["HEAP AT 6 S", "≈ 240 Mi"],
        ["CACHE TOO", "file pages charge the same cgroup"],
        ["CROSSED AT", "7.2 s · one page request"],
      ],
      view: "node2",
      focus: ["n2.containerd", "n2.podB"],
      events: [
        ev({
          id: "om2", at: 1000, src: POD, dst: "kernel", layer: "node", size: " - ", title: "180 MI CHARGED", path: ["n2.podB", "n2.podB"],
          says: "Halfway through the report, 180 mebibytes are charged to the container.",
          info: "memory.current = 188743680",
          decoded: [sec("CHARGES", [["anon (heap)", "162 Mi"], ["file cache", "18 Mi"], ["memory.current", "180 Mi of 256", true]])],
        }),
        ev({
          id: "om3", at: 6000, src: POD, dst: "kernel", layer: "node", size: " - ", title: "240 MI", path: ["n2.podB", "n2.podB"],
          says: "The heap keeps growing; the app has no idea a ceiling exists.",
          info: "memory.current = 251658240",
          decoded: [sec("CHARGES", [["anon (heap)", "228 Mi"], ["file cache", "12 Mi"], ["memory.current", "240 Mi of 256", true], ["app's view", "no warning - malloc still succeeds"]])],
          note: "Runtimes don't watch the cgroup as they allocate. The JVM sizes its heap from the limit at startup, Go only respects it if you set GOMEMLIMIT, and Python never looks. None of them get a warning before the kill.",
        }),
      ],
    },
    {
      title: "THE KILL",
      subtitle: "SIGKILL, from the kernel",
      body: "One more page, one charge too many. The kernel reclaims what it can, and the file cache goes, but the heap is anonymous memory with no swap to go to. So it runs its OOM killer - scoped: it picks the largest process inside the offending cgroup, not on the node. That's this container's app, and there's nothing else in the cgroup to choose. SIGKILL cannot be caught, blocked or ignored; the process vanishes mid-allocation with no chance to flush, log or say goodbye.",
      facts: [
        ["TRIGGER", "charge would exceed memory.max"],
        ["SCOPE", "only processes in this cgroup"],
        ["SIGNAL", "SIGKILL - uncatchable"],
        ["LOST", "no log line, no atexit, no drain"],
      ],
      view: "node2",
      focus: ["n2.containerd", "n2.podB"],
      events: [
        ev({
          id: "om4", at: 7200, src: "kernel", dst: POD, layer: "drop", size: " - ", title: "OOM KILL", path: ["n2.podB", "n2.podB"],
          says: "The kernel kills the app instantly, mid-allocation.",
          info: `oom_kill=1 · target=web (largest in ${SCOPE})`,
          decoded: [sec("KERNEL OOM KILLER", [["memory.events oom_kill", "0 → 1", true], ["victim", "the app - only process in the cgroup"], ["signal", "SIGKILL"], ["node's other Pods", "untouched - the cgroup is the fence"], ["memory.oom.group", "1 · set by the kubelet on cgroup v2, so every process in the container dies together"]])],
          note: "Node-level memory pressure is a different disaster with a similar name: there the kubelet evicts whole Pods, starting with the ones furthest over their memory request. Here the kernel killed one process in under a millisecond.",
        }),
      ],
    },
    {
      title: "WHO REPORTS IT",
      subtitle: "from kernel counter to kubectl",
      body: `containerd sees the exit - code 137, because 128 + 9 is how a signal death looks. It also watches the cgroup's memory.events, sees oom_kill go up, and labels the exit OOMKilled, so the kubelet knows this wasn't the app's choice. The Pod's status tells the story: lastState.terminated reason OOMKilled, exitCode 137. That word in kubectl get pods is a kernel counter, laundered into vocabulary.`,
      facts: [
        ["EXIT", "137 · reported by containerd"],
        ["EVIDENCE", "memory.events: oom_kill 1"],
        ["STATUS", "lastState OOMKilled"],
        ["WHERE ELSE", "dmesg · the full OOM report"],
      ],
      view: "node2",
      focus: ["n2.kubelet", "n2.containerd"],
      events: [
        ev({
          id: "om5", at: 7250, src: CONTAINERD, dst: KUBELET, layer: "drop", size: "0.1 KB", title: "EXIT 137", path: ["n2.containerd", "n2.kubelet"],
          says: "containerd reports exit 137 with reason OOMKilled, taken from the cgroup's oom_kill counter.",
          info: "ExitHandler web · exitCode 137 · oom_kill=1",
          decoded: [sec("PUTTING IT TOGETHER", [["exitCode", "137 (128 + SIGKILL 9)", true], ["memory.events", "oom_kill 1 - kernel's confession"], ["diagnosis", "reason OOMKilled · set by containerd, copied by the kubelet"]])],
        }),
        ev({
          id: "om6", at: 7400, src: KUBELET, dst: API, layer: "api", size: "0.9 KB", title: "OOMKILLED", path: ["n2.kubelet", "n2.api"],
          says: "The kubelet reports the container OOMKilled and starts the restart clock.",
          info: `PATCH …/pods/${POD}/status  reason=OOMKilled`,
          decoded: [sec("STATUS PATCH", [["lastState.terminated.reason", "OOMKilled", true], ["lastState.terminated.exitCode", "137"], ["state", "waiting (backoff from the probes lesson)"], ["dmesg on node-2", "the kernel's full victim report"]])],
        }),
      ],
    },
    {
      title: "THE LOOP AND THE FIX",
      subtitle: "limit or leak",
      body: `restartPolicy Always means the container returns in 10 seconds - and loads the same report. If the workload genuinely needs 300 Mi, every run ends OOMKilled, and between runs the Pod shows CrashLoopBackOff: the same backoff clock as any crash. The fix is one of two: raise the limit to fit the job, or fix the leak so the job fits the limit. Streaming the report instead of loading it drops the peak to 90 Mi - under the same 256.`,
      facts: [
        ["RESTART", "same backoff clock as crashes"],
        ["REASON EACH TIME", "OOMKilled · exit 137"],
        ["FIX A", "limits.memory 256Mi → 384Mi"],
        ["FIX B", "stream the report · peak 90 Mi"],
      ],
      view: "cluster",
      focus: ["you", "cp", "node2"],
      events: [
        ev({
          id: "om7", at: 17400, src: KUBELET, dst: POD, layer: "node", size: "0.1 KB", title: "RESTARTED, DOOMED", path: ["node2", "node2"],
          says: "Ten seconds later the app restarts - and asks for the same report.",
          info: "StartContainer web (attempt 2) · report month=11",
          decoded: [sec("THE LOOP", [["attempt 2", "loads month 11 again"], ["peak wanted", "≈ 311 Mi > 256"], ["outcome", "OOMKilled at the same page"]])],
        }),
        ev({
          id: "om8", at: 25000, src: "kubectl", dst: API, layer: "api", size: "0.2 KB", title: "RAISE THE LIMIT", path: ["you", "cp"],
          says: "The fix that fits the job: a bigger limit, rolled out like any change.",
          info: "kubectl set resources … --limits=memory=384Mi",
          decoded: [sec("OR FIX THE JOB", [["limits.memory", "256Mi → 384Mi", true], ["new Pod", "new template hash, scheduled fresh"], ["peak after", "311 Mi - under at last"], ["leak instead?", "stream it · peak 90 Mi, limit untouched"]])],
          note: "The scheduler places Pods by their requests, not their limits. Raise the limit without the request and the node can be overcommitted; set the request near the real peak so the scheduler reserves room for it.",
        }),
        ev({
          id: "om9", at: 33000, src: KUBELET, dst: API, layer: "api", size: "0.9 KB", title: "READY AGAIN", path: ["node2", "cp"],
          says: "The replacement Pod finishes the report and reports Ready.",
          info: "PATCH …/pods/web-…-r5m8n/status  Ready=True",
          decoded: [sec("RECOVERED", [["report", "written · peak 311 Mi"], ["conditions.Ready", "True", true], ["endpoint", "back in the slice"]])],
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "limit already on file", layer: "node", start: 0, duration: 1000 },
    { value: "t2", label: "report loads · 180 → 240 Mi", layer: "node", start: 1000, duration: 6200 },
    { value: "t3", label: "charge crosses · SIGKILL", layer: "drop", start: 7200, duration: 50 },
    { value: "t4", label: "137 → OOMKilled status", layer: "api", start: 7250, duration: 150 },
    { value: "t5", label: "restart · loop · fix", layer: "control", start: 17400, duration: 15600 },
  ],
  summary: {
    title: "137",
    body: "The limit was one number in a cgroup file; the killer was the kernel, fenced to that cgroup; the report was a counter laundered into a reason string. No component of Kubernetes decided anything - which is the point: memory enforcement happens at allocation speed, below everything, and surfaces upward as the single word OOMKilled.",
    facts: [
      ["MECHANISM", "cgroup memory.max → kernel OOM killer"],
      ["TELL", "exit 137 · reason OOMKilled"],
      ["NEXT", "Mounting a volume"],
    ],
  },
}
