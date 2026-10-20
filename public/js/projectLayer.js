// Mục Quy hoạch (tab Lớp dữ liệu): 4 nhóm cấp theo droplist (QHC 1/25.000, QHC 1/10.000, QHPK 1/2.000,
// QHCT 1/500) gồm dòng lớp riêng của cấp (#planStaticRows) và đồ án nhập; QHPK, QHCT nhóm đồ án theo phường
// (đồ án liên phường có mặt ở mỗi phường), QHC liệt kê thẳng; mỗi đồ án (Ten_QH)
// bật/tắt riêng, tìm, bấm tên / nút bảng / ranh trên bản đồ để mở đồ án (phóng tới + bảng góc trái + thông tin ở panel dưới),
// Admin xóa / chuyển đồ án cũ.
// Nút file mở PDF quyết định phê duyệt. Admin gắn, thay hoặc gỡ (PDF tối đa 10 MB hoặc link).
// Mở đồ án: hồ sơ văn bản thêm được nhiều PDF (phê duyệt thêm, đính chính, quy định quản lý).
// Nút lưu: người dùng gửi PDF tối đa 2 MB để admin duyệt; đang chờ thì nút đồng hồ, admin bấm để đồng ý hoặc từ chối.
// Mũi tên cuối tên đồ án mở các lớp chính (PROJECT_LAYERS) và bản vẽ hạ tầng (giao thông, cấp nước, thoát nước, cấp điện).
// Bản vẽ lưu riêng từng đồ án, bật/tắt để xem cùng lớp sử dụng đất. Admin xóa từng lớp, tìm lô trong đồ án.
// Đồ án có hồ sơ điều chỉnh cục bộ đã duyệt thêm lớp phụ «Điều chỉnh cục bộ» (adjustLayer.js): bật/tắt, danh sách hồ sơ bấm để phóng tới.
// Mỗi đồ án 1 màu viền + nền mờ, nhãn tên ở giữa ranh. QHPK toàn TP (droplist, chưa chọn phường): ranh mọi đồ án QHPK,
// bấm được ở mọi zoom; lô chỉ đồ án vừa bấm hoặc đang tick trong panel. Chọn phường: ranh các đồ án của phường,
// lô cả phường ở mọi zoom — ranh tổng xuống dưới để bấm được lô.
// Ranh + nhãn của cấp đang chọn ở droplist lấy từ schemeVisibility.enabledSchemes (không phụ thuộc ô lớp
// trung tâm vừa bật kịp hay chưa). QHC 1/10.000 hiện mọi đồ án QHC đang bật, kể cả ngoài vùng trung tâm.
// Lô chỉ đồ án đang chọn. Nút mắt cuối tiêu đề nhóm cấp bật / tắt cả nhóm.
import { state } from './state.js';
import {
  map, PARCEL_MIN_ZOOM, refreshProjectLots, focusProjectLots, loadCadParcels, setProjectInfraVisible, showProjectLot, landCode
} from './mapEngine.js';
import { planMap, getViewMode, onCompareChange, passToolClick } from './planMap.js';
import {
  projectLayersOf, removeCachedLayer, layerKey, isLayerHidden, cachedLots, PROJECT_INFO_EVENT, byProjectAreaDesc, focusedProjectName,
  wardScopeName, projectShown, kindOn, kindChkOf, qhpkBoundaryOnly, ensureProjectNet, noteNetSaved, netFeaturesFromText, loadCatalog
} from './projectFiles.js';
import { landPatternKey, landLabel, TT16_STYLES } from './tt16Symbols.js';
import { PLAN_LEVELS, planLevelOf, OPEN_PROJECT_EVENT } from './generalPlan.js';
import { isCoreWard } from './qhc2045.js';
import { refreshQhct } from './qhctLayer.js';
import { getLevel, setLevel, levelScope, LEVEL_EVENT } from './mapLevel.js';
import { isLevelPair, sideOf, onSplitPair } from './splitPair.js';
import { geeApi, markDataWritten } from './api.js';
import { signOutAdmin } from './uiComponents.js';
import { PROJECT_VIEW_EXIT_EVENT } from './projectReview.js';
import { escapeHtml, fmtNum, ico, showToast, RIGHT_TAB_EVENT } from './utils.js';
import { openOrAssign, openAssign, openDecision, openPropose, openProposalReview } from './decisionViewer.js';
import { adjustmentsOf, refreshAdjustLayer, ADJUST_LAYER_KEY, ADJUST_CHANGE_EVENT } from './adjustLayer.js';
import { namesOfProject } from './projectNames.js';
import { enabledSchemes } from './schemeVisibility.js';
import { kmlTextFromFile, boundaryPolygonsFromKml } from './kmlLoad.js';

const HIDDEN_KEY = 'qh_hidden_projects';
const HIDDEN_LAYERS_KEY = 'qh_hidden_layers';
const SHOWN_NETS_KEY = 'qh_shown_nets';
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
// Đồ án QHC phạm vi rộng, xem ở mức thu nhỏ: viền liền, đậm
const OUTLINE_QHC = { weight: 2.8, opacity: 1, dashArray: null, fillOpacity: 0.08 };
// Họ màu theo cấp, đọc rõ trên ảnh vệ tinh. Không vàng / hổ phách: trùng nét ranh phường xã (#fde68a) và đô thị loại I (#facc15).
// QHC lạnh, QHPK ấm (cam / hồng), QHCT tím. Đồ án cùng cấp có khung bao giao nhau không trùng màu.
const PALETTES = {
  QHC: ['#38bdf8', '#0ea5e9', '#22d3ee', '#06b6d4', '#2dd4bf', '#14b8a6', '#60a5fa', '#818cf8'],
  QHPK: ['#fb923c', '#f97316', '#ea580c', '#c2410c', '#f43f5e', '#e11d48', '#fb7185', '#be123c'],
  QHCT: ['#c084fc', '#a855f7', '#8b5cf6', '#d946ef', '#e879f9', '#a78bfa', '#f0abfc', '#7c3aed', '#c026d3']
};
const NEIGHBOR_PAD_DEG = 0.003;

const CITY_NAME = 'Thành phố Huế';
const NO_WARD = 'Chưa xác định phường, xã';

const $ = (id) => document.getElementById(id);
const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;

let projects = [];
// Nhóm phường đang mở trong danh sách; currentWard = phường đang chọn (nhóm đánh dấu, luôn mở). Nhóm cấp mặc định mở
const openGroups = new Set();
const closedLevels = new Set();
let currentWard = null;
let onDeleted = null;
let busy = null;
let belowZoom = null;
let query = '';
const outlineGroups = new Map();
// Danh mục tới sau khi đã chọn QHC 1/10.000: phóng một lần tới các đồ án còn ngoài khung
let qhcFrameWait = false;
const fallbackCache = new Map();
// Danh sách lớp đang mở: Ten_QH → { loading, error, list: projectLayersOf() }
const expanded = new Set();
const layerInfo = new Map();
let layerBusy = null;
const adjOpen = new Set();

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

// Bản cũ bật lớp Quy hoạch thì tự ẩn mọi đồ án chưa hiện, kể cả QHC / QHCT (nay theo ô lớp cấp đó): bỏ một lần
const HIDDEN_KIND_FIX_KEY = 'qh_hidden_kind_fix';

function loadHidden() {
  try {
    let saved = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]');
    if (Array.isArray(saved) && !localStorage.getItem(HIDDEN_KIND_FIX_KEY)) {
      saved = saved.filter(n => planLevelOf(n) === 'QHPK');
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(saved));
      localStorage.setItem(HIDDEN_KIND_FIX_KEY, '1');
    }
    if (Array.isArray(saved)) state.hiddenProjects = new Set(saved.map(String));
    const layers = JSON.parse(localStorage.getItem(HIDDEN_LAYERS_KEY) || '[]');
    if (Array.isArray(layers)) state.hiddenProjectLayers = new Set(layers.map(String));
    const nets = JSON.parse(localStorage.getItem(SHOWN_NETS_KEY) || '[]');
    if (Array.isArray(nets)) state.shownProjectNets = new Set(nets.map(String));
  } catch (e) { /* chế độ riêng tư */ }
}

function saveHidden() {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...state.hiddenProjects])); } catch (e) { /* chế độ riêng tư */ }
}

function saveHiddenLayers() {
  try { localStorage.setItem(HIDDEN_LAYERS_KEY, JSON.stringify([...state.hiddenProjectLayers])); } catch (e) { /* chế độ riêng tư */ }
}

function saveShownNets() {
  try { localStorage.setItem(SHOWN_NETS_KEY, JSON.stringify([...state.shownProjectNets])); } catch (e) { /* chế độ riêng tư */ }
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
  return assignColors(state.projectCatalog.map(p => {
    const names = namesOfProject(p);
    return {
    name: names.tenQH,
    short: names.tenRutGon,
    full: names.tenDayDu,
    level: planLevelOf(p.tenQH),
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
    } : null,
    proposal: p.proposal && p.proposal.at ? {
      name: p.proposal.name || 'Quyết định phê duyệt',
      bytes: Number(p.proposal.bytes) || 0,
      at: Number(p.proposal.at) || 0
    } : null,
    docs: Array.isArray(p.docs) ? p.docs.filter(d => d && d.id && d.at).map(d => ({
      id: String(d.id),
      role: d.role,
      slug: d.slug || p.slug || '',
      kind: d.kind === 'link' ? 'link' : 'pdf',
      url: d.kind === 'link' ? String(d.url || '') : '',
      name: d.name || 'Văn bản',
      bytes: Number(d.bytes) || 0,
      at: Number(d.at) || 0,
      embed: d.kind === 'link' ? d.embed === true : true
    })) : []
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'vi')));
}

