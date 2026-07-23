(function(){
const UAE_CENTER = [54.6, 24.3];

const RASTERS = {
  dark:    ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png','https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
  light:   ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png','https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
  sat:     ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  terrain: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}']
};

// CARTO basemaps require the OSM+CARTO credit; Esri's World_Imagery/
// World_Topo_Map services require the Esri/Maxar/Earthstar credit. Each
// raster source's own 'attribution' string feeds the AttributionControl
// added in initMap() below (Task 14 fix: re-enable tile attribution).
const RASTER_ATTRIBUTION = {
  dark:    '&copy; OpenStreetMap contributors &copy; CARTO',
  light:   '&copy; OpenStreetMap contributors &copy; CARTO',
  sat:     'Powered by Esri &middot; Source: Esri, Maxar, Earthstar Geographics',
  terrain: 'Powered by Esri &middot; Source: Esri, Maxar, Earthstar Geographics'
};

// CARTO's anonymous vector tiles (OpenMapTiles schema). The dark raster is
// fully desaturated, so water and green spaces read as undifferentiated
// gray; these tiles feed the dark-water/dark-greens overlay fills below,
// giving exact coastlines and green land cover at every zoom.
// Attribution string matches the CARTO rasters so the control dedupes it.
const VECTOR_TILES = [
  'https://tiles-a.basemaps.cartocdn.com/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt',
  'https://tiles-b.basemaps.cartocdn.com/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt',
  'https://tiles-c.basemaps.cartocdn.com/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt',
  'https://tiles-d.basemaps.cartocdn.com/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt'
];

// Water/green tint layers shown only while the dark basemap is active.
const DARK_OVERLAY_IDS = ['dark-water', 'dark-greens'];

// Local glyph vendoring (Task 14 fix): MapLibre's demotiles.maplibre.org
// glyph host is unreachable on a cold offline/file:// boot, so uae-places /
// sites-labels / manual-wpts-labels / wizard-preview-labels text never
// renders. assets/fonts/{fontstack}/{range}.pbf is vendored locally (0-255 +
// 256-511 cover the uppercase-ASCII ids/names this app actually labels);
// this builds a runtime-absolute URL from the page's own location so it
// resolves correctly under both file:// and http(s)://, unlike a bare
// relative path (MapLibre resolves glyph URLs against its own internal
// base, not the page) or a hardcoded origin. {fontstack}/{range} must stay
// literal (not URL-encoded) since MapLibre substitutes them itself.
function localGlyphsUrl(){
  return location.href.replace(/[^\/]*(\?.*)?$/, '') + 'assets/fonts/{fontstack}/{range}.pbf';
}

EC2.dockFeatures = function(){
  return { type:'FeatureCollection', features: DATA_DOCKS.map(d => ({
    type:'Feature',
    properties:{ id:d.id, name:d.name, emirate:d.emirate, model:d.model, state:'ready', selected:false },
    geometry:{ type:'Point', coordinates:d.coords }
  })) };
};

EC2.siteFeatures = function(){
  return { type:'FeatureCollection', features: DATA_SITES.map(s => ({
    type:'Feature',
    properties:{ id:s.id, name:s.name, status:s.status },
    geometry:{ type:'Point', coordinates:s.coords }
  })) };
};

// Coverage rings for every ground location — drone docks AND live tower
// sites — at their operational radius (urban 3 km / rural 5 km, from
// DOCK_RANGE in docks.js). Real-geography circle polygons (not pixel-radius
// circles) so a ring stays a true 3/5 km on the ground at every zoom;
// SimRouter.orbit returns a closed [lon,lat] ring at a metric radius, which
// we wrap as a Polygon. `active` marks live coverage (all docks, plus sites
// with status 'installed'); planned / needs-replacement sites ride along with
// active:false so the layers can render them as a fainter outline-only ring.
EC2.coverageFeatures = function(){
  const DR = window.DOCK_RANGE;
  const orbit = window.SimRouter && window.SimRouter.orbit;
  if (!DR || !orbit) return { type:'FeatureCollection', features: [] };
  const ringFor = (item, kind, active) => {
    const rangeKm = DR.dockRangeKm(item);
    return {
      type:'Feature',
      properties:{ id:item.id, kind:kind, rangeKm:rangeKm, urban:DR.isUrbanDock(item), active:active },
      geometry:{ type:'Polygon', coordinates:[ orbit(item.coords, rangeKm * 1000, 64) ] }
    };
  };
  const feats = [];
  for (const d of DATA_DOCKS) feats.push(ringFor(d, 'dock', true));
  for (const s of DATA_SITES) feats.push(ringFor(s, 'site', s.status === 'installed'));
  return { type:'FeatureCollection', features: feats };
};

// ---------- orbital declutter (Task 10.5) ----------
// Layers that only make sense once the operator has dived into the theater;
// hidden while in the orbital 'globe' scene so only the single UAE beacon
// shows. Guarded with getLayer() since sites-dots/sites-labels are added in
// the same initMap() style build and callers may run before the style has
// fully attached them.
const OPERATIONAL_LAYER_IDS = [
  'docks-dots', 'docks-rings', 'coverage-fill', 'coverage-line',
  'drones-layer', 'missions-active-line',
  'sites-dots', 'sites-labels', 'uae-places', 'uae-roads',
  'manual-wpts-dots', 'manual-wpts-labels',
  'wizard-preview-line', 'wizard-preview-dots', 'wizard-preview-labels'
];

// Shared by sites-dots (fill) and sites-labels (text) so the label always
// matches its dot's status color. installed = green (live), not-installed =
// amber (planned), replace = red (needs replacement).
const SITE_STATUS_COLOR = ['match', ['get', 'status'],
  'installed', '#4ade80',
  'not-installed', '#fbbf24',
  'replace', '#ff5a5a',
  '#4ade80'];

EC2.setOperationalLayersVisible = function(visible){
  if (!EC2.map) return;
  const vis = visible ? 'visible' : 'none';
  for (const id of OPERATIONAL_LAYER_IDS){
    if (EC2.map.getLayer(id)) EC2.map.setLayoutProperty(id, 'visibility', vis);
  }
};

// ---------- live sim layers (Task 9) ----------

function emptyFC(){ return { type:'FeatureCollection', features:[] }; }

function droneIconImage(){
  const size = 24;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ff5a5a';
  ctx.beginPath();
  ctx.moveTo(size / 2, 2);
  ctx.lineTo(size - 4, size - 5);
  ctx.lineTo(4, size - 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2 + 3, 2, 0, Math.PI * 2);
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

function buildDockFeatures(engine){
  const sel = EC2.state.selection;
  const selId = sel && sel.type === 'dock' ? sel.id : null;
  const features = [];
  for (const dock of engine.docks.values()){
    features.push({
      type: 'Feature',
      properties: {
        id: dock.id, name: dock.name, emirate: dock.emirate,
        model: dock.drone ? dock.drone.model : '',
        state: dock.state, selected: dock.id === selId
      },
      geometry: { type: 'Point', coordinates: dock.coords }
    });
  }
  return { type: 'FeatureCollection', features };
}

function buildDroneFeatures(engine){
  const features = [];
  for (const drone of engine.drones.values()){
    if (drone.state === 'docked') continue;
    const p = drone.pos;
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    features.push({
      type: 'Feature',
      properties: { id: drone.id, heading: drone.heading || 0, state: drone.state },
      geometry: { type: 'Point', coordinates: p }
    });
  }
  return { type: 'FeatureCollection', features };
}

function buildMissionLineFeatures(engine){
  const features = [];
  for (const mission of engine.missions.values()){
    if (mission.state !== 'active') continue;
    if (!Array.isArray(mission.waypoints) || mission.waypoints.length < 2) continue;
    features.push({
      type: 'Feature',
      properties: { id: mission.id, type: mission.type },
      geometry: { type: 'LineString', coordinates: mission.waypoints }
    });
  }
  return { type: 'FeatureCollection', features };
}

let lastActiveMissionsKey = '';

// Called once per rAF frame by main.js's engine loop. Keeps the three live
// sources (docks/drones/missions-active) in sync with engine state — each
// source gets at most one setData() per frame.
EC2.updateLiveLayers = function(engine){
  if (!EC2.map || !EC2.mapLoaded || !engine) return;

  const dockSrc = EC2.map.getSource('docks');
  if (dockSrc) dockSrc.setData(buildDockFeatures(engine));

  const droneSrc = EC2.map.getSource('drones');
  if (droneSrc) droneSrc.setData(buildDroneFeatures(engine));

  const missionSrc = EC2.map.getSource('missions-active');
  if (missionSrc){
    let key = '';
    for (const m of engine.missions.values()) if (m.state === 'active') key += m.id + ',';
    if (key !== lastActiveMissionsKey){
      lastActiveMissionsKey = key;
      missionSrc.setData(buildMissionLineFeatures(engine));
    }
  }
};

// Subtle pulsing ring around any dock with an outbound drone, or the
// currently selected dock. Single rAF driver; paint-only, no setData.
function startPingDriver(){
  const PERIOD_MS = 1600;
  function tick(ts){
    requestAnimationFrame(tick);
    if (!EC2.map || !EC2.map.getLayer('docks-rings') || EC2.state.scene !== 'console') return;
    const phase = (ts % PERIOD_MS) / PERIOD_MS;
    const radius = 9 + phase * 7;          // 9 -> 16
    const opacity = 0.45 * (1 - phase);    // fades out
    const cond = ['any', ['==', ['get', 'state'], 'drone-away'], ['get', 'selected']];
    EC2.map.setPaintProperty('docks-rings', 'circle-radius', ['case', cond, radius, 0]);
    EC2.map.setPaintProperty('docks-rings', 'circle-opacity', ['case', cond, opacity, 0]);
  }
  requestAnimationFrame(tick);
}

EC2.initMap = function(){
  const rasterSources = {};
  for (const k of ['dark','light','sat','terrain']){
    rasterSources['raster-'+k] = {
      type: 'raster', tileSize: 256,
      tiles: RASTERS[k],
      attribution: RASTER_ATTRIBUTION[k]
    };
  }

  const style = {
    version: 8,
    glyphs: localGlyphsUrl(),
    projection: { type: 'globe' },
    sources: Object.assign({}, rasterSources, {
      'carto-streets': {
        type: 'vector', tiles: VECTOR_TILES, minzoom: 0, maxzoom: 14,
        attribution: RASTER_ATTRIBUTION.dark
      },
      'uae':        { type: 'geojson', data: GEO_UAE.borders },
      'uae-roads':  { type: 'geojson', data: GEO_UAE.roads },
      'uae-places': { type: 'geojson', data: GEO_UAE.places },
      'docks':      { type: 'geojson', data: EC2.dockFeatures() },
      'coverage':   { type: 'geojson', data: EC2.coverageFeatures() },
      'sites':      { type: 'geojson', data: EC2.siteFeatures() },
      'drones':     { type: 'geojson', data: emptyFC() },
      'missions-active': { type: 'geojson', data: emptyFC() },
      'manual-wpts': { type: 'geojson', data: emptyFC() },
      'wizard-preview': { type: 'geojson', data: emptyFC() },
      'world':      { type: 'geojson', data: GEO_WORLD }
    }),
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0a0b0e' } },
      // Boot scene is 'globe', whose effective basemap is satellite (the
      // orbital view reads as Earth from space); raster-dark starts hidden
      // and applyBasemap() swaps rasters on scene/layer/offline changes.
      { id: 'raster-dark', type: 'raster', source: 'raster-dark',
        layout: { visibility: 'none' },
        paint: { 'raster-saturation': -1, 'raster-contrast': 0.05 } },
      { id: 'raster-light', type: 'raster', source: 'raster-light',
        layout: { visibility: 'none' } },
      { id: 'raster-sat', type: 'raster', source: 'raster-sat' },
      { id: 'raster-terrain', type: 'raster', source: 'raster-terrain',
        layout: { visibility: 'none' } },
      // Dark-basemap tint overlays: the desaturated dark raster renders sea
      // and vegetation as flat gray, so translucent fills restore a deep-navy
      // water tone and a muted green for actual green land cover. Kept
      // translucent so the raster's own labels and texture still show through.
      //
      // Green tint = landcover grass/wood ONLY (real vegetation on land).
      // The vector 'park' source-layer is deliberately NOT tinted: it carries
      // administrative *protected areas*, which in this region are desert
      // reserves (e.g. Arabian Oryx Sanctuary) and — the reported bug — large
      // *marine* reserves (Marawah, Butinah) whose polygons sit over open sea.
      // At country zoom the ocean water polygon is heavily generalized and
      // often absent over those marine reserves, so it can't mask them; the
      // only reliable fix is to not paint protected areas green at all.
      // 'wetland' is likewise excluded: mangroves/tidal flats straddle the
      // waterline. grass/wood are genuine land cover and stay.
      //
      // Greens are drawn first, then water on top: where a water polygon does
      // exist (typically higher zoom), it masks any grass/wood that spills
      // past the shoreline — keeping the green tint on land only.
      { id: 'dark-greens', type: 'fill', source: 'carto-streets',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['grass', 'wood']]],
        layout: { visibility: 'none' },
        paint: { 'fill-color': '#2e7d4f', 'fill-opacity': 0.3 } },
      { id: 'dark-water', type: 'fill', source: 'carto-streets',
        'source-layer': 'water',
        layout: { visibility: 'none' },
        paint: { 'fill-color': '#1c4d75', 'fill-opacity': 0.45 } },
      { id: 'world-land-fill', type: 'fill', source: 'world',
        layout: { visibility: 'none' },
        paint: { 'fill-color': '#14171c' } },
      { id: 'world-land-line', type: 'line', source: 'world',
        layout: { visibility: 'none' },
        paint: { 'line-color': 'rgba(255,255,255,.14)', 'line-width': 0.6 } },
      // Coverage rings (docks + tower sites; urban 3 km / rural 5 km). Cool
      // cyan reads as "sensor reach" and deliberately avoids brand red
      // (reserved for brand + alert). Drawn low in the stack so borders,
      // roads, labels, drones and dots all render on top; the fill is kept
      // very translucent because rings overlap heavily in the metros and
      // compounded alpha would blot out the map. A slightly denser urban fill
      // nudges dense-city coverage to read as more saturated without a second
      // color. Non-active rings (planned / needs-replacement sites) drop the
      // fill entirely and keep only a fainter dashed outline — "planned
      // coverage" — so live vs planned reads at a glance.
      { id: 'coverage-fill', type: 'fill', source: 'coverage',
        paint: {
          'fill-color': '#38bdf8',
          'fill-opacity': ['case', ['get', 'active'],
            ['case', ['get', 'urban'], 0.06, 0.045],
            0]
        } },
      { id: 'coverage-line', type: 'line', source: 'coverage',
        paint: {
          'line-color': '#38bdf8',
          'line-opacity': ['case', ['get', 'active'], 0.3, 0.18],
          'line-width': 1,
          'line-dasharray': [3, 3]
        } },
      { id: 'uae-border-line', type: 'line', source: 'uae',
        paint: {
          'line-color': '#ff5a5a',
          'line-opacity': 0.35,
          'line-width': 1,
          'line-dasharray': [2, 3]
        } },
      { id: 'uae-roads', type: 'line', source: 'uae-roads',
        paint: {
          'line-color': '#7d8697',
          'line-opacity': 0.5,
          'line-width': 0.8
        } },
      { id: 'uae-places', type: 'symbol', source: 'uae-places',
        layout: {
          'text-field': ['upcase', ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'text-letter-spacing': 0.3
        },
        paint: { 'text-color': '#7d8697' },
        minzoom: 5.5 },
      { id: 'missions-active-line', type: 'line', source: 'missions-active',
        paint: {
          'line-color': '#ff5a5a',
          'line-opacity': 0.55,
          'line-width': 1.5,
          'line-dasharray': [2, 2]
        } },
      { id: 'docks-rings', type: 'circle', source: 'docks',
        paint: {
          'circle-radius': 0,
          'circle-opacity': 0,
          'circle-stroke-color': 'rgba(255,90,90,.45)',
          'circle-stroke-width': 1
        } },
      { id: 'docks-dots', type: 'circle', source: 'docks',
        paint: {
          'circle-radius': ['case',
            ['any', ['==', ['get', 'state'], 'fault'], ['==', ['get', 'state'], 'offline']], 5.5,
            4.5],
          'circle-color': ['match', ['get', 'state'],
            'ready', '#ff5a5a',
            'launching', '#ff5a5a',
            'drone-away', '#7d8697',
            'landing', '#7d8697',
            'charging', '#fbbf24',
            'fault', '#fbbf24',
            'offline', '#444a55',
            '#ff5a5a'],
          'circle-stroke-color': '#0a0b0e',
          'circle-stroke-width': 1.5
        } },
      { id: 'sites-dots', type: 'circle', source: 'sites',
        paint: {
          'circle-radius': 5,
          'circle-color': SITE_STATUS_COLOR,
          'circle-stroke-color': '#0a0b0e',
          'circle-stroke-width': 1.5
        } },
      { id: 'sites-labels', type: 'symbol', source: 'sites',
        layout: {
          'text-field': ['get', 'id'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'text-offset': [0, -1.2],
          'text-anchor': 'bottom'
        },
        paint: { 'text-color': SITE_STATUS_COLOR },
        minzoom: 7.5 },
      { id: 'drones-layer', type: 'symbol', source: 'drones',
        layout: {
          'icon-image': 'drone-triangle',
          'icon-size': 0.75,
          'icon-rotate': ['get', 'heading'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true
        } },
      // Manual control (Task 11) queued waypoints — numbered amber diamonds,
      // driven by control.js whenever the operator's queue changes.
      { id: 'manual-wpts-dots', type: 'circle', source: 'manual-wpts',
        paint: {
          'circle-radius': 7,
          'circle-color': 'rgba(251,191,36,.18)',
          'circle-stroke-color': '#fbbf24',
          'circle-stroke-width': 1.5
        } },
      { id: 'manual-wpts-labels', type: 'symbol', source: 'manual-wpts',
        layout: {
          'text-field': ['to-string', ['get', 'n']],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: { 'text-color': '#fbbf24' } },
      // Mission wizard (Task 12) route preview — dashed amber line + numbered
      // markers, distinct from the solid-red active-mission line above so a
      // preview never reads as a live flight. Single 'wizard-preview' source
      // mixes LineString (route) + Point (waypoints/box corners) features,
      // filtered per layer by geometry type; control.js drives its data.
      { id: 'wizard-preview-line', type: 'line', source: 'wizard-preview',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': '#fbbf24',
          'line-opacity': 0.85,
          'line-width': 2,
          'line-dasharray': [2, 2]
        } },
      { id: 'wizard-preview-dots', type: 'circle', source: 'wizard-preview',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 7,
          'circle-color': 'rgba(251,191,36,.18)',
          'circle-stroke-color': '#fbbf24',
          'circle-stroke-width': 1.5
        } },
      { id: 'wizard-preview-labels', type: 'symbol', source: 'wizard-preview',
        filter: ['==', ['geometry-type'], 'Point'],
        layout: {
          'text-field': ['to-string', ['get', 'n']],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: { 'text-color': '#fbbf24' } }
    ]
  };

  EC2.map = new maplibregl.Map({
    container: 'map', style,
    center: UAE_CENTER, zoom: 1.4, attributionControl: false,
    canvasContextAttributes: { antialias: true },
    // Shift+drag box-zoom is off by design: manual control (Task 11) uses
    // shift+click on the map to queue a waypoint, and MapLibre's default
    // box-zoom handler would otherwise swallow that gesture before it ever
    // becomes a normal 'click' event.
    boxZoom: false
  });
  // Tile attribution (Task 14 fix): attributionControl:false above just
  // suppresses MapLibre's default (unstyled, bright) control so a themed
  // compact one can be added instead — CARTO/Esri both require attribution
  // per their terms, and .maplibregl-ctrl-attrib is restyled in console.css
  // to sit quietly bottom-right instead of a bright white box.
  EC2.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  EC2.mapReady = new Promise(res => EC2.map.on('load', () => {
    if (!EC2.map.hasImage('drone-triangle')) EC2.map.addImage('drone-triangle', droneIconImage());
    EC2.mapLoaded = true;
    startPingDriver();
    // Orbital declutter (Task 10.5): subscribe once, then immediately apply
    // the current scene so boot (scene === 'globe') hides operational
    // layers before the first paint, rather than waiting for a scene fire.
    EC2.onSceneChange(scene => EC2.setOperationalLayersVisible(scene === 'console'));
    EC2.setOperationalLayersVisible(EC2.state.scene === 'console');
    // Orbital satellite (see effectiveLayer): swap basemaps when the scene
    // flips between globe (always sat) and console (operator's layer pick).
    EC2.onSceneChange(() => applyBasemap());
    applyBasemap();
    res();
  }));

  let tileErrors = 0, offlineTimer = null;
  EC2.map.on('error', (e) => {
    if (e.sourceId && e.sourceId.startsWith('raster-')) {
      if (++tileErrors >= 6 && !EC2.state.offline) EC2.setOffline(true);
    }
  });

  EC2.setOffline = function(on){
    EC2.state.offline = on;
    applyBasemap();
    for (const id of ['world-land-fill','world-land-line'])
      EC2.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    document.getElementById('offline-chip').hidden = !on;
    if (offlineTimer){ clearInterval(offlineTimer); offlineTimer = null; }
    if (on){
      tileErrors = 0;
      offlineTimer = setInterval(() => { // recheck: try loading a 1px tile
        const myTimer = offlineTimer;
        const img = new Image();
        img.onload = () => {
          if (offlineTimer !== myTimer) return; // stale probe from a previous episode
          clearInterval(offlineTimer); offlineTimer = null; EC2.setOffline(false);
        };
        img.src = 'https://a.basemaps.cartocdn.com/dark_all/3/5/3.png?t=' + Date.now();
      }, 15000);
    }
  };
};

// The basemap the operator actually sees: the orbital scene always shows
// satellite imagery regardless of the layer chips; the selected layer
// applies once inside the theater (console scene).
function effectiveLayer(){
  return EC2.state.scene === 'globe' ? 'sat' : EC2.state.layer;
}

function applyBasemap(){
  if (!EC2.map) return;
  const eff = EC2.state.offline ? null : effectiveLayer();
  for (const k of ['dark','light','sat','terrain'])
    EC2.map.setLayoutProperty('raster-'+k, 'visibility', k===eff ? 'visible' : 'none');
  const overlayVis = eff === 'dark' ? 'visible' : 'none';
  for (const id of DARK_OVERLAY_IDS)
    if (EC2.map.getLayer(id)) EC2.map.setLayoutProperty(id, 'visibility', overlayVis);
}

EC2.setLayer = function(name){
  EC2.state.layer = name;
  document.documentElement.dataset.maplayer = name; // lets CSS adapt chips on light
  applyBasemap(); // no-ops the rasters while offline (eff === null)
};
})();
