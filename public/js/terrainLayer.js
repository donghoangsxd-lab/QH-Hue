// Lớp "Địa hình (cao độ)" (bảng lớp dữ liệu): tô màu nhiệt theo cao độ — vùng trũng xanh dương đậm, núi cao đỏ đậm.
// Nguồn Copernicus DEM GLO-30 (ESA, ~30 m) do GEE trả về dạng ô Terrarium (cao độ = R*256 + G + B/256 − 32768 m),
// cùng nguồn bảng dân số theo cao độ của mô phỏng ngập; GEE lỗi thì dùng ô SRTM của AWS Terrain Tiles (cùng định dạng).
// Giải mã và tô màu ngay trên trình duyệt; vẽ đồng thời trên bản đồ hiện trạng và quy hoạch.
import { map } from './mapEngine.js';
import { planMap } from './planMap.js';
import { geeApi } from './api.js';
import { fmtNum } from './utils.js';

const AWS_URL = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';
const SOURCES = { glo30: 'Cao độ: Copernicus DEM GLO-30 (ESA) qua Google Earth Engine', srtm: 'Cao độ: SRTM/GMTED qua AWS Terrain Tiles' };
let tileUrlPromise = null;
let attribution = SOURCES.glo30;

function tileUrl() {
  if (!tileUrlPromise) {
    tileUrlPromise = fetch(geeApi('action=getDemTile'))
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => {
        if (!d || !d.urlFormat) throw new Error('phản hồi không có urlFormat');
        return d.urlFormat;
      })
      .catch(err => {
        console.warn('Không lấy được ô cao độ GLO-30, dùng SRTM (AWS):', err.message);
        attribution = SOURCES.srtm;
        return AWS_URL;
      });
  }
  return tileUrlPromise;
}
export const NATIVE_MAX_ZOOM = 15;     // ~4,8 m/pixel ở z15, đã mịn hơn dữ liệu gốc 30 m
// Thang không tuyến tính: đồng bằng ven phá 0–10 m chiếm nhiều bậc màu để thấy rõ vùng trũng
const STOPS = [
  [0, '#08306b'], [2, '#08519c'], [4, '#2171b5'], [7, '#4292c6'], [10, '#4fb3d9'],
  [15, '#3cb8a0'], [25, '#7ccf6a'], [50, '#c7e35a'], [100, '#ffe14d'], [200, '#fdb240'],
  [400, '#f7772f'], [700, '#e0402a'], [1100, '#b3151b'], [1700, '#67000d']
];
const LEGEND_TICKS = [0, 10, 50, 200, 700, 1700];
const LUT_MAX = 2000;
const CACHE_MAX = 120;          // số ô giữ lại cao độ (~256 KB/ô): đọc số liệu tại con trỏ, tô lại lớp ngập khi đổi mực nước

const $ = (id) => document.getElementById(id);
const hexRgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

// Bảng màu theo từng mét 0..LUT_MAX (dưới 0 m lấy màu đầu, trên LUT_MAX lấy màu cuối)
const LUT = (() => {
  const lut = new Uint8ClampedArray((LUT_MAX + 1) * 3);
  const rgb = STOPS.map(([, c]) => hexRgb(c));
  let s = 0;
  for (let m = 0; m <= LUT_MAX; m++) {
    while (s < STOPS.length - 2 && m > STOPS[s + 1][0]) s++;
    const [e0] = STOPS[s], [e1] = STOPS[s + 1];
    const t = Math.min(1, Math.max(0, (m - e0) / (e1 - e0)));
    for (let k = 0; k < 3; k++) lut[m * 3 + k] = rgb[s][k] + (rgb[s + 1][k] - rgb[s][k]) * t;
  }
  return lut;
})();

const elevCache = new Map();    // "z/x/y" → Float32Array 256×256 (m, làm tròn 0,1 m)
const pending = new Map();      // "z/x/y" → Promise đang tải

