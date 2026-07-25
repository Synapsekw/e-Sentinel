// Ported (Phase 1B / Task 2) verbatim from assets/js/ui/map.js:514-860 (the
// `style` object literal built inside EC2.initMap). Only the module wiring
// and typing changed — every source, every layer's paint/layout/filter/
// minzoom, and every color/number literal is transcribed exactly. No
// visual or behavioral change from the legacy style.
//
// Live sim layers (drones, drone-leaders, drone-trails, fx,
// missions-active, tracks, manual-wpts, wizard-preview) are seeded empty
// here via `emptyFC()`; Task 3 (imperative map lifecycle) is responsible
// for calling `map.getSource(id).setData(...)` as the sim drives them.
//
// Split (Task 1, Deployment Planner) into buildBaseStyle() (cartography
// only) and buildStyle() (base + the console's own sim sources/layers), so
// the planner can build on the cartography without inheriting empty
// drone/track/wizard layers it would never populate. This is a pure move:
// no paint/layout/filter/minzoom/literal changed, and the layer array
// order in buildStyle() is unchanged — see style.test.ts's golden
// snapshot of the exact id sequence and source key set.

import type { ExpressionSpecification, SourceSpecification, StyleSpecification } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { GEO_UAE, GEO_WORLD } from '@/modules/console/domain'
import { RASTERS, RASTER_ATTRIBUTION, VECTOR_TILES, SITE_STATUS_COLOR, glyphsUrl } from './basemap'
import { dockFeatures, siteFeatures, coverageFeatures } from './features'

function emptyFC(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

function buildRasterSources(): Record<string, SourceSpecification> {
  const sources: Record<string, SourceSpecification> = {}
  for (const k of ['dark', 'light', 'sat', 'terrain'] as const) {
    sources[`raster-${k}`] = {
      type: 'raster',
      tileSize: 256,
      tiles: RASTERS[k],
      attribution: RASTER_ATTRIBUTION[k],
    }
  }
  return sources
}

// The base cartography shared by every module that shows a map: rasters,
// the carto-streets vector overlay, UAE borders/roads/places and the world
// landmass fallback. Deliberately contains NO simulation state, so the
// planner (which has no sim) can build on it without inheriting empty
// drone/track/wizard layers it would never populate.
export function buildBaseStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: glyphsUrl(),
    projection: { type: 'globe' },
    sources: {
      ...buildRasterSources(),
      'carto-streets': {
        type: 'vector',
        tiles: VECTOR_TILES,
        minzoom: 0,
        maxzoom: 14,
        attribution: RASTER_ATTRIBUTION.dark,
      },
      uae: { type: 'geojson', data: GEO_UAE.borders },
      'uae-roads': { type: 'geojson', data: GEO_UAE.roads },
      'uae-places': { type: 'geojson', data: GEO_UAE.places },
      world: { type: 'geojson', data: GEO_WORLD },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0a0b0e' } },
      // Boot scene is 'globe', whose effective basemap is satellite (the
      // orbital view reads as Earth from space); raster-dark starts hidden
      // and applyBasemap() swaps rasters on scene/layer/offline changes.
      {
        id: 'raster-dark',
        type: 'raster',
        source: 'raster-dark',
        layout: { visibility: 'none' },
        paint: { 'raster-saturation': -1, 'raster-contrast': 0.05 },
      },
      {
        id: 'raster-light',
        type: 'raster',
        source: 'raster-light',
        layout: { visibility: 'none' },
      },
      { id: 'raster-sat', type: 'raster', source: 'raster-sat' },
      {
        id: 'raster-terrain',
        type: 'raster',
        source: 'raster-terrain',
        layout: { visibility: 'none' },
      },
      // Dark-basemap tint overlays: the desaturated dark raster renders sea
      // and vegetation as flat gray, so translucent fills restore a
      // deep-navy water tone and a muted green for actual green land
      // cover. Greens are drawn first, then water on top so a water
      // polygon masks any grass/wood that spills past the shoreline.
      {
        id: 'dark-greens',
        type: 'fill',
        source: 'carto-streets',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['grass', 'wood']]] as ExpressionSpecification,
        layout: { visibility: 'none' },
        paint: { 'fill-color': '#2e7d4f', 'fill-opacity': 0.3 },
      },
      {
        id: 'dark-water',
        type: 'fill',
        source: 'carto-streets',
        'source-layer': 'water',
        layout: { visibility: 'none' },
        paint: { 'fill-color': '#1c4d75', 'fill-opacity': 0.45 },
      },
      {
        id: 'world-land-fill',
        type: 'fill',
        source: 'world',
        layout: { visibility: 'none' },
        paint: { 'fill-color': '#14171c' },
      },
      {
        id: 'world-land-line',
        type: 'line',
        source: 'world',
        layout: { visibility: 'none' },
        paint: { 'line-color': 'rgba(255,255,255,.14)', 'line-width': 0.6 },
      },
      {
        id: 'uae-border-line',
        type: 'line',
        source: 'uae',
        paint: {
          'line-color': 'rgba(125,134,151,.4)', // neutral steel — red is for alerts, not geography
          'line-width': 1,
          'line-dasharray': [2, 3],
        },
      },
      {
        id: 'uae-roads',
        type: 'line',
        source: 'uae-roads',
        paint: {
          'line-color': '#7d8697',
          'line-opacity': 0.5,
          'line-width': 0.8,
        },
      },
      // Now that basemaps are _nolabels, uae-places is the only place
      // naming on screen: slightly larger, with a halo so it reads on
      // every basemap. applyPlaceLabelTheme() (Task 3) retints text/halo
      // per basemap (dark vs light/terrain).
      {
        id: 'uae-places',
        type: 'symbol',
        source: 'uae-places',
        layout: {
          'text-field': ['upcase', ['get', 'name']] as ExpressionSpecification,
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-letter-spacing': 0.3,
        },
        paint: {
          'text-color': '#aeb6c4',
          'text-halo-color': '#0a0b0e',
          'text-halo-width': 1.2,
        },
        minzoom: 5.5,
      },
    ],
  }
}

