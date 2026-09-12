export const geeApiBackend = "/api/gee";
export const ADMIN_EMAILS = ["donghoangsxd@gmail.com", "admin.sxd@hue.gov.vn"];

export const infraLabels = {
  "1-CV": "🌳 Công viên, điểm xanh, vườn hoa",
  "2-BDX": "🅿️ Bãi đỗ xe, trạm sạc xe điện",
  "3-MN": "🧸 Trường Mầm non",
  "4-TH": "🏫 Trường Tiểu học",
  "5-THCS": "📚 Trường THCS",
  "6-YT": "✚ Bệnh viện, Trạm y tế",
  "7-VH": "🎭 Nhà văn hóa, thể thao",
  "8-TM": "🛒 Chợ, Trung tâm thương mại"
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

// BỔ SUNG 1: Bảng định mức quy chuẩn diện tích / người (phục vụ Popup tính toán Phường/Xã)
export const quotaConfig = {
  "1-CV": 7.00,
  "2-BDX": 2.50,
  "3-MN": 0.60,
  "4-TH": 0.65,
  "5-THCS": 0.55,
  "6-YT": 0.20,
  "7-VH": 1.00,
  "8-TM": 0.00
};

// BỔ SUNG 2: Cấu hình mặc định Isochrone Giao thông
export const defaultIsoConfig = {
  defaultRadius: 500,
  minRadius: 100,
  maxRadius: 3000,
  step: 100
};
