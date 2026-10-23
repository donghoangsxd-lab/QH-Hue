// Cắt lớp hiện trạng theo ranh đô thị và xã-phường khi mở bảng chấm. Không chạy lúc mở bản đồ.
// Ba ngành giao thông, cấp điện, cấp nước lấy file đã gộp (tam_thoi). Bốn ngành còn lại và sử dụng đất
// chưa có file gộp: trong một đơn vị lấy tỷ lệ chi tiết hơn; đoạn lớp thô nằm ngoài khung lớp chi tiết vẫn cộng.
// Không đổi chỉ tiêu pháp lý thành km ống hay số điểm. Cán bộ nhập thì ghi đè giá trị chấm.
import { bareName } from './urbanStatus.js';
import { allPartFeatures, loadPartGeoms } from './urbanPartGeom.js';

const STEP_M = 400;
const BOX_PAD = 0.004;

export const HT_FILES = [
  { file: 'hien-trang-tam/giao-thong.geojson', role: 'gt', scale: 0 },
  { file: 'hien-trang-tam/cap-nuoc.geojson', role: 'nuoc', scale: 0 },
  { file: 'hien-trang-tam/cap-dien.geojson', role: 'dien', scale: 0 },
  { file: 'chuyen-nganh/qhc-do-thi-thua-thien-hue-1-25-000-99f3eaf1/san-nen-thoat-mua/hien-trang/hien-trang-phan-luu-thoat-nuoc-dang-duong.geojson', role: 'drain', scale: 25000 },
  { file: 'chuyen-nganh/qhc-do-thi-trung-tam-thua-thien-hue-1-10-000-9406ec72/san-nen-thoat-mua/hien-trang/hien-trang-mang-luoi-thoat-nuoc-dang-duong.geojson', role: 'drain', scale: 10000 },
  { file: 'chuyen-nganh/qhc-do-thi-thua-thien-hue-1-25-000-99f3eaf1/thoat-nuoc-thai/hien-trang/hien-trang-mang-luoi-thoat-nuoc-thai.geojson', role: 'sewer', scale: 25000 },
  { file: 'chuyen-nganh/qhc-do-thi-trung-tam-thua-thien-hue-1-10-000-9406ec72/thoat-nuoc-thai/hien-trang/hien-trang-mang-luoi-thoat-nuoc-thai.geojson', role: 'sewer', scale: 10000 },
  { file: 'chuyen-nganh/qhc-do-thi-thua-thien-hue-1-25-000-99f3eaf1/thoat-nuoc-thai/hien-trang/hien-trang-cong-trinh-xu-ly-nuoc-thai-dang-diem.geojson', role: 'wwtp', scale: 25000 },
  { file: 'chuyen-nganh/qhc-do-thi-trung-tam-thua-thien-hue-1-10-000-9406ec72/thoat-nuoc-thai/hien-trang/hien-trang-cong-trinh-xu-ly-nuoc-thai-dang-diem.geojson', role: 'wwtp', scale: 10000 },
  { file: 'chuyen-nganh/qhc-do-thi-thua-thien-hue-1-25-000-99f3eaf1/chat-thai-ran-nghia-trang/hien-trang/hien-trang-mang-luoi-chat-thai-ran.geojson', role: 'waste', scale: 25000 },
  { file: 'chuyen-nganh/qhc-do-thi-trung-tam-thua-thien-hue-1-10-000-9406ec72/chat-thai-ran-nghia-trang/hien-trang/hien-trang-diem-xu-ly-chat-thai-ran.geojson', role: 'waste', scale: 10000 },
  { file: 'chuyen-nganh/qhc-do-thi-thua-thien-hue-1-25-000-99f3eaf1/chat-thai-ran-nghia-trang/hien-trang/hien-trang-mang-luoi-nghia-trang.geojson', role: 'cemetery', scale: 25000 },
  { file: 'chuyen-nganh/qhc-do-thi-trung-tam-thua-thien-hue-1-10-000-9406ec72/chat-thai-ran-nghia-trang/hien-trang/hien-trang-mang-luoi-nghia-trang.geojson', role: 'cemetery', scale: 10000 },
  { file: 'chuyen-nganh/qhc-do-thi-moi-vinh-hung-8899f27b/chat-thai-ran-nghia-trang/hien-trang/hien-trang-he-thong-nghia-trang.geojson', role: 'cemetery', scale: 5000 },
  { file: 'chuyen-nganh/qhc-do-thi-thua-thien-hue-1-25-000-99f3eaf1/thong-tin-lien-lac/hien-trang/hien-trang-mang-luoi-thong-tin-lien-lac.geojson', role: 'telecom', scale: 25000 },
  { file: 'chuyen-nganh/qhc-do-thi-trung-tam-thua-thien-hue-1-10-000-9406ec72/thong-tin-lien-lac/hien-trang/hien-trang-mang-luoi-thong-tin-lien-lac.geojson', role: 'telecom', scale: 10000 },
  { file: 'chuyen-nganh/qhc-do-thi-thua-thien-hue-1-25-000-99f3eaf1/thong-tin-lien-lac/hien-trang/hien-trang-mang-luoi-tram-thong-tin-dang-diem.geojson', role: 'telecomN', scale: 25000 },
  { file: 'chuyen-nganh/qhc-do-thi-trung-tam-thua-thien-hue-1-10-000-9406ec72/thong-tin-lien-lac/hien-trang/hien-trang-mang-luoi-tram-thong-tin-dang-diem.geojson', role: 'telecomN', scale: 10000 },
  { file: 'chuyen-nganh/qhc-do-thi-moi-vinh-hung-8899f27b/thong-tin-lien-lac/hien-trang/hien-trang-tram-thong-tin-lien-lac.geojson', role: 'telecomN', scale: 5000 },
  { file: 'chuyen-nganh/qhc-khu-cong-nghiep-phong-dien-f997bd2c/sdd/hien-trang/hien-trang-su-dung-dat.geojson', role: 'land', scale: 5000 }
];

