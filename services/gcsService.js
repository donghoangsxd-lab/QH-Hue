const axios = require('axios');
const constants = require('../config/constants');

let cachedGeoJSON = null;
let lastETag = null; // Lưu mã phiên bản ETag từ GCS Bucket

async function getRawDataList() {
  try {
    let currentETag = null;
    try {
      const headRes = await axios.head(constants.GCS_URL, { timeout: 5000 });
      currentETag = headRes.headers['etag'] || headRes.headers['last-modified'];
    } catch (headErr) {
      // Bẫy lỗi an toàn cho HEAD request
    }

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
        : [null, null];

      const parseCoord = (val) => {
        if (val === undefined || val === null) return null;
        const strVal = String(val).trim().replace(',', '.');
        const num = Number(strVal);
        return isNaN(num) ? null : num;
      };

      const rawId = String(props.ID_DoiTuong || '');
      const prefix = String(rawId || '').split('-')[0];

      const rawStatus = props.TrangThai;
      const isStatusTrue = (rawStatus === true || String(rawStatus).trim().toUpperCase() === 'TRUE' || String(rawStatus).trim() === '1');

      const mappedType = constants.codeMap[prefix]
        || constants.codeMap[prefix.replace(/_DT$/i, '').replace(/_DV$/i, '')]
        || "9-CSD";

      // Chuẩn hóa Nhóm hạ tầng thông qua hằng số constants
      const rawNhom = props.Nhom_HaTang || props.nhomHaTang;
      let assignedNhom = constants.cleanNhomStr(rawNhom);
      if (!rawNhom && (prefix === 'THPT' || /_DT$/i.test(prefix))) {
        assignedNhom = "Cap Do Thi";
      }

      return {
        id: rawId,
        name: props.Ten_CongTrinh || 'Chưa đặt tên',
        ward: props.Ten_XaPhuong || 'Thuận Hóa',
        type: mappedType,
        nhomHaTang: assignedNhom, // Bổ sung nhận biết nhóm hạ tầng phục vụ quy chuẩn QCVN
        lat: parseCoord(coords[1]),
        lng: parseCoord(coords[0]),
        size: Number(String(props.QuyMo_S || 0).replace(',', '.')) || 0,
        radius: Number(String(props.BanKinh || 500).replace(',', '.')) || 500,
        status: isStatusTrue
      };
    }).filter(item => item.lat !== null && item.lng !== null);

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
