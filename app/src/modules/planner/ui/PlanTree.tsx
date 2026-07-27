// Left panel: plan meta, the AOI list, the dock list and the coverage-params
// sliders that drive SUGGEST LAYOUT. Reads/writes the store directly
// (matching the console's own Topbar/Sidebar convention of subscribing to
// their store from inside the component, rather than being handed the plan
// as a prop) -- `select`/`setPlan`/`setCoverage` are all method-shorthand on
// PlanState, so (per useCoverageDriver.ts / useDockPlacement.ts's own notes)
// they are always called directly off getState() rather than being
// destructured into a standalone binding, to avoid @typescript-eslint/
// unbound-method flagging an unbound method reference.
import type { ChangeEvent } from 'react'
import { usePlanStore } from '../store/planStore'
import { removeAoi, removeDock, setParams } from '../domain/plan'
import type { DeploymentPlan } from '../domain/types'
import { formatAoiArea } from './aoiGeometry'

function commitPlan(next: DeploymentPlan): void {
  usePlanStore.getState().setPlan(next)
}

// Plan name/customer edits don't go through domain/plan.ts's `bump` (it's
// module-private, by design -- see plan.ts), so this mirrors its shape
// (rev++, updatedAt refreshed) directly. These two fields don't feed
// coverage math, but bumping rev/updatedAt anyway keeps every mutation
// path in this module consistent with the "every mutation returns a new
// object at a new rev" invariant the rest of the domain relies on.
function renamePlan(patch: Partial<Pick<DeploymentPlan, 'name' | 'customer'>>): void {
  const state = usePlanStore.getState()
  commitPlan({
    ...state.plan,
    ...patch,
    rev: state.plan.rev + 1,
    updatedAt: new Date().toISOString(),
  })
}

export default function PlanTree() {
  const plan = usePlanStore((s) => s.plan)
  const selection = usePlanStore((s) => s.selection)

  function handleTargetOverlap(e: ChangeEvent<HTMLInputElement>) {
    commitPlan(setParams(plan, { ...plan.params, targetOverlapPct: Number(e.target.value) }))
  }
  function handleRequiredCoverage(e: ChangeEvent<HTMLInputElement>) {
    commitPlan(setParams(plan, { ...plan.params, requiredCoveragePct: Number(e.target.value) }))
  }

  // A fragment, not a wrapper <div>: `.pl-side` is the flex column that spaces
  // these tiles 12px apart, and an intermediate element made that gap apply to
  // one single child instead of to the tiles -- they stacked flush, borders
  // touching. The console's Sidebar.tsx returns a fragment into `#side` for
  // exactly this reason.
  return (
    <>
      <div className="pl-panel">
        <h4 className="lbl">Plan</h4>
        <label className="pl-field">
          <span className="lbl">Name</span>
          <input
            className="pl-input"
            value={plan.name}
            onChange={(e) => renamePlan({ name: e.target.value })}
          />
        </label>
        <label className="pl-field">
          <span className="lbl">Customer</span>
          <input
            className="pl-input"
            value={plan.customer}
            onChange={(e) => renamePlan({ customer: e.target.value })}
          />
        </label>
      </div>

      <div className="pl-panel">
        <h4 className="lbl">Areas of interest · {plan.aois.length}</h4>
        {plan.aois.length === 0 ? (
          <span className="pl-empty lbl">NO AREAS YET</span>
        ) : (
          <div className="pl-list">
            {plan.aois.map((aoi) => {
              const isSel = selection?.type === 'aoi' && selection.id === aoi.id
              return (
                <div
                  key={aoi.id}
                  className={`pl-row${isSel ? ' sel' : ''}`}
                  onClick={() => usePlanStore.getState().select({ type: 'aoi', id: aoi.id })}
                >
                  <div className="pl-row-main">
                    <span className="pl-row-name">{aoi.name}</span>
                    <span className="pl-row-meta">{formatAoiArea(aoi)}</span>
                  </div>
                  {aoi.simplifiedFrom != null ? (
                    <span className="pl-badge" title={`ORIGINAL ${aoi.simplifiedFrom} VERTICES`}>
                      SIMPLIFIED
                    </span>
                  ) : null}
                  {!aoi.valid ? <span className="pl-badge pl-badge-alert">INVALID</span> : null}
                  <button
                    type="button"
                    className="pl-row-remove"
                    aria-label={`Remove ${aoi.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      commitPlan(removeAoi(usePlanStore.getState().plan, aoi.id))
                    }}
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="pl-panel">
        <h4 className="lbl">Docks · {plan.docks.length}</h4>
        {plan.docks.length === 0 ? (
          <span className="pl-empty lbl">NO DOCKS PLACED</span>
        ) : (
          <div className="pl-list">
            {plan.docks.map((dock) => {
              const isSel = selection?.type === 'dock' && selection.id === dock.id
              return (
                <div
                  key={dock.id}
                  className={`pl-row${isSel ? ' sel' : ''}`}
                  onClick={() => usePlanStore.getState().select({ type: 'dock', id: dock.id })}
                >
                  <div className="pl-row-main">
                    <span className="pl-row-name">{dock.name}</span>
                    <span className="pl-row-meta">
                      {dock.dockModel} · {dock.droneModel}
                    </span>
                  </div>
                  {dock.source === 'auto' ? <span className="pl-badge">AUTO</span> : null}
                  <button
                    type="button"
                    className="pl-row-remove"
                    aria-label={`Remove ${dock.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      commitPlan(removeDock(usePlanStore.getState().plan, dock.id))
                    }}
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="pl-panel">
        <h4 className="lbl">Coverage parameters</h4>
        <label className="pl-field">
          <span className="lbl">Target overlap · {plan.params.targetOverlapPct}%</span>
          <input
            className="pl-slider"
            type="range"
            min={0}
            max={80}
            step={1}
            value={plan.params.targetOverlapPct}
            onChange={handleTargetOverlap}
          />
        </label>
        <label className="pl-field">
          <span className="lbl">Required coverage · {plan.params.requiredCoveragePct}%</span>
          <input
            className="pl-slider"
            type="range"
            min={50}
            max={100}
            step={1}
            value={plan.params.requiredCoveragePct}
            onChange={handleRequiredCoverage}
          />
        </label>
      </div>
    </>
  )
}
