(function(){
const UAE_CENTER = [54.6, 24.3];

const RASTERS = {
  dark:    ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png','https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
  light:   ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png','https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
  sat:     ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  terrain: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}']
};

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

// ---------- orbital declutter (Task 10.5) ----------
// Layers that only make sense once the operator has dived into the theater;
// hidden while in the orbital 'globe' scene so only the single UAE beacon
// shows. Guarded with getLayer() since sites-dots/sites-labels are added in
// the same initMap() style build and callers may run before the style has
// fully attached them.
const OPERATIONAL_LAYER_IDS = [
  'docks-dots', 'docks-rings', 'drones-layer', 'missions-active-line',
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
      attribution: '© OpenStreetMap © CARTO'
    };
  }

  const style = {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    projection: { type: 'globe' },
    sources: Object.assign({}, rasterSources, {
      'uae':        { type: 'geojson', data: GEO_UAE.borders },
      'uae-roads':  { type: 'geojson', data: GEO_UAE.roads },
      'uae-places': { type: 'geojson', data: GEO_UAE.places },
      'docks':      { type: 'geojson', data: EC2.dockFeatures() },
      'sites':      { type: 'geojson', data: EC2.siteFeatures() },
      'drones':     { type: 'geojson', data: emptyFC() },
      'missions-active': { type: 'geojson', data: emptyFC() },
      'manual-wpts': { type: 'geojson', data: emptyFC() },
      'wizard-preview': { type: 'geojson', data: emptyFC() },
      'world':      { type: 'geojson', data: GEO_WORLD }
    }),
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0a0b0e' } },
      { id: 'raster-dark', type: 'raster', source: 'raster-dark',
        paint: { 'raster-saturation': -1, 'raster-contrast': 0.05 } },
      { id: 'raster-light', type: 'raster', source: 'raster-light',
        layout: { visibility: 'none' } },
      { id: 'raster-sat', type: 'raster', source: 'raster-sat',
        layout: { visibility: 'none' } },
      { id: 'raster-terrain', type: 'raster', source: 'raster-terrain',
        layout: { visibility: 'none' } },
      { id: 'world-land-fill', type: 'fill', source: 'world',
        layout: { visibility: 'none' },
        paint: { 'fill-color': '#14171c' } },
      { id: 'world-land-line', type: 'line', source: 'world',
        layout: { visibility: 'none' },
        paint: { 'line-color': 'rgba(255,255,255,.14)', 'line-width': 0.6 } },
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
  EC2.mapReady = new Promise(res => EC2.map.on('load', () => {
    if (!EC2.map.hasImage('drone-triangle')) EC2.map.addImage('drone-triangle', droneIconImage());
    EC2.mapLoaded = true;
    startPingDriver();
    // Orbital declutter (Task 10.5): subscribe once, then immediately apply
    // the current scene so boot (scene === 'globe') hides operational
    // layers before the first paint, rather than waiting for a scene fire.
    EC2.onSceneChange(scene => EC2.setOperationalLayersVisible(scene === 'console'));
    EC2.setOperationalLayersVisible(EC2.state.scene === 'console');
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
    for (const k of ['dark','light','sat','terrain'])
      EC2.map.setLayoutProperty('raster-'+k, 'visibility',
        (!on && k===EC2.state.layer) ? 'visible' : 'none');
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

EC2.setLayer = function(name){
  EC2.state.layer = name;
  document.documentElement.dataset.maplayer = name; // lets CSS adapt chips on light
  if (EC2.state.offline) return; // rasters stay hidden until connectivity returns
  for (const k of ['dark','light','sat','terrain'])
    EC2.map.setLayoutProperty('raster-'+k, 'visibility', k===name?'visible':'none');
};
})();
