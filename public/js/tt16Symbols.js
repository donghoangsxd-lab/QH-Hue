// Ký hiệu ranh lô theo TT 16/2025/TT-BXD (Phụ lục I, Mục 04 – QHPK 1/2.000, 1/5.000, trang 19–22).
// Màu = mã ACI cột "Màu". Chín nhóm hạ tầng trích nét vector từ Phụ lục; các loại đất còn lại của Mục 04 vẽ theo cùng ô ký hiệu.
// Viền theo khung ô ký hiệu: hiện trạng (HT_) mảnh; quy hoạch đợt đầu (QHDD_) dải liền; dài hạn (QHDH_) dải nét đứt.

// color: RGB chuẩn AutoCAD của mã ACI; pattern: khóa ô lặp trong TILES
export const TT16_STYLES = {
  "1-CV": { label: 'Cây xanh sử dụng công cộng', layer: 'DAT_HTXH_CayxanhCC', aci: 72, color: '#66cc00', pattern: 'CayxanhCC' },
  // TT16 cho bãi đỗ xe ACI 252 (xám), gần trùng nghĩa trang ACI 251 nên mượn màu khai thác khoáng sản ACI 175
  "2-BDX": { label: 'Đất bãi đỗ xe', layer: 'DAT_HTKT_Baidoxe', aci: 175, color: '#4d4d99', pattern: 'Baidoxe' },
  // Thông tư 16 gom ba cấp vào một ký hiệu, màu ACI 15. THCS giữ #994c4c; mầm non và tiểu học sáng hơn, cùng họ gạch đỏ. solidOpacity giúp ba màu này còn tách được khi thu nhỏ (tô đặc).
  "3-MN": { label: 'Trường mầm non', layer: 'DAT_HTXH_Truonghoc', color: '#ff8f70', pattern: 'Truonghoc', solidOpacity: 0.62 },
  "4-TH": { label: 'Trường tiểu học', layer: 'DAT_HTXH_Truonghoc', color: '#e25b48', pattern: 'Truonghoc', solidOpacity: 0.62 },
  "5-THCS": { label: 'Trường THCS', layer: 'DAT_HTXH_Truonghoc', aci: 15, color: '#994c4c', pattern: 'Truonghoc', solidOpacity: 0.62 },
  "6-THPT": { label: 'Trường THPT', layer: 'DAT_HTXH_TruongTHPT', aci: 24, color: '#992600', pattern: 'THPT' },
  "7-YT": { label: 'Y tế', layer: 'DAT_HTXH_Yte', aci: 220, color: '#ff00bf', pattern: 'Yte' },
  "8-VH": { label: 'Văn hóa', layer: 'DAT_HTXH_Vanhoa', aci: 243, color: '#cc667f', pattern: 'Vanhoa' },
  "TDTT": { label: 'Thể dục thể thao', layer: 'DAT_HTXH_Theducthethao', aci: 94, color: '#009900', pattern: 'TDTT' },
  "9-TM": { label: 'Khu dịch vụ (chợ, TTTM)', layer: 'DAT_Dichvu', aci: 12, color: '#cc0000', pattern: 'Dichvu' },
  // Cơ sở nhà đất chưa sử dụng: không có trong TT16 (khác loại đất "Chưa sử dụng" DCS), mượn hoa văn, màu riêng để không lẫn
  "12-CSD": { label: 'Cơ sở nhà đất chưa sử dụng', layer: 'CSD (ngoài TT16)', color: '#f08c00', pattern: 'Chuasudung', fillOpacity: 0.45 }
};
// Loại đất Mục 04 còn lại (và đầu mục tương ứng của quy hoạch chung). codes: tên phân lớp, bỏ tiền tố giai đoạn
Object.assign(TT16_STYLES, {
  "O-NO": { label: 'Nhóm nhà ở', layer: 'DAT_O_Nhomnhao', aci: 42, color: '#cc9900', pattern: 'Nhomnhao' },
  "O-HH": { label: 'Hỗn hợp nhóm nhà ở và dịch vụ', layer: 'DAT_O_Honhop_Nhomo', aci: 22, color: '#cc3200', pattern: 'Honhop' },
  "O-LX": { label: 'Làng xóm, dân cư nông thôn', layer: 'DAT_O_Langxom', aci: 57, color: '#7f7f40', pattern: 'Langxom' },
  "CX-HC": { label: 'Cây xanh sử dụng hạn chế', layer: 'DAT_Cayxanhhanche', aci: 94, color: '#009900', pattern: 'Cayxanhhanche' },
  "CX-CD": { label: 'Cây xanh chuyên dụng', layer: 'DAT_Cayxanhchuyendung', aci: 126, color: '#007f5f', pattern: 'Cayxanhchuyendung' },
  "SX-CN": { label: 'Sản xuất công nghiệp, kho bãi', layer: 'DAT_SX_Congnghiep', aci: 192, color: '#6600cc', pattern: 'Congnghiep' },
  "SX-VL": { label: 'Khai thác khoáng sản, VLXD', layer: 'DAT_SX_Vatlieu', aci: 175, color: '#4d4d99', pattern: 'Vatlieu' },
  "CC-DV": { label: 'Công cộng - dịch vụ', layer: 'DAT_DD_DVCCdothi', color: '#e03131', pattern: 'DVCC' },
  "DT-NC": { label: 'Đào tạo, nghiên cứu', layer: 'DAT_DaotaoNC', aci: 144, color: '#007399', pattern: 'DaotaoNC' },
  "CQ": { label: 'Cơ quan, trụ sở', layer: 'DAT_Coquan', aci: 34, color: '#994c00', pattern: 'Coquan' },
  "DL": { label: 'Khu dịch vụ du lịch', layer: 'DAT_Dulich', aci: 210, color: '#ff00ff', pattern: 'Dulich' },
  "DT-TG": { label: 'Di tích, tôn giáo', layer: 'DAT_Ditich_tongiao', aci: 16, color: '#7f0000', pattern: 'Ditich' },
  "AN": { label: 'An ninh', layer: 'DAT_Anninh', aci: 64, color: '#739900', pattern: 'Anninh' },
  "QP": { label: 'Quốc phòng', layer: 'DAT_Quocphong', aci: 79, color: '#394c26', pattern: 'Quocphong' },
  "GT": { label: 'Đường giao thông', layer: 'DAT_HTKT_DuongGT', aci: 251, color: '#5b5b5b', pattern: 'DuongGT' },
  "NTR": { label: 'Nghĩa trang', layer: 'DAT_HTKT_Nghiatrang', aci: 251, color: '#5b5b5b', pattern: 'Nghiatrang' },
  "HTK": { label: 'Hạ tầng kỹ thuật khác', layer: 'DAT_HTKT_Hatangkhac', aci: 199, color: '#39264c', pattern: 'Hatangkhac' },
  "NN": { label: 'Sản xuất nông nghiệp', layer: 'DAT_NN_Nongnghiep', aci: 3, color: '#00ff00', pattern: 'Nongnghiep' },
  "RDD": { label: 'Rừng đặc dụng', layer: 'DAT_NN_Rungdacdung', aci: 148, color: '#00394c', pattern: 'Rungdacdung' },
  "RPH": { label: 'Rừng phòng hộ', layer: 'DAT_NN_Rungphongho', aci: 129, color: '#264c43', pattern: 'Rungphongho' },
  "RSX": { label: 'Rừng sản xuất', layer: 'DAT_NN_Rungsanxuat', aci: 107, color: '#3f7f4f', pattern: 'Rungsanxuat' },
  "TS": { label: 'Nuôi trồng thủy sản', layer: 'DAT_NN_Thuysan', aci: 150, color: '#007fff', pattern: 'Thuysan' },
  "HO": { label: 'Hồ, ao, đầm', layer: 'DAT_KHAC_Honuoc', aci: 154, color: '#004c99', pattern: 'Honuoc' },
  "SS": { label: 'Sông, suối, kênh, rạch', layer: 'DAT_KHAC_Songsuoi', aci: 152, color: '#0066cc', pattern: 'Songsuoi' },
  "MNB": { label: 'Mặt nước ven biển', layer: 'DAT_KHAC_Matnuocbien', aci: 152, color: '#0066cc', pattern: 'Matnuocbien' },
  "DCS": { label: 'Đất chưa sử dụng', layer: 'DAT_KHAC_Chuasudung', aci: 9, color: '#c0c0c0', pattern: 'Chuasudung', fillOpacity: 0.45 }
});

