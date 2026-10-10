// Thẩm định điều chỉnh cục bộ (nút Thẩm định đồ án → Điều chỉnh).
// Bước 1: ranh DXF phải nằm trong đồ án đã chọn.
// Bước 2: diện tích từng loại đất trong ranh, trừ phần cũ cộng phần hatch mới.
// Bước 3: cộng số tăng/giảm vào tổng cả đồ án rồi chấm lại % QCVN. Dưới 100% → Không đảm bảo.
// Bước 4: độ phủ = đất ở nằm trong bán kính phục vụ của hạ tầng đồ án. Chạy ngầm, chỉ báo khi giảm xuống dưới 100%.
// Kết quả dựng thành tờ bản vẽ (hai bản vẽ trước / sau, bảng đất, bảng chỉ tiêu, cột ký hiệu, khung tên), xuất PDF A3. Không ghi Sheet.
// Đồng ý thì Nhập hồ sơ: ranh + lô mới (+ PDF scan) lưu bucket qua adjustLayer.js, người dùng thường vào hàng chờ Admin duyệt.
import { state } from './state.js';
import { map } from './mapEngine.js';
import { parseDxf, buildParcels, CRS_PRESETS, layerToType } from './cadImport.js';
import { attachBasemap, detachBasemap } from './basemap.js';
import { escapeHtml, fmtNum, ico, showToast, loadHtml2Canvas, loadHtml2Pdf } from './utils.js';
import { setBottomPanelCollapsed } from './uiComponents.js';
import { dismissReviewHost, reviewHostDirty } from './projectReview.js';
import { projectLayersOf, cachedLots } from './projectFiles.js';
import { landPatternKey } from './tt16Symbols.js';
import { sendAdjustment, pdfProblem } from './adjustLayer.js';
import {
  REVIEW_MAX_BYTES, LANDUSE_TABLES, classifyLand, landRowByKey, landSubKey,
  decisionKind, presetDecision, tagParcel, lotRadius, scoreRows, rowLabel, landSymbol, UNDETERMINED_KEY,
  savedLandTag, savedLotType
} from './projectReviewCore.js';

const POP_KEY = 'qh_project_pop_v1';
const INSIDE_MIN = 0.98;
const SLIVER_M2 = 5;
const BOUNDARY_TOKEN = new Set(['RANH', 'RANHGIOI', 'BOUNDARY', 'PHAMVI', 'KHUVUC', 'DIEUCHINH']);

// Tờ A3 ngang ở 96 dpi (420 × 297 mm); cao 1122 px để html2pdf không tràn sang trang 2
const A3_W = 1587, A3_H = 1122;

const $ = (id) => document.getElementById(id);
let minis = [];
let sheet = null;
let pdfBusy = false;

function tokensOf(name) {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
    .toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
}

function isBoundaryLayer(name) {
  return tokensOf(name).some(t => BOUNDARY_TOKEN.has(t));
}

function kindOf(name) {
  const s = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
  return /(^|[^a-z])qhc([^a-z]|$)|quy hoach chung/.test(s) ? 'QHC' : 'QHPK';
}

function storedPop(name) {
  try {
    const all = JSON.parse(localStorage.getItem(POP_KEY) || '{}') || {};
    return Number(all[name] && all[name].qh) || 0;
  } catch (e) { return 0; }
}

function rememberPop(project, popQH) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(POP_KEY) || '{}') || {}; } catch (e) { all = {}; }
  const prev = all[project] || {};
  all[project] = { ht: Number(prev.ht) || 0, qh: popQH };
  try { localStorage.setItem(POP_KEY, JSON.stringify(all)); } catch (e) { /* đầy bộ nhớ */ }
}

function haOf(m2) {
  return Math.round((Number(m2) || 0) / 100) / 100;
}

function bboxOf(feature) {
  try { return turf.bbox(feature); } catch (e) { return null; }
}

function bboxHit(a, b) {
  return !!(a && b && a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]);
}

function unionFeatures(features) {
  let acc = null;
  features.forEach(f => {
    if (!f) return;
    if (!acc) { acc = f; return; }
    try { acc = turf.union(acc, f) || acc; } catch (e) { /* giữ khối đã gộp */ }
  });
  return acc;
}

function featureFromPolygons(polygons) {
  try {
    const g = polygons.length === 1
      ? { type: 'Polygon', coordinates: polygons[0] }
      : { type: 'MultiPolygon', coordinates: polygons };
    return turf.feature(g);
  } catch (e) { return null; }
}

