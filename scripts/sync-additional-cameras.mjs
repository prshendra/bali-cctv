// Refresh public Bali Province and Badung Regency camera metadata.
import { createHash } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SOURCES, validHlsSource, validStream } from '../dist/catalog.js';
import { validCoordinate } from '../dist/geo.js';

const BALI_API = 'https://balisatudata.baliprov.go.id/api/v1/report-cctv';
const BADUNG_HOME = SOURCES.badung.url;
const BADUNG_MAP_DATA = new URL('/map_data', BADUNG_HOME).href;
const destination = new URL('../dist/additional-cameras.json', import.meta.url);
const temporary = new URL('../dist/additional-cameras.json.tmp', import.meta.url);
const userAgent = 'DenpasarCameraDesk/1.0 (public government CCTV catalog)';

const sourceInfo = {
  bali: { id: 'bali', url: SOURCES.bali.url },
  badung: { id: 'badung', url: SOURCES.badung.url }
};

function coordinate(latitude, longitude) {
  const number = value => typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  const point = { latitude: number(latitude), longitude: number(longitude) };
  return validCoordinate(point) ? point : null;
}

function sha(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function normalizedName(name) {
  return name.normalize('NFKD').toLocaleLowerCase()
    .replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function makeCamera({ sourceId, name, point, publicKey, url, playback, streamUrl }) {
  const camera = {
    id: `${sourceId}-${sha(publicKey)}`,
    name,
    location: name,
    description: '',
    sourceId,
    url,
    playback,
    availability: 'unverified',
    latitude: point.latitude,
    longitude: point.longitude
  };
  if (streamUrl) camera.streamUrl = streamUrl;
  return camera;
}

function parseBaliPublicUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
    if (url.origin === 'https://transcode.baliprov.go.id'
        && url.pathname === '/cctv-player.html'
        && [...url.searchParams.keys()].length === 1
        && url.searchParams.getAll('id').length === 1) {
      const slug = url.searchParams.get('id');
      if (!/^[A-Za-z0-9_-]+$/.test(slug || '')) return null;
      const playerUrl = `https://transcode.baliprov.go.id/cctv-player.html?id=${slug}`;
      const streamUrl = `https://transcode.baliprov.go.id/cctv/${slug}/index.m3u8`;
      return validStream(playerUrl) && validHlsSource(streamUrl)
        ? { url: playerUrl, playback: 'hls', streamUrl }
        : null;
    }
    if (url.origin === 'https://shinobi.bulelengkab.go.id'
        && /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.mp4$/i.test(url.pathname)
        && !url.search) {
      const mp4Url = `https://shinobi.bulelengkab.go.id${url.pathname}`;
      return validStream(mp4Url) ? { url: mp4Url, playback: 'mp4' } : null;
    }
  } catch { /* Ignore malformed or non-public source URLs. */ }
  return null;
}

export function parseBaliCatalogue(payload) {
  if (payload?.success !== true || !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    throw new Error('Invalid Bali CCTV response');
  }
  const rows = Object.values(payload.data);
  if (!rows.length) throw new Error('Bali CCTV response contains no cameras');
  const cameras = [];
  const seen = new Set();
  for (const row of rows) {
    const name = typeof row?.ch_name === 'string' ? row.ch_name.trim() : '';
    const point = coordinate(row?.lat, row?.lng);
    const route = parseBaliPublicUrl(row?.streaming_url);
    if (!name || !point || !route || seen.has(route.url)) continue;
    seen.add(route.url);
    cameras.push(makeCamera({
      sourceId: 'bali', name, point, publicKey: route.url, ...route
    }));
  }
  if (!cameras.length) throw new Error('Bali CCTV response contains no valid public cameras');
  return cameras;
}

export function parseBadungCatalogue(payload) {
  if (!payload || !Array.isArray(payload.marker) || payload.marker.length === 0) {
    throw new Error('Invalid or empty Badung CCTV response');
  }
  const cameras = [];
  const seen = new Set();
  for (const row of payload.marker) {
    const name = typeof row?.title === 'string' ? row.title.trim() : '';
    const point = coordinate(row?.lat, row?.lng);
    const nameKey = name ? normalizedName(name) : '';
    if (!name || !nameKey || !point) continue;
    const publicKey = `${nameKey}|${point.latitude.toFixed(6)}|${point.longitude.toFixed(6)}`;
    if (seen.has(publicKey)) continue;
    seen.add(publicKey);
    cameras.push(makeCamera({
      sourceId: 'badung', name, point, publicKey,
      url: BADUNG_HOME, playback: 'link'
    }));
  }
  if (!cameras.length) throw new Error('Badung CCTV response contains no valid public cameras');
  return cameras;
}

