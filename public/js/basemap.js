// Ảnh nền dùng chung cho bản đồ hiện trạng và quy hoạch.
// Mặc định Google vệ tinh. Nền đường phố là OpenFreeMap Liberty (MapLibre trong Leaflet).
// WebGL hoặc kiểu Liberty lỗi thì đổi sang nền xám nhạt Esri. Lựa chọn ghi trên máy (qhhue.basemap).
// Lớp cắt nền điều chỉnh cục bộ luôn lấy vệ tinh Google.
// Mức phóng bản đồ cao hơn ô gốc: Leaflet phóng ô maxNativeZoom, không tắt lớp.
import { trackJob, watchTiles } from './loadProgress.js';

const STORE_KEY = 'qhhue.basemap';

/** Mức phóng tối đa của mọi bản đồ Leaflet (hiện trạng, quy hoạch, định vị ảnh). */
export const MAP_MAX_ZOOM = 22;
// Ảnh GEE (dân cư, heatmap, viễn thám) xin tới z19; cao hơn phóng ô đó.
export const GEE_NATIVE_ZOOM = 19;

const BASEMAPS = {
  google: {
    label: 'Google vệ tinh',
    url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    // Vệ tinh Google trên địa bàn Huế còn ảnh tới z22
    opts: { maxNativeZoom: 22, subdomains: '0123', attribution: 'Imagery &copy; Google' }
  },
  esri: {
    label: 'Esri World Imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts: { maxNativeZoom: 19, attribution: 'Imagery &copy; Esri' }
  },
  s2: {
    label: 'Sentinel-2 Cloudless 2025',
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
    opts: { maxNativeZoom: 15, attribution: 'Sentinel-2 cloudless &copy; EOX' }
  },
  // light: nền đường phố (Liberty hoặc Esri Light Gray khi lỗi). Viền lô không làm sáng trên nền này.
  positron: { label: 'Bản đồ đường phố', light: true }
};

export const BASEMAP_EVENT = 'qh:basemap';
export const isLightBasemap = () => !!(BASEMAPS[current] && BASEMAPS[current].light);

// World Light Gray Canvas: ô có ảnh tới z16 (z17+ là ảnh báo hết dữ liệu, cùng một file).
// Thứ tự {z}/{y}/{x} là của ArcGIS. Phóng tiếp tới MAP_MAX_ZOOM bằng ô z16.
const ESRI_LIGHT = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  opts: {
    maxNativeZoom: 16,
    attribution: 'Nền &copy; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }
};
// Liberty: vector OpenMapTiles, phóng quá mức ô gốc vẫn tới zoom Leaflet 22 (plugin trừ 1 khi truyền sang MapLibre).
const LIBERTY_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const OFM_ATTR = 'OpenFreeMap &copy; OpenMapTiles Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const OFM_PANE = 'ofmPane';
const ML_CSS = 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css';
const ML_CSS_SRI = 'sha384-uTttxo/aOKbdE5RlD/SPzSDoDmNvGlUYPjONi2MN/b7c9HPSvW07OIuyP7uL6jxK';
const ML_JS = 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js';
const ML_JS_SRI = 'sha384-5+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp';
const ML_PLUGIN = 'https://cdn.jsdelivr.net/npm/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js';
const ML_PLUGIN_SRI = 'sha384-tXYNKOHx4T02jMP7YYCtBxPIv1B5gaA5mcVPBzqMp6d7VzWzxJgI2aWF/nJLrQdS';
const LIGHT_KEY = 'qhhue.streetBase';

// Nhãn tên: name:vi nếu ô vector có, không thì tên gốc (name), rồi biểu thức sẵn của kiểu Liberty.
export function preferVietnameseLabels(style) {
  (style && style.layers || []).forEach(layer => {
    const field = layer.layout && layer.layout['text-field'];
    if (!field || !JSON.stringify(field).includes('name')) return;
    layer.layout['text-field'] = ['coalesce', ['get', 'name:vi'], ['get', 'name'], field];
  });
  return style;
}

// Tem đường + tên công trình (nền trong suốt) phủ trên ranh lô để nhận biết vị trí khi duyệt từng khu đất
const LABELS = {
  url: 'https://mt{s}.google.com/vt/lyrs=h&hl=vi&x={x}&y={y}&z={z}',
  opts: { maxNativeZoom: 22, subdomains: '0123', attribution: 'Nhãn &copy; Google' }
};
const LABELS_PANE = 'labelsPane';

