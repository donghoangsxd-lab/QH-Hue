// Lát cắt địa hình trên panel dưới. Cao độ đọc từ ô Terrarium FABDEM (terrainLayer.js), bước ~30 m
// đúng độ phân giải gốc. Trục X luôn 0 → chiều dài đường cắt; trục Y ôm dải cao độ của chính đường đó
// (cửa sổ tối thiểu 4 m để đoạn đồng bằng không bị nhiễu DEM phóng thành núi).
import { loadElevTile, NATIVE_MAX_ZOOM, elevationSourceLabel } from './terrainLayer.js';
import { setBottomPanelCollapsed } from './uiComponents.js';
import { startTaskProgress } from './utils.js';

const STEP_M = 30;
const MAX_N = 480;

// z15 ~5 m/pixel, mỗi ô ~1,2 km. Đường dài thì hạ zoom để ít ô hơn; z12 ~38 m/pixel, sát DEM 30 m.
function sampleZoom(length) {
  if (length > 40000) return 11;
  if (length > 20000) return 12;
  if (length > 8000) return 13;
  if (length > 3000) return 14;
  return NATIVE_MAX_ZOOM;
}
const TILE_AT_ONCE = 6;
const Y_MIN_SPAN = 4;
const ELEV_FMT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const M_FMT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const KM_FMT = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const TICK_FMT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

const $ = (id) => document.getElementById(id);

let open = false;
let collapsedBefore = null;
let seq = 0;
let timer = 0;
let chart = null;
let cursorKey = '';
let loadTask = null;
const cursors = [];

function cancelProgress() {
  loadTask?.cancel();
  loadTask = null;
  const box = $('tpLoad');
  if (box) box.hidden = true;
}

function showProgress(done, total) {
  if (!loadTask) loadTask = startTaskProgress('Đang tải lát cắt địa hình');
  const pct = total ? (done / total) * 100 : 0;
  const text = total ? `Đang tải cao độ nền (${done}/${total} ô)` : 'Đang tải cao độ nền…';
  loadTask.set(pct, text);
  setNote(text);
  const box = $('tpLoad');
  const fill = $('tpLoadFill');
  const label = $('tpLoadLabel');
  if (label) label.textContent = `${text} · ${Math.floor(pct)}%`;
  if (fill) fill.style.width = `${pct}%`;
  if (box) {
    box.hidden = false;
    box.setAttribute('aria-valuenow', String(Math.floor(pct)));
    box.setAttribute('aria-valuetext', text);
  }
}

function finishProgress(ok, text) {
  if (loadTask) {
    if (ok) loadTask.done(text);
    else loadTask.fail(text);
    loadTask = null;
  }
  const box = $('tpLoad');
  if (box) box.hidden = true;
}

export function initTerrainProfile(mapList) {
  (mapList || []).filter(Boolean).forEach(m => {
    cursors.push({ layer: L.layerGroup().addTo(m) });
  });
}

function fmtDist(m) {
  if (m >= 1000) return `${KM_FMT.format(m / 1000)} km`;
  return `${M_FMT.format(Math.round(m))} m`;
}

function setNote(text) {
  const el = $('tpNote');
  if (el) el.textContent = text || '';
}

function setHint(text) {
  const el = $('tpHint');
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || '';
}

function setStats(profile, win) {
  const el = $('tpStats');
  if (!el) return;
  if (!profile || !win) { el.innerHTML = ''; return; }
  const item = (k, v) => `<span class="tp-stat"><small>${k}</small><b>${v}</b></span>`;
  el.innerHTML = [
    item('Dài', fmtDist(profile.length)),
    item('Thấp', `${ELEV_FMT.format(win.lo)} m`),
    item('Cao', `${ELEV_FMT.format(win.hi)} m`),
    item('Chênh', `${ELEV_FMT.format(win.hi - win.lo)} m`),
    item('Lên', `${ELEV_FMT.format(profile.up)} m`),
    item('Xuống', `${ELEV_FMT.format(profile.down)} m`)
  ].join('');
}

function hideCursor() {
  cursorKey = '';
  cursors.forEach(c => c.layer.clearLayers());
}

