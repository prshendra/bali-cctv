// Read only the official public web catalogue. Persist only public playback metadata.
import { writeFile, rename } from 'node:fs/promises';
import { normalizeCatalogue } from '../dist/catalog.js';

const origin = 'https://atcs.denpasarkota.go.id';
async function get(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Official website returned HTTP ${response.status}`);
  return response;
}
try {
  const html = await (await get(`${origin}/streaming`)).text();
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]);
  const page = scripts.find(path => path.startsWith('/_next/static/chunks/app/streaming/page-'));
  if (!page) throw new Error('Official page format changed; the existing catalogue was preserved');
  const javascript = await (await get(new URL(page, origin))).text();
  const headers = {};
  // These are the public web client's headers, held transiently and never saved or logged.
  for (const key of ['x-client-id', 'x-client-secret']) {
    const value = javascript.match(new RegExp(`"${key}":"([^"]+)"`))?.[1];
    if (!value) throw new Error('Official web client changed; the existing catalogue was preserved');
    headers[key] = value;
  }
  const payload = await (await get(`${origin}/api/v3/pv/ldevice`, headers)).json();
  if (payload.success !== true || !Array.isArray(payload.data)) throw new Error('Invalid official catalogue response');
  const cameras = payload.data.flatMap(location => (location.tb_device_lokasi || []).map(camera => ({
    id: camera.name_proxy_cam,
    name: camera.nama_alias || camera.nama,
    location: location.nama_lokasi,
    description: location.ket_lokasi || '',
    url: (camera.url_proxy_hls || '').trim(),
    latitude: Number(location.lat_lokasi),
    longitude: Number(location.lon_lokasi)
  })));
  const catalogue = normalizeCatalogue({ cameras, updatedAt: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) });
  const destination = new URL('../dist/cameras.json', import.meta.url);
  const temporary = new URL('../dist/cameras.json.tmp', import.meta.url);
  await writeFile(temporary, JSON.stringify({ source: `${origin}/streaming`, ...catalogue }, null, 2) + '\n');
  await rename(temporary, destination);
  console.log(`Saved ${catalogue.cameras.length} public cameras across ${new Set(catalogue.cameras.map(c => c.location)).size} locations.`);
} catch (error) {
  // Do not print upstream response bodies, which can contain private device fields.
  console.error(`Catalogue refresh failed: ${error.message}`);
  process.exitCode = 1;
}
