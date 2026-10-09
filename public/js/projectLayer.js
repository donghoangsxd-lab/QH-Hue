// Mục Quy hoạch (tab Lớp dữ liệu): mỗi đồ án (Ten_QH) bật/tắt riêng, tìm, phóng tới, Admin xóa / chuyển đồ án cũ.
// Nút file mở PDF quyết định phê duyệt (projects/<slug>/quyet-dinh.pdf, dưới 1 MB). Admin gắn, thay hoặc gỡ.
// Mũi tên cuối tên đồ án mở các lớp chính (PROJECT_LAYERS): bật/tắt từng lớp, Admin xóa từng lớp, tìm lô trong đồ án.
// Mỗi đồ án 1 màu viền + nền mờ, nhãn tên ở giữa ranh. Zoom < PARCEL_MIN_ZOOM ranh tổng bấm được để phóng tới;
// từ ngưỡng đó vẽ lô (mapEngine.js), ranh tổng nằm dưới lô và không nhận click (đồ án có ranh thật).
import { state } from './state.js';
import {
  map, PARCEL_MIN_ZOOM, refreshProjectLots, focusProjectLots, loadCadParcels, setProjectInfraVisible, showProjectLot, landCode
} from './mapEngine.js';
import { planMap, onCompareChange } from './planMap.js';
import { projectLayersOf, removeCachedLayer, layerKey, isLayerHidden, cachedLots } from './projectFiles.js';
import { landPatternKey, landLabel, TT16_STYLES } from './tt16Symbols.js';
import { geeApi, markDataWritten } from './api.js';
import { signOutAdmin } from './uiComponents.js';
import { escapeHtml, fmtNum, ico } from './utils.js';

const DECISION_MAX_BYTES = 1024 * 1024;
const HIDDEN_KEY = 'qh_hidden_projects';
const HIDDEN_LAYERS_KEY = 'qh_hidden_layers';
// Ranh tổng = hợp các lô nới GAP_M rồi co lại GAP_M: lấp đường / khe giữa các lô rộng ≤ 2·GAP_M
const GAP_M = 15;
// Khớp CAD_GEOJSON_MAX_CHARS (api/gee.js) và giới hạn ô Sheet
const BOUNDARY_MAX_CHARS = 45000;
// Quá số lô này thì hợp ranh quá chậm trên trình duyệt → dùng bao lồi
const EXACT_MAX_LOTS = 4000;
// Màu viền / nền do projectColor gán theo đồ án; nền mờ 10% ở mọi mức zoom
const OUTLINE_STYLE = { weight: 2.4, opacity: 0.95, dashArray: '8 5', fillOpacity: 0.1 };
const OUTLINE_GIS = { ...OUTLINE_STYLE, weight: 2.6, dashArray: null };
const OUTLINE_HULL = { ...OUTLINE_STYLE, dashArray: '2 6' };
// Góc vàng trên vòng màu: các đồ án liền nhau trong danh sách (thường gần nhau) lệch màu rõ
const projectColor = (idx) => `hsl(${Math.round((idx * 137.508) % 360)}, 85%, 62%)`;

const $ = (id) => document.getElementById(id);
const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;

let projects = [];
let onDeleted = null;
let busy = null;
let belowZoom = null;
let query = '';
const outlineGroups = new Map();
const fallbackCache = new Map();
// Danh sách lớp đang mở: Ten_QH → { loading, error, list: projectLayersOf() }
const expanded = new Set();
const layerInfo = new Map();
let layerBusy = null;

// ============================ RANH TỔNG ĐỒ ÁN ============================

const round6 = (c) => (typeof c[0] === 'number' ? [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6] : c.map(round6));

function exteriorOnly(g) {
  if (!g) return null;
  if (g.type === 'Polygon') return { type: 'Polygon', coordinates: [g.coordinates[0]] };
  if (g.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: g.coordinates.map(p => [p[0]]) };
  return null;
}

function mergedOutline(list) {
  let parts = list.map(g => {
    const lot = turf.simplify(turf.feature(g), { tolerance: 0.00001 });
    return turf.buffer(lot, GAP_M, { units: 'meters', steps: 2 });
  }).filter(f => f && f.geometry);
  while (parts.length > 1) {
    const next = [];
    for (let i = 0; i < parts.length; i += 2) {
      next.push(parts[i + 1] ? (turf.union(parts[i], parts[i + 1]) || parts[i]) : parts[i]);
    }
    parts = next;
  }
  if (!parts.length) return null;
  const shrunk = turf.buffer(parts[0], -GAP_M, { units: 'meters', steps: 2 });
  return exteriorOnly((shrunk && shrunk.geometry) || parts[0].geometry);
}

function hullOf(features) {
  const hull = features.length ? turf.convex(turf.featureCollection(features)) : null;
  return hull ? hull.geometry : null;
}

// Đơn giản hóa dần tới khi vừa 1 ô Sheet; vẫn quá thì lấy bao lồi
function fitSize(geom) {
  for (const tol of [0, 0.00002, 0.00005, 0.0001, 0.0002, 0.0005, 0.001]) {
    const g = tol ? turf.simplify(turf.feature(geom), { tolerance: tol }).geometry : geom;
    const out = { type: g.type, coordinates: round6(g.coordinates) };
    if (JSON.stringify(out).length <= BOUNDARY_MAX_CHARS) return out;
  }
  const hull = hullOf([turf.feature(geom)]);
  return hull ? { type: hull.type, coordinates: round6(hull.coordinates) } : null;
}

/** Rút gọn ranh vừa 45.000 ký tự (ô danh mục). Dùng cho ranh file GIS và ranh tự dựng. */
export function fitBoundary(geom) {
  if (!geom || typeof turf === 'undefined') return null;
  try {
    const bare = exteriorOnly(geom) || geom;
    return fitSize(bare);
  } catch (e) {
    console.warn('Không rút gọn được ranh đồ án:', e);
    return null;
  }
}

/** Ranh tổng đồ án từ ranh các lô (GeoJSON Polygon / MultiPolygon); không dựng được → null */
export function projectBoundary(geometries) {
  if (typeof turf === 'undefined') return null;
  const list = (geometries || []).filter(g => g && (g.type === 'Polygon' || g.type === 'MultiPolygon'));
  if (!list.length) return null;
  let shape = null;
  if (list.length <= EXACT_MAX_LOTS) {
    try { shape = mergedOutline(list); } catch (e) { console.warn('Không hợp được ranh lô đồ án, dùng bao lồi:', e); }
  }
  try {
    if (!shape) shape = hullOf(list.map(g => turf.feature(g)));
    return shape ? fitSize(shape) : null;
  } catch (e) {
    console.warn('Không dựng được ranh tổng đồ án:', e);
    return null;
  }
}

