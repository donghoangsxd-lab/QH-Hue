// Ưu tiên trồng cây: vùng liền mạch cần chú ý (nóng, ít cây, có dân cư) và bảng phường phụ.
// Ảnh vệ tinh chỉ để khoanh vùng tham khảo. Rừng, đất nông nghiệp, mặt nước và nghĩa trang không tính.
const sat = require('./satService');

const MIN_BUILT_HA = 15;
const TREE_SCALE_M = 100;
const ZONE_SCALE_M = 30;
const NDVI_FINE_M = 10;
const ZONE_MIN_HA = 0.5;
const ZONE_LIMIT = 160;
const TREE_FIRST_YEAR = 2017;
const LST_L3 = 36.5;
const NDVI_L3 = 0.32;
const LST_L2 = 35.5;
const NDVI_L2 = 0.38;
const LST_L1 = 34;
const NDVI_L1 = 0.45;
const RES_POP_HA = 15;
const LST_REF = 30;
const LST_SPAN = 12;
const NDVI_REF = 0.55;
const NDVI_SPAN = 0.45;
const POP_PER_HA_CAP = 150;
const URBAN_MIN = 0.25;
const GHSL_BUILT_MIN = 1500;
const DW_BUILT = 6;
const DW_WATER = 0;
const DW_TREES = 1;
const DW_CROPS = 4;
const DW_SHRUB = 5;
const BLOCK_M = 20;
const CEMETERY_MIN_M = 40;
const CEMETERY_MAX_M = 600;
const CEMETERY_CAP = 120;
const DEFAULT_CEMETERY_M = 60;

const TREE_VIS = {
  min: 0,
  max: 1,
  palette: ['#1a9850', '#91cf60', '#fee08b', '#fc8d59', '#d73027']
};

const ZONE_LEVELS = [
  { id: 3, label: 'Rất cần', color: '#b91c1c', fill: 0.62 },
  { id: 2, label: 'Cần', color: '#c2410c', fill: 0.55 },
  { id: 1, label: 'Theo dõi', color: '#a16207', fill: 0.48 }
];

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

