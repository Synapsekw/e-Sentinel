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
  _followWasAuto: false,
  wizard: null,
  // Mission ids launched by the operator via this wizard (Task 13's debrief
  // flow auto-opens only for these; scheduler-spawned auto missions still
  // land in the MEDIA library but don't steal the panel on completion).
  userMissions: new Set()
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

// Top bar '+ NEW MISSION' button (Task 12) is only usable from 'normal' —
// engaging the wizard while manual control is active is blocked outright
// (rather than auto-releasing manual), so the button goes disabled with an
// explanatory title the moment either capture mode takes the map.
function updateNewMissionButtonState(){
  const btn = $('btn-newmission');
  if (!btn) return;
  if (control.mode === 'manual'){
    btn.disabled = true;
    btn.title = 'UNAVAILABLE DURING MANUAL CONTROL';
  } else if (control.mode === 'wizard'){
    btn.disabled = true;
    btn.title = 'MISSION WIZARD ACTIVE';
  } else {
    btn.disabled = false;
    btn.title = 'CREATE A NEW MISSION';
  }
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
  if (control.mode === 'wizard') return false; // one capture mode at a time

  const ok = window.__engine.setManual(droneId, true);
  if (!ok) return false;

  control.mode = 'manual';
  control.activeId = droneId;
  showBanner(droneId);
  setCursor('crosshair');
  updateNewMissionButtonState();

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
  updateNewMissionButtonState();
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

// ---------- mission wizard (Task 12) ----------
//
// control.wizard = { step, type, dockId, points, spacingM, altM, speedMs, error }
// step 1 picks type + launch dock; step 2 captures the route on the map
// (numbered waypoint clicks for corridor/atob/perimeter types, two corner
// clicks + a spacing slider for lawnmower types); step 3 sets altitude/speed
// and launches via engine.createMission. Only one capture mode is ever
// active — entering the wizard while manual control holds the map is
// blocked (see enterManual/control.mode==='wizard' guard above); the map's
// own click routing (below) hands clicks to the wizard while control.mode
// === 'wizard' the same way it hands them to manual control.

const WIZARD_GLYPHS = {
  security: '◎',     // target ring — perimeter patrol
  infra: '▦',        // hatched square — corridor inspection
  emergency: '✚',    // plus — first response
  delivery: '➤',     // arrow — point to point
  construction: '▩',  // filled-edge square — survey area
  highway: '═',      // double line — corridor
  parks: '❀'         // florette — vegetation
};

function isLawnmowerType(type){
  const cfg = MISSIONS_CONFIG[type];
  return !!cfg && cfg.pattern === 'lawnmower';
}

function emptyWizardFC(){ return emptyFC(); }

// Box corners -> {center,widthKm,heightKm}, min 0.3km sides so a near-zero
// drag can never reach engine.createMission as a degenerate route.
function wizardBox(w){
  if (!w.points || w.points.length < 2) return null;
  const [c1, c2] = w.points;
  const centerLat = (c1[1] + c2[1]) / 2;
  const center = [(c1[0] + c2[0]) / 2, centerLat];
  const widthKm = Math.max(0.3, Math.abs(c2[0] - c1[0]) * 111.32 * Math.cos(centerLat * Math.PI / 180));
  const heightKm = Math.max(0.3, Math.abs(c2[1] - c1[1]) * 110.57);
  return { center, widthKm, heightKm };
}

function wizardLawnmowerPath(w){
  const box = wizardBox(w);
  if (!box || typeof SimRouter === 'undefined') return null;
  return SimRouter.lawnmower(box.center, box.widthKm, box.heightKm, w.spacingM || 150, 0);
}

// The exact coordinate list that would be handed to engine.createMission —
// the clicked line for waypoint types, the generated serpentine for lawnmower.
function wizardFinalWaypoints(w){
  if (isLawnmowerType(w.type)) return wizardLawnmowerPath(w);
  return w.points.slice();
}

function wizardStep2Valid(w){
  if (isLawnmowerType(w.type)) return w.points.length === 2;
  return w.points.length >= 2;
}

function wizardDistanceKm(w){
  if (typeof SimRouter === 'undefined') return 0;
  if (isLawnmowerType(w.type)){
    if (w.points.length < 2) return 0;
    const path = wizardLawnmowerPath(w);
    return path ? SimRouter.pathLengthKm(path) : 0;
  }
  if (w.points.length < 2) return 0;
  return SimRouter.pathLengthKm(w.points);
}

function wizardDurationLabel(distKm, speedMs){
  if (!distKm || !speedMs) return '--';
  const mins = (distKm * 1000) / speedMs / 60;
  return mins < 1 ? '<1 MIN' : Math.round(mins) + ' MIN';
}

function wizardPreviewFeatures(){
  const w = control.wizard;
  if (!w) return emptyWizardFC();
  const features = [];
  if (isLawnmowerType(w.type)){
    w.points.forEach((p, i) => features.push({
      type: 'Feature', properties: { n: i + 1 }, geometry: { type: 'Point', coordinates: p }
    }));
    if (w.points.length === 2){
      const path = wizardLawnmowerPath(w);
      if (path && path.length >= 2){
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: path } });
      }
    }
  } else {
    w.points.forEach((p, i) => features.push({
      type: 'Feature', properties: { n: i + 1 }, geometry: { type: 'Point', coordinates: p }
    }));
    if (w.points.length >= 2){
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: w.points } });
    }
  }
  return { type: 'FeatureCollection', features };
}

