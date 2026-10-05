// Mô phỏng ngập theo mực nước (bảng lớp dữ liệu): pixel có cao độ nền (FABDEM, terrainLayer.js) thấp hơn mực nước
// được tô theo độ sâu, kèm công trình hạ tầng bị ngập (hiện trạng / quy hoạch) và dân số, diện tích ngập theo phường (GEE getFloodBins).
// Tính theo cao độ (mọi vùng thấp hơn mực nước), không loang từ sông: DEM 30 m đo mặt sông hẹp sai lệch vài mét nên loang sẽ bị chặn giả.
import { map, flyToVisible } from './mapEngine.js';
import { planMap } from './planMap.js';
import { state, BUFFER_COLORS, layerType, getPlanScenarioList } from './state.js';
import { geeApi } from './api.js';
import { escapeHtml, isApproved, fmtNum } from './utils.js';
import { loadElevTile, NATIVE_MAX_ZOOM } from './terrainLayer.js';

const POINT_ZOOM = 12;          // ô Terrarium dùng để lấy cao độ tại công trình (~36 m/pixel, sát độ phân giải DEM 30 m)
const MAX_LIST = 150;
// Độ sâu (m) → màu nước: nông xanh nhạt, sâu xanh đậm
const DEPTH_STOPS = [[0, [186, 230, 253, 150]], [0.5, [56, 189, 248, 180]], [1.5, [37, 99, 235, 210]], [3, [30, 58, 138, 235]]];
const DEPTH_STEP = 0.1;
const SHORT_LABELS = {
  "1-CV": "Công viên", "2-BDX": "Bãi đỗ xe", "3-MN": "Mầm non", "4-TH": "Tiểu học", "5-THCS": "THCS", "6-THPT": "THPT",
  "7-YT": "Y tế", "8-VH": "Văn hóa", "9-TM": "Chợ/TTTM", "12-CSD": "Chưa sử dụng"
};

const $ = (id) => document.getElementById(id);
const fmtM = (v) => `${fmtNum(Math.round(v * 10) / 10)} m`;

const DEPTH_LUT = (() => {
  const n = Math.round(DEPTH_STOPS[DEPTH_STOPS.length - 1][0] / DEPTH_STEP);
  const lut = new Uint8ClampedArray((n + 1) * 4);
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const d = i * DEPTH_STEP;
    while (s < DEPTH_STOPS.length - 2 && d > DEPTH_STOPS[s + 1][0]) s++;
    const [d0, c0] = DEPTH_STOPS[s], [d1, c1] = DEPTH_STOPS[s + 1];
    const t = Math.min(1, Math.max(0, (d - d0) / (d1 - d0)));
    for (let k = 0; k < 4; k++) lut[i * 4 + k] = c0[k] + (c1[k] - c0[k]) * t;
  }
  return lut;
})();
const DEPTH_MAX_IDX = DEPTH_LUT.length / 4 - 1;

let visible = false;
let level = 5;
let phase = 'HT';
let leftLayer = null, rightLayer = null;
let ringsLeft = null, ringsRight = null;
const liveTiles = new Map();    // canvas ô đang hiển thị → cao độ, để tô lại ngay khi kéo mực nước

// Pixel cao độ ≤ 0 m (biển, phá, đầm trong DEM) là mặt nước thường xuyên: không tô
function paintTile(tile, elev) {
  const ctx = tile.getContext('2d');
  const data = ctx.createImageData(256, 256);
  const px = data.data;
  for (let i = 0, p = 0; i < elev.length; i++, p += 4) {
    const e = elev[i];
    if (e <= 0 || e >= level) continue;
    const k = Math.min(DEPTH_MAX_IDX, Math.round((level - e) / DEPTH_STEP)) * 4;
    px[p] = DEPTH_LUT[k]; px[p + 1] = DEPTH_LUT[k + 1]; px[p + 2] = DEPTH_LUT[k + 2]; px[p + 3] = DEPTH_LUT[k + 3];
  }
  ctx.putImageData(data, 0, 0);
}

