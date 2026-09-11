import { map, initMap, toggleInspectMode, enablePickMode, toggleMeasure } from './modules/mapManager.js';
import { loadDataParallel, toggleLayer, toggleBuffer, changePopOpacity, changeHeatOpacity, debouncedChangeBufferRadius } from './modules/layerManager.js';
import { toggleAuthModal } from './modules/authManager.js';
import { submitNewPoint } from './modules/analytics.js';
import { openCombinedModal, closeModal } from './modules/uiModal.js';

document.addEventListener('DOMContentLoaded', () => {
  // 1. Khởi tạo Bản đồ
  initMap();

  // 2. Nạp dữ liệu GEE & GCS
  loadDataParallel();

  // 3. Gán sự kiện Nút Bấm UI
  document.getElementById('btnToggleSidebar').onclick = () => {
    const panel = document.getElementById('sidebarPanel');
    panel.classList.toggle('open');
    panel.classList.toggle('closed');
  };

  document.getElementById('btnCloseSidebar').onclick = () => {
    const panel = document.getElementById('sidebarPanel');
    panel.classList.remove('open');
    panel.classList.add('closed');
  };

  document.getElementById('tabBtnLayers').onclick = () => switchTab('layers');
  document.getElementById('tabBtnLegend').onclick = () => switchTab('legend');

  document.getElementById('btnZoomIn').onclick = () => map.zoomIn();
  document.getElementById('btnZoomOut').onclick = () => map.zoomOut();
  document.getElementById('btnMeasureDist').onclick = () => toggleMeasure('distance');
  document.getElementById('btnMeasureArea').onclick = () => toggleMeasure('area');

  document.getElementById('btnInspectMode').onclick = toggleInspectMode;
  document.getElementById('btnToggleAddCard').onclick = () => {
    const card = document.getElementById('addPointCard');
    card.style.display = card.style.display === 'block' ? 'none' : 'block';
  };
  document.getElementById('btnCloseAddCard').onclick = () => {
    document.getElementById('addPointCard').style.display = 'none';
  };
  document.getElementById('btnOpenModal').onclick = openCombinedModal;
  document.getElementById('btnCloseModal').onclick = closeModal;

  document.getElementById('btnAuth').onclick = toggleAuthModal;
  document.getElementById('btnCloseAuthModal').onclick = toggleAuthModal;

  document.getElementById('btnEnablePickMode').onclick = enablePickMode;
  document.getElementById('btnSubmitNewPoint').onclick = submitNewPoint;

  // 4. Gán sự kiện Checkbox & Sliders Lớp dữ liệu
  const layerCheckboxes = ['pop', 'bound', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'heat'];
  layerCheckboxes.forEach(key => {
    const chk = document.getElementById(`chk_${key}`);
    if (chk) {
      const mapKey = key === 'bound' ? 'boundary' : (key === 'heat' ? 'heatmap' : key);
      chk.onchange = (e) => toggleLayer(mapKey, e.target.checked);
    }
  });

  document.querySelectorAll('.btn-dot-buffer').forEach(btn => {
    btn.onclick = (e) => {
      const bKey = e.target.getAttribute('data-buffer');
      toggleBuffer(bKey, e.target);
    };
  });

  document.getElementById('popOpacity').oninput = (e) => changePopOpacity(e.target.value);
  document.getElementById('heatOpacity').oninput = (e) => changeHeatOpacity(e.target.value);
  document.getElementById('radiusSlider').onchange = (e) => debouncedChangeBufferRadius(e.target.value);
});

function switchTab(tab) {
  document.getElementById('tabLayers').style.display = tab === 'layers' ? 'block' : 'none';
  document.getElementById('tabLegend').style.display = tab === 'legend' ? 'block' : 'none';
  document.getElementById('tabBtnLayers').classList.toggle('active', tab === 'layers');
  document.getElementById('tabBtnLegend').classList.toggle('active', tab === 'legend');
}
