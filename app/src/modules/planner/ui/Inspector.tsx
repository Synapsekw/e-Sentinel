// Right panel: the inspector for whatever is currently selected. Reads/
// writes the store directly, same convention as PlanTree.tsx (see its
// header comment on why store methods are always called off getState()
// rather than destructured).
import type { ChangeEvent } from 'react'
import { usePlanStore } from '../store/planStore'
import { removeAoi, removeDock, updateDock } from '../domain/plan'
import { DOCK_MODELS, DRONES, effectiveRadius } from '../domain/catalog'
import type { DockModelId, DroneModelId, PlannedDock } from '../domain/types'
import { aoiAreaKm2 } from './aoiGeometry'

// DOCK_MODELS is keyed by the full DockModelId union, so widening
// Object.keys back to that union here is safe -- not a structural `any`,
// just Object.keys' inherent string[] signature.
const DOCK_MODEL_IDS = Object.keys(DOCK_MODELS) as DockModelId[]

function patchDock(dockId: string, patch: Partial<PlannedDock>): void {
  const state = usePlanStore.getState()
  state.setPlan(updateDock(state.plan, dockId, patch))
}

function DockInspector({ dockId }: { dockId: string }) {
  const plan = usePlanStore((s) => s.plan)
  const found = plan.docks.find((d) => d.id === dockId)
  if (!found) return <div className="pl-inspector-empty lbl">DOCK NOT FOUND</div>
  // TypeScript's control-flow narrowing from the guard above does not
  // survive into the closures below (handleModel etc.) -- same reasoning as
  // SitePanel.tsx's siteOrMissing/site split. A fresh const typed as
  // non-nullable PlannedDock sidesteps needing a `!` assertion at every use.
  const dock: PlannedDock = found

  const breakdown = effectiveRadius(dock)
  const compatibleDrones = DOCK_MODELS[dock.dockModel].drones

  // Carried item 1: DOCK_MODELS' drone compatibility was inert before this
  // task (nothing read it). Enforced here in both directions -- the drone
  // <select>'s options are filtered to the current dock model's list, and
  // switching dock model itself must not leave an incompatible drone
  // selected, so the target model's first compatible drone is substituted
  // in the same patch when the current one isn't in the new list.
  function handleModel(e: ChangeEvent<HTMLSelectElement>) {
    const model = e.target.value as DockModelId
    const allowed = DOCK_MODELS[model].drones
    const nextDrone: DroneModelId = allowed.includes(dock.droneModel) ? dock.droneModel : allowed[0]
    patchDock(dockId, { dockModel: model, droneModel: nextDrone })
  }
  function handleDrone(e: ChangeEvent<HTMLSelectElement>) {
    patchDock(dockId, { droneModel: e.target.value as DroneModelId })
  }
  function handleEnvironment(e: ChangeEvent<HTMLSelectElement>) {
    patchDock(dockId, { environment: e.target.value as PlannedDock['environment'] })
  }
  function handleName(e: ChangeEvent<HTMLInputElement>) {
    patchDock(dockId, { name: e.target.value })
  }
  function handleOverride(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    patchDock(dockId, { radiusKmOverride: raw === '' ? undefined : Number(raw) })
  }
  function handleRemove() {
    const state = usePlanStore.getState()
    state.setPlan(removeDock(state.plan, dockId))
    state.select(null)
  }

  const boundLabel =
    breakdown.bound === 'endurance'
      ? 'AIRCRAFT ENDURANCE'
      : breakdown.bound === 'cap'
        ? 'ENVIRONMENT CAP'
        : 'MANUAL OVERRIDE'

  return (
    <div className="pl-inspector">
      <h4 className="lbl">Dock</h4>
      <label className="pl-field">
        <span className="lbl">Name</span>
        <input className="pl-input" value={dock.name} onChange={handleName} />
      </label>
      <label className="pl-field">
        <span className="lbl">Dock model</span>
        <select className="pl-input" value={dock.dockModel} onChange={handleModel}>
          {DOCK_MODEL_IDS.map((id) => (
            <option key={id} value={id}>
              {DOCK_MODELS[id].label}
            </option>
          ))}
        </select>
      </label>
      <label className="pl-field">
        <span className="lbl">Drone</span>
        <select className="pl-input" value={dock.droneModel} onChange={handleDrone}>
          {compatibleDrones.map((id) => (
            <option key={id} value={id}>
              {DRONES[id].label}
            </option>
          ))}
        </select>
      </label>
      <label className="pl-field">
        <span className="lbl">Environment</span>
        <select className="pl-input" value={dock.environment} onChange={handleEnvironment}>
          <option value="urban">URBAN</option>
          <option value="rural">RURAL</option>
        </select>
      </label>
      <label className="pl-field">
        <span className="lbl">Radius override KM (blank = derived)</span>
        <input
          className="pl-input"
          type="number"
          min={0}
          step={0.1}
          value={dock.radiusKmOverride ?? ''}
          onChange={handleOverride}
        />
      </label>

      <div className="pl-radius">
        <div className="pl-radius-val">{breakdown.radiusKm.toFixed(2)} KM</div>
        <div className="lbl">BOUND BY {boundLabel}</div>
        {breakdown.bound === 'cap' ? (
          <div className="lbl pl-radius-headroom">
            AIRFRAME REACHES {breakdown.enduranceKm.toFixed(2)} KM ·{' '}
            {(breakdown.enduranceKm - breakdown.capKm).toFixed(2)} KM HEADROOM UNUSED
          </div>
        ) : null}
      </div>

      <button type="button" className="pl-remove-btn" onClick={handleRemove}>
        REMOVE DOCK
      </button>
    </div>
  )
}

