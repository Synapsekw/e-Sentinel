// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import ErrorBoundary from './ErrorBoundary'

// vite.config.ts now sets test.globals, so @testing-library/react's
// auto-cleanup registers; the explicit call is kept anyway (it is idempotent
// and keeps this file correct if that config is ever reverted).
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const BOOM = 'coverage worker exploded'

function Boom(): never {
  throw new Error(BOOM)
}

function Fine() {
  return <p>route content</p>
}

/** React logs its own "The above error occurred in..." report through
 *  console.error for every boundary it hands an error to. Stubbing the method
 *  keeps that noise out of the suite output while still letting us assert on
 *  the boundary's own call. */
function spyConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

describe('ErrorBoundary', () => {
  it('renders the fallback instead of the crashed subtree', () => {
    spyConsoleError()
    render(
      <ErrorBoundary>
        <Boom />
        <Fine />
      </ErrorBoundary>,
    )

    expect(screen.getByText('SYSTEM FAULT')).toBeTruthy()
    expect(
      screen.getByText('The interface hit an unrecoverable error. Reload to continue.'),
    ).toBeTruthy()
    // The message is surfaced; the stack never is.
    expect(screen.getByText(BOOM)).toBeTruthy()
    // The crashed subtree is gone rather than left half-rendered.
    expect(screen.queryByText('route content')).toBeNull()
    expect(screen.getByRole('button', { name: 'RELOAD' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '← MODULES' })).toBeTruthy()
  })

  it('renders children untouched when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Fine />
      </ErrorBoundary>,
    )

    expect(screen.getByText('route content')).toBeTruthy()
    expect(screen.queryByText('SYSTEM FAULT')).toBeNull()
  })

  it('logs the error with the [sentinel] prefix so the component stack survives', () => {
    const spy = spyConsoleError()
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    const call = spy.mock.calls.find((args) => args[0] === '[sentinel] uncaught render error')
    expect(call).toBeDefined()
    expect((call?.[1] as Error).message).toBe(BOOM)
    expect((call?.[2] as { componentStack?: string }).componentStack).toContain('Boom')
  })
})
