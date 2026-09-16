import { state, infraLabels, infraIcons } from './state.js';

export let map = null;
export let measureLayerGroup = null;

export const layers = {
  pop: L.layerGroup(),
  boundary: L.layerGroup(),
  highlightWard: L.layerGroup(),
  heatmap: L.layerGroup(),
  singleIso: L.layerGroup(),
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
let wardLabelMarkers = [];

// Kiểm tra 1 điểm (lat,lng) có nằm trong ranh giới hình học thật của 1 phường/xã hay không
function isPointInWardGeometry(lat, lng, geometry) {
  if (!geometry) return false;
  try {
    const pt = turf.point([lng, lat]);
    const poly = turf.feature(geometry);
    return turf.booleanPointInPolygon(pt, poly);
  } catch (e) {
    return false;
  }
}

// Trả về danh sách điểm hạ tầng thuộc phạm vi phường/xã đang chọn (lọc theo hình học ranh giới thật)
function getWardFilteredList(sourceList) {
  if (!state.selectedWard) return sourceList;
  const wardInfo = state.wardLabelsList.find(w => w.name === state.selectedWard);
  if (!wardInfo || !wardInfo.geometry) return sourceList;
  return sourceList.filter(p => isPointInWardGeometry(p.lat, p.lng, wardInfo.geometry));
}

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
  layers.highlightWard.addTo(map);
  layers.heatmap.addTo(map);
  layers.singleIso.addTo(map);
  layers.c1.addTo(map); layers.c2.addTo(map); layers.c3.addTo(map);
  layers.c4.addTo(map); layers.c5.addTo(map); layers.c6.addTo(map);
  layers.c7.addTo(map); layers.c8.addTo(map); layers.c9.addTo(map);

  map.on('zoomend', updateWardLabelFontSize);

  return map;
}

// TẢI RANH GIỚI 40 PHƯỜNG XÃ (TILE ẢNH) + TÊN PHƯỜNG XÃ TẠI VỊ TRÍ TÂM
export async function loadBoundaryLayer() {
  if (!map) return;

  try {
    const tileRes = await fetch('/api/gee?action=getBoundaryTile');
    const tileData = await tileRes.json();
    if (tileData.urlFormat) {
      const boundaryTile = L.tileLayer(tileData.urlFormat, { opacity: 0.9 });
      layers.boundary.addLayer(boundaryTile);
    }
  } catch (err) {
    console.error("Lỗi tải ranh giới 40 phường xã:", err);
  }

  try {
    const labelRes = await fetch('/api/gee?action=getWardLabels');
    const labelData = await labelRes.json();
    const labels = labelData.labels || [];
    state.wardLabelsList = labels;

    wardLabelMarkers = labels.map(item => {
      const icon = L.divIcon({
        className: 'ward-label-icon',
        html: `<span class="ward-label-text">${item.name}</span>`,
        iconSize: [0, 0]
      });
      const marker = L.marker([item.lat, item.lng], { icon, interactive: false });
      layers.boundary.addLayer(marker);
      return marker;
    });

    updateWardLabelFontSize();
  } catch (err) {
    console.error("Lỗi tải tên 40 phường xã:", err);
  }
}

// HÀM HIGHLIGHT RANH GIỚI PHƯỜNG KHI CHỌN TỪ DROPLIST
export function highlightWardBoundary(wardName) {
  if (!layers.highlightWard) return;
  layers.highlightWard.clearLayers();

  if (!wardName) return;

  const wardInfo = state.wardLabelsList.find(w => w.name === wardName);
  if (wardInfo && wardInfo.geometry) {
    const wardGeoJSON = {
      type: "Feature",
      geometry: wardInfo.geometry,
      properties: { name: wardName }
    };

    const highlightLayer = L.geoJSON(wardGeoJSON, {
      style: {
        color: '#fb923c',
        weight: 3.5,
        dashArray: '6,6',
        fillColor: '#fb923c',
        fillOpacity: 0.15
      }
    });

    layers.highlightWard.addLayer(highlightLayer);
  }
}

