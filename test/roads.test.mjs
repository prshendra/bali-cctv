import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoads, distanceToRoadMeters, nearRoad, isSunsetSearch } from '../dist/roads.js';

const road = { id: 'test', name: 'Test road', paths: [[[0, 0], [0, 0.1]]] };
test('road proximity measures segment interiors, endpoints and duplicate vertices', () => {
  assert.equal(distanceToRoadMeters({ latitude: 0, longitude: .05 }, road), 0);
  assert.ok(Math.abs(distanceToRoadMeters({ latitude: .001, longitude: .05 }, road) - 111.195) < .1);
  assert.ok(distanceToRoadMeters({ latitude: 0, longitude: -.001 }, road) > 111);
  assert.equal(distanceToRoadMeters({ latitude: 0, longitude: 0 }, { paths: [[[0, 0], [0, 0]]] }), 0);
  assert.equal(distanceToRoadMeters({ latitude: 91, longitude: 0 }, road), Infinity);
  assert.equal(distanceToRoadMeters({ latitude: 0, longitude: 0 }, { paths: [] }), Infinity);
});
test('road area excludes invalid positions, includes radius boundary and sorts nearest first', () => {
  const far = { id: 'far', latitude: .001, longitude: .05 };
  const close = { id: 'close', latitude: 0, longitude: .05 };
  const edge = distanceToRoadMeters(far, road);
  assert.deepEqual(nearRoad([far, {}, close], road, edge), [close, far]);
  assert.deepEqual(nearRoad([far], road, edge - 1), []);
  assert.deepEqual(nearRoad([far], road, -1), []);
});
test('road snapshot and Sunset Road search aliases are validated', () => {
  assert.equal(normalizeRoads({ roads: [road, { id: 'bad', name: 'Bad', paths: [[[91, 0], [1, 1]]] }] }).length, 1);
  assert.deepEqual(normalizeRoads(null), []);
  for (const query of ['Sunset Road', 'sunset', 'Jalan Sunset Road', 'Jl. Sunset Road']) assert.ok(isSunsetSearch(query));
  assert.equal(isSunsetSearch('teuku umar'), false);
});
