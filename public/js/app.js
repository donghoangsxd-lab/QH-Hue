import { state } from './state.js';
import { 
  initMap, 
  toggleLayer, 
  toggleBuffer, 
  toggleMeasure, 
  clearMeasure,
  renderGroupedPoints, 
  refreshHeatmapOnly, 
  handleInspectPointClick,
  loadBoundaryLayer,
  loadPopulationLayer,
  highlightWardBoundary, 
  measureLayerGroup,
  layers,
  map as mapInstance
} from './mapEngine.js';
import { 
  toggleAuthModal, 
  openCombinedModal, 
  closeModal,
  openWardDetailDirect
} from './uiComponents.js';

document.addEventListener('DOMContentLoaded', async () => {
  const map = initMap();

  map.on('click', (e) => {
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

    if (state.activeMeasureType) {
      const { lat, lng } = e.latlng;
      state.measurePoints.push([lng, lat]);

      if (measureLayerGroup) {
        L.circleMarker([lat, lng], { radius: 4, color: '#38bdf8', fillColor: '#38bdf8', fillOpacity: 1 }).addTo(measureLayerGroup);

        if (state.activeMeasureType === 'distance') {
          if (state.measurePoints.length >= 2) {
            const line = turf.lineString(state.measurePoints);
            const distanceMeters = turf.length(line, { units: 'meters' });
            
            measureLayerGroup.clearLayers();
            state.measurePoints.forEach(pt => {
              L.circleMarker([pt[1], pt[0]], { radius: 4, color: '#38bdf8', fillColor: '#38bdf8', fillOpacity: 1 }).addTo(measureLayerGroup);
            });

            const coords = state.measurePoints.map(pt => [pt[1], pt[0]]);
            L.polyline(coords, { color: '#38bdf8', weight: 3, dashArray: '4,4' }).addTo(measureLayerGroup);

            const textDist = distanceMeters >= 1000 ? `${(distanceMeters/1000).toFixed(2)} km` : `${Math.round(distanceMeters)} m`;
            L.popup({ closeButton: false, autoClose: false })
              .setLatLng([lat, lng])
              .setContent(`<b style="color:var(--accent-cyan);">📏 Chiều dài: ${textDist}</b>`)
              .openOn(map);
          }
        } else if (state.activeMeasureType === 'area') {
          if (state.measurePoints.length >= 3) {
            const closedCoords = [...state.measurePoints, state.measurePoints[0]];
            const polygon = turf.polygon([closedCoords]);
            const areaSqMeters = turf.area(polygon);

            measureLayerGroup.clearLayers();
            state.measurePoints.forEach(pt => {
              L.circleMarker([pt[1], pt[0]], { radius: 4, color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 1 }).addTo(measureLayerGroup);
            });

            const coords = closedCoords.map(pt => [pt[1], pt[0]]);
            L.polygon(coords, { color: '#f59e0b', weight: 2, fillColor: '#f59e0b', fillOpacity: 0.2 }).addTo(measureLayerGroup);

            const textArea = areaSqMeters >= 10000 ? `${(areaSqMeters/10000).toFixed(2)} ha` : `${Math.round(areaSqMeters)} m²`;
            L.popup({ closeButton: false, autoClose: false })
              .setLatLng([lat, lng])
              .setContent(`<b style="color:var(--accent-orange);">📐 Diện tích: ${textArea}</b>`)
              .openOn(map);
          }
        }
      }
      return;
    }

    if (state.isInspectMode) {
      handleInspectPointClick(e.latlng.lat, e.latlng.lng);
      return;
    }
  });

  document.getElementById('btnZoomIn')?.addEventListener('click', () => map.zoomIn());
  document.getElementById('btnZoomOut')?.addEventListener('click', () => map.zoomOut());
  document.getElementById('btnMeasureDist')?.addEventListener('click', () => toggleMeasure('distance'));
  document.getElementById('btnMeasureArea')?.addEventListener('click', () => toggleMeasure('area'));

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

  const inputIsoRadius = document.getElementById('inputIsoRadius');
  inputIsoRadius?.addEventListener('input', (e) => {
    state.globalBufferRadiusOverride = Number(e.target.value) || 500;
    renderGroupedPoints();
    refreshHeatmapOnly();
  });

  const heatOpacity = document.getElementById('heatOpacity');
  heatOpacity?.addEventListener('input', () => refreshHeatmapOnly());

  document.getElementById('popOpacity')?.addEventListener('input', (e) => {
    const val = e.target.value / 100;
    layers.pop.eachLayer(l => l.setOpacity && l.setOpacity(val));
  });
  
  const layerCheckboxes = ['pop', 'bound', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'heat'];
  layerCheckboxes.forEach(key => {
    const el = document.getElementById(`chk_${key}`);
    el?.addEventListener('change', (e) => {
      const targetLayer = key === 'bound' ? 'boundary' : key;
      toggleLayer(targetLayer, e.target.checked);
    });
  });

  document.querySelectorAll('.btn-dot-buffer').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bufferKey = e.target.getAttribute('data-buffer');
      if (bufferKey) toggleBuffer(bufferKey, e.target);
    });
  });

  document.getElementById('wardSelector')?.addEventListener('change', async (e) => {
    state.selectedWard = e.target.value || null;

    if (state.rawDataList.length === 0) {
      try {
        const res = await fetch('/api/gee');
        const data = await res.json();
        state.rawDataList = data.rawDataList || [];
      } catch (err) {
        console.error("Lỗi tải dữ liệu điểm hạ tầng:", err);
        return;
      }
    }

    // Tinh chỉnh logic chuyển phường: Không ép ghi đè toàn bộ checkbox lớp bản đồ, 
    // chỉ làm mới lại điểm, heatmap và ranh giới theo địa bàn được chọn.
    renderGroupedPoints();
    refreshHeatmapOnly();
    highlightWardBoundary(state.selectedWard);

    if (state.selectedWard && state.selectedWard !== "Thành phố Huế") {
      const target = state.wardLabelsList.find(w => w.name === state.selectedWard);
      if (target) map.flyTo([target.lat, target.lng], 13);
    } else {
      map.flyTo([16.4637, 107.5905], 12);
    }
  });
  
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

  document.getElementById('btnOpenCombinedModal')?.addEventListener('click', () => {
    if (state.selectedWard && state.selectedWard !== "Thành phố Huế") {
      openWardDetailDirect(state.selectedWard);
    } else {
      openCombinedModal();
    }
  });
  document.getElementById('btnCloseCombinedModal')?.addEventListener('click', closeModal);
  document.getElementById('btnAuth')?.addEventListener('click', toggleAuthModal);
  document.getElementById('btnCloseAuthModal')?.addEventListener('click', toggleAuthModal);

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

  try {
    const progressBar = document.getElementById('progressBar');
    const progressPercent = document.getElementById('progressPercent');
    if (progressBar) progressBar.style.width = "40%";
    if (progressPercent) progressPercent.innerText = "40%";

    await Promise.all([loadBoundaryLayer(), loadPopulationLayer()]);

    const wardSelector = document.getElementById('wardSelector');
    if (wardSelector) {
      state.wardLabelsList
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
        .forEach(item => {
          const opt = document.createElement('option');
          opt.value = item.name;
          opt.textContent = item.name;
          wardSelector.appendChild(opt);
        });
    }

    if (progressBar) progressBar.style.width = "100%";
    if (progressPercent) progressPercent.innerText = "100%";

    setTimeout(async () => {
      try {
        const res = await fetch('/api/gee');
        const data = await res.json();
        state.rawDataList = data.rawDataList || [];
      } catch (e) {
        console.log("Preload background data skipped.");
      }
    }, 500);

  } catch (err) {
    console.error("Lỗi khởi tạo dữ liệu tĩnh bản đồ:", err);
  }
});