const PATTERN_CODES = [
  ['O-NO', ['DAT_O_NHOMNHAO', 'DAT_DD_DONVIO']],
  ['O-HH', ['DAT_O_HONHOP_NHOMO', 'DAT_O_HONHOP', 'DAT_DD_HONHOP']],
  ['O-LX', ['DAT_O_LANGXOM', 'DAT_NDD_DANCUNT']],
  ['CX-HC', ['DAT_CAYXANHHANCHE', 'DAT_NDD_CAYXANHSDHC']],
  ['CX-CD', ['DAT_CAYXANHCHUYENDUNG', 'DAT_NDD_CAYXANHCD']],
  ['SX-CN', ['DAT_SX_CONGNGHIEP', 'DAT_NDD_CONGNGHIEP']],
  ['SX-VL', ['DAT_SX_VATLIEU']],
  ['CC-DV', ['DAT_DD_DVCCDOTHI', 'DAT_DD_DVCC', 'DAT_DVCC', 'DAT_CCDV', 'DAT_CONGCONG', 'DAT_HTCC']],
  ['DT-NC', ['DAT_DAOTAONC', 'DAT_NDD_DAOTAO']],
  ['CQ', ['DAT_COQUAN', 'DAT_DD_COQUANDOTHI', 'DAT_NDD_COQUAN']],
  ['DL', ['DAT_DULICH', 'DAT_NDD_DULICH']],
  ['DT-TG', ['DAT_DITICH_TONGIAO', 'DAT_DITICHTONGIAO', 'DAT_NDD_DITICH']],
  ['AN', ['DAT_ANNINH', 'DAT_NDD_ANNINH']],
  ['QP', ['DAT_QUOCPHONG', 'DAT_NDD_QUOCPHONG']],
  ['GT', ['DAT_HTKT_DUONGGT', 'DAT_DD_GIAOTHONGDOTHI', 'DAT_NDD_GIAOTHONGDN', 'DAT_NDD_GIAOTHONG', 'DAT_NDD_GIAOTHONGDOINGOAI']],
  ['NTR', ['DAT_HTKT_NGHIATRANG']],
  ['HTK', ['DAT_HTKT_HATANGKHAC', 'DAT_HTKT_HTKTKHAC', 'DAT_HTKT_KHAC', 'DAT_DD_HTKHACDOTHI', 'DAT_NDD_HTKHACDOINGOAI', 'DAT_NDD_HTKTKHAC', 'DAT_NDD_HTKHAC', 'DAT_NDD_HATANGKHAC']],
  ['NN', ['DAT_NN_NONGNGHIEP', 'DAT_NNK_NONGNGHIEP']],
  ['RDD', ['DAT_NN_RUNGDACDUNG', 'DAT_NNK_RUNGDACDUNG']],
  ['RPH', ['DAT_NN_RUNGPHONGHO', 'DAT_NNK_RUNGPHONGHO']],
  ['RSX', ['DAT_NN_RUNGSANXUAT', 'DAT_NNK_RUNGSANXUAT']],
  ['TS', ['DAT_NN_THUYSAN', 'DAT_NNK_THUYSAN']],
  ['HO', ['DAT_KHAC_HONUOC', 'DAT_NNK_HONUOC']],
  ['SS', ['DAT_KHAC_SONGSUOI', 'DAT_NNK_SONGSUOI']],
  ['MNB', ['DAT_KHAC_MATNUOCBIEN', 'DAT_NNK_MATNUOCBIEN']],
  ['1-CV', ['DAT_HTXH_CAYXANHCC', 'DAT_DD_CAYXANHCCDOTHI']],
  ['2-BDX', ['DAT_HTKT_BAIDOXE']],
  ['3-MN', ['DAT_HTXH_TRUONGHOC_MN', 'DAT_DD_TRUONGHOC_MN', 'DAT_HTXH_TRUONGHOC', 'DAT_DD_TRUONGHOC']],
  ['4-TH', ['DAT_HTXH_TRUONGHOC_TH', 'DAT_DD_TRUONGHOC_TH']],
  ['5-THCS', ['DAT_HTXH_TRUONGHOC_THCS', 'DAT_DD_TRUONGHOC_THCS']],
  ['6-THPT', ['DAT_HTXH_TRUONGTHPT', 'DAT_DD_TRUONGTHPT']],
  ['7-YT', ['DAT_HTXH_YTE', 'DAT_NDD_YTE']],
  ['8-VH', ['DAT_HTXH_VANHOA']],
  ['TDTT', ['DAT_HTXH_THEDUCTHETHAO', 'DAT_NDD_VANHOATHETHAO']],
  ['9-TM', ['DAT_DICHVU']],
  ['DCS', ['DAT_KHAC_CHUASUDUNG', 'DAT_NNK_CHUASUDUNG']]
];
const patternByCode = new Map();
PATTERN_CODES.forEach(([key, codes]) => codes.forEach(code => patternByCode.set(code, key)));
const LAYER_STAGE = new Set(['HT', 'QHDD', 'QHDH', 'QH']);
const LAYER_LEVEL = new Set(['QG', 'CV', 'CT', 'CH', 'DVO', 'MN', 'TH', 'THCS', 'CHO', 'TM', 'TTTM', 'KHAC', 'PCCC', 'TANGLE']);

// Nhóm và thứ tự chú giải Quy hoạch, theo Mục 04 TT16 (bảng cân đối QHPK). Ba cấp trường tách màu, cùng hoa văn.
const LEGEND_GROUPS = [
  ['Đất ở', ["O-NO", "O-HH", "O-LX"]],
  ['Hạ tầng xã hội', ["7-YT", "8-VH", "TDTT", "3-MN", "4-TH", "5-THCS", "6-THPT"]],
  ['Công cộng, cây xanh', ["CC-DV", "1-CV", "CX-HC", "CX-CD"]],
  ['Sản xuất', ["SX-CN", "SX-VL"]],
  ['Cơ quan, dịch vụ, di tích', ["DT-NC", "CQ", "9-TM", "DL", "DT-TG"]],
  ['An ninh, quốc phòng', ["AN", "QP"]],
  ['Hạ tầng kỹ thuật', ["GT", "2-BDX", "NTR", "HTK"]],
  ['Nông, lâm nghiệp, thủy sản', ["NN", "RSX", "RPH", "RDD", "TS"]],
  ['Mặt nước, đất khác', ["DCS", "HO", "SS", "MNB", "12-CSD"]]
];
const LEGEND_KEYS = LEGEND_GROUPS.flatMap(([, keys]) => keys);
export const LEGEND_COUNT = LEGEND_KEYS.length;

// Độ đục phần tô lô đất (thanh trượt ở Chú giải): nhân vào fillOpacity của ký hiệu, 1 = đúng mẫu; viền giữ nguyên.
// Đổi giá trị phát LOT_OPACITY_EVENT để các bộ vẽ lô tô lại
const LOT_OPACITY_KEY = 'qh_lot_opacity';
export const LOT_OPACITY_EVENT = 'qh:lot-opacity';
let lotOpacity = (() => {
  try {
    const raw = localStorage.getItem(LOT_OPACITY_KEY);
    const v = raw === null ? NaN : Number(raw);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  } catch (e) { return 1; }
})();

export const getLotOpacity = () => lotOpacity;

export function setLotOpacity(v) {
  const next = Math.min(1, Math.max(0, Number(v)));
  if (!Number.isFinite(next) || next === lotOpacity) return;
  lotOpacity = next;
  try { localStorage.setItem(LOT_OPACITY_KEY, String(next)); } catch (e) { /* chế độ riêng tư */ }
  window.dispatchEvent(new CustomEvent(LOT_OPACITY_EVENT, { detail: next }));
}

// Từ zoom này tô hoa văn; thu nhỏ hơn tô đặc cùng màu ký hiệu
export const TT16_PATTERN_ZOOM = 17;
const FILL_OPACITY = 0.3;
const PATTERN_BG_ALPHA = 0.25;

// Tỷ lệ ký hiệu: 1pt trong Phụ lục = PT_PX px màn hình; nét hoa văn 0.72pt, chấm r 0.36pt
const PT_PX = 1.6;
const LINE_PT = 0.72;
const DOT_R_PT = 0.36;
// Khung ô ký hiệu Phụ lục: dải QHDD/QHDH dày 2.76pt; QHDH nét 10.68pt, hở 5.4pt.
// Trên bản đồ viền QH cố định FRAME_PX ở mọi zoom, chung cho đợt đầu / dài hạn, giữ tỷ lệ nét–hở của Phụ lục:
// dày đúng 2.76pt (4.4px) che kín lô hẹp như dải cây xanh dọc đường.
const FRAME_PT = 2.76;
const DASH_PT = [10.68, 5.4];
const FRAME_PX = 1.8;
const HT_FRAME_PX = 1;
const QHDH_DASH = DASH_PT.map(v => +((v / FRAME_PT) * FRAME_PX).toFixed(1)).join(',');

const r2 = (n) => Math.round(n * 100) / 100;

function pushSeg(out, x0, y0, x1, y1) {
  out.push(r2(x0), r2(y0), r2(x1), r2(y1));
}

// Cắt đoạn vào ô [0,w]×[0,h] để hoa văn lặp liền mạch ở mép ô
function clipSeg(out, w, h, x0, y0, x1, y1) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0, w - x0, y0, h - y0];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-8) { if (q[i] < -1e-6) return; }
    else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return; if (t > t0) t0 = t; }
      else { if (t < t0) return; if (t < t1) t1 = t; }
    }
  }
  if (t1 - t0 < 1e-3) return;
  pushSeg(out, x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy);
}

// Nét ở mép 0 thuộc ô này (mép w / h là mép 0 của ô kế) để khoảng cách đều qua chỗ nối ô
function vLines(w, h, step) {
  const s = [];
  for (let x = 0; x < w - 0.05; x += step) pushSeg(s, x, 0, x, h);
  return s;
}

function hLines(w, h, step) {
  const s = [];
  for (let y = 0; y < h - 0.05; y += step) pushSeg(s, 0, y, w, y);
  return s;
}

// dir > 0: nét \; dir < 0: nét /. Cạnh ô là bội của step thì lặp khít
function diagonals(w, h, step, dir) {
  const s = [];
  if (dir > 0) {
    for (let b = -w; b <= h + step; b += step) clipSeg(s, w, h, 0, b, w, b + w);
  } else {
    for (let b = 0; b <= w + h + step; b += step) clipSeg(s, w, h, 0, b, w, b - w);
  }
  return s;
}

