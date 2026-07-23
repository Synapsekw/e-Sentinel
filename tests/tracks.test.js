// tests/tracks.test.js — detection tracks (contracts T-1/T-2)
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

const ELIGIBLE_TYPES = ['security', 'highway', 'infra', 'parks'];
const TRACK_LABELS = {
  security: 'FLAGGED VEHICLE',
  highway: 'FLAGGED VEHICLE',
  infra: 'THERMAL ANOMALY',
  parks: 'VEGETATION STRESS ZONE'
};

function mk(){
  return globalThis.SimEngine.create({ docks: DOCKS, roads: globalThis.GEO_UAE.roads });
}
function actives(e){
  return [...e.tracks.values()].filter(t => t.status === 'active');
}
// Spawn is stochastic (0.4 per detection, detections ~0.0067/s per on-task
// drone) but with 104 docks and airborne target 14, a track appears within a
// couple hundred sim-seconds. Bounded loop keeps runtime sane.
function tickToFirstTrack(e, maxS){
  for (let i = 0; i < (maxS || 1500) && e.tracks.size === 0; i++) e.tick(1);
  assert.ok(e.tracks.size >= 1, 'expected a track to spawn');
  return [...e.tracks.values()][0];
}
// Mirrors taskTrack's dock-selection bar so tests can find a track that is
// provably taskable at the moment of the call (no ticks in between).
function eligibleDockFor(e, track){
  const reserved = new Set([...e.requests.values()]
    .filter(r => r.status === 'pending' && r.dockId).map(r => r.dockId));
  let best = null, bestD = Infinity;
  for (const d of e.docks.values()){
    if (d.state !== 'ready' || d.battery < 60 || !d.drone ||
        d.drone.state !== 'docked' || reserved.has(d.id)) continue;
    const dist = R.distM(d.coords, track.pos);
    if (dist <= RANGE.dockRangeKm(d) * 1000 * 0.9 && dist < bestD){ bestD = dist; best = d; }
  }
  return best;
}
function findTaskableTrack(e, maxS){
  for (let i = 0; i < (maxS || 4000); i++){
    e.tick(1);
    for (const t of e.tracks.values()){
      if (t.status === 'active' && eligibleDockFor(e, t)) return t;
    }
  }
  assert.fail('no taskable active track found within the window');
}

// ---- T-1: spawn + shape ----

test('track spawns during on-task flight with the full T-1 shape', () => {
  const e = mk();
  const t = tickToFirstTrack(e);

  assert.strictEqual(t.id, 'TRK-201', 'ids start at TRK-201');
  assert.ok(ELIGIBLE_TYPES.includes(t.missionType), 'missionType must be track-eligible');
  assert.strictEqual(t.label, TRACK_LABELS[t.missionType], 'label matches the detection noun');
  assert.ok(Array.isArray(t.pos) && Number.isFinite(t.pos[0]) && Number.isFinite(t.pos[1]));
  assert.match(t.sourceDrone, /^D-/);
  const drone = e.drones.get(t.sourceDrone);
  assert.ok(drone, 'sourceDrone must reference a real drone');
  assert.strictEqual(t.homeDockId, drone.dockId, 'home dock is the detecting drone\'s dock');
  const mission = e.missions.get(t.sourceMission);
  assert.ok(mission, 'sourceMission must reference the origin mission');
  assert.strictEqual(mission.type, t.missionType);
  assert.ok(Number.isFinite(t.detectedAt) && t.detectedAt <= e.now);
  assert.strictEqual(t.expiresAt, t.detectedAt + 600, 'expiry is detectedAt + 600');
  assert.strictEqual(t.status, 'active');
  assert.strictEqual(t.missionId, null);
  assert.strictEqual(t.dockId, null);

  // Detection happened mid-flight, so the track sits inside the source
  // dock's coverage (same 1.05x tolerance createMission uses).
  const home = e.docks.get(t.homeDockId);
  const rangeM = RANGE.dockRangeKm(home) * 1000;
  assert.ok(R.distM(home.coords, t.pos) <= rangeM * 1.05,
    'track position must sit inside the source dock range');
});

test('only security/highway/infra/parks missions spawn tracks', () => {
  const e = mk();
  const seenTypes = [];
  e.onEvent(ev => {
    if (ev.code === 'TRACK_NEW'){
      const t = e.tracks.get(ev.trackId);
      assert.ok(t, 'TRACK_NEW must reference a live track');
      seenTypes.push(t.missionType);
    }
  });
  for (let i = 0; i < 3000; i++) e.tick(1);
  assert.ok(seenTypes.length >= 5, 'expected a broad sample, got ' + seenTypes.length);
  for (const type of seenTypes){
    assert.ok(ELIGIBLE_TYPES.includes(type),
      'ineligible mission type spawned a track: ' + type);
  }
});

