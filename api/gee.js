const axios = require('axios');
const crypto = require('crypto');
const constants = require('../config/constants');
const { initGEE, getGeeContext, eeEvaluate, applyPopEdits, getPopEditsVersion, startPopBake, getTaskState, POP_SCALE_M } = require('../services/geeService');
const { getRawDataList, getCadParcels, getDrainage, invalidateCache, getDataVersion } = require('../services/gcsService');
const { requireAdmin, httpError } = require('../services/authService');
const roads = require('../services/roadsService');
const popEdits = require('../services/popEditsService');
const sat = require('../services/satService');
const projects = require('../services/projectStore');

let cachedWardStats = null;
let lastWardStatsFetch = 0;
let cachedWardStatsTtl = 0;
// Vercel cắt hàm ở 60 s (vercel.json): đếm pixel độ phủ phải xong trước mốc này, phần còn lại để ước lượng và trả kết quả
const WARD_STATS_BUDGET_MS = 42000;
const WARD_STATS_DEADLINE_MS = 52000;
const WARD_STATS_ESTIMATE_TTL = 3 * 60 * 1000;
let cachedWardStatsVersion = -1;
let cachedCityNetwork = null;
/** Độ phủ đã tính: { "HT:<phường>" | "QH:<phường>": { sig, ratios, Avg_Coverage_Score } } — chỉ dùng lại khi chữ ký dữ liệu khớp */
let cachedCoverageByWard = {};
// Tăng khi đổi cách tính độ phủ để mọi cache cũ (server + trình duyệt) tự hết hiệu lực
const COVERAGE_ALGO_VERSION = 3;

const isApprovedStatus = (status) => constants.isApprovedStatus(status);
const CODES = constants.CODES_TO_CHECK;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const round1 = (v) => Number(v.toFixed(1));

