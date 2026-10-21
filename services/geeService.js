const ee = require('@google/earthengine');

let geeContext = null;
let geeBase = null;          // asset nạp 1 lần: ranh phường, raster dân cư gốc, raster mã phường
let popEditsVersion = -1;    // phiên bản vùng hiệu chỉnh dân cư đang áp (services/popEditsService.js)
let initPromise = null;

// Raster dân cư gốc; sau khi "ghi cố định" thì nền là asset Pixel-danso-hc-… (edits.json › asset)
const POP_ASSET = "projects/optimistic-yew-488501-s0/assets/Pixel-danso";
// Dân số nhà ở (phương pháp B): giá trị pixel là số người, cùng lưới 30 m với Pixel-danso sau khi nạp.
const POP_NHA_ASSET = "projects/optimistic-yew-488501-s0/assets/Pixel-danso-nha";
const POP_NHA_TABLE = "projects/optimistic-yew-488501-s0/assets/Pixel-danso-nha-diem";
const POP_NHA_CSV = "gs://hue-infra-data-us/gba/pop-weights.csv";
const POP_NHA_SCALE_M = 30;
let popAssetId = POP_ASSET;
let nhaContext = null;
let nhaProbeAt = 0;
const NHA_PROBE_MS = 60 * 1000;

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

            const popRaster = ee.Image(POP_ASSET).select(0).rename('DanSoPixel');
            popAssetId = POP_ASSET;
            const wardRegion = ee.Image("projects/optimistic-yew-488501-s0/assets/Output40xa").select(0).rename('ID_Region');
            const wardPopSumImg = ee.Image().double().paint({ featureCollection: wardVectorParsed, color: 'danSoNum' });

            geeBase = { ee, wardVectorParsed, popRaster, wardRegion, wardPopSumImg };
            applyPopEdits(0, []);
            loadNha().then(resolve, resolve);
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
 * asset: raster nền đã ghi cố định (null = Pixel-danso gốc).
 */
