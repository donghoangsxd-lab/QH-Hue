// Thẩm định đồ án quy hoạch từ hatch DXF: bảng cân đối sử dụng đất theo TT 16/2025/TT-BXD (Phụ lục I Mục 2 / Mục 4)
// và chấm chỉ tiêu QCVN 01:2026/BXD. Không ghi Sheet, không cộng vào chỉ tiêu phường hay thành phố.
import { parkTierOf } from './state.js';
import { tt16Layer, layerToType, LAYER_PREFIXES } from './cadImport.js';
import { TT16_STYLES } from './tt16Symbols.js';

export const REVIEW_MAX_BYTES = 5 * 1024 * 1024;
export const UNIT_POP = 20000;

// ============================ BẢNG CÂN ĐỐI SỬ DỤNG ĐẤT ============================
// codes: tên phân lớp TT16 (viết hoa, không dấu, bỏ tiền tố HT_ / QHDD_ / QHDH_ và hậu tố cấp _QG / _CV / _CT / _CH / _DVO)
// sym: ký hiệu rút gọn tự quy ước cho cột Ký hiệu của bảng tổng hợp (mã TT16 đầy đủ hiện khi rê chuột)
// Đầu mục có sumOf là dòng cộng (Lâm nghiệp QHPK), không tính vào tổng để khỏi cộng đôi.
// subs [key, nhãn, ký hiệu]: nhóm đất con tách riêng phục vụ thẩm định (cấp trường, chợ - TTTM, đất ở hiện trạng / mới), không phải mã TT16.
// split: đầu mục đất ở chia hiện trạng / mới theo phần diện tích lô quy hoạch chồng lên đất ở hiện trạng
const C = (key, label, sym, codes, color, extra = {}) => ({ key, label, sym, codes, color, ...extra });
const SCHOOL_SUBS = [['thpt', 'Trường THPT', 'THPT'], ['mn', 'Trường mầm non', 'MN'], ['th', 'Trường tiểu học', 'TH'], ['thcs', 'Trường THCS', 'THCS'], ['school', 'Trường học chưa phân cấp', 'TRH']];
// color của mỗi đầu mục chỉ dùng khi dòng không có hoa văn TT16. Có hoa văn thì bản đồ và ô mẫu lấy màu ký hiệu trong tt16Symbols.js.
const SPORT_COLOR = '#20c997';

