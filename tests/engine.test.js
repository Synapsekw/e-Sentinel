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
  // In-range route (createMission now rejects waypoints outside the dock's
  // coverage ring, contract C-1) — DXB-001 is urban, 3 km radius.
  const m = e.createMission({ type:'highway', dockId:'DXB-001',
    waypoints: globalThis.SimRouter.perimeter([55.263,25.185], 2500, 8),
    params:{ altM:100, speedMs:15 } });
  let done=false; e.onEvent(ev=>{ if(ev.message.includes(m.id)&&ev.message.includes('COMPLETE')) done=true; });
  for (let i=0;i<7200 && m.state!=='complete'; i++) e.tick(1);
  assert.strictEqual(m.state, 'complete');
  assert.ok(m.analytics.vehiclesFlagged >= 0);
});
test('battery floor forces RTB', () => {
  const e = mk();
  const m = e.createMission({ type:'security', dockId:'AUH-001',
    waypoints: globalThis.SimRouter.perimeter([54.349,24.477], 2800, 8),
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
    waypoints: globalThis.SimRouter.perimeter([54.349,24.477], 2800, 8),
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

// ---- Task 11: setManual / manualGoto / manualQueue / nudgeAlt ----

test('setManual engages from on-task, flies to a click-to-go target, then hovers on arrival', () => {
  const e = mk();
  const m = e.createMission({ type:'security', dockId:'AUH-001',
    waypoints: globalThis.SimRouter.perimeter([54.349,24.477], 2800, 8),
    params:{ altM:80, speedMs:10 } });
  const d = [...e.drones.values()].find(x=>x.missionId===m.id);
  for (let i=0;i<600 && d.state !== 'on-task'; i++) e.tick(1);
  assert.strictEqual(d.state, 'on-task');

  assert.ok(e.setManual(d.id, true));
  assert.strictEqual(d.state, 'manual');
  assert.strictEqual(d.speedMs, 0, 'should start hovering with an empty queue');

  // Target halfway back toward the home dock — guaranteed inside the
  // coverage ring, so the new manualGoto range clamp leaves it untouched.
  const dock = e.docks.get(d.dockId);
  const target = [(d.pos[0] + dock.coords[0]) / 2, (d.pos[1] + dock.coords[1]) / 2];
  assert.ok(e.manualGoto(d.id, target));

  let sawMovement = false;
  let arrived = false;
  for (let i=0;i<600 && !arrived; i++){
    e.tick(1);
    if (d.speedMs > 0) sawMovement = true;
    if (d.speedMs === 0 && d._manualQueue.length === 0) arrived = true;
  }
  assert.ok(sawMovement, 'drone should move toward the target while the queue is non-empty');
  assert.ok(arrived, 'drone should arrive and pop the queue');
  assert.strictEqual(d.speedMs, 0);
  assert.ok(globalThis.SimRouter.distM(d.pos, target) < 50, 'drone should be near the target on arrival');
});

test('battery floor during manual control releases control and forces RTB', () => {
  const e = mk();
  const m = e.createMission({ type:'security', dockId:'DXB-001',
    waypoints: globalThis.SimRouter.perimeter([55.263,25.185], 3000, 8),
    params:{ altM:80, speedMs:10 } });
  const d = [...e.drones.values()].find(x=>x.missionId===m.id);
  for (let i=0;i<600 && d.state !== 'on-task'; i++) e.tick(1);
  assert.strictEqual(d.state, 'on-task');

  assert.ok(e.setManual(d.id, true));
  assert.ok(e.manualQueue(d.id, [d.pos[0]+0.05, d.pos[1]+0.05]));
  d.battery = 26;

  let releasedEvent = false;
  e.onEvent(ev => { if (ev.message.includes('MANUAL RELEASED')) releasedEvent = true; });

  for (let i=0;i<300 && d.state === 'manual'; i++) e.tick(1);
  assert.ok(releasedEvent, 'a MANUAL RELEASED event should fire at the battery floor');
  assert.ok(['rtb','landing','docked'].includes(d.state));
  assert.strictEqual(d._manualQueue.length, 0, 'queue must be cleared on forced release');

  for (let i=0;i<3600 && d.state !== 'docked'; i++) e.tick(1);
  assert.strictEqual(d.state, 'docked');
});

test('releasing manual control returns the drone to its prior state while the mission is active', () => {
  const e = mk();
  const m = e.createMission({ type:'security', dockId:'AUH-002',
    waypoints: globalThis.SimRouter.perimeter([54.435,24.542], 3000, 8),
    params:{ altM:80, speedMs:10 } });
  const d = [...e.drones.values()].find(x=>x.missionId===m.id);
  for (let i=0;i<600 && d.state !== 'on-task'; i++) e.tick(1);
  assert.strictEqual(d.state, 'on-task');

  assert.ok(e.setManual(d.id, true));
  assert.strictEqual(d.state, 'manual');

  assert.ok(e.setManual(d.id, false));
  assert.strictEqual(d.state, 'on-task', 'should resume the prior mission state');
  assert.strictEqual(m.state, 'active');

  for (let i=0;i<20;i++) e.tick(1);
  assert.strictEqual(d.state, 'on-task', 'mission should keep progressing normally after release');
});

test('nudgeAlt clamps altitude to the 30-120m band', () => {
  const e = mk();
  const m = e.createMission({ type:'security', dockId:'SHJ-001',
    waypoints: globalThis.SimRouter.perimeter([55.39,25.35], 3000, 8),
    params:{ altM:80, speedMs:10 } });
  const d = [...e.drones.values()].find(x=>x.missionId===m.id);
  for (let i=0;i<600 && d.state !== 'on-task'; i++) e.tick(1);
  e.setManual(d.id, true);

  e.nudgeAlt(d.id, -1000);
  assert.strictEqual(d.alt, 30);
  e.nudgeAlt(d.id, 1000);
  assert.strictEqual(d.alt, 120);
});

// ---- Review-fix regression: completion-order pruning + ambient ticker cadence ----

test('pruneFinishedMissions evicts by completion order, not creation order, keeping <=60 finished', () => {
  const e = mk();
  // One mission per dock (up to 70) via createMission directly — cheaper and
  // more deterministic than waiting on the scheduler to fill the fleet.
  const docks = [...e.docks.values()].slice(0, 70);
  const missions = docks.map(dock => e.createMission({
    type: 'security',
    dockId: dock.id,
    waypoints: globalThis.SimRouter.perimeter(dock.coords, 1200, 6),
    params: { altM: 80, speedMs: 15 }
  }));
  const drones = docks.map(dock => dock.drone);

  // Let every drone clear takeoff + transit onto its on-task leg. The r=1200m/
  // speedMs=15 route keeps on-task alive for ~480s — comfortably longer than
  // the ~140s (initial wait) + ~210s (staggered forcing below) this test needs,
  // so no drone completes its route naturally before we force it.
  for (let i = 0; i < 140; i++) e.tick(1);
  assert.ok(drones.every(d => d.state === 'on-task' || d.state === 'transit'),
    'expected every drone to still be flying before forcing completion');

  // Force completion (commandRTB completes the mission immediately, see
  // beginRtb -> finalizeMission) in REVERSE creation order, staggered a few
  // ticks apart. This makes the earliest-CREATED missions (index 0..9) the
  // LATEST-COMPLETED ones, and the latest-created (index 60..69) the
  // EARLIEST-completed ones — decoupling completion order from creation
  // order so creation-order pruning and completion-order pruning disagree.
  for (let i = missions.length - 1; i >= 0; i--){
    assert.ok(e.commandRTB(drones[i].id), 'commandRTB should succeed for ' + drones[i].id);
    for (let t = 0; t < 3; t++) e.tick(1);
  }

  const finished = [...e.missions.values()].filter(m => m.state !== 'active');
  assert.ok(finished.length <= 60, 'finished missions must be capped at 60, got ' + finished.length);

  // Earliest-created / latest-completed missions must survive.
  const earliestCreatedIds = missions.slice(0, 10).map(m => m.id);
  for (const id of earliestCreatedIds){
    assert.ok(e.missions.has(id), id + ' (created first, completed last) should survive pruning');
  }
  // Latest-created / earliest-completed missions should be the ones pruned.
  const earliestCompletedIds = missions.slice(-10).map(m => m.id);
  const evicted = earliestCompletedIds.filter(id => !e.missions.has(id)).length;
  assert.ok(evicted >= 8,
    'earliest-completed missions should be pruned first (evicted ' + evicted + '/10)');
});

test('ambient ticker events bound the max gap to <=5s of sim time over a 10-minute window', () => {
  const e = mk();
  const times = [];
  e.onEvent(ev => { times.push(ev.time); });
  for (let i = 0; i < 600; i++) e.tick(1); // 10 sim minutes
  assert.ok(times.length > 1, 'expected ticker events over the window');
  let maxGap = 0;
  for (let i = 1; i < times.length; i++) maxGap = Math.max(maxGap, times[i] - times[i - 1]);
  assert.ok(maxGap <= 5, 'max ticker gap should be <=5s of sim time, got ' + maxGap);
});