const maps = new Map();   // bản đồ → { layer, pinned }
const labelLayers = new Map();   // bản đồ → lớp tem đang gắn
let labelsOn = false;
let current = 'positron';
try {
  const saved = localStorage.getItem(STORE_KEY);
  if (BASEMAPS[saved]) current = saved;
} catch (e) { /* chế độ riêng tư */ }

// 'ofm' thử Liberty; 'esri' khi phiên này đã lỗi hoặc máy không có WebGL.
let lightKind = 'ofm';
try {
  if (sessionStorage.getItem(LIGHT_KEY) === 'esri') lightKind = 'esri';
} catch (e) { /* chế độ riêng tư */ }

function defOf(id) {
  if (id === 'positron' && lightKind === 'esri') {
    return { label: BASEMAPS.positron.label, url: ESRI_LIGHT.url, opts: ESRI_LIGHT.opts, light: true };
  }
  return BASEMAPS[id] || BASEMAPS.google;
}

function webglOk() {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch (e) {
    return false;
  }
}

function glPixelRatio() {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  let phone = false;
  try {
    phone = window.matchMedia('(pointer: coarse), (max-width: 840px)').matches;
  } catch (e) { /* không có matchMedia */ }
  return phone ? 1 : Math.min(dpr, 2);
}

