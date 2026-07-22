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
