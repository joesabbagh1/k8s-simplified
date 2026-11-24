import "@fontsource-variable/inter"
import "@fontsource-variable/jetbrains-mono"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import App from "./App"
import "./index.css"

const container = document.getElementById("root")!
const prerendered = container.childElementCount > 0

// The build's markup is there for crawlers and the first paint. It is replaced rather than hydrated, because
// it can't know the reader's theme or motion settings, and React doesn't correct attributes that differ.
flushSync(() =>
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)

// The reader has already seen the page come in, so entrance animations don't play a second time.
if (prerendered) {
  for (const animation of document.getAnimations()) {
    if (animation.effect?.getComputedTiming().endTime !== Infinity) animation.finish()
  }
}