// ============================ DANH SÁCH ĐỒ ÁN ============================

function loadHidden() {
  try {
    const saved = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]');
    if (Array.isArray(saved)) state.hiddenProjects = new Set(saved.map(String));
    const layers = JSON.parse(localStorage.getItem(HIDDEN_LAYERS_KEY) || '[]');
    if (Array.isArray(layers)) state.hiddenProjectLayers = new Set(layers.map(String));
  } catch (e) { /* chế độ riêng tư */ }
}

function saveHidden() {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...state.hiddenProjects])); } catch (e) { /* chế độ riêng tư */ }
}

function saveHiddenLayers() {
  try { localStorage.setItem(HIDDEN_LAYERS_KEY, JSON.stringify([...state.hiddenProjectLayers])); } catch (e) { /* chế độ riêng tư */ }
}

// Danh mục lấy từ index (không cần đã tải ranh từng lô). infra/lands là số đếm { size }.
// Đồ án chưa có ranh tổng: ranh tạm dựng từ điểm công trình Ten_QH (đã có trong rawDataList)
function collectProjects() {
  const pointsOf = new Map();
  [...state.rawDataList, ...state.planDataList].forEach(it => {
    const name = String(it.tenQH || '').trim();
    const lat = Number(it.lat), lng = Number(it.lng);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (!pointsOf.has(name)) pointsOf.set(name, []);
    pointsOf.get(name).push([lng, lat]);
  });
  return state.projectCatalog.map(p => ({
    name: p.tenQH,
    slug: p.slug || '',
    legacy: !!p.legacy,
    infra: { size: Number(p.infra) || 0 },
    lands: { size: Number(p.lands) || 0 },
    shapes: [],
    source: p.boundarySource === 'gis' ? 'gis' : (p.boundary ? 'auto' : null),
    points: p.boundary ? [] : (pointsOf.get(p.tenQH) || []),
    area: p.boundary ? {
      id: p.tenQH,
      geometry: p.boundary,
      ward: Array.isArray(p.wards) ? p.wards.join(', ') : '',
      time: p.time || '',
      infraCount: Number(p.infra) || 0,
      landCount: Number(p.lands) || 0
    } : null,
    decision: p.decision && p.decision.slug ? {
      slug: p.decision.slug,
      kind: p.decision.kind === 'link' ? 'link' : 'pdf',
      url: p.decision.kind === 'link' ? String(p.decision.url || '') : '',
      name: p.decision.name || 'Quyết định phê duyệt',
      bytes: Number(p.decision.bytes) || 0,
      at: Number(p.decision.at) || 0,
      embed: p.decision.kind === 'link' ? p.decision.embed === true : true
    } : null
  })).sort((a, b) => a.name.localeCompare(b.name, 'vi')).map((p, i) => ({ ...p, color: projectColor(i) }));
}

// Đồ án nhập trước khi có tab DS_DoAn: ranh tạm = bao lồi các lô / điểm (nhanh), nhập lại file để có ranh đúng
function outlineOf(p) {
  if (p.area) return p.area.geometry;
  if (typeof turf === 'undefined') return null;
  const key = `${p.name}|${p.shapes.length}|${p.points.length}`;
  if (fallbackCache.has(key)) return fallbackCache.get(key);
  let geom = null;
  try {
    geom = hullOf([...p.shapes.map(g => turf.feature(g)), ...p.points.map(c => turf.point(c))]);
  } catch (e) { geom = null; }
  fallbackCache.set(key, geom);
  return geom;
}

function boundsOf(p) {
  const geom = outlineOf(p);
  if (geom) return L.geoJSON(geom).getBounds();
  if (p.points.length) return L.latLngBounds(p.points.map(([lng, lat]) => [lat, lng]));
  return null;
}

function setMaster(on) {
  const master = $('chk_projects');
  if (master) master.checked = on;
  state.showProjects = on;
}

function ensureFullLots() {
  state.showProjectInfra = true;
  const infraChk = $('chk_projectInfra');
  if (infraChk) infraChk.checked = true;
}

function zoomTo(p) {
  const b = boundsOf(p);
  if (!b || !b.isValid() || !map) return;
  let changed = false;
  if (!state.showProjects) { setMaster(true); changed = true; }
  if (!state.showProjectInfra) { ensureFullLots(); changed = true; }
  if (state.hiddenProjects.delete(p.name)) { saveHidden(); changed = true; }
  map.fitBounds(b.pad(0.1), { maxZoom: PARCEL_MIN_ZOOM + 1 });
  if (changed) refreshAll();
  focusProjectLots(p.name);
}

const foldText = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();

function metaText(p) {
  const parts = [`${fmtNum(p.infra.size)} CT`, `${fmtNum(p.lands.size)} lô đất`];
  if (p.area && p.area.time) parts.push(p.area.time.split(' ')[0]);
  return parts.join(' · ');
}

function renderHead() {
  const shownN = projects.filter(p => state.showProjects && !state.hiddenProjects.has(p.name)).length;
  const count = $('projectCount');
  if (count) {
    count.textContent = projects.length ? `${shownN}/${projects.length}` : '0';
    count.classList.toggle('none', !shownN);
  }
  const allBtn = $('btnProjectsAll');
  if (allBtn) {
    allBtn.disabled = !projects.length;
    allBtn.setAttribute('aria-pressed', String(!!projects.length && !shownN));
  }
  const search = $('projectSearch');
  if (search) search.hidden = projects.length <= 5;
}

