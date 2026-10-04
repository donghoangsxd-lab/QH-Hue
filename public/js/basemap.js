// Ảnh nền vệ tinh dùng chung cho bản đồ hiện trạng và quy hoạch; lựa chọn lưu trong trình duyệt.
// Esri Wayback: kho ảnh lịch sử của Esri — dò các phiên bản ảnh thực sự khác nhau tại tâm khung nhìn để chọn bản ít mây.
const STORE_KEY = 'qhhue.basemap';
const WAYBACK_CONFIG_URL = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';
const WAYBACK_TILE = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{r}/{z}/{y}/{x}';
const WAYBACK_TILEMAP = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap';
const WAYBACK_PROBE_ZOOM = 17;
const WAYBACK_MAX_VERSIONS = 12;

export const BASEMAPS = {
  esri: {
    label: 'Esri World Imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts: { maxNativeZoom: 18, attribution: 'Tiles &copy; Esri' }
  },
  wayback: {
    label: 'Esri Wayback (chọn phiên bản ít mây)',
    url: WAYBACK_TILE,
    opts: { maxNativeZoom: 18, attribution: 'Tiles &copy; Esri World Imagery Wayback' }
  },
  google: {
    label: 'Google vệ tinh (sắc nét, ít mây)',
    url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    opts: { maxNativeZoom: 19, subdomains: '0123', attribution: 'Imagery &copy; Google' }
  },
  s2: {
    label: 'Sentinel-2 không mây 2025 (10 m)',
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg',
    opts: { maxNativeZoom: 15, attribution: 'Sentinel-2 cloudless 2025 &copy; EOX IT Services GmbH (Copernicus Sentinel data 2025)' }
  }
};

// Tem đường + tên công trình (nền trong suốt) phủ trên ranh lô để nhận biết vị trí khi duyệt từng khu đất
const LABELS = {
  url: 'https://mt{s}.google.com/vt/lyrs=h&hl=vi&x={x}&y={y}&z={z}',
  opts: { maxNativeZoom: 19, subdomains: '0123', attribution: 'Nhãn &copy; Google' }
};
const LABELS_PANE = 'labelsPane';

const maps = new Map();   // bản đồ → lớp ảnh nền đang gắn
const labelLayers = new Map();   // bản đồ → lớp tem đang gắn
let labelsOn = false;

function addLabels(m) {
  if (!m.getPane(LABELS_PANE)) {
    const pane = m.createPane(LABELS_PANE);
    pane.style.zIndex = 450;
    pane.style.pointerEvents = 'none';
  }
  labelLayers.set(m, L.tileLayer(LABELS.url, { maxZoom: 19, pane: LABELS_PANE, ...LABELS.opts }).addTo(m));
}

/** Bật / tắt tem đường, tên công trình trên mọi bản đồ đã gắn ảnh nền */
export function setLabelsOverlay(on) {
  labelsOn = !!on;
  labelLayers.forEach(layer => layer.remove());
  labelLayers.clear();
  if (labelsOn) maps.forEach((_, m) => addLabels(m));
}

export const labelsOverlayOn = () => labelsOn;
let saved = {};
try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { saved = {}; }
let current = BASEMAPS[saved.key] ? saved.key : 'esri';
let waybackRelease = Number(saved.release) || null;
let waybackList = null;   // [{ num, date }] mới → cũ

function createLayer() {
  const def = BASEMAPS[current];
  const url = current === 'wayback' ? def.url.replace('{r}', waybackRelease) : def.url;
  return L.tileLayer(url, { maxZoom: 19, zIndex: 0, crossOrigin: 'anonymous', ...def.opts });
}

function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ key: current, release: waybackRelease })); } catch (e) { /* chế độ riêng tư */ }
}

/** Gắn ảnh nền đang chọn vào bản đồ (gọi khi khởi tạo map / planMap) */
export function attachBasemap(m) {
  if (current === 'wayback' && !waybackRelease) current = 'esri';
  const layer = createLayer().addTo(m);
  maps.set(m, layer);
  if (labelsOn) {
    labelLayers.get(m)?.remove();
    addLabels(m);
  }
  return layer;
}

function applyBasemap() {
  maps.forEach((old, m) => {
    old.remove();
    maps.set(m, createLayer().addTo(m));
  });
  persist();
}

