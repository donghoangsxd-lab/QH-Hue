// Thu thập / lọc / CSV cho bảng danh mục đồ án (B) và dự án đầu tư (F).
import { namesOfProject } from './projectNames.js';
import { planLevelOf } from './generalPlan.js';
import { INVEST_GROUPS, investGroupLabel } from './investClassify.js';
import {
  matchSoTayToCatalog, classifyPlanStatus, missingLabel, STATUS
} from './soTayMatch.js';
import { WARD_NAMES } from './facetStore.js';
import { bareName } from './urbanStatus.js';

export const CATALOG_HEADERS_PLAN = [
  'STT', 'Tên quy hoạch', 'Đơn vị', 'Cấp', 'Diện tích (ha)', 'Trạng thái', 'Ranh', 'Ghi chú'
];
export const CATALOG_HEADERS_INVEST = ['STT', 'Tên dự án', 'Phường / xã', 'Quy mô', 'Ranh giới', 'Ghi chú'];
export const CATALOG_HEADERS = CATALOG_HEADERS_PLAN;

export { STATUS };

const LEVEL_SCALE = {
  QHC: 'QHC',
  QHPK: 'QHPK 1/2.000',
  QHCT: 'QHCT 1/500'
};

const LEVEL_KEYS = ['QHC', 'QHPK', 'QHCT'];
const LEVEL_RANK = { QHC: 0, QHPK: 1, QHCT: 2 };
const LEVEL_GROUP_LABEL = {
  QHC: 'A. QHC',
  QHPK: 'B. QHPK',
  QHCT: 'C. QHCT'
};

/** Năm phê duyệt từ cột ngày sổ tay (dd/mm/yyyy). */
export function planYearOf(ngay) {
  const raw = String(ngay || '').trim();
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(19\d{2}|20\d{2})/);
  if (!m) return null;
  const y = Number(m[3]);
  return (y >= 1990 && y <= 2035) ? y : null;
}

function levelRank(level) {
  return Object.prototype.hasOwnProperty.call(LEVEL_RANK, level) ? LEVEL_RANK[level] : 9;
}

function sortPlanRows(rows) {
  return rows.sort((a, b) => {
    const d = levelRank(a.level) - levelRank(b.level);
    if (d) return d;
    return String(a.name || '').localeCompare(String(b.name || ''), 'vi');
  });
}

function haystack(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/** Khớp một chuỗi địa bàn với đúng một trong 40 phường/xã. */
export function matchCatalogWard(raw, wardNames = WARD_NAMES) {
  const b = bareName(raw);
  if (!b || b.length < 2) return '';
  const names = Array.isArray(wardNames) ? wardNames : WARD_NAMES;
  const exact = names.find((n) => bareName(n) === b);
  if (exact) return exact;
  // Ưu tiên tên dài nhất nằm trong chuỗi (tránh «Phú» khớp nhầm).
  let best = '';
  let bestLen = 0;
  for (const n of names) {
    const bn = bareName(n);
    if (bn.length < 3) continue;
    if (b === bn || b.includes(bn) || bn.includes(b)) {
      if (bn.length > bestLen) {
        best = n;
        bestLen = bn.length;
      }
    }
  }
  return best;
}

/** Liệt kê mọi phường/xã xuất hiện trong văn bản (tên / địa điểm / dvhc). */
export function findCatalogWardsInText(text, wardNames = WARD_NAMES) {
  const hay = haystack(text);
  if (!hay) return [];
  const names = Array.isArray(wardNames) ? wardNames : WARD_NAMES;
  const ranked = names
    .map((n) => ({ n, b: bareName(n) }))
    .filter(({ b }) => b.length >= 3 && hay.includes(b))
    .sort((a, b) => b.b.length - a.b.length);
  const out = [];
  const used = new Set();
  for (const { n, b } of ranked) {
    // Bỏ tên ngắn hơn đã nằm trong tên dài hơn đã chọn (vd Hương trong Hương Thủy).
    if ([...used].some((u) => u.includes(b) || b.includes(u))) continue;
    used.add(b);
    out.push(n);
  }
  return out;
}

function isOldDistrictLabel(raw) {
  return /^(Quận|Huyện|Thị\s*xã)\b/i.test(String(raw || '').trim());
}

/**
 * Gán đồ án vào các phường/xã 40 đơn vị: ưu tiên `project.wards`, rồi quét địa điểm/tên.
 * Không map cả «Huyện/Quận/Thị xã …» cũ sang một phường trùng tên.
 * Một đồ án có thể thuộc nhiều phường (đếm ở mỗi cột).
 */
export function resolvePlanWards(item, project, wardNames = WARD_NAMES) {
  const names = Array.isArray(wardNames) ? wardNames : WARD_NAMES;
  const out = [];
  const seen = new Set();
  const add = (name) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push(name);
  };
  if (Array.isArray(project?.wards)) {
    for (const w of project.wards) add(matchCatalogWard(w, names));
  }
  if (out.length) return out;
  for (const raw of [item?.diaDiem, item?.ten, project?.tenQH]) {
    findCatalogWardsInText(raw, names).forEach(add);
  }
  if (out.length) return out;
  if (item?.dvhc && !isOldDistrictLabel(item.dvhc)) {
    add(matchCatalogWard(item.dvhc, names));
  }
  return out;
}