function renderList() {
  renderHead();
  const box = $('projectList');
  if (!box) return;
  if (!projects.length) {
    box.innerHTML = '<div class="project-empty">Chưa có đồ án. Admin nhập file ở tab Đề xuất › Nhập hàng loạt.</div>';
    return;
  }
  const q = foldText(query.trim());
  const visible = projects.map((p, idx) => ({ p, idx })).filter(({ p }) => !q || foldText(p.name).includes(q));
  const admin = isAdmin();
  const legacyN = projects.filter(p => p.legacy).length;
  const migrating = busy === '__migrate__';
  const migrateBtn = admin && legacyN
    ? `<button type="button" class="project-migrate" data-migrate ${migrating || busy ? ' disabled' : ''}>${migrating ? 'Đang chuyển…' : `Chuyển ${legacyN} đồ án cũ lên bucket`}</button>`
    : '';
  const none = visible.length ? '' : '<div class="project-empty">Không có đồ án khớp từ khóa.</div>';
  box.innerHTML = migrateBtn + none + visible.map(({ p, idx }) => {
    const on = state.showProjects && !state.hiddenProjects.has(p.name);
    const deleting = busy === p.name;
    const tempNote = !p.area ? ' · ranh tạm (bao lồi) — nhập file ranh hoặc nhập lại file để có ranh đúng'
      : p.source === 'gis' ? ' · ranh từ file GIS' : ' · ranh tự dựng từ các lô';
    const where = p.legacy ? 'còn ở file cad_parcels' : 'file riêng trên bucket';
    const open = expanded.has(p.name);
    const decisionTitle = p.decision
      ? `Xem quyết định phê duyệt: ${p.decision.name}`
      : 'Gắn quyết định phê duyệt (PDF dưới 1 MB hoặc link)';
    const decisionBtn = (p.decision || admin)
      ? `<button type="button" class="project-btn${p.decision ? ' has-decision' : ''}" data-decision="${idx}" title="${escapeHtml(decisionTitle)}" aria-label="${p.decision ? 'Xem quyết định phê duyệt' : 'Gắn quyết định phê duyệt'}"${busy ? ' disabled' : ''}>${ico(p.decision ? 'file' : 'save')}</button>`
      : '';
    return `<div class="project-row${on ? '' : ' is-off'}">
      <label class="project-name" title="${escapeHtml(p.name)}${p.area?.ward ? ` — ${escapeHtml(p.area.ward)}` : ''} — ${escapeHtml(metaText(p))} (${where})${tempNote}">
        <input type="checkbox" data-project="${idx}"${on ? ' checked' : ''}><i class="project-color" style="--pc:${p.color}"></i><span>${idx + 1}. ${escapeHtml(p.name)}</span></label>
      ${decisionBtn}
      <button type="button" class="project-btn project-expand${open ? ' open' : ''}" data-expand="${idx}" title="${open ? 'Ẩn' : 'Xem'} các lớp dữ liệu của đồ án" aria-label="Các lớp dữ liệu của đồ án" aria-expanded="${open}">${ico('chev-down')}</button>
      <button type="button" class="project-btn" data-zoom="${idx}" title="Phóng tới đồ án" aria-label="Phóng tới đồ án">${ico('locate')}</button>
      ${admin ? `<button type="button" class="project-btn danger" data-del="${idx}" title="Xóa toàn bộ đồ án" aria-label="Xóa đồ án"${busy ? ' disabled' : ''}>${deleting ? '…' : ico('trash')}</button>` : ''}
    </div>${open ? decisionNote(p, idx) + layersHtml(p, idx, on, admin) : ''}`;
  }).join('');
}

function decisionNote(p, idx) {
  if (!p.decision) return '';
  return `<button type="button" class="project-decision" data-decision="${idx}" title="Xem quyết định phê duyệt">${ico('file')}<span>${escapeHtml(p.decision.name)}</span></button>`;
}

// ============================ LỚP DỮ LIỆU TRONG ĐỒ ÁN ============================

// Số trên dòng lớp (ngắn) và chú thích khi rê chuột (đủ)
function layerCount(g) {
  if (g.kind === 'boundary') {
    if (!g.present) return { short: 'chưa có', full: 'Chưa có ranh — đang dùng ranh tạm (bao lồi). Nhập file ranh giới để có ranh đúng.' };
    return g.source === 'gis' ? { short: 'GIS', full: 'Ranh từ file GIS' } : { short: 'tự dựng', full: 'Ranh tự dựng từ các lô' };
  }
  if (g.kind === 'points') return { short: g.present ? fmtNum(g.count) : 'trống', full: g.present ? `${fmtNum(g.count)} điểm` : 'Chưa có điểm' };
  if (!g.present) return { short: 'trống', full: 'Chưa có lô' };
  const parts = [g.lands ? `${fmtNum(g.lands)} lô đất` : '', g.infra ? `${fmtNum(g.infra)} ranh lô công trình` : ''].filter(Boolean);
  if (g.area) parts.push(`${fmtNum(Math.round(g.area / 100) / 100)} ha`);
  return { short: fmtNum(g.count), full: parts.join(' · ') };
}

function layersHtml(p, idx, projectOn, admin) {
  const info = layerInfo.get(p.name);
  if (!info || info.loading) return '<div class="project-layers"><div class="project-empty">Đang tải các lớp…</div></div>';
  if (info.error) return `<div class="project-layers"><div class="project-empty">Không tải được lớp: ${escapeHtml(info.error)}</div></div>`;
  if (!info.list.length) return '<div class="project-layers"><div class="project-empty">Đồ án chưa có file lớp dữ liệu.</div></div>';
  const rows = info.list.map((g, li) => {
    const key = layerKey(p.name, g.key);
    const on = !state.hiddenProjectLayers.has(key);
    // Ranh tạm (bao lồi) vẫn bật/tắt được dù chưa có file ranh
    const toggleable = g.present || g.kind === 'boundary';
    const count = layerCount(g);
    const deleting = layerBusy === key;
    return `<div class="project-layer${on && projectOn && g.present ? '' : ' is-off'}">
      <label class="project-layer-name" title="${escapeHtml(g.label)} (${g.phase === 'QH' ? 'quy hoạch' : 'hiện trạng'}) — ${escapeHtml(count.full)}">
        <input type="checkbox" data-layer="${idx}:${li}"${on ? ' checked' : ''}${toggleable ? '' : ' disabled'}>
        <i class="project-layer-dot ${g.kind}" style="--dot:${g.kind === 'boundary' ? p.color : g.color}"></i>
        <b class="project-phase ${g.phase === 'QH' ? 'qh' : 'ht'}">${g.phase}</b>
        <span>${escapeHtml(g.label)}</span><small>${escapeHtml(count.short)}</small></label>
      ${admin && g.present && !p.legacy ? `<button type="button" class="project-btn danger" data-layer-del="${idx}:${li}" title="Xóa lớp ${escapeHtml(g.label)} khỏi đồ án" aria-label="Xóa lớp"${layerBusy || busy ? ' disabled' : ''}>${deleting ? '…' : ico('trash')}</button>` : ''}
    </div>`;
  }).join('');
  const lotsN = info.list.filter(g => g.kind === 'lots').reduce((s, g) => s + g.count, 0);
  const search = lotsN ? `<div class="project-lot-search">
      <input type="search" class="project-search" data-lot-search="${idx}" value="${escapeHtml(lotQuery.get(p.name) || '')}"
        placeholder="Tìm trong ${fmtNum(lotsN)} lô: ký hiệu, tên, loại đất…" aria-label="Tìm lô trong đồ án ${escapeHtml(p.name)}">
      <div class="project-lot-results" data-lot-results="${idx}">${lotResultsHtml(p, idx)}</div>
    </div>` : '';
  return `<div class="project-layers">${rows}${search}</div>`;
}

