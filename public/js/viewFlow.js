// Luồng xem theo lớp quy hoạch (mapLevel.js) và địa bàn:
// 1. Mở trang: bản đồ quy hoạch toàn TP, lớp Hệ thống đô thị (ranh 40 phường xã + phân loại đô thị), panel dưới và phải ẩn.
// 2. Đổi lớp ở droplist tiêu đề: bật lớp đó, tắt 4 lớp kia, vào luồng riêng của lớp. Bấm bản đồ quy hoạch không chọn
//    phường ở mọi lớp; chọn phường ở droplist bảng tổng hợp (panel dưới).
//    - Hệ thống đô thị: bấm ký hiệu, nét ranh hoặc trong ranh một đô thị → chọn đô thị (urbanFocus.js): nổi ranh, tô phạm vi
//      đã có QHC / QHPK / QHCT, bấm vùng đồ án để mở; vùng QHC đô thị TT Huế 2045 → QHC 1/10.000 và mở lô.
//      Bấm nền ngoài mọi đô thị thì bỏ chọn.
//    - QHC 1/25.000: chỉ xem / bấm vùng; bấm bản đồ không đổi địa bàn. Đang xem một địa điểm thì chỉ vùng chức năng, không nét ranh, không phóng ra toàn thành phố.
//    - QHC 1/10.000: toàn thành phố thì ranh + tên (rê vào vùng lõi thì sáng), bấm ranh mới có lô. Đang xem một địa điểm thì mở thẳng lô, không ranh, không phóng ra.
//      bấm nền ngoài đồ án đang mở thì về tổng quan; bấm lô tra cứu; panel phải lọc QHPK trong vùng lõi;
//      chọn phường lõi giữ lớp, phường ngoài vùng lõi sang QHPK.
//    - QHPK 1/2.000: toàn TP chỉ ranh các đồ án; bấm ranh hoặc tick đồ án trong panel mới tải lô.
//      Ranh điều chỉnh cục bộ và khu vực đã có QHCT chỉ hiện khi đang mở một đồ án, trong phạm vi đồ án đó.
//      Chọn phường: lô cả phường (chỉ tiêu panel dưới giữ nguyên).
//      Esc khi đang chọn đồ án QHPK: bỏ chọn, giữ lớp và khung nhìn, không phóng ra toàn thành phố.
//    - QHCT 1/500: ranh + tên các đồ án QHCT (planLevelOf), bấm đồ án → chi tiết.
// 3. Mở đồ án (từ danh sách, ranh trên bản đồ hoặc popup): sang lớp QHPK (đồ án QHC mở từ đô thị: QHC 1/10.000; đồ án QHCT:
//    QHCT 1/500), thông tin đồ án thay panel dưới; thoát về địa bàn đang chọn, hoặc về lớp đã mở đồ án.
// 4. Chọn lại Thành phố Huế: giữ lớp đang xem, tắt các lớp phụ, panel dưới giữ nguyên để xem chỉ tiêu toàn TP.
// Bản đồ hiện trạng (lật sang hoặc nửa trái khi so sánh): bấm nền khi nhìn rộng → chọn phường.
import { state } from './state.js';
import { map, highlightWardBoundary, wardNameAt } from './mapEngine.js';
import { planMap, setSplit, isSplitOn, getViewMode, setViewMode } from './planMap.js';
import { WARD_SELECT_EVENT, selectWardDetail } from './uiComponents.js';
import { closeProjectView, PROJECT_VIEW_EXIT_EVENT } from './projectReview.js';
import { revealWardProjects, clearProjectFocus, projectContains, openProjectAt } from './projectLayer.js';
import { LOTS_PROGRESS_EVENT, PROJECT_INFO_EVENT } from './projectFiles.js';
import { RIGHT_TAB_EVENT } from './utils.js';
import { URBAN_PICK_EVENT, urbanVisionFeature, urbanVisionAt } from './urbanAreaLayer.js';
import { focusUrban, clearUrbanFocus, urbanFocusHolds, urbanFocused, initUrbanFocus, FOCUS_CORE_EVENT } from './urbanFocus.js';
import { fitCenter, isCoreWard, setCoreOpen, isCoreOpen, coreContains, setQhcPlaceMode, setPreferPlace, QHC_CORE_EVENT } from './qhc2045Layer.js';
import { getLevel, setLevel, levelOrigin, levelScope, LEVEL_EVENT, LEVELS } from './mapLevel.js';
import { planLevelOf, URBAN_FOCUS_EVENT } from './generalPlan.js';

