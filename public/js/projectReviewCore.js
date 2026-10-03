// Thẩm định một đồ án quy hoạch từ hatch DXF theo QCVN 01:2026/BXD.
// Không ghi Sheet, không cộng vào chỉ tiêu phường hay thành phố.
import { parkTierOf } from './state.js';
import { tt16Layer, layerToType, layerMarksCurrent, sameSite } from './cadImport.js';

export const REVIEW_MAX_BYTES = 5 * 1024 * 1024;
export const UNIT_POP = 20000;

// Chỉ tiêu m²/người và bán kính (m) cùng bộ đô thị đang dùng cho bảng phường (hồ sơ DT).
// Cây xanh lấy bán kính theo hạng diện tích từng hatch, không dùng số ở cột radius.
export const REVIEW_ROWS = [
  { section: 'A', key: 'THPT', label: 'Trường THPT', quota: 0.60, radius: 2000 },
  { section: 'A', key: 'YT_DT', label: 'Y tế cấp đô thị', quota: 0.40, radius: 2000 },
  { section: 'A', key: 'VH_DT', label: 'Văn hóa - Thể thao cấp đô thị', quota: 1.60, radius: 2000 },
  { section: 'A', key: 'TM_DT', label: 'Chợ - TMDV cấp đô thị', quota: 0.40, radius: 2000 },
  { section: 'A', key: 'CV_DT', label: 'Cây xanh đô thị', quota: 5.00, radius: 0 },
  { section: 'A', key: 'BDX_DT', label: 'Bãi đỗ xe cấp đô thị', quota: 1.50, radius: 2000 },
  { section: 'B', key: '3-MN', label: 'Trường Mầm non', quota: 0.60, radius: 1000, perUnit: true },
  { section: 'B', key: '4-TH', label: 'Trường Tiểu học', quota: 0.65, radius: 1000, perUnit: true },
  { section: 'B', key: '5-THCS', label: 'Trường THCS', quota: 0.55, radius: 1000, perUnit: true },
  { section: 'B', key: 'YT_DV', label: 'Y tế đơn vị ở', quota: 0, radius: 1000 },
  { section: 'B', key: 'VH_DV', label: 'Văn hóa thể thao đơn vị ở', quota: 0, radius: 1000 },
  { section: 'B', key: 'TM_DV', label: 'Chợ - TMDV đơn vị ở', quota: 0, radius: 1000 },
  { section: 'B', key: 'DVCC_TOTAL', label: 'Dịch vụ công cộng khác đơn vị ở (y tế, văn hóa, chợ)', quota: 0.20, radius: 1000, sumOf: ['YT_DV', 'VH_DV', 'TM_DV'] },
  { section: 'B', key: 'DVCC_ALL', label: 'Tổng đất dịch vụ công cộng đơn vị ở (gồm trường học)', quota: 2.00, radius: 0, sumOf: ['3-MN', '4-TH', '5-THCS', 'YT_DV', 'VH_DV', 'TM_DV'] },
  { section: 'B', key: 'CV_DV', label: 'Vườn hoa (cây xanh đơn vị ở)', quota: 2.00, radius: 400 },
  { section: 'B', key: 'BDX_DV', label: 'Bãi đỗ xe đơn vị ở', quota: 2.50, radius: 500 }
];

const ROW_BY_KEY = Object.fromEntries(REVIEW_ROWS.map(r => [r.key, r]));

export const REVIEW_CHOICES = [
  ['housing', 'Đất ở (mẫu số độ phủ)'],
  ['THPT', 'A · Trường THPT'],
  ['YT_DT', 'A · Y tế cấp đô thị'],
  ['VH_DT', 'A · Văn hóa cấp đô thị'],
  ['TM_DT', 'A · Chợ cấp đô thị'],
  ['CV_DT', 'A · Cây xanh đô thị'],
  ['BDX_DT', 'A · Bãi đỗ xe cấp đô thị'],
  ['3-MN', 'B · Trường Mầm non'],
  ['4-TH', 'B · Trường Tiểu học'],
  ['5-THCS', 'B · Trường THCS'],
  ['YT_DV', 'B · Y tế đơn vị ở'],
  ['VH_DV', 'B · Văn hóa đơn vị ở'],
  ['TM_DV', 'B · Chợ đơn vị ở'],
  ['CV_DV', 'B · Vườn hoa'],
  ['BDX_DV', 'B · Bãi đỗ xe đơn vị ở'],
  ['skip', 'Không chấm']
];

function fold(s) {
  return String(s || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'D').toUpperCase();
}

function landCore(layerName) {
  return fold(layerName).replace(/[\s-]+/g, '_').replace(/^(?:QHDD|QHDH|QH|HT)_/, '').replace(/_(?:QHDD|QHDH|QH|HT)$/, '');
}

/** Hatch đất ở: mẫu số độ phủ. Nhận DAT_O / DAT_ODT / DAT_ONT và mã ODT, ONT đứng riêng. */
export function housingLayer(layerName) {
  const core = landCore(layerName);
  return /(^|_)(DAT_ODT|DAT_ONT|DAT_O|ODT|ONT|DATO|O_LIENKE|O_BIETTHU|O_CHUNGCU)($|_)/.test(core);
}

/** HT theo layer; còn lại trong đồ án coi là quy hoạch. */
export function phaseOfLayer(layerName) {
  const tt = tt16Layer(layerName);
  if (tt && tt.phase) return tt.phase;
  if (layerMarksCurrent(layerName)) return 'HT';
  return 'QH';
}

