# `console/domain` — public API

Framework-free TypeScript port of the drone-C2 simulation core (legacy
`assets/js/{data,sim}/*.js`). No React, no DOM, no globals — pure functions
and plain-object state. This is the surface later React UI phases import
from `@/modules/console/domain` (the barrel in `index.ts`); deep imports
into individual files under this directory should not be needed.

Two invariants to keep in mind when consuming this module:

- **Time only advances via `engine.tick(dt)`.** Nothing here runs on a
  wall-clock timer or `setInterval`; the caller (a future React hook/loop)
  is responsible for driving simulated seconds forward.
- **All randomness is the seeded `engine.rand`.** Every stochastic decision
  inside the engine (route jitter, ambient events, request/track spawning)
  draws from `engine.rand`, a `mulberry32` PRNG seeded at creation — never
  `Math.random()` — so a given seed reproduces the same run.

## Exports

| Symbol                    | Type / signature                                                                                          | Description                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SimEngine`               | `{ create(opts?: CreateOpts): Engine; mulberry32(seed: number): () => number }`                           | Factory for a simulation instance (`create`) plus the seeded PRNG constructor it uses internally.                                                                                                                                                                                                                                     |
| `Engine` (type)           | `interface`                                                                                               | Shape of a running simulation: docks/drones/missions/requests/tracks maps, `now`, `events`, `rand`, and all command methods (`tick`, `createMission`, `launchPreset`, `approveRequest`, `declineRequest`, `taskTrack`, `dismissTrack`, `commandRTB`, `commandHold`, `setManual`, `manualGoto`, `manualQueue`, `nudgeAlt`, `onEvent`). |
| `CreateOpts` (type)       | `interface { docks?: DockSeed[]; roads?: FeatureCollection; now?: number }`                               | Options accepted by `SimEngine.create`.                                                                                                                                                                                                                                                                                               |
| `MissionSpec` (type)      | `interface { type: MissionType; dockId: string; waypoints: LonLat[]; params?: {...} }`                    | Input shape for `engine.createMission`.                                                                                                                                                                                                                                                                                               |
| `LaunchPresetOpts` (type) | `interface { dockId?: string; near?: LonLat }`                                                            | Input shape for `engine.launchPreset`.                                                                                                                                                                                                                                                                                                |
| `SimRouter`               | `{ offsetMeters, distM, pathLengthKm, bearing, lawnmower, orbit, perimeter, atob, corridor, pointAlong }` | Framework-free geodesy/route-generation helpers (equirectangular approximation) used by the engine and available for map/UI code.                                                                                                                                                                                                     |
| `DOCK_RANGE`              | `{ URBAN_RANGE_KM, RURAL_RANGE_KM, URBAN_CENTERS, isUrbanDock, dockRangeKm }`                             | Dock coverage-radius classification (3 km urban / 5 km rural) shared by the engine's route generator and any map coverage-ring rendering.                                                                                                                                                                                             |
| `DATA_DOCKS`              | `DockSeed[]`                                                                                              | Seed data for the UAE dock network (104 docks across all seven emirates).                                                                                                                                                                                                                                                             |
| `DATA_SITES`              | `Site[]`                                                                                                  | Seed data for monitored infrastructure sites (installed / not-installed / needs-replacement).                                                                                                                                                                                                                                         |
| `MISSIONS_CONFIG`         | `Record<MissionType, MissionConfig>`                                                                      | Per-mission-type label, route pattern, default altitude/speed, and analytics generator.                                                                                                                                                                                                                                               |
| `VIDEO_MANIFEST`          | `Record<MissionType, string[]>`                                                                           | Mission type → ordered list of debrief video clip filenames.                                                                                                                                                                                                                                                                          |
| `GEO_UAE`                 | `{ borders: FeatureCollection; roads: FeatureCollection; places: FeatureCollection }`                     | UAE country border, road network, and named places as GeoJSON.                                                                                                                                                                                                                                                                        |
| `GEO_WORLD`               | `FeatureCollection`                                                                                       | World landmass outline as GeoJSON (used for the globe/basemap).                                                                                                                                                                                                                                                                       |
| _(types)_                 | `export type *` from `./types`                                                                            | All domain types: `LonLat`, `MissionType`, `DockState`, `DroneState`, `MissionState`, `RequestStatus`, `TrackStatus`, `Priority`, `DockSeed`, `Drone`, `Dock`, `Mission`, `FlightRequest`, `Track`, `SimEvent`, `Site`, `MissionConfig`.                                                                                              |

## Testing

From `app/`:

```bash
npm run test
```

68 tests pass across 9 files (`router`, `docks`, `sites`, `geo`, `engine`,
`tracks`, `requests`, `range`, plus `shared/env`), covering router math,
seed-data shape, GeoJSON shape, engine lifecycle, detection tracks,
customer flight requests, and the dock-coverage range guarantee.
