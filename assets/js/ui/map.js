(function(){
const UAE_CENTER = [54.6, 24.3];

const RASTERS = {
  // _nolabels variants: the console draws its own place labels (uae-places),
  // so the basemap's baked-in labels only add clutter and double-labeling.
  dark:    ['https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png','https://b.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png'],
  light:   ['https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png','https://b.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png'],
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
  'docks-dots', 'docks-rings', 'coverage-fill', 'coverage-line', 'coverage-line-hi',
  'drones-layer', 'drones-labels', 'drone-leaders', 'drone-trails',
  'missions-active-line', 'missions-active-line-spot', 'fx',
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

// Air-track chevron (NATO-ish friendly-air read, not a gamer triangle):
// narrow arrowhead with a notched tail so the heading is unambiguous at a
// glance. Neutral white — drones are own assets, never alert-red.
function droneIconImage(){
  const size = 24;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.moveTo(size / 2, 2);            // nose
  ctx.lineTo(size / 2 + 6, size - 4); // right wingtip
  ctx.lineTo(size / 2, size - 9);     // tail notch
  ctx.lineTo(size / 2 - 6, size - 4); // left wingtip
  ctx.closePath();
  ctx.fillStyle = '#e8ecf4';
  ctx.fill();
  ctx.strokeStyle = '#0a0b0e';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
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

function buildMissionLineFeatures(engine, spotId){
  const features = [];
  for (const mission of engine.missions.values()){
    if (mission.state !== 'active') continue;
    if (!Array.isArray(mission.waypoints) || mission.waypoints.length < 2) continue;
    features.push({
      type: 'Feature',
      properties: { id: mission.id, type: mission.type, spotlit: mission.id === spotId },
      geometry: { type: 'LineString', coordinates: mission.waypoints }
    });
  }
  return { type: 'FeatureCollection', features };
}

// Route spotlight (C-5): the one mission the operator is attending to — the
// selected drone's, a selected dock's away-drone's, or the followed drone's —
// renders solid and bright; every other active route drops to a faint dashed
// hairline so the tactical picture reads instantly.
function spotlitMissionId(engine){
  const sel = EC2.state.selection;
  if (sel && sel.type === 'drone'){
    const d = engine.drones.get(sel.id);
    if (d && d.missionId) return d.missionId;
  }
  if (sel && sel.type === 'dock'){
    const dock = engine.docks.get(sel.id);
    if (dock && dock.drone && dock.drone.missionId) return dock.drone.missionId;
  }
  if (EC2.followDroneId){
    const d = engine.drones.get(EC2.followDroneId);
    if (d && d.missionId) return d.missionId;
  }
  return null;
}

// Velocity leaders: a thin ~800 m line ahead of each moving drone along its
// heading — instant read of where every track is going without following it.
// SimRouter.offsetMeters takes (pos, eastMeters, northMeters); heading is
// degrees clockwise from north, so east = sin, north = cos.
function buildLeaderFeatures(engine){
  const off = window.SimRouter && window.SimRouter.offsetMeters;
  const features = [];
  if (off) for (const drone of engine.drones.values()){
    if (drone.state === 'docked' || !(drone.speedMs > 0)) continue;
    const p = drone.pos;
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const rad = (drone.heading || 0) * Math.PI / 180;
    features.push({
      type: 'Feature', properties: { id: drone.id },
      geometry: { type: 'LineString',
        coordinates: [p.slice(), off(p, Math.sin(rad) * 800, Math.cos(rad) * 800)] }
    });
  }
  return { type: 'FeatureCollection', features };
}

// Breadcrumb trails: last ~40 fixes per airborne drone, spaced >=120 m so a
// hovering/orbiting drone doesn't spam points. Bounded memory: capped at 40
// points and the whole entry is dropped the moment the drone re-docks (or
// disappears from the engine).
const TRAIL_MAX_POINTS = 40;
const TRAIL_MIN_STEP_M = 120;
const droneTrails = new Map();

function updateTrails(engine){
  const dist = window.SimRouter && window.SimRouter.distM;
  let dirty = false;
  for (const drone of engine.drones.values()){
    if (drone.state === 'docked'){
      if (droneTrails.delete(drone.id)) dirty = true;
      continue;
    }
    const p = drone.pos;
    if (!dist || !p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const trail = droneTrails.get(drone.id);
    if (!trail){
      droneTrails.set(drone.id, [p.slice()]);
      dirty = true;
    } else if (dist(trail[trail.length - 1], p) >= TRAIL_MIN_STEP_M){
      trail.push(p.slice());
      if (trail.length > TRAIL_MAX_POINTS) trail.shift();
      dirty = true;
    }
  }
  for (const id of Array.from(droneTrails.keys())){
    if (!engine.drones.has(id)){ droneTrails.delete(id); dirty = true; }
  }
  return dirty;
}

function buildTrailFeatures(){
  const features = [];
  for (const entry of droneTrails){
    if (entry[1].length < 2) continue;
    features.push({
      type: 'Feature', properties: { id: entry[0] },
      geometry: { type: 'LineString', coordinates: entry[1] }
    });
  }
  return { type: 'FeatureCollection', features };
}

// Coverage on demand (task 4 + C-4): the big coverage source is static
// geometry, so highlighting is done purely with layer filters — never
// setData. coverage-fill / coverage-line-hi are filtered down to just the
// dock ids the operator cares about (selection-derived dock, plus the
// wizard/manual setRangeHighlight target); everything else shows only the
// zoom-fading hairline of the base coverage-line layer.
let rangeHighlightDockId = null;
let lastCoverageSel = null;
let lastEngineRef = null;

function coverageHighlightIds(engine){
  const ids = [];
  const sel = EC2.state.selection;
  if (sel && sel.type === 'dock'){
    ids.push(sel.id);
  } else if (sel && sel.type === 'drone' && engine){
    const d = engine.drones.get(sel.id);
    if (d && d.dockId) ids.push(d.dockId);
  }
  if (rangeHighlightDockId && ids.indexOf(rangeHighlightDockId) === -1)
    ids.push(rangeHighlightDockId);
  return ids;
}

function applyCoverageHighlight(engine){
  if (!EC2.map || !EC2.mapLoaded) return;
  const ids = coverageHighlightIds(engine);
  const key = ids.join(',');
  if (key === lastCoverageSel) return;
  lastCoverageSel = key;
  const filter = ['in', ['get', 'id'], ['literal', ids]];
  if (EC2.map.getLayer('coverage-fill')) EC2.map.setFilter('coverage-fill', filter);
  if (EC2.map.getLayer('coverage-line-hi')) EC2.map.setFilter('coverage-line-hi', filter);
}

// C-4: wizard step 2 / manual mode call this to spotlight one dock's range
// ring. Safe before map load — the id is stashed and applied on the next
// updateLiveLayers frame (or immediately when the map is already up).
EC2.setRangeHighlight = function(dockId){
  rangeHighlightDockId = dockId || null;
  applyCoverageHighlight(lastEngineRef);
};

// C-3: expanding ring burst at a dock on mission launch. Pulses are stored
// here with their start timestamps; the ping rAF driver rebuilds the tiny
// 'fx' source (<=3 point features per pulse) each frame while any are live
// and prunes finished ones. Before map load the pulse is dropped (guard
// below) — a launch FX with no map to draw on has nothing to show anyway.
const FX_PULSE_LIFE_MS = 1200;
const FX_PULSE_RINGS = 3;
const FX_PULSE_STAGGER_MS = 150;
const fxPulses = [];

EC2.launchPulse = function(dockId){
  // Off-console (globe scene / hidden tab at 16×) the FX driver is paused
  // and would never prune — skip the push rather than accumulate.
  if (!EC2.map || !EC2.mapLoaded || EC2.state.scene !== 'console') return;
  const dock = (window.DATA_DOCKS || []).find(d => d.id === dockId);
  if (!dock || !dock.coords) return;
  fxPulses.push({ coords: dock.coords.slice(), start: performance.now() });
};

let lastActiveMissionsKey = '';

// Called once per rAF frame by main.js's engine loop. Keeps the live sources
// (docks/drones/missions-active/drone-leaders/drone-trails) in sync with
// engine state — each source gets at most one setData() per frame, and the
// mission/trail sources only when their content actually changed.
EC2.updateLiveLayers = function(engine){
  if (!EC2.map || !EC2.mapLoaded || !engine) return;
  lastEngineRef = engine;

  const dockSrc = EC2.map.getSource('docks');
  if (dockSrc) dockSrc.setData(buildDockFeatures(engine));

  const droneSrc = EC2.map.getSource('drones');
  if (droneSrc) droneSrc.setData(buildDroneFeatures(engine));

  const leaderSrc = EC2.map.getSource('drone-leaders');
  if (leaderSrc) leaderSrc.setData(buildLeaderFeatures(engine));

  const trailSrc = EC2.map.getSource('drone-trails');
  if (trailSrc && updateTrails(engine)) trailSrc.setData(buildTrailFeatures());

  const missionSrc = EC2.map.getSource('missions-active');
  if (missionSrc){
    const spotId = spotlitMissionId(engine);
    // Selection identity is part of the cache key (C-5) so a spotlight
    // change re-renders even when the set of active missions is unchanged.
    let key = (spotId || '') + '|';
    for (const m of engine.missions.values()) if (m.state === 'active') key += m.id + ',';
    if (key !== lastActiveMissionsKey){
      lastActiveMissionsKey = key;
      missionSrc.setData(buildMissionLineFeatures(engine, spotId));
    }
  }

  applyCoverageHighlight(engine);
};

// Subtle pulsing ring around any dock with an outbound drone, or the
// currently selected dock (paint-only), plus launch-pulse FX ring bursts
// (tiny fx source rebuilt only while pulses are live). Single rAF driver.
function startPingDriver(){
  const PERIOD_MS = 1600;
  let fxActive = false;
  function tick(ts){
    requestAnimationFrame(tick);
    if (!EC2.map || !EC2.map.getLayer('docks-rings') || EC2.state.scene !== 'console') return;
    const phase = (ts % PERIOD_MS) / PERIOD_MS;
    const radius = 9 + phase * 7;          // 9 -> 16
    const opacity = 0.45 * (1 - phase);    // fades out
    const cond = ['any', ['==', ['get', 'state'], 'drone-away'], ['get', 'selected']];
    EC2.map.setPaintProperty('docks-rings', 'circle-radius', ['case', cond, radius, 0]);
    EC2.map.setPaintProperty('docks-rings', 'circle-opacity', ['case', cond, opacity, 0]);

    const fxSrc = EC2.map.getSource('fx');
    if (!fxSrc) return;
    if (fxPulses.length){
      const features = [];
      for (let i = fxPulses.length - 1; i >= 0; i--){
        const pulse = fxPulses[i];
        const age = ts - pulse.start;
        if (age > FX_PULSE_LIFE_MS + FX_PULSE_STAGGER_MS * (FX_PULSE_RINGS - 1)){
          fxPulses.splice(i, 1);
          continue;
        }
        for (let r = 0; r < FX_PULSE_RINGS; r++){
          const t = (age - r * FX_PULSE_STAGGER_MS) / FX_PULSE_LIFE_MS;
          if (t < 0 || t > 1) continue;
          features.push({
            type: 'Feature',
            properties: { r: 6 + t * 30, o: 0.55 * (1 - t) },
            geometry: { type: 'Point', coordinates: pulse.coords }
          });
        }
      }
      fxSrc.setData({ type: 'FeatureCollection', features });
      fxActive = true;
    } else if (fxActive){
      fxSrc.setData(emptyFC());
      fxActive = false;
    }
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
      'drone-leaders': { type: 'geojson', data: emptyFC() },
      'drone-trails':  { type: 'geojson', data: emptyFC() },
      'fx':            { type: 'geojson', data: emptyFC() },
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
      // roads, labels, drones and dots all render on top. Coverage is
      // on-demand: the base picture is hairline dashed rings only (planned /
      // needs-replacement sites already fainter via 'active'), fading further
      // as the operator zooms in — they're context, not content. Fill +
      // solid line exist only on highlighted rings: coverage-fill and
      // coverage-line-hi start filtered to nothing and
      // applyCoverageHighlight() re-filters them to the selected /
      // range-highlighted dock ids. The big coverage source itself is
      // static: highlighting is filter/paint only, never setData.
      { id: 'coverage-fill', type: 'fill', source: 'coverage',
        filter: ['in', ['get', 'id'], ['literal', []]],
        paint: {
          'fill-color': '#38bdf8',
          'fill-opacity': 0.08
        } },
      { id: 'coverage-line', type: 'line', source: 'coverage',
        paint: {
          'line-color': '#38bdf8',
          'line-opacity': ['interpolate', ['linear'], ['zoom'],
            6, ['case', ['get', 'active'], 0.3, 0.18],
            10.5, 0.08],
          'line-width': 1,
          'line-dasharray': [3, 3]
        } },
      { id: 'coverage-line-hi', type: 'line', source: 'coverage',
        filter: ['in', ['get', 'id'], ['literal', []]],
        paint: {
          'line-color': '#38bdf8',
          'line-opacity': 0.5,
          'line-width': 1
        } },
      { id: 'uae-border-line', type: 'line', source: 'uae',
        paint: {
          'line-color': 'rgba(125,134,151,.4)', // neutral steel — red is for alerts, not geography
          'line-width': 1,
          'line-dasharray': [2, 3]
        } },
      { id: 'uae-roads', type: 'line', source: 'uae-roads',
        paint: {
          'line-color': '#7d8697',
          'line-opacity': 0.5,
          'line-width': 0.8
        } },
      // Now that basemaps are _nolabels, uae-places is the only place naming
      // on screen: slightly larger, with a halo so it reads on every basemap.
      // applyBasemap() retints text/halo per basemap (dark vs light/terrain).
      { id: 'uae-places', type: 'symbol', source: 'uae-places',
        layout: {
          'text-field': ['upcase', ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-letter-spacing': 0.3
        },
        paint: {
          'text-color': '#aeb6c4',
          'text-halo-color': '#0a0b0e',
          'text-halo-width': 1.2
        },
        minzoom: 5.5 },
      // Breadcrumb history sits under the route lines: faint, non-competing.
      { id: 'drone-trails', type: 'line', source: 'drone-trails',
        paint: {
          'line-color': '#7d8697',
          'line-opacity': 0.22,
          'line-width': 1
        } },
      // Route spotlight (task 3): two layers split by the 'spotlit' feature
      // property because line-dasharray is not data-driven — background
      // missions stay a faint dashed hairline, the attended mission renders
      // solid signal-cyan on its own layer.
      { id: 'missions-active-line', type: 'line', source: 'missions-active',
        filter: ['!=', ['get', 'spotlit'], true],
        paint: {
          'line-color': '#7d8697',
          'line-opacity': 0.15,
          'line-width': 1,
          'line-dasharray': [2, 2]
        } },
      { id: 'missions-active-line-spot', type: 'line', source: 'missions-active',
        filter: ['==', ['get', 'spotlit'], true],
        paint: {
          'line-color': '#38bdf8',
          'line-opacity': 0.9,
          'line-width': 2.5
        } },
      { id: 'docks-rings', type: 'circle', source: 'docks',
        paint: {
          'circle-radius': 0,
          'circle-opacity': 0,
          'circle-stroke-color': 'rgba(226,232,240,.5)',
          'circle-stroke-width': 1
        } },
      // Dock color discipline: quiet steel at rest, white only in the moment
      // of launch, amber while charging — and fault is THE ONLY red on the
      // operational map (red = brand chrome + genuine alerts, nothing else).
      { id: 'docks-dots', type: 'circle', source: 'docks',
        paint: {
          'circle-radius': ['case',
            ['any', ['==', ['get', 'state'], 'fault'], ['==', ['get', 'state'], 'offline']], 5.5,
            4.5],
          'circle-color': ['match', ['get', 'state'],
            'ready', '#8b93a3',
            'launching', '#e2e8f0',
            'drone-away', '#5c6575',
            'landing', '#5c6575',
            'charging', '#fbbf24',
            'fault', '#ff5a5a',
            'offline', '#3a404c',
            '#8b93a3'],
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
      // Launch-pulse FX rings (C-3): radius/opacity carried as feature
      // properties, rebuilt by the ping driver only while pulses are live.
      { id: 'fx', type: 'circle', source: 'fx',
        paint: {
          'circle-radius': ['get', 'r'],
          'circle-color': '#e8ecf4',
          'circle-opacity': 0,
          'circle-stroke-color': '#e8ecf4',
          'circle-stroke-opacity': ['get', 'o'],
          'circle-stroke-width': 1.5
        } },
      { id: 'drone-leaders', type: 'line', source: 'drone-leaders',
        paint: {
          'line-color': '#e8ecf4',
          'line-opacity': 0.35,
          'line-width': 1
        } },
      { id: 'drones-layer', type: 'symbol', source: 'drones',
        layout: {
          'icon-image': 'drone-triangle',
          'icon-size': 0.75,
          'icon-rotate': ['get', 'heading'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true
        } },
      { id: 'drones-labels', type: 'symbol', source: 'drones',
        layout: {
          'text-field': ['get', 'id'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 9,
          'text-letter-spacing': 0.05,
          'text-offset': [1.1, 0],
          'text-anchor': 'left',
          'text-allow-overlap': false
        },
        paint: {
          'text-color': '#aeb6c4',
          'text-halo-color': '#0a0b0e',
          'text-halo-width': 1.2
        },
        minzoom: 8 },
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
      // markers, distinct from the cyan/steel active-mission lines above so a
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
  initBasemapLoadingChip();
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
        img.src = 'https://a.basemaps.cartocdn.com/dark_nolabels/3/5/3.png?t=' + Date.now();
      }, 15000);
    }
  };
};

// Tile loading state (task: basemap chip). A small "ACQUIRING BASEMAP" chip
// appears only when raster basemap tiles are actually being fetched, with a
// 300ms debounce so quick cached pans never flash it. 'idle' both cancels a
// pending show and hides an already-visible chip. Styling lives in
// console.css (#basemap-loading, applied by the integrator).
function initBasemapLoadingChip(){
  const chip = document.createElement('div');
  chip.id = 'basemap-loading';
  chip.textContent = 'ACQUIRING BASEMAP';
  chip.hidden = true;
  document.body.appendChild(chip);
  let showTimer = null;
  EC2.map.on('sourcedataloading', e => {
    // Console scene only — the chip must never sit over the globe cinematic
    // (orbital satellite tiles load slowly on a cold cache).
    if (EC2.state.scene !== 'console') return;
    if (!e.sourceId || e.sourceId.indexOf('raster-') !== 0) return;
    if (showTimer !== null || !chip.hidden) return;
    showTimer = setTimeout(() => { showTimer = null; chip.hidden = false; }, 300);
  });
  EC2.map.on('idle', () => {
    if (showTimer !== null){ clearTimeout(showTimer); showTimer = null; }
    chip.hidden = true;
  });
}

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
  applyPlaceLabelTheme(eff);
}

// With _nolabels basemaps, uae-places is the map's only naming layer: retint
// its text/halo per basemap so it reads everywhere. Light + terrain rasters
// are pale (dark ink, light halo); dark + sat + offline stay light-on-dark.
function applyPlaceLabelTheme(eff){
  if (!EC2.map || !EC2.map.getLayer('uae-places')) return;
  const pale = eff === 'light' || eff === 'terrain';
  EC2.map.setPaintProperty('uae-places', 'text-color', pale ? '#3a404c' : '#aeb6c4');
  EC2.map.setPaintProperty('uae-places', 'text-halo-color',
    pale ? 'rgba(255,255,255,.85)' : '#0a0b0e');
}

EC2.setLayer = function(name){
  EC2.state.layer = name;
  document.documentElement.dataset.maplayer = name; // lets CSS adapt chips on light
  applyBasemap(); // no-ops the rasters while offline (eff === null)
};
})();
