// =========================================================================
// GOOGLE APPS SCRIPT: HTXH-HUE (TỐI ƯU BATCH IN-MEMORY & LOCKSERVICE)
// Quy mô tách 2 cột: QuyMo_HT (hiện trạng) & QuyMo_QH (quy hoạch)
// Nhập hàng loạt từ DXF: doPost action=importCadBatch; công trình hạ tầng ghi vào các tab loại (cột Geojson, Ten_QH).
// Lô đất ngoài nhóm hạ tầng không ghi tab DXF-NN — webapp ghi thư mục projects/<slug>/ trên bucket
// (hien-trang, su-dung-dat, diem-chuc-nang, ranh-gioi, quyet-dinh.pdf). File gộp projects/<slug>.json là bản cũ.
// Quyết định phê duyệt: projects/decisions.json + projects/<slug>/quyet-dinh.pdf (≤ 1 MB). putBucketPdf khi Vercel chưa ghi được PDF.
// Tab DXF-NN cũ vẫn xóa cùng đồ án. Ranh tổng đồ án vẫn ở tab DS_DoAn.
// syncCad = false: chỉ dựng lại infrastructure_hue.json, không dựng lại cad_parcels.json.
// Xóa đồ án: doPost action=deleteProject. putBucketObject / deleteBucketObject: ghi file bucket khi Vercel chưa có quyền.
// Admin sửa / xóa 1 công trình từ bảng thông tin lô: doPost action=editInfraRow / deleteInfraRow.
// Sau mỗi lần đồng bộ hẹn warmWebappCache (Script Property WEBAPP_URL) để webapp tính sẵn thống kê phường.
// =========================================================================

const BUCKET_NAME = "hue-infra-data-us";
const GEOJSON_FILE_NAME = "infrastructure_hue.json";
const CAD_FILE_NAME = "cad_parcels.json";
const CAD_SHEET_NAME = "CAD_Polygon";
const CAD_HEADERS = ["ID_DoiTuong", "Layer", "DienTich", "File", "ThoiGianNhap", "GeoJSON", "GiaiDoan"];
// Danh mục đồ án: 1 dòng / đồ án (Ten_QH). LinkQD ngay sau tên đồ án là link mở quyết định (PDF trên bucket hoặc link ngoài).
const PROJECT_SHEET_NAME = "DS_DoAn";
const PROJECT_LINK_HEADER = "LinkQD";
const PROJECT_HEADERS = ["Ten_QH", "LinkQD", "File", "Phuong", "SoCongTrinh", "SoLoDat", "ThoiGianNhap", "Geojson", "DanSoHT", "DanSoQH"];
const PROJECT_POP_HEADERS = ["DanSoHT", "DanSoQH"];
// Sao lưu dòng hạ tầng có sẵn trước khi đồ án ghi đè (lần đầu đồ án chạm vào dòng). Xóa đồ án: dòng có sao lưu được
// ghi trả giá trị cũ thay vì xóa. Tab ẩn; GiaTriCu = JSON { tên cột: { v | f (công thức) | d (ngày ISO) } }
const BACKUP_SHEET_NAME = "DoAn_SaoLuu";
const BACKUP_HEADERS = ["Ten_QH", "Tab", "ID_DoiTuong", "ThoiGian", "GiaTriCu", "GeojsonCu"];
// Các cột importCadBatch có thể ghi đè trên dòng có sẵn (Geojson lưu riêng cột GeojsonCu)
const BACKUP_COL_KEYS = ["lat", "lng", "ward", "nhom", "quyMoHT", "quyMoQH", "tenQH", "trangThai", "thoiGian", "ghiChu",
  "tangCao", "matDoXD", "heSoSDD"];
const VALID_PREFIXES = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-THPT", "7-YT", "8-VH", "9-TM", "10-PCCC", "11-NT", "12-CSD", "13-BUS", "14-NOXH"];

// Mạng lưới hạ tầng khác (QCVN 01:2026 Mục 2.8.3.3, 2.5.13.1, 2.12): tab tự tạo khi ghi điểm đầu tiên
const NETWORK_TABS = { "13-BUS": "Trạm dừng xe buýt", "10-PCCC": "Trụ sở PCCC", "11-NT": "Nhà tang lễ, nghĩa trang", "14-NOXH": "Nhà ở xã hội" };
// Loại không cần diện tích: điểm quy hoạch mới được ghi QuyMo_QH = 0
const NO_AREA_TYPES = ["13-BUS", "10-PCCC"];
// Chỉ tiêu quy hoạch lô (tầng cao, mật độ xây dựng %, hệ số sử dụng đất) — tab cũ chưa có thì tự thêm cuối dòng tiêu đề khi nhập đồ án
const PLAN_HEADERS = ["TangCao", "MatDoXD", "HeSoSDD"];
const STANDARD_HEADERS = ["ID_DoiTuong", "Ten_CongTrinh", "Ten_XaPhuong", "Nhom_HaTang", "Latitude", "Longitude",
  "QuyMo_HT", "QuyMo_QH", "Ten_QH", "TrangThai", "ThoiGianCapNhat", "Note", "Geojson"].concat(PLAN_HEADERS);
const GEOJSON_MAX_CHARS = 45000;

// Cột được xác định theo tên tiêu đề dòng 1 (không phân biệt hoa thường, bỏ khoảng trắng)
const COLUMN_ALIASES = {
  id: ['id_doituong'],
  name: ['ten_congtrinh'],
  ward: ['ten_xaphuong'],
  nhom: ['nhom_hatang'],
  lat: ['latitude'],
  lng: ['longitude'],
  quyMoHT: ['quymo_ht', 'quymo_s'],
  quyMoQH: ['quymo_qh'],
  tenQH: ['ten_qh'],
  trangThai: ['trangthai'],
  geojson: ['geojson'],
  thoiGian: ['thoigiancapnhat'],
  ghiChu: ['note', 'ghichu'],
  tangCao: ['tangcao'],
  matDoXD: ['matdoxd', 'matdoxaydung'],
  heSoSDD: ['hesosdd', 'hesosudungdat']
};
const PLAN_KEYS = { floors: 'tangCao', coverage: 'matDoXD', far: 'heSoSDD' };

function getAccessTokenDirect() {
  return ScriptApp.getOAuthToken();
}

function parseCleanNumber(val) {
  if (val === null || val === undefined || val === '') return 0;
  var str = String(val).trim();
  if (str.indexOf('.') !== -1 && str.indexOf(',') !== -1) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else {
    str = str.replace(',', '.');
  }
  var num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

// Ô trống = null (giai đoạn đó không có công trình), số 0 nhập tường minh = có công trình nhưng chưa rõ diện tích
function parseOptionalNumber(val) {
  if (val === null || val === undefined || String(val).trim() === '') return null;
  return parseCleanNumber(val);
}

// Locale vi-VN đọc dấu chấm thập phân thành dấu phân cách nghìn (16.452800 → 16452800): chia 10 tới khi vào miền hợp lệ
function rescaleCoord(num, limit) {
  if (!isFinite(num) || num === 0) return num;
  var k = 0;
  while (Math.abs(num) / Math.pow(10, k) > limit && k < 12) k++;
  return k ? Number((num / Math.pow(10, k)).toFixed(7)) : num;
}

function parseCoordinate(val, limit) {
  return rescaleCoord(parseCleanNumber(val), limit);
}

function isValidInfraSheet(sheetName) {
  var cleanName = sheetName.replace(/\s+/g, ' ').trim();
  return VALID_PREFIXES.some(function(prefix) {
    return cleanName.indexOf(prefix) === 0 || cleanName.startsWith(prefix);
  });
}

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, '');
}

// Trả về chỉ số cột (0-based) theo tiêu đề, -1 nếu tab không có cột đó
function getColumnMap(headerRow) {
  var normalized = headerRow.map(normalizeHeader);
  var map = {};
  Object.keys(COLUMN_ALIASES).forEach(function(key) {
    var idx = -1;
    COLUMN_ALIASES[key].some(function(alias) {
      idx = normalized.indexOf(alias);
      return idx !== -1;
    });
    map[key] = idx;
  });
  return map;
}

function cellAt(row, idx) {
  return idx >= 0 ? row[idx] : undefined;
}

function getSheetHeaders(sheet) {
  var lastCol = sheet.getLastColumn();
  return lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
}

// Dải ô vượt số dòng/cột của tab báo "Tọa độ của dải ô đích nằm ngoài kích thước của trang tính": chèn thêm trước khi ghi
function ensureSheetSize(sheet, lastRow, lastCol) {
  var addRows = lastRow - sheet.getMaxRows();
  if (addRows > 0) sheet.insertRowsAfter(sheet.getMaxRows(), addRows);
  var addCols = lastCol - sheet.getMaxColumns();
  if (addCols > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), addCols);
}

// Thêm cột chỉ tiêu quy hoạch còn thiếu vào cuối dòng tiêu đề (không đụng cột sẵn có)
function ensurePlanColumns(sheet) {
  var headers = getSheetHeaders(sheet);
  var col = getColumnMap(headers);
  // Khóa COLUMN_ALIASES = tên cột viết thường chữ đầu (TangCao → tangCao)
  var missing = PLAN_HEADERS.filter(function(h) { return col[h.charAt(0).toLowerCase() + h.slice(1)] < 0; });
  if (!missing.length) return;
  ensureSheetSize(sheet, 1, headers.length + missing.length);
  sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
}

// "1,2" / "40" / "3-5" → số nếu được, không thì chuỗi ngắn; trống → ''
function planValue(v) {
  var s = String(v === null || v === undefined ? '' : v).trim().replace(',', '.');
  if (!s) return '';
  var n = Number(s);
  return isFinite(n) ? n : s.slice(0, 20);
}

// plan = { floors, coverage, far } từ webapp → fn(chỉ số cột, giá trị) cho từng chỉ tiêu có giá trị và tab có cột
function eachPlanValue(plan, col, fn) {
  if (!plan) return;
  Object.keys(PLAN_KEYS).forEach(function(k) {
    var v = planValue(plan[k]);
    var idx = col[PLAN_KEYS[k]];
    if (v !== '' && idx >= 0) fn(idx, v);
  });
}

// Chỉ tiêu quy hoạch của dòng → thuộc tính GeoJSON (chỉ ô có giá trị, giữ file bucket gọn)
function planProps(row, col, props) {
  PLAN_HEADERS.forEach(function(h) {
    var v = cellAt(row, col[h.charAt(0).toLowerCase() + h.slice(1)]);
    if (v !== undefined && v !== null && String(v).trim() !== '') props[h] = String(v).trim();
  });
  return props;
}

// Từ 1000 trở đi giữ đủ chữ số (tránh "CV-1000" bị cắt thành "CV-000")
function formatId(prefix, num) {
  return prefix + "-" + (num < 1000 ? ("00" + num).slice(-3) : String(num));
}

function maxIdNumber(data, idCol, prefix) {
  var maxNum = 0;
  for (var i = 1; i < data.length; i++) {
    var currentId = String(cellAt(data[i], idCol) || '').trim();
    if (currentId.indexOf(prefix + "-") === 0) {
      var numPart = parseInt(currentId.split('-')[1], 10);
      if (!isNaN(numPart) && numPart > maxNum) maxNum = numPart;
    }
  }
  return maxNum;
}

function nextIdForSheet(data, idCol, prefix) {
  return formatId(prefix, maxIdNumber(data, idCol, prefix) + 1);
}

function findInfraSheet(ss, typeCode) {
  var sheets = ss.getSheets();
  for (var s = 0; s < sheets.length; s++) {
    if (sheets[s].getName().trim().indexOf(typeCode) === 0) return sheets[s];
  }
  return null;
}

// Tab hạ tầng theo mã. Loại mạng lưới chưa có tab thì tạo tab đúng tên mã (13-BUS, 10-PCCC, 11-NT), đặt ngay sau 12-CSD.
// Loại khác chưa có tab → null (không tự tạo, tránh ghi nhầm sang tab đầu tiên).
function ensureInfraSheet(ss, typeCode) {
  var sheet = findInfraSheet(ss, typeCode);
  if (sheet || !NETWORK_TABS.hasOwnProperty(typeCode)) return sheet;
  var after = findInfraSheet(ss, "12-CSD");
  var index = after ? after.getIndex() : ss.getNumSheets();
  sheet = ss.insertSheet(typeCode, index);
  sheet.getRange(1, 1, 1, STANDARD_HEADERS.length).setValues([STANDARD_HEADERS]).setFontWeight("bold");
  sheet.setFrozenRows(1);
  sheet.getRange(2, 5, 2, 2).setNumberFormat("@");
  return sheet;
}

// Giá trị cột Nhom_HaTang theo danh sách chọn của Sheet
function sheetNhom(nhom) {
  return nhom === 'Cấp đô thị' ? 'Cấp đô thị' : 'Cấp DVO';
}

