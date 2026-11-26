import type { Lesson, Resource } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const KCM = "kube-controller-manager"
const RS_CTRL = "replicaset ctrl"
const AUTHN = "authentication"
const AUTHZ = "authorization"
const MUTATE = "mutating admission"
const SCHEMA = "schema validation"
const VALIDATE = "validating admission"
const ETCD = "etcd"
const PSA_WARNING = `would violate PodSecurity "restricted:latest": allowPrivilegeEscalation != false (container "app" must set securityContext.allowPrivilegeEscalation=false), unrestricted capabilities (container "app" must set securityContext.capabilities.drop=["ALL"]), runAsNonRoot != true (pod or container "app" must set securityContext.runAsNonRoot=true), seccompProfile (pod or container "app" must set securityContext.seccompProfile.type to "RuntimeDefault" or "Localhost")`
const QUOTA_ERROR = `exceeded quota: team-a, requested: pods=1, used: pods=5, limited: pods=5`

const quota = (sub: string, state?: Resource["state"]): Resource => ({ kind: "resourcequota", name: "ResourceQuota team-a", sub, state })
const limits = (state?: Resource["state"]): Resource => ({ kind: "limitrange", name: "LimitRange defaults", sub: "100m / 128Mi", state })
const deploy = (sub: string, state?: Resource["state"]): Resource => ({ kind: "deployment", name: "Deployment app", sub, state })
const rs = (sub: string, state?: Resource["state"]): Resource => ({ kind: "replicaset", name: "ReplicaSet app-6d9f…", sub, state })
const rs2 = (sub: string, state?: Resource["state"]): Resource => ({ kind: "replicaset", name: "ReplicaSet app-58c7…", sub, state })

