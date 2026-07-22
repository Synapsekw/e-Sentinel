(function(){
const UAE_CENTER = [54.6, 24.3];

const RASTERS = {
  dark:    ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png','https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
  light:   ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png','https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
  sat:     ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  terrain: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}']
};

EC2.dockFeatures = function(){
  return { type:'FeatureCollection', features: DATA_DOCKS.map(d => ({
    type:'Feature',
    properties:{ id:d.id, name:d.name, emirate:d.emirate, model:d.model, state:'ready' },
    geometry:{ type:'Point', coordinates:d.coords }
  })) };
};

EC2.initMap = function(){
  const rasterSources = {};
  for (const k of ['dark','light','sat','terrain']){
    rasterSources['raster-'+k] = {
      type: 'raster', tileSize: 256,
      tiles: RASTERS[k],
      attribution: '© OpenStreetMap © CARTO'
    };
  }

  const style = {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    projection: { type: 'globe' },
    sources: Object.assign({}, rasterSources, {
      'uae':        { type: 'geojson', data: GEO_UAE.borders },
      'uae-roads':  { type: 'geojson', data: GEO_UAE.roads },
      'uae-places': { type: 'geojson', data: GEO_UAE.places },
      'docks':      { type: 'geojson', data: EC2.dockFeatures() }
    }),
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0a0b0e' } },
      { id: 'raster-dark', type: 'raster', source: 'raster-dark',
        paint: { 'raster-saturation': -1, 'raster-contrast': 0.05 } },
      { id: 'raster-light', type: 'raster', source: 'raster-light',
        layout: { visibility: 'none' } },
      { id: 'raster-sat', type: 'raster', source: 'raster-sat',
        layout: { visibility: 'none' } },
      { id: 'raster-terrain', type: 'raster', source: 'raster-terrain',
        layout: { visibility: 'none' } },
      { id: 'uae-border-line', type: 'line', source: 'uae',
        paint: {
          'line-color': '#ff5a5a',
          'line-opacity': 0.35,
          'line-width': 1,
          'line-dasharray': [2, 3]
        } },
      { id: 'uae-roads', type: 'line', source: 'uae-roads',
        paint: {
          'line-color': '#7d8697',
          'line-opacity': 0.5,
          'line-width': 0.8
        } },
      { id: 'uae-places', type: 'symbol', source: 'uae-places',
        layout: {
          'text-field': ['upcase', ['get', 'name']],
          'text-font': ['Open Sans Regular'],
          'text-size': 10,
          'text-letter-spacing': 0.3
        },
        paint: { 'text-color': '#7d8697' },
        minzoom: 5.5 },
      { id: 'docks-rings', type: 'circle', source: 'docks',
        paint: {
          'circle-radius': 9,
          'circle-opacity': 0,
          'circle-stroke-color': 'rgba(255,90,90,.35)',
          'circle-stroke-width': 1
        } },
      { id: 'docks-dots', type: 'circle', source: 'docks',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'state'], 'alert'], 5.5, 4.5],
          'circle-color': ['match', ['get', 'state'],
            'ready', '#ff5a5a',
            '#ff5a5a'],
          'circle-stroke-color': '#0a0b0e',
          'circle-stroke-width': 1.5
        } }
    ]
  };

  EC2.map = new maplibregl.Map({
    container: 'map', style,
    center: UAE_CENTER, zoom: 1.4, attributionControl: false,
    canvasContextAttributes: { antialias: true }
  });
  EC2.mapReady = new Promise(res => EC2.map.on('load', res));
};

EC2.setLayer = function(name){
  for (const k of ['dark','light','sat','terrain'])
    EC2.map.setLayoutProperty('raster-'+k, 'visibility', k===name?'visible':'none');
  EC2.state.layer = name;
  document.documentElement.dataset.maplayer = name; // lets CSS adapt chips on light
};
})();
