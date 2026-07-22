# e& UAE Drone Operations Console v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A double-click-to-run simulated national drone C2 console for the UAE: orbital globe entry, ~104 docks, autonomous fleet simulation, point-and-click mission creation, per-type analytics debriefs with AI-video slots.

**Architecture:** Single page (`index.html`) with classic `<script>` tags (no modules, no build, `file://`-safe). MapLibre GL (vendored) renders globe + UAE map with 4 raster layer styles and an embedded-vector offline fallback. A tick-based sim engine (pure JS, Node-testable) drives dock/drone/mission state machines; UI modules render into fixed panels using the design tokens from `reference/embedded_sim.html`.

**Tech Stack:** MapLibre GL JS v5 (vendored), vanilla JS/CSS, Node built-in test runner (`node --test`) for pure logic, browser preview for UI verification.

## Global Constraints

- Runs from `file://` by double-click: NO `fetch()` of local files, NO ES modules, NO build step. All data files assign globals via `(function(g){...})(typeof window!=='undefined'?window:globalThis)`.
- All vendor libs local under `assets/js/vendor/` (must work offline).
- Design tokens verbatim from spec §3: `--bg:#0a0b0e`, panels `rgba(255,255,255,.035)`/`.06`, line `rgba(255,255,255,.09)`, txt `#c9cfda`, dim `#7d8697`, red `#ff5a5a`, redd `#BC0000`, amber `#fbbf24`, ok `#4ade80`; UI font `'Segoe UI',system-ui`; data font `ui-monospace,'SF Mono','Cascadia Mono',Consolas,Menlo,monospace`; micro-labels 9.5px, letter-spacing .22em, uppercase.
- No em dashes in any UI copy. Micro-label style must match reference exactly.
- Status discipline: green nominal, amber warning/charging, red alert + brand.
- Realistic envelopes: default alt ≤ 120 m AGL, speed ≤ 21 m/s, forced RTB at 25% battery.
- Target 60fps with 104 docks + 25 airborne drones (drones/docks as MapLibre GeoJSON sources updated per tick).
- Pure-logic tests run with `node --test tests/` from the project root (Node ≥ 20, no npm packages).
- Commit after every task (repo root: `C:\Users\D\OneDrive\Desktop\E& C&C`, branch `main`).

---

### Task 1: Scaffold, vendor MapLibre, boot a globe-capable map (de-risk)

**Files:**
- Create: `index.html`, `assets/css/console.css`, `assets/js/main.js`, `assets/js/ui/map.js`
- Create (vendored): `assets/js/vendor/maplibre-gl.js`, `assets/js/vendor/maplibre-gl.css`
- Create: `.gitignore` (empty for now; placeholder for future)

**Interfaces:**
- Produces: `window.EC2.map` (MapLibre Map instance), `EC2.mapReady` (Promise), `initMap()` in map.js. Global namespace object `window.EC2 = {}` created in main.js before all other scripts run (main.js is loaded FIRST, its `init()` called last via `DOMContentLoaded`).

- [ ] **Step 1: Download and vendor MapLibre**

```bash
curl -L -o "assets/js/vendor/maplibre-gl.js" "https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.js"
curl -L -o "assets/js/vendor/maplibre-gl.css" "https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.css"
```

Expected: both files exist; `maplibre-gl.js` roughly 0.8–1.1 MB. If unpkg fails use `https://cdn.jsdelivr.net/npm/maplibre-gl@5.6.0/dist/...`.

- [ ] **Step 2: Write index.html skeleton**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>e&amp; UAE Operations Console · Physical Intelligence</title>
<link rel="stylesheet" href="assets/js/vendor/maplibre-gl.css">
<link rel="stylesheet" href="assets/css/console.css">
</head>
<body>
<div id="map"></div>
<div id="boot-error" hidden>
  <div class="be-inner">
    <div class="be-logo">e<i>&amp;</i></div>
    <p>CONSOLE FAILED TO INITIALISE. CHECK assets/js/vendor FILES.</p>
  </div>
</div>
<script src="assets/js/vendor/maplibre-gl.js"></script>
<script src="assets/js/main.js"></script>
<script src="assets/js/ui/map.js"></script>
<script>document.addEventListener('DOMContentLoaded',()=>window.EC2.init());</script>
</body>
</html>
```

- [ ] **Step 3: Write console.css with design tokens**

```css
:root{
  --bg:#0a0b0e;--panel:rgba(255,255,255,.035);--panel2:rgba(255,255,255,.06);
  --line:rgba(255,255,255,.09);--txt:#c9cfda;--dim:#7d8697;
  --red:#ff5a5a;--redd:#BC0000;--amber:#fbbf24;--ok:#4ade80;
  --sans:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif;
  --mono:ui-monospace,'SF Mono','Cascadia Mono',Consolas,Menlo,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:var(--bg);color:var(--txt);font-family:var(--sans);overflow:hidden}
