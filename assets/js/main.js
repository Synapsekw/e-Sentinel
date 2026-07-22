window.EC2 = {
  state: { scene: 'globe', layer: 'dark', selection: null, timeScale: 1, offline: false },
  init(){
    try{
      if(typeof maplibregl === 'undefined') throw new Error('maplibre missing');
      EC2.initMap();
    }catch(err){
      console.error(err);
      document.getElementById('boot-error').hidden = false;
    }
  }
};
