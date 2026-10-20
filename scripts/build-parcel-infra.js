// Dựng sổ hạ tầng từ thửa đất 2016 + OSM + ranh 40 phường/xã.
// Chạy: node scripts/build-parcel-infra.js
// Mỗi dòng CSV phải có diện tích (m² và ha), tên phường/xã và tên công trình; thiếu thì thoát mã 1.
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const turf = require('@turf/turf');
const constants = require('../config/constants');
const inv = require('../services/parcelInfraInventory');
const { loadBoundary } = require('./wardBoundary');

const BASE = constants.CADASTRE_GCS_BASE;
const PMTILES_URL = `${BASE}thuadat-2016.pmtiles`;
const INDEX_URL = `${BASE}index/`;
const OUT_DIR = path.join(__dirname, 'data', 'parcel-infra');
const Z = 16;
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.osm.ch/api/interpreter'
];
const OVERPASS_Q = `[out:json][timeout:180][bbox:15.9,106.9,16.9,108.3];
(
  nwr["amenity"~"^(school|kindergarten|childcare|college|university|hospital|clinic|doctors|dentist|pharmacy|marketplace|community_centre|arts_centre|theatre|library|social_facility)$"];
  nwr["leisure"~"^(park|playground|garden|pitch|sports_centre|stadium|track|fitness_centre|swimming_pool)$"];
);
out geom;`;
const TAB_PREFIX = {
  '1-CV': 'CV', '3-MN': 'MN', '4-TH': 'TH', '5-THCS': 'THCS', '6-THPT': 'THPT',
  '7-YT': 'YT', '8-VH': 'VH', '9-TM': 'TM'
};
const TAB_FILES = ['1-CV', '3-MN', '4-TH', '5-THCS', '6-THPT', '7-YT', '8-VH', '9-TM'];

function placesKey() {
  return process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY
    || process.env.PLACES_API_KEY || process.env.GOOGLE_API_KEY || process.env.MAPS_API_KEY || '';
}

