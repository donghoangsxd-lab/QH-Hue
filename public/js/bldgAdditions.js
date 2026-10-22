// Dấu chân nhà do quản trị vẽ thêm. Lưu riêng, không ghi vào bldg-overrides.
// Một tầng = 4 m, cùng FLOOR_HEIGHT_M. Đế là vòng ngoài; tháp là vòng nằm trong, nhô lên trên đế.

import { partFloorLabel } from './bldgParts.js';

export const FLOOR_M = 4;
export const FLOOR_MAX = 80;
export const ADD_LIMIT = 300;
export const MIN_AREA_M2 = 20;
export const MAX_AREA_M2 = 150000;
export const MAX_RING_POINTS = 80;
const TOWER_MIN_AREA_M2 = 12;

export function inHue(lng, lat) {
  return lng >= 106.8 && lng <= 108.4 && lat >= 15.5 && lat <= 17.2;
}

export function newAdditionId() {
  const n = Date.now().toString(36);
  const r = Math.floor(Math.random() * (36 ** 4)).toString(36).padStart(4, '0');
  return `a${n}${r}`;
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

function cleanName(value) {
  return String(value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
}

/** Vòng khép, bỏ đỉnh trùng liên tiếp. null nếu không đủ điểm. */
export function normalizeRing(input) {
  if (!Array.isArray(input)) return null;
  const pts = [];
  for (const p of input) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const lng = Number(p[0]);
    const lat = Number(p[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    const q = [round6(lng), round6(lat)];
    const prev = pts[pts.length - 1];
    if (prev && prev[0] === q[0] && prev[1] === q[1]) continue;
    pts.push(q);
  }
  if (pts.length >= 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  if (pts.length < 3 || pts.length > MAX_RING_POINTS) return null;
  return [...pts, pts[0]];
}

export function ringAreaM2(ring) {
  if (!ring || ring.length < 4) return 0;
  const lat0 = ring[0][1];
  const mLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const mLat = 110540;
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * mLng * ring[i][1] * mLat - ring[i][0] * mLng * ring[j][1] * mLat;
  }
  return Math.abs(sum) / 2;
}

function orient(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function properCross(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  const eps = 1e-14;
  if (Math.abs(o1) < eps || Math.abs(o2) < eps || Math.abs(o3) < eps || Math.abs(o4) < eps) return false;
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

export function ringSelfIntersects(ring) {
  const pts = ring && ring.length && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1) : (ring || []);
  const n = pts.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      const c = pts[j];
      const d = pts[(j + 1) % n];
      if (properCross(a, b, c, d)) return true;
    }
  }
  return false;
}

export function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][1];
    const yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((ring[j][0] - ring[i][0]) * (lat - yi)) / (yj - yi) + ring[i][0]) inside = !inside;
  }
  return inside;
}

function floorsOf(value) {
  const n = Math.round(Number(value));
  return n >= 1 && n <= FLOOR_MAX ? n : null;
}

/** Chuỗi rỗng nếu vòng dùng được. */
export function ringIssue(ring) {
  const closed = normalizeRing(ring);
  if (!closed) return ring && ring.length > MAX_RING_POINTS + 1 ? 'Quá nhiều đỉnh' : 'Cần ít nhất 3 đỉnh';
  if (closed.some(([lng, lat]) => !inHue(lng, lat))) return 'Dấu chân ngoài thành phố Huế';
  if (ringSelfIntersects(closed)) return 'Dấu chân tự cắt';
  const area = ringAreaM2(closed);
  if (area < MIN_AREA_M2) return 'Diện tích quá nhỏ (dưới 20 m²)';
  if (area > MAX_AREA_M2) return 'Diện tích quá lớn';
  return '';
}

function towerIssue(outer, tower) {
  const ring = normalizeRing(tower);
  if (!ring) return 'Ranh tháp cần ít nhất 3 đỉnh';
  if (ring.some(([lng, lat]) => !inHue(lng, lat))) return 'Ranh tháp ngoài thành phố Huế';
  if (ringSelfIntersects(ring)) return 'Ranh tháp tự cắt';
  const area = ringAreaM2(ring);
  if (area < TOWER_MIN_AREA_M2) return 'Ranh tháp quá nhỏ';
  if (!(area < ringAreaM2(outer))) return 'Ranh tháp phải nhỏ hơn dấu chân';
  const open = ring.slice(0, -1);
  if (open.some(([lng, lat]) => !pointInRing(lng, lat, outer))) return 'Ranh tháp phải nằm trong dấu chân';
  return '';
}

function readTower(raw, outer) {
  if (!raw) return { tower: null, message: '' };
  const ring = normalizeRing(raw.ring);
  const message = towerIssue(outer, raw.ring);
  if (message) return { tower: null, message };
  const floors = floorsOf(raw.floors);
  if (!floors) return { tower: null, message: 'Số tầng tháp từ 1 đến 80' };
  return { tower: { ring, floors }, message: '' };
}

