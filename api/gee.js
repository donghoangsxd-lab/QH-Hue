const ee = require('@google/earthengine');
const privateKey = JSON.parse(process.env.GEE_PRIVATE_KEY);

let isGeaInitialized = false;

// ĐỒNG BỘ CẤU HÌNH BÁN KÍNH VÀ QUY MÔ MIN TỪ ĐẮC TÍNH NGHỊ ĐỊNH 35/2023/NĐ-CP
const infraConfig = {
  "1-CV": { radius: 500, minSize: 800, label: "Công viên, điểm xanh, vườn hoa" },
  "2-BDX": { radius: 500, minSize: 500, label: "Bãi đỗ xe, trạm sạc xe điện" },
  "3-MN": { radius: 500, minSize: 800, label: "Trường Mầm non" },
  "4-TH": { radius: 1000, minSize: 2000, label: "Trường Tiểu học" },
  "5-THCS": { radius: 1000, minSize: 2500, label: "Trường THCS" },
  "6-YT": { radius: 1000, minSize: 1000, label: "Bệnh viện, Trạm y tế" },
  "7-VH": { radius: 1000, minSize: 1000, label: "Nhà văn hóa, thể thao" },
  "8-TM": { radius: 1500, minSize: 1500, label: "Chợ, Trung tâm thương mại" }
};

const quotaConfig = {
  "1-CV": 2.0, "2-BDX": 2.5, "3-MN": 0.08, "4-TH": 0.1,
  "5-THCS": 0.1, "6-YT": 0.05, "7-VH": 0.08, "8-TM": 0.05
};

// CHUẨN HÓA TÊN PHƯỜNG XÃ ĐỂ TRÁNH LỖI SO SÁNH CHUỖI
function cleanWardStr(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/phường|xã|thị trấn/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function initGEE() {
  return new Promise((resolve, reject) => {
    if (isGeaInitialized) return resolve();
    ee.data.authenticateViaPrivateKey(privateKey, () => {
      ee.initialize(null, null, () => {
        isGeaInitialized = true;
        resolve();
      }, reject);
    }, reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initGEE();
    const action = req.query.action;

    // 1. TẠO TILE RASTER DÂN SỐ CHUẨN HÓA (WORLDPOP / GHSL)
    const popRasterNormalized = ee.ImageCollection("WorldPop/GP/100m/pop")
      .filter(ee.Filter.eq('country', 'VNM'))
      .filter(ee.Filter.gte('year', 2020))
      .first()
      .select('population')
      .rename('DanSoPixelNormalized');

    // 2. TẠO TILE VECTƠ RANH GIỚI 40 PHƯỜNG XÃ
    const wardVectorParsed = ee.FeatureCollection("projects/assets-hue/assets/RanhGioi_40PhuongXa_Hue");

    if (action === 'getPopRasterTile') {
      const visParams = { min: 0, max: 80, palette: ['000000', '0000ff', '00ffff', '00ff00', 'ffff00', 'ff0000'] };
      const mapId = await new Promise((resolve, reject) => {
        popRasterNormalized.getMap(visParams, (mapObj, err) => err ? reject(err) : resolve(mapObj));
      });
      return res.status(200).json({ urlFormat: mapId.urlFormat });
    }

    if (action === 'getBoundaryTile') {
      const emptyBg = ee.Image().byte();
      const outline = emptyBg.paint({ featureCollection: wardVectorParsed, color: 1, width: 2 });
      const visParams = { palette: '00ffff' };
      const mapId = await new Promise((resolve, reject) => {
        outline.getMap(visParams, (mapObj, err) => err ? reject(err) : resolve(mapObj));
      });
      return res.status(200).json({ urlFormat: mapId.urlFormat });
    }

    // NẠP DỮ LIỆU ĐIỂM HẠ TẦNG HIỆN TRẠNG TỪ ASSETS/DRIVE
    const rawDataList = req.body && req.body.rawDataList ? req.body.rawDataList : [];

    // 3. THUẬT TOÁN GỢI Ý CHUYỂN ĐỔI ĐẤT (9-CSD) - TRIỆT TIÊU DÂN SỐ ÂM
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

      for (const code of codesToCheck) {
        const reqMinSize = infraConfig[code].minSize;
        if (size < reqMinSize) {
          ineligible.push({ code, label: infraConfig[code].label, minSize: reqMinSize });
          continue;
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

        const popRes = await new Promise((resolve) => {
          popRasterNormalized.reduceRegion({
            reducer: ee.Reducer.sum(),
            geometry: netBufferGeom,
            scale: 30,
            maxPixels: 1e9
          }).evaluate((r) => resolve(r ? r.DanSoPixelNormalized : 0));
        });

        // TRIỆT TIÊU TOÀN BỘ GIÁ TRỊ ÂM NẾU CÓ TRONG PHÉP TRỪ CẮT KHÔNG GIAN
        const rawPopVal = Math.round(popRes || 0);
        const cleanPopGained = Math.max(0, rawPopVal);

        suggestions.push({
          code,
          label: infraConfig[code].label,
          deficitArea: Math.max(0, deficitArea),
          isWardDeficit: deficitArea > 0,
          popGained: cleanPopGained
        });
      }

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

    // 4. PHÂN TÍCH TẢI DÂN SỐ PHỤC VỤ THEO BÁN KÍNH ĐỂM
    if (action === 'analyzePoint') {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const radius = Number(req.query.radius) || 500;

      const ptBuffer = ee.Geometry.Point([lng, lat]).buffer(radius);
      const popRes = await new Promise((resolve) => {
        popRasterNormalized.reduceRegion({
          reducer: ee.Reducer.sum(),
          geometry: ptBuffer,
          scale: 30,
          maxPixels: 1e9
        }).evaluate((r) => resolve(r ? r.DanSoPixelNormalized : 0));
      });

      return res.status(200).json({ servedPop: Math.max(0, Math.round(popRes || 0)) });
    }

    // 5. TẠO TILE HEATMAP THIẾU HỤT HẠ TẦNG MA TRẬN
    if (action === 'getHeatmapTile') {
      const bufferFeatures = rawDataList
        .filter(item => item.status && item.type !== "9-CSD")
        .map(item => ee.Feature(ee.Geometry.Point([item.lng, item.lat]).buffer(Number(item.radius) || 500)));

      let heatmapImg = ee.Image(1);
      if (bufferFeatures.length > 0) {
        const coveredGeom = ee.FeatureCollection(bufferFeatures).geometry();
        const coveredMask = ee.Image.constant(1).clip(coveredGeom);
        heatmapImg = heatmapImg.where(coveredMask.eq(1), 0);
      }

      const heatmapVis = { min: 0, max: 1, palette: ['00ff00', 'ffff00', 'ff0000'] };
      const mapId = await new Promise((resolve, reject) => {
        heatmapImg.getMap(heatmapVis, (mapObj, err) => err ? reject(err) : resolve(mapObj));
      });

      return res.status(200).json({ urlFormat: mapId.urlFormat });
    }

    // TRẢ VỀ DỮ LIỆU ĐIỂM SƠ BỘ VÀ TỔNG HỢP 40 PHƯỜNG XÃ
    return res.status(200).json({ rawDataList });

  } catch (error) {
    console.error("GEE API Error:", error);
    return res.status(500).json({ error: error.message });
  }
};