function crosshatch(w, h, step) {
  return diagonals(w, h, step, 1).concat(diagonals(w, h, step, -1));
}

// Kẻ dọc, giữa hai kẽ là nét chéo ngắn (hỗn hợp nhà ở và dịch vụ)
function vSlashes(w, h, step) {
  const s = vLines(w, h, step);
  const pitch = step * 0.9;
  const n = Math.round(w / step);
  for (let i = 0; i < n; i++) {
    const x0 = i * step;
    for (let y = -pitch; y < h + pitch; y += pitch) {
      const phase = (i % 2) * pitch * 0.45;
      clipSeg(s, w, h, x0 + step * 0.18, y + phase + pitch * 0.62, x0 + step * 0.82, y + phase);
    }
  }
  return s;
}

function dotGrid(w, h, step, stagger) {
  const d = [];
  let row = 0;
  for (let y = step / 2; y < h - 0.05; y += step) {
    const ox = stagger && (row % 2) ? step / 2 : 0;
    for (let x = step / 2 + ox; x < w - 0.05; x += step) d.push(r2(x), r2(y));
    if (stagger && row % 2) { d.push(0, r2(y)); d.push(r2(w), r2(y)); }
    row++;
  }
  return d;
}

function plusGrid(w, h, step, arm, stagger) {
  const s = [];
  let row = 0;
  for (let y = step / 2; y < h - 0.05; y += step) {
    const ox = stagger && (row % 2) ? step / 2 : 0;
    const xs = [];
    for (let x = step / 2 + ox; x < w - 0.05; x += step) xs.push(x);
    if (stagger && row % 2) xs.push(0, w);
    xs.forEach(x => {
      clipSeg(s, w, h, x - arm, y, x + arm, y);
      clipSeg(s, w, h, x, y - arm, x, y + arm);
    });
    row++;
  }
  return s;
}

// Tam giác rỗng xếp so le (đất du lịch)
function triangles(w, h, step) {
  const s = [];
  const hw = step * 0.3, hh = step * 0.26;
  let row = 0;
  for (let y = step * 0.55; y < h; y += step * 0.85) {
    const ox = row % 2 ? step / 2 : 0;
    for (let x = ox; x <= w + step; x += step) {
      clipSeg(s, w, h, x - hw, y + hh, x, y - hh);
      clipSeg(s, w, h, x, y - hh, x + hw, y + hh);
      clipSeg(s, w, h, x + hw, y + hh, x - hw, y + hh);
    }
    row++;
  }
  return s;
}

// Lát xương cá: ván 2u × u viền kín, xoay 45° (đất đào tạo, nghiên cứu). Trước khi xoay, ván ngang H_k = [k, k+2]×[k, k+1]
// và ván đứng V_k = [k+1, k+2]×[k-2, k] lát kín theo hai véc tơ (1, 1) và (2, -2) → ô lặp w = 2√2·u, h = √2·u
function herringbone(u) {
  const w = r2(2 * Math.SQRT2 * u), h = r2(Math.SQRT2 * u);
  const s = [];
  const rot = (x, y) => [((x - y) / Math.SQRT2) * u, ((x + y) / Math.SQRT2) * u];
  const plank = (x0, y0, x1, y1) => {
    const p = [rot(x0, y0), rot(x1, y0), rot(x1, y1), rot(x0, y1)];
    for (let i = 0; i < 4; i++) clipSeg(s, w, h, ...p[i], ...p[(i + 1) % 4]);
  };
  for (let m = -3; m <= 3; m++) {
    for (let k = -4; k <= 4; k++) {
      const ox = k + 2 * m, oy = k - 2 * m;
      plank(ox, oy, ox + 2, oy + 1);
      plank(ox + 1, oy - 2, ox + 2, oy);
    }
  }
  return { w, h, segs: s };
}

// Lưới tam giác đều cạnh a, nét 0° / 60° / 120° (đất quốc phòng): ô w = a, h = a√3
function triNet(a) {
  const w = a, h = r2(a * Math.sqrt(3));
  const s = [];
  pushSeg(s, 0, 0, w, 0);
  pushSeg(s, 0, h / 2, w, h / 2);
  for (let k = -1; k <= 1; k++) {
    clipSeg(s, w, h, k * a, 0, k * a + a, h);
    clipSeg(s, w, h, k * a + a, 0, k * a, h);
  }
  return { w, h, segs: s };
}

// Đan chéo ±45° bằng nét đôi cách nhau gap (hạ tầng kỹ thuật khác); size là bội của step
function doubleCross(size, step, gap) {
  const s = [];
  for (let b = -size; b <= size * 2; b += step) {
    [0, gap].forEach(o => {
      clipSeg(s, size, size, 0, b + o, size, b + o + size);
      clipSeg(s, size, size, 0, b + o, size, b + o - size);
    });
  }
  return s;
}

function squares(w, h, step) {
  const s = [];
  const m = step * 0.2;
  for (let y = 0; y < h - 0.01; y += step) {
    for (let x = 0; x < w - 0.01; x += step) {
      pushSeg(s, x + m, y + m, x + step - m, y + m);
      pushSeg(s, x + step - m, y + m, x + step - m, y + step - m);
      pushSeg(s, x + step - m, y + step - m, x + m, y + step - m);
      pushSeg(s, x + m, y + step - m, x + m, y + m);
    }
  }
  return s;
}

function hWaves(w, h, rowStep, amp, cycles) {
  const s = [];
  const n = cycles * 6;
  for (let y = rowStep / 2; y < h - 0.05; y += rowStep) {
    let px = 0, py = y;
    for (let i = 1; i <= n; i++) {
      const x = (w * i) / n;
      const ny = y + amp * Math.sin((i / n) * cycles * Math.PI * 2);
      pushSeg(s, px, py, x, ny);
      px = x; py = ny;
    }
  }
  return s;
}

function hDashes(w, h, dash, gap, rowStep, stagger) {
  const s = [];
  const period = dash + gap;
  let row = 0;
  for (let y = rowStep / 2; y < h - 0.05; y += rowStep) {
    const ox = stagger && (row % 2) ? period / 2 : 0;
    for (let x = -period + ox; x < w; x += period) clipSeg(s, w, h, x, y, x + dash, y);
    row++;
  }
  return s;
}

function hGaps(w, h, rowStep) {
  const s = [];
  const gap = w * 0.22;
  let row = 0;
  for (let y = rowStep / 2; y < h - 0.05; y += rowStep) {
    const g0 = (row % 3) * (w / 3);
    if (g0 > 0.2) pushSeg(s, 0, y, g0, y);
    if (g0 + gap < w - 0.2) pushSeg(s, g0 + gap, y, w, y);
    row++;
  }
  return s;
}

function honeycomb(r) {
  const dx = 1.5 * r;
  const dy = Math.sqrt(3) * r;
  const w = r2(dx * 2);
  const h = r2(dy);
  const s = [];
  for (let col = -1; col <= 3; col++) {
    for (let row = -1; row <= 2; row++) {
      const cx = col * dx;
      const cy = row * dy + (((col % 2) + 2) % 2) * (dy / 2);
      for (let i = 0; i < 6; i++) {
        const a0 = (Math.PI / 3) * i;
        const a1 = (Math.PI / 3) * (i + 1);
        clipSeg(s, w, h,
          cx + r * Math.cos(a0), cy + r * Math.sin(a0),
          cx + r * Math.cos(a1), cy + r * Math.sin(a1));
      }
    }
  }
  return { w, h, segs: s };
}

// Hoa văn trích từ Phụ lục thưa hơn hẳn các loại đất khác khi đặt cạnh nhau: thu nhỏ khoảng cách (giữ độ dày nét, cỡ chấm)
const DENSE_SCALE = 0.7;