function closeRing(ring) {
  const pts = (ring || []).filter(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (pts.length < 3) return null;
  const a = pts[0], b = pts[pts.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return pts.length >= 4 ? pts : null;
  return [...pts, a];
}

function asFeature(geom) {
  if (!geom) return null;
  try {
    if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') return turf.feature(geom);
    const lines = geom.type === 'LineString' ? [geom.coordinates]
      : geom.type === 'MultiLineString' ? geom.coordinates : [];
    const polys = [];
    lines.forEach(line => {
      const ring = closeRing(line);
      if (!ring) return;
      try { polys.push(turf.polygon([ring])); } catch (e) { /* vòng hỏng */ }
    });
    return polys.length ? unionFeatures(polys) : null;
  } catch (e) { return null; }
}

function anchorOf(feature, fallback) {
  try {
    const [lng, lat] = turf.pointOnFeature(feature).geometry.coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  } catch (e) { /* giữ tâm cũ */ }
  return { lat: fallback.lat, lng: fallback.lng };
}

function intersectArea(feature, mask, maskBox) {
  if (!feature || !bboxHit(bboxOf(feature), maskBox)) return 0;
  try {
    const hit = turf.intersect(feature, mask);
    return hit ? turf.area(hit) : 0;
  } catch (e) { return 0; }
}

function containsPoint(feature, lng, lat) {
  try { return turf.booleanPointInPolygon(turf.point([lng, lat]), feature); } catch (e) { return false; }
}

function insideRatio(inner, outer) {
  try {
    const base = turf.area(inner);
    if (!(base > 0)) return 0;
    const hit = turf.intersect(inner, outer);
    return hit ? Math.min(1, turf.area(hit) / base) : 0;
  } catch (e) { return 0; }
}

function extentOf(entry, lots) {
  const bound = asFeature(entry && entry.boundary);
  if (bound) return { feature: bound, how: 'ranh' };
  const boxes = lots.map(l => bboxOf(l.feature)).filter(Boolean);
  if (!boxes.length) return null;
  const pad = 0.0004;
  const box = [
    Math.min(...boxes.map(b => b[0])) - pad,
    Math.min(...boxes.map(b => b[1])) - pad,
    Math.max(...boxes.map(b => b[2])) + pad,
    Math.max(...boxes.map(b => b[3])) + pad
  ];
  try { return { feature: turf.bboxPolygon(box), how: 'khung' }; } catch (e) { return null; }
}

function parcelsOf(entities, crs) {
  if (!entities.length) return [];
  const built = buildParcels(entities, { crs });
  if (!built.axes.valid) throw new Error('Tọa độ không nằm trong vùng VN-2000 của Huế — kiểm tra hệ tọa độ');
  return built.parcels.filter(p => p.polygons && p.polygons.length).map((p, i) => {
    const feature = featureFromPolygons(p.polygons);
    if (!feature) return null;
    let area = Number(p.area) || 0;
    try { area = turf.area(feature); } catch (e) { /* giữ diện tích DXF */ }
    return { id: `dxf${i}`, layer: p.layer, kind: p.kind, lat: p.lat, lng: p.lng, area, feature };
  }).filter(Boolean);
}

function splitDrawing(entities, crs) {
  const all = parcelsOf(entities, crs);
  const hatches = all.filter(p => p.kind === 'HATCH' && !isBoundaryLayer(p.layer));
  if (!hatches.length) throw new Error('File không có hatch sử dụng đất.');
  let parts = all.filter(p => isBoundaryLayer(p.layer));
  if (!parts.length) {
    const lines = all.filter(p => p.kind !== 'HATCH');
    let best = null, bestN = -1;
    lines.forEach(line => {
      const n = hatches.filter(h => containsPoint(line.feature, h.lng, h.lat)).length;
      if (n > bestN) { best = line; bestN = n; }
    });
    const need = Math.max(1, Math.ceil(hatches.length * 0.8));
    if (!best || bestN < need) {
      throw new Error('Không thấy ranh giới khu vực điều chỉnh. Đặt polyline kín hoặc hatch ranh trên layer có chữ RANH.');
    }
    parts = [best];
  }
  const mask = unionFeatures(parts.map(p => p.feature));
  if (!mask) throw new Error('Không dựng được vùng ranh điều chỉnh.');
  const maskBox = bboxOf(mask);
  const inside = hatches.filter(h => containsPoint(mask, h.lng, h.lat) || intersectArea(h.feature, mask, maskBox) >= 1);
  if (!inside.length) throw new Error('Không có hatch sử dụng đất nào nằm trong ranh điều chỉnh.');
  return { mask, maskBox, hatches: inside };
}

function tagStored(p, i, kind, pop) {
  if (!p || !p.geometry || (p.phase === 'QH' ? 'QH' : 'HT') !== 'QH') return null;
  let feature = null;
  try { feature = turf.feature(p.geometry); } catch (e) { return null; }
  let lat = Number(p.lat), lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    try { [lng, lat] = turf.pointOnFeature(feature).geometry.coordinates; } catch (e) { return null; }
  }
  let area = Number(p.area);
  if (!(area > 0)) { try { area = turf.area(feature); } catch (e) { return null; } }
  const layer = String(p.layer || '');
  const name = String(p.name || '');
  const pattern = landPatternKey(layer, name);
  const infra = p.kind !== 'DXF';
  const auto = savedLandTag(kind, pattern, infra);
  const lot = {
    id: `old${i}`, phase: 'QH', layer, name, area, lat, lng, feature, infra,
    landKey: auto.landKey, subKey: auto.subKey, prefix: null, type: null, decisionKind: '', decision: ''
  };
  const t = savedLotType(layer, pattern, infra);
  if (t) { lot.prefix = t.prefix; lot.type = t.type; }
  const tag = tagParcel(lot, kind, pop);
  lot.role = tag.role;
  lot.scoreKey = tag.scoreKey;
  lot.radius = lot.role === 'score' ? lotRadius(lot) : 0;
  return lot;
}

function tagIncoming(raw, kind, pop) {
  const lot = {
    id: raw.id, phase: 'QH', layer: raw.layer, area: raw.area, lat: raw.lat, lng: raw.lng, feature: raw.feature,
    infra: false, landKey: null, subKey: '', prefix: null, type: null, decisionKind: '', decision: ''
  };
  const auto = classifyLand(raw.layer, kind);
  const direct = layerToType(raw.layer);
  // Giữ hậu tố cấp trên tên layer (_MN, _TH, _CHO…). Đổi sang mã đầu mục sẽ mất cấp và không cộng chỉ tiêu.
  if (direct) { lot.prefix = direct.prefix; lot.type = direct.type; }
  lot.decisionKind = decisionKind(raw.layer);
  lot.decision = presetDecision(raw.layer);
  if (auto) {
    lot.landKey = auto.key;
    lot.subKey = landSubKey(lot, kind);
  } else {
    const pattern = landPatternKey(raw.layer, '');
    const saved = savedLandTag(kind, pattern, false);
    lot.landKey = saved.landKey;
    lot.subKey = saved.subKey;
    const t = savedLotType(raw.layer, pattern, false);
    if (t) { lot.prefix = t.prefix; lot.type = t.type; }
  }
  const tag = tagParcel(lot, kind, pop);
  lot.role = tag.role;
  lot.scoreKey = tag.scoreKey;
  lot.radius = lot.role === 'score' ? lotRadius(lot) : 0;
  return lot;
}

function clipTo(parcel, mask, maskBox) {
  const area = intersectArea(parcel.feature, mask, maskBox);
  if (area < 1) return null;
  let feature = parcel.feature;
  if (parcel.area - area > 1) {
    try {
      const hit = turf.intersect(parcel.feature, mask);
      if (hit) feature = hit;
    } catch (e) { /* giữ hình gốc */ }
  }
  const pt = anchorOf(feature, parcel);
  let nextArea = area;
  try { nextArea = turf.area(feature); } catch (e) { /* dùng phần giao */ }
  return { ...parcel, feature, area: nextArea, lat: pt.lat, lng: pt.lng };
}

function sumInside(lots, mask, maskBox) {
  const out = new Map();
  lots.forEach(lot => {
    const a = intersectArea(lot.feature, mask, maskBox);
    if (a < 1) return;
    const key = lot.landKey || UNDETERMINED_KEY;
    out.set(key, (out.get(key) || 0) + a);
  });
  return out;
}

function landLabelOf(kind, key) {
  if (key === UNDETERMINED_KEY) return 'Chưa xác định';
  return landRowByKey(kind, key)?.label || key;
}

function areaRows(kind, before, after) {
  const keys = LANDUSE_TABLES[kind].rows.filter(r => r.key && !r.sumOf).map(r => r.key);
  keys.push(UNDETERMINED_KEY);
  return keys.map(key => {
    const oldM = before.get(key) || 0;
    const newM = after.get(key) || 0;
    return { key, label: landLabelOf(kind, key), before: oldM, after: newM, delta: newM - oldM };
  }).filter(r => r.before >= 1 || r.after >= 1);
}

// Lô cũ cắt khỏi ranh điều chỉnh; phần nằm trọn trong ranh bị bỏ và thay bằng hatch mới
function hypoFrom(oldLots, mask, maskBox, incoming) {
  const kept = [];
  const removed = [];
  oldLots.forEach(lot => {
    const inside = intersectArea(lot.feature, mask, maskBox);
    if (inside < 1) { kept.push(lot); return; }
    if (lot.area - inside <= Math.max(SLIVER_M2, lot.area * 0.02)) { removed.push(lot); return; }
    let diff = null;
    try { diff = turf.difference(lot.feature, mask); } catch (e) { diff = null; }
    if (!diff) { removed.push(lot); return; }
    const area = turf.area(diff);
    if (!(area > SLIVER_M2)) { removed.push(lot); return; }
    const pt = anchorOf(diff, lot);
    const next = { ...lot, feature: diff, area, lat: pt.lat, lng: pt.lng };
    if (next.role === 'score') next.radius = lotRadius(next);
    kept.push(next);
  });
  return { lots: kept.concat(incoming), removed };
}

function housingOf(lots) {
  return unionFeatures(lots.filter(l => l.role === 'housing' && l.feature).map(l => l.feature));
}

// Độ phủ = phần đất ở cả đồ án nằm trong bán kính phục vụ / tổng đất ở. Cùng cách chấm với bảng thẩm định.
function coverPct(members, housing) {
  if (!housing) return null;
  let base = 0;
  try { base = turf.area(housing); } catch (e) { return null; }
  if (!(base > 0)) return null;
  const buffers = [];
  members.forEach(p => {
    if (!(p.radius > 0) || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
    try { buffers.push(turf.buffer(turf.point([p.lng, p.lat]), p.radius, { units: 'meters' })); } catch (e) { /* bỏ lô không dựng được vòng */ }
  });
  const covered = unionFeatures(buffers);
  if (!covered) return 0;
  try {
    const hit = turf.intersect(covered, housing);
    if (!hit) return 0;
    return Math.round(Math.min(100, turf.area(hit) / base * 100) * 10) / 10;
  } catch (e) { return null; }
}

// Chỉ báo loại hạ tầng có bán kính khi độ phủ mới thấp hơn độ phủ cũ và dưới 100%.
function coverageNotes(oldLots, hypoLots) {
  const oldHousing = housingOf(oldLots);
  const newHousing = housingOf(hypoLots);
  const keys = new Set();
  oldLots.concat(hypoLots).forEach(l => {
    if (l.role === 'score' && l.radius > 0 && l.scoreKey) keys.add(l.scoreKey);
  });
  const notes = [];
  keys.forEach(key => {
    const before = coverPct(oldLots.filter(l => l.scoreKey === key), oldHousing);
    const after = coverPct(hypoLots.filter(l => l.scoreKey === key), newHousing);
    if (before == null || after == null) return;
    if (after + 0.05 < before && after < 100) {
      notes.push(`Độ phủ ${rowLabel(key)} giảm từ ${fmtNum(before)}% xuống ${fmtNum(after)}%, dưới mức 100%. Không đảm bảo.`);
    }
  });
  return notes;
}

function scoreLines(before, after) {
  const oldBy = new Map(before.rows.map(r => [r.key, r]));
  return after.rows.filter(r => r.quota > 0).map(r => {
    const prev = oldBy.get(r.key);
    const oldPct = prev ? prev.scalePct : null;
    const dropped = r.scalePct != null && oldPct != null && r.scalePct + 0.05 < oldPct && r.scalePct < 100;
    return { label: r.label, oldPct, newPct: r.scalePct, dropped, short: r.scalePct != null && r.scalePct < 100 };
  });
}

function destroyMap(m) {
  detachBasemap(m);
  m.remove();
}

function destroyMinis() {
  minis.forEach(destroyMap);
  minis = [];
}

// Ký hiệu lô nằm trong tên đã lưu: "<layer> <ký hiệu> – <tên file> #<thứ tự>" hoặc "<tên điểm> <ký hiệu>"
const LOT_CODE_IN_NAME = /(?:^|[\s(,])([A-Z]{1,6}(?:[._-]?[A-Z]{1,3})?(?:[._\- ]?\d+)(?:[._-]\d+)*[A-Z]?)(?=$|[\s),;])/;

function codeOfLot(lot) {
  const s = String(lot.name || '').split(' – ')[0].trim().normalize('NFC');
  // Layer khớp thủ công có dạng "<tên layer> → <mã>", tên lô vẫn ghi theo tên layer gốc
  const base = String(lot.layer || '').split(' → ')[0].trim().normalize('NFC');
  if (base && s.startsWith(base)) {
    const rest = s.slice(base.length).trim();
    if (/^[A-Z][A-Z0-9._\-/ ]{0,19}$/.test(rest)) return rest;
  }
  const m = s.match(LOT_CODE_IN_NAME);
  return m ? m[1] : '';
}

// Nhãn đặt trong phần lô lọt khung hình; mảnh quá nhỏ ở mép khung thì bỏ
function labelPoint(feature, frame, frameArea) {
  try {
    const part = turf.intersect(feature, frame);
    if (!part || turf.area(part) < frameArea * 0.012) return null;
    const [lng, lat] = turf.pointOnFeature(part).geometry.coordinates;
    return [lat, lng];
  } catch (e) { return null; }
}

const byCode = (a, b) => a.localeCompare(b, 'vi', { numeric: true });

// Chỉ lấy lô quy hoạch hiện hành có phần đáng kể nằm trong ranh điều chỉnh (bỏ mảnh vạt ở mép ranh)
function codesInside(lots, mask, maskBox) {
  const all = new Set();
  const byKey = new Map();
  lots.forEach(lot => {
    const code = codeOfLot(lot);
    if (!code) return;
    if (intersectArea(lot.feature, mask, maskBox) < Math.max(20, lot.area * 0.02)) return;
    all.add(code);
    const key = lot.landKey || UNDETERMINED_KEY;
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key).add(code);
  });
  return { all: [...all].sort(byCode), byKey: new Map([...byKey].map(([k, s]) => [k, [...s].sort(byCode)])) };
}

function padOf(box, d = 0.001) {
  return box ? [box[0] - d, box[1] - d, box[2] + d, box[3] + d] : null;
}

function landOf(lots, box) {
  return lots.filter(l => l.feature && bboxHit(bboxOf(l.feature), box));
}

function legendLabel(kind, lot) {
  const key = lot.landKey || UNDETERMINED_KEY;
  const sub = landRowByKey(kind, key)?.subs?.find(s => s[0] === lot.subKey);
  return sub && lot.subKey !== 'other' ? sub[1] : landLabelOf(kind, key);
}

function legendRows(s) {
  const box = padOf(s.maskBox);
  const seen = new Map();
  landOf(s.beforeLots, box).concat(landOf(s.afterLots, box)).forEach(l => {
    const tone = landSymbol(s.kind, l.landKey || UNDETERMINED_KEY, l.subKey).tone;
    const label = legendLabel(s.kind, l);
    const k = `${tone}|${label}`;
    if (!seen.has(k)) seen.set(k, { tone, label });
  });
  return [...seen.values()];
}

function drawMaps(ids, s) {
  const view = L.geoJSON(s.mask).getBounds();
  const box = padOf(s.maskBox);
  const out = [];
  [[ids[0], s.beforeLots], [ids[1], s.afterLots]].forEach(([id, lots]) => {
    const el = $(id);
    if (!el || typeof L === 'undefined') return;
    try {
      const m = L.map(el, { zoomControl: false, attributionControl: false, preferCanvas: true, zoomSnap: 0.25 });
      attachBasemap(m);
      // Canvas của Leaflet cần tâm nhìn trước khi nhận nét vẽ, nếu không sẽ lỗi đọc bounds
      // Lề theo cỡ khung để bản A3 (khung lớn) vẫn thấy các lô xung quanh ranh
      const pad = Math.max(28, Math.round(Math.min(el.clientWidth, el.clientHeight) * 0.14));
      if (view.isValid()) m.fitBounds(view, { animate: false, padding: [pad, pad] });
      const land = landOf(lots, box);
      const tone = new Map(land.map(l => [l.feature, landSymbol(s.kind, l.landKey || UNDETERMINED_KEY, l.subKey).tone]));
      if (land.length) {
        L.geoJSON(land.map(l => l.feature), {
          interactive: false,
          style: (f) => ({ color: '#1f2937', weight: 0.8, fillColor: tone.get(f) || '#94a3b8', fillOpacity: 0.78 })
        }).addTo(m);
      }
      L.geoJSON(s.mask, { interactive: false, style: { color: '#dc2626', weight: 3, fill: false, dashArray: '9 6' } }).addTo(m);
      const shown = m.getBounds();
      const frame = turf.bboxPolygon([shown.getWest(), shown.getSouth(), shown.getEast(), shown.getNorth()]);
      const frameArea = turf.area(frame);
      land.forEach(l => {
        const code = codeOfLot(l);
        const at = code ? labelPoint(l.feature, frame, frameArea) : null;
        if (!at) return;
        L.marker(at, {
          interactive: false, keyboard: false,
          icon: L.divIcon({ className: 'la-lot-label', html: `<span>${escapeHtml(code)}</span>`, iconSize: null })
        }).addTo(m);
      });
      out.push(m);
    } catch (err) {
      console.error(err);
      el.textContent = 'Không vẽ được hình khu vực này.';
    }
  });
  return out;
}

function mountMaps(s) {
  destroyMinis();
  minis = drawMaps(['laMapBefore', 'laMapAfter'], s);
  const fit = () => minis.forEach(m => m.invalidateSize());
  requestAnimationFrame(fit);
  setTimeout(fit, 60);
}

function m2Text(m2) {
  return fmtNum(Math.round(Number(m2) || 0));
}

function deltaCell(m2) {
  const v = Math.round(Number(m2) || 0);
  if (Math.abs(v) < 1) return '<td class="num">0</td>';
  return `<td class="num ${v > 0 ? 'la-up' : 'la-down'}">${v > 0 ? '+' : ''}${fmtNum(v)}</td>`;
}

function pctText(v) {
  return v == null ? '—' : `${fmtNum(v)}%`;
}

function verdictCell(r) {
  if (r.dropped) return '<b class="la-bad">Không đảm bảo</b>';
  if (r.short) return '<span class="la-warn">Dưới 100%</span>';
  return r.newPct == null ? '—' : '<b class="la-ok">Đạt</b>';
}

function lotsPhrase(codes) {
  return codes.length ? `ĐỐI VỚI CÁC LÔ ĐẤT KÝ HIỆU ${codes.join(', ')}` : 'ĐỐI VỚI KHU ĐẤT TRONG RANH ĐIỀU CHỈNH';
}

const NORTH_SVG = `<svg class="la-north" viewBox="0 0 40 56" aria-hidden="true">
  <text x="20" y="10" text-anchor="middle" font-size="11" font-weight="700" fill="#111827">B</text>
  <polygon points="20,14 31,50 20,41" fill="#111827"/>
  <polygon points="20,14 9,50 20,41" fill="#fff" stroke="#111827" stroke-width="1.2"/>
</svg>`;

// Một tờ bản vẽ: hai bản vẽ + hai bảng bên trái, cột KÝ HIỆU và khung tên bên phải. print = bản dựng khổ A3 để xuất PDF
function paperHtml(s, print) {
  const ids = print ? ['laPdfBefore', 'laPdfAfter'] : ['laMapBefore', 'laMapAfter'];
  const upper = s.name.toLocaleUpperCase('vi');
  const phrase = lotsPhrase(s.codes.all);
  let sumOld = 0, sumNew = 0;
  const areaBody = s.areas.map((r, i) => {
    sumOld += r.before;
    sumNew += r.after;
    const codes = s.codes.byKey.get(r.key) || [];
    return `<tr><td class="c">${i + 1}</td><td>${escapeHtml(r.label)}</td><td class="c">${escapeHtml(codes.join(', ') || '—')}</td><td class="num">${m2Text(r.before)}</td><td class="num">${m2Text(r.after)}</td>${deltaCell(r.delta)}</tr>`;
  }).join('');
  const areaRowsHtml = areaBody
    ? `${areaBody}<tr class="la-total"><td></td><td>Tổng cộng</td><td></td><td class="num">${m2Text(sumOld)}</td><td class="num">${m2Text(sumNew)}</td>${deltaCell(sumNew - sumOld)}</tr>`
    : '<tr><td colspan="6" class="c">Không có loại đất nào trong ranh.</td></tr>';
  const scoreBody = s.lines.map((r, i) => `<tr><td class="c">${i + 1}</td><td>${escapeHtml(r.label)}</td><td class="num">${pctText(r.oldPct)}</td><td class="num">${pctText(r.newPct)}</td><td class="c nw">${verdictCell(r)}</td></tr>`).join('')
    || '<tr><td colspan="5" class="c">Chưa có chỉ tiêu quy mô để chấm.</td></tr>';
  const legend = legendRows(s).map(r => `<div class="la-legend-row"><span class="la-sw" style="background:${escapeHtml(r.tone)}"></span><span>${escapeHtml(r.label)}</span></div>`).join('');
  return `<div class="la-paper${print ? ' la-a3' : ''}">
    <div class="la-main">
      <div class="la-title">
        <h2>ĐIỀU CHỈNH CỤC BỘ ${escapeHtml(upper)}</h2>
        <h3>${escapeHtml(phrase)}</h3>
        <p>(Kết quả thẩm định giả định ngày ${escapeHtml(s.date)}, chưa ghi vào cơ sở dữ liệu)</p>
      </div>
      <div class="la-maps">
        <div class="la-map-card"><div id="${ids[0]}" class="la-map"></div><div class="la-map-cap">Bản vẽ quy hoạch (đã phê duyệt)</div></div>
        <div class="la-map-card"><div id="${ids[1]}" class="la-map"></div><div class="la-map-cap">Bản vẽ điều chỉnh cục bộ</div></div>
      </div>
      <div class="la-tables">
        <div class="la-tbl">
          <h4>Bảng cơ cấu sử dụng đất trong ranh điều chỉnh</h4>
          <table>
            <thead>
              <tr><th rowspan="2">STT</th><th rowspan="2">Loại đất</th><th colspan="2">Quy hoạch đã phê duyệt</th><th>Điều chỉnh</th><th rowspan="2">Tăng / giảm (m²)</th></tr>
              <tr><th>Ký hiệu</th><th>Diện tích (m²)</th><th>Diện tích (m²)</th></tr>
            </thead>
            <tbody>${areaRowsHtml}</tbody>
          </table>
        </div>
        <div class="la-tbl">
          <h4>Bảng đánh giá chỉ tiêu cả đồ án (QCVN 01:2026/BXD)</h4>
          <table>
            <thead><tr><th>STT</th><th>Chỉ tiêu</th><th>Trước điều chỉnh</th><th>Sau điều chỉnh</th><th>Kết luận</th></tr></thead>
            <tbody>${scoreBody}</tbody>
          </table>
        </div>
      </div>
      <p class="la-note"><b class="${s.bad ? 'la-bad' : 'la-ok'}">KẾT LUẬN: ${s.bad ? 'KHÔNG ĐẢM BẢO' : 'ĐẢM BẢO'}.</b> ${escapeHtml(s.lead)}</p>
    </div>
    <div class="la-side">
      <div class="la-box la-legend">
        ${NORTH_SVG}
        <h4>KÝ HIỆU</h4>
        <div class="la-legend-row"><span class="la-sw la-sw-line"></span><span>Ranh giới điều chỉnh quy hoạch</span></div>
        ${legend}
        <div class="la-legend-row"><span class="la-sw la-sw-code">A</span><span>Ký hiệu lô đất</span></div>
      </div>
      <div class="la-box la-agency"><b>CƠ QUAN PHÊ DUYỆT:</b></div>
      <div class="la-box la-agency"><b>CƠ QUAN THẨM ĐỊNH:</b></div>
      <div class="la-box la-agency"><b>CƠ QUAN ĐỀ XUẤT:</b></div>
      <div class="la-box la-block">ĐIỀU CHỈNH CỤC BỘ ${escapeHtml(upper)}<br>(${escapeHtml(phrase)})</div>
    </div>
  </div>`;
}

const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;

function pdfPicked() {
  return $('localPdf')?.files?.[0] || null;
}

function importBoxHtml(s) {
  const admin = isAdmin();
  const pdf = pdfPicked();
  return `<div class="la-import" id="laImport" hidden>
    <p>${admin
      ? `Ranh điều chỉnh và ${fmtNum(s.incoming.length)} lô đất mới sẽ ghi lên bản đồ quy hoạch đồ án «${escapeHtml(s.name)}».`
      : 'Hồ sơ vào hàng chờ, ranh điều chỉnh hiện trên bản đồ quy hoạch sau khi Admin duyệt.'}${s.bad ? ' <b class="la-import-warn">Kết quả thẩm định: Không đảm bảo.</b>' : ''}</p>
    <div class="la-import-fields">
      ${admin ? '' : '<input type="text" id="laSender" maxlength="80" placeholder="Người gửi / đơn vị (bắt buộc)">'}
      <input type="text" id="laNote" maxlength="300" placeholder="Ghi chú: số Quyết định, ngày ban hành…">
      <span class="la-import-pdf">PDF scan: ${pdf ? `${escapeHtml(pdf.name)} · ${fmtNum(Math.round(pdf.size / 1024))}` : 'không kèm (chọn ở khung nhập trước khi thẩm định)'}</span>
    </div>
    <div class="la-import-btns">
      <button type="button" class="bp-btn la-import-go" id="btnLaSend">${ico('check')}${admin ? 'Đồng ý nhập' : 'Gửi Admin duyệt'}</button>
      <button type="button" class="bp-btn" id="btnLaCancel">${ico('close')}Hủy</button>
    </div>
  </div>`;
}

function pageHtml(s) {
  return `<div class="la-wrap">
    <div class="bp-part-head review-head">
      <b class="bp-part-title">ĐIỀU CHỈNH CỤC BỘ · ${escapeHtml(s.name)} <span class="la-verdict ${s.bad ? 'bad' : 'ok'}">${s.bad ? 'Không đảm bảo' : 'Đảm bảo'}</span></b>
      <div class="review-head-btns">
        <button type="button" class="bp-btn" id="btnLocalImport">${ico('send')}Nhập hồ sơ</button>
        <button type="button" class="bp-btn" id="btnLocalPdf">${ico('printer')}Xuất PDF A3</button>
        <button type="button" class="bp-btn" id="btnLocalClose">${ico('close')}Đóng</button>
      </div>
    </div>
    ${importBoxHtml(s)}
    ${paperHtml(s, false)}
  </div>`;
}

function adjustPayload(s) {
  return {
    tenQH: s.name,
    boundary: s.mask.geometry,
    lots: s.incoming.map(l => ({
      geometry: l.feature.geometry,
      layer: l.layer,
      landKey: l.landKey || UNDETERMINED_KEY,
      subKey: l.subKey || '',
      label: legendLabel(s.kind, l),
      tone: landSymbol(s.kind, l.landKey || UNDETERMINED_KEY, l.subKey).tone,
      area: Math.round(l.area)
    })),
    codes: s.codes.all,
    title: `ĐIỀU CHỈNH CỤC BỘ ${s.name.toLocaleUpperCase('vi')} (${lotsPhrase(s.codes.all)})`,
    verdict: s.bad ? 'Không đảm bảo' : 'Đảm bảo'
  };
}

const sizeText = (bytes) => (bytes < 1024 ? ${fmtNum(bytes)} B : ${fmtNum(Math.round(bytes / 1024))} KB);

async function submitImport() {
  if (!sheet || sheet.sent) return;
  const admin = isAdmin();
  const sender = $('laSender')?.value.trim() || '';
  if (!admin && !sender) { showToast('Nhập tên người gửi / đơn vị', 'error'); $('laSender')?.focus(); return; }
  const pdf = pdfPicked();
  const bad = pdfProblem(pdf);
  if (bad) { showToast(bad, 'error'); return; }
  const btn = $('btnLaSend');
  if (btn) btn.disabled = true;
  showToast(admin ? '⏳ Đang ghi hồ sơ điều chỉnh...' : '⏳ Đang gửi hồ sơ điều chỉnh...');
  try {
    const out = await sendAdjustment({ ...adjustPayload(sheet), sender, note: $('laNote')?.value.trim() || '' }, pdf);
    sheet.sent = true;
    $('laImport')?.setAttribute('hidden', '');
    const go = $('btnLocalImport');
    if (go) { go.disabled = true; go.innerHTML = `${ico('check')}${out.approved ? 'Đã nhập' : 'Đã gửi'}`; }
    showToast(out.approved
      ? '✓ Đã ghi ranh điều chỉnh lên bản đồ quy hoạch'
      : '✓ Đã gửi hồ sơ, chờ Admin duyệt', 'success');
    if (out.pdfError) showToast(`Hồ sơ đã lưu nhưng chưa gắn được PDF: ${out.pdfError}`, 'error');
  } catch (err) {
    showToast(`Không nhập được hồ sơ: ${err.message}`, 'error');
    if (btn) btn.disabled = false;
  }
}

function showPage(s) {
  dismissReviewHost();
  const host = $('projectReviewHost');
  if (!host) return;
  sheet = s;
  document.body.classList.add('project-review', 'la-page');
  setBottomPanelCollapsed(false);
  const panel = $('reviewPanel');
  if (panel) panel.hidden = true;
  $('btnReviewOpen')?.setAttribute('aria-pressed', 'false');
  $('btnReviewOpen')?.classList.remove('active');
  host.innerHTML = pageHtml(s);
  mountMaps(s);
  map?.invalidateSize({ pan: false });
}

async function tilesReady(root, timeout = 8000) {
  const end = Date.now() + timeout;
  await new Promise(r => setTimeout(r, 300));
  while (Date.now() < end) {
    const tiles = [...root.querySelectorAll('img.leaflet-tile')];
    if (tiles.length && tiles.every(t => t.complete)) break;
    await new Promise(r => setTimeout(r, 200));
  }
  await new Promise(r => setTimeout(r, 200));
}

// Bản đồ Leaflet chụp thành ảnh trước rồi mới đưa cả tờ A3 qua html2pdf (bản sao của html2pdf mất nội dung canvas)
async function exportA3() {
  if (!sheet || pdfBusy) return;
  pdfBusy = true;
  let holder = null;
  let temp = [];
  try {
    showToast('⏳ Đang dựng bản vẽ khổ A3...');
    await Promise.all([loadHtml2Canvas(), loadHtml2Pdf()]);
    holder = document.createElement('div');
    holder.className = 'pa3-holder';
    holder.innerHTML = paperHtml(sheet, true);
    document.body.appendChild(holder);
    temp = drawMaps(['laPdfBefore', 'laPdfAfter'], sheet);
    await tilesReady(holder);
    for (const id of ['laPdfBefore', 'laPdfAfter']) {
      const el = $(id);
      if (!el) continue;
      const canvas = await window.html2canvas(el, {
        useCORS: true, logging: false, backgroundColor: '#e5e7eb', scale: 2, scrollX: 0, scrollY: 0,
        ignoreElements: (n) => !!n.classList?.contains('leaflet-control-container')
      });
      el.dataset.img = canvas.toDataURL('image/jpeg', 0.92);
    }
    temp.forEach(destroyMap);
    temp = [];
    ['laPdfBefore', 'laPdfAfter'].forEach(id => {
      const el = $(id);
      if (!el) return;
      const src = el.dataset.img;
      el.className = 'la-map';
      el.removeAttribute('style');
      el.innerHTML = src ? `<img class="la-map-img" src="${src}" alt="">` : '';
    });
    await Promise.all([...holder.querySelectorAll('img')].map(im => (im.complete ? null : new Promise(r => { im.onload = im.onerror = r; }))));
    const slug = sheet.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await window.html2pdf().from(holder.firstElementChild).set({
      margin: 0,
      filename: `Dieu-chinh-cuc-bo-${slug || 'do-an'}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, logging: false, scrollX: 0, scrollY: 0, windowWidth: A3_W, windowHeight: A3_H },
      jsPDF: { unit: 'mm', format: 'a3', orientation: 'landscape' },
      pagebreak: { mode: [] }
    }).save();
    showToast('✓ Đã xuất bản vẽ điều chỉnh khổ A3 (PDF)', 'success');
  } catch (err) {
    console.error('Xuất PDF điều chỉnh cục bộ lỗi:', err);
    showToast(`❌ Không xuất được PDF: ${err.message || err}`, 'error');
  } finally {
    temp.forEach(destroyMap);
    holder?.remove();
    pdfBusy = false;
  }
}

function fillProjects() {
  const sel = $('localProject');
  if (!sel) return;
  const cur = sel.value;
  const all = (state.projectCatalog || []).filter(p => p && p.tenQH);
  const drawable = all.filter(p => !p.sheetOnly);
  const list = (drawable.length ? drawable : all).slice().sort((a, b) => a.tenQH.localeCompare(b.tenQH, 'vi'));
  sel.innerHTML = `<option value="">Chọn đồ án quy hoạch</option>${list.map(p => `<option value="${escapeHtml(p.tenQH)}">${escapeHtml(p.tenQH)}</option>`).join('')}`;
  if (cur && list.some(p => p.tenQH === cur)) sel.value = cur;
}

function applyProject(name) {
  if (!name) return;
  const entry = (state.projectCatalog || []).find(p => p && p.tenQH === name) || {};
  const qh = storedPop(name) || Number(entry.popQH) || 0;
  const input = $('localPopQH');
  if (input && qh > 0) input.value = String(Math.round(qh));
  const radio = document.querySelector(`input[name="localKind"][value="${kindOf(name)}"]`);
  if (radio) radio.checked = true;
}

async function readDxf(file) {
  if (!/\.dxf$/i.test(file.name)) throw new Error('Chỉ nhận file .dxf');
  if (file.size > REVIEW_MAX_BYTES) throw new Error('File lớn hơn 5 MB');
  const head = await file.slice(0, 22).text();
  if (head.startsWith('AutoCAD Binary DXF')) throw new Error('DXF nhị phân chưa hỗ trợ — lưu dạng ASCII');
  return parseDxf(await file.text()).entities;
}

async function runAdjust() {
  const name = $('localProject')?.value || '';
  const pop = Number($('localPopQH')?.value) || 0;
  const kind = document.querySelector('input[name="localKind"]:checked')?.value;
  const file = $('localFile')?.files?.[0] || null;
  if (!name) { showToast('Chọn đồ án quy hoạch đang điều chỉnh', 'error'); return; }
  if (!LANDUSE_TABLES[kind]) { showToast('Chọn loại đồ án QHC hoặc QHPK', 'error'); return; }
  if (!(pop > 0)) { showToast('Nhập dân số quy hoạch để tính % chỉ tiêu', 'error'); $('localPopQH')?.focus(); return; }
  if (!file) { showToast('Chọn file DXF điều chỉnh', 'error'); return; }
  if (typeof turf === 'undefined') { showToast('Chưa tải thư viện đo diện tích', 'error'); return; }
  if (reviewHostDirty() && !confirm('Đóng hồ sơ thẩm định đang mở để thẩm định điều chỉnh?')) return;
  const btn = $('btnLocalStart');
  if (btn) btn.disabled = true;
  showToast('Đang đọc ranh và đối chiếu đồ án…');
  await new Promise(r => setTimeout(r, 30));
  try {
    const crs = CRS_PRESETS[$('localCrs')?.value] || CRS_PRESETS.HUE_3;
    const drawing = splitDrawing(await readDxf(file), crs);
    const entry = (state.projectCatalog || []).find(p => p && p.tenQH === name);
    if (!entry) throw new Error('Không thấy đồ án trong danh mục.');
    await projectLayersOf(name);
    const oldLots = cachedLots(name).map((p, i) => tagStored(p, i, kind, pop)).filter(Boolean);
    if (!oldLots.length) throw new Error('Đồ án chưa có lớp sử dụng đất quy hoạch.');
    const extent = extentOf(entry, oldLots);
    if (!extent) throw new Error('Đồ án chưa có ranh giới để kiểm tra phạm vi.');
    const ratio = insideRatio(drawing.mask, extent.feature);
    if (ratio < INSIDE_MIN) {
      throw new Error(`Phạm vi điều chỉnh nằm ngoài đồ án «${name}» (${fmtNum(Math.round((1 - ratio) * 1000) / 10)}% diện tích ngoài ranh).`);
    }
    const incoming = drawing.hatches.map(h => clipTo(h, drawing.mask, drawing.maskBox)).filter(Boolean).map(h => tagIncoming(h, kind, pop));
    const beforeMap = sumInside(oldLots, drawing.mask, drawing.maskBox);
    const afterMap = sumInside(incoming, drawing.mask, drawing.maskBox);
    const hypo = hypoFrom(oldLots, drawing.mask, drawing.maskBox, incoming);
    const lines = scoreLines(scoreRows(oldLots, pop, kind), scoreRows(hypo.lots, pop, kind));
    const areaBad = lines.some(r => r.dropped);
    const coverNotes = coverageNotes(oldLots, hypo.lots);
    const bad = areaBad || coverNotes.length > 0;
    const extra = [];
    if (extent.how === 'khung') extra.push('Đồ án chưa có ranh riêng, đã kiểm tra theo khung bao các lô quy hoạch.');
    const unknown = incoming.filter(l => !l.landKey).length;
    if (unknown) extra.push(`${unknown} hatch chưa nhận tên layer Thông tư 16, diện tích xếp vào Chưa xác định.`);
    const lead = [
      `${LANDUSE_TABLES[kind].short}, dân số quy hoạch ${fmtNum(pop)} người, phạm vi ${fmtNum(haOf(turf.area(drawing.mask)))} ha.`,
      areaBad ? 'Có chỉ tiêu giảm xuống dưới 100% sau khi cộng trừ diện tích điều chỉnh vào cả đồ án.'
        : (lines.some(r => r.short) ? 'Không có chỉ tiêu nào giảm thêm xuống dưới 100%. Một số chỉ tiêu vốn đã dưới 100%.' : 'Các chỉ tiêu có quy định quy mô vẫn từ 100% trở lên.'),
      ...coverNotes,
      ...extra
    ].join(' ');
    rememberPop(name, pop);
    showPage({
      name, kind, bad, lead, lines,
      areas: areaRows(kind, beforeMap, afterMap),
      codes: codesInside(oldLots, drawing.mask, drawing.maskBox),
      date: new Date().toLocaleDateString('vi-VN'),
      mask: drawing.mask, maskBox: drawing.maskBox, beforeLots: oldLots, afterLots: hypo.lots, incoming
    });
  } catch (err) {
    showToast(err.message || 'Không thẩm định được', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function initLocalAdjust() {
  window.addEventListener('qh:review-host-clear', destroyMinis);
  window.addEventListener('qh:local-adjust-open', fillProjects);
  $('btnReviewOpen')?.addEventListener('click', () => {
    if (document.querySelector('input[name="reviewMode"][value="local"]')?.checked) fillProjects();
  });
  $('localProject')?.addEventListener('change', () => applyProject($('localProject').value));
  $('localProject')?.addEventListener('focus', fillProjects);
  $('localFile')?.addEventListener('change', () => {
    const f = $('localFile').files && $('localFile').files[0];
    const out = $('localFileName');
    if (out) out.textContent = f ? `${f.name} · ${fmtNum(Math.round(f.size / 1024))}` : 'DXF: ranh (layer có chữ RANH) + hatch đất';
  });
  $('localPdf')?.addEventListener('change', () => {
    const input = $('localPdf');
    const f = input.files && input.files[0];
    const bad = pdfProblem(f);
    if (bad) { showToast(bad, 'error'); input.value = ''; }
    const ok = !bad && f;
    const out = $('localPdfName');
    if (out) out.textContent = ok ? `${f.name} · ${fmtNum(Math.round(f.size / 1024))}` : 'Quyết định, bản vẽ điều chỉnh · PDF < 2 MB';
  });
  $('btnLocalStart')?.addEventListener('click', () => { runAdjust(); });
  $('projectReviewHost')?.addEventListener('click', (e) => {
    if (e.target.closest('#btnLocalClose')) dismissReviewHost();
    else if (e.target.closest('#btnLocalPdf')) exportA3();
    else if (e.target.closest('#btnLocalImport')) $('laImport')?.toggleAttribute('hidden');
    else if (e.target.closest('#btnLaCancel')) $('laImport')?.setAttribute('hidden', '');
    else if (e.target.closest('#btnLaSend')) submitImport();
  });
}
