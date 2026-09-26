const constants = {
  GEOJSON_CACHE_TTL: 10 * 60 * 1000,    // Cache GCS 10 phút
  WARD_STATS_CACHE_TTL: 15 * 60 * 1000, // Cache Wards 15 phút
  GCS_URL: "https://storage.googleapis.com/hue-infra-data-us/infrastructure_hue.json",
  GAS_BASE_URL: "https://script.google.com/macros/s/AKfycbzyvYP9WoDizfwb-ZMT374jHbLY02X3HlhxKnmZEYl8UrYrO6SSzSB7eQRH0kaXWguU/exec",

  // Cấu hình thuật toán Isochrone Giao thông (90% Di chuyển + 10% Offset làm mịn)
  ISOCHRONE_CONFIG: {
    REACH_RATIO: 0.9,  // 90% bán kính di chuyển thực tế theo đường giao thông
    OFFSET_RATIO: 0.1  // 10% bán kính đệm làm mịn polygon
  },

  // Danh sách mã nhóm hạ tầng tiêu chuẩn phục vụ đánh giá quy chuẩn
  CODES_TO_CHECK: ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"],

  // ---------------------------------------------------------------------------
  // CẤU TRÚC PHÂN LOẠI THEO QCVN 01:2026/BXD
  // ---------------------------------------------------------------------------
  
  // A. CÔNG TRÌNH HẠ TẦNG CẤP ĐÔ THỊ
  urbanInfraConfig: {
    "THPT": { label: "Trường THPT", minSize: 5000, radius: 2000, quota: 0.60, nhom: "Cấp đô thị" },
    "YT_DT": { label: "Y tế cấp khu vực (đô thị)", minSize: 1000, radius: 2000, quota: 0.40, nhom: "Cấp đô thị" },
    "VH_DT": { label: "Văn hóa - Thể thao cấp khu vực (đô thị)", minSize: 1000, radius: 2000, quota: 1.60, nhom: "Cấp đô thị" },
    "TM_DT": { label: "Chợ - TMDV cấp khu vực (đô thị)", minSize: 1500, radius: 2000, quota: 0.40, nhom: "Cấp đô thị" },
    "CV_DT": { label: "Công viên cấp khu vực (đô thị)", minSize: 3000, radius: 2000, quota: 5.00, nhom: "Cấp đô thị" },
    "BDX_DT": { label: "Bãi đỗ xe khu vực (đô thị)", minSize: 1000, radius: 2000, quota: 1.50, nhom: "Cấp đô thị" }
  },

  // B. CÔNG TRÌNH HẠ TẦNG CẤP ĐƠN VỊ Ở
  unitInfraConfig: {
    "3-MN":   { label: "Trường Mầm non", minSize: 800, radius: 500, quota: 0.60, nhom: "Cấp DVƠ" },
    "4-TH":   { label: "Trường Tiểu học", minSize: 2000, radius: 1000, quota: 0.65, nhom: "Cấp DVƠ" },
    "5-THCS": { label: "Trường THCS", minSize: 2500, radius: 1000, quota: 0.55, nhom: "Cấp DVƠ" },
    // Nhóm Dịch vụ công cộng đơn vị ở (Tổng hợp chỉ tiêu >= 2.0 m2/người)
    "YT_DV":  { label: "Y tế đơn vị ở", minSize: 500, radius: 1000, quota: 0, nhom: "Cấp DVƠ", parentGroup: "DVCC", minSingleSize: 500 },
    "VH_DV":  { label: "Văn hóa đơn vị ở", minSize: 500, radius: 1000, quota: 0, nhom: "Cấp DVƠ", parentGroup: "DVCC", minSingleSize: 1000 },
    "TM_DV":  { label: "Chợ - TMDV đơn vị ở", minSize: 1000, radius: 1000, quota: 0, nhom: "Cấp DVƠ", parentGroup: "DVCC", minSingleSize: 2000 },
    "DVCC_TOTAL": { label: "Dịch vụ công cộng đơn vị ở (Tổng hợp)", minSize: 0, radius: 1000, quota: 2.00, nhom: "Cấp DVƠ" },
    
    "CV_DV":  { label: "Cây xanh đơn vị ở", minSize: 500, radius: 500, quota: 2.00, nhom: "Cấp DVƠ" },
    "BDX_DV": { label: "Bãi đỗ xe đơn vị ở", minSize: 500, radius: 500, quota: 2.50, nhom: "Cấp DVƠ" }
  },

  // Giữ lại tương thích ngược cho hệ thống cũ
  quotaConfig: {
    "1-CV": 7.00, "2-BDX": 2.50, "3-MN": 0.60, "4-TH": 0.65,
    "5-THCS": 0.55, "6-YT": 0.20, "7-VH": 1.00, "8-TM": 0.00
  },

  infraConfig: {
    "1-CV":   { label: "Cây xanh, công viên", minSize: 300, radius: 500 },
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
    "THCS": "5-THCS", "YT": "6-YT", "VH": "7-VH", "TM": "8-TM", "CSD": "9-CSD",
    "1": "1-CV", "2": "2-BDX", "3": "3-MN", "4": "4-TH",
    "5": "5-THCS", "6": "6-YT", "7": "7-VH", "8": "8-TM", "9": "9-CSD",
    "THPT": "4-TH",
    "CV_DT": "1-CV", "CV_DV": "1-CV",
    "BDX_DT": "2-BDX", "BDX_DV": "2-BDX",
    "YT_DT": "6-YT", "YT_DV": "6-YT",
    "VH_DT": "7-VH", "VH_DV": "7-VH",
    "TM_DT": "8-TM", "TM_DV": "8-TM"
  },

  /** Chuẩn hóa mã loại công trình từ id / type */
  resolveTypeCode: function(item) {
    const codes = this.CODES_TO_CHECK || [];
    if (item && item.type && codes.includes(item.type)) return item.type;
    const prefix = String((item && item.id) || '').split('-')[0];
    if (this.codeMap[prefix]) return this.codeMap[prefix];
    const stripped = prefix.replace(/_DT$/i, '').replace(/_DV$/i, '');
    if (this.codeMap[stripped]) return this.codeMap[stripped];
    return item && item.type ? item.type : null;
  },

  /** Phân cấp đô thị vs đơn vị ở — thống nhất mọi chỗ */
  isUrbanLevel: function(item) {
    const prefix = String((item && item.id) || '').split('-')[0].toUpperCase();
    if (prefix === 'THPT' || /_DT$/i.test(prefix)) return true;
    if (/_DV$/i.test(prefix)) return false;
    const nhom = this.cleanNhomStr(item && item.nhomHaTang);
    return nhom === 'Cap Do Thi';
  },

  cleanWardStr: function(str) {
    if (!str) return "";
    return String(str)
      .replace(/^Phường\s+/i, '').replace(/^Xã\s+/i, '')
      .replace(/^phường\s+/i, '').replace(/^xã\s+/i, '')
      .trim().toLowerCase();
  },

  // Hàm chuẩn hóa chuỗi nhóm hạ tầng luôn quy về "Cap DVO" hoặc "Cap Do Thi"
  cleanNhomStr: function(str) {
    if (!str) return "Cap DVO";
    const s = String(str)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d").replace(/Đ/g, "D")
      .replace(/\s+/g, " ")
      .trim();

    if (s.includes("do thi") || s.includes("urban")) {
      return "Cap Do Thi";
    }
    return "Cap DVO";
  }
};

module.exports = constants;
