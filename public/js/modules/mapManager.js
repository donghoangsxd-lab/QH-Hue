import { state } from '../state.js';

export let map = null;
export let measureLayerGroup = null;

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
  return map;
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