// The three UAE cartography layers sit MID-array in the console style,
// between the coverage layers and drone-trails, so buildStyle cannot simply
// append its simulation layers after the base ones. Selecting them by id
// rather than by array position means a future insertion, removal or
// reorder inside buildBaseStyle cannot silently rebind these to the wrong
// layers. See style.test.ts's golden snapshot for the exact id sequence.
const UAE_LAYER_IDS = ['uae-border-line', 'uae-roads', 'uae-places'] as const

// LayerSpecification.id is a plain `string`; narrowing it against the
// `readonly` tuple above needs a type-only cast (no runtime effect) since
// `Array<T>.includes` otherwise rejects an argument wider than `T`.
function isUaeLayerId(id: string): id is (typeof UAE_LAYER_IDS)[number] {
  return (UAE_LAYER_IDS as readonly string[]).includes(id)
}

// The full MapLibre style: buildBaseStyle() plus docks/sites/coverage
// (seeded from features.ts), the live-empty sim sources, and every layer
// rendering them. NOTE: the legacy layer order (preserved here verbatim)
// interleaves the sim coverage-fill/coverage-line/coverage-line-hi layers
// and the base uae-border-line/uae-roads/uae-places layers between the
// world landmass and drone-trails layers, so this is not a plain
// base-then-sim concatenation — the UAE_LAYER_IDS layers are spliced back
// into their original mid-array position by id. See style.test.ts's golden
// snapshot for the exact id sequence. Called fresh each time (matching the
// legacy EC2.initMap, which rebuilds `style` on every map (re)creation).
export function buildStyle(): StyleSpecification {
  const base = buildBaseStyle()
  const baseLayers = base.layers.filter((l) => !isUaeLayerId(l.id))
  const uaeLayers = UAE_LAYER_IDS.map((id) => {
    const layer = base.layers.find((l) => l.id === id)
    if (!layer) {
      throw new Error(`buildBaseStyle() is missing expected layer "${id}"`)
    }
    return layer
  })

  return {
    ...base,
    sources: {
      ...base.sources,
      docks: { type: 'geojson', data: dockFeatures() },
      coverage: { type: 'geojson', data: coverageFeatures() },
      sites: { type: 'geojson', data: siteFeatures() },
      drones: { type: 'geojson', data: emptyFC() },
      'drone-leaders': { type: 'geojson', data: emptyFC() },
      'drone-trails': { type: 'geojson', data: emptyFC() },
      fx: { type: 'geojson', data: emptyFC() },
      'missions-active': { type: 'geojson', data: emptyFC() },
      tracks: { type: 'geojson', data: emptyFC() },
      'manual-wpts': { type: 'geojson', data: emptyFC() },
      'wizard-preview': { type: 'geojson', data: emptyFC() },
    },
    layers: [
      ...baseLayers,
      // Coverage rings (docks + tower sites; urban 3 km / rural 5 km). Cool
      // cyan reads as "sensor reach", deliberately avoiding brand red
      // (reserved for brand + alert). coverage-fill and coverage-line-hi
      // start filtered to nothing; applyCoverageHighlight() (Task 3)
      // re-filters them to the selected / range-highlighted dock ids.
      {
        id: 'coverage-fill',
        type: 'fill',
        source: 'coverage',
        filter: ['in', ['get', 'id'], ['literal', []]] as ExpressionSpecification,
        paint: {
          'fill-color': '#38bdf8',
          'fill-opacity': 0.08,
        },
      },
      {
        id: 'coverage-line',
        type: 'line',
        source: 'coverage',
        paint: {
          'line-color': '#38bdf8',
          'line-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            6,
            ['case', ['get', 'active'], 0.3, 0.18],
            10.5,
            0.08,
          ] as ExpressionSpecification,
          'line-width': 1,
          'line-dasharray': [3, 3],
        },
      },
      {
        id: 'coverage-line-hi',
        type: 'line',
        source: 'coverage',
        filter: ['in', ['get', 'id'], ['literal', []]] as ExpressionSpecification,
        paint: {
          'line-color': '#38bdf8',
          'line-opacity': 0.5,
          'line-width': 1,
        },
      },
      ...uaeLayers,
      // Breadcrumb history sits under the route lines: faint, non-competing.
      {
        id: 'drone-trails',
        type: 'line',
        source: 'drone-trails',
        paint: {
          'line-color': '#7d8697',
          'line-opacity': 0.22,
          'line-width': 1,
        },
      },
      // Route spotlight: two layers split by the 'spotlit' feature property
      // because line-dasharray is not data-driven — background missions
      // stay a faint dashed hairline, the attended mission renders solid
      // signal-cyan on its own layer.
      {
        id: 'missions-active-line',
        type: 'line',
        source: 'missions-active',
        filter: ['!=', ['get', 'spotlit'], true],
        paint: {
          'line-color': '#7d8697',
          'line-opacity': 0.15,
          'line-width': 1,
          'line-dasharray': [2, 2],
        },
      },
      {
        id: 'missions-active-line-spot',
        type: 'line',
        source: 'missions-active',
        filter: ['==', ['get', 'spotlit'], true],
        paint: {
          'line-color': '#38bdf8',
          'line-opacity': 0.9,
          'line-width': 2.5,
        },
      },
      // Detection tracks: drawn over the route lines but under docks/drones
      // so the chevron always stays on top. Ping first so the pulse ring
      // sits behind its own diamond.
      {
        id: 'tracks-ping',
        type: 'circle',
        source: 'tracks',
        filter: ['==', ['get', 'status'], 'active'],
        paint: {
          'circle-radius': 8,
          'circle-color': '#fbbf24',
          'circle-opacity': 0,
          'circle-stroke-color': '#fbbf24',
          'circle-stroke-opacity': 0,
          'circle-stroke-width': 1.5,
        },
      },
      {
        id: 'tracks-icons',
        type: 'symbol',
        source: 'tracks',
        layout: {
          'icon-image': [
            'match',
            ['get', 'status'],
            'tasked',
            'track-diamond-dim',
            'track-diamond',
          ] as ExpressionSpecification,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      },
      {
        id: 'tracks-labels',
        type: 'symbol',
        source: 'tracks',
        layout: {
          'text-field': [
            'concat',
            ['get', 'id'],
            ' · ',
            ['get', 'label'],
          ] as ExpressionSpecification,
          'text-font': ['Noto Sans Regular'],
          'text-size': 9,
          'text-letter-spacing': 0.05,
          'text-offset': [1.4, 0],
          'text-anchor': 'left',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': [
            'match',
            ['get', 'status'],
            'tasked',
            '#8b93a3',
            '#fbbf24',
          ] as ExpressionSpecification,
          'text-halo-color': '#0a0b0e',
          'text-halo-width': 1.2,
        },
        minzoom: 8,
      },
      {
        id: 'docks-rings',
        type: 'circle',
        source: 'docks',
        paint: {
          'circle-radius': 0,
          'circle-opacity': 0,
          'circle-stroke-color': 'rgba(226,232,240,.5)',
          'circle-stroke-width': 1,
        },
      },
      // Dock color discipline: quiet steel at rest, white only in the
      // moment of launch, amber while charging — and fault is THE ONLY red
      // on the operational map (red = brand chrome + genuine alerts,
      // nothing else).
      {
        id: 'docks-dots',
        type: 'circle',
        source: 'docks',
        paint: {
          'circle-radius': [
            'case',
            ['any', ['==', ['get', 'state'], 'fault'], ['==', ['get', 'state'], 'offline']],
            5.5,
            4.5,
          ] as ExpressionSpecification,
          'circle-color': [
            'match',
            ['get', 'state'],
            'ready',
            '#8b93a3',
            'launching',
            '#e2e8f0',
            'drone-away',
            '#5c6575',
            'landing',
            '#5c6575',
            'charging',
            '#fbbf24',
            'fault',
            '#ff5a5a',
            'offline',
            '#3a404c',
            '#8b93a3',
          ] as ExpressionSpecification,
          'circle-stroke-color': '#0a0b0e',
          'circle-stroke-width': 1.5,
        },
      },
      {
        id: 'sites-dots',
        type: 'circle',
        source: 'sites',
        paint: {
          'circle-radius': 5,
          'circle-color': SITE_STATUS_COLOR,
          'circle-stroke-color': '#0a0b0e',
          'circle-stroke-width': 1.5,
        },
      },
      {
        id: 'sites-labels',
        type: 'symbol',
        source: 'sites',
        layout: {
          'text-field': ['get', 'id'] as ExpressionSpecification,
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'text-offset': [0, -1.2],
          'text-anchor': 'bottom',
        },
        paint: { 'text-color': SITE_STATUS_COLOR },
        minzoom: 7.5,
      },
      // Launch-pulse FX rings: radius/opacity carried as feature
      // properties, rebuilt by the ping driver (Task 3) only while pulses
      // are live.
      {
        id: 'fx',
        type: 'circle',
        source: 'fx',
        paint: {
          'circle-radius': ['get', 'r'] as ExpressionSpecification,
          'circle-color': '#e8ecf4',
          'circle-opacity': 0,
          'circle-stroke-color': '#e8ecf4',
          'circle-stroke-opacity': ['get', 'o'] as ExpressionSpecification,
          'circle-stroke-width': 1.5,
        },
      },
      {
        id: 'drone-leaders',
        type: 'line',
        source: 'drone-leaders',
        paint: {
          'line-color': '#e8ecf4',
          'line-opacity': 0.35,
          'line-width': 1,
        },
      },
      {
        id: 'drones-layer',
        type: 'symbol',
        source: 'drones',
        layout: {
          'icon-image': 'drone-triangle',
          'icon-size': 0.75,
          'icon-rotate': ['get', 'heading'] as ExpressionSpecification,
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      },
      {
        id: 'drones-labels',
        type: 'symbol',
        source: 'drones',
        layout: {
          'text-field': ['get', 'id'] as ExpressionSpecification,
          'text-font': ['Noto Sans Regular'],
          'text-size': 9,
          'text-letter-spacing': 0.05,
          'text-offset': [1.1, 0],
          'text-anchor': 'left',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#aeb6c4',
          'text-halo-color': '#0a0b0e',
          'text-halo-width': 1.2,
        },
        minzoom: 8,
      },
      // Manual control queued waypoints — numbered amber diamonds, driven
      // by the control lane (Task 3) whenever the operator's queue changes.
      {
        id: 'manual-wpts-dots',
        type: 'circle',
        source: 'manual-wpts',
        paint: {
          'circle-radius': 7,
          'circle-color': 'rgba(251,191,36,.18)',
          'circle-stroke-color': '#fbbf24',
          'circle-stroke-width': 1.5,
        },
      },
      {
        id: 'manual-wpts-labels',
        type: 'symbol',
        source: 'manual-wpts',
        layout: {
          'text-field': ['to-string', ['get', 'n']] as ExpressionSpecification,
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': '#fbbf24' },
      },
      // Mission wizard route preview — dashed amber line + numbered
      // markers, distinct from the cyan/steel active-mission lines above so
      // a preview never reads as a live flight. Single 'wizard-preview'
      // source mixes LineString (route) + Point (waypoints/box corners)
      // features, filtered per layer by geometry type.
      {
        id: 'wizard-preview-line',
        type: 'line',
        source: 'wizard-preview',
        filter: ['==', ['geometry-type'], 'LineString'] as ExpressionSpecification,
        paint: {
          'line-color': '#fbbf24',
          'line-opacity': 0.85,
          'line-width': 2,
          'line-dasharray': [2, 2],
        },
      },
      {
        id: 'wizard-preview-dots',
        type: 'circle',
        source: 'wizard-preview',
        filter: ['==', ['geometry-type'], 'Point'] as ExpressionSpecification,
        paint: {
          'circle-radius': 7,
          'circle-color': 'rgba(251,191,36,.18)',
          'circle-stroke-color': '#fbbf24',
          'circle-stroke-width': 1.5,
        },
      },
      {
        id: 'wizard-preview-labels',
        type: 'symbol',
        source: 'wizard-preview',
        filter: ['==', ['geometry-type'], 'Point'] as ExpressionSpecification,
        layout: {
          'text-field': ['to-string', ['get', 'n']] as ExpressionSpecification,
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': '#fbbf24' },
      },
    ],
  }
}
