// Thẩm định đồ án quy hoạch từ hatch DXF: bảng cân đối sử dụng đất theo TT 16/2025/TT-BXD (Phụ lục I Mục 2 / Mục 4)
// và chấm chỉ tiêu QCVN 01:2026/BXD. Không ghi Sheet, không cộng vào chỉ tiêu phường hay thành phố.
import { parkTierOf } from './state.js';
import { tt16Layer, layerToType } from './cadImport.js';

export const REVIEW_MAX_BYTES = 5 * 1024 * 1024;
export const UNIT_POP = 20000;

// ============================ BẢNG CÂN ĐỐI SỬ DỤNG ĐẤT ============================
// codes: tên phân lớp TT16 (viết hoa, không dấu, bỏ tiền tố HT_ / QHDD_ / QHDH_ và hậu tố cấp _QG / _CV / _CT / _CH / _DVO)
// Đầu mục có sumOf là dòng cộng (Lâm nghiệp QHPK), không tính vào tổng để khỏi cộng đôi.
// subs: nhóm đất con tách riêng phục vụ thẩm định (theo cấp trường / quyết định chợ, TTTM của từng lô), không phải mã TT16
const C = (key, label, codes, color, extra = {}) => ({ key, label, codes, color, ...extra });
const SCHOOL_SUBS = [['thpt', 'Trường THPT'], ['mn', 'Trường mầm non'], ['th', 'Trường tiểu học'], ['thcs', 'Trường THCS'], ['school', 'Trường học chưa phân cấp']];

const QHC_ROWS = [
  { section: 'I', label: 'Khu đất dân dụng' },
  C('dd_o', 'Đơn vị ở', ['DAT_DD_DONVIO'], '#f5d90a'),
  C('dd_hh', 'Hỗn hợp (đơn vị ở và dịch vụ - công cộng)', ['DAT_DD_HONHOP'], '#f59f00'),
  C('dd_dvcc', 'Dịch vụ - công cộng', ['DAT_DD_DVCCDOTHI', 'DAT_DD_TRUONGTHPT', 'DAT_DD_TRUONGHOC'], '#e03131', { subs: [...SCHOOL_SUBS, ['other', 'Dịch vụ - công cộng khác']] }),
  C('dd_cq', 'Cơ quan, trụ sở cấp đô thị', ['DAT_DD_COQUANDOTHI'], '#8d6e63'),
  C('dd_cx', 'Cây xanh sử dụng công cộng', ['DAT_DD_CAYXANHCCDOTHI'], '#2f9e44'),
  C('dd_gt', 'Giao thông đô thị', ['DAT_DD_GIAOTHONGDOTHI'], '#adb5bd'),
  C('dd_ht', 'Hạ tầng kỹ thuật khác cấp đô thị', ['DAT_DD_HTKHACDOTHI'], '#868e96'),
  { section: 'II', label: 'Khu đất ngoài dân dụng' },
  C('ndd_cn', 'Sản xuất công nghiệp', ['DAT_NDD_CONGNGHIEP'], '#9c36b5'),
  C('ndd_dt', 'Trung tâm đào tạo, nghiên cứu', ['DAT_NDD_DAOTAO'], '#1e3a8a'),
  C('ndd_cq', 'Cơ quan, trụ sở ngoài đô thị', ['DAT_NDD_COQUAN'], '#8d6e63'),
  C('ndd_yt', 'Trung tâm y tế', ['DAT_NDD_YTE'], '#e64980'),
  C('ndd_vh', 'Trung tâm văn hóa, thể dục thể thao', ['DAT_NDD_VANHOATHETHAO'], '#d6336c'),
  C('ndd_dl', 'Dịch vụ, du lịch', ['DAT_NDD_DULICH'], '#f783ac'),
  C('ndd_cxhc', 'Cây xanh sử dụng hạn chế', ['DAT_NDD_CAYXANHSDHC'], '#69db7c'),
  C('ndd_cxcd', 'Cây xanh chuyên dụng (nếu có)', ['DAT_NDD_CAYXANHCD'], '#37b24d'),
  C('ndd_dtich', 'Di tích, tôn giáo', ['DAT_NDD_DITICH'], '#7f1d1d'),
  C('ndd_nt', 'Điểm dân cư nông thôn', ['DAT_NDD_DANCUNT'], '#ffe066'),
  C('ndd_an', 'An ninh', ['DAT_NDD_ANNINH'], '#c5d86d'),
  C('ndd_qp', 'Quốc phòng', ['DAT_NDD_QUOCPHONG'], '#a9c25d'),
  C('ndd_gt', 'Giao thông đối ngoại', ['DAT_NDD_GIAOTHONGDN', 'DAT_NDD_GIAOTHONG', 'DAT_NDD_GIAOTHONGDOINGOAI'], '#ced4da'),
  C('ndd_ht', 'Hạ tầng kỹ thuật khác ngoài đô thị', ['DAT_NDD_HTKHACDOINGOAI', 'DAT_NDD_HTKTKHAC', 'DAT_NDD_HTKHAC', 'DAT_NDD_HATANGKHAC'], '#868e96'),
  { section: 'III', label: 'Khu đất nông nghiệp và chức năng khác' },
  C('nnk_nn', 'Sản xuất nông nghiệp', ['DAT_NNK_NONGNGHIEP'], '#a9e34b'),
  C('nnk_ln', 'Lâm nghiệp (rừng sản xuất, rừng phòng hộ và rừng đặc dụng)', ['DAT_NNK_RUNGSANXUAT', 'DAT_NNK_RUNGPHONGHO', 'DAT_NNK_RUNGDACDUNG', 'DAT_NNK_LAMNGHIEP'], '#2b8a3e'),
  C('nnk_ts', 'Nuôi trồng thủy sản', ['DAT_NNK_THUYSAN'], '#74c0fc'),
  C('nnk_csd', 'Chưa sử dụng (đất bằng và đồi núi chưa sử dụng)', ['DAT_NNK_CHUASUDUNG'], '#dee2e6'),
  C('nnk_ho', 'Hồ, ao, đầm', ['DAT_NNK_HONUOC'], '#4dabf7'),
  C('nnk_song', 'Sông, suối, kênh, rạch', ['DAT_NNK_SONGSUOI'], '#339af0'),
  C('nnk_bien', 'Mặt nước ven biển', ['DAT_NNK_MATNUOCBIEN'], '#1c7ed6')
];

