// Lớp dữ liệu vệ tinh lấy thẳng từ danh mục Google Earth Engine (không cần asset riêng):
// cao độ Copernicus DEM GLO-30, vùng ngập mùa lũ từ radar Sentinel-1, nhiệt độ bề mặt từ Landsat 8/9.

const DEM_COLLECTION = 'COPERNICUS/DEM/GLO30';

// Sentinel-1 phủ đều Việt Nam từ 2016; Landsat 8 có đủ mùa nóng từ 2014
const SAR_FIRST_YEAR = 2016;
const LST_FIRST_YEAR = 2014;
// Mùa lũ Huế so với nền mùa khô cùng năm (đồng ruộng chưa ngập lũ); mùa nóng cho nhiệt độ bề mặt
const FLOOD_SEASON = ['09-15', '12-15'];
const DRY_SEASON = ['03-01', '07-31'];
const HOT_SEASON = ['04-01', '08-31'];

// Pixel ngập: tán xạ ngược VV thấp như mặt nước và giảm mạnh so với mùa khô (loại mặt đường, bãi cát luôn tối)
const SAR_WATER_DB = -16;
const SAR_DROP_DB = -3;

const LST_VIS = { min: 26, max: 44, palette: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'] };
const FLOOD_COLOR = '#2563eb';
const FREQ_PALETTE = ['#bae6fd', '#38bdf8', '#2563eb', '#1e3a8a', '#172554'];

function lastSeasonYear([startMMDD], now = new Date()) {
  const y = now.getFullYear();
  return now >= new Date(`${y}-${startMMDD}T00:00:00Z`) ? y : y - 1;
}

const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
const sarYears = (now) => range(SAR_FIRST_YEAR, lastSeasonYear(FLOOD_SEASON, now));
const lstYears = (now) => range(LST_FIRST_YEAR, lastSeasonYear(HOT_SEASON, now));
const season = (year, [a, b]) => [`${year}-${a}`, `${year}-${b}`];

function parseYear(raw, years) {
  const y = Number(raw);
  return years.includes(y) ? y : null;
}

/** Cao độ GLO-30 (m, geoid EGM2008); gán lại phép chiếu gốc để tính độ dốc đúng 30 m */
function demImage(ee) {
  const col = ee.ImageCollection(DEM_COLLECTION).select('DEM');
  return col.mosaic().setDefaultProjection(col.first().projection()).rename('elevation');
}

/** Ô PNG mã hóa Terrarium (cao độ = R*256 + G + B/256 − 32768) để trình duyệt tự giải mã như ô AWS cũ */
function terrariumImage(ee) {
  const v = demImage(ee).resample('bilinear').unmask(0).add(32768);
  const r = v.divide(256).floor();
  const g = v.floor().subtract(r.multiply(256));
  const b = v.subtract(v.floor()).multiply(256).floor();
  return ee.Image.cat([r, g, b]).rename(['r', 'g', 'b']).visualize({ bands: ['r', 'g', 'b'], min: 0, max: 255 });
}

// Vùng có thể ngập lũ: ngoài mặt nước thường xuyên (phá, sông lớn), dốc < 5°, thấp hơn 30 m
function floodPlain(ee) {
  const dem = demImage(ee);
  const permanent = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('seasonality').gte(10).unmask(0);
  return permanent.not().and(ee.Terrain.slope(dem).lt(5)).and(dem.lt(30));
}

/** 1 = pixel bị ngập ít nhất 1 lần chụp trong mùa lũ năm year, 0 = không */
function sarFloodMask(ee, wards, year) {
  const s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(wards.geometry().bounds())
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .select('VV');
  const smooth = (img) => img.focalMedian(30, 'circle', 'meters');
  const dry = smooth(s1.filterDate(...season(year, DRY_SEASON)).median());
  const wet = s1.filterDate(...season(year, FLOOD_SEASON)).map(smooth).min();
  const water = wet.lt(SAR_WATER_DB).and(wet.subtract(dry).lt(SAR_DROP_DB));
  return water.and(floodPlain(ee)).unmask(0).rename('flood').clipToCollection(wards);
}

/** Số mùa lũ (trong years) mỗi pixel bị ngập */
function sarFloodFrequency(ee, wards, years) {
  return ee.ImageCollection(years.map(y => sarFloodMask(ee, wards, y).toByte())).sum().rename('years');
}

function sarFloodVis(ee, wards, year, years) {
  if (year == null) {
    const freq = sarFloodFrequency(ee, wards, years);
    const max = Math.min(years.length, FREQ_PALETTE.length);
    return { image: freq.updateMask(freq.gt(0)).visualize({ min: 1, max, palette: FREQ_PALETTE }), legend: { min: 1, max, palette: FREQ_PALETTE } };
  }
  return { image: sarFloodMask(ee, wards, year).selfMask().visualize({ palette: [FLOOD_COLOR] }), legend: { color: FLOOD_COLOR } };
}

/** Nhiệt độ bề mặt (°C) trung vị mùa nóng, Landsat 8/9 Collection 2 Level 2, đã bỏ mây, bóng mây */
function lstImage(ee, wards, year) {
  const prep = (img) => {
    const clear = img.select('QA_PIXEL').bitwiseAnd(31).eq(0);
    return img.select('ST_B10').multiply(0.00341802).add(149).subtract(273.15).updateMask(clear).rename('lst');
  };
  return ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
    .filterBounds(wards.geometry().bounds())
    .filterDate(...season(year, HOT_SEASON))
    .filter(ee.Filter.lt('CLOUD_COVER', 70))
    .map(prep)
    .median()
    .clipToCollection(wards);
}

// Vùng phát triển mới (QCVN Mục 2.2.3.2, 2.2.3.3 chỉ áp cho đơn vị ở / nhóm nhà ở phát triển mới)
// = đất xây dựng hiện nay − đất đã xây dựng đến năm gốc:
//   hiện nay: Google Dynamic World 10 m, nhãn chiếm ưu thế tháng 1–8 (ít mây hơn mùa mưa) của 2 năm gần nhất là "built";
//   năm gốc: GAIA (Tsinghua FROM-GLC) bề mặt không thấm nước hằng năm 1985–2018, 30 m — nguồn sớm nhất đủ chi tiết.
// Tính trên lưới cố định 20 m, bỏ các mảng < ~0,5 ha (nhà lẻ, nhiễu) để ranh vùng rõ ràng.
const DEV_FROM_YEARS = [1990, 2000, 2010];
const GAIA_FIRST_YEAR = 1985;
const GAIA_LAST_YEAR = 2018;
const DEV_MONTHS = [1, 8];
const DW_BUILT = 6;
const DEV_SCALE_M = 20;
const DEV_CRS = 'EPSG:32648';
const DEV_MIN_PATCH_PX = 13;
const DEV_COLOR = '#f43f5e';
const devRecentYears = (now = new Date()) => [now.getFullYear() - 2, now.getFullYear() - 1];
const devProj = (ee) => ee.Projection(DEV_CRS).atScale(DEV_SCALE_M);

function builtNow(ee, wards) {
  const [r0, r1] = devRecentYears();
  return ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
    .filterBounds(wards.geometry().bounds())
    .filterDate(`${r0}-01-01`, `${r1 + 1}-01-01`)
    .filter(ee.Filter.calendarRange(DEV_MONTHS[0], DEV_MONTHS[1], 'month'))
    .select('label')
    .mode()
    .eq(DW_BUILT)
    .unmask(0);
}

/** 1 = đã là bề mặt không thấm nước đến hết năm year (change_year_index: 34 = 1985 … 1 = 2018) */
function builtBy(ee, year) {
  const y = Math.min(Math.max(year, GAIA_FIRST_YEAR), GAIA_LAST_YEAR);
  return ee.Image('Tsinghua/FROM-GLC/GAIA/v10').select('change_year_index').gte(GAIA_LAST_YEAR + 1 - y).unmask(0);
}

/** Ảnh 2 băng 0/1 trên lưới 20 m: dev = phát triển mới sau năm from (mảng ≥ ~0,5 ha), built = đất xây dựng hiện nay */
function newDevImage(ee, wards, from) {
  const proj = devProj(ee);
  const now = builtNow(ee, wards).reproject(proj);
  const raw = now.and(builtBy(ee, from).not()).reproject(proj);
  const patch = raw.selfMask().connectedPixelCount(DEV_MIN_PATCH_PX * 2, true).reproject(proj);
  const dev = raw.and(patch.gte(DEV_MIN_PATCH_PX).unmask(0));
  return dev.rename('dev').addBands(now.rename('built')).clipToCollection(wards);
}

/** Ảnh hiển thị: nền đỏ trong suốt + viền đậm 1 ô quanh mỗi vùng */
function newDevVis(ee, wards, from) {
  const proj = devProj(ee);
  const dev = newDevImage(ee, wards, from).select('dev');
  const edge = dev.and(dev.focalMin(1, 'square', 'pixels').not()).reproject(proj);
  return ee.ImageCollection([
    dev.selfMask().visualize({ palette: [DEV_COLOR], opacity: 0.35 }),
    edge.selfMask().visualize({ palette: [DEV_COLOR] })
  ]).mosaic();
}

// Dân số mở đối chiếu mẫu số chỉ tiêu m²/người: mỗi ảnh giữ phép chiếu gốc để tổng theo phường đếm đúng từng ô
const POP_REFS = [
  { key: 'wp', label: 'WorldPop 2020', image: (ee) => ee.ImageCollection('WorldPop/GP/100m/pop')
    .filter(ee.Filter.eq('country', 'VNM')).filter(ee.Filter.eq('year', 2020)).first().select('population') },
  { key: 'gh', label: 'GHSL 2025', image: (ee) => ee.Image('JRC/GHSL/P2023A/GHS_POP/2025').select('population_count') }
];

/** Tạo ô bản đồ từ ảnh đã visualize; ép PNG để không bị nén JPEG (sai giá trị Terrarium) */
function mapUrl(ee, visImage) {
  return new Promise((resolve, reject) => {
    ee.data.getMapId({ image: visImage, format: 'png' }, (m, err) => (err || !m ? reject(new Error(String(err || 'getMapId'))) : resolve(m.urlFormat)));
  });
}

module.exports = {
  sarYears, lstYears, parseYear, demImage, terrariumImage, sarFloodMask, sarFloodVis, lstImage, mapUrl,
  LST_VIS, FLOOD_SEASON, HOT_SEASON, POP_REFS,
  newDevImage, newDevVis, devRecentYears, DEV_FROM_YEARS, DEV_COLOR, DEV_SCALE_M, DEV_CRS
};