const QHC_ROWS = [
  { section: 'I', label: 'Khu đất dân dụng' },
  C('dd_o', 'Đơn vị ở', 'DVO', ['DAT_DD_DONVIO'], '#f5d90a', { split: true, subs: [['ht', 'Đất đơn vị ở hiện trạng', 'OHT'], ['moi', 'Đất đơn vị ở mới', 'OQH']] }),
  C('dd_hh', 'Hỗn hợp (đơn vị ở và dịch vụ - công cộng)', 'HH', ['DAT_DD_HONHOP'], '#ffa94d'),
  C('dd_dvcc', 'Dịch vụ - công cộng', 'DVCC', ['DAT_DD_DVCCDOTHI', 'DAT_DD_TRUONGTHPT', 'DAT_DD_TRUONGHOC'], '#a61e4d', { subs: [...SCHOOL_SUBS, ['other', 'Dịch vụ - công cộng khác', 'DVCC-K']] }),
  C('dd_cq', 'Cơ quan, trụ sở cấp đô thị', 'CQ', ['DAT_DD_COQUANDOTHI'], '#a1887f'),
  C('dd_cx', 'Cây xanh sử dụng công cộng', 'CXCC', ['DAT_DD_CAYXANHCCDOTHI'], '#51cf66'),
  C('dd_gt', 'Giao thông đô thị', 'GT', ['DAT_DD_GIAOTHONGDOTHI'], '#dee2e6'),
  C('dd_ht', 'Hạ tầng kỹ thuật khác cấp đô thị', 'HTKT', ['DAT_DD_HTKHACDOTHI'], '#5c677d'),
  { section: 'II', label: 'Khu đất ngoài dân dụng' },
  C('ndd_cn', 'Sản xuất công nghiệp', 'CN', ['DAT_NDD_CONGNGHIEP'], '#862e9c'),
  C('ndd_dt', 'Trung tâm đào tạo, nghiên cứu', 'ĐT-NC', ['DAT_NDD_DAOTAO'], '#1e3a8a'),
  C('ndd_cq', 'Cơ quan, trụ sở ngoài đô thị', 'CQ-N', ['DAT_NDD_COQUAN'], '#8d6e63'),
  C('ndd_yt', 'Trung tâm y tế', 'YT', ['DAT_NDD_YTE'], '#f06595'),
  C('ndd_vh', 'Trung tâm văn hóa, thể dục thể thao', 'VH-TT', ['DAT_NDD_VANHOATHETHAO'], '#cc5de8'),
  C('ndd_dl', 'Dịch vụ, du lịch', 'DL', ['DAT_NDD_DULICH'], '#fcc2d7'),
  C('ndd_cxhc', 'Cây xanh sử dụng hạn chế', 'CXHC', ['DAT_NDD_CAYXANHSDHC'], '#b2f2bb'),
  C('ndd_cxcd', 'Cây xanh chuyên dụng (nếu có)', 'CXCD', ['DAT_NDD_CAYXANHCD'], '#2b8a3e'),
  C('ndd_dtich', 'Di tích, tôn giáo', 'DT-TG', ['DAT_NDD_DITICH'], '#7f1d1d'),
  C('ndd_nt', 'Điểm dân cư nông thôn', 'DCNT', ['DAT_NDD_DANCUNT'], '#d8b56d'),
  C('ndd_an', 'An ninh (bao gồm trụ sở cảnh sát PCCC)', 'AN', ['DAT_NDD_ANNINH'], '#d9480f'),
  C('ndd_qp', 'Quốc phòng', 'QP', ['DAT_NDD_QUOCPHONG'], '#5c940d'),
  C('ndd_gt', 'Giao thông đối ngoại', 'GTĐN', ['DAT_NDD_GIAOTHONGDN', 'DAT_NDD_GIAOTHONG', 'DAT_NDD_GIAOTHONGDOINGOAI'], '#c5cbd3'),
  C('ndd_ht', 'Hạ tầng kỹ thuật khác ngoài đô thị', 'HTK', ['DAT_NDD_HTKHACDOINGOAI', 'DAT_NDD_HTKTKHAC', 'DAT_NDD_HTKHAC', 'DAT_NDD_HATANGKHAC'], '#495057'),
  { section: 'III', label: 'Khu đất nông nghiệp và chức năng khác' },
  C('nnk_nn', 'Sản xuất nông nghiệp', 'NN', ['DAT_NNK_NONGNGHIEP'], '#a9e34b'),
  C('nnk_ln', 'Lâm nghiệp (rừng sản xuất, rừng phòng hộ và rừng đặc dụng)', 'LN', ['DAT_NNK_RUNGSANXUAT', 'DAT_NNK_RUNGPHONGHO', 'DAT_NNK_RUNGDACDUNG', 'DAT_NNK_LAMNGHIEP'], '#087f5b'),
  C('nnk_ts', 'Nuôi trồng thủy sản', 'TS', ['DAT_NNK_THUYSAN'], '#99e9f2'),
  C('nnk_csd', 'Chưa sử dụng (đất bằng và đồi núi chưa sử dụng)', 'CSD', ['DAT_NNK_CHUASUDUNG'], '#f1f3f5'),
  C('nnk_ho', 'Hồ, ao, đầm', 'HO', ['DAT_NNK_HONUOC'], '#74c0fc'),
  C('nnk_song', 'Sông, suối, kênh, rạch', 'SS', ['DAT_NNK_SONGSUOI'], '#339af0'),
  C('nnk_bien', 'Mặt nước ven biển', 'MNB', ['DAT_NNK_MATNUOCBIEN'], '#1864ab')
];

