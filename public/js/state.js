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
  // Ranh lô đất nhập từ DXF: "HT|<ID_DoiTuong>" / "QH|<ID_DoiTuong>" → GeoJSON geometry
  cadParcels: new Map(),
  showParcels: true,
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
  tempMarker: null
};

export function bumpDataVersion() {
  state.dataVersion++;
}

// Mạng lưới hạ tầng khác (config/constants.js NETWORK_CODES): không tính quy mô m²/người, độ phủ tổng hợp và heatmap
export const NETWORK_TYPES = ["10-BUS", "11-PCCC", "12-NT"];
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

export function effectiveRadius(item) {
  // Khoảng cách an toàn nghĩa trang là quy định cố định, không theo bán kính giả định; nhà tang lễ = 0 (không có vùng)
  if (item && item.type === '12-NT') return Number(item.radius) || 0;
  if (state.globalBufferRadiusOverride !== null) return state.globalBufferRadiusOverride;
  return Number(item.radius) || Number(item.banKinh) || 500;
}

export const infraLabels = {
  "1-CV": "Công viên, điểm xanh, vườn hoa",
  "2-BDX": "Bãi đỗ xe, trạm sạc xe điện",
  "3-MN": "Trường Mầm non",
  "4-TH": "Trường Tiểu học",
  "5-THCS": "Trường THCS",
  "THPT": "Trường THPT",
  "6-YT": "Bệnh viện, Trạm y tế",
  "7-VH": "Nhà văn hóa, thể thao",
  "8-TM": "Chợ, Trung tâm thương mại",
  "9-CSD": "Cơ sở chưa sử dụng",
  "10-BUS": "Trạm dừng xe buýt",
  "11-PCCC": "Trụ sở cảnh sát PCCC",
  "12-NT": "Nhà tang lễ, nghĩa trang"
};

// Ranh giới phường xã: nét viền ghi xám vẽ dưới + nét vàng nhạt vẽ trên (đổ bóng rẻ, không dùng CSS filter)
export const WARD_BOUNDARY_SHADOW_STYLE = { color: '#64748b', weight: 4, opacity: 0.55, fill: false, interactive: false };
export const WARD_BOUNDARY_LINE_STYLE = { color: '#fde68a', weight: 1.6, opacity: 0.95, fill: false, interactive: false };
export const WARD_HIGHLIGHT_STYLE = { color: '#fb923c', weight: 3.5, dashArray: '6,6', fillColor: '#fb923c', fillOpacity: 0.15, interactive: false };

// Màu hiển thị 10 lớp hạ tầng (vùng phủ, biểu đồ, ô màu danh sách lớp, màu nền lô khi zoom xa) — tông sáng nổi trên nền
// vệ tinh / giao diện tối, giữ họ màu của TT 16/2025 (cây xanh lục, y tế hồng tím, văn hóa hồng, dịch vụ đỏ, chưa sử dụng xám);
// lớp màu ACI tối của TT16 (trường học, bãi đỗ xe) thay bằng màu tươi, mỗi cấp trường 1 màu riêng.
// Hoa văn ranh lô khi phóng to vẫn theo đúng màu ACI của TT16 (tt16Symbols.js).
export const BUFFER_COLORS = {
  "1-CV": "#7ed321", "2-BDX": "#4dabf7", "3-MN": "#ffd43b", "4-TH": "#ff922b", "5-THCS": "#20c997", "THPT": "#b197fc",
  "6-YT": "#f06cdb", "7-VH": "#ff8fab", "8-TM": "#ff5c5c", "9-CSD": "#ced4da",
  "10-BUS": "#00e5ff", "11-PCCC": "#ff3d00", "12-NT": "#a1887f"
};
export const BUFFER_KEYS = {
  "1-CV": "b1", "2-BDX": "b2", "3-MN": "b3", "4-TH": "b4", "5-THCS": "b5", "THPT": "b10",
  "6-YT": "b6", "7-VH": "b7", "8-TM": "b8", "9-CSD": "b9",
  "10-BUS": "b11", "11-PCCC": "b12", "12-NT": "b13"
};
export const ICON_GROUP_KEYS = {
  "1-CV": "c1", "2-BDX": "c2", "3-MN": "c3", "4-TH": "c4", "5-THCS": "c5", "THPT": "c10",
  "6-YT": "c6", "7-VH": "c7", "8-TM": "c8", "9-CSD": "c9",
  "10-BUS": "c11", "11-PCCC": "c12", "12-NT": "c13"
};

// Trường THPT lưu mã 4-TH (chỉ tiêu tính riêng ở máy chủ theo constants.isThptItem); trên bản đồ tách thành lớp riêng
const layerTypeMemo = new WeakMap();
export function layerType(p) {
  if (!p || p.type !== '4-TH') return p ? p.type : undefined;
  let t = layerTypeMemo.get(p);
  if (!t) {
    const prefix = String(p.id || '').split('-')[0].toUpperCase();
    const name = String(p.name || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/Đ/g, 'D');
    t = prefix === 'THPT' || name.includes('THPT') || name.includes('TRUNG HOC PHO THONG') ? 'THPT' : '4-TH';
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

// Dữ liệu bản đồ quy hoạch: công trình có QuyMo_QH (hiện trạng bỏ di dời + quy hoạch mới), diện tích lấy theo QuyMo_QH
export function getPlanScenarioList() {
  if (planListCache.version === state.dataVersion) return planListCache.list;
  const list = [];
  state.rawDataList.forEach(it => {
    if (it.planChange === 'relocate') return;
    list.push({ ...it, size: it.sizeQH ?? it.size, sizeHT: it.sizeHT ?? it.size, scenario: 'QH' });
  });
  state.planDataList.forEach(it => list.push({ ...it, size: it.sizeQH, scenario: 'QH' }));
  planListCache = { version: state.dataVersion, list };
  return list;
}
