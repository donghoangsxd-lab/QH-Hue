// Lớp "Địa hình (cao độ nền)" (bảng lớp dữ liệu): tô màu nhiệt theo cao độ — vùng trũng xanh dương đậm, núi cao đỏ đậm.
// Nguồn FABDEM (đã gỡ nhà và tán cây) do GEE trả về dạng ô Terrarium (cao độ = R*256 + G + B/256 − 32768 m),
// cùng nguồn bảng dân số theo cao độ của mô phỏng ngập; GEE lỗi thì dùng ô SRTM của AWS Terrain Tiles (cao độ bề mặt).
// Giải mã và tô màu ngay trên trình duyệt; vẽ đồng thời trên bản đồ hiện trạng và quy hoạch.
// Đổ bóng địa hình: ô hệ số tĩnh trên bucket (terrain/hillshade/, scripts/build-hillshade.js), nhân thẳng vào màu
// trong canvas để in / chụp bản đồ (html2canvas) vẫn giữ bóng.
import { map } from './mapEngine.js';
import { planMap } from './planMap.js';
import { geeApi } from './api.js';
import { fmtNum } from './utils.js';

const AWS_URL = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';
const SOURCES = {
  fabdem: 'Cao độ nền: FABDEM (Hawker & Neal 2021, CC BY 4.0). Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA',
  srtm: 'Cao độ bề mặt: SRTM/GMTED (còn mái nhà và tán cây) qua AWS Terrain Tiles'
};
let tileUrlPromise = null;
let attribution = SOURCES.fabdem;

function tileUrl() {
  if (!tileUrlPromise) {
    tileUrlPromise = fetch(geeApi('action=getDemTile&dem=fabdem'))
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => {
        if (!d || !d.urlFormat) throw new Error('phản hồi không có urlFormat');
        return d.urlFormat;
      })
      .catch(err => {
        console.warn('Không lấy được ô cao độ FABDEM, dùng SRTM (AWS):', err.message);
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

// Giới hạn hệ số đổ bóng: sườn khuất không tối hẳn, sườn đón sáng không cháy màu
const SHADE_MIN = 0.3, SHADE_MAX = 1.3;
let shadeOn = true;
let shadeIndexPromise = null;
const shadeCache = new Map();   // "z_x_y" → Uint8Array 256×256 (giá trị = hệ số × index.scale)
const shadePending = new Map();

function shadeIndex() {
  if (!shadeIndexPromise) {
    shadeIndexPromise = fetch(geeApi('action=getHillshade&t=index'))
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(idx => (idx && idx.tiles && idx.scale > 0 ? idx : null))
      .catch(err => {
        console.warn('Không tải được đổ bóng địa hình:', err.message);
        return null;
      });
  }
  return shadeIndexPromise;
}

/** Ô hệ số đổ bóng; null khi ô không có trong index (mặt bằng, biển) hoặc tải lỗi */
function loadShadeTile(idx, z, x, y) {
  const key = `${z}_${x}_${y}`;
  if (!idx.tiles[key]) return Promise.resolve(null);
  if (shadeCache.has(key)) return Promise.resolve(shadeCache.get(key));
  if (shadePending.has(key)) return shadePending.get(key);
  const p = new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, 256, 256).data;
      const v = new Uint8Array(256 * 256);
      for (let i = 0, q = 0; i < v.length; i++, q += 4) v[i] = px[q];
      shadeCache.set(key, v);
      if (shadeCache.size > CACHE_MAX) shadeCache.delete(shadeCache.keys().next().value);
      resolve(v);
    };
    img.onerror = () => resolve(null);
    img.src = geeApi(`action=getHillshade&t=${key}&v=${encodeURIComponent(idx.at || '')}`);
  }).finally(() => shadePending.delete(key));
  shadePending.set(key, p);
  return p;
}

/** Hệ số đổ bóng 256×256 cho ô (z, x, y) của lớp địa hình; mức trên index.maxZoom nội suy song tuyến từ ô cha */
async function shadeFor(z, x, y) {
  if (!shadeOn) return null;
  const idx = await shadeIndex();
  if (!idx || z < idx.minZoom) return null;
  const k = Math.max(0, z - idx.maxZoom);
  const src = await loadShadeTile(idx, z - k, x >> k, y >> k);
  if (!src) return null;
  const inv = 1 / idx.scale;
  const fac = (v) => Math.min(SHADE_MAX, Math.max(SHADE_MIN, v * inv));
  const out = new Float32Array(256 * 256);
  if (!k) {
    for (let i = 0; i < out.length; i++) out[i] = fac(src[i]);
    return out;
  }
  const n = 2 ** k;
  const ox = (x - ((x >> k) << k)) * 256 / n, oy = (y - ((y >> k) << k)) * 256 / n;
  for (let j = 0; j < 256; j++) {
    const v = Math.min(255, Math.max(0, oy + (j + 0.5) / n - 0.5));
    const y0 = Math.floor(v), y1 = Math.min(255, y0 + 1), ty = v - y0;
    for (let i = 0; i < 256; i++) {
      const u = Math.min(255, Math.max(0, ox + (i + 0.5) / n - 0.5));
      const x0 = Math.floor(u), x1 = Math.min(255, x0 + 1), tx = u - x0;
      const top = src[y0 * 256 + x0] * (1 - tx) + src[y0 * 256 + x1] * tx;
      const bot = src[y1 * 256 + x0] * (1 - tx) + src[y1 * 256 + x1] * tx;
      out[j * 256 + i] = fac(top * (1 - ty) + bot * ty);
    }
  }
  return out;
}

const TerrainGrid = L.GridLayer.extend({
  createTile(coords, done) {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 256;
    Promise.all([loadElevTile(coords.z, coords.x, coords.y), shadeFor(coords.z, coords.x, coords.y)]).then(([elev, shade]) => {
      const ctx = tile.getContext('2d');
      const data = ctx.createImageData(256, 256);
      const px = data.data;
      for (let i = 0, p = 0; i < elev.length; i++, p += 4) {
        const e = elev[i];
        const m = e <= 0 ? 0 : e >= LUT_MAX ? LUT_MAX : Math.round(e);
        const f = shade ? shade[i] : 1;
        px[p] = LUT[m * 3] * f; px[p + 1] = LUT[m * 3 + 1] * f; px[p + 2] = LUT[m * 3 + 2] * f; px[p + 3] = 255;
      }
      ctx.putImageData(data, 0, 0);
      done(null, tile);
    }, err => done(err, tile));
    return tile;
  }
});

let visible = false;
let leftLayer = null, rightLayer = null;

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
    // Chờ biết nguồn ô (FABDEM hay SRTM dự phòng) để ghi nguồn đúng
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
  $('terrainOpacity')?.addEventListener('input', () => {
    const o = opacity();
    leftLayer?.setOpacity(o);
    rightLayer?.setOpacity(o);
  });
  $('chk_hillshade')?.addEventListener('change', (e) => {
    shadeOn = e.target.checked;
    leftLayer?.redraw();
    rightLayer?.redraw();
  });
}
