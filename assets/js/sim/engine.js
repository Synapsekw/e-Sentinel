(function(g){
'use strict';

// ---------- constants ----------
const AIRBORNE_TARGET = 14;
const SCHED_INTERVAL_S = 8;
const AMBIENT_INTERVAL_S = 4;
const TAKEOFF_S = 20;
const LANDING_S = 20;
const FLIGHT_S_FULL = 40 * 60;           // 40 min full-battery flight
const DRAIN_PCT_PER_S = 100 / FLIGHT_S_FULL;
const CHARGE_PCT_PER_S = DRAIN_PCT_PER_S * 3;
const RTB_BATTERY_PCT = 25;
const SCHED_MIN_BATTERY = 60;
const EVENTS_CAP = 200;
// Contract C-1: user-supplied waypoints may exceed the dock's coverage
// radius by at most 5% (slack for the lon/lat-vs-meters approximation and
// clicks landing right on the drawn ring) before createMission rejects them.
const RANGE_TOLERANCE = 1.05;
const LON_MIN = 51.02, LON_MAX = 56.68, LAT_MIN = 22.42, LAT_MAX = 26.38;

const DETECTION_MSGS = {
  security:     id => id + ' FLAGGED VEHICLE ON PATROL SWEEP',
  infra:        id => id + ' THERMAL ANOMALY LOGGED',
  emergency:    id => id + ' SCENE ASSESSMENT UPDATED',
  delivery:     id => id + ' PAYLOAD STATUS NOMINAL',
  construction: id => id + ' SURVEY DATA CAPTURED',
  highway:      id => id + ' VEHICLE FLAGGED ON HIGHWAY SWEEP',
  parks:        id => id + ' VEGETATION STRESS ZONE FLAGGED'
};

// ---------- customer flight requests (contracts R-1..R-3) ----------
// Inbound tasking cadence: first request ~15s into the sim, then a seeded
// 45-90s interval, gated on the pending backlog so the operator is never
// buried (<=4 awaiting review) and the map stays bounded (<=20 kept).
const REQUEST_FIRST_S = 15;
const REQUEST_MIN_INTERVAL_S = 45;
const REQUEST_MAX_INTERVAL_S = 90;
const REQUEST_PENDING_MAX = 4;
const REQUESTS_KEEP = 20;

// Per-mission-type customer archetypes: [shortCode, fullName]. Short codes
// surface in the ticker/request rows; full names in the review panel.
const REQUEST_CUSTOMERS = {
  security:     [['ADP', 'ABU DHABI POLICE'], ['DXP', 'DUBAI POLICE']],
  infra:        [['DEWA', 'DUBAI ELECTRICITY & WATER'], ['ADNOC', 'ADNOC GROUP']],
  emergency:    [['NCEMA', 'NATIONAL EMERGENCY AUTHORITY'], ['DCD', 'DUBAI CIVIL DEFENCE']],
  delivery:     [['EMPOST', 'EMIRATES POST'], ['SEHA', 'ABU DHABI HEALTH SERVICES']],
  construction: [['EMAAR', 'EMAAR PROPERTIES'], ['ALDAR', 'ALDAR PROPERTIES']],
  highway:      [['RTA', 'ROADS & TRANSPORT AUTHORITY'], ['ITC', 'INTEGRATED TRANSPORT CENTRE']],
  parks:        [['DMT', 'DEPT OF MUNICIPALITIES & TRANSPORT'], ['DM', 'DUBAI MUNICIPALITY']]
};

// ---------- prng ----------
function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- helpers ----------
function isFiniteXY(p){ return Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]); }

function clampPos(p){
  return [
    Math.min(LON_MAX, Math.max(LON_MIN, p[0])),
    Math.min(LAT_MAX, Math.max(LAT_MIN, p[1]))
  ];
}

function pick(rnd, arr){ return arr[Math.floor(rnd() * arr.length)]; }

function randomOffsetPoint(rnd, center, maxM, minM){
  const R = (typeof window !== 'undefined' ? window : globalThis).SimRouter;
  const ang = rnd() * Math.PI * 2;
  const dist = (minM || 0) + rnd() * (maxM - (minM || 0));
  return R.offsetMeters(center, Math.cos(ang) * dist, Math.sin(ang) * dist);
}

function nearestRoad(roads, coords){
  const R = (typeof window !== 'undefined' ? window : globalThis).SimRouter;
  let best = null, bestD = Infinity;
  const features = (roads && roads.features) || [];
  for (const f of features){
    const line = f && f.geometry && f.geometry.coordinates;
    if (!Array.isArray(line)) continue;
    for (const v of line){
      if (!isFiniteXY(v)) continue;
      const d = R.distM(coords, v);
      if (d < bestD){ bestD = d; best = f; }
    }
  }
  return best;
}

// Operational reach of a dock in meters, from the shared classification in
// docks.js (urban 3 km, rural 5 km). Falls back to 5 km if that data module
// isn't loaded, so the engine still runs standalone.
function dockRangeM(dock){
  const DR = (typeof window !== 'undefined' ? window : globalThis).DOCK_RANGE;
  const km = DR && typeof DR.dockRangeKm === 'function' ? DR.dockRangeKm(dock) : 5;
  return km * 1000;
}

// Pulls any waypoint that sits beyond `rangeM` back onto (just inside) the
// coverage circle, along the line from the dock. This is the hard guarantee
// that no autonomous drone flies outside the ring the presenter sees; the
// per-pattern sizing below keeps routes comfortably inside so the clamp
// rarely has to bite and shapes stay natural. Target 0.97·range leaves slack
// for the lon/lat-vs-meters approximation used throughout.
function pullToRange(pt, center, rangeM){
  const R = (typeof window !== 'undefined' ? window : globalThis).SimRouter;
  const d = R.distM(center, pt);
  if (d <= rangeM) return pt;
  const t = (rangeM * 0.97) / d;
  return [center[0] + (pt[0] - center[0]) * t, center[1] + (pt[1] - center[1]) * t];
}

