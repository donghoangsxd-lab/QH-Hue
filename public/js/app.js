import { state, bumpDataVersion, BUFFER_COLORS, BUFFER_KEYS, ICON_GROUP_KEYS, infraLabels, isNetworkType, ntKindOf, NT_KIND_LABELS, parkTierOf } from './state.js';
import { applyTouchGroups, setTouchAlias } from './touchGroups.js';
import { geeApi, infraListUrl, markDataWritten } from './api.js';
import { setBootProgress } from './loadProgress.js';
import { withAssetVersion } from './gbaVersion.js';
import {
  initMap,
  map,
  toggleLayer,
  toggleBuffer,
  toggleMeasure,
  setMeasureListener,
  handleMeasureClick,
  consumeMeasureMapClick,
  renderGroupedPoints,
  refreshBuffers,
  refreshHeatmapOnly,
  setHeatOpacity,
  handleInspectPointClick,
  clearInspectResult,
  loadBoundaryLayer,
  ensurePopulationLayer,
  loadCadParcels,
  setParcelsVisible,
  flyToVisible,
  centerOnCity,
  infraClickAt,
  layers
} from './mapEngine.js';
import {
  toggleAuthModal,
  selectWardDetail,
  renderBottomPanel,
  ensureWardStats,
  reloadWardStats,
  toggleBottomPanelMaximized,
  setBottomPanelCollapsed,
  setBottomPanelMaximized,
  phoneBottomShell,
  toggleStatTable,
  exportBottomPanelPdf,
  initGoogleSignIn,
  initBottomPanelEvents,
  restoreAdminSession,
  signOutAdmin,
  startBackgroundCoverageFill
} from './uiComponents.js';
import {
  initPlanMap, planMap, planLayers, renderPlanBoundaries, toggleSplit, isSplitOn,
  getViewMode, getSplitKind, onViewChange, setViewMode, toggleViewMode, setSplitKind, isCompareOn
} from './planMap.js';
import { escapeHtml, setStatusContent, showToast, announceTool, announceFloat, FLOAT_OPEN_EVENT, TOOL_START_EVENT, RIGHT_TAB_EVENT, WARD_PICK_EVENT } from './utils.js';
import { initViewFlow, wardFromMapClick, detailClickLocked } from './viewFlow.js';
import { initMapLevel, getLevel, setLevel, DEFAULT_LEVEL } from './mapLevel.js';
import { initSplitPair } from './splitPair.js';
import { initQhc2045Layer, qhcClick } from './qhc2045Layer.js';
import { initChuyenNganh } from './chuyenNganh.js';
import { initChamDiem } from './chamDiemUi.js';
import { initQhctLayer } from './qhctLayer.js';
import { initCadImport } from './cadImportUi.js';
import { initEntryFlows } from './entryFlows.js';
import { initProjectLayer } from './projectLayer.js';
import { initProjectBrief } from './projectBrief.js';
import { initProjectReview } from './projectReview.js';
import { initLocalAdjust } from './localAdjust.js';
import { initAdjustLayer } from './adjustLayer.js';
import { initAdjustImport } from './adjustImport.js';
import { initWardCheck, refreshWardCheck } from './wardCheck.js';
import { initOsmImport } from './osmImport.js';
import { initParcelInfraImport } from './parcelInfraImport.js';
import { initLotEdit } from './lotEdit.js';
import { initWardRoads } from './wardRoads.js';
import { initCustomRoads, handleRoadDrawClick } from './customRoads.js';
import { initStreetView } from './streetView.js';
import { initMapContext } from './mapContext.js';
import { initView3d } from './view3dPanel.js';
import { initPopEdits, handlePopDrawClick } from './popEdits.js';
import { initRoadNetworkLayer } from './roadNetworkLayer.js';
import { initCadastreLayer, cadastreClick } from './cadastreLayer.js';
import { initGbaLayer, gbaFloorEditClick } from './gbaLayer.js';
import { handleBldgDrawClick } from './bldgDraw.js';
import { initLotBuildup } from './lotBuildup.js';
import { initLotOver } from './lotOver.js';
import { initViolateLayer } from './violateLayer.js';
import { initApartmentLayer } from './apartmentLayer.js';
import { initParcelInfra } from './parcelInfra.js';
import { initInvestLayer } from './investLayer.js';
import { initTerrainLayer } from './terrainLayer.js';
import { initTerrainProfile, syncTerrainProfile } from './terrainProfile.js';
import { initDrainageLayer } from './drainageLayer.js';
import { initBasinLayer } from './basinLayer.js';
import { initFloodSim } from './floodSim.js';
import { initSatLayers } from './satLayers.js';
import { initTreeLayer } from './treeLayer.js';
import { initOsmOpen } from './osmOpen.js';
import { initSketchLayer, handleSketchClick, consumeSketchMapClick } from './sketchLayer.js';
import { initFaqPanel } from './faqPanel.js';
import { exportMapA3 } from './printLayout.js';
import { initOverview } from './overview.js';
import { initMobileShell } from './mobileShell.js';
import { initRiskLayer } from './riskLayer.js';
import { initUrbanAreaLayer, refreshUrbanAreaLayer, urbanAreaReady } from './urbanAreaLayer.js';
import { initLayerDecisions } from './layerDecisions.js';
import { initBasemapUi } from './basemap.js';
import { hasSharedCamera, initViewLink } from './viewLink.js';
import { applyQhClassification } from './qhClass.js';
import { initQhReview } from './qhReview.js';
import { initReviewQueue } from './reviewQueue.js';
import { PROOF_FOCUS_EVENT } from './csdProof.js';

const CITY_NAME = "Thành phố Huế";

// Màu nút vùng phủ theo BUFFER_COLORS. Tên đầy đủ (infraLabels) chỉ gắn khi dòng chưa có chú thích QCVN.
function addTypeSwatches() {
  Object.entries(ICON_GROUP_KEYS).forEach(([type, key]) => {
    const label = document.querySelector(`label[for="chk_${key}"]`);
    if (label && !label.title && infraLabels[type]) label.title = infraLabels[type];
    document.querySelector(`.btn-dot-buffer[data-buffer="${BUFFER_KEYS[type]}"]`)
      ?.style.setProperty('--buf', BUFFER_COLORS[type]);
  });
}

// Không còn hàng tab Bản đồ nền / Bản đồ môi trường. Lớp nền nằm trong Hành chính, môi trường trong Hạ tầng kỹ thuật.
// Hàm giữ để markup cũ (nếu còn #layerMap) vẫn đổi pane; markup hiện tại không có nút đó.
function initLayerMapTabs() {
  const root = document.getElementById('layerMap');
  if (!root) return;
  const buttons = [...root.querySelectorAll('[data-map-tab]')];
  const show = (id) => {
    buttons.forEach(btn => {
      const on = btn.dataset.mapTab === id;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
    });
    root.querySelectorAll('[data-map-pane]').forEach(pane => { pane.hidden = pane.dataset.mapPane !== id; });
  };
  buttons.forEach(btn => btn.addEventListener('click', () => show(btn.dataset.mapTab)));
  const refreshCounts = () => buttons.forEach(btn => {
    const pane = root.querySelector(`[data-map-pane="${btn.dataset.mapTab}"]`);
    const badge = btn.querySelector('.layer-map-count');
    if (!badge || !pane) return;
    const n = pane.querySelectorAll('input[type="checkbox"]:checked:not([data-layer-sub])').length;
    badge.textContent = n ? String(n) : '';
  });
  root.addEventListener('change', refreshCounts);
  show('base');
  refreshCounts();
}
const MAIN_AXES = new Set(['hanhchinh', 'quyhoach', 'hatang', 'xahoi', 'kientruc']);

function initLayerMainTabs() {
  const root = document.getElementById('layerMain');
  if (!root) return;
  const tabs = [...root.querySelectorAll('[data-main-tab]')];
  const show = (id) => {
    tabs.forEach(btn => {
      const on = btn.dataset.mainTab === id;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
    });
    root.querySelectorAll('[data-main-pane]').forEach(pane => { pane.hidden = pane.dataset.mainPane !== id; });
    root.dataset.active = id;
  };
  tabs.forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.mainTab;
    show(id);
    if (btn.dataset.axisSync === '0') {
      delete btn.dataset.axisSync;
      return;
    }
    if (MAIN_AXES.has(id)) document.dispatchEvent(new CustomEvent('qh:axis-tab', { detail: { id } }));
  }));
  show(getLevel() === 'urban' ? 'hanhchinh' : 'quyhoach');
}

