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
let nhaBase = null;
let nhaCompose = null;
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

function nhaContextFrom(img, projection) {
  const { ee, wardVectorParsed, wardRegion } = geeBase;
  const masked = img.updateMask(img.gt(0)).rename('DanSoPixelNormalized');
  return {
    ee, wardVectorParsed, wardRegion,
    popRasterNormalized: masked,
    popRasterNative: masked,
    popProjection: projection,
    popScale: POP_NHA_SCALE_M,
    popPeople: true,
    popSource: 'nha',
    popFallback: false
  };
}

function liveApartments(pack) {
  return ((pack && pack.items) || []).filter(it => {
    if (!it || it.status === 'quy_hoach' || !(Number(it.pop) > 0)) return false;
    if (it.geometry && (it.geometry.type === 'Polygon' || it.geometry.type === 'MultiPolygon')) return true;
    return Number.isFinite(Number(it.lat)) && Number.isFinite(Number(it.lng));
  });
}

function aptGeometry(ee, it) {
  const g = it.geometry;
  if (g && g.type === 'Polygon' && Array.isArray(g.coordinates)) {
    return ee.Geometry.Polygon(g.coordinates, null, false);
  }
  if (g && g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
    return ee.Geometry.MultiPolygon(g.coordinates, null, false);
  }
  const area = Number(it.areaM2) > 0 ? Number(it.areaM2) : Math.PI * 40 * 40;
  const radius = Math.max(40, Math.sqrt(area / Math.PI));
  return ee.Geometry.Point([Number(it.lng), Number(it.lat)]).buffer(radius);
}

// Che nhà thấp tầng trong ranh chung cư hiện trạng, vẽ mật độ căn hộ, rồi co nhà thấp tầng theo phường
// sao cho tổng pixel = dân số phường. Quy hoạch không vào đây.
// Phần trừ lấy theo dấu chân nằm trong phường, không theo cột phường của sheet (cột đó thường trống).
function composeNhaImage(items) {
  const { ee, wardVectorParsed, wardRegion, wardPopSumImg } = geeBase;
  const proj = nhaBase.projection;
  const cell = POP_NHA_SCALE_M * POP_NHA_SCALE_M;
  const features = items.map(it => {
    const area = Number(it.areaM2) > 0 ? Number(it.areaM2) : Math.PI * 40 * 40;
    const density = Number(it.pop) / Math.max(1, area / cell);
    return ee.Feature(aptGeometry(ee, it), { density });
  });
  const fc = ee.FeatureCollection(features);
  const align = (img, reducer) => img
    .setDefaultProjection({ crs: 'EPSG:4326', scale: 10 })
    .reduceResolution({ reducer, maxPixels: 1024 })
    .reproject({ crs: proj });
  const cover = align(ee.Image(0).byte().paint(fc, 1), ee.Reducer.max()).unmask(0);
  const low = nhaBase.img.unmask(0).where(cover.gt(0), 0);
  const apt = align(
    ee.Image(0).float().paint({ featureCollection: fc, color: 'density' }),
    ee.Reducer.mean()
  ).unmask(0);
  const groupSum = (img) => {
    const stats = img.addBands(wardRegion).reduceRegion({
      reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'ID_Phuong' }),
      geometry: wardVectorParsed.geometry(),
      scale: POP_NHA_SCALE_M,
      crs: proj,
      maxPixels: 1e10
    });
    const groups = ee.List(ee.Algorithms.If(stats.get('groups'), stats.get('groups'), ee.List([])));
    const dict = ee.Dictionary(groups.iterate((item, acc) => {
      const d = ee.Dictionary(item);
      const idStr = ee.String(ee.Number(d.get('ID_Phuong')).toInt());
      return ee.Dictionary(acc).set(idStr, d.get('sum'));
    }, ee.Dictionary({})));
    return ee.Image(ee.Algorithms.If(
      dict.size().gt(0),
      wardRegion.remap(dict.keys().map(k => ee.Number.parse(k)), dict.values()).unmask(0),
      ee.Image.constant(0)
    ));
  };
  const lowSum = groupSum(low);
  const aptSum = groupSum(apt);
  const target = wardPopSumImg.subtract(aptSum).max(0);
  const scale = target.divide(lowSum.max(1e-9)).where(lowSum.lte(0), 0);
  return low.multiply(scale).add(apt).rename('DanSoPixelNormalized');
}

/** Instance đang chạy thử lại asset nhà ở tối đa mỗi phút. pack là tab NOXH đã chuẩn hóa; đổi version thì dựng lại ảnh. */
async function ensureNha(method, pack) {
  if (method !== 'b') return getGeeContext('old');
  if (!nhaBase && Date.now() - nhaProbeAt >= NHA_PROBE_MS) await loadNha();
  if (!nhaBase) return getGeeContext('b');
  const items = liveApartments(pack);
  const key = items.length ? ((pack && pack.version) || 'apt') : 'base';
  if (!nhaCompose || nhaCompose.key !== key) {
    const img = items.length ? composeNhaImage(items) : nhaBase.img;
    nhaCompose = { key, context: nhaContextFrom(img, nhaBase.projection) };
  }
  nhaContext = nhaCompose.context;
  return nhaContext;
}