const QHPK_ROWS = [
  C('o', 'Nhóm nhà ở', ['DAT_O_NHOMNHAO'], '#f5d90a'),
  C('hh', 'Hỗn hợp nhóm nhà ở và dịch vụ', ['DAT_O_HONHOP_NHOMO', 'DAT_O_HONHOP'], '#f59f00'),
  C('lx', 'Khu làng xóm, dân cư nông thôn', ['DAT_O_LANGXOM'], '#ffe066'),
  C('yt', 'Y tế', ['DAT_HTXH_YTE'], '#e64980'),
  C('vh', 'Văn hóa', ['DAT_HTXH_VANHOA'], '#d6336c'),
  C('tdtt', 'Thể dục thể thao', ['DAT_NDD_VANHOATHETHAO', 'DAT_HTXH_THEDUCTHETHAO'], '#f06595'),
  C('gd', 'Giáo dục', ['DAT_HTXH_TRUONGTHPT', 'DAT_HTXH_TRUONGHOC'], '#1971c2', { subs: [...SCHOOL_SUBS, ['other', 'Giáo dục khác']] }),
  C('cxcc', 'Cây xanh sử dụng công cộng', ['DAT_HTXH_CAYXANHCC'], '#2f9e44'),
  C('cxhc', 'Cây xanh sử dụng hạn chế', ['DAT_CAYXANHHANCHE'], '#69db7c'),
  C('cxcd', 'Cây xanh chuyên dụng', ['DAT_CAYXANHCHUYENDUNG'], '#37b24d'),
  C('sx', 'Sản xuất, kho bãi', ['DAT_SX_CONGNGHIEP'], '#9c36b5'),
  C('ks', 'Khai thác, chế biến khoáng sản, sản xuất vật liệu xây dựng', ['DAT_SX_VATLIEU'], '#862e9c'),
  C('dtnc', 'Đào tạo, nghiên cứu', ['DAT_DAOTAONC'], '#1e3a8a'),
  C('cq', 'Cơ quan, trụ sở', ['DAT_COQUAN'], '#8d6e63'),
  C('dv', 'Khu dịch vụ (không bao gồm dịch vụ du lịch)', ['DAT_DICHVU'], '#ff8787', {
    subs: [['cho', 'Đất chợ, trung tâm thương mại'], ['pending', 'Chưa xác nhận chợ / trung tâm thương mại'], ['other', 'Đất dịch vụ khác']]
  }),
  C('dl', 'Khu dịch vụ - du lịch', ['DAT_DULICH'], '#f783ac'),
  C('dtich', 'Di tích, tôn giáo', ['DAT_DITICH_TONGIAO', 'DAT_DITICHTONGIAO'], '#7f1d1d'),
  C('an', 'An ninh', ['DAT_ANNINH'], '#c5d86d'),
  C('qp', 'Quốc phòng', ['DAT_QUOCPHONG', 'DAT_NDD_QUOCPHONG'], '#a9c25d'),
  C('gt', 'Đường giao thông', ['DAT_HTKT_DUONGGT', 'DAT_NDD_GIAOTHONGDN'], '#adb5bd'),
  C('bdx', 'Bãi đỗ xe', ['DAT_HTKT_BAIDOXE'], '#495057'),
  C('ntr', 'Nghĩa trang (bao gồm cả nhà tang lễ, cơ sở hỏa táng)', ['DAT_HTKT_NGHIATRANG'], '#5c5f66'),
  C('htk', 'Hệ thống công trình hạ tầng kỹ thuật khác', ['DAT_NDD_HTKHACDOINGOAI', 'DAT_HTKT_HATANGKHAC', 'DAT_HTKT_HTKTKHAC', 'DAT_HTKT_KHAC'], '#868e96'),
  C('nn', 'Sản xuất nông nghiệp', ['DAT_NN_NONGNGHIEP'], '#a9e34b'),
  C('ln', 'Lâm nghiệp', [], '#2b8a3e', { sumOf: ['rsx', 'rph', 'rdd'] }),
  C('rsx', '- Rừng sản xuất', ['DAT_NN_RUNGSANXUAT'], '#2b8a3e', { sub: true }),
  C('rph', '- Rừng phòng hộ', ['DAT_NN_RUNGPHONGHO'], '#237032', { sub: true }),
  C('rdd', '- Rừng đặc dụng', ['DAT_NN_RUNGDACDUNG'], '#1b5e28', { sub: true }),
  C('ts', 'Nuôi trồng thủy sản', ['DAT_NN_THUYSAN'], '#74c0fc'),
  C('csd', 'Đất chưa sử dụng', ['DAT_KHAC_CHUASUDUNG'], '#dee2e6'),
  C('ho', 'Hồ, ao, đầm', ['DAT_KHAC_HONUOC'], '#4dabf7'),
  C('song', 'Sông, suối, kênh, rạch', ['DAT_KHAC_SONGSUOI'], '#339af0'),
  C('bien', 'Mặt nước ven biển', ['DAT_KHAC_MATNUOCBIEN'], '#1c7ed6')
];