// Tô màu tham lam theo thứ tự danh sách, trong cùng một cấp: lấy màu đầu bảng chưa có ở đồ án kề; kề hết màu thì lấy màu ít dùng nhất quanh nó
function assignColors(list) {
  const boxes = list.map(p => {
    const geom = outlineOf(p);
    try { return geom ? turf.bbox(turf.feature(geom)) : null; } catch (e) { return null; }
  });
  const near = (a, b) => a && b && a[0] - NEIGHBOR_PAD_DEG <= b[2] && b[0] - NEIGHBOR_PAD_DEG <= a[2]
    && a[1] - NEIGHBOR_PAD_DEG <= b[3] && b[1] - NEIGHBOR_PAD_DEG <= a[3];
  list.forEach((p, i) => {
    const palette = PALETTES[p.level] || PALETTES.QHPK;
    const used = new Map();
    for (let j = 0; j < i; j++) {
      if (list[j].level !== p.level) continue;
      if (near(boxes[i], boxes[j])) used.set(list[j].color, (used.get(list[j].color) || 0) + 1);
    }
    p.color = palette.find(c => !used.has(c))
      || palette.reduce((best, c) => (used.get(c) < used.get(best) ? c : best), palette[i % palette.length]);
  });
  return list;
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

// Bật lớp Quy hoạch đang tắt mà chỉ thêm đồ án cần hiện: đồ án QHPK chưa hiện bị ẩn trước
function enableMaster() {
  projects.forEach(p => { if (p.level === 'QHPK' && !projectShown(p.name)) state.hiddenProjects.add(p.name); });
  setMaster(true);
}

// Cấp của đồ án đang tắt: QHC / QHCT bật ô lớp cấp đó (so sánh, lớp droplist giữ nguyên), QHPK gọi master
function turnKindOn(p, master) {
  const chk = $(kindChkOf(p.name));
  if (!chk) { master(); return; }
  chk.checked = true;
  chk.dispatchEvent(new Event('change', { bubbles: true }));
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
  if (!kindOn(p.name)) { turnKindOn(p, () => setMaster(true)); changed = true; }
  if (!state.showProjectInfra) { ensureFullLots(); changed = true; }
  if (state.hiddenProjects.delete(p.name)) { saveHidden(); changed = true; }
  if (p.level === 'QHPK' && !state.lotProjects.has(p.name)) { state.lotProjects.add(p.name); changed = true; }
  const view = planMap?.getContainer()?.offsetParent ? planMap : map;
  view.fitBounds(b.pad(0.1), { maxZoom: 18 });
  if (changed) refreshAll();
  focusProjectLots(p.name);
}

// Mở đồ án (tên, nút bảng hoặc ranh trên bản đồ): phóng tới, làm sáng ranh, bảng góc trái và thông tin ở panel dưới (projectReview)
function openProject(p) {
  // Bấm ranh là chọn đồ án, không còn là trạng thái tạm của bảng tra cứu
  inspectSnap = null;
  viewStash = null;
  focusExtra = null;
  levelPeers = [];
  inspectHostM2 = 0;
  zoomTo(p);
  focusName = p.name;
  drawFocus();
  pinGlow(p);
  markPicked(p.name);
  document.dispatchEvent(new CustomEvent(PROJECT_INFO_EVENT, { detail: p.name }));
}

// Link chia sẻ: mở đúng đồ án (bỏ ẩn, hiện lô, viền đậm, panel dưới) nhưng giữ nguyên khung nhìn URL
export function shareOpenProject(name) {
  const wanted = String(name || '').trim();
  if (!wanted) return false;
  focusExtra = null;
  if (!holdPeers) {
    levelPeers = [];
    inspectHostM2 = 0;
  }
  const p = projects.find(x => x.name === wanted);
  state.focusedProject = wanted;
  if (state.hiddenProjects.delete(wanted)) saveHidden();
  if (!p || p.level === 'QHPK') state.lotProjects.add(wanted);
  if (!p) return false;
  if (!kindOn(p.name)) turnKindOn(p, () => setMaster(true));
  if (!state.showProjectInfra) ensureFullLots();
  focusName = p.name;
  refreshAll();
  drawFocus();
  pinGlow(p);
  markPicked(p.name);
  focusProjectLots(p.name);
  revealInList(p);
  document.dispatchEvent(new CustomEvent(PROJECT_INFO_EVENT, { detail: p.name }));
  return true;
}

function outlineSize(p) {
  const b = boundsOf(p);
  if (!b || !b.isValid()) return Infinity;
  return (b.getEast() - b.getWest()) * (b.getNorth() - b.getSouth());
}

function geomsMeet(a, b) {
  try {
    const fa = turf.feature(a);
    const fb = turf.feature(b);
    if (typeof turf.booleanIntersects === 'function') return turf.booleanIntersects(fa, fb);
    return !!turf.intersect(fa, fb);
  } catch (e) { return false; }
}

/** Đồ án cấp kind có ranh giao hình đang tra cứu */
function projectsCovering(kind, geom) {
  if (!geom || typeof turf === 'undefined') return [];
  let box = null;
  try { box = turf.bbox(turf.feature(geom)); } catch (e) { box = null; }
  const hits = [];
  projects.forEach(p => {
    if (p.level !== kind) return;
    const outline = outlineOf(p);
    const b = outline && boundsOf(p);
    if (!b || !b.isValid()) return;
    if (box && (b.getEast() < box[0] || b.getWest() > box[2] || b.getNorth() < box[1] || b.getSouth() > box[3])) return;
    if (geomsMeet(geom, outline)) hits.push(p);
  });
  return hits;
}

// Hợp ranh ngoài của các đồ án giao vùng tra cứu. Union lỗi thì bỏ phủ tối (hai lỗ chồng nhau bị evenodd tô lại).
function unionPair(a, b) {
  const once = (x, y) => {
    const u = turf.union(x, y);
    return u ? flattenPoly(u.geometry || u) : null;
  };
  const fa = turf.feature(a);
  const fb = turf.feature(b);
  try {
    const u = once(fa, fb);
    if (u) return u;
  } catch (e) { /* làm tròn rồi thử lại */ }
  for (const precision of UNION_PRECISIONS) {
    try {
      const u = once(turf.truncate(fa, { precision }), turf.truncate(fb, { precision }));
      if (u) return u;
    } catch (e) { /* giảm độ chính xác */ }
  }
  return null;
}

function flattenPoly(g) {
  if (!g) return null;
  if (g.type === 'Feature') return flattenPoly(g.geometry);
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') return exteriorOnly(g);
  const parts = g.type === 'FeatureCollection' ? (g.features || []).map(f => f.geometry)
    : g.type === 'GeometryCollection' ? (g.geometries || []) : null;
  if (!parts) return null;
  let acc = null;
  for (const part of parts) {
    const flat = flattenPoly(part);
    if (!flat) continue;
    if (!acc) { acc = flat; continue; }
    acc = unionPair(acc, flat);
    if (!acc) return null;
  }
  return acc;
}

function focusCover(hits) {
  const parts = [];
  hits.forEach(p => {
    const g = exteriorOnly(outlineOf(p));
    if (g) parts.push(g);
  });
  if (!parts.length) return { skipMask: true, lines: [] };
  let acc = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const next = unionPair(acc, parts[i]);
    if (!next) return { skipMask: true, lines: parts };
    acc = next;
  }
  return { skipMask: false, geom: acc, lines: [acc] };
}

function overlapM2(outline, geom) {
  if (!outline || !geom || typeof turf === 'undefined') return 0;
  try {
    const hit = turf.intersect(turf.feature(outline), turf.feature(geom));
    return hit ? turf.area(hit) : 0;
  } catch (e) { return 0; }
}

// Cùng cấp: diện giao với vùng tra cứu lớn hơn đứng trước; hòa thì ranh rộng hơn
function byOverlap(list, geom) {
  return list.map(p => ({ p, m2: overlapM2(outlineOf(p), geom), size: outlineSize(p) }))
    .sort((a, b) => (b.m2 - a.m2) || (b.size - a.size))
    .map(row => row.p);
}

function geomArea(geom) {
  if (!geom || typeof turf === 'undefined') return 0;
  try { return turf.area(turf.feature(geom)); } catch (e) { return 0; }
}

function rememberPeers(list, geom) {
  levelPeers = list.map(p => ({
    name: p.name,
    short: p.short || p.name,
    level: p.level,
    overlapM2: geom ? overlapM2(outlineOf(p), geom) : 0,
    decision: p.decision?.name || ''
  }));
}

/** Đồ án đúng cấp đang tra cứu, xếp theo diện giao giảm dần. */
export function inspectPeers() {
  return levelPeers.map(p => ({ ...p }));
}

/** Diện tích hình đang tra cứu (dự án, thửa, vùng đo), để tính phần nằm trong từng đồ án. */
export function inspectHostArea() {
  return inspectHostM2;
}

/** Mở quyết định phê duyệt của một đồ án trong thẻ tra cứu. */
export function openInspectDecision(name) {
  const p = projects.find(x => x.name === name);
  if (!p?.decision) return;
  openOrAssign(decisionTarget(p));
}

function openMany(hits, kind, geom) {
  const same = byOverlap(hits.filter(p => p.level === kind), geom);
  const primary = same[0];
  if (!primary) {
    rememberPeers([], null);
    focusExtra = null;
    let hiddenChanged = false;
    hits.forEach(p => {
      if (state.hiddenProjects.delete(p.name)) hiddenChanged = true;
      state.lotProjects.add(p.name);
    });
    if (hiddenChanged) saveHidden();
    const focused = projects.find(x => x.name === state.focusedProject);
    if (!focused || focused.level !== kind) {
      state.focusedProject = null;
      focusName = null;
      markPicked(null);
      document.dispatchEvent(new Event(PROJECT_UNFOCUS_EVENT));
    }
    refreshAll();
    drawFocus();
    return null;
  }
  // Lỗ phủ tối theo cấp đang chọn. Lô vẫn lấy mọi đồ án giao vùng (kể cả cấp kia) để không cụt lô.
  focusExtra = focusCover(same);
  if (focusExtra) focusExtra.names = same.map(p => p.name);
  const prevPeers = levelPeers.map(p => p.name).join('\0');
  rememberPeers(same, geom);
  const peersChanged = prevPeers !== levelPeers.map(p => p.name).join('\0');
  const ready = state.focusedProject === primary.name && focusName === primary.name
    && hits.every(p => state.lotProjects.has(p.name) && kindOn(p.name));
  if (ready) {
    drawFocus();
    if (peersChanged) document.dispatchEvent(new CustomEvent(PROJECT_INFO_EVENT, { detail: primary.name }));
    return primary.name;
  }
  state.lotProjects.clear();
  let hiddenChanged = false;
  hits.forEach(p => {
    if (state.hiddenProjects.delete(p.name)) hiddenChanged = true;
    state.lotProjects.add(p.name);
  });
  if (hiddenChanged) saveHidden();
  hits.forEach(p => { if (!kindOn(p.name)) turnKindOn(p, () => setMaster(true)); });
  if (!state.showProjectInfra) ensureFullLots();
  state.focusedProject = primary.name;
  focusName = primary.name;
  refreshAll();
  drawFocus();
  pinGlow(primary);
  markPicked(primary.name);
  focusProjectLots(primary.name);
  revealInList(primary);
  document.dispatchEvent(new CustomEvent(PROJECT_INFO_EVENT, { detail: primary.name }));
  return primary.name;
}

