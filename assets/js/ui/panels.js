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

// 1 Hz live-refresh timer for the OPS DIGEST default panel — same lifecycle
// contract as droneTeleTimer: setRightPanel() clears it unconditionally on
// every mode switch and restarts it only while the empty/digest panel shows.
let digestTimer = null;

// Dock-list search / sort state (Task: dock list upgrade). dockListSig is the
// last rendered signature (filter|search|sort|ordered ids) — when unchanged
// the 2s refresh only patches battery/state text in place instead of
// rebuilding 104 rows of DOM.
let dockSearch = '';
let dockSort = 'ID';
let dockListSig = null;

// FLIGHT REQUESTS panel: last rendered pending-request id signature — when
// unchanged, the 2s poll only patches the age cells in place (same
// signature-vs-patch pattern as dockListSig above).
let reqListSig = null;

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

// XSS hardening (Task 14 fix): ticker items interpolate ev.source/ev.message
// straight into innerHTML (pushEvent below) — engine event text is
// currently sim-generated, but dock/mission ids ultimately trace back to
// data files and this is the one seam where that content reaches innerHTML,
// so it's escaped defensively rather than trusted. Ticker copy has never
// used inline markup for emphasis, but escaping unconditionally would still
// be correct if it ever does: entities are escaped first, then the single
// safe <b>/</b> subset is restored from its escaped form so bold segments
// keep rendering — nothing else round-trips back into a tag.
function escapeHtml(s){
  const str = String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return str.replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
}

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

// ---------- OPS DIGEST (default right panel) ----------

// Per-type detection copy from engine.js DETECTION_MSGS, matched structurally:
// a detection event is info-level, drone-sourced, and its message is exactly
// '<droneId> <one of these suffixes>'. Kept as suffixes (not full-string
// regexes) so a change to id formats can't silently break the filter.
const DETECTION_SUFFIXES = [
  'FLAGGED VEHICLE ON PATROL SWEEP',
  'THERMAL ANOMALY LOGGED',
  'SCENE ASSESSMENT UPDATED',
  'PAYLOAD STATUS NOMINAL',
  'SURVEY DATA CAPTURED',
  'VEHICLE FLAGGED ON HIGHWAY SWEEP',
  'VEGETATION STRESS ZONE FLAGGED'
];

function isDetectionEvent(ev){
  if (!ev || ev.level !== 'info' || !/^D-/.test(ev.source || '')) return false;
  const msg = String(ev.message || '');
  return DETECTION_SUFFIXES.some(sfx => msg === ev.source + ' ' + sfx);
}