/** feature hợp lệ, hoặc { message }. id có thể để trống khi tạo mới. */
export function validateAddition(raw) {
  const ring = normalizeRing(raw && raw.ring);
  const issue = ringIssue(raw && raw.ring);
  if (issue) return { message: issue };
  const split = !!(raw && raw.tower);
  const floors = floorsOf(split && raw.podiumFloors != null ? raw.podiumFloors : raw.floors);
  if (!floors) return { message: 'Số tầng từ 1 đến 80' };
  const towerRead = split ? readTower(raw.tower, ring) : { tower: null, message: '' };
  if (towerRead.message) return { message: towerRead.message };
  const id = String((raw && raw.id) || '');
  if (id && !/^a[a-z0-9]{8,32}$/.test(id)) return { message: 'Mã dấu chân không hợp lệ' };
  return {
    feature: {
      id,
      name: cleanName(raw && raw.name),
      ring,
      floors,
      tower: towerRead.tower
    }
  };
}

export function parseAdditionPack(raw) {
  const features = [];
  const list = raw && Array.isArray(raw.features) ? raw.features : [];
  for (const item of list) {
    const checked = validateAddition(item);
    if (!checked.feature || !checked.feature.id) continue;
    features.push({
      ...checked.feature,
      by: cleanName(item.by),
      at: Math.round(Number(item.at) || 0)
    });
    if (features.length >= ADD_LIMIT) break;
  }
  return { v: 1, saved: Math.round(Number(raw && raw.saved) || 0), features };
}

function owns(feature, actor) {
  if (!feature.by) return true;
  return !!(actor && actor.email && feature.by === actor.email);
}

/** Gói mới, hoặc { message, status }. Không đụng các dấu chân khác. */
export function applyAddition(pack, body, actor) {
  const current = parseAdditionPack(pack);
  const op = body && body.op === 'delete' ? 'delete' : 'upsert';
  const features = current.features.slice();
  if (op === 'delete') {
    const id = String((body && body.id) || '');
    const idx = features.findIndex((f) => f.id === id);
    if (idx < 0) return { message: 'Không thấy dấu chân', status: 404 };
    if (!owns(features[idx], actor)) return { message: 'Chỉ người vẽ được sửa dấu chân này', status: 403 };
    features.splice(idx, 1);
  } else {
    const checked = validateAddition(body || {});
    if (!checked.feature) return { message: checked.message || 'Dấu chân không hợp lệ', status: 400 };
    const feature = checked.feature;
    const idx = feature.id ? features.findIndex((f) => f.id === feature.id) : -1;
    if (idx >= 0) {
      if (!owns(features[idx], actor)) return { message: 'Chỉ người vẽ được sửa dấu chân này', status: 403 };
      feature.by = features[idx].by;
      feature.at = Date.now();
      features[idx] = feature;
    } else {
      if (!feature.id) feature.id = newAdditionId();
      if (features.length >= ADD_LIMIT) return { message: 'Danh sách dấu chân đã đầy', status: 400 };
      feature.by = cleanName(actor && actor.email);
      feature.at = Date.now();
      features.push(feature);
    }
  }
  return { pack: { v: 1, saved: Date.now(), features } };
}

export function additionLabel(role, floors) {
  if (role === 'podium' || role === 'tower') return partFloorLabel(role, floors);
  const n = Math.round(Number(floors));
  return n >= 1 && n <= FLOOR_MAX ? String(n) : '';
}

/** Vòng ngoài để ẩn dấu chân GBA nằm bên dưới, tránh vẽ hai lần. */
export function coverRings(features) {
  return (features || []).map((f) => f.ring).filter((ring) => ring && ring.length >= 4);
}

export function coversPoint(features, lng, lat) {
  return coverRings(features).some((ring) => pointInRing(lng, lat, ring));
}

/** Khối 3D: chiều cao = số tầng × 4 m. Tháp đặt minHeight bằng nóc đế, không lấy chiều cao hàng xóm. */
export function toExplicitVolumes(features) {
  const extras = [];
  const masks = [];
  for (const f of features || []) {
    if (!f || !f.ring) continue;
    masks.push({ type: 'Polygon', coordinates: [f.ring] });
    if (f.tower && f.tower.ring) {
      const podiumH = f.floors * FLOOR_M;
      const towerTop = (f.floors + f.tower.floors) * FLOOR_M;
      extras.push({
        rings: [f.ring],
        explicit: true,
        added: true,
        height: podiumH,
        minHeight: 0,
        floors: f.floors,
        role: 'podium'
      });
      extras.push({
        rings: [f.tower.ring],
        explicit: true,
        added: true,
        height: towerTop,
        minHeight: podiumH,
        floors: f.tower.floors,
        groundFloors: f.floors,
        role: 'tower'
      });
    } else {
      extras.push({
        rings: [f.ring],
        explicit: true,
        added: true,
        height: f.floors * FLOOR_M,
        minHeight: 0,
        floors: f.floors,
        role: ''
      });
    }
  }
  return { extras, masks };
}
