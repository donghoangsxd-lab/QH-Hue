const constants = require('../config/constants');

let cachedGeoJSON = null;
let lastGeoJSONFetch = 0;

async function getRawDataList() {
  const now = Date.now();
  if (cachedGeoJSON && (now - lastGeoJSONFetch < constants.GEOJSON_CACHE_TTL)) {
    return cachedGeoJSON;
  }

  try {
    const gcsResponse = await fetch(constants.GCS_URL);
    const geojson = await gcsResponse.json();
    const features = geojson.features || [];

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
        type: constants.codeMap[prefix] || "9-CSD",
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
  lastGeoJSONFetch = 0;
}

module.exports = { getRawDataList, invalidateCache };
