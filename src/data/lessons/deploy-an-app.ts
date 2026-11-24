import type { Lesson } from "../types"
import { ev, sec } from "./helpers"

const POD = "web-6f7c9d8b4-x2kqp"
const RS = "web-6f7c9d8b4"
const API = "kube-apiserver"

export const deployAnApp: Lesson = {
  id: "deploy-an-app",
  title: "Deploy an app",
  subtitle: "kubectl apply → Pod Running",
  category: "control",
  seo: {
    title: "What happens when you run kubectl apply",
    description: "Follow one kubectl apply through the API server, etcd, controllers, scheduler and kubelet until the Kubernetes Pod is running, event by event.",
  },
  actors: ["you", "cp", "etcd", "node1", "node2", "web-deploy", "web-rs", "web-svc"],
  pods: { node1: ["other"], node2: ["other"] },
  res: { "web-svc": { kind: "service", name: "Service web", sub: "endpoints: none" } },
  lanes: { [POD]: "Pod x2kqp", "CNI plugin": "CNI" },
  overview: {
    body: "What happens between typing kubectl apply and your app answering requests. Ten components touch one Deployment, and almost none of them talk to each other directly: every one of them reads and writes through the API server.",
    facts: [
      ["COMMAND", "kubectl apply -f web.yaml"],
      ["OBJECTS", "Deployment, ReplicaSet, Pod, Binding, EndpointSlice"],
      ["COMPONENTS", "kubectl, API server, etcd, controllers, scheduler, kubelet, containerd, CNI"],
      ["TIME TO READY", "≈ 4.2 s, most of it pulling the image"],
    ],
  },
  steps: [
    {
      title: "SEND THE MANIFEST",
      subtitle: "kubectl posts JSON to the API",
      body: "kubectl reads web.yaml, turns it into JSON and asks the API server whether a Deployment called web already exists. The answer is 404, so it sends a create request. kubectl never talks to nodes or etcd; the API server is the only door.",
      facts: [
        ["FROM", "192.168.1.10 (your laptop)"],
        ["TO", "10.0.0.10:6443 over HTTPS"],
        ["AUTH", "client certificate from kubeconfig"],
      ],
      view: "cluster",
      focus: ["you", "cp"],
      events: [
        ev({
          id: "e1", at: 0, src: "kubectl", dst: API, layer: "api", size: "0.2 KB", title: "DOES IT EXIST?", path: ["you", "cp"],
          says: "kubectl asks the API server whether a Deployment called web already exists. It doesn't.",
          info: "GET /apis/apps/v1/namespaces/default/deployments/web",
          decoded: [
            sec("HTTP/2 REQUEST", [["method", "GET"], ["path", "/apis/apps/v1/namespaces/default/deployments/web"], ["host", "10.0.0.10:6443"]]),
            sec("RESPONSE", [["status", "404 Not Found"]]),
          ],
          note: "apply always checks first. A 404 means create; an existing object would get a PATCH instead.",
        }),
        ev({
          id: "e2", at: 9, src: "kubectl", dst: API, layer: "api", size: "1.1 KB", title: "CREATE DEPLOYMENT", path: ["you", "cp"],
          says: "So kubectl sends the whole Deployment, as JSON, and asks the API server to create it.",
          info: "POST /apis/apps/v1/namespaces/default/deployments",
          res: { "web-deploy": { kind: "deployment", name: "Deployment web", sub: "wants 3 replicas", state: "creating" } },
          decoded: [
            sec("HTTP/2 REQUEST", [["method", "POST"], ["path", "/apis/apps/v1/namespaces/default/deployments"], ["content-type", "application/json"]]),
            sec("BODY · DEPLOYMENT", [["metadata.name", "\"web\""], ["spec.replicas", "3"], ["…containers[0].image", "registry.example.com/shop/web:1.4.2"], ["annotation", "last-applied-configuration (your YAML)"]]),
          ],
        }),
      ],
    },
    {
      title: "GATEKEEPING",
      subtitle: "Who are you, are you allowed",
      body: "Before anything is stored, the API server runs the request through a fixed pipeline. Authentication works out who you are, authorization (RBAC) decides whether you may create Deployments in this namespace, and admission plugins get a chance to change or reject the object. Missing fields get their defaults on the way.",
      facts: [
        ["WHO", "user you, group developers"],
        ["ALLOWED BY", "RoleBinding developers-edit"],
        ["ORDER", "authn → authz → mutating admission → validation → validating admission"],
      ],
      view: "cluster",
      focus: ["cp"],
      events: [
        ev({
          id: "e3", at: 10, src: API, dst: API, layer: "api", size: " - ", title: "AUTHENTICATION", path: ["cp", "cp"],
          says: "The API server checks who is asking: your client certificate says you.",
          info: "authn: client certificate CN=you O=developers",
          decoded: [sec("RESULT", [["method", "x509 client certificate"], ["user", "you"], ["groups", "developers, system:authenticated"]])],
        }),
        ev({
          id: "e4", at: 10, src: API, dst: API, layer: "api", size: " - ", title: "AUTHORIZATION · RBAC", path: ["cp", "cp"],
          says: "Then it checks you're allowed to create Deployments here. RBAC says yes.",
          info: "authz: RBAC allows create deployments.apps in default",
          decoded: [sec("CHECK", [["verb", "create"], ["resource", "deployments.apps"], ["namespace", "default"], ["decision", "allow"], ["because", "RoleBinding developers-edit → ClusterRole edit"]])],
        }),
        ev({
          id: "e5", at: 11, src: API, dst: API, layer: "api", size: " - ", title: "DEFAULTS AND ADMISSION", path: ["cp", "cp"],
          says: "It fills in the fields you left out with defaults, and admission checks the object.",
          info: "defaults filled, admission passed",
          decoded: [
            sec("DEFAULTS ADDED", [["spec.strategy.type", "RollingUpdate", true], ["…rollingUpdate.maxSurge", "25%", true], ["…rollingUpdate.maxUnavailable", "25%", true], ["spec.revisionHistoryLimit", "10", true]]),
            sec("ADMISSION", [["mutating", "no changes"], ["schema validation", "passed"], ["validating", "passed"]]),
          ],
        }),
      ],
    },
    {
      title: "SAVED TO ETCD",
      subtitle: "A record of what you want",
      body: "The API server writes the Deployment to etcd, the cluster's only database, and answers kubectl with 201 Created. That's where kubectl stops. Nothing is running yet: etcd now holds a description of what you want, and the rest of the cluster has to notice it.",
      facts: [
        ["KEY", "/registry/deployments/default/web"],
        ["FORMAT", "protobuf"],
        ["REVISION", "48211"],
      ],
      view: "cluster",
      focus: ["cp", "etcd", "you"],
      events: [
        ev({
          id: "e6", at: 13, src: API, dst: "etcd", layer: "state", size: "0.9 KB", title: "STORE IN ETCD", path: ["cp", "etcd"],
          says: "The API server saves the Deployment in etcd. Nothing is running yet.",
          info: "Txn put /registry/deployments/default/web",
          res: { "web-deploy": { kind: "deployment", name: "Deployment web", sub: "saved · rev 48211" } },
          decoded: [
            sec("gRPC · etcdserverpb.KV/Txn", [["compare", "mod_revision = 0 (only if new)"], ["success", "put"], ["key", "/registry/deployments/default/web"], ["value", "protobuf, starts with k8s\\0"]]),
            sec("RESULT", [["revision", "48211"]]),
          ],
        }),
        ev({
          id: "e7", at: 15, src: API, dst: "kubectl", layer: "api", size: "1.6 KB", title: "201 CREATED", path: ["cp", "you"],
          says: "kubectl gets 201 Created and exits. The rest happens without it.",
          info: "201 Created deployment.apps/web",
          decoded: [sec("HTTP/2 RESPONSE", [["status", "201 Created"], ["metadata.resourceVersion", "\"48211\"", true], ["metadata.uid", "3c1f6b2e-…"]])],
          note: "kubectl prints \"deployment.apps/web created\" here and exits. Everything after this happens without it.",
        }),
      ],
    },
    {
      title: "CONTROLLERS REACT",
      subtitle: "ReplicaSet, then 3 Pods",
      body: "Controllers hold long-lived watches on the API server, so they hear about the new Deployment within milliseconds. The Deployment controller creates a ReplicaSet for this version of the Pod template. The ReplicaSet controller sees it wants 3 Pods, finds 0, and creates 3. None of them has a node yet.",
      facts: [
        ["RUNS IN", "kube-controller-manager"],
        ["PATTERN", "watch → compare → act"],
        ["CREATED", `ReplicaSet ${RS}, 3 Pods`],
      ],
      view: "cluster",
      focus: ["cp", "web-deploy", "web-rs"],
      events: [
        ev({
          id: "e8", at: 17, src: API, dst: "deployment ctrl", layer: "control", size: "1.2 KB", title: "WATCH EVENT", path: ["cp", "web-deploy"],
          says: "The Deployment controller is watching, so it hears about the new Deployment at once.",
          info: "WATCH ADDED Deployment default/web",
          decoded: [sec("WATCH STREAM", [["request", "GET /apis/apps/v1/deployments?watch=true"], ["type", "ADDED"], ["object", "Deployment default/web"], ["resourceVersion", "48211"]])],
          note: "Controllers never poll. They keep a watch open and the API server pushes each change to them.",
        }),
        ev({
          id: "e9", at: 21, src: "deployment ctrl", dst: API, layer: "api", size: "1.4 KB", title: "CREATE REPLICASET", path: ["cp", "web-rs"],
          says: "It creates a ReplicaSet: the thing that keeps a set number of identical Pods.",
          info: `POST …/replicasets  ${RS}`,
          res: { "web-rs": { kind: "replicaset", name: "ReplicaSet …d8b4", sub: "wants 3 Pods", state: "creating" } },
          decoded: [sec("BODY · REPLICASET", [["metadata.name", RS], ["ownerReferences", "Deployment/web"], ["labels.pod-template-hash", "6f7c9d8b4"], ["spec.replicas", "3"]])],
        }),
        ev({
          id: "e10", at: 24, src: API, dst: "replicaset ctrl", layer: "control", size: "1.4 KB", title: "WATCH EVENT", path: ["cp", "web-rs"],
          says: "The ReplicaSet controller hears about the new ReplicaSet. It wants 3 Pods and has 0.",
          info: `WATCH ADDED ReplicaSet ${RS}`,
          decoded: [sec("WATCH STREAM", [["type", "ADDED"], ["object", `ReplicaSet ${RS}`], ["wants", "3 Pods"], ["has", "0 Pods"]])],
        }),
        ev({
          id: "e11", at: 28, src: "replicaset ctrl", dst: API, layer: "api", size: "2.3 KB", title: "CREATE POD (1 OF 3)", path: ["web-rs", "web-rs"],
          says: "So it creates 3 Pods. They exist only as records: no node, nothing running.",
          info: `POST /api/v1/namespaces/default/pods  ${POD} (+2)`,
          res: { "web-rs": { kind: "replicaset", name: "ReplicaSet …d8b4", sub: "3 Pods · none placed" } },
          decoded: [sec("BODY · POD", [["metadata.generateName", `${RS}-`], ["metadata.name", POD], ["spec.nodeName", "\"\"  (no node yet)"], ["status.phase", "Pending"]])],
        }),
      ],
    },
    {
      title: "SCHEDULING",
      subtitle: "The scheduler picks a node",
      body: "The Pod exists, but nothing runs it yet: its spec.nodeName is empty. The scheduler watches every Pod and queues the ones with no node. It drops nodes that can't fit the Pod's CPU and memory requests, scores the rest, and writes its pick back to the API server as a Binding. The other two Pods go through the same loop and land on node-1 and node-2.",
      facts: [
        ["QUEUES", "Pods with no node"],
        ["FILTER", "node-1 and node-2 both fit"],
        ["SCORE", "node-2 wins, it has more room"],
        ["WRITES", "Binding → API server"],
      ],
      view: "cluster",
      focus: ["cp", "web-rs", "node1", "node2"],
      pods: { node1: ["other", "starting"], node2: ["other", "starting", "starting"] },
      events: [
        ev({
          id: "e12", at: 31, src: API, dst: "kube-scheduler", layer: "control", size: "2.3 KB", title: "UNSCHEDULED POD", path: ["cp", "cp"],
          says: "The scheduler is watching every Pod. This one has no node, so it joins the queue.",
          info: `WATCH ADDED Pod ${POD} (no node)`,
          decoded: [sec("WATCH STREAM", [["request", "GET /api/v1/pods?fieldSelector=status.phase!=Succeeded,status.phase!=Failed&watch=true"], ["type", "ADDED"], ["spec.nodeName", "\"\" → into the scheduling queue", true]])],
        }),
        ev({
          id: "e13", at: 52, src: "kube-scheduler", dst: API, layer: "api", size: "0.3 KB", title: "BINDING", path: ["cp", "cp"],
          says: "It picks node-2 and records that choice as a Binding. It never contacts node-2 itself.",
          info: `POST …/pods/${POD}/binding  → node-2`,
          res: { "web-rs": { kind: "replicaset", name: "ReplicaSet …d8b4", sub: "3 Pods · 1 on node-2" } },
          decoded: [
            sec("HTTP/2 REQUEST", [["method", "POST"], ["path", `/api/v1/namespaces/default/pods/${POD}/binding`], ["encoding", "protobuf (shown as JSON)"]]),
            sec("BODY · BINDING", [["kind", "Binding"], ["metadata.name", POD], ["target.kind", "Node"], ["target.name", "node-2", true]]),
            sec("EFFECT ON THE POD", [["spec.nodeName", "\"\" → \"node-2\"", true], ["conditions.PodScheduled", "True"]]),
          ],
        }),
      ],
    },
    {
      title: "KUBELET STARTS IT",
      subtitle: "Sandbox, IP, image, container",
      body: "Zoom into node-2. Its kubelet only watches Pods assigned to this node, so it sees this one right away. It asks containerd for a sandbox: a tiny pause container that owns the Pod's network namespace. The CNI plugin plugs that namespace into the cni0 bridge and gives it an IP. Then the image is pulled and the app container starts inside the sandbox.",
      facts: [
        ["NODE", "node-2 · 10.0.1.12"],
        ["RUNTIME", "containerd over CRI (gRPC)"],
        ["POD IP", "10.244.2.17"],
        ["SLOWEST PART", "image pull, 2.6 s"],
      ],
      view: "node2",
      focus: ["n2.api", "n2.kubelet", "n2.containerd", "n2.cni0", "n2.podA"],
      events: [
        ev({
          id: "e14", at: 56, src: API, dst: "kubelet", layer: "control", size: "2.4 KB", title: "KUBELET SEES ITS POD", path: ["n2.api", "n2.kubelet"],
          says: "node-2's kubelet only watches Pods assigned to node-2. Now one is.",
          info: `WATCH MODIFIED Pod ${POD}`,
          decoded: [sec("WATCH STREAM", [["request", "GET /api/v1/pods?fieldSelector=spec.nodeName=node-2&watch=true"], ["type", "MODIFIED"], ["spec.nodeName", "node-2"]])],
          note: "Each kubelet only watches Pods assigned to its own node.",
        }),
        ev({
          id: "e15", at: 68, src: "kubelet", dst: "containerd", layer: "node", size: "0.6 KB", title: "CREATE SANDBOX", path: ["n2.kubelet", "n2.containerd"],
          says: "The kubelet asks containerd for a sandbox: an empty home for the Pod.",
          info: `RunPodSandbox ${POD}`,
          decoded: [sec("gRPC · runtime.v1.RuntimeService", [["method", "RunPodSandbox"], ["socket", "unix:///run/containerd/containerd.sock"], ["creates", "pause container + network namespace"]])],
        }),
        ev({
          id: "e16", at: 201, src: "containerd", dst: "CNI plugin", layer: "net", size: "0.4 KB", title: "GIVE THE POD AN IP", path: ["n2.containerd", "n2.cni0"],
          says: "containerd calls the network plugin, which plugs the Pod into the bridge and gives it an IP.",
          info: "ADD eth0 → 10.244.2.17/24",
          decoded: [sec("CNI ADD", [["CNI_IFNAME", "eth0"], ["CNI_NETNS", "/var/run/netns/cni-4f1c…"], ["ip", "10.244.2.17/24", true], ["gateway", "10.244.2.1 (cni0 bridge)"], ["veth", "veth3b1c ⇄ eth0"]])],
        }),
        ev({
          id: "e17", at: 250, src: "kubelet", dst: "containerd", layer: "node", size: "48 MB", title: "PULL IMAGE", path: ["n2.kubelet", "n2.containerd"],
          says: "The kubelet asks for the app's image. Downloading 48 MB is the slow part.",
          info: "PullImage registry.example.com/shop/web:1.4.2",
          decoded: [sec("gRPC · runtime.v1.ImageService", [["method", "PullImage"], ["layers", "5"], ["size", "48.3 MB"], ["took", "2.6 s"]])],
          note: "This one call is most of the time between apply and Ready. See the TIMING tab.",
        }),
        ev({
          id: "e18", at: 2850, src: "kubelet", dst: "containerd", layer: "node", size: "1.0 KB", title: "CREATE CONTAINER", path: ["n2.kubelet", "n2.containerd"],
          says: "containerd creates the app's container inside the sandbox.",
          info: "CreateContainer web (in sandbox)",
          decoded: [sec("gRPC · runtime.v1.RuntimeService", [["method", "CreateContainer"], ["image", "registry.example.com/shop/web:1.4.2"], ["limits", "cpu 500m, memory 256Mi (cgroups)"]])],
        }),
        ev({
          id: "e19", at: 2930, src: "containerd", dst: POD, layer: "node", size: "0.1 KB", title: "START CONTAINER", path: ["n2.containerd", "n2.podA"],
          says: "And starts it. The app is now running.",
          info: "StartContainer web",
          decoded: [sec("gRPC · runtime.v1.RuntimeService", [["method", "StartContainer"], ["process", "/app/server --port 8080"]])],
        }),
        ev({
          id: "e20", at: 2960, src: "kubelet", dst: API, layer: "api", size: "1.8 KB", title: "REPORT STATUS", path: ["n2.kubelet", "n2.api"],
          says: "The kubelet tells the API server: Running, with IP 10.244.2.17.",
          info: `PATCH …/pods/${POD}/status  phase=Running`,
          decoded: [sec("STATUS PATCH", [["status.phase", "Pending → Running", true], ["status.podIP", "10.244.2.17", true], ["conditions.Ready", "False (probe not passed yet)"]])],
        }),
      ],
    },
    {
      title: "READY FOR TRAFFIC",
      subtitle: "Probe passes, endpoints update",
      body: "Running isn't the same as ready. The kubelet calls the app's readiness probe, and only when it answers with a success code (200–399) does the Pod become Ready. The EndpointSlice controller sees that and adds 10.244.2.17:8080 to the web Service's endpoints. From now on, traffic for the Service can land here.",
      facts: [
        ["PROBE", "GET :8080/healthz → 200"],
        ["SERVICE", "web · 10.96.120.15:80"],
        ["ENDPOINT ADDED", "10.244.2.17:8080"],
      ],
      view: "cluster",
      focus: ["cp", "web-svc", "node1", "node2"],
      pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
      events: [
        ev({
          id: "e21", at: 4200, src: "kubelet", dst: POD, layer: "net", size: "0.2 KB", title: "READINESS PROBE", path: ["node2", "node2"],
          says: "The kubelet calls the app's health check. It answers 200: ready.",
          info: "GET http://10.244.2.17:8080/healthz → 200 OK",
          decoded: [sec("HTTP PROBE", [["type", "readiness"], ["request", "GET http://10.244.2.17:8080/healthz"], ["from", "kubelet on node-2"], ["result", "200 OK"]])],
        }),
        ev({
          id: "e22", at: 4210, src: "kubelet", dst: API, layer: "api", size: "0.9 KB", title: "POD IS READY", path: ["node2", "cp"],
          says: "The kubelet reports the Pod as Ready.",
          info: `PATCH …/pods/${POD}/status  Ready=True`,
          decoded: [sec("STATUS PATCH", [["conditions.Ready", "False → True", true], ["conditions.ContainersReady", "True"]])],
        }),
        ev({
          id: "e23", at: 4224, src: "endpointslice ctrl", dst: API, layer: "api", size: "0.7 KB", title: "UPDATE ENDPOINTS", path: ["cp", "web-svc"],
          says: "The Pod's IP is added to the Service's list of endpoints. Traffic can now reach it.",
          info: "PUT …/endpointslices/web-7xk2p  +10.244.2.17:8080",
          res: { "web-svc": { kind: "service", name: "Service web", sub: "endpoints: 1 · 10.244.2.17" } },
          decoded: [sec("BODY · ENDPOINTSLICE", [["labels.kubernetes.io/service-name", "web"], ["endpoints[+]", "10.244.2.17", true], ["conditions.ready", "true", true], ["ports", "8080/TCP"]])],
          note: "kube-proxy on every node watches EndpointSlices and updates its rules. That's the next lesson.",
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "kubectl → API → etcd", layer: "api", start: 0, duration: 15 },
    { value: "t2", label: "Controllers: RS + Pods", layer: "control", start: 17, duration: 14 },
    { value: "t3", label: "Scheduling", layer: "control", start: 31, duration: 21 },
    { value: "t4", label: "Sandbox + Pod IP", layer: "net", start: 68, duration: 172 },
    { value: "t5", label: "Image pull · 48 MB", layer: "node", start: 250, duration: 2600 },
    { value: "t6", label: "Create + start", layer: "node", start: 2850, duration: 110 },
    { value: "t7", label: "Waiting for ready", layer: "node", start: 2960, duration: 1250 },
    { value: "t8", label: "Endpoints updated", layer: "control", start: 4210, duration: 14 },
  ],
  summary: {
    title: "POD RUNNING",
    body: "One command became 23 events across ten components in about 4.2 seconds. Notice what never happened: kubectl never talked to a node, the scheduler never started a container, and the kubelet never wrote to etcd. Each component watched the API server and did one job.",
    facts: [
      ["SLOWEST PART", "image pull, 2.6 s of 4.2 s"],
      ["PODS", "3 Running, 1 on node-1 and 2 on node-2"],
      ["NEXT", "A request finds your Pod"],
    ],
  },
}
