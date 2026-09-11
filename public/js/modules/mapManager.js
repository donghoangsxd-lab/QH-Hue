import { geeApiBackend, infraLabels } from '../config.js';
import { rawDataList, globalBufferRadius } from './layerManager.js';

export let map;
export let isInspectMode = false;
export let isPickMode = false;
export let tempMarker = null;

let activeMeasureType = null;
let measurePoints = [];
let measureLayerGroup;

export function initMap() {
  map = L.map('map', { renderer: L.canvas() }).setView([16.4637, 107.5905], 13);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18 }).addTo(map);
  
  measureLayerGroup = L.layerGroup().addTo(map);

  map.on('click', handleMapClick);
}

export function toggleInspectMode() {
  isInspectMode = !isInspectMode;
  const btn = document.getElementById('btnInspectMode');
  const mapEl = document.getElementById('map');

  if (isInspectMode) {
    btn.classList.add('active');
    btn.innerHTML = "🖱️❓ ĐANG CHỌN...";
    mapEl.classList.add('inspect-mode');
  } else {
    btn.classList.remove('active');
    btn.innerHTML = "🖱️ TRA CỨU ĐIỂM";
    mapEl.classList.remove('inspect-mode');
  }
}

export function enablePickMode() {
  isPickMode = true;
  document.getElementById('statusMsg').style.color = "var(--accent-orange)";
  document.getElementById('statusMsg').innerText = "👉 Click trực tiếp trên bản đồ...";
}

export function toggleMeasure(type) {
  if (activeMeasureType === type) {
    clearMeasure();
    return;
  }

  clearMeasure();
  activeMeasureType = type;
  
  const btnDist = document.getElementById('btnMeasureDist');
  const btnArea = document.getElementById('btnMeasureArea');

  if (type === 'distance') {
    btnDist.classList.add('active');
    btnDist.innerHTML = "❌ HUỶ";
  } else {
    btnArea.classList.add('active');
    btnArea.innerHTML = "❌ HUỶ";
  }
}

