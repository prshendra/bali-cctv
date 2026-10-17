import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, parseBadungCatalogue, parseBaliCatalogue } from '../scripts/sync-additional-cameras.mjs';

const baliHls = 'https://transcode.baliprov.go.id/cctv-player.html?id=simpang-satu';
const baliMp4 = 'https://shinobi.bulelengkab.go.id/CameraA/mp4/admin/Stream1/s.mp4';

test('Bali parser creates allowlisted HLS and MP4 entries, deduping URLs but preserving colocated cameras', () => {
  const cameras = parseBaliCatalogue({ success: true, data: {
    raw1: { cctv_id: 'raw1', ch_id: 'internal1', ch_name: 'Simpang Satu', lat: '-8.65', lng: '115.2', streaming_url: baliHls, ipcam: 'rtsp://private' },
    duplicate: { cctv_id: 'raw2', ch_id: 'internal2', ch_name: 'Alias Satu', lat: -8.65, lng: 115.2, streaming_url: baliHls },
    mp4: { ch_name: 'Camera A', lat: -8.65, lng: 115.2, streaming_url: baliMp4 },
    invalidHost: { ch_name: 'Private', lat: -8.65, lng: 115.2, streaming_url: 'https://evil.test/camera.m3u8' },
    invalidPoint: { ch_name: 'No coordinates', lat: '', lng: '', streaming_url: baliHls }
  } });
  assert.equal(cameras.length, 2);
  assert.equal(cameras[0].id.startsWith('bali-'), true);
  assert.equal(cameras[0].url, baliHls);
  assert.equal(cameras[0].streamUrl, 'https://transcode.baliprov.go.id/cctv/simpang-satu/index.m3u8');
  assert.equal(cameras[0].playback, 'hls');
  assert.equal(cameras[1].url, baliMp4);
  assert.equal(cameras[1].playback, 'mp4');
  assert.equal(cameras[0].latitude, cameras[1].latitude);
  for (const camera of cameras) {
    assert.equal(camera.availability, 'unverified');
    assert.equal(Object.hasOwn(camera, 'cctv_id'), false);
    assert.equal(Object.hasOwn(camera, 'ch_id'), false);
    assert.equal(Object.hasOwn(camera, 'ipcam'), false);
  }
  assert.throws(() => parseBaliCatalogue({ success: true, data: {} }), /no cameras/);
  assert.throws(() => parseBaliCatalogue({ success: false, data: { raw: {} } }), /Invalid/);
});

test('Badung parser deduplicates normalized names and coordinates without keeping private stream fields', () => {
  const cameras = parseBadungCatalogue({ marker: [
    { id: 'internal1', title: 'CANG001 - Simpang Pipitan', lat: -8.636602, lng: 115.147165, ipcam: 'rtmp://private', url: 'https://private.test/stream' },
    { id: 'internal2', title: ' cang001   - SIMPANG pipitan ', lat: '-8.6366020', lng: '115.1471650', ipcam: 'rtsp://private' },
    { id: 'internal3', title: 'CANG002 - Simpang Pipitan', lat: -8.636602, lng: 115.147165, ipcam: 'rtmp://private' },
    { title: 'Bad coordinates', lat: 999, lng: 115.1, ipcam: 'rtsp://private' }
  ] });
  assert.equal(cameras.length, 2);
  assert.equal(cameras[0].id.startsWith('badung-'), true);
  assert.equal(cameras[0].url, 'https://map.badungkab.go.id/');
  assert.equal(cameras[0].playback, 'link');
  assert.equal(cameras[0].latitude, cameras[1].latitude);
  for (const camera of cameras) {
    assert.equal(camera.availability, 'unverified');
    assert.equal(Object.hasOwn(camera, 'ipcam'), false);
    assert.equal(Object.hasOwn(camera, 'id') && camera.id.includes('internal'), false);
    assert.deepEqual(Object.keys(camera).sort(), ['availability', 'description', 'id', 'latitude', 'location', 'longitude', 'name', 'playback', 'sourceId', 'url']);
  }
  assert.throws(() => parseBadungCatalogue({ marker: [] }), /empty/);
  assert.throws(() => parseBadungCatalogue({ marker: [{ title: 'Invalid', lat: 999, lng: 115 }] }), /no valid/);
});

test('source refresh failure preserves only that source prior entries and records the failure', () => {
  const previous = {
    cameras: [
      ...parseBaliCatalogue({ success: true, data: { x: { ch_name: 'Bali camera', lat: -8.6, lng: 115.2, streaming_url: baliHls, ipcam: 'private' } } }),
      ...parseBadungCatalogue({ marker: [{ title: 'Badung camera', lat: -8.7, lng: 115.1, ipcam: 'private' }] })
    ]
  };
  const freshBadung = parseBadungCatalogue({ marker: [{ title: 'New Badung camera', lat: -8.7, lng: 115.1 }] });
  const snapshot = buildSnapshot(previous, { bali: { ok: false }, badung: { ok: true, cameras: freshBadung } }, '2026-10-17T00:00:00.000Z');
  assert.deepEqual(snapshot.cameras.map(camera => camera.name), ['Bali camera', 'New Badung camera']);
  assert.match(snapshot.sources.find(source => source.id === 'bali').note, /dipertahankan/);
  assert.equal(Object.hasOwn(snapshot.cameras[0], 'ipcam'), false);
  assert.throws(() => buildSnapshot(null, { bali: { ok: false }, badung: { ok: false } }, '2026-10-17T00:00:00.000Z'), /empty/);
});
