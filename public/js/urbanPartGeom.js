// Ranh sáu đô thị một phần xã trong lớp hiện trạng (Quyết định 614), file public/data/urban614.geojson.
// km2 khớp thuộc tính polygon (scripts/build-urban614.js). Dân số chấm điểm = dân số xã × km2 / diện tích xã.
const PART_URL = new URL('../data/urban614.geojson', import.meta.url);

export const PART_BOUNDS = {
  'vinh-thanh': { ward: 'Phú Vinh', km2: 10.44 },
  'phu-da': { ward: 'Phú Vang', km2: 29.84 },
  'loc-son': { ward: 'Hưng Lộc', km2: 18.82 },
  'khe-tre': { ward: 'Khe Tre', km2: 4.34 },
  'phu-loc': { ward: 'Phú Lộc', km2: 29.98 },
  'vinh-hien': { ward: 'Vinh Lộc', km2: 19.59 }
};

let byId = null;
let promise = null;
let allFeatures = [];

export function partGeomReady() {
  return !!byId;
}

export function shareOf(id, wardKm2) {
  const km2 = PART_BOUNDS[id] && PART_BOUNDS[id].km2;
  if (!(km2 > 0) || !(wardKm2 > 0)) return null;
  return { km2, share: km2 / wardKm2 };
}

function index(fc) {
  allFeatures = fc.features || [];
  const map = new Map();
  allFeatures.forEach(f => {
    const id = f.properties && f.properties.id;
    if (PART_BOUNDS[id]) map.set(id, f);
  });
  return map;
}

export function allPartFeatures() {
  return allFeatures;
}

export function setPartGeoms(fc) {
  byId = index(fc || { features: [] });
  return byId;
}

export function loadPartGeoms() {
  if (byId) return Promise.resolve(byId);
  if (!promise) {
    promise = fetch(PART_URL)
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(fc => { byId = index(fc); return byId; })
      .catch(err => { promise = null; throw err; });
  }
  return promise;
}

export function partFeature(id) {
  return byId ? byId.get(id) || null : null;
}

function ringHas(ring, lng, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInFeature(feature, lng, lat) {
  if (!feature || lng == null || lat == null) return false;
  const g = feature.geometry;
  const polys = g && g.type === 'Polygon' ? [g.coordinates] : (g && g.type === 'MultiPolygon' ? g.coordinates : []);
  return polys.some(rings => rings[0] && ringHas(rings[0], lng, lat) && !rings.slice(1).some(hole => ringHas(hole, lng, lat)));
}
