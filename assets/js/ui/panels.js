(function(){
const EMIRATE_NAMES = {
  AUH:'Abu Dhabi', DXB:'Dubai', SHJ:'Sharjah', AJM:'Ajman',
  UAQ:'Umm Al Quwain', RAK:'Ras Al Khaimah', FUJ:'Fujairah', AAN:'Al Ain'
};

let dockIndex = null;
let siteIndex = null;
let currentFilter = 'ALL';

// 2 Hz live-refresh timer for the 'drone' right-panel mode. Tracked at
// module scope so every setRightPanel() call can clear the previous one
// before possibly starting a new one — the one leak this task explicitly
// calls out to avoid.
let droneTeleTimer = null;

// Completed missions this session (newest first, capped), backing the
// MEDIA grid. A mission lands here once via recordCompletedMission() when
// the engine emits its 'MISSION <id> COMPLETE' event.
let sessionMissions = [];
const SESSION_MISSIONS_CAP = 40;

// rAF handle for the debrief panel's animated video placeholder — tracked at
// module scope for the same reason as droneTeleTimer: setRightPanel() must
// be able to kill it unconditionally on every mode switch so it only ever
// animates while the debrief panel is actually visible.
let debriefAnimId = null;

const DRONE_STATE_LABELS = {
  takeoff: 'TAKEOFF', transit: 'TRANSIT', 'on-task': 'ON TASK',
  rtb: 'RETURN TO DOCK', landing: 'LANDING', hold: 'HELD', docked: 'DOCKED',
  manual: 'MANUAL CONTROL'
};

function $(id){ return document.getElementById(id); }

function buildDockIndex(){
  dockIndex = new Map();
  DATA_DOCKS.forEach(d => dockIndex.set(d.id, d));
}

function buildSiteIndex(){
  siteIndex = new Map();
  DATA_SITES.forEach(s => siteIndex.set(s.id, s));
}

// Deterministic per-dock hash so the same dock always shows the same
// battery reading across re-renders (no sim engine wired yet, Task 9).
function hashStr(s){
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Once the sim engine (Task 9) is running, battery/state are read live off
// it; the hash-based placeholder only covers the pre-dive-in globe scene
// (or the rare case the engine hasn't been created yet).
function batteryFor(id){
  if (window.__engine){
    const dock = window.__engine.docks.get(id);
    if (dock) return Math.round(dock.battery);
  }
  return 85 + (hashStr(id) % 15); // 85..99
}

// Returns the dock's real sim state ('ready'|'launching'|'drone-away'|
// 'landing'|'charging'|'fault'|'offline') once the engine exists, else
// 'ready' so filters/UI have a sane default before dive-in.
function stateFor(dock){
  if (window.__engine){
    const live = window.__engine.docks.get(dock.id);
    if (live) return live.state;
  }
  return 'ready';
}

const FLYING_STATES = ['launching', 'drone-away', 'landing'];
const ALERT_STATES = ['fault', 'offline'];

function nowClockStr(){
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

// ---------- right panel renderers ----------

function renderEmptyPanel(){
  return (
    '<div class="rp-empty">' +
      '<div class="lbl">National activity</div>' +
      '<p style="margin-top:10px">104 dock stations online across all 7 emirates. ' +
      'Select a dock from the list or the map to view its identity, drone status and dispatch options.</p>' +
      '<p style="margin-top:10px">Autonomous flight operations begin once the simulation engine lands in a later task.</p>' +
    '</div>'
  );
}

function renderDockPanel(dock){
  const battery = batteryFor(dock.id);
  const state = stateFor(dock);
  const emirate = EMIRATE_NAMES[dock.emirate] || dock.emirate;
  const launchDisabled = state !== 'ready';
  const launchTitle = launchDisabled ? 'DRONE NOT AVAILABLE AT THIS DOCK' : '';
  return (
    '<div class="rp-id">' + dock.id + '</div>' +
    '<div class="rp-name">' + dock.name + '</div>' +
    '<div class="rp-emirate">' + emirate + '</div>' +
    '<div class="rp-kv"><span class="k">Drone model</span><span class="v">' + dock.model + '</span></div>' +
    '<div class="rp-kv"><span class="k">Battery</span><span class="v">' + battery + '%</span></div>' +
    '<div class="batt-bar"><i style="width:' + battery + '%"></i></div>' +
    '<div class="state-chip">' + state.toUpperCase() + '</div>' +
    '<div class="rp-actions">' +
      '<button class="primary" id="rp-launch"' + (launchDisabled ? ' disabled' : '') +
        (launchTitle ? ' title="' + launchTitle + '"' : '') + '>LAUNCH MISSION</button>' +
      '<button class="ghost" id="rp-locate">LOCATE</button>' +
    '</div>'
  );
}

// ---------- site panel (Task 10.5, live tower sites) ----------

const SITE_STATUS_CHIP = {
  installed: { cls: '', text: 'INSTALLED · LIVE' },
  'not-installed': { cls: 'amber', text: 'NOT INSTALLED' },
  replace: { cls: 'red', text: 'NEEDS REPLACEMENT' }
};

function renderSitePanel(site){
  const chip = SITE_STATUS_CHIP[site.status] || SITE_STATUS_CHIP.installed;
  const [lon, lat] = site.coords;
  return (
    '<div class="rp-id">' + site.id + '</div>' +
    '<div class="rp-name">' + site.name + '</div>' +
    '<div class="rp-kv"><span class="k">Coordinates</span><span class="v">' + lat.toFixed(5) + ', ' + lon.toFixed(5) + '</span></div>' +
    '<div class="state-chip' + (chip.cls ? ' ' + chip.cls : '') + '">' + chip.text + '</div>' +
    '<div class="lbl" style="margin-top:14px">E&amp; TOWER SITE · LIVE NETWORK</div>'
  );
}

// ---------- drone panel (Task 10) ----------

function missionLineFor(drone){
  const stateLbl = DRONE_STATE_LABELS[drone.state] || String(drone.state).toUpperCase();
  const engine = window.__engine;
  const mission = drone.missionId && engine ? engine.missions.get(drone.missionId) : null;
  if (mission && typeof MISSIONS_CONFIG !== 'undefined' && MISSIONS_CONFIG[mission.type]){
    const label = MISSIONS_CONFIG[mission.type].label;
    const pct = Math.round((mission.progress || 0) * 100);
    return label + ' · ' + pct + '% · ' + stateLbl;
  }
  return stateLbl;
}

function battLevel(pct){
  return pct <= 25 ? 'red' : pct <= 49 ? 'amber' : 'ok';
}

function padHeading(deg){
  return String(Math.round(((deg % 360) + 360) % 360)).padStart(3, '0');
}

function teleCell(key, label, value, battLevelAttr){
  const attr = battLevelAttr ? ' data-batt-level="' + battLevelAttr + '"' : '';
  return (
    '<div class="tele-cell" data-tele="' + key + '"' + attr + '>' +
      '<span class="tk">' + label + '</span>' +
      '<span class="tv" id="tv-' + key + '">' + value + '</span>' +
    '</div>'
  );
}

function fpvFrameHTML(drone){
  return (
    '<div class="fpv-frame">' +
      '<span class="fpv-rec"><i></i>REC</span>' +
      '<span class="fpv-eo">EO 1X</span>' +
      '<div class="fpv-reticle"><span class="cross h"></span><span class="cross v"></span></div>' +
      '<span class="fpv-hdg" id="fpv-hdg">' + padHeading(drone.heading) + '&deg;</span>' +
      '<span class="fpv-alt" id="fpv-alt">' + Math.round(drone.alt) + 'M</span>' +
      '<span class="fpv-clock" id="fpv-clock">' + nowClockStr() + '</span>' +
      '<span class="fpv-foot">HIGGSFIELD &middot; GEN-4</span>' +
    '</div>'
  );
}

function renderDronePanel(drone){
  const engine = window.__engine;
  const dock = engine ? engine.docks.get(drone.dockId) : null;
  const battery = Math.round(drone.battery);
  const distKm = (dock && typeof SimRouter !== 'undefined') ? SimRouter.distM(drone.pos, dock.coords) / 1000 : 0;
  const following = EC2.followDroneId === drone.id;
  const rtbDisabled = !['transit', 'on-task', 'hold'].includes(drone.state);
  const isHeld = drone.state === 'hold';
  const holdDisabled = !isHeld && !['transit', 'on-task'].includes(drone.state);
  const isManual = drone.state === 'manual';
  const controlDisabled = !isManual && !['transit', 'on-task', 'hold'].includes(drone.state);

  return (
    '<div class="rp-id">' + drone.id + '</div>' +
    '<div class="rp-name">' + drone.model + ' &middot; HOME ' + drone.dockId + '</div>' +
    '<div class="rp-mission" id="rp-mission-line">' + missionLineFor(drone) + '</div>' +

    '<div class="tele-grid">' +
      teleCell('alt', 'ALT', Math.round(drone.alt) + ' M') +
      teleCell('spd', 'SPD', drone.speedMs.toFixed(1) + ' M/S') +
      teleCell('hdg', 'HDG', padHeading(drone.heading) + '&deg;') +
      teleCell('bat', 'BAT', battery + '%', battLevel(battery)) +
      teleCell('link', 'LINK', 'O3+ &middot; -62 DBM') +
      teleCell('dist', 'DIST HOME', distKm.toFixed(1) + ' KM') +
    '</div>' +

    fpvFrameHTML(drone) +

    '<div class="rp-actions">' +
      '<button class="ghost' + (following ? ' on' : '') + '" id="rp-follow">' + (following ? 'FOLLOWING' : 'FOLLOW') + '</button>' +
      '<button class="ghost' + (isManual ? ' on' : '') + '" id="rp-control"' + (controlDisabled ? ' disabled' : '') + '>' + (isManual ? 'RELEASE' : 'TAKE CONTROL') + '</button>' +
    '</div>' +
    '<div class="rp-actions rp-alt-row" id="rp-alt-row"' + (isManual ? '' : ' hidden') + '>' +
      '<button class="ghost" id="rp-alt-dn">ALT -10M</button>' +
      '<button class="ghost" id="rp-alt-up">ALT +10M</button>' +
    '</div>' +
    '<div class="rp-actions">' +
      '<button class="primary" id="rp-rtb"' + (rtbDisabled ? ' disabled' : '') + '>RETURN TO DOCK</button>' +
      '<button class="ghost" id="rp-hold"' + (holdDisabled ? ' disabled' : '') + '>' + (isHeld ? 'RESUME' : 'PAUSE') + '</button>' +
    '</div>'
  );
}

// Refreshes only the live text nodes inside the already-rendered drone
// panel (mission line, telemetry grid, FPV corner data, button labels) —
// deliberately does NOT touch body.innerHTML, so the FOLLOW/RTB/HOLD click
// listeners bound once in wireRightPanelActions stay attached for the life
// of this selection.
function updateDroneTelemetry(droneId){
  const engine = window.__engine;
  if (!engine) return;
  const drone = engine.drones.get(droneId);
  if (!drone) return;
  const dock = engine.docks.get(drone.dockId);

  const missionEl = $('rp-mission-line');
  if (missionEl) missionEl.textContent = missionLineFor(drone);

  const altEl = $('tv-alt'); if (altEl) altEl.textContent = Math.round(drone.alt) + ' M';
  const spdEl = $('tv-spd'); if (spdEl) spdEl.textContent = drone.speedMs.toFixed(1) + ' M/S';
  const hdgEl = $('tv-hdg'); if (hdgEl) hdgEl.textContent = padHeading(drone.heading) + '°';

  const battery = Math.round(drone.battery);
  const batEl = $('tv-bat');
  if (batEl){
    batEl.textContent = battery + '%';
    const cell = batEl.closest('.tele-cell');
    if (cell) cell.dataset.battLevel = battLevel(battery);
  }

  const distEl = $('tv-dist');
  if (distEl && dock && typeof SimRouter !== 'undefined'){
    distEl.textContent = (SimRouter.distM(drone.pos, dock.coords) / 1000).toFixed(1) + ' KM';
  }

  const fpvHdg = $('fpv-hdg'); if (fpvHdg) fpvHdg.textContent = padHeading(drone.heading) + '°';
  const fpvAlt = $('fpv-alt'); if (fpvAlt) fpvAlt.textContent = Math.round(drone.alt) + 'M';
  const fpvClock = $('fpv-clock'); if (fpvClock) fpvClock.textContent = nowClockStr();

  const rtbBtn = $('rp-rtb');
  if (rtbBtn) rtbBtn.disabled = !['transit', 'on-task', 'hold'].includes(drone.state);

  const holdBtn = $('rp-hold');
  if (holdBtn){
    const isHeld = drone.state === 'hold';
    holdBtn.textContent = isHeld ? 'RESUME' : 'PAUSE';
    holdBtn.disabled = !isHeld && !['transit', 'on-task'].includes(drone.state);
  }

  const followBtn = $('rp-follow');
  if (followBtn){
    const following = EC2.followDroneId === droneId;
    followBtn.classList.toggle('on', following);
    followBtn.textContent = following ? 'FOLLOWING' : 'FOLLOW';
  }

  const isManual = drone.state === 'manual';
  const controlBtn = $('rp-control');
  if (controlBtn){
    const controlDisabled = !isManual && !['transit', 'on-task', 'hold'].includes(drone.state);
    controlBtn.textContent = isManual ? 'RELEASE' : 'TAKE CONTROL';
    controlBtn.disabled = controlDisabled;
    controlBtn.classList.toggle('on', isManual);
  }
  const altRow = $('rp-alt-row');
  if (altRow) altRow.hidden = !isManual;

  // A drone forced out of manual (battery floor) or released elsewhere while
  // this panel is still open must drop the control.js overlay too — this
  // 2 Hz poll is the panel's own half of that guarantee (control.js also
  // watches the engine event feed for the same transition).
  if (!isManual && EC2.control && EC2.control.mode === 'manual' && EC2.control.activeId === droneId){
    EC2.control.exitManual();
  }
}

// ---------- debrief panel + MEDIA library (Task 13) ----------

function fmtMMSS(totalS){
  const s = Math.max(0, Math.round(totalS || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
}

// camelCase -> "SPACED UPPER" for analytics field labels.
function humanizeKey(key){
  return String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toUpperCase();
}

function formatAnalyticsValue(v){
  if (Array.isArray(v)) return v.join(' · ');
  return String(v);
}

function analyticsDL(mission){
  const a = mission.analytics || {};
  const keys = Object.keys(a);
  if (!keys.length) return '<p class="lbl" style="margin-top:10px">NO ANALYTICS CAPTURED</p>';
  return (
    '<dl class="rp-analytics">' +
      keys.map(k =>
        '<div class="rp-kv"><dt class="k">' + humanizeKey(k) + '</dt><dd class="v">' + formatAnalyticsValue(a[k]) + '</dd></div>'
      ).join('') +
    '</dl>'
  );
}

function debriefVideoSrc(mission){
  const variants = (typeof VIDEO_MANIFEST !== 'undefined' && VIDEO_MANIFEST[mission.type]) || [];
  if (!variants.length) return null;
  const idx = Number.isInteger(mission._videoVariant) ? mission._videoVariant : 0;
  return 'videos/' + variants[idx % variants.length];
}

function debriefVideoHTML(mission){
  const src = debriefVideoSrc(mission);
  return (
    '<div class="lbl" style="margin-top:16px">Mission video</div>' +
    '<div class="debrief-video">' +
      (src ? '<video id="debrief-video" controls preload="metadata" src="' + src + '"></video>' : '') +
      '<div class="debrief-canvas-wrap" id="debrief-canvas-wrap"' + (src ? ' hidden' : '') + '>' +
        '<canvas id="debrief-canvas"></canvas>' +
      '</div>' +
    '</div>' +
    '<div class="debrief-video-foot lbl">HIGGSFIELD &middot; GEN-4 &middot; ' + fmtMMSS(mission.durationS) + '</div>'
  );
}

function renderDebriefPanel(mission){
  const cfg = (typeof MISSIONS_CONFIG !== 'undefined' && MISSIONS_CONFIG[mission.type]) || { label: String(mission.type).toUpperCase() };
  return (
    '<div class="lbl">Mission debrief</div>' +
    '<div class="rp-id">' + mission.id + '</div>' +
    '<div class="rp-name">' + cfg.label + '</div>' +
    '<div class="rp-kv"><span class="k">Dock</span><span class="v">' + mission.dockId + '</span></div>' +
    '<div class="rp-kv"><span class="k">Duration</span><span class="v">' + fmtMMSS(mission.durationS) + '</span></div>' +
    '<div class="rp-kv"><span class="k">Distance</span><span class="v">' + (mission.distanceKm || 0).toFixed(1) + ' KM</span></div>' +
    '<div class="lbl" style="margin-top:16px">Mission analytics</div>' +
    analyticsDL(mission) +
    debriefVideoHTML(mission) +
    '<div class="rp-actions">' +
      '<button class="ghost" id="db-export" disabled title="SIMULATED">EXPORT REPORT</button>' +
      '<button class="ghost" id="db-share" disabled title="SIMULATED">SHARE</button>' +
    '</div>'
  );
}

function stopDebriefAnim(){
  if (debriefAnimId){ cancelAnimationFrame(debriefAnimId); debriefAnimId = null; }
}

// Drifting horizon + reticle + caption, drawn at ~30fps. Only ever runs
// while the canvas is actually the visible debrief placeholder — the rAF
// loop bails the moment the canvas leaves the DOM, and setRightPanel()
// cancels it unconditionally on every mode switch (see stopDebriefAnim above).
function drawDebriefFrame(ctx, canvas, ts){
  const w = canvas.width, h = canvas.height;
  if (!w || !h) return;
  ctx.fillStyle = '#0a0b0e';
  ctx.fillRect(0, 0, w, h);

  const drift = Math.sin(ts / 4000) * h * 0.05;
  const horizonY = h * 0.52 + drift;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#12151a');
  grad.addColorStop(Math.max(0, Math.min(1, horizonY / h)), '#0e1013');
  grad.addColorStop(1, '#07080a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(255,90,90,.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  ctx.lineTo(w, horizonY);
  ctx.stroke();

  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.11;
  ctx.strokeStyle = 'rgba(255,90,90,.35)';
  ctx.strokeRect(cx - r, cy - r, r * 2, r * 2);
  ctx.beginPath();
  ctx.moveTo(cx - r - 13, cy); ctx.lineTo(cx + r + 13, cy);
  ctx.moveTo(cx, cy - r - 13); ctx.lineTo(cx, cy + r + 13);
  ctx.strokeStyle = 'rgba(255,90,90,.3)';
  ctx.stroke();

  ctx.font = '700 9px ui-monospace, "SF Mono", Consolas, monospace';
  ctx.fillStyle = 'rgba(255,255,255,.34)';
  ctx.textAlign = 'center';
  ctx.fillText('AI MISSION VIDEO · PENDING GENERATION', w / 2, h - 12);
}

function startDebriefPlaceholder(canvas){
  if (!canvas) return;
  // Guard against a stale video 'error' handler from a *previously* rendered
  // debrief panel firing late (e.g. a slow 404 that resolves after the user
  // has already opened a different mission's debrief). That old canvas is no
  // longer in the document by the time this fires — bail before touching
  // stopDebriefAnim() so we never cancel the CURRENTLY visible placeholder's
  // rAF loop out from under it. Checked here (not just inside the frame
  // loop) so we never even kill-and-restart for a detached canvas.
  if (!canvas.isConnected) return;
  stopDebriefAnim();
  canvas.width = canvas.clientWidth || 300;
  canvas.height = canvas.clientHeight || 169;
  const ctx = canvas.getContext('2d');
  let last = 0;
  function frame(ts){
    if (!canvas.isConnected){ debriefAnimId = null; return; } // panel torn down elsewhere
    if (ts - last >= 33){ // cap ~30fps
      last = ts;
      drawDebriefFrame(ctx, canvas, ts);
    }
    debriefAnimId = requestAnimationFrame(frame);
  }
  debriefAnimId = requestAnimationFrame(frame);
}

function wireDebriefPanel(){
  const video = $('debrief-video');
  const canvasWrap = $('debrief-canvas-wrap');
  const canvas = $('debrief-canvas');
  if (video){
    // Swallow the load failure — every manifest entry 404s until real
    // footage is dropped into videos/, and that must never surface a
    // console error or a broken player.
    video.addEventListener('error', () => {
      video.hidden = true;
      if (canvasWrap) canvasWrap.hidden = false;
      startDebriefPlaceholder(canvas);
    }, { once: true });
  } else if (canvasWrap){
    canvasWrap.hidden = false;
    startDebriefPlaceholder(canvas);
  }
}

function timeHHMM(date){
  return date instanceof Date
    ? date.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' })
    : '--:--';
}

function analyticsSummaryLine(mission){
  const a = mission.analytics || {};
  const keys = Object.keys(a).slice(0, 2);
  if (!keys.length) return 'NO ANALYTICS';
  return keys.map(k => humanizeKey(k) + ' ' + formatAnalyticsValue(a[k])).join(' · ');
}

function renderMediaPanel(){
  if (!sessionMissions.length){
    return (
      '<div class="lbl">Media</div>' +
      '<div class="rp-empty">NO MISSIONS RECORDED YET &middot; CREATE ONE WITH + NEW MISSION</div>'
    );
  }
  const cards = sessionMissions.map(m => {
    const cfg = (typeof MISSIONS_CONFIG !== 'undefined' && MISSIONS_CONFIG[m.type]) || { label: String(m.type).toUpperCase() };
    return (
      '<button class="media-card" data-mid="' + m.id + '">' +
        '<div class="media-card-type lbl">' + cfg.label + '</div>' +
        '<div class="media-card-id">' + m.id + '</div>' +
        '<div class="media-card-meta">' +
          '<span>' + timeHHMM(m._debriefAt) + '</span>' +
          '<span class="state-chip">' + String(m.state).toUpperCase() + '</span>' +
        '</div>' +
        '<div class="media-card-analytics">' + analyticsSummaryLine(m) + '</div>' +
      '</button>'
    );
  }).join('');
  return (
    '<div class="lbl">Media &middot; ' + sessionMissions.length + ' mission' + (sessionMissions.length === 1 ? '' : 's') + ' this session</div>' +
    '<div class="media-grid">' + cards + '</div>'
  );
}

function wireMediaPanel(){
  const grid = document.querySelector('#rpanel-body .media-grid');
  if (!grid) return;
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.media-card');
    if (!card) return;
    const mission = sessionMissions.find(m => m.id === card.dataset.mid);
    if (mission) openDebrief(mission);
  });
}

// Shared entry point for every way a debrief can be opened (ticker chip,
// auto-open on completion, MEDIA card click, EC2.playMissionVideo). Exits
// any active capture mode first so the wizard/manual overlays never get
// left stranded under a panel swap they didn't expect.
function openDebrief(mission){
  if (!mission) return;
  if (EC2.control && EC2.control.mode === 'manual' && EC2.control.exitManual) EC2.control.exitManual();
  if (EC2.control && EC2.control.mode === 'wizard' && EC2.control.exitWizard) EC2.control.exitWizard();
  EC2.state.selection = null;
  updateRowSelection();
  EC2.ui.setRightPanel('debrief', mission);
}

// Assigns a stable, rotating video variant per mission (by how many prior
// missions of the same type this session has already recorded), records it
// for the MEDIA grid, fires the ticker chip, and auto-opens the debrief for
// user-created missions only (scheduler-spawned auto missions still land in
// MEDIA, just without stealing the operator's panel).
function recordCompletedMission(mission){
  if (mission._debriefAt) return; // already recorded (defensive; engine only emits COMPLETE once per mission)
  mission._debriefAt = new Date();
  const variants = (typeof VIDEO_MANIFEST !== 'undefined' && VIDEO_MANIFEST[mission.type]) || [];
  const priorOfType = sessionMissions.filter(m => m.type === mission.type).length;
  mission._videoVariant = variants.length ? (priorOfType % variants.length) : 0;

  sessionMissions.unshift(mission);
  if (sessionMissions.length > SESSION_MISSIONS_CAP) sessionMissions.length = SESSION_MISSIONS_CAP;

  EC2.ui.pushEvent({
    level: 'info',
    source: mission.dockId,
    message: 'DEBRIEF READY · ' + mission.id,
    onClick: () => openDebrief(mission)
  });

  const userCreated = !!(EC2.control && EC2.control.userMissions && EC2.control.userMissions.has(mission.id));
  if (userCreated) openDebrief(mission);
}

// Polls for window.__engine the same way control.js's wireEngineWatch does
// (the engine doesn't exist until the first console dive-in), then parses
// mission completion straight off the existing 'MISSION <id> COMPLETE'
// event text — no engine.js changes needed.
function wireDebriefWatch(){
  const COMPLETE_RE = /^MISSION (\S+) COMPLETE$/;
  const trySubscribe = () => {
    if (!window.__engine) return false;
    window.__engine.onEvent((ev) => {
      const m = COMPLETE_RE.exec(ev.message);
      if (!m) return;
      const mission = window.__engine.missions.get(m[1]);
      if (mission) recordCompletedMission(mission);
    });
    return true;
  };
  if (trySubscribe()) return;
  const iv = setInterval(() => { if (trySubscribe()) clearInterval(iv); }, 300);
}

function wireRightPanelActions(mode, data){
  if (mode === 'dock' && data){
    const locate = $('rp-locate');
    if (locate) locate.addEventListener('click', () => {
      if (EC2.map) EC2.map.flyTo({ center: data.coords, zoom: 14 });
    });
    const launch = $('rp-launch');
    if (launch) launch.addEventListener('click', () => {
      if (EC2.control && EC2.control.enterWizard) EC2.control.enterWizard(data.id);
    });
  } else if (mode === 'wizard' && data){
    // Mission wizard (Task 12) owns its own state/rendering/wiring in
    // control.js — this registry only needs to dispatch to it.
    if (EC2.control && EC2.control.wireWizardPanel) EC2.control.wireWizardPanel(data);
  } else if (mode === 'drone' && data){
    const droneId = data.id;

    const followBtn = $('rp-follow');
    if (followBtn) followBtn.addEventListener('click', () => {
      const turningOn = EC2.followDroneId !== droneId;
      EC2.followDroneId = turningOn ? droneId : null;
      if (turningOn && EC2.map && window.__engine){
        const d = window.__engine.drones.get(droneId);
        if (d) EC2.map.easeTo({ center: d.pos, zoom: 12.5, duration: 600 });
      }
      followBtn.classList.toggle('on', turningOn);
      followBtn.textContent = turningOn ? 'FOLLOWING' : 'FOLLOW';
    });

    const rtbBtn = $('rp-rtb');
    if (rtbBtn) rtbBtn.addEventListener('click', () => {
      if (window.__engine) window.__engine.commandRTB(droneId);
    });

    const holdBtn = $('rp-hold');
    if (holdBtn) holdBtn.addEventListener('click', () => {
      if (!window.__engine) return;
      const d = window.__engine.drones.get(droneId);
      if (!d) return;
      window.__engine.commandHold(droneId, d.state !== 'hold');
    });

    const controlBtn = $('rp-control');
    if (controlBtn) controlBtn.addEventListener('click', () => {
      if (!window.__engine || !EC2.control) return;
      const d = window.__engine.drones.get(droneId);
      if (!d) return;
      if (d.state === 'manual') EC2.control.exitManual();
      else EC2.control.enterManual(droneId);
    });

    const altDn = $('rp-alt-dn');
    if (altDn) altDn.addEventListener('click', () => {
      if (window.__engine) window.__engine.nudgeAlt(droneId, -10);
    });
    const altUp = $('rp-alt-up');
    if (altUp) altUp.addEventListener('click', () => {
      if (window.__engine) window.__engine.nudgeAlt(droneId, 10);
    });
  } else if (mode === 'debrief' && data){
    wireDebriefPanel();
  } else if (mode === 'media'){
    wireMediaPanel();
  }
}

// ---------- dock list ----------

// A drone selection still "belongs" to a dock row (D-<dockId> -> dockId),
// so the list row stays highlighted whichever way the drone was selected.
function selectedDockId(){
  const sel = EC2.state.selection;
  if (!sel) return null;
  if (sel.type === 'dock') return sel.id;
  if (sel.type === 'drone') return sel.id.replace(/^D-/, '');
  return null;
}

function updateRowSelection(){
  const list = $('docklist');
  if (!list) return;
  const dockId = selectedDockId();
  list.querySelectorAll('.dock-row').forEach(row => {
    row.classList.toggle('sel', !!dockId && row.dataset.dockId === dockId);
  });
}

// ---------- EC2.ui ----------

EC2.ui = {
  panelRenderers: {
    empty: renderEmptyPanel,
    dock: renderDockPanel,
    drone: renderDronePanel,
    site: renderSitePanel,
    debrief: renderDebriefPanel,
    media: renderMediaPanel
  },

  setStats(o){
    if (o.ready != null) $('st-ready').textContent = o.ready;
    if (o.flying != null) $('st-flying').textContent = o.flying;
    if (o.charge != null) $('st-charge').textContent = o.charge;
    if (o.alert != null) $('st-alert').textContent = o.alert;
    if (o.airborne != null){
      const b = $('c-air').querySelector('b');
      if (b) b.textContent = o.airborne;
    }
    if (o.alerts != null){
      const chip = $('c-alerts');
      const b = chip.querySelector('b');
      if (b) b.textContent = o.alerts;
      chip.hidden = !o.alerts;
    }
  },

  renderDockList(filter){
    if (filter) currentFilter = filter;
    const list = $('docklist');
    if (!list) return;
    list.innerHTML = '';

    const rows = DATA_DOCKS.filter(d => {
      if (currentFilter === 'ALL') return true;
      if (currentFilter === 'FLYING') return FLYING_STATES.includes(stateFor(d));
      if (currentFilter === 'ALERTS') return ALERT_STATES.includes(stateFor(d));
      return d.emirate === currentFilter;
    });

    if (!rows.length){
      const note = document.createElement('div');
      note.className = 'lbl empty-note';
      note.textContent = 'NO DOCKS MATCH THIS FILTER';
      list.appendChild(note);
      return;
    }

    const selDockId = selectedDockId();
    for (const d of rows){
      const battery = batteryFor(d.id);
      const live = stateFor(d);
      const sdClass = 'sd' + (ALERT_STATES.includes(live) ? ' alert' : '');
      const row = document.createElement('button');
      row.className = 'dock-row' + (selDockId === d.id ? ' sel' : '');
      row.dataset.dockId = d.id;
      row.innerHTML =
        '<span class="' + sdClass + '"></span>' +
        '<span class="di"><b>' + d.id + '</b><i>' + d.name + '</i></span>' +
        '<span class="dr"><span class="model">' + d.model + '</span><span class="batt">' + battery + '%</span></span>';
      // A dock whose drone is airborne selects the drone (telemetry panel);
      // otherwise (docked/charging/fault) selecting the dock itself as before.
      row.addEventListener('click', () => {
        const drone = window.__engine && window.__engine.drones.get('D-' + d.id);
        if (drone && drone.state !== 'docked'){
          EC2.select({ type: 'drone', id: drone.id });
        } else {
          EC2.select({ type: 'dock', id: d.id });
        }
      });
      list.appendChild(row);
    }
  },

  // ev.onClick (optional) makes the chip clickable (e.g. DEBRIEF READY ·
  // <id> opening that mission's debrief) — everything else about the chip
  // (level styling, 30-item cap, prepend order) is unchanged.
  pushEvent(ev){
    const stream = $('tickstream');
    if (!stream) return;
    const level = ev.level === 'warn' ? ' warn' : ev.level === 'alert' ? ' alert' : '';
    const time = ev.time || nowClockStr();
    const el = document.createElement('span');
    el.className = 'tick-ev' + level + (ev.onClick ? ' clickable' : '');
    el.innerHTML =
      '<span class="tt">' + time + '</span>' +
      '<span class="src">' + ev.source + '</span>' +
      '<span class="msg">' + ev.message + '</span>';
    if (typeof ev.onClick === 'function') el.addEventListener('click', ev.onClick);
    stream.insertBefore(el, stream.firstChild);
    while (stream.children.length > 30) stream.removeChild(stream.lastChild);
  },

  // Generic raw-html ticker insert (same prepend/cap-30 contract as pushEvent),
  // for callers that already have formatted markup instead of an event object.
  tick(html){
    const stream = $('tickstream');
    if (!stream) return;
    const el = document.createElement('span');
    el.className = 'tick-ev';
    el.innerHTML = html;
    stream.insertBefore(el, stream.firstChild);
    while (stream.children.length > 30) stream.removeChild(stream.lastChild);
  },

  setRightPanel(mode, data){
    // Kill the previous mode's 2 Hz telemetry timer unconditionally — this
    // is the one place every mode switch passes through, so it's the one
    // place that can guarantee no interval pile-up.
    if (droneTeleTimer){ clearInterval(droneTeleTimer); droneTeleTimer = null; }
    // Same guarantee for the debrief panel's placeholder-video rAF loop —
    // it must stop the instant the panel is no longer showing it.
    stopDebriefAnim();

    // FOLLOW only survives a setRightPanel call that re-selects the exact
    // same drone (e.g. the periodic dock-list refresh); any real selection
    // change — a different drone, a dock, or back to empty — stops it.
    const stillFollowingSameDrone = mode === 'drone' && data && EC2.followDroneId === data.id;
    if (EC2.followDroneId && !stillFollowingSameDrone) EC2.followDroneId = null;

    const renderer = EC2.ui.panelRenderers[mode] || EC2.ui.panelRenderers.empty;
    const body = $('rpanel-body');
    if (!body) return;
    body.innerHTML = renderer(data);
    wireRightPanelActions(mode, data);

    if (mode === 'drone' && data){
      droneTeleTimer = setInterval(() => updateDroneTelemetry(data.id), 500); // 2 Hz
    }
  }
};

// Single 1 Hz camera driver for FOLLOW mode — started once at init, not
// per-selection, so there is nothing here for setRightPanel to leak either.
function startFollowDriver(){
  setInterval(() => {
    if (!EC2.followDroneId || !EC2.map || !window.__engine) return;
    const drone = window.__engine.drones.get(EC2.followDroneId);
    if (!drone || drone.state === 'docked'){ EC2.followDroneId = null; return; }
    EC2.map.easeTo({ center: drone.pos, zoom: 12.5, duration: 950 });
  }, 1000);
}

// ---------- selection ----------

EC2.followDroneId = null;

EC2.select = function(sel){
  // Manual control (Task 11) owns map clicks exclusively while engaged;
  // selecting anything else — a dock, a site, or a different drone — must
  // hand the map back to normal selection/click behavior cleanly first.
  if (EC2.control && EC2.control.mode === 'manual' &&
      !(sel.type === 'drone' && sel.id === EC2.control.activeId)){
    EC2.control.exitManual();
  }
  // The mission wizard (Task 12) owns the right panel exclusively while
  // engaged — any selection made elsewhere (dock list row, etc.) cancels it
  // cleanly first rather than leaving stale wizard state under a panel swap.
  if (EC2.control && EC2.control.mode === 'wizard') EC2.control.exitWizard();

  if (sel.type === 'dock'){
    const dock = dockIndex.get(sel.id);
    if (!dock) return;
    const prev = EC2.state.selection;
    const changed = !(prev && prev.type === 'dock' && prev.id === sel.id);
    EC2.state.selection = { type: 'dock', id: sel.id };
    updateRowSelection();
    EC2.ui.setRightPanel('dock', dock);
    if (changed && EC2.map) EC2.map.flyTo({ center: dock.coords, zoom: 11 });
  } else if (sel.type === 'drone'){
    if (!window.__engine) return;
    const drone = window.__engine.drones.get(sel.id);
    if (!drone) return;
    EC2.state.selection = { type: 'drone', id: sel.id };
    updateRowSelection();
    // No flyTo here — FOLLOW (below) drives the camera for a live drone;
    // an unrequested jump on every selection would fight the operator.
    EC2.ui.setRightPanel('drone', drone);
  } else if (sel.type === 'site'){
    const site = siteIndex.get(sel.id);
    if (!site) return;
    EC2.state.selection = { type: 'site', id: sel.id };
    updateRowSelection(); // no dock-list row matches a site; this just clears any dock highlight
    EC2.ui.setRightPanel('site', site);
  }
};

// ---------- wiring ----------

function wireTopbar(){
  const globeBtn = $('btn-globe');
  if (globeBtn) globeBtn.addEventListener('click', () => EC2.exitToOrbit());

  const newMissionBtn = $('btn-newmission');
  if (newMissionBtn) newMissionBtn.addEventListener('click', () => {
    if (!EC2.control || !EC2.control.enterWizard || EC2.control.mode !== 'normal') return;
    EC2.control.enterWizard(null);
  });

  const mediaBtn = $('btn-media');
  if (mediaBtn) mediaBtn.addEventListener('click', () => {
    if (EC2.control && EC2.control.mode === 'manual') EC2.control.exitManual();
    if (EC2.control && EC2.control.mode === 'wizard') EC2.control.exitWizard();
    EC2.state.selection = null;
    updateRowSelection();
    EC2.ui.setRightPanel('media');
  });

  const layerSeg = $('layerseg');
  if (layerSeg) layerSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-l]');
    if (!btn) return;
    layerSeg.querySelectorAll('button').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    EC2.setLayer(btn.dataset.l);
  });

  const timeSeg = $('timescale');
  if (timeSeg) timeSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-ts]');
    if (!btn) return;
    timeSeg.querySelectorAll('button').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    EC2.state.timeScale = Number(btn.dataset.ts);
  });
}

