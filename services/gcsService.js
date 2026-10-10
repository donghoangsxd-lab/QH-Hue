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
// Biến động diện tích QH so với HT không quá PLAN_CHANGE_MIN_RATIO coi như giữ nguyên (không đánh dấu tăng / giảm)
const PLAN_CHANGE_MIN_RATIO = 0.05;
function classifyPlanChange(sizeHT, sizeQH) {
  if (sizeHT === null) return sizeQH === null ? 'none' : 'new';
  if (sizeQH === null) return 'relocate';
  if (sizeHT === 0 || sizeQH === 0) return 'keep';
  if (Math.abs(sizeQH - sizeHT) <= sizeHT * PLAN_CHANGE_MIN_RATIO) return 'keep';
  if (sizeQH > sizeHT) return 'expand';
  if (sizeQH < sizeHT) return 'shrink';
  return 'keep';
}

// Cột TangCao / MatDoXD / HeSoSDD (Sheet) → { floors, coverage, far }; không có chỉ tiêu nào → null
function planOf(props) {
  const pick = (v) => (v === undefined || v === null ? '' : String(v).trim());
  const plan = { floors: pick(props.TangCao), coverage: pick(props.MatDoXD), far: pick(props.HeSoSDD) };
  return plan.floors || plan.coverage || plan.far ? plan : null;
}

const SPLIT_ID_RE = /^(.+)\.(\d+)$/;

// Dòng mảnh phường <ID>.2 (lô vắt ranh, Apps Script writeWardSplits) không phải công trình riêng:
// gắn vào công trình chính thành wardParts [{ id, ward, lat, lng, sizeHT, sizeQH }] để thống kê diện tích theo phường
function attachWardParts(items) {
  const byId = new Map(items.map(it => [it.id, it]));
  const out = [];
  items.forEach(it => {
    const m = it.id.match(SPLIT_ID_RE);
    const parent = m && Number(m[2]) >= 2 ? byId.get(m[1]) : null;
    if (!parent) { out.push(it); return; }
    (parent.wardParts = parent.wardParts || []).push({
      id: it.id, ward: it.ward, lat: it.lat, lng: it.lng, sizeHT: it.sizeHT, sizeQH: it.sizeQH
    });
  });
  return out;
}

// Object công khai không đặt Cache-Control bị cache biên của Google giữ tới 1 giờ: thêm ?v= để HEAD/GET luôn tới bản gốc
const bypassEdge = (url) => `${url}?v=${Date.now()}`;

// Sheet locale vi-VN đọc dấu chấm thập phân thành dấu phân cách nghìn (16.452800 → 16452800): chia 10 tới khi vào miền hợp lệ
function rescaleCoord(num, limit) {
  if (!Number.isFinite(num) || num === 0) return num;
  let k = 0;
  while (Math.abs(num) / Math.pow(10, k) > limit && k < 12) k++;
  return k ? Number((num / Math.pow(10, k)).toFixed(7)) : num;
}
const tagOf = (res) => (res && (res.headers['etag'] || res.headers['last-modified'])) || null;

async function getRawDataList() {
  try {
    let currentETag = null;
    try {
      currentETag = tagOf(await axios.head(bypassEdge(constants.GCS_URL), { timeout: 5000 }));
    } catch (headErr) {
      // Bẫy lỗi an toàn cho HEAD request
    }

    if (cachedGeoJSON && currentETag && currentETag === lastETag) {
      return cachedGeoJSON;
    }

    const response = await axios.get(bypassEdge(constants.GCS_URL), { timeout: 10000 });
    // ETag theo đúng bản vừa tải (file có thể đổi giữa HEAD và GET)
    const loadedETag = tagOf(response) || currentETag;
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
        || constants.codeMap[String(props.Tab || '').split('-')[0]]
        || "12-CSD";

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
        lat: rescaleCoord(parseCoord(coords[1]), 90),
        lng: rescaleCoord(parseCoord(coords[0]), 180),
        size: sizeHT || 0,
        sizeHT,
        sizeQH,
        planChange: classifyPlanChange(sizeHT, sizeQH),
        status: isStatusTrue
      };
      if (mappedType === '11-NT') item.ntKind = constants.ntKind(item);
      item.tenQH = String(props.Ten_QH || '');
      const plan = planOf(props);
      if (plan) item.plan = plan;
      item.radius = constants.defaultRadius(item);
      return item;
    }).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng)
      && Math.abs(item.lat) <= 90 && Math.abs(item.lng) <= 180);
    cachedGeoJSON = attachWardParts(cachedGeoJSON);

    // Chỉ tăng phiên bản khi dữ liệu thật sự đổi (HEAD lỗi thì vẫn tải lại nhưng không làm mất các cache tính toán phía sau)
    if (!loadedETag || loadedETag !== lastETag) dataVersion++;
    lastETag = loadedETag;
    return cachedGeoJSON;
  } catch (e) {
    console.error("Lỗi nạp GCS Data:", e.message);
    return cachedGeoJSON || [];
  }
}

// ============================ RANH LÔ ĐẤT (cad_parcels.json) ============================

let cachedParcels = null;
let lastParcelETag = null;

/**
 * [{ id, kind, phase: 'HT'|'QH', layer, area, geometry }]; kind INFRA = ranh lô công trình, DXF = lô đất khác,
 * PROJECT = ranh tổng đồ án (id = Ten_QH, kèm infraCount / landCount / time). File chưa có → []
 */