function sanitizePreviousCamera(camera, sourceId) {
  if (!camera || camera.sourceId !== sourceId || typeof camera.name !== 'string' || !camera.name.trim()) return null;
  const name = camera.name.trim();
  const point = coordinate(camera.latitude, camera.longitude);
  if (!point) return null;
  if (sourceId === 'bali') {
    const route = parseBaliPublicUrl(camera.url);
    if (!route || camera.playback !== route.playback || camera.streamUrl !== route.streamUrl) return null;
    const sanitized = makeCamera({ sourceId, name, point, publicKey: route.url, ...route });
    return camera.id === sanitized.id ? sanitized : null;
  }
  if (camera.url !== BADUNG_HOME || camera.playback !== 'link') return null;
  const nameKey = normalizedName(name);
  if (!nameKey) return null;
  const publicKey = `${nameKey}|${point.latitude.toFixed(6)}|${point.longitude.toFixed(6)}`;
  const sanitized = makeCamera({ sourceId, name, point, publicKey, url: BADUNG_HOME, playback: 'link' });
  return camera.id === sanitized.id ? sanitized : null;
}

export function buildSnapshot(previous, results, checkedAt = new Date().toISOString()) {
  if (!Number.isFinite(Date.parse(checkedAt))) throw new Error('Invalid refresh timestamp');
  const cameras = [];
  const sources = [];
  for (const sourceId of ['bali', 'badung']) {
    const old = Array.isArray(previous?.cameras) ? previous.cameras
      .map(camera => sanitizePreviousCamera(camera, sourceId)).filter(Boolean) : [];
    const result = results?.[sourceId];
    const fresh = Array.isArray(result?.cameras)
      ? result.cameras.map(camera => sanitizePreviousCamera(camera, sourceId)).filter(Boolean)
      : [];
    const updated = result?.ok === true && fresh.length > 0;
    const chosen = updated ? fresh : old;
    cameras.push(...chosen);
    sources.push({
      ...sourceInfo[sourceId],
      checkedAt,
      note: updated
        ? sourceId === 'bali'
          ? 'URL pemutar publik terdaftar; ketersediaan playback belum terverifikasi.'
          : 'Katalog lokasi tersedia; siaran publik belum tersedia dari peta Badung.'
        : old.length
          ? 'Pembaruan sumber gagal; entri sebelumnya dipertahankan.'
          : 'Pembaruan sumber gagal; snapshot kamera belum tersedia.'
    });
  }
  if (!cameras.length) throw new Error('Refusing to save an empty additional-camera snapshot');
  return { updatedAt: checkedAt, sources, cameras };
}

function csrfTokenFromHtml(html) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = Object.fromEntries([...match[0].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)]
      .map(attr => [attr[1].toLocaleLowerCase(), attr[3]]));
    if (attrs.name?.toLocaleLowerCase() === 'csrf-token' && attrs.content) return attrs.content;
  }
  return '';
}

function cookieHeader(headers) {
  let values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  if (!values.length) {
    const combined = headers.get('set-cookie') || '';
    values = combined ? combined.split(/,(?=\s*[^;,=\s]+=[^;,]*)/) : [];
  }
  return values.map(value => value.split(';', 1)[0].trim()).filter(Boolean).join('; ');
}

async function fetchBali() {
  const response = await fetch(BALI_API, {
    headers: { accept: 'application/json', 'user-agent': userAgent },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseBaliCatalogue(await response.json());
}

async function fetchBadung() {
  const page = await fetch(BADUNG_HOME, {
    headers: { accept: 'text/html', 'user-agent': userAgent },
    signal: AbortSignal.timeout(30000)
  });
  if (!page.ok) throw new Error(`HTTP ${page.status}`);
  const html = await page.text();
  const token = csrfTokenFromHtml(html);
  const cookie = cookieHeader(page.headers);
  if (!token || !cookie) throw new Error('Badung session metadata unavailable');
  const response = await fetch(BADUNG_MAP_DATA, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'x-csrf-token': token,
      'x-requested-with': 'XMLHttpRequest',
      referer: BADUNG_HOME,
      origin: new URL(BADUNG_HOME).origin,
      cookie,
      'user-agent': userAgent
    },
    body: new URLSearchParams([['filterScope[]', '13']]),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseBadungCatalogue(await response.json());
}

async function readPrevious() {
  try { return JSON.parse(await readFile(destination, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return { cameras: [], sources: [] };
    throw new Error('Existing additional-camera snapshot could not be read; preserving it');
  }
}

async function trySource(id, fetcher) {
  try { return { ok: true, cameras: await fetcher() }; }
  catch (error) {
    console.error(`${id} camera refresh failed (${error.name === 'TimeoutError' ? 'timeout' : 'source error'}).`);
    return { ok: false };
  }
}

async function main() {
  const previous = await readPrevious();
  const checkedAt = new Date().toISOString();
  const [bali, badung] = await Promise.all([
    trySource('Bali', fetchBali),
    trySource('Badung', fetchBadung)
  ]);
  const dataset = buildSnapshot(previous, { bali, badung }, checkedAt);
  await writeFile(temporary, `${JSON.stringify(dataset, null, 2)}\n`);
  await rename(temporary, destination);
  console.log(`Saved ${dataset.cameras.length} additional public camera entries.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    console.error(`Additional camera refresh failed; existing snapshot was preserved. ${error.message}`);
    process.exitCode = 1;
  }
}
