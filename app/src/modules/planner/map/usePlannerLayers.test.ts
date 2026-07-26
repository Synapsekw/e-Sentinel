// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { usePlannerLayers } from './usePlannerLayers'
import { PLANNER_SOURCES } from './plannerStyle'
import { createPlan, addAoi, addDock } from '../domain/plan'
import type { Aoi, CoverageResult, DeploymentPlan, PlannedDock } from '../domain/types'
import type { PlannerSelection } from '../store/planStore'

// Same fake-map convention as useDockPlacement.test.ts: only the slice of
// maplibregl.Map this hook actually touches (getSource().setData, plus the
// `style` field isMapUsable probes). Task 8 adds getLayer/setFilter to that
// slice for the selection-highlight effect, which calls both.
function makeFakeMap() {
  const setDataSpies: Record<string, ReturnType<typeof vi.fn>> = {
    [PLANNER_SOURCES.aoi]: vi.fn(),
    [PLANNER_SOURCES.docks]: vi.fn(),
    [PLANNER_SOURCES.rings]: vi.fn(),
    [PLANNER_SOURCES.gaps]: vi.fn(),
  }
  const sources = Object.fromEntries(
    Object.entries(setDataSpies).map(([id, setData]) => [id, { setData }]),
  )
  const setFilter = vi.fn()
  const map = {
    style: {},
    getSource: vi.fn((id: string) => sources[id]),
    // Both highlight layers exist in the real style, so getLayer must return
    // something truthy for their ids -- the hook only calls setFilter when
    // getLayer says the layer is there.
    getLayer: vi.fn(() => ({})),
    setFilter,
  }
  return {
    map: map as unknown as maplibregl.Map,
    setDataSpies,
    setFilter,
    ringsSetData: setDataSpies[PLANNER_SOURCES.rings],
  }
}

const AOI: Aoi = {
  id: 'aoi-1',
  name: 'AOI 1',
  source: 'drawn',
  valid: true,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [54.5, 24.2],
        [54.7, 24.2],
        [54.7, 24.4],
        [54.5, 24.4],
        [54.5, 24.2],
      ],
    ],
  },
}

const DOCK: PlannedDock = {
  id: 'dock-1',
  name: 'DOCK 01',
  position: [54.6, 24.3],
  dockModel: 'DOCK3',
  droneModel: 'M4TD',
  environment: 'rural',
  source: 'manual',
}

const NO_AOI: CoverageResult = { ok: false, reason: 'no-aoi' }