const CITY_NAME = 'Thành phố Huế';
// Về toàn TP chỉ tắt lớp phụ; ô tùy chọn con (ranh lô công trình, lô hạ tầng đồ án, đổ bóng) không tự vẽ gì nên giữ.
// Ô của 5 lớp quy hoạch do mapLevel.js quản lý.
const KEEP = new Set(['chk_bound', 'chk_parcel', 'chk_projectInfra', 'chk_hillshade', ...LEVELS.map(l => l.chk)]);
// Bấm bản đồ chọn phường chỉ khi nhìn rộng; phóng gần là đang xem chi tiết, bấm không đổi địa bàn
const WARD_PICK_MAX_ZOOM = 14;
// Từ mức này trở lên (hoặc đang chọn phường / đồ án) là đang xem một địa điểm, không phải toàn thành phố
const PLACE_ZOOM = 14;
// Tải lô nhanh hơn ngưỡng này thì không hiện thanh tiến độ (tránh nháy)
const PROGRESS_DELAY_MS = 250;
// Ký hiệu đô thị (QĐ 756) mở QHC 1/10.000 khi bật lớp đô thị để so sánh ở lớp khác
const CENTER_URBAN_IDS = new Set(['trung-tam']);

const isCity = (name) => !name || name === CITY_NAME;