function wireFilters(){
  const container = $('filters');
  if (!container) return;
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.fchip');
    if (!btn) return;
    container.querySelectorAll('.fchip').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    EC2.ui.renderDockList(btn.dataset.filter);
  });
}

function wireLiveNetwork(){
  const el = $('live-net');
  if (!el) return;
  const fly = () => { if (EC2.map) EC2.map.flyTo({ center: [54.9, 24.3], zoom: 8.3 }); };
  el.addEventListener('click', fly);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); fly(); }
  });
}

function wireClock(){
  const el = $('clock');
  if (!el) return;
  const paint = () => { el.innerHTML = nowClockStr() + ' <span>GST</span>'; };
  paint();
  setInterval(paint, 1000);
}

function wireScene(){
  const chromeEls = [$('topbar'), $('side'), $('rpanel'), $('ticker')].filter(Boolean);
  chromeEls.forEach(el => el.classList.add('chrome-in'));

  function setVisible(show){
    if (show){
      chromeEls.forEach(el => { el.hidden = false; });
      // Double rAF: let the opacity:0 state paint before transitioning to 1.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        chromeEls.forEach(el => { el.style.opacity = '1'; });
      }));
    } else {
      chromeEls.forEach(el => { el.style.opacity = '0'; });
      setTimeout(() => { chromeEls.forEach(el => { el.hidden = true; }); }, 220);
    }
  }

  setVisible(EC2.state.scene === 'console');
  EC2.onSceneChange(scene => {
    setVisible(scene === 'console');
    // FOLLOW makes no sense once we've left the console map (globe scene).
    if (scene !== 'console'){
      if (EC2.control && EC2.control.mode === 'manual') EC2.control.exitManual();
      if (EC2.control && EC2.control.mode === 'wizard') EC2.control.exitWizard();
      EC2.followDroneId = null;
      EC2.state.selection = null;
      EC2.ui.setRightPanel('empty'); // also clears droneTeleTimer
    }
  });
}

