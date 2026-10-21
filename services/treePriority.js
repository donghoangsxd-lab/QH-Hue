// Ưu tiên trồng cây: điểm tương đối giữa các phường, xã (nóng + ít cây + đông trên đất xây dựng).
// Ảnh vệ tinh chỉ để xếp hạng tham khảo. Rừng và đất nông nghiệp không vào mẫu số.
const sat = require('./satService');

const MIN_BUILT_HA = 15;
const TREE_SCALE_M = 100;
const TREE_FIRST_YEAR = 2017;
const LST_REF = 30;
const LST_SPAN = 12;
const NDVI_REF = 0.55;
const NDVI_SPAN = 0.45;
const POP_PER_HA_CAP = 150;
const URBAN_MIN = 0.25;
const GHSL_BUILT_MIN = 1500;
const DW_BUILT = 6;
const DW_WATER = 0;
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
function rowsFromFeatures(meanFc, sumFc) {
  const byName = new Map();
  const take = (fc, assign) => {
    ((fc && fc.features) || []).forEach(f => {
      const p = (f && f.properties) || {};
      const name = wardName(p);
      const row = byName.get(name) || { name, builtHa: null, lst: null, ndvi: null, pop: null };
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
    if (pop != null) row.pop = pop;
    if (builtHa != null) row.builtHa = builtHa;
  });
  return [...byName.values()];
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
  let urban = dw.eq(DW_BUILT).unmask(0).or(ghsl).and(water.not());
  if (cemeteryImg) urban = urban.and(cemeteryImg.not());
  return urban.rename('urban').clipToCollection(wards);
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
function buildTreeRequest(ee, wards, popImage, popCrs, popScale, year, buffers) {
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

  const urbanOnPop = urban.reproject({ crs, scale }).unmask(0);
  const pop = popImage.unmask(0).multiply(urbanOnPop).rename('pop');
  const builtHa = urbanOnPop.multiply(ee.Image.pixelArea()).divide(1e4).rename('builtHa');
  const sumFc = pop.addBands(builtHa).reduceRegions({
    collection: wards,
    reducer: ee.Reducer.sum().unweighted(),
    scale,
    crs,
    tileScale: 4
  }).map(f => namedFeature(ee, f, { pop: ['pop', 'pop_sum'], builtHa: ['builtHa', 'builtHa_sum'] }));

  return { vis, meanFc, sumFc, cellM: TREE_SCALE_M };
}

module.exports = {
  MIN_BUILT_HA,
  TREE_SCALE_M,
  TREE_FIRST_YEAR,
  TREE_VIS,
  cemeteryRadius,
  cemeteryBuffers,
  acceptYear,
  rowsFromFeatures,
  scoreTreeWards,
  buildTreeRequest
};
