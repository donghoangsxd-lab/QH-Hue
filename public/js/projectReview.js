// Thẩm định đồ án (nút cam trên thanh công cụ trái): nộp hồ sơ QHC 1/10.000 hoặc QHPK 1/2.000 gồm dân số HT / QH,
// file HT-<mã>.dxf và QH-<mã>.dxf → bảng cân đối sử dụng đất theo mẫu TT16 (Mục 2 / Mục 4) → bảng QCVN 01:2026
// (quy mô, độ phủ trên đất ở) → chuyển phê duyệt vào hàng chờ → Admin phê duyệt thì ghi Sheet qua khung Nhập hàng loạt
// (Ten_QH = <mã>, khớp / gộp công trình đã có). Bản đồ đẩy lớp hiện trạng lên trước rồi lớp quy hoạch; chia đôi màn hình
// thì hiện trạng bên trái, quy hoạch bên phải.
import { map, layers, setReviewScope, setLandVisible } from './mapEngine.js';
import { planMap, isCompareOn, isSplitOn, onCompareChange, toggleSplit, setSplit, setViewMode } from './planMap.js';
import { state, BUFFER_COLORS, BUFFER_KEYS, ICON_GROUP_KEYS, layerType } from './state.js';
import { geeApi } from './api.js';
import { parseDxf, buildParcels, CRS_PRESETS, layerToType } from './cadImport.js';
import { escapeHtml, fmtNum, ico, showToast, loadHtml2Pdf, isApproved } from './utils.js';
import { setBottomPanelMaximized } from './uiComponents.js';
import { importReviewDossier, rejectPending, REVIEW_DOSSIER_EVENT } from './cadImportUi.js';
import { setLabelsOverlay, labelsOverlayOn } from './basemap.js';
import { tt16SymbolStyle, tt16SwatchCss, TT16_PATTERN_ZOOM, landPatternKey } from './tt16Symbols.js';
import {
  REVIEW_MAX_BYTES, LANDUSE_TABLES, classifyLand, landChoices, landRowByKey, landUseSummary, landSubKey, importLayerName, decisionKind,
  presetDecision, tagParcel, lotRadius, scoreRows, rowLabel, rowMinSize, newLandControl, residentialSubAreas, landSymbol, UNIT_POP, THPT_POP_MIN,
  projectOfFile, PENDING_TONE, UNDETERMINED_KEY, savedLandTag, savedLotType
} from './projectReviewCore.js';
import { projectLayersOf, cachedLots, PROJECT_INFO_EVENT } from './projectFiles.js';

const STORE_KEY = 'qh_review_dossiers_v2';
// Hàng chờ duyệt (submitCadPending) nhận tối đa 2 MB nội dung
const SEND_MAX_BYTES = 2 * 1024 * 1024;
const ASK_COLOR = '#fb923c';
const FOCUS_COLOR = '#facc15';
const QH_DELAY_MS = 900;
const SCHOOL_CHOICES = [['MN', 'Mầm non'], ['TH', 'Tiểu học'], ['THCS', 'THCS'], ['NO', 'Không phải trường']];
const MARKET_CHOICES = [['CHO', 'Chợ'], ['TTTM', 'Trung tâm thương mại'], ['NO', 'Không — dịch vụ khác']];
const DECISION_NAME = { MN: 'Trường Mầm non', TH: 'Trường Tiểu học', THCS: 'Trường THCS', CHO: 'Chợ', TTTM: 'Trung tâm thương mại' };
const DECISION_LABEL = { MN: 'Mầm non', TH: 'Tiểu học', THCS: 'THCS', CHO: 'Chợ', TTTM: 'Trung tâm thương mại', NO: 'Không thuộc nhóm' };
// Công trình đã có trong dữ liệu nằm trong lô → gợi ý cấp trường / chợ - TTTM
const SCHOOL_TYPES = { '3-MN': 'MN', '4-TH': 'TH', '5-THCS': 'THCS' };
const SRC_LABEL = { layer: 'theo hậu tố layer', data: 'theo công trình đã có trong dữ liệu', user: 'đã chọn' };
const $ = (id) => document.getElementById(id);
const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;

// session: { kind QHC/QHPK, project, popHT, popQH, files {HT, QH}, lots, byId, layerChoice Map layer → đầu mục | 'skip',
//   decisions Map lotId → MN/TH/THCS/CHO/TTTM/NO (người dùng chọn), queue (thứ tự duyệt theo vị trí), hitCache,
//   openRows (dòng thẩm định đang xổ danh sách), reviewId (lô đang hỏi), pendingId (Admin mở hồ sơ chờ), dossierText }
let session = null;
// heat theo ô "Bản đồ độ phủ hạ tầng" của panel Lớp dữ liệu; bán kính phục vụ theo nút vùng phủ từng nhóm (hoặc nhóm / lô đang chọn)
let show = { HT: true, QH: true, heat: true };
// Tem đường do thẩm định tự bật khi duyệt từng lô → đóng thẩm định thì tắt lại
let labelsAuto = false;
// Bản đồ nhiệt riêng của đồ án (cùng thang GEE với bản đồ độ phủ toàn TP, bán kính QCVN của lô hạ tầng); sig = nhóm điểm đã gửi
const heat = {
  HT: { sig: '', url: '', seq: 0, tile: null, tileUrl: '', tileMap: null },
  QH: { sig: '', url: '', seq: 0, tile: null, tileUrl: '', tileMap: null }
};
// Khung lọc lớp dữ liệu quanh đồ án (độ, ~300 m)
const SCOPE_PAD_DEG = 0.003;
const drawn = { HT: null, QH: null };
let lotLayers = [];
let focusKey = '';
let qhTimer = null;
let maxWasOn = false;
let sending = false;

const isUnresolvedDecision = (lot) => !!lot.decisionKind && !lot.decision;
const usable = (lot) => lot.landKey && lot.landKey !== 'skip';

// ============================ PHÂN LOẠI LÔ ============================

/** Công trình đã có có tâm nằm trong lô: lô hiện trạng xét dữ liệu hiện trạng, lô quy hoạch xét cả hiện trạng + quy hoạch */
function pointsInLot(lot) {
  if (session.hitCache.has(lot.id)) return session.hitCache.get(lot.id);
  const f = featureOf(lot);
  let hits = [];
  if (f) {
    const [x0, y0, x1, y1] = turf.bbox(f);
    const pool = lot.phase === 'HT' ? (state.rawDataList || []) : [...(state.rawDataList || []), ...(state.planDataList || [])];
    hits = pool.filter(it => {
      const x = Number(it.lng), y = Number(it.lat);
      if (!(x >= x0 && x <= x1 && y >= y0 && y <= y1)) return false;
      try { return turf.booleanPointInPolygon([x, y], f); } catch (e) { return false; }
    });
  }
  session.hitCache.set(lot.id, hits);
  return hits;
}

/** Trường học / chợ - TTTM đã có trong lô (gợi ý cấp trường, chợ hay TTTM) */
function dataHits(lot) {
  return pointsInLot(lot).filter(it => SCHOOL_TYPES[it.type] || it.type === '9-TM');
}

/** Lô hạ tầng trùng công trình đã có cùng loại → tên công trình đó (ưu tiên công trình đã duyệt), '' nếu không có */
function existingName(lot) {
  if (!lot.type) return '';
  const same = pointsInLot(lot).filter(it => (it.type === lot.type || layerType(it) === lot.type) && String(it.name || '').trim());
  const pick = same.find(it => isApproved(it.status)) || same[0];
  return pick ? String(pick.name).trim() : '';
}

function suggestFromData(lot) {
  const hits = dataHits(lot);
  if (lot.decisionKind === 'school') {
    const schools = hits.filter(h => SCHOOL_TYPES[h.type] && !/THPT/i.test(`${h.id} ${h.name || ''}`));
    const levels = [...new Set(schools.map(h => SCHOOL_TYPES[h.type]))];
    return levels.length === 1 ? { value: levels[0], name: schools[0].name || schools[0].id } : null;
  }
  const market = hits.find(h => h.type === '9-TM');
  return market ? { value: /chợ|\bcho\b/i.test(market.name || '') ? 'CHO' : 'TTTM', name: market.name || market.id } : null;
}

// Thứ tự duyệt: trường học trước, chợ - TTTM sau; hiện trạng trước, quy hoạch sau; trong nhóm đi lô gần nhất kế tiếp
function orderQueue() {
  const lots = session.lots.filter(l => usable(l) && l.decisionKind);
  const ids = [];
  [['school', 'HT'], ['school', 'QH'], ['market', 'HT'], ['market', 'QH']].forEach(([k, ph]) => {
    const rest = lots.filter(l => l.decisionKind === k && l.phase === ph);
    let cur = rest.length ? rest.reduce((a, b) => (b.lat > a.lat ? b : a)) : null;
    while (cur) {
      ids.push(cur.id);
      rest.splice(rest.indexOf(cur), 1);
      let best = null, bestD = Infinity;
      rest.forEach(l => {
        const d = (l.lat - cur.lat) ** 2 + ((l.lng - cur.lng) * 0.96) ** 2;
        if (d < bestD) { bestD = d; best = l; }
      });
      cur = best;
    }
  });
  session.queue = ids;
}

// Lô đồ án đã lưu: không có bước xác nhận cấp trường / chợ - TTTM (đã chốt lúc nhập), tên theo dòng Sheet cùng ID
function tagSaved(lot, sheetRows) {
  const kind = session.kind;
  const chosen = session.layerChoice.get(lot.layer);
  const auto = savedLandTag(kind, lot.pattern, lot.infra);
  lot.landKey = chosen || auto.landKey;
  lot.ask = !lot.landKey;
  const row = chosen && landRowByKey(kind, chosen);
  Object.assign(lot, {
    prefix: null, type: null, nhom: '', role: 'other', scoreKey: null, radius: 0, decisionKind: '', decision: '', decisionSrc: '',
    hitName: '', importLayer: null, displayName: '', pointName: '',
    subKey: chosen ? (row && row.subs && !row.split ? 'other' : '') : auto.subKey
  });
  if (!usable(lot)) return;
  // Gán tay vào đầu mục gộp nhiều loại (giáo dục, dịch vụ) thì không rõ cấp trường / chợ → không chấm chỉ tiêu
  const t = !chosen ? savedLotType(lot.layer, lot.pattern, lot.infra)
    : row && !row.subs ? savedLotType('', landSymbol(kind, chosen).tt16, lot.infra) : null;
  if (t) { lot.prefix = t.prefix; lot.type = t.type; }
  const sheetRow = lot.infra && sheetRows.get(lot.sheetId);
  lot.pointName = (sheetRow && String(sheetRow.name || '').trim()) || existingName(lot);
  const tag = tagParcel(lot, kind, session.popQH);
  lot.role = tag.role;
  lot.scoreKey = tag.scoreKey;
  lot.radius = lot.role === 'score' ? lotRadius(lot) : 0;
}

