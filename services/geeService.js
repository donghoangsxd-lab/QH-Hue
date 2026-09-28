const ee = require('@google/earthengine');

let geeContext = null;
let initPromise = null;

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

            const validPopMask = popRaster.gt(0);
            const validPopRaster = popRaster.updateMask(validPopMask);
            const wardPopSumImg = ee.Image().double().paint({ featureCollection: wardVectorParsed, color: 'danSoNum' });

            const statsGrouped = validPopRaster.addBands(wardRegion).reduceRegion({
              reducer: ee.Reducer.count().group({ groupField: 1, groupName: 'ID_Phuong' }),
              geometry: wardVectorParsed.geometry(),
              scale: 60, maxPixels: 1e9
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

            // popRasterNative: raster phân bổ dân cư gốc (chỉ pixel có dân), giữ nguyên lưới gốc để đếm pixel đề xuất CSD
            geeContext = {
              ee, wardVectorParsed, popRasterNormalized, wardRegion,
              popRasterNative: validPopRaster,
              popProjection: popRaster.projection()
            };
            resolve();
          }, (err) => reject(new Error("GEE Init Fail: " + err)));
        }, 
        (err) => reject(new Error("GEE Auth Fail: " + err))
      );
    } catch (e) { reject(new Error("Key Parse Fail: " + e.message)); }
  });
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

module.exports = { initGEE, getGeeContext, eeEvaluate };
