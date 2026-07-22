(function(g){
const R = 6371000, D2R = Math.PI/180;
function offsetMeters([lon,lat], dxM, dyM){
  return [lon + (dxM/(R*Math.cos(lat*D2R)))/D2R, lat + (dyM/R)/D2R];
}
function distM(a,b){
  const x=(b[0]-a[0])*D2R*R*Math.cos(((a[1]+b[1])/2)*D2R), y=(b[1]-a[1])*D2R*R;
  return Math.hypot(x,y);
}
function pathLengthKm(c){ let s=0; for(let i=1;i<c.length;i++) s+=distM(c[i-1],c[i]); return s/1000; }
function bearing(a,b){
  const x=(b[0]-a[0])*Math.cos(((a[1]+b[1])/2)*D2R), y=b[1]-a[1];
  return (Math.atan2(x,y)/D2R+360)%360;
}
function rot([x,y],deg){ const r=deg*D2R; return [x*Math.cos(r)-y*Math.sin(r), x*Math.sin(r)+y*Math.cos(r)]; }
function lawnmower(center,widthKm,heightKm,spacingM,bearingDeg){
  const w=widthKm*1000,h=heightKm*1000, out=[];
  const passes=Math.max(2,Math.round(h/spacingM)+1);
  for(let i=0;i<passes;i++){
    const yy=-h/2 + (passes>1 ? i*h/(passes-1) : 0);
    const a=[-w/2,yy], b=[w/2,yy];
    const [p,q]= i%2===0 ? [a,b] : [b,a];
    out.push(offsetMeters(center,...rot(p,bearingDeg)), offsetMeters(center,...rot(q,bearingDeg)));
  }
  return out;
}
function orbit(center,radiusM,points=24){
  const out=[];
  for(let i=0;i<points;i++){
    const a=i/points*2*Math.PI;
    out.push(offsetMeters(center,Math.cos(a)*radiusM,Math.sin(a)*radiusM));
  }
  out.push(out[0].slice()); return out;
}
function perimeter(center,radiusM,points=6){ return orbit(center,radiusM,points); }
function atob(from,to,viaJitterM=0){
  if(!viaJitterM) return [from,to];
  const mid=[(from[0]+to[0])/2,(from[1]+to[1])/2];
  return [from, offsetMeters(mid,(Math.random()-.5)*2*viaJitterM,(Math.random()-.5)*2*viaJitterM), to];
}
function corridor(polyline,startFrac,lengthKm){
  const total=pathLengthKm(polyline), want=Math.min(lengthKm,total*(1-startFrac));
  const startKm=total*startFrac; let acc=0; const out=[];
  for(let i=1;i<polyline.length;i++){
    const seg=distM(polyline[i-1],polyline[i])/1000, a=acc, b=acc+seg; acc=b;
    if(b<startKm) continue;
    if(a>startKm+want) break;
    const t0=Math.max(0,(startKm-a)/seg), t1=Math.min(1,(startKm+want-a)/seg);
    const lerp=t=>[polyline[i-1][0]+(polyline[i][0]-polyline[i-1][0])*t,
                   polyline[i-1][1]+(polyline[i][1]-polyline[i-1][1])*t];
    if(out.length===0) out.push(lerp(t0));
    out.push(lerp(t1));
  }
  return out;
}
function pointAlong(coords,frac){
  const totalKm=pathLengthKm(coords); let want=totalKm*Math.min(Math.max(frac,0),1)*1000, acc=0;
  for(let i=1;i<coords.length;i++){
    const seg=distM(coords[i-1],coords[i]);
    if(acc+seg>=want||i===coords.length-1){
      const t=seg? Math.min(1,(want-acc)/seg):0;
      const pos=[coords[i-1][0]+(coords[i][0]-coords[i-1][0])*t,
                 coords[i-1][1]+(coords[i][1]-coords[i-1][1])*t];
      return { pos, heading: bearing(coords[i-1],coords[i]) };
    }
    acc+=seg;
  }
  return { pos: coords[coords.length-1], heading: 0 };
}
g.SimRouter={offsetMeters,distM,pathLengthKm,bearing,lawnmower,orbit,perimeter,atob,corridor,pointAlong};
})(typeof window!=='undefined'?window:globalThis);
