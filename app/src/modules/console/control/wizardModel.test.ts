// Test file transcribed verbatim from the Phase 1E plan
// (docs/superpowers/plans/2026-07-25-phase1e-control-wizard-debrief.md,
// Task 3 / Step 1) — see wizardModel.ts's header for the legacy
// (assets/js/ui/control.js) line ranges each covered function ports.

import { describe, it, expect } from 'vitest'
import { SimEngine, DATA_DOCKS, GEO_UAE, MISSIONS_CONFIG } from '@/modules/console/domain'
import {
  isLawnmowerType,
  wizardBox,
  wizardStep2Valid,
  wizardDistanceKm,
  wizardDurationLabel,
  wizardPreviewFeatures,
  wizardReadyDocks,
  applyWizardClick,
} from './wizardModel'
import type { WizardState } from './wizardModel'

const base: WizardState = {
  step: 2,
  type: 'security',
  dockId: null,
  points: [],
  spacingM: 150,
  altM: null,
  speedMs: null,
  error: null,
  rangeWarning: null,
}

describe('wizard model', () => {
  it('isLawnmowerType follows MISSIONS_CONFIG.pattern', () => {
    for (const [type, cfg] of Object.entries(MISSIONS_CONFIG)) {
      expect(isLawnmowerType(type as never)).toBe(cfg.pattern === 'lawnmower')
    }
  })
  it('wizardBox clamps degenerate drags to 0.3km sides (control.js:234-235)', () => {
    const box = wizardBox({
      ...base,
      points: [
        [55.2, 25.1],
        [55.2, 25.1],
      ],
    })
    expect(box).not.toBe(null)
    expect(box!.widthKm).toBeCloseTo(0.3, 5)
    expect(box!.heightKm).toBeCloseTo(0.3, 5)
  })
  it('wizardBox needs two points', () => {
    expect(wizardBox({ ...base, points: [[55.2, 25.1]] })).toBe(null)
  })
  it('step 2 validity: 2 corners for lawnmower, >=2 waypoints otherwise', () => {
    const lawn = Object.entries(MISSIONS_CONFIG).find(([, c]) => c.pattern === 'lawnmower')?.[0]
    expect(wizardStep2Valid({ ...base, points: [[55.2, 25.1]] })).toBe(false)
    expect(
      wizardStep2Valid({
        ...base,
        points: [
          [55.2, 25.1],
          [55.3, 25.2],
        ],
      }),
    ).toBe(true)
    if (lawn) {
      const w = {
        ...base,
        type: lawn as never,
        points: [
          [55.2, 25.1],
          [55.3, 25.2],
          [55.4, 25.3],
        ] as never,
      }
      expect(wizardStep2Valid(w)).toBe(false)
    }
  })
  it('wizardDurationLabel matches control.js:268-272', () => {
    expect(wizardDurationLabel(0, 12)).toBe('--')
    expect(wizardDurationLabel(5, 0)).toBe('--')
    expect(wizardDurationLabel(0.1, 12)).toBe('<1 MIN')
    expect(wizardDurationLabel(12, 10)).toBe('20 MIN')
  })
  it('wizardDistanceKm grows with the clicked path', () => {
    const two = wizardDistanceKm({
      ...base,
      points: [
        [55.2, 25.1],
        [55.3, 25.1],
      ],
    })
    const three = wizardDistanceKm({
      ...base,
      points: [
        [55.2, 25.1],
        [55.3, 25.1],
        [55.4, 25.1],
      ],
    })
    expect(two).toBeGreaterThan(0)
    expect(three).toBeGreaterThan(two)
  })
  it('preview features are numbered points plus a joining line', () => {
    const fc = wizardPreviewFeatures({
      ...base,
      points: [
        [55.2, 25.1],
        [55.3, 25.2],
      ],
    })
    expect(fc.features.filter((f) => f.geometry.type === 'Point').length).toBe(2)
    expect(fc.features.filter((f) => f.geometry.type === 'LineString').length).toBe(1)
  })
  it('wizardReadyDocks only lists docks whose drone is actually docked', () => {
    const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
    for (let i = 0; i < 600; i++) e.tick(0.5)
    const docks = wizardReadyDocks(e, [54.9, 24.3])
    expect(docks.length).toBeGreaterThan(0)
    expect(docks.every((d) => d.state === 'ready' && d.drone.state === 'docked')).toBe(true)
  })
  it('a third lawnmower click restarts the box (control.js:564)', () => {
    const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
    const lawn = Object.entries(MISSIONS_CONFIG).find(([, c]) => c.pattern === 'lawnmower')?.[0]
    if (!lawn) return
    const dock = DATA_DOCKS[0]
    let w: WizardState = {
      ...base,
      type: lawn as never,
      dockId: dock.id,
      points: [dock.coords, dock.coords],
    }
    w = applyWizardClick(e, w, dock.coords)
    expect(w.points.length).toBe(1)
  })
})