// ETA as M:SS (single-digit minutes allowed, unlike fmtMMSS's MM:SS).
function fmtETA(totalS){
  const s = Math.max(0, Math.round(totalS || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

const DIGEST_MISSIONS_CAP = 8;

function digestActiveMissions(){
  const engine = window.__engine;
  if (!engine) return [];
  const out = [];
  for (const m of engine.missions.values()){
    if (m.state === 'active') out.push(m);
  }
  // Newest first, so a freshly launched mission surfaces at the top.
  out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  return out.slice(0, DIGEST_MISSIONS_CAP);
}

function digestStatsLine(){
  const engine = window.__engine;
  if (!engine) return '104 DOCK STATIONS ONLINE · ALL 7 EMIRATES';
  let ready = 0, alerts = 0, airborne = 0;
  for (const dock of engine.docks.values()){
    if (dock.state === 'ready') ready++;
    else if (dock.state === 'fault' || dock.state === 'offline') alerts++;
  }
  for (const d of engine.drones.values()){
    if (d.state !== 'docked') airborne++;
  }
  return 'AIRBORNE ' + airborne + ' · READY ' + ready + ' · ALERTS ' + alerts;
}

function digestMissionRowsHTML(missions){
  if (!missions.length){
    return '<div class="lbl empty-note">NO ACTIVE MISSIONS · GRID AT READINESS</div>';
  }
  return missions.map(m => {
    const cfg = (typeof MISSIONS_CONFIG !== 'undefined' && MISSIONS_CONFIG[m.type]) || { label: String(m.type).toUpperCase() };
    const pct = Math.round((m.progress || 0) * 100);
    const eta = fmtETA((m.durationS || 0) * (1 - (m.progress || 0)));
    return (
      '<button class="digest-row" data-mid="' + m.id + '" data-drone="D-' + m.dockId + '">' +
        '<span class="dg-head"><span class="dg-type">' + cfg.label + '</span>' +
          '<span class="dg-eta" id="dge-' + m.id + '">ETA ' + eta + '</span></span>' +
        '<span class="dg-id">' + m.id + ' · ' + m.dockId + '</span>' +
        '<span class="dg-prog"><i id="dgp-' + m.id + '" style="width:' + pct + '%"></i></span>' +
      '</button>'
    );
  }).join('');
}

function lastDetections(n){
  const engine = window.__engine;
  if (!engine || !Array.isArray(engine.events)) return [];
  const out = [];
  for (let i = engine.events.length - 1; i >= 0 && out.length < n; i--){
    if (isDetectionEvent(engine.events[i])) out.push(engine.events[i]);
  }
  return out;
}

function detectionRowsHTML(dets){
  if (!dets.length){
    return '<div class="lbl empty-note">NO DETECTIONS LOGGED YET</div>';
  }
  return dets.map(ev => {
    const msg = String(ev.message || '');
    const body = msg.indexOf(ev.source + ' ') === 0 ? msg.slice(ev.source.length + 1) : msg;
    return (
      '<div class="dg-det">' +
        '<span class="tt">T+' + fmtMMSS(ev.time) + '</span>' +
        '<span class="src">' + escapeHtml(ev.source) + '</span>' +
        '<span class="msg">' + escapeHtml(body) + '</span>' +
      '</div>'
    );
  }).join('');
}

function renderEmptyPanel(){
  const missions = digestActiveMissions();
  const dets = lastDetections(3);
  return (
    '<div id="ops-digest">' +
      '<div class="lbl">Ops digest · national activity</div>' +
      '<div class="digest-stats" id="digest-stats">' + digestStatsLine() + '</div>' +
      '<div class="lbl" style="margin-top:16px">Active missions</div>' +
      '<div class="digest-missions" id="digest-missions" data-key="' + missions.map(m => m.id).join(',') + '">' +
        digestMissionRowsHTML(missions) +
      '</div>' +
      '<div class="lbl" style="margin-top:16px">Last detections</div>' +
      '<div class="digest-dets" id="digest-detections" data-key="' +
        dets.map(ev => ev.time + '|' + ev.source + '|' + ev.message).join('~') + '">' +
        detectionRowsHTML(dets) + '</div>' +
    '</div>'
  );
}

// 1 Hz refresh for the digest. Flicker-free by design: the missions list is
// re-rendered ONLY when the set of active mission ids changes; otherwise the
// progress bar widths / ETAs are patched in place by element id.
function updateOpsDigest(){
  if (!$('ops-digest')) return;

  const statsEl = $('digest-stats');
  if (statsEl){
    const line = digestStatsLine();
    if (statsEl.textContent !== line) statsEl.textContent = line;
  }

  const missions = digestActiveMissions();
  const listEl = $('digest-missions');
  if (listEl){
    const key = missions.map(m => m.id).join(',');
    if (listEl.dataset.key !== key){
      listEl.dataset.key = key;
      listEl.innerHTML = digestMissionRowsHTML(missions);
    } else {
      for (const m of missions){
        const bar = $('dgp-' + m.id);
        if (bar) bar.style.width = Math.round((m.progress || 0) * 100) + '%';
        const eta = $('dge-' + m.id);
        if (eta) eta.textContent = 'ETA ' + fmtETA((m.durationS || 0) * (1 - (m.progress || 0)));
      }
    }
  }

  const dets = lastDetections(3);
  const detEl = $('digest-detections');
  if (detEl){
    const dkey = dets.map(ev => ev.time + '|' + ev.source + '|' + ev.message).join('~');
    if (detEl.dataset.key !== dkey){
      detEl.dataset.key = dkey;
      detEl.innerHTML = detectionRowsHTML(dets);
    }
  }
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

// Closest dock to an arbitrary point — powers the site card's NEAREST DOCK
// action and its coverage read-out. Uses SimRouter's metric distance when
// available, falling back to a cheap planar metric so the card never breaks.
function nearestDockTo(coords){
  const R = window.SimRouter;
  let best = null, bestKm = Infinity;
  for (const d of DATA_DOCKS){
    const m = R ? R.distM(coords, d.coords)
                : Math.hypot(coords[0] - d.coords[0], coords[1] - d.coords[1]) * 111000;
    if (m < bestKm){ bestKm = m; best = d; }
  }
  return best ? { dock: best, km: bestKm / 1000 } : null;
}

function renderSitePanel(site){
  const chip = SITE_STATUS_CHIP[site.status] || SITE_STATUS_CHIP.installed;
  const [lon, lat] = site.coords;
  // A planned (not-yet-installed) site reads as a pre-deployment SURVEY;
  // installed / needs-replacement towers get an INSPECTION.
  const dispatchLabel = site.status === 'not-installed' ? 'SURVEY SITE' : 'DISPATCH INSPECTION';
  const near = nearestDockTo(site.coords);
  const nearLine = near
    ? '<div class="rp-kv"><span class="k">Nearest dock</span><span class="v">' +
        near.dock.name + ' · ' + near.km.toFixed(1) + ' KM</span></div>'
    : '';
  return (
    '<div class="rp-id">' + site.id + '</div>' +
    '<div class="rp-name">' + site.name + '</div>' +
    '<div class="rp-kv"><span class="k">Coordinates</span><span class="v">' + lat.toFixed(5) + ', ' + lon.toFixed(5) + '</span></div>' +
    nearLine +
    '<div class="state-chip' + (chip.cls ? ' ' + chip.cls : '') + '">' + chip.text + '</div>' +
    '<div class="lbl" style="margin-top:14px">E&amp; TOWER SITE · LIVE NETWORK</div>' +
    '<div class="rp-actions">' +
      '<button class="primary" id="rp-site-dispatch">' + dispatchLabel + '</button>' +
      '<button class="ghost" id="rp-site-locate">LOCATE</button>' +
      '<button class="ghost" id="rp-site-dock">NEAREST DOCK</button>' +
    '</div>'
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

// Live downlink clips for a flying drone: the mission-type's video segments
// (see VIDEO_MANIFEST). Only a drone actually on a mission has a feed; a
// docked/idle drone shows the standby frame with no video.
function fpvSources(drone){
  const engine = window.__engine;
  const mission = drone && drone.missionId && engine ? engine.missions.get(drone.missionId) : null;
  if (!mission) return [];
  const variants = (typeof VIDEO_MANIFEST !== 'undefined' && VIDEO_MANIFEST[mission.type]) || [];
  return variants.map(f => 'videos/' + f);
}

// The live downlink only runs once the drone is actually cruising over the
// area (transit/on-task and the mid-air states), matching the aerial patrol
// footage — NOT during takeoff from the dock or the final landing descent,
// where the frame shows an "acquiring feed" standby instead.
const FPV_LIVE_STATES = ['transit', 'on-task', 'rtb', 'hold', 'manual'];
function fpvCruising(drone){ return !!drone && FPV_LIVE_STATES.indexOf(drone.state) !== -1; }

function fpvVideoTag(sources){
  // One clip loops natively; multiple clips are chained (and looped) by
  // wireFpvFeed on 'ended' — so 'loop' is omitted there since it would
  // suppress the 'ended' event the chain relies on.
  return '<video class="fpv-video" id="fpv-video" autoplay muted playsinline preload="auto"' +
    (sources.length > 1 ? '' : ' loop') +
    ' src="' + sources[0] + '" data-playlist="' + sources.join(',') + '"></video>';
}

function fpvFrameHTML(drone){
  const sources = fpvSources(drone);
  const live = fpvCruising(drone) && sources.length > 0;
  return (
    // data-playlist stays on the frame so syncFpvFeed can spin the video up
    // the moment the drone transitions into a cruising state mid-flight.
    '<div class="fpv-frame' + (live ? ' live' : '') + '" id="fpv-frame" data-playlist="' + sources.join(',') + '">' +
      (live ? fpvVideoTag(sources) : '') +
      '<span class="fpv-standby" id="fpv-standby"' + (live ? ' hidden' : '') + '>ACQUIRING DOWNLINK</span>' +
      '<span class="fpv-rec"><i></i>REC</span>' +
      '<span class="fpv-eo">EO 1X</span>' +
      '<div class="fpv-reticle"><span class="cross h"></span><span class="cross v"></span></div>' +
      '<span class="fpv-hdg" id="fpv-hdg">' + padHeading(drone.heading) + '&deg;</span>' +
      '<span class="fpv-alt" id="fpv-alt">' + Math.round(drone.alt) + 'M</span>' +
      '<span class="fpv-clock" id="fpv-clock">' + nowClockStr() + '</span>' +
      '<span class="fpv-foot">SENTINEL EO &middot; CH-1 &middot; SIMULATED FEED</span>' +
    '</div>'
  );
}

// Called on every telemetry tick: brings the feed up when the drone starts
// cruising and tears it down (back to standby) when it lands/docks, so the
// footage is only ever on-screen while the drone is over the area.
function syncFpvFeed(drone){
  const frame = $('fpv-frame');
  if (!frame) return;
  const playlist = (frame.getAttribute('data-playlist') || '').split(',').filter(Boolean);
  const standby = $('fpv-standby');
  const existing = $('fpv-video');
  const shouldPlay = fpvCruising(drone) && playlist.length > 0;

  if (shouldPlay && !existing){
    frame.insertAdjacentHTML('afterbegin', fpvVideoTag(playlist));
    frame.classList.add('live');
    if (standby) standby.hidden = true;
    wireFpvFeed();
    const v = $('fpv-video');
    if (v) v.play().catch(() => {});
  } else if (!shouldPlay && existing){
    existing.pause();
    existing.remove();
    frame.classList.remove('live');
    if (standby) standby.hidden = false;
  }
}

// Chains the FPV feed's clips (advance on 'ended', loop back to the first) so
// a multi-segment mission video plays as one continuous live downlink. Robust
// to a missing clip: skips to the next source on error.
function wireFpvFeed(){
  const v = $('fpv-video');
  if (!v) return;
  const playlist = (v.getAttribute('data-playlist') || '').split(',').filter(Boolean);
  if (playlist.length < 2) return; // single clip loops via the 'loop' attr
  let idx = 0;
  v.addEventListener('ended', () => {
    idx = (idx + 1) % playlist.length;
    v.src = playlist[idx];
    v.play().catch(() => {});
  });
  v.addEventListener('error', () => {
    idx = (idx + 1) % playlist.length;
    v.src = playlist[idx];
    v.play().catch(() => {});
  });
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
  syncFpvFeed(drone); // bring the live feed up/down as the drone starts/stops cruising

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

function thousands(v){
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : String(v);
}

// Unit-aware label/format pairs for the analytics keys the sim actually
// produces (missions-config.js). Anything not listed keeps the generic
// camelCase -> "SPACED UPPER" fallback with the raw value. Used identically
// by the debrief panel, the MEDIA cards and the exported report.
const ANALYTICS_FORMATS = {
  timeToSceneS: { label: 'TIME TO SCENE', fmt: v => v + 'S' },
  etaDeltaS:    { label: 'ETA DELTA',     fmt: v => (v > 0 ? '+' : '') + v + 'S' },
  payloadKg:    { label: 'PAYLOAD',       fmt: v => v + ' KG' },
  areaHa:       { label: 'AREA',          fmt: v => thousands(v) + ' HA' },
  volumeDeltaM3:{ label: 'VOLUME Δ',      fmt: v => thousands(v) + ' M³' },
  ndviMean:     { label: 'NDVI MEAN',     fmt: v => String(v) },
  coveragePct:  { label: 'COVERAGE',      fmt: v => v + '%' },
  progressPct:  { label: 'PROGRESS',      fmt: v => v + '%' },
  stressedPct:  { label: 'STRESSED',      fmt: v => v + '%' },
  palmCount:    { label: 'PALM COUNT',    fmt: v => thousands(v) }
};

// camelCase -> "SPACED UPPER" for analytics field labels; known keys get
// their explicit unit-aware label instead.
function humanizeKey(key){
  const known = ANALYTICS_FORMATS[key];
  if (known) return known.label;
  return String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toUpperCase();
}

function formatAnalyticsValue(key, v){
  if (Array.isArray(v)) return v.join(' · ');
  const known = ANALYTICS_FORMATS[key];
  if (known) return known.fmt(v);
  return String(v);
}

function analyticsDL(mission){
  const a = mission.analytics || {};
  const keys = Object.keys(a);
  if (!keys.length) return '<p class="lbl" style="margin-top:10px">NO ANALYTICS CAPTURED</p>';
  return (
    '<dl class="rp-analytics">' +
      keys.map(k =>
        '<div class="rp-kv"><dt class="k">' + humanizeKey(k) + '</dt><dd class="v">' + formatAnalyticsValue(k, a[k]) + '</dd></div>'
      ).join('') +
    '</dl>'
  );
}

// The full ordered list of clips for a mission type. A multi-clip type (e.g.
// security's eight aerial-downlink segments) plays back-to-back as one
// continuous mission video; a single-clip type is a one-item list.
function debriefVideoSources(mission){
  const variants = (typeof VIDEO_MANIFEST !== 'undefined' && VIDEO_MANIFEST[mission.type]) || [];
  return variants.map(f => 'videos/' + f);
}

function debriefVideoHTML(mission){
  const sources = debriefVideoSources(mission);
  const first = sources[0] || '';
  // The ordered playlist rides along on the element so wireDebriefPanel can
  // advance through it on 'ended' without re-deriving from the mission.
  const playlistAttr = sources.length
    ? ' data-playlist="' + sources.join(',') + '"'
    : '';
  return (
    '<div class="lbl" style="margin-top:16px">Mission video</div>' +
    '<div class="debrief-video">' +
      // autoplay + muted + playsinline so the mission video starts on its own
      // when the debrief opens (browsers only allow autoplay while muted); the
      // operator still has controls to pause or unmute.
      (sources.length ? '<video id="debrief-video" controls autoplay muted playsinline preload="auto" src="' + first + '"' + playlistAttr + '></video>' : '') +
      '<div class="debrief-canvas-wrap" id="debrief-canvas-wrap"' + (sources.length ? ' hidden' : '') + '>' +
        '<canvas id="debrief-canvas"></canvas>' +
      '</div>' +
    '</div>' +
    '<div class="debrief-video-foot lbl">SENTINEL EO &middot; MISSION RECORD &middot; ' + fmtMMSS(mission.durationS) + '</div>'
  );
}

// ---------- route snapshot (pure string-built inline SVG, no libs) ----------

// Plots a waypoints array ([lon,lat] pairs) normalized into a 240x140 box
// with 8% padding: the track (polyline), dock/start (square), end (circle)
// and small dots at each 25% of the path length. Shared between the debrief
// panel, the exported report and the flight-request review preview.
function routeSvg(waypoints){
  const wps = (waypoints || []).filter(p =>
    Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (wps.length < 2) return '';
  const W = 240, H = 140, PX = W * 0.08, PY = H * 0.08;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of wps){
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const spanX = maxX - minX, spanY = maxY - minY;
  // Degenerate spans (straight N-S / E-W legs) collapse to the box center on
  // that axis rather than dividing by zero.
  const sx = p => spanX > 0 ? PX + ((p[0] - minX) / spanX) * (W - 2 * PX) : W / 2;
  const sy = p => spanY > 0 ? (H - PY) - ((p[1] - minY) / spanY) * (H - 2 * PY) : H / 2;
  const pts = wps.map(p => [sx(p), sy(p)]);

  // Cumulative screen-space length, for the 25/50/75% progress dots.
  const cum = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++){
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    cum.push(total);
  }
  let quarterDots = '';
  if (total > 0){
    for (const f of [0.25, 0.5, 0.75]){
      const target = f * total;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < target) i++;
      const segLen = cum[i] - cum[i - 1];
      const t = segLen > 0 ? (target - cum[i - 1]) / segLen : 0;
      const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t;
      const y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
      quarterDots += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="1.8" fill="#38bdf8"/>';
    }
  }

  const start = pts[0], end = pts[pts.length - 1];
  return (
    '<svg class="route-svg" viewBox="0 0 240 140" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="MISSION ROUTE SNAPSHOT">' +
      '<polyline points="' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '"' +
        ' fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      quarterDots +
      '<rect x="' + (start[0] - 3).toFixed(1) + '" y="' + (start[1] - 3).toFixed(1) + '" width="6" height="6" fill="#8b93a3"/>' +
      '<circle cx="' + end[0].toFixed(1) + '" cy="' + end[1].toFixed(1) + '" r="3" fill="#e8ecf4"/>' +
    '</svg>'
  );
}

function renderDebriefPanel(mission){
  const cfg = (typeof MISSIONS_CONFIG !== 'undefined' && MISSIONS_CONFIG[mission.type]) || { label: String(mission.type).toUpperCase() };
  const route = routeSvg(mission.waypoints);
  return (
    '<div class="lbl">Mission debrief</div>' +
    '<div class="rp-id">' + mission.id + '</div>' +
    '<div class="rp-name">' + cfg.label + '</div>' +
    '<div class="rp-kv"><span class="k">Dock</span><span class="v">' + mission.dockId + '</span></div>' +
    // Customer credit (flight-request missions only): the requester's short
    // code, mirroring the REQUESTED BY row in the exported report.
    (mission.requestedBy
      ? '<div class="rp-kv"><span class="k">Requested by</span><span class="v">' + escapeHtml(mission.requestedBy) + '</span></div>'
      : '') +
    '<div class="rp-kv"><span class="k">Duration</span><span class="v">' + fmtMMSS(mission.durationS) + '</span></div>' +
    '<div class="rp-kv"><span class="k">Distance</span><span class="v">' + (mission.distanceKm || 0).toFixed(1) + ' KM</span></div>' +
    (route
      ? '<div class="lbl" style="margin-top:16px">Route snapshot</div>' +
        '<div class="debrief-route">' + route + '</div>'
      : '') +
    '<div class="lbl" style="margin-top:16px">Mission analytics</div>' +
    analyticsDL(mission) +
    debriefVideoHTML(mission) +
    '<div class="rp-actions">' +
      '<button class="ghost" id="db-export">EXPORT REPORT</button>' +
    '</div>'
  );
}

// Printable report for the debrief's EXPORT REPORT button. Works from
// file:// — a blank about:blank popup is written synchronously, then printed.
// No external assets; the route SVG is inlined and the styling is print-first.
function missionReportHTML(mission){
  const cfg = (typeof MISSIONS_CONFIG !== 'undefined' && MISSIONS_CONFIG[mission.type]) || { label: String(mission.type).toUpperCase() };
  const a = mission.analytics || {};
  const rows = Object.keys(a).map(k =>
    '<tr><td>' + escapeHtml(humanizeKey(k)) + '</td><td>' + escapeHtml(formatAnalyticsValue(k, a[k])) + '</td></tr>'
  ).join('');
  const route = routeSvg(mission.waypoints);
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<title>SENTINEL REPORT · ' + escapeHtml(mission.id) + '</title>' +
    '<style>' +
      'body{font-family:ui-monospace,"SF Mono",Consolas,Menlo,monospace;color:#111;margin:40px;max-width:640px}' +
      'h1{font-size:14px;letter-spacing:.22em;margin:0 0 4px}' +
      '.brand{font-size:11px;letter-spacing:.18em;color:#555;margin-bottom:28px}' +
      'h2{font-size:11px;letter-spacing:.18em;color:#555;margin:26px 0 8px;text-transform:uppercase}' +
      'table{border-collapse:collapse;width:100%;font-size:12px}' +
      'td{border-bottom:1px solid #ddd;padding:7px 4px;text-transform:uppercase;letter-spacing:.06em}' +
      'td:last-child{text-align:right;font-weight:700}' +
      // Dark plate behind the route: the track/marker colors are picked for
      // the console's dark surfaces and must stay legible when printed.
      // print-color-adjust: browsers strip background colors when printing by
      // default, which would leave the pale route markers invisible on paper.
      '.route{border:1px solid #ddd;border-radius:6px;padding:10px;background:#0a0b0e;print-color-adjust:exact;-webkit-print-color-adjust:exact}' +
      '.foot{margin-top:32px;font-size:10px;letter-spacing:.14em;color:#888}' +
      '@media print{body{margin:16mm}}' +
    '</style></head><body>' +
    '<h1>SENTINEL &middot; SIMULATED OPERATIONS REPORT</h1>' +
    '<div class="brand">e&amp; &middot; GLOBAL COMMAND &amp; CONTROL &middot; DEMONSTRATION DATA ONLY</div>' +
    '<h2>Mission</h2>' +
    '<table>' +
      '<tr><td>MISSION ID</td><td>' + escapeHtml(mission.id) + '</td></tr>' +
      '<tr><td>TYPE</td><td>' + escapeHtml(cfg.label) + '</td></tr>' +
      '<tr><td>DOCK</td><td>' + escapeHtml(mission.dockId) + '</td></tr>' +
      (mission.requestedBy ? '<tr><td>REQUESTED BY</td><td>' + escapeHtml(mission.requestedBy) + '</td></tr>' : '') +
      '<tr><td>DURATION</td><td>' + fmtMMSS(mission.durationS) + '</td></tr>' +
      '<tr><td>DISTANCE</td><td>' + (mission.distanceKm || 0).toFixed(1) + ' KM</td></tr>' +
    '</table>' +
    (route ? '<h2>Route snapshot</h2><div class="route">' + route + '</div>' : '') +
    '<h2>Mission analytics</h2>' +
    (rows ? '<table>' + rows + '</table>' : '<p>NO ANALYTICS CAPTURED</p>') +
    '<div class="foot">GENERATED BY e&amp; SENTINEL CONSOLE &middot; ALL DATA SIMULATED</div>' +
    '<scr' + 'ipt>window.onload=function(){window.print();};</scr' + 'ipt>' +
    '</body></html>'
  );
}

function exportMissionReport(mission){
  let w = null;
  try { w = window.open('', '_blank'); } catch (e) { w = null; }
  if (!w){
    EC2.ui.pushEvent({ level: 'warn', source: 'OPS', message: 'EXPORT BLOCKED · ALLOW POPUPS' });
    return;
  }
  w.document.write(missionReportHTML(mission));
  w.document.close();
  w.focus();
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

function wireDebriefPanel(mission){
  const exportBtn = $('db-export');
  if (exportBtn && mission){
    exportBtn.addEventListener('click', () => exportMissionReport(mission));
  }

  const video = $('debrief-video');
  const canvasWrap = $('debrief-canvas-wrap');
  const canvas = $('debrief-canvas');
  if (video){
    // Ordered clip list for this mission (see debriefVideoHTML). Multi-clip
    // types play back-to-back as one continuous mission video.
    const playlist = (video.getAttribute('data-playlist') || '').split(',').filter(Boolean);
    let idx = 0;

    // When one segment ends, roll into the next; loop back to the first after
    // the last so the debrief keeps playing the full patrol during a demo.
    if (playlist.length > 1){
      video.addEventListener('ended', () => {
        idx = (idx + 1) % playlist.length;
        video.src = playlist[idx];
        video.play().catch(() => {}); // autoplay may be blocked; controls remain
      });
    }

    // A clip that fails to load must never surface a console error or a broken
    // player. With a playlist, skip past the missing segment; only fall back
    // to the animated placeholder once nothing in the list is playable (every
    // manifest entry 404s until real footage is dropped into videos/).
    let failures = 0;
    video.addEventListener('error', () => {
      failures++;
      if (playlist.length > 1 && failures < playlist.length){
        idx = (idx + 1) % playlist.length;
        video.src = playlist[idx];
        video.play().catch(() => {});
        return;
      }
      video.hidden = true;
      if (canvasWrap) canvasWrap.hidden = false;
      startDebriefPlaceholder(canvas);
    });
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
  return keys.map(k => humanizeKey(k) + ' ' + formatAnalyticsValue(k, a[k])).join(' · ');
}

// Poster thumbnail for a media card: first frame-ish (#t=0.8) of the FIRST
// clip of that mission type. preload="metadata" keeps 40 cards cheap — the
// browser only fetches enough to paint the poster frame. When the manifest
// has no clip for the type, no element is emitted (text-only card).
function mediaPosterHTML(type){
  const variants = (typeof VIDEO_MANIFEST !== 'undefined' && VIDEO_MANIFEST[type]) || [];
  if (!variants.length) return '';
  return '<video class="media-card-poster" preload="metadata" muted src="videos/' + variants[0] + '#t=0.8"></video>';
}

function renderMediaPanel(){
  if (!sessionMissions.length){
    return (
      '<div class="lbl">Media</div>' +
      '<div class="rp-empty">NO MISSIONS RECORDED YET &middot; CREATE ONE WITH + NEW MISSION</div>'
    );
  }
  const typesPresent = [];
  for (const m of sessionMissions){
    if (typesPresent.indexOf(m.type) === -1) typesPresent.push(m.type);
  }
  const chips =
    '<div class="media-filters" id="media-filters">' +
      '<button class="fchip on" data-mtype="ALL">ALL</button>' +
      typesPresent.map(t => {
        const cfg = (typeof MISSIONS_CONFIG !== 'undefined' && MISSIONS_CONFIG[t]) || { label: String(t).toUpperCase() };
        return '<button class="fchip" data-mtype="' + t + '">' + cfg.label + '</button>';
      }).join('') +
    '</div>';
  const cards = sessionMissions.map(m => {
    const cfg = (typeof MISSIONS_CONFIG !== 'undefined' && MISSIONS_CONFIG[m.type]) || { label: String(m.type).toUpperCase() };
    return (
      '<button class="media-card" data-mid="' + m.id + '" data-mtype="' + m.type + '">' +
        mediaPosterHTML(m.type) +
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
    chips +
    '<div class="media-grid">' + cards + '</div>'
  );
}

function wireMediaPanel(){
  const grid = document.querySelector('#rpanel-body .media-grid');
  if (grid) grid.addEventListener('click', (e) => {
    const card = e.target.closest('.media-card');
    if (!card) return;
    const mission = sessionMissions.find(m => m.id === card.dataset.mid);
    if (mission) openDebrief(mission);
  });

  // Type filter chips: pure client-side show/hide of the already-rendered
  // cards (no re-render, posters keep their loaded metadata).
  const filters = $('media-filters');
  if (filters) filters.addEventListener('click', (e) => {
    const chip = e.target.closest('.fchip');
    if (!chip) return;
    filters.querySelectorAll('.fchip').forEach(b => b.classList.remove('on'));
    chip.classList.add('on');
    const t = chip.dataset.mtype;
    document.querySelectorAll('#rpanel-body .media-card').forEach(card => {
      card.hidden = t !== 'ALL' && card.dataset.mtype !== t;
    });
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

// ---------- FLIGHT REQUESTS (customer tasking, R-4) ----------

// Everything here is hard-guarded against the engine lane being momentarily
// absent (engine boots on first dive-in; engine.requests lands in a parallel
// change): no engine / no requests Map simply renders the empty state.

const REQ_PRI_CLASS = { URGENT: 'urgent', PRIORITY: 'priority', ROUTINE: 'routine' };

function getRequest(id){
  const engine = window.__engine;
  return (engine && engine.requests && engine.requests.get(id)) || null;
}

function pendingRequests(){
  const engine = window.__engine;
  if (!engine || !engine.requests) return [];
  const out = [];
  for (const r of engine.requests.values()){
    if (r.status === 'pending') out.push(r);
  }
  out.sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0)); // newest first
  return out;
}

// Request age as 'T+M:SS' from sim time (engine.now - requestedAt).
function reqAgeStr(req){
  const engine = window.__engine;
  const now = engine ? engine.now : 0;
  return 'T+' + fmtETA(Math.max(0, now - (req.requestedAt || 0)));
}

function missionTypeLabel(type){
  const cfg = (typeof MISSIONS_CONFIG !== 'undefined' && MISSIONS_CONFIG[type]) || null;
  return cfg ? cfg.label : String(type).toUpperCase();
}

function reqRowHTML(req){
  const pri = String(req.priority || 'ROUTINE').toUpperCase();
  const priCls = REQ_PRI_CLASS[pri] || 'routine';
  return (
    '<button class="req-row" data-req="' + escapeHtml(req.id) + '">' +
      '<span class="req-head">' +
        '<span class="req-pri ' + priCls + '">' + escapeHtml(pri) + '</span>' +
        '<b class="req-cust">' + escapeHtml(req.customer) + '</b>' +
        '<span class="req-age" data-req-age="' + escapeHtml(req.id) + '">' + reqAgeStr(req) + '</span>' +
      '</span>' +
      '<span class="req-line">' + escapeHtml(missionTypeLabel(req.type)) + ' &middot; ' + escapeHtml(req.place) + '</span>' +
    '</button>'
  );
}

// Renders the FLIGHT REQUESTS left panel (#reqlist + #req-count badge).
// Same rebuild-vs-patch discipline as renderDockList: rows are rebuilt only
// when the pending id-set changes; otherwise only the T+ ages are patched in
// place, so hover/focus on a row survives the 2s poll.
function renderRequestList(force){
  const list = $('reqlist');
  if (!list) return;
  const pending = pendingRequests();

  const badge = $('req-count');
  if (badge){
    const n = String(pending.length);
    if (badge.textContent !== n) badge.textContent = n;
    badge.hidden = !pending.length;
  }

  const sig = pending.map(r => r.id).join(',');
  if (!force && sig === reqListSig && list.children.length){
    list.querySelectorAll('[data-req-age]').forEach(el => {
      const req = getRequest(el.getAttribute('data-req-age'));
      if (!req) return;
      const txt = reqAgeStr(req);
      if (el.textContent !== txt) el.textContent = txt;
    });
    return;
  }
  reqListSig = sig;

  if (!pending.length){
    list.innerHTML = '<div class="lbl empty-note">NO PENDING REQUESTS &middot; GRID AT READINESS</div>';
    return;
  }
  list.innerHTML = pending.map(reqRowHTML).join('');
}

// One delegated click listener on #reqlist: jump the map to the customer's
// coordinates and open the request review panel. Selection stays as-is —
// a request is not a map entity, so the review panel rides on the panel
// registry alone (looked up fresh by id on every render).
function wireRequestList(){
  const list = $('reqlist');
  if (!list) return;
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.req-row');
    if (!row || inCaptureMode()) return;
    const req = getRequest(row.dataset.req);
    if (!req) return;
    if (EC2.map && Array.isArray(req.coords)) EC2.map.flyTo({ center: req.coords, zoom: 12.2 });
    EC2.ui.setRightPanel('request', req.id);
  });
}

// REQUEST REVIEW right panel. data is the request ID (not the object) so
// every render reads the current status straight off the engine — a request
// approved/declined/fulfilled elsewhere renders read-only here. The hidden
// marker records the rendered status so refreshViewedRequest can detect a
// live status change and re-render.
function renderRequestPanel(reqId){
  const req = getRequest(reqId);
  if (!req){
    return (
      '<div class="lbl">Flight request</div>' +
      '<div class="rp-empty">REQUEST NOT FOUND &middot; MAY HAVE BEEN PRUNED</div>'
    );
  }
  const pri = String(req.priority || 'ROUTINE').toUpperCase();
  const priCls = REQ_PRI_CLASS[pri] || 'routine';
  const params = req.params || {};
  const wps = req.waypoints || [];
  const distKm = (typeof SimRouter !== 'undefined' && wps.length > 1) ? SimRouter.pathLengthKm(wps) : 0;
  const speed = Number(params.speedMs) || 0;
  const durS = speed > 0 ? (distKm * 1000) / speed : 0;
  const route = routeSvg(wps);
  const isPending = req.status === 'pending';
  return (
    '<div class="lbl">Flight request</div>' +
    '<div class="rp-id">' + escapeHtml(req.id) + '</div>' +
    '<div class="rp-name">' + escapeHtml(req.customerFull || req.customer) + '</div>' +
    '<div class="rp-emirate">' + escapeHtml(req.customer) + '</div>' +
    '<div class="state-chip req-pri-chip ' + priCls + '">' + escapeHtml(pri) + '</div>' +
    '<div class="rp-kv"><span class="k">Mission</span><span class="v">' + escapeHtml(missionTypeLabel(req.type)) + '</span></div>' +
    '<div class="rp-kv"><span class="k">Area</span><span class="v">' + escapeHtml(req.place) + '</span></div>' +
    '<div class="rp-kv"><span class="k">Requested</span><span class="v">' + reqAgeStr(req) + '</span></div>' +
    '<div class="rp-kv"><span class="k">Altitude</span><span class="v">' + (params.altM != null ? params.altM + ' M' : '&mdash;') + '</span></div>' +
    '<div class="rp-kv"><span class="k">Speed</span><span class="v">' + (params.speedMs != null ? params.speedMs + ' M/S' : '&mdash;') + '</span></div>' +
    '<div class="rp-kv"><span class="k">Assigned dock</span><span class="v">' + (req.dockId ? escapeHtml(req.dockId) : '&mdash;') + '</span></div>' +
    '<div class="rp-kv"><span class="k">Distance</span><span class="v">' + distKm.toFixed(1) + ' KM</span></div>' +
    '<div class="rp-kv"><span class="k">Est duration</span><span class="v">' + fmtMMSS(durS) + '</span></div>' +
    (route
      ? '<div class="lbl" style="margin-top:16px">Planned route</div>' +
        '<div class="debrief-route">' + route + '</div>'
      : '') +
    (isPending
      ? '<div class="rp-actions">' +
          '<button class="primary" id="req-approve">APPROVE &amp; LAUNCH</button>' +
          '<button class="ghost" id="req-decline">DECLINE</button>' +
        '</div>'
      : '<div class="state-chip req-status">' + escapeHtml(String(req.status).toUpperCase()) + '</div>') +
    '<span id="req-panel-marker" hidden data-req="' + escapeHtml(req.id) + '" data-status="' + escapeHtml(req.status) + '"></span>'
  );
}

// Re-renders the open request review panel when the viewed request's status
// no longer matches what was rendered (approved/declined/fulfilled elsewhere,
// or via this panel's own buttons). No-op when no request panel is showing.
// `requestId` (optional) limits the refresh to events about that request.
function refreshViewedRequest(requestId){
  const marker = $('req-panel-marker');
  if (!marker) return;
  const id = marker.dataset.req;
  if (requestId && requestId !== id) return;
  const req = getRequest(id);
  if (!req) return;
  if (req.status !== marker.dataset.status) EC2.ui.setRightPanel('request', id);
}

// Subscribes to engine events (same engine-poll pattern as wireDebriefWatch)
// so a new FLIGHT_REQUEST lands in the left panel immediately instead of
// waiting for the 2s poll — and any REQUEST_* resolution refreshes both the
// list and an open review panel.
function wireRequestWatch(){
  const trySubscribe = () => {
    if (!window.__engine || !window.__engine.onEvent) return false;
    window.__engine.onEvent((ev) => {
      const code = ev && ev.code ? String(ev.code) : '';
      if (code !== 'FLIGHT_REQUEST' && code.indexOf('REQUEST_') !== 0) return;
      renderRequestList(true);
      refreshViewedRequest(ev.extra && ev.extra.requestId);
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

    wireFpvFeed(); // start/chain the live mission downlink in the FPV frame

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
  } else if (mode === 'site' && data){
    const site = data;

    const locate = $('rp-site-locate');
    if (locate) locate.addEventListener('click', () => {
      if (EC2.map) EC2.map.flyTo({ center: site.coords, zoom: 14 });
    });

    const nearestBtn = $('rp-site-dock');
    if (nearestBtn) nearestBtn.addEventListener('click', () => {
      const near = nearestDockTo(site.coords);
      if (near) EC2.select({ type: 'dock', id: near.dock.id });
    });

    // Dispatch a live infrastructure inspection toward this tower from the
    // nearest AVAILABLE dock (launchPreset picks a ready, charged dock biased
    // to site.coords and flies an in-range 'infra' route). On success we jump
    // to and follow the launched drone so the operator watches it go; on
    // failure (no ready dock / no route) we surface a ticker advisory rather
    // than failing silently.
    const dispatch = $('rp-site-dispatch');
    if (dispatch) dispatch.addEventListener('click', () => {
      const engine = window.__engine;
      if (!engine || !engine.launchPreset){
        EC2.ui.pushEvent({ level: 'warn', source: site.id, message: 'INSPECTION UNAVAILABLE · ENGINE OFFLINE' });
        return;
      }
      try {
        const mission = engine.launchPreset('infra', { near: site.coords });
        EC2.ui.pushEvent({ level: 'info', source: site.id,
          message: 'INSPECTION DISPATCHED · ' + site.id + ' · FROM ' + mission.dockId });
        const droneId = 'D-' + mission.dockId;
        if (engine.drones.get(droneId)){
          EC2.followDroneId = droneId;
          EC2.select({ type: 'drone', id: droneId });
        }
      } catch (e){
        EC2.ui.pushEvent({ level: 'warn', source: site.id, message: 'NO DRONE AVAILABLE FOR INSPECTION' });
      }
    });
  } else if (mode === 'request' && data){
    const reqId = data;

    // APPROVE & LAUNCH: the engine creates and launches the pre-planned
    // mission (or throws, e.g. 'NO READY DOCK IN RANGE' — surfaced as a warn
    // chip, never a crash). On success the mission counts as user-created
    // (debrief auto-opens on completion) and the console jumps to follow the
    // launched drone.
    const approve = $('req-approve');
    if (approve) approve.addEventListener('click', () => {
      const engine = window.__engine;
      if (!engine || !engine.approveRequest){
        EC2.ui.pushEvent({ level: 'warn', source: 'OPS', message: 'REQUEST APPROVAL UNAVAILABLE · ENGINE OFFLINE' });
        return;
      }
      let mission = null;
      try {
        mission = engine.approveRequest(reqId);
      } catch (err){
        EC2.ui.pushEvent({ level: 'warn', source: 'OPS',
          message: 'REQUEST APPROVAL FAILED · ' + (err && err.message ? err.message : 'UNKNOWN') });
        EC2.ui.setRightPanel('request', reqId); // re-render current status
        return;
      }
      if (!mission) return;
      if (EC2.control && EC2.control.userMissions) EC2.control.userMissions.add(mission.id);
      renderRequestList(true); // pending set changed
      const droneId = 'D-' + mission.dockId;
      EC2.followDroneId = droneId;
      EC2.select({ type: 'drone', id: droneId });
    });

    const decline = $('req-decline');
    if (decline) decline.addEventListener('click', () => {
      const engine = window.__engine;
      if (engine && engine.declineRequest) engine.declineRequest(reqId);
      renderRequestList(true);
      EC2.ui.setRightPanel('empty');
    });
  } else if (mode === 'debrief' && data){
    wireDebriefPanel(data);
  } else if (mode === 'media'){
    wireMediaPanel();
  } else {
    // Default / 'empty' mode is the OPS DIGEST: one delegated listener on the
    // missions list (rows are re-rendered by updateOpsDigest whenever the
    // mission set changes, so per-row listeners would go stale).
    const digestList = $('digest-missions');
    if (digestList) digestList.addEventListener('click', (e) => {
      const row = e.target.closest('.digest-row');
      if (!row || inCaptureMode()) return;
      const droneId = row.dataset.drone;
      const drone = window.__engine && window.__engine.drones.get(droneId);
      if (drone && drone.state !== 'docked') EC2.select({ type: 'drone', id: droneId });
    });
  }
}

// ---------- dock list ----------

// Search input + ID/BATT/STATE sort segment, JS-injected once above
// #docklist inside the .side-docklist panel (index.html stays untouched).
function injectDockListControls(){
  const list = $('docklist');
  if (!list || $('dock-tools')) return;
  const wrap = document.createElement('div');
  wrap.id = 'dock-tools';
  wrap.innerHTML =
    '<input type="search" id="dock-search" class="dock-search" placeholder="SEARCH DOCKS"' +
      ' autocomplete="off" spellcheck="false" aria-label="Search docks">' +
    '<div class="dock-sort" id="dock-sort" role="group" aria-label="Sort docks">' +
      '<button data-sort="ID" class="on">ID</button>' +
      '<button data-sort="BATT">BATT</button>' +
      '<button data-sort="STATE">STATE</button>' +
    '</div>';
  list.parentNode.insertBefore(wrap, list);

  $('dock-search').addEventListener('input', (e) => {
    dockSearch = String(e.target.value || '').trim().toLowerCase();
    EC2.ui.renderDockList();
  });
  $('dock-sort').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-sort]');
    if (!btn) return;
    e.currentTarget.querySelectorAll('button').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    dockSort = btn.dataset.sort;
    EC2.ui.renderDockList();
  });
}

function dockMatchesSearch(d){
  if (!dockSearch) return true;
  const hay = (d.id + ' ' + d.name + ' ' + d.emirate + ' ' + (EMIRATE_NAMES[d.emirate] || '')).toLowerCase();
  return hay.indexOf(dockSearch) !== -1;
}

// STATE sort order per spec: fault (incl. offline) first, then charging,
// ready, and away (any flying state) last.
function dockStateRank(state){
  if (ALERT_STATES.includes(state)) return 0;
  if (state === 'charging') return 1;
  if (state === 'ready') return 2;
  return 3; // launching / drone-away / landing — "away"
}

const EMIRATE_ORDER = Object.keys(EMIRATE_NAMES);

// The current filter+search+sort applied to DATA_DOCKS, returned in final
// render order (ID sort additionally clusters by emirate so the group
// headers come out contiguous).
function dockListRows(){
  const rows = DATA_DOCKS.filter(d => {
    if (!dockMatchesSearch(d)) return false;
    if (currentFilter === 'ALL') return true;
    if (currentFilter === 'FLYING') return FLYING_STATES.includes(stateFor(d));
    if (currentFilter === 'ALERTS') return ALERT_STATES.includes(stateFor(d));
    return d.emirate === currentFilter;
  });
  if (dockSort === 'BATT'){
    // Lowest charge first — the rows an operator needs to see are the ones
    // closest to unavailable.
    rows.sort((a, b) => (batteryFor(a.id) - batteryFor(b.id)) || a.id.localeCompare(b.id));
  } else if (dockSort === 'STATE'){
    rows.sort((a, b) => (dockStateRank(stateFor(a)) - dockStateRank(stateFor(b))) || a.id.localeCompare(b.id));
  } else {
    rows.sort((a, b) => {
      const ea = EMIRATE_ORDER.indexOf(a.emirate), eb = EMIRATE_ORDER.indexOf(b.emirate);
      return (ea - eb) || a.id.localeCompare(b.id);
    });
  }
  return rows;
}

function buildDockRow(d, selDockId){
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
    // A wizard or manual-control session mid-flight owns the map/panel;
    // switching the selection out from under it would strand or lose
    // that in-progress state. Block the row and surface why briefly.
    if (inCaptureMode()){
      row.title = 'EXIT CURRENT MODE FIRST';
      setTimeout(() => { row.title = ''; }, 2000);
      return;
    }
    const drone = window.__engine && window.__engine.drones.get('D-' + d.id);
    if (drone && drone.state !== 'docked'){
      EC2.select({ type: 'drone', id: drone.id });
    } else {
      EC2.select({ type: 'dock', id: d.id });
    }
  });
  return row;
}

// In-place refresh of the live cells (battery %, alert dot) for every row
// already in the DOM — the no-rebuild path the 2s poll takes when nothing
// structural changed. The .batt width/text change is cheap; listeners,
// focus and scroll all survive.
function patchDockRows(list){
  list.querySelectorAll('.dock-row').forEach(row => {
    const d = dockIndex.get(row.dataset.dockId);
    if (!d) return;
    const battEl = row.querySelector('.batt');
    if (battEl){
      const txt = batteryFor(d.id) + '%';
      if (battEl.textContent !== txt) battEl.textContent = txt;
    }
    const sd = row.querySelector('.sd');
    if (sd) sd.classList.toggle('alert', ALERT_STATES.includes(stateFor(d)));
  });
}

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

// ---------- event ribbon (ticker) behaviour ----------

// Horizontal gap between ticker chips — mirrors #tickstream's CSS `gap` so
// prepend compensation (below) keeps a hovered/scrolled view from jumping when
// a new event arrives at the left edge.
const TICK_GAP = 22;

// True when an event's source names a live drone entity in the engine. Drone
// events carry ev.source === the drone id ('D-<dockId>'); dock/OPS/site events
// don't, so they stay non-interactive in the ribbon.
function eventDroneId(source){
  return (source && window.__engine && window.__engine.drones && window.__engine.drones.has(source))
    ? source : null;
}

// Click-through from a ticker chip to its drone: only navigates when that drone
// is still airborne (state !== 'docked'); a landed/past drone does nothing, per
// spec. Yields to an in-progress wizard/manual session so it can't yank the map.
function focusDroneFromEvent(droneId){
  if (inCaptureMode()) return;
  const engine = window.__engine;
  const drone = engine && engine.drones.get(droneId);
  if (!drone || drone.state === 'docked') return;
  EC2.followDroneId = droneId;
  EC2.select({ type: 'drone', id: droneId });
  if (EC2.map && Array.isArray(drone.pos)){
    EC2.map.easeTo({ center: drone.pos, zoom: 12.5, duration: 600 });
  }
}

// Re-tags one drone chip as live (is-active, colorized + clickable) or past
// (is-past, dimmed) from the drone's CURRENT state — so as drones launch and
// land the ribbon's colors track reality, not just the moment each line fired.
function applyDroneActivity(el){
  const id = el.dataset.drone;
  if (!id) return;
  const engine = window.__engine;
  const drone = engine && engine.drones.get(id);
  const active = !!(drone && drone.state !== 'docked');
  el.classList.toggle('is-active', active);
  el.classList.toggle('is-past', !active);
}

// Continuous auto-scroll for the event ribbon + periodic recolor. The drift
// gives the "always alive" ticker feel; hovering pauses it so a line can be
// read/clicked. Loops back to the newest (scrollLeft 0) at the end.
let tickerDriverStarted = false;
function startTickerDriver(){
  if (tickerDriverStarted) return;
  const stream = $('tickstream');
  if (!stream) return;
  tickerDriverStarted = true;

  let paused = false;
  stream.addEventListener('mouseenter', () => { paused = true; });
  stream.addEventListener('mouseleave', () => { paused = false; });

  const SPEED = 0.35; // px/frame — a calm national-grid crawl, not a stock ticker
  function frame(){
    requestAnimationFrame(frame);
    if (paused) return;
    const max = stream.scrollWidth - stream.clientWidth;
    if (max <= 4) return;
    stream.scrollLeft += SPEED;
    if (stream.scrollLeft >= max - 1) stream.scrollLeft = 0;
  }
  requestAnimationFrame(frame);

  setInterval(() => {
    const chips = stream.querySelectorAll('.tick-ev[data-drone]');
    for (const el of chips) applyDroneActivity(el);
  }, 1000);
}

// ---------- stat count-up tween (setStats) ----------

// Animates a stat number to its new value over ~400ms in integer steps.
// Finish-safe by construction: rAF can be throttled (background tab,
// low-power mode), so every NEW tweenStat call on an element first clamps
// any in-flight tween straight to its old target before animating again —
// a stat can therefore never get stuck between values for more than one
// setStats cycle. Values only animate when they actually changed.
const statTweens = new Map(); // el -> { target, raf }
const STAT_TWEEN_MS = 400;

function tweenStat(el, value){
  if (!el) return;
  const goal = Math.round(Number(value));
  if (!Number.isFinite(goal)){ el.textContent = String(value); return; }

  const inFlight = statTweens.get(el);
  if (inFlight){
    cancelAnimationFrame(inFlight.raf);
    statTweens.delete(el);
    el.textContent = String(inFlight.target); // clamp to target regardless of rAF progress
  }

  const from = parseInt(el.textContent, 10);
  if (!Number.isFinite(from) || from === goal){
    el.textContent = String(goal);
    return;
  }

  const start = performance.now();
  const state = { target: goal, raf: 0 };
  statTweens.set(el, state);
  function step(ts){
    const k = Math.min(1, (ts - start) / STAT_TWEEN_MS);
    el.textContent = String(Math.round(from + (goal - from) * k));
    if (k < 1){
      state.raf = requestAnimationFrame(step);
    } else {
      statTweens.delete(el);
    }
  }
  state.raf = requestAnimationFrame(step);
}

// ---------- EC2.ui ----------

EC2.ui = {
  panelRenderers: {
    empty: renderEmptyPanel,
    dock: renderDockPanel,
    drone: renderDronePanel,
    site: renderSitePanel,
    debrief: renderDebriefPanel,
    media: renderMediaPanel,
    request: renderRequestPanel
  },

  setStats(o){
    if (o.ready != null) tweenStat($('st-ready'), o.ready);
    if (o.flying != null) tweenStat($('st-flying'), o.flying);
    if (o.charge != null) tweenStat($('st-charge'), o.charge);
    if (o.alert != null) tweenStat($('st-alert'), o.alert);
    if (o.airborne != null){
      const b = $('c-air').querySelector('b');
      if (b) tweenStat(b, o.airborne);
    }
    if (o.alerts != null){
      const chip = $('c-alerts');
      const b = chip.querySelector('b');
      if (b) tweenStat(b, o.alerts);
      chip.hidden = !o.alerts;
    }
  },

  renderDockList(filter){
    if (filter) currentFilter = filter;
    const list = $('docklist');
    if (!list) return;
    injectDockListControls();

    const rows = dockListRows();
    // Signature of everything that shapes the DOM structure/order. While it's
    // unchanged (the overwhelmingly common 2s-refresh case) only the live
    // battery/state cells are patched in place — no DOM rebuild, listeners
    // and scroll position survive. Any filter/search/sort/membership/order
    // change rebuilds.
    const sig = currentFilter + '|' + dockSearch + '|' + dockSort + '|' + rows.map(d => d.id).join(',');
    if (sig === dockListSig && list.children.length){
      patchDockRows(list);
      return;
    }
    dockListSig = sig;
    list.innerHTML = '';

    if (!rows.length){
      const note = document.createElement('div');
      note.className = 'lbl empty-note';
      note.textContent = 'NO DOCKS MATCH THIS FILTER';
      list.appendChild(note);
      return;
    }

    const selDockId = selectedDockId();
    // Grouped by emirate (with small headers) only in ID sort; BATT/STATE
    // render flat since their order cuts across emirates.
    let lastEmirate = null;
    for (const d of rows){
      if (dockSort === 'ID' && d.emirate !== lastEmirate){
        lastEmirate = d.emirate;
        const head = document.createElement('div');
        head.className = 'lbl dock-group';
        head.textContent = d.emirate + ' · ' + String(EMIRATE_NAMES[d.emirate] || d.emirate).toUpperCase();
        list.appendChild(head);
      }
      list.appendChild(buildDockRow(d, selDockId));
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
    // A drone-sourced event gets a data-drone tag so it can be recolored (live
    // vs past) and click-through to that drone. An explicit ev.onClick (e.g. a
    // debrief chip) still takes precedence over the drone jump.
    const droneId = eventDroneId(ev.source);
    const el = document.createElement('span');
    el.className = 'tick-ev' + level + (ev.onClick ? ' clickable' : '') + (droneId ? ' drone-ev' : '');
    if (droneId) el.dataset.drone = droneId;
    el.innerHTML =
      '<span class="tt">' + time + '</span>' +
      '<span class="src">' + escapeHtml(ev.source) + '</span>' +
      '<span class="msg">' + escapeHtml(ev.message) + '</span>';
    if (typeof ev.onClick === 'function') el.addEventListener('click', ev.onClick);
    else if (droneId) el.addEventListener('click', () => focusDroneFromEvent(droneId));
    stream.insertBefore(el, stream.firstChild);
    if (droneId) applyDroneActivity(el); // colorize immediately from current state
    // Keep a scrolled/hovered view steady: a chip added at the left edge would
    // otherwise shift everything right under the reader. Only compensate when
    // not parked at the newest end (scrollLeft 0), so the live newest stays put.
    if (stream.scrollLeft > 0) stream.scrollLeft += el.offsetWidth + TICK_GAP;
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
    // Same for the OPS DIGEST's 1 Hz refresher — restarted below only when
    // the empty/digest panel is actually the one showing.
    if (digestTimer){ clearInterval(digestTimer); digestTimer = null; }
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
    } else if (!EC2.ui.panelRenderers[mode] || mode === 'empty'){
      // OPS DIGEST live-refresh (1 Hz, flicker-free patching — see
      // updateOpsDigest). Covers both an explicit 'empty' and any unknown
      // mode that fell back to the empty renderer above.
      digestTimer = setInterval(updateOpsDigest, 1000);
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

  // OPS: back to the ops digest (the default/empty right panel). Clears the
  // selection and any FOLLOW camera; exits capture modes first (same courtesy
  // as the MEDIA button) so the wizard/manual overlays never get stranded.
  const opsBtn = $('btn-ops');
  if (opsBtn) opsBtn.addEventListener('click', () => {
    if (EC2.control && EC2.control.mode === 'manual') EC2.control.exitManual();
    if (EC2.control && EC2.control.mode === 'wizard') EC2.control.exitWizard();
    EC2.state.selection = null;
    updateRowSelection();
    EC2.followDroneId = null;
    EC2.ui.setRightPanel('empty');
  });

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
    updateTimescalePill();
  });
}

// Floating "4× SIM TIME" pill over the map whenever the sim runs faster than
// real time — created lazily on first use, hidden again at 1× and outside
// the console scene (wireScene keeps it honest across scene switches).
function updateTimescalePill(){
  let pill = $('timescale-pill');
  if (!pill){
    pill = document.createElement('div');
    pill.id = 'timescale-pill';
    pill.hidden = true;
    document.body.appendChild(pill);
  }
  const ts = Number(EC2.state.timeScale) || 1;
  const show = ts > 1 && EC2.state.scene === 'console';
  pill.textContent = ts + '× SIM TIME';
  pill.hidden = !show;
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

// Left/right panels collapse to their own screen edge, leaving a small handle
// tab behind to reopen. State lives as body classes (side-collapsed /
// rpanel-collapsed) that the CSS keys off; the handle's aria-expanded/label
// track it for assistive tech.
function wirePanelToggles(){
  [['side-toggle', 'side-collapsed', 'left'],
   ['rpanel-toggle', 'rpanel-collapsed', 'right']].forEach(([btnId, cls, side]) => {
    const btn = $(btnId);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const collapsed = document.body.classList.toggle(cls);
      btn.setAttribute('aria-expanded', String(!collapsed));
      const verb = collapsed ? 'Expand' : 'Collapse';
      btn.title = verb + ' panel';
      btn.setAttribute('aria-label', verb + ' ' + side + ' panel');
    });
  });
}

function wireScene(){
  const chromeEls = [$('topbar'), $('side'), $('rpanel'), $('ticker'),
                     $('side-toggle'), $('rpanel-toggle')].filter(Boolean);
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
    updateTimescalePill(); // pill only ever shows over the console map
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

  // Coverage rings as a big, forgiving click target. A dock/site dot is only
  // a few px wide — hard to hit on a projector — so a click anywhere inside a
  // location's coverage circle selects that location too. The precise dot /
  // drone handlers above still win when the click actually lands on one (we
  // bail here if any of them is under the cursor), so this only ever fills in
  // the empty area of a ring. When rings overlap, a site ring (smaller, more
  // specific) is preferred over a dock ring beneath it.
  const DOT_LAYERS = ['docks-dots', 'sites-dots', 'drones-layer'];
  EC2.map.on('click', 'coverage-fill', (e) => {
    if (inCaptureMode()) return;
    const onDot = EC2.map.queryRenderedFeatures(e.point,
      { layers: DOT_LAYERS.filter(id => EC2.map.getLayer(id)) });
    if (onDot && onDot.length) return; // let the precise dot handler take it
    const feats = e.features || [];
    const pick = feats.find(f => f.properties && f.properties.kind === 'site') || feats[0];
    if (!pick || !pick.properties) return;
    if (pick.properties.kind === 'site') EC2.select({ type: 'site', id: pick.properties.id });
    else EC2.select({ type: 'dock', id: pick.properties.id });
  });
  EC2.map.on('mousemove', 'coverage-fill', (e) => {
    if (inCaptureMode()) return;
    // Don't fight the dot handlers' pointer; only assert it over open ring area.
    const onDot = EC2.map.queryRenderedFeatures(e.point,
      { layers: DOT_LAYERS.filter(id => EC2.map.getLayer(id)) });
    if (!onDot || !onDot.length) EC2.map.getCanvas().style.cursor = 'pointer';
  });
  EC2.map.on('mouseleave', 'coverage-fill', () => { if (!inCaptureMode()) EC2.map.getCanvas().style.cursor = ''; });
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
  wirePanelToggles();
  wireMapDockInteractions();
  startFollowDriver();
  startTickerDriver();
  wireDebriefWatch();
  wireRequestList();
  wireRequestWatch();
  renderRequestList(); // paints the empty state until the engine spawns requests
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
    // Flight requests ride the same 2s driver: ages patch in place, rows
    // rebuild only when the pending set changes, and an open review panel
    // re-renders if its request's status moved (safety net under the
    // event-driven refresh in wireRequestWatch).
    renderRequestList();
    refreshViewedRequest();
    if (EC2.refreshCounts) EC2.refreshCounts(window.__engine);
  }, 2000);
};
})();