// Ô lặp: w × h (pt); segs [x0,y0,x1,y1,…]; dots [x,y,…]; round: đầu nét tròn (hoa văn chấm); dotR: bán kính chấm (pt);
// scale: tỷ lệ hatch so với Phụ lục (mặc định 1)
const TILES = {
  Yte: { w: 5.91, h: 5.88, scale: DENSE_SCALE,
    segs: [0,4.86,3.38,4.86,5.06,4.86,5.91,4.86,5.06,4.86,5.06,0.54] },
  Vanhoa: { w: 11.43, h: 11.43,
    segs: [6.68,11.43,0,4.75,11.43,4.78,6.65,0,9.56,11.43,0,1.87,11.43,1.93,9.51,0,0,11.15,0.38,10.77,1.82,9.33,3.14,7.89,4.58,6.45,6.02,5.01,7.46,3.69,8.9,2.25,10.34,0.81,11.08,0,11.05,11.43,11.43,11.02,0.38,7.89,1.82,6.45,3.14,5.01,4.58,3.69,6.02,2.25,7.46,0.81,8.9,10.77,10.34,9.33,0.38,5.01,1.82,3.69,3.14,2.25,4.58,0.81,6.02,10.77,7.46,9.33,8.9,7.89,10.34,6.45,0,2.63,0.38,2.25,1.82,0.81,2.56,0,2.53,11.43,3.14,10.77,4.58,9.33,6.02,7.89,7.46,6.45,8.9,5.01,10.34,3.69,11.43,2.5,0.38,10.77,0,10.39,11.43,10.52,10.34,9.33,8.9,7.89,7.46,6.45,6.02,5.01,4.58,3.69,3.14,2.25,1.82,0.81,3.8,11.43,3.14,10.77,1.82,9.33,0.38,7.89,10.34,6.45,8.9,5.01,7.46,3.69,6.02,2.25,4.58,0.81,3.77,0] },
  TDTT: { w: 18, h: 18, round: true,
    segs: [1.34,1.6,1.58,1.36,2.06,5.68,2.3,5.32,5.18,1.96,5.42,1.72,2.78,9.76,3.02,9.4,5.9,6.04,6.14,5.68,9.02,2.32,9.26,1.96,0.38,17.44,0.62,17.08,3.5,13.72,3.74,13.48,6.62,10,6.86,9.76,9.74,6.4,9.98,6.04,12.86,2.68,13.1,2.32,4.22,17.8,4.46,17.44,7.34,14.08,7.58,13.72,10.46,10.36,10.7,10.12,13.58,6.64,13.82,6.4,16.7,3.04,16.94,2.68,8.22,18,8.42,17.8,11.18,14.44,11.42,14.08,14.3,10.72,14.54,10.36,17.42,7,17.66,6.76,15.02,14.8,15.26,14.44,1.34,1.6,1.58,1.72,5.18,1.96,5.42,1.96,9.02,2.32,9.26,2.32,12.86,2.68,13.1,2.68,16.7,3.04,16.94,3.04,2.06,5.68,2.3,5.68,5.9,6.04,6.14,6.04,9.74,6.4,9.98,6.4,13.58,6.64,13.94,6.76,17.42,7,17.78,7,2.78,9.76,3.14,9.76,6.62,10,6.98,10.12,10.46,10.36,10.82,10.36,14.3,10.72,14.66,10.72,0,13.47,0.02,13.48,3.5,13.72,3.86,13.72,7.34,14.08,7.7,14.08,11.18,14.44,11.54,14.44,15.02,14.8,15.38,14.8,0.38,17.44,0.74,17.44,4.22,17.8,4.58,17.8,0.74,17.44,0.62,17.08,0.02,13.48,0,13.42,4.58,17.8,4.46,17.44,3.86,13.72,3.74,13.48,3.14,9.76,3.02,9.4,2.3,5.68,2.3,5.32,1.58,1.72,1.58,1.36,8.37,18,8.3,17.8,7.7,14.08,7.58,13.72,6.98,10.12,6.86,9.76,6.14,6.04,6.14,5.68,5.42,1.96,5.42,1.72,11.54,14.44,11.42,14.08,10.82,10.36,10.7,10.12,9.98,6.4,9.98,6.04,9.26,2.32,9.26,1.96,15.38,14.8,15.26,14.44,14.66,10.72,14.54,10.36,13.94,6.76,13.82,6.4,13.1,2.68,13.1,2.32,17.78,7,17.66,6.76,16.94,3.04,16.94,2.68,2.18,3.28,2.66,2.8,2.9,9.4,3.38,8.92,7.94,4.12,8.3,3.76,3.62,15.52,4.1,15.04,8.66,10.24,9.02,9.88,13.7,5.08,14.06,4.6,9.38,16.36,9.74,15.88,14.42,11.2,14.78,10.72,15.02,17.2,15.5,16.84,4.1,15.52,4.1,15.04,3.38,9.4,3.38,8.92,2.66,3.28,2.66,2.8,9.86,16.48,9.74,15.88,9.14,10.36,9.02,9.88,8.42,4.24,8.3,3.76,15.5,17.32,15.5,16.84,14.78,11.2,14.78,10.72,14.18,5.08,14.06,4.6,2.18,3.28,2.66,3.28,7.94,4.12,8.42,4.24,13.7,5.08,14.18,5.08,2.9,9.4,3.38,9.4,8.66,10.24,9.14,10.36,14.42,11.2,14.9,11.2,3.62,15.52,4.1,15.52,9.38,16.36,9.86,16.48,15.02,17.2,15.5,17.32,1.22,2.68,1.58,2.56,5.78,0.88,6.14,0.76,0,6.49,0.26,6.4,4.46,4.84,4.82,4.72,8.9,3.04,9.38,2.92,13.46,1.36,13.82,1.24,3.14,8.68,3.5,8.56,7.7,7,8.06,6.88,12.14,5.2,12.5,5.08,16.7,3.52,17.06,3.4,1.82,12.64,2.18,12.4,6.38,10.84,6.74,10.72,10.82,9.16,11.18,9.04,15.38,7.36,15.74,7.24,0.5,16.48,0.86,16.36,5.06,14.8,5.42,14.56,9.5,13,9.86,12.88,14.06,11.32,14.42,11.2,8.18,16.96,8.66,16.72,12.74,15.16,13.1,15.04,17.3,13.48,17.66,13.36,15.98,17.32,16.34,17.2,13.46,1.36,13.7,1.6,16.7,3.52,16.94,3.76,5.78,0.88,6.02,1.12,8.9,3.04,9.26,3.28,12.14,5.2,12.38,5.44,15.38,7.36,15.62,7.6,1.22,2.68,1.46,2.8,4.46,4.84,4.7,4.96,7.7,7,7.94,7.12,10.82,9.16,11.06,9.28,14.06,11.32,14.3,11.44,17.3,13.48,17.54,13.6,0,6.59,0.26,6.76,3.14,8.68,3.38,8.92,6.38,10.84,6.62,11.08,9.5,13,9.86,13.24,12.74,15.16,12.98,15.4,15.98,17.32,16.22,17.56,1.82,12.64,2.06,12.76,5.06,14.8,5.3,14.92,8.18,16.96,8.54,17.08,0.5,16.48,0.74,16.72,0.26,6.76,0.26,6.4,1.46,2.8,1.58,2.56,0.74,16.72,0.86,16.36,2.06,12.76,2.18,12.52,3.38,8.92,3.5,8.56,4.7,4.96,4.82,4.72,6.02,1.12,6.14,0.76,5.3,14.92,5.42,14.56,6.62,11.08,6.74,10.72,7.94,7.12,8.06,6.88,9.26,3.28,9.38,2.92,8.54,17.08,8.66,16.72,9.86,13.24,9.86,12.88,11.06,9.28,11.18,9.04,12.38,5.44,12.5,5.08,13.7,1.6,13.82,1.24,12.98,15.4,13.1,15.04,14.3,11.44,14.42,11.2,15.62,7.6,15.74,7.24,16.94,3.76,17.06,3.4,16.22,17.56,16.34,17.2,17.54,13.6,17.66,13.36],
    dots: [1.46,1.3,1.34,3.1,4.22,0.94,1.34,4.9,4.22,2.74,17.3,16.9,17.42,15.1,14.54,17.26,17.42,13.42,14.66,15.46,11.78,17.62,17.54,11.62,14.66,13.66,11.9,15.82,17.54,9.82,14.78,11.98,12.02,14.14,9.14,16.3,17.66,8.02,14.9,10.18,12.02,12.34,9.14,14.5,6.38,16.66,17.66,6.22,14.9,8.38,12.14,10.54,9.26,12.7,6.5,14.86,3.62,17.02,17.78,4.42,15.02,6.58,12.14,8.74,9.26,10.9,6.5,13.06,3.74,15.22,0.86,17.38,17.78,2.62,15.02,4.78,12.26,6.94,9.38,9.1,6.62,11.26,3.74,13.42,0.98,15.58,17.9,0.82,15.14,2.98,12.26,5.14,9.5,7.3,6.62,9.46,3.86,11.62,0.98,13.78,15.14,1.18,12.38,3.34,9.5,5.62,6.74,7.66,3.86,9.82,1.1,12.1,12.38,1.54,9.62,3.82,6.74,5.86,3.98,8.02,1.1,10.3,9.62,2.02,6.86,4.18,4.1,6.34,1.22,8.5,9.74,0.22,6.98,2.38,4.1,4.54,1.22,6.7,6.98,0.58,17.78,16.42,16.46,16.66,13.1,17.02,11.06,17.38,9.74,17.5,6.38,17.96,17.9,14.5,14.54,14.98,12.5,15.22,11.18,15.46,7.7,15.82,5.66,16.06,4.34,16.3,0.98,16.78,15.86,12.82,13.82,13.06,12.5,13.3,9.14,13.78,7.1,14.02,5.78,14.14,2.42,14.62,0.38,14.86,17.3,10.78,15.26,11.02,13.94,11.14,10.58,11.62,8.54,11.86,7.22,12.1,3.74,12.46,1.82,12.82,0.38,12.94,16.7,8.86,15.38,9.1,12.02,9.46,9.98,9.82,8.54,9.94,5.18,10.42,3.14,10.66,1.82,10.78,16.82,6.94,13.34,7.42,11.3,7.66,9.98,7.78,6.62,8.26,4.58,8.5,3.26,8.74,14.78,5.26,12.74,5.5,11.42,5.74,8.06,6.22,6.02,6.46,4.7,6.58,1.22,7.06,16.22,3.1,14.18,3.46,12.86,3.58,9.5,4.06,7.46,4.3,6.02,4.54,2.66,4.9,0.62,5.26,17.66,1.06,15.62,1.3,14.18,1.54,10.82,1.9,8.78,2.14,7.46,2.38,4.1,2.86,2.06,3.1,0.74,3.22,10.22,0.1,8.9,0.22,5.54,0.7,3.5,0.94,2.18,1.18,4.94,17.02,3.86,16.3,7.82,17.14,6.62,16.42,1.94,13.42,10.7,17.26,9.5,16.54,4.82,13.54,1.34,11.26,0.26,10.54,13.58,17.38,12.38,16.66,7.7,13.66,4.22,11.38,3.02,10.66,16.34,17.5,15.26,16.78,10.58,13.78,7.1,11.5,5.9,10.78,1.22,7.78,13.46,13.9,9.86,11.62,8.78,10.9,4.1,7.9,0.62,5.74,16.34,14.02,12.74,11.74,11.66,11.02,6.98,8.02,3.5,5.86,2.3,5.14,15.62,11.86,14.54,11.14,9.86,8.14,6.26,5.98,5.18,5.26,0.5,2.26,17.42,11.26,12.74,8.26,9.14,6.1,8.06,5.38,3.38,2.38,15.5,8.38,12.02,6.22,10.94,5.5,6.26,2.5,2.66,0.22,14.9,6.34,13.82,5.62,9.14,2.62,5.54,0.34,17.78,6.46,16.58,5.74,11.9,2.74,8.42,0.46,14.78,2.86,11.3,0.58,17.66,2.98,14.18,0.7,12.98,0.02,17.06,0.82,15.86,0.1,0.26,16.78,3.38,16.18,2.06,14.98,8.54,17.5,6.5,15.7,5.18,14.5,2.3,11.86,0.26,9.94,11.66,17.02,9.62,15.1,8.3,13.9,5.42,11.26,3.38,9.46,2.06,8.26,14.78,16.42,12.74,14.62,11.54,13.42,8.54,10.78,6.5,8.86,5.3,7.66,2.3,5.02,0.26,3.1,17.9,15.94,15.86,14.02,14.66,12.82,11.66,10.18,9.62,8.38,8.42,7.18,5.42,4.54,3.38,2.62,2.18,1.42,17.78,12.34,14.78,9.7,12.74,7.78,11.54,6.58,8.54,3.94,6.5,2.02,5.3,0.94,17.9,9.1,15.86,7.3,14.66,6.1,11.78,3.46,9.62,1.54,8.42,0.34,17.78,5.5,14.9,2.86,12.74,1.06,15.98,0.46,2.06,16.9,0.98,16.18] },
  THPT: { w: 8.58, h: 8.59, scale: DENSE_SCALE,
    segs: [0,1.96,8.58,1.96,0,6.28,8.58,6.28,0.86,8.59,0.86,6.28,0.86,1.96,0.86,0,5.06,6.28,5.06,1.96] },
  Truonghoc: { w: 10.73, h: 10.72, scale: DENSE_SCALE,
    segs: [0,0.19,10.73,0.19,0,5.59,10.73,5.59,1.34,5.59,1.34,0.19,3.98,10.72,3.98,5.59,3.98,0.19,3.98,0,6.74,5.59,6.74,0.19,9.38,10.72,9.38,5.59,9.38,0.19,9.38,0] },
  CayxanhCC: { w: 10.73, h: 9.16, dotR: 0.5,
    segs: [],
    dots: [0.65,0.7,3.33,0.7,6.02,0.7,8.7,0.7,2,2.99,4.68,2.99,7.37,2.99,10.05,2.99,0.65,5.28,3.33,5.28,6.02,5.28,8.7,5.28,2,7.57,4.68,7.57,7.37,7.57,10.05,7.57] },
  Dichvu: { w: 19.3, h: 19.3,
    segs: [10.06,1.18,10.06,10.78,0.46,0,0.46,1.18,0.46,10.78,0.46,19.3,18.1,0,18.1,1.18,18.1,10.78,18.1,19.3,8.5,1.18,8.5,10.78,16.54,0,16.54,1.18,16.54,10.78,16.54,19.3,6.82,1.18,6.82,10.78,14.86,0,14.86,1.18,14.86,10.78,14.86,19.3,5.26,1.18,5.26,10.78,13.3,0,13.3,1.18,13.3,10.78,13.3,19.3,3.58,1.18,3.58,10.78,11.62,0,11.62,1.18,11.62,10.78,11.62,19.3,2.02,1.18,2.02,10.78,10.06,0,10.06,1.18,10.06,10.78,10.06,19.3,0.46,1.18,0.46,10.78,10.06,10.78,0.46,10.78,19.3,1.18,10.06,1.18,0.46,1.18,0,1.18,10.06,12.46,0.46,12.46,19.3,2.74,10.06,2.74,0.46,2.74,0,2.74,10.06,14.02,0.46,14.02,19.3,4.42,10.06,4.42,0.46,4.42,0,4.42,10.06,15.7,0.46,15.7,19.3,5.98,10.06,5.98,0.46,5.98,0,5.98,10.06,17.26,0.46,17.26,19.3,7.54,10.06,7.54,0.46,7.54,0,7.54,10.06,18.82,0.46,18.82,19.3,9.22,10.06,9.22,0.46,9.22,0,9.22,19.3,10.78,10.06,10.78,0.46,10.78,0,10.78,10.06,1.18,0.46,1.18] },
  Baidoxe: { w: 12.05, h: 8.03,
    segs: [12.05,5.76,0,5.76,12.05,1.68,0,1.68,11.9,7.8,9.86,7.8,8.78,7.8,6.86,7.8,5.78,7.8,3.86,7.8,2.78,7.8,0.74,7.8,11.9,3.72,9.86,3.72,8.78,3.72,6.86,3.72,5.78,3.72,3.86,3.72,2.78,3.72,0.74,3.72] },
  Chuasudung: { w: 10.68, h: 10.72, scale: DENSE_SCALE,
    segs: [0,2.1,10.68,2.1,0,4.86,10.68,4.86,0,7.5,10.68,7.5,0,10.14,10.68,10.14,7.22,8.82,4.58,6.18,1.94,3.42,0,1.56,10.68,1.48,9.98,0.78,7.94,8.82,5.3,6.18,2.54,3.42,0,0.88,10.68,0.88,10.58,0.78,8.66,8.82,5.9,6.18,3.26,3.42,0.62,0.78] },
  Nhomnhao: { w: 8, h: 8, scale: DENSE_SCALE, segs: vLines(8, 8, 2) },
  Honhop: { w: 9, h: 9, segs: vSlashes(9, 9, 2.25) },
  Langxom: { w: 9, h: 9, segs: diagonals(9, 9, 2.25, 1) },
  Cayxanhhanche: { w: 9.6, h: 9.6, dotR: 0.42, segs: [], dots: dotGrid(9.6, 9.6, 2.4, false) },
  Cayxanhchuyendung: { w: 11.2, h: 8.4, dotR: 0.36, segs: [], dots: dotGrid(11.2, 8.4, 2.8, true) },
  Congnghiep: { w: 9, h: 9, segs: diagonals(9, 9, 2.25, -1) },
  Vatlieu: { w: 9, h: 9, segs: diagonals(9, 9, 2.25, 1) },
  DVCC: { w: 9, h: 9, segs: vLines(9, 9, 2.25).concat(hLines(9, 9, 2.25)) },
  DaotaoNC: herringbone(3.2),
  // Kẻ ngang dày, kẻ dọc thưa
  Coquan: { w: 7, h: 8, segs: hLines(7, 8, 2).concat(vLines(7, 8, 7)) },
  Dulich: { w: 12, h: 10.2, segs: triangles(12, 10.2, 3) },
  Ditich: { w: 9, h: 9, segs: squares(9, 9, 3) },
  Anninh: { w: 9, h: 9, segs: crosshatch(9, 9, 2.25) },
  Quocphong: triNet(3),
  DuongGT: { w: 9, h: 9, segs: diagonals(9, 9, 1.8, -1) },
  Nghiatrang: { w: 10, h: 8, segs: plusGrid(10, 8, 2.5, 0.72, true) },
  Hatangkhac: { w: 12, h: 12, segs: doubleCross(12, 4, 1.3) },
  Nongnghiep: { w: 12, h: 9, dotR: 0.46, segs: [], dots: dotGrid(12, 9, 3, true) },
  Rungdacdung: { w: 12, h: 8, segs: hWaves(12, 8, 2, 0.55, 3) },
  Rungphongho: { ...honeycomb(2.7), scale: DENSE_SCALE },
  Rungsanxuat: { w: 9, h: 9, segs: crosshatch(9, 9, 3) },
  Thuysan: { w: 12, h: 8, segs: hDashes(12, 8, 1.7, 1.3, 2, true) },
  Honuoc: { w: 9.6, h: 7.2, dotR: 0.32, segs: [], dots: dotGrid(9.6, 7.2, 1.6, false) },
  Songsuoi: { w: 12, h: 8, segs: hDashes(12, 8, 1.35, 0.85, 1.6, false) },
  Matnuocbien: { w: 12, h: 8, scale: DENSE_SCALE, segs: hGaps(12, 8, 2) }
};

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Vẽ ô lặp 9 lần lệch ±1 ô để nét cắt ở mép ô liền với ô kế bên
function drawTile(c, t, k) {
  for (let ox = -t.w; ox <= t.w; ox += t.w) {
    for (let oy = -t.h; oy <= t.h; oy += t.h) {
      c.beginPath();
      for (let i = 0; i < t.segs.length; i += 4) {
        c.moveTo(ox + t.segs[i], oy + t.segs[i + 1]);
        c.lineTo(ox + t.segs[i + 2], oy + t.segs[i + 3]);
      }
      c.stroke();
      const dots = t.dots || [];
      const r = (t.dotR || DOT_R_PT) / k;
      c.beginPath();
      for (let i = 0; i < dots.length; i += 2) {
        c.moveTo(ox + dots[i] + r, oy + dots[i + 1]);
        c.arc(ox + dots[i], oy + dots[i + 1], r, 0, Math.PI * 2);
      }
      c.fill();
    }
  }
}

