(function(){
const UAE_CENTER = [54.6, 24.3];
EC2.initMap = function(){
  const style = {
    version: 8,
    projection: { type: 'globe' },
    sources: {
      'raster-dark': {
        type: 'raster', tileSize: 256,
        tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
        attribution: '© OpenStreetMap © CARTO'
      }
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0a0b0e' } },
      { id: 'raster-dark', type: 'raster', source: 'raster-dark',
        paint: { 'raster-saturation': -1, 'raster-contrast': 0.05 } }
    ]
  };
  EC2.map = new maplibregl.Map({
    container: 'map', style,
    center: UAE_CENTER, zoom: 1.4, attributionControl: false,
    canvasContextAttributes: { antialias: true }
  });
  EC2.mapReady = new Promise(res => EC2.map.on('load', res));
};
})();