function showCursor(sample) {
  const key = `${sample.lat.toFixed(5)},${sample.lng.toFixed(5)}`;
  if (key === cursorKey) return;
  cursorKey = key;
  const html = sample.z == null ? '' : `<span>${ELEV_FMT.format(sample.z)} m</span>`;
  cursors.forEach(({ layer }) => {
    layer.clearLayers();
    L.circleMarker([sample.lat, sample.lng], {
      radius: 6, color: '#ffffff', weight: 2, fillColor: '#fb923c', fillOpacity: 1, interactive: false
    }).addTo(layer);
    if (html) {
      L.marker([sample.lat, sample.lng], {
        interactive: false,
        icon: L.divIcon({ className: 'tp-cursor', html, iconSize: [0, 0] })
      }).addTo(layer);
    }
  });
}

function clearChart() {
  chart?.destroy();
  chart = null;
  hideCursor();
}

function hide() {
  if (!open) return;
  open = false;
  seq++;
  clearTimeout(timer);
  cancelProgress();
  clearChart();
  setHint('');
  setNote('');
  setStats(null, null);
  const host = $('terrainProfileHost');
  if (host) host.hidden = true;
  if (collapsedBefore) setBottomPanelCollapsed(true);
  collapsedBefore = null;
}

function ensureOpen() {
  if (open) return;
  open = true;
  collapsedBefore = document.body.classList.contains('bottom-collapsed');
  setBottomPanelCollapsed(false);
  const host = $('terrainProfileHost');
  if (host) host.hidden = false;
}

/** type từ công cụ đo; points là [lng, lat][] đang chấm */
export function syncTerrainProfile(type, points) {
  if (type !== 'profile') {
    hide();
    return;
  }
  ensureOpen();
  const coords = (points || []).map(p => [p[0], p[1]]);
  if (coords.length < 2) {
    seq++;
    clearTimeout(timer);
    cancelProgress();
    clearChart();
    setStats(null, null);
    setNote('Cao độ nền FABDEM');
    setHint('Chấm ít nhất 2 điểm trên bản đồ. Backspace xóa đỉnh vừa chấm; chuột phải trong 1 m quanh đỉnh để xóa đỉnh đó.');
    return;
  }
  clearTimeout(timer);
  const snapshot = coords.map(c => c.slice());
  timer = setTimeout(() => sampleAndRender(snapshot), 60);
}

function distancesOf(coords) {
  const at = [0];
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    acc += turf.distance(coords[i - 1], coords[i], { units: 'meters' });
    at.push(acc);
  }
  const length = at[at.length - 1];
  if (!(length > 0.5)) return null;
  let step = STEP_M;
  if (length / step + 1 > MAX_N) step = length / (MAX_N - 1);
  const ds = at.slice();
  for (let d = step; d < length - 0.5; d += step) ds.push(d);
  ds.sort((a, b) => a - b);
  const out = [];
  ds.forEach(d => {
    const v = Math.min(d, length);
    if (!out.length || v - out[out.length - 1] >= 1) out.push(v);
  });
  if (out[out.length - 1] < length - 0.01) out.push(length);
  return { length, step, distances: out };
}

async function loadTiles(keys, onProgress) {
  const tiles = new Map();
  let i = 0;
  let done = 0;
  const list = [...keys.entries()];
  onProgress?.(0, list.length);
  const worker = async () => {
    while (i < list.length) {
      const [key, args] = list[i++];
      try {
        tiles.set(key, await loadElevTile(args[0], args[1], args[2]));
      } catch (e) {
        tiles.set(key, null);
      }
      done++;
      onProgress?.(done, list.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(TILE_AT_ONCE, list.length) }, worker));
  return tiles;
}

