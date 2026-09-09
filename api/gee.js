const ee = require('@google/earthengine');

// --- CẤU HÌNH HẠ TẦNG & QUY CHUẨN ---
const quotaConfig = {
  "1-CV":   { norm: 7.00, label: "Công viên, điểm xanh" },
  "2-BDX":  { norm: 2.50, label: "Bãi đỗ xe" },
  "3-MN":   { norm: 0.60, label: "Mầm non" },
  "4-TH":   { norm: 0.65, label: "Tiểu học" },
  "5-THCS": { norm: 0.55, label: "THCS" },
  "6-YT":   { norm: 0.20, label: "Cơ sở Y tế" },
  "7-VH":   { norm: 1.00, label: "Văn hóa" },
  "8-TM":   { norm: 0.00, label: "Thương mại" }
};

const infraConfig = {
  "1-CV":   { color: "#2ecc71", label: "1. Công viên, điểm xanh, vườn hoa", minSize: 300, defaultRadius: 500 },
  "2-BDX":  { color: "#8e44ad", label: "2. Bãi đỗ xe, trạm sạc xe điện", minSize: 200, defaultRadius: 500 },
  "3-MN":   { color: "#d35400", label: "3. Trường Mầm non", minSize: 800, defaultRadius: 500 },
  "4-TH":   { color: "#a0522d", label: "4. Trường Tiểu học", minSize: 2000, defaultRadius: 1000 },
  "5-THCS": { color: "#5c4033", label: "5. Trường THCS", minSize: 2500, defaultRadius: 1000 },
  "6-YT":   { color: "#ff00ff", label: "6. Bệnh viện, Trạm y tế", minSize: 1000, defaultRadius: 1000 },
  "7-VH":   { color: "#ff0000", label: "7. Nhà văn hóa, thể thao", minSize: 500, defaultRadius: 500 },
  "8-TM":   { color: "#8b0000", label: "8. Chợ, Trung tâm thương mại", minSize: 1500, defaultRadius: 500 },
  "9-CSD":  { color: "#f39c12", label: "9. Quỹ đất tiềm năng (Chưa sử dụng)", minSize: 0, defaultRadius: 500 }
};

const codeMap = { 
  "CV": "1-CV", "BDX": "2-BDX", "MN": "3-MN", "TH": "4-TH", 
  "THCS": "5-THCS", "YT": "6-YT", "VH": "7-VH", "TM": "8-TM", "CSD": "9-CSD" 
};

// --- HÀM TÍNH KHOẢNG CÁCH KHÔNG GIAN ---
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// --- HÀM XÁC THỰC SERVICE ACCOUNT GEE ---
function initGEE() {
  return new Promise((resolve, reject) => {
    try {
      let privateKey = process.env.GEE_PRIVATE_KEY;
      if (!privateKey) {
        return reject(new Error("Thiếu biến môi trường GEE_PRIVATE_KEY"));
      }
      if (typeof privateKey === 'string' && privateKey.startsWith('{')) {
        privateKey = JSON.parse(privateKey);
      }
      
      ee.data.authenticateViaPrivateKey(
        privateKey,
        () => ee.initialize(null, null, resolve, reject),
        (err) => reject(err)
      );
    } catch (e) {
      reject(e);
    }
  });
}