const QHPK_ROWS = [
  C('o', 'Nhóm nhà ở', 'NO', ['DAT_O_NHOMNHAO'], '#f5d90a', { split: true, subs: [['ht', 'Nhóm nhà ở hiện trạng', 'OHT'], ['moi', 'Nhóm nhà ở mới', 'OQH']] }),
  C('hh', 'Hỗn hợp nhóm nhà ở và dịch vụ', 'HH', ['DAT_O_HONHOP_NHOMO', 'DAT_O_HONHOP'], '#ffa94d'),
  C('lx', 'Khu làng xóm, dân cư nông thôn', 'LX', ['DAT_O_LANGXOM'], '#d8b56d'),
  C('yt', 'Y tế', 'YT', ['DAT_HTXH_YTE'], '#f06595'),
  C('vh', 'Văn hóa', 'VH', ['DAT_HTXH_VANHOA'], '#cc5de8'),
  C('tdtt', 'Thể dục thể thao', 'VH-TT', ['DAT_NDD_VANHOATHETHAO', 'DAT_HTXH_THEDUCTHETHAO'], SPORT_COLOR),
  C('gd', 'Giáo dục', 'GD', ['DAT_HTXH_TRUONGTHPT', 'DAT_HTXH_TRUONGHOC'], '#5f3dc4', { subs: [...SCHOOL_SUBS, ['other', 'Giáo dục khác', 'GD-K']] }),
  C('cxcc', 'Cây xanh sử dụng công cộng', 'CXCC', ['DAT_HTXH_CAYXANHCC'], '#51cf66'),
  C('cxhc', 'Cây xanh sử dụng hạn chế', 'CXHC', ['DAT_CAYXANHHANCHE'], '#b2f2bb'),
  C('cxcd', 'Cây xanh chuyên dụng', 'CXCD', ['DAT_CAYXANHCHUYENDUNG'], '#2b8a3e'),
  C('sx', 'Sản xuất, kho bãi', 'SX', ['DAT_SX_CONGNGHIEP'], '#862e9c'),
  C('ks', 'Khai thác, chế biến khoáng sản, sản xuất vật liệu xây dựng', 'KS', ['DAT_SX_VATLIEU'], '#495057'),
  C('dtnc', 'Đào tạo, nghiên cứu', 'ĐT-NC', ['DAT_DAOTAONC'], '#1e3a8a'),
  C('cq', 'Cơ quan, trụ sở', 'CQ', ['DAT_COQUAN'], '#a1887f'),
  C('dv', 'Khu dịch vụ (không bao gồm dịch vụ du lịch)', 'DV', ['DAT_DICHVU'], '#ffa8a8', {
    subs: [['cho', 'Đất chợ, trung tâm thương mại', 'CHO'], ['pending', 'Chưa xác nhận chợ / trung tâm thương mại', 'DV?'], ['other', 'Đất dịch vụ khác', 'DVK']]
  }),
  C('dl', 'Khu dịch vụ - du lịch', 'DL', ['DAT_DULICH'], '#fcc2d7'),
  C('dtich', 'Di tích, tôn giáo', 'DT-TG', ['DAT_DITICH_TONGIAO', 'DAT_DITICHTONGIAO'], '#7f1d1d'),
  C('an', 'An ninh (bao gồm trụ sở cảnh sát PCCC)', 'AN', ['DAT_ANNINH'], '#d9480f'),
  C('qp', 'Quốc phòng', 'QP', ['DAT_QUOCPHONG', 'DAT_NDD_QUOCPHONG'], '#5c940d'),
  C('gt', 'Đường giao thông', 'GT', ['DAT_HTKT_DUONGGT', 'DAT_NDD_GIAOTHONGDN'], '#dee2e6'),
  C('bdx', 'Bãi đỗ xe', 'BDX', ['DAT_HTKT_BAIDOXE'], '#94a3b8'),
  C('ntr', 'Nghĩa trang (bao gồm cả nhà tang lễ, cơ sở hỏa táng)', 'NTR', ['DAT_HTKT_NGHIATRANG'], '#795548'),
  C('htk', 'Hệ thống công trình hạ tầng kỹ thuật khác', 'HTK', ['DAT_NDD_HTKHACDOINGOAI', 'DAT_HTKT_HATANGKHAC', 'DAT_HTKT_HTKTKHAC', 'DAT_HTKT_KHAC'], '#5c677d'),
  C('nn', 'Sản xuất nông nghiệp', 'NN', ['DAT_NN_NONGNGHIEP'], '#a9e34b'),
  C('ln', 'Lâm nghiệp', 'LN', [], '#087f5b', { sumOf: ['rsx', 'rph', 'rdd'] }),
  C('rsx', '- Rừng sản xuất', 'RSX', ['DAT_NN_RUNGSANXUAT'], '#099268', { sub: true }),
  C('rph', '- Rừng phòng hộ', 'RPH', ['DAT_NN_RUNGPHONGHO'], '#087f5b', { sub: true }),
  C('rdd', '- Rừng đặc dụng', 'RĐD', ['DAT_NN_RUNGDACDUNG'], '#065f46', { sub: true }),
  C('ts', 'Nuôi trồng thủy sản', 'TS', ['DAT_NN_THUYSAN'], '#99e9f2'),
  C('csd', 'Đất chưa sử dụng', 'CSD', ['DAT_KHAC_CHUASUDUNG'], '#f1f3f5'),
  C('ho', 'Hồ, ao, đầm', 'HO', ['DAT_KHAC_HONUOC'], '#74c0fc'),
  C('song', 'Sông, suối, kênh, rạch', 'SS', ['DAT_KHAC_SONGSUOI'], '#339af0'),
  C('bien', 'Mặt nước ven biển', 'MNB', ['DAT_KHAC_MATNUOCBIEN'], '#1864ab')
];