async function pool(items, n, fn) {
  let cursor = 0;
  const workers = Array.from({ length: n }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

function xyz(lng, lat, z) {
  const n = 2 ** z;
  const x = Math.min(n - 1, Math.max(0, Math.floor(((lng + 180) / 360) * n)));
  const rad = lat * Math.PI / 180;
  const y = Math.min(n - 1, Math.max(0, Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n)));
  return { x, y };
}

function parcelKey(maxa, to, thua) {
  return `${String(maxa).trim()}|${String(to).trim()}|${String(thua).trim()}`;
}

function outerRings(feature) {
  const g = feature && feature.geometry;
  if (!g) return [];
  if (g.type === 'Polygon') return g.coordinates[0] ? [g.coordinates[0]] : [];
  if (g.type === 'MultiPolygon') return g.coordinates.map(p => p[0]).filter(Boolean);
  return [];
}

function measureUnion(features) {
  const polys = [];
  features.forEach(f => {
    try {
      if (!f || !f.geometry) return;
      if (turf.area(f) > 0) polys.push(f);
    } catch (e) { /* vòng không hợp lệ */ }
  });
  if (!polys.length) return null;
  if (polys.length === 1) return polys[0];
  try {
    return turf.union(turf.featureCollection(polys));
  } catch (e) {
    return null;
  }
}

async function loadIndexes() {
  const xaList = await getJson(`${INDEX_URL}xa.json`);
  const xas = Array.isArray(xaList) ? xaList : (xaList.xa || []);
  const byKey = new Map();
  let indexRows = 0;
  await pool(xas, 8, async (xa) => {
    const idx = await getJson(`${INDEX_URL}${encodeURIComponent(xa.maxa)}.json`);
    (idx.rows || []).forEach(r => {
      if (!r || r.length < 6) return;
      const code = inv.primaryCode(r[5]);
      if (!code) return;
      indexRows++;
      const raw = String(r[5] || '').trim();
      const key = parcelKey(xa.maxa, r[0], r[1]);
      const row = {
        key,
        maxa: xa.maxa,
        to: r[0],
        thua: r[1],
        lng: Number(r[2]),
        lat: Number(r[3]),
        attrArea: Number(r[4]) || 0,
        codeRaw: raw,
        code
      };
      const prev = byKey.get(key);
      if (!prev || row.attrArea > prev.attrArea) byKey.set(key, row);
    });
  });
  const parcels = [...byKey.values()];
  const byRaw = {};
  const byCode = {};
  parcels.forEach(p => {
    byRaw[p.codeRaw] = (byRaw[p.codeRaw] || 0) + 1;
    byCode[p.code] = (byCode[p.code] || 0) + 1;
  });
  return { parcels, byRaw, byCode, communes: xas.length, indexRows, duplicateIndexRows: indexRows - parcels.length };
}

async function loadGeometry(parcels) {
  const { PMTiles } = require('pmtiles');
  const { VectorTile } = require('@mapbox/vector-tile');
  const Pbf = require('pbf');
  const archive = new PMTiles(PMTILES_URL);
  const header = await archive.getHeader();
  console.log(`PMTiles zoom ${header.minZoom}-${header.maxZoom}, ${parcels.length} thửa hạ tầng`);
  const wanted = new Set(parcels.map(p => p.key));
  const tileIds = new Set();
  parcels.forEach(p => {
    if (!Number.isFinite(p.lng) || !Number.isFinite(p.lat)) return;
    const span = p.attrArea > 20000 ? 2 : 1;
    const c = xyz(p.lng, p.lat, Z);
    for (let dx = -span; dx <= span; dx++) {
      for (let dy = -span; dy <= span; dy++) tileIds.add(`${c.x + dx}/${c.y + dy}`);
    }
  });
  const ids = [...tileIds];
  console.log(`Đọc ${ids.length} tile z${Z}`);
  const bags = new Map();
  let done = 0;
  let empty = 0;
  await pool(ids, 10, async (id) => {
    const [x, y] = id.split('/').map(Number);
    let resp;
    try {
      resp = await archive.getZxy(Z, x, y);
    } catch (err) {
      empty++;
      return;
    }
    done++;
    if (done % 400 === 0) console.log(`  tile ${done}/${ids.length}`);
    if (!resp || !resp.data) { empty++; return; }
    let tile;
    try {
      tile = new VectorTile(new Pbf(resp.data));
    } catch (err) {
      empty++;
      return;
    }
    const layer = tile.layers.thuadat;
    if (!layer) return;
    for (let i = 0; i < layer.length; i++) {
      const feat = layer.feature(i);
      const props = feat.properties || {};
      const key = parcelKey(props.m, props.t, props.s);
      if (!wanted.has(key)) continue;
      let gj;
      try { gj = feat.toGeoJSON(x, y, Z); } catch (err) { continue; }
      if (!gj || (gj.geometry.type !== 'Polygon' && gj.geometry.type !== 'MultiPolygon')) continue;
      const bag = bags.get(key) || { features: [], diachi: '' };
      bag.features.push(gj);
      const d = String(props.d || '').trim();
      if (d.length > bag.diachi.length) bag.diachi = d;
      bags.set(key, bag);
    }
  });
  let withGeom = 0;
  parcels.forEach(p => {
    const bag = bags.get(p.key);
    p.diachi = bag ? bag.diachi : '';
    const union = bag ? measureUnion(bag.features) : null;
    if (!union) {
      p.geomArea = 0;
      p.rings = [];
      return;
    }
    try {
      p.geomArea = turf.area(union);
    } catch (err) {
      p.geomArea = 0;
    }
    p.rings = outerRings(union);
    if (p.geomArea > 0) withGeom++;
  });
  console.log(`Hình học: ${withGeom}/${parcels.length} thửa, tile rỗng hoặc lỗi ${empty}`);
  return { withGeom, tiles: ids.length };
}

async function fetchOverpass(query) {
  let last = null;
  for (const url of OVERPASS_URLS) {
    try {
      const res = await axios.post(url, `data=${encodeURIComponent(query)}`, {
        timeout: 190000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'qh-hue/parcel-infra' },
        maxContentLength: 80_000_000,
        maxBodyLength: 2_000_000,
        validateStatus: () => true
      });
      if (res.status === 200 && res.data && Array.isArray(res.data.elements)) return res.data.elements;
      last = new Error(`Overpass HTTP ${res.status} (${url})`);
    } catch (err) {
      last = err;
    }
  }
  throw last || new Error('Không tải được OpenStreetMap');
}

async function loadPois() {
  try {
    const elements = await fetchOverpass(OVERPASS_Q);
    const pois = elements.map(inv.poiFromElement).filter(Boolean);
    console.log(`OSM geom: ${elements.length} phần tử, ${pois.length} điểm phù hợp`);
    return { pois, mode: 'geom', error: '' };
  } catch (err) {
    console.warn('OSM out geom lỗi, thử out center:', err.message);
  }
  try {
    const elements = await fetchOverpass(OVERPASS_Q.replace('out geom;', 'out center;'));
    const pois = elements.map(inv.poiFromElement).filter(Boolean);
    console.log(`OSM center: ${elements.length} phần tử, ${pois.length} điểm phù hợp`);
    return { pois, mode: 'center', error: '' };
  } catch (err) {
    console.warn('OSM không tải được:', err.message);
    return { pois: [], mode: 'none', error: err.message };
  }
}

