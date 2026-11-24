import type { Lesson } from "../types"
import { ev, layer, sec } from "./helpers"

const SENDER = "web-…-x2kqp"
const PEER = "web-…-p8m4z"
const PEER_MAC = "5a:1d:e8:77:c4:18"

export const podToPodSameNode: Lesson = {
  id: "pod-to-pod-same-node",
  title: "Pod to Pod, same node",
  subtitle: "veth pairs and the bridge",
  category: "network",
  seo: {
    title: "Kubernetes Pod networking on one node",
    description: "How two Pods on the same Kubernetes node talk: veth pairs, a Linux bridge, ARP and plain Ethernet switching, with no overlay and no NAT.",
  },
  actors: ["node1", "node2"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    [SENDER]: "web · x2kqp", veth3b1c: "eth0 · x2kqp",
    [PEER]: "web · p8m4z", veth7c92: "eth0 · p8m4z",
  },
  overview: {
    body: "Two Pods on one node talk through a pair of virtual cables and a Linux bridge. No overlay, no NAT. Everything between them is plain Ethernet switching on their shared subnet, 10.244.2.0/24 - the fastest network in the cluster.",
    facts: [
      ["SENDER", `${SENDER} · 10.244.2.17`],
      ["RECEIVER", `${PEER} · 10.244.2.18:8080`],
      ["SHARED SUBNET", "10.244.2.0/24 on cni0 · node-2"],
      ["ROUND TRIP", "≈ 0.3 ms · no overlay, no NAT"],
    ],
  },
  steps: [
    {
      title: "INSIDE THE SENDER",
      subtitle: "the app opens a connection",
      body: "Zoom into web-…-x2kqp on node-2. Its app calls connect() for 10.244.2.18:8080 - its peer Pod, p8m4z, on the same node. The kernel picks ephemeral port 46118 and builds a 74-byte SYN, then parks it: it won't send until it knows which MAC address to hand it to.",
      facts: [
        ["CALL", "connect(10.244.2.18:8080)"],
        ["LOCAL", "10.244.2.17:46118 (ephemeral)"],
        ["MSS", "1410 · MTU 1450 − 40 B of IP and TCP headers"],
      ],
      view: "pod",
      focus: ["p.app", "p.eth0"],
      events: [
        ev({
          id: "sn1", at: 0, src: "web · x2kqp", dst: "eth0 · x2kqp", layer: "net", size: " - ", title: "CONNECT()", path: ["p.app", "p.eth0"],
          says: "The app asks its kernel for a TCP connection to the peer Pod's IP.",
          info: "connect(10.244.2.18:8080) from 10.244.2.17:46118",
          decoded: [sec("SYSCALL", [["call", "connect(fd, 10.244.2.18:8080)"], ["local", "10.244.2.17 · port 46118 picked", true], ["state", "SYN_SENT"]])],
        }),
        ev({
          id: "sn2", at: 0.005, src: "eth0 · x2kqp", dst: "eth0 · x2kqp", layer: "net", size: "74 B", title: "SYN QUEUED", path: ["p.eth0", "p.eth0"],
          says: "The kernel builds the SYN but holds it until it knows the neighbor's MAC address.",
          info: "SYN built, waiting on the next-hop MAC",
          frame: [layer("Ethernet", "no dst MAC yet", 14), layer("IPv4", "10.244.2.17 → 10.244.2.18", 20), layer("TCP", "46118 → 8080 [SYN]", 40)],
          decoded: [sec("TCP · SYN", [["src", "10.244.2.17:46118"], ["dst", "10.244.2.18:8080"], ["flags", "SYN · window 64240"], ["mss", "1410"]])],
          note: "eth0's MTU is 1450 even here, because this same interface must also reach Pods on other nodes through the 50-byte VXLAN wrap.",
        }),
      ],
    },
    {
      title: "FIND THE NEXT HOP",
      subtitle: "route lookup, then ARP",
      body: "The route table in the Pod's namespace has a connected route for its own subnet: 10.244.2.0/24 on eth0. So 10.244.2.18 is a neighbor, not a gateway hop - the kernel ARPs for the destination itself. The bridge floods the broadcast to every port, and p8m4z's kernel answers with its MAC 40 µs later.",
      facts: [
        ["ROUTE", "10.244.2.0/24 dev eth0 · scope link"],
        ["ARP ANSWER", `10.244.2.18 is at 5a:1d:…:18`],
        ["COST", "≈ 40 µs"],
      ],
      view: "pod",
      focus: ["p.eth0", "p.veth"],
      events: [
        ev({
          id: "sn3", at: 0.01, src: "eth0 · x2kqp", dst: "eth0 · x2kqp", layer: "net", size: " - ", title: "ROUTE LOOKUP", path: ["p.eth0", "p.eth0"],
          says: "The route table says the destination is on this subnet: no gateway, no tunnel.",
          info: "ip route get 10.244.2.18 → dev eth0 src 10.244.2.17",
          decoded: [sec("ROUTE TABLE · POD NETNS", [["10.244.2.0/24", "dev eth0 src 10.244.2.17 (connected)"], ["default", "via 10.244.2.1 dev eth0"], ["result", "on-link → ARP for 10.244.2.18 itself", true]])],
        }),
        ev({
          id: "sn4", at: 0.02, src: "eth0 · x2kqp", dst: "veth3b1c", layer: "net", size: "42 B", title: "ARP REQUEST", path: ["p.eth0", "p.veth"],
          says: "Who owns 10.244.2.18? The question is broadcast to everyone on the bridge.",
          info: "arp who has 10.244.2.18? tell 10.244.2.17",
          frame: [layer("Ethernet", "ff:ff:ff:ff:ff:ff · broadcast", 14), layer("ARP", "who has 10.244.2.18?", 28)],
          decoded: [sec("ARP REQUEST", [["opcode", "1 · request"], ["sender", "10.244.2.17 (6e:9c:…:17)"], ["target", "10.244.2.18"]])],
        }),
        ev({
          id: "sn5", at: 0.06, src: "veth3b1c", dst: "eth0 · x2kqp", layer: "net", size: "42 B", title: "ARP REPLY", path: ["p.veth", "p.eth0"],
          says: "p8m4z answers: that IP lives at MAC 5a:1d:…:18.",
          info: `10.244.2.18 is at ${PEER_MAC}`,
          frame: [layer("Ethernet", "unicast to 6e:9c:…:17", 14), layer("ARP", "10.244.2.18 is at 5a:1d:…:18", 28)],
          decoded: [sec("ARP REPLY", [["opcode", "2 · reply"], ["10.244.2.18", `is at ${PEER_MAC}`, true], ["cached", "neighbor entry · refreshed if stale"]])],
          note: "The bridge was listening: it learned which port each MAC lives on, so the SYN itself won't be flooded.",
        }),
      ],
    },
    {
      title: "ACROSS THE BRIDGE",
      subtitle: "one hop of plain L2 switching",
      body: "Zoom out to node-2. Everything between two namespaces on one node is a veth pair: bytes written to eth0 inside the Pod come out on veth3b1c in the node's namespace. veth3b1c is a port on the cni0 bridge, and a bridge is a switch. It looks up 5a:1d:…:18 in its forwarding database and sends the frame out of exactly one port: veth7c92, the cable into p8m4z.",
      facts: [
        ["IN PORT", "veth3b1c"],
        ["FDB", "5a:1d:…:18 → veth7c92"],
        ["FLOODED", "no · learned from the ARP"],
      ],
      view: "node2",
      focus: ["n2.podA", "n2.cni0", "n2.podB"],
      events: [
        ev({
          id: "sn6", at: 0.08, src: SENDER, dst: "veth3b1c", layer: "net", size: "74 B", title: "DOWN THE VETH", path: ["n2.podA", "n2.cni0"],
          says: "The finished frame drops out of the Pod's eth0 and appears on the node side of the same cable.",
          info: "eth0 (pod netns) → veth3b1c (node netns)",
          frame: [layer("Ethernet", "dst 5a:1d:…:18", 14), layer("IPv4", "10.244.2.17 → 10.244.2.18", 20), layer("TCP", "46118 → 8080 [SYN]", 40)],
          decoded: [sec("VETH PAIR", [["pod end", "eth0 · inside the netns"], ["node end", "veth3b1c · a port of cni0", true]])],
        }),
        ev({
          id: "sn7", at: 0.09, src: "cni0", dst: "cni0", layer: "net", size: " - ", title: "FDB LOOKUP", path: ["n2.cni0", "n2.cni0"],
          says: "cni0 is a switch: it looks the destination MAC up and picks one port.",
          info: "bridge fdb: 5a:1d:…:18 dev cni0 → port veth7c92",
          decoded: [sec("FORWARDING DATABASE", [["lookup", "5a:1d:…:18"], ["port", "veth7c92 · p8m4z's veth", true], ["flood", "unnecessary · learned during ARP"]])],
        }),
        ev({
          id: "sn8", at: 0.095, src: "cni0", dst: "veth7c92", layer: "net", size: "74 B", title: "FORWARD", path: ["n2.cni0", "n2.podB"],
          says: "The frame goes out of that port, toward the Pod on its far end.",
          info: "frame out port veth7c92",
          decoded: [sec("FRAME", [["dst MAC", "5a:1d:…:18 · p8m4z's eth0"], ["payload", "SYN 10.244.2.17:46118 → :8080"]])],
        }),
      ],
    },
    {
      title: "INTO THE PEER",
      subtitle: "a routable IP, no NAT",
      body: "The far end of that cable lives in p8m4z's network namespace, so the frame simply appears on its eth0. The app is listening on 0.0.0.0:8080 and accepts. It sees the client as 10.244.2.17:46118 - a real, routable Pod IP. No address was translated anywhere: both Pods are peers on the same subnet.",
      facts: [
        ["POD END", "eth0 · 10.244.2.18 in its own netns"],
        ["REMOTE SEEN", "10.244.2.17:46118"],
        ["NAT", "none"],
      ],
      view: "node2",
      focus: ["n2.cni0", "n2.podB"],
      events: [
        ev({
          id: "sn9", at: 0.1, src: "veth7c92", dst: PEER, layer: "net", size: "74 B", title: "NAMESPACE HOP", path: ["n2.podB", "n2.podB"],
          says: "The cable's far end is inside the other Pod's namespace: the frame just appears on its eth0.",
          info: "bytes appear on eth0 inside p8m4z's netns",
          decoded: [sec("VETH PAIR · OTHER END", [["node end", "veth7c92 · node netns"], ["pod end", "eth0 · 10.244.2.18, own netns", true]])],
        }),
        ev({
          id: "sn10", at: 0.12, src: PEER, dst: PEER, layer: "net", size: " - ", title: "ACCEPT", path: ["n2.podB", "n2.podB"],
          says: "The app accepts and sees the sender exactly as it is: 10.244.2.17.",
          info: "accept(): connection from 10.244.2.17:46118",
          decoded: [sec("SOCKET · P8M4Z", [["listening", "0.0.0.0:8080"], ["remote", "10.244.2.17:46118", true], ["rewrites", "none · both IPs are real"]])],
          note: "10.244.2.17 is routable from every node, so the peer can answer directly. NAT is only ever for Service or outside addresses.",
        }),
      ],
    },
    {
      title: "THE MIRROR PATH",
      subtitle: "SYN-ACK, GET, 200 - same road back",
      body: "The SYN-ACK retraces the same three hops in reverse: p8m4z's veth, the bridge - same two FDB entries, other direction - and the sender's veth. connect() returns after 0.16 ms. The GET and its 200 OK cross the same bridge ports for as long as the connection lives.",
      facts: [
        ["PATH", "same bridge ports, reversed"],
        ["ESTABLISHED", "0.16 ms after connect()"],
        ["PAYLOAD", "GET /healthz → 200 OK"],
      ],
      view: "node2",
      focus: ["n2.podA", "n2.cni0", "n2.podB"],
      events: [
        ev({
          id: "sn11", at: 0.14, src: PEER, dst: "cni0", layer: "net", size: "74 B", title: "SYN-ACK", path: ["n2.podB", "n2.cni0"],
          says: "The reply takes the same road backwards: veth, bridge, veth.",
          info: "10.244.2.18:8080 → 10.244.2.17:46118 [SYN,ACK]",
          frame: [layer("Ethernet", "dst 6e:9c:…:17", 14), layer("IPv4", "10.244.2.18 → 10.244.2.17", 20), layer("TCP", "8080 → 46118 [SYN,ACK]", 40)],
          decoded: [sec("TCP · SYN-ACK", [["src", "10.244.2.18:8080"], ["dst", "10.244.2.17:46118"], ["flags", "SYN + ACK"]])],
        }),
        ev({
          id: "sn12", at: 0.15, src: "cni0", dst: SENDER, layer: "net", size: "74 B", title: "BRIDGE, REVERSED", path: ["n2.cni0", "n2.podA"],
          says: "Same two bridge ports, opposite direction.",
          info: "fdb: 6e:9c:…:17 → port veth3b1c",
          decoded: [sec("FDB LOOKUP", [["lookup", "6e:9c:…:17"], ["port", "veth3b1c", true]])],
        }),
        ev({
          id: "sn13", at: 0.16, src: SENDER, dst: SENDER, layer: "net", size: " - ", title: "ESTABLISHED", path: ["n2.podA", "n2.podA"],
          says: "The handshake completes, 0.16 ms after connect().",
          info: "connect() returns 0",
          decoded: [sec("SOCKET · X2KQP", [["state", "SYN_SENT → ESTABLISHED", true], ["peer", "10.244.2.18:8080"], ["rtt sample", "≈ 0.08 ms"]])],
        }),
        ev({
          id: "sn14", at: 0.2, src: SENDER, dst: PEER, layer: "net", size: "0.2 KB", title: "GET /HEALTHZ", path: ["n2.podA", "n2.podB"],
          says: "The request crosses the bridge like any other frame.",
          info: "GET /healthz → :8080 (1 segment)",
          decoded: [sec("HTTP REQUEST", [["method", "GET"], ["path", "/healthz"], ["host", "10.244.2.18:8080"]])],
        }),
        ev({
          id: "sn15", at: 0.3, src: PEER, dst: SENDER, layer: "net", size: "0.2 KB", title: "200 OK", path: ["n2.podB", "n2.podA"],
          says: "The answer comes back the same way, 0.3 ms after the connect().",
          info: "200 OK · body \"ok\"",
          decoded: [sec("HTTP RESPONSE", [["status", "200 OK"], ["body", "ok"]])],
        }),
      ],
    },
    {
      title: "NEVER LEFT THE NODE",
      subtitle: "what the rest of the cluster saw",
      body: "Nothing about this exchange left node-2. Kubernetes turns on br_netfilter, so even bridged frames pass through iptables, and the Service chains were walked. But they match 10.96.120.15 - a ClusterIP - and this packet was addressed to a Pod IP, so nothing hit. The node's eth0 and the VXLAN device stayed idle; node-1 never saw a byte.",
      facts: [
        ["VXLAN PACKETS", "0"],
        ["SERVICE RULES MATCHED", "0 · Pod IP, not ClusterIP"],
        ["NODE-1 SAW", "nothing"],
      ],
      view: "cluster",
      focus: ["node1", "node2"],
      events: [
        ev({
          id: "sn16", at: 0.4, src: "iptables", dst: "iptables", layer: "net", size: " - ", title: "NO RULE MATCHED", path: ["node2", "node2"],
          says: "kube-proxy's rules were consulted but matched nothing.",
          info: "KUBE-SERVICES counters unchanged",
          decoded: [sec("WHY NOT", [["dst was", "10.244.2.18 · a Pod IP"], ["rules match", "10.96.120.15 (ClusterIP) and NodePorts"], ["counters", "unchanged", true]])],
        }),
        ev({
          id: "sn17", at: 0.41, src: "eth0 · node-2", dst: "eth0 · node-2", layer: "net", size: " - ", title: "ETH0 STAYED QUIET", path: ["node2", "node2"],
          says: "The node's real network card never saw any of it, and node-1 saw nothing at all.",
          info: "tcpdump -i eth0 udp port 8472 → 0 packets",
          decoded: [sec("WHAT THE CLUSTER SAW", [["VXLAN (udp 8472)", "0 packets"], ["node-1", "never involved", true]])],
          note: "Same-node is the fast path: no 50-byte wrapper, no encapsulation work - just a bridge doing L2 switching between two memory copies.",
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "connect() + SYN queued", layer: "net", start: 0, duration: 0.005 },
    { value: "t2", label: "Route + ARP", layer: "net", start: 0.01, duration: 0.05 },
    { value: "t3", label: "Across veth + bridge", layer: "net", start: 0.08, duration: 0.02 },
    { value: "t4", label: "Into the peer, accept", layer: "node", start: 0.1, duration: 0.04 },
    { value: "t5", label: "Handshake + request", layer: "net", start: 0.14, duration: 0.16 },
    { value: "t6", label: "Aftermath check", layer: "net", start: 0.4, duration: 0.01 },
  ],
  summary: {
    title: "PLAIN SWITCHING",
    body: "One connection, a few hops of plain Ethernet: app to eth0, veth to veth through the cni0 bridge, eth0 to app. Nothing was translated, nothing was wrapped, and no rule matched - the destination was a Pod IP, not a Service. To these two Pods the node is just a switch with very short cables.",
    facts: [
      ["WHAT RAN", "a Linux bridge (cni0) and two veth pairs"],
      ["COST", "connect() to 200 OK in ≈ 0.3 ms"],
      ["NEXT", "Pod to Pod, across nodes"],
    ],
  },
}
