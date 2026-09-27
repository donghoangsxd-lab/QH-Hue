/**
 * Quản lý trạng thái ứng dụng & Danh mục cấu hình UI Frontend
 */
export const state = {
  // Phân quyền người dùng: 'VIEWER' (mặc định) hoặc 'ADMIN'
  currentUserRole: "VIEWER",

  // Danh sách Email được cấp quyền Quản trị (Admin)
  adminEmails: ["donghoangsxd@gmail.com", "admin.sxd@hue.gov.vn"],

  // Dữ liệu công trình hạ tầng & Ma trận 40 Phường/Xã
  rawDataList: [],
  // Công trình quy hoạch mới (QuyMo_HT = 0, QuyMo_QH > 0): chỉ có trên bản đồ quy hoạch
  planDataList: [],
  wardStatsData: [],

  // Bộ lọc địa bàn: null = xem toàn TP. Huế | "Tên phường" = chỉ lọc riêng phường đó
  selectedWard: null,
  // Danh sách tên + tọa độ tâm 40 phường xã (dùng cho dropdown lọc & bay tới vị trí)
  wardLabelsList: [],

  // Bán kính đệm Buffer & Isochrone Giao thông mặc định (mét)
  globalBufferRadius: 500,
  globalBufferRadiusOverride: null,
  isochroneRadius: 500,

  // Layer Group lưu các đa giác Isochrone giao thông
  isochroneLayerGroup: null,

  // Trạng thái các chế độ tương tác
  isPickMode: false,
  isInspectMode: false,

  // Đo đạc khoảng cách / diện tích
  activeMeasureType: null,
  measurePoints: [],

  // Marker tạm trên bản đồ
  tempMarker: null
};

export const infraLabels = {
  "1-CV": "🌳 Công viên, điểm xanh, vườn hoa",
  "2-BDX": "🅿️ Bãi đỗ xe, trạm sạc xe điện",
  "3-MN": "🧸 Trường Mầm non",
  "4-TH": "🏫 Trường Tiểu học",
  "5-THCS": "📚 Trường THCS",
  "6-YT": "✚ Bệnh viện, Trạm y tế",
  "7-VH": "🎭 Nhà văn hóa, thể thao",
  "8-TM": "🛒 Chợ, Trung tâm thương mại",
  "9-CSD": "🛠️ Quỹ đất tiềm năng (Chưa sử dụng)"
};

// Ranh giới phường xã: nét viền ghi xám vẽ dưới + nét vàng nhạt vẽ trên (đổ bóng rẻ, không dùng CSS filter)
export const WARD_BOUNDARY_SHADOW_STYLE = { color: '#64748b', weight: 4, opacity: 0.55, fill: false, interactive: false };
export const WARD_BOUNDARY_LINE_STYLE = { color: '#fde68a', weight: 1.6, opacity: 0.95, fill: false, interactive: false };
export const WARD_HIGHLIGHT_STYLE = { color: '#fb923c', weight: 3.5, dashArray: '6,6', fillColor: '#fb923c', fillOpacity: 0.15, interactive: false };

// Vùng phủ (buffer) theo loại hạ tầng, dùng chung cho bản đồ hiện trạng và quy hoạch
export const BUFFER_COLORS = {
  "1-CV": "#2ecc71", "2-BDX": "#3498db", "3-MN": "#e67e22", "4-TH": "#e74c3c", "5-THCS": "#9b59b6",
  "6-YT": "#1abc9c", "7-VH": "#f1c40f", "8-TM": "#e91e63", "9-CSD": "#95a5a6"
};
export const BUFFER_KEYS = {
  "1-CV": "b1", "2-BDX": "b2", "3-MN": "b3", "4-TH": "b4", "5-THCS": "b5",
  "6-YT": "b6", "7-VH": "b7", "8-TM": "b8", "9-CSD": "b9"
};
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

export const infraIcons = {
  "1-CV": { symbol: "🌳", border: "#4ade80" },
  "2-BDX": { symbol: "🅿️", border: "#a855f7" },
  "3-MN": { symbol: "🧸", border: "#fb923c" },
  "4-TH": { symbol: "🏫", border: "#facc15" },
  "5-THCS": { symbol: "📚", border: "#eab308" },
  "6-YT": { symbol: '<span style="color:#f87171; font-weight:900;">✚</span>', border: "#f87171" },
  "7-VH": { symbol: "🎭", border: "#ec4899" },
  "8-TM": { symbol: "🛒", border: "#38bdf8" },
  "9-CSD": { symbol: "🛠️", border: "#94a3b8" }
};

export function setUserRole(role) {
  state.currentUserRole = role;
}

export function setRawDataList(data) {
  state.rawDataList = Array.isArray(data) ? data : [];
}

// Dữ liệu bản đồ quy hoạch: công trình có QuyMo_QH (hiện trạng bỏ di dời + quy hoạch mới), diện tích lấy theo QuyMo_QH
export function getPlanScenarioList() {
  const list = [];
  state.rawDataList.forEach(it => {
    if (it.planChange === 'relocate') return;
    list.push({ ...it, size: it.sizeQH ?? it.size, sizeHT: it.sizeHT ?? it.size, scenario: 'QH' });
  });
  state.planDataList.forEach(it => list.push({ ...it, size: it.sizeQH, scenario: 'QH' }));
  return list;
}

export function setWardStatsData(data) {
  state.wardStatsData = Array.isArray(data) ? data : [];
}