/**
 * Đồ án nhỏ nhất cấp kind (QHPK / QHCT / QHC) chứa điểm: bật lô và viền, giữ nguyên khung nhìn.
 * Không có đồ án tại điểm → null.
 */
export function openProjectAt(latlng, kind) {
  if (!latlng || !kind || typeof turf === 'undefined') return null;
  const pt = [latlng.lng, latlng.lat];
  let best = null;
  let bestSize = Infinity;
  projects.forEach(p => {
    if (p.level !== kind) return;
    const geom = outlineOf(p);
    const b = geom && boundsOf(p);
    if (!b || !b.isValid() || !b.contains(latlng)) return;
    const size = (b.getEast() - b.getWest()) * (b.getNorth() - b.getSouth());
    if (size >= bestSize) return;
    try {
      if (turf.booleanPointInPolygon(pt, turf.feature(geom))) { best = p; bestSize = size; }
    } catch (e) { /* ranh lỗi */ }
  });
  if (!best) return null;
  const lotsOn = best.level !== 'QHPK' || state.lotProjects.has(best.name);
  if (state.focusedProject === best.name && focusName === best.name && lotsOn) return best.name;
  shareOpenProject(best.name);
  return best.name;
}

// QHPK giao QHCT (hoặc hai đồ án cùng cấp) đều tính là tra cứu nhiều đồ án
function schemesCovering(kind, geom) {
  const hits = projectsCovering(kind, geom);
  const other = kind === 'QHPK' ? 'QHCT' : kind === 'QHCT' ? 'QHPK' : null;
  if (!other) return hits;
  const seen = new Set(hits.map(p => p.name));
  projectsCovering(other, geom).forEach(p => { if (!seen.has(p.name)) hits.push(p); });
  return hits;
}

/**
 * Tra cứu theo hình: lô của mọi đồ án giao vùng (QHPK và QHCT, hoặc QHC khi đang ở lớp đó).
 * Thẻ liệt kê mọi đồ án đúng cấp đang chọn. Lỗ phủ tối là hợp ranh các đồ án đó.
 */
export function openInspectProjects(latlng, kind, geom) {
  const hostM2 = geomArea(geom);
  const hits = schemesCovering(kind, geom);
  const same = byOverlap(hits.filter(p => p.level === kind), geom);
  if (hits.length >= 2) {
    if (!inspectSnap && viewStash) inspectSnap = viewStash;
    viewStash = null;
    inspectHostM2 = hostM2;
    return openMany(hits, kind, geom);
  }
  viewStash = null;
  const hadExtra = !!focusExtra || levelPeers.length > 0;
  const already = state.focusedProject;
  focusExtra = null;
  inspectHostM2 = hostM2;
  rememberPeers(same, geom);
  holdPeers = true;
  let name = null;
  try {
    name = same.length ? openProjectAt(latlng, kind) : null;
    if (!name && same[0]) {
      shareOpenProject(same[0].name);
      name = same[0].name;
    }
  } finally {
    holdPeers = false;
  }
  if (!name) {
    inspectHostM2 = 0;
    rememberPeers([], null);
    const focused = projects.find(x => x.name === state.focusedProject);
    if (focused && focused.level !== kind) {
      state.focusedProject = null;
      focusName = null;
      markPicked(null);
      document.dispatchEvent(new Event(PROJECT_UNFOCUS_EVENT));
    }
    if (hadExtra) drawFocus();
    return null;
  }
  if (hadExtra) drawFocus();
  if (name === already) document.dispatchEvent(new CustomEvent(PROJECT_INFO_EVENT, { detail: name }));
  return name;
}

/** Điểm latlng nằm trong ranh tổng của đồ án name */
export function projectContains(name, latlng) {
  const p = projects.find(x => x.name === name);
  const geom = p && outlineOf(p);
  if (!geom || !latlng || typeof turf === 'undefined') return false;
  try { return turf.booleanPointInPolygon([latlng.lng, latlng.lat], turf.feature(geom)); } catch (e) { return false; }
}

// Bảng góc trái (projectBrief.js) ẩn theo sự kiện này
export const PROJECT_UNFOCUS_EVENT = 'qh:project-unfocus';

/** Bỏ đồ án đang chọn (về xem theo phường / toàn TP); người gọi tự vẽ lại */
export function clearProjectFocus() {
  state.focusedProject = null;
  focusName = null;
  focusExtra = null;
  levelPeers = [];
  inspectHostM2 = 0;
  drawFocus();
  markPicked(null);
  document.dispatchEvent(new Event(PROJECT_UNFOCUS_EVENT));
}

/**
 * Chọn phường: hiện lại các đồ án của phường đang bị ẩn, bật lớp Quy hoạch, mở và cuộn tới nhóm phường trong danh sách
 * (panel phải giữ nguyên trạng thái ẩn / hiện). Toàn TP: bỏ đánh dấu nhóm.
 * opts.show = false: đang xem lớp quy hoạch khác (mapLevel.js) — chỉ đánh dấu, cuộn danh sách, không bật lớp Quy hoạch.
 */
