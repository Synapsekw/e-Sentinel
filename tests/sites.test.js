// tests/sites.test.js
const test = require('node:test');
const assert = require('node:assert');
require('../assets/js/data/sites.js');

const EXPECTED_IDS = [
  'AAN3198','AAN367','AAN335','AAN3165','AAN393','AAN3002','AAN3015',
  'AUH140','AUH127','AUH1376','AUH158','AUH136','AUH109',
  'AUH1284','AUH110','AUH1377','AUH1383','AUH165','AUH1285'
];

test('19 sites, ids match the live network table exactly', () => {
  assert.strictEqual(globalThis.DATA_SITES.length, 19);
  const ids = new Set(globalThis.DATA_SITES.map(s => s.id));
  assert.strictEqual(ids.size, 19); // no duplicate ids
  assert.deepStrictEqual([...ids].sort(), [...EXPECTED_IDS].sort());
});

test('status distribution is 13/4/2 and entry shape is valid', () => {
  const counts = { installed: 0, 'not-installed': 0, replace: 0 };
  for (const s of globalThis.DATA_SITES) {
    assert.ok(['installed', 'not-installed', 'replace'].includes(s.status), s.id);
    assert.strictEqual(s.name, s.id); // name == Tower_ID exactly
    counts[s.status]++;
  }
  assert.strictEqual(counts.installed, 13);
  assert.strictEqual(counts['not-installed'], 4);
  assert.strictEqual(counts.replace, 2);
});

test('coords are [lon,lat] within UAE bbox (catches accidental swaps)', () => {
  for (const s of globalThis.DATA_SITES) {
    const [lon, lat] = s.coords;
    assert.ok(lon > 51 && lon < 56.6 && lat > 22.5 && lat < 26.3, s.id + ' out of UAE bbox');
    // lat values are ~23-25, lon ~54-56: lat < lon holds for every real entry,
    // so this also catches a [lat,lon] ordering mistake.
    assert.ok(lat < lon, s.id + ' looks like coords are [lat,lon] instead of [lon,lat]');
  }
});