function refreshWizardPreview(){
  if (!EC2.map || !EC2.mapLoaded) return;
  const src = EC2.map.getSource('wizard-preview');
  if (src) src.setData(wizardPreviewFeatures());
}

function clearWizardPreview(){
  if (!EC2.map || !EC2.mapLoaded) return;
  const src = EC2.map.getSource('wizard-preview');
  if (src) src.setData(emptyWizardFC());
}

// Ready docks (drone actually docked there), nearest-to-map-center first —
// used both for step 1's nearest-preselect and its dropdown ordering.
function wizardReadyDocks(){
  if (!window.__engine) return [];
  const list = [];
  for (const dock of window.__engine.docks.values()){
    if (dock.state === 'ready' && dock.drone && dock.drone.state === 'docked') list.push(dock);
  }
  if (EC2.map && typeof SimRouter !== 'undefined'){
    const c = EC2.map.getCenter();
    const center = [c.lng, c.lat];
    list.sort((a, b) => SimRouter.distM(center, a.coords) - SimRouter.distM(center, b.coords));
  }
  return list;
}

function wizardNearestReadyDockId(){
  const docks = wizardReadyDocks();
  return docks.length ? docks[0].id : null;
}

// Re-renders the whole wizard panel from current state — used for discrete
// actions (tile pick, dock change, step transitions, undo, map clicks).
// Slider drags patch their own DOM nodes directly instead (see
// wireWizardPanel) so a continuous drag never fights a full re-render.
function renderWizard(){
  EC2.ui.setRightPanel('wizard', control.wizard);
}

function wizardTypeTiles(w){
  return Object.keys(MISSIONS_CONFIG).map(type => {
    const cfg = MISSIONS_CONFIG[type];
    const sel = w.type === type;
    return (
      '<button class="wz-tile' + (sel ? ' sel' : '') + '" data-type="' + type + '">' +
        '<span class="wz-glyph">' + (WIZARD_GLYPHS[type] || '●') + '</span>' +
        '<span class="wz-label">' + cfg.label + '</span>' +
      '</button>'
    );
  }).join('');
}

function renderWizardStep1(w){
  const docks = wizardReadyDocks();
  if (!docks.some(d => d.id === w.dockId)) w.dockId = docks.length ? docks[0].id : null;
  const options = docks.length
    ? docks.map(d => '<option value="' + d.id + '"' + (d.id === w.dockId ? ' selected' : '') + '>' +
        d.id + ' · ' + d.name + '</option>').join('')
    : '<option value="">NO READY DOCKS</option>';
  const canProceed = !!(w.type && w.dockId);
  return (
    '<div class="wz">' +
      '<div class="lbl">NEW MISSION &middot; STEP 1 OF 3 &middot; TYPE &amp; DOCK</div>' +
      '<div class="wz-tiles">' + wizardTypeTiles(w) + '</div>' +
      '<div class="wz-field">' +
        '<label class="lbl" for="wz-dock">LAUNCH DOCK</label>' +
        '<select id="wz-dock"' + (docks.length ? '' : ' disabled') + '>' + options + '</select>' +
      '</div>' +
      '<div class="rp-actions">' +
        '<button class="ghost" id="wz-cancel">CANCEL</button>' +
        '<button class="primary" id="wz-next"' + (canProceed ? '' : ' disabled') + '>NEXT</button>' +
      '</div>' +
    '</div>'
  );
}

