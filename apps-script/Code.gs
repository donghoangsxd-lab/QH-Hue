// =========================================================================
// GOOGLE APPS SCRIPT: HTXH-HUE (TỐI ƯU BATCH IN-MEMORY & LOCKSERVICE)
// Quy mô tách 2 cột: QuyMo_HT (hiện trạng) & QuyMo_QH (quy hoạch)
// Nhập hàng loạt từ DXF: doPost action=importCadBatch, ranh lô lưu ở tab CAD_Polygon → cad_parcels.json
// =========================================================================

const BUCKET_NAME = "hue-infra-data-us";
const GEOJSON_FILE_NAME = "infrastructure_hue.json";
const CAD_FILE_NAME = "cad_parcels.json";
const CAD_SHEET_NAME = "CAD_Polygon";
const CAD_HEADERS = ["ID_DoiTuong", "Layer", "DienTich", "File", "ThoiGianNhap", "GeoJSON", "GiaiDoan"];
const VALID_PREFIXES = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM", "9-CSD"];

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
  banKinh: ['bankinh'],
  trangThai: ['trangthai'],
  thoiGian: ['thoigiancapnhat'],
  ghiChu: ['note', 'ghichu']
};

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
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var id = String(row[col.id] || '').trim();
      var name = String(cellAt(row, col.name) || '').trim();
      if (id === '' && name === '') continue;

      var lat = parseCleanNumber(row[col.lat]);
      var lng = parseCleanNumber(row[col.lng]);
      if (lat === 0 || lng === 0) continue;

      var quyMoHT = parseOptionalNumber(cellAt(row, col.quyMoHT));
      var rawStatus = cellAt(row, col.trangThai);
      count++;
      features.push({
        "type": "Feature",
        "geometry": { "type": "Point", "coordinates": [lng, lat] },
        "properties": {
          "ID_DoiTuong": id,
          "Ten_CongTrinh": name,
          "Ten_XaPhuong": String(cellAt(row, col.ward) || ''),
          "Nhom_HaTang": String(cellAt(row, col.nhom) || ''),
          "QuyMo_HT": quyMoHT,
          "QuyMo_QH": parseOptionalNumber(cellAt(row, col.quyMoQH)),
          "QuyMo_S": quyMoHT || 0, // giữ cho webapp bản cũ, bằng quy mô hiện trạng
          "BanKinh": parseOptionalNumber(cellAt(row, col.banKinh)), // trống → null: webapp chỉ đối chiếu khi Sheet có nhập
          "TrangThai": String(rawStatus === undefined || rawStatus === null ? 'TRUE' : rawStatus).toUpperCase(),
          "ThoiGianCapNhat": String(cellAt(row, col.thoiGian) || ''),
          "GhiChu": String(cellAt(row, col.ghiChu) || '')
        }
      });
    }
    Logger.log("✓ Tab '" + sheetName + "': Đóng gói " + count + " điểm!");
  });

  return features;
}

