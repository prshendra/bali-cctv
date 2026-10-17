import { validCoordinate } from './geo.js';

export function normalizeRoads(payload) {
  if (!payload || !Array.isArray(payload.roads)) return [];
  return payload.roads.filter(road => road && typeof road.id === 'string' && typeof road.name === 'string' && Array.isArray(road.paths))
    .map(road => ({ ...road, paths: road.paths.filter(path => Array.isArray(path) && path.length > 1 && path.every(point => Array.isArray(point) && validCoordinate({ latitude: point[0], longitude: point[1] }))) }))
    .filter(road => road.paths.length);
}

// Local tangent projection: road segments are short and limited to the Bali region.
// Returns distance to the nearest segment, rather than to the nearest road vertex.
export function distanceToRoadMeters(point, road) {
  if (!validCoordinate(point) || !road?.paths?.length) return Infinity;
  const radians = Math.PI / 180;
  const scale = 6371000 * radians;
  const longitudeScale = scale * Math.cos(point.latitude * radians);
  let nearest = Infinity;
  for (const path of road.paths) {
    for (let i = 1; i < path.length; i++) {
      const [lat1, lon1] = path[i - 1]; const [lat2, lon2] = path[i];
      const x1 = (lon1 - point.longitude) * longitudeScale;
      const y1 = (lat1 - point.latitude) * scale;
      const dx = (lon2 - lon1) * longitudeScale; const dy = (lat2 - lat1) * scale;
      const squaredLength = dx * dx + dy * dy;
      const t = squaredLength ? Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / squaredLength)) : 0;
      nearest = Math.min(nearest, Math.hypot(x1 + t * dx, y1 + t * dy));
    }
  }
  return nearest;
}

export function nearRoad(items, road, radiusMeters) {
  if (!Number.isFinite(radiusMeters) || radiusMeters < 0) return [];
  return items.map((item, index) => ({ item, index, distance: distanceToRoadMeters(item, road) }))
    .filter(result => result.distance <= radiusMeters)
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map(result => result.item);
}

export function isSunsetSearch(query) { return /^(?:jalan\s+|jl\.?\s+)?sunset(?:\s+road)?$/i.test(query.trim()); }
