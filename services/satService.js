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

// Khoanh vùng trong từng phường (QCVN Mục 2.2.3.2, 2.2.3.3 chỉ áp cho đơn vị ở / nhóm nhà ở phát triển mới):
// vùng hiện trạng = đất đã xây dựng đến năm gốc; vùng phát triển mới = đất xây dựng hiện nay − vùng hiện trạng.
//   hiện nay: Google Dynamic World 10 m, nhãn chiếm ưu thế tháng 1–8 (ít mây hơn mùa mưa) của 2 năm gần nhất là "built";
//   năm gốc: GAIA (Tsinghua FROM-GLC) bề mặt không thấm nước hằng năm 1985–2018, 30 m, hợp với GHSL GHS_BUILT_S
//   (JRC, ô 100 m, 5 năm/kỳ) để không bỏ sót khu ở xen cây xanh.
// Tính trên lưới cố định 20 m, bỏ các mảng < ~0,5 ha (nhà lẻ, nhiễu) để ranh vùng rõ ràng.
const DEV_FROM_YEARS = [2000, 2010, 2020];
const GAIA_FIRST_YEAR = 1985;
const GAIA_LAST_YEAR = 2018;
const GHSL_FIRST_EPOCH = 1975;
const GHSL_LAST_OBS_EPOCH = 2020;
const GHSL_BUILT_MIN_M2 = 1500;
const DEV_MONTHS = [1, 8];
const DW_BUILT = 6;
const DW_FIRST_YEAR = 2016;
const DEV_SCALE_M = 20;
const DEV_CRS = 'EPSG:32648';
const DEV_MIN_PATCH_PX = 13;
const DEV_COLOR = '#38bdf8';
const DEV_BASE_COLOR = '#ef4444';
const devRecentYears = (now = new Date()) => [now.getFullYear() - 2, now.getFullYear() - 1];
const devProj = (ee) => ee.Projection(DEV_CRS).atScale(DEV_SCALE_M);

// 1 = Dynamic World nhãn chiếm ưu thế tháng 1–8 các năm y0–y1 là "built"
function dwBuilt(ee, wards, y0, y1) {
  return ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
    .filterBounds(wards.geometry().bounds())
    .filterDate(`${y0}-01-01`, `${y1 + 1}-01-01`)
    .filter(ee.Filter.calendarRange(DEV_MONTHS[0], DEV_MONTHS[1], 'month'))
    .select('label')
    .mode()
    .eq(DW_BUILT)
    .unmask(0);
}

const builtNow = (ee, wards) => dwBuilt(ee, wards, ...devRecentYears());

/**
 * 1 = đã xây dựng đến năm year: GAIA đã là bề mặt không thấm nước (change_year_index: 34 = 1985 … 1 = 2018)
 * hoặc GHSL ô 100 m có diện tích công trình ≥ GHSL_BUILT_MIN_M2 (GAIA bỏ sót nhiều khu ở xen cây xanh như nội thành Huế);
 * từ DW_FIRST_YEAR hợp thêm Dynamic World năm gốc để so cùng cảm biến với hiện nay (làng xóm xen cây xanh không bị tính là mới)
 */
function builtBy(ee, wards, year) {
  const y = Math.min(Math.max(year, GAIA_FIRST_YEAR), GAIA_LAST_YEAR);
  const gaia = ee.Image('Tsinghua/FROM-GLC/GAIA/v10').select('change_year_index').gte(GAIA_LAST_YEAR + 1 - y).unmask(0);
  const epoch = Math.min(Math.max(Math.round(year / 5) * 5, GHSL_FIRST_EPOCH), GHSL_LAST_OBS_EPOCH);
  const ghsl = ee.Image(`JRC/GHSL/P2023A/GHS_BUILT_S/${epoch}`).select('built_surface').gte(GHSL_BUILT_MIN_M2).unmask(0);
  const base = gaia.or(ghsl);
  return year >= DW_FIRST_YEAR ? base.or(dwBuilt(ee, wards, Math.max(DW_FIRST_YEAR, year - 1), year)) : base;
}

// Bỏ các mảng nhỏ hơn DEV_MIN_PATCH_PX ô (nhà lẻ, nhiễu)
function dropSmallPatches(mask, proj) {
  const size = mask.selfMask().connectedPixelCount(DEV_MIN_PATCH_PX * 2, true).reproject(proj);
  return mask.and(size.gte(DEV_MIN_PATCH_PX).unmask(0));
}

/**
 * Ảnh 0/1 trên lưới 20 m: base = vùng hiện trạng (đã xây dựng đến năm from), dev = vùng phát triển mới
 * (đất xây dựng hiện nay chưa có ở năm from), built = đất xây dựng hiện nay
 */
function newDevImage(ee, wards, from) {
  const proj = devProj(ee);
  const now = builtNow(ee, wards).reproject(proj);
  const base = builtBy(ee, wards, from).reproject(proj);
  const dev = dropSmallPatches(now.and(base.not()).reproject(proj), proj);
  return dev.rename('dev')
    .addBands(dropSmallPatches(base, proj).rename('base'))
    .addBands(now.rename('built'))
    .clipToCollection(wards);
}

/** Ảnh hiển thị: vùng hiện trạng ranh đỏ, vùng phát triển mới ranh xanh (nền trong suốt + viền 1 ô) */
function newDevVis(ee, wards, from) {
  const proj = devProj(ee);
  const img = newDevImage(ee, wards, from);
  const zone = (mask, color, fillOpacity) => [
    mask.selfMask().visualize({ palette: [color], opacity: fillOpacity }),
    mask.and(mask.focalMin(1, 'square', 'pixels').not()).reproject(proj).selfMask().visualize({ palette: [color] })
  ];
  return ee.ImageCollection([...zone(img.select('base'), DEV_BASE_COLOR, 0.12), ...zone(img.select('dev'), DEV_COLOR, 0.3)]).mosaic();
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
  newDevImage, newDevVis, devRecentYears, DEV_FROM_YEARS, DEV_COLOR, DEV_BASE_COLOR, DEV_SCALE_M, DEV_CRS
};