const FloodGrid = L.GridLayer.extend({
  createTile(coords, done) {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 256;
    loadElevTile(coords.z, coords.x, coords.y).then(elev => {
      liveTiles.set(tile, elev);
      paintTile(tile, elev);
      done(null, tile);
    }, err => done(err, tile));
    return tile;
  }
});

function makeLayer() {
  const layer = new FloodGrid({ maxZoom: 19, maxNativeZoom: NATIVE_MAX_ZOOM, zIndex: 2, opacity: 0.85 });
  layer.on('tileunload', (e) => liveTiles.delete(e.tile));
  return layer;
}

// ---------- Công trình bị ngập ----------
const pointElev = new Map();    // "lat,lng" → cao độ (m) | null
let facilityVersion = -1;
let facilityLists = { HT: [], QH: [] };   // [{ item, kind, lat, lng, elev }]

function facilitiesOf(list) {
  return list
    .filter(it => isApproved(it.status) && it.lat != null && it.lng != null && Number.isFinite(Number(it.lat)) && Number.isFinite(Number(it.lng)))
    .map(it => ({ item: it, kind: layerType(it), lat: Number(it.lat), lng: Number(it.lng) }))
    .filter(f => SHORT_LABELS[f.kind]);
}

async function sampleElevations(points) {
  const byTile = new Map();
  points.forEach(f => {
    const key = `${f.lat},${f.lng}`;
    if (pointElev.has(key)) return;
    const p = map.project([f.lat, f.lng], POINT_ZOOM);
    const tx = Math.floor(p.x / 256), ty = Math.floor(p.y / 256);
    const tk = `${tx}/${ty}`;
    if (!byTile.has(tk)) byTile.set(tk, { tx, ty, pts: [] });
    byTile.get(tk).pts.push({ key, ix: Math.min(255, Math.floor(p.x - tx * 256)), iy: Math.min(255, Math.floor(p.y - ty * 256)) });
  });
  await Promise.all([...byTile.values()].map(({ tx, ty, pts }) =>
    loadElevTile(POINT_ZOOM, tx, ty)
      .then(elev => pts.forEach(q => pointElev.set(q.key, elev[q.iy * 256 + q.ix])))
      .catch(() => pts.forEach(q => pointElev.set(q.key, null)))
  ));
}

async function ensureFacilities() {
  if (facilityVersion === state.dataVersion) return;
  const version = state.dataVersion;
  const ht = facilitiesOf(state.rawDataList);
  const qh = facilitiesOf(getPlanScenarioList());
  await sampleElevations([...ht, ...qh]);
  const withElev = (arr) => arr.map(f => ({ ...f, elev: pointElev.get(`${f.lat},${f.lng}`) })).filter(f => f.elev != null);
  facilityLists = { HT: withElev(ht), QH: withElev(qh) };
  facilityVersion = version;
}

const flooded = (list) => list.filter(f => f.elev > 0 && f.elev < level).sort((a, b) => a.elev - b.elev);

// Chấm đỏ tại tâm công trình ngập, to dần theo zoom (zoom 10 → 2 px, zoom ≥ 15 → 6 px);
// pane riêng trên icon công trình (markerPane 600) để chấm không bị icon / chấm công trình che
const DOT_PANE = 'floodDotPane';
const dotRadius = (zoom) => Math.min(6, Math.max(2, 2 + (zoom - 10) * 0.8));
const dotRenderers = new WeakMap();

function dotRendererFor(m) {
  if (!dotRenderers.has(m)) {
    if (!m.getPane(DOT_PANE)) m.createPane(DOT_PANE).style.zIndex = 610;
    dotRenderers.set(m, L.canvas({ pane: DOT_PANE }));
  }
  return dotRenderers.get(m);
}

function resizeDots() {
  [[ringsLeft, map], [ringsRight, planMap]].forEach(([group, m]) => {
    if (!group || !m) return;
    const radius = dotRadius(m.getZoom());
    group.eachLayer(dot => dot.setRadius(radius));
  });
}