function clampToRange(route, center, rangeM){
  if (!Array.isArray(route)) return route;
  return route.map(pt => (isFiniteXY(pt) ? pullToRange(pt, center, rangeM) : pt));
}

// Builds a road-following corridor centered on the road's closest approach to
// the dock, so a highway/infra inspection hugs the nearby road rather than
// starting at a random fraction that could be far outside range.
function corridorNearDock(R, road, dockCoords, lengthKm){
  const line = road.geometry.coordinates;
  if (!Array.isArray(line) || line.length < 2) return null;
  let total = 0; const cum = [0];
  for (let i = 1; i < line.length; i++){ total += R.distM(line[i - 1], line[i]) / 1000; cum.push(total); }
  let bi = 0, bd = Infinity;
  for (let i = 0; i < line.length; i++){
    const d = R.distM(dockCoords, line[i]);
    if (d < bd){ bd = d; bi = i; }
  }
  const startKm = Math.max(0, cum[bi] - lengthKm / 2);
  const startFrac = total > 0 ? Math.min(0.99, startKm / total) : 0;
  return R.corridor(line, startFrac, lengthKm);
}

function generateRoute(R, roads, rnd, pattern, dock, type){
  const rangeM = dockRangeM(dock);
  let route = null;
  switch (pattern){
    case 'perimeter': {
      // Patrol ring around the dock, 55–90% of the coverage radius.
      const r = rangeM * (0.55 + rnd() * 0.35);
      route = R.perimeter(dock.coords, r, 10);
      break;
    }
    case 'orbit': {
      // Small orbit whose center offset plus radius stays inside coverage.
      const r = Math.min(300 + rnd() * 500, rangeM * 0.45);
      const center = randomOffsetPoint(rnd, dock.coords, Math.max(0, rangeM * 0.45 - r));
      route = R.orbit(center, r, 16);
      break;
    }
    case 'lawnmower': {
      // Survey box centered near the dock; box + offset kept within range so
      // the far corners don't punch through the coverage ring.
      const maxSideKm = (rangeM / 1000) * 0.85;
      const widthKm = Math.min(1 + rnd() * 1.5, maxSideKm);
      const heightKm = Math.min(1 + rnd() * 1.5, maxSideKm);
      const center = randomOffsetPoint(rnd, dock.coords, rangeM * 0.2);
      route = R.lawnmower(center, widthKm, heightKm, 150, rnd() * 360);
      break;
    }
    case 'corridor': {
      const road = nearestRoad(roads, dock.coords);
      if (!road) return null;
      // Corridor length capped to ~1.7× range and centered on the dock's
      // nearest road point, so both ends stay inside coverage after clamping.
      const lengthKm = Math.min(3 + rnd() * 6, (rangeM / 1000) * 1.7);
      route = corridorNearDock(R, road, dock.coords, lengthKm);
      break;
    }
    case 'atob': {
      if (type === 'delivery'){
        // Deliver to the nearest OTHER dock that's actually within range;
        // otherwise a point-to-point run to a spot inside coverage.
        let target = null, bestD = Infinity;
        for (const d of (dock._allDocks || [])){
          if (d.id === dock.id) continue;
          const dist = R.distM(dock.coords, d.coords);
          if (dist <= rangeM * 0.9 && dist < bestD){ bestD = dist; target = d.coords; }
        }
        if (!target) target = randomOffsetPoint(rnd, dock.coords, rangeM * 0.9, rangeM * 0.3);
        route = R.atob(dock.coords, target);
        break;
      }
      // First-response dash to a point inside coverage.
      route = R.atob(dock.coords, randomOffsetPoint(rnd, dock.coords, rangeM * 0.9, rangeM * 0.3));
      break;
    }
    default:
      return null;
  }
  return clampToRange(route, dock.coords, rangeM);
}

