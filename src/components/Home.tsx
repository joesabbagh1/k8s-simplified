import { useEffect, useRef } from "react"
import { CATEGORIES, CATEGORY_NAME } from "../data/layers"
import { LESSONS } from "../data/lessons"
import type { Category } from "../data/types"
import { LIBRARY_PATH, lessonPath } from "../route"
import { useApp } from "../store"
import { HeroScene } from "./HeroScene"
import { Icon } from "./Icon"
import { Link } from "./Link"

const FIRST = "deploy-an-app"

const ABOUT: Record<Category, string> = {
  network: "Packets on the wire: veth pairs, the VXLAN overlay, Services, DNS, Ingress and NetworkPolicy.",
  node: "What the kubelet and containerd do on one machine: images, namespaces, cgroups, probes and volumes.",
  control: "The API server, etcd, watches, the scheduler and the controllers that keep reconciling.",
  app: "The workloads you write YAML for: rollouts, autoscaling, config, StatefulSets, Jobs and RBAC.",
}

const HOW: [string, string][] = [
  ["Watch it move", "Each event travels between the real parts of a cluster: your laptop, the API server, etcd, a kubelet, a veth pair."],
  ["Read one step at a time", "Plain sentences say who acts, what they send and what changes, with the real names and IP addresses."],
  ["Open any event", "The decoder lists every field, marks what changed and draws packet headers, down to VXLAN."],
]

const CLUSTER_FACTS: [string, string][] = [
  ["You · kubectl", "192.168.1.10"],
  ["Control plane", "10.0.0.10:6443"],
  ["node-1", "10.0.1.11 · Pods 10.244.1.0/24"],
  ["node-2", "10.0.1.12 · Pods 10.244.2.0/24"],
  ["Load balancer", "203.0.113.50"],
  ["App", "web · 3 replicas · Service 10.96.120.15:80"],
]

export function Home() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const { setLibraryFilter, setLibraryQuery } = useApp.getState()
  const first = LESSONS.find((l) => l.id === FIRST)!

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  const browse = (filter: Category | "all") => () => {
    setLibraryQuery("")
    setLibraryFilter(filter)
  }

  return (
    <main className="home" aria-labelledby="home-title">
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker">Every layer, from packet to Pod</p>
          <h1 id="home-title" ref={headingRef} tabIndex={-1} className="hero-title">
            Watch a Kubernetes cluster work, one event at a time.
          </h1>
          <p className="hero-lead">
            Interactive lessons that play out what happens when you run <code>kubectl apply</code>, call a Service or lose a node: API calls, etcd
            writes, watch events, container runtime calls and real packets, each one decoded field by field.
          </p>
          <div className="hero-actions">
            <Link className="btn primary lg" to={lessonPath(first.id)}>
              <Icon name="play" size={12} />
              Start the first lesson
            </Link>
            <Link className="btn lg" to={LIBRARY_PATH} onClick={browse("all")}>
              Browse all {LESSONS.length} lessons
            </Link>
          </div>
          <p className="hero-note">{first.title} · {first.steps.length} steps · runs in your browser, no cluster needed</p>
        </div>
        <HeroScene />
      </section>

      <div className="home-inner">
        <section className="home-section" aria-labelledby="how-title">
          <h2 id="how-title" className="home-h2">How a lesson works</h2>
          <ol className="how">
            {HOW.map(([title, body], i) => (
              <li key={title}>
                <span className="how-n">{String(i + 1).padStart(2, "0")}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="home-section" aria-labelledby="topics-title">
          <h2 id="topics-title" className="home-h2">Four layers of the stack</h2>
          <ul className="topics">
            {CATEGORIES.map((category) => {
              const lessons = LESSONS.filter((l) => l.category === category)
              return (
                <li key={category} className="topic">
                  <div className="topic-head">
                    <h3>{CATEGORY_NAME[category]}</h3>
                    <span className="topic-count">{lessons.length} lessons</span>
                  </div>
                  <p>{ABOUT[category]}</p>
                  <ul className="topic-lessons">
                    {lessons.slice(0, 3).map((l) => (
                      <li key={l.id}>
                        <Link to={lessonPath(l.id)}>{l.title}</Link>
                      </li>
                    ))}
                  </ul>
                  <Link className="topic-all" to={LIBRARY_PATH} onClick={browse(category)}>
                    All {CATEGORY_NAME[category].toLowerCase()} lessons
                    <Icon name="right" size={13} />
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="home-section cluster-facts" aria-labelledby="cluster-title">
          <div>
            <h2 id="cluster-title" className="home-h2">One cluster in every lesson</h2>
            <p className="sub">
              Every lesson runs on the same small demo cluster, so the addresses you learn in one lesson are the ones you see in the next.
            </p>
          </div>
          <dl className="facts-grid">
            {CLUSTER_FACTS.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </main>
  )
}
