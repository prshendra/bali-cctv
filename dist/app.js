import { normalizeCatalogue, filterCameras, paginate, mergeCameras, SOURCES } from './catalog.js';
import { normalizeStations, nearbyCameras, nearestStation, validCoordinate } from './geo.js';
import { createCameraMap, formatDistance, stationDisplayName } from './camera-map.js';
import { normalizeRoads, distanceToRoadMeters, nearRoad, isSunsetSearch } from './roads.js';
import { playbackLimit, playerKeysToStop } from './playback-policy.js';

const $ = id => document.getElementById(id);
const compactViewport = window.matchMedia('(max-width: 640px)');
const coarsePointer = window.matchMedia('(pointer: coarse)');
function isCompactPlayback() { return compactViewport.matches || coarsePointer.matches; }
const state = { cameras: [], stations: [], roads: [], fuelReady: false, fuelOptionsKey: null, favorites: new Set(), favoritesOnly: false, page: 1, pageSize: isCompactPlayback() ? 4 : 9, players: new Map(), focus: null, map: null, mapInputs: null };
try { const stored = JSON.parse(localStorage.getItem('denpasar-favorites') || '[]'); if (Array.isArray(stored)) state.favorites = new Set(stored.filter(x => typeof x === 'string')); } catch {}
$('layout').value = String(state.pageSize);
if (isCompactPlayback()) $('play-page').textContent = '▶ Putar kamera';

const playingObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  if (!isCompactPlayback()) return;
  for (const entry of entries) {
    if (entry.isIntersecting) continue;
    const camera = state.cameras.find(item => `camera-${item.id}` === entry.target.id);
    if (camera && state.players.has(camera.id)) stopCard(camera);
  }
}, { rootMargin: '80px 0px', threshold: 0.01 }) : null;
function observePlayingCard(key) {
  if (!isCompactPlayback() || !playingObserver) return;
  const card = document.getElementById(`camera-${key}`);
  if (card) playingObserver.observe(card);
}
function unobservePlayingCard(key) {
  if (!playingObserver) return;
  const card = document.getElementById(`camera-${key}`);
  if (card) playingObserver.unobserve(card);
}

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
function updatePlaying() { $('playing-count').parentElement.hidden = state.players.size === 0; $('playing-count').textContent = `${state.players.size} terhubung`; $('playing-count').parentElement.classList.toggle('is-playing', state.players.size > 0); }
function saveFavorites() {
  try { localStorage.setItem('denpasar-favorites', JSON.stringify([...state.favorites])); }
  catch { notify('Favorites work for this session. Browser storage is unavailable.'); }
}
function placeholder(camera) {
  const holder = element('div', 'placeholder');
  const linkOnly = camera.playback === 'link';
  holder.append(element('span', 'camera-symbol', '◉'), element('span', '', linkOnly ? 'Lokasi kamera terdaftar' : 'Siaran CCTV'), element('small', '', linkOnly ? 'Siaran publik belum tersedia dari sumber ini' : camera.playback === 'iframe' ? 'Menggunakan pemutar situs resmi' : 'Putar untuk membuka siaran'));
  holder.append(button('start-button', linkOnly ? 'Lihat informasi' : '▶ Putar', `${linkOnly ? 'Detail' : 'Play'} ${camera.name}`, () => playCard(camera)));
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
  state.players.delete(key);
  clearTimeout(player.timeout);
  unobservePlayingCard(key);
  player.hls?.destroy();
  player.video?.pause();
  player.video?.removeAttribute('src');
  player.video?.load();
  player.iframe?.remove();
  updatePlaying();
}
function stopCard(camera) {
  destroyPlayer(camera.id);
  const card = document.getElementById(`camera-${camera.id}`);
  if (!card?.isConnected) return;
  card.querySelector('.media').replaceChildren(placeholder(camera));
  card.querySelector('.play-toggle').textContent = camera.playback === 'link' ? 'Info' : '▶ Play';
  card.querySelector('.play-toggle').setAttribute('aria-label', `${camera.playback === 'link' ? 'Detail' : 'Play'} ${camera.name}`);
  updateStatus(card, camera.playback === 'link' ? 'Lokasi terdaftar' : 'Siap diputar');
}
function stopGrid() { for (const camera of state.cameras) if (state.players.has(camera.id)) stopCard(camera); }