// ============================ TÌM LÔ TRONG ĐỒ ÁN ============================
// So khớp bỏ dấu, bỏ khoảng trắng / dấu câu ("cxhca02" khớp "CXHC.A-02"); hoặc lô chứa đủ mọi từ đã gõ ("di tich a02")

const LOT_HIT_MAX = 40;
const lotQuery = new Map();
const lotHits = new Map();
const lotIndex = new WeakMap();
const flat = (s) => foldText(s).replace(/[^a-z0-9]+/g, '');

function lotTypeLabel(lot) {
  if (lot.nhom && lot.nhom !== 'Đất khác') return lot.nhom;
  return TT16_STYLES[landPatternKey(lot.layer, lot.name)]?.label || landLabel(lot.layer);
}

function lotEntry(tenQH, lot) {
  let e = lotIndex.get(lot);
  if (e) return e;
  const code = landCode({ ...lot, file: tenQH });
  const type = lotTypeLabel(lot);
  const text = foldText([code, lot.name, lot.id, lot.layer, type].join(' '));
  e = { lot, code, type, text, flat: text.replace(/[^a-z0-9]+/g, ''), codeFlat: flat(code) };
  lotIndex.set(lot, e);
  return e;
}

function findLots(tenQH, query) {
  const words = foldText(query).split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return [];
  const q = words.join('');
  const rank = (e) => (e.codeFlat === q ? 0 : e.codeFlat.startsWith(q) ? 1 : e.codeFlat.includes(q) ? 2 : 3);
  return cachedLots(tenQH).map(lot => lotEntry(tenQH, lot))
    .filter(e => e.flat.includes(q) || words.every(w => e.text.includes(w)))
    .sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code, 'vi', { numeric: true }));
}

function lotResultsHtml(p, idx) {
  const query = lotQuery.get(p.name) || '';
  if (!query.trim()) {
    lotHits.delete(p.name);
    return '';
  }
  const all = findLots(p.name, query);
  const hits = all.slice(0, LOT_HIT_MAX);
  lotHits.set(p.name, hits);
  if (!hits.length) return '<div class="project-empty">Không có lô khớp.</div>';
  const more = all.length > hits.length ? `<div class="project-empty">… còn ${fmtNum(all.length - hits.length)} lô, gõ thêm để lọc</div>` : '';
  return hits.map((e, i) => {
    const qh = e.lot.phase === 'QH';
    const area = e.lot.area ? ` · ${fmtNum(Math.round(e.lot.area))} m²` : '';
    return `<button type="button" class="project-lot-hit" data-lot="${idx}:${i}" title="${escapeHtml(e.lot.name || e.type)} — bấm để phóng tới lô">
      <b class="project-phase ${qh ? 'qh' : 'ht'}">${qh ? 'QH' : 'HT'}</b><span>${escapeHtml(e.code || e.lot.id)}</span><small>${escapeHtml(e.type)}${area}</small></button>`;
  }).join('') + more;
}

// Lô thuộc lớp / đồ án đang ẩn thì bật lên trước khi phóng tới
function openLot(p, lot) {
  const phase = lot.phase === 'QH' ? 'QH' : 'HT';
  if (state.hiddenProjectLayers.delete(layerKey(p.name, phase === 'QH' ? 'su-dung-dat' : 'hien-trang'))) saveHiddenLayers();
  if (lot.kind !== 'DXF' && !state.showProjectInfra) ensureFullLots();
  if (!state.showProjects || state.hiddenProjects.has(p.name)) showProject(p);
  showProjectLot({ ...lot, file: p.name, phase });
  refreshAll();
  focusProjectLots(p.name);
}

async function loadLayers(p, force = false) {
  const prev = layerInfo.get(p.name);
  if (prev && !force && (prev.loading || prev.list)) return;
  layerInfo.set(p.name, { loading: true });
  renderList();
  try {
    layerInfo.set(p.name, { list: await projectLayersOf(p.name) });
  } catch (err) {
    layerInfo.set(p.name, { error: err.message || 'lỗi tải file đồ án' });
  }
  renderList();
}

function toggleExpand(p) {
  if (expanded.has(p.name)) {
    expanded.delete(p.name);
    renderList();
    return;
  }
  expanded.add(p.name);
  loadLayers(p);
}

function setLayerOn(p, g, on) {
  const key = layerKey(p.name, g.key);
  if (on) state.hiddenProjectLayers.delete(key);
  else state.hiddenProjectLayers.add(key);
  saveHiddenLayers();
  // Bật lớp của đồ án đang ẩn thì hiện luôn đồ án đó
  if (on && (!state.showProjects || state.hiddenProjects.has(p.name))) {
    showProject(p);
    return;
  }
  refreshAll();
}

function deleteNote(g) {
  if (g.kind === 'boundary') {
    return '• File ranh giới và ranh tổng trong danh mục bị xóa; đồ án hiện ranh tạm (bao lồi) đến khi nhập lại file ranh\n';
  }
  if (g.kind === 'points') return `• ${g.count} điểm chức năng bị xóa khỏi file đồ án trên bucket\n`;
  const parts = [g.lands ? `${g.lands} lô đất` : '', g.infra ? `${g.infra} ranh lô công trình hạ tầng` : ''].filter(Boolean).join(' và ');
  return `• ${parts} của lớp bị xóa khỏi file đồ án trên bucket\n`
    + '• Điểm công trình hạ tầng trên Sheet giữ nguyên (xóa riêng từng công trình trên popup nếu cần)\n';
}

