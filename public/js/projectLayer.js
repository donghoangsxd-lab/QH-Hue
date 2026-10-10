// Mục Quy hoạch (tab Lớp dữ liệu): đồ án nhóm theo phường (đồ án liên phường có mặt ở mỗi phường), mỗi đồ án (Ten_QH)
// bật/tắt riêng, tìm, bấm tên / nút bảng / ranh trên bản đồ để mở đồ án (phóng tới + thông tin ở panel dưới),
// Admin xóa / chuyển đồ án cũ.
// Nút file mở PDF quyết định phê duyệt (projects/<slug>/quyet-dinh.pdf, dưới 1 MB). Admin gắn, thay hoặc gỡ.
// Mũi tên cuối tên đồ án mở các lớp chính (PROJECT_LAYERS): bật/tắt từng lớp, Admin xóa từng lớp, tìm lô trong đồ án.
// Mỗi đồ án 1 màu viền + nền mờ, nhãn tên ở giữa ranh. Zoom < PARCEL_MIN_ZOOM ranh tổng bấm được để mở đồ án;
// từ ngưỡng đó vẽ lô (mapEngine.js), ranh tổng nằm dưới lô và không nhận click (đồ án có ranh thật).
// Đồ án vừa bấm (state.focusedProject) hiện lô ở mọi zoom; đang chọn phường thì chỉ hiện ranh các đồ án của phường,
// lô cả phường vẽ ở mọi zoom — ranh tổng xuống dưới để bấm được lô.
import { state } from './state.js';
import {
  map, PARCEL_MIN_ZOOM, refreshProjectLots, focusProjectLots, loadCadParcels, setProjectInfraVisible, showProjectLot, landCode
} from './mapEngine.js';
import { planMap, onCompareChange, passToolClick } from './planMap.js';
import { projectLayersOf, removeCachedLayer, layerKey, isLayerHidden, cachedLots, PROJECT_INFO_EVENT, byProjectAreaDesc, focusedProjectName, wardScopeName } from './projectFiles.js';
import { landPatternKey, landLabel, TT16_STYLES } from './tt16Symbols.js';
import { geeApi, markDataWritten } from './api.js';
import { signOutAdmin } from './uiComponents.js';
import { escapeHtml, fmtNum, ico, showToast, RIGHT_TAB_EVENT } from './utils.js';

const DECISION_MAX_BYTES = 1024 * 1024;
const HIDDEN_KEY = 'qh_hidden_projects';
const HIDDEN_LAYERS_KEY = 'qh_hidden_layers';
// Ranh tổng = hợp các lô nới GAP_M rồi co lại GAP_M: lấp đường / khe giữa các lô rộng ≤ 2·GAP_M
const GAP_M = 15;
// Khớp CAD_GEOJSON_MAX_CHARS (api/gee.js) và giới hạn ô Sheet
const BOUNDARY_MAX_CHARS = 45000;
// Quá số lô này thì hợp ranh quá chậm trên trình duyệt → dùng bao lồi
const EXACT_MAX_LOTS = 4000;
// Màu viền / nền do assignColors gán theo đồ án; nền mờ 10% ở mọi mức zoom.
// nonzero: ranh có mảnh trùng nhau vẫn tô kín (evenodd mặc định khoét thành lỗ, rê / bấm bên trong không trúng)
const OUTLINE_STYLE = { weight: 1.6, opacity: 0.9, dashArray: '6 4', fillOpacity: 0.1, fillRule: 'nonzero' };
const OUTLINE_GIS = { ...OUTLINE_STYLE, weight: 1.8, dashArray: null };
const OUTLINE_HULL = { ...OUTLINE_STYLE, dashArray: '2 5' };
// Bảng màu dịu, đọc rõ trên ảnh vệ tinh; đồ án có khung bao giao nhau không trùng màu
const PALETTE = ['#fbbf24', '#38bdf8', '#c084fc', '#4ade80', '#f472b6', '#fb923c', '#2dd4bf', '#a3e635', '#f87171', '#818cf8', '#fde047', '#e879f9'];
const NEIGHBOR_PAD_DEG = 0.003;

const CITY_NAME = 'Thành phố Huế';
const NO_WARD = 'Chưa xác định phường, xã';

const $ = (id) => document.getElementById(id);
const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;

let projects = [];
// Nhóm phường đang mở trong danh sách; currentWard = phường đang chọn (nhóm đánh dấu, luôn mở)
const openGroups = new Set();
let currentWard = null;
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