export const tenantQuotas: Lesson = {
  id: "tenant-quotas",
  title: "Quotas and defaults for a tenant",
  subtitle: "LimitRange, ResourceQuota, Pod Security",
  category: "security",
  seo: {
    title: "Kubernetes ResourceQuota, LimitRange and PSA",
    description: "A team's namespace gets a LimitRange, a ResourceQuota and the restricted Pod Security level, and its first Deployment runs into all three, step by step.",
  },
  actors: ["you", "cp", "node1", "node2", "team-quota", "team-limits", "team-deploy", "team-rs", "team-rs2"],
  opens: { api: "admission" },
  pods: { node1: ["other"], node2: ["other"] },
  lanes: {
    kubectl: "you",
    [API]: "control plane", [KCM]: "control plane", [RS_CTRL]: "control plane",
    [AUTHN]: "API server", [AUTHZ]: "API server", [MUTATE]: "API server", [SCHEMA]: "API server", [VALIDATE]: "API server",
    [ETCD]: "etcd",
    "kubelet · node-1": "nodes", "kubelet · node-2": "nodes",
  },
  overview: {
    body: "Team A gets a namespace of its own in a shared cluster. Three things built into the API server keep it in its lane: a LimitRange that fills in resources nobody wrote, a ResourceQuota that caps what the namespace may use in total, and Pod Security admission at the restricted level. None of them is a webhook or a controller you install. The team deploys its first app and runs into all three, in the order the API server checks them.",
    facts: [
      ["NAMESPACE", "team-a · enforce and warn: restricted"],
      ["QUOTA", "requests.cpu 2 · requests.memory 4Gi · pods 5"],
      ["DEFAULTS", "request 100m / 128Mi · limit 500m / 512Mi"],
      ["ALL BUILT IN", "admission plugins in the API server"],
    ],
  },
  steps: [
    {
      title: "THE TENANT",
      subtitle: "a namespace and its rules",
      body: "You create the namespace team-a with two labels: Pod Security's enforce and warn modes, both at the restricted level. Then a ResourceQuota, which caps the sum of all Pods' CPU and memory requests and the number of Pods, and a LimitRange, which gives every container a default request and limit when it doesn't set its own. The quota controller in the controller manager counts what's already there: nothing.",
      facts: [
        ["LABELS", "pod-security.kubernetes.io/enforce · /warn: restricted"],
        ["RESOURCEQUOTA", "requests.cpu 2 · requests.memory 4Gi · pods 5"],
        ["LIMITRANGE", "default 500m / 512Mi · defaultRequest 100m / 128Mi"],
        ["USED", "0 of everything"],
      ],
      view: "cluster",
      focus: ["you", "api", "kcm", "team-quota", "team-limits"],
      events: [
        ev({
          id: "tq1", at: 0, src: "kubectl", dst: API, layer: "api", size: "0.3 KB", title: "CREATE NAMESPACE TEAM-A", path: ["you", "api"],
          says: "You create team-a with the restricted Pod Security level.",
          info: "POST /api/v1/namespaces  team-a",
          decoded: [sec("LABELS", [["pod-security.kubernetes.io/enforce", "restricted", true], ["pod-security.kubernetes.io/warn", "restricted"], ["…/enforce-version", "unset · latest"]])],
        }),
        ev({
          id: "tq2", at: 500, src: "kubectl", dst: API, layer: "api", size: "0.6 KB", title: "QUOTA AND DEFAULTS", path: ["you", "api"],
          says: "You add a ResourceQuota and a LimitRange to the namespace.",
          info: "POST …/namespaces/team-a/resourcequotas · …/limitranges",
          res: { "team-quota": quota("pods 0/5", "creating"), "team-limits": limits("creating") },
          decoded: [
            sec("RESOURCEQUOTA TEAM-A", [["hard.requests.cpu", "2"], ["hard.requests.memory", "4Gi"], ["hard.pods", "5", true]]),
            sec("LIMITRANGE DEFAULTS", [["type", "Container"], ["defaultRequest", "cpu 100m · memory 128Mi", true], ["default (limits)", "cpu 500m · memory 512Mi"]]),
          ],
        }),
        ev({
          id: "tq3", at: 800, src: KCM, dst: API, layer: "control", size: "0.3 KB", title: "COUNT WHAT'S USED", path: ["kcm", "team-quota"],
          says: "The quota controller counts the namespace's usage and writes it into the quota's status.",
          info: "PUT …/resourcequotas/team-a/status",
          res: { "team-quota": quota("pods 0/5 · cpu 0/2", "active"), "team-limits": limits("active") },
          decoded: [sec("STATUS.USED", [["pods", "0", true], ["requests.cpu", "0"], ["requests.memory", "0"]])],
        }),
      ],
    },
    {
      title: "WARNED, NOT BLOCKED",
      subtitle: "Pod Security checks Pods, and only warns about Deployments",
      body: "The team applies a Deployment app with no securityContext and no resources. Zoom into the API server. The request passes authentication and authorization, and Pod Security, in validating admission, looks at the Deployment's Pod template. It breaks four of the restricted rules. But enforce mode applies only to Pods: for a Deployment, only warn and audit apply. So the Deployment is saved, and kubectl prints a warning that's easy to scroll past.",
      facts: [
        ["OBJECT", "Deployment app · no securityContext"],
        ["ENFORCE", "Pods only"],
        ["FOR A DEPLOYMENT", "warn and audit"],
        ["RESULT", "201 Created · Warning: would violate PodSecurity"],
      ],
      view: "admission",
      focus: ["g.client", "g.authn", "g.authz", "g.mutate", "g.schema", "g.validate", "g.etcd"],
      events: [
        ev({
          id: "tq4", at: 60000, src: "kubectl", dst: AUTHN, layer: "api", size: "1.4 KB", title: "A DEPLOYMENT ARRIVES", path: ["g.client", "g.authn"],
          says: "The team's Deployment arrives at the API server.",
          info: "POST /apis/apps/v1/namespaces/team-a/deployments  app",
          res: { "team-deploy": deploy("replicas 3", "creating") },
          decoded: [sec("POD TEMPLATE", [["image", "registry.example.com/team-a/app:2.0"], ["securityContext", "none", true], ["resources", "none"]])],
        }),
        ev({
          id: "tq5", at: 60002, src: AUTHZ, dst: MUTATE, layer: "api", size: " - ", title: "NOTHING TO CHANGE", path: ["g.authz", "g.mutate"],
          says: "Authorized. The LimitRange only fills in Pods, so the Deployment passes through unchanged.",
          info: "LimitRanger: not a Pod",
          decoded: [sec("MUTATING ADMISSION", [["LimitRanger", "acts on Pods · skips Deployments"], ["the template", "left without resources", true]])],
        }),
        ev({
          id: "tq6", at: 60004, src: SCHEMA, dst: VALIDATE, layer: "drop", size: " - ", title: "WOULD VIOLATE", path: ["g.schema", "g.validate"],
          says: "Pod Security checks the template against restricted: four violations. For a Deployment, that's a warning.",
          info: `Warning: ${PSA_WARNING.slice(0, 60)}…`,
          decoded: [
            sec("RESTRICTED · VIOLATIONS", [["allowPrivilegeEscalation", "must be false", true], ["capabilities.drop", "must include ALL"], ["runAsNonRoot", "must be true"], ["seccompProfile.type", "must be RuntimeDefault or Localhost"]]),
            sec("MODE", [["enforce", "Pods only · not applied here"], ["warn", "→ a Warning header to the client", true], ["audit", "an annotation in the audit log, if configured"]]),
          ],
        }),
        ev({
          id: "tq7", at: 60006, src: VALIDATE, dst: ETCD, layer: "state", size: "2.1 KB", title: "SAVED ANYWAY", path: ["g.validate", "g.etcd"],
          says: "No one said no, so the Deployment is saved, warning and all.",
          info: "201 Created · deployment.apps/app created",
          res: { "team-deploy": deploy("replicas 3", "active") },
          decoded: [sec("KUBECTL PRINTS", [["Warning", PSA_WARNING], ["then", "deployment.apps/app created", true]])],
        }),
      ],
    },
    {
      title: "THE REPLICASET CAN'T",
      subtitle: "the same rules, enforced on each Pod",
      body: "The Deployment controller creates a ReplicaSet, and the ReplicaSet controller tries to create the first Pod. This time the object is a Pod. On the way in, the LimitRange fills in its requests and limits. Then Pod Security, now in enforce mode, finds the same four violations and refuses: 403 Forbidden. The ReplicaSet records a FailedCreate event and keeps retrying, and the Deployment shows ReplicaFailure. Nothing appears in kubectl get pods, which is where people look.",
      facts: [
        ["CLIENT", "the ReplicaSet controller"],
        ["MUTATED FIRST", "LimitRange defaults · requests and limits"],
        ["THEN", "PodSecurity enforce → 403 Forbidden"],
        ["WHERE IT SHOWS", "kubectl describe rs · FailedCreate"],
      ],
      view: "admission",
      focus: ["g.client", "g.mutate", "g.validate"],
      events: [
        ev({
          id: "tq8", at: 60500, src: RS_CTRL, dst: AUTHN, layer: "api", size: "1.6 KB", title: "THE FIRST POD", path: ["g.client", "g.authn"],
          says: "The ReplicaSet controller asks to create the first Pod.",
          info: "POST /api/v1/namespaces/team-a/pods  app-6d9f…-",
          res: { "team-rs": rs("0 of 3 Pods", "creating") },
          decoded: [sec("CLIENT", [["user", "system:serviceaccount:kube-system:replicaset-controller"], ["object", "a Pod, from the template", true]])],
        }),
        ev({
          id: "tq9", at: 60502, src: AUTHZ, dst: MUTATE, layer: "api", size: "0.2 KB", title: "DEFAULTS FILLED IN", path: ["g.authz", "g.mutate"],
          says: "The LimitRanger admission plugin gives the container the namespace's default requests and limits.",
          info: "LimitRanger: cpu, memory request and limit set for container app",
          decoded: [sec("CONTAINER APP", [["requests", "cpu 100m · memory 128Mi", true], ["limits", "cpu 500m · memory 512Mi"], ["annotation", "kubernetes.io/limit-ranger: LimitRanger plugin set: cpu, memory request for container app; cpu, memory limit for container app"]])],
        }),
        ev({
          id: "tq10", at: 60504, src: VALIDATE, dst: RS_CTRL, layer: "drop", size: "0.9 KB", title: "403 FORBIDDEN", path: ["g.validate", "g.client"],
          says: "Pod Security enforces restricted on Pods, and refuses this one.",
          info: `pods "app-6d9f…-" is forbidden: violates PodSecurity "restricted:latest": allowPrivilegeEscalation != false …`,
          res: { "team-rs": rs("0 of 3 · FailedCreate", "active"), "team-deploy": deploy("ReplicaFailure") },
          decoded: [
            sec("RESPONSE", [["code", "403", true], ["message", `pods "app-6d9f…-" is forbidden: violates PodSecurity "restricted:latest": …`]]),
            sec("WHERE IT SHOWS", [["ReplicaSet events", "Warning FailedCreate · the same message", true], ["Deployment conditions", "ReplicaFailure=True · reason FailedCreate"], ["kubectl get pods", "nothing at all"]]),
          ],
          note: "ResourceQuota never saw this Pod: Pod Security said no first, and one no ends the request.",
        }),
      ],
    },
    {
      title: "FIXED",
      subtitle: "four fields in the securityContext",
      body: "The team adds a securityContext that meets the restricted level: run as non-root, no privilege escalation, drop every capability, and the runtime's default seccomp profile. The image must actually work as a non-root user, which is a change to the image, not just the YAML. The new template gets a new ReplicaSet, whose Pods pass admission, are scheduled and start.",
      facts: [
        ["runAsNonRoot", "true"],
        ["allowPrivilegeEscalation", "false"],
        ["capabilities.drop", "[ALL]"],
        ["seccompProfile.type", "RuntimeDefault"],
      ],
      view: "cluster",
      focus: ["you", "api", "kcm", "node1", "node2", "team-deploy", "team-rs", "team-rs2"],
      events: [
        ev({
          id: "tq11", at: 300000, src: "kubectl", dst: API, layer: "api", size: "1.6 KB", title: "A COMPLIANT TEMPLATE", path: ["you", "api"],
          says: "The team applies the Deployment again, with a securityContext. No warning this time.",
          info: "PATCH …/namespaces/team-a/deployments/app",
          decoded: [sec("SECURITYCONTEXT", [["runAsNonRoot", "true", true], ["allowPrivilegeEscalation", "false"], ["capabilities.drop", "[ALL]"], ["seccompProfile.type", "RuntimeDefault"]])],
        }),
        ev({
          id: "tq12", at: 300100, src: RS_CTRL, dst: API, layer: "control", size: "1.8 KB", title: "PODS, ADMITTED", path: ["kcm", "api"],
          says: "A new ReplicaSet creates three Pods, and this time all three are admitted.",
          info: "POST …/namespaces/team-a/pods × 3 · 201 Created",
          res: { "team-rs2": rs2("3 Pods", "creating"), "team-rs": rs("0 Pods · scaled down"), "team-deploy": deploy("replicas 3") },
          pods: { node1: ["other", "starting", "starting"], node2: ["other", "starting"] },
          decoded: [sec("ADMISSION", [["LimitRanger", "defaults filled in"], ["PodSecurity", "restricted ✓", true], ["ResourceQuota", "3 of 5 Pods · 300m of 2 CPU"]])],
        }),
      ],
    },
    {
      title: "COUNTED",
      subtitle: "every Pod pays into the quota",
      body: "Follow one of those Pods through admission. LimitRanger has filled in 100m and 128Mi. The ResourceQuota plugin, in validating admission, adds those to what the namespace already uses and compares the totals with the quota's hard limits. They fit, so it writes the new totals into the quota's status before the Pod is saved, using the quota's resourceVersion so two Pods created at once can't both spend the same room. A quota on requests.cpu also means a Pod with no CPU request would be refused; the LimitRange's default is what lets the team skip writing one.",
      facts: [
        ["THIS POD", "cpu 100m · memory 128Mi · pods 1"],
        ["USED AFTER", "cpu 300m/2 · memory 384Mi/4Gi · pods 3/5"],
        ["UPDATED", "in admission, before the Pod is saved"],
        ["NO REQUEST", "refused, if quota covers requests.cpu"],
      ],
      view: "admission",
      focus: ["g.mutate", "g.schema", "g.validate", "g.etcd"],
      events: [
        ev({
          id: "tq14", at: 300101, src: SCHEMA, dst: VALIDATE, layer: "api", size: " - ", title: "THE QUOTA CHECK", path: ["g.schema", "g.validate"],
          says: "ResourceQuota adds this Pod's requests to the namespace's total and compares with the limits.",
          info: "ResourceQuota team-a: pods 2+1 ≤ 5 · requests.cpu 200m+100m ≤ 2",
          decoded: [sec("EVALUATION", [["pods", "2 + 1 = 3 ≤ 5 ✓", true], ["requests.cpu", "200m + 100m = 300m ≤ 2 ✓"], ["requests.memory", "256Mi + 128Mi = 384Mi ≤ 4Gi ✓"]])],
        }),
        ev({
          id: "tq15", at: 300102, src: VALIDATE, dst: ETCD, layer: "state", size: "0.4 KB", title: "SPEND, THEN SAVE", path: ["g.validate", "g.etcd"],
          says: "The new totals are written to the quota's status, then the Pod is saved.",
          info: "PUT /registry/resourcequotas/team-a/team-a · then /registry/pods/team-a/app-58c7…",
          res: { "team-quota": quota("pods 3/5 · cpu 300m/2") },
          decoded: [sec("ORDER", [["1", "quota status.used updated · checked against its resourceVersion", true], ["2", "the Pod written"], ["a conflict", "another Pod got there first · re-evaluate and retry"]])],
          note: "The quota controller recalculates usage from the real objects in the background, so if a Pod is deleted, or a write fails after the quota was updated, the count is corrected.",
        }),
      ],
    },
    {
      title: "EXCEEDED",
      subtitle: "Pod six of five",
      body: "The three Pods start, and later the team scales app to six. Two more Pods fit and the quota reaches 5 of 5. For the sixth, the ResourceQuota plugin refuses: 403, exceeded quota. Like the Pod Security error, it reaches the ReplicaSet controller, not the team: a FailedCreate event on the ReplicaSet and a ReplicaFailure condition on the Deployment, which shows 5 of 6 Pods and stays that way until the quota is raised or the team scales down.",
      facts: [
        ["SCALE", "3 → 6"],
        ["ADMITTED", "Pods 4 and 5 · quota 5/5"],
        ["POD 6", `403 · ${QUOTA_ERROR}`],
        ["DEPLOYMENT", "5/6 · ReplicaFailure"],
      ],
      view: "cluster",
      focus: ["you", "api", "kcm", "node1", "node2", "team-quota", "team-deploy", "team-rs2"],
      events: [
        ev({
          id: "tq13", at: 306000, src: "kubelet · node-1", dst: API, layer: "api", size: "1.3 KB", title: "RUNNING", path: ["node1", "api"],
          says: "The Pods start on node-1 and node-2.",
          info: "app-58c7…  3/3 Ready",
          res: { "team-rs2": rs2("3 Pods", "active") },
          pods: { node1: ["other", "v2", "v2"], node2: ["other", "v2"] },
          decoded: [sec("READY", [["Pods", "3 of 3", true], ["each", "requests 100m · 128Mi, from the LimitRange"]])],
        }),
        ev({
          id: "tq16", at: 900000, src: "kubectl", dst: API, layer: "api", size: "0.2 KB", title: "SCALE TO SIX", path: ["you", "api"],
          says: "The team scales app to six replicas.",
          info: "kubectl -n team-a scale deployment app --replicas=6",
          res: { "team-deploy": deploy("replicas 6") },
          decoded: [sec("PATCH", [["spec.replicas", "3 → 6", true], ["quota left", "2 Pods"]])],
        }),
        ev({
          id: "tq17", at: 900200, src: RS_CTRL, dst: API, layer: "control", size: "1.8 KB", title: "TWO MORE FIT", path: ["kcm", "api"],
          says: "Pods four and five are admitted, and the quota is full.",
          info: "POST …/pods × 2 · 201 Created",
          res: { "team-quota": quota("pods 5/5 · cpu 500m/2") },
          pods: { node1: ["other", "v2", "v2", "starting"], node2: ["other", "v2", "starting"] },
          decoded: [sec("QUOTA", [["pods", "3 → 5 of 5", true], ["requests.cpu", "500m of 2"], ["requests.memory", "640Mi of 4Gi"]])],
        }),
        ev({
          id: "tq18", at: 900300, src: API, dst: RS_CTRL, layer: "drop", size: "0.7 KB", title: "EXCEEDED QUOTA", path: ["api", "kcm"],
          says: "The sixth Pod would take the namespace over its Pod limit. Refused.",
          info: `pods "app-58c7…-" is forbidden: ${QUOTA_ERROR}`,
          res: { "team-rs2": rs2("5 of 6 · FailedCreate"), "team-deploy": deploy("5/6 · ReplicaFailure") },
          decoded: [
            sec("RESPONSE", [["code", "403", true], ["message", `pods "app-58c7…-" is forbidden: ${QUOTA_ERROR}`]]),
            sec("DEPLOYMENT APP", [["conditions[ReplicaFailure]", "True · FailedCreate", true], ["availableReplicas", "5 of 6"], ["fix", "raise the quota, or scale down"]]),
          ],
          note: "Pod Security isn't counted against anything; the quota is. That's why the order matters: a Pod refused by Pod Security never uses up quota.",
        }),
        ev({
          id: "tq19", at: 905000, src: "kubelet · node-2", dst: API, layer: "api", size: "1.3 KB", title: "FIVE RUNNING", path: ["node2", "api"],
          says: "The five admitted Pods run. The sixth will keep failing until something changes.",
          info: "app  5/6 Ready",
          pods: { node1: ["other", "v2", "v2", "v2"], node2: ["other", "v2", "v2"] },
          decoded: [sec("IN TEAM-A", [["Pods", "5 · the quota's limit", true], ["the ReplicaSet", "retries with back-off"]])],
        }),
      ],
    },
    {
      title: "THE FULL PICTURE",
      subtitle: "what a namespace can and can't isolate",
      body: "A namespace becomes a tenant with five pieces: these three, plus RBAC so team A can only touch team-a, and a NetworkPolicy so its Pods only talk to whom they should. All five are rules about the API and the network. The Pods still share nodes, kernels and the control plane, so the next steps up are separate node pools for the tenant, and then a cluster of its own. Compared with Kyverno, everything here is built into the API server and fixed in what it can express; Kyverno's policies are written by you and can check anything.",
      facts: [
        ["IN THE NAMESPACE", "LimitRange · ResourceQuota · Pod Security · RBAC · NetworkPolicy"],
        ["STILL SHARED", "nodes, kernels, the control plane"],
        ["STRONGER", "a node pool per tenant · then a cluster per tenant"],
        ["BUILT IN VS KYVERNO", "fixed rules vs policies you write"],
      ],
      view: "cluster",
      focus: ["you", "api", "team-quota", "team-limits", "team-deploy"],
      events: [
        ev({
          id: "tq20", at: 960000, src: "kubectl", dst: API, layer: "api", size: "0.8 KB", title: "THE REST OF THE TENANT", path: ["you", "api"],
          says: "A RoleBinding and a NetworkPolicy complete the namespace's walls.",
          info: "POST …/namespaces/team-a/rolebindings · …/networkpolicies",
          decoded: [
            sec("ROLEBINDING TEAM-A-EDIT", [["subjects", "group team-a"], ["roleRef", "ClusterRole edit · in team-a only", true]]),
            sec("NETWORKPOLICY DEFAULT-DENY", [["podSelector", "{} · every Pod in team-a"], ["policyTypes", "Ingress"], ["effect", "nothing reaches team-a's Pods until something allows it"]]),
            sec("ORDER IN THE API SERVER", [["mutating", "LimitRanger, then webhooks such as Kyverno's"], ["validating", "PodSecurity, ResourceQuota, then webhooks"]]),
          ],
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "namespace, quota, defaults", layer: "api", start: 0, duration: 800 },
    { value: "t2", label: "Deployment saved with a warning", layer: "api", start: 60000, duration: 6 },
    { value: "t3", label: "every Pod refused", layer: "drop", start: 60500, duration: 239500 },
    { value: "t4", label: "fixed: 3 Pods admitted and Ready", layer: "node", start: 300000, duration: 6000 },
    { value: "t5", label: "scale to 6: 5 run, 1 refused", layer: "drop", start: 900000, duration: 5000 },
  ],
  timingNote: "Times from one illustrative run. Admission takes microseconds to milliseconds; the gaps are people noticing and fixing things.",
  summary: {
    title: "THREE PLUGINS, ONE ROAD",
    body: "A LimitRange, a ResourceQuota and Pod Security are all admission plugins inside the API server, so each Pod meets them in a fixed order: defaults filled in while mutating, then Pod Security and the quota while validating. Pod Security only enforces on Pods, so a bad Deployment is saved with a warning and fails later, on the ReplicaSet. The quota is spent in admission, before the Pod is saved. Both refusals land on the ReplicaSet as FailedCreate, which is where to look when Pods don't appear.",
    facts: [
      ["DEFAULTS", "LimitRanger · mutating"],
      ["REFUSALS", "PodSecurity, then ResourceQuota · validating"],
      ["LOOK HERE", "kubectl describe rs · FailedCreate"],
      ["NEXT", "Runtime alerts with Falco"],
    ],
  },
}