button{font-family:inherit;cursor:pointer}
.lbl{font-family:var(--mono);font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;color:var(--dim)}
#map{position:fixed;inset:0;background:var(--bg)}
#boot-error{position:fixed;inset:0;display:grid;place-items:center;background:var(--bg);z-index:9999}
#boot-error[hidden]{display:none}
.be-inner{text-align:center;font-family:var(--mono);font-size:11px;letter-spacing:.18em;color:var(--dim)}
.be-logo{font-size:42px;font-weight:800;color:#fff;margin-bottom:18px;font-family:var(--sans)}
.be-logo i{color:var(--redd);font-style:normal}
```

- [ ] **Step 4: Write main.js namespace + boot guard**

```js
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
```

- [ ] **Step 5: Write map.js with globe projection + CARTO dark raster**

```js
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
```

- [ ] **Step 6: Verify in browser (file://)**

Open `index.html` by double-click (or browser preview). Expected: dark globe visible, drag rotates, scroll zooms toward flat map, browser console clean (tile 404s from CARTO are acceptable only if offline). If `projection` is rejected by this MapLibre version, check maplibre-gl.js version ≥ 5 and adjust: `map.setProjection({type:'globe'})` after load.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: scaffold console with vendored MapLibre globe"
```

---

### Task 2: Bake offline geo data (world land + UAE accents)

**Files:**
- Create: `tools/bake-geo.mjs` (dev-only, run with plain `node`, MAY use fetch: it runs at build-author time, not in the app)
- Create: `assets/js/data/geo-world.js`, `assets/js/data/geo-uae.js`
- Test: `tests/geo.test.js`

**Interfaces:**
- Produces: `window.GEO_WORLD` (GeoJSON FeatureCollection of world land polygons, simplified), `window.GEO_UAE` = `{ borders: FeatureCollection (emirate/country boundary lines), roads: FeatureCollection (E11, E311, E611, E22, E44, E88 polylines), places: FeatureCollection (city label points) }`.

- [ ] **Step 1: Write bake script**

```js
// tools/bake-geo.mjs  — run: node tools/bake-geo.mjs
import { writeFileSync } from 'node:fs';
const wrap = (name, obj) =>
  `(function(g){g.${name}=${JSON.stringify(obj)};})(typeof window!=='undefined'?window:globalThis);\n`;

// 1) world land at 110m from world-atlas (topojson) -> convert minimally
const topoRes = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json');
const topo = await topoRes.json();
// minimal topojson->geojson conversion via the topojson-client package CDN build:
const tjs = await (await fetch('https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js')).text();
const sandbox = {}; new Function('exports', tjs + ';return exports;')(sandbox);
const world = sandbox.topojson ? sandbox.topojson.feature(topo, topo.objects.land)
  : (()=>{ throw new Error('topojson-client load failed'); })();
writeFileSync('assets/js/data/geo-world.js', wrap('GEO_WORLD', world));

// 2) UAE country boundary from world-atlas countries-110m (id 784) as accent line
const cRes = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json');
const cTopo = await cRes.json();
const countries = sandbox.topojson.feature(cTopo, cTopo.objects.countries);
const uae = countries.features.find(f => f.id === '784');
// 3) hand-authored major roads + places (approximate, demo-grade)
const roads = { type:'FeatureCollection', features: [
  { type:'Feature', properties:{ id:'E11', name:'E11 SHEIKH ZAYED RD' }, geometry:{ type:'LineString',
    coordinates:[[51.62,24.13],[52.65,24.10],[53.65,24.22],[54.40,24.47],[54.65,24.72],[55.02,24.98],[55.15,25.07],[55.27,25.20],[55.39,25.33],[55.48,25.40],[55.56,25.49],[55.72,25.72],[55.94,25.79],[56.06,25.95]] } },
  { type:'Feature', properties:{ id:'E311', name:'E311 MBZ RD' }, geometry:{ type:'LineString',
    coordinates:[[54.72,24.40],[55.05,24.90],[55.25,25.05],[55.42,25.22],[55.55,25.35],[55.66,25.48],[55.85,25.68]] } },
  { type:'Feature', properties:{ id:'E611', name:'E611 EMIRATES RD' }, geometry:{ type:'LineString',
    coordinates:[[55.18,24.92],[55.38,25.10],[55.55,25.25],[55.70,25.40],[55.85,25.55]] } },
  { type:'Feature', properties:{ id:'E22', name:'E22 ABU DHABI-AL AIN' }, geometry:{ type:'LineString',
    coordinates:[[54.50,24.42],[54.90,24.35],[55.30,24.28],[55.60,24.24],[55.74,24.22]] } },
  { type:'Feature', properties:{ id:'E44', name:'E44 DXB-HATTA' }, geometry:{ type:'LineString',
    coordinates:[[55.32,25.22],[55.50,25.12],[55.70,25.00],[55.90,24.90],[56.12,24.80]] } },
  { type:'Feature', properties:{ id:'E88', name:'E88 SHJ-MASAFI' }, geometry:{ type:'LineString',
    coordinates:[[55.42,25.34],[55.65,25.30],[55.88,25.28],[56.16,25.30]] } }
]};
const places = { type:'FeatureCollection', features: [
  ['ABU DHABI',54.38,24.45],['DUBAI',55.27,25.20],['SHARJAH',55.39,25.35],
  ['AJMAN',55.44,25.40],['UMM AL QUWAIN',55.55,25.56],['RAS AL KHAIMAH',55.94,25.79],
  ['FUJAIRAH',56.33,25.12],['AL AIN',55.75,24.21],['RUWAIS',52.73,24.11],['LIWA',53.78,23.13]
].map(([n,lon,lat])=>({ type:'Feature', properties:{ name:n }, geometry:{ type:'Point', coordinates:[lon,lat] } })) };
writeFileSync('assets/js/data/geo-uae.js',
  wrap('GEO_UAE', { borders:{ type:'FeatureCollection', features:[uae] }, roads, places }));
console.log('baked geo-world.js and geo-uae.js');
```

- [ ] **Step 2: Run bake script**

Run: `node tools/bake-geo.mjs`
Expected: `baked geo-world.js and geo-uae.js`; `geo-world.js` under 800 KB.

- [ ] **Step 3: Write failing test**

```js
// tests/geo.test.js
const test = require('node:test');
const assert = require('node:assert');
require('../assets/js/data/geo-world.js');
require('../assets/js/data/geo-uae.js');

test('world land present', () => {
  assert.ok(globalThis.GEO_WORLD.features.length > 0);
});
test('uae bundle shape', () => {
  const u = globalThis.GEO_UAE;
  assert.ok(u.borders.features.length === 1);
  assert.ok(u.roads.features.length >= 6);
  assert.ok(u.places.features.length >= 10);
});
test('roads inside UAE bbox', () => {
  for (const f of globalThis.GEO_UAE.roads.features)
    for (const [lon, lat] of f.geometry.coordinates) {
      assert.ok(lon > 51 && lon < 56.6, `lon ${lon}`);
      assert.ok(lat > 22.5 && lat < 26.3, `lat ${lat}`);
    }
});
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: bake offline world and UAE geo data"
```

---

### Task 3: Dock dataset (104 stations)

**Files:**
- Create: `assets/js/data/docks.js`
- Test: `tests/docks.test.js`

**Interfaces:**
- Produces: `window.DATA_DOCKS`: array of `{ id, name, emirate, coords:[lon,lat], model }`. `emirate` ∈ `AUH|DXB|SHJ|AJM|UAQ|RAK|FUJ|AAN` (AAN = Al Ain region, administratively AUH but its own filter). `model` ∈ `M4TD|M4D|M350`. IDs like `DXB-017` zero-padded 3 digits, numbered per emirate prefix.

- [ ] **Step 1: Write failing test**

```js
// tests/docks.test.js
const test = require('node:test');
const assert = require('node:assert');
require('../assets/js/data/docks.js');

test('104 docks', () => assert.strictEqual(globalThis.DATA_DOCKS.length, 104));
test('unique ids, valid shape', () => {
  const ids = new Set();
  for (const d of globalThis.DATA_DOCKS) {
    assert.match(d.id, /^(AUH|DXB|SHJ|AJM|UAQ|RAK|FUJ|AAN)-\d{3}$/);
    assert.ok(!ids.has(d.id)); ids.add(d.id);
    assert.ok(['M4TD','M4D','M350'].includes(d.model));
    const [lon, lat] = d.coords;
    assert.ok(lon > 51.0 && lon < 56.6 && lat > 22.5 && lat < 26.3, d.id);
  }
});
test('emirate coverage', () => {
  const c = {};
  for (const d of globalThis.DATA_DOCKS) c[d.emirate] = (c[d.emirate]||0)+1;
  assert.ok(c.AUH >= 26 && c.DXB >= 22 && c.SHJ >= 10 && c.RAK >= 8 && c.FUJ >= 6 && c.AAN >= 6 && c.AJM >= 3 && c.UAQ >= 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/`
Expected: docks tests FAIL (file missing).

- [ ] **Step 3: Author docks.js**

Structure (author all 104 with hand-placed plausible coordinates; distribution AUH 28, DXB 26, SHJ 12, AJM 4, UAQ 4, RAK 10, FUJ 8, AAN 12). Anchor list to expand from (real locations, approximate coords):

```js
(function(g){
g.DATA_DOCKS = [
  // AUH — city, island, industrial, west region
  { id:'AUH-001', name:'Corniche', emirate:'AUH', coords:[54.349,24.477], model:'M4TD' },
  { id:'AUH-002', name:'Saadiyat', emirate:'AUH', coords:[54.435,24.542], model:'M4D' },
  { id:'AUH-003', name:'Yas Island', emirate:'AUH', coords:[54.605,24.487], model:'M4TD' },
  { id:'AUH-004', name:'Masdar City', emirate:'AUH', coords:[54.617,24.426], model:'M4TD' },
  { id:'AUH-005', name:'Khalifa Port', emirate:'AUH', coords:[54.670,24.800], model:'M350' },
  { id:'AUH-006', name:'KIZAD', emirate:'AUH', coords:[54.780,24.720], model:'M4D' },
  { id:'AUH-007', name:'Mussafah', emirate:'AUH', coords:[54.490,24.360], model:'M4TD' },
  { id:'AUH-008', name:'Al Wathba', emirate:'AUH', coords:[54.640,24.190], model:'M4D' },
  // ...west region anchors:
  { id:'AUH-021', name:'Ruwais', emirate:'AUH', coords:[52.730,24.110], model:'M350' },
  { id:'AUH-022', name:'Ghayathi', emirate:'AUH', coords:[52.810,23.830], model:'M4D' },
  { id:'AUH-023', name:'Madinat Zayed', emirate:'AUH', coords:[53.650,23.650], model:'M4D' },
  { id:'AUH-024', name:'Liwa Oasis', emirate:'AUH', coords:[53.780,23.130], model:'M4D' },
  { id:'AUH-025', name:'Sila', emirate:'AUH', coords:[51.750,24.030], model:'M350' },
  // DXB anchors:
  { id:'DXB-001', name:'Business Bay', emirate:'DXB', coords:[55.263,25.185], model:'M4TD' },
  { id:'DXB-002', name:'Marina', emirate:'DXB', coords:[55.140,25.078], model:'M4TD' },
  { id:'DXB-003', name:'Jebel Ali Port', emirate:'DXB', coords:[55.060,25.010], model:'M350' },
  { id:'DXB-004', name:'Expo City', emirate:'DXB', coords:[55.150,24.960], model:'M4D' },
  { id:'DXB-005', name:'Silicon Oasis', emirate:'DXB', coords:[55.380,25.120], model:'M4TD' },
  { id:'DXB-006', name:'Al Qusais', emirate:'DXB', coords:[55.380,25.280], model:'M4TD' },
  { id:'DXB-007', name:'Al Khawaneej', emirate:'DXB', coords:[55.470,25.240], model:'M4D' },
  { id:'DXB-008', name:'Hatta', emirate:'DXB', coords:[56.120,24.800], model:'M4D' },
  // SHJ anchors: city 55.39,25.35; Al Dhaid 55.88,25.28; Khor Fakkan 56.35,25.34; Kalba 56.35,25.06; Mleiha 55.86,25.13; Hamriyah 55.49,25.46
  // AJM: city 55.44,25.40; Al Zorah 55.45,25.43; Manama 55.75,25.33; Masfout 56.05,24.85
  // UAQ: city 55.55,25.56; Falaj Al Mualla 55.86,25.42; marina 55.58,25.58; Al Salamah 55.62,25.52
  // RAK: city 55.94,25.79; Al Hamra 55.78,25.69; Mina Al Arab 55.83,25.72; Khatt 56.05,25.65; Jebel Jais 56.18,25.95; Al Rams 56.02,25.87; Shaam 56.09,26.02; Digdaga 55.97,25.63; Ghalilah 56.07,25.93; RAK Port 55.95,25.81
  // FUJ: city 56.34,25.12; Port 56.36,25.18; Dibba 56.26,25.59; Masafi 56.16,25.30; Qidfa 56.36,25.30; Al Bidiyah 56.35,25.44; Mirbah 56.37,25.28; Free Zone 56.35,25.15
  // AAN: Al Ain center 55.745,24.207; Hili 55.760,24.290; Al Jimi 55.735,24.245; Zakher 55.700,24.160; Al Faqa 55.620,24.720 (E66), Remah 55.300,24.100; Sweihan 55.330,24.470; Al Hayer 55.770,24.520; Green Mubazzarah 55.740,24.100; Al Qattara 55.755,24.265; Al Yahar 55.580,24.220; Nahel 55.700,24.630
  // (fill remaining AUH-009..020, AUH-026..028, DXB-009..026 with named districts:
  //  Deira, Jumeirah, Meydan, Dubailand, Al Barsha, Palm Jumeirah, DIP, Al Awir, Lehbab,
  //  Al Lisaili, Margham, Al Marmoom, Dubai South, Al Warqa, Nad Al Sheba, Mirdif,
  //  International City, Dragon Mart, Al Ruwayyah, and AUH: Reem Island, Al Raha, Al Shamkha,
  //  Al Falah, Baniyas, Al Samha, Al Rahba, Shahama, Al Bahia, Al Maqta, Zayed Port, ICAD)
];
})(typeof window!=='undefined'?window:globalThis);
```

The implementer authors the FULL 104-entry array (no comments left in place of entries) using these anchors and district names, keeping coordinates within each named area (±0.03°) and off the exact airport points (avoid 55.36,25.25 DXB and 54.65,24.43 AUH within 0.04°).

- [ ] **Step 4: Run tests**

Run: `node --test tests/`
Expected: all pass, including count=104.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: 104-dock national network dataset"
```

---

### Task 4: Layer system + UAE accent overlay + docks on map

**Files:**
- Modify: `assets/js/ui/map.js`
- Modify: `index.html` (add script tags for data files after vendor, before main wiring: `geo-world.js`, `geo-uae.js`, `docks.js`)

**Interfaces:**
- Consumes: `GEO_UAE`, `DATA_DOCKS`.
- Produces: `EC2.setLayer(name)` with `name ∈ 'dark'|'light'|'sat'|'terrain'`; raster sources `raster-dark|raster-light|raster-sat|raster-terrain` all present in style with layer visibility toggled; accent layers `uae-border-line`, `uae-roads`, `uae-places`, `docks-dots`, `docks-rings`; `EC2.dockFeatures()` returns GeoJSON FC of docks (used later by sim to merge state).

- [ ] **Step 1: Extend style with all sources/layers**

In `map.js`, build the style with all four raster sources:

```js
const RASTERS = {
  dark:    ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png','https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
  light:   ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png','https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
  sat:     ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  terrain: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}']
};
```

One raster layer per source (`visibility:'none'` except dark). Add sources `uae` (borders), `uae-roads`, `uae-places` from `GEO_UAE`, and `docks` from `EC2.dockFeatures()`:

```js
EC2.dockFeatures = function(){
  return { type:'FeatureCollection', features: DATA_DOCKS.map(d => ({
    type:'Feature',
    properties:{ id:d.id, name:d.name, emirate:d.emirate, model:d.model, state:'ready' },
    geometry:{ type:'Point', coordinates:d.coords }
  })) };
};
```

Accent layers (over raster, colors per token set):
- `uae-border-line`: line, `#ff5a5a` at 0.35 opacity, width 1, dasharray [2,3].
- `uae-roads`: line `#7d8697` 0.5 opacity width 0.8 (visible only when `state.offline` or zoom < 8 optional; keep always-on, subtle).
- `uae-places`: symbol, text field `name`, mono-look via `text-letter-spacing: 0.3`, `text-size` 10, color `#7d8697` (visibility tied to zoom ≥ 5.5).
- `docks-dots`: circle, radius 4.5 (5.5 when `state==='alert'`), color by state: ready `#ff5a5a` per reference red-dot look, fault `#fbbf24`... NOTE reference styling: dock dots red with dark stroke `#0a0b0e` width 1.5.
- `docks-rings`: circle radius 9, transparent fill, stroke `rgba(255,90,90,.35)` width 1 (static ring; animated ping comes with sim in Task 8).

