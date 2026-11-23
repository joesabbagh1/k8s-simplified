const UPPER = new Set([
  "ACK", "API", "ARP", "BPF", "CA", "CNI", "CPU", "CRI", "DNAT", "DNS", "FDB", "GET", "HPA", "HTTP", "ID", "IP", "JWT",
  "MAC", "MTU", "NAT", "NXDOMAIN", "OK", "OOM", "PID", "PV", "PVC", "RBAC", "RV", "SIGTERM", "SNAT", "SNI", "SYN", "TCP", "TLS",
  "TTL", "UDP", "URL", "VIP", "VM", "VTEP", "VXLAN",
])

const PROPER: Record<string, string> = {
  CILIUM: "Cilium",
  CLIENTHELLO: "ClientHello",
  CLUSTERIP: "ClusterIP",
  CONFIGMAP: "ConfigMap",
  COREDNS: "CoreDNS",
  CRASHLOOPBACKOFF: "CrashLoopBackOff",
  DEPLOYMENT: "Deployment",
  DNSCONFIG: "dnsConfig",
  ENDPOINTSLICE: "EndpointSlice",
  "HTTP/2": "HTTP/2",
  IPV4: "IPv4",
  IPS: "IPs",
  JOB: "Job",
  MI: "Mi",
  NETWORKPOLICY: "NetworkPolicy",
  NODEPORT: "NodePort",
  OOMKILLED: "OOMKilled",
  PERSISTENTVOLUMECLAIM: "PersistentVolumeClaim",
  POD: "Pod",
  PODS: "Pods",
  POSTGRES: "Postgres",
  PRESTOP: "preStop",
  REPLICASET: "ReplicaSet",
  SERVICES: "Services",
  STATEFULSET: "StatefulSet",
}

/** Words that are names written in lower case, so they never get a capital, even first. */
const lowerName = (word: string) => /\d|[()_.]|:\S|^(etcd|kubelet|kube-|eth|veth|cni|cali|runc|iptables|ndots|overlayfs|cgroups|clone|pivot|\/)/.test(word)

/**
 * The lessons write step and event titles in capitals. This turns them into sentence case
 * and keeps acronyms (DNS, VXLAN) and Kubernetes kinds (Pod, ConfigMap) as they are written.
 */
export function sentence(title: string): string {
  if (/[a-z]/.test(title)) return title
  let first = true
  return title.replace(/[A-Z0-9][A-Z0-9'’_./:()-]*/g, (token) => {
    const [, word, rest] = /^(.*?)((?:['’]S)?)$/.exec(token)!
    const tail = rest.toLowerCase()
    let out = word
      .split("-")
      .map((part) => (UPPER.has(part) ? part : (PROPER[part] ?? part.toLowerCase())))
      .join("-")
    if (first && /^[a-z]/.test(out) && !lowerName(out)) out = out[0].toUpperCase() + out.slice(1)
    first = false
    return out + tail
  })
}
