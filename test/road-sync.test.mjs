import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoadSnapshot, elementsFromOverpass } from '../scripts/sync-roads.mjs';

const elements = [
  { type: 'way', id: 20, tags: { highway: 'secondary', name: 'Jalan Sunset Road' }, geometry: [{ lat: -8.7, lon: 115.17 }, { lat: -8.71, lon: 115.18 }] },
  { type: 'way', id: 21, tags: { highway: 'service', name: 'Gang Sunset' }, geometry: [{ lat: -8.7, lon: 115.17 }, { lat: -8.71, lon: 115.18 }] },
  { type: 'way', id: 22, tags: { highway: 'residential', name: 'Sunset Villas' }, geometry: [{ lat: -8.7, lon: 115.17 }, { lat: -8.71, lon: 115.18 }] },
  { type: 'way', id: 23, tags: { name: 'Sunset Road' }, geometry: [{ lat: -8.7, lon: 115.17 }, { lat: -8.71, lon: 115.18 }] },
  { type: 'way', id: 10, tags: { highway: 'secondary', name: 'Sunset Road' }, geometry: [{ lat: -8.69, lon: 115.16 }, { lat: -8.7, lon: 115.17 }] }
];

test('road sync rejects partial and empty Overpass responses', () => {
  assert.throws(() => elementsFromOverpass({ elements: [] }), /no elements/);
  assert.throws(() => elementsFromOverpass({ elements, remark: 'runtime error: query timed out' }), /incomplete/);
});

test('road sync saves only exact Sunset Road highway ways in stable OSM id order', () => {
  const dataset = createRoadSnapshot(elements, '2026-10-17T00:00:00.000Z');
  assert.equal(dataset.source, 'OpenStreetMap contributors');
  assert.equal(dataset.sourceUrl, 'https://www.openstreetmap.org/copyright');
  assert.equal(dataset.roads.length, 1);
  assert.equal(dataset.roads[0].id, 'sunset-road');
  assert.equal(dataset.roads[0].name, 'Sunset Road');
  assert.deepEqual(dataset.roads[0].osmWayIds, [10, 20]);
  assert.deepEqual(dataset.roads[0].paths[0], [[-8.69, 115.16], [-8.7, 115.17]]);
  assert.equal(dataset.roads[0].paths.length, 2);
});

test('road sync refuses a snapshot without exact ways or with incomplete geometry', () => {
  assert.throws(() => createRoadSnapshot(elements.slice(1, 4)), /empty or invalid/);
  assert.throws(() => createRoadSnapshot([
    { type: 'way', id: 31, tags: { highway: 'secondary', name: 'Sunset Road' }, geometry: [{ lat: -8.7, lon: 115.17 }] }
  ]), /missing geometry/);
  assert.throws(() => createRoadSnapshot([
    { type: 'way', id: 31, tags: { highway: 'secondary', name: 'Sunset Road' }, geometry: [{ lat: -90.1, lon: 115.17 }, { lat: -8.7, lon: 115.17 }] }
  ]), /invalid geometry/);
});
