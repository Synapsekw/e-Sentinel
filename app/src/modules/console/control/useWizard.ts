// Ported (Phase 1E / Task 3) from assets/js/ui/control.js:460-485
// (handleWizardLaunch), :487-497 (cleanupWizardUI), :502-521 (enterWizard),
// :523-529 (exitWizard), and the wizard-preview map-sync half of
// :299-309 (refreshWizardPreview/clearWizardPreview) folded into this
// hook's own effect instead of being called explicitly at every discrete
// wizard-state change site (see the effect's own comment below).
//
// Both DockPanel.tsx (#rp-launch -> enterWizard) and WizardPanel.tsx
// (CANCEL/BACK/NEXT/LAUNCH) call useWizard(). Mirroring useLaunchPreset.ts
// (Phase 1E / Task 4) rather than threading `engine`/`map` through as
// parameters: this hook resolves them itself via
// useOptionalEngine()/useOptionalMap() (Phase 1D's non-throwing context
// hooks), so it works both inside the full <MapView>/<EngineProvider> tree
// (Console.tsx, Task 8) and standalone the way RightPanel.test.tsx already
// renders panel components (no providers, `map={null}` passed straight
// through as a prop) — calling the throwing useMap()/useEngine() here would
// break that.
//
// DEVIATION (documented): the Global Constraints call for map writes to
// gate on `useMap().ready`, never `map.loaded()`. MapView.tsx only ever
// renders its children once `ready` flips true (`{ready ? children :
// null}`), so every component that can reach this hook in the real app is
// already guaranteed to be mounted post-ready — `map != null` plays the
// same role `ready` plays elsewhere without requiring the throwing context
// hook. This matches how DockPanel.tsx/DroneTelemetryPanel.tsx/
// SitePanel.tsx already treat their own `map` prop.

import { useEffect } from 'react'
import type maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Source } from 'maplibre-gl'
import type { FeatureCollection, LineString, Point } from 'geojson'
import type { Mission } from '@/modules/console/domain'
import { useAppStore } from '@/shared/store'
import type { WizardState } from '@/shared/store'
import { nowClockStr } from '@/modules/console/chrome/format'
import { useOptionalEngine, useOptionalMap } from '@/modules/console/panels/hooks'
import { useUpdater } from '@/modules/console/engine/UpdaterContext'
import type { LiveLayerUpdater } from '@/modules/console/map/updateLiveLayers'
import { isMapUsable } from '@/modules/console/map/mapLifecycle'
import { selectEntity } from '@/modules/console/selection/selectEntity'
import {
  wizardFinalWaypoints,
  wizardNearestReadyDockId,
  wizardPreviewFeatures,
} from './wizardModel'

// Mirrors usePingDriver.ts/updateLiveLayers.ts's asGeoJSONSource: a
// `Source` returned by `getSource()` doesn't carry `setData` in its public
// type (only `GeoJSONSource` does).
function asGeoJSONSource(source: Source | undefined): GeoJSONSource | null {
  return source && 'setData' in source ? (source as GeoJSONSource) : null
}

function emptyFC(): FeatureCollection<Point | LineString> {
  return { type: 'FeatureCollection', features: [] }
}

function mapCenterOf(map: maplibregl.Map | null): [number, number] | null {
  if (!map) return null
  const c = map.getCenter()
  return [c.lng, c.lat]
}

function setCursor(map: maplibregl.Map | null, css: string): void {
  if (map) map.getCanvas().style.cursor = css
}

// Shared UI teardown — mode/preview/cursor/highlight. Does not touch the
// right panel; callers (exitWizard, launch) decide what to show next
// (control.js:487-497's own header comment, transcribed).
function cleanupWizardUI(map: maplibregl.Map | null, updater: LiveLayerUpdater | null): void {
  useAppStore.getState().setControlMode('normal', null)
  useAppStore.getState().setWizard(null)
  setCursor(map, '')
  updater?.setRangeHighlight(null)
}

export interface UseWizardResult {
  enterWizard: (prefillDockId: string | null) => boolean
  exitWizard: () => void
  launch: () => void
  update: (patch: Partial<WizardState>) => void
}

