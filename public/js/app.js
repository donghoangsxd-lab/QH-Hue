import { state, bumpDataVersion } from './state.js';
import { geeApi } from './api.js';
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
  loadPopulationLayer,
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
  captureMapScreenshot,
  initGoogleSignIn,
  initBottomPanelEvents,
  restoreAdminSession,
  signOutAdmin,
  startBackgroundCoverageFill
} from './uiComponents.js';
import { initPlanMap, planMap, planLayers, renderPlanBoundaries, toggleCompareMode } from './planMap.js';
import { escapeHtml, showToast } from './utils.js';
import { initCadImport } from './cadImportUi.js';

const CITY_NAME = "Thành phố Huế";
const RADIUS_MIN = 50;
const RADIUS_MAX = 5000;
// Bán kính mặc định cho điểm vừa thêm (khớp config/constants.js: cấp đô thị 2000 m, cấp đơn vị ở theo loại)
const UNIT_DEFAULT_RADIUS = { "1-CV": 500, "2-BDX": 500, "3-MN": 500, "4-TH": 1000, "5-THCS": 1000, "6-YT": 1000, "7-VH": 500, "8-TM": 500 };

function setStatus(text, color) {
  const el = document.getElementById('statusMsg');
  if (!el) return;
  el.style.color = color;
  el.textContent = text;
}

async function loadInfraData() {
  const res = await fetch(geeApi());
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
  initCadImport({
    onImported: async () => {
      try { await loadInfraData(); } catch (err) { showToast('⚠️ Chưa tải lại được dữ liệu, thử F5 sau ít phút', 'error'); return; }
      renderGroupedPoints();
      refreshHeatmapOnly();
      if (state.wardStatsData.length) reloadWardStats();
    }
  });
  restoreAdminSession();
  document.getElementById('btnToggleCompare')?.addEventListener('click', toggleCompareMode);

  // ---------- Click bản đồ: dùng chung cho nửa trái (hiện trạng) và nửa phải (quy hoạch) khi so sánh ----------
  const pickCoordinate = (latlng) => {
    const lat = latlng.lat.toFixed(6);
    const lng = latlng.lng.toFixed(6);
    const inputLat = document.getElementById('newLat');
    const inputLng = document.getElementById('newLng');
    if (inputLat) inputLat.value = lat;
    if (inputLng) inputLng.value = lng;
    setStatus("⏳ Đang tra cứu địa bàn...", "var(--accent-orange)");

    fetch(geeApi(`action=getWardFromPoint&lat=${lat}&lng=${lng}`))
      .then(r => (r.ok ? r.json() : {}))
      .then(res => {
        const wardName = res.ward || "";
        const inputWard = document.getElementById('newWard');
        if (inputWard) inputWard.value = wardName;
        setStatus(
          wardName ? `✓ Thuộc địa bàn: ${wardName}` : "⚠ Vị trí nằm ngoài ranh giới 40 phường/xã",
          wardName ? "var(--accent-green)" : "var(--accent-orange)"
        );
      })
      .catch(() => setStatus("✓ Đã ghim tọa độ (chưa tra cứu được địa bàn)", "var(--accent-orange)"));
    state.isPickMode = false;
  };

  const handleMapClick = (e, targetMap) => {
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

  const layerCheckboxes = ['pop', 'bound', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'heat'];
  layerCheckboxes.forEach(key => {
    document.getElementById(`chk_${key}`)?.addEventListener('change', (e) => {
      const targetLayer = key === 'bound' ? 'boundary' : key === 'heat' ? 'heatmap' : key;
      toggleLayer(targetLayer, e.target.checked);
    });
  });

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
    if (phase === 'QH' && !(size > 0)) {
      setStatus("⚠️ Điểm quy hoạch mới cần nhập diện tích > 0!", "var(--accent-red)");
      return;
    }

    submitting = true;
    setStatus("🚀 Đang gửi đề xuất...", "var(--accent-orange)");
    try {
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

      setStatus(`✓ Đã lưu đề xuất${data.id ? ` (mã ${data.id})` : ''}, chờ quản trị phê duyệt.`, "var(--accent-green)");
      ['newName', 'newLat', 'newLng', 'newWard', 'newSize'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });

      // Lấy lại danh sách từ máy chủ (đã đồng bộ Sheets → GCS); lỗi thì tạm thêm điểm vào danh sách cục bộ
      try {
        await loadInfraData();
      } catch (err) {
        const isUrban = nhomHaTang === 'Cấp đô thị';
        const newItem = {
          id: data.id || `NEW-${Date.now()}`,
          name, ward: data.ward || '', type, nhomHaTang, lat, lng,
          size: phase === 'QH' ? 0 : size,
          radius: isUrban ? 2000 : (UNIT_DEFAULT_RADIUS[type] || 500),
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
    ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9'].forEach(gKey => {
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

  // ---------- Nạp dữ liệu ban đầu ----------
  const progressBar = document.getElementById('progressBar');
  const progressPercent = document.getElementById('progressPercent');
  const setProgress = (pct) => {
    if (progressBar) progressBar.style.width = `${pct}%`;
    if (progressPercent) progressPercent.textContent = `${pct}%`;
  };

  try {
    setProgress(30);
    await Promise.all([loadBoundaryLayer(), loadPopulationLayer()]);
    renderPlanBoundaries();
    setProgress(60);

    await loadInfraData();

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
    renderGroupedPoints();
    renderBottomPanel();

    // Chạy ngầm tính độ phủ (dân số lớn → nhỏ), ghi nhớ theo chữ ký dữ liệu để lần sau dùng lại
    ensureWardStats()
      .then(() => startBackgroundCoverageFill())
      .catch(err => console.warn("Không khởi động tính độ phủ nền:", err));

    await refreshHeatmapOnly();
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
