import type { Lesson, PodLayout, ResourcePatch } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const KUBELET = "kubelet · node-2"
const CONTAINERD = "containerd · node-2"
const POD = "web-…-x2kqp"
const KERNEL = "kernel · node-2"
const PROBE = "eBPF probe"
const RING = "ring buffer"
const LIBS = "falco · libs"
const META = "falco · container plugin"
const RULES = "falco · rules"
const OUT = "falco · outputs"
const SIDEKICK = "falcosidekick"
const SLACK = "Slack"
const TALON = "Falco Talon"

const SHELL_RULE = "Terminal shell in container"
const DROP_RULE = "Drop and execute new binary in container"
const CID = "9c2f7a41d0e8"

/** node-1 also gets Falcosidekick; Falco's own Pod is the last grey one on each node */
const WATCHED: PodLayout = { node1: ["other", "v1", "other", "other"], node2: ["other", "v1", "v1", "other"] }
const DS: ResourcePatch = { "falco-ds": { kind: "daemonset", name: "DaemonSet falco", sub: "2/2 ready", state: "active" } }

export const falcoAlerts: Lesson = {
  id: "falco-alerts",
  title: "Runtime alerts with Falco",
  subtitle: "Watching the kernel",
  category: "security",
  seo: {
    title: "How Falco works: Kubernetes runtime alerts",
    description: "How Falco spots an attack in Kubernetes: an eBPF probe in the kernel, rules that match events, alerts sent by Falcosidekick and Talon's response.",
  },
  actors: ["you", "cp", "node1", "node2"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    kubectl: "you", helm: "you",
    [API]: "control plane", "kube-controller-manager": "control plane",
    [KUBELET]: "kubelet", [CONTAINERD]: "kubelet",
    [POD]: "web Pod",
    [KERNEL]: "kernel", [PROBE]: "kernel", [RING]: "kernel",
    [LIBS]: "Falco", [META]: "Falco", [RULES]: "Falco", [OUT]: "Falco",
    [SIDEKICK]: "Falcosidekick", [TALON]: "Talon",
  },
  overview: {
    body: "RBAC, admission and NetworkPolicy decide what may happen. None of them sees what a program does once its container is running. Falco watches that part: it listens to the Linux kernel on every node, compares each event with a list of rules, and raises an alert when one matches. Follow two alerts from the kernel to the people they reach: a shell opened in a web Pod, and a program that was never in the image.",
    facts: [
      ["RUNS AS", "DaemonSet · one Pod per node"],
      ["LISTENS WITH", "an eBPF probe in the node's kernel"],
      ["BLOCKS ANYTHING", "no · it detects and reports"],
      ["VERSION", "Falco 0.45 · Helm chart 9.2"],
    ],
  },
  steps: [
    {
      title: "ONE POD ON EVERY NODE",
      subtitle: "a DaemonSet, because kernels are local",
      body: "All containers on a node share one kernel, and only something on that node can listen to it. So Falco is a DaemonSet: one Pod per node, and a new one whenever a node joins. Nothing is added to your own Pods. The chart can install two helpers as well: Falcosidekick, which forwards alerts, and Talon, which can react to them. Both are optional, and both are ordinary Deployments.",
      facts: [
        ["INSTALL", "helm install falco falcosecurity/falco -n falco"],
        ["FALCO", "DaemonSet · 2 nodes, 2 Pods"],
        ["HELPERS", "Falcosidekick · Falco Talon"],
        ["YOUR PODS", "unchanged · no sidecar, no restart"],
      ],
      view: "cluster",
      focus: ["you", "api", "node1", "node2"],
      events: [
        ev({
          id: "fa1", at: 0, src: "helm", dst: API, layer: "api", size: "18 KB", title: "INSTALL FALCO", path: ["you", "api"],
          says: "You install Falco with its Helm chart, with Falcosidekick and Talon turned on.",
          info: "helm install falco … --set falcosidekick.enabled=true",
          res: { "falco-ds": { kind: "daemonset", name: "DaemonSet falco", sub: "0/2 ready", state: "creating" } },
          decoded: [
            sec("CREATED IN NAMESPACE FALCO", [["DaemonSet", "falco · image falcosecurity/falco:0.45.2", true], ["Deployment", "falco-falcosidekick · Service :2801"], ["Deployment", "falco-talon · :2803 (responseActions.enabled)"], ["ConfigMaps", "falco.yaml · your own rules"]]),
            sec("TOLERATIONS", [["control-plane taint", "tolerated, so control plane nodes are watched too"]]),
          ],
        }),
        ev({
          id: "fa2", at: 250, src: API, dst: KUBELET, layer: "control", size: "4.2 KB", title: "A POD FOR NODE-2", path: ["api", "node2"],
          says: "The DaemonSet controller made one Pod per node. node-2's kubelet learns about its own.",
          info: "WATCH ADDED Pod falco-x9k2v · nodeName=node-2",
          pods: { node1: ["other", "v1", "starting", "other"], node2: ["other", "v1", "v1", "starting"] },
          decoded: [
            sec("POD SPEC", [["securityContext.privileged", "true", true], ["hostPath", "/proc → /host/proc · the node's processes"], ["hostPath", "the container runtime's socket"], ["init containers", "falcoctl: rules · falco-driver-loader: picks a driver"]]),
          ],
          note: "Privileged is a lot of power for a security tool. The chart's driver.modernEbpf.leastPrivileged setting trades it for a short list of capabilities, such as CAP_BPF and CAP_PERFMON.",
        }),
        ev({
          id: "fa3", at: 20800, src: KUBELET, dst: API, layer: "api", size: "1.4 KB", title: "FALCO STARTS", path: ["node2", "api"],
          says: "Both Falco Pods are running. They have some work to do before they report Ready.",
          info: "PATCH …/pods/falco-x9k2v/status  phase=Running",
          pods: WATCHED, res: { "falco-ds": { kind: "daemonset", name: "DaemonSet falco", sub: "0/2 ready", state: "active" } },
          decoded: [
            sec("RUNNING", [["DaemonSet", "2 desired · 0 ready yet", true], ["readiness probe", "GET :8765/healthz"], ["node-1", "falco-b4n7q"], ["node-2", "falco-x9k2v"]]),
          ],
        }),
      ],
    },
    {
      title: "HOOKS IN THE KERNEL",
      subtitle: "what Falco does as it starts",
      body: "Look inside node-2. Before it's Ready, Falco does three things. It loads its rules and works out which kernel events they need. It loads eBPF programs and attaches them to tracepoints, hooks the kernel provides for exactly this. And it learns what is already running, reading the node's processes from /proc and its containers from containerd, because an event is little use without knowing whose it is.",
      facts: [
        ["RULES", "falco_rules.yaml · 25 stable rules"],
        ["PROBE", "modern eBPF · no kernel module to build"],
        ["NEEDS", "Linux 5.8+ with BTF on most distributions"],
        ["LISTENS TO", "only the events its rules and state need"],
      ],
      view: "falco",
      focus: ["f.containerd", "f.sys", "f.probe", "f.ring", "f.libs", "f.meta", "f.rules"],
      events: [
        ev({
          id: "fa4", at: 21000, src: RULES, dst: RULES, layer: "control", size: "64 KB", title: "LOAD THE RULES", path: ["f.rules", "f.rules"],
          says: "Falco compiles its rules and works out which kernel events they need.",
          info: "/etc/falco/falco_rules.yaml · 25 rules",
          decoded: [
            sec("RULES FILES, IN ORDER", [["1", "/etc/falco/falco_rules.yaml · the defaults"], ["2", "/etc/falco/falco_rules.local.yaml"], ["3", "/etc/falco/rules.d/ · your own, from a ConfigMap"]]),
            sec("EVENTS NEEDED", [["for the rules", "execve, connect, openat, ptrace…"], ["to keep state", "clone, close, setuid…", true], ["left out", "read, write and others, too frequent to be worth it"]]),
          ],
          note: "The default file holds only rules marked maturity_stable. Others, marked incubating and sandbox, are published separately for you to add.",
        }),
        ev({
          id: "fa5", at: 21040, src: LIBS, dst: KERNEL, layer: "node", size: " - ", title: "ATTACH THE PROBE", path: ["f.probe", "f.sys"],
          says: "It loads its eBPF programs, and the kernel runs them whenever a tracepoint fires.",
          info: "bpf() · attach sys_exit, sched_process_exec, …",
          decoded: [
            sec("ATTACHED TO", [["sys_exit", "a system call returned"], ["sched_process_exec", "a process started a new program", true], ["sched_process_fork · exit", "a process was born or ended"]]),
            sec("SAFETY", [["verifier", "the kernel checks each program before it runs"], ["may do", "read and copy"], ["may not do", "loop forever, touch bad memory"]]),
          ],
          note: "The chart's driver setting is auto: it uses the modern eBPF probe when the kernel supports it, and otherwise falls back to building a kernel module.",
        }),
        ev({
          id: "fa6", at: 21090, src: META, dst: CONTAINERD, layer: "node", size: "6 KB", title: "LIST THE CONTAINERS", path: ["f.meta", "f.containerd"],
          says: "Falco asks containerd for the containers already running and which Pod each belongs to.",
          info: "/run/containerd/containerd.sock · list + subscribe",
          decoded: [
            sec("CACHE ENTRY", [["container.id", CID, true], ["container.name", "web"], ["container.image", "registry.example.com/shop/web:1.4.2"], ["k8s.pod.name", POD], ["k8s.ns.name", "default"]]),
            sec("FROM NOW ON", [["new containers", "reported by containerd when they are created"]]),
          ],
        }),
        ev({
          id: "fa7", at: 21120, src: LIBS, dst: LIBS, layer: "node", size: "180 KB", title: "LEARN THE PROCESSES", path: ["f.libs", "f.libs"],
          says: "It fills a table with every process on the node. Now it's Ready, and watching.",
          info: "/host/proc · 214 processes",
          decoded: [
            sec("PROCESS TABLE", [["PID 48211", "the web app · parent containerd-shim"], ["its cgroup", `…/cri-containerd-${CID.slice(0, 6)}….scope`, true], ["kept current by", "fork, exec and exit events"]]),
          ],
        }),
      ],
    },
    {
      title: "SOMEONE OPENS A SHELL",
      subtitle: "allowed, and still worth knowing",
      body: "Say your kubeconfig was copied, and someone else uses it to run kubectl exec against a web Pod. The API server checks the certificate and RBAC, finds that this user may exec, and passes the connection on to the kubelet. Every gate has done its job and said yes. From here on the API server only carries bytes between a keyboard and a process: the commands typed inside aren't API requests, so no policy sees them.",
      facts: [
        ["COMMAND", `kubectl exec -it ${POD} -- sh`],
        ["AUTHENTICATION", "your certificate · valid"],
        ["RBAC", "create pods/exec · allowed"],
        ["WHAT IS TYPED", "a byte stream to the API server"],
      ],
      view: "cluster",
      focus: ["you", "api", "node2"],
      pods: WATCHED, res: DS,
      events: [
        ev({
          id: "fa8", at: 600000, src: "kubectl", dst: API, layer: "api", size: "0.6 KB", title: "KUBECTL EXEC", path: ["you", "api"],
          says: "A kubectl with your credentials asks for a shell in a web Pod.",
          info: `GET …/pods/${POD}/exec?command=sh&stdin=true&tty=true`,
          decoded: [
            sec("REQUEST", [["Upgrade", "websocket"], ["command", "sh"], ["tty", "true", true], ["user", "kubernetes-admin · from your kubeconfig"]]),
            sec("CHECKED", [["authentication", "client certificate ✓"], ["RBAC", "create pods/exec ✓"], ["admission", "nothing objects"]]),
          ],
          note: "The API server's audit log, when it's turned on, records this request with the user's name. Falco can read that log too, through its k8saudit plugin. The kernel only knows the user inside the container.",
        }),
        ev({
          id: "fa9", at: 600030, src: API, dst: KUBELET, layer: "api", size: "0.5 KB", title: "TO THE KUBELET", path: ["api", "node2"],
          says: "The API server connects the stream to node-2's kubelet, which has the runtime start a shell in the container.",
          info: "POST https://10.0.1.12:10250/exec/default/…/web → CRI Exec",
          decoded: [
            sec("ON THE NODE", [["kubelet → containerd", "Exec · container web · tty=true"], ["containerd-shim → runc", "joins the container's namespaces"], ["then", "execve(\"/bin/sh\")", true]]),
          ],
        }),
      ],
    },
    {
      title: "THE KERNEL TELLS FALCO",
      subtitle: "from execve to a ring buffer",
      body: "To start the shell, a process inside the container calls execve, and the kernel swaps its program for /bin/sh. At that moment the sched_process_exec tracepoint fires and Falco's probe runs, in the kernel, right there. It copies what it needs into a ring buffer shared with Falco: the arguments, the user, the terminal, the cgroup, where the file came from. Then the shell runs. It wasn't held up for a verdict, because Falco doesn't give one.",
      facts: [
        ["TRACEPOINT", "sched_process_exec"],
        ["COPIED", "about 30 fields"],
        ["BUFFERS", "8 MB each · one per 2 CPUs"],
        ["THE SHELL", "already running"],
      ],
      view: "falco",
      focus: ["f.web", "f.sys", "f.probe", "f.ring"],
      events: [
        ev({
          id: "fa10", at: 600090, src: POD, dst: KERNEL, layer: "node", size: " - ", title: "EXECVE", path: ["f.web", "f.sys"],
          says: "Inside the container, a process becomes sh. The kernel does that work, so the kernel knows.",
          info: "execve(\"/bin/sh\", [\"sh\"]) = 0",
          decoded: [
            sec("SYSTEM CALL", [["name", "execve · number 59 on x86-64"], ["file", "/bin/sh → /bin/busybox"], ["result", "0 · the new program is in place", true]]),
          ],
        }),
        ev({
          id: "fa11", at: 600090.01, src: KERNEL, dst: PROBE, layer: "node", size: " - ", title: "THE PROBE RUNS", path: ["f.sys", "f.probe"],
          says: "The tracepoint fires and the kernel runs Falco's probe, which reads the new process.",
          info: "tp_btf/sched_process_exec · pid 51877",
          decoded: [
            sec("READ FROM THE KERNEL", [["command", "sh"], ["parent PID", "48190"], ["uid", "0"], ["tty", "34816 · /dev/pts/0", true], ["cgroup", `…/cri-containerd-${CID.slice(0, 6)}….scope`, true], ["flags", "EXE_WRITABLE | EXE_LOWER_LAYER"]]),
          ],
          note: "EXE_LOWER_LAYER means the file came from the image's read-only layers. The other answer, EXE_UPPER_LAYER, means it was written after the container started. That matters later.",
        }),
        ev({
          id: "fa12", at: 600090.02, src: PROBE, dst: RING, layer: "node", size: "1.1 KB", title: "INTO THE BUFFER", path: ["f.probe", "f.ring"],
          says: "The probe writes one event into a ring buffer and is done.",
          info: "bpf_ringbuf_output · execve event",
          decoded: [
            sec("RING BUFFER", [["size", "8 MB (buf_size_preset 4)"], ["CPUs sharing it", "2 (cpus_for_each_buffer)"], ["if it is full", "the event is dropped and counted", true]]),
          ],
        }),
      ],
    },
    {
      title: "WHICH POD WAS IT?",
      subtitle: "from numbers to names",
      body: "The kernel has never heard of Pods. What Falco reads from the buffer is a process ID, some numbers and a cgroup path. Its libraries decode the event and add it to the process table, which supplies the parent's name. The container ID is cut from the cgroup path, and the container plugin looks that ID up in the list it got from containerd. Now the event has an image, a Pod and a namespace, and can be matched by name.",
      facts: [
        ["KERNEL KNOWS", "PID, uid, tty, cgroup"],
        ["PROCESS TABLE ADDS", "parent · its ancestors"],
        ["CONTAINERD ADDS", "image · Pod · namespace"],
        ["ASKED PER EVENT", "nobody · it's all in memory"],
      ],
      view: "falco",
      focus: ["f.containerd", "f.ring", "f.libs", "f.meta"],
      events: [
        ev({
          id: "fa13", at: 600090.4, src: RING, dst: LIBS, layer: "node", size: "1.1 KB", title: "READ AND DECODE", path: ["f.ring", "f.libs"],
          says: "Falco reads the event and turns its bytes into fields that rules can use.",
          info: "evt.type=execve proc.name=sh proc.pname=containerd-shim",
          decoded: [
            sec("FIELDS", [["evt.type", "execve"], ["proc.name", "sh"], ["proc.exepath", "/bin/busybox"], ["proc.pname", "containerd-shim · from the process table", true], ["proc.tty", "34816"], ["user.name", "root"]]),
          ],
          note: "The parent is a strong hint. A shell the app started would have the app as its parent. This one was started from outside, by the container runtime.",
        }),
        ev({
          id: "fa14", at: 600090.5, src: LIBS, dst: META, layer: "node", size: " - ", title: "NAME THE POD", path: ["f.libs", "f.meta"],
          says: "The container ID from the cgroup path leads to a cached entry: web, in Pod x2kqp.",
          info: `container.id=${CID} → ${POD}`,
          decoded: [
            sec("LOOKED UP", [["container.id", CID], ["container.name", "web"], ["container.image.tag", "1.4.2"], ["k8s.pod.name", POD, true], ["k8s.ns.name", "default", true]]),
          ],
          note: "These names come from the container runtime, not the API server. For more, such as the Deployment or namespace labels, there's an optional k8smeta plugin.",
        }),
      ],
    },
    {
      title: "THE RULE MATCHES",
      subtitle: "a condition, in plain text",
      body: "A rule has a condition, an output message and a priority. The condition is a true-or-false question about the fields. The default rule Terminal shell in container asks six things about the event, and this one passes them all. With the default setting, the first rule that matches wins. Its priority is only Notice, because people run kubectl exec for good reasons every day.",
      facts: [
        ["RULE", SHELL_RULE],
        ["PRIORITY", "Notice"],
        ["RULE_MATCHING", "first · one alert per event"],
        ["TAGS", "mitre_execution · T1059"],
      ],
      view: "falco",
      focus: ["f.libs", "f.rules"],
      events: [
        ev({
          id: "fa15", at: 600090.6, src: LIBS, dst: RULES, layer: "control", size: " - ", title: "SIX QUESTIONS", path: ["f.libs", "f.rules"],
          says: "The event meets the rule's condition, one part at a time. All six parts are true.",
          info: `${SHELL_RULE} · 6 of 6`,
          decoded: [
            sec("CONDITION", [["spawned_process", "evt.type in (execve, execveat) ✓"], ["container", "container.id != host ✓"], ["shell_procs", "sh is in shell_binaries ✓"], ["proc.tty != 0", "a terminal is attached ✓"], ["container_entrypoint", "the parent is containerd-shim ✓"], ["not user_expected_terminal_…", "no exception is set ✓"]]),
          ],
          note: "The words in the condition are macros, named pieces that rules share. spawned_process and container appear in many of the default rules.",
        }),
        ev({
          id: "fa16", at: 600090.7, src: RULES, dst: OUT, layer: "drop", size: "0.9 KB", title: "AN ALERT", path: ["f.rules", "f.out"],
          says: "It's a match. Falco fills in the rule's message and queues the alert.",
          info: `Notice · ${SHELL_RULE}`,
          decoded: [
            sec("ALERT", [["rule", SHELL_RULE], ["priority", "Notice", true], ["output", "A shell was spawned in a container with an attached terminal | user=root process=sh parent=containerd-shim …"]]),
            sec("ADDED TO EVERY ALERT", [["container_name", "web"], ["k8s_pod_name", POD], ["k8s_ns_name", "default"]]),
          ],
        }),
      ],
    },
    {
      title: "THE ALERT LEAVES THE NODE",
      subtitle: "outputs, then a forwarder",
      body: "Falco writes the alert to its standard output, where your log collector picks it up like any Pod's logs. It also posts it as JSON to Falcosidekick, a single place for the alerts of every node. Falcosidekick can send each alert to many destinations, and each has its own minimum priority. Slack is set to Warning here and the alert is a Notice, so nobody is interrupted. It stays in the logs, in case something else happens in that Pod.",
      facts: [
        ["ON BY DEFAULT", "stdout · syslog"],
        ["HTTP OUTPUT", "POST http://falco-falcosidekick:2801"],
        ["SLACK", "minimumpriority: warning"],
        ["THIS ALERT", "Notice · logged, not sent"],
      ],
      view: "falco",
      focus: ["f.rules", "f.out", "f.sidekick", "f.slack"],
      events: [
        ev({
          id: "fa17", at: 600091, src: OUT, dst: OUT, layer: "control", size: "1.0 KB", title: "TO THE LOG", path: ["f.out", "f.out"],
          says: "The alert goes to standard output, so kubectl logs shows it too.",
          info: "kubectl logs -n falco falco-x9k2v",
          decoded: [
            sec("JSON ON STDOUT", [["hostname", "node-2"], ["priority", "Notice"], ["rule", SHELL_RULE], ["source", "syscall"], ["tags", "container, maturity_stable, mitre_execution, shell, T1059"]]),
          ],
        }),
        ev({
          id: "fa18", at: 600093, src: OUT, dst: SIDEKICK, layer: "net", size: "1.4 KB", title: "POST TO FALCOSIDEKICK", path: ["f.out", "f.sidekick"],
          says: "It's also posted to Falcosidekick, which hears from the Falco Pod on every node.",
          info: "POST / HTTP/1.1 · Host falco-falcosidekick:2801",
          decoded: [
            sec("BODY", [["rule", SHELL_RULE], ["output_fields", "proc.name, proc.pname, k8s.pod.name, k8s.ns.name, …", true], ["time", "2026-11-24T18:24:07.114Z"]]),
          ],
          note: "Traffic between Pods like any other: a Service name, a ClusterIP, a POST. A NetworkPolicy that blocks it would silence the alerts but not the detection.",
        }),
        ev({
          id: "fa19", at: 600094, src: SIDEKICK, dst: SIDEKICK, layer: "control", size: " - ", title: "BELOW THE BAR", path: ["f.sidekick", "f.sidekick"],
          says: "Slack wants Warning and above. This is a Notice, so it goes no further.",
          info: "slack: notice < warning · skipped",
          decoded: [
            sec("ROUTING", [["slack.minimumpriority", "warning"], ["alert", "notice · skipped", true], ["order", "debug < informational < notice < warning < error < critical < alert < emergency"]]),
          ],
        }),
      ],
    },
    {
      title: "A FILE THAT WASN'T IN THE IMAGE",
      subtitle: "what the shell was for",
      body: "Two minutes later the person in the shell downloads a program into /tmp and runs it. Nothing in the container stops them: it has a writable file system and a way out to the internet. But a container's image is fixed. A program that isn't in it has to be written first, and that puts it in the container's one writable layer. The kernel can see which layer a file comes from, the probe passes that on, and a rule is waiting for it.",
      facts: [
        ["TYPED", "wget -O /tmp/x … · chmod +x /tmp/x · /tmp/x"],
        ["IMAGE LAYERS", "lower · read-only"],
        ["/TMP/X", "upper layer · written after the start"],
        ["PRIORITY", "Critical"],
      ],
      view: "falco",
      focus: ["f.web", "f.sys", "f.probe", "f.ring", "f.libs", "f.rules"],
      events: [
        ev({
          id: "fa20", at: 720000, src: POD, dst: KERNEL, layer: "node", size: " - ", title: "RUN /TMP/X", path: ["f.web", "f.sys"],
          says: "The downloaded program starts. Same system call, same tracepoint.",
          info: "execve(\"/tmp/x\", [\"/tmp/x\"]) = 0",
          decoded: [
            sec("EXEC", [["parent", "sh · the shell from before"], ["tty", "34816"], ["file", "/tmp/x · written 4 s ago", true]]),
          ],
          note: "With readOnlyRootFilesystem: true the download would have failed, and there would be nothing to detect. Prevention first, detection for what gets through.",
        }),
        ev({
          id: "fa21", at: 720000.03, src: PROBE, dst: LIBS, layer: "node", size: "1.1 KB", title: "FROM THE UPPER LAYER", path: ["f.probe", "f.libs"],
          says: "The probe sees that the file lives in the container's writable layer.",
          info: "flags=EXE_WRITABLE|EXE_UPPER_LAYER",
          decoded: [
            sec("OVERLAYFS", [["sh, earlier", "EXE_LOWER_LAYER · from the image"], ["/tmp/x", "EXE_UPPER_LAYER · not from the image", true], ["becomes", "proc.is_exe_upper_layer=true"]]),
          ],
        }),
        ev({
          id: "fa22", at: 720000.5, src: LIBS, dst: RULES, layer: "drop", size: " - ", title: "CRITICAL MATCH", path: ["f.libs", "f.rules"],
          says: "It's not a shell, so the first rule stays quiet. Another one matches, and it's Critical.",
          info: `Critical · ${DROP_RULE}`,
          decoded: [
            sec("CONDITION", [["spawned_process", "✓"], ["container", "✓"], ["proc.is_exe_upper_layer=true", "✓", true], ["not a known image or activity", "✓ the exception lists are empty"]]),
            sec("ALERT", [["priority", "Critical", true], ["output", "Executing binary not part of base image | process=x proc_exepath=/tmp/x parent=sh …"], ["tags", "mitre_persistence · PCI_DSS_11.5.1"]]),
          ],
          note: "The rule needs overlayfs. A program run from an emptyDir or another mounted volume isn't in the container's upper layer, so this rule doesn't see it. Mounting those volumes noexec, or a rule of your own, covers the gap.",
        }),
      ],
    },
    {
      title: "ONE ALERT, TWO READERS",
      subtitle: "a person and a program",
      body: "This alert takes the same road, and this time it's above every bar. Falcosidekick posts it to Slack, where the person on call sees the Pod, the command and the parent shell. It also posts it to Talon, a response engine, which has a rule of its own: for this alert, terminate the Pod. Falco is still only the one who noticed. Whether anything is done, and what, is decided here.",
      facts: [
        ["SLACK", "critical ≥ warning · sent"],
        ["TALON RULE", "this alert → kubernetes:terminate"],
        ["NEEDS", "k8s.ns.name · k8s.pod.name"],
        ["EXEC TO SLACK", "≈ 0.25 s in this run"],
      ],
      view: "falco",
      focus: ["f.out", "f.sidekick", "f.slack", "f.talon"],
      events: [
        ev({
          id: "fa23", at: 720003, src: OUT, dst: SIDEKICK, layer: "net", size: "1.6 KB", title: "POST TO FALCOSIDEKICK", path: ["f.out", "f.sidekick"],
          says: "The Critical alert leaves the node the same way as the first.",
          info: `POST / · rule=${DROP_RULE}`,
          decoded: [
            sec("BODY", [["priority", "Critical", true], ["output_fields.proc.exepath", "/tmp/x"], ["output_fields.proc.pname", "sh"], ["output_fields.k8s.pod.name", POD], ["output_fields.k8s.ns.name", "default"]]),
          ],
        }),
        ev({
          id: "fa24", at: 720006, src: SIDEKICK, dst: TALON, layer: "net", size: "1.6 KB", title: "POST TO TALON", path: ["f.sidekick", "f.talon"],
          says: "Talon gets a copy and finds an action for it: terminate the Pod.",
          info: "POST http://falco-talon:2803/",
          decoded: [
            sec("TALON RULE", [["match.rules", DROP_RULE, true], ["action", "Terminate Pod"], ["actionner", "kubernetes:terminate"], ["grace_period_seconds", "5"], ["min_healthy_replicas", "33%"]]),
          ],
          note: "An automatic kill also destroys the evidence, and a false match costs you a Pod. Gentler actions exist: kubernetes:label to mark the Pod, kubernetes:networkpolicy to cut it off, kubernetes:log to save its logs first.",
        }),
        ev({
          id: "fa25", at: 720240, src: SIDEKICK, dst: SLACK, layer: "net", size: "2.3 KB", title: "POST TO SLACK", path: ["f.sidekick", "f.slack"],
          says: "And a message appears in Slack, with everything needed to start looking.",
          info: "POST https://hooks.slack.com/services/…",
          decoded: [
            sec("MESSAGE", [["rule", DROP_RULE], ["priority", "Critical", true], ["command", "/tmp/x · parent sh"], ["pod", `default/${POD}`], ["hostname", "node-2"]]),
          ],
        }),
      ],
    },
    {
      title: "THE POD IS REPLACED",
      subtitle: "a response made of ordinary parts",
      body: "Talon has no special powers. It is a Pod with a ServiceAccount whose ClusterRole lets it delete Pods, so it asks the API server like anyone else. The kubelet stops the containers, and the shell and the downloaded program go with them. The ReplicaSet counts two Pods instead of three and makes a fresh one from the clean image. The stolen kubeconfig still works, though. That part is for the person reading Slack.",
      facts: [
        ["REQUEST", `DELETE pods/${POD} · grace 5 s`],
        ["ALLOWED BY", "RBAC · Talon's ClusterRole"],
        ["REPLACEMENT", "web-…-t6n9c · clean image"],
        ["STILL TO DO", "revoke access · look for more"],
      ],
      view: "cluster",
      focus: ["api", "kcm", "node1", "node2"],
      pods: WATCHED, res: DS,
      events: [
        ev({
          id: "fa26", at: 720300, src: TALON, dst: API, layer: "api", size: "0.4 KB", title: "DELETE THE POD", path: ["node1", "api"],
          says: "Talon asks the API server to delete the Pod, as its own ServiceAccount.",
          info: `DELETE …/pods/${POD}  gracePeriodSeconds=5`,
          decoded: [
            sec("REQUEST", [["user", "system:serviceaccount:falco:falco-talon"], ["RBAC", "delete pods ✓ · its ClusterRole", true], ["gracePeriodSeconds", "5"]]),
          ],
        }),
        ev({
          id: "fa27", at: 720340, src: API, dst: KUBELET, layer: "drop", size: "3.8 KB", title: "STOP THE CONTAINERS", path: ["api", "node2"],
          says: "node-2's kubelet stops the Pod. Every process in it ends, the attacker's included.",
          info: "WATCH MODIFIED Pod · deletionTimestamp set",
          pods: { node1: WATCHED.node1, node2: ["other", "terminating", "v1", "other"] },
          decoded: [
            sec("KUBELET", [["SIGTERM", "to the web app"], ["after at most 5 s", "SIGKILL to whatever is left"], ["sh and /tmp/x", "killed with the container", true], ["writable layer", "deleted · /tmp/x is gone"]]),
          ],
          note: "Terminating the Pod doesn't undo what the program did in the seconds it ran, such as reading the Pod's token and sending it somewhere.",
        }),
        ev({
          id: "fa28", at: 720400, src: "kube-controller-manager", dst: API, layer: "control", size: "2.1 KB", title: "BACK TO THREE", path: ["kcm", "api"],
          says: "The ReplicaSet controller sees one Pod too few and creates a new one.",
          info: "POST …/pods  web-…-t6n9c",
          pods: { node1: WATCHED.node1, node2: ["other", "starting", "v1", "other"] },
          decoded: [
            sec("REPLICASET WEB", [["want", "3"], ["have", "2 · x2kqp is terminating", true], ["create", "web-…-t6n9c · scheduled to node-2"]]),
          ],
        }),
        ev({
          id: "fa29", at: 724000, src: KUBELET, dst: API, layer: "api", size: "1.2 KB", title: "READY AGAIN", path: ["node2", "api"],
          says: "The new Pod is Ready, and Falco is already watching it.",
          info: "PATCH …/pods/web-…-t6n9c/status  Ready=True",
          pods: WATCHED,
          decoded: [
            sec("REPLACED", [["endpoint", "10.244.2.24:8080, in the slice"], ["image", "web:1.4.2, the same · if the way in was the app, it's still there", true]]),
          ],
        }),
      ],
    },
    {
      title: "NOISE AND BLIND SPOTS",
      subtitle: "keeping alerts worth reading",
      body: "Rules that cry wolf get ignored, so tuning is part of running Falco. You don't edit the default file. You add your own that overrides a named piece of it, here to accept shells in a namespace meant for debugging. And know what Falco can miss. If a node is so busy that the ring buffers fill up, events are dropped, and Falco raises an alert about that too. It also sees only what its rules ask about, and never what happens outside its nodes.",
      facts: [
        ["TUNE WITH", "macros · lists · exceptions"],
        ["YOUR FILE", "/etc/falco/rules.d/ · chart: customRules"],
        ["DROPS", "over 10 % in a second → an alert"],
        ["OTHER SOURCES", "plugins · k8saudit and more"],
      ],
      view: "falco",
      focus: ["f.probe", "f.ring", "f.libs", "f.rules", "f.out"],
      events: [
        ev({
          id: "fa30", at: 3600000, src: RULES, dst: RULES, layer: "control", size: "0.3 KB", title: "ADD AN EXCEPTION", path: ["f.rules", "f.rules"],
          says: "You fill in a macro the rule left empty for you: shells in the debug namespace are expected.",
          info: "helm upgrade … customRules → rules.d/shells.yaml",
          decoded: [
            sec("SHELLS.YAML", [["macro", "user_expected_terminal_shell_in_container_conditions"], ["condition", "(k8s.ns.name = \"debug\")", true], ["override", "condition: replace"]]),
            sec("EFFECT", [["debug namespace", "no alert"], ["everywhere else", "unchanged"], ["applied", "the DaemonSet rolls its Pods, node by node"]]),
          ],
          note: "Keep exceptions narrow. Excluding a whole image or a program by name gives an attacker a place to hide.",
        }),
        ev({
          id: "fa31", at: 3700000, src: PROBE, dst: RING, layer: "drop", size: " - ", title: "THE BUFFER IS FULL", path: ["f.probe", "f.ring"],
          says: "On a very busy node, the probe finds no room. It counts the event as lost and moves on.",
          info: "n_drops_buffer += 1",
          decoded: [
            sec("CHOICE", [["wait for room", "never · that would slow every program on the node"], ["drop and count", "yes", true]]),
            sec("IF IT KEEPS HAPPENING", [["bigger buffers", "buf_size_preset"], ["fewer events", "a smaller rule set · base_syscalls"], ["more CPU", "the chart's limit is 1 CPU"]]),
          ],
        }),
        ev({
          id: "fa32", at: 3701000, src: RULES, dst: OUT, layer: "drop", size: "0.5 KB", title: "AN ALERT ABOUT ALERTS", path: ["f.rules", "f.out"],
          says: "More than a tenth of the last second's events were lost, so Falco says so.",
          info: "Debug · Falco internal: syscall event drop",
          decoded: [
            sec("ALERT", [["rule", "Falco internal: syscall event drop", true], ["priority", "Debug"], ["threshold", "0.1 · 10 % of events"], ["at most", "one every 30 s"]]),
          ],
          note: "It's only a Debug alert, so a Falcosidekick output with a minimum priority won't send it. Watch the drop counters in Falco's metrics instead.",
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "install → watching", layer: "api", start: 0, duration: 21120 },
    { value: "t2", label: "shell → Notice, in the log", layer: "node", start: 600000, duration: 94 },
    { value: "t3", label: "new program → Critical", layer: "drop", start: 720000, duration: 3 },
    { value: "t4", label: "alert → Talon and Slack", layer: "net", start: 720003, duration: 237 },
    { value: "t5", label: "Pod deleted → replaced", layer: "control", start: 720300, duration: 3700 },
  ],
  timingNote: "Times from one run. How fast an alert arrives depends on the node's load and the network.",
  summary: {
    title: "SEEN FROM BELOW",
    body: "Containers share their node's kernel, so one probe in the kernel sees them all, whatever is or isn't installed inside them. Falco turns those events into fields, adds the Pod's name, and asks its rules. A match is an alert, and that is all Falco does. Falcosidekick decides who hears about it, and something else, a person or Talon, decides what to do. The shell was allowed by every check the API server has. It was noticed because starting a program always goes through the kernel.",
    facts: [
      ["THE PATH", "tracepoint → probe → ring buffer → rules → alert"],
      ["PREVENTS", "RBAC · admission · seccomp · read-only root"],
      ["DETECTS", "Falco"],
      ["WRAP-UP", "every lesson, done"],
    ],
  },
}