function wardLookup(fc) {
  const wards = (fc.features || []).map(f => {
    let box = null;
    try { box = turf.bbox(f); } catch (e) { return null; }
    const p = f.properties || {};
    const name = p.tenXa || p.NAME_2 || p.name || '';
    if (!name) return null;
    return { name, box, feature: f };
  }).filter(Boolean);
  return (lng, lat) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return '';
    const pt = turf.point([lng, lat]);
    for (const w of wards) {
      if (lng < w.box[0] || lng > w.box[2] || lat < w.box[1] || lat > w.box[3]) continue;
      try {
        if (turf.booleanPointInPolygon(pt, w.feature)) return w.name;
      } catch (e) { /* vòng lỗi */ }
    }
    return '';
  };
}

async function loadExisting() {
  const res = await axios.get(constants.GCS_URL, { timeout: 120000, maxContentLength: 80_000_000 });
  const features = (res.data && res.data.features) || [];
  return features.map(ft => {
    const p = ft.properties || {};
    const coords = ft.geometry && ft.geometry.coordinates;
    const id = String(p.ID_DoiTuong || '');
    return {
      id,
      name: p.Ten_CongTrinh || '',
      lat: coords ? Number(coords[1]) : null,
      lng: coords ? Number(coords[0]) : null,
      type: inv.existingTypeOf(id, p.Tab),
      note: String(p.GhiChu || p.Note || '')
    };
  });
}

async function fillPlaces(parcels) {
  const key = placesKey();
  if (!key) return { status: 'không có khóa API', asked: 0, named: 0 };
  const pending = parcels.filter(p => {
    if (p.osm && p.osm.name) return false;
    if (inv.attributeName(p)) return false;
    return Number.isFinite(p.lat) && Number.isFinite(p.lng);
  }).slice(0, 200);
  let named = 0;
  await pool(pending, 2, async (p) => {
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${p.lat},${p.lng}&radius=30&language=vi&key=${encodeURIComponent(key)}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const data = await res.json();
      const name = inv.pickPlacesName(data.results, p.code);
      if (name) { p.placesName = name; named++; }
    } catch (err) { /* bỏ qua một điểm, không bịa tên */ }
  });
  const capped = parcels.filter(p => !(p.osm && p.osm.name) && !inv.attributeName(p)).length > 200;
  return { status: capped ? 'đã hỏi 200 điểm (trần), còn điểm chưa hỏi' : 'đã hỏi Places API', asked: pending.length, named };
}

function stampNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());
  const g = (t) => parts.find(p => p.type === t).value;
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}:${g('second')}`;
}

function formatId(prefix, num) {
  return `${prefix}-${num < 1000 ? String(num).padStart(3, '0') : String(num)}`;
}

function assignIds(rows, existing) {
  const max = {};
  Object.values(TAB_PREFIX).forEach(prefix => { max[prefix] = 0; });
  existing.forEach(it => {
    const m = String(it.id || '').match(/^([A-Z]+)-(\d+)/i);
    if (!m) return;
    const prefix = m[1].toUpperCase();
    if (max[prefix] == null) return;
    max[prefix] = Math.max(max[prefix], Number(m[2]));
  });
  const give = (row) => {
    const prefix = TAB_PREFIX[row.type];
    if (!prefix) return '';
    max[prefix] += 1;
    return formatId(prefix, max[prefix]);
  };
  const byTab = {};
  TAB_FILES.forEach(tab => { byTab[tab] = []; });
  rows.forEach(row => {
    if (!byTab[row.type]) return;
    row.id = give(row);
    byTab[row.type].push(row);
  });
  return byTab;
}

function writeCsv(file, rows, stamp) {
  const lines = [inv.CSV_HEADERS.join(',')];
  rows.forEach(row => lines.push(inv.csvRow(row, row.id, stamp)));
  fs.writeFileSync(file, `\uFEFF${lines.join('\n')}\n`, 'utf8');
}

function publicRow(row) {
  const out = { ...row };
  delete out.rings;
  return out;
}

async function main() {
  console.log('Tải chỉ mục thửa...');
  const { parcels, byRaw, byCode, communes, indexRows, duplicateIndexRows } = await loadIndexes();
  console.log(`${communes} xã, ${indexRows} dòng chỉ mục, ${parcels.length} thửa (bỏ ${duplicateIndexRows} dòng trùng tờ/thửa)`);
  if (parcels.length < 100) {
    throw new Error(`Chỉ lọc được ${parcels.length} thửa — kiểm tra chỉ mục hoặc mã đất`);
  }
  console.log('Theo mã:', byCode);

  const geom = await loadGeometry(parcels);
  if (geom.withGeom < parcels.length * 0.4) {
    throw new Error(`Hình học chỉ khôi phục ${geom.withGeom}/${parcels.length} thửa — không xuất sổ chỉ dựa vào diện tích thuộc tính`);
  }

  console.log('Tải ranh 40 phường/xã...');
  const boundary = await loadBoundary(process.env.BOUNDARY_FILE || '');
  const wardAt = wardLookup(boundary);
  let outside = 0;
  parcels.forEach(p => {
    p.ward = wardAt(p.lng, p.lat);
    if (!p.ward) outside++;
  });
  console.log(`Ngoài ranh 40 phường/xã: ${outside}`);

  console.log('Tải OpenStreetMap...');
  const osm = await loadPois();
  const index = inv.buildPoiIndex(osm.pois);
  let osmHits = 0;
  parcels.forEach(p => {
    if (!p.ward) return;
    p.osm = inv.bestOsmMatch(p, index);
    if (p.osm) osmHits++;
  });
  console.log(`Khớp OSM: ${osmHits}`);

  console.log('Tải hạ tầng hiện có...');
  const existing = await loadExisting();
  const places = await fillPlaces(parcels);
  console.log('Google Places:', places.status);

  const { rows, training, stats } = inv.assembleInventory(parcels, { existing });
  const audit = inv.auditOutputRows([...rows, ...training]);
  if (audit.blankName || audit.blankWard || audit.blankArea || audit.blankHa) {
    console.error(audit);
    throw new Error('Có dòng thiếu diện tích, phường/xã hoặc tên');
  }
  const validation = inv.validateRows([...rows, ...training]);
  Object.keys(constants.WARD_AREA_KM2).forEach(name => {
    if (stats.byWard[name] == null) stats.byWard[name] = 0;
  });

  const stamp = stampNow();
  const byTab = assignIds(rows, existing);
  training.forEach(row => {
    const prefix = 'THPT';
    const prev = rows.filter(r => r.type === '6-THPT').length;
    const maxExisting = existing.reduce((m, it) => {
      const hit = String(it.id || '').match(/^THPT-(\d+)/i);
      return hit ? Math.max(m, Number(hit[1])) : m;
    }, 0);
    row.id = formatId('THPT', maxExisting + prev + training.indexOf(row) + 1);
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  TAB_FILES.forEach(tab => writeCsv(path.join(OUT_DIR, `${tab}.csv`), byTab[tab] || [], stamp));
  writeCsv(path.join(OUT_DIR, 'DGD-dao-tao.csv'), training, stamp);

  const summary = {
    generatedAt: stamp,
    source: inv.SOURCE,
    parcels: parcels.length,
    indexRows,
    duplicateIndexRows,
    parcelsByCode: byCode,
    parcelsByRaw: byRaw,
    geometryRecovered: geom.withGeom,
    geometryTiles: geom.tiles,
    outsideWardParcels: outside,
    osmMode: osm.mode,
    osmError: osm.error,
    osmHits,
    googlePlaces: places.status,
    googlePlacesAsked: places.asked,
    googlePlacesNamed: places.named,
    ...stats,
    validation,
    audit,
    note: 'Không vừa dán CSV vừa bấm Ghi trong Admin. Cơ sở đào tạo nằm ở DGD-dao-tao.csv, không ghi Sheet trừ khi chọn ô tương ứng.'
  };
  const payload = {
    summary,
    rows: [...rows, ...training].map(publicRow)
  };
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'rows.json'), JSON.stringify(payload));
  const art = '/opt/cursor/artifacts';
  try {
    fs.mkdirSync(art, { recursive: true });
    fs.writeFileSync(path.join(art, 'parcel-infra-summary.json'), JSON.stringify(summary, null, 2));
  } catch (err) { /* thư mục artifact không có thì bỏ qua */ }
  console.log(JSON.stringify({
    facilities: stats.facilities,
    matchedOsm: stats.matchedOsm,
    matchedAttribute: stats.matchedAttribute,
    matchedGoogle: stats.matchedGoogle,
    unnamed: stats.unnamed,
    duplicatesSkipped: stats.duplicatesSkipped,
    outsideWard: stats.outsideWard,
    missingAreaExcluded: stats.missingAreaExcluded,
    geometryFallback: stats.geometryFallback,
    capChuaXacDinh: stats.capChuaXacDinh,
    daoTao: stats.daoTao,
    byTab: stats.byTab,
    validation
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
