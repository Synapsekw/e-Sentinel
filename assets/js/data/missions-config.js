(function(g){
g.MISSIONS_CONFIG = {
  security:     { label:'SECURITY PATROL',        pattern:'perimeter', defaults:{altM:80,speedMs:12},
    analytics:(m,r)=>({ detections:Math.floor(r()*4), platesFlagged:Math.floor(r()*3), coveragePct:92+Math.floor(r()*8) }) },
  infra:        { label:'INFRASTRUCTURE INSPECT', pattern:'corridor',  defaults:{altM:60,speedMs:10},
    analytics:(m,r)=>({ thermalAnomalies:Math.floor(r()*3), defectsMinor:Math.floor(r()*6), defectsMajor:Math.floor(r()*2), assetsScanned:Math.floor(m.distanceKm*4) }) },
  emergency:    { label:'FIRST RESPONSE',         pattern:'atob',      defaults:{altM:100,speedMs:19},
    analytics:(m,r)=>({ timeToSceneS:Math.round(m.durationS*0.6), sceneTags:['ACCESS CLEAR','2 VEHICLES','NO FIRE'].slice(0,1+Math.floor(r()*3)), unitsGuided:1+Math.floor(r()*3) }) },
  delivery:     { label:'DELIVERY RUN',           pattern:'atob',      defaults:{altM:90,speedMs:16},
    analytics:(m,r)=>({ payloadKg:+(0.5+r()*4).toFixed(1), etaDeltaS:Math.floor(r()*90-30), custody:['SEALED AT DOCK','IN TRANSIT','DELIVERED'] }) },
  construction: { label:'CONSTRUCTION SURVEY',    pattern:'lawnmower', defaults:{altM:110,speedMs:12},
    analytics:(m,r)=>({ areaHa:+(m.distanceKm*1.8).toFixed(1), progressPct:35+Math.floor(r()*60), volumeDeltaM3:Math.floor(r()*4000) }) },
  highway:      { label:'HIGHWAY INSPECTION',     pattern:'corridor',  defaults:{altM:100,speedMs:17},
    analytics:(m,r)=>({ vehiclesFlagged:Math.floor(r()*5), incidents:Math.floor(r()*2), pavementDefects:Math.floor(m.distanceKm*r()*2) }) },
  parks:        { label:'VEGETATION SURVEY',      pattern:'lawnmower', defaults:{altM:70,speedMs:8},
    analytics:(m,r)=>({ palmCount:Math.floor(1500+r()*4000), ndviMean:+(0.55+r()*0.25).toFixed(2), stressedPct:+(2+r()*9).toFixed(1) }) }
};
})(typeof window!=='undefined'?window:globalThis);
