const axios = require('axios');
const constants = require('../config/constants');
const { initGEE, getGeeContext, buildEeIsochroneGeometry } = require('../services/geeService');
const { getRawDataList, invalidateCache } = require('../services/gcsService');

let cachedWardStats = null;
let lastWardStatsFetch = 0;

// ==========================================
// HELPER: TÍNH ISOCHRONE GIAO THÔNG CHO 1 ĐIỂM
// ==========================================
async function calculateNetworkIsochrone(lat, lng, banKinh) {
  const R = parseFloat(banKinh) || 500;
  const reachRatio = constants.ISOCHRONE_CONFIG?.REACH_RATIO || 0.9;
  const sampleAngles = constants.ISOCHRONE_CONFIG?.SAMPLE_ANGLES || 16;
  const maxReachKm = (R * reachRatio) / 1000;
  const angleStep = 360 / sampleAngles;
  
  const angles = Array.from({ length: sampleAngles }, (_, i) => i * angleStep);

  const distancePromises = angles.map(async (angle) => {
    const rad = (angle * Math.PI) / 180;
    const destLat = lat + (maxReachKm / 111) * Math.cos(rad);
    const destLng = lng + (maxReachKm / (111 * Math.cos(lat * Math.PI / 180))) * Math.sin(rad);
    
    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${lng},${lat};${destLng},${destLat}?overview=false`;
      const res = await axios.get(osrmUrl, { timeout: 2000 });
      
      if (res.data && res.data.routes && res.data.routes[0]) {
        const route = res.data.routes[0];
        if (route.distance > R * 1.3) {
          return maxReachKm * 0.4;
        }
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
    const next = rawDistances[(i + 1) % n];
    const smoothVal = (prev + curr * 2 + next) / 4;
    smoothedDistances.push(smoothVal);
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
}

// ==========================================
// MAIN VERCEL SERVERLESS ROUTER
// ==========================================
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST' && typeof req.body === 'string') {
    try { req.body = JSON.parse(req.body); } catch(e) {}
  }

  try {
    const action = req.query.action || 'getInitData';

    // 1. TÍNH ISOCHRONE RIÊNG CHO 1 ĐIỂM (DÙNG KHI CLICK HIGHLIGHT)
    if (action === 'getSingleIsochrone') {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const banKinh = Number(req.query.radius) || 500;
      if (!lat || !lng) return res.status(400).json({ error: true, message: "Thiếu tọa độ" });

      const polyCoords = await calculateNetworkIsochrone(lat, lng, banKinh);
      return res.status(200).json({
        type: 'Feature',
        geometry: polyCoords,
        properties: { banKinh }
      });
    }

    // 2. ĐỒNG BỘ ĐIỂM SANG GOOGLE SHEETS VIA GAS
    if (action === 'addPoint') {
      const { type, name, ward, lat, lng, size } = req.query;
      if (!type || !name || !lat || !lng) {
        return res.status(400).json({ error: true, message: "Thiếu thông tin bắt buộc" });
      }

      const syncUrl = `${constants.GAS_BASE_URL}?action=addPoint` +
        `&type=${encodeURIComponent(type)}` +
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

    await initGEE();
    const { ee, wardVectorParsed, popRasterNormalized, wardRegion } = getGeeContext();
    const rawDataList = await getRawDataList();

    // 3. TÍNH DÂN SỐ PHỤC VỤ TẠI ĐIỂM (THEO ĐA GIÁC OSRM HOẶC BÁN KÍNH GỐC)
    if (action === 'analyzePoint') {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const radius = Number(req.query.radius) || 500;
      
      // Tạo hình học đa giác OSRM chuẩn cho điểm phân tích
      const polyCoords = await calculateNetworkIsochrone(lat, lng, radius);
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

    // 4. ĐỘ PHỦ HEATMAP TILE
    if (action === 'getHeatmapTile') {
      const { features } = req.body || {};
      const overrideRadius = Number(req.query.overrideRadius) || 0;
      const categoryImageLayers = [];
      const codes = constants.CODES_TO_CHECK;

      codes.forEach(code => {
        let groupGeoms = [];
        if (features && Array.isArray(features)) {
          groupGeoms = features
            .filter(item => item.properties && item.properties.type === code && (item.properties.status === true || item.properties.status === 'true' || item.properties.status === 'TRUE'))
            .map(item => ee.Feature(ee.Geometry(item.geometry)));
        }

        if (groupGeoms.length === 0) {
          groupGeoms = rawDataList
            .filter(item => item.type === code && item.status === true)
            .map(item => {
              const r = overrideRadius > 0 ? overrideRadius : (Number(item.radius) || Number(item.banKinh) || 500);
              return ee.Feature(buildEeIsochroneGeometry(item.lat, item.lng, r));
            });
        }

        if (groupGeoms.length > 0) {
          categoryImageLayers.push(
            ee.Image(0).byte().paint({ 
              featureCollection: ee.FeatureCollection(groupGeoms), 
              color: 1 
            })
          );
        }
      });

      let heatmapMasked = categoryImageLayers.length > 0 
        ? ee.ImageCollection(categoryImageLayers).sum().updateMask(ee.ImageCollection(categoryImageLayers).sum().gt(0))
        : ee.Image(0).selfMask();

      const mapId = await new Promise((resolve, reject) => {
        heatmapMasked.getMap(
          { min: 1, max: 8, palette: ['#5dade2', '#2ecc71', '#f1c40f', '#f39c12', '#e67e22', '#d35400', '#e74c3c', '#900c3f'] }, 
          (m, err) => err ? reject(err) : resolve(m)
        );
      });
      return res.status(200).json({ urlFormat: mapId.urlFormat });
    }

    // 5. PHÂN TÍCH QUỸ ĐẤT CHUYỂN ĐỔI CÔNG NĂNG (CSD)
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
        const wName = f.properties.tenXa || f.properties.name || '';
        if (constants.cleanWardStr(wName) === cleanTargetWard) {
          targetWardPop = Number(f.properties.danSoNum || 0);
        }
      });

      const wardExistAreas = {};
      rawDataList.forEach(item => {
        if (item.status && constants.cleanWardStr(item.ward) === cleanTargetWard) {
          wardExistAreas[item.type] = (wardExistAreas[item.type] || 0) + item.size;
        }
      });

      const codesToCheck = constants.CODES_TO_CHECK;
      const suggestions = [];
      const ineligible = [];

      const csdPromises = codesToCheck.map(async (code) => {
        const reqMinSize = constants.infraConfig[code].minSize;
        if (size < reqMinSize) {
          ineligible.push({ code, label: constants.infraConfig[code].label, minSize: reqMinSize });
          return;
        }

        const normVal = constants.quotaConfig[code] || 0;
        const reqArea = Math.round(targetWardPop * normVal);
        const existArea = wardExistAreas[code] || 0;
        const deficitArea = reqArea - existArea;

        const candidateRadius = constants.infraConfig[code].radius;
        const testPolyCoords = await calculateNetworkIsochrone(lat, lng, candidateRadius);
        const testBuffer = ee.Geometry(testPolyCoords);

        const existingBuffersPromises = rawDataList
          .filter(item => item.type === code && item.status)
          .map(async (item) => {
            const r = Number(item.radius) || Number(item.banKinh) || candidateRadius;
            const pCoords = await calculateNetworkIsochrone(item.lat, item.lng, r);
            return ee.Feature(ee.Geometry(pCoords));
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
          label: constants.infraConfig[code].label,
          deficitArea: Math.max(0, deficitArea),
          isWardDeficit: deficitArea > 0,
          popGained: cleanPopGained
        });
      });

      await Promise.all(csdPromises);

      suggestions.sort((a, b) => {
        if (a.isWardDeficit !== b.isWardDeficit) return a.isWardDeficit ? -1 : 1;
        if (a.isWardDeficit && b.isWardDeficit) return b.deficitArea - a.deficitArea;
        return b.popGained - a.popGained;
      });

      if (suggestions.length > 0 && suggestions[0].isWardDeficit) {
        suggestions[0].isTopPriority = true;
      }

      return res.status(200).json({ suggestions, ineligible });
    }

    // 6. THỐNG KÊ MA TRẬN 40 PHƯỜNG XÃ
    if (action === 'getWardStats') {
      const now = Date.now();
      if (cachedWardStats && (now - lastWardStatsFetch < constants.WARD_STATS_CACHE_TTL)) {
        return res.status(200).json({ data: cachedWardStats });
      }

      const codes = constants.CODES_TO_CHECK;
      const bandImagesList = [];

      for (const code of codes) {
        const itemBuffersPromises = rawDataList
          .filter(item => item.type === code && item.status)
          .map(async (item) => {
            const r = Number(item.radius) || Number(item.banKinh) || 500;
            const pCoords = await calculateNetworkIsochrone(item.lat, item.lng, r);
            return ee.Feature(ee.Geometry(pCoords));
          });

        const buffers = await Promise.all(itemBuffersPromises);

        let unionImg = buffers.length > 0 
          ? ee.Image(0).byte().paint({ featureCollection: ee.FeatureCollection(buffers), color: 1 }) 
          : ee.Image(0).byte();

        const maskedRaster = popRasterNormalized.updateMask(unionImg.gt(0)).unmask(0).float().rename(code);
        bandImagesList.push(maskedRaster);
      }

      const infraMultiBand = ee.Image.cat(bandImagesList).addBands(wardRegion.rename('ID_Region'));

      const statsMultiGroup = await new Promise((resolve, reject) => {
        infraMultiBand.reduceRegion({
          reducer: ee.Reducer.sum().repeat(8).group({ groupField: 8, groupName: 'ID_Phuong' }),
          geometry: wardVectorParsed.geometry(),
          scale: 100,
          maxPixels: 1e9
        }).evaluate((res, err) => err ? reject(err) : resolve(res));
      });

      const gListMulti = statsMultiGroup ? (statsMultiGroup.groups || []) : [];
      const multiCoverageDict = {};
      gListMulti.forEach(item => { multiCoverageDict[String(item.ID_Phuong)] = item.sum; });

      const wardLandArea = {};
      rawDataList.forEach(item => {
        if (item.status && codes.includes(item.type)) {
          const w = constants.cleanWardStr(item.ward);
          if (!wardLandArea[w]) wardLandArea[w] = {};
          wardLandArea[w][item.type] = (wardLandArea[w][item.type] || 0) + item.size;
        }
      });

      const wardList = await new Promise((resolve, reject) => {
        wardVectorParsed.evaluate((fc, err) => err ? reject(err) : resolve(fc ? fc.features : []));
      });

      const resultTable = wardList.map(f => {
        const props = f.properties || {};
        const wName = props.tenXa || props.name || 'Phường';
        const normW = constants.cleanWardStr(wName);
        const wId = String(props.maXa || props.OBJECTID || '');
        const totalWardPop = Number(props.danSoNum || 1);

        const sumList = multiCoverageDict[wId] || [0, 0, 0, 0, 0, 0, 0, 0];
        let sumCoveredRatio = 0;
        const rowData = { Ten_Phuong: wName, Dan_So_Vector: totalWardPop };

        codes.forEach((code, idx) => {
          const coveredPop = sumList[idx] || 0;
          const popRatio = Math.min(100, totalWardPop > 0 ? (coveredPop / totalWardPop) * 100 : 0);
          rowData[`Ratio_${code}`] = popRatio;
          sumCoveredRatio += popRatio;

          const existArea = (wardLandArea[normW] && wardLandArea[normW][code]) || 0;
          const normVal = constants.quotaConfig[code] || 0;
          const scaleScore = normVal > 0 ? Math.min(100, ((existArea / totalWardPop) / normVal) * 100) : 100;
          rowData[`Scale_${code}`] = scaleScore;
        });

        rowData.Total_Infra_Score = sumCoveredRatio / 8;
        return rowData;
      });

      resultTable.sort((a, b) => b.Dan_So_Vector - a.Dan_So_Vector);

      cachedWardStats = resultTable;
      lastWardStatsFetch = now;

      return res.status(200).json({ data: resultTable });
    }

    // 7. XÁC ĐỊNH PHƯỜNG XÃ TỪ TỌA ĐỘ
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
            wardName = feature.properties.tenXa || feature.properties.NAME_2 || feature.properties.name || "Thuận Hóa";
          }
          resolve(wardName);
        });
      });

      return res.status(200).json({ ward: wardData });
    }

    // 8. TIỆN ÍCH RASTERS (DÂN SỐ & RANH GIỚI)
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

    return res.status(200).json({ rawDataList });

-  } catch (err) {
    return res.status(500).json({ error: true, message: err.message });
  }
};
