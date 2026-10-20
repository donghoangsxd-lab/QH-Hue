// Đường sắt và đường thủy nội địa từ OpenStreetMap (Overpass), cắt theo khung TP. Huế.
// Công trình thể thao không còn ở lớp này: nhập vào tab 8-VH (services/osmSports.js).
// Không cần Earth Engine. Huế chưa có đường sắt đô thị hay mạng tàu thủy hành khách.
const axios = require('axios');

const BBOX = '15.9,106.9,16.9,108.3';
const OVERPASS_URLS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const RAIL_LINE = new Set(['rail', 'light_rail', 'subway', 'narrow_gauge', 'tram']);
const RAIL_STOP = new Set(['station', 'halt', 'tram_stop']);
const DEAD = new Set(['abandoned', 'disused', 'razed', 'proposed', 'construction', 'dismantled']);

const RAIL_VI = {
  rail: 'Đường sắt', light_rail: 'Đường sắt nhẹ', subway: 'Tàu điện ngầm',
  narrow_gauge: 'Đường sắt khổ hẹp', tram: 'Tàu điện',
  station: 'Ga', halt: 'Điểm dừng', tram_stop: 'Trạm tàu điện'
};

function haversineKm(a, b) {
  const r = 6371;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLng = (b[0] - a[0]) * Math.PI / 180;
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

function lineKm(coords) {
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += haversineKm(coords[i - 1], coords[i]);
  return Math.round(km * 1000) / 1000;
}

function midpoint(coords) {
  if (!coords.length) return null;
  if (coords.length === 1) return coords[0];
  let half = lineKm(coords) / 2;
  if (!(half > 0)) return coords[Math.floor(coords.length / 2)];
  let walked = 0;
  for (let i = 1; i < coords.length; i++) {
    const step = haversineKm(coords[i - 1], coords[i]);
    if (walked + step >= half) {
      const t = step > 0 ? (half - walked) / step : 0;
      return [
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t
      ];
    }
    walked += step;
  }
  return coords[coords.length - 1];
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

function cleanCoords(raw) {
  const out = [];
  (raw || []).forEach(p => {
    const lon = Number(p.lon), lat = Number(p.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    const prev = out[out.length - 1];
    if (prev && prev[0] === lon && prev[1] === lat) return;
    out.push([round6(lon), round6(lat)]);
  });
  return out;
}

function deadRail(tags) {
  if (DEAD.has(tags.railway) || DEAD.has(tags.service)) return true;
  if (tags.abandoned === 'yes' || tags.disused === 'yes' || tags.razed === 'yes') return true;
  return Object.keys(tags).some(k => /^(abandoned|disused|razed|proposed|construction|dismantled):/.test(k));
}

/** Phần tử Overpass → feature { group, kind, name, lat, lng, lengthKm, geometry } hoặc null */
function featureOf(el) {
  const tags = el.tags || {};
  if (el.type === 'node') {
    const lat = Number(el.lat), lon = Number(el.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (RAIL_STOP.has(tags.railway) && !deadRail(tags)) {
      return pointFeature('railStop', tags.railway, tags.name || RAIL_VI[tags.railway] || 'Ga', lon, lat, el);
    }
    if (tags.amenity === 'ferry_terminal') {
      return pointFeature('ferry', 'ferry_terminal', tags.name || 'Bến thủy', lon, lat, el);
    }
    return null;
  }
  if (el.type !== 'way') return null;
  const coords = cleanCoords(el.geometry);
  if (coords.length < 2) return null;
  if (RAIL_LINE.has(tags.railway) && !deadRail(tags)) {
    const mid = midpoint(coords);
    return {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: props('rail', tags.railway, tags.name || RAIL_VI[tags.railway] || 'Đường sắt', mid, lineKm(coords), el)
    };
  }
  if (tags.waterway === 'river' || tags.waterway === 'canal') {
    const mid = midpoint(coords);
    const label = tags.waterway === 'canal' ? 'Kênh' : 'Sông';
    return {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: props('water', tags.waterway, tags.name || label, mid, lineKm(coords), el)
    };
  }
  return null;
}

function props(group, kind, name, mid, lengthKm, el) {
  return {
    group, kind,
    name: String(name || '').slice(0, 120),
    lat: mid ? mid[1] : null,
    lng: mid ? mid[0] : null,
    lengthKm: lengthKm || 0,
    id: `${el.type}/${el.id}`
  };
}

function pointFeature(group, kind, name, lon, lat, el) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [round6(lon), round6(lat)] },
    properties: props(group, kind, name, [lon, lat], 0, el)
  };
}

function collection(elements) {
  const seen = new Set();
  const features = [];
  (elements || []).forEach(el => {
    const f = featureOf(el);
    if (!f || seen.has(f.properties.id)) return;
    seen.add(f.properties.id);
    features.push(f);
  });
  return { type: 'FeatureCollection', features };
}

const ATTEMPT_MS = 12000;
const BUDGET_MS = 48000;

const QUERY = `[out:json][timeout:40];
(
  node["railway"~"^(station|halt|tram_stop)$"](${BBOX});
  way["railway"~"^(rail|light_rail|subway|narrow_gauge|tram)$"](${BBOX});
  way["waterway"~"^(river|canal)$"](${BBOX});
  node["amenity"="ferry_terminal"](${BBOX});
);
out tags geom;`;

async function fetchOverpass() {
  let last = null;
  const started = Date.now();
  for (const url of OVERPASS_URLS) {
    const left = BUDGET_MS - (Date.now() - started);
    if (left < 2000) break;
    try {
      const res = await axios.post(url, `data=${encodeURIComponent(QUERY)}`, {
        timeout: Math.min(ATTEMPT_MS, left),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'qh-hue/osm-open' },
        maxContentLength: 25_000_000,
        maxBodyLength: 25_000_000,
        validateStatus: () => true
      });
      if (res.status === 200 && res.data && Array.isArray(res.data.elements)) return res.data.elements;
      last = new Error(`Overpass HTTP ${res.status}`);
    } catch (err) {
      last = err;
    }
  }
  const e = new Error(last && last.message ? `Không tải được OpenStreetMap: ${last.message}` : 'Không tải được OpenStreetMap');
  e.status = 502;
  throw e;
}

let cache = null;

async function loadOsmOpen() {
  if (cache && Date.now() - cache.at < 6 * 60 * 60 * 1000) return cache.data;
  const elements = await fetchOverpass();
  const fc = collection(elements);
  const count = (group) => fc.features.filter(f => f.properties.group === group).length;
  const data = {
    source: 'OpenStreetMap',
    via: 'Overpass API',
    at: new Date().toISOString(),
    bbox: BBOX,
    note: 'OSM do cộng đồng vẽ, chưa đủ so với thực địa. Huế chưa có đường sắt đô thị; sông kênh là tuyến nước, không phải tuyến tàu thủy hành khách.',
    counts: { rail: count('rail'), railStop: count('railStop'), water: count('water'), ferry: count('ferry') },
    geojson: fc
  };
  cache = { at: Date.now(), data };
  return data;
}

module.exports = { featureOf, collection, loadOsmOpen, haversineKm, RAIL_VI, ATTEMPT_MS, BUDGET_MS, QUERY };
