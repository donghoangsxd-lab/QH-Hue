// Ảnh nền vệ tinh Google dùng chung cho bản đồ hiện trạng và quy hoạch (bỏ ô chọn ảnh nền: Google đã đủ sắc nét, ít mây)
const BASEMAP = {
  label: 'Google vệ tinh',
  url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
  opts: { maxNativeZoom: 19, subdomains: '0123', attribution: 'Imagery &copy; Google' }
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

/** Gắn ảnh nền vào bản đồ (gọi khi khởi tạo map / planMap) */
export function attachBasemap(m) {
  maps.get(m)?.remove();
  const layer = L.tileLayer(BASEMAP.url, { maxZoom: 19, zIndex: 0, crossOrigin: 'anonymous', ...BASEMAP.opts }).addTo(m);
  maps.set(m, layer);
  if (labelsOn) {
    labelLayers.get(m)?.remove();
    addLabels(m);
  }
  return layer;
}

export function basemapLabel() {
  return BASEMAP.label;
}

/** Nút tem đường "Aa" trong panel lớp */
export function initBasemapUi() {
  document.getElementById('btnRoadLabels')?.addEventListener('click', () => setLabelsOverlay(!labelsOn));
}
