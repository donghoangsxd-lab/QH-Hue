/**
 * Quản lý trạng thái ứng dụng & Danh mục cấu hình UI Frontend
 */

export const state = {
  // Phân quyền người dùng: 'VIEWER' (mặc định) hoặc 'ADMIN' — chỉ đặt ADMIN sau khi server xác minh Google token
  currentUserRole: "VIEWER",
  // Google ID token của Admin, gửi kèm mỗi thao tác phê duyệt để server kiểm tra lại
  authToken: null,
  authUser: null,

  // Dữ liệu công trình hạ tầng & Ma trận 40 Phường/Xã
  rawDataList: [],
  // Công trình quy hoạch mới (QuyMo_HT trống, QuyMo_QH có giá trị): chỉ có trên bản đồ quy hoạch
  planDataList: [],
  // Tăng mỗi khi danh sách công trình hoặc trạng thái duyệt thay đổi (làm mới các kết quả lọc đã ghi nhớ)
  dataVersion: 0,
  // Ranh lô đang vẽ: "HT|<ID>" / "QH|<ID>" → { geometry, layer, file }. Chỉ lô trong khung nhìn (projectFiles.js)
  cadParcels: new Map(),
  // Mặc định bật: lô vẽ cùng marker nên bật lớp công trình nào hiện ranh lô lớp đó (khớp ô chk_parcel trong index.html)
  showParcels: true,
  // Lô đất ngoài nhóm hạ tầng của đồ án đang xem, tắt khi mở bản đồ
  landParcels: [],
  showLand: false,
  // Lô hạ tầng của đồ án đang xem: lớp Quy hoạch vẽ trọn đồ án, không phụ thuộc bật/tắt 14 nhóm công trình
  projectInfraLots: [],
  projectInfraFiles: new Set(),
  showProjectInfra: true,
  // Danh mục đồ án từ projects/index.json (kèm đồ án cũ còn trong cad_parcels đến khi chuyển xong)
  projectCatalog: [],
  projectBase: '',
  // Ranh tổng [{ id: Ten_QH, ward, infraCount, landCount, time, geometry }]
  // đồ án người dùng ẩn (Ten_QH, lưu localStorage)
  projectAreas: [],
  showProjects: false,
  hiddenProjects: new Set(),
  wardStatsData: [],
  // Chỉ tiêu mạng lưới toàn TP (getWardStats): { HT, QH } — số nhà tang lễ, diện tích nghĩa trang so với dân số
  cityNetwork: null,

  // Bộ lọc địa bàn: null = xem toàn TP. Huế | "Tên phường" = chỉ lọc riêng phường đó
  selectedWard: null,
  // Danh sách tên + tọa độ tâm 40 phường xã (dùng cho dropdown lọc & bay tới vị trí)
  wardLabelsList: [],

  // Bán kính buffer chung do người dùng nhập (null = bán kính chuẩn của từng công trình do máy chủ gán)
  globalBufferRadiusOverride: null,

  // Trạng thái các chế độ tương tác
  isPickMode: false,
  isInspectMode: false,
  adminDrawMode: null,     // Admin đang vẽ: 'road' = tuyến đường bổ sung (customRoads.js), 'pop' = vùng hiệu chỉnh dân cư (popEdits.js)
  sketchTool: null,        // công cụ phác thảo đang chọn (sketchLayer.js): 'line' | 'polyline' | 'polygon' | 'arrow' | 'circle' | 'text'

  // Đo đạc khoảng cách / diện tích
  activeMeasureType: null,
  measurePoints: [],

  // Marker tạm trên bản đồ
  tempMarker: null,

  // Ô số lượng đang cô lập lớp bản đồ (null = không cô lập). Bấm lại ô đó để khôi phục.
  facilityFocus: null
};

export function bumpDataVersion() {
  state.dataVersion++;
}

// Mạng lưới hạ tầng khác (config/constants.js NETWORK_CODES): không tính quy mô m²/người, độ phủ tổng hợp và heatmap
export const NETWORK_TYPES = ["13-BUS", "10-PCCC", "11-NT", "14-NOXH"];
export const isNetworkType = (type) => NETWORK_TYPES.includes(type);