// housing: đầu mục đất ở làm mẫu số độ phủ (QHC: đơn vị ở + hỗn hợp; QHPK: nhóm nhà ở + hỗn hợp)
// newLandMax: chỉ tiêu đất đơn vị ở mới bình quân tối đa (m²/người), chỉ kiểm soát với QHC
export const LANDUSE_TABLES = {
  QHC: {
    label: 'Quy hoạch chung đô thị (1/10.000)', short: 'QHC', title: 'Mục 2 — Quy định về thể hiện chức năng sử dụng đất trong đồ án quy hoạch chung đô thị - tỷ lệ 1/10.000',
    rows: QHC_ROWS, housing: ['dd_o', 'dd_hh'], landLabel: 'đất đơn vị ở', newLandMax: 55
  },
  QHPK: {
    label: 'Quy hoạch phân khu (1/2.000)', short: 'QHPK', title: 'Mục 4 — Quy định về thể hiện chức năng sử dụng đất trong đồ án quy hoạch phân khu đô thị, quy hoạch phân khu khu chức năng - tỷ lệ 1/2.000; 1/5.000',
    rows: QHPK_ROWS, housing: ['o', 'hh'], landLabel: 'đất nhóm nhà ở', newLandMax: 0
  }
};

const STAGES = new Set(['HT', 'QHDD', 'QHDH', 'QH']);
// Hậu tố cấp TT16 + quy ước nội bộ: _CHO / _TM (_TTTM) / _KHAC cho DAT_DICHVU (chợ, trung tâm thương mại, dịch vụ khác);
// _PCCC (trụ sở PCCC → đất an ninh), _TANGLE (nhà tang lễ → đất nghĩa trang)
const LEVEL_SUFFIX = new Set(['QG', 'CV', 'CT', 'CH', 'DVO', 'MN', 'TH', 'THCS', 'CHO', 'TM', 'TTTM', 'KHAC', 'PCCC', 'TANGLE']);
const PRESET_SUFFIX = { CHO: 'CHO', TM: 'TTTM', TTTM: 'TTTM', KHAC: 'NO' };
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

// Ký hiệu bản đồ: thu nhỏ tô đặc màu hatch TT16, phóng to kẻ đúng hoa văn cùng màu.
// [khóa TT16, gộp nhiều loại]
const ROW_TT16 = {
  QHC: {
    dd_o: ['O-NO'], dd_hh: ['O-HH'], dd_dvcc: ['CC-DV'], dd_cq: ['CQ'], dd_cx: ['1-CV'], dd_gt: ['GT'], dd_ht: ['HTK'],
    ndd_cn: ['SX-CN'], ndd_dt: ['DT-NC'], ndd_cq: ['CQ'], ndd_yt: ['7-YT'], ndd_vh: ['8-VH'], ndd_dl: ['DL'],
    ndd_cxhc: ['CX-HC'], ndd_cxcd: ['CX-CD'], ndd_dtich: ['DT-TG'], ndd_nt: ['O-LX'], ndd_an: ['AN'], ndd_qp: ['QP'],
    ndd_gt: ['GT'], ndd_ht: ['HTK'], nnk_nn: ['NN'], nnk_ts: ['TS'], nnk_csd: ['DCS'], nnk_ho: ['HO'], nnk_song: ['SS'], nnk_bien: ['MNB']
  },
  QHPK: {
    o: ['O-NO'], hh: ['O-HH'], lx: ['O-LX'], yt: ['7-YT'], vh: ['8-VH'], tdtt: ['TDTT'], gd: ['3-MN', true],
    cxcc: ['1-CV'], cxhc: ['CX-HC'], cxcd: ['CX-CD'], sx: ['SX-CN'], ks: ['SX-VL'], dtnc: ['DT-NC'], cq: ['CQ'],
    dv: ['9-TM', true], dl: ['DL'], dtich: ['DT-TG'], an: ['AN'], qp: ['QP'], gt: ['GT'], bdx: ['2-BDX'], ntr: ['NTR'],
    htk: ['HTK'], nn: ['NN'], rsx: ['RSX'], rph: ['RPH'], rdd: ['RDD'], ts: ['TS'], csd: ['DCS'], ho: ['HO'], song: ['SS'], bien: ['MNB']
  }
};
const SUB_TT16 = { thpt: '6-THPT', mn: '3-MN', th: '4-TH', thcs: '5-THCS', cho: '9-TM' };
// Lô chờ người dùng xác nhận (layer sai quy định, trường chưa phân cấp, dịch vụ chưa rõ chợ / TTTM): tô đen
export const PENDING_TONE = '#111111';
const PENDING_SUBS = new Set(['school', 'pending']);
// Đầu mục "Chưa xác định" cuối bảng cân đối: lô layer chưa rõ đầu mục + phần chênh để tổng HT = tổng QH
export const UNDETERMINED_KEY = 'undetermined';
// Chênh lệch tổng HT / QH dưới ngưỡng này (m²) coi là sai số vẽ hatch, không dồn vào "Chưa xác định"
const BALANCE_MIN_M2 = 1;
// Đầu mục đất giao thông nhận phần còn lại của ranh (QHC: giao thông đô thị; giao thông đối ngoại vẫn tính theo hatch)
const ROAD_KEY = { QHC: 'dd_gt', QHPK: 'gt' };

