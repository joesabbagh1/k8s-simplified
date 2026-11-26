import type { Lesson } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const KCM = "kube-controller-manager"
const WEBHOOK = "pod-identity-webhook"
const K1 = "kubelet · node-1"
const APP = "uploader"
const STS = "sts.eu-west-1.amazonaws.com"
const ISSUER = "https://kubelearn-oidc.s3.eu-west-1.amazonaws.com"
const ISSUER_HOST = "kubelearn-oidc.s3.eu-west-1.amazonaws.com"
const S3 = "kubelearn-uploads.s3.eu-west-1.amazonaws.com"
const ROLE = "arn:aws:iam::111122223333:role/uploader-s3"
const POD = "uploader-…-w7r4d"
const TOKEN_PATH = "/var/run/secrets/eks.amazonaws.com/serviceaccount/token"

export const podCloudCredentials: Lesson = {
  id: "pod-cloud-credentials",
  title: "A Pod gets AWS credentials",
  subtitle: "Projected tokens and OIDC",
  category: "security",
  seo: {
    title: "How a Kubernetes Pod gets AWS credentials",
    description: "IAM roles for service accounts, step by step: a projected ServiceAccount token, an OIDC issuer, STS AssumeRoleWithWebIdentity and a signed S3 upload.",
  },
  actors: ["you", "cp", "node1", "node2", "oidc", "sts", "s3"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    kubectl: "you", aws: "you",
    [API]: "control plane", [KCM]: "control plane",
    [WEBHOOK]: "webhook",
    [K1]: "node-1",
    [APP]: "uploader Pod",
    [STS]: "AWS STS",
    [ISSUER_HOST]: "OIDC issuer",
    [S3]: "S3",
  },
  overview: {
    body: "The uploader app writes files to an S3 bucket, and nowhere in the cluster is there an AWS access key. Instead the Pod gets a short-lived token from Kubernetes that says which ServiceAccount it runs as, and AWS trades it for temporary credentials, because an IAM role trusts the cluster's token issuer. This is IAM roles for service accounts (IRSA). Follow it from the trust policy to a signed PutObject.",
    facts: [
      ["POD", `${POD} · ServiceAccount shop/uploader`],
      ["ROLE", "uploader-s3 · may write to kubelearn-uploads"],
      ["TOKEN", "projected · audience sts.amazonaws.com · 24 h"],
      ["CREDENTIALS", "temporary · 1 h · nothing stored"],
    ],
  },
  steps: [
    {
      title: "THE TRUST",
      subtitle: "AWS learns to believe the cluster's tokens",
      body: "The API server signs ServiceAccount tokens with its own key, and names itself in them as the issuer "+ISSUER+". For AWS to trust those tokens, that issuer publishes an OpenID Connect discovery document and the public keys, here in an S3 bucket, and you register it in IAM as an identity provider. Then you create the role uploader-s3 with a trust policy: tokens from that provider, for audience sts.amazonaws.com, for the subject system:serviceaccount:shop:uploader. Last, the ServiceAccount gets an annotation naming the role.",
      facts: [
        ["ISSUER", ISSUER],
        ["TRUST", "sub = system:serviceaccount:shop:uploader"],
        ["AUDIENCE", "aud = sts.amazonaws.com"],
        ["ANNOTATION", "eks.amazonaws.com/role-arn"],
      ],
      view: "cluster",
      focus: ["you", "api", "oidc", "sts"],
      events: [
        ev({
          id: "pc1", at: 0, src: "aws", dst: STS, layer: "net", size: "1.4 KB", title: "REGISTER THE ISSUER", path: ["you", "sts"],
          says: "You register the cluster's token issuer with IAM as an OpenID Connect provider.",
          info: `iam:CreateOpenIDConnectProvider  Url=${ISSUER} · ClientIDList=sts.amazonaws.com`,
          decoded: [
            sec("API SERVER FLAGS", [["--service-account-issuer", ISSUER, true], ["--service-account-key-file", "the public key that checks token signatures"], ["--service-account-signing-key-file", "the private key that signs them"]]),
            sec("PUBLISHED AT THE ISSUER", [["/.well-known/openid-configuration", "issuer, jwks_uri, RS256"], ["/keys.json", "the public key, as a JWKS"]]),
          ],
          note: "On EKS all of this exists already: every cluster has an issuer at https://oidc.eks.<region>.amazonaws.com/id/<ID>, and you only register it in IAM.",
        }),
        ev({
          id: "pc2", at: 2000, src: "aws", dst: STS, layer: "net", size: "1.1 KB", title: "A ROLE THAT TRUSTS IT", path: ["you", "sts"],
          says: "You create the role uploader-s3, which only this ServiceAccount's tokens may assume.",
          info: "iam:CreateRole uploader-s3 · AssumeRolePolicyDocument",
          decoded: [
            sec("TRUST POLICY", [["Principal.Federated", `arn:aws:iam::111122223333:oidc-provider/${ISSUER_HOST}`], ["Action", "sts:AssumeRoleWithWebIdentity", true], [`${ISSUER_HOST}:sub`, "system:serviceaccount:shop:uploader", true], [`${ISSUER_HOST}:aud`, "sts.amazonaws.com"]]),
            sec("PERMISSIONS", [["s3:PutObject", "arn:aws:s3:::kubelearn-uploads/*"]]),
          ],
        }),
        ev({
          id: "pc3", at: 4000, src: "kubectl", dst: API, layer: "api", size: "0.3 KB", title: "ANNOTATE THE SERVICEACCOUNT", path: ["you", "api"],
          says: "You annotate the ServiceAccount with the role's ARN.",
          info: `kubectl annotate serviceaccount -n shop uploader eks.amazonaws.com/role-arn=${ROLE}`,
          decoded: [sec("SERVICEACCOUNT SHOP/UPLOADER", [["eks.amazonaws.com/role-arn", ROLE, true], ["read by", "the pod identity webhook, not by Kubernetes"]])],
        }),
      ],
    },
    {
      title: "THE WEBHOOK",
      subtitle: "a volume and three env vars, added on the way in",
      body: "You deploy uploader with serviceAccountName: uploader and nothing about AWS in it. When the ReplicaSet creates the Pod, the API server sends it to the Amazon EKS pod identity webhook, a mutating admission webhook that runs in the cluster. The webhook sees the role annotation on the Pod's ServiceAccount and patches the Pod: a projected volume with a ServiceAccount token for audience sts.amazonaws.com, mounted in every container, and environment variables that tell the AWS SDK where the token and the role are.",
      facts: [
        ["WEBHOOK", "amazon-eks-pod-identity-webhook · mutating"],
        ["VOLUME", "projected serviceAccountToken · aud sts.amazonaws.com"],
        ["ENV", "AWS_ROLE_ARN · AWS_WEB_IDENTITY_TOKEN_FILE"],
        ["IN YOUR MANIFEST", "only serviceAccountName"],
      ],
      view: "cluster",
      focus: ["you", "api", "kcm", "node1"],
      events: [
        ev({
          id: "pc4", at: 60000, src: KCM, dst: API, layer: "control", size: "2.1 KB", title: "A POD FOR UPLOADER", path: ["kcm", "api"],
          says: "The ReplicaSet creates the uploader Pod, with nothing about AWS in it.",
          info: `POST /api/v1/namespaces/shop/pods  ${POD}`,
          decoded: [sec("POD SPEC", [["serviceAccountName", "uploader", true], ["env", "none about AWS"], ["volumes", "none about AWS"]])],
        }),
        ev({
          id: "pc5", at: 60020, src: API, dst: WEBHOOK, layer: "control", size: "3.4 KB", title: "ADMISSIONREVIEW", path: ["api", "node1"],
          says: "The API server sends the Pod to the pod identity webhook, which runs on node-1.",
          info: "POST https://pod-identity-webhook.kube-system.svc:443/mutate",
          decoded: [sec("ADMISSIONREVIEW", [["kind", "Pod"], ["namespace", "shop"], ["serviceAccountName", "uploader"], ["webhook looks up", "the ServiceAccount's role-arn annotation", true]])],
        }),
        ev({
          id: "pc6", at: 60040, src: WEBHOOK, dst: API, layer: "control", size: "1.2 KB", title: "THE PATCH", path: ["node1", "api"],
          says: "The webhook answers with a patch: a token volume and the variables the SDK reads.",
          info: "AdmissionReview response · patchType JSONPatch",
          pods: { node1: ["other", "v1", "starting"] },
          decoded: [
            sec("VOLUME AWS-TOKEN", [["projected.serviceAccountToken.audience", "sts.amazonaws.com", true], ["expirationSeconds", "86400"], ["mounted at", "/var/run/secrets/eks.amazonaws.com/serviceaccount/"]]),
            sec("ENV", [["AWS_ROLE_ARN", ROLE, true], ["AWS_WEB_IDENTITY_TOKEN_FILE", TOKEN_PATH], ["AWS_REGION · AWS_DEFAULT_REGION", "eu-west-1 · with the webhook's region flag"], ["AWS_STS_REGIONAL_ENDPOINTS", "regional"]]),
          ],
        }),
      ],
    },
    {
      title: "THE TOKEN",
      subtitle: "minted for this Pod, refreshed by the kubelet",
      body: "node-1's kubelet sets up the Pod's volumes. For the projected token it calls the TokenRequest API: a token for ServiceAccount uploader, for audience sts.amazonaws.com, valid 24 hours, and bound to this Pod. The API server signs a JWT and the kubelet writes it into the volume. Decoded, it says who issued it, who it's about and who may accept it. It's useless once the Pod is deleted, and the kubelet replaces it well before it expires.",
      facts: [
        ["REQUEST", "TokenRequest · audience sts.amazonaws.com"],
        ["BOUND TO", `Pod ${POD} · its UID`],
        ["VALID", "24 h · refreshed after 80 % of that"],
        ["FILE", TOKEN_PATH],
      ],
      view: "cluster",
      focus: ["api", "node1"],
      events: [
        ev({
          id: "pc7", at: 61000, src: K1, dst: API, layer: "api", size: "0.4 KB", title: "TOKENREQUEST", path: ["node1", "api"],
          says: "The kubelet asks the API server for a token for this Pod, with the audience STS expects.",
          info: "POST /api/v1/namespaces/shop/serviceaccounts/uploader/token",
          decoded: [sec("TOKENREQUEST SPEC", [["audiences", "[sts.amazonaws.com]", true], ["expirationSeconds", "86400"], ["boundObjectRef", `Pod ${POD} · uid 5c1e…`]])],
        }),
        ev({
          id: "pc8", at: 61010, src: API, dst: K1, layer: "api", size: "1.1 KB", title: "A SIGNED JWT", path: ["api", "node1"],
          says: "The API server signs the token. The kubelet writes it into the Pod's volume.",
          info: `${TOKEN_PATH} · eyJhbGciOiJSUzI1NiIs…`,
          decoded: [
            sec("HEADER", [["alg", "RS256"], ["kid", "the key's ID · published in the JWKS"]]),
            sec("CLAIMS", [["iss", ISSUER, true], ["sub", "system:serviceaccount:shop:uploader", true], ["aud", "[sts.amazonaws.com]", true], ["exp", "now + 24 h"], ["kubernetes.io", `namespace shop · pod ${POD} and its uid · serviceaccount uploader and its uid`]]),
          ],
          note: "A token bound to a Pod stops being accepted by the API server once that Pod is gone. STS doesn't ask Kubernetes, though: to AWS the token is good until its exp.",
        }),
      ],
    },
    {
      title: "ASSUME THE ROLE",
      subtitle: "the SDK trades the token",
      body: "uploader starts and creates an S3 client. The AWS SDK looks for credentials in a fixed order, and finds AWS_ROLE_ARN and AWS_WEB_IDENTITY_TOKEN_FILE in the environment. It reads the token file and calls STS AssumeRoleWithWebIdentity over HTTPS, with the role, a session name and the token. The call carries no AWS signature: the token is the proof. The app's own code never sees any of this.",
      facts: [
        ["CALL", "AssumeRoleWithWebIdentity · unsigned"],
        ["ENDPOINT", STS],
        ["SENDS", "RoleArn · RoleSessionName · WebIdentityToken"],
        ["APP CODE", "s3.put_object(…) · nothing about credentials"],
      ],
      view: "cluster",
      focus: ["node1", "sts"],
      events: [
        ev({
          id: "pc9", at: 66000, src: APP, dst: STS, layer: "net", size: "1.6 KB", title: "ASSUMEROLEWITHWEBIDENTITY", path: ["node1", "sts"],
          says: "The SDK sends the token to STS and asks to become uploader-s3.",
          info: `POST https://${STS}/ Action=AssumeRoleWithWebIdentity`,
          decoded: [sec("REQUEST", [["RoleArn", ROLE, true], ["RoleSessionName", "botocore-session-1764140766"], ["WebIdentityToken", "the JWT from the file"], ["DurationSeconds", "default 3600"], ["Authorization", "none · this call isn't signed"]])],
          note: "The credential chain checks environment access keys before web identity. A leftover AWS_ACCESS_KEY_ID in the Pod's env would win and quietly replace the role.",
        }),
      ],
    },
    {
      title: "STS CHECKS",
      subtitle: "signature, issuer, audience, subject",
      body: "STS doesn't call the cluster. It reads the issuer's discovery document and keys, and caches them, then checks the token's signature with the key named in its header. It checks that iss is the registered provider, that aud is one of its client IDs, that the token hasn't expired, and that sub and aud satisfy the role's trust policy. All pass, so STS returns temporary credentials: an access key ID, a secret key and a session token, valid for an hour.",
      facts: [
        ["READS", "/.well-known/openid-configuration · keys.json"],
        ["CHECKS", "signature · iss · aud · exp · trust policy"],
        ["RETURNS", "AccessKeyId ASIA… · SecretAccessKey · SessionToken"],
        ["EXPIRES", "in 1 h · the SDK refreshes before that"],
      ],
      view: "cluster",
      focus: ["sts", "oidc", "node1"],
      events: [
        ev({
          id: "pc10", at: 66040, src: STS, dst: ISSUER_HOST, layer: "net", size: "1.8 KB", title: "FETCH THE KEYS", path: ["sts", "oidc"],
          says: "STS fetches the issuer's discovery document and public keys.",
          info: `GET ${ISSUER}/.well-known/openid-configuration · GET …/keys.json`,
          decoded: [sec("DISCOVERY", [["issuer", ISSUER], ["jwks_uri", `${ISSUER}/keys.json`], ["keys[0].kid", "matches the token's header", true], ["cached", "yes · not fetched for every call"]])],
        }),
        ev({
          id: "pc11", at: 66090, src: STS, dst: STS, layer: "control", size: " - ", title: "CHECK THE TOKEN", path: ["sts", "sts"],
          says: "Signature, issuer, audience, expiry and the trust policy's conditions all pass.",
          info: "RS256 signature valid · trust policy matched",
          decoded: [sec("CHECKS", [["signature", "valid with kid …", true], ["iss", "a registered OIDC provider ✓"], ["aud", "sts.amazonaws.com · in ClientIDList ✓"], ["exp", "in the future ✓"], ["sub", "system:serviceaccount:shop:uploader · as the trust policy says ✓", true]])],
          note: "A token for any other ServiceAccount, or one minted for the Kubernetes API's own audience, fails here with InvalidIdentityToken or AccessDenied.",
        }),
        ev({
          id: "pc12", at: 66120, src: STS, dst: APP, layer: "net", size: "1.9 KB", title: "TEMPORARY CREDENTIALS", path: ["sts", "node1"],
          says: "STS returns credentials for uploader-s3, valid for one hour.",
          info: "AssumeRoleWithWebIdentityResponse · Credentials",
          decoded: [
            sec("CREDENTIALS", [["AccessKeyId", "ASIAQ3EXAMPLE7KZ2W4M · ASIA = temporary", true], ["SecretAccessKey", "…"], ["SessionToken", "… · required with these keys"], ["Expiration", "now + 1 h"]]),
            sec("ALSO", [["SubjectFromWebIdentityToken", "system:serviceaccount:shop:uploader"], ["AssumedRoleUser", "assumed-role/uploader-s3/botocore-session-1764140766"]]),
          ],
        }),
      ],
    },
    {
      title: "THE CALL",
      subtitle: "a signed PutObject",
      body: "The SDK signs the upload with the temporary secret key, using AWS Signature Version 4, and sends the session token with it. S3 checks the signature and asks IAM whether the assumed role may put objects in kubelearn-uploads. It may. CloudTrail records the role session behind the call, so an audit can trace an upload back to the ServiceAccount. Before the hour is up, the SDK calls STS again with the token file, which the kubelet keeps fresh.",
      facts: [
        ["REQUEST", "PUT /orders/8812.pdf · kubelearn-uploads"],
        ["SIGNED WITH", "SigV4 · the temporary secret key"],
        ["ALLOWED BY", "uploader-s3's permissions policy"],
        ["AUDIT", "CloudTrail · the role session name"],
      ],
      view: "cluster",
      focus: ["node1", "s3", "sts"],
      events: [
        ev({
          id: "pc13", at: 66300, src: APP, dst: S3, layer: "net", size: "184 KB", title: "PUTOBJECT", path: ["node1", "s3"],
          says: "The SDK uploads the file, signed with the temporary credentials.",
          info: `PUT https://${S3}/orders/8812.pdf`,
          decoded: [sec("HEADERS", [["Authorization", "AWS4-HMAC-SHA256 Credential=ASIAQ3EXAMPLE7KZ2W4M/…/eu-west-1/s3/aws4_request …", true], ["X-Amz-Security-Token", "the SessionToken"], ["X-Amz-Date", "now · signatures expire"]])],
        }),
        ev({
          id: "pc14", at: 66380, src: S3, dst: APP, layer: "net", size: "0.3 KB", title: "200 OK", path: ["s3", "node1"],
          says: "S3 checks the signature and the role's permissions, and stores the file.",
          info: "200 OK · ETag \"9b2cf535f27731c974343645a3985328\"",
          decoded: [sec("AUTHORIZED AS", [["principal", "assumed-role/uploader-s3/botocore-session-1764140766", true], ["action", "s3:PutObject · allowed"]]), sec("CLOUDTRAIL", [["userIdentity.type", "AssumedRole"], ["sessionIssuer", "role uploader-s3"]])],
        }),
      ],
    },
    {
      title: "THE ALTERNATIVES",
      subtitle: "and why not an access key",
      body: "EKS also offers Pod Identity, which drops the OIDC part: an agent DaemonSet on each node answers credential requests on a link-local address, and roles are linked to ServiceAccounts through the EKS API rather than trust policies naming an issuer. Google Cloud's Workload Identity Federation for GKE and Azure's Workload ID work on the same idea. Compared with an access key in a Secret, every one of them leaves nothing long-lived to leak, rotate or forget.",
      facts: [
        ["EKS POD IDENTITY", "agent on 169.254.170.23 · no OIDC provider"],
        ["GKE", "Workload Identity Federation"],
        ["ACCESS KEY IN A SECRET", "lives until someone rotates it"],
        ["THIS WAY", "a 24 h token, 1 h credentials, both renewed"],
      ],
      view: "cluster",
      focus: ["api", "node1", "sts", "s3"],
      events: [
        ev({
          id: "pc15", at: 3666000, src: APP, dst: STS, layer: "net", size: "1.6 KB", title: "AN HOUR LATER", path: ["node1", "sts"],
          says: "An hour later the SDK repeats the exchange with the current token. Nothing was ever stored.",
          info: "AssumeRoleWithWebIdentity · new credentials",
          decoded: [
            sec("RENEWED", [["token", "rewritten by the kubelet after ≈ 19 h"], ["credentials", "renewed by the SDK before each expiry", true]]),
            sec("EKS POD IDENTITY", [["agent", "a DaemonSet · 169.254.170.23"], ["role link", "a pod identity association · trust principal pods.eks.amazonaws.com"], ["OIDC provider", "not needed"]]),
            sec("AN ACCESS KEY IN A SECRET", [["lifetime", "until someone rotates it"], ["readable by", "anyone who can read the Secret, or exec into the Pod"]]),
          ],
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "trust set up", layer: "net", start: 0, duration: 4000 },
    { value: "t2", label: "webhook patches the Pod", layer: "control", start: 60000, duration: 40 },
    { value: "t3", label: "TokenRequest", layer: "api", start: 61000, duration: 10 },
    { value: "t4", label: "AssumeRoleWithWebIdentity", layer: "net", start: 66000, duration: 120 },
    { value: "t5", label: "PutObject", layer: "net", start: 66300, duration: 80 },
  ],
  timingNote: "Times from one illustrative run. STS caches the issuer's keys, so most calls skip that fetch.",
  summary: {
    title: "A TOKEN FOR A ROLE",
    body: "Nothing in the Pod holds an AWS key. The API server signs a short-lived token that names the Pod's ServiceAccount and is meant for STS, the kubelet keeps it fresh, and a webhook tells the SDK where to find it. AWS trusts it because the cluster's issuer publishes its public keys and an IAM role names exactly which subject may assume it. The credentials that come back last an hour, and the whole exchange repeats on its own.",
    facts: [
      ["IDENTITY", "projected ServiceAccount token · aud sts.amazonaws.com"],
      ["TRUST", "IAM OIDC provider · role trust policy on sub"],
      ["CREDENTIALS", "STS AssumeRoleWithWebIdentity · 1 h"],
      ["NEXT", "Kyverno policies"],
    ],
  },
}
