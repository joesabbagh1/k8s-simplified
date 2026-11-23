import type { AnchorHTMLAttributes } from "react"
import { navigate } from "../route"

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string }

/** An in-app link: a real href, so opening in a new tab works, but a plain click moves without a reload. */
export function Link({ to, onClick, ...rest }: LinkProps) {
  return (
    <a
      {...rest}
      href={to}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target) return
        e.preventDefault()
        navigate(to)
      }}
    />
  )
}
