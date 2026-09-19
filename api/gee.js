const axios = require('axios');
const constants = require('../config/constants');
const { initGEE, getGeeContext } = require('../services/geeService');
const { getRawDataList, invalidateCache } = require('../services/gcsService');

let cachedWardStats = null;
let lastWardStatsFetch = 0;

// ==========================================
// CHI TIẾT: THUẬT TOÁN ISOCHRONE 16 HƯỚNG (DÙNG KHI CLICK ĐIỂM CỤ THỂ)
// ==========================================
async function calculateNetworkIsochrone16(lat, lng, banKinh) {
  const R = parseFloat(banKinh) || 500;
  const reachRatio = constants.ISOCHRONE_CONFIG?.REACH_RATIO || 0.9;
  const sampleAngles = 16; // 16 hướng theo yêu cầu để đạt độ chính xác cao
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
      const next = rawDistances[(i + 1) % n];
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

// ==========================================
// MAIN VERCEL SERVERLESS ROUTER
// ==========================================
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const action = req.query.action || 'getInitData';

    // 1. TỔNG QUÁT: DÙNG BÁN KÍNH TRÒN TRỰC TIẾP TRÊN GEE
    if (action === 'getIsochrone') {
      let requestBody = req.body || {};
      if (typeof requestBody === 'string') {
        try { requestBody = JSON.parse(requestBody); } catch (e) { requestBody = {}; }
      }
      
      const features = requestBody.features;
      
      if (!features || !Array.isArray(features) || features.length === 0) {
        return res.status(200).json({ type: 'FeatureCollection', features: [] });
      }

      const validFeatures = features.filter(item => item && typeof item.lat === 'number' && typeof item.lng === 'number');
      if (validFeatures.length === 0) {
        return res.status(200).json({ type: 'FeatureCollection', features: [] });
      }

      try {
        const fc = ee.FeatureCollection(validFeatures.map(item => {
          const effectiveRadius = Number(item.radius) || Number(item.banKinh) || 500;
          const geom = ee.Geometry.Point([item.lng, item.lat]).buffer(effectiveRadius);
          return ee.Feature(geom, {
            id: item.id || '',
            name: item.name || '',
            type: item.type || '',
            ward: item.ward || '',
            banKinh: effectiveRadius,
            status: item.status ?? false
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

    // CHI TIẾT ĐIỂM: DÙNG ISOCHRONE 16 HƯỚNG KHI CLICK VÀO 1 ĐIỂM CỤ THỂ
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

    // ANALYZE POINT: Dùng 16 hướng khi click chi tiết điểm
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
            const isApproved = (props.status === true || props.status === 'true' || props.status === 'TRUE');
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
        const testBuffer = ee.Geometry.Point([lng, lat]).buffer(candidateRadius);

        const existingBuffersPromises = rawDataList
          .filter(item => item.type === code && item.status)
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
            return ee.Feature(ee.Geometry.Point([item.lng, item.lat]).buffer(r));
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
        
        let totalWardPop = Number(props.danSoNum || 1);
        if (isNaN(totalWardPop) || totalWardPop <= 0) totalWardPop = 1;

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

    return res.status(200).json({ rawDataList });

  } catch (err) {
    console.error("GEE API Error:", err);
    return res.status(500).json({ error: true, message: err.message });
  }
};
