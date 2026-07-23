window.EC2 = {
  state: { scene: 'globe', layer: 'dark', selection: null, timeScale: 1, offline: false },
  init(){
    try{
      if(typeof maplibregl === 'undefined') throw new Error('maplibre missing');
      EC2.initMap();
      EC2.mapReady.then(() => {
        EC2.initGlobe && EC2.initGlobe();
        EC2.initPanels && EC2.initPanels();
        EC2.initControl && EC2.initControl();
        // Start the sim engine the first time the console scene is entered
        // (i.e. after the first dive-in from the globe), then leave it running.
        EC2.onSceneChange(scene => {
          if (scene === 'console' && !window.__engine) EC2.startEngine();
        });
      }).catch(err => {
        console.error(err);
        document.getElementById('boot-error').hidden = false;
      });
    }catch(err){
      console.error(err);
      document.getElementById('boot-error').hidden = false;
    }
  },

  // Ticker severity comes straight from the engine's own level — the engine
  // emits 'alert' for forced RTB / dock faults and 'warn' for advisories.
  eventLevel(ev){
    if (ev.level === 'alert' || ev.level === 'warn') return ev.level;
    return 'info';
  },

  // Airborne/ready/charging/alert counts derived straight from live engine
  // state; drives both the header chips and the sidebar grid-stats tiles.
  refreshCounts(engine){
    let ready = 0, charging = 0, alertDocks = 0, airborne = 0;
    for (const dock of engine.docks.values()){
      if (dock.state === 'ready') ready++;
      else if (dock.state === 'charging') charging++;
      else if (dock.state === 'fault' || dock.state === 'offline') alertDocks++;
    }
    for (const drone of engine.drones.values()){
      if (drone.state !== 'docked') airborne++;
    }
    EC2.ui.setStats({
      ready, flying: airborne, charge: charging, alert: alertDocks,
      airborne, alerts: alertDocks
    });
  },

  startEngine(){
    if (window.__engine) return;
    const engine = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads });
    window.__engine = engine;

    engine.onEvent(ev => {
      EC2.ui.pushEvent({ level: EC2.eventLevel(ev), source: ev.source, message: ev.message });
      if (ev.code === 'MISSION_LAUNCHED' && EC2.launchPulse && ev.dockId) EC2.launchPulse(ev.dockId);
    });

    // Sim ticking runs off setInterval + wall clock, not rAF: browsers throttle
    // rAF in background tabs (projector handoffs froze sim time), while timers
    // keep firing. rAF below is rendering-only and may pause harmlessly.
    const SUB_STEP = 0.5;      // max sim seconds per engine.tick()
    const MAX_BACKLOG = 30;    // sim seconds; excess wall time is dropped
    let backlog = 0;
    let lastWall = performance.now();
    function absorbWallTime(){
      const now = performance.now();
      backlog = Math.min(MAX_BACKLOG, backlog + ((now - lastWall) / 1000) * EC2.state.timeScale);
      lastWall = now;
    }
    setInterval(() => {
      absorbWallTime();
      while (backlog > 1e-4){
        const step = Math.min(SUB_STEP, backlog);
        engine.tick(step);
        backlog -= step;
      }
    }, 250);
    // Timers can be suspended entirely (laptop sleep); clamp the accumulated
    // gap the moment the tab is visible again so there's no monster jump.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) absorbWallTime();
    });

    let lastStatsAt = 0;
    function frame(ts){
      if (EC2.updateLiveLayers) EC2.updateLiveLayers(engine);
      if (ts - lastStatsAt > 1000){
        lastStatsAt = ts;
        EC2.refreshCounts(engine);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
};
