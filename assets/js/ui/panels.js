(function(){
const EMIRATE_NAMES = {
  AUH:'Abu Dhabi', DXB:'Dubai', SHJ:'Sharjah', AJM:'Ajman',
  UAQ:'Umm Al Quwain', RAK:'Ras Al Khaimah', FUJ:'Fujairah', AAN:'Al Ain'
};

let dockIndex = null;
let currentFilter = 'ALL';

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

function batteryFor(id){ return 85 + (hashStr(id) % 15); } // 85..99

// Sim engine (Task 9) will drive real per-dock state; every dock is
// 'ready' until then, so FLYING/ALERTS filters legitimately return none.
function stateFor(/* dock */){ return 'ready'; }

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

function wireRightPanelActions(mode, data){
  if (mode === 'dock' && data){
    const locate = $('rp-locate');
    if (locate) locate.addEventListener('click', () => {
      if (EC2.map) EC2.map.flyTo({ center: data.coords, zoom: 14 });
    });
  }
}

// ---------- dock list ----------

function updateRowSelection(){
  const list = $('docklist');
  if (!list) return;
  const sel = EC2.state.selection;
  list.querySelectorAll('.dock-row').forEach(row => {
    row.classList.toggle('sel', !!sel && sel.type === 'dock' && row.dataset.dockId === sel.id);
  });
}

// ---------- EC2.ui ----------

EC2.ui = {
  panelRenderers: {
    empty: renderEmptyPanel,
    dock: renderDockPanel
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
      if (currentFilter === 'FLYING') return stateFor(d) === 'flying';
      if (currentFilter === 'ALERTS') return stateFor(d) === 'alert';
      return d.emirate === currentFilter;
    });

    if (!rows.length){
      const note = document.createElement('div');
      note.className = 'lbl empty-note';
      note.textContent = 'NO DOCKS MATCH THIS FILTER';
      list.appendChild(note);
      return;
    }

    const sel = EC2.state.selection;
    for (const d of rows){
      const battery = batteryFor(d.id);
      const row = document.createElement('button');
      row.className = 'dock-row' + ((sel && sel.type === 'dock' && sel.id === d.id) ? ' sel' : '');
      row.dataset.dockId = d.id;
      row.innerHTML =
        '<span class="sd"></span>' +
        '<span class="di"><b>' + d.id + '</b><i>' + d.name + '</i></span>' +
        '<span class="dr"><span class="model">' + d.model + '</span><span class="batt">' + battery + '%</span></span>';
      row.addEventListener('click', () => EC2.select({ type: 'dock', id: d.id }));
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
    const renderer = EC2.ui.panelRenderers[mode] || EC2.ui.panelRenderers.empty;
    const body = $('rpanel-body');
    if (!body) return;
    body.innerHTML = renderer(data);
    wireRightPanelActions(mode, data);
  }
};

// ---------- selection ----------

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
  }
  // type 'drone' arrives with drone telemetry (Task 10).
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
  EC2.onSceneChange(scene => setVisible(scene === 'console'));
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
}

EC2.initPanels = function(){
  buildDockIndex();
  wireTopbar();
  wireFilters();
  wireClock();
  wireScene();
  wireMapDockInteractions();
  EC2.ui.renderDockList('ALL');
  EC2.ui.setRightPanel('empty');
  // Static plausible grid snapshot; sim engine (Task 9) drives this via setStats.
  EC2.ui.setStats({ ready: 81, flying: 17, charge: 4, alert: 2 });
};
})();
