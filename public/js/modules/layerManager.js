import { geeApiBackend, infraIcons } from '../config.js';
import { map, isInspectMode } from './mapManager.js';
import { onPointClick } from './analytics.js';

export let rawDataList = [];
export let globalBufferRadius = 500;

export let tilePopLayer = null;
export let tileHeatmapLayer = null;

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

export function updateMainProgress(percent) {
  document.getElementById('progressBar').style.width = percent + "%";
  document.getElementById('progressPercent').innerText = percent + "%";
}

export function toggleLayer(layerKey, isChecked) {
  if (isChecked) {
    if (layerKey === 'heatmap') {
      refreshHeatmapOnly();
    } else {
      map.addLayer(layers[layerKey]);
    }
  } else {
    map.removeLayer(layers[layerKey]);
  }

  if (layerKey === 'pop') {
    document.getElementById('popBox').style.display = isChecked ? 'block' : 'none';
  }
  if (layerKey === 'heatmap') {
    document.getElementById('heatBox').style.display = isChecked ? 'block' : 'none';
  }
}

export function toggleBuffer(bufferKey, el) {
  if (map.hasLayer(layers[bufferKey])) {
    map.removeLayer(layers[bufferKey]);
    el.classList.remove('active');
  } else {
    map.addLayer(layers[bufferKey]);
    el.classList.add('active');
  }
}

export function changePopOpacity(val) {
  if (tilePopLayer) tilePopLayer.setOpacity(val / 100);
}

export function changeHeatOpacity(val) {
  if (tileHeatmapLayer) tileHeatmapLayer.setOpacity(val / 100);
}

const radiusSteps = [300, 500, 1000, 2000];
export function changeBufferRadius(sliderIdx) {
  const idx = parseInt(sliderIdx, 10);
  globalBufferRadius = radiusSteps[idx];
  document.getElementById('radiusLabel').innerText = globalBufferRadius + "m";
  
  renderGroupedPoints();
  refreshHeatmapOnly();
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}
export const debouncedChangeBufferRadius = debounce(changeBufferRadius, 350);

export async function loadDataParallel() {
  updateMainProgress(15);

  // Thêm các lớp layer mặc định lên Map
  layers.boundary.addTo(map);
  layers.heatmap.addTo(map);
  layers.c1.addTo(map); layers.c2.addTo(map); layers.c3.addTo(map);
  layers.c4.addTo(map); layers.c5.addTo(map); layers.c6.addTo(map);
  layers.c7.addTo(map); layers.c8.addTo(map); layers.c9.addTo(map);

  try {
    const cachedPopTile = localStorage.getItem('pop_tile_url');
    const cachedBoundTile = localStorage.getItem('bound_tile_url');
    const tileCacheTime = localStorage.getItem('tile_cache_time');
    const isTileCacheValid = tileCacheTime && (Date.now() - parseInt(tileCacheTime, 10) < 3600000);

    let pPop, pBound;

    if (isTileCacheValid && cachedPopTile) {
      tilePopLayer = L.tileLayer(cachedPopTile, { opacity: 0.6 }).addTo(layers.pop);
      pPop = Promise.resolve();
    } else {
      pPop = fetch(`${geeApiBackend}?action=getPopRasterTile`).then(r => r.json()).then(d => {
        if (d.urlFormat) {
          tilePopLayer = L.tileLayer(d.urlFormat, { opacity: 0.6 }).addTo(layers.pop);
          localStorage.setItem('pop_tile_url', d.urlFormat);
          localStorage.setItem('tile_cache_time', Date.now().toString());
        }
      }).catch(() => {});
    }

    if (isTileCacheValid && cachedBoundTile) {
      L.tileLayer(cachedBoundTile, { opacity: 0.7 }).addTo(layers.boundary);
      pBound = Promise.resolve();
    } else {
      pBound = fetch(`${geeApiBackend}?action=getBoundaryTile`).then(r => r.json()).then(d => {
        if (d.urlFormat) {
          L.tileLayer(d.urlFormat, { opacity: 0.7 }).addTo(layers.boundary);
          localStorage.setItem('bound_tile_url', d.urlFormat);
        }
      }).catch(() => {});
    }

    await Promise.allSettled([pPop, pBound]);
    updateMainProgress(50);

    const pMain = fetch(geeApiBackend).then(r => r.json()).then(data => {
      rawDataList = data.rawDataList || [];
      renderGroupedPoints();
    }).catch(() => {});

    await Promise.allSettled([pMain]);
    updateMainProgress(75);

    await refreshHeatmapOnly();
  } catch (e) {
    console.error("Lỗi tiến trình nạp bản đồ", e);
  } finally {
    updateMainProgress(100);
  }
}

export function renderGroupedPoints() {
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

  rawDataList.forEach(p => {
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
      pendingMarker.on('click', () => { if (!isInspectMode) onPointClick(p, pendingMarker); });
      targetGroup.addLayer(pendingMarker);

    } else {
      if (p.type !== "9-CSD") {
        const officialBuffer = L.circle([p.lat, p.lng], {
          radius: globalBufferRadius,
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
      marker.on('click', () => { if (!isInspectMode) onPointClick(p, marker); });
      targetGroup.addLayer(marker);
    }
  });
}

export function refreshHeatmapOnly() {
  const currentOpacity = document.getElementById('heatOpacity').value / 100;
  return fetch(`${geeApiBackend}?action=getHeatmapTile&overrideRadius=${globalBufferRadius}&t=${Date.now()}`)
    .then(r => r.json())
    .then(d => {
      if (d.urlFormat) {
        layers.heatmap.clearLayers();
        tileHeatmapLayer = L.tileLayer(d.urlFormat, { opacity: currentOpacity });
        if (document.getElementById('chk_heat').checked) {
          tileHeatmapLayer.addTo(layers.heatmap);
        }
      }
    });
}
