import type { Lesson } from "../types"
import { deployAnApp } from "./deploy-an-app"
import { requestFindsPod } from "./request-finds-pod"
import { rollingUpdate } from "./rolling-update"
import { podToPodSameNode } from "./pod-to-pod-same-node"
import { podToPodAcrossNodes } from "./pod-to-pod-across-nodes"
import { podCallsService } from "./pod-calls-service"
import { dnsInCluster } from "./dns-in-cluster"
import { ingressGateway } from "./ingress-gateway"
import { networkPolicy } from "./network-policy"
import { ciliumEbpf } from "./cilium-ebpf"
import { serviceMeshIstio } from "./service-mesh-istio"
import { startingAContainer } from "./starting-a-container"
import { imagePull } from "./image-pull"
import { probesRestarts } from "./probes-restarts"
import { oomKilled } from "./oom-killed"
import { mountingVolume } from "./mounting-volume"
import { gpuDevicePlugin } from "./gpu-device-plugin"
import { listAndWatch } from "./list-and-watch"
import { theScheduler } from "./the-scheduler"
import { pendingPod } from "./pending-pod"
import { reconcileLoops } from "./reconcile-loops"
import { nodeGoesDark } from "./node-goes-dark"
import { nodeJoins } from "./node-joins"
import { drainingANode } from "./draining-a-node"
import { upgradingTheCluster } from "./upgrading-the-cluster"
import { etcdBackupRestore } from "./etcd-backup-restore"
import { gracefulShutdown } from "./graceful-shutdown"
import { autoscaling } from "./autoscaling"
import { kedaScaleToZero } from "./keda-scale-to-zero"
import { modelServerStartup } from "./model-server-startup"
import { configmapsSecrets } from "./configmaps-secrets"
import { statefulsetStorage } from "./statefulset-storage"
import { jobsCronjobs } from "./jobs-cronjobs"
import { rbacTokens } from "./rbac-tokens"
import { podCloudCredentials } from "./pod-cloud-credentials"
import { kyvernoPolicies } from "./kyverno-policies"
import { tenantQuotas } from "./tenant-quotas"
import { falcoAlerts } from "./falco-alerts"

export const LESSONS: Lesson[] = [
  deployAnApp,
  requestFindsPod,
  rollingUpdate,
  podToPodSameNode,
  podToPodAcrossNodes,
  podCallsService,
  dnsInCluster,
  ingressGateway,
  networkPolicy,
  ciliumEbpf,
  serviceMeshIstio,
  startingAContainer,
  imagePull,
  probesRestarts,
  oomKilled,
  mountingVolume,
  gpuDevicePlugin,
  listAndWatch,
  theScheduler,
  pendingPod,
  reconcileLoops,
  nodeGoesDark,
  nodeJoins,
  drainingANode,
  upgradingTheCluster,
  etcdBackupRestore,
  gracefulShutdown,
  autoscaling,
  kedaScaleToZero,
  modelServerStartup,
  configmapsSecrets,
  statefulsetStorage,
  jobsCronjobs,
  rbacTokens,
  podCloudCredentials,
  kyvernoPolicies,
  tenantQuotas,
  falcoAlerts,
]

export const lessonById = (id: string) => LESSONS.find((l) => l.id === id)
