import type { Lesson } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const KUBELET = "kubelet · node-2"
const CONTAINERD = "containerd · node-2"
const NP = "CSI node plugin"
const POD = "web-…-t9c3k"
const PV = "pvc-3f8a91c2…"

export const mountingVolume: Lesson = {
  id: "mounting-volume",
  title: "Mounting a volume",
  subtitle: "CSI attach and mount",
  category: "node",
  seo: {
    title: "How Kubernetes mounts a volume with CSI",
    description: "From a PersistentVolumeClaim to a directory inside the container: how a Kubernetes CSI driver provisions, attaches, stages and publishes a volume.",
  },
  actors: ["you", "cp", "node1", "node2", "uploads-pvc", "uploads-pv"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    [KUBELET]: "node-2", [CONTAINERD]: "node-2",
    provisioner: "CSI driver", attacher: "CSI driver", [NP]: "CSI driver",
  },
  overview: {
    body: "From a PersistentVolumeClaim to a directory inside the container, through the CSI driver. The web app gets an uploads volume: 10 Gi on fast-nvme. The chain has five links - claim, provision, attach, stage, publish - and the container doesn't start until the last one clicks into place.",
    facts: [
      ["CLAIM", "uploads · 10Gi · ReadWriteOnce"],
      ["CLASS", "fast-nvme · WaitForFirstConsumer"],
      ["VOLUME", `${PV} · 10 Gi`],
      ["IN THE CONTAINER", "/uploads · ext4"],
    ],
  },
  steps: [
    {
      title: "THE CLAIM",
      subtitle: "ask, and wait for a Pod",
      body: "You apply a PersistentVolumeClaim: 10 Gi, ReadWriteOnce, class fast-nvme. No disk exists yet, and none will for now: the class says WaitForFirstConsumer, so the claim stays Pending until a Pod that uses it is scheduled. A disk made now might land in a zone where the Pod can't run.",
      facts: [
        ["PVC", "uploads · Pending"],
        ["BIND MODE", "WaitForFirstConsumer"],
        ["WAITING FOR", "a Pod that mounts it"],
      ],
      view: "cluster",
      focus: ["you", "cp", "uploads-pvc"],
      events: [
        ev({
          id: "mv1", at: 0, src: "kubectl", dst: API, layer: "api", size: "0.4 KB", title: "APPLY THE CLAIM", path: ["you", "cp"],
          says: "kubectl posts the claim: 10 Gi on fast-nvme.",
          info: "POST …/persistentvolumeclaims  uploads",
          res: { "uploads-pvc": { kind: "pvc", name: "PVC uploads", sub: "10Gi · fast-nvme · Pending", state: "creating" } },
          decoded: [sec("BODY · PVC", [["metadata.name", "uploads"], ["spec.accessModes", "[ReadWriteOnce]"], ["spec.storageClassName", "fast-nvme"], ["spec.resources.requests.storage", "10Gi"]])],
        }),
        ev({
          id: "mv2", at: 400, src: "pv controller", dst: API, layer: "state", size: "0.3 KB", title: "PENDING, ON PURPOSE", path: ["cp", "uploads-pvc"],
          says: "The claim stays Pending: the class waits for the first Pod that uses it.",
          info: "event WaitForFirstConsumer · waiting for first consumer to be created before binding",
          res: { "uploads-pvc": { kind: "pvc", name: "PVC uploads", sub: "10Gi · Pending · waiting for a Pod" } },
          decoded: [sec("PV CONTROLLER", [["claim", "uploads · Pending"], ["class", "fast-nvme · volumeBindingMode WaitForFirstConsumer", true], ["why wait", "the disk must be made where the Pod will run"]])],
          note: "With volumeBindingMode Immediate the disk would be made right now, in whatever zone the driver chose, and the Pod would have to follow it there.",
        }),
      ],
    },
    {
      title: "THE POD DECIDES",
      subtitle: "schedule first, then provision",
      body: `Now a Pod that mounts the claim. The scheduler weighs the Pod's requests and the zones fast-nvme can serve, picks node-2 in zone b, and writes that choice onto the claim. The driver's provisioner sidecar - an ordinary Pod watching the API - sees it, asks the backend for a 10 Gi volume in zone b, and writes back a PersistentVolume. The claim turns Bound. Only then does the scheduler bind the Pod to node-2.`,
      facts: [
        ["POD", `${POD} · Pending until the volume exists`],
        ["PICKED", "node-2 (topology zone b)"],
        ["PROVISIONED BY", "csi-provisioner sidecar → backend"],
        ["PV", `${PV} · 10 Gi · Bound`],
      ],
      view: "cluster",
      focus: ["cp", "uploads-pvc", "uploads-pv", "node1", "node2"],
      pods: { node2: ["other", "v1", "v1", "starting"] },
      events: [
        ev({
          id: "mv3", at: 2000, src: "kube-scheduler", dst: API, layer: "control", size: "0.4 KB", title: "SCHEDULE WITH A VOLUME", path: ["cp", "uploads-pvc"],
          says: "The scheduler plans around the volume's topology, picks node-2, and tells the claim.",
          info: "PATCH …/persistentvolumeclaims/uploads  selected-node=node-2",
          res: { "uploads-pvc": { kind: "pvc", name: "PVC uploads", sub: "Pending · node-2 chosen" } },
          decoded: [sec("VOLUME-AWARE SCHEDULING", [["Pod spec", "volume uploads → PVC uploads"], ["topology", "fast-nvme serves zones a, b"], ["filter", "both nodes fit"], ["pick", "node-2", true], ["annotation", "volume.kubernetes.io/selected-node: node-2", true]])],
        }),
        ev({
          id: "mv4", at: 2400, src: "provisioner", dst: API, layer: "state", size: "0.5 KB", title: "VOLUME CARVED OUT", path: ["uploads-pvc", "uploads-pv"],
          says: "The driver's provisioner sees where the Pod will run, creates a volume there, and offers a PV.",
          info: `POST …/persistentvolumes  ${PV}`,
          res: {
            "uploads-pv": { kind: "pv", name: "PV pvc-3f8a91c2…", sub: "10 Gi · zone b", state: "creating" },
            "uploads-pvc": { kind: "pvc", name: "PVC uploads", sub: "10Gi · Bound" },
          },
          decoded: [sec("DYNAMIC PROVISIONING", [["watched", "PVC uploads · selected-node node-2"], ["CreateVolume", "10 Gi · zone b · nvme pool 2"], ["PV", `${PV} · Bound to uploads`, true]])],
          note: "No human creates PVs in a dynamic cluster. The sidecar's whole job is this loop: see claim, call backend, write PV.",
        }),
        ev({
          id: "mv4b", at: 2500, src: API, dst: KUBELET, layer: "control", size: "2.4 KB", title: "KUBELET WANTS THE VOLUME", path: ["cp", "node2"],
          says: "The Pod is bound to node-2. Its kubelet immediately needs the volume - which is not attached to this node yet.",
          info: `WATCH MODIFIED Pod ${POD} (nodeName node-2)`,
          decoded: [sec("KUBELET VOLUME MANAGER", [["desired state", "PVC uploads mounted at /uploads"], ["actual", "not attached to node-2"], ["container start", "held · Pod shows ContainerCreating", true]])],
        }),
      ],
    },
    {
      title: "ATTACH",
      subtitle: "the node gets a disk",
      body: `The driver's controller half - a Deployment talking to the storage backend - runs ControllerPublishVolume: map ${PV} to node-2. On the node this appears as a new device, /dev/nvme2n1. Attaching is cluster work; it happens once per volume per node, no matter how many Pods there mount it.`,
      facts: [
        ["CALL", "ControllerPublishVolume"],
        ["RESULT", "/dev/nvme2n1 on node-2"],
        ["DEVICE", "empty · never formatted"],
      ],
      view: "cluster",
      focus: ["cp", "uploads-pv", "node2"],
      events: [
        ev({
          id: "mv5", at: 2600, src: "attacher", dst: API, layer: "state", size: "0.4 KB", title: "PUBLISH TO THE NODE", path: ["uploads-pv", "node2"],
          says: "The driver attaches the volume to node-2 over the storage network.",
          info: `VolumeAttachment ${PV} → node-2`,
          res: { "uploads-pv": { kind: "pv", name: "PV pvc-3f8a91c2…", sub: "attached → /dev/nvme2n1" } },
          decoded: [sec("CSI · CONTROLLER", [["method", "ControllerPublishVolume"], ["backend", "nvme map · volume 81288"], ["on node-2", "/dev/nvme2n1", true], ["took", "≈ 1.5 s"]])],
        }),
        ev({
          id: "mv6", at: 4100, src: "attacher", dst: KUBELET, layer: "node", size: "0.1 KB", title: "ATTACHED", path: ["node2", "node2"],
          says: "The disk is visible on node-2; the kubelet can proceed to mounting.",
          info: "VolumeAttachment status.attached=true",
          decoded: [sec("ATTACH DONE", [["device", "/dev/nvme2n1", true], ["kubelet unblocked", "stage next"], ["note", "one attach per volume per node"]])],
        }),
      ],
    },
    {
      title: "STAGE AND PUBLISH",
      subtitle: "format once, mount per Pod",
      body: `Now the node half of the driver - a DaemonSet Pod on node-2. NodeStageVolume does the once-per-volume work: mkfs.ext4 on first use, then a mount at a global path. NodePublishVolume does the per-Pod work: a bind mount of the staged filesystem into the Pod's own directory under /var/lib/kubelet. Splitting them means a second Pod on this node mounts in milliseconds, no second format.`,
      facts: [
        ["STAGE", "mkfs.ext4 + globalmount · once"],
        ["PUBLISH", "bind mount into the Pod dir · per Pod"],
        ["FS", "ext4 · created at 4.9 s"],
      ],
      view: "node2",
      focus: ["n2.kubelet", "n2.containerd"],
      events: [
        ev({
          id: "mv7", at: 4200, src: KUBELET, dst: NP, layer: "node", size: " - ", title: "STAGE THE VOLUME", path: ["n2.kubelet", "n2.kubelet"],
          says: "The node plugin formats the empty disk and stages one filesystem for the whole node.",
          info: `NodeStageVolume ${PV} · mkfs.ext4 /dev/nvme2n1`,
          decoded: [sec("CSI · NODE SIDE", [["format", "mkfs.ext4 (first use only)", true], ["global mount", `/var/lib/kubelet/plugins/…/${PV}/globalmount`], ["second Pod here", "skips all of this"]])],
        }),
        ev({
          id: "mv8", at: 5000, src: KUBELET, dst: NP, layer: "node", size: "0.1 KB", title: "PUBLISH INTO THE POD", path: ["n2.kubelet", "n2.podA"],
          says: "A bind mount of the staged filesystem appears in the Pod's volume directory.",
          info: "NodePublishVolume → …/pods/5b77…/volumes/…",
          decoded: [sec("CSI · NODE SIDE", [["method", "NodePublishVolume"], ["target", `/var/lib/kubelet/pods/5b77f3…/volumes/kubernetes.io~csi/${PV}/mount`, true], ["kind", "bind mount of globalmount"]])],
        }),
      ],
    },
    {
      title: "INTO THE CONTAINER",
      subtitle: "one mount in a namespace",
      body: `The kubelet hands the mount to containerd with the Pod spec. runc, setting up the container's mount namespace, bind-mounts the Pod directory at /uploads inside the new rootfs. The app opens /uploads/logo.png and writes - and the bytes travel the storage network to the nvme pool, though the app only ever saw a local directory.`,
      facts: [
        ["CONTAINER PATH", "/uploads (r/w)"],
        ["APP WRITES", "/uploads/logo.png · 240 KB"],
        ["BYTES LAND", "nvme pool 2 · volume 81288"],
      ],
      view: "node2",
      focus: ["n2.kubelet", "n2.containerd", "n2.podA"],
      pods: { node2: ["other", "v1", "v1", "v2"] },
      events: [
        ev({
          id: "mv9", at: 5100, src: KUBELET, dst: CONTAINERD, layer: "node", size: "1.1 KB", title: "CREATE WITH THE MOUNT", path: ["n2.kubelet", "n2.containerd"],
          says: "The container is created with the volume in its mount list.",
          info: `CreateContainer web · mounts[/uploads]`,
          decoded: [sec("MOUNTS", [["source", `…/pods/5b77f3…/volumes/…/${PV}/mount`], ["destination", "/uploads", true], ["propagation", "rprivate (mountPropagation None)"], ["done by", "runc, in the container's mount namespace"]])],
        }),
        ev({
          id: "mv10", at: 5900, src: POD, dst: NP, layer: "node", size: "240 KB", title: "FIRST WRITE", path: ["n2.podA", "n2.kubelet"],
          says: "The app saves a file, and the bytes leave for the storage backend.",
          info: "write /uploads/logo.png · 240 KB",
          decoded: [sec("WHERE IT WENT", [["app's view", "local disk at /uploads"], ["actual path", "bind → globalmount → /dev/nvme2n1 → network"], ["survives", "Pod deletion, node failure, rescheduling", true]])],
          note: "An emptyDir skips the whole chain: it's a directory on the node, made by the kubelet, and it dies with the Pod. The five-link chain exists so the bytes can outlive it.",
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "claim waits for a Pod", layer: "state", start: 0, duration: 2000 },
    { value: "t2", label: "schedule → provision → bind", layer: "control", start: 2000, duration: 600 },
    { value: "t3", label: "attach to node-2", layer: "state", start: 2600, duration: 1500 },
    { value: "t4", label: "format + stage + publish", layer: "node", start: 4200, duration: 900 },
    { value: "t5", label: "container start + first write", layer: "node", start: 5100, duration: 900 },
  ],
  summary: {
    title: "FIVE LINKS",
    body: "Claim, provision, attach, stage, publish - then one more mount into the container's namespace. Each link is a different controller talking to a different thing: the API server, the storage backend, the node's kernel. The Pod sat in Pending and then ContainerCreating through all of it, because a container with a promised volume starts only when the volume is real.",
    facts: [
      ["CHAIN", "PVC → PV → attach → stage → publish → mount"],
      ["SLOWEST", "attach 1.5 s · format 0.8 s"],
      ["NEXT", "List and watch"],
    ],
  },
}
