const constants = require('../config/constants');
const { getGeeContext } = require('../services/geeService');
const { getRawDataList } = require('../services/gcsService');

let cachedWardStats = null;
let lastWardStatsFetch = 0;

async function getWardStats(req, res) {
  const now = Date.now();
  if (cachedWardStats && (now - lastWardStatsFetch < constants.WARD_STATS_CACHE_TTL)) {
    return res.status(200).json({ data: cachedWardStats });
  }

  const { ee, wardVectorParsed, popRasterNormalized, wardRegion } = getGeeContext();
  const rawDataList = await getRawDataList();

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
      const w = constants.cleanWardStr(item.ward);
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
    const normW = constants.cleanWardStr(wName);
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
      const normVal = constants.quotaConfig[code];
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

function invalidateWardStatsCache() {
  cachedWardStats = null;
  lastWardStatsFetch = 0;
}

module.exports = { getWardStats, invalidateWardStatsCache };
