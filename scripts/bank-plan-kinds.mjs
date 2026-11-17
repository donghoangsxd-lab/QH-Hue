// Phân loại ô quy hoạch cho báo hiệu công trình: mở đường (đất giao thông) và cây xanh / công viên.
// Khớp build-gba-screen.py và extend-bank-plan-flags.mjs. Cờ reason: 8 = mở đường, 16 = cây xanh.

export const REASON_CORRIDOR = 1;
export const REASON_RPH = 2;
export const REASON_RDD = 4;
export const REASON_ROAD = 8;
export const REASON_GREEN = 16;
export const REASON_FOREST = REASON_RPH | REASON_RDD;
export const REASON_PLAN = REASON_ROAD | REASON_GREEN;

/** Mã LAND_CODES QHC 1/10.000: đất giao thông / giao thông đối ngoại. */
export const ROAD_LAND_CODES = new Set([32, 41]);
/** Mã cây xanh công cộng, hạn chế, chuyên dụng, TDTT. */
export const GREEN_LAND_CODES = new Set([5, 15, 16, 33]);

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/đ/g, 'd');
}

function wordsOf(value) {
  let text = fold(value);
  for (const ch of [',', '_', '-', '/', '→', '.', '(', ')']) text = text.replaceAll(ch, ' ');
  return text.split(/\s+/).filter(Boolean);
}

function bagOf(layer, name) {
  return ` ${wordsOf(`${layer || ''} ${name || ''}`).join(' ')} `;
}

/** Đất giao thông / mở đường — không lấy bãi đỗ. */
export function isRoadLot(layer, name) {
  const bag = bagOf(layer, name);
  if (/\b(bai do|bai xe|parking)\b/.test(bag)) return false;
  if (/\b(giao thong|mo duong|mat duong|bo via)\b/.test(bag)) return true;
  if (/\b(c-gtdt|c-gtdn|gtdt|gtdn|dgt)\b/.test(bag)) return true;
  if (/\bgt\b/.test(bag) && !/\b(giao thong thuy|duong thuy)\b/.test(bag)) return true;
  return false;
}

/** Đất công viên / cây xanh quy hoạch — không lấy rừng phòng hộ / đặc dụng. */
export function isGreenLot(layer, name) {
  const bag = bagOf(layer, name);
  if (/\b(rph|rdd|phong ho|dac dung|rung san xuat|rsx)\b/.test(bag)) return false;
  if (/\b(cay xanh|cong vien|vuon hoa|diem xanh)\b/.test(bag)) return true;
  if (/\b(c-cxdt|c-cxhc|c-cxcd|cx-hc|cx-cd|1-cv|cxdt|cxhc|cxcd)\b/.test(bag)) return true;
  return false;
}

export function isRoadLandCode(code) {
  return ROAD_LAND_CODES.has(Number(code));
}

export function isGreenLandCode(code) {
  return GREEN_LAND_CODES.has(Number(code));
}

export function colorOfReason(reason) {
  const c = reason & REASON_CORRIDOR;
  const f = reason & REASON_FOREST;
  const r = reason & REASON_ROAD;
  const g = reason & REASON_GREEN;
  const n = (c ? 1 : 0) + (f ? 1 : 0) + (r ? 1 : 0) + (g ? 1 : 0);
  if (n > 1) return '#c084fc';
  if (c) return '#f87171';
  if (f) return '#fbbf24';
  if (r) return '#38bdf8';
  if (g) return '#4ade80';
  return '#f87171';
}

/** Đọc một hàng pts bank-forest (v≤4: 6 cột; v≥5: 8 cột). */
export function parseBankRow(row, version = 1) {
  if ((version >= 5) || (Array.isArray(row) && row.length >= 8)) {
    return {
      lng: row[0], lat: row[1], ac: row[2], af: row[3],
      ar: row[4], ag: row[5], reason: row[6], ward: row[7]
    };
  }
  return {
    lng: row[0], lat: row[1], ac: row[2], af: row[3],
    ar: 0, ag: 0, reason: row[4], ward: row[5]
  };
}

export function packBankRow({ lng, lat, ac, af, ar, ag, reason, ward }) {
  return [
    Math.round(lng * 1e6) / 1e6,
    Math.round(lat * 1e6) / 1e6,
    Math.round(ac || 0),
    Math.round(af || 0),
    Math.round(ar || 0),
    Math.round(ag || 0),
    reason | 0,
    ward | 0
  ];
}
