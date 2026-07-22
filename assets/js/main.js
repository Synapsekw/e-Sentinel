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

  // Classifies a raw engine event into a ticker severity. Forced RTBs and
  // dock faults are the "something needs attention now" tier; wind holds
  // and low-battery notices are advisories; everything else is routine.
  eventLevel(ev){
    if (/FORCED RTB|FAULT DETECTED/.test(ev.message)) return 'alert';
    if (/HOLDING|BATTERY/.test(ev.message)) return 'warn';
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
    });

    let lastReal = performance.now();
    let lastStatsAt = 0;
    function frame(ts){
      const dtReal = Math.min(0.1, Math.max(0, (ts - lastReal) / 1000));
      lastReal = ts;
      engine.tick(dtReal * EC2.state.timeScale);
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