function updateWardLabelFontSize() {
  if (!map) return;
  const zoom = map.getZoom();

  const minZoom = 11, maxZoom = 17;
  const minSize = 8, maxSize = 16;
  const clampedZoom = Math.max(minZoom, Math.min(maxZoom, zoom));
  const fontSize = minSize + (clampedZoom - minZoom) * (maxSize - minSize) / (maxZoom - minZoom);

  document.querySelectorAll('.ward-label-text').forEach(el => {
    el.style.fontSize = fontSize.toFixed(1) + 'px';
  });
}

export function toggleLayer(layerKey, isChecked) {
  if (!map) return;
  if (isChecked) {
    if (layerKey === 'heatmap') {
      refreshHeatmapOnly();
    } else if (layers[layerKey]) {
      map.addLayer(layers[layerKey]);
    }
  } else {
    if (layers[layerKey]) {
      map.removeLayer(layers[layerKey]);
    }
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

  Object.keys(mapGroups).forEach(k => mapGroups[k].clearLayers());

  const sourceList = getWardFilteredList(state.rawDataList);

  sourceList.forEach(p => {
    const isApproved = (p.status === true || p.status === 'true' || p.status === 'TRUE');
    // Lấy cấu hình biểu tượng và màu sắc gốc từ bảng chú giải (infraIcons trong state.js)
    const cfg = infraIcons[p.type] || { symbol: "🏢", border: "var(--accent-cyan)" };
    const targetGroup = mapGroups[p.type] || layers.c9;

    // Thiết lập màu viền và kiểu nét đứt nếu trạng thái là FALSE (chưa duyệt)
    const strokeColor = isApproved ? (cfg.border || '#38bdf8') : '#f87171';
    const strokeDash = isApproved ? '' : 'stroke-dasharray="3,3"';

    // Cấu trúc SVG: Khung ghim giọt nước ngược + Hình tròn nền trắng (90% chiều rộng tâm) + Icon từ Chú Giải
    const svgPinHtml = `
      <svg width="34" height="42" viewBox="0 0 24 30" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0px 3px 5px rgba(0,0,0,0.6));">
        <!-- Khung ghim giọt nước ngược -->
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" 
              fill="${isApproved ? (cfg.border || '#38bdf8') : 'rgba(239, 68, 68, 0.2)'}" 
              stroke="${strokeColor}" 
              stroke-width="1.8" 
              ${strokeDash}/>
        
        <!-- Hình tròn nền trắng ở tâm (chiếm ~90% diện tích phần tròn phía trên) -->
        <circle cx="12" cy="9" r="4.8" fill="#ffffff" stroke="none"/>
      </svg>
      <div class="pin-inner-icon" style="position: absolute; top: 3.5px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; justify-content: center; font-size: 13px; line-height: 1;">
        ${cfg.symbol}
      </div>
    `;

    const customDivIcon = L.divIcon({
      className: 'custom-infra-icon',
      html: svgPinHtml,
      iconSize: [34, 42], 
      iconAnchor: [17, 42] // Mỏ neo đúng tại chóp nhọn phía đáy ghim
    });

    const marker = L.marker([p.lat, p.lng], { icon: customDivIcon });
    marker.on('click', () => onPointClick(p, marker));
    targetGroup.addLayer(marker);
  });
}

// HÀM HIGHLIGHT ĐƠN LẺ ISOCHRONE KHI CLICK CHỌN ĐIỂM
export async function highlightSingleIsochrone(lat, lng, radius) {
  if (!layers.singleIso) return;
  layers.singleIso.clearLayers();

  try {
    const res = await fetch(`/api/gee?action=getSingleIsochrone&lat=${lat}&lng=${lng}&radius=${radius}`);
    const data = await res.json();
    if (data && data.geometry) {
      const geoLayer = L.geoJSON(data, {
        style: {
          color: 'var(--accent-cyan)',
          weight: 2.5,
          dashArray: '5,5',
          fillColor: 'var(--accent-cyan)',
          fillOpacity: 0.18
        }
      });
      layers.singleIso.addLayer(geoLayer);
    }
  } catch (err) {
    console.error("Lỗi vẽ single isochrone:", err);
  }
}

export async function refreshHeatmapOnly() {
  const heatOpacityEl = document.getElementById('heatOpacity');
  const currentOpacity = heatOpacityEl ? heatOpacityEl.value / 100 : 0.5;
  const overrideRad = state.globalBufferRadiusOverride || 0;

  const bufferGroups = {
    "1-CV": layers.b1, "2-BDX": layers.b2, "3-MN": layers.b3,
    "4-TH": layers.b4, "5-THCS": layers.b5, "6-YT": layers.b6,
    "7-VH": layers.b7, "8-TM": layers.b8, "9-CSD": layers.b9
  };
  Object.keys(bufferGroups).forEach(k => bufferGroups[k].clearLayers());

  const scopedList = getWardFilteredList(state.rawDataList).filter(item => {
    if (item.type === "9-CSD") {
      const isApproved = (item.status === true || item.status === 'true' || item.status === 'TRUE');
      return isApproved;
    }
    return true;
  });

  const allFeaturesInput = scopedList.map(item => ({
    ...item,
    radius: overrideRad > 0 ? overrideRad : (Number(item.radius) || Number(item.banKinh) || 500)
  }));

  if (allFeaturesInput.length === 0) {
    layers.heatmap.clearLayers();
    return;
  }

  try {
    const isoRes = await fetch('/api/gee?action=getIsochrone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features: allFeaturesInput })
    });
    const isoData = await isoRes.json();
    const isoFeatures = (isoData && isoData.features) || [];

    isoFeatures.forEach(feat => {
      const props = feat.properties || {};
      const isApproved = (props.status === true || props.status === 'true' || props.status === 'TRUE');
      const cfg = infraIcons[props.type] || { border: "var(--accent-cyan)" };
      const targetBufferGroup = bufferGroups[props.type] || layers.b9;

      const style = isApproved
        ? { color: '#ffffff', weight: 1, fillColor: cfg.border || '#38bdf8', fillOpacity: 0.10 }
        : { color: 'var(--accent-red)', weight: 1.5, dashArray: '4,4', fillColor: 'var(--accent-red)', fillOpacity: 0.10 };

      targetBufferGroup.addLayer(L.geoJSON(feat, { style }));
    });

    const approvedFeatures = isoFeatures.filter(feat => {
      const s = feat.properties && feat.properties.status;
      return (s === true || s === 'true' || s === 'TRUE');
    });

    const heatRes = await fetch(`/api/gee?action=getHeatmapTile&t=${Date.now()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features: approvedFeatures })
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
    console.error("Lỗi cập nhật Buffer/Heatmap:", err);
  }
}

export function onPointClick(p, marker) {
  const isApproved = (p.status === true || p.status === 'true' || p.status === 'TRUE');
  const isCSDUnapproved = (p.type === "9-CSD" && !isApproved);
  const itemRadius = state.globalBufferRadiusOverride > 0 ? state.globalBufferRadiusOverride : (Number(p.radius) || Number(p.banKinh) || 500);

  if (!isCSDUnapproved) {
    highlightSingleIsochrone(p.lat, p.lng, itemRadius);
  }

  let contentHtml = `<div style="min-width:220px; font-size:11px;">`;
  contentHtml += `<b style="color:var(--accent-cyan); font-size:12px;">${p.name}</b>`;
  if (!isApproved) {
    contentHtml += `<span class="badge-pending">Chờ duyệt</span>`;
  }
  contentHtml += `<br><hr style="border-color:var(--border-color); margin:4px 0;">`;
  contentHtml += `• Loại hạ tầng: <b>${infraLabels[p.type] || p.type}</b><br>`;
  contentHtml += `• Địa bàn: <b>Phường/Xã ${p.ward}</b><br>`;
  contentHtml += `• Diện tích: <b>${(p.size || 0).toLocaleString()} m²</b><br>`;

  if (!isCSDUnapproved) {
    contentHtml += `• Bán kính phục vụ: <b style="color:var(--accent-cyan);">${itemRadius} m</b><br>`;
  }

  if (!isApproved) {
    if (!isCSDUnapproved) {
      contentHtml += `<div id="servedPopText">
        <div style="color:var(--accent-red); font-weight:bold; margin-top:4px;">• Dân số phục vụ DỰ KIẾN: <span id="popValText">0%</span></div>
        <div class="inline-progress-bg"><div class="inline-progress-fill" style="background:var(--accent-red);" id="popValBar"></div></div>
      </div>`;
    }

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

    if (!isCSDUnapproved) {
      fetch(`/api/gee?action=analyzePoint&lat=${p.lat}&lng=${p.lng}&radius=${itemRadius}`)
        .then(r => r.json())
        .then(res => {
          const popVal = res.servedPop || 0;
          const popContainer = document.getElementById('servedPopText');
          if (popContainer) {
            popContainer.innerHTML = `• Dân số phục vụ DỰ KIẾN: ~<b style="color:var(--accent-red);">${popVal.toLocaleString()} người</b>`;
          }
        });
    }

  } else if (p.type !== "9-CSD") {
    contentHtml += `<div id="servedPopText">
      <div style="color:var(--accent-orange); font-weight:bold; margin-top:4px;">• Dân số phục vụ CHÍNH THỨC: <span id="popValText">0%</span></div>
      <div class="inline-progress-bg"><div class="inline-progress-fill" style="background:var(--accent-orange);" id="popValBar"></div></div>
    </div>`;
    contentHtml += `</div>`;

    const popup = L.popup({ closeButton: true, autoPan: true }).setLatLng([p.lat, p.lng]).setContent(contentHtml);
    popup.openOn(map);

    fetch(`/api/gee?action=analyzePoint&lat=${p.lat}&lng=${p.lng}&radius=${itemRadius}`)
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

// TẢI LỚP RASTER DÂN SỐ
export async function loadPopulationLayer() {
  if (!map) return;
  try {
    const res = await fetch('/api/gee?action=getPopRasterTile');
    const data = await res.json();
    if (data.urlFormat) {
      const popOpacityEl = document.getElementById('popOpacity');
      const opacity = popOpacityEl ? popOpacityEl.value / 100 : 0.6;
      layers.pop.addLayer(L.tileLayer(data.urlFormat, { opacity }));
    }
  } catch (err) {
    console.error("Lỗi tải lớp raster dân số:", err);
  }
}

export async function handleInspectPointClick(clickLat, clickLng) {
  const checkRadius = state.globalBufferRadiusOverride || 500;
  
  if (state.tempMarker) map.removeLayer(state.tempMarker);
  state.tempMarker = L.marker([clickLat, clickLng]).addTo(map);

  const coveredGroups = {};
  const missingCodes = [];

  const codes = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];
  
  const activeItems = state.rawDataList.filter(item => {
    const isApproved = (item.status === true || item.status === 'true' || item.status === 'TRUE');
    return codes.includes(item.type) && isApproved;
  });

  try {
    const res = await fetch('/api/gee?action=getIsochrone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        features: activeItems.map(item => ({
          ...item,
          radius: state.globalBufferRadiusOverride || Number(item.radius) || Number(item.banKinh) || 500
        }))
      })
    });
    const isochroneGeoJSON = await res.json();
    const clickPointGeo = turf.point([clickLng, clickLat]);

    if (isochroneGeoJSON && isochroneGeoJSON.features) {
      isochroneGeoJSON.features.forEach(feat => {
        const code = feat.properties.type;
        const name = feat.properties.name;
        if (feat.geometry) {
          const polyFeature = turf.polygon(feat.geometry.coordinates);
          if (turf.booleanPointInPolygon(clickPointGeo, polyFeature)) {
            if (!coveredGroups[code]) coveredGroups[code] = [];
            if (!coveredGroups[code].includes(name)) {
              coveredGroups[code].push(name);
            }
          }
        }
      });
    }
  } catch (err) {
    console.error("Lỗi kiểm tra mạng lưới OSRM tại điểm:", err);
  }

  codes.forEach(code => {
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
        <span style="color:var(--text-muted);">📍 Địa bàn: <b>Phường/Xã ${wardName}</b> | 🛤️ Bán kính chuẩn: <b style="color:var(--accent-green);">${checkRadius}m</b></span><br>

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
