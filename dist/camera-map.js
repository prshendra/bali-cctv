import { validCoordinate, nearestStation } from './geo.js';
import { cameraPoints, clusterPoints } from './map-points.js';

const cameraIcon = '<svg viewBox="0 0 30 36" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M15 35S2 23 2 15a13 13 0 1 1 26 0c0 8-13 20-13 20Z" fill="#13866e" stroke="#fff" stroke-width="1.8"/><rect x="7" y="10" width="11" height="9" rx="2" fill="#e1fff3"/><path d="m18 12 5-2v9l-5-2" fill="#e1fff3"/></svg>';
const fuelIcon = '<svg viewBox="0 0 30 36" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="m15 1 6 7h3a4 4 0 0 1 4 4v19a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4h3Z" fill="#e99b22" stroke="#fff" stroke-width="1.8"/><path d="M8 29V15h10v14M6 29h14M10 17h6v5h-6M18 22h3v5c0 2 3 2 3 0v-7l-4-4" stroke="#38250a" stroke-width="1.8" stroke-linejoin="round" fill="none"/></svg>';
function node(tag, text) { const el = document.createElement(tag); if (text) el.textContent = text; return el; }
function action(text, onClick) { const el = node('button', text); el.type = 'button'; el.addEventListener('click', onClick); return el; }
function osmLink(label, url) { const link = node('a', label); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link; }
export function formatDistance(distance) { return distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(2).replace('.', ',')} km`; }
export function stationDisplayName(station) { return /^SPBU \(OSM /.test(station.name) ? 'SPBU tanpa nama' : station.name; }

export function createCameraMap({ onPlayCamera, onSelectStation, onMapWarning }) {
  const L = window.L;
  if (!L) throw new Error('Pustaka peta tidak tersedia. Filter SPBU tetap dapat digunakan.');
  const container = document.getElementById('camera-map');
  const light = window.matchMedia('(max-width: 640px), (pointer: coarse)').matches;
  const map = L.map(container, {
    scrollWheelZoom: true, dragging: true, touchZoom: true,
    preferCanvas: true, fadeAnimation: !light, zoomAnimation: !light, markerZoomAnimation: false
  }).setView([-8.656, 115.221], 13);
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, updateWhenIdle: true, updateWhenZooming: false, keepBuffer: 1,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
  }).addTo(map);
  tiles.on('tileerror', () => onMapWarning('Sebagian latar peta gagal dimuat. Titik lokasi dan filter jarak tetap tersedia.'));
  const pointsLayer = L.layerGroup().addTo(map);
  const radiusLayer = L.layerGroup().addTo(map);
  const roadLayer = L.layerGroup().addTo(map);
  const markers = new Map();
  let groups = [];
  let stations = [];
  let currentPoints = [];
  let latest = { selectedStationId: '', nearbyOnly: false, radiusMeters: 500, road: null };
  let paintFrame = 0;
  const cameraDivIcon = L.divIcon({ className: 'map-pin camera-pin', html: cameraIcon, iconSize: [30, 36], iconAnchor: [15, 35], popupAnchor: [0, -28] });
  const locationDivIcon = L.divIcon({ className: 'map-pin camera-pin location-pin', html: cameraIcon.replace('#13866e', '#647a83'), iconSize: [30, 36], iconAnchor: [15, 35], popupAnchor: [0, -28] });
  const fuelDivIcon = selected => L.divIcon({ className: `map-pin fuel-pin${selected ? ' is-selected' : ''}`, html: fuelIcon, iconSize: [30, 36], iconAnchor: [15, 0], popupAnchor: [0, 0] });
  const fuelIcons = [fuelDivIcon(false), fuelDivIcon(true)];

  function cameraPopup(group) {
    const first = group.cameras[0];
    const popup = node('div'); popup.className = 'map-popup';
    popup.append(node('strong', first.location), node('p', `${group.cameras.length} kamera · ${first.description}`));
    if (group.cameras.every(camera => camera.playback === 'link')) popup.append(node('p', 'Lokasi terdaftar; siaran publik belum tersedia dari sumber ini.'));
    const comparison = latest.selectedStationId ? stations.filter(station => station.id === latest.selectedStationId) : stations;
    const nearest = nearestStation(first, comparison);
    if (nearest) popup.append(node('p', `${formatDistance(nearest.distanceMeters)} dari ${stationDisplayName(nearest.station)} (garis lurus)`));
    for (const camera of group.cameras) popup.append(action(`${camera.playback === 'link' ? 'ⓘ' : '▶'} ${camera.name} · ${camera.sourceLabel || 'ATCS Denpasar'}`, () => onPlayCamera(camera)));
    return popup;
  }
  function stationPopup(station) {
    const popup = node('div'); popup.className = 'map-popup';
    popup.append(node('strong', stationDisplayName(station)));
    if (station.brand) popup.append(node('p', station.brand));
    if (station.address) popup.append(node('p', station.address));
    popup.append(action('Cari CCTV sekitar SPBU ini', () => onSelectStation(station.id)));
    if (/^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/.test(station.osmUrl || '')) popup.append(osmLink('Lihat data OpenStreetMap ↗', station.osmUrl));
    return popup;
  }
  function makeMarker(kind, cluster) {
    const point = [cluster.latitude, cluster.longitude];
    if (cluster.items.length > 1) {
      const label = `${cluster.items.length} ${kind === 'camera' ? 'titik CCTV' : 'SPBU'} · klik untuk zoom`;
      const locationOnly = kind === 'camera' && cluster.items.every(group => group.cameras.every(camera => camera.playback === 'link'));
      const icon = L.divIcon({
        className: `map-cluster ${kind === 'camera' ? (locationOnly ? 'cluster-location' : 'cluster-camera') : 'cluster-fuel'}`,
        html: `<span>${cluster.items.length}</span>`, iconSize: [36, 36], iconAnchor: kind === 'camera' ? [18, 36] : [18, 0]
      });
      const expand = () => {
        const bounds = L.latLngBounds(cluster.items.map(item => [item.latitude, item.longitude]));
        map.fitBounds(bounds, { padding: [35, 35], maxZoom: Math.min(17, map.getZoom() + 2), animate: false });
      };
      return L.marker(point, { icon, title: label, alt: label, zIndexOffset: kind === 'fuel' ? 200 : 0 })
        .on('click', expand).on('keypress', event => {
          if (['Enter', ' '].includes(event.originalEvent?.key)) { event.originalEvent.preventDefault(); expand(); }
        });
    }
    const item = cluster.items[0];
    if (kind === 'camera') {
      const first = item.cameras[0];
      const locationOnly = item.cameras.every(camera => camera.playback === 'link');
      const title = `${locationOnly ? 'Lokasi CCTV' : 'CCTV'}: ${first.location} (${item.cameras.length} kamera)`;
      return L.marker(point, { icon: locationOnly ? locationDivIcon : cameraDivIcon, title, alt: title }).bindPopup(() => cameraPopup(item));
    }
    const selected = item.id === latest.selectedStationId;
    return L.marker(point, { icon: fuelIcons[Number(selected)], title: `SPBU: ${stationDisplayName(item)}`, alt: `SPBU ${stationDisplayName(item)}`, zIndexOffset: selected ? 1000 : 200 }).bindPopup(() => stationPopup(item));
  }
  function paint() {
    if (!container.clientHeight || !container.clientWidth) return;
    const zoom = map.getZoom();
    const bounds = map.getBounds().pad(.2);
    const project = item => map.project([item.latitude, item.longitude], zoom);
    const size = zoom >= 17 ? 0 : 56;
    const selected = stations.find(station => station.id === latest.selectedStationId);
    const clusters = [
      ...clusterPoints(groups, project, size).map(cluster => ({ kind: 'camera', cluster })),
      ...clusterPoints(stations.filter(station => station !== selected), project, size).map(cluster => ({ kind: 'fuel', cluster })),
      ...(selected ? [{ kind: 'fuel', cluster: { key: `point:${selected.id}`, latitude: selected.latitude, longitude: selected.longitude, items: [selected] } }] : [])
    ];
    const visible = new Set();
    for (const { kind, cluster } of clusters) {
      if (!bounds.contains([cluster.latitude, cluster.longitude])) continue;
      const key = `${kind}:${cluster.items.length > 1 ? zoom + ':' : ''}${cluster.key}`;
      visible.add(key);
      if (!markers.has(key)) markers.set(key, makeMarker(kind, cluster).addTo(pointsLayer));
    }
    for (const [key, marker] of markers) if (!visible.has(key)) { pointsLayer.removeLayer(marker); markers.delete(key); }
  }
  function schedulePaint() {
    cancelAnimationFrame(paintFrame);
    paintFrame = requestAnimationFrame(paint);
  }
  // No marker work during a drag/pinch: only reconcile visible clusters once it ends.
  map.on('moveend zoomend resize', schedulePaint);

  function update(cameras, stationData, options = {}) {
    latest = { selectedStationId: '', nearbyOnly: false, radiusMeters: 500, road: null, ...options };
    groups = cameraPoints(cameras);
    stations = stationData.filter(validCoordinate);
    currentPoints = groups.map(group => [group.latitude, group.longitude]);
    pointsLayer.clearLayers(); markers.clear(); radiusLayer.clearLayers(); roadLayer.clearLayers();
    if (latest.road) L.polyline(latest.road.paths, { color: '#7448c4', weight: 5, opacity: .85 }).bindTooltip(latest.road.name).addTo(roadLayer);
    const selected = stations.find(station => station.id === latest.selectedStationId);
    if (selected) {
      currentPoints.push([selected.latitude, selected.longitude]);
      if (latest.nearbyOnly) L.circle([selected.latitude, selected.longitude], { radius: latest.radiusMeters, color: '#b8750d', weight: 2, fillColor: '#e9a332', fillOpacity: .12 }).addTo(radiusLayer);
    }
    document.getElementById('map-count').textContent = `${groups.length} titik CCTV · ${stations.length} SPBU`;
    schedulePaint();
  }
  function fit() {
    map.invalidateSize();
    const selected = stations.find(station => station.id === latest.selectedStationId);
    if (selected && latest.nearbyOnly) {
      map.fitBounds(L.latLng(selected.latitude, selected.longitude).toBounds(latest.radiusMeters * 2), { padding: [24, 24], maxZoom: 16, animate: false });
    } else if (latest.road) {
      const bounds = L.latLngBounds(latest.road.paths.flat());
      for (const point of currentPoints) bounds.extend(point);
      map.fitBounds(bounds.pad(.12), { padding: [25, 25], maxZoom: 15, animate: false });
    } else if (currentPoints.length) map.fitBounds(currentPoints, { padding: [25, 25], maxZoom: 15, animate: false });
    else if (stations.length) map.fitBounds(stations.map(station => [station.latitude, station.longitude]), { padding: [25, 25], maxZoom: 14, animate: false });
    schedulePaint();
  }
  const resizeObserver = new ResizeObserver(() => { map.invalidateSize({ pan: false }); schedulePaint(); });
  resizeObserver.observe(container);
  map.on('unload', () => { resizeObserver.disconnect(); cancelAnimationFrame(paintFrame); });
  return {
    update, fit,
    invalidate: () => { map.invalidateSize(); schedulePaint(); },
    showCamera(camera) {
      const group = groups.find(item => item.cameras.some(item => item.id === camera.id));
      if (!group) return;
      map.invalidateSize();
      map.setView([group.latitude, group.longitude], 17, { animate: false });
      paint();
      markers.get(`camera:point:${group.key}`)?.openPopup();
    }
  };
}
