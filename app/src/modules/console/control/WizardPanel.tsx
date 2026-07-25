// Ported (Phase 1E / Task 3) from assets/js/ui/control.js:340-457
// (wizardTypeTiles / renderWizardStep1 / renderWizardStep2 /
// renderWizardStep3 / renderWizardPanel) and :579-681 (wireWizardPanel).
// Every element id, class name and copy string is transcribed exactly;
// `&middot;` -> `·` and `&amp;` -> `&` per the Global Constraints.
//
// Legacy patched the spacing/altitude/speed slider labels' text nodes
// directly on the 'input' event instead of calling renderWizard() (its own
// comment at control.js:334-335), specifically so a continuous drag is
// never interrupted by the panel being torn down and rebuilt underneath the
// pointer. In React a controlled <input type="range"> only ever re-renders
// this one component per 'input'/'change' event (no DOM teardown/rebuild
// happens the way legacy's innerHTML-replacing renderWizard() did) — so a
// plain `update({...})` call on each slider's onChange is behaviorally
// equivalent and simpler, and is what every slider below does.
//
// Cursor + `updater.setRangeHighlight` side effects are NOT part of
// WizardState, so they aren't folded into useWizard.ts's generic `update()`
// — this component calls them directly alongside `update()` at exactly the
// same step transitions control.js does (:608-614 step1->2 NEXT, :623-625
// step2->1 BACK, :653 step2->3 NEXT, :661-663 step3->2 BACK).

import type { ChangeEvent } from 'react'
import type maplibregl from 'maplibre-gl'
import { MISSIONS_CONFIG } from '@/modules/console/domain'
import type { Engine, MissionType } from '@/modules/console/domain'
import { useAppStore } from '@/shared/store'
import type { WizardState } from '@/shared/store'
import { useOptionalEngine, useOptionalMap } from '@/modules/console/panels/hooks'
import { useUpdater } from '@/modules/console/engine/UpdaterContext'
import { useWizard } from './useWizard'
import {
  WIZARD_GLYPHS,
  isLawnmowerType,
  wizardDistanceKm,
  wizardDurationLabel,
  wizardReadyDocks,
  wizardStep2Valid,
} from './wizardModel'
import './wizard.css'

export interface WizardPanelProps {
  engine?: Engine | null
  map?: maplibregl.Map | null
}

// control.js:390/429/433 slider ranges.
const SPACING_MIN = 100
const SPACING_MAX = 300
const SPACING_STEP = 10
const SPACING_DEFAULT = 150
const ALT_MIN = 40
const ALT_MAX = 120
const ALT_STEP = 5
const SPEED_MIN = 5
const SPEED_MAX = 21
const SPEED_STEP = 1

export default function WizardPanel({ engine: engineProp, map: mapProp }: WizardPanelProps) {
  const contextEngine = useOptionalEngine()
  const contextMap = useOptionalMap()
  const engine = engineProp !== undefined ? engineProp : contextEngine
  const map = mapProp !== undefined ? mapProp : contextMap
  const updater = useUpdater()
  const { exitWizard, launch, update } = useWizard()
  // useWizard() itself reads the store's `wizard` field internally (to
  // keep the 'wizard-preview' map source in sync); this component
  // separately subscribes to the same field so it re-renders on every
  // wizard-state change.
  const wizard = useAppStore((s) => s.wizard)

  if (!wizard) return null
  if (wizard.step === 2) {
    return (
      <WizardStep2 w={wizard} map={map} updater={updater} update={update} exitWizard={exitWizard} />
    )
  }
  if (wizard.step === 3) {
    return (
      <WizardStep3
        w={wizard}
        map={map}
        updater={updater}
        update={update}
        exitWizard={exitWizard}
        launch={launch}
      />
    )
  }
  return (
    <WizardStep1
      w={wizard}
      engine={engine}
      map={map}
      updater={updater}
      update={update}
      exitWizard={exitWizard}
    />
  )
}

type Updater = ReturnType<typeof useUpdater>
type UpdateFn = (patch: Partial<WizardState>) => void

function setCursor(map: maplibregl.Map | null, css: string): void {
  if (map) map.getCanvas().style.cursor = css
}