export function useWizard(): UseWizardResult {
  const engine = useOptionalEngine()
  const map = useOptionalMap()
  const updater = useUpdater()
  const wizard = useAppStore((s) => s.wizard)

  // control.js:299-309 (refreshWizardPreview/clearWizardPreview): keeps the
  // 'wizard-preview' source in sync with the store's wizard state on every
  // change (tile pick, map click, undo, slider drag all funnel through
  // update()/applyWizardClick, which lands here as a `wizard` dependency
  // change) rather than each call site calling refresh/clear explicitly.
  useEffect(() => {
    if (!isMapUsable(map)) return
    const src = asGeoJSONSource(map.getSource('wizard-preview'))
    if (!src) return
    src.setData(wizard ? wizardPreviewFeatures(wizard) : emptyFC())
  }, [map, wizard])

  // Clears the preview layer on teardown (unmount, or the map instance
  // changing identity) — separate from the effect above because a wizard
  // exit that also unmounts whichever component called this hook (CANCEL /
  // LAUNCH both flip `rightPanel` away from 'wizard' in the same update)
  // would otherwise never get to run the sync effect's body with the new
  // (now-null) wizard value: React skips re-running an unmounting fiber's
  // effects for the render that unmounts it, so only the cleanup runs.
  useEffect(() => {
    return () => {
      // isMapUsable, not a plain null check: on route unmount React tears the
      // deleted tree down parent-first, so <MapView> has already called
      // map.remove() by the time this cleanup runs and `map` is a live
      // reference to a dead instance (see map/mapLifecycle.ts).
      if (!isMapUsable(map)) return
      const src = asGeoJSONSource(map.getSource('wizard-preview'))
      if (src) src.setData(emptyFC())
    }
  }, [map])

  // control.js:502-521.
  function enterWizard(prefillDockId: string | null): boolean {
    const { controlMode } = useAppStore.getState()
    if (!engine || controlMode === 'manual') return false
    if (controlMode === 'wizard') return true

    useAppStore.getState().setControlMode('wizard', null)
    useAppStore.getState().setWizard({
      step: 1,
      type: null,
      dockId: prefillDockId || wizardNearestReadyDockId(engine, mapCenterOf(map)),
      points: [],
      spacingM: 150,
      altM: null,
      speedMs: null,
      error: null,
      rangeWarning: null,
    })
    useAppStore.getState().setRightPanel({ mode: 'wizard' })
    return true
  }

  // control.js:523-529.
  function exitWizard(): void {
    if (useAppStore.getState().controlMode !== 'wizard') return
    cleanupWizardUI(map, updater)
    useAppStore.getState().setSelection(null)
    useAppStore.getState().setRightPanel({ mode: 'empty' })
  }

  // control.js:460-485.
  function launch(): void {
    const w = useAppStore.getState().wizard
    // control.js's handleWizardLaunch never guards `w.type`/`w.dockId`
    // before calling engine.createMission — a null value would just throw
    // inside createMission itself and land in the catch below. This port
    // guards explicitly instead of casting `w.type`/`w.dockId` to their
    // non-null types (WizardState allows either to be null before step 1
    // completes), which keeps the port `any`/assertion-free without
    // changing behavior: LAUNCH is only ever reachable from step 3, which
    // requires both to have been set already.
    if (!w || !engine || !w.type || !w.dockId) return
    const waypoints = wizardFinalWaypoints(w)
    let mission: Mission
    try {
      mission = engine.createMission({
        type: w.type,
        dockId: w.dockId,
        waypoints,
        params: {
          altM: w.altM ?? undefined,
          speedMs: w.speedMs ?? undefined,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      useAppStore.getState().setWizard({ ...w, error: message })
      useAppStore.getState().pushTickerEvent({
        time: nowClockStr(),
        source: w.dockId ?? '',
        message: 'MISSION LAUNCH FAILED · ' + message,
        level: 'warn',
        droneId: null,
      })
      return
    }
    useAppStore.getState().addUserMission(mission.id)
    const droneId = 'D-' + w.dockId
    cleanupWizardUI(map, updater)
    useAppStore.getState().setFollowDroneId(droneId)
    selectEntity({ type: 'drone', id: droneId }, engine, map)
  }

  // Generic wizard-state patch used by WizardPanel.tsx's discrete actions
  // (tile pick, dock change, undo, step transitions) — the store-side half
  // of legacy's mutate-`control.wizard`-then-`renderWizard()` pattern
  // (control.js:336-681). Side effects that accompany specific transitions
  // (the crosshair cursor, `updater.setRangeHighlight`) are NOT folded in
  // here — WizardPanel.tsx's handlers call them alongside `update()`,
  // exactly where control.js's wireWizardPanel does (:608-614, :623-625,
  // :653, :661-663), since they are not part of WizardState itself.
  function update(patch: Partial<WizardState>): void {
    const current = useAppStore.getState().wizard
    if (!current) return
    useAppStore.getState().setWizard({ ...current, ...patch })
  }

  return { enterWizard, exitWizard, launch, update }
}
