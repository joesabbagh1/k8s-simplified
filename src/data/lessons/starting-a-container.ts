import type { Lesson } from "../types"
import { ev, sec } from "./helpers"

const POD = "web-…-x2kqp"
const API = "kube-apiserver"
const KUBELET = "kubelet · node-2"
const CONTAINERD = "containerd · node-2"
const RUNTIME = "runc"
const SNAP = "snapshotter"
const SCOPE = "kubepods-burstable-pod5a91f2….slice/cri-containerd-9c2f7a….scope"

export const startingAContainer: Lesson = {
  id: "starting-a-container",
  title: "Starting a container",
  subtitle: "Namespaces and cgroups",
  category: "node",
  actors: ["cp", "node2"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    [KUBELET]: "kubelet", [CONTAINERD]: "containerd", [SNAP]: "containerd",
    [RUNTIME]: "runc", [POD]: "Pod x2kqp",
  },
  overview: {
    body: "What a container really is: a process with its own namespaces, limited by cgroups. Replay the start of one web container on node-2, zoomed into the operating system: a directory of layers glued together, a set of clone() flags, and two files in a cgroup. No virtual machine anywhere.",
    facts: [
      ["CONTAINER", "web · registry.example.com/shop/web:1.4.2"],
      ["RUNTIME", "containerd → runc (OCI)"],
      ["ISOLATION", "namespaces + cgroups v2 · one shared kernel"],
      ["START TO RUNNING", "≈ 90 ms (image already on disk)"],
    ],
  },
  steps: [
    {
      title: "THE BUNDLE",
      subtitle: "a spec and a pile of layers",
      body: `Zoom into node-2. The kubelet has already pulled the image and started the sandbox; now it asks containerd to create the app container. containerd resolves the image to its OCI config and hands the snapshotter a list of layer digests. The result is an OCI bundle: a rootfs directory and a config.json that describes exactly the process to run.`,
      facts: [
        ["REQUEST", "CreateContainer (CRI gRPC)"],
        ["IMAGE", "sha256:41d0c8… · 5 layers"],
        ["BUNDLE", "rootfs/ + config.json"],
      ],
      view: "node2",
      focus: ["n2.kubelet", "n2.containerd"],
      events: [
        ev({
          id: "cx1", at: 0, src: KUBELET, dst: CONTAINERD, layer: "node", size: "1.0 KB", title: "CREATE CONTAINER", path: ["n2.kubelet", "n2.containerd"],
          says: "The kubelet asks containerd to create the web container inside the sandbox.",
          info: "CreateContainer web · image 1.4.2 · sandbox c4d1e8…",
          decoded: [sec("gRPC · runtime.v1.RuntimeService", [["method", "CreateContainer"], ["sandbox", "c4d1e8… (the pause Pod's netns)"], ["image", "…/web:1.4.2 → sha256:41d0c8…"], ["limits", "cpu 500m · memory 256Mi (→ cgroups later)"]])],
        }),
        ev({
          id: "cx2", at: 4, src: CONTAINERD, dst: SNAP, layer: "node", size: " - ", title: "PREPARE THE SNAPSHOT", path: ["n2.containerd", "n2.containerd"],
          says: "containerd's snapshotter glues the image's five layers into one directory tree.",
          info: "Prepare key=c9b2… parent=← layer 5 of 5",
          decoded: [sec("SNAPSHOTTER", [["layers", "5, all on disk from the pull"], ["stack", "sha256:9a41… → … → sha256:0b7c…", true], ["output", "one merged directory (see next step)"]])],
          note: "Every image layer is immutable and shared. Two containers from one image get five shared read-only layers and one private writable layer each.",
        }),
      ],
    },
    {
      title: "THE ROOTFS",
      subtitle: "overlayfs, one ordinary /",
      body: "The merged directory is an overlayfs mount: the five image layers stacked as read-only lower directories, one empty writable upper directory beside it. The app never sees any of that. It sees an ordinary filesystem: /app/server exists, /etc/hostname exists, and writes to /tmp land in the upper layer without touching the image.",
      facts: [
        ["LOWER", "5 read-only layers (the image)"],
        ["UPPER", "1 writable layer (this container)"],
        ["APP SEES", "one ordinary /"],
      ],
      view: "node2",
      focus: ["n2.containerd"],
      events: [
        ev({
          id: "cx3", at: 9, src: SNAP, dst: SNAP, layer: "node", size: " - ", title: "MOUNT OVERLAYFS", path: ["n2.containerd", "n2.containerd"],
          says: "The layers are mounted as one tree, with one small writable layer on top.",
          info: "mount -t overlay overlay …",
          decoded: [sec("MOUNT OPTIONS", [["lowerdir", "…/l/4FT2K9:…/l/7XB1QD:… (5, read-only)"], ["upperdir", "…/snapshots/212/fs (writable)", true], ["workdir", "…/snapshots/212/work"], ["app sees", "/ · ordinary filesystem"]])],
          note: "A deleted-in-the-image file becomes a whiteout character device in the upper layer; overlayfs hides the original below it. That's the whole trick.",
        }),
      ],
    },
    {
      title: "NAMESPACES",
      subtitle: "clone() with new eyes",
      body: `containerd hands the bundle to runc, its OCI runtime. runc doesn't build a machine: it calls clone() once with a handful of flags, and the new process wakes up unable to see the host's PID tree or mount table. Three namespaces are deliberately not new: network, IPC and UTS belong to the sandbox's pause container, and runc joins them with setns(). That's why every container in the Pod shares one eth0, one localhost and one hostname.`,
      facts: [
        ["NEW", "PID · mount · cgroup namespaces"],
        ["JOINED", "network · IPC · UTS - the sandbox's"],
        ["HOSTNAME", "web-…-x2kqp, from the sandbox's UTS"],
      ],
      view: "node2",
      focus: ["n2.containerd", "n2.podA"],
      events: [
        ev({
          id: "cx4", at: 21, src: CONTAINERD, dst: RUNTIME, layer: "node", size: "0.3 KB", title: "RUNC CREATE", path: ["n2.containerd", "n2.podA"],
          says: "containerd calls runc, which will make the process itself.",
          info: "runc create --bundle /run/containerd/…/c9b2…",
          decoded: [sec("OCI RUNTIME", [["bundle", "rootfs/ + config.json"], ["config.json", "from the image's OCI config + the Pod spec"], ["next", "clone() with namespace flags"]])],
        }),
        ev({
          id: "cx5", at: 27, src: RUNTIME, dst: RUNTIME, layer: "node", size: " - ", title: "CLONE()", path: ["n2.podA", "n2.podA"],
          says: "One system call gives the process its own PID tree and mounts; it joins the Pod's network, IPC and hostname.",
          info: "clone(CLONE_NEWPID|CLONE_NEWNS|CLONE_NEWCGROUP) + setns(net, ipc, uts)",
          decoded: [sec("FLAGS", [["CLONE_NEWPID", "own process numbers - the app will be PID 1", true], ["CLONE_NEWNS", "own mount table - pivot_root next"], ["CLONE_NEWCGROUP", "own view of /sys/fs/cgroup"], ["setns(net)", "pause's netns - eth0, localhost", true], ["setns(ipc, uts)", "shared memory and hostname, Pod-wide"]])],
          note: "Joining instead of creating is the design decision that makes a Pod a Pod: containers share the network and so reach each other on localhost:8080.",
        }),
        ev({
          id: "cx6", at: 31, src: RUNTIME, dst: RUNTIME, layer: "node", size: " - ", title: "PIVOT_ROOT", path: ["n2.podA", "n2.podA"],
          says: "The new mount table's root swings over to the overlayfs, and the host's filesystem disappears from view.",
          info: "pivot_root(\"/\") → unmount old root",
          decoded: [sec("MOUNT NAMESPACE", [["before", "root = node's filesystem"], ["after", "root = the overlayfs bundle", true], ["visible", "/app, /etc, /dev (curated by runc)"]])],
        }),
      ],
    },
    {
      title: "CGROUPS",
      subtitle: "two files with numbers in them",
      body: `While it sets up the namespaces, runc also creates the container's cgroup and writes the limits from config.json as plain files. memory.max is the container's memory limit as a byte count; cpu.max is its CPU limit as a quota per period; the CPU request becomes cpu.weight, a relative share. Nothing watches these files. The kernel's scheduler and memory manager read them on every allocation decision, forever - that's the entire enforcement mechanism.`,
      facts: [
        ["CGROUP", SCOPE],
        ["MEMORY.MAX", "268435456 (256 Mi)"],
        ["CPU.MAX", "50000 100000 (500m)"],
      ],
      view: "node2",
      focus: ["n2.containerd"],
      events: [
        ev({
          id: "cx7", at: 34, src: RUNTIME, dst: "kernel", layer: "node", size: " - ", title: "WRITE THE LIMITS", path: ["n2.containerd", "n2.containerd"],
          says: "The limits from the Pod spec become two files in a cgroup directory.",
          info: `/sys/fs/cgroup/${SCOPE}`,
          decoded: [sec("CGROUP V2 FILES", [["memory.max", "268435456  ← limits.memory 256Mi", true], ["cpu.max", "50000 100000  ← limits.cpu 500m", true], ["cpu.weight", "20  ← requests.cpu 500m (relative share)"], ["who enforces", "the kernel, on every charge"]])],
          note: "Kubernetes wrote numbers; the kernel does the enforcing. OOMKilled happens when this cgroup crosses memory.max - a later lesson walks it.",
        }),
      ],
    },
    {
      title: "PID 1",
      subtitle: "an ordinary process, doubled",
      body: `Now runc execs the app. Inside the PID namespace it is PID 1 - the first process, the one that gets signals first. On the host it is PID 8412, an unremarkable /app/server process that ps can see. Both are true at once: same process, two numbering systems. It shares the sandbox's network namespace, so eth0 with 10.244.2.17 is already configured and waiting.`,
      facts: [
        ["CONTAINER PID", "1 (its own namespace)"],
        ["HOST PID", "8412 (the node's namespace)"],
        ["LISTENS ON", "0.0.0.0:8080 · eth0 10.244.2.17"],
      ],
      view: "pod",
      focus: ["p.pause", "p.app", "p.eth0"],
      events: [
        ev({
          id: "cx8", at: 40, src: RUNTIME, dst: POD, layer: "node", size: "0.1 KB", title: "EXEC THE APP", path: ["p.pause", "p.app"],
          says: "The app starts: PID 1 inside, ordinary process 8412 on the host.",
          info: "execve(/app/server --port 8080)",
          decoded: [sec("PROCESS", [["argv", "/app/server --port 8080"], ["pid (container)", "1", true], ["pid (host)", "8412"], ["user", "10001 (runAsNonRoot)"], ["netns", "shared with pause - eth0 ready"]])],
        }),
        ev({
          id: "cx9", at: 80, src: POD, dst: "eth0 · Pod", layer: "net", size: "0.2 KB", title: "BIND :8080", path: ["p.app", "p.eth0"],
          says: "The app binds its port on the shared eth0. Forty milliseconds after exec, it is serving.",
          info: "listen(0.0.0.0:8080) · backlog 128",
          decoded: [sec("SOCKET", [["bind", "0.0.0.0:8080"], ["interface", "eth0 · 10.244.2.17 (from CNI, in the sandbox step)"], ["localhost", "shared with any sidecar in this Pod"]])],
          note: "pause owns the namespace but uses no network. It just sleeps - holding eth0 alive so the app's IP survives an app-container restart.",
        }),
      ],
    },
    {
      title: "NOT A VM",
      subtitle: "what isolation isn't",
      body: "Every container on this node runs on the same kernel. Namespaces hide views; cgroups ration resources; and two more mechanisms trim what the process may ask the kernel to do: capabilities (no CAP_SYS_ADMIN, no CAP_NET_ADMIN here) and seccomp (the RuntimeDefault profile blocks a few dozen of Linux's 300-plus syscalls; this Pod asks for it in its securityContext, since Kubernetes otherwise runs containers unconfined). Exit means gone - when PID 1 exits, the container is over and the kernel reaps everything.",
      facts: [
        ["SHARED", "one kernel · one scheduler"],
        ["CAPABILITIES", "dropped: SYS_ADMIN, NET_ADMIN, …"],
        ["SECCOMP", "RuntimeDefault · a few dozen syscalls blocked"],
        ["EXIT", "PID 1 exits → container over"],
      ],
      view: "node2",
      focus: ["n2.kubelet", "n2.containerd", "n2.podA"],
      events: [
        ev({
          id: "cx10", at: 95, src: RUNTIME, dst: POD, layer: "node", size: " - ", title: "WHAT IT WAS LEFT WITH", path: ["n2.containerd", "n2.podA"],
          says: "Just before execve, runc had dropped capabilities and loaded the syscall filter. This is what the app was left with.",
          info: "cap_drop: ALL · cap_add: NET_BIND_SERVICE · seccomp RuntimeDefault",
          decoded: [sec("SECURITY CONTEXT", [["capabilities", "SYS_ADMIN ✗ · NET_ADMIN ✗ · NET_BIND_SERVICE ✓", true], ["seccomp", "RuntimeDefault profile (allow-list)"], ["noNewPrivs", "true"]])],
        }),
        ev({
          id: "cx11", at: 120, src: KUBELET, dst: API, layer: "api", size: "1.8 KB", title: "RUNNING", path: ["n2.kubelet", "n2.api"],
          says: "The kubelet reports the container Running. Ready comes later, after the probe.",
          info: `PATCH …/pods/${POD}/status  web state=Running`,
          decoded: [sec("STATUS PATCH", [["containerStatuses[web].state", "running (startedAt 10:24:07)", true], ["ready", "false - probe hasn't passed"], ["restartCount", "0"]])],
          note: "A container that starts fast, like this one, still waits for its readiness probe before taking traffic. The two flags are deliberately separate.",
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "CreateContainer → bundle", layer: "node", start: 0, duration: 9 },
    { value: "t2", label: "overlayfs mounted", layer: "node", start: 9, duration: 12 },
    { value: "t3", label: "runc: clone + pivot_root", layer: "node", start: 21, duration: 13 },
    { value: "t4", label: "cgroup limits written", layer: "node", start: 34, duration: 6 },
    { value: "t5", label: "exec → listening :8080", layer: "node", start: 40, duration: 50 },
    { value: "t6", label: "status → API", layer: "api", start: 95, duration: 25 },
  ],
  summary: {
    title: "JUST A PROCESS",
    body: "A container is three cheap tricks stacked: an overlayfs so a pile of shared layers looks like /, one clone() call with the right flags so the process can't see the host, and two cgroup files so the kernel rations it. The image pull was the slow part (an earlier lesson); becoming a process took 90 ms.",
    facts: [
      ["WHAT RAN", "clone() + pivot_root + execve - no VM"],
      ["COST", "≈ 90 ms, image already on disk"],
      ["NEXT", "Pulling an image"],
    ],
  },
}
