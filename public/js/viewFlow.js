// Luồng chuyển view theo địa bàn:
// 1. Mở trang: bản đồ quy hoạch toàn TP, chỉ bật ranh 40 phường xã + phân loại đô thị, panel dưới và phải ẩn;
//    thanh chọn nhanh dưới tiêu đề mở thêm sơ đồ định hướng QHC 1/25.000 toàn đô thị.
// 2a. Bấm đô thị trung tâm (phường thuộc khu vực trung tâm, Hóa Châu, Mỹ Thượng hoặc ký hiệu đô thị trung tâm): phóng tới,
//    tắt phân loại đô thị, bật sử dụng đất QHC 1/10.000, mở thẻ Khu vực trung tâm (tra cứu lô / chọn phường / chọn QHPK).
// 2b. Chọn phường khác (bấm bản đồ, droplist, bảng 40 phường): tắt phân loại đô thị, bật lớp Quy hoạch → lô cả phường ở mọi zoom;
//    panel giữ trạng thái ẩn / hiện nhưng đã tính chỉ tiêu phường và cuộn danh sách đồ án tới nhóm phường.
//    Phường trong vùng lõi chọn từ thẻ Khu vực trung tâm: giữ lớp 1/10.000 dưới lô QHPK, thẻ thu thành nút quay lại.
// 3. Chọn đồ án (projectLayer → projectReview): thông tin đồ án dạng gọn thay nội dung panel dưới; nút thoát về bước 2
//    (hoặc về thẻ Khu vực trung tâm nếu mở đồ án từ đó).
// 4. Chọn lại Thành phố Huế: về mặc định của bước 1, panel dưới giữ nguyên để xem chỉ tiêu toàn TP.
import { state } from './state.js';
import { highlightWardBoundary, wardNameAt } from './mapEngine.js';
import { setSplit, isSplitOn, getViewMode, setViewMode } from './planMap.js';
import { WARD_SELECT_EVENT, selectWardDetail } from './uiComponents.js';
import { closeProjectView, PROJECT_VIEW_EXIT_EVENT } from './projectReview.js';
import { revealWardProjects, clearProjectFocus } from './projectLayer.js';
import { LOTS_PROGRESS_EVENT } from './projectFiles.js';
import { RIGHT_TAB_EVENT } from './utils.js';
import { URBAN_PICK_EVENT } from './urbanAreaLayer.js';
import { CORE_NAV_EVENT, setCoreCard, coreCardMode, fitCenter, isCoreWard } from './qhc2045Layer.js';

const CITY_NAME = 'Thành phố Huế';
// Về mặc định chỉ tắt lớp; ô tùy chọn con (ranh lô công trình, lô hạ tầng đồ án, đổ bóng) không tự vẽ gì nên giữ
const KEEP = new Set(['chk_bound', 'chk_urban', 'chk_parcel', 'chk_projectInfra', 'chk_hillshade']);
// Bấm bản đồ chọn phường chỉ khi nhìn rộng; phóng gần là đang xem chi tiết, bấm không đổi địa bàn
const WARD_PICK_MAX_ZOOM = 14;
// Tải lô nhanh hơn ngưỡng này thì không hiện thanh tiến độ (tránh nháy)
const PROGRESS_DELAY_MS = 250;
// Ký hiệu đô thị (QĐ 756) mở thẻ Khu vực trung tâm
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

function enterCity() {
  setCoreCard(null);
  if (isSplitOn()) setSplit(false);
  if (getViewMode() !== 'QH') setViewMode('QH');
  document.querySelectorAll('#tabLayers input[type="checkbox"][id^="chk_"]').forEach(el => {
    if (!KEEP.has(el.id)) setChecked(el.id, false);
  });
  setChecked('chk_bound', true);
  setChecked('chk_urban', true);
  revealWardProjects(null);
}

function enterWard(name) {
  if (coreCardMode() && isCoreWard(name)) {
    setCoreCard('mini');
  } else if (coreCardMode()) {
    setCoreCard(null);
    setChecked('chk_qhc10', false);
  }
  setChecked('chk_urban', false);
  showLayersTab();
  revealWardProjects(name);
}

/** Vào thẻ Khu vực trung tâm (QHC 1/10.000); đang ở phường khác thì về toàn thành phố trước */
export async function enterCore() {
  if (!isCity(state.selectedWard)) await selectWardDetail(CITY_NAME);
  closeProjectView();
  clearProjectFocus();
  if (!isSplitOn() && getViewMode() !== 'QH') setViewMode('QH');
  setChecked('chk_urban', false);
  setChecked('chk_qhc10', true);
  setCoreCard('full');
  fitCenter();
}

function onWardSelected(name) {
  closeProjectView();
  clearProjectFocus();
  if (isCity(name)) enterCity();
  else enterWard(name);
}

// Thoát thông tin đồ án: về phường đang chọn (hoặc toàn TP / thẻ Khu vực trung tâm), lô cả phường hiện lại
function onProjectExit() {
  clearProjectFocus();
  if (coreCardMode() && isCity(state.selectedWard)) {
    revealWardProjects(null);
    setCoreCard('full');
    fitCenter();
    return;
  }
  highlightWardBoundary(state.selectedWard, { fitView: true });
  revealWardProjects(isCity(state.selectedWard) ? null : state.selectedWard);
}

/** Phường dưới điểm bấm (khác phường đang chọn, đang nhìn rộng) → tên phường, không thì null */
export function wardToPick(latlng, m) {
  if (!m || m.getZoom() > WARD_PICK_MAX_ZOOM) return null;
  const name = latlng ? wardNameAt(latlng.lat, latlng.lng) : null;
  return name && name !== state.selectedWard ? name : null;
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
  document.addEventListener(WARD_SELECT_EVENT, (e) => onWardSelected(e.detail));
  document.addEventListener(PROJECT_VIEW_EXIT_EVENT, onProjectExit);
  document.addEventListener(CORE_NAV_EVENT, (e) => {
    if (e.detail?.to === 'core') enterCore();
    else selectWardDetail(CITY_NAME);
  });
  document.addEventListener(URBAN_PICK_EVENT, (e) => { if (CENTER_URBAN_IDS.has(e.detail)) enterCore(); });
  initProgress();
}
