import { validCoordinate, nearestStation } from './geo.js';

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
  const map = L.map('camera-map', { scrollWheelZoom: false }).setView([-8.656, 115.221], 13);
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
  }).addTo(map);
  tiles.on('tileerror', () => onMapWarning('Sebagian latar peta gagal dimuat. Titik lokasi dan filter jarak tetap tersedia.'));
  const camerasLayer = L.layerGroup().addTo(map);
  const stationsLayer = L.layerGroup().addTo(map);
  const radiusLayer = L.layerGroup().addTo(map);
  const roadLayer = L.layerGroup().addTo(map);
  let currentPoints = [];
  let cameraMarkers = new Map();
  let latest = { cameras: [], stations: [], selectedStationId: '', nearbyOnly: false, radiusMeters: 500 };
  const cameraDivIcon = L.divIcon({ className: 'map-pin camera-pin', html: cameraIcon, iconSize: [30, 36], iconAnchor: [15, 35], popupAnchor: [0, -28] });
  const locationDivIcon = L.divIcon({ className: 'map-pin camera-pin location-pin', html: cameraIcon.replace('#13866e', '#647a83'), iconSize: [30, 36], iconAnchor: [15, 35], popupAnchor: [0, -28] });

  function update(cameras, stations, { selectedStationId = '', nearbyOnly = false, radiusMeters = 500, road = null } = {}) {
    latest = { cameras, stations, selectedStationId, nearbyOnly, radiusMeters, road };
    camerasLayer.clearLayers(); stationsLayer.clearLayers(); radiusLayer.clearLayers(); roadLayer.clearLayers(); cameraMarkers.clear();
    if (road) L.polyline(road.paths, { color: '#7448c4', weight: 5, opacity: .85 }).bindTooltip(road.name).addTo(roadLayer);
    const groups = new Map();
    for (const camera of cameras.filter(validCoordinate)) {
      const key = `${camera.latitude.toFixed(6)},${camera.longitude.toFixed(6)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(camera);
    }
    const comparisonStations = selectedStationId ? stations.filter(s => s.id === selectedStationId) : stations;
    currentPoints = [];
    for (const group of groups.values()) {
      const first = group[0]; const point = [first.latitude, first.longitude]; currentPoints.push(point);
      const popup = node('div'); popup.className = 'map-popup';
      popup.append(node('strong', first.location), node('p', `${group.length} kamera · ${first.description}`));
      const locationOnly = group.every(camera => camera.playback === 'link');
      if (locationOnly) popup.append(node('p', 'Lokasi terdaftar; siaran publik belum tersedia dari sumber ini.'));
      const nearest = nearestStation(first, comparisonStations);
      if (nearest) popup.append(node('p', `${formatDistance(nearest.distanceMeters)} dari ${stationDisplayName(nearest.station)} (garis lurus)`));
      for (const camera of group) popup.append(action(`${camera.playback === 'link' ? 'ⓘ' : '▶'} ${camera.name} · ${camera.sourceLabel || 'ATCS Denpasar'}`, () => onPlayCamera(camera)));
      const marker = L.marker(point, { icon: locationOnly ? locationDivIcon : cameraDivIcon, title: `${locationOnly ? 'Lokasi CCTV' : 'CCTV'}: ${first.location} (${group.length} kamera)`, alt: `CCTV ${first.location}`, riseOnHover: true }).bindPopup(popup).addTo(camerasLayer);
      for (const camera of group) cameraMarkers.set(camera.id, marker);
    }
    for (const station of stations.filter(validCoordinate)) {
      const selected = station.id === selectedStationId;
      const point = [station.latitude, station.longitude];
      const popup = node('div'); popup.className = 'map-popup';
      popup.append(node('strong', stationDisplayName(station)));
      if (station.brand) popup.append(node('p', station.brand));
      if (station.address) popup.append(node('p', station.address));
      popup.append(action('Cari CCTV sekitar SPBU ini', () => onSelectStation(station.id)));
      if (/^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/.test(station.osmUrl || '')) popup.append(osmLink('Lihat data OpenStreetMap ↗', station.osmUrl));
      L.marker(point, {
        icon: L.divIcon({ className: `map-pin fuel-pin${selected ? ' is-selected' : ''}`, html: fuelIcon, iconSize: [30, 36], iconAnchor: [15, 0], popupAnchor: [0, 0] }),
        title: `SPBU: ${stationDisplayName(station)}`, alt: `SPBU ${stationDisplayName(station)}`, zIndexOffset: selected ? 1000 : 200
      }).bindPopup(popup).addTo(stationsLayer);
      if (selected) {
        currentPoints.push(point);
        if (nearbyOnly) L.circle(point, { radius: radiusMeters, color: '#b8750d', weight: 2, fillColor: '#e9a332', fillOpacity: .12 }).addTo(radiusLayer);
      }
    }
    document.getElementById('map-count').textContent = `${groups.size} titik CCTV · ${stations.length} SPBU`;
  }
  function fit() {
    map.invalidateSize();
    const selected = latest.stations.find(s => s.id === latest.selectedStationId);
    if (selected && latest.nearbyOnly) {
      const bounds = L.latLng(selected.latitude, selected.longitude).toBounds(latest.radiusMeters * 2);
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16, animate: false });
    } else if (latest.road) {
      const bounds = L.latLngBounds(latest.road.paths.flat());
      for (const point of currentPoints) bounds.extend(point);
      map.fitBounds(bounds.pad(.12), { padding: [25, 25], maxZoom: 15, animate: false });
    } else if (currentPoints.length) map.fitBounds(currentPoints, { padding: [25, 25], maxZoom: 15, animate: false });
    else if (latest.stations.length) map.fitBounds(latest.stations.filter(validCoordinate).map(s => [s.latitude, s.longitude]), { padding: [25, 25], maxZoom: 14, animate: false });
  }
  return {
    update, fit,
    invalidate: () => map.invalidateSize(),
    showCamera(camera) {
      const marker = cameraMarkers.get(camera.id);
      if (!marker) return;
      map.invalidateSize();
      map.setView(marker.getLatLng(), 16, { animate: false }); marker.openPopup();
    }
  };
}