function renderWizardStep2(w){
  const cfg = MISSIONS_CONFIG[w.type];
  const lawnmower = isLawnmowerType(w.type);
  const distKm = wizardDistanceKm(w);
  const durLabel = wizardDurationLabel(distKm, w.speedMs || cfg.defaults.speedMs);
  const countLabel = lawnmower ? 'CORNERS' : 'WAYPOINTS';
  const countVal = lawnmower ? w.points.length + ' / 2' : String(w.points.length);
  const hint = lawnmower
    ? 'CLICK TWO CORNERS ON THE MAP TO DEFINE THE SURVEY AREA'
    : 'CLICK THE MAP TO ADD WAYPOINTS &middot; MIN 2 REQUIRED';
  const spacingField = lawnmower ? (
    '<div class="wz-field">' +
      '<label class="lbl" for="wz-spacing">LINE SPACING &middot; <span id="wz-spacing-val">' + (w.spacingM || 150) + ' M</span></label>' +
      '<input type="range" id="wz-spacing" min="100" max="300" step="10" value="' + (w.spacingM || 150) + '">' +
    '</div>'
  ) : '';
  return (
    '<div class="wz">' +
      '<div class="lbl">NEW MISSION &middot; STEP 2 OF 3 &middot; ROUTE</div>' +
      '<div class="wz-type-hdr">' + cfg.label + ' &middot; ' + w.dockId + '</div>' +
      '<p class="wz-hint">' + hint + '</p>' +
      spacingField +
      '<div class="stats wz-stats">' +
        '<div class="st"><div class="n" id="wz-count">' + countVal + '</div><div class="c">' + countLabel + '</div></div>' +
        '<div class="st"><div class="n" id="wz-dist">' + (distKm ? distKm.toFixed(1) + ' KM' : '--') + '</div><div class="c">Distance</div></div>' +
        '<div class="st"><div class="n" id="wz-dur">' + durLabel + '</div><div class="c">Duration est</div></div>' +
      '</div>' +
      '<div class="rp-actions">' +
        '<button class="ghost" id="wz-undo"' + (w.points.length ? '' : ' disabled') + '>UNDO LAST POINT</button>' +
      '</div>' +
      '<div class="rp-actions">' +
        '<button class="ghost" id="wz-back">BACK</button>' +
        '<button class="ghost" id="wz-cancel">CANCEL</button>' +
        '<button class="primary" id="wz-next"' + (wizardStep2Valid(w) ? '' : ' disabled') + '>NEXT</button>' +
      '</div>' +
    '</div>'
  );
}

function renderWizardStep3(w){
  const cfg = MISSIONS_CONFIG[w.type];
  const lawnmower = isLawnmowerType(w.type);
  const distKm = wizardDistanceKm(w);
  const durLabel = wizardDurationLabel(distKm, w.speedMs);
  const routeSummary = lawnmower ? '2 CORNERS (BOX)' : w.points.length + ' WAYPOINTS';
  return (
    '<div class="wz">' +
      '<div class="lbl">NEW MISSION &middot; STEP 3 OF 3 &middot; PARAMETERS</div>' +
      '<div class="wz-type-hdr">' + cfg.label + ' &middot; ' + w.dockId + '</div>' +
      '<div class="wz-field">' +
        '<label class="lbl" for="wz-alt">ALTITUDE &middot; <span id="wz-alt-val">' + w.altM + ' M</span></label>' +
        '<input type="range" id="wz-alt" min="40" max="120" step="5" value="' + w.altM + '">' +
      '</div>' +
      '<div class="wz-field">' +
        '<label class="lbl" for="wz-speed">SPEED &middot; <span id="wz-speed-val">' + w.speedMs + ' M/S</span></label>' +
        '<input type="range" id="wz-speed" min="5" max="21" step="1" value="' + w.speedMs + '">' +
      '</div>' +
      '<div class="wz-summary">' +
        '<div class="rp-kv"><span class="k">Type</span><span class="v">' + cfg.label + '</span></div>' +
        '<div class="rp-kv"><span class="k">Dock</span><span class="v">' + w.dockId + '</span></div>' +
        '<div class="rp-kv"><span class="k">Route</span><span class="v">' + routeSummary + '</span></div>' +
        '<div class="rp-kv"><span class="k">Distance</span><span class="v">' + distKm.toFixed(1) + ' KM</span></div>' +
        '<div class="rp-kv"><span class="k">Duration est</span><span class="v" id="wz-sum-dur">' + durLabel + '</span></div>' +
      '</div>' +
      (w.error ? '<div class="wz-error">' + w.error + '</div>' : '') +
      '<div class="rp-actions">' +
        '<button class="ghost" id="wz-back">BACK</button>' +
        '<button class="ghost" id="wz-cancel">CANCEL</button>' +
        '<button class="primary" id="wz-launch">LAUNCH</button>' +
      '</div>' +
    '</div>'
  );
}