// housing: đầu mục đất ở làm mẫu số độ phủ (QHC: đơn vị ở + hỗn hợp; QHPK: nhóm nhà ở + hỗn hợp)
export const LANDUSE_TABLES = {
  QHC: { label: 'Quy hoạch chung đô thị (1/10.000)', short: 'QHC', title: 'Mục 2 — Quy định về thể hiện chức năng sử dụng đất trong đồ án quy hoạch chung đô thị - tỷ lệ 1/10.000', rows: QHC_ROWS, housing: ['dd_o', 'dd_hh'] },
  QHPK: { label: 'Quy hoạch phân khu (1/2.000)', short: 'QHPK', title: 'Mục 4 — Quy định về thể hiện chức năng sử dụng đất trong đồ án quy hoạch phân khu đô thị, quy hoạch phân khu khu chức năng - tỷ lệ 1/2.000; 1/5.000', rows: QHPK_ROWS, housing: ['o', 'hh'] }
};

const STAGES = new Set(['HT', 'QHDD', 'QHDH', 'QH']);
// Hậu tố cấp TT16 + quy ước nội bộ: _CHO / _TTTM / _KHAC cho DAT_DICHVU (chợ, trung tâm thương mại, dịch vụ khác)
const LEVEL_SUFFIX = new Set(['QG', 'CV', 'CT', 'CH', 'DVO', 'MN', 'TH', 'THCS', 'CHO', 'TTTM', 'KHAC']);
const PRESET_SUFFIX = { CHO: 'CHO', TTTM: 'TTTM', KHAC: 'NO' };
const codeIndex = {};
Object.entries(LANDUSE_TABLES).forEach(([kind, t]) => {
  codeIndex[kind] = new Map();
  t.rows.forEach(r => (r.codes || []).forEach(c => codeIndex[kind].set(c, r)));
});

