const ee = require('@google/earthengine');

let geeContext = null;
let geeBase = null;          // asset nạp 1 lần: ranh phường, raster dân cư gốc, raster mã phường
let popEditsVersion = -1;    // phiên bản vùng hiệu chỉnh dân cư đang áp (services/popEditsService.js)
let initPromise = null;

// Raster dân cư gốc; sau khi "ghi cố định" thì nền là asset Pixel-danso-hc-… (edits.json › asset)
const POP_ASSET = "projects/optimistic-yew-488501-s0/assets/Pixel-danso";
// Dân số nhà ở (phương pháp B): giá trị pixel là số người, cùng lưới 30 m với Pixel-danso sau khi nạp.
const POP_NHA_ASSET = "projects/optimistic-yew-488501-s0/assets/Pixel-danso-nha";
const POP_NHA_ASSET_NEXT = `${POP_NHA_ASSET}-next`;
const POP_NHA_TABLE = "projects/optimistic-yew-488501-s0/assets/Pixel-danso-nha-diem";
const POP_NHA_TABLE_NEW = `${POP_NHA_TABLE}-new`;
let activePopTable = POP_NHA_TABLE;
let activePopImage = POP_NHA_ASSET;
let activePopTableAt = 0;
const POP_NHA_CSV = "gs://hue-infra-data-us/gba/pop-weights.csv";
const POP_NHA_SCALE_M = 30;
let popAssetId = POP_ASSET;
let nhaContext = null;
let nhaBase = null;
let nhaCompose = null;
let nhaProbeAt = 0;
let nhaScalePromise = null;
let nhaPreferCoarse = false;
let nhaFailNote = '';
let nhaFailAt = 0;
const NHA_PROBE_MS = 60 * 1000;
const NHA_SCALE_BUDGET_MS = 24000;

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
    popFallback: method === 'b' && !nhaContext,
    popFromTable: false,
    popTableReady: !!(method === 'b' && nhaBase && nhaBase.fromTable),
    popScaleNote: method === 'b' ? nhaFailNote : ''
  };
}