function AoiInspector({ aoiId }: { aoiId: string }) {
  const plan = usePlanStore((s) => s.plan)
  const aoi = plan.aois.find((a) => a.id === aoiId)
  if (!aoi) return <div className="pl-inspector-empty lbl">AREA NOT FOUND</div>

  function handleName(e: ChangeEvent<HTMLInputElement>) {
    const state = usePlanStore.getState()
    state.setPlan({
      ...state.plan,
      aois: state.plan.aois.map((a) => (a.id === aoiId ? { ...a, name: e.target.value } : a)),
      rev: state.plan.rev + 1,
      updatedAt: new Date().toISOString(),
    })
  }
  function handleRemove() {
    const state = usePlanStore.getState()
    state.setPlan(removeAoi(state.plan, aoiId))
    state.select(null)
  }

  return (
    <div className="pl-inspector">
      <h4 className="lbl">Area of interest</h4>
      <label className="pl-field">
        <span className="lbl">Name</span>
        <input className="pl-input" value={aoi.name} onChange={handleName} />
      </label>
      <div className="pl-kv">
        <span className="lbl">Area</span>
        <span>{aoiAreaKm2(aoi).toFixed(1)} KM2</span>
      </div>
      <div className="pl-kv">
        <span className="lbl">Source</span>
        <span>{aoi.source.toUpperCase()}</span>
      </div>
      {aoi.simplifiedFrom != null ? (
        <div className="pl-kv">
          <span className="lbl">Simplified</span>
          <span>FROM {aoi.simplifiedFrom} VERTICES</span>
        </div>
      ) : null}
      {!aoi.valid ? (
        <span className="pl-badge pl-badge-alert">INVALID GEOMETRY · EXCLUDED FROM COVERAGE</span>
      ) : null}

      <button type="button" className="pl-remove-btn" onClick={handleRemove}>
        REMOVE AREA
      </button>
    </div>
  )
}

export default function Inspector() {
  const selection = usePlanStore((s) => s.selection)
  if (!selection) {
    return (
      <div className="pl-inspector-empty">
        <span className="lbl">NOTHING SELECTED</span>
      </div>
    )
  }
  return selection.type === 'aoi' ? (
    <AoiInspector aoiId={selection.id} />
  ) : (
    <DockInspector dockId={selection.id} />
  )
}
