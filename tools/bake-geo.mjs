// tools/bake-geo.mjs  — dev-only authoring script, run with: node tools/bake-geo.mjs
// Fetches world-atlas topojson at build-author time and bakes it into
// file://-safe JS globals (GEO_WORLD, GEO_UAE) that the app loads via <script>.
// NOT part of the runtime app — this file may use fetch/ESM freely.
import { writeFileSync } from 'node:fs';

const wrap = (name, obj) =>
  `(function(g){g.${name}=${JSON.stringify(obj)};})(typeof window!=='undefined'?window:globalThis);\n`;

// --- load topojson-client's UMD build into an isolated sandbox -------------
// The UMD wrapper branches on `typeof exports`/`typeof module`. Passing both
// as real parameters (module.exports === the same sandbox object) forces it
// down the CommonJS branch, which assigns feature/mesh/etc directly onto the
// exports object we control — no reliance on globalThis/self leaking through.
function loadTopojsonClient(src) {
  const sandbox = {};
  new Function('exports', 'module', src + ';return exports;')(sandbox, { exports: sandbox });
  if (typeof sandbox.feature !== 'function') {
    throw new Error('topojson-client load failed: exports.feature not found');
  }
  return sandbox;
}

async function main() {
  const tjsSrc = await (await fetch('https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js')).text();
  const topojson = loadTopojsonClient(tjsSrc);

  // 1) world land at 110m from world-atlas (topojson) -> geojson
  const topoRes = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json');
  const topo = await topoRes.json();
  const world = topojson.feature(topo, topo.objects.land);
  writeFileSync('assets/js/data/geo-world.js', wrap('GEO_WORLD', world));

  // 2) UAE country boundary from world-atlas countries-50m (id 784) as accent line
  const cRes = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json');
  const cTopo = await cRes.json();
  const countries = topojson.feature(cTopo, cTopo.objects.countries);
  const uae = countries.features.find((f) => f.id === '784');
  if (!uae) throw new Error('UAE (id 784) not found in countries-50m.json');

  // 3) hand-authored major roads + places (approximate, demo-grade)
  const roads = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { id: 'E11', name: 'E11 SHEIKH ZAYED RD' }, geometry: { type: 'LineString',
      coordinates: [[51.62,24.13],[52.65,24.10],[53.65,24.22],[54.40,24.47],[54.65,24.72],[55.02,24.98],[55.15,25.07],[55.27,25.20],[55.39,25.33],[55.48,25.40],[55.56,25.49],[55.72,25.72],[55.94,25.79],[56.06,25.95]] } },
    { type: 'Feature', properties: { id: 'E311', name: 'E311 MBZ RD' }, geometry: { type: 'LineString',
      coordinates: [[54.72,24.40],[55.05,24.90],[55.25,25.05],[55.42,25.22],[55.55,25.35],[55.66,25.48],[55.85,25.68]] } },
    { type: 'Feature', properties: { id: 'E611', name: 'E611 EMIRATES RD' }, geometry: { type: 'LineString',
      coordinates: [[55.18,24.92],[55.38,25.10],[55.55,25.25],[55.70,25.40],[55.85,25.55]] } },
    { type: 'Feature', properties: { id: 'E22', name: 'E22 ABU DHABI-AL AIN' }, geometry: { type: 'LineString',
      coordinates: [[54.50,24.42],[54.90,24.35],[55.30,24.28],[55.60,24.24],[55.74,24.22]] } },
    { type: 'Feature', properties: { id: 'E44', name: 'E44 DXB-HATTA' }, geometry: { type: 'LineString',
      coordinates: [[55.32,25.22],[55.50,25.12],[55.70,25.00],[55.90,24.90],[56.12,24.80]] } },
    { type: 'Feature', properties: { id: 'E88', name: 'E88 SHJ-MASAFI' }, geometry: { type: 'LineString',
      coordinates: [[55.42,25.34],[55.65,25.30],[55.88,25.28],[56.16,25.30]] } }
  ]};
  const places = { type: 'FeatureCollection', features: [
    ['ABU DHABI',54.38,24.45],['DUBAI',55.27,25.20],['SHARJAH',55.39,25.35],
    ['AJMAN',55.44,25.40],['UMM AL QUWAIN',55.55,25.56],['RAS AL KHAIMAH',55.94,25.79],
    ['FUJAIRAH',56.33,25.12],['AL AIN',55.75,24.21],['RUWAIS',52.73,24.11],['LIWA',53.78,23.13]
  ].map(([n,lon,lat]) => ({ type: 'Feature', properties: { name: n }, geometry: { type: 'Point', coordinates: [lon, lat] } })) };

  writeFileSync('assets/js/data/geo-uae.js',
    wrap('GEO_UAE', { borders: { type: 'FeatureCollection', features: [uae] }, roads, places }));

  console.log('baked geo-world.js and geo-uae.js');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