function initLayerGroups() {
  initLayerMainTabs();
  initLayerMapTabs();
}

const RADIUS_MIN = 50;
const RADIUS_MAX = 5000;
// Bán kính phục vụ theo QCVN 01:2026 (khớp config/constants.js standardRadius, máy chủ tính lại khi ghi Sheet):
// cấp đô thị và trường THPT 2 km; cấp đơn vị ở: phường ≤ 1 km (Mục 2.3.3.1), xã: trường, y tế, văn hóa, chợ ≤ 2 km (Mục 4.6.2.2);
// cây xanh theo diện tích (parkTierOf): vườn hoa 400 m, công viên khu vực ≥ 1 ha 800 m, công viên đô thị ≥ 5 ha 2 km; bãi đỗ xe 500 m
const URBAN_RADIUS = 2000;
const UNIT_DEFAULT_RADIUS = { "1-CV": 400, "2-BDX": 500, "3-MN": 1000, "4-TH": 1000, "5-THCS": 1000, "7-YT": 1000, "8-VH": 1000, "9-TM": 1000 };
const RURAL_UNIT_RADIUS = 2000;
const isThptName = (name) => /THPT|TRUNG HOC PHO THONG/.test(String(name || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/Đ/g, 'D'));
// Mạng lưới: trạm xe buýt 500 m đi bộ (Mục 2.8.3.3), PCCC 3 km phường / 5 km xã (Mục 2.5.13.1), nghĩa trang theo Bảng 23
const NO_AREA_TYPES = ["13-BUS", "10-PCCC"];
const NT_SAFETY = { funeral: 0, crematorium: 500, cemetery_cat: 100, cemetery_once: 500, cemetery_hung: 1000 };
function networkRadius(type, ward, name) {
  if (type === '13-BUS') return 500;
  if (type === '10-PCCC') return /^xã\s/i.test(String(ward || '').trim()) ? 5000 : 3000;
  if (type === '14-NOXH') return 0;
  return NT_SAFETY[ntKindOf({ name })];
}
function qcvnRadius(type, nhomHaTang, ward, name, size) {
  if (isNetworkType(type)) return networkRadius(type, ward, name);
  if (type === '1-CV') return parkTierOf(size, nhomHaTang).radius;
  if (type === '6-THPT') return URBAN_RADIUS;
  if (!UNIT_DEFAULT_RADIUS[type]) return null;
  if (nhomHaTang === 'Cấp đô thị' || (type === '4-TH' && isThptName(name))) return URBAN_RADIUS;
  return /^xã\s/i.test(String(ward || '').trim()) && !["1-CV", "2-BDX"].includes(type) ? RURAL_UNIT_RADIUS : UNIT_DEFAULT_RADIUS[type];
}

const POINT_IDS = {
  new: { type: 'newType', nhom: 'newNhomHaTang', name: 'newName', lat: 'newLat', lng: 'newLng', ward: 'newWard', size: 'newSize', phase: 'newPhase', radius: 'newRadius' },
  kt: { type: 'ktType', nhom: 'ktNhomHaTang', name: 'ktName', lat: 'ktLat', lng: 'ktLng', ward: 'ktWard', size: 'ktSize', phase: 'ktPhase', radius: 'ktRadius' }
};

function pointIds(prefix) {
  return POINT_IDS[prefix] || POINT_IDS.new;
}

function pointStatus(prefix, text, color) {
  if (prefix !== 'kt') {
    setStatus(text, color);
    return;
  }
  const el = document.getElementById('ktStatus');
  if (!el) return;
  el.style.color = color || '';
  el.textContent = text;
}

export function updateRadiusPreview(prefix = 'new') {
  const ids = pointIds(prefix);
  const out = document.getElementById(ids.radius);
  if (!out) return;
  const type = document.getElementById(ids.type)?.value;
  const nhom = document.getElementById(ids.nhom)?.value;
  const ward = document.getElementById(ids.ward)?.value || '';
  const name = document.getElementById(ids.name)?.value;
  const size = Number(document.getElementById(ids.size)?.value) || 0;
  const r = qcvnRadius(type, nhom, ward, name, size);
  const nhomEl = document.getElementById(ids.nhom);
  if (nhomEl) nhomEl.disabled = isNetworkType(type);
  if (type === '11-NT') {
    const kind = ntKindOf({ name });
    out.innerHTML = r
      ? `<b>${r.toLocaleString('vi-VN')} m</b> <small>(khoảng cách an toàn Bảng 23: ${NT_KIND_LABELS[kind].toLowerCase()})</small>`
      : `<small>Nhà tang lễ: không quy định khoảng cách an toàn. Tên ghi rõ "cát táng" / "chôn cất một lần" / "hỏa táng" để áp đúng khoảng cách</small>`;
    return;
  }
  if (type === '14-NOXH') {
    out.innerHTML = '<small>Chung cư: không có bán kính phục vụ, chỉ thể hiện vị trí và diện tích</small>';
    return;
  }
  if (isNetworkType(type)) {
    const area = !ward ? 'chưa xác định phường/xã' : /^xã\s/i.test(ward.trim()) ? 'xã' : 'phường';
    out.innerHTML = `<b>${r.toLocaleString('vi-VN')} m</b> <small>(${type === '13-BUS' ? 'phạm vi đi bộ tới trạm' : `bán kính phục vụ PCCC, ${area}`})</small>`;
    return;
  }
  if (!r) {
    out.textContent = type === '12-CSD' ? 'Không áp dụng (cơ sở chưa sử dụng)' : '—';
    return;
  }
  if (type === '1-CV') {
    const tier = parkTierOf(size, nhom);
    const group = tier.urban ? 'cây xanh đô thị' : 'cây xanh đơn vị ở';
    out.innerHTML = `<b>${r.toLocaleString('vi-VN')} m</b> <small>(${tier.label}, ${group}${size > 0 ? '' : ' — nhập diện tích để xếp hạng: < 1 ha vườn hoa, ≥ 1 ha công viên khu vực, ≥ 5 ha công viên đô thị'})</small>`;
    return;
  }
  const scope = type === '4-TH' && isThptName(name) ? 'trường THPT, cấp đô thị' : nhom === 'Cấp đô thị' ? 'cấp đô thị' : 'cấp đơn vị ở';
  const area = !ward ? 'chưa xác định phường/xã' : /^xã\s/i.test(ward.trim()) ? 'xã' : 'phường';
  out.innerHTML = `<b>${r.toLocaleString('vi-VN')} m</b> <small>(${scope}, ${area})</small>`;
}

function setStatus(text, color) {
  const el = document.getElementById('statusMsg');
  if (!el) return;
  el.style.color = color;
  setStatusContent(el, text);
}

