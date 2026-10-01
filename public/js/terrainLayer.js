// Lớp "Địa hình (cao độ)" (bảng lớp dữ liệu): tô màu nhiệt theo cao độ — vùng trũng xanh dương đậm, núi cao đỏ đậm.
// Nguồn mở AWS Terrain Tiles (Tilezen, định dạng Terrarium: cao độ = R*256 + G + B/256 − 32768 m), tại Huế là SRTM 1″ (~30 m).
// Giải mã và tô màu ngay trên trình duyệt (không qua máy chủ); vẽ đồng thời trên bản đồ hiện trạng và quy hoạch.
import { map } from './mapEngine.js';
import { planMap } from './planMap.js';

const TILE_URL = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';
const NATIVE_MAX_ZOOM = 15;     // ~4,8 m/pixel ở z15, đã mịn hơn dữ liệu gốc 30 m
// Thang không tuyến tính: đồng bằng ven phá 0–10 m chiếm nhiều bậc màu để thấy rõ vùng trũng
const STOPS = [
  [0, '#08306b'], [2, '#08519c'], [4, '#2171b5'], [7, '#4292c6'], [10, '#4fb3d9'],
  [15, '#3cb8a0'], [25, '#7ccf6a'], [50, '#c7e35a'], [100, '#ffe14d'], [200, '#fdb240'],
  [400, '#f7772f'], [700, '#e0402a'], [1100, '#b3151b'], [1700, '#67000d']
];
const LEGEND_TICKS = [0, 10, 50, 200, 700, 1700];
const LUT_MAX = 2000;
const CACHE_MAX = 80;           // số ô giữ lại cao độ để đọc số liệu tại con trỏ (~128 KB/ô)

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

const elevCache = new Map();    // "z/x/y" → Int16Array 256×256 (m)

function cacheTile(key, elev) {
  elevCache.delete(key);
  elevCache.set(key, elev);
  if (elevCache.size > CACHE_MAX) elevCache.delete(elevCache.keys().next().value);
}

const TerrainGrid = L.GridLayer.extend({
  createTile(coords, done) {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 256;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const ctx = tile.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, 256, 256);
      const px = data.data;
      const elev = new Int16Array(256 * 256);
      for (let i = 0, p = 0; p < px.length; i++, p += 4) {
        const e = px[p] * 256 + px[p + 1] + px[p + 2] / 256 - 32768;
        elev[i] = Math.round(e);
        const m = e <= 0 ? 0 : e >= LUT_MAX ? LUT_MAX : e | 0;
        px[p] = LUT[m * 3]; px[p + 1] = LUT[m * 3 + 1]; px[p + 2] = LUT[m * 3 + 2]; px[p + 3] = 255;
      }
      ctx.putImageData(data, 0, 0);
      cacheTile(`${coords.z}/${coords.x}/${coords.y}`, elev);
      done(null, tile);
    };
    img.onerror = () => done(new Error('terrain tile'), tile);
    img.src = L.Util.template(TILE_URL, coords);
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
    attribution: 'Cao độ: SRTM/GMTED qua AWS Terrain Tiles'
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
  setReadout(v === null ? '' : `Tại con trỏ: ${v} m`);
}

export function setTerrainVisible(on) {
  visible = !!on;
  const legend = $('terrainLegend');
  if (legend) legend.style.display = visible ? '' : 'none';
  const box = $('terrainBox');
  if (box) box.style.display = visible ? '' : 'none';
  if (!map) return;
  if (visible) {
    if (!leftLayer) leftLayer = makeLayer().addTo(map);
    if (planMap && !rightLayer) rightLayer = makeLayer().addTo(planMap);
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
}