// Manual control (Task 11) captures the map exclusively while engaged —
// these selection handlers must stand down so a click on a dock/drone/site
// feature becomes a click-to-go/queue instead of a selection change.
function inCaptureMode(){
  return !!(EC2.control && EC2.control.mode !== 'normal');
}

function wireMapDockInteractions(){
  if (!EC2.map) return;
  EC2.map.on('click', 'docks-dots', (e) => {
    if (inCaptureMode()) return;
    const f = e.features && e.features[0];
    if (!f) return;
    EC2.select({ type: 'dock', id: f.properties.id });
  });
  EC2.map.on('mouseenter', 'docks-dots', () => { if (!inCaptureMode()) EC2.map.getCanvas().style.cursor = 'pointer'; });
  EC2.map.on('mouseleave', 'docks-dots', () => { if (!inCaptureMode()) EC2.map.getCanvas().style.cursor = ''; });

  // Airborne drone triangles (Task 10) — click selects the drone itself;
  // camera stays put here, FOLLOW (if toggled on) drives the camera instead.
  EC2.map.on('click', 'drones-layer', (e) => {
    if (inCaptureMode()) return;
    const f = e.features && e.features[0];
    if (!f) return;
    EC2.select({ type: 'drone', id: f.properties.id });
  });
  EC2.map.on('mouseenter', 'drones-layer', () => { if (!inCaptureMode()) EC2.map.getCanvas().style.cursor = 'pointer'; });
  EC2.map.on('mouseleave', 'drones-layer', () => { if (!inCaptureMode()) EC2.map.getCanvas().style.cursor = ''; });

  // Live tower sites (Task 10.5) — static, click selects the site card.
  EC2.map.on('click', 'sites-dots', (e) => {
    if (inCaptureMode()) return;
    const f = e.features && e.features[0];
    if (!f) return;
    EC2.select({ type: 'site', id: f.properties.id });
  });
  EC2.map.on('mouseenter', 'sites-dots', () => { if (!inCaptureMode()) EC2.map.getCanvas().style.cursor = 'pointer'; });
  EC2.map.on('mouseleave', 'sites-dots', () => { if (!inCaptureMode()) EC2.map.getCanvas().style.cursor = ''; });
}