- [ ] **Step 2: Implement setLayer**

```js
EC2.setLayer = function(name){
  for (const k of ['dark','light','sat','terrain'])
    EC2.map.setLayoutProperty('raster-'+k, 'visibility', k===name?'visible':'none');
  EC2.state.layer = name;
  document.documentElement.dataset.maplayer = name; // lets CSS adapt chips on light
};
```

- [ ] **Step 3: Verify in browser**

Open index.html: docks visible as red dots across UAE at national zoom; call `EC2.setLayer('sat')` in console: satellite imagery appears on map AND globe (zoom out to check). Repeat for all 4. Console clean.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: four raster layers, UAE accents, dock rendering"
```

---

### Task 5: Globe entry scene + dive + return

**Files:**
- Create: `assets/js/ui/globe.js`
- Modify: `index.html` (add `#globe-ui` overlay divs + script tag), `assets/css/console.css`, `assets/js/main.js`

**Interfaces:**
- Consumes: `EC2.map`, `EC2.mapReady`.
- Produces: `EC2.enterTheater()` (dive), `EC2.exitToOrbit()`; `EC2.state.scene` transitions `'globe' → 'console'` and back; fires `EC2.onSceneChange(cb)` callbacks (simple array of listeners) used by panels to show/hide chrome.

- [ ] **Step 1: Add globe overlay HTML**