// turf 6.5 (polygon-clipping) hay lỗi "Unable to complete output ring" do sai số dấu phẩy động; làm tròn tọa độ rồi thử lại,
// không thì cả ranh rơi về bao lồi (phình hàng trăm ha với đồ án ranh lõm)
const UNION_PRECISIONS = [7, 6, 5];

function safeUnion(a, b) {
  try { return turf.union(a, b) || a; } catch (e) { /* thử lại với tọa độ làm tròn */ }
  for (const precision of UNION_PRECISIONS) {
    try {
      return turf.union(turf.truncate(a, { precision }), turf.truncate(b, { precision })) || a;
    } catch (e) { /* giảm độ chính xác */ }
  }
  throw new Error('Không hợp được 2 mảnh ranh lô');
}

function mergedOutline(list) {
  let parts = list.map(g => {
    const lot = turf.simplify(turf.feature(g), { tolerance: 0.00001 });
    return turf.buffer(lot, GAP_M, { units: 'meters', steps: 2 });
  }).filter(f => f && f.geometry);
  while (parts.length > 1) {
    const next = [];
    for (let i = 0; i < parts.length; i += 2) {
      next.push(parts[i + 1] ? safeUnion(parts[i], parts[i + 1]) : parts[i]);
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

// File GIS có đối tượng ranh lặp / chồng nhau → hợp thành 1 vùng (mảnh trùng làm sai diện tích và hướng tô nền)
function dissolveParts(g) {
  if (!g || g.type !== 'MultiPolygon' || g.coordinates.length < 2) return g;
  try {
    const merged = g.coordinates.map(c => turf.polygon(c)).reduce((a, b) => safeUnion(a, b));
    return exteriorOnly(merged.geometry) || g;
  } catch (e) {
    return g;
  }
}

/** Rút gọn ranh vừa 45.000 ký tự (ô danh mục). Dùng cho ranh file GIS và ranh tự dựng. */
export function fitBoundary(geom) {
  if (!geom || typeof turf === 'undefined') return null;
  try {
    const bare = dissolveParts(exteriorOnly(geom) || geom);
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
  return assignColors(state.projectCatalog.map(p => ({
    name: p.tenQH,
    short: shortName(p.tenQH),
    wards: Array.isArray(p.wards) ? p.wards : [],
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
  })).sort((a, b) => a.name.localeCompare(b.name, 'vi')));
}

// Tô màu tham lam theo thứ tự danh sách: lấy màu đầu bảng chưa có ở đồ án kề; kề hết màu thì lấy màu ít dùng nhất quanh nó
function assignColors(list) {
  const boxes = list.map(p => {
    const geom = outlineOf(p);
    try { return geom ? turf.bbox(turf.feature(geom)) : null; } catch (e) { return null; }
  });
  const near = (a, b) => a && b && a[0] - NEIGHBOR_PAD_DEG <= b[2] && b[0] - NEIGHBOR_PAD_DEG <= a[2]
    && a[1] - NEIGHBOR_PAD_DEG <= b[3] && b[1] - NEIGHBOR_PAD_DEG <= a[3];
  list.forEach((p, i) => {
    const used = new Map();
    for (let j = 0; j < i; j++) {
      if (near(boxes[i], boxes[j])) used.set(list[j].color, (used.get(list[j].color) || 0) + 1);
    }
    p.color = PALETTE.find(c => !used.has(c))
      || PALETTE.reduce((best, c) => (used.get(c) < used.get(best) ? c : best), PALETTE[i % PALETTE.length]);
  });
  return list;
}

// Nhãn bản đồ: bỏ số thứ tự, tiền tố loại đồ án, cụm "điều chỉnh quy hoạch phân khu…", ngoặc, phần liệt kê sau dấu phẩy / "thuộc";
// mã khu 1–2 ký tự (A, D…) thành "Khu A"
const SHORT_MAX = 34;
const SHORT_KEEP_DASH = 24;
function shortName(name) {
  let s = String(name || '').trim()
    .replace(/^\d+[.)]?\s+/, '')
    .replace(/^(QHPK|QHCT|QHC|QHCPK|QHPK\.)\s*[-–:]?\s*/i, '')
    .replace(/^(điều chỉnh\s+)?(cục bộ\s+)?(quy hoạch\s+)?(phân khu|chi tiết|chung)?\s*(xây dựng\s+)?(tỷ lệ\s+1\/[\d.]+\s+)?/i, '')
    .replace(/^[\s,;:–-]+/, '')
    .replace(/^(khu vực|xây dựng)\s+/i, '')
    .replace(/\s*\([^)]*\)?/g, '')
    .replace(/[\s–-]+$/, '');
  if (s && s === s.toUpperCase()) s = s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, sp, c) => sp + c.toUpperCase());
  s = s.split(/,|\s+thuộc\s+/i)[0].trim();
  const parts = s.split(/\s+[-–]\s+/);
  if (parts.length > 1 && (parts[0].length <= 2 || s.length > SHORT_KEEP_DASH)) s = parts[0];
  s = s.replace(/(^|\s)phường\s+/gi, '$1').trim();
  if (s && s.length <= 2) s = `Khu ${s.toUpperCase()}`;
  if (s.length > SHORT_MAX) {
    const cut = s.slice(0, SHORT_MAX);
    s = `${cut.slice(0, cut.lastIndexOf(' ') > 12 ? cut.lastIndexOf(' ') : SHORT_MAX).trim()}…`;
  }
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s || String(name || '');
}