function cacheTile(key, elev) {
  elevCache.delete(key);
  elevCache.set(key, elev);
  if (elevCache.size > CACHE_MAX) elevCache.delete(elevCache.keys().next().value);
}

/** Cao độ (m) 256×256 pixel của 1 ô Terrarium; dùng chung bộ nhớ đệm cho lớp địa hình và mô phỏng ngập */
export function loadElevTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  const hit = elevCache.get(key);
  if (hit) return Promise.resolve(hit);
  if (pending.has(key)) return pending.get(key);
  const p = tileUrl().then(url => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, 256, 256).data;
      const elev = new Float32Array(256 * 256);
      for (let i = 0, q = 0; q < px.length; i++, q += 4) elev[i] = Math.round((px[q] * 256 + px[q + 1] + px[q + 2] / 256 - 32768) * 10) / 10;
      cacheTile(key, elev);
      resolve(elev);
    };
    img.onerror = () => reject(new Error('terrain tile'));
    img.src = L.Util.template(url, { z, x, y });
  })).finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

const TerrainGrid = L.GridLayer.extend({
  createTile(coords, done) {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 256;
    loadElevTile(coords.z, coords.x, coords.y).then(elev => {
      const ctx = tile.getContext('2d');
      const data = ctx.createImageData(256, 256);
      const px = data.data;
      for (let i = 0, p = 0; i < elev.length; i++, p += 4) {
        const e = elev[i];
        const m = e <= 0 ? 0 : e >= LUT_MAX ? LUT_MAX : Math.round(e);
        px[p] = LUT[m * 3]; px[p + 1] = LUT[m * 3 + 1]; px[p + 2] = LUT[m * 3 + 2]; px[p + 3] = 255;
      }
      ctx.putImageData(data, 0, 0);
      done(null, tile);
    }, err => done(err, tile));
    return tile;
  }
});

let visible = false;
let leftLayer = null, rightLayer = null;
let flowLeft = null, flowRight = null;

// Hướng chảy: độ dốc trên Copernicus DEM ~30 m. Hai khoảng cách phải cùng hướng và chênh cao ≥ 2 m
// (sai số vùng bằng khoảng 1–2 m) thì mới vẽ — đồng bằng ven phá không có mũi tên.
const FLOW_DROP_M = 2;
const FLOW_MAX_TILES = 36;

function sampleZoom(m) {
  return Math.max(11, Math.min(13, Math.round(m.getZoom())));
}

function elevOn(z, x, y, ix, iy) {
  const elev = elevCache.get(`${z}/${x}/${y}`);
  if (!elev || ix < 0 || iy < 0 || ix > 255 || iy > 255) return null;
  return elev[iy * 256 + ix];
}

function elevAtProject(z, px, py) {
  const x = Math.floor(px / 256), y = Math.floor(py / 256);
  return elevOn(z, x, y, Math.floor(px - x * 256), Math.floor(py - y * 256));
}

function tilesFor(m, z) {
  const b = m.getBounds().pad(0.15);
  const nw = m.project(b.getNorthWest(), z);
  const se = m.project(b.getSouthEast(), z);
  const out = [];
  for (let x = Math.floor(nw.x / 256); x <= Math.floor(se.x / 256); x++) {
    for (let y = Math.floor(nw.y / 256); y <= Math.floor(se.y / 256); y++) out.push({ x, y });
  }
  return out;
}

