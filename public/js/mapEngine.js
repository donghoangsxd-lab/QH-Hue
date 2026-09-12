import { state, infraLabels, infraIcons } from './state.js';

export let map = null;
export let measureLayerGroup = null;

export const layers = {
  pop: L.layerGroup(),
  boundary: L.layerGroup(),
  heatmap: L.layerGroup(),
  c1: L.layerGroup(), b1: L.layerGroup(),
  c2: L.layerGroup(), b2: L.layerGroup(),
  c3: L.layerGroup(), b3: L.layerGroup(),
  c4: L.layerGroup(), b4: L.layerGroup(),
  c5: L.layerGroup(), b5: L.layerGroup(),
  c6: L.layerGroup(), b6: L.layerGroup(),
  c7: L.layerGroup(), b7: L.layerGroup(),
  c8: L.layerGroup(), b8: L.layerGroup(),
  c9: L.layerGroup(), b9: L.layerGroup()
};

let tileHeatmapLayer = null;

export function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function initMap() {
  map = L.map('map', { renderer: L.canvas() }).setView([16.4637, 107.5905], 13);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
    maxZoom: 18
  }).addTo(map);

  measureLayerGroup = L.layerGroup().addTo(map);

  layers.boundary.addTo(map);
  layers.heatmap.addTo(map);
  layers.c1.addTo(map); layers.c2.addTo(map); layers.c3.addTo(map);
  layers.c4.addTo(map); layers.c5.addTo(map); layers.c6.addTo(map);
  layers.c7.addTo(map); layers.c8.addTo(map); layers.c9.addTo(map);

  return map;
}

export function toggleLayer(layerKey, isChecked) {
  if (!map) return;
  if (isChecked) {
    if (layerKey === 'heatmap') {
      refreshHeatmapOnly();
    } else {
      map.addLayer(layers[layerKey]);
    }
  } else {
    map.removeLayer(layers[layerKey]);
  }

  const popBox = document.getElementById('popBox');
  const heatBox = document.getElementById('heatBox');
  if (layerKey === 'pop' && popBox) popBox.style.display = isChecked ? 'block' : 'none';
  if (layerKey === 'heatmap' && heatBox) heatBox.style.display = isChecked ? 'block' : 'none';
}

export function toggleBuffer(bufferKey, el) {
  if (!map) return;
  if (map.hasLayer(layers[bufferKey])) {
    map.removeLayer(layers[bufferKey]);
    if (el) el.classList.remove('active');
  } else {
    map.addLayer(layers[bufferKey]);
    if (el) el.classList.add('active');
  }
}

export function toggleMeasure(type) {
  if (state.activeMeasureType === type) {
    clearMeasure();
    return;
  }
  clearMeasure();
  state.activeMeasureType = type;

  const btnDist = document.getElementById('btnMeasureDist');
  const btnArea = document.getElementById('btnMeasureArea');

  if (type === 'distance' && btnDist) {
    btnDist.classList.add('active');
    btnDist.innerHTML = "❌ HUỶ";
  } else if (type === 'area' && btnArea) {
    btnArea.classList.add('active');
    btnArea.innerHTML = "❌ HUỶ";
  }
}

export function clearMeasure() {
  state.activeMeasureType = null;
  state.measurePoints = [];
  if (measureLayerGroup) measureLayerGroup.clearLayers();

  const btnDist = document.getElementById('btnMeasureDist');
  const btnArea = document.getElementById('btnMeasureArea');
  if (btnDist) {
    btnDist.classList.remove('active');
    btnDist.innerHTML = "📏 CHIỀU DÀI";
  }
  if (btnArea) {
    btnArea.classList.remove('active');
    btnArea.innerHTML = "📐 DIỆN TÍCH";
  }
}