function applyPopEdits(version, edits, asset = null) {
  const target = asset || POP_ASSET;
  if (target !== popAssetId) {
    geeBase.popRaster = geeBase.ee.Image(target).select(0).rename('DanSoPixel');
    popAssetId = target;
  }
  const { ee, wardVectorParsed, popRaster, wardRegion, wardPopSumImg } = geeBase;
  const zone = (op) => {
    const list = (edits || []).filter(e => e.op === op);
    if (!list.length) return null;
    const fc = ee.FeatureCollection(list.map(e => ee.Feature(ee.Geometry.Polygon([e.ring, ...(e.holes || [])], null, false))));
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

function getGeeContext(method) {
  if (!geeContext) throw new Error("GEE Context chưa được khởi tạo!");
  if (method === 'b' && nhaContext) return nhaContext;
  return {
    ...geeContext,
    popScale: POP_SCALE_M,
    popPeople: false,
    popSource: 'pixel',
    popFallback: method === 'b' && !nhaContext
  };
}

/** Instance đang chạy thử lại asset nhà ở tối đa mỗi phút, để lần nạp xong không phải chờ tiến trình mới. */
async function ensureNha(method) {
  if (method !== 'b') return getGeeContext('old');
  if (!nhaContext && Date.now() - nhaProbeAt >= NHA_PROBE_MS) await loadNha();
  return getGeeContext('b');
}

/** Asset Pixel-danso-nha: mỗi pixel là số người trên lưới 30 m. Thiếu asset thì các phép đếm dùng pixel cũ. */
async function loadNha() {
  nhaProbeAt = Date.now();
  if (!geeBase) return;
  const { ee, wardVectorParsed, wardRegion } = geeBase;
  try {
    const img = ee.Image(POP_NHA_ASSET).select(0).rename('DanSoPixelNormalized');
    await eeEvaluate(img.bandNames());
    const masked = img.updateMask(img.gt(0));
    nhaContext = {
      ee, wardVectorParsed, wardRegion,
      popRasterNormalized: masked,
      popRasterNative: masked,
      popProjection: img.projection(),
      popScale: POP_NHA_SCALE_M,
      popPeople: true,
      popSource: 'nha',
      popFallback: false
    };
  } catch (err) {
    nhaContext = null;
    console.warn('Chưa có asset Pixel-danso-nha:', err && err.message);
  }
}

function assetExists(ee, id) {
  return new Promise(resolve => {
    ee.data.getAsset(id, (asset, err) => resolve(!err && !!asset));
  });
}

function deleteAsset(ee, id) {
  return new Promise((resolve, reject) => {
    ee.data.deleteAsset(id, (ok, err) => (err ? reject(new Error(String(err))) : resolve()));
  });
}

/**
 * Nạp bảng điểm nhà ở từ gs://hue-infra-data-us/gba/pop-weights.csv rồi xuất asset Pixel-danso-nha
 * đúng lưới Pixel-danso. phase = table (đang nạp điểm) hoặc image (đang xuất raster).
 */
async function startPopNhaTask(phase) {
  const { ee, wardVectorParsed } = getGeeContext('old');
  if (phase === 'table') {
    if (await assetExists(ee, POP_NHA_TABLE)) await deleteAsset(ee, POP_NHA_TABLE);
    const taskId = ee.data.newTaskId(1)[0];
    const response = await new Promise((resolve, reject) => {
      ee.data.startTableIngestion(taskId, {
        id: POP_NHA_TABLE,
        sources: [{
          primaryPath: POP_NHA_CSV,
          xColumn: 'longitude',
          yColumn: 'latitude',
          crs: 'EPSG:4326'
        }]
      }, (res, err) => (err ? reject(new Error(String(err))) : resolve(res || {})));
    });
    return { phase: 'table', task: response.taskId || taskId, asset: POP_NHA_TABLE };
  }
  if (!(await assetExists(ee, POP_NHA_TABLE))) {
    const err = new Error('Chưa có bảng điểm trên GEE');
    err.code = 'NO_TABLE';
    throw err;
  }
  if (await assetExists(ee, POP_NHA_ASSET)) await deleteAsset(ee, POP_NHA_ASSET);
  const proj = ee.Image(POP_ASSET).projection();
  const summed = ee.FeatureCollection(POP_NHA_TABLE).reduceToImage({
    properties: ['people'],
    reducer: ee.Reducer.sum()
  }).rename('DanSoPixel');
  // Ô ~10 m rồi cộng vào đúng lưới 30 m của Pixel-danso để tổng dân không bị nearest-neighbor làm lệch.
  const aligned = summed.setDefaultProjection({ crs: 'EPSG:4326', scale: 10 })
    .reduceResolution({ reducer: ee.Reducer.sum(), maxPixels: 1024 })
    .reproject({ crs: proj });
  const [projInfo, bounds] = await Promise.all([
    eeEvaluate(proj),
    eeEvaluate(wardVectorParsed.geometry().bounds(1))
  ]);
  const task = ee.batch.Export.image.toAsset({
    image: aligned.updateMask(aligned.gt(0)).toFloat(),
    description: 'QH-Hue_Pixel-danso-nha',
    assetId: POP_NHA_ASSET,
    pyramidingPolicy: { '.default': 'mean' },
    region: ee.Geometry(bounds),
    crs: projInfo.crs,
    crsTransform: projInfo.transform,
    maxPixels: 1e10
  });
  await new Promise((resolve, reject) => task.start(resolve, (err) => reject(new Error(String(err)))));
  if (!task.id) throw new Error('GEE không trả về mã tác vụ');
  return { phase: 'image', task: task.id, asset: POP_NHA_ASSET };
}

// evaluate của Earth Engine báo lỗi qua tham số thứ 2 của callback; bọc lại để lỗi không bị nuốt thành số 0
function eeEvaluate(eeObject) {
  return new Promise((resolve, reject) => {
    eeObject.evaluate((result, err) => (err ? reject(new Error(String(err))) : resolve(result)));
  });
}

/**
 * Xuất raster dân cư đang áp vùng hiệu chỉnh (pixel có dân = 1) thành asset mới, cùng lưới với raster nền.
 * Trả về mã tác vụ GEE (tác vụ chạy nền vài phút, xem trạng thái bằng getTaskState).
 */
async function startPopBake(assetId) {
  const { ee, wardVectorParsed, popRasterNative, popProjection } = getGeeContext();
  const [proj, bounds] = await Promise.all([
    eeEvaluate(popProjection),
    eeEvaluate(wardVectorParsed.geometry().bounds(1))
  ]);
  const task = ee.batch.Export.image.toAsset({
    image: popRasterNative.gt(0).selfMask().toByte().rename('DanSoPixel'),
    description: 'QH-Hue_Pixel-danso_ghi-co-dinh',
    assetId,
    pyramidingPolicy: { '.default': 'mode' },
    region: ee.Geometry(bounds),
    crs: proj.crs,
    crsTransform: proj.transform,
    maxPixels: 1e10
  });
  await new Promise((resolve, reject) => task.start(resolve, (err) => reject(new Error(String(err)))));
  if (!task.id) throw new Error('GEE không trả về mã tác vụ');
  return task.id;
}

/** Trạng thái tác vụ xuất: { state: READY | RUNNING | COMPLETED | FAILED | CANCELLED | ..., error } */
function getTaskState(taskId) {
  return new Promise((resolve, reject) => {
    geeContext.ee.data.getTaskStatus(taskId, (list, err) => {
      if (err) return reject(new Error(String(err)));
      const t = (list && list[0]) || {};
      resolve({ state: String(t.state || 'UNKNOWN'), error: t.error_message || '' });
    });
  });
}

module.exports = {
  initGEE, getGeeContext, ensureNha, eeEvaluate, applyPopEdits, getPopEditsVersion, startPopBake, getTaskState, loadNha,
  startPopNhaTask, POP_SCALE_M, POP_NHA_SCALE_M, POP_NHA_ASSET, POP_NHA_CSV
};
