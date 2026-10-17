import { validCoordinate } from './geo.js';

// Keep separate views at one junction in a single selectable map point.
export function cameraPoints(cameras) {
  const groups = new Map();
  for (const camera of cameras) {
    if (!validCoordinate(camera)) continue;
    const key = `${camera.latitude.toFixed(6)},${camera.longitude.toFixed(6)}`;
    if (!groups.has(key)) groups.set(key, { key, latitude: camera.latitude, longitude: camera.longitude, cameras: [] });
    groups.get(key).cameras.push(camera);
  }
  return [...groups.values()];
}

// Use world pixels, so clusters do not shift between cells when the map is dragged.
// Every original point remains in items and can be revealed by zooming in.
export function clusterPoints(points, project, cellSize = 56) {
  const cells = new Map();
  for (const point of points) {
    const pixel = project(point);
    const key = cellSize > 0 ? `${Math.floor(pixel.x / cellSize)}:${Math.floor(pixel.y / cellSize)}` : `point:${point.key || point.id}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(point);
  }
  return [...cells.entries()].map(([key, items]) => ({
    key: items.length === 1 ? `point:${items[0].key || items[0].id}` : `cell:${key}`,
    latitude: items.reduce((sum, item) => sum + item.latitude, 0) / items.length,
    longitude: items.reduce((sum, item) => sum + item.longitude, 0) / items.length,
    items
  }));
}
