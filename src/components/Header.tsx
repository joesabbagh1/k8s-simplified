import { Button } from "@ui-sdk/react/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui-sdk/react/tooltip"
import { logo } from "../iso/iso"
import { HOME_PATH, LIBRARY_PATH } from "../route"
import { useApp, useLesson } from "../store"
import { Icon } from "./Icon"
import { IsoArt } from "./IsoArt"
import { Link } from "./Link"
import { ShortcutsDialog } from "./ShortcutsDialog"

const LOGO = logo(2)

export function Header() {
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)
  const page = useApp((s) => s.page)
  const lesson = useLesson()
  const other = theme === "dark" ? "light" : "dark"

  return (
    <header className="topbar">
      <Link className="brand" to={HOME_PATH} aria-label="K8s Simplified, home" aria-current={page === "home" ? "page" : undefined}>
        <IsoArt markup={LOGO} pad={2} className="brand-mark" />
        <span className="wordmark"><span className="k">K8s</span> Simplified</span>
      </Link>
      <span className="topbar-sep" aria-hidden="true">/</span>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link className="crumb" to={LIBRARY_PATH} aria-current={page === "library" ? "page" : undefined}>
          <Icon name="grid" size={15} />
          Lessons
        </Link>
        {page === "lesson" && (
          <>
            <span className="topbar-sep" aria-hidden="true">/</span>
            <span className="crumb-here" aria-current="page">{lesson.title}</span>
          </>
        )}
      </nav>

      <div className="tools">
        <Tooltip>
          <TooltipTrigger render={<Button onClick={() => setTheme(other)} />} className="ibtn ghost" aria-label={`Switch to ${other} mode`}>
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </TooltipTrigger>
          <TooltipContent className="tip">{other === "light" ? "Light" : "Dark"} mode</TooltipContent>
        </Tooltip>
        <ShortcutsDialog />
      </div>
    </header>
  )
}
