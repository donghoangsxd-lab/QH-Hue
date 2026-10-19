// Ảnh nền dùng chung cho bản đồ hiện trạng và quy hoạch.
// Mặc định Google vệ tinh. Nền nhạt là CARTO Positron không nhãn (OSM, miễn phí) để lớp quy hoạch nổi hơn.
// Lựa chọn ghi trên máy (qhhue.basemap). Lớp cắt nền điều chỉnh cục bộ luôn lấy vệ tinh Google.
const STORE_KEY = 'qhhue.basemap';

const BASEMAPS = {
  google: {
    label: 'Google vệ tinh',
    url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    opts: { maxNativeZoom: 19, subdomains: '0123', attribution: 'Imagery &copy; Google' }
  },
  positron: {
    label: 'Nền nhạt',
    url: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
    opts: {
      maxNativeZoom: 20,
      subdomains: 'abcd',
      detectRetina: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }
  }
};

// Tem đường + tên công trình (nền trong suốt) phủ trên ranh lô để nhận biết vị trí khi duyệt từng khu đất
const LABELS = {
  url: 'https://mt{s}.google.com/vt/lyrs=h&hl=vi&x={x}&y={y}&z={z}',
  opts: { maxNativeZoom: 19, subdomains: '0123', attribution: 'Nhãn &copy; Google' }
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

function defOf(id) {
  return BASEMAPS[id] || BASEMAPS.google;
}

function addBase(m, id) {
  const def = defOf(id);
  return L.tileLayer(def.url, { maxZoom: 21, zIndex: 0, crossOrigin: 'anonymous', ...def.opts }).addTo(m);
}

function addLabels(m) {
  if (!m.getPane(LABELS_PANE)) {
    const pane = m.createPane(LABELS_PANE);
    pane.style.zIndex = 450;
    pane.style.pointerEvents = 'none';
  }
  labelLayers.set(m, L.tileLayer(LABELS.url, { maxZoom: 21, pane: LABELS_PANE, ...LABELS.opts }).addTo(m));
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

export function basemapLabel() {
  return defOf(current).label;
}

/** Ảnh vệ tinh Google cho lớp cắt nền điều chỉnh cục bộ, không đổi theo nền nhạt đang xem */
export function basemapTileSpec() {
  const def = BASEMAPS.google;
  return {
    url: def.url,
    maxZoom: 21,
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

/** Ô chọn ảnh nền và nút "Aa" trong panel lớp */
export function initBasemapUi() {
  const sel = document.getElementById('basemapSelect');
  if (sel) {
    sel.value = current;
    sel.addEventListener('change', () => {
      if (!BASEMAPS[sel.value]) { sel.value = current; return; }
      current = sel.value;
      try { localStorage.setItem(STORE_KEY, current); } catch (e) { /* chế độ riêng tư */ }
      applyBasemap();
    });
  }
  document.getElementById('btnRoadLabels')?.addEventListener('click', () => setLabelsOverlay(!labelsOn));
  let wardNames = true;
  try { wardNames = localStorage.getItem(WARD_NAMES_KEY) !== '0'; } catch (e) { /* chế độ riêng tư */ }
  setWardNames(wardNames);
  document.getElementById('btnWardNames')?.addEventListener('click', () => setWardNames(document.body.classList.contains('ward-names-off')));
}
