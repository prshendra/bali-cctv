// Fetch public OpenStreetMap fuel station data for the area covered by the cameras.
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { distanceMeters, normalizeStations, validCoordinate } from '../dist/geo.js';

const endpoints = [
  'https://overpass-api.de/api/interpreter',
  // Public global-data instance listed by the OpenStreetMap Wiki as Private.coffee.
  'https://overpass.private.coffee/api/interpreter'
];
const sourceUrl = 'https://www.openstreetmap.org/copyright';
const destination = new URL('../dist/fuel-stations.json', import.meta.url);
const temporary = new URL('../dist/fuel-stations.json.tmp', import.meta.url);

export function paddedBounds(cameras) {
  const valid = cameras.filter(validCoordinate);
  if (!valid.length) throw new Error('Camera catalogue has no valid coordinates');
  const padding = 0.05;
  return [
    Math.min(...valid.map(camera => camera.latitude)) - padding,
    Math.min(...valid.map(camera => camera.longitude)) - padding,
    Math.max(...valid.map(camera => camera.latitude)) + padding,
    Math.max(...valid.map(camera => camera.longitude)) + padding
  ];
}

function addressFrom(tags) {
  const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
  return [street, tags['addr:suburb'], tags['addr:city']]
    .map(value => String(value || '').trim()).filter(Boolean).join(', ');
}

function mapStation(element) {
  const tags = element.tags || {};
  // The Overpass selector already requires amenity=fuel; retain the same guard
  // here so malformed or substituted endpoint responses cannot add other POIs.
  if (tags.amenity !== 'fuel'
      || ['disused', 'abandoned', 'closed'].some(key => /^(yes|true|1)$/i.test(String(tags[key] || '')))
      || /^(closed|disused|abandoned)$/i.test(String(tags.operational_status || ''))) return null;
  const name = String(tags.name || '').trim();
  const nitrogenOnly = (tags['fuel:nitrogen'] === 'yes' || tags['fuel:nitrogen_filling'] === 'yes')
    && /nitrogen/i.test(name)
    && !Object.keys(tags).some(key => key.startsWith('fuel:') && !key.startsWith('fuel:nitrogen'));
  if (nitrogenOnly) return null;
  const point = element.type === 'node'
    ? { latitude: element.lat, longitude: element.lon }
    : { latitude: element.center?.lat, longitude: element.center?.lon };
  if (!validCoordinate(point)) return null;
  const id = `${element.type}/${element.id}`;
  const brand = String(tags.brand || '').trim();
  return {
    id,
    name: name || (brand ? `SPBU ${brand}` : `SPBU (OSM ${id})`),
    brand,
    address: addressFrom(tags),
    ...point,
    osmUrl: `https://www.openstreetmap.org/${id}`,
    explicitName: Boolean(name)
  };
}

export function stationData(elements) {
  const unique = [];
  const ids = new Set();
  for (const element of elements) {
    if (!element || !['node', 'way', 'relation'].includes(element.type)
        || !Number.isSafeInteger(element.id) || element.id <= 0) continue;
    const station = mapStation(element);
    if (!station || ids.has(station.id)) continue;
    ids.add(station.id);
    // OSM sometimes maps one filling station as both a node and an area. Only
    // collapse a nearby pair when the explicit names match and one is a node.
    const duplicateIndex = station.explicitName ? unique.findIndex(existing =>
      existing.explicitName
      && existing.name.toLocaleLowerCase() === station.name.toLocaleLowerCase()
      && (existing.id.startsWith('node/') !== station.id.startsWith('node/'))
      && distanceMeters(existing, station) <= 30) : -1;
    if (duplicateIndex >= 0) {
      if (station.id.startsWith('node/')) unique[duplicateIndex] = station;
      continue;
    }
    unique.push(station);
  }
  return unique.map(({ explicitName, ...station }) => station).sort((a, b) => a.id.localeCompare(b.id));
}

export function elementsFromOverpass(payload) {
  if (!payload || typeof payload !== 'object' || (typeof payload.remark === 'string' && payload.remark.trim())) {
    throw new Error('Overpass returned an incomplete result');
  }
  if (!Array.isArray(payload.elements) || payload.elements.length === 0) {
    throw new Error('Overpass returned no elements');
  }
  return payload.elements;
}

export function createSnapshot(elements, bounds, updatedAt = new Date().toISOString()) {
  const stations = stationData(elements);
  const dataset = { source: 'OpenStreetMap contributors', sourceUrl, updatedAt, bounds, stations };
  const normalized = normalizeStations(dataset);
  if (!Number.isFinite(Date.parse(updatedAt))
      || !Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)
      || stations.length === 0 || normalized.stations.length !== stations.length) {
    throw new Error('Refusing to save an empty or invalid fuel station snapshot');
  }
  return dataset;
}

async function queryEndpoint(endpoint, query) {
  const url = new URL(endpoint);
  url.searchParams.set('data', query);
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'DenpasarCameraDesk/1.0 (OpenStreetMap fuel map)' },
    signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return elementsFromOverpass(payload);
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
  const cameras = JSON.parse(await readFile(new URL('../dist/cameras.json', import.meta.url), 'utf8')).cameras;
  if (!Array.isArray(cameras)) throw new Error('Camera catalogue is invalid');
  const bounds = paddedBounds(cameras);
  const query = `[out:json][timeout:40];nwr["amenity"="fuel"](${bounds.join(',')});out center tags;`;
  const elements = await fetchElements(query);
  const dataset = createSnapshot(elements, bounds);
  await writeFile(temporary, `${JSON.stringify(dataset, null, 2)}\n`);
  await rename(temporary, destination);
  console.log(`Saved ${dataset.stations.length} OpenStreetMap fuel stations for the camera area.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
  await rm(temporary, { force: true }).catch(() => {});
  console.error(`Fuel station refresh failed; the existing snapshot was preserved. ${error.message}`);
  process.exitCode = 1;
  }
}