export function renderGroupedPoints() {
  if (!map) return;

  const mapGroups = {
    "1-CV": layers.c1, "2-BDX": layers.c2, "3-MN": layers.c3,
    "4-TH": layers.c4, "5-THCS": layers.c5, "6-YT": layers.c6,
    "7-VH": layers.c7, "8-TM": layers.c8, "9-CSD": layers.c9
  };

  const bufferGroups = {
    "1-CV": layers.b1, "2-BDX": layers.b2, "3-MN": layers.b3,
    "4-TH": layers.b4, "5-THCS": layers.b5, "6-YT": layers.b6,
    "7-VH": layers.b7, "8-TM": layers.b8, "9-CSD": layers.b9
  };

  Object.keys(mapGroups).forEach(k => mapGroups[k].clearLayers());
  Object.keys(bufferGroups).forEach(k => bufferGroups[k].clearLayers());

  state.rawDataList.forEach(p => {
    const isApproved = (p.status === true || p.status === 'true' || p.status === 'TRUE');
    const cfg = infraIcons[p.type] || { symbol: "🏢", border: "var(--accent-cyan)" };
    const targetGroup = mapGroups[p.type] || layers.c9;
    const targetBufferGroup = bufferGroups[p.type] || layers.b9;

    if (!isApproved) {
      if (p.type !== "9-CSD") {
        const pendingBuffer = L.circle([p.lat, p.lng], {
          radius: Number(p.radius) || 500,
          color: 'var(--accent-red)', weight: 2, dashArray: '6, 6',
          fillColor: 'var(--accent-red)', fillOpacity: 0.12
        });
        targetBufferGroup.addLayer(pendingBuffer);
      }

      const pendingDivIcon = L.divIcon({
        className: 'custom-infra-icon pending-border',
        html: `<div>${cfg.symbol}</div>`,
        iconSize: [27, 27], iconAnchor: [13.5, 13.5]
      });

      const pendingMarker = L.marker([p.lat, p.lng], { icon: pendingDivIcon });
      pendingMarker.on('click', () => onPointClick(p, pendingMarker));
      targetGroup.addLayer(pendingMarker);

    } else {
      if (p.type !== "9-CSD") {
        const officialBuffer = L.circle([p.lat, p.lng], {
          radius: state.globalBufferRadius,
          color: cfg.border, weight: 1.2,
          fillColor: cfg.border, fillOpacity: 0.12
        });
        targetBufferGroup.addLayer(officialBuffer);
      }

      const customDivIcon = L.divIcon({
        className: 'custom-infra-icon',
        html: `<div style="color:${cfg.border}">${cfg.symbol}</div>`,
        iconSize: [27, 27], iconAnchor: [13.5, 13.5]
      });

      const marker = L.marker([p.lat, p.lng], { icon: customDivIcon });
      marker.on('click', () => onPointClick(p, marker));
      targetGroup.addLayer(marker);
    }
  });
}

