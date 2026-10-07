import { state, bumpDataVersion, BUFFER_COLORS, BUFFER_KEYS, ICON_GROUP_KEYS, infraLabels, isNetworkType, ntKindOf, NT_KIND_LABELS, parkTierOf } from './state.js';
import { geeApi, infraListUrl, markDataWritten } from './api.js';
import {
  initMap,
  map,
  toggleLayer,
  toggleBuffer,
  toggleMeasure,
  handleMeasureClick,
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
  layers
} from './mapEngine.js';
import {
  toggleAuthModal,
  selectWardDetail,
  renderBottomPanel,
  ensureWardStats,
  reloadWardStats,
  toggleBottomPanelMaximized,
  toggleStatTable,
  exportBottomPanelPdf,
  initGoogleSignIn,
  initBottomPanelEvents,
  restoreAdminSession,
  signOutAdmin,
  startBackgroundCoverageFill
} from './uiComponents.js';
import { initPlanMap, planMap, planLayers, renderPlanBoundaries, toggleCompareMode } from './planMap.js';
import { escapeHtml, setStatusContent, showToast } from './utils.js';
import { initCadImport } from './cadImportUi.js';
import { initProjectLayer } from './projectLayer.js';
import { initProjectReview } from './projectReview.js';
import { initWardCheck, refreshWardCheck } from './wardCheck.js';
import { initOsmImport } from './osmImport.js';
import { initLotEdit } from './lotEdit.js';
import { initWardRoads } from './wardRoads.js';
import { initCustomRoads, handleRoadDrawClick } from './customRoads.js';
import { initPopEdits, handlePopDrawClick } from './popEdits.js';
import { initRoadNetworkLayer } from './roadNetworkLayer.js';
import { initTerrainLayer } from './terrainLayer.js';
import { initDrainageLayer } from './drainageLayer.js';
import { initFloodSim } from './floodSim.js';
import { initSatLayers } from './satLayers.js';
import { initSketchLayer, handleSketchClick, stopSketchTool } from './sketchLayer.js';
import { captureMapScreenshot, exportMapA3 } from './printLayout.js';
import { initIntroTour } from './introTour.js';
import { initRiskLayer } from './riskLayer.js';
import { initBasemapUi } from './basemap.js';

const CITY_NAME = "Thành phố Huế";

