import { state } from '../state.js';

export let map = null;
export let measureLayerGroup = null;

/**
 * Tính khoảng cách giữa 2 điểm tọa độ theo công thức Haversine (đơn vị: mét)
 */
export function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Bán kính Trái Đất (mét)
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Tính diện tích Đa giác (đơn vị: m²)
 */
export function calculatePolygonArea(latlngs) {
  if (!latlngs || latlngs.length < 3) return 0;
  let area = 0;
  const R = 6378137;
  for (let i = 0; i < latlngs.length; i++) {
    const p1 = latlngs[i];
    const p2 = latlngs[(i + 1) % latlngs.length];
    area += ((p2.lng - p1.lng) * Math.PI / 180) * (2 + Math.sin(p1.lat * Math.PI / 180) + Math.sin(p2.lat * Math.PI / 180));
  }
  return Math.abs(area * R * R / 2);
}

/**
 * Khởi tạo bản đồ Leaflet
 */
export function initMap() {
  map = L.map('map', { renderer: L.canvas() }).setView([16.4637, 107.5905], 13);

  // Lớp ảnh vệ tinh ArcGIS
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
    maxZoom: 18,
    attribution: 'Esri, Maxar, Earthstar Geographics'
  }).addTo(map);

  measureLayerGroup = L.layerGroup().addTo(map);

  return map;
}

/**
 * Bật / Tắt công cụ đo đạc
 */
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

/**
 * Xóa dữ liệu các nét vẽ đo đạc
 */
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
