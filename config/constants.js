// A. CÔNG TRÌNH HẠ TẦNG CẤP ĐÔ THỊ
const urbanInfraConfig = {
  "THPT": { label: "Trường THPT", minSize: 5000, radius: 2000, quota: 0.60, nhom: "Cấp đô thị" },
  "YT_DT": { label: "Y tế cấp khu vực", minSize: 1000, radius: 2000, quota: 0.40, nhom: "Cấp đô thị" },
  "VH_DT": { label: "Văn hóa - Thể thao cấp khu vực", minSize: 1000, radius: 2000, quota: 1.60, nhom: "Cấp đô thị" },
  "TM_DT": { label: "Chợ - TMDV cấp khu vực", minSize: 1500, radius: 2000, quota: 0.40, nhom: "Cấp đô thị" },
  "CV_DT": { label: "Cây xanh đô thị (công viên khu vực, công viên đô thị)", minSize: 10000, radius: 800, quota: 5.00, nhom: "Cấp đô thị" },
  "BDX_DT": { label: "Bãi đỗ xe khu vực", minSize: 1000, radius: 2000, quota: 1.50, nhom: "Cấp đô thị" }
};

// B. CÔNG TRÌNH HẠ TẦNG CẤP ĐƠN VỊ Ở
const unitInfraConfig = {
  "3-MN":   { label: "Trường Mầm non", minSize: 800, radius: 1000, quota: 0.60, nhom: "Cấp DVƠ" },
  "4-TH":   { label: "Trường Tiểu học", minSize: 2000, radius: 1000, quota: 0.65, nhom: "Cấp DVƠ" },
  "5-THCS": { label: "Trường THCS", minSize: 2500, radius: 1000, quota: 0.55, nhom: "Cấp DVƠ" },
  // Dịch vụ công cộng khác đơn vị ở (Bảng 6: điểm dịch vụ công, trạm y tế, nhà văn hóa, nhà sinh hoạt cộng đồng, chợ — chung 0,20 m²/người)
  "YT_DV":  { label: "Y tế đơn vị ở", minSize: 500, radius: 1000, quota: 0, nhom: "Cấp DVƠ", parentGroup: "DVCC", minSingleSize: 500 },
  "VH_DV":  { label: "Văn hóa đơn vị ở", minSize: 500, radius: 1000, quota: 0, nhom: "Cấp DVƠ", parentGroup: "DVCC", minSingleSize: 1000 },
  "TM_DV":  { label: "Chợ - TMDV đơn vị ở", minSize: 1000, radius: 1000, quota: 0, nhom: "Cấp DVƠ", parentGroup: "DVCC", minSingleSize: 2000 },
  "DVCC_TOTAL": { label: "Dịch vụ công cộng khác đơn vị ở (y tế, văn hóa, chợ)", minSize: 0, radius: 1000, quota: 0.20, nhom: "Cấp DVƠ" },
  // Tổng đất DVCC đơn vị ở gồm cả trường học (Bảng 6 đô thị / Bảng 28 nông thôn: ≥ 2,0 m²/người)
  "DVCC_ALL": { label: "Tổng đất dịch vụ công cộng đơn vị ở (gồm trường học)", minSize: 0, radius: 0, quota: 2.00, nhom: "Cấp DVƠ",
    sumOf: ["3-MN", "4-TH", "5-THCS", "YT_DV", "VH_DV", "TM_DV"] },

  "CV_DV":  { label: "Vườn hoa (cây xanh đơn vị ở)", minSize: 500, radius: 400, quota: 2.00, nhom: "Cấp DVƠ" },
  "BDX_DV": { label: "Bãi đỗ xe đơn vị ở", minSize: 500, radius: 500, quota: 2.50, nhom: "Cấp DVƠ" }
};

// C. HỒ SƠ CHỈ TIÊU THEO LOẠI ĐỊA BÀN
// Phường = bộ đô thị (Bảng 5, 6, 18). Xã = bộ nông thôn (Bảng 28, 29, 30) — QCVN không tách xã đồng bằng / miền núi.
// Xã định hướng đô thị: bộ nông thôn, riêng cây xanh khu vực theo đô thị miền núi 3,5 m²/người (Mục 2.4.3).
const PLAIN_COMMUNES = ["Chân Mây - Lăng Cô", "Đan Điền", "Hưng Lộc", "Lộc An", "Phú Hồ", "Phú Lộc", "Phú Vang", "Phú Vinh", "Quảng Điền", "Vinh Lộc"];
const MOUNTAIN_COMMUNES = ["A Lưới 1", "A Lưới 2", "A Lưới 3", "A Lưới 4", "A Lưới 5", "Bình Điền", "Khe Tre", "Long Quảng", "Nam Đông"];
const URBAN_ORIENTED_COMMUNES = ["Khe Tre", "A Lưới 2"];

