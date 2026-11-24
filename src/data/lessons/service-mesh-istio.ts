import type { Lesson } from "../types"
import { ev, layer, sec } from "./helpers"

const API = "kube-apiserver"
const WEB = "web-…-mv5tz"
const API_POD = "api-v1-…-d4k8w"
const API_B = "api-v1-…-m9x2t"
const API_V2 = "api-v2-…-q7zr5"
const BUSYBOX = "busybox-…-c4t2m"
const WPROXY = "istio-proxy · web"
const APROXY = "istio-proxy · api"
const IPT_WEB = "iptables · web"
const IPT_API = "iptables · api"
const ZT1 = "ztunnel · node-1"
const ZT2 = "ztunnel · node-2"

export const serviceMeshIstio: Lesson = {
  id: "service-mesh-istio",
  title: "Service mesh with Istio",
  subtitle: "A proxy beside every app",
  category: "network",
  seo: {
    title: "How a service mesh works: Istio explained",
    description: "How a service mesh works, step by step with Istio: sidecar injection, istiod and xDS, mTLS identities, traffic splits, retries and ambient mode.",
  },
  actors: ["you", "cp", "node1", "node2"],
  pods: { node1: ["other", "other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    kubectl: "you", istioctl: "you",
    "web-…-kq9tw": "web", [WEB]: "web", "kubelet · node-1": "web",
    "api-…-7d9fk": "api", [API_POD]: "api", [API_B]: "api", [API_V2]: "api",
    [WPROXY]: "web proxy", [IPT_WEB]: "web proxy", "istio-init · web": "web proxy",
    [APROXY]: "api proxy", [IPT_API]: "api proxy",
    [BUSYBOX]: "busybox",
    "istio-cni · node-1": "ambient", [ZT1]: "ambient", [ZT2]: "ambient", waypoint: "ambient",
  },
  overview: {
    body: "Some things every app needs when it calls another: encryption, proof of who is calling, retries, traffic splits, measurements. A service mesh takes them out of the code. It puts a proxy next to each app, sends all the app's traffic through it, and runs one control plane that tells every proxy what to do. Here is how Istio does it, from the first injected proxy to a mesh with no sidecars at all.",
    facts: [
      ["DATA PLANE", "Envoy proxies · carry the traffic"],
      ["CONTROL PLANE", "istiod · configures the proxies"],
      ["THE APPS", "web calls api · code unchanged"],
      ["VERSION", "Istio 1.32"],
    ],
  },
  steps: [
    {
      title: "EVERY APP ON ITS OWN",
      subtitle: "before the mesh",
      body: "web calls api, the way Pods have called each other in every lesson so far. It works, but look at what's missing. The request crosses the network in plain text. api knows its caller only by an IP address. When api answers with an error, web's code has to decide whether to try again. And nobody counts those errors unless someone wrote code for it. You could build all of that into web, then again into api, in every language your teams use. A service mesh does it once, outside the apps.",
      facts: [
        ["ENCRYPTED", "no"],
        ["CALLER KNOWN BY", "an IP address"],
        ["ON AN ERROR", "up to the app's code"],
        ["MEASURED", "up to the app's code"],
      ],
      view: "cluster",
      focus: ["node1", "node2"],
      events: [
        ev({
          id: "sm1", at: 0, src: "web-…-kq9tw", dst: "api-…-7d9fk", layer: "net", size: "194 B", title: "A PLAIN REQUEST", path: ["node1", "node2"],
          says: "web calls api. Anyone on the path between the nodes can read the request.",
          info: "GET /orders · Host api:8080 · plain text",
          frame: [
            layer("Ethernet", "outer MACs", 14), layer("IPv4", "10.0.1.11 → 10.0.1.12", 20), layer("UDP", "→ 8472", 8), layer("VXLAN", "VNI 1", 8),
            layer("Ethernet", "inner MACs", 14, true), layer("IPv4", "10.244.1.12 → 10.244.2.19", 20, true), layer("TCP", "→ 8080 [PSH, ACK]", 32, true), layer("HTTP", "GET /orders (readable)", 78, true),
          ],
          decoded: [
            sec("WHAT THE CALLED APP KNOWS", [["source IP", "10.244.1.12"], ["who that is", "unknown - IPs are reused", true], ["allowed to call", "nothing checks"]]),
            sec("HTTP REQUEST", [["line", "GET /orders HTTP/1.1"], ["Host", "api:8080"], ["readable on the wire", "yes", true]]),
          ],
        }),
        ev({
          id: "sm2", at: 4, src: "api-…-7d9fk", dst: "web-…-kq9tw", layer: "drop", size: "0.2 KB", title: "503, NOW WHAT?", path: ["node2", "node1"],
          says: "api answers 503. Whether to try again is web's problem.",
          info: "HTTP/1.1 503 Service Unavailable",
          decoded: [
            sec("LEFT TO WEB'S CODE", [["retry", "how often, how fast, against which Pod?"], ["timeout", "how long is too long?"], ["count it", "metrics library, per language"], ["encrypt it", "certificates, per app"]]),
          ],
          note: "Libraries can do all of this. The trouble is keeping every app, in every language, on the same version of them with the same settings.",
        }),
      ],
    },
    {
      title: "INSTALL THE CONTROL PLANE",
      subtitle: "istiod, one Deployment",
      body: "A mesh has two halves. The data plane is the proxies, which carry the traffic. The control plane is istiod, which configures them. You install istiod: a Deployment like any other, here one Pod on node-1. It also registers a webhook, so the API server asks it about every new Pod in the namespaces you choose. You choose one by labelling it. Nothing that's already running changes.",
      facts: [
        ["ISTIOD", "Deployment · namespace istio-system"],
        ["LISTENS", ":15012 config and certificates · :15017 webhook"],
        ["WEBHOOK", "Pods · CREATE · failurePolicy Fail"],
        ["OPT IN", "istio-injection=enabled on the namespace"],
      ],
      view: "cluster",
      focus: ["you", "api", "node1"],
      events: [
        ev({
          id: "sm3", at: 60000, src: "istioctl", dst: API, layer: "api", size: "3.1 KB", title: "INSTALL ISTIOD", path: ["you", "api"],
          says: "You install Istio. Its control plane is one Deployment, istiod.",
          info: "istioctl install --set profile=default",
          decoded: [
            sec("BODY · DEPLOYMENT", [["metadata.name", "istiod · istio-system"], ["image", "docker.io/istio/pilot:1.32.0"], ["port 15012", "configuration and certificates, over TLS"], ["port 15017", "the injection webhook"]]),
          ],
        }),
        ev({
          id: "sm4", at: 60400, src: "istioctl", dst: API, layer: "api", size: "2.6 KB", title: "REGISTER THE WEBHOOK", path: ["you", "api"],
          says: "It also registers a webhook, so the API server will ask istiod about new Pods.",
          info: "MutatingWebhookConfiguration istio-sidecar-injector",
          decoded: [
            sec("WEBHOOK", [["rules", "CREATE pods"], ["namespaceSelector", "istio-injection: enabled", true], ["clientConfig", "Service istiod:443 · /inject"], ["failurePolicy", "Fail"]]),
          ],
          note: "Fail means: if istiod can't be reached, Pods in labelled namespaces can't be created. That's deliberate, since the alternative is Pods that quietly start outside the mesh. Run more than one istiod in production.",
        }),
        ev({
          id: "sm5", at: 90000, src: "kubectl", dst: API, layer: "api", size: "0.2 KB", title: "LABEL THE NAMESPACE", path: ["you", "api"],
          says: "You label the default namespace. The Pods already running there stay as they are.",
          info: "kubectl label namespace default istio-injection=enabled",
          decoded: [
            sec("PATCH NAMESPACE", [["labels", "istio-injection=enabled", true], ["running Pods", "unchanged - a Pod's containers can't be added later"]]),
          ],
        }),
      ],
    },
    {
      title: "A PROXY IS ADDED",
      subtitle: "the Pod you asked for, plus one",
      body: `To join the mesh, Pods have to be created again, so you restart the Deployments. The ReplicaSet controller asks for an ordinary one-container Pod. Before saving it, the API server sends it to istiod, and istiod answers with a patch that adds two things: istio-init, which sets up the network once and exits, and istio-proxy, an Envoy proxy that stays. Your Deployment doesn't mention either. The change is made to each Pod, on its way in.`,
      facts: [
        ["YOU WROTE", "1 container · web"],
        ["ISTIO-INIT", "added · runs once"],
        ["ISTIO-PROXY", "added · Envoy · stays"],
        ["KUBECTL SHOWS", "2/2 READY"],
      ],
      view: "cluster",
      focus: ["you", "api", "node1", "node2"],
      events: [
        ev({
          id: "sm6", at: 120000, src: "kubectl", dst: API, layer: "api", size: "0.3 KB", title: "RESTART THE DEPLOYMENTS", path: ["you", "api"],
          says: "You restart web and api, so their Pods are created again.",
          info: "kubectl rollout restart deployment",
          decoded: [sec("PATCH", [["annotation", "kubectl.kubernetes.io/restartedAt", true], ["result", "a rolling update to new Pods"]])],
        }),
        ev({
          id: "sm7", at: 120060, src: API, dst: "istiod", layer: "control", size: "4.0 KB", title: "ASK ISTIOD FIRST", path: ["api", "node1"],
          says: "A new web Pod is asked for. Before saving it, the API server shows it to istiod.",
          info: "POST https://istiod.istio-system.svc:443/inject",
          decoded: [sec("ADMISSIONREVIEW · REQUEST", [["operation", "CREATE"], ["object", "Pod web-…"], ["containers", "web"], ["stored yet", "no", true]])],
        }),
        ev({
          id: "sm8", at: 120070, src: "istiod", dst: API, layer: "control", size: "7.2 KB", title: "THE PATCH", path: ["node1", "api"],
          says: "istiod answers with a patch that adds a setup container and a proxy.",
          info: "AdmissionReview response · JSONPatch · allowed",
          decoded: [
            sec("initContainers added", [["istio-init", "writes iptables rules · NET_ADMIN, NET_RAW", true], ["istio-proxy", "restartPolicy: Always · runs as UID 1337", true], ["requests", "cpu 100m · memory 128Mi"]]),
            sec("VOLUMES ADDED", [["istio-token", "a ServiceAccount token · audience istio-ca"], ["istiod-ca-cert", "the mesh's root certificate"]]),
          ],
          note: "An init container with restartPolicy: Always is a native sidecar. It starts before the app, keeps running beside it, and stops after it. Older Istio versions added the proxy as an ordinary container, with none of those guarantees.",
        }),
        ev({
          id: "sm9", at: 123500, src: API, dst: "kubelet · node-1", layer: "node", size: "11 KB", title: "2/2 READY", path: ["api", "node1"],
          says: "The patched Pods start and replace the old ones. Each one now has two containers.",
          info: `${WEB}  2/2  Running · ${API_POD}  2/2  Running`,
          pods: { node1: ["other", "other", "v2"], node2: ["other", "v2", "v2"] },
          decoded: [sec("POD, AS STORED", [["initContainers", "istio-init, istio-proxy", true], ["containers", "web"], ["annotation", "sidecar.istio.io/status"], ["IP", "10.244.1.40"]])],
        }),
      ],
    },
    {
      title: "EVERY CONNECTION, REDIRECTED",
      subtitle: "iptables inside the Pod",
      body: "This is what's inside the two Pods now. The app doesn't know about the proxy, so something has to send its traffic there. istio-init does it with iptables rules in the Pod's own network namespace: TCP connections going out are redirected to port 15001, connections coming in to 15006, and Envoy listens on both. One exception keeps it from looping: whatever the proxy itself sends, recognized by its user ID 1337, goes straight out.",
      facts: [
        ["OUTBOUND TCP", "→ 15001 · Envoy"],
        ["INBOUND TCP", "→ 15006 · Envoy"],
        ["EXCEPT", "traffic from UID 1337, the proxy"],
        ["APP CHANGES", "none"],
      ],
      view: "mesh",
      focus: ["m.web", "m.wipt", "m.wproxy", "m.weth0"],
      events: [
        ev({
          id: "sm10", at: 123600, src: "istio-init · web", dst: IPT_WEB, layer: "node", size: " - ", title: "WRITE THE RULES", path: ["m.wipt", "m.wipt"],
          says: "istio-init runs first. It writes the redirect rules, then exits.",
          info: "istio-iptables -p 15001 -z 15006 -u 1337 -m REDIRECT",
          decoded: [
            sec("TABLE NAT · OUTBOUND", [["OUTPUT", "-j ISTIO_OUTPUT"], ["from the proxy", "-m owner --uid-owner 1337 -j RETURN", true], ["to localhost", "-d 127.0.0.1/32 -j RETURN"], ["the rest", "-j ISTIO_REDIRECT"], ["ISTIO_REDIRECT", "-p tcp -j REDIRECT --to-ports 15001", true]]),
            sec("TABLE NAT · INBOUND", [["PREROUTING", "-p tcp -j ISTIO_INBOUND"], ["ISTIO_INBOUND", "-p tcp -j ISTIO_IN_REDIRECT"], ["ISTIO_IN_REDIRECT", "-p tcp -j REDIRECT --to-ports 15006", true]]),
          ],
          note: "Writing iptables rules needs NET_ADMIN, which some clusters don't allow in app Pods. The Istio CNI plugin writes the same rules from the node instead. Either way the redirect isn't a security boundary: a process running as UID 1337 skips it on the way out. That's why access rules are checked at the receiving Pod.",
        }),
        ev({
          id: "sm11", at: 124000, src: WPROXY, dst: WPROXY, layer: "node", size: " - ", title: "PROXY BEFORE APP", path: ["m.wproxy", "m.wproxy"],
          says: "istio-proxy starts next, and the app waits until it's ready.",
          info: "pilot-agent starts Envoy · ports 15001, 15006, 15021, 15090",
          decoded: [
            sec("istio-proxy", [["pilot-agent", "gets certificates, starts and watches Envoy"], ["envoy", "carries the traffic"], [":15021", "readiness"], [":15090", "Envoy's metrics"]]),
            sec("START ORDER", [["1", "istio-init · exits"], ["2", "istio-proxy · ready"], ["3", "web · starts", true]]),
          ],
        }),
      ],
    },
    {
      title: "AN IDENTITY FOR EACH POD",
      subtitle: "a certificate, not an IP",
      body: "Before any traffic, the proxy needs to prove who it is. It makes a private key and sends istiod a signing request, along with the Pod's ServiceAccount token. istiod has the API server check the token, then signs a certificate that names the ServiceAccount: spiffe://cluster.local/ns/default/sa/web. The key never leaves the Pod. The certificate is good for 24 hours and replaced around the halfway mark, with no restart.",
      facts: [
        ["IDENTITY", "spiffe://cluster.local/ns/default/sa/web"],
        ["COMES FROM", "the Pod's ServiceAccount"],
        ["VALID", "24 hours · renewed at about 12"],
        ["SIGNED BY", "istiod, as the mesh's CA"],
      ],
      view: "mesh",
      focus: ["m.istiod", "m.wproxy"],
      events: [
        ev({
          id: "sm12", at: 124050, src: WPROXY, dst: "istiod", layer: "control", size: "2.4 KB", title: "SIGN THIS, PLEASE", path: ["m.wproxy", "m.istiod"],
          says: "The proxy asks istiod for a certificate, with the Pod's token as proof.",
          info: "gRPC CreateCertificate · istiod:15012",
          decoded: [
            sec("SIGNING REQUEST", [["public key", "RSA 2048"], ["private key", "stays in the Pod", true], ["proof", "ServiceAccount token · audience istio-ca"], ["checked with", "the API server · TokenReview"]]),
          ],
        }),
        ev({
          id: "sm13", at: 124080, src: "istiod", dst: WPROXY, layer: "control", size: "2.2 KB", title: "THE CERTIFICATE", path: ["m.istiod", "m.wproxy"],
          says: "istiod signs a certificate that names the ServiceAccount, good for a day.",
          info: "SAN URI:spiffe://cluster.local/ns/default/sa/web",
          decoded: [
            sec("CERTIFICATE", [["issuer", "O=cluster.local"], ["subject", "(empty)"], ["subject alt name", "spiffe://cluster.local/ns/default/sa/web", true], ["lifetime", "24 h", true]]),
            sec("HANDED TO ENVOY", [["over", "a Unix socket inside the Pod · SDS"], ["on renewal", "swapped without a restart"]]),
          ],
          note: "Pods that share a ServiceAccount share an identity. Everything left on the default account looks the same to the mesh, so give each app its own.",
        }),
      ],
    },
    {
      title: "CONFIGURATION, PUSHED",
      subtitle: "istiod tells every proxy what to do",
      body: "An Envoy proxy starts out knowing nothing. istiod watches the API server for Services, endpoints and Istio's own objects, works out what each proxy needs, and sends it down a stream that stays open. The protocol is called xDS. When something changes, istiod waits 100 ms in case more is coming, then pushes the parts it affects. No request goes through istiod, so if it stops, calls keep working with the last configuration.",
      facts: [
        ["PROTOCOL", "xDS over gRPC · istiod:15012"],
        ["SENT", "clusters · endpoints · listeners · routes"],
        ["ON A CHANGE", "wait 100 ms, then push what it affects"],
        ["IF ISTIOD STOPS", "proxies keep their last configuration"],
      ],
      view: "mesh",
      focus: ["m.istiod", "m.wproxy", "m.aproxy"],
      events: [
        ev({
          id: "sm14", at: 124200, src: "istiod", dst: WPROXY, layer: "control", size: "70 KB", title: "THE FIRST PUSH", path: ["m.istiod", "m.wproxy"],
          says: "istiod sends the proxy a map of the whole cluster: what exists and how to reach it.",
          info: "CDS 19 · EDS 15 · LDS 15 · RDS 6",
          decoded: [
            sec("XDS · FOUR KINDS", [["clusters · CDS", "19 · 19.0 kB · where traffic can go"], ["endpoints · EDS", "15 · 3.0 kB · the Pods behind each"], ["listeners · LDS", "15 · 43.5 kB · what to accept, per port"], ["routes · RDS", "6 · 4.9 kB · which request goes where"]]),
          ],
          note: "By default every proxy learns about every Service. In a large cluster that adds up to a lot of memory, and a Sidecar object trims it to what each app calls.",
        }),
        ev({
          id: "sm15", at: 127000, src: "istiod", dst: WPROXY, layer: "control", size: "0.2 KB", title: "ONE NEW POD", path: ["m.istiod", "m.wproxy"],
          says: "A new api Pod becomes ready. istiod pushes one small update, not the whole map.",
          info: "EDS: PUSH INC · resources:1 · size:200B",
          decoded: [
            sec("EDS · INCREMENTAL", [["cluster", "outbound|8080||api.default.svc.cluster.local"], ["endpoints", "10.244.2.40:8080 · 10.244.1.42:8080", true], ["clusters, listeners, routes", "not sent again"]]),
          ],
        }),
      ],
    },
    {
      title: "THE CALL GOES OUT",
      subtitle: "plain in, encrypted out",
      body: "web opens a connection to api's Service address, 10.96.45.10:8080, as it always did. The redirect hands it to Envoy on 15001, and Envoy asks the kernel where it was really going. It reads the HTTP request, matches the Host header to a route, and picks a Pod itself, so the Service IP is never dialed and kube-proxy isn't involved. Then the two proxies open a TLS connection in which both show a certificate. That's mutual TLS, or mTLS.",
      facts: [
        ["WEB DIALED", "10.96.45.10:8080"],
        ["ENVOY PICKED", "10.244.2.40:8080 · a Pod"],
        ["ENCRYPTION", "TLS 1.3 · both sides show a certificate"],
        ["FIRST CALL", "≈ 4 ms of handshake, then reused"],
      ],
      view: "mesh",
      focus: ["m.web", "m.wipt", "m.wproxy", "m.weth0", "m.aproxy"],
      events: [
        ev({
          id: "sm16", at: 180000, src: WEB, dst: IPT_WEB, layer: "net", size: "74 B", title: "REDIRECTED TO 15001", path: ["m.web", "m.wipt"],
          says: "web connects to the api Service. The rules send the connection to the proxy.",
          info: "SYN → 10.96.45.10:8080 · REDIRECT → :15001",
          decoded: [sec("NAT · OUTPUT", [["owner", "not UID 1337 → redirect"], ["dst", "10.96.45.10:8080 → 127.0.0.1:15001", true], ["web notices", "nothing - it sees an open connection"]])],
        }),
        ev({
          id: "sm17", at: 180000.3, src: IPT_WEB, dst: WPROXY, layer: "net", size: "78 B", title: "READ THE REQUEST", path: ["m.wipt", "m.wproxy"],
          says: "Envoy finds the original address, reads the request, and picks an api Pod itself.",
          info: "Host api:8080 → outbound|8080||api… → 10.244.2.40:8080",
          decoded: [
            sec("ENVOY'S DECISION", [["original dst", "10.96.45.10:8080 · SO_ORIGINAL_DST"], ["listener", "0.0.0.0_8080"], ["route", "Host api:8080 → Service api"], ["endpoint", "10.244.2.40:8080 · from EDS", true]]),
          ],
          note: "Envoy can do this because it sees HTTP. For protocols it can't read, it still encrypts and balances connections, but it can't retry or split single requests. Name the Service port (http, grpc) or set appProtocol so Istio knows.",
        }),
        ev({
          id: "sm18", at: 180001, src: WPROXY, dst: APROXY, layer: "net", size: "1.6 KB", title: "CLIENTHELLO", path: ["m.wproxy", "m.aproxy"],
          says: "web's proxy opens a TLS connection straight to the api Pod.",
          info: "SNI outbound_.8080_._.api.default.svc.cluster.local",
          frame: [layer("Ethernet", "MACs", 14), layer("IPv4", "10.244.1.40 → 10.244.2.40", 20), layer("TCP", "→ 8080 [PSH, ACK]", 32), layer("TLS", "ClientHello", 1526)],
          decoded: [
            sec("TLS CLIENTHELLO", [["version", "TLS 1.3"], ["SNI", "outbound_.8080_._.api.default.svc.cluster.local", true], ["ALPN", "istio-http/1.1, istio, http/1.1", true]]),
          ],
          note: "The ALPN names are how the receiving proxy recognizes mesh traffic. By default it accepts both this and plain text, which is what lets you move apps over one at a time.",
        }),
        ev({
          id: "sm19", at: 180005, src: APROXY, dst: WPROXY, layer: "net", size: "3.3 KB", title: "BOTH SHOW CERTIFICATES", path: ["m.aproxy", "m.wproxy"],
          says: "Each proxy checks the other's certificate. web proves it's web, api proves it's api.",
          info: "sa/web ⇄ sa/api · TLS 1.3 · mutual",
          decoded: [
            sec("THE CALLER'S PROXY CHECKS", [["certificate", "spiffe://cluster.local/ns/default/sa/api", true], ["allowed for Service api", "yes - its Pods run as sa/api"]]),
            sec("THE CALLED POD'S PROXY CHECKS", [["certificate", "spiffe://cluster.local/ns/default/sa/web", true], ["signed by the mesh's CA", "yes"]]),
          ],
        }),
        ev({
          id: "sm20", at: 180005.2, src: WPROXY, dst: APROXY, layer: "net", size: "836 B", title: "ENCRYPTED REQUEST", path: ["m.wproxy", "m.aeth0"],
          says: "The request crosses the network encrypted. The proxy's own packets aren't redirected.",
          info: "TLS application data · 770 B",
          frame: [layer("Ethernet", "MACs", 14), layer("IPv4", "10.244.1.40 → 10.244.2.40", 20), layer("TCP", "→ 8080 [PSH, ACK]", 32), layer("TLS", "GET /orders (ciphertext)", 770)],
          decoded: [
            sec("ADDED BY THE PROXY", [["x-request-id", "397a661a-d172-4c87-8ea0-9970ca1431ac"], ["x-forwarded-proto", "http"], ["x-envoy-attempt-count", "1"], ["x-envoy-peer-metadata", "who is calling, for the metrics"]]),
            sec("ON THE WIRE", [["readable", "no", true], ["grew from", "78 B to 770 B"]]),
          ],
        }),
      ],
    },
    {
      title: "THE CALL COMES IN",
      subtitle: "checked, then handed over",
      body: "The packets arrive for port 8080, and the api Pod's rules send them to Envoy on 15006. Envoy decrypts, knows from the certificate that this is web, checks its access rules, and passes the request to the app over localhost as plain HTTP. api sees a connection from 127.0.0.6 and a header that says who called. On the way back, both proxies write down what happened, so you get the same metrics for every app without touching any of them.",
      facts: [
        ["REDIRECTED", "8080 → 15006"],
        ["CALLER", "sa/web · from the certificate"],
        ["API SEES", "plain HTTP from 127.0.0.6"],
        ["RECORDED", "by both proxies"],
      ],
      view: "mesh",
      focus: ["m.web", "m.aeth0", "m.aipt", "m.aproxy", "m.api"],
      events: [
        ev({
          id: "sm21", at: 180005.3, src: IPT_API, dst: APROXY, layer: "net", size: "836 B", title: "REDIRECTED TO 15006", path: ["m.aeth0", "m.aproxy"],
          says: "The api Pod's rules send what arrives on 8080 to its proxy.",
          info: "PREROUTING · REDIRECT → :15006",
          decoded: [sec("NAT · PREROUTING", [["dst", "10.244.2.40:8080 → 10.244.2.40:15006", true], ["filter chain", "TLS with ALPN istio-http/1.1"], ["original port", "8080 · kept for the app"]])],
        }),
        ev({
          id: "sm22", at: 180006, src: APROXY, dst: API_POD, layer: "net", size: "0.4 KB", title: "PLAIN HTTP TO THE APP", path: ["m.aproxy", "m.api"],
          says: "The proxy decrypts the request, notes the caller, and passes it to the app.",
          info: "127.0.0.6:60082 → 10.244.2.40:8080",
          decoded: [
            sec("WHAT THE APP GETS", [["client", "127.0.0.6 · its own proxy"], ["GET", "/orders"], ["x-forwarded-client-cert", "URI=spiffe://cluster.local/ns/default/sa/web", true]]),
          ],
        }),
        ev({
          id: "sm23", at: 180007, src: API_POD, dst: WEB, layer: "net", size: "0.5 KB", title: "200 OK", path: ["m.api", "m.web"],
          says: "api answers, and the reply goes back the same way. web gets a plain 200.",
          info: "200 · back through both proxies on the same connections",
          decoded: [sec("ACCESS LOG · CALLER", [["request", "GET /orders HTTP/1.1"], ["status", "200", true], ["upstream", "10.244.2.40:8080 · outbound|8080||api…"], ["duration", "7 ms · the next calls took 1"]])],
        }),
        ev({
          id: "sm24", at: 180008, src: APROXY, dst: APROXY, layer: "node", size: " - ", title: "COUNTED ON BOTH ENDS", path: ["m.aproxy", "m.aproxy"],
          says: "Both proxies count the call, with names on it. Prometheus collects that from port 15020.",
          info: "istio_requests_total{source_workload=\"web\",destination_workload=\"api-v1\",response_code=\"200\"}",
          decoded: [
            sec("METRIC", [["source_principal", "spiffe://cluster.local/ns/default/sa/web"], ["destination_service", "api.default.svc.cluster.local"], ["response_code", "200", true], ["reporter", "source, and again as destination"]]),
          ],
          note: "Traces need a little help. A proxy can't tell which outgoing call belongs to which incoming one, so the app has to copy the trace headers (traceparent, or b3) from one to the other.",
        }),
      ],
    },
    {
      title: "SPLIT AND RETRY",
      subtitle: "traffic rules, no redeploy",
      body: "Now the proxies can do things you'd otherwise code. You apply two objects. A DestinationRule names groups of Pods by label: v1 and v2. A VirtualService sends 90% of requests to v1, 10% to v2, and retries failures twice. istiod turns them into Envoy config and pushes it to the callers. One thing surprises people: Envoy picks the group first, and retries stay inside it. A retry can step around one broken Pod, but if all of v2 is broken, its 10% still fails.",
      facts: [
        ["DESTINATIONRULE", "subsets v1, v2 · by label"],
        ["VIRTUALSERVICE", "90 / 10 · 2 retries on 5xx"],
        ["200 CALLS", "182 to v1 · 18 to v2"],
        ["RETRIES", "stay in the chosen subset"],
      ],
      view: "mesh",
      focus: ["m.istiod", "m.wproxy", "m.aproxy", "m.v1b", "m.v2"],
      events: [
        ev({
          id: "sm25", at: 300100, src: "istiod", dst: WPROXY, layer: "control", size: "53 KB", title: "NEW ROUTES", path: ["m.istiod", "m.wproxy"],
          says: "You apply both objects. 100 ms later the new routes are in web's proxy.",
          info: "push · VirtualService api, DestinationRule api",
          decoded: [
            sec("VIRTUALSERVICE · SPEC", [["hosts", "api"], ["route", "subset v1 weight 90 · subset v2 weight 10", true], ["retries.attempts", "2"], ["retries.perTryTimeout", "1s"], ["retries.retryOn", "5xx,reset,connect-failure"]]),
            sec("ENVOY GOT", [["clusters", "outbound|8080|v1|api… · outbound|8080|v2|api…", true], ["weights", "90 · 10"]]),
          ],
          note: "The caller's proxy makes this choice, so it only works for callers in the mesh. The Gateway API's HTTPRoute can express the same split, and Istio reads that too.",
        }),
        ev({
          id: "sm26", at: 300500, src: WPROXY, dst: API_V2, layer: "net", size: "836 B", title: "ONE IN TEN TO V2", path: ["m.wproxy", "m.v2"],
          says: "About one request in ten goes to v2. The other nine go to v1.",
          info: "200 calls → 182 v1 · 18 v2",
          decoded: [sec("WEIGHTED ROUTE", [["v1", "182 of 200"], ["v2", "18 of 200", true], ["decided", "per request, at random"], ["Pod counts", "don't matter"]])],
        }),
        ev({
          id: "sm27", at: 310000, src: WPROXY, dst: API_B, layer: "net", size: "836 B", title: "FIRST TRY", path: ["m.wproxy", "m.v1b"],
          says: "Now one of the two v1 Pods is broken, and a request lands on it.",
          info: "attempt 1 → 10.244.1.42:8080",
          decoded: [sec("ATTEMPT 1", [["subset", "v1"], ["endpoint", "10.244.1.42:8080 · broken"], ["request id", "73e0dd6b-f55d-4998-9839-ddadcc601573"]])],
        }),
        ev({
          id: "sm28", at: 310002, src: API_B, dst: WPROXY, layer: "drop", size: "0.5 KB", title: "503", path: ["m.v1b", "m.wproxy"],
          says: "It answers 503. The proxy keeps that to itself and waits a few milliseconds.",
          info: "503 · matches retryOn 5xx",
          decoded: [sec("RETRY POLICY", [["response", "503", true], ["retryOn", "5xx → try again"], ["wait", "a short, random backoff"], ["next Pod", "not the one that just failed"]])],
        }),
        ev({
          id: "sm29", at: 310016, src: WPROXY, dst: APROXY, layer: "net", size: "836 B", title: "SECOND TRY, 200", path: ["m.wproxy", "m.aproxy"],
          says: "The second try goes to the other v1 Pod and works. web only ever sees the 200.",
          info: "attempt 2 → 10.244.2.40:8080 · 200 · 17 ms in all",
          decoded: [sec("ATTEMPT 2", [["endpoint", "10.244.2.40:8080"], ["x-envoy-attempt-count", "2", true], ["result", "100 of 100 calls returned 200"], ["with Istio's default retries", "37 of 100 returned 503"]])],
          note: "Istio's default is 2 retries too, but mostly for calls that didn't get through, such as a refused connection. A 503 the app sent is not retried until you ask for it. Only ask where repeating a request is safe.",
        }),
        ev({
          id: "sm30", at: 320000, src: API_V2, dst: WPROXY, layer: "drop", size: "0.5 KB", title: "A RETRY CAN'T LEAVE V2", path: ["m.v2", "m.wproxy"],
          says: "When v2 itself is broken, its share still fails: retries stay within v2.",
          info: "100 calls → 92 × 200 · 8 × 503",
          decoded: [sec("V2 BROKEN, RETRIES ON", [["200", "92"], ["503", "8 · the share that went to v2", true], ["why", "the subset is chosen once, before the first try"]])],
          note: "This is why a canary still needs watching. The metrics from the last step show v2's errors separately, so you can set its weight back to 0.",
        }),
      ],
    },
    {
      title: "WHO MAY CALL",
      subtitle: "rules about identity, not IPs",
      body: "Since every caller has a proven identity, you can write rules about it. Two objects do that. PeerAuthentication STRICT says: refuse anything that isn't mTLS. AuthorizationPolicy says: only sa/web may call api, and only with GET on /orders. api's own proxy enforces both, right before the app. A caller in the mesh with the wrong identity gets a 403. A caller without a proxy has no identity at all, and its connection is cut.",
      facts: [
        ["WHO GETS IN", "mTLS only · PeerAuthentication STRICT"],
        ["WHO MAY CALL", "sa/web · GET /orders* · AuthorizationPolicy"],
        ["WRONG IDENTITY", "403 · RBAC: access denied"],
        ["NO IDENTITY", "connection reset"],
      ],
      view: "mesh",
      focus: ["m.istiod", "m.busybox", "m.aeth0", "m.aipt", "m.aproxy"],
      events: [
        ev({
          id: "sm31", at: 600100, src: "istiod", dst: APROXY, layer: "control", size: "50 KB", title: "RULES FOR THE CALLED POD", path: ["m.istiod", "m.aproxy"],
          says: "You apply both policies, and istiod pushes them to the proxy they protect.",
          info: "push · AuthorizationPolicy api-allow-web, PeerAuthentication default",
          decoded: [
            sec("AUTHORIZATIONPOLICY · SPEC", [["selector", "app: api"], ["action", "ALLOW"], ["from.principals", "cluster.local/ns/default/sa/web", true], ["to.operation", "GET /orders*", true], ["anything else", "denied, once an ALLOW rule exists"]]),
            sec("PEERAUTHENTICATION · SPEC", [["mtls.mode", "PERMISSIVE → STRICT", true]]),
          ],
        }),
        ev({
          id: "sm32", at: 610000, src: BUSYBOX, dst: APROXY, layer: "net", size: "0.8 KB", title: "BUSYBOX TRIES", path: ["m.busybox", "m.aproxy"],
          says: "busybox is in the mesh too. Its certificate is valid, but it says sa/default.",
          info: "GET /orders · mTLS as spiffe://cluster.local/ns/default/sa/default",
          decoded: [sec("CALLER", [["certificate", "valid, signed by the mesh's CA"], ["identity", "cluster.local/ns/default/sa/default", true], ["matches the rule", "no"]])],
        }),
        ev({
          id: "sm33", at: 610001, src: APROXY, dst: BUSYBOX, layer: "drop", size: "0.2 KB", title: "403 FORBIDDEN", path: ["m.aproxy", "m.busybox"],
          says: "api's proxy answers 403 itself. The request never reaches the app.",
          info: "403 · RBAC: access denied",
          decoded: [
            sec("RESPONSE", [["status", "403 Forbidden", true], ["server", "envoy"], ["body", "RBAC: access denied"]]),
            sec("ACCESS LOG · CALLED POD", [["reason", "rbac_access_denied_matched_policy[none]"], ["upstream", "- · the app was never called"]]),
          ],
          note: "The rule reads HTTP, so even web gets a 403 if it sends a POST. A NetworkPolicy works lower down: it sees addresses and ports, and drops packets silently. The two go well together.",
        }),
        ev({
          id: "sm34", at: 620000, src: BUSYBOX, dst: APROXY, layer: "drop", size: "74 B", title: "NO PROXY, NO ENTRY", path: ["m.busybox", "m.aproxy"],
          says: "Started again without a sidecar, busybox sends plain HTTP. The connection is reset.",
          info: "0 NR filter_chain_not_found",
          decoded: [
            sec("ACCESS LOG · CALLED POD", [["flags", "NR filter_chain_not_found", true], ["meaning", "nothing here accepts plain text any more"]]),
            sec("BUSYBOX SEES", [["curl", "(56) Recv failure: Connection reset by peer"]]),
          ],
          note: "Turn on STRICT last. Until every caller has a proxy, STRICT locks out the ones that don't, and that includes anything calling from outside the mesh.",
        }),
      ],
    },
    {
      title: "A MESH WITHOUT SIDECARS",
      subtitle: "ambient mode",
      body: "A proxy in every Pod has a price: each one reserves 100m CPU and 128Mi, and adding or upgrading it means restarting Pods. Istio's ambient mode splits the job in two. A ztunnel on each node does encryption, identity and connection-level rules for all its Pods. Where you also need HTTP features such as splits and retries, you add a waypoint, an Envoy shared by a whole Service or namespace. You label the namespace and the running Pods join as they are.",
      facts: [
        ["OPT IN", "istio.io/dataplane-mode=ambient"],
        ["ZTUNNEL", "1 per node · ≈ 0.06 vCPU, 12 MB"],
        ["SIDECAR", "1 per Pod · ≈ 0.20 vCPU, 60 MB"],
        ["HTTP FEATURES", "need a waypoint"],
      ],
      view: "ambient",
      focus: ["a.cni", "a.web", "a.zt1", "a.waypoint", "a.zt2", "a.api"],
      events: [
        ev({
          id: "sm35", at: 900000, src: "istio-cni · node-1", dst: WEB, layer: "node", size: " - ", title: "JOINED, NOT RESTARTED", path: ["a.cni", "a.web"],
          says: "You label the namespace. On each node, istio-cni sets up the redirect inside the running Pods.",
          info: "label namespace istio.io/dataplane-mode=ambient",
          decoded: [sec("THE WEB POD", [["containers", "web · nothing added", true], ["READY", "1/1"], ["restarted", "no", true], ["redirect", "set up inside its network namespace, from the node"]])],
          note: "The picture starts over here: these Pods never had sidecars. A Pod that already has one keeps using it until it's restarted without it.",
        }),
        ev({
          id: "sm36", at: 900010, src: WEB, dst: ZT1, layer: "net", size: "78 B", title: "TO THE NODE'S ZTUNNEL", path: ["a.web", "a.zt1"],
          says: "web calls api as before. This time the connection goes to the node's ztunnel.",
          info: "10.244.1.40 → 10.96.45.10:8080 · captured by ztunnel",
          decoded: [sec("ZTUNNEL", [["acts as", "spiffe://cluster.local/ns/default/sa/web", true], ["shared by", "every Pod on node-1"], ["reads HTTP", "no - it only sees a connection"]])],
        }),
        ev({
          id: "sm37", at: 900011, src: ZT1, dst: ZT2, layer: "net", size: "0.4 KB", title: "THE HBONE TUNNEL", path: ["a.zt1", "a.zt2"],
          says: "ztunnel carries it to the other node in an mTLS tunnel, on port 15008.",
          info: "HTTP/2 CONNECT over mTLS · 10.244.2.40:15008",
          decoded: [
            sec("ZTUNNEL LOG · NODE-1", [["src.identity", "spiffe://cluster.local/ns/default/sa/web", true], ["dst.addr", "10.244.2.40:15008"], ["dst.hbone_addr", "10.244.2.40:8080"], ["dst.identity", "spiffe://cluster.local/ns/default/sa/api", true]]),
          ],
          note: "The tunnel is called HBONE: an HTTP CONNECT inside mutual TLS. The identities are the same SPIFFE names as before, one per ServiceAccount, even though the proxy is shared.",
        }),
        ev({
          id: "sm38", at: 900012, src: ZT2, dst: API_POD, layer: "net", size: "78 B", title: "PLAIN TO THE APP", path: ["a.zt2", "a.api"],
          says: "The other ztunnel opens the tunnel and hands the bytes to api.",
          info: "→ 10.244.2.40:8080 · plain HTTP",
          decoded: [sec("ZTUNNEL LOG · NODE-2", [["direction", "inbound"], ["bytes_recv", "78"], ["bytes_sent", "267"], ["duration", "1 ms"]])],
        }),
        ev({
          id: "sm39", at: 960000, src: ZT1, dst: "waypoint", layer: "net", size: "0.4 KB", title: "A WAYPOINT, FOR HTTP", path: ["a.zt1", "a.waypoint"],
          says: "For HTTP rules you add a waypoint. ztunnel sends api's traffic there first.",
          info: "istioctl waypoint apply · label istio.io/use-waypoint",
          decoded: [sec("WAYPOINT", [["is", "an Envoy proxy in its own Deployment"], ["does", "splits, retries, HTTP rules", true], ["shared by", "a Service or a namespace"], ["without it", "ztunnel: mTLS and rules on identity and port"]])],
        }),
        ev({
          id: "sm40", at: 960001, src: "waypoint", dst: ZT2, layer: "net", size: "0.4 KB", title: "ON TO THE APP'S NODE", path: ["a.waypoint", "a.zt2"],
          says: "The waypoint applies the rules, then sends the request on to api's node.",
          info: "HBONE · waypoint → 10.244.2.40:15008",
          decoded: [sec("THE TRADE", [["extra hop", "web → ztunnel → waypoint → ztunnel → api"], ["proxies to run", "one per node, plus waypoints where needed", true], ["istiod", "configures all of them, over xDS"]])],
          note: "The CPU and memory figures in this step are from Istio's own benchmark, at 1000 requests a second with 1 KB payloads.",
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "web's first call, end to end", layer: "net", start: 180000, duration: 8 },
    { value: "t2", label: "mTLS handshake, first call only", layer: "net", start: 180001, duration: 4.2 },
    { value: "t3", label: "encrypted request, proxy to proxy", layer: "net", start: 180005.2, duration: 0.8 },
    { value: "t4", label: "api answers, back through both proxies", layer: "node", start: 180006, duration: 2 },
  ],
  timingNote: "Only the first call is charted, since the rest of the lesson spans minutes. It opens new connections; the calls after it reuse them and take about 1 ms here.",
  summary: {
    title: "THE NETWORK, WITH NAMES ON IT",
    body: "A service mesh is two simple parts. Proxies carry every call, so they can encrypt it, prove who made it, retry it, split it and count it. A control plane turns your objects into configuration and certificates for those proxies, and stays out of the traffic. The apps didn't change. In return you run more proxies, and one more system that can be configured wrong, so a mesh pays off when many services need the same things.",
    facts: [
      ["DATA PLANE", "Envoy sidecars · or ztunnel and waypoints"],
      ["CONTROL PLANE", "istiod · injects, signs, configures"],
      ["IDENTITY", "a ServiceAccount, proven with mTLS"],
      ["NEXT", "Starting a container"],
    ],
  },
}
