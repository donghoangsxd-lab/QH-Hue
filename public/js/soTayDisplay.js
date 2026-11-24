/**
 * Nhãn hiển thị đồ án trên map/list/brief = tên sổ tay (sau patches / gán ranh),
 * khóa kỹ thuật vẫn là tenQH trên bucket (không rename).
 */
export const SOTAY_DISPLAY_EVENT = 'sotay:display';

/** @type {Map<string, string>} tenQH|slug → tên sổ tay */
const byMapKey = new Map();

function keysOf(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  return [s, s.toLowerCase()];
}

/**
 * Cập nhật từ hàng bảng plan đã khớp (hasBoundary + zoomKey + name sổ tay).
 * @param {Array<{ hasBoundary?: boolean, zoomKey?: string, name?: string, fullName?: string, maDoAn?: string }>} rows
 */
export function rebuildSoTayDisplayFromPlanRows(rows) {
  byMapKey.clear();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r?.hasBoundary) continue;
    const key = String(r.zoomKey || r.fullName || '').trim();
    if (!key) continue;
    const ten = String(r.name || '').trim();
    if (!ten) continue;
    for (const k of keysOf(key)) byMapKey.set(k, ten);
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
