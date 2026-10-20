// Ảnh nền dùng chung cho bản đồ hiện trạng và quy hoạch.
// Mặc định Google vệ tinh. Nền nhạt ưu tiên CARTO Positron không nhãn; từ 25/9/2026 CARTO
// chỉ trả ô mờ "API key required" nếu thiếu key — khi đó đổi sang nền xám nhạt Esri (cùng vai trò).
// Lựa chọn ghi trên máy (qhhue.basemap). Lớp cắt nền điều chỉnh cục bộ luôn lấy vệ tinh Google.
// Mức phóng bản đồ cao hơn ô gốc: Leaflet phóng ô maxNativeZoom, không tắt lớp.
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
  // light: nền trắng/xám (CARTO Positron hoặc Esri Light Gray). Viền lô không làm sáng trên nền này.
  positron: { label: 'Nền nhạt', light: true }
};

export const BASEMAP_EVENT = 'qh:basemap';
export const isLightBasemap = () => !!(BASEMAPS[current] && BASEMAPS[current].light);

// Positron không nhãn, ô gốc tới z20. Không gắn ?key= : repo không giữ khóa CARTO.
const CARTO_LIGHT = {
  url: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
  opts: {
    maxNativeZoom: 20,
    subdomains: 'abcd',
    detectRetina: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
  }
};
// World Light Gray Canvas: ô có ảnh tới z16 (z17+ là ảnh báo hết dữ liệu, cùng một file).
// Thứ tự {z}/{y}/{x} là của ArcGIS. Phóng tiếp tới MAP_MAX_ZOOM bằng ô z16.
const ESRI_LIGHT = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  opts: {
    maxNativeZoom: 16,
    attribution: 'Nền &copy; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }
};
// Ô CARTO không khóa luôn ~2 KB (ảnh mờ), ô Positron thật của khu trung tâm lớn hơn nhiều.
const CARTO_PROBE = 'https://a.basemaps.cartocdn.com/light_nolabels/13/6544/3716.png';
const CARTO_BLANK_MAX = 3500;
const CARTO_PROBE_KEY = 'qhhue.cartoLight';

export function cartoTileUsable(byteLength) {
  return Number(byteLength) >= CARTO_BLANK_MAX;
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
let current = 'google';
try {
  const saved = localStorage.getItem(STORE_KEY);
  if (BASEMAPS[saved]) current = saved;
} catch (e) { /* chế độ riêng tư */ }

// Mặc định Esri để không kịp vẽ ô mờ CARTO. Probe xong mà CARTO còn ảnh thật thì đổi lại.
let lightKind = 'esri';
try {
  if (sessionStorage.getItem(CARTO_PROBE_KEY) === 'ok') lightKind = 'carto';
} catch (e) { /* chế độ riêng tư */ }
let lightProbe = null;

function defOf(id) {
  if (id === 'positron') {
    const src = lightKind === 'carto' ? CARTO_LIGHT : ESRI_LIGHT;
    return { label: 'Nền nhạt', url: src.url, opts: src.opts };
  }
  return BASEMAPS[id] || BASEMAPS.google;
}

function rememberLight(kind) {
  lightKind = kind;
  try { sessionStorage.setItem(CARTO_PROBE_KEY, kind === 'carto' ? 'ok' : 'no'); } catch (e) { /* chế độ riêng tư */ }
}

function refreshPositronLayers() {
  maps.forEach((entry, m) => {
    if ((entry.pinned || current) !== 'positron') return;
    entry.layer.remove();
    entry.layer = addBase(m, 'positron');
  });
}

function applyLightKind(kind) {
  if (kind !== 'carto' && kind !== 'esri') kind = 'esri';
  const changed = lightKind !== kind;
  rememberLight(kind);
  if (changed) refreshPositronLayers();
}

// Một ô trung tâm Huế: CARTO không khóa trả ảnh mờ cỡ 2 KB (HTTP 200, không phải lỗi mạng).
function primeLightBasemap() {
  if (lightProbe || typeof fetch !== 'function' || typeof window === 'undefined') return lightProbe;
  const timer = new Promise(resolve => { setTimeout(() => resolve(null), 4500); });
  const probe = fetch(CARTO_PROBE, { mode: 'cors', cache: 'no-store' })
    .then(res => (res.ok && (res.headers.get('content-type') || '').includes('image') ? res.arrayBuffer() : null))
    .then(buf => (buf && cartoTileUsable(buf.byteLength) ? 'carto' : 'esri'))
    .catch(() => 'esri');
  lightProbe = Promise.race([probe, timer]).then(kind => {
    applyLightKind(kind || 'esri');
  });
  return lightProbe;
}

// detectRetina của Leaflet giảm maxZoom của layer đi 1 trên màn retina, nên cộng bù để vẫn tới MAP_MAX_ZOOM
function layerMaxZoom(opts) {
  return MAP_MAX_ZOOM + (opts && opts.detectRetina ? 1 : 0);
}

let cartoErrors = 0;
function addBase(m, id) {
  const def = defOf(id);
  const layer = L.tileLayer(def.url, { maxZoom: layerMaxZoom(def.opts), zIndex: 0, crossOrigin: 'anonymous', ...def.opts }).addTo(m);
  if (id === 'positron' && lightKind === 'carto') {
    layer.on('tileerror', () => {
      if (lightKind !== 'carto' || ++cartoErrors < 3) return;
      applyLightKind('esri');
    });
  }
  return layer;
}

function addLabels(m) {
  if (!m.getPane(LABELS_PANE)) {
    const pane = m.createPane(LABELS_PANE);
    pane.style.zIndex = 450;
    pane.style.pointerEvents = 'none';
  }
  labelLayers.set(m, L.tileLayer(LABELS.url, { maxZoom: layerMaxZoom(LABELS.opts), pane: LABELS_PANE, ...LABELS.opts }).addTo(m));
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
  primeLightBasemap();
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

/** Đổi ảnh nền và báo các lớp lô vẽ lại viền. id: 'google' | 'positron'. */
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
  primeLightBasemap();
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