function renderWizardPanel(w){
  if (!w) return '';
  if (w.step === 2) return renderWizardStep2(w);
  if (w.step === 3) return renderWizardStep3(w);
  return renderWizardStep1(w);
}
EC2.ui.panelRenderers.wizard = renderWizardPanel;

function handleWizardLaunch(){
  const w = control.wizard;
  if (!w || !window.__engine) return;
  const waypoints = wizardFinalWaypoints(w);
  let mission;
  try {
    mission = window.__engine.createMission({
      type: w.type,
      dockId: w.dockId,
      waypoints: waypoints,
      params: { altM: w.altM, speedMs: w.speedMs }
    });
  } catch (err) {
    w.error = (err && err.message) || String(err);
    if (EC2.ui && EC2.ui.pushEvent){
      EC2.ui.pushEvent({ level: 'warn', source: w.dockId, message: 'MISSION LAUNCH FAILED · ' + w.error });
    }
    renderWizard();
    return;
  }
  control.userMissions.add(mission.id);
  const droneId = 'D-' + w.dockId;
  cleanupWizardUI();
  EC2.followDroneId = droneId;
  EC2.select({ type: 'drone', id: droneId });
}

// Shared UI teardown — mode/preview/cursor/button state. Does not touch the
// right panel; callers decide what (if anything) to show next (see
// exitWizard vs. the launch-success path in handleWizardLaunch above).
function cleanupWizardUI(){
  control.mode = 'normal';
  control.wizard = null;
  setCursor('');
  clearWizardPreview();
  updateNewMissionButtonState();
}

// Engages the wizard. Blocked while manual control holds the map (button is
// already disabled in that case; this is the defensive second guard).
// prefillDockId preselects but never locks the step 1 dock dropdown.
control.enterWizard = function(prefillDockId){
  if (!window.__engine || control.mode === 'manual') return false;
  if (control.mode === 'wizard') return true;

  control.mode = 'wizard';
  control.wizard = {
    step: 1,
    type: null,
    dockId: prefillDockId || wizardNearestReadyDockId(),
    points: [],
    spacingM: 150,
    altM: null,
    speedMs: null,
    error: null
  };
  updateNewMissionButtonState();
  renderWizard();
  return true;
};

// CANCEL button / ESC key / GLOBE exit — cleans up then clears the panel.
control.exitWizard = function(){
  if (control.mode !== 'wizard') return;
  cleanupWizardUI();
  EC2.state.selection = null;
  EC2.ui.setRightPanel('empty');
};

function handleWizardMapClick(lonlat){
  const w = control.wizard;
  if (!w || w.step !== 2) return;
  if (isLawnmowerType(w.type)){
    if (w.points.length >= 2) w.points = [];
    w.points.push(lonlat);
  } else {
    w.points.push(lonlat);
  }
  refreshWizardPreview();
  renderWizard();
}

