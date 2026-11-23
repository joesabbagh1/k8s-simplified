import { Details } from "./components/Details"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { EventFlow } from "./components/EventFlow"
import { Header } from "./components/Header"
import { Home } from "./components/Home"
import { Library } from "./components/Library"
import { Stage } from "./components/Stage"
import { useRoute, useKeyboard, usePlayback } from "./hooks"
import { useApp } from "./store"

export default function App() {
  usePlayback()
  useKeyboard()
  useRoute()
  const diagramOnly = useApp((s) => s.diagramOnly)
  const flowOpen = useApp((s) => s.flowOpen)
  const page = useApp((s) => s.page)

  return (
    <div className="shell">
      {page === "lesson" && <a className="skip-link" href="#stage">Skip to the diagram</a>}
      <Header />
      {page === "home" ? (
        <Home />
      ) : page === "library" ? (
        <Library />
      ) : (
        <main className="workspace" data-diagram-only={diagramOnly || undefined} data-flow-open={flowOpen || undefined}>
          <ErrorBoundary label="The diagram">
            <Stage />
          </ErrorBoundary>
          <ErrorBoundary label="The story column">
            <Details />
          </ErrorBoundary>
          <ErrorBoundary label="The events drawer">
            <EventFlow />
          </ErrorBoundary>
        </main>
      )}
    </div>
  )
}
