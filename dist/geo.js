const EARTH_RADIUS_METERS = 6_371_000;
const OSM_ID = /^(node|way|relation)\/[1-9]\d*$/;

export function validCoordinate(point) {
  return Boolean(point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    && point.latitude >= -90 && point.latitude <= 90
    && point.longitude >= -180 && point.longitude <= 180);
}

export function distanceMeters(a, b) {
  if (!validCoordinate(a) || !validCoordinate(b)) return Infinity;
  const radians = value => value * Math.PI / 180;
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const dLat = lat2 - lat1;
  const dLon = radians(b.longitude - a.longitude);
  const haversine = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

export function nearestStation(camera, stations) {
  if (!validCoordinate(camera) || !Array.isArray(stations)) return null;
  let nearest = null;
  for (const station of stations) {
    const distance = distanceMeters(camera, station);
    if (Number.isFinite(distance) && (!nearest || distance < nearest.distanceMeters)) {
      nearest = { station, distanceMeters: distance };
    }
  }
  return nearest;
}

export function nearbyCameras(cameras, stations, { stationId = '', radiusMeters = 500 } = {}) {
  if (!Array.isArray(cameras) || !Array.isArray(stations)
      || !Number.isFinite(radiusMeters) || radiusMeters < 0) return [];
  const candidates = stationId ? stations.filter(station => station?.id === stationId) : stations;
  if (stationId && candidates.length === 0) return [];
  return cameras.map((camera, index) => {
    const nearest = nearestStation(camera, candidates);
    return nearest && nearest.distanceMeters <= radiusMeters
      ? { camera, ...nearest, index }
      : null;
  }).filter(Boolean)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.index - b.index)
    .map(({ index, ...result }) => result);
}

export function normalizeStations(payload) {
  const empty = { stations: [], updatedAt: '' };
  if (!payload || payload.source !== 'OpenStreetMap contributors'
      || payload.sourceUrl !== 'https://www.openstreetmap.org/copyright'
      || !Array.isArray(payload.stations) || typeof payload.updatedAt !== 'string'
      || !Number.isFinite(Date.parse(payload.updatedAt))) return empty;

  const stations = [];
  const ids = new Set();
  for (const value of payload.stations) {
    if (!value || typeof value.id !== 'string' || !OSM_ID.test(value.id) || ids.has(value.id)
        || typeof value.name !== 'string' || !value.name.trim() || !validCoordinate(value)
        || typeof value.brand !== 'string' || typeof value.address !== 'string'
        || value.osmUrl !== `https://www.openstreetmap.org/${value.id}`) continue;
    ids.add(value.id);
    stations.push({
      id: value.id,
      name: value.name.trim(),
      brand: value.brand.trim(),
      address: value.address.trim(),
      latitude: value.latitude,
      longitude: value.longitude,
      osmUrl: value.osmUrl
    });
  }
  return { stations, updatedAt: payload.updatedAt };
}
