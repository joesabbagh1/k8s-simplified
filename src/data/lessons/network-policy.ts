import type { Lesson } from "../types"
import { ev, layer, sec } from "./helpers"

const API_POD = "api-…-7d9fk"
const BUSYBOX = "busybox-…-c4t2m"
const CHAIN = "cali-tw-cali42ba5dcc12"
const WEB_IPS = "{10.244.1.12, 10.244.2.17, 10.244.2.18}"

export const networkPolicy: Lesson = {
  id: "network-policy",
  title: "NetworkPolicy",
  subtitle: "A packet gets dropped",
  category: "network",
  seo: {
    title: "How Kubernetes NetworkPolicy drops a packet",
    description: "Write a Kubernetes NetworkPolicy and watch the CNI plugin enforce it in the node's kernel: which Pods it selects, what it allows and what it drops.",
  },
  actors: ["you", "cp", "node1", "node2"],
  pods: { node1: ["other", "other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    [BUSYBOX]: "busybox Pod", [API_POD]: "api Pod", "web-…-x2kqp": "Pod x2kqp", "web-…-p8m4z": "node-2",
    "flannel.1 · node-2": "node-2", "iptables · node-2": "node-2", "calico node": "node-2",
  },
  overview: {
    body: "Write a deny rule and watch the CNI plugin drop a packet before it reaches the Pod. Kubernetes clusters start fully open - any Pod can talk to any Pod - and a NetworkPolicy doesn't add deny rules at all: it selects Pods, closes everything, and re-opens only what it allows. The CNI enforces that in each node's kernel.",
    facts: [
      ["DEFAULT", "allow · no policy selects the Pod"],
      ["POLICY", "app:api · ingress from app:web · TCP 8080"],
      ["ENFORCED BY", "calico iptables chains on every node"],
      ["APPLY → ENFORCED", "≈ 10 ms"],
    ],
  },
  steps: [
    {
      title: "DEFAULT ALLOW",
      subtitle: "every Pod can reach every Pod",
      body: "The api Deployment runs one Pod, api-…-7d9fk at 10.244.2.19 on node-2. Nothing protects it: Kubernetes starts with no isolation at all, so any Pod in the cluster can open a connection to any other. A debug busybox Pod on node-1 proves it - a direct curl to the Pod's address crosses the VXLAN tunnel and gets 200 OK. No rule allowed this; that's the point.",
      facts: [
        ["API POD", `${API_POD} · 10.244.2.19:8080 · node-2`],
        ["DEFAULT", "all ingress and egress allowed"],
        ["TEST", `${BUSYBOX} · 10.244.1.30 · node-1`],
        ["RESULT", "200 OK · ≈ 1 ms"],
      ],
      view: "cluster",
      focus: ["node1", "node2"],
      events: [
        ev({
          id: "np1", at: 0, src: BUSYBOX, dst: API_POD, layer: "net", size: "0.2 KB", title: "CURL THE POD", path: ["node1", "node2"],
          says: "From a debug Pod on node-1, a direct curl to the api Pod's address.",
          info: "curl http://10.244.2.19:8080/healthz",
          decoded: [
            sec("TEST CALL", [["from", `${BUSYBOX} · 10.244.1.30 (node-1)`], ["to", `${API_POD} · 10.244.2.19:8080 (node-2)`], ["allowed by", "nothing - no policy exists"]]),
          ],
        }),
        ev({
          id: "np2", at: 0.2, src: "node-1", dst: "node-2", layer: "net", size: "124 B", title: "VXLAN, AS ALWAYS", path: ["node1", "node2"],
          says: "The call crosses nodes in the usual VXLAN wrapper.",
          info: "UDP 8472 [inner 10.244.1.30 → 10.244.2.19:8080]",
          frame: [
            layer("Ethernet", "outer MACs", 14), layer("IPv4", "10.0.1.11 → 10.0.1.12", 20), layer("UDP", "→ 8472", 8), layer("VXLAN", "VNI 1", 8),
            layer("Ethernet", "inner MACs", 14, true), layer("IPv4", "10.244.1.30 → 10.244.2.19", 20, true), layer("TCP", "42322 → 8080 [SYN]", 40, true),
          ],
          decoded: [
            sec("NODE-2 RECEIVES", [["unwrap", "flannel.1 strips 50 B"], ["forward", "toward cni0 - no filter in the way"]]),
          ],
        }),
        ev({
          id: "np3", at: 0.5, src: "node-2", dst: API_POD, layer: "net", size: "0.2 KB", title: "STRAIGHT THROUGH", path: ["node2", "node2"],
          says: "The packet reaches the container and the health check answers 200.",
          info: "GET /healthz → 200 OK (0.4 ms inside node-2)",
          decoded: [
            sec("FORWARD PATH", [["iptables FORWARD", "ACCEPT - chain policy ACCEPT"], ["cni0 → veth", "delivered"], ["result", "200 OK", true]]),
          ],
        }),
      ],
    },
    {
      title: "WRITE THE POLICY",
      subtitle: "an allow-list, applied to one Pod",
      body: "kubectl posts a NetworkPolicy to the API server. It selects Pods labelled app:api and says: ingress is allowed only from Pods labelled app:web, and only on TCP 8080. The API server validates it and stores it in etcd - but stores is all it does. The moment a policy selects a Pod, every other path to that Pod closes: there are no deny rules anywhere, only allow-lists.",
      facts: [
        ["SELECTS", "Pods with label app:api"],
        ["ALLOWS", "ingress from app:web · TCP 8080 only"],
        ["EVERYTHING ELSE", "closed - allow-list, not deny-list"],
        ["STORED", "etcd · /registry/networkpolicies/default/api-allow-web"],
      ],
      view: "cluster",
      focus: ["you", "api", "etcd"],
      events: [
        ev({
          id: "np4", at: 10, src: "kubectl", dst: "kube-apiserver", layer: "api", size: "0.6 KB", title: "APPLY NETWORKPOLICY", path: ["you", "api"],
          says: "kubectl posts one NetworkPolicy that selects the api Pods.",
          info: "POST /apis/networking.k8s.io/v1/namespaces/default/networkpolicies",
          decoded: [
            sec("BODY · NETWORKPOLICY", [["metadata.name", "api-allow-web"], ["podSelector", "matchLabels app: api", true], ["policyTypes", "[Ingress]"], ["ingress.from", "podSelector matchLabels app: web"], ["ingress.ports", "TCP 8080"]]),
          ],
          note: "One rule closes everything else. A Pod selected by any policy is isolated for that direction, and policies only ever add allows - there is no deny rule in the NetworkPolicy API. (Cluster-wide admin policy, a separate API, does have one.)",
        }),
        ev({
          id: "np5", at: 13, src: "kube-apiserver", dst: "etcd", layer: "state", size: "0.5 KB", title: "STORED", path: ["api", "etcd"],
          says: "The API server stores the policy, and nothing else happens here.",
          info: "Txn put /registry/networkpolicies/default/api-allow-web",
          decoded: [
            sec("ETCD", [["key", "/registry/networkpolicies/default/api-allow-web"], ["revision", "51744", true], ["enforced by", "nobody - etcd only stores"]]),
          ],
        }),
        ev({
          id: "np6", at: 15, src: "kube-apiserver", dst: "kubectl", layer: "api", size: "0.3 KB", title: "201 CREATED", path: ["api", "you"],
          says: "kubectl gets 201 Created. The policy exists, but isn't enforced yet.",
          info: "201 Created networkpolicy/api-allow-web",
          decoded: [
            sec("HTTP RESPONSE", [["status", "201 Created"], ["visible to", "anything watching the API"]]),
          ],
        }),
      ],
    },
    {
      title: "WHO ENFORCES IT",
      subtitle: "not the API server - the CNI",
      body: "Nothing in the control plane drops packets. Enforcement belongs to the CNI: flannel in this cluster moves packets but has no policy support, so the cluster also runs Calico's policy layer on top (flannel plus Calico policy is often called Canal). Felix, Calico's agent on every node, watches NetworkPolicies, Pods and namespaces, work out exactly which IPs may talk to which, and program cali- chains into every node's iptables. Each node enforces the whole policy for its own traffic.",
      facts: [
        ["FLANNEL", "connectivity only · no policy"],
        ["CALICO", "policy layer · watches API, programs iptables"],
        ["PER NODE", "every node enforces its own traffic"],
        ["LATENCY", "apply → enforced ≈ 10 ms"],
      ],
      view: "node2",
      focus: ["n2.api", "n2.iptables"],
      events: [
        ev({
          id: "np7", at: 18, src: "kube-apiserver", dst: "calico node", layer: "control", size: "1.1 KB", title: "WATCH FIRES", path: ["n2.api", "n2.iptables"],
          says: "Felix, Calico's agent on node-2, hears about the policy the moment it's stored.",
          info: "WATCH ADDED NetworkPolicy api-allow-web",
          decoded: [
            sec("WHAT CALICO COMPUTES", [["selected Pods", "app:api → {10.244.2.19}"], ["allowed sources", `app:web → ${WEB_IPS}`, true], ["port", "TCP 8080"]]),
          ],
        }),
        ev({
          id: "np8", at: 20, src: "calico node", dst: "iptables · node-2", layer: "node", size: "1.8 KB", title: "CALI CHAINS APPEAR", path: ["n2.iptables", "n2.iptables"],
          says: "It writes new chains into node-2's iptables: the allow-list, per destination Pod.",
          info: "iptables-restore · +cali-FORWARD, +cali-tw-…",
          decoded: [
            sec("NEW CHAINS · TABLE FILTER", [["FORWARD", "-j cali-FORWARD"], [CHAIN, "to-workload for 10.244.2.19", true], ["cali-tw rule 1", `src in ipset of web IPs · dport 8080 → ACCEPT`], ["end of chain", "DROP", true]]),
          ],
          note: "iptables cannot read labels. Calico turns app:web into an ipset holding the current web Pod IPs and updates it whenever a Pod appears or moves - the label lives in the API, the enforcement in IPs.",
        }),
      ],
    },
    {
      title: "THE DROP",
      subtitle: "the busybox call, again",
      body: "The busybox Pod tries the same curl again. The packet arrives on node-2, flannel unwraps it, and the kernel walks it toward the bridge - straight into cali-tw. The source 10.244.1.30 is not in the web IP set, no rule matches, and the chain ends in DROP. The container receives nothing: no reset, no reply, just silence until curl times out.",
      facts: [
        ["SOURCE", "10.244.1.30 · busybox · not web"],
        ["CHAIN", CHAIN],
        ["RESULT", "DROP · counter [3 pkts, 180 B]"],
        ["APP SEES", "nothing · connection times out"],
      ],
      view: "node2",
      focus: ["n2.flannel", "n2.iptables", "n2.cni0"],
      events: [
        ev({
          id: "np9", at: 30, src: "flannel.1 · node-2", dst: "iptables · node-2", layer: "net", size: "124 B", title: "ARRIVES AT THE FILTER", path: ["n2.flannel", "n2.iptables"],
          says: "The call arrives again, unwraps on node-2, and walks toward the bridge.",
          info: "10.244.1.30 → 10.244.2.19:8080 · FORWARD chain",
          frame: [
            layer("Ethernet", "outer MACs", 14), layer("IPv4", "10.0.1.11 → 10.0.1.12", 20), layer("UDP", "→ 8472", 8), layer("VXLAN", "VNI 1", 8),
            layer("Ethernet", "inner MACs", 14, true), layer("IPv4", "10.244.1.30 → 10.244.2.19", 20, true), layer("TCP", "42322 → 8080 [SYN]", 40, true),
          ],
          decoded: [
            sec("ROUTING", [["unwrap", "UDP 8472 → inner packet"], ["next hop", "cni0 (10.244.2.0/24)"], ["passes through", "cali-FORWARD → cali-tw-…", true]]),
          ],
        }),
        ev({
          id: "np10", at: 30.1, src: "iptables · node-2", dst: "iptables · node-2", layer: "net", size: " - ", title: "NO RULE MATCHES", path: ["n2.iptables", "n2.iptables"],
          says: "The only allow rule admits web Pods on 8080, and this source isn't one.",
          info: `src 10.244.1.30 not in ${WEB_IPS}`,
          decoded: [
            sec(CHAIN.toUpperCase(), [["conntrack", "NEW (not ESTABLISHED)"], ["rule 1", "src in web ipset · dport 8080 → no match"], ["more rules", "none"], ["verdict", "fall through to DROP", true]]),
          ],
        }),
        ev({
          id: "np11", at: 30.2, src: "iptables · node-2", dst: API_POD, layer: "drop", size: " - ", title: "DROP", path: ["n2.iptables", "n2.iptables"],
          says: "The packet dies in the kernel, before the veth. The app never hears it.",
          info: "DROP 10.244.1.30 → 10.244.2.19:8080 · SYN retried 3 times, all dropped",
          decoded: [
            sec("COUNTER", [["cali-tw-… DROP", "[pkts: 3 bytes: 180]", true], ["delivered to container", "0 packets"], ["curl reports", "timeout, not refused"]]),
          ],
          note: "A dropped packet is silence, not an error. TCP retransmits the SYN a few times, curl eventually times out, and the app's logs show nothing at all.",
        }),
      ],
    },
    {
      title: "THE ALLOWED CALL",
      subtitle: "the same curl, from a web Pod",
      body: "web-…-x2kqp on node-2 makes the identical call - and it carries the label app:web. Its packet hits the same chain, the source 10.244.2.17 is in the IP set, the port is 8080, and the verdict is ACCEPT. The reply needs no rule of its own: the chain's first line accepts ESTABLISHED connections, so answers ride conntrack back. Egress works the same way, on cali-fw-… chains, if the policy asks for policyTypes: Egress.",
      facts: [
        ["SOURCE", "10.244.2.17 · web-…-x2kqp · label app=web"],
        ["VERDICT", "ACCEPT · rule 1"],
        ["REPLIES", "conntrack ESTABLISHED → accepted"],
        ["EGRESS", "policyTypes: Egress → cali-fw-… chains"],
      ],
      view: "node2",
      focus: ["n2.podA", "n2.iptables", "n2.cni0"],
      events: [
        ev({
          id: "np12", at: 40, src: "web-…-x2kqp", dst: "iptables · node-2", layer: "net", size: "74 B", title: "FROM A WEB POD", path: ["n2.podA", "n2.cni0"],
          says: "The same call from a web Pod takes the same path into the same chain.",
          info: "SYN 10.244.2.17:49770 → 10.244.2.19:8080",
          decoded: [
            sec("THE DIFFERENCE", [["source label", "app=web"], ["ipset", `web = ${WEB_IPS}`], ["this src", "10.244.2.17 - in the ipset", true]]),
          ],
        }),
        ev({
          id: "np13", at: 40.1, src: "iptables · node-2", dst: API_POD, layer: "net", size: "74 B", title: "ACCEPT", path: ["n2.iptables", "n2.cni0"],
          says: "Rule 1 matches, the verdict is ACCEPT, and the packet continues to the bridge.",
          info: "ACCEPT · [pkts: 47 bytes: 3110] and counting",
          decoded: [
            sec(CHAIN.toUpperCase(), [["rule 1", "src in web ipset · dport 8080 → ACCEPT", true], ["then", "cni0 → veth → container"], ["counter", "[pkts: 47 bytes: 3110]"]]),
          ],
        }),
        ev({
          id: "np14", at: 41, src: API_POD, dst: "web-…-x2kqp", layer: "net", size: "0.2 KB", title: "200 OK", path: ["n2.cni0", "n2.podA"],
          says: "The api Pod answers 200, and the reply passes on the conntrack rule.",
          info: "GET /healthz → 200 OK · reply ESTABLISHED → ACCEPT",
          decoded: [
            sec("REPLY PATH", [["chain", "cali-fw-… (from workload)"], ["rule", "conntrack ESTABLISHED → ACCEPT"], ["status", "200 OK", true]]),
          ],
        }),
      ],
    },
    {
      title: "STILL OPEN",
      subtitle: "policies are per-Pod",
      body: "The busybox Pod isn't blocked everywhere - only the api Pod got isolated. Nothing selected the web Pods, so a call from busybox straight to web-…-p8m4z still sails through the very kernel that just dropped its SYN. Isolation follows selection: a Pod no policy touches keeps the cluster default, which is allow.",
      facts: [
        ["ISOLATED", "only Pods matching podSelector app:api"],
        ["WEB PODS", "no policy → default allow"],
        ["ADDITIVE", "two policies = the union of their allows"],
        ["EMPTY PODSELECTOR", "selects every Pod in the namespace"],
      ],
      view: "cluster",
      focus: ["node1", "node2"],
      events: [
        ev({
          id: "np15", at: 50, src: BUSYBOX, dst: "web-…-p8m4z", layer: "net", size: "0.2 KB", title: "STRAIGHT THROUGH", path: ["node1", "node2"],
          says: "The very same Pod can still reach anything no policy protects.",
          info: "curl http://10.244.2.18:8080/healthz → 200 OK",
          decoded: [
            sec("WHY", [["policy selects", "app:api only"], ["web-…-p8m4z", "no policy → default allow", true], ["scope", "per selected Pod, not per cluster"]]),
          ],
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "default allow · test call", layer: "net", start: 0, duration: 0.6 },
    { value: "t2", label: "kubectl apply → etcd", layer: "api", start: 10, duration: 5 },
    { value: "t3", label: "calico programs node-2", layer: "node", start: 18, duration: 2.5 },
    { value: "t4", label: "busybox SYN dropped ×3", layer: "drop", start: 30, duration: 0.3 },
    { value: "t5", label: "web call accepted", layer: "net", start: 40, duration: 1.2 },
    { value: "t6", label: "unselected Pods stay open", layer: "net", start: 50, duration: 0.4 },
  ],
  summary: {
    title: "ALLOW-LISTS IN THE KERNEL",
    body: "Kubernetes starts with every Pod reachable from every Pod, and the API server never drops a packet - it only stores the rules. A NetworkPolicy isolates exactly the Pods it selects and turns labels into IP allow-lists, enforced per node by the CNI in iptables. Everything it doesn't select is still open.",
    facts: [
      ["DEFAULT", "allow · isolation only on selection"],
      ["ENFORCED", "per node, in the kernel, by the CNI"],
      ["NEXT", "Cilium and eBPF"],
    ],
  },
}
