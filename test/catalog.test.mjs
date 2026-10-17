import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { filterCameras, normalizeCatalogue, paginate, validStream, validHlsSource, mergeCameras } from '../dist/catalog.js';

const data = JSON.parse(await readFile(new URL('../dist/cameras.json', import.meta.url)));
const cameras = normalizeCatalogue(data).cameras;
test('catalogue contains every published camera, including multiple cameras at a junction', () => {
  assert.equal(cameras.length, data.cameras.length);
  assert.ok(cameras.length > new Set(cameras.map(c => c.location)).size);
  assert.equal(new Set(cameras.map(c => c.id)).size, cameras.length);
  for (const camera of data.cameras) {
    const allowed = new Set(['description', 'id', 'latitude', 'location', 'longitude', 'name', 'url', 'sourceId', 'sourceLabel', 'officialUrl', 'playback']);
    assert.ok(Object.keys(camera).every(key => allowed.has(key)));
    assert.ok(validStream(camera.url));
  }
});

test('government playback hosts are allowed without admitting arbitrary streams or private devices', () => {
  assert.ok(validStream('https://transcode.baliprov.go.id/cctv-player.html?id=kantor-lurah-seminyak'));
  assert.ok(validStream('https://shinobi.bulelengkab.go.id/public/feed/stream.mp4'));
  assert.ok(validHlsSource('https://transcode.baliprov.go.id/cctv/kantor-lurah-seminyak/index.m3u8'));
  for (const url of ['https://evil.example/cctv/cam/index.m3u8', 'http://transcode.baliprov.go.id/cctv/cam/index.m3u8', 'https://user:secret@transcode.baliprov.go.id/cctv/cam/index.m3u8', 'https://transcode.baliprov.go.id/cctv/../private/index.m3u8']) assert.equal(validHlsSource(url), false);
});

test('metadata duplicates merge with their public player while separate camera views survive', () => {
  const location = { id: 'badung-place', name: 'SEM 002 - Kantor Lurah Seminyak (Sunset Road)', sourceId: 'badung', sourceLabel: 'Badung', playback: 'link', url: 'https://map.badungkab.go.id/', latitude: -8.68792, longitude: 115.17574 };
  const camera = { ...location, id: 'bali-player', name: 'Kantor Lurah Seminyak', sourceId: 'bali', sourceLabel: 'Bali', playback: 'hls', url: 'https://transcode.baliprov.go.id/cctv-player.html?id=kantor-lurah-seminyak' };
  const other = { ...camera, id: 'other-angle', name: 'Kantor Lurah Seminyak C02', url: 'https://transcode.baliprov.go.id/cctv-player.html?id=kantor-lurah-seminyak-c02' };
  const merged = mergeCameras([location], [camera, other]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'bali-player');
  assert.deepEqual(merged[0].alsoListedBy, ['badung']);
  assert.equal(filterCameras(merged, { sourceId: 'badung' }).length, 1);
  assert.equal(filterCameras(merged, { query: 'SEM 002' }).length, 1);
  assert.equal(filterCameras(merged, { sourceId: 'bali', query: 'c02' }).length, 1);
  assert.equal(location.playback, 'link');
  assert.equal(mergeCameras([camera], [camera]).length, 1);
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
