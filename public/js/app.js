import { state } from './state.js';
import { initMap, toggleMeasure } from './modules/mapManager.js';
import { initDefaultLayers, toggleLayer, toggleBuffer, renderGroupedPoints, refreshHeatmapOnly } from './modules/layerManager.js';
import { handleInspectPointClick } from './modules/analytics.js';

document.addEventListener('DOMContentLoaded', async () => {
  const map = initMap();
  initDefaultLayers(map);

  // Lắng nghe sự kiện click trên bản đồ cho chế độ TRA CỨU / PHÂN TÍCH ISOCHRONE
  map.on('click', (e) => {
    if (state.isInspectMode) {
      handleInspectPointClick(map, e.latlng.lat, e.latlng.lng);
    }
  });

  // Sự kiện Nút bấm trên Toolbar
  document.getElementById('btnMeasureDist')?.addEventListener('click', () => toggleMeasure('distance'));
  document.getElementById('btnMeasureArea')?.addEventListener('click', () => toggleMeasure('area'));

  // Sự kiện Nút Tra cứu điểm (Bật/Tắt chế độ Inspect)
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

  // Sự kiện Checkbox Bật/Tắt các Lớp dữ liệu
  const layerCheckboxes = ['pop', 'bound', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'heat'];
  layerCheckboxes.forEach(key => {
    const el = document.getElementById(`chk_${key}`);
    el?.addEventListener('change', (e) => {
      const targetLayer = key === 'bound' ? 'boundary' : key;
      toggleLayer(targetLayer, e.target.checked);
    });
  });

  // Sự kiện các Nút Dot Buffer
  document.querySelectorAll('.btn-dot-buffer').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bufferKey = e.target.getAttribute('data-buffer');
      if (bufferKey) toggleBuffer(bufferKey, e.target);
    });
  });

  // Nạp dữ liệu ban đầu từ Backend
  try {
    const res = await fetch('/api/gee');
    const data = await res.json();
    state.rawDataList = data.rawDataList || [];
    renderGroupedPoints(map);
    await refreshHeatmapOnly();
  } catch (err) {
    console.error("Lỗi nạp dữ liệu ban đầu:", err);
  }
});
