import type { Lesson } from "../types"
import { ev, layer, sec } from "./helpers"

const KUBELET = "kubelet · node-2"
const CONTAINERD = "containerd · node-2"
const SNAP = "snapshotter"
const REG = "registry.example.com"
const REGISTRY = `${REG}/shop/web`

export const imagePull: Lesson = {
  id: "image-pull",
  title: "Pulling an image",
  subtitle: "Manifests, layers, cache",
  category: "node",
  seo: {
    title: "How Kubernetes pulls a container image",
    description: "How containerd resolves a tag, downloads only the missing image layers and unpacks them on a Kubernetes node, and why the second pull is instant.",
  },
  actors: ["cp", "node2"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    [KUBELET]: "kubelet", [CONTAINERD]: "containerd", [SNAP]: "containerd",
    [REG]: "registry",
  },
  overview: {
    body: "How containerd finds, downloads and unpacks image layers, and why the second pull is instant. Follow the 1.5.0 pull on node-2: three of its five layers are already on disk from 1.4.2, so 6.1 MB moves instead of 48 MB - and the next pull of the same tag moves nothing at all.",
    facts: [
      ["IMAGE", `${REGISTRY}:1.5.0`],
      ["LAYERS", "5 · 3 already on disk · 2 to fetch"],
      ["DOWNLOAD", "6.1 MB of 48.3 MB"],
      ["DIGESTS", "every blob addressed by sha256 of its bytes"],
    ],
  },
  steps: [
    {
      title: "RESOLVE AND AUTH",
      subtitle: "who may pull this",
      body: `The kubelet's PullImage call lands on containerd, which turns the registry name into a connection: DNS for ${REG}, then HTTPS on 443. The registry answers the first request with 401 and a token service; containerd proves it may pull shop/web and gets a scoped bearer token. Public registries run the same dance with an anonymous token.`,
      facts: [
        ["HOST", `${REG}:443 · HTTPS`],
        ["TOKEN SCOPE", "repository:shop/web:pull"],
        ["COST", "≈ 80 ms"],
      ],
      view: "node2",
      focus: ["n2.kubelet", "n2.containerd"],
      events: [
        ev({
          id: "pu1", at: 0, src: KUBELET, dst: CONTAINERD, layer: "node", size: "0.2 KB", title: "PULL IMAGE", path: ["n2.kubelet", "n2.containerd"],
          says: "The kubelet asks containerd for the 1.5.0 image.",
          info: `PullImage ${REGISTRY}:1.5.0`,
          decoded: [sec("gRPC · runtime.v1.ImageService", [["method", "PullImage"], ["image", `${REGISTRY}:1.5.0`], ["why called", "kubelet's pullPolicy IfNotPresent · 1.5.0 isn't here yet"]])],
        }),
        ev({
          id: "pu2", at: 6, src: CONTAINERD, dst: REG, layer: "net", size: "0.6 KB", title: "CHALLENGE, TOKEN", path: ["n2.containerd", "n2.eth0"],
          says: "The registry asks who's calling, and a token service lets containerd in.",
          info: "GET /v2/ → 401 WWW-Authenticate → token",
          frame: [layer("Ethernet", "MACs", 14), layer("IPv4", "10.0.1.12 → 203.0.113.20", 20), layer("TCP", "49822 → 443 [TLS]", 40), layer("HTTP/2", "GET /v2/", 8)],
          decoded: [sec("AUTH HANDSHAKE", [["401", "Bearer realm=…/token"], ["grant", "repository:shop/web:pull", true], ["token", "issued, ~5 min TTL"]])],
        }),
      ],
    },
    {
      title: "THE MANIFEST",
      subtitle: "a menu of digests",
      body: "The first real fetch is the manifest: JSON that lists the layers as content-addressed digests. For a multi-arch image it's two steps - an index listing every platform, then the arm64 manifest inside it. Each digest is the sha256 of the exact bytes being described, which is what makes caching and verification the same mechanism.",
      facts: [
        ["STEP 1", "index · 6 platform entries"],
        ["STEP 2", "manifest · linux/arm64"],
        ["LAYERS LISTED", "5 digests · sha256:…"],
        ["COST", "≈ 60 ms"],
      ],
      view: "node2",
      focus: ["n2.containerd"],
      events: [
        ev({
          id: "pu3", at: 85, src: CONTAINERD, dst: REG, layer: "net", size: "2.1 KB", title: "GET MANIFEST", path: ["n2.containerd", "n2.eth0"],
          says: "containerd fetches the index, then the arm64 manifest inside it.",
          info: `GET /v2/shop/web/manifests/1.5.0 → index → linux/arm64`,
          decoded: [sec("OCI INDEX", [["mediaType", "application/vnd.oci.image.index.v1+json"], ["platforms", "amd64, arm64, s390x, …"], ["picked", "linux/arm64 → manifest sha256:8a71d4…", true]])],
        }),
        ev({
          id: "pu4", at: 110, src: CONTAINERD, dst: CONTAINERD, layer: "node", size: "1.3 KB", title: "FIVE DIGESTS", path: ["n2.containerd", "n2.containerd"],
          says: "The manifest lists five layers by the hash of their bytes.",
          info: "layers[0..4] · config sha256:b3e5a0…",
          decoded: [sec("MANIFEST · LINUX/ARM64", [["layer 1", "sha256:9a41b2… · 36.1 MB · base OS"], ["layer 2", "sha256:c07e31… · 5.0 MB · runtime"], ["layer 3", "sha256:0b7c55… · 1.1 MB · dependencies"], ["layer 4", "sha256:e19d70… · 6.1 MB · the app"], ["layer 5", "sha256:4a90cc… · 0.2 KB · config files"]])],
          note: "The tag 1.5.0 is a pointer; the digests are the identity. Pinning image@sha256:… freezes exactly these bytes forever.",
        }),
      ],
    },
    {
      title: "LAYER MATH",
      subtitle: "three skips, two downloads",
      body: "Before fetching anything, containerd checks its content store: do I already have these exact digests? Layers 1, 2 and 3 match 1.4.2's - base OS and runtime, unchanged - so they're skipped entirely. Layers 4 and 5 are new. The downloads run in parallel and each is verified as it streams in: the hash is computed while the bytes arrive, and a mismatch aborts the pull.",
      facts: [
        ["SKIP", "layers 1-3 · shared with 1.4.2"],
        ["FETCH", "layers 4-5 · 6.1 MB compressed"],
        ["VERIFY", "sha256 while streaming"],
        ["COST", "≈ 400 ms for 6.1 MB"],
      ],
      view: "node2",
      focus: ["n2.containerd"],
      events: [
        ev({
          id: "pu5", at: 130, src: CONTAINERD, dst: CONTAINERD, layer: "node", size: " - ", title: "CONTENT STORE CHECK", path: ["n2.containerd", "n2.containerd"],
          says: "Three of the five layers are already on disk, byte-for-byte identical.",
          info: "ingests needed: 2 of 5",
          decoded: [sec("CONTENT STORE", [["layer 1", "present (1.4.2 pull)"], ["layer 2", "present"], ["layer 3", "present"], ["layers 4-5", "missing · fetch", true]])],
        }),
        ev({
          id: "pu6", at: 140, src: CONTAINERD, dst: REG, layer: "net", size: "6.1 MB", title: "FETCH BLOBS", path: ["n2.containerd", "n2.eth0"],
          says: "Only the two new layers cross the network, in parallel, hashes checked as they land.",
          info: "GET /v2/shop/web/blobs/sha256:e19d70… · 4a90cc…",
          frame: [layer("Ethernet", "MACs", 14), layer("IPv4", "10.0.1.12 → 203.0.113.20", 20), layer("TCP", "49822 → 443 [TLS]", 40), layer("HTTP/2", "2 streams, gzip bodies", 24)],
          decoded: [sec("DOWNLOADS", [["e19d70…", "6.1 MB · verified on arrival", true], ["4a90cc…", "0.2 KB · verified"], ["streams", "2, parallel over one HTTP/2 connection"], ["on mismatch", "abort pull, error"]])],
          note: "This is why releases that share a base image are cheap to roll out: the 36.1 MB OS layer moved once, the day the first 1.4.x Pod landed.",
        }),
      ],
    },
    {
      title: "UNPACK",
      subtitle: "snapshots and whiteouts",
      body: "Bytes in the content store aren't a filesystem yet. The snapshotter unpacks each new layer's tar into its own snapshot directory, stacked on the three snapshots already there from 1.4.2. A whiteout file - usr/local/.wh.tmp in a later layer - records that this path was deleted upstream, so unpacking it hides usr/local/tmp from the layers below. Order matters: layer 5's files win over layer 1's wherever both have a path.",
      facts: [
        ["UNPACK", "layers 4 → 5, on top of 1-3"],
        ["WHITEOUTS", ".wh.<name> deletes from below"],
        ["RESULT", "5 stacked snapshots, 3 reused → ready for overlayfs"],
        ["COST", "≈ 150 ms"],
      ],
      view: "node2",
      focus: ["n2.containerd"],
      events: [
        ev({
          id: "pu7", at: 545, src: CONTAINERD, dst: SNAP, layer: "node", size: "6.1 MB", title: "UNPACK LAYERS", path: ["n2.containerd", "n2.containerd"],
          says: "The two new layers are unpacked, each into its own directory, on top of the three already there.",
          info: "unpack sha256:e19d70…, 4a90cc… → snapshots 207-208",
          decoded: [sec("SNAPSHOTTER", [["unpack", "layers 4-5 → snapshots 207-208"], ["reused", "snapshots 204-206 · layers 1-3 from 1.4.2", true], ["conflicts", "later layer overwrites earlier"], ["whiteouts", "usr/local/.wh.tmp hides the old dir"], ["mount preview", "overlay lowerdirs (next lesson's rootfs)"]])],
        }),
        ev({
          id: "pu8", at: 640, src: CONTAINERD, dst: KUBELET, layer: "node", size: "0.3 KB", title: "IMAGE READY", path: ["n2.containerd", "n2.kubelet"],
          says: "The image is stored, unpacked and indexed. 690 ms, most of it the 6.1 MB download.",
          info: `PullImage → imageRef sha256:8a71d4…`,
          decoded: [sec("METADATA STORE", [["image", `${REGISTRY}:1.5.0 → sha256:8a71d4…`, true], ["content", "5 blobs verified"], ["snapshots", "ready (overlayfs base)"], ["total", "≈ 690 ms"]])],
        }),
      ],
    },
    {
      title: "THE SECOND PULL",
      subtitle: "nothing moves",
      body: `Pull the same tag again on this node - imagePullPolicy: Always on a container restart, say - and almost nothing happens. containerd re-fetches only the manifest to learn what the tag points at today; the digest matches what's in the content store, every layer skips, and the call returns in tens of milliseconds. Rollbacks are the same trick in reverse: 1.4.2's layers are all still there.`,
      facts: [
        ["REFETCHED", "manifest only · 2.1 KB"],
        ["LAYERS MOVED", "0"],
        ["TIME", "≈ 55 ms"],
        ["ROLLOUT IMPLICATION", "surge Pod on this node pulls nothing"],
      ],
      view: "node2",
      focus: ["n2.kubelet", "n2.containerd"],
      events: [
        ev({
          id: "pu9", at: 800, src: KUBELET, dst: CONTAINERD, layer: "node", size: "0.2 KB", title: "PULL AGAIN", path: ["n2.kubelet", "n2.containerd"],
          says: "A second PullImage asks for the same tag.",
          info: `PullImage ${REGISTRY}:1.5.0 (already present)`,
          decoded: [sec("FAST PATH", [["manifest GET", "yes - the tag may have moved"], ["digest match", "sha256:8a71d4… = stored", true], ["blobs fetched", "none"], ["elapsed", "≈ 55 ms, ~50 of them the manifest round trip"]])],
          note: "The manifest check is why Always is tolerable: the tag is re-resolved, but bytes only move when the digest changes.",
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "DNS + auth token", layer: "net", start: 0, duration: 85 },
    { value: "t2", label: "index + manifest", layer: "net", start: 85, duration: 45 },
    { value: "t3", label: "skip 3 · fetch 2 layers", layer: "net", start: 130, duration: 415 },
    { value: "t4", label: "unpack into snapshots", layer: "node", start: 545, duration: 150 },
    { value: "t5", label: "second pull · manifest only", layer: "net", start: 800, duration: 55 },
  ],
  summary: {
    title: "CONTENT ADDRESSED",
    body: "Everything about image distribution falls out of one idea: blobs are named by the hash of their bytes. Sharing is automatic - same digest, same bytes, fetch once. Verification is free - hash what arrives. And a second pull is one manifest round trip, because the store already agrees with the registry about every layer.",
    facts: [
      ["MOVED", "6.1 MB once · 0 the second time"],
      ["SHARED", "layers 1-3 with every 1.4.x Pod here"],
      ["NEXT", "Probes and restarts"],
    ],
  },
}