function tokens(layerName) {
  return String(layerName || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'D').toUpperCase().split(/[_\s-]+/).filter(Boolean);
}

/** Tiền tố giai đoạn của layer (HT / QHDD / QHDH / QH) hoặc '' */
export function layerStage(layerName) {
  const t = tokens(layerName);
  return STAGES.has(t[0]) ? t[0] : '';
}

/** Phần tên layer sau tiền tố giai đoạn, giữ hậu tố: "QHDH_DAT_HTXH_Yte_DVO" → "DAT_HTXH_YTE_DVO" */
export function layerCore(layerName) {
  const t = tokens(layerName);
  return (STAGES.has(t[0]) ? t.slice(1) : t).join('_');
}

/** Tên layer → đầu mục bảng cân đối của loại hồ sơ (bỏ dần hậu tố cấp), null nếu không theo quy định */
export function classifyLand(layerName, kind) {
  const index = codeIndex[kind];
  if (!index) return null;
  const core = layerCore(layerName).split('_');
  while (core.length) {
    const hit = index.get(core.join('_'));
    if (hit) return hit;
    if (core.length <= 2 || !LEVEL_SUFFIX.has(core[core.length - 1])) break;
    core.pop();
  }
  return null;
}

export function landRowByKey(kind, key) {
  return (LANDUSE_TABLES[kind]?.rows || []).find(r => r.key === key) || null;
}

/** Đầu mục chọn được khi gán layer chưa đúng quy định */
export function landChoices(kind) {
  return (LANDUSE_TABLES[kind]?.rows || []).filter(r => r.key && !r.sumOf);
}

/**
 * Nhóm đất con của lô trong đầu mục có subs: cấp trường (thpt / mn / th / thcs / school chưa phân cấp),
 * chợ - TTTM (cho / pending chưa xác nhận), còn lại other. lot.prefix / decisionKind / decision do giao diện gán.
 */
export function landSubKey(lot, kind) {
  const row = landRowByKey(kind, lot.landKey);
  if (!row || !row.subs) return '';
  const base = String(lot.prefix || '').replace(/_(DT|DV)$/, '');
  if (base === 'THPT') return 'thpt';
  if (base === 'MN' || base === 'TH' || base === 'THCS') return base.toLowerCase();
  if (lot.decisionKind === 'school' && !lot.decision) return 'school';
  if (lot.decisionKind === 'market') return lot.decision === 'CHO' || lot.decision === 'TTTM' ? 'cho' : lot.decision ? 'other' : 'pending';
  return 'other';
}

/**
 * Bảng cân đối: diện tích (ha) và tỷ lệ (%) hiện trạng / quy hoạch theo đúng thứ tự và số thứ tự mẫu TT16,
 * chỉ liệt kê đầu mục (và nhóm con) có diện tích HT hoặc QH > 0.
 * lots: [{ phase, landKey, subKey, area (m²) }]; landKey 'skip' / null không tính.
 */
