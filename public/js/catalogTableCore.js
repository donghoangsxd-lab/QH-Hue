// Thu thập / lọc / CSV cho bảng danh mục đồ án (B) và dự án đầu tư (F).
import { namesOfProject } from './projectNames.js';
import { planLevelOf } from './generalPlan.js';
import { INVEST_GROUPS, investGroupLabel } from './investClassify.js';
import {
  matchSoTayToCatalog, classifyPlanStatus, missingLabel, STATUS
} from './soTayMatch.js';

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
    rows.push({
      id: item.ma,
      source: 'plan',
      name: item.ten || names.tenRutGon || names.tenQH || '',
      fullName: names.tenQH || item.ten || '',
      ward: item.dvhc || item.diaDiem || '',
      scale: LEVEL_SCALE[level] || level || '',
      level,
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
    rows.push({
      id: `web:${p.slug || names.tenQH}`,
      source: 'plan',
      name: names.tenRutGon || names.tenQH || '',
      fullName: names.tenQH || '',
      ward: Array.isArray(p.wards) ? p.wards.filter(Boolean).join(', ') : '',
      scale: LEVEL_SCALE[level] || level || '',
      level,
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

  return rows.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
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

export function filterCatalogRows(rows, { query = '', level = '', status = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const lv = String(level || '').trim();
  const st = String(status || '').trim();
  return (rows || []).filter(r => {
    if (lv && r.level !== lv) return false;
    if (st && r.status !== st) return false;
    if (!q) return true;
    const blob = `${r.name} ${r.fullName} ${r.ward} ${r.scale} ${r.statusLabel} ${r.note} ${r.quyetDinh || ''}`.toLowerCase();
    return blob.includes(q);
  });
}

export function catalogFilterOptions(source) {
  if (source === 'invest') {
    return [{ value: '', label: 'Tất cả nhóm' }].concat(
      INVEST_GROUPS.map(g => ({ value: g.id, label: g.label || g.title }))
    );
  }
  return [
    { value: '', label: 'Tất cả cấp' },
    { value: 'QHC', label: 'QHC' },
    { value: 'QHPK', label: 'QHPK 1/2.000' },
    { value: 'QHCT', label: 'QHCT 1/500' }
  ];
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
