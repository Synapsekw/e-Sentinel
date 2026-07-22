window.EC2 = {
  state: { scene: 'globe', layer: 'dark', selection: null, timeScale: 1, offline: false },
  init(){
    try{
      if(typeof maplibregl === 'undefined') throw new Error('maplibre missing');
      EC2.initMap();
      EC2.mapReady.then(() => {
        EC2.initGlobe && EC2.initGlobe();
        EC2.initPanels && EC2.initPanels();
      }).catch(err => {
        console.error(err);
        document.getElementById('boot-error').hidden = false;
      });
    }catch(err){
      console.error(err);
      document.getElementById('boot-error').hidden = false;
    }
  }
};
