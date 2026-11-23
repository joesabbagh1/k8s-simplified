import { useLayoutEffect, useRef } from "react"

/** Renders isometric markup and shrinks the viewBox to fit what was drawn. */
export function IsoArt({ markup, pad = 3, className = "" }: { markup: string; pad?: number; className?: string }) {
  const ref = useRef<SVGSVGElement>(null)
  useLayoutEffect(() => {
    const svg = ref.current
    if (!svg) return
    const b = svg.getBBox()
    svg.setAttribute("viewBox", `${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`)
  }, [markup, pad])
  return <svg ref={ref} className={`iso ${className}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />
}