function buildArrows(m, z) {
  const size = m.getSize();
  const gap = 68;
  const near = 4, far = 8;
  const arrows = [];
  for (let sy = gap / 2; sy < size.y; sy += gap) {
    for (let sx = gap / 2; sx < size.x; sx += gap) {
      const ll = m.containerPointToLatLng([sx, sy]);
      const p = m.project(ll, z);
      const e0 = elevAtProject(z, p.x, p.y);
      const eE = elevAtProject(z, p.x + far, p.y);
      const eN = elevAtProject(z, p.x, p.y - far);
      const eEn = elevAtProject(z, p.x + near, p.y);
      const eNn = elevAtProject(z, p.x, p.y - near);
      if (e0 == null || eE == null || eN == null || eEn == null || eNn == null) continue;
      const gx = eE - e0, gy = eN - e0;
      if (gx * (eEn - e0) + gy * (eNn - e0) <= 0) continue;
      if (Math.hypot(gx, gy) < FLOW_DROP_M) continue;
      // Web Mercator: +x = đông, −y = bắc. Vector lên dốc là (gx, −gy); xuống dốc thì ngược lại.
      const down = m.unproject(L.point(p.x - gx, p.y + gy), z);
      arrows.push({ lat: ll.lat, lng: ll.lng, toLat: down.lat, toLng: down.lng });
    }
  }
  return arrows;
}

const FlowLayer = L.Layer.extend({
  onAdd(m) {
    this._map = m;
    if (!m.getPane('terrainFlowPane')) {
      const pane = m.createPane('terrainFlowPane');
      pane.style.zIndex = '250';
      pane.style.pointerEvents = 'none';
    }
    this._canvas = L.DomUtil.create('canvas', 'terrain-flow-canvas', m.getPane('terrainFlowPane'));
    this._canvas.style.position = 'absolute';
    this._canvas.style.pointerEvents = 'none';
    this._arrows = [];
    this._token = 0;
    this._reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    m.on('moveend zoomend resize', this._schedule, this);
    this._schedule();
    this._loop();
  },
  onRemove(m) {
    this._token++;
    cancelAnimationFrame(this._raf);
    m.off('moveend zoomend resize', this._schedule, this);
    L.DomUtil.remove(this._canvas);
    this._map = null;
  },
  _schedule() {
    const m = this._map;
    if (!m) return;
    const token = ++this._token;
    const z = sampleZoom(m);
    const tiles = tilesFor(m, z);
    if (tiles.length > FLOW_MAX_TILES) { this._arrows = []; return; }
    Promise.all(tiles.map(t => loadElevTile(z, t.x, t.y).catch(() => null))).then(() => {
      if (token !== this._token || !this._map) return;
      this._arrows = buildArrows(this._map, z);
    });
  },
  _loop() {
    const draw = (now) => {
      this._raf = requestAnimationFrame(draw);
      this._paint(this._reduce ? 0 : (now / 1400) % 1);
    };
    this._raf = requestAnimationFrame(draw);
  },
  _paint(phase) {
    const m = this._map;
    const canvas = this._canvas;
    if (!m || !canvas) return;
    const size = m.getSize();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(size.x * dpr) || canvas.height !== Math.round(size.y * dpr)) {
      canvas.width = Math.round(size.x * dpr);
      canvas.height = Math.round(size.y * dpr);
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
    }
    const ctx = canvas.getContext('2d');
    const topLeft = m.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(canvas, topLeft);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    this._arrows.forEach(a => {
      const p0 = m.latLngToContainerPoint([a.lat, a.lng]);
      const p1 = m.latLngToContainerPoint([a.toLat, a.toLng]);
      let dx = p1.x - p0.x, dy = p1.y - p0.y;
      const n = Math.hypot(dx, dy);
      if (!(n > 0)) return;
      dx /= n; dy /= n;
      const len = 18;
      const ox = p0.x + dx * len * phase, oy = p0.y + dy * len * phase;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.8)';
      ctx.fillStyle = '#f8fafc';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(ox - dx * 11, oy - dy * 11);
      ctx.lineTo(ox, oy);
      ctx.stroke();
      const px = -dy, py = dx;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox - dx * 7 + px * 3.4, oy - dy * 7 + py * 3.4);
      ctx.lineTo(ox - dx * 7 - px * 3.4, oy - dy * 7 - py * 3.4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
  }
});

