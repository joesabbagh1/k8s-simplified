import { CATEGORY_NAME } from "./data/layers"
import { LESSONS } from "./data/lessons"
import { sentence } from "./data/text"
import { HOME_PATH, LIBRARY_PATH, lessonPath, pathOf, type Route } from "./route"

export const SITE = "KubeLearn"
export const ORIGIN = "https://kubelearn.joesabbagh.com"

const IMAGE_ALT = `${SITE}: watch a Kubernetes cluster work, one event at a time.`

/** What search results and link previews say about a page. */
export interface Meta {
  title: string
  description: string
  /** the page's own address; null for a page that isn't one */
  url: string | null
  /** the address to index: a lesson's steps and summary all count as the lesson */
  canonical: string | null
  type: "website" | "article"
  /** schema.org data, as JSON-LD */
  data: object[]
}

const absolute = (path: string) => ORIGIN + path

/** Cuts text to the length of a search result's description, at the end of a word. */
export function clip(text: string, max = 160) {
  if (text.length <= max) return text
  return `${text.slice(0, text.lastIndexOf(" ", max - 1)).replace(/[\s,;:.–-]+$/, "")}…`
}

const breadcrumbs = (...items: [name: string, path: string][]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: absolute(path) })),
})

export function metaFor(route: Route): Meta {
  if (route.page === "notFound") {
    return {
      title: `Page not found · ${SITE}`,
      description: "There is no lesson or step at this address.",
      url: null,
      canonical: null,
      type: "website",
      data: [],
    }
  }

  const url = absolute(pathOf(route)!)

  if (route.page === "home") {
    const description = "Watch a Kubernetes cluster work, layer by layer: free interactive lessons that go from the packet on the wire to the Pod running your app."
    return {
      title: `${SITE} · See how Kubernetes works, packet to Pod`,
      description,
      url,
      canonical: url,
      type: "website",
      data: [{ "@context": "https://schema.org", "@type": "WebSite", name: SITE, url, description, inLanguage: "en" }],
    }
  }

  if (route.page === "library") {
    return {
      title: `Interactive Kubernetes lessons · ${SITE}`,
      description: `${LESSONS.length} free interactive Kubernetes lessons on networking, nodes, the control plane and apps: DNS, Services, scheduling, probes, storage, RBAC and more.`,
      url,
      canonical: url,
      type: "website",
      data: [
        breadcrumbs([SITE, HOME_PATH], ["Lessons", LIBRARY_PATH]),
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: LESSONS.map((l, i) => ({ "@type": "ListItem", position: i + 1, name: l.title, url: absolute(lessonPath(l.id)) })),
        },
      ],
    }
  }

  const { lesson, step, finished } = route
  const canonical = absolute(lessonPath(lesson.id))
  const part = finished ? "Summary" : step < 0 ? null : `Step ${step + 1} of ${lesson.steps.length}`
  const text = finished ? lesson.summary?.body : step < 0 ? null : `${sentence(lesson.steps[step].title)}: ${lesson.steps[step].body}`
  return {
    title: part ? `${lesson.title} · ${part} · ${SITE}` : `${lesson.seo.title} · ${SITE}`,
    description: text ? clip(text) : lesson.seo.description,
    url,
    canonical,
    type: "article",
    data: [
      breadcrumbs([SITE, HOME_PATH], ["Lessons", LIBRARY_PATH], [lesson.title, lessonPath(lesson.id)]),
      {
        "@context": "https://schema.org",
        "@type": "LearningResource",
        name: lesson.title,
        headline: lesson.seo.title,
        description: lesson.seo.description,
        url: canonical,
        image: absolute("/og.png"),
        learningResourceType: "Interactive lesson",
        about: ["Kubernetes", `Kubernetes ${CATEGORY_NAME[lesson.category].toLowerCase()}`],
        inLanguage: "en",
        isAccessibleForFree: true,
        isPartOf: { "@type": "WebSite", name: SITE, url: absolute(HOME_PATH) },
      },
    ],
  }
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** The page's <head> tags, as the build writes them. */
export function headHtml({ title, description, url, canonical, type, data }: Meta): string {
  const named = (name: string, content: string) => `<meta name="${name}" content="${escape(content)}" />`
  const property = (name: string, content: string) => `<meta property="${name}" content="${escape(content)}" />`
  return [
    `<title>${escape(title)}</title>`,
    named("description", description),
    canonical ? `<link rel="canonical" href="${escape(canonical)}" />` : named("robots", "noindex"),
    property("og:type", type),
    property("og:site_name", SITE),
    property("og:title", title),
    property("og:description", description),
    url && property("og:url", url),
    property("og:image", absolute("/og.png")),
    property("og:image:width", "1200"),
    property("og:image:height", "630"),
    property("og:image:alt", IMAGE_ALT),
    named("twitter:card", "summary_large_image"),
    named("twitter:title", title),
    named("twitter:description", description),
    named("twitter:image", absolute("/og.png")),
    ...data.map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, "\\u003c")}</script>`),
  ]
    .filter(Boolean)
    .join("\n    ")
}

/** Updates the <head> the build wrote, when the reader moves to another page without a reload. */
export function applyMeta({ title, description, url, canonical }: Meta) {
  const set = (selector: string, attribute: string, value: string | null) => {
    if (value !== null) for (const el of document.querySelectorAll(selector)) el.setAttribute(attribute, value)
  }
  document.title = title
  set('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]', "content", description)
  set('meta[property="og:title"], meta[name="twitter:title"]', "content", title)
  set('meta[property="og:url"]', "content", url)
  set('link[rel="canonical"]', "href", canonical)
}
