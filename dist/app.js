import { normalizeCatalogue, filterCameras, paginate } from './catalog.js';
import { normalizeStations, nearbyCameras, nearestStation, validCoordinate } from './geo.js';
import { createCameraMap, formatDistance, stationDisplayName } from './camera-map.js';

const $ = id => document.getElementById(id);
const state = { cameras: [], stations: [], fuelReady: false, favorites: new Set(), favoritesOnly: false, page: 1, pageSize: 9, players: new Map(), focus: null, map: null };
try { const stored = JSON.parse(localStorage.getItem('denpasar-favorites') || '[]'); if (Array.isArray(stored)) state.favorites = new Set(stored.filter(x => typeof x === 'string')); } catch {}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(className, text, label, action) {
  const node = element('button', className, text);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.addEventListener('click', action);
  return node;
}
let noticeTimer;
function notify(message) { clearTimeout(noticeTimer); $('notice').textContent = message; noticeTimer = setTimeout(() => { $('notice').textContent = ''; }, 7000); }
function updatePlaying() { $('playing-count').textContent = `${state.players.size} connected`; $('playing-count').parentElement.classList.toggle('is-playing', state.players.size > 0); }
function saveFavorites() {
  try { localStorage.setItem('denpasar-favorites', JSON.stringify([...state.favorites])); }
  catch { notify('Favorites work for this session. Browser storage is unavailable.'); }
}
function placeholder(camera) {
  const holder = element('div', 'placeholder');
  holder.append(element('span', 'camera-symbol', '◉'), element('span', '', 'Ready when you are'), element('small', '', 'Select play to connect to this camera'));
  holder.append(button('start-button', '▶  Play camera', `Play ${camera.name}`, () => playCard(camera)));
  return holder;
}
function updateStatus(card, text, kind = '') {
  const status = card.querySelector('.status');
  status.textContent = text;
  status.className = `status ${kind}`;
}
function destroyPlayer(key) {
  const player = state.players.get(key);
  if (!player) return;
  clearTimeout(player.timeout);
  player.hls?.destroy();
  player.video.pause();
  player.video.removeAttribute('src');
  player.video.load();
  state.players.delete(key);
  updatePlaying();
}
function stopCard(camera) {
  destroyPlayer(camera.id);
  const card = document.getElementById(`camera-${camera.id}`);
  if (!card) return;
  card.querySelector('.media').replaceChildren(placeholder(camera));
  card.querySelector('.play-toggle').textContent = '▶ Play';
  card.querySelector('.play-toggle').setAttribute('aria-label', `Play ${camera.name}`);
  updateStatus(card, 'On demand');
}
function stopGrid() { for (const camera of state.cameras) if (state.players.has(camera.id)) stopCard(camera); }