async function calculateNetworkIsochrone16(lat, lng, banKinh) {
  const R = parseFloat(banKinh) || 500;
  const reachRatio = constants.ISOCHRONE_CONFIG?.REACH_RATIO || 0.9;
  const sampleAngles = 16;
  const maxReachKm = (R * reachRatio) / 1000;
  const angleStep = 360 / sampleAngles;
  
  const angles = Array.from({ length: sampleAngles }, (_, i) => i * angleStep);

  try {
    const distancePromises = angles.map(async (angle) => {
      const rad = (angle * Math.PI) / 180;
      const destLat = lat + (maxReachKm / 111) * Math.cos(rad);
      const destLng = lng + (maxReachKm / (111 * Math.cos(lat * Math.PI / 180))) * Math.sin(rad);
      
      try {
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${lng},${lat};${destLng},${destLat}?overview=false`;
        const res = await axios.get(osrmUrl, { timeout: 1200 });
        
        if (res.data && res.data.routes && res.data.routes[0]) {
          const route = res.data.routes[0];
          if (route.distance > R * 1.3) return maxReachKm * 0.4;
          return Math.min(maxReachKm, (route.distance / 1000));
        }
      } catch (e) {}
      
      return maxReachKm * 0.45;
    });

    const rawDistances = await Promise.all(distancePromises);

    const smoothedDistances = [];
    const n = rawDistances.length;
    for (let i = 0; i < n; i++) {
      const prev = rawDistances[(i - 1 + n) % n];
      const curr = rawDistances[i];
      const next = rawDistances[(i + 1 + n) % n];
      smoothedDistances.push((prev + curr * 2 + next) / 4);
    }

    const polygonCoordinates = [];
    angles.forEach((angle, idx) => {
      const rad = (angle * Math.PI) / 180;
      const distKm = smoothedDistances[idx];
      
      const pLat = lat + (distKm / 111) * Math.cos(rad);
      const pLng = lng + (distKm / (111 * Math.cos(lat * Math.PI / 180))) * Math.sin(rad);
      polygonCoordinates.push([pLng, pLat]);
    });

    if (polygonCoordinates.length > 0) {
      polygonCoordinates.push(polygonCoordinates[0]);
    }

    return {
      type: 'Polygon',
      coordinates: [polygonCoordinates]
    };
  } catch (err) {
    const fallbackCoords = [];
    for (let i = 0; i < sampleAngles; i++) {
      const angle = (i * 360) / sampleAngles;
      const rad = (angle * Math.PI) / 180;
      fallbackCoords.push([
        lng + (maxReachKm / (111 * Math.cos(lat * Math.PI / 180))) * Math.sin(rad),
        lat + (maxReachKm / 111) * Math.cos(rad)
      ]);
    }
    fallbackCoords.push(fallbackCoords[0]);
    return { type: 'Polygon', coordinates: [fallbackCoords] };
  }
}

// ============================ KIỂM TRA ĐẦU VÀO / BẢO MẬT ============================

function readJsonBody(req) {
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  return body && typeof body === 'object' ? body : {};
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (constants.ALLOWED_ORIGINS.includes(origin)) return true;
  try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
}

// Đọc dữ liệu công khai cho mọi nguồn; thao tác ghi / POST chỉ nhận từ webapp (danh sách ALLOWED_ORIGINS)
function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(req)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
  } else if (req.method === 'GET') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}

function requirePostFromApp(req) {
  if (req.method !== 'POST') throw httpError(405, 'Phương thức không hợp lệ');
  if (!isAllowedOrigin(req)) throw httpError(403, 'Nguồn gửi yêu cầu không được phép');
}

function checkRate(store, req, max, windowMs, message) {
  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const hits = (store.get(ip) || []).filter(t => now - t < windowMs);
  if (hits.length >= max) throw httpError(429, message);
  hits.push(now);
  if (store.size > 5000) store.clear();
  store.set(ip, hits);
}

const addPointHits = new Map();
function checkAddPointRate(req) {
  checkRate(addPointHits, req, 10, 10 * 60 * 1000, 'Gửi quá nhiều đề xuất, vui lòng thử lại sau ít phút');
}

// Hồ sơ file chờ duyệt (người dùng chưa đăng nhập): mỗi IP tối đa 3 file / giờ, mỗi file ≤ 2 MB
const PENDING_CAD_MAX_BYTES = 2 * 1024 * 1024;
const PENDING_CAD_EXTS = ['dxf', 'kml', 'geojson'];
const PENDING_CAD_ID = /^[a-f0-9]{24}$/;
const cadPendingHits = new Map();
function checkCadPendingRate(req) {
  checkRate(cadPendingHits, req, 3, 60 * 60 * 1000, 'Mỗi máy chỉ gửi được 3 file mỗi giờ, vui lòng thử lại sau');
}

function looksLikeCadFile(ext, content) {
  if (ext === 'dxf') return content.slice(0, 4000).includes('SECTION') && content.includes('ENTITIES');
  if (ext === 'kml') return /<kml[\s>]/i.test(content.slice(0, 5000));
  try {
    const g = JSON.parse(content);
    return !!g && (g.type === 'FeatureCollection' || g.type === 'Feature');
  } catch (e) {
    return false;
  }
}

// Tóm tắt kiểm tra do trình duyệt người gửi tính (chỉ để Admin xem nhanh trong danh sách chờ)
function parsePendingSummary(s) {
  if (!s || typeof s !== 'object') return {};
  const n = (v) => clamp(Math.round(Number(v) || 0), 0, 100000);
  return {
    parcels: n(s.parcels), create: n(s.create), update: n(s.update),
    wards: (Array.isArray(s.wards) ? s.wards : []).slice(0, 12).map(w => sanitizeSheetText(w, 60)).filter(Boolean),
    kinds: sanitizeSheetText(s.kinds, 200)
  };
}

async function readPendingCadIndex() {
  const r = await axios.get(`${constants.PENDING_CAD_BASE}index.json?v=${Date.now()}`, { timeout: 8000, validateStatus: () => true });
  if (r.status === 404 || r.status === 403) return { saved: 0, items: [] };
  if (r.status !== 200 || !r.data || !Array.isArray(r.data.items)) throw httpError(502, 'Không đọc được danh sách hồ sơ chờ duyệt');
  return { saved: Number(r.data.saved) || 0, items: r.data.items };
}

function parseCoordInBounds(latRaw, lngRaw) {
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  const b = constants.HUE_BOUNDS;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) return null;
  return { lat, lng };
}

function parseRadius(raw, fallback = 500) {
  const r = Number(raw);
  const { min, max } = constants.RADIUS_LIMITS;
  return clamp(Number.isFinite(r) && r > 0 ? r : fallback, min, max);
}

// Vòng ngoài vùng phục vụ do client dựng ([[lng, lat], ...]): mọi đỉnh phải nằm trong bán kính (+ dung sai làm mềm) quanh công trình
function parseServiceRing(raw, pt, radius) {
  if (!Array.isArray(raw) || raw.length < 4 || raw.length > 3000) return null;
  const maxM = radius + 150;
  const mLat = 111320;
  const mLng = 111320 * Math.cos(pt.lat * Math.PI / 180);
  const ring = [];
  for (const c of raw) {
    if (!Array.isArray(c)) return null;
    const lng = Number(c[0]), lat = Number(c[1]);
    if (!parseCoordInBounds(lat, lng)) return null;
    if (Math.hypot((lat - pt.lat) * mLat, (lng - pt.lng) * mLng) > maxM) return null;
    ring.push([lng, lat]);
  }
  const first = ring[0], last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return ring;
}

// Tên ghi vào Google Sheet: bỏ ký tự điều khiển và ký tự đầu dòng khiến Sheet hiểu thành công thức (= + - @)
function sanitizeSheetText(raw, maxLen) {
  return String(raw || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[=+\-@]+/, '')
    .trim()
    .slice(0, maxLen);
}

// ============================ NHẬP LÔ ĐẤT TỪ DXF ============================

const CAD_BATCH_MAX = 300;
// Ô Google Sheet chứa tối đa 50.000 ký tự: ranh dài hơn thì chỉ ghi điểm tâm
const CAD_GEOJSON_MAX_CHARS = 45000;
const round6 = (v) => Math.round(v * 1e6) / 1e6;

function parseCadGeometry(g) {
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon') || !Array.isArray(g.coordinates)) return null;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const out = [];
  for (const poly of polys) {
    if (!Array.isArray(poly) || !poly.length) return null;
    const rings = [];
    for (const ring of poly) {
      if (!Array.isArray(ring) || ring.length < 4 || ring.length > 20000) return null;
      const r = [];
      for (const c of ring) {
        if (!Array.isArray(c)) return null;
        const pt = parseCoordInBounds(c[1], c[0]);
        if (!pt) return null;
        r.push([round6(pt.lng), round6(pt.lat)]);
      }
      rings.push(r);
    }
    out.push(rings);
  }
  return out.length === 1 ? { type: 'Polygon', coordinates: out[0] } : { type: 'MultiPolygon', coordinates: out };
}

// Quy mô 1 giai đoạn của lô: { phase HT/QH, point, crossWard, area, size, layer, geometry }; null nếu không hợp lệ.
// Điểm (không có ranh): quy mô ghi 0 = có công trình, chưa rõ diện tích. Lô vắt ranh ghi quy mô 0
function parseCadStage(s, fallbackLayer) {
  if (!s || typeof s !== 'object') return null;
  const phase = s.phase === 'QH' || s.phase === 'HT' ? s.phase : null;
  const area = Number(s.area);
  const point = s.point === true;
  if (!phase || !Number.isFinite(area) || area > 1e8 || (point ? area !== 0 : area <= 0)) return null;
  const crossWard = !point && s.crossWard === true;
  const areaRounded = Math.round(area * 10) / 10;
  const geometry = point ? null : parseCadGeometry(s.geometry);
  return {
    phase, point, crossWard, area: areaRounded, size: crossWard ? 0 : areaRounded,
    layer: sanitizeSheetText(s.layer, 60) || fallbackLayer, geometry
  };
}

// Chỉ tiêu quy hoạch lô { floors, coverage, far } → cột TangCao / MatDoXD / HeSoSDD; null nếu trống
function parseCadPlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  const out = {};
  ['floors', 'coverage', 'far'].forEach(k => {
    const v = sanitizeSheetText(plan[k], 20);
    if (v) out[k] = v;
  });
  return Object.keys(out).length ? out : null;
}

const CAD_SPLITS_MAX = 3;

function parseLandArea(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  Object.keys(raw).slice(0, 40).forEach(w => {
    const ward = sanitizeSheetText(w, 80);
    const types = raw[w];
    if (!ward || !types || typeof types !== 'object' || Array.isArray(types)) return;
    const row = {};
    Object.keys(types).slice(0, 40).forEach(k => {
      const label = sanitizeSheetText(k, 40);
      const n = Number(types[k]);
      if (label && Number.isFinite(n) && n >= 0 && n < 1e12) row[label] = Math.round(n * 10) / 10;
    });
    if (Object.keys(row).length) out[ward] = row;
  });
  return out;
}

// Danh mục đồ án gửi kèm phần cuối của lần nhập.
// boundarySource: gis (file ranh) | auto (dựng từ lô). keepBoundary: ghép hiện trạng, giữ ranh đang có.
function parseCadRegistry(reg) {
  if (!reg || typeof reg !== 'object') return null;
  let boundary = parseCadGeometry(reg.boundary);
  if (boundary && JSON.stringify(boundary).length > CAD_GEOJSON_MAX_CHARS) boundary = null;
  const wards = (Array.isArray(reg.wards) ? reg.wards : []).slice(0, 12).map(w => sanitizeSheetText(w, 80)).filter(Boolean);
  const count = (v) => Math.max(0, Math.min(100000, Math.round(Number(v) || 0)));
  const boundarySource = reg.boundarySource === 'gis' ? 'gis' : reg.boundarySource === 'auto' ? 'auto' : null;
  return {
    boundary, boundarySource, keepBoundary: reg.keepBoundary === true,
    wards, infra: count(reg.infra), lands: count(reg.lands), landArea: parseLandArea(reg.landArea)
  };
}

// Mảnh phường phụ của lô vắt ranh: { ward, lat, lng, stages: [{ phase, area, geometry }] }, giai đoạn phải thuộc lô chính
function parseCadSplits(raw, layer, phases) {
  if (!Array.isArray(raw) || !raw.length) return [];
  if (raw.length > CAD_SPLITS_MAX) return null;
  const out = [];
  for (const sp of raw) {
    if (!sp || typeof sp !== 'object' || !Array.isArray(sp.stages) || !sp.stages.length || sp.stages.length > 2) return null;
    const pt = parseCoordInBounds(sp.lat, sp.lng);
    const ward = sanitizeSheetText(sp.ward, 80);
    const stages = sp.stages.map(s => parseCadStage({ ...s, point: false, crossWard: false }, layer));
    if (!pt || !ward || stages.some(s => !s || !phases.includes(s.phase))) return null;
    out.push({ ward, lat: pt.lat.toFixed(6), lng: pt.lng.toFixed(6), stages });
  }
  return out;
}

// 1 lô đất ngoài nhóm hạ tầng (ghi file đồ án trên bucket, không vào Sheet); null nếu không hợp lệ
function parseLandItem(it) {
  if (!it || typeof it !== 'object') return null;
  const pt = parseCoordInBounds(it.lat, it.lng);
  const area = Number(it.area);
  const geometry = parseCadGeometry(it.geometry);
  if (!pt || !geometry || !Number.isFinite(area) || area <= 0 || area > 1e8) return null;
  if (JSON.stringify(geometry).length > 2000000) return null;
  const layer = sanitizeSheetText(it.layer, 60);
  return {
    name: sanitizeSheetText(it.name, 150) || layer || 'Lô đất',
    ward: sanitizeSheetText(it.ward, 80),
    nhom: sanitizeSheetText(it.nhom, 40) || 'Đất khác',
    layer,
    lat: pt.lat.toFixed(6), lng: pt.lng.toFixed(6),
    area: Math.round(area * 10) / 10,
    phase: it.phase === 'QH' || it.phase === 'HT' ? it.phase : null,
    plan: parseCadPlan(it.plan),
    geometry
  };
}

function sheetGeometry(geometry) {
  if (!geometry) return null;
  return JSON.stringify(geometry).length > CAD_GEOJSON_MAX_CHARS ? null : geometry;
}

// Ô Sheet tối đa 50.000 ký tự: ranh dài hơn vẫn giữ trong file đồ án, Sheet chỉ nhận điểm tâm
function sheetItem(it) {
  return {
    ...it,
    geometry: sheetGeometry(it.geometry),
    stages: (it.stages || []).map(s => ({ ...s, geometry: sheetGeometry(s.geometry) })),
    splits: (it.splits || []).map(sp => ({
      ...sp,
      stages: (sp.stages || []).map(s => ({ ...s, geometry: sheetGeometry(s.geometry) }))
    }))
  };
}

// Bán kính phục vụ theo QCVN 01:2026 (constants.standardRadius). Không ghi vào Sheet — cột I là Ten_QH.
function qcvnRadius(item, ward) {
  if (item.type === '12-CSD') return null;
  return constants.standardRadius(item, constants.wardProfile(ward));
}

// 1 lô do trình duyệt gửi → dữ liệu ghi Sheet; null nếu không hợp lệ.
// it.stages: 1–2 giai đoạn khác nhau (cặp HT + QH cùng vị trí); không có thì 1 giai đoạn = defaultPhase (ô Giai đoạn)
function parseCadItem(it, defaultPhase) {
  if (!it || typeof it !== 'object') return null;
  const type = String(it.type || '');
  const idPrefix = String(it.idPrefix || '').toUpperCase();
  if (!/^[A-Z_]{2,8}$/.test(idPrefix) || constants.codeMap[idPrefix] !== type) return null;
  const pt = parseCoordInBounds(it.lat, it.lng);
  const ward = sanitizeSheetText(it.ward, 80);
  const layer = sanitizeSheetText(it.layer, 60) || idPrefix;
  const matchId = it.matchId ? String(it.matchId) : null;
  const rawStages = Array.isArray(it.stages) && it.stages.length ? it.stages
    : [{ phase: defaultPhase, area: it.area, point: it.point, crossWard: it.crossWard, layer: it.layer, geometry: it.geometry }];
  if (rawStages.length > 2) return null;
  const stages = rawStages.map(s => parseCadStage(s, layer));
  if (stages.some(s => !s) || new Set(stages.map(s => s.phase)).size !== stages.length) return null;
  // Công trình chỉ có điểm: chỉ tạo mới
  const point = stages.every(s => s.point);
  if (!pt || !ward || (point && matchId)) return null;
  if (matchId && !/^[A-Za-z0-9_\-]{1,40}$/.test(matchId)) return null;
  const first = stages[0];
  const nhom = it.nhom === 'Cấp đô thị' ? 'Cấp đô thị' : 'Cấp đơn vị ở';
  const name = sanitizeSheetText(it.name, 150) || `${layer} (DXF)`;
  const splits = point ? [] : parseCadSplits(it.splits, layer, stages.map(s => s.phase));
  if (!splits) return null;
  return {
    type, idPrefix, nhom, name,
    radius: qcvnRadius({ id: `${idPrefix}-0`, type, name, nhomHaTang: nhom, size: first.size }, ward),
    ward, layer, matchId, crossWard: first.crossWard, point,
    lat: pt.lat.toFixed(6), lng: pt.lng.toFixed(6),
    area: first.area,
    size: first.size,
    geometry: first.geometry,
    plan: parseCadPlan(it.plan),
    splits,
    stages
  };
}

// ============================ ADMIN SỬA 1 LÔ ĐỒ ÁN ============================

const LOT_ID_RE = /^[A-Za-z0-9_.\-]{1,40}$/;

// Quy mô sửa tay: '' = xóa ô (giai đoạn đó không có công trình); undefined = không đổi; NaN = không hợp lệ
function parseEditSize(v) {
  if (v === undefined) return undefined;
  const s = String(v ?? '').trim().replace(',', '.');
  if (!s) return '';
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 1e8 ? Math.round(n * 10) / 10 : NaN;
}

// Chỉ tiêu sửa tay: giữ khóa có gửi (kể cả '' để xóa)
function parseEditPlan(plan) {
  if (!plan || typeof plan !== 'object') return undefined;
  const out = {};
  ['floors', 'coverage', 'far'].forEach(k => { if (plan[k] !== undefined) out[k] = sanitizeSheetText(plan[k], 20); });
  return Object.keys(out).length ? out : undefined;
}

/** Trường sửa của lô hạ tầng (dòng Sheet); null nếu không hợp lệ */
function parseInfraEdit(f) {
  const out = {};
  if (f.name !== undefined) {
    out.name = sanitizeSheetText(f.name, 150);
    if (!out.name) return null;
  }
  if (f.nhom !== undefined) out.nhom = f.nhom === 'Cấp đô thị' ? 'Cấp đô thị' : 'Cấp đơn vị ở';
  for (const [key, src] of [['quyMoHT', f.sizeHT], ['quyMoQH', f.sizeQH]]) {
    const v = parseEditSize(src);
    if (Number.isNaN(v)) return null;
    if (v !== undefined) out[key] = v;
  }
  const plan = parseEditPlan(f.plan);
  if (plan) out.plan = plan;
  if (f.note !== undefined) out.note = sanitizeSheetText(f.note, 300);
  return Object.keys(out).length ? out : null;
}

/** Trường sửa của lô đất khác (file đồ án trên bucket); null nếu không hợp lệ */
function parseLandEdit(f) {
  const out = {};
  if (f.name !== undefined) out.name = sanitizeSheetText(f.name, 150);
  if (f.nhom !== undefined) out.nhom = sanitizeSheetText(f.nhom, 40) || 'Đất khác';
  const plan = parseEditPlan(f.plan);
  if (plan) out.plan = plan;
  return Object.keys(out).length ? out : null;
}

// body != null → POST JSON tới doPost (dữ liệu lớn); còn lại GET tới doGet
async function callAppsScript(params, body = null) {
  if (!constants.GAS_BASE_URL) {
    throw httpError(503, 'Máy chủ chưa cấu hình GAS_BASE_URL (Vercel → Settings → Environment Variables)');
  }
  const query = new URLSearchParams(params);
  if (constants.GAS_SECRET) query.set('key', constants.GAS_SECRET);
  const url = `${constants.GAS_BASE_URL}?${query.toString()}`;
  const opts = {
    timeout: body ? 55000 : 25000,
    responseType: 'text',
    transformResponse: r => r,
    validateStatus: () => true
  };

  let res;
  try {
    // text/plain: Apps Script đưa nguyên chuỗi JSON vào e.postData.contents.
    // application/json đôi khi bị bỏ body, doPost chỉ thấy query rồi trả "Action không hợp lệ".
    res = body
      ? await axios.post(url, JSON.stringify(body), {
          ...opts,
          maxBodyLength: Infinity,
          maxRedirects: 0,
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          transformRequest: [data => data]
        })
      : await axios.get(url, opts);
    const locHeader = res && res.headers && res.headers.location;
    const loc = Array.isArray(locHeader) ? locHeader[0] : locHeader;
    if (body && loc && res.status >= 300 && res.status < 400) {
      res = await axios.get(String(loc).startsWith('http') ? loc : new URL(loc, url).href, opts);
    }
  } catch (e) {
    throw httpError(502, 'Không kết nối được Google Apps Script');
  }

  const text = String(res.data || '');
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  if (data && typeof data === 'object') {
    if (res.status >= 400 || data.error || data.success === false) {
      let msg = data.error || data.message || 'từ chối yêu cầu';
      if (String(msg).indexOf('Action không hợp lệ') === 0) {
        msg += '. Web app trên Sheet vẫn là bản cũ: Extensions → Apps Script, dán file apps-script/Code.gs, rồi Deploy → Manage deployments → Edit → Version: New version → Deploy. Save không cập nhật web app.';
      }
      throw httpError(502, `Apps Script: ${msg}`);
    }
    return data;
  }
  // Bản Apps Script cũ trả về trang HTML khi thêm điểm thành công
  if (res.status < 400 && text.includes('THÀNH CÔNG')) {
    const idMatch = text.match(/ID:\s*<b>([^<]+)<\/b>/i);
    return { success: true, id: idMatch ? idMatch[1].trim() : null };
  }
  throw httpError(502, 'Apps Script trả về phản hồi không hợp lệ');
}

projects.setTransport(async ({ op, name, content }) => {
  if (op === 'del') {
    const result = await callAppsScript({ action: 'deleteBucketObject' }, { action: 'deleteBucketObject', name });
    return result.success === true;
  }
  const result = await callAppsScript({ action: 'putBucketObject' }, { action: 'putBucketObject', name, content });
  return result.saved === true;
});

// Đề xuất chuyển đổi CSD: độ phủ tăng dưới ngưỡng này (% dân cư phường) coi như không tăng → chọn theo thiếu quy mô
const CSD_MIN_COVERAGE_PCT = 0.5;

// Bậc cao độ (m) của bảng dân số / diện tích theo cao độ: dưới FLOOD_BIN_MIN gộp vào bậc đầu, từ FLOOD_BIN_MAX gộp vào bậc cuối
const FLOOD_BIN_MIN = -1;
const FLOOD_BIN_MAX = 40;
let cachedFloodBins = null;   // { version: phiên bản hiệu chỉnh dân cư, dem: nguồn cao độ, data }
const FLOOD_DEM = 'fabdem-hue';
const cachedSatStats = new Map();   // "lst|năm" hoặc "sar|năm|bản dân cư|bản dữ liệu" → kết quả thống kê lớp vệ tinh
// Tọa độ công trình là 1 điểm trong khu đất: xét rủi ro ngập / nhiệt trong vòng bán kính này quanh điểm
const RISK_BUFFER_M = 30;
// Trong vùng phát triển mới (satService.newDevImage) kiểm tra vườn hoa, bãi đỗ xe ≤ 400 m (Mục 2.2.3.3, đường chim bay)
const DEV_SERVICE_M = 400;
const wardNameOf = (p) => p.tenXa || p.NAME_2 || p.name || 'Phường';
// Pixel có dân (1/0). Đếm trên lưới raster dân cư (crs popProjection, POP_SCALE_M) như lúc chia dân số phường rồi quy ra người:
// dân trong vùng = dân phường × pixel có dân trong vùng / tổng pixel có dân của phường. Cộng thẳng popRasterNormalized
// (phép chiếu mặc định WGS84 do paint) ra gấp ~2,8 lần.
const populatedPixels = (popRasterNative) => popRasterNative.mask().gt(0).unmask(0).rename('pix');

/**
 * Diện tích (ha) theo cả 40 phường/xã của vùng hiện trạng (base) và vùng phát triển mới (dev) đúng như ranh đỏ/xanh trên
 * bản đồ. Đất xây dựng hiện nay = base + dev: dùng chung cho bảng "Vùng phát triển mới" và mẫu số mật độ đường.
 */
function loadDevAreas(ee, wardVectorParsed, from) {
  const key = `devArea|${from}|${sat.devRecentYears().join('-')}`;
  if (!cachedSatStats.has(key)) {
    const img = sat.newDevImage(ee, wardVectorParsed, from);
    const ha = ee.Image.pixelArea().divide(1e4);
    const stack = ha.multiply(img.select('base')).rename('base').addBands(ha.multiply(img.select('dev')).rename('dev'));
    const job = eeEvaluate(stack.reduceRegions({
      collection: wardVectorParsed, reducer: ee.Reducer.sum(), crs: sat.DEV_CRS, scale: sat.DEV_SCALE_M, tileScale: 8
    }).map(f => ee.Feature(null).copyProperties(f))).then(fc => {
      const wards = {};
      ((fc && fc.features) || []).forEach(f => {
        const p = f.properties || {};
        wards[wardNameOf(p)] = { baseHa: round1(Number(p.base) || 0), devHa: round1(Number(p.dev) || 0) };
      });
      return wards;
    }).catch(err => {
      cachedSatStats.delete(key);
      throw err;
    });
    if (cachedSatStats.size > 40) cachedSatStats.clear();
    cachedSatStats.set(key, job);
  }
  return cachedSatStats.get(key);
}

function invalidateAllCaches() {
  invalidateCache();
  cachedWardStats = null;
  cachedCoverageByWard = {};
}

/**
 * Áp vùng hiệu chỉnh dân cư mới nhất lên raster (đọc bucket tối đa 5 phút/lần; minVersion mới hơn bản đang áp → đọc ngay);
 * đổi phiên bản → bỏ mọi số liệu tính theo dân cư
 */
async function syncPopEdits(minVersion = 0) {
  let data;
  try {
    data = await popEdits.readPopEdits(minVersion > getPopEditsVersion());
  } catch (err) {
    console.warn('Đọc vùng hiệu chỉnh dân cư lỗi:', err.message);
    return;
  }
  if (data.saved === getPopEditsVersion()) return;
  applyPopEdits(data.saved, data.edits, data.asset);
  cachedFloodBins = null;
  cachedWardStats = null;
  cachedCoverageByWard = {};
  wardPopPixelCache.clear();
}

/** Ghi edits.json qua Apps Script (bucket không cho máy chủ ghi trực tiếp) */
async function writePopEdits(payload) {
  const content = JSON.stringify(payload);
  if (content.length > popEdits.MAX_CHARS) throw httpError(413, 'Danh sách vùng hiệu chỉnh quá lớn');
  const result = await callAppsScript({ action: 'savePopEdits' }, { action: 'savePopEdits', content });
  if (result.saved !== true) throw httpError(502, 'Apps Script chưa ghi được lên bucket (đã triển khai phiên bản mới của Code.gs chưa?)');
  popEdits.rememberPopEdits(payload);
}

// ============================ HÌNH HỌC PHƯỜNG ============================

function isPointInPolygon(point, vs) {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInPolygonRings(point, rings) {
  if (!rings || !rings[0] || !isPointInPolygon(point, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (isPointInPolygon(point, rings[i])) return false;
  }
  return true;
}

/**
 * Ranh giới phường từ GEE có thể là GeometryCollection (lẫn LineString).
 * Quy về Polygon / MultiPolygon để mọi phép kiểm tra điểm-trong-phường thống nhất.
 */
function normalizeWardGeometry(geometry) {
  if (!geometry) return null;
  const polygons = [];
  const collect = (g) => {
    if (!g) return;
    if (g.type === 'Polygon' && Array.isArray(g.coordinates)) polygons.push(g.coordinates);
    else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) g.coordinates.forEach(p => polygons.push(p));
    else if (g.type === 'GeometryCollection') (g.geometries || []).forEach(collect);
  };
  collect(geometry);
  if (polygons.length === 0) return null;
  if (polygons.length === 1) return { type: 'Polygon', coordinates: polygons[0] };
  return { type: 'MultiPolygon', coordinates: polygons };
}

function checkPointInGeoJSONGeometry(ptLng, ptLat, geometry) {
  const geom = (geometry && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon'))
    ? geometry
    : normalizeWardGeometry(geometry);
  if (!geom) return false;
  const pt = [ptLng, ptLat];
  try {
    if (geom.type === 'Polygon') return isPointInPolygonRings(pt, geom.coordinates);
    return geom.coordinates.some(rings => isPointInPolygonRings(pt, rings));
  } catch (e) {}
  return false;
}

function geometryBBox(geometry) {
  if (!geometry) return null;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  (polys || []).forEach(rings => (rings[0] || []).forEach(([x, y]) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }));
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

/** Khoảng cách mét (haversine) */
function distMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Diện tích polygon GeoJSON (m²) — equirectangular gần đúng */
function geoJsonAreaM2(geometry) {
  if (!geometry || !geometry.coordinates) return 0;
  const ringArea = (ring) => {
    if (!ring || ring.length < 3) return 0;
    const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
    let sum = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const x1 = ring[i][0] * mPerDegLng;
      const y1 = ring[i][1] * mPerDegLat;
      const x2 = ring[i + 1][0] * mPerDegLng;
      const y2 = ring[i + 1][1] * mPerDegLat;
      sum += x1 * y2 - x2 * y1;
    }
    return Math.abs(sum) / 2;
  };
  try {
    if (geometry.type === 'Polygon') return ringArea(geometry.coordinates[0]);
    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.reduce((s, poly) => s + ringArea(poly[0]), 0);
    }
  } catch (e) {}
  return 0;
}

/**
 * Ước lượng % độ phủ BỔ SUNG khi đặt hạ tầng tại (lat,lng):
 * = diện tích (buffer ∩ phường − đã phủ bởi cùng loại) / diện tích phường × 100.
 * Bán kính mặc định 1000m; phần chồng buffer cùng loại bị loại → thường chỉ vài %.
 */
function estimateCoverageAddPct({ lat, lng, radius, wardGeometry, wardArea = geoJsonAreaM2(wardGeometry), existingSameType }) {
  const R = Math.max(50, Number(radius) || 1000);
  if (!wardArea || wardArea <= 0 || lat == null || lng == null) return 0;

  const bufferArea = Math.PI * R * R;
  const rings = 5;
  const perRing = 16;
  let sampleTotal = 0;
  let sampleNewInWard = 0;

  // Chỉ công trình đủ gần mới có thể chồng lên buffer ứng viên
  const nearby = (existingSameType || []).filter(ex => ex.lat != null && ex.lng != null
    && distMeters(lat, lng, Number(ex.lat), Number(ex.lng)) <= R + Math.max(50, Number(ex.radius) || R));

  const isCoveredByExisting = (pLat, pLng) => {
    for (const ex of nearby) {
      const rEx = Math.max(50, Number(ex.radius) || Number(ex.banKinh) || R);
      if (distMeters(pLat, pLng, Number(ex.lat), Number(ex.lng)) <= rEx) return true;
    }
    return false;
  };

  const consider = (sLat, sLng) => {
    sampleTotal += 1;
    if (!checkPointInGeoJSONGeometry(sLng, sLat, wardGeometry)) return;
    if (isCoveredByExisting(sLat, sLng)) return;
    sampleNewInWard += 1;
  };

  consider(lat, lng);
  for (let ring = 1; ring <= rings; ring++) {
    const r = (R * ring) / rings;
    for (let k = 0; k < perRing; k++) {
      const ang = (2 * Math.PI * k) / perRing + (ring % 2) * (Math.PI / perRing);
      const dLat = (r * Math.cos(ang)) / 111320;
      const dLng = (r * Math.sin(ang)) / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
      consider(lat + dLat, lng + dLng);
    }
  }

  if (sampleTotal <= 0) return 0;
  const netAreaInWard = (sampleNewInWard / sampleTotal) * bufferArea;
  const pct = (Math.min(netAreaInWard, wardArea) / wardArea) * 100;
  return Number(Math.min(100, Math.max(0, pct)).toFixed(1));
}

// ============================ ĐỀ XUẤT CHUYỂN ĐỔI QUỸ ĐẤT (CSD) ============================
// Dùng chung cho popup khu đất (analyzeCSD), bảng chi tiết phường (getWardStats) và lớp minh chứng (explainCSD)

// Đếm pixel trên lưới gốc của raster phân bổ dân cư (Pixel-danso) — phép đếm và lớp ảnh minh chứng dùng cùng lưới này
// Tổng pixel dân cư của phường không đổi theo dữ liệu công trình
const wardPopPixelCache = new Map();
let popPixelSizeCache = null;

/** Kích thước ô lưới (m) của raster dân cư gốc */
async function popPixelSize(popProjection) {
  if (popPixelSizeCache == null) {
    popPixelSizeCache = round1(Number(await eeEvaluate(popProjection.nominalScale())) || 0);
  }
  return popPixelSizeCache;
}

/**
 * Số dân tối đa 1 khu đất/công trình đáp ứng = diện tích ÷ chỉ tiêu m²/người của loại (chỉ tiêu tổng như bảng phường; THPT theo chỉ tiêu riêng;
 * công viên theo hạng: khu vực / đô thị → cây xanh đô thị, vườn hoa → cây xanh đơn vị ở).
 * capacity = null: chưa rõ diện tích (0) hoặc QCVN không quy định chỉ tiêu cho loại/địa bàn → không giới hạn.
 */
function capacityByQuota(item, size, profile) {
  const code = constants.resolveTypeCode(item);
  const quota = constants.isThptItem(item)
    ? (constants.baseQuota('THPT', profile) || 0)
    : code === '1-CV'
      ? (constants.baseQuota(constants.parkTier({ ...item, size }).urban ? 'CV_DT' : 'CV_DV', profile) || 0)
      : constants.quotaFor(code, profile);
  return { quota, capacity: quota > 0 && size > 0 ? Math.floor(size / quota) : null };
}

const capByCapacity = (pop, capacity) => (capacity == null ? pop : Math.min(pop, capacity));

/** Bán kính vùng phục vụ của khu đất khi xét loại `code`: theo quy chuẩn của loại và hồ sơ phường/xã */
function csdCandidateRadius(csd, code, profile) {
  if (code === '1-CV') return constants.parkTier({ type: code, size: csd.size }).radius;
  return constants.unitRadius(code, profile);
}

// ============================ MẠNG LƯỚI: TRẠM XE BUÝT, TRỤ SỞ PCCC, NHÀ TANG LỄ - NGHĨA TRANG ============================

const networkItemsOf = (list, code) => list.filter(it => it.type === code && isApprovedStatus(it.status) && it.lat != null && it.lng != null);
const isCemetery = (it) => String(it.ntKind || constants.ntKind(it)).startsWith('cemetery');

/**
 * Trạm của phường cách trạm gần nhất > gapMax (Mục 2.8.3.3: khu trung tâm ≤ 600 m); trạm cách < gapIgnore
 * coi là cặp trạm 2 chiều đường nên không tính là trạm kế cận
 */
function busGaps(stopsInWard, allStops) {
  const { gapMax, gapIgnore } = constants.networkConfig['13-BUS'];
  const out = [];
  stopsInWard.forEach(s => {
    let nearest = Infinity;
    allStops.forEach(o => {
      if (o === s) return;
      const d = distMeters(Number(s.lat), Number(s.lng), Number(o.lat), Number(o.lng));
      if (d >= gapIgnore && d < nearest) nearest = d;
    });
    if (nearest > gapMax) out.push({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, nearestM: Number.isFinite(nearest) ? Math.round(nearest) : null });
  });
  return out;
}

const networkSlim = (it) => ({
  id: it.id, name: it.name, type: it.type, lat: it.lat, lng: it.lng,
  size: Number(it.size) || 0, radius: Number(it.radius) || 0, status: it.status,
  ...(it.type === '11-NT' ? { ntKind: it.ntKind || constants.ntKind(it) } : {})
});

/** Tóm tắt mạng lưới của 1 phường: approved = công trình đã duyệt trong phường, pending = điểm chờ duyệt */
function wardNetworkSummary(approved, pending, allBusStops, profile) {
  const of = (code) => approved.filter(it => it.type === code);
  const bus = of('13-BUS');
  return {
    bus: bus.map(networkSlim),
    // Khoảng cách trạm ≤ 600 m chỉ áp dụng khu trung tâm đô thị → chỉ xét phường
    busGaps: profile === 'DT' ? busGaps(bus, allBusStops) : [],
    busGapCheck: profile === 'DT',
    pccc: of('10-PCCC').map(networkSlim),
    pcccRadius: constants.networkRadius({}, '10-PCCC', profile),
    nt: of('11-NT').map(networkSlim),
    pending: pending.map(networkSlim)
  };
}

/** Chỉ tiêu toàn thành phố: số nhà tang lễ (Mục 2.12.1.1) và diện tích nghĩa trang (Mục 2.12.2.1) theo dân số quy hoạch */
function cityNetworkSummary(list, cityPop) {
  const cfg = constants.networkConfig['11-NT'];
  const nt = networkItemsOf(list, '11-NT');
  const cemeteries = nt.filter(isCemetery);
  const kindCount = (k) => nt.filter(it => (it.ntKind || constants.ntKind(it)) === k).length;
  return {
    pop: cityPop,
    busCount: networkItemsOf(list, '13-BUS').length,
    pcccCount: networkItemsOf(list, '10-PCCC').length,
    funeralCount: kindCount('funeral'),
    funeralRequired: Math.max(1, Math.ceil(cityPop / cfg.funeralPopPer)),
    crematoriumCount: kindCount('crematorium'),
    cemeteryCount: cemeteries.length,
    cemeteryArea: Math.round(cemeteries.reduce((s, it) => s + (Number(it.size) || 0), 0)),
    cemeteryNoArea: cemeteries.filter(it => !(Number(it.size) > 0)).length,
    cemeteryRequired: Math.round(cityPop * cfg.cemeteryQuota)
  };
}

/** Độ phủ mạng lưới đã tính: { "HT:<phường>": { sig, payload } } */
let cachedNetworkCoverage = {};

function networkSignature(groups) {
  const parts = Object.keys(groups).map(k => `${k}:${groups[k].map(it => [it.id, it.lat, it.lng, it.radius].join('|')).sort().join(';')}`);
  return crypto.createHash('md5').update(`n1p${getPopEditsVersion()}#${parts.join('#')}`).digest('hex').slice(0, 12);
}

/**
 * Dân số phường nằm trong vùng phục vụ trạm xe buýt (500 m), trụ sở PCCC (3 km phường / 5 km xã — theo phường đang xét)
 * và trong khoảng cách an toàn nghĩa trang / cơ sở hỏa táng (Bảng 23). Mọi công trình toàn TP đều được xét (buffer vượt ranh phường)
 */
async function computeNetworkCoverage(ee, popRaster, wardGeometry, groups) {
  const geom = ee.Geometry(wardGeometry);
  const empty = ee.Image(0).selfMask();
  const maskOf = (items) => items.length
    ? ee.Image(0).byte().paint(ee.FeatureCollection(items.map(it =>
      ee.Feature(ee.Geometry.Point([Number(it.lng), Number(it.lat)]).buffer(Number(it.radius))))), 1).selfMask()
    : empty;
  const pop = popRaster.select('DanSoPixelNormalized');
  const img = ee.Image.cat([
    pop.rename('total'),
    ...Object.keys(groups).map(k => pop.updateMask(maskOf(groups[k])).rename(k))
  ]);
  const res = (await eeEvaluate(img.reduceRegion({
    reducer: ee.Reducer.sum().unweighted(), geometry: geom, scale: POP_SCALE_M, maxPixels: 1e9
  }))) || {};
  const total = Math.round(Number(res.total) || 0);
  const out = { popTotal: total };
  Object.keys(groups).forEach(k => {
    const p = Math.round(Number(res[k]) || 0);
    out[k] = { pop: p, pct: total > 0 ? round1(clamp((p / total) * 100, 0, 100)) : 0, count: groups[k].length };
  });
  return out;
}

// ============================ NHẬP ĐIỂM OPENSTREETMAP (ADMIN) ============================

const OSM_IMPORT_MAX = 1500;
// Cùng loại đã có trong dữ liệu gần hơn ngưỡng này (m) → coi là trùng, không đề xuất lại
// (trạm xe buýt nhỏ: cặp trạm 2 chiều đường cách nhau ~20–30 m vẫn là 2 trạm)
const OSM_DUP_M = { "13-BUS": 12, "10-PCCC": 80, "11-NT": 60 };
const OSM_REF_RE = /^OSM:(node|way|relation)\/\d{1,12}$/;

/** Điểm OSM trình duyệt gửi lên → điểm hợp lệ (đúng loại, trong 40 phường/xã, chưa có trong dữ liệu) kèm phường và bán kính */
function prepareOsmImport(rawItems, allDataList, evaluatedWards) {
  const stats = {};
  constants.NETWORK_CODES.forEach(c => { stats[c] = { received: 0, outside: 0, duplicate: 0, accepted: 0 }; });
  const known = allDataList.filter(it => constants.isNetworkCode(it.type) && it.lat != null && it.lng != null);
  const knownRefs = new Set();
  known.forEach(it => {
    const m = String(it.note || '').match(/OSM:(node|way|relation)\/\d+/);
    if (m) knownRefs.add(m[0]);
  });
  const accepted = [];
  rawItems.forEach(raw => {
    const type = String(raw && raw.type || '');
    if (!constants.isNetworkCode(type)) return;
    const st = stats[type];
    st.received++;
    const pt = parseCoordInBounds(raw.lat, raw.lng);
    const ref = String(raw.ref || '');
    if (!pt || !OSM_REF_RE.test(ref)) { st.outside++; return; }
    const ward = assignWardByGeometry(pt.lng, pt.lat, evaluatedWards);
    if (!ward) { st.outside++; return; }
    const near = (it) => it.type === type && distMeters(pt.lat, pt.lng, Number(it.lat), Number(it.lng)) < OSM_DUP_M[type];
    if (knownRefs.has(ref) || known.some(near) || accepted.some(near)) { st.duplicate++; return; }
    const name = sanitizeSheetText(raw.name, 150) || constants.networkConfig[type].label;
    const size = clamp(Math.round(Number(raw.size) || 0), 0, 1e7);
    const item = { type, name, ward, lat: pt.lat, lng: pt.lng, size, ref };
    item.radius = constants.standardRadius(item, constants.wardProfile(ward));
    accepted.push(item);
    st.accepted++;
  });
  return { accepted, stats };
}

/** Công trình cùng loại đã duyệt (toàn TP, kể cả phường bên cạnh) có buffer chạm tới buffer ứng viên */
function nearbySameType(approvedAll, code, lat, lng, radius) {
  return approvedAll.filter(it => metricCode(it) === code
    && distMeters(lat, lng, Number(it.lat), Number(it.lng)) <= radius + (Number(it.radius) || radius));
}

/** Buffer ứng viên ∩ phường, và phần còn trống = (buffer − hợp các buffer cùng loại) ∩ phường */
function candidateGeometries(ee, { lat, lng, radius, existing, ward }, wardGeom = ee.Geometry(ward.geometry)) {
  const buffer = ee.Geometry.Point([lng, lat]).buffer(radius);
  const covered = existing.length > 0
    ? ee.FeatureCollection(existing.map(it =>
      ee.Feature(ee.Geometry.Point([Number(it.lng), Number(it.lat)]).buffer(Number(it.radius) || radius))
    )).geometry()
    : null;
  const net = covered ? buffer.difference(covered, 1) : buffer;
  return { bufferInWard: buffer.intersection(wardGeom, 1), net: net.intersection(wardGeom, 1) };
}

/**
 * Đếm pixel dân cư của nhiều vùng trong 1 lần gọi GEE: [{ key, geometry }] → { key: số pixel }.
 * popRasterNative giữ phép chiếu gốc nên không truyền scale: GEE đếm đúng từng ô của raster gốc.
 */
async function countPopPixels(ee, popRasterNative, regions) {
  if (!regions.length) return {};
  const fc = ee.FeatureCollection(regions.map(r => ee.Feature(r.geometry, { k: r.key })));
  const reduced = popRasterNative.reduceRegions({
    collection: fc, reducer: ee.Reducer.count(), tileScale: 4
  }).map(f => ee.Feature(null, { k: f.get('k'), n: f.get('count') }));
  const res = (await eeEvaluate(reduced)) || {};
  const out = {};
  (res.features || []).forEach(f => {
    const p = f.properties || {};
    out[p.k] = Number(p.n) || 0;
  });
  return out;
}

/** Ngữ cảnh chỉ tiêu của phường: dân số quy hoạch + diện tích hiện có theo nhóm (giống cột quy mô của bảng phường) */
function buildWardContext(wardFeat, approvedItemsInWard) {
  const pop = wardFeat.pop || 10000;
  const projPop = Math.round(pop * constants.POP_GROWTH);
  const profile = constants.wardProfile(wardFeat.name);
  const { urbanResults, unitResults } = bucketWardInfra(approvedItemsInWard, projPop, { withSubItems: false, profile });
  return { name: wardFeat.name, geometry: wardFeat.geometry, pop, projPop, profile, urbanResults, unitResults };
}

/**
 * Lọc 8 loại cho 1 khu đất: (1) bỏ loại có DT tối thiểu lớn hơn khu đất, (2) bỏ loại phường đã đủ 100% quy mô.
 * Loại còn lại thành ứng viên chờ đếm pixel dân cư bổ sung (fillCoverageGains).
 */
function csdSuggestionCandidates(csd, ward, approvedAll) {
  const size = Number(csd.size || 0);
  const suggestions = [];
  const candidates = [];
  CODES.forEach(code => {
    const cfg = constants.infraConfig[code] || {};
    const label = cfg.label || code;
    const minSize = cfg.minSize || 0;
    if (size < minSize) {
      suggestions.push({ code, label, minSize, status: 'ineligible' });
      return;
    }
    const reqArea = Math.round(ward.projPop * constants.quotaFor(code, ward.profile));
    const existArea = codeCurrentArea(code, ward.urbanResults, ward.unitResults);
    if (reqArea <= 0 || existArea >= reqArea) {
      suggestions.push({ code, label, status: 'fulfilled' });
      return;
    }
    const radius = csdCandidateRadius(csd, code, ward.profile);
    const existing = nearbySameType(approvedAll, code, csd.lat, csd.lng, radius);
    const deficitArea = reqArea - existArea;
    const s = {
      code, label, status: 'eligible',
      ...capacityByQuota({ type: code }, size, ward.profile),
      reqArea,
      existArea: Math.round(existArea),
      deficitArea: Math.round(deficitArea),
      isWardDeficit: true,
      currentScalePct: round1(clamp((existArea / reqArea) * 100, 0, 100)),
      // Chỉ phần diện tích lấp vào chỗ thiếu mới tính là bổ sung quy mô (khu đất lớn hơn phần thiếu không cộng thêm)
      scaleAddPct: round1(clamp((Math.min(size, deficitArea) / reqArea) * 100, 0, 100)),
      radiusUsed: radius,
      existingCount: existing.length,
      coverageAddPct: 0
    };
    suggestions.push(s);
    candidates.push({ lat: csd.lat, lng: csd.lng, radius, existing, ward, target: s });
  });
  return { suggestions, candidates };
}

/** Cơ sở chọn công năng: mở rộng độ phủ (phục vụ thêm dân chưa có công trình) hay bù thiếu quy mô của phường */
function csdBasis(coverageAddPct) {
  return coverageAddPct >= CSD_MIN_COVERAGE_PCT ? 'coverage' : 'scale';
}

/**
 * Xếp ưu tiên: loại tăng được độ phủ đứng trước (% độ phủ giảm dần, bằng nhau theo % quy mô bổ sung);
 * loại không tăng độ phủ (khu đất đã nằm trong phạm vi công trình cùng loại) xét theo bảng chỉ tiêu của phường:
 * loại có tỷ lệ đạt quy mô thấp nhất trước, bằng nhau thì loại khu đất bù được nhiều hơn.
 */
function rankEligible(suggestions) {
  const eligible = suggestions.filter(s => s.status === 'eligible');
  eligible.forEach(s => { s.basis = csdBasis(s.coverageAddPct); });
  eligible.sort((a, b) => {
    if (a.basis !== b.basis) return a.basis === 'coverage' ? -1 : 1;
    if (a.basis === 'coverage') return (b.coverageAddPct - a.coverageAddPct) || (b.scaleAddPct - a.scaleAddPct);
    return (a.currentScalePct - b.currentScalePct) || (b.scaleAddPct - a.scaleAddPct);
  });
  if (eligible.length > 0) eligible[0].isTopPriority = true;
  return eligible;
}

/**
 * Đếm pixel dân cư mới được phục vụ cho mọi ứng viên trong 1 lần gọi GEE, quy đổi % theo tổng pixel dân cư của phường.
 * GEE lỗi / quá hạn (timeoutMs, ≤ 0 = bỏ qua GEE) → ước lượng hình học (coverageMethod = 'estimate'); quá deadline thì
 * ứng viên còn lại để độ phủ 0 cho kịp trả kết quả. Trả về true nếu mọi ứng viên đếm được bằng pixel.
 */
async function fillCoverageGains(ee, popRaster, candidates, timeoutMs = 30000, { deadline = Infinity, timing = null } = {}) {
  if (!candidates.length) return true;
  const t0 = Date.now();
  // Mỗi phường 1 đối tượng ee.Geometry: bộ mã hóa EE chỉ gộp trùng theo đối tượng, tạo mới cho từng ứng viên
  // làm yêu cầu chép lại ranh phường hàng nghìn lần
  const eeWards = new Map();
  const wardGeomOf = (ward) => {
    if (!eeWards.has(ward.name)) eeWards.set(ward.name, ee.Geometry(ward.geometry));
    return eeWards.get(ward.name);
  };
  const regions = candidates.map((c, i) => ({ key: `c${i}`, geometry: candidateGeometries(ee, c, wardGeomOf(c.ward)).net }));
  const uncounted = new Map();
  candidates.forEach(c => {
    if (!wardPopPixelCache.has(c.ward.name)) uncounted.set(c.ward.name, c.ward);
  });
  const wardKeys = [...uncounted.keys()];
  wardKeys.forEach((name, i) => regions.push({ key: `w${i}`, geometry: wardGeomOf(uncounted.get(name)) }));

  let counts = null;
  try {
    if (timeoutMs > 0) counts = await withTimeout(countPopPixels(ee, popRaster, regions), timeoutMs, null);
  } catch (e) {
    console.warn("fillCoverageGains: GEE lỗi, dùng ước lượng hình học:", e.message);
  }
  if (counts) wardKeys.forEach((name, i) => wardPopPixelCache.set(name, counts[`w${i}`] || 0));
  if (timing) timing.gee = Date.now() - t0;

  const wardAreas = new Map();
  const wardAreaOf = (ward) => {
    if (!wardAreas.has(ward.name)) wardAreas.set(ward.name, geoJsonAreaM2(ward.geometry));
    return wardAreas.get(ward.name);
  };
  let allPixel = true;
  let skipped = 0;
  candidates.forEach((c, i) => {
    const wardTotal = counts ? (wardPopPixelCache.get(c.ward.name) || 0) : 0;
    const capacity = c.target.capacity ?? null;
    if (counts && wardTotal > 0) {
      const gained = counts[`c${i}`] || 0;
      // Dân chưa được phục vụ trong bán kính, chỉ tính phần diện tích khu đất đáp ứng được theo chỉ tiêu m²/người
      const reach = gained * (c.ward.pop / wardTotal);
      const added = capByCapacity(reach, capacity);
      Object.assign(c.target, {
        popGained: gained,
        wardPopPixels: wardTotal,
        popReach: Math.round(reach),
        popAdded: Math.round(added),
        capacityLimited: added < reach,
        coverageAddPct: c.ward.pop > 0 ? round1(clamp((added / c.ward.pop) * 100, 0, 100)) : 0,
        coverageMethod: 'pixel'
      });
    } else if (Date.now() > deadline) {
      allPixel = false;
      skipped++;
      Object.assign(c.target, { popGained: null, capacityLimited: false, coverageAddPct: 0, coverageMethod: 'estimate' });
    } else {
      allPixel = false;
      const est = estimateCoverageAddPct({
        lat: c.lat, lng: c.lng, radius: c.radius, wardGeometry: c.ward.geometry, wardArea: wardAreaOf(c.ward), existingSameType: c.existing
      });
      const capPct = capacity == null || !(c.ward.pop > 0) ? Infinity : (capacity / c.ward.pop) * 100;
      Object.assign(c.target, {
        popGained: null,
        capacityLimited: est > capPct,
        coverageAddPct: round1(Math.min(est, capPct)),
        coverageMethod: 'estimate'
      });
    }
  });
  if (timing) Object.assign(timing, { estimate: Date.now() - t0 - (timing.gee || 0), candidates: candidates.length, skipped });
  return allPixel;
}

let cachedEvaluatedWards = null;
let cachedEvaluatedWardsAt = 0;
// "lng,lat" -> tên phường; toạ độ công trình hầu như không đổi nên chỉ phải kiểm tra điểm-trong-đa-giác 1 lần
const wardAssignCache = new Map();

async function loadEvaluatedWards(wardVectorParsed) {
  const now = Date.now();
  if (cachedEvaluatedWards && (now - cachedEvaluatedWardsAt < constants.WARD_GEOMETRY_CACHE_TTL)) {
    return cachedEvaluatedWards;
  }
  const fc = await eeEvaluate(wardVectorParsed);
  const evaluatedWards = ((fc && fc.features) || []).map(f => {
    const props = f.properties || {};
    const geometry = normalizeWardGeometry(f.geometry);
    const name = props.tenXa || props.NAME_2 || props.name || 'Phường';
    const areaOfficial = Number(constants.WARD_AREA_KM2[String(name).normalize('NFC').trim()]);
    const areaAttr = Number(String(props.dienTich == null ? '' : props.dienTich).replace(',', '.'));
    return {
      name,
      pop: Number(props.danSoNum || props.danSo || 10000),
      // Diện tích (km²): bảng chính thức → thuộc tính dienTich của polygon → tính từ hình học
      areaKm2: areaOfficial > 0 ? areaOfficial : areaAttr > 0 ? areaAttr : Math.round(geoJsonAreaM2(geometry) / 1e4) / 100,
      geometry,
      bbox: geometryBBox(geometry)
    };
  });
  cachedEvaluatedWards = evaluatedWards;
  cachedEvaluatedWardsAt = now;
  wardAssignCache.clear();
  return evaluatedWards;
}

/** Cách duy nhất xác định công trình thuộc phường nào: theo tọa độ, không dùng cột phường của sheet. */
function assignWardByGeometry(ptLngRaw, ptLatRaw, evaluatedWards) {
  const ptLng = Number(ptLngRaw);
  const ptLat = Number(ptLatRaw);
  if (ptLngRaw == null || ptLatRaw == null || !Number.isFinite(ptLng) || !Number.isFinite(ptLat)) return null;
  const key = `${ptLng},${ptLat}`;
  if (wardAssignCache.has(key)) return wardAssignCache.get(key);

  let found = null;
  for (const w of evaluatedWards) {
    const b = w.bbox;
    if (b && (ptLng < b[0] || ptLng > b[2] || ptLat < b[1] || ptLat > b[3])) continue;
    if (w.geometry && checkPointInGeoJSONGeometry(ptLng, ptLat, w.geometry)) {
      found = w.name;
      break;
    }
  }
  if (wardAssignCache.size > 50000) wardAssignCache.clear();
  wardAssignCache.set(key, found);
  return found;
}

// Mỗi phiên bản dữ liệu / ranh giới chỉ gán lại bán kính 1 lần
let standardRadiusKey = null;

/** Bán kính mọi công trình theo quy chuẩn của phường/xã chứa công trình (theo tọa độ) — dùng chung cho vùng phủ, heatmap, độ phủ */
function applyStandardRadius(list, evaluatedWards) {
  const key = `${getDataVersion()}|${cachedEvaluatedWardsAt}|${list.length}`;
  if (key === standardRadiusKey) return;
  list.forEach(it => {
    const ward = assignWardByGeometry(it.lng, it.lat, evaluatedWards);
    it.radius = constants.standardRadius(it, constants.wardProfile(ward || it.ward));
  });
  standardRadiusKey = key;
}

function findWardByName(evaluatedWards, wardName) {
  const clean = constants.cleanWardStr(wardName);
  return evaluatedWards.find(w => w.name === wardName || constants.cleanWardStr(w.name) === clean) || null;
}

// ============================ ĐỐI CHIẾU TÊN PHƯỜNG SHEET ↔ TỌA ĐỘ ============================

// Dấu nhắc ghi vào cột Note (Apps Script dùng cùng tiền tố để thay / gỡ); tên phường dạng ngắn như cột Ten_XaPhuong
const WARD_NOTE_PREFIX = '⚠ Phường/xã theo tọa độ:';
const WARD_OUTSIDE_TEXT = 'ngoài ranh 40 phường/xã';
const wardKey = (s) => constants.cleanWardStr(String(s || '').normalize('NFC').replace(/^\s*Thị trấn\s+/i, ''));
const shortWard = (s) => String(s || '').replace(/^\s*(Phường|Xã|Thị trấn)\s+/i, '').trim();

/**
 * Công trình có Ten_XaPhuong (Sheet) khác phường theo tọa độ → [{ id, sheetWard, coordWard, note }].
 * note = nội dung dấu nhắc cần có trong cột Note; noteOk = Note đã có đúng dấu đó.
 */
function findWardMismatches(items, evaluatedWards) {
  const out = [];
  items.forEach(it => {
    if (!it.id) return;
    const coord = assignWardByGeometry(it.lng, it.lat, evaluatedWards);
    if (coord && wardKey(coord) === wardKey(it.ward)) return;
    const note = `${WARD_NOTE_PREFIX} ${coord ? shortWard(coord) : WARD_OUTSIDE_TEXT}`;
    out.push({ id: it.id, name: it.name, sheetWard: it.ward || '', coordWard: coord, note, noteOk: String(it.note || '').includes(note) });
  });
  return out;
}

// ============================ PHÂN LOẠI & CHỈ TIÊU ============================

// Kịch bản quy hoạch: công trình có QuyMo_QH (bỏ di dời / không thể hiện), diện tích theo QuyMo_QH;
// cây xanh đổi hạng (bán kính) theo diện tích quy hoạch
function getPlanScenarioItems(allDataList) {
  return allDataList
    .filter(it => it.planChange !== 'relocate' && it.planChange !== 'none')
    .map(it => {
      const plan = { ...it, size: it.sizeQH ?? it.size };
      if (constants.resolveTypeCode(plan) === '1-CV') plan.radius = constants.parkTier(plan).radius;
      return plan;
    });
}

// Mã dùng để tính quy mô / độ phủ: THPT tách riêng khỏi 4-TH
function metricCode(item) {
  return constants.isThptItem(item) ? 'THPT' : constants.resolveTypeCode(item);
}

// Nhóm chỉ tiêu (khóa trong urbanInfraConfig / unitInfraConfig) của 1 công trình
function levelKeyOf(item) {
  if (constants.isThptItem(item)) return 'THPT';
  const keys = constants.CODE_LEVEL_KEYS[constants.resolveTypeCode(item)];
  if (!keys) return null;
  if (keys.length === 1) return keys[0];
  return constants.isUrbanLevel(item) ? keys[0] : keys[1];
}

function slimItem(item, profile) {
  const slim = {
    id: item.id, name: item.name, type: item.type,
    lat: item.lat, lng: item.lng,
    size: item.size, radius: item.radius, status: item.status
  };
  const rule = constants.minSizeRuleFor(item, constants.resolveTypeCode(item), profile);
  if (rule) {
    slim.minSize = rule.min;
    slim.minSizeRef = rule.ref;
  }
  return slim;
}

// Lô vắt ranh đã tách (item.wardParts, gcsService): bản chính tính phần diện tích còn lại cho phường chứa tọa độ lô,
// mỗi mảnh phường phụ là bản areaOnly đặt tại mảnh (chỉ cộng diện tích, không thêm vào danh sách / số công trình).
// partKey: 'sizeHT' (hiện trạng) / 'sizeQH' (quy hoạch)
function wardShareItems(item, partKey) {
  const parts = (item.wardParts || []).map(pt => ({ pt, size: Number(pt[partKey]) || 0 })).filter(x => x.size > 0);
  if (!parts.length) return [item];
  const rest = Math.max(0, (Number(item.size) || 0) - parts.reduce((s, x) => s + x.size, 0));
  return [{ ...item, wardArea: rest }, ...parts.map(x => ({ ...item, lat: x.pt.lat, lng: x.pt.lng, wardArea: x.size, areaOnly: true }))];
}

// Gom diện tích công trình đã duyệt vào các nhóm chỉ tiêu cấp đô thị / cấp đơn vị ở (chỉ tiêu theo hồ sơ phường/xã)
function bucketWardInfra(items, projPop, { withSubItems = true, profile = 'DT' } = {}) {
  const makeBucket = (key, cfg) => {
    const quota = constants.baseQuota(key, profile);
    return {
      label: cfg.label,
      quota,
      currentArea: 0,
      requiredArea: (quota || 0) * projPop,
      subItems: [],
      status: false
    };
  };
  const urbanResults = {};
  for (const key in constants.urbanInfraConfig) {
    urbanResults[key] = makeBucket(key, constants.urbanInfraConfig[key]);
  }
  const unitResults = {};
  for (const key in constants.unitInfraConfig) {
    unitResults[key] = makeBucket(key, constants.unitInfraConfig[key]);
  }

  items.forEach(item => {
    if (!isApprovedStatus(item.status)) return;
    const key = levelKeyOf(item);
    const bucket = key && (urbanResults[key] || unitResults[key]);
    if (!bucket) return;
    bucket.currentArea += Number(item.wardArea ?? item.size ?? 0);
    if (withSubItems && !item.areaOnly) bucket.subItems.push(slimItem(item, profile));
  });

  for (const key in constants.unitInfraConfig) {
    const sumOf = constants.unitInfraConfig[key].sumOf;
    if (sumOf) unitResults[key].currentArea = sumOf.reduce((s, k) => s + (unitResults[k] ? unitResults[k].currentArea : 0), 0);
  }

  return { urbanResults, unitResults };
}

// Tổng diện tích hiện có của 1 mã = cộng mọi nhóm chỉ tiêu (cấp đô thị + cấp đơn vị ở)
function codeCurrentArea(code, urbanResults, unitResults) {
  return (constants.CODE_LEVEL_KEYS[code] || []).reduce((s, k) => {
    const node = urbanResults[k] || unitResults[k];
    return s + (node ? node.currentArea : 0);
  }, 0);
}

// Tỷ lệ quy mô (%) của 8 mã hạ tầng so với chỉ tiêu tổng theo hồ sơ phường/xã, chặn trong 0–100; null = mã không có chỉ tiêu
function scaleByCode(urbanResults, unitResults, projPop, profile = 'DT') {
  const scales = {};
  CODES.forEach(c => {
    const required = constants.quotaFor(c, profile) * projPop;
    const current = codeCurrentArea(c, urbanResults, unitResults);
    scales[c] = required > 0 ? round1(clamp((current / required) * 100, 0, 100)) : null;
  });
  return scales;
}

// Bình quân quy mô trên các mã có chỉ tiêu
function avgScale(scales) {
  const vals = CODES.map(c => scales[c]).filter(v => v != null);
  return vals.length ? Number((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1)) : 0;
}

// Công trình tham gia tính độ phủ (đã duyệt, thuộc 8 mã — THPT mang mã 4-TH nên cũng nằm trong đây)
function isCoverageItem(it) {
  return isApprovedStatus(it.status) && it.lat != null && it.lng != null
    && CODES.includes(constants.resolveTypeCode(it));
}

function coverageItemsInWard(list, wardName, evaluatedWards) {
  return list.filter(it => isCoverageItem(it) && assignWardByGeometry(it.lng, it.lat, evaluatedWards) === wardName);
}

// Chữ ký dữ liệu đầu vào độ phủ: đổi khi thêm/bớt/duyệt/dời công trình, đổi bán kính hoặc Admin hiệu chỉnh pixel dân cư
function coverageSignature(items) {
  const parts = items.map(it => [
    it.id, it.lat, it.lng, it.radius, constants.resolveTypeCode(it),
    constants.isUrbanLevel(it) ? 1 : 0, constants.isThptItem(it) ? 1 : 0
  ].join('|')).sort();
  const popVersion = getPopEditsVersion();
  const head = `v${COVERAGE_ALGO_VERSION}${popVersion > 0 ? `p${popVersion}` : ''}`;
  return crypto.createHash('md5').update(`${head}#${parts.join(';')}`).digest('hex').slice(0, 12);
}

function bandKeyForCode(code) {
  return `cov_${String(code).replace(/-/g, '_')}`;
}

function readPixProp(props, key) {
  if (!props || key == null) return 0;
  const direct = props[key];
  if (direct != null && direct !== '') {
    const n = Number(direct);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  // EE đôi khi đổi dấu '-' thành '_'
  const altKey = String(key).replace(/-/g, '_');
  if (altKey !== key && props[altKey] != null && props[altKey] !== '') {
    const n2 = Number(props[altKey]);
    if (!Number.isNaN(n2) && n2 >= 0) return n2;
  }
  return 0;
}

function withTimeout(promise, ms, onTimeoutValue) {
  let timer = null;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(onTimeoutValue), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Độ phủ 1 phường: 8 loại + tách đô thị/đơn vị ở (tránh ghi đè DT vs DV).
 */
async function computeSingleWardCoverage(ee, popRasterNormalized, wardGeometry, itemsInWard) {
  const levelSplitCodes = ["1-CV", "2-BDX", "7-YT", "8-VH", "9-TM"];
  const ratios = {};
  CODES.forEach(c => { ratios[c] = 0; });
  levelSplitCodes.forEach(c => {
    ratios[`${c}_DT`] = 0;
    ratios[`${c}_DV`] = 0;
  });
  ratios.THPT = 0;

  if (!popRasterNormalized || !wardGeometry) {
    return { ratios, Avg_Coverage_Score: 0 };
  }

  const isUrbanItem = (it) => constants.isUrbanLevel(it);
  const isThptItem = (it) => constants.isThptItem(it);

  const wardGeom = ee.Geometry(wardGeometry);
  const emptyMask = ee.Image.constant(0).selfMask();
  const bandImages = [popRasterNormalized.rename('pix_total')];

  const pushBufferBand = (bandName, matchingItems, defaultRadius) => {
    if (!matchingItems || matchingItems.length === 0) {
      bandImages.push(popRasterNormalized.updateMask(emptyMask).rename(bandName));
      return;
    }
    const bufferFc = ee.FeatureCollection(matchingItems.map(it => {
      const effectiveR = Number(it.radius) || Number(it.banKinh) || defaultRadius || 500;
      return ee.Feature(ee.Geometry.Point([Number(it.lng), Number(it.lat)]).buffer(effectiveR));
    }));
    const bufferMask = ee.Image(0).byte().paint({ featureCollection: bufferFc, color: 1 }).gt(0);
    bandImages.push(popRasterNormalized.updateMask(bufferMask).rename(bandName));
  };

  const approved = (itemsInWard || []).filter(it =>
    isApprovedStatus(it.status) && it.lat != null && it.lng != null
  );

  // THPT có band riêng (cov_THPT), không tính vào độ phủ Tiểu học — khớp với cách tính quy mô
  const itemsOfType = (code) => approved.filter(it => metricCode(it) === code);

  CODES.forEach(c => {
    const defaultR = (constants.infraConfig && constants.infraConfig[c] && constants.infraConfig[c].radius) || 500;
    pushBufferBand(bandKeyForCode(c), itemsOfType(c), defaultR);
  });

  levelSplitCodes.forEach(c => {
    const urbanKey = constants.CODE_LEVEL_KEYS[c][0];
    const urbanDefault = (constants.urbanInfraConfig[urbanKey] && constants.urbanInfraConfig[urbanKey].radius) || 2000;
    const unitR = (constants.infraConfig && constants.infraConfig[c] && constants.infraConfig[c].radius) || 500;
    const ofType = itemsOfType(c);
    pushBufferBand(`${bandKeyForCode(c)}_DT`, ofType.filter(isUrbanItem), urbanDefault);
    pushBufferBand(`${bandKeyForCode(c)}_DV`, ofType.filter(it => !isUrbanItem(it)), unitR);
  });

  const thptDefaultR = (constants.urbanInfraConfig && constants.urbanInfraConfig.THPT && constants.urbanInfraConfig.THPT.radius) || 2000;
  pushBufferBand('cov_THPT', approved.filter(isThptItem), thptDefaultR);

  const stacked = ee.Image.cat(bandImages);
  const dict = stacked.reduceRegion({
    reducer: ee.Reducer.count(),
    geometry: wardGeom,
    scale: POP_SCALE_M,
    maxPixels: 1e9,
    tileScale: 4
  });

  const evalResult = (await eeEvaluate(dict)) || {};

  const totalPix = readPixProp(evalResult, 'pix_total');
  const pctFromBand = (bandName) => {
    const servedPix = readPixProp(evalResult, bandName);
    return totalPix > 0
      ? Number(Math.min(100, Math.max(0, (servedPix / totalPix) * 100)).toFixed(1))
      : 0;
  };

  let sum = 0;
  CODES.forEach(c => {
    ratios[c] = pctFromBand(bandKeyForCode(c));
    sum += ratios[c];
  });
  levelSplitCodes.forEach(c => {
    ratios[`${c}_DT`] = pctFromBand(`${bandKeyForCode(c)}_DT`);
    ratios[`${c}_DV`] = pctFromBand(`${bandKeyForCode(c)}_DV`);
  });
  ratios.THPT = pctFromBand('cov_THPT');

  return {
    ratios,
    Avg_Coverage_Score: Number((sum / (CODES.length || 1)).toFixed(1)),
    coverageSchema: COVERAGE_ALGO_VERSION,
    _debugCounts: {
      approved: approved.length,
      byType: Object.fromEntries(CODES.map(c => [c, itemsOfType(c).length])),
      byTypeDT: Object.fromEntries(levelSplitCodes.map(c => [c, itemsOfType(c).filter(isUrbanItem).length])),
      byTypeDV: Object.fromEntries(levelSplitCodes.map(c => [c, itemsOfType(c).filter(it => !isUrbanItem(it)).length])),
      thpt: approved.filter(isThptItem).length,
      totalPix
    }
  };
}

// Gắn độ phủ đã tính (nếu chữ ký dữ liệu còn khớp) vào 1 dòng thống kê phường
function applyCachedCoverage(row) {
  const hit = cachedCoverageByWard[`HT:${row.Ten_Phuong}`];
  const ready = !!hit && hit.sig === row.covSig;
  CODES.forEach(c => { row[`Ratio_${c}`] = ready ? Number(hit.ratios[c] || 0) : 0; });
  row.ratios = ready ? { ...hit.ratios } : {};
  row.Avg_Coverage_Score = ready ? hit.Avg_Coverage_Score : 0;
  row._coverageReady = ready;
}

// Nhóm điểm heatmap client gửi lên: { groups: { "1-CV": [[lat, lng, radius], ...], ... } }
function parseHeatmapGroups(body) {
  const out = {};
  let total = 0;
  const groups = body.groups && typeof body.groups === 'object' ? body.groups : {};
  CODES.forEach(code => {
    const list = Array.isArray(groups[code]) ? groups[code] : [];
    out[code] = [];
    for (const p of list) {
      if (total >= constants.MAX_HEATMAP_POINTS) break;
      if (!Array.isArray(p)) continue;
      const lat = Number(p[0]), lng = Number(p[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
      out[code].push({ lat, lng, radius: parseRadius(p[2]) });
      total++;
    }
  });
  return out;
}

// ============================ HANDLER ============================

module.exports = async (req, res) => {
  const startedAt = Date.now();
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const action = String(req.query.action || 'getInitData');

    // --- Thao tác không cần Earth Engine ---
    if (action === 'verifyAdmin') {
      requirePostFromApp(req);
      const user = await requireAdmin(req);
      return res.status(200).json({ admin: true, email: user.email, name: user.name, exp: user.exp });
    }

    if (action === 'approvePoint') {
      requirePostFromApp(req);
      await requireAdmin(req);
      const id = String(readJsonBody(req).id || '').trim();
      if (!/^[A-Za-z0-9_\-]{1,40}$/.test(id)) {
        return res.status(400).json({ error: true, message: "Mã công trình không hợp lệ" });
      }
      const result = await callAppsScript({ action: 'approvePoint', id });
      invalidateAllCaches();
      return res.status(200).json({ success: true, id: result.id || id });
    }

    if (action === 'getCadParcels') {
      const parcels = await getCadParcels();
      return res.status(200).json({ parcels });
    }

    if (action === 'getProjectIndex') {
      const cat = await projects.catalog();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ v: 1, base: cat.base, migrated: cat.migrated, projects: cat.projects });
    }

    if (action === 'getProjectLots') {
      const slug = String(req.query.slug || '');
      const project = String(req.query.project || '');
      const data = slug ? await projects.lotsBySlug(slug) : await projects.legacyLots(project);
      if (!data) return res.status(404).json({ error: true, message: 'Không có file đồ án này' });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(data);
    }

    if (action === 'getWardParcels') {
      const ward = await projects.wardParcels();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(ward);
    }

    // Bucket không mở CORS cho trình duyệt → chuyển tiếp nguyên văn bản TopoJSON (~1 MB), cache biên Vercel 1 giờ
    if (action === 'getDrainage') {
      const d = await getDrainage();
      if (!d || !d.text) {
        return res.status(404).json({ error: true, message: 'Chưa có lớp thoát nước trên bucket — chạy node scripts/push-thoatnuoc.js' });
      }
      res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400');
      if (d.etag) {
        res.setHeader('ETag', d.etag);
        if (req.headers['if-none-match'] === d.etag) return res.status(304).end();
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(200).send(d.text);
    }

    // Đường trục chính rút gọn cả thành phố (mức phóng còn thấy một lúc nhiều phường, trên mức một biểu đồ tròn)
    if (action === 'getMainRoads') {
      const cv = Math.max(0, Math.round(Number(req.query.cv) || 0));
      let lines = null;
      try {
        lines = await roads.mainRoadLines(cv);
      } catch (err) {
        console.warn('Đọc đường trục chính lỗi:', err.message);
      }
      if (!lines) return res.status(404).json({ error: true, message: 'Chưa có đường trục chính mức toàn thành phố' });
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400');
      return res.status(200).json({ v: 1, lines });
    }

    // Mạng lưới đường toàn thành phố (Admin tải từ OSM theo phường, lưu bucket roads/v2/ qua Apps Script)
    // "Phạm vi thực tế": cắt đường quanh công trình từ mạng lưới đã lưu; chưa tải đủ → 404, trình duyệt tự hỏi Overpass
    if (action === 'getRoads') {
      const pt = parseCoordInBounds(req.query.lat, req.query.lng);
      if (!pt) return res.status(400).json({ error: true, message: "Tọa độ không hợp lệ" });
      const r = roads.roadsRadius(parseRadius(req.query.r));
      if (r > roads.ROADS_MAX_RADIUS) return res.status(404).json({ error: true, message: 'Bán kính quá lớn — trình duyệt tự tải' });
      const cv = Math.max(0, Math.round(Number(req.query.cv) || 0));
      let ways = null;
      try {
        ways = await roads.waysAround(pt.lat, pt.lng, r, cv);
      } catch (err) {
        console.warn('Đọc mạng lưới đường lỗi:', err.message);
      }
      if (!ways) return res.status(404).json({ error: true, message: 'Chưa có mạng lưới đường lưu sẵn' });
      // Bản lưu cũ chưa có nhóm vẽ: cache ngắn để Admin tải lại mạng lưới là có màu theo nhóm ngay
      const legacy = ways.some(w => w.length < 4);
      res.setHeader('Cache-Control', legacy
        ? 'public, max-age=600, s-maxage=600'
        : 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
      return res.status(200).json({ v: 2, r, ways, source: 'network' });
    }

    // Chiều dài đường trục chính / kiệt theo phường (tính lúc Admin tải mạng lưới, lưu trong index)
    // custom: phiên bản + chiều dài theo phường của tuyến Admin vẽ bổ sung (client cộng thêm vào index)
    if (action === 'getWardRoads') {
      const fresh = req.query.fresh === '1';
      const index = await roads.readRoadsIndex(fresh);
      let custom = null;
      try {
        const c = await roads.readCustomRoads(0, fresh);
        custom = { saved: c.saved, count: c.roads.length, extra: roads.customExtra(c) };
      } catch (err) {
        console.warn('Đọc tuyến đường bổ sung lỗi:', err.message);
      }
      res.setHeader('Cache-Control', fresh || !custom ? 'no-store' : 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400');
      return res.status(200).json({ v: 2, total: (index && index.total) || 0, wards: (index && index.wards) || {}, custom });
    }

    // 1 phần mạng lưới đường đã lưu của 1 phường (bucket không mở CORS cho trình duyệt) — Admin tách chiều dài theo nhóm vẽ
    if (action === 'getRoadPart') {
      const index = await roads.readRoadsIndex();
      const ward = String(req.query.ward || '').trim();
      const part = Math.round(Number(req.query.part));
      const entry = index && Object.prototype.hasOwnProperty.call(index.wards, ward) ? index.wards[ward] : null;
      if (!entry || !(part >= 0 && part < entry.parts)) return res.status(404).json({ error: true, message: 'Không có phần mạng lưới đường này' });
      const ways = await roads.readPart(ward, part, entry.at);
      res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
      return res.status(200).json({ v: 2, ward, part, at: entry.at, ways });
    }

    // Danh sách tuyến bổ sung đầy đủ (màn hình Admin vẽ / xóa tuyến)
    if (action === 'getCustomRoads') {
      const c = await roads.readCustomRoads(0, true);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ v: 2, saved: c.saved, roads: c.roads });
    }

    // Ghi đè toàn bộ danh sách tuyến bổ sung; base = phiên bản client đang sửa (khác bản trên bucket → 409, tránh 2 tab ghi đè nhau)
    if (action === 'saveCustomRoads') {
      requirePostFromApp(req);
      await requireAdmin(req);
      const body = readJsonBody(req);
      const list = roads.parseCustomRoads(body.roads);
      if (!list) return res.status(400).json({ error: true, message: 'Dữ liệu tuyến đường bổ sung không hợp lệ' });
      const current = await roads.readCustomRoads(0, true);
      if (Math.round(Number(body.base) || 0) !== current.saved) {
        return res.status(409).json({ error: true, message: 'Danh sách tuyến bổ sung vừa được sửa ở phiên khác — mở lại chế độ vẽ để tải bản mới' });
      }
      const payload = { v: 2, saved: Date.now(), roads: list };
      const content = JSON.stringify(payload);
      if (content.length > roads.MAX_PART_CHARS) return res.status(413).json({ error: true, message: 'Danh sách tuyến bổ sung quá lớn' });
      const result = await callAppsScript({ action: 'saveRoads' }, { action: 'saveRoads', key: 'custom', content });
      if (result.saved !== true) {
        return res.status(502).json({ error: true, message: 'Apps Script chưa ghi được lên bucket (đã triển khai phiên bản mới của Code.gs chưa?)' });
      }
      roads.rememberCustom(payload);
      return res.status(200).json({ success: true, saved: true, at: payload.saved, count: list.length });
    }

    // Vùng hiệu chỉnh raster dân cư (Admin vẽ xóa / thêm pixel dân cư) — đọc đầy đủ cho màn hình Admin
    if (action === 'getPopEdits') {
      const d = await popEdits.readPopEdits(true);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ v: 1, saved: d.saved, edits: d.edits, asset: d.asset, bake: d.bake });
    }

    // Ghi đè toàn bộ vùng hiệu chỉnh; base = phiên bản client đang sửa (khác bản trên bucket → 409)
    if (action === 'savePopEdits') {
      requirePostFromApp(req);
      await requireAdmin(req);
      const body = readJsonBody(req);
      const list = popEdits.parsePopEdits(body.edits);
      if (!list) return res.status(400).json({ error: true, message: 'Dữ liệu vùng hiệu chỉnh dân cư không hợp lệ' });
      const current = await popEdits.readPopEdits(true);
      if (current.bake) {
        return res.status(409).json({ error: true, message: 'Đang ghi cố định vào asset — chờ tác vụ GEE xong rồi sửa tiếp' });
      }
      if (Math.round(Number(body.base) || 0) !== current.saved) {
        return res.status(409).json({ error: true, message: 'Vùng hiệu chỉnh dân cư vừa được sửa ở phiên khác — mở lại panel để tải bản mới' });
      }
      const payload = popEdits.buildPayload({ saved: Date.now(), edits: list, asset: current.asset });
      await writePopEdits(payload);
      return res.status(200).json({ success: true, saved: true, at: payload.saved, count: list.length });
    }

    if (action === 'saveRoadNetwork') {
      requirePostFromApp(req);
      await requireAdmin(req);
      const body = readJsonBody(req);
      const ward = String(body.ward || '').trim();
      const part = Math.round(Number(body.part));
      const ways = roads.parseNetworkPart(body.ways);
      if (!roads.wardSlug(ward) || ward.length > 80 || !(part >= 0 && part < roads.MAX_PARTS) || !ways) {
        return res.status(400).json({ error: true, message: 'Dữ liệu mạng lưới đường không hợp lệ' });
      }
      const content = JSON.stringify({ v: 2, ward, part, ways });
      if (content.length > roads.MAX_PART_CHARS) return res.status(413).json({ error: true, message: 'Phần mạng lưới đường quá lớn' });
      const result = await callAppsScript({ action: 'saveRoads' }, { action: 'saveRoads', key: `net_${roads.wardSlug(ward)}_${part}`, content });
      if (result.saved !== true) {
        return res.status(502).json({ error: true, message: 'Apps Script chưa ghi được lên bucket (đã triển khai phiên bản mới của Code.gs chưa?)' });
      }
      return res.status(200).json({ success: true, saved: true, ways: ways.length });
    }

    if (action === 'saveWardRoads') {
      requirePostFromApp(req);
      await requireAdmin(req);
      const body = readJsonBody(req);
      const parsed = roads.parseRoadsIndex(body.wards, body.total);
      if (!parsed) return res.status(400).json({ error: true, message: 'Dữ liệu chỉ mục mạng lưới đường không hợp lệ' });
      const payload = { v: 2, saved: Date.now(), ...parsed };
      const result = await callAppsScript({ action: 'saveRoads' }, { action: 'saveRoads', key: 'index', content: JSON.stringify(payload) });
      if (result.saved !== true) {
        return res.status(502).json({ error: true, message: 'Apps Script chưa ghi được lên bucket (đã triển khai phiên bản mới của Code.gs chưa?)' });
      }
      roads.rememberIndex(payload);
      return res.status(200).json({ success: true, saved: true, count: Object.keys(parsed.wards).length });
    }

    if (action === 'importCadBatch') {
      requirePostFromApp(req);
      await requireAdmin(req);
      const body = readJsonBody(req);
      if (body.boundaryOnly) {
        const registry = parseCadRegistry(body.registry);
        const tenQH = sanitizeSheetText(body.tenQH, 120);
        if (!tenQH || !registry || !registry.boundary) {
          return res.status(400).json({ error: true, message: 'Thiếu tên đồ án hoặc ranh giới' });
        }
        try {
          const saved = await projects.patchBoundary({ tenQH, boundary: registry.boundary, boundarySource: 'gis' });
          invalidateAllCaches();
          return res.status(200).json({ success: true, boundaryOnly: true, slug: saved.slug, bucket: saved.via });
        } catch (err) {
          return res.status(err.status || 500).json({ error: true, message: err.message || 'Không cập nhật được ranh' });
        }
      }
      const rawItems = Array.isArray(body.items) ? body.items : [];
      const rawLands = Array.isArray(body.lands) ? body.lands : [];
      if (!(rawItems.length + rawLands.length) || rawItems.length + rawLands.length > CAD_BATCH_MAX) {
        return res.status(400).json({ error: true, message: `Mỗi lần gửi 1–${CAD_BATCH_MAX} lô` });
      }
      const phase = body.phase === 'QH' ? 'QH' : 'HT';
      const fileName = sanitizeSheetText(body.fileName, 120) || 'DXF';
      const tenQH = sanitizeSheetText(body.tenQH, 120) || projects.projectTitle(fileName);
      const landsReset = body.landsReset === 'HT' || body.landsReset === 'QH' ? body.landsReset : body.landsReset === true;
      const items = [];
      for (let i = 0; i < rawItems.length; i++) {
        const item = parseCadItem(rawItems[i], phase);
        if (!item) return res.status(400).json({ error: true, message: `Lô thứ ${i + 1} không hợp lệ (loại, tọa độ, phường, diện tích hoặc giai đoạn)` });
        items.push(item);
      }
      const lands = rawLands.map(parseLandItem).filter(Boolean);
      const sync = body.sync !== false;
      const registry = parseCadRegistry(body.registry);
      const sheetItems = items.map(sheetItem);
      let result = { created: [], updated: [], skipped: [], lotIds: [] };
      if (sheetItems.length || registry || sync) {
        const sheetReg = registry && !registry.keepBoundary
          ? { boundary: registry.boundary, wards: registry.wards, infra: registry.infra, lands: registry.lands }
          : null;
        result = await callAppsScript({ action: 'importCadBatch' }, {
          action: 'importCadBatch',
          phase,
          fileName,
          sync,
          syncCad: false,
          skipDxf: true,
          items: sheetItems,
          lands: [],
          landsReset: false,
          registry: sheetReg
        });
      }
      if (items.length && !Array.isArray(result.lotIds)) {
        return res.status(502).json({ error: true, message: 'Apps Script chưa trả mã lô (lotIds). Deploy Code.gs → New version, rồi bấm Ghi lại để ghi tiếp.' });
      }
      const saved = await projects.saveChunk({
        tenQH,
        fileName,
        items,
        lotIds: result.lotIds || [],
        lands,
        landsReset,
        infraReset: body.infraReset === true ? phase : null,
        registry
      });
      if (sync) invalidateAllCaches();
      return res.status(200).json({
        success: true,
        created: result.created || [],
        updated: result.updated || [],
        skipped: result.skipped || [],
        lands: lands.length,
        landsDropped: rawLands.length - lands.length,
        polygonsDropped: items.reduce((n, it) => n + it.stages.filter(s => !s.point && s.geometry && !sheetGeometry(s.geometry)).length, 0),
        slug: saved.slug,
        bucket: saved.via
      });
    }

    // Admin sửa 1 lô từ bảng thông tin: lô hạ tầng (INFRA) ghi dòng Sheet theo ID, lô đất khác (DXF) ghi file đồ án trên bucket
    if (action === 'editLot') {
      requirePostFromApp(req);
      await requireAdmin(req);
      const body = readJsonBody(req);
      const id = String(body.id || '').trim();
      if (!LOT_ID_RE.test(id)) return res.status(400).json({ error: true, message: 'Mã lô không hợp lệ' });
      const raw = body.fields && typeof body.fields === 'object' ? body.fields : {};
      if (body.kind === 'DXF') {
        const tenQH = sanitizeSheetText(body.tenQH, 120);
        const fields = parseLandEdit(raw);
        if (!tenQH || !fields) return res.status(400).json({ error: true, message: 'Thiếu đồ án hoặc thông tin cần sửa' });
        try {
          const saved = await projects.patchLand({ tenQH, id, phase: body.phase === 'QH' ? 'QH' : 'HT', fields });
          return res.status(200).json({ success: true, kind: 'DXF', id, saved: saved.saved, land: saved.land, bucket: saved.via });
        } catch (err) {
          return res.status(err.status || 500).json({ error: true, message: err.message || 'Không ghi được file đồ án' });
        }
      }
      const fields = parseInfraEdit(raw);
      if (!fields) return res.status(400).json({ error: true, message: 'Thông tin sửa không hợp lệ (tên trống hoặc quy mô không phải số ≥ 0)' });
      const result = await callAppsScript({ action: 'editInfraRow' }, { action: 'editInfraRow', id, fields });
      invalidateAllCaches();
      return res.status(200).json({ success: true, kind: 'INFRA', id, tab: result.tab || '' });
    }

    // Xóa toàn bộ 1 đồ án (Ten_QH): dòng hạ tầng, tab DXF-NN cũ, ranh lô, dòng DS_DoAn, file projects/<slug>.json
    if (action === 'deleteProject') {
      requirePostFromApp(req);
      await requireAdmin(req);
      const body = readJsonBody(req);
      const project = sanitizeSheetText(body.project, 120);
      if (!project) return res.status(400).json({ error: true, message: 'Thiếu tên đồ án' });
      const removed = await projects.deleteProjectFiles(project);
      const result = await callAppsScript({ action: 'deleteProject' }, { action: 'deleteProject', project, syncCad: false });
      invalidateAllCaches();
      return res.status(200).json({
        success: true,
        infra: Number(result.infra) || 0,
        restored: Number(result.restored) || 0,
        lands: Math.max(Number(result.lands) || 0, removed.landCount || 0),
        polygons: Number(result.polygons) || 0,
        slug: removed.slug
      });
    }

    if (action === 'migrateProjects') {
      requirePostFromApp(req);
      await requireAdmin(req);
      const body = readJsonBody(req);
      const page = await projects.migratePage(body.cursor);
      invalidateAllCaches();
      return res.status(200).json({ success: true, ...page });
    }

    // Người dùng chưa đăng nhập gửi file DXF / KML / GeoJSON ≤ 2 MB → hàng chờ trên bucket (pending/cad/, không ghi Sheet);
    // Admin mở lại file trong khung Nhập hàng loạt, kiểm tra rồi mới ghi
    if (action === 'submitCadPending') {
      requirePostFromApp(req);
      const body = readJsonBody(req);
      const ext = String(body.ext || '').toLowerCase();
      const content = typeof body.content === 'string' ? body.content : '';
      if (!PENDING_CAD_EXTS.includes(ext)) return res.status(400).json({ error: true, message: 'Chỉ nhận file .dxf, .kml / .kmz hoặc .geojson' });
      if (!content || Buffer.byteLength(content, 'utf8') > PENDING_CAD_MAX_BYTES) {
        return res.status(413).json({ error: true, message: 'File rỗng hoặc vượt quá 2 MB' });
      }
      if (!looksLikeCadFile(ext, content)) return res.status(400).json({ error: true, message: `Nội dung file không đúng định dạng ${ext.toUpperCase()}` });
      checkCadPendingRate(req);
      const meta = {
        id: crypto.randomBytes(12).toString('hex'),
        ext,
        fileName: sanitizeSheetText(body.fileName, 120) || `hoso.${ext}`,
        phase: body.phase === 'QH' ? 'QH' : 'HT',
        crs: /^[A-Z0-9_]{1,20}$/.test(String(body.crs || '')) ? String(body.crs) : '',
        sender: sanitizeSheetText(body.sender, 80),
        note: sanitizeSheetText(body.note, 300),
        summary: parsePendingSummary(body.summary)
      };
      if (body.kind === 'review' && ext === 'geojson') {
        meta.kind = 'review';
        meta.replaces = sanitizeSheetText(body.replaces, 120);
      }
      const result = await callAppsScript({ action: 'addPendingCad' }, { action: 'addPendingCad', meta, content });
      if (result.full) {
        return res.status(503).json({ error: true, message: 'Hàng chờ duyệt đang đầy — vui lòng thử lại sau hoặc liên hệ Sở Xây dựng' });
      }
      if (result.saved !== true) {
        return res.status(502).json({ error: true, message: 'Chưa lưu được hồ sơ (Apps Script chưa triển khai phiên bản mới của Code.gs?)' });
      }
      return res.status(200).json({ success: true, id: meta.id, count: result.count || 0 });
    }

    if (action === 'getCadPending') {
      requirePostFromApp(req);
      await requireAdmin(req);
      const index = await readPendingCadIndex();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ v: 1, saved: index.saved, items: index.items });
    }

    // Nội dung 1 file chờ duyệt (bucket không mở CORS cho trình duyệt) → text thô
    if (action === 'getCadPendingFile') {
      requirePostFromApp(req);
      await requireAdmin(req);
      const id = String(readJsonBody(req).id || '');
      const it = PENDING_CAD_ID.test(id) ? (await readPendingCadIndex()).items.find(x => x.id === id) : null;
      if (!it || !PENDING_CAD_EXTS.includes(it.ext)) return res.status(404).json({ error: true, message: 'Không có hồ sơ này trong hàng chờ' });
      const r = await axios.get(`${constants.PENDING_CAD_BASE}${it.id}.${it.ext}?v=${Date.now()}`, {
        timeout: 20000, responseType: 'text', transformResponse: x => x, validateStatus: () => true
      });
      if (r.status !== 200) return res.status(404).json({ error: true, message: 'File hồ sơ không còn trên bucket' });
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(String(r.data || ''));
    }

    if (action === 'removeCadPending') {
      requirePostFromApp(req);
      await requireAdmin(req);
      const id = String(readJsonBody(req).id || '');
      if (!PENDING_CAD_ID.test(id)) return res.status(400).json({ error: true, message: 'Mã hồ sơ không hợp lệ' });
      const result = await callAppsScript({ action: 'removePendingCad' }, { action: 'removePendingCad', id });
      if (result.success !== true) return res.status(502).json({ error: true, message: 'Apps Script chưa xóa được hồ sơ' });
      return res.status(200).json({ success: true, removed: !!result.removed, count: result.count || 0 });
    }

    if (action === 'getSingleIsochrone') {
      const pt = parseCoordInBounds(req.query.lat, req.query.lng);
      if (!pt) return res.status(400).json({ error: true, message: "Tọa độ không hợp lệ" });
      const banKinh = parseRadius(req.query.radius);
      const polyCoords = await calculateNetworkIsochrone16(pt.lat, pt.lng, banKinh);
      return res.status(200).json({
        type: 'Feature',
        geometry: polyCoords,
        properties: { banKinh }
      });
    }

    await initGEE();
    await syncPopEdits(Math.round(Number(req.query.pv) || 0));

    // Ghi cố định vùng hiệu chỉnh dân cư vào asset mới (tác vụ GEE chạy nền); trong lúc chạy vẫn tính theo asset cũ + vùng
    if (action === 'bakePopEdits') {
      requirePostFromApp(req);
      await requireAdmin(req);
      const body = readJsonBody(req);
      const current = await popEdits.readPopEdits(true);
      if (current.bake) return res.status(409).json({ error: true, message: 'Đang có tác vụ ghi cố định chạy — chờ xong' });
      if (Math.round(Number(body.base) || 0) !== current.saved) {
        return res.status(409).json({ error: true, message: 'Vùng hiệu chỉnh dân cư vừa được sửa ở phiên khác — mở lại panel để tải bản mới' });
      }
      if (!current.edits.length) return res.status(400).json({ error: true, message: 'Chưa có vùng hiệu chỉnh nào để ghi cố định' });
      if (getPopEditsVersion() !== current.saved) applyPopEdits(current.saved, current.edits, current.asset);
      const asset = popEdits.bakedAssetId();
      let task;
      try {
        task = await startPopBake(asset);
      } catch (err) {
        console.error('Ghi cố định asset dân cư lỗi:', err.message);
        return res.status(502).json({ error: true, message: `GEE không nhận tác vụ xuất asset (tài khoản dịch vụ cần quyền ghi asset trong dự án): ${err.message}` });
      }
      const bake = { task, asset, at: Date.now() };
      await writePopEdits(popEdits.buildPayload({ ...current, bake }));
      return res.status(200).json({ success: true, saved: true, bake });
    }

    // Trạng thái tác vụ ghi cố định; xong → asset mới làm nền, xóa danh sách vùng (đã nằm trong asset)
    if (action === 'popBakeStatus') {
      requirePostFromApp(req);
      await requireAdmin(req);
      const current = await popEdits.readPopEdits(true);
      if (!current.bake) return res.status(200).json({ success: true, saved: true, state: 'NONE', asset: current.asset, at: current.saved });
      const t = await getTaskState(current.bake.task);
      if (t.state === 'COMPLETED') {
        const payload = popEdits.buildPayload({ saved: Date.now(), edits: [], asset: current.bake.asset });
        await writePopEdits(payload);
        await syncPopEdits(payload.saved);
        return res.status(200).json({ success: true, saved: true, state: 'DONE', asset: payload.asset, at: payload.saved });
      }
      if (t.state === 'FAILED' || t.state === 'CANCELLED') {
        await writePopEdits(popEdits.buildPayload({ ...current, bake: null }));
        return res.status(200).json({ success: true, saved: true, state: t.state, error: t.error, asset: current.asset, at: current.saved });
      }
      return res.status(200).json({ success: true, saved: true, state: t.state, bake: current.bake, at: current.saved });
    }

    const { ee, wardVectorParsed, popRasterNormalized, popRasterNative, popProjection } = getGeeContext();

    // --- Thao tác cần Earth Engine nhưng không cần danh sách công trình ---
    if (action === 'addPoint') {
      requirePostFromApp(req);
      checkAddPointRate(req);
      const body = readJsonBody(req);
      const type = String(body.type || '');
      const name = sanitizeSheetText(body.name, 150);
      const isNetwork = constants.isNetworkCode(type);
      const nhomHaTang = isNetwork || body.nhomHaTang === 'Cấp đô thị' ? 'Cấp đô thị' : 'Cấp đơn vị ở';
      const phase = body.phase === 'QH' ? 'QH' : 'HT';
      const size = Number(body.size || 0);
      const pt = parseCoordInBounds(body.lat, body.lng);
      const noArea = isNetwork && !!constants.networkConfig[type].noArea;

      if (![...CODES, '6-THPT', '12-CSD', ...constants.NETWORK_CODES].includes(type)) return res.status(400).json({ error: true, message: "Loại hạ tầng không hợp lệ" });
      if (!name) return res.status(400).json({ error: true, message: "Thiếu tên công trình" });
      if (!pt) return res.status(400).json({ error: true, message: "Tọa độ không hợp lệ hoặc nằm ngoài TP. Huế" });
      if (!Number.isFinite(size) || size < 0 || size > 1e8) return res.status(400).json({ error: true, message: "Diện tích không hợp lệ" });
      if (phase === 'QH' && !(size > 0) && !noArea) return res.status(400).json({ error: true, message: "Điểm quy hoạch mới cần diện tích > 0" });

      const evaluatedWardsForAdd = await loadEvaluatedWards(wardVectorParsed);
      const geoWard = assignWardByGeometry(pt.lng, pt.lat, evaluatedWardsForAdd);
      if (!geoWard) return res.status(400).json({ error: true, message: "Vị trí nằm ngoài ranh giới 40 phường/xã" });
      const radius = qcvnRadius({ type, name, nhomHaTang, size }, geoWard);

      const result = await callAppsScript({
        action: 'addPoint',
        type,
        nhomHaTang,
        name,
        ward: geoWard,
        lat: pt.lat.toFixed(6),
        lng: pt.lng.toFixed(6),
        size: String(size),
        radius: radius ? String(radius) : '',
        phase
      });
      invalidateAllCaches();
      return res.status(200).json({ success: true, id: result.id || null, ward: geoWard, radius });
    }

    if (action === 'analyzePoint') {
      const isPost = req.method === 'POST';
      const src = isPost ? readJsonBody(req) : req.query;
      const pt = parseCoordInBounds(src.lat, src.lng);
      if (!pt) return res.status(400).json({ error: true, message: "Tọa độ không hợp lệ" });
      const radius = parseRadius(src.radius);
      const item = {
        id: String(src.id || '').slice(0, 50), name: String(src.name || '').slice(0, 200), type: String(src.type || '').slice(0, 20),
        nhomHaTang: String(src.nhomHaTang || '').slice(0, 40)
      };
      const size = clamp(Number(src.size) || 0, 0, 1e8);

      let polyCoords;
      if (isPost) {
        const ring = parseServiceRing(src.polygon, pt, radius);
        if (!ring) return res.status(400).json({ error: true, message: "Vùng phục vụ không hợp lệ" });
        polyCoords = { type: 'Polygon', coordinates: [ring] };
      } else {
        polyCoords = await calculateNetworkIsochrone16(pt.lat, pt.lng, radius);
      }
      // Không trọng số: mỗi pixel có dân đếm trọn như lúc chia dân số phường → cả phường cộng lại đúng bằng dân số phường
      const servedPopRes = await eeEvaluate(popRasterNormalized.reduceRegion({
        reducer: ee.Reducer.sum().unweighted(),
        geometry: ee.Geometry(polyCoords),
        scale: POP_SCALE_M,
        maxPixels: 1e9
      }));

      const reachPop = Math.round(servedPopRes ? servedPopRes.DanSoPixelNormalized || 0 : 0);
      // Dân số phục vụ không vượt quá số dân diện tích công trình đáp ứng theo chỉ tiêu m²/người (hồ sơ phường/xã chứa công trình)
      let cap = { quota: 0, capacity: null };
      if (item.type || item.id) {
        const wardName = assignWardByGeometry(pt.lng, pt.lat, await loadEvaluatedWards(wardVectorParsed));
        cap = capacityByQuota(item, size, constants.wardProfile(wardName || ''));
      }
      return res.status(200).json({ servedPop: capByCapacity(reachPop, cap.capacity), reachPop, ...cap });
    }

    if (action === 'getHeatmapTile') {
      if (req.method !== 'POST') return res.status(405).json({ error: true, message: "Phương thức không hợp lệ" });
      const groups = parseHeatmapGroups(readJsonBody(req));
      const categoryImageLayers = [];

      CODES.forEach(code => {
        const pts = groups[code];
        if (!pts.length) return;
        const fc = ee.FeatureCollection(pts.map(p => ee.Feature(ee.Geometry.Point([p.lng, p.lat]).buffer(p.radius))));
        categoryImageLayers.push(ee.Image(0).byte().paint({ featureCollection: fc, color: 1 }));
      });

      let heatmapMasked;
      if (categoryImageLayers.length > 0) {
        const summedCol = ee.ImageCollection(categoryImageLayers).sum();
        heatmapMasked = summedCol.updateMask(summedCol.gt(0));
      } else {
        heatmapMasked = ee.Image(0).clip(ee.Geometry.Point([107.5905, 16.4637]).buffer(100)).selfMask();
      }

      try {
        const mapId = await new Promise((resolve, reject) => {
          heatmapMasked.getMap(
            { min: 1, max: 8, palette: ['#5dade2', '#2ecc71', '#f1c40f', '#f39c12', '#e67e22', '#d35400', '#e74c3c', '#900c3f'] }, 
            (m, err) => err ? reject(err) : resolve(m)
          );
        });
        return res.status(200).json({ urlFormat: mapId.urlFormat });
      } catch (mapErr) {
        console.error("GEE GetMap Tile Error:", mapErr && mapErr.message);
        return res.status(502).json({ error: true, message: "Không tạo được heatmap từ GEE" });
      }
    }

    if (action === 'getWardFromPoint') {
      const pt = parseCoordInBounds(req.query.lat, req.query.lng);
      if (!pt) return res.status(200).json({ ward: null });
      const evaluatedWardsPt = await loadEvaluatedWards(wardVectorParsed);
      return res.status(200).json({ ward: assignWardByGeometry(pt.lng, pt.lat, evaluatedWardsPt) });
    }

    if (action === 'getPopRasterTile') {
      // pv: Admin vừa lưu vùng hiệu chỉnh → lấy ảnh mới ngay; người dùng khác nhận ảnh mới sau tối đa 5 phút
      res.setHeader('Cache-Control', req.query.pv ? 'no-store' : 's-maxage=300, stale-while-revalidate=300');
      const mapId = await new Promise((resolve, reject) => {
        popRasterNormalized.getMap(
          { min: 0, max: 5, palette: ['blue', 'cyan', 'green', 'yellow', 'orange', 'red'] },
          (m, err) => err ? reject(err) : resolve(m)
        );
      });
      return res.status(200).json({ urlFormat: mapId.urlFormat });
    }

    // Mô phỏng ngập (floodSim.js): dân số và diện tích mỗi phường theo từng mét cao độ nền FABDEM (cùng nguồn lớp địa hình);
    // trình duyệt tự cộng các bậc thấp hơn mực nước nên kéo thanh mực nước không phải gọi lại máy chủ
    if (action === 'getFloodBins') {
      res.setHeader('Cache-Control', req.query.pv ? 'no-store' : 's-maxage=3600, stale-while-revalidate=86400');
      const version = getPopEditsVersion();
      if (cachedFloodBins && cachedFloodBins.version === version && cachedFloodBins.dem === FLOOD_DEM) return res.status(200).json(cachedFloodBins.data);
      const bin = sat.demImage(ee).round().clamp(FLOOD_BIN_MIN, FLOOD_BIN_MAX).rename('bin');
      const img = populatedPixels(popRasterNative).addBands(ee.Image.pixelArea().rename('area')).addBands(bin);
      const fc = await eeEvaluate(img.reduceRegions({
        collection: wardVectorParsed,
        reducer: ee.Reducer.sum().unweighted().repeat(2).group({ groupField: 2, groupName: 'bin' }),
        crs: popProjection,
        scale: POP_SCALE_M
      }).map(f => ee.Feature(null).copyProperties(f)));
      const wards = ((fc && fc.features) || []).map(f => {
        const p = f.properties || {};
        const groups = p.groups || [];
        const pix = groups.reduce((s, g) => s + (g.sum[0] || 0), 0);
        const perPix = pix ? (Number(p.danSoNum) || 0) / pix : 0;
        return {
          name: wardNameOf(p),
          bins: groups.map(g => [g.bin, Math.round((g.sum[0] || 0) * perPix * 10) / 10, Math.round(g.sum[1] || 0)])
        };
      });
      const data = { binMin: FLOOD_BIN_MIN, binMax: FLOOD_BIN_MAX, wards };
      cachedFloodBins = { version, dem: FLOOD_DEM, data };
      return res.status(200).json(data);
    }

    // Cao độ nền FABDEM dạng ô Terrarium: terrainLayer.js / floodSim.js giải mã ngay trên trình duyệt
    if (action === 'getDemTile') {
      res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=3600');
      return res.status(200).json({ urlFormat: await sat.mapUrl(ee, sat.terrariumImage(ee)) });
    }

    // Vùng ngập mùa lũ từ radar Sentinel-1; year=all → số mùa lũ mỗi pixel bị ngập qua các năm
    if (action === 'getSarFloodTile') {
      const years = sat.sarYears();
      const all = req.query.year === 'all';
      const year = all ? null : sat.parseYear(req.query.year, years);
      if (!all && year == null) return res.status(400).json({ error: true, message: "Năm không hợp lệ" });
      res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=3600');
      const { image, legend } = sat.sarFloodVis(ee, wardVectorParsed, year, years);
      return res.status(200).json({ urlFormat: await sat.mapUrl(ee, image), legend, years });
    }

    // Nhiệt độ bề mặt mùa nóng (Landsat 8/9)
    if (action === 'getLstTile') {
      const years = sat.lstYears();
      const year = sat.parseYear(req.query.year, years);
      if (year == null) return res.status(400).json({ error: true, message: "Năm không hợp lệ" });
      res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=3600');
      const image = sat.lstImage(ee, wardVectorParsed, year).visualize(sat.LST_VIS);
      return res.status(200).json({ urlFormat: await sat.mapUrl(ee, image), legend: sat.LST_VIS, years });
    }

    if (action === 'getLstStats') {
      const year = sat.parseYear(req.query.year, sat.lstYears());
      if (year == null) return res.status(400).json({ error: true, message: "Năm không hợp lệ" });
      res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=86400');
      const key = `lst|${year}`;
      if (!cachedSatStats.has(key)) {
        const fc = await eeEvaluate(sat.lstImage(ee, wardVectorParsed, year).reduceRegions({
          collection: wardVectorParsed,
          reducer: ee.Reducer.mean().combine(ee.Reducer.count(), null, true),
          scale: 30,
          tileScale: 4
        }).map(f => ee.Feature(null).copyProperties(f)));
        let sum = 0, n = 0;
        const wards = ((fc && fc.features) || []).map(f => {
          const p = f.properties || {};
          if (p.mean != null && p.count) { sum += p.mean * p.count; n += p.count; }
          return { name: wardNameOf(p), mean: p.mean == null ? null : round1(p.mean) };
        }).filter(w => w.mean != null);
        cachedSatStats.set(key, { year, city: n ? round1(sum / n) : null, wards });
      }
      return res.status(200).json(cachedSatStats.get(key));
    }

    // Đối chiếu dân số phường (thuộc tính danSoNum, mẫu số mọi chỉ tiêu m²/người) với tổng WorldPop / GHSL trong ranh phường
    if (action === 'getPopCheck') {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
      const key = 'popcheck';
      if (!cachedSatStats.has(key)) {
        const [evaluatedWards, ...sums] = await Promise.all([
          loadEvaluatedWards(wardVectorParsed),
          ...sat.POP_REFS.map(src => eeEvaluate(src.image(ee).reduceRegions({
            collection: wardVectorParsed, reducer: ee.Reducer.sum(), tileScale: 4
          }).map(f => ee.Feature(null).copyProperties(f))))
        ]);
        const byWard = {};
        evaluatedWards.forEach(w => { byWard[w.name] = { name: w.name, pop: w.pop }; });
        sat.POP_REFS.forEach((src, i) => {
          ((sums[i] && sums[i].features) || []).forEach(f => {
            const p = f.properties || {};
            const row = byWard[wardNameOf(p)];
            if (row && p.sum != null) row[src.key] = Math.round(p.sum);
          });
        });
        cachedSatStats.set(key, {
          sources: sat.POP_REFS.map(({ key: k, label }) => ({ key: k, label })),
          wards: Object.values(byWard)
        });
      }
      return res.status(200).json(cachedSatStats.get(key));
    }

    if (action === 'getNewDevTile') {
      const from = Number(req.query.from);
      if (!sat.DEV_FROM_YEARS.includes(from)) return res.status(400).json({ error: true, message: "Năm gốc không hợp lệ" });
      res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=86400');
      const image = sat.newDevVis(ee, wardVectorParsed, from);
      return res.status(200).json({
        urlFormat: await sat.mapUrl(ee, image),
        legend: { color: sat.DEV_COLOR, baseColor: sat.DEV_BASE_COLOR, from, to: sat.devRecentYears() },
        years: sat.DEV_FROM_YEARS
      });
    }

    // Mẫu số mật độ đường theo phường/xã: đất xây dựng hiện nay = vùng hiện trạng + vùng phát triển mới từ năm gốc mặc định
    if (action === 'getBuiltArea') {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
      const from = sat.DEV_FROM_DEFAULT;
      const areas = await loadDevAreas(ee, wardVectorParsed, from);
      const wards = {};
      Object.entries(areas).forEach(([name, a]) => { wards[name] = Math.round((a.baseHa + a.devHa) * 10) / 1000; });
      return res.status(200).json({ years: sat.devRecentYears(), from, scale: sat.DEV_SCALE_M, wards });
    }

    if (action === 'getBoundaryTile') {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
      const wardOutline = ee.Image().byte().paint({ featureCollection: wardVectorParsed, color: 1, width: 2 });
      const mapId = await new Promise((resolve, reject) => {
        wardOutline.getMap({ palette: ['#00ffff'] }, (m, err) => err ? reject(err) : resolve(m));
      });
      return res.status(200).json({ urlFormat: mapId.urlFormat });
    }

    if (action === 'getWardLabels') {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');

      const wardCentroidFc = wardVectorParsed.map(f =>
        f.set('centroidCoords', f.geometry().centroid(1).coordinates())
      );

      const fc = await eeEvaluate(wardCentroidFc);
      const labels = ((fc && fc.features) || []).map(f => {
        const props = f.properties || {};
        const coords = props.centroidCoords || [107.5905, 16.4637];
        return {
          name: props.tenXa || props.NAME_2 || props.name || 'Phường',
          lat: coords[1],
          lng: coords[0],
          geometry: normalizeWardGeometry(f.geometry)
        };
      });

      return res.status(200).json({ labels });
    }

    if (action === 'getBoundaryVector') {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
      const fcGeoJson = (await eeEvaluate(wardVectorParsed)) || { type: 'FeatureCollection', features: [] };
      (fcGeoJson.features || []).forEach(f => { f.geometry = normalizeWardGeometry(f.geometry); });
      return res.status(200).json(fcGeoJson);
    }

    // --- Thao tác cần danh sách công trình ---
    const allDataList = await getRawDataList();
    try {
      applyStandardRadius(allDataList, await loadEvaluatedWards(wardVectorParsed));
    } catch (e) {
      console.error("Không gán được bán kính theo ranh phường/xã:", e && e.message);
    }
    // Mọi phép tính hiện trạng chỉ dùng công trình có QuyMo_HT (ô trống = hiện tại chưa hình thành)
    const rawDataList = allDataList.filter(it => it.planChange !== 'new' && it.planChange !== 'none');

    // Thống kê vùng ngập mùa lũ (Sentinel-1): diện tích, dân cư theo phường + công trình hiện trạng đã duyệt nằm trong vùng ngập
    if (action === 'getSarFloodStats') {
      const year = sat.parseYear(req.query.year, sat.sarYears());
      if (year == null) return res.status(400).json({ error: true, message: "Năm không hợp lệ" });
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      const key = `sar|${year}|${getPopEditsVersion()}|${getDataVersion()}`;
      if (!cachedSatStats.has(key)) {
        const flood = sat.sarFloodMask(ee, wardVectorParsed, year);
        const pix = populatedPixels(popRasterNative);
        const img = pix.addBands(pix.multiply(flood).rename('pixFlood')).addBands(ee.Image.pixelArea().multiply(flood).rename('area'));
        const items = rawDataList.filter(it => isApprovedStatus(it.status) && it.id && Number.isFinite(Number(it.lat)) && Number.isFinite(Number(it.lng)));
        const pts = ee.FeatureCollection(items.map((it, i) => ee.Feature(ee.Geometry.Point([Number(it.lng), Number(it.lat)]), { i })));
        const [fc, hit] = await Promise.all([
          eeEvaluate(img.reduceRegions({ collection: wardVectorParsed, reducer: ee.Reducer.sum().unweighted(), crs: popProjection, scale: POP_SCALE_M, tileScale: 4 })
            .map(f => ee.Feature(null).copyProperties(f))),
          items.length
            ? eeEvaluate(flood.reduceRegions({ collection: pts, reducer: ee.Reducer.max(), scale: 20, tileScale: 4 }).filter(ee.Filter.eq('max', 1)).aggregate_array('i'))
            : []
        ]);
        let pop0 = 0, popF = 0, area = 0;
        const wards = ((fc && fc.features) || []).map(f => {
          const p = f.properties || {};
          const wardPop = Number(p.danSoNum) || 0;
          const wp = p.pix ? wardPop * (p.pixFlood || 0) / p.pix : 0;
          pop0 += wardPop; popF += wp; area += p.area || 0;
          return { name: wardNameOf(p), pop: Math.round(wp), area: Math.round(p.area || 0) };
        }).filter(w => w.pop > 0 || w.area > 0).sort((a, b) => b.pop - a.pop);
        if (cachedSatStats.size > 40) cachedSatStats.clear();
        cachedSatStats.set(key, {
          year,
          area: Math.round(area),
          pop: Math.round(popF),
          popAll: Math.round(pop0),
          wards,
          ids: (hit || []).map(i => items[i] && items[i].id).filter(Boolean)
        });
      }
      return res.status(200).json(cachedSatStats.get(key));
    }

    // Rủi ro tại từng công trình (mọi trạng thái, kể cả quy hoạch mới và quỹ đất), mỗi lần gọi 1 năm để vừa giới hạn thời gian:
    // kind=flood → id công trình có pixel ngập (Sentinel-1) trong vòng RISK_BUFFER_M ở mùa lũ year;
    // kind=lst → nhiệt độ bề mặt trung bình (Landsat) trong vòng RISK_BUFFER_M ở mùa nóng year
    if (action === 'getInfraRisk') {
      const kind = req.query.kind === 'lst' ? 'lst' : 'flood';
      const year = sat.parseYear(req.query.year, kind === 'lst' ? sat.lstYears() : sat.sarYears());
      if (year == null) return res.status(400).json({ error: true, message: "Năm không hợp lệ" });
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      const key = `risk|${kind}|${year}|${getDataVersion()}`;
      if (!cachedSatStats.has(key)) {
        const items = allDataList.filter(it => it.id && Number.isFinite(Number(it.lat)) && Number.isFinite(Number(it.lng)));
        const pts = ee.FeatureCollection(items.map((it, i) => ee.Feature(ee.Geometry.Point([Number(it.lng), Number(it.lat)]).buffer(RISK_BUFFER_M), { i })));
        let data;
        if (kind === 'flood') {
          const hit = items.length
            ? await eeEvaluate(sat.sarFloodMask(ee, wardVectorParsed, year)
              .reduceRegions({ collection: pts, reducer: ee.Reducer.max(), scale: 20, tileScale: 4 })
              .filter(ee.Filter.eq('max', 1)).aggregate_array('i'))
            : [];
          data = { year, ids: (hit || []).map(i => items[i] && items[i].id).filter(Boolean) };
        } else {
          const fc = items.length
            ? await eeEvaluate(sat.lstImage(ee, wardVectorParsed, year)
              .reduceRegions({ collection: pts, reducer: ee.Reducer.mean(), scale: 30, tileScale: 4 })
              .filter(ee.Filter.notNull(['mean']))
              .map(f => ee.Feature(null, { i: f.get('i'), v: f.get('mean') })))
            : null;
          const vals = {};
          ((fc && fc.features) || []).forEach(f => {
            const it = items[f.properties.i];
            if (it) vals[it.id] = round1(f.properties.v);
          });
          data = { year, vals };
        }
        if (cachedSatStats.size > 40) cachedSatStats.clear();
        cachedSatStats.set(key, data);
      }
      return res.status(200).json(cachedSatStats.get(key));
    }

    // Vùng hiện trạng / vùng phát triển mới từ năm from trong cả 40 phường/xã. Trong vùng phát triển mới: dân số ước tính
    // (đơn vị ở, Mục 2.2.3.2), công viên/vườn hoa nằm trong vùng, tỷ lệ diện tích trong 400 m quanh công viên/vườn hoa,
    // bãi đỗ xe hiện trạng đã duyệt (Mục 2.2.3.3) — chỉ tiêu này chỉ xét ở phường bộ chỉ tiêu đô thị (dt = true)
    if (action === 'getNewDevStats') {
      const from = Number(req.query.from);
      if (!sat.DEV_FROM_YEARS.includes(from)) return res.status(400).json({ error: true, message: "Năm gốc không hợp lệ" });
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      const key = `dev|${from}|${sat.devRecentYears().join('-')}|${getDataVersion()}`;
      if (!cachedSatStats.has(key)) {
        const [evaluatedWards, areas] = await Promise.all([
          loadEvaluatedWards(wardVectorParsed),
          loadDevAreas(ee, wardVectorParsed, from)
        ]);
        const approved = rawDataList.filter(it => isApprovedStatus(it.status) && Number.isFinite(Number(it.lat)) && Number.isFinite(Number(it.lng)));
        const near = (code) => {
          const zones = approved.filter(it => constants.resolveTypeCode(it) === code)
            .map(it => ee.Feature(ee.Geometry.Point([Number(it.lng), Number(it.lat)]).buffer(DEV_SERVICE_M)));
          return zones.length ? ee.Image(0).byte().paint(ee.FeatureCollection(zones), 1) : ee.Image(0).byte();
        };
        const dev = sat.newDevImage(ee, wardVectorParsed, from).select('dev');
        const devHa = ee.Image.pixelArea().divide(1e4).multiply(dev);
        const stack = devHa.multiply(near('1-CV')).rename('park')
          .addBands(devHa.multiply(near('2-BDX')).rename('parking'));
        const pix = populatedPixels(popRasterNative);
        const parks = approved.filter(it => constants.resolveTypeCode(it) === '1-CV');
        const parkPts = ee.FeatureCollection(parks.map((it, i) => ee.Feature(ee.Geometry.Point([Number(it.lng), Number(it.lat)]).buffer(RISK_BUFFER_M), { i })));
        const [fc, popFc, parkHit] = await Promise.all([
          eeEvaluate(stack.reduceRegions({ collection: wardVectorParsed, reducer: ee.Reducer.sum(), crs: sat.DEV_CRS, scale: sat.DEV_SCALE_M, tileScale: 8 })
            .map(f => ee.Feature(null).copyProperties(f))),
          eeEvaluate(pix.addBands(pix.multiply(dev).rename('pixDev')).reduceRegions({
            collection: wardVectorParsed, reducer: ee.Reducer.sum().unweighted(), crs: popProjection, scale: POP_SCALE_M, tileScale: 4
          }).map(f => ee.Feature(null).copyProperties(f))),
          parks.length
            ? eeEvaluate(dev.reduceRegions({ collection: parkPts, reducer: ee.Reducer.max(), crs: sat.DEV_CRS, scale: sat.DEV_SCALE_M, tileScale: 4 })
              .filter(ee.Filter.eq('max', 1)).aggregate_array('i'))
            : []
        ]);
        const popByWard = {};
        ((popFc && popFc.features) || []).forEach(f => {
          const p = f.properties || {};
          popByWard[wardNameOf(p)] = p.pix ? (Number(p.danSoNum) || 0) * (Number(p.pixDev) || 0) / p.pix : 0;
        });
        const parksByWard = {};
        (parkHit || []).forEach(i => {
          const it = parks[i];
          const w = it && assignWardByGeometry(it.lng, it.lat, evaluatedWards);
          if (w) (parksByWard[w] = parksByWard[w] || []).push({ id: it.id, name: it.name, size: Number(it.size) || 0, lat: Number(it.lat), lng: Number(it.lng) });
        });
        const pctOf = (part, whole) => (whole > 0 ? round1(Math.min(100, (part / whole) * 100)) : null);
        const wards = ((fc && fc.features) || []).map(f => {
          const p = f.properties || {};
          const name = wardNameOf(p);
          const a = areas[name] || { baseHa: 0, devHa: 0 };
          const devArea = a.devHa;
          return {
            name,
            dt: constants.wardProfile(name) === 'DT',
            devHa: a.devHa,
            baseHa: a.baseHa,
            builtHa: round1(a.baseHa + a.devHa),
            devPop: Math.round(popByWard[name] || 0),
            parks: parksByWard[name] || [],
            parkPct: pctOf(Number(p.park) || 0, devArea),
            parkingPct: pctOf(Number(p.parking) || 0, devArea)
          };
        }).sort((a, b) => b.devHa - a.devHa);
        if (cachedSatStats.size > 40) cachedSatStats.clear();
        cachedSatStats.set(key, {
          from, to: sat.devRecentYears(), serviceM: DEV_SERVICE_M,
          unitPop: constants.POP_PER_UNIT, parkRule: constants.UNIT_PARK_RULE, wards
        });
      }
      return res.status(200).json(cachedSatStats.get(key));
    }

    // Admin: ghi dấu nhắc "phường theo tọa độ" vào cột Note cho công trình lệch phường, gỡ dấu ở dòng đã sửa đúng
    if (action === 'syncWardNotes') {
      requirePostFromApp(req);
      await requireAdmin(req);
      const evaluatedWards = await loadEvaluatedWards(wardVectorParsed);
      const mismatches = findWardMismatches(allDataList, evaluatedWards);
      const flagged = new Set(mismatches.map(m => m.id));
      const stale = allDataList.filter(it => it.id && !flagged.has(it.id) && String(it.note || '').includes(WARD_NOTE_PREFIX)).length;
      const summary = { success: true, mismatches: mismatches.length, marked: 0, cleared: 0 };
      if (!stale && mismatches.every(m => m.noteOk)) return res.status(200).json({ ...summary, unchanged: true });
      const result = await callAppsScript({ action: 'markWardNotes' }, {
        action: 'markWardNotes',
        prefix: WARD_NOTE_PREFIX,
        items: mismatches.map(m => ({ id: m.id, note: m.note }))
      });
      invalidateAllCaches();
      return res.status(200).json({
        ...summary,
        marked: Number(result.marked) || 0,
        cleared: Number(result.cleared) || 0,
        noNoteColumn: Array.isArray(result.noNoteColumn) ? result.noNoteColumn : []
      });
    }

    // Khu đất CSD theo id (lấy diện tích từ sheet); không có id thì dùng tọa độ + diện tích gửi lên
    const resolveCsdRequest = async () => {
      const id = String(req.query.id || '').trim();
      const byId = id ? rawDataList.find(it => it.id === id) : null;
      let csd = byId;
      if (!csd) {
        const pt = parseCoordInBounds(req.query.lat, req.query.lng);
        if (!pt) throw httpError(400, "Tọa độ không hợp lệ");
        csd = { id: null, lat: pt.lat, lng: pt.lng, size: clamp(Number(req.query.size) || 0, 0, 1e8) };
      }
      const evaluatedWardsCsd = await loadEvaluatedWards(wardVectorParsed);
      const wardName = assignWardByGeometry(csd.lng, csd.lat, evaluatedWardsCsd);
      const wardFeat = wardName ? findWardByName(evaluatedWardsCsd, wardName) : null;
      if (!wardFeat || !wardFeat.geometry) throw httpError(400, "Khu đất nằm ngoài ranh giới 40 phường/xã");
      const approvedAll = rawDataList.filter(it => isApprovedStatus(it.status) && it.lat != null && it.lng != null);
      const approvedInWard = approvedAll.flatMap(it => wardShareItems(it, 'sizeHT'))
        .filter(it => assignWardByGeometry(it.lng, it.lat, evaluatedWardsCsd) === wardName);
      const ward = buildWardContext(wardFeat, approvedInWard);
      return { csd, ward, approvedAll, ...csdSuggestionCandidates(csd, ward, approvedAll) };
    };

    if (action === 'analyzeCSD') {
      const { ward, suggestions, candidates } = await resolveCsdRequest();
      await fillCoverageGains(ee, popRasterNative, candidates);
      return res.status(200).json({
        ward: ward.name,
        suggestions: rankEligible(suggestions).slice(0, 2),
        ineligible: suggestions.filter(s => s.status === 'ineligible')
      });
    }

    // Minh chứng trực quan cho 1 đề xuất: công trình cùng loại đã trừ, vùng còn trống, pixel dân cư được đếm
    if (action === 'explainCSD') {
      const code = String(req.query.code || '');
      if (!CODES.includes(code)) return res.status(400).json({ error: true, message: "Loại hạ tầng không hợp lệ" });
      const { csd, ward, suggestions, candidates } = await resolveCsdRequest();
      const cand = candidates.find(c => c.target.code === code);
      if (!cand) {
        const s = suggestions.find(x => x.code === code);
        const reason = s && s.status === 'ineligible'
          ? `Khu đất nhỏ hơn diện tích tối thiểu (${s.minSize} m²)`
          : 'Phường đã đạt 100% quy mô loại này';
        return res.status(400).json({ error: true, message: reason });
      }

      const { bufferInWard, net } = candidateGeometries(ee, cand);
      const regions = [
        { key: 'buffer', geometry: bufferInWard },
        { key: 'net', geometry: net }
      ];
      if (!wardPopPixelCache.has(ward.name)) regions.push({ key: 'ward', geometry: ee.Geometry(ward.geometry) });
      const [counts, netGeoJson, mapId, pixelSize] = await Promise.all([
        countPopPixels(ee, popRasterNative, regions),
        eeEvaluate(net.simplify(5)),
        // Pixel dân cư trên lưới gốc của raster: 1 = đã được phục vụ (trong buffer, ngoài vùng trống), 2 = được đếm bổ sung
        new Promise((resolve, reject) => {
          const img = ee.Image(0).byte()
            .paint(ee.FeatureCollection([ee.Feature(bufferInWard)]), 1)
            .paint(ee.FeatureCollection([ee.Feature(net)]), 2)
            .reproject(popProjection);
          img.updateMask(img.gt(0)).updateMask(popRasterNative.mask())
            .getMap({ min: 1, max: 2, palette: ['22c55e', 'ffd400'] }, (m, err) => err ? reject(err) : resolve(m));
        }),
        popPixelSize(popProjection)
      ]);
      if (counts.ward != null) wardPopPixelCache.set(ward.name, counts.ward);

      const wardTotal = wardPopPixelCache.get(ward.name) || 0;
      const bufferPix = counts.buffer || 0;
      const netPix = counts.net || 0;
      // Dân số bình quân 1 pixel = dân số phường / số pixel dân cư của phường (làm tròn như hiển thị để nhân tay khớp)
      const popPerPixel = wardTotal > 0 ? Number((ward.pop / wardTotal).toFixed(2)) : 0;
      const t = cand.target;
      // Cùng phép tính với fillCoverageGains: dân trong vùng trống, giới hạn bởi sức chứa theo chỉ tiêu m²/người
      const reachExact = wardTotal > 0 ? netPix * (ward.pop / wardTotal) : 0;
      const addedExact = capByCapacity(reachExact, t.capacity);
      const coverageAddPct = ward.pop > 0 ? round1(clamp((addedExact / ward.pop) * 100, 0, 100)) : 0;
      const reach = Math.round(popPerPixel * netPix);
      return res.status(200).json({
        code,
        label: cand.target.label,
        ward: ward.name,
        candidate: { id: csd.id, name: csd.name || null, lat: csd.lat, lng: csd.lng, radius: cand.radius },
        existing: cand.existing.map(it => ({ id: it.id, name: it.name, lat: it.lat, lng: it.lng, radius: Number(it.radius) || cand.radius })),
        netGeometry: netGeoJson,
        pixels: { buffer: bufferPix, covered: Math.max(0, bufferPix - netPix), net: netPix, wardTotal },
        coverageAddPct,
        basis: csdBasis(coverageAddPct),
        scaleAddPct: t.scaleAddPct,
        scale: {
          required: t.reqArea,
          existing: t.existArea,
          deficit: t.deficitArea,
          siteArea: Math.round(Number(csd.size) || 0),
          currentPct: t.currentScalePct,
          afterPct: round1(clamp(t.currentScalePct + t.scaleAddPct, 0, 100))
        },
        population: {
          ward: ward.pop,
          perPixel: popPerPixel,
          reach,
          quota: t.quota,
          capacity: t.capacity,
          added: capByCapacity(reach, t.capacity)
        },
        pixelSize,
        tileUrl: mapId.urlFormat
      });
    }

    if (action === 'getNetworkCoverage') {
      const evaluatedWards = await loadEvaluatedWards(wardVectorParsed);
      const targetWard = findWardByName(evaluatedWards, String(req.query.ward || '').trim().slice(0, 100));
      if (!targetWard || !targetWard.geometry) return res.status(404).json({ error: true, message: "Không tìm thấy ranh giới phường" });
      const isPlan = String(req.query.scenario || '').toUpperCase() === 'QH';
      const list = isPlan ? getPlanScenarioItems(allDataList) : rawDataList;
      const profile = constants.wardProfile(targetWard.name);
      const pcccR = constants.networkRadius({}, '10-PCCC', profile);
      const groups = {
        bus: networkItemsOf(list, '13-BUS'),
        pccc: networkItemsOf(list, '10-PCCC').map(it => ({ ...it, radius: pcccR })),
        nt: networkItemsOf(list, '11-NT').filter(it => Number(it.radius) > 0)
      };
      const sig = networkSignature(groups);
      const cacheKey = `${isPlan ? 'QH' : 'HT'}:${targetWard.name}`;
      const hit = cachedNetworkCoverage[cacheKey];
      if (hit && hit.sig === sig) return res.status(200).json(hit.payload);

      const result = await withTimeout(computeNetworkCoverage(ee, popRasterNormalized, targetWard.geometry, groups), 45000, null);
      if (!result) return res.status(504).json({ error: true, message: "GEE quá thời gian khi tính độ phủ mạng lưới" });
      const payload = { ward: targetWard.name, scenario: isPlan ? 'QH' : 'HT', pcccRadius: pcccR, sig, ...result };
      cachedNetworkCoverage[cacheKey] = { sig, payload };
      return res.status(200).json(payload);
    }

    // Admin: điểm OSM (trình duyệt tải từ Overpass) → lọc trùng, gán phường, bán kính → ghi Sheet ở trạng thái chờ duyệt
    if (action === 'importOsmNetwork') {
      requirePostFromApp(req);
      await requireAdmin(req);
      const body = readJsonBody(req);
      const rawItems = Array.isArray(body.items) ? body.items : [];
      if (!rawItems.length || rawItems.length > OSM_IMPORT_MAX) {
        return res.status(400).json({ error: true, message: `Mỗi lần gửi 1–${OSM_IMPORT_MAX} điểm` });
      }
      const { accepted, stats } = prepareOsmImport(rawItems, allDataList, await loadEvaluatedWards(wardVectorParsed));
      if (body.dryRun || !accepted.length) {
        return res.status(200).json({ success: true, dryRun: true, stats, items: accepted });
      }
      const result = await callAppsScript({ action: 'addPendingPoints' }, {
        action: 'addPendingPoints',
        items: accepted.map(it => ({ ...it, lat: it.lat.toFixed(6), lng: it.lng.toFixed(6) }))
      });
      const created = Number(result && result.created);
      const skipped = Number(result && result.skipped);
      if (!Number.isFinite(created) || !Number.isFinite(skipped)) {
        return res.status(502).json({
          error: true,
          message: 'Apps Script không trả số điểm đã ghi. Dán apps-script/Code.gs vào Sheet rồi Deploy → Manage deployments → Edit → Version: New version → Deploy.'
        });
      }
      invalidateAllCaches();
      return res.status(200).json({ success: true, stats, created, skipped, sheets: result.sheets || [] });
    }

    if (action === 'getWardCoverage') {
      const wardName = String(req.query.ward || '').trim().slice(0, 100);
      if (!wardName) {
        return res.status(400).json({ error: true, message: "Thiếu tên phường" });
      }

      const evaluatedWards = await loadEvaluatedWards(wardVectorParsed);
      const targetWard = findWardByName(evaluatedWards, wardName);
      if (!targetWard || !targetWard.geometry) {
        return res.status(404).json({ error: true, message: "Không tìm thấy ranh giới phường" });
      }

      const isPlan = String(req.query.scenario || '').toUpperCase() === 'QH';
      const scenarioList = isPlan ? getPlanScenarioItems(allDataList) : rawDataList;
      const itemsInWard = coverageItemsInWard(scenarioList, targetWard.name, evaluatedWards);
      const sig = coverageSignature(itemsInWard);
      const cacheKey = `${isPlan ? 'QH' : 'HT'}:${targetWard.name}`;

      const buildPayload = (ratiosSrc, avg, status) => {
        const payload = { ward: targetWard.name, ratios: {}, Avg_Coverage_Score: avg || 0, sig, coverageStatus: status };
        Object.keys(ratiosSrc || {}).forEach(c => {
          payload.ratios[c] = Number(ratiosSrc[c] || 0);
          payload[`Ratio_${c}`] = payload.ratios[c];
        });
        CODES.forEach(c => {
          if (payload.ratios[c] == null) payload.ratios[c] = 0;
          payload[`Ratio_${c}`] = payload.ratios[c];
        });
        payload.coverageSchema = COVERAGE_ALGO_VERSION;
        if (isPlan) payload.scenario = 'QH';
        return payload;
      };

      const hit = cachedCoverageByWard[cacheKey];
      if (hit && hit.sig === sig) {
        return res.status(200).json(buildPayload(hit.ratios, hit.Avg_Coverage_Score, 'ok'));
      }

      try {
        const result = await withTimeout(
          computeSingleWardCoverage(ee, popRasterNormalized, targetWard.geometry, itemsInWard),
          45000,
          { ratios: {}, Avg_Coverage_Score: 0, timedOut: true }
        );
        const payload = buildPayload(result.ratios, result.Avg_Coverage_Score, result.timedOut ? 'timeout' : 'ok');
        if (result._debugCounts) payload.itemCounts = result._debugCounts;

        if (!result.timedOut) {
          cachedCoverageByWard[cacheKey] = {
            sig,
            ratios: { ...payload.ratios },
            Avg_Coverage_Score: payload.Avg_Coverage_Score
          };
        }
        return res.status(200).json(payload);
      } catch (err) {
        console.error("getWardCoverage error:", err && err.message);
        return res.status(502).json({ error: true, message: "Lỗi tính độ phủ từ GEE", coverageStatus: 'error' });
      }
    }

    if (action === 'getWardStats') {
      const now = Date.now();
      if (cachedWardStats && cachedWardStatsVersion === getDataVersion()
          && (now - lastWardStatsFetch < cachedWardStatsTtl)) {
        cachedWardStats.forEach(applyCachedCoverage);
        return res.status(200).json({ data: cachedWardStats, network: cachedCityNetwork, coverageStatus: 'cached' });
      }
      cachedWardStats = null;
      const timing = { start: now - startedAt };

      const evaluatedWards = await loadEvaluatedWards(wardVectorParsed);
      timing.wards = Date.now() - startedAt;
      const wardOf = (item) => assignWardByGeometry(item.lng, item.lat, evaluatedWards);

      const wardMap = {};
      evaluatedWards.forEach(w => {
        const totalPop = w.pop || 10000;
        const projPop = Math.round(totalPop * constants.POP_GROWTH);
        wardMap[w.name] = {
          meta: w,
          Ten_Phuong: w.name,
          Dan_So_Vector: totalPop,
          projectedPopulation: projPop,
          currentUnits: Math.max(1, Math.ceil(totalPop / constants.POP_PER_UNIT)),
          projectedUnits: Math.max(1, Math.ceil(projPop / constants.POP_PER_UNIT)),
          items: [],
          covItems: [],
          pendingItems: [],
          csdRaw: [],
          planItems: [],
          planCovItems: [],
          planCovChanges: [],
          network: [],
          networkPending: []
        };
      });

      // 1 lượt duyệt hiện trạng: phân loại công trình theo phường
      rawDataList.forEach(item => {
        if (item.lat == null || item.lng == null) return;
        const w = wardMap[wardOf(item)];
        if (!w) return;
        if (constants.isNetworkCode(item.type)) {
          (isApprovedStatus(item.status) ? w.network : w.networkPending).push(item);
          return;
        }
        const prefix = String(item.id || '').split('-')[0];
        const nhom = String(item.nhomHaTang || '').toLowerCase();
        const approved = isApprovedStatus(item.status);
        const typeCode = item.type || constants.codeMap[prefix] || "";
        const isCSD = (typeCode === "12-CSD" || prefix === "CSD"
          || nhom.includes("chưa sử dụng") || nhom.includes("csd"));
        if (isCoverageItem(item)) w.covItems.push(item);

        if (isCSD) {
          w.csdRaw.push(item);
        } else if (approved) {
          wardShareItems(item, 'sizeHT').forEach(x => wardMap[wardOf(x)]?.items.push(x));
        } else if (CODES.includes(typeCode)) {
          w.pendingItems.push(item);
        }
      });

      getPlanScenarioItems(allDataList).forEach(item => {
        if (item.lat == null || item.lng == null) return;
        const w = wardMap[wardOf(item)];
        if (!w) return;
        if (isCoverageItem(item)) w.planCovItems.push(item);
        if (item.type !== "12-CSD") wardShareItems(item, 'sizeQH').forEach(x => wardMap[wardOf(x)]?.planItems.push(x));
      });
      allDataList.forEach(item => {
        if (item.planChange !== 'new' && item.planChange !== 'relocate') return;
        if (!isApprovedStatus(item.status) || item.lat == null || item.lng == null) return;
        const w = wardMap[wardOf(item)];
        if (w) w.planCovChanges.push(item.id);
      });

      const resultTable = [];
      const approvedAll = rawDataList.filter(it => isApprovedStatus(it.status) && it.lat != null && it.lng != null);
      const coverageCandidates = [];
      const rankAfterCount = [];
      const allBusStops = networkItemsOf(rawDataList, '13-BUS');

      for (const wName in wardMap) {
        const data = wardMap[wName];
        const pop = data.Dan_So_Vector;
        const projPop = data.projectedPopulation;
        const wardGeom = data.meta.geometry;
        const profile = constants.wardProfile(wName);

        const { urbanResults, unitResults } = bucketWardInfra(data.items, projPop, { profile });
        const scales = scaleByCode(urbanResults, unitResults, projPop, profile);
        const planBuckets = bucketWardInfra(data.planItems, projPop, { withSubItems: false, profile });
        const planScales = scaleByCode(planBuckets.urbanResults, planBuckets.unitResults, projPop, profile);

        // Gợi ý chuyển đổi quỹ đất chưa sử dụng (CSD): cùng logic với popup khu đất, % độ phủ đếm pixel sau vòng lặp
        const wardCtx = { name: wName, geometry: wardGeom, pop, projPop, profile, urbanResults, unitResults };
        const csdItems = data.csdRaw.map(item => {
          const { suggestions, candidates } = csdSuggestionCandidates(item, wardCtx, approvedAll);
          coverageCandidates.push(...candidates);
          const row = {
            id: item.id,
            name: item.name || item.ten || "Khu đất chưa sử dụng",
            size: Number(item.size || 0),
            lat: item.lat,
            lng: item.lng,
            radius: Number(item.radius) || 500,
            suggestions: [],
            status: item.status,
            needsApproval: !isApprovedStatus(item.status)
          };
          // Tối đa 2 lựa chọn ưu tiên + danh sách không đủ diện tích tối thiểu
          rankAfterCount.push(() => {
            row.suggestions = [...rankEligible(suggestions).slice(0, 2), ...suggestions.filter(s => s.status === 'ineligible')];
          });
          return row;
        });

        const pendingItems = data.pendingItems.map(item => {
          const code = constants.resolveTypeCode(item) || item.type || "12-CSD";
          const size = Number(item.size || 0);
          const reqArea = Math.round(constants.quotaFor(code, profile) * projPop);
          const infraCfg = constants.infraConfig ? constants.infraConfig[code] : null;
          const radius = Number(item.radius) || constants.unitRadius(code, profile);
          const row = {
            id: item.id,
            name: item.name,
            type: code,
            typeLabel: (infraCfg && infraCfg.label) || code,
            size,
            lat: item.lat,
            lng: item.lng,
            radius,
            status: item.status,
            ...capacityByQuota(item, size, profile),
            scaleAddPct: reqArea > 0 ? round1(clamp((size / reqArea) * 100, 0, 100)) : 0,
            coverageAddPct: 0
          };
          coverageCandidates.push({
            lat: item.lat, lng: item.lng, radius,
            existing: nearbySameType(approvedAll, metricCode(item), item.lat, item.lng, radius),
            ward: wardCtx,
            target: row
          });
          return row;
        });

        const areaKm2 = Number(data.meta.areaKm2) || 0;
        const calculatedRow = {
          Ten_Phuong: wName,
          Dan_So_Vector: pop,
          Dien_Tich_Km2: areaKm2,
          Mat_Do_Dan_So: areaKm2 > 0 ? Math.round(pop / areaKm2) : 0,
          projectedPopulation: projPop,
          currentUnits: data.currentUnits,
          projectedUnits: data.projectedUnits,
          profile,
          profileLabel: constants.wardProfileLabel(wName),
          countRules: constants.COUNT_RULES[profile] || {},
          parkRule: constants.UNIT_PARK_RULE.profiles.includes(profile) ? constants.UNIT_PARK_RULE : null,
          urbanResults,
          unitResults,
          csdItems,
          pendingItems,
          network: wardNetworkSummary(data.network, data.networkPending, allBusStops, profile),
          dvccSummary: {
            totalArea: (unitResults["YT_DV"]?.currentArea || 0) + (unitResults["VH_DV"]?.currentArea || 0) + (unitResults["TM_DV"]?.currentArea || 0),
            requiredArea: (constants.baseQuota('DVCC_TOTAL', profile) || 0) * projPop,
            status: false
          }
        };

        CODES.forEach(c => {
          calculatedRow[`Scale_${c}`] = scales[c];
          calculatedRow[`ScaleQH_${c}`] = planScales[c];
        });
        calculatedRow.Avg_Scale_Score = avgScale(scales);
        calculatedRow.Avg_Scale_QH = avgScale(planScales);

        calculatedRow.covSig = coverageSignature(data.covItems);
        // Độ phủ QH chỉ khác HT khi phường có công trình mới/di dời (mở rộng/thu hẹp không đổi bán kính)
        calculatedRow.planCovSig = data.planCovChanges.length ? coverageSignature(data.planCovItems) : '';
        calculatedRow._assignMode = 'geometry';
        calculatedRow._schema = 10;
        applyCachedCoverage(calculatedRow);

        resultTable.push(calculatedRow);
      }

      timing.rows = Date.now() - startedAt;
      const geeBudget = Math.min(30000, startedAt + WARD_STATS_BUDGET_MS - Date.now());
      const allPixel = await fillCoverageGains(ee, popRasterNative, coverageCandidates, geeBudget,
        { deadline: startedAt + WARD_STATS_DEADLINE_MS, timing });
      rankAfterCount.forEach(fn => fn());

      resultTable.sort((a, b) => b.Dan_So_Vector - a.Dan_So_Vector);

      const cityPop = resultTable.reduce((s, r) => s + (Number(r.projectedPopulation) || 0), 0);
      const cityNetwork = {
        HT: cityNetworkSummary(rawDataList, cityPop),
        QH: cityNetworkSummary(getPlanScenarioItems(allDataList), cityPop)
      };

      // Kết quả ước lượng (GEE lỗi / quá hạn) chỉ giữ ngắn để lần sau đếm lại bằng pixel mà không tính lại ở mọi lượt mở trang
      cachedWardStats = resultTable;
      cachedWardStatsTtl = allPixel ? constants.WARD_STATS_CACHE_TTL : WARD_STATS_ESTIMATE_TTL;
      cachedCityNetwork = cityNetwork;
      cachedWardStatsVersion = getDataVersion();
      lastWardStatsFetch = now;
      timing.total = Date.now() - startedAt;
      console.log('getWardStats timing (ms):', JSON.stringify(timing));

      return res.status(200).json({ data: resultTable, network: cityNetwork, coverageStatus: 'per_ward', timing });
    }

    const planDataList = allDataList.filter(it => it.planChange === 'new');
    // CDN giữ 30 s (tránh khởi động nguội GEE mỗi lượt mở trang); fresh = client vừa ghi dữ liệu → bỏ qua CDN
    res.setHeader('Cache-Control', req.query.fresh ? 'no-store' : 'public, max-age=0, s-maxage=30, stale-while-revalidate=120');
    return res.status(200).json({ rawDataList, planDataList });

  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error("GEE API Error:", err);
    return res.status(status).json({ error: true, message: err.message || 'Lỗi máy chủ' });
  }
};
