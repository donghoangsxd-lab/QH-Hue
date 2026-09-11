const constants = require('./config/constants');
const { initGEE, getGeeContext } = require('./services/geeService');
const { getRawDataList, invalidateCache } = require('./services/gcsService');
const { analyzeCSD } = require('./controllers/csdController');
const { getWardStats, invalidateWardStatsCache } = require('./controllers/wardController');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initGEE();
    const action = req.query.action || 'getInitData';

    if (action === 'getWardFromPoint') {
      const { ee, wardVectorParsed } = getGeeContext();
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

      const syncUrl = `${constants.GAS_BASE_URL}?action=addPoint` +
        `&type=${encodeURIComponent(type)}` +
        `&name=${encodeURIComponent(name)}` +
        `&ward=${encodeURIComponent(ward || 'Thuận Hóa')}` +
        `&lat=${lat}&lng=${lng}&size=${size || 0}`;

      invalidateCache();
      invalidateWardStatsCache();
      const gasRes = await fetch(syncUrl);
      const result = await gasRes.json().catch(() => ({ success: true }));
      return res.status(200).json({ success: true, result });
    }

    if (action === 'approvePoint') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: true, message: "Thiếu ID công trình" });

      const syncUrl = `${constants.GAS_BASE_URL}?action=approvePoint&id=${encodeURIComponent(id)}`;
      invalidateCache();
      invalidateWardStatsCache();
      const gasRes = await fetch(syncUrl);
      const result = await gasRes.json().catch(() => ({ success: true }));
      return res.status(200).json({ success: true, result });
    }

    if (action === 'getPopRasterTile') {
      const { popRasterNormalized } = getGeeContext();
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
      const { ee, wardVectorParsed } = getGeeContext();
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
      const wardOutline = ee.Image().byte().paint({ featureCollection: wardVectorParsed, color: 1, width: 2 });
      const mapId = await new Promise((resolve, reject) => {
        wardOutline.getMap({ palette: ['#00ffff'] }, (m, err) => err ? reject(err) : resolve(m));
      });
      return res.status(200).json({ urlFormat: mapId.urlFormat });
    }

    if (action === 'getHeatmapTile') {
      const { ee } = getGeeContext();
      const rawDataList = await getRawDataList();
      const categoryImageLayers = [];
      const codes = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];

      codes.forEach(code => {
        const groupFeatures = rawDataList
          .filter(item => item.type === code && item.status === true)
          .map(item => ee.Feature(ee.Geometry.Point([item.lng, item.lat]).buffer(Number(item.radius) || 500)));
        if (groupFeatures.length > 0) {
          categoryImageLayers.push(ee.Image(0).byte().paint({ featureCollection: ee.FeatureCollection(groupFeatures), color: 1 }));
        }
      });

      let heatmapMasked;
      if (categoryImageLayers.length > 0) {
        const heatmapImage = ee.ImageCollection(categoryImageLayers).sum();
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
      const { ee, popRasterNormalized } = getGeeContext();
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
      return analyzeCSD(req, res);
    }

    if (action === 'getWardStats') {
      return getWardStats(req, res);
    }

    const rawDataList = await getRawDataList();
    return res.status(200).json({ rawDataList });

  } catch (err) {
    return res.status(500).json({ error: true, message: err.message });
  }
};