// Public API (Task 13 contract): jump straight to a mission's debrief and
// attempt its video. Shares the same capture-mode-safe entry point as the
// ticker chip / MEDIA card click.
EC2.playMissionVideo = function(mission){ openDebrief(mission); };

EC2.initPanels = function(){
  buildDockIndex();
  buildSiteIndex();
  wireTopbar();
  wireFilters();
  wireClock();
  wireLiveNetwork();
  wireScene();
  wireMapDockInteractions();
  startFollowDriver();
  wireDebriefWatch();
  EC2.ui.renderDockList('ALL');
  EC2.ui.setRightPanel('empty');
  // Static plausible snapshot until the sim engine boots (first dive-in);
  // from then on main.js's rAF loop drives real counts via setStats each ~1s.
  EC2.ui.setStats({ ready: 81, flying: 17, charge: 4, alert: 2 });

  // Dock list rows embed live per-dock battery/state once window.__engine
  // exists (see stateFor/batteryFor above) but nothing re-renders them on
  // its own — poll while the console scene is showing so FLYING/ALERTS
  // filters and per-row battery stay current.
  setInterval(() => {
    if (EC2.state.scene !== 'console' || !window.__engine) return;
    EC2.ui.renderDockList();
    if (EC2.refreshCounts) EC2.refreshCounts(window.__engine);
  }, 2000);
};
})();
