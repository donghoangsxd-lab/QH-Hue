const axios = require('axios');
const constants = require('../config/constants');
const { initGEE, getGeeContext, buildEeIsochroneGeometry } = require('../services/geeService');
const { getRawDataList, invalidateCache } = require('../services/gcsService');

let cachedWardStats = null;
let lastWardStatsFetch = 0;

// ==========================================
// HELPER: TÍNH ISOCHRONE GIAO THÔNG (FALLBACK BUFFER)
// ==========================================
async function calculateNetworkIsochrone(lat, lng, banKinh) {
  const R = parseFloat(banKinh) || 500;
  const reachRatio = constants.ISOCHRONE_CONFIG?.REACH_RATIO || 0.9;
  const sampleAngles = constants.ISOCHRONE_CONFIG?.SAMPLE_ANGLES || 12; // 12 hoặc 8 hướng quét
  const reachDistanceKm = (R * reachRatio) / 1000;
  const angleStep = 360 / sampleAngles;
  
  const outerVertices = [];
  const angles = Array.from({ length: sampleAngles }, (_, i) => i * angleStep);

  const routePromises = angles.map(async (angle) => {
    const rad = (angle * Math.PI) / 180;
    // Tính điểm đích giả định theo hướng góc quét
    const destLat = lat + (reachDistanceKm / 111) * Math.cos(rad);
    const destLng = lng + (reachDistanceKm / (111 * Math.cos(lat * Math.PI / 180))) * Math.sin(rad);
    
    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${lng},${lat};${destLng},${destLat}?overview=full&geometries=geojson`;
      const res = await axios.get(osrmUrl, { timeout: 2000 });
      if (res.data && res.data.routes && res.data.routes[0]) {
        const coords = res.data.routes[0].geometry.coordinates;
        // CHỈ LẤY ĐIỂM XA NHẤT (ĐIỂM CUỐI CÙNG) MÀ HƯỚNG QUÉT ĐI ĐƯỢC TRÊN TUYẾN GIAO THÔNG
        return coords[coords.length - 1];
      }
    } catch (e) {}
    
    // Fallback nếu hướng đó OSRM không trả về
    return [destLng, destLat];
  });

  const results = await Promise.all(routePromises);
  results.forEach(pt => {
    if (pt && Array.isArray(pt)) {
      outerVertices.push(pt);
    }
  });

  if (outerVertices.length >= 3) {
    // Sắp xếp các đỉnh theo góc quanh tâm để tạo thành vòng khép kín không bị đan chéo
    outerVertices.sort((a, b) => {
      const angleA = Math.atan2(a[1] - lat, a[0] - lng);
      const angleB = Math.atan2(b[1] - lat, b[0] - lng);
      return angleA - angleB;
    });

    // Khép kín vòng đa giác
    outerVertices.push(outerVertices[0]);

    return {
      type: 'Polygon',
      coordinates: [outerVertices]
    };
  }

  // Fallback vòng tròn nếu thiếu dữ liệu
  const circlePoints = [];
  for (let i = 0; i <= 360; i += 15) {
    const rad = (i * Math.PI) / 180;
    const dLat = (R / 111000) * Math.cos(rad);
    const dLng = (R / (111000 * Math.cos(lat * Math.PI / 180))) * Math.sin(rad);
    circlePoints.push([lng + dLng, lat + dLat]);
  }
  return {
    type: 'Polygon',
    coordinates: [circlePoints]
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

  // Parse Body nếu là request POST
  if (req.method === 'POST' && typeof req.body === 'string') {
    try { req.body = JSON.parse(req.body); } catch(e) {}
  }

  try {
    const action = req.query.action || 'getInitData';

    // 1. TÍNH ISOCHRONE MẠNG LƯỚI GIAO THÔNG
    if (action === 'getIsochrone') {
      const { features } = req.body || {};
      if (!features || !Array.isArray(features)) {
        return res.status(400).json({ success: false, message: 'Invalid features array' });
      }

      const isoPromises = features.map(async (item) => {
        const effectiveRadius = item.radius || item.banKinh || 500;
        const polyCoords = await calculateNetworkIsochrone(item.lat, item.lng, effectiveRadius);
        return {
          type: 'Feature',
          geometry: polyCoords,
          properties: {
            id: item.id,
            name: item.name,
            type: item.type,
            ward: item.ward,
            banKinh: effectiveRadius,
            status: item.status
          }
        };
      });

      const isochroneFeatures = await Promise.all(isoPromises);
      return res.json({ type: 'FeatureCollection', features: isochroneFeatures });
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

    // Khởi tạo Earth Engine Context & Dữ liệu GCS
    await initGEE();
    const { ee, wardVectorParsed, popRasterNormalized, wardRegion } = getGeeContext();
    const rawDataList = await getRawDataList();

    // 3. TÍNH DÂN SỐ PHỤC VỤ TẠI ĐIỂM
    if (action === 'analyzePoint') {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const radius = Number(req.query.radius) || 500;
      const ptGeom = buildEeIsochroneGeometry(lat, lng, radius);

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
      const overrideRadius = Number(req.query.overrideRadius) || 500;
      const categoryImageLayers = [];
      const codes = constants.CODES_TO_CHECK;

      codes.forEach(code => {
        const groupFeatures = rawDataList
          .filter(item => item.type === code && item.status === true)
          .map(item => ee.Feature(buildEeIsochroneGeometry(item.lat, item.lng, overrideRadius)));
        if (groupFeatures.length > 0) {
          categoryImageLayers.push(ee.Image(0).byte().paint({ featureCollection: ee.FeatureCollection(groupFeatures), color: 1 }));
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
        const testBuffer = buildEeIsochroneGeometry(lat, lng, candidateRadius);

        const existingBuffers = rawDataList
          .filter(item => item.type === code && item.status)
          .map(item => ee.Feature(buildEeIsochroneGeometry(item.lat, item.lng, Number(item.radius) || candidateRadius)));

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

      codes.forEach(code => {
        const buffers = rawDataList
          .filter(item => item.type === code && item.status)
          .map(item => buildEeIsochroneGeometry(item.lat, item.lng, Number(item.radius) || 500));

        let unionImg = buffers.length > 0 
          ? ee.Image(0).byte().paint({ featureCollection: ee.FeatureCollection(buffers.map(b => ee.Feature(b))), color: 1 }) 
          : ee.Image(0).byte();

        const maskedRaster = popRasterNormalized.updateMask(unionImg.gt(0)).unmask(0).float().rename(code);
        bandImagesList.push(maskedRaster);
      });

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

  } catch (err) {
    return res.status(500).json({ error: true, message: err.message });
  }
};