function nhaContextFrom(img, projection, extra = {}) {
  const { ee, wardVectorParsed, wardRegion } = geeBase;
  const masked = img.updateMask(img.gt(0)).rename('DanSoPixelNormalized');
  const displaySrc = extra.displayImg || img;
  let display = displaySrc.updateMask(displaySrc.gt(0)).rename('DanSoPixelNormalized');
  if (extra.displayImg) display = display.resample('bilinear');
  return {
    ee, wardVectorParsed, wardRegion,
    popRasterNormalized: masked,
    popRasterNative: masked,
    popRasterDisplay: display,
    popProjection: projection,
    popScale: extra.popScale || POP_NHA_SCALE_M,
    popPeople: true,
    popSource: 'nha',
    popFallback: false,
    popFromTable: !!extra.popFromTable,
    popScaleNote: extra.popScaleNote || ''
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

function groupMap(stats, valueKey) {
  const out = new Map();
  const groups = stats && Array.isArray(stats.groups) ? stats.groups : [];
  groups.forEach(g => {
    const id = Math.round(Number(g.ID_Phuong));
    const val = Number(g[valueKey]);
    if (!Number.isFinite(id) || id < 0) return;
    out.set(id, Number.isFinite(val) ? val : 0);
  });
  return out;
}

// Hệ số theo phường: (dân số chính thức − dân chung cư) / dân nhà thấp tầng.
// Pixel là số người, nên tổng đưa vào đây phải là tổng không nhân diện tích ô.
function scalesFromGroups(lowStats, aptStats, popStats) {
  const lowMap = groupMap(lowStats, 'sum');
  const aptMap = groupMap(aptStats, 'sum');
  const popMap = groupMap(popStats, 'first');
  const ids = [];
  const scales = [];
  let popTotal = 0;
  popMap.forEach((danSo, id) => {
    const lowSum = lowMap.get(id) || 0;
    const aptSum = aptMap.get(id) || 0;
    const target = Math.max(0, danSo - aptSum);
    ids.push(id);
    scales.push(lowSum > 0 ? target / lowSum : 0);
    popTotal += danSo;
  });
  return { ids, scales, wards: popMap.size, popTotal };
}

function aptSig(items) {
  let h = 2166136261;
  const text = items.map(it => {
    const g = it.geometry;
    const coords = g && g.coordinates ? JSON.stringify(g.coordinates) : `${it.lng},${it.lat},${it.areaM2}`;
    return `${it.pop}|${g && g.type}|${coords}`;
  }).join(';');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function alignToGrid(img, proj, reducer) {
  return img
    .setDefaultProjection({ crs: 'EPSG:4326', scale: 10 })
    .reduceResolution({ reducer, maxPixels: 1024 })
    .reproject({ crs: proj });
}

// Che nhà thấp tầng trong ranh chung cư hiện trạng, vẽ mật độ căn hộ.
// Phần trừ lấy theo dấu chân, không theo cột phường của sheet (cột đó thường trống). Quy hoạch không vào đây.
function apartmentPaint(ee, items, proj, scaleM) {
  const cell = scaleM * scaleM;
  const features = items.map(it => {
    const area = Number(it.areaM2) > 0 ? Number(it.areaM2) : Math.PI * 40 * 40;
    const density = Number(it.pop) / Math.max(1, area / cell);
    return ee.Feature(aptGeometry(ee, it), { density });
  });
  const fc = ee.FeatureCollection(features);
  const cover = alignToGrid(ee.Image(0).byte().paint(fc, 1), proj, ee.Reducer.max()).unmask(0);
  const apt = alignToGrid(
    ee.Image(0).float().paint({ featureCollection: fc, color: 'density' }),
    proj,
    ee.Reducer.mean()
  ).unmask(0);
  return { cover, apt };
}

function composeNhaImage(items) {
  const { ee, wardVectorParsed, wardRegion, wardPopSumImg } = geeBase;
  const proj = nhaBase.projection;
  const { cover, apt } = apartmentPaint(ee, items, proj, POP_NHA_SCALE_M);
  const low = nhaBase.img.unmask(0).where(cover.gt(0), 0);
  const groupSum = (img) => {
    const stats = img.addBands(wardRegion).reduceRegion({
      reducer: ee.Reducer.sum().unweighted().group({ groupField: 1, groupName: 'ID_Phuong' }),
      geometry: wardVectorParsed.geometry(),
      scale: POP_NHA_SCALE_M,
      crs: proj,
      maxPixels: 1e8,
      tileScale: 4
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

function activePopTableId() {
  return activePopTable;
}

function setActivePopTable(id) {
  if (id) activePopTable = id;
  activePopTableAt = Date.now();
}

function setActivePopImage(id) {
  if (id) activePopImage = id;
  activePopTableAt = Date.now();
}

async function refreshActivePopTable() {
  if (Date.now() - activePopTableAt < 30000) return activePopTable;
  activePopTableAt = Date.now();
  try {
    const gcsWrite = require('./gcsWrite');
    const row = await gcsWrite.readJson('gba/pop-nha-task.json');
    const data = row && row.data;
    const rec = typeof data === 'string' ? JSON.parse(data) : data;
    if (rec && rec.liveTable) activePopTable = rec.liveTable;
    if (rec && rec.liveImage) activePopImage = rec.liveImage;
  } catch (err) { /* giữ bảng đang dùng */ }
  return activePopTable;
}

function lowRiseImage(ee, projection) {
  return ee.FeatureCollection(activePopTable)
    .reduceToImage({ properties: ['people'], reducer: ee.Reducer.sum() })
    .rename('DanSoPixel')
    .setDefaultProjection(projection);
}

function projectionFor(ee, scaleM) {
  if (scaleM === POP_NHA_SCALE_M) return ee.Image(POP_ASSET).projection();
  return ee.Image.constant(0).setDefaultProjection({ crs: 'EPSG:4326', scale: scaleM }).projection();
}

function eeEvaluateBudget(obj, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    eeEvaluate(obj).then(
      v => { clearTimeout(timer); resolve(v); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

// reduceToImage không khóa lưới: tile bản đồ tính lại theo mức phóng, mỗi điểm thành một pixel.
// Ảnh hiển thị ép về đúng lưới tính dân (30 m, hoặc 60 m khi quá hạn) rồi nội suy khi thu nhỏ.
// Ảnh tính tổng phường vẫn là low × hệ số + chung cư, không đi qua reproject này.
function displayFromTable(low, scaleImg, apt, projection) {
  return low.multiply(scaleImg).add(apt).reproject({ crs: projection });
}

// Tính hệ số một lần. Ảnh tính dân chỉ còn reduceToImage theo lưới phường, không nhúng reduceRegion cả tỉnh.
async function computeTablePack(items, scaleM, budgetMs) {
  const { ee, wardVectorParsed, wardRegion, wardPopSumImg } = geeBase;
  const projection = projectionFor(ee, scaleM);
  const lowImg = lowRiseImage(ee, projection);
  const painted = items.length ? apartmentPaint(ee, items, projection, scaleM) : null;
  const low = painted ? lowImg.unmask(0).where(painted.cover.gt(0), 0) : lowImg.unmask(0);
  const apt = painted ? painted.apt : ee.Image.constant(0);
  const opts = {
    geometry: wardVectorParsed.geometry(),
    scale: scaleM,
    crs: projection,
    maxPixels: 1e8,
    tileScale: 8
  };
  const raw = await eeEvaluateBudget(ee.Dictionary({
    low: low.addBands(wardRegion).reduceRegion({
      reducer: ee.Reducer.sum().unweighted().group({ groupField: 1, groupName: 'ID_Phuong' }),
      ...opts
    }),
    apt: apt.addBands(wardRegion).reduceRegion({
      reducer: ee.Reducer.sum().unweighted().group({ groupField: 1, groupName: 'ID_Phuong' }),
      ...opts
    }),
    pop: wardPopSumImg.addBands(wardRegion).reduceRegion({
      reducer: ee.Reducer.first().unweighted().group({ groupField: 1, groupName: 'ID_Phuong' }),
      ...opts
    })
  }), budgetMs);
  const built = scalesFromGroups(raw && raw.low, raw && raw.apt, raw && raw.pop);
  if (built.wards < 30 || !(built.popTotal > 1000000)) throw new Error('Không đọc đủ dân số phường');
  const scaleImg = wardRegion.remap(ee.List(built.ids), ee.List(built.scales), 1).unmask(1).toFloat();
  const note = scaleM === POP_NHA_SCALE_M
    ? ''
    : 'Đang dùng ô 60 m vì tính ô 30 m không kịp trong hạn 60 giây của máy chủ.';
  const img = low.multiply(scaleImg).add(apt).rename('DanSoPixelNormalized');
  return {
    img,
    display: displayFromTable(low, scaleImg, apt, projection),
    projection,
    scaleM,
    note
  };
}

async function tablePack(items, key) {
  if (nhaScalePromise && nhaScalePromise.key === key) return nhaScalePromise.run;
  const run = (async () => {
    if (!nhaPreferCoarse) {
      try {
        return await computeTablePack(items, POP_NHA_SCALE_M, NHA_SCALE_BUDGET_MS);
      } catch (err) {
        console.warn('Hệ số dân nhà ở 30 m:', err && err.message);
        nhaPreferCoarse = true;
      }
    }
    return computeTablePack(items, 60, 20000);
  })();
  nhaScalePromise = { key, run };
  try {
    return await run;
  } catch (err) {
    if (nhaScalePromise && nhaScalePromise.key === key) nhaScalePromise = null;
    throw err;
  }
}

/** pack là tab NOXH đã chuẩn hóa. Thiếu ảnh raster thì dựng từ bảng điểm, cache theo phiên bản gói. */
async function ensureNha(method, pack) {
  if (method !== 'b') return getGeeContext('old');
  if (!nhaBase && Date.now() - nhaProbeAt >= NHA_PROBE_MS) await loadNha();
  if (!nhaBase) return getGeeContext('b');
  const items = liveApartments(pack);
  const key = (nhaBase.fromTable ? 'table:' : 'asset:') + (items.length ? `${(pack && pack.version) || 'apt'}:${aptSig(items)}` : 'base');
  if (!nhaCompose || nhaCompose.key !== key) {
    if (nhaBase.fromTable) {
      if (nhaFailAt && Date.now() - nhaFailAt < NHA_PROBE_MS) return getGeeContext('b');
      try {
        const packed = await tablePack(items, key);
        nhaFailNote = '';
        nhaFailAt = 0;
        nhaCompose = {
          key,
          context: nhaContextFrom(packed.img, packed.projection, {
            popFromTable: true,
            popScale: packed.scaleM,
            popScaleNote: packed.note,
            displayImg: packed.display
          })
        };
      } catch (err) {
        console.warn('Không tính được dân từ bảng điểm:', err && err.message);
        nhaFailNote = 'Chưa tính được bảng điểm nhà ở trong hạn 60 giây, đang dùng pixel cũ.';
        nhaFailAt = Date.now();
        nhaContext = null;
        return getGeeContext('b');
      }
    } else {
      const img = items.length ? composeNhaImage(items) : nhaBase.img;
      nhaCompose = { key, context: nhaContextFrom(img, nhaBase.projection) };
    }
  }
  nhaContext = nhaCompose.context;
  return nhaContext;
}

/** Ảnh Pixel-danso-nha nếu có. Không có thì dùng bảng Pixel-danso-nha-diem, không evaluate cả raster. */
async function loadNha() {
  nhaProbeAt = Date.now();
  nhaCompose = null;
  nhaBase = null;
  nhaContext = null;
  nhaScalePromise = null;
  nhaFailNote = '';
  if (!geeBase) return;
  await refreshActivePopTable();
  const { ee } = geeBase;
  try {
    const img = ee.Image(activePopImage).select(0);
    await eeEvaluate(img.bandNames());
    const projection = img.projection();
    nhaBase = { img, projection, fromTable: false };
    nhaContext = nhaContextFrom(img, projection);
    return;
  } catch (err) {
    console.warn('Chưa có asset Pixel-danso-nha:', err && err.message);
  }
  try {
    if (!(await assetExists(ee, activePopTable))) return;
    const projection = ee.Image(POP_ASSET).projection();
    nhaBase = { img: lowRiseImage(ee, projection), projection, fromTable: true };
    nhaContext = null;
  } catch (err) {
    nhaContext = null;
    console.warn('Chưa đọc được bảng điểm nhà ở:', err && err.message);
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
async function startPopNhaTask(phase, liveTable, liveImage) {
  const { ee, wardVectorParsed } = getGeeContext('old');
  if (phase === 'table') {
    const live = liveTable || activePopTable;
    const liveOk = await assetExists(ee, live);
    // Bảng đang phục vụ giữ nguyên. File mới vào bảng kia. Chỉ khi bảng đang dùng không còn thì nạp thẳng vào tên gốc.
    const dest = liveOk ? (live === POP_NHA_TABLE_NEW ? POP_NHA_TABLE : POP_NHA_TABLE_NEW) : POP_NHA_TABLE;
    if (dest !== live && await assetExists(ee, dest)) await deleteAsset(ee, dest);
    const taskId = ee.data.newTaskId(1)[0];
    const response = await new Promise((resolve, reject) => {
      ee.data.startTableIngestion(taskId, {
        id: dest,
        sources: [{
          primaryPath: POP_NHA_CSV,
          xColumn: 'longitude',
          yColumn: 'latitude',
          crs: 'EPSG:4326'
        }]
      }, (res, err) => (err ? reject(new Error(String(err))) : resolve(res || {})));
    });
    return { phase: 'table', task: response.taskId || taskId, asset: dest, promote: dest !== live };
  }
  if (!(await assetExists(ee, activePopTable))) {
    const err = new Error('Chưa có bảng điểm trên GEE');
    err.code = 'NO_TABLE';
    throw err;
  }
  // Ảnh đang phục vụ giữ nguyên. Ảnh mới ghi sang ô còn lại. Chỉ xóa ô sắp ghi, không xóa ảnh đang dùng.
  const liveId = liveImage || activePopImage;
  const liveOk = await assetExists(ee, liveId);
  const assetId = liveOk ? (liveId === POP_NHA_ASSET_NEXT ? POP_NHA_ASSET : POP_NHA_ASSET_NEXT) : POP_NHA_ASSET;
  if (assetId !== liveId && await assetExists(ee, assetId)) await deleteAsset(ee, assetId);
  // Cùng lưới 30 m với phép tính trực tiếp. Ảnh 10 m cả tỉnh không được worker nhận (started null).
  const proj = ee.Image(POP_ASSET).projection();
  const summed = lowRiseImage(ee, proj);
  const [projInfo, bounds] = await Promise.all([
    eeEvaluate(proj),
    eeEvaluate(wardVectorParsed.geometry().bounds(1))
  ]);
  const task = ee.batch.Export.image.toAsset({
    image: summed.updateMask(summed.gt(0)).toFloat(),
    description: 'QH-Hue_Pixel-danso-nha',
    assetId,
    pyramidingPolicy: { '.default': 'mean' },
    region: ee.Geometry(bounds),
    crs: projInfo.crs,
    crsTransform: projInfo.transform,
    maxPixels: 1e8
  });
  await new Promise((resolve, reject) => task.start(resolve, (err) => reject(new Error(String(err)))));
  if (!task.id) throw new Error('GEE không trả về mã tác vụ');
  return { phase: 'image', task: task.id, asset: assetId, promote: false };
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
    type: t.task_type || t.type || '',
    sources: [].concat(t.source_uris || [], t.sources || []),
    destinations: [].concat(t.destination_uris || [], t.output_url || []),
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
  const [table, tableNew, image, next] = await Promise.all([
    assetExists(ee, activePopTable),
    assetExists(ee, activePopTable === POP_NHA_TABLE ? POP_NHA_TABLE_NEW : POP_NHA_TABLE),
    assetExists(ee, activePopImage),
    assetExists(ee, activePopImage === POP_NHA_ASSET ? POP_NHA_ASSET_NEXT : POP_NHA_ASSET)
  ]);
  return { table, tableNew, image, next, liveTable: activePopTable, liveImage: activePopImage };
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
  startPopNhaTask, listRecentTasks, cancelGeeTask, popNhaAssets, promoteNhaAsset, scalesFromGroups,
  activePopTableId, setActivePopTable, setActivePopImage, refreshActivePopTable,
  POP_SCALE_M, POP_NHA_SCALE_M, POP_NHA_ASSET, POP_NHA_ASSET_NEXT, POP_NHA_TABLE, POP_NHA_TABLE_NEW, POP_NHA_CSV
};
