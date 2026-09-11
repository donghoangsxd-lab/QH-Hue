const constants = require('../config/constants');
const { getGeeContext } = require('../services/geeService');
const { getRawDataList } = require('../services/gcsService');

async function analyzeCSD(req, res) {
  const { ee, wardVectorParsed, popRasterNormalized } = getGeeContext();
  const rawDataList = await getRawDataList();

  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const size = Number(req.query.size) || 0;
  const rawWardParam = String(req.query.ward || '');
  const cleanTargetWard = constants.cleanWardStr(rawWardParam);
  const ptGeom = ee.Geometry.Point([lng, lat]);

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

  const codesToCheck = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];
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

module.exports = { analyzeCSD };
