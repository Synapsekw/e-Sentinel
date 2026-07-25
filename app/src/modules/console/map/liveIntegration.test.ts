// End-to-end integration test for the Phase 1C live binding.
//
// Every other test in this phase covers a unit in isolation (clock math,
// individual builders, the render-loop's timing logic). This one exercises the
// REAL chain the console depends on: a real seeded engine from the domain, a
// real LiveLayerUpdater, and a map stub that records what actually reaches each
// GeoJSON source — driven over simulated time the way the rAF loop drives it.
//
// It exists because the sim's most valuable property (drones actually appear on
// the map and keep moving) was otherwise only ever proven by hand in a browser,
// which cannot run in CI.
import { describe, it, expect } from 'vitest'
import type { FeatureCollection } from 'geojson'
import type maplibregl from 'maplibre-gl'
import { SimEngine, DATA_DOCKS, GEO_UAE } from '@/modules/console/domain'
import type { Engine } from '@/modules/console/domain'
import { createLiveLayerUpdater } from './updateLiveLayers'

// Records every setData payload per source id, plus setFilter calls, so the
// test can assert on what the updater actually pushed rather than on internals.
interface SourceRecord {
  setDataCalls: number
  last: FeatureCollection | null
}

function createMapStub() {
  const sources = new Map<string, SourceRecord>()
  const filters: { layerId: string; filter: unknown }[] = []
  const ids = ['docks', 'drones', 'drone-leaders', 'drone-trails', 'missions-active', 'tracks']
  for (const id of ids) sources.set(id, { setDataCalls: 0, last: null })

  const map = {
    getSource(id: string) {
      const rec = sources.get(id)
      if (!rec) return undefined
      // `setData` presence is what asGeoJSONSource narrows on.
      return {
        setData(data: FeatureCollection) {
          rec.setDataCalls += 1
          rec.last = data
        },
      }
    },
    getLayer(id: string) {
      return id === 'coverage-fill' || id === 'coverage-line-hi' ? { id } : undefined
    },
    setFilter(layerId: string, filter: unknown) {
      filters.push({ layerId, filter })
    },
  }

  return {
    map: map as unknown as maplibregl.Map,
    sources,
    filters,
    count(id: string) {
      return sources.get(id)?.last?.features.length ?? 0
    },
  }
}

function airborneCount(engine: Engine): number {
  let n = 0
  for (const d of engine.drones.values()) if (d.state !== 'docked') n++
  return n
}

// Advance the sim the way the app does: engine.tick() in fixed sub-steps, with
// the live-layer update running once per "frame" in between.
function runSim(
  engine: Engine,
  update: () => void,
  { seconds, stepS = 0.5 }: { seconds: number; stepS?: number },
) {
  const steps = Math.round(seconds / stepS)
  for (let i = 0; i < steps; i++) {
    engine.tick(stepS)
    update()
  }
}

function bootEngine(): Engine {
  return SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
}

