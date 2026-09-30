const axios = require('axios');
const crypto = require('crypto');
const constants = require('../config/constants');
const { initGEE, getGeeContext, eeEvaluate, applyPopEdits, getPopEditsVersion } = require('../services/geeService');
const { getRawDataList, getCadParcels, invalidateCache, getDataVersion } = require('../services/gcsService');
const { requireAdmin, httpError } = require('../services/authService');
const roads = require('../services/roadsService');
const popEdits = require('../services/popEditsService');

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
  let geometry = point ? null : parseCadGeometry(s.geometry);
  if (geometry && JSON.stringify(geometry).length > CAD_GEOJSON_MAX_CHARS) geometry = null;
  return {
    phase, point, crossWard, area: areaRounded, size: crossWard ? 0 : areaRounded,
    layer: sanitizeSheetText(s.layer, 60) || fallbackLayer, geometry
  };
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
  return {
    type, idPrefix,
    nhom: it.nhom === 'Cấp đô thị' ? 'Cấp đô thị' : 'Cấp đơn vị ở',
    name: sanitizeSheetText(it.name, 150) || `${layer} (DXF)`,
    ward, layer, matchId, crossWard: first.crossWard, point,
    lat: pt.lat.toFixed(6), lng: pt.lng.toFixed(6),
    area: first.area,
    size: first.size,
    geometry: first.geometry,
    stages
  };
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
    res = body
      ? await axios.post(url, JSON.stringify(body), { ...opts, headers: { 'Content-Type': 'application/json' }, maxBodyLength: Infinity })
      : await axios.get(url, opts);
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
  applyPopEdits(data.saved, data.edits);
  cachedWardStats = null;
  cachedCoverageByWard = {};
  wardPopPixelCache.clear();
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

/** Bán kính vùng phục vụ của khu đất khi xét loại `code`: theo quy chuẩn của loại và hồ sơ phường/xã */
function csdCandidateRadius(csd, code, profile) {
  return constants.unitRadius(code, profile);
}

/** Công trình cùng loại đã duyệt (toàn TP, kể cả phường bên cạnh) có buffer chạm tới buffer ứng viên */
function nearbySameType(approvedAll, code, lat, lng, radius) {
  return approvedAll.filter(it => metricCode(it) === code
    && distMeters(lat, lng, Number(it.lat), Number(it.lng)) <= radius + (Number(it.radius) || radius));
}

/** Buffer ứng viên ∩ phường, và phần còn trống = (buffer − hợp các buffer cùng loại) ∩ phường */
function candidateGeometries(ee, { lat, lng, radius, existing, ward }) {
  const wardGeom = ee.Geometry(ward.geometry);
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
    const s = {
      code, label, status: 'eligible',
      deficitArea: reqArea - existArea,
      isWardDeficit: true,
      scaleAddPct: round1(clamp((size / reqArea) * 100, 0, 100)),
      radiusUsed: radius,
      existingCount: existing.length,
      coverageAddPct: 0
    };
    suggestions.push(s);
    candidates.push({ lat: csd.lat, lng: csd.lng, radius, existing, ward, target: s });
  });
  return { suggestions, candidates };
}

/** Xếp ưu tiên: % dân cư được phục vụ thêm giảm dần, bằng nhau thì theo % quy mô bổ sung */
function rankEligible(suggestions) {
  const eligible = suggestions
    .filter(s => s.status === 'eligible')
    .sort((a, b) => (b.coverageAddPct - a.coverageAddPct) || (b.scaleAddPct - a.scaleAddPct));
  if (eligible.length > 0) eligible[0].isTopPriority = true;
  return eligible;
}

/**
 * Đếm pixel dân cư mới được phục vụ cho mọi ứng viên trong 1 lần gọi GEE, quy đổi % theo tổng pixel dân cư của phường.
 * GEE lỗi / quá hạn → ước lượng hình học (coverageMethod = 'estimate'). Trả về true nếu mọi ứng viên đếm được bằng pixel.
 */
