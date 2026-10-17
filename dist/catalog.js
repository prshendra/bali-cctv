import { distanceMeters } from './geo.js';

export const SOURCES = {
  denpasar: { label: 'ATCS Denpasar', url: 'https://atcs.denpasarkota.go.id/streaming' },
  bali: { label: 'Bali Satu Data · Pemprov Bali', url: 'https://balisatudata.baliprov.go.id/peta-cctv' },
  badung: { label: 'Pemkab Badung · Smart City', url: 'https://map.badungkab.go.id/' }
};

export function validStream(value) {
  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.hash) return false;
    if (url.origin === 'https://atcs.denpasarkota.go.id') return /^\/stream\/+[a-zA-Z0-9_-]+\/$/.test(url.pathname) && !url.search;
    if (url.origin === 'https://transcode.baliprov.go.id') return /^\/[a-zA-Z0-9_-]+\.html$/.test(url.pathname);
    if (url.origin === 'https://shinobi.bulelengkab.go.id') return /^\/[a-zA-Z0-9_./-]+\.mp4$/.test(url.pathname);
    return false;
  } catch { return false; }
}

export function validHlsSource(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://transcode.baliprov.go.id' && /^\/cctv\/[a-zA-Z0-9_-]+\/index\.m3u8$/.test(url.pathname) && !url.search && !url.hash && !url.username && !url.password;
  } catch { return false; }
}

export function normalizeCatalogue(data) {
  if (!Array.isArray(data.cameras)) throw new Error('Invalid camera catalogue');
  const seen = new Set();
  const cameras = data.cameras.filter(camera => {
    if (!camera || typeof camera.id !== 'string' || seen.has(camera.id) ||
      typeof camera.name !== 'string' || typeof camera.location !== 'string' ||
      typeof camera.description !== 'string' || (camera.sourceId && !SOURCES[camera.sourceId]) ||
      (camera.playback && !['hls', 'mp4', 'iframe', 'link'].includes(camera.playback)) ||
      (camera.streamUrl && !validHlsSource(camera.streamUrl)) ||
      (camera.sourceId && camera.sourceId !== 'denpasar' && camera.playback === 'hls' && !camera.streamUrl) ||
      !(validStream(camera.url) || (camera.playback === 'link' && camera.url === SOURCES[camera.sourceId]?.url))) return false;
    seen.add(camera.id);
    return true;
  }).map(camera => {
    const sourceId = camera.sourceId || 'denpasar';
    const source = SOURCES[sourceId] || SOURCES.denpasar;
    const inferredPlayback = sourceId === 'denpasar' ? 'hls' : camera.url.includes('.mp4') ? 'mp4' : 'iframe';
    return { ...camera, url: camera.url.trim(), sourceId, sourceLabel: source.label, officialUrl: source.url, playback: camera.playback || inferredPlayback };
  });
  if (!cameras.length) throw new Error('The catalogue contains no public camera feeds');
  return { cameras, updatedAt: data.updatedAt || 'Unknown' };
}

export function mergeCameras(...catalogues) {
  const seen = new Map(); const result = [];
  const placeName = name => name.toLocaleLowerCase().replace(/^(?:[a-z]{2,5}\s*\d+\s*-\s*|site[_\s]+)/, '').replace(/\s*\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  for (const cameras of catalogues) for (const camera of cameras) {
    const key = camera.playback === 'link' ? `${camera.sourceId}:${camera.id}` : camera.url;
    const matchingLocation = result.find(previous => previous.sourceId !== camera.sourceId &&
      (previous.playback === 'link') !== (camera.playback === 'link') &&
      placeName(previous.name) === placeName(camera.name) && distanceMeters(previous, camera) <= 10);
    const previous = seen.get(key) || matchingLocation;
    if (previous) {
      const listed = [...new Set([previous.sourceId, ...(previous.alsoListedBy || []), camera.sourceId, ...(camera.alsoListedBy || [])])];
      const aliases = [...new Set([previous.name, ...(previous.aliases || []), camera.name, ...(camera.aliases || [])])];
      if (previous.playback === 'link' && camera.playback !== 'link') Object.assign(previous, camera);
      previous.alsoListedBy = listed.filter(id => id !== previous.sourceId);
      previous.aliases = aliases.filter(name => name !== previous.name);
      seen.set(key, previous);
    } else { const copy = { ...camera }; seen.set(key, copy); result.push(copy); }
  }
  return result;
}

export function filterCameras(cameras, { query = '', location = '', sourceId = '', favoritesOnly = false, favorites = new Set() } = {}) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return cameras.filter(camera => (!location || camera.location === location) && (!sourceId || camera.sourceId === sourceId || camera.alsoListedBy?.includes(sourceId)) &&
    (!favoritesOnly || favorites.has(camera.id)) &&
    terms.every(term => `${camera.name} ${camera.location} ${camera.description} ${camera.sourceLabel || ''} ${(camera.aliases || []).join(' ')}`.toLocaleLowerCase().includes(term)));
}

export function paginate(cameras, page, pageSize) {
  const pages = Math.max(1, Math.ceil(cameras.length / pageSize));
  const current = Math.max(1, Math.min(page, pages));
  return { page: current, pages, items: cameras.slice((current - 1) * pageSize, current * pageSize) };
}
