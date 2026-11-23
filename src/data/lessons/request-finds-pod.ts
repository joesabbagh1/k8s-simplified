import type { Lesson } from "../types"
import { ev, layer, sec } from "./helpers"

const VISITOR = "198.51.100.7:51514"

export const requestFindsPod: Lesson = {
  id: "request-finds-pod",
  title: "A request finds your Pod",
  subtitle: "Load balancer to container",
  category: "network",
  actors: ["resolver", "visitor", "lb", "node1", "node2", "web-svc"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  res: { "web-svc": { kind: "service", name: "Service web", sub: "10.96.120.15:80 · endpoints: 3" } },
  lanes: {
    "eth0 · node-1": "node-1", iptables: "node-1", "flannel.1 · node-1": "node-1", "conntrack · node-1": "node-1",
    "eth0 · node-2": "node-2", "flannel.1 · node-2": "node-2", cni0: "node-2",
    "web-…-x2kqp": "Pod x2kqp", veth3b1c: "Pod x2kqp", "eth0 · Pod": "Pod x2kqp", web: "Pod x2kqp",
  },
  overview: {
    body: "Follow the first packet of one HTTP request from a visitor's laptop to your container and back. On the way in its addresses are rewritten three times and it's wrapped inside another packet once. On the way out every change is undone, so the visitor never sees any of it.",
    facts: [
      ["SERVICE", "web · type LoadBalancer · port 80 → 8080"],
      ["NODEPORT", "30080 on every node"],
      ["ENDPOINTS", "10.244.1.12, 10.244.2.17, 10.244.2.18"],
      ["NETWORK", "flannel with VXLAN · kube-proxy in iptables mode"],
    ],
  },
  steps: [
    {
      title: "FIND THE ADDRESS",
      subtitle: "DNS turns the name into an IP",
      body: "The visitor's browser needs an IP for shop.example.com, so it asks a DNS resolver. The answer is 203.0.113.50. That address doesn't belong to any node or Pod: it's the cloud load balancer that Kubernetes created for the web Service.",
      facts: [
        ["QUESTION", "A? shop.example.com"],
        ["ANSWER", "203.0.113.50 (the load balancer)"],
        ["TTL", "300 s"],
      ],
      view: "cluster",
      focus: ["visitor", "resolver"],
      events: [
        ev({
          id: "r1", at: 0, src: "visitor", dst: "DNS resolver", layer: "net", size: "74 B", title: "DNS QUERY", path: ["visitor", "resolver"],
          says: "The visitor's browser asks a DNS server for the IP of shop.example.com.",
          info: "DNS A? shop.example.com",
          frame: [layer("Ethernet", "MACs", 14), layer("IPv4", "198.51.100.7 → 198.51.100.53", 20), layer("UDP", "51200 → 53", 8), layer("DNS", "A? shop.example.com", 32)],
          decoded: [sec("DNS QUERY", [["id", "0x3f2a"], ["question", "shop.example.com, type A"], ["recursion", "desired"]])],
        }),
        ev({
          id: "r2", at: 22, src: "DNS resolver", dst: "visitor", layer: "net", size: "90 B", title: "DNS ANSWER", path: ["resolver", "visitor"],
          says: "The answer is 203.0.113.50: the cloud load balancer.",
          info: "A shop.example.com → 203.0.113.50",
          decoded: [sec("DNS ANSWER", [["shop.example.com", "A 203.0.113.50", true], ["ttl", "300"]])],
          note: "The browser caches this for 300 seconds. Kubernetes never sees DNS lookups from the internet; your DNS provider points the name at the load balancer.",
        }),
      ],
    },
    {
      title: "TO THE LOAD BALANCER",
      subtitle: "The first packet leaves the laptop",
      body: "The browser opens a TCP connection to 203.0.113.50 on port 80. We follow the very first packet, the SYN, because it's the one that sets up every rewrite on the way. Once the handshake is done, the GET request follows exactly the same path.",
      facts: [
        ["FROM", VISITOR],
        ["TO", "203.0.113.50:80"],
        ["PACKET", "TCP SYN"],
      ],
      view: "cluster",
      focus: ["visitor", "lb"],
      events: [
        ev({
          id: "r3", at: 24, src: "visitor", dst: "load balancer", layer: "net", size: "74 B", title: "TCP SYN", path: ["visitor", "lb"],
          says: "The browser sends the first packet of a connection to the load balancer.",
          info: `SYN ${VISITOR} → 203.0.113.50:80`,
          frame: [layer("Ethernet", "MACs", 14), layer("IPv4", "198.51.100.7 → 203.0.113.50", 20), layer("TCP", "51514 → 80 [SYN]", 40)],
          decoded: [sec("IPv4", [["src", "198.51.100.7"], ["dst", "203.0.113.50"]]), sec("TCP", [["src port", "51514"], ["dst port", "80"], ["flags", "SYN"]])],
          note: "Real sites use HTTPS on port 443. The path through the cluster is the same; only the bytes inside are encrypted.",
        }),
      ],
    },
    {
      title: "ONTO A NODE",
      subtitle: "The load balancer picks node-1",
      body: "The load balancer doesn't know about Pods. It knows the nodes, and it health-checks the Service's NodePort, 30080, on each of them. It picks node-1 and rewrites the packet's destination to 10.0.1.11:30080. This load balancer keeps the visitor's address as the source.",
      facts: [
        ["HEALTHY", "node-1, node-2"],
        ["PICKED", "node-1"],
        ["NEW DESTINATION", "10.0.1.11:30080"],
      ],
      view: "cluster",
      focus: ["lb", "node1", "node2"],
      events: [
        ev({
          id: "r4", at: 36, src: "load balancer", dst: "load balancer", layer: "net", size: " - ", title: "PICK A NODE", path: ["lb", "lb"],
          says: "The load balancer checks which nodes are healthy and picks node-1.",
          info: "health checks: node-1 ✓ node-2 ✓ → node-1",
          decoded: [sec("TARGETS", [["node-1 · 10.0.1.11:30080", "healthy"], ["node-2 · 10.0.1.12:30080", "healthy"], ["picked", "node-1", true]])],
          note: "Every node opens port 30080, even one with no web Pods. That's what externalTrafficPolicy: Cluster means.",
        }),
        ev({
          id: "r5", at: 36.2, src: "load balancer", dst: "node-1", layer: "net", size: "74 B", title: "FORWARD TO NODEPORT", path: ["lb", "node1"],
          says: "It forwards the packet to node-1, on the Service's NodePort, 30080.",
          info: `SYN ${VISITOR} → 10.0.1.11:30080`,
          frame: [layer("Ethernet", "MACs", 14), layer("IPv4", "198.51.100.7 → 10.0.1.11", 20), layer("TCP", "51514 → 30080 [SYN]", 40)],
          decoded: [sec("REWRITE", [["dst ip", "203.0.113.50 → 10.0.1.11", true], ["dst port", "80 → 30080", true], ["src", `${VISITOR} (kept)`]])],
        }),
      ],
    },
    {
      title: "KUBE-PROXY'S RULES",
      subtitle: "The kernel picks a Pod and rewrites",
      body: "Zoom into node-1. kube-proxy never touches this packet: it only wrote iptables rules ahead of time, from the Service and its EndpointSlices. The kernel walks those rules, picks one of the three web Pods at random, and rewrites the destination to that Pod's IP. Because the Pod might be on another node, it also rewrites the source, so the reply has to come back through node-1.",
      facts: [
        ["MATCHED", "tcp dpt:30080 in KUBE-NODEPORTS"],
        ["PICKED", "10.244.2.17:8080 on node-2"],
        ["DNAT", "dst → 10.244.2.17:8080"],
        ["SNAT", "src → 10.244.1.0 (flannel.1)"],
      ],
      view: "node1",
      focus: ["n1.eth0", "n1.iptables", "n1.flannel"],
      events: [
        ev({
          id: "r6", at: 36.5, src: "eth0 · node-1", dst: "iptables", layer: "net", size: "74 B", title: "MATCH THE NODEPORT", path: ["n1.eth0", "n1.iptables"],
          says: "On node-1, the kernel's iptables rules recognise port 30080 as the web Service.",
          info: "nat PREROUTING → KUBE-SERVICES → KUBE-NODEPORTS dpt:30080",
          decoded: [sec("RULE WALK · TABLE NAT", [["PREROUTING", "-j KUBE-SERVICES"], ["KUBE-SERVICES", "no ClusterIP match -j KUBE-NODEPORTS"], ["KUBE-NODEPORTS", "tcp dpt:30080 -j KUBE-EXT-QD4FJ…"], ["KUBE-EXT-QD4FJ…", "-j KUBE-MARK-MASQ, -j KUBE-SVC-QD4FJ…"]])],
        }),
        ev({
          id: "r7", at: 36.5, src: "iptables", dst: "iptables", layer: "net", size: " - ", title: "PICK AN ENDPOINT", path: ["n1.iptables", "n1.iptables"],
          says: "The rules pick one of the three web Pods at random: 10.244.2.17, on node-2.",
          info: "KUBE-SVC-QD4FJ…: random pick → 10.244.2.17:8080",
          decoded: [sec("KUBE-SVC-QD4FJ…", [["rule 1 · p=0.333", "→ 10.244.1.12:8080 (node-1)"], ["rule 2 · p=0.5", "→ 10.244.2.17:8080 (node-2)", true], ["rule 3 · the rest", "→ 10.244.2.18:8080 (node-2)"]])],
          note: "iptables can't pick from a list, so kube-proxy chains rules: a 1/3 chance, then 1/2 of what's left, then everything else. Each Pod gets an equal share. This time rule 2 won.",
        }),
        ev({
          id: "r8", at: 36.5, src: "iptables", dst: "iptables", layer: "net", size: "74 B", title: "DNAT", path: ["n1.iptables", "n1.iptables"],
          says: "The destination is rewritten from node-1:30080 to the Pod's IP and port.",
          info: "DNAT 10.0.1.11:30080 → 10.244.2.17:8080",
          frame: [layer("Ethernet", "MACs", 14), layer("IPv4", "198.51.100.7 → 10.244.2.17", 20), layer("TCP", "51514 → 8080 [SYN]", 40)],
          decoded: [sec("IPV4 + TCP · BEFORE → AFTER", [["dst ip", "10.0.1.11 → 10.244.2.17", true], ["dst port", "30080 → 8080", true], ["src", `${VISITOR}`]]), sec("CONNTRACK", [["new entry", "remembers both rewrites for the reply"]])],
        }),
        ev({
          id: "r9", at: 36.6, src: "iptables", dst: "flannel.1 · node-1", layer: "net", size: "74 B", title: "MASQUERADE", path: ["n1.iptables", "n1.flannel"],
          says: "The source is rewritten too, so the reply will come back through node-1.",
          info: "SNAT 198.51.100.7 → 10.244.1.0",
          decoded: [sec("POSTROUTING · KUBE-POSTROUTING", [["marked", "yes (KUBE-MARK-MASQ)"], ["src ip", "198.51.100.7 → 10.244.1.0", true], ["leaves via", "flannel.1, route 10.244.2.0/24"]])],
          note: "The Pod will see node-1's flannel address, not the visitor's. Setting externalTrafficPolicy: Local keeps the real source, but then only nodes running a web Pod accept traffic.",
        }),
      ],
    },
    {
      title: "ACROSS NODES",
      subtitle: "Wrapped in VXLAN, sent to node-2",
      body: "10.244.2.17 lives on node-2, and the network between nodes knows nothing about Pod IPs. So flannel wraps the whole packet inside a UDP packet addressed from node-1 to node-2, port 8472. To the network it's ordinary node-to-node traffic.",
      facts: [
        ["OUTER", "10.0.1.11 → 10.0.1.12, UDP 8472"],
        ["INNER", "10.244.1.0 → 10.244.2.17:8080"],
        ["OVERHEAD", "50 bytes per packet"],
      ],
      view: "cluster",
      focus: ["node1", "node2"],
      events: [
        ev({
          id: "r10", at: 36.6, src: "flannel.1 · node-1", dst: "flannel.1 · node-1", layer: "net", size: " - ", title: "WRAP IN VXLAN", path: ["node1", "node1"],
          says: "The Pod lives on node-2, so flannel prepares to wrap the packet for the trip.",
          info: "route 10.244.2.0/24 via flannel.1 → encapsulate",
          decoded: [sec("ROUTE + FDB LOOKUP", [["route", "10.244.2.0/24 via 10.244.2.0 dev flannel.1"], ["VTEP for 10.244.2.0", "node-2 · 10.0.1.12"], ["VNI", "1"]])],
        }),
        ev({
          id: "r11", at: 36.7, src: "node-1", dst: "node-2", layer: "net", size: "124 B", title: "VXLAN PACKET", path: ["node1", "node2"],
          says: "The packet travels inside a UDP packet from node-1 to node-2.",
          info: "UDP 10.0.1.11 → 10.0.1.12:8472 [VXLAN, inner SYN → 10.244.2.17:8080]",
          frame: [
            layer("Ethernet", "outer MACs", 14), layer("IPv4", "10.0.1.11 → 10.0.1.12", 20), layer("UDP", "→ 8472", 8), layer("VXLAN", "VNI 1", 8),
            layer("Ethernet", "inner MACs", 14, true), layer("IPv4", "10.244.1.0 → 10.244.2.17", 20, true), layer("TCP", "51514 → 8080 [SYN]", 40, true),
          ],
          decoded: [sec("OUTER (WHAT THE NETWORK SEES)", [["src", "10.0.1.11 (node-1)"], ["dst", "10.0.1.12:8472 (node-2)"], ["VNI", "1"]]), sec("INNER (THE ORIGINAL PACKET)", [["src", "10.244.1.0:51514"], ["dst", "10.244.2.17:8080"]])],
        }),
      ],
    },
    {
      title: "INTO THE POD",
      subtitle: "Unwrap, bridge, veth",
      body: "Zoom into node-2. The packet arrives on eth0 as UDP port 8472, which the kernel hands to flannel.1 to unwrap. The inner packet is for 10.244.2.17, and the route for 10.244.2.0/24 points at the cni0 bridge. The bridge forwards it out of the port that leads to the Pod: one end of a veth pair whose other end is the Pod's eth0.",
      facts: [
        ["ARRIVES", "eth0 · UDP 8472"],
        ["UNWRAPPED BY", "flannel.1"],
        ["ROUTE", "10.244.2.0/24 dev cni0"],
        ["DELIVERED TO", "veth3b1c → Pod eth0"],
      ],
      view: "node2",
      focus: ["n2.eth0", "n2.flannel", "n2.cni0", "n2.podA"],
      events: [
        ev({
          id: "r12", at: 37.1, src: "eth0 · node-2", dst: "flannel.1 · node-2", layer: "net", size: "74 B", title: "UNWRAP", path: ["n2.eth0", "n2.flannel"],
          says: "node-2 unwraps it, revealing the original packet for 10.244.2.17.",
          info: "UDP 8472 → flannel.1 strips 50 bytes",
          decoded: [sec("DECAPSULATE", [["removed", "outer Ethernet, IPv4, UDP, VXLAN (50 B)"], ["inner", "10.244.1.0 → 10.244.2.17:8080", true]])],
        }),
        ev({
          id: "r13", at: 37.1, src: "flannel.1 · node-2", dst: "cni0", layer: "net", size: "74 B", title: "ROUTE TO THE BRIDGE", path: ["n2.flannel", "n2.cni0"],
          says: "node-2 routes it to the bridge where its Pods are plugged in.",
          info: "route 10.244.2.0/24 dev cni0",
          decoded: [sec("ROUTE LOOKUP", [["dst", "10.244.2.17"], ["matches", "10.244.2.0/24 dev cni0 (local Pods)"]])],
        }),
        ev({
          id: "r14", at: 37.2, src: "cni0", dst: "web-…-x2kqp", layer: "net", size: "74 B", title: "BRIDGE TO THE POD", path: ["n2.cni0", "n2.podA"],
          says: "The bridge hands it down the virtual cable that leads into the Pod.",
          info: "bridge → port veth3b1c → Pod eth0",
          decoded: [sec("BRIDGE", [["lookup", "MAC of 10.244.2.17"], ["port", "veth3b1c", true], ["other end", "eth0 inside the Pod's namespace"]])],
        }),
      ],
    },
    {
      title: "THE APP ANSWERS",
      subtitle: "Inside the Pod's network namespace",
      body: "Zoom into the Pod. The packet comes through the veth pair to eth0, the Pod's only interface. The web container shares this network namespace with the pause container, so it sees eth0 as its own. It accepts the connection, reads GET / once the handshake is done, and answers 200 OK.",
      facts: [
        ["LISTENING", "0.0.0.0:8080"],
        ["SEES CLIENT AS", "10.244.1.0:51514"],
        ["RESPONSE", "200 OK · 12.4 KB"],
      ],
      view: "pod",
      focus: ["p.veth", "p.eth0", "p.app"],
      events: [
        ev({
          id: "r15", at: 37.2, src: "veth3b1c", dst: "eth0 · Pod", layer: "net", size: "74 B", title: "ACROSS THE VETH PAIR", path: ["p.veth", "p.eth0"],
          says: "The packet comes out on the Pod's own network card, eth0.",
          info: "SYN arrives on eth0 10.244.2.17:8080",
          decoded: [sec("PACKET AT ETH0", [["src", "10.244.1.0:51514"], ["dst", "10.244.2.17:8080"]])],
        }),
        ev({
          id: "r16", at: 37.3, src: "eth0 · Pod", dst: "web", layer: "net", size: " - ", title: "ACCEPT", path: ["p.eth0", "p.app"],
          says: "The app accepts the connection. It sees node-1's address, not the visitor's.",
          info: "accept(): connection from 10.244.1.0:51514",
          decoded: [sec("SOCKET", [["local", "10.244.2.17:8080"], ["remote", "10.244.1.0:51514", true]])],
          note: "The app sees node-1's flannel address, not the visitor. Load balancers that speak HTTP add an X-Forwarded-For header to keep the real address.",
        }),
        ev({
          id: "r17", at: 49, src: "web", dst: "eth0 · Pod", layer: "net", size: "12.4 KB", title: "200 OK", path: ["p.app", "p.eth0"],
          says: "The app sends back the page: 200 OK.",
          info: "HTTP/1.1 200 OK (text/html, 9 segments)",
          decoded: [sec("HTTP RESPONSE", [["status", "200 OK"], ["content-type", "text/html"], ["body", "12.4 KB in 9 TCP segments"]])],
        }),
      ],
    },
    {
      title: "BACK TO THE VISITOR",
      subtitle: "Every rewrite undone",
      body: "The reply is addressed to 10.244.1.0, so it goes back across the VXLAN tunnel to node-1. There, conntrack finds the entry it made for the SYN and reverses both rewrites. The load balancer swaps its own address back in, and the visitor receives a reply from 203.0.113.50:80, exactly where it sent the request.",
      facts: [
        ["UN-DNAT", "src 10.244.2.17:8080 → 10.0.1.11:30080"],
        ["UN-SNAT", "dst 10.244.1.0 → 198.51.100.7"],
        ["VISITOR SEES", "203.0.113.50:80"],
      ],
      view: "cluster",
      focus: ["visitor", "lb", "node1", "node2"],
      events: [
        ev({
          id: "r18", at: 49.2, src: "node-2", dst: "node-1", layer: "net", size: "12.5 KB", title: "VXLAN REPLY", path: ["node2", "node1"],
          says: "The reply travels back to node-1, wrapped in UDP again.",
          info: "UDP 10.0.1.12 → 10.0.1.11:8472 [inner 10.244.2.17:8080 → 10.244.1.0:51514]",
          decoded: [sec("INNER", [["src", "10.244.2.17:8080"], ["dst", "10.244.1.0:51514"]])],
        }),
        ev({
          id: "r19", at: 49.6, src: "conntrack · node-1", dst: "conntrack · node-1", layer: "net", size: " - ", title: "REVERSE THE NAT", path: ["node1", "node1"],
          says: "node-1 remembers the rewrites it made, and undoes both of them.",
          info: "conntrack: undo SNAT and DNAT",
          decoded: [sec("BEFORE → AFTER", [["src", "10.244.2.17:8080 → 10.0.1.11:30080", true], ["dst", `10.244.1.0:51514 → ${VISITOR}`, true]])],
        }),
        ev({
          id: "r20", at: 49.6, src: "node-1", dst: "load balancer", layer: "net", size: "12.5 KB", title: "OUT OF THE NODE", path: ["node1", "lb"],
          says: "The reply leaves node-1 for the load balancer.",
          info: `10.0.1.11:30080 → ${VISITOR}`,
          decoded: [sec("IPV4 + TCP", [["src", "10.0.1.11:30080"], ["dst", VISITOR]])],
        }),
        ev({
          id: "r21", at: 62, src: "load balancer", dst: "visitor", layer: "net", size: "12.5 KB", title: "REPLY DELIVERED", path: ["lb", "visitor"],
          says: "The load balancer puts its own address back. The visitor gets the page.",
          info: `203.0.113.50:80 → ${VISITOR}`,
          decoded: [sec("REWRITE", [["src", "10.0.1.11:30080 → 203.0.113.50:80", true], ["dst", VISITOR]])],
          note: "The visitor only ever saw 203.0.113.50. Every change on the way in was undone on the way out.",
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "DNS lookup", layer: "net", start: 0, duration: 22 },
    { value: "t2", label: "Internet → load balancer", layer: "net", start: 24, duration: 12 },
    { value: "t3", label: "LB → node-1", layer: "net", start: 36, duration: 0.4 },
    { value: "t4", label: "iptables rewrites", layer: "net", start: 36.5, duration: 0.1 },
    { value: "t5", label: "VXLAN to node-2", layer: "net", start: 36.6, duration: 0.5 },
    { value: "t6", label: "Bridge into the Pod", layer: "net", start: 37.1, duration: 0.2 },
    { value: "t7", label: "App handles the request", layer: "node", start: 37.3, duration: 11.7 },
    { value: "t8", label: "Reply back to visitor", layer: "net", start: 49, duration: 13 },
  ],
  summary: {
    title: "ROUND TRIP",
    body: "Three rewrites on the way in (load balancer to NodePort, NodePort to Pod, visitor to node-1) and one wrap to cross nodes. conntrack and the load balancer undid every one on the way out. Almost all of the 62 ms was the internet and the app; the cluster's own hops took well under a millisecond.",
    facts: [
      ["HOPS", "visitor → LB → node-1 → node-2 → Pod"],
      ["INSIDE THE CLUSTER", "< 1 ms"],
      ["NEXT", "Rolling update"],
    ],
  },
}