async function getCadParcels() {
  try {
    let currentETag = null;
    try {
      currentETag = tagOf(await axios.head(bypassEdge(constants.CAD_GCS_URL), { timeout: 5000 }));
    } catch (headErr) {
      if (headErr.response && headErr.response.status === 404) return [];
    }

    if (cachedParcels && currentETag && currentETag === lastParcelETag) {
      return cachedParcels;
    }

    const response = await axios.get(bypassEdge(constants.CAD_GCS_URL), { timeout: 15000 });
    const features = (response.data && response.data.features) || [];
    cachedParcels = features
      .filter(ft => ft && ft.geometry && (ft.geometry.type === 'Polygon' || ft.geometry.type === 'MultiPolygon'))
      .map(ft => {
        const props = ft.properties || {};
        const kind = String(props.Kind || '').toUpperCase();
        if (kind === 'PROJECT') {
          return {
            id: String(props.ID_DoiTuong || ''),
            kind,
            ward: String(props.XaPhuong || ''),
            infraCount: Number(props.SoCongTrinh) || 0,
            landCount: Number(props.SoLoDat) || 0,
            time: String(props.ThoiGianNhap || ''),
            geometry: ft.geometry
          };
        }
        return {
          id: String(props.ID_DoiTuong || ''),
          phase: String(props.GiaiDoan || '').toUpperCase() === 'QH' ? 'QH' : 'HT',
          layer: String(props.Layer || ''),
          area: Number(props.DienTich) || null,
          file: String(props.File || ''),
          kind: kind === 'DXF' ? 'DXF' : 'INFRA',
          name: String(props.Ten || ''),
          nhom: String(props.Nhom || ''),
          ward: String(props.XaPhuong || ''),
          plan: planOf(props),
          geometry: ft.geometry
        };
      })
      .filter(p => p.id);
    lastParcelETag = tagOf(response) || currentETag;
    return cachedParcels;
  } catch (e) {
    if (e.response && e.response.status === 404) return [];
    console.error("Lỗi nạp ranh lô GCS:", e.message);
    return cachedParcels || [];
  }
}

// ================= LỚP TĨNH (drainage/thoatnuoc.topojson, drainage/luuvuc.topojson, drainage/huongthoat/, terrain/hillshade/) =================

const cachedText = {};   // url → { text, etag }

/** Văn bản file trên bucket (giữ nguyên, không parse) + ETag; chưa đẩy file lên bucket → null */
async function getTextFile(url, label) {
  try {
    let currentETag = null;
    try {
      currentETag = tagOf(await axios.head(bypassEdge(url), { timeout: 5000 }));
    } catch (headErr) {
      if (headErr.response && headErr.response.status === 404) return null;
    }
    const cached = cachedText[url];
    if (cached && currentETag && currentETag === cached.etag) return cached;

    const response = await axios.get(bypassEdge(url), {
      timeout: 20000, responseType: 'text', transformResponse: x => x
    });
    cachedText[url] = { text: String(response.data || ''), etag: tagOf(response) || currentETag };
    return cachedText[url];
  } catch (e) {
    if (e.response && e.response.status === 404) return null;
    console.error(`Lỗi nạp ${label} GCS:`, e.message);
    return cachedText[url] || null;
  }
}

const getDrainage = () => getTextFile(constants.DRAINAGE_GCS_URL, 'lớp thoát nước');
const getBasins = () => getTextFile(constants.BASINS_GCS_URL, 'ranh lưu vực');
/** key: "index" | "12_x_y" (đã kiểm tra ở api/gee.js) */
const getDrainArrows = (key) => getTextFile(`${constants.DRAIN_ARROWS_GCS_BASE}${key}.json`, 'mũi tên thoát nước');

const cachedBinary = new Map();   // url → { buf, etag }, bỏ mục cũ nhất khi quá BINARY_CACHE_MAX
const BINARY_CACHE_MAX = 300;

/** File nhị phân trên bucket + ETag (cùng cơ chế HEAD kiểm tra phiên bản như getTextFile); không có → null */
async function getBinaryFile(url, label) {
  try {
    let currentETag = null;
    try {
      currentETag = tagOf(await axios.head(bypassEdge(url), { timeout: 5000 }));
    } catch (headErr) {
      if (headErr.response && headErr.response.status === 404) return null;
    }
    const cached = cachedBinary.get(url);
    if (cached && currentETag && currentETag === cached.etag) return cached;

    const response = await axios.get(bypassEdge(url), { timeout: 20000, responseType: 'arraybuffer' });
    const entry = { buf: Buffer.from(response.data), etag: tagOf(response) || currentETag };
    cachedBinary.delete(url);
    cachedBinary.set(url, entry);
    if (cachedBinary.size > BINARY_CACHE_MAX) cachedBinary.delete(cachedBinary.keys().next().value);
    return entry;
  } catch (e) {
    if (e.response && e.response.status === 404) return null;
    console.error(`Lỗi nạp ${label} GCS:`, e.message);
    return cachedBinary.get(url) || null;
  }
}

/** key: "index" (JSON) | "z_x_y" (PNG, đã kiểm tra ở api/gee.js) */
const getHillshade = (key) => (key === 'index'
  ? getTextFile(`${constants.HILLSHADE_GCS_BASE}index.json`, 'chỉ mục đổ bóng địa hình')
  : getBinaryFile(`${constants.HILLSHADE_GCS_BASE}${key}.png`, 'ô đổ bóng địa hình'));

function invalidateCache() {
  cachedGeoJSON = null;
  lastETag = null;
  cachedParcels = null;
  lastParcelETag = null;
}

function getDataVersion() {
  return dataVersion;
}

module.exports = { getRawDataList, getCadParcels, getDrainage, getBasins, getDrainArrows, getHillshade, invalidateCache, getDataVersion };