export async function refreshHeatmapOnly() {
  const heatOpacityEl = document.getElementById('heatOpacity');
  const currentOpacity = heatOpacityEl ? heatOpacityEl.value / 100 : 0.5;

  const customRadius = Number(document.getElementById('inputIsoRadius')?.value) || state.globalBufferRadius || 500;
  const activeFeatures = state.rawDataList
    .filter(item => item.status && item.type !== "9-CSD")
    .map(item => ({ ...item, radius: customRadius }));

  try {
    const isoRes = await fetch('/api/gee?action=getIsochrone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features: activeFeatures })
    });
    const isoData = await isoRes.json();

    const heatRes = await fetch(`/api/gee?action=getHeatmapTile&t=${Date.now()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features: isoData.features })
    });
    const d = await heatRes.json();

    if (d.urlFormat) {
      layers.heatmap.clearLayers();
      tileHeatmapLayer = L.tileLayer(d.urlFormat, { opacity: currentOpacity });
      const chkHeat = document.getElementById('chk_heat');
      if (chkHeat && chkHeat.checked && map) {
        tileHeatmapLayer.addTo(layers.heatmap);
      }
    }
  } catch (err) {
    console.error("Lỗi cập nhật Heatmap:", err);
  }
}

export async function refreshNetworkIsochrones() {
  if (!map) return;
  if (!state.isochroneLayerGroup) {
    state.isochroneLayerGroup = L.layerGroup().addTo(map);
  }
  state.isochroneLayerGroup.clearLayers();

  const customRadius = Number(document.getElementById('inputIsoRadius')?.value) || state.globalBufferRadius || 500;
  const activeFeatures = state.rawDataList
    .filter(item => item.status && item.type !== "9-CSD")
    .map(item => ({ ...item, radius: customRadius }));

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

export function onPointClick(p, marker) {
  if (state.isInspectMode) return;
  const isApproved = (p.status === true || p.status === 'true' || p.status === 'TRUE');
  const customRadius = Number(document.getElementById('inputIsoRadius')?.value) || 500;

  let contentHtml = `<div style="font-size:11px;">`;
  if (!isApproved) {
    contentHtml += `<b style="color:var(--accent-red);">🏢 ${p.name}</b> <span class="badge-pending">DỰ KIẾN</span><br>`;
  } else {
    contentHtml += `<b style="color:var(--accent-cyan);">🏢 ${p.name}</b><br>`;
  }

  contentHtml += `• Loại hạ tầng: <b>${infraLabels[p.type] || p.type}</b><br>`;
  contentHtml += `• Địa bàn: <b>Phường/Xã ${p.ward}</b><br>`;
  contentHtml += `• Diện tích: <b>${(p.size || 0).toLocaleString()} m²</b><br>`;

  if (!isApproved) {
    contentHtml += `<div id="servedPopText">
      <div style="color:var(--accent-red); font-weight:bold; margin-top:4px;">• Dân số phục vụ DỰ KIẾN: <span id="popValText">0%</span></div>
      <div class="inline-progress-bg"><div class="inline-progress-fill" style="background:var(--accent-red);" id="popValBar"></div></div>
    </div>`;

    if (state.currentUserRole === "ADMIN") {
      contentHtml += `<button onclick="window.approvePointStatus('${p.id}')" style="width:100%; margin-top:8px; background:var(--accent-green); color:#0f172a; border:none; padding:6px; border-radius:4px; font-weight:bold; cursor:pointer;">
        ✅ PHÊ DUYỆT CHÍNH THỨC (ADMIN)
      </button>`;
    } else {
      contentHtml += `<div style="margin-top:6px; font-size:10px; color:var(--accent-orange); font-style:italic; text-align:center;">
        ⏳ Đang chờ Quản trị viên (Admin) phê duyệt.
      </div>`;
    }
    contentHtml += `</div>`;

    const popup = L.popup({ closeButton: true, autoPan: true }).setLatLng([p.lat, p.lng]).setContent(contentHtml);
    popup.openOn(map);

    fetch(`/api/gee?action=analyzePoint&lat=${p.lat}&lng=${p.lng}&radius=${p.radius}`)
      .then(r => r.json())
      .then(res => {
        const popVal = res.servedPop || 0;
        const popContainer = document.getElementById('servedPopText');
        if (popContainer) {
          popContainer.innerHTML = `• Dân số phục vụ DỰ KIẾN: ~<b style="color:var(--accent-red);">${popVal.toLocaleString()} người</b>`;
        }
      });

  } else if (p.type !== "9-CSD") {
    contentHtml += `<div id="servedPopText">
      <div style="color:var(--accent-orange); font-weight:bold; margin-top:4px;">• Dân số phục vụ CHÍNH THỨC: <span id="popValText">0%</span></div>
      <div class="inline-progress-bg"><div class="inline-progress-fill" style="background:var(--accent-orange);" id="popValBar"></div></div>
    </div>`;
    contentHtml += `</div>`;

    const popup = L.popup({ closeButton: true, autoPan: true }).setLatLng([p.lat, p.lng]).setContent(contentHtml);
    popup.openOn(map);

    fetch(`/api/gee?action=analyzePoint&lat=${p.lat}&lng=${p.lng}&radius=${customRadius}`)
      .then(r => r.json())
      .then(res => {
        const popVal = res.servedPop || 0;
        const popContainer = document.getElementById('servedPopText');
        if (popContainer) {
          popContainer.innerHTML = `• Dân số phục vụ: ~<b style="color:var(--accent-orange);">${popVal.toLocaleString()} người</b>`;
        }
      });
  } else {
    contentHtml += `<div style="color:var(--accent-orange); font-weight:bold; margin-top:4px;">💡 ĐỀ XUẤT CHUYỂN ĐỔI CÔNG NĂNG:</div>`;
    contentHtml += `<div id="csdSug"><div style="font-size:10px; color:var(--text-muted);">⏳ Đang tính toán không gian...</div></div></div>`;

    const popup = L.popup({ closeButton: true, autoPan: true }).setLatLng([p.lat, p.lng]).setContent(contentHtml);
    popup.openOn(map);

    fetch(`/api/gee?action=analyzeCSD&lat=${p.lat}&lng=${p.lng}&size=${p.size}&ward=${encodeURIComponent(p.ward)}`)
      .then(r => r.json())
      .then(res => {
        let sugHtml = "";
        (res.suggestions || []).forEach(s => {
          if (s.isWardDeficit) {
            const priorityBadge = s.isTopPriority ? `<span class="badge-priority">ƯU TIÊN HÀNG ĐẦU</span>` : "";
            const cls = s.isTopPriority ? "sug-card priority" : "sug-card";
            sugHtml += `<div class="${cls}"><div>🚩 <b>${s.label}</b> ${priorityBadge}</div><div style="color:var(--text-muted); margin-top:2px;">└ Phường thiếu: <b>${s.deficitArea.toLocaleString()} m²</b> | Phục vụ thêm: ~${s.popGained.toLocaleString()} ng</div></div>`;
          } else {
            sugHtml += `<div class="sug-card"><div>✓ <b>${s.label}</b></div><div style="color:var(--text-muted); margin-top:2px;">└ Đã đạt chỉ tiêu | Phục vụ thêm: ~${s.popGained.toLocaleString()} ng</div></div>`;
          }
        });
        (res.ineligible || []).forEach(inEl => {
          sugHtml += `<div class="sug-card ineligible">❌ <b>${inEl.label}</b> (Không đủ DT min: ${inEl.minSize}m²)</div>`;
        });
        const sugContainer = document.getElementById('csdSug');
        if (sugContainer) sugContainer.innerHTML = sugHtml || "<div class='sug-card'>✓ Vị trí đã phủ đủ hạ tầng.</div>";
      });
  }
}

export function handleInspectPointClick(clickLat, clickLng) {
  const customRadius = Number(document.getElementById('inputIsoRadius')?.value) || 500;
  
  if (state.tempMarker) map.removeLayer(state.tempMarker);
  state.tempMarker = L.marker([clickLat, clickLng]).addTo(map);

  const coveredGroups = {};
  const missingCodes = [];

  const codes = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];
  codes.forEach(code => {
    const itemsOfCode = state.rawDataList.filter(item => {
      const isApproved = (item.status === true || item.status === 'true' || item.status === 'TRUE');
      return item.type === code && isApproved;
    });

    itemsOfCode.forEach(item => {
      const dist = getDistanceMeters(clickLat, clickLng, item.lat, item.lng);
      if (dist <= customRadius) {
        if (!coveredGroups[code]) coveredGroups[code] = [];
        coveredGroups[code].push(item.name);
      }
    });

    if (!coveredGroups[code]) missingCodes.push(code);
  });

  const coveredCount = Object.keys(coveredGroups).length;
  const missingCount = missingCodes.length;

  fetch(`/api/gee?action=getWardFromPoint&lat=${clickLat.toFixed(6)}&lng=${clickLng.toFixed(6)}`)
    .then(r => r.json())
    .then(resWard => {
      const wardName = resWard.ward || "Thuận Hóa";

      let resultHtml = `<div style="font-size:11px;">
        <b style="color:var(--accent-cyan);">📊 MẬT ĐỘ HẠ TẦNG TẠI VỊ TRÍ</b><br>
        <span style="color:var(--text-muted);">📍 Địa bàn: <b>Phường/Xã ${wardName}</b> | 🛤️ Bán kính: <b style="color:var(--accent-green);">${customRadius}m</b></span><br>

        <div style="font-weight:bold; color:var(--accent-green); margin-top:6px;">
          1. Tiếp cận: ${coveredCount}/8 nhóm
        </div>`;

      if (coveredCount > 0) {
        Object.keys(coveredGroups).forEach(code => {
          const names = coveredGroups[code].join(', ');
          resultHtml += `<div class="sug-card">• <b>${infraLabels[code] || code}:</b><br><span style="color:var(--accent-cyan);">└ ${names}</span></div>`;
        });
      } else {
        resultHtml += `<div class="sug-card ineligible">(Chưa có hạ tầng phủ đến)</div>`;
      }

      resultHtml += `<div style="font-weight:bold; color:var(--accent-red); margin-top:6px;">
        2. Chưa tiếp cận: ${missingCount}/8 nhóm
      </div>`;

      if (missingCount > 0) {
        missingCodes.forEach(code => {
          resultHtml += `<div class="sug-card ineligible">❌ ${infraLabels[code] || code}</div>`;
        });
      } else {
        resultHtml += `<div class="sug-card priority">✓ Vị trí tiếp cận đủ 8 nhóm hạ tầng!</div>`;
      }

      resultHtml += `</div>`;
      
      L.popup({ closeButton: true, autoPan: true })
        .setLatLng([clickLat, clickLng])
        .setContent(resultHtml)
        .openOn(map);
    });
}

export function approvePointStatus(pointId) {
  if (state.currentUserRole !== "ADMIN") return;
  const target = state.rawDataList.find(x => x.id === pointId);
  if (!target) return;

  target.status = true;
  renderGroupedPoints();
  map.closePopup();

  fetch(`/api/gee?action=approvePoint&id=${encodeURIComponent(pointId)}`)
    .then(r => r.json())
    .then(() => {
      refreshHeatmapOnly();
    });
}

window.approvePointStatus = approvePointStatus;