// ---------- engine factory ----------
function create(opts){
  opts = opts || {};
  const R = (typeof window !== 'undefined' ? window : globalThis).SimRouter;
  const MISSIONS_CONFIG = (typeof window !== 'undefined' ? window : globalThis).MISSIONS_CONFIG;
  const docksInput = opts.docks || [];
  const roads = opts.roads || { type: 'FeatureCollection', features: [] };

  const engine = {
    now: opts.now || 0,
    docks: new Map(),
    drones: new Map(),
    missions: new Map(),
    requests: new Map(),
    events: [],
    roads: roads,
    rand: mulberry32(42),
    airborneTarget: AIRBORNE_TARGET,
    _schedAcc: 0,
    _ambientAcc: 0,
    _ambientIdx: 0,
    _missionSeq: 0,
    // R-1: seq starts at 100 so the first inbound task reads REQ-101.
    _requestSeq: 100,
    _requestAcc: 0,
    _requestNextS: REQUEST_FIRST_S,
    _subscribers: []
  };

  // ---- boot docks + drones ----
  const allDocksList = [];
  for (const src of docksInput){
    if (!src || !src.id || !isFiniteXY(src.coords)) continue; // skip malformed
    const droneId = 'D-' + src.id;
    const drone = {
      id: droneId,
      model: src.model || 'M4TD',
      dockId: src.id,
      pos: src.coords.slice(),
      alt: 0,
      heading: 0,
      speedMs: 0,
      battery: 100,
      state: 'docked',
      missionId: null,
      _leg: null,
      _legDistKm: 0.0001,
      _legProgress: 0,
      _timer: 0,
      _holdUntil: 0
    };
    const dock = {
      id: src.id,
      name: src.name || src.id,
      emirate: src.emirate || '',
      coords: src.coords.slice(),
      // Carried through so dockRangeM() can honor an explicit per-dock
      // override; when absent, range falls back to coords-based geography.
      urban: (typeof src.urban === 'boolean' ? src.urban : undefined),
      battery: 100,
      state: 'ready',
      drone: drone,
      _faultUntil: 0
    };
    engine.docks.set(dock.id, dock);
    engine.drones.set(droneId, drone);
    allDocksList.push(dock);
  }
  // used by the 'atob'/delivery route generator to find nearby docks
  for (const dock of allDocksList) dock._allDocks = allDocksList;

  // ---- events ----
  // code (optional) is a structured, stable identifier for events that UI
  // code needs to match on (e.g. control.js distinguishing a forced manual
  // release from any other event that happens to mention "RELEASED" in its
  // copy) — decoupling that matching from ticker wording so the message
  // string can be edited freely without silently breaking the UI seam.
  // extra (optional, contract C-2) is a bag of structured fields merged onto
  // the event object (e.g. { dockId } on MISSION_LAUNCHED) so subscribers can
  // act on identifiers without parsing the ticker copy. Existing 3/4-arg emit
  // calls are unaffected.
  function emit(level, source, message, code, extra){
    const ev = { time: engine.now, level: level, source: source, message: message };
    if (code) ev.code = code;
    if (extra) Object.assign(ev, extra);
    engine.events.push(ev);
    if (engine.events.length > EVENTS_CAP) engine.events.shift();
    for (const cb of engine._subscribers){
      try { cb(ev); } catch (e) { /* subscriber errors must not break the sim */ }
    }
  }
  engine.onEvent = function(cb){ engine._subscribers.push(cb); return cb; };

  // ---- mission lifecycle ----
  function finalizeMission(mission, drone){
    if (!mission || mission.state === 'complete') return;
    mission.state = 'complete';
    mission.completedAt = engine.now;
    mission.progress = 1;
    const config = MISSIONS_CONFIG[mission.type];
    try {
      mission.analytics = config.analytics(mission, engine.rand);
    } catch (e) {
      mission.analytics = {};
    }
    emit('info', drone.id, 'MISSION ' + mission.id + ' COMPLETE');
    // R-3 completion linkage: a mission born from a customer request closes
    // the loop here. Guarded on the request still existing (pruning may have
    // dropped it) and still 'approved' so a re-entrant finalize can't
    // double-fulfill.
    if (mission.requestId){
      const req = engine.requests.get(mission.requestId);
      if (req && req.status === 'approved'){
        req.status = 'completed';
        emit('info', 'OPS', 'REQUEST ' + req.id + ' FULFILLED · ' + req.customer,
          'REQUEST_FULFILLED', { requestId: req.id });
      }
    }
    pruneFinishedMissions();
  }

  // Bounds engine.missions growth over a long session: once more than 60
  // finished (non-active) missions have accumulated, evict the oldest ones
  // by completion order (mission.completedAt, set in finalizeMission when a
  // mission leaves 'active') rather than creation order, so a mission that
  // was created early but finished late (e.g. a long corridor run) isn't
  // evicted ahead of missions that both started and finished earlier.
  // Active missions are never touched. panels.js keeps its own independent
  // sessionMissions list (with its own cap) for the MEDIA library, so this
  // only affects the engine's live working set.
  const MISSIONS_KEEP = 60;
  function pruneFinishedMissions(){
    const finished = [];
    for (const m of engine.missions.values()){
      if (m.state !== 'active') finished.push(m);
    }
    const excess = finished.length - MISSIONS_KEEP;
    if (excess <= 0) return;
    finished.sort((a, b) => (a.completedAt || 0) - (b.completedAt || 0));
    for (let i = 0; i < excess; i++) engine.missions.delete(finished[i].id);
  }

  function beginRtb(drone, dock, mission, forced){
    if (mission) finalizeMission(mission, drone);
    drone.state = 'rtb';
    const leg = R.atob(drone.pos, dock.coords);
    drone._leg = leg;
    drone._legDistKm = R.pathLengthKm(leg) || 0.0001;
    drone._legProgress = 0;
    if (forced){
      // Battery-floor RTB is a safety intervention, not an advisory — alert
      // level so the UI can escalate it (main.js trusts ev.level directly).
      emit('alert', drone.id, drone.id + ' BATTERY ' + Math.round(drone.battery) + '% · FORCED RTB');
    }
  }

  function advanceLeg(drone, dt){
    const distKm = drone._legDistKm || 0.0001;
    drone._legProgress = Math.min(1, drone._legProgress + (drone.speedMs * dt) / 1000 / distKm);
    const res = R.pointAlong(drone._leg, drone._legProgress);
    if (res && isFiniteXY(res.pos)){
      drone.pos = clampPos(res.pos);
      if (Number.isFinite(res.heading)) drone.heading = res.heading;
    }
  }

  // Denser milestone grid (every 10%) than the original 25/50/75 — keeps the
  // ticker feeling alive at 16x now that detection chatter (below) is
  // throttled for readability, without inflating detection-specific spam.
  const MILESTONE_PCTS = [10, 20, 30, 40, 50, 60, 70, 80, 90];
  function checkMilestones(mission, drone){
    for (const pct of MILESTONE_PCTS){
      if (!mission._milestones[pct] && mission.progress * 100 >= pct){
        mission._milestones[pct] = true;
        emit('info', drone.id, 'MISSION ' + mission.id + ' ' + pct + '% COMPLETE');
      }
    }
  }

  function emitDetection(mission, drone){
    const fn = DETECTION_MSGS[mission.type];
    if (!fn) return;
    emit('info', drone.id, fn(drone.id));
  }

  function updateDrone(drone, dt){
    const dock = engine.docks.get(drone.dockId);
    if (!dock) return;

    if (drone.state === 'docked'){
      if (dock.state === 'charging' && drone.battery < 100){
        drone.battery = Math.min(100, drone.battery + CHARGE_PCT_PER_S * dt);
        if (drone.battery >= 100) dock.state = 'ready';
      }
      return;
    }

    // wind-hold resume
    if (drone._holdUntil && engine.now >= drone._holdUntil){
      drone._holdUntil = 0;
      if (drone.state !== 'hold'){
        emit('info', drone.id, drone.id + ' RESUMING · WIND ADVISORY CLEARED');
      }
    }

    // battery drains in every airborne state
    drone.battery = Math.max(0, drone.battery - DRAIN_PCT_PER_S * dt);

    const mission = drone.missionId ? engine.missions.get(drone.missionId) : null;

    // forced RTB guard: never let a flight continue past the reserve floor
    // (applies to a manually-held drone too — a paused drone that bleeds out
    // its reserve still gets pulled home). A manually-flown drone (Task 11)
    // gets pulled home too, releasing the operator's control first.
    if (drone.battery <= RTB_BATTERY_PCT &&
        (drone.state === 'takeoff' || drone.state === 'transit' ||
         drone.state === 'on-task' || drone.state === 'hold' || drone.state === 'manual')){
      const wasManual = drone.state === 'manual';
      drone._preHoldState = null;
      if (wasManual){
        drone._manualQueue = [];
        drone._preManualState = null;
        drone._manualSpeed = 0;
        emit('alert', drone.id, 'BATTERY FLOOR · MANUAL RELEASED · RTB', 'MANUAL_RELEASED');
        beginRtb(drone, dock, mission, false);
      } else {
        beginRtb(drone, dock, mission, true);
      }
      return;
    }

    // random wind hold while actually flying a leg
    if (!drone._holdUntil &&
        (drone.state === 'transit' || drone.state === 'on-task' || drone.state === 'rtb') &&
        engine.rand() < dt / 3000){
      drone._holdUntil = engine.now + 60;
      emit('warn', drone.id, drone.id + ' HOLDING · WIND ADVISORY');
    }
    const holding = !!(drone._holdUntil && engine.now < drone._holdUntil);
    if (holding) return;

    switch (drone.state){
      case 'takeoff': {
        drone._timer -= dt;
        if (drone._timer <= 0 && mission){
          drone.state = 'transit';
          drone.speedMs = mission.params.speedMs;
          drone._leg = [dock.coords.slice(), mission.waypoints[0]];
          drone._legDistKm = R.pathLengthKm(drone._leg) || 0.0001;
          drone._legProgress = 0;
          dock.state = 'drone-away';
        }
        break;
      }
      case 'transit': {
        if (!mission){ drone.state = 'docked'; break; }
        advanceLeg(drone, dt);
        if (drone._legProgress >= 1){
          drone.state = 'on-task';
          drone._leg = mission.waypoints;
          drone._legDistKm = mission.distanceKm || R.pathLengthKm(mission.waypoints) || 0.0001;
          drone._legProgress = 0;
          mission.progress = 0;
        }
        break;
      }
      case 'on-task': {
        if (!mission){ beginRtb(drone, dock, null, false); break; }
        advanceLeg(drone, dt);
        mission.progress = drone._legProgress;
        checkMilestones(mission, drone);
        if (engine.rand() < dt * 0.0067) emitDetection(mission, drone);
        if (drone._legProgress >= 1) beginRtb(drone, dock, mission, false);
        break;
      }
      case 'rtb': {
        advanceLeg(drone, dt);
        if (drone._legProgress >= 1){
          drone.state = 'landing';
          drone._timer = LANDING_S;
          drone.pos = dock.coords.slice();
          dock.state = 'landing';
          emit('info', drone.id, drone.id + ' LANDING AT ' + dock.id);
        }
        break;
      }
      case 'landing': {
        drone._timer -= dt;
        if (drone._timer <= 0){
          drone.state = 'docked';
          drone.missionId = null;
          drone.pos = dock.coords.slice();
          drone.heading = 0;
          drone.alt = 0;
          drone.speedMs = 0;
          dock.state = drone.battery < 100 ? 'charging' : 'ready';
        }
        break;
      }
      case 'hold': {
        // Manual pause (Task 10): battery already drained above, leg/mission
        // progress intentionally untouched until commandHold(id, false).
        break;
      }
      case 'manual': {
        // Operator-flown (Task 11): fly toward the head of the waypoint
        // queue at a capped speed; pop on arrival; hover (speed 0, gentle
        // heading wobble) once the queue drains. Mission leg/progress are
        // left exactly as they were when manual was engaged, so a release
        // back into the mission resumes from that frozen point.
        const queue = drone._manualQueue || (drone._manualQueue = []);
        if (queue.length){
          const target = queue[0];
          const dist = R.distM(drone.pos, target);
          if (dist <= 30){
            queue.shift();
            drone.speedMs = queue.length ? (drone._manualSpeed || 12) : 0;
          } else {
            const spd = drone._manualSpeed || 12;
            drone.speedMs = spd;
            drone.heading = R.bearing(drone.pos, target);
            const stepM = spd * dt;
            const frac = Math.min(1, stepM / dist);
            drone.pos = clampPos([
              drone.pos[0] + (target[0] - drone.pos[0]) * frac,
              drone.pos[1] + (target[1] - drone.pos[1]) * frac
            ]);
          }
        } else {
          drone.speedMs = 0;
          drone.heading = ((drone.heading + (engine.rand() - 0.5) * 8) % 360 + 360) % 360;
        }
        break;
      }
    }
  }

  // ---- mission creation (shared by wizard + scheduler) ----
  engine.createMission = function(spec){
    spec = spec || {};
    const type = spec.type;
    const config = MISSIONS_CONFIG && MISSIONS_CONFIG[type];
    if (!config) throw new Error('Unknown mission type: ' + type);
    const dock = engine.docks.get(spec.dockId);
    if (!dock) throw new Error('Unknown dock: ' + spec.dockId);
    const drone = dock.drone;
    if (!drone || drone.state !== 'docked') throw new Error('Drone not available at ' + spec.dockId);

    const waypoints = spec.waypoints;
    if (!Array.isArray(waypoints) || waypoints.length < 2 || !waypoints.every(isFiniteXY)){
      throw new Error('Invalid waypoints for mission');
    }
    // Contract C-1: every waypoint must sit inside the dock's coverage ring
    // (plus tolerance). Auto-generated routes are pre-clamped to 0.97×range
    // by clampToRange, so only user-supplied routes can ever trip this.
    const rangeM = dockRangeM(dock);
    for (const wp of waypoints){
      if (R.distM(dock.coords, wp) > rangeM * RANGE_TOLERANCE){
        throw new Error('WAYPOINT OUTSIDE COVERAGE');
      }
    }
    const params = Object.assign({}, config.defaults, spec.params || {});
    if (!Number.isFinite(params.speedMs) || params.speedMs <= 0) params.speedMs = config.defaults.speedMs;
    if (!Number.isFinite(params.altM) || params.altM <= 0) params.altM = config.defaults.altM;

    const distanceKm = R.pathLengthKm(waypoints);
    if (!Number.isFinite(distanceKm) || distanceKm <= 0){
      throw new Error('Degenerate route (zero length)');
    }
    const durationS = Math.round((distanceKm * 1000) / params.speedMs) + TAKEOFF_S + LANDING_S;

    engine._missionSeq += 1;
    const mission = {
      id: 'M-' + spec.dockId + '-' + engine._missionSeq,
      type: type,
      dockId: spec.dockId,
      waypoints: waypoints,
      params: { altM: params.altM, speedMs: params.speedMs },
      progress: 0,
      state: 'active',
      analytics: null,
      startedAt: engine.now,
      distanceKm: distanceKm,
      durationS: durationS,
      _milestones: {}
    };
    engine.missions.set(mission.id, mission);

    drone.missionId = mission.id;
    drone.speedMs = params.speedMs;
    drone.alt = params.altM;
    drone.state = 'takeoff';
    drone._timer = TAKEOFF_S;
    drone._legProgress = 0;
    dock.state = 'launching';

    emit('info', drone.id,
      drone.id + ' LAUNCHED · ' + config.label + ' FROM ' + String(dock.name).toUpperCase(),
      'MISSION_LAUNCHED', { dockId: dock.id });
    return mission;
  };

  // Launch a ready-made mission of a given type without hand-placing
  // waypoints — the same route generator + createMission path the scheduler
  // uses, exposed so the UI's predefined-mission menu can fire one in a
  // single click. opts.dockId forces a specific dock; opts.near ([lon,lat])
  // biases dock choice toward that point; otherwise picks any eligible ready
  // dock. Returns the launched mission, or throws if nothing is available.
  engine.launchPreset = function(type, opts){
    opts = opts || {};
    const config = MISSIONS_CONFIG && MISSIONS_CONFIG[type];
    if (!config) throw new Error('Unknown mission type: ' + type);

    // Candidate docks: ready, charged, with a docked drone, and not reserved
    // for a pending customer request (an explicit opts.dockId overrides the
    // reservation — the operator asked for that dock by name).
    let candidates;
    if (opts.dockId){
      const forced = engine.docks.get(opts.dockId);
      candidates = forced ? [forced] : [];
    } else {
      const reserved = reservedDockIds();
      candidates = [];
      for (const dock of engine.docks.values()){
        if (dock.state === 'ready' && dock.battery >= SCHED_MIN_BATTERY &&
            dock.drone && dock.drone.state === 'docked' && !reserved.has(dock.id)){
          candidates.push(dock);
        }
      }
    }
    if (!candidates.length) throw new Error('No ready dock available');

    // Prefer the eligible dock nearest opts.near, so a preset can land in a
    // recognizable city rather than a random emirate. Otherwise keep the
    // natural (insertion) order and try each until a route generates.
    if (opts.near && isFiniteXY(opts.near)){
      candidates = candidates.slice().sort((a, b) =>
        R.distM(a.coords, opts.near) - R.distM(b.coords, opts.near));
    }

    let lastErr = null;
    for (const dock of candidates){
      // generateRoute is stochastic (corridor/atob can miss); give each dock
      // a few attempts before moving on to the next candidate.
      for (let attempt = 0; attempt < 4; attempt++){
        const waypoints = generateRoute(R, roads, engine.rand, config.pattern, dock, type);
        if (!waypoints || waypoints.length < 2) continue;
        try {
          return engine.createMission({
            type: type,
            dockId: dock.id,
            waypoints: waypoints,
            params: { altM: config.defaults.altM, speedMs: config.defaults.speedMs }
          });
        } catch (e) { lastErr = e; }
      }
    }
    throw lastErr || new Error('Could not generate a route for ' + type);
  };

  // ---- customer flight requests (contracts R-1..R-3) ----

  // Plans a route for a request, centered on the REQUEST point (not the dock
  // like generateRoute) so the flight visibly serves the customer's location.
  // Pattern sizing leans on the margin left between the request point and the
  // dock's coverage ring; clampToRange then hard-guarantees every waypoint
  // sits at <=0.97x range, so createMission (tolerance 1.05x) always accepts.
  function planRequestRoute(request, dock){
    const config = MISSIONS_CONFIG && MISSIONS_CONFIG[request.type];
    if (!config) return null;
    const rangeM = dockRangeM(dock);
    // Meters of slack between the request point and the coverage ring —
    // pattern radii are capped by it so shapes rarely need the clamp to bite.
    const marginM = Math.max(150, rangeM * 0.97 - R.distM(dock.coords, request.coords));
    let route = null;
    switch (config.pattern){
      case 'perimeter': {
        const r = Math.min(600 + engine.rand() * 600, marginM);
        route = R.perimeter(request.coords, r, 10);
        break;
      }
      case 'orbit': {
        const r = Math.min(450, Math.max(150, marginM));
        route = R.orbit(request.coords, r, 16);
        break;
      }
      case 'lawnmower': {
        // ~0.8-1.2km survey box over the request area; half-diagonal capped
        // by the remaining margin so the far corners stay inside coverage.
        const maxSideKm = Math.max(0.4, (marginM * 2) / 1000 / 1.5);
        const sideKm = Math.min(0.8 + engine.rand() * 0.4, maxSideKm);
        route = R.lawnmower(request.coords, sideKm, sideKm, 150, engine.rand() * 360);
        break;
      }
      case 'corridor': {
        const road = nearestRoad(roads, request.coords);
        if (road){
          const lengthKm = Math.min(2 + engine.rand() * 2, (rangeM / 1000) * 1.5);
          route = corridorNearDock(R, road, request.coords, lengthKm);
        }
        // No road nearby (or degenerate slice): inspect the area's perimeter
        // instead so the request is still serviceable.
        if (!route || route.length < 2){
          route = R.perimeter(request.coords, Math.min(600 + engine.rand() * 600, marginM), 10);
        }
        break;
      }
      case 'atob': {
        route = R.atob(dock.coords.slice(), request.coords.slice());
        break;
      }
      default:
        return null;
    }
    route = clampToRange(route, dock.coords, rangeM);
    if (!Array.isArray(route) || route.length < 2 || !route.every(isFiniteXY)) return null;
    if (!(R.pathLengthKm(route) > 0)) return null;
    return route;
  }

  // R-2 pruning: the map keeps at most REQUESTS_KEEP requests. Resolved
  // (non-pending) requests are evicted oldest-first; pending ones are never
  // touched — an operator must always get to rule on what they can see.
  // Dock ids currently spoken for by pending customer requests. The ambient
  // scheduler and dock-agnostic preset launches treat these as off-limits so
  // the drone a request was planned around is still docked when the operator
  // hits APPROVE (remote areas often have exactly one dock in range).
  function reservedDockIds(){
    const ids = new Set();
    for (const r of engine.requests.values()){
      if (r.status === 'pending' && r.dockId) ids.add(r.dockId);
    }
    return ids;
  }

  function pruneRequests(){
    let excess = engine.requests.size - REQUESTS_KEEP;
    if (excess <= 0) return;
    const resolved = [];
    for (const r of engine.requests.values()){
      if (r.status !== 'pending') resolved.push(r);
    }
    resolved.sort((a, b) => (a.requestedAt || 0) - (b.requestedAt || 0));
    for (const r of resolved){
      if (excess <= 0) break;
      engine.requests.delete(r.id);
      excess--;
    }
  }

  // One spawn attempt per accumulator firing. Silent skips (no eligible dock,
  // failed planning) are fine — the next firing retries with fresh picks.
  function runRequestPass(){
    let pending = 0;
    for (const r of engine.requests.values()) if (r.status === 'pending') pending++;
    if (pending >= REQUEST_PENDING_MAX) return;

    const candidates = [];
    for (const dock of engine.docks.values()){
      if (dock.drone && dock.drone.state === 'docked') candidates.push(dock);
    }
    if (!candidates.length) return;

    const dock = pick(engine.rand, candidates);
    const type = pick(engine.rand, Object.keys(MISSIONS_CONFIG));
    const config = MISSIONS_CONFIG[type];
    const rangeM = dockRangeM(dock);
    // 0.15-0.55x range from the dock: far enough out to be a real tasking,
    // close enough that every route pattern fits around the point.
    const coords = randomOffsetPoint(engine.rand, dock.coords, rangeM * 0.55, rangeM * 0.15);
    const customer = pick(engine.rand, REQUEST_CUSTOMERS[type] || [['OPS', 'OPERATIONS']]);
    const priority = type === 'emergency' ? 'URGENT'
      : (engine.rand() < 0.3 ? 'PRIORITY' : 'ROUTINE');
    const altM = Math.round(Math.min(120, Math.max(40,
      config.defaults.altM + (engine.rand() * 2 - 1) * 20)));
    const speedMs = Math.round(Math.min(21, Math.max(5,
      config.defaults.speedMs + (engine.rand() * 2 - 1) * 2)) * 10) / 10;

    const request = {
      id: null,
      customer: customer[0],
      customerFull: customer[1],
      type: type,
      place: String(dock.name).toUpperCase(),
      coords: coords,
      priority: priority,
      params: { altM: altM, speedMs: speedMs },
      requestedAt: engine.now,
      status: 'pending',
      dockId: dock.id,
      waypoints: null,
      missionId: null
    };
    const waypoints = planRequestRoute(request, dock);
    if (!waypoints) return; // silent skip; next pass retries
    request.waypoints = waypoints;

    engine._requestSeq += 1;
    request.id = 'REQ-' + engine._requestSeq;
    engine.requests.set(request.id, request);
    emit('warn', 'OPS',
      'FLIGHT REQUEST · ' + request.customer + ' · ' + config.label + ' · ' + request.place,
      'FLIGHT_REQUEST', { requestId: request.id });
    pruneRequests();
  }

  // Ready-to-launch: same eligibility bar the scheduler and launchPreset use.
  function dockEligible(dock){
    return !!(dock && dock.state === 'ready' && dock.battery >= SCHED_MIN_BATTERY &&
      dock.drone && dock.drone.state === 'docked');
  }

  // R-3: operator approves a pending request -> mission is created and the
  // drone launches. If the pre-assigned dock is no longer ready, the request
  // is re-planned from the nearest eligible dock that can cover the point
  // (0.9x range margin; planRequestRoute's clamp keeps the pattern inside
  // coverage regardless); with none available the approval fails loudly so
  // the UI can surface it.
  engine.approveRequest = function(id){
    const request = engine.requests.get(id);
    if (!request || request.status !== 'pending') throw new Error('Request not pending');

    let dock = engine.docks.get(request.dockId);
    let waypoints = request.waypoints;
    if (!dockEligible(dock)){
      let best = null, bestD = Infinity;
      for (const d of engine.docks.values()){
        if (!dockEligible(d)) continue;
        const dist = R.distM(d.coords, request.coords);
        if (dist <= dockRangeM(d) * 0.9 && dist < bestD){ bestD = dist; best = d; }
      }
      const replanned = best ? planRequestRoute(request, best) : null;
      if (!replanned) throw new Error('NO READY DOCK IN RANGE');
      dock = best;
      waypoints = replanned;
    }

    const mission = engine.createMission({
      type: request.type,
      dockId: dock.id,
      waypoints: waypoints,
      params: { altM: request.params.altM, speedMs: request.params.speedMs }
    });
    // Stamped on the mission (not just the request) so debrief/UI copy like
    // 'REQUESTED BY · DMT' survives request pruning without a lookup.
    mission.requestId = request.id;
    mission.requestedBy = request.customer;
    request.dockId = dock.id;
    request.waypoints = waypoints;
    request.missionId = mission.id;
    request.status = 'approved';
    emit('info', 'OPS',
      'REQUEST ' + request.id + ' APPROVED · LAUNCHING ' + dock.drone.id,
      'REQUEST_APPROVED', { requestId: request.id, dockId: dock.id });
    return mission;
  };

  engine.declineRequest = function(id){
    const request = engine.requests.get(id);
    if (!request || request.status !== 'pending') return false;
    request.status = 'declined';
    emit('info', 'OPS', 'REQUEST ' + request.id + ' DECLINED · ' + request.customer,
      'REQUEST_DECLINED', { requestId: request.id });
    return true;
  };

  // ---- manual operator commands (Task 10) ----

  // Sends an in-flight drone home immediately. Valid while it's actually
  // flying a leg (transit/on-task) or manually held — not during takeoff/
  // landing/rtb/docked, which are already resolving on their own.
  engine.commandRTB = function(id){
    const drone = engine.drones.get(id);
    if (!drone) return false;
    if (drone.state !== 'transit' && drone.state !== 'on-task' && drone.state !== 'hold') return false;
    const dock = engine.docks.get(drone.dockId);
    if (!dock) return false;
    const mission = drone.missionId ? engine.missions.get(drone.missionId) : null;
    drone._preHoldState = null;
    beginRtb(drone, dock, mission, false);
    emit('info', drone.id, 'MANUAL RTB COMMAND · ' + drone.id);
    return true;
  };

  // on=true freezes the drone in place (state 'hold', remembering what it
  // was doing) — leg advance/mission progress are skipped in updateDrone's
  // switch while battery keeps draining above. on=false resumes whatever
  // state it was holding from.
  engine.commandHold = function(id, on){
    const drone = engine.drones.get(id);
    if (!drone) return false;
    if (on){
      if (drone.state !== 'transit' && drone.state !== 'on-task') return false;
      drone._preHoldState = drone.state;
      drone.state = 'hold';
      emit('info', drone.id, 'MANUAL HOLD COMMAND · ' + drone.id);
      return true;
    }
    if (drone.state !== 'hold') return false;
    drone.state = drone._preHoldState;
    drone._preHoldState = null;
    emit('info', drone.id, 'MANUAL RESUME COMMAND · ' + drone.id);
    return true;
  };

  // ---- manual flight control (Task 11) ----

  // on=true hands the drone to the operator from transit/on-task/hold —
  // remembers the mission state it was pulled from, clears any wind-hold,
  // and starts it hovering (empty queue) in place. on=false hands it back:
  // if the mission is still active it resumes exactly where its leg/progress
  // was frozen (a visible "rejoin the route" snap is expected and fine for
  // this sim); otherwise it heads home like any other released flight.
  engine.setManual = function(id, on){
    const drone = engine.drones.get(id);
    if (!drone) return false;
    const dock = engine.docks.get(drone.dockId);
    if (!dock) return false;
    const mission = drone.missionId ? engine.missions.get(drone.missionId) : null;

    if (on){
      if (drone.state !== 'transit' && drone.state !== 'on-task' && drone.state !== 'hold') return false;
      drone._preManualState = drone.state === 'hold' ? drone._preHoldState : drone.state;
      drone._preHoldState = null;
      drone._holdUntil = 0;
      drone._manualQueue = [];
      drone._manualSpeed = Math.min(18, (mission && mission.params && mission.params.speedMs) || drone.speedMs || 12);
      drone.state = 'manual';
      drone.speedMs = 0;
      emit('info', drone.id, 'MANUAL CONTROL ENGAGED · OPERATOR');
      return true;
    }

    if (drone.state !== 'manual') return false;
    drone._manualQueue = [];
    if (mission && mission.state === 'active'){
      drone.state = drone._preManualState || 'on-task';
    } else {
      beginRtb(drone, dock, mission, false);
    }
    drone._preManualState = null;
    emit('info', drone.id, 'MANUAL CONTROL RELEASED · OPERATOR', 'MANUAL_RELEASED');
    return true;
  };

  // Manual click-to-fly targets get the same containment guarantee as
  // auto-generated routes: a click outside the home dock's coverage ring is
  // pulled back onto it (0.97×range along the dock→click line) rather than
  // accepted raw — the command still succeeds, just clamped.
  function manualTarget(drone, lonlat){
    const pt = clampPos(lonlat);
    const dock = engine.docks.get(drone.dockId);
    if (!dock) return pt;
    return pullToRange(pt, dock.coords, dockRangeM(dock));
  }

  // Replaces the queue with a single destination (click-to-go).
  engine.manualGoto = function(id, lonlat){
    const drone = engine.drones.get(id);
    if (!drone || drone.state !== 'manual' || !isFiniteXY(lonlat)) return false;
    drone._manualQueue = [manualTarget(drone, lonlat)];
    return true;
  };

  // Appends a destination to the queue (shift+click-to-queue).
  engine.manualQueue = function(id, lonlat){
    const drone = engine.drones.get(id);
    if (!drone || drone.state !== 'manual' || !isFiniteXY(lonlat)) return false;
    if (!drone._manualQueue) drone._manualQueue = [];
    drone._manualQueue.push(manualTarget(drone, lonlat));
    return true;
  };

  // Altitude nudge, clamped to the 30-120m operating band regardless of state.
  engine.nudgeAlt = function(id, delta){
    const drone = engine.drones.get(id);
    if (!drone || !Number.isFinite(delta)) return false;
    drone.alt = Math.min(120, Math.max(30, drone.alt + delta));
    return true;
  };

  // ---- ambient ticker stream ----
  // Low-priority, always-on filler so the ticker's worst-case gap is bounded
  // by construction (spec: ticker updates <=5s of sim time), independent of
  // how sparse mission/detection events are tuned to be. Rotates through a
  // small fixed set of quiet ops-floor lines deterministically (index
  // counter), touching engine.rand only for the random dock pick.
  function ambientGrid(){
    let airborne = 0, ready = 0;
    for (const d of engine.drones.values()) if (d.state !== 'docked') airborne++;
    for (const dk of engine.docks.values()) if (dk.state === 'ready') ready++;
    return 'GRID · ' + airborne + ' AIRBORNE · ' + ready + ' READY';
  }
  function ambientNetwork(){
    return 'NETWORK · E& 5G 99.98% · GCAA SYNC OK';
  }
  function ambientDock(){
    const docks = [...engine.docks.values()];
    if (!docks.length) return 'DOCK · BATTERY -- · NOMINAL';
    const dock = pick(engine.rand, docks);
    return 'DOCK ' + dock.id + ' · BATTERY ' + Math.round(dock.battery) + '% · NOMINAL';
  }
  function ambientUtm(){
    return 'UTM · FLIGHT PLANS SYNCED · ZERO CONFLICTS';
  }
  const AMBIENT_GENERATORS = [ambientGrid, ambientNetwork, ambientDock, ambientUtm];
  function runAmbientPass(){
    const gen = AMBIENT_GENERATORS[engine._ambientIdx % AMBIENT_GENERATORS.length];
    engine._ambientIdx += 1;
    emit('info', 'OPS', gen());
  }

  // ---- scheduler ----
  function runSchedulerPass(){
    let airborne = 0;
    for (const d of engine.drones.values()) if (d.state !== 'docked') airborne++;
    if (airborne >= engine.airborneTarget) return;

    // Docks assigned to pending customer requests are reserved: the ambient
    // scheduler must never take the drone a request is waiting on, or the
    // operator's APPROVE can fail through no fault of their own (remote
    // request areas often have exactly one dock in range).
    const reserved = reservedDockIds();
    const eligible = [];
    for (const dock of engine.docks.values()){
      if (dock.state === 'ready' && dock.battery >= SCHED_MIN_BATTERY && dock.drone && dock.drone.state === 'docked' && !reserved.has(dock.id)){
        eligible.push(dock);
      }
    }
    if (!eligible.length) return;

    const dock = pick(engine.rand, eligible);
    const types = Object.keys(MISSIONS_CONFIG);
    const type = pick(engine.rand, types);
    const config = MISSIONS_CONFIG[type];
    const waypoints = generateRoute(R, roads, engine.rand, config.pattern, dock, type);
    if (!waypoints || waypoints.length < 2) return;

    try {
      engine.createMission({
        type: type,
        dockId: dock.id,
        waypoints: waypoints,
        params: { altM: config.defaults.altM, speedMs: config.defaults.speedMs }
      });
    } catch (e) {
      // degenerate auto-generated route; skip this pass
    }
  }

  // ---- dock fault lifecycle ----
  function tickFaults(dt){
    if (engine.rand() < dt / 2000){
      const ready = [];
      for (const dock of engine.docks.values()) if (dock.state === 'ready') ready.push(dock);
      if (ready.length){
        const dock = pick(engine.rand, ready);
        dock.state = 'fault';
        dock._faultUntil = engine.now + 120;
        emit('alert', dock.id, dock.id + ' FAULT DETECTED · OFFLINE FOR SERVICE');
      }
    }
    for (const dock of engine.docks.values()){
      if (dock.state === 'fault' && engine.now >= dock._faultUntil){
        dock.state = 'ready';
        emit('info', dock.id, dock.id + ' FAULT CLEARED · BACK ONLINE');
      }
    }
  }

  // ---- main tick ----
  engine.tick = function(dt){
    if (!Number.isFinite(dt) || dt <= 0) return;
    engine.now += dt;

    engine._schedAcc += dt;
    while (engine._schedAcc >= SCHED_INTERVAL_S){
      engine._schedAcc -= SCHED_INTERVAL_S;
      runSchedulerPass();
    }

    engine._ambientAcc += dt;
    while (engine._ambientAcc >= AMBIENT_INTERVAL_S){
      engine._ambientAcc -= AMBIENT_INTERVAL_S;
      runAmbientPass();
    }

    // R-2: inbound customer tasking — first at ~15s, then a seeded 45-90s
    // cadence. The interval is re-rolled per firing (accumulator style, like
    // the scheduler) so a large dt catch-up can fire more than once.
    engine._requestAcc += dt;
    while (engine._requestAcc >= engine._requestNextS){
      engine._requestAcc -= engine._requestNextS;
      engine._requestNextS = REQUEST_MIN_INTERVAL_S +
        engine.rand() * (REQUEST_MAX_INTERVAL_S - REQUEST_MIN_INTERVAL_S);
      runRequestPass();
    }

    tickFaults(dt);

    for (const drone of engine.drones.values()) updateDrone(drone, dt);

    for (const dock of engine.docks.values()){
      if (dock.drone) dock.battery = dock.drone.battery;
    }
  };

  return engine;
}

g.SimEngine = { create: create, mulberry32: mulberry32 };
})(typeof window !== 'undefined' ? window : globalThis);
