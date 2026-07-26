// Ported (Phase 1B / Task 2) from assets/js/ui/map.js:1-51 (RASTERS,
// RASTER_ATTRIBUTION, VECTOR_TILES, localGlyphsUrl), :37 (DARK_OVERLAY_IDS),
// :101-118 (OPERATIONAL_LAYER_IDS, SITE_STATUS_COLOR), and :966-971
// (effectiveLayer). Only the module wiring and typing changed; the tile
// URLs, attribution strings, layer-id lists, and the match expression's
// colors are transcribed verbatim.
//
// `localGlyphsUrl()` used `location.href` to build a runtime-absolute URL
// under both file:// and http(s)://; the Vite app instead has a real base
// URL at build time via `import.meta.env.BASE_URL`, so `glyphsUrl()` uses
// that instead. `{fontstack}/{range}` stay literal — MapLibre substitutes
// them itself, so they must not be URL-encoded.

import type maplibregl from 'maplibre-gl'
import type { ExpressionSpecification } from 'maplibre-gl'
import type { MapLayer, Scene } from '@/shared/store'

// _nolabels variants: the console draws its own place labels (uae-places),
// so the basemap's baked-in labels only add clutter and double-labeling.
export const RASTERS: Record<MapLayer, string[]> = {
  dark: [
    'https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
    'https://b.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
  ],
  light: [
    'https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
    'https://b.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
  ],
  sat: [
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  ],
  terrain: [
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
  ],
}

// CARTO basemaps require the OSM+CARTO credit; Esri's World_Imagery/
// World_Topo_Map services require the Esri/Maxar/Earthstar credit. Each
// raster source's own 'attribution' string feeds the AttributionControl
// added at map init (re-enable tile attribution).
export const RASTER_ATTRIBUTION: Record<MapLayer, string> = {
  dark: '&copy; OpenStreetMap contributors &copy; CARTO',
  light: '&copy; OpenStreetMap contributors &copy; CARTO',
  sat: 'Powered by Esri &middot; Source: Esri, Maxar, Earthstar Geographics',
  terrain: 'Powered by Esri &middot; Source: Esri, Maxar, Earthstar Geographics',
}

// CARTO's anonymous vector tiles (OpenMapTiles schema). The dark raster is
// fully desaturated, so water and green spaces read as undifferentiated
// gray; these tiles feed the dark-water/dark-greens overlay fills, giving
// exact coastlines and green land cover at every zoom.
export const VECTOR_TILES: string[] = [
  'https://tiles-a.basemaps.cartocdn.com/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt',
  'https://tiles-b.basemaps.cartocdn.com/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt',
  'https://tiles-c.basemaps.cartocdn.com/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt',
  'https://tiles-d.basemaps.cartocdn.com/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt',
]

// Water/green tint layers shown only while the dark basemap is active.
export const DARK_OVERLAY_IDS: string[] = ['dark-water', 'dark-greens']

// Layers that only make sense once the operator has dived into the theater;
// hidden while in the orbital 'globe' scene so only the single UAE beacon
// shows.
export const OPERATIONAL_LAYER_IDS: string[] = [
  'docks-dots',
  'docks-rings',
  'coverage-fill',
  'coverage-line',
  'coverage-line-hi',
  'drones-layer',
  'drones-labels',
  'drone-leaders',
  'drone-trails',
  'missions-active-line',
  'missions-active-line-spot',
  'fx',
  'tracks-ping',
  'tracks-icons',
  'tracks-labels',
  'sites-dots',
  'sites-labels',
  'uae-places',
  'uae-roads',
  'manual-wpts-dots',
  'manual-wpts-labels',
  'wizard-preview-line',
  'wizard-preview-dots',
  'wizard-preview-labels',
]

