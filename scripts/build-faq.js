// Dựng public/data/faq.json từ số liệu đã có: công trình trên bucket, danh sách kêu gọi đầu tư,
// lớp chức năng đất QHC 2045 và dân số trên ranh 40 phường xã. Không bịa chỉ tiêu thiếu nguồn.
const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');
const constants = require('../config/constants');

const root = path.join(__dirname, '..');
const INFRA_URL = constants.GCS_URL;
const BOUNDARY_URL = process.env.BOUNDARY_URL || 'https://web-hatang-hue-4.vercel.app/api/gee?action=getBoundaryVector&v=2';
const OUT = path.join(root, 'public/data/faq.json');

const LAND = {
  5: 'Đất cây xanh sử dụng công cộng đô thị',
  23: 'Đất sản xuất nông nghiệp',
  40: 'Đất đơn vị ở',
  forest: 'Đất lâm nghiệp (rừng đặc dụng, phòng hộ, sản xuất)'
};
const FOREST = new Set([24, 25, 26]);

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
const coreName = (s) => fold(s).replace(/^(phuong|xa|thi tran)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const wards = Object.keys(constants.WARD_AREA_KM2);
const byCore = new Map(wards.map(w => [coreName(w), w]));
const num = (n, d = 0) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d, minimumFractionDigits: d }).format(n);
const ha = (m2) => num(m2 / 10000, 2);
const approved = (v) => v === true || String(v).trim().toUpperCase() === 'TRUE' || String(v).trim() === '1';
const areaOf = (v) => {
  const n = Number(String(v == null ? '' : v).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function typeOf(props) {
  const prefix = String(props.ID_DoiTuong || '').split('-')[0];
  return constants.codeMap[prefix]
    || constants.codeMap[prefix.replace(/_DT$/i, '').replace(/_DV$/i, '')]
    || null;
}

function matchWardsInText(text) {
  const f = ` ${fold(text).replace(/[^a-z0-9]+/g, ' ')} `;
  return wards.filter(w => {
    const c = coreName(w);
    return c && f.includes(` ${c} `);
  });
}

function namedWard(raw) {
  const c = coreName(raw);
  return byCore.get(c) || null;
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res.json();
}

function ringCentroid(geom) {
  try {
    const c = turf.centroid({ type: 'Feature', geometry: geom, properties: {} });
    const [lng, lat] = c.geometry.coordinates;
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  } catch (e) {
    return null;
  }
}

function locateFactory(features) {
  const boxes = features.map(f => {
    const name = namedWard((f.properties || {}).tenXa || (f.properties || {}).name || '');
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

function rank(rows) {
  const scored = rows.filter(r => r.value > 0).sort((a, b) => b.value - a.value || a.ward.localeCompare(b.ward, 'vi'));
  return {
    top: scored[0] || null,
    bottom: scored.length ? scored[scored.length - 1] : null,
    n: scored.length,
    zero: rows.filter(r => !(r.value > 0)).map(r => r.ward)
  };
}

// Cùng ngưỡng classifyPlanChange trong services/gcsService.js: HT trống + QH có số = chưa xây.
const PLAN_CHANGE_MIN_RATIO = 0.05;
const PRIORITY_TOP = 8;
const SERVICE_SKIP = new Set(['12-CSD', '14-NOXH', '11-NT']);
const PRIORITY_METHOD = 'Công trình quy hoạch chưa xây là công trình đã phê duyệt, chưa có quy mô hiện trạng và đã có quy mô quy hoạch. Công trình được gán vào phường, xã theo tọa độ nằm trong ranh, không theo tên phường, xã ghi trên bảng dữ liệu. Quỹ đất chưa sử dụng và nhà ở xã hội không có bán kính phục vụ nên không đưa vào danh sách. Nhà tang lễ và nghĩa trang chỉ có khoảng cách an toàn (Bảng 23), không phải vùng dân được phục vụ, nên cũng không xếp. Độ phủ tăng thêm là ước tính hình học: 81 điểm trên vùng đệm tròn theo bán kính QCVN 01:2026/BXD; chỉ tính phần vùng đệm nằm trong phường, xã và chưa nằm trong vùng phục vụ của công trình cùng loại đang có (hiện trạng đã phê duyệt, kể cả điểm sắp di dời). Diện tích tăng thêm (ha) bằng tỷ lệ đó nhân diện tích ranh. Dân số tăng thêm bằng tỷ lệ đó nhân dân số phường, xã, không vượt sức chứa bằng quy mô quy hoạch chia chỉ tiêu mét vuông trên người. Ước tính này không dùng lớp dân cư vệ tinh và không bám theo mạng đường; mạng đường chỉ dùng khi tra cứu một vị trí trên bản đồ. Mỗi phường, xã giữ 8 công trình làm tăng độ phủ nhiều nhất, xếp theo dân số tăng thêm rồi đến diện tích tăng thêm.';

function parseArea(val) {
  if (val === undefined || val === null || String(val).trim() === '') return null;
  const n = Number(String(val).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function classifyPlanChange(sizeHT, sizeQH) {
  if (sizeHT === null) return sizeQH === null ? 'none' : 'new';
  if (sizeQH === null) return 'relocate';
  if (sizeHT === 0 || sizeQH === 0) return 'keep';
  if (Math.abs(sizeQH - sizeHT) <= sizeHT * PLAN_CHANGE_MIN_RATIO) return 'keep';
  if (sizeQH > sizeHT) return 'expand';
  if (sizeQH < sizeHT) return 'shrink';
  return 'keep';
}

function geoJsonAreaM2(geometry) {
  if (!geometry || !geometry.coordinates) return 0;
  const ringArea = (ring) => {
    if (!ring || ring.length < 3) return 0;
    const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
    let sum = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const x1 = ring[i][0] * mPerDegLng;
      const y1 = ring[i][1] * mPerDegLat;
      const x2 = ring[i + 1][0] * mPerDegLng;
      const y2 = ring[i + 1][1] * mPerDegLat;
      sum += x1 * y2 - x2 * y1;
    }
    return Math.abs(sum) / 2;
  };
  if (geometry.type === 'Polygon') return ringArea(geometry.coordinates[0]);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.reduce((s, poly) => s + ringArea(poly[0]), 0);
  return 0;
}

function distMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function isPointInPolygon(point, vs) {
  const x = point[0];
  const y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0];
    const yi = vs[i][1];
    const xj = vs[j][0];
    const yj = vs[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInPolygonRings(point, rings) {
  if (!rings || !rings[0] || !isPointInPolygon(point, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (isPointInPolygon(point, rings[i])) return false;
  }
  return true;
}

function normalizeWardGeometry(geometry) {
  if (!geometry) return null;
  const polygons = [];
  const collect = (g) => {
    if (!g) return;
    if (g.type === 'Polygon' && Array.isArray(g.coordinates)) polygons.push(g.coordinates);
    else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) g.coordinates.forEach(p => polygons.push(p));
    else if (g.type === 'GeometryCollection') (g.geometries || []).forEach(collect);
  };
  collect(geometry);
  if (!polygons.length) return null;
  if (polygons.length === 1) return { type: 'Polygon', coordinates: polygons[0] };
  return { type: 'MultiPolygon', coordinates: polygons };
}

function pointInGeom(lng, lat, geom) {
  if (!geom) return false;
  const pt = [lng, lat];
  if (geom.type === 'Polygon') return isPointInPolygonRings(pt, geom.coordinates);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some(rings => isPointInPolygonRings(pt, rings));
  return false;
}

function inBbox(lng, lat, bbox) {
  return !!bbox && lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

function estimateCoverageAddPct({ lat, lng, radius, wardGeometry, bbox, wardArea, existingSameType }) {
  const R = Math.max(50, Number(radius) || 1000);
  if (!wardArea || wardArea <= 0 || lat == null || lng == null) return 0;
  const bufferArea = Math.PI * R * R;
  const rings = 5;
  const perRing = 16;
  let sampleTotal = 0;
  let sampleNewInWard = 0;
  const nearby = (existingSameType || []).filter(ex => ex.lat != null && ex.lng != null
    && distMeters(lat, lng, Number(ex.lat), Number(ex.lng)) <= R + Math.max(50, Number(ex.radius) || R));
  const covered = (pLat, pLng) => {
    for (const ex of nearby) {
      const rEx = Math.max(50, Number(ex.radius) || R);
      if (distMeters(pLat, pLng, Number(ex.lat), Number(ex.lng)) <= rEx) return true;
    }
    return false;
  };
  const consider = (sLat, sLng) => {
    sampleTotal += 1;
    if (bbox && !inBbox(sLng, sLat, bbox)) return;
    if (!pointInGeom(sLng, sLat, wardGeometry)) return;
    if (covered(sLat, sLng)) return;
    sampleNewInWard += 1;
  };
  consider(lat, lng);
  for (let ring = 1; ring <= rings; ring++) {
    const r = (R * ring) / rings;
    for (let k = 0; k < perRing; k++) {
      const ang = (2 * Math.PI * k) / perRing + (ring % 2) * (Math.PI / perRing);
      const dLat = (r * Math.cos(ang)) / 111320;
      const dLng = (r * Math.sin(ang)) / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
      consider(lat + dLat, lng + dLng);
    }
  }
  if (sampleTotal <= 0) return 0;
  const pct = (Math.min((sampleNewInWard / sampleTotal) * bufferArea, wardArea) / wardArea) * 100;
  return Number(Math.min(100, Math.max(0, pct)).toFixed(1));
}

function metricCode(item) {
  return constants.isThptItem(item) ? 'THPT' : constants.resolveTypeCode(item);
}

function serviceLabel(item, size) {
  if (constants.isThptItem(item)) return constants.urbanInfraConfig.THPT.label;
  const code = constants.resolveTypeCode(item);
  if (code === '1-CV') return constants.parkTier({ ...item, size }).label;
  const cfg = constants.infraConfig[code] || constants.networkConfig[code];
  return (cfg && cfg.label) || 'Hạ tầng';
}

function capacityOf(item, size, profile) {
  const code = constants.resolveTypeCode(item);
  const quota = constants.isThptItem(item)
    ? (constants.baseQuota('THPT', profile) || 0)
    : code === '1-CV'
      ? (constants.baseQuota(constants.parkTier({ ...item, size }).urban ? 'CV_DT' : 'CV_DV', profile) || 0)
      : constants.quotaFor(code, profile);
  return quota > 0 && size > 0 ? Math.floor(size / quota) : null;
}

function mappedType(props) {
  const prefix = String(props.ID_DoiTuong || '').split('-')[0];
  return constants.codeMap[prefix]
    || constants.codeMap[prefix.replace(/_DT$/i, '').replace(/_DV$/i, '')]
    || constants.codeMap[String(props.Tab || '').split('-')[0]]
    || null;
}

function buildPriority(features, boundary, popByWard) {
  const geoms = [];
  for (const f of (boundary && boundary.features) || []) {
    const name = namedWard((f.properties || {}).tenXa || (f.properties || {}).name || '');
    const geometry = normalizeWardGeometry(f.geometry);
    if (!name || !geometry) continue;
    let bbox = null;
    try { bbox = turf.bbox({ type: 'Feature', geometry, properties: {} }); } catch (e) { bbox = null; }
    geoms.push({ name, geometry, bbox, areaM2: geoJsonAreaM2(geometry) });
  }
  const wardOfPoint = (lng, lat) => {
    for (const w of geoms) {
      if (!inBbox(lng, lat, w.bbox)) continue;
      if (pointInGeom(lng, lat, w.geometry)) return w;
    }
    return null;
  };
  const ids = new Set(features.map(f => String((f.properties || {}).ID_DoiTuong || '')));
  const isSplit = (id) => {
    const m = String(id || '').match(/^(.+)\.(\d+)$/);
    return !!(m && Number(m[2]) >= 2 && ids.has(m[1]));
  };
  const existingByCode = new Map();
  const candidates = [];
  let unplaced = 0;
  let skippedKind = 0;
  for (const f of features) {
    const p = f.properties || {};
    if (!approved(p.TrangThai) || isSplit(p.ID_DoiTuong)) continue;
    const coords = f.geometry && f.geometry.type === 'Point' ? f.geometry.coordinates : null;
    if (!coords || !Number.isFinite(Number(coords[0])) || !Number.isFinite(Number(coords[1]))) continue;
    const type = mappedType(p);
    if (!type) continue;
    const sizeHT = parseArea(p.QuyMo_HT !== undefined ? p.QuyMo_HT : p.QuyMo_S);
    const sizeQH = parseArea(p.QuyMo_QH);
    const planChange = classifyPlanChange(sizeHT, sizeQH);
    const prefix = String(p.ID_DoiTuong || '').split('-')[0];
    let nhom = p.Nhom_HaTang || p.nhomHaTang;
    if (!nhom && (prefix === 'THPT' || /_DT$/i.test(prefix))) nhom = 'Cap Do Thi';
    const item = {
      id: String(p.ID_DoiTuong || ''),
      name: p.Ten_CongTrinh || 'Chưa đặt tên',
      type,
      nhomHaTang: constants.cleanNhomStr(nhom),
      lat: Number(coords[1]),
      lng: Number(coords[0]),
      status: true
    };
    const code = metricCode(item);
    if (!code || SERVICE_SKIP.has(code) || SERVICE_SKIP.has(type)) {
      if (planChange === 'new') skippedKind++;
      continue;
    }
    const host = wardOfPoint(item.lng, item.lat);
    const profile = constants.wardProfile(host ? host.name : p.Ten_XaPhuong);
    if (planChange === 'new') {
      const size = sizeQH || 0;
      const radius = constants.standardRadius({ ...item, size }, profile);
      if (!(radius > 0)) { skippedKind++; continue; }
      if (!host) { unplaced++; continue; }
      candidates.push({ item, code, size, radius, host, profile });
    } else if (planChange !== 'none') {
      const radius = constants.standardRadius({ ...item, size: sizeHT || 0 }, profile);
      if (!(radius > 0)) continue;
      const ex = { lat: item.lat, lng: item.lng, radius };
      if (!existingByCode.has(code)) existingByCode.set(code, []);
      existingByCode.get(code).push(ex);
    }
  }

  const byWard = new Map(wards.map(name => [name, []]));
  for (const c of candidates) {
    const bucket = byWard.get(c.host.name);
    if (bucket) bucket.push(c);
  }
  const missingPop = [];
  const empty = [];
  const noBoundary = [];
  const out = {};
  for (const name of wards) {
    const host = geoms.find(w => w.name === name);
    const pop = popByWard[name] > 0 ? popByWard[name] : null;
    if (!pop) missingPop.push(name);
    if (!host) {
      noBoundary.push(name);
      out[name] = {
        pop: null,
        missingPop: true,
        facilities: [],
        note: 'Chưa có ranh phường, xã trong lớp ranh giới nên không gán và không tính được công trình quy hoạch mới.'
      };
      continue;
    }
    const ranked = [];
    let zeroGain = 0;
    for (const c of byWard.get(name) || []) {
      const pct = estimateCoverageAddPct({
        lat: c.item.lat,
        lng: c.item.lng,
        radius: c.radius,
        wardGeometry: host.geometry,
        bbox: host.bbox,
        wardArea: host.areaM2,
        existingSameType: existingByCode.get(c.code) || []
      });
      if (!(pct > 0)) { zeroGain++; continue; }
      const areaHa = Math.round((pct / 100) * host.areaM2 / 100) / 100;
      const capacity = capacityOf(c.item, c.size, c.profile);
      let popAdded = null;
      let capacityLimited = false;
      if (pop) {
        const reach = pop * pct / 100;
        const added = capacity == null ? reach : Math.min(reach, capacity);
        capacityLimited = added < reach;
        popAdded = Math.round(added);
      }
      ranked.push({
        id: c.item.id,
        name: c.item.name,
        type: c.code,
        typeLabel: serviceLabel(c.item, c.size),
        lat: c.item.lat,
        lng: c.item.lng,
        radius: c.radius,
        areaHa,
        pct,
        popAdded,
        capacityLimited
      });
    }
    ranked.sort((a, b) => {
      const ap = a.popAdded == null ? -1 : a.popAdded;
      const bp = b.popAdded == null ? -1 : b.popAdded;
      if (bp !== ap) return bp - ap;
      if (b.areaHa !== a.areaHa) return b.areaHa - a.areaHa;
      return a.name.localeCompare(b.name, 'vi');
    });
    const facilities = ranked.slice(0, PRIORITY_TOP);
    let note = '';
    if (!facilities.length && !zeroGain) {
      empty.push(name);
      note = 'Không có công trình quy hoạch mới (đã duyệt, có vùng phục vụ) nằm trong ranh phường, xã này.';
    } else if (!facilities.length) {
      empty.push(name);
      note = `Có ${num(zeroGain)} công trình quy hoạch mới, nhưng buffer QCVN đều đã trùng vùng phục vụ cùng loại hiện có hoặc không thêm diện tích trong ranh.`;
    } else if (zeroGain) {
      note = `Còn ${num(zeroGain)} công trình quy hoạch mới khác không thêm diện tích phủ trong ranh.`;
    }
    if (!pop) note = `${note}${note ? ' ' : ''}Chưa có dân số danSoNum trên ranh, nên chỉ xếp theo diện tích phủ thêm.`.trim();
    out[name] = { pop, missingPop: !pop, facilities, note };
  }
  const outsideNote = unplaced
    ? ` ${num(unplaced)} công trình quy hoạch mới nằm ngoài ranh 40 phường, xã nên không gắn được vào địa bàn nào.`
    : '';
  return {
    method: PRIORITY_METHOD + outsideNote,
    missingPop,
    empty,
    noBoundary,
    unplaced,
    skippedKind,
    wards: out
  };
}

function q(id, question, answer, wardNames, source) {
  return { id, q: question, a: answer, wards: wardNames, source };
}

async function main() {
  const gaps = [];
  const [infra, boundary] = await Promise.all([
    getJson(INFRA_URL),
    getJson(BOUNDARY_URL).catch(err => {
      gaps.push({ q: 'Mật độ dân số và gán lô đất QHC theo ranh phường', why: `Không tải được ranh phường xã (${err.message}).` });
      return null;
    })
  ]);
  const features = (infra && infra.features) || [];
  const locate = boundary ? locateFactory(boundary.features || []) : () => null;
  const popByWard = {};
  if (boundary) {
    for (const f of boundary.features || []) {
      const name = namedWard((f.properties || {}).tenXa || '');
      const pop = Number((f.properties || {}).danSoNum || (f.properties || {}).danSo);
      if (name && Number.isFinite(pop) && pop > 0) popByWard[name] = pop;
    }
  }

  const blank = () => Object.fromEntries(wards.map(w => [w, 0]));
  const green = blank();
  const greenN = blank();
  const greenUnknown = blank();
  const schools = blank();
  const bus = blank();
  const csd = blank();
  const csdN = blank();
  let placed = 0;
  let unplaced = 0;

  for (const f of features) {
    const p = f.properties || {};
    if (!approved(p.TrangThai)) continue;
    const coords = f.geometry && f.geometry.type === 'Point' ? f.geometry.coordinates : null;
    const ward = namedWard(p.Ten_XaPhuong) || (coords ? locate(coords[0], coords[1]) : null);
    if (!ward) { unplaced++; continue; }
    placed++;
    const code = typeOf(p);
    const prefix = String(p.ID_DoiTuong || '').split('-')[0];
    const ht = areaOf(p.QuyMo_HT != null ? p.QuyMo_HT : p.QuyMo_S);
    if (code === '1-CV') {
      greenN[ward]++;
      if (ht) green[ward] += ht; else greenUnknown[ward]++;
    }
    if (['MN', 'TH', 'THCS', 'THPT'].includes(prefix) || ['3-MN', '4-TH', '5-THCS'].includes(code)) schools[ward]++;
    if (code === '13-BUS' || prefix === 'BUS') bus[ward]++;
    if (code === '12-CSD') {
      csdN[ward]++;
      if (ht) csd[ward] += ht;
    }
  }

  const land = { 5: blank(), 23: blank(), 40: blank(), forest: blank() };
  const sdd = JSON.parse(fs.readFileSync(path.join(root, 'public/data/qhc2045/sdd.json'), 'utf8'));
  let landHits = 0;
  let landMiss = 0;
  if (boundary) {
    for (const f of sdd.features || []) {
      const props = f.properties || {};
      const pt = f.geometry ? ringCentroid(f.geometry) : null;
      const ward = pt ? locate(pt[0], pt[1]) : null;
      if (!ward) { landMiss++; continue; }
      const code = Number(props.c);
      const a = Number(props.a) || 0;
      if (!(a > 0)) continue;
      if (land[code]) { land[code][ward] += a; landHits++; }
      if (FOREST.has(code)) { land.forest[ward] += a; landHits++; }
    }
  }

  const invest = JSON.parse(fs.readFileSync(path.join(root, 'public/data/invest-sheet.json'), 'utf8'));
  const projects = blank();
  let investMatched = 0;
  let investMiss = 0;
  for (const row of invest.rows || []) {
    const hits = matchWardsInText(row['ĐỊA ĐIỂM'] || '');
    if (!hits.length) { investMiss++; continue; }
    investMatched++;
    hits.forEach(w => { projects[w]++; });
  }

  const rowsOf = (map) => wards.map(ward => ({ ward, value: map[ward] }));
  const questions = [];

  const greenRank = rank(rowsOf(green));
  if (greenRank.top) {
    const w = greenRank.top.ward;
    questions.push(q(
      'green-max',
      'Phường, xã nào có diện tích cây xanh công viên lớn nhất?',
      `${w}: ${ha(green[w])} ha quy mô hiện trạng đã phê duyệt (${num(greenN[w])} công viên${greenUnknown[w] ? `, ${num(greenUnknown[w])} công trình chưa có quy mô hiện trạng nên không cộng diện tích` : ''}).`,
      [w],
      'Hạ tầng đã phê duyệt, nhóm cây xanh công viên, quy mô hiện trạng (m²). Cập nhật 15/10/2026.'
    ));
  } else {
    gaps.push({ q: 'Phường nào có diện tích cây xanh lớn nhất?', why: 'Không có công viên đã duyệt với QuyMo_HT > 0.' });
  }

  const xa = wards.filter(w => /^xã\s/i.test(w));
  const phuong = wards.filter(w => /^phường\s/i.test(w));
  if (Object.keys(popByWard).length >= 30) {
    const dens = (list) => list.map(w => ({ ward: w, value: constants.WARD_AREA_KM2[w] > 0 ? popByWard[w] / constants.WARD_AREA_KM2[w] : 0 }))
      .filter(r => popByWard[r.ward] > 0);
    const low = dens(xa).sort((a, b) => a.value - b.value);
    const high = dens(phuong).sort((a, b) => b.value - a.value);
    if (low[0]) {
      questions.push(q(
        'dens-xa-min',
        'Xã nào có mật độ dân số thấp nhất?',
        `${low[0].ward}: ${num(Math.round(low[0].value))} người/km² (${num(popByWard[low[0].ward])} người / ${num(constants.WARD_AREA_KM2[low[0].ward], 2)} km²).`,
        [low[0].ward],
        'Dân số trên ranh phường, xã; diện tích theo bảng diện tích chính thức 40 phường, xã.'
      ));
    }
    if (high[0]) {
      questions.push(q(
        'dens-phuong-max',
        'Phường nào có mật độ dân số cao nhất?',
        `${high[0].ward}: ${num(Math.round(high[0].value))} người/km² (${num(popByWard[high[0].ward])} người / ${num(constants.WARD_AREA_KM2[high[0].ward], 2)} km²).`,
        [high[0].ward],
        'Dân số trên ranh phường, xã; diện tích theo bảng diện tích chính thức 40 phường, xã.'
      ));
    }
  } else {
    gaps.push({ q: 'Xã nào có mật độ dân số thấp nhất?', why: 'Ranh phường xã không kèm dân số danSoNum.' });
  }

  const landNote = 'Lớp sử dụng đất QHC 2045, diện tích lô (ha) theo mã chức năng, gán phường, xã theo tâm lô. Chỉ các lô có trong lớp này, không phải kiểm kê toàn địa bàn.';
  if (boundary && landHits) {
    for (const [key, label] of [['5', LAND[5]], ['40', LAND[40]], ['23', LAND[23]], ['forest', LAND.forest]]) {
      const r = rank(rowsOf(land[key]));
      if (!r.top) {
        gaps.push({ q: `Địa bàn nào có ${label} lớn nhất trên QHC 2045?`, why: 'Lớp sdd.json không có lô mã này nằm trong ranh 40 phường xã.' });
        continue;
      }
      questions.push(q(
        `land-${key}-max`,
        `Trên quy hoạch chung 2045, địa bàn nào có ${label.toLowerCase()} lớn nhất?`,
        `${r.top.ward}: ${num(r.top.value, 1)} ha. ${r.n} địa bàn có loại đất này trong lớp.`,
        [r.top.ward],
        landNote
      ));
      if (r.bottom && r.bottom.ward !== r.top.ward) {
        questions.push(q(
          `land-${key}-min`,
          `Trên quy hoạch chung 2045, địa bàn nào có ${label.toLowerCase()} nhỏ nhất (trong số có lô)?`,
          `${r.bottom.ward}: ${num(r.bottom.value, 1)} ha. ${r.zero.length} địa bàn không có lô loại này trong lớp QHC 2045.`,
          [r.bottom.ward],
          landNote
        ));
      }
    }
  } else if (!gaps.some(g => /QHC/.test(g.q))) {
    gaps.push({ q: 'Địa bàn nào đứng đầu hoặc cuối theo nhóm đất QHC 2045?', why: 'Chưa gán được lô đất vào ranh phường xã.' });
  }

  const inv = rank(rowsOf(projects));
  if (inv.top) {
    const top3 = rowsOf(projects).filter(r => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 3);
    questions.push(q(
      'invest-max',
      'Địa bàn nào có nhiều dự án kêu gọi đầu tư nhất?',
      `${top3.map(r => `${r.ward}: ${num(r.value)} dự án`).join('; ')}. ${num(investMatched)} dự án gắn được với địa bàn; ${num(investMiss)} dự án không khớp tên phường, xã.`,
      top3.map(r => r.ward),
      'Danh sách kêu gọi đầu tư, cột địa điểm. Một dòng ghi nhiều phường, xã được đếm ở mỗi địa bàn. Đây không phải dự án đã cấp phép.'
    ));
    questions.push(q(
      'invest-min',
      'Địa bàn nào có ít dự án kêu gọi đầu tư nhất (trong số có ít nhất một dự án)?',
      `${inv.bottom.ward}: ${num(inv.bottom.value)} dự án. ${num(inv.zero.length)} địa bàn không có dự án khớp tên.`,
      [inv.bottom.ward],
      'Danh sách kêu gọi đầu tư, cột địa điểm.'
    ));
  }

  const schoolRank = rank(rowsOf(schools));
  if (schoolRank.top) {
    const w = schoolRank.top.ward;
    questions.push(q(
      'school-max',
      'Địa bàn nào có nhiều trường mầm non, tiểu học, THCS, THPT đã duyệt nhất?',
      `${w}: ${num(schools[w])} trường.`,
      [w],
      'Công trình đã phê duyệt, nhóm trường mầm non, tiểu học, THCS, THPT.'
    ));
  }
  const busRank = rank(rowsOf(bus));
  if (busRank.top) {
    questions.push(q(
      'bus-max',
      'Địa bàn nào có nhiều điểm dừng xe buýt đã duyệt nhất?',
      `${busRank.top.ward}: ${num(bus[busRank.top.ward])} điểm.`,
      [busRank.top.ward],
      'Công trình đã phê duyệt, nhóm điểm dừng xe buýt.'
    ));
  }
  const csdRank = rank(rowsOf(csd));
  if (csdRank.top) {
    const w = csdRank.top.ward;
    questions.push(q(
      'csd-max',
      'Địa bàn nào có quỹ đất chưa sử dụng (quy mô hiện trạng đã duyệt) lớn nhất?',
      `${w}: ${ha(csd[w])} ha (${num(csdN[w])} khu).`,
      [w],
      'Công trình đã phê duyệt, nhóm quỹ đất chưa sử dụng, quy mô hiện trạng.'
    ));
  }

  const byArea = wards.map(w => ({ ward: w, value: constants.WARD_AREA_KM2[w] })).sort((a, b) => b.value - a.value);
  questions.push(q(
    'area-max',
    'Phường, xã nào có diện tích tự nhiên lớn nhất?',
    `${byArea[0].ward}: ${num(byArea[0].value, 2)} km².`,
    [byArea[0].ward],
    'Bảng diện tích chính thức 40 phường, xã.'
  ));
  const small = byArea[byArea.length - 1];
  questions.push(q(
    'area-min',
    'Phường, xã nào có diện tích tự nhiên nhỏ nhất?',
    `${small.ward}: ${num(small.value, 2)} km².`,
    [small.ward],
    'Bảng diện tích chính thức 40 phường, xã.'
  ));

  gaps.push(
    { q: 'Diện tích cây xanh công cộng theo kiểm kê đất đai?', why: 'Hiện chỉ có quy mô từng công viên, chưa có lớp kiểm kê cây xanh trên toàn ranh.' },
    { q: 'Tỷ lệ nhà kiên cố, nước sạch, chất thải rắn theo phường?', why: 'Chưa có số liệu điều tra trong bộ dữ liệu đang dùng.' },
    { q: 'Số dự án đầu tư đã cấp phép hoặc đang thi công theo phường?', why: 'Hiện chỉ có danh sách kêu gọi đầu tư, chưa có sổ dự án đã phê duyệt theo phường, xã.' },
    { q: 'Mật độ xây dựng hoặc tầng cao trung bình theo phường?', why: 'Chưa có lớp công trình nhà trong bộ số liệu đang dùng.' },
    { q: 'Độ che phủ thực vật theo phường, xã?', why: 'Chưa có lớp chỉ số thực vật trong bộ số liệu tĩnh.' }
  );

  const priority = buildPriority(features, boundary, popByWard);
  const doc = {
    built: '2026-10-19',
    infraFeatures: features.length,
    placed,
    unplaced,
    landHits,
    landMiss,
    questions,
    unanswered: gaps,
    priority
  };
  console.log(`priority: thiếu dân ${priority.missingPop.length}, không có công trình mới ${priority.empty.length}, không có ranh ${priority.noBoundary.length}, ngoài ranh ${priority.unplaced}, bỏ loại không phục vụ ${priority.skippedKind}`);
  if (priority.missingPop.length) console.log('thiếu dân:', priority.missingPop.join('; '));
  if (priority.empty.length) console.log('không xếp được:', priority.empty.join('; '));
  if (priority.noBoundary.length) console.log('không ranh:', priority.noBoundary.join('; '));
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2));
  console.log(`faq: ${questions.length} câu, ${gaps.length} câu chưa trả lời, ${OUT}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
