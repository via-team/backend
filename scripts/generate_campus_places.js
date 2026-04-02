#!/usr/bin/env node
/**
 * Fetches UT building footprints from ArcGIS, computes WGS84 centroids,
 * merges curated West Campus landmarks, writes frontend/assets/places/campus_places.json
 *
 * Usage: node backend/scripts/generate_campus_places.js
 * (run from repo root or backend — paths resolve relative to script dir)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const SCRIPT_DIR = path.dirname(__filename);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const WEST_PATH = path.join(REPO_ROOT, 'backend', 'data', 'places', 'west_campus_landmarks.json');
const OUT_PATH = path.join(REPO_ROOT, 'frontend', 'assets', 'places', 'campus_places.json');

const ARCGIS_BASE =
  'https://services9.arcgis.com/w9x0fkENXvuWZY26/arcgis/rest/services/Buildings_Simple/FeatureServer/0/query';

/** Rough bbox: UT main campus + West Campus (excludes distant UT sites). */
const BBOX = { minLat: 30.265, maxLat: 30.315, minLng: -97.82, maxLng: -97.68 };

/** Optional manual centroid overrides: key = stable id ut-<OBJECTID> or Building_Abbr */
const CENTROID_OVERRIDES = {};

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Invalid JSON from ${url}: ${e.message}`));
          }
        });
      })
      .on('error', reject);
  });
}

function polygonCentroid4326(rings) {
  if (!rings || !rings.length || !rings[0].length) return null;
  const ring = rings[0];
  let sumX = 0;
  let sumY = 0;
  let n = 0;
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const x = Number(pt[0]);
    const y = Number(pt[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sumX += x;
    sumY += y;
    n += 1;
  }
  if (n === 0) return null;
  return { lng: sumX / n, lat: sumY / n };
}

function inBbox(lat, lng) {
  return (
    lat >= BBOX.minLat &&
    lat <= BBOX.maxLat &&
    lng >= BBOX.minLng &&
    lng <= BBOX.maxLng
  );
}

function buildDisplayName(attrs) {
  const desc = (attrs.Description || '').trim();
  const abbr = (attrs.Building_Abbr || '').trim();
  const bld = (attrs.Building || '').trim();
  if (desc) return desc;
  if (abbr && bld) return `${abbr} (${bld})`;
  if (abbr) return abbr;
  if (bld) return `Building ${bld}`;
  return 'Unnamed building';
}

function normalizeAliases(name, shortName, extra = []) {
  const set = new Set();
  const add = (s) => {
    const t = String(s || '')
      .trim()
      .toLowerCase();
    if (t.length > 1) set.add(t);
  };
  add(name);
  add(shortName);
  for (const e of extra) add(e);
  return Array.from(set);
}

async function fetchAllFeatures() {
  const pageSize = 2000;
  let offset = 0;
  const all = [];
  const outFields = [
    'OBJECTID',
    'Description',
    'Building',
    'Building_Abbr',
    'Address_Full',
    'Map_Classification',
    'Building_Details_URL',
  ].join(',');

  for (;;) {
    const params = new URLSearchParams({
      where: '1=1',
      outFields,
      returnGeometry: 'true',
      outSR: '4326',
      f: 'json',
      resultRecordCount: String(pageSize),
      resultOffset: String(offset),
    });
    const url = `${ARCGIS_BASE}?${params.toString()}`;
    const json = await httpsGetJson(url);
    const features = json.features || [];
    all.push(...features);
    if (features.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

function loadWestCampus() {
  const raw = JSON.parse(fs.readFileSync(WEST_PATH, 'utf8'));
  return raw.places || [];
}

function main() {
  return (async () => {
    console.error('Fetching ArcGIS building features...');
    const features = await fetchAllFeatures();
    console.error(`Got ${features.length} features`);

    const utPlaces = [];
    const dropped = [];

    for (const f of features) {
      const attrs = f.attributes || {};
      const oid = attrs.OBJECTID;
      const geom = f.geometry;
      if (!geom || !geom.rings) {
        dropped.push({ oid, reason: 'no geometry' });
        continue;
      }
      const c = polygonCentroid4326(geom.rings);
      if (!c || !inBbox(c.lat, c.lng)) {
        dropped.push({ oid, reason: 'no centroid or outside bbox' });
        continue;
      }

      const id = `ut-${oid}`;
      let lat = c.lat;
      let lng = c.lng;
      const abbr = (attrs.Building_Abbr || '').trim();
      if (CENTROID_OVERRIDES[id]) {
        lat = CENTROID_OVERRIDES[id].lat;
        lng = CENTROID_OVERRIDES[id].lng;
      } else if (abbr && CENTROID_OVERRIDES[abbr]) {
        lat = CENTROID_OVERRIDES[abbr].lat;
        lng = CENTROID_OVERRIDES[abbr].lng;
      }

      const name = buildDisplayName(attrs);
      const shortName = abbr || null;
      const aliases = normalizeAliases(name, shortName, [
        attrs.Building,
        attrs.Address_Full,
      ]);

      utPlaces.push({
        id,
        name,
        short_name: shortName,
        aliases,
        lat,
        lng,
        category: 'ut_building',
        source: 'ut_arcgis',
        map_classification: attrs.Map_Classification || null,
        building_details_url: attrs.Building_Details_URL || null,
        search_weight: attrs.Map_Classification === 'FrequentDestination' ? 15 : 0,
      });
    }

    console.error(`UT buildings in bbox: ${utPlaces.length}, dropped: ${dropped.length}`);

    const west = loadWestCampus();
    for (const p of west) {
      if (!p.id || p.lat == null || p.lng == null) {
        console.error('Invalid west campus entry:', p);
        process.exit(1);
      }
      p.aliases = normalizeAliases(p.name, p.short_name, p.aliases || []);
    }

    const combined = [...utPlaces, ...west];
    combined.sort((a, b) => {
      const cat = String(a.category).localeCompare(String(b.category));
      if (cat !== 0) return cat;
      return String(a.name).localeCompare(String(b.name));
    });

    const out = {
      version: 1,
      generated_at: new Date().toISOString(),
      places: combined,
    };

    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
    console.error(`Wrote ${OUT_PATH} (${combined.length} places)`);
  })();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