// Wires the just-rendered wizard panel's controls. Discrete actions (tile
// pick, dock change, undo, step transitions) go through renderWizard() for
// a full re-render; slider drags (spacing/altitude/speed) patch their own
// text nodes on 'input' instead so a continuous drag is never interrupted
// by the panel being torn down and rebuilt underneath the pointer.
control.wireWizardPanel = function(w){
  if (!w) return;
  const cancelBtn = $('wz-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', () => control.exitWizard());

  if (w.step === 1){
    document.querySelectorAll('.wz-tile').forEach(btn => {
      btn.addEventListener('click', () => {
        const newType = btn.dataset.type;
        if (newType !== w.type) {
          w.altM = null;
          w.speedMs = null;
        }
        w.type = newType;
        renderWizard();
      });
    });
    const dockSel = $('wz-dock');
    if (dockSel) dockSel.addEventListener('change', () => {
      w.dockId = dockSel.value || null;
      renderWizard();
    });
    const nextBtn = $('wz-next');
    if (nextBtn) nextBtn.addEventListener('click', () => {
      if (!w.type || !w.dockId) return;
      w.step = 2;
      w.points = [];
      w.error = null;
      setCursor('crosshair');
      renderWizard();
    });
  } else if (w.step === 2){
    const backBtn = $('wz-back');
    if (backBtn) backBtn.addEventListener('click', () => {
      w.step = 1;
      w.points = [];
      setCursor('');
      clearWizardPreview();
      renderWizard();
    });
    const undoBtn = $('wz-undo');
    if (undoBtn) undoBtn.addEventListener('click', () => {
      w.points.pop();
      refreshWizardPreview();
      renderWizard();
    });
    const spacing = $('wz-spacing');
    if (spacing) spacing.addEventListener('input', () => {
      w.spacingM = Number(spacing.value);
      const valEl = $('wz-spacing-val'); if (valEl) valEl.textContent = w.spacingM + ' M';
      refreshWizardPreview();
      const cfg = MISSIONS_CONFIG[w.type];
      const distKm = wizardDistanceKm(w);
      const distEl = $('wz-dist'); if (distEl) distEl.textContent = distKm ? distKm.toFixed(1) + ' KM' : '--';
      const durEl = $('wz-dur'); if (durEl) durEl.textContent = wizardDurationLabel(distKm, w.speedMs || cfg.defaults.speedMs);
    });
    const nextBtn = $('wz-next');
    if (nextBtn) nextBtn.addEventListener('click', () => {
      if (!wizardStep2Valid(w)) return;
      const cfg = MISSIONS_CONFIG[w.type];
      w.step = 3;
      if (w.altM == null) w.altM = cfg.defaults.altM;
      if (w.speedMs == null) w.speedMs = cfg.defaults.speedMs;
      setCursor('');
      renderWizard();
    });
  } else if (w.step === 3){
    const backBtn = $('wz-back');
    if (backBtn) backBtn.addEventListener('click', () => {
      w.step = 2;
      w.error = null;
      setCursor('crosshair');
      renderWizard();
    });
    const altSlider = $('wz-alt');
    if (altSlider) altSlider.addEventListener('input', () => {
      w.altM = Number(altSlider.value);
      const el = $('wz-alt-val'); if (el) el.textContent = w.altM + ' M';
    });
    const spdSlider = $('wz-speed');
    if (spdSlider) spdSlider.addEventListener('input', () => {
      w.speedMs = Number(spdSlider.value);
      const el = $('wz-speed-val'); if (el) el.textContent = w.speedMs + ' M/S';
      const distKm = wizardDistanceKm(w);
      const durEl = $('wz-sum-dur'); if (durEl) durEl.textContent = wizardDurationLabel(distKm, w.speedMs);
    });
    const launchBtn = $('wz-launch');
    if (launchBtn) launchBtn.addEventListener('click', handleWizardLaunch);
  }
};

// ---------- map click routing ----------

function wireMapClicks(){
  if (!EC2.map) return;
  EC2.map.on('click', (e) => {
    const lonlat = [e.lngLat.lng, e.lngLat.lat];
    if (control.mode === 'wizard'){
      handleWizardMapClick(lonlat);
      return;
    }
    if (control.mode !== 'manual' || !control.activeId || !window.__engine) return;
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
    if (e.key !== 'Escape') return;
    if (control.mode === 'manual') control.exitManual();
    else if (control.mode === 'wizard') control.exitWizard();
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
  updateNewMissionButtonState();
};
})();
