const axios = require('axios');
const constants = require('../config/constants');
const { initGEE, getGeeContext } = require('../services/geeService');
const { getRawDataList, invalidateCache } = require('../services/gcsService');

let cachedWardStats = null;
let lastWardStatsFetch = 0;
/** Cache độ phủ theo phường (ghi nhớ khi tính nền / mở chi tiết) */
let cachedCoverageByWard = {};

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

function isApprovedStatus(status) {
  return status === true || String(status).trim().toUpperCase() === 'TRUE';
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

function checkPointInGeoJSONGeometry(ptLng, ptLat, geometry) {
  if (!geometry || !geometry.coordinates) return false;
  const type = geometry.type;
  const coords = geometry.coordinates;
  try {
    if (type === 'Polygon') {
      return isPointInPolygon([ptLng, ptLat], coords[0]);
    }
    if (type === 'MultiPolygon') {
      for (const polyCoords of coords) {
        if (isPointInPolygon([ptLng, ptLat], polyCoords[0])) return true;
      }
    }
  } catch (e) {}
  return false;
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

  const isCoveredByExisting = (pLat, pLng) => {
    for (const ex of existingSameType || []) {
      if (ex.lat == null || ex.lng == null) continue;
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

async function loadEvaluatedWards(wardVectorParsed) {
  const now = Date.now();
  if (cachedEvaluatedWards && (now - cachedEvaluatedWardsAt < constants.WARD_STATS_CACHE_TTL)) {
    return cachedEvaluatedWards;
  }
  const wardList = await new Promise((resolve, reject) => {
    wardVectorParsed.evaluate((fc, err) => err ? reject(err) : resolve(fc ? fc.features : []));
  });
  const evaluatedWards = [];
  wardList.forEach(f => {
    const props = f.properties || {};
    const wName = props.tenXa || props.NAME_2 || props.name || 'Phường';
    const totalPop = Number(props.danSoNum || props.danSo || 10000);
    evaluatedWards.push({
      name: wName,
      pop: totalPop,
      geometry: f.geometry || null
    });
  });
  cachedEvaluatedWards = evaluatedWards;
  cachedEvaluatedWardsAt = now;
  return evaluatedWards;
}

function assignWardByGeometry(ptLng, ptLat, evaluatedWards) {
  for (const w of evaluatedWards) {
    if (w.geometry && checkPointInGeoJSONGeometry(ptLng, ptLat, w.geometry)) {
      return w.name;
    }
  }
  return null;
}

/**
 * Độ phủ 1 phường: 8 loại + tách đô thị/đơn vị ở (tránh ghi đè DT vs DV).
 */
async function computeSingleWardCoverage(ee, popRasterNormalized, wardGeometry, itemsInWard) {
  const codesList = constants.CODES_TO_CHECK || ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];
  const levelSplitCodes = ["1-CV", "2-BDX", "6-YT", "7-VH", "8-TM"];
  const ratios = {};
  codesList.forEach(c => { ratios[c] = 0; });
  levelSplitCodes.forEach(c => {
    ratios[`${c}_DT`] = 0;
    ratios[`${c}_DV`] = 0;
  });
  ratios.THPT = 0;

  if (!popRasterNormalized || !wardGeometry) {
    return { ratios, Avg_Coverage_Score: 0 };
  }

  const resolveType = (it) => constants.resolveTypeCode(it);
  const isUrbanItem = (it) => constants.isUrbanLevel(it);
  const isThptItem = (it) => {
    const prefix = String(it.id || '').split('-')[0].toUpperCase();
    if (prefix === 'THPT') return true;
    const name = String(it.name || '')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/Đ/g, 'D');
    return name.includes('THPT') || name.includes('TRUNG HOC PHO THONG');
  };

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

  const itemsOfType = (code) => approved.filter(it => resolveType(it) === code);

  codesList.forEach(c => {
    const defaultR = (constants.infraConfig && constants.infraConfig[c] && constants.infraConfig[c].radius) || 500;
    pushBufferBand(bandKeyForCode(c), itemsOfType(c), defaultR);
  });

  levelSplitCodes.forEach(c => {
    const urbanR = (constants.urbanInfraConfig && (
      (c === '1-CV' && constants.urbanInfraConfig.CV_DT) ||
      (c === '2-BDX' && constants.urbanInfraConfig.BDX_DT) ||
      (c === '6-YT' && constants.urbanInfraConfig.YT_DT) ||
      (c === '7-VH' && constants.urbanInfraConfig.VH_DT) ||
      (c === '8-TM' && constants.urbanInfraConfig.TM_DT)
    ));
    const unitR = (constants.infraConfig && constants.infraConfig[c] && constants.infraConfig[c].radius) || 500;
    const urbanDefault = (urbanR && urbanR.radius) || 2000;
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

  const evalResult = await new Promise((resolve, reject) => {
    dict.evaluate((res, err) => err ? reject(err) : resolve(res || {}));
  });

  const totalPix = readPixProp(evalResult, 'pix_total');
  const pctFromBand = (bandName) => {
    const servedPix = readPixProp(evalResult, bandName);
    return totalPix > 0
      ? Number(Math.min(100, Math.max(0, (servedPix / totalPix) * 100)).toFixed(1))
      : 0;
  };

  let sum = 0;
  codesList.forEach(c => {
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
    Avg_Coverage_Score: Number((sum / (codesList.length || 1)).toFixed(1)),
    coverageSchema: 2,
    _debugCounts: {
      approved: approved.length,
      byType: Object.fromEntries(codesList.map(c => [c, itemsOfType(c).length])),
      byTypeDT: Object.fromEntries(levelSplitCodes.map(c => [c, itemsOfType(c).filter(isUrbanItem).length])),
      byTypeDV: Object.fromEntries(levelSplitCodes.map(c => [c, itemsOfType(c).filter(it => !isUrbanItem(it)).length])),
      thpt: approved.filter(isThptItem).length,
      totalPix
    }
  };
}

/**
 * Tối ưu độ phủ toàn TP: 8 vùng buffer + 1 band tổng — 1 lần evaluate (có thể chậm).
 */
async function computeWardCoverageRatios(ee, popRasterNormalized, rawDataList, wardVectorParsed) {
  const codesList = constants.CODES_TO_CHECK || ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];
  const coverageByWard = {};

  if (!popRasterNormalized || !wardVectorParsed) return coverageByWard;

  const wardFc = wardVectorParsed.map(f => {
    const name = ee.Algorithms.If(
      f.get('tenXa'), f.get('tenXa'),
      ee.Algorithms.If(f.get('NAME_2'), f.get('NAME_2'),
        ee.Algorithms.If(f.get('name'), f.get('name'), 'Phuong'))
    );
    return f.set('Ten_Phuong', ee.String(name));
  });

  const emptyMask = ee.Image.constant(0).selfMask();
  const bandImages = [popRasterNormalized.rename('pix_total')];

  codesList.forEach(c => {
    const bandName = bandKeyForCode(c);
    const matchingItems = rawDataList.filter(it =>
      isApprovedStatus(it.status) && constants.resolveTypeCode(it) === c && it.lat != null && it.lng != null
    );

    if (matchingItems.length === 0) {
      bandImages.push(popRasterNormalized.updateMask(emptyMask).rename(bandName));
      return;
    }

    const defaultR = (constants.infraConfig && constants.infraConfig[c] && constants.infraConfig[c].radius) || 500;
    const bufferFc = ee.FeatureCollection(matchingItems.map(it => {
      const effectiveR = Number(it.radius) || Number(it.banKinh) || defaultR;
      return ee.Feature(ee.Geometry.Point([Number(it.lng), Number(it.lat)]).buffer(effectiveR));
    }));

    const bufferMask = ee.Image(0).byte().paint({
      featureCollection: bufferFc,
      color: 1
    }).gt(0);

    bandImages.push(popRasterNormalized.updateMask(bufferMask).rename(bandName));
  });

  const stacked = ee.Image.cat(bandImages).clip(wardFc.geometry());
  const reduced = stacked.reduceRegions({
    collection: wardFc,
    reducer: ee.Reducer.count(),
    scale: 90,
    tileScale: 16,
    maxPixels: 1e9
  });

  const evaluated = await new Promise((resolve, reject) => {
    reduced.evaluate((fc, err) => err ? reject(err) : resolve(fc || { features: [] }));
  });

  (evaluated.features || []).forEach(feat => {
    const props = feat.properties || {};
    const name = props.Ten_Phuong;
    if (!name) return;
    if (!coverageByWard[name]) coverageByWard[name] = {};

    const totalPix = readPixProp(props, 'pix_total');
    codesList.forEach(c => {
      const servedPix = readPixProp(props, bandKeyForCode(c));
      coverageByWard[name][c] = totalPix > 0
        ? Number(Math.min(100, Math.max(0, (servedPix / totalPix) * 100)).toFixed(1))
        : 0;
    });
  });

  return coverageByWard;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const action = req.query.action || 'getInitData';

    await initGEE();
    const { ee, wardVectorParsed, popRasterNormalized, wardRegion } = getGeeContext();
    const rawDataList = await getRawDataList();

    if (action === 'getIsochrone') {
      let requestBody = req.body || {};
      if (typeof requestBody === 'string') {
        try { requestBody = JSON.parse(requestBody); } catch (e) { requestBody = {}; }
      }
      
      const features = requestBody.features;
      
      if (!features || !Array.isArray(features) || features.length === 0) {
        return res.status(200).json({ type: 'FeatureCollection', features: [] });
      }

      const validFeatures = features.filter(item => item && typeof item.lat === 'number' && typeof item.lng === 'number' && !isNaN(item.lat) && !isNaN(item.lng));
      if (validFeatures.length === 0) {
        return res.status(200).json({ type: 'FeatureCollection', features: [] });
      }

      try {
        const fc = ee.FeatureCollection(validFeatures.map(item => {
          const effectiveRadius = Number(item.radius) || Number(item.banKinh) || 500;
          const geom = ee.Geometry.Point([item.lng, item.lat]).buffer(effectiveRadius);
          const isApproved = (item.status === true || String(item.status).trim().toUpperCase() === 'TRUE');
          return ee.Feature(geom, {
            id: item.id || '',
            name: item.name || '',
            type: item.type || '',
            ward: item.ward || '',
            banKinh: effectiveRadius,
            status: isApproved
          });
        }));

        const evaluatedFc = await new Promise((resolve, reject) => {
          fc.evaluate((res, err) => err ? reject(err) : resolve(res));
        });

        return res.status(200).json(evaluatedFc || { type: 'FeatureCollection', features: [] });
      } catch (geeErr) {
        console.error("GEE Isochrone Error:", geeErr.message);
        return res.status(200).json({ type: 'FeatureCollection', features: [] });
      }
    }

    if (action === 'getSingleIsochrone') {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const banKinh = Number(req.query.radius) || 500;
      if (!lat || !lng) return res.status(400).json({ error: true, message: "Thiếu tọa độ" });

      const polyCoords = await calculateNetworkIsochrone16(lat, lng, banKinh);
      return res.status(200).json({
        type: 'Feature',
        geometry: polyCoords,
        properties: { banKinh }
      });
    }

    if (action === 'addPoint') {
      const { type, name, ward, lat, lng, size, nhomHaTang } = req.query;
      if (!type || !name || !lat || !lng) {
        return res.status(400).json({ error: true, message: "Thiếu thông tin bắt buộc" });
      }

      const syncUrl = `${constants.GAS_BASE_URL}?action=addPoint` +
        `&type=${encodeURIComponent(type)}` +
        `&nhomHaTang=${encodeURIComponent(nhomHaTang || 'Cấp đơn vị ở')}` +
        `&name=${encodeURIComponent(name)}` +
        `&ward=${encodeURIComponent(ward || 'Thuận Hóa')}` +
        `&lat=${lat}&lng=${lng}&size=${size || 0}`;

      invalidateCache();
      cachedWardStats = null;
      cachedCoverageByWard = {};
      const gasRes = await fetch(syncUrl);
      const result = await gasRes.json().catch(() => ({ success: true }));
      return res.status(200).json({ success: true, result });
    }

    if (action === 'approvePoint') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: true, message: "Thiếu ID công trình" });

      const syncUrl = `${constants.GAS_BASE_URL}?action=approvePoint&id=${encodeURIComponent(id)}`;
      invalidateCache();
      cachedWardStats = null;
      cachedCoverageByWard = {};
      const gasRes = await fetch(syncUrl);
      const result = await gasRes.json().catch(() => ({ success: true }));
      return res.status(200).json({ success: true, result });
    }

    if (action === 'analyzePoint') {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const radius = Number(req.query.radius) || 500;
      
      const polyCoords = await calculateNetworkIsochrone16(lat, lng, radius);
      const ptGeom = ee.Geometry(polyCoords);

      const servedPopRes = await new Promise((resolve, reject) => {
        popRasterNormalized.reduceRegion({
          reducer: ee.Reducer.sum(),
          geometry: ptGeom,
          scale: 30,
          maxPixels: 1e9
        }).evaluate((res, err) => err ? reject(err) : resolve(res));
      });

      const servedPop = Math.round(servedPopRes ? servedPopRes.DanSoPixelNormalized || 0 : 0);
      return res.status(200).json({ servedPop });
    }

    if (action === 'getHeatmapTile') {
      let requestBody = req.body || {};
      if (typeof requestBody === 'string') {
        try { requestBody = JSON.parse(requestBody); } catch (e) { requestBody = {}; }
      }

      const features = requestBody.features || [];
      const categoryImageLayers = [];
      const codes = constants.CODES_TO_CHECK;

      for (const code of codes) {
        const groupGeoms = features
          .filter(item => {
            const props = item.properties || item;
            const isApproved = (props.status === true || String(props.status).trim().toUpperCase() === 'TRUE');
            return props.type === code && isApproved && item.geometry;
          })
          .map(item => {
            try {
              return ee.Feature(ee.Geometry(item.geometry));
            } catch (err) {
              return null;
            }
          })
          .filter(geom => geom !== null);

        if (groupGeoms.length > 0) {
          categoryImageLayers.push(
            ee.Image(0).byte().paint({ 
              featureCollection: ee.FeatureCollection(groupGeoms), 
              color: 1 
            })
          );
        }
      }

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
        console.error("GEE GetMap Tile Error:", mapErr.message);
        return res.status(200).json({ urlFormat: "" });
      }
    }

    if (action === 'analyzeCSD') {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const size = Number(req.query.size) || 0;
      const rawWardParam = String(req.query.ward || '');
      const cleanTargetWard = constants.cleanWardStr(rawWardParam);

      if (!lat || !lng) return res.status(400).json({ error: true, message: "Thiếu tọa độ điểm" });

      const wardListEvaluated = await new Promise((resolve) => {
        wardVectorParsed.evaluate((fc) => resolve(fc ? fc.features : []));
      });

      let targetWardPop = 0;
      wardListEvaluated.forEach(f => {
        const props = f.properties || {};
        const wName = props.tenXa || props.NAME_2 || props.name || '';
        if (constants.cleanWardStr(wName) === cleanTargetWard) {
          targetWardPop = Number(props.danSoNum || 0);
        }
      });

      const wardExistAreas = {};
      rawDataList.forEach(item => {
        const isApproved = (item.status === true || String(item.status).trim().toUpperCase() === 'TRUE');
        if (isApproved && constants.cleanWardStr(item.ward) === cleanTargetWard) {
          const t = constants.resolveTypeCode(item) || item.type;
          if (!t) return;
          wardExistAreas[t] = (wardExistAreas[t] || 0) + Number(item.size || 0);
        }
      });

      const wardFeat = wardListEvaluated.find(f => {
        const props = f.properties || {};
        const wName = props.tenXa || props.NAME_2 || props.name || '';
        return constants.cleanWardStr(wName) === cleanTargetWard;
      });

      let wardTotalPopPix = 0;
      if (wardFeat && wardFeat.geometry && popRasterNormalized) {
        try {
          const totalRes = await new Promise((resolve) => {
            popRasterNormalized.reduceRegion({
              reducer: ee.Reducer.count(),
              geometry: ee.Geometry(wardFeat.geometry),
              scale: 60,
              maxPixels: 1e9
            }).evaluate((r) => resolve(r || {}));
          });
          wardTotalPopPix = Number(totalRes.DanSoPixelNormalized || totalRes.count || 0);
        } catch (e) {}
      }

      const codesToCheck = constants.CODES_TO_CHECK;
      const suggestions = [];
      const ineligible = [];

      const csdPromises = codesToCheck.map(async (code) => {
        const infraCfg = constants.infraConfig ? constants.infraConfig[code] : null;
        const reqMinSize = infraCfg ? infraCfg.minSize : 0;
        const label = infraCfg ? infraCfg.label : code;

        if (size < reqMinSize) {
          ineligible.push({ code, label, minSize: reqMinSize });
          return;
        }

        const normVal = constants.quotaConfig[code] || 0;
        const reqArea = Math.round(targetWardPop * normVal);
        const existArea = wardExistAreas[code] || 0;
        
        const scalePct = reqArea > 0 ? (existArea / reqArea) * 100 : 100;

        if (scalePct >= 100) {
          return; 
        }

        const deficitArea = reqArea - existArea;
        const scaleAddPct = Number(Math.min(100, Math.max(0, (size / Math.max(reqArea, 1)) * 100)).toFixed(1));

        const candidateRadius = (infraCfg && infraCfg.radius) || 1000;
        const testBuffer = ee.Geometry.Point([lng, lat]).buffer(candidateRadius);

        const existingBuffersPromises = rawDataList
          .filter(item => {
            const isApproved = (item.status === true || String(item.status).trim().toUpperCase() === 'TRUE');
            return constants.resolveTypeCode(item) === code && isApproved;
          })
          .map(async (item) => {
            const r = Number(item.radius) || Number(item.banKinh) || candidateRadius;
            return ee.Feature(ee.Geometry.Point([item.lng, item.lat]).buffer(r));
          });

        const existingBuffers = await Promise.all(existingBuffersPromises);

        let netBufferGeom = testBuffer;
        if (existingBuffers.length > 0) {
          const existUnion = ee.FeatureCollection(existingBuffers).geometry();
          netBufferGeom = testBuffer.difference(existUnion, 1);
        }

        const netPopRes = await new Promise((resolve) => {
          popRasterNormalized.reduceRegion({
            reducer: ee.Reducer.count(),
            geometry: netBufferGeom,
            scale: 60,
            maxPixels: 1e9
          }).evaluate((r) => resolve(r || {}));
        });

        let cleanPopGained = Math.max(0, Math.round(Number(netPopRes.DanSoPixelNormalized || netPopRes.count || 0)));

        if (cleanPopGained === 0) {
          const grossPopRes = await new Promise((resolve) => {
            popRasterNormalized.reduceRegion({
              reducer: ee.Reducer.count(),
              geometry: testBuffer,
              scale: 60,
              maxPixels: 1e9
            }).evaluate((r) => resolve(r || {}));
          });
          cleanPopGained = Math.max(0, Math.round(Number(grossPopRes.DanSoPixelNormalized || grossPopRes.count || 0)));
        }

        let coverageAddPct = 0;
        if (wardTotalPopPix > 0) {
          coverageAddPct = Number(Math.min(100, Math.max(0, (cleanPopGained / wardTotalPopPix) * 100)).toFixed(1));
        } else {
          coverageAddPct = estimateCoverageAddPct({
            lat, lng,
            radius: candidateRadius,
            wardGeometry: wardFeat ? wardFeat.geometry : null,
            existingSameType: rawDataList.filter(it =>
              isApprovedStatus(it.status) && constants.resolveTypeCode(it) === code
            )
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
      });

      await Promise.all(csdPromises);

      suggestions.sort((a, b) => {
        if (b.coverageAddPct !== a.coverageAddPct) return b.coverageAddPct - a.coverageAddPct;
        return b.scaleAddPct - a.scaleAddPct;
      });

      // Tối đa 2 lựa chọn
      const topSuggestions = suggestions.slice(0, 2);
      if (topSuggestions.length > 0) {
        topSuggestions[0].isTopPriority = true;
      }

      return res.status(200).json({ suggestions: topSuggestions, ineligible });
    }

    if (action === 'getWardCoverage') {
      const wardName = String(req.query.ward || '').trim();
      if (!wardName) {
        return res.status(400).json({ error: true, message: "Thiếu tên phường" });
      }

      const evaluatedWards = await loadEvaluatedWards(wardVectorParsed);
      const targetWard = evaluatedWards.find(w =>
        w.name === wardName || constants.cleanWardStr(w.name) === constants.cleanWardStr(wardName)
      );
      if (!targetWard || !targetWard.geometry) {
        return res.status(404).json({ error: true, message: "Không tìm thấy ranh giới phường" });
      }

      const itemsInWard = rawDataList.filter(item => {
        if (item.lat == null || item.lng == null) return false;
        if (!isApprovedStatus(item.status)) return false;
        return checkPointInGeoJSONGeometry(Number(item.lng), Number(item.lat), targetWard.geometry);
      });

      try {
        const result = await withTimeout(
          computeSingleWardCoverage(ee, popRasterNormalized, targetWard.geometry, itemsInWard),
          45000,
          { ratios: {}, Avg_Coverage_Score: 0, timedOut: true }
        );

        const payload = { ward: targetWard.name, ratios: {}, Avg_Coverage_Score: result.Avg_Coverage_Score || 0 };
        const ratioKeys = Object.keys(result.ratios || {});
        ratioKeys.forEach(c => {
          payload.ratios[c] = Number((result.ratios && result.ratios[c]) || 0);
          payload[`Ratio_${c}`] = payload.ratios[c];
        });
        // Giữ tương thích bảng tổng hợp 8 mã gốc
        const codesList = constants.CODES_TO_CHECK || ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];
        codesList.forEach(c => {
          if (payload.ratios[c] == null) payload.ratios[c] = 0;
          payload[`Ratio_${c}`] = payload.ratios[c];
        });
        payload.coverageSchema = result.coverageSchema || 2;
        if (result._debugCounts) payload.itemCounts = result._debugCounts;
        if (result.timedOut) payload.coverageStatus = 'timeout';
        else payload.coverageStatus = 'ok';

        if (!result.timedOut) {
          cachedCoverageByWard[targetWard.name] = {
            ratios: { ...payload.ratios },
            Avg_Coverage_Score: payload.Avg_Coverage_Score,
            at: Date.now()
          };
          if (cachedWardStats && Array.isArray(cachedWardStats)) {
            const row = cachedWardStats.find(w => w.Ten_Phuong === targetWard.name);
            if (row) {
              Object.keys(payload.ratios).forEach(c => { row[`Ratio_${c}`] = payload.ratios[c]; });
              row.Avg_Coverage_Score = payload.Avg_Coverage_Score;
              row._coverageReady = true;
            }
          }
        }

        return res.status(200).json(payload);
      } catch (err) {
        console.error("getWardCoverage error:", err && err.message);
        return res.status(500).json({ error: true, message: err.message || "Lỗi tính độ phủ" });
      }
    }

    if (action === 'getWardStats') {
      const now = Date.now();
      if (cachedWardStats && (now - lastWardStatsFetch < constants.WARD_STATS_CACHE_TTL)
          && cachedWardStats[0] && cachedWardStats[0]._assignMode === 'geometry'
          && cachedWardStats[0]._schema === 4) {
        return res.status(200).json({ data: cachedWardStats, coverageStatus: 'cached' });
      }
      cachedWardStats = null;

      const evaluatedWards = await loadEvaluatedWards(wardVectorParsed);

      const wardMap = {};
      evaluatedWards.forEach(w => {
        const totalPop = w.pop || 10000;
        wardMap[w.name] = {
          Ten_Phuong: w.name,
          Dan_So_Vector: totalPop,
          projectedPopulation: Math.round(totalPop * 1.2),
          currentUnits: Math.max(1, Math.round(totalPop / 20000)),
          projectedUnits: Math.max(1, Math.round((totalPop * 1.2) / 20000)),
          items: [],
          pendingItems: [],
          csdItems: []
        };
      });

      rawDataList.forEach(item => {
        if (item.lat == null || item.lng == null) return;
        const ptLng = Number(item.lng);
        const ptLat = Number(item.lat);

        const assignedWardName = assignWardByGeometry(ptLng, ptLat, evaluatedWards);

        if (assignedWardName && wardMap[assignedWardName]) {
          const prefix = String(item.id || '').split('-')[0];
          const nhom = String(item.nhomHaTang || '').toLowerCase();
          const isApproved = (item.status === true || String(item.status).trim().toUpperCase() === 'TRUE');
          const typeCode = item.type || constants.codeMap[prefix] || "";
          const isCSD = (typeCode === "9-CSD" || prefix === "CSD" || prefix === "9"
            || nhom.includes("chưa sử dụng") || nhom.includes("csd"));
          const codesToCheck = constants.CODES_TO_CHECK || ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];

          if (isCSD) {
            const csdSize = Number(item.size || item.dienTich || 0);
            const wardMeta = evaluatedWards.find(w => w.name === assignedWardName);
            const wardGeom = wardMeta ? wardMeta.geometry : null;

            const wardExistAreas = {};
            const wardExistByType = {};
            rawDataList.forEach(subItem => {
              const subApproved = (subItem.status === true || String(subItem.status).trim().toUpperCase() === 'TRUE');
              if (!subApproved || subItem.lat == null || subItem.lng == null) return;
              if (assignWardByGeometry(Number(subItem.lng), Number(subItem.lat), evaluatedWards) !== assignedWardName) return;
              const subType = constants.resolveTypeCode(subItem) || subItem.type;
              if (!subType || subType === '9-CSD') return;
              wardExistAreas[subType] = (wardExistAreas[subType] || 0) + Number(subItem.size || 0);
              if (!wardExistByType[subType]) wardExistByType[subType] = [];
              wardExistByType[subType].push(subItem);
            });

            const evaluatedSuggestions = codesToCheck.map(code => {
              const infraCfg = constants.infraConfig ? constants.infraConfig[code] : null;
              const reqMinSize = infraCfg ? infraCfg.minSize : 0;
              const label = infraCfg ? infraCfg.label : code;
              const candidateRadius = (infraCfg && infraCfg.radius) || 1000;

              if (csdSize < reqMinSize) {
                return { code, label, status: 'ineligible' };
              }

              const normVal = constants.quotaConfig ? (constants.quotaConfig[code] || 0) : 0;
              const reqArea = Math.round(wardMap[assignedWardName].Dan_So_Vector * normVal);
              const existArea = wardExistAreas[code] || 0;
              const scalePct = reqArea > 0 ? (existArea / reqArea) * 100 : 100;

              if (scalePct >= 100) {
                return { code, label, status: 'fulfilled' };
              }

              const deficitArea = Math.max(0, reqArea - existArea);
              const scaleAddPct = Number(Math.min(100, Math.max(0, (csdSize / Math.max(reqArea, 1)) * 100)).toFixed(1));
              const coverageAddPct = estimateCoverageAddPct({
                lat: ptLat,
                lng: ptLng,
                radius: candidateRadius,
                wardGeometry: wardGeom,
                existingSameType: wardExistByType[code] || []
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
            const topTwo = eligibleSorted.slice(0, 2);
            const ineligibleKeep = evaluatedSuggestions.filter(s => s.status === 'ineligible');

            wardMap[assignedWardName].csdItems.push({
              name: item.name || item.ten || "Khu đất chưa sử dụng",
              size: csdSize,
              lat: ptLat,
              lng: ptLng,
              radius: Number(item.radius || item.banKinh || 1000),
              suggestions: [...topTwo, ...ineligibleKeep],
              status: item.status,
              needsApproval: !isApproved
            });
          } else if (!isApproved && codesToCheck.includes(typeCode)) {
            wardMap[assignedWardName].pendingItems.push(item);
          } else if (isApproved) {
            wardMap[assignedWardName].items.push(item);
          }
        }
      });

      // Độ phủ: lấy từ cache đã tính nền / chi tiết phường; phần còn thiếu client tính tiếp.
      const coverageByWard = {};
      Object.keys(cachedCoverageByWard).forEach(name => {
        coverageByWard[name] = cachedCoverageByWard[name].ratios || {};
      });
      const coverageStatus = 'per_ward';

      const resultTable = [];

      for (const wName in wardMap) {
        const data = wardMap[wName];
        const pop = data.Dan_So_Vector;
        const projPop = data.projectedPopulation;

        const urbanResults = {};
        for (const key in constants.urbanInfraConfig) {
          const cfg = constants.urbanInfraConfig[key];
          urbanResults[key] = {
            label: cfg.label,
            quota: cfg.quota,
            currentArea: 0,
            requiredArea: cfg.quota * projPop,
            subItems: [],
            status: false
          };
        }

        const unitResults = {};
        for (const key in constants.unitInfraConfig) {
          const cfg = constants.unitInfraConfig[key];
          unitResults[key] = {
            label: cfg.label,
            quota: cfg.quota || 0,
            currentArea: 0,
            requiredArea: (cfg.quota || 0) * projPop,
            subItems: [],
            status: false
          };
        }

        data.items.forEach(item => {
          const isApproved = (item.status === true || String(item.status).trim().toUpperCase() === 'TRUE');
          if (!isApproved) return;

          const prefix = String(item.id || '').split('-')[0];
          const prefixUp = prefix.toUpperCase();
          const isUrban = constants.isUrbanLevel(item);
          const typeCode = constants.resolveTypeCode(item);

          if (isUrban) {
            let targetKey = "CV_DT";
            if (prefixUp === "THPT" || (typeCode === "4-TH" && String(item.name || '').toUpperCase().includes('THPT'))) {
              targetKey = "THPT";
            } else if (typeCode === "6-YT" || prefixUp === "YT" || prefixUp === "YT_DT" || prefixUp === "6") {
              targetKey = "YT_DT";
            } else if (typeCode === "7-VH" || prefixUp === "VH" || prefixUp === "VH_DT" || prefixUp === "7") {
              targetKey = "VH_DT";
            } else if (typeCode === "8-TM" || prefixUp === "TM" || prefixUp === "TM_DT" || prefixUp === "8") {
              targetKey = "TM_DT";
            } else if (typeCode === "1-CV" || prefixUp === "CV" || prefixUp === "CV_DT" || prefixUp === "1") {
              targetKey = "CV_DT";
            } else if (typeCode === "2-BDX" || prefixUp === "BDX" || prefixUp === "BDX_DT" || prefixUp === "2") {
              targetKey = "BDX_DT";
            }

            if (urbanResults[targetKey]) {
              urbanResults[targetKey].currentArea += Number(item.size || 0);
              urbanResults[targetKey].subItems.push(item);
            }
          } else {
            let targetKey = "CV_DV";
            if (typeCode === "3-MN" || prefixUp === "MN" || prefixUp === "3") targetKey = "3-MN";
            else if (typeCode === "4-TH" || prefixUp === "TH" || prefixUp === "4") targetKey = "4-TH";
            else if (typeCode === "5-THCS" || prefixUp === "THCS" || prefixUp === "5") targetKey = "5-THCS";
            else if (typeCode === "6-YT" || prefixUp === "YT" || prefixUp === "YT_DV" || prefixUp === "6") targetKey = "YT_DV";
            else if (typeCode === "7-VH" || prefixUp === "VH" || prefixUp === "VH_DV" || prefixUp === "7") targetKey = "VH_DV";
            else if (typeCode === "8-TM" || prefixUp === "TM" || prefixUp === "TM_DV" || prefixUp === "8") targetKey = "TM_DV";
            else if (typeCode === "1-CV" || prefixUp === "CV" || prefixUp === "CV_DV" || prefixUp === "1") targetKey = "CV_DV";
            else if (typeCode === "2-BDX" || prefixUp === "BDX" || prefixUp === "BDX_DV" || prefixUp === "2") targetKey = "BDX_DV";

            if (unitResults[targetKey]) {
              unitResults[targetKey].currentArea += Number(item.size || 0);
              unitResults[targetKey].subItems.push(item);
            }
          }
        });

        const codesList = constants.CODES_TO_CHECK || ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];
        let totalCoverageSum = 0;
        let totalScaleSum = 0;
        let countMetrics = 0;

        const calculatedRow = {
          Ten_Phuong: wName,
          Dan_So_Vector: pop,
          projectedPopulation: projPop,
          currentUnits: data.currentUnits,
          projectedUnits: data.projectedUnits,
          urbanResults: urbanResults,
          unitResults: unitResults,
          csdItems: data.csdItems || [],
          pendingItems: [],
          dvccSummary: {
            totalArea: (unitResults["YT_DV"]?.currentArea || 0) + (unitResults["VH_DV"]?.currentArea || 0) + (unitResults["TM_DV"]?.currentArea || 0),
            requiredArea: 2.0 * projPop,
            status: false
          }
        };

        const typeAreaExist = (code) => {
          if (code === "1-CV") return (urbanResults["CV_DT"]?.currentArea || 0) + (unitResults["CV_DV"]?.currentArea || 0);
          if (code === "2-BDX") return (urbanResults["BDX_DT"]?.currentArea || 0) + (unitResults["BDX_DV"]?.currentArea || 0);
          if (code === "3-MN") return unitResults["3-MN"]?.currentArea || 0;
          if (code === "4-TH") return unitResults["4-TH"]?.currentArea || 0;
          if (code === "5-THCS") return unitResults["5-THCS"]?.currentArea || 0;
          if (code === "6-YT") return (urbanResults["YT_DT"]?.currentArea || 0) + (unitResults["YT_DV"]?.currentArea || 0);
          if (code === "7-VH") return (urbanResults["VH_DT"]?.currentArea || 0) + (unitResults["VH_DV"]?.currentArea || 0);
          if (code === "8-TM") return (urbanResults["TM_DT"]?.currentArea || 0) + (unitResults["TM_DV"]?.currentArea || 0);
          return 0;
        };

        calculatedRow.pendingItems = (data.pendingItems || []).map(item => {
          const code = constants.resolveTypeCode(item) || item.type || "9-CSD";
          const size = Number(item.size || 0);
          const quota = (constants.quotaConfig && constants.quotaConfig[code]) || 0;
          const reqArea = Math.max(1, Math.round(quota * projPop));
          const existArea = typeAreaExist(code);
          const scaleAddPct = Number(Math.min(100, Math.max(0, (size / reqArea) * 100)).toFixed(1));
          const infraCfg = constants.infraConfig ? constants.infraConfig[code] : null;
          const candidateRadius = (infraCfg && infraCfg.radius) || Number(item.radius || item.banKinh) || 1000;
          const wardMeta = evaluatedWards.find(w => w.name === wName);
          const existingSame = [];
          Object.values(urbanResults).forEach(n => (n.subItems || []).forEach(s => {
            if (constants.resolveTypeCode(s) === code) existingSame.push(s);
          }));
          Object.values(unitResults).forEach(n => (n.subItems || []).forEach(s => {
            if (constants.resolveTypeCode(s) === code) existingSame.push(s);
          }));
          const coverageAddPct = estimateCoverageAddPct({
            lat: item.lat,
            lng: item.lng,
            radius: candidateRadius,
            wardGeometry: wardMeta ? wardMeta.geometry : null,
            existingSameType: existingSame
          });
          const typeLabel = (infraCfg && infraCfg.label) || code;
          return {
            id: item.id,
            name: item.name,
            type: code,
            typeLabel,
            size,
            lat: item.lat,
            lng: item.lng,
            radius: candidateRadius,
            status: item.status,
            scaleAddPct,
            coverageAddPct
          };
        });

        codesList.forEach(c => {
          let node = null;
          if (c === "1-CV") node = urbanResults["CV_DT"] || unitResults["CV_DV"];
          else if (c === "2-BDX") node = urbanResults["BDX_DT"] || unitResults["BDX_DV"];
          else if (c === "3-MN") node = unitResults["3-MN"];
          else if (c === "4-TH") node = unitResults["4-TH"];
          else if (c === "5-THCS") node = unitResults["5-THCS"];
          else if (c === "6-YT") node = urbanResults["YT_DT"] || unitResults["YT_DV"];
          else if (c === "7-VH") node = urbanResults["VH_DT"] || unitResults["VH_DV"];
          else if (c === "8-TM") node = urbanResults["TM_DT"] || unitResults["TM_DV"];

          const current = node ? node.currentArea : 0;
          const required = node ? node.requiredArea : 1;
          const rawScale = (current / (required || 1)) * 100;
          const scaleVal = Number(Math.min(100, Math.max(0, rawScale)).toFixed(1));
          const covMap = coverageByWard[wName]
            || coverageByWard[Object.keys(coverageByWard).find(k => constants.cleanWardStr(k) === constants.cleanWardStr(wName))]
            || {};
          const coverageVal = Number(covMap[c] || 0);

          calculatedRow[`Ratio_${c}`] = coverageVal;
          calculatedRow[`Scale_${c}`] = scaleVal;
          totalCoverageSum += coverageVal;
          totalScaleSum += scaleVal;
          countMetrics++;
        });

        calculatedRow.Avg_Coverage_Score = Number((totalCoverageSum / (countMetrics || 1)).toFixed(1));
        calculatedRow.Avg_Scale_Score = Number((totalScaleSum / (countMetrics || 1)).toFixed(1));
        calculatedRow._assignMode = 'geometry';
        calculatedRow._schema = 4;
        if (cachedCoverageByWard[wName]) calculatedRow._coverageReady = true;

        resultTable.push(calculatedRow);
      }

      resultTable.sort((a, b) => b.Dan_So_Vector - a.Dan_So_Vector);

      cachedWardStats = resultTable;
      lastWardStatsFetch = now;

      return res.status(200).json({ data: resultTable, coverageStatus });
    }

    if (action === 'getWardFromPoint') {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      if (!lat || !lng) return res.status(400).json({ error: true, message: "Thiếu tọa độ" });

      const clickPoint = ee.Geometry.Point([lng, lat]);
      const matchedWard = wardVectorParsed.filterBounds(clickPoint).first();

      const wardData = await new Promise((resolve) => {
        matchedWard.evaluate((feature) => {
          let wardName = "Thuận Hóa";
          if (feature && feature.properties) {
            const props = feature.properties;
            wardName = props.tenXa || props.NAME_2 || props.name || "Thuận Hóa";
          }
          resolve(wardName);
        });
      });

      return res.status(200).json({ ward: wardData });
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

      const wardFeatures = await new Promise((resolve, reject) => {
        wardCentroidFc.evaluate((fc, err) => err ? reject(err) : resolve(fc ? fc.features : []));
      });

      const labels = wardFeatures.map(f => {
        const props = f.properties || {};
        const coords = props.centroidCoords || [107.5905, 16.4637];
        return {
          name: props.tenXa || props.NAME_2 || props.name || 'Phường',
          lat: coords[1],
          lng: coords[0],
          geometry: f.geometry
        };
      });

      return res.status(200).json({ labels });
    }

    if (action === 'getBoundaryVector') {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
      const fcGeoJson = await new Promise((resolve, reject) => {
        wardVectorParsed.evaluate((fc, err) => err ? reject(err) : resolve(fc || { type: 'FeatureCollection', features: [] }));
      });
      return res.status(200).json(fcGeoJson);
    }

    return res.status(200).json({ rawDataList });

  } catch (err) {
    console.error("GEE API Error:", err);
    return res.status(500).json({ error: true, message: err.message });
  }
};
