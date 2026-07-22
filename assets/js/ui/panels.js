(function(){
const EMIRATE_NAMES = {
  AUH:'Abu Dhabi', DXB:'Dubai', SHJ:'Sharjah', AJM:'Ajman',
  UAQ:'Umm Al Quwain', RAK:'Ras Al Khaimah', FUJ:'Fujairah', AAN:'Al Ain'
};

let dockIndex = null;
let currentFilter = 'ALL';

// 2 Hz live-refresh timer for the 'drone' right-panel mode. Tracked at
// module scope so every setRightPanel() call can clear the previous one
// before possibly starting a new one — the one leak this task explicitly
// calls out to avoid.
let droneTeleTimer = null;

const DRONE_STATE_LABELS = {
  takeoff: 'TAKEOFF', transit: 'TRANSIT', 'on-task': 'ON TASK',
  rtb: 'RETURN TO DOCK', landing: 'LANDING', hold: 'HELD', docked: 'DOCKED'
};

function $(id){ return document.getElementById(id); }

function buildDockIndex(){
  dockIndex = new Map();
  DATA_DOCKS.forEach(d => dockIndex.set(d.id, d));
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
  return (
    '<div class="rp-id">' + dock.id + '</div>' +
    '<div class="rp-name">' + dock.name + '</div>' +
    '<div class="rp-emirate">' + emirate + '</div>' +
    '<div class="rp-kv"><span class="k">Drone model</span><span class="v">' + dock.model + '</span></div>' +
    '<div class="rp-kv"><span class="k">Battery</span><span class="v">' + battery + '%</span></div>' +
    '<div class="batt-bar"><i style="width:' + battery + '%"></i></div>' +
    '<div class="state-chip">' + state.toUpperCase() + '</div>' +
    '<div class="rp-actions">' +
      '<button class="primary" id="rp-launch" disabled title="AVAILABLE AFTER MISSION WIZARD TASK">LAUNCH MISSION</button>' +
      '<button class="ghost" id="rp-locate">LOCATE</button>' +
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
      '<button class="ghost" id="rp-control" disabled title="AVAILABLE AFTER MANUAL CONTROL TASK">TAKE CONTROL</button>' +
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
}

function wireRightPanelActions(mode, data){
  if (mode === 'dock' && data){
    const locate = $('rp-locate');
    if (locate) locate.addEventListener('click', () => {
      if (EC2.map) EC2.map.flyTo({ center: data.coords, zoom: 14 });
    });
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
    drone: renderDronePanel
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

  pushEvent(ev){
    const stream = $('tickstream');
    if (!stream) return;
    const level = ev.level === 'warn' ? ' warn' : ev.level === 'alert' ? ' alert' : '';
    const time = ev.time || nowClockStr();
    const el = document.createElement('span');
    el.className = 'tick-ev' + level;
    el.innerHTML =
      '<span class="tt">' + time + '</span>' +
      '<span class="src">' + ev.source + '</span>' +
      '<span class="msg">' + ev.message + '</span>';
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
  }
};

// ---------- wiring ----------

function wireTopbar(){
  const globeBtn = $('btn-globe');
  if (globeBtn) globeBtn.addEventListener('click', () => EC2.exitToOrbit());

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
      EC2.followDroneId = null;
      EC2.state.selection = null;
      EC2.ui.setRightPanel('empty'); // also clears droneTeleTimer
    }
  });
}

function wireMapDockInteractions(){
  if (!EC2.map) return;
  EC2.map.on('click', 'docks-dots', (e) => {
    const f = e.features && e.features[0];
    if (!f) return;
    EC2.select({ type: 'dock', id: f.properties.id });
  });
  EC2.map.on('mouseenter', 'docks-dots', () => { EC2.map.getCanvas().style.cursor = 'pointer'; });
  EC2.map.on('mouseleave', 'docks-dots', () => { EC2.map.getCanvas().style.cursor = ''; });

  // Airborne drone triangles (Task 10) — click selects the drone itself;
  // camera stays put here, FOLLOW (if toggled on) drives the camera instead.
  EC2.map.on('click', 'drones-layer', (e) => {
    const f = e.features && e.features[0];
    if (!f) return;
    EC2.select({ type: 'drone', id: f.properties.id });
  });
  EC2.map.on('mouseenter', 'drones-layer', () => { EC2.map.getCanvas().style.cursor = 'pointer'; });
  EC2.map.on('mouseleave', 'drones-layer', () => { EC2.map.getCanvas().style.cursor = ''; });
}

EC2.initPanels = function(){
  buildDockIndex();
  wireTopbar();
  wireFilters();
  wireClock();
  wireScene();
  wireMapDockInteractions();
  startFollowDriver();
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