function applyTags() {
  const kind = session.kind;
  if (session.saved) {
    const sheetRows = new Map([...(state.rawDataList || []), ...(state.planDataList || [])].map(it => [String(it.id), it]));
    session.lots.forEach(lot => tagSaved(lot, sheetRows));
    session.queue = [];
    return;
  }
  session.lots.forEach(lot => {
    const chosen = session.layerChoice.get(lot.layer);
    const auto = classifyLand(lot.layer, kind);
    lot.landKey = chosen || (auto ? auto.key : null);
    lot.ask = !lot.landKey;
    lot.prefix = null; lot.type = null; lot.nhom = ''; lot.role = 'other'; lot.scoreKey = null; lot.radius = 0;
    lot.decisionKind = ''; lot.decision = ''; lot.decisionSrc = ''; lot.hitName = ''; lot.importLayer = null; lot.subKey = ''; lot.displayName = '';
    lot.pointName = '';
    if (!usable(lot)) return;
    const chosenKey = chosen && chosen !== 'skip' ? chosen : null;
    lot.decisionKind = decisionKind(importLayerName(lot, kind, chosenKey, null));
    if (lot.decisionKind) {
      const user = session.decisions.get(lot.id);
      const preset = !user && presetDecision(lot.layer);
      const hint = !user && !preset ? suggestFromData(lot) : null;
      lot.decision = user || preset || (hint ? hint.value : '');
      lot.decisionSrc = user ? 'user' : preset ? 'layer' : hint ? 'data' : '';
      lot.hitName = hint ? hint.name : '';
    }
    const dec = lot.decision;
    lot.importLayer = importLayerName(lot, kind, chosenKey, dec || undefined);
    const t = lot.decisionKind && !dec ? null : layerToType(lot.importLayer);
    if (t) { lot.prefix = t.prefix; lot.type = t.type; lot.nhom = t.nhom; }
    lot.pointName = existingName(lot);
    const tag = tagParcel(lot, kind, session.popQH);
    lot.role = tag.role;
    lot.scoreKey = tag.scoreKey;
    lot.radius = lot.role === 'score' ? lotRadius(lot) : 0;
    lot.subKey = landSubKey(lot, kind);
  });
  const ids = session.lots.filter(l => usable(l) && l.decisionKind).map(l => l.id);
  const queued = new Set(session.queue || []);
  if (!session.queue || ids.length !== queued.size || ids.some(id => !queued.has(id))) orderQueue();
}

function askLayers() {
  const byLayer = new Map();
  session.lots.forEach(lot => {
    if (!lot.ask && !session.layerChoice.has(lot.layer)) return;
    const r = byLayer.get(lot.layer) || { layer: lot.layer, n: 0, area: 0, phases: new Set() };
    r.n++;
    r.area += lot.area;
    r.phases.add(lot.phase);
    byLayer.set(lot.layer, r);
  });
  return [...byLayer.values()].sort((a, b) => b.area - a.area);
}

const decisionQueue = () => (session.queue || []).map(id => session.byId.get(id)).filter(l => l && usable(l) && l.decisionKind);

function unresolved() {
  return {
    layers: session.lots.filter(l => l.ask).reduce((s, l) => s.add(l.layer), new Set()).size,
    lots: session.lots.filter(l => usable(l) && isUnresolvedDecision(l)).length
  };
}

// ============================ ĐỘ PHỦ ============================

function featureOf(lot) {
  const g = geometryOf(lot);
  if (!g || typeof turf === 'undefined') return null;
  try { return turf.feature(g); } catch (e) { return null; }
}

function unionAll(features) {
  let acc = null;
  features.forEach(f => {
    if (!f) return;
    if (!acc) { acc = f; return; }
    try { acc = turf.union(acc, f) || acc; } catch (e) { /* giữ khối đã gộp */ }
  });
  return acc;
}

