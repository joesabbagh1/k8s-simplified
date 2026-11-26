import type { Lesson } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const KCM = "kube-controller-manager"
const SCHED = "kube-scheduler"
const KUBEADM = "kubeadm · cp-1"
const KCP = "kubelet · cp-1"
const K1 = "kubelet · node-1"
const K2 = "kubelet · node-2"
const FROM = "v1.36.6"
const TO = "v1.37.2"
const APT = "apt-get install -y kubeadm='1.37.2-*'"

export const upgradingTheCluster: Lesson = {
  id: "upgrading-the-cluster",
  title: "Upgrading the cluster",
  subtitle: "Control plane first, then each node",
  category: "control",
  seo: {
    title: "How to upgrade a Kubernetes cluster with kubeadm",
    description: "Upgrade a kubeadm cluster one minor version: the version skew rules, kubeadm upgrade plan and apply, the API server restart, then each node drained in turn.",
  },
  actors: ["you", "cp", "node1", "node2"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    kubectl: "you",
    [KUBEADM]: "cp-1", [KCP]: "cp-1",
    [API]: "control plane", [KCM]: "control plane", [SCHED]: "control plane", etcd: "control plane",
    [K1]: "node-1", "kubeadm · node-1": "node-1",
    [K2]: "node-2",
  },
  overview: {
    body: `The cluster runs Kubernetes ${FROM} and you move it to ${TO}. An upgrade isn't one switch: every component is upgraded on its own, in an order the version skew policy allows. The control plane goes first, starting with the API server, and the kubelets follow, one node at a time, each one drained before its kubelet changes. The control plane runs as static Pods on one machine, cp-1, so for a short while there is no API at all, and the Pods keep serving anyway.`,
    facts: [
      ["FROM → TO", `${FROM} → ${TO} · one minor version`],
      ["TOOL", "kubeadm · static Pods on cp-1 (10.0.0.10)"],
      ["ORDER", "API server → controllers → kubelets"],
      ["APPS DURING IT", "keep serving · moved off each node first"],
    ],
  },
  steps: [
    {
      title: "THE SKEW RULES",
      subtitle: "which versions may run together",
      body: "Components of different versions run side by side during an upgrade, and the version skew policy says which mixes are supported. The API server is the newest component and goes first, one minor version at a time: 1.36 to 1.38 directly isn't supported. The controller manager and scheduler may be one minor older than the API server, never newer. Kubelets may be up to three minors older, never newer. kubectl may be one minor either side. So the control plane can reach 1.37 while every kubelet is still on 1.36.",
      facts: [
        ["API SERVER", "upgraded first · one minor at a time"],
        ["CONTROLLERS, SCHEDULER", "not newer than the API server · 1 older at most"],
        ["KUBELET", "not newer · up to 3 minors older"],
        ["KUBECTL", "within 1 minor of the API server"],
      ],
      view: "cluster",
      focus: ["you", "api", "node1", "node2"],
      events: [
        ev({
          id: "up1", at: 0, src: "kubectl", dst: API, layer: "api", size: "0.3 KB", title: "WHAT'S RUNNING", path: ["you", "api"],
          says: `You check the versions: everything is on ${FROM}.`,
          info: "kubectl version · kubectl get nodes",
          decoded: [
            sec("GET /VERSION", [["gitVersion", FROM, true]]),
            sec("NODES", [["cp-1", `control-plane · ${FROM}`], ["node-1", FROM], ["node-2", FROM]]),
          ],
        }),
        ev({
          id: "up2", at: 400, src: "kubectl", dst: "kubectl", layer: "control", size: " - ", title: "WHAT MAY MIX", path: ["you", "you"],
          says: "The skew policy allows the control plane to be one minor ahead of every kubelet, so the upgrade can go in stages.",
          info: `target ${TO} · kubelets may stay on 1.36 until their turn`,
          decoded: [sec("ALLOWED DURING THE UPGRADE", [["API server 1.37 · kubelets 1.36", "✓ kubelets may be older", true], ["API server 1.36 · controller manager 1.37", "✗ never newer than the API server"], ["kubectl 1.37 with API server 1.36", "✓ one minor either side"], ["1.36 → 1.38 in one go", "✗ no skipping minors"]])],
        }),
      ],
    },
    {
      title: "PLAN",
      subtitle: "new kubeadm, then a dry look",
      body: `On cp-1, upgrade kubeadm itself first. Kubernetes packages come from pkgs.k8s.io, which has one repository per minor version, so you point apt at v1.37 before installing kubeadm 1.37.2. kubeadm upgrade plan then checks that the cluster is healthy, reads its configuration from the kubeadm-config ConfigMap and prints what it would change. It doesn't look for manifests that use APIs the new version has removed. That check is yours, and the API server keeps a metric for it.`,
      facts: [
        ["REPOSITORY", "pkgs.k8s.io/core:/stable:/v1.37/deb/"],
        ["KUBEADM", "1.37.2 · installed first"],
        ["PLAN", "health, current and target versions, config"],
        ["NOT CHECKED", "your manifests' API versions"],
      ],
      view: "cluster",
      focus: ["you", "api", "etcd"],
      events: [
        ev({
          id: "up3", at: 60000, src: KUBEADM, dst: KUBEADM, layer: "node", size: " - ", title: "INSTALL KUBEADM 1.37.2", path: ["api", "api"],
          says: "On cp-1, you switch the package repository to v1.37 and install the new kubeadm.",
          info: `apt-mark unhold kubeadm && apt-get update && ${APT} && apt-mark hold kubeadm`,
          decoded: [
            sec("/ETC/APT/SOURCES.LIST.D/KUBERNETES.LIST", [["before", "https://pkgs.k8s.io/core:/stable:/v1.36/deb/ /"], ["after", "https://pkgs.k8s.io/core:/stable:/v1.37/deb/ /", true]]),
            sec("WHY HOLD", [["apt-mark hold", "keeps a routine apt upgrade from moving Kubernetes packages on its own"]]),
          ],
        }),
        ev({
          id: "up4", at: 75000, src: KUBEADM, dst: API, layer: "api", size: "8 KB", title: "KUBEADM UPGRADE PLAN", path: ["api", "api"],
          says: "kubeadm checks the cluster and prints what an upgrade to 1.37.2 would change.",
          info: "kubeadm upgrade plan",
          decoded: [
            sec("CHECKS", [["API server", "reachable"], ["nodes", "all Ready"], ["control plane", "healthy"], ["config", "kube-system/kubeadm-config"]]),
            sec("COMPONENTS", [["kube-apiserver", `${FROM} → ${TO}`, true], ["kube-controller-manager", `${FROM} → ${TO}`], ["kube-scheduler", `${FROM} → ${TO}`], ["kube-proxy", `${FROM} → ${TO}`], ["CoreDNS · etcd", "the versions that release ships"], ["kubelet", "upgraded by hand, node by node"]]),
            sec("TO RUN", [["next", `kubeadm upgrade apply ${TO}`]]),
          ],
        }),
        ev({
          id: "up5", at: 90000, src: "kubectl", dst: API, layer: "api", size: "1.1 KB", title: "WHO STILL USES OLD APIS", path: ["you", "api"],
          says: "You ask the API server which deprecated APIs clients have been calling.",
          info: "kubectl get --raw /metrics | grep apiserver_requested_deprecated_apis",
          decoded: [
            sec("METRIC", [["apiserver_requested_deprecated_apis", "one series per deprecated group, version and resource that was called"], ["label removed_release", "the version that removes it", true]]),
            sec("ALSO", [["clients", "get a Warning header on each deprecated call"], ["the deprecation guide", "lists what each release removes"]]),
          ],
          note: "A manifest that uses a removed API version fails to apply after the upgrade, and a controller that still calls it gets 404. Objects already in etcd are fine: the API server stores them once and serves them in every version it still knows.",
        }),
      ],
    },
    {
      title: "APPLY",
      subtitle: "backups, certificates, new manifests",
      body: "kubeadm upgrade apply v1.37.2 checks again, makes sure the new images can be pulled, and backs up the current static Pod manifests and etcd's data under /etc/kubernetes/tmp. It renews the control plane certificates by default. Then it rewrites the static Pod manifests in /etc/kubernetes/manifests, one component at a time. kubeadm never starts a container itself: the kubelet on cp-1 watches that directory and replaces each Pod when its file changes, and kubeadm waits for each one to come back healthy.",
      facts: [
        ["COMMAND", `kubeadm upgrade apply ${TO}`],
        ["BACKUPS", "/etc/kubernetes/tmp/kubeadm-backup-*"],
        ["CERTIFICATES", "renewed · --certificate-renewal=false to skip"],
        ["MANIFESTS", "/etc/kubernetes/manifests · read by cp-1's kubelet"],
      ],
      view: "cluster",
      focus: ["api", "etcd", "kcm", "sched"],
      events: [
        ev({
          id: "up6", at: 120000, src: KUBEADM, dst: API, layer: "api", size: "2 KB", title: "PREFLIGHT AND IMAGES", path: ["api", "api"],
          says: "kubeadm checks the cluster again and pulls the 1.37.2 images onto cp-1.",
          info: `kubeadm upgrade apply ${TO}`,
          decoded: [
            sec("PREFLIGHT", [["API server", "reachable"], ["nodes", "all Ready"], ["skew", `${FROM} → ${TO} · one minor ✓`, true]]),
            sec("IMAGES", [["registry.k8s.io/kube-apiserver", TO], ["registry.k8s.io/kube-controller-manager", TO], ["registry.k8s.io/kube-scheduler", TO], ["registry.k8s.io/kube-proxy", TO]]),
          ],
        }),
        ev({
          id: "up7", at: 150000, src: KUBEADM, dst: "etcd", layer: "state", size: " - ", title: "BACK UP", path: ["etcd", "etcd"],
          says: "kubeadm copies the current manifests and etcd's data directory aside, so a failed step can be rolled back.",
          info: "/etc/kubernetes/tmp/kubeadm-backup-manifests-… · kubeadm-backup-etcd-…",
          decoded: [
            sec("BACKUPS", [["kubeadm-backup-manifests-<date>-<time>", "the four static Pod manifests", true], ["kubeadm-backup-etcd-<date>-<time>", "a copy of /var/lib/etcd"], ["cleanup", "by hand · kubeadm leaves them"]]),
            sec("ETCD", [["upgraded", "only if the new release uses a newer etcd · --etcd-upgrade"], ["while it restarts", "requests to the API server stall"]]),
          ],
          note: "These backups help kubeadm roll back its own step. They are no substitute for an etcd snapshot of your own, taken before you start and copied off the machine.",
        }),
        ev({
          id: "up8", at: 152000, src: KUBEADM, dst: KUBEADM, layer: "control", size: " - ", title: "RENEW CERTIFICATES", path: ["api", "api"],
          says: "kubeadm renews the control plane certificates, which restarts their one-year clock.",
          info: "/etc/kubernetes/pki · renewed for 1 year",
          decoded: [sec("RENEWED", [["apiserver.crt · apiserver-kubelet-client.crt", "1 year from now", true], ["front-proxy-client.crt · etcd certificates", "1 year from now"], ["admin.conf · controller-manager.conf · scheduler.conf", "new client certificates inside"], ["CAs", "unchanged · 10 years"]])],
        }),
        ev({
          id: "up9", at: 155000, src: KUBEADM, dst: KCP, layer: "node", size: "4 KB", title: "A NEW API SERVER MANIFEST", path: ["api", "api"],
          says: "kubeadm writes the new kube-apiserver manifest. cp-1's kubelet sees the file change.",
          info: "/etc/kubernetes/manifests/kube-apiserver.yaml  image → kube-apiserver:v1.37.2",
          decoded: [
            sec("KUBE-APISERVER.YAML", [["image", `registry.k8s.io/kube-apiserver:${FROM} → ${TO}`, true], ["flags", "regenerated from kubeadm-config"]]),
            sec("CP-1'S KUBELET", [["watches", "/etc/kubernetes/manifests"], ["a file changed", "stop the old static Pod, start the new one"]]),
          ],
        }),
      ],
    },
    {
      title: "THE API BLINKS",
      subtitle: "no API, and nothing stops",
      body: "With a single control plane node, the cluster has no API while the new API server starts: kubectl, the controllers and every kubelet get connection refused. Nothing that's already running depends on the API, though. Pods keep serving, kube-proxy's iptables rules stay in the kernels, and a request to web is answered as usual. When the new API server is up, the kubelets reconnect their watches. kubeadm then replaces the controller manager and the scheduler, and each wins its leader Lease again before it does any work.",
      facts: [
        ["API DOWN", "≈ 30 s in this run · one control plane node"],
        ["PODS, SERVICES", "keep working · the data plane needs no API"],
        ["WATCHES", "reconnect · resume or relist"],
        ["LEADER LEASES", "kube-system/kube-controller-manager · kube-scheduler"],
      ],
      view: "cluster",
      focus: ["api", "kcm", "sched", "node1", "node2"],
      events: [
        ev({
          id: "up10", at: 156000, src: KCP, dst: API, layer: "drop", size: " - ", title: "THE API SERVER RESTARTS", path: ["api", "api"],
          says: "cp-1's kubelet stops the old API server. Until the new one answers, every API call fails.",
          info: "dial tcp 10.0.0.10:6443: connect: connection refused",
          decoded: [sec("WHILE IT'S DOWN", [["kubectl", "connection refused", true], ["kubelets", "can't report status · keep their Pods running"], ["controllers, scheduler", "can't read or write"], ["etcd", "unaffected"]])],
        }),
        ev({
          id: "up11", at: 170000, src: K2, dst: K2, layer: "net", size: " - ", title: "WEB STILL ANSWERS", path: ["node2", "node2"],
          says: "In the middle of it, a request to web reaches a Pod on node-2 through the Service, and gets its answer.",
          info: "GET / → 10.96.120.15:80 → 10.244.2.17:8080 · 200 OK",
          decoded: [sec("NEEDS THE API?", [["the Pod", "no · it's a process on node-2"], ["kube-proxy's rules", "no · already in the kernel"], ["DNS", "no · CoreDNS answers from its cache"], ["anything new", "yes · no new Pods, no Endpoint updates until the API is back"]])],
          note: "If a node failed during the gap, nobody would notice until the API came back. That's why HA clusters run three control plane nodes and upgrade them one at a time.",
        }),
        ev({
          id: "up12", at: 186000, src: K1, dst: API, layer: "control", size: "0.6 KB", title: "WATCHES RECONNECT", path: ["node1", "api"],
          says: "The new API server is Ready. The kubelets reconnect their watches.",
          info: "WATCH /api/v1/pods?fieldSelector=spec.nodeName=node-1&resourceVersion=…",
          decoded: [sec("RECONNECT", [["/readyz", "ok · kube-apiserver v1.37.2", true], ["watch", "resumed from the last resourceVersion it saw"], ["if that's too old", "410 Gone → list again, then watch"]])],
        }),
        ev({
          id: "up13", at: 200000, src: KCM, dst: API, layer: "control", size: "0.4 KB", title: "CONTROLLER MANAGER: LEADER AGAIN", path: ["kcm", "api"],
          says: "kubeadm swaps in the new controller manager. It takes its leader Lease before it starts any controller.",
          info: "PUT kube-system/leases/kube-controller-manager  holder cp-1_…",
          decoded: [sec("LEADER ELECTION", [["Lease", "kube-system/kube-controller-manager", true], ["holderIdentity", "cp-1_<new process id>"], ["why", "with several copies, only the holder runs controllers"]])],
        }),
        ev({
          id: "up14", at: 215000, src: SCHED, dst: API, layer: "control", size: "0.4 KB", title: "SCHEDULER: LEADER AGAIN", path: ["sched", "api"],
          says: "Then the new scheduler, which also takes its Lease first.",
          info: "PUT kube-system/leases/kube-scheduler",
          decoded: [sec("LEADER ELECTION", [["Lease", "kube-system/kube-scheduler", true], ["version", TO]])],
        }),
        ev({
          id: "up15", at: 230000, src: KUBEADM, dst: API, layer: "api", size: "12 KB", title: "ADD-ONS, THEN SUCCESS", path: ["api", "api"],
          says: "kubeadm uploads its new config, then upgrades CoreDNS and kube-proxy, and reports success.",
          info: `[upgrade/successful] SUCCESS! Your cluster was upgraded to "${TO}". Enjoy!`,
          decoded: [
            sec("UPLOADED", [["kube-system/kubeadm-config", TO], ["kube-system/kubelet-config", "the kubelets' configuration for 1.37"]]),
            sec("ADD-ONS", [["DaemonSet kube-proxy", `image → ${TO} · a rolling update on every node`, true], ["Deployment coredns", "the CoreDNS version 1.37 ships"], ["when", "after the last control plane node · here the only one"]]),
          ],
        }),
      ],
    },
    {
      title: "THE CONTROL PLANE NODE'S KUBELET",
      subtitle: "the control plane is on 1.37, its kubelet isn't",
      body: "The control plane is on 1.37, but cp-1's kubelet, the program that runs those static Pods, is still 1.36. Upgrading a kubelet's minor version in place isn't supported, so you drain cp-1 first, which moves off the few ordinary Pods that run there, such as CoreDNS. Then install the new kubelet and kubectl packages, restart the kubelet, and uncordon. The static Pods don't go anywhere: they belong to this node's kubelet and start again with it.",
      facts: [
        ["DRAIN", "kubectl drain cp-1 --ignore-daemonsets"],
        ["PACKAGES", "kubelet 1.37.2 · kubectl 1.37.2"],
        ["RESTART", "systemctl daemon-reload · restart kubelet"],
        ["NODE CP-1", `kubeletVersion ${TO}`],
      ],
      view: "cluster",
      focus: ["you", "api"],
      events: [
        ev({
          id: "up16", at: 300000, src: "kubectl", dst: API, layer: "api", size: "0.3 KB", title: "DRAIN CP-1", path: ["you", "api"],
          says: "You drain cp-1: a cordon, then evictions, as in Draining a node.",
          info: "kubectl drain cp-1 --ignore-daemonsets",
          decoded: [sec("ON CP-1", [["static Pods", "skipped · the API can't delete them"], ["kube-proxy, kube-flannel", "skipped · DaemonSets"], ["coredns-…", "evicted · rescheduled on node-1", true]])],
        }),
        ev({
          id: "up17", at: 330000, src: KCP, dst: API, layer: "api", size: "1.4 KB", title: "A NEW KUBELET ON CP-1", path: ["api", "api"],
          says: "With the new packages installed, the kubelet restarts and reports its new version.",
          info: `PATCH /api/v1/nodes/cp-1/status  kubeletVersion ${TO}`,
          decoded: [
            sec("ON CP-1", [["apt", "kubelet='1.37.2-*' kubectl='1.37.2-*'"], ["then", "systemctl daemon-reload && systemctl restart kubelet"]]),
            sec("NODE CP-1", [["status.nodeInfo.kubeletVersion", `${FROM} → ${TO}`, true], ["static Pods", "started again by the new kubelet"]]),
          ],
          note: "The upgrade guide warns that containers can restart after a kubelet upgrade, because the kubelet computes their spec hash differently. Draining first means nothing you care about is there when they do.",
        }),
        ev({
          id: "up18", at: 335000, src: "kubectl", dst: API, layer: "api", size: "0.2 KB", title: "UNCORDON CP-1", path: ["you", "api"],
          says: "You uncordon cp-1.",
          info: "kubectl uncordon cp-1",
          decoded: [sec("NODE CP-1", [["spec.unschedulable", "true → false", true], ["Pods allowed", "only those that tolerate the control-plane taint, as before"]])],
        }),
      ],
    },
    {
      title: "EACH WORKER",
      subtitle: "drain, upgrade, uncordon, next",
      body: "Now the workers, one at a time so the others carry the load. On node-1: drain it, as in Draining a node, so its web Pod moves to node-2. Upgrade kubeadm and run kubeadm upgrade node, which on a worker fetches the 1.37 kubelet configuration from the cluster and writes it to disk. Upgrade the kubelet package, restart it, and the Node reports its new version. Uncordon. Then the same for node-2, whose Pods move to node-1.",
      facts: [
        ["ONE AT A TIME", "node-1, then node-2"],
        ["KUBEADM UPGRADE NODE", "writes /var/lib/kubelet/config.yaml"],
        ["DRAINED FIRST", "a minor kubelet upgrade in place isn't supported"],
        ["AT THE END", `every node on ${TO}`],
      ],
      view: "cluster",
      focus: ["you", "api", "node1", "node2"],
      events: [
        ev({
          id: "up19", at: 400000, src: "kubectl", dst: API, layer: "api", size: "0.3 KB", title: "DRAIN NODE-1", path: ["you", "api"],
          says: "You drain node-1. Its web Pod is evicted and a replacement starts on node-2.",
          info: "kubectl drain node-1 --ignore-daemonsets",
          pods: { node1: ["other"], node2: ["other", "v1", "v1", "v1"] },
          decoded: [sec("DRAIN", [["web-…-kq9tw", "evicted · replaced on node-2", true], ["DaemonSet Pods", "stay"], ["PodDisruptionBudgets", "respected, if web has one"]])],
        }),
        ev({
          id: "up20", at: 420000, src: "kubeadm · node-1", dst: API, layer: "api", size: "2.6 KB", title: "KUBEADM UPGRADE NODE", path: ["node1", "api"],
          says: "On node-1, the new kubeadm fetches the 1.37 kubelet configuration and writes it to disk.",
          info: "kubeadm upgrade node",
          decoded: [sec("ON A WORKER", [["reads", "kube-system/kubelet-config"], ["writes", "/var/lib/kubelet/config.yaml", true], ["control plane", "nothing to do here"]])],
        }),
        ev({
          id: "up21", at: 450000, src: K1, dst: API, layer: "api", size: "1.4 KB", title: "NODE-1 ON 1.37", path: ["node1", "api"],
          says: "With the kubelet package upgraded and restarted, node-1 reports v1.37.2.",
          info: `PATCH /api/v1/nodes/node-1/status  kubeletVersion ${TO}`,
          decoded: [sec("NODE-1", [["apt", "kubelet='1.37.2-*' · then restart"], ["kubeletVersion", `${FROM} → ${TO}`, true], ["kube-proxy", `already ${TO} · from the add-on step`]])],
        }),
        ev({
          id: "up22", at: 455000, src: "kubectl", dst: API, layer: "api", size: "0.2 KB", title: "UNCORDON NODE-1", path: ["you", "api"],
          says: "You uncordon node-1. Nothing moves back to it on its own.",
          info: "kubectl uncordon node-1",
          decoded: [sec("NODE-1", [["spec.unschedulable", "true → false", true], ["Pods", "only DaemonSet Pods, until something new is scheduled"]])],
        }),
        ev({
          id: "up23", at: 500000, src: "kubectl", dst: API, layer: "api", size: "0.3 KB", title: "DRAIN NODE-2", path: ["you", "api"],
          says: "Now node-2. Its three web Pods are evicted, and the replacements land on node-1.",
          info: "kubectl drain node-2 --ignore-daemonsets",
          pods: { node1: ["other", "v1", "v1", "v1"], node2: ["other"] },
          decoded: [sec("DRAIN", [["web Pods on node-2", "3 · evicted, replaced on node-1", true], ["node-1", `already ${TO}`]])],
        }),
        ev({
          id: "up24", at: 560000, src: K2, dst: API, layer: "api", size: "1.4 KB", title: "NODE-2 ON 1.37", path: ["node2", "api"],
          says: "kubeadm upgrade node, a new kubelet and a restart later, node-2 reports v1.37.2, and you uncordon it.",
          info: `PATCH /api/v1/nodes/node-2/status  kubeletVersion ${TO}`,
          decoded: [sec("NODES", [["cp-1", TO], ["node-1", TO], ["node-2", `${FROM} → ${TO}`, true]])],
        }),
      ],
    },
    {
      title: "AFTER",
      subtitle: "add-ons, managed clusters, many clusters",
      body: "kubeadm only upgrades what it installed. Everything else in the cluster has its own version and its own support matrix: the CNI plugin, the ingress controller, the CSI drivers, operators. Check each against 1.37, ideally before you start. Managed services do the node part differently: they usually add new nodes with the new version and drain and delete the old ones, instead of upgrading kubelets in place. And with many clusters, upgrade a few first, watch them, then the rest.",
      facts: [
        ["CHECK", "CNI, ingress, CSI, operators · their 1.37 support"],
        ["MANAGED NODES", "replaced by new ones, not upgraded in place"],
        ["MANY CLUSTERS", "in waves, with checks between"],
        ["NEXT MINOR", "1.38 · the same steps again"],
      ],
      view: "cluster",
      focus: ["you", "api", "node1", "node2"],
      events: [
        ev({
          id: "up25", at: 600000, src: "kubectl", dst: API, layer: "api", size: "1.2 KB", title: "ALL ON 1.37", path: ["you", "api"],
          says: "Every component reports 1.37.2. What kubeadm didn't install is still on whatever version it was.",
          info: "kubectl get nodes · kubectl version",
          decoded: [
            sec("NODES", [["cp-1 · node-1 · node-2", `Ready · ${TO}`, true], ["server", TO]]),
            sec("NOT KUBEADM'S", [["kube-flannel", "check its release notes for 1.37"], ["ingress controller, CSI drivers", "the same"], ["your own operators", "their client libraries and the APIs they call"]]),
            sec("MANAGED CLUSTERS", [["control plane", "upgraded by the provider"], ["nodes", "surge: new nodes on 1.37 join, old ones are drained and removed"]]),
          ],
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "install kubeadm + plan", layer: "node", start: 60000, duration: 60000 },
    { value: "t2", label: "apply: checks, backups, certificates", layer: "control", start: 120000, duration: 35000 },
    { value: "t3", label: "API server down", layer: "drop", start: 156000, duration: 30000 },
    { value: "t4", label: "controllers, add-ons", layer: "control", start: 186000, duration: 44000 },
    { value: "t5", label: "cp-1's kubelet", layer: "node", start: 300000, duration: 35000 },
    { value: "t6", label: "node-1, then node-2", layer: "node", start: 400000, duration: 165000 },
  ],
  timingNote: "Times from one illustrative run on a small cluster. Draining dominates on real clusters, and how long the API server is down depends on how fast it starts and on etcd.",
  summary: {
    title: "ONE COMPONENT AT A TIME",
    body: "An upgrade is many small replacements in an order the skew policy allows: kubeadm first, then the API server, the controllers and the add-ons, then each kubelet behind a drain. kubeadm does the control plane by rewriting static Pod manifests and letting cp-1's kubelet restart them. While the only API server restarts, the cluster can't change, but it keeps running. The things kubeadm didn't install are still yours to check.",
    facts: [
      ["ORDER", "kubeadm → API server → controllers → add-ons → kubelets"],
      ["CONTROL PLANE", "static Pod manifests, rewritten one by one"],
      ["NODES", "drain → upgrade → uncordon, one at a time"],
      ["NEXT", "Graceful shutdown"],
    ],
  },
}