/** Asset Pixel-danso-nha là nền nhà thấp tầng. Thiếu asset thì các phép đếm dùng pixel cũ. */
async function loadNha() {
  nhaProbeAt = Date.now();
  nhaCompose = null;
  nhaBase = null;
  nhaContext = null;
  if (!geeBase) return;
  const { ee } = geeBase;
  try {
    const img = ee.Image(POP_NHA_ASSET).select(0);
    await eeEvaluate(img.bandNames());
    const projection = img.projection();
    nhaBase = { img, projection };
    nhaContext = nhaContextFrom(img, projection);
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
  // Giữ ảnh đang dùng. Ảnh mới ghi sang asset tạm, xong mới đổi tên. Xóa trước khi xuất từng làm mất nền khi tác vụ kẹt ở hàng chờ.
  const live = await assetExists(ee, POP_NHA_ASSET);
  const assetId = live ? `${POP_NHA_ASSET}-next` : POP_NHA_ASSET;
  if (assetId !== POP_NHA_ASSET && await assetExists(ee, assetId)) await deleteAsset(ee, assetId);
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
    assetId,
    pyramidingPolicy: { '.default': 'mean' },
    region: ee.Geometry(bounds),
    crs: projInfo.crs,
    crsTransform: projInfo.transform,
    maxPixels: 1e10
  });
  await new Promise((resolve, reject) => task.start(resolve, (err) => reject(new Error(String(err)))));
  if (!task.id) throw new Error('GEE không trả về mã tác vụ');
  return { phase: 'image', task: task.id, asset: assetId, promote: assetId !== POP_NHA_ASSET };
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

function taskView(t, fallbackId) {
  return {
    id: t.id || fallbackId || '',
    state: String(t.state || 'UNKNOWN'),
    error: t.error_message || '',
    description: t.description || '',
    type: t.task_type || '',
    created: t.creation_timestamp_ms || null,
    updated: t.update_timestamp_ms || null,
    started: t.start_timestamp_ms || null,
    attempt: t.attempt || 0
  };
}

/** Trạng thái tác vụ: READY = Earth Engine chưa chạy (PENDING), RUNNING = đang chạy. */
function getTaskState(taskId) {
  return new Promise((resolve, reject) => {
    if (!geeContext) return reject(new Error('GEE Context chưa được khởi tạo'));
    geeContext.ee.data.getTaskStatus(taskId, (list, err) => {
      if (err) return reject(new Error(String(err)));
      resolve(taskView((list && list[0]) || {}, taskId));
    });
  });
}

function listRecentTasks(limit = 40) {
  return new Promise((resolve, reject) => {
    if (!geeContext) return reject(new Error('GEE Context chưa được khởi tạo'));
    geeContext.ee.data.getTaskListWithLimit(limit, (res, err) => {
      if (err) return reject(new Error(String(err)));
      const tasks = ((res && res.tasks) || []).map(t => taskView(t));
      resolve(tasks);
    });
  });
}

function cancelGeeTask(taskId) {
  return new Promise((resolve, reject) => {
    if (!taskId) return resolve(false);
    if (!geeContext) return reject(new Error('GEE Context chưa được khởi tạo'));
    geeContext.ee.data.cancelTask(taskId, (res, err) => (err ? reject(new Error(String(err))) : resolve(res || true)));
  });
}

async function popNhaAssets() {
  const { ee } = getGeeContext('old');
  const [table, image, next] = await Promise.all([
    assetExists(ee, POP_NHA_TABLE),
    assetExists(ee, POP_NHA_ASSET),
    assetExists(ee, `${POP_NHA_ASSET}-next`)
  ]);
  return { table, image, next };
}

async function promoteNhaAsset(assetId) {
  if (!assetId || assetId === POP_NHA_ASSET) return POP_NHA_ASSET;
  const { ee } = getGeeContext('old');
  if (await assetExists(ee, POP_NHA_ASSET)) await deleteAsset(ee, POP_NHA_ASSET);
  await new Promise((resolve, reject) => {
    ee.data.renameAsset(assetId, POP_NHA_ASSET, (res, err) => (err ? reject(new Error(String(err))) : resolve(res)));
  });
  return POP_NHA_ASSET;
}

module.exports = {
  initGEE, getGeeContext, ensureNha, eeEvaluate, applyPopEdits, getPopEditsVersion, startPopBake, getTaskState, loadNha,
  startPopNhaTask, listRecentTasks, cancelGeeTask, popNhaAssets, promoteNhaAsset,
  POP_SCALE_M, POP_NHA_SCALE_M, POP_NHA_ASSET, POP_NHA_CSV
};