function clearMeasure() {
  activeMeasureType = null;
  measurePoints = [];
  measureLayerGroup.clearLayers();

  const btnDist = document.getElementById('btnMeasureDist');
  const btnArea = document.getElementById('btnMeasureArea');
  btnDist.classList.remove('active');
  btnDist.innerHTML = "📏 CHIỀU DÀI";
  btnArea.classList.remove('active');
  btnArea.innerHTML = "📐 DIỆN TÍCH";
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculatePolygonArea(latlngs) {
  if (latlngs.length < 3) return 0;
  let area = 0;
  const R = 6378137;
  for (let i = 0; i < latlngs.length; i++) {
    const p1 = latlngs[i];
    const p2 = latlngs[(i + 1) % latlngs.length];
    area += ((p2.lng - p1.lng) * Math.PI / 180) * (2 + Math.sin(p1.lat * Math.PI / 180) + Math.sin(p2.lat * Math.PI / 180));
  }
  return Math.abs(area * R * R / 2);
}

function handleMapClick(e) {
  if (activeMeasureType) {
    measurePoints.push(e.latlng);
    const ptCircle = L.circleMarker(e.latlng, { radius: 5, color: '#fb923c', fillColor: '#fb923c', fillOpacity: 1 });
    measureLayerGroup.addLayer(ptCircle);

    if (activeMeasureType === 'distance' && measurePoints.length >= 2) {
      let totalDist = 0;
      for (let i = 0; i < measurePoints.length - 1; i++) {
        totalDist += getDistanceMeters(measurePoints[i].lat, measurePoints[i].lng, measurePoints[i+1].lat, measurePoints[i+1].lng);
      }
      const polyline = L.polyline(measurePoints, { color: '#38bdf8', weight: 3, dashArray: '5, 5' });
      measureLayerGroup.clearLayers();
      measureLayerGroup.addLayer(polyline);
      measurePoints.forEach(p => measureLayerGroup.addLayer(L.circleMarker(p, { radius: 5, color: '#fb923c', fillColor: '#fb923c', fillOpacity: 1 })));

      const distText = totalDist >= 1000 ? (totalDist / 1000).toFixed(2) + " km" : Math.round(totalDist) + " m";
      L.popup().setLatLng(e.latlng).setContent(`<b style="color:var(--accent-cyan);">📏 Tổng chiều dài:</b> <span style="color:var(--accent-green); font-weight:bold;">${distText}</span>`).openOn(map);
    }

    if (activeMeasureType === 'area' && measurePoints.length >= 3) {
      const areaSqM = calculatePolygonArea(measurePoints);
      const polygon = L.polygon(measurePoints, { color: '#4ade80', weight: 2, fillColor: '#4ade80', fillOpacity: 0.2 });
      measureLayerGroup.clearLayers();
      measureLayerGroup.addLayer(polygon);
      measurePoints.forEach(p => measureLayerGroup.addLayer(L.circleMarker(p, { radius: 5, color: '#fb923c', fillColor: '#fb923c', fillOpacity: 1 })));

      const areaText = areaSqM >= 10000 ? (areaSqM / 10000).toFixed(2) + " ha" : Math.round(areaSqM).toLocaleString() + " m²";
      L.popup().setLatLng(e.latlng).setContent(`<b style="color:var(--accent-green);">📐 Tổng diện tích:</b> <span style="color:var(--accent-orange); font-weight:bold;">${areaText}</span>`).openOn(map);
    }
    return;
  }

  if (isPickMode) {
    const lat = e.latlng.lat.toFixed(6);
    const lng = e.latlng.lng.toFixed(6);
    document.getElementById('newLat').value = lat;
    document.getElementById('newLng').value = lng;
    
    if (tempMarker) map.removeLayer(tempMarker);
    tempMarker = L.marker([lat, lng]).addTo(map);

    const statusEl = document.getElementById('statusMsg');
    statusEl.style.color = "var(--accent-orange)";
    statusEl.innerText = "⏳ Đang tra cứu địa bàn...";

    fetch(`${geeApiBackend}?action=getWardFromPoint&lat=${lat}&lng=${lng}`)
      .then(r => r.json())
      .then(res => {
        const wardName = res.ward || "Thuận Hóa";
        document.getElementById('newWard').value = wardName;
        statusEl.style.color = "var(--accent-green)";
        statusEl.innerText = `✓ Thuộc địa bàn: ${wardName}`;
      })
      .catch(() => {
        document.getElementById('newWard').value = "Thuận Hóa";
        statusEl.style.color = "var(--accent-green)";
        statusEl.innerText = "✓ Đã ghim tọa độ!";
      });

    isPickMode = false;
    return;
  }

  if (isInspectMode) {
    const clickLat = e.latlng.lat;
    const clickLng = e.latlng.lng;

    if (tempMarker) map.removeLayer(tempMarker);
    tempMarker = L.marker([clickLat, clickLng]).addTo(map);

    const coveredGroups = {};
    const missingCodes = [];

    ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"].forEach(code => {
      const itemsOfCode = rawDataList.filter(item => {
        const isApproved = (item.status === true || item.status === 'true' || item.status === 'TRUE');
        return item.type === code && isApproved;
      });

      itemsOfCode.forEach(item => {
        const dist = getDistanceMeters(clickLat, clickLng, item.lat, item.lng);
        if (dist <= globalBufferRadius) {
          if (!coveredGroups[code]) coveredGroups[code] = [];
          coveredGroups[code].push(item.name);
        }
      });

      if (!coveredGroups[code]) missingCodes.push(code);
    });

    const coveredCount = Object.keys(coveredGroups).length;
    const missingCount = missingCodes.length;

    fetch(`${geeApiBackend}?action=getWardFromPoint&lat=${clickLat.toFixed(6)}&lng=${clickLng.toFixed(6)}`)
      .then(r => r.json())
      .then(resWard => {
        const wardName = resWard.ward || "Thuận Hóa";

        let resultHtml = `<div style="font-size:11px;">
          <b style="color:var(--accent-cyan);">📊 MẬT ĐỘ HẠ TẦNG TẠI VỊ TRÍ</b><br>
          <span style="color:var(--text-muted);">📍 Địa bàn: <b>Phường/Xã ${wardName}</b></span><br>

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

    toggleInspectMode();
    return;
  }
}
