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
