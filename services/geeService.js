const ee = require('@google/earthengine');

let geeContext = null;
let geeBase = null;          // asset nạp 1 lần: ranh phường, raster dân cư gốc, raster mã phường
let popEditsVersion = -1;    // phiên bản vùng hiệu chỉnh dân cư đang áp (services/popEditsService.js)
let initPromise = null;

// Lưới đếm pixel có dân của phường. Mọi phép cộng/đếm trên popRasterNormalized phải dùng đúng lưới này:
// mỗi pixel mang dân số phường / số pixel đếm ở lưới này, cộng ở lưới 30 m gốc sẽ ra gấp ~4 lần.
const POP_SCALE_M = 60;

// Các request đồng thời lúc khởi động dùng chung 1 lần xác thực; lỗi thì cho phép thử lại ở request sau
function initGEE() {
  if (!initPromise) {
    initPromise = createGeeContext().catch(err => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

function createGeeContext() {
  return new Promise((resolve, reject) => {
    try {
      let privateKey = process.env.GEE_PRIVATE_KEY;
      if (!privateKey) return reject(new Error("Thiếu biến GEE_PRIVATE_KEY"));
      if (typeof privateKey === 'string' && privateKey.trim().startsWith('{')) {
        privateKey = JSON.parse(privateKey);
      } else if (typeof privateKey === 'string') {
        privateKey = privateKey.replace(/\\n/g, '\n');
      }

      ee.data.authenticateViaPrivateKey(
        privateKey, 
        () => {
          ee.initialize(null, null, () => {
            const wardVector = ee.FeatureCollection("projects/optimistic-yew-488501-s0/assets/Polygon-40xa");
            const wardVectorParsed = wardVector.map(f => {
              let rawPop = f.get('danSo') || f.get('DanSo');
              return f.set('danSoNum', ee.Algorithms.If(rawPop, ee.Number.parse(ee.String(rawPop)), 0));
            });

            const popRaster = ee.Image("projects/optimistic-yew-488501-s0/assets/Pixel-danso").select(0).rename('DanSoPixel');
            const wardRegion = ee.Image("projects/optimistic-yew-488501-s0/assets/Output40xa").select(0).rename('ID_Region');
            const wardPopSumImg = ee.Image().double().paint({ featureCollection: wardVectorParsed, color: 'danSoNum' });

            geeBase = { ee, wardVectorParsed, popRaster, wardRegion, wardPopSumImg };
            applyPopEdits(0, []);
            resolve();
          }, (err) => reject(new Error("GEE Init Fail: " + err)));
        }, 
        (err) => reject(new Error("GEE Auth Fail: " + err))
      );
    } catch (e) {
      // Lỗi JSON.parse có kèm 1 đoạn nội dung khóa: chỉ ghi log máy chủ, không trả về client
      console.error("GEE key parse error:", e.name);
      reject(new Error("Key Parse Fail: GEE_PRIVATE_KEY không hợp lệ"));
    }
  });
}

/**
 * Dựng lại raster dân cư theo vùng hiệu chỉnh: pixel có dân = raster gốc > 0, bỏ pixel trong vùng "remove", thêm pixel
 * trong vùng "add" (áp sau). Dân số phường chia đều cho số pixel có dân của phường như cũ. Không có vùng → đúng như raster gốc.
 */
function applyPopEdits(version, edits) {
  const { ee, wardVectorParsed, popRaster, wardRegion, wardPopSumImg } = geeBase;
  const zone = (op) => {
    const list = (edits || []).filter(e => e.op === op);
    if (!list.length) return null;
    const fc = ee.FeatureCollection(list.map(e => ee.Feature(ee.Geometry.Polygon([e.ring], null, false))));
    return ee.Image(0).byte().paint(fc, 1);
  };
  const removeZone = zone('remove');
  const addZone = zone('add');

  let validPopMask = popRaster.gt(0);
  let validPopRaster;
  if (!removeZone && !addZone) {
    validPopRaster = popRaster.updateMask(validPopMask);
  } else {
    // unmask: vùng thêm có thể nằm ngoài phạm vi có dữ liệu của raster gốc; giữ phép chiếu (lưới 30 m) của raster gốc
    validPopMask = validPopMask.unmask(0, false);
    if (removeZone) validPopMask = validPopMask.where(removeZone, 0);
    if (addZone) validPopMask = validPopMask.where(addZone, 1);
    validPopRaster = validPopMask.selfMask().rename('DanSoPixel');
  }

  const statsGrouped = validPopRaster.addBands(wardRegion).reduceRegion({
    reducer: ee.Reducer.count().group({ groupField: 1, groupName: 'ID_Phuong' }),
    geometry: wardVectorParsed.geometry(),
    scale: POP_SCALE_M, maxPixels: 1e9
  });

  const groupsList = ee.List(statsGrouped.get('groups'));
  const wardPixelCountDict = ee.Dictionary(groupsList.iterate((item, acc) => {
    const d = ee.Dictionary(item);
    const idStr = ee.String(ee.Number(d.get('ID_Phuong')).toInt());
    return ee.Dictionary(acc).set(idStr, d.get('count'));
  }, ee.Dictionary({})));

  const wardPixelCountImg = wardRegion.remap(
    wardPixelCountDict.keys().map(k => ee.Number.parse(k)),
    wardPixelCountDict.values()
  );

  const popRasterNormalized = wardPopSumImg.divide(wardPixelCountImg)
    .updateMask(validPopMask)
    .rename('DanSoPixelNormalized');

  // popRasterNative: raster phân bổ dân cư (chỉ pixel có dân), giữ nguyên lưới gốc để đếm pixel đề xuất CSD
  geeContext = {
    ee, wardVectorParsed, popRasterNormalized, wardRegion,
    popRasterNative: validPopRaster,
    popProjection: popRaster.projection()
  };
  popEditsVersion = version;
}

function getPopEditsVersion() {
  return popEditsVersion;
}

function getGeeContext() {
  if (!geeContext) throw new Error("GEE Context chưa được khởi tạo!");
  return geeContext;
}

// evaluate của Earth Engine báo lỗi qua tham số thứ 2 của callback; bọc lại để lỗi không bị nuốt thành số 0
function eeEvaluate(eeObject) {
  return new Promise((resolve, reject) => {
    eeObject.evaluate((result, err) => (err ? reject(new Error(String(err))) : resolve(result)));
  });
}

module.exports = { initGEE, getGeeContext, eeEvaluate, applyPopEdits, getPopEditsVersion, POP_SCALE_M };
