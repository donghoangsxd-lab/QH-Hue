// Hiệu chỉnh số tầng do quản trị bấm trên dấu chân. Khóa là tâm dấu chân, không ghi vào bldg-overrides.
// Một tầng = 4 m, cùng FLOOR_HEIGHT_M trong gbaStats.js.

export const FLOOR_M = 4;
export const FLOOR_MAX = 80;
export const FLOOR_EDIT_LIMIT = 4000;

export function floorKey(lng, lat) {
  const x = Number(lng);
  const y = Number(lat);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return '';
  return `${x.toFixed(5)},${y.toFixed(5)}`;
}

export function parseFloorPack(raw) {
  const edits = {};
  const src = raw && raw.edits && typeof raw.edits === 'object' && !Array.isArray(raw.edits) ? raw.edits : {};
  Object.keys(src).forEach((k) => {
    if (!/^-?\d+\.\d{5},-?\d+\.\d{5}$/.test(k)) return;
    const floors = Math.round(Number(src[k]));
    if (floors >= 1 && floors <= FLOOR_MAX) edits[k] = floors;
  });
  return { v: 1, saved: Math.round(Number(raw && raw.saved) || 0), edits };
}

export function floorsAt(pack, lng, lat) {
  const n = pack && pack.edits ? pack.edits[floorKey(lng, lat)] : 0;
  return n > 0 ? n : null;
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][1];
    const yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((ring[j][0] - ring[i][0]) * (lat - yi)) / (yj - yi) + ring[i][0]) inside = !inside;
  }
  return inside;
}

/** Số tầng đã sửa nếu điểm khóa nằm trong vòng (dấu chân GBA). Khối tháp riêng không dùng hàm này. */
export function floorsOnRing(pack, ring) {
  if (!pack || !pack.edits || !ring || ring.length < 3) return null;
  const keys = Object.keys(pack.edits);
  for (let i = 0; i < keys.length; i++) {
    const parts = keys[i].split(',');
    const lng = Number(parts[0]);
    const lat = Number(parts[1]);
    if (pointInRing(lng, lat, ring)) return pack.edits[keys[i]];
  }
  return null;
}

/** floors rỗng thì xóa khóa. Giữ mọi khóa khác. null nếu số tầng hoặc tọa độ không hợp lệ. */
export function mergeFloorEdit(pack, lng, lat, floors) {
  const key = floorKey(lng, lat);
  if (!key) return null;
  const clear = floors == null || floors === '';
  const n = clear ? null : Math.round(Number(floors));
  if (n != null && !(n >= 1 && n <= FLOOR_MAX)) return null;
  const edits = { ...((pack && pack.edits) || {}) };
  if (n == null) delete edits[key];
  else edits[key] = n;
  if (Object.keys(edits).length > FLOOR_EDIT_LIMIT) return null;
  return { v: 1, saved: Date.now(), edits };
}

export function metresForFloors(floors) {
  const n = Math.round(Number(floors));
  if (!(n >= 1 && n <= FLOOR_MAX)) return null;
  return n * FLOOR_M;
}
