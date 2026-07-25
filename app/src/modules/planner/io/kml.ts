import { kml as kmlToGeoJson } from '@tmcw/togeojson'
import { unzipSync, strFromU8 } from 'fflate'
import simplify from '@turf/simplify'
import { feature } from '@turf/helpers'
import type { MultiPolygon, Polygon } from 'geojson'
import { nextId } from '../domain/plan'
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
function maybeSimplify(g: Polygon | MultiPolygon): {
  geometry: Polygon | MultiPolygon
  from?: number
} {
  const before = countVertices(g)
  if (before <= SIMPLIFY_VERTEX_THRESHOLD) return { geometry: g }
  const out = simplify(feature(g), {
    tolerance: SIMPLIFY_TOLERANCE,
    highQuality: false,
  })
  return { geometry: out.geometry, from: before }
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
      const { geometry, from } = maybeSimplify(g)
      aois.push({
        id: nextId('aoi'),
        name: String(f.properties?.name ?? 'IMPORTED AREA').toUpperCase(),
        geometry,
        source: 'kml',
        valid: true,
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
  if (!isKmz) return parseKmlText(await file.text())

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