function finite(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cemeteryRadius(sizeM2) {
  const area = Number(sizeM2) > 0 ? Number(sizeM2) : Math.PI * DEFAULT_CEMETERY_M * DEFAULT_CEMETERY_M;
  return Math.round(Math.min(CEMETERY_MAX_M, Math.max(CEMETERY_MIN_M, Math.sqrt(area / Math.PI))));
}

/** Điểm nghĩa trang đã duyệt → bán kính vùng loại (m). Nhà tang lễ và hỏa táng không tính. */
function cemeteryBuffers(items) {
  const out = [];
  for (const it of items || []) {
    if (!it || it.type !== '11-NT' || it.status !== true) continue;
    if (!String(it.ntKind || '').startsWith('cemetery')) continue;
    if (!Number.isFinite(Number(it.lat)) || !Number.isFinite(Number(it.lng))) continue;
    out.push({ lat: Number(it.lat), lng: Number(it.lng), radius: cemeteryRadius(it.size) });
    if (out.length >= CEMETERY_CAP) break;
  }
  return out;
}

function acceptYear(raw, years) {
  const y = Number(raw);
  return Array.isArray(years) && years.includes(y) && y >= TREE_FIRST_YEAR ? y : null;
}

function numProp(props, keys) {
  const p = props || {};
  for (const key of keys) {
    if (p[key] == null || p[key] === '') continue;
    const n = Number(p[key]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function wardName(p) {
  return (p && (p.tenXa || p.NAME_2 || p.name)) || 'Phường';
}

/** Ghép reduceRegions nhiệt/NDVI với dân số/diện tích. Đọc cả tên band và tên có hậu tố reducer. */
function popFromPixels(danSo, urbanPix, allPix) {
  const pop = finite(danSo);
  const urban = finite(urbanPix);
  const all = finite(allPix);
  if (pop == null || pop <= 0 || all == null || all <= 0 || urban == null) return null;
  return pop * Math.min(all, Math.max(0, urban)) / all;
}

function rowsFromFeatures(meanFc, sumFc) {
  const byName = new Map();
  const take = (fc, assign) => {
    ((fc && fc.features) || []).forEach(f => {
      const p = (f && f.properties) || {};
      const name = wardName(p);
      const row = byName.get(name) || { name, builtHa: null, lst: null, ndvi: null, pop: null, danSo: null, urbanPix: null, allPix: null };
      assign(row, p);
      byName.set(name, row);
    });
  };
  take(meanFc, (row, p) => {
    const lst = numProp(p, ['lst', 'lst_mean']);
    const ndvi = numProp(p, ['ndvi', 'ndvi_mean']);
    if (lst != null) row.lst = lst;
    if (ndvi != null) row.ndvi = ndvi;
  });
  take(sumFc, (row, p) => {
    const pop = numProp(p, ['pop', 'pop_sum']);
    const builtHa = numProp(p, ['builtHa', 'builtHa_sum']);
    const danSo = numProp(p, ['danSoNum', 'danSo']);
    const urbanPix = numProp(p, ['urbanPix', 'urbanPix_sum']);
    const allPix = numProp(p, ['allPix', 'allPix_sum']);
    if (pop != null) row.pop = pop;
    if (builtHa != null) row.builtHa = builtHa;
    if (danSo != null) row.danSo = danSo;
    if (urbanPix != null) row.urbanPix = urbanPix;
    if (allPix != null) row.allPix = allPix;
  });
  return [...byName.values()];
}

/** Raster pixel cũ không cộng giá trị tô phường (sai lưới). Dân = dân số phường × pixel có dân nằm trên đất xây dựng / pixel có dân. */
function assignFallbackPop(rows) {
  return (rows || []).map(r => {
    const pop = popFromPixels(r.danSo, r.urbanPix, r.allPix);
    return pop == null ? r : { ...r, pop };
  });
}

function percentileRanks(values) {
  const n = values.length;
  if (!n) return [];
  if (n === 1) return [100];
  return values.map(v => {
    let below = 0;
    let ties = 0;
    for (const x of values) {
      if (x < v) below += 1;
      else if (x === v) ties += 1;
    }
    return 100 * (below + (ties - 1) / 2) / (n - 1);
  });
}

/**
 * rows: { name, builtHa, lst, ndvi, pop }.
 * Phường dưới 15 ha đất xây dựng, hoặc thiếu một thành phần, không xếp hạng.
 * Điểm = trung bình ba hạng bách phân (nóng hơn, NDVI thấp hơn, người/ha cao hơn).
 */
function scoreTreeWards(rows) {
  const clean = (rows || []).map(r => {
    const builtHa = finite(r.builtHa);
    const lst = finite(r.lst);
    const ndvi = finite(r.ndvi);
    const pop = finite(r.pop);
    const density = builtHa != null && builtHa > 0 && pop != null ? pop / builtHa : null;
    const eligible = builtHa != null && builtHa >= MIN_BUILT_HA && lst != null && ndvi != null && density != null;
    return { name: r.name || 'Phường', builtHa, lst, ndvi, pop, density, eligible };
  });
  const ranked = clean.filter(r => r.eligible);
  const hot = percentileRanks(ranked.map(r => r.lst));
  const lowGreen = percentileRanks(ranked.map(r => -r.ndvi));
  const dense = percentileRanks(ranked.map(r => r.density));
  let wSum = 0;
  let wHa = 0;
  ranked.forEach(r => { wSum += r.lst * r.builtHa; wHa += r.builtHa; });
  const cityLst = wHa ? wSum / wHa : null;
  const index = new Map(ranked.map((r, i) => [r, i]));
  const out = clean.map(r => {
    const lstGap = cityLst != null && r.lst != null ? r.lst - cityLst : null;
    const base = {
      name: r.name,
      builtHa: r.builtHa == null ? null : round1(r.builtHa),
      lst: r.lst == null ? null : round1(r.lst),
      ndvi: r.ndvi == null ? null : round2(r.ndvi),
      pop: r.pop == null ? null : Math.round(r.pop),
      density: r.density == null ? null : Math.round(r.density),
      lstGap: lstGap == null ? null : round1(lstGap),
      rank: null,
      score: null
    };
    if (!r.eligible) {
      return { ...base, note: 'Đất xây dựng ước tính dưới 15 ha nên không xếp hạng.' };
    }
    const i = index.get(r);
    return {
      ...base,
      score: Math.round((hot[i] + lowGreen[i] + dense[i]) / 3),
      hot: Math.round(hot[i]),
      lowGreen: Math.round(lowGreen[i]),
      dense: Math.round(dense[i])
    };
  });
  out.sort((a, b) => {
    if (a.score == null && b.score == null) return a.name.localeCompare(b.name, 'vi');
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name, 'vi');
  });
  let rank = 0;
  out.forEach(r => { if (r.score != null) r.rank = ++rank; });
  return { cityLst: cityLst == null ? null : round1(cityLst), ranked: rank, wards: out };
}

function firstNum(ee, feature, keys) {
  return keys.slice(1).reduce(
    (acc, key) => ee.Algorithms.If(ee.Algorithms.IsEqual(acc, null), feature.get(key), acc),
    feature.get(keys[0])
  );
}

function namedFeature(ee, feature, fields) {
  const props = {};
  Object.entries(fields).forEach(([out, keys]) => { props[out] = firstNum(ee, feature, keys); });
  return ee.Feature(null).copyProperties(feature).set(props);
}

function blockMean(ee, img, coarse) {
  return img.setDefaultProjection({ crs: 'EPSG:32648', scale: BLOCK_M })
    .reduceResolution({ reducer: ee.Reducer.mean(), maxPixels: 64, bestEffort: true })
    .reproject({ crs: 'EPSG:32648', scale: coarse });
}

function urbanMask(ee, wards, year, cemeteryImg) {
  const dw = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
    .filterBounds(wards.geometry().bounds())
    .filterDate(`${year}-01-01`, `${year + 1}-01-01`)
    .filter(ee.Filter.calendarRange(1, 8, 'month'))
    .select('label')
    .mode();
  const ghsl = ee.Image('JRC/GHSL/P2023A/GHS_BUILT_S/2020').select('built_surface').unmask(0).gte(GHSL_BUILT_MIN);
  const water = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('seasonality').unmask(0).gte(10)
    .or(dw.eq(DW_WATER).unmask(0));
  const forestFarm = dw.eq(DW_TREES).or(dw.eq(DW_CROPS)).or(dw.eq(DW_SHRUB)).unmask(0);
  let urban = dw.eq(DW_BUILT).unmask(0).or(ghsl.and(forestFarm.not())).and(water.not());
  if (cemeteryImg) urban = urban.and(cemeteryImg.not());
  return urban.rename('urban').clipToCollection(wards);
}

function lotHead(code) {
  const m = String(code || '').toUpperCase().match(/[A-Z]+/);
  return m ? m[0] : '';
}

function marketName(name) {
  const nm = String(name || '').toUpperCase();
  return nm.includes('CHỢ') || /(^|[^A-Z])CHO([^A-Z]|$)/.test(nm);
}

/** Loại đất ước tính. Mã lô (nếu có) ưu tiên hơn mật độ. */
function landKind({ lotCode, facilityType, name, density, ndvi } = {}) {
  const head = lotHead(lotCode);
  const type = String(facilityType || '');
  if (head === 'DGD' || type === '3-MN' || type === '4-TH' || type === '5-THCS' || type === '6-THPT') return 'sân trường';
  if (head === 'TMD' || type === '9-TM' || marketName(name)) return 'khu chợ';
  if (head === 'DGT' || head === 'GT') return 'dải phố';
  if (head === 'DTT' || type === '8-VH') return 'sân thể thao';
  const dense = finite(density);
  if (head === 'ODT' || head === 'ONT' || (dense != null && dense >= 40)) return 'khu ở';
  const green = finite(ndvi);
  if (dense != null && dense >= RES_POP_HA && green != null && green < 0.28) return 'sân, bãi';
  return 'khu dân cư';
}

/** Mức 3/2/1 theo ngưỡng cố định mùa nóng 2025. Không đủ điều kiện thì 0 (ẩn). */
function zoneLevel(lst, ndvi, residential) {
  if (residential !== true) return 0;
  const t = finite(lst);
  const n = finite(ndvi);
  if (t == null || n == null) return 0;
  if (t >= LST_L3 && n <= NDVI_L3) return 3;
  if (t >= LST_L2 && n <= NDVI_L2) return 2;
  if (t >= LST_L1 && n <= NDVI_L1) return 1;
  return 0;
}

function usableGeom(g) {
  return !!g && (g.type === 'Polygon' || g.type === 'MultiPolygon') && Array.isArray(g.coordinates) && g.coordinates.length > 0;
}

/** GeoJSON reduceToVectors → vùng đã sắp mức cao rồi diện tích lớn. Bỏ mảnh dưới 0,5 ha. */
function normalizeZones(fc, city) {
  const cityLst = finite(city && (city.lst != null ? city.lst : city.lst_mean));
  const zones = [];
  (((fc && fc.features) || [])).forEach(f => {
    const p = (f && f.properties) || {};
    const level = numProp(p, ['level', 'level_mean', 'label']);
    const ha = numProp(p, ['ha', 'ha_mean']);
    if (level == null || level < 1 || ha == null || ha < ZONE_MIN_HA || !usableGeom(f && f.geometry)) return;
    const lst = numProp(p, ['lst', 'lst_mean']);
    const ndvi = numProp(p, ['ndvi', 'ndvi_mean']);
    const popHa = numProp(p, ['popHa', 'popHa_mean']);
    const lat = numProp(p, ['lat', 'lat_mean']);
    const lng = numProp(p, ['lng', 'lng_mean']);
    zones.push({
      level: Math.round(level),
      ha: round2(ha),
      lst: lst == null ? null : round1(lst),
      ndvi: ndvi == null ? null : round2(ndvi),
      popHa: popHa == null ? null : round1(popHa),
      pop: popHa == null ? null : Math.round(popHa * ha),
      lat,
      lng,
      ward: p.ward || p.tenXa || '',
      lstGap: cityLst != null && lst != null ? round1(lst - cityLst) : null,
      geometry: f.geometry
    });
  });
  zones.sort((a, b) => b.level - a.level || b.ha - a.ha);
  return zones.slice(0, ZONE_LIMIT).map((z, i) => ({ id: i + 1, ...z }));
}

function cemeteryImage(ee, buffers) {
  if (!buffers || !buffers.length) return null;
  const fc = ee.FeatureCollection(buffers.map(b => ee.Feature(
    ee.Geometry.Point([b.lng, b.lat]).buffer(b.radius)
  )));
  return ee.Image(0).byte().paint(fc, 1).unmask(0);
}

/**
 * vis: điểm 0–1 trên ô ~100 m, chỉ nơi đất xây dựng chiếm ≥ 25% ô.
 * meanFc / sumFc: nhiệt, NDVI, dân, ha đất xây dựng theo phường.
 * Thang màu cố định (30–42 °C, NDVI 0,55–0,10, 0–150 người/ha), không phải hạng bách phân của bảng.
 */
function buildTreeRequest(ee, wards, popImage, popCrs, popScale, popPeople, year, buffers) {
  const scale = popScale || 30;
  const crs = popCrs || ee.Projection('EPSG:32648').atScale(scale);
  const cem = cemeteryImage(ee, buffers);
  const urban = urbanMask(ee, wards, year, cem);
  const lst = sat.lstImage(ee, wards, year).updateMask(urban).rename('lst');
  const ndvi = sat.ndviImage(ee, wards, year).updateMask(urban).rename('ndvi');
  const hot = lst.subtract(LST_REF).divide(LST_SPAN).clamp(0, 1);
  const lowG = ee.Image(NDVI_REF).subtract(ndvi).divide(NDVI_SPAN).clamp(0, 1);
  const perHa = popImage.unmask(0)
    .reproject({ crs, scale })
    .divide(scale * scale)
    .multiply(10000)
    .updateMask(urban);
  const dense = perHa.divide(POP_PER_HA_CAP).clamp(0, 1);
  const score = hot.add(lowG).add(dense).divide(3);
  const urbanF = blockMean(ee, urban.unmask(0), TREE_SCALE_M);
  const vis = blockMean(ee, score, TREE_SCALE_M).updateMask(urbanF.gte(URBAN_MIN)).clipToCollection(wards);

  const meanFc = lst.addBands(ndvi).reduceRegions({
    collection: wards,
    reducer: ee.Reducer.mean(),
    scale: TREE_SCALE_M,
    crs: 'EPSG:32648',
    tileScale: 4
  }).map(f => namedFeature(ee, f, { lst: ['lst', 'lst_mean'], ndvi: ['ndvi', 'ndvi_mean'] }));

  const sumOpts = {
    collection: wards,
    reducer: ee.Reducer.sum().unweighted(),
    scale,
    tileScale: 4
  };
  let sumImg;
  let sumFields;
  if (popPeople) {
    const urbanOnPop = urban.reproject({ crs, scale }).unmask(0);
    sumImg = popImage.unmask(0).multiply(urbanOnPop).rename('pop')
      .addBands(urbanOnPop.multiply(ee.Image.pixelArea()).divide(1e4).rename('builtHa'));
    sumFields = { pop: ['pop', 'pop_sum'], builtHa: ['builtHa', 'builtHa_sum'] };
    sumOpts.crs = crs;
  } else {
    const pix = popImage.mask().gt(0).unmask(0);
    const urban01 = urban.unmask(0);
    sumImg = pix.multiply(urban01).rename('urbanPix')
      .addBands(pix.rename('allPix'))
      .addBands(urban01.multiply(ee.Image.pixelArea()).divide(1e4).rename('builtHa'));
    sumFields = {
      urbanPix: ['urbanPix', 'urbanPix_sum'],
      allPix: ['allPix', 'allPix_sum'],
      builtHa: ['builtHa', 'builtHa_sum']
    };
  }
  const sumFc = sumImg.reduceRegions(sumOpts).map(f => namedFeature(ee, f, sumFields));

  return { vis, meanFc, sumFc, cellM: TREE_SCALE_M };
}

/**
 * Vùng ưu tiên trên lưới 30 m: chỉ ô nóng, ít cây và có dân cư.
 * NDVI 10 m lấy trung bình về lưới nhiệt. Làm trơn 3×3; mảng dưới 0,5 ha bị loại sau khi vẽ vùng.
 * Không dùng connectedPixelCount: phép đó vượt bộ nhớ Earth Engine trên cả tỉnh.
 * Tên phường gán sau khi đã giới hạn 160 vùng lớn nhất.
 */
function buildZoneRequest(ee, wards, popImage, popCrs, popScale, popPeople, year, buffers) {
  const proj = ee.Projection('EPSG:32648').atScale(ZONE_SCALE_M);
  const region = wards.geometry();
  const scale = popScale || ZONE_SCALE_M;
  const crs = popCrs || proj;
  const cem = cemeteryImage(ee, buffers);
  const urban = urbanMask(ee, wards, year, cem);
  const lst30 = sat.lstImage(ee, wards, year).reproject(proj).rename('lst');
  const ndvi = sat.ndviImage(ee, wards, year)
    .setDefaultProjection({ crs: 'EPSG:32648', scale: NDVI_FINE_M })
    .reduceResolution({ reducer: ee.Reducer.mean(), maxPixels: 16, bestEffort: true })
    .reproject(proj)
    .rename('ndvi');
  let popHa;
  let residential;
  if (popPeople) {
    popHa = popImage.unmask(0).reproject({ crs, scale }).divide(scale * scale).multiply(10000);
    residential = popHa.gte(RES_POP_HA);
  } else {
    residential = popImage.mask();
    popHa = popImage.unmask(0).divide(scale * scale).multiply(10000);
  }
  const res30 = residential.unmask(0).reproject(proj);
  const urban30 = urban.unmask(0).reproject(proj);
  const blank = ee.Image(0).setDefaultProjection(proj);
  const hot = res30.gt(0).and(urban30);
  let level = blank.where(hot.and(lst30.gte(LST_L1)).and(ndvi.lte(NDVI_L1)), 1);
  level = level.where(hot.and(lst30.gte(LST_L2)).and(ndvi.lte(NDVI_L2)), 2);
  level = level.where(hot.and(lst30.gte(LST_L3)).and(ndvi.lte(NDVI_L3)), 3);
  const smooth = level.unmask(0).focalMode(1, 'square', 'pixels').multiply(urban30).toInt().rename('level');
  const zoned = smooth.updateMask(smooth.gt(0)).clip(region);

  const vectors = zoned.reduceToVectors({
    geometry: region,
    crs: 'EPSG:32648',
    scale: ZONE_SCALE_M,
    geometryType: 'polygon',
    eightConnected: true,
    labelProperty: 'level',
    maxPixels: 1e8,
    tileScale: 16
  });
  const ranked = vectors.map(f => {
    const geom = f.geometry().simplify(20);
    const ha = geom.area(1).divide(1e4);
    const rankKey = ee.Number(f.get('level')).multiply(100000).add(ha);
    return ee.Feature(geom).set({ level: f.get('level'), ha, rankKey });
  }).filter(ee.Filter.gte('ha', ZONE_MIN_HA)).limit(ZONE_LIMIT, 'rankKey', false);

  const shaped = ranked.map(f => {
    const centroid = f.geometry().centroid(1);
    const coords = centroid.coordinates();
    const hit = wards.filterBounds(centroid);
    const ward = ee.Algorithms.If(hit.size().gt(0), hit.first().get('tenXa'), '');
    return f.set({ lat: coords.get(1), lng: coords.get(0), ward });
  });

  const zones = lst30.addBands(ndvi).addBands(popHa.rename('popHa')).reduceRegions({
    collection: shaped,
    reducer: ee.Reducer.mean(),
    scale: ZONE_SCALE_M,
    crs: 'EPSG:32648',
    tileScale: 16
  });
  const city = lst30.updateMask(urban).addBands(ndvi.updateMask(urban)).reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: region,
    scale: 100,
    crs: 'EPSG:32648',
    maxPixels: 1e8,
    tileScale: 8,
    bestEffort: true
  });
  return { zones, city, scaleM: ZONE_SCALE_M };
}

module.exports = {
  MIN_BUILT_HA,
  TREE_SCALE_M,
  ZONE_SCALE_M,
  ZONE_MIN_HA,
  TREE_FIRST_YEAR,
  TREE_VIS,
  ZONE_LEVELS,
  cemeteryRadius,
  cemeteryBuffers,
  acceptYear,
  rowsFromFeatures,
  popFromPixels,
  assignFallbackPop,
  scoreTreeWards,
  zoneLevel,
  landKind,
  normalizeZones,
  buildTreeRequest,
  buildZoneRequest
};