test('active track count never exceeds 8', () => {
  const e = mk();
  let spawned = 0;
  e.onEvent(ev => { if (ev.code === 'TRACK_NEW') spawned++; });
  for (let i = 0; i < 4000; i++){
    e.tick(1);
    assert.ok(actives(e).length <= 8, 'active tracks exceeded 8 at t=' + e.now);
  }
  assert.ok(spawned > 8, 'expected enough spawns to exercise the cap, got ' + spawned);
});

// ---- T-2: event contracts ----

test('TRACK_NEW emits at warn level from OPS, after a DETECTION carrying the trackId', () => {
  const e = mk();
  const evs = [];
  e.onEvent(ev => {
    if (ev.code === 'DETECTION' || ev.code === 'TRACK_NEW') evs.push(ev);
  });
  const t = tickToFirstTrack(e);

  const trackNew = evs.find(ev => ev.code === 'TRACK_NEW' && ev.trackId === t.id);
  assert.ok(trackNew, 'a TRACK_NEW event should fire');
  assert.strictEqual(trackNew.level, 'warn');
  assert.strictEqual(trackNew.source, 'OPS');
  assert.ok(trackNew.message.includes(t.id), 'message names the track id');
  assert.ok(trackNew.message.includes(t.label), 'message names the label');
  assert.ok(trackNew.message.includes(t.sourceDrone), 'message names the source drone');

  const det = evs.find(ev => ev.code === 'DETECTION' && ev.trackId === t.id);
  assert.ok(det, 'the spawning detection carries the trackId');
  assert.ok(evs.indexOf(det) < evs.indexOf(trackNew), 'detection precedes TRACK_NEW');
});

test('detections that do not spawn a track still carry code DETECTION, no trackId', () => {
  const e = mk();
  const evs = [];
  e.onEvent(ev => { if (ev.code === 'DETECTION') evs.push(ev); });
  for (let i = 0; i < 2000; i++) e.tick(1);
  assert.ok(evs.length >= 5, 'expected a sample of detections, got ' + evs.length);
  const plain = evs.filter(ev => !ev.trackId);
  assert.ok(plain.length >= 1, 'expected at least one non-spawning detection');
  for (const ev of evs) assert.strictEqual(ev.level, 'info');
});

// ---- T-1: expiry + prune ----

test('active track expires 600s after detection with TRACK_EXPIRED', () => {
  const e = mk();
  const t = tickToFirstTrack(e);
  let ev = null;
  e.onEvent(x => { if (x.code === 'TRACK_EXPIRED' && x.trackId === t.id) ev = x; });
  const target = t.expiresAt + 5;
  for (let i = 0; i < 3000 && e.now < target; i++) e.tick(1);
  assert.strictEqual(t.status, 'expired');
  assert.ok(ev, 'a TRACK_EXPIRED event should fire');
  assert.strictEqual(ev.level, 'info');
  assert.ok(ev.message.includes(t.id));
  assert.ok(ev.message.includes('NO ACTION TAKEN'));
  assert.ok(ev.time >= t.expiresAt, 'expiry must not fire early');
});

test('tracks map stays <=20, evicting oldest resolved/expired first, never active/tasked', () => {
  const e = mk();
  // Synthetic backlog: 4 active + 1 tasked (never evictable) + 21 finished.
  const keep = [];
  for (let i = 0; i < 5; i++){
    const t = {
      id: 'TRK-9' + i, label: 'FLAGGED VEHICLE', missionType: 'security',
      pos: [55.3, 25.2], sourceDrone: 'D-X', sourceMission: 'M-X',
      detectedAt: i, expiresAt: 999999,
      status: i === 0 ? 'tasked' : 'active', missionId: null, dockId: null,
      homeDockId: 'X'
    };
    keep.push(t);
    e.tracks.set(t.id, t);
  }
  for (let i = 0; i < 21; i++){
    e.tracks.set('TRK-8' + i, {
      id: 'TRK-8' + i, label: 'THERMAL ANOMALY', missionType: 'infra',
      pos: [55.3, 25.2], sourceDrone: 'D-X', sourceMission: 'M-X',
      detectedAt: 100 + i, expiresAt: 999999,
      status: i % 2 ? 'resolved' : 'expired', missionId: null, dockId: null,
      homeDockId: 'X'
    });
  }
  assert.strictEqual(e.tracks.size, 26);
  e.tick(1); // lifecycle pass prunes
  assert.ok(e.tracks.size <= 20, 'tracks map must be pruned to <=20');
  for (const t of keep){
    assert.ok(e.tracks.has(t.id), 'active/tasked track ' + t.id + ' must never be evicted');
  }
  // Oldest finished (detectedAt 100..105) go first.
  for (let i = 0; i < 6; i++){
    assert.ok(!e.tracks.has('TRK-8' + i), 'oldest finished track TRK-8' + i + ' should be evicted');
  }
});