// Tên phường/xã ghi Sheet dạng ngắn như dữ liệu sẵn có: "Phường Thuận Hóa" → "Thuận Hóa"
function sheetWard(ward) {
  return String(ward || '').replace(/^\s*(Phường|Xã|Thị trấn)\s+/i, '').trim();
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ĐÓNG GÓI GEOJSON TỪ TOÀN BỘ CÁC TAB HẠ TẦNG (DÙNG CHUNG CHO SYNC GCS VÀ getJson)
function collectFeatures(ss) {
  var features = [];

  ss.getSheets().forEach(function(sheet) {
    var sheetName = sheet.getName();
    if (!isValidInfraSheet(sheetName)) return;

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return;

    var col = getColumnMap(data[0]);
    if (col.id < 0 || col.lat < 0 || col.lng < 0) {
      Logger.log("⚠ Tab '" + sheetName + "': thiếu cột ID_DoiTuong/Latitude/Longitude, bỏ qua!");
      return;
    }

    var count = 0;
    // Mã tab (vd. "14-NOXH"): webapp dùng khi tiền tố ID không nhận ra loại
    var tabCode = sheetName.replace(/\s+/g, ' ').trim().split(' ')[0];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var id = String(row[col.id] || '').trim();
      var name = String(cellAt(row, col.name) || '').trim();
      if (id === '' && name === '') continue;

      var lat = parseCoordinate(row[col.lat], 90);
      var lng = parseCoordinate(row[col.lng], 180);
      if (lat === 0 || lng === 0) continue;

      var quyMoHT = parseOptionalNumber(cellAt(row, col.quyMoHT));
      var rawStatus = cellAt(row, col.trangThai);
      count++;
      features.push({
        "type": "Feature",
        "geometry": { "type": "Point", "coordinates": [lng, lat] },
        "properties": planProps(row, col, {
          "ID_DoiTuong": id,
          "Ten_CongTrinh": name,
          "Ten_XaPhuong": String(cellAt(row, col.ward) || ''),
          "Nhom_HaTang": String(cellAt(row, col.nhom) || ''),
          "QuyMo_HT": quyMoHT,
          "QuyMo_QH": parseOptionalNumber(cellAt(row, col.quyMoQH)),
          "QuyMo_S": quyMoHT || 0, // giữ cho webapp bản cũ, bằng quy mô hiện trạng
          "Ten_QH": String(cellAt(row, col.tenQH) || ''),
          "TrangThai": String(rawStatus === undefined || rawStatus === null ? 'TRUE' : rawStatus).toUpperCase(),
          "ThoiGianCapNhat": String(cellAt(row, col.thoiGian) || ''),
          "GhiChu": String(cellAt(row, col.ghiChu) || ''),
          "Tab": tabCode
        })
      });
    }
    Logger.log("✓ Tab '" + sheetName + "': Đóng gói " + count + " điểm!");
  });

  return features;
}

function parseGeomCell(text) {
  try {
    var geom = JSON.parse(String(text || ''));
    if (geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) return geom;
  } catch (e) {}
  return null;
}

function pushParcel(out, seen, props, geometry) {
  var kind = props.Kind === 'DXF' ? 'DXF' : 'INFRA';
  var phase = props.GiaiDoan === 'QH' ? 'QH' : 'HT';
  var id = String(props.ID_DoiTuong || '').trim();
  if (!id || !geometry) return;
  var key = kind + '|' + phase + '|' + id;
  if (seen[key]) return;
  seen[key] = true;
  props.Kind = kind;
  props.GiaiDoan = phase;
  out.push({ "type": "Feature", "geometry": geometry, "properties": props });
}

// Ranh hạ tầng: cột Geojson trên tab hạ tầng, rồi tab CAD_Polygon cho dòng chưa có cột M.
// Ranh đất ngoài 13 nhóm: tab DXF-* (không đưa vào infrastructure_hue.json).
function collectCadFeatures(ss, pointFeatures) {
  var out = [];
  var seen = {};
  var live = {};
  pointFeatures.forEach(function(f) { live[f.properties.ID_DoiTuong] = true; });

  ss.getSheets().forEach(function(sheet) {
    var sheetName = sheet.getName();
    var dxf = /^DXF-\d+$/i.test(String(sheetName).trim());
    if (!dxf && !isValidInfraSheet(sheetName)) return;
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return;
    var col = getColumnMap(data[0]);
    if (col.id < 0 || col.geojson < 0) return;
    for (var i = 1; i < data.length; i++) {
      var id = String(data[i][col.id] || '').trim();
      var geom = parseGeomCell(cellAt(data[i], col.geojson));
      if (!id || !geom) continue;
      // Dòng mảnh phường (<ID>.2) của lô vắt ranh: ranh lô vẽ theo dòng chính
      if (!dxf && (!live[id] || /\.\d+$/.test(id))) continue;
      var note = String(cellAt(data[i], col.ghiChu) || '');
      var layerMatch = note.match(/Layer\s+([^\s;|]+)/i);
      var ht = parseOptionalNumber(cellAt(data[i], col.quyMoHT));
      var qh = parseOptionalNumber(cellAt(data[i], col.quyMoQH));
      var phases = [];
      if (dxf) phases.push(qh !== null ? 'QH' : 'HT');
      else {
        if (ht !== null) phases.push('HT');
        if (qh !== null) phases.push('QH');
        if (!phases.length) phases.push('HT');
      }
      phases.forEach(function(ph) {
        var props = {
          // ID lô đất đánh lại từ DXF-001 ở mỗi tab đồ án → kèm tên tab cho duy nhất
          "ID_DoiTuong": dxf ? sheetName + '/' + id : id,
          "Layer": layerMatch ? layerMatch[1] : '',
          "DienTich": ph === 'QH' ? (qh || 0) : (ht || 0),
          "File": String(cellAt(data[i], col.tenQH) || ''),
          "ThoiGianNhap": String(cellAt(data[i], col.thoiGian) || ''),
          "GiaiDoan": ph,
          "Kind": dxf ? 'DXF' : 'INFRA'
        };
        if (dxf) {
          props.Ten = String(cellAt(data[i], col.name) || '');
          props.Nhom = String(cellAt(data[i], col.nhom) || '');
          props.XaPhuong = String(cellAt(data[i], col.ward) || '');
          planProps(data[i], col, props);
        }
        pushParcel(out, seen, props, geom);
      });
    }
  });

  var sheet = ss.getSheetByName(CAD_SHEET_NAME);
  if (sheet && sheet.getLastRow() > 1) {
    var data = sheet.getDataRange().getValues();
    var col = {};
    data[0].map(normalizeHeader).forEach(function(h, i) { col[h] = i; });
    if (col.id_doituong !== undefined && col.geojson !== undefined) {
      for (var r = 1; r < data.length; r++) {
        var id = String(data[r][col.id_doituong] || '').trim();
        if (!id || !live[id]) continue;
        var geom = parseGeomCell(data[r][col.geojson]);
        var ph = String(cellAt(data[r], col.giaidoan === undefined ? -1 : col.giaidoan) || '').trim().toUpperCase() === 'QH' ? 'QH' : 'HT';
        pushParcel(out, seen, {
          "ID_DoiTuong": id,
          "Layer": String(cellAt(data[r], col.layer === undefined ? -1 : col.layer) || ''),
          "DienTich": parseCleanNumber(cellAt(data[r], col.dientich === undefined ? -1 : col.dientich)),
          "File": String(cellAt(data[r], col.file === undefined ? -1 : col.file) || ''),
          "ThoiGianNhap": String(cellAt(data[r], col.thoigiannhap === undefined ? -1 : col.thoigiannhap) || ''),
          "GiaiDoan": ph,
          "Kind": "INFRA"
        }, geom);
      }
    }
  }
  collectProjectFeatures(ss, out);
  Logger.log("✓ Ranh lô: " + out.length);
  // Ghi cả khi rỗng: xóa đồ án cuối cùng phải xóa luôn ranh trên bucket
  return out;
}

// Ranh tổng đồ án (tab DS_DoAn) → Kind PROJECT trong cad_parcels.json: webapp vẽ ranh đồ án khi thu nhỏ, liệt kê ở panel Lớp dữ liệu
function collectProjectFeatures(ss, out) {
  var sheet = ss.getSheetByName(PROJECT_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return;
  var data = sheet.getDataRange().getValues();
  var col = {};
  data[0].map(normalizeHeader).forEach(function(h, i) { col[h] = i; });
  for (var r = 1; r < data.length; r++) {
    var name = String(cellAt(data[r], col.ten_qh === undefined ? -1 : col.ten_qh) || '').trim();
    var geom = parseGeomCell(cellAt(data[r], col.geojson === undefined ? -1 : col.geojson));
    if (!name || !geom) continue;
    var time = cellAt(data[r], col.thoigiannhap === undefined ? -1 : col.thoigiannhap);
    if (time instanceof Date) time = Utilities.formatDate(time, "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm");
    out.push({ "type": "Feature", "geometry": geom, "properties": {
      "ID_DoiTuong": name,
      "Kind": "PROJECT",
      "File": name,
      "XaPhuong": String(cellAt(data[r], col.phuong === undefined ? -1 : col.phuong) || ''),
      "SoCongTrinh": parseCleanNumber(cellAt(data[r], col.socongtrinh === undefined ? -1 : col.socongtrinh)),
      "SoLoDat": parseCleanNumber(cellAt(data[r], col.solodat === undefined ? -1 : col.solodat)),
      "ThoiGianNhap": String(time || '')
    } });
  }
}

// HÀM ĐẨY DỮ LIỆU ĐÈ LÊN GCS BUCKET (VỚI CƠ CHẾ KHÓA LOCKSERVICE)
function uploadToGCS(content, fileName) {
  var objectName = fileName || GEOJSON_FILE_NAME;
  try {
    var token = ScriptApp.getOAuthToken();
    var url = "https://storage.googleapis.com/upload/storage/v1/b/" + BUCKET_NAME + "/o?uploadType=media&name=" + encodeURIComponent(objectName);

    var response = UrlFetchApp.fetch(url, {
      "method": "post",
      "contentType": "application/json",
      "headers": {
        "Authorization": "Bearer " + token
      },
      "payload": content,
      "muteHttpExceptions": true
    });

    var responseCode = response.getResponseCode();
    var responseBody = response.getContentText();

    Logger.log("🚀 KẾT QUẢ UPLOAD GCS " + objectName + " [" + responseCode + "]: " + responseBody);

    if (responseCode !== 200) {
      console.error("Lỗi Upload GCS " + objectName + " Code " + responseCode + ": " + responseBody);
    }
    return responseCode === 200;
  } catch (err) {
    Logger.log("❌ Lỗi ngoại lệ Sync GCS: " + err.toString());
    console.error(err);
    return false;
  }
}

// PDF quyết định phê duyệt (byte[]), contentType application/pdf để trình duyệt xem trực tiếp
function uploadBytesToGCS(bytes, fileName, contentType) {
  try {
    var token = ScriptApp.getOAuthToken();
    var url = "https://storage.googleapis.com/upload/storage/v1/b/" + BUCKET_NAME + "/o?uploadType=media&name=" + encodeURIComponent(fileName);
    var response = UrlFetchApp.fetch(url, {
      "method": "post",
      "contentType": contentType || "application/octet-stream",
      "headers": { "Authorization": "Bearer " + token },
      "payload": bytes,
      "muteHttpExceptions": true
    });
    var code = response.getResponseCode();
    if (code !== 200) console.error("Lỗi Upload GCS " + fileName + " Code " + code + ": " + response.getContentText());
    return code === 200;
  } catch (err) {
    console.error(err);
    return false;
  }
}

// 1. TỰ ĐỘNG ĐÓNG GÓI GEOJSON VÀ UPLOAD LÊN BUCKET (XỬ LÝ MẢNG IN-MEMORY)
// includeCad = false: chỉ infrastructure_hue.json (nhập / xóa một đồ án không dựng lại cad_parcels.json)
function syncSheetsToGCS(includeCad) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    Logger.log("=== BẮT ĐẦU ĐỒNG BỘ DỮ LIỆU SANG GCS ===");
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var features = collectFeatures(ss);
    Logger.log("📊 TỔNG SỐ DỮ LIỆU ĐÓNG GÓI BẢN ĐỒ: " + features.length);
    uploadToGCS(JSON.stringify({ "type": "FeatureCollection", "features": features }));

    if (includeCad !== false) {
      var cadFeatures = collectCadFeatures(ss, features);
      if (cadFeatures) {
        uploadToGCS(JSON.stringify({ "type": "FeatureCollection", "features": cadFeatures }), CAD_FILE_NAME);
      }
    }
    scheduleWebappWarm();

  } catch (err) {
    Logger.log("❌ Lỗi syncSheetsToGCS: " + err.toString());
  } finally {
    lock.releaseLock();
  }
}

// TÍNH SẴN TRÊN WEBAPP SAU ĐỒNG BỘ: máy chủ Vercel đếm pixel ứng viên + độ phủ phường đổi chữ ký rồi lưu bucket (cache/v1/),
// người mở web đầu tiên không phải chờ GEE. Chạy bằng trigger hẹn giờ (không gọi thẳng trong syncSheetsToGCS: doPost từ
// webapp chỉ chờ 25–55 s). Cần Script Property WEBAPP_URL (vd. https://<tên miền webapp>); thiếu thì bỏ qua.
const WARM_HANDLER = "warmWebappCache";
// Gộp nhiều lần sửa liên tiếp vào 1 lượt tính
const WARM_DELAY_MS = 60 * 1000;
// Apps Script cắt 1 lượt chạy ở 6 phút: hết ngân sách thì hẹn lượt sau làm tiếp
const WARM_BUDGET_MS = 4.5 * 60 * 1000;

function scheduleWebappWarm() {
  try {
    if (!PropertiesService.getScriptProperties().getProperty("WEBAPP_URL")) return;
    var pending = ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === WARM_HANDLER; });
    if (!pending) ScriptApp.newTrigger(WARM_HANDLER).timeBased().after(WARM_DELAY_MS).create();
  } catch (err) {
    Logger.log("⚠ Không hẹn được lượt tính sẵn webapp: " + err.toString());
  }
}

