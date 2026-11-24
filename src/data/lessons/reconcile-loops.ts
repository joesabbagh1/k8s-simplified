import type { Lesson } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const RS = "web-6f7c9d8b4"
const DEAD = "web-…-p8m4z"
const NEW = "web-…-t4c8e"

export const reconcileLoops: Lesson = {
  id: "reconcile-loops",
  title: "Reconcile loops",
  subtitle: "Desired vs. actual state",
  category: "control",
  seo: {
    title: "Kubernetes reconcile loops, explained",
    description: "Delete a Pod and watch the ReplicaSet controller put it back: how Kubernetes compares desired with actual state, and what level-triggered means.",
  },
  actors: ["you", "cp", "node1", "node2"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: { "kubelet · node-2": "kubelet", "kubelet · node-1": "kubelet" },
  overview: {
    body: "Delete a Pod by hand and watch the ReplicaSet controller put it back. Underneath that party trick is the pattern the whole control plane runs on: watch the world, diff desired against actual, act, report. It's level-triggered - reacting to state, not events - which is why it survives crashes and works whether the change came from you, a bug, or a dead node.",
    facts: [
      ["COMMAND", `kubectl delete pod ${DEAD}`],
      ["OWNER", `ReplicaSet ${RS} · wants 3`],
      ["PATTERN", "watch → diff → act → report"],
      ["TRIGGER", "level-triggered, not edge-triggered"],
    ],
  },
  steps: [
    {
      title: "THE PATTERN",
      subtitle: "every controller, same shape",
      body: "Pick any controller - ReplicaSet, Deployment, EndpointSlice, node lifecycle - and you'll find the same four-beat loop. Watch: the informer cache holds the world. Diff: desired state from spec, actual from status and live Pods. Act: POST, PATCH or DELETE until actual matches desired. Report: write status back for humans and other controllers. Then sleep until the world changes.",
      facts: [
        ["1 · WATCH", "informer cache of everything relevant"],
        ["2 · DIFF", "spec (want) vs. reality (have)"],
        ["3 · ACT", "create/delete until equal"],
        ["4 · REPORT", "status subresource"],
      ],
      view: "cluster",
      focus: ["api", "kcm"],
      events: [
        ev({
          id: "rc1", at: 0, src: "replicaset ctrl", dst: "replicaset ctrl", layer: "control", size: " - ", title: "AT REST", path: ["kcm", "kcm"],
          says: "Right now the loop is idle: desired 3, actual 3, nothing to do.",
          info: `${RS}: spec.replicas=3 · running=3 · ready=3`,
          decoded: [sec("THE DIFF", [["desired", "3 (spec.replicas)"], ["actual", "3 (owned, non-terminating)"], ["verdict", "equal → sleep", true]])],
          note: "Level-triggered is the load-bearing property: the loop reacts to how things ARE, not to what just happened. Miss an event - crash, restart, network blip - and the next diff still converges.",
        }),
      ],
    },
    {
      title: "YOU DELETE A POD",
      subtitle: "drift, introduced on purpose",
      body: `You delete ${DEAD} - maybe debugging, maybe tidying. Two things start at once: the API marks the Pod with a deletionTimestamp, and node-2's kubelet sees it and tears the container down politely. The Pod object lives those few seconds in Terminating. The ReplicaSet controller doesn't care yet; it counts non-terminating Pods, and this one just left the count.`,
      facts: [
        ["DELETED", `${DEAD} · deletionTimestamp set`],
        ["KUBELET", "shuts it down over ~2 s"],
        ["COUNT", "3 → 2, immediately"],
      ],
      view: "cluster",
      focus: ["you", "api", "node2"],
      pods: { node2: ["other", "v1", "terminating"] },
      events: [
        ev({
          id: "rc2", at: 0, src: "kubectl", dst: API, layer: "api", size: "0.2 KB", title: "DELETE THE POD", path: ["you", "api"],
          says: "You delete one Pod out of three.",
          info: `DELETE …/pods/${DEAD} (grace 30 s)`,
          decoded: [sec("EFFECT", [["metadata.deletionTimestamp", "set, not gone", true], ["object", "lives until kubelet confirms"], ["grace", "30 s (SIGTERM story: a later lesson)"]])],
        }),
        ev({
          id: "rc3", at: 40, src: API, dst: "kubelet · node-2", layer: "control", size: "2.4 KB", title: "KUBELET TEARS DOWN", path: ["node2", "node2"],
          says: "node-2's kubelet does the actual work of stopping the container.",
          info: `WATCH MODIFIED Pod ${DEAD} (deleting)`,
          decoded: [sec("SHUTDOWN", [["steps", "preStop → SIGTERM → wait"], ["then", "StopPodSandbox, IP released"], ["kubelet confirms", "object removed a few seconds in"]])],
        }),
      ],
    },
    {
      title: "THE CONTROLLER NOTICES",
      subtitle: "the diff turns negative",
      body: `The ReplicaSet controller's informer delivers the update - deletionTimestamp set - but the decision doesn't depend on the event itself. Counting its Pods: owned (ownerReferences → ${RS}), matching labels, not terminating. That's 2. Desired is 3. The diff is −1, so the act is one create. The controller never asks who deleted it or why; a hand-delete, an OOM, or a dead node all read identically here.`,
      facts: [
        ["EVENT", "MODIFIED · deletionTimestamp set"],
        ["COUNT RULES", "owned + matching labels + alive"],
        ["DIFF", "3 desired − 2 actual = −1"],
      ],
      view: "cluster",
      focus: ["api", "kcm"],
      events: [
        ev({
          id: "rc4", at: 220, src: API, dst: "replicaset ctrl", layer: "control", size: "2.2 KB", title: "WATCH: TERMINATING", path: ["api", "kcm"],
          says: "The controller hears about the deletion like everyone else - through its watch.",
          info: `WATCH MODIFIED Pod ${DEAD} (deletionTimestamp set)`,
          decoded: [sec("INFORMER", [["type", "MODIFIED · now terminating"], ["handler", "enqueue ReplicaSet (the owner)"], ["recheck", "from cache, not from the event"]])],
        }),
        ev({
          id: "rc5", at: 250, src: "replicaset ctrl", dst: "replicaset ctrl", layer: "control", size: " - ", title: "RE-DIFF", path: ["kcm", "kcm"],
          says: "It counts what it owns and finds one short.",
          info: "owned alive: kq9tw, x2kqp → want 3, have 2",
          decoded: [sec("COUNT", [[`${RS}-kq9tw`, "node-1 · alive"], [`${RS}-x2kqp`, "node-2 · alive"], [DEAD, "terminating - not counted", true], ["diff", "create 1", true]])],
        }),
      ],
    },
    {
      title: "THE REPLACEMENT",
      subtitle: "a new Pod with a new name",
      body: `The controller creates ${NEW} - not a resurrection, a newborn: new random suffix, new UID, no memory of the old one. Identity is not a Deployment's product. The scheduler places it on node-2: spreading is a tie now, one web Pod each, and node-2 has more free room. Same node as before, but node-2's kubelet starts it like any first Pod: sandbox, new IP, image already cached, container.`,
      facts: [
        ["CREATED", `${NEW} · new name, new UID`],
        ["PLACED", "node-2 (spread tied 1–1 · more free room)"],
        ["IMAGE", "already on node-2 · 0.7 s to start"],
      ],
      view: "cluster",
      focus: ["api", "sched", "kcm", "node2"],
      pods: { node2: ["other", "v1", "terminating", "starting"] },
      events: [
        ev({
          id: "rc6", at: 300, src: "replicaset ctrl", dst: API, layer: "api", size: "2.3 KB", title: "CREATE ONE", path: ["kcm", "api"],
          says: "One create, sized exactly to the diff.",
          info: `POST …/pods  ${NEW}`,
          decoded: [sec("BODY · POD", [["metadata.name", NEW, true], ["generateName", `${RS}-`], ["ownerReferences", `ReplicaSet/${RS}`], ["spec.nodeName", "\"\" - scheduler's move"]])],
        }),
        ev({
          id: "rc7", at: 340, src: "kube-scheduler", dst: API, layer: "api", size: "0.3 KB", title: "BIND → NODE-2", path: ["sched", "api"],
          says: "The scheduler picks node-2 for the replacement.",
          info: `POST …/pods/${NEW}/binding → node-2`,
          decoded: [sec("PLACEMENT", [["filter", "both fit"], ["spread", "tie · 1 web Pod each (terminating Pods don't count)"], ["score", "node-2: more free room", true]])],
        }),
      ],
    },
    {
      title: "CONVERGE AND REPORT",
      subtitle: "equal again, and written down",
      body: `Two seconds later ${NEW} is Running and Ready. The controller's next pass counts 3 and 3, writes status.readyReplicas=3, and sleeps. Two properties of the pattern are worth holding: if the controller had crashed mid-loop, nothing would be lost - the next pass re-diffs the world; and nothing ever commanded the kubelet - each component discovered its own next step through the API. Self-healing is nobody's job; it's the shape of the loop.`,
      facts: [
        ["NEW POD", "Ready at +4.7 s"],
        ["STATUS", "readyReplicas 3"],
        ["CRASH SAFETY", "loop state is the world, not memory"],
        ["NOBODY COMMANDS", "each actor watches and decides"],
      ],
      view: "cluster",
      focus: ["you", "api", "kcm", "node1", "node2"],
      pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
      events: [
        ev({
          id: "rc8", at: 4700, src: "kubelet · node-2", dst: API, layer: "api", size: "0.9 KB", title: "READY", path: ["node2", "api"],
          says: "The replacement passes its probe and reports Ready.",
          info: `PATCH …/pods/${NEW}/status  Ready=True`,
          decoded: [sec("STATUS PATCH", [["conditions.Ready", "False → True", true], ["podIP", "10.244.2.22 · new"]])],
        }),
        ev({
          id: "rc9", at: 4730, src: "replicaset ctrl", dst: API, layer: "control", size: "0.4 KB", title: "STATUS: 3 OF 3", path: ["kcm", "api"],
          says: "The controller writes the final count and goes back to sleep.",
          info: `PATCH …/replicasets/${RS}/status  readyReplicas=3`,
          decoded: [sec("RECONCILED", [["readyReplicas", "2 → 3", true], ["diff", "0 → sleep"], ["this is why", "kubectl delete pod can't shrink a Deployment"]])],
          note: "Drift the other way - scale to 5 - runs the identical math with the opposite sign. One pattern, both directions.",
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "delete → teardown", layer: "api", start: 0, duration: 220 },
    { value: "t2", label: "controller re-diffs", layer: "control", start: 220, duration: 80 },
    { value: "t3", label: "create + schedule", layer: "api", start: 300, duration: 500 },
    { value: "t4", label: "replacement to Ready", layer: "node", start: 800, duration: 3900 },
    { value: "t5", label: "status written", layer: "control", start: 4700, duration: 40 },
  ],
  summary: {
    title: "CONVERGED",
    body: "Desired minus actual, applied with creates and deletes until the answer is zero. The loop doesn't know or care what caused the drift - your delete, an OOM, a node dying - which is exactly why the same three lines of arithmetic scale up to the whole control plane. Every controller is this lesson wearing a different resource.",
    facts: [
      ["REPLACED IN", "≈ 4.7 s, most of it boot"],
      ["IDENTITY", "none - new name, new UID (StatefulSets add it back)"],
      ["NEXT", "A node goes dark"],
    ],
  },
}
