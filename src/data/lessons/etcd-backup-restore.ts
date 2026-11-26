import type { Lesson } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const KCM = "kube-controller-manager"
const ETCD = "etcd"
const CP = "cp-1"
const K1 = "kubelet · node-1"
const K2 = "kubelet · node-2"
const TLS = "--endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key"
const SNAP = "/backup/etcd-2026-11-26-0200.db"
const SNAP_REV = "2,814,307"
const LAST_REV = "2,951,822"

export const etcdBackupRestore: Lesson = {
  id: "etcd-backup-restore",
  title: "Backing up and restoring etcd",
  subtitle: "Snapshot, restore, reconcile",
  category: "control",
  seo: {
    title: "Back up and restore etcd in Kubernetes",
    description: "Take an etcd snapshot of a kubeadm cluster, lose the shop namespace, restore it with etcdutl, and see what the controllers and kubelets do with the old state.",
  },
  actors: ["you", "cp", "node1", "node2"],
  pods: { node1: ["other", "v1", "v2", "other"], node2: ["other", "v1", "v1", "v2"] },
  lanes: {
    kubectl: "you",
    [API]: "control plane", [KCM]: "control plane", [ETCD]: "control plane",
    "etcdctl · cp-1": "cp-1", "etcdutl · cp-1": "cp-1", [`kubelet · ${CP}`]: "cp-1", [`kubeadm · ${CP}`]: "cp-1",
    [K1]: "node-1", [K2]: "node-2",
    "s3://kubelearn-backups": "S3",
  },
  overview: {
    body: "Every object in the cluster lives in etcd, and nowhere else. At 02:00 a snapshot of it is taken. At 10:41 someone deletes the shop namespace, and with it the Deployments, Services, Secrets and Pods of the shop app. You restore the 02:00 snapshot. Follow what a snapshot holds, how a restore replaces etcd's data under a stopped API server, why the cluster then sees time go backwards, and what happens to everything that changed in between.",
    facts: [
      ["SNAPSHOT", `02:00 · revision ${SNAP_REV}`],
      ["ACCIDENT", "10:41 · kubectl delete namespace shop"],
      ["RESTORE", "etcdutl snapshot restore · a new data directory"],
      ["LOST", "every change after 02:00"],
    ],
  },
  steps: [
    {
      title: "WHAT ETCD HOLDS",
      subtitle: "every API object, and only those",
      body: "etcd stores each object as one key under /registry: /registry/pods/shop/cart-…, /registry/secrets/shop/db-password, and so on. Every write gets a number, the revision, which is also the resourceVersion clients see. That is all a snapshot captures: the objects. Container images live in registries, volume data on disks, logs on the nodes. And Secrets encrypted at rest are only readable with the API server's encryption configuration and keys, which aren't in etcd and need a backup of their own.",
      facts: [
        ["KEYS", "/registry/<resource>/<namespace>/<name>"],
        ["REVISION", "one counter for the whole cluster"],
        ["NOT IN ETCD", "images · volume data · logs"],
        ["BACK UP SEPARATELY", "the encryption config and keys, /etc/kubernetes/pki"],
      ],
      view: "cluster",
      focus: ["api", "etcd"],
      events: [
        ev({
          id: "eb1", at: 0, src: API, dst: ETCD, layer: "state", size: "1.8 KB", title: "ONE OBJECT, ONE KEY", path: ["api", "etcd"],
          says: "Every API object is one key in etcd. Writing a Pod writes its key and bumps the revision.",
          info: "PUT /registry/pods/shop/cart-…-9fh2k",
          decoded: [
            sec("KEYS IN THIS CLUSTER", [["/registry/pods/…", "Pods"], ["/registry/deployments/…", "Deployments"], ["/registry/secrets/…", "Secrets, encrypted if configured"], ["/registry/namespaces/shop", "the namespace itself"]]),
            sec("NOT IN ETCD", [["container images", "in registries · cached on nodes"], ["PersistentVolume data", "on the disks · only the PV object is in etcd", true], ["logs, metrics", "on the nodes or in your monitoring"]]),
          ],
          note: "A snapshot of an encrypted cluster is useless without the keys in the API server's EncryptionConfiguration. Keep them somewhere other than the snapshot.",
        }),
      ],
    },
    {
      title: "SNAPSHOT",
      subtitle: "one consistent revision, copied away",
      body: "At 02:00 a CronJob on cp-1 runs etcdctl snapshot save, with etcd's own CA and a client certificate. etcd streams a copy of its whole database as it stood at one revision, so the snapshot is consistent even while writes continue. etcdutl snapshot status shows its hash, revision, key count and size. A snapshot that stays on cp-1 dies with cp-1, so it's copied off the machine.",
      facts: [
        ["COMMAND", "etcdctl snapshot save"],
        ["CONSISTENT AT", `revision ${SNAP_REV}`],
        ["SIZE", "48 MB · 3,912 keys"],
        ["STORED", "off the node · object storage"],
      ],
      view: "cluster",
      focus: ["etcd"],
      events: [
        ev({
          id: "eb2", at: 1000, src: "etcdctl · cp-1", dst: ETCD, layer: "state", size: "48 MB", title: "SNAPSHOT SAVE", path: ["etcd", "etcd"],
          says: "etcdctl asks etcd for a snapshot and writes it to a file.",
          info: `etcdctl ${TLS} snapshot save ${SNAP}`,
          decoded: [
            sec("GRPC", [["service", "Maintenance/Snapshot · a stream"], ["contents", "the whole database at one revision", true], ["while it runs", "etcd keeps serving reads and writes"]]),
            sec("TLS", [["--cacert", "/etc/kubernetes/pki/etcd/ca.crt · etcd's own CA"], ["--cert · --key", "a client certificate that CA signed"]]),
          ],
        }),
        ev({
          id: "eb3", at: 4000, src: "etcdutl · cp-1", dst: "etcdutl · cp-1", layer: "state", size: " - ", title: "CHECK IT", path: ["etcd", "etcd"],
          says: "etcdutl reads the file and prints what's in it.",
          info: `etcdutl --write-out=table snapshot status ${SNAP}`,
          decoded: [sec("SNAPSHOT STATUS", [["HASH", "7ef3a1c9"], ["REVISION", SNAP_REV, true], ["TOTAL KEYS", "3,912"], ["TOTAL SIZE", "48 MB"]])],
          note: "etcdctl snapshot status is deprecated; etcdutl, which reads files directly and needs no running etcd, replaces it.",
        }),
        ev({
          id: "eb4", at: 9000, src: "etcdctl · cp-1", dst: "s3://kubelearn-backups", layer: "net", size: "48 MB", title: "COPY IT AWAY", path: ["etcd", "etcd"],
          says: "The snapshot is uploaded somewhere that doesn't share cp-1's fate.",
          info: `aws s3 cp ${SNAP} s3://kubelearn-backups/etcd/`,
          decoded: [sec("KEEP WITH IT", [["the snapshot", "off the node, versioned", true], ["/etc/kubernetes/pki", "the cluster's CAs and keys"], ["EncryptionConfiguration", "and its keys, separately"]])],
        }),
      ],
    },
    {
      title: "THE ACCIDENT",
      subtitle: "kubectl delete namespace shop",
      body: "At 10:41 someone runs kubectl delete namespace shop on the wrong cluster. The namespace turns Terminating, and the namespace controller in the controller manager deletes everything inside it: Deployments, ReplicaSets, Services, ConfigMaps, Secrets, Pods. The kubelets stop the shop Pods. When nothing is left, the controller removes the namespace's kubernetes finalizer and the namespace itself is gone. Nothing in Kubernetes can undo it.",
      facts: [
        ["10:41", "kubectl delete namespace shop"],
        ["PHASE", "Terminating, then gone"],
        ["DELETED BY", "the namespace controller · everything inside"],
        ["ETCD REVISION NOW", LAST_REV],
      ],
      view: "cluster",
      focus: ["you", "api", "kcm", "node1", "node2"],
      events: [
        ev({
          id: "eb5", at: 31000000, src: "kubectl", dst: API, layer: "api", size: "0.2 KB", title: "DELETE NAMESPACE SHOP", path: ["you", "api"],
          says: "The namespace is marked for deletion and turns Terminating.",
          info: "DELETE /api/v1/namespaces/shop",
          decoded: [sec("NAMESPACE SHOP", [["metadata.deletionTimestamp", "10:41:07", true], ["status.phase", "Active → Terminating"], ["spec.finalizers", "[kubernetes] · holds it until it's empty"]])],
        }),
        ev({
          id: "eb6", at: 31000400, src: KCM, dst: API, layer: "control", size: "6 KB", title: "EMPTY THE NAMESPACE", path: ["kcm", "api"],
          says: "The namespace controller deletes every object in shop, kind by kind.",
          info: "DELETE /apis/apps/v1/namespaces/shop/deployments · …/services · …/secrets · …/pods",
          decoded: [sec("DELETED IN SHOP", [["Deployments", "cart · checkout", true], ["Services", "cart · checkout"], ["Secrets · ConfigMaps", "db-password · cart-config"], ["Pods", "cart-…-9fh2k · checkout-…-r2x7m"]])],
        }),
        ev({
          id: "eb7", at: 31000600, src: API, dst: K1, layer: "control", size: "2.4 KB", title: "THE SHOP PODS STOP", path: ["api", "node1"],
          says: "The kubelets see their shop Pods deleted and stop them.",
          info: "WATCH MODIFIED Pod cart-…-9fh2k (deletionTimestamp)",
          pods: { node1: ["other", "v1", "terminating", "other"], node2: ["other", "v1", "v1", "terminating"] },
          decoded: [sec("NODES", [["node-1", "cart-…-9fh2k · SIGTERM", true], ["node-2", "checkout-…-r2x7m · SIGTERM"]])],
        }),
        ev({
          id: "eb8", at: 31035000, src: KCM, dst: API, layer: "control", size: "0.3 KB", title: "SHOP IS GONE", path: ["kcm", "api"],
          says: "With nothing left inside, the controller removes the finalizer and the namespace disappears.",
          info: "PUT /api/v1/namespaces/shop/finalize · spec.finalizers []",
          pods: { node1: ["other", "v1", "other"], node2: ["other", "v1", "v1"] },
          decoded: [sec("ETCD", [["/registry/namespaces/shop", "deleted", true], ["revision", LAST_REV], ["the 02:00 snapshot", `revision ${SNAP_REV} · shop still in it`]])],
        }),
      ],
    },
    {
      title: "RESTORE",
      subtitle: "a new data directory, under a stopped API server",
      body: "Restoring replaces etcd's data, so nothing may be writing to it. On cp-1 you move the kube-apiserver manifest out of /etc/kubernetes/manifests, and the kubelet stops the API server. etcdutl snapshot restore builds a new data directory from the snapshot, with a new cluster ID. You point the etcd manifest's data volume at that directory, the kubelet restarts etcd on it, and you move the API server manifest back.",
      facts: [
        ["STOP", "kube-apiserver.yaml out of /etc/kubernetes/manifests"],
        ["RESTORE", "etcdutl snapshot restore --data-dir /var/lib/etcd-restore"],
        ["ETCD MANIFEST", "hostPath etcd-data → /var/lib/etcd-restore"],
        ["SEVERAL ETCD MEMBERS", "restore every one from the same snapshot"],
      ],
      view: "cluster",
      focus: ["api", "etcd"],
      events: [
        ev({
          id: "eb9", at: 31500000, src: `kubelet · ${CP}`, dst: API, layer: "drop", size: " - ", title: "STOP THE API SERVER", path: ["api", "api"],
          says: "You move the API server's manifest aside. cp-1's kubelet stops it, and the cluster has no API.",
          info: "mv /etc/kubernetes/manifests/kube-apiserver.yaml /root/",
          decoded: [sec("WHY", [["a restore", "replaces etcd's data under it"], ["any API server running", "would write to etcd and confuse clients", true], ["running Pods", "keep running · they don't need the API"]])],
        }),
        ev({
          id: "eb10", at: 31560000, src: "etcdutl · cp-1", dst: ETCD, layer: "state", size: "48 MB", title: "SNAPSHOT RESTORE", path: ["etcd", "etcd"],
          says: "etcdutl writes a fresh data directory from the snapshot.",
          info: `etcdutl --data-dir /var/lib/etcd-restore snapshot restore ${SNAP} --bump-revision 1000000000 --mark-compacted`,
          decoded: [
            sec("RESTORED", [["data", `the database at revision ${SNAP_REV}`, true], ["member ID · cluster ID", "new · it can't rejoin the old cluster by mistake"]]),
            sec("FOR KUBERNETES", [["--bump-revision 1000000000", "new writes get revisions far above any a client has seen"], ["--mark-compacted", "a watch from a newer revision ends · clients must list again"]]),
          ],
          note: "etcdctl snapshot restore is deprecated, and from etcd v3.6 restoring is etcdutl's job alone.",
        }),
        ev({
          id: "eb11", at: 31600000, src: `kubelet · ${CP}`, dst: ETCD, layer: "state", size: " - ", title: "ETCD ON THE RESTORED DATA", path: ["etcd", "etcd"],
          says: "You point etcd's manifest at the new directory, and the kubelet restarts etcd on it.",
          info: "/etc/kubernetes/manifests/etcd.yaml  volumes[etcd-data].hostPath.path=/var/lib/etcd-restore",
          decoded: [sec("ETCD.YAML", [["etcd-data hostPath", "/var/lib/etcd → /var/lib/etcd-restore", true], ["kubeadm-config", "set etcd.local.dataDir too, or the next kubeadm upgrade writes the old path back"]])],
        }),
        ev({
          id: "eb12", at: 31660000, src: `kubelet · ${CP}`, dst: API, layer: "api", size: " - ", title: "THE API SERVER RETURNS", path: ["api", "etcd"],
          says: "You move the API server's manifest back. It starts and reads the restored etcd.",
          info: "mv /root/kube-apiserver.yaml /etc/kubernetes/manifests/",
          decoded: [sec("API SERVER", [["/readyz", "ok"], ["namespace shop", "Active · as at 02:00", true]])],
        }),
      ],
    },
    {
      title: "TIME WENT BACKWARDS",
      subtitle: "every cache is newer than the cluster",
      body: "Every client that watches the API had seen revisions up to "+LAST_REV+". The restored etcd is at the 02:00 state. Without the extra flags, new writes would reuse revision numbers clients had already seen for other changes, and watches could quietly miss things. With --mark-compacted, those watches end with an error, the API server answers 410 Gone, and each client lists everything again and builds a fresh cache. The docs also recommend restarting the controller manager, the scheduler and the kubelets so none of them acts on stale data.",
      facts: [
        ["CLIENTS HAD SEEN", `revision ${LAST_REV}`],
        ["ETCD HAS", `the state at ${SNAP_REV} · new writes after 1,002,814,307`],
        ["A WATCH FROM BEFORE", "410 Gone → list again"],
        ["RESTART", "controller manager · scheduler · kubelets"],
      ],
      view: "cluster",
      focus: ["api", "kcm", "sched", "node1", "node2"],
      events: [
        ev({
          id: "eb13", at: 31661000, src: K1, dst: API, layer: "drop", size: "0.3 KB", title: "410 GONE", path: ["node1", "api"],
          says: "node-1's kubelet resumes its watch from the revision it last saw. That revision is now compacted.",
          info: "GET /api/v1/pods?watch=true&resourceVersion=2951790 → 410 Gone",
          decoded: [sec("WATCH", [["resourceVersion", "2951790 · seen before the restore"], ["etcd", "marked compacted · can't replay it"], ["answer", "410 Gone · too old resource version", true]])],
        }),
        ev({
          id: "eb14", at: 31661200, src: K1, dst: API, layer: "api", size: "8 KB", title: "LIST AGAIN", path: ["node1", "api"],
          says: "The kubelet lists its Pods from scratch and starts a new watch from the new revision.",
          info: "GET /api/v1/pods?fieldSelector=spec.nodeName=node-1 → resourceVersion 1002814309",
          decoded: [sec("FRESH LIST", [["resourceVersion", "1002814309 · above anything seen before", true], ["contains", "cart-…-9fh2k again · from the snapshot"]])],
          note: "The same happens to every informer in the controller manager, the scheduler, CoreDNS and kube-proxy: as in List and watch, a 410 means start over.",
        }),
        ev({
          id: "eb15", at: 31700000, src: KCM, dst: API, layer: "control", size: "0.4 KB", title: "RESTART THE CONTROLLERS", path: ["kcm", "api"],
          says: "You restart the controller manager and the scheduler, and they take their leader Leases and list everything again.",
          info: "kubectl -n kube-system delete pod kube-controller-manager-cp-1 kube-scheduler-cp-1",
          decoded: [sec("WHY RESTART", [["informer caches", "built from the old timeline", true], ["leader Leases", "restored from 02:00 · held by processes that may no longer exist"], ["docs", "restart kube-scheduler, kube-controller-manager and kubelet"]])],
        }),
      ],
    },
    {
      title: "RECONCILE",
      subtitle: "shop is back; 02:00 to 10:41 is gone",
      body: "The restored etcd holds the shop namespace and everything in it, including the Pod objects, still bound to their nodes. The kubelets find Pods they should be running and start their containers again. Controllers compare the old desired state with what's on the nodes and settle the rest. Everything that changed after 02:00 is gone from the API: a ConfigMap edited at 09:15 is back to its old value, and a debug Pod created at 08:30 is unknown, so its kubelet stops it.",
      facts: [
        ["SHOP", "back · Pods started again"],
        ["CHANGED AFTER 02:00", "lost · back to the 02:00 value"],
        ["CREATED AFTER 02:00", "gone from the API · stopped by kubelets"],
        ["YOU CAN LOSE", "everything since the last snapshot"],
      ],
      view: "cluster",
      focus: ["api", "kcm", "node1", "node2"],
      events: [
        ev({
          id: "eb16", at: 31702000, src: API, dst: K1, layer: "control", size: "2.4 KB", title: "CART IS BACK", path: ["api", "node1"],
          says: "node-1's kubelet finds cart-…-9fh2k assigned to it and starts it again.",
          info: "cart-…-9fh2k · nodeName=node-1 · not running here",
          pods: { node1: ["other", "v1", "starting", "other"], node2: ["other", "v1", "v1", "starting"] },
          decoded: [sec("FROM THE SNAPSHOT", [["Pod cart-…-9fh2k", "same name, same UID, bound to node-1", true], ["status", "says Running · stale until the kubelet updates it"], ["kubelet", "creates a new sandbox and containers"]])],
        }),
        ev({
          id: "eb17", at: 31702500, src: K1, dst: K1, layer: "drop", size: " - ", title: "A POD THE API FORGOT", path: ["node1", "node1"],
          says: "node-1 also runs a Pod created at 08:30, after the snapshot. The API has never heard of it, so the kubelet stops it.",
          info: "debug · not in the API · killed",
          pods: { node1: ["other", "v1", "starting", "terminating"] },
          decoded: [sec("NODE-1", [["Pod debug", "kubectl run debug --image=busybox · 08:30", true], ["in the restored etcd", "no"], ["kubelet", "stops Pods it has no object for"]])],
        }),
        ev({
          id: "eb18", at: 31730000, src: K1, dst: API, layer: "api", size: "1.4 KB", title: "SETTLED", path: ["node1", "api"],
          says: "The shop Pods are Running and Ready again. The cluster matches 02:00, plus whatever controllers did since.",
          info: "PATCH …/pods/cart-…-9fh2k/status  Ready=True",
          pods: { node1: ["other", "v1", "v2"], node2: ["other", "v1", "v1", "v2"] },
          decoded: [sec("LOST", [["ConfigMap cart-config", "back to its 02:00 value · edited at 09:15"], ["Pod debug", "gone · created at 08:30"], ["volume data", "unchanged · etcd never held it"]])],
          note: "A PersistentVolume's data isn't rolled back, so a database whose PVC came back from 02:00 still sees its 10:41 data. That can be right or wrong, and it's why volume backups have their own tools.",
        }),
      ],
    },
    {
      title: "THE OTHER CLASSIC: EXPIRED CERTIFICATES",
      subtitle: "a year after kubeadm init",
      body: "The other way a kubeadm control plane stops answering is time. kubeadm's certificates are valid for one year, the CAs for ten. If nothing renews them, kubectl one day fails with x509: certificate has expired, and the API server can no longer reach etcd or the kubelets. kubeadm upgrade renews them, so clusters upgraded at least once a year never see this. Otherwise: kubeadm certs check-expiration shows what's left, kubeadm certs renew all renews them, then restart the control plane Pods and copy the new admin.conf.",
      facts: [
        ["LIFETIME", "1 year · CAs 10 years"],
        ["CHECK", "kubeadm certs check-expiration"],
        ["FIX", "kubeadm certs renew all · restart static Pods"],
        ["KUBELET", "rotates its own client certificate"],
      ],
      view: "cluster",
      focus: ["you", "api", "etcd"],
      events: [
        ev({
          id: "eb19", at: 31800000, src: "kubectl", dst: API, layer: "drop", size: " - ", title: "X509: CERTIFICATE HAS EXPIRED", path: ["you", "api"],
          says: "In a cluster nobody upgraded for a year, kubectl's TLS handshake fails.",
          info: "tls: failed to verify certificate: x509: certificate has expired or is not yet valid",
          decoded: [sec("WHAT EXPIRED", [["apiserver.crt", "the API server's serving certificate", true], ["admin.conf", "your client certificate, inside"], ["apiserver-etcd-client.crt", "the API server can't reach etcd either"]])],
        }),
        ev({
          id: "eb20", at: 31860000, src: `kubeadm · ${CP}`, dst: `kubeadm · ${CP}`, layer: "control", size: " - ", title: "CHECK AND RENEW", path: ["api", "api"],
          says: "On cp-1, kubeadm shows what has expired and renews it.",
          info: "kubeadm certs check-expiration · kubeadm certs renew all",
          decoded: [
            sec("CHECK-EXPIRATION", [["columns", "CERTIFICATE · EXPIRES · RESIDUAL TIME · CERTIFICATE AUTHORITY · EXTERNALLY MANAGED"], ["apiserver", "expired", true], ["ca", "9y left"]]),
            sec("AFTER RENEW ALL", [["restart", "the control plane static Pods, which read certificates only at start"], ["you", "cp /etc/kubernetes/admin.conf ~/.kube/config"], ["kubelet.conf", "not renewed by kubeadm · the kubelet rotates it"]]),
          ],
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "snapshot + check + copy", layer: "state", start: 1000, duration: 8000 },
    { value: "t2", label: "namespace deleted", layer: "control", start: 31000000, duration: 35000 },
    { value: "t3", label: "API server stopped", layer: "drop", start: 31500000, duration: 160000 },
    { value: "t4", label: "relist, restart controllers", layer: "control", start: 31661000, duration: 39000 },
    { value: "t5", label: "shop Pods Ready again", layer: "node", start: 31702000, duration: 28000 },
  ],
  timingNote: "Times from one illustrative run. A restore's real cost is the gap between the snapshot and the accident: everything in it is lost.",
  summary: {
    title: "A SNAPSHOT IS A POINT IN TIME",
    body: "etcd holds the cluster's objects and nothing else, so a snapshot of it is the whole cluster's state at one revision. Restoring means stopping the API server, building a new data directory with etcdutl and starting etcd on it. The hard part is time: every client is ahead of the restored data, so marking revisions compacted makes them all list again, and restarting the control plane drops what they cached. Whatever happened after the snapshot is gone, and a year-old kubeadm cluster has expired certificates to worry about too.",
    facts: [
      ["SNAPSHOT", "etcdctl snapshot save · copied off the node"],
      ["RESTORE", "etcdutl · --bump-revision · --mark-compacted"],
      ["AFTERWARDS", "410 Gone · relist · restart the control plane"],
      ["NEXT", "Graceful shutdown"],
    ],
  },
}
