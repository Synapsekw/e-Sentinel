// Route root. Composes the planner chrome (topbar/side/rpanel/summary
// strip) around MapView, and wires the map-bound hooks -- useCoverageDriver,
// usePlannerLayers, useAoiDraw, useDockPlacement -- from inside
// <PlannerShell>, a child of <MapView>. MapView renders `{ready ? children :
// null}`, so PlannerShell (and everything it renders) only mounts once the
// map's `load` event has fired; useAoiDraw/useDockPlacement both need a
// real map instance to construct against (terra-draw's adapter, dragPan
// enable/disable), so they cannot run any earlier than that.
//
// Task 3's temporary scaffolding button (`AoiDrawTrigger`, a raw inline-
// styled <button> spiking useAoiDraw end to end) is removed here, replaced
// by the real chrome below.
import { useEffect, useState } from 'react'
import type GeoJSON from 'geojson'
import MapView from '@/modules/console/map/MapView'
import { useMap } from '@/modules/console/map/MapContext'
import { useAoiDraw } from '@/modules/planner/map/useAoiDraw'
import type { AoiDrawMode } from '@/modules/planner/map/useAoiDraw'
import { useDockPlacement } from '@/modules/planner/map/useDockPlacement'
import { usePlannerLayers } from '@/modules/planner/map/usePlannerLayers'
import { useCoverageDriver } from '@/modules/planner/engine/useCoverageDriver'
import { buildPlannerStyle } from '@/modules/planner/map/plannerStyle'
import { usePlanStore } from '@/modules/planner/store/planStore'
import { addAoi, nextId, setDocks } from '@/modules/planner/domain/plan'
import { suggestLayout } from '@/modules/planner/domain/autoPlace'
import { serializePlan, parsePlan } from '@/modules/planner/domain/planIo'
import { importAoiFile } from '@/modules/planner/io/kml'
import type { Aoi, DeploymentPlan } from '@/modules/planner/domain/types'
import PlannerTopbar from './PlannerTopbar'
import PlanTree from './PlanTree'
import Inspector from './Inspector'
import SummaryStrip from './SummaryStrip'
import './planner.css'

// Working camera for the planner: the whole UAE in frame at a zoom you can
// actually place docks at, rather than the console's orbital globe entry.
const PLANNER_CENTER: [number, number] = [54.6, 24.3]
const PLANNER_ZOOM = 6.4

// Debounced localStorage autosave for convenience; plan JSON export/import
// (planIo.ts, wired below via EXPORT PLAN / IMPORT PLAN) is the source of
// truth -- see the design doc's data-flow section. A corrupted or
// version-mismatched autosave is treated the same as "nothing saved yet"
// (falls back to the default blank plan) rather than surfaced as an error:
// unlike a user-initiated import, this runs silently on every mount and a
// stale localStorage entry from an old build must never block the app from
// loading.
const AUTOSAVE_KEY = 'planner.autosave.v1'
const AUTOSAVE_DEBOUNCE_MS = 500

function loadAutosave(): DeploymentPlan | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY)
    if (!raw) return null
    const result = parsePlan(raw)
    return result.ok ? result.plan : null
  } catch (err) {
    console.error('[planner] could not read autosave', err)
    return null
  }
}

type ImportMessage = { level: 'error' | 'info'; text: string } | null