// ---- T-2: tasking ----

test('taskTrack launches an investigation mission from the nearest eligible dock', () => {
  const e = mk();
  const t = findTaskableTrack(e);
  const expectedDock = eligibleDockFor(e, t);
  const evs = [];
  e.onEvent(ev => { if (ev.code === 'TRACK_TASKED') evs.push(ev); });

  const m = e.taskTrack(t.id);
  assert.ok(m && m.state === 'active');
  assert.strictEqual(m.type, t.missionType, 'mission type matches the track origin type');
  assert.strictEqual(m.trackId, t.id);
  assert.strictEqual(t.status, 'tasked');
  assert.strictEqual(t.missionId, m.id);
  assert.strictEqual(t.dockId, m.dockId);
  assert.strictEqual(m.dockId, expectedDock.id, 'nearest eligible in-range dock is chosen');

  const dock = e.docks.get(m.dockId);
  assert.strictEqual(dock.drone.state, 'takeoff', 'drone should launch on tasking');
  assert.strictEqual(dock.drone.missionId, m.id);
  const rangeM = RANGE.dockRangeKm(dock) * 1000;
  assert.ok(m.waypoints.length >= 2);
  for (const wp of m.waypoints){
    assert.ok(R.distM(dock.coords, wp) <= rangeM * 1.05,
      'waypoint outside 1.05x dock range: ' + Math.round(R.distM(dock.coords, wp)) + 'm');
  }

  const ev = evs.find(x => x.trackId === t.id);
  assert.ok(ev, 'a TRACK_TASKED event should fire');
  assert.strictEqual(ev.level, 'info');
  assert.strictEqual(ev.dockId, m.dockId);
  assert.ok(ev.message.includes(t.id));
  assert.ok(ev.message.includes(dock.drone.id), 'message names the investigating drone');
});

test('taskTrack on a non-active track throws', () => {
  const e = mk();
  const t = tickToFirstTrack(e);
  assert.throws(() => e.taskTrack('TRK-99999'), /Track not active/);
  assert.ok(e.dismissTrack(t.id));
  assert.throws(() => e.taskTrack(t.id), /Track not active/);
});

test('taskTrack skips docks reserved by pending flight requests', () => {
  const e = mk();
  const t = findTaskableTrack(e);
  const expectedDock = eligibleDockFor(e, t);
  assert.ok(expectedDock, 'precondition: a dock is eligible');
  // Synthetic pending request pinning the dock taskTrack would otherwise
  // pick — the reservation must make it invisible to track tasking.
  e.requests.set('REQ-TEST', { id: 'REQ-TEST', status: 'pending', dockId: expectedDock.id });
  try {
    const m = e.taskTrack(t.id);
    assert.notStrictEqual(m.dockId, expectedDock.id,
      'tasking must not launch from a request-reserved dock');
    assert.strictEqual(t.status, 'tasked');
  } catch (err){
    // No alternate dock covers the point: the reservation makes tasking fail.
    assert.match(err.message, /NO READY DOCK IN RANGE/);
    assert.strictEqual(t.status, 'active', 'failed tasking leaves the track active');
  }
});

// ---- T-2: resolution ----

test('dismissTrack resolves an active track and emits TRACK_DISMISSED', () => {
  const e = mk();
  const t = tickToFirstTrack(e);
  let ev = null;
  e.onEvent(x => { if (x.code === 'TRACK_DISMISSED') ev = x; });
  assert.strictEqual(e.dismissTrack(t.id), true);
  assert.strictEqual(t.status, 'resolved');
  assert.ok(ev, 'a TRACK_DISMISSED event should fire');
  assert.strictEqual(ev.level, 'info');
  assert.strictEqual(ev.trackId, t.id);
  assert.ok(ev.message.includes('OPERATOR'));
  // second dismiss and unknown ids are no-ops
  assert.strictEqual(e.dismissTrack(t.id), false);
  assert.strictEqual(e.dismissTrack('TRK-99999'), false);
});

