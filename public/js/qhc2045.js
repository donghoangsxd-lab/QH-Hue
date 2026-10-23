// Đồ án Quy hoạch chung đô thị Thừa Thiên Huế đến năm 2045, tầm nhìn đến năm 2065 (gServer mapid 21817): đồ án cũ đang được
// điều chỉnh thành QHC thành phố Huế (generalPlan.js), tạm đưa lên để tra cứu. Dữ liệu tĩnh dựng bằng scripts/build-qhc2045.js.
// Không phụ thuộc DOM / Leaflet: lớp bản đồ và luồng khu vực trung tâm ở qhc2045Layer.js.
import { CORE_AREAS } from './generalPlan.js';

// Nút bảng trên dòng «QHC đô thị TTHuế 2045 (Trung tâm)»: projectReview.js mở cơ cấu đất và chỉ tiêu
export const QHC_CENTER_INFO_EVENT = 'qh:qhc-center-info';

export const QHC2045 = {
  name: 'Quy hoạch chung đô thị Thừa Thiên Huế đến năm 2045, tầm nhìn đến năm 2065',
  short: 'QHC đô thị TT Huế 2045',
  status: 'Đang điều chỉnh',
  statusNote: 'Đồ án cũ đang điều chỉnh để khớp hệ thống đô thị theo Quyết định 756/QĐ-UBND; vùng lõi trung tâm cũ chưa phủ hết Hóa Châu, Mỹ Thượng.',
  source: 'gServer gis21.hue.gov.vn, bản đồ 21817',
  urls: {
    land: 'data/qhc2045/sdd.json',
    frame: 'data/qhc2045/khung.json',
    vision: 'data/qhc2045/dinhhuong.json',
    road10: 'data/qhc2045/giaothong10.json',
    road25: 'data/qhc2045/giaothong25.json'
  }
};

// Đô thị trung tâm: bấm vào đây ở màn hình toàn thành phố thì mở QHC 1/10.000 thay vì chọn phường
const CENTER_IDS = ['trung-tam', 'hoa-chau', 'my-thuong'];
export const CENTER_AREAS = CORE_AREAS.filter(a => CENTER_IDS.includes(a.id));
export const CENTER_UNITS = CENTER_AREAS.flatMap(a => a.units);
// Phạm vi 1/10.000 của đồ án cũ (4 tiểu vùng A1–A4) gồm cả Hương Thủy, Hương Trà: danh sách phường, xã gom theo khu vực vùng lõi
export const CORE_GROUPS = CORE_AREAS.map(a => ({ id: a.id, name: a.short, cls: a.cls, units: a.units }));
// Ranh phường ghi tên đầy đủ ("Phường Thuận Hóa"), danh sách vùng lõi ghi tên gọn: so khớp theo tên gọn
export const bareWard = (n) => String(n || '').trim().replace(/^(Phường|Xã|Thị trấn)\s+/i, '');
const coreSet = new Set(CORE_GROUPS.flatMap(g => g.units).map(bareWard));
/** Phường, xã thuộc phạm vi 1/10.000 (vùng lõi, gồm cả Hóa Châu, Mỹ Thượng mở rộng theo QĐ 756) */
export const isCoreWard = (n) => coreSet.has(bareWard(n));

export const ZONE_NAMES = { DD: 'Khu đất dân dụng', NDD: 'Khu đất ngoài dân dụng', NNK: 'Nông nghiệp và chức năng khác' };
const ZONE_TONE = { DD: '#f59e0b', NDD: '#a855f7', NNK: '#65a30d' };
// Lớp TT16 theo giai đoạn: hiện trạng viền mảnh, ngắn hạn viền liền, dài hạn viền nét đứt (frameStyle trong tt16Symbols.js)
export const STAGE_LAYERS = ['HT', 'QHDD', 'QHDH'];