/** Ký hiệu của đầu mục / nhóm con: { tt16: khóa TT16 | null, tone: màu tô khi thu nhỏ } */
export function landSymbol(kind, rowKey, subKey = '') {
  if (rowKey === UNDETERMINED_KEY) return { tt16: null, tone: PENDING_TONE };
  const row = landRowByKey(kind, rowKey);
  const [rowTt16] = ROW_TT16[kind]?.[rowKey] || [];
  const toneOf = (key, fallback) => (key && TT16_STYLES[key] && TT16_STYLES[key].color) || fallback || '#94a3b8';
  if (PENDING_SUBS.has(subKey)) return { tt16: subKey === 'school' ? '3-MN' : rowTt16 || '3-MN', tone: PENDING_TONE };
  if (SUB_TT16[subKey]) return { tt16: SUB_TT16[subKey], tone: toneOf(SUB_TT16[subKey]) };
  if (!rowTt16) return { tt16: null, tone: row?.color || '#94a3b8' };
  return { tt16: rowTt16, tone: toneOf(rowTt16, row?.color) };
}

// ---------- Lô đồ án đã lưu (tên layer gServer / khớp thủ công "<tên> → <mã>"): đọc qua khóa ký hiệu TT16 của tt16Symbols.landPatternKey ----------

// Khóa TT16 không có đầu mục riêng trong bảng → đầu mục gần nhất
const PATTERN_ROW_EXTRA = {
  QHC: { '3-MN': 'dd_dvcc', '4-TH': 'dd_dvcc', '5-THCS': 'dd_dvcc', '6-THPT': 'dd_dvcc', '9-TM': 'dd_dvcc', 'CC-DV': 'dd_dvcc', TDTT: 'ndd_vh',
    '2-BDX': 'dd_gt', NTR: 'ndd_ht', 'SX-VL': 'ndd_cn', RSX: 'nnk_ln', RPH: 'nnk_ln', RDD: 'nnk_ln', '12-CSD': 'nnk_csd' },
  QHPK: { '4-TH': 'gd', '5-THCS': 'gd', '6-THPT': 'gd', '12-CSD': 'csd' }
};
const PATTERN_ROW = Object.fromEntries(Object.entries(ROW_TT16).map(([kind, rows]) => {
  const out = {};
  Object.entries(rows).forEach(([key, [tt16]]) => { if (!(tt16 in out)) out[tt16] = key; });
  return [kind, { ...out, ...PATTERN_ROW_EXTRA[kind] }];
}));
const PATTERN_SCHOOL = { '6-THPT': 'thpt', '3-MN': 'mn', '4-TH': 'th', '5-THCS': 'thcs' };
const PATTERN_PREFIX = { '1-CV': 'CV', '2-BDX': 'BDX', '3-MN': 'MN', '4-TH': 'TH', '5-THCS': 'THCS', '6-THPT': 'THPT', '7-YT': 'YT', '8-VH': 'VH', TDTT: 'VH', '9-TM': 'TM' };

/**
 * Đầu mục + nhóm con của lô đã lưu theo khóa ký hiệu TT16. infra: lô ranh công trình (dòng Sheet).
 * Lô dịch vụ: ranh công trình là chợ / TTTM (lúc nhập đã khớp loại 9-TM), lô đất thường là dịch vụ khác.
 */