// Shared by sites-dots (fill) and sites-labels (text) so the label always
// matches its dot's status color. installed = green (live), not-installed =
// amber (planned), replace = red (needs replacement).
export const SITE_STATUS_COLOR: ExpressionSpecification = [
  'match',
  ['get', 'status'],
  'installed',
  '#4ade80',
  'not-installed',
  '#fbbf24',
  'replace',
  '#ff5a5a',
  '#4ade80',
]

// The basemap the operator actually sees: the orbital scene always shows
// satellite imagery regardless of the layer chips; the selected layer
// applies once inside the theater (console scene).
export function effectiveLayer(scene: Scene, layer: MapLayer): MapLayer {
  return scene === 'globe' ? 'sat' : layer
}

// ---------------------------------------------------------------------------
// Basemap appliers, shared by the console (useBasemap) and the planner
// (usePlannerBasemap).
//
// These moved here verbatim out of useBasemap.ts when the planner gained its
// own LAYERS control. They are deliberately NOT duplicated per module: "what
// does basemap X mean" is one fact, and this project's two worst shipped bugs
// (the id counter, and autoPlace hardcoding environment: 'rural') were both
// two independently-correct call sites disagreeing about a shared fact. Both
// callers build their style over buildBaseStyle(), so the raster-*,
// DARK_OVERLAY_IDS and uae-places layers these touch exist on both maps.
//
// `eff` is the EFFECTIVE basemap (null = offline, no raster at all), which is
// not always the selected one. The two callers compute it differently on
// purpose; see each hook's comment.
// ---------------------------------------------------------------------------

// Sets exactly one of the four raster layers visible (none of them when
// offline) and toggles the dark-basemap water/green tint overlays with it.
export function applyRasterVisibility(map: maplibregl.Map, eff: string | null): void {
  for (const k of ['dark', 'light', 'sat', 'terrain'] as const) {
    map.setLayoutProperty(`raster-${k}`, 'visibility', k === eff ? 'visible' : 'none')
  }
  const overlayVis = eff === 'dark' ? 'visible' : 'none'
  for (const id of DARK_OVERLAY_IDS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', overlayVis)
  }
}

// With _nolabels basemaps, uae-places is the map's only naming layer: retint
// its text/halo per basemap so it reads everywhere. Light + terrain rasters
// are pale (dark ink, light halo); dark + sat + offline stay light-on-dark.
export function applyPlaceLabelTheme(map: maplibregl.Map, eff: string | null): void {
  if (!map.getLayer('uae-places')) return
  const pale = eff === 'light' || eff === 'terrain'
  map.setPaintProperty('uae-places', 'text-color', pale ? '#3a404c' : '#aeb6c4')
  map.setPaintProperty('uae-places', 'text-halo-color', pale ? 'rgba(255,255,255,.85)' : '#0a0b0e')
}

// Local glyph vendoring: assets/fonts/{fontstack}/{range}.pbf is vendored
// under the app's own base path so glyphs resolve under dev, preview, and
// production builds alike. {fontstack}/{range} must stay literal (not
// URL-encoded) since MapLibre substitutes them itself.
export function glyphsUrl(): string {
  return `${import.meta.env.BASE_URL}assets/fonts/{fontstack}/{range}.pbf`
}

// ---------------------------------------------------------------------------
// Basemap naming, shared by the console topbar/LayersMenu and the planner's
// PlannerLayersMenu. Previously written out three times; this module's header
// already records why basemap facts live in exactly one place.
// ---------------------------------------------------------------------------

export const LAYER_LABELS: Record<MapLayer, string> = {
  dark: 'DARK',
  light: 'LIGHT',
  sat: 'SATELLITE',
  terrain: 'TERRAIN',
}

// Row order in every basemap picker. Darkest to lightest, imagery last.
export const LAYER_ORDER: MapLayer[] = ['dark', 'light', 'sat', 'terrain']

// The dropdown trigger's text. Both modules name the ACTIVE basemap in the
// button so it is readable without opening the menu.
export function layerButtonLabel(layer: MapLayer): string {
  return `LAYERS · ${LAYER_LABELS[layer] ?? String(layer).toUpperCase()}`
}