describe('live sim binding (engine -> map sources)', () => {
  it('flies drones onto the map and keeps the drones source in step with engine state', () => {
    const engine = bootEngine()
    const updater = createLiveLayerUpdater()
    const h = createMapStub()

    runSim(engine, () => updater.update(engine, h.map, null, null, true), { seconds: 240 })

    // The whole point of the phase: drones are actually airborne and rendered.
    const airborne = airborneCount(engine)
    expect(airborne).toBeGreaterThan(0)

    // Cross-validates two independent code paths (engine state vs the features
    // the map received) — the check that would catch a builder filtering bug.
    expect(h.count('drones')).toBe(airborne)

    // Every rendered drone must be positionable and orientable.
    const drones = h.sources.get('drones')?.last
    expect(drones).not.toBeNull()
    for (const f of drones!.features) {
      expect(f.geometry.type).toBe('Point')
      if (f.geometry.type !== 'Point') continue // narrows the GeoJSON union
      const [lon, lat] = f.geometry.coordinates
      expect(Number.isFinite(lon)).toBe(true)
      expect(Number.isFinite(lat)).toBe(true)
      expect(typeof f.properties?.heading).toBe('number')
    }

    // Docks always render (they are the static grid), one feature per dock.
    expect(h.count('docks')).toBe(DATA_DOCKS.length)
  })

  it('accumulates breadcrumb trails as drones move', () => {
    const engine = bootEngine()
    const updater = createLiveLayerUpdater()
    const h = createMapStub()

    runSim(engine, () => updater.update(engine, h.map, null, null, true), { seconds: 600 })

    const trails = h.sources.get('drone-trails')?.last
    expect(trails).not.toBeNull()
    // A trail only materialises once a drone has covered >= TRAIL_MIN_STEP_M
    // twice, so this also proves drones are genuinely travelling, not hovering.
    expect(trails!.features.length).toBeGreaterThan(0)
    for (const f of trails!.features) {
      expect(f.geometry.type).toBe('LineString')
      if (f.geometry.type !== 'LineString') continue // narrows the GeoJSON union
      const coords = f.geometry.coordinates
      expect(coords.length).toBeGreaterThanOrEqual(2)
      expect(coords.length).toBeLessThanOrEqual(40) // TRAIL_MAX_POINTS
    }
  })

  it('renders active mission routes and only re-pushes them when they change', () => {
    const engine = bootEngine()
    const updater = createLiveLayerUpdater()
    const h = createMapStub()

    const frames = 480
    runSim(engine, () => updater.update(engine, h.map, null, null, true), {
      seconds: frames * 0.5,
    })

    let activeMissions = 0
    for (const m of engine.missions.values()) if (m.state === 'active') activeMissions++
    expect(h.count('missions-active')).toBe(activeMissions)

    // The dirty-check must keep mission setData far below once-per-frame;
    // without it every frame would re-serialise every route.
    const missionCalls = h.sources.get('missions-active')?.setDataCalls ?? 0
    expect(missionCalls).toBeGreaterThan(0)
    expect(missionCalls).toBeLessThan(frames / 2)

    // Drones, by contrast, must update every frame (they move continuously).
    expect(h.sources.get('drones')?.setDataCalls).toBe(frames)
  })

  it('pushes nothing at all until the map ready latch is true', () => {
    // Regression guard for the Phase 1C review Critical: gating on
    // MapLibre's map.loaded() (which flips false while sources are dirty)
    // instead of the one-way ready latch silently froze every live layer.
    const engine = bootEngine()
    const updater = createLiveLayerUpdater()
    const h = createMapStub()

    runSim(engine, () => updater.update(engine, h.map, null, null, false), { seconds: 120 })
    for (const [id, rec] of h.sources) {
      expect(rec.setDataCalls, `${id} must not be written before ready`).toBe(0)
    }

    // ...and resumes the moment the latch goes true, with no lost state.
    runSim(engine, () => updater.update(engine, h.map, null, null, true), { seconds: 120 })
    expect(h.sources.get('drones')?.setDataCalls).toBeGreaterThan(0)
    expect(h.count('docks')).toBe(DATA_DOCKS.length)
  })

  it('marks the selected dock and drives the coverage highlight filter', () => {
    const engine = bootEngine()
    const updater = createLiveLayerUpdater()
    const h = createMapStub()
    const dockId = DATA_DOCKS[0].id

    updater.update(engine, h.map, { type: 'dock', id: dockId }, null, true)

    const docks = h.sources.get('docks')?.last
    const selected = docks!.features.filter((f) => f.properties?.selected === true)
    expect(selected.length).toBe(1)
    expect(selected[0].properties?.id).toBe(dockId)

    // Coverage highlighting is filter-only (never setData on the big static
    // coverage source) — assert both highlight layers got filtered.
    const filtered = h.filters.map((f) => f.layerId)
    expect(filtered).toContain('coverage-fill')
    expect(filtered).toContain('coverage-line-hi')
  })
})