function warmWebappCache() {
  // Xóa trigger trước: dữ liệu đổi trong lúc đang tính sẽ hẹn lượt mới
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === WARM_HANDLER) ScriptApp.deleteTrigger(t);
  });
  var base = PropertiesService.getScriptProperties().getProperty("WEBAPP_URL");
  if (!base) {
    Logger.log("⚠ Chưa có Script Property WEBAPP_URL, bỏ qua tính sẵn");
    return;
  }
  var api = base.replace(/\/+$/, "") + "/api/gee?action=";
  var started = Date.now();
  var overBudget = function() { return Date.now() - started > WARM_BUDGET_MS; };
  var get = function(qs) {
    try {
      var res = UrlFetchApp.fetch(api + qs, { "muteHttpExceptions": true });
      if (res.getResponseCode() !== 200) {
        Logger.log("⚠ " + qs + " → HTTP " + res.getResponseCode());
        return null;
      }
      return JSON.parse(res.getContentText());
    } catch (err) {
      Logger.log("⚠ " + qs + " lỗi: " + err.toString());
      return null;
    }
  };

  var stats = get("getWardStats&fresh=1");
  if (!stats || !stats.data) return;
  var counted = 0, covered = 0;
  (stats.countPending || []).forEach(function(ward) {
    for (var round = 0; round < 5 && !overBudget(); round++) {
      var r = get("countWardCandidates&ward=" + encodeURIComponent(ward));
      if (!r) break;
      counted += r.counted || 0;
      if (!r.counted || !r.remaining) break;
    }
  });
  // Phường chưa có độ phủ khớp chữ ký; QH đã lưu thì máy chủ trả ngay từ bucket
  stats.data.forEach(function(w) {
    if (overBudget()) return;
    var ward = encodeURIComponent(w.Ten_Phuong);
    if (!w._coverageReady && get("getWardCoverage&ward=" + ward)) covered++;
    if (w.planCovSig && !overBudget() && get("getWardCoverage&scenario=QH&ward=" + ward)) covered++;
  });
  Logger.log("🔥 Tính sẵn webapp: đếm " + counted + " ứng viên, " + covered + " lượt độ phủ, "
    + Math.round((Date.now() - started) / 1000) + " s");
  if (overBudget()) scheduleWebappWarm();
}

// CHẠY 1 LẦN TRONG TRÌNH SOẠN THẢO: đổi tiêu đề QuyMo_S -> QuyMo_HT (giữ nguyên giá trị)
// và chèn cột QuyMo_QH trống ngay bên phải cho cả 9 tab
function migrateQuyMoColumns() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(function(sheet) {
    var sheetName = sheet.getName();
    if (!isValidInfraSheet(sheetName)) return;

    var norm = getSheetHeaders(sheet).map(normalizeHeader);
    var htIdx = norm.indexOf('quymo_ht');
    var sIdx = norm.indexOf('quymo_s');

    if (htIdx === -1 && sIdx !== -1) {
      sheet.getRange(1, sIdx + 1).setValue('QuyMo_HT');
      htIdx = sIdx;
    }
    if (htIdx === -1) {
      Logger.log("⚠ Tab '" + sheetName + "': không thấy cột QuyMo_S/QuyMo_HT, bỏ qua!");
      return;
    }
    if (norm.indexOf('quymo_qh') === -1) {
      sheet.insertColumnAfter(htIdx + 1);
      sheet.getRange(1, htIdx + 2).setValue('QuyMo_QH');
    }
    Logger.log("✓ Tab '" + sheetName + "': đã có QuyMo_HT + QuyMo_QH");
  });
  syncSheetsToGCS();
}

// CHẠY 1 LẦN TRONG TRÌNH SOẠN THẢO: sửa ô Latitude/Longitude bị mất dấu thập phân (vd. tab 13-BUS nhập từ CSV:
// 16.452.800 → 16.4528), ghi lại dạng văn bản để locale không đọc sai lần nữa
function fixCoordinateCells() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(function(sheet) {
    var sheetName = sheet.getName();
    if (!isValidInfraSheet(sheetName)) return;
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return;
    var col = getColumnMap(data[0]);
    if (col.lat < 0 || col.lng < 0) return;
    var fixed = 0;
    [[col.lat, 90], [col.lng, 180]].forEach(function(pair) {
      var c = pair[0], limit = pair[1];
      var range = sheet.getRange(2, c + 1, data.length - 1, 1);
      var values = range.getValues();
      var changed = false;
      for (var i = 0; i < values.length; i++) {
        var raw = parseCleanNumber(values[i][0]);
        if (!raw || Math.abs(raw) <= limit) continue;
        values[i][0] = String(rescaleCoord(raw, limit));
        changed = true;
        fixed++;
      }
      if (changed) {
        range.setNumberFormat("@");
        range.setValues(values);
      }
    });
    if (fixed) Logger.log("✓ Tab '" + sheetName + "': sửa " + fixed + " ô tọa độ");
  });
  syncSheetsToGCS();
}

// 2. BẮT SỰ KIỆN CHỈNH SỬA THỦ CÔNG & TỰ ĐỘNG CHUYỂN TAB KHI ADMIN DUYỆT 'TRUE'
//    Xử lý đúng khi dán/sửa NHIỀU DÒNG cùng lúc (copy-paste hàng loạt)
function installedOnEdit(e) {
  if (!e || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();
  var sheetName = sheet.getName().trim();

  if (!isValidInfraSheet(sheetName)) return;

  var startRow = range.getRow();
  var numRows = range.getNumRows();
  var startCol = range.getColumn();
  var endCol = startCol + range.getNumColumns() - 1;

  var headers = getSheetHeaders(sheet);
  var col = getColumnMap(headers);
  var statusCol = col.trangThai + 1; // 1-based, = 0 nếu tab không có cột
  var timeCol = col.thoiGian + 1;
  var noteCol = col.ghiChu + 1;

  // Bỏ qua nếu vùng chỉnh sửa chỉ nằm trong cột ThoiGianCapNhat/Note
  // — đây là các cột do chính script ghi lại, tránh gây vòng lặp trigger vô hạn
  var onlyAuxCols = true;
  for (var c = startCol; c <= endCol; c++) {
    if (c !== timeCol && c !== noteCol) { onlyAuxCols = false; break; }
  }
  if (onlyAuxCols) return;

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var currentTime = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss");
    var isCsdSheet = sheetName.indexOf("12-CSD") === 0;
    var touches = function(idx) { return idx >= 0 && startCol <= idx + 1 && endCol >= idx + 1; };
    var touchesStatus = statusCol > 0 && startCol <= statusCol && endCol >= statusCol;
    var touchesWard = touches(col.ward);
    var touchesCoord = touches(col.lat) || touches(col.lng);

    var rowsToDelete = []; // các dòng CSD đã chuyển đổi xong, cần xóa khỏi sheet gốc

    for (var offset = 0; offset < numRows; offset++) {
      var row = startRow + offset;
      if (row <= 1) continue; // bỏ qua dòng tiêu đề

      var handledAsConversion = false;

      // Admin duyệt TRUE ở Sheet CSD: chuyển khu đất sang tab công năng mới thành CÔNG TRÌNH QUY HOẠCH MỚI
      if (isCsdSheet && touchesStatus) {
        var val = sheet.getRange(row, statusCol).getValue();
        if (val === true || String(val).toUpperCase() === "TRUE") {
          var rowValues = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
          var noteVal = String(cellAt(rowValues, col.ghiChu) || '');

          if (noteVal.indexOf("Đề xuất ->") !== -1) {
            var targetTypeCode = noteVal.split("Đề xuất ->")[1].trim();
            var targetSheet = null;

            SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function(s) {
              if (s.getName().trim().indexOf(targetTypeCode) === 0) {
                targetSheet = s;
              }
            });

            if (targetSheet) {
              var targetData = targetSheet.getDataRange().getValues();
              var tCol = getColumnMap(targetData[0]);
              var newId = nextIdForSheet(targetData, tCol.id, targetTypeCode.split('-')[1]);

              // Chép theo tên cột (2 tab có thể khác thứ tự cột)
              var newRow = new Array(targetData[0].length).fill('');
              Object.keys(tCol).forEach(function(key) {
                if (tCol[key] >= 0 && col[key] >= 0) newRow[tCol[key]] = rowValues[col[key]];
              });

              // Khu đất trống chưa có công trình: HT để trống (= quy hoạch mới; số 0 sẽ bị hiểu là đã có công trình), diện tích khu đất chuyển sang QH
              var landArea = parseOptionalNumber(cellAt(rowValues, col.quyMoQH));
              if (landArea === null) landArea = parseCleanNumber(cellAt(rowValues, col.quyMoHT));
              if (tCol.quyMoQH >= 0) {
                if (tCol.quyMoHT >= 0) newRow[tCol.quyMoHT] = '';
                newRow[tCol.quyMoQH] = landArea;
              }

              if (tCol.id >= 0) newRow[tCol.id] = newId;
              if (tCol.nhom >= 0) newRow[tCol.nhom] = targetSheet.getName();
              if (tCol.trangThai >= 0) newRow[tCol.trangThai] = true;
              if (tCol.thoiGian >= 0) newRow[tCol.thoiGian] = currentTime;

              targetSheet.appendRow(newRow);
              rowsToDelete.push(row);
              handledAsConversion = true;
            }
          }
        }
      }

      // Nếu dòng này không phải trường hợp chuyển đổi CSD, chỉ cập nhật timestamp bình thường
      if (!handledAsConversion && timeCol > 0) {
        sheet.getRange(row, timeCol).setValue(currentTime);
      }
      if (!handledAsConversion && noteCol > 0 && (touchesWard || touchesCoord)) {
        clearFixedWardMark(sheet, row, col, touchesCoord);
      }
    }

    // Xóa từ dưới lên để không lệch số thứ tự dòng khi xóa nhiều dòng trong cùng 1 lượt
    rowsToDelete.sort(function(a, b) { return b - a; });
    rowsToDelete.forEach(function(r) {
      sheet.deleteRow(r);
    });

    syncSheetsToGCS();

  } catch (err) {
    Logger.log("❌ Lỗi installedOnEdit: " + err.toString());
  } finally {
    lock.releaseLock();
  }
}

