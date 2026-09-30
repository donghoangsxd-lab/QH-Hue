/**
 * Quản lý trạng thái ứng dụng & Danh mục cấu hình UI Frontend
 */
import { TT16_STYLES } from './tt16Symbols.js';

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

  // Đo đạc khoảng cách / diện tích
  activeMeasureType: null,
  measurePoints: [],

  // Marker tạm trên bản đồ
  tempMarker: null
};

export function bumpDataVersion() {
  state.dataVersion++;
}

export function effectiveRadius(item) {
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
  "9-CSD": "Cơ sở chưa sử dụng"
};

// Ranh giới phường xã: nét viền ghi xám vẽ dưới + nét vàng nhạt vẽ trên (đổ bóng rẻ, không dùng CSS filter)
export const WARD_BOUNDARY_SHADOW_STYLE = { color: '#64748b', weight: 4, opacity: 0.55, fill: false, interactive: false };
export const WARD_BOUNDARY_LINE_STYLE = { color: '#fde68a', weight: 1.6, opacity: 0.95, fill: false, interactive: false };
export const WARD_HIGHLIGHT_STYLE = { color: '#fb923c', weight: 3.5, dashArray: '6,6', fillColor: '#fb923c', fillOpacity: 0.15, interactive: false };

// Màu 10 lớp hạ tầng = màu ACI của lớp đất tương ứng theo TT 16/2025/TT-BXD (MN, TH, THCS chung DAT_HTXH_Truonghoc);
// dùng chung cho vùng phủ (buffer), biểu đồ, ô màu danh sách lớp ở cả bản đồ hiện trạng và quy hoạch
export const BUFFER_COLORS = Object.fromEntries(
  ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "THPT", "6-YT", "7-VH", "8-TM", "9-CSD"].map(k => [k, TT16_STYLES[k].color])
);
export const BUFFER_KEYS = {
  "1-CV": "b1", "2-BDX": "b2", "3-MN": "b3", "4-TH": "b4", "5-THCS": "b5", "THPT": "b10",
  "6-YT": "b6", "7-VH": "b7", "8-TM": "b8", "9-CSD": "b9"
};
export const ICON_GROUP_KEYS = {
  "1-CV": "c1", "2-BDX": "c2", "3-MN": "c3", "4-TH": "c4", "5-THCS": "c5", "THPT": "c10",
  "6-YT": "c6", "7-VH": "c7", "8-TM": "c8", "9-CSD": "c9"
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
