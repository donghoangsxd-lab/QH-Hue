const axios = require('axios');
const constants = require('../config/constants');

let cachedGeoJSON = null;
let lastETag = null; // Lưu mã phiên bản ETag từ GCS Bucket

async function getRawDataList() {
  try {
    // 1. Thực hiện request nhẹ (HEAD) tới GCS URL để kiểm tra ETag (thời điểm cập nhật file trên bucket)
    const headRes = await axios.head(constants.GCS_URL, { timeout: 5000 });
    const currentETag = headRes.headers['etag'] || headRes.headers['last-modified'];

    // 2. Nếu ETag trùng khớp với cache hiện tại và đã có dữ liệu -> Trả về cache ngay lập tức (Không tốn thời gian parse lại)
    if (cachedGeoJSON && currentETag && currentETag === lastETag) {
      return cachedGeoJSON;
    }

    // 3. Nếu ETag thay đổi (Bucket đã có file mới) hoặc lần đầu chạy -> Tải toàn bộ nội dung JSON mới
    const response = await axios.get(constants.GCS_URL, { timeout: 10000 });
    const geojson = response.data || {};
    const features = geojson.features || [];

    cachedGeoJSON = features.map(ft => {
      const props = ft.properties || {};
      const coords = (ft.geometry && Array.isArray(ft.geometry.coordinates)) 
        ? ft.geometry.coordinates 
        : [107.5905, 16.4637];

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

    // Cập nhật lại mã ETag mới nhất
    lastETag = currentETag;
    return cachedGeoJSON;
  } catch (e) {
    console.error("Lỗi nạp GCS Data:", e.message);
    // Fallback trả về cache cũ nếu có lỗi kết nối mạng đột xuất
    return cachedGeoJSON || [];
  }
}

function invalidateCache() {
  cachedGeoJSON = null;
  lastETag = null;
}

module.exports = { getRawDataList, invalidateCache };
