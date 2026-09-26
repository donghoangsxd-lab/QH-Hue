const axios = require('axios');
const constants = require('../config/constants');
const { initGEE, getGeeContext } = require('../services/geeService');
const { getRawDataList, invalidateCache } = require('../services/gcsService');

let cachedWardStats = null;
let lastWardStatsFetch = 0;

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
  const candidates = [props[key], props.DanSoPixelNormalized, props.count];
  for (const v of candidates) {
    const n = Number(v);
    if (!Number.isNaN(n) && n >= 0) return n;
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
 * Độ phủ 1 phường: 8 buffer loại hạ tầng (điểm nằm trong ranh giới) chồng raster dân số.
 * 1 lần reduceRegion — đủ nhẹ cho Vercel.
 */
async function computeSingleWardCoverage(ee, popRasterNormalized, wardGeometry, itemsInWard) {
  const codesList = constants.CODES_TO_CHECK || ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];
  const ratios = {};
  codesList.forEach(c => { ratios[c] = 0; });

  if (!popRasterNormalized || !wardGeometry) {
    return { ratios, Avg_Coverage_Score: 0 };
  }

  const wardGeom = ee.Geometry(wardGeometry);
  const emptyMask = ee.Image.constant(0).selfMask();
  const bandImages = [popRasterNormalized.rename('pix_total')];

  codesList.forEach(c => {
    const bandName = bandKeyForCode(c);
    const matchingItems = (itemsInWard || []).filter(it =>
      isApprovedStatus(it.status) && it.type === c && it.lat != null && it.lng != null
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
  let sum = 0;
  codesList.forEach(c => {
    const servedPix = readPixProp(evalResult, bandKeyForCode(c));
    const val = totalPix > 0
      ? Number(Math.min(100, Math.max(0, (servedPix / totalPix) * 100)).toFixed(1))
      : 0;
    ratios[c] = val;
    sum += val;
  });

  return {
    ratios,
    Avg_Coverage_Score: Number((sum / (codesList.length || 1)).toFixed(1))
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
      isApprovedStatus(it.status) && it.type === c && it.lat != null && it.lng != null
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
          wardExistAreas[item.type] = (wardExistAreas[item.type] || 0) + item.size;
        }
      });

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
        let coverageRatio = deficitArea > 0 ? Number(((size / deficitArea) * 100).toFixed(1)) : (reqArea > 0 ? Number(((size / reqArea) * 100).toFixed(1)) : 0);

        const candidateRadius = infraCfg ? infraCfg.radius : 500;
        const testBuffer = ee.Geometry.Point([lng, lat]).buffer(candidateRadius);

        const existingBuffersPromises = rawDataList
          .filter(item => {
            const isApproved = (item.status === true || String(item.status).trim().toUpperCase() === 'TRUE');
            return item.type === code && isApproved;
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
            reducer: ee.Reducer.sum(),
            geometry: netBufferGeom,
            scale: 30,
            maxPixels: 1e9
          }).evaluate((r) => resolve(r ? r.DanSoPixelNormalized : 0));
        });

        let cleanPopGained = Math.max(0, Math.round(netPopRes || 0));

        if (cleanPopGained === 0) {
          const grossPopRes = await new Promise((resolve) => {
            popRasterNormalized.reduceRegion({
              reducer: ee.Reducer.sum(),
              geometry: testBuffer,
              scale: 30,
              maxPixels: 1e9
            }).evaluate((r) => resolve(r ? r.DanSoPixelNormalized : 0));
          });
          cleanPopGained = Math.max(0, Math.round(grossPopRes || 0));
        }

        suggestions.push({
          code,
          label,
          deficitArea: Math.max(0, deficitArea),
          coverageRatio: coverageRatio,
          isWardDeficit: deficitArea > 0,
          popGained: cleanPopGained
        });
      });

      await Promise.all(csdPromises);

      suggestions.sort((a, b) => {
        if (a.popGained !== b.popGained) return b.popGained - a.popGained;
        return b.coverageRatio - a.coverageRatio;
      });

      if (suggestions.length > 0) {
        suggestions[0].isTopPriority = true;
      }

      return res.status(200).json({ suggestions, ineligible });
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
        const codesList = constants.CODES_TO_CHECK || ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];
        codesList.forEach(c => {
          payload.ratios[c] = Number((result.ratios && result.ratios[c]) || 0);
          payload[`Ratio_${c}`] = payload.ratios[c];
        });
        if (result.timedOut) payload.coverageStatus = 'timeout';
        else payload.coverageStatus = 'ok';

        return res.status(200).json(payload);
      } catch (err) {
        console.error("getWardCoverage error:", err && err.message);
        return res.status(500).json({ error: true, message: err.message || "Lỗi tính độ phủ" });
      }
    }

    if (action === 'getWardStats') {
      const now = Date.now();
      if (cachedWardStats && (now - lastWardStatsFetch < constants.WARD_STATS_CACHE_TTL)
          && cachedWardStats[0] && cachedWardStats[0]._assignMode === 'geometry') {
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
          const isUnused = (prefix === "CSD" || prefix === "9" || nhom.includes("chưa sử dụng") || nhom.includes("csd") || !isApproved);

          if (isUnused && !isApproved) {
            const csdSize = Number(item.size || item.dienTich || 0);
            const codesToCheck = constants.CODES_TO_CHECK || ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];
            
            const wardExistAreas = {};
            rawDataList.forEach(subItem => {
              const subApproved = (subItem.status === true || String(subItem.status).trim().toUpperCase() === 'TRUE');
              if (!subApproved || subItem.lat == null || subItem.lng == null) return;
              if (assignWardByGeometry(Number(subItem.lng), Number(subItem.lat), evaluatedWards) !== assignedWardName) return;
              wardExistAreas[subItem.type] = (wardExistAreas[subItem.type] || 0) + Number(subItem.size || 0);
            });

            const evaluatedSuggestions = codesToCheck.map(code => {
              const infraCfg = constants.infraConfig ? constants.infraConfig[code] : null;
              const reqMinSize = infraCfg ? infraCfg.minSize : 0;
              const label = infraCfg ? infraCfg.label : code;
              
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

              const deficitArea = reqArea - existArea;
              let coverageRatio = deficitArea > 0 ? Number(((csdSize / deficitArea) * 100).toFixed(1)) : 0;

              return {
                code,
                label,
                deficitArea: Math.max(0, deficitArea),
                coverageRatio: coverageRatio,
                isWardDeficit: deficitArea > 0,
                status: 'eligible'
              };
            });

            evaluatedSuggestions.sort((a, b) => {
              if (a.status === 'ineligible' || a.status === 'fulfilled') return 1;
              if (b.status === 'ineligible' || b.status === 'fulfilled') return -1;
              return b.coverageRatio - a.coverageRatio;
            });

            if (evaluatedSuggestions.length > 0 && evaluatedSuggestions[0].status === 'eligible') {
              evaluatedSuggestions[0].isTopPriority = true;
            }

            wardMap[assignedWardName].csdItems.push({
              name: item.name || item.ten || "Khu đất chưa sử dụng",
              size: csdSize,
              lat: ptLat,
              lng: ptLng,
              radius: Number(item.radius || item.banKinh || 500),
              suggestions: evaluatedSuggestions.filter(s => s.status !== 'fulfilled'),
              status: item.status
            });
          } else if (isApproved) {
            wardMap[assignedWardName].items.push(item);
          }
        }
      });

      // Độ phủ toàn TP: tách endpoint getWardCoverage theo từng phường (tránh 504).
      const coverageByWard = {};
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

          const prefix = item.id.split('-')[0];
          const normalizedNhom = constants.cleanNhomStr(item.nhomHaTang);
          const isUrban = (normalizedNhom === "Cap Do Thi" || normalizedNhom === "Cấp đô thị" || prefix === "THPT");

          if (isUrban) {
            let targetKey = "CV_DT";
            if (prefix === "THPT") targetKey = "THPT";
            else if (prefix === "YT" || prefix === "6") targetKey = "YT_DT";
            else if (prefix === "VH" || prefix === "7") targetKey = "VH_DT";
            else if (prefix === "TM" || prefix === "8") targetKey = "TM_DT";
            else if (prefix === "CV" || prefix === "1") targetKey = "CV_DT";
            else if (prefix === "BDX" || prefix === "2") targetKey = "BDX_DT";

            if (urbanResults[targetKey]) {
              urbanResults[targetKey].currentArea += Number(item.size || 0);
              urbanResults[targetKey].subItems.push(item);
            }
          } else {
            let targetKey = "CV_DV";
            if (prefix === "MN" || prefix === "3") targetKey = "3-MN";
            else if (prefix === "TH" || prefix === "4") targetKey = "4-TH";
            else if (prefix === "THCS" || prefix === "5") targetKey = "5-THCS";
            else if (prefix === "YT" || prefix === "6") targetKey = "YT_DV";
            else if (prefix === "VH" || prefix === "7") targetKey = "VH_DV";
            else if (prefix === "TM" || prefix === "8") targetKey = "TM_DV";
            else if (prefix === "CV" || prefix === "1") targetKey = "CV_DV";
            else if (prefix === "BDX" || prefix === "2") targetKey = "BDX_DV";

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
          dvccSummary: {
            totalArea: (unitResults["YT_DV"]?.currentArea || 0) + (unitResults["VH_DV"]?.currentArea || 0) + (unitResults["TM_DV"]?.currentArea || 0),
            requiredArea: 2.0 * projPop,
            status: false
          }
        };

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
