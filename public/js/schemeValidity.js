/**
 * Đồ án hết hiệu lực (sổ tay patches.hieuLuc === false): ẩn khỏi list/lớp thường,
 * hiện trong nhóm Lưu trữ panel trục B.
 */
export const SOTAY_VALIDITY_EVENT = 'sotay:validity';

/** @type {Set<string>} tenQH|slug (kể cả lower-case) */
const archivedKeys = new Set();

function keysOf(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  return [s, s.toLowerCase()];
}

/**
 * @param {Array<{ hieuLuc?: boolean, zoomKey?: string, fullName?: string, name?: string, slug?: string, hasBoundary?: boolean }>} rows
 */
export function rebuildValidityFromPlanRows(rows) {
  archivedKeys.clear();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r?.hieuLuc !== false) continue;
    const keys = [
      r.zoomKey,
      r.fullName,
      r.slug,
      r.name
    ];
    for (const k of keys) {
      for (const x of keysOf(k)) archivedKeys.add(x);
    }
  }
  try {
    document.dispatchEvent(new CustomEvent(SOTAY_VALIDITY_EVENT));
  } catch { /* ignore */ }
}

/** true nếu tenQH/slug đang hết hiệu lực. */
export function isSchemeArchived(tenQH) {
  const s = String(tenQH || '').trim();
  if (!s) return false;
  return archivedKeys.has(s) || archivedKeys.has(s.toLowerCase());
}

export function archivedSchemeCount() {
  // Mỗi đồ án thường có 2 key (raw + lower) — đếm unique lower.
  const seen = new Set();
  for (const k of archivedKeys) {
    if (k === k.toLowerCase()) seen.add(k);
  }
  return seen.size;
}
