// tests/range.test.js
const test = require('node:test');
const assert = require('node:assert');
require('../assets/js/sim/router.js');
require('../assets/js/data/docks.js');
require('../assets/js/data/geo-uae.js');
require('../assets/js/data/missions-config.js');
require('../assets/js/sim/engine.js');

const R = globalThis.SimRouter;
const RANGE = globalThis.DOCK_RANGE;
const DOCKS = globalThis.DATA_DOCKS;

test('dock coverage is 3km inside a city and 5km in the open', () => {
  const urban = DOCKS.find(d => d.id === 'DXB-001'); // Business Bay, central Dubai
  const rural = DOCKS.find(d => d.id === 'AUH-024'); // Liwa Oasis, deep desert
  assert.strictEqual(RANGE.dockRangeKm(urban), 3);
  assert.strictEqual(RANGE.dockRangeKm(rural), 5);
});

test('explicit urban override wins over geography', () => {
  assert.strictEqual(RANGE.dockRangeKm({ coords: [53.78, 23.13], urban: true }), 3);
  assert.strictEqual(RANGE.dockRangeKm({ coords: [55.263, 25.185], urban: false }), 5);
});

test('every dock classifies to a valid range', () => {
  for (const d of DOCKS){
    const km = RANGE.dockRangeKm(d);
    assert.ok(km === 3 || km === 5, d.id + ' got range ' + km);
  }
});

function mkEngine(){
  return globalThis.SimEngine.create({ docks: DOCKS, roads: globalThis.GEO_UAE.roads });
}

// ---- contract C-1: user-created missions must stay inside coverage ----

test('createMission rejects a waypoint at 2x dock range', () => {
  const e = mkEngine();
  const dock = e.docks.get('DXB-001'); // urban, 3 km
  const rangeM = RANGE.dockRangeKm(dock) * 1000;
  const far = R.offsetMeters(dock.coords, rangeM * 2, 0);
  assert.throws(() => e.createMission({
    type: 'security', dockId: 'DXB-001',
    waypoints: [dock.coords.slice(), far],
    params: { altM: 80, speedMs: 10 }
  }), /WAYPOINT OUTSIDE COVERAGE/);
  // rejected launch must leave the dock/drone untouched
  assert.strictEqual(dock.drone.state, 'docked');
  assert.strictEqual(dock.state, 'ready');
  assert.strictEqual(dock.drone.missionId, null);
});

test('createMission accepts a waypoint at 0.9x dock range', () => {
  const e = mkEngine();
  const dock = e.docks.get('DXB-001');
  const rangeM = RANGE.dockRangeKm(dock) * 1000;
  const near = R.offsetMeters(dock.coords, rangeM * 0.9, 0);
  const m = e.createMission({
    type: 'security', dockId: 'DXB-001',
    waypoints: [dock.coords.slice(), near],
    params: { altM: 80, speedMs: 10 }
  });
  assert.strictEqual(m.state, 'active');
  assert.strictEqual(dock.drone.missionId, m.id);
});

test('manualGoto/manualQueue clamp out-of-range targets onto the coverage ring', () => {
  const e = mkEngine();
  const dock = e.docks.get('DXB-001');
  const rangeM = RANGE.dockRangeKm(dock) * 1000;
  const m = e.createMission({
    type: 'security', dockId: 'DXB-001',
    waypoints: R.perimeter(dock.coords, 2500, 8),
    params: { altM: 80, speedMs: 10 }
  });
  const d = dock.drone;
  for (let i = 0; i < 600 && d.state !== 'on-task'; i++) e.tick(1);
  assert.strictEqual(d.state, 'on-task');
  assert.ok(e.setManual(d.id, true));

  const far = R.offsetMeters(dock.coords, rangeM * 3, rangeM * 2);
  assert.ok(e.manualGoto(d.id, far), 'clamped goto is still accepted');
  assert.strictEqual(d._manualQueue.length, 1);
  assert.ok(R.distM(dock.coords, d._manualQueue[0]) <= rangeM,
    'goto target must be pulled inside the ring, got ' +
    Math.round(R.distM(dock.coords, d._manualQueue[0])) + 'm');

  assert.ok(e.manualQueue(d.id, far), 'clamped queue append is still accepted');
  assert.strictEqual(d._manualQueue.length, 2);
  assert.ok(R.distM(dock.coords, d._manualQueue[1]) <= rangeM);

  // in-range targets pass through unchanged
  const nearPt = R.offsetMeters(dock.coords, 1000, 500);
  assert.ok(e.manualGoto(d.id, nearPt));
  assert.ok(Math.abs(d._manualQueue[0][0] - nearPt[0]) < 1e-9);
  assert.ok(Math.abs(d._manualQueue[0][1] - nearPt[1]) < 1e-9);
  assert.strictEqual(m.state, 'active');
});