function shortWardLabel(name) {
  return String(name || '').replace(/^Phường\s+/i, '').replace(/^Xã\s+/i, '').trim();
}

/** mapLevel id → khóa lọc cấp đồ án (QHC/QHPK/QHCT) hoặc '' = tất cả. */
export function filterKeyFromMapLevel(levelId) {
  const id = String(levelId || '');
  if (id === 'qhpk') return 'QHPK';
  if (id === 'qhct') return 'QHCT';
  if (id === 'qhc25' || id === 'qhc10') return 'QHC';
  return '';
}

function webAreaHa(p, areaHaOf) {
  if (typeof areaHaOf === 'function') {
    const n = areaHaOf(p);
    if (Number.isFinite(n) && n > 0 && n < 1e9) return n;
  }
  return null;
}

function formatHa(n) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  return Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

/** Ghép sổ tay + catalog webapp thành hàng bảng danh mục trục B. */
export function planRowsFromSoTay(sheetItems, catalog, opts = {}) {
  const list = Array.isArray(catalog) ? catalog : [];
  const items = Array.isArray(sheetItems) ? sheetItems : [];
  const areaHaOf = opts.areaHaOf;
  const { matches, orphans } = matchSoTayToCatalog(items, list, {
    levelOf: (p) => planLevelOf(p.tenQH || namesOfProject(p).tenQH),
    areaHaOf: (p) => webAreaHa(p, areaHaOf)
  });

  const rows = [];
  for (const item of items) {
    const hit = matches.get(item.ma);
    const p = hit?.project || null;
    const names = p ? namesOfProject(p) : { tenQH: item.ten, tenRutGon: item.ten };
    const level = item.cap || (p ? planLevelOf(p.tenQH || names.tenQH) : '');
    const hasBoundary = !!(p && p.boundary);
    const { status, missing } = classifyPlanStatus(item, hit, hasBoundary);
    const notes = [];
    if (missing.length) notes.push(missingLabel(missing));
    if (item.soDccb) notes.push(`${item.soDccb} ĐCCB`);
    if (item.quyetDinh) notes.push(item.quyetDinh);
    if (p?.legacy) notes.push('Đồ án cũ trên bản đồ');
    const wards = resolvePlanWards(item, p);
    rows.push({
      id: item.ma,
      source: 'plan',
      name: item.ten || names.tenRutGon || names.tenQH || '',
      fullName: names.tenQH || item.ten || '',
      ward: wards.length ? wards.join(', ') : (item.dvhc || item.diaDiem || ''),
      wards,
      scale: LEVEL_SCALE[level] || level || '',
      level,
      year: planYearOf(item.ngay),
      areaHa: item.dienTichHa,
      areaText: item.dienTichText || formatHa(item.dienTichHa),
      status,
      statusLabel: STATUS[status]?.label || status,
      hasBoundary,
      note: notes.join(' · '),
      zoomKey: hasBoundary ? (names.tenQH || '') : '',
      maDoAn: item.ma,
      quyetDinh: item.quyetDinh || '',
      linkGis: item.linkGis || '',
      matched: !!hit
    });
  }

  for (const p of orphans) {
    const names = namesOfProject(p);
    const level = planLevelOf(p.tenQH || names.tenQH);
    const hasBoundary = !!(p && p.boundary);
    const ha = webAreaHa(p, areaHaOf);
    const { status, missing } = classifyPlanStatus(null, { project: p }, hasBoundary);
    const notes = [];
    if (missing.length) notes.push(missingLabel(missing));
    notes.push('Có trên bản đồ, chưa thấy trong sổ tay');
    if (p.legacy) notes.push('Đồ án cũ');
    const wards = resolvePlanWards(null, p);
    rows.push({
      id: `web:${p.slug || names.tenQH}`,
      source: 'plan',
      name: names.tenRutGon || names.tenQH || '',
      fullName: names.tenQH || '',
      ward: wards.length ? wards.join(', ') : (Array.isArray(p.wards) ? p.wards.filter(Boolean).join(', ') : ''),
      wards,
      scale: LEVEL_SCALE[level] || level || '',
      level,
      year: null,
      areaHa: ha,
      areaText: formatHa(ha),
      status,
      statusLabel: STATUS[status]?.label || status,
      hasBoundary,
      note: notes.join(' · '),
      zoomKey: hasBoundary ? (names.tenQH || '') : '',
      maDoAn: '',
      quyetDinh: p.decision?.name || '',
      linkGis: '',
      matched: false
    });
  }

  return sortPlanRows(rows);
}

