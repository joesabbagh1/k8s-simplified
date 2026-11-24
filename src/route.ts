import { lessonById } from "./data/lessons"
import type { Lesson } from "./data/types"

export const LIBRARY_ROUTE = "lessons"

export const HOME_PATH = "/"

/** The source on GitHub, where lessons are fixed and added. */
export const REPO_URL = "https://github.com/joesabbagh1/kubelearn"
export const LIBRARY_PATH = `/${LIBRARY_ROUTE}`
export const lessonPath = (id: string, part?: number | "summary") => `/${id}${part === undefined ? "" : `/${part}`}`

// Links shared before the switch to paths look like /#/deploy-an-app/5; they still open the same page.
const legacy = () => (window.location.hash.startsWith("#/") ? window.location.hash.slice(1) : null)

export const hasLegacyHash = () => legacy() !== null

/** A page of the site. A lesson's `step` is -1 on its overview and its last step on its summary. */
export type Route =
  | { page: "home" }
  | { page: "library" }
  | { page: "notFound" }
  | { page: "lesson"; lesson: Lesson; step: number; finished: boolean }

/**
 * The page at a path, such as /deploy-an-app/5. The build writes a file for each page this accepts,
 * so any other address is a 404 from the host and "notFound" here.
 */
export function matchPath(path: string): Route {
  const [id, part, ...rest] = path.split("/").filter(Boolean)
  if (!id) return { page: "home" }
  if (rest.length) return { page: "notFound" }
  if (id === LIBRARY_ROUTE) return part ? { page: "notFound" } : { page: "library" }
  const lesson = lessonById(id)
  if (!lesson) return { page: "notFound" }
  if (!part) return { page: "lesson", lesson, step: -1, finished: false }
  if (part === "summary") return { page: "lesson", lesson, step: lesson.steps.length - 1, finished: true }
  if (!/^[1-9]\d*$/.test(part) || Number(part) > lesson.steps.length) return { page: "notFound" }
  return { page: "lesson", lesson, step: Number(part) - 1, finished: false }
}

/** The path of a page; null for "notFound", which can be at any address. */
export function pathOf(route: Route): string | null {
  if (route.page === "home") return HOME_PATH
  if (route.page === "library") return LIBRARY_PATH
  if (route.page === "notFound") return null
  return lessonPath(route.lesson.id, route.finished ? "summary" : route.step >= 0 ? route.step + 1 : undefined)
}

/** The page in the address bar, from /deploy-an-app/5 or an old #/deploy-an-app/5. */
export const readLocation = (): Route => matchPath(legacy() ?? window.location.pathname)

/** Moves to a page without reloading, adding it to the history and starting at its top like a normal link would. */
export function navigate(to: string) {
  if (window.location.pathname === to && !hasLegacyHash()) return
  window.history.pushState(null, "", to)
  window.dispatchEvent(new PopStateEvent("popstate"))
  window.scrollTo(0, 0)
}
