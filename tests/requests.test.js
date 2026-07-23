// tests/requests.test.js — customer flight request queue (contracts R-1..R-3)
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

function mk(){
  return globalThis.SimEngine.create({ docks: DOCKS, roads: globalThis.GEO_UAE.roads });
}
function pendings(e){
  return [...e.requests.values()].filter(r => r.status === 'pending');
}
// Tick until at least one pending request exists (spawn is seeded but the
// first pass can theoretically skip; contract says first at ~15s).
function tickToFirstRequest(e){
  for (let i = 0; i < 200 && pendings(e).length === 0; i++) e.tick(1);
  const p = pendings(e);
  assert.ok(p.length >= 1, 'expected a pending request to spawn');
  return p[0];
}

// ---- R-2: spawn timing + caps ----

test('first flight request spawns by ~20s sim and ids read REQ-101...', () => {
  const e = mk();
  for (let i = 0; i < 20; i++) e.tick(1);
  const p = pendings(e);
  assert.ok(p.length >= 1, 'expected >=1 pending request by 20s, got ' + p.length);
  assert.match(p[0].id, /^REQ-\d+$/);
  const n = Number(p[0].id.slice(4));
  assert.ok(n >= 101, 'ids should start at REQ-101, got ' + p[0].id);
});

test('pending requests never exceed 4 over a long untended run', () => {
  const e = mk();
  for (let i = 0; i < 3000; i++){
    e.tick(1);
    assert.ok(pendings(e).length <= 4, 'pending count exceeded 4 at t=' + e.now);
  }
  assert.ok(pendings(e).length >= 1, 'requests should have accumulated');
});

test('requests map stays <=20 with pruning of resolved requests', () => {
  const e = mk();
  let spawned = 0;
  for (let i = 0; i < 4000; i++){
    e.tick(1);
    for (const r of pendings(e)){ e.declineRequest(r.id); spawned++; }
    assert.ok(e.requests.size <= 20, 'requests map exceeded 20 at t=' + e.now);
  }
  assert.ok(spawned > 20, 'expected enough spawns to exercise pruning, got ' + spawned);
});

// ---- R-1: request shape ----

test('request carries the full R-1 shape with in-range coords and waypoints', () => {
  const e = mk();
  const req = tickToFirstRequest(e);

  assert.match(req.id, /^REQ-\d+$/);
  assert.strictEqual(typeof req.customer, 'string');
  assert.ok(req.customer.length >= 2 && req.customer === req.customer.toUpperCase());
  assert.strictEqual(typeof req.customerFull, 'string');
  assert.ok(globalThis.MISSIONS_CONFIG[req.type], 'type must be a MISSIONS_CONFIG key');
  assert.strictEqual(typeof req.place, 'string');
  assert.strictEqual(req.place, req.place.toUpperCase());
  assert.ok(Array.isArray(req.coords) && Number.isFinite(req.coords[0]) && Number.isFinite(req.coords[1]));
  assert.ok(['ROUTINE', 'PRIORITY', 'URGENT'].includes(req.priority));
  assert.ok(Number.isFinite(req.params.altM) && req.params.altM >= 40 && req.params.altM <= 120);
  assert.ok(Number.isFinite(req.params.speedMs) && req.params.speedMs >= 5 && req.params.speedMs <= 21);
  assert.ok(Number.isFinite(req.requestedAt));
  assert.strictEqual(req.status, 'pending');
  assert.strictEqual(req.missionId, null);

  const dock = e.docks.get(req.dockId);
  assert.ok(dock, 'dockId must reference a real dock');
  const rangeM = RANGE.dockRangeKm(dock) * 1000;
  assert.ok(R.distM(dock.coords, req.coords) <= rangeM,
    'request point must sit inside the assigned dock range');
  assert.ok(Array.isArray(req.waypoints) && req.waypoints.length >= 2);
  for (const wp of req.waypoints){
    assert.ok(R.distM(dock.coords, wp) <= rangeM * 1.05,
      'waypoint outside 1.05x dock range: ' + Math.round(R.distM(dock.coords, wp)) + 'm');
  }
});

test('urgent priority is reserved for emergency requests', () => {
  const e = mk();
  const seen = [];
  for (let i = 0; i < 6000; i++){
    e.tick(1);
    for (const r of pendings(e)){ seen.push(r); e.declineRequest(r.id); }
  }
  assert.ok(seen.length >= 10, 'expected a broad sample, got ' + seen.length);
  for (const r of seen){
    if (r.priority === 'URGENT') assert.strictEqual(r.type, 'emergency');
    if (r.type === 'emergency') assert.strictEqual(r.priority, 'URGENT');
  }
});

// ---- R-2: event contract ----

test('FLIGHT_REQUEST events emit at warn level with requestId extra', () => {
  const e = mk();
  const evs = [];
  e.onEvent(ev => { if (ev.code === 'FLIGHT_REQUEST') evs.push(ev); });
  const req = tickToFirstRequest(e);
  assert.ok(evs.length >= 1, 'a FLIGHT_REQUEST event should fire');
  const ev = evs.find(x => x.requestId === req.id);
  assert.ok(ev, 'event must carry requestId matching the request');
  assert.strictEqual(ev.level, 'warn');
  assert.ok(ev.message.includes(req.customer), 'message names the customer');
  assert.ok(ev.message.includes(req.place), 'message names the place');
});

// ---- R-3: approve ----

