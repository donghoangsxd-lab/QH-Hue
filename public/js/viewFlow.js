// Luồng xem theo lớp quy hoạch (mapLevel.js) và địa bàn:
// 1. Mở trang: bản đồ quy hoạch toàn TP, lớp Hệ thống đô thị (ranh 40 phường xã + phân loại đô thị), panel dưới và phải ẩn.
// 2. Đổi lớp ở droplist tiêu đề: bật lớp đó, tắt 4 lớp kia, vào luồng riêng của lớp:
//    - Hệ thống đô thị: bấm phường → chọn phường và sang QHPK (luồng cũ); bấm ký hiệu đô thị trung tâm → QHC 1/10.000.
//    - QHC 1/25.000: chỉ xem / bấm vùng; bấm bản đồ không đổi địa bàn.
//    - QHC 1/10.000: bấm lô tra cứu; panel phải lọc QHPK trong vùng lõi; chọn phường lõi giữ lớp,
//      phường ngoài vùng lõi sang QHPK.
//    - QHPK 1/2.000: lô cả phường đang chọn; bấm nền khi nhìn rộng → chọn phường.
//    - QHCT 1/500: chờ dữ liệu.
// 3. Mở đồ án (từ danh sách, ranh trên bản đồ hoặc popup): sang lớp QHPK, thông tin đồ án thay panel dưới; thoát về
//    địa bàn đang chọn, hoặc về QHC 1/10.000 nếu mở khi đang xem lớp này.
// 4. Chọn lại Thành phố Huế: giữ lớp đang xem, tắt các lớp phụ, panel dưới giữ nguyên để xem chỉ tiêu toàn TP.
// Bản đồ hiện trạng (lật sang hoặc nửa trái khi so sánh): bấm nền khi nhìn rộng → chọn phường.
import { state } from './state.js';
import { highlightWardBoundary, wardNameAt } from './mapEngine.js';
import { planMap, setSplit, isSplitOn, getViewMode, setViewMode } from './planMap.js';
import { WARD_SELECT_EVENT, selectWardDetail } from './uiComponents.js';
import { closeProjectView, PROJECT_VIEW_EXIT_EVENT } from './projectReview.js';
import { revealWardProjects, clearProjectFocus } from './projectLayer.js';
import { LOTS_PROGRESS_EVENT, PROJECT_INFO_EVENT } from './projectFiles.js';
import { RIGHT_TAB_EVENT } from './utils.js';
import { URBAN_PICK_EVENT } from './urbanAreaLayer.js';
import { fitCenter, isCoreWard } from './qhc2045Layer.js';
import { getLevel, setLevel, levelOrigin, LEVEL_EVENT, LEVELS } from './mapLevel.js';

const CITY_NAME = 'Thành phố Huế';
// Về toàn TP chỉ tắt lớp phụ; ô tùy chọn con (ranh lô công trình, lô hạ tầng đồ án, đổ bóng) không tự vẽ gì nên giữ.
// Ô của 5 lớp quy hoạch do mapLevel.js quản lý.
const KEEP = new Set(['chk_bound', 'chk_parcel', 'chk_projectInfra', 'chk_hillshade', ...LEVELS.map(l => l.chk)]);
// Bấm bản đồ chọn phường chỉ khi nhìn rộng; phóng gần là đang xem chi tiết, bấm không đổi địa bàn
const WARD_PICK_MAX_ZOOM = 14;
// Tải lô nhanh hơn ngưỡng này thì không hiện thanh tiến độ (tránh nháy)
const PROGRESS_DELAY_MS = 250;
// Ký hiệu đô thị (QĐ 756) mở QHC 1/10.000
const CENTER_URBAN_IDS = new Set(['trung-tam']);
// Lớp bấm nền bản đồ quy hoạch thì chọn phường
const WARD_PICK_LEVELS = new Set(['urban', 'qhpk']);

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
function onLevelChange({ level, prev }) {
  if (prev === 'qhpk' && level !== 'qhpk') {
    closeProjectView();
    clearProjectFocus();
  }
  const ward = isCity(state.selectedWard) ? null : state.selectedWard;
  if (level === 'qhpk') {
    if (!state.focusedProject) revealWardProjects(ward);
    return;
  }
  revealWardProjects(ward, { show: false });
  if (level !== 'qhc10') return;
  if (ward && !isCoreWard(ward)) selectWardDetail(CITY_NAME);
  else if (ward) highlightWardBoundary(ward, { fitView: true });
  else fitCenter();
}

/** Vào QHC 1/10.000 (bấm ký hiệu đô thị trung tâm) */
function enterCore() {
  closeProjectView();
  clearProjectFocus();
  if (!isSplitOn() && getViewMode() !== 'QH') setViewMode('QH');
  setLevel('qhc10');
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
  closeProjectView();
  clearProjectFocus();
  if (isCity(name)) enterCity();
  else enterWard(name);
}

// ---------- Đồ án ----------
// Mở đồ án ở lớp khác (projectLayer bật QHPK không qua checkbox): đồng bộ về lớp QHPK, nhớ lớp gốc để thoát quay lại
function onProjectOpened() {
  const level = getLevel();
  if (level === 'qhpk') return;
  setLevel('qhpk', { origin: level === 'qhc10' ? 'qhc10' : null });
}

// Thoát thông tin đồ án: về lớp gốc (QHC 1/10.000) hoặc phường đang chọn / toàn TP, lô cả phường hiện lại.
// detail.hidden: thoát do bỏ chọn đồ án trong danh sách → đóng thông tin, không hiện lại đồ án của phường
function onProjectExit(e) {
  const unchecked = !!e?.detail?.hidden;
  if (unchecked) closeProjectView();
  clearProjectFocus();
  if (getLevel() === 'qhpk' && levelOrigin() === 'qhc10') {
    setLevel('qhc10');
    return;
  }
  highlightWardBoundary(state.selectedWard, { fitView: true });
  if (!unchecked) revealWardProjects(isCity(state.selectedWard) ? null : state.selectedWard);
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
 * Bản đồ quy hoạch theo lớp đang chọn; bản đồ hiện trạng luôn chọn phường.
 */
export function wardFromMapClick(latlng, m) {
  const planSide = !!planMap && m === planMap;
  if (planSide && !WARD_PICK_LEVELS.has(getLevel())) return null;
  return wardToPick(latlng, m);
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

export function initViewFlow() {
  document.addEventListener(LEVEL_EVENT, (e) => onLevelChange(e.detail));
  document.addEventListener(WARD_SELECT_EVENT, (e) => onWardSelected(e.detail));
  document.addEventListener(PROJECT_INFO_EVENT, onProjectOpened);
  document.addEventListener(PROJECT_VIEW_EXIT_EVENT, onProjectExit);
  document.addEventListener(URBAN_PICK_EVENT, (e) => { if (CENTER_URBAN_IDS.has(e.detail)) enterCore(); });
  initProgress();
}
