import type { Lesson, PodLayout, Resource } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const SCHED = "kube-scheduler"
const KCM = "kube-controller-manager"
const CA = "cluster-autoscaler"
const AWS = "AWS"
const KUBEADM = "kubeadm · node-3"
const K3 = "kubelet · node-3"
const FLANNEL = "kube-flannel · node-3"
const NEW_POD = "web-…-r4m8n"

const TOKEN_ID = "9a08jv"
const INSTANCE = "i-0a1b2c3d4e5f60718"
const ASG = "kubelearn-workers"

const csr = (sub: string, state?: Resource["state"]): Resource => ({ kind: "csr", name: "CSR csr-7bq4z", sub, state })

/** web runs two Pods on node-1 and one on node-2, and both nodes are nearly full; cluster-autoscaler is the last grey slot on node-1 */
const FULL: PodLayout = { node1: ["other", "v1", "v1", "other"], node2: ["other", "v1", "other", "other"] }

export const nodeJoins: Lesson = {
  id: "node-joins",
  title: "A node joins the cluster",
  subtitle: "Autoscaler, bootstrap, Ready",
  category: "control",
  seo: {
    title: "How a new node joins a Kubernetes cluster",
    description: "A Pod has nowhere to run: the Cluster Autoscaler asks AWS for a machine, its kubelet gets a certificate, registers, turns Ready and the Pod lands on it.",
  },
  actors: ["you", "cp", "node1", "node2", "node3", "cloud", "node3-csr"],
  pods: FULL,
  lanes: {
    kubectl: "you",
    [API]: "control plane", [SCHED]: "control plane", [KCM]: "control plane",
    [CA]: "cluster-autoscaler",
    [AWS]: "AWS",
    [KUBEADM]: "node-3", [K3]: "node-3", [FLANNEL]: "node-3",
    "kubelet · node-1": "node-1",
  },
  overview: {
    body: "A cluster's nodes are machines someone has to start. When a Pod fits on no node, an autoscaler asks the cloud for one more, and the new machine has to prove who it is before the API server lets it in. Follow node-3 from an Auto Scaling group to a Ready node: a bootstrap token, a certificate signed by the cluster, a Node object, the DaemonSets that wire up its network, and the Pod that was waiting for it.",
    facts: [
      ["AUTOSCALER", "Cluster Autoscaler · AWS Auto Scaling group"],
      ["NEW NODE", "node-3 · 10.0.1.13 · Pods 10.244.3.0/24"],
      ["JOINS WITH", "kubeadm join · TLS bootstrapping"],
      ["PENDING TO RUNNING", "≈ 70 s in this run"],
    ],
  },
  steps: [
    {
      title: "NOWHERE TO GO",
      subtitle: "Pending, Unschedulable",
      body: "You scale web to four replicas. The ReplicaSet creates the Pod at once, but the scheduler can't place it: it asks for 500m CPU, and node-1 and node-2 each have less than that left unreserved. The scheduler doesn't fail anything. It writes PodScheduled=False with the reason Unschedulable on the Pod, records a FailedScheduling event, and parks the Pod until something in the cluster changes.",
      facts: [
        ["POD", `${NEW_POD} · Pending`],
        ["REQUESTS", "cpu 500m · memory 256Mi"],
        ["FREE CPU", "node-1 300m · node-2 250m"],
        ["CONDITION", "PodScheduled=False · Unschedulable"],
      ],
      view: "cluster",
      focus: ["you", "api", "sched", "node1", "node2"],
      events: [
        ev({
          id: "nj1", at: 0, src: "kubectl", dst: API, layer: "api", size: "0.2 KB", title: "SCALE TO FOUR", path: ["you", "api"],
          says: "You ask for a fourth web Pod.",
          info: "kubectl scale deployment web --replicas=4",
          decoded: [sec("PATCH", [["spec.replicas", "3 → 4", true], ["then", "the ReplicaSet creates one Pod"]])],
        }),
        ev({
          id: "nj2", at: 40, src: KCM, dst: API, layer: "control", size: "2.1 KB", title: "A NEW POD", path: ["kcm", "api"],
          says: "The ReplicaSet controller creates the Pod, with no node yet.",
          info: `POST …/pods  ${NEW_POD}`,
          decoded: [sec("POD", [["spec.nodeName", "empty", true], ["requests", "cpu 500m · memory 256Mi"]])],
        }),
        ev({
          id: "nj3", at: 90, src: SCHED, dst: API, layer: "drop", size: "0.5 KB", title: "UNSCHEDULABLE", path: ["sched", "api"],
          says: "No node has room. The scheduler marks the Pod Unschedulable and sets it aside.",
          info: `PodScheduled=False · 0/2 nodes are available: 2 Insufficient cpu.`,
          decoded: [
            sec("FILTER", [["node-1", "300m free · Insufficient cpu"], ["node-2", "250m free · Insufficient cpu"]]),
            sec("POD STATUS", [["conditions[PodScheduled]", "False", true], ["reason", "Unschedulable"], ["message", "0/2 nodes are available: 2 Insufficient cpu."]]),
            sec("SCHEDULER QUEUE", [["moved to", "the unschedulable Pods"], ["retried when", "a cluster event could help, such as a Node added"]]),
          ],
          note: "Free here means not reserved by other Pods' requests. node-1 may be mostly idle and still count as full.",
        }),
      ],
    },
    {
      title: "THE AUTOSCALER NOTICES",
      subtitle: "simulate, then ask for a machine",
      body: "Cluster Autoscaler runs as a Deployment, here on node-1. Every 10 seconds it looks for Pods the scheduler marked Unschedulable. For each node group it knows, here one AWS Auto Scaling group of m6i.xlarge machines, it builds a template node and runs the scheduler's own filters against it. The Pod would fit on one more of those, so it raises the group's desired capacity from 2 to 3. It never creates an instance itself, and never touches the Pod.",
      facts: [
        ["RUNS AS", "Deployment cluster-autoscaler · kube-system"],
        ["SCAN", "every 10 s"],
        ["NODE GROUP", `Auto Scaling group ${ASG} · m6i.xlarge`],
        ["DECISION", "desired capacity 2 → 3"],
      ],
      view: "cluster",
      focus: ["api", "node1", "cloud"],
      events: [
        ev({
          id: "nj4", at: 8000, src: API, dst: CA, layer: "control", size: "2.4 KB", title: "AN UNSCHEDULABLE POD", path: ["api", "node1"],
          says: "On its next loop, the autoscaler finds the Pod the scheduler gave up on.",
          info: `${NEW_POD} · PodScheduled=False · Unschedulable`,
          decoded: [sec("SCAN", [["interval", "10 s"], ["looks for", "Pods marked Unschedulable by the scheduler", true], ["ignores", "Pods that are only new and not yet tried"]])],
        }),
        ev({
          id: "nj5", at: 8050, src: CA, dst: CA, layer: "control", size: " - ", title: "SIMULATE A NEW NODE", path: ["node1", "node1"],
          says: "It checks the Pod against a template node from the group: it would fit.",
          info: `template node from ${ASG} · m6i.xlarge`,
          decoded: [sec("TEMPLATE NODE", [["allocatable cpu", "≈ 3.9 of 4 vCPU"], ["labels", "from the group's instance type and tags"], ["DaemonSet Pods", "subtracted first"], ["fits", `${NEW_POD} ✓`, true]]), sec("EXPANDER", [["choices", "random · most-pods · least-waste · least-nodes · price · priority"], ["here", "one group, so no choice to make"]])],
        }),
        ev({
          id: "nj6", at: 8200, src: CA, dst: AWS, layer: "net", size: "0.6 KB", title: "RAISE DESIRED CAPACITY", path: ["node1", "cloud"],
          says: "The autoscaler asks AWS for one more machine in the group.",
          info: `autoscaling:SetDesiredCapacity ${ASG} 2 → 3`,
          decoded: [sec("AWS API", [["action", "SetDesiredCapacity"], ["AutoScalingGroupName", ASG], ["DesiredCapacity", "3", true], ["credentials", "an IAM role for the autoscaler's Pod"]])],
          note: "Karpenter, the other common autoscaler, has no node groups. It batches pending Pods for a moment, picks an instance type that fits them from its NodePool's rules, records it as a NodeClaim and launches the instance itself through EC2. Its nodes join EKS with IAM credentials rather than a bootstrap token.",
        }),
      ],
    },
    {
      title: "A MACHINE",
      subtitle: "boot, then kubeadm join",
      body: "The Auto Scaling group launches an instance from its launch template and it boots as node-3, 10.0.1.13. Kubernetes doesn't know it exists. The template's user data runs kubeadm join, with the API server's address, a bootstrap token and a hash of the cluster's CA certificate. kubeadm first reads the public cluster-info ConfigMap, checks that the CA in it matches the hash, so it knows it is talking to the right cluster, then writes a bootstrap kubeconfig and starts the kubelet.",
      facts: [
        ["INSTANCE", `${INSTANCE} · m6i.xlarge`],
        ["ADDRESS", "10.0.1.13"],
        ["USER DATA", "kubeadm join 10.0.0.10:6443 --token …"],
        ["TRUSTS THE API SERVER BY", "the CA hash, sha256:…"],
      ],
      view: "cluster",
      focus: ["api", "node3", "cloud"],
      events: [
        ev({
          id: "nj7", at: 9000, src: AWS, dst: K3, layer: "net", size: " - ", title: "INSTANCE LAUNCHED", path: ["cloud", "node3"],
          says: "AWS starts a new instance from the group's launch template.",
          info: `RunInstances · ${INSTANCE} · 10.0.1.13`,
          pods: { node3: [] },
          decoded: [sec("INSTANCE", [["id", INSTANCE, true], ["type", "m6i.xlarge · 4 vCPU · 16 GiB"], ["private IP", "10.0.1.13"], ["image", "the group's AMI, with containerd, kubeadm and kubelet installed"]])],
        }),
        ev({
          id: "nj8", at: 40000, src: KUBEADM, dst: API, layer: "api", size: "1.9 KB", title: "DISCOVER THE CLUSTER", path: ["node3", "api"],
          says: "kubeadm reads the cluster's public information and checks it against the CA hash it was given.",
          info: "GET /api/v1/namespaces/kube-public/configmaps/cluster-info",
          decoded: [
            sec("USER DATA", [["command", `kubeadm join 10.0.0.10:6443 --token ${TOKEN_ID}.c0izixklcxtmnze7 --discovery-token-ca-cert-hash sha256:…`]]),
            sec("THE CLUSTER-INFO CONFIGMAP", [["read as", "an anonymous user"], ["contains", "the API server address and CA certificate", true], ["signed with", `the token's secret · checked by kubeadm`], ["CA hash", "matches · trust established", true]]),
            sec("WRITTEN", [["/etc/kubernetes/bootstrap-kubelet.conf", "a kubeconfig with the bootstrap token"], ["then", "systemctl start kubelet"]]),
          ],
          note: "Bootstrap tokens made by kubeadm last 24 hours by default. A launch template that joins nodes for months needs a token made with --ttl 0, or a fresh one written in by whatever builds the template.",
        }),
      ],
    },
    {
      title: "TLS BOOTSTRAP",
      subtitle: "a token for a certificate",
      body: "The kubelet has a token that may do little more than one thing: ask for a certificate. It makes a key pair and sends a CertificateSigningRequest for the name system:node:node-3 in group system:nodes. The controller manager's approver checks that the requester's group may ask for a node client certificate and approves it. Its signer signs it with the cluster CA. The kubelet downloads the certificate, writes a kubeconfig that uses it, and from now on is node-3.",
      facts: [
        ["AUTHENTICATES AS", `system:bootstrap:${TOKEN_ID}`],
        ["ASKS FOR", "CN system:node:node-3 · O system:nodes"],
        ["SIGNER", "kubernetes.io/kube-apiserver-client-kubelet"],
        ["VALID FOR", "1 year · the kubelet renews it itself"],
      ],
      view: "cluster",
      focus: ["api", "kcm", "node3", "node3-csr"],
      pods: { node3: [] },
      events: [
        ev({
          id: "nj9", at: 41000, src: K3, dst: API, layer: "api", size: "1.1 KB", title: "CERTIFICATESIGNINGREQUEST", path: ["node3", "api"],
          says: "The kubelet, using the bootstrap token, asks for a client certificate.",
          info: "POST /apis/certificates.k8s.io/v1/certificatesigningrequests",
          res: { "node3-csr": csr("Pending", "creating") },
          decoded: [
            sec("AUTHENTICATED AS", [["user", `system:bootstrap:${TOKEN_ID}`], ["groups", "system:bootstrappers · system:bootstrappers:kubeadm:default-node-token"]]),
            sec("SPEC", [["signerName", "kubernetes.io/kube-apiserver-client-kubelet", true], ["request", "subject CN=system:node:node-3, O=system:nodes"], ["usages", "digital signature · client auth"]]),
          ],
        }),
        ev({
          id: "nj10", at: 41100, src: KCM, dst: API, layer: "control", size: "0.4 KB", title: "APPROVED", path: ["kcm", "node3-csr"],
          says: "The approving controller sees a node client request from a bootstrapper, which RBAC allows, and approves it.",
          info: "csrapproving · condition Approved",
          res: { "node3-csr": csr("Approved") },
          decoded: [sec("APPROVING CONTROLLER", [["checks", "a SubjectAccessReview for the requester"], ["ClusterRole", "system:certificates.k8s.io:certificatesigningrequests:nodeclient"], ["ClusterRoleBinding", "kubeadm:node-autoapprove-bootstrap · group system:bootstrappers:kubeadm:default-node-token"], ["condition", "Approved · AutoApproved", true]])],
        }),
        ev({
          id: "nj11", at: 41200, src: KCM, dst: API, layer: "control", size: "1.6 KB", title: "SIGNED", path: ["kcm", "node3-csr"],
          says: "The signing controller signs it with the cluster CA and writes the certificate into the CSR's status.",
          info: "csrsigning · status.certificate",
          res: { "node3-csr": csr("Approved, Issued", "active") },
          decoded: [sec("SIGNING CONTROLLER", [["CA", "/etc/kubernetes/pki/ca.crt · ca.key"], ["status.certificate", "PEM, valid 1 year", true], ["from flags", "--cluster-signing-cert-file · --cluster-signing-duration"]])],
        }),
        ev({
          id: "nj12", at: 41500, src: API, dst: K3, layer: "api", size: "1.6 KB", title: "THE KUBELET HAS A NAME", path: ["api", "node3"],
          says: "The kubelet reads its certificate and switches to it. The bootstrap token is no longer used.",
          info: "/var/lib/kubelet/pki/kubelet-client-current.pem",
          decoded: [
            sec("WRITTEN", [["certificate", "/var/lib/kubelet/pki/kubelet-client-current.pem", true], ["kubeconfig", "/etc/kubernetes/kubelet.conf"], ["bootstrap-kubelet.conf", "deleted"]]),
            sec("FROM NOW ON", [["user", "system:node:node-3", true], ["groups", "system:nodes"], ["renewal", "a new CSR near expiry · approved as selfnodeclient"]]),
          ],
          note: "On EKS the kubelet doesn't use a bootstrap token: it authenticates with the instance's IAM role, which an access entry maps to system:nodes.",
        }),
      ],
    },
    {
      title: "REGISTER",
      subtitle: "a Node object, not Ready yet",
      body: "With its new identity, the kubelet creates the Node object node-3 with its capacity, addresses and labels, and starts renewing a Lease in kube-node-lease. The NodeRestriction admission plugin makes sure system:node:node-3 can only write node-3. The node isn't Ready: containerd has no network configuration yet, so the kubelet reports Ready=False. The controller manager reacts twice: its node lifecycle controller taints node-3 not-ready, and its node IPAM controller gives it a slice of the Pod network, 10.244.3.0/24.",
      facts: [
        ["NODE", "node-3 · Ready=False"],
        ["WHY", "container runtime network not ready"],
        ["TAINT", "node.kubernetes.io/not-ready · NoSchedule, NoExecute"],
        ["POD CIDR", "10.244.3.0/24 · from node IPAM"],
      ],
      view: "cluster",
      focus: ["api", "kcm", "node3"],
      events: [
        ev({
          id: "nj13", at: 42000, src: K3, dst: API, layer: "api", size: "3.2 KB", title: "CREATE NODE NODE-3", path: ["node3", "api"],
          says: "The kubelet registers node-3.",
          info: "POST /api/v1/nodes  node-3",
          decoded: [
            sec("NODE", [["metadata.name", "node-3", true], ["status.addresses", "InternalIP 10.0.1.13"], ["status.capacity", "cpu 4 · memory 16Gi · pods 110"]]),
            sec("CONDITIONS", [["Ready", "False", true], ["reason", "KubeletNotReady"], ["message", "container runtime network not ready: NetworkReady=false reason:NetworkPluginNotReady message:Network plugin returns error: cni plugin not initialized"]]),
            sec("NODERESTRICTION", [["system:node:node-3", "may write Node node-3 and its own Lease, nothing else"]]),
          ],
          note: "With an external cloud provider, the kubelet also adds node.cloudprovider.kubernetes.io/uninitialized, and the cloud controller manager removes it once it has filled in spec.providerID (aws:///eu-west-1a/" + INSTANCE + "). The autoscaler uses that ID to match the Node to its instance.",
        }),
        ev({
          id: "nj14", at: 42100, src: KCM, dst: API, layer: "control", size: "0.6 KB", title: "TAINT AND POD CIDR", path: ["kcm", "api"],
          says: "The controller manager taints node-3 not-ready and gives it the next free /24 of the Pod network.",
          info: "PATCH /api/v1/nodes/node-3  taints · spec.podCIDR=10.244.3.0/24",
          decoded: [
            sec("NODE LIFECYCLE CONTROLLER", [["Ready", "False"], ["spec.taints", "node.kubernetes.io/not-ready:NoSchedule · :NoExecute", true], ["effect", "ordinary Pods stay off until it's Ready"]]),
            sec("NODE IPAM", [["cluster CIDR", "10.244.0.0/16 · --cluster-cidr"], ["taken", "10.244.1.0/24 node-1 · 10.244.2.0/24 node-2"], ["spec.podCIDR", "10.244.3.0/24", true], ["enabled by", "--allocate-node-cidrs=true"]]),
          ],
        }),
        ev({
          id: "nj15", at: 42200, src: K3, dst: API, layer: "state", size: "0.2 KB", title: "THE FIRST LEASE", path: ["node3", "api"],
          says: "The kubelet creates its Lease and will renew it every 10 seconds from now on.",
          info: "kube-node-lease/node-3  renewTime",
          decoded: [sec("LEASE", [["holderIdentity", "node-3"], ["leaseDurationSeconds", "40"], ["renewed", "every 10 s", true]])],
        }),
      ],
    },
    {
      title: "DAEMONSETS ARRIVE",
      subtitle: "kube-proxy and flannel, then Ready",
      body: "The DaemonSet controller sees a new node and creates a kube-proxy Pod and a kube-flannel Pod for it. Both tolerate the not-ready taint, because they are what makes the node ready. flannel reads node-3's Pod CIDR, writes its subnet file and installs its CNI configuration in /etc/cni/net.d. containerd finds the configuration, its network is ready, and on its next status update the kubelet reports Ready=True. The controller manager lifts the not-ready taint.",
      facts: [
        ["NEW PODS", "kube-proxy-x7t2c · kube-flannel-ds-9wq4n"],
        ["THEY TOLERATE", "the not-ready taints"],
        ["CNI CONFIG", "/etc/cni/net.d/10-flannel.conflist"],
        ["NODE", "Ready=True · taint removed"],
      ],
      view: "cluster",
      focus: ["api", "kcm", "node3", "node2"],
      events: [
        ev({
          id: "nj16", at: 42300, src: KCM, dst: API, layer: "control", size: "4.0 KB", title: "PODS FOR NODE-3", path: ["kcm", "api"],
          says: "The DaemonSet controller creates one kube-proxy and one kube-flannel Pod for node-3.",
          info: "POST …/namespaces/kube-system/pods  kube-proxy-x7t2c · kube-flannel-ds-9wq4n",
          decoded: [sec("DAEMONSET CONTROLLER", [["kube-proxy", "desired 2 → 3", true], ["kube-flannel-ds", "desired 2 → 3", true], ["placed by", "node affinity on node-3's name"], ["tolerations", "every DaemonSet Pod tolerates not-ready:NoExecute · both also tolerate every NoSchedule taint"]])],
        }),
        ev({
          id: "nj17", at: 42400, src: API, dst: K3, layer: "control", size: "4.0 KB", title: "THE KUBELET STARTS THEM", path: ["api", "node3"],
          says: "node-3's kubelet sees both Pods. They use the host's network, so they need no CNI to start.",
          info: "WATCH ADDED Pod kube-flannel-ds-9wq4n · nodeName=node-3",
          pods: { node3: ["other", "other"] },
          decoded: [sec("HOST NETWORK", [["hostNetwork", "true", true], ["why it matters", "no Pod network yet · these Pods are the ones that set it up"]])],
        }),
        ev({
          id: "nj18", at: 52000, src: FLANNEL, dst: K3, layer: "node", size: " - ", title: "FLANNEL WRITES THE CNI CONFIG", path: ["node3", "node3"],
          says: "flannel takes node-3's Pod CIDR, writes its subnet file and installs the CNI configuration.",
          info: "/run/flannel/subnet.env · /etc/cni/net.d/10-flannel.conflist",
          decoded: [
            sec("SUBNET.ENV", [["FLANNEL_NETWORK", "10.244.0.0/16"], ["FLANNEL_SUBNET", "10.244.3.1/24", true], ["FLANNEL_IPMASQ", "true"]]),
            sec("ALSO", [["flannel.1", "VXLAN device · 10.244.3.0"], ["routes", "10.244.1.0/24 via node-1 · 10.244.2.0/24 via node-2"], ["node-1 and node-2", "add a route to 10.244.3.0/24 via node-3"]]),
          ],
        }),
        ev({
          id: "nj19", at: 56000, src: K3, dst: API, layer: "api", size: "1.4 KB", title: "READY", path: ["node3", "api"],
          says: "containerd reports its network ready, and the kubelet reports node-3 Ready.",
          info: "PATCH /api/v1/nodes/node-3/status  Ready=True",
          decoded: [sec("CONDITIONS", [["Ready", "False → True", true], ["reason", "KubeletReady"], ["message", "kubelet is posting ready status"]])],
        }),
        ev({
          id: "nj20", at: 56300, src: KCM, dst: API, layer: "control", size: "0.3 KB", title: "TAINT LIFTED", path: ["kcm", "api"],
          says: "The node lifecycle controller sees Ready=True and removes the not-ready taint.",
          info: "PATCH /api/v1/nodes/node-3  remove node.kubernetes.io/not-ready",
          decoded: [sec("NODE LIFECYCLE CONTROLLER", [["Ready", "True"], ["spec.taints", "both not-ready taints removed", true], ["node-3", "open for ordinary Pods"]])],
        }),
      ],
    },
    {
      title: "THE POD LANDS",
      subtitle: "a changed Node wakes the queue",
      body: "The scheduler watches Nodes too. node-3's update is the kind of event that could help a Pod that failed for lack of CPU, so the scheduler moves the waiting Pod back to its active queue. This time node-3 passes every filter, with nearly four CPUs free, and the scheduler binds the Pod there. node-3's kubelet pulls the image, starts the container, and once the readiness probe passes the Pod joins the Service's endpoints.",
      facts: [
        ["REQUEUED BY", "a Node update · NodeResourcesFit says it may help"],
        ["BOUND TO", "node-3"],
        ["POD IP", "10.244.3.2"],
        ["PENDING TO READY", "≈ 70 s in this run"],
      ],
      view: "cluster",
      focus: ["api", "sched", "node3"],
      events: [
        ev({
          id: "nj21", at: 56400, src: API, dst: SCHED, layer: "control", size: "3.2 KB", title: "NODE-3 CHANGED", path: ["api", "sched"],
          says: "The scheduler's Node watch delivers node-3's update, and the waiting Pod goes back in the queue.",
          info: "WATCH MODIFIED Node node-3 · Ready, no taints",
          decoded: [sec("QUEUE", [["event", "Node updated"], ["NodeResourcesFit hint", "Queue · this could make the Pod fit", true], [NEW_POD, "unschedulable → active"]])],
        }),
        ev({
          id: "nj22", at: 56450, src: SCHED, dst: API, layer: "api", size: "0.3 KB", title: "BIND TO NODE-3", path: ["sched", "api"],
          says: "node-3 has room. The scheduler binds the Pod to it.",
          info: `POST …/pods/${NEW_POD}/binding  target node-3`,
          pods: { node3: ["other", "other", "starting"] },
          decoded: [sec("FILTER", [["node-1", "Insufficient cpu"], ["node-2", "Insufficient cpu"], ["node-3", "3.7 CPU free ✓", true]]), sec("BINDING", [["target.name", "node-3", true]])],
        }),
        ev({
          id: "nj23", at: 56500, src: API, dst: K3, layer: "control", size: "2.4 KB", title: "THE FIRST APP POD", path: ["api", "node3"],
          says: "node-3's kubelet picks up its first application Pod.",
          info: `WATCH MODIFIED Pod ${NEW_POD} · nodeName=node-3`,
          decoded: [sec("ON NODE-3", [["sandbox", "IP 10.244.3.2 from flannel's subnet", true], ["image", "not on this node yet · pulled now"]])],
          note: "A new node has none of your images. The first Pod of each image on it waits for a full pull, which is often the longest part of the start.",
        }),
        ev({
          id: "nj24", at: 70000, src: K3, dst: API, layer: "api", size: "1.4 KB", title: "RUNNING AND READY", path: ["node3", "api"],
          says: "The container is up and its readiness probe passes.",
          info: `PATCH …/pods/${NEW_POD}/status  Ready=True`,
          pods: { node3: ["other", "other", "v1"] },
          decoded: [sec("STATUS", [["phase", "Running"], ["Ready", "True", true], ["EndpointSlice", "10.244.3.2:8080 added to web"]])],
        }),
      ],
    },
    {
      title: "AND BACK DOWN",
      subtitle: "unneeded, drained, terminated",
      body: "Traffic falls and you scale web back to three. The ReplicaSet removes the newest Pod, which is the one on node-3. Now node-3 runs only DaemonSet Pods and its requests are far below half its capacity. The autoscaler counts it unneeded, and after 10 minutes of that, removes it: it taints the node so nothing new lands there, evicts what is left through the Eviction API, which respects PodDisruptionBudgets, and asks AWS to terminate the instance and shrink the group.",
      facts: [
        ["UNNEEDED WHEN", "requests < 50% and its Pods can move"],
        ["WAIT", "10 min · --scale-down-unneeded-time"],
        ["DRAIN", "Eviction API · PodDisruptionBudgets respected"],
        ["GROUP", "desired capacity 3 → 2"],
      ],
      view: "cluster",
      focus: ["you", "api", "node1", "node3", "cloud"],
      events: [
        ev({
          id: "nj25", at: 900000, src: "kubectl", dst: API, layer: "api", size: "0.2 KB", title: "SCALE TO THREE", path: ["you", "api"],
          says: "You scale web back to three. The Pod on node-3 is the youngest, so it goes.",
          info: "kubectl scale deployment web --replicas=3",
          pods: { node3: ["other", "other"] },
          decoded: [sec("REPLICASET", [["deletes", `${NEW_POD} · the newest`, true], ["node-3 left with", "kube-proxy · kube-flannel"]])],
        }),
        ev({
          id: "nj26", at: 1500000, src: CA, dst: API, layer: "drop", size: "0.4 KB", title: "UNNEEDED FOR 10 MINUTES", path: ["node1", "api"],
          says: "node-3 has been unneeded for 10 minutes. The autoscaler taints it and evicts what's left.",
          info: "taint node-3 · evict non-DaemonSet Pods",
          decoded: [
            sec("NODE-3", [["requests", "≈ 6% of CPU · below the 0.5 threshold", true], ["unneeded since", "10 min ago"], ["Pods to move", "none · only DaemonSet Pods"]]),
            sec("DRAIN", [["taint", "keeps new Pods off"], ["evictions", "POST …/pods/<name>/eviction · respects PodDisruptionBudgets"], ["DaemonSet Pods", "left alone"]]),
          ],
          note: "An eviction that would take a PodDisruptionBudget below its minimum gets 429 Too Many Requests, and the autoscaler leaves the node alone and tries again later.",
        }),
        ev({
          id: "nj27", at: 1500500, src: CA, dst: AWS, layer: "net", size: "0.5 KB", title: "TERMINATE THE INSTANCE", path: ["node1", "cloud"],
          says: "The autoscaler terminates node-3's instance and lowers the group's desired capacity in the same call.",
          info: `autoscaling:TerminateInstanceInAutoScalingGroup ${INSTANCE} · decrement`,
          decoded: [sec("AWS API", [["InstanceId", INSTANCE], ["ShouldDecrementDesiredCapacity", "true", true], ["group", `${ASG} · 3 → 2`]])],
        }),
        ev({
          id: "nj28", at: 1560000, src: AWS, dst: K3, layer: "drop", size: " - ", title: "NODE-3 IS GONE", path: ["cloud", "node3"],
          says: "The instance shuts down. Once it is gone from AWS, its Node object is deleted too.",
          info: `${INSTANCE} terminated · Node node-3 deleted`,
          pods: { node3: undefined },
          decoded: [sec("AFTERWARDS", [["instance", "terminated", true], ["Node node-3", "deleted by the cloud controller manager"], ["Lease", "deleted with the Node"], ["10.244.3.0/24", "free for the next node"]])],
          note: "Karpenter does the same with consolidation: it looks for nodes it can remove or replace with cheaper ones, taints them karpenter.sh/disrupted:NoSchedule, and drains them through the Eviction API.",
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "Pod Unschedulable", layer: "control", start: 0, duration: 90 },
    { value: "t2", label: "autoscaler scan → AWS", layer: "control", start: 90, duration: 8110 },
    { value: "t3", label: "instance boots", layer: "net", start: 9000, duration: 31000 },
    { value: "t4", label: "TLS bootstrap", layer: "api", start: 40000, duration: 1500 },
    { value: "t5", label: "register, Pod CIDR, lease", layer: "api", start: 42000, duration: 200 },
    { value: "t6", label: "flannel → Ready", layer: "node", start: 42300, duration: 14000 },
    { value: "t7", label: "bind, pull, Ready", layer: "node", start: 56400, duration: 13600 },
  ],
  timingNote: "Times from one illustrative run. Boot time depends on the image and instance type, and the image pull on the image's size; the scale-down waits are the autoscaler's defaults.",
  summary: {
    title: "A MACHINE BECOMES A NODE",
    body: "No component creates nodes inside Kubernetes. The autoscaler only asks the cloud for a machine when a Pod is Unschedulable. The machine proves itself with a short-lived bootstrap token, trades it for a certificate the cluster signs, registers a Node and stays NotReady until its DaemonSets set up the network. Then the scheduler's queue, woken by the changed Node, places the waiting Pod. Scaling down runs the other way: unneeded, drained, terminated.",
    facts: [
      ["TRIGGER", "a Pod marked Unschedulable"],
      ["IDENTITY", "bootstrap token → CSR → system:node:node-3"],
      ["READY WHEN", "the CNI config is in place"],
      ["NEXT", "Backing up and restoring etcd"],
    ],
  },
}
