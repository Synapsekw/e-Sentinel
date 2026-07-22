(function(){
'use strict';

// Manual control (Task 11) — owns map-click interaction exclusively while
// engaged, so a click routes to click-to-go instead of the normal
// dock/drone/site selection handlers in panels.js. EC2.control.mode is the
// single source of truth other modules consult ('normal' | 'manual', with
// a 'wizard' mode reserved for Task 12's mission wizard).
const control = {
  mode: 'normal',
  activeId: null,
  _followWasAuto: false
};
EC2.control = control;

function $(id){ return document.getElementById(id); }
function emptyFC(){ return { type: 'FeatureCollection', features: [] }; }

// ---------- banner chip ----------

let bannerEl = null;

function ensureBanner(){
  if (bannerEl) return bannerEl;
  bannerEl = document.createElement('div');
  bannerEl.id = 'manual-banner';
  bannerEl.className = 'manual-banner';
  bannerEl.hidden = true;
  document.body.appendChild(bannerEl);
  return bannerEl;
}

function showBanner(droneId){
  const el = ensureBanner();
  el.textContent = 'MANUAL CONTROL · ' + droneId + ' · CLICK TO FLY · SHIFT+CLICK TO QUEUE';
  el.hidden = false;
}

function hideBanner(){
  if (bannerEl) bannerEl.hidden = true;
}

function setCursor(css){
  if (EC2.map) EC2.map.getCanvas().style.cursor = css;
}

// ---------- waypoint queue layer ----------

function waypointFeatures(){
  if (!window.__engine || !control.activeId) return emptyFC();
  const drone = window.__engine.drones.get(control.activeId);
  const queue = (drone && drone._manualQueue) || [];
  return {
    type: 'FeatureCollection',
    features: queue.map((p, i) => ({
      type: 'Feature',
      properties: { n: i + 1 },
      geometry: { type: 'Point', coordinates: p }
    }))
  };
}

function refreshWaypoints(){
  if (!EC2.map || !EC2.mapLoaded) return;
  const src = EC2.map.getSource('manual-wpts');
  if (src) src.setData(waypointFeatures());
}

function clearWaypointLayer(){
  if (!EC2.map || !EC2.mapLoaded) return;
  const src = EC2.map.getSource('manual-wpts');
  if (src) src.setData(emptyFC());
}

// Queue mutates on every engine tick as the drone arrives at waypoints, not
// just on click — poll while engaged so the numbered markers drop off as
// they're visited.
let wpPoll = null;
function startWpPoll(){
  stopWpPoll();
  wpPoll = setInterval(refreshWaypoints, 300);
}
function stopWpPoll(){
  if (wpPoll){ clearInterval(wpPoll); wpPoll = null; }
}

// ---------- mode transitions ----------

// Engages manual control for droneId. Enables crosshair cursor + banner,
// auto-enables FOLLOW (remembering whether that was this call's doing, so
// release only turns FOLLOW back off if it was this call that turned it on).
control.enterManual = function(droneId){
  if (!window.__engine) return false;
  if (control.mode === 'manual' && control.activeId === droneId) return true;
  if (control.mode === 'manual') control.exitManual();

  const ok = window.__engine.setManual(droneId, true);
  if (!ok) return false;

  control.mode = 'manual';
  control.activeId = droneId;
  showBanner(droneId);
  setCursor('crosshair');

  if (EC2.followDroneId !== droneId){
    EC2.followDroneId = droneId;
    control._followWasAuto = true;
    if (EC2.map){
      const d = window.__engine.drones.get(droneId);
      if (d) EC2.map.easeTo({ center: d.pos, zoom: 12.5, duration: 600 });
    }
  } else {
    control._followWasAuto = false;
  }

  refreshWaypoints();
  startWpPoll();
  return true;
};

// Shared UI teardown — banner, cursor, waypoint layer, follow auto-toggle.
// Does NOT touch engine state; callers decide whether the engine side also
// needs releasing.
function cleanupUI(){
  control.mode = 'normal';
  control.activeId = null;
  hideBanner();
  setCursor('');
  stopWpPoll();
  clearWaypointLayer();
  if (control._followWasAuto) EC2.followDroneId = null;
  control._followWasAuto = false;
}

// Explicit release path: RELEASE button, ESC key, selecting another entity,
// or GLOBE exit. Tells the engine to hand the drone back (if it's still in
// manual state there) then tears down the UI overlay.
control.exitManual = function(){
  if (control.mode !== 'manual') return;
  const droneId = control.activeId;
  if (window.__engine){
    const drone = window.__engine.drones.get(droneId);
    if (drone && drone.state === 'manual') window.__engine.setManual(droneId, false);
  }
  cleanupUI();
};

// ---------- map click routing ----------

function wireMapClicks(){
  if (!EC2.map) return;
  EC2.map.on('click', (e) => {
    if (control.mode !== 'manual' || !control.activeId || !window.__engine) return;
    const lonlat = [e.lngLat.lng, e.lngLat.lat];
    if (e.originalEvent && e.originalEvent.shiftKey){
      window.__engine.manualQueue(control.activeId, lonlat);
    } else {
      window.__engine.manualGoto(control.activeId, lonlat);
    }
    refreshWaypoints();
  });
}

function wireKeys(){
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && control.mode === 'manual') control.exitManual();
  });
}

// A forced release (battery floor) happens entirely inside the engine tick —
// catch it here via the event feed so the banner/cursor/layer clear even if
// no panel poll happens to be running at that moment. Guarded against firing
// twice with exitManual()'s own cleanup: both converge on the same
// idempotent cleanupUI().
function wireEngineWatch(){
  const trySubscribe = () => {
    if (!window.__engine) return false;
    window.__engine.onEvent((ev) => {
      if (control.mode !== 'manual' || ev.source !== control.activeId) return;
      if (/RELEASED/.test(ev.message)) cleanupUI();
    });
    return true;
  };
  if (trySubscribe()) return;
  const iv = setInterval(() => { if (trySubscribe()) clearInterval(iv); }, 300);
}

EC2.initControl = function(){
  wireMapClicks();
  wireKeys();
  wireEngineWatch();
};
})();
