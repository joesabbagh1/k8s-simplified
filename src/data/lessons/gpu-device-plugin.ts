import type { Lesson, PodLayout, Resource } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const SCHED = "kube-scheduler"
const KCM = "kube-controller-manager"
const OPERATOR = "gpu-operator"
const NFD = "nfd-worker · node-2"
const DRIVER = "nvidia-driver-daemonset"
const TOOLKIT = "nvidia-container-toolkit-daemonset"
const KUBELET = "kubelet · node-2"
const PLUGIN = "nvidia-device-plugin"
const CONTAINERD = "containerd · node-2"
const CDI = "CDI spec"
const GPU = "NVIDIA L4"
const POD = "llm"

const UUID = "GPU-5f3c2a9e-…-7d41"
const CDI_NAME = `k8s.device-plugin.nvidia.com/gpu=${UUID}`
const SOCKET = "nvidia-gpu-4c1e9a07.sock"

const card = (sub: string, state?: Resource["state"]): Resource => ({ kind: "daemonset", name: "nvidia-device-plugin", sub, state, nodes: ["node2"] })

/** web runs two Pods on node-1 and one on node-2; the GPU Operator's Pods are the grey slot added on node-2 */
const BEFORE: PodLayout = { node1: ["other", "v1", "v1"], node2: ["other", "v1"] }
const OPERATOR_UP: PodLayout = { node2: ["other", "v1", "other"] }