export function savedLandTag(kind, patternKey, infra) {
  const landKey = PATTERN_ROW[kind]?.[patternKey] || null;
  const row = landKey && landRowByKey(kind, landKey);
  let subKey = '';
  if (row && row.subs && !row.split) {
    if (PATTERN_SCHOOL[patternKey]) subKey = PATTERN_SCHOOL[patternKey];
    else if (row.subs.some(([k]) => k === 'cho')) subKey = infra ? 'cho' : 'other';
    else subKey = 'other';
  }
  return { landKey, subKey };
}

/** Loại hạ tầng của lô đã lưu: mã sau "→" > layer TT16 > khóa ký hiệu; lô đất dịch vụ thường không tính chợ / TTTM */
export function savedLotType(layerName, patternKey, infra) {
  const arrow = String(layerName || '').split('→')[1];
  const code = arrow ? arrow.trim().toUpperCase() : '';
  if (LAYER_PREFIXES[code]) return { prefix: code, type: LAYER_PREFIXES[code] };
  const t = layerName ? layerToType(layerName) : null;
  if (t) return t;
  if (patternKey === '9-TM' && !infra) return null;
  const prefix = PATTERN_PREFIX[patternKey];
  return prefix ? { prefix, type: LAYER_PREFIXES[prefix] } : null;
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
  if (!row || !row.subs || row.split) return '';
  const base = String(lot.prefix || '').replace(/_(DT|DV)$/, '');
  if (base === 'THPT') return 'thpt';
  if (base === 'MN' || base === 'TH' || base === 'THCS') return base.toLowerCase();
  if (lot.decisionKind === 'school' && !lot.decision) return 'school';
  if (lot.decisionKind === 'market') return lot.decision === 'CHO' || lot.decision === 'TTTM' ? 'cho' : lot.decision ? 'other' : 'pending';
  return 'other';
}

/**
 * Bảng cân đối: diện tích (ha, 1 số lẻ) và tỷ lệ (%) hiện trạng / quy hoạch theo đúng thứ tự và số thứ tự mẫu TT16,
 * chỉ liệt kê đầu mục (và nhóm con) có diện tích HT hoặc QH > 0; dòng cuối "Chưa xác định" gồm lô chưa rõ đầu mục (landKey null).
 * Có ranh đồ án (boundaryM2): tổng = diện tích ranh, các loại đất lấy phần lô trong ranh (areaIn),
 * đất giao thông = tổng − các loại đất còn lại (hatch giao thông chỉ để đối chiếu).
 * Không có ranh: tổng = cộng các lô, phần chênh để tổng HT = tổng QH dồn vào "Chưa xác định".
 * lots: [{ phase, layer, landKey, subKey, area, areaIn? (m²) }]; landKey 'skip' không tính.
 */