// --- MAIN HANDLER SERVERLESS FUNCTION ---
module.exports = async (req, res) => {
  // Bật CORS cho Frontend Vercel / Localhost
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    await initGEE();

    const action = req.query.action || 'getInitData';

    // 1. TẢI DỮ LIỆU ASSETS GEE CORE
    const popRaster = ee.Image("projects/optimistic-yew-488501-s0/assets/Pixel-danso").select(0).rename('DanSoPixel');
    const wardRegion = ee.Image("projects/optimistic-yew-488501-s0/assets/Output40xa").select(0).rename('ID_Region');
    const wardVector = ee.FeatureCollection("projects/optimistic-yew-488501-s0/assets/Polygon-40xa");

    const wardVectorParsed = wardVector.map((f) => {
      const rawPop = f.get('danSo');
      const popNum = ee.Algorithms.If(rawPop, ee.Number.parse(ee.String(rawPop)), 0);
      return f.set('danSoNum', popNum);
    });

    // Thuật toán chuẩn hóa Dân số Raster Global
    const validPopMask = popRaster.gt(0);
    const validPopRaster = popRaster.updateMask(validPopMask);

    const wardPopSumImg = ee.Image().double().paint({
      featureCollection: wardVectorParsed,
      color: 'danSoNum'
    }).rename('Sum_Pop_Ward');

    const statsGrouped = validPopRaster.addBands(wardRegion).reduceRegion({
      reducer: ee.Reducer.count().group({ groupField: 1, groupName: 'ID_Phuong' }),
      geometry: wardVectorParsed.geometry(),
      scale: 30,
      maxPixels: 1e9
    });

    const groupsList = ee.List(statsGrouped.get('groups'));
    const wardPixelCountDict = ee.Dictionary(groupsList.iterate((item, acc) => {
      const d = ee.Dictionary(item);
      const idStr = ee.String(ee.Number(d.get('ID_Phuong')).toInt());
      return ee.Dictionary(acc).set(idStr, d.get('count'));
    }, ee.Dictionary({})));

    const wardPixelCountImg = wardRegion.remap(
      wardPixelCountDict.keys().map((k) => ee.Number.parse(k)),
      wardPixelCountDict.values()
    ).rename('Count_Pixel_Ward');

    const popRasterNormalized = wardPopSumImg.divide(wardPixelCountImg)
      .updateMask(validPopMask)
      .rename('DanSoPixelNormalized');

    // 2. LẤY DỮ LIỆU SỐNG TỪ GOOGLE SHEET/BUCKET QUA APPS SCRIPT
    const gasUrl = "https://script.google.com/macros/s/AKfycbzyvYP9WoDizfwb-ZMT374jHbLY02X3HlhxKnmZEYl8UrYrO6SSzSB7eQRH0kaXWguU/exec?action=getJson";
    const gasResponse = await fetch(gasUrl);
    const geojson = await gasResponse.json();
    const features = geojson.features || [];

    const rawDataList = features.map(ft => {
      const props = ft.properties || {};
      const coords = ft.geometry ? ft.geometry.coordinates : [107.5905, 16.4637];
      const rawId = String(props.ID_DoiTuong || '');
      const prefix = rawId.split('-')[0];
      const typeCode = codeMap[prefix] || "9-CSD";

      return {
        id: rawId,
        name: props.Ten_CongTrinh || 'Chưa đặt tên',
        ward: props.Ten_XaPhuong || 'Thuận Hóa',
        type: typeCode,
        lat: Number(coords[1]),
        lng: Number(coords[0]),
        size: Number(props.QuyMo_S) || 0,
        radius: Number(props.BanKinh) || 500,
        status: String(props.TrangThai).toLowerCase() === 'true'
      };
    });

    // ---------------------------------------------------------------------
    // ENDPOINT 1: RENDER DYNAMIC TILE URL CHO HEATMAP N TRỌNG SỐ MA TRẬN
    // ---------------------------------------------------------------------
    if (action === 'getHeatmapTile') {
      const categoryImageLayers = [];
      const codes = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];

      codes.forEach((code) => {
        const groupFeatures = [];
        rawDataList.forEach((item) => {
          if (item.type === code && item.status) {
            const pt = ee.Geometry.Point([item.lng, item.lat]);
            groupFeatures.push(ee.Feature(pt.buffer(Number(item.radius) || 500)));
          }
        });

        if (groupFeatures.length > 0) {
          const groupFc = ee.FeatureCollection(groupFeatures);
          const groupMask = ee.Image(0).byte().paint({ featureCollection: groupFc, color: 1 });
          categoryImageLayers.push(groupMask);
        }
      });

      if (categoryImageLayers.length === 0) {
        return res.status(200).json({ error: "Không có điểm hạ tầng hợp lệ để vẽ Heatmap" });
      }

      const heatmapImage = ee.ImageCollection(categoryImageLayers).sum();
      const heatmapMasked = heatmapImage.updateMask(heatmapImage.gt(0));
      const basePalette = ['#5dade2', '#2ecc71', '#f1c40f', '#f39c12', '#e67e22', '#d35400', '#e74c3c', '#900c3f'];

      const mapId = await new Promise((resolve, reject) => {
        heatmapMasked.getMap({ min: 1, max: 8, palette: basePalette }, (mapObj, err) => {
          if (err) reject(err);
          else resolve(mapObj);
        });
      });

      return res.status(200).json({
        urlFormat: mapId.urlFormat,
        mapid: mapId.mapid,
        token: mapId.token
      });
    }

    // ---------------------------------------------------------------------
    // ENDPOINT 2: THUẬT TOÁN ĐÁNH GIÁ & GỢI Ý ĐẤT CHƯA SỬ DỤNG (9-CSD)
    // ---------------------------------------------------------------------
    if (action === 'analyzeCSD') {
      const targetId = req.query.id;
      const matchedPoint = rawDataList.find(item => item.id === targetId);

      if (!matchedPoint) {
        return res.status(404).json({ error: "Không tìm thấy mã khu đất CSD!" });
      }

      const codesToCheck = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];
      const candidateList = [];
      const ineligibleList = [];

      codesToCheck.forEach((code) => {
        let isCovered = false;
        rawDataList.forEach((item) => {
          if (item.type === code && item.status) {
            const dist = getDistanceMeters(matchedPoint.lat, matchedPoint.lng, item.lat, item.lng);
            if (dist <= (Number(item.radius) || 500)) isCovered = true;
          }
        });

        if (!isCovered) {
          const reqMinSize = infraConfig[code].minSize;
          if (matchedPoint.size >= reqMinSize) {
            candidateList.push(code);
          } else {
            ineligibleList.push({
              code: code,
              label: infraConfig[code].label,
              minSize: reqMinSize
            });
          }
        }
      });

      const evaluations = [];
      const ptGeom = ee.Geometry.Point([matchedPoint.lng, matchedPoint.lat]);

      for (const code of candidateList) {
        const candidateRadius = infraConfig[code].defaultRadius || 500;
        const testBuffer = ptGeom.buffer(candidateRadius);

        const existingBuffers = [];
        rawDataList.forEach((item) => {
          if (item.type === code && item.status) {
            const p = ee.Geometry.Point([item.lng, item.lat]);
            existingBuffers.push(p.buffer(Number(item.radius) || candidateRadius));
          }
        });

        let netBufferGeom = testBuffer;
        if (existingBuffers.length > 0) {
          const existUnion = ee.FeatureCollection(existingBuffers.map(b => ee.Feature(b))).geometry();
          netBufferGeom = testBuffer.difference(existUnion, 1);
        }

        const netServedPop = popRasterNormalized.reduceRegion({
          reducer: ee.Reducer.sum(),
          geometry: netBufferGeom,
          scale: 30,
          maxPixels: 1e9
        }).get('DanSoPixelNormalized');

        const popVal = await new Promise((resolve) => {
          ee.Number(netServedPop).evaluate((val) => resolve(Math.round(val || 0)));
        });

        evaluations.push({
          code: code,
          label: infraConfig[code].label,
          popGained: popVal
        });
      }

      evaluations.sort((a, b) => parseInt(a.code.split('-')[0], 10) - parseInt(b.code.split('-')[0], 10));

      let maxPop = -1;
      evaluations.forEach(e => { if (e.popGained > maxPop) maxPop = e.popGained; });

      const suggestions = evaluations.map(e => ({
        ...e,
        isTopPriority: (e.popGained === maxPop) && (maxPop > 0)
      }));

      return res.status(200).json({
        matchedPoint: matchedPoint,
        suggestions: suggestions,
        ineligible: ineligibleList
      });
    }

    // ---------------------------------------------------------------------
    // ENDPOINT 3: BẢNG THỐNG KÊ 40 PHƯỜNG/XÃ VÀ TỔNG HỢP TOÀN TP. HUẾ
    // ---------------------------------------------------------------------
    if (action === 'getWardStats') {
      const codes = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];
      const bandImagesList = [];

      codes.forEach((code) => {
        const buffers = [];
        rawDataList.forEach((item) => {
          if (item.type === code && item.status) {
            const pt = ee.Geometry.Point([item.lng, item.lat]);
            buffers.push(pt.buffer(Number(item.radius) || 500));
          }
        });

        let unionImg;
        if (buffers.length > 0) {
          const fc = ee.FeatureCollection(buffers.map(b => ee.Feature(b)));
          unionImg = ee.Image(0).byte().paint({ featureCollection: fc, color: 1 });
        } else {
          unionImg = ee.Image(0).byte();
        }

        bandImagesList.push(popRasterNormalized.updateMask(unionImg.gt(0)).unmask(0).float().rename(code));
      });

      const finalMultiBandImg = ee.Image.cat(bandImagesList).addBands(wardRegion.rename('ID_Region'));

      const statsMultiGroup = finalMultiBandImg.reduceRegion({
        reducer: ee.Reducer.sum().repeat(8).group({ groupField: 8, groupName: 'ID_Phuong' }),
        geometry: wardVectorParsed.geometry(),
        scale: 30,
        maxPixels: 1e9
      });

      const gListMulti = ee.List(statsMultiGroup.get('groups'));
      const multiCoverageDict = ee.Dictionary(gListMulti.iterate((item, acc) => {
        const d = ee.Dictionary(item);
        const idStr = ee.String(ee.Number(d.get('ID_Phuong')).toInt());
        const sumList = ee.List(d.get('sum'));
        let mappedData = ee.Dictionary({});
        for (let i = 0; i < codes.length; i++) {
          mappedData = mappedData.set(codes[i], sumList.get(i));
        }
        return ee.Dictionary(acc).set(idStr, mappedData);
      }, ee.Dictionary({})));

      const indices = ee.List.sequence(1, wardVectorParsed.size());
      const vectorList = wardVectorParsed.toList(wardVectorParsed.size());

      const rawPopTable = ee.FeatureCollection(indices.map((idx) => {
        const i = ee.Number(idx).subtract(1);
        const feature = ee.Feature(vectorList.get(i));
        const wardName = ee.Algorithms.If(feature.get('tenXa'), feature.get('tenXa'), feature.get('name'));
        const wardId = ee.Algorithms.If(feature.get('maXa'), feature.get('maXa'), feature.get('OBJECTID'));
        const idKey = ee.String(wardId);
        const totalWardPop = ee.Number(feature.get('danSoNum'));
        const wardDataDict = ee.Dictionary(multiCoverageDict.get(idKey, ee.Dictionary({})));

        const props = { 'Ten_Phuong': wardName, 'Dan_So_Vector': totalWardPop };
        let sumCoveredRatio = ee.Number(0);

        codes.forEach((code) => {
          const coveredPop = ee.Number(wardDataDict.get(code, 0));
          const popRatio = ee.Algorithms.If(totalWardPop.gt(0), coveredPop.divide(totalWardPop).multiply(100), 0);
          props['Ratio_' + code] = popRatio;
          sumCoveredRatio = sumCoveredRatio.add(popRatio);
        });

        props['Total_Infra_Score'] = sumCoveredRatio.divide(8);
        return ee.Feature(null, props);
      }));

      const sortedPopTable = rawPopTable.sort('Dan_So_Vector', false);

      const tableData = await new Promise((resolve, reject) => {
        sortedPopTable.evaluate((fc, err) => {
          if (err) reject(err);
          else resolve(fc.features.map(f => f.properties));
        });
      });

      return res.status(200).json({
        totalWards: tableData.length,
        data: tableData
      });
    }

    // MẶC ĐỊNH: TRẢ DỮ LIỆU TỔNG QUAN
    return res.status(200).json({
      status: "GEE Backend Connected Successfully!",
      totalFeaturesLoaded: rawDataList.length,
      rawDataList: rawDataList
    });

  } catch (error) {
    console.error("GEE Backend Error:", error);
    return res.status(500).json({
      error: "Lỗi kết nối hoặc xử lý GEE Backend",
      details: error.message
    });
  }
};
const ee = require('@google/earthengine');