// control.js:340-351 (wizardTypeTiles).
function WizardTiles({ w, update }: { w: WizardState; update: UpdateFn }) {
  return (
    <div className="wz-tiles">
      {(Object.keys(MISSIONS_CONFIG) as MissionType[]).map((type) => {
        const cfg = MISSIONS_CONFIG[type]
        const sel = w.type === type
        return (
          <button
            key={type}
            type="button"
            className={'wz-tile' + (sel ? ' sel' : '')}
            data-type={type}
            onClick={() => {
              const patch: Partial<WizardState> = { type }
              if (type !== w.type) {
                patch.altM = null
                patch.speedMs = null
              }
              update(patch)
            }}
          >
            <span className="wz-glyph">{WIZARD_GLYPHS[type] || '●'}</span>
            <span className="wz-label">{cfg.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// control.js:353-375 (renderWizardStep1) + the w.step===1 half of
// wireWizardPanel (:584-616).
function WizardStep1({
  w,
  engine,
  map,
  updater,
  update,
  exitWizard,
}: {
  w: WizardState
  engine: Engine | null
  map: maplibregl.Map | null
  updater: Updater
  update: UpdateFn
  exitWizard: () => void
}) {
  const mapCenter: [number, number] | null = map ? [map.getCenter().lng, map.getCenter().lat] : null
  const docks = wizardReadyDocks(engine, mapCenter)
  // control.js:355: `if (!docks.some(d => d.id === w.dockId)) w.dockId =
  // docks.length ? docks[0].id : null` — a render-time self-correction so a
  // dock that stopped being ready mid-step-1 doesn't leave a dangling
  // selection. Computed here for display/NEXT-validity rather than written
  // back into the store on every render (which would need an effect); the
  // NEXT handler below persists it into WizardState the moment it matters.
  const dockValid = docks.some((d) => d.id === w.dockId)
  const dockId = dockValid ? w.dockId : docks.length ? docks[0].id : null

  const canProceed = !!(w.type && dockId)

  function handleNext(): void {
    if (!w.type || !dockId) return
    update({ step: 2, dockId, points: [], error: null, rangeWarning: null })
    setCursor(map, 'crosshair')
    // Contract C-4: spotlight the launch dock's coverage ring while the
    // route is captured (control.js:609-614).
    updater?.setRangeHighlight(dockId)
  }

  return (
    <div className="wz">
      <div className="lbl">NEW MISSION · STEP 1 OF 3 · TYPE & DOCK</div>
      <WizardTiles w={w} update={update} />
      <div className="wz-field">
        <label className="lbl" htmlFor="wz-dock">
          LAUNCH DOCK
        </label>
        <select
          id="wz-dock"
          disabled={docks.length === 0}
          value={dockId ?? ''}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            update({ dockId: e.target.value || null })
          }
        >
          {docks.length ? (
            docks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id} · {d.name}
              </option>
            ))
          ) : (
            <option value="">NO READY DOCKS</option>
          )}
        </select>
      </div>
      <div className="rp-actions">
        <button type="button" className="ghost" id="wz-cancel" onClick={exitWizard}>
          CANCEL
        </button>
        <button
          type="button"
          className="primary"
          id="wz-next"
          disabled={!canProceed}
          onClick={handleNext}
        >
          NEXT
        </button>
      </div>
    </div>
  )
}

// control.js:377-415 (renderWizardStep2) + the w.step===2 half of
// wireWizardPanel (:617-655).
function WizardStep2({
  w,
  map,
  updater,
  update,
  exitWizard,
}: {
  w: WizardState
  map: maplibregl.Map | null
  updater: Updater
  update: UpdateFn
  exitWizard: () => void
}) {
  if (!w.type) return null
  const cfg = MISSIONS_CONFIG[w.type]
  const lawnmower = isLawnmowerType(w.type)
  const distKm = wizardDistanceKm(w)
  const durLabel = wizardDurationLabel(distKm, w.speedMs || cfg.defaults.speedMs)
  const countLabel = lawnmower ? 'CORNERS' : 'WAYPOINTS'
  const countVal = lawnmower ? w.points.length + ' / 2' : String(w.points.length)
  const hint = lawnmower
    ? 'CLICK TWO CORNERS ON THE MAP TO DEFINE THE SURVEY AREA'
    : 'CLICK THE MAP TO ADD WAYPOINTS · MIN 2 REQUIRED'
  const valid = wizardStep2Valid(w)

  function handleUndo(): void {
    update({ points: w.points.slice(0, -1), rangeWarning: null })
  }

  function handleBack(): void {
    update({ step: 1, points: [], rangeWarning: null })
    setCursor(map, '')
    updater?.setRangeHighlight(null)
  }

  function handleNext(): void {
    if (!wizardStep2Valid(w)) return
    update({
      step: 3,
      rangeWarning: null,
      altM: w.altM ?? cfg.defaults.altM,
      speedMs: w.speedMs ?? cfg.defaults.speedMs,
    })
    setCursor(map, '')
  }

  return (
    <div className="wz">
      <div className="lbl">NEW MISSION · STEP 2 OF 3 · ROUTE</div>
      <div className="wz-type-hdr">
        {cfg.label} · {w.dockId}
      </div>
      <p className="wz-hint">{hint}</p>
      {w.rangeWarning ? <div className="wz-range-warn">{w.rangeWarning}</div> : null}
      {lawnmower ? (
        <div className="wz-field">
          <label className="lbl" htmlFor="wz-spacing">
            LINE SPACING · <span id="wz-spacing-val">{(w.spacingM || SPACING_DEFAULT) + ' M'}</span>
          </label>
          <input
            type="range"
            id="wz-spacing"
            min={SPACING_MIN}
            max={SPACING_MAX}
            step={SPACING_STEP}
            value={w.spacingM || SPACING_DEFAULT}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              update({ spacingM: Number(e.target.value) })
            }
          />
        </div>
      ) : null}
      <div className="stats wz-stats">
        <div className="st">
          <div className="n" id="wz-count">
            {countVal}
          </div>
          <div className="c">{countLabel}</div>
        </div>
        <div className="st">
          <div className="n" id="wz-dist">
            {distKm ? distKm.toFixed(1) + ' KM' : '--'}
          </div>
          <div className="c">Distance</div>
        </div>
        <div className="st">
          <div className="n" id="wz-dur">
            {durLabel}
          </div>
          <div className="c">Duration est</div>
        </div>
      </div>
      <div className="rp-actions">
        <button
          type="button"
          className="ghost"
          id="wz-undo"
          disabled={w.points.length === 0}
          onClick={handleUndo}
        >
          UNDO LAST POINT
        </button>
      </div>
      <div className="rp-actions">
        <button type="button" className="ghost" id="wz-back" onClick={handleBack}>
          BACK
        </button>
        <button type="button" className="ghost" id="wz-cancel" onClick={exitWizard}>
          CANCEL
        </button>
        <button
          type="button"
          className="primary"
          id="wz-next"
          disabled={!valid}
          onClick={handleNext}
        >
          NEXT
        </button>
      </div>
    </div>
  )
}

// control.js:417-450 (renderWizardStep3) + the w.step===3 half of
// wireWizardPanel (:656-680).
function WizardStep3({
  w,
  map,
  updater,
  update,
  exitWizard,
  launch,
}: {
  w: WizardState
  map: maplibregl.Map | null
  updater: Updater
  update: UpdateFn
  exitWizard: () => void
  launch: () => void
}) {
  if (!w.type || w.altM == null || w.speedMs == null) return null
  const cfg = MISSIONS_CONFIG[w.type]
  const lawnmower = isLawnmowerType(w.type)
  const distKm = wizardDistanceKm(w)
  const durLabel = wizardDurationLabel(distKm, w.speedMs)
  const routeSummary = lawnmower ? '2 CORNERS (BOX)' : w.points.length + ' WAYPOINTS'

  function handleBack(): void {
    update({ step: 2, error: null })
    setCursor(map, 'crosshair')
    // Keep the coverage ring highlighted while editing the route again
    // (control.js:661-663).
    updater?.setRangeHighlight(w.dockId)
  }

  return (
    <div className="wz">
      <div className="lbl">NEW MISSION · STEP 3 OF 3 · PARAMETERS</div>
      <div className="wz-type-hdr">
        {cfg.label} · {w.dockId}
      </div>
      <div className="wz-field">
        <label className="lbl" htmlFor="wz-alt">
          ALTITUDE · <span id="wz-alt-val">{w.altM + ' M'}</span>
        </label>
        <input
          type="range"
          id="wz-alt"
          min={ALT_MIN}
          max={ALT_MAX}
          step={ALT_STEP}
          value={w.altM}
          onChange={(e: ChangeEvent<HTMLInputElement>) => update({ altM: Number(e.target.value) })}
        />
      </div>
      <div className="wz-field">
        <label className="lbl" htmlFor="wz-speed">
          SPEED · <span id="wz-speed-val">{w.speedMs + ' M/S'}</span>
        </label>
        <input
          type="range"
          id="wz-speed"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={SPEED_STEP}
          value={w.speedMs}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            update({ speedMs: Number(e.target.value) })
          }
        />
      </div>
      <div className="wz-summary">
        <div className="rp-kv">
          <span className="k">Type</span>
          <span className="v">{cfg.label}</span>
        </div>
        <div className="rp-kv">
          <span className="k">Dock</span>
          <span className="v">{w.dockId}</span>
        </div>
        <div className="rp-kv">
          <span className="k">Route</span>
          <span className="v">{routeSummary}</span>
        </div>
        <div className="rp-kv">
          <span className="k">Distance</span>
          <span className="v">{distKm.toFixed(1)} KM</span>
        </div>
        <div className="rp-kv">
          <span className="k">Duration est</span>
          <span className="v" id="wz-sum-dur">
            {durLabel}
          </span>
        </div>
      </div>
      {w.error ? <div className="wz-error">{w.error}</div> : null}
      <div className="rp-actions">
        <button type="button" className="ghost" id="wz-back" onClick={handleBack}>
          BACK
        </button>
        <button type="button" className="ghost" id="wz-cancel" onClick={exitWizard}>
          CANCEL
        </button>
        <button type="button" className="primary" id="wz-launch" onClick={launch}>
          LAUNCH
        </button>
      </div>
    </div>
  )
}