describe('usePlannerLayers', () => {
  afterEach(() => {
    // No test.globals in this repo's vite config -- see useDockPlacement.
    // test.ts's identical note.
    cleanup()
  })

  it('feeds the aoi/dock/ring sources on mount', () => {
    const { map, setDataSpies } = makeFakeMap()
    const mapRef: MutableRefObject<maplibregl.Map | null> = { current: map }
    const plan = addDock(addAoi(createPlan(), AOI), DOCK)

    renderHook(() => usePlannerLayers(mapRef, true, plan, NO_AOI, null))

    expect(setDataSpies[PLANNER_SOURCES.aoi]).toHaveBeenCalledTimes(1)
    expect(setDataSpies[PLANNER_SOURCES.docks]).toHaveBeenCalledTimes(1)
    expect(setDataSpies[PLANNER_SOURCES.rings]).toHaveBeenCalledTimes(1)
  })

  it('does not touch the map again when only cosmetic plan fields change (Important 8)', () => {
    // Before this fix, this effect depended on `plan` itself, so it rebuilt
    // every dock ring buffer (64 steps each) on every plan edit whatsoever,
    // including a plan name/customer keystroke that never touches aois or
    // docks.
    const { map, setDataSpies } = makeFakeMap()
    const mapRef: MutableRefObject<maplibregl.Map | null> = { current: map }
    const plan = addDock(addAoi(createPlan(), AOI), DOCK)

    const { rerender } = renderHook(
      ({ p }: { p: DeploymentPlan }) => usePlannerLayers(mapRef, true, p, NO_AOI, null),
      {
        initialProps: { p: plan },
      },
    )

    setDataSpies[PLANNER_SOURCES.aoi].mockClear()
    setDataSpies[PLANNER_SOURCES.docks].mockClear()
    setDataSpies[PLANNER_SOURCES.rings].mockClear()

    // Same aois/docks references, only name/customer/rev differ -- exactly
    // what PlanTree.tsx's renamePlan produces for a cosmetic edit.
    const renamed: DeploymentPlan = {
      ...plan,
      name: 'Renamed',
      customer: 'ACME',
      rev: plan.rev + 1,
    }
    rerender({ p: renamed })

    expect(setDataSpies[PLANNER_SOURCES.aoi]).not.toHaveBeenCalled()
    expect(setDataSpies[PLANNER_SOURCES.docks]).not.toHaveBeenCalled()
    expect(setDataSpies[PLANNER_SOURCES.rings]).not.toHaveBeenCalled()
  })

  it('still feeds the map once a genuine dock edit follows a cosmetic one', () => {
    const { map, setDataSpies } = makeFakeMap()
    const mapRef: MutableRefObject<maplibregl.Map | null> = { current: map }
    const plan = addDock(addAoi(createPlan(), AOI), DOCK)

    const { rerender } = renderHook(
      ({ p }: { p: DeploymentPlan }) => usePlannerLayers(mapRef, true, p, NO_AOI, null),
      {
        initialProps: { p: plan },
      },
    )

    const renamed: DeploymentPlan = { ...plan, name: 'Renamed', rev: plan.rev + 1 }
    rerender({ p: renamed })
    setDataSpies[PLANNER_SOURCES.docks].mockClear()

    const movedDocks = plan.docks.map((d) => ({
      ...d,
      position: [54.61, 24.31] as [number, number],
    }))
    const edited: DeploymentPlan = { ...renamed, docks: movedDocks, rev: renamed.rev + 1 }
    rerender({ p: edited })

    expect(setDataSpies[PLANNER_SOURCES.docks]).toHaveBeenCalledTimes(1)
  })
})

describe('usePlannerLayers selection highlight', () => {
  it('filters the highlight ring to the selected dock', () => {
    const fake = makeFakeMap()
    const mapRef = { current: fake.map }
    renderHook(() =>
      usePlannerLayers(
        mapRef,
        true,
        createPlan(),
        { ok: false, reason: 'no-aoi' },
        {
          type: 'dock',
          id: 'dock-7',
        },
      ),
    )
    expect(fake.setFilter).toHaveBeenCalledWith('planner-rings-line-hi', [
      '==',
      ['get', 'id'],
      'dock-7',
    ])
  })

  it('filters the highlight ring to nothing when there is no selection', () => {
    const fake = makeFakeMap()
    const mapRef = { current: fake.map }
    renderHook(() =>
      usePlannerLayers(mapRef, true, createPlan(), { ok: false, reason: 'no-aoi' }, null),
    )
    expect(fake.setFilter).toHaveBeenCalledWith('planner-rings-line-hi', ['==', ['get', 'id'], ''])
  })

  it('filters the AOI outline highlight to the selected area', () => {
    const fake = makeFakeMap()
    const mapRef = { current: fake.map }
    renderHook(() =>
      usePlannerLayers(
        mapRef,
        true,
        createPlan(),
        { ok: false, reason: 'no-aoi' },
        {
          type: 'aoi',
          id: 'aoi-2',
        },
      ),
    )
    expect(fake.setFilter).toHaveBeenCalledWith('planner-aoi-line-hi', [
      '==',
      ['get', 'id'],
      'aoi-2',
    ])
  })

  it('does not rebuild ring geometry when only the selection changes', () => {
    // The load-bearing performance assertion: a selection click must not
    // rebuild N 64-step ring buffers. Same reasoning as Important 8's
    // plan.aois/plan.docks dependency narrowing.
    const fake = makeFakeMap()
    const mapRef = { current: fake.map }
    const plan = createPlan()
    const coverage = { ok: false, reason: 'no-aoi' } as const
    const { rerender } = renderHook(
      ({ selection }) => usePlannerLayers(mapRef, true, plan, coverage, selection),
      { initialProps: { selection: null as PlannerSelection } },
    )
    fake.ringsSetData.mockClear()
    rerender({ selection: { type: 'dock', id: 'dock-1' } })
    expect(fake.ringsSetData).not.toHaveBeenCalled()
  })
})
