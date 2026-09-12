const { initGEE, getGeeContext } = require('./services/geeService');
const { getRawDataList, invalidateCache } = require('./services/gcsService');
const { getNetworkIsochrones } = require('./controllers/routeController');
const { analyzeCSD } = require('./controllers/csdController');
const { getWardStats } = require('./controllers/wardController');
const constants = require('./config/constants');

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

    // 1. Phân tuyến Isochrone Giao thông
    if (action === 'getIsochrone') {
      return await getNetworkIsochrones(req, res);
    }

    // 2. Phân tuyến xử lý đồng bộ Google Sheets
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
      const gasRes = await fetch(syncUrl);
      const result = await gasRes.json().catch(() => ({ success: true }));
      return res.status(200).json({ success: true, result });
    }

    if (action === 'approvePoint') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: true, message: "Thiếu ID công trình" });

      const syncUrl = `${constants.GAS_BASE_URL}?action=approvePoint&id=${encodeURIComponent(id)}`;
      invalidateCache();
      const gasRes = await fetch(syncUrl);
      const result = await gasRes.json().catch(() => ({ success: true }));
      return res.status(200).json({ success: true, result });
    }

    // Khởi tạo Earth Engine Context & Lấy dữ liệu
    await initGEE();
    const rawDataList = await getRawDataList();

    // 3. Phân tuyến Phân tích Quỹ đất CSD
    if (action === 'analyzeCSD') {
      return await analyzeCSD(req, res);
    }

    // 4. Phân tuyến Báo cáo Bảng 40 Phường Xã
    if (action === 'getWardStats') {
      return await getWardStats(req, res);
    }

    // 5. Xử lý các tác vụ Tile Raster / GIS căn bản
    const { ee, wardVectorParsed, popRasterNormalized } = getGeeContext();

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

    return res.status(200).json({ rawDataList });

  } catch (err) {
    return res.status(500).json({ error: true, message: err.message });
  }
};