// null = QCVN không quy định cho loại địa bàn này → không tính vào quy mô
const RURAL_QUOTA = { YT_DT: 0.20, VH_DT: 1.00, TM_DT: 0.20, CV_DT: null, BDX_DT: null, BDX_DV: null, DVCC_TOTAL: null };
const PROFILE_QUOTA = {
  DT: {},
  XA: RURAL_QUOTA,
  XA_DT: { ...RURAL_QUOTA, CV_DT: 3.50 }
};
const PROFILES = Object.keys(PROFILE_QUOTA);

// Bán kính DVCC đơn vị ở tại nông thôn ≤ 2 km (Mục 4.6.2.2)
const RURAL_UNIT_RADIUS = 2000;
const RURAL_UNIT_RADIUS_CODES = ["3-MN", "4-TH", "5-THCS", "7-YT", "8-VH", "9-TM"];

// Quy tắc đếm cơ sở: THPT khi dân số > 20.000 (Bảng 5, 29); 1 trạm y tế, 1 chợ mỗi xã (Bảng 30)
const THPT_POP_THRESHOLD = 20000;
const COUNT_RULES = {
  DT: { THPT: { minPop: THPT_POP_THRESHOLD } },
  XA: { THPT: { minPop: THPT_POP_THRESHOLD }, YT_DV: { perWard: 1 }, TM_DV: { perWard: 1 } },
  XA_DT: { THPT: { minPop: THPT_POP_THRESHOLD }, YT_DV: { perWard: 1 }, TM_DV: { perWard: 1 } }
};

// Quy mô tối thiểu 1 công trình theo tiền tố tên (so sau khi bỏ dấu, viết hoa) — chỉ cảnh báo, diện tích vẫn cộng vào chỉ tiêu
const MIN_SIZE_RULES = [
  { profiles: ["XA", "XA_DT"], code: "7-YT", prefixes: ["Trạm y tế"], min: 500, ref: "Bảng 30" },
  { profiles: ["XA", "XA_DT"], code: "8-VH", prefixes: ["Nhà văn hóa"], min: 1000, ref: "Bảng 30" },
  { profiles: ["XA", "XA_DT"], code: "8-VH", prefixes: ["Phòng truyền thống", "Thư viện"], min: 200, ref: "Bảng 30" },
  { profiles: ["XA", "XA_DT"], code: "8-VH", prefixes: ["Cụm công trình văn hóa", "Cụm văn hóa"], min: 5000, ref: "Bảng 30" },
  { profiles: ["XA", "XA_DT"], code: "9-TM", prefixes: ["Chợ"], excludePrefixes: ["Chợ đầu mối"], min: 1500, ref: "Bảng 30" },
  { profiles: ["XA", "XA_DT"], code: "9-TM", prefixes: ["Cửa hàng"], min: 300, ref: "Bảng 30" }
];

// Mỗi đơn vị ở đô thị phát triển mới: ≥ 1 công viên, vườn hoa ≥ 5.000 m² hoặc 2 công viên, vườn hoa ≥ 2.500 m² (Mục 2.2.3.2)
const UNIT_PARK_RULE = { profiles: ["DT"], large: 5000, medium: 2500 };

// Hạng cây xanh công cộng theo diện tích (m²) → bán kính phục vụ và nhóm chỉ tiêu.
// Công viên khu vực + công viên đô thị thống kê vào cây xanh đô thị (CV_DT, 5 m²/người); vườn hoa (~0,3 ha, nhỏ hơn vẫn nhận) vào CV_DV.
// Khớp PARK_TIERS trong public/js/state.js
const PARK_TIERS = [
  { key: "city", label: "Công viên đô thị", minArea: 50000, radius: 2000, urban: true },
  { key: "area", label: "Công viên khu vực", minArea: 10000, radius: 800, urban: true },
  { key: "garden", label: "Vườn hoa", minArea: 0, radius: 400, urban: false }
];