const KIND_FULL = { QHCT: 'Quy hoạch chi tiết', QHPK: 'Quy hoạch phân khu', QHC: 'Quy hoạch chung' };

// Tooltip tên đồ án: diễn giải viết tắt loại đồ án đầu tên và tỷ lệ trong ngoặc, giữ nguyên phần còn lại
function fullName(name) {
  return String(name || '').trim()
    .replace(/^(QHCT|QHPK|QHC)\b\.?/i, (m, k) => KIND_FULL[k.toUpperCase()])
    .replace(/\(\s*(1\/[\d.]+)\s*\)/g, '(tỷ lệ $1)');
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
  if (state.focusedProject !== p.name) { state.focusedProject = p.name; changed = true; }
  if (!state.showProjects) { setMaster(true); changed = true; }
  if (!state.showProjectInfra) { ensureFullLots(); changed = true; }
  if (state.hiddenProjects.delete(p.name)) { saveHidden(); changed = true; }
  map.fitBounds(b.pad(0.1), { maxZoom: PARCEL_MIN_ZOOM + 1 });
  if (changed) refreshAll();
  focusProjectLots(p.name);
}

// Mở đồ án (tên, nút bảng hoặc ranh trên bản đồ): phóng tới, làm sáng ranh, thông tin đồ án vào panel dưới (projectReview)
function openProject(p) {
  zoomTo(p);
  focusName = p.name;
  drawFocus();
  pinGlow(p);
  markPicked(p.name);
  document.dispatchEvent(new CustomEvent(PROJECT_INFO_EVENT, { detail: p.name }));
}

/** Bỏ đồ án đang chọn (về xem theo phường / toàn TP); người gọi tự vẽ lại */
export function clearProjectFocus() {
  state.focusedProject = null;
  focusName = null;
  drawFocus();
  markPicked(null);
}

/**
 * Chọn phường: hiện lại các đồ án của phường đang bị ẩn, bật lớp Quy hoạch, mở và cuộn tới nhóm phường trong danh sách
 * (panel phải giữ nguyên trạng thái ẩn / hiện). Toàn TP: bỏ đánh dấu nhóm.
 */
export function revealWardProjects(wardName) {
  const next = wardName && wardName !== CITY_NAME ? wardName : null;
  if (next !== currentWard) openGroups.clear();
  currentWard = next;
  if (currentWard) {
    let changed = false;
    projects.forEach(p => { if (p.wards.includes(currentWard) && state.hiddenProjects.delete(p.name)) changed = true; });
    if (changed) saveHidden();
    if (!state.showProjects) setMaster(true);
    ensureFullLots();
    openGroups.add(currentWard);
    if (query) {
      query = '';
      const search = $('projectSearch');
      if (search) search.value = '';
    }
  }
  refreshAll();
  if (!currentWard) return;
  const group = $('projectList')?.querySelector(`[data-ward-group="${CSS.escape(currentWard)}"]`);
  if (group) requestAnimationFrame(() => scrollWithin(group));
}