let pointSubmitting = false;
export async function submitInfraPoint(prefix, extra = {}) {
  if (pointSubmitting) return;
  const ids = pointIds(prefix);
  const arch = prefix === 'kt';
  const type = document.getElementById(ids.type)?.value;
  const nhomHaTang = document.getElementById(ids.nhom)?.value || 'Cấp đơn vị ở';
  const name = (document.getElementById(ids.name)?.value || '').trim();
  const lat = Number(document.getElementById(ids.lat)?.value);
  const lng = Number(document.getElementById(ids.lng)?.value);
  const size = Number(document.getElementById(ids.size)?.value || 0);
  const phase = document.getElementById(ids.phase)?.value === 'QH' ? 'QH' : 'HT';

  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || !document.getElementById(ids.lat)?.value) {
    pointStatus(prefix, 'Vui lòng nhập đủ tên và tọa độ hợp lệ.', 'var(--accent-red)');
    return;
  }
  if (!Number.isFinite(size) || size < 0) {
    pointStatus(prefix, 'Diện tích không hợp lệ.', 'var(--accent-red)');
    return;
  }
  if (phase === 'QH' && !(size > 0) && !NO_AREA_TYPES.includes(type)) {
    pointStatus(prefix, 'Điểm quy hoạch mới cần diện tích lớn hơn 0 m².', 'var(--accent-red)');
    return;
  }

  pointSubmitting = true;
  pointStatus(prefix, arch ? 'Đang gửi công trình.' : 'Đang gửi đề xuất.', 'var(--accent-orange)');
  try {
    const body = { type, nhomHaTang, name, lat, lng, size, phase };
    if (arch && extra.fields) Object.assign(body, extra.fields);
    if (!arch) markDataWritten();
    const headers = { 'Content-Type': 'application/json' };
    if (arch && state.authToken) headers.Authorization = `Bearer ${state.authToken}`;
    const res = await fetch(geeApi(`action=${arch ? 'addKienTruc' : 'addPoint'}`), {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      pointStatus(prefix, data.message || `Không gửi được (mã ${res.status}).`, 'var(--accent-red)');
      return;
    }
    const radiusNote = data.radius ? `, bán kính ${Number(data.radius).toLocaleString('vi-VN')} m theo QCVN 01:2026` : '';
    pointStatus(
      prefix,
      arch
        ? (data.staged
          ? `Đã gửi hàng chờ duyệt${data.id ? ` (mã ${data.id.slice(0, 8)}…)` : ''}. Chưa hiện trên bản đồ.`
          : `Đã lưu công trình${data.id ? ` (mã ${data.id})` : ''}${radiusNote}.`)
        : `Đã lưu đề xuất${data.id ? ` (mã ${data.id})` : ''}${radiusNote}, chờ quản trị phê duyệt.`,
      'var(--accent-green)'
    );
    [ids.name, ids.lat, ids.lng, ids.ward, ids.size].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    if (arch) {
      ['ktLinkAnh', 'ktLink3d'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    }
    updateRadiusPreview(prefix);
    if (arch) return;

    try {
      await loadInfraData();
    } catch (err) {
      const newItem = {
        id: data.id || `${type === '6-THPT' ? 'THPT' : 'NEW'}-${Date.now()}`,
        name, ward: data.ward || '', type: type === '6-THPT' ? '4-TH' : type, nhomHaTang, lat, lng,
        size: phase === 'QH' ? 0 : size,
        radius: data.radius ?? qcvnRadius(type, nhomHaTang, data.ward, name, size) ?? 500,
        sizeHT: phase === 'QH' ? null : size,
        sizeQH: phase === 'QH' ? size : null,
        planChange: phase === 'QH' ? 'new' : 'relocate',
        status: false
      };
      if (phase === 'QH') state.planDataList.push(newItem);
      else state.rawDataList.push(newItem);
      bumpDataVersion();
    }
    renderGroupedPoints();
    if (state.wardStatsData.length) reloadWardStats();
  } catch (err) {
    pointStatus(prefix, 'Không kết nối được máy chủ.', 'var(--accent-red)');
  } finally {
    pointSubmitting = false;
  }
}

// Thanh tiêu đề gộp một dòng giới thiệu, đóng được. Chọn lớp ở panel phải (mapLevel.js).
// Nút lật trang (biểu tượng bên trái) Quy hoạch ⇄ Hiện trạng; chia đôi thì chọn cùng tâm / lệch tâm.
// Lớp đồ án QHPK theo lớp đang chọn: đang xem QHPK thì lật sang hiện trạng tắt, lật về quy hoạch bật lại.
const VIEW_TITLES = {
  QH: 'BẢN ĐỒ QUY HOẠCH THÀNH PHỐ HUẾ',
  HT: 'BẢN ĐỒ HIỆN TRẠNG THÀNH PHỐ HUẾ',
  split: 'SO SÁNH HIỆN TRẠNG – QUY HOẠCH THÀNH PHỐ HUẾ'
};
const TITLE_OFF_KEY = 'qhhue_title_off';
function initMapTitle() {
  const root = document.getElementById('mapTitle');
  if (!root) return;
  const titleOff = () => {
    try { return localStorage.getItem(TITLE_OFF_KEY) === '1'; } catch { return false; }
  };
  // CSS giữ hộp trong khoảng panel trái và cột nút phải. Không ghi left/width/maxWidth:
  // fitTitle cũ đo cột nút như mép trái và panel như mép phải, nên co hộp và nhảy giữa màn hình.
  const syncTitleBox = () => {
    const off = titleOff();
    document.documentElement.classList.toggle('title-dismissed', off);
    const launch = document.getElementById('btnOverview');
    if (launch) launch.hidden = false;
    if (off) {
      document.documentElement.style.setProperty('--title-h', '8px');
      return;
    }
    const h = root.offsetHeight;
    if (h > 8) document.documentElement.style.setProperty('--title-h', `${Math.ceil(h)}px`);
  };
  const text = document.getElementById('mapTitleText');
  const flip = document.getElementById('btnFlipView');
  const setProjects = (on) => {
    const chk = document.getElementById('chk_projects');
    if (!chk || chk.checked === on || getLevel() !== 'qhpk') return;
    chk.checked = on;
    chk.dispatchEvent(new Event('change', { bubbles: true }));
  };
  let last = null;
  const paint = ({ view, split, kind }) => {
    const key = split ? 'split' : view;
    root.dataset.view = key;
    const title = VIEW_TITLES[key];
    if (text) {
      text.textContent = title;
      text.title = title;
    }
    syncTitleBox();
    if (flip) {
      flip.title = split ? 'Đang so sánh hai bản đồ' : `Lật sang bản đồ ${view === 'QH' ? 'hiện trạng' : 'quy hoạch'}`;
      flip.setAttribute('aria-label', flip.title);
      flip.disabled = split;
    }
    root.querySelectorAll('[data-split-kind]').forEach(btn => {
      const on = btn.dataset.splitKind === kind;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', String(on));
    });
    if (key === last) return;
    const first = last === null;
    if (!first) {
      root.classList.remove('flipping');
      void root.offsetWidth;
      root.classList.add('flipping');
    }
    last = key;
    if (!first) setProjects(key !== 'HT');
  };
  root.addEventListener('animationend', () => root.classList.remove('flipping'));
  onViewChange(paint);
  flip?.addEventListener('click', toggleViewMode);
  root.querySelectorAll('[data-split-kind]').forEach(btn => btn.addEventListener('click', () => setSplitKind(btn.dataset.splitKind)));
  paint({ view: getViewMode(), split: isSplitOn(), kind: getSplitKind() });
  document.getElementById('btnTitleDismiss')?.addEventListener('click', () => {
    try { localStorage.setItem(TITLE_OFF_KEY, '1'); } catch { /* chế độ riêng tư */ }
    syncTitleBox();
  });
  document.addEventListener('qh-title-restore', () => {
    try { localStorage.removeItem(TITLE_OFF_KEY); } catch { /* chế độ riêng tư */ }
    syncTitleBox();
  });
  syncTitleBox();
  window.addEventListener('resize', syncTitleBox);
  new MutationObserver(syncTitleBox).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

async function loadTouchGroups() {
  try {
    const res = await fetch('data/infra-touch-groups.json');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.groups) ? data.groups : [];
  } catch (err) {
    console.warn('Không đọc được nhóm lô chạm ranh:', err);
    return [];
  }
}

function withMergedRadius(list, qh) {
  return list.map(it => {
    if (!it.touchIds || it.type !== '1-CV') return it;
    const size = qh ? (Number(it.sizeQH) || 0) : (Number(it.sizeHT) || Number(it.size) || 0);
    if (!(size > 0)) return it;
    return { ...it, radius: parkTierOf(size, it.nhomHaTang).radius };
  });
}

async function loadInfraData() {
  const [res, groups] = await Promise.all([fetch(infraListUrl()), loadTouchGroups()]);
  if (!res.ok) throw new Error(`Lỗi máy chủ (${res.status})`);
  const data = await res.json();
  let raw = data.rawDataList || [];
  let plan = data.planDataList || [];
  // Máy chủ mới đã gắn qhApplied. Bản cũ: tự đưa lô da_co sang hiện trạng từ file phân loại.
  if (!data.qhApplied) {
    try {
      const pack = await fetch(withAssetVersion('data/gba/qh-hientrang.json')).then(r => (r.ok ? r.json() : null));
      if (pack) {
        const applied = applyQhClassification(raw, plan, pack);
        raw = applied.raw;
        plan = applied.plan;
      }
    } catch (err) {
      console.warn('Không áp được phân loại lô QH:', err);
    }
  }
  setTouchAlias(groups);
  raw = withMergedRadius(applyTouchGroups(raw, groups), false);
  plan = withMergedRadius(applyTouchGroups(plan, groups), true);
  state.rawDataList = raw;
  state.planDataList = plan;
  bumpDataVersion();
}

// Chọn địa bàn từ droplist hoặc bấm bản đồ (đổi lớp theo viewFlow.js qua selectWardDetail)
async function chooseWard(wardName) {
  if (state.rawDataList.length === 0) {
    try {
      await loadInfraData();
    } catch (err) {
      console.error("Lỗi tải dữ liệu điểm hạ tầng:", err);
      showToast('Không tải được dữ liệu công trình.', 'error');
      return;
    }
  }
  await selectWardDetail(wardName);
}

// Vuốt panel dưới trên điện thoại: lên = toàn màn hình, xuống = thu gọn. Kéo ngắn vẫn là cú bấm.
function bindPhoneBottomSwipe() {
  const panel = document.getElementById('bottomPanel');
  const THRESH = 48;
  const bind = (el, dir) => {
    if (!el) return;
    let dx = 0;
    let dy = 0;
    let handled = false;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !phoneBottomShell()) return;
      dx = 0;
      dy = 0;
      handled = false;
      const x0 = e.clientX;
      const y0 = e.clientY;
      const move = (ev) => {
        dx = ev.clientX - x0;
        dy = ev.clientY - y0;
        if (!panel || document.body.classList.contains('bottom-collapsed')) return;
        if (dy > 4 && Math.abs(dy) > Math.abs(dx)) {
          panel.style.transition = 'none';
          panel.style.transform = `translateY(${dy}px)`;
        }
      };
      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        if (panel) {
          panel.style.transition = '';
          panel.style.transform = '';
        }
        if (!phoneBottomShell()) return;
        if (dir === 'up' && dy < -THRESH) {
          setBottomPanelCollapsed(false);
          handled = true;
        } else if (dir === 'down' && dy > THRESH && dy > Math.abs(dx)) {
          setBottomPanelCollapsed(true);
          handled = true;
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
    el.addEventListener('click', (e) => {
      if (!handled) return;
      e.preventDefault();
      e.stopPropagation();
      handled = false;
    }, true);
  };
  bind(document.getElementById('btnExpandBottomPanel'), 'up');
  bind(document.getElementById('btnBottomGrab'), 'down');
  bind(document.getElementById('bpPhonePager'), 'down');
  document.getElementById('btnBottomGrab')?.addEventListener('click', () => {
    if (phoneBottomShell()) setBottomPanelCollapsed(true);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  initGoogleSignIn();
  const map = initMap();

  const mapEl = document.getElementById('map');
  if (mapEl && window.ResizeObserver) {
    new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(mapEl);
  }

  // Mở trang: panel phải và panel dưới ẩn sẵn (class trên <body>), bản đồ toàn TP
  initPlanMap(map, layers);
  if (!hasSharedCamera()) centerOnCity();
  initBottomPanelEvents();
  initViewFlow();
  initMapLevel();
  // Sau khi máy chủ ghi Sheet (nhập file, ghi dấu nhắc phường): tải lại dữ liệu và làm mới bản đồ, bảng
  const reloadAfterSheetWrite = async () => {
    try { await loadInfraData(); } catch (err) { showToast('Chưa tải lại được dữ liệu. Vui lòng tải lại trang sau ít phút.', 'error'); return; }
    renderGroupedPoints();
    loadCadParcels();
    refreshHeatmapOnly();
    if (state.wardStatsData.length) reloadWardStats();
    refreshWardCheck();
  };
  initCadImport({ onImported: reloadAfterSheetWrite });
  initEntryFlows({ submitInfraPoint, updateRadiusPreview });
  initProjectLayer({ onDeleted: reloadAfterSheetWrite });
  initProjectBrief();
  initProjectReview();
  initLocalAdjust();
  initAdjustLayer();
  initAdjustImport();
  initWardCheck({ onSynced: reloadAfterSheetWrite });
  initOsmImport({ onImported: reloadAfterSheetWrite });
  initParcelInfraImport({ onImported: reloadAfterSheetWrite });
  initLotEdit({ onInfraSaved: reloadAfterSheetWrite });
  initWardRoads();
  initCustomRoads();
  initPopEdits();
  initQhReview({ onChanged: reloadAfterSheetWrite });
  initReviewQueue();
  initRoadNetworkLayer();
  initCadastreLayer();
  initGbaLayer();
  initLotBuildup();
  initLotOver();
  initViolateLayer();
  initApartmentLayer();
  initParcelInfra();
  initInvestLayer();
  initUrbanAreaLayer();
  initLayerDecisions();
  initQhc2045Layer();
  initQhctLayer();
  document.addEventListener(WARD_PICK_EVENT, (e) => chooseWard(e.detail));
  initBasemapUi();
  initTerrainLayer();
  initTerrainProfile([map, planMap]);
  setMeasureListener(syncTerrainProfile);
  initDrainageLayer();
  initBasinLayer();
  initFloodSim();
  initSatLayers();
  initTreeLayer();
  initOsmOpen(map, planMap);
  initRiskLayer();
  initSketchLayer();
  initFaqPanel();
  initOverview();
  initMobileShell();
  restoreAdminSession();
  document.getElementById('btnToggleCompare')?.addEventListener('click', toggleSplit);
  initMapTitle();
  initSplitPair(map);

  // ---------- Click bản đồ: dùng chung cho nửa trái (hiện trạng) và nửa phải (quy hoạch) khi so sánh ----------
  let pickSeq = 0;
  const pickCoordinate = (latlng) => {
    const lat = latlng.lat.toFixed(6);
    const lng = latlng.lng.toFixed(6);
    const seq = ++pickSeq;
    const prefix = state.pickTarget === 'kientruc' ? 'kt' : 'new';
    const ids = pointIds(prefix);
    const inputLat = document.getElementById(ids.lat);
    const inputLng = document.getElementById(ids.lng);
    if (inputLat) inputLat.value = lat;
    if (inputLng) inputLng.value = lng;
    pointStatus(prefix, "Đang tra cứu địa bàn...", "var(--accent-orange)");

    fetch(geeApi(`action=getWardFromPoint&lat=${lat}&lng=${lng}`))
      .then(r => (r.ok ? r.json() : {}))
      .then(res => {
        if (seq !== pickSeq) return;
        const wardName = res.ward || "";
        const inputWard = document.getElementById(ids.ward);
        if (inputWard) inputWard.value = wardName;
        updateRadiusPreview(prefix);
        pointStatus(
          prefix,
          wardName ? `Thuộc địa bàn: ${wardName}` : "Vị trí nằm ngoài ranh giới 40 phường/xã",
          wardName ? "var(--accent-green)" : "var(--accent-orange)"
        );
      })
      .catch(() => { if (seq === pickSeq) pointStatus(prefix, "Đã ghim tọa độ (chưa tra cứu được địa bàn)", "var(--accent-orange)"); });
    state.isPickMode = false;
  };

  const handleMapClick = async (e, targetMap) => {
    if (consumeSketchMapClick(e)) return;
    if (consumeMeasureMapClick(e)) return;
    // Vẽ tuyến / vùng dân cư chỉ có trên bản đồ hiện trạng. Phác thảo ghi lên bản đồ đang xem.
    if (state.adminDrawMode && targetMap !== map && !isSplitOn()) {
      setViewMode('HT');
      showToast(state.adminDrawMode === 'bldg'
        ? 'Vẽ dấu chân nhà thực hiện trên bản đồ hiện trạng: đã lật sang bản đồ hiện trạng'
        : 'Vẽ tuyến / vùng dân cư thực hiện trên bản đồ hiện trạng: đã lật sang bản đồ hiện trạng', 'info');
      targetMap = map;
    }
    if (state.sketchTool) {
      handleSketchClick(e.latlng, targetMap);
      return;
    }
    if (state.adminDrawMode) {
      if (targetMap !== map) return;
      if (state.adminDrawMode === 'road') handleRoadDrawClick(e.latlng);
      else if (state.adminDrawMode === 'bldg') handleBldgDrawClick(e.latlng);
      else handlePopDrawClick(e.latlng);
      return;
    }
    if (state.isPickMode) {
      pickCoordinate(e.latlng);
      return;
    }
    if (state.activeMeasureType) {
      handleMeasureClick(e.latlng, targetMap);
      return;
    }
    if (await gbaFloorEditClick(e, targetMap)) return;
    // Thứ tự ưu tiên khi bấm: tem công trình > thửa hiện trạng (lớp thửa bật) > lô quy hoạch > phường (cuối cùng).
    // Lô tự bắt click (không nổi lên bản đồ); lớp thửa giành popup lô trong cadastreLayer.onPopupOpen
    const detailLocked = detailClickLocked(targetMap);
    if (!detailLocked && infraClickAt(e, targetMap)) return;
    if (state.isInspectMode) {
      if (nearPanelClick) return;
      handleInspectPointClick(e.latlng.lat, e.latlng.lng, targetMap);
      return;
    }
    if (!detailLocked && cadastreClick(e, targetMap)) return;
    // Click vừa mở popup của điểm / lô (sự kiện nổi lên bản đồ) thì không đổi phường (đổi phường sẽ đóng popup)
    if (performance.now() - popupAt < 300) return;
    if (!detailLocked && qhcClick(e, targetMap)) return;
    // Bấm nền: chọn phường hay không do lớp quy hoạch đang xem quyết định (viewFlow.js)
    const ward = wardFromMapClick(e.latlng, targetMap);
    if (ward) chooseWard(ward);
  };
  let popupAt = 0;
  [map, planMap].forEach(m => m?.on('popupopen', () => { popupAt = performance.now(); }));
  // Chế độ tra cứu: click trúng / sát mép các bảng đang mở (bấm hụt nút ×, bảng vừa nở ra khi nạp xong kết quả…)
  // chỉ đóng popup như thường, không tra cứu điểm mới. Đo ở preclick vì popup bị đóng ngay trong preclick.
  const PANEL_GUARDS = [['.leaflet-popup', 24], ['.leaflet-control, .map-toolbar, .ov-launch, .right-panel, .bottom-panel, .cad-card', 10]];
  let nearPanelClick = false;
  const isNearPanel = (ev) => {
    if (!ev || ev.clientX == null) return false;
    return PANEL_GUARDS.some(([sel, pad]) => [...document.querySelectorAll(sel)].some(el => {
      if (getComputedStyle(el).pointerEvents === 'none') return false;   // panel đang thu gọn (trong suốt)
      const r = el.getBoundingClientRect();
      return r.width > 0 && ev.clientX >= r.left - pad && ev.clientX <= r.right + pad
        && ev.clientY >= r.top - pad && ev.clientY <= r.bottom + pad;
    }));
  };
  [map, planMap].forEach(m => m?.on('preclick', (e) => {
    nearPanelClick = state.isInspectMode && isNearPanel(e.originalEvent);
  }));
  map.on('click', (e) => handleMapClick(e, map));
  planMap?.on('click', (e) => handleMapClick(e, planMap));
  initStreetView();
  initMapContext([map, planMap]);
  initView3d([map, planMap]);

  document.getElementById('btnMeasureDist')?.addEventListener('click', () => toggleMeasure('distance'));
  document.getElementById('btnMeasureArea')?.addEventListener('click', () => toggleMeasure('area'));
  initPhoneToolMenus();

  function initPhoneToolMenus() {
    const menus = [
      { btn: 'btnMeasurePick', menu: 'measureChooser', target: { distance: 'btnMeasureDist', area: 'btnMeasureArea' } },
      { btn: 'btnInspectPick', menu: 'inspectChooser', target: { point: 'btnInspectMode', gps: 'btnLocateGPS' } }
    ];
    const closeAll = () => menus.forEach(m => {
      const menu = document.getElementById(m.menu);
      const btn = document.getElementById(m.btn);
      if (menu) menu.hidden = true;
      btn?.setAttribute('aria-expanded', 'false');
    });
    menus.forEach(m => {
      const btn = document.getElementById(m.btn);
      const menu = document.getElementById(m.menu);
      if (!btn || !menu) return;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = menu.hidden;
        closeAll();
        if (!willOpen) return;
        if (m.menu === 'measureChooser') {
          menu.querySelectorAll('[data-tb-value]').forEach(el => {
            el.setAttribute('aria-checked', String(el.dataset.tbValue === state.activeMeasureType));
          });
        }
        menu.hidden = false;
        const r = btn.getBoundingClientRect();
        const top = Math.max(4, Math.min(r.top, window.innerHeight - menu.offsetHeight - 4));
        menu.style.left = `${Math.round(r.right + 6)}px`;
        menu.style.top = `${Math.round(top)}px`;
        btn.setAttribute('aria-expanded', 'true');
      });
      menu.addEventListener('click', (e) => {
        const item = e.target.closest('[data-tb-value]');
        if (!item) return;
        e.stopPropagation();
        closeAll();
        document.getElementById(m.target[item.dataset.tbValue])?.click();
      });
    });
    document.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.tb-phone-pick')) return;
      closeAll();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
  }
  document.getElementById('btnMeasureProfile')?.addEventListener('click', () => toggleMeasure('profile'));
  document.getElementById('btnCloseProfile')?.addEventListener('click', () => {
    if (state.activeMeasureType === 'profile') toggleMeasure('profile');
  });

  const btnInspectMode = document.getElementById('btnInspectMode');
  const planEl = document.getElementById('mapPlan');
  const setInspectMode = (on) => {
    if (on && !state.isInspectMode) announceTool('inspect');
    state.isInspectMode = on;
    btnInspectMode?.classList.toggle('active', on);
    if (btnInspectMode) {
      btnInspectMode.setAttribute('aria-pressed', String(on));
      btnInspectMode.title = on
        ? "Đang bật tra cứu (bấm để tắt)"
        : "Bật chế độ tra cứu: click lên bản đồ để xem hạ tầng tiếp cận tại vị trí";
    }
    const btnInspectPick = document.getElementById('btnInspectPick');
    btnInspectPick?.classList.toggle('active', on);
    btnInspectPick?.setAttribute('aria-pressed', String(on));
    mapEl?.classList.toggle('inspect-mode', on);
    planEl?.classList.toggle('inspect-mode', on);
    if (on) state.isPickMode = false;
    else clearInspectResult();
  };
  btnInspectMode?.addEventListener('click', () => setInspectMode(!state.isInspectMode));
  document.addEventListener(TOOL_START_EVENT, (e) => {
    if (e.detail !== 'inspect' && state.isInspectMode) setInspectMode(false);
    if (e.detail !== 'pick') state.isPickMode = false;
  });

  // ---------- Panel phải, khung Đề xuất ----------
  const setRightPanelCollapsed = (collapsed) => {
    document.body.classList.toggle('right-collapsed', collapsed);
  };
  // Điện thoại: bảng đồ án / một lô vào panel, danh sách trục nhường chỗ, chỉ còn Chú giải.
  const PHONE_INFO = window.matchMedia('(max-width: 840px), ((pointer: coarse) and (max-height: 560px) and (max-width: 1400px))');
  const phoneInfoSeen = new WeakSet();
  let phoneInfoOn = false;
  let panelBeforePhoneInfo = false;
  let dockBeforePhoneInfo = null;
  const phoneInfoOpen = (id) => {
    const el = document.getElementById(id);
    return !!(el && !el.hidden);
  };
  const parkPhoneInfo = (el) => {
    const host = document.getElementById('mapArea');
    if (el && host && el.parentElement !== host) host.appendChild(el);
  };
  const syncPhoneInfoDock = () => {
    const brief = document.getElementById('projectBrief');
    const lot = document.getElementById('cadParcelCard');
    const slot = document.getElementById('phoneInfoSlot');
    const on = PHONE_INFO.matches && (phoneInfoOpen('projectBrief') || phoneInfoOpen('cadParcelCard'));
    if (on && slot) {
      if (!phoneInfoOn) {
        phoneInfoOn = true;
        panelBeforePhoneInfo = document.body.classList.contains('right-collapsed');
        const frame = document.getElementById('tabLegend');
        dockBeforePhoneInfo = frame?.dataset.dock || 'legend';
        setRightPanelCollapsed(false);
        document.getElementById('rpDock')?.classList.remove('is-collapsed');
        const collapseBtn = document.getElementById('btnDockCollapse');
        if (collapseBtn) {
          collapseBtn.setAttribute('aria-expanded', 'true');
          collapseBtn.querySelector('use')?.setAttribute('href', '#i-chev-down');
        }
        if (frame) frame.dataset.dock = 'legend';
        document.dispatchEvent(new CustomEvent('qh:legend-sync'));
      }
      document.body.classList.add('phone-info-dock');
      slot.hidden = false;
      if (brief && !brief.hidden) {
        if (brief.parentElement !== slot) slot.appendChild(brief);
      } else parkPhoneInfo(brief);
      if (lot && !lot.hidden) {
        if (lot.parentElement !== slot) slot.appendChild(lot);
      } else parkPhoneInfo(lot);
      return;
    }
    if (!phoneInfoOn && !document.body.classList.contains('phone-info-dock')) return;
    phoneInfoOn = false;
    document.body.classList.remove('phone-info-dock');
    if (slot) slot.hidden = true;
    parkPhoneInfo(brief);
    parkPhoneInfo(lot);
    const frame = document.getElementById('tabLegend');
    if (frame && dockBeforePhoneInfo) frame.dataset.dock = dockBeforePhoneInfo;
    dockBeforePhoneInfo = null;
    document.dispatchEvent(new CustomEvent('qh:legend-sync'));
    setRightPanelCollapsed(panelBeforePhoneInfo);
  };
  const watchPhoneInfo = (el) => {
    if (!el || phoneInfoSeen.has(el)) return;
    phoneInfoSeen.add(el);
    new MutationObserver(syncPhoneInfoDock).observe(el, { attributes: true, attributeFilter: ['hidden'] });
  };
  const mapHost = document.getElementById('mapArea');
  if (mapHost) {
    new MutationObserver(() => {
      watchPhoneInfo(document.getElementById('projectBrief'));
      watchPhoneInfo(document.getElementById('cadParcelCard'));
      syncPhoneInfoDock();
    }).observe(mapHost, { childList: true });
    watchPhoneInfo(document.getElementById('projectBrief'));
    watchPhoneInfo(document.getElementById('cadParcelCard'));
  }
  PHONE_INFO.addEventListener('change', syncPhoneInfoDock);
  const proposeBtn = document.getElementById('btnPropose');
  const setPropose = (on) => {
    const sheet = document.getElementById('tabAdd');
    if (!sheet) return;
    sheet.hidden = !on;
    proposeBtn?.classList.toggle('active', on);
    proposeBtn?.setAttribute('aria-pressed', String(on));
    if (on) announceFloat('propose');
    else state.isPickMode = false;
  };
  document.addEventListener(FLOAT_OPEN_EVENT, (e) => {
    const sheet = document.getElementById('tabAdd');
    if (e.detail !== 'propose' && sheet && !sheet.hidden) setPropose(false);
  });
  const showRightTab = (tabId, open = true) => {
    if (tabId === 'tabAdd') {
      setPropose(open !== false);
      return;
    }
    if (tabId === 'tabLegend') {
      const frame = document.getElementById('tabLegend');
      if (frame && open !== false) delete frame.dataset.userHide;
      document.dispatchEvent(new CustomEvent('qh:legend-sync'));
      return;
    }
    if (open) setRightPanelCollapsed(false);
  };
  proposeBtn?.addEventListener('click', () => {
    const sheet = document.getElementById('tabAdd');
    setPropose(!!sheet?.hidden);
  });
  document.getElementById('btnProposeClose')?.addEventListener('click', () => setPropose(false));
  document.addEventListener(RIGHT_TAB_EVENT, (e) => {
    const { tab, open } = e.detail || {};
    if (tab) showRightTab(tab, open !== false);
  });

  document.getElementById('btnCollapseRightPanel')?.addEventListener('click', () => setRightPanelCollapsed(true));
  const sheetHandle = document.getElementById('btnSheetHandle');
  if (sheetHandle) {
    let sheetDrag = 0;
    sheetHandle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      sheetDrag = 0;
      const y0 = e.clientY;
      const panel = document.getElementById('rightPanel');
      const move = (ev) => {
        const dy = Math.max(0, ev.clientY - y0);
        sheetDrag = dy;
        if (panel) panel.style.transform = dy ? `translateY(${dy}px)` : '';
      };
      const up = () => {
        if (panel) panel.style.transform = '';
        if (sheetDrag > 48) setRightPanelCollapsed(true);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
    sheetHandle.addEventListener('click', () => {
      if (sheetDrag > 8) { sheetDrag = 0; return; }
      setRightPanelCollapsed(true);
    });
  }

  document.getElementById('btnToggleBottomMax')?.addEventListener('click', toggleBottomPanelMaximized);
  document.getElementById('btnCollapseBottomPanel')?.addEventListener('click', () => setBottomPanelCollapsed(true));
  bindPhoneBottomSwipe();
  const markBpPage = (index) => {
    document.querySelectorAll('#bpPhonePager button').forEach(b => {
      b.classList.toggle('is-on', Number(b.dataset.bpPage) === index);
    });
  };
  document.getElementById('bpPhonePager')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-bp-page]');
    if (!btn) return;
    const body = document.getElementById('bpBody');
    const part = body?.querySelectorAll('.bp-part')[Number(btn.dataset.bpPage)];
    part?.scrollIntoView({ inline: 'start', block: 'nearest', behavior: 'auto' });
    markBpPage(Number(btn.dataset.bpPage));
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  });
  document.getElementById('bpBody')?.addEventListener('scroll', () => {
    const body = document.getElementById('bpBody');
    if (!body || body.clientWidth < 1) return;
    markBpPage(Math.round(body.scrollLeft / body.clientWidth));
  }, { passive: true });
  document.getElementById('btnExpandBottomPanel')?.addEventListener('click', () => setBottomPanelCollapsed(false));
  const phoneBottomMq = window.matchMedia('(max-width: 840px), ((pointer: coarse) and (max-height: 560px) and (max-width: 1400px))');
  phoneBottomMq.addEventListener('change', () => {
    if (phoneBottomShell() && !document.body.classList.contains('bottom-collapsed')) setBottomPanelMaximized(true);
  });
  document.getElementById('btnToggleStatTable')?.addEventListener('click', toggleStatTable);
  document.getElementById('btnExportBottomPdf')?.addEventListener('click', exportBottomPanelPdf);

  // Bán kính chung: chặn trong khoảng hợp lệ; buffer vẽ lại nhanh (client), heatmap gọi GEE thì đợi lâu hơn
  let bufferDebounce = null;
  let heatDebounce = null;
  const inputIsoRadius = document.getElementById('inputIsoRadius');
  const applyRadius = (commit) => {
    const raw = inputIsoRadius.value.trim();
    let next = null;
    if (raw !== "") {
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      next = Math.round(Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, n)));
      if (commit && String(next) !== raw) inputIsoRadius.value = next;
    }
    if (next === state.globalBufferRadiusOverride) return;
    state.globalBufferRadiusOverride = next;
    clearTimeout(bufferDebounce);
    clearTimeout(heatDebounce);
    bufferDebounce = setTimeout(refreshBuffers, 250);
    heatDebounce = setTimeout(refreshHeatmapOnly, 600);
  };
  inputIsoRadius?.addEventListener('input', () => applyRadius(false));
  inputIsoRadius?.addEventListener('change', () => applyRadius(true));

  document.getElementById('heatOpacity')?.addEventListener('input', (e) => setHeatOpacity(e.target.value / 100));

  document.getElementById('popOpacity')?.addEventListener('input', (e) => {
    const val = e.target.value / 100;
    layers.pop.eachLayer(l => l.setOpacity && l.setOpacity(val));
    planLayers.pop.eachLayer(l => l.setOpacity && l.setOpacity(val));
  });

  addTypeSwatches();
  const layerCheckboxes = ['pop', 'bound', 'c1', 'c2', 'c3', 'c4', 'c5', 'c10', 'c6', 'c7', 'c8', 'c9', 'c11', 'c12', 'c13', 'c14', 'heat'];
  layerCheckboxes.forEach(key => {
    document.getElementById(`chk_${key}`)?.addEventListener('change', (e) => {
      const targetLayer = key === 'bound' ? 'boundary' : key === 'heat' ? 'heatmap' : key;
      if (key === 'pop' && e.target.checked) ensurePopulationLayer();
      toggleLayer(targetLayer, e.target.checked);
    });
  });
  document.getElementById('chk_parcel')?.addEventListener('change', (e) => setParcelsVisible(e.target.checked));
  initLayerGroups();

  document.querySelectorAll('.btn-dot-buffer').forEach(btn => {
    btn.addEventListener('click', () => {
      const bufferKey = btn.getAttribute('data-buffer');
      if (bufferKey) toggleBuffer(bufferKey, btn);
    });
  });

  document.getElementById('wardSelector')?.addEventListener('change', (e) => chooseWard(e.target.value || CITY_NAME));

  // ---------- Đăng nhập quản trị ----------
  document.getElementById('btnAuth')?.addEventListener('click', toggleAuthModal);
  document.getElementById('btnCloseAuthModal')?.addEventListener('click', toggleAuthModal);
  document.getElementById('btnSignOut')?.addEventListener('click', () => {
    signOutAdmin();
    toggleAuthModal();
    showToast('Đã đăng xuất tài khoản quản trị', 'info');
  });

  // ---------- Thêm điểm đề xuất ----------
  ['newType', 'newNhomHaTang', 'newWard', 'newName', 'newSize'].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', updateRadiusPreview);
  });
  updateRadiusPreview();
  document.getElementById('btnPickOnMap')?.addEventListener('click', () => {
    announceTool('pick');
    state.pickTarget = 'infra';
    state.isPickMode = true;
    setStatus("Chọn một điểm trên bản đồ.", "var(--accent-orange)");
  });

  document.getElementById('btnSubmitNewPoint')?.addEventListener('click', () => submitInfraPoint('new'));

  // ---------- Ẩn/hiện toàn bộ icon (thanh đầu tab Lớp dữ liệu) ----------
  // Đủ 14 nhóm đang bật: bấm tắt hết; còn nhóm nào tắt: bấm bật cả 14 nhóm
  const ICON_GROUPS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c10', 'c6', 'c7', 'c8', 'c9', 'c11', 'c12', 'c13', 'c14'];
  const btnEye = document.getElementById('btnToggleAllIcons');
  const layerCount = document.getElementById('layerCount');
  const tabCount = document.getElementById('infraTabCount');
  const iconCheck = (k) => document.getElementById(`chk_${k}`);
  const syncEyeButton = () => {
    const on = ICON_GROUPS.filter(k => iconCheck(k)?.checked).length;
    if (layerCount) {
      layerCount.textContent = `${on}/${ICON_GROUPS.length}`;
      layerCount.classList.toggle('none', on === 0);
    }
    if (tabCount) tabCount.textContent = `(${on}/${ICON_GROUPS.length})`;
    if (!btnEye) return;
    const allOn = on === ICON_GROUPS.length;
    btnEye.setAttribute('aria-pressed', String(!allOn));
    btnEye.title = allOn ? 'Tắt toàn bộ 14 nhóm công trình' : 'Bật toàn bộ 14 nhóm công trình';
  };
  const setIconGroups = (keys) => ICON_GROUPS.forEach(k => {
    const chk = iconCheck(k);
    const on = keys.includes(k);
    if (!chk || chk.checked === on) return;
    chk.checked = on;
    chk.dispatchEvent(new Event('change', { bubbles: true }));
  });
  btnEye?.addEventListener('click', () => {
    const allOn = ICON_GROUPS.every(k => iconCheck(k)?.checked);
    setIconGroups(allOn ? [] : ICON_GROUPS);
    syncEyeButton();
  });
  ICON_GROUPS.forEach(k => iconCheck(k)?.addEventListener('change', syncEyeButton));
  syncEyeButton();

  const EDU_LEVELS = { all: ['c3', 'c4', 'c5', 'c10'], mn: ['c3'], th: ['c4'], thcs: ['c5'], thpt: ['c10'] };
  const EDU_KEYS = ['c3', 'c4', 'c5', 'c10'];
  let eduLevel = 'all';
  const paintEduLevel = () => {
    document.querySelectorAll('[data-edu-level]').forEach(b => b.classList.toggle('active', b.dataset.eduLevel === eduLevel));
  };
  const applyEdu = (on) => {
    const allow = new Set(EDU_LEVELS[eduLevel] || EDU_LEVELS.all);
    EDU_KEYS.forEach(k => {
      const chk = document.getElementById(`chk_${k}`);
      const next = on && allow.has(k);
      if (!chk || chk.checked === next) return;
      chk.checked = next;
      chk.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  document.getElementById('chk_edu')?.addEventListener('change', (e) => applyEdu(e.target.checked));
  document.querySelectorAll('[data-edu-level]').forEach(btn => btn.addEventListener('click', () => {
    eduLevel = btn.dataset.eduLevel || 'all';
    paintEduLevel();
    const master = document.getElementById('chk_edu');
    if (master && !master.checked) {
      master.checked = true;
      applyEdu(true);
      return;
    }
    applyEdu(true);
  }));
  EDU_KEYS.forEach(k => {
    document.getElementById(`chk_${k}`)?.addEventListener('change', () => {
      const master = document.getElementById('chk_edu');
      const on = EDU_KEYS.filter(id => document.getElementById(`chk_${id}`)?.checked);
      if (master && master.checked !== (on.length > 0)) master.checked = on.length > 0;
      const match = Object.entries(EDU_LEVELS).find(([, keys]) => keys.length === on.length && keys.every(id => on.includes(id)));
      if (!match) return;
      eduLevel = match[0];
      paintEduLevel();
    });
  });

  const funeralBox = document.getElementById('chk_nt_funeral');
  const graveBox = document.getElementById('chk_nt_grave');
  const c13 = document.getElementById('chk_c13');
  let syncingNt = false;
  const applyNt = () => {
    if (!c13) return;
    const on = !!(funeralBox?.checked || graveBox?.checked);
    if (c13.checked === on) {
      renderGroupedPoints();
      return;
    }
    syncingNt = true;
    c13.checked = on;
    c13.dispatchEvent(new Event('change', { bubbles: true }));
    syncingNt = false;
  };
  funeralBox?.addEventListener('change', applyNt);
  graveBox?.addEventListener('change', applyNt);
  c13?.addEventListener('change', () => {
    if (syncingNt) return;
    if (funeralBox) funeralBox.checked = c13.checked;
    if (graveBox) graveBox.checked = c13.checked;
    renderGroupedPoints();
  });

  // Bấm ô số lượng: tắt mọi lớp khác (kể cả bản đồ độ phủ), chỉ bật đúng loại công trình, vùng phủ của loại đó và ranh 40 phường xã.
  // Bấm lại cùng ô để khôi phục đúng các lớp đang bật trước đó.
  const FOCUS_CHECKS = [
    ...ICON_GROUPS.map(k => `chk_${k}`),
    'chk_bound', 'chk_urban', 'chk_qhc25', 'chk_qhc10', 'chk_gt25', 'chk_gt10', 'chk_qhct', 'chk_parcel', 'chk_projects', 'chk_pop', 'chk_terrain', 'chk_drainage', 'chk_basin', 'chk_flood', 'chk_sarflood',
    'chk_lst', 'chk_ndvi', 'chk_tree', 'chk_newdev', 'chk_forest', 'chk_risk', 'chk_roads', 'chk_osmRail', 'chk_osmWater', 'chk_cadastre', 'chk_violate', 'chk_invest', 'chk_heat'
  ];
  let focusSnapshot = null;
  const setChecked = (id, on) => {
    const el = document.getElementById(id);
    if (!el || el.checked === on) return;
    el.checked = on;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const bufferOn = (key) => !!(map && layers[key] && map.hasLayer(layers[key]));
  const setBuffer = (key, on) => {
    if (!layers[key] || bufferOn(key) === on) return;
    toggleBuffer(key, document.querySelector(`.btn-dot-buffer[data-buffer="${key}"]`));
  };
  const paintFocus = () => {
    document.querySelectorAll('[data-focus]').forEach(el => {
      el.classList.toggle('is-focus', el.dataset.focus === state.facilityFocus);
    });
  };
  const captureFocus = () => ({
    checks: Object.fromEntries(FOCUS_CHECKS.map(id => [id, !!document.getElementById(id)?.checked])),
    buffers: Object.fromEntries(Object.values(BUFFER_KEYS).map(key => [key, bufferOn(key)]))
  });
  const applyFocusSnapshot = (snap) => {
    FOCUS_CHECKS.forEach(id => setChecked(id, !!snap.checks[id]));
    Object.entries(snap.buffers).forEach(([key, on]) => setBuffer(key, !!on));
  };
  const focusFacility = (type) => {
    if (!ICON_GROUP_KEYS[type]) return;
    if (state.facilityFocus === type) {
      if (focusSnapshot) applyFocusSnapshot(focusSnapshot);
      focusSnapshot = null;
      state.facilityFocus = null;
      paintFocus();
      showToast('Đã khôi phục các lớp bản đồ', 'info');
      return;
    }
    if (!focusSnapshot) focusSnapshot = captureFocus();
    state.facilityFocus = type;
    const keepChk = `chk_${ICON_GROUP_KEYS[type]}`;
    const keepBuffer = BUFFER_KEYS[type];
    FOCUS_CHECKS.forEach(id => setChecked(id, id === keepChk || id === 'chk_bound'));
    Object.values(BUFFER_KEYS).forEach(key => setBuffer(key, key === keepBuffer));
    paintFocus();
    const label = infraLabels[type] || type;
    showToast(`Chỉ hiện ${label}, vùng phủ và ranh 40 phường xã`, 'info');
  };
  const onFocusClick = (e) => {
    const card = e.target.closest('[data-focus]');
    if (!card) return;
    focusFacility(card.dataset.focus);
  };
  document.getElementById('infraCountGrid')?.addEventListener('click', onFocusClick);
  document.getElementById('infraCountGrid')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    onFocusClick(e);
    e.preventDefault();
  });
  document.getElementById('roadBusRow')?.addEventListener('click', onFocusClick);

  // Thuyết minh phương án CSD: chỉ giữ công trình cùng loại kèm ranh lô (tắt lớp Quy hoạch để ranh lô vẽ theo lớp công trình),
  // tắt vùng phủ vì lớp minh chứng tự vẽ phạm vi phục vụ; đóng thuyết minh thì khôi phục các lớp trước đó
  let proofSnapshot = null;
  window.addEventListener(PROOF_FOCUS_EVENT, (e) => {
    const type = e.detail && e.detail.type;
    if (!type) {
      if (proofSnapshot) applyFocusSnapshot(proofSnapshot);
      proofSnapshot = null;
      return;
    }
    if (!proofSnapshot) proofSnapshot = captureFocus();
    const keepChk = ICON_GROUP_KEYS[type] ? `chk_${ICON_GROUP_KEYS[type]}` : null;
    FOCUS_CHECKS.forEach(id => setChecked(id, id === keepChk || id === 'chk_parcel'));
    Object.values(BUFFER_KEYS).forEach(key => setBuffer(key, false));
  });

  // ---------- Định vị GPS: 1 marker duy nhất (thay thế lần định vị trước) + tra cứu hạ tầng tại chỗ ----------
  const gpsLayers = [L.layerGroup().addTo(map), planMap ? L.layerGroup().addTo(planMap) : null].filter(Boolean);
  document.getElementById('btnLocateGPS')?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      showToast('Trình duyệt không hỗ trợ định vị.', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        flyToVisible([lat, lng], 16, { animate: false });
        gpsLayers.forEach(g => {
          g.clearLayers();
          L.circleMarker([lat, lng], { radius: 8, color: '#38bdf8', fillColor: '#38bdf8', fillOpacity: 0.8 })
            .bindPopup(`<b>Vị trí hiện tại của bạn</b><br/>${escapeHtml(lat.toFixed(5))}, ${escapeHtml(lng.toFixed(5))}`)
            .addTo(g);
        });
        handleInspectPointClick(lat, lng, isCompareOn() && !isSplitOn() && planMap ? planMap : map);
      },
      () => showToast('Không lấy được vị trí hiện tại.', 'error'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });

  document.getElementById('btnPrintA3')?.addEventListener('click', exportMapA3);
  initChuyenNganh();
  initChamDiem();
  initViewLink();
  // Liên kết ?nganh= / ?truc= chỉ chọn panel, không mở khung. Nút thu/mở là cách mở duy nhất lúc tải trang.
  document.body.classList.add('right-collapsed');
  // Sau khi gắn trục và link chia sẻ: không có camera trên URL thì vừa cả thành phố.
  // Xoay máy hoặc khôi phục trang từ bộ nhớ trình duyệt không được cắt ranh, cũng không kéo về QHPK 1/2.000.
  let cityFrameHeld = !hasSharedCamera();
  const releaseCityFrame = () => { cityFrameHeld = false; };
  const watchCityFrame = (m) => {
    if (!m) return;
    m.on('dragstart', releaseCityFrame);
    // zoomstart của setView lập trình không có originalEvent. Chạm hai ngón / nháy đúp thì có.
    m.on('zoomstart', (e) => { if (e.originalEvent) releaseCityFrame(); });
    m.getContainer()?.addEventListener('wheel', releaseCityFrame, { passive: true });
  };
  watchCityFrame(map);
  watchCityFrame(planMap);
  let cityFrameTick = 0;
  window.addEventListener('resize', () => {
    if (!cityFrameHeld) return;
    cancelAnimationFrame(cityFrameTick);
    cityFrameTick = requestAnimationFrame(() => centerOnCity({ animate: false }));
  });
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted || hasSharedCamera()) return;
    setLevel(DEFAULT_LEVEL, { keepView: true });
    cityFrameHeld = true;
    centerOnCity({ animate: false });
  });
  if (!hasSharedCamera()) centerOnCity({ animate: false });

  // ---------- Nạp dữ liệu ban đầu ----------
  const progressBar = document.getElementById('progressBar');
  const progressPercent = document.getElementById('progressPercent');
  const progressLabel = document.getElementById('progressLabel');
  const progressRow = document.querySelector('.rp-progress');
  const setProgress = (pct, label) => {
    if (progressBar) progressBar.style.width = `${pct}%`;
    if (progressPercent) progressPercent.textContent = `${pct}%`;
    if (progressLabel && label) progressLabel.textContent = label;
    setBootProgress(pct);
  };
  const swSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (swSecure && 'serviceWorker' in navigator) {
    Promise.resolve(window.__qhSwReady).then(() => navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })).catch(() => {});
  }
  // 3 mốc xong theo thứ tự bất kỳ: lớp phủ đô thị (chờ ranh 40 phường xã), công trình, độ phủ (chờ công trình)
  const STEP_LABEL = { urban: 'Đang dựng lớp phủ đô thị', infra: 'Đang tải công trình', heat: 'Đang tính độ phủ' };
  const pending = new Set(Object.keys(STEP_LABEL));
  const stepDone = (key) => {
    if (!pending.delete(key)) return;
    const next = [...pending][0];
    const total = Object.keys(STEP_LABEL).length;
    setProgress(Math.round(10 + 90 * (total - pending.size) / total), next ? STEP_LABEL[next] : 'Đã nạp xong');
  };

  try {
    setProgress(10, STEP_LABEL.urban);
    // Gọi song song: ranh giới (CDN cache), danh sách công trình, thống kê phường; heatmap chờ danh sách công trình
    const boundaryReady = loadBoundaryLayer().then(renderPlanBoundaries);
    boundaryReady.then(refreshUrbanAreaLayer).catch(() => {});
    Promise.all([boundaryReady, urbanAreaReady()]).then(() => stepDone('urban'), () => stepDone('urban'));
    const statsReady = ensureWardStats();
    statsReady.catch(() => {});
    if (document.getElementById('chk_pop')?.checked) ensurePopulationLayer();

    await loadInfraData();
    stepDone('infra');
    renderGroupedPoints();
    document.dispatchEvent(new CustomEvent('infra:ready'));
    loadCadParcels();
    const heatReady = refreshHeatmapOnly();

    Promise.all([statsReady, boundaryReady])
      .then(() => startBackgroundCoverageFill())
      .catch(err => console.warn("Không khởi động tính độ phủ nền:", err));

    await boundaryReady;
    const wardSelector = document.getElementById('wardSelector');
    if (wardSelector) {
      wardSelector.innerHTML = "";
      const defaultOpt = document.createElement('option');
      defaultOpt.value = CITY_NAME;
      defaultOpt.textContent = CITY_NAME.toUpperCase();
      defaultOpt.selected = true;
      wardSelector.appendChild(defaultOpt);
      state.selectedWard = CITY_NAME;

      state.wardLabelsList
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
        .forEach(item => {
          if (!item.name || item.name === CITY_NAME) return;
          const opt = document.createElement('option');
          opt.value = item.name;
          opt.textContent = item.name.toUpperCase();
          wardSelector.appendChild(opt);
        });
    }

    renderBottomPanel();
    refreshWardCheck();

    await heatReady;
    stepDone('heat');
    setTimeout(() => {
      if (progressRow) progressRow.style.display = 'none';
    }, 600);
  } catch (err) {
    console.error("Lỗi khởi tạo dữ liệu bản đồ:", err);
    showToast('Không nạp được dữ liệu bản đồ. Vui lòng tải lại trang.', 'error');
    setBootProgress(100);
    if (progressRow) progressRow.style.display = 'none';
  }
});