async function fillCoverageGains(ee, popRaster, candidates) {
  if (!candidates.length) return true;
  const regions = candidates.map((c, i) => ({ key: `c${i}`, geometry: candidateGeometries(ee, c).net }));
  const wardGeoms = new Map();
  candidates.forEach(c => {
    if (!wardPopPixelCache.has(c.ward.name)) wardGeoms.set(c.ward.name, c.ward.geometry);
  });
  const wardKeys = [...wardGeoms.keys()];
  wardKeys.forEach((name, i) => regions.push({ key: `w${i}`, geometry: ee.Geometry(wardGeoms.get(name)) }));

  let counts = null;
  try {
    counts = await withTimeout(countPopPixels(ee, popRaster, regions), 30000, null);
  } catch (e) {
    console.warn("fillCoverageGains: GEE lỗi, dùng ước lượng hình học:", e.message);
  }
  if (counts) wardKeys.forEach((name, i) => wardPopPixelCache.set(name, counts[`w${i}`] || 0));

  let allPixel = true;
  candidates.forEach((c, i) => {
    const wardTotal = counts ? (wardPopPixelCache.get(c.ward.name) || 0) : 0;
    if (counts && wardTotal > 0) {
      const gained = counts[`c${i}`] || 0;
      Object.assign(c.target, {
        popGained: gained,
        wardPopPixels: wardTotal,
        coverageAddPct: round1(clamp((gained / wardTotal) * 100, 0, 100)),
        coverageMethod: 'pixel'
      });
    } else {
      allPixel = false;
      Object.assign(c.target, {
        popGained: null,
        coverageAddPct: estimateCoverageAddPct({
          lat: c.lat, lng: c.lng, radius: c.radius, wardGeometry: c.ward.geometry, existingSameType: c.existing
        }),
        coverageMethod: 'estimate'
      });
    }
  });
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
  const sheetRadius = constants.radiusMismatch(item, profile);
  if (sheetRadius != null) slim.sheetRadius = sheetRadius;
  return slim;
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
    bucket.currentArea += Number(item.size || 0);
    if (withSubItems) bucket.subItems.push(slimItem(item, profile));
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

    if (action === 'getCadParcels') {
      const parcels = await getCadParcels();
      return res.status(200).json({ parcels });
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
      return res.status(200).json({ v: 1, saved: d.saved, edits: d.edits });
    }

    // Ghi đè toàn bộ vùng hiệu chỉnh; base = phiên bản client đang sửa (khác bản trên bucket → 409)
    if (action === 'savePopEdits') {
      requirePostFromApp(req);
      await requireAdmin(req);
      const body = readJsonBody(req);
      const list = popEdits.parsePopEdits(body.edits);
      if (!list) return res.status(400).json({ error: true, message: 'Dữ liệu vùng hiệu chỉnh dân cư không hợp lệ' });
      const current = await popEdits.readPopEdits(true);
      if (Math.round(Number(body.base) || 0) !== current.saved) {
        return res.status(409).json({ error: true, message: 'Vùng hiệu chỉnh dân cư vừa được sửa ở phiên khác — mở lại panel để tải bản mới' });
      }
      const payload = { v: 1, saved: Date.now(), edits: list };
      const content = JSON.stringify(payload);
      if (content.length > popEdits.MAX_CHARS) return res.status(413).json({ error: true, message: 'Danh sách vùng hiệu chỉnh quá lớn' });
      const result = await callAppsScript({ action: 'savePopEdits' }, { action: 'savePopEdits', content });
      if (result.saved !== true) {
        return res.status(502).json({ error: true, message: 'Apps Script chưa ghi được lên bucket (đã triển khai phiên bản mới của Code.gs chưa?)' });
      }
      popEdits.rememberPopEdits(payload);
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
      const rawItems = Array.isArray(body.items) ? body.items : [];
      if (!rawItems.length || rawItems.length > CAD_BATCH_MAX) {
        return res.status(400).json({ error: true, message: `Mỗi lần gửi 1–${CAD_BATCH_MAX} lô` });
      }
      const phase = body.phase === 'QH' ? 'QH' : 'HT';
      const items = [];
      for (let i = 0; i < rawItems.length; i++) {
        const item = parseCadItem(rawItems[i], phase);
        if (!item) return res.status(400).json({ error: true, message: `Lô thứ ${i + 1} không hợp lệ (loại, tọa độ, phường, diện tích hoặc giai đoạn)` });
        items.push(item);
      }
      const sync = body.sync !== false;
      const result = await callAppsScript({ action: 'importCadBatch' }, {
        action: 'importCadBatch',
        phase,
        fileName: sanitizeSheetText(body.fileName, 120) || 'DXF',
        sync,
        items
      });
      if (sync) invalidateAllCaches();
      return res.status(200).json({
        success: true,
        created: result.created || [],
        updated: result.updated || [],
        skipped: result.skipped || [],
        polygonsDropped: items.reduce((n, it) => n + it.stages.filter(s => !s.geometry && !s.point).length, 0)
      });
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
    const { ee, wardVectorParsed, popRasterNormalized, popRasterNative, popProjection } = getGeeContext();

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
      const isPost = req.method === 'POST';
      const src = isPost ? readJsonBody(req) : req.query;
      const pt = parseCoordInBounds(src.lat, src.lng);
      if (!pt) return res.status(400).json({ error: true, message: "Tọa độ không hợp lệ" });
      const radius = parseRadius(src.radius);

      let polyCoords;
      if (isPost) {
        const ring = parseServiceRing(src.polygon, pt, radius);
        if (!ring) return res.status(400).json({ error: true, message: "Vùng phục vụ không hợp lệ" });
        polyCoords = { type: 'Polygon', coordinates: [ring] };
      } else {
        polyCoords = await calculateNetworkIsochrone16(pt.lat, pt.lng, radius);
      }
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
      const approvedInWard = approvedAll.filter(it => assignWardByGeometry(it.lng, it.lat, evaluatedWardsCsd) === wardName);
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
      return res.status(200).json({
        code,
        label: cand.target.label,
        ward: ward.name,
        candidate: { id: csd.id, name: csd.name || null, lat: csd.lat, lng: csd.lng, radius: cand.radius },
        existing: cand.existing.map(it => ({ id: it.id, name: it.name, lat: it.lat, lng: it.lng, radius: Number(it.radius) || cand.radius })),
        netGeometry: netGeoJson,
        pixels: { buffer: bufferPix, covered: Math.max(0, bufferPix - netPix), net: netPix, wardTotal },
        coverageAddPct: wardTotal > 0 ? round1(clamp((netPix / wardTotal) * 100, 0, 100)) : 0,
        scaleAddPct: cand.target.scaleAddPct,
        population: {
          ward: ward.pop,
          perPixel: popPerPixel,
          added: Math.round(popPerPixel * netPix)
        },
        pixelSize,
        tileUrl: mapId.urlFormat
      });
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
      const approvedAll = rawDataList.filter(it => isApprovedStatus(it.status) && it.lat != null && it.lng != null);
      const coverageCandidates = [];
      const rankAfterCount = [];

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
          const code = constants.resolveTypeCode(item) || item.type || "9-CSD";
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

      const allPixel = await fillCoverageGains(ee, popRasterNative, coverageCandidates);
      rankAfterCount.forEach(fn => fn());

      resultTable.sort((a, b) => b.Dan_So_Vector - a.Dan_So_Vector);

      // Kết quả ước lượng (GEE lỗi) không giữ trong cache để lần sau đếm lại bằng pixel
      cachedWardStats = allPixel ? resultTable : null;
      cachedWardStatsVersion = getDataVersion();
      lastWardStatsFetch = now;

      return res.status(200).json({ data: resultTable, coverageStatus: 'per_ward' });
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
