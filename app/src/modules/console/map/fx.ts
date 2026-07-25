// Ported (Phase 1C / Task 2) verbatim from assets/js/ui/map.js:390-407: the
// FX_PULSE_* constants + the module-scoped `fxPulses` array (:395-398), and
// `EC2.launchPulse` (:400-407) as `pushLaunchPulse`. This module is the one
// EXCEPTION to Task 2's "instance-scoped, not module-global" rule: `fxPulses`
// stays a plain module-scoped array because Phase 1B's usePingDriver already
// consumes it that way (its own rAF loop drains/prunes the array every
// frame, never via React state) — moving it here just relocates the single
// source of truth so both the ping driver and the live-engine binding (which
// pushes onto it on mission launch) share the same array without either
// depending on the other's file.
//
// `EC2.mapLoaded` (a boolean flag flipped once by the 'load' handler and
// never unset) is threaded through as a caller-supplied `ready` boolean —
// Phase 1B's `MapContext.ready` (see MapView.tsx), the same one-way latch
// `useBasemap.ts` / `usePingDriver.ts` / `BasemapChip.tsx` already gate on.
// MapLibre's `map.loaded()` is NOT used here: unlike the latch, it is
// recomputed continuously and goes false while the style/sources are dirty
// or tiles are pending — including during ordinary pan/zoom/basemap-switch —
// which would silently drop launch FX pulses well after the map's first
// frame.

import type maplibregl from 'maplibre-gl'
import { DATA_DOCKS } from '@/modules/console/domain'
import type { Scene } from '@/shared/store'

export const FX_PULSE_LIFE_MS = 1200
export const FX_PULSE_RINGS = 3
export const FX_PULSE_STAGGER_MS = 150

export interface FxPulse {
  coords: [number, number]
  start: number
}

// Module-scoped, mirrors legacy's `const fxPulses = []` (map.js:398).
export const fxPulses: FxPulse[] = []

// C-3: expanding ring burst at a dock on mission launch. Off-console (globe
// scene / hidden tab at 16x) the FX driver is paused and would never prune —
// skip the push rather than accumulate. Before the map is ready (per the
// caller-supplied `ready` latch — see file header) the pulse is dropped too
// — a launch FX with no map to draw on has nothing to show anyway.
export function pushLaunchPulse(
  dockId: string,
  map: maplibregl.Map | null,
  scene: Scene,
  ready: boolean,
): void {
  if (!map || !ready || scene !== 'console') return
  const dock = DATA_DOCKS.find((d) => d.id === dockId)
  if (!dock) return
  fxPulses.push({ coords: dock.coords.slice() as [number, number], start: performance.now() })
}
