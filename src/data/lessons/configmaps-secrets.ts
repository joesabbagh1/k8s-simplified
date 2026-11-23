import type { Lesson } from "../types"
import { ev, sec } from "./helpers"

const KUBELET = "kubelet · node-2"
const CONTAINERD = "containerd · node-2"
const APP = "web app"

export const configmapsSecrets: Lesson = {
  id: "configmaps-secrets",
  title: "ConfigMaps and Secrets",
  subtitle: "Getting config into a Pod",
  category: "app",
  actors: ["you", "cp", "node2", "app-cm", "app-secret"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    [KUBELET]: "kubelet", [CONTAINERD]: "containerd", [APP]: "Pod x2kqp",
  },
  overview: {
    body: "Environment variables versus mounted files, and what actually happens when you update one. The web app takes its log level from an env var and its feature flags from a file. Same two objects - a ConfigMap and a Secret - but the two delivery paths have opposite update semantics, and knowing which is which explains most config surprises.",
    facts: [
      ["OBJECTS", "ConfigMap web-config · Secret stripe-key"],
      ["PATH 1", "env vars · fixed at container start"],
      ["PATH 2", "mounted files · refreshed in place"],
      ["SECRET = BASE64", "encoding, not encryption"],
    ],
  },
  steps: [
    {
      title: "TWO OBJECTS",
      subtitle: "maps, one secret-ish",
      body: "kubectl applies both objects in one file. The ConfigMap is plain key-value pairs - a log level and a settings file. The Secret looks the same with one twist: values are base64. That's an encoding requirement from the API (it stores bytes, not strings), not protection - anyone with read access decodes it instantly. Real encryption for secrets is a separate, cluster-level decision.",
      facts: [
        ["CONFIGMAP", "web-config · 2 keys · 1.2 KB"],
        ["SECRET", "stripe-key · base64 values"],
        ["READ ACCESS", "RBAC-gated, same as everything"],
        ["AT REST", "plaintext unless etcd encryption is on"],
      ],
      view: "cluster",
      focus: ["you", "cp", "app-cm", "app-secret"],
      events: [
        ev({
          id: "cf1", at: 0, src: "kubectl", dst: "kube-apiserver", layer: "api", size: "1.6 KB", title: "APPLY BOTH", path: ["you", "cp"],
          says: "kubectl posts the ConfigMap and the Secret in one apply.",
          info: "POST …/configmaps/web-config · POST …/secrets/stripe-key",
          res: {
            "app-cm": { kind: "configmap", name: "ConfigMap web-config", sub: "LOG_LEVEL · settings.toml", state: "creating" },
            "app-secret": { kind: "secret", name: "Secret stripe-key", sub: "api-key · base64", state: "creating" },
          },
          decoded: [
            sec("BODY · CONFIGMAP WEB-CONFIG", [["data.LOG_LEVEL", "debug"], ["data.settings\\.toml", "log_format = \"json\"\n[features]\ncart_ab = true"]]),
            sec("BODY · SECRET STRIPE-KEY", [["type", "Opaque"], ["data.api-key", "c2tfbGl2ZV80MXA… (base64)", true], ["is it encrypted", "no - encoded", true]]),
          ],
          note: "Turning on etcd encryption-at-rest is one API-server flag and a rewrite pass; RBAC is the day-one control that actually gates who reads the Secret.",
        }),
      ],
    },
    {
      title: "AS ENV VARS",
      subtitle: "fixed at start, forever",
      body: `The Pod spec wires LOG_LEVEL through valueFrom, so at container-create time the kubelet expands it into the process environment. runc sets env on the exec - from then on it belongs to the process, a copy. Patch the ConfigMap now and nothing happens to this container: env cannot be edited under a running process. The next container picks up the new value - a restart or a new Pod; this process carries the old one until it exits.`,
      facts: [
        ["SPEC", "env[].valueFrom.configMapKeyRef"],
        ["EXPANDED BY", "kubelet, at CreateContainer"],
        ["SET BY", "runc, on execve"],
        ["UPDATES REACH", "new containers only"],
      ],
      view: "node2",
      focus: ["n2.kubelet", "n2.containerd"],
      events: [
        ev({
          id: "cf2", at: 100, src: KUBELET, dst: KUBELET, layer: "node", size: " - ", title: "EXPAND THE SPEC", path: ["n2.kubelet", "n2.kubelet"],
          says: "The kubelet resolves the key reference into a literal value before creating the container.",
          info: "env[0]: valueFrom → LOG_LEVEL=debug",
          decoded: [sec("FROM SPEC TO FACT", [["spec", "valueFrom.configMapKeyRef web-config/LOG_LEVEL"], ["resolved", "LOG_LEVEL=debug", true], ["stored", "in the container's env, now a copy"]])],
        }),
        ev({
          id: "cf3", at: 150, src: KUBELET, dst: CONTAINERD, layer: "node", size: "1.1 KB", title: "ENV AT EXEC", path: ["n2.kubelet", "n2.containerd"],
          says: "The environment is fixed into the process when it starts - and never changes again.",
          info: "CreateContainer web · env [LOG_LEVEL=debug, …]",
          decoded: [sec("runc → execve", [["env", "part of the process, immutable"], ["the ConfigMap is not watched", "nobody re-reads it for env", true], ["patch later →", "this Pod keeps debug until restart"]])],
        }),
      ],
    },
    {
      title: "AS FILES",
      subtitle: "a volume that happens to hold config",
      body: "The settings file rides a different road: the Pod mounts web-config as a volume, and the kubelet materializes it as real files under the Pod's directory, bind-mounted into the container at /etc/web. To the app it's an ordinary file - but it's a projection. The kubelet owns the directory and can change what's projected into it, which is the hook that makes updates possible.",
      facts: [
        ["MOUNT", "web-config → /etc/web"],
        ["REAL PATH", "/var/lib/kubelet/pods/<uid>/…"],
        ["KIND", "configMap volume · files on the node's disk"],
        ["APP READS", "/etc/web/settings.toml"],
      ],
      view: "node2",
      focus: ["n2.kubelet", "n2.podA"],
      events: [
        ev({
          id: "cf4", at: 200, src: KUBELET, dst: KUBELET, layer: "node", size: "2.1 KB", title: "WRITE THE FILES", path: ["n2.kubelet", "n2.kubelet"],
          says: "The kubelet writes each key of the ConfigMap as a file in the Pod's volume directory.",
          info: "…/pods/5a91f2…/volumes/…/web-config/settings.toml",
          decoded: [sec("MATERIALIZED", [["LOG_LEVEL", "…/web-config/LOG_LEVEL"], ["settings.toml", "…/web-config/settings\\.toml", true], ["mode", "0644"], ["then", "bind-mounted at /etc/web in the container"]])],
        }),
        ev({
          id: "cf5", at: 260, src: APP, dst: APP, layer: "node", size: "0.6 KB", title: "THE APP READS A FILE", path: ["n2.podA", "n2.podA"],
          says: "The app reads its feature flags from what looks like a local file.",
          info: "read /etc/web/settings.toml · cart_ab=true",
          decoded: [sec("APP'S VIEW", [["path", "/etc/web/settings.toml"], ["content", "from the ConfigMap, byte for byte"], ["stat", "regular file - the mount hides the machinery"]])],
        }),
      ],
    },
    {
      title: "THE UPDATE",
      subtitle: "a symlink swap, if you look",
      body: `You flip cart_ab off and patch web-config. The kubelet's configmap watcher notices on its sync - up to a minute by default - and updates the volume atomically: it writes a fresh timestamped directory and re-points a ..data symlink at it. The file's content changes; its path doesn't. Whether the app notices is the app's business - a process that read the file at boot sees nothing until it re-reads.`,
      facts: [
        ["PATCH", "cart_ab true → false"],
        ["NOTICED BY", "kubelet sync · ≤ 60 s"],
        ["MECHANISM", "..2026_… dir + ..data symlink swap"],
        ["APP MUST", "re-read the file"],
      ],
      view: "node2",
      focus: ["n2.kubelet", "n2.podA"],
      events: [
        ev({
          id: "cf6", at: 1000, src: "kubectl", dst: "kube-apiserver", layer: "api", size: "0.3 KB", title: "PATCH THE MAP", path: ["n2.api", "n2.api"],
          says: "You flip one feature flag in the ConfigMap.",
          info: "PATCH …/configmaps/web-config  cart_ab=false",
          decoded: [sec("PATCH", [["data.settings\\.toml", "cart_ab=true → false", true]])],
        }),
        ev({
          id: "cf7", at: 46000, src: KUBELET, dst: KUBELET, layer: "node", size: "2.1 KB", title: "THE SYMLINK SWAP", path: ["n2.kubelet", "n2.kubelet"],
          says: "On its next sync the kubelet writes a fresh directory and re-points ..data at it.",
          info: "..2026_11_22_10_58_04.41739321 → ..data (rename(2))",
          decoded: [sec("ATOMIC REFRESH", [["new dir", "..2026_11_22_10_58_04.41739321", true], ["swap", "rename ..data over - atomic"], ["readers see", "all-old or all-new, never mixed"], ["..data symlink", "that's the volume's whole update story"]])],
          note: "The one trap that beats the mechanism: mount with subPath and the kubelet can't refresh that file at all - subPath mounts are fixed at Pod start, like env.",
        }),
        ev({
          id: "cf8", at: 46100, src: APP, dst: APP, layer: "node", size: " - ", title: "IF THE APP RE-READS", path: ["n2.podA", "n2.podA"],
          says: "A watcher or periodic re-read picks up the new flags with no restart; a boot-time reader never does.",
          info: "inotify/fswatch or re-read → cart_ab=false live",
          decoded: [sec("TWO KINDS OF APP", [["watches the file", "new config in ≤ 60 s, no restart"], ["read once at boot", "still on true - needs a rollout", true]])],
        }),
      ],
    },
    {
      title: "SECRETS",
      subtitle: "same roads, tighter rules",
      body: `The stripe key travels the exact same two roads - env or file - from a Secret instead of a ConfigMap. Differences are policy, not plumbing: mounted secrets never hit the node's disk (they live on tmpfs) and they refresh like ConfigMaps. File permissions are not tighter by default - both default to 0644 - so set defaultMode: 0400 yourself. The real boundary is RBAC: whoever can read the Secret object has the key, base64 or not.`,
      facts: [
        ["SAME ROADS", "env var or mounted file"],
        ["NODE DISK", "none - tmpfs when mounted"],
        ["FILE MODE", "0644 default · set defaultMode 0400"],
        ["UPDATES", "mounted secrets refresh too"],
      ],
      view: "pod",
      focus: ["p.app", "p.eth0"],
      events: [
        ev({
          id: "cf9", at: 47000, src: APP, dst: APP, layer: "node", size: " - ", title: "THE KEY AT WORK", path: ["p.app", "p.app"],
          says: "The app charges a card using the projected key file - reading it the way it read settings.",
          info: "read /etc/stripe/api-key → sk_live_… (decoded)",
          decoded: [sec("PROJECTED SECRET", [["mount", "secret stripe-key → /etc/stripe"], ["mode", "0400 · from defaultMode (the default is 0644)", true], ["in memory", "tmpfs - nothing written to disk"], ["rotated", "swap the Secret → file refreshes ≤ 60 s"]])],
          note: "Env-var secrets are the leakier road: they sit in /proc/<pid>/environ for the life of the process and can't rotate. When in doubt, mount.",
        }),
        ev({
          id: "cf10", at: 47200, src: APP, dst: "Stripe", layer: "net", size: "0.5 KB", title: "KEY USED", path: ["p.app", "p.eth0"],
          says: "The key's first and only legitimate trip out of the Pod: the API call it authenticates.",
          info: "POST https://api.stripe.example.com/v1/charges",
          decoded: [sec("OUTBOUND", [["authorization", "Bearer sk_live_…"], ["not in", "logs, env dumps of other Pods, git"]])],
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "objects applied", layer: "api", start: 0, duration: 100 },
    { value: "t2", label: "env path: fixed at create", layer: "node", start: 100, duration: 100 },
    { value: "t3", label: "file path: projected at mount", layer: "node", start: 200, duration: 100 },
    { value: "t4", label: "patch → symlink swap (≤ 60 s sync)", layer: "control", start: 1000, duration: 45000 },
    { value: "t5", label: "secret in use, from tmpfs", layer: "node", start: 47000, duration: 300 },
  ],
  summary: {
    title: "TWO ROADS",
    body: "One ConfigMap, two delivery paths, opposite contracts: environment is a snapshot taken at container start, a mounted file is a live projection refreshed by the kubelet. Secrets use both roads unchanged - the differences are RBAC, file modes, and staying off node disk. Choose per config: safe-to-snapshot values as env, anything that changes as files.",
    facts: [
      ["ENV", "fixed per container · new containers only"],
      ["FILES", "refreshed ≤ 60 s · subPath exempt"],
      ["NEXT", "StatefulSet with storage"],
    ],
  },
}