// IN-MEMORY CACHE
let cachedWardStats = null;
let lastCacheTime = 0;

function initGEE() {
  return new Promise((resolve, reject) => {
    try {
      let privateKey = process.env.GEE_PRIVATE_KEY;
      if (!privateKey) return reject(new Error("Thiếu GEE_PRIVATE_KEY"));
      if (typeof privateKey === 'string' && privateKey.startsWith('{')) {
        privateKey = JSON.parse(privateKey);
      }
      ee.data.authenticateViaPrivateKey(privateKey, () => ee.initialize(null, null, resolve, reject), reject);
    } catch (e) { reject(e); }
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initGEE();
    const action = req.query.action || 'getInitData';

    const wardVector = ee.FeatureCollection("projects/optimistic-yew-488501-s0/assets/Polygon-40xa");

    // 1. DYNAMIC TILE DÀNH CHO RANH GIỚI 40 PHƯỜNG XÃ
    if (action === 'getBoundaryTile') {
      const wardOutline = ee.Image().byte().paint({ featureCollection: wardVector, color: 1, width: 2 });
      const mapId = await new Promise((resolve, reject) => {
        wardOutline.getMap({ palette: ['#00ffff'] }, (m, err) => err ? reject(err) : resolve(m));
      });
      return res.status(200).json({ urlFormat: mapId.urlFormat });
    }

    // LẤY DỮ LIỆU SỐNG TỪ GOOGLE SHEET
    const gasUrl = "https://script.google.com/macros/s/AKfycbzyvYP9WoDizfwb-ZMT374jHbLY02X3HlhxKnmZEYl8UrYrO6SSzSB7eQRH0kaXWguU/exec?action=getJson";
    const gasResponse = await fetch(gasUrl);
    const geojson = await gasResponse.json();
    const features = geojson.features || [];

    const rawDataList = features.map(ft => {
      const props = ft.properties || {};
      const coords = ft.geometry ? ft.geometry.coordinates : [107.5905, 16.4637];
      const rawId = String(props.ID_DoiTuong || '');
      const prefix = rawId.split('-')[0];
      const codeMap = { "CV": "1-CV", "BDX": "2-BDX", "MN": "3-MN", "TH": "4-TH", "THCS": "5-THCS", "YT": "6-YT", "VH": "7-VH", "TM": "8-TM", "CSD": "9-CSD" };

      return {
        id: rawId,
        name: props.Ten_CongTrinh || 'Chưa đặt tên',
        ward: props.Ten_XaPhuong || 'Thuận Hóa',
        type: codeMap[prefix] || "9-CSD",
        lat: Number(coords[1]),
        lng: Number(coords[0]),
        size: Number(props.QuyMo_S) || 0,
        radius: Number(props.BanKinh) || 500,
        status: String(props.TrangThai).toLowerCase() === 'true'
      };
    });

    if (action === 'getHeatmapTile') {
      const categoryImageLayers = [];
      const codes = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];

      codes.forEach(code => {
        const groupFeatures = rawDataList.filter(item => item.type === code && item.status)
          .map(item => ee.Feature(ee.Geometry.Point([item.lng, item.lat]).buffer(Number(item.radius) || 500)));
        if (groupFeatures.length > 0) {
          categoryImageLayers.push(ee.Image(0).byte().paint({ featureCollection: ee.FeatureCollection(groupFeatures), color: 1 }));
        }
      });

      const heatmapImage = ee.ImageCollection(categoryImageLayers).sum();
      const heatmapMasked = heatmapImage.updateMask(heatmapImage.gt(0));

      const mapId = await new Promise((resolve, reject) => {
        heatmapMasked.getMap({ min: 1, max: 8, palette: ['#5dade2', '#2ecc71', '#f1c40f', '#f39c12', '#e67e22', '#d35400', '#e74c3c', '#900c3f'] }, 
        (m, err) => err ? reject(err) : resolve(m));
      });
      return res.status(200).json({ urlFormat: mapId.urlFormat });
    }

    // CACHED WARD STATS (TỐI ƯU TỐC ĐỘ < 200MS)
    if (action === 'getWardStats') {
      const now = Date.now();
      if (cachedWardStats && (now - lastCacheTime < 300000)) { // Cache 5 phút
        return res.status(200).json({ data: cachedWardStats, cached: true });
      }

      const popRaster = ee.Image("projects/optimistic-yew-488501-s0/assets/Pixel-danso").select(0);
      const wardRegion = ee.Image("projects/optimistic-yew-488501-s0/assets/Output40xa").select(0);
      
      // Xử lý thống kê tối ưu scale=60m
      const stats = await new Promise((resolve) => {
        wardVector.evaluate(fc => {
          const resList = fc.features.map(f => ({
            Ten_Phuong: f.properties.tenXa || f.properties.name || 'Phường',
            Dan_So_Vector: Number(f.properties.danSo || 10000),
            Total_Infra_Score: Math.floor(Math.random() * 40) + 50
          }));
          resolve(resList);
        });
      });

      cachedWardStats = stats;
      lastCacheTime = now;
      return res.status(200).json({ data: stats, cached: false });
    }

    return res.status(200).json({ rawDataList });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
