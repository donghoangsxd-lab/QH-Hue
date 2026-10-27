// Phiên bản dữ liệu lưu trên máy (localStorage). Hồ sơ thường giữ khóa cũ sau khi xóa cache;
// cửa sổ ẩn danh không có khóa nên không lỗi. Mỗi lần nâng STORAGE_VERSION, loadHidden chạy lại.
//
// Phiên 0 — trước 2f84d44: enableMaster ghi mọi đồ án chưa hiện vào qh_hidden_projects, kể cả QHC 1/10.000.
// Phiên 1 — 2f84d44: cờ qh_hidden_kind_fix='1' chỉ lọc một lần. Máy đã có cờ thì tên QHC ghi lại
// (nút mắt nhóm, hoặc lần lưu sau cờ) không bị bỏ, ranh QHC biến mất, chỉ còn vùng trung tâm.
// Phiên 2: lọc lại qh_hidden_projects (chỉ giữ QHPK) và bỏ khóa "<Ten_QH>|ranh-gioi" của QHC/QHCT.
// Phiên 3: không còn ghi / khôi phục đồ án ẩn và khóa ranh-gioi. Mỗi lần mở trang hiện đủ ranh mọi đồ án.
import { planLevelOf } from './generalPlan.js';

export const STORAGE_VERSION = 3;
export const STORAGE_VERSION_KEY = 'qh_storage_version';
export const HIDDEN_KIND_FIX_KEY = 'qh_hidden_kind_fix';
export const HIDDEN_PROJECTS_KEY = 'qh_hidden_projects';

export function readStorageVersion(store) {
  const raw = store.getItem(STORAGE_VERSION_KEY);
  if (raw != null && String(raw).trim() !== '') {
    const text = String(raw).trim();
    const n = Number(text);
    if (Number.isInteger(n) && String(n) === text && n >= 0) return n;
    return 0;
  }
  if (store.getItem(HIDDEN_KIND_FIX_KEY)) return 1;
  return 0;
}

function asNameList(value) {
  if (!Array.isArray(value)) return null;
  if (value.some(x => typeof x !== 'string' && typeof x !== 'number')) return null;
  return value.map(String);
}

/** ok: JSON là mảng tên. Hỏng hoặc không phải mảng thì list rỗng để bỏ. */
export function parseNameList(raw) {
  if (raw == null || raw === '') return { ok: true, list: [] };
  try {
    const list = asNameList(JSON.parse(raw));
    return list ? { ok: true, list } : { ok: false, list: [] };
  } catch {
    return { ok: false, list: [] };
  }
}

/** Khóa lớp chính dạng "<Ten_QH>|ranh-gioi" — không lưu / không khôi phục (ranh luôn hiện khi mở). */
export function isBoundaryLayerKey(key) {
  const bar = String(key || '').indexOf('|');
  return bar >= 0 && key.slice(bar + 1) === 'ranh-gioi';
}

/** Phiên ≤ 2: bỏ tên QHC/QHCT khỏi danh sách ẩn và khóa ranh-gioi ngoài QHPK. Phiên 3 không còn dùng. */
export function migrateHiddenState(names, layerKeys) {
  const projects = (asNameList(names) || []).filter(n => planLevelOf(n) === 'QHPK');
  const layers = (asNameList(layerKeys) || []).filter(k => {
    if (isBoundaryLayerKey(k)) return planLevelOf(k.slice(0, k.indexOf('|'))) === 'QHPK';
    return true;
  });
  return { projects, layers };
}

/** Lọc lớp lưu máy: bỏ ranh-gioi; JSON hỏng → list rỗng. */
export function durableLayerKeys(raw) {
  const parsed = parseNameList(raw);
  return {
    ok: parsed.ok,
    list: parsed.list.filter(k => !isBoundaryLayerKey(k))
  };
}
