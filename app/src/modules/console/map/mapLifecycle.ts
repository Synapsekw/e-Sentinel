// Map liveness probe (Phase 1F). Not a legacy port: the vanilla app kept one
// MapLibre instance for the lifetime of the page and never removed it, so it
// had no teardown race to guard against. The React port creates the map in
// <MapView>'s effect and removes it when the `/console` route unmounts, which
// introduces one.
//
// The race is a React ordering detail that is easy to get wrong: when a whole
// subtree is DELETED (route navigation away from /console), React runs passive
// effect cleanups top-down through the deleted tree, not children-first the
// way it does for a normal re-render. <MapView> is the parent, so its cleanup
// (map.remove()) runs BEFORE the cleanups of every hook beneath it — and any
// of those that still reaches for the map to clear a layer it owns
// (useWizard's wizard-preview, useManualControl's manual-wpts) lands on a
// torn-down instance.
//
// MapLibre's remove() nulls out the Map's internal Style, and every
// getSource/getLayer/setData call dereferences it, which is what surfaced as
// "TypeError: Cannot read properties of undefined (reading 'getSource')" on
// navigating away while the sim was running. Checking for that Style is the
// cheapest reliable "is this instance still alive" probe. It is not part of
// MapLibre's public typings, hence the cast.

import type maplibregl from 'maplibre-gl'

export function isMapUsable(map: maplibregl.Map | null | undefined): map is maplibregl.Map {
  if (!map) return false
  return (map as unknown as { style?: unknown }).style != null
}