// Cuộn khung chứa (kể cả khi panel phải đang ẩn: vẫn giữ bố cục, chỉ trong suốt + thu nhỏ) để el nằm đầu khung
function scrollWithin(el) {
  let box = el.parentElement;
  while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
  if (!box) return;
  const scale = box.getBoundingClientRect().height / (box.offsetHeight || 1) || 1;
  const dy = (el.getBoundingClientRect().top - box.getBoundingClientRect().top) / scale;
  box.scrollTo({ top: Math.max(0, box.scrollTop + dy - 4), behavior: 'smooth' });
}

const foldText = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();

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
  const rows = (items) => items.map(({ p, idx }) => rowHtml(p, idx, admin)).join('');
  // Đang tìm: danh sách phẳng; không tìm: nhóm theo phường, nhóm đóng chưa dựng dòng
  box.innerHTML = migrateBtn + none + (q ? rows(visible) : wardGroups(visible).map(([ward, items]) => {
    const cur = ward === currentWard;
    const open = cur || openGroups.has(ward);
    return `<div class="pg-group${open ? ' open' : ''}${cur ? ' is-current' : ''}" data-ward-group="${escapeHtml(ward)}">
      <button type="button" class="pg-head" data-group-toggle="${escapeHtml(ward)}" aria-expanded="${open}" title="${open ? 'Thu gọn' : 'Xem'} các đồ án của ${escapeHtml(ward)}">
        ${ico('chev-right')}<span>${escapeHtml(ward)}</span><small>${items.length}</small></button>
      ${open ? `<div class="pg-body">${rows(items)}</div>` : ''}
    </div>`;
  }).join(''));
}

function wardGroups(items) {
  const groups = new Map();
  items.forEach(item => {
    (item.p.wards.length ? item.p.wards : [NO_WARD]).forEach(w => {
      if (!groups.has(w)) groups.set(w, []);
      groups.get(w).push(item);
    });
  });
  return [...groups.entries()].sort(([a], [b]) => (a === NO_WARD) - (b === NO_WARD) || a.localeCompare(b, 'vi'));
}

function rowHtml(p, idx, admin) {
  const on = state.showProjects && !state.hiddenProjects.has(p.name);
  const deleting = busy === p.name;
  const open = expanded.has(p.name);
  const decisionTitle = p.decision
    ? `Xem quyết định phê duyệt: ${p.decision.name}`
    : 'Gắn quyết định phê duyệt (PDF dưới 1 MB hoặc link)';
  const decisionBtn = (p.decision || admin)
    ? `<button type="button" class="project-btn${p.decision ? ' has-decision' : ''}" data-decision="${idx}" title="${escapeHtml(decisionTitle)}" aria-label="${p.decision ? 'Xem quyết định phê duyệt' : 'Gắn quyết định phê duyệt'}"${busy ? ' disabled' : ''}>${ico(p.decision ? 'file' : 'save')}</button>`
    : '';
  return `<div class="project-row${on ? '' : ' is-off'}${p.name === pickedName ? ' is-picked' : ''}">
      <label class="project-name" title="${escapeHtml(fullName(p.name))} — bấm để mở đồ án">
        <input type="checkbox" data-project="${idx}"${on ? ' checked' : ''}><span data-focus="${idx}">${idx + 1}. ${escapeHtml(p.name)}</span></label>
      <span class="project-tools">
        <button type="button" class="project-btn project-expand${open ? ' open' : ''}" data-expand="${idx}" title="${open ? 'Ẩn' : 'Xem'} các lớp dữ liệu của đồ án" aria-label="Các lớp dữ liệu của đồ án" aria-expanded="${open}">${ico('chev-down')}</button>
        <button type="button" class="project-btn" data-info="${idx}" title="Thông tin đồ án ở panel dưới: cơ cấu sử dụng đất, bảng tổng hợp sử dụng đất và đánh giá chỉ tiêu QCVN 01:2026" aria-label="Thông tin đồ án">${ico('table')}</button>
        ${decisionBtn}
        ${admin ? `<button type="button" class="project-btn" data-rename="${idx}" title="Đổi tên đồ án (Sheet + danh mục bucket)" aria-label="Đổi tên đồ án"${busy ? ' disabled' : ''}>${ico('pen')}</button>` : ''}
        ${admin ? `<button type="button" class="project-btn danger" data-del="${idx}" title="Xóa toàn bộ đồ án" aria-label="Xóa đồ án"${busy ? ' disabled' : ''}>${deleting ? '…' : ico('trash')}</button>` : ''}
      </span>
    </div>${open ? decisionNote(p, idx) + layersHtml(p, idx, on, admin) : ''}`;
}

