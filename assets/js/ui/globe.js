(function(){
const ORBIT = { center: [54.6, 24.3], zoom: 1.35 }; // zoom recomputed per-viewport by fitOrbitZoom()
const THEATER = { center: [54.35, 24.5], zoom: 6.6 };
const BEACON = [54.4, 24.3];
const DIVE_MS = 2600;
const DIVE_CURVE = 1.6;
const IDLE_RESUME_MS = 2500;
const ROTATE_DEG_PER_SEC = 1.2;   // minimum approach speed, keeps the old ambient feel near target
const APPROACH_GAIN = 0.4;        // deg/s of approach speed per degree of remaining offset
const APPROACH_MAX_DEG_PER_SEC = 9;
const SETTLE_EPS_DEG = 0.05;      // within this of the beacon meridian we hard-stop
const INTRO_LNG_OFFSET = 80;      // boot with UAE 80deg east of center so the opening shot rotates it in
const GLOBE_FIT_FRACTION = 0.80;  // globe disc diameter as a fraction of the short viewport side
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
let lastSizeCheckTs = 0;
let orbitFitDirty = false; // viewport changed while we were away from the globe scene
let overlayEl, tagEl, altEl, enterBtn;

function shortestLngDelta(toLng, fromLng){
  let d = (toLng - fromLng) % 360;
  if(d > 180) d -= 360;
  if(d < -180) d += 360;
  return d;
}

// ---- viewport-fitted orbit zoom -------------------------------------------
// Root cause of the off-center/squashed globe: MapLibre's canvas can be stuck
// at its 400x300 fallback size (container unsized at construction / missed
// ResizeObserver tick), so the sphere renders inside a small top-left canvas
// with dead space around it. EC2.map.resize() re-syncs canvas to container.
// Separately, a fixed ORBIT.zoom gives a different disc size on every
// viewport, so the orbit zoom is computed per-viewport: the projected limb
// radius is measured through map.project() and the zoom corrected until the
// disc diameter is GLOBE_FIT_FRACTION of the short viewport side. Measurement
// (not a closed formula) because the perspective camera means apparent radius
// does not scale exactly as 2^zoom.
function measureGlobeRadiusPx(){
  const c = EC2.map.getCenter();
  const ctr = EC2.map.project([c.lng, c.lat]);
  if(!isFinite(ctr.x) || !isFinite(ctr.y)) return 0;
  let maxD = 0;
  for(let a = 50; a <= 130; a += 2){
    const p = EC2.map.project([c.lng + a, c.lat]);
    const d = Math.hypot(p.x - ctr.x, p.y - ctr.y);
    if(isFinite(d) && d > maxD) maxD = d;
  }
  return maxD;
}

function fitOrbitZoom(){
  const cont = EC2.map.getContainer();
  const w = cont.clientWidth || window.innerWidth || 1280;
  const h = cont.clientHeight || window.innerHeight || 800;
  const targetR = GLOBE_FIT_FRACTION * 0.5 * Math.min(w, h);
  const restoreZoom = EC2.map.getZoom();
  let z = ORBIT.zoom;
  for(let i = 0; i < 6; i++){
    EC2.map.setZoom(z);
    const r = measureGlobeRadiusPx();
    if(!(r > 0)) break;
    const err = Math.log2(targetR / r);
    z = Math.min(3.2, Math.max(0.2, z + err));
    if(Math.abs(err) < 0.01) break;
  }
  EC2.map.setZoom(restoreZoom);
  return z;
}

function onViewportResize(){
  EC2.map.resize(); // canvas may lag the container (see note above)
  if(EC2.state.scene === 'globe' && !diving){
    ORBIT.zoom = fitOrbitZoom();
    EC2.map.setZoom(ORBIT.zoom);
    orbitFitDirty = false;
  } else {
    orbitFitDirty = true; // re-fit on the way back to orbit
  }
}

// ---------------------------------------------------------------------------

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
  if(!isFinite(screen.x) || !isFinite(screen.y)) return { visible:false, screen };
  if(screen.x < 0 || screen.y < 0 || screen.x > canvas.clientWidth || screen.y > canvas.clientHeight) return { visible:false, screen };
  const back = EC2.map.unproject(screen);
  // Wrap-safe longitude distance: unproject can hand back an equivalent
  // longitude on another world copy (e.g. -305.6 for 54.4), which used to
  // fail the roundtrip test and suppress the tag even with the beacon
  // front-and-center.
  const dLng = Math.abs(shortestLngDelta(back.lng, BEACON[0]));
  const dist = Math.hypot(dLng, back.lat - BEACON[1]);
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

// One step of the homing rotation: carry the view toward the beacon meridian
// (shortest direction), ease down close to it, and hard-stop on arrival so
// the UAE settles front-and-center instead of drifting past. Also relaxes any
// user-dragged latitude back to the orbit latitude so the beacon cannot be
// left hiding near a pole. Exposed as EC2._globeRotateStep for tests/tools.
function rotateStep(dt){
  const c = EC2.map.getCenter();
  const dLng = shortestLngDelta(BEACON[0], c.lng);
  const dLat = ORBIT.center[1] - c.lat;
  if(Math.abs(dLng) <= SETTLE_EPS_DEG && Math.abs(dLat) <= SETTLE_EPS_DEG) return false; // settled
  const speed = Math.min(APPROACH_MAX_DEG_PER_SEC,
    Math.max(ROTATE_DEG_PER_SEC, Math.abs(dLng) * APPROACH_GAIN));
  const stepLng = Math.sign(dLng) * Math.min(Math.abs(dLng), speed * dt);
  const latSpeed = Math.min(APPROACH_MAX_DEG_PER_SEC,
    Math.max(ROTATE_DEG_PER_SEC, Math.abs(dLat) * APPROACH_GAIN));
  const stepLat = Math.sign(dLat) * Math.min(Math.abs(dLat), latSpeed * dt);
  EC2.map.setCenter([c.lng + stepLng, c.lat + stepLat]);
  return true;
}
EC2._globeRotateStep = rotateStep;

function tick(ts){
  if(lastTs == null) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.25); // clamp so a hidden tab can't snap-jump
  lastTs = ts;

  // Belt-and-suspenders canvas size check (cheap, ~2x/sec): recovers from any
  // missed ResizeObserver update that would leave the globe in a small
  // top-left canvas.
  if(ts - lastSizeCheckTs > 500){
    lastSizeCheckTs = ts;
    const cont = EC2.map.getContainer();
    const cv = EC2.map.getCanvas();
    if(cv.clientWidth !== cont.clientWidth || cv.clientHeight !== cont.clientHeight) onViewportResize();
  }

  if(EC2.state.scene === 'globe'){
    if(!diving && !dragging && performance.now() >= resumeAt){
      rotateStep(dt);
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

// Always-available entry point: the beacon tag depends on the rotation having
// settled with the UAE front-facing, so a persistent button guarantees the
// operator can enter the theater at any moment. Created from JS (same pattern
// as control.js's banner) and appended to the existing #globe-ui overlay.
function buildEnterButton(){
  enterBtn = document.createElement('button');
  enterBtn.id = 'globe-enter-btn';
  enterBtn.type = 'button';
  enterBtn.textContent = 'ENTER THEATER';
  // #globe-ui is pointer-events:none; make the button clickable even before
  // the stylesheet rule lands.
  enterBtn.style.pointerEvents = 'auto';
  enterBtn.addEventListener('click', () => EC2.enterTheater());
  overlayEl.appendChild(enterBtn);
}

EC2.enterTheater = function(){
  if(EC2.state.scene !== 'globe' || diving) return;
  diving = true; diveDir = 'in';
  tagEl.hidden = true;
  if(enterBtn) enterBtn.hidden = true;
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
  if(orbitFitDirty){ ORBIT.zoom = fitOrbitZoom(); orbitFitDirty = false; }
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

// The beacon is the orbital-view "you are here" marker; it is redundant
// once the operator is inside the console (theater) scene, so it hides
// there and returns whenever the globe scene is back.
function setBeaconVisible(visible){
  const vis = visible ? 'visible' : 'none';
  if (EC2.map.getLayer('beacon-ping')) EC2.map.setLayoutProperty('beacon-ping', 'visibility', vis);
  if (EC2.map.getLayer('beacon-dot')) EC2.map.setLayoutProperty('beacon-dot', 'visibility', vis);
}

EC2.initGlobe = function(){
  overlayEl = document.getElementById('globe-ui');
  tagEl = document.getElementById('uae-beacon-tag');
  altEl = document.getElementById('g-alt');
  buildEnterButton();

  // Sync the canvas to its container before any fit math (see onViewportResize).
  EC2.map.resize();
  ORBIT.zoom = fitOrbitZoom();
  // Boot with the center meridian east of the UAE: the opening shot rotates
  // westward (same direction as the old ambient drift) until the beacon
  // settles front-and-center (rotateStep).
  EC2.map.jumpTo({ center: [BEACON[0] + INTRO_LNG_OFFSET, ORBIT.center[1]], zoom: ORBIT.zoom });
  window.addEventListener('resize', onViewportResize);

  addBeaconLayers();
  wirePointerPause();
  wireClicks();
  resumeAt = performance.now() + IDLE_RESUME_MS;
  requestAnimationFrame(tick);

  // Subscribe once; honor initial state (scene is 'globe' at boot, so the
  // beacon starts visible, which is already the layer default above).
  EC2.onSceneChange(scene => {
    setBeaconVisible(scene !== 'console');
    if(enterBtn) enterBtn.hidden = scene !== 'globe';
  });
  setBeaconVisible(EC2.state.scene !== 'console');
};
})();
