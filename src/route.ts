export const LIBRARY_ROUTE = "lessons"

export const HOME_PATH = "/"
export const LIBRARY_PATH = `/${LIBRARY_ROUTE}`
export const lessonPath = (id: string, part?: number | "summary") => `/${id}${part === undefined ? "" : `/${part}`}`

// Links shared before the switch to paths look like /#/deploy-an-app/5; they still open the same page.
const legacy = () => (window.location.hash.startsWith("#/") ? window.location.hash.slice(1) : null)

export const hasLegacyHash = () => legacy() !== null

/** The address as [id, part], from /deploy-an-app/5 or an old #/deploy-an-app/5. */
export function readLocation(): [id: string | undefined, part: string | undefined] {
  const [id, part] = (legacy() ?? window.location.pathname).split("/").filter(Boolean)
  return [id, part]
}

/** Moves to a page without reloading, adding it to the history like a normal link would. */
export function navigate(to: string) {
  if (window.location.pathname === to && !hasLegacyHash()) return
  window.history.pushState(null, "", to)
  window.dispatchEvent(new PopStateEvent("popstate"))
}