/** Chưa rõ diện tích (trống / 0) → theo cột Nhom_HaTang: cấp đô thị = công viên khu vực, còn lại = vườn hoa */
function parkTierOf(size, urbanNhom) {
  const s = Number(size) || 0;
  if (s > 0) return PARK_TIERS.find(t => s >= t.minArea);
  return urbanNhom ? PARK_TIERS[1] : PARK_TIERS[2];
}

// D. MẠNG LƯỚI HẠ TẦNG KHÁC — không có chỉ tiêu m²/người theo phường, không tính vào quy mô / độ phủ / heatmap của 8 nhóm
const NETWORK_CODES = ["13-BUS", "10-PCCC", "11-NT", "14-NOXH"];
const networkConfig = {
  // Mục 2.8.3.3: đi bộ đến bến ≤ 500 m; khu trung tâm: bến xe buýt cách nhau ≤ 600 m.
  // gapIgnore: bỏ qua trạm cách < 100 m khi tìm trạm kế cận (cặp trạm 2 bên đường)
  "13-BUS": { label: "Trạm dừng xe buýt", radius: 500, gapMax: 600, gapIgnore: 100, noArea: true },
  // Mục 2.5.13.1: khu vực trung tâm ≤ 3 km (áp cho phường), khu vực khác ≤ 5 km (xã)
  "10-PCCC": { label: "Trụ sở cảnh sát PCCC", radius: { DT: 3000, XA: 5000, XA_DT: 5000 }, noArea: true },
  // Mục 2.12.1.1: 1 nhà tang lễ / ≤ 250.000 người; 2.12.2.1: nghĩa trang tập trung ≥ 0,04 ha / 1.000 người = 0,4 m²/người
  "11-NT": { label: "Nhà tang lễ, nghĩa trang", funeralPopPer: 250000, cemeteryQuota: 0.4 },
  // Nhà ở xã hội (tab 14-NOXH): chỉ thể hiện vị trí, diện tích; không có bán kính phục vụ
  "14-NOXH": { label: "Nhà ở xã hội", radius: 0 }
};
// Phân loại nhóm 11-NT theo tên; safety = khoảng cách an toàn môi trường tới nhà ở (Bảng 23), 0 = không quy định
const NT_KINDS = {
  funeral: { label: "Nhà tang lễ", safety: 0 },
  crematorium: { label: "Cơ sở hỏa táng", safety: 500 },
  cemetery_cat: { label: "Nghĩa trang cát táng", safety: 100 },
  cemetery_once: { label: "Nghĩa trang chôn cất một lần", safety: 500 },
  cemetery_hung: { label: "Nghĩa trang hung táng", safety: 1000 }
};

const foldName = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .replace(/\s+/g, ' ').trim().toUpperCase();

const bareWardName = (name) => foldName(name).replace(/^(PHUONG|XA)\s+/, '');
const URBAN_ORIENTED_SET = new Set(URBAN_ORIENTED_COMMUNES.map(bareWardName));
const MOUNTAIN_SET = new Set(MOUNTAIN_COMMUNES.map(bareWardName));
const COMMUNE_SET = new Set([...PLAIN_COMMUNES, ...MOUNTAIN_COMMUNES].map(bareWardName));

/** Loại công trình nhóm 11-NT theo tên (khóa NT_KINDS); nghĩa trang không ghi rõ hình thức → hung táng (khoảng cách lớn nhất) */
function ntKind(item) {
  const name = foldName(item && item.name);
  if (name.includes('TANG LE')) return 'funeral';
  if (name.includes('HOA TANG') || name.includes('HOA THAN')) return 'crematorium';
  if (name.includes('CAT TANG')) return 'cemetery_cat';
  if (/CHON (CAT )?(MOT|1) LAN/.test(name)) return 'cemetery_once';
  return 'cemetery_hung';
}

/** 'DT' | 'XA' | 'XA_DT' theo tên phường/xã (có hoặc không có tiền tố "Phường"/"Xã") */
function wardProfile(name) {
  const bare = bareWardName(name);
  if (URBAN_ORIENTED_SET.has(bare)) return 'XA_DT';
  if (COMMUNE_SET.has(bare)) return 'XA';
  return 'DT';
}

