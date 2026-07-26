// Tiny shared helper between PlanTree.tsx (the AOI list) and Inspector.tsx
// (the selected AOI's detail view), both of which need an AOI's area in
// km2. Kept in its own plain .ts file rather than exported alongside either
// component: a component file that also exports a plain function trips
// react-refresh/only-export-components (fast refresh only works when a
// file exports components only).
//
// It returns the formatted STRING rather than a number so the two views
// cannot drift apart on how an unmeasurable area is presented -- which is
// most of what this module now does.
import area from '@turf/area'
import { feature } from '@turf/helpers'
import { aoiBoundsPolygon } from '../domain/geometry'
import type { Aoi } from '../domain/types'

const km2 = (g: Parameters<typeof feature>[0]): number => area(feature(g)) / 1_000_000

// An invalid AOI has no meaningful area. turf's area() is SIGNED, so a
// self-intersecting ring's oppositely-wound lobes cancel: a symmetric bowtie
// reported "0.0 KM2" for a shape covering most of a degree, and a ring that
// only partly cancels reports a plausible-looking figure that is just as
// wrong and much harder to notice. Neither is a small error in a real number
// -- the number itself is meaningless for any ring that crosses itself.
//
// So an invalid area is reported as an upper bound from its bounding box:
// the same stand-in the map draws for it (see aoiBoundsPolygon), which keeps
// the panel and the map telling the same story. The bound is spelled "≤"
// rather than "~" because it is literally true -- a region cannot exceed its
// own bounding box -- where "~" would claim an approximation this is not.
//
// A geometry too degenerate even to bound has no honest figure at all, not
// even an upper one, so it gets an em dash instead of a fabricated zero.
export function formatAoiArea(aoi: Aoi): string {
  if (aoi.valid) return `${km2(aoi.geometry).toFixed(1)} KM2`
  const bounds = aoiBoundsPolygon(aoi.geometry)
  if (bounds === null) return '—'
  return `≤ ${km2(bounds).toFixed(1)} KM2`
}
