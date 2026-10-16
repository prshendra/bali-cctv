import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { filterCameras, normalizeCatalogue, paginate, validStream } from '../dist/catalog.js';

const data = JSON.parse(await readFile(new URL('../dist/cameras.json', import.meta.url)));
const cameras = normalizeCatalogue(data).cameras;
test('catalogue contains every published camera, including multiple cameras at a junction', () => {
  assert.equal(cameras.length, data.cameras.length);
  assert.ok(cameras.length > new Set(cameras.map(c => c.location)).size);
  assert.equal(new Set(cameras.map(c => c.id)).size, cameras.length);
  for (const camera of data.cameras) {
    assert.deepEqual(Object.keys(camera).sort(), ['description', 'id', 'latitude', 'location', 'longitude', 'name', 'url']);
    assert.ok(validStream(camera.url));
  }
});
test('pagination reaches every camera without duplicates and clamps after filtering', () => {
  for (const size of [4, 9, 16]) {
    const all = [];
    const pages = paginate(cameras, 1, size).pages;
    for (let page = 1; page <= pages; page++) all.push(...paginate(cameras, page, size).items);
    assert.deepEqual(all, cameras);
    assert.equal(paginate(cameras.slice(0, 1), 50, size).page, 1);
  }
  assert.deepEqual(paginate([], 3, 9), { page: 1, pages: 1, items: [] });
});
test('street search, location filter, and saved favorites compose', () => {
  const camera = cameras.find(c => c.location === 'TEUKU UMAR');
  assert.ok(camera);
  const results = filterCameras(cameras, { query: 'imam bonjol', location: camera.location, favoritesOnly: true, favorites: new Set([camera.id]) });
  assert.deepEqual(results.map(c => c.id), [camera.id]);
  assert.equal(filterCameras(cameras, { query: 'does-not-exist' }).length, 0);
});
test('only public official playback endpoints are accepted', () => {
  for (const url of ['http://10.0.0.1/stream/cam/', 'rtsp://example.com/cam', 'https://evil.test/stream/cam/', 'https://atcs.denpasarkota.go.id@evil.test/stream/a/', 'https://user:password@atcs.denpasarkota.go.id/stream/a/', 'https://atcs.denpasarkota.go.id/stream/a/?token=abc']) assert.equal(validStream(url), false);
});
