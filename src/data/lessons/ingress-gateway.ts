import type { Lesson } from "../types"
import { ev, layer, sec } from "./helpers"

const VISITOR = "198.51.100.7"
const API_POD = "api-…-7d9fk"

export const ingressGateway: Lesson = {
  id: "ingress-gateway",
  title: "Ingress and Gateway API",
  subtitle: "Host and path routing",
  category: "network",
  seo: {
    title: "Kubernetes Ingress and Gateway API",
    description: "How one public IP serves many Kubernetes apps: TLS termination, host and path routing in ingress-nginx, and where the Gateway API fits in.",
  },
  actors: ["visitor", "lb", "cp", "node1", "node2", "shop-ing", "web-svc"],
  pods: { node1: ["other", "other", "v1"], node2: ["other", "v1", "v1"] },
  res: {
    "shop-ing": { kind: "ingress", name: "Ingress shop", sub: "/api → api · / → web" },
    "web-svc": { kind: "service", name: "Service web", sub: "path / · ClusterIP :80" },
  },
  lanes: {
    "eth0 · node-1": "node-1", "iptables · node-1": "node-1", "cni0 · node-1": "node-1", "flannel.1 · node-1": "node-1",
    [API_POD]: "node-2",
  },
  overview: {
    body: "One public IP, many apps: TLS termination and routing by host name and path. An ingress-nginx controller holds every certificate, reads the host and path inside the tunnel, and turns each into an ordinary Pod-to-Pod call inside the cluster.",
    facts: [
      ["ENTRY", "ingress-nginx · LoadBalancer 203.0.113.50:443"],
      ["NODEPORT", "30443 · on every node"],
      ["ROUTES", "shop.example.com · /api → api · / → web"],
      ["CERTS", "Secret tls-shop · served by the controller"],
    ],
  },
  steps: [
    {
      title: "TO THE EDGE",
      subtitle: "one IP, port 443",
      body: "The visitor opens https://shop.example.com/api/orders, and public DNS has already answered 203.0.113.50. That address is a load balancer in front of an ingress-nginx controller - a plain Deployment of Pods, exposed by a Service of type LoadBalancer with HTTPS NodePort 30443 and externalTrafficPolicy: Local. Local means the load balancer only sends traffic to nodes that run a controller Pod. Its health check passes on node-1 and fails on node-2, so node-1 it is. The first packet is a SYN, like any TCP connection.",
      facts: [
        ["DESTINATION", "203.0.113.50:443 · the controller's LB Service"],
        ["NODEPORT", "30443 · on every node"],
        ["CONTROLLER", "ingress-nginx · a Deployment of ordinary Pods"],
        ["PICKED", "node-1 · the only node with a controller Pod"],
      ],
      view: "cluster",
      focus: ["visitor", "lb", "node1"],
      events: [
        ev({
          id: "gw1", at: 0, src: "visitor", dst: "load balancer", layer: "net", size: "74 B", title: "TCP SYN", path: ["visitor", "lb"],
          says: "The visitor's browser opens a connection to the load balancer on port 443.",
          info: `SYN ${VISITOR}:52910 → 203.0.113.50:443`,
          frame: [layer("Ethernet", "MACs", 14), layer("IPv4", `${VISITOR} → 203.0.113.50`, 20), layer("TCP", "52910 → 443 [SYN]", 40)],
          decoded: [
            sec("IPV4 + TCP", [["src", `${VISITOR}:52910`], ["dst", "203.0.113.50:443"], ["flags", "SYN"]]),
          ],
        }),
        ev({
          id: "gw2", at: 12, src: "load balancer", dst: "node-1", layer: "net", size: "74 B", title: "FORWARD TO NODEPORT", path: ["lb", "node1"],
          says: "Only node-1 passes the health check, so the load balancer sends the packet there, to port 30443.",
          info: "health check ✓ → 10.0.1.11:30443",
          decoded: [
            sec("REWRITE", [["health check", "node-1 ✓ · node-2 ✗ (no controller Pod)"], ["picked", "node-1", true], ["dst", "203.0.113.50:443 → 10.0.1.11:30443", true], ["src", `${VISITOR} (kept)`]]),
          ],
        }),
      ],
    },
    {
      title: "INTO THE CONTROLLER",
      subtitle: "30443 becomes a Pod",
      body: "Zoom into node-1. Port 30443 is just another NodePort: kube-proxy's rules match it, pick the controller Pod's endpoint, and rewrite the destination from node-1:30443 to 10.244.1.20:443. Because the policy is Local, the rules only pick Pods on this node and skip the masquerade, so the source stays 198.51.100.7. The rewritten SYN goes out through the cni0 bridge and down the controller Pod's veth, and conntrack remembers the rewrite for every packet that follows.",
      facts: [
        ["MATCHED", "KUBE-NODEPORTS dpt:30443"],
        ["DNAT", "10.0.1.11:30443 → 10.244.1.20:443"],
        ["CONTROLLER POD", "10.244.1.20 · listens :443"],
        ["SOURCE", "198.51.100.7 · kept, no masquerade"],
      ],
      view: "node1",
      focus: ["n1.eth0", "n1.iptables", "n1.cni0"],
      events: [
        ev({
          id: "gw3", at: 12.2, src: "eth0 · node-1", dst: "iptables · node-1", layer: "net", size: "74 B", title: "MATCH 30443", path: ["n1.eth0", "n1.iptables"],
          says: "The node's rules recognise 30443 as the controller's Service.",
          info: "nat PREROUTING → KUBE-NODEPORTS dpt:30443",
          decoded: [
            sec("RULE WALK · TABLE NAT", [["KUBE-NODEPORTS", "tcp dpt:30443 -j KUBE-EXT-…"], ["KUBE-EXT-…", "-j KUBE-SVL-… · local endpoints only, no MASQ"], ["DNAT", "→ 10.244.1.20:443", true], ["src", "198.51.100.7 · unchanged", true]]),
          ],
        }),
        ev({
          id: "gw4", at: 12.3, src: "iptables · node-1", dst: "cni0 · node-1", layer: "net", size: "74 B", title: "DOWN THE VETH", path: ["n1.iptables", "n1.cni0"],
          says: "The rewritten packet is local, so the bridge hands it to the controller Pod.",
          info: "route 10.244.1.0/24 dev cni0 → controller veth",
          decoded: [
            sec("DELIVERY", [["dst", "10.244.1.20:443 (controller Pod)"], ["via", "cni0 → veth → Pod eth0"], ["conntrack", "rewrite remembered for the flow"]]),
          ],
        }),
      ],
    },
    {
      title: "THE HANDSHAKE",
      subtitle: "SNI names the host, a cert answers",
      body: "The TCP handshake completes and the visitor sends its first TLS message. The ClientHello carries the host name in the clear - the server_name extension, SNI - because the controller serves many hosts and needs it to pick a certificate. It answers with the one loaded from Secret tls-shop; the visitor checks the chain and the name, and after a single round trip both sides have keys. Everything after this is ciphertext to everyone but the controller.",
      facts: [
        ["SNI", "shop.example.com · sent in the clear"],
        ["CERT", "CN=shop.example.com · from Secret tls-shop"],
        ["HANDSHAKE", "TLS 1.3 · one round trip · ≈ 27 ms"],
      ],
      view: "cluster",
      focus: ["visitor", "node1"],
      events: [
        ev({
          id: "gw5", at: 26, src: "visitor", dst: "ingress-nginx", layer: "net", size: "337 B", title: "CLIENTHELLO · SNI", path: ["visitor", "node1"],
          says: "The visitor's first TLS message names the host it wants, unencrypted.",
          info: "TLS ClientHello · extension server_name = shop.example.com",
          frame: [layer("Ethernet", "MACs", 14), layer("IPv4", `${VISITOR} → 10.244.1.20`, 20), layer("TCP", "52910 → 443 [PSH, ACK]", 20), layer("TLS", "ClientHello", 283)],
          decoded: [
            sec("TLS CLIENTHELLO", [["max version", "TLS 1.3"], ["key_share", "x25519"], ["cipher suites", "16 offered"], ["server_name (SNI)", "shop.example.com", true]]),
          ],
          note: "SNI is not encrypted - it can't be, or the server couldn't pick a certificate. Anyone on the path can see which host is being asked for; only the HTTP inside the tunnel is private.",
        }),
        ev({
          id: "gw6", at: 38.2, src: "ingress-nginx", dst: "ingress-nginx", layer: "node", size: " - ", title: "PICK THE CERTIFICATE", path: ["node1", "node1"],
          says: "The controller holds one certificate per host, loaded from Secrets.",
          info: "SNI shop.example.com → Secret tls-shop",
          decoded: [
            sec("CERT MATCH", [["secret", "tls-shop (from the Ingress spec.tls)", true], ["certificate", "CN=shop.example.com · SAN: shop + www"], ["issuer", "Let's Encrypt · 60 days left"], ["private key", "held only by the controller"]]),
          ],
        }),
        ev({
          id: "gw7", at: 39, src: "ingress-nginx", dst: "visitor", layer: "net", size: "3.3 KB", title: "CERTIFICATE", path: ["node1", "visitor"],
          says: "It sends the certificate; the visitor checks it, and one round trip later the tunnel is up.",
          info: "TLS 1.3 · AES_128_GCM · handshake done at ≈ 52 ms",
          frame: [layer("Ethernet", "MACs", 14), layer("IPv4", `10.244.1.20 → ${VISITOR}`, 20), layer("TCP", "443 → 52910 [PSH, ACK]", 20), layer("TLS", "ServerHello · Certificate · Finished", 3216)],
          decoded: [
            sec("TLS SERVER FLIGHT", [["ServerHello", "TLS 1.3 · ALPN h2"], ["Certificate", "CN=shop.example.com", true], ["CertificateVerify", "proof of the private key"]]),
            sec("VISITOR CHECKS", [["chain", "verifies to a trusted root"], ["name", "matches shop.example.com"]]),
          ],
        }),
      ],
    },
    {
      title: "MATCH THE RULES",
      subtitle: "host and path, inside the tunnel",
      body: "The rules were in place long before this request. The controller watches Ingress objects, and the EndpointSlices of every Service they name, and rewrites its nginx config whenever they change - here one object maps shop.example.com to two backends. The request that arrives is ordinary HTTP once decrypted: GET /api/orders with Host shop.example.com. The controller matches the host first, then the longest path: /api goes to Service api, everything else to Service web.",
      facts: [
        ["WATCHES", "Ingress, Secrets, EndpointSlices → nginx config"],
        ["HOST", "shop.example.com → this rule set"],
        ["PATH /API", "→ Service api:8080"],
        ["PATH /", "→ Service web:80"],
      ],
      view: "cluster",
      focus: ["api", "shop-ing", "node1"],
      events: [
        ev({
          id: "gw8", at: 52.5, src: "kube-apiserver", dst: "ingress-nginx", layer: "control", size: "1.5 KB", title: "WHERE RULES COME FROM", path: ["api", "shop-ing"],
          says: "Standing state: the controller built its routing table from Ingress objects, and reloads when they change.",
          info: "WATCH Ingress, IngressClass, Secrets, EndpointSlices",
          decoded: [
            sec("INGRESS SHOP · SPEC", [["ingressClassName", "nginx"], ["tls", "shop.example.com → secret tls-shop"], ["rules[0].host", "shop.example.com"], ["path /api", "→ Service api, port 8080", true], ["path /", "→ Service web, port 80"]]),
            sec("THE SAME RULES · GATEWAY API", [["Gateway shop", "listener HTTPS :443 · cert tls-shop · owned by the platform team"], ["HTTPRoute shop", "hostnames shop.example.com · owned by the app team"], ["rule 1", "PathPrefix /api → backendRef api:8080"], ["rule 2", "PathPrefix / → backendRef web:80"]]),
          ],
        }),
        ev({
          id: "gw9", at: 64.5, src: "visitor", dst: "ingress-nginx", layer: "net", size: "0.4 KB", title: "GET /API/ORDERS", path: ["visitor", "node1"],
          says: "The request arrives as ciphertext and is decrypted only at the controller.",
          info: "GET /api/orders · Host shop.example.com",
          decoded: [
            sec("HTTP REQUEST (INSIDE TLS)", [["method", "GET /api/orders"], ["Host", "shop.example.com"], ["readable by", "the controller only", true]]),
            sec("RULE MATCH", [["host", "shop.example.com ✓"], ["longest path", "/api → Service api:8080", true]]),
          ],
          note: "Gateway API says the same thing with different objects: GatewayClass names the controller, Gateway is the entry point, HTTPRoute holds the host and path rules. Platform teams own Gateways while app teams own HTTPRoutes, where one Ingress bundles it all. It is where new clusters are heading: ingress-nginx itself was retired in March 2026, and the controllers replacing it mostly speak Gateway API. The data path in this lesson stays the same.",
        }),
      ],
    },
    {
      title: "UPSTREAM CALL",
      subtitle: "the proxy picks a Pod itself",
      body: "Zoom back into node-1. To reach /api, the controller opens a brand-new TCP connection of its own. It doesn't dial Service api's ClusterIP: it already holds the Service's endpoints from its EndpointSlice watch, picks one itself - 10.244.2.19:8080, on node-2 - and connects straight to it. kube-proxy's rules see a Pod IP and do nothing, and the packet crosses the VXLAN tunnel like any Pod-to-Pod traffic. With the request the controller adds X-Forwarded-For, because the api Pod will only ever see the controller's own IP as its client.",
      facts: [
        ["NEW CONNECTION", "10.244.1.20:41230 → 10.244.2.19:8080"],
        ["PICKED BY", "the controller · from EndpointSlices"],
        ["ADDED", "X-Forwarded-For: 198.51.100.7"],
        ["UPSTREAM", "plain HTTP · TLS ended at the controller"],
      ],
      view: "node1",
      focus: ["n1.cni0", "n1.iptables", "n1.flannel"],
      events: [
        ev({
          id: "gw10", at: 65, src: "ingress-nginx", dst: "ingress-nginx", layer: "net", size: " - ", title: "PICK AN API POD", path: ["n1.cni0", "n1.cni0"],
          says: "The controller looks up Service api's endpoints in its own memory and picks one.",
          info: "upstream default-api-8080 → 10.244.2.19:8080",
          decoded: [
            sec("NGINX UPSTREAM", [["Service api", "ClusterIP 10.96.45.10 · not used"], ["endpoints", "10.244.2.19:8080 · from the EndpointSlice watch", true], ["balancing", "done by the controller, per request"]]),
          ],
        }),
        ev({
          id: "gw11", at: 65.1, src: "iptables · node-1", dst: "iptables · node-1", layer: "net", size: "74 B", title: "NO DNAT NEEDED", path: ["n1.cni0", "n1.iptables"],
          says: "The SYN goes straight to the Pod IP, so kube-proxy's rules have nothing to rewrite.",
          info: "SYN 10.244.1.20:41230 → 10.244.2.19:8080 · no Service match",
          decoded: [
            sec("RULE WALK", [["KUBE-SERVICES", "no match · dst is a Pod IP"], ["DNAT", "none", true], ["next hop", "flannel.1 · 10.244.2.0/24"]]),
          ],
          note: "Skipping the ClusterIP is what lets the controller do per-request balancing, retries and sticky sessions across individual Pods. The service-upstream annotation makes it dial the ClusterIP instead.",
        }),
        ev({
          id: "gw12", at: 65.2, src: "flannel.1 · node-1", dst: API_POD, layer: "net", size: "124 B", title: "VXLAN TO NODE-2", path: ["n1.iptables", "n1.flannel"],
          says: "The SYN crosses to node-2 wrapped in VXLAN, like any Pod-to-Pod packet.",
          info: "UDP 8472 [inner 10.244.1.20 → 10.244.2.19:8080]",
          frame: [
            layer("Ethernet", "outer MACs", 14), layer("IPv4", "10.0.1.11 → 10.0.1.12", 20), layer("UDP", "→ 8472", 8), layer("VXLAN", "VNI 1", 8),
            layer("Ethernet", "inner MACs", 14, true), layer("IPv4", "10.244.1.20 → 10.244.2.19", 20, true), layer("TCP", "41230 → 8080 [SYN]", 40, true),
          ],
          decoded: [
            sec("OUTER", [["src", "10.0.1.11 (node-1)"], ["dst", "10.0.1.12:8472 (node-2)"], ["VNI", "1"]]),
            sec("INNER", [["src", "10.244.1.20:41230"], ["dst", "10.244.2.19:8080"]]),
          ],
        }),
        ev({
          id: "gw13", at: 66, src: "ingress-nginx", dst: API_POD, layer: "net", size: "0.5 KB", title: "PROXIED, WITH HEADERS", path: ["n1.cni0", "n1.cni0"],
          says: "The request is proxied with the visitor's address added and the original Host kept.",
          info: "GET /api/orders → 10.244.2.19:8080",
          decoded: [
            sec("PROXIED REQUEST", [["Host", "shop.example.com (preserved)", true], ["X-Forwarded-For", VISITOR, true], ["X-Forwarded-Proto", "https"], ["X-Request-Id", "8f3ac1… (new)"]]),
          ],
        }),
      ],
    },
    {
      title: "THE RESPONSE",
      subtitle: "encrypted once, at the edge",
      body: "The api Pod answers - plain HTTP, to a client it believes is the controller. The reply rides the tunnel back to node-1, where the controller encrypts it with the session keys and sends it down the visitor's own connection. conntrack and the load balancer undo their rewrites on the way out. The visitor has only ever spoken to 203.0.113.50; the certificates, the rules and the Pod addresses all stayed inside.",
      facts: [
        ["API POD SEES", "10.244.1.20:41230 · the controller"],
        ["REAL CLIENT", "X-Forwarded-For: 198.51.100.7"],
        ["VISITOR SEES", "203.0.113.50:443 · only"],
      ],
      view: "cluster",
      focus: ["visitor", "node1", "node2"],
      events: [
        ev({
          id: "gw14", at: 67, src: API_POD, dst: "ingress-nginx", layer: "net", size: "3.1 KB", title: "200 OK", path: ["node2", "node1"],
          says: "The api Pod answers; its client, as far as it can tell, is the controller.",
          info: "200 OK · 3.1 KB JSON → 10.244.1.20:41230",
          decoded: [
            sec("HTTP RESPONSE", [["status", "200 OK"], ["content-type", "application/json"], ["body", "3.1 KB"]]),
          ],
          note: "Backend logs will show the controller's IP on every request. Anything that needs the real client must read X-Forwarded-For - and trust the controller, since that header is the only place the address survives.",
        }),
        ev({
          id: "gw15", at: 68, src: "ingress-nginx", dst: "visitor", layer: "net", size: "3.3 KB", title: "ENCRYPTED ON THE WAY OUT", path: ["node1", "visitor"],
          says: "The controller encrypts the reply, and every hop undoes its rewrite on the way out.",
          info: "HTTP/2 200 · the visitor sees 203.0.113.50:443",
          frame: [layer("Ethernet", "MACs", 14), layer("IPv4", `203.0.113.50 → ${VISITOR}`, 20), layer("TCP", "443 → 52910 [PSH, ACK]", 20), layer("TLS", "HTTP/2 200 (ciphertext)", 3210)],
          decoded: [
            sec("BACK OUT", [["api reply", "plain HTTP → controller"], ["controller", "encrypts with the session key", true], ["conntrack + LB", "undo the DNAT and port rewrites"], ["visitor sees", "203.0.113.50:443"]]),
          ],
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "visitor → LB → node-1", layer: "net", start: 0, duration: 12.4 },
    { value: "t2", label: "NodePort DNAT to the controller", layer: "net", start: 12.2, duration: 0.2 },
    { value: "t3", label: "TLS 1.3 handshake", layer: "net", start: 26, duration: 26.5 },
    { value: "t4", label: "decrypt + rule match", layer: "net", start: 64.5, duration: 0.5 },
    { value: "t5", label: "controller → api Pod", layer: "net", start: 65, duration: 1.5 },
    { value: "t6", label: "reply, re-encrypted", layer: "net", start: 67, duration: 13 },
  ],
  summary: {
    title: "ONE DOOR, MANY APPS",
    body: "The controller is the only component in this story with certificates, and the only one that read the HTTP. Routing happened at layer 7 - host and path - inside a tunnel the visitor opened with 203.0.113.50. Behind it, the call to the api Pod was plain Pod-to-Pod traffic: the controller picked the Pod itself from the EndpointSlices, and the ClusterIP was never dialed.",
    facts: [
      ["WHO HOLDS TLS", "the controller · Secret tls-shop"],
      ["ROUTING", "L7 · host + path, not addresses"],
      ["NEXT", "NetworkPolicy"],
    ],
  },
}