export function landUseSummary(lots, kind, { boundaryM2 = 0 } = {}) {
  const table = LANDUSE_TABLES[kind];
  const sum = { HT: {}, QH: {} };
  const add = (ph, key, v) => { sum[ph][key] = (sum[ph][key] || 0) + v; };
  const undet = { HT: 0, QH: 0 };
  const present = { HT: false, QH: false };
  const bound = Number(boundaryM2) > 0 ? Number(boundaryM2) : 0;
  lots.forEach(p => {
    if (p.landKey === 'skip') return;
    const ph = p.phase === 'HT' ? 'HT' : 'QH';
    present[ph] = true;
    // Có ranh: chỉ tính phần lô nằm trong ranh (areaIn, m²)
    const v = bound && Number.isFinite(p.areaIn) ? p.areaIn : Number(p.area) || 0;
    if (!p.landKey) { undet[ph] += v; return; }
    add(ph, p.landKey, v);
    const split = residentialSubAreas(v === p.area ? p : { ...p, area: v }, kind);
    if (split) Object.entries(split).forEach(([k, a]) => add(ph, `${p.landKey}/${k}`, a));
    else if (p.subKey) add(ph, `${p.landKey}/${p.subKey}`, v);
  });
  const leafRows = table.rows.filter(r => r.key && !r.sumOf);
  const gtKey = ROAD_KEY[kind];
  const gtHatch = { HT: 0, QH: 0 };
  const over = { HT: 0, QH: 0 };
  if (bound) {
    ['HT', 'QH'].forEach(ph => {
      if (!present[ph]) return;
      gtHatch[ph] = sum[ph][gtKey] || 0;
      const others = leafRows.reduce((s, r) => s + (r.key === gtKey ? 0 : sum[ph][r.key] || 0), 0) + undet[ph];
      sum[ph][gtKey] = Math.max(0, bound - others);
      over[ph] = Math.max(0, others - bound);
    });
  }
  const total = { HT: 0, QH: 0 };
  leafRows.forEach(r => { total.HT += sum.HT[r.key] || 0; total.QH += sum.QH[r.key] || 0; });
  total.HT += undet.HT;
  total.QH += undet.QH;
  const gap = { HT: 0, QH: 0 };
  if (bound) {
    ['HT', 'QH'].forEach(ph => { if (present[ph]) total[ph] = bound; });
  } else if (present.HT && present.QH && Math.abs(total.QH - total.HT) >= BALANCE_MIN_M2) {
    // Cùng 1 ranh đồ án nên tổng HT = tổng QH: bên thiếu (hatch chưa phủ hết ranh) dồn phần chênh vào "Chưa xác định"
    const side = total.QH > total.HT ? 'HT' : 'QH';
    gap[side] = Math.abs(total.QH - total.HT);
    undet[side] += gap[side];
    total[side] += gap[side];
  }
  const pct = (v, t) => (t > 0 ? Math.round(v / t * 1000) / 10 : 0);
  const ha = (m2) => Math.round(m2 / 1000) / 10;
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
      kind: 'row', key: r.key, stt: r.sub ? '' : stt, label: r.label, sym: r.sym, code: (r.codes || []).join(', '), ...landSymbol(kind, r.key), sub: !!r.sub, sum: !!r.sumOf,
      ...cells(ht, qh)
    });
    (r.subs || []).forEach(([sk, label, sym]) => {
      const sht = sum.HT[`${r.key}/${sk}`] || 0;
      const sqh = sum.QH[`${r.key}/${sk}`] || 0;
      if (!(sht > 0 || sqh > 0)) return;
      out.push({ kind: 'row', key: `${r.key}/${sk}`, stt: '', label: `- ${label}`, sym, code: '', ...landSymbol(kind, r.key, sk), sub: true, part: true, ...cells(sht, sqh) });
    });
  });
  const rows = out.filter(r => {
    if (r.kind !== 'section') return true;
    const t = sectionTotals[r.section];
    Object.assign(r, cells(t.HT, t.QH));
    return t.HT > 0 || t.QH > 0;
  });
  if (undet.HT > 0 || undet.QH > 0) {
    rows.push({
      kind: 'row', key: UNDETERMINED_KEY, stt: '', label: 'Chưa xác định (tạm thời)', sym: 'CXĐ', code: '', ...landSymbol(kind, UNDETERMINED_KEY),
      undetermined: true, gapHtHa: ha(gap.HT), gapQhHa: ha(gap.QH), ...cells(undet.HT, undet.QH)
    });
  }
  return {
    rows, totalHT: ha(total.HT), totalQH: ha(total.QH), sections: Object.keys(sectionTotals),
    byBoundary: !!bound, gtKey,
    gtHatchHtHa: ha(gtHatch.HT), gtHatchQhHa: ha(gtHatch.QH), overHtHa: ha(over.HT), overQhHa: ha(over.QH)
  };
}

/**
 * Phần hiện trạng / mới của lô thuộc đầu mục split (đơn vị ở / nhóm nhà ở), cộng thẳng theo layer:
 * file HT → hiện trạng; file QH: layer tiền tố HT_ → đất ở hiện trạng theo quy hoạch, QHDD_ / QHDH_ / QH_ (hoặc không tiền tố) → đất ở mới.
 * lot.existing: lô đồ án đã lưu có tên layer ghi hiện trạng / chỉnh trang / cải tạo.
 */
export function residentialSubAreas(lot, kind) {
  const row = landRowByKey(kind, lot.landKey);
  if (!row || !row.split) return null;
  const area = Number(lot.area) || 0;
  return lot.phase === 'HT' || lot.existing || layerStage(lot.layer) === 'HT' ? { ht: area } : { moi: area };
}

/**
 * Kiểm soát đất ở mới: dân số mới tăng thêm = dân số QH − dân số HT;
 * chỉ tiêu đất đơn vị ở mới bình quân = đất đơn vị ở mới (file QH) / dân số mới.
 * QHC tối đa newLandMax (55 m²/người); QHPK chỉ để tham khảo.
 */
