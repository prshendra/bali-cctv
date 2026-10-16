import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { distanceMeters, nearbyCameras, nearestStation, normalizeStations, validCoordinate } from '../dist/geo.js';
import { createSnapshot, elementsFromOverpass, paddedBounds, stationData } from '../scripts/sync-fuel.mjs';

test('coordinates include zero and reject invalid bounds', () => {
  assert.equal(validCoordinate({ latitude: 0, longitude: 0 }), true);
  assert.equal(validCoordinate({ latitude: -90, longitude: 180 }), true);
  for (const point of [null, {}, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }, { latitude: NaN, longitude: 0 }]) {
    assert.equal(validCoordinate(point), false);
  }
});

test('Haversine distance handles identity and a known equatorial degree', () => {
  assert.equal(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }), 0);
  assert.ok(Math.abs(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }) - 111194.93) < 1);
  assert.equal(distanceMeters({ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 0 }), Infinity);
});

test('nearest station keeps first entry for a tie and handles empty or invalid data', () => {
  const camera = { latitude: 0, longitude: 0 };
  const first = { id: 'node/1', latitude: 0, longitude: -0.001 };
  const second = { id: 'node/2', latitude: 0, longitude: 0.001 };
  assert.deepEqual(nearestStation(camera, [first, second]), { station: first, distanceMeters: distanceMeters(camera, first) });
  assert.equal(nearestStation(camera, []), null);
  assert.equal(nearestStation({ latitude: NaN, longitude: 0 }, [first]), null);
});

test('nearby cameras filters by selected station or nearest station and includes radius boundary', () => {
  const selected = { id: 'node/1', latitude: 0, longitude: 0 };
  const other = { id: 'node/2', latitude: 0, longitude: 0.01 };
  const cameras = [
    { id: 'inside', latitude: 0, longitude: 0.001 },
    { id: 'outside', latitude: 0, longitude: 0.01 },
    { id: 'boundary', latitude: 0, longitude: 0.002 }
  ];
  const boundary = distanceMeters(cameras[2], selected);
  const selectedResults = nearbyCameras(cameras, [selected, other], { stationId: selected.id, radiusMeters: boundary });
  assert.deepEqual(selectedResults.map(result => result.camera.id), ['inside', 'boundary']);
  assert.equal(selectedResults[0].station, selected);
  assert.deepEqual(nearbyCameras(cameras, [selected, other], { radiusMeters: 250 }).map(result => result.camera.id), ['outside', 'inside', 'boundary']);
  assert.deepEqual(nearbyCameras(cameras, [selected], { stationId: 'node/999' }), []);
  assert.deepEqual(nearbyCameras(cameras, [selected], { radiusMeters: -1 }), []);
  assert.deepEqual(nearbyCameras(cameras, [selected], { radiusMeters: Infinity }), []);
  assert.deepEqual(nearbyCameras(cameras, []), []);
});

test('station snapshot is validated and normalizes valid station records', async () => {
  const payload = JSON.parse(await readFile(new URL('../dist/fuel-stations.json', import.meta.url), 'utf8'));
  const normalized = normalizeStations(payload);
  assert.ok(normalized.stations.length > 0);
  assert.equal(normalized.updatedAt, payload.updatedAt);
  assert.equal(new Set(normalized.stations.map(station => station.id)).size, normalized.stations.length);
  for (const station of normalized.stations) {
    assert.match(station.id, /^(node|way|relation)\/[1-9]\d*$/);
    assert.equal(typeof station.name, 'string');
    assert.ok(station.name.trim());
    assert.equal(typeof station.brand, 'string');
    assert.equal(typeof station.address, 'string');
    assert.equal(validCoordinate(station), true);
    assert.equal(station.osmUrl, `https://www.openstreetmap.org/${station.id}`);
  }
  assert.deepEqual(normalizeStations({}), { stations: [], updatedAt: '' });
});

test('fuel sync rejects empty or partial Overpass responses before snapshot creation', () => {
  assert.throws(() => elementsFromOverpass({ elements: [] }), /no elements/);
  assert.throws(() => elementsFromOverpass({ elements: [{ type: 'node' }], remark: 'runtime error: query timed out' }), /incomplete/);
  assert.throws(() => createSnapshot([], [-9, 115, -8, 116], '2026-10-16T00:00:00.000Z'), /empty or invalid/);
  assert.throws(() => createSnapshot([{ type: 'node', id: 1, tags: {}, lat: 0, lon: 0 }], [-9, 115, -8, 116]), /empty or invalid/);
});

test('fuel sync keeps only active amenity=fuel stations and drops nitrogen-only service', () => {
  const elements = [
    { type: 'node', id: 1, lat: 0, lon: 0, tags: { amenity: 'fuel', name: 'Green Nitrogen A Yani', 'fuel:nitrogen': 'yes', 'fuel:nitrogen_filling': 'yes' } },
    { type: 'node', id: 2, lat: 0, lon: 0, tags: { amenity: 'fuel', name: 'SPBU Pertamina', 'fuel:nitrogen': 'yes', 'fuel:diesel': 'yes' } },
    { type: 'node', id: 3, lat: 0, lon: 0, tags: { amenity: 'parking', name: 'Parking' } },
    { type: 'node', id: 4, lat: 0, lon: 0, tags: { amenity: 'fuel', name: 'Closed', closed: 'yes' } }
  ];
  assert.deepEqual(stationData(elements).map(station => station.id), ['node/2']);
  const bounds = paddedBounds([{ latitude: -8.7, longitude: 115.2 }, { latitude: -8.6, longitude: 115.3 }]);
  assert.deepEqual(bounds, [-8.75, 115.15, -8.549999999999999, 115.35]);
  const snapshot = createSnapshot([elements[1]], bounds, '2026-10-16T00:00:00.000Z');
  assert.equal(snapshot.stations.length, 1);
  assert.throws(() => createSnapshot([elements[1]], [], '2026-10-16T00:00:00.000Z'), /empty or invalid/);
});