async function deleteLayer(p, g) {
  if (!isAdmin() || busy || layerBusy) return;
  if (!confirm(`XÓA LỚP «${g.label}» khỏi đồ án «${p.name}»?\n\n${deleteNote(g)}\nKhông hoàn tác được.`)) return;
  const key = layerKey(p.name, g.key);
  layerBusy = key;
  renderList();
  try {
    markDataWritten();
    const res = await fetch(geeApi('action=deleteProjectLayer'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
      body: JSON.stringify({ tenQH: p.name, layer: g.key })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) signOutAdmin();
    if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
    removeCachedLayer(p.name, g.key, data.saved, data.counts);
    state.hiddenProjectLayers.delete(key);
    saveHiddenLayers();
    layerBusy = null;
    projects = collectProjects();
    await loadLayers(p, true);
    refreshAll();
    const what = g.kind === 'boundary' ? 'ranh giới' : g.kind === 'points' ? `${data.removed} điểm` : `${data.removed} lô`;
    alert(`Đã xóa lớp «${g.label}» (${what}) khỏi đồ án «${p.name}».`);
  } catch (err) {
    alert(`Không xóa được lớp: ${err.message}`);
  } finally {
    layerBusy = null;
    renderList();
  }
}

// ============================ VẼ RANH TỔNG ============================

// Nhãn tên đặt tại tâm hình; tâm rơi ra ngoài ranh (ranh lõm, nhiều mảnh) thì lấy 1 điểm nằm trong ranh
const labelPoints = new Map();
function labelPointOf(p, geom) {
  const hit = labelPoints.get(p.name);
  if (hit && hit.geom === geom) return hit.at;
  let at = null;
  try {
    const f = turf.feature(geom);
    let c = turf.centroid(f).geometry.coordinates;
    if (!turf.booleanPointInPolygon(c, f)) c = turf.pointOnFeature(f).geometry.coordinates;
    at = L.latLng(c[1], c[0]);
  } catch (e) { at = null; }
  labelPoints.set(p.name, { geom, at });
  return at;
}

function projectLabel(p, at) {
  const icon = L.divIcon({ className: 'project-label', iconSize: null, html: `<span style="--pc:${p.color}">${escapeHtml(p.name)}</span>` });
  return L.marker(at, { icon, interactive: false, keyboard: false, zIndexOffset: -1000 });
}

function drawOutlinesOn(m, list, below) {
  const old = outlineGroups.get(m);
  if (old) {
    old.clearLayers();
    m.removeLayer(old);
    outlineGroups.delete(m);
  }
  if (!list.length) return;
  const group = L.featureGroup();
  const shapes = [];
  list.forEach(p => {
    const geom = outlineOf(p);
    if (!geom) return;
    const base = !p.area ? OUTLINE_HULL : p.source === 'gis' ? OUTLINE_GIS : OUTLINE_STYLE;
    const style = { ...base, color: p.color, fillColor: p.color };
    const at = typeof turf !== 'undefined' ? labelPointOf(p, geom) : null;
    if (at) group.addLayer(projectLabel(p, at));
    if (!below) {
      const shape = L.geoJSON(geom, { style, interactive: false });
      shapes.push(shape);
      group.addLayer(shape);
      return;
    }
    const shape = L.geoJSON(geom, { style, bubblingMouseEvents: false });
    shape.bindTooltip(escapeHtml(p.name), { sticky: true, direction: 'top', className: 'dot-tip' });
    shape.on('click', () => {
      if (state.isPickMode || state.activeMeasureType || state.adminDrawMode || state.sketchTool) return;
      zoomTo(p);
    });
    group.addLayer(shape);
  });
  group.addTo(m);
  // Từ ngưỡng lô: nền mờ nằm dưới lô để không phủ màu lên ký hiệu TT16
  shapes.forEach(s => s.bringToBack());
  outlineGroups.set(m, group);
}

function redrawOutlines() {
  const below = !!map && map.getZoom() < PARCEL_MIN_ZOOM;
  const list = state.showProjects
    ? projects.filter(p => !state.hiddenProjects.has(p.name) && !isLayerHidden(p.name, 'ranh-gioi') && (below || p.area))
    : [];
  if (map) drawOutlinesOn(map, list, below);
  if (planMap) drawOutlinesOn(planMap, list, below);
}

function refreshAll() {
  redrawOutlines();
  refreshProjectLots();
  renderList();
}

function rebuild() {
  projects = collectProjects();
  const names = new Set(projects.map(p => p.name));
  [...fallbackCache.keys()].forEach(k => { if (!names.has(k.split('|')[0])) fallbackCache.delete(k); });
  [...labelPoints.keys()].forEach(k => { if (!names.has(k)) labelPoints.delete(k); });
  // Danh mục vừa tải lại (nhập / xóa đồ án): đọc lại lớp của các đồ án đang mở
  layerInfo.clear();
  [...expanded].forEach(name => { if (!names.has(name)) expanded.delete(name); });
  redrawOutlines();
  renderList();
  projects.filter(p => expanded.has(p.name)).forEach(p => loadLayers(p));
}

function showProject(p) {
  if (!state.showProjects) {
    projects.forEach(other => { if (other.name !== p.name) state.hiddenProjects.add(other.name); });
    setMaster(true);
  }
  state.hiddenProjects.delete(p.name);
  ensureFullLots();
  saveHidden();
  refreshAll();
}

// ============================ XÓA ĐỒ ÁN ============================

async function deleteProject(p) {
  if (!isAdmin() || busy) return;
  const typed = prompt(`XÓA TOÀN BỘ ĐỒ ÁN «${p.name}»:\n`
    + `• ${p.infra.size} công trình hạ tầng có Ten_QH = đồ án: dòng do đồ án tạo bị xóa; dòng có sẵn trên Sheet mà đồ án đã ghi đè`
    + ' được khôi phục giá trị cũ (nếu có sao lưu — đồ án nhập trước khi có sao lưu thì vẫn bị xóa)\n'
    + `• ${p.lands.size} lô đất của đồ án (file trên bucket${p.legacy ? ' / tab DXF cũ' : ''})\n`
    + '• ranh lô trên CAD_Polygon, dòng danh mục DS_DoAn và file projects của đồ án\n\n'
    + 'Không hoàn tác được. Gõ đúng tên đồ án để xác nhận:');
  if (typed === null) return;
  if (typed.trim() !== p.name) { alert('Tên đồ án không khớp, chưa xóa.'); return; }
  busy = p.name;
  renderList();
  try {
    markDataWritten();
    const res = await fetch(geeApi('action=deleteProject'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
      body: JSON.stringify({ project: p.name })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) signOutAdmin();
    if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
    state.hiddenProjects.delete(p.name);
    saveHidden();
    const restoredText = data.restored ? `, khôi phục ${data.restored} dòng có sẵn về giá trị trước khi nhập` : '';
    alert(`Đã xóa đồ án «${p.name}»: ${data.infra} dòng hạ tầng${restoredText}, ${data.lands} lô đất, ${data.polygons} ranh CAD_Polygon.`);
    busy = null;
    if (onDeleted) await onDeleted();
  } catch (err) {
    alert(`Không xóa được đồ án: ${err.message}`);
  } finally {
    busy = null;
    renderList();
  }
}

async function migrateLegacy() {
  if (!isAdmin() || busy) return;
  const n = projects.filter(p => p.legacy).length;
  if (!n) return;
  if (!confirm(`Chuyển ${n} đồ án còn trong cad_parcels.json sang file riêng trên bucket?\n\nNên bật Object versioning của bucket trước. Trong lúc chuyển, bản đồ vẫn đọc dữ liệu cũ.`)) return;
  busy = '__migrate__';
  renderList();
  try {
    let cursor = 0;
    let total = 1;
    let last = {};
    while (cursor < total) {
      const prev = cursor;
      const res = await fetch(geeApi('action=migrateProjects'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
        body: JSON.stringify({ cursor })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) signOutAdmin();
      if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
      cursor = Number(data.cursor) || 0;
      total = Number(data.total) || 0;
      last = data;
      if (data.done) break;
      if (cursor <= prev) throw new Error('Máy chủ không chuyển tiếp được');
    }
    alert(`Đã chuyển ${last.projects != null ? last.projects : n} đồ án lên bucket${last.wardParcels != null ? `. Ranh lô theo phường còn ${last.wardParcels}` : ''}.`);
    await loadCadParcels();
    rebuild();
  } catch (err) {
    alert(`Chưa chuyển xong: ${err.message}. Bấm lại để chuyển tiếp.`);
  } finally {
    busy = null;
    renderList();
  }
}

// ============================ QUYẾT ĐỊNH PHÊ DUYỆT ============================

let viewerName = '';
let decisionTarget = null;
let decisionInput = null;
let pendingReview = null;
let pendingPdf = null;

function decisionUrl(p) {
  if (p.decision && p.decision.kind === 'link' && p.decision.url) return p.decision.url;
  const slug = p.decision && (p.decision.slug || p.slug);
  if (!slug) return '';
  return geeApi(`action=getProjectDecision&slug=${encodeURIComponent(slug)}&v=${p.decision.at || 0}`);
}

function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return v ? `${v} B` : '';
  if (v < 1024 * 1024) return `${Math.round(v / 1024)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function applyDecision(name, decision) {
  const entry = state.projectCatalog.find(x => x && x.tenQH === name);
  if (entry) {
    if (decision) entry.decision = decision;
    else delete entry.decision;
  }
  rebuild();
  return projects.find(p => p.name === name) || null;
}

function ensureViewer() {
  let el = document.getElementById('decisionView');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'decisionView';
  el.className = 'decision-view';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'decisionViewTitle');
  el.innerHTML = `<div class="decision-bar">
      <b id="decisionViewTitle" data-decision-title></b>
      <span data-decision-file></span>
      <a data-decision-open href="#" target="_blank" rel="noopener">Mở tab mới</a>
      <span data-decision-admin hidden>
        <button type="button" data-decision-replace>Thay</button>
        <button type="button" data-decision-remove>Gỡ</button>
      </span>
      <button type="button" data-decision-close aria-label="Đóng quyết định">${ico('close')}</button>
    </div>
    <form class="decision-assign" data-decision-assign hidden>
      <input type="url" data-decision-url placeholder="https://… link xem quyết định" aria-label="Link quyết định phê duyệt" autocomplete="off">
      <button type="submit" data-decision-check>Kiểm tra link</button>
      <button type="button" data-decision-filepick>Chọn PDF ≤ 1 MB</button>
      <p data-decision-review>PDF dưới 1 MB: chọn file để xem trước. Link: bấm Kiểm tra để webapp mở trang. Chỉ gán sau khi chấp nhận.</p>
      <button type="button" data-decision-commit disabled>Gán vào đồ án</button>
    </form>
    <div class="decision-note" data-decision-note hidden></div>
    <iframe title="Quyết định phê duyệt quy hoạch"></iframe>`;
  document.body.appendChild(el);
  el.querySelector('[data-decision-close]').addEventListener('click', closeDecision);
  el.querySelector('[data-decision-assign]').addEventListener('submit', (e) => {
    e.preventDefault();
    const p = projects.find(x => x.name === viewerName);
    if (p) checkDecisionLink(p);
  });
  el.querySelector('[data-decision-url]').addEventListener('input', () => {
    pendingReview = null;
    const commit = el.querySelector('[data-decision-commit]');
    if (commit) commit.disabled = true;
  });
  el.querySelector('[data-decision-filepick]').addEventListener('click', () => {
    const p = projects.find(x => x.name === viewerName);
    if (p) pickDecision(p);
  });
  el.querySelector('[data-decision-commit]').addEventListener('click', () => {
    const p = projects.find(x => x.name === viewerName);
    if (p) commitDecision(p);
  });
  el.querySelector('[data-decision-replace]').addEventListener('click', () => {
    const p = projects.find(x => x.name === viewerName);
    if (p) openAssign(p);
  });
  el.querySelector('[data-decision-remove]').addEventListener('click', () => {
    const p = projects.find(x => x.name === viewerName);
    if (p) removeDecision(p);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.hidden) { e.preventDefault(); closeDecision(); }
  });
  return el;
}

function showFrame(el, src, note) {
  const frame = el.querySelector('iframe');
  const box = el.querySelector('[data-decision-note]');
  if (note) {
    frame.hidden = true;
    frame.removeAttribute('src');
    box.hidden = false;
    box.textContent = note;
    return;
  }
  box.hidden = true;
  box.textContent = '';
  frame.hidden = false;
  if (src) frame.src = src;
  else frame.removeAttribute('src');
}

function openDecision(p) {
  const url = p && decisionUrl(p);
  if (!url) { alert('Đồ án chưa có quyết định phê duyệt.'); return; }
  const el = ensureViewer();
  viewerName = p.name;
  pendingReview = null;
  el.hidden = false;
  el.querySelector('[data-decision-assign]').hidden = true;
  el.querySelector('[data-decision-title]').textContent = p.name;
  const size = fmtBytes(p.decision.bytes);
  el.querySelector('[data-decision-file]').textContent = [p.decision.name || 'Quyết định phê duyệt', p.decision.kind === 'link' ? 'link' : 'PDF', size].filter(Boolean).join(' · ');
  el.querySelector('[data-decision-admin]').hidden = !isAdmin();
  el.querySelector('[data-decision-open]').href = url;
  const embed = p.decision.kind !== 'link' || p.decision.embed === true;
  showFrame(el, embed ? url : '', embed ? '' : 'Trang này không xem được trong khung. Bấm «Mở tab mới» để đọc quyết định.');
}

function revokePdfPreview() {
  if (pendingPdf && pendingPdf.blobUrl) URL.revokeObjectURL(pendingPdf.blobUrl);
  pendingPdf = null;
}

function openAssign(p) {
  if (!isAdmin() || !p) return;
  const el = ensureViewer();
  viewerName = p.name;
  pendingReview = null;
  revokePdfPreview();
  el.hidden = false;
  el.querySelector('[data-decision-title]').textContent = p.name;
  el.querySelector('[data-decision-file]').textContent = p.decision ? 'Thay quyết định' : 'Chưa gán';
  el.querySelector('[data-decision-admin]').hidden = false;
  const assign = el.querySelector('[data-decision-assign]');
  assign.hidden = false;
  assign.querySelector('[data-decision-url]').value = p.decision && p.decision.kind === 'link' ? p.decision.url : '';
  assign.querySelector('[data-decision-review]').textContent = 'PDF dưới 1 MB: chọn file để xem trước. Link: bấm Kiểm tra để webapp mở trang. Chỉ gán sau khi chấp nhận.';
  assign.querySelector('[data-decision-commit]').disabled = true;
  el.querySelector('[data-decision-open]').href = p.decision ? decisionUrl(p) : '#';
  if (!p.decision) showFrame(el, '', '');
}

function closeDecision() {
  const el = document.getElementById('decisionView');
  if (!el || el.hidden) return;
  el.hidden = true;
  const frame = el.querySelector('iframe');
  if (frame) frame.removeAttribute('src');
  viewerName = '';
  revokePdfPreview();
  pendingReview = null;
}

function ensureDecisionInput() {
  if (decisionInput) return decisionInput;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,.pdf';
  input.hidden = true;
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    const p = decisionTarget;
    input.value = '';
    decisionTarget = null;
    if (file && p) previewDecisionFile(p, file);
  });
  document.body.appendChild(input);
  decisionInput = input;
  return input;
}

function pickDecision(p) {
  if (!isAdmin() || busy) return;
  decisionTarget = p;
  ensureDecisionInput().click();
}

async function checkDecisionLink(p) {
  if (!isAdmin() || busy) return;
  const el = ensureViewer();
  const input = el.querySelector('[data-decision-url]');
  const review = el.querySelector('[data-decision-review]');
  const commit = el.querySelector('[data-decision-commit]');
  const url = String(input.value || '').trim();
  pendingReview = null;
  revokePdfPreview();
  commit.disabled = true;
  if (!url) { review.textContent = 'Chưa có link.'; return; }
  review.textContent = 'Đang mở link…';
  busy = p.name;
  try {
    const res = await fetch(geeApi('action=reviewProjectDecision'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
      body: JSON.stringify({ url })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) signOutAdmin();
    if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
    pendingReview = { tenQH: p.name, url: data.url, name: data.name, bytes: data.bytes, embed: data.embed === true, note: data.note || '' };
    const size = fmtBytes(data.bytes);
    review.textContent = [data.note, data.name, size].filter(Boolean).join(' · ') + '. Bấm «Gán vào đồ án» nếu đây đúng quyết định.';
    commit.disabled = false;
    el.querySelector('[data-decision-open]').href = data.url;
    showFrame(el, data.embed ? data.url : '', data.embed ? '' : 'Đã mở được link, nhưng trang không cho nhúng. Bấm «Mở tab mới» để xem trước khi gán.');
  } catch (err) {
    review.textContent = err.message;
    showFrame(el, '', '');
  } finally {
    busy = null;
  }
}

function commitDecision(p) {
  if (pendingPdf && pendingPdf.tenQH === p.name) return uploadDecision(p, pendingPdf.file);
  return commitDecisionLink(p);
}

function sheetNote(data) {
  if (data.sheet) return '';
  return `\n\nQuyết định đã lưu trên webapp. Cột LinkQD trên sheet DS_DoAn chưa ghi được: ${data.sheetMessage || 'hãy triển khai bản Code.gs mới (Deploy → New version).'}`;
}

async function previewDecisionFile(p, file) {
  if (!isAdmin() || busy) return;
  const el = ensureViewer();
  const review = el.querySelector('[data-decision-review]');
  const commit = el.querySelector('[data-decision-commit]');
  pendingReview = null;
  revokePdfPreview();
  commit.disabled = true;
  if (!file || file.size > DECISION_MAX_BYTES) { review.textContent = 'File quyết định phải là PDF nhỏ hơn 1 MB.'; return; }
  if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { review.textContent = 'Chỉ nhận file PDF.'; return; }
  let bytes;
  try { bytes = new Uint8Array(await file.arrayBuffer()); }
  catch (e) { review.textContent = 'Không đọc được file.'; return; }
  if (bytes.length < 5 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '%PDF') {
    review.textContent = 'Nội dung không phải file PDF.';
    return;
  }
  const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  pendingPdf = { tenQH: p.name, file, blobUrl };
  review.textContent = `${file.name} · ${fmtBytes(file.size)}. Đã xem trước. Bấm «Gán vào đồ án» để ghi PDF lên bucket.`;
  commit.disabled = false;
  el.querySelector('[data-decision-open]').href = blobUrl;
  showFrame(el, blobUrl, '');
}

async function commitDecisionLink(p) {
  if (!isAdmin() || busy || !pendingReview || pendingReview.tenQH !== p.name) return;
  const el = ensureViewer();
  const typed = String(el.querySelector('[data-decision-url]').value || '').trim();
  if (!typed) return;
  busy = p.name;
  renderList();
  try {
    const res = await fetch(geeApi('action=putProjectDecision'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
      body: JSON.stringify({ tenQH: p.name, url: pendingReview.url })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) signOutAdmin();
    if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
    pendingReview = null;
    const next = applyDecision(p.name, {
      slug: data.slug, kind: 'link', url: data.url, name: data.name, bytes: data.bytes, at: data.at, embed: data.embed === true
    });
    if (!data.sheet) alert(`Đã gán link.${sheetNote(data)}`);
    if (next) openDecision(next);
  } catch (err) {
    alert(`Không gán được link: ${err.message}`);
  } finally {
    busy = null;
    renderList();
  }
}

function bytesToBase64(bytes) {
  let binary = '';
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + size));
  }
  return btoa(binary);
}

async function uploadDecision(p, file) {
  if (!isAdmin() || busy) return;
  if (!file || file.size > DECISION_MAX_BYTES) { alert('File quyết định phải là PDF nhỏ hơn 1 MB.'); return; }
  if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { alert('Chỉ nhận file PDF.'); return; }
  let bytes;
  try { bytes = new Uint8Array(await file.arrayBuffer()); }
  catch (e) { alert('Không đọc được file.'); return; }
  if (bytes.length < 5 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '%PDF') {
    alert('Nội dung không phải file PDF.');
    return;
  }
  busy = p.name;
  renderList();
  try {
    const res = await fetch(geeApi('action=putProjectDecision'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
      body: JSON.stringify({ tenQH: p.name, name: file.name, pdf: bytesToBase64(bytes) })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) signOutAdmin();
    if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
    revokePdfPreview();
    const next = applyDecision(p.name, { slug: data.slug, kind: 'pdf', url: '', name: data.name, bytes: data.bytes, at: data.at, embed: true });
    if (!data.sheet) alert(`Đã ghi PDF lên bucket.${sheetNote(data)}`);
    if (next) openDecision(next);
  } catch (err) {
    alert(`Không ghi được quyết định: ${err.message}`);
  } finally {
    busy = null;
    renderList();
  }
}

async function removeDecision(p) {
  if (!isAdmin() || busy || !p.decision) return;
  if (!confirm(`Gỡ file quyết định phê duyệt của đồ án «${p.name}»?`)) return;
  busy = p.name;
  renderList();
  try {
    const res = await fetch(geeApi('action=deleteProjectDecision'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
      body: JSON.stringify({ tenQH: p.name })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) signOutAdmin();
    if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
    closeDecision();
    applyDecision(p.name, null);
  } catch (err) {
    alert(`Không gỡ được quyết định: ${err.message}`);
  } finally {
    busy = null;
    renderList();
  }
}

// ============================ KHỞI TẠO ============================

/** opts.onDeleted: gọi sau khi xóa đồ án để tải lại dữ liệu bản đồ */
export function initProjectLayer(opts = {}) {
  onDeleted = opts.onDeleted || null;
  loadHidden();
  const master = $('chk_projects');
  if (master) {
    state.showProjects = master.checked;
    master.addEventListener('change', () => {
      state.showProjects = master.checked;
      refreshAll();
    });
  }
  const infraChk = $('chk_projectInfra');
  if (infraChk) {
    state.showProjectInfra = infraChk.checked;
    infraChk.addEventListener('change', () => setProjectInfraVisible(infraChk.checked));
  }
  // Ẩn tất cả giữ nguyên lớp bật; đang ẩn hết thì hiện lại toàn bộ (và bật lớp nếu đang tắt)
  $('btnProjectsAll')?.addEventListener('click', () => {
    if (!projects.length) return;
    const anyShown = projects.some(p => state.showProjects && !state.hiddenProjects.has(p.name));
    if (anyShown) {
      projects.forEach(p => state.hiddenProjects.add(p.name));
      setMaster(false);
    } else {
      projects.forEach(p => state.hiddenProjects.delete(p.name));
      if (!state.showProjects) setMaster(true);
      ensureFullLots();
    }
    saveHidden();
    refreshAll();
  });
  $('projectSearch')?.addEventListener('input', (e) => {
    query = e.target.value || '';
    renderList();
  });
  // data-layer / data-layer-del = "<chỉ số đồ án>:<chỉ số lớp>"
  const layerOf = (ref) => {
    const [pi, li] = String(ref || '').split(':').map(Number);
    const p = projects[pi];
    const g = p && layerInfo.get(p.name)?.list?.[li];
    return g ? { p, g } : null;
  };
  $('projectList')?.addEventListener('change', (e) => {
    const layerBox = e.target.closest('[data-layer]');
    if (layerBox) {
      const hit = layerOf(layerBox.dataset.layer);
      if (hit) setLayerOn(hit.p, hit.g, layerBox.checked);
      return;
    }
    const box = e.target.closest('[data-project]');
    const p = box && projects[Number(box.dataset.project)];
    if (!p) return;
    if (box.checked) {
      showProject(p);
      return;
    }
    state.hiddenProjects.add(p.name);
    if (!projects.some(x => !state.hiddenProjects.has(x.name))) setMaster(false);
    saveHidden();
    refreshAll();
  });
  // Gõ tìm lô chỉ vẽ lại khung kết quả (vẽ lại cả danh sách sẽ mất con trỏ trong ô tìm)
  $('projectList')?.addEventListener('input', (e) => {
    const box = e.target.closest('[data-lot-search]');
    const idx = box ? Number(box.dataset.lotSearch) : -1;
    const p = projects[idx];
    if (!p) return;
    lotQuery.set(p.name, box.value);
    const out = $('projectList').querySelector(`[data-lot-results="${idx}"]`);
    if (out) out.innerHTML = lotResultsHtml(p, idx);
  });
  $('projectList')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-migrate]')) { migrateLegacy(); return; }
    const lotBtn = e.target.closest('[data-lot]');
    if (lotBtn) {
      const [pi, li] = lotBtn.dataset.lot.split(':').map(Number);
      const p = projects[pi];
      const hit = p && lotHits.get(p.name)?.[li];
      if (hit) openLot(p, hit.lot);
      return;
    }
    const decision = e.target.closest('[data-decision]');
    if (decision) {
      const p = projects[Number(decision.dataset.decision)];
      if (p) { if (p.decision) openDecision(p); else openAssign(p); }
      return;
    }
    const expand = e.target.closest('[data-expand]');
    if (expand) { const p = projects[Number(expand.dataset.expand)]; if (p) toggleExpand(p); return; }
    const layerDel = e.target.closest('[data-layer-del]');
    if (layerDel) { const hit = layerOf(layerDel.dataset.layerDel); if (hit) deleteLayer(hit.p, hit.g); return; }
    const zoom = e.target.closest('[data-zoom]');
    if (zoom) { const p = projects[Number(zoom.dataset.zoom)]; if (p) zoomTo(p); return; }
    const del = e.target.closest('[data-del]');
    if (del) { const p = projects[Number(del.dataset.del)]; if (p) deleteProject(p); }
  });
  document.addEventListener('cadparcels:loaded', rebuild);
  document.addEventListener('auth:change', () => {
    renderList();
    const bar = document.querySelector('#decisionView [data-decision-admin]');
    if (bar) bar.hidden = !isAdmin();
  });
  map?.on('zoomend', () => {
    const below = map.getZoom() < PARCEL_MIN_ZOOM;
    if (below === belowZoom) return;
    belowZoom = below;
    if (!state.showProjects) return;
    redrawOutlines();
    refreshProjectLots();
  });
  onCompareChange(redrawOutlines);
  belowZoom = map ? map.getZoom() < PARCEL_MIN_ZOOM : null;
  rebuild();
}
