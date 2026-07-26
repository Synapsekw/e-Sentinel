import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import './errorBoundary.css'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/** React only surfaces the thrown value as `unknown`; normalise it so the
 *  fallback always has a printable one-line message even if something threw a
 *  string, or an Error subclass with an empty message. */
function messageOf(error: Error): string {
  const raw = typeof error?.message === 'string' ? error.message.trim() : ''
  return raw || String(error)
}

/**
 * App-wide render-error net. React requires a class component here: there is no
 * hook equivalent of `getDerivedStateFromError` / `componentDidCatch`.
 *
 * Deliberately has NO in-place reset. A subtree that just threw during render
 * is not reliably re-renderable, and a silent retry that throws again reads to
 * the user as a frozen button. Both recovery controls are therefore full
 * document loads, which work regardless of what state the crash left behind.
 *
 * Only the error's `message` is rendered. The component stack goes to
 * `console.error` instead, so a debugger keeps it without the UI leaking
 * internals at a customer.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Matches the existing `[planner]` / `[coverage]` console prefix
    // convention. `info.componentStack` is the only place the stack survives.
    console.error('[sentinel] uncaught render error', error, info)
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  private handleModules = (): void => {
    // A hard navigation, NOT a react-router <Link>. A client-side navigation
    // would keep the broken tree's module state alive in the same document,
    // which is exactly what we are trying to walk away from.
    window.location.href = import.meta.env.BASE_URL
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="eb-root" role="alert">
        <div className="eb-panel">
          <img
            className="eb-logo"
            src={`${import.meta.env.BASE_URL}assets/img/eand-logo-white.png`}
            alt="e&"
          />
          <h1 className="eb-title">SYSTEM FAULT</h1>
          <p className="eb-body">The interface hit an unrecoverable error. Reload to continue.</p>
          <div className="eb-message">{messageOf(error)}</div>
          <div className="eb-actions">
            <button type="button" className="eb-btn eb-btn-alert" onClick={this.handleReload}>
              RELOAD
            </button>
            <button type="button" className="eb-btn" onClick={this.handleModules}>
              ← MODULES
            </button>
          </div>
        </div>
      </div>
    )
  }
}
