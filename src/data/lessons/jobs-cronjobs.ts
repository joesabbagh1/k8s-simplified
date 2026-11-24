import type { Lesson } from "../types"
import { ev, sec } from "./helpers"

const API = "kube-apiserver"
const JC = "job ctrl"
const CC = "cronjob ctrl"
const K1 = "kubelet · node-1"
const C1 = "containerd · node-1"
const POD = "report-5xk2p"
const FPOD = "nightly-report-29921940-5xk2p"

export const jobsCronjobs: Lesson = {
  id: "jobs-cronjobs",
  title: "Jobs and CronJobs",
  subtitle: "Run to completion",
  category: "app",
  seo: {
    title: "Kubernetes Jobs and CronJobs",
    description: "How Kubernetes runs Pods that are meant to exit: Job completions, retries with backoffLimit, and the CronJobs that create Jobs on a schedule.",
  },
  actors: ["you", "cp", "node1", "backup-job", "nightly-job", "backup-cj"],
  pods: { node1: ["other", "v1"], node2: ["other", "v1", "v1"] },
  lanes: {
    [JC]: "controllers",
    [CC]: "controllers",
    "ttl ctrl": "controllers",
    [K1]: "node-1",
    [C1]: "node-1",
    [POD]: "Pod",
    [FPOD]: "Pod",
  },
  overview: {
    body: "A Pod that is supposed to exit: completions, retries and schedules. Everything so far assumed a Pod that runs forever - a Job flips that, and exit 0 becomes the success condition. Get the query wrong and the controller retries on a doubling clock until backoffLimit gives up; wrap the Job in a CronJob and a controller manufactures one per tick, on a schedule.",
    facts: [
      ["JOB", "report · completions 1 · parallelism 1"],
      ["RETRIES", "backoffLimit 5 · restartPolicy Never"],
      ["CRON", "0 3 * * * · UTC · concurrencyPolicy Forbid"],
      ["CLEANUP", "history limits · ttlSecondsAfterFinished 3600"],
    ],
  },
  steps: [
    {
      title: "THE DEAL",
      subtitle: "a Pod that is supposed to exit",
      body: "A Deployment's Pod that exits has failed; a Job's Pod that exits 0 has succeeded - that's the whole inversion. The spec says so: completions 1 means one success is enough, parallelism 1 means one at a time, backoffLimit 5 allows five retries after the first try, and restartPolicy Never is the load-bearing field. Never matters because a crashing container must not be restarted in place: retries belong to the Job controller, which counts them. activeDeadlineSeconds 600 caps the whole run.",
      facts: [
        ["COMPLETIONS", "1 · parallelism 1"],
        ["BACKOFF LIMIT", "5 retries · 6 attempts in all"],
        ["RESTART POLICY", "Never - the Job owns retries"],
        ["CAPS", "activeDeadlineSeconds 600 · ttl 3600"],
      ],
      view: "cluster",
      focus: ["you", "cp", "backup-job"],
      events: [
        ev({
          id: "jb1", at: 0, src: "kubectl", dst: API, layer: "api", size: "0.7 KB", title: "APPLY THE JOB", path: ["you", "cp"],
          says: "kubectl posts the Job: one Pod, one success, up to five retries.",
          info: "POST /apis/batch/v1/namespaces/default/jobs",
          res: { "backup-job": { kind: "job", name: "Job report", sub: "completions 1/1 · retries 5", state: "creating" } },
          decoded: [
            sec("HTTP/2 REQUEST", [["method", "POST"], ["path", "/apis/batch/v1/namespaces/default/jobs"]]),
            sec("BODY · JOB", [["metadata.name", "\"report\""], ["spec.completions", "1"], ["spec.parallelism", "1"], ["spec.backoffLimit", "5"], ["…template.spec.restartPolicy", "Never", true], ["activeDeadlineSeconds", "600"], ["ttlSecondsAfterFinished", "3600"]]),
          ],
        }),
        ev({
          id: "jb2", at: 6, src: API, dst: JC, layer: "control", size: "0.8 KB", title: "WATCH EVENT", path: ["cp", "backup-job"],
          says: "The Job controller hears about it: one completion wanted, none reached.",
          info: "WATCH ADDED Job default/report",
          decoded: [sec("JOB CONTROLLER", [["wants", "1 success"], ["active", "0"], ["next", "create 1 Pod"]])],
        }),
        ev({
          id: "jb3", at: 24, src: JC, dst: API, layer: "api", size: "1.9 KB", title: "CREATE THE POD", path: ["backup-job", "node1"],
          says: "It creates exactly one Pod. Nobody promises to keep it alive.",
          info: "POST /api/v1/namespaces/default/pods  report-5xk2p",
          res: { "backup-job": { kind: "job", name: "Job report", sub: "1 Pod running · 0 done" } },
          decoded: [sec("BODY · POD", [["metadata.name", POD], ["restartPolicy", "Never (copied from the template)"], ["status.phase", "Pending"]])],
        }),
      ],
    },
    {
      title: "RUN ONCE",
      subtitle: "42 seconds, then exit 0",
      body: "Zoom into node-1. The kubelet starts the container like any other - a Job Pod is still a Pod - and the report runs its SQL for 42 seconds. Then the process exits 0. For an ordinary Pod that would be a crash; here the kubelet checks restartPolicy, sees Never, and does nothing but report upward. The container just sits there, finished, its logs still readable.",
      facts: [
        ["POD", "report-5xk2p · node-1"],
        ["RUNTIME", "42 s"],
        ["EXIT", "0"],
        ["KUBELET RESTARTS", "none - Never means never"],
      ],
      view: "node1",
      focus: ["n1.api", "n1.kubelet", "n1.containerd", "n1.podA"],
      pods: { node1: ["other", "v1", "starting"] },
      events: [
        ev({
          id: "jb4", at: 560, src: API, dst: K1, layer: "control", size: "1.9 KB", title: "KUBELET SEES ITS POD", path: ["n1.api", "n1.kubelet"],
          says: "node-1's kubelet sees the Pod assigned to it.",
          info: "WATCH ADDED Pod report-5xk2p (nodeName node-1)",
          decoded: [sec("WATCH STREAM", [["type", "ADDED"], ["restartPolicy", "Never - the kubelet will not restart on exit"]])],
        }),
        ev({
          id: "jb5", at: 700, src: K1, dst: C1, layer: "node", size: "1.0 KB", title: "START THE REPORT", path: ["n1.kubelet", "n1.containerd"],
          says: "containerd starts it; for 42 seconds it's an ordinary Pod.",
          info: "CreateContainer report · psql -f nightly.sql",
          decoded: [sec("gRPC · runtime.v1.RuntimeService", [["method", "CreateContainer"], ["image", "registry.example.com/shop/report:2.3.1"], ["runs", "42 s"]])],
        }),
        ev({
          id: "jb6", at: 42700, src: C1, dst: POD, layer: "node", size: "0.1 KB", title: "EXIT 0", path: ["n1.containerd", "n1.podA"],
          says: "The report finishes and exits 0. Success, not a crash.",
          info: "report exited 0 after 42 s",
          decoded: [sec("CONTAINER STATE", [["state", "running → terminated", true], ["exitCode", "0", true], ["reason", "Completed"]])],
          pods: { node1: ["other", "v1", "v2"] },
        }),
        ev({
          id: "jb7", at: 42900, src: K1, dst: API, layer: "api", size: "0.5 KB", title: "POD SUCCEEDED", path: ["n1.kubelet", "n1.api"],
          says: "The kubelet reports the Pod Succeeded - and restarts nothing.",
          info: "PATCH …/pods/report-5xk2p/status  phase=Succeeded",
          decoded: [sec("STATUS PATCH", [["status.phase", "Running → Succeeded", true], ["restarts", "0 - Never held"]])],
          note: "With OnFailure the kubelet would restart the container in place and restartCount would climb - same Pod, no new name. Never hands every retry to the Job controller instead.",
        }),
      ],
    },
    {
      title: "JOB COMPLETE",
      subtitle: "one success, counted",
      body: "The Job controller watches the Pod object, sees Succeeded, and updates its own scoreboard: succeeded 1 of 1, condition Complete, 43.3 seconds after the start. The Job and the finished Pod both stay put - a succeeded Pod is evidence, and its logs stay readable - until the TTL cleans up an hour later.",
      facts: [
        ["SUCCEEDED", "1 / 1"],
        ["CONDITION", "Complete=True"],
        ["TOOK", "43.3 s"],
        ["POD OBJECT", "kept - kubectl logs still works"],
      ],
      view: "cluster",
      focus: ["cp", "backup-job"],
      events: [
        ev({
          id: "jb8", at: 43100, src: API, dst: JC, layer: "control", size: "0.5 KB", title: "SUCCEEDED", path: ["cp", "backup-job"],
          says: "The Job controller hears the Pod finished successfully.",
          info: "WATCH MODIFIED Pod report-5xk2p  phase=Succeeded",
          decoded: [sec("WATCH STREAM", [["type", "MODIFIED"], ["phase", "Succeeded"], ["counted as", "1 completion"]])],
        }),
        ev({
          id: "jb9", at: 43300, src: JC, dst: API, layer: "api", size: "0.4 KB", title: "MARK COMPLETE", path: ["cp", "backup-job"],
          says: "It marks the Job Complete: one success of one wanted.",
          info: "PATCH …/jobs/report/status  Complete",
          res: { "backup-job": { kind: "job", name: "Job report", sub: "Complete · 43.3 s · Pod kept" } },
          decoded: [sec("JOB STATUS", [["status.succeeded", "1", true], ["conditions[]", "type Complete · status True", true], ["startTime → completionTime", "0.7 s → 43.3 s"]])],
          note: "The finished Pod is deliberately not deleted: it's the audit trail, and the logs. ttlSecondsAfterFinished 3600 will remove Job and Pod an hour later.",
        }),
      ],
    },
    {
      title: "WHEN IT FAILS",
      subtitle: "backoff, then give up",
      body: "Three weeks later the 03:00 run ships a typo in the SQL, and the Pod dies in 3 seconds with exit 1. restartPolicy Never means the kubelet leaves the Failed Pod alone, and the Job controller makes a brand-new Pod after a 10-second backoff. The backoff doubles with every failure - 10, 20, 40, 80, 160 s - and the sixth failure takes the count past backoffLimit, so the Job itself is declared Failed. The 600-second deadline never even came into it.",
      facts: [
        ["FIRST FAILURE", "exit 1 after 3 s"],
        ["BACKOFF", "10 · 20 · 40 · 80 · 160 s - doubling"],
        ["ATTEMPTS", "6 · failed 6 > backoffLimit 5"],
        ["JOB", "Failed · reason BackoffLimitExceeded"],
      ],
      view: "cluster",
      focus: ["cp", "backup-job", "nightly-job", "node1"],
      events: [
        ev({
          id: "jb10", at: 60000, src: CC, dst: API, layer: "api", size: "0.7 KB", title: "THE NIGHTLY JOB", path: ["cp", "nightly-job"],
          says: "A new Job is created for the 03:00 run - this one carries the broken query.",
          info: "POST …/jobs  nightly-report-29921940",
          res: { "nightly-job": { kind: "job", name: "Job nightly-report", sub: "made by CronJob · broken SQL", state: "creating" } },
          decoded: [sec("BODY · JOB", [["metadata.name", "nightly-report-29921940 (the tick's epoch-minutes)", true], ["made by", "CronJob nightly-report"], ["same spec", "completions 1 · backoffLimit 5 · Never"]])],
        }),
        ev({
          id: "jb11", at: 63000, src: C1, dst: FPOD, layer: "node", size: "0.1 KB", title: "EXIT 1", path: ["node1", "node1"],
          says: "The bad SQL kills the Pod in three seconds.",
          info: "nightly-report-29921940-5xk2p exited 1 after 3 s",
          decoded: [sec("CONTAINER STATE", [["exitCode", "1", true], ["reason", "Error"], ["stderr", "psql: ERROR: syntax error at or near \"FORM\""]])],
        }),
        ev({
          id: "jb12", at: 63100, src: K1, dst: API, layer: "api", size: "0.5 KB", title: "FAILED, NOT RESTARTED", path: ["node1", "nightly-job"],
          says: "The Pod is Failed and stays that way - Never forbids an in-place restart.",
          info: "PATCH …/pods/nightly-report-29921940-5xk2p/status  phase=Failed",
          res: { "nightly-job": { kind: "job", name: "Job nightly-report", sub: "attempt 1 · exit 1" } },
          decoded: [sec("STATUS PATCH", [["status.phase", "Failed", true], ["restartCount", "0 - the Job retries, not the kubelet"], ["counter", "status.failed = 1"]])],
        }),
        ev({
          id: "jb13", at: 73000, src: JC, dst: API, layer: "api", size: "1.9 KB", title: "RETRY - NEW POD", path: ["nightly-job", "node1"],
          says: "Ten seconds later the Job controller creates a fresh Pod for attempt two.",
          info: "POST …/pods  nightly-report-29921940-w9tnc",
          res: { "nightly-job": { kind: "job", name: "Job nightly-report", sub: "attempt 2 · after 10 s backoff" } },
          decoded: [sec("BACKOFF", [["waited", "10 s - doubles each failure: 10 · 20 · 40 · 80 · 160", true], ["failed", "1 ≤ backoffLimit 5"], ["new Pod", "new name - the counter lives on the Job"]])],
          pods: { node1: ["other", "v1", "starting"] },
        }),
        ev({
          id: "jb14", at: 388000, src: JC, dst: API, layer: "control", size: "7.4 KB", title: "ATTEMPTS 3 TO 6", path: ["nightly-job", "node1"],
          says: "Attempts 3 to 6 each exit 1 on the doubling clock.",
          info: "4 more Pods · each exit 1 · backoff 40 · 80 · 160 s",
          res: { "nightly-job": { kind: "job", name: "Job nightly-report", sub: "attempts 3–6 · doubling backoff" } },
          decoded: [sec("THE BILL", [["attempt 3 · +39 s", "exit 1"], ["attempt 4 · +82 s", "exit 1"], ["attempt 5 · +165 s", "exit 1"], ["attempt 6 · +328 s", "exit 1 · failed = 6", true]])],
          pods: { node1: ["other", "v1", "v2"] },
          note: "The doubling curve is the same one from the probes lesson; there it restarted one Pod forever, here it mints a new Pod per attempt.",
        }),
        ev({
          id: "jb15", at: 389000, src: JC, dst: API, layer: "api", size: "0.4 KB", title: "JOB FAILED", path: ["cp", "nightly-job"],
          says: "Six failures pass backoffLimit 5, so the Job itself is marked Failed.",
          info: "PATCH …/jobs/nightly-report-29921940/status  Failed",
          res: { "nightly-job": { kind: "job", name: "Job nightly-report", sub: "Failed · BackoffLimitExceeded" } },
          decoded: [sec("JOB STATUS", [["status.failed", "6", true], ["conditions[]", "type Failed · status True", true], ["reason", "BackoffLimitExceeded", true], ["activeDeadlineSeconds", "600 - never reached: 328 s < 600"]])],
        }),
      ],
    },
    {
      title: "ON A CLOCK",
      subtitle: "CronJob is a Job factory",
      body: "Where did that 03:00 Job come from? The CronJob controller works out when schedule 0 3 * * * next fires - every day at 03:00, UTC unless timeZone says otherwise - sleeps until then, and creates a Job from its template, named after the tick's time in minutes since the epoch. concurrencyPolicy Forbid skips a tick if the previous Job is still running; Replace would delete it and start fresh; Allow would run both. startingDeadlineSeconds decides how long a missed tick still counts after an outage.",
      facts: [
        ["SCHEDULE", "0 3 * * * · UTC (timeZone exists)"],
        ["JOB NAMES", "nightly-report-29921940 …"],
        ["CONCURRENCY", "Forbid - skip if still running"],
        ["ALSO", "Replace · Allow · startingDeadlineSeconds"],
      ],
      view: "cluster",
      focus: ["cp", "backup-cj", "nightly-job"],
      events: [
        ev({
          id: "jb16", at: 390100, src: CC, dst: CC, layer: "control", size: " - ", title: "THE TICK ARRIVES", path: ["cp", "backup-cj"],
          says: "The controller wakes at the time it computed for the next tick.",
          info: "tick 03:00 matches 0 3 * * *",
          res: { "backup-cj": { kind: "cronjob", name: "CronJob nightly-report", sub: "0 3 * * * · Forbid", state: "creating" } },
          decoded: [sec("CRONJOB CONTROLLER", [["wakes", "at the next scheduled time · computed, not polled"], ["schedule", "0 3 * * * - daily 03:00"], ["timeZone", "unset → UTC (field exists since 1.27)"], ["startingDeadlineSeconds", "unset - set it to skip stale ticks after an outage"]])],
        }),
        ev({
          id: "jb17", at: 390200, src: CC, dst: API, layer: "api", size: "0.7 KB", title: "ONE JOB PER TICK", path: ["backup-cj", "cp"],
          says: "The tick gets its own Job, stamped from the template.",
          info: "POST …/jobs  nightly-report-29923380",
          res: { "backup-cj": { kind: "cronjob", name: "CronJob nightly-report", sub: "one Job per tick" } },
          decoded: [sec("BODY · JOB", [["metadata.name", "nightly-report-29923380", true], ["template", "identical: completions 1 · backoffLimit 5 · Never"], ["ownerReferences", "CronJob/nightly-report"]])],
        }),
        ev({
          id: "jb18", at: 391000, src: CC, dst: CC, layer: "control", size: "0.3 KB", title: "FORBID: SKIP, DON'T STACK", path: ["backup-cj", "backup-cj"],
          says: "If a run is still going when the next tick comes, Forbid skips that tick instead of starting a second one.",
          info: "next tick · previous Job still active? → skip (JobAlreadyActive)",
          res: { "backup-cj": { kind: "cronjob", name: "CronJob nightly-report", sub: "0 3 * * * · Forbid" } },
          decoded: [sec("CONCURRENCY POLICY", [["if", "the previous Job is still running at the next tick"], ["Forbid", "skip the tick - no overlap", true], ["Replace", "delete it, start the new one"], ["Allow", "run both at once"], ["here", "activeDeadlineSeconds 600 ends every run long before the next 03:00"]])],
        }),
      ],
    },
    {
      title: "CLEANING UP",
      subtitle: "history limits and TTL",
      body: "A Job a day is 365 objects a year, so something prunes. The CronJob controller keeps successfulJobsHistoryLimit 3 and failedJobsHistoryLimit 1, deleting older Jobs - and a Job delete cascades to its Pods. The modern lever is ttlSecondsAfterFinished on the Job itself: the first run set 3600, so an hour after it completed, the TTL controller removes it and its Pod. One caveat runs the other way: without activeDeadlineSeconds, a hung Job runs forever.",
      facts: [
        ["HISTORY KEPT", "3 successful · 1 failed"],
        ["CASCADE", "deleting a Job deletes its Pods"],
        ["TTL", "3600 s after Complete"],
        ["NO DEADLINE", "a hung Job runs forever"],
      ],
      view: "cluster",
      focus: ["cp", "backup-cj", "backup-job", "nightly-job"],
      events: [
        ev({
          id: "jb19", at: 392000, src: CC, dst: API, layer: "api", size: "0.2 KB", title: "PRUNE THE HISTORY", path: ["backup-cj", "cp"],
          says: "The oldest success is past the limit of 3, so the CronJob controller deletes it.",
          info: "DELETE …/jobs/nightly-report-29916180",
          decoded: [sec("HISTORY", [["successfulJobs", "4 > successfulJobsHistoryLimit 3"], ["deleted", "nightly-report-29916180 + its Pods (cascade)", true], ["failedJobsHistoryLimit", "1"]])],
        }),
        ev({
          id: "jb20", at: 3643300, src: "ttl ctrl", dst: API, layer: "api", size: "0.2 KB", title: "TTL EXPIRED", path: ["cp", "backup-job"],
          says: "An hour after completing, the first Job hits its TTL and goes, Pod and all.",
          info: "DELETE …/jobs/report  ttlSecondsAfterFinished=3600",
          res: { "backup-job": null },
          decoded: [sec("TTL-AFTER-FINISHED", [["finished at", "43.3 s"], ["deleted at", "43.3 s + 3600 s", true], ["gone with it", "Pod report-5xk2p - and its logs"]])],
          pods: { node1: ["other", "v1"] },
        }),
      ],
    },
  ],
  timing: [
    { value: "t1", label: "apply → Pod created", layer: "api", start: 0, duration: 24 },
    { value: "t2", label: "report runs · 42 s", layer: "node", start: 700, duration: 42000 },
    { value: "t3", label: "exit → Complete", layer: "api", start: 42700, duration: 700 },
    { value: "t4", label: "6 attempts · doubling backoff", layer: "control", start: 63000, duration: 326000 },
    { value: "t5", label: "cron ticks → Jobs", layer: "control", start: 390100, duration: 900 },
    { value: "t6", label: "prune + TTL cleanup", layer: "api", start: 392000, duration: 3251300 },
  ],
  summary: {
    title: "JOB DONE",
    body: "A Job inverts the deal: the Pod's purpose is to exit, and the controller counts outcomes instead of keeping replicas alive. Failure is the same machinery seen from the bad side - new Pods on a doubling clock until backoffLimit calls it. A CronJob adds only a clock: every tick, a fresh Job from the same template, with history limits to keep the pile from growing.",
    facts: [
      ["SUCCESS", "exit 0 → Complete in 43.3 s"],
      ["FAILURE", "6 attempts · 5.5 min · BackoffLimitExceeded"],
      ["NEXT", "RBAC and ServiceAccounts"],
    ],
  },
}