/** Giữ API cũ: chỉ catalog webapp (không sổ tay). */
export function planRowsFromCatalog(catalog) {
  return planRowsFromSoTay([], catalog);
}

function sheetEntry(row, re) {
  if (!row) return '';
  const key = Object.keys(row).find(k => re.test(k));
  return key ? String(row[key] || '').replace(/\s+/g, ' ').trim() : '';
}

/** items: mảng từ investLayer.listInvestCatalogItems() */
export function investRowsFromItems(items) {
  const list = Array.isArray(items) ? items : [];
  return list.map((p, i) => {
    const sheet = p.sheet || null;
    const place = sheetEntry(sheet, /địa điểm/i);
    const field = sheetEntry(sheet, /lĩnh vực/i) || p.sector?.label || '';
    const priority = sheetEntry(sheet, /ưu tiên/i);
    const notes = [];
    if (field) notes.push(field);
    if (priority) notes.push(`Ưu tiên: ${priority}`);
    if (!p.hasBoundary) notes.push(p.sheetOnly ? 'Chỉ danh sách, chưa có ranh' : 'Chưa ghép ranh');
    if (p.matched === false) notes.push('Chưa khớp sheet');
    return {
      id: String(p.id || i),
      source: 'invest',
      name: p.title || '',
      fullName: p.title || '',
      ward: place || '',
      scale: p.areaText || investGroupLabel(p.dtGroup) || '',
      level: p.dtGroup || 'khac',
      areaText: p.areaText || '',
      status: '',
      statusLabel: '',
      hasBoundary: !!p.hasBoundary,
      note: notes.join(' · '),
      zoomKey: String(p.id || '')
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

export function filterCatalogRows(rows, { query = '', level = '', status = '', ward = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const lv = String(level || '').trim();
  const st = String(status || '').trim();
  const wd = String(ward || '').trim();
  const filtered = (rows || []).filter(r => {
    if (lv && r.level !== lv) return false;
    if (st && r.status !== st) return false;
    if (wd) {
      const list = Array.isArray(r.wards) ? r.wards : [];
      if (!list.includes(wd) && matchCatalogWard(r.ward) !== wd) return false;
    }
    if (!q) return true;
    const blob = `${r.name} ${r.fullName} ${r.ward} ${r.scale} ${r.statusLabel} ${r.note} ${r.quyetDinh || ''}`.toLowerCase();
    return blob.includes(q);
  });
  if (filtered.some((r) => r.source === 'plan' || LEVEL_KEYS.includes(r.level))) {
    return sortPlanRows(filtered.slice());
  }
  return filtered;
}

export function catalogFilterOptions(source) {
  if (source === 'invest') {
    return [{ value: '', label: 'Tất cả nhóm' }].concat(
      INVEST_GROUPS.map(g => ({ value: g.id, label: g.label || g.title }))
    );
  }
  return [
    { value: '', label: 'Tất cả cấp' },
    { value: 'QHC', label: 'A. QHC' },
    { value: 'QHPK', label: 'B. QHPK 1/2.000' },
    { value: 'QHCT', label: 'C. QHCT 1/500' }
  ];
}

export function catalogWardFilterOptions(wardNames = WARD_NAMES) {
  const names = Array.isArray(wardNames) ? wardNames : WARD_NAMES;
  return [
    { value: '', label: 'Tất cả phường / xã' },
    ...names.map((n) => ({ value: n, label: shortWardLabel(n) }))
  ];
}

/** Nhóm bảng mặc định A. QHC → B. QHPK → C. QHCT (và «Khác» nếu còn). */
export function groupPlanRowsByLevel(rows) {
  const buckets = { QHC: [], QHPK: [], QHCT: [], khac: [] };
  for (const r of rows || []) {
    if (LEVEL_KEYS.includes(r.level)) buckets[r.level].push(r);
    else buckets.khac.push(r);
  }
  const out = [];
  for (const id of LEVEL_KEYS) {
    if (!buckets[id].length) continue;
    out.push({ type: 'group', id, label: LEVEL_GROUP_LABEL[id], count: buckets[id].length });
    for (const r of buckets[id]) out.push({ type: 'row', row: r });
  }
  if (buckets.khac.length) {
    out.push({ type: 'group', id: 'khac', label: 'Khác', count: buckets.khac.length });
    for (const r of buckets.khac) out.push({ type: 'row', row: r });
  }
  return out;
}

export function catalogStatusOptions() {
  return [
    { value: '', label: 'Mọi trạng thái' },
    ...Object.values(STATUS).map((s) => ({ value: s.id, label: s.label }))
  ];
}

export function catalogStatusStats(rows) {
  const by = { du: 0, thieu: 0, chi_so_tay: 0, chi_ban_do: 0 };
  const byLevel = { QHC: 0, QHPK: 0, QHCT: 0, khac: 0 };
  for (const r of rows || []) {
    if (by[r.status] != null) by[r.status] += 1;
    const lv = r.level || 'khac';
    if (byLevel[lv] != null) byLevel[lv] += 1;
    else byLevel.khac += 1;
  }
  return { byStatus: by, byLevel, total: (rows || []).length };
}

/**
 * Số đồ án theo 40 phường/xã, tách QHC / QHPK / QHCT (cột chồng).
 * Đồ án nhiều phường được đếm ở mỗi phường; đồ án không gán được → unmatched.
 */
export function catalogWardLevelStats(rows, wardNames = WARD_NAMES) {
  const names = (Array.isArray(wardNames) && wardNames.length ? wardNames : WARD_NAMES).slice();
  const idx = new Map(names.map((n, i) => [n, i]));
  const qhc = names.map(() => 0);
  const qhpk = names.map(() => 0);
  const qhct = names.map(() => 0);
  let unmatched = 0;
  for (const r of rows || []) {
    const level = String(r.level || '').toUpperCase();
    if (!LEVEL_KEYS.includes(level)) continue;
    const list = Array.isArray(r.wards) && r.wards.length
      ? r.wards
      : resolvePlanWards(
        { dvhc: r.ward, diaDiem: r.ward, ten: r.name },
        { wards: r.wards, tenQH: r.fullName },
        names
      );
    if (!list.length) {
      unmatched += 1;
      continue;
    }
    const bucket = level === 'QHC' ? qhc : level === 'QHPK' ? qhpk : qhct;
    for (const w of list) {
      const i = idx.get(w);
      if (i == null) continue;
      bucket[i] += 1;
    }
  }
  return {
    labels: names.map(shortWardLabel),
    fullNames: names,
    qhc,
    qhpk,
    qhct,
    unmatched,
    total: (rows || []).length
  };
}

/** Cột chồng số đồ án theo năm phê duyệt × QHC/QHPK/QHCT. */
export function catalogYearLevelStats(rows) {
  const byYear = new Map();
  let unknown = 0;
  for (const r of rows || []) {
    const level = String(r.level || '').toUpperCase();
    if (!LEVEL_KEYS.includes(level)) continue;
    const y = Number.isFinite(r.year) ? r.year : planYearOf(r.ngay);
    if (!y) {
      unknown += 1;
      continue;
    }
    if (!byYear.has(y)) byYear.set(y, { QHC: 0, QHPK: 0, QHCT: 0 });
    byYear.get(y)[level] += 1;
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  return {
    labels: years.map(String),
    years,
    qhc: years.map((y) => byYear.get(y).QHC),
    qhpk: years.map((y) => byYear.get(y).QHPK),
    qhct: years.map((y) => byYear.get(y).QHCT),
    unknown,
    total: (rows || []).length
  };
}

export function rowsToCsv(rows, source = 'plan') {
  const escape = (v) => {
    const s = String(v ?? '');
    return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  if (source === 'invest') {
    const lines = [CATALOG_HEADERS_INVEST.join(',')];
    (rows || []).forEach((r, i) => {
      lines.push([
        i + 1, r.name, r.ward, r.scale,
        r.hasBoundary ? 'Có' : 'Chưa', r.note
      ].map(escape).join(','));
    });
    return `\uFEFF${lines.join('\r\n')}`;
  }
  const lines = [CATALOG_HEADERS_PLAN.join(',')];
  (rows || []).forEach((r, i) => {
    lines.push([
      i + 1,
      r.name,
      r.ward,
      r.scale,
      r.areaText || '',
      r.statusLabel || '',
      r.hasBoundary ? 'Có' : 'Chưa',
      r.note
    ].map(escape).join(','));
  });
  return `\uFEFF${lines.join('\r\n')}`;
}

export function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename || 'danh-muc.csv';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}
