// Fetch only the exact Sunset Road OSM highway ways in the published search area.
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validCoordinate } from '../dist/geo.js';

const endpoints = [
  'https://overpass-api.de/api/interpreter',
  // Public global-data instance listed by the OpenStreetMap Wiki as Private.coffee.
  'https://overpass.private.coffee/api/interpreter'
];
const source = 'OpenStreetMap contributors';
const sourceUrl = 'https://www.openstreetmap.org/copyright';
const regionBounds = [-8.78, 115.1, -8.55, 115.34];
const destination = new URL('../dist/roads.json', import.meta.url);
const temporary = new URL('../dist/roads.json.tmp', import.meta.url);
const sunsetRoadName = /^(?:jalan\s+)?sunset road$/i;

export function elementsFromOverpass(payload) {
  if (!payload || typeof payload !== 'object' || (typeof payload.remark === 'string' && payload.remark.trim())) {
    throw new Error('Overpass returned an incomplete result');
  }
  if (!Array.isArray(payload.elements) || payload.elements.length === 0) {
    throw new Error('Overpass returned no elements');
  }
  return payload.elements;
}

export function createRoadSnapshot(elements, updatedAt = new Date().toISOString()) {
  const ways = elements.filter(element => element?.type === 'way'
    && Number.isSafeInteger(element.id) && element.id > 0
    && typeof element.tags?.highway === 'string' && element.tags.highway
    && typeof element.tags?.name === 'string' && sunsetRoadName.test(element.tags.name.trim()))
    .sort((a, b) => a.id - b.id);
  const ids = new Set();
  const paths = [];
  for (const way of ways) {
    if (ids.has(way.id)) continue;
    const geometry = way.geometry;
    if (!Array.isArray(geometry) || geometry.length < 2) {
      throw new Error(`Sunset Road way ${way.id} has missing geometry`);
    }
    const path = geometry.map(point => [point.lat, point.lon]);
    if (path.some(([latitude, longitude]) => !validCoordinate({ latitude, longitude }))) {
      throw new Error(`Sunset Road way ${way.id} has invalid geometry`);
    }
    ids.add(way.id);
    paths.push(path);
  }
  if (paths.length === 0 || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error('Refusing to save an empty or invalid Sunset Road snapshot');
  }
  return {
    source,
    sourceUrl,
    updatedAt,
    roads: [{ id: 'sunset-road', name: 'Sunset Road', osmWayIds: [...ids], paths }]
  };
}

async function queryEndpoint(endpoint, query) {
  const url = new URL(endpoint);
  url.searchParams.set('data', query);
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'DenpasarCameraDesk/1.0 (OpenStreetMap road map)' },
    signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return elementsFromOverpass(await response.json());
}

async function fetchElements(query) {
  const failures = [];
  for (const endpoint of endpoints) {
    try {
      return await queryEndpoint(endpoint, query);
    } catch (error) {
      // Do not include upstream response bodies or the query in the local log.
      failures.push(`${new URL(endpoint).host}: ${error.name === 'TimeoutError' ? 'timed out' : error.message}`);
    }
  }
  throw new Error(`Overpass query failed (${failures.join('; ')})`);
}

async function main() {
  const query = `[out:json][timeout:40];way["highway"]["name"~"Sunset",i](${regionBounds.join(',')});out geom tags;`;
  const elements = await fetchElements(query);
  const dataset = createRoadSnapshot(elements);
  await writeFile(temporary, `${JSON.stringify(dataset, null, 2)}\n`);
  await rename(temporary, destination);
  const road = dataset.roads[0];
  console.log(`Saved ${road.osmWayIds.length} exact Sunset Road ways and ${road.paths.reduce((sum, path) => sum + path.length, 0)} geometry points.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    console.error(`Sunset Road refresh failed; the existing snapshot was preserved. ${error.message}`);
    process.exitCode = 1;
  }
}
