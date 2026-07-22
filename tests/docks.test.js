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