// RANH LÔ ĐẤT (TAB CAD_Polygon) → GEOJSON; chỉ giữ lô còn công trình ở các tab hạ tầng. Không có tab → null
function collectCadFeatures(ss, pointFeatures) {
  var sheet = ss.getSheetByName(CAD_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) return null;

  var live = {};
  pointFeatures.forEach(function(f) { live[f.properties.ID_DoiTuong] = true; });

  var data = sheet.getDataRange().getValues();
  var col = {};
  data[0].map(normalizeHeader).forEach(function(h, i) { col[h] = i; });
  if (col.id_doituong === undefined || col.geojson === undefined) return null;

  var out = [];
  for (var i = 1; i < data.length; i++) {
    var id = String(data[i][col.id_doituong] || '').trim();
    if (!id || !live[id]) continue;
    var geom = null;
    try { geom = JSON.parse(String(data[i][col.geojson] || '')); } catch (e) { geom = null; }
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;
    out.push({
      "type": "Feature",
      "geometry": geom,
      "properties": {
        "ID_DoiTuong": id,
        "Layer": String(cellAt(data[i], col.layer === undefined ? -1 : col.layer) || ''),
        "DienTich": parseCleanNumber(cellAt(data[i], col.dientich === undefined ? -1 : col.dientich)),
        "File": String(cellAt(data[i], col.file === undefined ? -1 : col.file) || ''),
        "ThoiGianNhap": String(cellAt(data[i], col.thoigiannhap === undefined ? -1 : col.thoigiannhap) || ''),
        "GiaiDoan": String(cellAt(data[i], col.giaidoan === undefined ? -1 : col.giaidoan) || '').trim().toUpperCase() === 'QH' ? 'QH' : 'HT'
      }
    });
  }
  Logger.log("✓ Tab '" + CAD_SHEET_NAME + "': Đóng gói " + out.length + " ranh lô!");
  return out;
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

// 1. TỰ ĐỘNG ĐÓNG GÓI GEOJSON VÀ UPLOAD LÊN BUCKET (XỬ LÝ MẢNG IN-MEMORY)
function syncSheetsToGCS() {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    Logger.log("=== BẮT ĐẦU ĐỒNG BỘ DỮ LIỆU SANG GCS ===");
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var features = collectFeatures(ss);
    Logger.log("📊 TỔNG SỐ DỮ LIỆU ĐÓNG GÓI BẢN ĐỒ: " + features.length);
    uploadToGCS(JSON.stringify({ "type": "FeatureCollection", "features": features }));

    var cadFeatures = collectCadFeatures(ss, features);
    if (cadFeatures) {
      uploadToGCS(JSON.stringify({ "type": "FeatureCollection", "features": cadFeatures }), CAD_FILE_NAME);
    }

  } catch (err) {
    Logger.log("❌ Lỗi syncSheetsToGCS: " + err.toString());
  } finally {
    lock.releaseLock();
  }
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
    var isCsdSheet = sheetName.indexOf("9-CSD") === 0;
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
      var typeCode = params.type || "9-CSD";
      var name = params.name || "Công trình mới";
      var ward = sheetWard(params.ward) || "Thuận Hóa";
      var phase = String(params.phase || 'HT').toUpperCase() === 'QH' ? 'QH' : 'HT';

      var latStr = String(params.lat || '0').replace(',', '.');
      var lngStr = String(params.lng || '0').replace(',', '.');
      var size = parseCleanNumber(params.size);
      // Bán kính theo QCVN 01:2026 do máy chủ webapp tính (cấp đô thị / đơn vị ở, phường / xã); trống = không có vùng phục vụ
      var radius = parseCleanNumber(params.radius);

      // Điểm quy hoạch mới bắt buộc có diện tích để phân biệt với công trình chưa rõ quy mô
      if (phase === 'QH' && size <= 0) {
        return ContentService.createTextOutput(JSON.stringify({ "error": "Điểm quy hoạch mới cần diện tích > 0" }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      var targetSheet = findInfraSheet(ss, typeCode);
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
      if (radius > 0) setCell('banKinh', radius);
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

      var csdSheet = findInfraSheet(ss, "9-CSD");

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

// 4. GHI HÀNG LOẠT (POST JSON, CHỈ MÁY CHỦ WEBAPP CÓ KHÓA API_SECRET)
function doPost(e) {
  try {
    var params = (e && e.parameter) || {};
    var secret = PropertiesService.getScriptProperties().getProperty("API_SECRET");
    if (!secret || params.key !== secret) return jsonOutput({ "error": "Sai khóa API" });

    var body = JSON.parse((e.postData && e.postData.contents) || '{}');
    if (body.action === "importCadBatch") return jsonOutput(importCadBatch(body));
    if (body.action === "markWardNotes") return jsonOutput(markWardNotes(body));
    if (body.action === "saveRoads") return jsonOutput(saveRoads(body));
    if (body.action === "savePopEdits") return jsonOutput(savePopEdits(body));
    return jsonOutput({ "error": "Action không hợp lệ" });
  } catch (err) {
    return jsonOutput({ "error": err.toString() });
  }
}

/**
 * Nhập lô đất từ DXF/KML/KMZ. body = { phase: 'HT'|'QH', fileName, sync, items: [{ type, idPrefix, nhom, name, ward,
 * lat, lng, size, area, crossWard, layer, matchId, geometry, stages }] }
 * - stages: [{ phase, size, area, point, crossWard, layer, geometry }] — 1 giai đoạn, hoặc 2 (lô HT + QH cùng vị trí,
 *   tên layer theo TT16); không có stages thì 1 giai đoạn = body.phase với size / area / geometry của item
 * - matchId có trong Sheet → cập nhật tọa độ, phường, quy mô các giai đoạn đang nhập; không có → thêm dòng mới
 * - Chỉ ghi cột quy mô của giai đoạn đang nhập (HT → QuyMo_HT, QH → QuyMo_QH), cột còn lại để nguyên / trống
 * - BanKinh = it.radius (bán kính QCVN 01:2026 do máy chủ webapp tính): ghi cho dòng mới, dòng cập nhật chỉ ghi khi đang trống
 * - sync = false: chưa đẩy lên bucket (máy chủ gửi nhiều phần, chỉ phần cuối đồng bộ)
 */
function importCadBatch(body) {
  var items = Array.isArray(body.items) ? body.items : [];
  var phase = body.phase === 'QH' ? 'QH' : 'HT';
  var fileName = String(body.fileName || 'DXF');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var currentTime = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss");
  var created = [], updated = [], skipped = [], polygons = [];

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ctx = {};
    var getCtx = function(typeCode) {
      if (ctx.hasOwnProperty(typeCode)) return ctx[typeCode];
      var sheet = findInfraSheet(ss, typeCode);
      if (!sheet) return (ctx[typeCode] = null);
      var data = sheet.getDataRange().getValues();
      var col = getColumnMap(data[0]);
      var idRow = {};
      for (var r = 1; r < data.length; r++) {
        var rid = String(cellAt(data[r], col.id) || '').trim();
        if (rid) idRow[rid] = r;
      }
      return (ctx[typeCode] = { sheet: sheet, data: data, col: col, idRow: idRow, maxNum: {}, newRows: [] });
    };
    var nextId = function(c, prefix) {
      if (!c.maxNum.hasOwnProperty(prefix)) c.maxNum[prefix] = maxIdNumber(c.data, c.col.id, prefix);
      c.maxNum[prefix]++;
      return formatId(prefix, c.maxNum[prefix]);
    };

    items.forEach(function(it) {
      var c = getCtx(String(it.type || ''));
      if (!c || c.col.id < 0 || c.col.lat < 0 || c.col.lng < 0) {
        skipped.push(it.layer + ": không có tab " + it.type + " hợp lệ");
        return;
      }
      var stages = Array.isArray(it.stages) && it.stages.length ? it.stages
        : [{ phase: phase, size: it.size, area: it.area, point: it.point, crossWard: it.crossWard, layer: it.layer, geometry: it.geometry }];
      var qCols = [];
      for (var k = 0; k < stages.length; k++) {
        stages[k].phase = stages[k].phase === 'QH' ? 'QH' : 'HT';
        var qc = stages[k].phase === 'QH' ? c.col.quyMoQH : c.col.quyMoHT;
        if (qc < 0) {
          skipped.push(it.layer + ": tab " + c.sheet.getName() + " thiếu cột QuyMo_" + stages[k].phase);
          return;
        }
        qCols.push(qc);
      }

      var note = "Nhập từ file " + fileName + " (" + stages.map(function(st) {
        return "layer " + st.layer + " → QuyMo_" + st.phase
          + (st.point ? ", dạng điểm, chưa có diện tích" : "")
          + (st.crossWard ? ", vắt ranh phường, diện tích thật " + st.area + " m²" : "");
      }).join("; ") + ")";
      var r = it.matchId ? c.idRow[it.matchId] : undefined;
      var id;

      if (r !== undefined) {
        // Cập nhật từng ô (không ghi đè cả dòng để giữ công thức/định dạng sẵn có)
        id = it.matchId;
        var sheetRow = r + 1;
        var prevNote = String(cellAt(c.data[r], c.col.ghiChu) || '').trim();
        c.sheet.getRange(sheetRow, c.col.lat + 1).setValue(Number(it.lat));
        c.sheet.getRange(sheetRow, c.col.lng + 1).setValue(Number(it.lng));
        if (c.col.ward >= 0) c.sheet.getRange(sheetRow, c.col.ward + 1).setValue(sheetWard(it.ward));
        stages.forEach(function(st, k) { c.sheet.getRange(sheetRow, qCols[k] + 1).setValue(st.size); });
        if (c.col.banKinh >= 0 && Number(it.radius) > 0 && String(cellAt(c.data[r], c.col.banKinh) || '').trim() === '') {
          c.sheet.getRange(sheetRow, c.col.banKinh + 1).setValue(Number(it.radius));
        }
        if (c.col.trangThai >= 0) c.sheet.getRange(sheetRow, c.col.trangThai + 1).setValue(true);
        if (c.col.thoiGian >= 0) c.sheet.getRange(sheetRow, c.col.thoiGian + 1).setValue(currentTime);
        if (c.col.ghiChu >= 0) c.sheet.getRange(sheetRow, c.col.ghiChu + 1).setValue(prevNote ? prevNote + " | " + note : note);
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
        if (Number(it.radius) > 0) set(c.col.banKinh, Number(it.radius));
        set(c.col.trangThai, true);
        set(c.col.thoiGian, currentTime);
        set(c.col.ghiChu, note);
        c.newRows.push(row);
        created.push(id);
      }
      stages.forEach(function(st) {
        if (st.geometry) polygons.push({ id: id, layer: st.layer, area: st.area, geometry: st.geometry, phase: st.phase });
      });
    });

    // Dòng mới ghi 1 lần mỗi tab, chép định dạng + danh sách chọn (Nhom_HaTang, TrangThai) từ dòng dữ liệu cuối
    Object.keys(ctx).forEach(function(k) {
      var c = ctx[k];
      if (!c || !c.newRows.length) return;
      var start = c.sheet.getLastRow() + 1;
      var n = c.newRows.length;
      var w = c.data[0].length;
      var target = c.sheet.getRange(start, 1, n, w);
      if (start > 2) {
        var template = c.sheet.getRange(start - 1, 1, 1, w);
        template.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
        template.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
      }
      target.setValues(c.newRows);
    });

    upsertCadPolygons(ss, polygons, fileName, currentTime, phase);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  if (body.sync !== false) syncSheetsToGCS();
  return { "success": true, "created": created, "updated": updated, "skipped": skipped, "polygons": polygons.length };
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

// VÙNG HIỆU CHỈNH RASTER DÂN CƯ (Admin vẽ xóa / thêm pixel dân cư) → file pop/edits.json (ghi đè toàn bộ)
function savePopEdits(body) {
  var content = String(body.content || '');
  if (!content || content.length > 2000000) return { "error": "Dữ liệu vùng hiệu chỉnh dân cư rỗng hoặc quá lớn" };
  return { "success": true, "saved": uploadToGCS(content, "pop/edits.json") };
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
    sheet.getRange(start, 6, appends.length, 1).setNumberFormat("@");
    sheet.getRange(start, 1, appends.length, CAD_HEADERS.length).setValues(appends);
  }
}