async function sampleProfile(coords, onProgress) {
  if (typeof turf === 'undefined') throw new Error('Chưa tải thư viện đo');
  const built = distancesOf(coords);
  if (!built) return null;
  const { length, step, distances } = built;
  const line = turf.lineString(coords);
  const z = sampleZoom(length);
  const raw = [];
  const keys = new Map();
  distances.forEach(d => {
    const c = turf.along(line, d, { units: 'meters' }).geometry.coordinates;
    const lat = c[1];
    const lng = c[0];
    const p = L.CRS.EPSG3857.latLngToPoint(L.latLng(lat, lng), z);
    const x = Math.floor(p.x / 256);
    const y = Math.floor(p.y / 256);
    keys.set(`${z}/${x}/${y}`, [z, x, y]);
    raw.push({
      d, lat, lng, x, y,
      ix: Math.min(255, Math.max(0, Math.floor(p.x - x * 256))),
      iy: Math.min(255, Math.max(0, Math.floor(p.y - y * 256)))
    });
  });
  const tiles = await loadTiles(keys, onProgress);
  let up = 0;
  let down = 0;
  let prev = null;
  let missing = 0;
  const samples = raw.map(s => {
    const elev = tiles.get(`${z}/${s.x}/${s.y}`);
    const v = elev ? elev[s.iy * 256 + s.ix] : NaN;
    const height = Number.isFinite(v) ? v : null;
    if (height == null) {
      missing++;
      prev = null;
    } else {
      if (prev != null) {
        const dz = height - prev;
        if (dz > 0) up += dz;
        else down -= dz;
      }
      prev = height;
    }
    return { d: s.d, lat: s.lat, lng: s.lng, z: height };
  });
  return { length, step, samples, up, down, missing, source: elevationSourceLabel() };
}

function yWindow(samples) {
  let lo = Infinity;
  let hi = -Infinity;
  samples.forEach(s => {
    if (s.z == null) return;
    if (s.z < lo) lo = s.z;
    if (s.z > hi) hi = s.z;
  });
  if (!Number.isFinite(lo)) return null;
  const span = Math.max(hi - lo, Y_MIN_SPAN);
  const pad = span * 0.12;
  const mid = (lo + hi) / 2;
  return { lo, hi, min: mid - span / 2 - pad, max: mid + span / 2 + pad };
}

function axisColor(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function fillColor(ctx) {
  const area = ctx.chart.chartArea;
  if (!area) return 'rgba(251, 146, 60, 0.35)';
  const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, 'rgba(251, 146, 60, 0.55)');
  g.addColorStop(1, 'rgba(56, 189, 248, 0.05)');
  return g;
}

const crosshair = {
  id: 'tpCrosshair',
  afterDatasetsDraw(c) {
    const active = c.tooltip?.getActiveElements() || [];
    if (!active.length || !c.chartArea) return;
    const x = active[0].element.x;
    const { top, bottom } = c.chartArea;
    c.ctx.save();
    c.ctx.beginPath();
    c.ctx.moveTo(x, top);
    c.ctx.lineTo(x, bottom);
    c.ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    c.ctx.lineWidth = 1;
    c.ctx.setLineDash([3, 3]);
    c.ctx.stroke();
    c.ctx.restore();
  }
};