test('approveRequest creates a linked mission and launches the drone', () => {
  const e = mk();
  const req = tickToFirstRequest(e);
  const evs = [];
  e.onEvent(ev => { if (ev.code === 'REQUEST_APPROVED') evs.push(ev); });

  const m = e.approveRequest(req.id);
  assert.ok(m && m.state === 'active');
  assert.strictEqual(m.type, req.type);
  assert.strictEqual(m.params.altM, req.params.altM);
  assert.strictEqual(m.params.speedMs, req.params.speedMs);
  assert.strictEqual(m.requestId, req.id);
  assert.strictEqual(m.requestedBy, req.customer);
  assert.strictEqual(req.status, 'approved');
  assert.strictEqual(req.missionId, m.id);
  assert.strictEqual(m.dockId, req.dockId, 'request dockId reflects the launching dock');

  const dock = e.docks.get(m.dockId);
  assert.strictEqual(dock.drone.state, 'takeoff', 'drone should launch on approval');
  assert.strictEqual(dock.drone.missionId, m.id);

  const ev = evs.find(x => x.requestId === req.id);
  assert.ok(ev, 'a REQUEST_APPROVED event should fire');
  assert.strictEqual(ev.dockId, m.dockId);
  assert.strictEqual(ev.level, 'info');
});

test('approveRequest on a non-pending request is rejected', () => {
  const e = mk();
  const req = tickToFirstRequest(e);
  assert.ok(e.declineRequest(req.id));
  assert.throws(() => e.approveRequest(req.id), /Request not pending/);
  assert.throws(() => e.approveRequest('REQ-99999'), /Request not pending/);
});

test('approveRequest re-plans from another ready dock when the assigned one is busy', () => {
  const e = mk();
  // Whether a neighbor can cover a request point depends on dock geography,
  // so hunt for a request that provably has an alternate eligible dock
  // within a conservative 0.7x of that dock's range (the engine accepts up
  // to 0.9x, so this guarantees the re-plan can succeed). Decline the rest.
  function alternateDockFor(req){
    return [...e.docks.values()].find(d =>
      d.id !== req.dockId && d.state === 'ready' && d.battery >= 60 &&
      d.drone && d.drone.state === 'docked' &&
      R.distM(d.coords, req.coords) <= RANGE.dockRangeKm(d) * 1000 * 0.7);
  }
  let req = null;
  for (let i = 0; i < 6000 && !req; i++){
    e.tick(1);
    for (const r of pendings(e)){
      if (!req && alternateDockFor(r)){ req = r; break; }
      e.declineRequest(r.id);
    }
  }
  assert.ok(req, 'expected a request coverable by a second dock within the window');
  const originalDock = e.docks.get(req.dockId);
  originalDock.state = 'fault'; // assigned dock knocked out before approval

  const m = e.approveRequest(req.id);
  assert.ok(m && m.state === 'active');
  assert.notStrictEqual(m.dockId, originalDock.id, 'mission must launch from a different dock');
  assert.strictEqual(req.dockId, m.dockId, 'request re-points at the launching dock');
  const dock = e.docks.get(m.dockId);
  const rangeM = RANGE.dockRangeKm(dock) * 1000;
  for (const wp of m.waypoints){
    assert.ok(R.distM(dock.coords, wp) <= rangeM * 1.05, 're-planned waypoint outside coverage');
  }
});

test('approveRequest throws NO READY DOCK IN RANGE when nothing is eligible', () => {
  const e = mk();
  const req = tickToFirstRequest(e);
  for (const dock of e.docks.values()) dock.state = 'fault';
  assert.throws(() => e.approveRequest(req.id), /NO READY DOCK IN RANGE/);
  assert.strictEqual(req.status, 'pending', 'failed approval leaves the request pending');
});

// ---- R-3: decline ----

test('declineRequest resolves the request and emits REQUEST_DECLINED', () => {
  const e = mk();
  const req = tickToFirstRequest(e);
  let ev = null;
  e.onEvent(x => { if (x.code === 'REQUEST_DECLINED') ev = x; });
  assert.strictEqual(e.declineRequest(req.id), true);
  assert.strictEqual(req.status, 'declined');
  assert.ok(ev, 'a REQUEST_DECLINED event should fire');
  assert.strictEqual(ev.requestId, req.id);
  assert.strictEqual(ev.level, 'info');
  assert.ok(ev.message.includes(req.customer));
  // second decline is a no-op
  assert.strictEqual(e.declineRequest(req.id), false);
});

// ---- Completion linkage ----

test('full lifecycle: approve, fly, complete -> request fulfilled', () => {
  const e = mk();
  const req = tickToFirstRequest(e);
  let fulfilled = null;
  e.onEvent(ev => { if (ev.code === 'REQUEST_FULFILLED' && ev.requestId === req.id) fulfilled = ev; });

  const m = e.approveRequest(req.id);
  for (let i = 0; i < 7200 && req.status !== 'completed'; i++) e.tick(1);

  assert.strictEqual(m.state, 'complete');
  assert.strictEqual(req.status, 'completed');
  assert.ok(fulfilled, 'a REQUEST_FULFILLED event should fire');
  assert.strictEqual(fulfilled.level, 'info');
  assert.ok(fulfilled.message.includes(req.customer));
});

// ---- Dock reservation ----

test('scheduler never takes a dock reserved by a pending request', () => {
  const e = mk();
  const req = tickToFirstRequest(e);
  // Long run at full scheduler churn: the reserved dock's drone must still be
  // docked (and the dock un-launched) when the operator finally approves.
  for (let i = 0; i < 600 && req.status === 'pending'; i++){
    e.tick(1);
    const drone = e.docks.get(req.dockId).drone;
    // The drone may be away only if a mission it flies belongs to this
    // request (impossible while pending) — so it must stay docked.
    assert.strictEqual(drone.state, 'docked',
      'reserved dock ' + req.dockId + ' lost its drone at t=' + Math.round(e.now));
  }
  const mission = e.approveRequest(req.id);
  assert.strictEqual(mission.dockId, req.dockId, 'approval should use the reserved dock');
});
