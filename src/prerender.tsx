import { renderToString } from "react-dom/server"
import App from "./App"
import { LESSONS } from "./data/lessons"
import { headHtml, metaFor, ORIGIN } from "./meta"
import { HOME_PATH, LIBRARY_PATH, lessonPath, matchPath, type Route } from "./route"
import { stateFor, useApp } from "./store"

/** The pages in the sitemap: a lesson's steps and summary belong to the lesson. */
export const indexed = [HOME_PATH, LIBRARY_PATH, ...LESSONS.map((l) => lessonPath(l.id))]

const paths = [...indexed, ...LESSONS.flatMap((l) => [...l.steps.map((_, i) => lessonPath(l.id, i + 1)), lessonPath(l.id, "summary")])]

function render(route: Route) {
  // On the server React reads the store's initial state, so that is what has to hold the page.
  Object.assign(useApp.getInitialState(), stateFor(route))
  return { head: headHtml(metaFor(route)), body: renderToString(<App />) }
}

/** Every page of the site, with the file the host serves it from. Rendered one at a time, as each is asked for. */
export function* pages() {
  for (const path of paths) yield { file: path === HOME_PATH ? "index.html" : `${path.slice(1)}.html`, ...render(matchPath(path)) }
  yield { file: "404.html", ...render({ page: "notFound" }) }
}

export const sitemap = () =>
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexed.map((path) => `  <url><loc>${ORIGIN}${path}</loc></url>`).join("\n")}
</urlset>
`
