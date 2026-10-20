// Nhập công trình thể thao OpenStreetMap vào tab 8-VH (nhà văn hóa, thể thao hiện trạng).
// Cột: Ten_CongTrinh, Nhom_HaTang, Ten_XaPhuong, Latitude, Longitude (tâm), QuyMo_HT (m² nếu vùng),
// TrangThai = TRUE, Note = nguồn OSM + mã OSM.
// Trùng khi Note đã có cùng mã OSM, hoặc cùng tên (bỏ dấu) và cách nhau < 80 m.
// Chạy: node scripts/import-osm-sports.js
// Có GAS_BASE_URL + GAS_SECRET thì ghi Sheet (Apps Script phải là bản osm-vh-1). Không có thì ghi CSV/JSON.
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const turf = require('@turf/turf');
const constants = require('../config/constants');
const { loadEnv, postAction } = require('./gasClient');
const { loadBoundary } = require('./wardBoundary');
const sports = require('../services/osmSports');

const BBOX = '15.9,106.9,16.9,108.3';
const OVERPASS_URLS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const QUERY = `[out:json][timeout:90][bbox:${BBOX}];
(
  nwr["leisure"~"^(sports_centre|pitch|stadium|track|fitness_centre|swimming_pool|golf_course)$"];
);
out geom;`;
const OUT_DIR = path.join(__dirname, 'data');
const CSV_PATH = path.join(OUT_DIR, 'osm-sports-8vh.csv');
const JSON_PATH = path.join(OUT_DIR, 'osm-sports-8vh.json');
const ART_DIR = process.env.OSM_SPORT_OUT || '/opt/cursor/artifacts';
const BATCH = 200;

function sheetWard(ward) {
  return String(ward || '').replace(/^\s*(Phường|Xã|Thị trấn)\s+/i, '').trim();
}

function wardAt(fc, lng, lat) {
  const pt = turf.point([lng, lat]);
  for (const f of fc.features || []) {
    if (!f || !f.geometry) continue;
    let box;
    try { box = turf.bbox(f); } catch (e) { continue; }
    if (lng < box[0] || lng > box[2] || lat < box[1] || lat > box[3]) continue;
    try {
      if (turf.booleanPointInPolygon(pt, f)) {
        const p = f.properties || {};
        return p.tenXa || p.NAME_2 || p.name || '';
      }
    } catch (e) { /* vòng lỗi */ }
  }
  return '';
}

