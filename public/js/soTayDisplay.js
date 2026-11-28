/**
 * Nhãn hiển thị đồ án trên map/list/brief = tên sổ tay (sau patches / gán ranh),
 * khóa kỹ thuật vẫn là tenQH trên bucket (không rename).
 * Năm phê duyệt lấy từ hàng bảng tổng hợp (cột Ngày ban hành / year).
 */
export const SOTAY_DISPLAY_EVENT = 'sotay:display';

/** @type {Map<string, string>} tenQH|slug → tên sổ tay */
const byMapKey = new Map();
/** @type {Map<string, number>} tenQH|slug → năm phê duyệt */
const yearByMapKey = new Map();

function keysOf(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  return [s, s.toLowerCase()];
}

function yearOfRow(r) {
  const y = Number(r?.year);
  if (Number.isFinite(y) && y >= 1990 && y <= 2035) return y;
  return null;
}

/**
 * Cập nhật từ hàng bảng plan đã khớp (hasBoundary + zoomKey + name sổ tay).
 * @param {Array<{ hasBoundary?: boolean, zoomKey?: string, name?: string, fullName?: string, slug?: string, year?: number|null }>} rows
 */
export function rebuildSoTayDisplayFromPlanRows(rows) {
  byMapKey.clear();
  yearByMapKey.clear();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r?.hasBoundary) continue;
    const key = String(r.zoomKey || r.fullName || '').trim();
    if (!key) continue;
    const ten = String(r.name || '').trim();
    const year = yearOfRow(r);
    const mapKeys = [...keysOf(key), ...keysOf(r.slug), ...keysOf(r.fullName)];
    if (ten) {
      for (const k of mapKeys) byMapKey.set(k, ten);
    }
    if (year) {
      for (const k of mapKeys) yearByMapKey.set(k, year);
    }
  }
  try {
    document.dispatchEvent(new CustomEvent(SOTAY_DISPLAY_EVENT));
  } catch { /* môi trường không có document */ }
}

/** Đồng bộ nhanh một mã đã gán (trước khi refresh cả bảng). */
export function setSoTayDisplayName(tenQH, displayTen) {
  const key = String(tenQH || '').trim();
  const ten = String(displayTen || '').trim();
  if (!key || !ten) return;
  for (const k of keysOf(key)) byMapKey.set(k, ten);
  try {
    document.dispatchEvent(new CustomEvent(SOTAY_DISPLAY_EVENT));
  } catch { /* ignore */ }
}

/** Tên sổ tay để hiển thị; rỗng nếu chưa gắn. */
export function displayNameForTenQH(tenQH) {
  const s = String(tenQH || '').trim();
  if (!s) return '';
  return byMapKey.get(s) || byMapKey.get(s.toLowerCase()) || '';
}

/** Năm phê duyệt từ bảng tổng hợp (sổ tay); null nếu chưa khớp / thiếu ngày. */
export function decisionYearForTenQH(tenQH) {
  const s = String(tenQH || '').trim();
  if (!s) return null;
  const y = yearByMapKey.get(s) || yearByMapKey.get(s.toLowerCase());
  return Number.isFinite(y) ? y : null;
}