// Nhà tang lễ / nghĩa trang (cùng hàm ntKind ở config/constants.js): bán kính = khoảng cách an toàn Bảng 23
export const NT_KIND_LABELS = {
  funeral: "Nhà tang lễ", crematorium: "Cơ sở hỏa táng", cemetery_cat: "Nghĩa trang cát táng",
  cemetery_once: "Nghĩa trang chôn cất một lần", cemetery_hung: "Nghĩa trang hung táng"
};
export function ntKindOf(item) {
  if (item && item.ntKind) return item.ntKind;
  const name = String(item && item.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/\s+/g, ' ').trim().toUpperCase();
  if (name.includes('TANG LE')) return 'funeral';
  if (name.includes('HOA TANG') || name.includes('HOA THAN')) return 'crematorium';
  if (name.includes('CAT TANG')) return 'cemetery_cat';
  if (/CHON (CAT )?(MOT|1) LAN/.test(name)) return 'cemetery_once';
  return 'cemetery_hung';
}

// Hạng cây xanh theo diện tích (m²), khớp PARK_TIERS trong config/constants.js
export const PARK_TIERS = [
  { key: "city", label: "Công viên đô thị", minArea: 50000, radius: 2000, urban: true },
  { key: "area", label: "Công viên khu vực", minArea: 10000, radius: 800, urban: true },
  { key: "garden", label: "Vườn hoa", minArea: 0, radius: 400, urban: false }
];

/** Chưa rõ diện tích → theo cấp: cấp đô thị = công viên khu vực, còn lại = vườn hoa */
export function parkTierOf(size, nhomHaTang) {
  const s = Number(size) || 0;
  if (s > 0) return PARK_TIERS.find(t => s >= t.minArea);
  return /đô thị|do thi/i.test(String(nhomHaTang || '')) ? PARK_TIERS[1] : PARK_TIERS[2];
}

export function effectiveRadius(item) {
  // Khoảng cách an toàn nghĩa trang là quy định cố định, không theo bán kính giả định; nhà tang lễ = 0 (không có vùng)
  if (item && (item.type === '11-NT' || item.type === '14-NOXH')) return Number(item.radius) || 0;
  if (state.globalBufferRadiusOverride !== null) return state.globalBufferRadiusOverride;
  return Number(item.radius) || Number(item.banKinh) || 500;
}

export const infraLabels = {
  "1-CV": "Công viên, điểm xanh, vườn hoa",
  "2-BDX": "Bãi đỗ xe, trạm sạc xe điện",
  "3-MN": "Trường Mầm non",
  "4-TH": "Trường Tiểu học",
  "5-THCS": "Trường THCS",
  "6-THPT": "Trường THPT",
  "7-YT": "Bệnh viện, Trạm y tế",
  "8-VH": "Nhà văn hóa, thể thao",
  "9-TM": "Chợ, Trung tâm thương mại",
  "12-CSD": "Cơ sở chưa sử dụng",
  "13-BUS": "Trạm dừng xe buýt",
  "10-PCCC": "Trụ sở cảnh sát PCCC",
  "11-NT": "Nhà tang lễ, nghĩa trang",
  "14-NOXH": "Nhà ở xã hội"
};

// Ranh giới phường xã: nét viền ghi xám vẽ dưới + nét vàng nhạt vẽ trên (đổ bóng rẻ, không dùng CSS filter)
export const WARD_BOUNDARY_SHADOW_STYLE = { color: '#64748b', weight: 4, opacity: 0.55, fill: false, interactive: false };
export const WARD_BOUNDARY_LINE_STYLE = { color: '#fde68a', weight: 1.6, opacity: 0.95, fill: false, interactive: false };
export const WARD_HIGHLIGHT_STYLE = { color: '#fb923c', weight: 3.5, dashArray: '6,6', fillColor: '#fb923c', fillOpacity: 0.15, interactive: false };