export function landUseSummary(lots, kind) {
  const table = LANDUSE_TABLES[kind];
  const sum = { HT: {}, QH: {} };
  const add = (ph, key, v) => { sum[ph][key] = (sum[ph][key] || 0) + v; };
  lots.forEach(p => {
    if (!p.landKey || p.landKey === 'skip') return;
    const ph = p.phase === 'HT' ? 'HT' : 'QH';
    const v = Number(p.area) || 0;
    add(ph, p.landKey, v);
    if (p.subKey) add(ph, `${p.landKey}/${p.subKey}`, v);
  });
  const leafRows = table.rows.filter(r => r.key && !r.sumOf);
  const total = { HT: 0, QH: 0 };
  leafRows.forEach(r => { total.HT += sum.HT[r.key] || 0; total.QH += sum.QH[r.key] || 0; });
  const pct = (v, t) => (t > 0 ? Math.round(v / t * 1000) / 10 : 0);
  const ha = (m2) => Math.round(m2 / 100) / 100;
  const cells = (ht, qh) => ({ htHa: ha(ht), htPct: pct(ht, total.HT), qhHa: ha(qh), qhPct: pct(qh, total.QH) });
  let section = null, stt = 0;
  const out = [];
  const sectionTotals = {};
  table.rows.forEach(r => {
    if (r.section) {
      section = r.section;
      stt = 0;
      sectionTotals[section] = { HT: 0, QH: 0 };
      out.push({ kind: 'section', section, label: r.label });
      return;
    }
    const keys = r.sumOf || [r.key];
    const ht = keys.reduce((s, k) => s + (sum.HT[k] || 0), 0);
    const qh = keys.reduce((s, k) => s + (sum.QH[k] || 0), 0);
    if (section && !r.sumOf) { sectionTotals[section].HT += ht; sectionTotals[section].QH += qh; }
    if (!r.sub) stt++;
    if (!(ht > 0 || qh > 0)) return;
    out.push({
      kind: 'row', key: r.key, stt: r.sub ? '' : stt, label: r.label, code: (r.codes || [])[0] || '', color: r.color, sub: !!r.sub, sum: !!r.sumOf,
      ...cells(ht, qh)
    });
    (r.subs || []).forEach(([sk, label]) => {
      const sht = sum.HT[`${r.key}/${sk}`] || 0;
      const sqh = sum.QH[`${r.key}/${sk}`] || 0;
      if (!(sht > 0 || sqh > 0)) return;
      out.push({ kind: 'row', key: `${r.key}/${sk}`, stt: '', label: `- ${label}`, code: '', color: r.color, sub: true, part: true, ...cells(sht, sqh) });
    });
  });
  const rows = out.filter(r => {
    if (r.kind !== 'section') return true;
    const t = sectionTotals[r.section];
    Object.assign(r, cells(t.HT, t.QH));
    return t.HT > 0 || t.QH > 0;
  });
  return { rows, totalHT: ha(total.HT), totalQH: ha(total.QH), sections: Object.keys(sectionTotals) };
}

/**
 * Tên layer đưa vào hệ thống (chuẩn TT16, khớp cadImport.tt16Layer):
 *   - tiền tố theo file: file HT → HT_, file QH giữ QHDD_ / QHDH_ / QH_, không có thì QHDH_
 *   - layer gán tay → mã đầu tiên của đầu mục; cấp trường đã chọn → thêm hậu tố _MN / _TH / _THCS;
 *     chợ / TTTM → _CHO / _TTTM; lô dịch vụ / trường học không thuộc nhóm hạ tầng → _KHAC (ghi sheet DXF như đất khác)
 */
export function importLayerName(lot, kind, chosenKey, decision) {
  const own = layerStage(lot.layer);
  const stage = lot.phase === 'HT' ? 'HT' : (own && own !== 'HT' ? own : 'QHDH');
  let core = chosenKey ? (landRowByKey(kind, chosenKey)?.codes || [])[0] || layerCore(lot.layer) : layerCore(lot.layer);
  if (decision) core = core.replace(/_(CHO|TTTM|KHAC)$/, '');
  if (decision === 'MN' || decision === 'TH' || decision === 'THCS' || decision === 'CHO' || decision === 'TTTM') core += `_${decision}`;
  else if (decision === 'NO') core += '_KHAC';
  return `${stage}_${core}`;
}

/** Lô cần người dùng xác nhận từng đối tượng: 'school' (Truonghoc thiếu cấp), 'market' (thương mại dịch vụ), hoặc '' */
export function decisionKind(layerName) {
  const tt = tt16Layer(layerName);
  if (tt && tt.school) return 'school';
  const t = layerToType(layerName);
  if (t && t.type === '9-TM') return 'market';
  return /_DAT_DICHVU_KHAC$/.test(tokens(layerName).join('_')) ? 'market' : '';
}

/** Quyết định đặt sẵn qua hậu tố layer: DAT_DICHVU_CHO → CHO, _TTTM → TTTM, _KHAC → NO (dịch vụ khác) */
export function presetDecision(layerName) {
  return PRESET_SUFFIX[tokens(layerName).pop()] || '';
}