function wardProfileLabel(name) {
  const profile = wardProfile(name);
  if (profile === 'DT') return 'Phường – chỉ tiêu đô thị';
  const terrain = MOUNTAIN_SET.has(bareWardName(name)) ? 'miền núi' : 'đồng bằng';
  return profile === 'XA_DT'
    ? `Xã ${terrain} định hướng đô thị – chỉ tiêu nông thôn, cây xanh khu vực 3,5 m²/người`
    : `Xã ${terrain} – chỉ tiêu nông thôn`;
}

/** Chỉ tiêu m²/người của 1 nhóm theo hồ sơ; null = không quy định */
function baseQuota(key, profile = 'DT') {
  const override = PROFILE_QUOTA[profile] || {};
  if (Object.prototype.hasOwnProperty.call(override, key)) return override[key];
  const cfg = urbanInfraConfig[key] || unitInfraConfig[key];
  return cfg ? (cfg.quota || 0) : 0;
}

/** Nhóm công trình con có quy tắc quy mô tối thiểu theo tên → { min, ref } hoặc null */
function minSizeRuleFor(item, code, profile) {
  const name = foldName(item && item.name);
  if (!name) return null;
  const rule = MIN_SIZE_RULES.find(r => r.code === code && r.profiles.includes(profile)
    && r.prefixes.some(p => name.startsWith(foldName(p)))
    && !(r.excludePrefixes || []).some(p => name.startsWith(foldName(p))));
  return rule ? { min: rule.min, ref: rule.ref } : null;
}

// Mỗi mã hạ tầng = tổng các nhóm chỉ tiêu cấp đô thị + cấp đơn vị ở (THPT tính riêng, không thuộc 4-TH)
const CODE_LEVEL_KEYS = {
  "1-CV": ["CV_DT", "CV_DV"],
  "2-BDX": ["BDX_DT", "BDX_DV"],
  "3-MN": ["3-MN"],
  "4-TH": ["4-TH"],
  "5-THCS": ["5-THCS"],
  "7-YT": ["YT_DT", "YT_DV"],
  "8-VH": ["VH_DT", "VH_DV"],
  "9-TM": ["TM_DT", "TM_DV"]
};

// Chỉ tiêu DVCC khác đơn vị ở chia cho Y tế / Văn hóa / Chợ theo tỷ lệ diện tích tối thiểu 1 cơ sở (500 : 1000 : 2000) — chỉ phục vụ quy mô theo mã
function levelQuota(key, profile = 'DT') {
  const cfg = unitInfraConfig[key];
  if (!cfg || cfg.parentGroup !== 'DVCC') return baseQuota(key, profile) || 0;
  const parts = Object.values(unitInfraConfig).filter(c => c.parentGroup === 'DVCC');
  const totalWeight = parts.reduce((s, c) => s + (c.minSingleSize || 0), 0);
  return totalWeight > 0 ? (baseQuota('DVCC_TOTAL', profile) || 0) * (cfg.minSingleSize || 0) / totalWeight : 0;
}

// Chỉ tiêu tổng (m²/người) của từng mã theo hồ sơ; quotaConfig = hồ sơ đô thị (giữ tương thích)
const quotaByProfile = {};
PROFILES.forEach(profile => {
  quotaByProfile[profile] = {};
  Object.keys(CODE_LEVEL_KEYS).forEach(code => {
    quotaByProfile[profile][code] = Number(CODE_LEVEL_KEYS[code].reduce((s, k) => s + levelQuota(k, profile), 0).toFixed(4));
  });
});
const quotaConfig = quotaByProfile.DT;

const PROD_ORIGIN = "https://web-hatang-hue-4.vercel.app";

