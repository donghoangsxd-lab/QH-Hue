const ee = require('@google/earthengine');

let isGeeInitialized = false;

let cachedGeoJSON = null;
let lastGeoJSONFetch = 0;
const GEOJSON_CACHE_TTL = 10 * 60 * 1000;

let cachedWardStats = null;
let lastWardStatsFetch = 0;
const WARD_STATS_CACHE_TTL = 15 * 60 * 1000;

function initGEE() {
  if (isGeeInitialized) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      let privateKey = process.env.GEE_PRIVATE_KEY;
      if (!privateKey) return reject(new Error("Thiếu biến GEE_PRIVATE_KEY"));
      if (typeof privateKey === 'string' && privateKey.trim().startsWith('{')) {
        privateKey = JSON.parse(privateKey);
      } else if (typeof privateKey === 'string') {
        privateKey = privateKey.replace(/\\n/g, '\n');
      }

      ee.data.authenticateViaPrivateKey(
        privateKey, 
        () => {
          ee.initialize(null, null, () => {
            isGeeInitialized = true;
            resolve();
          }, (err) => reject(new Error("GEE Init Fail: " + err)));
        }, 
        (err) => reject(new Error("GEE Auth Fail: " + err))
      );
    } catch (e) { reject(new Error("Key Parse Fail: " + e.message)); }
  });
}

const quotaConfig = {
  "1-CV": 7.00, "2-BDX": 2.50, "3-MN": 0.60, "4-TH": 0.65,
  "5-THCS": 0.55, "6-YT": 0.20, "7-VH": 1.00, "8-TM": 0.00
};

const infraConfig = {
  "1-CV":   { label: "Công viên, điểm xanh, vườn hoa", minSize: 300, radius: 500 },
  "2-BDX":  { label: "Bãi đỗ xe, trạm sạc xe điện", minSize: 200, radius: 500 },
  "3-MN":   { label: "Trường Mầm non", minSize: 800, radius: 500 },
  "4-TH":   { label: "Trường Tiểu học", minSize: 2000, radius: 1000 },
  "5-THCS": { label: "Trường THCS", minSize: 2500, radius: 1000 },
  "6-YT":   { label: "Bệnh viện, Trạm y tế", minSize: 1000, radius: 1000 },
  "7-VH":   { label: "Nhà văn hóa, thể thao", minSize: 500, radius: 500 },
  "8-TM":   { label: "Chợ, Trung tâm thương mại", minSize: 1500, radius: 500 }
};

function cleanWardStr(str) {
  if (!str) return "";
  return String(str)
    .replace(/^Phường\s+/i, '').replace(/^Xã\s+/i, '')
    .replace(/^phường\s+/i, '').replace(/^xã\s+/i, '')
    .trim().toLowerCase();
}

async function getRawDataList() {
  const now = Date.now();
  if (cachedGeoJSON && (now - lastGeoJSONFetch < GEOJSON_CACHE_TTL)) {
    return cachedGeoJSON;
  }

  try {
    const gcsUrl = "https://storage.googleapis.com/hue-infra-data-us/infrastructure_hue.json";
    const gcsResponse = await fetch(gcsUrl);
    const geojson = await gcsResponse.json();
    const features = geojson.features || [];

    const codeMap = { "CV": "1-CV", "BDX": "2-BDX", "MN": "3-MN", "TH": "4-TH", "THCS": "5-THCS", "YT": "6-YT", "VH": "7-VH", "TM": "8-TM", "CSD": "9-CSD" };

    cachedGeoJSON = features.map(ft => {
      const props = ft.properties || {};
      const coords = ft.geometry ? ft.geometry.coordinates : [107.5905, 16.4637];
      const rawId = String(props.ID_DoiTuong || '');
      const prefix = rawId.split('-')[0];

      const rawStatus = props.TrangThai;
      const isStatusTrue = (rawStatus === true || String(rawStatus).trim().toUpperCase() === 'TRUE');

      return {
        id: rawId,
        name: props.Ten_CongTrinh || 'Chưa đặt tên',
        ward: props.Ten_XaPhuong || 'Thuận Hóa',
        type: codeMap[prefix] || "9-CSD",
        lat: Number(coords[1]),
        lng: Number(coords[0]),
        size: Number(props.QuyMo_S) || 0,
        radius: Number(props.BanKinh) || 500,
        status: isStatusTrue
      };
    });

    lastGeoJSONFetch = now;
    return cachedGeoJSON;
  } catch (e) {
    console.error("Lỗi nạp GCS Data:", e.message);
    return cachedGeoJSON || [];
  }
}