// Ô mẫu vẽ ở độ phân giải màn hình (retina) để nét không nhòe
const tileCache = new Map();
function tileFor(key) {
  if (tileCache.has(key)) return tileCache.get(key);
  const s = TT16_STYLES[key];
  const t = s && TILES[s.pattern];
  let tile = null;
  if (t && typeof document !== 'undefined') {
    const k = t.scale || 1;
    const w = Math.max(4, Math.round(t.w * PT_PX * k));
    const h = Math.max(4, Math.round(t.h * PT_PX * k));
    const r = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const cv = document.createElement('canvas');
    cv.width = w * r;
    cv.height = h * r;
    const c = cv.getContext('2d');
    c.fillStyle = hexToRgba(s.color, s.fillOpacity || PATTERN_BG_ALPHA);
    c.fillRect(0, 0, cv.width, cv.height);
    c.scale((w * r) / t.w, (h * r) / t.h);
    c.strokeStyle = c.fillStyle = s.color;
    c.lineWidth = LINE_PT / k;
    c.lineCap = t.round ? 'round' : 'butt';
    drawTile(c, t, k);
    tile = { canvas: cv, w, h, r, pattern: null };
  }
  tileCache.set(key, tile);
  return tile;
}

function patternFor(key) {
  const tile = tileFor(key);
  if (!tile) return null;
  if (!tile.pattern) {
    tile.pattern = tile.canvas.getContext('2d').createPattern(tile.canvas, 'repeat');
    if (tile.r > 1 && tile.pattern.setTransform && typeof DOMMatrix !== 'undefined') {
      tile.pattern.setTransform(new DOMMatrix().scale(1 / tile.r));
    }
  }
  return tile.pattern;
}