const constants = {
  WARD_STATS_CACHE_TTL: 15 * 60 * 1000, // Cache Wards 15 phút
  WARD_GEOMETRY_CACHE_TTL: 6 * 60 * 60 * 1000, // Ranh giới phường gần như không đổi
  GCS_BUCKET: "hue-infra-data-us",
  GCS_PUBLIC_BASE: "https://storage.googleapis.com/hue-infra-data-us/",
  GCS_URL: "https://storage.googleapis.com/hue-infra-data-us/infrastructure_hue.json",
  // Ranh lô công trình không thuộc đồ án (luồng phường). Mỗi đồ án một thư mục projects/<slug>/ với 4 file lớp.
  CAD_GCS_URL: "https://storage.googleapis.com/hue-infra-data-us/cad_parcels.json",
  // Danh mục đồ án + ranh tổng: projects/index.json. Client nhận URL này từ API, không gắn cứng.
  PROJECTS_GCS_BASE: "https://storage.googleapis.com/hue-infra-data-us/projects/",
  // Hồ sơ file chờ duyệt do người dùng chưa đăng nhập gửi (Apps Script ghi: index.json + <id>.<dxf|kml|geojson>)
  PENDING_CAD_BASE: "https://storage.googleapis.com/hue-infra-data-us/pending/cad/",
  // Mạng lưới thoát nước, khe tụ thủy (TopoJSON, đường vẽ xuôi dòng; scripts/push-thoatnuoc.js đẩy lên)
  DRAINAGE_GCS_URL: "https://storage.googleapis.com/hue-infra-data-us/drainage/thoatnuoc.topojson",
  // Ranh lưu vực sông + tiểu lưu vực (TopoJSON cung dùng chung; scripts/push-luuvuc.js đẩy lên)
  BASINS_GCS_URL: "https://storage.googleapis.com/hue-infra-data-us/drainage/luuvuc.topojson",
  // Mũi tên hướng thoát nước mặt chia theo ô z12: <z_x_y>.json + index.json (scripts/push-huongthoat.js đẩy lên)
  DRAIN_ARROWS_GCS_BASE: "https://storage.googleapis.com/hue-infra-data-us/drainage/huongthoat/",

  // Cấu hình trên Vercel (Settings → Environment Variables), không ghi vào mã nguồn
  GAS_BASE_URL: process.env.GAS_BASE_URL || "",
  GAS_SECRET: process.env.GAS_SECRET || "",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "409688791128-s7b4uohia2a9n3u27rl0gmkdupiig554.apps.googleusercontent.com",
  ADMIN_EMAILS: ["donghoangsxd@gmail.com"],
  ALLOWED_ORIGINS: [
    PROD_ORIGIN,
    "http://localhost:5500", "http://127.0.0.1:5500",
    "http://localhost:5501", "http://127.0.0.1:5501",
    "http://localhost:3000", "http://127.0.0.1:3000",
    "http://localhost:8766", "http://127.0.0.1:8766",
    ...String(process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean)
  ],

  // Vùng hợp lệ của điểm đề xuất (bao ngoài TP. Huế)
  HUE_BOUNDS: { minLat: 15.9, maxLat: 16.9, minLng: 106.9, maxLng: 108.3 },
  RADIUS_LIMITS: { min: 50, max: 5000 },
  MAX_HEATMAP_POINTS: 20000,

  // Dân số quy hoạch = dân số hiện trạng × hệ số tăng trưởng; 1 đơn vị ở tối đa 20.000 người (Mục 2.2.2.2) → số đơn vị ở làm tròn lên
  POP_GROWTH: 1.2,
  POP_PER_UNIT: 20000,

  // Diện tích chính thức 40 phường/xã (km², tổng 4.947,1 km²) — ưu tiên hơn thuộc tính dienTich của polygon (vài phường nhập sai).
  // Tên khớp thuộc tính tenXa của polygon; phường không có trong bảng thì lấy dienTich của polygon.
  WARD_AREA_KM2: {
    "Phường Thuận An": 36.48, "Phường Hóa Châu": 34.6, "Phường Mỹ Thượng": 28.83, "Phường Vỹ Dạ": 8.93,
    "Phường Thuận Hóa": 7.57, "Phường An Cựu": 16.71, "Phường Thủy Xuân": 37.03, "Phường Kim Long": 90.14,
    "Phường Hương An": 19.43, "Phường Phú Xuân": 10.38, "Phường Hương Trà": 83.28, "Phường Kim Trà": 42.8,
    "Phường Thanh Thủy": 48.92, "Phường Hương Thủy": 33.93, "Phường Phú Bài": 344.63, "Phường Phong Điền": 592.48,
    "Phường Phong Thái": 187.02, "Phường Phong Dinh": 87.17, "Phường Phong Phú": 60.85, "Phường Phong Quảng": 41.7,
    "Xã Đan Điền": 82.62, "Xã Quảng Điền": 45.93, "Xã Phú Vinh": 57.95, "Xã Phú Hồ": 57.72,
    "Xã Phú Vang": 86.19, "Xã Vinh Lộc": 66.53, "Xã Hưng Lộc": 95.62, "Xã Lộc An": 177.58,
    "Xã Phú Lộc": 119.3, "Xã Chân Mây - Lăng Cô": 261.38, "Xã Long Quảng": 215.85, "Xã Nam Đông": 175.95,
    "Xã Khe Tre": 256.02, "Xã Bình Điền": 266.5, "Xã A Lưới 1": 198.59, "Xã A Lưới 2": 97.62,
    "Xã A Lưới 3": 154.23, "Xã A Lưới 4": 233.65, "Xã A Lưới 5": 464.4, "Phường Dương Nỗ": 20.63
  },

  // Cấu hình thuật toán Isochrone Giao thông (90% Di chuyển + 10% Offset làm mịn)
  ISOCHRONE_CONFIG: {
    REACH_RATIO: 0.9,  // 90% bán kính di chuyển thực tế theo đường giao thông
    OFFSET_RATIO: 0.1  // 10% bán kính đệm làm mịn polygon
  },

  // Danh sách mã nhóm hạ tầng tiêu chuẩn phục vụ đánh giá quy chuẩn
  CODES_TO_CHECK: ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "7-YT", "8-VH", "9-TM"],
  NETWORK_CODES,
  networkConfig,
  NT_KINDS,
  ntKind,
  isNetworkCode: (code) => NETWORK_CODES.includes(code),

  // ---------------------------------------------------------------------------
  // CẤU TRÚC PHÂN LOẠI THEO QCVN 01:2026/BXD
  // ---------------------------------------------------------------------------
  urbanInfraConfig,
  unitInfraConfig,
  CODE_LEVEL_KEYS,

  // Chỉ tiêu tổng (m²/người) của từng mã, suy ra từ 2 bảng trên — dùng chung cho quy mô, gợi ý CSD, điểm chờ duyệt
  quotaConfig,
  quotaByProfile,

  // Hồ sơ chỉ tiêu theo loại địa bàn (phường / xã / xã định hướng đô thị)
  PROFILE_QUOTA,
  COUNT_RULES,
  UNIT_PARK_RULE,
  PARK_TIERS,
  wardProfile,
  wardProfileLabel,
  baseQuota,
  minSizeRuleFor,
  quotaFor: (code, profile = 'DT') => (quotaByProfile[profile] || quotaByProfile.DT)[code] || 0,

  // minSize: ngưỡng lọc gợi ý chuyển đổi quỹ đất (nội bộ, không phải chỉ tiêu QCVN)
  infraConfig: {
    // Công viên đơn vị ở: QCVN chỉ quy định bán kính nhóm nhà ở ≤ 400 m (Mục 2.2.3.3)
    "1-CV":   { label: "Cây xanh, công viên", minSize: 300, radius: 400 },
    "2-BDX":  { label: "Bãi đỗ xe, trạm sạc xe điện", minSize: 200, radius: 500 },
    "3-MN":   { label: "Trường Mầm non", minSize: 800, radius: 1000 },
    "4-TH":   { label: "Trường Tiểu học", minSize: 2000, radius: 1000 },
    "5-THCS": { label: "Trường THCS", minSize: 2500, radius: 1000 },
    "7-YT":   { label: "Bệnh viện, Trạm y tế", minSize: 1000, radius: 1000 },
    "8-VH":   { label: "Nhà văn hóa, thể thao", minSize: 500, radius: 1000 },
    "9-TM":   { label: "Chợ, Trung tâm thương mại", minSize: 1500, radius: 1000 }
  },

  /** Bán kính mặc định công trình cấp đơn vị ở theo mã và hồ sơ phường/xã */
  unitRadius: function(code, profile = 'DT') {
    if (profile !== 'DT' && RURAL_UNIT_RADIUS_CODES.includes(code)) return RURAL_UNIT_RADIUS;
    return (this.infraConfig[code] && this.infraConfig[code].radius) || 500;
  },

  codeMap: {
    "CV": "1-CV", "BDX": "2-BDX", "MN": "3-MN", "TH": "4-TH",
    "THCS": "5-THCS", "YT": "7-YT", "VH": "8-VH", "TM": "9-TM",
    "PCCC": "10-PCCC", "NT": "11-NT", "CSD": "12-CSD", "BUS": "13-BUS", "NOXH": "14-NOXH",
    // THPT (tab 6-THPT) tính chung mã 4-TH; isThptItem tách chỉ tiêu và độ phủ riêng
    "THPT": "4-TH",
    "1": "1-CV", "2": "2-BDX", "3": "3-MN", "4": "4-TH", "5": "5-THCS",
    "6": "4-TH", "7": "7-YT", "8": "8-VH", "9": "9-TM",
    "10": "10-PCCC", "11": "11-NT", "12": "12-CSD", "13": "13-BUS", "14": "14-NOXH",
    "CV_DT": "1-CV", "CV_DV": "1-CV",
    "BDX_DT": "2-BDX", "BDX_DV": "2-BDX",
    "YT_DT": "7-YT", "YT_DV": "7-YT",
    "VH_DT": "8-VH", "VH_DV": "8-VH",
    "TM_DT": "9-TM", "TM_DV": "9-TM"
  },

  isApprovedStatus: function(status) {
    return status === true || String(status).trim().toUpperCase() === 'TRUE' || String(status).trim() === '1';
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

  /** Trường THPT: nhóm chỉ tiêu riêng (cấp đô thị), không tính vào quy mô / độ phủ Tiểu học */
  isThptItem: function(item) {
    if (item && item.type === '6-THPT') return true;
    const prefix = String((item && item.id) || '').split('-')[0].toUpperCase();
    if (prefix === 'THPT') return true;
    // Dòng cũ còn nằm ở tab Tiểu học, nhận theo tên
    if (this.resolveTypeCode(item) !== '4-TH') return false;
    const name = String((item && item.name) || '')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/Đ/g, 'D');
    return name.includes('THPT') || name.includes('TRUNG HOC PHO THONG');
  },

  /** Cấp theo mã ID / cột Nhom_HaTang */
  nhomIsUrban: function(item) {
    const prefix = String((item && item.id) || '').split('-')[0].toUpperCase();
    if (prefix === 'THPT' || /_DT$/i.test(prefix)) return true;
    if (/_DV$/i.test(prefix)) return false;
    const nhom = this.cleanNhomStr(item && item.nhomHaTang);
    return nhom === 'Cap Do Thi';
  },

  /** Hạng cây xanh (PARK_TIERS) theo diện tích item.size — kịch bản quy hoạch truyền size = QuyMo_QH */
  parkTier: function(item) {
    return parkTierOf(item && item.size, this.nhomIsUrban(item));
  },

  /** Phân cấp đô thị vs đơn vị ở — thống nhất mọi chỗ; cây xanh xét theo diện tích */
  isUrbanLevel: function(item) {
    if (this.resolveTypeCode(item) === '1-CV') return this.parkTier(item).urban;
    return this.nhomIsUrban(item);
  },

  /** Bán kính vùng phục vụ theo quy chuẩn: theo cấp, loại công trình và hồ sơ phường/xã chứa công trình */
  standardRadius: function(item, profile = 'DT') {
    if (this.isThptItem(item)) return urbanInfraConfig.THPT.radius;
    const code = this.resolveTypeCode(item);
    if (code === '1-CV') return this.parkTier(item).radius;
    if (NETWORK_CODES.includes(code)) return this.networkRadius(item, code, profile);
    if (this.isUrbanLevel(item) && CODE_LEVEL_KEYS[code] && urbanInfraConfig[CODE_LEVEL_KEYS[code][0]]) {
      return urbanInfraConfig[CODE_LEVEL_KEYS[code][0]].radius;
    }
    return this.unitRadius(code, profile);
  },

  /** Trạm xe buýt: phạm vi đi bộ; PCCC: bán kính theo phường / xã; nhà tang lễ, nghĩa trang: khoảng cách an toàn Bảng 23 */
  networkRadius: function(item, code, profile = 'DT') {
    if (code === '11-NT') return NT_KINDS[ntKind(item)].safety;
    const r = networkConfig[code].radius;
    return typeof r === 'object' ? (r[profile] || r.DT) : r;
  },

  /** Bán kính tạm khi chưa xác định được phường/xã theo tọa độ (cột Ten_XaPhuong có thể còn tên cũ trước sáp nhập) */
  defaultRadius: function(item) {
    return this.standardRadius(item, wardProfile(item && item.ward));
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