// Màu vùng phủ, biểu đồ và ô màu danh sách lớp. Ranh lô (zoom xa tô đặc, zoom gần kẻ hoa văn) dùng màu ký hiệu TT16 trong tt16Symbols.js.
export const BUFFER_COLORS = {
  "1-CV": "#51cf66", "2-BDX": "#94a3b8", "3-MN": "#d0bfff", "4-TH": "#9775fa", "5-THCS": "#7048e8", "6-THPT": "#4c6ef5",
  "7-YT": "#f06595", "8-VH": "#cc5de8", "9-TM": "#e03131", "12-CSD": "#f1f3f5",
  "13-BUS": "#00e5ff", "10-PCCC": "#d9480f", "11-NT": "#795548", "14-NOXH": "#fab005"
};
export const BUFFER_KEYS = {
  "1-CV": "b1", "2-BDX": "b2", "3-MN": "b3", "4-TH": "b4", "5-THCS": "b5", "6-THPT": "b10",
  "7-YT": "b6", "8-VH": "b7", "9-TM": "b8", "12-CSD": "b9",
  "13-BUS": "b11", "10-PCCC": "b12", "11-NT": "b13", "14-NOXH": "b14"
};
export const ICON_GROUP_KEYS = {
  "1-CV": "c1", "2-BDX": "c2", "3-MN": "c3", "4-TH": "c4", "5-THCS": "c5", "6-THPT": "c10",
  "7-YT": "c6", "8-VH": "c7", "9-TM": "c8", "12-CSD": "c9",
  "13-BUS": "c11", "10-PCCC": "c12", "11-NT": "c13", "14-NOXH": "c14"
};

// Tab 6-THPT là loại riêng. Dòng cũ còn ở tab 4-TH (mã hoặc tên THPT) vẫn vẽ vào lớp THPT.
const layerTypeMemo = new WeakMap();
export function layerType(p) {
  if (!p) return undefined;
  if (p.type === '6-THPT') return '6-THPT';
  if (p.type !== '4-TH') return p.type;
  let t = layerTypeMemo.get(p);
  if (!t) {
    const prefix = String(p.id || '').split('-')[0].toUpperCase();
    const name = String(p.name || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/Đ/g, 'D');
    t = prefix === 'THPT' || name.includes('THPT') || name.includes('TRUNG HOC PHO THONG') ? '6-THPT' : '4-TH';
    layerTypeMemo.set(p, t);
  }
  return t;
}
export function getBufferStyle(type, approved) {
  if (!approved) return { color: '#f87171', weight: 2.2, dashArray: '4, 4', fillColor: '#f87171', fillOpacity: 0.10 };
  const color = BUFFER_COLORS[type] || '#38bdf8';
  return { color, weight: 2.2, dashArray: '6, 6', fillColor: color, fillOpacity: 0.12 };
}

// Biến động quy hoạch, phân loại từ QuyMo_HT / QuyMo_QH ở services/gcsService.js
export const PLAN_CHANGE_INFO = {
  new: { label: "Quy hoạch mới", color: "#22c55e" },
  expand: { label: "Mở rộng", color: "#38bdf8" },
  shrink: { label: "Thu hẹp", color: "#f59e0b" },
  relocate: { label: "Di dời", color: "#ef4444" }
};

let planListCache = { version: -1, list: [] };

// Dữ liệu bản đồ quy hoạch: công trình có QuyMo_QH (hiện trạng bỏ di dời + quy hoạch mới), diện tích lấy theo QuyMo_QH;
// cây xanh đổi hạng (bán kính) theo diện tích quy hoạch
const withPlanRadius = (it) => (it.type === '1-CV' ? { ...it, radius: parkTierOf(it.size, it.nhomHaTang).radius } : it);

export function getPlanScenarioList() {
  if (planListCache.version === state.dataVersion) return planListCache.list;
  const list = [];
  state.rawDataList.forEach(it => {
    if (it.planChange === 'relocate') return;
    list.push(withPlanRadius({ ...it, size: it.sizeQH ?? it.size, sizeHT: it.sizeHT ?? it.size, scenario: 'QH' }));
  });
  state.planDataList.forEach(it => list.push(withPlanRadius({ ...it, size: it.sizeQH, scenario: 'QH' })));
  planListCache = { version: state.dataVersion, list };
  return list;
}
