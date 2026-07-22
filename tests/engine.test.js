// tests/engine.test.js
const test = require('node:test');
const assert = require('node:assert');
require('../assets/js/sim/router.js');
require('../assets/js/data/docks.js');
require('../assets/js/data/geo-uae.js');
require('../assets/js/data/missions-config.js');
require('../assets/js/sim/engine.js');

function mk(){ return globalThis.SimEngine.create({
  docks: globalThis.DATA_DOCKS, roads: globalThis.GEO_UAE.roads }); }

test('boots with all docks ready, none airborne', () => {
  const e = mk();
  assert.strictEqual(e.docks.size, 104);
  assert.strictEqual([...e.drones.values()].filter(d=>d.state!=='docked').length, 0);
});
test('scheduler reaches airborne target', () => {
  const e = mk();
  for (let i=0;i<600;i++) e.tick(1);         // 10 sim minutes
  const air = [...e.drones.values()].filter(d=>!['docked'].includes(d.state)).length;
  assert.ok(air >= 10, 'airborne='+air);
});
test('mission lifecycle completes and yields analytics', () => {
  const e = mk();
  const m = e.createMission({ type:'highway', dockId:'DXB-001',
    waypoints: globalThis.SimRouter.corridor(
      globalThis.GEO_UAE.roads.features[1].geometry.coordinates, 0.1, 8),
    params:{ altM:100, speedMs:15 } });
  let done=false; e.onEvent(ev=>{ if(ev.message.includes(m.id)&&ev.message.includes('COMPLETE')) done=true; });
  for (let i=0;i<7200 && m.state!=='complete'; i++) e.tick(1);
  assert.strictEqual(m.state, 'complete');
  assert.ok(m.analytics.vehiclesFlagged >= 0);
});
test('battery floor forces RTB', () => {
  const e = mk();
  const m = e.createMission({ type:'security', dockId:'AUH-001',
    waypoints: globalThis.SimRouter.perimeter([54.35,24.47], 3000, 8),
    params:{ altM:80, speedMs:10 } });
  const d = [...e.drones.values()].find(x=>x.missionId===m.id);
  d.battery = 26;
  for (let i=0;i<300;i++) e.tick(1);
  assert.ok(['rtb','landing','docked'].includes(d.state));
});
test('drones never leave UAE bbox', () => {
  const e = mk();
  for (let i=0;i<1800;i++) e.tick(1);
  for (const d of e.drones.values()){
    assert.ok(d.pos[0]>51 && d.pos[0]<56.7 && d.pos[1]>22.4 && d.pos[1]<26.4, d.id);
  }
});

// ---- Task 10: commandRTB / commandHold ----

test('commandRTB from on-task ends in docked eventually', () => {
  const e = mk();
  const m = e.createMission({ type:'security', dockId:'AUH-001',
    waypoints: globalThis.SimRouter.perimeter([54.35,24.47], 3000, 8),
    params:{ altM:80, speedMs:10 } });
  const d = [...e.drones.values()].find(x=>x.missionId===m.id);
  for (let i=0;i<600 && d.state !== 'on-task'; i++) e.tick(1);
  assert.strictEqual(d.state, 'on-task');

  assert.ok(e.commandRTB(d.id));
  assert.strictEqual(d.state, 'rtb');

  for (let i=0;i<3600 && d.state !== 'docked'; i++) e.tick(1);
  assert.strictEqual(d.state, 'docked');
});

test('commandHold freezes progress while battery drains, resume continues', () => {
  const e = mk();
  const m = e.createMission({ type:'security', dockId:'DXB-001',
    waypoints: globalThis.SimRouter.perimeter([55.263,25.185], 3000, 8),
    params:{ altM:80, speedMs:10 } });
  const d = [...e.drones.values()].find(x=>x.missionId===m.id);
  for (let i=0;i<600 && d.state !== 'on-task'; i++) e.tick(1);
  assert.strictEqual(d.state, 'on-task');
  for (let i=0;i<5;i++) e.tick(1);

  assert.ok(e.commandHold(d.id, true));
  assert.strictEqual(d.state, 'hold');
  const progressAtHold = m.progress;
  const battAtHold = d.battery;

  for (let i=0;i<20;i++) e.tick(1);
  assert.strictEqual(m.progress, progressAtHold, 'progress must stay frozen while held');
  assert.ok(d.battery < battAtHold, 'battery must keep draining while held');

  assert.ok(e.commandHold(d.id, false));
  assert.strictEqual(d.state, 'on-task');
  for (let i=0;i<20;i++) e.tick(1);
  assert.ok(m.progress > progressAtHold, 'progress should advance again after resume');
});
