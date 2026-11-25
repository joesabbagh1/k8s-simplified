const UPPER = new Set([
  "ACK", "API", "ARP", "BPF", "AWS", "CA", "CEL", "CIDR", "CNI", "CPU", "CRI", "CSR", "DNAT", "DNS", "EDS", "FDB", "GET", "HBONE", "HPA", "HTTP", "ID", "IP", "IPAM", "JWT",
  "MAC", "MTU", "RSA", "SPIFFE", "NAT", "NXDOMAIN", "OK", "OOM", "PID", "PV", "PVC", "RBAC", "RV", "SIGTERM", "SNAT", "SNI", "SYN", "TCP", "TLS",
  "TTL", "UDP", "URL", "VIP", "VM", "VTEP", "VXLAN",
])

const PROPER: Record<string, string> = {
  ADMISSIONREVIEW: "AdmissionReview",
  APPLYCONFIGURATION: "applyConfiguration",
  AUTHORIZATIONPOLICY: "AuthorizationPolicy",
  CILIUM: "Cilium",
  CLIENTHELLO: "ClientHello",
  CLUSTERIP: "ClusterIP",
  CERTIFICATESIGNINGREQUEST: "CertificateSigningRequest",
  CONFIGMAP: "ConfigMap",
  COREDNS: "CoreDNS",
  CRASHLOOPBACKOFF: "CrashLoopBackOff",
  DAEMONSET: "DaemonSet",
  DAEMONSETS: "DaemonSets",
  DEPLOYMENT: "Deployment",
  DNSCONFIG: "dnsConfig",
  EBPF: "eBPF",
  ENVOY: "Envoy",
  FALCO: "Falco",
  FALCOSIDEKICK: "Falcosidekick",
  ENDPOINTSLICE: "EndpointSlice",
  GENERATINGPOLICY: "GeneratingPolicy",
  "HTTP/2": "HTTP/2",
  IPV4: "IPv4",
  IPS: "IPs",
  ISTIO: "Istio",
  JOB: "Job",
  JSONPATCH: "JSONPatch",
  KYVERNO: "Kyverno",
  MI: "Mi",
  MTLS: "mTLS",
  MUTATINGPOLICY: "MutatingPolicy",
  NAMESPACE: "Namespace",
  NETWORKPOLICY: "NetworkPolicy",
  NODEPORT: "NodePort",
  NODERESTRICTION: "NodeRestriction",
  OOMKILLED: "OOMKilled",
  PEERAUTHENTICATION: "PeerAuthentication",
  PERSISTENTVOLUMECLAIM: "PersistentVolumeClaim",
  POD: "Pod",
  PODS: "Pods",
  POLICYREPORT: "PolicyReport",
  POSTGRES: "Postgres",
  PRESTOP: "preStop",
  REPLICASET: "ReplicaSet",
  SERVICES: "Services",
  SLACK: "Slack",
  STATEFULSET: "StatefulSet",
  TALON: "Talon",
  UPDATEREQUEST: "UpdateRequest",
  VALIDATINGPOLICY: "ValidatingPolicy",
  VIRTUALSERVICE: "VirtualService",
  XDS: "xDS",
}

/** Words that are names written in lower case, so they never get a capital, even first. */
const lowerName = (word: string) => /\d|[()_.]|:\S|^(etcd|istiod|ztunnel|mTLS|xDS|kubelet|kubeadm|kube-|flannel|eth|veth|cni|cali|runc|iptables|ndots|overlayfs|cgroups|clone|pivot|\/)/.test(word)

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
