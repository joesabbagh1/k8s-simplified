import type { Lesson } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const K1 = "kubelet · node-1"
const POD = "report pod"

export const rbacTokens: Lesson = {
  id: "rbac-tokens",
  title: "RBAC and ServiceAccounts",
  subtitle: "Who can do what",
  category: "app",
  seo: {
    title: "Kubernetes RBAC and ServiceAccount tokens",
    description: "How a Kubernetes Pod proves who it is with a projected ServiceAccount token, and how Roles and RoleBindings decide each API request.",
  },
  actors: ["you", "cp", "node1"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    [K1]: "node-1",
    [POD]: "Pod",
  },
  overview: {
    body: "How a Pod proves who it is to the API server with a projected token, and how RBAC answers. The identity is a JWT the kubelet keeps fresh in a file inside the container; the permission is three small objects - a ServiceAccount, a Role, a RoleBinding - checked on every single request. One allowed read, one denied read, and the machinery is the same both times.",
    facts: [
      ["SERVICEACCOUNT", "report-runner · ns default"],
      ["TOKEN", "projected JWT · RS256 · 3607 s"],
      ["ROLE", "report-reader · get list watch deployments"],
      ["DENIED", "secrets → 403 (allow-only)"],
    ],
  },
  steps: [
    {
      title: "THE IDENTITY",
      subtitle: "a ServiceAccount, a Role, a binding",
      body: "Before the Pod exists, its identity does: a ServiceAccount called report-runner in namespace default. A Role, report-reader, grants exactly three verbs on one resource - get, list, watch on deployments - and a RoleBinding, report-list, staples the account to the role. Roles say what, bindings say who, and neither knows the other's purpose. A Pod that declares no account gets the namespace's default one.",
      facts: [
        ["SERVICEACCOUNT", "report-runner · ns default"],
        ["ROLE", "report-reader · get list watch deployments"],
        ["BINDING", "report-list → SA report-runner"],
        ["DEFAULT SA", "what a Pod gets if you say nothing"],
      ],
      view: "cluster",
      focus: ["you", "api", "etcd"],
      events: [
        ev({
          id: "rb1", at: 0, src: "kubectl", dst: API, layer: "api", size: "0.9 KB", title: "APPLY THE THREE OBJECTS", path: ["you", "api"],
          says: "kubectl creates the account, the role and the binding that ties them.",
          info: "POST ×3 · serviceaccounts, roles, rolebindings",
          decoded: [
            sec("RBAC OBJECTS", [["ServiceAccount", "report-runner"], ["Role", "report-reader (namespaced)"], ["RoleBinding", "report-list"]]),
            sec("ROLE · REPORT-READER", [["rules[0].verbs", "[get list watch]", true], ["rules[0].resources", "[\"deployments\"]", true], ["rules[0].apiGroups", "[\"apps\"]"]]),
          ],
        }),
        ev({
          id: "rb2", at: 8, src: API, dst: "etcd", layer: "state", size: "0.8 KB", title: "SAVED", path: ["api", "etcd"],
          says: "All three land in etcd like any other object.",
          info: "put /registry/rolebindings/default/report-list …",
          decoded: [sec("KEYS", [["serviceaccounts/default/report-runner", "stored"], ["roles/default/report-reader", "stored"], ["rolebindings/default/report-list", "stored"]])],
        }),
      ],
    },
    {
      title: "THE TOKEN",
      subtitle: "projected, expiring, refreshed",
      body: "Zoom into node-1, where the report Pod runs. Its spec says serviceAccountName: report-runner and, by default, automountServiceAccountToken: true. So before starting the container the kubelet mints a token with the TokenRequest API - 3607 seconds, bound to this Pod - and projects it into the container as a file. Unlike the old static Secret tokens, this one expires, and the kubelet re-mints it at about 80 percent of its lifetime.",
      facts: [
        ["TOKEN PATH", "/var/run/secrets/kubernetes.io/serviceaccount/token"],
        ["EXPIRY", "3607 s · RS256"],
        ["REFRESH", "kubelet re-mints at ~80 %"],
        ["BOUND TO", "this Pod · uid 4c1e…"],
      ],
      view: "node1",
      focus: ["n1.api", "n1.kubelet", "n1.podA"],
      pods: { node1: ["other", "v1", "starting"] },
      events: [
        ev({
          id: "rb3", at: 60, src: API, dst: K1, layer: "control", size: "2.1 KB", title: "KUBELET SEES THE POD", path: ["n1.api", "n1.kubelet"],
          says: "The kubelet sees the Pod and which ServiceAccount it speaks for.",
          info: "WATCH ADDED Pod report-77b4c (nodeName node-1)",
          decoded: [sec("POD SPEC", [["serviceAccountName", "report-runner", true], ["automountServiceAccountToken", "unset → true"], ["volumes[0]", "projected (serviceAccountToken)"]])],
        }),
        ev({
          id: "rb4", at: 400, src: K1, dst: API, layer: "api", size: "0.4 KB", title: "MINT THE TOKEN", path: ["n1.kubelet", "n1.api"],
          says: "The kubelet asks the API server to mint a short-lived token for the account.",
          info: "POST /api/v1/namespaces/default/serviceaccounts/report-runner/token",
          decoded: [sec("TokenRequest", [["expirationSeconds", "3607", true], ["audience", "https://10.0.0.10:6443"], ["bound to", "Pod report-77b4c · uid 4c1e…"], ["returns", "a signed JWT"]])],
        }),
        ev({
          id: "rb5", at: 460, src: K1, dst: POD, layer: "node", size: "0.9 KB", title: "PROJECT THE FILE", path: ["n1.kubelet", "n1.podA"],
          says: "The token lands in the container as a file on a tmpfs mount.",
          info: "projected volume → /var/run/secrets/kubernetes.io/serviceaccount/token",
          decoded: [sec("PROJECTED VOLUME", [["path", "/var/run/secrets/kubernetes.io/serviceaccount/token (tmpfs)", true], ["source", "serviceAccountToken"], ["refresh", "kubelet re-mints at 80 % of TTL ≈ 48 min", true]])],
          pods: { node1: ["other", "v1", "v2"] },
          note: "Bound tokens expire; the static Secret tokens Pods used to mount never did. The file's path is the same, so apps don't notice the difference.",
        }),
      ],
    },
    {
      title: "THE JWT",
      subtitle: "three base64url blobs",
      body: "The app reads the file - three base64url blobs joined by dots. The header names the algorithm, RS256; the payload is the identity claim: issuer, subject system:serviceaccount:default:report-runner, audience, and when it was issued and when it should be replaced: 3607 seconds later. The signature is the part that matters: only the cluster's signing key can produce it, so the app can carry this token anywhere without being able to forge one.",
      facts: [
        ["HEADER", "alg RS256 · kid sa-key-2026-3"],
        ["SUBJECT", "system:serviceaccount:default:report-runner"],
        ["EXPIRY", "3607 s requested · see the note on exp"],
        ["SIGNATURE", "RS256 - unforgeable by the holder"],
      ],
      view: "cluster",
      focus: ["api", "node1"],
      events: [
        ev({
          id: "rb6", at: 500, src: POD, dst: POD, layer: "node", size: "0.9 KB", title: "READ THE TOKEN", path: ["node1", "node1"],
          says: "The app reads the file and gets a JWT: header, payload, signature.",
          info: "cat /var/run/secrets/kubernetes.io/serviceaccount/token → eyJhbGciOi…",
          decoded: [
            sec("JWT · HEADER", [["alg", "RS256"], ["kid", "sa-signing-key-2026-3"], ["then", "a signature over header.payload with the SA signing key"]]),
            sec("JWT · PAYLOAD", [["iss", "https://10.0.0.10:6443"], ["sub", "system:serviceaccount:default:report-runner", true], ["aud", "[\"https://10.0.0.10:6443\"]"], ["iat", "1795320000"], ["warnafter", "1795323607 · iat + 3607 s", true], ["exp", "a year out · stretched by the API server"]]),
          ],
          note: "One wrinkle: by default the API server stretches the exp of these auto-mounted tokens to a year, so old clients that never re-read the file keep working, and it logs a warning when a token is used past warnafter. The kubelet still rewrites the file well before that.",
        }),
        ev({
          id: "rb7", at: 520, src: POD, dst: API, layer: "api", size: "0.3 KB", title: "THE ASK", path: ["node1", "api"],
          says: "One request carries both the question and the identity: list Deployments, Bearer token attached.",
          info: "GET /apis/apps/v1/namespaces/default/deployments",
          decoded: [sec("HTTP/2 REQUEST", [["method", "GET"], ["path", "/apis/apps/v1/namespaces/default/deployments"], ["host", "10.96.0.1:443 (kubernetes.default.svc → 10.0.0.10:6443)"], ["authorization", "Bearer eyJhbGciOi…", true]])],
        }),
      ],
    },
    {
      title: "TWO QUESTIONS",
      subtitle: "authn, then authz",
      body: "The API server answers two questions about every request, in order. First, who: the token's signature checks out against the service-account signing keys, it hasn't expired, and its audience is this server - so the subject becomes system:serviceaccount:default:report-runner. Then, may it: RBAC gathers every RoleBinding in this namespace and every ClusterRoleBinding that names this subject, and unions the rules. report-list → report-reader grants list on deployments: allow, and the list of Deployments comes back.",
      facts: [
        ["AUTHN", "signature ✓ · exp ✓ · aud ✓"],
        ["SUBJECT", "system:serviceaccount:default:report-runner"],
        ["AUTHZ", "RoleBinding report-list → Role report-reader"],
        ["DECISION", "allow → 200 · 3 Deployments"],
      ],
      view: "cluster",
      focus: ["api", "node1"],
      events: [
        ev({
          id: "rb8", at: 530, src: API, dst: API, layer: "api", size: " - ", title: "AUTHENTICATION", path: ["api", "api"],
          says: "Question one: is the token genuine and alive? Yes.",
          info: "authn: JWT signature + exp + aud",
          decoded: [sec("RESULT", [["signature", "valid - kid sa-signing-key-2026-3"], ["exp", "not reached"], ["aud", "this server"], ["user", "system:serviceaccount:default:report-runner", true], ["groups", "system:serviceaccounts · system:serviceaccounts:default · system:authenticated"]])],
        }),
        ev({
          id: "rb9", at: 531, src: API, dst: API, layer: "api", size: " - ", title: "AUTHORIZATION · RBAC", path: ["api", "api"],
          says: "Question two: may this subject list deployments here? The binding says yes.",
          info: "authz: RoleBinding report-list → Role report-reader → allow",
          decoded: [sec("RBAC EVALUATION", [["subject", "system:serviceaccount:default:report-runner"], ["RoleBinding", "report-list (ns default)"], ["Role rules", "[get list watch] × [deployments.apps]", true], ["decision", "allow", true]])],
        }),
        ev({
          id: "rb10", at: 545, src: API, dst: POD, layer: "api", size: "2.8 KB", title: "200 OK", path: ["api", "node1"],
          says: "The list comes back: three Deployments.",
          info: "200 OK · DeploymentList · 3 items",
          decoded: [sec("HTTP/2 RESPONSE", [["status", "200 OK"], ["items", "web · web-cache · web-worker"], ["resourceVersion", "48211"]])],
        }),
      ],
    },
    {
      title: "THE DENY",
      subtitle: "no rule, no access",
      body: "Now the same Pod asks for something adjacent: the Secrets in the namespace. Authentication passes identically - the token is still good. Authorization fails: RBAC searches every binding for this subject and finds get, list, watch on deployments and nothing that touches secrets. RBAC is allow-only with a default deny: there are no deny rules and no ordering - bindings simply union, and an empty union is a refusal. The answer is a 403 with the exact reason in the body.",
      facts: [
        ["ASKED", "GET /api/v1/namespaces/default/secrets"],
        ["MATCHING RULES", "none"],
        ["MODEL", "allow-only · union of bindings · default deny"],
        ["RESULT", "403 Forbidden"],
      ],
      view: "cluster",
      focus: ["api", "node1"],
      events: [
        ev({
          id: "rb11", at: 600, src: POD, dst: API, layer: "api", size: "0.2 KB", title: "ASK FOR SECRETS", path: ["node1", "api"],
          says: "The same Pod, the same token, asks for Secrets this time.",
          info: "GET /api/v1/namespaces/default/secrets",
          decoded: [sec("HTTP/2 REQUEST", [["method", "GET"], ["path", "/api/v1/namespaces/default/secrets"], ["authorization", "Bearer eyJhbGciOi… (same token)"]])],
        }),
        ev({
          id: "rb12", at: 601, src: API, dst: API, layer: "api", size: " - ", title: "NO RULE MATCHES", path: ["api", "api"],
          says: "Authn passes again; authz finds no rule that grants secrets to this subject.",
          info: "authz: no binding grants list secrets → deny",
          decoded: [sec("RBAC EVALUATION", [["subject", "system:serviceaccount:default:report-runner"], ["union of bindings", "get list watch × deployments - nothing for secrets"], ["deny rules", "don't exist - there is nothing to check", true], ["decision", "deny (the default)", true]])],
          note: "RBAC has no order and no priorities: every matching binding adds to the union, and only the union is consulted. If nothing matches, the answer is no.",
        }),
        ev({
          id: "rb13", at: 610, src: API, dst: POD, layer: "drop", size: "0.4 KB", title: "403 FORBIDDEN", path: ["api", "node1"],
          says: "The answer is 403, with the exact reason in the body.",
          info: "403 Forbidden · User \"…report-runner\" cannot list resource \"secrets\"",
          decoded: [sec("HTTP/2 RESPONSE", [["status", "403 Forbidden", true], ["reason", "Forbidden"], ["message", "…cannot list resource \"secrets\" in API group \"\" in the namespace \"default\""]])],
        }),
      ],
    },
    {
      title: "HYGIENE",
      subtitle: "mount less, bind tight",
      body: "Two habits close the holes. First, automountServiceAccountToken: false on any Pod that doesn't call the API - the token file then isn't even created, so a compromised container has nothing to steal. Second, one ServiceAccount per app with a narrow Role: the namespace's default account is mounted by every Pod that says nothing, so whatever it can do, every hacked Pod can do. The same bindings work for people - User and Group subjects bind identically - and kubectl --as lets you impersonate an identity to preview exactly what it may do.",
      facts: [
        ["AUTOMOUNT", "false unless the Pod needs the API"],
        ["ONE SA PER APP", "never share the namespace default"],
        ["SUBJECTS", "User · Group · ServiceAccount"],
        ["PREVIEW", "kubectl auth can-i --as (impersonation)"],
      ],
      view: "cluster",
      focus: ["you", "api"],
      events: [
        ev({
          id: "rb14", at: 700, src: "kubectl", dst: API, layer: "api", size: "0.3 KB", title: "TURN OFF THE FAUCET", path: ["you", "api"],
          says: "The web Pods never call the API, so their template turns automount off.",
          info: "PATCH …/deployments/web  template: automountServiceAccountToken=false",
          decoded: [sec("POD TEMPLATE", [["automountServiceAccountToken", "false", true], ["effect", "no TokenRequest, no file at /var/run/secrets/kubernetes.io/serviceaccount"], ["applies to", "most Pods - they never talk to the API"]])],
        }),
        ev({
          id: "rb15", at: 780, src: "kubectl", dst: API, layer: "api", size: "0.3 KB", title: "PREVIEW WITH --AS", path: ["you", "api"],
          says: "Impersonation answers \"what could this identity do?\" without its credentials.",
          info: "kubectl --as=system:serviceaccount:default:report-runner auth can-i --list",
          decoded: [sec("IMPERSONATION", [["header", "Impersonate-User: system:serviceaccount:default:report-runner", true], ["authn", "still you - your client certificate"], ["authz 1", "you may impersonate"], ["authz 2", "then the target's bindings decide"]])],
          note: "Two authorization checks: yours to impersonate, then theirs for the request. kubectl auth can-i --as is how you preview a Role before shipping it.",
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "objects → etcd", layer: "api", start: 0, duration: 8 },
    { value: "t2", label: "kubelet mints + projects the token", layer: "node", start: 60, duration: 400 },
    { value: "t3", label: "app reads + sends the JWT", layer: "node", start: 500, duration: 30 },
    { value: "t4", label: "authn → authz → list", layer: "api", start: 530, duration: 25 },
    { value: "t5", label: "secrets → 403", layer: "drop", start: 600, duration: 10 },
    { value: "t6", label: "harden + impersonate", layer: "api", start: 700, duration: 90 },
  ],
  summary: {
    title: "PROVEN AND CHECKED",
    body: "Identity and permission only meet at request time. The Pod's whole identity is a JWT the kubelet mints, projects and refreshes - it expires, and it is bound to one Pod. The API server verifies it, then asks RBAC whether the union of the subject's bindings grants this verb on this resource; when no rule matches, the default deny answers 403. RBAC never looks inside the object, though. What a Deployment may contain is a separate question, asked at a later stop on the same road.",
    facts: [
      ["IDENTITY", "projected JWT · 3607 s · refreshed at 80 %"],
      ["AUTHZ", "allow-only · union of bindings · default deny"],
      ["NEXT", "Kyverno policies"],
    ],
  },
}
