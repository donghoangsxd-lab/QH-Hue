import { state } from './modules/state.js';
import { infraLabels, infraIcons } from './config.js';
import { initMap, toggleMeasure } from './modules/mapManager.js';
import { 
  initDefaultLayers, 
  toggleLayer, 
  toggleBuffer, 
  renderGroupedPoints, 
  refreshHeatmapOnly
} from './modules/layerManager.js';
import { handleInspectPointClick } from './modules/analytics.js';

// Hàm gửi API tính và vẽ Isochrone Giao thông bám đường
export async function refreshNetworkIsochrones(map) {
  if (!state.isochroneLayerGroup) {
    state.isochroneLayerGroup = L.layerGroup().addTo(map);
  }
  state.isochroneLayerGroup.clearLayers();

  // Lấy bán kính động từ ô nhập #inputIsoRadius trên Toolbar
  const customRadius = Number(document.getElementById('inputIsoRadius')?.value) || state.globalBufferRadius || 500;

  const activeFeatures = state.rawDataList
    .filter(item => item.status && item.type !== "9-CSD")
    .map(item => ({
      ...item,
      radius: customRadius 
    }));

  if (activeFeatures.length === 0) return;

  try {
    const res = await fetch('/api/gee?action=getIsochrone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features: activeFeatures })
    });
    const isochroneGeoJSON = await res.json();

    const isoLayer = L.geoJSON(isochroneGeoJSON, {
      style: (feature) => ({
        color: infraIcons[feature.properties.type]?.border || "#38bdf8",
        weight: 1.8,
        fillColor: infraIcons[feature.properties.type]?.border || "#38bdf8",
        fillOpacity: 0.2
      }),
      onEachFeature: (feature, layer) => {
        layer.bindPopup(
          `<b>${feature.properties.name}</b><br>` +
          `• Bán kính giao thông: <b>${feature.properties.banKinh}m</b><br>` +
          `<small style="color:var(--accent-cyan);">• Thuật toán: 90% Giao thông OSRM + 10% Offset</small>`
        );
      }
    });

    state.isochroneLayerGroup.addLayer(isoLayer);
  } catch (err) {
    console.error("Lỗi vẽ Isochrones:", err);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const map = initMap();
  initDefaultLayers(map);

  map.on('click', (e) => {
    if (state.isInspectMode) {
      handleInspectPointClick(map, e.latlng.lat, e.latlng.lng);
    }
  });

  document.getElementById('btnMeasureDist')?.addEventListener('click', () => toggleMeasure('distance'));
  document.getElementById('btnMeasureArea')?.addEventListener('click', () => toggleMeasure('area'));
  document.getElementById('btnZoomIn')?.addEventListener('click', () => map.zoomIn());
  document.getElementById('btnZoomOut')?.addEventListener('click', () => map.zoomOut());

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

  // Lắng nghe sự kiện đổi ô nhập Bán kính Isochrone
  const inputIsoRadius = document.getElementById('inputIsoRadius');
  inputIsoRadius?.addEventListener('change', (e) => {
    state.globalBufferRadius = Number(e.target.value) || 500;
    refreshNetworkIsochrones(map);
  });

  const layerCheckboxes = ['pop', 'bound', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'heat', 'isochrone'];
  layerCheckboxes.forEach(key => {
    const el = document.getElementById(`chk_${key}`);
    el?.addEventListener('change', (e) => {
      const targetLayer = key === 'bound' ? 'boundary' : key;
      if (key === 'isochrone') {
        if (e.target.checked) refreshNetworkIsochrones(map);
        else if (state.isochroneLayerGroup) state.isochroneLayerGroup.clearLayers();
      } else {
        toggleLayer(targetLayer, e.target.checked);
      }
    });
  });

  document.querySelectorAll('.btn-dot-buffer').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bufferKey = e.target.getAttribute('data-buffer');
      if (bufferKey) toggleBuffer(bufferKey, e.target);
    });
  });

  document.getElementById('btnToggleSidebar')?.addEventListener('click', () => {
    document.getElementById('sidebarPanel')?.classList.toggle('closed');
  });
  document.getElementById('btnCloseSidebar')?.addEventListener('click', () => {
    document.getElementById('sidebarPanel')?.classList.add('closed');
  });

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
