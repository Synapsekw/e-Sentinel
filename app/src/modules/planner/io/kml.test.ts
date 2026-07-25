// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
// jsdom's Blob/File implementation (as of jsdom 25, used by the
// @vitest-environment jsdom pragma below) does not implement .text() or
// .arrayBuffer() - both throw "is not a function". Node's own File (global
// since Node 20, also importable directly here) does implement them, so the
// KMZ-path tests below construct files with this one instead of the
// environment's global File.
import { File as NodeFile } from 'node:buffer'
import { zipSync, strToU8 } from 'fflate'
import { parseKmlText, importAoiFile } from './kml'

// Node's File lacks the DOM File type's `webkitRelativePath` field, which
// nothing here reads; the object still has every member importAoiFile
// actually calls (name, text(), arrayBuffer()), so this cast just bridges
// the two lib.dom.d.ts/@types/node type declarations, not the real shape.
function testFile(parts: (string | Uint8Array)[], name: string, type: string): File {
  return new NodeFile(parts, name, { type }) as unknown as File
}

// Deliberately not written as the literal `new URL('./x', import.meta.url)`
// pattern: under the jsdom test environment, Vite's import-analysis plugin
// treats that exact shape as a browser asset reference and rewrites
// import.meta.url to `self.location` (an http: URL), which then breaks
// fileURLToPath. Routing import.meta.url through a variable first sidesteps
// that static rewrite and gets us the real file: URL.
const testFileUrl = import.meta.url
const fixture = readFileSync(fileURLToPath(new URL('./fixtures/simple.kml', testFileUrl)), 'utf8')

describe('parseKmlText', () => {
  it('extracts polygon placemarks as AOIs and counts skipped features', () => {
    const r = parseKmlText(fixture)
    if (!r.ok) throw new Error(`expected ok, got ${r.code}`)
    expect(r.aois).toHaveLength(1)
    expect(r.aois[0].name).toBe('AOI ONE')
    expect(r.aois[0].source).toBe('kml')
    expect(r.aois[0].valid).toBe(true)
    expect(r.skipped).toBe(1) // the Point placemark
  })

  it('reports BAD_XML on malformed input', () => {
    const r = parseKmlText('<kml><unclosed>')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('BAD_XML')
  })

  it('reports NO_AREAS when the file parses but holds no polygons', () => {
    const pointsOnly = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>P</name><Point><coordinates>54.6,24.3</coordinates></Point></Placemark>
      </Document></kml>`
    const r = parseKmlText(pointsOnly)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('NO_AREAS')
    expect(r.message).toContain('1')
  })

  // Reproduces a real turf/simplify failure mode: a ring with more than
  // SIMPLIFY_VERTEX_THRESHOLD vertices (so parseKmlText actually enters the
  // simplify branch) whose coordinates have all collapsed to a single point
  // (a realistic KML export artifact from GPS rounding or bad coordinate
  // parsing). Against the installed @turf/simplify this throws synchronously
  // ("invalid polygon, fewer than 4 points") instead of returning null. Before
  // the try/catch in maybeSimplify was added, that throw propagated straight
  // out of parseKmlText. This test proves it no longer does, and that the
  // resulting AOI is kept (not dropped) but marked invalid so it is excluded
  // from coverage math while still being visible to the user.
  it('keeps a degenerate collapsed-point ring as an invalid AOI instead of throwing when simplify fails', () => {
    const vertexCount = 2000 // > SIMPLIFY_VERTEX_THRESHOLD (1500)
    const collapsedPoint = '54.6,24.3'
    const coords = Array.from({ length: vertexCount }, () => collapsedPoint).join(' ')
    const degenerateKml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>Degenerate</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
        ${coords}
      </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
      </Document></kml>`

    const r = parseKmlText(degenerateKml)

    if (!r.ok) throw new Error(`expected ok, got ${r.code}`)
    expect(r.aois).toHaveLength(1)
    expect(r.aois[0].valid).toBe(false)
    expect(r.aois[0].simplifiedFrom).toBeUndefined()
    expect(r.aois[0].geometry).toBeDefined()
  })

  // Important 4 (final whole-branch review): before this, the only way an
  // AOI became invalid was the simplify-threshold branch above throwing.
  // A self-intersecting ring well under SIMPLIFY_VERTEX_THRESHOLD never went
  // through simplify at all and reached the plan as `valid: true`, which
  // poisons computeCoverage's entire result instead of being excluded and
  // flagged (design doc section 11).
  it('flags a self-intersecting (bowtie) polygon invalid while a good polygon in the same file stays valid', () => {
    const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>Good</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
        54.5,24.2 54.7,24.2 54.7,24.4 54.5,24.4 54.5,24.2
      </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
      <Placemark><name>Bowtie</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
        54.5,24.2 54.7,24.4 54.7,24.2 54.5,24.4 54.5,24.2
      </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
      </Document></kml>`

    const r = parseKmlText(kml)
    if (!r.ok) throw new Error(`expected ok, got ${r.code}`)
    expect(r.aois).toHaveLength(2)
    const good = r.aois.find((a) => a.name === 'GOOD')
    const bowtie = r.aois.find((a) => a.name === 'BOWTIE')
    expect(good?.valid).toBe(true)
    expect(bowtie?.valid).toBe(false)
  })
})

describe('importAoiFile', () => {
  it('reads a plain .kml file', async () => {
    const file = testFile([fixture], 'aoi.kml', 'application/vnd.google-earth.kml+xml')
    const r = await importAoiFile(file)
    if (!r.ok) throw new Error(`expected ok, got ${r.code}`)
    expect(r.aois).toHaveLength(1)
    expect(r.aois[0].source).toBe('kml')
  })

  it('unzips a .kmz archive, finds the .kml entry and tags AOIs as kmz', async () => {
    const zipped = zipSync({ 'doc.kml': strToU8(fixture) })
    const file = testFile([zipped], 'aoi.kmz', 'application/vnd.google-earth.kmz')
    const r = await importAoiFile(file)
    if (!r.ok) throw new Error(`expected ok, got ${r.code}`)
    expect(r.aois).toHaveLength(1)
    expect(r.aois[0].source).toBe('kmz')
    expect(r.aois[0].name).toBe('AOI ONE')
  })

  it('reports NO_KML when the archive contains no .kml entry', async () => {
    const zipped = zipSync({ 'readme.txt': strToU8('hello') })
    const file = testFile([zipped], 'aoi.kmz', 'application/vnd.google-earth.kmz')
    const r = await importAoiFile(file)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('NO_KML')
  })

  it('reports UNREADABLE when the .kmz is not a valid archive', async () => {
    const file = testFile(['not a zip file'], 'aoi.kmz', 'application/vnd.google-earth.kmz')
    const r = await importAoiFile(file)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('UNREADABLE')
  })

  it('reports a message instead of an unhandled rejection when reading a .kml file fails (Important 7)', async () => {
    // Before this fix, importAoiFile's non-.kmz branch called
    // `await file.text()` with no try/catch, so a rejected read became an
    // unhandled promise rejection: no alert, no message, nothing happened.
    // The .kmz branch (arrayBuffer/unzipSync above) and handleImportPlanFile
    // (ui/Planner.tsx) already guard their own reads the same way this now
    // does. A minimal object satisfying only what importAoiFile actually
    // touches (name, text()) stands in for File here -- this cast is
    // type-only, not a structural File.
    const failing = {
      name: 'aoi.kml',
      text: () => Promise.reject(new Error('permission denied')),
    } as unknown as File
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await importAoiFile(failing)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('UNREADABLE')
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
