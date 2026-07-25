// Ported (Phase 1E / Task 4) from assets/js/ui/control.js:739-770 (the
// PRESET_NEAR geographic-bias table) and :774-778 (buildMissionsMenu's
// `order`/`types` computation). The launch side of `control.launchPreset`
// (:752-770) is ported separately in useLaunchPreset.ts.

import type { MissionConfig, MissionType, LonLat } from '@/modules/console/domain'

// control.js:739-747: optional geographic bias per preset so a launched
// mission lands in a recognizable city rather than a random emirate.
// [lon, lat]; types without an entry launch from any eligible ready dock.
export const PRESET_NEAR: Partial<Record<MissionType, LonLat>> = {
  security: [55.14, 25.08], // Dubai Marina
  infra: [54.37, 24.48], // Abu Dhabi
  emergency: [55.27, 25.2], // Downtown Dubai
  delivery: [55.38, 25.13], // Dubai
  construction: [54.43, 24.42], // Abu Dhabi
  highway: [55.53, 24.98], // E11 corridor
  parks: [55.3, 25.23], // Dubai
}

// control.js:777: buildMissionsMenu's fixed display order.
export const PRESET_ORDER: MissionType[] = [
  'security',
  'infra',
  'emergency',
  'delivery',
  'construction',
  'highway',
  'parks',
]

// control.js:777-778: `order.filter(t => cfg[t]).concat(Object.keys(cfg)
// .filter(t => order.indexOf(t) === -1))` -- the fixed order first (only
// types actually present in the config), then any remaining config type not
// in that order, in the config's own key order.
export function presetTypes(config: Partial<Record<MissionType, MissionConfig>>): MissionType[] {
  const ordered = PRESET_ORDER.filter((t) => config[t])
  const remainder = (Object.keys(config) as MissionType[]).filter((t) => !PRESET_ORDER.includes(t))
  return ordered.concat(remainder)
}
