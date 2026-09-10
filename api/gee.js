const ee = require('@google/earthengine');

let isGeeInitialized = false;

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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initGEE();
    const action = req.query.action || 'getInitData';

    // 1. DỮ LIỆU NỀN GEE
    const popRaster = ee.Image("projects/optimistic-yew-488501-s0/assets/Pixel-danso").select(0).rename('DanSoPixel');
    const wardRegion = ee.Image("projects/optimistic-yew-488501-s0/assets/Output40xa").select(0).rename('ID_Region');
    const wardVector = ee.FeatureCollection("projects/optimistic-yew-488501-s0/assets/Polygon-40xa");

    const wardVectorParsed = wardVector.map(f => {
      const rawPop = f.get('danSo');
      const popNum = ee.Algorithms.If(rawPop, ee.Number.parse(ee.String(rawPop)), 0);
      return f.set('danSoNum', popNum);
    });

    const validPopMask = popRaster.gt(0);
    const validPopRaster = popRaster.updateMask(validPopMask);
    const wardPopSumImg = ee.Image().double().paint({ featureCollection: wardVectorParsed, color: 'danSoNum' });

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
      wardPixelCountDict.keys().map(k => ee.Number.parse(k)),
      wardPixelCountDict.values()
    );

    const popRasterNormalized = wardPopSumImg.divide(wardPixelCountImg)
      .updateMask(validPopMask)
      .rename('DanSoPixelNormalized');

    // NẠP DỮ LIỆU TỪ GOOGLE APPS SCRIPT
    const gasUrl = "https://script.google.com/macros/s/AKfycbzyvYP9WoDizfwb-ZMT374jHbLY02X3HlhxKnmZEYl8UrYrO6SSzSB7eQRH0kaXWguU/exec?action=getJson";
    const gasResponse = await fetch(gasUrl);
    const geojson = await gasResponse.json();
    const features = geojson.features || [];

    const codeMap = { "CV": "1-CV", "BDX": "2-BDX", "MN": "3-MN", "TH": "4-TH", "THCS": "5-THCS", "YT": "6-YT", "VH": "7-VH", "TM": "8-TM", "CSD": "9-CSD" };
    const rawDataList = features.map(ft => {
      const props = ft.properties || {};
      const coords = ft.geometry ? ft.geometry.coordinates : [107.5905, 16.4637];
      const rawId = String(props.ID_DoiTuong || '');
      const prefix = rawId.split('-')[0];

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

    if (action === 'getPopRasterTile') {
      const mapId = await new Promise((resolve, reject) => {
        popRasterNormalized.getMap(
          { min: 0, max: 5, palette: ['blue', 'cyan', 'green', 'yellow', 'orange', 'red'] },
          (m, err) => err ? reject(err) : resolve(m)
        );
      });
      return res.status(200).json({ urlFormat: mapId.urlFormat });
    }

    if (action === 'getBoundaryTile') {
      const wardOutline = ee.Image().byte().paint({ featureCollection: wardVectorParsed, color: 1, width: 2 });
      const mapId = await new Promise((resolve, reject) => {
        wardOutline.getMap({ palette: ['#00ffff'] }, (m, err) => err ? reject(err) : resolve(m));
      });
      return res.status(200).json({ urlFormat: mapId.urlFormat });
    }

    if (action === 'getHeatmapTile') {
      const categoryImageLayers = [];
      const codes = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];

      codes.forEach(code => {
        const groupFeatures = rawDataList
          .filter(item => item.type === code && item.status)
          .map(item => ee.Feature(ee.Geometry.Point([item.lng, item.lat]).buffer(Number(item.radius) || 500)));
        if (groupFeatures.length > 0) {
          categoryImageLayers.push(ee.Image(0).byte().paint({ featureCollection: ee.FeatureCollection(groupFeatures), color: 1 }));
        }
      });

      const heatmapImage = ee.ImageCollection(categoryImageLayers).sum();
      const heatmapMasked = heatmapImage.updateMask(heatmapImage.gt(0));

      const mapId = await new Promise((resolve, reject) => {
        heatmapMasked.getMap(
          { min: 1, max: 8, palette: ['#5dade2', '#2ecc71', '#f1c40f', '#f39c12', '#e67e22', '#d35400', '#e74c3c', '#900c3f'] }, 
          (m, err) => err ? reject(err) : resolve(m)
        );
      });
      return res.status(200).json({ urlFormat: mapId.urlFormat });
    }

    // 2. PHÂN TÍCH CHI TIẾT ĐIỂM HẠ TẦNG CLICK
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

    // 3. THUẬT TOÁN GỢI Ý ĐẤT CHUYỂN ĐỔI (9-CSD) 2 CẤP
    if (action === 'analyzeCSD') {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const size = Number(req.query.size) || 0;
      const wardNameParam = String(req.query.ward || '').trim().toLowerCase();
      const ptGeom = ee.Geometry.Point([lng, lat]);

      const wardFt = wardVectorParsed.filter(
        ee.Filter.stringMatches('tenXa', `.*${req.query.ward}.*`, 'i')
      ).first();

      const wardPop = await new Promise((resolve) => {
        wardFt.evaluate((ft) => resolve(ft ? Number(ft.properties.danSoNum || 0) : 0));
      });

      const wardExistAreas = {};
      rawDataList.forEach(item => {
        if (item.status && item.ward.trim().toLowerCase().includes(wardNameParam)) {
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
        const reqArea = Math.round(wardPop * normVal);
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

        suggestions.push({
          code,
          label: infraConfig[code].label,
          deficitArea: Math.max(0, deficitArea),
          isWardDeficit: deficitArea > 0,
          popGained: Math.round(popRes || 0)
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

    // 4. BẢNG THỐNG KÊ MẬT ĐỘ TÁCH CỘT
    if (action === 'getWardStats') {
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
          scale: 60,
          maxPixels: 1e9
        }).evaluate((res, err) => err ? reject(err) : resolve(res));
      });

      const gListMulti = statsMultiGroup.groups || [];
      const multiCoverageDict = {};
      gListMulti.forEach(item => { multiCoverageDict[String(item.ID_Phuong)] = item.sum; });

      const wardLandArea = {};
      rawDataList.forEach(item => {
        if (item.status && codes.includes(item.type)) {
          const w = item.ward.trim().toLowerCase();
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
        const normW = wName.trim().toLowerCase();
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
      return res.status(200).json({ data: resultTable });
    }

    return res.status(200).json({ rawDataList });

  } catch (err) {
    return res.status(500).json({ error: true, message: err.message });
  }
};
