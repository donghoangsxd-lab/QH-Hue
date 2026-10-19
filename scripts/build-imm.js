// Chỉ tiêu hình thái 40 phường xã (gợi ý 4 nhóm IMM: khối, khoảng trống, chức năng, liên kết).
// Nguồn mở: OpenStreetMap (Overpass) + ranh/dân số phường xã + diện tích chính thức.
// Google Open Buildings không tải trong script này (OSM đã có dấu chân nhà dạng way).
const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');
const constants = require('../config/constants');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'public/data/imm.json');
const CACHE = '/tmp/imm-osm';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const BOUNDARY_URL = process.env.BOUNDARY_URL || 'https://web-hatang-hue-4.vercel.app/api/gee?action=getBoundaryVector&v=2';
const BBOX = '15.9,106.9,16.9,108.3';
const HW = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street';

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
const coreName = (s) => fold(s).replace(/^(phuong|xa|thi tran)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const wards = Object.keys(constants.WARD_AREA_KM2);
const byCore = new Map(wards.map(w => [coreName(w), w]));
const named = (raw) => byCore.get(coreName(raw)) || null;

function ringArea(coords) {
  if (!coords || coords.length < 4) return 0;
  const a = coords[0], b = coords[coords.length - 1];
  if (Math.abs(a[0] - b[0]) > 1e-6 || Math.abs(a[1] - b[1]) > 1e-6) return 0;
  try { return turf.area(turf.polygon([coords])); }
  catch (e) { return 0; }
}

function pathLength(coords) {
  let m = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i];
    const dx = (b[0] - a[0]) * 111320 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
    const dy = (b[1] - a[1]) * 110540;
    m += Math.hypot(dx, dy);
  }
  return m;
}

function wardIndex(features) {
  return (features || []).map(f => {
    const name = named((f.properties || {}).tenXa || '');
    let bbox = null;
    try { bbox = turf.bbox(f); } catch (e) { bbox = null; }
    return { name, feature: f, bbox };
  }).filter(w => w.name && w.bbox);
}