// Đồ án đang chọn (bấm ranh trên bản đồ hoặc bấm tên): dòng trong danh sách giữ nền sáng đến khi chọn đồ án khác
let pickedName = null;

// Đồ án liên phường có nhiều dòng: ưu tiên dòng trong nhóm phường đang chọn
function rowOf(name) {
  const idx = projects.findIndex(x => x.name === name);
  const box = $('projectList');
  if (idx < 0 || !box) return null;
  const spans = [...box.querySelectorAll(`[data-focus="${idx}"]`)];
  const hit = spans.find(s => s.closest('.pg-group.is-current')) || spans[0];
  return hit ? hit.closest('.project-row') : null;
}

function markPicked(name) {
  pickedName = name;
  const box = $('projectList');
  box?.querySelectorAll('.project-row.is-picked').forEach(r => r.classList.remove('is-picked'));
  const idx = name ? projects.findIndex(x => x.name === name) : -1;
  if (idx >= 0) box?.querySelectorAll(`[data-focus="${idx}"]`).forEach(s => s.closest('.project-row')?.classList.add('is-picked'));
}

// Bấm ranh đồ án trên bản đồ: chuyển panel Lớp dữ liệu › Quy hoạch (không tự mở panel đang ẩn), mở nhóm phường,
// cuộn tới và làm nổi tên đồ án; từ khóa tìm đang lọc mất đồ án thì xóa từ khóa.
function revealInList(p) {
  document.dispatchEvent(new CustomEvent(RIGHT_TAB_EVENT, { detail: { tab: 'tabLayers', open: false } }));
  document.querySelector('[data-main-tab="plan"]')?.click();
  const q = foldText(query.trim());
  if (q && !foldText(p.name).includes(q)) {
    query = '';
    const search = $('projectSearch');
    if (search) search.value = '';
  }
  if (!query.trim() && !(currentWard && p.wards.includes(currentWard))) openGroups.add(p.wards[0] || NO_WARD);
  renderList();
  markPicked(p.name);
  const row = rowOf(p.name);
  if (!row) return;
  scrollWithin(row);
  row.classList.remove('is-flash');
  void row.offsetWidth;
  row.classList.add('is-flash');
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
    const what = g.kind === 'boundary' ? 'ranh giới' : `${data.removed} lô`;
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
  const icon = L.divIcon({
    className: 'project-label', iconSize: null,
    html: `<span><i style="background:${p.color}"></i>${escapeHtml(p.short)}</span>`
  });
  return L.marker(at, { icon, interactive: false, keyboard: false, zIndexOffset: -1000 });
}

// Kích thước thẻ nhãn (khớp .project-label span trong style.css): chữ 600 11px, chấm màu + đệm ~22px, cao 18px
const LABEL_FONT = '600 11px';
const LABEL_PAD_X = 27;
const LABEL_H = 18;
const LABEL_GAP = 4;
let measureCtx = null;
function labelWidth(text) {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = `${LABEL_FONT} ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`;
  }
  return measureCtx.measureText(text).width + LABEL_PAD_X;
}

const labelGroups = new Map();
const labelLists = new Map();
const boundsMemo = new WeakMap();
const zoomHooked = new WeakSet();

function geomBounds(geom) {
  let b = boundsMemo.get(geom);
  if (!b) {
    b = L.geoJSON(geom).getBounds();
    boundsMemo.set(geom, b);
  }
  return b;
}

// Nhãn chỉ hiện khi khung ranh trên màn hình đủ chứa thẻ; chồng nhau thì giữ đồ án lớn hơn. Chạy lại mỗi lần zoom.
function layoutLabels(m) {
  const old = labelGroups.get(m);
  if (old) {
    old.clearLayers();
    m.removeLayer(old);
    labelGroups.delete(m);
  }
  const list = labelLists.get(m) || [];
  if (!list.length || typeof turf === 'undefined') return;
  const cands = [];
  try {
    list.forEach(p => {
      const geom = shownOutline(p);
      const at = geom ? labelPointOf(p, geom) : null;
      if (!at) return;
      const b = geomBounds(geom);
      const nw = m.latLngToContainerPoint(b.getNorthWest());
      const se = m.latLngToContainerPoint(b.getSouthEast());
      const bw = se.x - nw.x;
      const bh = se.y - nw.y;
      const w = labelWidth(p.short);
      if (bw < w * 0.75 || bh < LABEL_H * 1.5) return;
      const c = m.latLngToContainerPoint(at);
      cands.push({
        p, at, size: bw * bh,
        box: [c.x - w / 2 - LABEL_GAP, c.y - LABEL_H / 2 - LABEL_GAP, c.x + w / 2 + LABEL_GAP, c.y + LABEL_H / 2 + LABEL_GAP]
      });
    });
  } catch (e) { return; }
  cands.sort((a, b) => b.size - a.size);
  const placed = [];
  const group = L.layerGroup();
  cands.forEach(({ p, at, box }) => {
    const [x0, y0, x1, y1] = box;
    if (placed.some(([a0, b0, a1, b1]) => x0 < a1 && a0 < x1 && y0 < b1 && b0 < y1)) return;
    placed.push(box);
    group.addLayer(projectLabel(p, at));
  });
  group.addTo(m);
  labelGroups.set(m, group);
}

