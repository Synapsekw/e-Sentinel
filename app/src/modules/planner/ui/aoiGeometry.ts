// Tiny shared helper between PlanTree.tsx (the AOI list) and Inspector.tsx
// (the selected AOI's detail view), both of which need an AOI's area in
// km2. Kept in its own plain .ts file rather than exported alongside either
// component: a component file that also exports a plain function trips
// react-refresh/only-export-components (fast refresh only works when a
// file exports components only).
import area from '@turf/area'
import { feature } from '@turf/helpers'
import type { Aoi } from '../domain/types'

export function aoiAreaKm2(aoi: Aoi): number {
  return area(feature(aoi.geometry)) / 1_000_000
}
