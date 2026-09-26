import { state, infraLabels, infraIcons } from './state.js';
import { updateInfraPieChart, hideInfraPieChart } from './uiComponents.js';
import { geeApi } from './api.js';

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
let lastCalculatedIsochrones = [];

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

function getWardFilteredList(sourceList) {
  if (!state.selectedWard || state.selectedWard === "Thành phố Huế") return sourceList;
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

export async function loadBoundaryLayer() {
  if (!map) return;

  try {
    const boundRes = await fetch(geeApi('action=getBoundaryVector'));
    const boundData = await boundRes.json();
    
    if (boundData && boundData.features) {
      const boundaryVectorLayer = L.geoJSON(boundData, {
        style: {
          color: '#ffffff',
          weight: 1.5,
          dashArray: '4, 4',
          fillColor: 'transparent',
          fillOpacity: 0
        }
      });
      layers.boundary.addLayer(boundaryVectorLayer);
    }
  } catch (err) {
    console.error("Lỗi tải ranh giới vector 40 phường xã:", err);
  }

  try {
    const labelRes = await fetch(geeApi('action=getWardLabels'));
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

export function highlightWardBoundary(wardName, { fitView = true } = {}) {
  if (!layers.highlightWard || !map) return;
  layers.highlightWard.clearLayers();

  if (!wardName || wardName === "Thành phố Huế") {
    if (fitView) map.flyTo([16.4637, 107.5905], 13);
    return;
  }

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

    if (fitView) {
      const bounds = highlightLayer.getBounds();
      if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, {
          padding: [48, 48],
          maxZoom: 15,
          animate: true,
          duration: 0.8
        });
      } else if (wardInfo.lat != null && wardInfo.lng != null) {
        map.flyTo([wardInfo.lat, wardInfo.lng], 14);
      }
    }
  } else if (fitView && wardInfo && wardInfo.lat != null && wardInfo.lng != null) {
    map.flyTo([wardInfo.lat, wardInfo.lng], 14);
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
      if (!map.hasLayer(layers.heatmap)) {
        map.addLayer(layers.heatmap);
      }
      if (tileHeatmapLayer && !layers.heatmap.hasLayer(tileHeatmapLayer)) {
        layers.heatmap.addLayer(tileHeatmapLayer);
      } else if (!tileHeatmapLayer) {
        refreshHeatmapOnly();
      }
    } else if (layers[layerKey]) {
      map.addLayer(layers[layerKey]);
    }
  } else {
    if (layerKey === 'heatmap') {
      if (map.hasLayer(layers.heatmap)) {
        map.removeLayer(layers.heatmap);
      }
    } else if (layers[layerKey]) {
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
    btnDist.innerHTML = "❌";
  } else if (type === 'area' && btnArea) {
    btnArea.classList.add('active');
    btnArea.innerHTML = "❌";
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
    btnDist.innerHTML = "📏";
  }
  if (btnArea) {
    btnArea.classList.remove('active');
    btnArea.innerHTML = "📐";
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

  if (state.selectedWard && state.selectedWard !== "Thành phố Huế") {
    updateInfraPieChart(sourceList);
  } else {
    hideInfraPieChart();
  }

  const iconFiles = {
    "1-CV": { approved: "Park.png", pending: "Park2.png" },
    "2-BDX": { approved: "Parking.png", pending: "Parking2.png" },
    "3-MN": { approved: "Mamnon.png", pending: "Mamnon2.png" },
    "4-TH": { approved: "Tieuhoc.png", pending: "Tieuhoc2.png" },
    "5-THCS": { approved: "THCS.png", pending: "THCS2.png" },
    "6-YT": { approved: "Yte.png", pending: "Yte2.png" },
    "7-VH": { approved: "Vanhoa.png", pending: "Vanhoa2.png" },
    "8-TM": { approved: "Cho.png", pending: "Cho2.png" },
    "9-CSD": { approved: "Unused.png", pending: "Unused2.png" }
  };

  sourceList.forEach(p => {
    const isApproved = (p.status === true || String(p.status).trim().toUpperCase() === 'TRUE' || String(p.status).trim() === '1');
    const targetGroup = mapGroups[p.type] || layers.c9;
    
    const categoryIcons = iconFiles[p.type] || { approved: "Park.png", pending: "Park2.png" };
    const fileName = isApproved ? categoryIcons.approved : categoryIcons.pending;
    const iconUrl = `./icons/${fileName}`;

    const imgHtml = `<img src="${iconUrl}" style="width: 22px; height: 27px; filter: drop-shadow(0px 2px 3px rgba(0,0,0,0.5));" />`;

    const customDivIcon = L.divIcon({
      className: 'custom-infra-icon-png',
      html: imgHtml,
      iconSize: [26, 32],
      iconAnchor: [13, 32]
    });

    const marker = L.marker([p.lat, p.lng], { icon: customDivIcon });
    marker.on('click', () => {
      if (state.isPickMode || state.activeMeasureType) return;
      onPointClick(p, marker);
    });
    targetGroup.addLayer(marker);
  });
}

export async function highlightSingleIsochrone(lat, lng, radius) {
  if (!layers.singleIso) return;
  layers.singleIso.clearLayers();

  try {
    const res = await fetch(geeApi(`action=getSingleIsochrone&lat=${lat}&lng=${lng}&radius=${radius}`));
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.geometry) {
      const geoLayer = L.geoJSON(data, {
        style: {
          color: '#ffffff',
          weight: 1.2,
          dashArray: '3,3',
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

let heatmapFetchSeq = 0;

export async function refreshHeatmapOnly() {
  const currentSeq = ++heatmapFetchSeq;
  const heatOpacityEl = document.getElementById('heatOpacity');
  const currentOpacity = heatOpacityEl ? heatOpacityEl.value / 100 : 0.3;
  const overrideRad = state.globalBufferRadiusOverride;

  const bufferGroups = {
    "1-CV": layers.b1, "2-BDX": layers.b2, "3-MN": layers.b3,
    "4-TH": layers.b4, "5-THCS": layers.b5, "6-YT": layers.b6,
    "7-VH": layers.b7, "8-TM": layers.b8, "9-CSD": layers.b9
  };
  Object.keys(bufferGroups).forEach(k => bufferGroups[k].clearLayers());

  const scopedList = getWardFilteredList(state.rawDataList).filter(item => {
    const isApproved = (item.status === true || String(item.status).trim().toUpperCase() === 'TRUE' || String(item.status).trim() === '1');
    if (item.type === "9-CSD") {
      return isApproved;
    }
    return true; 
  });

  const allFeaturesInput = scopedList.map(item => ({
    ...item,
    radius: overrideRad !== null ? overrideRad : (Number(item.radius) || Number(item.banKinh) || 500)
  }));

  if (allFeaturesInput.length === 0) {
    layers.heatmap.clearLayers();
    lastCalculatedIsochrones = [];
    return;
  }

  try {
    const isoRes = await fetch(geeApi('action=getIsochrone'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features: allFeaturesInput })
    });
    if (!isoRes.ok) return;
    const isoData = await isoRes.json();
    if (currentSeq !== heatmapFetchSeq) return;

    const isoFeatures = (isoData && isoData.features) || [];
    lastCalculatedIsochrones = isoFeatures;

    const infraBorderColors = {
      "1-CV": "#2ecc71",   // Công viên: Xanh lá
      "2-BDX": "#3498db",  // Bãi đỗ xe: Xanh dương
      "3-MN": "#e67e22",   // Mầm non: Vàng
      "4-TH": "#e74c3c",   // Tiểu học: Cam
      "5-THCS": "#9b59b6", // THCS: Cam đậm
      "6-YT": "#1abc9c",   // Y tế: Magenta
      "7-VH": "#f1c40f",   // Văn hóa: Đỏ
      "8-TM": "#e91e63",   // Thương mại: Đỏ đậm
      "9-CSD": "#95a5a6"   // Quỹ đất tiềm năng: Xám
    };

    isoFeatures.forEach(feat => {
      const props = feat.properties || {};
      const isApproved = (props.status === true || String(props.status).trim().toUpperCase() === 'TRUE' || String(props.status).trim() === '1');
      const targetBufferGroup = bufferGroups[props.type] || layers.b9;
      
      const typeColor = infraBorderColors[props.type] || '#38bdf8';

      const style = isApproved
        ? { color: typeColor, weight: 2.2, dashArray: '6, 6', fillColor: typeColor, fillOpacity: 0.12 }
        : { color: '#f87171', weight: 2.2, dashArray: '4, 4', fillColor: '#f87171', fillOpacity: 0.10 };

      targetBufferGroup.addLayer(L.geoJSON(feat, { style }));
    });

    const approvedFeatures = isoFeatures.filter(feat => {
      const s = feat.properties && feat.properties.status;
      return (s === true || String(s).trim().toUpperCase() === 'TRUE' || String(s).trim() === '1');
    });

    const heatRes = await fetch(geeApi(`action=getHeatmapTile&t=${Date.now()}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features: approvedFeatures })
    });
    if (!heatRes.ok) return;
    const d = await heatRes.json();
    if (currentSeq !== heatmapFetchSeq) return;

    if (d.urlFormat) {
      layers.heatmap.clearLayers();
      tileHeatmapLayer = L.tileLayer(d.urlFormat, { opacity: currentOpacity });
      window.currentHeatmapTileLayer = tileHeatmapLayer;
      
      const chkHeat = document.getElementById('chk_heat');
      if (chkHeat && chkHeat.checked && map) {
        layers.heatmap.addLayer(tileHeatmapLayer);
        if (!map.hasLayer(layers.heatmap)) {
          map.addLayer(layers.heatmap);
        }
      }
    }
  } catch (err) {
    console.error("Lỗi cập nhật Buffer/Heatmap theo địa bàn:", err);
  }
}

function formatCapCongTrinhLabel(raw) {
  if (!raw) return "Cấp đơn vị ở";
  const original = String(raw).trim();
  const s = original
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ");

  if (s.includes("do thi") || s.includes("urban") || s === "cap do thi") return "Cấp đô thị";
  if (s.includes("don vi") || s.includes("dvo") || s.includes("cap dvo") || s.includes("dvo")) return "Cấp đơn vị ở";
  if (original.includes("đô thị")) return "Cấp đô thị";
  if (original.includes("đơn vị")) return "Cấp đơn vị ở";
  return original;
}

function resolveWardNameFromCoords(lat, lng) {
  if (!state.wardLabelsList || state.wardLabelsList.length === 0) return null;
  for (const w of state.wardLabelsList) {
    if (w.geometry && isPointInWardGeometry(lat, lng, w.geometry)) return w.name;
  }
  return null;
}

function buildDiaBanHtml(geoWard, sheetWard) {
  const geo = (geoWard || "").trim();
  const sheet = (sheetWard || "").trim();
  if (!geo) {
    return sheet ? `Phường/Xã ${sheet}` : "Phường/Xã —";
  }
  let html = `Phường/Xã ${geo}`;
  const clean = (s) => String(s || "")
    .replace(/^Phường\s+/i, "").replace(/^Xã\s+/i, "")
    .trim().toLowerCase();
  if (sheet && clean(sheet) !== clean(geo)) {
    html += ` <span style="color:var(--accent-orange); font-size:9px; font-weight:normal;">(Sheet: ${sheet})</span>`;
  }
  return html;
}

export function onPointClick(p, marker) {
  const isApproved = (p.status === true || String(p.status).trim().toUpperCase() === 'TRUE' || String(p.status).trim() === '1');
  const isCSDUnapproved = (p.type === "9-CSD" && !isApproved);
  const overrideRad = state.globalBufferRadiusOverride;
  const itemRadius = overrideRad !== null ? overrideRad : (Number(p.radius) || Number(p.banKinh) || 500);

  if (!isCSDUnapproved) {
    highlightSingleIsochrone(p.lat, p.lng, itemRadius);
  }

  const capCongTrinh = formatCapCongTrinhLabel(p.nhomHaTang || p.capCongTrinh || "Cấp đơn vị ở");
  const geoWardNow = resolveWardNameFromCoords(p.lat, p.lng);
  const diaBanHtml = buildDiaBanHtml(geoWardNow, p.ward);

  let contentHtml = `<div style="min-width:220px; font-size:11px;">`;
  contentHtml += `<b style="color:var(--accent-cyan); font-size:12px;">${p.name}</b>`;
  if (!isApproved) {
    contentHtml += `<span class="badge-pending">Chờ duyệt</span>`;
  }
  
  let rawLabel = infraLabels[p.type] || p.type;
  if (rawLabel.includes("+")) {
    rawLabel = rawLabel.replace("+", `<span style="color:var(--accent-red); font-weight:bold;">+</span>`);
  }

  contentHtml += `<br><hr style="border-color:var(--border-color); margin:4px 0;">`;
  contentHtml += `• Loại hạ tầng: <b>${rawLabel}</b><br>`;
  contentHtml += `• Địa bàn: <b id="popupWardDiaBan">${diaBanHtml}</b><br>`;
  contentHtml += `• Cấp công trình: <b style="color:var(--accent-orange);">${capCongTrinh}</b><br>`;
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

    if (!geoWardNow) {
      fetch(geeApi(`action=getWardFromPoint&lat=${p.lat}&lng=${p.lng}`))
        .then(r => r.json())
        .then(res => {
          const el = document.getElementById('popupWardDiaBan');
          if (el) el.innerHTML = buildDiaBanHtml(res.ward, p.ward);
        })
        .catch(() => {});
    }

    if (!isCSDUnapproved) {
      fetch(geeApi(`action=analyzePoint&lat=${p.lat}&lng=${p.lng}&radius=${itemRadius}`))
        .then(r => r.json())
        .then(res => {
          const popVal = res.servedPop || 0;
          const popContainer = document.getElementById('servedPopText');
          if (popContainer) {
            popContainer.innerHTML = `• Dân số phục vụ: ~<b style="color:var(--accent-red);">${popVal.toLocaleString()} người</b>`;
          }
        });
    }

  } else if (p.type !== "9-CSD") {
    contentHtml += `<div id="servedPopText">
      <div style="color:var(--accent-orange); font-weight:bold; margin-top:4px;">• Dân số phục vụ: <span id="popValText">0%</span></div>
      <div class="inline-progress-bg"><div class="inline-progress-fill" style="background:var(--accent-orange);" id="popValBar"></div></div>
    </div>`;
    contentHtml += `</div>`;

    const popup = L.popup({ closeButton: true, autoPan: true }).setLatLng([p.lat, p.lng]).setContent(contentHtml);
    popup.openOn(map);

    if (!geoWardNow) {
      fetch(geeApi(`action=getWardFromPoint&lat=${p.lat}&lng=${p.lng}`))
        .then(r => r.json())
        .then(res => {
          const el = document.getElementById('popupWardDiaBan');
          if (el) el.innerHTML = buildDiaBanHtml(res.ward, p.ward);
        })
        .catch(() => {});
    }

    fetch(geeApi(`action=analyzePoint&lat=${p.lat}&lng=${p.lng}&radius=${itemRadius}`))
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

    if (!geoWardNow) {
      fetch(geeApi(`action=getWardFromPoint&lat=${p.lat}&lng=${p.lng}`))
        .then(r => r.json())
        .then(res => {
          const el = document.getElementById('popupWardDiaBan');
          if (el) el.innerHTML = buildDiaBanHtml(res.ward, p.ward);
        })
        .catch(() => {});
    }

    fetch(geeApi(`action=analyzeCSD&lat=${p.lat}&lng=${p.lng}&size=${p.size}&ward=${encodeURIComponent(geoWardNow || p.ward || '')}`))
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
        if (sugContainer) {
          const base = sugHtml || "<div class='sug-card'>✓ Vị trí đã phủ đủ hạ tầng.</div>";
          sugContainer.innerHTML = base + `<div style="margin-top:6px; font-size:10px; color:var(--accent-red); font-weight:bold; text-align:center;">(Cần phê duyệt)</div>`;
        }
      });
  }
}

export async function loadPopulationLayer() {
  if (!map) return;
  try {
    const res = await fetch(geeApi('action=getPopRasterTile'));
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
  const checkRadius = state.globalBufferRadiusOverride !== null ? state.globalBufferRadiusOverride : 500;
  
  if (state.tempMarker) map.removeLayer(state.tempMarker);
  state.tempMarker = L.marker([clickLat, clickLng]).addTo(map);

  const coveredGroups = {};
  const missingCodes = [];

  const codes = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];
  
  let isochroneFeatures = lastCalculatedIsochrones;

  if (!isochroneFeatures || isochroneFeatures.length === 0) {
    const activeItems = state.rawDataList.filter(item => {
      const isApproved = (item.status === true || String(item.status).trim().toUpperCase() === 'TRUE' || String(item.status).trim() === '1');
      return codes.includes(item.type) && isApproved;
    });

    try {
      const res = await fetch(geeApi('action=getIsochrone'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          features: activeItems.map(item => ({
            ...item,
            radius: state.globalBufferRadiusOverride !== null ? state.globalBufferRadiusOverride : (Number(item.radius) || Number(item.banKinh) || 500)
          }))
        })
      });
      if (res.ok) {
        const isochroneGeoJSON = await res.json();
        isochroneFeatures = (isochroneGeoJSON && isochroneGeoJSON.features) || [];
      }
    } catch (err) {
      console.error("Lỗi kiểm tra mạng lưới tại điểm:", err);
    }
  }

  const clickPointGeo = turf.point([clickLng, clickLat]);
  isochroneFeatures.forEach(feat => {
    const props = feat.properties || {};
    const code = props.type;
    const name = props.name;
    const isApproved = (props.status === true || String(props.status).trim().toUpperCase() === 'TRUE' || String(props.status).trim() === '1');
    
    if (codes.includes(code) && isApproved && feat.geometry) {
      try {
        const polyFeature = turf.polygon(feat.geometry.coordinates);
        if (turf.booleanPointInPolygon(clickPointGeo, polyFeature)) {
          if (!coveredGroups[code]) coveredGroups[code] = [];
          if (!coveredGroups[code].includes(name)) {
            coveredGroups[code].push(name);
          }
        }
      } catch (e) {}
    }
  });

  codes.forEach(code => {
    if (!coveredGroups[code]) missingCodes.push(code);
  });

  const coveredCount = Object.keys(coveredGroups).length;
  const missingCount = missingCodes.length;

  fetch(geeApi(`action=getWardFromPoint&lat=${clickLat.toFixed(6)}&lng=${clickLng.toFixed(6)}`))
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

  fetch(geeApi(`action=approvePoint&id=${encodeURIComponent(pointId)}`))
    .then(r => r.json())
    .then(() => {
      refreshHeatmapOnly();
    });
}

window.approvePointStatus = approvePointStatus;