function enforcePlayerLimit(targetKey) {
  const limit = playbackLimit(isCompactPlayback());
  for (const key of playerKeysToStop([...state.players.keys()], targetKey, limit)) {
    const camera = state.cameras.find(item => item.id === key);
    if (camera) stopCard(camera);
    else {
      destroyPlayer(key);
      if (key === 'focus') $('focus-media').replaceChildren();
    }
  }
}

let hlsScriptPromise;
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsScriptPromise) hlsScriptPromise = new Promise(resolve => {
    const script = document.createElement('script');
    script.src = './assets/hls.min.js';
    script.async = true;
    script.addEventListener('load', () => {
      const Hls = window.Hls || null;
      if (!Hls) hlsScriptPromise = null;
      resolve(Hls);
    }, { once: true });
    script.addEventListener('error', () => { hlsScriptPromise = null; script.remove(); resolve(null); }, { once: true });
    document.head.append(script);
  });
  return hlsScriptPromise;
}

function startStream(camera, host, key, onStatus, onFailure) {
  enforcePlayerLimit(key);
  destroyPlayer(key);
  if (camera.playback === 'link') {
    const info = element('div', 'stream-error');
    info.append(element('strong', '', 'Lokasi dari katalog resmi'), element('small', '', 'Sumber belum menyediakan siaran publik yang dapat diputar di viewer ini.'));
    const link = element('a', 'source-link', 'Buka peta resmi ↗'); link.href = camera.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; info.append(link);
    host.replaceChildren(info); onStatus('Lokasi terdaftar'); return;
  }
  // The province server currently sends duplicate CORS headers on HLS assets.
  // Its public player runs on that origin and is explicitly frameable.
  if (camera.playback === 'iframe' || (camera.sourceId === 'bali' && camera.playback === 'hls')) {
    const iframe = element('iframe'); iframe.title = `Pemutar resmi: ${camera.name}`; iframe.src = camera.url;
    iframe.allow = 'autoplay; fullscreen; picture-in-picture'; iframe.allowFullscreen = true;
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    const note = element('span', 'embedded-note', 'Pemutar resmi · status siaran belum terverifikasi');
    host.replaceChildren(iframe, note);
    const player = { iframe, timeout: null }; state.players.set(key, player); updatePlaying();
    observePlayingCard(key);
    onStatus('Memuat pemutar…', 'connecting');
    iframe.addEventListener('load', () => { if (state.players.get(key) === player) onStatus('Pemutar resmi'); });
    return;
  }
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
  player.timeout = setTimeout(() => { if (state.players.get(key) === player) fail(); }, 25000);
  onStatus('Connecting…', 'connecting');
  video.addEventListener('playing', () => {
    if (state.players.get(key) !== player) return;
    clearTimeout(player.timeout); onStatus(camera.playback === 'mp4' ? 'Memutar' : 'Live', 'live');
  });
  video.addEventListener('waiting', () => {
    if (state.players.get(key) !== player) return;
    onStatus('Buffering…', 'connecting');
    clearTimeout(player.timeout); player.timeout = setTimeout(() => { if (state.players.get(key) === player) fail(); }, 25000);
  });
  video.addEventListener('error', fail);
  const attemptPlay = () => {
    if (state.players.get(key) !== player) return;
    video.play().catch(() => { if (state.players.get(key) === player) onStatus('Press play in video', 'connecting'); });
  };
  const source = camera.playback === 'mp4' ? camera.url : camera.streamUrl || `${camera.url}index.m3u8`;
  if (camera.playback === 'mp4') {
    video.src = source; attemptPlay();
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = source;
    attemptPlay();
  } else {
    void loadHls().then(Hls => {
      if (state.players.get(key) !== player) return;
      if (!Hls?.isSupported()) {
        fail();
        notify('This browser cannot play HLS video. Use the official player link or a current Chrome, Firefox, Edge, or Safari browser.');
        return;
      }
      player.hls = new Hls({ maxBufferLength: 10, maxMaxBufferLength: 20, backBufferLength: 0, capLevelToPlayerSize: true });
      player.hls.on(Hls.Events.ERROR, (_event, data) => { if (state.players.get(key) === player && data.fatal) fail(); });
      player.hls.on(Hls.Events.MANIFEST_PARSED, attemptPlay);
      player.hls.loadSource(source);
      player.hls.attachMedia(video);
    });
  }
  observePlayingCard(key);
}
function playCard(camera, { scroll = false } = {}) {
  if (camera.playback === 'link') { openFocus(camera); return; }
  const card = document.getElementById(`camera-${camera.id}`);
  if (!card) return;
  if (scroll && isCompactPlayback()) card.scrollIntoView({ behavior: 'auto', block: 'center' });
  card.querySelector('.play-toggle').textContent = '■ Stop';
  card.querySelector('.play-toggle').setAttribute('aria-label', `Stop ${camera.name}`);
  startStream(camera, card.querySelector('.media'), camera.id, (text, kind) => {
    if (!card.isConnected) return;
    updateStatus(card, text, kind);
    const active = state.players.has(camera.id);
    card.querySelector('.play-toggle').textContent = active ? '■ Stop' : '▶ Play';
    card.querySelector('.play-toggle').setAttribute('aria-label', `${active ? 'Stop' : 'Play'} ${camera.name}`);
  });
}
function openFocus(camera) {
  stopGrid();
  destroyPlayer('focus');
  state.focus = camera;
  $('focus-title').textContent = camera.name;
  $('focus-source').href = camera.url;
  if (!$('focus-dialog').open) $('focus-dialog').showModal();
  startStream(camera, $('focus-media'), 'focus', (text) => { $('focus-title').textContent = `${camera.name} · ${text}`; });
}
function card(camera) {
  const node = element('article', 'camera-card');
  node.id = `camera-${camera.id}`;
  const media = element('div', 'media'); media.append(placeholder(camera));
  const meta = element('div', 'camera-meta');
  const head = element('div', 'card-heading');
  head.append(element('h2', '', camera.name.replace(/^SIMPANG /, '')));
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
  meta.append(head, element('p', 'description', camera.description));
  meta.append(element('span', 'provider-label', [camera.sourceLabel || 'ATCS Denpasar', ...(camera.alsoListedBy || []).map(id => SOURCES[id].label)].join(' / ')));
  const road = activeRoad();
  if (road) meta.append(element('span', 'road-distance', `${formatDistance(distanceToRoadMeters(camera, road))} dari koridor ${road.name}`));
  const nearest = nearestStation(camera, selectedStations());
  if (nearest) meta.append(element('span', 'fuel-distance', `${formatDistance(nearest.distanceMeters)} · ${stationDisplayName(nearest.station)}`));
  const controls = element('div', 'card-controls');
  controls.append(element('span', 'status', camera.playback === 'link' ? 'Lokasi terdaftar' : 'Siap diputar'));
  const actions = element('div', 'card-actions');
  actions.append(button('play-toggle', camera.playback === 'link' ? 'Info' : '▶ Play', `${camera.playback === 'link' ? 'Detail' : 'Play'} ${camera.name}`, () => state.players.has(camera.id) ? stopCard(camera) : playCard(camera)));
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
  return $('fuel-filter').value ? scopedStations().filter(station => station.id === $('fuel-filter').value) : scopedStations();
}
function activeRoad() {
  return ($('area-filter').value || isSunsetSearch($('search').value)) ? state.roads.find(road => road.id === 'sunset-road') : null;
}
function scopedStations() {
  const road = activeRoad();
  return road ? nearRoad(state.stations, road, Number($('area-radius').value)) : state.stations;
}
function refreshFuelOptions() {
  const road = activeRoad();
  const key = `${state.stations.length}:${road?.id || ''}:${$('area-radius').value}`;
  if (key === state.fuelOptionsKey) return;
  state.fuelOptionsKey = key;
  const selectedId = $('fuel-filter').value;
  $('fuel-filter').replaceChildren(element('option', '', road ? 'Semua SPBU sekitar Sunset Road' : 'Semua SPBU'));
  $('fuel-filter').firstElementChild.value = '';
  const options = scopedStations().map(station => {
    const camera = nearestStation(station, state.cameras);
    const area = station.address || (camera ? `dekat ${camera.station.location}` : `${station.latitude.toFixed(4)}, ${station.longitude.toFixed(4)}`);
    return { station, label: `${stationDisplayName(station)} — ${area}` };
  }).sort((a, b) => a.label.localeCompare(b.label));
  for (const { station, label } of options) {
    const duplicate = options.filter(option => option.label === label).length > 1;
    const option = element('option', '', `${label}${duplicate ? ` (${station.latitude.toFixed(4)}, ${station.longitude.toFixed(4)})` : ''}`);
    option.value = station.id; $('fuel-filter').append(option);
  }
  if (options.some(option => option.station.id === selectedId)) $('fuel-filter').value = selectedId;
}
function filteredCameras() {
  const road = activeRoad();
  let cameras = filterCameras(state.cameras, { query: road && isSunsetSearch($('search').value) ? '' : $('search').value, location: $('location-filter').value, sourceId: $('source-filter').value, favoritesOnly: state.favoritesOnly, favorites: state.favorites });
  if (road) cameras = nearRoad(cameras, road, Number($('area-radius').value));
  if ($('near-fuel').checked) cameras = nearbyCameras(cameras, scopedStations(), { stationId: $('fuel-filter').value, radiusMeters: Number($('fuel-radius').value) }).map(result => result.camera);
  return cameras;
}
function currentPage() {
  const cameras = filteredCameras();
  return { ...paginate(cameras, state.page, state.pageSize), total: cameras.length };
}
function sameItems(left, right) {
  return left?.length === right.length && left.every((item, index) => item === right[index]);
}
function render({ fitMap = false } = {}) {
  stopGrid();
  refreshFuelOptions();
  const cameras = filteredCameras();
  const stations = scopedStations();
  const page = { ...paginate(cameras, state.page, state.pageSize), total: cameras.length };
  state.page = page.page;
  $('grid').dataset.layout = String(state.pageSize);
  $('grid').replaceChildren(...page.items.map(card));
  $('empty-state').hidden = page.total > 0;
  $('empty-state').textContent = state.favoritesOnly && !state.favorites.size ? 'Belum ada favorit. Tekan ☆ pada kamera untuk menyimpannya.' : $('near-fuel').checked ? 'Tidak ada CCTV dalam radius dan filter ini. Perbesar radius, pilih SPBU lain, atau hapus pencarian.' : 'Tidak ada kamera yang cocok. Coba pencarian lain atau reset filter.';
  const publicPlayers = cameras.filter(camera => camera.playback !== 'link').length;
  $('result-summary').textContent = `${page.total} kamera${state.favoritesOnly ? ' favorit' : ''} · ${publicPlayers} pemutar`;
  $('page-label').textContent = `Halaman ${page.page} / ${page.pages}`;
  $('previous').disabled = page.page <= 1; $('next').disabled = page.page >= page.pages;
  $('play-page').disabled = !page.items.some(camera => camera.playback !== 'link');
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
      : `${scopedStations().length} SPBU tersedia. Pilih SPBU di peta atau aktifkan filter di atas.`;
  }
  const road = activeRoad();
  $('area-summary').textContent = road ? `Sekitar ${road.name}: ${page.total} CCTV dan ${scopedStations().length} SPBU dalam ${formatDistance(Number($('area-radius').value))} dari koridor jalan. Filter sumber, nama, dan favorit tetap berlaku.` : 'Pilih kawasan atau ketik “Sunset Road” untuk mencari CCTV dan SPBU di sekitar jalan.';
  updateFilterSummary();
  const mapOptions = { selectedStationId: $('fuel-filter').value, nearbyOnly: $('near-fuel').checked, radiusMeters: Number($('fuel-radius').value), road };
  const previous = state.mapInputs;
  const changed = !previous || !sameItems(previous.cameras, cameras) || !sameItems(previous.stations, stations) ||
    previous.selectedStationId !== mapOptions.selectedStationId || previous.nearbyOnly !== mapOptions.nearbyOnly ||
    previous.radiusMeters !== mapOptions.radiusMeters || previous.road !== mapOptions.road;
  if (state.map && changed) {
    state.map.update(cameras, stations, mapOptions);
    state.mapInputs = { cameras: [...cameras], stations: [...stations], ...mapOptions };
  }
  if (fitMap && !$('map-content').hidden) state.map?.fit();
}
function updateFilterSummary() {
  const filters = [];
  if ($('source-filter').value) filters.push($('source-filter').selectedOptions[0].textContent);
  if ($('location-filter').value) filters.push($('location-filter').value);
  const road = activeRoad();
  if (road) filters.push(`${road.name} · ${formatDistance(Number($('area-radius').value))}`);
  if ($('near-fuel').checked) {
    const station = state.stations.find(item => item.id === $('fuel-filter').value);
    filters.push(`${station ? stationDisplayName(station) : 'Dekat SPBU'} · ${formatDistance(Number($('fuel-radius').value))}`);
  }
  $('filter-count').textContent = String(filters.length);
  $('filter-count').hidden = !filters.length;
  $('filter-summary').textContent = filters.join(' / ');
  $('filter-summary').hidden = !filters.length;
}
function setFiltersVisible(visible) {
  $('filter-panel').hidden = !visible;
  $('filters-toggle').setAttribute('aria-expanded', String(visible));
}
$('filters-toggle').addEventListener('click', () => setFiltersVisible($('filter-panel').hidden));
$('filters-close').addEventListener('click', () => { setFiltersVisible(false); $('filters-toggle').focus(); });
$('filter-panel').addEventListener('keydown', event => {
  if (event.key === 'Escape') { setFiltersVisible(false); $('filters-toggle').focus(); }
});
let searchTimer = null;
const cancelSearchRender = () => { clearTimeout(searchTimer); searchTimer = null; };
const resetAndRender = () => { cancelSearchRender(); state.page = 1; render({ fitMap: true }); };
const resetAndRenderNow = resetAndRender;
$('reset-filters').addEventListener('click', () => {
  cancelSearchRender();
  for (const id of ['search', 'source-filter', 'location-filter', 'area-filter', 'fuel-filter']) $(id).value = '';
  $('near-fuel').checked = false;
  $('area-radius').value = '1000'; $('fuel-radius').value = '500';
  resetAndRender();
});
$('search').addEventListener('input', () => {
  cancelSearchRender();
  searchTimer = setTimeout(resetAndRenderNow, 180);
});
$('location-filter').addEventListener('change', resetAndRenderNow);
$('source-filter').addEventListener('change', resetAndRenderNow);
$('area-filter').addEventListener('change', () => { if (!$('area-filter').value && isSunsetSearch($('search').value)) $('search').value = ''; resetAndRenderNow(); });
$('area-radius').addEventListener('change', resetAndRenderNow);
$('layout').addEventListener('change', () => { state.pageSize = Number($('layout').value); resetAndRenderNow(); });
$('all-tab').addEventListener('click', () => { state.favoritesOnly = false; resetAndRenderNow(); });
$('favorites-tab').addEventListener('click', () => { state.favoritesOnly = true; resetAndRenderNow(); });
$('previous').addEventListener('click', () => { if (searchTimer) { resetAndRenderNow(); return; } state.page--; render(); });
$('next').addEventListener('click', () => { if (searchTimer) { resetAndRenderNow(); return; } state.page++; render(); });
$('play-page').addEventListener('click', () => {
  if (searchTimer) resetAndRenderNow();
  const pageItems = currentPage().items;
  const playable = pageItems.find(camera => camera.playback !== 'link');
  if (isCompactPlayback()) {
    if (playable) playCard(playable, { scroll: true });
    notify(playable ? 'Menghubungkan kamera.' : 'Tidak ada siaran kamera pada halaman ini.');
    return;
  }
  for (const camera of pageItems) if (camera.playback !== 'link' && !state.players.has(camera.id)) playCard(camera);
  notify('Menghubungkan kamera pada halaman ini.');
});
$('stop-all').addEventListener('click', () => { stopGrid(); if ($('focus-dialog').open) $('focus-dialog').close(); notify('Semua siaran dihentikan.'); });
$('focus-close').addEventListener('click', () => $('focus-dialog').close());
$('focus-dialog').addEventListener('close', () => { destroyPlayer('focus'); $('focus-media').replaceChildren(); state.focus = null; });
$('near-fuel').addEventListener('change', resetAndRender);
$('fuel-filter').addEventListener('change', () => { $('near-fuel').checked = true; resetAndRender(); });
$('fuel-radius').addEventListener('change', () => { $('near-fuel').checked = true; resetAndRender(); });
$('fuel-reset').addEventListener('click', () => { $('near-fuel').checked = false; $('fuel-filter').value = ''; $('fuel-radius').value = '500'; resetAndRender(); });
function syncResponsivePlayback() {
  const compact = isCompactPlayback();
  const wantedSize = compact ? 4 : 9;
  if (state.pageSize !== wantedSize) { state.pageSize = wantedSize; $('layout').value = String(wantedSize); }
  $('play-page').textContent = compact ? '▶ Putar kamera' : '▶ Putar halaman';
  $('play-page').title = compact ? 'Putar kamera pertama pada halaman ini' : 'Putar kamera pada halaman ini';
  if (compact) {
    const keep = state.players.has('focus') ? 'focus' : state.players.keys().next().value;
    if (keep) enforcePlayerLimit(keep);
  } else if (playingObserver) {
    for (const key of state.players.keys()) unobservePlayingCard(key);
  }
  resetAndRenderNow();
}
compactViewport.addEventListener('change', syncResponsivePlayback);
coarsePointer.addEventListener('change', syncResponsivePlayback);
function setMapVisible(visible) {
  $('map-content').hidden = !visible;
  $('map-toggle').textContent = visible ? 'Tutup peta' : 'Buka peta';
  $('map-toggle').setAttribute('aria-expanded', String(visible));
  if (visible) state.map?.invalidate();
}
$('map-toggle').addEventListener('click', () => setMapVisible($('map-content').hidden));
$('map-fit').addEventListener('click', () => state.map?.fit());
document.querySelector('.topbar .source-link').addEventListener('click', () => { $('source-details').open = true; });
function stopAllPlayers() {
  stopGrid();
  if ($('focus-dialog').open) $('focus-dialog').close();
  else destroyPlayer('focus');
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopAllPlayers(); });
window.addEventListener('pagehide', stopAllPlayers);
document.addEventListener('keydown', event => {
  if (event.key === '/' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName) && !$('focus-dialog').open) { event.preventDefault(); $('search').focus(); }
});
function clock() { $('clock').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit' }).format(new Date()) + ' WITA'; }
clock(); setInterval(clock, 1000);
async function init() {
  try {
    const fuelRequest = fetch('./fuel-stations.json', { cache: 'no-cache', signal: AbortSignal.timeout(10000) })
      .then(response => { if (!response.ok) throw new Error('SPBU unavailable'); return response.json(); })
      .then(normalizeStations).catch(() => null);
    const roadsRequest = fetch('./roads.json', { cache: 'no-cache', signal: AbortSignal.timeout(10000) })
      .then(response => response.ok ? response.json() : null).then(normalizeRoads).catch(() => []);
    const additionalRequest = fetch('./additional-cameras.json', { cache: 'no-cache', signal: AbortSignal.timeout(10000) })
      .then(response => response.ok ? response.json() : { cameras: [] }).catch(() => ({ cameras: [] }));
    const response = await fetch('./cameras.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Camera catalogue request failed');
    const data = normalizeCatalogue(await response.json());
    const additional = await additionalRequest;
    let additionalCameras = [];
    if (additional.cameras?.length) {
      try { additionalCameras = normalizeCatalogue(additional).cameras; }
      catch { notify('Katalog tambahan tidak dapat dimuat. Kamera Denpasar tetap tersedia.'); }
    }
    state.cameras = mergeCameras(data.cameras, additionalCameras);
    const sourceIds = [...new Set(state.cameras.flatMap(camera => [camera.sourceId, ...(camera.alsoListedBy || [])]))];
    $('source-count').textContent = `${sourceIds.length} sumber`;
    for (const id of sourceIds) {
      const option = element('option', '', SOURCES[id].label); option.value = id; $('source-filter').append(option);
      const status = element('p'); const link = element('a', '', SOURCES[id].label);
      link.href = SOURCES[id].url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const cameras = state.cameras.filter(camera => camera.sourceId === id || camera.alsoListedBy?.includes(id));
      const playable = cameras.filter(camera => camera.playback !== 'link').length;
      status.append(link, document.createTextNode(` — ${cameras.length} kamera; ${playable} tautan pemutar publik. ${additional.sources?.find(source => source.id === id)?.note || ''}`));
      $('source-status').append(status);
    }
    $('total-count').textContent = String(state.cameras.length);
    $('sidebar-camera-count').textContent = String(state.cameras.length);
    const locations = [...new Set(state.cameras.map(camera => camera.location))].sort();
    $('location-count').textContent = String(locations.length);
    for (const location of locations) { const option = element('option', '', location); option.value = location; $('location-filter').append(option); }
    $('catalog-date').textContent = data.updatedAt;
    state.roads = await roadsRequest;
    if (state.roads.some(road => road.id === 'sunset-road')) for (const id of ['area-filter', 'area-radius']) $(id).disabled = false;
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
      refreshFuelOptions();
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