function scoreKeyOf(p) {
  const prefix = p.prefix || '';
  if (prefix === 'THPT') return 'THPT';
  if (prefix === 'CV_DT' || prefix === 'CV_DV') return prefix;
  if (prefix === 'CV' || p.type === '1-CV') return parkTierOf(p.area, p.nhom).urban ? 'CV_DT' : 'CV_DV';
  if (prefix.endsWith('_DT') || prefix.endsWith('_DV')) return prefix;
  return { MN: '3-MN', TH: '4-TH', THCS: '5-THCS', YT: 'YT_DV', VH: 'VH_DV', TM: 'TM_DV', BDX: 'BDX_DV' }[prefix] || null;
}

/** Gán vai trò hatch: chấm chỉ tiêu, đất ở, ngoài nhóm, hoặc cần người dùng chọn. choice ghi đè tên layer. */
export function tagParcel(p, choice) {
  const phase = p.phase === 'HT' || p.phase === 'QH' ? p.phase : phaseOfLayer(p.layer);
  if (choice === 'housing') return { role: 'housing', scoreKey: null, phase };
  if (choice === 'skip') return { role: 'other', scoreKey: null, phase };
  if (choice && ROW_BY_KEY[choice] && !ROW_BY_KEY[choice].sumOf) return { role: 'score', scoreKey: choice, phase };
  if (p.reviewKind === 'housing' || housingLayer(p.layer)) return { role: 'housing', scoreKey: null, phase };
  if (p.reviewKind === 'school' && !p.prefix) return { role: 'ask', scoreKey: null, phase };
  if (p.reviewKind === 'other') return { role: 'other', scoreKey: null, phase };
  const scoreKey = scoreKeyOf(p);
  if (p.reviewKind === 'score' && scoreKey) return { role: 'score', scoreKey, phase };
  if (p.reviewKind === 'ask' || !scoreKey) return { role: 'ask', scoreKey: null, phase };
  return { role: 'score', scoreKey, phase };
}

export function lotRadius(p) {
  if (p.scoreKey === 'CV_DT' || p.scoreKey === 'CV_DV' || p.type === '1-CV') {
    return parkTierOf(p.area, p.scoreKey === 'CV_DT' ? 'Cấp đô thị' : p.nhom).radius;
  }
  const row = ROW_BY_KEY[p.scoreKey];
  return row && row.radius ? row.radius : 0;
}

/** Số đơn vị ở = dân số quy hoạch / 20.000, làm tròn lên. 61.000 dân = 4. */
export function unitsFromPop(pop) {
  const n = Number(pop);
  if (!(n > 0)) return 0;
  return Math.ceil(n / UNIT_POP);
}

/**
 * Lô đưa vào chỉ tiêu quy hoạch: mọi hatch QH, cộng hatch HT không trùng vị trí một hatch QH cùng nhóm
 * (công trình giữ nguyên, không cộng đôi diện tích).
 */
export function planLots(lots) {
  const scored = lots.filter(p => p.role === 'score' && p.scoreKey);
  const planned = scored.filter(p => p.phase !== 'HT');
  const kept = scored.filter(p => p.phase === 'HT' && !planned.some(q => q.scoreKey === p.scoreKey && sameSite(p, q)));
  return [...planned, ...kept];
}

export function layerRollup(lots) {
  const map = new Map();
  lots.forEach(p => {
    const row = map.get(p.layer) || { layer: p.layer, n: 0, area: 0, role: p.role, scoreKey: p.scoreKey };
    row.n += 1;
    row.area += Number(p.area) || 0;
    map.set(p.layer, row);
  });
  return [...map.values()].sort((a, b) => b.area - a.area);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Bảng A/B: diện tích, nhu cầu, % quy mô. Độ phủ do giao diện tính trên đất ở. */
export function scoreRows(lots, pop) {
  const units = unitsFromPop(pop);
  const people = Number(pop) > 0 ? Number(pop) : 0;
  const planned = planLots(lots);
  const byKey = {};
  planned.forEach(p => {
    (byKey[p.scoreKey] = byKey[p.scoreKey] || []).push(p);
  });
  const areaOf = (key) => (byKey[key] || []).reduce((s, p) => s + (Number(p.area) || 0), 0);
  const rows = REVIEW_ROWS.map(def => {
    const members = def.sumOf ? def.sumOf.flatMap(k => byKey[k] || []) : (byKey[def.key] || []);
    const area = def.sumOf ? def.sumOf.reduce((s, k) => s + areaOf(k), 0) : areaOf(def.key);
    const demand = def.quota > 0 && people > 0 ? def.quota * people : 0;
    return {
      ...def,
      area: Math.round(area),
      count: members.length,
      demand: Math.round(demand),
      scalePct: demand > 0 ? round1(area / demand * 100) : null,
      units,
      members
    };
  });
  const housing = lots.filter(p => p.role === 'housing');
  return {
    units,
    rows,
    planned,
    housing,
    housingArea: Math.round(housing.reduce((s, p) => s + (Number(p.area) || 0), 0))
  };
}

export function rowLabel(key) {
  return (ROW_BY_KEY[key] && ROW_BY_KEY[key].label) || key;
}

export function needsTypeCode(layerName) {
  const tt = tt16Layer(layerName);
  if (tt && tt.school) return false;
  if (tt && tt.prefix) return false;
  if (layerToType(layerName)) return false;
  return true;
}