// "Văn hóa thể thao" (DAT_NDD_VANHOATHETHAO, nhà văn hóa - thể thao) vẫn là văn hóa; thể thao chỉ khi không kèm văn hóa
const SPORT_RE = /THEDUC|TDTT|SANVANDONG|SANGOLF|SANBONG|NHATHIDAU|BEBOI/;
function isSportText(text) {
  const s = foldLayer(text).replace(/[^A-Z0-9]/g, '');
  return SPORT_RE.test(s) || (s.includes('THETHAO') && !s.includes('VANHOA'));
}

/**
 * Loại hạ tầng + tên layer gốc / tên công trình → khóa ký hiệu. Công trình thể dục thể thao dùng ký hiệu TDTT riêng (xanh)
 * dù vẫn thuộc loại 8-VH khi tính chỉ tiêu; loại không có ký hiệu → null (tô màu trung tính), không mượn ký hiệu chưa sử dụng
 */
export function infraStyleKey(type, layer, name) {
  if (type === '8-VH' && (isSportText(layer) || isSportText(name))) return 'TDTT';
  if (type === '11-NT') return 'NTR';
  return TT16_STYLES[type] ? type : null;
}

/**
 * Style Leaflet cho ranh lô. layer: tên layer gốc trong file (tiền tố HT_ / QHDD_ / QHDH_ quyết định kiểu viền);
 * scenario: 'QH' khi vẽ trên bản đồ quy hoạch (layer không có tiền tố thì coi là quy hoạch đợt đầu);
 * detailed: phóng to → hoa văn cùng màu ký hiệu; thu nhỏ → tô đặc đúng màu đó.
 * approved = false → viền đỏ nét đứt (chờ duyệt). name: tên công trình (nhận thể dục thể thao khi layer không ghi).
 */
export function tt16ParcelStyle(type, layer, { scenario, detailed, approved, name }) {
  const key = infraStyleKey(type, layer, name);
  return tt16SymbolStyle(key, key ? TT16_STYLES[key].color : null, layer, { scenario, detailed, approved });
}

/**
 * Cùng nguyên tắc tt16ParcelStyle nhưng chọn thẳng khóa ký hiệu: key = khóa TT16_STYLES (null = đất không có hoa văn,
 * mọi mức zoom tô màu tone); tone = màu tô khi thu nhỏ, mặc định là màu ký hiệu.
 */
export function tt16SymbolStyle(key, tone, layer, { scenario, detailed, approved = true }) {
  const s = key ? TT16_STYLES[key] : null;
  const pattern = detailed && s ? patternFor(key) : null;
  const color = pattern ? s.color : (tone || (s && s.color) || '#94a3b8');
  return {
    color: approved ? color : '#f87171',
    opacity: 0.95,
    ...frameStyle(layer, scenario, approved),
    fillColor: pattern || color,
    fillOpacity: (pattern ? 1 : (s && s.solidOpacity) || (s && s.fillOpacity) || FILL_OPACITY) * lotOpacity
  };
}

// Kiểu viền theo tiền tố layer: HT_ nét mảnh, QHDD_ (hoặc không tiền tố trên kịch bản QH) nét liền, QHDH_ nét đứt
function frameStyle(layer, scenario, approved = true) {
  const stage = String(layer || '').trim().toUpperCase().split(/[_\s]/)[0];
  const plan = stage === 'QHDD' || stage === 'QHDH' || stage === 'QH' || (stage !== 'HT' && scenario === 'QH');
  return {
    weight: plan ? FRAME_PX : HT_FRAME_PX,
    lineCap: 'butt',
    lineJoin: 'miter',
    dashArray: !approved ? '4,4' : stage === 'QHDH' ? QHDH_DASH : null
  };
}

/** Nền CSS ô mẫu hoa văn TT16 (giống ô trong chú giải), '' nếu không có khóa; scale thu nhỏ hoa văn trong ô nhỏ */
export function tt16SwatchCss(key, scale = 1) {
  const tile = key ? tileFor(key) : null;
  if (!tile) return '';
  if (!tile.dataUrl) tile.dataUrl = tile.canvas.toDataURL();
  const w = +(tile.w * scale).toFixed(1), h = +(tile.h * scale).toFixed(1);
  return `background-image:url(${tile.dataUrl});background-size:${w}px ${h}px;`;
}

/** Chú giải ký hiệu lô đất TT16 theo nhóm vào phần tử container; data-search: chữ bỏ dấu để lọc (legendPanel.js) */
export function renderTt16Legend(container) {
  if (!container) return;
  container.innerHTML = LEGEND_GROUPS.map(([name, keys]) => {
    const rows = keys.map(key => {
      const s = TT16_STYLES[key];
      const bg = tt16SwatchCss(key) || `background:${s.color};`;
      const aci = s.aci != null ? ` · ACI ${s.aci}` : '';
      const search = foldLayer(`${s.label} ${s.layer} ${key}`).toLowerCase();
      return `<div class="tt16-row" title="${s.label}\nLayer: ${s.layer}${aci}" data-search="${search}">
        <i class="tt16-swatch" style="${bg}border-color:${s.color};"></i><span>${s.label}</span></div>`;
    }).join('');
    return `<details class="tt16-group" open><summary><span class="tt16-group-name">${name}</span><span class="tt16-group-count">${keys.length}</span></summary>${rows}</details>`;
  }).join('') + '<div class="tt16-empty" hidden>Không có ký hiệu khớp từ khóa.</div>';
}

export const RESIDENTIAL_COLOR = '#d4a20b';

// Layer không có hoa văn TT16: landParcelStyle tô màu nhóm đất ở mọi mức zoom.
// Đất ở gom mọi cách đặt tên (TT16 DAT_O_*, tên trước TT16 "Đất ở đô thị", "dat o lien ke", làng xóm, biệt thự,
// liền kề, nhà vườn, chỉnh trang, tái định cư, nhà ở xã hội) về 1 màu.
const LAND_RULES = [
  { key: 'o', label: 'Đất ở', color: RESIDENTIAL_COLOR, re: /(^|[\s_.-])(DAT[\s_.-]?O|DAT[\s_.-]?ODT|DAT[\s_.-]?ONT|ODT|ONT|NOXH|TDC|NHA[\s_.-]O)($|[\s_.-])|(^|[\s_.-])O[\s_.-](DO[\s_]?THI|NONG[\s_]?THON)|LIEN[\s_]?KE|BIET[\s_]?THU|NHA[\s_]?VUON|CHUNG[\s_]?CU|DONVIO|NHOMNHAO|HON[\s_]?HOP|LANG[\s_]?XOM|DANCUNT|DAT_NO_|CHINH[\s_]?TRANG|TAI[\s_]?DINH[\s_]?CU/ },
  // Công cộng cấp đô thị / đơn vị ở, "đất dịch vụ công cộng", "đất công cộng dịch vụ"; cây xanh, bãi xe công cộng thuộc loại khác
  { key: 'cc', label: 'Đất công cộng - dịch vụ', color: '#e03131', re: /(?<!(CAY[\s_.-]?XANH|BAI[\s_.-]?(DO[\s_.-]?)?XE)[\s_.-]*)CONG[\s_.-]?CONG|DAT_CC($|_)|HTCC|DVCC|CCDV/ },
  // Tên layer CAD trước TT16 viết rời, không dấu ("N - QH - dat co quan", "dat di tich", "An ninh", "dat DVTM")
  { key: 'dtn', label: 'Đất đào tạo, nghiên cứu', color: '#1e3a8a', re: /DAO[\s_]?TAO|NGHIEN[\s_]?CUU|GIAO[\s_]?DUC|NCKH|DAT_GD/ },
  { key: 'cq', label: 'Đất cơ quan, trụ sở', color: '#a1887f', re: /CO[\s_]?QUAN|TRU[\s_]?SO|CQNN|HANH[\s_]?CHINH/ },
  { key: 'an', label: 'Đất an ninh, quốc phòng', color: '#d9480f', re: /ANQP|QPAN|(^|[^A-Z])AN[\s_]?NINH|QUOC[\s_]?PHONG/ },
  { key: 'tg', label: 'Đất di tích, tôn giáo', color: '#7f1d1d', re: /DI[\s_]?TICH|TON[\s_]?GIAO|TIN[\s_]?NGUONG/ },
  // Lô dịch vụ không phải chợ / siêu thị / TTTM (DAT_Dichvu, "Đất khu dịch vụ"); TMD: mã kiểm kê đất thương mại, dịch vụ
  { key: 'dv', label: 'Đất dịch vụ, thương mại', color: '#e8590c', re: /DICH[\s_]?VU|THUONG[\s_]?MAI|(^|[\s_.-])(DVTM|TMDV|TMD)($|[\s_.-])/ },
  // "HG - Mặt nước", "N - AO"; SMN, MNC: mã kiểm kê sông ngòi, kênh rạch / mặt nước chuyên dùng
  { key: 'nuoc', label: 'Đất mặt nước, sông suối, kênh rạch', color: '#0066cc', re: /MAT[\s_]?NUOC|SONG[\s_]?(SUOI|NGOI)|KENH[\s_]?RACH|HO[\s_]?(NUOC|DIEU[\s_]?HOA)|(^|[\s_.-])(AO|SONG|SUOI|KENH|RACH|SMN|MNC)($|[\s_.-])/ },
  { key: 'htkt', label: 'Đất hạ tầng kỹ thuật', color: '#39264c', re: /HTKT|HA[\s_]?TANG[\s_]?KY[\s_]?THUAT|DAU[\s_]?MOI/ },
  // Đất bằng / đồi núi / núi đá chưa sử dụng (mã kiểm kê BCS, DCS, NCS): lô đất, không phải Cơ sở chưa sử dụng (12-CSD)
  { key: 'csd', label: 'Đất chưa sử dụng', color: '#c0c0c0', re: /CHUA[\s_.-]?SU[\s_.-]?DUNG|(^|[\s_.-])(BCS|DCS|NCS)($|[\s_.-])/ }
];

