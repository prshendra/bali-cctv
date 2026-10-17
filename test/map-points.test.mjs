import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cameraPoints, clusterPoints } from '../dist/map-points.js';
import { mergeCameras, normalizeCatalogue } from '../dist/catalog.js';
import { normalizeStations } from '../dist/geo.js';

const point = (id, x, y) => ({ id, latitude: y, longitude: x });
const project = item => ({ x: item.longitude, y: item.latitude });

test('map clusters retain every item and split nearby points when zoomed in', () => {
  const points = [point('a', 2, 3), point('b', 8, 4), point('c', 81, 82)];
  const clusters = clusterPoints(points, project, 56);
  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters.flatMap(cluster => cluster.items).map(item => item.id).sort(), ['a', 'b', 'c']);
  assert.equal(clusters[0].latitude, 3.5);
  assert.equal(clusters[0].longitude, 5);
  assert.equal(clusterPoints(points, item => ({ x: item.longitude * 100, y: item.latitude * 100 }), 56).length, 3);
  assert.equal(clusterPoints(points, project, 0).length, 3);
});

test('map grouping keeps all camera angles at a junction and ignores invalid positions', () => {
  const cameras = [
    point('angle1', 115.2, -8.6), point('angle2', 115.2, -8.6),
    point('other', 115.3, -8.6), point('invalid', Infinity, -8.6)
  ];
  const groups = cameraPoints(cameras);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].cameras.map(camera => camera.id), ['angle1', 'angle2']);
  assert.deepEqual(groups.flatMap(group => group.cameras).map(camera => camera.id), ['angle1', 'angle2', 'other']);
});

test('overview clustering substantially reduces real catalogue markers without dropping points', async () => {
  const load = async name => JSON.parse(await readFile(new URL(`../dist/${name}.json`, import.meta.url)));
  const cameras = mergeCameras(normalizeCatalogue(await load('cameras')).cameras, normalizeCatalogue(await load('additional-cameras')).cameras);
  const groups = cameraPoints(cameras);
  const stations = normalizeStations(await load('fuel-stations')).stations;
  const mercator = item => {
    const sin = Math.sin(item.latitude * Math.PI / 180);
    return { x: (item.longitude + 180) / 360 * 256 * 2 ** 9, y: (.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 256 * 2 ** 9 };
  };
  const clusters = [...clusterPoints(groups, mercator), ...clusterPoints(stations, mercator)];
  assert.ok(clusters.length < 100, `Overview would render ${clusters.length} markers`);
  assert.equal(clusters.reduce((sum, cluster) => sum + cluster.items.length, 0), groups.length + stations.length);
  assert.equal(clusterPoints(groups, mercator, 0).length, groups.length);
  assert.equal(clusterPoints(stations, mercator, 0).length, stations.length);
});
