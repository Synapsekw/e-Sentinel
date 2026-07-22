(function(){
const ORBIT = { center: [54.6, 24.3], zoom: 1.35 };
const THEATER = { center: [54.35, 24.5], zoom: 6.6 };
const BEACON = [54.4, 24.3];
const DIVE_MS = 2600;
const DIVE_CURVE = 1.6;
const IDLE_RESUME_MS = 2500;
const ROTATE_DEG_PER_SEC = 1.2; // ~0.02deg/frame @ 60fps, slow drift
const TAG_HIT_PX = 60;

// EC2.onSceneChange(cb) subscribes; EC2.onSceneChange.fire() notifies all
// listeners with the current scene. Verbatim shape from the task brief.
EC2.onSceneChange = (function(){
  const subs = [];
  const f = cb => subs.push(cb);
  f.fire = () => subs.forEach(cb => cb(EC2.state.scene));
  return f;
})();

let dragging = false;
let resumeAt = 0;
let diving = false;      // true while either flyTo (in or out) is in flight
let diveDir = null;      // 'in' | 'out' | null
let lastTs = null;
let overlayEl, tagEl, altEl;

function altKmFromZoom(zoom){
  const z0 = ORBIT.zoom, z1 = THEATER.zoom, a0 = 12742, a1 = 2;
  const t = Math.min(1, Math.max(0, (zoom - z0) / (z1 - z0)));
  const logA0 = Math.log(a0), logA1 = Math.log(a1);
  return Math.exp(logA0 + (logA1 - logA0) * t);
}

function fmtAlt(km){
  return km >= 100 ? Math.round(km).toString() : km.toFixed(1);
}

function updateAltReadout(){
  if(!altEl) return;
  const km = altKmFromZoom(EC2.map.getZoom());
  const label = diving ? (diveDir === 'in' ? 'DESCENDING' : 'ASCENDING') : 'ORBITAL';
  altEl.textContent = 'ALT ' + fmtAlt(km) + ' KM · ' + label;
}

function animateBeaconPing(ts){
  if(!EC2.map.getLayer('beacon-ping')) return;
  const period = 1800;
  const phase = (ts % period) / period;
  EC2.map.setPaintProperty('beacon-ping', 'circle-radius', 6 + phase * 22);
  EC2.map.setPaintProperty('beacon-ping', 'circle-stroke-opacity', (1 - phase) * 0.7);
}

function beaconVisible(){
  const screen = EC2.map.project(BEACON);
  const canvas = EC2.map.getCanvas();
  if(screen.x < 0 || screen.y < 0 || screen.x > canvas.clientWidth || screen.y > canvas.clientHeight) return { visible:false, screen };
  const back = EC2.map.unproject(screen);
  const dist = Math.hypot(back.lng - BEACON[0], back.lat - BEACON[1]);
  return { visible: dist <= 1, screen };
}

function updateBeaconTag(){
  if(!tagEl) return;
  const { visible, screen } = beaconVisible();
  if(visible && !diving){
    tagEl.hidden = false;
    tagEl.style.left = Math.round(screen.x + 16) + 'px';
    tagEl.style.top = Math.round(screen.y) + 'px';
  } else {
    tagEl.hidden = true;
  }
}

function tick(ts){
  if(lastTs == null) lastTs = ts;
  const dt = (ts - lastTs) / 1000;
  lastTs = ts;

  if(EC2.state.scene === 'globe'){
    if(!diving && !dragging && performance.now() >= resumeAt){
      const c = EC2.map.getCenter();
      EC2.map.setCenter([c.lng - ROTATE_DEG_PER_SEC * dt, c.lat]);
    }
    animateBeaconPing(ts);
    updateBeaconTag();
  }
  if(diving) updateAltReadout();

  requestAnimationFrame(tick);
}

function addBeaconLayers(){
  EC2.map.addSource('beacon', {
    type: 'geojson',
    data: { type:'Feature', properties:{}, geometry:{ type:'Point', coordinates: BEACON } }
  });
  EC2.map.addLayer({
    id: 'beacon-ping', type: 'circle', source: 'beacon',
    paint: {
      'circle-radius': 6,
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': '#ff5a5a',
      'circle-stroke-width': 1.5,
      'circle-stroke-opacity': 0.7
    }
  });
  EC2.map.addLayer({
    id: 'beacon-dot', type: 'circle', source: 'beacon',
    paint: {
      'circle-radius': 3.5,
      'circle-color': '#ff5a5a',
      'circle-stroke-color': '#0a0b0e',
      'circle-stroke-width': 1
    }
  });
}

function wirePointerPause(){
  const canvas = EC2.map.getCanvas();
  canvas.addEventListener('pointerdown', () => { dragging = true; resumeAt = 0; });
  window.addEventListener('pointerup', () => {
    if(!dragging) return;
    dragging = false;
    resumeAt = performance.now() + IDLE_RESUME_MS;
  });
}

function wireClicks(){
  tagEl.addEventListener('click', () => EC2.enterTheater());
  EC2.map.on('click', (e) => {
    if(EC2.state.scene !== 'globe' || diving) return;
    const screen = EC2.map.project(BEACON);
    if(Math.hypot(e.point.x - screen.x, e.point.y - screen.y) <= TAG_HIT_PX) EC2.enterTheater();
  });
}

EC2.enterTheater = function(){
  if(EC2.state.scene !== 'globe' || diving) return;
  diving = true; diveDir = 'in';
  tagEl.hidden = true;
  EC2.map.flyTo({ center: THEATER.center, zoom: THEATER.zoom, duration: DIVE_MS, curve: DIVE_CURVE });
  EC2.map.once('moveend', function(){
    diving = false; diveDir = null;
    EC2.state.scene = 'console';
    overlayEl.hidden = true;
    EC2.onSceneChange.fire();
  });
};

EC2.exitToOrbit = function(){
  if(EC2.state.scene !== 'console' || diving) return;
  diving = true; diveDir = 'out';
  resumeAt = 0; // stay paused for the duration of the return flight
  EC2.map.flyTo({ center: ORBIT.center, zoom: ORBIT.zoom, duration: DIVE_MS, curve: DIVE_CURVE });
  EC2.map.once('moveend', function(){
    diving = false; diveDir = null;
    EC2.state.scene = 'globe';
    overlayEl.hidden = false;
    EC2.onSceneChange.fire();
    resumeAt = performance.now() + IDLE_RESUME_MS;
    updateAltReadout();
  });
};

EC2.initGlobe = function(){
  overlayEl = document.getElementById('globe-ui');
  tagEl = document.getElementById('uae-beacon-tag');
  altEl = document.getElementById('g-alt');

  EC2.map.jumpTo(ORBIT);
  addBeaconLayers();
  wirePointerPause();
  wireClicks();
  resumeAt = performance.now() + IDLE_RESUME_MS;
  requestAnimationFrame(tick);
};
})();