function startStream(camera, host, key, onStatus, onFailure) {
  destroyPlayer(key);
  const video = element('video');
  video.controls = true;
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute('aria-label', camera.name);
  host.replaceChildren(video);
  const player = { video, hls: null, timeout: null };
  state.players.set(key, player);
  updatePlaying();
  const fail = () => {
    if (state.players.get(key) !== player) return;
    destroyPlayer(key);
    host.replaceChildren();
    const message = element('div', 'stream-error');
    message.append(element('span', 'camera-symbol', '↻'), element('strong', '', 'Feed unavailable'), element('small', '', 'The city feed may be offline. Try reconnecting.'));
    message.append(button('start-button', 'Retry connection', `Retry ${camera.name}`, () => startStream(camera, host, key, onStatus, onFailure)));
    const source = element('a', 'source-link', 'Open official player ↗');
    source.href = camera.url; source.target = '_blank'; source.rel = 'noopener noreferrer'; message.append(source);
    host.append(message);
    onStatus('Unavailable', 'error');
    onFailure?.();
  };
  player.timeout = setTimeout(fail, 25000);
  onStatus('Connecting…', 'connecting');
  video.addEventListener('playing', () => { clearTimeout(player.timeout); onStatus('Live', 'live'); });
  video.addEventListener('waiting', () => {
    onStatus('Buffering…', 'connecting');
    clearTimeout(player.timeout); player.timeout = setTimeout(fail, 25000);
  });
  video.addEventListener('error', fail);
  const attemptPlay = () => video.play().catch(() => onStatus('Press play in video', 'connecting'));
  const source = `${camera.url}index.m3u8`;
  if (window.Hls?.isSupported()) {
    player.hls = new window.Hls({ maxBufferLength: 10, maxMaxBufferLength: 20, backBufferLength: 0, capLevelToPlayerSize: true });
    player.hls.on(window.Hls.Events.ERROR, (_event, data) => { if (data.fatal) fail(); });
    player.hls.on(window.Hls.Events.MANIFEST_PARSED, attemptPlay);
    player.hls.loadSource(source);
    player.hls.attachMedia(video);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = source;
    attemptPlay();
  } else {
    fail();
    notify('This browser cannot play HLS video. Use the official player link or a current Chrome, Firefox, Edge, or Safari browser.');
  }
}
function playCard(camera) {
  const card = document.getElementById(`camera-${camera.id}`);
  if (!card) return;
  card.querySelector('.play-toggle').textContent = '■ Stop';
  card.querySelector('.play-toggle').setAttribute('aria-label', `Stop ${camera.name}`);
  startStream(camera, card.querySelector('.media'), camera.id, (text, kind) => {
    updateStatus(card, text, kind);
    const active = state.players.has(camera.id);
    card.querySelector('.play-toggle').textContent = active ? '■ Stop' : '▶ Play';
    card.querySelector('.play-toggle').setAttribute('aria-label', `${active ? 'Stop' : 'Play'} ${camera.name}`);
  });
}
function openFocus(camera) {
  state.focus = camera;
  stopCard(camera);
  $('focus-title').textContent = camera.name;
  $('focus-source').href = camera.url;
  $('focus-dialog').showModal();
  startStream(camera, $('focus-media'), 'focus', (text) => { $('focus-title').textContent = `${camera.name} · ${text}`; });
}
function card(camera) {
  const node = element('article', 'camera-card');
  node.id = `camera-${camera.id}`;
  const media = element('div', 'media'); media.append(placeholder(camera));
  const meta = element('div', 'camera-meta');
  const head = element('div', 'card-heading');
  head.append(element('span', 'location-label', camera.location));
  const favorite = button('favorite', state.favorites.has(camera.id) ? '★' : '☆', `Favorite ${camera.name}`, () => {
    if (state.favorites.has(camera.id)) state.favorites.delete(camera.id); else state.favorites.add(camera.id);
    favorite.textContent = state.favorites.has(camera.id) ? '★' : '☆';
    favorite.setAttribute('aria-pressed', String(state.favorites.has(camera.id)));
    $('favorite-count').textContent = String(state.favorites.size);
    saveFavorites();
    if (state.favoritesOnly) render();
  });
  favorite.setAttribute('aria-pressed', String(state.favorites.has(camera.id)));
  head.append(favorite);
  const title = element('h2', '', camera.name.replace(/^SIMPANG /, ''));
  meta.append(head, title, element('p', 'description', camera.description));
  const nearest = nearestStation(camera, selectedStations());
  if (nearest) meta.append(element('span', 'fuel-distance', `${formatDistance(nearest.distanceMeters)} · ${stationDisplayName(nearest.station)}`));
  const controls = element('div', 'card-controls');
  controls.append(element('span', 'status', 'On demand'));
  const actions = element('div', 'card-actions');
  actions.append(button('play-toggle', '▶ Play', `Play ${camera.name}`, () => state.players.has(camera.id) ? stopCard(camera) : playCard(camera)));
  actions.append(button('expand', '⛶', `Expand ${camera.name}`, () => openFocus(camera)));
  if (validCoordinate(camera)) {
    actions.append(button('map-link map-location-button', '⌖', `Tampilkan ${camera.name} di peta`, () => {
      if (!state.map) { notify('Peta tidak tersedia. Coba muat ulang halaman.'); return; }
      setMapVisible(true);
      $('map-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
      state.map.showCamera(camera);
    }));
  }
  controls.append(actions); meta.append(controls); node.append(media, meta);
  return node;
}
function selectedStations() {
  return $('fuel-filter').value ? state.stations.filter(station => station.id === $('fuel-filter').value) : state.stations;
}
function filteredCameras() {
  let cameras = filterCameras(state.cameras, { query: $('search').value, location: $('location-filter').value, favoritesOnly: state.favoritesOnly, favorites: state.favorites });
  if ($('near-fuel').checked) cameras = nearbyCameras(cameras, state.stations, { stationId: $('fuel-filter').value, radiusMeters: Number($('fuel-radius').value) }).map(result => result.camera);
  return cameras;
}
function currentPage() {
  const cameras = filteredCameras();
  return { ...paginate(cameras, state.page, state.pageSize), total: cameras.length };
}
function render({ fitMap = false } = {}) {
  stopGrid();
  const page = currentPage(); state.page = page.page;
  $('grid').dataset.layout = String(state.pageSize);
  $('grid').replaceChildren(...page.items.map(card));
  $('empty-state').hidden = page.total > 0;
  $('empty-state').textContent = state.favoritesOnly && !state.favorites.size ? 'Your favorites will appear here. Star a camera to save it.' : $('near-fuel').checked ? 'Tidak ada CCTV dalam radius dan filter ini. Perbesar radius, pilih SPBU lain, atau hapus pencarian.' : 'No cameras match. Try another street or clear the filters.';
  $('result-summary').textContent = `${page.total} camera${page.total === 1 ? '' : 's'}${state.favoritesOnly ? ' in favorites' : ' in the catalogue'}${$('near-fuel').checked ? ' · terdekat dari SPBU lebih dulu' : ''}`;
  $('page-label').textContent = `Page ${page.page} of ${page.pages}`;
  $('previous').disabled = page.page <= 1; $('next').disabled = page.page >= page.pages;
  $('play-page').disabled = !page.items.length;
  $('all-tab').setAttribute('aria-pressed', String(!state.favoritesOnly));
  $('favorites-tab').setAttribute('aria-pressed', String(state.favoritesOnly));
  $('all-tab').classList.toggle('is-active', !state.favoritesOnly);
  $('favorites-tab').classList.toggle('is-active', state.favoritesOnly);
  $('favorite-count').textContent = String(state.favorites.size);
  $('grid').setAttribute('aria-busy', 'false');
  if (state.fuelReady) {
    const station = state.stations.find(item => item.id === $('fuel-filter').value);
    $('fuel-summary').textContent = $('near-fuel').checked
      ? `${page.total} CCTV dalam radius ${formatDistance(Number($('fuel-radius').value))} dari ${station ? stationDisplayName(station) : 'salah satu SPBU'}. Pencarian, lokasi, dan favorit tetap berlaku.`
      : `${state.stations.length} titik SPBU tersedia. Aktifkan “CCTV dekat SPBU” atau pilih titik SPBU di peta untuk menyaring kamera.`;
  }
  state.map?.update(filteredCameras(), state.stations, { selectedStationId: $('fuel-filter').value, nearbyOnly: $('near-fuel').checked, radiusMeters: Number($('fuel-radius').value) });
  if (fitMap && !$('map-content').hidden) state.map?.fit();
}
const resetAndRender = () => { state.page = 1; render({ fitMap: true }); };
$('search').addEventListener('input', resetAndRender);
$('location-filter').addEventListener('change', resetAndRender);
$('layout').addEventListener('change', () => { state.pageSize = Number($('layout').value); resetAndRender(); });
$('all-tab').addEventListener('click', () => { state.favoritesOnly = false; resetAndRender(); });
$('favorites-tab').addEventListener('click', () => { state.favoritesOnly = true; resetAndRender(); });
$('previous').addEventListener('click', () => { state.page--; render(); });
$('next').addEventListener('click', () => { state.page++; render(); });
$('play-page').addEventListener('click', () => {
  for (const camera of currentPage().items) if (!state.players.has(camera.id)) playCard(camera);
  notify('Connecting this page. More simultaneous streams use more bandwidth.');
});
$('stop-all').addEventListener('click', () => { stopGrid(); if ($('focus-dialog').open) $('focus-dialog').close(); notify('All streams stopped.'); });
$('focus-close').addEventListener('click', () => $('focus-dialog').close());
$('focus-dialog').addEventListener('close', () => { destroyPlayer('focus'); $('focus-media').replaceChildren(); state.focus = null; });
$('near-fuel').addEventListener('change', resetAndRender);
$('fuel-filter').addEventListener('change', () => { $('near-fuel').checked = true; resetAndRender(); });
$('fuel-radius').addEventListener('change', () => { $('near-fuel').checked = true; resetAndRender(); });
$('fuel-reset').addEventListener('click', () => { $('near-fuel').checked = false; $('fuel-filter').value = ''; $('fuel-radius').value = '500'; resetAndRender(); });
function setMapVisible(visible) {
  $('map-content').hidden = !visible;
  $('map-toggle').textContent = visible ? 'Sembunyikan peta' : 'Tampilkan peta';
  $('map-toggle').setAttribute('aria-expanded', String(visible));
  if (visible) state.map?.invalidate();
}
$('map-toggle').addEventListener('click', () => setMapVisible($('map-content').hidden));
$('map-fit').addEventListener('click', () => state.map?.fit());
window.addEventListener('pagehide', () => { for (const key of [...state.players.keys()]) destroyPlayer(key); });
document.addEventListener('keydown', event => {
  if (event.key === '/' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName) && !$('focus-dialog').open) { event.preventDefault(); $('search').focus(); }
});
function clock() { $('clock').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()) + ' WITA'; }
clock(); setInterval(clock, 1000);
async function init() {
  try {
    const fuelRequest = fetch('./fuel-stations.json', { cache: 'no-cache', signal: AbortSignal.timeout(10000) })
      .then(response => { if (!response.ok) throw new Error('SPBU unavailable'); return response.json(); })
      .then(normalizeStations).catch(() => null);
    const response = await fetch('./cameras.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Camera catalogue request failed');
    const data = normalizeCatalogue(await response.json());
    state.cameras = data.cameras;
    $('total-count').textContent = String(state.cameras.length);
    $('sidebar-camera-count').textContent = String(state.cameras.length);
    const locations = [...new Set(state.cameras.map(camera => camera.location))].sort();
    $('location-count').textContent = String(locations.length);
    for (const location of locations) { const option = element('option', '', location); option.value = location; $('location-filter').append(option); }
    $('catalog-date').textContent = data.updatedAt;
    try {
      state.map = createCameraMap({
        onPlayCamera: openFocus,
        onSelectStation: id => { $('fuel-filter').value = id; $('near-fuel').checked = true; resetAndRender(); },
        onMapWarning: message => { $('map-status').textContent = message; }
      });
    } catch {
      $('camera-map').classList.add('map-unavailable');
      $('camera-map').textContent = 'Peta tidak dapat dimuat. Daftar kamera dan filter SPBU tetap tersedia.';
      $('map-fit').disabled = true;
    }
    render({ fitMap: true });
    const fuel = await fuelRequest;
    if (fuel?.stations.length) {
      state.stations = fuel.stations;
      state.fuelReady = true;
      const stationOptions = [...fuel.stations].map(station => {
        const camera = nearestStation(station, state.cameras);
        const area = station.address || (camera ? `dekat ${camera.station.location}` : `${station.latitude.toFixed(4)}, ${station.longitude.toFixed(4)}`);
        return { station, label: `${stationDisplayName(station)} — ${area}` };
      }).sort((a, b) => a.label.localeCompare(b.label));
      for (const { station, label } of stationOptions) {
        const duplicateLabel = stationOptions.filter(option => option.label === label).length > 1;
        const option = element('option', '', `${label}${duplicateLabel ? ` (${station.latitude.toFixed(4)}, ${station.longitude.toFixed(4)})` : ''}`);
        option.value = station.id; $('fuel-filter').append(option);
      }
      for (const id of ['near-fuel', 'fuel-filter', 'fuel-radius', 'fuel-reset']) $(id).disabled = false;
      const attribution = element('a', '', '© OpenStreetMap contributors');
      attribution.href = 'https://www.openstreetmap.org/copyright'; attribution.target = '_blank'; attribution.rel = 'noopener noreferrer';
      $('fuel-attribution').replaceChildren(attribution, document.createTextNode(` · Data SPBU: ${fuel.updatedAt.slice(0, 10)}`));
      render();
    } else {
      $('fuel-summary').textContent = 'Data SPBU tidak tersedia. Peta CCTV tetap bisa digunakan; muat ulang untuk mencoba lagi.';
    }
  } catch {
    $('empty-state').hidden = false;
    $('empty-state').textContent = 'Unable to load the camera catalogue. Refresh this page to try again.';
    $('play-page').disabled = true;
    $('grid').setAttribute('aria-busy', 'false');
    notify('Camera catalogue could not be loaded.');
  }
}
init();
