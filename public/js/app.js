import { state } from './state.js';
import { 
  initMap, 
  toggleLayer, 
  toggleBuffer, 
  toggleMeasure, 
  renderGroupedPoints, 
  refreshHeatmapOnly, 
  handleInspectPointClick 
} from './mapEngine.js';
import { 
  toggleAuthModal, 
  openCombinedModal, 
  closeModal 
} from './uiComponents.js';

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Khởi tạo Leaflet Map
  const map = initMap();

  // 2. Lắng nghe sự kiện click trên bản đồ
  map.on('click', (e) => {
    // Chế độ ghim tọa độ đề xuất mới
    if (state.isPickMode) {
      const lat = e.latlng.lat.toFixed(6);
      const lng = e.latlng.lng.toFixed(6);
      const inputLat = document.getElementById('newLat');
      const inputLng = document.getElementById('newLng');
      if (inputLat) inputLat.value = lat;
      if (inputLng) inputLng.value = lng;

      const statusEl = document.getElementById('statusMsg');
      if (statusEl) {
        statusEl.style.color = "var(--accent-orange)";
        statusEl.innerText = "⏳ Đang tra cứu địa bàn...";
      }

      fetch(`/api/gee?action=getWardFromPoint&lat=${lat}&lng=${lng}`)
        .then(r => r.json())
        .then(res => {
          const wardName = res.ward || "Thuận Hóa";
          const inputWard = document.getElementById('newWard');
          if (inputWard) inputWard.value = wardName;
          if (statusEl) {
            statusEl.style.color = "var(--accent-green)";
            statusEl.innerText = `✓ Thuộc địa bàn: ${wardName}`;
          }
        })
        .catch(() => {
          const inputWard = document.getElementById('newWard');
          if (inputWard) inputWard.value = "Thuận Hóa";
          if (statusEl) {
            statusEl.style.color = "var(--accent-green)";
            statusEl.innerText = "✓ Đã ghim tọa độ!";
          }
        });

      state.isPickMode = false;
      return;
    }

    // Chế độ tra cứu mật độ hạ tầng tại vị trí
    if (state.isInspectMode) {
      handleInspectPointClick(e.latlng.lat, e.latlng.lng);
      return;
    }
  });

  // 3. Bind sự kiện Toolbar & Zoom buttons
  document.getElementById('btnZoomIn')?.addEventListener('click', () => map.zoomIn());
  document.getElementById('btnZoomOut')?.addEventListener('click', () => map.zoomOut());
  document.getElementById('btnMeasureDist')?.addEventListener('click', () => toggleMeasure('distance'));
  document.getElementById('btnMeasureArea')?.addEventListener('click', () => toggleMeasure('area'));

  // Tra cứu vị trí mode
  const btnInspectMode = document.getElementById('btnInspectMode');
  btnInspectMode?.addEventListener('click', () => {
    state.isInspectMode = !state.isInspectMode;
    const mapEl = document.getElementById('map');
    if (state.isInspectMode) {
      btnInspectMode.classList.add('active');
      btnInspectMode.innerHTML = "🖱️❓ ĐANG CHỌN...";
      mapEl?.classList.add('inspect-mode');
    } else {
      btnInspectMode.classList.remove('active');
      btnInspectMode.innerHTML = "🖱️ TRA CỨU ĐIỂM";
      mapEl?.classList.remove('inspect-mode');
    }
  });

  // Thay đổi bán kính đồng bộ toàn cục (Ghi đè tạm thời)
  const inputIsoRadius = document.getElementById('inputIsoRadius');
  inputIsoRadius?.addEventListener('change', (e) => {
    state.globalBufferRadiusOverride = Number(e.target.value) || 500;
    const radiusLabel = document.getElementById('radiusLabel');
    if (radiusLabel) radiusLabel.innerText = `${state.globalBufferRadiusOverride}m`;
    
    renderGroupedPoints();
    refreshHeatmapOnly();
  });

  // Thay đổi slider bán kính Heatmap
  const radiusSlider = document.getElementById('radiusSlider');
  const radiusSteps = [300, 500, 1000, 2000];
  radiusSlider?.addEventListener('change', (e) => {
    const idx = parseInt(e.target.value, 10);
    state.globalBufferRadiusOverride = radiusSteps[idx] || 500;
    const radiusLabel = document.getElementById('radiusLabel');
    if (radiusLabel) radiusLabel.innerText = `${state.globalBufferRadiusOverride}m`;
    
    renderGroupedPoints();
    refreshHeatmapOnly();
  });

  // Độ trong suốt Heatmap
  const heatOpacity = document.getElementById('heatOpacity');
  heatOpacity?.addEventListener('input', () => refreshHeatmapOnly());

  // Checkboxes Lớp dữ liệu (Đã loại bỏ isochrone toàn cục)
  const layerCheckboxes = ['pop', 'bound', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'heat'];
  layerCheckboxes.forEach(key => {
    const el = document.getElementById(`chk_${key}`);
    el?.addEventListener('change', (e) => {
      const targetLayer = key === 'bound' ? 'boundary' : key;
      toggleLayer(targetLayer, e.target.checked);
    });
  });

  // Dots bật/tắt Buffer
  document.querySelectorAll('.btn-dot-buffer').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bufferKey = e.target.getAttribute('data-buffer');
      if (bufferKey) toggleBuffer(bufferKey, e.target);
    });
  });

  // Sidebar Controls & Tabs
  const sidebarPanel = document.getElementById('sidebarPanel');
  document.getElementById('btnToggleSidebar')?.addEventListener('click', () => {
    sidebarPanel?.classList.toggle('closed');
  });
  document.getElementById('btnCloseSidebar')?.addEventListener('click', () => {
    sidebarPanel?.classList.add('closed');
  });

  const tabBtnLayers = document.getElementById('tabBtnLayers');
  const tabBtnLegend = document.getElementById('tabBtnLegend');
  const tabLayers = document.getElementById('tabLayers');
  const tabLegend = document.getElementById('tabLegend');

  tabBtnLayers?.addEventListener('click', () => {
    tabLayers.style.display = 'block';
    tabLegend.style.display = 'none';
    tabBtnLayers.classList.add('active');
    tabBtnLegend.classList.remove('active');
  });

  tabBtnLegend?.addEventListener('click', () => {
    tabLayers.style.display = 'none';
    tabLegend.style.display = 'block';
    tabBtnLegend.classList.add('active');
    tabBtnLayers.classList.remove('active');
  });

  // Modal & Dockbar Navigation
  document.getElementById('btnOpenCombinedModal')?.addEventListener('click', openCombinedModal);
  document.getElementById('btnCloseCombinedModal')?.addEventListener('click', closeModal);
  document.getElementById('btnAuth')?.addEventListener('click', toggleAuthModal);
  document.getElementById('btnCloseAuthModal')?.addEventListener('click', toggleAuthModal);

  // Thêm điểm mới Card Controls
  const addPointCard = document.getElementById('addPointCard');
  document.getElementById('btnToggleAddCard')?.addEventListener('click', () => {
    if (addPointCard) addPointCard.style.display = addPointCard.style.display === 'block' ? 'none' : 'block';
  });
  document.getElementById('btnCloseAddCard')?.addEventListener('click', () => {
    if (addPointCard) addPointCard.style.display = 'none';
  });

  document.getElementById('btnPickOnMap')?.addEventListener('click', () => {
    state.isPickMode = true;
    const statusEl = document.getElementById('statusMsg');
    if (statusEl) {
      statusEl.style.color = "var(--accent-orange)";
      statusEl.innerText = "👉 Click trực tiếp trên bản đồ để chọn tọa độ...";
    }
  });

  // Submit Đề xuất Điểm mới
  document.getElementById('btnSubmitNewPoint')?.addEventListener('click', () => {
    const type = document.getElementById('newType')?.value;
    const name = document.getElementById('newName')?.value;
    const lat = document.getElementById('newLat')?.value;
    const lng = document.getElementById('newLng')?.value;
    const ward = document.getElementById('newWard')?.value || "Thuận Hóa";
    const size = document.getElementById('newSize')?.value || 0;
    const msg = document.getElementById('statusMsg');

    if (!name || !lat || !lng) {
      if (msg) {
        msg.style.color = "var(--accent-red)";
        msg.innerText = "⚠️ Vui lòng điền đủ Tên và Tọa độ!";
      }
      return;
    }

    if (msg) {
      msg.style.color = "var(--accent-orange)";
      msg.innerText = "🚀 Đang gửi đề xuất...";
    }

    const addUrl = `/api/gee?action=addPoint` +
      `&type=${encodeURIComponent(type)}` +
      `&name=${encodeURIComponent(name)}` +
      `&ward=${encodeURIComponent(ward)}` +
      `&lat=${lat}&lng=${lng}&size=${size}`;

    fetch(addUrl)
      .then(r => r.json())
      .then(() => {
        if (msg) {
          msg.style.color = "var(--accent-green)";
          msg.innerText = "✓ Đã lưu đề xuất thành công!";
        }
        
        state.rawDataList.push({
          id: "NEW-" + Date.now(),
          name, ward, type,
          lat: Number(lat), lng: Number(lng),
          size: Number(size), radius: 500,
          status: false
        });

        renderGroupedPoints();
        setTimeout(() => { if (addPointCard) addPointCard.style.display = 'none'; }, 1500);
      })
      .catch(() => {
        if (msg) {
          msg.style.color = "var(--accent-red)";
          msg.innerText = "❌ Lỗi kết nối máy chủ!";
        }
      });
  });

  // 4. Nạp dữ liệu khởi tạo ban đầu
  try {
    const progressBar = document.getElementById('progressBar');
    const progressPercent = document.getElementById('progressPercent');
    if (progressBar) progressBar.style.width = "30%";
    if (progressPercent) progressPercent.innerText = "30%";

    const res = await fetch('/api/gee');
    const data = await res.json();
    state.rawDataList = data.rawDataList || [];

    if (progressBar) progressBar.style.width = "70%";
    if (progressPercent) progressPercent.innerText = "70%";

    renderGroupedPoints();
    await refreshHeatmapOnly();

    if (progressBar) progressBar.style.width = "100%";
    if (progressPercent) progressPercent.innerText = "100%";
  } catch (err) {
    console.error("Lỗi khởi tạo dữ liệu bản đồ:", err);
  }
});
