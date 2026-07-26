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
  // Finding 4: parsePlan deliberately does not validate dock/drone
  // compatibility (see planIo.ts), so an imported or hand-edited plan can
  // carry a droneModel that isn't in this dock model's compatible list. A
  // <select> whose value doesn't match any of its <option>s silently falls
  // back to displaying a *different* option than what's actually stored --
  // the user would see a drone that isn't the one in their plan, with no
  // indication anything is wrong. Tracking this explicitly, rather than just
  // trusting the option list, is what lets the render below add the stored
  // value back in (visibly marked) when it would otherwise have no matching
  // option.
  const droneIsCompatible = compatibleDrones.includes(dock.droneModel)

  // Carried item 1: DOCK_MODELS' drone compatibility was inert before this
  // task (nothing read it). Enforced here in both directions -- the drone
  // <select>'s options are filtered to the current dock model's list, and
  // switching dock model itself must not leave an incompatible drone
  // selected, so the target model's first compatible drone is substituted
  // in the same patch when the current one isn't in the new list.
  function handleModel(e: ChangeEvent<HTMLSelectElement>) {
    // Type-only: e.target.value is always a string; DOCK_MODEL_IDS is exactly
    // the <option> values rendered below, so this only ever narrows a value
    // that already came from this same DockModelId union.
    const model = e.target.value as DockModelId
    const allowed = DOCK_MODELS[model].drones
    const nextDrone: DroneModelId = allowed.includes(dock.droneModel) ? dock.droneModel : allowed[0]
    patchDock(dockId, { dockModel: model, droneModel: nextDrone })
  }
  function handleDrone(e: ChangeEvent<HTMLSelectElement>) {
    // Type-only: every <option> below (compatible or the incompatible
    // stored-value fallback) is rendered with a DroneModelId as its value.
    patchDock(dockId, { droneModel: e.target.value as DroneModelId })
  }
  function handleEnvironment(e: ChangeEvent<HTMLSelectElement>) {
    // Type-only: the two <option> values below ('urban' | 'rural') are
    // exactly PlannedDock['environment']; there is no third value this
    // select can ever produce.
    patchDock(dockId, { environment: e.target.value as PlannedDock['environment'] })
  }
  function handleName(e: ChangeEvent<HTMLInputElement>) {
    patchDock(dockId, { name: e.target.value })
  }
  // Real user interaction with a range input cannot land on the empty or
  // partial states (a bare "-" or "." mid-typing) the old number box needed
  // a NaN guard for -- the browser only ever hands back a value on the slider's
  // own step/min/max grid. That's a fact about the UI, not a type guarantee:
  // a raw fireEvent.change in a test, or other direct DOM manipulation, can
  // still set an arbitrary string. Clearing the override is a separate,
  // explicit action -- see handleResetRadius.
  function handleRadius(e: ChangeEvent<HTMLInputElement>) {
    patchDock(dockId, { radiusKmOverride: Number(e.target.value) })
  }
  function handleResetRadius() {
    patchDock(dockId, { radiusKmOverride: undefined })
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
          {!droneIsCompatible ? (
            // The stored value has no matching option above: render it too,
            // visibly marked, so the select shows the truth (what's actually
            // stored) instead of the browser silently falling back to
            // displaying the first compatible option in its place.
            <option value={dock.droneModel}>{DRONES[dock.droneModel].label} · INCOMPATIBLE</option>
          ) : null}
        </select>
      </label>
      {!droneIsCompatible ? (
        // Deliberately outside the <label> above: text inside a <label> that
        // wraps a control becomes part of that control's accessible name, so
        // nesting this here would silently change what "Drone" resolves to
        // for label-based lookups (both testing-library's getByLabelText and
        // real assistive tech).
        <span className="pl-badge pl-badge-alert">
          {DRONES[dock.droneModel].label.toUpperCase()} IS NOT COMPATIBLE WITH{' '}
          {DOCK_MODELS[dock.dockModel].label.toUpperCase()}
        </span>
      ) : null}
      <label className="pl-field">
        <span className="lbl">Environment</span>
        <select className="pl-input" value={dock.environment} onChange={handleEnvironment}>
          <option value="urban">URBAN</option>
          <option value="rural">RURAL</option>
        </select>
      </label>
      <label className="pl-field">
        <span className="lbl">Coverage radius</span>
        <input
          className="pl-slider"
          type="range"
          // Not 0: a zero-radius dock has no buffer at all, and
          // domain/coverage.ts drops a dock with no buffer from the result,
          // which with a single dock collapses computeCoverage to
          // { ok: false, reason: 'degenerate' } -- a completely uncovered AOI
          // would then paint no red gap overlay and the summary strip would
          // report a geometry problem instead of 0% coverage. 0.1 keeps the
          // far-left stop a real, if tiny, dock.
          min={0.1}
          step={0.1}
          // The airframe's physical reach is the ceiling: a planning tool
          // should not let you draw a ring the aircraft cannot fly. One
          // exception -- parsePlan deliberately does not validate this field
          // (see planIo.ts), so an imported or hand-edited plan can carry a
          // larger value. Extend the max to it rather than clamping, so the
          // control shows what is actually stored. Same principle as the
          // incompatible-drone <option> above: never display a value other
          // than the one the plan holds.
          max={Math.max(Math.ceil(breakdown.enduranceKm), Math.ceil(dock.radiusKmOverride ?? 0))}
          value={breakdown.radiusKm}
          onChange={handleRadius}
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
        {dock.radiusKmOverride != null ? (
          // A slider has no empty state, so this is the only way back to the
          // derived radius. The old number input got it for free by being
          // cleared; without this the derived value is unreachable once the
          // slider is touched.
          <button type="button" className="pl-reset-btn" onClick={handleResetRadius}>
            RESET TO DERIVED
          </button>
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