```html
<div id="globe-ui">
  <div class="g-brand"><span class="g-eamp">e<i>&amp;</i></span>
    <div><b>GLOBAL COMMAND</b><span class="lbl">PHYSICAL INTELLIGENCE · ORBITAL VIEW</span></div>
  </div>
  <div class="g-hint lbl">DRAG TO ROTATE · CLICK UAE TO ENTER THEATER</div>
  <button id="uae-beacon-tag" class="g-tag" hidden>
    <b>UNITED ARAB EMIRATES</b>
    <span class="ok">GRID ONLINE · 104 DOCKS</span>
    <span class="lbl">CLICK TO ENTER THEATER</span>
  </button>
  <div class="g-alt lbl" id="g-alt">ALT 12742 KM · ORBITAL</div>
</div>
```

- [ ] **Step 2: Implement globe.js**

Behavior:
- On boot (`scene==='globe'`): camera `{center:[54.6,24.3], zoom:1.35}`; slow auto-rotate via `requestAnimationFrame` adjusting `map.setCenter([lon - 0.02, lat])` when idle (pause on pointerdown, resume 2.5 s after pointerup); UAE beacon: a GeoJSON point layer `beacon` at `[54.4,24.3]` with animated circle radius/opacity (ping) driven by `setPaintProperty` each frame.
- Project beacon to screen each frame (`map.project([54.4,24.3])`), position `#uae-beacon-tag` next to it; hide when behind globe (`map.project` returns point; check against `map.transform` visibility by comparing `map.unproject(map.project(p))` distance > 1° → hidden).
- `EC2.enterTheater()`: hide tag, `map.flyTo({center:[54.35,24.5], zoom:6.6, duration:2600, curve:1.6})`; on `moveend` set scene `'console'`, hide `#globe-ui`, notify listeners. During flight update `#g-alt` from `map.getZoom()` mapped to km (12742 → 2, log scale).
- `EC2.exitToOrbit()`: reverse `flyTo` zoom 1.35, scene `'globe'`, show `#globe-ui`.
- Click handlers: beacon tag click and map click within 60 px of beacon both call `enterTheater()`.

```js
EC2.onSceneChange = (function(){ const subs=[]; const f=cb=>subs.push(cb); f.fire=()=>subs.forEach(cb=>cb(EC2.state.scene)); return f; })();
```

- [ ] **Step 3: Verify in browser**

Boot: globe rotating, beacon pinging over UAE, tag follows. Click tag: single continuous dive to national view (no flicker or cut), `#globe-ui` gone. Run `EC2.exitToOrbit()` from console: returns to orbit, tag reappears. Switch layer to `sat` while in orbit: photoreal globe.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: orbital globe entry with continuous dive to UAE"
```

---

### Task 6: Offline fallback mode

**Files:**
- Modify: `assets/js/ui/map.js`, `assets/css/console.css`, `index.html` (add `geo-world` accent chip container in Task 7's top bar; for now a floating chip `#offline-chip`)

**Interfaces:**
- Consumes: `GEO_WORLD`.
- Produces: `EC2.setOffline(bool)`; automatic detection via raster tile `error` events; style gains `world-land-fill` + `world-land-line` layers (from `GEO_WORLD`, visible only offline, colors `#14171c` fill / `rgba(255,255,255,.14)` line) rendered BELOW accent layers; `#offline-chip` visible when offline.

- [ ] **Step 1: Implement detection + mode**

