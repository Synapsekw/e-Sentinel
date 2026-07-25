import { kml as kmlToGeoJson } from '@tmcw/togeojson'
import { unzipSync, strFromU8 } from 'fflate'
import simplify from '@turf/simplify'
import { feature } from '@turf/helpers'
import type { MultiPolygon, Polygon } from 'geojson'
import { nextId } from '../domain/plan'
import { isValidAoiGeometry } from '../domain/geometry'
import type { Aoi } from '../domain/types'

export const SIMPLIFY_VERTEX_THRESHOLD = 1500
export const SIMPLIFY_TOLERANCE = 0.0001

export type ImportResult =
  | { ok: true; aois: Aoi[]; skipped: number }
  | { ok: false; code: 'UNREADABLE' | 'NO_KML' | 'BAD_XML' | 'NO_AREAS'; message: string }

function countVertices(g: Polygon | MultiPolygon): number {
  const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()
  return rings.reduce((n, ring) => n + ring.length, 0)
}

// Simplification is applied to the STORED geometry, not just the drawn one,
// so the coverage number always describes the shape on screen.
//
// Imported KML/KMZ rings occasionally collapse to a degenerate shape (GPS
// rounding, a self-intersecting export, bad coordinate parsing). turf's
// simplify() throws synchronously on some of these ("invalid polygon, fewer
// than 4 points") instead of returning null. A thrown error here would
// propagate out of parseKmlText and importAoiFile, blanking the whole import
// flow, which is worse than one bad AOI. So the call is guarded: on failure
// the original (un-simplified) geometry is kept and the AOI is marked
// invalid, the same signal computeCoverage already uses to exclude bad
// geometry from the math while still listing it for the user. The error is
// logged so it stays debuggable, matching how computeCoverage handles its
// own caught turf throws.
function maybeSimplify(g: Polygon | MultiPolygon): {
  geometry: Polygon | MultiPolygon
  from?: number
  simplifyFailed?: boolean
} {
  const before = countVertices(g)
  if (before <= SIMPLIFY_VERTEX_THRESHOLD) return { geometry: g }
  try {
    const out = simplify(feature(g), {
      tolerance: SIMPLIFY_TOLERANCE,
      highQuality: false,
    })
    return { geometry: out.geometry, from: before }
  } catch (err) {
    console.error('[planner] simplify threw on imported geometry, keeping raw shape', err)
    return { geometry: g, simplifyFailed: true }
  }
}

export function parseKmlText(xml: string): ImportResult {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml')
    if (doc.querySelector('parsererror')) {
      return { ok: false, code: 'BAD_XML', message: 'FILE IS NOT VALID XML' }
    }
  } catch {
    return { ok: false, code: 'BAD_XML', message: 'FILE IS NOT VALID XML' }
  }

  let collection: ReturnType<typeof kmlToGeoJson>
  try {
    collection = kmlToGeoJson(doc)
  } catch {
    return { ok: false, code: 'BAD_XML', message: 'FILE IS NOT READABLE KML' }
  }

  const aois: Aoi[] = []
  let skipped = 0
  for (const f of collection.features) {
    const g = f.geometry
    if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
      const { geometry, from, simplifyFailed } = maybeSimplify(g)
      // Important 4 (final whole-branch review): !simplifyFailed alone only
      // catches the ABOVE-threshold failure path (see maybeSimplify); a
      // self-intersecting ring under SIMPLIFY_VERTEX_THRESHOLD never went
      // through simplify at all and used to reach the plan as `valid: true`,
      // which poisons computeCoverage's ENTIRE result (see
      // domain/geometry.ts's module comment) instead of being excluded and
      // flagged the way the design doc requires.
      const valid = !simplifyFailed && isValidAoiGeometry(geometry)
      aois.push({
        id: nextId('aoi'),
        name: String(f.properties?.name ?? 'IMPORTED AREA').toUpperCase(),
        geometry,
        source: 'kml',
        valid,
        ...(from != null ? { simplifiedFrom: from } : {}),
      })
    } else {
      skipped += 1
    }
  }

  if (aois.length === 0) {
    return {
      ok: false,
      code: 'NO_AREAS',
      message: `${skipped} PLACEMARKS, 0 AREAS`,
    }
  }
  return { ok: true, aois, skipped }
}

export async function importAoiFile(file: File): Promise<ImportResult> {
  const isKmz = file.name.toLowerCase().endsWith('.kmz')
  if (!isKmz) {
    // Important 7 (final whole-branch review): this was the one unguarded
    // read in the whole import surface -- the .kmz branch below already
    // wraps its own read (unzipSync/arrayBuffer) in a try/catch, and
    // handleImportPlanFile (ui/Planner.tsx) does the same for plan JSON
    // imports. A rejected file.text() here (a permission error, a file
    // removed/renamed between picker and read, etc.) used to become an
    // unhandled promise rejection with no alert and no message: nothing
    // visibly happened at all, which is exactly the silent-degradation this
    // whole review is about closing.
    let text: string
    try {
      text = await file.text()
    } catch (err) {
      console.error('[planner] could not read KML file', err)
      return { ok: false, code: 'UNREADABLE', message: 'COULD NOT READ FILE' }
    }
    return parseKmlText(text)
  }

  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  } catch {
    return { ok: false, code: 'UNREADABLE', message: 'KMZ IS NOT A READABLE ARCHIVE' }
  }
  const kmlName = Object.keys(entries).find((n) => n.toLowerCase().endsWith('.kml'))
  if (!kmlName) return { ok: false, code: 'NO_KML', message: 'ARCHIVE CONTAINS NO KML' }
  const out = parseKmlText(strFromU8(entries[kmlName]))
  if (out.ok) return { ...out, aois: out.aois.map((a) => ({ ...a, source: 'kmz' as const })) }
  return out
}