// ============================ VIỀN SÁNG KHI RÊ / BẤM TÊN ============================

// Pane riêng trên lô (pane lô ~400–440), dưới khung tìm lô (450); không bắt chuột
const GLOW_PANE = 'projectGlowPane';
const GLOW_Z = 445;
const GLOW_PIN_MS = 3000;
const GLOW_STYLES = [
  { color: '#ffffff', weight: 9, opacity: 0.22 },
  { color: '#ffffff', weight: 2.6, opacity: 1 }
];
const glows = new Map();
const hovered = new Map();
let pinnedName = null;
let pinTimer = null;

const shownMaps = () => [map, planMap].filter(Boolean);

function clearGlow(m) {
  const cur = glows.get(m);
  if (!cur) return;
  m.removeLayer(cur.layer);
  glows.delete(m);
}

function updateGlow(m) {
  const name = hovered.get(m) || pinnedName;
  const p = name ? (labelLists.get(m) || []).find(x => x.name === name) : null;
  const cur = glows.get(m);
  if (cur && p && cur.name === p.name) return;
  clearGlow(m);
  const geom = p && outlineOf(p);
  if (!geom) return;
  if (!m.getPane(GLOW_PANE)) {
    const pane = m.createPane(GLOW_PANE);
    pane.style.zIndex = GLOW_Z;
    pane.style.pointerEvents = 'none';
  }
  const layer = L.featureGroup(GLOW_STYLES.map(s => L.geoJSON(geom, {
    style: { ...s, fill: false, dashArray: null, lineJoin: 'round' }, interactive: false, pane: GLOW_PANE
  }))).addTo(m);
  glows.set(m, { name: p.name, layer });
}

function setHover(m, name) {
  if ((hovered.get(m) || null) === (name || null)) return;
  if (name) hovered.set(m, name); else hovered.delete(m);
  updateGlow(m);
}

function pinGlow(p) {
  pinnedName = p.name;
  clearTimeout(pinTimer);
  pinTimer = setTimeout(() => {
    pinnedName = null;
    shownMaps().forEach(updateGlow);
  }, GLOW_PIN_MS);
  shownMaps().forEach(updateGlow);
}

// ============================ ĐỒ ÁN ĐANG MỞ: VIỀN ĐẬM + PHỦ TỐI NGOÀI RANH ============================

// Pane trên điểm công trình (markerPane 600) để phủ tối cả icon ngoài ranh, dưới tooltip (650) / popup (700); không bắt chuột
const FOCUS_PANE = 'projectFocusPane';
const FOCUS_Z = 620;
const FOCUS_MASK = { stroke: false, fill: true, fillColor: '#020617', fillOpacity: 0.55, interactive: false };
const FOCUS_LINES = [
  { color: '#020617', weight: 9, opacity: 0.7 },
  { color: '#ffffff', weight: 3.6, opacity: 1 }
];
const WORLD_RING = [[85, -180], [85, 180], [-85, 180], [-85, -180]];
const focusLayers = new Map();
let focusName = null;

const outerRings = (geom) => (geom.type === 'Polygon' ? [geom.coordinates[0]]
  : geom.type === 'MultiPolygon' ? geom.coordinates.map(c => c[0]) : []);

function clearFocusOn(m) {
  const old = focusLayers.get(m);
  if (!old) return;
  old.clearLayers();
  m.removeLayer(old);
  focusLayers.delete(m);
}