function drawRings() {
  if (planMap && !ringsRight) ringsRight = L.layerGroup().addTo(planMap);
  [[ringsLeft, 'HT', map], [ringsRight, 'QH', planMap]].forEach(([group, key, m]) => {
    if (!group || !m) return;
    group.clearLayers();
    const renderer = dotRendererFor(m);
    const radius = dotRadius(m.getZoom());
    flooded(facilityLists[key]).forEach(f => group.addLayer(L.circleMarker([f.lat, f.lng], {
      renderer, radius, color: '#7f1d1d', weight: 1, fillColor: '#ef4444', fillOpacity: 1, interactive: false
    })));
  });
}

// ---------- Dân số, diện tích ngập theo phường ----------
let binsPromise = null;
let binsData = null;

function ensureBins() {
  if (!binsPromise) {
    binsPromise = fetch(geeApi('action=getFloodBins&dem=fabdem'))
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => {
        if (!d || !Array.isArray(d.wards)) throw new Error('phản hồi không có bảng phường');
        binsData = d;
        return d;
      })
      .catch(err => { console.warn('Không tải được bảng dân số theo cao độ:', err.message); binsPromise = null; return null; });
  }
  return binsPromise;
}

// Bậc b (cao độ DEM làm tròn mét) ngập khi b < mực nước; diện tích bỏ bậc ≤ 0 m (mặt nước thường xuyên)
function exposureByWard() {
  if (!binsData) return null;
  let pop = 0, area = 0, popAll = 0;
  const wards = binsData.wards.map(w => {
    let wp = 0, wa = 0;
    w.bins.forEach(([b, p, a]) => {
      popAll += p;
      if (b >= level) return;
      wp += p;
      if (b > 0) wa += a;
    });
    pop += wp; area += wa;
    return { name: w.name, pop: wp, area: wa };
  });
  return { pop, area, popAll, wards: wards.filter(w => w.pop >= 1 || w.area > 0).sort((a, b) => b.pop - a.pop) };
}

// ---------- Bảng kết quả ----------
let shownList = [];

function renderStats() {
  const box = $('floodStats');
  if (!box) return;
  const ex = exposureByWard();
  const list = flooded(facilityLists[phase]);
  const counts = {};
  list.forEach(f => { counts[f.kind] = (counts[f.kind] || 0) + 1; });
  const nHT = flooded(facilityLists.HT).length, nQH = flooded(facilityLists.QH).length;

  const popLine = ex
    ? `<div class="flood-kpi"><span>Diện tích ngập</span><b>≈ ${fmtNum(Math.round(ex.area / 1e5) / 10)} km²</b></div>
       <div class="flood-kpi"><span>Dân cư trong vùng ngập</span><b>≈ ${fmtNum(Math.round(ex.pop / 10) * 10)} người${ex.popAll ? ` (${fmtNum(Math.round(ex.pop / ex.popAll * 1000) / 10)}%)` : ''}</b></div>`
    : `<div class="flood-kpi"><span>Dân cư, diện tích</span><b class="flood-muted">${binsPromise ? 'đang tính...' : 'chưa tải được'}</b></div>`;
  const wardsLine = ex && ex.wards.length
    ? `<div class="flood-sub">Phường/xã ảnh hưởng nhiều nhất</div><div class="flood-wards">${ex.wards.slice(0, 5).map(w =>
        `<span>${escapeHtml(w.name)} <b>${fmtNum(Math.round(w.pop / 10) * 10)}</b></span>`).join('')}</div>`
    : '';
  const chips = Object.keys(SHORT_LABELS).filter(k => counts[k]).map(k =>
    `<span class="flood-chip"><i style="background:${BUFFER_COLORS[k]}"></i>${SHORT_LABELS[k]} <b>${counts[k]}</b></span>`).join('');
  const rows = list.slice(0, MAX_LIST).map((f, i) =>
    `<button type="button" class="flood-row" data-i="${i}" title="Phóng tới công trình">
      <i style="background:${BUFFER_COLORS[f.kind]}"></i><span>${escapeHtml(f.item.name || 'Công trình')}</span><b>sâu ${fmtM(level - f.elev)}</b>
    </button>`).join('');

  box.innerHTML = `${popLine}${wardsLine}
    <div class="flood-sub">Công trình nằm trong vùng ngập</div>
    <div class="flood-phase" role="tablist">
      <button type="button" data-phase="HT" class="${phase === 'HT' ? 'active' : ''}" aria-selected="${phase === 'HT'}">Hiện trạng <b>${nHT}</b></button>
      <button type="button" data-phase="QH" class="${phase === 'QH' ? 'active' : ''}" aria-selected="${phase === 'QH'}">Quy hoạch <b>${nQH}</b></button>
    </div>
    ${chips ? `<div class="flood-chips">${chips}</div>` : ''}
    ${rows ? `<div class="flood-list">${rows}</div>` : '<div class="flood-muted">Không có công trình đã duyệt nằm trong vùng ngập.</div>'}
    ${list.length > MAX_LIST ? `<div class="flood-muted">... và ${list.length - MAX_LIST} công trình khác</div>` : ''}`;
  shownList = list;
}

