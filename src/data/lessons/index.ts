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
import { reconcileLoops } from "./reconcile-loops"
import { nodeGoesDark } from "./node-goes-dark"
import { nodeJoins } from "./node-joins"
import { drainingANode } from "./draining-a-node"
import { etcdBackupRestore } from "./etcd-backup-restore"
import { gracefulShutdown } from "./graceful-shutdown"
import { autoscaling } from "./autoscaling"
import { configmapsSecrets } from "./configmaps-secrets"
import { statefulsetStorage } from "./statefulset-storage"
import { jobsCronjobs } from "./jobs-cronjobs"
import { rbacTokens } from "./rbac-tokens"
import { kyvernoPolicies } from "./kyverno-policies"
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
  reconcileLoops,
  nodeGoesDark,
  nodeJoins,
  drainingANode,
  etcdBackupRestore,
  gracefulShutdown,
  autoscaling,
  configmapsSecrets,
  statefulsetStorage,
  jobsCronjobs,
  rbacTokens,
  kyvernoPolicies,
  falcoAlerts,
]

export const lessonById = (id: string) => LESSONS.find((l) => l.id === id)