function drawFocus() {
  const p = focusName ? projects.find(x => x.name === focusName) : null;
  const geom = p && outlineOf(p);
  shownMaps().forEach(m => {
    clearFocusOn(m);
    if (!geom) return;
    if (!m.getPane(FOCUS_PANE)) {
      const pane = m.createPane(FOCUS_PANE);
      pane.style.zIndex = FOCUS_Z;
      pane.style.pointerEvents = 'none';
    }
    const holes = outerRings(geom).map(r => r.map(([lng, lat]) => [lat, lng]));
    const group = L.featureGroup();
    if (holes.length) group.addLayer(L.polygon([WORLD_RING, ...holes], { ...FOCUS_MASK, pane: FOCUS_PANE }));
    FOCUS_LINES.forEach(s => group.addLayer(L.geoJSON(geom, {
      style: { ...s, fill: false, dashArray: null, lineJoin: 'round' }, interactive: false, pane: FOCUS_PANE
    })));
    group.addTo(m);
    focusLayers.set(m, group);
  });
}

// Đồ án nhỏ nhất chứa điểm (đồ án lồng nhau thì sáng đồ án trong)
function projectAt(m, latlng) {
  let best = null;
  let bestSize = Infinity;
  const pt = [latlng.lng, latlng.lat];
  (labelLists.get(m) || []).forEach(p => {
    const geom = outlineOf(p);
    const b = geom && geomBounds(geom);
    if (!b || !b.isValid() || !b.contains(latlng)) return;
    const size = (b.getEast() - b.getWest()) * (b.getNorth() - b.getSouth());
    if (size >= bestSize) return;
    try {
      if (turf.booleanPointInPolygon(pt, turf.feature(geom))) { best = p; bestSize = size; }
    } catch (e) { /* ranh lỗi: bỏ qua */ }
  });
  return best ? best.name : null;
}

// Từ ngưỡng lô ranh tổng không bắt chuột (lô nằm trên) → dò điểm theo mousemove, gộp 1 lần / khung hình
function hookHover(m) {
  let raf = 0;
  let last = null;
  m.on('mousemove', (e) => {
    last = e.latlng;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (m.getZoom() >= PARCEL_MIN_ZOOM && last) setHover(m, projectAt(m, last));
    });
  });
  m.getContainer().addEventListener('mouseleave', () => setHover(m, null));
}

// Đang chọn phường: ranh đồ án vắt sang phường bên cạnh chỉ vẽ phần trong phường (cắt 1 lần, nhớ theo hình ranh)
const wardClipMemo = new WeakMap();
function outlineInWard(geom, wardName) {
  let byWard = wardClipMemo.get(geom);
  if (!byWard) { byWard = new Map(); wardClipMemo.set(geom, byWard); }
  if (byWard.has(wardName)) return byWard.get(wardName);
  const ward = state.wardLabelsList.find(w => w.name === wardName);
  let out = geom;
  try {
    const hit = ward && ward.geometry && turf.intersect(turf.feature(geom), turf.feature(ward.geometry));
    if (hit) out = hit.geometry;
  } catch (e) { /* ranh lỗi hoặc ranh phường dạng GeometryCollection: giữ nguyên */ }
  byWard.set(wardName, out);
  return out;
}

function shownOutline(p) {
  const full = outlineOf(p);
  const ward = full && wardScopeName();
  return ward && p.name !== state.focusedProject ? outlineInWard(full, ward) : full;
}

function drawOutlinesOn(m, list, below) {
  const old = outlineGroups.get(m);
  if (old) {
    old.clearLayers();
    m.removeLayer(old);
    outlineGroups.delete(m);
  }
  clearGlow(m);
  hovered.delete(m);
  if (!zoomHooked.has(m)) {
    zoomHooked.add(m);
    m.on('zoomend', () => layoutLabels(m));
    hookHover(m);
  }
  labelLists.set(m, list);
  layoutLabels(m);
  if (!list.length) return;
  const group = L.featureGroup();
  const shapes = [];
  const focused = below && (!!focusedProjectName() || !!wardScopeName());
  // Đồ án lớn vẽ trước (nằm dưới): đồ án nhỏ lồng trong QHPK phường nằm trên nên rê / bấm được
  list.slice().sort((a, b) => byProjectAreaDesc(a.name, b.name)).forEach(p => {
    const geom = shownOutline(p);
    if (!geom) return;
    const base = !p.area ? OUTLINE_HULL : p.source === 'gis' ? OUTLINE_GIS : OUTLINE_STYLE;
    const style = { ...base, color: p.color, fillColor: p.color };
    if (!below) {
      const shape = L.geoJSON(geom, { style, interactive: false });
      shapes.push(shape);
      group.addLayer(shape);
      return;
    }
    const shape = L.geoJSON(geom, { style, bubblingMouseEvents: false });
    if (focused) shapes.push(shape);
    shape.bindTooltip(escapeHtml(p.name), { sticky: true, direction: 'top', className: 'dot-tip' });
    shape.on('mouseover', () => setHover(m, p.name));
    shape.on('mouseout', () => setHover(m, null));
    shape.on('click', (e) => {
      if (passToolClick(m, e)) return;
      openProject(p);
      revealInList(p);
    });
    group.addLayer(shape);
  });
  group.addTo(m);
  // Có lô đang vẽ (từ ngưỡng, hoặc đồ án đang chọn): nền mờ nằm dưới lô để không phủ màu lên ký hiệu TT16 và không chặn
  // click vào lô; đưa xuống từ nhỏ tới lớn để giữ thứ tự lớn dưới
  shapes.reverse().forEach(s => s.bringToBack());
  outlineGroups.set(m, group);
  updateGlow(m);
}