// 3. XỬ LÝ ĐỌC / GHI CÁC YÊU CẦU TỪ BẢN ĐỒ
function doGet(e) {
  try {
    var params = e ? e.parameter : {};
    var action = params.action;

    // Chỉ máy chủ webapp (có khóa API_SECRET) mới được ghi vào Sheet
    var PROTECTED_ACTIONS = ["approvePoint", "addPoint", "proposeConvert"];
    if (PROTECTED_ACTIONS.indexOf(action) !== -1) {
      var secret = PropertiesService.getScriptProperties().getProperty("API_SECRET");
      if (!secret || params.key !== secret) {
        return ContentService.createTextOutput(JSON.stringify({ "error": "Sai khóa API" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var currentTime = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss");

    // A. PHÊ DUYỆT ĐIỂM HẠ TẦNG THÀNH TRUE TỪ BẢN ĐỒ
    if (action === "approvePoint") {
      var targetId = String(params.id || '').trim();
      if (!targetId) {
        return ContentService.createTextOutput(JSON.stringify({ "error": "Thiếu ID công trình" }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      var sheets = ss.getSheets();
      var updated = false;

      for (var s = 0; s < sheets.length; s++) {
        var sheet = sheets[s];
        if (!isValidInfraSheet(sheet.getName())) continue;

        var data = sheet.getDataRange().getValues();
        if (data.length <= 1) continue;
        var col = getColumnMap(data[0]);
        if (col.id < 0 || col.trangThai < 0) continue;

        for (var r = 1; r < data.length; r++) {
          if (String(data[r][col.id] || '').trim() === targetId) {
            sheet.getRange(r + 1, col.trangThai + 1).setValue(true);
            if (col.thoiGian >= 0) sheet.getRange(r + 1, col.thoiGian + 1).setValue(currentTime);
            updated = true;
            break;
          }
        }
        if (updated) break;
      }

      if (updated) {
        syncSheetsToGCS();
        return ContentService.createTextOutput(JSON.stringify({ "success": true, "id": targetId }))
          .setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({ "error": "Không tìm thấy ID đối tượng: " + targetId }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    // B. ENDPOINT TRẢ GEOJSON CHUẨN THUẦN (TEXT MIMETYPE TRÁNH REDIRECT 302)
    if (action === "getJson") {
      return ContentService.createTextOutput(JSON.stringify({ "type": "FeatureCollection", "features": collectFeatures(ss) }))
        .setMimeType(ContentService.MimeType.TEXT);
    }

    // C. THÊM ĐIỂM MỚI TỪ BẢN ĐỒ (phase=HT: bổ sung hiện trạng | phase=QH: đề xuất quy hoạch mới)
    if (action === "addPoint") {
      var typeCode = params.type || "12-CSD";
      var name = params.name || "Công trình mới";
      var ward = sheetWard(params.ward) || "Thuận Hóa";
      var phase = String(params.phase || 'HT').toUpperCase() === 'QH' ? 'QH' : 'HT';

      var latStr = String(params.lat || '0').replace(',', '.');
      var lngStr = String(params.lng || '0').replace(',', '.');
      var size = parseCleanNumber(params.size);
      // Bán kính theo QCVN 01:2026 do máy chủ webapp tính (cấp đô thị / đơn vị ở, phường / xã); trống = không có vùng phục vụ
      var radius = parseCleanNumber(params.radius);

      // Điểm quy hoạch mới bắt buộc có diện tích để phân biệt với công trình chưa rõ quy mô (trừ trạm xe buýt, trụ sở PCCC)
      if (phase === 'QH' && size <= 0 && NO_AREA_TYPES.indexOf(typeCode) === -1) {
        return ContentService.createTextOutput(JSON.stringify({ "error": "Điểm quy hoạch mới cần diện tích > 0" }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      var targetSheet = ensureInfraSheet(ss, typeCode);
      if (!targetSheet) targetSheet = ss.getSheets()[0];

      var data = targetSheet.getDataRange().getValues();
      var col = getColumnMap(data[0]);
      if (phase === 'QH' && col.quyMoQH < 0) {
        return ContentService.createTextOutput(JSON.stringify({ "error": "Tab " + targetSheet.getName() + " chưa có cột QuyMo_QH" }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      var newId = nextIdForSheet(data, col.id, typeCode.split('-')[1]);
      var newRow = new Array(data[0].length).fill('');
      var setCell = function(key, value) { if (col[key] >= 0) newRow[col[key]] = value; };

      setCell('id', newId);
      setCell('name', name);
      setCell('ward', ward);
      setCell('nhom', sheetNhom(params.nhomHaTang));
      setCell('lat', "'" + latStr);
      setCell('lng', "'" + lngStr);
      // Chỉ ghi cột quy mô của giai đoạn đang đề xuất (QH: QuyMo_HT để trống = quy hoạch mới)
      if (phase === 'QH') setCell('quyMoQH', size);
      else setCell('quyMoHT', size);
      setCell('trangThai', false);
      setCell('thoiGian', currentTime);
      setCell('ghiChu', phase === 'QH' ? "Đề xuất quy hoạch mới từ GEE" : "Thêm mới từ GEE");

      targetSheet.appendRow(newRow);

      var lastRow = targetSheet.getLastRow();
      if (col.lat >= 0) targetSheet.getRange(lastRow, col.lat + 1).setNumberFormat("@");
      if (col.lng >= 0) targetSheet.getRange(lastRow, col.lng + 1).setNumberFormat("@");

      syncSheetsToGCS();

      return ContentService.createTextOutput(JSON.stringify({ "success": true, "id": newId, "phase": phase }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // D. ĐỀ XUẤT CHUYỂN ĐỔI CÔNG NĂNG
    if (action === "proposeConvert") {
      var targetId = params.id;
      var targetType = params.targetType;

      var csdSheet = findInfraSheet(ss, "12-CSD");

      var updated = false;
      if (csdSheet) {
        var data = csdSheet.getDataRange().getValues();
        var col = getColumnMap(data[0]);
        for (var r = 1; r < data.length; r++) {
          if (col.id >= 0 && String(data[r][col.id]).trim() === String(targetId).trim()) {
            if (col.trangThai >= 0) csdSheet.getRange(r + 1, col.trangThai + 1).setValue(false);
            if (col.thoiGian >= 0) csdSheet.getRange(r + 1, col.thoiGian + 1).setValue(currentTime);
            if (col.ghiChu >= 0) csdSheet.getRange(r + 1, col.ghiChu + 1).setValue("Đề xuất -> " + targetType);
            updated = true;
            break;
          }
        }
      }

      if (updated) {
        syncSheetsToGCS();
        return HtmlService.createHtmlOutput(
          "<h2 style='color:#d35400;font-family:sans-serif;'>🚀 ĐÃ GỬI ĐỀ XUẤT CHUYỂN ĐỔI CÔNG NĂNG!</h2>"
        );
      } else {
        return HtmlService.createHtmlOutput(
          "<h2 style='color:#c0392b;font-family:sans-serif;'>⚠️ KHÔNG TÌM THẤY MÃ KHU ĐẤT!</h2>"
        );
      }
    }

    // E. MẶC ĐỊNH: KHÔNG XÁC ĐỊNH ACTION
    return ContentService.createTextOutput(JSON.stringify({ "type": "FeatureCollection", "features": [] }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({"error": err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Body POST: JSON thuần, JSON bị bọc thành chuỗi, hoặc form field payload=
// Query ?action= vẫn dùng được khi Google không đưa action vào body (đúng lỗi "Action không hợp lệ")
function parsePostBody(e) {
  var params = (e && e.parameter) || {};
  var post = e && e.postData;
  var raw = post ? String(post.contents || '') : '';
  if (!raw && post && typeof post.getDataAsString === 'function') {
    try { raw = String(post.getDataAsString() || ''); } catch (err) { raw = ''; }
  }

  function asObject(text) {
    if (!text) return null;
    var parsed;
    try { parsed = JSON.parse(text); } catch (err) { return null; }
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch (err2) { return null; }
    }
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  }

  var body = asObject(params.payload) || null;
  if (!body || !body.action) {
    var text = raw;
    if (text && text.charAt(0) !== '{' && text.charAt(0) !== '[') {
      var match = text.match(/(?:^|&)payload=([^&]*)/);
      if (match) {
        try { text = decodeURIComponent(match[1].replace(/\+/g, '%20')); } catch (err) { text = ''; }
      }
    }
    body = asObject(text) || body || {};
  }
  if (!body.action && params.action) body.action = String(params.action);
  return body;
}

// 4. GHI HÀNG LOẠT (POST JSON, CHỈ MÁY CHỦ WEBAPP CÓ KHÓA API_SECRET)
function doPost(e) {
  try {
    var params = (e && e.parameter) || {};
    var secret = PropertiesService.getScriptProperties().getProperty("API_SECRET");
    if (!secret || params.key !== secret) return jsonOutput({ "error": "Sai khóa API" });

    var body = parsePostBody(e);
    var action = String(body.action || '');
    if (action === "importCadBatch") return jsonOutput(importCadBatch(body));
    if (action === "markWardNotes") return jsonOutput(markWardNotes(body));
    if (action === "editInfraRow") return jsonOutput(editInfraRow(body));
    if (action === "deleteInfraRow") return jsonOutput(deleteInfraRow(body));
    if (action === "deleteProject") return jsonOutput(deleteProject(body));
    if (action === "renameProject") return jsonOutput(renameProject(body));
    if (action === "setProjectLink") return jsonOutput(setProjectLink(body));
    if (action === "putBucketObject") return jsonOutput(putBucketObject(body));
    if (action === "putBucketPdf") return jsonOutput(putBucketPdf(body));
    if (action === "deleteBucketObject") return jsonOutput(deleteBucketObject(body));
    if (action === "saveRoads") return jsonOutput(saveRoads(body));
    if (action === "savePopEdits") return jsonOutput(savePopEdits(body));
    if (action === "saveDrainage") return jsonOutput(saveDrainage(body));
    if (action === "saveBasins") return jsonOutput(saveBasins(body));
    if (action === "saveDrainArrows") return jsonOutput(saveDrainArrows(body));
    if (action === "addPendingCad") return jsonOutput(addPendingCad(body));
    if (action === "removePendingCad") return jsonOutput(removePendingCad(body));
    if (action === "addPendingPoints") {
      if (!Array.isArray(body.items) || !body.items.length) {
        return jsonOutput({ "error": "Không nhận được danh sách điểm. Deploy bản Code.gs này: Manage deployments → Edit → Version: New version." });
      }
      return jsonOutput(addPendingPoints(body));
    }
    return jsonOutput({ "error": "Action không hợp lệ: " + action });
  } catch (err) {
    return jsonOutput({ "error": err.toString() });
  }
}

/**
 * Nhập lô đất từ DXF/KML/KMZ. body = { phase: 'HT'|'QH', fileName, sync, items: [{ type, idPrefix, nhom, name, ward,
 * lat, lng, size, area, crossWard, layer, matchId, geometry, stages, plan }] }
 * - plan: { floors, coverage, far } chỉ tiêu quy hoạch lô → cột TangCao / MatDoXD / HeSoSDD (tab chưa có cột thì tự thêm)
 * - stages: [{ phase, size, area, point, crossWard, layer, geometry }] — 1 giai đoạn, hoặc 2 (lô HT + QH cùng vị trí,
 *   tên layer theo TT16); không có stages thì 1 giai đoạn = body.phase với size / area / geometry của item
 * - matchId có trong Sheet → cập nhật tọa độ, phường, quy mô các giai đoạn đang nhập; không có → thêm dòng mới
 * - File HT-*.dxf ghi mọi lô vào QuyMo_HT; file QH-*.dxf ghi mọi lô vào QuyMo_QH (kể cả layer có tiền tố HT)
 * - Trùng điểm: giữ tên trên Sheet, ghi đè lat/lng bằng tâm polygon mới; Ten_QH và Geojson lấy từ file
 * - Layer không thuộc nhóm hạ tầng: webapp ghi projects/<slug>/su-dung-dat.json hoặc hien-trang.json, không gửi lands (skipDxf = true)
 * - sync = false: chưa đẩy infrastructure_hue.json. syncCad = false: không dựng lại cad_parcels.json
 * - lotIds: mã lô cùng thứ tự items (null nếu bỏ qua) để webapp gắn ranh vào file đồ án
 */
function projectTitle(fileName) {
  var base = String(fileName || '').replace(/\.[^.]+$/, '').trim();
  var m = base.match(/^(?:HT|QH)[\s_\-]+(.+)$/i);
  return String(m ? m[1] : base).slice(0, 120);
}

function filePhaseOf(fileName) {
  var base = String(fileName || '').replace(/\.[^.]+$/, '').trim();
  var m = base.match(/^(HT|QH)(?![A-Za-z])/i);
  return m ? m[1].toUpperCase() : null;
}

// Webapp tính THPT chung mã 4-TH; trên Sheet THPT có tab riêng 6-THPT
function sheetCodeOf(it) {
  return String(it.idPrefix || '').toUpperCase() === 'THPT' ? '6-THPT' : String(it.type || '');
}

function geoCell(geometry) {
  if (!geometry) return '';
  var text = JSON.stringify(geometry);
  return text.length > GEOJSON_MAX_CHARS ? '' : text;
}

/**
 * Lô vắt ranh phường: mỗi mảnh phường phụ 1 dòng <ID>.2, <ID>.3 (cùng tên, nhóm, đồ án, chỉ tiêu; quy mô = phần diện tích trong phường đó).
 * Dòng mảnh chỉ dùng tính diện tích chỉ tiêu phường (webapp không vẽ, không đếm thêm công trình).
 * Chỉ ghi quy mô các giai đoạn đang nhập; mảnh cũ không còn: xóa dòng nếu giai đoạn kia cũng trống, không thì chỉ xóa quy mô giai đoạn đang nhập.
 */
function writeWardSplits(c, id, it, stages, project, currentTime) {
  var phases = stages.map(function(st) { return st.phase; });
  var qColOf = function(ph) { return ph === 'QH' ? c.col.quyMoQH : c.col.quyMoHT; };
  var written = 0;
  (Array.isArray(it.splits) ? it.splits : []).forEach(function(sp) {
    var spStages = (sp.stages || []).filter(function(st) { return phases.indexOf(st.phase) >= 0; });
    if (!spStages.length) return;
    written++;
    var sid = id + '.' + (written + 1);
    var r = c.idRow[sid];
    var row = r === undefined ? new Array(c.data[0].length).fill('') : null;
    var set = row
      ? function(idx, v) { if (idx >= 0) row[idx] = v; }
      : function(idx, v) { if (idx >= 0) c.sheet.getRange(r + 1, idx + 1).setValue(v); };
    set(c.col.id, sid);
    set(c.col.name, it.name);
    set(c.col.ward, sheetWard(sp.ward));
    set(c.col.nhom, sheetNhom(it.nhom));
    set(c.col.lat, Number(sp.lat));
    set(c.col.lng, Number(sp.lng));
    spStages.forEach(function(st) { set(qColOf(st.phase), st.size); });
    set(c.col.tenQH, project);
    set(c.col.geojson, geoCell(spStages[0].geometry));
    set(c.col.trangThai, true);
    set(c.col.thoiGian, currentTime);
    set(c.col.ghiChu, "Phần trong " + sp.ward + " của lô " + id + " (tách ranh phường, chỉ tính diện tích chỉ tiêu phường)");
    eachPlanValue(it.plan, c.col, set);
    if (row) c.newRows.push(row);
  });
  var prefix = id + '.';
  Object.keys(c.idRow).forEach(function(rid) {
    if (rid.indexOf(prefix) !== 0) return;
    var n = Number(rid.slice(prefix.length));
    if (!(n >= 2) || n <= written + 1) return;
    var r = c.idRow[rid];
    var otherFilled = ['HT', 'QH'].some(function(ph) {
      var qc = qColOf(ph);
      return phases.indexOf(ph) < 0 && qc >= 0 && String(cellAt(c.data[r], qc)).trim() !== '';
    });
    if (!otherFilled) { c.staleRows.push(r); return; }
    phases.forEach(function(ph) { if (qColOf(ph) >= 0) c.sheet.getRange(r + 1, qColOf(ph) + 1).setValue(''); });
  });
}

function importCadBatch(body) {
  var items = Array.isArray(body.items) ? body.items : [];
  var phase = body.phase === 'QH' ? 'QH' : 'HT';
  var fileName = String(body.fileName || 'DXF');
  var filePhase = filePhaseOf(fileName);
  var project = projectTitle(fileName);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var currentTime = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss");
  var created = [], updated = [], skipped = [], polygons = [], lotIds = [];
  var landCount = 0;

  var needPlan = items.some(function(it) { return !!it.plan; });
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var backup = readProjectBackup(ss, project);
    var ctx = {};
    var getCtx = function(typeCode) {
      if (ctx.hasOwnProperty(typeCode)) return ctx[typeCode];
      var sheet = findInfraSheet(ss, typeCode);
      if (!sheet) return (ctx[typeCode] = null);
      if (needPlan) ensurePlanColumns(sheet);
      var data = sheet.getDataRange().getValues();
      var col = getColumnMap(data[0]);
      var idRow = {};
      for (var r = 1; r < data.length; r++) {
        var rid = String(cellAt(data[r], col.id) || '').trim();
        if (rid) idRow[rid] = r;
      }
      return (ctx[typeCode] = { sheet: sheet, data: data, col: col, idRow: idRow, maxNum: {}, newRows: [], staleRows: [] });
    };
    var nextId = function(c, prefix) {
      if (!c.maxNum.hasOwnProperty(prefix)) c.maxNum[prefix] = maxIdNumber(c.data, c.col.id, prefix);
      c.maxNum[prefix]++;
      return formatId(prefix, c.maxNum[prefix]);
    };

    items.forEach(function(it) {
      var c = getCtx(sheetCodeOf(it));
      if (!c || c.col.id < 0 || c.col.lat < 0 || c.col.lng < 0) {
        skipped.push(it.layer + ": không có tab " + it.type + " hợp lệ");
        lotIds.push(null);
        return;
      }
      var stages = Array.isArray(it.stages) && it.stages.length ? it.stages
        : [{ phase: phase, size: it.size, area: it.area, point: it.point, crossWard: it.crossWard, layer: it.layer, geometry: it.geometry }];
      if (filePhase && stages.length) {
        stages = [stages[0]];
        stages[0].phase = filePhase;
      }
      var qCols = [];
      for (var k = 0; k < stages.length; k++) {
        stages[k].phase = stages[k].phase === 'QH' ? 'QH' : 'HT';
        var qc = stages[k].phase === 'QH' ? c.col.quyMoQH : c.col.quyMoHT;
        if (qc < 0) {
          skipped.push(it.layer + ": tab " + c.sheet.getName() + " thiếu cột QuyMo_" + stages[k].phase);
          lotIds.push(null);
          return;
        }
        qCols.push(qc);
      }

      var note = "Nhập từ file " + fileName + " (" + stages.map(function(st) {
        return "layer " + st.layer + " → QuyMo_" + st.phase
          + (st.point ? ", dạng điểm, chưa có diện tích" : "")
          + (st.crossWard ? ", vắt ranh phường, diện tích thật " + st.area + " m²" : "");
      }).join("; ") + ")";
      var splitWards = (Array.isArray(it.splits) ? it.splits : []).map(function(sp) { return sp.ward; });
      if (splitWards.length) note += "; vắt ranh phường: phần trong " + splitWards.join(", ") + " ghi dòng ID hậu tố .2, .3";
      var r = it.matchId ? c.idRow[it.matchId] : undefined;
      var id;

      if (r !== undefined) {
        // Cập nhật từng ô (không ghi đè cả dòng để giữ công thức/định dạng sẵn có)
        id = it.matchId;
        var sheetRow = r + 1;
        // Dòng đã thuộc đồ án này (do đồ án tạo hoặc đã sao lưu ở lần nhập trước) thì không sao lưu lại
        if (String(cellAt(c.data[r], c.col.tenQH) || '').trim() !== project) snapshotRow(backup, c, r, project, currentTime);
        var prevNote = String(cellAt(c.data[r], c.col.ghiChu) || '').trim();
        c.sheet.getRange(sheetRow, c.col.lat + 1).setValue(Number(it.lat));
        c.sheet.getRange(sheetRow, c.col.lng + 1).setValue(Number(it.lng));
        if (c.col.ward >= 0) c.sheet.getRange(sheetRow, c.col.ward + 1).setValue(sheetWard(it.ward));
        if (c.col.nhom >= 0) c.sheet.getRange(sheetRow, c.col.nhom + 1).setValue(sheetNhom(it.nhom));
        stages.forEach(function(st, k) { c.sheet.getRange(sheetRow, qCols[k] + 1).setValue(st.size); });
        if (c.col.tenQH >= 0) c.sheet.getRange(sheetRow, c.col.tenQH + 1).setValue(project);
        var geomText = geoCell(stages[0] && stages[0].geometry);
        if (c.col.geojson >= 0 && geomText) c.sheet.getRange(sheetRow, c.col.geojson + 1).setValue(geomText);
        if (c.col.trangThai >= 0) c.sheet.getRange(sheetRow, c.col.trangThai + 1).setValue(true);
        if (c.col.thoiGian >= 0) c.sheet.getRange(sheetRow, c.col.thoiGian + 1).setValue(currentTime);
        if (c.col.ghiChu >= 0) c.sheet.getRange(sheetRow, c.col.ghiChu + 1).setValue(prevNote ? prevNote + " | " + note : note);
        eachPlanValue(it.plan, c.col, function(idx, v) { c.sheet.getRange(sheetRow, idx + 1).setValue(v); });
        updated.push(id);
      } else {
        id = nextId(c, String(it.idPrefix || it.type.split('-')[1]));
        var row = new Array(c.data[0].length).fill('');
        var set = function(idx, value) { if (idx >= 0) row[idx] = value; };
        set(c.col.id, id);
        set(c.col.name, it.name);
        set(c.col.ward, sheetWard(it.ward));
        set(c.col.nhom, sheetNhom(it.nhom));
        set(c.col.lat, Number(it.lat));
        set(c.col.lng, Number(it.lng));
        stages.forEach(function(st, k) { set(qCols[k], st.size); });
        set(c.col.tenQH, project);
        set(c.col.geojson, geoCell(stages[0] && stages[0].geometry));
        set(c.col.trangThai, true);
        set(c.col.thoiGian, currentTime);
        set(c.col.ghiChu, note);
        eachPlanValue(it.plan, c.col, set);
        c.newRows.push(row);
        created.push(id);
      }
      writeWardSplits(c, id, it, stages, project, currentTime);
      lotIds.push(id);
      stages.forEach(function(st) {
        if (st.geometry) polygons.push({ id: id, layer: st.layer, area: st.area, geometry: st.geometry, phase: st.phase });
      });
    });

    // Dòng mới ghi 1 lần mỗi tab, chép định dạng + danh sách chọn (Nhom_HaTang, TrangThai) từ dòng dữ liệu cuối.
    // Xóa dòng mảnh phường cũ trước (từ dưới lên để chỉ số dòng phía trên không đổi)
    Object.keys(ctx).forEach(function(k) {
      var c = ctx[k];
      if (!c) return;
      c.staleRows.sort(function(a, b) { return b - a; }).forEach(function(r) { c.sheet.deleteRow(r + 1); });
      if (!c.newRows.length) return;
      var start = c.sheet.getLastRow() + 1;
      var n = c.newRows.length;
      var w = c.data[0].length;
      ensureSheetSize(c.sheet, start + n - 1, w);
      var target = c.sheet.getRange(start, 1, n, w);
      if (start > 2) {
        var template = c.sheet.getRange(start - 1, 1, 1, w);
        template.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
        template.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
      }
      target.setValues(c.newRows);
    });

    appendProjectBackup(ss, backup);
    upsertCadPolygons(ss, polygons, fileName, currentTime, filePhase || phase);
    landCount = body.skipDxf === true ? 0 : writeDxfLands(ss, body.lands, project, filePhase || phase, currentTime, body.landsReset === true);
    if (body.registry) upsertProjectRegistry(ss, project, fileName, body.registry, currentTime);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  if (body.sync !== false) syncSheetsToGCS(body.syncCad !== false);
  return { "success": true, "created": created, "updated": updated, "skipped": skipped, "polygons": polygons.length, "lands": landCount, "lotIds": lotIds };
}

/**
 * Ghi hàng loạt điểm hiện trạng ở trạng thái chờ duyệt (TrangThai = FALSE), VD điểm OpenStreetMap do Admin nhập.
 * body = { items: [{ type, name, ward, lat, lng, size, radius, ref }] } — ref (VD "OSM:node/123") ghi vào cột Note;
 * dòng có Note chứa cùng ref đã có trong tab thì bỏ qua để nhập lại nhiều lần không bị trùng
 */
function addPendingPoints(body) {
  var items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return { "error": "Danh sách điểm rỗng" };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return { "error": "Script không gắn với Google Sheet (getActiveSpreadsheet trống)" };
  var currentTime = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss");
  var created = [], skipped = 0, sheets = [];

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ctx = {};
    items.forEach(function(it) {
      var typeCode = String(it.type || '');
      if (!ctx.hasOwnProperty(typeCode)) {
        var sheet = null;
        try { sheet = ensureInfraSheet(ss, typeCode); }
        catch (err) { ctx[typeCode] = { error: err.message || String(err) }; }
        if (!ctx[typeCode]) {
          if (!sheet) ctx[typeCode] = { error: "Không có tab " + typeCode };
          else {
            var data = sheet.getDataRange().getValues();
            var col = getColumnMap(data[0]);
            var noteSet = {};
            for (var r = 1; r < data.length; r++) {
              var note = String(cellAt(data[r], col.ghiChu) || '');
              if (note) noteSet[note] = true;
              var refInNote = note.match(/OSM:(?:node|way|relation)\/\d+/);
              if (refInNote) noteSet[refInNote[0]] = true;
            }
            ctx[typeCode] = { sheet: sheet, data: data, col: col, noteSet: noteSet, maxNum: null, rows: [] };
          }
        }
      }
      var c = ctx[typeCode];
      var ref = String(it.ref || '');
      if (!c || c.error || c.col.id < 0 || c.col.lat < 0 || c.col.lng < 0 || (ref && c.noteSet[ref])) { skipped++; return; }

      var prefix = typeCode.split('-')[1];
      if (c.maxNum === null) c.maxNum = maxIdNumber(c.data, c.col.id, prefix);
      c.maxNum++;
      var id = formatId(prefix, c.maxNum);
      var row = new Array(c.data[0].length).fill('');
      var set = function(idx, value) { if (idx >= 0) row[idx] = value; };
      set(c.col.id, id);
      set(c.col.name, String(it.name || 'Công trình mới').slice(0, 150));
      set(c.col.ward, sheetWard(it.ward));
      set(c.col.nhom, 'Cấp đô thị');
      set(c.col.lat, "'" + String(Number(it.lat)));
      set(c.col.lng, "'" + String(Number(it.lng)));
      set(c.col.quyMoHT, Number(it.size) > 0 ? Number(it.size) : 0);
      set(c.col.trangThai, false);
      set(c.col.thoiGian, currentTime);
      set(c.col.ghiChu, "Đề xuất từ OpenStreetMap" + (ref ? " (" + ref + ")" : ""));
      if (ref) c.noteSet[ref] = true;
      c.rows.push(row);
      created.push(id);
    });

    Object.keys(ctx).forEach(function(k) {
      var c = ctx[k];
      if (!c || c.error || !c.rows.length) return;
      var start = c.sheet.getLastRow() + 1;
      var width = c.data[0].length;
      ensureSheetSize(c.sheet, start + c.rows.length - 1, width);
      var target = c.sheet.getRange(start, 1, c.rows.length, width);
      if (start > 2) {
        var template = c.sheet.getRange(start - 1, 1, 1, width);
        template.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
        template.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
      }
      target.setValues(c.rows);
      if (c.col.lat >= 0) c.sheet.getRange(start, c.col.lat + 1, c.rows.length, 1).setNumberFormat("@");
      if (c.col.lng >= 0) c.sheet.getRange(start, c.col.lng + 1, c.rows.length, 1).setNumberFormat("@");
      sheets.push(c.sheet.getName() + " (" + c.rows.length + ")");
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  var failed = Object.keys(ctx).filter(function(k) { return ctx[k] && ctx[k].error; })
    .map(function(k) { return k + ": " + ctx[k].error; });
  if (!created.length) {
    return { "error": failed.length ? failed.join("; ") : "Không ghi được dòng nào", "created": 0, "skipped": skipped };
  }
  if (created.length) syncSheetsToGCS();
  return { "success": true, "created": created.length, "skipped": skipped, "sheets": sheets, "script": "osm-tabs-1", "warning": failed.join("; ") };
}

// MẠNG LƯỚI ĐƯỜNG OSM TOÀN THÀNH PHỐ (Admin tải theo phường/xã, máy chủ webapp gửi sang để lưu lên bucket)
// body = { key: "net_phuong-thuan-hoa_0" (1 phần mạng lưới 1 phường) | "index" (chỉ mục + chiều dài đường)
//        | "custom" (tuyến đường hiện trạng Admin vẽ bổ sung), content: JSON } → file roads/v2/<key>.json
function saveRoads(body) {
  var key = String(body.key || '');
  var content = String(body.content || '');
  if (!/^(net_[a-z0-9-]{1,60}_\d{1,2}|index|custom)$/.test(key)) return { "error": "Tên file mạng lưới đường không hợp lệ" };
  if (!content || content.length > 8000000) return { "error": "Dữ liệu mạng lưới đường rỗng hoặc quá lớn" };
  return { "success": true, "saved": uploadToGCS(content, "roads/v2/" + key + ".json") };
}

// MẠNG LƯỚI THOÁT NƯỚC, KHE TỤ THỦY (TopoJSON do scripts/push-thoatnuoc.js gửi) → file drainage/thoatnuoc.topojson (ghi đè)
function saveDrainage(body) {
  var content = String(body.content || '');
  if (!content || content.length > 8000000) return { "error": "Dữ liệu thoát nước rỗng hoặc quá 8 MB" };
  var topo;
  try { topo = JSON.parse(content); } catch (e) { return { "error": "Dữ liệu thoát nước không phải JSON" }; }
  if (!topo || topo.type !== "Topology" || !Array.isArray(topo.arcs)) return { "error": "Dữ liệu thoát nước không phải TopoJSON" };
  return { "success": true, "saved": uploadToGCS(content, "drainage/thoatnuoc.topojson"), "size": content.length };
}

// RANH LƯU VỰC SÔNG + TIỂU LƯU VỰC (TopoJSON do scripts/push-luuvuc.js gửi) → file drainage/luuvuc.topojson (ghi đè)
function saveBasins(body) {
  var content = String(body.content || '');
  if (!content || content.length > 8000000) return { "error": "Dữ liệu lưu vực rỗng hoặc quá 8 MB" };
  var topo;
  try { topo = JSON.parse(content); } catch (e) { return { "error": "Dữ liệu lưu vực không phải JSON" }; }
  if (!topo || topo.type !== "Topology" || !Array.isArray(topo.arcs)) return { "error": "Dữ liệu lưu vực không phải TopoJSON" };
  return { "success": true, "saved": uploadToGCS(content, "drainage/luuvuc.topojson"), "size": content.length };
}

// MŨI TÊN HƯỚNG THOÁT NƯỚC MẶT (scripts/push-huongthoat.js gửi 1 lô) → drainage/huongthoat/<z_x_y>.json theo ô + index.json.
// content = { index: { at, z, tiles: { "12_x_y": số mũi tên } }, tiles: { "12_x_y": { a: [...] } } }; index ghi sau cùng
// để webapp không đọc ô của lần ghi dở. Ô cũ không còn trong index được giữ lại nhưng không bao giờ được tải.
function saveDrainArrows(body) {
  var content = String(body.content || '');
  if (!content || content.length > 4000000) return { "error": "Dữ liệu mũi tên thoát nước rỗng hoặc quá 4 MB" };
  var data;
  try { data = JSON.parse(content); } catch (e) { return { "error": "Dữ liệu mũi tên thoát nước không phải JSON" }; }
  var tiles = data && data.tiles, index = data && data.index;
  if (!tiles || typeof tiles !== "object" || !index || !index.tiles) return { "error": "Thiếu tiles / index" };
  var keys = Object.keys(tiles);
  if (!keys.length || keys.length > 500) return { "error": "Số ô không hợp lệ: " + keys.length };
  for (var i = 0; i < keys.length; i++) {
    if (!/^\d{1,2}_\d{1,6}_\d{1,6}$/.test(keys[i])) return { "error": "Tên ô không hợp lệ: " + keys[i] };
    if (!Object.prototype.hasOwnProperty.call(index.tiles, keys[i])) return { "error": "Ô " + keys[i] + " không có trong index" };
  }
  var failed = [];
  keys.forEach(function (k) {
    if (!uploadToGCS(JSON.stringify(tiles[k]), "drainage/huongthoat/" + k + ".json")) failed.push(k);
  });
  if (failed.length) return { "error": "Không ghi được " + failed.length + " ô: " + failed.slice(0, 5).join(", ") };
  return { "success": true, "saved": uploadToGCS(JSON.stringify(index), "drainage/huongthoat/index.json"), "tiles": keys.length, "size": content.length };
}

// VÙNG HIỆU CHỈNH RASTER DÂN CƯ (Admin vẽ xóa / thêm pixel dân cư) → file pop/edits.json (ghi đè toàn bộ)
function savePopEdits(body) {
  var content = String(body.content || '');
  if (!content || content.length > 2000000) return { "error": "Dữ liệu vùng hiệu chỉnh dân cư rỗng hoặc quá lớn" };
  return { "success": true, "saved": uploadToGCS(content, "pop/edits.json") };
}

function bucketProjectJson(name) {
  return /^projects\/[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(name);
}

function bucketProjectPart(name) {
  return /^projects\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:hien-trang|su-dung-dat|diem-chuc-nang|ranh-gioi)\.json$/.test(name);
}

function bucketDecisionPdf(name) {
  return /^projects\/[a-z0-9]+(?:-[a-z0-9]+)*\/quyet-dinh\.pdf$/.test(name);
}

function bucketObjectNameOk(name) {
  return name === "projects/index.json" || name === "projects/decisions.json" || name === "cad_parcels.json"
    || bucketProjectJson(name) || bucketProjectPart(name);
}

// Vercel dựng nội dung file đồ án; bản này chỉ đẩy lên bucket (không ghi Sheet). Dùng khi service account chưa có quyền ghi.
function putBucketObject(body) {
  var name = String(body.name || "");
  var content = String(body.content || "");
  if (!bucketObjectNameOk(name)) return { "error": "Tên file bucket không hợp lệ" };
  if (!content || content.length > 40000000 || content.charAt(0) !== "{") return { "error": "Nội dung file rỗng, không phải JSON hoặc quá lớn" };
  return { "success": true, "saved": uploadToGCS(content, name) };
}

function putBucketPdf(body) {
  var name = String(body.name || "");
  var b64 = String(body.content || "").replace(/\s+/g, "");
  if (!bucketDecisionPdf(name)) return { "error": "Tên file bucket không hợp lệ" };
  if (!b64 || b64.length > 1500000) return { "error": "PDF rỗng hoặc lớn hơn 1 MB" };
  var bytes;
  try { bytes = Utilities.base64Decode(b64); } catch (err) { return { "error": "PDF không hợp lệ" }; }
  if (!bytes || bytes.length < 5 || bytes.length > 1048576) return { "error": "PDF rỗng hoặc lớn hơn 1 MB" };
  if (bytes[0] !== 37 || bytes[1] !== 80 || bytes[2] !== 68 || bytes[3] !== 70) return { "error": "Không phải file PDF" };
  if (!uploadBytesToGCS(bytes, name, "application/pdf")) return { "error": "Không ghi được PDF lên bucket" };
  return { "success": true, "saved": true };
}

function deleteBucketObject(body) {
  var name = String(body.name || "");
  if (name === "projects/index.json" || name === "projects/decisions.json" || (!bucketProjectJson(name) && !bucketProjectPart(name) && !bucketDecisionPdf(name))) {
    return { "error": "Tên file bucket không hợp lệ" };
  }
  try {
    var token = ScriptApp.getOAuthToken();
    var url = "https://storage.googleapis.com/storage/v1/b/" + BUCKET_NAME + "/o/" + encodeURIComponent(name);
    var res = UrlFetchApp.fetch(url, {
      "method": "delete",
      "headers": { "Authorization": "Bearer " + token },
      "muteHttpExceptions": true
    });
    var code = res.getResponseCode();
    if (code === 200 || code === 204 || code === 404) return { "success": true };
    return { "error": "Xóa file bucket HTTP " + code };
  } catch (err) {
    return { "error": String(err) };
  }
}

// HỒ SƠ FILE CHỜ DUYỆT: người dùng chưa đăng nhập gửi DXF / KML / GeoJSON ≤ 2 MB (máy chủ webapp đã kiểm tra định dạng,
// giới hạn tần suất) → lưu tạm trên bucket pending/cad/<id>.<ext> + danh sách pending/cad/index.json, KHÔNG ghi Sheet.
// Admin mở file trên webapp, kiểm tra rồi ghi bằng importCadBatch; ghi xong / từ chối thì xóa khỏi hàng chờ.
const PENDING_CAD_PREFIX = "pending/cad/";
const PENDING_CAD_MAX_FILES = 30;
const PENDING_CAD_MAX_CHARS = 40000000;
const PENDING_CAD_KEEP_DAYS = 30;

function gcsObjectUrl(objectName) {
  return "https://storage.googleapis.com/storage/v1/b/" + BUCKET_NAME + "/o/" + encodeURIComponent(objectName);
}

function readPendingCadIndex() {
  var res = UrlFetchApp.fetch(gcsObjectUrl(PENDING_CAD_PREFIX + "index.json") + "?alt=media", {
    "headers": { "Authorization": "Bearer " + ScriptApp.getOAuthToken() },
    "muteHttpExceptions": true
  });
  var code = res.getResponseCode();
  if (code === 404) return { "v": 1, "saved": 0, "items": [] };
  if (code !== 200) throw new Error("Không đọc được danh sách hồ sơ chờ duyệt (" + code + ")");
  var data = JSON.parse(res.getContentText());
  return data && Array.isArray(data.items) ? data : { "v": 1, "saved": 0, "items": [] };
}

function writePendingCadIndex(index) {
  index.v = 1;
  index.saved = Date.now();
  return uploadToGCS(JSON.stringify(index), PENDING_CAD_PREFIX + "index.json");
}

function deleteFromGCS(objectName) {
  var res = UrlFetchApp.fetch(gcsObjectUrl(objectName), {
    "method": "delete",
    "headers": { "Authorization": "Bearer " + ScriptApp.getOAuthToken() },
    "muteHttpExceptions": true
  });
  var code = res.getResponseCode();
  return code === 204 || code === 200 || code === 404;
}

function pendingCadObject(it) {
  return PENDING_CAD_PREFIX + it.id + "." + it.ext;
}

// body = { meta: { id, ext, fileName, phase, crs, sender, note, summary }, content: nội dung file }
function addPendingCad(body) {
  var meta = body.meta || {};
  var content = String(body.content || '');
  if (!/^[a-f0-9]{24}$/.test(String(meta.id || '')) || ["dxf", "kml", "geojson"].indexOf(meta.ext) < 0) {
    return { "error": "Hồ sơ không hợp lệ" };
  }
  if (!content || content.length > 2200000) return { "error": "File rỗng hoặc vượt quá 2 MB" };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var index = readPendingCadIndex();
    var now = Date.now();
    var keepMs = PENDING_CAD_KEEP_DAYS * 86400000;
    var expired = index.items.filter(function(it) { return now - Number(it.at || 0) > keepMs; });
    expired.forEach(function(it) { deleteFromGCS(pendingCadObject(it)); });
    index.items = index.items.filter(function(it) { return now - Number(it.at || 0) <= keepMs; });

    var total = index.items.reduce(function(s, it) { return s + Number(it.size || 0); }, 0);
    if (index.items.length >= PENDING_CAD_MAX_FILES || total + content.length > PENDING_CAD_MAX_CHARS) {
      if (expired.length) writePendingCadIndex(index);
      return { "success": true, "saved": false, "full": true };
    }
    if (!uploadToGCS(content, pendingCadObject(meta))) return { "error": "Không ghi được file lên bucket" };
    meta.size = content.length;
    meta.at = now;
    index.items.push(meta);
    if (!writePendingCadIndex(index)) {
      deleteFromGCS(pendingCadObject(meta));
      return { "error": "Không ghi được danh sách hồ sơ chờ duyệt" };
    }
    return { "success": true, "saved": true, "count": index.items.length };
  } finally {
    lock.releaseLock();
  }
}

// body = { id } — Admin đã ghi file vào Sheet hoặc từ chối
function removePendingCad(body) {
  var id = String(body.id || '');
  if (!/^[a-f0-9]{24}$/.test(id)) return { "error": "Mã hồ sơ không hợp lệ" };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var index = readPendingCadIndex();
    var it = index.items.filter(function(x) { return x.id === id; })[0];
    if (!it) return { "success": true, "removed": false, "count": index.items.length };
    index.items = index.items.filter(function(x) { return x.id !== id; });
    if (!writePendingCadIndex(index)) return { "error": "Không ghi được danh sách hồ sơ chờ duyệt" };
    deleteFromGCS(pendingCadObject(it));
    return { "success": true, "removed": true, "count": index.items.length };
  } finally {
    lock.releaseLock();
  }
}

// ĐỐI CHIẾU PHƯỜNG: dấu nhắc trong cột Note, VD "⚠ Phường/xã theo tọa độ: Thuận Hóa" (các mục trong Note cách nhau " | ")
const WARD_NOTE_PREFIX = "⚠ Phường/xã theo tọa độ:";

function splitNote(note) {
  return String(note || '').split('|').map(function(s) { return s.trim(); }).filter(function(s) { return s !== ''; });
}

// Note sau khi thay dấu nhắc cũ bằng mark ('' = chỉ gỡ); giữ nguyên các ghi chú khác
function noteWithWardMark(note, mark, prefix) {
  var parts = splitNote(note).filter(function(s) { return s.indexOf(prefix) !== 0; });
  if (mark) parts.push(mark);
  return parts.join(' | ');
}

function wardMarkOf(note, prefix) {
  var parts = splitNote(note).filter(function(s) { return s.indexOf(prefix) === 0; });
  return parts.length ? parts[parts.length - 1] : '';
}

function wardKey(s) {
  return String(s || '').normalize('NFC').replace(/^\s*(Phường|Xã|Thị trấn)\s+/i, '').trim().toLowerCase();
}

// Sửa tay trên Sheet: Ten_XaPhuong đã khớp dấu nhắc → gỡ; sửa tọa độ → gỡ (lần kiểm tra sau trên webapp sẽ ghi lại nếu vẫn lệch)
function clearFixedWardMark(sheet, row, col, coordChanged) {
  var cell = sheet.getRange(row, col.ghiChu + 1);
  var note = String(cell.getValue() || '');
  var mark = wardMarkOf(note, WARD_NOTE_PREFIX);
  if (!mark) return;
  var fixed = coordChanged
    || (col.ward >= 0 && wardKey(sheet.getRange(row, col.ward + 1).getValue()) === wardKey(mark.slice(WARD_NOTE_PREFIX.length)));
  if (fixed) cell.setValue(noteWithWardMark(note, '', WARD_NOTE_PREFIX));
}

/**
 * Máy chủ webapp gửi danh sách công trình có Ten_XaPhuong khác phường theo tọa độ: body = { prefix, items: [{ id, note }] }.
 * Dòng có trong danh sách → ghi / thay dấu nhắc; dòng không còn trong danh sách mà Note còn dấu cũ → gỡ.
 * Chỉ ghi lại cột Note của tab có thay đổi (1 lần / tab), rồi đồng bộ bucket.
 */
function markWardNotes(body) {
  var prefix = String(body.prefix || WARD_NOTE_PREFIX);
  var want = {};
  (Array.isArray(body.items) ? body.items : []).forEach(function(it) {
    var id = String(it.id || '').trim();
    var note = String(it.note || '').trim();
    if (id && note.indexOf(prefix) === 0) want[id] = note.slice(0, 200);
  });
  var marked = 0, cleared = 0, noNoteColumn = [];
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ss.getSheets().forEach(function(sheet) {
      if (!isValidInfraSheet(sheet.getName())) return;
      var data = sheet.getDataRange().getValues();
      if (data.length <= 1) return;
      var col = getColumnMap(data[0]);
      if (col.id < 0) return;
      if (col.ghiChu < 0) {
        var hasWanted = data.some(function(row, i) { return i > 0 && want[String(row[col.id] || '').trim()]; });
        if (hasWanted) noNoteColumn.push(sheet.getName());
        return;
      }
      var changed = false;
      var notes = data.slice(1).map(function(row) {
        var id = String(row[col.id] || '').trim();
        var note = String(row[col.ghiChu] || '');
        var mark = want[id] || '';
        if (mark === wardMarkOf(note, prefix)) return [note];
        changed = true;
        if (mark) marked++; else cleared++;
        return [noteWithWardMark(note, mark, prefix)];
      });
      if (changed) sheet.getRange(2, col.ghiChu + 1, notes.length, 1).setValues(notes);
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  if (marked || cleared) syncSheetsToGCS();
  return { "success": true, "marked": marked, "cleared": cleared, "noNoteColumn": noNoteColumn };
}

/**
 * Admin sửa 1 công trình từ bảng thông tin lô trên bản đồ: body = { id, fields: { name, nhom, quyMoHT, quyMoQH, plan, note } }.
 * Chỉ ghi khóa có trong fields; '' xóa ô (quy mô trống = giai đoạn đó không có công trình).
 * Ghi từng ô (không ghi lại cả dòng) để giữ định dạng văn bản của Latitude / Longitude và công thức ở cột khác.
 */
function editInfraRow(body) {
  var id = String(body.id || '').trim();
  var f = body.fields || {};
  if (!id) return { "error": "Thiếu ID công trình" };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var currentTime = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss");
  var found = '';
  var missing = [];

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheets = ss.getSheets();
    for (var s = 0; s < sheets.length && !found; s++) {
      var sheet = sheets[s];
      if (!isValidInfraSheet(sheet.getName())) continue;
      var data = sheet.getDataRange().getValues();
      if (data.length <= 1) continue;
      var col = getColumnMap(data[0]);
      if (col.id < 0) continue;
      for (var r = 1; r < data.length; r++) {
        if (String(data[r][col.id] || '').trim() !== id) continue;
        if (f.plan) {
          ensurePlanColumns(sheet);
          col = getColumnMap(getSheetHeaders(sheet));
        }
        var put = function(key, value) {
          if (col[key] < 0) { missing.push(key); return; }
          sheet.getRange(r + 1, col[key] + 1).setValue(value);
        };
        if (f.hasOwnProperty('name')) put('name', String(f.name));
        if (f.hasOwnProperty('nhom')) put('nhom', sheetNhom(f.nhom));
        if (f.hasOwnProperty('quyMoHT')) put('quyMoHT', f.quyMoHT === '' ? '' : parseCleanNumber(f.quyMoHT));
        if (f.hasOwnProperty('quyMoQH')) put('quyMoQH', f.quyMoQH === '' ? '' : parseCleanNumber(f.quyMoQH));
        if (f.plan) {
          Object.keys(PLAN_KEYS).forEach(function(k) {
            if (f.plan.hasOwnProperty(k)) put(PLAN_KEYS[k], planValue(f.plan[k]));
          });
        }
        if (f.hasOwnProperty('note')) put('ghiChu', String(f.note));
        if (col.thoiGian >= 0) sheet.getRange(r + 1, col.thoiGian + 1).setValue(currentTime);
        found = sheet.getName();
        break;
      }
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  if (!found) return { "error": "Không tìm thấy ID công trình: " + id };
  syncSheetsToGCS(false);
  return { "success": true, "id": id, "tab": found, "missing": missing };
}

/**
 * Admin xóa 1 công trình từ bảng thông tin lô: body = { id }. Xóa dòng ID và các dòng phần vắt ranh <ID>.2, <ID>.3…
 * ở mọi tab hạ tầng, ranh cũ cùng ID ở CAD_Polygon và bản sao lưu đồ án của ID (không còn dòng để ghi trả khi xóa đồ án).
 */
function deleteInfraRow(body) {
  var id = String(body.id || '').trim();
  if (!id) return { "error": "Thiếu ID công trình" };
  var isMine = function(v) {
    var s = String(v || '').trim();
    return s === id || (s.indexOf(id + '.') === 0 && /^\d+$/.test(s.slice(id.length + 1)));
  };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rowsDeleted = 0;
  var tabs = [];

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ss.getSheets().forEach(function(sheet) {
      if (!isValidInfraSheet(sheet.getName()) || sheet.getLastRow() < 2) return;
      var data = sheet.getDataRange().getValues();
      var col = getColumnMap(data[0]);
      if (col.id < 0) return;
      var rows = [];
      for (var r = 1; r < data.length; r++) if (isMine(data[r][col.id])) rows.push(r + 1);
      if (!rows.length) return;
      deleteRowBlocks(sheet, rows);
      rowsDeleted += rows.length;
      tabs.push(sheet.getName());
    });
    if (!rowsDeleted) return { "error": "Không tìm thấy ID công trình: " + id };

    var cad = ss.getSheetByName(CAD_SHEET_NAME);
    if (cad && cad.getLastRow() > 1) {
      var cadRows = [];
      cad.getRange(2, 1, cad.getLastRow() - 1, 1).getValues().forEach(function(v, i) { if (isMine(v[0])) cadRows.push(i + 2); });
      deleteRowBlocks(cad, cadRows);
    }
    var bak = ss.getSheetByName(BACKUP_SHEET_NAME);
    if (bak && bak.getLastRow() > 1) {
      var idCol = BACKUP_HEADERS.indexOf("ID_DoiTuong");
      var bakRows = [];
      bak.getRange(2, idCol + 1, bak.getLastRow() - 1, 1).getValues().forEach(function(v, i) { if (isMine(v[0])) bakRows.push(i + 2); });
      deleteRowBlocks(bak, bakRows);
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  syncSheetsToGCS(false);
  return { "success": true, "id": id, "rows": rowsDeleted, "tabs": tabs };
}

// Một đồ án (Ten_QH) một tab DXF-NN. Nhập lại cùng đồ án thì thay toàn bộ dòng đất của tab đó.
function ensureDxfSheet(ss, project) {
  var sheets = ss.getSheets();
  var maxN = 0;
  var empty = null;
  var found = null;
  sheets.forEach(function(sh) {
    var m = String(sh.getName()).trim().match(/^DXF-(\d+)$/i);
    if (!m) return;
    var n = parseInt(m[1], 10);
    if (n > maxN) maxN = n;
    if (sh.getLastRow() < 2) { if (!empty) empty = sh; return; }
    var col = getColumnMap(getSheetHeaders(sh));
    if (col.tenQH < 0 || found) return;
    var val = String(sh.getRange(2, col.tenQH + 1).getValue() || '').trim();
    if (val === project) found = sh;
  });
  if (found) return found;
  if (empty) return empty;
  var name = 'DXF-' + ('0' + (maxN + 1)).slice(-2);
  var sheet = ss.insertSheet(name);
  sheet.getRange(1, 1, 1, STANDARD_HEADERS.length).setValues([STANDARD_HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

// reset = true ở phần đầu tiên của 1 lần nhập: xóa dòng cũ của đồ án rồi ghi lại; các phần sau ghi nối tiếp
function writeDxfLands(ss, lands, project, phase, currentTime, reset) {
  if (!Array.isArray(lands) || !lands.length) return 0;
  var sheet = ensureDxfSheet(ss, project);
  var headers = getSheetHeaders(sheet);
  if (headers.length < STANDARD_HEADERS.length) {
    ensureSheetSize(sheet, 1, STANDARD_HEADERS.length);
    sheet.getRange(1, 1, 1, STANDARD_HEADERS.length).setValues([STANDARD_HEADERS]).setFontWeight('bold');
    headers = STANDARD_HEADERS.slice();
  }
  var col = getColumnMap(headers);
  if (reset && sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
  var width = headers.length;
  var ph = phase === 'QH' ? 'QH' : 'HT';
  var start = reset ? 2 : Math.max(2, sheet.getLastRow() + 1);
  var maxNum = start > 2 ? maxIdNumber(sheet.getRange(1, 1, start - 1, width).getValues(), col.id, 'DXF') : 0;
  var rows = lands.map(function(it, i) {
    var row = new Array(width).fill('');
    var set = function(idx, value) { if (idx >= 0 && idx < width) row[idx] = value; };
    set(col.id, formatId('DXF', maxNum + i + 1));
    set(col.name, String(it.name || it.layer || 'Lô đất').slice(0, 150));
    set(col.ward, sheetWard(it.ward));
    set(col.nhom, String(it.nhom || 'Đất khác').slice(0, 40));
    set(col.lat, Number(it.lat));
    set(col.lng, Number(it.lng));
    // Hồ sơ thẩm định gồm cả HT và QH: giai đoạn theo từng lô, không có thì theo tên file / ô Giai đoạn
    var lp = it.phase === 'QH' || it.phase === 'HT' ? it.phase : ph;
    if (lp === 'QH') set(col.quyMoQH, Number(it.area) || 0);
    else set(col.quyMoHT, Number(it.area) || 0);
    set(col.tenQH, project);
    set(col.trangThai, true);
    set(col.thoiGian, currentTime);
    set(col.ghiChu, 'Layer ' + String(it.layer || ''));
    set(col.geojson, geoCell(it.geometry));
    eachPlanValue(it.plan, col, set);
    return row;
  });
  ensureSheetSize(sheet, start + rows.length - 1, width);
  sheet.getRange(start, 1, rows.length, width).setValues(rows);
  return rows.length;
}

// Ranh lô theo (ID_DoiTuong, GiaiDoan): đã có thì ghi đè, chưa có thì thêm dòng. Dòng cũ chưa có GiaiDoan coi là HT
function upsertCadPolygons(ss, polygons, fileName, currentTime, phase) {
  if (!polygons.length) return;
  var sheet = ss.getSheetByName(CAD_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CAD_SHEET_NAME);
    sheet.setFrozenRows(1);
  }
  sheet.getRange(1, 1, 1, CAD_HEADERS.length).setValues([CAD_HEADERS]);

  var last = sheet.getLastRow();
  var rowOf = {};
  if (last > 1) {
    sheet.getRange(2, 1, last - 1, CAD_HEADERS.length).getValues().forEach(function(v, i) {
      var id = String(v[0] || '').trim();
      var ph = String(v[6] || '').trim().toUpperCase() === 'QH' ? 'QH' : 'HT';
      if (id) rowOf[id + '|' + ph] = i + 2;
    });
  }

  var appends = [];
  polygons.forEach(function(p) {
    var ph = p.phase === 'QH' || p.phase === 'HT' ? p.phase : phase;
    var values = [p.id, p.layer, p.area, fileName, currentTime, JSON.stringify(p.geometry), ph];
    var r = rowOf[p.id + '|' + ph];
    if (r) sheet.getRange(r, 1, 1, values.length).setValues([values]);
    else appends.push(values);
  });
  if (appends.length) {
    var start = sheet.getLastRow() + 1;
    ensureSheetSize(sheet, start + appends.length - 1, CAD_HEADERS.length);
    sheet.getRange(start, 6, appends.length, 1).setNumberFormat("@");
    sheet.getRange(start, 1, appends.length, CAD_HEADERS.length).setValues(appends);
  }
}

function projectHeaderRow(sheet) {
  var n = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, 1, n).getValues()[0].map(function(h) { return String(h || '').trim(); });
}

function projectCol(headers, name) {
  var i = headers.indexOf(name);
  return i < 0 ? 0 : i + 1;
}

// Sheet cũ chưa có LinkQD: chèn cột ngay sau Ten_QH, không đẩy lệch dữ liệu các cột kia.
function ensureProjectSheet(ss) {
  var sheet = ss.getSheetByName(PROJECT_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(PROJECT_SHEET_NAME);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, PROJECT_HEADERS.length).setValues([PROJECT_HEADERS]).setFontWeight('bold');
    return sheet;
  }
  var headers = projectHeaderRow(sheet);
  if (!headers[0]) {
    sheet.getRange(1, 1, 1, PROJECT_HEADERS.length).setValues([PROJECT_HEADERS]).setFontWeight('bold');
    return sheet;
  }
  if (headers.indexOf(PROJECT_LINK_HEADER) < 0 && headers[0] === "Ten_QH") {
    sheet.insertColumnAfter(1);
    sheet.getRange(1, 2).setValue(PROJECT_LINK_HEADER).setFontWeight('bold');
    headers = projectHeaderRow(sheet);
  }
  // Sheet cũ chưa có cột dân số: thêm vào cuối hàng tiêu đề
  var missing = PROJECT_POP_HEADERS.filter(function(h) { return headers.indexOf(h) < 0; });
  if (missing.length) {
    var start = headers.length + 1;
    ensureSheetSize(sheet, 1, start + missing.length - 1);
    sheet.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
  }
  return sheet;
}

function projectRowOf(sheet, headers, project) {
  var nameCol = projectCol(headers, "Ten_QH");
  var last = sheet.getLastRow();
  if (nameCol && last > 1) {
    var names = sheet.getRange(2, nameCol, last - 1, 1).getValues();
    for (var i = 0; i < names.length; i++) {
      if (String(names[i][0] || '').trim() === project) return i + 2;
    }
  }
  return 0;
}

// reg = { boundary (GeoJSON ranh tổng), wards: [tên phường], infra, lands, popHT, popQH } — nhập lại cùng đồ án thì ghi đè dòng cũ,
// giữ LinkQD; dân số 0 / thiếu thì giữ ô cũ
function upsertProjectRegistry(ss, project, fileName, reg, currentTime) {
  var sheet = ensureProjectSheet(ss);
  var headers = projectHeaderRow(sheet);
  var row = projectRowOf(sheet, headers, project);
  var isNew = !row;
  if (isNew) row = Math.max(sheet.getLastRow(), 1) + 1;
  ensureSheetSize(sheet, row, Math.max(headers.length, PROJECT_HEADERS.length));
  var fields = {
    "Ten_QH": project,
    "File": fileName || project,
    "Phuong": (Array.isArray(reg.wards) ? reg.wards : []).join(', '),
    "SoCongTrinh": Number(reg.infra) || 0,
    "SoLoDat": Number(reg.lands) || 0,
    "ThoiGianNhap": currentTime,
    "Geojson": geoCell(reg.boundary)
  };
  if (isNew) fields[PROJECT_LINK_HEADER] = '';
  if (Number(reg.popHT) > 0) fields["DanSoHT"] = Math.round(Number(reg.popHT));
  if (Number(reg.popQH) > 0) fields["DanSoQH"] = Math.round(Number(reg.popQH));
  var geoCol = projectCol(headers, "Geojson");
  if (geoCol) sheet.getRange(row, geoCol).setNumberFormat("@");
  Object.keys(fields).forEach(function(h) {
    var c = projectCol(headers, h);
    if (c) sheet.getRange(row, c).setValue(fields[h]);
  });
}

// Ghi hoặc xóa link truy cập quyết định (cột LinkQD). link rỗng = xóa ô.
function setProjectLink(body) {
  var project = String(body.project || '').trim();
  var link = String(body.link || '').trim();
  if (!project) return { "error": "Thiếu tên đồ án" };
  if (link.length > 2000) return { "error": "Link quá dài" };
  if (link && !/^https?:\/\//i.test(link)) return { "error": "Link không hợp lệ" };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ensureProjectSheet(ss);
    var headers = projectHeaderRow(sheet);
    var nameCol = projectCol(headers, "Ten_QH");
    var linkCol = projectCol(headers, PROJECT_LINK_HEADER);
    if (!nameCol || !linkCol) return { "error": "Sheet DS_DoAn thiếu cột LinkQD" };
    var row = projectRowOf(sheet, headers, project);
    if (!row) {
      row = Math.max(sheet.getLastRow(), 1) + 1;
      ensureSheetSize(sheet, row, headers.length);
      sheet.getRange(row, nameCol).setValue(project);
    }
    sheet.getRange(row, linkCol).setValue(link);
    return { "success": true, "row": row };
  } catch (err) {
    return { "error": String(err) };
  } finally {
    lock.releaseLock();
  }
}

// Xóa các dòng (số dòng 1-based, tăng dần) theo từng khối liền nhau, từ dưới lên.
// Sheet không cho xóa hết mọi dòng không cố định: xóa tới dòng cuối thì chèn thêm 1 dòng trống trước
function deleteRowBlocks(sheet, rows) {
  var k = rows.length - 1;
  while (k >= 0) {
    var end = rows[k];
    var start = end;
    while (k > 0 && rows[k - 1] === start - 1) { k--; start--; }
    if (end >= sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
    sheet.deleteRows(start, end - start + 1);
    k--;
  }
}

// { keys: { "tab|id": true }, rows: [{ row, key, values, geojson }] sao lưu sẵn có của đồ án, pending: hàng chờ ghi }
function readProjectBackup(ss, project) {
  var out = { keys: {}, rows: [], pending: [] };
  var sheet = ss.getSheetByName(BACKUP_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return out;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, BACKUP_HEADERS.length).getValues().forEach(function(v, i) {
    if (String(v[0] || '').trim() !== project) return;
    var key = String(v[1]).trim() + '|' + String(v[2]).trim();
    out.keys[key] = true;
    out.rows.push({ row: i + 2, key: key, values: v[4], geojson: v[5] });
  });
  return out;
}

function snapshotRow(backup, c, r, project, currentTime) {
  var tab = String(c.sheet.getName()).trim();
  var id = String(cellAt(c.data[r], c.col.id) || '').trim();
  var key = tab + '|' + id;
  if (!id || backup.keys[key]) return;
  var headers = c.data[0];
  var formulas = c.sheet.getRange(r + 1, 1, 1, headers.length).getFormulas()[0];
  var old = {};
  BACKUP_COL_KEYS.forEach(function(k) {
    var idx = c.col[k];
    if (idx === undefined || idx < 0) return;
    var v = c.data[r][idx];
    old[String(headers[idx]).trim()] = formulas[idx] ? { f: formulas[idx] } : v instanceof Date ? { d: v.toISOString() } : { v: v };
  });
  var geo = '';
  if (c.col.geojson >= 0 && !formulas[c.col.geojson]) {
    old[String(headers[c.col.geojson]).trim()] = { g: true };
    geo = String(c.data[r][c.col.geojson] || '');
  }
  backup.keys[key] = true;
  backup.pending.push([project, tab, id, currentTime, JSON.stringify(old), geo]);
}

function appendProjectBackup(ss, backup) {
  if (!backup.pending.length) return;
  var sheet = ss.getSheetByName(BACKUP_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(BACKUP_SHEET_NAME);
    sheet.getRange(1, 1, 1, BACKUP_HEADERS.length).setValues([BACKUP_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  var start = sheet.getLastRow() + 1;
  ensureSheetSize(sheet, start + backup.pending.length - 1, BACKUP_HEADERS.length);
  sheet.getRange(start, 5, backup.pending.length, 2).setNumberFormat("@");
  sheet.getRange(start, 1, backup.pending.length, BACKUP_HEADERS.length).setValues(backup.pending);
  backup.pending = [];
}

// Ghi trả giá trị cũ theo tên cột (cột đã đổi chỗ vẫn đúng; cột đã bị xóa thì bỏ qua)
function restoreRow(sheet, headers, rowNum, entry) {
  var old;
  try { old = JSON.parse(entry.values || '{}'); } catch (e) { return false; }
  Object.keys(old).forEach(function(h) {
    var idx = headers.indexOf(h);
    if (idx < 0) return;
    var cell = sheet.getRange(rowNum, idx + 1);
    var o = old[h] || {};
    if (o.g) cell.setValue(String(entry.geojson || ''));
    else if (o.f) cell.setFormula(o.f);
    else if (o.d) cell.setValue(new Date(o.d));
    else cell.setValue(o.v === undefined || o.v === null ? '' : o.v);
  });
  return true;
}

/**
 * Xóa toàn bộ 1 đồ án (body.project = Ten_QH) ở các tab hạ tầng: dòng do đồ án tạo (kể cả dòng mảnh phường) bị xóa;
 * dòng có sẵn mà đồ án đã ghi đè (có sao lưu ở DoAn_SaoLuu) được ghi trả giá trị cũ. Xóa thêm tab DXF-NN của đồ án,
 * ranh CAD_Polygon của các dòng bị xóa / nhập từ file đồ án, dòng DS_DoAn và sao lưu của đồ án.
 */
function deleteProject(body) {
  var project = String(body.project || '').trim();
  if (!project) return { "error": "Thiếu tên đồ án" };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ids = {};
  var infra = 0, lands = 0, polygons = 0, restored = 0;
  var tabs = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var backup = readProjectBackup(ss, project);
    var entryOf = {};
    backup.rows.forEach(function(e) { entryOf[e.key] = e; });
    ss.getSheets().forEach(function(sheet) {
      var name = String(sheet.getName()).trim();
      var dxf = /^DXF-\d+$/i.test(name);
      if ((!dxf && !isValidInfraSheet(name)) || sheet.getLastRow() < 2) return;
      var data = sheet.getDataRange().getValues();
      var col = getColumnMap(data[0]);
      if (col.tenQH < 0) return;
      var headers = data[0].map(function(h) { return String(h).trim(); });
      var rows = [];
      for (var r = 1; r < data.length; r++) {
        if (String(data[r][col.tenQH] || '').trim() !== project) continue;
        if (!dxf && col.id >= 0) {
          var id = String(data[r][col.id] || '').trim();
          var entry = entryOf[name + '|' + id];
          if (entry && restoreRow(sheet, headers, r + 1, entry)) { restored++; continue; }
          ids[id] = true;
        }
        rows.push(r + 1);
      }
      if (!rows.length) return;
      if (dxf) lands += rows.length; else infra += rows.length;
      if (dxf && rows.length === data.length - 1) {
        ss.deleteSheet(sheet);
        tabs.push(name);
        return;
      }
      deleteRowBlocks(sheet, rows);
    });

    var cad = ss.getSheetByName(CAD_SHEET_NAME);
    if (cad && cad.getLastRow() > 1) {
      var cadRows = [];
      cad.getRange(2, 1, cad.getLastRow() - 1, CAD_HEADERS.length).getValues().forEach(function(v, i) {
        if (ids[String(v[0] || '').trim()] || projectTitle(v[3]) === project) cadRows.push(i + 2);
      });
      deleteRowBlocks(cad, cadRows);
      polygons = cadRows.length;
    }

    var reg = ss.getSheetByName(PROJECT_SHEET_NAME);
    if (reg && reg.getLastRow() > 1) {
      var regRows = [];
      reg.getRange(2, 1, reg.getLastRow() - 1, 1).getValues().forEach(function(v, i) {
        if (String(v[0] || '').trim() === project) regRows.push(i + 2);
      });
      deleteRowBlocks(reg, regRows);
    }

    var bak = ss.getSheetByName(BACKUP_SHEET_NAME);
    if (bak && backup.rows.length) deleteRowBlocks(bak, backup.rows.map(function(e) { return e.row; }));
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  syncSheetsToGCS(body.syncCad !== false);
  return { "success": true, "infra": infra, "restored": restored, "lands": lands, "polygons": polygons, "tabs": tabs };
}

// Ghi đè các ô của 1 cột (từ dòng 2) mà next(value) trả chuỗi mới; next trả null = giữ. Ghi theo từng đoạn dòng liền nhau
function rewriteColumn(sheet, colIdx, next) {
  if (!sheet || colIdx < 0 || sheet.getLastRow() < 2) return 0;
  var vals = sheet.getRange(2, colIdx + 1, sheet.getLastRow() - 1, 1).getValues();
  var changed = 0, start = -1;
  var flush = function(end) {
    if (start < 0) return;
    sheet.getRange(start + 2, colIdx + 1, end - start, 1).setValues(vals.slice(start, end));
    start = -1;
  };
  for (var i = 0; i < vals.length; i++) {
    var v = next(vals[i][0]);
    if (v === null) { flush(i); continue; }
    vals[i][0] = v;
    changed++;
    if (start < 0) start = i;
  }
  flush(vals.length);
  return changed;
}

/**
 * Đổi tên đồ án (body.project → body.newName) ở mọi nơi Sheet dùng Ten_QH làm khóa: tab hạ tầng, tab DXF-NN, DS_DoAn,
 * DoAn_SaoLuu; cột File của CAD_Polygon (deleteProject nhận ranh lô theo tên file). Gọi lại lần 2 không đổi gì thêm.
 */
function renameProject(body) {
  var project = String(body.project || '').trim();
  var newName = String(body.newName || '').trim();
  if (!project || !newName) return { "error": "Thiếu tên đồ án" };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var same = function(v) { return String(v || '').trim() === project ? newName : null; };
  var infra = 0, lands = 0, registry = 0, backups = 0, polygons = 0;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ss.getSheets().forEach(function(sheet) {
      var name = String(sheet.getName()).trim();
      var dxf = /^DXF-\d+$/i.test(name);
      if ((!dxf && !isValidInfraSheet(name)) || sheet.getLastRow() < 2) return;
      var col = getColumnMap(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
      var n = rewriteColumn(sheet, col.tenQH, same);
      if (dxf) lands += n; else infra += n;
    });
    registry = rewriteColumn(ss.getSheetByName(PROJECT_SHEET_NAME), 0, same);
    backups = rewriteColumn(ss.getSheetByName(BACKUP_SHEET_NAME), 0, same);
    polygons = rewriteColumn(ss.getSheetByName(CAD_SHEET_NAME), CAD_HEADERS.indexOf("File"), function(v) {
      var file = String(v || '').trim();
      if (projectTitle(file) !== project) return null;
      var at = file.lastIndexOf(project);
      return file.slice(0, at) + newName + file.slice(at + project.length);
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  if (infra || lands) syncSheetsToGCS(false);
  return { "success": true, "infra": infra, "lands": lands, "registry": registry, "backups": backups, "polygons": polygons };
}