export const gpuDevicePlugin: Lesson = {
  id: "gpu-device-plugin",
  title: "A Pod asks for a GPU",
  subtitle: "Device plugins and extended resources",
  category: "node",
  seo: {
    title: "How a Kubernetes Pod gets a GPU",
    description: "How a Kubernetes Pod gets an NVIDIA GPU: the device plugin registers with the kubelet, advertises nvidia.com/gpu, and CDI puts the card in the container.",
  },
  actors: ["you", "cp", "node1", "node2", "gpu-plugin-ds"],
  opens: { node2: "gpu" },
  pods: BEFORE,
  res: {},
  lanes: {
    helm: "you", kubectl: "you",
    [API]: "control plane", [SCHED]: "control plane", [KCM]: "control plane",
    [OPERATOR]: "GPU Operator", [NFD]: "GPU Operator", [DRIVER]: "GPU Operator", [TOOLKIT]: "GPU Operator",
    [KUBELET]: "kubelet",
    [PLUGIN]: "device plugin",
    [CONTAINERD]: "containerd", [CDI]: "containerd",
    [POD]: "llm Pod",
    [GPU]: "GPU", "NVIDIA driver": "GPU",
  },
  overview: {
    body: "Kubernetes knows nothing about GPUs. It counts CPU and memory itself, and for anything else it relies on a device plugin: a program on the node that tells the kubelet which devices exist and how to hand one to a container. node-2 has one NVIDIA L4. Follow it from the driver, through the device plugin and the scheduler, to nvidia-smi running inside a Pod that asked for nvidia.com/gpu: 1.",
    facts: [
      ["GPU", "NVIDIA L4 · 24 GB · on node-2"],
      ["RESOURCE", "nvidia.com/gpu · whole GPUs only"],
      ["INSTALLED BY", "NVIDIA GPU Operator v26.7"],
      ["KUBERNETES", "v1.37 · device plugin API v1beta1"],
    ],
  },
  steps: [
    {
      title: "THE GPU OPERATOR",
      subtitle: "a stack of DaemonSets, on the right node",
      body: "Several things must be on node-2 before a Pod can use its GPU: the NVIDIA kernel driver, a container runtime that can add the GPU to a container, and the device plugin. NVIDIA's GPU Operator installs all of them as DaemonSets. Its first job is to find the GPU nodes. Node Feature Discovery reads each node's PCI devices and labels node-2, because it has a card from vendor 10de, which is NVIDIA. The operator's DaemonSets select that label, so node-1 gets none of their Pods.",
      facts: [
        ["INSTALL", "helm install gpu-operator -n gpu-operator"],
        ["FINDS GPUS BY", "PCI vendor 10de · a node label"],
        ["ON NODE-2", "driver · toolkit · device plugin · GFD · DCGM exporter"],
        ["ON NODE-1", "nothing · it has no GPU"],
      ],
      view: "cluster",
      focus: ["you", "api", "kcm", "node2", "gpu-plugin-ds"],
      events: [
        ev({
          id: "gp1", at: 0, src: "helm", dst: API, layer: "api", size: "96 KB", title: "INSTALL THE GPU OPERATOR", path: ["you", "api"],
          says: "You install the GPU Operator with its Helm chart.",
          info: "helm install --wait gpu-operator -n gpu-operator --create-namespace nvidia/gpu-operator --version=v26.7.3",
          decoded: [
            sec("CREATED BY THE CHART", [["Deployment", "gpu-operator · the operator itself", true], ["DaemonSet", "node-feature-discovery worker · one per node"], ["ClusterPolicy", "cluster-policy · which parts to install, and how"]]),
            sec("CLUSTER-POLICY DEFAULTS", [["driver.enabled", "true · install the driver in a container"], ["toolkit.enabled", "true"], ["devicePlugin.enabled", "true"], ["cdi.enabled", "true · the default since v25.10.0"]]),
          ],
        }),
        ev({
          id: "gp2", at: 6000, src: NFD, dst: API, layer: "api", size: "1.8 KB", title: "LABEL THE GPU NODE", path: ["node2", "api"],
          says: "Node Feature Discovery on node-2 finds an NVIDIA card on the PCI bus and labels the node.",
          info: "PATCH /api/v1/nodes/node-2  labels feature.node.kubernetes.io/pci-10de.present=true",
          decoded: [
            sec("NODE-2 LABELS", [["feature.node.kubernetes.io/pci-10de.present", "true", true], ["10de", "NVIDIA's PCI vendor ID"]]),
            sec("NODE-1", [["NVIDIA devices", "none · no label"]]),
          ],
        }),
        ev({
          id: "gp3", at: 9000, src: OPERATOR, dst: API, layer: "api", size: "24 KB", title: "DAEMONSETS FOR GPU NODES", path: ["api", "api"],
          says: "The operator labels node-2 as a GPU node and creates one DaemonSet for each part, all selecting that label.",
          info: "POST …/namespaces/gpu-operator/daemonsets × 6",
          res: { "gpu-plugin-ds": card("DaemonSet · 0/1 ready", "creating") },
          decoded: [
            sec("NODE-2 LABEL", [["nvidia.com/gpu.present", "true", true]]),
            sec("DAEMONSETS", [["nvidia-driver-daemonset", "loads the kernel driver"], ["nvidia-container-toolkit-daemonset", "sets containerd up for the GPU"], ["nvidia-device-plugin-daemonset", "reports the GPU to the kubelet", true], ["gpu-feature-discovery", "labels the model, memory, driver"], ["nvidia-dcgm-exporter", "GPU metrics for Prometheus"], ["nvidia-operator-validator", "checks each part works"]]),
            sec("NODE SELECTOR", [["matches", "node-2 only"]]),
          ],
        }),
        ev({
          id: "gp4", at: 9400, src: KCM, dst: API, layer: "control", size: "4.1 KB", title: "PODS FOR NODE-2", path: ["kcm", "api"],
          says: "The DaemonSet controller creates one Pod of each for node-2, and none for node-1.",
          info: "POST …/pods  nvidia-device-plugin-daemonset-8zk2q · nodeName node-2",
          pods: { node2: ["other", "v1", "starting"] },
          decoded: [sec("DAEMONSET CONTROLLER", [["desired", "1 · nodes matching the selector"], ["node-2", "a Pod of each DaemonSet", true], ["node-1", "none"], ["placed by", "node affinity on the node's name"]])],
        }),
        ev({
          id: "gp5", at: 9800, src: API, dst: KUBELET, layer: "control", size: "4.1 KB", title: "THE KUBELET SEES THEM", path: ["api", "node2"],
          says: "node-2's kubelet sees the new Pods on its watch and starts them. The driver goes first.",
          info: "WATCH ADDED Pod nvidia-driver-daemonset-r7d4m · nodeName=node-2",
          decoded: [sec("ORDER ON NODE-2", [["first", "driver", true], ["then", "container toolkit"], ["then", "device plugin, GFD, DCGM exporter"], ["how", "each Pod's init container waits for the one before"]])],
        }),
      ],
    },
    {
      title: "THE DRIVER COMES FIRST",
      subtitle: "kernel modules and device files",
      body: "Look inside node-2. The driver Pod loads NVIDIA's kernel modules, and Linux creates device files for the card: /dev/nvidia0 for the GPU itself, /dev/nvidiactl and /dev/nvidia-uvm for the driver. Every program that uses the GPU goes through these files, inside a container or not. Then the toolkit Pod sets up containerd. With CDI, the Container Device Interface, containerd learns to read files that say exactly what a container needs to use a device.",
      facts: [
        ["DRIVER", "580.95.05 · modules nvidia, nvidia-uvm, nvidia-modeset"],
        ["DEVICE FILES", "/dev/nvidia0 · /dev/nvidiactl · /dev/nvidia-uvm"],
        ["CDI SPECS IN", "/etc/cdi · /var/run/cdi"],
        ["ALREADY INSTALLED?", "driver.enabled=false skips this part"],
      ],
      view: "gpu",
      focus: ["gp.containerd", "gp.cdi", "gp.driver", "gp.gpu"],
      events: [
        ev({
          id: "gp6", at: 95000, src: DRIVER, dst: GPU, layer: "node", size: " - ", title: "LOAD THE DRIVER", path: ["gp.driver", "gp.gpu"],
          says: "The driver Pod loads NVIDIA's kernel modules, and the card shows up as /dev/nvidia0.",
          info: "modprobe nvidia · nvidia-uvm · nvidia-modeset",
          decoded: [
            sec("KERNEL MODULES", [["nvidia", "the driver for the card", true], ["nvidia-uvm", "unified memory, which CUDA needs"], ["nvidia-modeset", "display, unused here"]]),
            sec("DEVICE FILES", [["/dev/nvidia0", "the first GPU", true], ["/dev/nvidiactl", "the driver's control file"], ["/dev/nvidia-uvm", "unified memory"]]),
            sec("ALSO INSTALLED ON THE HOST", [["libraries", "libcuda.so · libnvidia-ml.so"], ["tools", "nvidia-smi"]]),
          ],
          note: "The driver container builds the modules for node-2's kernel or uses precompiled ones, which takes a few minutes. Nodes whose image already has the driver, as most managed GPU nodes do, set driver.enabled=false.",
        }),
        ev({
          id: "gp7", at: 120000, src: TOOLKIT, dst: CONTAINERD, layer: "node", size: "2.2 KB", title: "SET UP CONTAINERD FOR CDI", path: ["gp.containerd", "gp.containerd"],
          says: "The toolkit Pod configures containerd and restarts it. containerd now reads CDI specs.",
          info: "/etc/containerd/config.toml · restart containerd",
          decoded: [
            sec("CONTAINERD", [["CDI", "on", true], ["cdi_spec_dirs", "/etc/cdi · /var/run/cdi"], ["RuntimeClass nvidia", "still created, no longer the default"]]),
            sec("WITHOUT CDI", [["before v25.10", "the nvidia runtime wrapped runc and read NVIDIA_VISIBLE_DEVICES"]]),
          ],
          note: "Restarting containerd doesn't stop running containers: each one is held by its own shim process, not by containerd.",
        }),
      ],
    },
    {
      title: "REGISTER",
      subtitle: "the plugin calls the kubelet",
      body: "The device plugin starts. It asks the driver, through the NVML library, which GPUs this node has: one L4. It writes a CDI spec for it under /var/run/cdi. Then it starts a gRPC server on a socket of its own in /var/lib/kubelet/device-plugins/, and calls the kubelet's Registration service on kubelet.sock in the same directory. The request names the API version, the plugin's socket and the resource it serves: nvidia.com/gpu.",
      facts: [
        ["KUBELET SOCKET", "/var/lib/kubelet/device-plugins/kubelet.sock"],
        ["PLUGIN SOCKET", SOCKET],
        ["RESOURCE", "nvidia.com/gpu"],
        ["API", "deviceplugin v1beta1 · gRPC"],
      ],
      view: "gpu",
      focus: ["gp.kubelet", "gp.plugin", "gp.cdi", "gp.driver"],
      pods: OPERATOR_UP,
      res: { "gpu-plugin-ds": card("DaemonSet · 0/1 ready") },
      events: [
        ev({
          id: "gp8", at: 150000, src: PLUGIN, dst: "NVIDIA driver", layer: "node", size: " - ", title: "FIND THE GPUS", path: ["gp.plugin", "gp.driver"],
          says: "The plugin asks the driver which GPUs node-2 has.",
          info: "nvmlInit · nvmlDeviceGetCount → 1",
          decoded: [sec("GPU 0", [["name", "NVIDIA L4"], ["uuid", UUID, true], ["memory", "24 GB"], ["MIG", "not supported on L4"]])],
        }),
        ev({
          id: "gp9", at: 150200, src: PLUGIN, dst: CDI, layer: "node", size: "3.4 KB", title: "WRITE THE CDI SPEC", path: ["gp.plugin", "gp.cdi"],
          says: "It writes a CDI spec: what a container needs to use this GPU, under one name.",
          info: "/var/run/cdi/k8s.device-plugin.nvidia.com-gpu.json",
          decoded: [
            sec("SPEC", [["kind", "k8s.device-plugin.nvidia.com/gpu"], ["device name", UUID, true]]),
            sec("CONTAINER EDITS", [["deviceNodes", "/dev/nvidia0 · /dev/nvidiactl · /dev/nvidia-uvm"], ["mounts", "libcuda.so · libnvidia-ml.so · nvidia-smi, from the host"], ["hooks", "refresh the container's library cache"]]),
          ],
        }),
        ev({
          id: "gp10", at: 150400, src: PLUGIN, dst: KUBELET, layer: "control", size: "0.1 KB", title: "REGISTER", path: ["gp.plugin", "gp.kubelet"],
          says: "It calls the kubelet's Registration service: here is my socket, I serve nvidia.com/gpu.",
          info: "Registration/Register on kubelet.sock",
          decoded: [
            sec("REGISTERREQUEST", [["version", "v1beta1"], ["endpoint", SOCKET, true], ["resource_name", "nvidia.com/gpu", true]]),
            sec("OPTIONS", [["get_preferred_allocation_available", "true"], ["pre_start_required", "false"]]),
          ],
          note: "The plugin must be serving on its socket before it registers, because the kubelet calls it back straight away. If the kubelet restarts, it deletes the sockets in this directory; the plugin sees its own disappear and registers again.",
        }),
        ev({
          id: "gp11", at: 150410, src: KUBELET, dst: PLUGIN, layer: "control", size: " - ", title: "THE KUBELET CALLS BACK", path: ["gp.kubelet", "gp.plugin"],
          says: "The kubelet's device manager connects to the plugin's socket.",
          info: `dial unix /var/lib/kubelet/device-plugins/${SOCKET}`,
          decoded: [sec("DEVICEPLUGIN SERVICE", [["GetDevicePluginOptions", "what the plugin supports"], ["ListAndWatch", "the devices, as a stream", true], ["GetPreferredAllocation", "which devices it would rather give"], ["Allocate", "how to give them to a container"], ["PreStartContainer", "a hook before each start, if asked for"]])],
        }),
      ],
    },
    {
      title: "ADVERTISE",
      subtitle: "a new resource on the Node",
      body: "The kubelet opens ListAndWatch, a stream that stays open. The plugin sends its device list: one GPU, Healthy. The kubelet now knows node-2 has one nvidia.com/gpu and writes that into the Node's status, beside CPU and memory. This is all the scheduler will ever know about the card: a resource name and a whole number. Extended resources like this one can't be split or overcommitted, and a Pod asks for them under limits.",
      facts: [
        ["CAPACITY", "nvidia.com/gpu: 1"],
        ["ALLOCATABLE", "nvidia.com/gpu: 1"],
        ["UNITS", "whole numbers · no 0.5 GPU"],
        ["IN A POD", "limits · requests default to the same"],
      ],
      view: "gpu",
      focus: ["gp.api", "gp.kubelet", "gp.plugin"],
      events: [
        ev({
          id: "gp12", at: 150420, src: KUBELET, dst: PLUGIN, layer: "control", size: " - ", title: "LISTANDWATCH", path: ["gp.kubelet", "gp.plugin"],
          says: "The kubelet opens a stream that the plugin keeps open for as long as it runs.",
          info: "DevicePlugin/ListAndWatch · server stream",
          decoded: [sec("STREAM", [["opened by", "the kubelet"], ["plugin sends", "the full list, then again on every change", true]])],
        }),
        ev({
          id: "gp13", at: 150430, src: PLUGIN, dst: KUBELET, layer: "control", size: "0.1 KB", title: "ONE GPU, HEALTHY", path: ["gp.plugin", "gp.kubelet"],
          says: "The first message on the stream: one device, Healthy.",
          info: `ListAndWatchResponse devices=[${UUID} Healthy]`,
          decoded: [sec("DEVICE", [["ID", UUID, true], ["health", "Healthy"], ["topology", "NUMA node 0"]])],
        }),
        ev({
          id: "gp14", at: 151000, src: KUBELET, dst: API, layer: "api", size: "1.2 KB", title: "THE NODE GAINS A RESOURCE", path: ["gp.kubelet", "gp.api"],
          says: "The kubelet adds nvidia.com/gpu to node-2's capacity and allocatable.",
          info: "PATCH /api/v1/nodes/node-2/status",
          res: { "gpu-plugin-ds": card("DaemonSet · 1/1 ready", "active") },
          decoded: [
            sec("NODE-2 STATUS", [["capacity.nvidia.com/gpu", "1", true], ["allocatable.nvidia.com/gpu", "1", true]]),
            sec("EXTENDED RESOURCE RULES", [["amount", "a whole number"], ["overcommit", "never"], ["limits only", "the request is set to the limit"], ["both given", "they must be equal"]]),
          ],
          note: "gpu-feature-discovery adds labels with the details the count leaves out, such as nvidia.com/gpu.product=NVIDIA-L4, so a Pod can pick a model with a node selector.",
        }),
      ],
    },
    {
      title: "TAINT AND SCHEDULE",
      subtitle: "keep others off, let the GPU Pod on",
      body: "A GPU node is expensive, so you keep ordinary Pods off it with a taint. NoSchedule only stops new Pods: the web Pod already on node-2 stays. Then you create llm, which asks for one GPU and tolerates the taint. The scheduler's NodeResourcesFit filter compares nvidia.com/gpu like any other resource: node-1 has none, so it's out. node-2 has one free and its taint is tolerated. The scheduler binds llm to node-2.",
      facts: [
        ["TAINT", "nvidia.com/gpu=present:NoSchedule"],
        ["POD", "llm · limits nvidia.com/gpu: 1"],
        ["NODE-1", "Insufficient nvidia.com/gpu"],
        ["BOUND TO", "node-2"],
      ],
      view: "cluster",
      focus: ["you", "api", "sched", "node1", "node2"],
      pods: OPERATOR_UP,
      events: [
        ev({
          id: "gp15", at: 200000, src: "kubectl", dst: API, layer: "api", size: "0.3 KB", title: "TAINT NODE-2", path: ["you", "api"],
          says: "You taint node-2 so only Pods that tolerate it are placed there.",
          info: "kubectl taint nodes node-2 nvidia.com/gpu=present:NoSchedule",
          decoded: [
            sec("NODE-2 SPEC", [["taints[0].key", "nvidia.com/gpu", true], ["taints[0].value", "present"], ["taints[0].effect", "NoSchedule"]]),
            sec("PODS ALREADY THERE", [["web-…-x2kqp", "stays · NoSchedule doesn't evict"], ["the GPU Operator's Pods", "tolerate nvidia.com/gpu"]]),
          ],
          note: "GKE adds this exact taint to GPU node pools in clusters that also have other pools, and its ExtendedResourceToleration admission plugin adds the toleration to every Pod that asks for nvidia.com/gpu.",
        }),
        ev({
          id: "gp16", at: 230000, src: "kubectl", dst: API, layer: "api", size: "0.8 KB", title: "CREATE POD LLM", path: ["you", "api"],
          says: "You create llm: one GPU, under limits, and a toleration for the taint.",
          info: "POST /api/v1/namespaces/default/pods  llm",
          decoded: [
            sec("CONTAINER", [["image", "registry.example.com/ml/llm:1.0 · built on CUDA 13.0"], ["command", "nvidia-smi && sleep infinity"]]),
            sec("RESOURCES", [["limits.nvidia.com/gpu", "1", true], ["requests.nvidia.com/gpu", "1 · copied from the limit"], ["requests.cpu · memory", "2 · 8Gi"]]),
            sec("TOLERATIONS", [["key", "nvidia.com/gpu"], ["operator", "Exists"], ["effect", "NoSchedule"]]),
          ],
        }),
        ev({
          id: "gp17", at: 230050, src: SCHED, dst: SCHED, layer: "control", size: " - ", title: "FILTER", path: ["sched", "sched"],
          says: "node-1 has no GPU and is filtered out. node-2 has one free and its taint is tolerated.",
          info: "NodeResourcesFit · TaintToleration",
          decoded: [
            sec("NODE-1", [["allocatable nvidia.com/gpu", "0"], ["NodeResourcesFit", "✗ Insufficient nvidia.com/gpu", true]]),
            sec("NODE-2", [["allocatable nvidia.com/gpu", "1 · 0 in use"], ["NodeResourcesFit", "✓"], ["TaintToleration", "✓ nvidia.com/gpu tolerated"]]),
          ],
          note: "Without the toleration, llm would stay Pending with: 0/2 nodes are available: 1 Insufficient nvidia.com/gpu, 1 node(s) had untolerated taint {nvidia.com/gpu: present}.",
        }),
        ev({
          id: "gp18", at: 230060, src: SCHED, dst: API, layer: "api", size: "0.3 KB", title: "BIND TO NODE-2", path: ["sched", "api"],
          says: "The scheduler binds llm to node-2.",
          info: "POST …/pods/llm/binding  target node-2",
          pods: { node2: ["other", "v1", "other", "starting"] },
          decoded: [sec("BINDING", [["target.name", "node-2", true], ["which GPU", "not chosen here · the kubelet picks"]])],
        }),
      ],
    },
    {
      title: "ALLOCATE",
      subtitle: "the kubelet picks the device",
      body: "The scheduler only counted. Which GPU llm gets is decided on node-2. Before it starts the Pod's containers, the kubelet's device manager picks a free, healthy device. It asks the plugin which devices it would prefer, then calls Allocate with the chosen ID. The plugin answers with how to give that GPU to a container: here, a CDI device name. The kubelet records the assignment in a checkpoint file, so after a restart it still knows the GPU is taken.",
      facts: [
        ["CHOSEN", UUID],
        ["REPLY", "a CDI device name"],
        ["CHECKPOINT", "/var/lib/kubelet/device-plugins/kubelet_internal_checkpoint"],
        ["ALLOCATABLE LEFT", "0 free on node-2"],
      ],
      view: "gpu",
      focus: ["gp.api", "gp.kubelet", "gp.plugin"],
      events: [
        ev({
          id: "gp19", at: 230100, src: API, dst: KUBELET, layer: "control", size: "3.0 KB", title: "A POD FOR NODE-2", path: ["gp.api", "gp.kubelet"],
          says: "The kubelet sees llm bound to node-2.",
          info: "WATCH MODIFIED Pod llm · nodeName=node-2",
          decoded: [sec("ADMIT", [["nvidia.com/gpu", "1 asked · 1 free", true], ["CPU · memory", "fit"]])],
        }),
        ev({
          id: "gp20", at: 230110, src: KUBELET, dst: PLUGIN, layer: "control", size: " - ", title: "GETPREFERREDALLOCATION", path: ["gp.kubelet", "gp.plugin"],
          says: "With several free GPUs, the plugin's preference keeps a Pod's GPUs close together. Here there is one.",
          info: `available=[${UUID}] size=1`,
          decoded: [sec("PREFERENCE", [["available", "1 device"], ["preferred", UUID, true], ["matters when", "a Pod asks for several GPUs on a node with many"]])],
        }),
        ev({
          id: "gp21", at: 230120, src: KUBELET, dst: PLUGIN, layer: "control", size: " - ", title: "ALLOCATE", path: ["gp.kubelet", "gp.plugin"],
          says: "The kubelet tells the plugin which GPU it chose for llm's container.",
          info: `DevicePlugin/Allocate devices_ids=[${UUID}]`,
          decoded: [sec("CONTAINERALLOCATEREQUEST", [["devices_ids", UUID, true]])],
        }),
        ev({
          id: "gp22", at: 230130, src: PLUGIN, dst: KUBELET, layer: "control", size: "0.2 KB", title: "HOW TO HAND IT OVER", path: ["gp.plugin", "gp.kubelet"],
          says: "The plugin replies with a CDI device name for that GPU.",
          info: `cdi_devices=[${CDI_NAME}]`,
          decoded: [
            sec("CONTAINERALLOCATERESPONSE", [["cdi_devices", CDI_NAME, true], ["envs · mounts · devices", "empty"]]),
            sec("OTHER STRATEGIES", [["envvar", "NVIDIA_VISIBLE_DEVICES=GPU-…, read by the nvidia runtime"], ["volume-mounts", "the IDs as mount paths"], ["CDI names in this API", "GA since Kubernetes v1.31"]]),
          ],
        }),
        ev({
          id: "gp23", at: 230140, src: KUBELET, dst: KUBELET, layer: "state", size: "0.4 KB", title: "CHECKPOINT", path: ["gp.kubelet", "gp.kubelet"],
          says: "The kubelet writes down which Pod holds the GPU, so a restart doesn't hand it out twice.",
          info: "/var/lib/kubelet/device-plugins/kubelet_internal_checkpoint",
          decoded: [sec("ENTRY", [["pod", "llm"], ["container", "llm"], ["resource", "nvidia.com/gpu"], ["device", UUID, true]])],
        }),
      ],
    },
    {
      title: "INTO THE CONTAINER",
      subtitle: "CDI adds the device and the libraries",
      body: "After the sandbox and the image pull, the kubelet calls containerd's CreateContainer and passes the CDI device name with it. containerd looks the name up in /var/run/cdi and applies what the spec lists: the device files go into the container, the device cgroup allows them, and the driver's libraries from the host are mounted in. The image carries CUDA but no driver. nvidia-smi starts, reaches the card through /dev/nvidia0 and prints the L4.",
      facts: [
        ["CRI FIELD", "ContainerConfig.CDIDevices"],
        ["ADDED", "/dev/nvidia0 · /dev/nvidiactl · /dev/nvidia-uvm"],
        ["MOUNTED", "libcuda.so · libnvidia-ml.so · nvidia-smi"],
        ["SEES", "NVIDIA L4 · driver 580.95.05 · CUDA 13.0"],
      ],
      view: "gpu",
      focus: ["gp.kubelet", "gp.containerd", "gp.cdi", "gp.llm", "gp.gpu"],
      events: [
        ev({
          id: "gp24", at: 236000, src: KUBELET, dst: CONTAINERD, layer: "node", size: "6 KB", title: "CREATECONTAINER", path: ["gp.kubelet", "gp.containerd"],
          says: "The kubelet asks containerd for the container, with the CDI device name in the request.",
          info: `RuntimeService/CreateContainer  CDIDevices=[${CDI_NAME}]`,
          decoded: [
            sec("CONTAINERCONFIG", [["image", "registry.example.com/ml/llm:1.0"], ["CDIDevices[0].name", CDI_NAME, true]]),
            sec("ALREADY DONE", [["sandbox · network · image pull", "as in the earlier lessons"]]),
          ],
        }),
        ev({
          id: "gp25", at: 236010, src: CONTAINERD, dst: CDI, layer: "node", size: "3.4 KB", title: "RESOLVE THE CDI NAME", path: ["gp.containerd", "gp.cdi"],
          says: "containerd finds the name in the spec and edits the container's OCI spec to match.",
          info: "/var/run/cdi/k8s.device-plugin.nvidia.com-gpu.json",
          decoded: [sec("OCI SPEC EDITS", [["linux.devices", "/dev/nvidia0 · /dev/nvidiactl · /dev/nvidia-uvm", true], ["device cgroup", "allow those device numbers"], ["mounts", "the host's libcuda.so, libnvidia-ml.so, nvidia-smi"], ["hooks", "update the library cache"]])],
          note: "The device cgroup is why the edits matter: a container can't open a device file the cgroup doesn't allow, even if the file is there.",
        }),
        ev({
          id: "gp26", at: 236300, src: CONTAINERD, dst: POD, layer: "node", size: " - ", title: "START", path: ["gp.containerd", "gp.llm"],
          says: "runc starts the container with the GPU's device files and the driver's libraries inside.",
          info: "runc create · start  llm",
          pods: { node2: ["other", "v1", "other", "v2"] },
          decoded: [sec("INSIDE THE CONTAINER", [["/dev", "nvidia0 · nvidiactl · nvidia-uvm", true], ["/dev/nvidia1…", "absent · not allocated"], ["libcuda.so", "the host's, matching the kernel driver"]])],
        }),
        ev({
          id: "gp27", at: 237000, src: POD, dst: GPU, layer: "node", size: " - ", title: "THE CONTAINER SEES THE L4", path: ["gp.llm", "gp.gpu"],
          says: "nvidia-smi opens /dev/nvidiactl and /dev/nvidia0, and the driver answers for the card.",
          info: "NVIDIA L4 · Driver Version: 580.95.05 · CUDA Version: 13.0",
          decoded: [sec("OUTPUT", [["GPU 0", "NVIDIA L4", true], ["driver", "580.95.05"], ["CUDA version", "13.0 · the newest this driver supports"], ["processes", "none yet"]])],
          note: "An image built for a newer CUDA than the driver supports starts fine and then fails at its first CUDA call, with cudaErrorInsufficientDriver. The driver on the node sets the ceiling, not the image.",
        }),
        ev({
          id: "gp28", at: 237500, src: KUBELET, dst: API, layer: "api", size: "1.3 KB", title: "RUNNING", path: ["gp.kubelet", "gp.api"],
          says: "The kubelet reports llm Running.",
          info: "PATCH /api/v1/namespaces/default/pods/llm/status  phase=Running",
          decoded: [sec("STATUS", [["phase", "Running", true], ["node-2 nvidia.com/gpu", "1 allocatable · 1 in use"]])],
        }),
      ],
    },
    {
      title: "ONE GPU, ONE POD",
      subtitle: "and the ways to share it",
      body: "A device plugin hands out whole devices. While llm holds the L4, a second Pod asking for nvidia.com/gpu: 1 stays Pending, even if llm uses a sliver of it. There are three ways to share. Time-slicing makes the plugin advertise one GPU as several, with no memory isolation between the Pods. MIG cuts an A100, H100 or newer GPU into slices with their own memory, but not an L4. And Dynamic Resource Allocation, GA since Kubernetes v1.34, replaces the count with claims a driver can match against each device's attributes.",
      facts: [
        ["SECOND POD", "Pending · 2 Insufficient nvidia.com/gpu"],
        ["TIME-SLICING", "replicas: 4 → nvidia.com/gpu: 4 · shared memory"],
        ["MIG", "A100, A30, H100, H200, B200 · not L4"],
        ["DRA", "resource.k8s.io/v1 · ResourceClaim · DeviceClass"],
      ],
      view: "cluster",
      focus: ["you", "api", "sched", "node1", "node2"],
      events: [
        ev({
          id: "gp29", at: 300000, src: "kubectl", dst: API, layer: "api", size: "0.8 KB", title: "A SECOND GPU POD", path: ["you", "api"],
          says: "You create llm-2, which also asks for one GPU.",
          info: "POST /api/v1/namespaces/default/pods  llm-2 · nvidia.com/gpu: 1",
          decoded: [sec("RESOURCES", [["limits.nvidia.com/gpu", "1", true], ["tolerations", "nvidia.com/gpu · Exists"]])],
        }),
        ev({
          id: "gp30", at: 300060, src: SCHED, dst: API, layer: "drop", size: "0.4 KB", title: "NO GPU LEFT", path: ["sched", "api"],
          says: "No node has a free GPU, so llm-2 stays Pending.",
          info: "PodScheduled=False · Unschedulable",
          decoded: [
            sec("CONDITION", [["reason", "Unschedulable"], ["message", "0/2 nodes are available: 2 Insufficient nvidia.com/gpu.", true]]),
            sec("TIME-SLICING", [["config", "sharing.timeSlicing.resources: name nvidia.com/gpu, replicas 4"], ["node-2 advertises", "nvidia.com/gpu: 4", true], ["isolation", "none · shared memory and one fault domain"]]),
            sec("MIG", [["what", "isolated slices with their own memory and compute"], ["resource names", "nvidia.com/mig-1g.10gb and so on"], ["L4", "not supported"]]),
            sec("DYNAMIC RESOURCE ALLOCATION", [["GA", "Kubernetes v1.34 · resource.k8s.io/v1"], ["driver publishes", "ResourceSlices · each device with its attributes"], ["Pod refers to", "a ResourceClaim · selected by CEL expressions"]]),
          ],
          note: "With time-slicing, nothing stops one Pod from using all 24 GB and crashing the others, and the plugin says so in its own documentation.",
        }),
      ],
    },
    {
      title: "WHEN THE GPU FAILS",
      subtitle: "Unhealthy, and allocatable drops",
      body: "The plugin keeps watching the driver for critical errors, called Xid errors. An hour later the card drops off the PCI bus and the driver reports Xid 79. The plugin marks the device Unhealthy and sends a new list on the ListAndWatch stream that has been open all along. The kubelet lowers allocatable to 0 and leaves capacity at 1. No new Pod is placed on the card. llm keeps its assignment and crashes when it next touches the GPU.",
      facts: [
        ["ERROR", "Xid 79 · GPU has fallen off the bus"],
        ["IGNORED BY DEFAULT", "Xid 13, 31, 32, 43, 45, 68, 69 · application errors"],
        ["CAPACITY", "1 · unchanged"],
        ["ALLOCATABLE", "1 → 0"],
      ],
      view: "gpu",
      focus: ["gp.api", "gp.kubelet", "gp.plugin", "gp.driver", "gp.gpu"],
      events: [
        ev({
          id: "gp31", at: 3900000, src: "NVIDIA driver", dst: PLUGIN, layer: "drop", size: " - ", title: "XID 79", path: ["gp.driver", "gp.plugin"],
          says: "The driver reports a critical error for the card, and the plugin is listening.",
          info: "NVML event XidCriticalError · Xid 79",
          decoded: [sec("NVML EVENT", [["type", "XidCriticalError"], ["Xid", "79 · GPU has fallen off the bus", true], ["device", UUID]]), sec("PLUGIN", [["skipped Xids", "13, 31, 32, 43, 45, 68, 69 · caused by an application"], ["79", "not skipped → Unhealthy", true], ["DP_DISABLE_HEALTHCHECKS", "unset"]])],
        }),
        ev({
          id: "gp32", at: 3900010, src: PLUGIN, dst: KUBELET, layer: "drop", size: "0.1 KB", title: "UNHEALTHY", path: ["gp.plugin", "gp.kubelet"],
          says: "A new message on the open stream: the same GPU, now Unhealthy.",
          info: `ListAndWatchResponse devices=[${UUID} Unhealthy]`,
          decoded: [sec("DEVICE", [["ID", UUID], ["health", "Healthy → Unhealthy", true]])],
          note: "The plugin has no way to mark the device Healthy again. It stays Unhealthy until the plugin restarts, usually after the node is fixed.",
        }),
        ev({
          id: "gp33", at: 3900500, src: KUBELET, dst: API, layer: "api", size: "1.2 KB", title: "ALLOCATABLE DROPS TO 0", path: ["gp.kubelet", "gp.api"],
          says: "The kubelet lowers node-2's allocatable GPUs to 0. The scheduler places no more GPU Pods here.",
          info: "PATCH /api/v1/nodes/node-2/status",
          decoded: [
            sec("NODE-2 STATUS", [["capacity.nvidia.com/gpu", "1 · unchanged"], ["allocatable.nvidia.com/gpu", "1 → 0", true]]),
            sec("LLM", [["assignment", "kept"], ["next CUDA call", "fails · restarts under restartPolicy"]]),
          ],
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "install → Pods on node-2", layer: "api", start: 0, duration: 9800 },
    { value: "t2", label: "driver loaded", layer: "node", start: 9800, duration: 85200 },
    { value: "t3", label: "containerd set up for CDI", layer: "node", start: 95000, duration: 25000 },
    { value: "t4", label: "register + advertise", layer: "control", start: 150000, duration: 1000 },
    { value: "t5", label: "schedule llm", layer: "control", start: 230000, duration: 60 },
    { value: "t6", label: "allocate + checkpoint", layer: "control", start: 230100, duration: 40 },
    { value: "t7", label: "sandbox, pull, start", layer: "node", start: 230140, duration: 7360 },
  ],
  timingNote: "Times from one illustrative run. The driver step takes longer when it has to build the modules, and the image pull depends on the image: CUDA images are often several gigabytes.",
  summary: {
    title: "A NAME AND A NUMBER",
    body: "To Kubernetes, a GPU is a name and a number. The driver and toolkit make the card usable on the node; the device plugin registers on a Unix socket, reports devices on a stream and turns them into nvidia.com/gpu on the Node. The scheduler only compares counts. The kubelet picks the device and asks the plugin how to hand it over, and CDI tells containerd which device files and libraries to put in the container. Sharing, slicing and claims are what come after that whole number.",
    facts: [
      ["PLUGIN API", "Register · ListAndWatch · Allocate"],
      ["SCHEDULER SEES", "nvidia.com/gpu: 1 · nothing more"],
      ["CONTAINER GETS", "device files + host libraries, via CDI"],
      ["NEXT", "List and watch"],
    ],
  },
}