// Mã chucnangsudungdat → khóa ký hiệu TT16 (Mục 02 QHC, thiếu thì mượn khóa Mục 04). Nhãn theo chú giải lớp
// "Chức năng sử dụng đất" của bản đồ 21817 trên gServer. zone: khóa riêng khi cùng mã nằm ở khu khác.
// Dự trữ phát triển và khu công nghệ cao không có ký hiệu TT16: chỉ tô màu (tone).
export const LAND_CODES = {
  2: { key: 'C-DVCC', label: 'Đất dịch vụ - công cộng đô thị' },
  3: { key: 'C-HH', label: 'Đất hỗn hợp' },
  4: { key: 'C-CQDT', label: 'Đất cơ quan, trụ sở đô thị', zone: { NDD: 'C-CQ' } },
  5: { key: 'C-CXDT', label: 'Đất cây xanh sử dụng công cộng đô thị' },
  6: { key: 'C-HTDT', label: 'Đất hạ tầng kỹ thuật khác cấp đô thị' },
  7: { key: 'C-CN', label: 'Đất sản xuất công nghiệp, kho tàng' },
  8: { key: 'SX-VL', label: 'Đất khai thác, chế biến khoáng sản, sản xuất vật liệu xây dựng' },
  9: { key: 'C-DT', label: 'Đất trung tâm đào tạo nghiên cứu' },
  10: { key: '9-TM', label: 'Đất thương mại dịch vụ' },
  12: { key: 'C-DL', label: 'Đất dịch vụ, du lịch' },
  13: { key: 'C-YT', label: 'Đất trung tâm y tế' },
  14: { key: 'C-VHTT', label: 'Đất trung tâm văn hóa, thể dục thể thao' },
  15: { key: 'C-CXHC', label: 'Đất cây xanh sử dụng hạn chế' },
  16: { key: 'C-CXCD', label: 'Đất cây xanh chuyên dụng' },
  17: { key: 'C-DTTG', label: 'Đất di tích, tôn giáo' },
  19: { key: 'C-AN', label: 'Đất an ninh' },
  20: { key: 'C-QP', label: 'Đất quốc phòng' },
  21: { key: 'C-HTNG', label: 'Đất hạ tầng kỹ thuật khác ngoài đô thị' },
  22: { key: 'NTR', label: 'Đất nghĩa trang' },
  23: { key: 'C-NN', label: 'Đất sản xuất nông nghiệp' },
  24: { key: 'C-RDD', label: 'Đất lâm nghiệp rừng đặc dụng' },
  25: { key: 'C-RPH', label: 'Đất lâm nghiệp rừng phòng hộ' },
  26: { key: 'C-RSX', label: 'Đất lâm nghiệp rừng sản xuất' },
  29: { key: 'C-HO', label: 'Hồ, ao, đầm' },
  30: { key: 'C-SS', label: 'Sông, suối, kênh, rạch' },
  31: { key: 'C-MNB', label: 'Mặt nước ven biển' },
  32: { key: 'C-GTDN', label: 'Đất giao thông', zone: { DD: 'C-GTDT' } },
  33: { key: 'C-VHTT', label: 'Đất cây xanh thể dục thể thao' },
  34: { key: null, tone: '#c8b48a', label: 'Đất dự trữ phát triển' },
  35: { key: null, tone: '#4f46e5', label: 'Đất khu công nghệ cao' },
  40: { key: 'C-DVO', label: 'Đất đơn vị ở' },
  41: { key: 'C-GTDN', label: 'Đất giao thông đối ngoại' }
};

/** { key, label, tone } của một lô: key = khóa TT16 (null khi mã không có ký hiệu hoặc chưa có trong bảng) */
export function landOf(zone, code) {
  const hit = LAND_CODES[code];
  if (hit) return { key: (hit.zone && hit.zone[zone]) || hit.key, label: hit.label, tone: hit.tone || null };
  return { key: null, label: `Mã ${code} · ${ZONE_NAMES[zone] || zone}`, tone: ZONE_TONE[zone] || '#94a3b8' };
}

// Màu đặc «Bãi bồi, bãi cát» trên sơ đồ 1/25.000. Cấp 1/10.000, 1/2.000, 1/500 dùng lại (khóa BBC trong tt16Symbols.js).
export const SAND_COLOR = '#fde68a';

// Sơ đồ tổ chức không gian 1/25.000: màu theo tên khu vực phát triển (tên lấy từ dữ liệu, so khớp theo cụm từ)
const VISION_COLORS = [
  [/có kiểm soát/i, '#fcd34d'],
  [/phát triển đô thị/i, '#f59e0b'],
  [/hỗn hợp/i, '#ea580c'],
  [/công cộng|dịch vụ cấp vùng/i, '#ef4444'],
  [/hoàng thành|di tích|tôn giáo/i, '#9f1239'],
  [/nghiên cứu|đào tạo/i, '#0284c7'],
  [/du lịch/i, '#e879f9'],
  [/công nghiệp|công nghệ cao/i, '#7c3aed'],
  [/quốc phòng|an ninh/i, '#4d7c0f'],
  [/nghĩa trang|hạ tầng kỹ thuật/i, '#64748b'],
  [/khoáng sản/i, '#6366f1'],
  [/dân cư nông thôn/i, '#a3a35a'],
  [/nông nghiệp/i, '#a3e635'],
  [/rừng phòng hộ/i, '#2f6b5e'],
  [/rừng đặc dụng/i, '#155e75'],
  [/rừng sản xuất/i, '#3f7f4f'],
  [/bãi bồi|bãi cát/i, SAND_COLOR],
  [/dự trữ/i, '#d6d3d1'],
  [/giao thông/i, '#9ca3af']
];
export const visionColor = (name) => (VISION_COLORS.find(([re]) => re.test(name || '')) || [null, '#cbd5e1'])[1];