function loadScript(src, integrity) {
  return new Promise((resolve, reject) => {
    const prev = document.querySelector(`script[src="${src}"]`);
    if (prev && prev.dataset.ready === '1') { resolve(); return; }
    if (prev) {
      prev.addEventListener('load', () => resolve(), { once: true });
      prev.addEventListener('error', () => reject(new Error(src)), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.crossOrigin = 'anonymous';
    s.integrity = integrity;
    s.onload = () => { s.dataset.ready = '1'; resolve(); };
    s.onerror = () => reject(new Error(src));
    document.head.appendChild(s);
  });
}

let libPromise = null;
function ensureLibs() {
  if (typeof window !== 'undefined' && window.L && window.L.maplibreGL && window.maplibregl) return Promise.resolve();
  if (!libPromise) {
    libPromise = (async () => {
      if (!document.querySelector('link[data-ofm-css]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = ML_CSS;
        link.crossOrigin = 'anonymous';
        link.integrity = ML_CSS_SRI;
        link.dataset.ofmCss = '1';
        document.head.appendChild(link);
      }
      await loadScript(ML_JS, ML_JS_SRI);
      await loadScript(ML_PLUGIN, ML_PLUGIN_SRI);
      if (!window.L.maplibreGL || !window.maplibregl) throw new Error('maplibre');
    })().catch(err => { libPromise = null; throw err; });
  }
  return libPromise;
}

let stylePromise = null;
function libertyStyle() {
  if (!stylePromise) {
    stylePromise = fetch(LIBERTY_STYLE, { signal: AbortSignal.timeout(8000) })
      .then(res => { if (!res.ok) throw new Error(`style ${res.status}`); return res.json(); })
      .then(preferVietnameseLabels)
      .catch(err => { stylePromise = null; throw err; });
  }
  // Mỗi bản đồ một bản sao: MapLibre sửa object style khi nạp.
  return stylePromise.then(style => JSON.parse(JSON.stringify(style)));
}

function useEsriStreet() {
  if (lightKind === 'esri') return;
  lightKind = 'esri';
  try { sessionStorage.setItem(LIGHT_KEY, 'esri'); } catch (e) { /* chế độ riêng tư */ }
  maps.forEach((entry, m) => {
    if ((entry.pinned || current) !== 'positron') return;
    try { entry.layer.remove(); } catch (e) { /* lớp WebGL dở */ }
    entry.layer = addTiles(m, 'positron');
  });
}

function ensureOfmPane(m) {
  if (m.getPane(OFM_PANE)) return;
  const pane = m.createPane(OFM_PANE);
  pane.style.zIndex = '180';
  pane.style.pointerEvents = 'none';
  pane.classList.add('leaflet-ofm-pane');
}

// detectRetina của Leaflet giảm maxZoom của layer đi 1 trên màn retina, nên cộng bù để vẫn tới MAP_MAX_ZOOM
function layerMaxZoom(opts) {
  return MAP_MAX_ZOOM + (opts && opts.detectRetina ? 1 : 0);
}

function addTiles(m, id) {
  const def = id === 'positron'
    ? { url: ESRI_LIGHT.url, opts: ESRI_LIGHT.opts }
    : defOf(id);
  const name = id === 'google' ? 'Ảnh vệ tinh' : 'Nền đường phố';
  return watchTiles(L.tileLayer(def.url, {
    maxZoom: layerMaxZoom(def.opts), zIndex: 0, crossOrigin: 'anonymous', ...def.opts
  }), name).addTo(m);
}

// Lớp trả về ngay; MapLibre gắn sau khi script và style về. remove() hủy cả lần tải đang chờ.
function addLiberty(m) {
  const holder = L.layerGroup().addTo(m);
  let glLayer = null;
  let cancelled = false;
  let timer = 0;
  const endStreet = trackJob('Nền đường phố');
  let ended = false;
  const finish = () => { if (!ended) { ended = true; endStreet(); } };
  const api = {
    remove() {
      cancelled = true;
      finish();
      if (timer) clearTimeout(timer);
      if (glLayer) {
        try { glLayer.remove(); } catch (e) { /* context đã mất */ }
        glLayer = null;
      }
      api._gl = null;
      try { holder.remove(); } catch (e) { /* đã gỡ */ }
    },
    // Sau khi phóng khung in, chờ MapLibre vẽ xong khung mới rồi mới chụp (idle không lặp nếu đã đứng yên).
    settled(timeout = 8000) {
      return new Promise(resolve => {
        const gl = api._gl;
        if (!gl) { resolve(); return; }
        let finished = false;
        const finishSettle = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timerId);
          try { gl.off('idle', finishSettle); } catch (e) { /* map đã hủy */ }
          resolve();
        };
        const timerId = setTimeout(finishSettle, timeout);
        try {
          gl.on('idle', finishSettle);
          gl.triggerRepaint();
        } catch (e) { finishSettle(); }
      });
    }
  };
  ensureLibs().then(() => libertyStyle()).then(style => {
    if (cancelled || lightKind === 'esri') { finish(); return; }
    ensureOfmPane(m);
    try {
      glLayer = L.maplibreGL({
        style,
        pane: OFM_PANE,
        interactive: false,
        attributionControl: { customAttribution: OFM_ATTR },
        pixelRatio: glPixelRatio(),
        fadeDuration: 0,
        maxZoom: MAP_MAX_ZOOM,
        maxPitch: 0,
        refreshExpiredTiles: false,
        // PDF đọc canvas bằng drawImage. Tắt preserveDrawingBuffer thì khung WebGL bị xóa sau khi vẽ, tờ in chỉ còn nền đặc.
        canvasContextAttributes: { antialias: false, preserveDrawingBuffer: true }
      });
      glLayer.addTo(m);
    } catch (e) {
      useEsriStreet();
      return;
    }
    const gl = glLayer.getMaplibreMap();
    const canvas = gl.getCanvas && gl.getCanvas();
    if (canvas) canvas.style.pointerEvents = 'none';
    let ok = false;
    const giveUp = () => {
      if (ok || cancelled || lightKind === 'esri') return;
      finish();
      useEsriStreet();
    };
    timer = setTimeout(giveUp, 12000);
    gl.on('load', () => { ok = true; clearTimeout(timer); finish(); });
    api._gl = gl;
    gl.on('error', (ev) => {
      const msg = String((ev && ev.error && (ev.error.message || ev.error)) || '');
      if (!ok && /WebGL|Failed to initialize|load the style/i.test(msg)) giveUp();
    });
  }).catch(() => { finish(); if (!cancelled) useEsriStreet(); });
  return api;
}

function addBase(m, id) {
  if (id === 'positron') {
    if (lightKind === 'esri' || !webglOk()) return addTiles(m, id);
    return addLiberty(m);
  }
  return addTiles(m, id);
}

function addLabels(m) {
  if (!m.getPane(LABELS_PANE)) {
    const pane = m.createPane(LABELS_PANE);
    pane.style.zIndex = 450;
    pane.style.pointerEvents = 'none';
  }
  labelLayers.set(m, watchTiles(L.tileLayer(LABELS.url, {
    maxZoom: layerMaxZoom(LABELS.opts), pane: LABELS_PANE, crossOrigin: 'anonymous', ...LABELS.opts
  }), 'Tem đường').addTo(m));
}

/** Bật / tắt tem đường, tên công trình trên mọi bản đồ đã gắn ảnh nền (nút nhỏ cuối dòng Mạng lưới đường) */
export function setLabelsOverlay(on) {
  labelsOn = !!on;
  labelLayers.forEach(layer => layer.remove());
  labelLayers.clear();
  if (labelsOn) maps.forEach((_, m) => addLabels(m));
  const btn = document.getElementById('btnRoadLabels');
  if (btn) {
    btn.classList.toggle('active', labelsOn);
    btn.setAttribute('aria-pressed', String(labelsOn));
  }
}

export const labelsOverlayOn = () => labelsOn;

/** Gắn ảnh nền. pin = 'google' | 'positron' thì bản đồ đó không đổi theo ô chọn (định vị ảnh scan). */
export function attachBasemap(m, pin) {
  const prev = maps.get(m);
  if (prev) prev.layer.remove();
  const pinned = pin && BASEMAPS[pin] ? pin : null;
  const layer = addBase(m, pinned || current);
  maps.set(m, { layer, pinned });
  if (labelsOn) {
    labelLayers.get(m)?.remove();
    addLabels(m);
  }
  return layer;
}

function applyBasemap() {
  maps.forEach((entry, m) => {
    if (entry.pinned) return;
    entry.layer.remove();
    entry.layer = addBase(m, current);
  });
}

function emitBasemap() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BASEMAP_EVENT));
}

