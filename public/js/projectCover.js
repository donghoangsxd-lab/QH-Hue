// Độ phủ hạ tầng trong chế độ xem thông tin đồ án: buffer bán kính QCVN từ lô TT16,
// cắt theo ranh → overlay xanh/đỏ; ước dân số đất ở ngoài bán kính.
import { map } from './mapEngine.js';
import { planMap } from './planMap.js';
import { cachedLots } from './projectFiles.js';
import { landPatternKey } from './tt16Symbols.js';
import { reviewRowsFor, REVIEW_ROWS } from './projectReviewCore.js';
import { parkTierOf } from './state.js';
import { isLevelPair } from './splitPair.js';

const COVER_PANE = 'projectCoverPane';
const COVER_Z = 450;
const GREEN = { color: '#16a34a', weight: 1, opacity: 0.85, fillColor: '#22c55e', fillOpacity: 0.35 };
const RED = { color: '#dc2626', weight: 1, opacity: 0.85, fillColor: '#ef4444', fillOpacity: 0.32 };

/** Khóa thẩm định → khóa TT16 trên lô */
const TYPE_PATTERNS = {
  '3-MN': ['3-MN'],
  '4-TH': ['4-TH'],
  '5-THCS': ['5-THCS'],
  THPT: ['6-THPT'],
  YT_DT: ['7-YT'],
  YT_DV: ['7-YT'],
  VH_DT: ['8-VH', 'TDTT'],
  VH_DV: ['8-VH', 'TDTT'],
  TM_DT: ['9-TM'],
  TM_DV: ['9-TM'],
  CV_DT: ['1-CV'],
  CV_DV: ['1-CV'],
  BDX_DT: ['2-BDX'],
  BDX_DV: ['2-BDX']
};

const HOUSING_PATTERNS = new Set(['O-NO', 'O-HH', 'O-LX']);
const ROW_BY_KEY = Object.fromEntries(REVIEW_ROWS.map(r => [r.key, r]));

const coverLayers = new Map();

function shownMaps() {
  const list = [map];
  if (isLevelPair() && planMap) list.push(planMap);
  return list.filter(Boolean);
}

function feat(geom) {
  return geom?.type === 'Feature' ? geom : turf.feature(geom);
}

function geomOf(f) {
  return f?.type === 'Feature' ? f.geometry : f;
}

/** Turf 6: hai Feature; Turf 7: FeatureCollection — dùng được cả CDN (6.5) và @turf/turf Node (7). */
function polyPair(op, a, b) {
  const fa = feat(a);
  const fb = feat(b);
  try {
    const hit = turf[op](fa, fb);
    if (hit) return hit;
  } catch (e) { /* API v7 */ }
  try {
    return turf[op](turf.featureCollection([fa, fb]));
  } catch (e2) {
    return null;
  }
}

function unionAll(features) {
  const list = (features || []).filter(Boolean).map(feat);
  if (!list.length || typeof turf === 'undefined') return null;
  let level = list;
  const failed = [];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 >= level.length) { next.push(level[i]); continue; }
      const u = polyPair('union', level[i], level[i + 1]);
      if (u) next.push(u);
      else { next.push(level[i]); failed.push(level[i + 1]); }
    }
    level = next;
  }
  let acc = level[0] || null;
  failed.forEach(f => {
    if (!acc) { acc = f; return; }
    acc = polyPair('union', acc, f) || acc;
  });
  return acc;
}

