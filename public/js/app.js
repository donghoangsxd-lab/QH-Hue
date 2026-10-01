import { state, bumpDataVersion, BUFFER_COLORS, ICON_GROUP_KEYS, isNetworkType, ntKindOf, NT_KIND_LABELS } from './state.js';
import { geeApi, infraListUrl, markDataWritten } from './api.js';
import {
  initMap,
  toggleLayer,
  toggleBuffer,
  toggleMeasure,
  handleMeasureClick,
  renderGroupedPoints,
  refreshBuffers,
  refreshHeatmapOnly,
  setHeatOpacity,
  handleInspectPointClick,
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
import { initWardCheck, refreshWardCheck } from './wardCheck.js';
import { initOsmImport } from './osmImport.js';
import { initWardRoads } from './wardRoads.js';
import { initCustomRoads, handleRoadDrawClick } from './customRoads.js';
import { initPopEdits, handlePopDrawClick } from './popEdits.js';
import { initRoadNetworkLayer } from './roadNetworkLayer.js';
import { initTerrainLayer } from './terrainLayer.js';
import { initFloodSim } from './floodSim.js';
import { initSatLayers } from './satLayers.js';
import { initSketchLayer, handleSketchClick, stopSketchTool } from './sketchLayer.js';
import { captureMapScreenshot, exportMapA3 } from './printLayout.js';

const CITY_NAME = "Thành phố Huế";

// Ô màu theo loại hạ tầng ở danh sách lớp, cùng màu vùng phủ (buffer) trên bản đồ (1 nguồn: BUFFER_COLORS)
function addTypeSwatches() {
  Object.entries(ICON_GROUP_KEYS).forEach(([type, key]) => {
    document.querySelector(`label[for="chk_${key}"]`)
      ?.insertAdjacentHTML('afterbegin', `<i class="layer-swatch" style="background:${BUFFER_COLORS[type]};"></i>`);
  });
}
const RADIUS_MIN = 50;
const RADIUS_MAX = 5000;
// Bán kính phục vụ theo QCVN 01:2026 (khớp config/constants.js standardRadius, máy chủ tính lại khi ghi Sheet):
// cấp đô thị và trường THPT 2 km; cấp đơn vị ở: phường ≤ 1 km (Mục 2.3.3.1), xã: trường, y tế, văn hóa, chợ ≤ 2 km (Mục 4.6.2.2);
// cây xanh nhóm nhà ở 400 m, bãi đỗ xe 500 m
const URBAN_RADIUS = 2000;
const UNIT_DEFAULT_RADIUS = { "1-CV": 400, "2-BDX": 500, "3-MN": 1000, "4-TH": 1000, "5-THCS": 1000, "6-YT": 1000, "7-VH": 1000, "8-TM": 1000 };
const RURAL_UNIT_RADIUS = 2000;
const isThptName = (name) => /THPT|TRUNG HOC PHO THONG/.test(String(name || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/Đ/g, 'D'));
// Mạng lưới: trạm xe buýt 500 m đi bộ (Mục 2.8.3.3), PCCC 3 km phường / 5 km xã (Mục 2.5.13.1), nghĩa trang theo Bảng 23
const NO_AREA_TYPES = ["10-BUS", "11-PCCC"];
const NT_SAFETY = { funeral: 0, crematorium: 500, cemetery_cat: 100, cemetery_once: 500, cemetery_hung: 1000 };
function networkRadius(type, ward, name) {
  if (type === '10-BUS') return 500;
  if (type === '11-PCCC') return /^xã\s/i.test(String(ward || '').trim()) ? 5000 : 3000;
  return NT_SAFETY[ntKindOf({ name })];
}
function qcvnRadius(type, nhomHaTang, ward, name) {
  if (isNetworkType(type)) return networkRadius(type, ward, name);
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
  const r = qcvnRadius(type, nhom, ward, name);
  const nhomEl = document.getElementById('newNhomHaTang');
  if (nhomEl) nhomEl.disabled = isNetworkType(type);
  if (type === '12-NT') {
    const kind = ntKindOf({ name });
    out.innerHTML = r
      ? `<b>${r.toLocaleString('vi-VN')} m</b> <small>(khoảng cách an toàn Bảng 23: ${NT_KIND_LABELS[kind].toLowerCase()})</small>`
      : `<small>Nhà tang lễ: không quy định khoảng cách an toàn. Tên ghi rõ "cát táng" / "chôn cất một lần" / "hỏa táng" để áp đúng khoảng cách</small>`;
    return;
  }
  if (isNetworkType(type)) {
    const area = !ward ? 'chưa xác định phường/xã' : /^xã\s/i.test(ward.trim()) ? 'xã' : 'phường';
    out.innerHTML = `<b>${r.toLocaleString('vi-VN')} m</b> <small>(${type === '10-BUS' ? 'phạm vi đi bộ tới trạm' : `bán kính phục vụ PCCC, ${area}`})</small>`;
    return;
  }
  if (!r) {
    out.textContent = type === '9-CSD' ? 'Không áp dụng (cơ sở chưa sử dụng)' : '—';
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
  initWardCheck({ onSynced: reloadAfterSheetWrite });
  initOsmImport({ onImported: reloadAfterSheetWrite });
  initWardRoads();
  initCustomRoads();
  initPopEdits();
  initRoadNetworkLayer();
  initTerrainLayer();
  initFloodSim();
  initSatLayers();
  initSketchLayer();
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
      handleInspectPointClick(e.latlng.lat, e.latlng.lng, targetMap);
    }
  };
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
  document.getElementById('btnToggleSidebar')?.addEventListener('click', () => {
    const collapsed = document.body.classList.contains('right-collapsed');
    if (!collapsed && activeTab === 'tabLayers') setRightPanelCollapsed(true);
    else showRightTab('tabLayers');
  });

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
  const layerCheckboxes = ['pop', 'bound', 'c1', 'c2', 'c3', 'c4', 'c5', 'c10', 'c6', 'c7', 'c8', 'c9', 'c11', 'c12', 'c13', 'heat'];
  layerCheckboxes.forEach(key => {
    document.getElementById(`chk_${key}`)?.addEventListener('change', (e) => {
      const targetLayer = key === 'bound' ? 'boundary' : key === 'heat' ? 'heatmap' : key;
      if (key === 'pop' && e.target.checked) ensurePopulationLayer();
      toggleLayer(targetLayer, e.target.checked);
    });
  });
  document.getElementById('chk_parcel')?.addEventListener('change', (e) => setParcelsVisible(e.target.checked));

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
  ['newType', 'newNhomHaTang', 'newWard', 'newName'].forEach(id => {
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
          id: data.id || `NEW-${Date.now()}`,
          name, ward: data.ward || '', type, nhomHaTang, lat, lng,
          size: phase === 'QH' ? 0 : size,
          radius: data.radius ?? qcvnRadius(type, nhomHaTang, data.ward, name) ?? 500,
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

  // ---------- Ẩn/hiện toàn bộ icon ----------
  let allIconsVisible = true;
  const btnEye = document.getElementById('btnToggleAllIcons');
  btnEye?.addEventListener('click', () => {
    allIconsVisible = !allIconsVisible;
    ['c1', 'c2', 'c3', 'c4', 'c5', 'c10', 'c6', 'c7', 'c8', 'c9', 'c11', 'c12', 'c13'].forEach(gKey => {
      const chk = document.getElementById(`chk_${gKey}`);
      if (chk) chk.checked = allIconsVisible;
      toggleLayer(gKey, allIconsVisible);
    });
    btnEye.style.opacity = allIconsVisible ? '1' : '0.5';
    btnEye.title = allIconsVisible ? 'Ẩn toàn bộ icon' : 'Hiện toàn bộ icon';
    btnEye.setAttribute('aria-pressed', String(!allIconsVisible));
  });

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