function invalidateCache() {
  cachedGeoJSON = null;
  cachedWardStats = null;
  lastGeoJSONFetch = 0;
  lastWardStatsFetch = 0;
}

// TỐI ƯU HÀM TÍNH TOÁN MA TRẬN PHÂN TÍCH ĐỂ TRÁNH CRASH GEE SERVER
function getNetworkCostImage(region) {
  return ee.Image(1).clip(region);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initGEE();
    const action = req.query.action || 'getInitData';
    const gasBaseUrl = "https://script.google.com/macros/s/AKfycbzyvYP9WoDizfwb-ZMT374jHbLY02X3HlhxKnmZEYl8UrYrO6SSzSB7eQRH0kaXWguU/exec";

    const wardVector = ee.FeatureCollection("projects/optimistic-yew-488501-s0/assets/Polygon-40xa");
    const wardVectorParsed = wardVector.map(f => {
      let rawPop = f.get('danSo');
      if (!rawPop) rawPop = f.get('DanSo');
      const popNum = ee.Algorithms.If(rawPop, ee.Number.parse(ee.String(rawPop)), 0);
      return f.set('danSoNum', popNum);
    });

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

    if (action === 'addPoint') {
      const { type, name, ward, lat, lng, size } = req.query;
      if (!type || !name || !lat || !lng) {
        return res.status(400).json({ error: true, message: "Thiếu thông tin bắt buộc" });
      }

      const syncUrl = `${gasBaseUrl}?action=addPoint` +
        `&type=${encodeURIComponent(type)}` +
        `&name=${encodeURIComponent(name)}` +
        `&ward=${encodeURIComponent(ward || 'Thuận Hóa')}` +
        `&lat=${lat}&lng=${lng}&size=${size || 0}`;

      invalidateCache();
      const gasRes = await fetch(syncUrl);
      const result = await gasRes.json().catch(() => ({ success: true }));
      return res.status(200).json({ success: true, result });
    }

    if (action === 'approvePoint') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: true, message: "Thiếu ID công trình" });

      const syncUrl = `${gasBaseUrl}?action=approvePoint&id=${encodeURIComponent(id)}`;
      invalidateCache();
      const gasRes = await fetch(syncUrl);
      const result = await gasRes.json().catch(() => ({ success: true }));
      return res.status(200).json({ success: true, result });
    }

    const popRaster = ee.Image("projects/optimistic-yew-488501-s0/assets/Pixel-danso").select(0).rename('DanSoPixel');
    const wardRegion = ee.Image("projects/optimistic-yew-488501-s0/assets/Output40xa").select(0).rename('ID_Region');

    const validPopMask = popRaster.gt(0);
    const validPopRaster = popRaster.updateMask(validPopMask);
    const wardPopSumImg = ee.Image().double().paint({ featureCollection: wardVectorParsed, color: 'danSoNum' });

    const statsGrouped = validPopRaster.addBands(wardRegion).reduceRegion({
      reducer: ee.Reducer.count().group({ groupField: 1, groupName: 'ID_Phuong' }),
      geometry: wardVectorParsed.geometry(),
      scale: 60,
      maxPixels: 1e9
    });

    const groupsList = ee.List(statsGrouped.get('groups'));
    const wardPixelCountDict = ee.Dictionary(groupsList.iterate((item, acc) => {
      const d = ee.Dictionary(item);
      const idStr = ee.String(ee.Number(d.get('ID_Phuong')).toInt());
      return ee.Dictionary(acc).set(idStr, d.get('count'));
    }, ee.Dictionary({})));

    const wardPixelCountImg = wardRegion.remap(
      wardPixelCountDict.keys().map(k => ee.Number.parse(k)),
      wardPixelCountDict.values()
    );

    const popRasterNormalized = wardPopSumImg.divide(wardPixelCountImg)
      .updateMask(validPopMask)
      .rename('DanSoPixelNormalized');

    const rawDataList = await getRawDataList();

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

    // NẠP TILE LỚP GIAO THÔNG TỪ GEE
    if (action === 'getRoadsTile') {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
      const hueBounds = wardVectorParsed.geometry().bounds();
      const roadsFC = ee.FeatureCollection("HOT/OSM/planet/roads").filterBounds(hueBounds);
      const roadImage = ee.Image().byte().paint({ featureCollection: roadsFC, color: 1, width: 2 });
      const mapId = await new Promise((resolve, reject) => {
        roadImage.getMap({ palette: ['#38bdf8'] }, (m, err) => err ? reject(err) : resolve(m));
      });
      return res.status(200).json({ urlFormat: mapId.urlFormat });
    }

    if (action === 'getHeatmapTile') {
      const overrideRadius = Number(req.query.overrideRadius) || 500;
      const hueBounds = wardVectorParsed.geometry().bounds();
      const costImage = getNetworkCostImage(hueBounds);

      const categoryLayers = [];
      const codes = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];

      codes.forEach(code => {
        const approvedPts = rawDataList
          .filter(item => item.type === code && item.status === true)
          .map(item => ee.Feature(ee.Geometry.Point([item.lng, item.lat])));

        if (approvedPts.length > 0) {
          const sourceFC = ee.FeatureCollection(approvedPts);
          const networkDistImg = costImage.cumulativeCost({
            source: sourceFC,
            maxDistance: overrideRadius * 2
          });
          const maskCoverage = networkDistImg.lte(overrideRadius);
          categoryLayers.push(ee.Image(0).byte().paint({ featureCollection: ee.FeatureCollection([ee.Feature(hueBounds)]), color: 1 }).updateMask(maskCoverage));
        }
      });

      let heatmapMasked;
      if (categoryLayers.length > 0) {
        const heatmapImage = ee.ImageCollection(categoryLayers).sum();
        heatmapMasked = heatmapImage.updateMask(heatmapImage.gt(0));
      } else {
        heatmapMasked = ee.Image(0).selfMask();
      }

      const mapId = await new Promise((resolve, reject) => {
        heatmapMasked.getMap(
          { min: 1, max: 8, palette: ['#5dade2', '#2ecc71', '#f1c40f', '#f39c12', '#e67e22', '#d35400', '#e74c3c', '#900c3f'] }, 
          (m, err) => err ? reject(err) : resolve(m)
        );
      });
      return res.status(200).json({ urlFormat: mapId.urlFormat });
    }

    if (action === 'analyzePoint') {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const radius = Number(req.query.radius) || 500;
      const ptGeom = ee.Geometry.Point([lng, lat]);
      const bufGeom = ptGeom.buffer(radius);

      const servedPopRes = await new Promise((resolve, reject) => {
        popRasterNormalized.reduceRegion({
          reducer: ee.Reducer.sum(),
          geometry: bufGeom,
          scale: 30,
          maxPixels: 1e9
        }).evaluate((res, err) => err ? reject(err) : resolve(res));
      });

      const servedPop = Math.round(servedPopRes.DanSoPixelNormalized || 0);
      return res.status(200).json({ servedPop });
    }

    if (action === 'analyzeCSD') {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const size = Number(req.query.size) || 0;
      const rawWardParam = String(req.query.ward || '');
      const cleanTargetWard = cleanWardStr(rawWardParam);
      const ptGeom = ee.Geometry.Point([lng, lat]);

      const wardListEvaluated = await new Promise((resolve) => {
        wardVectorParsed.evaluate((fc) => resolve(fc ? fc.features : []));
      });

      let targetWardPop = 0;
      wardListEvaluated.forEach(f => {
        const wName = f.properties.tenXa || f.properties.name || '';
        if (cleanWardStr(wName) === cleanTargetWard) {
          targetWardPop = Number(f.properties.danSoNum || 0);
        }
      });

      const wardExistAreas = {};
      rawDataList.forEach(item => {
        if (item.status && cleanWardStr(item.ward) === cleanTargetWard) {
          wardExistAreas[item.type] = (wardExistAreas[item.type] || 0) + item.size;
        }
      });

      const codesToCheck = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];
      const suggestions = [];
      const ineligible = [];

      const csdPromises = codesToCheck.map(async (code) => {
        const reqMinSize = infraConfig[code].minSize;
        if (size < reqMinSize) {
          ineligible.push({ code, label: infraConfig[code].label, minSize: reqMinSize });
          return;
        }

        const normVal = quotaConfig[code] || 0;
        const reqArea = Math.round(targetWardPop * normVal);
        const existArea = wardExistAreas[code] || 0;
        const deficitArea = reqArea - existArea;

        const candidateRadius = infraConfig[code].radius;
        const testBuffer = ptGeom.buffer(candidateRadius);

        const existingBuffers = rawDataList
          .filter(item => item.type === code && item.status)
          .map(item => ee.Feature(ee.Geometry.Point([item.lng, item.lat]).buffer(Number(item.radius) || candidateRadius)));

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
          label: infraConfig[code].label,
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

    if (action === 'analyzeLocation') {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const userRadius = Number(req.query.radius) || 500;
      if (!lat || !lng) return res.status(400).json({ error: true, message: "Thiếu tọa độ" });

      const clickGeom = ee.Geometry.Point([lng, lat]);
      const searchRegion = clickGeom.buffer(userRadius * 2.5);
      const costImage = getNetworkCostImage(searchRegion);

      const distFromClickImg = costImage.cumulativeCost({
        source: clickGeom,
        maxDistance: userRadius * 2.5
      });

      const approvedItems = rawDataList.filter(item => item.type !== "9-CSD" && item.status === true);

      const samplePromises = approvedItems.map(async (item) => {
        const itemGeom = ee.Geometry.Point([item.lng, item.lat]);
        const distRes = await new Promise((resolve) => {
          distFromClickImg.reduceRegion({
            reducer: ee.Reducer.first(),
            geometry: itemGeom,
            scale: 15
          }).evaluate((r) => resolve(r ? r.cumulative_cost : null));
        });
        return { ...item, net_dist: distRes };
      });

      const evaluatedItems = await Promise.all(samplePromises);

      const coveredGroups = {};
      evaluatedItems.forEach(item => {
        if (item.net_dist !== null && item.net_dist !== undefined && item.net_dist <= userRadius) {
          if (!coveredGroups[item.type]) coveredGroups[item.type] = [];
          const distMeters = Math.round(item.net_dist);
          coveredGroups[item.type].push(`${item.name} (~${distMeters}m)`);
        }
      });

      const allCodes = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];
      const missingCodes = [];
      allCodes.forEach(code => {
        if (!coveredGroups[code]) missingCodes.push(code);
      });

      const matchedWard = wardVectorParsed.filterBounds(clickGeom).first();
      const wardName = await new Promise((resolve) => {
        matchedWard.evaluate((ft) => {
          resolve((ft && ft.properties) ? (ft.properties.tenXa || ft.properties.name || "Thuận Hóa") : "Thuận Hóa");
        });
      });

      return res.status(200).json({
        ward: wardName,
        coveredGroups,
        coveredCount: Object.keys(coveredGroups).length,
        missingCodes,
        missingCount: missingCodes.length
      });
    }

    if (action === 'getWardStats') {
      const now = Date.now();
      if (cachedWardStats && (now - lastWardStatsFetch < WARD_STATS_CACHE_TTL)) {
        return res.status(200).json({ data: cachedWardStats });
      }

      const codes = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];
      const bandImagesList = [];

      codes.forEach(code => {
        const buffers = rawDataList
          .filter(item => item.type === code && item.status)
          .map(item => ee.Geometry.Point([item.lng, item.lat]).buffer(Number(item.radius) || 500));

        let unionImg = buffers.length > 0 ? 
          ee.Image(0).byte().paint({ featureCollection: ee.FeatureCollection(buffers.map(b => ee.Feature(b))), color: 1 }) : 
          ee.Image(0).byte();

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

      const gListMulti = statsMultiGroup.groups || [];
      const multiCoverageDict = {};
      gListMulti.forEach(item => { multiCoverageDict[String(item.ID_Phuong)] = item.sum; });

      const wardLandArea = {};
      rawDataList.forEach(item => {
        if (item.status && codes.includes(item.type)) {
          const w = cleanWardStr(item.ward);
          if (!wardLandArea[w]) wardLandArea[w] = {};
          wardLandArea[w][item.type] = (wardLandArea[w][item.type] || 0) + item.size;
        }
      });

      const wardList = await new Promise((resolve, reject) => {
        wardVectorParsed.evaluate((fc, err) => err ? reject(err) : resolve(fc.features));
      });

      const resultTable = wardList.map(f => {
        const props = f.properties;
        const wName = props.tenXa || props.name || 'Phường';
        const normW = cleanWardStr(wName);
        const wId = String(props.maXa || props.OBJECTID || '');
        const totalWardPop = Number(props.danSoNum || 1);

        const sumList = multiCoverageDict[wId] || [0,0,0,0,0,0,0,0];
        let sumCoveredRatio = 0;
        const rowData = { Ten_Phuong: wName, Dan_So_Vector: totalWardPop };

        codes.forEach((code, idx) => {
          const coveredPop = sumList[idx] || 0;
          const popRatio = Math.min(100, totalWardPop > 0 ? (coveredPop / totalWardPop) * 100 : 0);
          rowData[`Ratio_${code}`] = popRatio;
          sumCoveredRatio += popRatio;

          const existArea = (wardLandArea[normW] && wardLandArea[normW][code]) || 0;
          const normVal = quotaConfig[code];
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

    return res.status(200).json({ rawDataList });

  } catch (err) {
    return res.status(500).json({ error: true, message: err.message });
  }
};
