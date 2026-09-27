const axios = require('axios');
const crypto = require('crypto');
const constants = require('../config/constants');
const { initGEE, getGeeContext, eeEvaluate } = require('../services/geeService');
const { getRawDataList, invalidateCache, getDataVersion } = require('../services/gcsService');
const { requireAdmin, httpError } = require('../services/authService');

let cachedWardStats = null;
let lastWardStatsFetch = 0;
let cachedWardStatsVersion = -1;
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

const addPointHits = new Map();
function checkAddPointRate(req) {
  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const hits = (addPointHits.get(ip) || []).filter(t => now - t < windowMs);
  if (hits.length >= 10) throw httpError(429, 'Gửi quá nhiều đề xuất, vui lòng thử lại sau ít phút');
  hits.push(now);
  if (addPointHits.size > 5000) addPointHits.clear();
  addPointHits.set(ip, hits);
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

async function callAppsScript(params) {
  if (!constants.GAS_BASE_URL) {
    throw httpError(503, 'Máy chủ chưa cấu hình GAS_BASE_URL (Vercel → Settings → Environment Variables)');
  }
  const query = new URLSearchParams(params);
  if (constants.GAS_SECRET) query.set('key', constants.GAS_SECRET);

  let res;
  try {
    res = await axios.get(`${constants.GAS_BASE_URL}?${query.toString()}`, {
      timeout: 25000,
      responseType: 'text',
      transformResponse: r => r,
      validateStatus: () => true
    });
  } catch (e) {
    throw httpError(502, 'Không kết nối được Google Apps Script');
  }

  const text = String(res.data || '');
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  if (data && typeof data === 'object') {
    if (res.status >= 400 || data.error || data.success === false) {
      throw httpError(502, `Apps Script: ${data.error || data.message || 'từ chối yêu cầu'}`);
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

function invalidateAllCaches() {
  invalidateCache();
  cachedWardStats = null;
  cachedCoverageByWard = {};
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
function estimateCoverageAddPct({ lat, lng, radius, wardGeometry, existingSameType }) {
  const R = Math.max(50, Number(radius) || 1000);
  const wardArea = geoJsonAreaM2(wardGeometry);
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
    return {
      name: props.tenXa || props.NAME_2 || props.name || 'Phường',
      pop: Number(props.danSoNum || props.danSo || 10000),
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

function findWardByName(evaluatedWards, wardName) {
  const clean = constants.cleanWardStr(wardName);
  return evaluatedWards.find(w => w.name === wardName || constants.cleanWardStr(w.name) === clean) || null;
}

// ============================ PHÂN LOẠI & CHỈ TIÊU ============================

// Kịch bản quy hoạch: công trình có QuyMo_QH (bỏ di dời / không thể hiện), diện tích theo QuyMo_QH
function getPlanScenarioItems(allDataList) {
  return allDataList
    .filter(it => it.planChange !== 'relocate' && it.planChange !== 'none')
    .map(it => ({ ...it, size: it.sizeQH ?? it.size }));
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

function slimItem(item) {
  return {
    id: item.id, name: item.name, type: item.type,
    lat: item.lat, lng: item.lng,
    size: item.size, radius: item.radius, status: item.status
  };
}

// Gom diện tích công trình đã duyệt vào các nhóm chỉ tiêu cấp đô thị / cấp đơn vị ở
function bucketWardInfra(items, projPop, { withSubItems = true } = {}) {
  const makeBucket = (cfg, quota) => ({
    label: cfg.label,
    quota,
    currentArea: 0,
    requiredArea: quota * projPop,
    subItems: [],
    status: false
  });
  const urbanResults = {};
  for (const key in constants.urbanInfraConfig) {
    urbanResults[key] = makeBucket(constants.urbanInfraConfig[key], constants.urbanInfraConfig[key].quota);
  }
  const unitResults = {};
  for (const key in constants.unitInfraConfig) {
    unitResults[key] = makeBucket(constants.unitInfraConfig[key], constants.unitInfraConfig[key].quota || 0);
  }

  items.forEach(item => {
    if (!isApprovedStatus(item.status)) return;
    const key = levelKeyOf(item);
    const bucket = key && (urbanResults[key] || unitResults[key]);
    if (!bucket) return;
    bucket.currentArea += Number(item.size || 0);
    if (withSubItems) bucket.subItems.push(slimItem(item));
  });

  return { urbanResults, unitResults };
}

// Tổng diện tích hiện có của 1 mã = cộng mọi nhóm chỉ tiêu (cấp đô thị + cấp đơn vị ở)
function codeCurrentArea(code, urbanResults, unitResults) {
  return (constants.CODE_LEVEL_KEYS[code] || []).reduce((s, k) => {
    const node = urbanResults[k] || unitResults[k];
    return s + (node ? node.currentArea : 0);
  }, 0);
}

// Tỷ lệ quy mô (%) của 8 mã hạ tầng so với chỉ tiêu tổng (quotaConfig × dân số quy hoạch), chặn trong 0–100
function scaleByCode(urbanResults, unitResults, projPop) {
  const scales = {};
  CODES.forEach(c => {
    const required = (constants.quotaConfig[c] || 0) * projPop;
    const current = codeCurrentArea(c, urbanResults, unitResults);
    scales[c] = required > 0 ? round1(clamp((current / required) * 100, 0, 100)) : 0;
  });
  return scales;
}

// Công trình tham gia tính độ phủ (đã duyệt, thuộc 8 mã — THPT mang mã 4-TH nên cũng nằm trong đây)
function isCoverageItem(it) {
  return isApprovedStatus(it.status) && it.lat != null && it.lng != null
    && CODES.includes(constants.resolveTypeCode(it));
}

function coverageItemsInWard(list, wardName, evaluatedWards) {
  return list.filter(it => isCoverageItem(it) && assignWardByGeometry(it.lng, it.lat, evaluatedWards) === wardName);
}

// Chữ ký dữ liệu đầu vào độ phủ: đổi khi thêm/bớt/duyệt/dời công trình hoặc đổi bán kính
function coverageSignature(items) {
  const parts = items.map(it => [
    it.id, it.lat, it.lng, it.radius, constants.resolveTypeCode(it),
    constants.isUrbanLevel(it) ? 1 : 0, constants.isThptItem(it) ? 1 : 0
  ].join('|')).sort();
  return crypto.createHash('md5').update(`v${COVERAGE_ALGO_VERSION}#${parts.join(';')}`).digest('hex').slice(0, 12);
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
  const levelSplitCodes = ["1-CV", "2-BDX", "6-YT", "7-VH", "8-TM"];
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
    scale: 60,
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
    const { ee, wardVectorParsed, popRasterNormalized } = getGeeContext();

    // --- Thao tác cần Earth Engine nhưng không cần danh sách công trình ---
    if (action === 'addPoint') {
      requirePostFromApp(req);
      checkAddPointRate(req);
      const body = readJsonBody(req);
      const type = String(body.type || '');
      const name = sanitizeSheetText(body.name, 150);
      const nhomHaTang = body.nhomHaTang === 'Cấp đô thị' ? 'Cấp đô thị' : 'Cấp đơn vị ở';
      const phase = body.phase === 'QH' ? 'QH' : 'HT';
      const size = Number(body.size || 0);
      const pt = parseCoordInBounds(body.lat, body.lng);

      if (![...CODES, '9-CSD'].includes(type)) return res.status(400).json({ error: true, message: "Loại hạ tầng không hợp lệ" });
      if (!name) return res.status(400).json({ error: true, message: "Thiếu tên công trình" });
      if (!pt) return res.status(400).json({ error: true, message: "Tọa độ không hợp lệ hoặc nằm ngoài TP. Huế" });
      if (!Number.isFinite(size) || size < 0 || size > 1e8) return res.status(400).json({ error: true, message: "Diện tích không hợp lệ" });
      if (phase === 'QH' && !(size > 0)) return res.status(400).json({ error: true, message: "Điểm quy hoạch mới cần diện tích > 0" });

      const evaluatedWardsForAdd = await loadEvaluatedWards(wardVectorParsed);
      const geoWard = assignWardByGeometry(pt.lng, pt.lat, evaluatedWardsForAdd);
      if (!geoWard) return res.status(400).json({ error: true, message: "Vị trí nằm ngoài ranh giới 40 phường/xã" });

      const result = await callAppsScript({
        action: 'addPoint',
        type,
        nhomHaTang,
        name,
        ward: geoWard,
        lat: pt.lat.toFixed(6),
        lng: pt.lng.toFixed(6),
        size: String(size),
        phase
      });
      invalidateAllCaches();
      return res.status(200).json({ success: true, id: result.id || null, ward: geoWard });
    }

    if (action === 'analyzePoint') {
      const pt = parseCoordInBounds(req.query.lat, req.query.lng);
      if (!pt) return res.status(400).json({ error: true, message: "Tọa độ không hợp lệ" });
      const radius = parseRadius(req.query.radius);

      const polyCoords = await calculateNetworkIsochrone16(pt.lat, pt.lng, radius);
      const servedPopRes = await eeEvaluate(popRasterNormalized.reduceRegion({
        reducer: ee.Reducer.sum(),
        geometry: ee.Geometry(polyCoords),
        scale: 30,
        maxPixels: 1e9
      }));

      const servedPop = Math.round(servedPopRes ? servedPopRes.DanSoPixelNormalized || 0 : 0);
      return res.status(200).json({ servedPop });
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
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
      const mapId = await new Promise((resolve, reject) => {
        popRasterNormalized.getMap(
          { min: 0, max: 5, palette: ['blue', 'cyan', 'green', 'yellow', 'orange', 'red'] },
          (m, err) => err ? reject(err) : resolve(m)
        );
      });
      return res.status(200).json({ urlFormat: mapId.urlFormat });
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
    // Mọi phép tính hiện trạng chỉ dùng công trình có QuyMo_HT (ô trống = hiện tại chưa hình thành)
    const rawDataList = allDataList.filter(it => it.planChange !== 'new' && it.planChange !== 'none');

    if (action === 'analyzeCSD') {
      const pt = parseCoordInBounds(req.query.lat, req.query.lng);
      if (!pt) return res.status(400).json({ error: true, message: "Tọa độ không hợp lệ" });
      const { lat, lng } = pt;
      const size = clamp(Number(req.query.size) || 0, 0, 1e8);

      const evaluatedWardsCsd = await loadEvaluatedWards(wardVectorParsed);
      const targetWardName = assignWardByGeometry(lng, lat, evaluatedWardsCsd);
      const wardFeat = targetWardName ? findWardByName(evaluatedWardsCsd, targetWardName) : null;
      const targetWardProjPop = wardFeat ? Math.round(Number(wardFeat.pop || 0) * constants.POP_GROWTH) : 0;

      const approvedAll = rawDataList.filter(item => isApprovedStatus(item.status) && item.lat != null && item.lng != null);
      const wardExistAreas = {};
      if (targetWardName) {
        approvedAll.forEach(item => {
          if (assignWardByGeometry(item.lng, item.lat, evaluatedWardsCsd) !== targetWardName) return;
          const t = metricCode(item);
          if (t) wardExistAreas[t] = (wardExistAreas[t] || 0) + Number(item.size || 0);
        });
      }

      let wardTotalPopPix = 0;
      if (wardFeat && wardFeat.geometry && popRasterNormalized) {
        try {
          const totalRes = (await eeEvaluate(popRasterNormalized.reduceRegion({
            reducer: ee.Reducer.count(),
            geometry: ee.Geometry(wardFeat.geometry),
            scale: 60,
            maxPixels: 1e9
          }))) || {};
          wardTotalPopPix = Number(totalRes.DanSoPixelNormalized || totalRes.count || 0);
        } catch (e) {
          console.warn("analyzeCSD: không đếm được pixel dân cư của phường:", e.message);
        }
      }

      const suggestions = [];
      const ineligible = [];

      await Promise.all(CODES.map(async (code) => {
        const infraCfg = constants.infraConfig ? constants.infraConfig[code] : null;
        const reqMinSize = infraCfg ? infraCfg.minSize : 0;
        const label = infraCfg ? infraCfg.label : code;

        if (size < reqMinSize) {
          ineligible.push({ code, label, minSize: reqMinSize });
          return;
        }

        const reqArea = Math.round(targetWardProjPop * (constants.quotaConfig[code] || 0));
        const existArea = wardExistAreas[code] || 0;
        const scalePct = reqArea > 0 ? (existArea / reqArea) * 100 : 100;
        if (scalePct >= 100) return;

        const deficitArea = reqArea - existArea;
        const scaleAddPct = Number(Math.min(100, Math.max(0, (size / Math.max(reqArea, 1)) * 100)).toFixed(1));
        const candidateRadius = (infraCfg && infraCfg.radius) || 1000;

        // Chỉ công trình cùng loại đủ gần mới có thể chồng lên buffer ứng viên
        const existingSame = approvedAll.filter(item => metricCode(item) === code
          && distMeters(lat, lng, item.lat, item.lng) <= candidateRadius + (Number(item.radius) || candidateRadius));

        let cleanPopGained = null;
        let coverageAddPct = null;
        if (wardTotalPopPix > 0) {
          try {
            let netBufferGeom = ee.Geometry.Point([lng, lat]).buffer(candidateRadius);
            if (existingSame.length > 0) {
              const existUnion = ee.FeatureCollection(existingSame.map(item =>
                ee.Feature(ee.Geometry.Point([item.lng, item.lat]).buffer(Number(item.radius) || candidateRadius))
              )).geometry();
              netBufferGeom = netBufferGeom.difference(existUnion, 1);
            }
            // Tử số chỉ tính phần nằm trong phường, cùng phạm vi với mẫu số (tổng pixel dân cư của phường)
            netBufferGeom = netBufferGeom.intersection(ee.Geometry(wardFeat.geometry), 1);
            const netPopRes = (await eeEvaluate(popRasterNormalized.reduceRegion({
              reducer: ee.Reducer.count(),
              geometry: netBufferGeom,
              scale: 60,
              maxPixels: 1e9
            }))) || {};
            cleanPopGained = Math.max(0, Math.round(Number(netPopRes.DanSoPixelNormalized || netPopRes.count || 0)));
            coverageAddPct = Number(Math.min(100, (cleanPopGained / wardTotalPopPix) * 100).toFixed(1));
          } catch (e) {
            console.warn(`analyzeCSD ${code}: GEE lỗi, dùng ước lượng hình học:`, e.message);
          }
        }
        if (coverageAddPct === null) {
          coverageAddPct = estimateCoverageAddPct({
            lat, lng,
            radius: candidateRadius,
            wardGeometry: wardFeat ? wardFeat.geometry : null,
            existingSameType: existingSame
          });
        }

        suggestions.push({
          code,
          label,
          deficitArea: Math.max(0, deficitArea),
          coverageRatio: coverageAddPct,
          scaleAddPct,
          coverageAddPct,
          isWardDeficit: deficitArea > 0,
          popGained: cleanPopGained
        });
      }));

      suggestions.sort((a, b) => {
        if (b.coverageAddPct !== a.coverageAddPct) return b.coverageAddPct - a.coverageAddPct;
        return b.scaleAddPct - a.scaleAddPct;
      });

      // Tối đa 2 lựa chọn
      const topSuggestions = suggestions.slice(0, 2);
      if (topSuggestions.length > 0) {
        topSuggestions[0].isTopPriority = true;
      }

      return res.status(200).json({ ward: targetWardName, suggestions: topSuggestions, ineligible });
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
          && (now - lastWardStatsFetch < constants.WARD_STATS_CACHE_TTL)) {
        cachedWardStats.forEach(applyCachedCoverage);
        return res.status(200).json({ data: cachedWardStats, coverageStatus: 'cached' });
      }
      cachedWardStats = null;

      const evaluatedWards = await loadEvaluatedWards(wardVectorParsed);
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
          currentUnits: Math.max(1, Math.round(totalPop / constants.POP_PER_UNIT)),
          projectedUnits: Math.max(1, Math.round(projPop / constants.POP_PER_UNIT)),
          items: [],
          byCode: {},
          covItems: [],
          pendingItems: [],
          csdRaw: [],
          planItems: [],
          planCovItems: [],
          planCovChanges: []
        };
      });

      // 1 lượt duyệt hiện trạng: phân loại công trình theo phường
      rawDataList.forEach(item => {
        if (item.lat == null || item.lng == null) return;
        const w = wardMap[wardOf(item)];
        if (!w) return;
        const prefix = String(item.id || '').split('-')[0];
        const nhom = String(item.nhomHaTang || '').toLowerCase();
        const approved = isApprovedStatus(item.status);
        const typeCode = item.type || constants.codeMap[prefix] || "";
        const isCSD = (typeCode === "9-CSD" || prefix === "CSD" || prefix === "9"
          || nhom.includes("chưa sử dụng") || nhom.includes("csd"));
        if (isCoverageItem(item)) w.covItems.push(item);

        if (isCSD) {
          w.csdRaw.push(item);
        } else if (approved) {
          w.items.push(item);
          const code = metricCode(item);
          if (code) (w.byCode[code] = w.byCode[code] || []).push(item);
        } else if (CODES.includes(typeCode)) {
          w.pendingItems.push(item);
        }
      });

      getPlanScenarioItems(allDataList).forEach(item => {
        if (item.lat == null || item.lng == null) return;
        const w = wardMap[wardOf(item)];
        if (!w) return;
        if (isCoverageItem(item)) w.planCovItems.push(item);
        if (item.type !== "9-CSD") w.planItems.push(item);
      });
      allDataList.forEach(item => {
        if (item.planChange !== 'new' && item.planChange !== 'relocate') return;
        if (!isApprovedStatus(item.status) || item.lat == null || item.lng == null) return;
        const w = wardMap[wardOf(item)];
        if (w) w.planCovChanges.push(item.id);
      });

      const resultTable = [];

      for (const wName in wardMap) {
        const data = wardMap[wName];
        const pop = data.Dan_So_Vector;
        const projPop = data.projectedPopulation;
        const wardGeom = data.meta.geometry;

        const { urbanResults, unitResults } = bucketWardInfra(data.items, projPop);
        const scales = scaleByCode(urbanResults, unitResults, projPop);
        const planBuckets = bucketWardInfra(data.planItems, projPop, { withSubItems: false });
        const planScales = scaleByCode(planBuckets.urbanResults, planBuckets.unitResults, projPop);

        // Gợi ý chuyển đổi quỹ đất chưa sử dụng (CSD)
        const csdItems = data.csdRaw.map(item => {
          const csdSize = Number(item.size || item.dienTich || 0);
          const evaluatedSuggestions = CODES.map(code => {
            const infraCfg = constants.infraConfig ? constants.infraConfig[code] : null;
            const reqMinSize = infraCfg ? infraCfg.minSize : 0;
            const label = infraCfg ? infraCfg.label : code;
            const candidateRadius = (infraCfg && infraCfg.radius) || 1000;

            if (csdSize < reqMinSize) {
              return { code, label, status: 'ineligible' };
            }

            const reqArea = Math.round(projPop * (constants.quotaConfig[code] || 0));
            const existArea = codeCurrentArea(code, urbanResults, unitResults);
            const scalePct = reqArea > 0 ? (existArea / reqArea) * 100 : 100;

            if (scalePct >= 100) {
              return { code, label, status: 'fulfilled' };
            }

            const deficitArea = Math.max(0, reqArea - existArea);
            const scaleAddPct = Number(Math.min(100, Math.max(0, (csdSize / Math.max(reqArea, 1)) * 100)).toFixed(1));
            const coverageAddPct = estimateCoverageAddPct({
              lat: item.lat,
              lng: item.lng,
              radius: candidateRadius,
              wardGeometry: wardGeom,
              existingSameType: data.byCode[code] || []
            });

            return {
              code,
              label,
              deficitArea,
              coverageRatio: coverageAddPct,
              scaleAddPct,
              coverageAddPct,
              radiusUsed: candidateRadius,
              isWardDeficit: deficitArea > 0,
              status: 'eligible'
            };
          });

          const eligibleSorted = evaluatedSuggestions
            .filter(s => s.status === 'eligible')
            .sort((a, b) => {
              if (b.coverageAddPct !== a.coverageAddPct) return b.coverageAddPct - a.coverageAddPct;
              return b.scaleAddPct - a.scaleAddPct;
            });

          if (eligibleSorted.length > 0) eligibleSorted[0].isTopPriority = true;

          // Chỉ giữ tối đa 2 lựa chọn ưu tiên + danh sách ineligible (nếu cần)
          return {
            id: item.id,
            name: item.name || item.ten || "Khu đất chưa sử dụng",
            size: csdSize,
            lat: item.lat,
            lng: item.lng,
            radius: Number(item.radius || item.banKinh || 1000),
            suggestions: [...eligibleSorted.slice(0, 2), ...evaluatedSuggestions.filter(s => s.status === 'ineligible')],
            status: item.status,
            needsApproval: !isApprovedStatus(item.status)
          };
        });

        const pendingItems = data.pendingItems.map(item => {
          const code = constants.resolveTypeCode(item) || item.type || "9-CSD";
          const size = Number(item.size || 0);
          const reqArea = Math.max(1, Math.round((constants.quotaConfig[code] || 0) * projPop));
          const scaleAddPct = Number(Math.min(100, Math.max(0, (size / reqArea) * 100)).toFixed(1));
          const infraCfg = constants.infraConfig ? constants.infraConfig[code] : null;
          const candidateRadius = (infraCfg && infraCfg.radius) || Number(item.radius || item.banKinh) || 1000;
          const coverageAddPct = estimateCoverageAddPct({
            lat: item.lat,
            lng: item.lng,
            radius: candidateRadius,
            wardGeometry: wardGeom,
            existingSameType: data.byCode[metricCode(item)] || []
          });
          return {
            id: item.id,
            name: item.name,
            type: code,
            typeLabel: (infraCfg && infraCfg.label) || code,
            size,
            lat: item.lat,
            lng: item.lng,
            radius: candidateRadius,
            status: item.status,
            scaleAddPct,
            coverageAddPct
          };
        });

        const calculatedRow = {
          Ten_Phuong: wName,
          Dan_So_Vector: pop,
          projectedPopulation: projPop,
          currentUnits: data.currentUnits,
          projectedUnits: data.projectedUnits,
          urbanResults,
          unitResults,
          csdItems,
          pendingItems,
          dvccSummary: {
            totalArea: (unitResults["YT_DV"]?.currentArea || 0) + (unitResults["VH_DV"]?.currentArea || 0) + (unitResults["TM_DV"]?.currentArea || 0),
            requiredArea: constants.unitInfraConfig.DVCC_TOTAL.quota * projPop,
            status: false
          }
        };

        let totalScaleSum = 0;
        let totalScaleQHSum = 0;
        CODES.forEach(c => {
          calculatedRow[`Scale_${c}`] = scales[c];
          calculatedRow[`ScaleQH_${c}`] = planScales[c];
          totalScaleSum += scales[c];
          totalScaleQHSum += planScales[c];
        });
        calculatedRow.Avg_Scale_Score = Number((totalScaleSum / CODES.length).toFixed(1));
        calculatedRow.Avg_Scale_QH = Number((totalScaleQHSum / CODES.length).toFixed(1));

        calculatedRow.covSig = coverageSignature(data.covItems);
        // Độ phủ QH chỉ khác HT khi phường có công trình mới/di dời (mở rộng/thu hẹp không đổi bán kính)
        calculatedRow.planCovSig = data.planCovChanges.length ? coverageSignature(data.planCovItems) : '';
        calculatedRow._assignMode = 'geometry';
        calculatedRow._schema = 7;
        applyCachedCoverage(calculatedRow);

        resultTable.push(calculatedRow);
      }

      resultTable.sort((a, b) => b.Dan_So_Vector - a.Dan_So_Vector);

      cachedWardStats = resultTable;
      cachedWardStatsVersion = getDataVersion();
      lastWardStatsFetch = now;

      return res.status(200).json({ data: resultTable, coverageStatus: 'per_ward' });
    }

    const planDataList = allDataList.filter(it => it.planChange === 'new');
    return res.status(200).json({ rawDataList, planDataList });

  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error("GEE API Error:", err);
    return res.status(status).json({ error: true, message: err.message || 'Lỗi máy chủ' });
  }
};