export function basemapLabel() {
  if (current === 'wayback') {
    const v = waybackList?.find(x => x.num === waybackRelease);
    return `Esri World Imagery Wayback${v ? ` ${v.date}` : ''}`;
  }
  return BASEMAPS[current].label.replace(/\s*\(.*\)$/, '');
}

async function loadWaybackList() {
  if (waybackList) return waybackList;
  const res = await fetch(WAYBACK_CONFIG_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const cfg = await res.json();
  waybackList = Object.entries(cfg)
    .map(([num, v]) => ({ num: Number(num), date: (String(v.itemTitle || '').match(/\d{4}-\d{2}-\d{2}/) || [''])[0] }))
    .filter(v => v.num && v.date)
    .sort((a, b) => b.date.localeCompare(a.date));
  return waybackList;
}

function tileAt(lat, lng, z) {
  const n = 2 ** z;
  const x = Math.floor((lng + 180) / 360 * n);
  const rad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2 * n);
  return { x, y };
}

// Mỗi bản phát hành chỉ thay ảnh ở vài nơi: hỏi tilemap xem ô tại tâm thực ra lấy từ bản nào ("select"),
// rồi nhảy tới bản cũ hơn bản đó → danh sách các phiên bản ảnh khác nhau tại vị trí (mỗi bước 1 yêu cầu)
async function waybackVersionsAt(lat, lng) {
  const list = await loadWaybackList();
  const { x, y } = tileAt(lat, lng, WAYBACK_PROBE_ZOOM);
  const out = [];
  let i = 0;
  while (i < list.length && out.length < WAYBACK_MAX_VERSIONS) {
    const res = await fetch(`${WAYBACK_TILEMAP}/${list[i].num}/${WAYBACK_PROBE_ZOOM}/${y}/${x}`);
    const data = res.ok ? await res.json().catch(() => null) : null;
    if (!data || !Array.isArray(data.data) || !data.data[0]) break;
    const sel = Array.isArray(data.select) && data.select[0] ? data.select[0] : list[i].num;
    const idx = list.findIndex(v => v.num === sel);
    if (idx < 0) break;
    out.push(list[idx]);
    i = idx + 1;
  }
  return out;
}

/** Ô chọn ảnh nền trong panel lớp; getCenter() → tâm khung nhìn để dò phiên bản Wayback */
export function initBasemapUi(getCenter) {
  const sel = document.getElementById('basemapSelect');
  const box = document.getElementById('waybackBox');
  const verSel = document.getElementById('waybackSelect');
  const scanBtn = document.getElementById('btnWaybackScan');
  if (!sel) return;
  sel.innerHTML = Object.entries(BASEMAPS).map(([k, d]) => `<option value="${k}">${d.label}</option>`).join('');
  sel.value = current;

  const scan = async () => {
    if (!verSel) return;
    const c = getCenter();
    verSel.innerHTML = '<option>Đang dò các phiên bản ảnh...</option>';
    verSel.disabled = true;
    try {
      const versions = await waybackVersionsAt(c.lat, c.lng);
      if (!versions.length) throw new Error('không có ảnh');
      if (!versions.some(v => v.num === waybackRelease)) waybackRelease = versions[0].num;
      verSel.innerHTML = versions.map(v => `<option value="${v.num}">${v.date}</option>`).join('');
      verSel.value = String(waybackRelease);
      verSel.disabled = false;
      if (current === 'wayback') applyBasemap();
    } catch (err) {
      verSel.innerHTML = '<option>Không tải được danh sách phiên bản</option>';
      console.warn('Esri Wayback:', err);
    }
  };

  sel.addEventListener('change', async () => {
    const key = sel.value;
    if (box) box.style.display = key === 'wayback' ? '' : 'none';
    if (key === 'wayback' && !waybackRelease) {
      await scan();
      if (!waybackRelease) { sel.value = current; return; }
    }
    current = key;
    applyBasemap();
    if (key === 'wayback' && verSel && verSel.options.length <= 1) scan();
  });
  verSel?.addEventListener('change', () => {
    waybackRelease = Number(verSel.value) || waybackRelease;
    applyBasemap();
  });
  scanBtn?.addEventListener('click', scan);
  if (current === 'wayback') {
    if (box) box.style.display = '';
    scan();
  }
}