/** Đổi ảnh nền và báo các lớp lô vẽ lại viền. id thuộc BASEMAPS. */
export function selectBasemap(id) {
  if (!BASEMAPS[id] || id === current) return;
  current = id;
  try { localStorage.setItem(STORE_KEY, current); } catch (e) { /* chế độ riêng tư */ }
  applyBasemap();
  emitBasemap();
}

export function basemapLabel() {
  return defOf(current).label;
}

/** Nền của một bản đồ đã vẽ xong khung hiện tại (ô ảnh Leaflet hoặc MapLibre idle). */
export function whenBasemapSettled(m, timeout = 8000) {
  const layer = maps.get(m)?.layer;
  if (!layer) return Promise.resolve();
  if (typeof layer.settled === 'function') return layer.settled(timeout);
  if (typeof L !== 'undefined' && layer instanceof L.GridLayer && layer.isLoading?.()) {
    return new Promise(resolve => {
      const t = setTimeout(resolve, timeout);
      layer.once('load', () => { clearTimeout(t); resolve(); });
    });
  }
  return Promise.resolve();
}

/** Ảnh vệ tinh Google cho lớp cắt nền điều chỉnh cục bộ, không đổi theo nền nhạt đang xem */
export function basemapTileSpec() {
  const def = BASEMAPS.google;
  return {
    url: def.url,
    maxZoom: MAP_MAX_ZOOM,
    maxNativeZoom: def.opts.maxNativeZoom,
    subdomains: def.opts.subdomains
  };
}

/** Gỡ ảnh nền đã gắn bằng attachBasemap (bản đồ phụ đóng thì không còn trỏ vào lớp đã hủy) */
export function detachBasemap(m) {
  const entry = maps.get(m);
  if (entry) { entry.layer.remove(); maps.delete(m); }
  const labels = labelLayers.get(m);
  if (labels) { labels.remove(); labelLayers.delete(m); }
}

// Tên phường xã (nhãn ward-label-icon của mapEngine.js / planMap.js) ẩn bằng class trên body
const WARD_NAMES_KEY = 'qh_ward_names';

function setWardNames(on) {
  document.body.classList.toggle('ward-names-off', !on);
  const btn = document.getElementById('btnWardNames');
  if (btn) {
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }
  try { localStorage.setItem(WARD_NAMES_KEY, on ? '1' : '0'); } catch (e) { /* chế độ riêng tư */ }
}

/** Lớp tile GEE: ô gốc tới GEE_NATIVE_ZOOM, mức cao hơn phóng ô đó. */
export function geeTileOpts(extra = {}) {
  return { maxZoom: MAP_MAX_ZOOM, maxNativeZoom: GEE_NATIVE_ZOOM, ...extra };
}

/** Ô chọn ảnh nền và nút "Aa" trong panel lớp */
export function initBasemapUi() {
  const sel = document.getElementById('basemapSelect');
  if (sel) {
    sel.value = current;
    sel.addEventListener('change', () => {
      if (!BASEMAPS[sel.value]) { sel.value = current; return; }
      selectBasemap(sel.value);
    });
  }
  document.getElementById('btnRoadLabels')?.addEventListener('click', () => setLabelsOverlay(!labelsOn));
  let wardNames = true;
  try { wardNames = localStorage.getItem(WARD_NAMES_KEY) !== '0'; } catch (e) { /* chế độ riêng tư */ }
  setWardNames(wardNames);
  document.getElementById('btnWardNames')?.addEventListener('click', () => setWardNames(document.body.classList.contains('ward-names-off')));
}