function drawChart(profile, win) {
  const canvas = $('terrainProfileChart');
  if (!canvas || typeof Chart === 'undefined') {
    setHint('Không vẽ được biểu đồ.');
    return;
  }
  const data = profile.samples.map(s => ({ x: s.d, y: s.z }));
  if (chart) {
    chart.$samples = profile.samples;
    chart.$length = profile.length;
    chart.data.datasets[0].data = data;
    chart.options.scales.x.max = profile.length;
    chart.options.scales.x.title.text = profile.length >= 1000 ? 'Khoảng cách (km)' : 'Khoảng cách (m)';
    chart.options.scales.y.min = win.min;
    chart.options.scales.y.max = win.max;
    hideCursor();
    chart.update('none');
    return;
  }
  const font = getComputedStyle(document.body).fontFamily;
  const tick = axisColor('--text-main', '#cbd5e1');
  const muted = axisColor('--text-muted', '#94a3b8');
  chart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      datasets: [{
        data,
        parsing: { xAxisKey: 'x', yAxisKey: 'y' },
        borderColor: '#fb923c',
        backgroundColor: fillColor,
        borderWidth: 2,
        fill: 'start',
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: '#fb923c',
        pointHoverBorderWidth: 2,
        tension: 0,
        spanGaps: false,
        clip: 6
      }]
    },
    plugins: [crosshair],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false, axis: 'x' },
      onHover(event, elements) {
        if (event.type === 'mouseout') { hideCursor(); return; }
        const s = elements.length ? chart?.$samples?.[elements[0].index] : null;
        if (s) showCursor(s);
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.94)',
          borderColor: '#fb923c',
          borderWidth: 1,
          titleColor: '#e2e8f0',
          bodyColor: '#fdba74',
          displayColors: false,
          callbacks: {
            title(items) {
              const x = items[0]?.parsed?.x;
              if (x == null) return '';
              if (x < 1) return 'Điểm đầu';
              return `Cách điểm đầu ${fmtDist(x)}`;
            },
            label(item) {
              if (item.parsed.y == null) return ' Ngoài vùng cao độ';
              return ` Cao độ: ${ELEV_FMT.format(item.parsed.y)} m`;
            },
            afterBody(items) {
              const i = items[0]?.dataIndex ?? -1;
              const s = chart?.$samples;
              if (!s || i < 1) return '';
              const a = s[i - 1];
              const b = s[i];
              if (a?.z == null || b?.z == null || !(b.d > a.d)) return '';
              return `Độ dốc: ${ELEV_FMT.format((b.z - a.z) / (b.d - a.d) * 100)}%`;
            }
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          min: 0,
          max: profile.length,
          title: {
            display: true,
            text: profile.length >= 1000 ? 'Khoảng cách (km)' : 'Khoảng cách (m)',
            color: muted,
            font: { family: font, size: 11 }
          },
          ticks: {
            color: tick,
            maxTicksLimit: 8,
            font: { family: font, size: 11 },
            callback(v) {
              const n = Number(v);
              if (this.max >= 1000) return TICK_FMT.format(n / 1000);
              return M_FMT.format(Math.round(n));
            }
          },
          grid: { color: 'rgba(255,255,255,0.06)' }
        },
        y: {
          min: win.min,
          max: win.max,
          title: {
            display: true,
            text: 'Cao độ (m)',
            color: muted,
            font: { family: font, size: 11 }
          },
          ticks: {
            color: muted,
            maxTicksLimit: 6,
            font: { family: font, size: 11 },
            callback: v => ELEV_FMT.format(Number(v))
          },
          grid: { color: 'rgba(255,255,255,0.06)' }
        }
      }
    }
  });
  chart.$samples = profile.samples;
  chart.$length = profile.length;
}

async function sampleAndRender(coords) {
  const my = ++seq;
  cancelProgress();
  setHint('');
  setNote('Đang đọc cao độ nền…');
  try {
    const profile = await sampleProfile(coords, (done, total) => {
      if (my !== seq) return;
      showProgress(done, total);
    });
    if (my !== seq) return;
    if (!profile) {
      cancelProgress();
      clearChart();
      setStats(null, null);
      setNote('Cao độ nền FABDEM');
      setHint('Đường cắt quá ngắn.');
      return;
    }
    const win = yWindow(profile.samples);
    const src = `Cao độ nền ${profile.source} · bước khoảng ${M_FMT.format(Math.round(profile.step))} m`;
    if (!win) {
      cancelProgress();
      clearChart();
      setStats(null, null);
      setNote(src);
      setHint('Đường cắt nằm ngoài vùng có cao độ nền (TP. Huế và vành đai 10 km).');
      return;
    }
    const short = profile.length < 60 ? ' · đoạn ngắn hơn độ phân giải 30 m' : '';
    const gap = profile.missing ? ` · ${profile.missing} điểm ngoài vùng` : '';
    finishProgress(true, 'Đã tải lát cắt địa hình');
    setNote(src + short + gap);
    setStats(profile, win);
    setHint('');
    drawChart(profile, win);
  } catch (err) {
    if (my !== seq) return;
    console.warn('Lát cắt địa hình lỗi:', err);
    finishProgress(false, 'Không tải được cao độ nền');
    clearChart();
    setStats(null, null);
    setHint('Không đọc được cao độ nền. Thử lại sau ít giây.');
  }
}