test('full lifecycle: task, fly, complete -> track resolved with TRACK_RESOLVED', () => {
  const e = mk();
  const t = findTaskableTrack(e);
  let resolved = null;
  e.onEvent(ev => { if (ev.code === 'TRACK_RESOLVED' && ev.trackId === t.id) resolved = ev; });

  const m = e.taskTrack(t.id);
  for (let i = 0; i < 7200 && t.status !== 'resolved'; i++) e.tick(1);

  assert.strictEqual(m.state, 'complete');
  assert.strictEqual(t.status, 'resolved');
  assert.ok(resolved, 'a TRACK_RESOLVED event should fire');
  assert.strictEqual(resolved.level, 'info');
  assert.ok(resolved.message.includes(t.id));
  assert.ok(resolved.message.includes(t.label), 'message names the label');
});

// ---- Airborne divert fallback ----

// A single isolated dock: once its drone is airborne, no ready dock covers
// anything nearby — the only way to task a track is to divert the flyer.
function mkIsolated(){
  const docks = [{ id: 'ISO-001', name: 'Isolated', emirate: 'AUH', coords: [54.0, 23.5], model: 'M4TD' }];
  return globalThis.SimEngine.create({ docks: docks, roads: { type: 'FeatureCollection', features: [] } });
}

function syntheticTrack(e, pos){
  const track = {
    id: 'TRK-T1', label: 'FLAGGED VEHICLE', missionType: 'security',
    pos: pos, sourceDrone: 'D-ISO-001', sourceMission: 'M-ISO-001-1',
    detectedAt: e.now, expiresAt: e.now + 600, status: 'active',
    missionId: null, dockId: null, homeDockId: 'ISO-001'
  };
  e.tracks.set(track.id, track);
  return track;
}

test('taskTrack diverts the nearest airborne drone when no dock is ready', () => {
  const e = mkIsolated();
  const first = e.launchPreset('security', { dockId: 'ISO-001' });
  for (let i = 0; i < 60; i++) e.tick(1); // airborne, mid-mission
  const drone = e.drones.get('D-ISO-001');
  assert.ok(drone.state === 'transit' || drone.state === 'on-task');

  const track = syntheticTrack(e, [54.005, 23.505]); // ~700m from the dock
  const mission = e.taskTrack('TRK-T1');

  assert.strictEqual(first.state, 'complete', 'old ambient mission wrapped up');
  assert.strictEqual(drone.missionId, mission.id);
  assert.strictEqual(drone.state, 'transit');
  assert.strictEqual(mission.trackId, 'TRK-T1');
  assert.strictEqual(track.status, 'tasked');
  assert.strictEqual(track.dockId, 'ISO-001');
  const R2 = globalThis.SimRouter;
  const rangeM = globalThis.DOCK_RANGE.dockRangeKm({ coords: [54.0, 23.5] }) * 1000;
  for (const wp of mission.waypoints){
    assert.ok(R2.distM([54.0, 23.5], wp) <= rangeM * 1.05, 'orbit stays in the home ring');
  }
  const ev = e.events[e.events.length - 1];
  assert.strictEqual(ev.code, 'TRACK_TASKED');
  assert.ok(/DIVERTED/.test(ev.message));

  // The diverted mission flies to completion and resolves the track.
  for (let i = 0; i < 3600 && track.status !== 'resolved'; i++) e.tick(1);
  assert.strictEqual(track.status, 'resolved');
});

test('divert never steals a drone serving a customer request', () => {
  const e = mkIsolated();
  // Fabricate a pending request from the only dock, approve it -> the sole
  // drone is now on request business and must not be divertable.
  e.requests.set('REQ-T1', {
    id: 'REQ-T1', customer: 'DMT', customerFull: 'X', type: 'security',
    place: 'ISOLATED', coords: [54.01, 23.51], priority: 'ROUTINE',
    params: { altM: 80, speedMs: 12 }, requestedAt: e.now, status: 'pending',
    dockId: 'ISO-001',
    waypoints: globalThis.SimRouter.orbit([54.01, 23.51], 400, 12),
    missionId: null
  });
  e.approveRequest('REQ-T1');
  for (let i = 0; i < 40; i++) e.tick(1);
  syntheticTrack(e, [54.005, 23.505]);
  assert.throws(() => e.taskTrack('TRK-T1'), /NO READY DOCK IN RANGE/);
});