// Ô màu theo loại hạ tầng ở danh sách lớp, cùng màu vùng phủ (buffer) trên bản đồ (1 nguồn: BUFFER_COLORS)
function addTypeSwatches() {
  Object.entries(ICON_GROUP_KEYS).forEach(([type, key]) => {
    document.querySelector(`label[for="chk_${key}"]`)
      ?.insertAdjacentHTML('afterbegin', `<i class="layer-swatch" style="background:${BUFFER_COLORS[type]};"></i>`);
  });
}
// Thanh đầu tab Lớp dữ liệu chia đôi Quy hoạch | Công trình: mỗi lúc hiện 1 mục, nút mắt đổi theo mục đang chọn
const LAYER_SEC_KEY = 'qh_layer_sec';
function initLayerSections() {
  const tabs = [...document.querySelectorAll('.layer-sec-tab')];
  if (!tabs.length) return;
  const show = (key) => {
    tabs.forEach(t => {
      const on = t.dataset.layerSec === key;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('[data-layer-sec-pane]').forEach(p => { p.hidden = p.dataset.layerSecPane !== key; });
    document.querySelectorAll('[data-layer-sec-only]').forEach(b => { b.hidden = b.dataset.layerSecOnly !== key; });
  };
  tabs.forEach(t => t.addEventListener('click', () => {
    show(t.dataset.layerSec);
    try { localStorage.setItem(LAYER_SEC_KEY, t.dataset.layerSec); } catch (e) { /* chế độ riêng tư */ }
  }));
  let saved = null;
  try { saved = localStorage.getItem(LAYER_SEC_KEY); } catch (e) { /* chế độ riêng tư */ }
  show(tabs.some(t => t.dataset.layerSec === saved) ? saved : 'infra');
}

// Tab Chú giải chia đôi Công trình | Quy hoạch, cùng kiểu nút với Lớp dữ liệu
function initLegendSections() {
  const root = document.getElementById('tabLegend');
  if (!root) return;
  const tabs = [...root.querySelectorAll('.legend-sec-tab')];
  const show = (key) => {
    tabs.forEach(t => {
      const on = t.dataset.legendSec === key;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    root.querySelectorAll('[data-legend-sec-pane]').forEach(p => { p.hidden = p.dataset.legendSecPane !== key; });
  };
  tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.legendSec)));
  show('infra');
}

// Nút Nền, phân tích | Môi trường: mỗi lúc hiện 1 nhóm lớp; số trên nút = số lớp đang bật trong nhóm (kể cả nhóm đang ẩn)
function initLayerTabs() {
  const btns = [...document.querySelectorAll('.layer-tab-btn')];
  const panes = [...document.querySelectorAll('.layer-tab-pane')];
  if (!btns.length) return;
  const paneOf = (key) => panes.find(p => p.dataset.layerPane === key);
  const refreshCounts = () => btns.forEach(btn => {
    const n = paneOf(btn.dataset.layerTab)?.querySelectorAll('input[type="checkbox"]:checked').length || 0;
    const badge = btn.querySelector('.layer-tab-count');
    if (badge) badge.textContent = n ? String(n) : '';
  });
  btns.forEach(btn => btn.addEventListener('click', () => {
    btns.forEach(b => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      const pane = paneOf(b.dataset.layerTab);
      if (pane) pane.hidden = !on;
    });
  }));
  panes.forEach(p => p.addEventListener('change', refreshCounts));
  refreshCounts();
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

function updateRadiusPreview() {
  const out = document.getElementById('newRadius');
  if (!out) return;
  const type = document.getElementById('newType')?.value;
  const nhom = document.getElementById('newNhomHaTang')?.value;
  const ward = document.getElementById('newWard')?.value || '';
  const name = document.getElementById('newName')?.value;
  const size = Number(document.getElementById('newSize')?.value) || 0;
  const r = qcvnRadius(type, nhom, ward, name, size);
  const nhomEl = document.getElementById('newNhomHaTang');
  if (nhomEl) nhomEl.disabled = isNetworkType(type);
  if (type === '11-NT') {
    const kind = ntKindOf({ name });
    out.innerHTML = r
      ? `<b>${r.toLocaleString('vi-VN')} m</b> <small>(khoảng cách an toàn Bảng 23: ${NT_KIND_LABELS[kind].toLowerCase()})</small>`
      : `<small>Nhà tang lễ: không quy định khoảng cách an toàn. Tên ghi rõ "cát táng" / "chôn cất một lần" / "hỏa táng" để áp đúng khoảng cách</small>`;
    return;
  }
  if (type === '14-NOXH') {
    out.innerHTML = '<small>Nhà ở xã hội: không có bán kính phục vụ, chỉ thể hiện vị trí và diện tích</small>';
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

async function loadInfraData() {
  const res = await fetch(infraListUrl());
  if (!res.ok) throw new Error(`Lỗi máy chủ (${res.status})`);
  const data = await res.json();
  state.rawDataList = data.rawDataList || [];
  state.planDataList = data.planDataList || [];
  bumpDataVersion();
}

document.addEventListener('DOMContentLoaded', async () => {
  initGoogleSignIn();
  const map = initMap();

  const mapEl = document.getElementById('map');
  if (mapEl && window.ResizeObserver) {
    new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(mapEl);
  }

  initPlanMap(map, layers);
  centerOnCity();
  initBottomPanelEvents();
  // Sau khi máy chủ ghi Sheet (nhập file, ghi dấu nhắc phường): tải lại dữ liệu và làm mới bản đồ, bảng
  const reloadAfterSheetWrite = async () => {
    try { await loadInfraData(); } catch (err) { showToast('⚠️ Chưa tải lại được dữ liệu, thử F5 sau ít phút', 'error'); return; }
    renderGroupedPoints();
    loadCadParcels();
    refreshHeatmapOnly();
    if (state.wardStatsData.length) reloadWardStats();
    refreshWardCheck();
  };
  initCadImport({ onImported: reloadAfterSheetWrite });
  initProjectLayer({ onDeleted: reloadAfterSheetWrite });
  initProjectReview();
  initWardCheck({ onSynced: reloadAfterSheetWrite });
  initOsmImport({ onImported: reloadAfterSheetWrite });
  initLotEdit({ onInfraSaved: reloadAfterSheetWrite });
  initWardRoads();
  initCustomRoads();
  initPopEdits();
  initRoadNetworkLayer();
  initBasemapUi();
  initTerrainLayer();
  initDrainageLayer();
  initFloodSim();
  initSatLayers();
  initRiskLayer();
  initSketchLayer();
  initIntroTour();
  // Bật đo đạc / tra cứu / ghim / vẽ tuyến → bỏ chọn công cụ phác thảo (hình đã vẽ vẫn giữ)
  ['btnMeasureDist', 'btnMeasureArea', 'btnInspectMode', 'btnPickOnMap', 'btnRoadDraw', 'btnPopDraw']
    .forEach(id => document.getElementById(id)?.addEventListener('click', stopSketchTool));
  restoreAdminSession();
  document.getElementById('btnToggleCompare')?.addEventListener('click', toggleCompareMode);

  // ---------- Click bản đồ: dùng chung cho nửa trái (hiện trạng) và nửa phải (quy hoạch) khi so sánh ----------
  let pickSeq = 0;
  const pickCoordinate = (latlng) => {
    const lat = latlng.lat.toFixed(6);
    const lng = latlng.lng.toFixed(6);
    const seq = ++pickSeq;
    const inputLat = document.getElementById('newLat');
    const inputLng = document.getElementById('newLng');
    if (inputLat) inputLat.value = lat;
    if (inputLng) inputLng.value = lng;
    setStatus("⏳ Đang tra cứu địa bàn...", "var(--accent-orange)");

    fetch(geeApi(`action=getWardFromPoint&lat=${lat}&lng=${lng}`))
      .then(r => (r.ok ? r.json() : {}))
      .then(res => {
        if (seq !== pickSeq) return;   // đã ghim vị trí khác sau lần này
        const wardName = res.ward || "";
        const inputWard = document.getElementById('newWard');
        if (inputWard) inputWard.value = wardName;
        updateRadiusPreview();
        setStatus(
          wardName ? `✓ Thuộc địa bàn: ${wardName}` : "⚠ Vị trí nằm ngoài ranh giới 40 phường/xã",
          wardName ? "var(--accent-green)" : "var(--accent-orange)"
        );
      })
      .catch(() => { if (seq === pickSeq) setStatus("✓ Đã ghim tọa độ (chưa tra cứu được địa bàn)", "var(--accent-orange)"); });
    state.isPickMode = false;
  };

  const handleMapClick = (e, targetMap) => {
    if (state.sketchTool) {
      if (targetMap === map) handleSketchClick(e.latlng);
      return;
    }
    if (state.adminDrawMode) {
      if (targetMap !== map) return;
      if (state.adminDrawMode === 'road') handleRoadDrawClick(e.latlng);
      else handlePopDrawClick(e.latlng);
      return;
    }
    if (state.isPickMode) {
      pickCoordinate(e.latlng);
      return;
    }
    if (state.activeMeasureType) {
      handleMeasureClick(e.latlng);
      return;
    }
    if (state.isInspectMode) {
      if (nearPanelClick) return;
      handleInspectPointClick(e.latlng.lat, e.latlng.lng, targetMap);
    }
  };
  // Chế độ tra cứu: click trúng / sát mép các bảng đang mở (bấm hụt nút ×, bảng vừa nở ra khi nạp xong kết quả…)
  // chỉ đóng popup như thường, không tra cứu điểm mới. Đo ở preclick vì popup bị đóng ngay trong preclick.
  const PANEL_GUARDS = [['.leaflet-popup', 24], ['.leaflet-control, .map-toolbar, .right-panel, .bottom-panel', 10]];
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

  document.getElementById('btnMeasureDist')?.addEventListener('click', () => toggleMeasure('distance'));
  document.getElementById('btnMeasureArea')?.addEventListener('click', () => toggleMeasure('area'));

  const btnInspectMode = document.getElementById('btnInspectMode');
  const planEl = document.getElementById('mapPlan');
  const setInspectMode = (on) => {
    state.isInspectMode = on;
    btnInspectMode?.classList.toggle('active', on);
    if (btnInspectMode) {
      btnInspectMode.setAttribute('aria-pressed', String(on));
      btnInspectMode.title = on
        ? "Đang bật tra cứu (bấm để tắt)"
        : "Bật chế độ tra cứu: click lên bản đồ để xem hạ tầng tiếp cận tại vị trí";
    }
    mapEl?.classList.toggle('inspect-mode', on);
    planEl?.classList.toggle('inspect-mode', on);
    if (on) state.isPickMode = false;
    else clearInspectResult();
  };
  btnInspectMode?.addEventListener('click', () => setInspectMode(!state.isInspectMode));

  // ---------- Panel phải ----------
  const tabButtons = document.querySelectorAll('.rp-tabs .tab-btn');
  let activeTab = 'tabLayers';
  const setRightPanelCollapsed = (collapsed) => {
    document.body.classList.toggle('right-collapsed', collapsed);
  };
  const showRightTab = (tabId) => {
    activeTab = tabId;
    setRightPanelCollapsed(false);
    tabButtons.forEach(btn => {
      const on = btn.dataset.tab === tabId;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
    });
    ['tabLayers', 'tabAdd', 'tabLegend'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = id === tabId ? 'block' : 'none';
    });
    if (tabId !== 'tabAdd') state.isPickMode = false;
  };
  tabButtons.forEach(btn => btn.addEventListener('click', () => showRightTab(btn.dataset.tab)));

  document.getElementById('btnCollapseRightPanel')?.addEventListener('click', () => setRightPanelCollapsed(true));
  document.getElementById('btnExpandRightPanel')?.addEventListener('click', () => showRightTab(activeTab));

  document.getElementById('btnToggleBottomMax')?.addEventListener('click', toggleBottomPanelMaximized);
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
  initLayerSections();
  initLegendSections();
  initLayerTabs();

  document.querySelectorAll('.btn-dot-buffer').forEach(btn => {
    btn.addEventListener('click', () => {
      const bufferKey = btn.getAttribute('data-buffer');
      if (bufferKey) toggleBuffer(bufferKey, btn);
    });
  });

  document.getElementById('wardSelector')?.addEventListener('change', async (e) => {
    if (state.rawDataList.length === 0) {
      try {
        await loadInfraData();
      } catch (err) {
        console.error("Lỗi tải dữ liệu điểm hạ tầng:", err);
        showToast('❌ Không tải được dữ liệu công trình', 'error');
        return;
      }
    }
    await selectWardDetail(e.target.value || CITY_NAME);
  });

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
    state.isPickMode = true;
    setStatus("👉 Click trực tiếp trên bản đồ để chọn tọa độ...", "var(--accent-orange)");
  });

  let submitting = false;
  document.getElementById('btnSubmitNewPoint')?.addEventListener('click', async () => {
    if (submitting) return;
    const type = document.getElementById('newType')?.value;
    const nhomHaTang = document.getElementById('newNhomHaTang')?.value || "Cấp đơn vị ở";
    const name = (document.getElementById('newName')?.value || '').trim();
    const lat = Number(document.getElementById('newLat')?.value);
    const lng = Number(document.getElementById('newLng')?.value);
    const size = Number(document.getElementById('newSize')?.value || 0);
    const phase = document.getElementById('newPhase')?.value === 'QH' ? 'QH' : 'HT';

    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || !document.getElementById('newLat')?.value) {
      setStatus("⚠️ Vui lòng điền đủ Tên và Tọa độ hợp lệ!", "var(--accent-red)");
      return;
    }
    if (!Number.isFinite(size) || size < 0) {
      setStatus("⚠️ Diện tích không hợp lệ!", "var(--accent-red)");
      return;
    }
    if (phase === 'QH' && !(size > 0) && !NO_AREA_TYPES.includes(type)) {
      setStatus("⚠️ Điểm quy hoạch mới cần nhập diện tích > 0!", "var(--accent-red)");
      return;
    }

    submitting = true;
    setStatus("🚀 Đang gửi đề xuất...", "var(--accent-orange)");
    try {
      markDataWritten();
      const res = await fetch(geeApi('action=addPoint'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, nhomHaTang, name, lat, lng, size, phase })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setStatus(`❌ ${data.message || `Gửi đề xuất thất bại (${res.status})`}`, "var(--accent-red)");
        return;
      }

      const radiusNote = data.radius ? `, bán kính ${Number(data.radius).toLocaleString('vi-VN')} m theo QCVN 01:2026` : '';
      setStatus(`✓ Đã lưu đề xuất${data.id ? ` (mã ${data.id})` : ''}${radiusNote}, chờ quản trị phê duyệt.`, "var(--accent-green)");
      ['newName', 'newLat', 'newLng', 'newWard', 'newSize'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      updateRadiusPreview();

      // Lấy lại danh sách từ máy chủ (đã đồng bộ Sheets → GCS); lỗi thì tạm thêm điểm vào danh sách cục bộ
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
      setStatus("❌ Lỗi kết nối máy chủ!", "var(--accent-red)");
    } finally {
      submitting = false;
    }
  });

  // ---------- Ẩn/hiện toàn bộ icon (thanh đầu tab Lớp dữ liệu) ----------
  // Đủ 14 nhóm đang bật: bấm tắt hết; còn nhóm nào tắt: bấm bật cả 14 nhóm
  const ICON_GROUPS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c10', 'c6', 'c7', 'c8', 'c9', 'c11', 'c12', 'c13', 'c14'];
  const btnEye = document.getElementById('btnToggleAllIcons');
  const layerCount = document.getElementById('layerCount');
  const iconCheck = (k) => document.getElementById(`chk_${k}`);
  const syncEyeButton = () => {
    const on = ICON_GROUPS.filter(k => iconCheck(k)?.checked).length;
    if (layerCount) {
      layerCount.textContent = `${on}/${ICON_GROUPS.length}`;
      layerCount.classList.toggle('none', on === 0);
    }
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
    toggleLayer(k, on);
  });
  btnEye?.addEventListener('click', () => {
    const allOn = ICON_GROUPS.every(k => iconCheck(k)?.checked);
    setIconGroups(allOn ? [] : ICON_GROUPS);
    syncEyeButton();
  });
  ICON_GROUPS.forEach(k => iconCheck(k)?.addEventListener('change', syncEyeButton));
  syncEyeButton();

  // Bấm ô số lượng: tắt mọi lớp khác (kể cả bản đồ độ phủ), chỉ bật đúng loại công trình, vùng phủ của loại đó và ranh 40 phường xã.
  // Bấm lại cùng ô để khôi phục đúng các lớp đang bật trước đó.
  const FOCUS_CHECKS = [
    ...ICON_GROUPS.map(k => `chk_${k}`),
    'chk_bound', 'chk_parcel', 'chk_projects', 'chk_pop', 'chk_terrain', 'chk_drainage', 'chk_flood', 'chk_sarflood',
    'chk_lst', 'chk_newdev', 'chk_risk', 'chk_roads', 'chk_heat'
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

  // ---------- Định vị GPS: 1 marker duy nhất (thay thế lần định vị trước) + tra cứu hạ tầng tại chỗ ----------
  const gpsLayers = [L.layerGroup().addTo(map), planMap ? L.layerGroup().addTo(planMap) : null].filter(Boolean);
  document.getElementById('btnLocateGPS')?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      showToast('Trình duyệt của bạn không hỗ trợ định vị GPS.', 'error');
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
        handleInspectPointClick(lat, lng);
      },
      () => showToast('Không thể lấy được vị trí GPS của bạn.', 'error'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });

  document.getElementById('btnScreenshot')?.addEventListener('click', captureMapScreenshot);
  document.getElementById('btnPrintA3')?.addEventListener('click', exportMapA3);

  // ---------- Nạp dữ liệu ban đầu ----------
  const progressBar = document.getElementById('progressBar');
  const progressPercent = document.getElementById('progressPercent');
  const setProgress = (pct) => {
    if (progressBar) progressBar.style.width = `${pct}%`;
    if (progressPercent) progressPercent.textContent = `${pct}%`;
  };

  try {
    setProgress(20);
    // Gọi song song: ranh giới (CDN cache), danh sách công trình, thống kê phường; heatmap chờ danh sách công trình
    const boundaryReady = loadBoundaryLayer().then(renderPlanBoundaries);
    const statsReady = ensureWardStats();
    statsReady.catch(() => {});
    if (document.getElementById('chk_pop')?.checked) ensurePopulationLayer();

    await loadInfraData();
    setProgress(60);
    renderGroupedPoints();
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

    setProgress(90);
    renderBottomPanel();
    refreshWardCheck();

    await heatReady;
    setProgress(100);
    setTimeout(() => {
      const progressRow = document.querySelector('.rp-progress');
      if (progressRow) progressRow.style.display = 'none';
    }, 600);
  } catch (err) {
    console.error("Lỗi khởi tạo dữ liệu bản đồ:", err);
    showToast('❌ Lỗi nạp dữ liệu bản đồ, vui lòng tải lại trang.', 'error');
  }
});