// ============================ CHẤM CHỈ TIÊU QCVN 01:2026 ============================

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

// QHPK có trên 20.000 dân (từ 2 đơn vị ở) thì thẩm định thêm đất trường THPT
export const THPT_POP_MIN = 20000;
const THPT_UNIT_ROW = { ...ROW_BY_KEY.THPT, section: 'B', label: `Trường THPT (quy mô dân số trên ${THPT_POP_MIN.toLocaleString('vi-VN')} người)` };

/** Các dòng thẩm định theo loại hồ sơ: QHC → bảng A (cấp đô thị); QHPK → bảng B (cấp đơn vị ở) + THPT khi dân số > 20.000 */
export function reviewRowsFor(kind, pop) {
  if (kind === 'QHC') return REVIEW_ROWS.filter(r => r.section === 'A');
  const rows = REVIEW_ROWS.filter(r => r.section === 'B');
  if (Number(pop) > THPT_POP_MIN) rows.splice(rows.findIndex(r => r.key === '5-THCS') + 1, 0, THPT_UNIT_ROW);
  return rows;
}

// Mã loại (bỏ cấp _DT / _DV) → dòng thẩm định: QHC gom mọi lô về cấp đô thị, QHPK gom về cấp đơn vị ở
const SCORE_KEYS = {
  QHC: { THPT: 'THPT', YT: 'YT_DT', VH: 'VH_DT', TM: 'TM_DT', CV: 'CV_DT', BDX: 'BDX_DT' },
  QHPK: { MN: '3-MN', TH: '4-TH', THCS: '5-THCS', THPT: 'THPT', YT: 'YT_DV', VH: 'VH_DV', TM: 'TM_DV', CV: 'CV_DV', BDX: 'BDX_DV' }
};

function scoreKeyOf(p, kind) {
  const base = String(p.prefix || '').replace(/_(DT|DV)$/, '');
  return (SCORE_KEYS[kind] || {})[base] || null;
}

/**
 * Vai trò lô: 'housing' (mẫu số độ phủ), 'score' (chấm chỉ tiêu, scoreKey), 'other'. p.prefix/type/nhom theo layer chuẩn hóa.
 * Lô thuộc loại không có dòng trong bảng của hồ sơ (VD trường học trong QHC, THPT của QHPK ≤ 20.000 dân) → 'other'.
 */
export function tagParcel(p, kind, pop) {
  if (LANDUSE_TABLES[kind]?.housing.includes(p.landKey)) return { role: 'housing', scoreKey: null };
  const scoreKey = p.prefix ? scoreKeyOf(p, kind) : null;
  if (!scoreKey || !reviewRowsFor(kind, pop).some(r => r.key === scoreKey)) return { role: 'other', scoreKey: null };
  return { role: 'score', scoreKey };
}

/** Bán kính phục vụ của lô: cây xanh theo hạng diện tích, còn lại theo dòng thẩm định */
export function lotRadius(p) {
  if (p.scoreKey === 'CV_DT' || p.scoreKey === 'CV_DV') {
    return parkTierOf(p.area, p.scoreKey === 'CV_DT' ? 'Cấp đô thị' : 'Cấp đơn vị ở').radius;
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

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Bảng thẩm định (A với QHC, B với QHPK) trên các lô quy hoạch: diện tích, nhu cầu, % quy mô. Độ phủ do giao diện tính trên đất ở. */
export function scoreRows(lots, pop, kind) {
  const units = unitsFromPop(pop);
  const people = Number(pop) > 0 ? Number(pop) : 0;
  const planned = lots.filter(p => p.role === 'score' && p.scoreKey);
  const byKey = {};
  planned.forEach(p => {
    (byKey[p.scoreKey] = byKey[p.scoreKey] || []).push(p);
  });
  const areaOf = (key) => (byKey[key] || []).reduce((s, p) => s + (Number(p.area) || 0), 0);
  const rows = reviewRowsFor(kind, pop).map(def => {
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

/** Tên đồ án từ tên file: "HT-ABCD.dxf" → "ABCD" */
export function projectOfFile(fileName) {
  return String(fileName || '').replace(/\.[^.]+$/, '').replace(/^(HT|QH)[-_\s]+/i, '').trim();
}