export const WATER_KINDS = [
  { label: 'Mặt nước (sông, suối, kênh, đầm)', color: '#3b82f6' },
  { label: 'Khu vực nuôi trồng thủy sản', color: '#38bdf8' },
  { label: 'Mặt nước biển', color: '#1e3a8a' }
];
export const GREEN_COLOR = '#22c55e';

// Chú giải sơ đồ 1/25.000 (tab Chú giải, bộ QHC25): nhãn bỏ tiền tố "Khu vực" của dữ liệu, màu khớp visionColor
const zoneRows = (labels) => labels.map(label => ({ label, color: visionColor(label) }));
export const VISION_LEGEND_GROUPS = [
  ['Phát triển đô thị, dân cư', zoneRows(['Phát triển đô thị', 'Phát triển đô thị có kiểm soát', 'Đất hỗn hợp', 'Dân cư nông thôn', 'Dự trữ phát triển'])],
  ['Công cộng, dịch vụ, di sản', zoneRows(['Công cộng - dịch vụ cấp vùng, cấp tỉnh', 'Nghiên cứu, đào tạo cấp vùng, cấp tỉnh', 'Phát triển du lịch tập trung', 'Hoàng thành, di tích, tôn giáo'])],
  ['Công nghiệp, hạ tầng, quốc phòng', zoneRows(['Phát triển công nghiệp và công nghệ cao', 'Khai thác khoáng sản', 'Giao thông', 'Nghĩa trang và đầu mối hạ tầng kỹ thuật', 'Quốc phòng - an ninh'])],
  ['Nông nghiệp, lâm nghiệp', zoneRows(['Nông nghiệp và phát triển nông thôn', 'Rừng đặc dụng', 'Rừng phòng hộ', 'Rừng sản xuất', 'Bãi bồi, bãi cát'])],
  ['Mặt nước, cây xanh', [...WATER_KINDS.slice(0, 2), { label: 'Không gian cây xanh', color: GREEN_COLOR }]]
];

// Ranh giới khu vực (đường không gian): nét theo loại ranh. Không vàng — trùng ranh phường xã và ranh đô thị loại I
const LINE_STYLES = [
  [/đô thị trung tâm/i, { color: '#38bdf8', weight: 3.5, dashArray: null }],
  [/trung tâm đô thị/i, { color: '#f97316', weight: 2.5, dashArray: null }],
  [/phát triển đô thị/i, { color: '#ef4444', weight: 2, dashArray: '8 5' }],
  [/kiểm soát đô thị/i, { color: '#f472b6', weight: 2, dashArray: '8 5' }],
  [/đô thị hóa/i, { color: '#fb923c', weight: 2, dashArray: '4 4' }],
  [/nông thôn có kiểm soát/i, { color: '#65a30d', weight: 1.8, dashArray: '10 4 2 4' }],
  [/nông thôn/i, { color: '#84cc16', weight: 1.8, dashArray: '4 4' }],
  [/công nghiệp/i, { color: '#8b5cf6', weight: 2, dashArray: '6 4' }],
  [/khu kinh tế/i, { color: '#06b6d4', weight: 2.5, dashArray: '12 4' }],
  [/khoáng sản/i, { color: '#64748b', weight: 1, dashArray: '3 3' }]
];
export const visionLineStyle = (name) => (LINE_STYLES.find(([re]) => re.test(name || '')) || [null, { color: '#e2e8f0', weight: 1.5, dashArray: '4 4' }])[1];

const HA_FORMAT = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

/** Hecta: thuộc tính a (ha) nếu > 0, không thì diện tích địa đo areaM2 / 10.000. */
export function zoneAreaHa(properties, areaM2) {
  const attr = Number(properties && properties.a);
  if (attr > 0) return attr;
  const m2 = Number(areaM2);
  if (!(m2 > 0)) return null;
  return m2 / 10000;
}

export function zoneAreaHtml(properties, areaM2) {
  const ha = zoneAreaHa(properties, areaM2);
  if (!(ha > 0)) return '';
  return `<div class="qhc-pop-area">Diện tích: <b>${HA_FORMAT.format(ha)} ha</b></div>`;
}
