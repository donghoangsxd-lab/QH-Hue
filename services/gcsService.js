const axios = require('axios');
const constants = require('../config/constants');

let cachedGeoJSON = null;
let lastETag = null; // Lưu mã phiên bản ETag từ GCS Bucket

async function getRawDataList() {
  try {
    const headRes = await axios.head(constants.GCS_URL, { timeout: 5000 });
    const currentETag = headRes.headers['etag'] || headRes.headers['last-modified'];

    if (cachedGeoJSON && currentETag && currentETag === lastETag) {
      return cachedGeoJSON;
    }

    const response = await axios.get(constants.GCS_URL, { timeout: 10000 });
    const geojson = response.data || {};
    const features = geojson.features || [];

    cachedGeoJSON = features.map(ft => {
      const props = ft.properties || {};
      const coords = (ft.geometry && Array.isArray(ft.geometry.coordinates)) 
        ? ft.geometry.coordinates 
        : [107.5905, 16.4637];

      const parseCoord = (val, defaultVal) => {
        if (val === undefined || val === null) return defaultVal;
        const strVal = String(val).trim().replace(',', '.');
        const num = Number(strVal);
        return isNaN(num) ? defaultVal : num;
      };

      const rawId = String(props.ID_DoiTuong || '');
      const prefix = rawId.split('-')[0];

      const rawStatus = props.TrangThai;
      const isStatusTrue = (rawStatus === true || String(rawStatus).trim().toUpperCase() === 'TRUE');

      return {
        id: rawId,
        name: props.Ten_CongTrinh || 'Chưa đặt tên',
        ward: props.Ten_XaPhuong || 'Thuận Hóa',
        type: constants.codeMap[prefix] || "9-CSD",
        lat: parseCoord(coords[1], 16.4637),
        lng: parseCoord(coords[0], 107.5905),
        size: Number(String(props.QuyMo_S || 0).replace(',', '.')) || 0,
        radius: Number(String(props.BanKinh || 500).replace(',', '.')) || 500,
        status: isStatusTrue
      };
    });

    lastETag = currentETag;
    return cachedGeoJSON;
  } catch (e) {
    console.error("Lỗi nạp GCS Data:", e.message);
    return cachedGeoJSON || [];
  }
}

function invalidateCache() {
  cachedGeoJSON = null;
  lastETag = null;
}

module.exports = { getRawDataList, invalidateCache };