function flowWanted() {
  const el = $('chk_terrainFlow');
  return !el || el.checked;
}

function syncFlow() {
  const on = visible && flowWanted() && !!map;
  if (!on) {
    flowLeft?.remove(); flowLeft = null;
    flowRight?.remove(); flowRight = null;
    return;
  }
  if (!flowLeft) flowLeft = new FlowLayer().addTo(map);
  if (planMap && !flowRight) flowRight = new FlowLayer().addTo(planMap);
  else if (!planMap && flowRight) { flowRight.remove(); flowRight = null; }
}

function opacity() {
  const el = $('terrainOpacity');
  return el ? el.value / 100 : 0.55;
}

function makeLayer() {
  return new TerrainGrid({
    maxZoom: 19,
    maxNativeZoom: NATIVE_MAX_ZOOM,
    opacity: opacity(),
    zIndex: 0,
    attribution
  });
}

/** Cao độ (m) tại vị trí, đọc từ ô đã tải; null nếu ô chưa có */
export function terrainElevationAt(latlng) {
  if (!map) return null;
  const z = Math.min(NATIVE_MAX_ZOOM, Math.round(map.getZoom()));
  const p = map.project(latlng, z);
  const x = Math.floor(p.x / 256), y = Math.floor(p.y / 256);
  const elev = elevCache.get(`${z}/${x}/${y}`);
  if (!elev) return null;
  const ix = Math.min(255, Math.floor(p.x - x * 256)), iy = Math.min(255, Math.floor(p.y - y * 256));
  return elev[iy * 256 + ix];
}

function setReadout(text) {
  const el = $('terrainReadout');
  if (el) el.textContent = text;
}

function onMouseMove(e) {
  const v = terrainElevationAt(e.latlng);
  setReadout(v === null ? '' : `Tại con trỏ: ${fmtNum(v)} m`);
}

export function setTerrainVisible(on) {
  visible = !!on;
  const legend = $('terrainLegend');
  if (legend) legend.style.display = visible ? '' : 'none';
  const box = $('terrainBox');
  if (box) box.style.display = visible ? '' : 'none';
  if (!map) return;
  if (visible) {
    // Chờ biết nguồn ô (GLO-30 hay SRTM dự phòng) để ghi nguồn đúng
    tileUrl().then(() => {
      if (!visible) return;
      if (!leftLayer) leftLayer = makeLayer().addTo(map);
      if (planMap && !rightLayer) rightLayer = makeLayer().addTo(planMap);
    });
    map.on('mousemove', onMouseMove);
    planMap?.on('mousemove', onMouseMove);
  } else {
    leftLayer?.remove(); leftLayer = null;
    rightLayer?.remove(); rightLayer = null;
    map.off('mousemove', onMouseMove);
    planMap?.off('mousemove', onMouseMove);
    setReadout('');
  }
  syncFlow();
}

function renderLegend() {
  const bar = $('terrainLegendBar');
  const ticks = $('terrainLegendTicks');
  if (!bar || !ticks) return;
  const last = STOPS.length - 1;
  bar.style.background = `linear-gradient(90deg, ${STOPS.map(([, c], i) => `${c} ${(i / last * 100).toFixed(1)}%`).join(', ')})`;
  ticks.innerHTML = LEGEND_TICKS.map(m => {
    const i = STOPS.findIndex(([e]) => e === m);
    return `<span style="left:${(i / last * 100).toFixed(1)}%">${m}</span>`;
  }).join('');
}

export function initTerrainLayer() {
  if (!map) return;
  renderLegend();
  $('chk_terrain')?.addEventListener('change', (e) => setTerrainVisible(e.target.checked));
  $('chk_terrainFlow')?.addEventListener('change', syncFlow);
  $('terrainOpacity')?.addEventListener('input', () => {
    const o = opacity();
    leftLayer?.setOpacity(o);
    rightLayer?.setOpacity(o);
  });
}