async function fetchElements() {
  let last = null;
  for (const url of OVERPASS_URLS) {
    try {
      const res = await axios.post(url, `data=${encodeURIComponent(QUERY)}`, {
        timeout: 100000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'qh-hue/osm-sports' },
        maxContentLength: 40_000_000,
        maxBodyLength: 40_000_000,
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

async function loadExisting() {
  const res = await axios.get(constants.GCS_URL, { timeout: 120000, maxContentLength: 80_000_000 });
  const features = (res.data && res.data.features) || [];
  const rows = [];
  features.forEach(ft => {
    const p = ft.properties || {};
    const id = String(p.ID_DoiTuong || '');
    const tab = String(p.Tab || '');
    if (!id.startsWith('VH') && !tab.startsWith('8-VH')) return;
    const coords = ft.geometry && ft.geometry.coordinates;
    rows.push({
      id,
      name: p.Ten_CongTrinh || '',
      lat: coords ? Number(coords[1]) : null,
      lng: coords ? Number(coords[0]) : null,
      note: String(p.GhiChu || p.Note || '')
    });
  });
  return rows;
}

function nextIds(existing, n) {
  let max = 0;
  existing.forEach(it => {
    const m = String(it.id || '').match(/^VH-(\d+)/i);
    if (m) max = Math.max(max, Number(m[1]));
  });
  const ids = [];
  for (let i = 1; i <= n; i++) {
    const num = max + i;
    ids.push(`VH-${num < 1000 ? String(num).padStart(3, '0') : String(num)}`);
  }
  return ids;
}

function csvCell(value) {
  const s = String(value == null ? '' : value);
  if (/[",\n\r]/.test(s) || /^[=+\-@]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const CSV_HEADERS = ['ID_DoiTuong', 'Ten_CongTrinh', 'Ten_XaPhuong', 'Nhom_HaTang', 'Latitude', 'Longitude',
  'QuyMo_HT', 'QuyMo_QH', 'Ten_QH', 'TrangThai', 'ThoiGianCapNhat', 'Note', 'Geojson', 'TangCao', 'MatDoXD', 'HeSoSDD', 'KyHieu'];

function writeFiles(rows) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const lines = [CSV_HEADERS.join(',')];
  rows.forEach(r => lines.push(CSV_HEADERS.map(h => csvCell(r[h])).join(',')));
  const csv = `${lines.join('\n')}\n`;
  fs.writeFileSync(CSV_PATH, csv);
  fs.writeFileSync(JSON_PATH, JSON.stringify(rows, null, 2));
  try {
    fs.mkdirSync(ART_DIR, { recursive: true });
    fs.writeFileSync(path.join(ART_DIR, 'osm-sports-8vh.csv'), csv);
    fs.writeFileSync(path.join(ART_DIR, 'osm-sports-8vh.json'), JSON.stringify(rows, null, 2));
  } catch (e) { /* thư mục artifact không có */ }
}

function sheetRows(kept, ids) {
  const now = new Date();
  const stamp = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', hour12: false,
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(now);
  return kept.map((it, i) => ({
    ID_DoiTuong: ids[i],
    Ten_CongTrinh: it.name,
    Ten_XaPhuong: it.ward,
    Nhom_HaTang: it.nhom,
    Latitude: `'${it.lat}`,
    Longitude: `'${it.lng}`,
    QuyMo_HT: it.size || 0,
    QuyMo_QH: '',
    Ten_QH: '',
    TrangThai: 'TRUE',
    ThoiGianCapNhat: stamp,
    Note: it.note,
    Geojson: '',
    TangCao: '',
    MatDoXD: '',
    HeSoSDD: '',
    KyHieu: ''
  }));
}

async function writeGas(kept) {
  loadEnv();
  if (!process.env.GAS_BASE_URL || !process.env.GAS_SECRET) {
    return { wrote: false, reason: 'Thiếu GAS_BASE_URL / GAS_SECRET' };
  }
  let ver;
  try {
    ver = await postAction('scriptVersion', { action: 'scriptVersion' });
  } catch (err) {
    return { wrote: false, reason: err.message };
  }
  if (!ver || ver.script !== 'osm-vh-1') {
    return { wrote: false, reason: `Apps Script trả script=${ver && ver.script}, cần osm-vh-1` };
  }
  let created = 0;
  let skipped = 0;
  const sheets = [];
  for (let i = 0; i < kept.length; i += BATCH) {
    const items = kept.slice(i, i + BATCH).map(it => ({
      type: '8-VH',
      name: it.name,
      ward: it.ward,
      lat: it.lat,
      lng: it.lng,
      size: it.size || 0,
      radius: it.radius,
      ref: it.ref,
      nhom: it.nhom,
      note: it.note,
      approved: true
    }));
    const res = await postAction('addPendingPoints', { action: 'addPendingPoints', items });
    if (res.script !== 'osm-vh-1') {
      return { wrote: false, reason: 'Apps Script ghi điểm nhưng không phải bản osm-vh-1 — dừng, không gửi tiếp', created, skipped };
    }
    created += Number(res.created) || 0;
    skipped += Number(res.skipped) || 0;
    (res.sheets || []).forEach(s => sheets.push(s));
  }
  return { wrote: true, created, skipped, sheets };
}

function tally(skipped) {
  const out = { 'osm-id': 0, 'name-distance': 0, 'generic-near': 0, coord: 0 };
  skipped.forEach(s => { if (out[s.reason] != null) out[s.reason]++; });
  return out;
}

async function main() {
  const [elements, boundary, existing] = await Promise.all([
    fetchElements(),
    loadBoundary(),
    loadExisting()
  ]);
  const inside = [];
  let outside = 0;
  elements.forEach(el => {
    const item = sports.itemFromElement(el);
    if (!item) return;
    const wardFull = wardAt(boundary, item.lng, item.lat);
    if (!wardFull) { outside++; return; }
    item.ward = sheetWard(wardFull);
    item.nhomHaTang = item.nhom;
    item.radius = constants.standardRadius(item, constants.wardProfile(wardFull));
    inside.push(item);
  });
  const { kept, skipped } = sports.dedupeSports(inside, existing);
  const ids = nextIds(existing, kept.length);
  const rows = sheetRows(kept, ids);
  writeFiles(rows);
  const gas = kept.length ? await writeGas(kept) : { wrote: false, reason: 'Không có dòng mới' };
  const summary = {
    osmElements: elements.length,
    inWards: inside.length,
    outside,
    existing8vh: existing.length,
    added: gas.wrote ? gas.created : 0,
    ready: kept.length,
    skipped: skipped.length,
    skipReasons: tally(skipped),
    gas,
    csv: CSV_PATH,
    json: JSON_PATH
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
