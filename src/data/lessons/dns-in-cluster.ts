import type { Lesson } from "../types"
import { ev, layer, sec } from "./helpers"

const POD = "web-…-x2kqp"

export const dnsInCluster: Lesson = {
  id: "dns-in-cluster",
  title: "DNS in the cluster",
  subtitle: "CoreDNS and ndots:5",
  category: "network",
  actors: ["resolver", "node1", "node2"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    "web app": "Pod x2kqp", getaddrinfo: "Pod x2kqp", [POD]: "Pod x2kqp",
    "iptables · node-2": "node-2", "cni0 · node-1": "node-1",
  },
  overview: {
    body: "Why a lookup for api.example.com can hit CoreDNS four times before it goes out, and how search domains work. Every Pod gets the same resolv.conf - one nameserver, three search suffixes, ndots:5 - and together they decide what gets asked, and in what order.",
    facts: [
      ["NAMESERVER", "10.96.0.10 · ClusterIP of kube-dns"],
      ["SEARCH", "3 suffixes · default.svc.cluster.local svc.cluster.local cluster.local"],
      ["NDOTS", "5 · names with fewer dots expand first"],
      ["QUERIES HERE", "5 from one Pod · only 1 left the cluster"],
    ],
  },
  steps: [
    {
      title: "THE QUESTION FORMS",
      subtitle: "resolv.conf decides the order",
      body: "Inside web-…-x2kqp the app needs to call http://web/api/orders, so it asks getaddrinfo for the name web. The answer depends on /etc/resolv.conf, which Kubernetes writes into every Pod: nameserver 10.96.0.10, three search domains, options ndots:5. web has zero dots - fewer than five - so the resolver must try the search list before the bare name. Candidate 1 is web.default.svc.cluster.local.",
      facts: [
        ["NAMESERVER", "10.96.0.10 · Service kube-dns"],
        ["SEARCH", "default.svc.cluster.local · svc.cluster.local · cluster.local"],
        ["NDOTS", "5 · web has 0 dots → search list first"],
        ["CANDIDATES", "web + 3 suffixes, then web itself"],
      ],
      view: "pod",
      focus: ["p.app", "p.eth0"],
      events: [
        ev({
          id: "dn1", at: 0, src: "web app", dst: "getaddrinfo", layer: "node", size: " - ", title: "RESOLVE WEB", path: ["p.app", "p.app"],
          says: "The app asks the resolver library for the name web.",
          info: 'getaddrinfo("web", AF_INET) · reads /etc/resolv.conf',
          decoded: [
            sec("/ETC/RESOLV.CONF", [["nameserver", "10.96.0.10"], ["search", "default.svc.cluster.local svc.cluster.local cluster.local"], ["options", "ndots:5"]]),
          ],
        }),
        ev({
          id: "dn2", at: 0.4, src: "getaddrinfo", dst: "getaddrinfo", layer: "node", size: " - ", title: "NDOTS:5 DECIDES", path: ["p.app", "p.app"],
          says: "web has zero dots, so the search list is tried before the name itself.",
          info: "0 dots < ndots 5 → expand with search suffixes first",
          decoded: [
            sec("TRY ORDER", [["1", "web.default.svc.cluster.local"], ["2", "web.svc.cluster.local"], ["3", "web.cluster.local"], ["4", "web (only if 1-3 fail)"]]),
          ],
        }),
      ],
    },
    {
      title: "ASK KUBE-DNS",
      subtitle: "the nameserver is a Service",
      body: "Candidate 1 goes out as a UDP packet to 10.96.0.10 - not a Pod, but the ClusterIP of the kube-dns Service. The same kube-proxy rules as any other Service rewrite the destination on node-2 to the CoreDNS Pod, 10.244.1.3 on node-1. From there it is ordinary Pod-to-Pod traffic: VXLAN, UDP port 8472, VNI 1. DNS rides on the same machinery it helps you use.",
      facts: [
        ["DESTINATION", "10.96.0.10:53 · a ClusterIP, not a Pod"],
        ["DNAT", "→ 10.244.1.3:53 · CoreDNS on node-1"],
        ["RIDE", "UDP 53 · VXLAN 8472 · VNI 1"],
      ],
      view: "cluster",
      focus: ["node1", "node2"],
      events: [
        ev({
          id: "dn3", at: 1, src: POD, dst: "kube-dns ClusterIP", layer: "net", size: "89 B", title: "QUERY 1 SENT", path: ["node2", "node2"],
          says: "The first question leaves the Pod, addressed to the kube-dns Service.",
          info: "A? web.default.svc.cluster.local → 10.96.0.10:53",
          frame: [layer("Ethernet", "MACs", 14), layer("IPv4", "10.244.2.17 → 10.96.0.10", 20), layer("UDP", "43210 → 53", 8), layer("DNS", "A? web.default.svc.cluster.local", 47)],
          decoded: [
            sec("DNS QUERY", [["id", "0x9c41"], ["question", "web.default.svc.cluster.local, type A"], ["tries", "search suffix 1 of 3"]]),
          ],
          note: "The nameserver address is itself a Service. CoreDNS traffic gets the same kube-proxy DNAT every Service gets - DNS helps you find Services by riding on one.",
        }),
        ev({
          id: "dn4", at: 1.1, src: "iptables · node-2", dst: "iptables · node-2", layer: "net", size: " - ", title: "DNAT TO COREDNS", path: ["node2", "node2"],
          says: "node-2's rules rewrite the destination to the CoreDNS Pod on node-1.",
          info: "KUBE-SVC-ERIFXISQ… → 10.244.1.3:53",
          decoded: [
            sec("RULE WALK · TABLE NAT", [["KUBE-SERVICES", "dst 10.96.0.10:53 matches"], ["KUBE-SVC-ERIFXISQ…", "udp dpt:53 -j KUBE-SEP-…"], ["DNAT", "10.96.0.10:53 → 10.244.1.3:53", true]]),
          ],
        }),
        ev({
          id: "dn5", at: 1.2, src: "node-2", dst: "node-1", layer: "net", size: "139 B", title: "VXLAN TO NODE-1", path: ["node2", "node1"],
          says: "The query crosses to node-1 wrapped in VXLAN, like any Pod-to-Pod packet.",
          info: "UDP 10.0.1.12 → 10.0.1.11:8472 [inner → 10.244.1.3:53]",
          frame: [
            layer("Ethernet", "outer MACs", 14), layer("IPv4", "10.0.1.12 → 10.0.1.11", 20), layer("UDP", "→ 8472", 8), layer("VXLAN", "VNI 1", 8),
            layer("Ethernet", "inner MACs", 14, true), layer("IPv4", "10.244.2.17 → 10.244.1.3", 20, true), layer("UDP", "43210 → 53", 8, true), layer("DNS", "A? web.default…", 47, true),
          ],
          decoded: [
            sec("OUTER (WHAT THE NETWORK SEES)", [["src", "10.0.1.12 (node-2)"], ["dst", "10.0.1.11:8472 (node-1)"], ["VNI", "1"]]),
            sec("INNER (THE DNS PACKET)", [["src", "10.244.2.17:43210"], ["dst", "10.244.1.3:53", true]]),
          ],
        }),
      ],
    },
    {
      title: "ANSWERED FROM MEMORY",
      subtitle: "the kubernetes plugin",
      body: "Zoom into node-1. CoreDNS looks nothing up per question: its kubernetes plugin keeps every Service and EndpointSlice in memory, fed by a watch on the API server. The name web.default.svc.cluster.local is Service web in namespace default, so it answers instantly - with the ClusterIP, 10.96.120.15, and a TTL of 30 seconds, the ttl the Corefile sets for the kubernetes plugin.",
      facts: [
        ["PLUGIN", "kubernetes · authoritative for cluster.local"],
        ["SOURCE", "memory · a watch on Services + EndpointSlices"],
        ["ANSWER", "A 10.96.120.15 · the ClusterIP, not a Pod"],
        ["TTL", "30 s · ttl 30 in the Corefile"],
      ],
      view: "node1",
      focus: ["n1.cni0", "n1.podB", "n1.eth0"],
      events: [
        ev({
          id: "dn6", at: 1.6, src: "cni0 · node-1", dst: "CoreDNS", layer: "net", size: "89 B", title: "QUESTION ARRIVES", path: ["n1.cni0", "n1.podB"],
          says: "The question reaches the CoreDNS Pod and is answered from memory, no lookup involved.",
          info: "Q web.default.svc.cluster.local → answered in 0.3 ms",
          decoded: [
            sec("KUBERNETES PLUGIN", [["zone", "cluster.local (authoritative)"], ["index", "Services + EndpointSlices, in memory"], ["match", "Service web in namespace default", true]]),
          ],
        }),
        ev({
          id: "dn7", at: 1.9, src: "CoreDNS", dst: POD, layer: "net", size: "105 B", title: "A 10.96.120.15", path: ["n1.podB", "n1.eth0"],
          says: "The answer is the Service's ClusterIP, not a Pod address.",
          info: "A web.default.svc.cluster.local → 10.96.120.15, TTL 30",
          frame: [layer("Ethernet", "MACs", 14), layer("IPv4", "10.244.1.3 → 10.244.2.17", 20), layer("UDP", "53 → 43210", 8), layer("DNS", "A 10.96.120.15", 63)],
          decoded: [
            sec("DNS ANSWER", [["web.default.svc.cluster.local", "A 10.96.120.15", true], ["ttl", "30"], ["aa", "1 (authoritative answer)"]]),
          ],
          note: "Resolving a Service returns its ClusterIP. Turning that into a Pod is kube-proxy's job and happens per connection - the same DNAT as the last lesson.",
        }),
      ],
    },
    {
      title: "AN OUTSIDE NAME",
      subtitle: "three misses, then a forward",
      body: "The app then needs an outside name, api.example.com - one dot, still fewer than five, so the search list runs first. Three questions come back NXDOMAIN, about 1.5 ms apart: CoreDNS is authoritative for cluster.local and knows those longer names don't exist, so nothing leaves the cluster. Only the fourth question, the bare name, makes CoreDNS forward to the upstream resolver at 198.51.100.53. Counting the first lookup, five queries have now left this Pod.",
      facts: [
        ["QUERIES 2-4", "api.example.com + each suffix → NXDOMAIN"],
        ["WASTED", "3 round trips · ≈ 5 ms"],
        ["QUERY 5", "bare name → forwarded to 198.51.100.53"],
        ["TOTAL", "5 queries from one Pod · 4 for one name"],
      ],
      view: "cluster",
      focus: ["resolver", "node1", "node2"],
      events: [
        ev({
          id: "dn8", at: 3, src: POD, dst: "CoreDNS", layer: "net", size: "101 B", title: "QUERY 2 · NXDOMAIN", path: ["node2", "node1"],
          says: "The outside name is tried against the first suffix, and doesn't exist.",
          info: "Q2 api.example.com.default.svc.cluster.local → NXDOMAIN (1.4 ms)",
          frame: [layer("Ethernet", "MACs", 14), layer("IPv4", "10.244.2.17 → 10.96.0.10", 20), layer("UDP", "43210 → 53", 8), layer("DNS", "A? api.example.com.default.svc…", 59)],
          decoded: [
            sec("Q2", [["question", "api.example.com.default.svc.cluster.local"], ["rcode", "NXDOMAIN", true], ["negative ttl", "30 · from the zone's SOA"]]),
          ],
        }),
        ev({
          id: "dn9", at: 4.6, src: POD, dst: "CoreDNS", layer: "net", size: "93 B", title: "QUERY 3 · NXDOMAIN", path: ["node2", "node1"],
          says: "The second suffix misses too, answered inside the cluster.",
          info: "Q3 api.example.com.svc.cluster.local → NXDOMAIN (1.5 ms)",
          decoded: [
            sec("Q3", [["question", "api.example.com.svc.cluster.local"], ["rcode", "NXDOMAIN"], ["upstream asked", "no - cluster.local is local"]]),
          ],
        }),
        ev({
          id: "dn10", at: 6.2, src: POD, dst: "CoreDNS", layer: "net", size: "89 B", title: "QUERY 4 · NXDOMAIN", path: ["node2", "node1"],
          says: "And the third. None of this traffic has left the cluster yet.",
          info: "Q4 api.example.com.cluster.local → NXDOMAIN (1.6 ms)",
          decoded: [
            sec("Q4", [["question", "api.example.com.cluster.local"], ["rcode", "NXDOMAIN"], ["outside traffic so far", "none - all three died locally"]]),
          ],
        }),
        ev({
          id: "dn11", at: 8, src: "CoreDNS", dst: "public DNS", layer: "net", size: "75 B", title: "QUERY 5 · FORWARDED", path: ["node1", "resolver"],
          says: "Only now does CoreDNS ask an upstream resolver, outside the cluster.",
          info: "forward . → 198.51.100.53 · A? api.example.com",
          frame: [layer("Ethernet", "MACs", 14), layer("IPv4", "10.0.1.11 → 198.51.100.53", 20), layer("UDP", "41173 → 53", 8), layer("DNS", "A? api.example.com", 33)],
          decoded: [
            sec("FORWARD PLUGIN", [["zone", "everything not cluster.local"], ["upstream", "198.51.100.53:53", true], ["cache", "answers cached for their TTL"]]),
          ],
        }),
        ev({
          id: "dn12", at: 30, src: "public DNS", dst: "CoreDNS", layer: "net", size: "91 B", title: "UPSTREAM ANSWERS", path: ["resolver", "node1"],
          says: "Twenty-two milliseconds later the upstream knows the name.",
          info: "A api.example.com → 203.0.113.61, TTL 60",
          decoded: [
            sec("THE FIVE, COUNTED", [["Q1 web.default.svc…", "A 10.96.120.15"], ["Q2 + suffix 1", "NXDOMAIN"], ["Q3 + suffix 2", "NXDOMAIN"], ["Q4 + suffix 3", "NXDOMAIN"], ["Q5 bare", "forwarded → A 203.0.113.61", true]]),
          ],
          note: "Three of the five questions existed only because of ndots:5. They cost about 5 ms here; with a slow upstream or a longer search list, each miss costs a full external round trip. And this is the tidy version: most resolvers ask for A and AAAA together, so every miss is really two questions.",
        }),
        ev({
          id: "dn13", at: 30.4, src: "CoreDNS", dst: POD, layer: "net", size: "91 B", title: "ANSWER TO THE POD", path: ["node1", "node2"],
          says: "CoreDNS passes the answer back, and the app finally has an address.",
          info: "A api.example.com → 203.0.113.61 (cached at CoreDNS too)",
          decoded: [
            sec("DNS ANSWER", [["api.example.com", "A 203.0.113.61", true], ["ttl", "60"]]),
          ],
        }),
      ],
    },
    {
      title: "THE PAYOFF",
      subtitle: "short names just work",
      body: "This is why the search list exists: from any Pod in the cluster, the bare name web just works, because the resolver expands it with the caller's namespace suffixes first. The app connects to 10.96.120.15:80, and the same kube-proxy DNAT turns that into a real Pod - here 10.244.2.18, on the app's own node. Internal names cost one query. External names pay for three misses first. That asymmetry is the trade.",
      facts: [
        ["SHORT NAMES", "work from any Pod · suffix = caller's namespace"],
        ["CONNECT", "10.244.2.17:49302 → 10.96.120.15:80"],
        ["DNAT", "→ 10.244.2.18:8080 · web-…-p8m4z, same node"],
      ],
      view: "cluster",
      focus: ["node1", "node2"],
      events: [
        ev({
          id: "dn14", at: 31, src: POD, dst: "Service web", layer: "net", size: "74 B", title: "CONNECT TO WEB", path: ["node2", "node2"],
          says: "The app connects to the ClusterIP that query 1 returned.",
          info: "SYN 10.244.2.17:49302 → 10.96.120.15:80",
          frame: [layer("Ethernet", "MACs", 14), layer("IPv4", "10.244.2.17 → 10.96.120.15", 20), layer("TCP", "49302 → 80 [SYN]", 40)],
          decoded: [
            sec("IPV4 + TCP", [["src", "10.244.2.17 (the caller Pod)"], ["dst", "10.96.120.15:80 (ClusterIP of web)"]]),
          ],
        }),
        ev({
          id: "dn15", at: 31.1, src: "iptables · node-2", dst: "iptables · node-2", layer: "net", size: "74 B", title: "SAME DNAT AS EVER", path: ["node2", "node2"],
          says: "kube-proxy's rules turn the Service address into a Pod, exactly as before.",
          info: "KUBE-SVC-QD4FJ… → 10.244.2.18:8080 (local)",
          decoded: [
            sec("DNAT", [["dst", "10.96.120.15:80 → 10.244.2.18:8080", true], ["picked", "web-…-p8m4z, on this node"]]),
          ],
        }),
      ],
    },
    {
      title: "THE FIXES",
      subtitle: "trailing dot, or fewer dots",
      body: "Two fixes skip the misses. A trailing dot marks a name absolute - api.example.com. is queried once, search list untouched. Or lower ndots in the Pod's dnsConfig: with ndots:2, api.example.com already has enough dots to be tried as-is first. Short internal names are unaffected either way: web has zero dots and will always try the search list first, which is exactly what you want.",
      facts: [
        ["FIX 1", "api.example.com. · trailing dot = absolute · 1 query"],
        ["FIX 2", "dnsConfig ndots:2 · 2 dots is enough to go bare"],
        ["WEB UNAFFECTED", "0 dots → search list first, always"],
      ],
      view: "pod",
      focus: ["p.app", "p.eth0"],
      events: [
        ev({
          id: "dn16", at: 33, src: POD, dst: "CoreDNS", layer: "net", size: "75 B", title: "ONE QUERY", path: ["p.app", "p.eth0"],
          says: "With the trailing dot, the same lookup is a single question, forwarded once.",
          info: "Q? api.example.com. (absolute) → forwarded → A 203.0.113.61",
          decoded: [
            sec("RESOLVER RULES", [["api.example.com.", "ends in . → absolute", true], ["search list", "skipped"], ["queries to CoreDNS", "1 (was 4)"]]),
          ],
        }),
        ev({
          id: "dn17", at: 33.2, src: "web app", dst: "getaddrinfo", layer: "api", size: " - ", title: "OR SET NDOTS", path: ["p.app", "p.app"],
          says: "Or the Pod spec itself can lower the threshold.",
          info: 'spec.dnsConfig.options: [{name: "ndots", value: "2"}]',
          decoded: [
            sec("POD SPEC · DNSCONFIG", [["dnsConfig.options", "ndots: 2", true], ["api.example.com", "2 dots ≥ 2 → tried as-is first"], ["web", "0 dots → search list still first"]]),
          ],
          note: "The trade cuts both ways: push ndots down to 0 and even bare web is queried as-is first, one wasted question before the suffixes. Two fits this cluster - internal names have no dots, external ones have two or more.",
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "resolv.conf + candidates", layer: "node", start: 0, duration: 0.8 },
    { value: "t2", label: "Q1 · web → ClusterIP", layer: "net", start: 1, duration: 1.2 },
    { value: "t3", label: "Q2-Q4 · three NXDOMAINs", layer: "net", start: 3, duration: 4.6 },
    { value: "t4", label: "Q5 · forwarded upstream", layer: "net", start: 8, duration: 22.4 },
    { value: "t5", label: "connect via ClusterIP", layer: "net", start: 31, duration: 0.2 },
    { value: "t6", label: "with a trailing dot · 1 query", layer: "net", start: 33, duration: 22 },
  ],
  summary: {
    title: "FIVE QUESTIONS",
    body: "One short internal name cost a single query in about a millisecond; one ordinary external name cost four. The difference is ndots:5 plus a three-entry search list - settings Kubernetes puts in every Pod so short names work everywhere. For a workload that mostly calls Services that's the right default; for a Pod that mostly calls outside, use absolute names or lower ndots.",
    facts: [
      ["INSIDE NAME", "1 query · ≈ 1 ms"],
      ["OUTSIDE NAME", "4 queries · 3 of them wasted"],
      ["NEXT", "Ingress and Gateway API"],
    ],
  },
}