function lotCenter(lot) {
  const lat = Number(lot.lat);
  const lng = Number(lot.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return [lng, lat];
  if (!lot.geometry || typeof turf === 'undefined') return null;
  try {
    const c = turf.centroid(feat(lot.geometry));
    const [x, y] = c?.geometry?.coordinates || [];
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  } catch (e) {
    return null;
  }
}

function lotAreaM2(lot) {
  const a = Number(lot.area);
  if (a > 0) return a;
  if (!lot.geometry || typeof turf === 'undefined') return 0;
  try { return turf.area(feat(lot.geometry)); } catch (e) { return 0; }
}

function radiusForType(typeKey, lot) {
  if (typeKey === 'CV_DT' || typeKey === 'CV_DV') {
    return parkTierOf(lotAreaM2(lot), typeKey === 'CV_DT' ? 'Cấp đô thị' : 'Cấp đơn vị ở').radius;
  }
  const row = ROW_BY_KEY[typeKey];
  return row && row.radius > 0 ? row.radius : 0;
}

function patternOf(lot) {
  return landPatternKey(lot.layer, lot.name || lot.lotCode || '');
}

function reviewKindOf(level) {
  return level === 'QHC' ? 'QHC' : 'QHPK';
}

/** Options droplist: dòng thẩm định có bán kính, bỏ sumOf / radius 0. */
export function listCoverTypes(kind, pop) {
  return reviewRowsFor(reviewKindOf(kind), pop)
    .filter(r => !r.sumOf && Number(r.radius) > 0)
    .map(r => ({ key: r.key, label: r.label, radius: r.radius }));
}

/**
 * Tính vùng phủ / khoảng trống và ước dân số đất ở chưa tiếp cận.
 * @returns {null|{ coveredGeom, gapGeom, housingM2, gapHousingM2, coveredHousingM2, housingCoverPct, density, peopleUnserved, facilityCount, radiusM, popUsed, label }}
 */
export function computeProjectCover({ boundary, lots, typeKey, pop, label }) {
  if (!boundary || !typeKey || typeof turf === 'undefined') return null;
  const patterns = TYPE_PATTERNS[typeKey];
  if (!patterns?.length) return null;
  const want = new Set(patterns);
  const row = ROW_BY_KEY[typeKey];
  const people = Number(pop?.qh) > 0 ? Number(pop.qh) : (Number(pop?.ht) > 0 ? Number(pop.ht) : 0);
  const list = Array.isArray(lots) ? lots : [];

  const facilities = [];
  const housingFeats = [];
  list.forEach(lot => {
    if (!lot?.geometry) return;
    const key = patternOf(lot);
    if (HOUSING_PATTERNS.has(key)) {
      try { housingFeats.push(feat(lot.geometry)); } catch (e) { /* bỏ lô lỗi */ }
    }
    if (!want.has(key)) return;
    const center = lotCenter(lot);
    const radius = radiusForType(typeKey, lot);
    if (!center || !(radius > 0)) return;
    facilities.push({ center, radius });
  });

  const buffers = facilities.map(({ center, radius }) => {
    try { return turf.buffer(turf.point(center), radius, { units: 'meters' }); } catch (e) { return null; }
  }).filter(Boolean);

  const host = feat(boundary);
  const coveredUnion = unionAll(buffers);
  let coveredGeom = null;
  let gapGeom = null;
  if (coveredUnion) {
    coveredGeom = geomOf(polyPair('intersect', coveredUnion, host));
    gapGeom = geomOf(polyPair('difference', host, coveredUnion));
  } else {
    gapGeom = geomOf(host);
  }

  const housingUnion = unionAll(housingFeats);
  let housingM2 = 0;
  let gapHousingM2 = 0;
  let coveredHousingM2 = 0;
  if (housingUnion) {
    try { housingM2 = turf.area(housingUnion); } catch (e) { housingM2 = 0; }
    if (coveredGeom) {
      const hit = polyPair('intersect', housingUnion, feat(coveredGeom));
      coveredHousingM2 = hit ? turf.area(hit) : 0;
    }
    gapHousingM2 = Math.max(0, housingM2 - coveredHousingM2);
  }

  const density = housingM2 > 0 && people > 0 ? people / housingM2 : null;
  const peopleUnserved = density != null ? Math.round(density * gapHousingM2) : null;
  const housingCoverPct = housingM2 > 0
    ? Math.round(Math.min(100, coveredHousingM2 / housingM2 * 100) * 10) / 10
    : null;
  const radiusM = row?.radius || (facilities[0]?.radius) || 0;

  return {
    coveredGeom,
    gapGeom,
    housingM2,
    gapHousingM2,
    coveredHousingM2,
    housingCoverPct,
    density,
    peopleUnserved,
    facilityCount: facilities.length,
    radiusM,
    popUsed: people,
    label: label || row?.label || typeKey
  };
}

function ensurePane(m) {
  let pane = m.getPane(COVER_PANE);
  if (!pane) {
    pane = m.createPane(COVER_PANE);
    pane.style.zIndex = String(COVER_Z);
    pane.style.pointerEvents = 'none';
  }
  return pane;
}

function paintGeom(group, geom, style) {
  if (!geom) return;
  try {
    group.addLayer(L.geoJSON(geom, {
      style,
      interactive: false,
      pane: COVER_PANE
    }));
  } catch (e) { /* geom lỗi */ }
}

/** Vẽ overlay xanh/đỏ trên mọi bản đồ đang hiện; gỡ lớp cũ trước. */
export function showProjectCover(result) {
  clearProjectCover();
  if (!result) return;
  shownMaps().forEach(m => {
    ensurePane(m);
    const group = L.featureGroup();
    paintGeom(group, result.gapGeom, RED);
    paintGeom(group, result.coveredGeom, GREEN);
    group.addTo(m);
    coverLayers.set(m, group);
  });
}

/** Gỡ overlay độ phủ trên mọi bản đồ. */
export function clearProjectCover() {
  coverLayers.forEach((group, m) => {
    try {
      group.clearLayers();
      m.removeLayer(group);
    } catch (e) { /* đã gỡ */ }
  });
  coverLayers.clear();
}

/** Lô đã cache của đồ án (HT+QH có geometry). */
export function coverLotsOf(tenQH) {
  return cachedLots(tenQH);
}
