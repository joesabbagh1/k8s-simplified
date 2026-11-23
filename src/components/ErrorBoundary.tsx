import { Button } from "@ui-sdk/react/button"
import { Component, type ErrorInfo, type ReactNode } from "react"
import { useApp } from "../store"

interface Props {
  /** what the reader calls this part of the page, shown in the fallback */
  label: string
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Keeps one bad render (a lesson payload, a camera edge case) from blanking the whole app. */
class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}]`, error, info.componentStack)
  }

  reset = () => {
    useApp.getState().restart()
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" style={{ gridColumn: "1 / -1", padding: "28px 22px", display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
        <b style={{ fontSize: 14 }}>{this.props.label} hit an error</b>
        <p style={{ margin: 0, color: "var(--dim)", fontSize: 13, maxWidth: "48ch", overflowWrap: "anywhere" }}>
          {String(this.state.error.message || this.state.error)}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <Button className="btn sm" onClick={this.reset}>
            Try again
          </Button>
          <Button className="btn sm" onClick={() => window.location.reload()}>
            Reload the page
          </Button>
        </div>
      </div>
    )
  }
}

export { ErrorBoundary }
