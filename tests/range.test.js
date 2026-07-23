// tests/range.test.js
const test = require('node:test');
const assert = require('node:assert');
require('../assets/js/sim/router.js');
require('../assets/js/data/docks.js');
require('../assets/js/data/geo-uae.js');
require('../assets/js/data/missions-config.js');
require('../assets/js/sim/engine.js');

const R = globalThis.SimRouter;
const RANGE = globalThis.DOCK_RANGE;
const DOCKS = globalThis.DATA_DOCKS;

test('dock coverage is 3km inside a city and 5km in the open', () => {
  const urban = DOCKS.find(d => d.id === 'DXB-001'); // Business Bay, central Dubai
  const rural = DOCKS.find(d => d.id === 'AUH-024'); // Liwa Oasis, deep desert
  assert.strictEqual(RANGE.dockRangeKm(urban), 3);
  assert.strictEqual(RANGE.dockRangeKm(rural), 5);
});

test('explicit urban override wins over geography', () => {
  assert.strictEqual(RANGE.dockRangeKm({ coords: [53.78, 23.13], urban: true }), 3);
  assert.strictEqual(RANGE.dockRangeKm({ coords: [55.263, 25.185], urban: false }), 5);
});

test('every dock classifies to a valid range', () => {
  for (const d of DOCKS){
    const km = RANGE.dockRangeKm(d);
    assert.ok(km === 3 || km === 5, d.id + ' got range ' + km);
  }
});

test('autonomous drones never fly beyond their dock coverage range', () => {
  const e = globalThis.SimEngine.create({ docks: DOCKS, roads: globalThis.GEO_UAE.roads });
  const MARGIN_M = 300; // clamp + lon/lat-vs-meters slack
  let maxAirborne = 0;
  for (let i = 0; i < 4000; i++){
    e.tick(1);
    let air = 0;
    for (const d of e.drones.values()){
      if (d.state === 'docked') continue;
      air++;
      const dock = e.docks.get(d.dockId);
      const rangeM = RANGE.dockRangeKm(dock) * 1000;
      const dist = R.distM(dock.coords, d.pos);
      assert.ok(dist <= rangeM + MARGIN_M,
        d.id + ' is ' + Math.round(dist) + 'm from ' + dock.id +
        ', beyond its ' + rangeM + 'm coverage');
    }
    maxAirborne = Math.max(maxAirborne, air);
  }
  // Sanity: the run actually exercised a busy fleet, not an idle one.
  assert.ok(maxAirborne >= 10, 'expected a busy fleet, peaked at ' + maxAirborne);
});
