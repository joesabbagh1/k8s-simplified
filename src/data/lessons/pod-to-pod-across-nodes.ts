import type { Lesson } from "../types"
import { ev, layer, sec } from "./helpers"

const KQ9TW = "web-…-kq9tw"
const X2KQP = "web-…-x2kqp"
const VTEP2_MAC = "32:47:a1:5c:9e:df"
const X2KQP_MAC = "6e:9c:b0:3f:a2:17"

export const podToPodAcrossNodes: Lesson = {
  id: "pod-to-pod-across-nodes",
  title: "Pod to Pod, across nodes",
  subtitle: "The VXLAN overlay",
  category: "network",
  seo: {
    title: "Kubernetes VXLAN overlay, packet by packet",
    description: "How a packet gets from a Pod on one Kubernetes node to a Pod on another: flannel wraps it in VXLAN over UDP, sends it and unwraps it.",
  },
  actors: ["node1", "node2"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    [KQ9TW]: "Pod kq9tw", "cni0 · node-1": "node-1", "eth0 · node-1": "node-1",
    "eth0 · node-2": "node-2", "flannel.1 · node-2": "node-2", cni0: "node-2",
    [X2KQP]: "Pod x2kqp", veth3b1c: "Pod x2kqp", "eth0 · Pod": "Pod x2kqp", web: "Pod x2kqp",
  },
  overview: {
    body: "A packet between nodes is wrapped inside another packet, sent node to node, and unwrapped on the other side. Pod IPs mean nothing outside a node, so flannel hides the whole Pod network inside ordinary UDP traffic between the nodes themselves.",
    facts: [
      ["SENDER", `${KQ9TW} · 10.244.1.12 · node-1`],
      ["RECEIVER", `${X2KQP} · 10.244.2.17 · node-2`],
      ["TUNNEL", "VXLAN · VNI 1 · UDP 8472 · +50 B"],
      ["UNDERLAY", "one UDP packet 10.0.1.11 → 10.0.1.12"],
    ],
  },
  steps: [
    {
      title: "NOT ON THIS SUBNET",
      subtitle: "the Pod hands up, the node looks further",
      body: "web-…-kq9tw's own subnet is 10.244.1.0/24, and 10.244.2.17 isn't in it, so the Pod sends the SYN to its default gateway: 10.244.1.1, the cni0 bridge. The node's own route table takes over from there: 10.244.2.0/24 lives via 10.244.2.0 on flannel.1, the overlay device. The next-hop MAC isn't found with a broadcast - flannel pre-installed a permanent neighbor entry mapping 10.244.2.0 to node-2's tunnel endpoint.",
      facts: [
        ["POD ROUTE", "default via 10.244.1.1 (cni0)"],
        ["NODE ROUTE", "10.244.2.0/24 via 10.244.2.0 dev flannel.1"],
        ["NEIGHBOR", "permanent entry · no wire ARP"],
      ],
      view: "node1",
      focus: ["n1.podA", "n1.cni0", "n1.flannel"],
      events: [
        ev({
          id: "ax1", at: 0, src: KQ9TW, dst: "cni0 · node-1", layer: "net", size: " - ", title: "DEFAULT ROUTE", path: ["n1.podA", "n1.cni0"],
          says: "The destination isn't on this Pod's subnet, so the SYN goes to its default gateway: the bridge.",
          info: "10.244.2.17 not in 10.244.1.0/24 → via 10.244.1.1",
          decoded: [sec("ROUTE TABLE · POD NETNS", [["10.244.1.0/24", "dev eth0 src 10.244.1.12"], ["default", "via 10.244.1.1 dev eth0", true], ["result", "hand it to cni0, the node's bridge"]])],
        }),
        ev({
          id: "ax2", at: 0.01, src: "cni0 · node-1", dst: "flannel.1 · node-1", layer: "net", size: "74 B", title: "THE NODE TAKES OVER", path: ["n1.cni0", "n1.flannel"],
          says: "Inside the node, a different route table points at flannel.1, the overlay device.",
          info: "host route: 10.244.2.0/24 via 10.244.2.0 dev flannel.1",
          decoded: [sec("ROUTE TABLE · NODE NETNS", [["10.244.1.0/24", "dev cni0"], ["10.244.2.0/24", "via 10.244.2.0 dev flannel.1", true], ["the overlay", "one /24 per node, one big 10.244.0.0/16"]])],
        }),
        ev({
          id: "ax3", at: 0.02, src: "flannel.1 · node-1", dst: "flannel.1 · node-1", layer: "net", size: " - ", title: "WHO IS 10.244.2.0", path: ["n1.flannel", "n1.flannel"],
          says: "No ARP goes out: flannel already installed the answer - 10.244.2.0 is node-2's tunnel endpoint.",
          info: "neigh show 10.244.2.0 dev flannel.1 → PERMANENT",
          decoded: [sec("NEIGHBOR ENTRY", [["10.244.2.0", `PERMANENT · ${VTEP2_MAC}`, true], ["who wrote it", "flanneld on node-1, when node-2 joined"], ["wire ARP", "none"]])],
          note: "flanneld watches the Node objects. Each node publishes its /24 and VTEP address as annotations, and every other node pre-programs the mapping - a neighbor entry and an fdb rule - so no discovery traffic ever crosses the tunnel.",
        }),
      ],
    },
    {
      title: "WRAP IN VXLAN",
      subtitle: "a packet inside a packet",
      body: "flannel.1 builds a brand-new Ethernet frame around the IP packet, addressed not to the Pod but to node-2's flannel.1, MAC 32:47:a1:5c:9e:df. Then the whole thing becomes payload: an outer IPv4 header addressed 10.0.1.11 → 10.0.1.12, a UDP header aimed at port 8472, and an 8-byte VXLAN header saying VNI 1. The mapping \"10.244.2.0 belongs to node-2\" comes from the routes and fdb entries flannel programmed at setup.",
      facts: [
        ["INNER DST MAC", "32:47:… · node-2's flannel.1"],
        ["OUTER", "UDP 8472 · VNI 1"],
        ["MAP SOURCE", "flannel's routes + fdb"],
      ],
      view: "node1",
      focus: ["n1.flannel", "n1.eth0"],
      events: [
        ev({
          id: "ax4", at: 0.04, src: "flannel.1 · node-1", dst: "flannel.1 · node-1", layer: "net", size: "74 B", title: "INNER FRAME REBUILT", path: ["n1.flannel", "n1.flannel"],
          says: "The IP packet gets a fresh Ethernet header, addressed to node-2's flannel.1 - not to the Pod.",
          info: "new Ethernet header: dst = node-2's flannel.1",
          frame: [layer("Ethernet", "8a:d3:2f:60:b1:c4 → 32:47:a1:5c:9e:df", 14), layer("IPv4", "10.244.1.12 → 10.244.2.17", 20), layer("TCP", "41244 → 8080 [SYN]", 40)],
          decoded: [sec("INNER FRAME", [["src MAC", "8a:d3:2f:60:b1:c4 · node-1's flannel.1"], ["dst MAC", `${VTEP2_MAC} · node-2's flannel.1`, true], ["why", "the far VTEP must recognize the frame as its own"]])],
        }),
        ev({
          id: "ax5", at: 0.05, src: "flannel.1 · node-1", dst: "flannel.1 · node-1", layer: "net", size: "124 B", title: "OUTER HEADERS", path: ["n1.flannel", "n1.flannel"],
          says: "Then four headers go around the whole thing: Ethernet, IP, UDP 8472, and an 8-byte VXLAN tag.",
          info: "UDP 10.0.1.11:52301 → 10.0.1.12:8472 · VNI 1",
          frame: [layer("Ethernet", "outer MACs · toward node-2", 14), layer("IPv4", "10.0.1.11 → 10.0.1.12", 20), layer("UDP", "52301 → 8472", 8), layer("VXLAN", "flags 0x08 · VNI 1", 8)],
          decoded: [sec("VXLAN HEADER", [["flags", "0x08 · valid VNI"], ["VNI", "1 · this cluster's overlay", true], ["VTEP map", "fdb: 32:47:… → 10.0.1.12 (node-2)"]])],
        }),
        ev({
          id: "ax6", at: 0.055, src: "flannel.1 · node-1", dst: "flannel.1 · node-1", layer: "net", size: " - ", title: "MTU GUARD", path: ["n1.flannel", "n1.flannel"],
          says: "A full-size Pod packet would still fit: the interfaces were sized for this at CNI time.",
          info: "inner ≤ 1450 B always · 1500 underlay − 50 wrapper",
          decoded: [sec("SIZE CHECK", [["this SYN", "74 B of 1450"], ["max inner", "1450 · set when the veth was created", true], ["outer total", "1500 exactly · no fragmentation"]])],
          note: "TCP agrees on MSS 1410 (1450 minus 40 bytes of IP and TCP headers) during the handshake, so the tunnel never has to split a segment.",
        }),
        ev({
          id: "ax7", at: 0.058, src: "flannel.1 · node-1", dst: "eth0 · node-1", layer: "net", size: "124 B", title: "HANDED TO ETH0", path: ["n1.flannel", "n1.eth0"],
          says: "The wrapped packet is just a UDP payload now, handed to the node's real network card.",
          info: "UDP socket send → node's real NIC",
          decoded: [sec("WHAT ETH0 SEES", [["src", "10.0.1.11:52301"], ["dst", "10.0.1.12:8472"], ["payload", "82 B (VXLAN + inner) · opaque"]])],
        }),
      ],
    },
    {
      title: "ACROSS THE UNDERLAY",
      subtitle: "one plain UDP packet",
      body: "To the cluster network, this is one unremarkable 124-byte UDP packet between two machines. Routers between the nodes only ever read the outer header, so they never route on a Pod IP. The wrapper costs 50 bytes per packet, which is why every Pod interface got MTU 1450 at CNI time: 1500 minus 50, so a full-size inner packet never needs fragmenting.",
      facts: [
        ["PAYLOAD", "1 UDP packet · 124 B"],
        ["OUTER IPS", "10.0.1.11 → 10.0.1.12"],
        ["TRANSIT", "≈ 0.29 ms"],
      ],
      view: "cluster",
      focus: ["node1", "node2"],
      events: [
        ev({
          id: "ax8", at: 0.06, src: "node-1", dst: "node-2", layer: "net", size: "124 B", title: "ONE ORDINARY UDP PACKET", path: ["node1", "node2"],
          says: "To the network between nodes, this is one unremarkable UDP packet between two machines.",
          info: "10.0.1.11:52301 → 10.0.1.12:8472",
          frame: [
            layer("Ethernet", "outer MACs", 14), layer("IPv4", "10.0.1.11 → 10.0.1.12", 20), layer("UDP", "52301 → 8472", 8), layer("VXLAN", "VNI 1", 8),
            layer("Ethernet", "inner · rebuilt", 14, true), layer("IPv4", "10.244.1.12 → 10.244.2.17", 20, true), layer("TCP", "41244 → 8080 [SYN]", 40, true),
          ],
          decoded: [
            sec("OUTER (ALL THE UNDERLAY SEES)", [["src", "10.0.1.11 · node-1"], ["dst", "10.0.1.12:8472 · node-2"], ["VNI", "1"]]),
            sec("INNER (HIDDEN PAYLOAD)", [["src", "10.244.1.12:41244"], ["dst", "10.244.2.17:8080"], ["visible outside a node", "never"]]),
          ],
        }),
      ],
    },
    {
      title: "UNWRAP ON NODE-2",
      subtitle: "port 8472 is a door",
      body: "node-2's eth0 receives a UDP packet for port 8472 and the kernel hands it straight to the flannel.1 device. It checks the VXLAN header: VNI 1, the network this device was created for. It pops the 50 wrapper bytes, and out comes an Ethernet frame addressed to the VTEP's own MAC - that's node-2's cue to keep it.",
      facts: [
        ["DETECTED BY", "UDP dst port 8472 on eth0"],
        ["CHECK", "VNI 1 = mine"],
        ["REMOVED", "50 B"],
      ],
      view: "node2",
      focus: ["n2.eth0", "n2.flannel"],
      events: [
        ev({
          id: "ax9", at: 0.35, src: "eth0 · node-2", dst: "flannel.1 · node-2", layer: "net", size: "124 B", title: "UDP 8472 → VTEP", path: ["n2.eth0", "n2.flannel"],
          says: "node-2's kernel sees UDP port 8472 and hands the packet to the flannel.1 device.",
          info: "udp 8472 → flannel.1 VTEP",
          decoded: [sec("VTEP CHECK", [["vni in header", "1"], ["my network", "VNI 1 · accept", true], ["mismatch would", "drop the packet"]])],
        }),
        ev({
          id: "ax10", at: 0.36, src: "flannel.1 · node-2", dst: "flannel.1 · node-2", layer: "net", size: "74 B", title: "POP 50 BYTES", path: ["n2.flannel", "n2.flannel"],
          says: "The VTEP peels off the 50-byte wrapper; the inner frame is addressed to it, so it keeps it.",
          info: "decapsulate · inner dst MAC is my own",
          decoded: [sec("DECAPSULATE", [["removed", "outer Ethernet, IPv4, UDP, VXLAN · 50 B"], ["inner dst MAC", "32:47:… · this VTEP itself", true], ["result", "IP packet 10.244.1.12 → 10.244.2.17"]])],
          note: "Wrap and unwrap are kernel code, not a userspace hop: each costs a few microseconds.",
        }),
      ],
    },
    {
      title: "THE LAST HOPS",
      subtitle: "route, rewrite, bridge",
      body: "Now it's the same-node story again. 10.244.2.17 matches 10.244.2.0/24 dev cni0, the neighbor table gives the Pod's MAC, and the frame's destination is rewritten from 32:47:… to 6e:9c:b0:3f:a2:17. The bridge forwards out of port veth3b1c, whose other end is eth0 inside web-…-x2kqp.",
      facts: [
        ["ROUTE", "10.244.2.0/24 dev cni0"],
        ["DST MAC", "rewritten → 6e:9c:…:17"],
        ["PORT", "veth3b1c"],
      ],
      view: "node2",
      focus: ["n2.flannel", "n2.cni0", "n2.podA"],
      events: [
        ev({
          id: "ax11", at: 0.38, src: "flannel.1 · node-2", dst: "cni0", layer: "net", size: "74 B", title: "ROUTE TO CNI0", path: ["n2.flannel", "n2.cni0"],
          says: "Now it's the same-node story: the destination is local, via the bridge.",
          info: "10.244.2.17 matches 10.244.2.0/24 dev cni0",
          decoded: [sec("ROUTE + NEIGHBOR", [["route", "10.244.2.0/24 dev cni0"], ["neigh 10.244.2.17", X2KQP_MAC, true], ["dst MAC rewritten", "32:47:… → 6e:9c:…"]])],
        }),
        ev({
          id: "ax12", at: 0.4, src: "cni0", dst: X2KQP, layer: "net", size: "74 B", title: "OUT VETH3B1C", path: ["n2.cni0", "n2.podA"],
          says: "The bridge forwards out of the port that leads into the Pod.",
          info: "fdb: 6e:9c:…:17 → port veth3b1c",
          decoded: [sec("BRIDGE", [["lookup", "6e:9c:…:17"], ["port", "veth3b1c", true], ["far end", "eth0 · inside the Pod netns"]])],
        }),
      ],
    },
    {
      title: "SEEN FROM INSIDE",
      subtitle: "no sign of the journey",
      body: "Inside the receiving Pod nothing reveals the trip. The SYN arrives on eth0 addressed to 10.244.2.17:8080, from 10.244.1.12:41244 - a plain neighbor address as far as this namespace knows. The app accepts and sends its SYN-ACK back to eth0. From here it's the same machinery in reverse.",
      facts: [
        ["SEES CLIENT", "10.244.1.12:41244"],
        ["SEES IT AS", "a neighbor · no tunnel visible"],
        ["REPLY", "SYN-ACK back down eth0"],
      ],
      view: "pod",
      focus: ["p.veth", "p.eth0", "p.app"],
      events: [
        ev({
          id: "ax13", at: 0.41, src: "veth3b1c", dst: "eth0 · Pod", layer: "net", size: "74 B", title: "SYN ON ETH0", path: ["p.veth", "p.eth0"],
          says: "The SYN arrives on eth0 looking perfectly ordinary.",
          info: "10.244.1.12:41244 → 10.244.2.17:8080 [SYN]",
          decoded: [sec("PACKET AT ETH0", [["src", "10.244.1.12:41244"], ["dst", "10.244.2.17:8080"], ["hints of a tunnel", "none"]])],
        }),
        ev({
          id: "ax14", at: 0.45, src: "eth0 · Pod", dst: "web", layer: "net", size: " - ", title: "ACCEPT", path: ["p.eth0", "p.app"],
          says: "The app accepts; the client looks like any neighbor on 10.244.0.0/16.",
          info: "accept(): client 10.244.1.12:41244",
          decoded: [sec("SOCKET", [["listening", "0.0.0.0:8080"], ["remote", "10.244.1.12:41244 · another node", true], ["distance visible", "nothing"]])],
        }),
        ev({
          id: "ax15", at: 0.5, src: "web", dst: "eth0 · Pod", layer: "net", size: "74 B", title: "SYN-ACK", path: ["p.app", "p.eth0"],
          says: "The SYN-ACK goes back to eth0, and from there through the same machinery in reverse.",
          info: "10.244.2.17:8080 → 10.244.1.12:41244 [SYN,ACK]",
          decoded: [sec("TCP · SYN-ACK", [["flags", "SYN + ACK"], ["next hops", "veth → cni0 → flannel.1 wrap → node-1"]])],
        }),
      ],
    },
    {
      title: "ONE FLAT NETWORK",
      subtitle: "the tunnel, both ways",
      body: "The SYN-ACK is wrapped again - outer UDP 10.0.1.12 → 10.0.1.11:8472, VNI 1 - and rides the underlay back. node-1 unwraps it into kq9tw's veth, and the handshake completes about 0.85 ms after connect(). Both Pods exchanged packets the whole time; neither has any way to tell they're 0.3 ms of underlay apart.",
      facts: [
        ["RETURN TRIP", "wrapped again · 0.55 → 0.85 ms"],
        ["HANDSHAKE", "done ≈ 0.85 ms after connect()"],
        ["PODS SAW", "plain 10.244.x.x both ways"],
      ],
      view: "cluster",
      focus: ["node1", "node2"],
      events: [
        ev({
          id: "ax16", at: 0.55, src: "node-2", dst: "node-1", layer: "net", size: "124 B", title: "WRAPPED AGAIN", path: ["node2", "node1"],
          says: "The reply rides the tunnel back the same way: one UDP packet between the nodes.",
          info: "UDP 10.0.1.12:52301 → 10.0.1.11:8472 [inner SYN-ACK]",
          decoded: [
            sec("OUTER", [["src", "10.0.1.12 · node-2"], ["dst", "10.0.1.11:8472 · node-1"]]),
            sec("INNER", [["src", "10.244.2.17:8080"], ["dst", "10.244.1.12:41244"]]),
          ],
        }),
        ev({
          id: "ax17", at: 0.85, src: "node-1", dst: "node-1", layer: "net", size: " - ", title: "ESTABLISHED", path: ["node1", "node1"],
          says: "node-1 unwraps it into kq9tw's veth and the handshake completes, 0.85 ms after it began.",
          info: "unwrap → cni0 → kq9tw · connect() returns",
          decoded: [sec("SOCKET · KQ9TW", [["state", "SYN_SENT → ESTABLISHED", true], ["rtt sample", "≈ 0.8 ms · cross-node"]])],
          note: "Both Pods exchanged plain 10.244.x.x packets. Neither can tell that an underlay, UDP and 50 wrapper bytes were involved.",
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "Pod → gateway → node route", layer: "net", start: 0, duration: 0.02 },
    { value: "t2", label: "Encapsulate", layer: "net", start: 0.04, duration: 0.02 },
    { value: "t3", label: "Underlay: node-1 → node-2", layer: "net", start: 0.06, duration: 0.29 },
    { value: "t4", label: "Decapsulate", layer: "net", start: 0.35, duration: 0.02 },
    { value: "t5", label: "Bridge into the Pod", layer: "net", start: 0.38, duration: 0.03 },
    { value: "t6", label: "Accept + SYN-ACK", layer: "node", start: 0.41, duration: 0.14 },
    { value: "t7", label: "Tunnel back, handshake done", layer: "net", start: 0.55, duration: 0.3 },
  ],
  summary: {
    title: "TUNNEL VISION",
    body: "The underlay carried exactly one UDP packet between two node IPs, and inside it rode a perfectly ordinary Pod-to-Pod packet. Neither Pod noticed: the sender dialed 10.244.2.17 and got an answer from it, on what looks to both like one flat 10.244.0.0/16 network. The 50-byte tax is paid on every packet, which is why Pod MTUs are 1450.",
    facts: [
      ["WRAPPER", "+50 B: IP 20 + UDP 8 + VXLAN 8 + inner Ethernet 14"],
      ["UNDERLAY SAW", "10.0.1.11 ⇄ 10.0.1.12 · UDP 8472 · VNI 1"],
      ["NEXT", "Pod calls a Service"],
    ],
  },
}
