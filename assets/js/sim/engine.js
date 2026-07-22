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

function generateRoute(R, roads, rnd, pattern, dock, type){
  switch (pattern){
    case 'perimeter': {
      const r = 1500 + rnd() * (4000 - 1500);
      return R.perimeter(dock.coords, r, 10);
    }
    case 'orbit': {
      const center = randomOffsetPoint(rnd, dock.coords, 3000);
      const r = 300 + rnd() * (800 - 300);
      return R.orbit(center, r, 16);
    }
    case 'lawnmower': {
      const center = randomOffsetPoint(rnd, dock.coords, 4000);
      const widthKm = 1 + rnd() * 1.5;
      const heightKm = 1 + rnd() * 1.5;
      return R.lawnmower(center, widthKm, heightKm, 150, rnd() * 360);
    }
    case 'corridor': {
      const road = nearestRoad(roads, dock.coords);
      if (!road) return null;
      const startFrac = rnd() * 0.6;
      const lengthKm = 6 + rnd() * 12;
      return R.corridor(road.geometry.coordinates, startFrac, lengthKm);
    }
    case 'atob': {
      if (type === 'delivery'){
        const candidates = [];
        for (const d of (dock._allDocks || [])){
          if (d.id === dock.id) continue;
          if (R.distM(dock.coords, d.coords) <= 40000) candidates.push(d);
        }
        if (candidates.length){
          const target = pick(rnd, candidates);
          return R.atob(dock.coords, target.coords);
        }
        const fallback = randomOffsetPoint(rnd, dock.coords, 12000, 2000);
        return R.atob(dock.coords, fallback);
      }
      const target = randomOffsetPoint(rnd, dock.coords, 12000);
      return R.atob(dock.coords, target);
    }
    default:
      return null;
  }
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
    events: [],
    roads: roads,
    rand: mulberry32(42),
    airborneTarget: AIRBORNE_TARGET,
    _schedAcc: 0,
    _ambientAcc: 0,
    _ambientIdx: 0,
    _missionSeq: 0,
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
  function emit(level, source, message){
    const ev = { time: engine.now, level: level, source: source, message: message };
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
      emit('warn', drone.id, drone.id + ' BATTERY ' + Math.round(drone.battery) + '% · FORCED RTB');
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
        emit('warn', drone.id, 'BATTERY FLOOR · MANUAL RELEASED · RTB');
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

    emit('info', drone.id, drone.id + ' LAUNCHED · ' + config.label + ' FROM ' + String(dock.name).toUpperCase());
    return mission;
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
    emit('info', drone.id, 'MANUAL CONTROL RELEASED · OPERATOR');
    return true;
  };

  // Replaces the queue with a single destination (click-to-go).
  engine.manualGoto = function(id, lonlat){
    const drone = engine.drones.get(id);
    if (!drone || drone.state !== 'manual' || !isFiniteXY(lonlat)) return false;
    drone._manualQueue = [clampPos(lonlat)];
    return true;
  };

  // Appends a destination to the queue (shift+click-to-queue).
  engine.manualQueue = function(id, lonlat){
    const drone = engine.drones.get(id);
    if (!drone || drone.state !== 'manual' || !isFiniteXY(lonlat)) return false;
    if (!drone._manualQueue) drone._manualQueue = [];
    drone._manualQueue.push(clampPos(lonlat));
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

    const eligible = [];
    for (const dock of engine.docks.values()){
      if (dock.state === 'ready' && dock.battery >= SCHED_MIN_BATTERY && dock.drone && dock.drone.state === 'docked'){
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
