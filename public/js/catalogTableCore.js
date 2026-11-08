// Thu thập / lọc / CSV cho bảng danh mục đồ án (B) và dự án đầu tư (F).
import { namesOfProject } from './projectNames.js';
import { planLevelOf } from './generalPlan.js';
import { INVEST_GROUPS, investGroupLabel } from './investClassify.js';

export const CATALOG_HEADERS_PLAN = ['STT', 'Tên quy hoạch', 'Phường / xã', 'Cấp', 'Ranh giới', 'Ghi chú'];
export const CATALOG_HEADERS_INVEST = ['STT', 'Tên dự án', 'Phường / xã', 'Quy mô', 'Ranh giới', 'Ghi chú'];
export const CATALOG_HEADERS = CATALOG_HEADERS_PLAN;

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

export function planRowsFromCatalog(catalog) {
  const list = Array.isArray(catalog) ? catalog : [];
  return list.map((p, i) => {
    const names = namesOfProject(p);
    const level = planLevelOf(p.tenQH || names.tenQH);
    const hasBoundary = !!(p && p.boundary);
    const wards = Array.isArray(p.wards) ? p.wards.filter(Boolean) : [];
    const notes = [];
    if (!hasBoundary) notes.push('Chỉ danh sách, chưa gán ranh');
    if (p.legacy) notes.push('Đồ án cũ');
    if (p.decision && (p.decision.name || p.decision.slug)) notes.push(p.decision.name || 'Có quyết định');
    if (p.time) notes.push(String(p.time));
    return {
      id: String(p.slug || names.tenQH || i),
      source: 'plan',
      name: names.tenRutGon || names.tenQH || '',
      fullName: names.tenQH || names.tenDayDu || '',
      ward: wards.join(', '),
      scale: LEVEL_SCALE[level] || level || '',
      level,
      hasBoundary,
      note: notes.join(' · '),
      zoomKey: names.tenQH || ''
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
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
      hasBoundary: !!p.hasBoundary,
      note: notes.join(' · '),
      zoomKey: String(p.id || '')
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

export function filterCatalogRows(rows, { query = '', level = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const lv = String(level || '').trim();
  return (rows || []).filter(r => {
    if (lv && r.level !== lv) return false;
    if (!q) return true;
    const blob = `${r.name} ${r.fullName} ${r.ward} ${r.scale} ${r.note}`.toLowerCase();
    return blob.includes(q);
  });
}

export function catalogFilterOptions(source) {
  if (source === 'invest') {
    // Nhãn ngắn (DVTM…) để ô lọc không tràn toolbar; title dài chỉ dùng title attribute ngoài UI này.
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

export function rowsToCsv(rows, source = 'plan') {
  const escape = (v) => {
    const s = String(v ?? '');
    return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headers = source === 'invest' ? CATALOG_HEADERS_INVEST : CATALOG_HEADERS_PLAN;
  const lines = [headers.join(',')];
  (rows || []).forEach((r, i) => {
    lines.push([
      i + 1,
      r.name,
      r.ward,
      r.scale,
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