function redrawOutlines() {
  const below = !!map && map.getZoom() < PARCEL_MIN_ZOOM;
  const ward = wardScopeName();
  const list = state.showProjects
    ? projects.filter(p => !state.hiddenProjects.has(p.name) && !isLayerHidden(p.name, 'ranh-gioi') && (below || p.area)
      && (!ward || p.wards.includes(ward) || p.name === state.focusedProject))
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

// ============================ ĐỔI TÊN ĐỒ ÁN ============================

async function renameProject(p) {
  if (!isAdmin() || busy) return;
  if (p.legacy) { alert('Đồ án còn ở file cũ (cad_parcels.json): bấm «Chuyển đồ án cũ lên bucket» trước khi đổi tên.'); return; }
  const typed = prompt(`Đổi tên đồ án «${p.name}» thành:\n(Không bắt đầu bằng HT- / QH-, tối đa 120 ký tự)`, p.name);
  if (typed === null) return;
  const newName = typed.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!newName || newName === p.name) return;
  if (/^(HT|QH)[-_\s]/i.test(newName)) { alert('Tên đồ án không bắt đầu bằng HT- / QH- (tiền tố này dành cho tên file).'); return; }
  if (projects.some(x => x !== p && x.name === newName)) { alert(`Đã có đồ án «${newName}», chọn tên khác.`); return; }
  busy = p.name;
  renderList();
  try {
    markDataWritten();
    const res = await fetch(geeApi('action=renameProject'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
      body: JSON.stringify({ project: p.name, newName })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) signOutAdmin();
    if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
    if (state.hiddenProjects.delete(p.name)) state.hiddenProjects.add(newName);
    saveHidden();
    const prefix = `${p.name}|`;
    [...state.hiddenProjectLayers].filter(k => k.startsWith(prefix)).forEach(k => {
      state.hiddenProjectLayers.delete(k);
      state.hiddenProjectLayers.add(`${newName}|${k.slice(prefix.length)}`);
    });
    saveHiddenLayers();
    expanded.delete(p.name);
    busy = null;
    showToast(`Đã đổi tên «${p.name}» → «${newName}» (${data.infra} công trình, ${data.lands} lô tab DXF cũ trên Sheet).`, 'success');
    if (onDeleted) await onDeleted();
  } catch (err) {
    alert(`Không đổi được tên đồ án: ${err.message}\nBấm đổi tên lại với cùng tên mới để ghi tiếp phần còn lại.`);
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
    const group = e.target.closest('[data-group-toggle]');
    if (group) {
      const ward = group.dataset.groupToggle;
      if (ward === currentWard) return;
      if (openGroups.has(ward)) openGroups.delete(ward); else openGroups.add(ward);
      renderList();
      return;
    }
    // Chặn label bật/tắt checkbox: bấm tên là mở đồ án
    const focus = e.target.closest('[data-focus]');
    if (focus) {
      e.preventDefault();
      const p = projects[Number(focus.dataset.focus)];
      if (p) openProject(p);
      return;
    }
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
    const info = e.target.closest('[data-info]');
    if (info) { const p = projects[Number(info.dataset.info)]; if (p) openProject(p); return; }
    const ren = e.target.closest('[data-rename]');
    if (ren) { const p = projects[Number(ren.dataset.rename)]; if (p) renameProject(p); return; }
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
