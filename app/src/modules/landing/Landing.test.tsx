// @vitest-environment jsdom
//
// The landing page is the demo's front door, so this pins the things a
// careless edit would quietly break: the brand block's wording and order, one
// card per module with an honest description, real links for shipped modules
// and no link for planned ones, and a background that degrades to nothing
// rather than throwing where there is no canvas context (which is exactly the
// situation here — jsdom provides none).

import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Landing from './Landing'
import { MODULES } from './modules'

// jsdom has no 2D context and logs a "Not implemented" trace for every
// getContext call. Returning null explicitly is the same answer jsdom gives,
// without the noise, and states the condition under test: DroneField must bail
// out cleanly when there is no context to draw into. It is swapped via
// property descriptors rather than plain assignment because reading
// `HTMLCanvasElement.prototype.getContext` as a value trips
// @typescript-eslint/unbound-method, and its overloads make it awkward to
// assign to directly.
const realGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')
beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: () => null,
  })
})
afterAll(() => {
  if (realGetContext) {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', realGetContext)
  }
})

afterEach(cleanup)

function renderLanding() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  )
}

describe('Landing', () => {
  it('renders the brand block in order, with no e& logo', () => {
    const { container } = renderLanding()
    expect(screen.getByRole('heading', { level: 1, name: 'SENTINEL' })).toBeTruthy()
    expect(screen.getByText('e-Sentinel C2')).toBeTruthy()
    expect(screen.getByText('Physical Intelligence · Unified Drone Operations')).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders one card per module, each with its description', () => {
    renderLanding()
    const nav = screen.getByRole('navigation', { name: 'Modules' })
    for (const mod of MODULES) {
      expect(within(nav).getByRole('heading', { level: 2, name: mod.title })).toBeTruthy()
      expect(within(nav).getByText(mod.blurb)).toBeTruthy()
    }
  })

  it('links shipped modules to their route and leaves planned ones unlinked', () => {
    renderLanding()
    const nav = screen.getByRole('navigation', { name: 'Modules' })
    const links = within(nav).getAllByRole('link')
    const enabled = MODULES.filter((m) => m.enabled)
    expect(links).toHaveLength(enabled.length)
    for (const mod of enabled) {
      const link = links.find((a) => a.getAttribute('href') === `/${mod.slug}`)
      expect(link).toBeTruthy()
      expect(within(link as HTMLElement).getByText('Open module')).toBeTruthy()
    }
    for (const mod of MODULES.filter((m) => !m.enabled)) {
      const heading = within(nav).getByRole('heading', { level: 2, name: mod.title })
      const card = heading.closest('.mcard') as HTMLElement
      expect(card.getAttribute('data-enabled')).toBe('false')
      expect(card.tagName).not.toBe('A')
      expect(within(card).getByText('Not yet deployed')).toBeTruthy()
    }
  })

  // The planner card used to advertise an AI co-planner that does not exist.
  // The landing page is shown to clients, so no card may claim unshipped work.
  it('does not advertise the unshipped AI co-planner', () => {
    const { container } = renderLanding()
    expect(container.textContent).not.toMatch(/co-?planner/i)
  })

  it('mounts the decorative field without a canvas context, and hides it from assistive tech', () => {
    const { container } = renderLanding()
    const field = container.querySelector('canvas.landing-field')
    expect(field).toBeTruthy()
    expect(field?.getAttribute('aria-hidden')).toBe('true')
  })
})