let refreshSeq = 0;
async function refresh() {
  if (!visible) return;
  const seq = ++refreshSeq;
  if (facilityVersion !== state.dataVersion) {
    const box = $('floodStats');
    if (box && !box.innerHTML) box.innerHTML = '<div class="flood-muted">Đang lấy cao độ công trình...</div>';
    await ensureFacilities();
    if (seq !== refreshSeq || !visible) return;
  }
  drawRings();
  renderStats();
}

function setLevel(v) {
  level = Math.round(v * 2) / 2;
  const out = $('floodLevelVal');
  if (out) out.textContent = fmtM(level);
  liveTiles.forEach((elev, tile) => paintTile(tile, elev));
  refresh();
}

export function setFloodVisible(on) {
  visible = !!on;
  const box = $('floodBox');
  if (box) box.style.display = visible ? '' : 'none';
  if (!map) return;
  if (visible) {
    if (!leftLayer) leftLayer = makeLayer().addTo(map);
    if (planMap && !rightLayer) rightLayer = makeLayer().addTo(planMap);
    if (!ringsLeft) ringsLeft = L.layerGroup().addTo(map);
    map.on('zoomend', resizeDots);
    planMap?.on('zoomend', resizeDots);
    refresh();
    ensureBins().then(() => { if (visible) renderStats(); });
  } else {
    refreshSeq++;
    map.off('zoomend', resizeDots);
    planMap?.off('zoomend', resizeDots);
    leftLayer?.remove(); leftLayer = null;
    rightLayer?.remove(); rightLayer = null;
    ringsLeft?.remove(); ringsLeft = null;
    ringsRight?.remove(); ringsRight = null;
    liveTiles.clear();
  }
}

function renderLegend() {
  const bar = $('floodLegendBar');
  if (!bar) return;
  const last = DEPTH_STOPS[DEPTH_STOPS.length - 1][0];
  bar.style.background = `linear-gradient(90deg, ${DEPTH_STOPS.map(([d, c]) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(2)}) ${(d / last * 100).toFixed(0)}%`).join(', ')})`;
}

export function initFloodSim() {
  if (!map) return;
  renderLegend();
  $('chk_flood')?.addEventListener('change', (e) => setFloodVisible(e.target.checked));
  const slider = $('floodLevel');
  if (slider) {
    level = Number(slider.value) || level;
    slider.addEventListener('input', () => setLevel(Number(slider.value)));
  }
  $('floodStats')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-phase]');
    if (tab) {
      phase = tab.dataset.phase;
      renderStats();
      return;
    }
    const row = e.target.closest('.flood-row');
    const f = row && shownList[Number(row.dataset.i)];
    if (f) flyToVisible([f.lat, f.lng], 17);
  });
}
