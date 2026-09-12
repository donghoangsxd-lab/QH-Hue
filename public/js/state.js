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
  wardStatsData: [],

  // Bán kính đệm Buffer & Isochrone Giao thông mặc định (mét)
  globalBufferRadius: 500,
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

export function setWardStatsData(data) {
  state.wardStatsData = Array.isArray(data) ? data : [];
}
