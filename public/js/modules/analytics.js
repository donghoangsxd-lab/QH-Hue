import { state } from '../state.js';
import { getDistanceMeters } from './mapManager.js';
import { renderGroupedPoints, refreshHeatmapOnly } from './layerManager.js';

let isochroneLayerGroup = null;

export function initIsochroneLayer(map) {
  if (!isochroneLayerGroup) {
    isochroneLayerGroup = L.layerGroup().addTo(map);
  }
}

export function drawIsochronePolygon(map, lat, lng, customRadius) {
  if (!isochroneLayerGroup) initIsochroneLayer(map);
  isochroneLayerGroup.clearLayers();

  const radiusMeters = customRadius || Number(document.getElementById('inputIsoRadius')?.value) || 500;

  fetch(`/api/gee?action=getIsochrone&lat=${lat}&lng=${lng}&radius=${radiusMeters}`)
    .then(r => r.json())
    .then(res => {
      if (res.success && res.data) {
        const polyGeoJSON = res.data;
        const isoPolygon = L.geoJSON(polyGeoJSON, {
          style: {
            color: '#38bdf8',
            weight: 2,
            dashArray: '4, 4',
            fillColor: '#38bdf8',
            fillOpacity: 0.25
          }
        });
        isochroneLayerGroup.addLayer(isoPolygon);
      }
    })
    .catch(() => {});
}

/**
 * Xử lý khi click vào Marker công trình hạ tầng
 */
export function onPointClick(p, marker, map) {
  const isApproved = (p.status === true || p.status === 'true' || p.status === 'TRUE');
  const customRadius = Number(document.getElementById('inputIsoRadius')?.value) || 500;

  // Vẽ vùng phủ Isochrone khi click công trình
  drawIsochronePolygon(map, p.lat, p.lng, customRadius);

  let contentHtml = `<div style="font-size:11px;">`;

  if (!isApproved) {
    contentHtml += `<b style="color:var(--accent-red);">🏢 ${p.name}</b> <span class="badge-pending">DỰ KIẾN</span><br>`;
  } else {
    contentHtml += `<b style="color:var(--accent-cyan);">🏢 ${p.name}</b><br>`;
  }

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

  } else if (p.type !== "9-CSD") {
    contentHtml += `<div id="servedPopText">
      <div style="color:var(--accent-orange); font-weight:bold; margin-top:4px;">• Dân số phục vụ CHÍNH THỨC: <span id="popValText">0%</span></div>
      <div class="inline-progress-bg"><div class="inline-progress-fill" style="background:var(--accent-orange);" id="popValBar"></div></div>
    </div>`;
    contentHtml += `</div>`;
  }

  const popup = L.popup({ closeButton: true, autoPan: true })
    .setLatLng([p.lat, p.lng])
    .setContent(contentHtml);
  
  popup.openOn(map);

  // Tính dân số phục vụ từ GEE
  fetch(`/api/gee?action=analyzePoint&lat=${p.lat}&lng=${p.lng}&radius=${customRadius}`)
    .then(r => r.json())
    .then(res => {
      const popVal = res.servedPop || 0;
      const popContainer = document.getElementById('servedPopText');
      if (popContainer) {
        popContainer.innerHTML = `• Dân số phục vụ (~${customRadius}m): ~<b style="color:var(--accent-orange);">${popVal.toLocaleString()} người</b>`;
      }
    });
}

export function handleInspectPointClick(map, clickLat, clickLng) {
  const customRadius = Number(document.getElementById('inputIsoRadius')?.value) || 500;
  
  drawIsochronePolygon(map, clickLat, clickLng, customRadius);

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
          resultHtml += `<div class="sug-card">• <b>${code}:</b><br><span style="color:var(--accent-cyan);">└ ${names}</span></div>`;
        });
      } else {
        resultHtml += `<div class="sug-card ineligible">(Chưa có hạ tầng phủ đến)</div>`;
      }

      resultHtml += `<div style="font-weight:bold; color:var(--accent-red); margin-top:6px;">
        2. Chưa tiếp cận: ${missingCount}/8 nhóm
      </div>`;

      if (missingCount > 0) {
        missingCodes.forEach(code => {
          resultHtml += `<div class="sug-card ineligible">❌ ${code}</div>`;
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

export function approvePointStatus(pointId, map) {
  if (state.currentUserRole !== "ADMIN") return;

  const target = state.rawDataList.find(x => x.id === pointId);
  if (!target) return;

  target.status = true;
  renderGroupedPoints(map);
  map.closePopup();

  fetch(`/api/gee?action=approvePoint&id=${encodeURIComponent(pointId)}`)
    .then(r => r.json())
    .then(() => {
      refreshHeatmapOnly();
    });
}
