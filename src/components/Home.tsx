import { type CSSProperties, useEffect, useRef } from "react"
import { CATEGORY_NAME } from "../data/layers"
import { LESSONS } from "../data/lessons"
import type { Category } from "../data/types"
import { LIBRARY_PATH, lessonPath, REPO_URL } from "../route"
import { useApp } from "../store"
import { HeroScene } from "./HeroScene"
import { Icon } from "./Icon"
import { LayerArt } from "./LayerArt"
import { Link } from "./Link"

const FIRST = "deploy-an-app"

/** The floors of the stack, top to bottom, then security, which belongs to all of them. */
const FLOORS: Record<Category, string> = {
  app: "The workloads you write YAML for",
  control: "The API server, etcd and the controllers",
  node: "The kubelet and containerd on one machine",
  network: "Packets on the wire",
  security: "Who may do what, and alerts on the rest",
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
  ["App · web", "3 replicas · 10.96.120.15:80"],
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
          <p className="hero-kicker">Every layer, from packet to Pod</p>
          <h1 id="home-title" ref={headingRef} tabIndex={-1} className="hero-title">
            Watch a Kubernetes cluster work, one event at a time
          </h1>
          <p className="hero-lead">
            Interactive lessons that play out what happens when you run <code>kubectl apply</code>, call a Service or lose a node: API calls, etcd
            writes, watch events, container runtime calls and real packets, each one decoded field by field. It all runs in your browser, no
            cluster needed.
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
        </div>
        <HeroScene />
      </section>

      <div className="home-inner">
        <section className="home-section" aria-labelledby="how-title">
          <h2 id="how-title" className="home-h2">How a lesson works</h2>
          <ol className="how">
            {HOW.map(([title, body], i) => (
              <li key={title}>
                <span className="how-n">{i + 1}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="home-section" aria-labelledby="topics-title">
          <h2 id="topics-title" className="home-h2">{LESSONS.length} lessons, from the app down to the wire</h2>
          <ul className="floors">
            {(Object.entries(FLOORS) as [Category, string][]).map(([category, about]) => {
              const lessons = LESSONS.filter((l) => l.category === category)
              return (
                <li key={category} className="floor-row">
                  <LayerArt category={category} />
                  <div className="floor-body">
                    <div className="floor-label">
                      <h3>
                        <Link to={LIBRARY_PATH} onClick={browse(category)}>
                          {CATEGORY_NAME[category]} <span className="sr-only">lessons</span>
                          <Icon name="right" size={13} />
                        </Link>
                      </h3>
                      <p>{about}</p>
                    </div>
                    <ul className="floor-lessons" style={{ "--rows": Math.ceil(lessons.length / 3) } as CSSProperties}>
                      {lessons.map((l) => (
                        <li key={l.id}>
                          <Link to={lessonPath(l.id)}>{l.title}</Link>
                        </li>
                      ))}
                    </ul>
                  </div>
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

        <section className="home-section contribute" aria-labelledby="contribute-title">
          <div>
            <h2 id="contribute-title" className="home-h2">Open source</h2>
            <p className="sub">
              Each lesson is a TypeScript file of steps and events. Spotted a wrong field, or want a lesson that isn't here yet? Open an issue or a
              pull request.
            </p>
          </div>
          <a className="btn lg" href={REPO_URL} target="_blank" rel="noopener noreferrer">
            <Icon name="github" size={16} />
            Contribute on GitHub
          </a>
        </section>
      </div>
    </main>
  )
}