function PlannerShell() {
  const { mapRef, ready } = useMap()
  const plan = usePlanStore((s) => s.plan)
  const coverage = usePlanStore((s) => s.coverage)
  const [drawMode, setDrawMode] = useState<AoiDrawMode>('idle')
  const [importMessage, setImportMessage] = useState<ImportMessage>(null)

  useCoverageDriver()
  usePlannerLayers(mapRef, ready, plan, coverage)

  function handleDrawFinish(geometry: GeoJSON.Polygon) {
    const state = usePlanStore.getState()
    const aoi: Aoi = {
      id: nextId('aoi'),
      name: `AOI ${state.plan.aois.length + 1}`,
      geometry,
      source: 'drawn',
      valid: true,
    }
    state.setPlan(addAoi(state.plan, aoi))
  }

  const draw = useAoiDraw(mapRef, ready, { onFinish: handleDrawFinish })
  const dockPlacement = useDockPlacement(mapRef, ready)

  // Escape stands down an in-progress draw, the same convention
  // useDockPlacement already applies to armed dock placement. useAoiDraw
  // itself exposes cancel()/setMode() but wires no keyboard handling of its
  // own (see its module comment) -- that's this component's job, since it's
  // the thing that owns `drawMode`.
  useEffect(() => {
    if (drawMode === 'idle') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      draw.cancel()
      setDrawMode('idle')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawMode, draw])

  function handleSetDrawMode(mode: AoiDrawMode) {
    setDrawMode(mode)
    draw.setMode(mode)
  }
  function handleCancelDraw() {
    draw.cancel()
    setDrawMode('idle')
  }
  function handleToggleDockPlacement() {
    if (dockPlacement.placing) dockPlacement.cancel()
    else dockPlacement.startPlacing()
  }

  async function handleImportAoiFile(file: File) {
    const result = await importAoiFile(file)
    if (!result.ok) {
      setImportMessage({ level: 'error', text: result.message })
      return
    }
    const state = usePlanStore.getState()
    let next = state.plan
    for (const aoi of result.aois) next = addAoi(next, aoi)
    state.setPlan(next)
    setImportMessage({
      level: 'info',
      text:
        result.skipped > 0
          ? `${result.aois.length} AREAS IMPORTED · ${result.skipped} FEATURES SKIPPED`
          : `${result.aois.length} AREA${result.aois.length === 1 ? '' : 'S'} IMPORTED`,
    })
  }

  async function handleImportPlanFile(file: File) {
    const text = await file.text()
    const result = parsePlan(text)
    if (!result.ok) {
      setImportMessage({ level: 'error', text: result.message })
      return
    }
    usePlanStore.getState().setPlan(result.plan)
    setImportMessage({ level: 'info', text: 'PLAN IMPORTED' })
  }

  function handleExportPlan() {
    const current = usePlanStore.getState().plan
    const blob = new Blob([serializePlan(current)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${current.name.trim().toLowerCase().replace(/\s+/g, '-') || 'plan'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleSuggestLayout() {
    const state = usePlanStore.getState()
    const result = suggestLayout(state.plan)
    state.setPlan(setDocks(state.plan, result.docks))
  }

  return (
    <>
      <PlannerTopbar
        drawMode={drawMode}
        onSetDrawMode={handleSetDrawMode}
        onCancelDraw={handleCancelDraw}
        placingDock={dockPlacement.placing}
        onToggleDockPlacement={handleToggleDockPlacement}
        onImportAoiFile={(file) => void handleImportAoiFile(file)}
        onImportPlanFile={(file) => void handleImportPlanFile(file)}
        onExportPlan={handleExportPlan}
        onSuggestLayout={handleSuggestLayout}
      />
      {importMessage ? (
        <div className={`pl-alert${importMessage.level === 'error' ? ' pl-alert-error' : ''}`}>
          <span>{importMessage.text}</span>
          <button
            type="button"
            className="pl-alert-dismiss"
            aria-label="Dismiss"
            onClick={() => setImportMessage(null)}
          >
            ×
          </button>
        </div>
      ) : null}
      <aside className="pl-side">
        <PlanTree />
      </aside>
      <aside className="pl-rpanel">
        <Inspector />
      </aside>
      <SummaryStrip coverage={coverage} dockCount={plan.docks.length} />
    </>
  )
}

export default function Planner() {
  const plan = usePlanStore((s) => s.plan)

  useEffect(() => {
    const loaded = loadAutosave()
    if (loaded) usePlanStore.getState().setPlan(loaded)
    // Runs once on mount only, to restore the last autosaved plan before the
    // user starts editing. Re-running on every `plan` change would fight the
    // autosave effect below (load, then immediately overwrite the fresh
    // load right back with itself).
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, serializePlan(plan))
      } catch (err) {
        console.error('[planner] could not write autosave', err)
      }
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [plan])

  return (
    <div className="planner-root">
      <MapView
        initialCenter={PLANNER_CENTER}
        initialZoom={PLANNER_ZOOM}
        styleSpec={buildPlannerStyle()}
      >
        <PlannerShell />
      </MapView>
    </div>
  )
}
