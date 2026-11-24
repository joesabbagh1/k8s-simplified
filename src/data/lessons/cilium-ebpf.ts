import type { Lesson } from "../types"
import { ev, layer, sec } from "./helpers"

const API_POD = "api-…-7d9fk"
const KQ9TW = "web-…-kq9tw"
const BUSYBOX = "busybox-…-c4t2m"

export const ciliumEbpf: Lesson = {
  id: "cilium-ebpf",
  title: "Cilium and eBPF",
  subtitle: "Identity instead of IPs",
  category: "network",
  seo: {
    title: "Cilium and eBPF in Kubernetes",
    description: "How Cilium replaces flannel, Calico and kube-proxy in a Kubernetes cluster with eBPF programs in each node's kernel, and identities instead of IPs.",
  },
  actors: ["you", "cp", "node1", "node2"],
  pods: { node1: ["other", "other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    kubectl: "you",
    "cilium-agent · node-1": "node-1", "cilium-agent · node-2": "node-2", "kubelet · node-1": "node-1",
    "kernel · node-1": "node-1", "kernel · node-2": "node-2",
    "containerd · node-1": "node-1", "tc egress bpf · kq9tw veth": "node-1",
    "ipcache · node-1": "node-1", "ipcache · node-2": "node-2",
    "cilium_geneve · node-1": "node-1", "cilium_geneve · node-2": "node-2",
    "eth0 · node-1": "node-1", "iptables · node-1": "node-1",
    "bpf · node-2": "node-2", "bpf_lxc · api veth": "node-2",
    "policy map · api veth": "node-2", "connect4 bpf · node-1": "node-1",
    [KQ9TW]: "Pod kq9tw", [API_POD]: "api Pod", [BUSYBOX]: "busybox Pod",
  },
  overview: {
    body: "The same cluster, its network rebuilt on Cilium: flannel, Calico and kube-proxy replaced by one DaemonSet and a set of eBPF programs loaded into each node's kernel. Pods keep plain IPs and the tunnel still costs its bytes per packet - what changes is who enforces policy (maps, not chains) and what a packet carries: the Pod's labels, as a number, ride along with it.",
    facts: [
      ["REPLACES", "flannel · Calico · kube-proxy"],
      ["DATA PATH", "eBPF at every veth · maps, not iptables chains"],
      ["IDENTITY", "labels → a number · rides the tunnel"],
      ["TUNNEL", "Geneve · UDP 6081 · +50 B, like VXLAN"],
    ],
  },
  steps: [
    {
      title: "NEW PLUMBING",
      subtitle: "one DaemonSet, two kernels reprogrammed",
      body: "This cluster grew up on flannel for connectivity, Calico for policy and kube-proxy for Services. Rebuilt on Cilium, all three go: one cilium-agent Pod per node, and a set of eBPF programs the agent compiles and loads into each kernel. An eBPF program is a small, verified piece of code the kernel runs on an event - here, on every packet that crosses a Pod's veth. The agent does the watching and the writing; the programs do the forwarding, the rewriting and the dropping. kube-proxy was deleted outright.",
      facts: [
        ["REMOVED", "flannel · calico · kube-proxy"],
        ["ADDED", "cilium-agent DaemonSet · 1 per node"],
        ["IN THE KERNEL", "eBPF at every veth · the tunnel device"],
        ["PODS NOTICE", "nothing · same IPs, same Services"],
      ],
      view: "cluster",
      focus: ["you", "api", "etcd", "node1", "node2"],
      events: [
        ev({
          id: "ce1", at: 0, src: "kubectl", dst: "kube-apiserver", layer: "api", size: "1.4 KB", title: "INSTALL CILIUM", path: ["you", "api"],
          says: "You install one thing: a DaemonSet that puts an agent on every node.",
          info: "POST /apis/apps/v1/namespaces/kube-system/daemonsets",
          decoded: [
            sec("BODY · DAEMONSET", [["image", "quay.io/cilium/cilium:v1.17.1"], ["kubeProxyReplacement", "true", true], ["tunnel", "geneve · port 6081"], ["watches", "Pods · Services · policies · identities"]]),
          ],
        }),
        ev({
          id: "ce2", at: 2, src: "kube-apiserver", dst: "etcd", layer: "state", size: "1.1 KB", title: "STORED", path: ["api", "etcd"],
          says: "The DaemonSet is stored, and the usual machinery starts one agent Pod per node.",
          info: "Txn put /registry/daemonsets/kube-system/cilium",
          decoded: [
            sec("ETCD", [["key", "/registry/daemonsets/kube-system/cilium"], ["revision", "52310", true], ["result", "one cilium-agent Pod on every node"]]),
          ],
        }),
        ev({
          id: "ce3", at: 4, src: "kube-apiserver", dst: "cilium-agent · node-1", layer: "control", size: "0.9 KB", title: "AGENT UP · NODE-1", path: ["api", "node1"],
          says: "node-1's agent starts in the host network namespace and opens its watches.",
          info: "cilium-agent · host netns · health :9879",
          decoded: [
            sec("THE AGENT", [["Pod", "cilium-…-t8xwq · runs privileged"], ["watches", "Pods · Services · NetworkPolicies · identities"], ["never touches", "a single packet in flight"]]),
          ],
        }),
        ev({
          id: "ce4", at: 4.5, src: "kube-apiserver", dst: "cilium-agent · node-2", layer: "control", size: "0.9 KB", title: "AGENT UP · NODE-2", path: ["api", "node2"],
          says: "node-2's agent does the same, independent of its neighbor.",
          info: "cilium-agent · host netns · watches open",
          decoded: [
            sec("NO MIDDLE LAYER", [["per node", "its own agent, its own maps"], ["shared via", "the API - nothing else"], ["flannel · calico", "not running", true]]),
          ],
        }),
        ev({
          id: "ce5", at: 6, src: "cilium-agent · node-1", dst: "kernel · node-1", layer: "node", size: " - ", title: "BPF LOADED", path: ["node1", "node1"],
          says: "The agent compiles the datapath and loads it: programs at every veth, a tunnel device, and a fistful of maps.",
          info: "bpf load · tc attach · maps pinned at /sys/fs/bpf",
          decoded: [
            sec("WHAT GOT LOADED", [["bpf_lxc", "per-Pod programs · attached at each veth", true], ["tunnel bpf", "wrap and unwrap on the geneve device"], ["maps", "ipcache · policy · services · conntrack"]]),
          ],
          note: "The programs are verified by the kernel's BPF verifier before they ever run: they must terminate, must not crash, must only touch map memory. Then they run on every packet, in kernel space, at nanosecond cost.",
        }),
        ev({
          id: "ce6", at: 8, src: "cilium-agent · node-2", dst: "kernel · node-2", layer: "node", size: " - ", title: "SAME ON NODE-2", path: ["node2", "node2"],
          says: "node-2 gets the same programs - and loses its old plumbing.",
          info: "bpf load · cilium_geneve replaces flannel.1",
          decoded: [
            sec("THE SWAP, COMPLETE", [["programs", "same objects, same maps structure"], ["kube-proxy's tables", "gone - nothing rewrites Services", true], ["flannel.1", "gone - cilium_geneve in its place", true]]),
          ],
        }),
      ],
    },
    {
      title: "AN IDENTITY, NOT AN IP",
      subtitle: "labels become the number 15361",
      body: "web-…-kq9tw starts on node-1 and containerd calls the CNI plugin as always - except the plugin, cilium-cni, hands the work to the agent. The agent wires the veth and does something flannel never did: it gives the Pod's set of labels a number. If any Pod in the cluster already has exactly these labels, it reuses that number; if not, it allocates a new one. For app=web the number is 15361. The identity, not the IP, is what policy will be written against. The agent records the pairing in a map every program can read: 10.244.1.12 → identity 15361, reachable over the tunnel at 10.0.1.11.",
      facts: [
        ["CNI ADD", "veth · IP 10.244.1.12 · bpf attached"],
        ["IDENTITY", "app=web → 15361 · one number per label set"],
        ["WRITTEN", "ipcache: IP → identity → tunnel endpoint"],
        ["SHARED", "every agent learns it via the API"],
      ],
      view: "node1",
      focus: ["n1.api", "n1.containerd", "n1.cni0", "n1.podA"],
      events: [
        ev({
          id: "ce7", at: 20, src: "kube-apiserver", dst: "kubelet · node-1", layer: "control", size: "0.8 KB", title: "THE USUAL BEGINNING", path: ["n1.api", "n1.kubelet"],
          says: "The kubelet sees the new Pod and asks for a sandbox, as in every lesson before.",
          info: "WATCH ADDED Pod web-…-kq9tw · node-1",
          decoded: [
            sec("SAME ROAD AS EVER", [["kubelet", "create sandbox"], ["containerd", "calls CNI ADD"], ["the plugin", "cilium-agent - not flannel", true]]),
          ],
        }),
        ev({
          id: "ce8", at: 22, src: "containerd · node-1", dst: "cilium-agent · node-1", layer: "node", size: " - ", title: "CNI ADD", path: ["n1.kubelet", "n1.containerd"],
          says: "containerd invokes the CNI plugin - which is now the agent itself.",
          info: "CNI ADD · netns /var/run/netns/cni-8f31…",
          decoded: [
            sec("WIRING", [["veth", "lxc3a1f ⇄ eth0 · into the Pod's netns"], ["addr", "10.244.1.12/32 · routes, no bridge subnet", true], ["bpf_lxc", "attached to the veth, both directions"]]),
          ],
        }),
        ev({
          id: "ce9", at: 24, src: "cilium-agent · node-1", dst: "cilium-agent · node-1", layer: "control", size: " - ", title: "IDENTITY 15361", path: ["n1.containerd", "n1.containerd"],
          says: "The labels get a number - identity 15361. Policy will be checked against this, never against IPs.",
          info: "label set → existing identity? none → allocate 15361",
          decoded: [
            sec("IDENTITY 15361", [["labels", "k8s:app=web · k8s:io.kubernetes.pod.namespace=default"], ["allocated", "first agent to see this label set creates it", true], ["the number", "arbitrary - the labels define it"], ["ipcache", "10.244.1.12 → 15361 → tunnel 10.0.1.11"]]),
          ],
          note: "The number is shared, not recomputed: every agent finds it through the CiliumIdentity object. Two Pods labelled app=web on different nodes share 15361 without ever meeting.",
        }),
        ev({
          id: "ce10", at: 26, src: "cilium-agent · node-1", dst: "kube-apiserver", layer: "api", size: "0.4 KB", title: "SHARED, NOT SYNCED", path: ["n1.containerd", "n1.api"],
          says: "The identity is posted to the API, and every other agent's watch delivers it.",
          info: "POST /apis/cilium.io/v2/ciliumidentities · name 15361",
          decoded: [
            sec("CILIUMIDENTITY", [["object", "15361 · labels app=web"], ["consumers", "every agent's watch"], ["node-2 learns", "10.244.1.12 → 15361 → via 10.0.1.11", true]]),
          ],
        }),
      ],
    },
    {
      title: "POLICY IN A MAP",
      subtitle: "the allow-list, keyed by identity",
      body: "The NetworkPolicy from the last lesson still exists, unchanged - app:api allows ingress from app:web on TCP 8080. Calico translated those labels into IP sets and iptables chains on every node. The agent on node-2 does something smaller: it computes the verdict table for the api Pod's veth - identity 15361 → TCP 8080 → allow - and writes it into one BPF map. The kernel does the rest.",
      facts: [
        ["SAME POLICY", "app:api · ingress from app:web · 8080"],
        ["CALICO DID", "labels → IP sets → iptables chains"],
        ["CILIUM DOES", "labels → identity → one map entry"],
        ["COST", "one map write · no chain rebuild"],
      ],
      view: "node2",
      focus: ["n2.api", "n2.cni0"],
      events: [
        ev({
          id: "ce11", at: 40, src: "kube-apiserver", dst: "cilium-agent · node-2", layer: "control", size: "1.0 KB", title: "WATCH: THE SAME POLICY", path: ["n2.api", "n2.cni0"],
          says: "node-2's agent hears about the same policy and compiles its half of it.",
          info: "WATCH ADDED NetworkPolicy api-allow-web",
          decoded: [
            sec("WHAT THE AGENT COMPUTES", [["endpoint", `${API_POD} · 10.244.2.19`], ["allow", "identity 15361 · TCP 8080", true], ["everything else", "default deny"]]),
          ],
        }),
        ev({
          id: "ce12", at: 42, src: "cilium-agent · node-2", dst: "policy map · api veth", layer: "node", size: " - ", title: "ONE ENTRY IN A MAP", path: ["n2.cni0", "n2.cni0"],
          says: "The whole policy becomes one entry in a map beside the api Pod's veth.",
          info: "map update cilium_policy_… · key (15361, TCP, 8080) = ALLOW",
          decoded: [
            sec("THE MAP · NOT A CHAIN", [["key", "src identity 15361 · TCP · 8080"], ["value", "ALLOW", true], ["lookup cost", "one hash - O(1), always"], ["when Pod IPs change", "nothing to rewrite"]]),
          ],
        }),
        ev({
          id: "ce13", at: 44, src: "kube-apiserver", dst: "cilium-agent · node-2", layer: "control", size: "0.8 KB", title: "A FOURTH WEB POD", path: ["n2.api", "n2.cni0"],
          says: "A fourth web Pod appears on node-1 - and node-2's kernel doesn't change at all.",
          info: "WATCH ADDED Pod web-…-q7d2h · node-1",
          pods: { node1: ["other", "other", "v1", "starting"] },
          decoded: [
            sec("THE CALICO QUESTION", [["calico would", "add 10.244.1.31 to IP sets on every node"], ["cilium", "same labels → same identity 15361 - already allowed", true], ["node-2 kernel", "unchanged"]]),
          ],
        }),
        ev({
          id: "ce14", at: 46, src: "cilium-agent · node-2", dst: "ipcache · node-2", layer: "node", size: " - ", title: "THE ONLY WRITE", path: ["n2.cni0", "n2.cni0"],
          says: "The only write anywhere is a routing fact: this new IP also belongs to 15361.",
          info: "ipcache += 10.244.1.31/32 → 15361 → tunnel 10.0.1.11",
          pods: { node1: ["other", "other", "v1", "v1"] },
          decoded: [
            sec("WHAT CHANGED", [["map touched", "ipcache - one prefix added", true], ["policy map", "untouched"], ["iptables", "not consulted"]]),
          ],
        }),
      ],
    },
    {
      title: "OUT THROUGH THE VETH",
      subtitle: "egress verdict, then Geneve",
      body: "kq9tw curls the api Pod directly, as in the policy lesson: 10.244.1.12 → 10.244.2.19:8080. The SYN leaves the container and the first thing it meets is not a bridge port but the agent's program on the veth. It checks egress - no egress policy selects kq9tw, allow - then asks the ipcache about the destination: 10.244.2.19 is identity 16001, on the far side of the tunnel. So the program hands the packet to the cilium_geneve device for the trip: Geneve this time, UDP 6081. The 24-bit network ID in the header, which flannel set to 1 for every packet, now carries kq9tw's own identity: 15361.",
      facts: [
        ["CALL", "10.244.1.12 → 10.244.2.19:8080"],
        ["EGRESS", "no policy selects kq9tw → allow"],
        ["IPCACHE SAYS", "10.244.2.19 → identity 16001 · via 10.0.1.12"],
        ["WRAPPER", "Geneve 6081 · +50 B · VNI = src identity 15361"],
      ],
      view: "node1",
      focus: ["n1.podA", "n1.cni0", "n1.flannel", "n1.eth0"],
      events: [
        ev({
          id: "ce15", at: 60, src: KQ9TW, dst: "tc egress bpf · kq9tw veth", layer: "net", size: "74 B", title: "FIRST STOP: THE VETH", path: ["n1.podA", "n1.cni0"],
          says: "The SYN's first stop is a program on the veth - not a bridge port, not an iptables chain.",
          info: "SYN 10.244.1.12:41244 → 10.244.2.19:8080",
          decoded: [
            sec("TC EGRESS", [["who", "bpf_lxc · attached by the agent"], ["egress lookup", "no egress policy → allow"], ["then", "ask the ipcache about the destination", true]]),
          ],
        }),
        ev({
          id: "ce16", at: 60.01, src: "ipcache · node-1", dst: "ipcache · node-1", layer: "net", size: " - ", title: "WHERE IS 10.244.2.19", path: ["n1.cni0", "n1.flannel"],
          says: "The map answers in one lookup: that address is identity 16001, across the tunnel on node-2.",
          info: "lookup 10.244.2.19/32 → (16001, tunnel 10.0.1.12)",
          decoded: [
            sec("IPCACHE", [["prefix", "10.244.2.19/32"], ["identity", "16001 · app=api"], ["tunnel endpoint", "10.0.1.12 · node-2", true], ["encap", "set by this program · done by cilium_geneve"]]),
          ],
        }),
        ev({
          id: "ce17", at: 60.02, src: "cilium_geneve · node-1", dst: "cilium_geneve · node-1", layer: "net", size: "124 B", title: "WRAPPED - WITH A LABEL", path: ["n1.flannel", "n1.flannel"],
          says: "The packet is wrapped in Geneve, and the header's network ID is kq9tw's identity.",
          info: "Geneve · VNI 15361 = the sender's identity",
          frame: [
            layer("Ethernet", "outer MACs · toward node-2", 14), layer("IPv4", "10.0.1.11 → 10.0.1.12", 20), layer("UDP", "→ 6081", 8), layer("Geneve", "VNI 15361 · src identity", 8),
            layer("Ethernet", "inner MACs", 14, true), layer("IPv4", "10.244.1.12 → 10.244.2.19", 20, true), layer("TCP", "41244 → 8080 [SYN]", 40, true),
          ],
          decoded: [
            sec("THE VNI", [["VNI", "15361 · the sender's identity, in the header", true], ["wrapper total", "50 B · IP 20 + UDP 8 + Geneve 8 + inner Eth 14"], ["MTU", "Pod interfaces 1450 · sized at CNI time"]]),
          ],
          note: "The tunnel tax is flannel's 50 bytes exactly. What changed is one field: flannel's VNI said \"this cluster\"; Cilium's says \"this Pod's labels\", so the packet introduces itself wherever it goes.",
        }),
        ev({
          id: "ce18", at: 60.05, src: "cilium_geneve · node-1", dst: "eth0 · node-1", layer: "net", size: "124 B", title: "HANDED TO ETH0", path: ["n1.flannel", "n1.eth0"],
          says: "To the underlay it's one ordinary UDP packet - port 6081 instead of 8472, nothing else new.",
          info: "UDP 10.0.1.11:44123 → 10.0.1.12:6081",
          decoded: [
            sec("WHAT ETH0 SEES", [["src", "10.0.1.11:44123"], ["dst", "10.0.1.12:6081"], ["payload", "opaque - Geneve + inner packet"]]),
          ],
        }),
      ],
    },
    {
      title: "ACROSS THE UNDERLAY",
      subtitle: "one UDP packet, carrying a number",
      body: "One plain UDP packet between the two nodes. Everything Cilium computed - verdict, tunnel, identity - travels inside it; the network between the nodes learns nothing. Routers between the nodes only read the outer header, exactly as under flannel. The difference is the number in the VNI field.",
      facts: [
        ["UNDERLAY SEES", "10.0.1.11 ⇄ 10.0.1.12 · UDP 6081"],
        ["VNI", "15361 · the sender's identity"],
        ["INSIDE", "10.244.1.12 → 10.244.2.19 · SYN"],
        ["WRAPPER", "50 B · same as flannel"],
      ],
      view: "cluster",
      focus: ["node1", "node2"],
      events: [
        ev({
          id: "ce19", at: 60.3, src: "node-1", dst: "node-2", layer: "net", size: "124 B", title: "ONE ORDINARY UDP PACKET", path: ["node1", "node2"],
          says: "One UDP packet crosses the underlay, carrying the sender's identity in its 24-bit VNI.",
          info: "10.0.1.11:44123 → 10.0.1.12:6081 · transit ≈ 0.29 ms",
          frame: [
            layer("Ethernet", "outer MACs", 14), layer("IPv4", "10.0.1.11 → 10.0.1.12", 20), layer("UDP", "44123 → 6081", 8), layer("Geneve", "VNI 15361 · src identity", 8),
            layer("Ethernet", "inner MACs", 14, true), layer("IPv4", "10.244.1.12 → 10.244.2.19", 20, true), layer("TCP", "41244 → 8080 [SYN]", 40, true),
          ],
          decoded: [
            sec("OUTER (ALL THE UNDERLAY SEES)", [["src", "10.0.1.11 · node-1"], ["dst", "10.0.1.12:6081 · node-2"], ["VNI", "15361 - a label set, as a number", true]]),
            sec("INNER (HIDDEN PAYLOAD)", [["src", "10.244.1.12:41244"], ["dst", "10.244.2.19:8080"], ["visible outside a node", "never"]]),
          ],
        }),
      ],
    },
    {
      title: "THE VERDICT ON ARRIVAL",
      subtitle: "one lookup, by identity",
      body: "node-2's tunnel program unwraps the packet and reads the VNI: source identity 15361. It doesn't ask the API server, an IP set, or any other node - the label came with the packet. One more hop to the api Pod's veth, where the program does the entire policy check: look up (identity 15361, TCP, 8080) in the map. The entry says ALLOW. The SYN crosses into the Pod's namespace about 0.4 ms after connect().",
      facts: [
        ["FROM THE VNI", "src identity 15361 · no lookup needed"],
        ["THE CHECK", "map[(15361, TCP, 8080)] → ALLOW"],
        ["COST", "one hash lookup · no rule walk"],
        ["DELIVERED", "≈ 0.4 ms after connect()"],
      ],
      view: "node2",
      focus: ["n2.flannel", "n2.cni0"],
      events: [
        ev({
          id: "ce20", at: 60.35, src: "cilium_geneve · node-2", dst: "bpf · node-2", layer: "net", size: "74 B", title: "UNWRAP, READ THE LABEL", path: ["n2.flannel", "n2.flannel"],
          says: "The tunnel program unwraps and reads the identity straight out of the VNI.",
          info: "decap · VNI → src identity 15361",
          decoded: [
            sec("UNWRAP", [["wrapper", "popped · 50 B"], ["VNI", "src identity 15361 → kept with the packet", true], ["asked anyone", "no one - the label travelled with the packet"]]),
          ],
        }),
        ev({
          id: "ce21", at: 60.4, src: "bpf_lxc · api veth", dst: "bpf_lxc · api veth", layer: "net", size: " - ", title: "THE WHOLE POLICY CHECK", path: ["n2.flannel", "n2.cni0"],
          says: "At the api Pod's veth, the entire policy is one lookup - and the entry says allow.",
          info: "map lookup (15361, TCP, 8080) → ALLOW",
          decoded: [
            sec("MAP LOOKUP", [["key", "identity 15361 · TCP · 8080"], ["value", "ALLOW", true], ["rules walked", "none - hash in, verdict out"], ["had the map been empty", "default deny"]]),
          ],
        }),
        ev({
          id: "ce22", at: 60.5, src: "bpf_lxc · api veth", dst: API_POD, layer: "net", size: "74 B", title: "INTO THE POD", path: ["n2.cni0", "n2.podB"],
          says: "The SYN crosses into the Pod and the connection begins - indistinguishable from the flannel cluster.",
          info: "SYN on eth0 in the netns · client 10.244.1.12:41244",
          decoded: [
            sec("THE APP SEES", [["packet", "plain · from a neighbor at 10.244.1.12"], [API_POD, "accepts · :8080", true], ["elapsed", "≈ 0.4 ms - same ballpark as VXLAN"]]),
          ],
        }),
        ev({
          id: "ce23", at: 60.8, src: API_POD, dst: KQ9TW, layer: "net", size: "74 B", title: "SYN-ACK, LABELED TOO", path: ["n2.podB", "n2.cni0"],
          says: "The SYN-ACK rides back with api's own identity in the VNI.",
          info: "wrap · VNI 16001 → node-1",
          decoded: [
            sec("THE REPLY", [["wrap", "same, reversed"], ["VNI", "api's identity 16001"], ["on node-1", "the same one lookup - egress this time", true]]),
          ],
        }),
      ],
    },
    {
      title: "THE DROP, REDISCOVERED",
      subtitle: "a map miss, not a chain",
      body: "busybox tries the same call - and its labels map to identity 46321, which no rule mentions. The trip is identical until the last lookup: map[(46321, TCP, 8080)] isn't there. No rule matched, nothing fell through - the miss itself is the verdict, the default deny. The SYN dies at the veth, before the Pod's namespace; TCP retransmits, curl times out. The same silence as the Calico drop, arrived at without a single iptables chain.",
      facts: [
        ["SOURCE", "busybox · identity 46321 · no rule mentions it"],
        ["LOOKUP", "(46321, TCP, 8080) → not found"],
        ["VERDICT", "DROP at the veth · before the netns"],
        ["COST OF THE MISS", "the same one hash lookup"],
      ],
      view: "node2",
      focus: ["n2.flannel", "n2.cni0"],
      events: [
        ev({
          id: "ce24", at: 70, src: "cilium_geneve · node-2", dst: "bpf_lxc · api veth", layer: "net", size: "124 B", title: "SAME ROAD, OTHER NUMBER", path: ["n2.flannel", "n2.cni0"],
          says: "busybox's SYN takes the identical road, carrying a different number.",
          info: "SYN 10.244.1.30:42322 → 10.244.2.19:8080 · VNI 46321",
          decoded: [
            sec("SO FAR IDENTICAL", [["wrapper", "same 50 B"], ["VNI", "identity 46321 · busybox's labels", true], ["different so far", "nothing"]]),
          ],
        }),
        ev({
          id: "ce25", at: 70.1, src: "bpf_lxc · api veth", dst: "bpf_lxc · api veth", layer: "net", size: " - ", title: "THE MISS IS THE VERDICT", path: ["n2.cni0", "n2.cni0"],
          says: "The lookup misses. In a map, that is the whole verdict.",
          info: "map lookup (46321, TCP, 8080) → not found → default deny",
          decoded: [
            sec("MAP LOOKUP", [["key", "identity 46321 · TCP · 8080"], ["value", "none - the key isn't in the map", true], ["default", "deny"], ["rule walk", "there was no list to walk"]]),
          ],
        }),
        ev({
          id: "ce26", at: 70.2, src: "bpf_lxc · api veth", dst: "bpf_lxc · api veth", layer: "drop", size: " - ", title: "DROP", path: ["n2.cni0", "n2.cni0"],
          says: "The packet dies at the veth, and the app hears silence until curl gives up.",
          info: "DROP ×3 · SYN retried, all dropped",
          decoded: [
            sec("COUNTERS", [["map counter", "[pkts: 3 · bytes: 180]", true], ["delivered to the Pod", "0 packets"], ["curl reports", "timeout - not refused"]]),
          ],
          note: "Calico spent chains and IP-set rewrites to reach this silence; here it costs one hash miss. What the app sees is identical: nothing.",
        }),
      ],
    },
    {
      title: "SERVICES WITHOUT KUBE-PROXY",
      subtitle: "the rewrite happens in the socket",
      body: "One kube-proxy job is left: turning Service addresses into Pod addresses. With kube-proxy deleted, the agent's programs do it, and the cleverest one isn't on any network device. When busybox connects to the web Service - 10.96.120.15:80 - a BPF hook on the connect() call itself looks up the backends, picks one at random - this time web-…-kq9tw, which happens to be on this node - and rewrites the socket's destination to 10.244.1.12:8080 before a single packet exists. The ClusterIP packet is never built.",
      facts: [
        ["DIALED", "10.96.120.15:80 · Service web"],
        ["HOOK", "cgroup/connect4 · at connect() time"],
        ["REWRITTEN", "socket dst → 10.244.1.12:8080 · local backend"],
        ["REMOTE BACKENDS", "same socket rewrite, then the tunnel"],
      ],
      view: "node1",
      focus: ["n1.iptables", "n1.cni0", "n1.podA"],
      events: [
        ev({
          id: "ce27", at: 80, src: "cilium-agent · node-1", dst: "iptables · node-1", layer: "node", size: " - ", title: "THE OLD WAY, EMPTIED", path: ["n1.iptables", "n1.iptables"],
          says: "The tables kube-proxy maintained are gone - no chain walks for anything anymore.",
          info: "iptables-save | grep KUBE-SVC → (empty)",
          decoded: [
            sec("WHAT KUBE-PROXY OWNED", [["KUBE-SVC chains", "gone - kube-proxy isn't running", true], ["per Service", "was ~5 rules, walked linearly for every new connection"], ["owner now", "the agent's maps"]]),
          ],
        }),
        ev({
          id: "ce28", at: 80.05, src: BUSYBOX, dst: "connect4 bpf · node-1", layer: "node", size: " - ", title: "CAUGHT AT CONNECT()", path: ["n1.podB", "n1.cni0"],
          says: "The connect() call itself is intercepted; the socket is pointed at a local Pod before any packet exists.",
          info: "connect(10.96.120.15:80) → hook fires",
          decoded: [
            sec("CGROUP/CONNECT4", [["hook", "fires inside the socket call"], ["backends", "{10.244.1.12:8080 local · 10.244.2.17, 10.244.2.18 remote}"], ["chosen", "10.244.1.12 - a random pick, local this time"], ["socket dst", "10.96.120.15:80 → 10.244.1.12:8080", true], ["packet to the VIP", "never built", true]]),
          ],
        }),
        ev({
          id: "ce29", at: 80.4, src: BUSYBOX, dst: KQ9TW, layer: "net", size: "74 B", title: "THE ONLY PACKET", path: ["n1.cni0", "n1.podA"],
          says: "One plain packet between two Pods on one node - that's the whole Service call.",
          info: "SYN 10.244.1.30:42322 → 10.244.1.12:8080",
          frame: [
            layer("Ethernet", "busybox → kq9tw", 14), layer("IPv4", "10.244.1.30 → 10.244.1.12", 20), layer("TCP", "42322 → 8080 [SYN]", 40),
          ],
          decoded: [
            sec("NO VIP, NO TUNNEL", [["dst", "a Pod IP - written at the socket", true], ["path", "veth → veth · one BPF redirect"], ["reply", "same socket - the app still thinks it dialed the VIP"]]),
          ],
          note: "Had it picked a remote backend, the socket would point at that Pod's IP instead and the packet would take the Geneve road from earlier. Per-packet Service rewriting at tc is only for traffic the socket hook never sees, such as packets arriving from outside the node. And because every verdict passes through the maps, the agent can report each flow - identities included - to Hubble.",
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "cilium rollout · BPF loaded", layer: "node", start: 0, duration: 8 },
    { value: "t2", label: "identity 15361 minted", layer: "control", start: 20, duration: 6 },
    { value: "t3", label: "policy compiled to a map", layer: "control", start: 40, duration: 6 },
    { value: "t4", label: "tc egress + Geneve wrap", layer: "net", start: 60, duration: 0.3 },
    { value: "t5", label: "underlay: node-1 → node-2", layer: "net", start: 60.3, duration: 0.05 },
    { value: "t6", label: "identity verdict → accept", layer: "net", start: 60.35, duration: 0.45 },
    { value: "t7", label: "identity miss → drop", layer: "drop", start: 70, duration: 0.2 },
    { value: "t8", label: "Service call, no kube-proxy", layer: "node", start: 80, duration: 0.4 },
  ],
  summary: {
    title: "LABELS IN THE KERNEL",
    body: "Cilium's bet: the kernel can run the whole network if you can program it. The agent turns labels into identities, identities into map entries, and loads small verified programs at every veth and tunnel device. Packets carry their Pod's identity across the tunnel, so policy is one hash lookup anywhere in the cluster - no IP sets, no chain walks, nothing to rewrite when Pods move. Services become map lookups too - sometimes before a packet even exists.",
    facts: [
      ["AGENT", "watches · compiles · writes maps"],
      ["KERNEL", "verdicts · tunnels · rewrites · drops"],
      ["THE PACKET", "carries its labels · identity 15361"],
      ["NEXT", "Service mesh with Istio"],
    ],
  },
}