export const LAND_LABELS = [...LAND_RULES.map(r => r.label), 'Đất khác'];

// Lô đất khớp thủ công (cadTypeMapping): layer "<tên gốc> → <khóa TT16>", khóa quyết định nhóm đất thay cho tên gốc.
// null: loại TT16 không thuộc nhóm nào của LAND_RULES (thống kê vào "Đất khác"). Đất ở / chưa sử dụng có mã khớp riêng.
const KEY_LAND_RULE = {
  'O-HH': 'o', 'O-LX': 'o', 'CC-DV': 'cc', 'CX-HC': null, 'CX-CD': null, 'SX-CN': null, 'SX-VL': null,
  'DT-NC': 'dtn', CQ: 'cq', DL: 'dv', 'DT-TG': 'tg', AN: 'an', QP: 'an', GT: 'htkt', NTR: 'htkt', HTK: 'htkt',
  NN: null, RSX: null, RPH: null, RDD: null, TS: null, HO: 'nuoc', SS: 'nuoc', MNB: 'nuoc'
};
export const MANUAL_LAND_KEYS = Object.keys(KEY_LAND_RULE);

function foldLayer(layerName) {
  return String(layerName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'D').toUpperCase();
}

export function landRule(layerName) {
  const s = foldLayer(layerName);
  const key = (s.split('→')[1] || '').trim();
  if (Object.hasOwn(KEY_LAND_RULE, key)) return LAND_RULES.find(r => r.key === KEY_LAND_RULE[key]) || null;
  return LAND_RULES.find(r => r.re.test(s)) || null;
}

export function landColor(layerName) {
  return (landRule(layerName) || {}).color || '';
}

export function landLabel(layerName) {
  return (landRule(layerName) || {}).label || 'Đất khác';
}

export function landPolylineStyle(layerName) {
  const color = landColor(layerName) || '#94a3b8';
  return { color, weight: 2, opacity: 0.95, fillColor: color, fillOpacity: 0.08 * lotOpacity };
}

// Lô hạ tầng nhập khớp thủ công: layer "<tên> → <mã loại>" (cadImportUi), mã cấp đô thị thêm _DT
const TYPE_CODE_PATTERN = { CV: '1-CV', BDX: '2-BDX', MN: '3-MN', TH: '4-TH', THCS: '5-THCS', THPT: '6-THPT', YT: '7-YT', VH: '8-VH', TM: '9-TM', CSD: '12-CSD' };

// Tên loại đất tự do (shapefile gServer, CAD trước TT16) luôn đọc được tiếng Việt nhưng có thể không dấu, viết liền, tách rời
// hoặc viết tắt. Cụm từ dò trên chuỗi bỏ dấu, viết hoa, bỏ hết khoảng trắng / dấu câu nên "datcayxanh", "Đất_cây xanh" như nhau.
// Thứ tự quan trọng: cây xanh / bãi xe trước công cộng ("cây xanh sử dụng công cộng", "bãi đỗ xe công cộng"),
// thể thao trước văn hóa, hỗn hợp trước dịch vụ ("hỗn hợp nhà ở và dịch vụ"), công cộng trước dịch vụ.
const SCHOOL_LEVELS = [['6-THPT', /THPT|TRUNGHOCPHOTHONG/], ['5-THCS', /THCS|TRUNGHOCCOSO/], ['4-TH', /TIEUHOC/], ['3-MN', /MAMNON|MAUGIAO|NHATRE/]];
const PHRASE_RULES = [
  ['CX-HC', /CAYXANH(SUDUNG)?HANCHE/],
  ['CX-CD', /CAYXANH(CHUYENDUNG|CACHLY|PHONGHO)/],
  ['1-CV', /CAYXANH|CONGVIEN|VUONHOA|DIEMXANH/],
  ['2-BDX', /BAI(DO)?XE|DOXE|TRAMSAC/],
  // "quảng trường" không phải trường học: chữ TRUONG phải đứng sau ĐẤT / KHU
  ['SCHOOL', /TRUONGHOC|(DAT|KHU)TRUONG|GIAODUC|MAMNON|MAUGIAO|NHATRE|TIEUHOC|THCS|THPT|TRUNGHOC/],
  ['7-YT', /YTE|BENHVIEN|TRAMY|PHONGKHAM/],
  ['TDTT', /THEDUC|THETHAO|TDTT|SANVANDONG/],
  ['8-VH', /VANHOA/],
  ['DL', /DULICH|NGHIDUONG|RESORT/],
  ['O-HH', /HONHOP|KETHOP/],
  ['CC-DV', /CONGCONG|DVCC|CCDV|HTCC/],
  ['9-TM', /SIEUTHI|THUONGMAI|TTTM|DVTM|TMDV|DICHVU|(DAT|KHU)CHO/],
  ['O-LX', /LANGXOM|DANCUNONGTHON|DATONONGTHON/],
  ['O-NO', /NHAO|CHUNGCU|BIETTHU|LIENKE|TAIDINHCU|NOXH|DATODOTHI/],
  ['DT-TG', /DITICH|TONGIAO|TINNGUONG|DINHCHUA|LANGTAM|NHATHO/],
  ['CQ', /COQUAN|TRUSO|HANHCHINH/],
  ['AN', /ANNINH/],
  ['QP', /QUOCPHONG/],
  ['DT-NC', /DAOTAO|NGHIENCUU/],
  ['GT', /GIAOTHONG|BENTHUYEN|BENXE|DUONGPHO/],
  ['NTR', /NGHIA(TRANG|DIA)/],
  ['HTK', /HTKT|HATANG(KYTHUAT|KHAC)|DAUMOI|XULY(NUOC|RAC)|TRAMBIENAP/],
  ['SX-CN', /CONGNGHIEP|KHOBAI|TIEUTHUCONG/],
  ['SX-VL', /KHOANGSAN|VATLIEU/],
  ['RDD', /RUNGDACDUNG/],
  ['RPH', /RUNGPHONGHO/],
  ['RSX', /RUNGSANXUAT/],
  ['TS', /THUYSAN|NUOITRONG/],
  ['NN', /NONGNGHIEP|TRONGLUA|DATLUA|CAYHANGNAM|CAYLAUNAM/],
  ['HO', /MATNUOC|HONUOC|HODIEUHOA|HOAO/],
  ['SS', /SONG|SUOI|KENH|RACH/],
  // Đất dự trữ phát triển: TT16 không có ký hiệu riêng, tô theo đất chưa sử dụng
  ['DCS', /CHUASUDUNG|BOHOANG|DUTRU/]
];
// Ký hiệu viết tắt đứng riêng (ký hiệu lô "CXCD.A-01", "DDL2", "OHT.C-11"), so trên từng từ đã bỏ số ở cuối.
// Không nhận AN / TT / SON... vì trùng địa danh (Thuận An, Thanh Sơn) hay từ viết tắt chung.
// Ký hiệu lô QHPK Huế: MN = mặt nước (mầm non chỉ khi tên có chữ trường, xem SCHOOL_WORDS), CSD = đất bằng chưa sử dụng,
// DPT = đất dự trữ phát triển, DDL = đất du lịch, DTS = đất nuôi trồng thủy sản
const CODE_TOKENS = {
  CXCD: 'CX-CD', CXCL: 'CX-CD', CXHC: 'CX-HC', CXCC: '1-CV', CXDVO: '1-CV', CXDT: '1-CV', CX: '1-CV', CV: '1-CV',
  BDX: '2-BDX', BX: '2-BDX', MN: 'HO', TH: '4-TH', THCS: '5-THCS', THPT: '6-THPT', YT: '7-YT', VH: '8-VH', TDTT: 'TDTT',
  CHO: '9-TM', TM: '9-TM', TMDV: '9-TM', DVTM: '9-TM', TTTM: '9-TM', DV: '9-TM', CC: 'CC-DV', CCDV: 'CC-DV', DVCC: 'CC-DV',
  HH: 'O-HH', OHT: 'O-NO', OCT: 'O-NO', OM: 'O-NO', ODT: 'O-NO', NO: 'O-NO', NOXH: 'O-NO', TDC: 'O-NO', LK: 'O-NO', BT: 'O-NO',
  OB: 'O-NO', OBT: 'O-NO', OL: 'O-NO', OLK: 'O-NO', OH: 'O-NO',
  ONT: 'O-LX', LX: 'O-LX', CQ: 'CQ', DL: 'DL', DDL: 'DL', DNG: 'DL', TG: 'DT-TG', DTTG: 'DT-TG', TGTN: 'DT-TG', ANQP: 'AN', QP: 'QP',
  GT: 'GT', DGT: 'GT', HTKT: 'HTK', NTR: 'NTR', NTD: 'NTR', CN: 'SX-CN', KCN: 'SX-CN', NN: 'NN', LUA: 'NN', LUC: 'NN',
  RPH: 'RPH', RDD: 'RDD', RSX: 'RSX', NTS: 'TS', DTS: 'TS', SMN: 'SS', MNC: 'HO', DCS: 'DCS', BCS: 'DCS', NCS: 'DCS', CSD: 'DCS', DPT: 'DCS'
};
// Chỉ nhận khi cả giá trị là ký hiệu lô ("P2", "SN.01", "DT 1.02"): đứng trong câu thì trùng chữ viết tắt khác (DT = đô thị)
// SCHOOL: đất giáo dục chưa rõ cấp (khớp thủ công → chọn cấp từng lô)
const LOT_ONLY_TOKENS = {
  P: '2-BDX', SN: 'CQ', DT: 'DT-TG', TN: 'DT-TG', AN: 'AN', GD: 'SCHOOL', HTK: 'HTK', DNN: 'NN', SX: 'SX-CN',
  CVDT: '1-CV', VHDT: '8-VH', YTDT: '7-YT', TMDT: '9-TM'
};