const N1 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const km = (m) => `${N1.format((m || 0) / 1000)} km`;

let started = false;
let ready = false;
let failed = false;
let promise = null;
let byUrban = new Map();
let byWard = new Map();

export function htReady() {
  return ready;
}

function distM(a, b) {
  const R = 6371000;
  const p1 = a[1] * Math.PI / 180;
  const p2 = b[1] * Math.PI / 180;
  const dp = (b[1] - a[1]) * Math.PI / 180;
  const dl = (b[0] - a[0]) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function ringHas(xy, lng, lat) {
  let inside = false;
  const n = xy.length / 2;
  let j = n - 1;
  for (let i = 0; i < n; j = i++) {
    const xi = xy[i * 2];
    const yi = xy[i * 2 + 1];
    const xj = xy[j * 2];
    const yj = xy[j * 2 + 1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function packRing(ring) {
  const xy = new Float64Array(ring.length * 2);
  for (let i = 0; i < ring.length; i += 1) {
    xy[i * 2] = ring[i][0];
    xy[i * 2 + 1] = ring[i][1];
  }
  return xy;
}

function polysOf(feature) {
  const g = feature && feature.geometry;
  const raw = g && g.type === 'Polygon' ? [g.coordinates] : (g && g.type === 'MultiPolygon' ? g.coordinates : []);
  return raw.map(rings => rings.filter(r => r && r.length).map(packRing));
}

function pointInPolys(polys, lng, lat) {
  for (let p = 0; p < polys.length; p += 1) {
    const rings = polys[p];
    if (!rings.length || !ringHas(rings[0], lng, lat)) continue;
    let hole = false;
    for (let h = 1; h < rings.length; h += 1) {
      if (ringHas(rings[h], lng, lat)) { hole = true; break; }
    }
    if (!hole) return true;
  }
  return false;
}

function bboxOfGeom(g, box) {
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      box[0] = Math.min(box[0], c[0]);
      box[1] = Math.min(box[1], c[1]);
      box[2] = Math.max(box[2], c[0]);
      box[3] = Math.max(box[3], c[1]);
      return;
    }
    c.forEach(walk);
  };
  if (g && g.coordinates) walk(g.coordinates);
}

function bboxHit(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function inBoxes(lng, lat, boxes) {
  for (let i = 0; i < boxes.length; i += 1) {
    const b = boxes[i];
    if (lng >= b[0] - BOX_PAD && lng <= b[2] + BOX_PAD && lat >= b[1] - BOX_PAD && lat <= b[3] + BOX_PAD) return true;
  }
  return false;
}

function linesOf(g) {
  if (!g) return [];
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  return [];
}

function pointsOf(g) {
  if (!g) return [];
  if (g.type === 'Point') return [g.coordinates];
  if (g.type === 'MultiPoint') return g.coordinates;
  return [];
}

function densify(line) {
  if (!line || line.length < 2) return line || [];
  const out = [line[0]];
  for (let i = 1; i < line.length; i += 1) {
    const len = distM(line[i - 1], line[i]);
    const n = Math.max(1, Math.ceil(len / STEP_M));
    for (let k = 1; k <= n; k += 1) {
      const t = k / n;
      out.push([
        line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t,
        line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t
      ]);
    }
  }
  return out;
}

function segsOf(line) {
  const d = densify(line);
  const segs = [];
  for (let i = 1; i < d.length; i += 1) {
    const len = distM(d[i - 1], d[i]);
    if (len > 0) segs.push({ lng: (d[i - 1][0] + d[i][0]) / 2, lat: (d[i - 1][1] + d[i][1]) / 2, m: len });
  }
  return segs;
}

function num(v) {
  const n = Number(String(v == null ? '' : v).trim());
  return Number.isFinite(n) ? n : 0;
}

function blank() {
  return {
    roadM: 0, junctions: 0, railM: 0, waterwayM: 0,
    pipeM: 0, plants: 0, waterCap: 0,
    powerM: 0, stations: 0,
    drainM: 0, sewerM: 0, wwtp: 0, wwtpCap: 0,
    wasteN: 0, cemeteryN: 0,
    telecomM: 0, telecomN: 0,
    landM2: 0, landCodes: {}
  };
}

function pushItem(out, role, scale, kind, extra) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  if (extra.segs) extra.segs.forEach(s => {
    box[0] = Math.min(box[0], s.lng); box[1] = Math.min(box[1], s.lat);
    box[2] = Math.max(box[2], s.lng); box[3] = Math.max(box[3], s.lat);
  });
  else {
    box[0] = box[2] = extra.lng;
    box[1] = box[3] = extra.lat;
  }
  out.push({ role, scale, kind, tam: scale === 0, box, ...extra });
}

export function itemsFrom(fc, spec) {
  const out = [];
  const role = spec.role;
  const scale = spec.scale;
  for (const f of (fc && fc.features) || []) {
    const p = f.properties || {};
    const g = f.geometry;
    if (!g) continue;
    if (role === 'gt') {
      const nhom = p.nhom || '';
      if (nhom === 'mat-cat') continue;
      const segs = linesOf(g).flatMap(segsOf);
      if (segs.length && nhom === 'mang') pushItem(out, role, scale, 'road', { segs });
      else if (segs.length && nhom === 'duong-sat') pushItem(out, role, scale, 'rail', { segs });
      else if (segs.length && nhom === 'duong-thuy') pushItem(out, role, scale, 'waterway', { segs });
      pointsOf(g).forEach(pt => pushItem(out, role, scale, 'junction', { lng: pt[0], lat: pt[1] }));
    } else if (role === 'nuoc') {
      const segs = linesOf(g).flatMap(segsOf);
      if (segs.length) pushItem(out, role, scale, 'pipe', { segs });
      pointsOf(g).forEach(pt => pushItem(out, role, scale, 'plant', { lng: pt[0], lat: pt[1], cap: Math.max(0, num(p.congsuat)) }));
    } else if (role === 'dien') {
      const segs = linesOf(g).flatMap(segsOf);
      if (segs.length) pushItem(out, role, scale, 'power', { segs });
      pointsOf(g).forEach(pt => pushItem(out, role, scale, 'station', { lng: pt[0], lat: pt[1] }));
    } else if (role === 'drain' || role === 'sewer' || role === 'telecom') {
      const segs = linesOf(g).flatMap(segsOf);
      if (segs.length) pushItem(out, role, scale, role, { segs });
    } else if (role === 'wwtp' || role === 'waste' || role === 'cemetery' || role === 'telecomN') {
      pointsOf(g).forEach(pt => pushItem(out, role, scale, role, { lng: pt[0], lat: pt[1], cap: Math.max(0, num(p.congsuat)) }));
    } else if (role === 'land' && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
      const ring = g.type === 'Polygon' ? g.coordinates[0] : (g.coordinates[0] && g.coordinates[0][0]);
      if (!ring || !ring.length) continue;
      let lng = 0;
      let lat = 0;
      ring.forEach(c => { lng += c[0]; lat += c[1]; });
      lng /= ring.length;
      lat /= ring.length;
      pushItem(out, role, scale, 'land', { lng, lat, area: Math.max(0, num(p.dientich)), code: String(p.maloaidat || p.loaidat || '').trim() });
    }
  }
  return out;
}

function unitFrom(features) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const polys = [];
  features.forEach(f => {
    bboxOfGeom(f.geometry, box);
    polys.push(...polysOf(f));
  });
  const contains = (lng, lat) => pointInPolys(polys, lng, lat);
  return { box, contains };
}

function addInside(slot, item, contains, boxes) {
  const skip = (lng, lat) => boxes && inBoxes(lng, lat, boxes);
  if (item.segs) {
    let m = 0;
    item.segs.forEach(s => {
      if (skip(s.lng, s.lat)) return;
      if (contains(s.lng, s.lat)) m += s.m;
    });
    if (item.kind === 'road') slot.roadM += m;
    else if (item.kind === 'rail') slot.railM += m;
    else if (item.kind === 'waterway') slot.waterwayM += m;
    else if (item.kind === 'pipe') slot.pipeM += m;
    else if (item.kind === 'power') slot.powerM += m;
    else if (item.kind === 'drain') slot.drainM += m;
    else if (item.kind === 'sewer') slot.sewerM += m;
    else if (item.kind === 'telecom') slot.telecomM += m;
    return;
  }
  if (skip(item.lng, item.lat) || !contains(item.lng, item.lat)) return;
  if (item.kind === 'junction') slot.junctions += 1;
  else if (item.kind === 'plant') { slot.plants += 1; slot.waterCap += item.cap || 0; }
  else if (item.kind === 'station') slot.stations += 1;
  else if (item.kind === 'wwtp') { slot.wwtp += 1; slot.wwtpCap += item.cap || 0; }
  else if (item.kind === 'waste') slot.wasteN += 1;
  else if (item.kind === 'cemetery') slot.cemeteryN += 1;
  else if (item.kind === 'telecomN') slot.telecomN += 1;
  else if (item.kind === 'land') {
    slot.landM2 += item.area || 0;
    if (item.code) slot.landCodes[item.code] = (slot.landCodes[item.code] || 0) + (item.area || 0);
  }
}

export function buildFacts(layers, urbanFc, wardFc, urbans) {
  const items = [];
  layers.forEach(({ spec, fc }) => items.push(...itemsFrom(fc, spec)));
  const wards = (wardFc && wardFc.features) || [];
  const byBare = new Map();
  wards.forEach(f => byBare.set(bareName(f.properties && f.properties.tenXa), f));
  const u614 = new Map();
  ((urbanFc && urbanFc.features) || []).forEach(f => {
    const id = f.properties && f.properties.id;
    if (id) u614.set(id, f);
  });
  const units = [];
  wards.forEach(f => {
    const name = f.properties && f.properties.tenXa;
    units.push({ key: `w:${bareName(name)}`, name, ...unitFrom([f]) });
  });
  (urbans || []).forEach(u => {
    const poly = u614.get(u.id);
    if (poly) units.push({ key: `u:${u.id}`, ...unitFrom([poly]) });
    else {
      const parts = (u.units || []).map(n => byBare.get(bareName(n))).filter(Boolean);
      if (parts.length) units.push({ key: `u:${u.id}`, ...unitFrom(parts) });
    }
  });
  u614.forEach((f, id) => {
    if (!units.some(u => u.key === `u:${id}`)) units.push({ key: `u:${id}`, ...unitFrom([f]) });
  });

  const slots = new Map();
  const recorded = new Map();
  units.forEach(u => {
    slots.set(u.key, blank());
    recorded.set(u.key, new Map());
  });
  items.sort((a, b) => a.scale - b.scale);
  items.forEach(item => {
    units.forEach(u => {
      if (!bboxHit(item.box, u.box)) return;
      const rec = recorded.get(u.key);
      const prev = rec.get(item.kind) || [];
      const boxes = item.scale > 0 ? prev.filter(r => r.scale < item.scale).map(r => r.box) : null;
      const slot = slots.get(u.key);
      const mark = slot.roadM + slot.pipeM + slot.drainM + slot.sewerM + slot.powerM + slot.telecomM + slot.railM + slot.waterwayM
        + slot.junctions + slot.plants + slot.stations + slot.wwtp + slot.wasteN + slot.cemeteryN + slot.telecomN + slot.landM2;
      addInside(slot, item, u.contains, boxes && boxes.length ? boxes : null);
      const next = slot.roadM + slot.pipeM + slot.drainM + slot.sewerM + slot.powerM + slot.telecomM + slot.railM + slot.waterwayM
        + slot.junctions + slot.plants + slot.stations + slot.wwtp + slot.wasteN + slot.cemeteryN + slot.telecomN + slot.landM2;
      if (!(item.scale > 0) || next === mark) return;
      if (!rec.has(item.kind)) rec.set(item.kind, []);
      rec.get(item.kind).push({ scale: item.scale, box: item.box });
    });
  });

  const urban = new Map();
  const ward = new Map();
  units.forEach(u => {
    const slot = slots.get(u.key);
    if (u.key.startsWith('w:')) ward.set(u.key.slice(2), slot);
    else urban.set(u.key.slice(2), slot);
  });
  return { urban, ward };
}

function bundleUrban(urban) {
  if (!urban) return null;
  return byUrban.get(urban.id) || null;
}

function bundleWard(name) {
  if (!name) return null;
  return byWard.get(bareName(name)) || null;
}

export function factsForUrban(urban) {
  return bundleUrban(urban);
}

export function factsForWard(name) {
  return bundleWard(name);
}

function landText(b) {
  const codes = Object.entries(b.landCodes).filter(([, m2]) => m2 > 0).sort((a, c) => c[1] - a[1]).slice(0, 4);
  if (!codes.length) return 'Không có lớp hiện trạng sử dụng đất trong ranh. Repo chỉ có KCN Phong Điền; Phú Lộc và Vinh Hưng nằm trên GCS, không tải khi mở bảng.';
  const list = codes.map(([code, m2]) => `${code} ${N1.format(m2 / 10000)} ha`).join(', ');
  return `Hiện trạng sử dụng đất KCN Phong Điền (dientich, mã maloaidat) cắt theo ranh: ${list}. Không phải tỷ lệ xanh trên diện tích tự nhiên.`;
}

const FEEDS = {
  '2A.III.06': (b) => ({
    aside: `tạm thời ${b.junctions} điểm`,
    text: `Nguồn tạm thời: hien-trang-tam/giao-thong.geojson, điểm (không lấy mặt cắt). ${b.junctions} điểm trong ranh. Chưa có cấp vùng, tỉnh, xã nên không chấm mức.`
  }),
  '2A.III.07': (b) => ({
    aside: `tạm thời ${km(b.roadM)} đường`,
    text: `Nguồn tạm thời: hien-trang-tam/giao-thong.geojson, nhom=mang. ${km(b.roadM)} trong ranh. Mật độ chấm vẫn là OSM trên đất xây dựng; số tạm thời không thay mật độ.`
  }),
  '2A.III.08': (b) => ({
    aside: `tạm thời ${km(b.pipeM)} ống`,
    text: `Nguồn tạm thời: hien-trang-tam/cap-nuoc.geojson. ${km(b.pipeM)} ống, ${b.plants} điểm, tổng congsuat ${N1.format(b.waterCap)} (điểm có số). Không phải tỷ lệ dân được cấp nước.`
  }),
  '2A.III.09': (b) => ({
    aside: `${km(b.drainM)} thoát`,
    text: `Nguồn: lớp đường thoát nước mưa hiện trạng của đồ án (chưa file gộp). ${km(b.drainM)} trong ranh, ưu tiên tỷ lệ chi tiết hơn. Không phải mật độ cống chính trên đất xây dựng.`
  }),
  '2A.III.10': (b) => ({
    aside: `${b.wwtp} trạm XLNT`,
    text: `Nguồn: điểm xử lý nước thải hiện trạng, thuộc tính congsuat. ${b.wwtp} điểm, tổng ${N1.format(b.wwtpCap)}. Không có cặp công suất vận hành và thiết kế.`
  }),
  '2A.III.11': (b) => ({
    aside: `${b.wasteN} điểm CTR`,
    text: `Nguồn: điểm chất thải rắn hiện trạng. ${b.wasteN} điểm trong ranh. Không có tỷ lệ xử lý đạt.`
  }),
  '2A.III.12': (b) => ({
    aside: `${b.cemeteryN} nghĩa trang`,
    text: `Nguồn: điểm nghĩa trang hiện trạng. ${b.cemeteryN} điểm trong ranh. Không có tỷ lệ diện tích đã xây trên quy hoạch.`
  }),
  '2A.III.21': (b) => ({
    aside: b.landM2 > 0 ? `${N1.format(b.landM2 / 10000)} ha KCN` : 'chưa có lớp đất',
    text: landText(b)
  }),
  '1.III.11': (b) => ({
    aside: `tạm thời ${b.junctions} điểm`,
    text: `Nguồn tạm thời: điểm đầu mối giao-thong.geojson. ${b.junctions} điểm trong ranh thành phố. Không ghi cấp khu vực hay quốc tế.`
  }),
  '1.III.12': (b) => ({
    aside: `tạm thời ${km(b.railM)} sắt, ${km(b.waterwayM)} thủy`,
    text: `Nguồn tạm thời: nhom=duong-sat ${km(b.railM)}, nhom=duong-thuy ${km(b.waterwayM)} trong ranh. Không cộng vào điều kiện phủ xe buýt.`
  })
};

export function describeHt(code, urban) {
  const feed = FEEDS[code];
  if (!feed) return null;
  if (!ready) {
    if (!started) return null;
    return { aside: '', text: failed ? 'Không tải được lớp hiện trạng.' : 'Đang tải lớp hiện trạng.' };
  }
  const b = bundleUrban(urban);
  if (!b) return null;
  return feed(b);
}

export function mergeEntry(m, ht) {
  if (!m || !ht || !ht.text) return m;
  if (m.officer) return { ...m, note: `${m.note || ''} Ghi đè số tự tính. Không dùng: ${ht.text}`.trim() };
  return { ...m, note: [m.note, ht.text].filter(Boolean).join(' '), aside: ht.aside || '' };
}

export function htFootNote(urban, wardName) {
  if (!ready) return started ? (failed ? 'Không tải được lớp hiện trạng.' : 'Đang tải lớp hiện trạng.') : '';
  const b = bundleUrban(urban);
  if (!b) return '';
  const bits = [
    `Cấp điện, tạm thời: ${km(b.powerM)} đường dây, ${b.stations} trạm trong ranh. Không có tiêu chí A/B.`,
    `Thông tin liên lạc, hiện trạng đồ án chưa gộp: ${km(b.telecomM)}, ${b.telecomN} trạm. Không có tiêu chí A/B.`
  ];
  const w = bundleWard(wardName);
  if (w) bits.push(`Xã/phường đang chọn, tạm thời: ${km(w.roadM)} đường bộ, ${km(w.pipeM)} ống cấp nước, ${w.junctions} điểm đầu mối.`);
  return bits.join(' ');
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function loadHienTrangFacts(urbans) {
  started = true;
  if (ready) return Promise.resolve({ urban: byUrban, ward: byWard });
  if (!promise) {
    const base = new URL('../data/', import.meta.url);
    promise = (async () => {
      const [wardFc, layers] = await Promise.all([
        fetchJson(new URL('ward-boundary.json', base)),
        Promise.all(HT_FILES.map(async spec => {
          try {
            return { spec, fc: await fetchJson(new URL(spec.file, base)) };
          } catch (err) {
            console.warn('Hiện trạng chấm điểm bỏ lớp', spec.file, err);
            return { spec, fc: { features: [] } };
          }
        })),
        loadPartGeoms()
      ]);
      const urbanFc = { features: allPartFeatures() };
      const built = buildFacts(layers, urbanFc, wardFc, urbans);
      byUrban = built.urban;
      byWard = built.ward;
      ready = true;
      return built;
    })().catch(err => {
      promise = null;
      failed = true;
      throw err;
    });
  }
  return promise;
}

export function _resetHtForTest() {
  started = false;
  ready = false;
  failed = false;
  promise = null;
  byUrban = new Map();
  byWard = new Map();
}

export function _installFactsForTest(built) {
  byUrban = built.urban;
  byWard = built.ward;
  started = true;
  ready = true;
  failed = false;
}