```js
let tileErrors = 0, offlineTimer = null;
EC2.map.on('error', (e) => {
  if (e.sourceId && e.sourceId.startsWith('raster-')) {
    if (++tileErrors >= 6 && !EC2.state.offline) EC2.setOffline(true);
  }
});
EC2.setOffline = function(on){
  EC2.state.offline = on;
  for (const k of ['dark','light','sat','terrain'])
    EC2.map.setLayoutProperty('raster-'+k, 'visibility',
      (!on && k===EC2.state.layer) ? 'visible' : 'none');
  for (const id of ['world-land-fill','world-land-line'])
    EC2.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  document.getElementById('offline-chip').hidden = !on;
  if (on){ tileErrors = 0;
    offlineTimer = setInterval(() => { // recheck: try loading a 1px tile
      const img = new Image();
      img.onload = () => { clearInterval(offlineTimer); EC2.setOffline(false); };
      img.src = 'https://a.basemaps.cartocdn.com/dark_all/3/5/3.png?t=' + Date.now();
    }, 15000);
  }
};
```

- [ ] **Step 2: Verify in browser**

DevTools → Network → Offline; pan/zoom to force tile loads. Expected within a few seconds: vector world land appears, offline chip shows "OFFLINE MODE · VECTOR MAP". Go back online: chip clears within ~15 s and raster returns. Globe scene also renders land offline.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: offline vector fallback with auto-recovery"
```

---

### Task 7: Console shell UI (top bar, sidebar, right panel, ticker)

**Files:**
- Create: `assets/js/ui/panels.js`
- Modify: `index.html`, `assets/css/console.css`, `assets/js/main.js`

**Interfaces:**
- Consumes: `DATA_DOCKS`, `EC2.onSceneChange`, `EC2.setLayer`, `EC2.exitToOrbit`.
- Produces: DOM regions `#topbar`, `#side`, `#rpanel`, `#ticker`; `EC2.ui = { setStats(o), renderDockList(filter), pushEvent(ev), setRightPanel(mode, data), tick(html) }`. `setRightPanel` modes: `'empty'|'dock'|'drone'|'wizard'|'debrief'|'media'` (later tasks fill content; this task implements `'empty'` + `'dock'`). Selection flows through `EC2.select({type:'dock'|'drone', id})`.

- [ ] **Step 1: Build the chrome HTML** (verbatim structure)

```html
<header id="topbar" hidden>
  <div class="t-brand"><span class="t-eamp">e<i>&amp;</i></span>
    <div><div class="ttl">UAE OPERATIONS CONSOLE</div>
    <div class="lbl">PHYSICAL INTELLIGENCE · NATIONAL GRID</div></div>
  </div>
  <div class="chip ok-chip"><span class="dot"></span>GRID ONLINE</div>
  <div class="chip" id="c-docks">DOCKS <b>104</b></div>
  <div class="chip" id="c-air">AIRBORNE <b>0</b></div>
  <div class="chip warn" id="c-alerts" hidden>ALERTS <b>0</b></div>
  <div class="chip warn" id="offline-chip" hidden>OFFLINE MODE · VECTOR MAP</div>
  <div class="sp"></div>
  <div class="seg" id="timescale">
    <button data-ts="1" class="on">1×</button><button data-ts="4">4×</button><button data-ts="16">16×</button>
  </div>
  <div class="seg" id="layerseg">
    <button data-l="dark" class="on">DARK</button><button data-l="light">LIGHT</button>
    <button data-l="sat">SATELLITE</button><button data-l="terrain">TERRAIN</button>
  </div>
  <button class="tbtn" id="btn-media">MEDIA</button>
  <button class="tbtn" id="btn-globe">GLOBE</button>
  <div id="clock">18:42:07 <span>GST</span></div>
</header>
<aside id="side" hidden> ... stats grid, filter chips (ALL + emirates + FLYING/ALERTS), #docklist ... </aside>
<aside id="rpanel" hidden><div id="rpanel-body"></div></aside>
<footer id="ticker" hidden><span class="lbl">EVENTS</span><div id="tickstream"></div></footer>
```

Styling: reuse reference patterns exactly (56px topbar, `backdrop-filter:blur(10px)`, `background:rgba(10,11,14,.82)`, chips `border-radius:99px`, panels `border-radius:12px`, sidebar width 318px left, rpanel 340px right, both `position:fixed` over the map with `top:56px`). Segmented controls (`.seg`) are bordered pill groups with `.on` state `background:var(--panel2);color:#fff`.

- [ ] **Step 2: Implement panels.js**

- `EC2.ui.renderDockList(filter)`: rows `[status dot][id + name][model + state]`, click → `EC2.select({type:'dock', id})`.
- `EC2.select`: highlights row, sets `state.selection`, calls `setRightPanel('dock', dock)` and `map.flyTo` the dock at zoom 11 (only when selection changes).
- Dock card (`'dock'` mode): identity block (id, name, emirate), drone model, battery bar, state chip, buttons LAUNCH MISSION (disabled placeholder until Task 11), LOCATE (flyTo zoom 14).
- `pushEvent({time, level, source, message})`: prepend to `#tickstream` inline scrolled strip; keep last 30; alerts colored `--red`, warns `--amber`.
- Clock: `setInterval` 1 s, `en-GB` `hour12:false` + `GST` suffix.
- Scene wiring: on `EC2.onSceneChange`, `hidden` toggles for `#topbar #side #rpanel #ticker` (visible only in `'console'`).
- `btn-globe` → `EC2.exitToOrbit()`; `layerseg` buttons → `EC2.setLayer`; `timescale` → sets `EC2.state.timeScale` (engine consumes in Task 9).

- [ ] **Step 3: Verify in browser**

Dive in from globe: chrome fades in (add `.chrome-in` CSS transition, opacity 0→1 200ms). Dock list shows 104 rows, filters work (AUH shows only AUH+AAN? NO: AAN is its own filter chip). Clicking dock flies to it and opens card. GLOBE button returns to orbit and hides chrome. No layout overflow at 1280×800 and 1920×1080.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: console chrome with dock list, layers, ticker"
```

---

### Task 8: Route pattern generator (pure logic)

**Files:**
- Create: `assets/js/sim/router.js`
- Test: `tests/router.test.js`

**Interfaces:**
- Produces: `window.SimRouter` with pure functions (no DOM, no map):
  - `lawnmower(center:[lon,lat], widthKm, heightKm, spacingM, bearingDeg) → [lon,lat][]`
  - `corridor(polyline:[lon,lat][], startFrac, lengthKm) → [lon,lat][]` (sub-path along a road)
  - `orbit(center, radiusM, points=24) → [lon,lat][]` (closed)
  - `perimeter(center, radiusM, points=6) → [lon,lat][]` (closed hexagon)
  - `atob(from, to, viaJitterM=0) → [lon,lat][]`
  - `pathLengthKm(coords) → number`, `pointAlong(coords, frac) → {pos:[lon,lat], heading:deg}`
  - Helper `offsetMeters([lon,lat], dxM, dyM) → [lon,lat]` (equirectangular, fine at UAE latitudes)

- [ ] **Step 1: Write failing tests**

```js
// tests/router.test.js
const test = require('node:test');
const assert = require('node:assert');
require('../assets/js/sim/router.js');
const R = globalThis.SimRouter;
const DXB = [55.27, 25.20];