function setChecked(id, on) {
  const el = document.getElementById(id);
  if (!el || el.checked === on) return;
  el.checked = on;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function showLayersTab() {
  document.dispatchEvent(new CustomEvent(RIGHT_TAB_EVENT, { detail: { tab: 'tabLayers', open: false } }));
  document.querySelector('[data-main-tab="plan"]')?.click();
}

// ---------- Lớp quy hoạch ----------
function viewingPlace() {
  if (state.focusedProject) return true;
  if (!isCity(state.selectedWard)) return true;
  const shown = getViewMode() === 'QH' && planMap ? planMap : map;
  return !!shown && shown.getZoom() >= PLACE_ZOOM;
}

function onLevelChange({ level, prev, keepView }) {
  if (!inspectSync) setPreferPlace(false);
  const keepFocus = !!state.focusedProject && planLevelOf(state.focusedProject) === levelScope();
  if (prev === 'qhpk' && level !== 'qhpk' && !keepFocus) {
    closeProjectView();
    clearProjectFocus();
  }
  const ward = isCity(state.selectedWard) ? null : state.selectedWard;
  if (level === 'qhpk') {
    setQhcPlaceMode(false);
    if (!ward) state.lotProjects.clear();
    if (!state.focusedProject) revealWardProjects(ward);
    syncEscHint();
    return;
  }
  revealWardProjects(ward, { show: false });
  const place = (level === 'qhc10' || level === 'qhc25') && viewingPlace();
  setQhcPlaceMode(place);
  if (level === 'qhc10') setCoreOpen(place);
  // Địa điểm cụ thể, hoặc droplist QHC 1/10.000: giữ khung hình. Bấm đô thị trung tâm (không keepView, không phải địa điểm) vẫn phóng tới vùng trung tâm.
  if (place || level !== 'qhc10' || state.focusedProject || keepView) {
    syncEscHint();
    return;
  }
  if (ward && !isCoreWard(ward)) selectWardDetail(CITY_NAME);
  else if (ward) highlightWardBoundary(ward, { fitView: true });
  else fitCenter();
  syncEscHint();
}

// Bảng thửa / vùng đo / ranh dự án đang tự đổi lớp: sự kiện qh:level không được gọi lại bảng (tránh vòng lặp)
let inspectSync = 0;
export const inspectLevelSyncing = () => inspectSync > 0;

/** Điểm nằm trong hình (thửa, vùng đo, ranh dự án); không có hình thì tâm khung bao */
export function geometryPoint(geom, bounds) {
  if (geom && typeof turf !== 'undefined') {
    try {
      const c = turf.pointOnFeature(turf.feature(geom)).geometry.coordinates;
      if (Number.isFinite(c[0]) && Number.isFinite(c[1])) return L.latLng(c[1], c[0]);
    } catch { /* hình lỗi */ }
  }
  return bounds?.isValid?.() ? bounds.getCenter() : null;
}

const PROJECT_KIND = { qhpk: 'QHPK', qhct: 'QHCT' };

/**
 * Tab cấp quy hoạch trên bảng kiểm tra: bật đúng lớp, tắt các lớp quy hoạch khác, giữ khung nhìn.
 * QHPK / QHCT mở đồ án nhỏ nhất đang chứa điểm. QHC 1/10.000 và 1/25.000 vẽ lô / vùng tại khung nhìn.
 */
export function applyInspectLevel(id, latlng) {
  if (!id) return;
  inspectSync++;
  try {
    setLevel(id, { keepView: true });
  } finally {
    inspectSync--;
  }
  if (id === 'qhc10' || id === 'qhc25') {
    setPreferPlace(true);
    return;
  }
  setPreferPlace(false);
  const kind = PROJECT_KIND[id];
  if (kind) openProjectAt(latlng, kind);
}

/** Vào QHC 1/10.000 (bấm ký hiệu đô thị trung tâm, hoặc vùng TTHuế 2045 của đô thị đang chọn: openLots mở lô luôn) */
function enterCore({ openLots = false } = {}) {
  closeProjectView();
  clearProjectFocus();
  if (!isSplitOn() && getViewMode() !== 'QH') setViewMode('QH');
  setLevel('qhc10');
  if (openLots) setCoreOpen(true);
  syncEscHint();
}

// ---------- Hệ thống đô thị ----------
const focusOf = (u) => u && focusUrban({ key: `u:${u.id}`, name: u.name, geometry: u.geometry, city: u.city });

function onUrbanPick({ id, side } = {}) {
  if (side === 'QH' && getLevel() === 'urban') {
    urbanVisionFeature(id).then(u => { if (getLevel() === 'urban') focusOf(u); });
    return;
  }
  if (CENTER_URBAN_IDS.has(id)) enterCore();
}

// Bấm nền bản đồ quy hoạch ở lớp đô thị: trong đô thị đang chọn thì giữ, trong đô thị khác thì chọn đô thị đó, ngoài mọi đô thị thì bỏ chọn
async function pickUrbanAt(latlng) {
  if (urbanFocusHolds(latlng)) return;
  const u = await urbanVisionAt(latlng);
  if (getLevel() !== 'urban') return;
  if (u) focusOf(u);
  else clearUrbanFocus();
}

// ---------- Địa bàn ----------
function enterCity() {
  if (isSplitOn()) setSplit(false);
  if (getViewMode() !== 'QH') setViewMode('QH');
  document.querySelectorAll('#tabLayers input[type="checkbox"][id^="chk_"]').forEach(el => {
    if (!KEEP.has(el.id)) setChecked(el.id, false);
  });
  setChecked('chk_bound', true);
  setLevel(getLevel());
}

function enterWard(name) {
  const level = getLevel();
  if (level === 'urban' || (level === 'qhc10' && !isCoreWard(name))) setLevel('qhpk');
  else if (level === 'qhpk') revealWardProjects(name);
  else revealWardProjects(name, { show: false });
  showLayersTab();
}

function onWardSelected(name) {
  clearUrbanFocus();
  closeProjectView();
  clearProjectFocus();
  if (isCity(name)) enterCity();
  else enterWard(name);
  syncEscHint();
}

// ---------- Đồ án ----------
// Mở đồ án ở lớp khác: sang lớp đúng cấp đồ án (QHC → QHC 1/10.000, QHCT → QHCT 1/500, còn lại QHPK 1/2.000), nhớ lớp gốc
// để thoát quay lại. Đồ án cùng cấp lớp đang xem giữ lớp, thu gọn lô TTHuế 2045.
const RETURN_LEVELS = new Set(['qhc10', 'urban']);
const KIND_LEVEL = { QHC: 'qhc10', QHCT: 'qhct' };
function onProjectOpened(e) {
  const level = getLevel();
  const kind = planLevelOf(e?.detail);
  if (level === 'qhpk' && kind === 'QHPK') { /* giữ lớp */ }
  else if (levelScope() && kind === levelScope()) setCoreOpen(false);
  else if (KIND_LEVEL[kind]) {
    setLevel(KIND_LEVEL[kind], { origin: level });
    setCoreOpen(false);
  } else setLevel('qhpk', { origin: RETURN_LEVELS.has(level) ? level : null });
  syncEscHint();
}

// Bỏ đồ án đang mở, giữ lớp và khung nhìn hiện tại
function leaveProject() {
  closeProjectView();
  clearProjectFocus();
  revealWardProjects(isCity(state.selectedWard) ? null : state.selectedWard, { show: false });
  syncEscHint();
}

// Lớp có cấp đồ án (QHC 1/10.000): bấm nền ngoài đồ án đang mở thì thu gọn về tổng quan
function leaveScopeFocus(latlng) {
  if (state.focusedProject && !projectContains(state.focusedProject, latlng)) leaveProject();
  if (isCoreOpen() && !coreContains(latlng)) setCoreOpen(false);
  syncEscHint();
}

// Thoát thông tin đồ án: về lớp gốc (Hệ thống đô thị, QHC 1/10.000) hoặc phường đang chọn / toàn TP, lô cả phường hiện lại.
// detail.hidden: thoát do bỏ chọn đồ án trong danh sách → đóng thông tin, không hiện lại đồ án của phường
function onProjectExit(e) {
  const unchecked = !!e?.detail?.hidden;
  if (unchecked) closeProjectView();
  clearProjectFocus();
  const from = levelOrigin();
  if (from && from !== getLevel()) {
    setLevel(from);
    return;
  }
  if (levelScope()) {
    revealWardProjects(isCity(state.selectedWard) ? null : state.selectedWard, { show: false });
    syncEscHint();
    return;
  }
  highlightWardBoundary(state.selectedWard, { fitView: true });
  if (!unchecked) revealWardProjects(isCity(state.selectedWard) ? null : state.selectedWard);
  syncEscHint();
}

// ---------- Click bản đồ ----------
/** Phường dưới điểm bấm (khác phường đang chọn, đang nhìn rộng) → tên phường, không thì null */
function wardToPick(latlng, m) {
  if (!m || m.getZoom() > WARD_PICK_MAX_ZOOM) return null;
  const name = latlng ? wardNameAt(latlng.lat, latlng.lng) : null;
  return name && name !== state.selectedWard ? name : null;
}

/**
 * Bấm nền bản đồ (không trúng đối tượng có popup / công cụ đang bật) → tên phường cần chọn, hoặc null.
 * Bản đồ quy hoạch không chọn phường (lớp có cấp đồ án thu gọn đồ án, lớp đô thị chọn đô thị); bản đồ hiện trạng chọn phường.
 */
export function wardFromMapClick(latlng, m) {
  const planSide = !!planMap && m === planMap;
  if (!planSide) return wardToPick(latlng, m);
  if (levelScope()) leaveScopeFocus(latlng);
  if (getLevel() === 'urban') pickUrbanAt(latlng);
  return null;
}

function initProgress() {
  const el = document.createElement('div');
  el.className = 'lots-progress';
  el.hidden = true;
  el.setAttribute('role', 'status');
  el.innerHTML = '<i class="lots-progress-spin"></i><span></span><b class="lots-progress-bar"><i></i></b>';
  document.body.appendChild(el);
  const text = el.querySelector('span');
  const bar = el.querySelector('.lots-progress-bar > i');
  let timer = null;
  document.addEventListener(LOTS_PROGRESS_EVENT, (e) => {
    const { done, total } = e.detail || {};
    if (!total || done >= total) {
      clearTimeout(timer);
      timer = null;
      el.hidden = true;
      return;
    }
    text.textContent = `Đang tải lô quy hoạch: ${done}/${total} đồ án`;
    bar.style.width = `${Math.round(done / total * 100)}%`;
    if (el.hidden && !timer) timer = setTimeout(() => { timer = null; el.hidden = false; }, PROGRESS_DELAY_MS);
  });
}

function escBusy() {
  const t = document.activeElement;
  if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return true;
  if (state.sketchTool || state.adminDrawMode || state.isPickMode || state.activeMeasureType || state.lotShapeEdit) return true;
  return !!document.querySelector('.ov-root:not([hidden]), .tour-root:not([hidden]), #adjViewer, #decisionView:not([hidden]), .cad-card:not([hidden]), .leaflet-popup.dock-card');
}

function isQhcPopup(pop) {
  return !!(pop?.isOpen?.() && pop._map && pop._container?.classList.contains('qhc-popup'));
}

function qhcPopupOpen() {
  return [map, planMap].some(m => isQhcPopup(m?._popup));
}

// Leaflet 1.9 closePopup chỉ gọi popup.close(); popup đã gỡ khỏi bản đồ thì _popup vẫn còn, ESC sau bị kẹt ở nhánh này.
function closeQhcPopup() {
  let closed = false;
  for (const m of [map, planMap]) {
    if (!m) continue;
    const pop = m._popup;
    if (!pop?._container?.classList.contains('qhc-popup')) continue;
    if (isQhcPopup(pop)) {
      pop._map.removeLayer(pop);
      closed = true;
    }
    if (m._popup === pop) m._popup = null;
  }
  return closed;
}

/** Hiện "Bấm ESC để thoát" khi đang chọn đồ án, lõi QHC, phường xã, đô thị hoặc vùng QHC */
function syncEscHint() {
  const hint = document.getElementById('escHint');
  if (!hint) return;
  const on = !!(state.focusedProject || isCoreOpen() || !isCity(state.selectedWard) || urbanFocused() || qhcPopupOpen());
  hint.hidden = !on;
}

// Lớp trong cùng thoát trước: popup vùng QHC → đồ án → lô lõi QHC → ranh phường xã → đô thị
function onEscape(e) {
  if (e.key !== 'Escape' || e.defaultPrevented || escBusy()) return;
  if (closeQhcPopup()) {
    e.preventDefault();
    syncEscHint();
    return;
  }
  if (state.focusedProject) {
    e.preventDefault();
    // QHPK: chỉ bỏ chọn. Thoát đủ (về lớp gốc, phóng về địa bàn) dành cho đồ án cấp khác và nút đóng panel.
    if (planLevelOf(state.focusedProject) === 'QHPK') leaveProject();
    else document.dispatchEvent(new CustomEvent(PROJECT_VIEW_EXIT_EVENT));
    return;
  }
  if (isCoreOpen()) {
    e.preventDefault();
    setCoreOpen(false);
    syncEscHint();
    return;
  }
  if (!isCity(state.selectedWard)) {
    e.preventDefault();
    selectWardDetail(CITY_NAME);
    return;
  }
  if (urbanFocused()) {
    e.preventDefault();
    clearUrbanFocus();
  }
}

export function initViewFlow() {
  document.addEventListener('keydown', onEscape);
  document.addEventListener(LEVEL_EVENT, (e) => onLevelChange(e.detail));
  document.addEventListener(WARD_SELECT_EVENT, (e) => onWardSelected(e.detail));
  document.addEventListener(PROJECT_INFO_EVENT, onProjectOpened);
  document.addEventListener(PROJECT_VIEW_EXIT_EVENT, onProjectExit);
  document.addEventListener(URBAN_PICK_EVENT, (e) => onUrbanPick(e.detail));
  document.addEventListener(URBAN_FOCUS_EVENT, syncEscHint);
  document.addEventListener(FOCUS_CORE_EVENT, () => enterCore({ openLots: true }));
  initUrbanFocus();
  document.addEventListener(QHC_CORE_EVENT, () => {
    if (state.focusedProject) leaveProject();
    syncEscHint();
  });
  [map, planMap].filter(Boolean).forEach(m => m.on('popupopen popupclose', syncEscHint));
  initProgress();
}
