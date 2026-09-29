const axios = require('axios');
const constants = require('../config/constants');

let cachedGeoJSON = null;
let lastETag = null; // Lưu mã phiên bản ETag từ GCS Bucket
// Tăng mỗi lần dữ liệu được tải lại, để các cache tính toán phía sau (thống kê phường, độ phủ) tự hết hạn theo
let dataVersion = 0;

// Ô trống / không có cột -> null (khác với số 0 nhập tường minh)
function parseArea(val) {
  if (val === undefined || val === null || String(val).trim() === '') return null;
  const num = Number(String(val).trim().replace(',', '.'));
  return isNaN(num) ? null : num;
}

// Ô trống = giai đoạn đó không có công trình; số 0 = có công trình nhưng chưa rõ diện tích (không so sánh được)
// HT trống + QH có = quy hoạch mới; HT có + QH trống = di dời; cả 2 trống = không thể hiện ở bản đồ nào
function classifyPlanChange(sizeHT, sizeQH) {
  if (sizeHT === null) return sizeQH === null ? 'none' : 'new';
  if (sizeQH === null) return 'relocate';
  if (sizeHT === 0 || sizeQH === 0) return 'keep';
  if (sizeQH > sizeHT) return 'expand';
  if (sizeQH < sizeHT) return 'shrink';
  return 'keep';
}

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

      const sizeHT = parseArea(props.QuyMo_HT !== undefined ? props.QuyMo_HT : props.QuyMo_S);
      const sizeQH = parseArea(props.QuyMo_QH);

      const item = {
        id: rawId,
        name: props.Ten_CongTrinh || 'Chưa đặt tên',
        ward: props.Ten_XaPhuong || '',
        note: String(props.GhiChu || ''),
        type: mappedType,
        nhomHaTang: assignedNhom, // Bổ sung nhận biết nhóm hạ tầng phục vụ quy chuẩn QCVN
        lat: parseCoord(coords[1]),
        lng: parseCoord(coords[0]),
        size: sizeHT || 0,
        sizeHT,
        sizeQH,
        planChange: classifyPlanChange(sizeHT, sizeQH),
        status: isStatusTrue
      };
      const banKinh = parseArea(props.BanKinh);
      item.radius = banKinh > 0 ? banKinh : constants.defaultRadius(item);
      item.radiusSet = banKinh > 0;
      return item;
    }).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng)
      && Math.abs(item.lat) <= 90 && Math.abs(item.lng) <= 180);

    lastETag = currentETag;
    dataVersion++;
    return cachedGeoJSON;
  } catch (e) {
    console.error("Lỗi nạp GCS Data:", e.message);
    return cachedGeoJSON || [];
  }
}

// ============================ RANH LÔ ĐẤT (cad_parcels.json) ============================

let cachedParcels = null;
let lastParcelETag = null;

/** [{ id, phase: 'HT'|'QH', layer, area, geometry }]; file chưa có (chưa nhập DXF lần nào) → [] */
async function getCadParcels() {
  try {
    let currentETag = null;
    try {
      const headRes = await axios.head(constants.CAD_GCS_URL, { timeout: 5000 });
      currentETag = headRes.headers['etag'] || headRes.headers['last-modified'];
    } catch (headErr) {
      if (headErr.response && headErr.response.status === 404) return [];
    }

    if (cachedParcels && currentETag && currentETag === lastParcelETag) {
      return cachedParcels;
    }

    const response = await axios.get(constants.CAD_GCS_URL, { timeout: 15000 });
    const features = (response.data && response.data.features) || [];
    cachedParcels = features
      .filter(ft => ft && ft.geometry && (ft.geometry.type === 'Polygon' || ft.geometry.type === 'MultiPolygon'))
      .map(ft => {
        const props = ft.properties || {};
        return {
          id: String(props.ID_DoiTuong || ''),
          phase: String(props.GiaiDoan || '').toUpperCase() === 'QH' ? 'QH' : 'HT',
          layer: String(props.Layer || ''),
          area: Number(props.DienTich) || null,
          geometry: ft.geometry
        };
      })
      .filter(p => p.id);
    lastParcelETag = currentETag;
    return cachedParcels;
  } catch (e) {
    if (e.response && e.response.status === 404) return [];
    console.error("Lỗi nạp ranh lô GCS:", e.message);
    return cachedParcels || [];
  }
}

function invalidateCache() {
  cachedGeoJSON = null;
  lastETag = null;
  cachedParcels = null;
  lastParcelETag = null;
}

function getDataVersion() {
  return dataVersion;
}

module.exports = { getRawDataList, getCadParcels, invalidateCache, getDataVersion };
