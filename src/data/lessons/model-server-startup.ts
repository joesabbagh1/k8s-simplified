import type { Lesson } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const SCHED = "kube-scheduler"
const KCM = "kube-controller-manager"
const KUBELET = "kubelet · node-2"
const CONTAINERD = "containerd · node-2"
const VLLM = "vllm"
const REGISTRY = "docker.io"
const HF = "huggingface.co"
const CACHE = "model-cache"
const GPU = "NVIDIA L4"
const POD = "llm-…-7xq2n"
const POD2 = "llm-…-b4kfp"
const MODEL = "meta-llama/Llama-3.1-8B-Instruct"

export const modelServerStartup: Lesson = {
  id: "model-server-startup",
  title: "Starting a model server",
  subtitle: "Big images, slow loads, startup probes",
  category: "app",
  seo: {
    title: "Why model servers start slowly in Kubernetes",
    description: "A vLLM Pod on a GPU node: a 9 GB image, 16 GB of weights, the load into VRAM, a liveness probe that kills it, and the startup probe that lets it finish.",
  },
  actors: ["you", "cp", "node1", "node2"],
  extras: ["gp.registry", "gp.hf", "gp.cache"],
  opens: { node2: "gpu" },
  pods: { node1: ["other", "v1", "v1"], node2: ["other", "v1", "other"] },
  lanes: {
    kubectl: "you",
    [API]: "control plane", [SCHED]: "control plane", [KCM]: "control plane",
    [KUBELET]: "kubelet", [CONTAINERD]: "containerd",
    [REGISTRY]: "registry",
    [VLLM]: "vLLM Pod",
    [HF]: "Hugging Face",
    [CACHE]: "model-cache",
    [GPU]: "GPU",
  },
  overview: {
    body: "A model server is an ordinary Deployment with unusual numbers. vLLM serves Llama 3.1 8B on node-2's L4: its image is about 9 GB, the model's weights are 16 GB more, and both have to arrive before the weights are loaded into the GPU's memory. That takes minutes, and a liveness probe written for a web app kills the server before it ever answers. Follow the first start, the restarts that never finish, and the startup probe that fixes it.",
    facts: [
      ["SERVER", "vLLM · OpenAI-compatible API on :8000"],
      ["MODEL", "Llama 3.1 8B Instruct · BF16 · 16 GB"],
      ["GPU", "NVIDIA L4 · 24 GB · on node-2"],
      ["FIRST START", "≈ 7 min of pull, download and load"],
    ],
  },
  steps: [
    {
      title: "THE SPEC",
      subtitle: "one GPU, a cache, and a probe",
      body: "You apply a Deployment llm running vllm serve with Llama 3.1 8B. It asks for nvidia.com/gpu: 1 and tolerates node-2's GPU taint, as in A Pod asks for a GPU. A Secret holds the Hugging Face token the model needs. A PersistentVolumeClaim is mounted at /root/.cache/huggingface for the weights. The strategy is Recreate: with one GPU, a new Pod can't start until the old one lets go of it. And there's a liveness probe on /health, copied from a web app: 30 seconds' delay, three failures.",
      facts: [
        ["IMAGE", "vllm/vllm-openai:latest"],
        ["ARGS", `--model ${MODEL} --max-model-len 16384`],
        ["STRATEGY", "Recreate · one GPU"],
        ["LIVENESS", "GET /health :8000 · delay 30 s · 3 × 10 s"],
      ],
      view: "cluster",
      focus: ["you", "api", "sched", "node2"],
      events: [
        ev({
          id: "ms1", at: 0, src: "kubectl", dst: API, layer: "api", size: "2.6 KB", title: "APPLY THE DEPLOYMENT", path: ["you", "api"],
          says: "You create the llm Deployment: vLLM, one GPU, a weights cache and a liveness probe.",
          info: "POST /apis/apps/v1/namespaces/default/deployments  llm",
          decoded: [
            sec("CONTAINER", [["image", "vllm/vllm-openai:latest"], ["args", `--model ${MODEL} --max-model-len 16384`], ["ports", "8000 · the OpenAI-compatible API"], ["env HF_TOKEN", "from Secret hf-token · the model is gated"]]),
            sec("RESOURCES AND VOLUMES", [["limits", "nvidia.com/gpu: 1 · memory 24Gi", true], ["/root/.cache/huggingface", "PVC model-cache · 50Gi"], ["/dev/shm", "emptyDir · medium Memory"]]),
            sec("PROBES", [["livenessProbe", "GET /health :8000 · initialDelaySeconds 30 · periodSeconds 10 · failureThreshold 3", true], ["startupProbe", "none"]]),
          ],
        }),
        ev({
          id: "ms2", at: 400, src: SCHED, dst: API, layer: "api", size: "0.3 KB", title: "BIND TO NODE-2", path: ["sched", "api"],
          says: "Only node-2 has a GPU, so the scheduler binds the Pod there.",
          info: `POST …/pods/${POD}/binding  target node-2`,
          pods: { node2: ["other", "v1", "other", "starting"] },
          decoded: [sec("FILTER", [["node-1", "Insufficient nvidia.com/gpu"], ["node-2", "1 GPU free · taint tolerated ✓", true]])],
        }),
      ],
    },
    {
      title: "A HUGE PULL",
      subtitle: "9 GB before anything runs",
      body: "Inside node-2, the kubelet allocates the GPU and asks containerd for the image. node-2 has never run vLLM, so containerd downloads every layer: CUDA libraries, PyTorch, vLLM itself, about 9 GB compressed. At 60 MB/s that's two and a half minutes, and unpacking the layers adds another. The probes haven't started; the container doesn't exist yet. On a node that already has the image, this step takes seconds, as in Image pull.",
      facts: [
        ["IMAGE", "≈ 9 GB compressed · CUDA, PyTorch, vLLM"],
        ["DOWNLOAD", "≈ 150 s at 60 MB/s"],
        ["UNPACK", "≈ 60 s"],
        ["NEXT TIME", "already on node-2 · seconds"],
      ],
      view: "gpu",
      focus: ["gp.kubelet", "gp.containerd", "gp.registry"],
      events: [
        ev({
          id: "ms3", at: 600, src: KUBELET, dst: CONTAINERD, layer: "node", size: "0.4 KB", title: "PULL THE IMAGE", path: ["gp.kubelet", "gp.containerd"],
          says: "The GPU is allocated. The kubelet asks containerd for the vLLM image.",
          info: "ImageService/PullImage  vllm/vllm-openai:latest",
          decoded: [sec("PULLIMAGE", [["image", "docker.io/vllm/vllm-openai:latest"], ["on node-2", "no layers yet", true]])],
        }),
        ev({
          id: "ms4", at: 1000, src: CONTAINERD, dst: REGISTRY, layer: "net", size: "9.3 GB", title: "DOWNLOAD THE LAYERS", path: ["gp.containerd", "gp.registry"],
          says: "containerd downloads the image's layers: about 9 GB.",
          info: "GET /v2/vllm/vllm-openai/blobs/sha256:… × 31",
          decoded: [sec("LAYERS", [["count", "31"], ["largest", "CUDA and PyTorch libraries · several GB each", true], ["total", "≈ 9.3 GB compressed"], ["rate", "≈ 60 MB/s"]])],
        }),
        ev({
          id: "ms5", at: 211000, src: CONTAINERD, dst: KUBELET, layer: "node", size: " - ", title: "PULLED", path: ["gp.containerd", "gp.kubelet"],
          says: "Downloaded and unpacked, 3 minutes 30 seconds later.",
          info: "Successfully pulled image \"vllm/vllm-openai:latest\" in 3m30s",
          decoded: [sec("PULL", [["download", "≈ 2 min 35 s"], ["unpack", "≈ 55 s"], ["disk", "≈ 20 GB once unpacked", true]])],
          note: "Large GPU images are a good reason to pre-pull on GPU nodes: a DaemonSet that runs the image, or a node image built with it already inside.",
        }),
      ],
    },
    {
      title: "KILLED WHILE LOADING",
      subtitle: "a web app's liveness probe",
      body: "vLLM starts and begins downloading 16 GB of weights from Hugging Face. Its HTTP server doesn't exist yet: vLLM starts it only once the model is loaded. Thirty seconds in, the kubelet's liveness probe gets connection refused, then twice more, ten seconds apart. Three failures: the kubelet kills the container and starts it again. The new one starts the same long load, and is killed at the same point. After a few rounds the Pod shows CrashLoopBackOff and the waits between restarts grow.",
      facts: [
        ["PROBE", "GET /health → connection refused"],
        ["KILLED AT", "≈ 50 s · 30 s delay + 2 more failures"],
        ["NEEDED", "≈ 4 min to answer /health"],
        ["STATUS", "CrashLoopBackOff · back-off 10 s, 20 s, 40 s …"],
      ],
      view: "gpu",
      focus: ["gp.kubelet", "gp.llm", "gp.hf", "gp.cache"],
      events: [
        ev({
          id: "ms6", at: 212000, src: VLLM, dst: HF, layer: "net", size: "16 GB", title: "DOWNLOAD THE WEIGHTS", path: ["gp.llm", "gp.hf"],
          says: "vLLM starts and begins downloading the model's weights into its cache directory.",
          info: `GET https://huggingface.co/${MODEL}/resolve/main/model-00001-of-00004.safetensors`,
          decoded: [sec("WEIGHTS", [["files", "model-00001…00004-of-00004.safetensors"], ["total", "≈ 16 GB · 8 billion parameters × 2 bytes", true], ["to", "/root/.cache/huggingface · the PVC"], ["HTTP server", "not started yet"]])],
        }),
        ev({
          id: "ms7", at: 242000, src: KUBELET, dst: VLLM, layer: "drop", size: " - ", title: "LIVENESS FAILS", path: ["gp.kubelet", "gp.llm"],
          says: "Thirty seconds after the start, the liveness probe finds nothing listening on :8000.",
          info: "GET http://10.244.2.31:8000/health → connect: connection refused",
          decoded: [sec("LIVENESS", [["at", "30 s · initialDelaySeconds"], ["result", "connection refused", true], ["failures", "1 of 3"], ["weights so far", "≈ 3 GB of 16"]])],
        }),
        ev({
          id: "ms8", at: 262000, src: KUBELET, dst: VLLM, layer: "drop", size: " - ", title: "KILLED", path: ["gp.kubelet", "gp.llm"],
          says: "The third failure in a row: the kubelet kills vLLM and starts the container again.",
          info: "Liveness probe failed · Container vllm failed liveness probe, will be restarted",
          decoded: [sec("RESTART", [["failures", "3 of 3", true], ["signal", "SIGTERM, then SIGKILL after the grace period"], ["restartCount", "1"], ["weights", "≈ 5 GB downloaded · the rest left for next time"]])],
        }),
        ev({
          id: "ms9", at: 560000, src: KUBELET, dst: API, layer: "drop", size: "1.1 KB", title: "CRASHLOOPBACKOFF", path: ["gp.kubelet", "gp.api"],
          says: "The same thing, every time. The kubelet waits longer before each restart.",
          info: `Pod ${POD}  Waiting: CrashLoopBackOff · restartCount 4`,
          decoded: [sec("STATUS", [["reason", "CrashLoopBackOff", true], ["restartCount", "4"], ["back-off", "10 s → 20 s → 40 s → 80 s · up to 5 min"], ["Ready", "never"]])],
          note: "The download resumes on each attempt, because the partial files are on the PVC. Without the PVC each attempt would start the 16 GB from zero, and the Pod would never get further.",
        }),
      ],
    },
    {
      title: "THE STARTUP PROBE",
      subtitle: "time to start, then the other probes",
      body: "The fix is a startup probe. While a container has one that hasn't succeeded yet, the kubelet doesn't run its liveness or readiness probes at all. This one checks /health every 10 seconds and allows 60 failures, so vLLM has up to 10 minutes to start. Once it succeeds, the liveness probe takes over and can be as strict as before. You change the Deployment; Recreate deletes the crashing Pod, which frees the GPU, and the new Pod starts on node-2 with the image already there.",
      facts: [
        ["STARTUP PROBE", "GET /health · every 10 s · failureThreshold 60"],
        ["ALLOWS", "60 × 10 s = 10 min to start"],
        ["MEANWHILE", "no liveness, no readiness"],
        ["AFTER IT SUCCEEDS", "liveness as before · readiness every 5 s"],
      ],
      view: "cluster",
      focus: ["you", "api", "kcm", "node2"],
      events: [
        ev({
          id: "ms10", at: 600000, src: "kubectl", dst: API, layer: "api", size: "0.5 KB", title: "ADD A STARTUP PROBE", path: ["you", "api"],
          says: "You add a startup probe and a readiness probe to the Deployment.",
          info: "kubectl apply -f llm.yaml  (startupProbe, readinessProbe added)",
          decoded: [sec("PROBES", [["startupProbe", "GET /health :8000 · periodSeconds 10 · failureThreshold 60", true], ["readinessProbe", "GET /health :8000 · periodSeconds 5"], ["livenessProbe", "unchanged · only runs after startup succeeds"]])],
        }),
        ev({
          id: "ms11", at: 600300, src: KCM, dst: API, layer: "control", size: "0.4 KB", title: "RECREATE", path: ["kcm", "api"],
          says: "Recreate scales the old ReplicaSet to zero first, which frees the GPU, then creates the new Pod.",
          info: `DELETE …/pods/${POD} · POST …/pods ${POD2}`,
          pods: { node2: ["other", "v1", "other", "starting"] },
          decoded: [sec("WHY RECREATE", [["RollingUpdate", "would start the new Pod first · Pending: Insufficient nvidia.com/gpu"], ["Recreate", "old Pods gone, then new ones", true], ["the cost", "no Pod at all while it restarts"]])],
        }),
      ],
    },
    {
      title: "WEIGHTS",
      subtitle: "from the internet, or from the cache",
      body: "The new container starts in seconds, since node-2 already has the image. vLLM finds the weights partly downloaded on the PVC and fetches the rest from Hugging Face. Meanwhile the startup probe fails quietly every 10 seconds, and nothing kills the container. The download is the step a cache changes most: from now on the weights are on the PVC, and any later start reads 16 GB from disk instead of the internet.",
      facts: [
        ["IMAGE", "already on node-2 · starts in 2 s"],
        ["THIS START", "the remaining ≈ 9 GB from Hugging Face"],
        ["LATER STARTS", "16 GB from the PVC"],
        ["STARTUP PROBE", "failing, and allowed to · 60 tries"],
      ],
      view: "gpu",
      focus: ["gp.kubelet", "gp.llm", "gp.hf", "gp.cache"],
      events: [
        ev({
          id: "ms12", at: 603000, src: VLLM, dst: HF, layer: "net", size: "9 GB", title: "FINISH THE DOWNLOAD", path: ["gp.llm", "gp.hf"],
          says: "vLLM resumes the download where the last attempt stopped.",
          info: "GET …/model-00002-of-00004.safetensors  Range: bytes=…",
          decoded: [sec("DOWNLOAD", [["already on the PVC", "≈ 7 GB from earlier attempts"], ["remaining", "≈ 9 GB · ≈ 90 s at 100 MB/s", true]])],
        }),
        ev({
          id: "ms13", at: 633000, src: KUBELET, dst: VLLM, layer: "control", size: " - ", title: "STARTUP PROBE: NOT YET", path: ["gp.kubelet", "gp.llm"],
          says: "The startup probe fails, as expected. Unlike the liveness probe, it has 60 tries.",
          info: "GET /health → connection refused · startup 3 of 60",
          decoded: [sec("STARTUP PROBE", [["result", "connection refused"], ["failures", "3 of 60", true], ["liveness · readiness", "not running yet"]])],
        }),
        ev({
          id: "ms14", at: 693000, src: VLLM, dst: CACHE, layer: "state", size: "16 GB", title: "ALL ON THE CACHE", path: ["gp.llm", "gp.cache"],
          says: "All four files are on the PVC. Every later start can skip the internet.",
          info: "/root/.cache/huggingface/hub/models--meta-llama--Llama-3.1-8B-Instruct/",
          decoded: [sec("CACHE", [["files", "4 × safetensors · config · tokenizer"], ["size", "≈ 16 GB", true], ["later starts", "read from disk · ≈ 30 s at 500 MB/s"]])],
        }),
      ],
    },
    {
      title: "INTO VRAM",
      subtitle: "weights, KV cache, CUDA graphs",
      body: "vLLM loads the 16 GB of weights into the L4's memory. Then it measures what's left and reserves most of it for the KV cache, which holds the attention state of every request in progress: its --gpu-memory-utilization flag says what fraction of the card it may use in all. It captures CUDA graphs for common batch sizes, so later steps launch faster. Only then does its HTTP server start. The next startup probe gets 200, readiness passes, and the Pod joins the Service's endpoints.",
      facts: [
        ["WEIGHTS", "16 GB in VRAM · ≈ 25 s"],
        ["KV CACHE", "most of what's left · ≈ 5 GB"],
        ["CUDA GRAPHS", "captured at start · --enforce-eager skips them"],
        ["READY", "≈ 3 min after this Pod started"],
      ],
      view: "gpu",
      focus: ["gp.kubelet", "gp.llm", "gp.gpu", "gp.api"],
      events: [
        ev({
          id: "ms15", at: 718000, src: VLLM, dst: GPU, layer: "node", size: "16 GB", title: "LOAD THE WEIGHTS", path: ["gp.llm", "gp.gpu"],
          says: "vLLM copies the weights from the PVC into the GPU's memory.",
          info: "Loading weights took 24.8 s · model weights 15.0 GiB",
          decoded: [sec("VRAM", [["card", "24 GB"], ["weights", "15.0 GiB", true], ["left", "≈ 7 GiB · for KV cache, activations, graphs"]])],
        }),
        ev({
          id: "ms16", at: 735000, src: VLLM, dst: GPU, layer: "node", size: " - ", title: "KV CACHE AND CUDA GRAPHS", path: ["gp.llm", "gp.gpu"],
          says: "It reserves the KV cache from what's left and captures CUDA graphs.",
          info: "KV cache: ≈ 40,000 tokens · capturing CUDA graphs",
          decoded: [
            sec("KV CACHE", [["per token", "128 KiB · 32 layers × 8 KV heads × 128 × 2 (K, V) × 2 bytes"], ["fits", "≈ 40,000 tokens", true], ["--max-model-len 16384", "≤ 40,000 · fits"]]),
            sec("WITHOUT --MAX-MODEL-LEN", [["default", "131,072 · Llama 3.1's full context"], ["vLLM", "refuses to start: the max seq len is larger than the KV cache can hold"]]),
          ],
          note: "--gpu-memory-utilization sets the share of the card vLLM may fill, weights included. Lowering it leaves room for something else on the GPU, at the cost of KV cache.",
        }),
        ev({
          id: "ms17", at: 783000, src: KUBELET, dst: VLLM, layer: "control", size: "0.1 KB", title: "200 OK", path: ["gp.kubelet", "gp.llm"],
          says: "The HTTP server is up. The startup probe gets 200, and the readiness probe starts.",
          info: "GET /health → 200 · startup probe succeeded",
          decoded: [sec("PROBES", [["startup", "succeeded at 18 of 60", true], ["readiness", "starts · every 5 s"], ["liveness", "starts · delay 30 s, 3 × 10 s"]])],
        }),
        ev({
          id: "ms18", at: 788000, src: KUBELET, dst: API, layer: "api", size: "1.3 KB", title: "READY", path: ["gp.kubelet", "gp.api"],
          says: "Readiness passes. The Pod is Ready and the Service starts sending it requests.",
          info: `PATCH …/pods/${POD2}/status  Ready=True`,
          pods: { node2: ["other", "v1", "other", "v2"] },
          decoded: [sec("STATUS", [["Ready", "True", true], ["EndpointSlice", "10.244.2.33:8000 added to llm"], ["this Pod", "≈ 3 min from container start · weights partly cached"]])],
        }),
      ],
    },
    {
      title: "WHERE THE TIME GOES",
      subtitle: "and what each fix buys",
      body: "Add up a cold start on a fresh GPU node: the node itself, a minute or more if an autoscaler has to make it, as in A node joins the cluster; three and a half minutes of image pull; nearly three minutes of weights; and about a minute to load and prepare. Each part has a fix. Pre-pull the image on GPU nodes. Keep the weights on a volume or in object storage near the cluster. Keep one replica warm. Scaling a model server to zero, as in Scale to zero with KEDA, means the first request after a quiet spell pays the rest.",
      facts: [
        ["NEW NODE", "≈ 1–2 min · if one has to be made"],
        ["IMAGE", "3 min 30 s · or seconds if pre-pulled"],
        ["WEIGHTS", "≈ 3 min from the internet · ≈ 30 s from a PVC"],
        ["LOAD", "≈ 1 min · weights, KV cache, CUDA graphs"],
      ],
      view: "gpu",
      focus: ["gp.containerd", "gp.registry", "gp.llm", "gp.hf", "gp.cache", "gp.gpu"],
      events: [
        ev({
          id: "ms19", at: 4000000, src: VLLM, dst: CACHE, layer: "state", size: "16 GB", title: "A WARM RESTART", path: ["gp.llm", "gp.cache"],
          says: "An hour later the Pod restarts. Image and weights are on node-2 now, so it's Ready in about a minute and a half.",
          info: "image present · weights from /root/.cache/huggingface",
          decoded: [
            sec("COLD, THE FIRST TIME", [["image pull", "3 min 30 s"], ["weights", "≈ 3 min"], ["load and prepare", "≈ 1 min"], ["total", "≈ 7 min 30 s", true]]),
            sec("WARM, NOW", [["image pull", "0 · already on node-2"], ["weights", "≈ 30 s from the PVC"], ["load and prepare", "≈ 1 min"], ["total", "≈ 1 min 30 s", true]]),
          ],
          note: "The startup probe's 10 minutes is sized for the worst case on this node. Sizing it too tight brings back the crash loop; too loose only means a truly stuck server is noticed later.",
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "schedule", layer: "control", start: 0, duration: 400 },
    { value: "t2", label: "image pull", layer: "net", start: 600, duration: 210400 },
    { value: "t3", label: "killed by liveness, again and again", layer: "drop", start: 212000, duration: 388000 },
    { value: "t4", label: "weights download", layer: "net", start: 603000, duration: 90000 },
    { value: "t5", label: "load, KV cache, CUDA graphs", layer: "node", start: 693000, duration: 90000 },
    { value: "t6", label: "Ready", layer: "api", start: 783000, duration: 5000 },
  ],
  timingNote: "Times from one illustrative run. Pull and download times depend on bandwidth, and load times on the model, the GPU and the vLLM version.",
  summary: {
    title: "SLOW TO START IS NOT DEAD",
    body: "A model server is slow to start for honest reasons: a big image, bigger weights, and a load into GPU memory, in that order, before its HTTP server exists. A liveness probe can't tell slow from stuck, so it kills a server that was making progress. A startup probe gives the start its own budget and holds the other probes back until it's over. Then each part of the wait has its own fix: pre-pulled images, cached weights, a warm replica.",
    facts: [
      ["THE TRAP", "liveness during a 4-minute start → CrashLoopBackOff"],
      ["THE FIX", "startupProbe · failureThreshold × periodSeconds"],
      ["FASTER STARTS", "pre-pull · cache weights · keep one warm"],
      ["NEXT", "ConfigMaps and Secrets"],
    ],
  },
}