export function revealWardProjects(wardName, { show = true } = {}) {
  const next = wardName && wardName !== CITY_NAME ? wardName : null;
  if (next !== currentWard) openGroups.clear();
  currentWard = next;
  if (currentWard && show) {
    let changed = false;
    projects.forEach(p => { if (p.wards.includes(currentWard) && state.hiddenProjects.delete(p.name)) changed = true; });
    if (changed) saveHidden();
    if (!state.showProjects) setMaster(true);
    ensureFullLots();
  }
  if (currentWard) {
    openGroups.add(currentWard);
    const active = activeGroup();
    projects.forEach(p => { if (p.wards.includes(currentWard) && (!active || p.level === active)) closedLevels.delete(p.level); });
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
  // Chừa chỗ cho tiêu đề nhóm cấp / nhóm phường đang dính đầu khung phía trên el
  let pad = 4;
  for (let g = el.parentElement; g && g !== box; g = g.parentElement) {
    const head = g.querySelector(':scope > .pl-hrow, :scope > .pg-head');
    if (head && (g.classList.contains('pl-group') || g.classList.contains('pg-group'))) pad += head.offsetHeight;
  }
  const scale = box.getBoundingClientRect().height / (box.offsetHeight || 1) || 1;
  const dy = (el.getBoundingClientRect().top - box.getBoundingClientRect().top) / scale;
  box.scrollTo({ top: Math.max(0, box.scrollTop + dy - pad), behavior: 'smooth' });
}

const foldText = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();

function renderHead() {
  const shownN = projects.filter(p => projectShown(p.name)).length;
  const count = $('planTabCount');
  if (count) count.textContent = `(${shownN}/${projects.length})`;
  const search = $('projectSearch');
  if (search) search.hidden = projects.length <= 5;
}

// Nhóm cấp trong mục Quy hoạch, cùng thứ tự droplist (mapLevel.js); Hệ thống đô thị nằm ở mục Đô thị riêng
const LIST_LEVELS = [
  { key: 'QHC25', label: 'QHC 1/25.000', title: 'quy hoạch chung tỷ lệ 1/25.000' },
  ...['QHC', 'QHPK', 'QHCT'].map(k => PLAN_LEVELS.find(l => l.key === k))
];
const levelLabel = (key) => LIST_LEVELS.find(l => l.key === key)?.label || key;
// Lớp droplist (mapLevel.js) → nhóm cấp trong danh sách; Hệ thống đô thị không ứng nhóm nào
const LEVEL_GROUP = { qhc25: 'QHC25', qhc10: 'QHC', qhpk: 'QHPK', qhct: 'QHCT' };
const activeGroup = () => LEVEL_GROUP[getLevel()] || null;

// Đổi lớp ở droplist: mở nhóm cấp của lớp đó, thu gọn các nhóm còn lại
function focusLevelGroup() {
  const key = activeGroup();
  if (!key) return;
  LIST_LEVELS.forEach(l => { if (l.key === key) closedLevels.delete(l.key); else closedLevels.add(l.key); });
  renderList();
}

// Ô lớp riêng của cấp (#planStaticRows) bật / tắt cùng nút mắt của nhóm
const LEVEL_CHK = { QHC25: 'chk_qhc25', QHC: 'chk_qhc10', QHCT: 'chk_qhct' };
// Lớp giao thông QHC 2045 (qhc2045Layer.js) cùng nhóm cấp: nút mắt bật / tắt kèm
const LEVEL_EXTRA_CHK = { QHC25: 'chk_gt25', QHC: 'chk_gt10' };

// Nút mắt nhóm cấp (sáng = nhóm đang hiện): còn lớp / đồ án nào đang hiện thì bấm tắt hết, đang tắt hết thì bấm bật cả nhóm
function eyeState(key) {
  const list = projects.filter(p => p.level === key);
  const chk = $(LEVEL_CHK[key]);
  const on = list.some(p => projectShown(p.name)) || !!chk?.checked || !!$(LEVEL_EXTRA_CHK[key])?.checked;
  const tip = `${on ? 'Tắt' : 'Bật'} tất cả lớp và đồ án ${levelLabel(key)}`;
  return { on, tip, empty: !list.length && !chk };
}

function eyeHtml(key) {
  const { on, tip, empty } = eyeState(key);
  return `<button type="button" class="layer-eye-btn pl-eye" data-level-eye="${key}" aria-pressed="${on}" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}"${empty ? ' disabled' : ''}>${ico('eye-off', 'eye-hide')}${ico('eye', 'eye-show')}</button>`;
}

// Ô lớp riêng đổi trạng thái (droplist, bấm ô) không dựng lại danh sách: chỉ cập nhật nút mắt
function paintEyes() {
  $('projectList')?.querySelectorAll('[data-level-eye]').forEach(btn => {
    const { on, tip } = eyeState(btn.dataset.levelEye);
    btn.setAttribute('aria-pressed', String(on));
    btn.title = tip;
    btn.setAttribute('aria-label', tip);
  });
}

function setLevelShown(key, on) {
  const list = projects.filter(p => p.level === key);
  if (on) {
    if (key === 'QHPK' && list.length && !state.showProjects) enableMaster();
    list.forEach(p => {
      state.hiddenProjects.delete(p.name);
      if (key === 'QHPK') state.lotProjects.add(p.name);
    });
    if (list.length) ensureFullLots();
  } else {
    list.forEach(p => {
      state.hiddenProjects.add(p.name);
      if (key === 'QHPK') state.lotProjects.delete(p.name);
    });
    if (state.showProjects && projects.every(p => state.hiddenProjects.has(p.name))) setMaster(false);
  }
  saveHidden();
  [LEVEL_CHK[key], LEVEL_EXTRA_CHK[key]].map(id => $(id)).forEach(chk => {
    if (chk && chk.checked !== on) {
      chk.checked = on;
      chk.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  const focus = state.focusedProject;
  if (!on && focus && list.some(p => p.name === focus)) {
    document.dispatchEvent(new CustomEvent(PROJECT_VIEW_EXIT_EVENT, { detail: { hidden: focus } }));
  }
  refreshAll();
}

// Cấp QHC ít đồ án: liệt kê thẳng dưới nhóm cấp, không gom theo phường, xã
const FLAT_LEVELS = new Set(['QHC25', 'QHC']);

const staticOf = (key) => document.querySelector(`[data-plan-static="${key}"]`);

// Dựng lại danh sách (innerHTML) sẽ hủy các ô lớp tĩnh đang gắn bên trong: trả về khung chứa trước, gắn lại sau.
// Ô lớp phải luôn nằm trong document (các module tra theo id)
function parkStatic() {
  $('planStaticRows')?.append(...document.querySelectorAll('[data-plan-static]'));
}

function mountStatic(box) {
  box.querySelectorAll('[data-static-slot]').forEach(slot => {
    const el = staticOf(slot.dataset.staticSlot);
    if (el) slot.replaceWith(el);
  });
}

function renderList() {
  renderHead();
  const box = $('projectList');
  if (!box) return;
  parkStatic();
  const q = foldText(query.trim());
  const visible = projects.map((p, idx) => ({ p, idx })).filter(({ p }) => !q || foldText(`${p.name} ${p.short} ${p.full}`).includes(q));
  const admin = isAdmin();
  const legacyN = projects.filter(p => p.legacy).length;
  const migrating = busy === '__migrate__';
  const migrateBtn = admin && legacyN
    ? `<button type="button" class="project-migrate" data-migrate ${migrating || busy ? ' disabled' : ''}>${migrating ? 'Đang chuyển…' : `Chuyển ${legacyN} đồ án cũ lên bucket`}</button>`
    : '';
  const none = visible.length ? '' : '<div class="project-empty">Không có đồ án khớp từ khóa.</div>';
  const rows = (items) => items.map(({ p, idx }) => rowHtml(p, idx, admin)).join('');
  const wardHtml = ([ward, items]) => {
    const cur = ward === currentWard;
    const open = cur || openGroups.has(ward);
    return `<div class="pg-group${open ? ' open' : ''}${cur ? ' is-current' : ''}" data-ward-group="${escapeHtml(ward)}">
      <button type="button" class="pg-head" data-group-toggle="${escapeHtml(ward)}" aria-expanded="${open}" title="${open ? 'Thu gọn' : 'Xem'} các đồ án của ${escapeHtml(ward)}">
        ${ico('chev-right')}<span>${escapeHtml(ward)}</span><small>${items.length}</small></button>
      ${open ? `<div class="pg-body">${rows(items)}</div>` : ''}
    </div>`;
  };
  // Đang tìm: danh sách phẳng; không tìm: nhóm cấp › (dòng lớp riêng) + nhóm phường (QHC: đồ án), nhóm phường đóng chưa dựng dòng.
  // Thân nhóm có dòng lớp riêng luôn dựng (ẩn khi đóng) để ô lớp không rời document
  if (q) {
    box.innerHTML = migrateBtn + none + rows(visible);
    return;
  }
  // Đang xem QHC 1/10.000: nhóm QHPK chỉ giữ đồ án và nhóm phường trong vùng lõi
  const coreOnly = getLevel() === 'qhc10';
  box.innerHTML = migrateBtn + LIST_LEVELS.map(level => {
    const scoped = coreOnly && level.key === 'QHPK';
    const all = visible.filter(({ p }) => p.level === level.key);
    const items = scoped ? all.filter(({ p }) => p.wards.some(isCoreWard)) : all;
    const fixed = !!staticOf(level.key);
    if (!fixed && !items.length && level.key !== 'QHPK') return '';
    const open = !closedLevels.has(level.key);
    const empty = level.key === 'QHPK' && !projects.length
      ? '<div class="project-empty">Chưa có đồ án. Admin nhập file ở tab Đề xuất › Nhập hàng loạt.</div>' : '';
    const scopeNote = scoped && all.length
      ? `<div class="project-scope" title="Đồ án có phường, xã thuộc vùng lõi (phạm vi QHC 1/10.000 mở rộng theo QĐ 756). Chọn lớp khác để xem toàn bộ">${ico('coverage')}<span>Trong phạm vi QHC 1/10.000: <b>${items.length}</b>/${all.length} đồ án</span></div>` : '';
    const list = !open ? ''
      : FLAT_LEVELS.has(level.key) ? rows(items)
        : wardGroups(items).filter(([w]) => !scoped || isCoreWard(w)).map(wardHtml).join('');
    const body = (fixed ? `<div data-static-slot="${level.key}"></div>` : '') + empty + scopeNote + list;
    return `<div class="pl-group${open ? ' open' : ''}" data-level-group="${level.key}">
      <div class="pl-hrow">
        <button type="button" class="pl-head" data-level-toggle="${level.key}" aria-expanded="${open}" title="${open ? 'Thu gọn' : 'Xem'} ${level.title}">
          ${ico('chev-right')}<span>${level.label}</span>${items.length ? `<small>${items.length}</small>` : ''}</button>
        ${eyeHtml(level.key)}
      </div>
      <div class="pl-body"${open ? '' : ' hidden'}>${body}</div>
    </div>`;
  }).join('');
  mountStatic(box);
  refreshQhct();
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
  const on = schemeRowOn(p);
  const deleting = busy === p.name;
  const open = expanded.has(p.name);
  const extraN = (p.docs || []).length;
  const decisionTitle = p.decision
    ? `Xem quyết định phê duyệt: ${p.decision.name}${extraN ? ` · ${extraN} văn bản kèm` : ''}`
    : 'Gắn quyết định phê duyệt (PDF tối đa 10 MB hoặc link)';
  const decisionBtn = (p.decision || admin)
    ? `<button type="button" class="project-btn${p.decision ? ' has-decision' : ''}" data-decision="${idx}" title="${escapeHtml(decisionTitle)}" aria-label="${p.decision ? 'Xem quyết định phê duyệt' : 'Gắn quyết định phê duyệt'}"${busy ? ' disabled' : ''}>${ico(p.decision ? 'file' : 'save')}</button>`
    : '';
  const waiting = !!p.proposal;
  const proposeTitle = waiting
    ? (admin ? `Duyệt file quyết định đang chờ: ${p.proposal.name}` : `Đang chờ admin duyệt: ${p.proposal.name}`)
    : 'Gửi PDF quyết định phê duyệt (tối đa 2 MB) để admin duyệt';
  const proposeBtn = (!admin || waiting)
    ? `<button type="button" class="project-btn${waiting ? ' has-proposal' : ''}" data-propose="${idx}" title="${escapeHtml(proposeTitle)}" aria-label="${escapeHtml(proposeTitle)}"${busy ? ' disabled' : ''}>${ico(waiting ? 'clock' : 'save')}</button>`
    : '';
  const boxTitle = 'Hiện ranh, tên và lô của đồ án';
  return `<div class="project-row${on ? '' : ' is-off'}${p.name === pickedName ? ' is-picked' : ''}">
      <label class="project-name" title="${escapeHtml(p.full || p.name)} — bấm để mở đồ án">
        <input type="checkbox" data-project="${idx}"${on ? ' checked' : ''} title="${boxTitle}"><span data-focus="${idx}">${idx + 1}. ${escapeHtml(p.short || p.name)}</span></label>
      <span class="project-tools">
        <button type="button" class="project-btn project-expand${open ? ' open' : ''}" data-expand="${idx}" title="${open ? 'Ẩn' : 'Xem'} các lớp dữ liệu của đồ án" aria-label="Các lớp dữ liệu của đồ án" aria-expanded="${open}">${ico('chev-down')}</button>
        <button type="button" class="project-btn" data-info="${idx}" title="Thông tin đồ án ở panel dưới: cơ cấu sử dụng đất, bảng tổng hợp sử dụng đất và đánh giá chỉ tiêu QCVN 01:2026" aria-label="Thông tin đồ án">${ico('table')}</button>
        ${decisionBtn}
        ${proposeBtn}
        ${admin ? `<button type="button" class="project-btn" data-rename="${idx}" title="Đổi tên đồ án (Sheet + danh mục bucket)" aria-label="Đổi tên đồ án"${busy ? ' disabled' : ''}>${ico('pen')}</button>` : ''}
        ${admin ? `<button type="button" class="project-btn danger" data-del="${idx}" title="Xóa toàn bộ đồ án" aria-label="Xóa đồ án"${busy ? ' disabled' : ''}>${deleting ? '…' : ico('trash')}</button>` : ''}
      </span>
    </div>${open ? decisionNote(p, idx) + docsHtml(p, idx, admin) + proposalNote(p, idx) + layersHtml(p, idx, on, admin) : ''}`;
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
  if (q && !foldText(`${p.name} ${p.short} ${p.full}`).includes(q)) {
    query = '';
    const search = $('projectSearch');
    if (search) search.value = '';
  }
  if (!query.trim() && !(currentWard && p.wards.includes(currentWard))) openGroups.add(p.wards[0] || NO_WARD);
  closedLevels.delete(p.level);
  renderList();
  markPicked(p.name);
  const row = rowOf(p.name);
  if (!row) return;
  scrollWithin(row);
  row.classList.remove('is-flash');
  void row.offsetWidth;
  row.classList.add('is-flash');
}

const DOC_ROLE = {
  'phe-duyet': { short: 'PD', label: 'Quyết định phê duyệt' },
  'dinh-chinh': { short: 'ĐC', label: 'Quyết định đính chính' },
  'quy-dinh': { short: 'QL', label: 'Quy định quản lý' }
};

function decisionNote(p, idx) {
  if (!p.decision) return '';
  return `<button type="button" class="project-decision" data-decision="${idx}" title="Xem quyết định phê duyệt">${ico('file')}<span>${escapeHtml(p.decision.name)}</span></button>`;
}

function docsHtml(p, idx, admin) {
  const rows = (p.docs || []).map((d, i) => {
    const role = DOC_ROLE[d.role] || { short: 'VB', label: 'Văn bản' };
    return `<button type="button" class="project-decision" data-doc="${idx}:${i}" title="${escapeHtml(role.label)}">${ico('file')}<b class="project-phase qh">${role.short}</b><span>${escapeHtml(d.name)}</span></button>`;
  }).join('');
  const add = admin && !p.legacy ? `<div class="project-doc-add">
      <select data-doc-role="${idx}" aria-label="Loại văn bản kèm theo">
        <option value="dinh-chinh">Quyết định đính chính</option>
        <option value="quy-dinh">Quy định quản lý</option>
        <option value="phe-duyet">Quyết định phê duyệt</option>
      </select>
      <button type="button" data-doc-add="${idx}"${busy ? ' disabled' : ''}>Thêm PDF</button>
    </div>` : '';
  if (!rows && !add) return '';
  return `<div class="project-docs">${rows}${add}</div>`;
}

function proposalNote(p, idx) {
  if (!p.proposal) return '';
  const label = `Chờ duyệt: ${p.proposal.name}`;
  return `<button type="button" class="project-decision is-wait" data-propose="${idx}" title="${escapeHtml(label)}">${ico('clock')}<span>${escapeHtml(label)}</span></button>`;
}

// ============================ LỚP DỮ LIỆU TRONG ĐỒ ÁN ============================

// Số trên dòng lớp (ngắn) và chú thích khi rê chuột (đủ)
function layerCount(g) {
  if (g.kind === 'boundary') {
    if (!g.present) return { short: 'chưa có', full: 'Chưa có ranh — đang dùng ranh tạm (bao lồi). Nhập file ranh giới để có ranh đúng.' };
    return g.source === 'gis' ? { short: 'GIS', full: 'Ranh từ file GIS' } : { short: 'tự dựng', full: 'Ranh tự dựng từ các lô' };
  }
  if (g.kind === 'net') {
    if (!g.present) return { short: 'trống', full: 'Chưa có bản vẽ. Admin thêm GeoJSON đường hoặc vùng (kinh độ, vĩ độ). Lớp này bổ trợ sử dụng đất, lưu riêng đồ án.' };
    return { short: fmtNum(g.count), full: `${fmtNum(g.count)} đối tượng — bật để xem cùng lớp sử dụng đất` };
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
  let netNoted = false;
  const rows = info.list.map((g, li) => {
    if (g.kind === 'net' && !g.present && !admin) return '';
    const key = layerKey(p.name, g.key);
    const on = g.kind === 'net' ? state.shownProjectNets.has(key) : !state.hiddenProjectLayers.has(key);
    // Ranh tạm (bao lồi) vẫn bật/tắt được dù chưa có file ranh
    const toggleable = g.present || g.kind === 'boundary';
    const count = layerCount(g);
    const deleting = layerBusy === key;
    const note = g.kind === 'net' && !netNoted
      ? (netNoted = true, '<div class="project-net-note">Bản vẽ hạ tầng theo đồ án — bật để xem cùng lớp sử dụng đất</div>')
      : '';
    const addNet = admin && g.kind === 'net' && !p.legacy
      ? `<button type="button" class="project-btn" data-net-add="${idx}:${li}" title="${g.present ? 'Thay bản vẽ GeoJSON' : 'Thêm bản vẽ GeoJSON (kinh độ, vĩ độ)'}" aria-label="${g.present ? 'Thay bản vẽ' : 'Thêm bản vẽ'}"${layerBusy || busy ? ' disabled' : ''}>${ico('save')}</button>`
      : '';
    const kmlBtn = admin && g.kind === 'boundary' && !p.legacy
      ? `<button type="button" class="project-kml-btn" data-kml-boundary="${idx}" title="Nhập file KML hoặc KMZ (WGS84) làm ranh đồ án. Không ghi lại các lô."${layerBusy || busy ? ' disabled' : ''}>Nhập KML/KMZ</button>`
      : '';
    return `${note}<div class="project-layer${on && projectOn && g.present ? '' : ' is-off'}">
      <label class="project-layer-name" title="${escapeHtml(g.label)} (${g.phase === 'QH' ? 'quy hoạch' : 'hiện trạng'}) — ${escapeHtml(count.full)}">
        <input type="checkbox" data-layer="${idx}:${li}"${on ? ' checked' : ''}${toggleable ? '' : ' disabled'}>
        <i class="project-layer-dot ${g.kind}" style="--dot:${g.kind === 'boundary' ? p.color : g.color}"></i>
        <b class="project-phase ${g.phase === 'QH' ? 'qh' : 'ht'}">${g.phase}</b>
        <span>${escapeHtml(g.label)}</span><small>${escapeHtml(count.short)}</small></label>
      ${addNet}
      ${admin && g.present && !p.legacy ? `<button type="button" class="project-btn danger" data-layer-del="${idx}:${li}" title="Xóa lớp ${escapeHtml(g.label)} khỏi đồ án" aria-label="Xóa lớp"${layerBusy || busy ? ' disabled' : ''}>${deleting ? '…' : ico('trash')}</button>` : ''}
    </div>${kmlBtn}`;
  }).join('') + adjustRowHtml(p, idx, projectOn);
  const lotsN = info.list.filter(g => g.kind === 'lots').reduce((s, g) => s + g.count, 0);
  const search = lotsN ? `<div class="project-lot-search">
      <input type="search" class="project-search" data-lot-search="${idx}" value="${escapeHtml(lotQuery.get(p.name) || '')}"
        placeholder="Tìm trong ${fmtNum(lotsN)} lô: ký hiệu, tên, loại đất…" aria-label="Tìm lô trong đồ án ${escapeHtml(p.name)}">
      <div class="project-lot-results" data-lot-results="${idx}">${lotResultsHtml(p, idx)}</div>
    </div>` : '';
  return `<div class="project-layers">${rows}${search}</div>`;
}

function adjustRowHtml(p, idx, projectOn) {
  const list = adjustmentsOf(p.name);
  if (!list.length) return '';
  const on = !isLayerHidden(p.name, ADJUST_LAYER_KEY);
  const open = adjOpen.has(p.name);
  const docs = open ? `<div class="project-adj-list">${list.map(it => {
    const meta = [it.stamp, `${fmtNum(it.lots || 0)} lô mới`, it.scan ? 'có bản vẽ scan' : '', it.pdf ? 'có QĐ' : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="project-lot-hit" data-adj-act="locate" data-adj-id="${escapeHtml(it.id)}" data-adj-project="${idx}" title="${escapeHtml(it.title || 'Điều chỉnh cục bộ')} — bấm để phóng tới ranh điều chỉnh">
      <span>${escapeHtml(it.title || 'Điều chỉnh cục bộ')}</span><small>${escapeHtml(meta)}</small></button>`;
  }).join('')}</div>` : '';
  return `<div class="project-layer${on && projectOn ? '' : ' is-off'}">
      <label class="project-layer-name" title="Điều chỉnh cục bộ đã duyệt — ${list.length} hồ sơ">
        <input type="checkbox" data-adj-layer="${idx}"${on ? ' checked' : ''}>
        <i class="project-layer-dot adjust"></i>
        <b class="project-phase qh">QH</b>
        <span>Điều chỉnh cục bộ</span><small>${fmtNum(list.length)}</small></label>
      <button type="button" class="project-btn project-expand${open ? ' open' : ''}" data-adj-open="${idx}" title="${open ? 'Ẩn' : 'Xem'} danh sách hồ sơ điều chỉnh" aria-expanded="${open}">${ico('chev-down')}</button>
    </div>${docs}`;
}

function setAdjustOn(p, on) {
  const key = layerKey(p.name, ADJUST_LAYER_KEY);
  if (on) state.hiddenProjectLayers.delete(key);
  else state.hiddenProjectLayers.add(key);
  saveHiddenLayers();
  if (on && !projectShown(p.name)) {
    showProject(p);
    return;
  }
  refreshAll();
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
  if (!projectShown(p.name)) showProject(p);
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
  if (g.kind === 'net') {
    if (on) state.shownProjectNets.add(key);
    else state.shownProjectNets.delete(key);
    saveShownNets();
  } else if (on) state.hiddenProjectLayers.delete(key);
  else state.hiddenProjectLayers.add(key);
  if (g.kind !== 'net') saveHiddenLayers();
  const after = () => {
    if (on && !projectShown(p.name)) { showProject(p); return; }
    refreshAll();
  };
  if (on && g.kind === 'net') {
    ensureProjectNet(p.name, g.key).catch(err => console.warn('Tải bản vẽ:', err)).finally(after);
    return;
  }
  after();
}

function deleteNote(g) {
  if (g.kind === 'net') return '• File bản vẽ của lớp này bị xóa. Các đồ án khác không đổi.\n';
  if (g.kind === 'boundary') {
    return '• File ranh giới và ranh tổng trong danh mục bị xóa; đồ án hiện ranh tạm (bao lồi) đến khi nhập lại file ranh\n';
  }
  const parts = [g.lands ? `${g.lands} lô đất` : '', g.infra ? `${g.infra} ranh lô công trình hạ tầng` : ''].filter(Boolean).join(' và ');
  return `• ${parts} của lớp bị xóa khỏi file đồ án trên bucket\n`
    + '• Điểm công trình hạ tầng trên Sheet giữ nguyên (xóa riêng từng công trình trên popup nếu cần)\n';
}

let netInput = null;
let netPick = null;

let kmlInput = null;
let kmlPick = null;

function geometryFromPolygons(polygons) {
  const features = polygons.map(g => turf.feature(g));
  if (features.length === 1) return features[0].geometry;
  try {
    let acc = features[0];
    for (let i = 1; i < features.length; i++) acc = safeUnion(acc, features[i]);
    return acc.geometry;
  } catch (e) {
    return { type: 'MultiPolygon', coordinates: polygons.map(g => g.coordinates) };
  }
}

function ringTooLong(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return polys.some(poly => (poly || []).some(ring => ring.length > 20000));
}

function pickBoundaryKml(p) {
  if (!isAdmin() || busy || layerBusy || p.legacy) return;
  kmlPick = p;
  if (!kmlInput) {
    kmlInput = document.createElement('input');
    kmlInput.type = 'file';
    kmlInput.accept = '.kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz';
    kmlInput.hidden = true;
    kmlInput.addEventListener('change', () => {
      const file = kmlInput.files && kmlInput.files[0];
      const hit = kmlPick;
      kmlInput.value = '';
      kmlPick = null;
      if (file && hit) uploadBoundaryKml(hit, file);
    });
    document.body.appendChild(kmlInput);
  }
  kmlInput.click();
}

async function uploadBoundaryKml(p, file) {
  if (!isAdmin() || busy || layerBusy || p.legacy) return;
  let polygons;
  try { polygons = boundaryPolygonsFromKml(await kmlTextFromFile(file)); }
  catch (err) { alert(err.message || 'Không đọc được file KML/KMZ.'); return; }
  let fitted = null;
  try { fitted = fitBoundary(geometryFromPolygons(polygons)); }
  catch (e) { fitted = null; }
  if (!fitted || ringTooLong(fitted)) {
    alert('Không rút gọn được ranh vừa 45.000 ký tự. Đơn giản hóa file rồi nhập lại.');
    return;
  }
  if (!confirm(`Cập nhật ranh từ file KML/KMZ cho đồ án «${p.name}»?\n${polygons.length} vùng gộp thành 1 ranh GIS. Không ghi lại các lô.`)) return;
  layerBusy = layerKey(p.name, 'ranh-gioi');
  renderList();
  try {
    markDataWritten();
    const res = await fetch(geeApi('action=importCadBatch'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
      body: JSON.stringify({
        boundaryOnly: true,
        tenQH: p.name,
        fileName: file.name,
        registry: { boundary: fitted, boundarySource: 'gis', wards: [], infra: 0, lands: 0 }
      })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) signOutAdmin();
    if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
    await loadCatalog();
    rebuild();
    showToast(`✓ Đã cập nhật ranh GIS cho đồ án «${p.name}».`, 'success');
  } catch (err) {
    alert(err.message || 'Không lưu được ranh.');
  } finally {
    layerBusy = null;
    renderList();
  }
}

function pickNetFile(p, g) {
  if (!isAdmin() || busy || layerBusy || p.legacy) return;
  netPick = { p, g };
  if (!netInput) {
    netInput = document.createElement('input');
    netInput.type = 'file';
    netInput.accept = '.geojson,.json,application/geo+json,application/json';
    netInput.hidden = true;
    netInput.addEventListener('change', () => {
      const file = netInput.files && netInput.files[0];
      const hit = netPick;
      netInput.value = '';
      netPick = null;
      if (file && hit) uploadNet(hit.p, hit.g, file);
    });
    document.body.appendChild(netInput);
  }
  netInput.click();
}

async function uploadNet(p, g, file) {
  if (!isAdmin() || busy || layerBusy) return;
  let text;
  try { text = await file.text(); }
  catch (e) { alert('Không đọc được file.'); return; }
  let features;
  try { features = netFeaturesFromText(text); }
  catch (e) { alert(e.message || 'File không phải GeoJSON.'); return; }
  if (g.present && !confirm(`Thay bản vẽ «${g.label}» (${g.phase}) của đồ án «${p.name}»?\nFile mới có ${features.length} đối tượng.`)) return;
  const payload = JSON.stringify({ tenQH: p.name, role: g.key, features });
  if (payload.length > 1500000) { alert('Bản vẽ lớn hơn 1,5 MB. Tách bớt đối tượng.'); return; }
  const key = layerKey(p.name, g.key);
  layerBusy = key;
  renderList();
  try {
    markDataWritten();
    const res = await fetch(geeApi('action=putProjectNet'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
      body: payload
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) signOutAdmin();
    if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
    noteNetSaved(p.name, g.key, data.saved, data.count);
    state.shownProjectNets.add(key);
    saveShownNets();
    await ensureProjectNet(p.name, g.key);
    layerBusy = null;
    await loadLayers(p, true);
    refreshAll();
    showToast(`Đã ghi bản vẽ ${g.label} (${g.phase}): ${data.count} đối tượng.`, 'success');
  } catch (err) {
    alert(`Không ghi được bản vẽ: ${err.message}`);
  } finally {
    layerBusy = null;
    renderList();
  }
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
    if (g.kind === 'net') {
      state.shownProjectNets.delete(key);
      saveShownNets();
    }
    layerBusy = null;
    projects = collectProjects();
    await loadLayers(p, true);
    refreshAll();
    const what = g.kind === 'boundary' ? 'ranh giới' : g.kind === 'net' ? `${data.removed} đối tượng` : `${data.removed} lô`;
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

// Nhãn chỉ hiện khi khung ranh trên màn hình đủ chứa thẻ; chồng nhau thì giữ đồ án lớn hơn. Đồ án cùng cấp lớp droplist
// (QHC khi xem QHC 1/10.000) luôn có nhãn, ưu tiên trước. Chạy lại mỗi lần zoom.
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
  const scope = levelScope();
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
      const force = !!scope && p.level === scope;
      if (!force && (bw < w * 0.75 || bh < LABEL_H * 1.5)) return;
      const c = m.latLngToContainerPoint(at);
      cands.push({
        p, at, size: bw * bh, force,
        box: [c.x - w / 2 - LABEL_GAP, c.y - LABEL_H / 2 - LABEL_GAP, c.x + w / 2 + LABEL_GAP, c.y + LABEL_H / 2 + LABEL_GAP]
      });
    });
  } catch (e) { return; }
  cands.sort((a, b) => (b.force - a.force) || (b.size - a.size));
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
// Tra cứu giao nhiều đồ án: lỗ phủ tối là hợp ranh các đồ án đúng cấp đang chọn.
let focusExtra = null;
// Cùng cấp với thẻ, xếp theo diện giao với vùng tra cứu. Thẻ hiện cả danh sách; lỗ phủ tối là hợp ranh.
let levelPeers = [];
let inspectHostM2 = 0;
// Đang mở đồ án từ tra cứu: shareOpenProject không xóa danh sách đồ án cùng cấp vừa ghi.
let holdPeers = false;
// Ảnh trạng thái trước lần tra cứu nhiều đồ án đầu tiên; đóng bảng thì trả lại. Một đồ án không ghi.
let inspectSnap = null;
let viewStash = null;
// Bảng dự án kêu gọi đầu tư đang mở: bỏ viền đồ án (hay thành khung chữ nhật) để còn thấy lô bên trong.
let quietOutline = false;

const INSPECT_BOXES = ['chk_urban', 'chk_qhc25', 'chk_qhc10', 'chk_projects', 'chk_qhct', 'chk_projectInfra'];

function takeInspectSnap() {
  const boxes = {};
  INSPECT_BOXES.forEach(id => { boxes[id] = !!$(id)?.checked; });
  return {
    focused: state.focusedProject,
    name: focusName,
    lots: [...state.lotProjects],
    hidden: [...state.hiddenProjects],
    level: getLevel(),
    boxes
  };
}

/** Gọi trước setLevel: giữ ảnh màn hình, chỉ chốt khi vùng tra cứu giao từ 2 đồ án. */
export function stashInspectView() {
  if (inspectSnap) return;
  viewStash = takeInspectSnap();
}

function applyInspectBoxes(boxes) {
  Object.entries(boxes || {}).forEach(([id, on]) => {
    const el = $(id);
    if (!el || el.checked === on) return;
    el.checked = on;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** Đóng bảng thửa / vùng đo / dự án: trả lớp, lô và phủ tối về trước lần tra cứu nhiều đồ án. */
export function restoreInspectFocus() {
  viewStash = null;
  const snap = inspectSnap;
  if (!snap) return;
  inspectSnap = null;
  focusExtra = null;
  levelPeers = [];
  inspectHostM2 = 0;
  if (getLevel() !== snap.level) setLevel(snap.level, { keepView: true });
  state.focusedProject = snap.focused || null;
  focusName = snap.name || null;
  state.lotProjects.clear();
  snap.lots.forEach(n => state.lotProjects.add(n));
  const want = new Set(snap.hidden);
  let hiddenChanged = state.hiddenProjects.size !== want.size;
  if (!hiddenChanged) {
    for (const n of state.hiddenProjects) {
      if (!want.has(n)) { hiddenChanged = true; break; }
    }
  }
  state.hiddenProjects.clear();
  snap.hidden.forEach(n => state.hiddenProjects.add(n));
  if (hiddenChanged) saveHidden();
  applyInspectBoxes(snap.boxes);
  refreshAll();
  drawFocus();
  markPicked(snap.focused || null);
  if (snap.focused) document.dispatchEvent(new CustomEvent(PROJECT_INFO_EVENT, { detail: snap.focused }));
  else document.dispatchEvent(new Event(PROJECT_UNFOCUS_EVENT));
}

const outerRings = (geom) => (geom.type === 'Polygon' ? [geom.coordinates[0]]
  : geom.type === 'MultiPolygon' ? geom.coordinates.map(c => c[0]) : []);

function clearFocusOn(m) {
  const old = focusLayers.get(m);
  if (!old) return;
  old.clearLayers();
  m.removeLayer(old);
  focusLayers.delete(m);
}

export function setQuietProjectOutline(on) {
  on = !!on;
  if (quietOutline === on) return;
  quietOutline = on;
  redrawOutlines();
  drawFocus();
}

function drawFocus() {
  const extra = !quietOutline ? focusExtra : null;
  const p = !extra && !quietOutline && focusName ? projects.find(x => x.name === focusName) : null;
  const geom = extra ? (extra.skipMask ? null : extra.geom) : (p && outlineOf(p));
  const lines = extra ? extra.lines : (geom ? [geom] : []);
  shownMaps().forEach(m => {
    clearFocusOn(m);
    if (!geom && !lines.length) return;
    if (!m.getPane(FOCUS_PANE)) {
      const pane = m.createPane(FOCUS_PANE);
      pane.style.zIndex = FOCUS_Z;
      pane.style.pointerEvents = 'none';
    }
    const group = L.featureGroup();
    if (geom) {
      const holes = outerRings(geom).map(r => r.map(([lng, lat]) => [lat, lng]));
      if (holes.length) group.addLayer(L.polygon([WORLD_RING, ...holes], { ...FOCUS_MASK, pane: FOCUS_PANE }));
    }
    lines.forEach(g => {
      FOCUS_LINES.forEach(s => group.addLayer(L.geoJSON(g, {
        style: { ...s, fill: false, dashArray: null, lineJoin: 'round' }, interactive: false, pane: FOCUS_PANE
      })));
    });
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
  // QHC 1/10.000: giữ nguyên ranh, không cắt theo phường đang chọn
  if (full && p.level === 'QHC' && !isLevelPair() && getLevel() === 'qhc10') return full;
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
  const focused = below && (!!focusedProjectName() || !!wardScopeName() || state.lotProjects.size > 0);
  // Đồ án đã hiện lô: ranh chỉ còn viền, không tô và không bắt chuột.
  // QHPK toàn TP: đồ án vừa bấm hoặc đang tick. QHC / QHCT: đồ án đang mở (lớp QHPK tắt nên nhánh «dưới ngưỡng» luôn bật).
  const lotsOpen = (p) => {
    if (qhpkBoundaryOnly() && p.level === 'QHPK') return p.name === state.focusedProject || state.lotProjects.has(p.name);
    if (p.level === 'QHCT' && state.lotProjects.has(p.name)) return true;
    return (p.level === 'QHCT' || p.level === 'QHC') && p.name === state.focusedProject;
  };
  // Đồ án lớn vẽ trước (nằm dưới): đồ án nhỏ lồng trong QHPK phường nằm trên nên rê / bấm được
  list.slice().sort((a, b) => byProjectAreaDesc(a.name, b.name)).forEach(p => {
    const geom = shownOutline(p);
    if (!geom) return;
    const base = !p.area ? OUTLINE_HULL : p.source === 'gis' ? OUTLINE_GIS : OUTLINE_STYLE;
    const style = { ...base, ...(p.level === 'QHC' ? OUTLINE_QHC : null), color: p.color, fillColor: p.color };
    const open = lotsOpen(p);
    const shown = open ? { ...style, fillOpacity: 0, ...(quietOutline ? { opacity: 0 } : {}) } : style;
    // Đồ án đang mở theo phạm vi lớp droplist, hoặc đã bật lô QHPK: bấm trong ranh không mở lại đồ án
    if (open || !below || (!state.showProjects && p.name === state.focusedProject)) {
      const shape = L.geoJSON(geom, { style: shown, interactive: false });
      shapes.push(shape);
      group.addLayer(shape);
      return;
    }
    const shape = L.geoJSON(geom, { style, bubblingMouseEvents: false });
    if (focused) shapes.push(shape);
    shape.bindTooltip(escapeHtml(p.full || p.name), { sticky: true, direction: 'top', className: 'dot-tip' });
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

// QHPK toàn TP: ranh mọi đồ án QHPK, bấm được cả khi đã phóng gần. Lớp khác: dưới ngưỡng lô thì ranh bấm được.
// So sánh cấp độ: mỗi bản đồ chỉ ranh đúng cấp được chọn ở droplist.
const LEVEL_KEY = { qhc10: 'QHC', qhpk: 'QHPK', qhct: 'QHCT' };
const levelKeyOf = (id) => LEVEL_KEY[id] || null;

function schemeRecords() {
  return projects.map(p => ({ name: p.name, level: p.level, boundary: !!outlineOf(p) }));
}

function layerOffNames() {
  return new Set(projects.filter(p => isLayerHidden(p.name, 'ranh-gioi')).map(p => p.name));
}

function schemesOnLevel(levelKey) {
  const names = new Set(enabledSchemes(schemeRecords(), levelKey, state.hiddenProjects, layerOffNames()).map(p => p.name));
  return projects.filter(p => names.has(p.name));
}

/** Tên đồ án cấp levelKey đang được vẽ ranh. Test hồi quy và droplist dùng cùng danh sách. */
export function visibleOutlineNames(levelKey) {
  return schemesOnLevel(levelKey).map(p => ({ name: p.name, full: p.full || p.name }));
}

function schemeRowOn(p) {
  const selected = !isLevelPair() && levelKeyOf(getLevel());
  if ((selected && p.level === selected) || (qhpkBoundaryOnly() && p.level === 'QHPK')) {
    return !state.hiddenProjects.has(p.name);
  }
  return projectShown(p.name);
}

function outlinesFor(m) {
  const level = levelKeyOf(sideOf(m));
  if (!level) return [];
  return schemesOnLevel(level);
}

function outlineList() {
  const selected = levelKeyOf(getLevel());
  const boundary = qhpkBoundaryOnly();
  const below = !!map && (boundary || map.getZoom() < PARCEL_MIN_ZOOM || !state.showProjects);
  const ward = wardScopeName();
  const selectedNames = new Set(schemesOnLevel(selected).map(p => p.name));
  return projects.filter(p => {
    if (isLayerHidden(p.name, 'ranh-gioi')) return false;
    if (selected && p.level === selected && selectedNames.has(p.name)) {
      // Cấp đang chọn: mọi đồ án enabledSchemes. QHC / QHCT không cắt theo phường.
      if (p.level === 'QHC' || p.level === 'QHCT') return true;
      if (ward && !p.wards.includes(ward) && p.name !== state.focusedProject) return false;
      return true;
    }
    if (state.hiddenProjects.has(p.name)) return false;
    if (ward && !p.wards.includes(ward) && p.name !== state.focusedProject) return false;
    if (boundary && p.level === 'QHPK') return !!outlineOf(p);
    return projectShown(p.name) && (below || p.area);
  });
}

function redrawOutlines() {
  if (isLevelPair()) {
    const below = !!map && map.getZoom() < PARCEL_MIN_ZOOM;
    if (map) drawOutlinesOn(map, outlinesFor(map), below);
    if (planMap) drawOutlinesOn(planMap, outlinesFor(planMap), below);
    return;
  }
  const boundary = qhpkBoundaryOnly();
  const below = !!map && (boundary || map.getZoom() < PARCEL_MIN_ZOOM || !state.showProjects);
  const list = outlineList();
  if (map) drawOutlinesOn(map, list, below);
  if (planMap) drawOutlinesOn(planMap, list, below);
}

function shownMap() {
  if (planMap && getViewMode() === 'QH' && planMap.getContainer()?.offsetParent) return planMap;
  return map;
}

function boundsOfLevel(levelKey) {
  let b = null;
  const add = (bounds) => {
    if (!bounds || !bounds.isValid()) return;
    b = b ? b.extend(bounds) : L.latLngBounds(bounds.getSouthWest(), bounds.getNorthEast());
  };
  schemesOnLevel(levelKey).forEach(p => add(boundsOf(p)));
  if (levelKey === 'QHC') {
    (state.wardLabelsList || []).forEach(w => {
      if (!w.geometry || !isCoreWard(w.name)) return;
      try { add(L.geoJSON(w.geometry).getBounds()); } catch (e) { /* ranh phường lỗi */ }
    });
  }
  return b;
}

/** Phóng khung tới mọi đồ án đang bật của cấp nếu còn đồ án nằm ngoài màn hình. Chưa có danh mục thì hoãn một lần. */
export function frameVisibleSchemes(levelKey) {
  if (isLevelPair() || state.focusedProject || focusExtra) {
    qhcFrameWait = false;
    return false;
  }
  const list = schemesOnLevel(levelKey);
  if (!list.length) {
    if (levelKey === 'QHC') qhcFrameWait = true;
    return false;
  }
  qhcFrameWait = false;
  const m = shownMap();
  if (!m) return false;
  const view = m.getBounds();
  const outside = list.some(p => {
    const b = boundsOf(p);
    return b && b.isValid() && !view.intersects(b);
  });
  if (!outside) return false;
  const b = boundsOfLevel(levelKey);
  if (!b || !b.isValid()) return false;
  m.flyToBounds(b, { padding: [36, 36], duration: 0.6, maxZoom: 11 });
  return true;
}

function refreshAll() {
  redrawOutlines();
  refreshProjectLots();
  refreshAdjustLayer();
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
  if (qhcFrameWait && getLevel() === 'qhc10') frameVisibleSchemes('QHC');
}

function showProject(p) {
  if (!kindOn(p.name)) turnKindOn(p, enableMaster);
  state.hiddenProjects.delete(p.name);
  state.lotProjects.add(p.name);
  ensureFullLots();
  saveHidden();
  refreshAll();
}

// Bỏ một đồ án khỏi hợp ranh tra cứu nhiều đồ án; đồ án còn lại giữ lô
function dropSchemeFromFocus(name) {
  state.lotProjects.delete(name);
  const wasPeer = levelPeers.some(p => p.name === name);
  levelPeers = levelPeers.filter(p => p.name !== name);
  const still = state.focusedProject && state.focusedProject !== name;
  if (!focusExtra?.names?.includes(name)) {
    if (wasPeer && still) document.dispatchEvent(new CustomEvent(PROJECT_INFO_EVENT, { detail: state.focusedProject }));
    return;
  }
  const rest = focusExtra.names.filter(n => n !== name).map(n => projects.find(p => p.name === n)).filter(Boolean);
  if (rest.length >= 2) {
    focusExtra = focusCover(rest);
    if (focusExtra) focusExtra.names = rest.map(p => p.name);
  } else focusExtra = null;
  if (wasPeer && still) document.dispatchEvent(new CustomEvent(PROJECT_INFO_EVENT, { detail: state.focusedProject }));
}

// QHPK toàn TP: tick hiện lại ranh và lô (bỏ chọn đã ghi đồ án vào danh sách ẩn)
function pickProjectLots(p) {
  state.hiddenProjects.delete(p.name);
  saveHidden();
  state.lotProjects.add(p.name);
  if (!state.showProjects) enableMaster();
  ensureFullLots();
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
  const typed = prompt(`Đổi tên khóa đồ án «${p.name}» thành:\nTên đầy đủ: ${p.full || p.name}\nTên rút gọn: ${p.short || p.name}\n(Không bắt đầu bằng HT- / QH-, tối đa 120 ký tự. Hai tên hiển thị cập nhật theo tên khóa mới.)`, p.name);
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

function applyDecision(name, decision) {
  const entry = state.projectCatalog.find(x => x && x.tenQH === name);
  if (entry) {
    if (decision) entry.decision = decision;
    else delete entry.decision;
  }
  rebuild();
  return projects.find(p => p.name === name) || null;
}

function sheetNote(data) {
  if (data.sheet) return '';
  return `\n\nQuyết định đã lưu trên webapp. Cột LinkQD trên sheet DS_DoAn chưa ghi được: ${data.sheetMessage || 'hãy triển khai bản Code.gs mới (Deploy → New version).'}`;
}

function applyProposal(name, proposal) {
  const entry = state.projectCatalog.find(x => x && x.tenQH === name);
  if (entry) {
    if (proposal) entry.proposal = proposal;
    else delete entry.proposal;
  }
  rebuild();
}

function proposalTarget(p) {
  const base = decisionTarget(p);
  return {
    ...base,
    proposal: p.proposal || null,
    onProposed: (proposal) => { applyProposal(p.name, proposal); },
    onResolved: (decision, data) => {
      applyProposal(p.name, null);
      if (!decision) return null;
      const next = applyDecision(p.name, decision);
      if (data && !data.sheet) alert(`Đã ghi PDF lên bucket.${sheetNote(data)}`);
      return next ? decisionTarget(next) : null;
    }
  };
}

function applyDocs(name, docs) {
  const entry = state.projectCatalog.find(x => x && x.tenQH === name);
  if (entry) entry.docs = Array.isArray(docs) ? docs : [];
  rebuild();
  return projects.find(p => p.name === name) || null;
}

function docTarget(p, doc, role) {
  const meta = DOC_ROLE[role] || DOC_ROLE[doc && doc.role] || { label: 'Văn bản' };
  const id = doc && doc.id ? doc.id : '';
  return {
    key: `doc:${p.name}:${id || 'new'}:${role || (doc && doc.role) || ''}`,
    title: p.name,
    noun: meta.label,
    decision: doc || null,
    slug: p.slug,
    body: { tenQH: p.name, docRole: role || (doc && doc.role) || '', docId: id },
    isBusy: () => !!busy,
    setBusy: (on) => { busy = on ? p.name : null; renderList(); },
    onSaved: (saved, data) => {
      if (!data || !Array.isArray(data.docs)) return null;
      const next = applyDocs(p.name, data.docs);
      if (!saved || !next) return null;
      const fresh = (next.docs || []).find(d => d.id === saved.id);
      return fresh ? docTarget(next, fresh, fresh.role) : null;
    }
  };
}

function decisionTarget(p) {
  return {
    key: `project:${p.name}`,
    title: p.name,
    noun: 'đồ án',
    decision: p.decision || null,
    slug: p.slug,
    body: { tenQH: p.name },
    isBusy: () => !!busy,
    setBusy: (on) => { busy = on ? p.name : null; renderList(); },
    onSaved: (decision, data) => {
      const next = applyDecision(p.name, decision);
      if (decision && data && !data.sheet) alert(`${decision.kind === 'link' ? 'Đã gán link.' : 'Đã ghi PDF lên bucket.'}${sheetNote(data)}`);
      return decision && next ? decisionTarget(next) : null;
    }
  };
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
  // Ô lớp QHC 1/10.000 / QHCT 1/500 quyết định đồ án cấp đó có hiện: vẽ lại 1 lần sau loạt đổi ô (đổi lớp droplist)
  let redrawQueued = false;
  document.addEventListener('change', (e) => {
    const id = e.target?.id;
    if (Object.values(LEVEL_EXTRA_CHK).includes(id)) { paintEyes(); return; }
    if (!Object.values(LEVEL_CHK).includes(id)) return;
    paintEyes();
    if (id === LEVEL_CHK.QHC25 || redrawQueued) return;
    redrawQueued = true;
    requestAnimationFrame(() => { redrawQueued = false; refreshAll(); });
  });
  onSplitPair(() => refreshAll());
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
    const adjBox = e.target.closest('[data-adj-layer]');
    if (adjBox) {
      const p = projects[Number(adjBox.dataset.adjLayer)];
      if (p) setAdjustOn(p, adjBox.checked);
      return;
    }
    const box = e.target.closest('[data-project]');
    const p = box && projects[Number(box.dataset.project)];
    if (!p) return;
    if (box.checked) {
      if (qhpkBoundaryOnly() && p.level === 'QHPK') pickProjectLots(p);
      else showProject(p);
      return;
    }
    // Bỏ chọn: ẩn ranh, nhãn, lô đất và lô công trình của đúng đồ án. Đồ án kia trong tra cứu nhiều đồ án giữ nguyên.
    state.hiddenProjects.add(p.name);
    dropSchemeFromFocus(p.name);
    if (!qhpkBoundaryOnly() && !projects.some(x => !state.hiddenProjects.has(x.name))) setMaster(false);
    saveHidden();
    if (p.name === focusName || p.name === state.focusedProject) {
      document.dispatchEvent(new CustomEvent(PROJECT_VIEW_EXIT_EVENT, { detail: { hidden: p.name } }));
    }
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
    const eye = e.target.closest('[data-level-eye]');
    if (eye) { setLevelShown(eye.dataset.levelEye, !eyeState(eye.dataset.levelEye).on); return; }
    const level = e.target.closest('[data-level-toggle]');
    if (level) {
      const key = level.dataset.levelToggle;
      if (closedLevels.has(key)) closedLevels.delete(key); else closedLevels.add(key);
      renderList();
      return;
    }
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
      if (p) openOrAssign(decisionTarget(p));
      return;
    }
    const docBtn = e.target.closest('[data-doc]');
    if (docBtn) {
      const [pi, di] = docBtn.dataset.doc.split(':').map(Number);
      const p = projects[pi];
      const doc = p && (p.docs || [])[di];
      if (p && doc) openDecision(docTarget(p, doc, doc.role));
      return;
    }
    const docAdd = e.target.closest('[data-doc-add]');
    if (docAdd) {
      const p = projects[Number(docAdd.dataset.docAdd)];
      if (!p || !isAdmin()) return;
      const role = $('projectList')?.querySelector(`[data-doc-role="${docAdd.dataset.docAdd}"]`)?.value || 'dinh-chinh';
      if (role === 'phe-duyet' && !p.decision) { openOrAssign(decisionTarget(p)); return; }
      openAssign(docTarget(p, null, role));
      return;
    }
    const kmlBoundary = e.target.closest('[data-kml-boundary]');
    if (kmlBoundary) {
      const p = projects[Number(kmlBoundary.dataset.kmlBoundary)];
      if (p) pickBoundaryKml(p);
      return;
    }
    const netAdd = e.target.closest('[data-net-add]');
    if (netAdd) {
      const hit = layerOf(netAdd.dataset.netAdd);
      if (hit) pickNetFile(hit.p, hit.g);
      return;
    }
    const propose = e.target.closest('[data-propose]');
    if (propose) {
      const p = projects[Number(propose.dataset.propose)];
      if (!p) return;
      if (isAdmin()) openProposalReview(proposalTarget(p));
      else openPropose(proposalTarget(p));
      return;
    }
    const expand = e.target.closest('[data-expand]');
    if (expand) { const p = projects[Number(expand.dataset.expand)]; if (p) toggleExpand(p); return; }
    const adjToggle = e.target.closest('[data-adj-open]');
    if (adjToggle) {
      const p = projects[Number(adjToggle.dataset.adjOpen)];
      if (!p) return;
      if (adjOpen.has(p.name)) adjOpen.delete(p.name); else adjOpen.add(p.name);
      renderList();
      return;
    }
    // Phóng tới hồ sơ do adjustLayer.js xử lý (bắt ở document); ở đây chỉ bật lại đồ án / lớp đang ẩn để ranh hiện
    const adjGo = e.target.closest('[data-adj-project]');
    if (adjGo) {
      const p = projects[Number(adjGo.dataset.adjProject)];
      if (p && (isLayerHidden(p.name, ADJUST_LAYER_KEY) || !projectShown(p.name))) setAdjustOn(p, true);
      return;
    }
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
  document.addEventListener(OPEN_PROJECT_EVENT, (e) => {
    const p = projects.find(x => x.name === e.detail);
    if (!p) return;
    openProject(p);
    revealInList(p);
  });
  document.addEventListener('auth:change', renderList);
  document.addEventListener(ADJUST_CHANGE_EVENT, renderList);
  document.addEventListener(LEVEL_EVENT, focusLevelGroup);
  map?.on('zoomend', () => {
    const below = map.getZoom() < PARCEL_MIN_ZOOM;
    if (below === belowZoom) return;
    belowZoom = below;
    // QHC / QHCT tắt lớp QHPK (showProjects = false) nhưng ranh cấp đang chọn vẫn phải vẽ lại khi qua ngưỡng lô
    redrawOutlines();
    if (state.showProjects) refreshProjectLots();
  });
  onCompareChange(redrawOutlines);
  belowZoom = map ? map.getZoom() < PARCEL_MIN_ZOOM : null;
  rebuild();
}
