import { state } from './modules/state.js';
import { CONFIG } from './modules/config.js';
import { initMap, toggleMeasure } from './modules/mapManager.js';
import { 
  initDefaultLayers, 
  toggleLayer, 
  toggleBuffer, 
  renderGroupedPoints, 
  refreshHeatmapOnly,
  refreshNetworkIsochrones 
} from './modules/layerManager.js';
import { handleInspectPointClick } from './modules/analytics.js';

document.addEventListener('DOMContentLoaded', async () => {
  const map = initMap();
  initDefaultLayers(map);

  // 1. LẮNG NGHE SỰ KIỆN CLICK BẢN ĐỒ (TRA CỨU VỊ TRÍ)
  map.on('click', (e) => {
    if (state.isInspectMode) {
      handleInspectPointClick(map, e.latlng.lat, e.latlng.lng);
    }
  });

  // 2. SỰ KIỆN NÚT BẤM CÔNG CỤ ĐO ĐẠC (TOOLBAR)
  document.getElementById('btnMeasureDist')?.addEventListener('click', () => toggleMeasure('distance'));
  document.getElementById('btnMeasureArea')?.addEventListener('click', () => toggleMeasure('area'));
  document.getElementById('btnZoomIn')?.addEventListener('click', () => map.zoomIn());
  document.getElementById('btnZoomOut')?.addEventListener('click', () => map.zoomOut());

  // 3. SỰ KIỆN NÚT TRA CỨU ĐIỂM (INSPECT MODE)
  const btnInspectMode = document.getElementById('btnInspectMode');
  btnInspectMode?.addEventListener('click', () => {
    state.isInspectMode = !state.isInspectMode;
    if (state.isInspectMode) {
      btnInspectMode.classList.add('active');
      btnInspectMode.innerHTML = "🖱️❓ ĐANG CHỌN...";
      document.getElementById('map')?.classList.add('inspect-mode');
    } else {
      btnInspectMode.classList.remove('active');
      btnInspectMode.innerHTML = "🖱️ TRA CỨU ĐIỂM";
      document.getElementById('map')?.classList.remove('inspect-mode');
    }
  });

  // 4. BỔ SUNG: SỰ KIỆN NHẬP BÁN KÍNH ISOCHRONE GIAO THÔNG
  const inputIsoRadius = document.getElementById('inputIsoRadius');
  inputIsoRadius?.addEventListener('change', (e) => {
    const val = Number(e.target.value) || 500;
    state.globalBufferRadius = val;
    refreshNetworkIsochrones(map);
  });

  // 5. SỰ KIỆN CHECKBOX BẬT/TẮT LỚP DỮ LIỆU (BAO GỒM CHK_ISOCHRONE)
  const layerCheckboxes = ['pop', 'bound', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'heat', 'isochrone'];
  layerCheckboxes.forEach(key => {
    const el = document.getElementById(`chk_${key}`);
    el?.addEventListener('change', (e) => {
      const targetLayer = key === 'bound' ? 'boundary' : key;
      toggleLayer(targetLayer, e.target.checked);
    });
  });

  // 6. SỰ KIỆN CÁC NÚT DOT BUFFER
  document.querySelectorAll('.btn-dot-buffer').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bufferKey = e.target.getAttribute('data-buffer');
      if (bufferKey) toggleBuffer(bufferKey, e.target);
    });
  });

  // 7. SỰ KIỆN MỞ/ĐÓNG SIDEBAR & MODAL UI
  document.getElementById('btnToggleSidebar')?.addEventListener('click', () => {
    document.getElementById('sidebarPanel')?.classList.toggle('closed');
  });
  document.getElementById('btnCloseSidebar')?.addEventListener('click', () => {
    document.getElementById('sidebarPanel')?.classList.add('closed');
  });

  document.getElementById('tabBtnLayers')?.addEventListener('click', () => {
    document.getElementById('tabLayers').style.display = 'block';
    document.getElementById('tabLegend').style.display = 'none';
    document.getElementById('tabBtnLayers').classList.add('active');
    document.getElementById('tabBtnLegend').classList.remove('active');
  });
  document.getElementById('tabBtnLegend')?.addEventListener('click', () => {
    document.getElementById('tabLayers').style.display = 'none';
    document.getElementById('tabLegend').style.display = 'block';
    document.getElementById('tabBtnLayers').classList.remove('active');
    document.getElementById('tabBtnLegend').classList.add('active');
  });

  // 8. NẠP DỮ LIỆU BAN ĐẦU TỪ BACKEND
  try {
    const res = await fetch('/api/gee');
    const data = await res.json();
    state.rawDataList = data.rawDataList || [];
    renderGroupedPoints(map);
    await refreshHeatmapOnly();
    await refreshNetworkIsochrones(map);
  } catch (err) {
    console.error("Lỗi nạp dữ liệu ban đầu:", err);
  }
});
