import { state } from '../state.js';
import { map } from './mapManager.js';
import { onPointClick } from './analytics.js';

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

export const infraIcons = {
  "1-CV": { symbol: "🌳", border: "#4ade80" },
  "2-BDX": { symbol: "🅿️", border: "#a855f7" },
  "3-MN": { symbol: "🧸", border: "#fb923c" },
  "4-TH": { symbol: "🏫", border: "#facc15" },
  "5-THCS": { symbol: "📚", border: "#eab308" },
  "6-YT": { symbol: '<span style="color:#f87171; font-weight:900;">✚</span>', border: "#f87171" },
  "7-VH": { symbol: "🎭", border: "#ec4899" },
  "8-TM": { symbol: "🛒", border: "#38bdf8" },
  "9-CSD": { symbol: "🛠️", border: "#94a3b8" }
};

let tileHeatmapLayer = null;

export function initDefaultLayers(mapInstance) {
  layers.boundary.addTo(mapInstance);
  layers.heatmap.addTo(mapInstance);
  layers.c1.addTo(mapInstance);
  layers.c2.addTo(mapInstance);
  layers.c3.addTo(mapInstance);
  layers.c4.addTo(mapInstance);
  layers.c5.addTo(mapInstance);
  layers.c6.addTo(mapInstance);
  layers.c7.addTo(mapInstance);
  layers.c8.addTo(mapInstance);
  layers.c9.addTo(mapInstance);
}

export function toggleLayer(layerKey, isChecked) {
  if (isChecked) {
    if (layerKey === 'heatmap') {
      refreshHeatmapOnly();
    } else {
      if (map) map.addLayer(layers[layerKey]);
    }
  } else {
    if (map) map.removeLayer(layers[layerKey]);
  }

  const popBox = document.getElementById('popBox');
  const heatBox = document.getElementById('heatBox');

  if (layerKey === 'pop' && popBox) {
    popBox.style.display = isChecked ? 'block' : 'none';
  }
  if (layerKey === 'heatmap' && heatBox) {
    heatBox.style.display = isChecked ? 'block' : 'none';
  }
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

export function renderGroupedPoints(mapInstance) {
  const targetMap = mapInstance || map;
  if (!targetMap) return;

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
      pendingMarker.on('click', () => onPointClick(p, pendingMarker, targetMap));
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
      marker.on('click', () => onPointClick(p, marker, targetMap));
      targetGroup.addLayer(marker);
    }
  });
}

export function refreshHeatmapOnly() {
  const heatOpacityEl = document.getElementById('heatOpacity');
  const currentOpacity = heatOpacityEl ? heatOpacityEl.value / 100 : 0.5;

  return fetch(`/api/gee?action=getHeatmapTile&overrideRadius=${state.globalBufferRadius}&t=${Date.now()}`)
    .then(r => r.json())
    .then(d => {
      if (d.urlFormat) {
        layers.heatmap.clearLayers();
        tileHeatmapLayer = L.tileLayer(d.urlFormat, { opacity: currentOpacity });
        const chkHeat = document.getElementById('chk_heat');
        if (chkHeat && chkHeat.checked && map) {
          tileHeatmapLayer.addTo(layers.heatmap);
        }
      }
    });
}