test('launchPreset still launches every mission type with in-range routes', () => {
  const e = mkEngine();
  const types = Object.keys(globalThis.MISSIONS_CONFIG);
  // Several rounds per type: exercises many seeded-rand route generations,
  // none of which may trip the new createMission range validation.
  for (let round = 0; round < 4; round++){
    for (const type of types){
      const m = e.launchPreset(type);
      assert.strictEqual(m.state, 'active', type + ' preset should launch');
      const dock = e.docks.get(m.dockId);
      const rangeM = RANGE.dockRangeKm(dock) * 1000;
      for (const wp of m.waypoints){
        assert.ok(R.distM(dock.coords, wp) <= rangeM * 1.05,
          type + ' preset waypoint outside coverage');
      }
    }
  }
  // preset-saturated fleet keeps ticking cleanly under the new validation
  for (let i = 0; i < 200; i++) e.tick(1);

  // and on a fresh engine the auto-scheduler still launches missions
  // (its clamped routes must never trip the createMission range check)
  const e2 = mkEngine();
  for (let i = 0; i < 200; i++) e2.tick(1);
  assert.ok(e2.missions.size > 0, 'scheduler should keep creating missions');
});

// ---- contract C-2: event semantics ----

test('mission launch event carries code MISSION_LAUNCHED and dockId', () => {
  const e = mkEngine();
  const dock = e.docks.get('DXB-001');
  let launchEv = null;
  e.onEvent(ev => { if (ev.code === 'MISSION_LAUNCHED') launchEv = ev; });
  const m = e.createMission({
    type: 'security', dockId: 'DXB-001',
    waypoints: R.perimeter(dock.coords, 2000, 8),
    params: { altM: 80, speedMs: 10 }
  });
  assert.ok(launchEv, 'a MISSION_LAUNCHED event should fire');
  assert.strictEqual(launchEv.dockId, 'DXB-001');
  assert.strictEqual(launchEv.level, 'info');
  assert.strictEqual(m.state, 'active');
});

test('battery-floor forced RTB emits at alert level', () => {
  const e = mkEngine();
  const dock = e.docks.get('DXB-001');
  e.createMission({
    type: 'security', dockId: 'DXB-001',
    waypoints: R.perimeter(dock.coords, 2000, 8),
    params: { altM: 80, speedMs: 10 }
  });
  const d = dock.drone;
  let rtbEv = null;
  e.onEvent(ev => { if (ev.message.includes('FORCED RTB')) rtbEv = ev; });
  d.battery = 20; // below the 25% floor while airborne (takeoff counts)
  e.tick(1);
  assert.ok(rtbEv, 'a FORCED RTB event should fire at the battery floor');
  assert.strictEqual(rtbEv.level, 'alert');
});

test('battery-floor manual release emits at alert level with MANUAL_RELEASED code', () => {
  const e = mkEngine();
  const dock = e.docks.get('DXB-001');
  e.createMission({
    type: 'security', dockId: 'DXB-001',
    waypoints: R.perimeter(dock.coords, 2500, 8),
    params: { altM: 80, speedMs: 10 }
  });
  const d = dock.drone;
  for (let i = 0; i < 600 && d.state !== 'on-task'; i++) e.tick(1);
  assert.strictEqual(d.state, 'on-task');
  assert.ok(e.setManual(d.id, true));
  let relEv = null;
  e.onEvent(ev => { if (ev.code === 'MANUAL_RELEASED' && ev.message.includes('BATTERY FLOOR')) relEv = ev; });
  d.battery = 20;
  e.tick(1);
  assert.ok(relEv, 'a battery-floor MANUAL_RELEASED event should fire');
  assert.strictEqual(relEv.level, 'alert');
});

test('autonomous drones never fly beyond their dock coverage range', () => {
  const e = globalThis.SimEngine.create({ docks: DOCKS, roads: globalThis.GEO_UAE.roads });
  const MARGIN_M = 300; // clamp + lon/lat-vs-meters slack
  let maxAirborne = 0;
  for (let i = 0; i < 4000; i++){
    e.tick(1);
    let air = 0;
    for (const d of e.drones.values()){
      if (d.state === 'docked') continue;
      air++;
      const dock = e.docks.get(d.dockId);
      const rangeM = RANGE.dockRangeKm(dock) * 1000;
      const dist = R.distM(dock.coords, d.pos);
      assert.ok(dist <= rangeM + MARGIN_M,
        d.id + ' is ' + Math.round(dist) + 'm from ' + dock.id +
        ', beyond its ' + rangeM + 'm coverage');
    }
    maxAirborne = Math.max(maxAirborne, air);
  }
  // Sanity: the run actually exercised a busy fleet, not an idle one.
  assert.ok(maxAirborne >= 10, 'expected a busy fleet, peaked at ' + maxAirborne);
});