test('offsetMeters roundtrip ~1km', () => {
  const p = R.offsetMeters(DXB, 1000, 0);
  assert.ok(Math.abs(R.pathLengthKm([DXB, p]) - 1.0) < 0.02);
});
test('lawnmower covers area with alternating passes', () => {
  const wp = R.lawnmower(DXB, 2, 1, 200, 0);
  assert.ok(wp.length >= 10);                       // 1km/200m -> ≥6 passes x 2 pts
  assert.ok(R.pathLengthKm(wp) > 10);               // total path longer than 2km width x passes
});
test('orbit closed and radius correct', () => {
  const wp = R.orbit(DXB, 500, 24);
  assert.strictEqual(wp.length, 25);                // closed: first == last
  assert.deepStrictEqual(wp[0], wp[24]);
  const d = R.pathLengthKm([DXB, wp[0]]);
  assert.ok(Math.abs(d - 0.5) < 0.02);
});
test('corridor extracts sub-path of requested length', () => {
  const road = [[54.72,24.40],[55.05,24.90],[55.25,25.05],[55.42,25.22]];
  const wp = R.corridor(road, 0.2, 15);
  assert.ok(Math.abs(R.pathLengthKm(wp) - 15) < 1.5);
});
test('pointAlong interpolates with heading', () => {
  const { pos, heading } = R.pointAlong([[55,25],[55.1,25]], 0.5);
  assert.ok(Math.abs(pos[0] - 55.05) < 1e-6);
  assert.ok(Math.abs(heading - 90) < 1);            // due east
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/`
Expected: router tests FAIL (SimRouter undefined).

- [ ] **Step 3: Implement router.js**

```js
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
    const y=-h/2+i*(h/passes>0?h/(passes-1):0)* (passes>1?1:0) * (passes-1)/(passes-1); // even spacing
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
```

NOTE: clean up the duplicated spacing lines in `lawnmower` — keep only the `yy` computation.

- [ ] **Step 4: Run tests until green**

Run: `node --test tests/`
Expected: all router tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: route pattern generator with tests"
```

---

### Task 9: Sim engine (entities, scheduler, events)

**Files:**
- Create: `assets/js/sim/engine.js`, `assets/js/data/missions-config.js`
- Test: `tests/engine.test.js`
- Modify: `index.html` (script tags), `assets/js/main.js` (start engine after theater entry), `assets/js/ui/map.js` (live drone/dock source updates)

**Interfaces:**
- Consumes: `DATA_DOCKS`, `SimRouter`, `GEO_UAE.roads`, `EC2.ui.pushEvent`, `EC2.state.timeScale`.
- Produces: `window.SimEngine` (constructible headless for tests):
  - `SimEngine.create({docks, roads, now=0}) → engine`
  - `engine.tick(dtSeconds)` advances sim time (already scaled by caller)
  - `engine.docks` Map id→dock `{id, coords, battery(0..100), state, drone}`
  - `engine.drones` Map id→drone `{id, model, dockId, pos, alt, heading, speedMs, battery, state, missionId}`; drone id = dock id with `E` prefix per spec convention (`EAD-…` style NOT used; keep `D-` + dock id, e.g. `D-DXB-017`)
  - `engine.missions` Map id→mission `{id, type, dockId, waypoints, params, progress(0..1), state, analytics, startedAt}`
  - `engine.createMission({type, dockId, waypoints, params}) → mission` (used by wizard AND scheduler)
  - `engine.events` = ring buffer; `engine.onEvent(cb)`
  - Mission types (missions-config.js): `security, infra, emergency, delivery, construction, highway, parks` each `{ label, pattern:'perimeter'|'corridor'|'atob'|'lawnmower'|'orbit', defaults:{altM, speedMs}, analytics(mission, rng) → object }` (analytics templates per spec §7 table).
  - Drone states: `docked→takeoff(20s sim)→transit→on-task→rtb→landing(20s)→docked(charging until 100%)`; battery drains 100→0 over 40 min flight at 1×; forced RTB at 25%.
  - Scheduler: every tick, if airborne count < target (default 14) and an eligible dock exists (`ready`, battery ≥ 60), start an auto mission of a random type with a route near that dock.

- [ ] **Step 1: Write failing tests**

```js
// tests/engine.test.js
const test = require('node:test');
const assert = require('node:assert');
require('../assets/js/sim/router.js');
require('../assets/js/data/docks.js');
require('../assets/js/data/geo-uae.js');
require('../assets/js/data/missions-config.js');
require('../assets/js/sim/engine.js');

function mk(){ return globalThis.SimEngine.create({
  docks: globalThis.DATA_DOCKS, roads: globalThis.GEO_UAE.roads }); }

test('boots with all docks ready, none airborne', () => {
  const e = mk();
  assert.strictEqual(e.docks.size, 104);
  assert.strictEqual([...e.drones.values()].filter(d=>d.state!=='docked').length, 0);
});
test('scheduler reaches airborne target', () => {
  const e = mk();
  for (let i=0;i<600;i++) e.tick(1);         // 10 sim minutes
  const air = [...e.drones.values()].filter(d=>!['docked'].includes(d.state)).length;
  assert.ok(air >= 10, 'airborne='+air);
});
test('mission lifecycle completes and yields analytics', () => {
  const e = mk();
  const m = e.createMission({ type:'highway', dockId:'DXB-001',
    waypoints: globalThis.SimRouter.corridor(
      globalThis.GEO_UAE.roads.features[1].geometry.coordinates, 0.1, 8),
    params:{ altM:100, speedMs:15 } });
  let done=false; e.onEvent(ev=>{ if(ev.message.includes(m.id)&&ev.message.includes('COMPLETE')) done=true; });
  for (let i=0;i<7200 && m.state!=='complete'; i++) e.tick(1);
  assert.strictEqual(m.state, 'complete');
  assert.ok(m.analytics.vehiclesFlagged >= 0);
});
test('battery floor forces RTB', () => {
  const e = mk();
  const m = e.createMission({ type:'security', dockId:'AUH-001',
    waypoints: globalThis.SimRouter.perimeter([54.35,24.47], 3000, 8),
    params:{ altM:80, speedMs:10 } });
  const d = [...e.drones.values()].find(x=>x.missionId===m.id);
  d.battery = 26;
  for (let i=0;i<300;i++) e.tick(1);
  assert.ok(['rtb','landing','docked'].includes(d.state));
});
test('drones never leave UAE bbox', () => {
  const e = mk();
  for (let i=0;i<1800;i++) e.tick(1);
  for (const d of e.drones.values()){
    assert.ok(d.pos[0]>51 && d.pos[0]<56.7 && d.pos[1]>22.4 && d.pos[1]<26.4, d.id);
  }
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/`
Expected: engine tests FAIL.

- [ ] **Step 3: Implement missions-config.js**

Analytics templates (rng = seeded-ish `Math.random` wrapper; correlate with `mission.distanceKm` and duration):

```js
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
```

- [ ] **Step 4: Implement engine.js**

Core loop per drone state machine; battery drain `100/(40*60)` %/s scaled; movement via `SimRouter.pointAlong(mission.waypoints, progress)` where `progress += speedMs*dt/1000/distKm`. RTB = `atob(pos, dockCoords)`. Scheduler picks a random eligible dock every 8 sim seconds if below target. Auto-mission route generation per pattern:
- `perimeter`: around dock, radius 1500–4000 m
- `orbit`: around random point within 3 km of dock, radius 300–800 m
- `lawnmower`: centered within 4 km of dock, 1–2.5 km sides, spacing 150 m
- `corridor`: nearest road polyline to the dock (min vertex distance), random startFrac, 6–18 km
- `atob`: dock → random dock within 40 km (delivery) or random point within 12 km (emergency)
Events: emitted on launch, waypoint milestones (25/50/75%), detections (per type wording from reference-style copy, uppercase mono), RTB, landing, complete, dock fault (random 1/2000 ticks, auto-clears in 120 s), wind hold (random, 60 s).
`engine.rand` = `mulberry32(42)` seeded PRNG; analytics use it (deterministic-ish but not required).

- [ ] **Step 5: Run tests until green**

Run: `node --test tests/`
Expected: all PASS. Iterate on engine until they do.

- [ ] **Step 6: Wire into browser**

main.js: after first `enterTheater` completes, create engine (`window.__engine = SimEngine.create(...)`), rAF loop calls `engine.tick(dtReal * EC2.state.timeScale)` (cap dt 0.1 s), then `EC2.updateLiveLayers(engine)` in map.js:
- `drones` GeoJSON source: position, heading (symbol layer with triangle icon created via `map.addImage` from a small canvas, `icon-rotate:['get','heading']`, `icon-rotation-alignment:'map'`), color state-driven.
- `docks-dots` circle color: ready red, charging amber, fault amber blink (paint interpolation on `Date.now()%1000`), drone-away dim `#7d8697`.
- Active mission corridors: `missions-active` line source, dashed `#ff5a5a`, updated on mission start/end.
- Ping ring on selected/active docks via animated `circle-radius`/`circle-opacity` (single `requestAnimationFrame` driver in map.js).
Engine events → `EC2.ui.pushEvent` + chips `#c-air`, `#c-alerts` updated.

- [ ] **Step 7: Verify in browser**

Dive in: within ~30 s a dozen drones launch and crawl along corridors/patterns, ticker streams events, airborne chip counts up, 16× visibly accelerates. FPS ≥ 55 in devtools performance overlay.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: autonomous simulation engine with live map rendering"
```

---

### Task 10: Drone selection, telemetry panel, follow mode

**Files:**
- Modify: `assets/js/ui/panels.js`, `assets/js/ui/map.js`, `assets/css/console.css`

**Interfaces:**
- Consumes: `engine.drones`, `EC2.select`, `setRightPanel('drone', drone)`.
- Produces: map click on drone symbol selects it; right panel `'drone'` mode: callsign header, mission line, telemetry grid (ALT, SPD, HDG, BAT, LINK `O3+ · -62 DBM` static, DIST HOME computed), FPV placeholder frame (reticle + corner data bound to live telemetry per reference video-chrome style), buttons: FOLLOW (toggle), TAKE CONTROL (enabled Task 11), RETURN TO DOCK, PAUSE/RESUME. `EC2.followDroneId` — when set, camera `easeTo` drone each second.

- [ ] **Step 1: Implement selection + panel**

Map `click` on `drones` layer → `EC2.select({type:'drone', id})`. Panel refreshes at 2 Hz from engine state (store interval, clear on mode change). RETURN TO DOCK calls `engine.commandRTB(droneId)` (add to engine: sets state rtb + event `MANUAL RTB COMMAND`). PAUSE holds progress (state `'hold'`, add to engine with event).

- [ ] **Step 2: Verify in browser**

Click a moving drone: panel shows live numbers changing; FOLLOW keeps it centered; RTB sends it home and it docks + recharges. PAUSE freezes it mid-air, RESUME continues.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: drone telemetry panel with follow and RTB"
```

---

### Task 11: Manual control (take control, click-to-go, waypoint queue)

**Files:**
- Create: `assets/js/ui/control.js`
- Modify: `index.html` (script tag), `assets/js/ui/panels.js`, `assets/js/sim/engine.js`, `assets/css/console.css`

**Interfaces:**
- Consumes: selected drone, `engine`.
- Produces: `engine.setManual(droneId, on)`, `engine.manualGoto(droneId, lonlat)` (replaces queue), `engine.manualQueue(droneId, lonlat)` (appends), `engine.nudgeAlt(droneId, ±10)`; drone state `'manual'`; UI: TAKE CONTROL button toggles mode: map cursor `crosshair`, banner chip "MANUAL CONTROL · <id> · CLICK TO FLY · SHIFT+CLICK TO QUEUE", queued waypoints rendered as numbered diamonds (`manual-wpts` source), ALT +/- buttons in panel, RELEASE button exits. Events logged: `MANUAL CONTROL ENGAGED/RELEASED — OPERATOR`.

- [ ] **Step 1: Engine support**

In manual state the drone flies toward the head of its queue at `min(speedMs, 18)`; on arrival pops queue; empty queue = hover (speed 0, small heading wobble). Battery keeps draining; floor rule still forces RTB (releases manual, event `BATTERY FLOOR · MANUAL RELEASED · RTB`).

- [ ] **Step 2: UI wiring**

While active: map `click` → `manualGoto`; `shift+click` → `manualQueue`; ESC or RELEASE exits. Guard: selecting another entity or GLOBE exits manual first.

- [ ] **Step 3: Verify in browser**

Take control of an airborne drone: click far point, drone turns and flies; shift-click 3 points, it visits in order then hovers; ALT nudge changes panel altitude; drain battery via console (`__engine.drones.get(id).battery=26`) → auto-release + RTB.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: manual drone control with click-to-go and waypoint queue"
```

---

### Task 12: Mission wizard (point-and-click creation)

**Files:**
- Modify: `assets/js/ui/control.js`, `assets/js/ui/panels.js`, `assets/css/console.css`

**Interfaces:**
- Consumes: `engine.createMission`, `MISSIONS_CONFIG`, selected dock (optional prefill).
- Produces: `setRightPanel('wizard')` 3-step flow; NEW MISSION button in dock card and an always-available `+ NEW MISSION` button in the top bar (left of MEDIA).
  - Step 1: 7 type tiles (label + tiny glyph), launch dock select (nearest-to-map-center preselected, dropdown of ready docks).
  - Step 2: waypoint capture on map. For `corridor|atob|perimeter|orbit` types: each click adds a numbered waypoint (draggable NOT required); for `lawnmower` types (`construction`, `parks`): two clicks define an area box (corner to corner) + spacing slider (100–300 m), route preview auto-generated via `SimRouter.lawnmower` from box center/size. Live preview line + distance + duration estimate (`distKm / speed`); UNDO last point; ≥2 points (or box) required to proceed.
  - Step 3: params: altitude slider 40–120 m, speed slider 5–21 m/s (defaults from config), summary, LAUNCH → `engine.createMission`, panel switches to that drone's `'drone'` mode with FOLLOW on.

- [ ] **Step 1: Implement wizard state machine** (`control.js` owns `wizard = {step, type, dockId, points, params}` and map click routing between manual mode / wizard mode / normal selection; only one capture mode active at a time)

- [ ] **Step 2: Verify in browser**

Create a highway mission along E311 with 6 clicks: preview shows, estimate plausible; launch: drone lifts from chosen dock, transits, flies the exact clicked line, debrief arrives on completion (placeholder until Task 13; verify mission `state==='complete'` in console). Create construction mission via area box: lawnmower preview renders. All 7 types creatable.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: three-step point-and-click mission wizard"
```

---

### Task 13: Debrief, analytics, video slots, MEDIA library

**Files:**
- Create: `assets/js/data/video-manifest.js`, `videos/README.md`
- Modify: `assets/js/ui/panels.js`, `assets/js/sim/engine.js` (attach analytics at completion; already in Task 9 — verify), `index.html`, `assets/css/console.css`

**Interfaces:**
- Consumes: completed missions (`engine.onEvent` completion), `MISSIONS_CONFIG`, `VIDEO_MANIFEST`.
- Produces: `window.VIDEO_MANIFEST = { security:['security-01.mp4'], infra:['infra-01.mp4'], emergency:['emergency-01.mp4'], delivery:['delivery-01.mp4'], construction:['construction-01.mp4'], highway:['highway-01.mp4'], parks:['parks-01.mp4'] }`; `setRightPanel('debrief', mission)`; MEDIA view (`setRightPanel('media')`) listing session missions with thumbnails/state; `EC2.playMissionVideo(mission)`.

- [ ] **Step 1: videos/README.md**

```markdown
# Mission video library
Files here are played in mission debriefs. Naming: <type>-<nn>.mp4
Types: security, infra, emergency, delivery, construction, highway, parks.
Register files in assets/js/data/video-manifest.js. Missing files fall back
to the animated placeholder automatically. Target content per video:
dock opens -> takeoff -> flight POV with analytics overlay -> landing. 16:9, 10-30 s.
```

- [ ] **Step 2: Debrief panel**

On mission complete: toast chip in ticker (`DEBRIEF READY · <id>`, click opens) and if the mission was user-created, auto-open debrief. Layout per reference video chrome: header (type label, mission id, dock, duration, distance), analytics block (definition list from `MISSIONS_CONFIG[type].analytics` output, mono values), video frame: `<video>` with `src` from manifest (first existing variant; rotate per mission count), `onerror` → swap to placeholder `<canvas>` animation (drifting horizon line + reticle + "AI MISSION VIDEO · PENDING GENERATION" mono caption, drawn at 30fps only while visible), footer `HIGGSFIELD · GEN-4` + duration.

- [ ] **Step 3: MEDIA view**

Grid list (2-col) of all missions this session, newest first: type label, id, time, state chip, mini analytics line; click → debrief. Empty state: "NO MISSIONS RECORDED YET · CREATE ONE WITH + NEW MISSION".

- [ ] **Step 4: Verify in browser**

Run a short user mission at 16×: completion auto-opens debrief with type-correct analytics and placeholder video animation (no console errors from missing MP4s). Drop any small test MP4 in `videos/` named `highway-01.mp4`, reload, rerun: it plays. MEDIA lists both missions.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: mission debriefs with analytics and video library"
```

---

### Task 14: Polish, acceptance pass, demo script

**Files:**
- Create: `docs/demo-script.md`
- Modify: any files needing fixes found during the pass

**Interfaces:** none new; this task closes the spec's acceptance criteria (§10).

- [ ] **Step 1: Run the 10 acceptance criteria from the spec**

For each criterion 1–10 in `docs/superpowers/specs/2026-07-22-uae-drone-c2-console-design.md` §10, verify in browser and record PASS/FAIL in the task notes. Fix any FAIL before proceeding. Criterion 4 (offline) via devtools offline; criterion 9 (fps) via devtools performance overlay at full fleet + 16×.

- [ ] **Step 2: Visual polish pass against reference**

Side-by-side with `reference/embedded_sim.html`: chip styling, micro-label tracking, panel radii, map dot sizes, legend. Fix drift. Verify no em dashes anywhere in UI copy (`grep -rn "—" assets/ index.html` → only allowed in code comments, not UI strings).

- [ ] **Step 3: Write docs/demo-script.md**

Narrated 5-minute demo flow: orbit → dive → tour layers → dock card → watch autonomous ops at 4× → take control of a drone → create E311 highway mission → debrief + MEDIA → offline resilience beat → return to orbit. One line per beat with what to click and what to say.

- [ ] **Step 4: Final commit**

```bash
git add -A && git commit -m "chore: acceptance pass, polish, demo script"
```

---

## Self-review notes

- Spec coverage: §3 shell → Task 7; §4 map/globe/offline → Tasks 1, 4, 5, 6; §5 sim → Tasks 3, 8, 9; §6 interactions → Tasks 10, 11, 12; §7 analytics → Task 9 (config) + 13 (display); §8 videos → Task 13; §9 resilience → Tasks 1 (boot guard), 6, 9 (clamps); §10–11 → Task 14.
- Naming consistency check: `EC2.setLayer`, `EC2.select`, `setRightPanel(mode)`, `engine.createMission`, `SimRouter.*` used consistently across tasks; drone ids `D-<dockId>`; mission types `security|infra|emergency|delivery|construction|highway|parks` everywhere (spec's long names map via `MISSIONS_CONFIG[type].label`).
- Known judgment calls delegated to implementer: exact 104 dock coordinates (anchors + rules given), lawnmower cleanup noted in Task 8 Step 3, icon canvas art for drone triangles.
