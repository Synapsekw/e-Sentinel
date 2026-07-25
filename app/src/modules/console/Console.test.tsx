// @vitest-environment jsdom
//
// jsdom test (Phase 1B / Task 5): verifies the globe overlay chrome renders
// without a live WebGL map — <GlobeOverlay> only needs the store and its
// own refs, so it can be mounted directly here. The map itself (MapView,
// useGlobe's imperative map calls) is browser-verified via the dev/preview
// checks, not jsdom, since MapLibre requires a real WebGL canvas.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { useAppStore } from '@/shared/store'
import GlobeOverlay from './globe/GlobeOverlay'

afterEach(cleanup)

describe('globe overlay chrome', () => {
  it('shows the ENTER THEATER control in the globe scene', () => {
    useAppStore.setState({ scene: 'globe', layer: 'dark', offline: false })
    render(
      <GlobeOverlay
        onEnter={() => {}}
        tagRef={{ current: null }}
        altRef={{ current: null }}
        enterBtnRef={{ current: null }}
      />,
    )
    expect(screen.getByRole('button', { name: /enter theater/i })).toBeTruthy()
  })
})