/** Chữ viết tắt đầu của giá trị chỉ gồm ký hiệu lô viết hoa ("CX4.14" → "CX", "OB 1.22" → "OB", "CV-CX.2" → "CV"); '' nếu không phải */
export function lotCodePrefix(text) {
  const s = String(text ?? '').trim();
  if (!s || s.length > 20 || !/^[A-Z][A-Z0-9\s._\-/]*$/.test(s)) return '';
  const head = s.match(/^[A-Z]+/)[0];
  return head.length <= 6 ? head : '';
}

/** Khóa TT16 theo ký hiệu lô viết tắt (CX/CV cây xanh, OB/OL/OH đất ở, P bãi xe, SN cơ quan, TG/DT/TN tôn giáo – di tích...) */
export function lotCodePatternKey(text) {
  const head = lotCodePrefix(text);
  return head ? CODE_TOKENS[head] || LOT_ONLY_TOKENS[head] || '' : '';
}

// Cấp trường viết tắt trong tên đã có chữ trường / giáo dục ("Đất trường THCS, TH, MN")
const SCHOOL_WORDS = { TH: '4-TH', MN: '3-MN' };
// Nhóm đất landRule (tên tách rời: "dat o", "ODT", "N - AO"...) chưa trúng cụm từ trên → ký hiệu TT16 gần nhất
const RULE_PATTERN = {
  o: () => 'O-NO', cc: () => 'CC-DV', dv: () => '9-TM', dtn: () => 'DT-NC', cq: () => 'CQ', tg: () => 'DT-TG',
  htkt: () => 'HTK', csd: () => 'DCS', an: () => 'AN', nuoc: () => 'HO'
};

function schoolPatternKey(compact, words) {
  const hits = SCHOOL_LEVELS.filter(([, re]) => re.test(compact)).map(([k]) => k);
  Object.entries(SCHOOL_WORDS).forEach(([w, key]) => { if (words.includes(w)) hits.push(key); });
  return new Set(hits).size === 1 ? hits[0] : '4-TH';
}

function freePatternKey(text) {
  const [name, typeCode] = foldLayer(text).split('→').map(x => x.trim());
  const words = name.split(/[^A-Z0-9]+/).filter(Boolean);
  const compact = words.join('');
  const base = String(typeCode || '').replace(/_DT$/, '');
  if (TYPE_CODE_PATTERN[base]) {
    if (base === 'VH' && /THEDUC|THETHAO|TDTT/.test(compact)) return 'TDTT';
    return TYPE_CODE_PATTERN[base];
  }
  if (Object.hasOwn(KEY_LAND_RULE, base)) return base;
  const hit = PHRASE_RULES.find(([, re]) => re.test(compact));
  if (hit) return hit[0] === 'SCHOOL' ? schoolPatternKey(compact, words) : hit[0];
  const rule = landRule(name);
  if (rule && RULE_PATTERN[rule.key]) return RULE_PATTERN[rule.key]();
  const code = words.map(w => w.replace(/\d+$/, '')).find(w => CODE_TOKENS[w]);
  return code ? CODE_TOKENS[code] : '';
}

// Ký hiệu lô (chữ viết tắt liền số: "CXHC.A-02", "DDL2", "OHT.C-11") chỉ rõ chức năng hơn phần mô tả kèm theo
// ("Điểm di tích CXHC.A-02" là cây xanh hạn chế có di tích bên trong)
const LOT_CODE_RE = /(?:^|[^A-Z0-9])([A-Z]{2,6})(?=[._-]?(?:[A-Z][._-]?)?\d)/g;
function lotCodeKey(text) {
  const code = [...foldLayer(text).matchAll(LOT_CODE_RE)].map(m => m[1]).find(w => CODE_TOKENS[w]);
  return code ? CODE_TOKENS[code] : '';
}

// Tên lô ghi lúc nhập: "<layer> <ký hiệu lô> – <tên file> #<thứ tự>" hoặc tên riêng; bỏ phần layer và tên file
function lotNameText(lotName, layerName) {
  let s = String(lotName || '').split(' – ')[0].trim();
  if (layerName && s.startsWith(layerName)) s = s.slice(String(layerName).length);
  return s.trim();
}

/** Khóa hoa văn TT16 của tên layer đất (bỏ tiền tố giai đoạn và hậu tố cấp; tên tự do theo từ khóa), '' nếu không có.
 *  lotName: layer không cho biết loại đất (VD shapefile không có trường chức năng, layer = tên file) thì dò ký hiệu / tên lô */
export function landPatternKey(layerName, lotName = '') {
  const t = foldLayer(layerName).split(/[_\s.-]+/).filter(Boolean);
  const core = LAYER_STAGE.has(t[0]) ? t.slice(1) : t.slice();
  while (core.length) {
    const hit = patternByCode.get(core.join('_'));
    if (hit) return hit;
    if (core.length <= 2 || !LAYER_LEVEL.has(core[core.length - 1])) break;
    core.pop();
  }
  const own = lotName ? lotNameText(lotName, layerName) : '';
  return freePatternKey(layerName) || (own ? lotCodeKey(own) || freePatternKey(own) : '');
}

/** Các loại đất chọn được khi Admin đổi lớp 1 lô (thứ tự chú giải Mục 04) */
export const TT16_LAND_KEYS = LEGEND_KEYS.filter(k => TT16_STYLES[k]);

const ARROW_CODE = Object.fromEntries(Object.entries(TYPE_CODE_PATTERN).map(([code, key]) => [key, code]));

/**
 * Tên layer mới khi chuyển lô sang loại đất key: giữ tiền tố giai đoạn (HT_ / QHDD_ / QHDH_ / QH_) của layer cũ
 * vì viền lô đọc giai đoạn từ đó. Ưu tiên tên phân lớp TT16; loại ngoài TT16 dùng dạng khớp thủ công "<layer cũ> → <mã>".
 */
export function layerForPattern(key, oldLayer = '') {
  if (!TT16_STYLES[key]) return '';
  const old = String(oldLayer || '').trim();
  const stage = (old.match(/^(HT|QHDD|QHDH|QH)[_\s.-]/i) || [''])[0];
  const codes = (PATTERN_CODES.find(([k]) => k === key) || [key, []])[1];
  const base = old.split('→')[0].trim() || 'Lô';
  const candidates = [
    `${stage}${TT16_STYLES[key].layer}`,
    ...codes.map(c => `${stage}${c}`),
    `${base} → ${ARROW_CODE[key] || key}`
  ];
  return candidates.find(c => c.length <= 60 && landPatternKey(c) === key) || candidates[candidates.length - 1].slice(0, 60);
}

/** Ranh đất đồ án: thu nhỏ tô đặc màu ký hiệu; phóng tới ngưỡng hoa văn thì kẻ pattern cùng màu */
export function landParcelStyle(layerName, { detailed = false, phase = 'HT', name = '' } = {}) {
  const key = landPatternKey(layerName, name);
  if (key && TT16_STYLES[key]) {
    return tt16SymbolStyle(key, TT16_STYLES[key].color, layerName, { scenario: phase, detailed });
  }
  return { ...landPolylineStyle(layerName), ...frameStyle(layerName, phase) };
}
