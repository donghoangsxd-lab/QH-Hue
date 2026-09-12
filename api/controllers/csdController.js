const constants = require('../config/constants');
const { getGeeContext, buildEeIsochroneGeometry } = require('../services/geeService');
const { getRawDataList } = require('../services/gcsService');

async function analyzeCSD(req, res) {
  try {
    const { ee, wardVectorParsed, popRasterNormalized } = getGeeContext();
    const rawDataList = await getRawDataList();

    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const size = Number(req.query.size) || 0;
    const rawWardParam = String(req.query.ward || '');
    const cleanTargetWard = constants.cleanWardStr(rawWardParam);

    if (!lat || !lng) {
      return res.status(400).json({ error: true, message: "Thiếu tọa độ điểm vị trí" });
    }

    // Lấy danh sách phường/xã để xác định tổng dân số phường mục tiêu
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

    // Tính tổng diện tích hạ tầng hiện có trong phường theo loại
    const wardExistAreas = {};
    rawDataList.forEach(item => {
      if (item.status && constants.cleanWardStr(item.ward) === cleanTargetWard) {
        wardExistAreas[item.type] = (wardExistAreas[item.type] || 0) + item.size;
      }
    });

    const codesToCheck = constants.CODES_TO_CHECK || ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];
    const suggestions = [];
    const ineligible = [];

    const csdPromises = codesToCheck.map(async (code) => {
      const reqMinSize = constants.infraConfig[code].minSize;
      
      // Kiểm tra điều kiện diện tích tối thiểu
      if (size < reqMinSize) {
        ineligible.push({ code, label: constants.infraConfig[code].label, minSize: reqMinSize });
        return;
      }

      const normVal = constants.quotaConfig[code] || 0;
      const reqArea = Math.round(targetWardPop * normVal);
      const existArea = wardExistAreas[code] || 0;
      const deficitArea = reqArea - existArea;

      const candidateRadius = constants.infraConfig[code].radius;
      
      // 🚀 Tích hợp ISOCHRONE MẠNG LƯỚI (90% + 10%) thay cho đường tròn thuần
      const testBuffer = buildEeIsochroneGeometry(lat, lng, candidateRadius);

      // Xây dựng vùng phục vụ Isochrone của các công trình cùng loại đã tồn tại
      const existingBuffers = rawDataList
        .filter(item => item.type === code && item.status)
        .map(item => ee.Feature(buildEeIsochroneGeometry(item.lat, item.lng, Number(item.radius) || candidateRadius)));

      let netBufferGeom = testBuffer;
      if (existingBuffers.length > 0) {
        const existUnion = ee.FeatureCollection(existingBuffers).geometry();
        netBufferGeom = testBuffer.difference(existUnion, 1);
      }

      // Tính dân số ròng (Net Population Gain) trong vùng chưa được phục vụ
      const netPopRes = await new Promise((resolve) => {
        popRasterNormalized.reduceRegion({
          reducer: ee.Reducer.sum(),
          geometry: netBufferGeom,
          scale: 30,
          maxPixels: 1e9
        }).evaluate((r) => resolve(r ? r.DanSoPixelNormalized : 0));
      });

      let cleanPopGained = Math.max(0, Math.round(netPopRes || 0));

      // Trường hợp vùng ròng bằng 0, tính tổng dân số thô trong bán kính Isochrone
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

    // Sắp xếp thứ tự ưu tiên gợi ý chuyển đổi
    suggestions.sort((a, b) => {
      if (a.isWardDeficit !== b.isWardDeficit) return a.isWardDeficit ? -1 : 1;
      if (a.isWardDeficit && b.isWardDeficit) return b.deficitArea - a.deficitArea;
      return b.popGained - a.popGained;
    });

    if (suggestions.length > 0 && suggestions[0].isWardDeficit) {
      suggestions[0].isTopPriority = true;
    }

    return res.status(200).json({ suggestions, ineligible });

  } catch (err) {
    return res.status(500).json({ error: true, message: err.message });
  }
}

module.exports = { analyzeCSD };
