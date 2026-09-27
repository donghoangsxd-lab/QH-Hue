import { state, infraLabels, WARD_BOUNDARY_SHADOW_STYLE, WARD_BOUNDARY_LINE_STYLE, WARD_HIGHLIGHT_STYLE } from './state.js';

const PLAN_SAMPLE_URL = './data/planning-sample.geojson';
const PLAN_COLORS = {
  "1-CV": "#16a34a", "2-BDX": "#2563eb", "3-MN": "#ea580c", "4-TH": "#dc2626",
  "5-THCS": "#9333ea", "6-YT": "#0d9488", "7-VH": "#ca8a04", "8-TM": "#db2777"
};

export let planMap = null;
let leftMap = null;
let compareOn = false;
let dividerRatio = 0.5;
const planBoundaryLayer = L.layerGroup();
const planHighlightLayer = L.layerGroup();

export function initPlanMap(mainMap) {
  leftMap = mainMap;
  planMap = L.map('mapPlan', {
    zoomControl: false,
    attributionControl: true,
    renderer: L.canvas(),
    zoomSnap: leftMap.options.zoomSnap
  }).setView(leftMap.getCenter(), leftMap.getZoom());

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18,
    attribution: 'Tiles &copy; Esri'
  }).addTo(planMap);

  planBoundaryLayer.addTo(planMap);
  planHighlightLayer.addTo(planMap);
  loadPlanSampleData();
  syncMaps(leftMap, planMap);
  initDividerDrag();

  const area = document.getElementById('mapArea');
  if (area && window.ResizeObserver) {
    new ResizeObserver(() => {
      planMap.invalidateSize({ pan: false });
      updateDivider();
    }).observe(area);
  }

  setCompareMode(false);
  return planMap;
}

export function renderPlanBoundaries() {
  planBoundaryLayer.clearLayers();
  const fc = {
    type: 'FeatureCollection',
    features: (state.wardLabelsList || [])
      .filter(w => w.geometry)
      .map(w => ({ type: 'Feature', geometry: w.geometry, properties: { name: w.name } }))
  };
  planBoundaryLayer.addLayer(L.geoJSON(fc, { style: WARD_BOUNDARY_SHADOW_STYLE, interactive: false }));
  planBoundaryLayer.addLayer(L.geoJSON(fc, { style: WARD_BOUNDARY_LINE_STYLE, interactive: false }));
}

export function highlightPlanWard(wardName) {
  planHighlightLayer.clearLayers();
  if (!wardName || wardName === "Thành phố Huế") return;
  const w = (state.wardLabelsList || []).find(x => x.name === wardName);
  if (!w || !w.geometry) return;
  planHighlightLayer.addLayer(L.geoJSON({ type: 'Feature', geometry: w.geometry }, { style: WARD_HIGHLIGHT_STYLE, interactive: false }));
}

async function loadPlanSampleData() {
  try {
    const res = await fetch(PLAN_SAMPLE_URL);
    if (!res.ok) return;
    const data = await res.json();
    L.geoJSON(data, {
      style: f => {
        const color = PLAN_COLORS[f.properties.loai] || '#7c3aed';
        return { color, weight: 2, dashArray: '6,4', fillColor: color, fillOpacity: 0.25 };
      },
      pointToLayer: (f, latlng) => {
        const color = PLAN_COLORS[f.properties.loai] || '#7c3aed';
        return L.circleMarker(latlng, { radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.95 });
      },
      onEachFeature: (f, layer) => {
        const p = f.properties || {};
        layer.bindPopup(`<div style="font-size:11px; min-width:200px;">
          <b style="color:var(--accent-cyan);">${p.name || 'Công trình quy hoạch'}</b><br>
          <hr style="border-color:var(--border-color); margin:4px 0;">
          • Loại hạ tầng: <b>${infraLabels[p.loai] || p.loai || '-'}</b><br>
          • Diện tích: <b>${Number(p.dienTich || 0).toLocaleString()} m²</b><br>
          • Giai đoạn: <b style="color:var(--accent-orange);">${p.giaiDoan || '-'}</b><br>
          <i style="color:var(--text-muted);">Dữ liệu mẫu để thử tính năng so sánh.</i>
        </div>`);
      }
    }).addTo(planMap);
  } catch (err) {
    console.warn("Không tải được dữ liệu quy hoạch mẫu:", err);
  }
}

function syncMaps(a, b) {
  let lock = false;

  const applyView = (dst, center, zoom, options) => {
    const snap = dst.options.zoomSnap;
    dst.options.zoomSnap = 0;
    dst.setView(center, zoom, options);
    dst.options.zoomSnap = snap;
  };

  const bind = (src, dst) => {
    let zooming = false;
    src.on('zoomanim', (e) => {
      if (lock || !compareOn) return;
      zooming = true;
      lock = true;
      applyView(dst, e.center, e.zoom, { animate: true });
      lock = false;
    });
    src.on('zoomend', () => { zooming = false; });
    src.on('move', () => {
      if (lock || zooming || !compareOn) return;
      lock = true;
      applyView(dst, src.getCenter(), src.getZoom(), { animate: false });
      lock = false;
    });
  };

  bind(a, b);
  bind(b, a);
}

export function getCoveredRightWidth() {
  if (!compareOn) return 0;
  const area = document.getElementById('mapArea');
  if (!area) return 0;
  const w = area.clientWidth;
  const covered = Math.round(w * (1 - dividerRatio));
  return (w - covered) < 240 ? 0 : covered;
}

function updateDivider() {
  const area = document.getElementById('mapArea');
  const divider = document.getElementById('swipeDivider');
  const planEl = document.getElementById('mapPlan');
  if (!area || !divider || !planEl) return;
  const x = Math.round(area.clientWidth * dividerRatio);
  divider.style.left = `${x}px`;
  planEl.style.clipPath = `inset(0 0 0 ${x}px)`;
}

function initDividerDrag() {
  const area = document.getElementById('mapArea');
  const divider = document.getElementById('swipeDivider');
  if (!area || !divider) return;

  divider.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    divider.setPointerCapture(e.pointerId);
    divider.classList.add('dragging');
  });
  divider.addEventListener('pointermove', (e) => {
    if (!divider.hasPointerCapture(e.pointerId)) return;
    const rect = area.getBoundingClientRect();
    dividerRatio = Math.min(0.98, Math.max(0.02, (e.clientX - rect.left) / rect.width));
    updateDivider();
  });
  const release = (e) => {
    if (divider.hasPointerCapture(e.pointerId)) divider.releasePointerCapture(e.pointerId);
    divider.classList.remove('dragging');
  };
  divider.addEventListener('pointerup', release);
  divider.addEventListener('pointercancel', release);
}

export function setCompareMode(on) {
  // compareOn phải bật SAU khi planMap đã khớp view, nếu không sự kiện move của invalidateSize sẽ kéo bản đồ trái đi
  compareOn = false;
  document.body.classList.toggle('compare-on', on);
  const btn = document.getElementById('btnToggleCompare');
  if (btn) {
    btn.classList.toggle('active', on);
    btn.title = on ? 'Tắt so sánh Hiện trạng / Quy hoạch' : 'So sánh Hiện trạng / Quy hoạch (chia đôi màn hình)';
  }
  if (!planMap || !on) return;
  planMap.invalidateSize({ pan: false });
  planMap.setView(leftMap.getCenter(), leftMap.getZoom(), { animate: false });
  updateDivider();
  compareOn = true;
}

export function toggleCompareMode() {
  setCompareMode(!compareOn);
}