export function newLandControl(lots, kind, popHT, popQH) {
  const table = LANDUSE_TABLES[kind];
  const row = table.rows.find(r => r.split);
  let current = 0, existing = 0, fresh = 0;
  lots.forEach(p => {
    if (p.landKey !== row.key) return;
    const s = residentialSubAreas(p, kind);
    if (p.phase === 'HT') { current += s.ht; return; }
    existing += s.ht || 0;
    fresh += s.moi || 0;
  });
  const newPop = Math.max(0, (Number(popQH) || 0) - (Number(popHT) || 0));
  const ratio = newPop > 0 ? Math.round(fresh / newPop * 10) / 10 : null;
  const max = table.newLandMax || 0;
  return {
    landLabel: table.landLabel, currentArea: Math.round(current), existingArea: Math.round(existing), newArea: Math.round(fresh),
    newPop, ratio, max, pass: max > 0 && ratio != null ? ratio <= max : null
  };
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
  if (decision) core = core.replace(/_(CHO|TM|TTTM|KHAC)$/, '');
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

// Chỉ tiêu m²/người, bán kính (m) và quy mô tối thiểu mỗi công trình (minSize, m²) cùng bộ đô thị đang dùng cho bảng phường
// (config/constants.js, hồ sơ DT). Cây xanh lấy bán kính theo hạng diện tích từng hatch, không dùng số ở cột radius.
export const REVIEW_ROWS = [
  { section: 'A', key: 'THPT', label: 'Trường THPT', quota: 0.60, radius: 2000, minSize: 5000 },
  { section: 'A', key: 'YT_DT', label: 'Y tế cấp đô thị', quota: 0.40, radius: 2000, minSize: 1000 },
  { section: 'A', key: 'VH_DT', label: 'Văn hóa - Thể thao cấp đô thị', quota: 1.60, radius: 2000, minSize: 1000 },
  { section: 'A', key: 'TM_DT', label: 'Chợ - TMDV cấp đô thị', quota: 0.40, radius: 2000, minSize: 1500 },
  { section: 'A', key: 'CV_DT', label: 'Cây xanh đô thị', quota: 5.00, radius: 0, minSize: 10000 },
  { section: 'A', key: 'BDX_DT', label: 'Bãi đỗ xe cấp đô thị', quota: 1.50, radius: 2000, minSize: 1000 },
  { section: 'B', key: '3-MN', label: 'Trường Mầm non', quota: 0.60, radius: 1000, perUnit: true, minSize: 800 },
  { section: 'B', key: '4-TH', label: 'Trường Tiểu học', quota: 0.65, radius: 1000, perUnit: true, minSize: 2000 },
  { section: 'B', key: '5-THCS', label: 'Trường THCS', quota: 0.55, radius: 1000, perUnit: true, minSize: 2500 },
  { section: 'B', key: 'YT_DV', label: 'Y tế đơn vị ở', quota: 0, radius: 1000, minSize: 500 },
  { section: 'B', key: 'VH_DV', label: 'Văn hóa thể thao đơn vị ở', quota: 0, radius: 1000, minSize: 500 },
  { section: 'B', key: 'TM_DV', label: 'Chợ - TMDV đơn vị ở', quota: 0, radius: 1000, minSize: 1000 },
  { section: 'B', key: 'DVCC_TOTAL', label: 'Dịch vụ công cộng khác đơn vị ở (y tế, văn hóa, chợ)', quota: 0.20, radius: 1000, sumOf: ['YT_DV', 'VH_DV', 'TM_DV'] },
  { section: 'B', key: 'DVCC_ALL', label: 'Tổng đất dịch vụ công cộng đơn vị ở (gồm trường học)', quota: 2.00, radius: 0, sumOf: ['3-MN', '4-TH', '5-THCS', 'YT_DV', 'VH_DV', 'TM_DV'] },
  { section: 'B', key: 'CV_DV', label: 'Vườn hoa (cây xanh đơn vị ở)', quota: 2.00, radius: 400, minSize: 500 },
  { section: 'B', key: 'BDX_DV', label: 'Bãi đỗ xe đơn vị ở', quota: 2.50, radius: 500, minSize: 500 }
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

/** Quy mô tối thiểu (m²) mỗi công trình của dòng thẩm định, 0 nếu không quy định */
export function rowMinSize(key) {
  return (ROW_BY_KEY[key] && ROW_BY_KEY[key].minSize) || 0;
}

/** Tên đồ án từ tên file: "HT-ABCD.dxf" → "ABCD" */
export function projectOfFile(fileName) {
  return String(fileName || '').replace(/\.[^.]+$/, '').replace(/^(HT|QH)[-_\s]+/i, '').trim();
}
