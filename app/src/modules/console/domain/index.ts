// Public barrel for the framework-free simulation domain (Phase 1A).
//
// Later React UI phases should import from `@/modules/console/domain`
// rather than reaching into individual files under this directory — this
// module is the contract those phases consume.

export { SimEngine } from './engine'
export type { Engine, CreateOpts, MissionSpec, LaunchPresetOpts } from './engine'

export { SimRouter } from './router'

export { DOCK_RANGE, DATA_DOCKS } from './docks'
export { DATA_SITES } from './sites'
export { MISSIONS_CONFIG } from './missions-config'
export { VIDEO_MANIFEST } from './video-manifest'
export { GEO_UAE } from './geo-uae'
export { GEO_WORLD } from './geo-world'

export type * from './types'
