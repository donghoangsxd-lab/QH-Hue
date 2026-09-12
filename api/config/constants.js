module.exports = {
  GEOJSON_CACHE_TTL: 10 * 60 * 1000,    // Cache GCS 10 phút
  WARD_STATS_CACHE_TTL: 15 * 60 * 1000, // Cache Wards 15 phút
  GCS_URL: "https://storage.googleapis.com/hue-infra-data-us/infrastructure_hue.json",
  GAS_BASE_URL: "https://script.google.com/macros/s/AKfycbzyvYP9WoDizfwb-ZMT374jHbLY02X3HlhxKnmZEYl8UrYrO6SSzSB7eQRH0kaXWguU/exec",

  // Cấu hình thuật toán Isochrone Giao thông (90% Di chuyển + 10% Offset làm mịn)
  ISOCHRONE_CONFIG: {
    REACH_RATIO: 0.9,  // 90% bán kính di chuyển thực tế theo đường giao thông
    OFFSET_RATIO: 0.1, // 10% bán kính đệm làm mịn polygon
    SAMPLE_ANGLES: 12  // 12 hướng bức xạ tính toán polygon
  },

  // Danh sách mã nhóm hạ tầng tiêu chuẩn phục vụ đánh giá quy chuẩn
  CODES_TO_CHECK: ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"],
  
  quotaConfig: {
    "1-CV": 7.00, "2-BDX": 2.50, "3-MN": 0.60, "4-TH": 0.65,
    "5-THCS": 0.55, "6-YT": 0.20, "7-VH": 1.00, "8-TM": 0.00
  },
  
  infraConfig: {
    "1-CV":   { label: "Công viên, điểm xanh, vườn hoa", minSize: 300, radius: 500 },
    "2-BDX":  { label: "Bãi đỗ xe, trạm sạc xe điện", minSize: 200, radius: 500 },
    "3-MN":   { label: "Trường Mầm non", minSize: 800, radius: 500 },
    "4-TH":   { label: "Trường Tiểu học", minSize: 2000, radius: 1000 },
    "5-THCS": { label: "Trường THCS", minSize: 2500, radius: 1000 },
    "6-YT":   { label: "Bệnh viện, Trạm y tế", minSize: 1000, radius: 1000 },
    "7-VH":   { label: "Nhà văn hóa, thể thao", minSize: 500, radius: 500 },
    "8-TM":   { label: "Chợ, Trung tâm thương mại", minSize: 1500, radius: 500 }
  },

  codeMap: { 
    "CV": "1-CV", "BDX": "2-BDX", "MN": "3-MN", "TH": "4-TH", 
    "THCS": "5-THCS", "YT": "6-YT", "VH": "7-VH", "TM": "8-TM", "CSD": "9-CSD" 
  },

  cleanWardStr: function(str) {
    if (!str) return "";
    return String(str)
      .replace(/^Phường\s+/i, '').replace(/^Xã\s+/i, '')
      .replace(/^phường\s+/i, '').replace(/^xã\s+/i, '')
      .trim().toLowerCase();
  }
};
