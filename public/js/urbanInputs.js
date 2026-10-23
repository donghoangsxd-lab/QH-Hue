// Số cán bộ nhập, chỉ trên trình duyệt. Bảng phân loại đọc kho này, không gọi mạng khi mở.
import { ENTRY_STORE_KEY, OFFICER_STORE_KEY } from './urbanEntrySchema.js';

function memory() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch (e) {
    return null;
  }
}

function readJson(key) {
  const box = memory();
  if (!box) return null;
  try {
    const raw = JSON.parse(box.getItem(key) || 'null');
    return raw && typeof raw === 'object' ? raw : null;
  } catch (e) {
    return null;
  }
}

export function readAll() {
  const raw = readJson(ENTRY_STORE_KEY);
  return raw || {};
}

export function readUnit(unitKey) {
  const row = readAll()[unitKey];
  return row && typeof row === 'object' ? row : null;
}

export function valueOf(unitKey, field) {
  const row = readUnit(unitKey);
  if (!row || row[field] == null || row[field] === '') return null;
  return row[field];
}

export function writeUnit(unitKey, fields, meta) {
  const box = memory();
  if (!box || !unitKey) return;
  const all = readAll();
  const next = {};
  Object.entries(fields || {}).forEach(([k, v]) => {
    if (k.startsWith('_')) return;
    if (v == null || v === '') return;
    next[k] = String(v).slice(0, 40);
  });
  next._meta = {
    officer: String(meta && meta.officer || '').slice(0, 80),
    at: Date.now()
  };
  all[unitKey] = next;
  box.setItem(ENTRY_STORE_KEY, JSON.stringify(all));
}

export function replaceAll(map) {
  const box = memory();
  if (!box) return;
  box.setItem(ENTRY_STORE_KEY, JSON.stringify(map && typeof map === 'object' ? map : {}));
}

export function readOfficer() {
  const raw = readJson(OFFICER_STORE_KEY);
  if (!raw) return { name: '', unitKey: '' };
  return { name: String(raw.name || '').slice(0, 80), unitKey: String(raw.unitKey || '') };
}

export function writeOfficer(officer) {
  const box = memory();
  if (!box) return;
  box.setItem(OFFICER_STORE_KEY, JSON.stringify({
    name: String(officer && officer.name || '').slice(0, 80),
    unitKey: String(officer && officer.unitKey || '')
  }));
}

export function officerCanEdit(unitKey) {
  const lock = readOfficer().unitKey;
  if (!lock) return true;
  return lock === unitKey;
}