function bboxHit(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

function locateFactory(features) {
  const boxes = (features || []).map(f => {
    const name = named((f.properties || {}).tenXa || '');
    let bbox = null;
    try { bbox = turf.bbox(f); } catch (e) { bbox = null; }
    return { name, feature: f, bbox };
  }).filter(w => w.name && w.bbox);
  return (lng, lat) => {
    for (const w of boxes) {
      const [x0, y0, x1, y1] = w.bbox;
      if (lng < x0 || lng > x1 || lat < y0 || lat > y1) continue;
      if (turf.booleanPointInPolygon(turf.point([lng, lat]), w.feature)) return w.name;
    }
    return null;
  };
}

function wayCoords(el) {
  if (Array.isArray(el.geometry) && el.geometry.length) return el.geometry.map(p => [p.lon, p.lat]);
  return null;
}

function centroid(coords) {
  let x = 0, y = 0;
  const n = Math.max(1, coords.length - (coords.length > 1 && coords[0][0] === coords[coords.length - 1][0] ? 1 : 0));
  for (let i = 0; i < n; i++) { x += coords[i][0]; y += coords[i][1]; }
  return [x / n, y / n];
}

function landClass(tags) {
  const lu = tags.landuse || '';
  const leisure = tags.leisure || '';
  const natural = tags.natural || '';
  if (lu === 'forest' || lu === 'orchard' || natural === 'wood' || natural === 'scrub') return 'cay';
  if (['grass', 'meadow', 'village_green', 'recreation_ground', 'greenfield'].includes(lu) || ['park', 'garden', 'nature_reserve'].includes(leisure) || natural === 'grassland') return 'mo';
  if (lu === 'reservoir' || lu === 'basin' || natural === 'water' || natural === 'wetland') return 'nuoc';
  if (lu === 'residential' || lu === 'garages') return 'o';
  if (lu === 'commercial' || lu === 'retail' || lu === 'marketplace') return 'dv';
  if (['industrial', 'railway', 'quarry', 'landfill', 'construction'].includes(lu)) return 'sx';
  if (lu === 'farmland' || lu === 'farmyard' || lu === 'vineyard') return 'nn';
  if (lu || leisure || natural) return 'khac';
  return null;
}

async function overpass(name, query) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `${name}.json`);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) {
    console.log('cache', name);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'User-Agent': 'QH-Hue-planning-map/1.0', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(240000)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Overpass ${name} HTTP ${res.status}: ${text.slice(0, 180)}`);
  fs.writeFileSync(file, text);
  console.log('tải', name, text.length);
  return JSON.parse(text);
}

function blank() {
  return Object.fromEntries(wards.map(w => [w, { bldgM2: 0, bldgN: 0, greenM2: 0, openM2: 0, classes: {}, roadM: 0, junction: 0, stop: 0 }]));
}

async function main() {
  const boundary = await (await fetch(BOUNDARY_URL, { signal: AbortSignal.timeout(90000) })).json();
  const wardsGeom = wardIndex(boundary.features || []);
  const locate = locateFactory(boundary.features || []);
  const shareArea = (coords, fn) => {
    let feat;
    try { feat = turf.polygon([coords]); } catch (e) { return; }
    const bb = turf.bbox(feat);
    for (const w of wardsGeom) {
      if (!bboxHit(bb, w.bbox)) continue;
      let part = null;
      try { part = turf.intersect(turf.featureCollection([feat, w.feature])); }
      catch (e) { part = null; }
      if (!part) continue;
      const area = turf.area(part);
      if (area > 1) fn(w.name, area);
    }
  };
  const pop = {};
  for (const f of boundary.features || []) {
    const name = named((f.properties || {}).tenXa || '');
    const n = Number((f.properties || {}).danSoNum || (f.properties || {}).danSo);
    if (name && n > 0) pop[name] = n;
  }
  const acc = blank();
  const add = (ward, fn) => { if (ward && acc[ward]) fn(acc[ward]); };

  const buildings = await overpass('buildings', `[out:json][timeout:180];way["building"](${BBOX});out geom;`);
  const osmDate = (buildings.osm3s && buildings.osm3s.timestamp_osm_base) || '';
  let bldgSkip = 0;
  for (const el of buildings.elements || []) {
    const coords = wayCoords(el);
    if (!coords) { bldgSkip++; continue; }
    const area = ringArea(coords);
    if (!(area >= 8 && area <= 2000000)) { bldgSkip++; continue; }
    const [lng, lat] = centroid(coords);
    add(locate(lng, lat), row => { row.bldgM2 += area; row.bldgN++; });
  }

  const land = await overpass('landuse', `[out:json][timeout:180];(way["landuse"](${BBOX});way["leisure"~"^(park|garden|nature_reserve)$"](${BBOX});way["natural"~"^(wood|scrub|water|wetland|grassland)$"](${BBOX}););out geom;`);
  for (const el of land.elements || []) {
    const cls = landClass(el.tags || {});
    const coords = wayCoords(el);
    if (!cls || !coords) continue;
    const area = ringArea(coords);
    if (!(area >= 50 && area <= 5e8)) continue;
    shareArea(coords, (ward, part) => add(ward, row => {
      row.classes[cls] = (row.classes[cls] || 0) + part;
      if (cls === 'cay' || cls === 'mo') row.greenM2 += part;
      if (cls === 'cay' || cls === 'mo' || cls === 'nuoc') row.openM2 += part;
    }));
  }

  const roads = await overpass('roads', `[out:json][timeout:180];way["highway"~"^(${HW})$"](${BBOX});out geom;`);
  const degree = new Map();
  const nodeWard = new Map();
  for (const el of roads.elements || []) {
    const coords = wayCoords(el);
    if (!coords || coords.length < 2) continue;
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1], b = coords[i];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const ward = locate(mid[0], mid[1]);
      if (!ward) continue;
      const dx = (b[0] - a[0]) * 111320 * Math.cos(mid[1] * Math.PI / 180);
      const dy = (b[1] - a[1]) * 110540;
      acc[ward].roadM += Math.hypot(dx, dy);
    }
    const ids = el.nodes || [];
    ids.forEach((id, i) => {
      degree.set(id, (degree.get(id) || 0) + 1);
      if (!nodeWard.has(id) && el.geometry && el.geometry[i]) nodeWard.set(id, el.geometry[i]);
    });
  }
  for (const [id, n] of degree) {
    if (n < 3) continue;
    const p = nodeWard.get(id);
    if (!p) continue;
    add(locate(p.lon, p.lat), row => { row.junction++; });
  }

  const stops = await overpass('stops', `[out:json][timeout:90];(node["highway"="bus_stop"](${BBOX});node["public_transport"~"^(platform|stop_position|station)$"](${BBOX});node["railway"~"^(station|halt)$"](${BBOX}););out;`);
  for (const el of stops.elements || []) {
    if (el.lat == null || el.lon == null) continue;
    add(locate(el.lon, el.lat), row => { row.stop++; });
  }

  const rows = wards.map(name => {
    const a = acc[name];
    const km2 = constants.WARD_AREA_KM2[name];
    const m2 = km2 * 1e6;
    const parts = Object.values(a.classes).filter(v => v > 0);
    const total = parts.reduce((s, v) => s + v, 0);
    let mix = null;
    if (parts.length >= 2 && total > 0) {
      mix = -parts.reduce((s, v) => { const p = v / total; return s + p * Math.log(p); }, 0);
      mix = Math.round(mix * 100) / 100;
    }
    const round = (v, d = 10) => Math.round(v * d) / d;
    return {
      name,
      areaKm2: km2,
      pop: pop[name] || null,
      bldgCover: round(a.bldgM2 / m2 * 100, 100),
      bldgDens: round(a.bldgN / km2, 10),
      green: round(a.greenM2 / m2 * 100, 100),
      mix,
      road: round(a.roadM / 1000 / km2, 100),
      junction: round(a.junction / km2, 10),
      transit: round(a.stop / km2 * 10, 10),
      stops: a.stop
    };
  });

  const doc = {
    built: '2026-10-19',
    osmDate: osmDate.slice(0, 10),
    framework: 'Bốn nhóm gợi ý từ IMM (khối, khoảng trống, chức năng, liên kết) — chỉ số ước tính từ dữ liệu mở, không phải bộ chỉ tiêu chính thức của IMM.',
    indicators: [
      { id: 'bldgCover', group: 'Khối', name: 'Độ phủ công trình', unit: '% diện tích', source: `Diện tích way building OpenStreetMap / diện tích phường. OSM ${osmDate.slice(0, 10)}. Bỏ relation multipolygon.` },
      { id: 'bldgDens', group: 'Khối', name: 'Mật độ công trình', unit: 'nhà/km²', source: `Số way building OSM / km². OSM ${osmDate.slice(0, 10)}.` },
      { id: 'green', group: 'Khoảng trống', name: 'Tỷ lệ cây và đất mở', unit: '% diện tích', source: `landuse forest/grass/meadow và leisure park, natural wood trên OSM / diện tích phường. Không phải kiểm kê cây xanh.` },
      { id: 'mix', group: 'Chức năng', name: 'Chỉ số trộn lẫn sử dụng đất', unit: 'entropy', source: 'Shannon (ln) theo diện tích các nhóm OSM: ở, dịch vụ, sản xuất, nông nghiệp, cây, đất mở, nước, khác. Trống nếu dưới 2 nhóm.' },
      { id: 'road', group: 'Liên kết', name: 'Mật độ đường', unit: 'km/km²', source: `Chiều dài highway OSM (${HW.replace(/\|/g, ', ')}) / km². OSM ${osmDate.slice(0, 10)}.` },
      { id: 'junction', group: 'Liên kết', name: 'Mật độ nút giao', unit: 'nút/km²', source: 'Nút OSM thuộc ít nhất 3 way highway các loại trên / km².' },
      { id: 'transit', group: 'Liên kết', name: 'Mật độ điểm giao thông công cộng', unit: 'điểm/10 km²', source: 'Điểm dừng xe buýt, platform, ga OSM / 10 km². Chưa tính khoảng cách đi bộ.' }
    ],
    wards: rows,
    limits: [
      'Không dùng Google Open Buildings: dấu chân nhà lấy từ way building của OpenStreetMap, thiếu nhà chỉ vẽ bằng relation.',
      'Nhà và thửa đất OSM phủ dày ở nội thành, thưa ở xã miền núi — chỉ số thấp có thể là thiếu vẽ, không hẳn là ít nhà hoặc ít cây.',
      'Chỉ số trộn lẫn để trống khi OSM có dưới 2 nhóm sử dụng đất trong phường.',
      'Chưa tính thời gian đi bộ tới điểm dừng (không dựng mạng đường cho từng nhà).'
    ],
    skippedBuildings: bldgSkip
  };
  fs.writeFileSync(OUT, JSON.stringify(doc));
  console.log('imm wards', rows.length, 'buildings skipped', bldgSkip, 'osm', osmDate);
}

main().catch(err => { console.error(err); process.exit(1); });
