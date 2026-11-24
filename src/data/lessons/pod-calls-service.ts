import type { Lesson } from "../types"
import { ev, layer, sec } from "./helpers"

const KQ9TW = "web-…-kq9tw"
const P8M4Z = "web-…-p8m4z"
const VIP = "10.96.120.15"

export const podCallsService: Lesson = {
  id: "pod-calls-service",
  title: "Pod calls a Service",
  subtitle: "ClusterIP and kube-proxy",
  category: "network",
  seo: {
    title: "How a Kubernetes ClusterIP Service works",
    description: "A Kubernetes ClusterIP isn't on any interface. Watch kube-proxy's iptables rules rewrite it to a real Pod IP, and conntrack undo it on the way back.",
  },
  actors: ["node1", "node2"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    [KQ9TW]: "Pod kq9tw", "cni0 · node-1": "node-1", "kube-proxy": "node-1",
    iptables: "node-1", "conntrack · node-1": "node-1",
  },
  overview: {
    body: "A ClusterIP isn't on any interface. See how iptables rewrites it to a real Pod IP and how conntrack keeps track. The virtual IP exists only as kernel rules on every node - no socket binds it, no cable carries it, and the client never finds out which Pod answered.",
    facts: [
      ["SERVICE", `web · ClusterIP ${VIP}:80`],
      ["ENDPOINTS", "10.244.1.12 · 10.244.2.17 · 10.244.2.18, all :8080"],
      ["CLIENT", `${KQ9TW} · 10.244.1.12`],
      ["MECHANISM", "iptables DNAT + conntrack · kube-proxy"],
    ],
  },
  steps: [
    {
      title: "CALL THE VIP",
      subtitle: "a name becomes a ghost address",
      body: `The app in ${KQ9TW} asks for http://web:80. kube-dns answers ${VIP}, the Service's ClusterIP, and the app sends its SYN there, from port 44872. But that address is on no interface: not in the Pod's netns, not on the node, not on any cable. It exists only as match conditions in iptables rules, and the SYN rides the Pod's default route toward the bridge gateway to find them.`,
      facts: [
        ["NAME", "web.default.svc.cluster.local"],
        ["ANSWER", `${VIP} (ClusterIP)`],
        ["ON ANY INTERFACE", "never · iptables only"],
        ["FIRST HOP", "default gw 10.244.1.1"],
      ],
      view: "node1",
      focus: ["n1.podA", "n1.podB", "n1.cni0"],
      events: [
        ev({
          id: "sv1", at: 0, src: KQ9TW, dst: "kube-dns", layer: "net", size: "0.2 KB", title: "NAME → CLUSTERIP", path: ["n1.podA", "n1.podB"],
          says: "The app asks the cluster's DNS for web and gets the Service's ClusterIP back.",
          info: "A? web.default.svc.cluster.local → 10.96.120.15",
          decoded: [sec("DNS", [["question", "web.default.svc.cluster.local · A"], ["answer", `${VIP} · ttl 30`, true], ["took", "≈ 0.7 ms"]])],
          note: "10.96.0.10 is itself a ClusterIP: even this lookup was DNAT'd by iptables, to coredns at 10.244.1.3 on this same node.",
        }),
        ev({
          id: "sv2", at: 0.7, src: KQ9TW, dst: KQ9TW, layer: "net", size: "74 B", title: "SYN TO THE VIP", path: ["n1.podA", "n1.podA"],
          says: "The app connects to 10.96.120.15:80 and the kernel builds the SYN.",
          info: `connect(${VIP}:80) · port 44872`,
          decoded: [sec("SYSCALL + TCP", [["local", "10.244.1.12:44872"], ["dst", `${VIP}:80`, true], ["flags", "SYN · mss 1410"]])],
        }),
        ev({
          id: "sv3", at: 0.71, src: KQ9TW, dst: "cni0 · node-1", layer: "net", size: "74 B", title: "TO THE GATEWAY", path: ["n1.podA", "n1.cni0"],
          says: "The Pod's route table has no better idea, so the SYN goes to its gateway - the bridge - aimed at an address that exists nowhere.",
          info: "default via 10.244.1.1 · no interface owns 10.96.120.15",
          frame: [layer("Ethernet", "dst MAC = the bridge's", 14), layer("IPv4", `10.244.1.12 → ${VIP}`, 20), layer("TCP", "44872 → 80 [SYN]", 40)],
          decoded: [sec("REALITY CHECK", [["pod route", "default via 10.244.1.1 dev eth0"], ["node ip addr", "10.0.1.11, 10.244.1.1, 10.244.1.0 …"], [VIP, "not on any interface · iptables only", true]])],
        }),
      ],
    },
    {
      title: "WHO WROTE THE RULES",
      subtitle: "kube-proxy, hours earlier",
      body: "Pause the packet - it sits in the kernel for microseconds anyway - and see who built this switchboard. kube-proxy on node-1 holds watches on Services and EndpointSlices. When web and its three endpoints were written, its watch fired and it ran iptables-restore: one KUBE-SVC chain for the VIP, with three KUBE-SEP branches, one per Pod.",
      facts: [
        ["WATCHES", "Services + EndpointSlices"],
        ["WRITES", "KUBE-SERVICES · KUBE-SVC-… · KUBE-SEP-…"],
        ["HOW OFTEN", "on every change, ahead of traffic"],
      ],
      view: "node1",
      focus: ["n1.api", "n1.iptables"],
      events: [
        ev({
          id: "sv4", at: 0.72, src: "kube-apiserver", dst: "kube-proxy", layer: "control", size: "0.9 KB", title: "WATCH FIRED", path: ["n1.api", "n1.iptables"],
          says: "Hours before this packet, kube-proxy's watch delivered the Service and its three endpoints.",
          info: "WATCH Service web + EndpointSlice web-7xk2p",
          decoded: [sec("WATCH STREAM", [["Service", `web · ${VIP}:80 → 8080`], ["endpoints", "10.244.1.12 · 10.244.2.17 · 10.244.2.18", true], ["when", "at creation · a flashback"]])],
        }),
        ev({
          id: "sv5", at: 0.73, src: "kube-proxy", dst: "iptables", layer: "control", size: " - ", title: "IPTABLES-RESTORE", path: ["n1.iptables", "n1.iptables"],
          says: "kube-proxy turned that into chains in the kernel, once, and got out of the way.",
          info: "KUBE-SERVICES → KUBE-SVC-QD4FJ… → 3 × KUBE-SEP",
          decoded: [sec("CHAIN KUBE-SVC-QD4FJ…", [["-A KUBE-SERVICES", `dst ${VIP} dpt:80 -j KUBE-SVC-QD4FJ…`], ["-A KUBE-SVC-…", "statistic mode random p=0.3333 → KUBE-SEP-…"], ["3 × KUBE-SEP", "DNAT to each Pod's ip:8080", true], ["how", "iptables-restore · atomic swap"]])],
        }),
      ],
    },
    {
      title: "THE RULE WALK",
      subtitle: "match, pick, rewrite, remember",
      body: "Back to the SYN. It enters the node's netns from the bridge, and the nat table runs before any routing decision. KUBE-SERVICES matches dst 10.96.120.15 dpt:80 and jumps to KUBE-SVC-QD4FJ…, where a three-way probability split picks one Pod - rule 3 this time, 10.244.2.18:8080 on node-2. DNAT rewrites the destination; the source stays 10.244.1.12, because Pod IPs route everywhere. conntrack writes down the translation.",
      facts: [
        ["MATCHED", `dst ${VIP} dpt:80`],
        ["PICKED", "rule 3 → 10.244.2.18:8080"],
        ["DNAT", "dst rewritten"],
        ["SRC", "10.244.1.12 · untouched"],
      ],
      view: "node1",
      focus: ["n1.cni0", "n1.iptables", "n1.flannel"],
      events: [
        ev({
          id: "sv6", at: 0.74, src: "cni0 · node-1", dst: "iptables", layer: "net", size: "74 B", title: "PREROUTING", path: ["n1.cni0", "n1.iptables"],
          says: "The SYN enters the node's netns from the bridge, and the nat table runs before any routing decision.",
          info: "nat PREROUTING → KUBE-SERVICES match",
          decoded: [sec("RULE WALK · TABLE NAT", [["PREROUTING", "-j KUBE-SERVICES"], ["KUBE-SERVICES", `dst ${VIP} dpt:80 → jump`, true], ["chain", "KUBE-SVC-QD4FJ…"]])],
        }),
        ev({
          id: "sv7", at: 0.745, src: "iptables", dst: "iptables", layer: "net", size: " - ", title: "PICK A POD", path: ["n1.iptables", "n1.iptables"],
          says: "A three-way probability split picks one endpoint: this time rule 3, on node-2.",
          info: "statistic random → KUBE-SEP-C… → 10.244.2.18:8080",
          decoded: [sec("KUBE-SVC-QD4FJ…", [["rule 1 · p=0.333", "→ 10.244.1.12:8080 · the caller itself"], ["rule 2 · p=0.5", "→ 10.244.2.17:8080 · node-2"], ["rule 3 · the rest", "→ 10.244.2.18:8080 · node-2", true]])],
        }),
        ev({
          id: "sv8", at: 0.75, src: "iptables", dst: "iptables", layer: "net", size: "74 B", title: "DNAT", path: ["n1.iptables", "n1.iptables"],
          says: "The destination is rewritten to the Pod's address and port; the source stays untouched.",
          info: `DNAT ${VIP}:80 → 10.244.2.18:8080`,
          frame: [layer("Ethernet", "next hop: flannel.1", 14), layer("IPv4", "10.244.1.12 → 10.244.2.18", 20), layer("TCP", "44872 → 8080 [SYN]", 40)],
          decoded: [
            sec("IPV4 + TCP · BEFORE → AFTER", [["dst", `${VIP}:80 → 10.244.2.18:8080`, true], ["src", "10.244.1.12:44872 · unchanged"]]),
            sec("CONNTRACK · NEW", [["entry", "44872 ↔ VIP:80 ⇋ 10.244.2.18:8080", true], ["owner", "node-1 · where the rewrite happened"]]),
          ],
          note: "No SNAT this time: a Pod IP is routable everywhere. But the reply must come back through node-1, the only node holding the conntrack entry.",
        }),
      ],
    },
    {
      title: "AN ORDINARY PACKET",
      subtitle: "the last lesson's road",
      body: "With dst 10.244.2.18:8080 this is now the packet from the last lesson: node-1 routes it at flannel.1, wraps it in UDP 8472 with VNI 1, and node-2 unwraps it onto cni0 and up the veth into p8m4z. The server accepts and sees the client as 10.244.1.12:44872 - it has never heard of the VIP.",
      facts: [
        ["NOW", "plain 10.244.1.12 → 10.244.2.18:8080"],
        ["TUNNEL", "VXLAN VNI 1 · as in the last lesson"],
        ["SERVER SEES", "the client's Pod IP"],
      ],
      view: "cluster",
      focus: ["node1", "node2"],
      events: [
        ev({
          id: "sv9", at: 0.76, src: "node-1", dst: "node-1", layer: "net", size: "124 B", title: "WRAP", path: ["node1", "node1"],
          says: "With a Pod destination, this is now exactly the packet from the last lesson, and node-1 wraps it for the tunnel.",
          info: "route via flannel.1 → UDP 8472, VNI 1",
          decoded: [sec("ENCAPSULATE", [["outer", "10.0.1.11 → 10.0.1.12:8472"], ["VNI", "1"], ["inner", "10.244.1.12:44872 → 10.244.2.18:8080", true]])],
        }),
        ev({
          id: "sv10", at: 0.77, src: "node-1", dst: "node-2", layer: "net", size: "124 B", title: "TUNNEL", path: ["node1", "node2"],
          says: "It crosses as one UDP packet between the nodes.",
          info: "UDP 10.0.1.11:52301 → 10.0.1.12:8472 [inner SYN → 10.244.2.18:8080]",
          frame: [
            layer("Ethernet", "outer MACs", 14), layer("IPv4", "10.0.1.11 → 10.0.1.12", 20), layer("UDP", "52301 → 8472", 8), layer("VXLAN", "VNI 1", 8),
            layer("Ethernet", "inner", 14, true), layer("IPv4", "10.244.1.12 → 10.244.2.18", 20, true), layer("TCP", "44872 → 8080 [SYN]", 40, true),
          ],
          decoded: [
            sec("OUTER", [["src", "10.0.1.11 · node-1"], ["dst", "10.0.1.12:8472 · node-2"]]),
            sec("INNER", [["src", "10.244.1.12:44872"], ["dst", "10.244.2.18:8080"]]),
          ],
        }),
        ev({
          id: "sv11", at: 1.11, src: "node-2", dst: "node-2", layer: "net", size: "74 B", title: "DELIVERED", path: ["node2", "node2"],
          says: "node-2 unwraps it, the bridge forwards it up the veth, and p8m4z takes it.",
          info: `unwrap → cni0 → veth → ${P8M4Z}`,
          decoded: [sec("AT THE APP", [["local", "10.244.2.18:8080"], ["remote", "10.244.1.12:44872", true], ["vip heard of", "never"]])],
        }),
        ev({
          id: "sv12", at: 1.15, src: "node-2", dst: "node-2", layer: "net", size: "0.3 KB", title: "200 OK", path: ["node2", "node2"],
          says: "The app answers 200 OK, addressed straight back to the client Pod.",
          info: "reply bound for 10.244.1.12 · wrapped for the tunnel",
          decoded: [sec("HTTP RESPONSE", [["status", "200 OK"], ["src", "10.244.2.18:8080 · the real Pod"], ["dst", "10.244.1.12:44872"]])],
          note: "Each end believes a different peer: the client talks to 10.96.120.15, the server talks to 10.244.1.12. Both are right, thanks to what happens next.",
        }),
      ],
    },
    {
      title: "THE REPLY'S SECRET",
      subtitle: "conntrack lies consistently",
      body: "The 200 OK leaves p8m4z bound for 10.244.1.12, tunnels back to node-1 - the node that owns the conntrack entry - and there the kernel un-rewrites the source: 10.244.2.18:8080 becomes 10.96.120.15:80 again. The client reads a reply from exactly the address it dialed. It never learns which Pod answered, and a different connection may well land elsewhere.",
      facts: [
        ["UN-DNAT", "src 10.244.2.18:8080 → 10.96.120.15:80"],
        ["WHERE", "node-1 · the conntrack owner"],
        ["CLIENT SEES", "a reply from the VIP"],
      ],
      view: "cluster",
      focus: ["node1", "node2"],
      events: [
        ev({
          id: "sv13", at: 1.2, src: "node-2", dst: "node-1", layer: "net", size: "0.3 KB", title: "BACK THROUGH THE TUNNEL", path: ["node2", "node1"],
          says: "The reply tunnels back to node-1, the node that owns the translation.",
          info: "UDP 10.0.1.12 → 10.0.1.11:8472 [inner 200 OK]",
          decoded: [sec("INNER", [["src", "10.244.2.18:8080"], ["dst", "10.244.1.12:44872"]])],
        }),
        ev({
          id: "sv14", at: 1.55, src: "conntrack · node-1", dst: "conntrack · node-1", layer: "net", size: " - ", title: "UN-DNAT", path: ["node1", "node1"],
          says: "conntrack recognizes its own connection and swaps the source back to the VIP before the packet leaves the node.",
          info: "reply recognized · src 10.244.2.18:8080 → 10.96.120.15:80",
          decoded: [sec("BEFORE → AFTER", [["src", "10.244.2.18:8080 → 10.96.120.15:80", true], ["dst", "10.244.1.12:44872 · unchanged"]])],
        }),
        ev({
          id: "sv15", at: 1.6, src: "node-1", dst: "node-1", layer: "net", size: "0.3 KB", title: "THE VEIL HOLDS", path: ["node1", "node1"],
          says: "The client reads a reply from exactly the address it dialed. It never learns which Pod answered.",
          info: "200 OK from 10.96.120.15:80 · read() returns",
          decoded: [sec("SOCKET · KQ9TW", [["peer", `${VIP}:80 · still`, true], ["real server", "10.244.2.18 · never seen"]])],
        }),
      ],
    },
    {
      title: "ONE PICK PER CONNECTION",
      subtitle: "sticky by design",
      body: "Load balancing here is per connection, not per packet. The random pick runs once, when conntrack sees a NEW flow; every later packet of that flow is ESTABLISHED and takes the recorded translation without re-walking the chains. And the whole trick runs in the kernel: kube-proxy only ever wrote rules.",
      facts: [
        ["BALANCING", "per connection · not per packet"],
        ["ESTABLISHED", "skips the rule walk"],
        ["KUBE-PROXY", "wrote rules · kernel did the work"],
      ],
      view: "node1",
      focus: ["n1.iptables"],
      events: [
        ev({
          id: "sv16", at: 1.7, src: "iptables", dst: "iptables", layer: "net", size: " - ", title: "CONNTRACK'S LEDGER", path: ["n1.iptables", "n1.iptables"],
          says: "Every packet of this connection now skips the walk: the dice were rolled once, at SYN time.",
          info: "3 live connections · 3 different backends",
          decoded: [sec("CONNTRACK · ESTABLISHED", [["44872 → web", "10.244.2.18 · this lesson", true], ["45102 → web", "10.244.1.12 · the caller itself, via hairpin"], ["45189 → web", "10.244.2.17"], ["later packets", "translation applied · no rule walk"]])],
          note: "The stickiness is also why you can't rebalance a long-lived connection by adding Pods: only new connections see the new endpoint list. Connection 45102 is the odd case: kq9tw is a web Pod too, and the dice picked itself. Its KUBE-SEP chain masquerades that case, so the reply still has to come back through the bridge.",
        }),
        ev({
          id: "sv17", at: 1.75, src: "kube-proxy", dst: "iptables", layer: "control", size: " - ", title: "WRITER, NOT RELAY", path: ["n1.iptables", "n1.iptables"],
          says: "kube-proxy never touches a packet; it wrote rules and left. node-2 has the same ones, so the VIP works from anywhere.",
          info: "kube-proxy is not in the data path · every node has these chains",
          decoded: [sec("DIVISION OF LABOR", [["kube-proxy", "watch → write rules"], ["kernel", "match · rewrite · forward · every packet"], ["nodes covered", "all of them · independently"]])],
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "DNS: name → ClusterIP", layer: "net", start: 0, duration: 0.7 },
    { value: "t2", label: "Rules written (earlier)", layer: "control", start: 0.72, duration: 0.02 },
    { value: "t3", label: "The rule walk: DNAT", layer: "net", start: 0.74, duration: 0.02 },
    { value: "t4", label: "VXLAN to node-2, 200 OK", layer: "net", start: 0.76, duration: 0.39 },
    { value: "t5", label: "Reply + un-DNAT", layer: "net", start: 1.2, duration: 0.4 },
    { value: "t6", label: "Conntrack's ledger", layer: "control", start: 1.7, duration: 0.1 },
  ],
  summary: {
    title: "THE VIP HELD",
    body: "kube-proxy never relayed a byte - it wrote rules, and the kernel did the rest. A ClusterIP is a match condition, not a place: the SYN was rewritten to a Pod address before any routing decision, and conntrack kept the ledger so the reply could lie consistently. Every node carries the same rules, so the VIP works from anywhere.",
    facts: [
      ["RULES", "KUBE-SERVICES on every node · equal shares"],
      ["CLIENT LEARNED", "nothing · reply came from 10.96.120.15:80"],
      ["NEXT", "DNS in the cluster"],
    ],
  },
}