/** Độ phủ = diện tích đất ở nằm trong bán kính tâm lô / tổng diện tích đất ở. */
function coverPct(members, housingFeature) {
  if (!housingFeature || typeof turf === 'undefined') return null;
  const base = turf.area(housingFeature);
  if (!(base > 0)) return null;
  const buffers = members.map(p => {
    if (!(p.radius > 0) || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
    try { return turf.buffer(turf.point([p.lng, p.lat]), p.radius, { units: 'meters' }); } catch (e) { return null; }
  }).filter(Boolean);
  const covered = unionAll(buffers);
  if (!covered) return 0;
  let hit = null;
  try { hit = turf.intersect(covered, housingFeature); } catch (e) { hit = null; }
  if (!hit) return 0;
  return Math.round(Math.min(100, turf.area(hit) / base * 100) * 10) / 10;
}

function geometryOf(lot) {
  if (!lot.polygons || !lot.polygons.length) return null;
  return lot.polygons.length === 1
    ? { type: 'Polygon', coordinates: lot.polygons[0] }
    : { type: 'MultiPolygon', coordinates: lot.polygons };
}

// ============================ BẢN ĐỒ ============================

function clearPhase(phase) {
  const g = drawn[phase];
  if (g) { g.clearLayers(); g.remove(); }
  drawn[phase] = null;
  lotLayers = lotLayers.filter(x => x.lot.phase !== phase);
}

function clearMap() {
  clearTimeout(qhTimer);
  clearPhase('HT');
  clearPhase('QH');
  resetHeat();
  clearFlash();
  lotLayers = [];
}

const isDetailed = (m) => !!m && m.getZoom() >= TT16_PATTERN_ZOOM;

// Cùng nguyên tắc chú giải ranh lô và bảng tổng hợp (cột Ký hiệu): thu nhỏ tô màu lớp, phóng to tô hoa văn TT16;
// viền theo giai đoạn của layer (HT mảnh, QHDD dải liền, QHDH dải nét đứt) — lớp hiện trạng và quy hoạch chung một bộ ký hiệu
function lotStyle(lot) {
  // Chờ xác nhận tô đen: layer sai quy định viền đen liền, lô chờ chọn cấp trường / chợ - TTTM viền cam nét đứt (bấm để chọn)
  if (lot.ask) return { color: PENDING_TONE, weight: 2, opacity: 1, dashArray: null, fillColor: PENDING_TONE, fillOpacity: 0.6 };
  if (isUnresolvedDecision(lot)) {
    return { color: ASK_COLOR, weight: 2.5, opacity: 1, dashArray: '6 4', fillColor: PENDING_TONE, fillOpacity: 0.6 };
  }
  const split = residentialSubAreas(lot, session.kind);
  const sym = landSymbol(session.kind, lot.landKey, split ? Object.keys(split)[0] : lot.subKey);
  const key = sym.tt16 || landPatternKey(lot.layer, lot.name);
  return tt16SymbolStyle(key, sym.tone, lot.layer, { scenario: lot.phase, detailed: isDetailed(targetMap(lot.phase)) });
}

// Qua ngưỡng zoom hoa văn thì tô lại các lô của bản đồ đó
const zoomHooked = new WeakSet();
function hookZoom(m) {
  if (!m || zoomHooked.has(m)) return;
  zoomHooked.add(m);
  let was = isDetailed(m);
  m.on('zoomend', () => {
    const now = isDetailed(m);
    if (now === was) return;
    was = now;
    if (session && lotLayers.length) applyFocus(false);
  });
}

const targetMap = (phase) => (phase === 'QH' && isCompareOn() && planMap ? planMap : map);

function minSizeWarn(lot) {
  const min = lot.role === 'score' ? rowMinSize(lot.scoreKey) : 0;
  return min > 0 && lot.area < min ? min : 0;
}

function lotTip(lot) {
  const what = lot.ask ? 'Layer chưa đúng quy định — chọn đầu mục ở bảng'
    : isUnresolvedDecision(lot) ? (lot.decisionKind === 'school' ? 'Bấm để chọn cấp trường' : 'Bấm để xác nhận chợ / TTTM')
      : lot.role === 'score' ? rowLabel(lot.scoreKey)
        : `${landRowByKey(session.kind, lot.landKey)?.label || 'Không tính'}${lot.decision ? ` · ${DECISION_LABEL[lot.decision]}` : ''}`;
  const min = minSizeWarn(lot);
  return `<b>${lot.phase}</b> · ${escapeHtml(lot.layer)} · ${fmtNum(Math.round(lot.area))} m²`
    + `${lot.pointName ? `<br><b>${escapeHtml(lot.pointName)}</b> (công trình đã có)` : ''}`
    + `<br>${escapeHtml(what)}${lot.radius ? ` · R ${fmtNum(lot.radius)} m` : ''}`
    + `${min ? `<br><span class="c-orange">Nhỏ hơn quy mô tối thiểu ${fmtNum(min)} m²</span>` : ''}`;
}

// ---------- Bản đồ nhiệt HT / QH ----------

function heatGroups(phase) {
  const groups = {};
  session.lots.forEach(lot => {
    if (lot.phase !== phase || !usable(lot) || lot.role !== 'score' || !lot.type || !(lot.radius > 0)) return;
    if (!Number.isFinite(lot.lat) || !Number.isFinite(lot.lng)) return;
    (groups[lot.type] = groups[lot.type] || []).push([Number(lot.lat.toFixed(6)), Number(lot.lng.toFixed(6)), Math.round(lot.radius)]);
  });
  return groups;
}

function clearHeat(phase) {
  const h = heat[phase];
  if (h.tile) h.tile.remove();
  h.tile = null;
}

function resetHeat() {
  ['HT', 'QH'].forEach(ph => {
    clearHeat(ph);
    Object.assign(heat[ph], { sig: '', url: '', seq: heat[ph].seq + 1, tileUrl: '', tileMap: null });
  });
}

// Chia đôi màn hình: mỗi bên một lớp; bản đồ chung: chỉ lớp QH (HT khi đang ẩn QH) để hai lớp không chồng nhau
function heatVisible(phase) {
  if (!session || !show.heat || !show[phase]) return false;
  return isSplitOn() || phase === 'QH' || !show.QH;
}

function drawHeat(phase) {
  const h = heat[phase];
  const m = targetMap(phase);
  const want = heatVisible(phase) && h.url && m;
  if (want && h.tile && h.tileUrl === h.url && h.tileMap === m) return;
  clearHeat(phase);
  if (!want) return;
  const opacityEl = $('heatOpacity');
  h.tile = L.tileLayer(h.url, { maxZoom: 19, opacity: opacityEl ? opacityEl.value / 100 : 0.3 }).addTo(m);
  h.tileUrl = h.url;
  h.tileMap = m;
}

async function updateHeat(phase) {
  if (!heatVisible(phase)) { clearHeat(phase); return; }
  const h = heat[phase];
  const groups = heatGroups(phase);
  const sig = JSON.stringify(groups);
  if (sig !== h.sig) {
    h.sig = sig;
    h.url = '';
    const seq = ++h.seq;
    clearHeat(phase);
    if (!Object.keys(groups).length) return;
    try {
      const res = await fetch(geeApi('action=getHeatmapTile'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = ((await res.json()) || {}).urlFormat || '';
      if (seq !== h.seq) return;
      h.url = url;
    } catch (err) {
      if (seq === h.seq) h.sig = '';
      console.warn(`Lỗi bản đồ nhiệt ${phase} của đồ án:`, err);
      return;
    }
  }
  drawHeat(phase);
}

// ---------- Kế thừa panel Lớp dữ liệu: lọc theo khung đồ án, bản đồ độ phủ, vùng phủ / ẩn hiện từng nhóm ----------

/** Khung đồ án cho mapEngine.setReviewScope: lớp công trình chỉ hiện trong khung, ô bản đồ độ phủ điều khiển bản đồ nhiệt HT / QH */
function reviewScopeOf() {
  const b = allBounds();
  if (!b.isValid()) return null;
  return {
    key: `${session.project}|${session.files.HT}|${session.files.QH}|${session.lots.length}`,
    bbox: [b.getWest() - SCOPE_PAD_DEG, b.getSouth() - SCOPE_PAD_DEG, b.getEast() + SCOPE_PAD_DEG, b.getNorth() + SCOPE_PAD_DEG],
    onHeat: (on) => {
      if (!session) return;
      show.heat = on;
      updateHeat('HT');
      updateHeat('QH');
    },
    onHeatOpacity: (v) => ['HT', 'QH'].forEach(ph => heat[ph].tile?.setOpacity(v))
  };
}

const groupShown = (type) => {
  const el = ICON_GROUP_KEYS[type] && $(`chk_${ICON_GROUP_KEYS[type]}`);
  return !el || el.checked;
};
const groupBufferOn = (type) => {
  const key = BUFFER_KEYS[type];
  return !!(key && map && layers[key] && map.hasLayer(layers[key]));
};

function drawPhase(phase) {
  clearPhase(phase);
  updateHeat(phase);
  const m = targetMap(phase);
  if (!session || !show[phase] || !m) return;
  hookZoom(m);
  const g = L.featureGroup();
  session.lots.forEach(lot => {
    if (lot.phase !== phase || lot.landKey === 'skip') return;
    const geom = geometryOf(lot);
    if (!geom) return;
    const shape = L.geoJSON(geom, { style: () => lotStyle(lot), bubblingMouseEvents: false })
      .bindTooltip(lotTip(lot), { sticky: true })
      .on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        if (lot.decisionKind && !session.pendingId) { openDecision(lot.id); return; }
        focusRow(lot.ask ? `ask:${lot.layer}` : lot.role === 'score' && lot.phase === 'QH' ? `lot:${lot.id}` : `land:${lot.landKey}`, false);
      });
    g.addLayer(shape);
    lotLayers.push({ lot, shape });
    if (lot.role === 'score' && groupShown(lot.type)) {
      const color = BUFFER_COLORS[lot.type] || '#38bdf8';
      g.addLayer(L.circleMarker([lot.lat, lot.lng], { radius: 4.5, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 1, interactive: false }));
      const ring = phase === 'QH' ? groupBufferOn(lot.type) || bufferFocused(lot) : isSplitOn() && groupBufferOn(lot.type);
      if (lot.radius > 0 && ring) {
        g.addLayer(L.circle([lot.lat, lot.lng], { radius: lot.radius, color, weight: 1.2, dashArray: '6 5', fillColor: color, fillOpacity: 0.05, interactive: false }));
      }
    }
  });
  g.addTo(m);
  drawn[phase] = g;
  if (focusKey) applyFocus(false);
}

/** sequential: đẩy lớp hiện trạng lên trước, sau QH_DELAY_MS mới đến lớp quy hoạch */
function drawAll(sequential = false) {
  clearTimeout(qhTimer);
  drawPhase('HT');
  if (sequential && show.HT && session.lots.some(l => l.phase === 'HT')) {
    clearPhase('QH');
    qhTimer = setTimeout(() => drawPhase('QH'), QH_DELAY_MS);
  } else {
    drawPhase('QH');
  }
}

/** Khung bản đồ trừ phần panel phải đè lên */
function fitTo(bounds, maxZoom = 18) {
  if (!map || !bounds || !bounds.isValid()) return;
  const rp = document.querySelector('.right-panel');
  const open = rp && rp.offsetParent !== null && !document.body.classList.contains('right-collapsed');
  const right = open ? rp.offsetWidth + 24 : 24;
  map.fitBounds(bounds, { paddingTopLeft: [24, 24], paddingBottomRight: [right, 24], maxZoom });
}

function allBounds() {
  const b = L.latLngBounds([]);
  session.lots.forEach(lot => lot.polygons.forEach(poly => poly[0].forEach(([lng, lat]) => b.extend([lat, lng]))));
  return b;
}

const focusMatch = (lot) => {
  if (!focusKey) return false;
  const [k, v] = [focusKey.slice(0, focusKey.indexOf(':')), focusKey.slice(focusKey.indexOf(':') + 1)];
  if (k === 'lot') return lot.id === v;
  if (k === 'ask') return lot.layer === v;
  if (k === 'land') {
    if (v === UNDETERMINED_KEY) return !!lot.ask;
    const [row, sub] = v.split('/');
    if (sub) {
      if (lot.landKey !== row) return false;
      const split = residentialSubAreas(lot, session.kind);
      return split ? sub in split : lot.subKey === sub;
    }
    return lot.landKey === row || (landRowByKey(session.kind, row)?.sumOf || []).includes(lot.landKey);
  }
  if (k === 'score') return lot.phase === 'QH' && (lot.scoreKey === v || (REVIEW_SUM[v] || []).includes(lot.scoreKey));
  return false;
};
const REVIEW_SUM = { DVCC_TOTAL: ['YT_DV', 'VH_DV', 'TM_DV'], DVCC_ALL: ['3-MN', '4-TH', '5-THCS', 'YT_DV', 'VH_DV', 'TM_DV'] };
const focusDrawsBuffer = (key) => key.startsWith('score:') || key.startsWith('lot:');
/** Vòng bán kính của nhóm / lô đang chọn vẫn vẽ khi nút vùng phủ của nhóm đang tắt */
const bufferFocused = (lot) => !!focusKey && focusDrawsBuffer(focusKey) && focusMatch(lot);

function applyFocus(fit) {
  const bounds = L.latLngBounds([]);
  lotLayers.forEach(({ lot, shape }) => {
    if (focusMatch(lot)) {
      shape.setStyle({ color: FOCUS_COLOR, weight: 3.5, dashArray: null, fillColor: FOCUS_COLOR, fillOpacity: 0.5 });
      shape.bringToFront();
      bounds.extend(shape.getBounds());
    } else {
      shape.setStyle(lotStyle(lot));
    }
  });
  document.querySelectorAll('#projectReviewHost [data-focus]').forEach(el => el.classList.toggle('on', el.dataset.focus === focusKey));
  if (fit) fitTo(bounds, 17);
}

// Viền đỏ nét đứt nhấp nháy tạm thời quanh lô vừa zoom tới (SVG riêng để chạy hiệu ứng CSS; bản đồ chính vẽ canvas)
const FLASH_MS = 4500;
const flashRenderers = new WeakMap();
let flash = null;

function clearFlash() {
  if (!flash) return;
  clearTimeout(flash.timer);
  flash.layer.remove();
  flash = null;
}

function flashLot(lot) {
  clearFlash();
  if (!lot) return;
  const m = targetMap(lot.phase);
  const geom = geometryOf(lot);
  if (!m || !geom) return;
  if (!flashRenderers.has(m)) flashRenderers.set(m, L.svg({ padding: 0.3 }));
  const layer = L.geoJSON(geom, {
    renderer: flashRenderers.get(m),
    style: { className: 'review-flash', color: '#ff1f1f', weight: 3.5, opacity: 1, dashArray: '8 6', fill: false },
    interactive: false
  }).addTo(m);
  flash = { layer, timer: setTimeout(clearFlash, FLASH_MS) };
}

function focusRow(key, fit = true) {
  const prev = focusKey;
  focusKey = focusKey === key && !fit ? '' : key;
  if (focusDrawsBuffer(prev) || focusDrawsBuffer(focusKey)) drawPhase('QH');
  applyFocus(fit);
  if (fit && focusKey.startsWith('lot:')) flashLot(session.byId.get(focusKey.slice(4)));
  else clearFlash();
  const el = document.querySelector(`#projectReviewHost [data-focus="${CSS.escape(focusKey)}"]`);
  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ============================ DUYỆT TỪNG ĐỐI TƯỢNG (TRƯỜNG HỌC / THƯƠNG MẠI) ============================

function openDecision(id) {
  session.reviewId = id;
  if (!labelsOverlayOn()) {
    setLabelsOverlay(true);
    labelsAuto = true;
  }
  renderHost();
  focusRow(`lot:${id}`, true);
}

function nextDecision(afterId) {
  const queue = decisionQueue();
  const at = queue.findIndex(l => l.id === afterId);
  const ordered = [...queue.slice(at + 1), ...queue.slice(0, at + 1)];
  return ordered.find(isUnresolvedDecision) || null;
}

function afterDecisions(fromId) {
  applyTags();
  const next = nextDecision(fromId);
  session.reviewId = next ? next.id : null;
  renderHost();
  drawAll(false);
  if (next) focusRow(`lot:${next.id}`, true);
  else { focusKey = ''; applyFocus(false); }
}

function decide(value) {
  const id = session.reviewId;
  if (!id) return;
  session.decisions.set(id, value);
  afterDecisions(id);
}

/** Gán 1 lựa chọn cho mọi lô cùng loại (trường học / dịch vụ) còn chưa xác nhận */
function decideAll(value) {
  const cur = session.byId.get(session.reviewId);
  if (!cur) return;
  const rest = decisionQueue().filter(l => l.decisionKind === cur.decisionKind && isUnresolvedDecision(l));
  if (!rest.length) return;
  const what = cur.decisionKind === 'school' ? 'lô trường học' : 'lô dịch vụ';
  if (!confirm(`Gán "${DECISION_LABEL[value]}" cho ${rest.length} ${what} còn chưa xác nhận?`)) return;
  rest.forEach(l => session.decisions.set(l.id, value));
  afterDecisions(cur.id);
}

function decisionStats(queue) {
  const by = { layer: 0, data: 0, user: 0 };
  queue.forEach(l => { if (l.decisionSrc) by[l.decisionSrc]++; });
  return Object.entries(by).filter(([, n]) => n).map(([k, n]) => `${n} ${SRC_LABEL[k]}`).join(' · ');
}

function decisionHtml() {
  const queue = decisionQueue();
  if (!queue.length) return '';
  const left = queue.filter(isUnresolvedDecision).length;
  const lot = queue.find(l => l.id === session.reviewId);
  const schools = queue.filter(l => l.decisionKind === 'school').length;
  const markets = queue.length - schools;
  const intro = `${schools ? `${schools} lô trường học chưa rõ cấp` : ''}${schools && markets ? ' · ' : ''}${markets ? `${markets} lô dịch vụ cần xác nhận chợ / TTTM` : ''}`;
  const stats = decisionStats(queue);
  if (!lot) {
    return `<div class="review-card review-decide${left ? '' : ' done'}">${ico(left ? 'alert' : 'check')}<span>${left ? `Còn <b>${left}</b>/${queue.length} lô cần xác nhận (${intro}).` : `Đã xác nhận đủ ${queue.length} lô (${intro}).`}${stats ? ` Đã nhận diện: ${stats}.` : ''}
      <small class="review-decide-tip">Đặt tên layer có hậu tố để nhận diện ngay: trường học _MN / _TH / _THCS; DAT_DICHVU_CHO, _TTTM hoặc _KHAC (dịch vụ khác).</small></span>
      <button type="button" class="bp-btn" data-decide-start>${left ? 'Duyệt từng lô' : 'Xem lại'}</button></div>`;
  }
  const at = queue.indexOf(lot);
  const choices = lot.decisionKind === 'school' ? SCHOOL_CHOICES : MARKET_CHOICES;
  const q = lot.decisionKind === 'school' ? 'Lô trường học chưa rõ cấp — chọn cấp trường' : 'Lô dịch vụ — đây có phải chợ hoặc trung tâm thương mại không? (cửa hàng, karaoke… chọn Không)';
  const hits = dataHits(lot);
  const hitTxt = hits.length ? `Công trình đã có trong lô: ${hits.slice(0, 3).map(h => `<b>${escapeHtml(h.name || h.id)}</b>`).join(', ')}${hits.length > 3 ? '…' : ''}` : '';
  const srcTxt = lot.decision && lot.decisionSrc !== 'user' ? ` · đang gán <b>${DECISION_LABEL[lot.decision]}</b> ${SRC_LABEL[lot.decisionSrc]}` : '';
  const restSame = queue.filter(l => l.decisionKind === lot.decisionKind && isUnresolvedDecision(l)).length;
  return `<div class="review-card review-decide active">
    <div class="review-decide-head review-card-title">${ico('alert')}<span>${q} <b>${at + 1}/${queue.length}</b> · còn ${left}</span></div>
    <div class="review-decide-info">${lot.phase === 'HT' ? 'Hiện trạng' : 'Quy hoạch'} · ${escapeHtml(lot.layer)} · ${fmtNum(Math.round(lot.area))} m²${srcTxt}${hitTxt ? `<br>${hitTxt}` : ''}</div>
    <div class="review-decide-btns">${choices.map(([v, label]) => `<button type="button" class="bp-btn${lot.decision === v ? ' on' : ''}${v === 'NO' ? ' rej' : ''}" data-decide="${v}">${label}</button>`).join('')}</div>
    ${restSame > 1 ? `<div class="review-decide-bulk">Gán cho ${restSame} lô cùng loại còn lại: ${choices.map(([v, label]) => `<button type="button" class="bp-btn" data-decide-all="${v}">${label}</button>`).join('')}</div>` : ''}
    <div class="review-decide-nav">
      <span class="c-muted">Bật "Tem đường" để xem tên đường, công trình quanh lô</span>
      <button type="button" class="bp-btn" data-decide-nav="-1">‹ Trước</button>
      <button type="button" class="bp-btn" data-decide-nav="1">Sau ›</button>
      <button type="button" class="bp-btn" data-decide-close>Đóng</button>
    </div>
  </div>`;
}

// ============================ BẢNG ============================

const HA_FORMAT = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const haCell = (v) => (v > 0 ? HA_FORMAT.format(v) : '');
const pctTxt = (v) => (v > 0 ? fmtNum(v) : '');

// Ô ký hiệu: nền hoa văn TT16 như chú giải (khi phóng to), viền = màu tô khi thu nhỏ; đất không có hoa văn TT16 tô đặc.
// Hoa văn ô lặp lớn (y tế, trường học) thu nửa cho vừa ô nhỏ
const SWATCH_HALF = new Set(['7-YT', '3-MN', '4-TH', '5-THCS', '6-THPT',
  'O-NO', 'O-HH', 'O-LX', 'CX-HC', 'CX-CD', 'SX-CN', 'SX-VL', 'DT-NC', 'CQ', 'DL', 'DT-TG', 'AN', 'QP', 'GT',
  'NTR', 'HTK', 'NN', 'RDD', 'RPH', 'RSX', 'TS', 'HO', 'SS', 'MNB']);
function swatchHtml(r) {
  const bg = tt16SwatchCss(r.tt16, SWATCH_HALF.has(r.tt16) ? 0.5 : 1) || `background:${r.tone};`;
  return `<i style="${bg}border-color:${r.tone}"></i>`;
}

function landRowTitle(r, sum) {
  if (sum.byBoundary && r.key === sum.gtKey) return 'Đất giao thông = diện tích ranh đồ án − tổng các loại đất còn lại';
  if (r.undetermined) {
    const gap = [r.gapHtHa > 0 ? `HT ${fmtNum(r.gapHtHa)} ha` : '', r.gapQhHa > 0 ? `QH ${fmtNum(r.gapQhHa)} ha` : ''].filter(Boolean).join(', ');
    return `Tạm thời: lô có layer chưa rõ đầu mục (tô đen trên bản đồ)${gap ? ` + phần chênh ${gap} để tổng hiện trạng = tổng quy hoạch` : ''}`;
  }
  return 'Bấm để xem các lô trên bản đồ';
}

// Ghi chú dưới bảng: nguồn tổng diện tích, hatch giao thông đo được để tự đối chiếu, các loại đất vượt ranh
function landNotesHtml(sum) {
  if (!sum.byBoundary) return '';
  const both = (ht, qh) => [ht > 0 ? `hiện trạng ${haCell(ht)} ha` : '', qh > 0 ? `quy hoạch ${haCell(qh)} ha` : ''].filter(Boolean).join(', ');
  const src = session.boundarySource === 'gis' ? 'ranh file GIS' : 'ranh tự dựng từ các lô';
  const notes = [`Tổng cộng = diện tích ${src}${session.boundaryClosed ? ' (đã tự khép kín)' : ''}; đất giao thông = tổng − các loại đất còn lại.`];
  const hatch = both(sum.gtHatchHtHa, sum.gtHatchQhHa);
  if (hatch) notes.push(`<b>(Lưu ý: Đất giao thông theo hatch đo được là ${hatch})</b>`);
  const over = both(sum.overHtHa, sum.overQhHa);
  if (over) notes.push(`Các loại đất trong ranh cộng lại vượt diện tích ranh (${over}) do lô chồng nhau, đất giao thông tạm ghi 0.`);
  return notes.map(t => `<div class="review-note">${t}</div>`).join('');
}

function landTableHtml() {
  const table = LANDUSE_TABLES[session.kind];
  const sum = landUseSummary(session.lots, session.kind, { boundaryM2: session.boundaryM2 });
  const body = sum.rows.map(r => {
    if (r.kind === 'section') {
      return `<tr class="lu-section"><td>${r.section}</td><td colspan="2">${escapeHtml(r.label)}</td>
        <td>${haCell(r.htHa)}</td><td>${pctTxt(r.htPct)}</td><td>${haCell(r.qhHa)}</td><td>${pctTxt(r.qhPct)}</td></tr>`;
    }
    const key = `land:${r.key}`;
    return `<tr class="lu-row${r.sub ? ' lu-sub' : ''}${r.part ? ' lu-part' : ''}${r.undetermined ? ' lu-undet' : ''}${focusKey === key ? ' on' : ''}" data-focus="${key}" title="${escapeHtml(landRowTitle(r, sum))}">
      <td>${r.stt}</td><td>${escapeHtml(r.label)}</td>
      <td class="lu-code" title="${r.code ? `Tên phân lớp TT16: ${escapeHtml(r.code)}. ` : ''}Bản đồ: thu nhỏ tô màu viền ô, phóng to (zoom ≥ ${TT16_PATTERN_ZOOM}) tô hoa văn TT16">${swatchHtml(r)}${escapeHtml(r.sym || '')}</td>
      <td>${haCell(r.htHa)}</td><td>${pctTxt(r.htPct)}</td><td>${haCell(r.qhHa)}</td><td>${pctTxt(r.qhPct)}</td></tr>`;
  }).join('');
  const totalLabel = sum.sections.length ? `TỔNG CỘNG (${sum.sections.join(' + ')})` : 'TỔNG CỘNG';
  return `<h4 title="${escapeHtml(table.title)}">Bảng tổng hợp sử dụng đất — ${escapeHtml(table.short)}</h4>
    <div class="ward-table-scroll-container"><table class="ward-table review-landuse">
      <thead>
        <tr><th rowspan="2">TT</th><th rowspan="2">${session.kind === 'QHC' ? 'Loại chức năng sử dụng đất' : 'Chức năng ô phố / ô đất'}</th><th rowspan="2" class="lu-code">Ký hiệu</th><th colspan="2">Hiện trạng</th><th colspan="2">Quy hoạch</th></tr>
        <tr><th>ha</th><th>%</th><th>ha</th><th>%</th></tr>
      </thead>
      <tbody>${body}
        <tr class="lu-total"${sum.byBoundary ? ' title="Diện tích theo ranh đồ án"' : ''}><td></td><td colspan="2">${totalLabel}</td><td>${haCell(sum.totalHT)}</td><td>${sum.totalHT > 0 ? '100' : ''}</td><td>${haCell(sum.totalQH)}</td><td>${sum.totalQH > 0 ? '100' : ''}</td></tr>
      </tbody>
    </table></div>${landNotesHtml(sum)}`;
}

function askHtml() {
  const asks = askLayers();
  if (!asks.length || session.pendingId) return '';
  const choices = landChoices(session.kind);
  const head = session.saved
    ? `Layer chưa nhận diện được (${asks.length}) — chọn đầu mục để tính (chỉ trong lần xem này)`
    : `Layer chưa đúng TT16 (${asks.length}) — chọn đầu mục`;
  return `<div class="review-card review-ask"><b class="review-card-title" title="Tô đen trên bản đồ, tạm tính vào dòng Chưa xác định — chọn đầu mục sử dụng đất cho từng layer">${ico('alert')}${head}</b><div class="review-ask-list">${asks.map(r => {
    const cur = session.layerChoice.get(r.layer) || '';
    const opts = [`<option value="">Chọn đầu mục…</option>`]
      .concat(choices.map(c => `<option value="${c.key}"${cur === c.key ? ' selected' : ''}>${escapeHtml(c.label)}</option>`))
      .concat(`<option value="skip"${cur === 'skip' ? ' selected' : ''}>Không tính (không phải đất quy hoạch)</option>`);
    const key = `ask:${r.layer}`;
    return `<div class="review-ask-item${focusKey === key ? ' on' : ''}" data-focus="${escapeHtml(key)}">
      <span class="review-ask-name">${ico('locate')}${escapeHtml(r.layer)} <small>(${[...r.phases].join(' + ')} · ${r.n} hatch · ${fmtNum(Math.round(r.area))} m²)</small></span>
      <select data-layer="${escapeHtml(r.layer)}">${opts.join('')}</select>
    </div>`;
  }).join('')}</div></div>`;
}

function pctCell(pct) {
  if (pct == null) return '<span class="c-muted">—</span>';
  return `<b class="${pct >= 100 ? 'c-green' : 'c-red'}">${fmtNum(pct)}%</b>`;
}

const QCVN_HEAD = `<thead><tr><th></th><th>Loại hạ tầng / Tên công trình</th><th>Diện tích (m²)</th><th>Chỉ tiêu (m²/người)</th>
  <th title="Dòng nhóm: chỉ tiêu × dân số quy hoạch. Dòng công trình: diện tích tối thiểu mỗi công trình">Tổng nhu cầu (m²)</th>
  <th>Số lượng (công trình)</th><th title="Dòng nhóm: diện tích / tổng nhu cầu. Dòng công trình: đạt / chưa đạt diện tích tối thiểu">Đánh giá quy mô (%)</th>
  <th>Đánh giá độ phủ (%)</th></tr></thead>`;

// Tên công trình trong danh sách xổ xuống: tên theo quyết định (Chợ, Trường Mầm non…) hoặc tên dòng, đánh số theo thứ tự lô
function memberName(lot) {
  return lot.displayName || `${DECISION_NAME[lot.decision] || rowLabel(lot.scoreKey)}`;
}

const MIN_SIZE_TITLE = 'Quy mô tối thiểu mỗi công trình theo QCVN 01:2026/BXD (cùng ngưỡng bảng chi tiết phường)';

/** Đánh giá quy mô tối thiểu của 1 công trình (cột Đánh giá quy mô của dòng công trình) */
function minVerdictHtml(lot) {
  const min = rowMinSize(lot.scoreKey);
  if (!min) return '<span class="c-muted">—</span>';
  const pct = Math.round(lot.area / min * 1000) / 10;
  const title = `${MIN_SIZE_TITLE}: ${fmtNum(min)} m² · đạt ${fmtNum(pct)}%`;
  return lot.area >= min
    ? `<b class="c-green" title="${title}">Đạt QM tối thiểu</b>`
    : `<span class="min-size-warn" title="${title}">${ico('alert')}Chưa đạt (${fmtNum(pct)}%)</span>`;
}

/** Số công trình dưới quy mô tối thiểu / số công trình có ngưỡng của dòng (dòng cộng bỏ qua để khỏi đếm đôi) */
function minSizeSummary(row) {
  if (row.sumOf) return '';
  const checked = row.members.filter(p => rowMinSize(p.scoreKey) > 0);
  const below = checked.filter(p => minSizeWarn(p)).length;
  return below ? `<br><span class="min-size-warn" title="${MIN_SIZE_TITLE}">${ico('alert')}${below}/${checked.length} dưới QM tối thiểu</span>` : '';
}

function memberRowsHtml(row) {
  const open = session.openRows.has(row.key);
  return `</tbody><tbody data-members="${row.key}"${open ? '' : ' hidden'}>${row.members.map(p => {
    const min = rowMinSize(p.scoreKey);
    return `<tr class="wt-sub${focusKey === `lot:${p.id}` ? ' on' : ''}" data-focus="lot:${p.id}">
      <td>-</td>
      <td><button type="button" class="link-btn" data-zoom-lot="${p.id}" title="${p.pointName ? 'Tên theo công trình đã có trong dữ liệu nằm trong lô. ' : ''}Zoom tới công trình">${escapeHtml(memberName(p))}</button></td>
      <td>${fmtNum(Math.round(p.area))}</td>
      <td>-</td>
      <td${min ? ` title="Diện tích tối thiểu mỗi công trình (${MIN_SIZE_TITLE})"` : ''}>${min ? `≥ ${fmtNum(min)}` : '-'}</td>
      <td>-</td>
      <td>${minVerdictHtml(p)}</td>
      <td>-</td>
    </tr>`;
  }).join('')}</tbody><tbody>`;
}

const pad2 = (n) => String(n).padStart(2, '0');

function scoreTableTitle(scored) {
  const head = `Bảng thẩm định ${LANDUSE_TABLES[session.kind].short} theo QCVN 01:2026/BXD`;
  return session.kind === 'QHC'
    ? `${head} - Đánh giá hạ tầng cấp đô thị.`
    : `${head} - Đánh giá hạ tầng cấp đơn vị ở: ${pad2(scored.units)} đơn vị ở.`;
}

function scoreTableHtml(scored) {
  const body = [];
  scored.rows.forEach(row => {
    const count = row.perUnit && scored.units > 0 ? `${row.count} / ${scored.units}` : fmtNum(row.count);
    const key = `score:${row.key}`;
    const open = session.openRows.has(row.key);
    const toggle = row.members.length
      ? ` <button type="button" class="sub-toggle" data-members-toggle="${row.key}" aria-expanded="${open}" aria-label="Hiện/ẩn danh sách công trình">${open ? '▲' : '▼'}</button>`
      : '';
    body.push(`<tr class="wt-main${focusKey === key ? ' on' : ''}" data-focus="${key}" title="Bấm để xem các lô và bán kính phục vụ">
      <td></td><td>${escapeHtml(row.label)}${toggle}</td>
      <td>${fmtNum(row.area)}</td>
      <td>${row.quota > 0 ? fmtNum(row.quota) : '—'}</td>
      <td>${row.demand ? fmtNum(row.demand) : '—'}</td>
      <td>${count}</td>
      <td>${pctCell(row.scalePct)}${minSizeSummary(row)}</td>
      <td>${row.members.length ? pctCell(row.coverPct) : '<span class="c-muted">—</span>'}</td>
    </tr>`);
    if (row.members.length) body.push(memberRowsHtml(row));
  });
  const thpt = session.kind === 'QHPK' && Number(session.popQH) > THPT_POP_MIN ? ` · gồm trường THPT (dân số trên ${fmtNum(THPT_POP_MIN)} người)` : '';
  return `<h4 title="Lớp quy hoạch${thpt}">${escapeHtml(scoreTableTitle(scored))}</h4>
    <div class="ward-table-scroll-container"><table class="ward-table review-score">${QCVN_HEAD}<tbody>${body.join('')}</tbody></table></div>`;
}

function computeScore() {
  const qhLots = session.lots.filter(l => l.phase === 'QH' && usable(l) && !l.ask);
  const scored = scoreRows(qhLots, session.popQH, session.kind);
  const seq = {};
  scored.planned.forEach(p => {
    if (p.pointName) { p.displayName = p.pointName; return; }
    const base = DECISION_NAME[p.decision] || rowLabel(p.scoreKey);
    seq[base] = (seq[base] || 0) + 1;
    p.displayName = `${base} ${seq[base]}`;
  });
  const housingFeature = unionAll(scored.housing.map(featureOf));
  scored.rows.forEach(row => {
    row.coverPct = row.members.some(p => p.radius > 0) ? coverPct(row.members, housingFeature) : null;
  });
  scored.control = newLandControl(session.lots, session.kind, session.popHT, session.popQH);
  session.scored = scored;
  return scored;
}

const haOf = (m2) => fmtNum(Math.round(m2 / 100) / 100);
const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function controlVerdict(ctl) {
  if (ctl.ratio == null) return '<span class="c-muted">—</span>';
  return ctl.pass == null
    ? '<span class="c-muted">Tham khảo</span>'
    : `<b class="${ctl.pass ? 'c-green' : 'c-red'}">${ctl.pass ? 'Đạt' : 'Vượt'} (≤ ${ctl.max} m²/người)</b>`;
}

/** Thẻ gọn trên hàng đầu của bảng thẩm định: đất ở HT / giữ lại / mới và chỉ tiêu bình quân */
function controlCardHtml(ctl) {
  const label = capFirst(ctl.landLabel);
  return `<div class="review-card review-ctl">
    <div class="review-card-title">${ico('chart')}Kiểm soát ${escapeHtml(ctl.landLabel)} mới</div>
    <div class="review-kv">
      <span title="File HT">${label} HT</span><span>${session.files.HT ? `<b>${haOf(ctl.currentArea)}</b> ha` : '—'}</span>
      <span title="File QH, layer HT_…">Giữ lại (OHT)</span><span><b>${haOf(ctl.existingArea)}</b> ha</span>
      <span title="File QH, layer QHDD_ / QHDH_ / QH_…">Đất ở mới (OQH)</span><span><b>${haOf(ctl.newArea)}</b> ha</span>
      <span title="Đất ở mới / dân số mới tăng thêm">Bình quân mới</span><span>${ctl.ratio != null ? `<b>${fmtNum(ctl.ratio)}</b> m²/người · ` : ''}${controlVerdict(ctl)}</span>
    </div>
  </div>`;
}

// Cỡ bảng thẩm định: 'min' chỉ còn thanh tiêu đề, 'normal' nửa dưới màn hình, 'max' phủ toàn màn hình
let hostSize = 'normal';

function sizeBtnsHtml() {
  const min = hostSize === 'min', max = hostSize === 'max';
  return `<button type="button" class="bp-btn bp-icon review-size-min${min ? ' up' : ''}" data-host-size="${min ? 'normal' : 'min'}" title="${min ? 'Mở lại bảng' : 'Thu nhỏ bảng (chỉ giữ thanh tiêu đề, bản đồ toàn màn hình)'}">${ico('chev-right')}</button>
    <button type="button" class="bp-btn bp-icon" data-host-size="${max ? 'normal' : 'max'}" title="${max ? 'Thu về nửa màn hình' : 'Phóng to bảng toàn màn hình'}">${ico(max ? 'minimize' : 'maximize')}</button>`;
}

function setHostSize(size) {
  hostSize = size;
  document.body.classList.toggle('review-min', size === 'min');
  document.body.classList.toggle('review-max', size === 'max');
  document.querySelectorAll('#projectReviewHost .review-head-btns').forEach(box => {
    box.querySelectorAll('[data-host-size]').forEach(b => b.remove());
    box.querySelector('#btnReviewClose')?.insertAdjacentHTML('beforebegin', sizeBtnsHtml());
  });
  map?.invalidateSize({ pan: false });
  planMap?.invalidateSize({ pan: false });
}

/** Bảng kiểm soát dân số mới và chỉ tiêu đất đơn vị ở mới bình quân (hồ sơ đã gửi, PDF) */
function controlTableHtml(ctl) {
  const label = capFirst(ctl.landLabel);
  const ha = haOf;
  const verdict = controlVerdict(ctl);
  const row = (name, value, note = '') => `<tr class="wt-main"><td></td><td>${name}</td><td>${value}</td><td>${note}</td></tr>`;
  return `<h4>Kiểm soát dân số mới và ${escapeHtml(ctl.landLabel)} mới</h4>
    <div class="ward-table-scroll-container"><table class="ward-table review-control">
      <thead><tr><th></th><th>Chỉ tiêu</th><th>Giá trị</th><th>Đánh giá</th></tr></thead>
      <tbody>
        ${row('Dân số hiện trạng', `${fmtNum(session.popHT)} người`)}
        ${row('Dân số quy hoạch', `${fmtNum(session.popQH)} người`)}
        ${row('Dân số mới tăng thêm', `<b>${fmtNum(ctl.newPop)} người</b>`, '= QH − HT')}
        ${row(`${label} hiện trạng`, session.files.HT ? `${ha(ctl.currentArea)} ha` : '—', 'File HT')}
        ${row(`${label} hiện trạng theo QH (OHT)`, `${ha(ctl.existingArea)} ha`, 'File QH, layer HT_…')}
        ${row(`${label} mới (OQH)`, `${ha(ctl.newArea)} ha`, 'File QH, layer QHDD_ / QHDH_ / QH_…')}
        ${row(`Chỉ tiêu ${escapeHtml(ctl.landLabel)} mới bình quân`, ctl.ratio != null ? `<b>${fmtNum(ctl.ratio)} m²/người</b>` : '—', verdict)}
      </tbody>
    </table></div>`;
}

function actionsHtml(open) {
  if (session.saved) {
    return `<div class="review-foot review-noprint">
      <span>Tính từ các lô đã lưu của đồ án (lớp sử dụng đất hiện trạng / quy hoạch). Chỉ xem — không ghi Sheet; dân số nhập ở đây lưu trên máy này.</span>
    </div>`;
  }
  if (session.pendingId) {
    return `<div class="review-foot review-noprint">
      <span>Hồ sơ chờ duyệt${session.sender ? ` · người gửi: <b>${escapeHtml(session.sender)}</b>` : ''}. Phê duyệt: dữ liệu chuyển sang khung Nhập hàng loạt để khớp công trình đã có rồi ghi Sheet (Ten_QH = <b>${escapeHtml(session.project)}</b>).</span>
      <button type="button" class="bp-btn rej" id="btnReviewReject">${ico('close')}Từ chối</button>
      <button type="button" class="bp-btn review-approve" id="btnReviewApprove">${ico('check')}Phê duyệt & ghi Sheet</button>
    </div>`;
  }
  const blocked = open.layers || open.lots;
  return `<div class="review-foot review-noprint">
    ${blocked ? `<span class="c-orange">Còn ${open.layers ? `${open.layers} layer chưa rõ đầu mục` : ''}${open.layers && open.lots ? ' và ' : ''}${open.lots ? `${open.lots} lô chưa xác nhận` : ''} — xử lý trước khi chuyển phê duyệt.</span>` : '<span>Kết quả chưa cộng vào bảng phường xã. Chuyển phê duyệt: hồ sơ vào hàng chờ, Admin duyệt rồi mới ghi Sheet.</span>'}
    <input type="text" id="reviewSender" maxlength="80" placeholder="Người gửi / đơn vị (tùy chọn)" value="${escapeHtml(session.sender || '')}">
    <button type="button" class="bp-btn rej" id="btnReviewCancel">${ico('close')}Hủy bỏ</button>
    <button type="button" class="bp-btn review-approve" id="btnReviewSend"${blocked || sending ? ' disabled' : ''}>${ico('send')}Chuyển phê duyệt</button>
    ${isAdmin() ? `<button type="button" class="bp-btn" id="btnReviewApprove"${blocked ? ' disabled' : ''} title="Admin: ghi thẳng vào Sheet, không qua hàng chờ">${ico('check')}Phê duyệt ngay</button>` : ''}
  </div>`;
}

function renderHost() {
  const host = $('projectReviewHost');
  if (!host || !session) return;
  const scored = computeScore();
  const open = unresolved();
  const table = LANDUSE_TABLES[session.kind];
  const htN = session.lots.filter(l => l.phase === 'HT').length;
  const qhN = session.lots.filter(l => l.phase === 'QH').length;
  const housingNote = scored.housingArea > 0
    ? `Đất ở quy hoạch (${session.kind === 'QHC' ? 'đơn vị ở + hỗn hợp' : 'nhóm nhà ở + hỗn hợp'}) ${fmtNum(scored.housingArea)} m². Độ phủ = phần đất ở nằm trong bán kính phục vụ tính từ tâm lô.`
    : `Chưa có lô đất ở quy hoạch (${session.kind === 'QHC' ? 'DAT_DD_Donvio, DAT_DD_Honhop' : 'DAT_O_Nhomnhao, DAT_O_Honhop_Nhomo'}) — cột độ phủ để trống.`;
  const level = session.kind === 'QHC'
    ? 'Cấp đô thị (bảng A)'
    : `Cấp đơn vị ở (bảng B${Number(session.popQH) > THPT_POP_MIN ? ' + THPT' : ''}) · <b>${scored.units}</b> đơn vị ở`;
  const fileCell = (name, n) => (name ? `<b title="${escapeHtml(name)}">${escapeHtml(name)}</b><em>${n} lô</em>` : `<i class="c-muted">${session.saved ? 'chưa có lớp' : 'không có file'}</i>`);
  const popInput = (ph) => `<input type="number" class="review-pop" data-pop="${ph}" min="0" step="100" inputmode="numeric" placeholder="nhập" value="${session[`pop${ph}`] > 0 ? session[`pop${ph}`] : ''}" title="Dân số ${ph === 'HT' ? 'hiện trạng' : 'quy hoạch'} (người)">`;
  const popCell = session.saved
    ? `HT ${popInput('HT')} → QH ${popInput('QH')}${session.popQH > 0 ? ` <b class="c-green">(+${fmtNum(scored.control.newPop)})</b>` : ''}`
    : `HT <b>${session.popHT > 0 ? fmtNum(session.popHT) : '—'}</b> → QH <b>${fmtNum(session.popQH)}</b> <b class="c-green">(+${fmtNum(scored.control.newPop)})</b>`;
  const popHint = session.saved && !(session.popQH > 0)
    ? '<small class="review-card-foot c-orange">Nhập dân số quy hoạch để tính tổng nhu cầu, số đơn vị ở và % đạt chỉ tiêu.</small>'
    : '';
  const scrollTop = host.scrollTop;
  host.innerHTML = `<div id="projectReviewSheet" class="review-sheet">
    <div class="bp-part-head review-head">
      <b class="bp-part-title">${session.saved ? 'THÔNG TIN' : 'THẨM ĐỊNH'} ${escapeHtml(table.short)} · ${escapeHtml(session.project)}</b>
      <div class="review-head-btns review-noprint">
        <label class="review-toggle"><input type="checkbox" data-show="HT"${show.HT ? ' checked' : ''}>Hiện trạng</label>
        <label class="review-toggle"><input type="checkbox" data-show="QH"${show.QH ? ' checked' : ''}>Quy hoạch</label>
        <label class="review-toggle" title="Lô đất ngoài nhóm hạ tầng của đồ án đã lưu, giao với khung nhìn (file trên bucket; đồ án cũ vẫn đọc được tới khi chuyển xong)"><input type="checkbox" data-show-land${state.showLand ? ' checked' : ''}>Đồ án đã lưu</label>
        <button type="button" class="bp-btn${isSplitOn() ? ' on' : ''}" id="btnReviewCompare" title="Chia đôi màn hình: hiện trạng bên trái, quy hoạch bên phải">${ico('compare')}Chia đôi</button>
        <button type="button" class="bp-btn" id="btnReviewPrint" title="Lưu bảng thẩm định ra file PDF">${ico('printer')}In PDF</button>
        ${sizeBtnsHtml()}
        <button type="button" class="bp-btn" id="btnReviewClose">${ico('close')}Đóng</button>
      </div>
    </div>
    <div class="review-top">
      <div class="review-card review-info">
        <div class="review-card-title">${ico('info')}${escapeHtml(table.label)}</div>
        <div class="review-kv">
          <span>${session.saved ? 'Lớp HT' : 'File HT'}</span><span class="review-file-cell">${fileCell(session.files.HT, htN)}</span>
          <span>${session.saved ? 'Lớp QH' : 'File QH'}</span><span class="review-file-cell">${fileCell(session.files.QH, qhN)}</span>
          <span>Dân số</span><span>${popCell}</span>
          <span>Thẩm định</span><span title="${fmtNum(UNIT_POP)} người / đơn vị ở, làm tròn lên">${level}</span>
        </div>
        ${popHint}<small class="review-card-foot">${housingNote}</small>
      </div>
      ${controlCardHtml(scored.control)}
      ${askHtml()}
      ${session.pendingId || session.saved ? '' : decisionHtml()}
    </div>
    <div class="review-cols">
      <div class="review-col review-col-land">${landTableHtml()}</div>
      <div class="review-col">${scoreTableHtml(scored)}</div>
    </div>
    ${actionsHtml(open)}
  </div>`;
  host.scrollTop = scrollTop;
}

function openHost() {
  if (!document.body.classList.contains('project-review')) {
    maxWasOn = document.body.classList.contains('bottom-max');
    if (maxWasOn) setBottomPanelMaximized(false);
  }
  document.body.classList.add('project-review');
  map?.invalidateSize({ pan: false });
}

function closeReview() {
  if (hostSize !== 'normal') setHostSize('normal');
  const wasOpen = document.body.classList.contains('project-review');
  document.body.classList.remove('project-review');
  if (wasOpen && maxWasOn) setBottomPanelMaximized(true);
  maxWasOn = false;
  map?.invalidateSize({ pan: false });
  clearMap();
  focusKey = '';
  if (labelsAuto && labelsOverlayOn()) setLabelsOverlay(false);
  labelsAuto = false;
  if (state.showLand) setLandVisible(false);
  const host = $('projectReviewHost');
  if (host) host.innerHTML = '';
  session = null;
  setReviewScope(null);
}

/** Có đủ 2 file HT + QH: tự chia đôi màn hình (hiện trạng trái, quy hoạch phải); chỉ 1 file: lật sang bản đồ giai đoạn đó */
function autoCompare(lots) {
  const ht = lots.some(l => l.phase === 'HT');
  const qh = lots.some(l => l.phase === 'QH');
  if (ht && qh) setSplit(true);
  else if (!isSplitOn() && (ht || qh)) setViewMode(qh ? 'QH' : 'HT');
}

function newSession(fields) {
  clearMap();
  focusKey = '';
  show.heat = $('chk_heat')?.checked !== false;
  session = {
    layerChoice: new Map(), decisions: new Map(), reviewId: null, pendingId: null, sender: '', scored: null, dossierText: '',
    queue: null, hitCache: new Map(), openRows: new Set(),
    ...fields
  };
  session.byId = new Map(session.lots.map(l => [l.id, l]));
  applyTags();
  openHost();
  renderHost();
  fitTo(allBounds(), 17);
  drawAll(true);
  setReviewScope(reviewScopeOf());
}

// ============================ BƯỚC 1: ĐỌC HỒ SƠ ============================

function togglePanel(on) {
  const panel = $('reviewPanel');
  const btn = $('btnReviewOpen');
  if (!panel) return;
  const next = on == null ? panel.hidden : on;
  panel.hidden = !next;
  btn?.setAttribute('aria-pressed', String(next));
  btn?.classList.toggle('active', next);
  if (next) renderDrafts();
}

function fileLabel(slot) {
  const input = $(slot === 'HT' ? 'reviewFileHT' : 'reviewFileQH');
  const out = $(slot === 'HT' ? 'reviewFileHTName' : 'reviewFileQHName');
  const f = input?.files && input.files[0];
  if (out) out.textContent = f ? `${f.name} · ${fmtNum(Math.round(f.size / 1024))} KB` : (slot === 'HT' ? 'Chọn HT-<mã>.dxf' : 'Chọn QH-<mã>.dxf');
  if (f) detectKind(f.name);
}

/** Tên file có từ khóa QHPK → QHPK 1/2.000, QHC → QHC 1/10.000 (xét QHPK trước) */
function detectKind(fileName) {
  const name = String(fileName || '').toUpperCase();
  const kind = /QHPK/.test(name) ? 'QHPK' : /QHC/.test(name) ? 'QHC' : '';
  const radio = kind && document.querySelector(`input[name="reviewKind"][value="${kind}"]`);
  if (!radio || radio.checked) return;
  radio.checked = true;
  showToast(`Nhận diện theo tên file: ${LANDUSE_TABLES[kind].label}`, 'info');
}

async function readHatches(file, phase, crs) {
  if (!/\.dxf$/i.test(file.name)) throw new Error(`${file.name}: chỉ nhận file .dxf`);
  if (file.size > REVIEW_MAX_BYTES) throw new Error(`${file.name}: lớn hơn 5 MB`);
  const head = await file.slice(0, 22).text();
  if (head.startsWith('AutoCAD Binary DXF')) throw new Error(`${file.name}: DXF nhị phân chưa hỗ trợ — lưu dạng ASCII`);
  const parsed = parseDxf(await file.text());
  const hatches = parsed.entities.filter(e => e.kind === 'HATCH');
  if (!hatches.length) throw new Error(`${file.name}: không có hatch nào`);
  const built = buildParcels(hatches, { crs });
  if (!built.axes.valid) throw new Error(`${file.name}: tọa độ không nằm trong vùng VN-2000 của Huế — kiểm tra hệ tọa độ`);
  return built.parcels.filter(p => p.polygons && p.polygons.length).map((p, i) => ({
    id: `${phase}${i}`, phase, layer: p.layer, area: p.area, lat: p.lat, lng: p.lng, polygons: p.polygons
  }));
}

async function startReview() {
  const kind = document.querySelector('input[name="reviewKind"]:checked')?.value;
  const popHT = Number($('reviewPopHT')?.value) || 0;
  const popQH = Number($('reviewPopQH')?.value) || 0;
  const fHT = $('reviewFileHT')?.files?.[0] || null;
  const fQH = $('reviewFileQH')?.files?.[0] || null;
  if (!LANDUSE_TABLES[kind]) { showToast('Chọn loại hồ sơ QHC hoặc QHPK', 'error'); return; }
  if (!(popQH > 0)) { showToast('Nhập dân số quy hoạch', 'error'); $('reviewPopQH')?.focus(); return; }
  if (!fQH) { showToast('Thêm file quy hoạch QH-<mã>.dxf', 'error'); return; }
  if (!/^QH[-_\s]/i.test(fQH.name)) { showToast(`File quy hoạch phải đặt tên QH-<mã>.dxf (đang là ${fQH.name})`, 'error'); return; }
  if (fHT && !/^HT[-_\s]/i.test(fHT.name)) { showToast(`File hiện trạng phải đặt tên HT-<mã>.dxf (đang là ${fHT.name})`, 'error'); return; }
  const project = projectOfFile(fQH.name);
  if (fHT && projectOfFile(fHT.name).toLowerCase() !== project.toLowerCase()) {
    showToast(`Hai file khác mã đồ án: ${projectOfFile(fHT.name)} và ${project}`, 'error');
    return;
  }
  if (!project) { showToast('Tên file thiếu mã đồ án (VD QH-ABCD.dxf)', 'error'); return; }
  const btn = $('btnReviewStart');
  if (btn) btn.disabled = true;
  showToast('Đang đọc hatch…');
  await new Promise(r => setTimeout(r, 30));
  try {
    const crs = CRS_PRESETS[$('reviewCrs')?.value] || CRS_PRESETS.HUE_3;
    const lots = [...(fHT ? await readHatches(fHT, 'HT', crs) : []), ...await readHatches(fQH, 'QH', crs)];
    togglePanel(false);
    autoCompare(lots);
    newSession({ kind, project, popHT, popQH, files: { HT: fHT ? fHT.name : '', QH: fQH.name }, lots });
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ============================ BƯỚC 4: CHUYỂN PHÊ DUYỆT ============================

const round6 = (v) => (Array.isArray(v) ? v.map(round6) : Math.round(v * 1e6) / 1e6);

function lotName(lot, idx) {
  if (lot.pointName) return lot.pointName;
  return DECISION_NAME[lot.decision] ? `${DECISION_NAME[lot.decision]} ${session.project} ${idx + 1}` : '';
}

function dossierGeoJson() {
  const scored = session.scored;
  const land = landUseSummary(session.lots, session.kind);
  return {
    type: 'FeatureCollection',
    review: {
      v: 2, kind: session.kind, project: session.project, popHT: session.popHT, popQH: session.popQH, files: session.files,
      units: scored.units, housingArea: scored.housingArea, control: scored.control,
      landuse: land.rows.filter(r => r.kind === 'row').map(r => ({ key: r.key, htHa: r.htHa, qhHa: r.qhHa })),
      rows: scored.rows.map(r => ({ key: r.key, area: r.area, count: r.count, demand: r.demand, scalePct: r.scalePct, coverPct: r.coverPct }))
    },
    features: session.lots.filter(usable).map((lot, idx) => {
      const g = geometryOf(lot);
      const name = lotName(lot, idx);
      return g && {
        type: 'Feature',
        properties: {
          Layer: lot.importLayer,
          LayerGoc: lot.layer,
          GiaiDoan: lot.phase,
          DienTich: Math.round(lot.area * 10) / 10,
          Lat: round6(lot.lat),
          Lng: round6(lot.lng),
          Muc: lot.landKey,
          Chon: session.layerChoice.get(lot.layer) || '',
          QuyetDinh: lot.decision || '',
          ...(name ? { Ten: name } : {})
        },
        geometry: { type: g.type, coordinates: round6(g.coordinates) }
      };
    }).filter(Boolean)
  };
}

function resultSummary() {
  const rated = session.scored.rows.filter(r => r.scalePct != null);
  const passed = rated.filter(r => r.scalePct >= 100).length;
  const level = session.kind === 'QHC' ? 'cấp đô thị' : `${session.scored.units} đơn vị ở`;
  const ctl = session.scored.control;
  const ratio = ctl.ratio != null ? ` · đất ở mới ${fmtNum(ctl.ratio)} m²/người${ctl.pass === false ? ' (vượt)' : ''}` : '';
  const small = session.scored.planned.filter(p => minSizeWarn(p)).length;
  return `${LANDUSE_TABLES[session.kind].short} · ${fmtNum(session.popQH)} dân QH · ${level} · đạt quy mô ${passed}/${rated.length} chỉ tiêu${ratio}`
    + `${small ? ` · ${small} công trình dưới QM tối thiểu` : ''}`;
}

async function sendDossier() {
  if (sending || !session) return;
  const open = unresolved();
  if (open.layers || open.lots) { showToast('Còn layer / lô chưa xác nhận', 'error'); return; }
  session.sender = String($('reviewSender')?.value || '').trim();
  const content = JSON.stringify(dossierGeoJson());
  const bytes = new TextEncoder().encode(content).length;
  if (bytes > SEND_MAX_BYTES) {
    showToast(`Hồ sơ sau chuyển đổi ${fmtNum(Math.round(bytes / 104857.6) / 10)} MB, vượt 2 MB — tách đồ án thành nhiều phần`, 'error');
    return;
  }
  const kinds = resultSummary();
  if (!confirm(`Chuyển phê duyệt hồ sơ "${session.project}"?\n• ${kinds}\n• Hồ sơ ở trạng thái chờ; Admin kiểm tra rồi mới ghi Sheet (lưu tạm tối đa 30 ngày).`)) return;
  sending = true;
  renderHost();
  try {
    const res = await fetch(geeApi('action=submitCadPending'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: `${session.project}.geojson`, ext: 'geojson', content, phase: 'QH', crs: '',
        sender: session.sender,
        note: `Thẩm định ${LANDUSE_TABLES[session.kind].short}`,
        kind: 'review',
        summary: { parcels: session.lots.filter(usable).length, create: 0, update: 0, wards: [], kinds }
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
    rememberSent(data.id);
    showToast(`Đã chuyển phê duyệt hồ sơ "${session.project}" — chờ Admin duyệt`, 'success');
    closeReview();
  } catch (err) {
    showToast(`Chưa gửi được: ${err.message}`, 'error');
  } finally {
    sending = false;
    if (session) renderHost();
  }
}

// ============================ BƯỚC 5: ADMIN PHÊ DUYỆT ============================

async function approve() {
  if (!session || !isAdmin()) return;
  const text = session.dossierText || JSON.stringify(dossierGeoJson());
  const fileName = `${session.project}.geojson`;
  const pendingId = session.pendingId;
  closeReview();
  await importReviewDossier(text, fileName, pendingId);
  showToast('Kiểm tra khớp công trình đã có trong khung Nhập hàng loạt rồi bấm GHI VÀO HỆ THỐNG', 'info');
}

async function reject() {
  if (!session?.pendingId) return;
  if (await rejectPending(session.pendingId)) {
    showToast('Đã từ chối hồ sơ', 'success');
    closeReview();
  }
}

function polygonsOf(g) {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

function openDossier({ id, item, text }) {
  let data;
  try { data = JSON.parse(text); } catch (e) { showToast('Hồ sơ hỏng, không đọc được', 'error'); return; }
  const meta = data.review || {};
  if (meta.v !== 2 || !LANDUSE_TABLES[meta.kind]) {
    showToast('Hồ sơ thẩm định theo mẫu cũ — mở trong khung Nhập hàng loạt', 'info');
    importReviewDossier(text, item.fileName || 'tham-dinh.geojson', id);
    return;
  }
  const layerChoice = new Map();
  const decisions = new Map();
  const lots = (data.features || []).map((f, i) => {
    const p = f.properties || {};
    const lot = {
      id: `${p.GiaiDoan === 'HT' ? 'HT' : 'QH'}${i}`, phase: p.GiaiDoan === 'HT' ? 'HT' : 'QH', layer: String(p.LayerGoc || p.Layer || ''),
      area: Number(p.DienTich) || 0, lat: Number(p.Lat), lng: Number(p.Lng), polygons: polygonsOf(f.geometry)
    };
    if (p.Chon) layerChoice.set(lot.layer, String(p.Chon));
    if (p.QuyetDinh) decisions.set(lot.id, String(p.QuyetDinh));
    return lot;
  }).filter(l => l.polygons.length && Number.isFinite(l.lat) && Number.isFinite(l.lng));
  autoCompare(lots);
  newSession({
    kind: meta.kind, project: String(meta.project || projectOfFile(item.fileName)), popHT: Number(meta.popHT) || 0, popQH: Number(meta.popQH) || 0,
    files: meta.files || { HT: '', QH: item.fileName }, lots, layerChoice, decisions,
    pendingId: id, dossierText: text, sender: item.sender || ''
  });
}

// ============================ THÔNG TIN 1 ĐỒ ÁN ĐÃ LƯU ============================

// Dân số mặc định lấy từ danh mục (nhập lúc tạo đồ án); người xem sửa thì nhớ theo tên đồ án trên máy này, ưu tiên hơn danh mục
const POP_STORE_KEY = 'qh_project_pop_v1';
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
const EXISTING_RE = /hien ?tran|hien ?huu|chinh ?trang|cai ?tao|xen ?ghep|bao ?ton/;

function loadPops() {
  try { return JSON.parse(localStorage.getItem(POP_STORE_KEY) || '{}') || {}; } catch (e) { return {}; }
}

function savePop(project, popHT, popQH) {
  const all = loadPops();
  all[project] = { ht: popHT, qh: popQH };
  try { localStorage.setItem(POP_STORE_KEY, JSON.stringify(all)); } catch (e) { /* đầy bộ nhớ */ }
}

/** Đồ án quy hoạch chung → bảng QHC, còn lại (phân khu, chi tiết) → bảng QHPK */
function kindOfProject(name) {
  return /(^|[^a-z])qhc([^a-z]|$)|quy hoach chung/.test(fold(name)) ? 'QHC' : 'QHPK';
}

function savedLot(p, i) {
  const phase = p.phase === 'QH' ? 'QH' : 'HT';
  const polygons = polygonsOf(p.geometry);
  if (!polygons.length) return null;
  let lat = Number(p.lat), lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    try { [lng, lat] = turf.pointOnFeature(p.geometry).geometry.coordinates; } catch (e) { return null; }
  }
  let area = Number(p.area);
  if (!(area > 0)) { try { area = turf.area(p.geometry); } catch (e) { area = 0; } }
  const layer = String(p.layer || '');
  const name = String(p.name || '');
  return {
    id: `${phase}${i}`, phase, layer, name, area, lat, lng, polygons,
    infra: p.kind !== 'DXF', sheetId: String(p.id), pattern: landPatternKey(layer, name),
    existing: EXISTING_RE.test(fold(`${layer} ${name}`))
  };
}

// Vòng ranh chưa khép (điểm cuối ≠ điểm đầu) thì nối về điểm đầu; dưới 3 đỉnh → bỏ
function closeRing(ring) {
  const pts = (ring || []).filter(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (pts.length < 3) return null;
  const a = pts[0], b = pts[pts.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return pts.length >= 4 ? { ring: pts, closed: false } : null;
  return { ring: [...pts, a], closed: true };
}

/** Ranh đồ án thành vùng khép kín: Polygon / MultiPolygon, hoặc ranh còn dạng đường (LineString) thì khép kín. Không dựng được → null */
function closedBoundary(geom) {
  if (!geom || typeof turf === 'undefined') return null;
  const shapes = geom.type === 'Polygon' ? [geom.coordinates]
    : geom.type === 'MultiPolygon' ? geom.coordinates
    : geom.type === 'LineString' ? [[geom.coordinates]]
    : geom.type === 'MultiLineString' ? geom.coordinates.map(line => [line]) : [];
  let closed = false;
  const polys = [];
  shapes.forEach(rings => {
    const fixed = (rings || []).map(closeRing);
    if (!fixed[0]) return;
    const holes = fixed.slice(1).filter(Boolean);
    const poly = [fixed[0].ring, ...holes.map(h => h.ring)];
    try {
      turf.polygon(poly);
      polys.push(poly);
      if (fixed[0].closed || holes.some(h => h.closed)) closed = true;
    } catch (e) { /* vòng ranh hỏng */ }
  });
  if (!polys.length) return null;
  const feature = polys.length === 1 ? turf.polygon(polys[0]) : turf.multiPolygon(polys);
  return { feature, m2: turf.area(feature), closed, bbox: turf.bbox(feature) };
}

// Phần diện tích lô nằm trong ranh (m²): lô của file đồ án có thể chìa ra ngoài ranh (ao hồ, sông, lớp vùng lân cận)
function areaInside(bound, geometry, area) {
  if (!bound || !geometry) return area;
  try {
    const [x0, y0, x1, y1] = turf.bbox(geometry);
    const [bx0, by0, bx1, by1] = bound.bbox;
    if (x1 < bx0 || x0 > bx1 || y1 < by0 || y0 > by1) return 0;
    const hit = turf.intersect(bound.feature, turf.feature(geometry));
    return hit ? Math.min(area, turf.area(hit)) : 0;
  } catch (e) {
    try { return turf.booleanPointInPolygon(turf.pointOnFeature(geometry), bound.feature) ? area : 0; } catch (err) { return area; }
  }
}

async function openProjectInfo(project) {
  if (!project) return;
  if (session && !session.saved && !session.pendingId && !confirm('Đóng hồ sơ thẩm định đang mở để xem thông tin đồ án?')) return;
  showToast(`Đang tải lô đất «${project}»…`);
  try { await projectLayersOf(project); } catch (err) { showToast(`Không tải được đồ án: ${err.message}`, 'error'); return; }
  const entry = (state.projectCatalog || []).find(p => p && p.tenQH === project) || {};
  const bound = closedBoundary(entry.boundary);
  const lots = cachedLots(project).map((p, i) => {
    const lot = savedLot(p, i);
    if (lot && bound) lot.areaIn = areaInside(bound, p.geometry, lot.area);
    return lot;
  }).filter(Boolean);
  if (!lots.length) { showToast('Đồ án chưa có lô sử dụng đất', 'error'); return; }
  const pop = loadPops()[project] || {};
  const has = (ph) => lots.some(l => l.phase === ph);
  autoCompare(lots);
  newSession({
    kind: kindOfProject(project), project,
    popHT: Number(pop.ht) || Number(entry.popHT) || 0,
    popQH: Number(pop.qh) || Number(entry.popQH) || 0,
    files: { HT: has('HT') ? 'Sử dụng đất hiện trạng' : '', QH: has('QH') ? 'Sử dụng đất quy hoạch' : '' },
    boundaryM2: bound ? bound.m2 : 0, boundaryClosed: !!bound?.closed, boundarySource: entry.boundarySource === 'gis' ? 'gis' : 'auto',
    lots, saved: true
  });
}

// ============================ HỒ SƠ ĐÃ GỬI TỪ MÁY NÀY ============================

function loadStore() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch (e) { return []; }
}

function saveStore(list) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, 30))); } catch (e) { /* đầy bộ nhớ */ }
}

function rememberSent(sentId) {
  const land = landUseSummary(session.lots, session.kind, { boundaryM2: session.boundaryM2 });
  const list = loadStore();
  list.unshift({
    id: sentId || `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 8)}`,
    kind: session.kind, name: session.project, at: new Date().toISOString(),
    popHT: session.popHT, popQH: session.popQH, units: session.scored.units, housingArea: session.scored.housingArea,
    landHtml: landTableHtml(), controlHtml: controlTableHtml(session.scored.control), totalQH: land.totalQH,
    rows: session.scored.rows.map(r => ({ section: r.section, label: r.label, area: r.area, count: r.count, demand: r.demand, scalePct: r.scalePct, coverPct: r.coverPct, quota: r.quota }))
  });
  saveStore(list);
}

function renderDrafts() {
  const box = $('reviewDrafts');
  if (!box) return;
  const list = loadStore();
  if (!list.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="review-drafts"><b>Hồ sơ đã gửi từ máy này</b>${list.map(d => `<div>
    <span>${escapeHtml(d.kind)} · ${escapeHtml(d.name)} · ${fmtNum(d.popQH)} dân</span>
    <button type="button" data-open-draft="${escapeHtml(d.id)}">Xem</button>
    <button type="button" data-del-draft="${escapeHtml(d.id)}">Xóa</button>
  </div>`).join('')}</div>`;
}

function showDraft(id) {
  const d = loadStore().find(x => x.id === id);
  const host = $('projectReviewHost');
  if (!d || !host) return;
  clearMap();
  session = null;
  setReviewScope(null);
  openHost();
  const body = d.rows.map(r => `<tr class="wt-main">
    <td></td><td>${escapeHtml(r.label)}</td><td>${fmtNum(r.area)}</td>
    <td>${r.quota > 0 ? fmtNum(r.quota) : '—'}</td>
    <td>${r.demand ? fmtNum(r.demand) : '—'}</td><td>${fmtNum(r.count)}</td>
    <td>${pctCell(r.scalePct)}</td><td>${pctCell(r.coverPct)}</td></tr>`).join('');
  host.innerHTML = `<div id="projectReviewSheet" class="review-sheet">
    <div class="bp-part-head review-head"><b class="bp-part-title">HỒ SƠ ĐÃ GỬI · ${escapeHtml(d.kind)} · ${escapeHtml(d.name)}</b>
      <div class="review-head-btns review-noprint">
        <button type="button" class="bp-btn" id="btnReviewPrint">${ico('printer')}In PDF</button>
        ${sizeBtnsHtml()}
        <button type="button" class="bp-btn" id="btnReviewClose">${ico('close')}Đóng</button>
      </div></div>
    <div class="review-note">Dân số HT ${fmtNum(d.popHT || 0)} · QH ${fmtNum(d.popQH)} · ${d.units} đơn vị ở · đất ở ${fmtNum(d.housingArea)} m². Bản đồ chỉ hiện khi đang mở file.</div>
    <div class="review-cols">
      <div class="review-col">${d.landHtml || ''}</div>
      <div class="review-col">${d.controlHtml || ''}<h4>Bảng thẩm định ${escapeHtml(d.kind)} theo QCVN 01:2026/BXD${d.kind === 'QHC' ? ' - Đánh giá hạ tầng cấp đô thị.' : ` - Đánh giá hạ tầng cấp đơn vị ở: ${pad2(d.units)} đơn vị ở.`}</h4><div class="ward-table-scroll-container"><table class="ward-table">${QCVN_HEAD}<tbody>${body}</tbody></table></div></div>
    </div></div>`;
}

async function exportPdf() {
  const sheet = $('projectReviewSheet');
  if (!sheet) { showToast('Chưa có bảng thẩm định', 'error'); return; }
  if (session) {
    const open = unresolved();
    if (open.layers || open.lots) showToast('Còn layer / lô chưa xác nhận — kết quả trong PDF chưa đầy đủ', 'info');
  }
  if (hostSize === 'min') setHostSize('normal');
  try { await loadHtml2Pdf(); } catch (e) { showToast('Không tải được thư viện PDF', 'error'); return; }
  window.html2pdf().from(sheet).set({
    margin: 6,
    filename: `${session?.saved ? 'Thong-tin' : 'Tham-dinh'}-${session ? session.project : 'ho-so'}.pdf`,
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: {
      scale: 2, useCORS: true, scrollY: 0,
      ignoreElements: (el) => !!(el.classList && el.classList.contains('review-noprint'))
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
  }).save();
}

// ============================ KHỞI TẠO ============================

export function initProjectReview() {
  $('btnReviewOpen')?.addEventListener('click', () => togglePanel());
  $('btnReviewPanelClose')?.addEventListener('click', () => togglePanel(false));
  ['HT', 'QH'].forEach(slot => $(slot === 'HT' ? 'reviewFileHT' : 'reviewFileQH')?.addEventListener('change', () => fileLabel(slot)));
  $('btnReviewStart')?.addEventListener('click', startReview);
  $('reviewDrafts')?.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open-draft]');
    if (open) { showDraft(open.dataset.openDraft); return; }
    const del = e.target.closest('[data-del-draft]');
    if (!del) return;
    saveStore(loadStore().filter(d => d.id !== del.dataset.delDraft));
    renderDrafts();
  });

  const host = $('projectReviewHost');
  host?.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#btnReviewClose')) { closeReview(); return; }
    if (t.closest('#btnReviewPrint')) { exportPdf(); return; }
    const size = t.closest('[data-host-size]');
    if (size) { setHostSize(size.dataset.hostSize); return; }
    if (!session) return;
    if (t.closest('#btnReviewCompare')) { toggleSplit(); return; }
    if (t.closest('#btnReviewCancel')) { if (confirm('Hủy bỏ hồ sơ thẩm định đang xem?')) closeReview(); return; }
    if (t.closest('#btnReviewSend')) { sendDossier(); return; }
    if (t.closest('#btnReviewApprove')) { approve(); return; }
    if (t.closest('#btnReviewReject')) { reject(); return; }
    const dec = t.closest('[data-decide]');
    if (dec) { decide(dec.dataset.decide); return; }
    const all = t.closest('[data-decide-all]');
    if (all) { decideAll(all.dataset.decideAll); return; }
    if (t.closest('[data-decide-start]')) {
      const first = decisionQueue().find(isUnresolvedDecision) || decisionQueue()[0];
      if (first) openDecision(first.id);
      return;
    }
    const tog = t.closest('[data-members-toggle]');
    if (tog) {
      const key = tog.dataset.membersToggle;
      const open = !session.openRows.has(key);
      if (open) session.openRows.add(key); else session.openRows.delete(key);
      const list = host.querySelector(`tbody[data-members="${CSS.escape(key)}"]`);
      if (list) list.hidden = !open;
      tog.textContent = open ? '▲' : '▼';
      tog.setAttribute('aria-expanded', String(open));
      return;
    }
    const zoom = t.closest('[data-zoom-lot]');
    if (zoom) { focusRow(`lot:${zoom.dataset.zoomLot}`, true); return; }
    const nav = t.closest('[data-decide-nav]');
    if (nav) {
      const queue = decisionQueue();
      const at = queue.findIndex(l => l.id === session.reviewId);
      const next = queue[(at + Number(nav.dataset.decideNav) + queue.length) % queue.length];
      if (next) openDecision(next.id);
      return;
    }
    if (t.closest('[data-decide-close]')) { session.reviewId = null; focusKey = ''; renderHost(); drawPhase('QH'); applyFocus(false); return; }
    if (t.closest('select, input, label')) return;
    const row = t.closest('[data-focus]');
    if (row) focusRow(row.dataset.focus, true);
  });
  host?.addEventListener('change', (e) => {
    if (!session) return;
    if (e.target.matches('input[data-show-land]')) {
      setLandVisible(e.target.checked);
      return;
    }
    const pop = e.target.closest('input[data-pop]');
    if (pop) {
      session[`pop${pop.dataset.pop}`] = Math.max(0, Math.round(Number(pop.value) || 0));
      savePop(session.project, session.popHT, session.popQH);
      applyTags();
      renderHost();
      drawAll(false);
      return;
    }
    const toggle = e.target.closest('input[data-show]');
    if (toggle) {
      show[toggle.dataset.show] = toggle.checked;
      drawAll(false);
      return;
    }
    const sel = e.target.closest('select[data-layer]');
    if (!sel) return;
    if (sel.value) session.layerChoice.set(sel.dataset.layer, sel.value);
    else session.layerChoice.delete(sel.dataset.layer);
    applyTags();
    renderHost();
    drawAll(false);
  });
  host?.addEventListener('input', (e) => {
    if (session && e.target.id === 'reviewSender') session.sender = e.target.value;
  });

  // Nút vùng phủ / ô nhóm công trình trong panel Lớp dữ liệu (đã đổi trạng thái ở handler riêng) → vẽ lại chấm, bán kính lô đồ án
  const layerTab = $('tabLayers');
  layerTab?.addEventListener('click', (e) => {
    if (session && e.target.closest('.btn-dot-buffer, #btnToggleAllIcons')) drawAll(false);
  });
  layerTab?.addEventListener('change', (e) => {
    if (session && /^chk_c\d+$/.test(e.target.id || '')) drawAll(false);
  });

  onCompareChange(() => {
    if (!session) return;
    drawAll(false);
    $('btnReviewCompare')?.classList.toggle('on', isSplitOn());
  });
  document.addEventListener(REVIEW_DOSSIER_EVENT, (e) => openDossier(e.detail || {}));
  document.addEventListener(PROJECT_INFO_EVENT, (e) => openProjectInfo(e.detail));
}
