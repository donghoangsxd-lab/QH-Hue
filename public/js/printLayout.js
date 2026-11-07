// Chụp bản đồ (PNG) và in khung bản đồ ngang (PDF): khung xem trước để căn vùng in, khổ A3–4A0,
// lưới tọa độ VN-2000, hướng Bắc, tỷ lệ, chú giải theo lớp đang bật và cấp quy hoạch đang chọn.
// PDF gồm 3 tầng trong khung bản đồ: ảnh nền (ô vệ tinh / canvas đường phố, heatmap), đối tượng vector vẽ lại từ tọa độ (printVector.js),
// ảnh icon trong suốt. Lưới, khung, chữ, chú giải là vector.
// Cột ghi chú giữ chromeScale theo khổ (không nới rộng trên A0+). Khung chọn trên bản đồ phải theo
// tỷ lệ vùng map còn lại của khổ đang chọn — nếu giữ 1:1 / A3 sẽ hụt, để khoảng trắng khi in.
// Chữ lưới VN-2000 cũng chromeScale, không nhân tuyến tính theo bề ngang tờ.
// Khi xuất: ép hoa văn TT16 lên canvas Leaflet rồi chụp canvas đó vào PDF (vector không vẽ lại được CanvasPattern).
// html2canvas không hiểu clip-path → khi so sánh chụp riêng 2 bản đồ rồi ghép theo vị trí thanh trượt.
import { announceFloat, FLOAT_OPEN_EVENT } from './utils.js';
import { map, popLayerMeta } from './mapEngine.js';
import { popMethod } from './popMethod.js';
import { planMap, isCompareOn, isSplitOn, alignPlanView } from './planMap.js';
import { state } from './state.js';
import { wgs84ToVn2000 } from './cadImport.js';
import { satPrintLegend } from './satLayers.js';
import { basemapLabel, isLightBasemap, whenBasemapSettled } from './basemap.js';
import { getLevel, levelChk, LEVELS } from './mapLevel.js';
import { LEGEND_SETS, TT16_STYLES, tt16SwatchCss, setPrintTt16Detail, tt16Detailed } from './tt16Symbols.js';
import {
  PX_MM, loadPrintFonts, createPdf, cleanText, setFont, setAlpha, withClip, parseColor,
  vectorContainers, captureVectorGroups, drawMapPaths, drawDom
} from './printVector.js';
import { escapeHtml, distanceMeters, loadHtml2Canvas, loadJsPdf, showToast, inlineSpriteIcons } from './utils.js';

const CITY_NAME = 'Thành phố Huế';
const SKIP_CLASSES = ['leaflet-control-container', 'leaflet-popup-pane', 'leaflet-tooltip-pane'];

// Tờ A3 ngang ở 96 dpi (420 × 297 mm); khổ lớn hơn nhân lề/khung theo bề ngang; chữ và cột ghi chú dùng chromeScale
const DPI = 96;
const A3 = { pageW: 1587, pageH: 1122, m: 24, side: 372, gutX: 44, gutY: 36 };
const PAPERS = [
  { id: 'a3', label: 'A3', wMm: 420, hMm: 297 },
  { id: 'a2', label: 'A2', wMm: 594, hMm: 420 },
  { id: 'a1', label: 'A1', wMm: 841, hMm: 594 },
  { id: 'a0', label: 'A0', wMm: 1189, hMm: 841 },
  { id: '2a0', label: '2A0', wMm: 1682, hMm: 1189 },
  { id: '4a0', label: '4A0', wMm: 2378, hMm: 1682 }
];
/** Chữ / bề rộng cột ghi chú / số lưới: tăng chậm theo khổ (không nhân đủ theo bề ngang tờ) */
function chromeScale(s) {
  return Math.pow(Math.max(s, 1e-6), 0.4);
}
// Bố cục hai ô (chia đôi): dải tiêu đề ~8%, dải ghi chú gọn ~14%, phần giữa chia đôi cho HT | QH
const A3_DUAL = (() => {
  const { pageW, pageH, m: M } = A3;
  const gap = A3.gutX;
  const sec = 20;
  const titleH = Math.round((pageH - 2 * M) * 0.08);
  const notesH = Math.round((pageH - 2 * M) * 0.14);
  const mapsY = M + titleH + sec;
  const notesY = pageH - M - notesH;
  const mapsH = notesY - mapsY - sec;
  const mapW = (pageW - 2 * M - gap) / 2;
  return {
    titleH, notesH, mapsH, mapW, gap, sec,
    aspect: mapW / mapsH,
    title: { x: M, y: M, w: pageW - 2 * M, h: titleH },
    left: { x: M, y: mapsY, w: mapW, h: mapsH },
    right: { x: M + mapW + gap, y: mapsY, w: mapW, h: mapsH },
    notes: { x: M, y: notesY, w: pageW - 2 * M, h: notesH }
  };
})();
const FRAME_ASPECT_DUAL = A3_DUAL.aspect;
const NICE_STEPS = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000];
// Ảnh nền trong khung in: độ phân giải mục tiêu; giới hạn khung dựng và số điểm ảnh để trình duyệt không hết bộ nhớ
const RASTER_DPI = 160;
const STAGE_MAX_PX = 3600;
const STAGE_MAX_GAIN = 2.5;
const BASE_MAX_PIXELS = 40e6;
const TOP_MAX_PIXELS = 20e6;
const INK = [15, 23, 42];

const LEVEL_SET = { qhc25: 'QHC25', qhc10: 'QHC', qhpk: 'QHPK', qhct: 'QHCT' };
const INFRA_LEGEND = [
  ['chk_c1', 'Park.png'], ['chk_c2', 'Parking.png'], ['chk_c3', 'Mamnon.png'], ['chk_c4', 'Tieuhoc.png'],
  ['chk_c5', 'THCS.png'], ['chk_c10', 'THPT.png'], ['chk_c6', 'Yte.png'], ['chk_c7', 'Vanhoa.png'],
  ['chk_c8', 'Cho.png'], ['chk_c9', 'Unused.png'], ['chk_c11', 'Bus.svg'], ['chk_c12', 'Pccc.svg'], ['chk_c13', 'Nghiatrang.svg'], ['chk_c14', 'Noxh.svg']
];

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const checked = (id) => !!$(id)?.checked;
const spaced = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const dotted = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
let busy = false;
let previewOn = false;
let paperId = 'a3';
let frameKind = 'side';
let frameUser = null;
let dockBound = false;
let frameObserver = null;
let classObserver = null;
/** Tùy chọn dock: lưới VN-2000 và tiêu đề lớn giữa phía trên vùng map */
let showGrid = true;
let showMapBanner = false;

const FRAME_LABEL = { plain: 'Khung trống', side: 'Ghi chú bên phải' };
const DEFAULT_NOTE = 'Bản đồ phục vụ tham khảo, không thay thế hồ sơ quy hoạch được phê duyệt.';

function sheetOf(id, kind = frameKind) {
  const paper = PAPERS.find(p => p.id === id) || PAPERS[0];
  const pageW = Math.floor(paper.wMm / 25.4 * DPI);
  const pageH = Math.floor(paper.hMm / 25.4 * DPI);
  const s = pageW / A3.pageW;
  const cs = chromeScale(s);
  const M = A3.m * s;
  const GUT_X = A3.gutX * s;
  const GUT_Y = A3.gutY * s;
  if (kind === 'plain') {
    const gut = 36 * s;
    const maxW = pageW - 2 * M - 2 * gut;
    const maxH = pageH - 2 * M - 2 * gut;
    const aspect = pageW / pageH;
    let w = maxW;
    let h = w / aspect;
    if (h > maxH) { h = maxH; w = h * aspect; }
    return {
      paper, pageW, pageH, s, cs, M, SIDE_W: 0, GUT_X: gut, GUT_Y: gut, dual: false, kind,
      notesBand: null,
      frame: { x: M + gut + (maxW - w) / 2, y: M + gut + (maxH - h) / 2, w, h }
    };
  }
  // Cột ghi chú giữ chromeScale theo khổ (không nới rộng). Vùng map = chỗ còn lại → quyết định tỷ lệ khung chọn.
  const SIDE_W = Math.min(A3.side * cs, pageW * 0.22);
  const maxW = pageW - SIDE_W - 2 * M - 2 * GUT_X;
  const maxH = pageH - 2 * M - 2 * GUT_Y;
  return {
    paper, pageW, pageH, s, cs, M, SIDE_W, GUT_X, GUT_Y, dual: false, kind: 'side', notesBand: null,
    frame: { x: M + GUT_X, y: M + GUT_Y, w: maxW, h: maxH }
  };
}

/** Tỷ lệ khung chọn trên bản đồ = đúng vùng map của khổ/dạng khung đang chọn (không 1:1, không khóa A3) */
function previewAspect() {
  if (dualLayout()) return FRAME_ASPECT_DUAL;
  const frame = sheetOf(paperId, frameKind).frame;
  return frame.w / frame.h;
}

function sheetOfDual(id) {
  const paper = PAPERS.find(p => p.id === id) || PAPERS[0];
  const pageW = Math.floor(paper.wMm / 25.4 * DPI);
  const pageH = Math.floor(paper.hMm / 25.4 * DPI);
  const s = pageW / A3.pageW;
  const cs = chromeScale(s);
  const sc = (r) => ({ x: r.x * s, y: r.y * s, w: r.w * s, h: r.h * s });
  const left = sc(A3_DUAL.left);
  const right = sc(A3_DUAL.right);
  return {
    paper, pageW, pageH, s, cs,
    M: A3.m * s, SIDE_W: 0, GUT_X: A3_DUAL.gap * s, GUT_Y: A3_DUAL.sec * s, dual: true,
    titleBand: sc(A3_DUAL.title),
    notesBand: sc(A3_DUAL.notes),
    leftFrame: left,
    rightFrame: right,
    frame: left
  };
}

const toMm = (r) => ({ x: r.x * PX_MM, y: r.y * PX_MM, w: r.w * PX_MM, h: r.h * PX_MM });

/** Chia đôi màn hình → bố cục PDF hai ô HT|QH + ghi chú ngang */
function dualLayout() {
  return !!(isSplitOn() && planMap);
}

function activeSheet() {
  return dualLayout() ? sheetOfDual(paperId) : sheetOf(paperId);
}

function viewMap() {
  return (isCompareOn() && planMap && !isSplitOn()) ? planMap : map;
}

function dividerX(host) {
  const divider = $('swipeDivider');
  if (!divider || !host || !isSplitOn()) return Infinity;
  return divider.getBoundingClientRect().left - host.getBoundingClientRect().left;
}

function latLngAt(x, y) {
  // Dual: hai ô cùng vùng địa lý — luôn lấy từ bản đồ hiện trạng để lưới khớp nhau
  if (dualLayout()) return map.containerPointToLatLng([x, y]);
  const host = $('map');
  const usePlan = planMap && ((isSplitOn() && x >= dividerX(host)) || (isCompareOn() && !isSplitOn()));
  return (usePlan ? planMap : map).containerPointToLatLng([x, y]);
}

function defaultTitle() {
  if (isSplitOn()) return 'BẢN ĐỒ SO SÁNH HIỆN TRẠNG – QUY HOẠCH HẠ TẦNG XÃ HỘI';
  if (isCompareOn()) return 'BẢN ĐỒ QUY HOẠCH HẠ TẦNG XÃ HỘI';
  return 'BẢN ĐỒ HIỆN TRẠNG HẠ TẦNG XÃ HỘI';
}

// ================== CHỤP BẢN ĐỒ ==================
// Pane chứa icon (marker, shadow, pane riêng có marker): chụp thành ảnh trong suốt đặt trên lớp vector
function topPanes(m) {
  const panes = m.getPanes();
  return Object.values(panes).filter(p => p !== panes.mapPane && (
    p.classList.contains('leaflet-marker-pane') || p.classList.contains('leaflet-shadow-pane')
    || [...p.children].some(c => c.classList.contains('leaflet-marker-icon'))
  ));
}

/** mode: 'all' ảnh như màn hình; 'base' bỏ vector và icon; 'top' chỉ icon trên nền trong suốt */
function layerFilter(m, mode) {
  if (mode === 'all') return {};
  const host = m.getContainer();
  const vec = vectorContainers([m]);
  const tops = topPanes(m);
  if (mode === 'base') return { skip: n => vec.has(n) || tops.includes(n) };
  return {
    transparent: true,
    skip: n => host.contains(n) && n !== host && (vec.has(n) || !tops.some(p => p.contains(n) || n.contains(p)))
  };
}

// html2canvas đọc canvas WebGL của nền đường phố ra trong suốt vì buffer đã bị xóa, vùng nền thành một màu đặc.
// Ô ảnh và canvas nền được chép theo vị trí trên màn hình, đặt dưới nét vector.
function ownRaster(n) {
  if (!n.classList) return false;
  if (n.tagName === 'IMG' && n.classList.contains('leaflet-tile')) {
    const src = n.currentSrc || n.src || '';
    return src.startsWith('blob:') || src.startsWith('data:') || !!n.crossOrigin;
  }
  return n.tagName === 'CANVAS' && (n.classList.contains('maplibregl-canvas') || n.classList.contains('leaflet-tile'));
}

function paneZ(node) {
  const pane = node.closest('.leaflet-pane');
  return pane ? (parseInt(getComputedStyle(pane).zIndex, 10) || 0) : 0;
}

function shownAlpha(node, stop) {
  let a = 1;
  for (let n = node; n && n !== stop; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
    a *= Number(cs.opacity);
  }
  return a;
}

function readableRaster(node) {
  if (node.tagName === 'IMG' && (!node.complete || !node.naturalWidth)) return false;
  if (node.tagName === 'CANVAS' && (!node.width || !node.height)) return false;
  const probe = document.createElement('canvas');
  probe.width = probe.height = 1;
  try {
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    pctx.drawImage(node, 0, 0, 1, 1);
    pctx.getImageData(0, 0, 1, 1);
    return true;
  } catch (e) {
    return false;
  }
}

// Vẽ nền xuống dưới lớp html2canvas (vector, icon). destination-over giữ nét đã chụp ở trên.
function underlayRasters(overlay, el) {
  const origin = el.getBoundingClientRect();
  if (origin.width < 2 || origin.height < 2) return overlay;
  const ctx = overlay.getContext('2d');
  const sx = overlay.width / origin.width;
  const sy = overlay.height / origin.height;
  // html2canvas để lại scale/translate trên context; vẽ theo pixel canvas.
  const nodes = [...el.querySelectorAll('img.leaflet-tile, canvas.maplibregl-canvas, canvas.leaflet-tile')]
    .filter(ownRaster)
    .filter(node => shownAlpha(node, el) > 0.01 && readableRaster(node))
    .map((node, i) => ({ node, i, z: paneZ(node), alpha: shownAlpha(node, el) }))
    .sort((a, b) => b.z - a.z || b.i - a.i);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.globalAlpha = 1;
  nodes.forEach(({ node, alpha }) => {
    const r = node.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    ctx.save();
    if (alpha < 1) ctx.globalAlpha = alpha;
    try {
      ctx.drawImage(node, (r.left - origin.left) * sx, (r.top - origin.top) * sy, r.width * sx, r.height * sy);
    } catch (e) { /* ô khác nguồn */ }
    ctx.restore();
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = isLightBasemap() ? '#f4f1ea' : '#0f172a';
  ctx.fillRect(0, 0, overlay.width, overlay.height);
  ctx.restore();
  return overlay;
}

function snap(el, scale, size, { skip = null, transparent = false } = {}) {
  return window.html2canvas(el, {
    useCORS: true,
    logging: false,
    backgroundColor: null,
    scale,
    scrollX: 0,
    scrollY: 0,
    windowWidth: Math.max(window.innerWidth, size.x + 20),
    windowHeight: Math.max(window.innerHeight, size.y + 20),
    onclone: (doc) => {
      inlineSpriteIcons(doc);
      if (el.id) {
        const clone = doc.getElementById(el.id);
        if (clone) clone.style.setProperty('background', 'transparent', 'important');
      }
    },
    ignoreElements: (n) => SKIP_CLASSES.some(c => n.classList?.contains(c)) || (skip ? skip(n) : false) || ownRaster(n)
  }).then(canvas => (transparent ? canvas : underlayRasters(canvas, el)));
}

/** Chụp một bản đồ (không ghép thanh trượt) — dùng cho bố cục dual HT|QH */
async function captureOneMap(m, scale, mode = 'all') {
  await loadHtml2Canvas();
  const size = m.getSize();
  return snap(m.getContainer(), scale, size, layerFilter(m, mode));
}

/** Ảnh bản đồ đang xem (ghép hiện trạng | quy hoạch khi chia đôi); splitX = vị trí thanh trượt (px CSS) hoặc null */
async function captureMapCanvas(scale, mode = 'all') {
  await loadHtml2Canvas();
  const size = map.getSize();
  const shoot = (m) => snap(m.getContainer(), scale, size, layerFilter(m, mode));
  if (isCompareOn() && planMap && !isSplitOn()) return { canvas: await shoot(planMap), splitX: null };
  const canvas = await shoot(map);
  if (!isCompareOn() || !planMap) return { canvas, splitX: null };
  const right = await shoot(planMap);
  const splitX = dividerX($('map'));
  const x = Number.isFinite(splitX) ? splitX : size.x / 2;
  const sx = Math.round(x * scale);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(sx, 0, canvas.width - sx, canvas.height);
  ctx.drawImage(right, sx, 0, right.width - sx, right.height, sx, 0, right.width - sx, right.height);
  return { canvas, splitX: x };
}

function hasTopIcons(maps) {
  return maps.some(m => topPanes(m).some(p => p.querySelector('.leaflet-marker-icon')));
}

function cropCanvas(canvas, rect, hostSize) {
  const sx = canvas.width / hostSize.x;
  const sy = canvas.height / hostSize.y;
  const x = Math.max(0, Math.round(rect.x * sx));
  const y = Math.max(0, Math.round(rect.y * sy));
  const w = Math.max(1, Math.min(Math.round(rect.w * sx), canvas.width - x));
  const h = Math.max(1, Math.min(Math.round(rect.h * sy), canvas.height - y));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return out;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Chụp khung bản đồ (kể cả chế độ so sánh) thành ảnh PNG; lỗi thì quay về hộp thoại in của trình duyệt
export async function captureMapScreenshot() {
  if (!map || busy) return;
  busy = true;
  try {
    showToast('⏳ Đang chụp ảnh bản đồ...');
    const { canvas } = await captureMapCanvas(window.devicePixelRatio || 1);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Không tạo được ảnh');
    download(blob, `Ban-do-ha-tang-Hue-${new Date().toISOString().slice(0, 10)}.png`);
    showToast('✓ Đã lưu ảnh bản đồ', 'success');
  } catch (err) {
    console.warn('Chụp ảnh bản đồ lỗi, chuyển sang in:', err);
    window.print();
  } finally {
    busy = false;
  }
}

// ================== DỰNG BẢN ĐỒ THEO VÙNG TRONG KHUNG ==================
/** Chờ các lớp ảnh nền / heatmap tải xong ô (tối đa timeout) */
async function waitTiles(maps, timeout = 12000) {
  await sleep(200);
  const loading = [];
  maps.forEach(m => m.eachLayer(l => { if (l instanceof L.GridLayer && l.isLoading()) loading.push(l); }));
  await Promise.race([
    Promise.all([
      ...loading.map(l => new Promise(r => l.once('load', r))),
      ...maps.map(m => whenBasemapSettled(m, timeout))
    ]),
    sleep(timeout)
  ]);
  await sleep(300);
}

function setViewExact(m, center, zoom) {
  const zoomSnap = m.options.zoomSnap;
  m.options.zoomSnap = 0;
  m.setView(center, zoom, { animate: false });
  m.options.zoomSnap = zoomSnap;
}

/**
 * Phóng khung bản đồ đúng vùng trong khung xem trước (giữ phạm vi, tăng độ nét); trả về hàm khôi phục.
 * Phải cập nhật kích thước CẢ HAI bản đồ trước khi đặt tâm: invalidateSize({ pan: false }) giữ góc trên trái
 * nên phát 'move', syncMaps (planMap.js) sẽ kéo bản đồ kia lệch tâm nếu gọi sau setView.
 */
async function stageFrame(rect, pixelW) {
  const src = viewMap();
  const center = src.containerPointToLatLng([rect.x + rect.w / 2, rect.y + rect.h / 2]);
  const zoom0 = src.getZoom();
  const want = pixelW / rect.w;
  const cap = STAGE_MAX_PX / Math.max(rect.w, rect.h);
  const k = Math.min(Math.max(1, want), cap, STAGE_MAX_GAIN);
  const zoom1 = Math.min(src.getMaxZoom(), Math.max(src.getMinZoom(), zoom0 + Math.log2(k)));
  const used = 2 ** (zoom1 - zoom0);
  const W = Math.max(2, Math.round(rect.w * used));
  const H = Math.max(2, Math.round(rect.h * used));
  const area = $('mapArea');
  const saved = { center: src.getCenter(), zoom: src.getZoom() };
  const maps = [map, isCompareOn() ? planMap : null].filter(Boolean);
  const apply = (c, z) => {
    maps.forEach(m => m.invalidateSize({ pan: false }));
    setViewExact(src, c, z);
    if (maps.length > 1 && src === map) alignPlanView();
  };
  const drifted = () => {
    const p = src.latLngToContainerPoint(center);
    const size = src.getSize();
    return Math.abs(p.x - size.x / 2) > 1 || Math.abs(p.y - size.y / 2) > 1;
  };
  area.style.setProperty('--print-w', `${W}px`);
  area.style.setProperty('--print-h', `${H}px`);
  area.classList.add('print-staging');
  void area.offsetWidth;
  apply(center, zoom1);
  await waitTiles(maps);
  if (drifted()) {
    apply(center, zoom1);
    await waitTiles(maps);
  }
  return {
    map: src,
    size: src.getSize(),
    restore: () => {
      area.classList.remove('print-staging');
      area.style.removeProperty('--print-w');
      area.style.removeProperty('--print-h');
      void area.offsetWidth;
      apply(saved.center, saved.zoom);
    }
  };
}

// ================== LƯỚI TỌA ĐỘ VN-2000 ==================
/** Giao điểm của đường lưới (E hoặc N chia hết cho step) với 1 cạnh khung: [{ value, t }] với t = vị trí px dọc cạnh */
function edgeCrossings(pointAt, len, axis, step, m) {
  const out = [];
  let prev = null;
  for (let t = 0; t <= len; t += 2) {
    const p = pointAt(t);
    const ll = m ? m.containerPointToLatLng(p) : latLngAt(p[0], p[1]);
    const v = wgs84ToVn2000(ll.lat, ll.lng)[axis];
    if (prev) {
      const a = Math.floor(prev.v / step), b = Math.floor(v / step);
      if (a !== b) {
        const value = Math.max(a, b) * step;
        out.push({ value, t: prev.t + (t - prev.t) * (value - prev.v) / (v - prev.v) });
      }
    }
    prev = { t, v };
  }
  return out;
}

function niceStep(span, target, steps) {
  return steps.find(s => span / s <= target) || steps[steps.length - 1];
}

function computeGrid(rect, m) {
  const at = (x, y) => (m ? m.containerPointToLatLng([x, y]) : latLngAt(x, y));
  const vn = (x, y) => wgs84ToVn2000(at(x, y).lat, at(x, y).lng);
  const spanE = Math.abs(vn(rect.x + rect.w, rect.y + rect.h / 2)[0] - vn(rect.x, rect.y + rect.h / 2)[0]);
  const spanN = Math.abs(vn(rect.x + rect.w / 2, rect.y)[1] - vn(rect.x + rect.w / 2, rect.y + rect.h)[1]);
  const step = niceStep(Math.max(spanE, spanN), 7, NICE_STEPS);
  return {
    step,
    size: { w: rect.w, h: rect.h },
    top: edgeCrossings(t => [rect.x + t, rect.y], rect.w, 0, step, m),
    bottom: edgeCrossings(t => [rect.x + t, rect.y + rect.h], rect.w, 0, step, m),
    left: edgeCrossings(t => [rect.x, rect.y + t], rect.h, 1, step, m),
    right: edgeCrossings(t => [rect.x + rect.w, rect.y + t], rect.h, 1, step, m)
  };
}

/**
 * Viền khung bản đồ (+ lưới / số tọa độ khi bật).
 * gridLines: nét lưới trong khung; ticks: vạch + số kinh/vĩ độ (chỉ khi có lưới).
 */
function drawFrameGrid(pdf, grid, framePx, sheet, { ticks = true, gridLines = true } = {}) {
  const F = toMm(framePx);
  const cs = sheet.cs || 1;
  const u = cs * PX_MM;
  const fx = F.w / grid.size.w;
  const fy = F.h / grid.size.h;
  const pair = (a, b) => {
    const m = new Map(b.map(p => [p.value, p.t]));
    return a.filter(p => m.has(p.value)).map(p => [p, m.get(p.value)]);
  };
  if (gridLines) {
    withClip(pdf, F, () => {
      pdf.setDrawColor(255, 255, 255);
      pdf.setLineWidth(0.7 * u);
      pdf.setLineCap('butt');
      pdf.setLineDashPattern([6 * u, 4 * u], 0);
      setAlpha(pdf, 1, 0.55);
      pair(grid.top, grid.bottom).forEach(([p, tb]) => pdf.line(F.x + p.t * fx, F.y, F.x + tb * fx, F.y + F.h));
      pair(grid.left, grid.right).forEach(([p, tr]) => pdf.line(F.x, F.y + p.t * fy, F.x + F.w, F.y + tr * fy));
    });
    pdf.setLineDashPattern([], 0);
    setAlpha(pdf, 1, 1);
    pdf.setDrawColor(...INK);
    pdf.setTextColor(...INK);
    pdf.setLineWidth(1 * u);
    setFont(pdf, false, 9.5 * cs);
    if (ticks) {
      const tick = 5.5 * u;
      const gap = 7 * u;
      const sideGap = 12 * u;
      const fontMm = 9.5 * u;
      grid.top.forEach(p => {
        const x = F.x + p.t * fx;
        pdf.line(x, F.y - tick, x, F.y);
        pdf.text(spaced(p.value), x, F.y - gap, { align: 'center', baseline: 'bottom' });
      });
      grid.bottom.forEach(p => {
        const x = F.x + p.t * fx;
        pdf.line(x, F.y + F.h, x, F.y + F.h + tick);
        pdf.text(spaced(p.value), x, F.y + F.h + gap, { align: 'center', baseline: 'top' });
      });
      const sideLabel = (xc, y, value) => {
        const str = spaced(value);
        pdf.text(str, xc + fontMm * 0.36, y + pdf.getTextWidth(str) / 2, { angle: 90 });
      };
      grid.left.forEach(p => {
        const y = F.y + p.t * fy;
        pdf.line(F.x - tick, y, F.x, y);
        sideLabel(F.x - sideGap, y, p.value);
      });
      grid.right.forEach(p => {
        const y = F.y + p.t * fy;
        pdf.line(F.x + F.w, y, F.x + F.w + tick, y);
        sideLabel(F.x + F.w + sideGap, y, p.value);
      });
    }
  }
  pdf.setDrawColor(...INK);
  setAlpha(pdf, 1, 1);
  pdf.setLineJoin('miter');
  pdf.setLineWidth(1.4 * u);
  pdf.rect(F.x, F.y, F.w, F.h, 'S');
}

function drawPageChrome(pdf, sheet, { sideSep = true } = {}) {
  const u = (sheet.cs || 1) * PX_MM;
  const M = sheet.M * PX_MM;
  const W = sheet.pageW * PX_MM;
  const H = sheet.pageH * PX_MM;
  const inset = 4 * u;
  pdf.setDrawColor(...INK);
  setAlpha(pdf, 1, 1);
  pdf.setLineJoin('miter');
  pdf.setLineWidth(2.4 * u);
  pdf.rect(M, M, W - 2 * M, H - 2 * M, 'S');
  pdf.setLineWidth(0.8 * u);
  pdf.rect(M + inset, M + inset, W - 2 * M - 2 * inset, H - 2 * M - 2 * inset, 'S');
  if (sideSep && sheet.SIDE_W > 0) {
    const sepX = W - M - sheet.SIDE_W * PX_MM;
    pdf.line(sepX, M + inset, sepX, H - M - inset);
  }
  if (sheet.notesBand) {
    const y = sheet.notesBand.y * PX_MM;
    pdf.line(M + inset, y, W - M - inset, y);
  }
}

/** Lưới (nếu bật), viền khung bản đồ và khung tờ (bố cục cột phải) */
function drawGridPdf(pdf, grid, sheet) {
  drawFrameGrid(pdf, grid, sheet.frame, sheet, { ticks: showGrid, gridLines: showGrid });
  drawPageChrome(pdf, sheet, { sideSep: sheet.SIDE_W > 0 });
}

/** Tiêu đề lớn giữa phía trên vùng map; max-width chữ ~2/3 chiều rộng khung */
function mapBannerHtml(frame, title, cs) {
  if (!showMapBanner || !title) return '';
  const pad = 14 * (cs || 1);
  return `<div class="pa3-map-banner" style="left:${frame.x}px; top:${frame.y + pad}px; width:${frame.w}px">
      <b>${escapeHtml(title)}</b>
    </div>`;
}

function drawMapCornerLabel(pdf, framePx, text, sheet) {
  const F = toMm(framePx);
  const cs = sheet.cs || 1;
  const u = cs * PX_MM;
  setFont(pdf, true, 11 * cs);
  const padX = 4 * u;
  const padY = 2.2 * u;
  const tw = pdf.getTextWidth(cleanText(text));
  const boxW = tw + padX * 2;
  const boxH = 11 * u + padY;
  const x = F.x + 4 * u;
  const y = F.y + 4 * u;
  pdf.setFillColor(15, 23, 42);
  setAlpha(pdf, 0.82, 1);
  pdf.roundedRect(x, y, boxW, boxH, 1.2 * u, 1.2 * u, 'F');
  pdf.setTextColor(255, 255, 255);
  setAlpha(pdf, 1, 1);
  pdf.text(cleanText(text), x + padX, y + boxH / 2, { baseline: 'middle' });
  pdf.setTextColor(...INK);
}

// ================== CHÚ GIẢI ==================
/** Ký hiệu đất theo cấp quy hoạch đang chọn ở danh sách cấp (mapLevel.js); cấp hệ thống đô thị dùng chú giải phân loại đô thị */
function levelLegendRows(s) {
  const lv = getLevel();
  const chk = $(levelChk(lv));
  if (chk && !chk.checked) return [];
  const label = LEVELS.find(l => l.id === lv)?.label || '';
  if (lv === 'urban') {
    const items = [...document.querySelectorAll('#urbanLegend .ua-legend-item')];
    if (!items.length) return [];
    return ['<div class="pa3-lg-head">Phân loại đô thị</div>', ...items.map(it => `<div class="pa3-lg-row pa3-lg-ua">${it.innerHTML}</div>`)];
  }
  const set = LEGEND_SETS[LEVEL_SET[lv]];
  if (!set || !set.groups.length) return [];
  const row = (style, text) => `<div class="pa3-lg-row"><i class="pa3-lg-sym pa3-lg-land" style="${style}"></i>${escapeHtml(text)}</div>`;
  const out = [`<div class="pa3-lg-head">Sử dụng đất – ${escapeHtml(label)}</div>`];
  set.groups.forEach(([name, keys]) => {
    out.push(`<div class="pa3-lg-group">${escapeHtml(name)}</div>`);
    keys.forEach(key => {
      if (typeof key === 'object') {
        out.push(row(`background:${key.color};border-color:${key.color}`, key.label));
        return;
      }
      const st = TT16_STYLES[key];
      const c = st && parseColor(st.color);
      if (!c) return;
      out.push(row(`background-color:rgba(${c.r},${c.g},${c.b},0.35);${tt16SwatchCss(key, 0.6 * s)}border-color:${st.color}`, st.label));
    });
  });
  return out;
}

function legendRows(s) {
  const rows = [];
  const infra = INFRA_LEGEND.filter(([id]) => checked(id));
  infra.forEach(([id, file]) => {
    const text = ($(id)?.labels?.[0]?.textContent || '').trim().replace(/^\d+\.\s*/, '');
    rows.push(`<div class="pa3-lg-row"><img class="pa3-lg-icon" src="./icons/${file}" alt="">${escapeHtml(text)}</div>`);
  });
  if (infra.length) {
    rows.push('<div class="pa3-lg-row"><img class="pa3-lg-icon" src="./icons/Park2.png" alt="">Công trình chờ duyệt (đề xuất)</div>');
  }
  if (document.querySelector('.btn-dot-buffer[aria-pressed="true"]')) {
    rows.push('<div class="pa3-lg-row"><i class="pa3-lg-sym pa3-lg-buffer"></i>Vùng phủ / bán kính phục vụ</div>');
  }
  if (state.selectedWard && state.selectedWard !== CITY_NAME) {
    rows.push(`<div class="pa3-lg-row"><i class="pa3-lg-sym pa3-lg-ward"></i>Phạm vi ${escapeHtml(state.selectedWard)}</div>`);
  }
  if (checked('chk_bound')) rows.push('<div class="pa3-lg-row"><i class="pa3-lg-sym pa3-lg-bound"></i>Ranh giới phường, xã</div>');
  if (checked('chk_roads')) {
    [['#fb923c', 3, 'Đường trục chính'], ['#60a5fa', 2, 'Đường khu vực'], ['#cbd5e1', 2, 'Đường nội bộ, kiệt']].forEach(([c, w, t]) => {
      rows.push(`<div class="pa3-lg-row"><i class="pa3-lg-sym pa3-lg-line" style="--c:${c}; --w:${(w * s).toFixed(2)}px"></i>${t}</div>`);
    });
    rows.push(`<div class="pa3-lg-row"><i class="pa3-lg-sym pa3-lg-line pa3-lg-dash" style="--c:#4ade80; --w:${(2 * s).toFixed(2)}px"></i>Đường xe đạp</div>`);
  }
  if (checked('chk_osmRail')) {
    rows.push(`<div class="pa3-lg-row"><i class="pa3-lg-sym pa3-lg-line" style="--c:#1e293b; --w:${(3 * s).toFixed(2)}px"></i>Đường sắt hiện trạng</div>`);
  }
  const ramps = [];
  if (checked('chk_heat')) {
    ramps.push(`<div class="pa3-lg-ramp"><div class="pa3-lg-ramp-title">Độ phủ hạ tầng (số nhóm tiếp cận được)</div>
      <div class="pa3-lg-bar pa3-lg-heat"></div><div class="pa3-lg-ticks">${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<span>${n}</span>`).join('')}</div></div>`);
  }
  if (checked('chk_pop')) {
    const nha = popMethod() !== 'old' && popLayerMeta.popSource !== 'pixel';
    const title = nha ? 'Phân bổ dân cư theo nhà ở (người / ô 30 m)' : 'Phân bổ dân cư pixel cũ (so sánh)';
    const ticks = nha ? [0, 5, 10, 15, 20, '≥30'] : [0, 1, 2, 3, 4, '≥5'];
    ramps.push(`<div class="pa3-lg-ramp"><div class="pa3-lg-ramp-title">${title}</div>
      <div class="pa3-lg-bar pa3-lg-pop"></div><div class="pa3-lg-ticks">${ticks.map(n => `<span>${n}</span>`).join('')}</div></div>`);
  }
  const level = levelLegendRows(s);
  const rest = rows.join('') + ramps.join('') + satPrintLegend();
  if (!level.length) return rest;
  return level.join('') + (rest ? `<div class="pa3-lg-head">Hạ tầng và lớp chuyên đề</div>${rest}` : '');
}

/** Thu cỡ chữ chú giải đến khi vừa khung; ưu tiên nhiều cột để chừa chỗ ô ghi chú */
function fitLegend(page, dual = false) {
  const box = page.querySelector('.pa3-legend');
  const lg = page.querySelector('.pa3-lg');
  if (!box || !lg) return;
  const fits = () => box.scrollHeight <= box.clientHeight + 1;
  if (fits()) return;
  const plans = dual
    ? [[5, 0.55], [6, 0.5], [4, 0.55], [3, 0.5]]
    : [[3, 0.7], [2, 0.75], [4, 0.55]];
  for (const [cols, min] of plans) {
    lg.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    for (let f = dual ? 0.95 : 1.05; f >= min - 1e-6; f -= 0.05) {
      lg.style.fontSize = `${f.toFixed(2)}em`;
      if (fits()) return;
    }
  }
}

// ================== DỰNG TRANG IN ==================
const NORTH_SVG = '<svg class="pa3-north-svg" viewBox="0 0 40 60" aria-hidden="true">'
  + '<polygon points="20,4 32,48 20,40" fill="#111"/><polygon points="20,4 8,48 20,40" fill="#fff" stroke="#111" stroke-width="1.5"/>'
  + '<text x="20" y="59" text-anchor="middle" font-size="12" font-weight="700" fill="#111">B</text></svg>';

function scaleInfo(rect, frameW) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const a = latLngAt(cx - 50, cy);
  const b = latLngAt(cx + 50, cy);
  const mPerMapPx = distanceMeters(a.lat, a.lng, b.lat, b.lng) / 100;
  const mPerFramePx = mPerMapPx * rect.w / frameW;
  const ratio = mPerFramePx / (25.4 / DPI / 1000);
  if (!Number.isFinite(ratio) || ratio <= 0) return { ratio: 1, mPerFramePx: mPerFramePx || 1 };
  const mag = Math.pow(10, Math.floor(Math.log10(ratio)) - 1);
  return { ratio: Math.round(ratio / mag) * mag, mPerFramePx };
}

function scaleBarHtml(lenM, px) {
  const fmt = (m) => (lenM >= 1000 ? `${(m / 1000).toLocaleString('vi-VN')}` : `${Math.round(m)}`);
  const unit = lenM >= 1000 ? 'km' : 'm';
  const seg = [0, 1, 2, 3].map(i => `<i class="${i % 2 ? 'w' : 'b'}"></i>`).join('');
  return `<div class="pa3-scalebar" style="width:${px.toFixed(1)}px">${seg}</div>
    <div class="pa3-scalebar-lbl" style="width:${px.toFixed(1)}px"><span>0</span><span>${fmt(lenM / 2)}</span><span>${fmt(lenM)} ${unit}</span></div>`;
}

function printMetaHtml(sheet, gridStep, date) {
  return `<div class="pa3-info">
        <div><b>Khổ:</b> ${sheet.paper.label} ngang</div>
        <div><b>TN:</b> VN-2000, KTT 107°00', múi 3° – lưới ${dotted(gridStep)} m</div>
        <div><b>Nền:</b> ${escapeHtml(basemapLabel())}</div>
        <div><b>Nguồn:</b> Hạ tầng đô thị TP. Huế (Sở XD), OSM</div>
        <div><b>Ngày:</b> ${date}</div>
      </div>`;
}

function notesBoxHtml(note) {
  const text = (note || '').trim() || DEFAULT_NOTE;
  return `<div class="pa3-notes-box">
        <div class="pa3-sec">GHI CHÚ</div>
        <div class="pa3-notes-body">${escapeHtml(text)}</div>
      </div>`;
}

function printStamp() {
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(now.getDate())}/${p2(now.getMonth() + 1)}/${now.getFullYear()} ${p2(now.getHours())}:${p2(now.getMinutes())}`;
}

/** Phần HTML của tờ in (cột thông tin, nhãn so sánh); dàn trang bằng font in rồi chép sang PDF qua drawDom */
function sideHtml({ title, place, note, gridStep, splitX, frameW, scale, sheet }) {
  const F = sheet.frame;
  const cs = sheet.cs || 1;
  const lenM = NICE_STEPS.filter(step => step / scale.mPerFramePx <= 260 * cs).pop() || NICE_STEPS[0];
  const date = printStamp();
  const sideX = sheet.pageW - sheet.M - sheet.SIDE_W;
  const pad = 12 * cs;
  const compare = splitX != null
    ? `<div class="pa3-split" style="left:${F.x + splitX * F.w / frameW}px; top:${F.y}px; height:${F.h}px"></div>
       <div class="pa3-split-lbl" style="left:${F.x + 10 * cs}px; top:${F.y + 10 * cs}px">HIỆN TRẠNG</div>
       <div class="pa3-split-lbl" style="left:${F.x + F.w - 10 * cs}px; top:${F.y + 10 * cs}px; transform:translateX(-100%)">QUY HOẠCH</div>`
    : '';
  return `<div class="pa3-page pa3-vector" style="width:${sheet.pageW}px; height:${sheet.pageH}px; font-size:${(10 * cs).toFixed(2)}px">
    ${compare}
    ${mapBannerHtml(F, title, cs)}
    <div class="pa3-side" style="left:${sideX + pad}px; top:${sheet.M + pad}px; width:${sheet.SIDE_W - 2 * pad}px; height:${sheet.pageH - 2 * sheet.M - 2 * pad}px">
      <div class="pa3-org"><div>UBND THÀNH PHỐ HUẾ</div><b>SỞ XÂY DỰNG</b><i class="pa3-org-rule"></i></div>
      <div class="pa3-title">${escapeHtml(title)}</div>
      <div class="pa3-place">${escapeHtml(place)}</div>
      <div class="pa3-scale-block">
        <div class="pa3-north">${NORTH_SVG}</div>
        <div class="pa3-scale">
          <div class="pa3-ratio">Tỷ lệ 1:${dotted(scale.ratio)}</div>
          ${scaleBarHtml(lenM, lenM / scale.mPerFramePx)}
          <div class="pa3-ratio-note">(khi in đúng khổ ${sheet.paper.label})</div>
        </div>
      </div>
      <div class="pa3-legend">
        <div class="pa3-sec">CHÚ GIẢI</div>
        <div class="pa3-lg">${legendRows(cs) || '<div class="pa3-lg-row">Không bật lớp chuyên đề nào</div>'}</div>
      </div>
      ${notesBoxHtml(note)}
      ${printMetaHtml(sheet, gridStep, date)}
    </div>
  </div>`;
}

/** Tờ dual: tiêu đề trên; dải dưới = chú giải gọn + ô ghi chú + meta */
function dualPageHtml({ title, place, note, gridStep, scale, sheet }) {
  const T = sheet.titleBand;
  const N = sheet.notesBand;
  const cs = sheet.cs || 1;
  const pad = 8 * cs;
  const lenM = NICE_STEPS.filter(step => step / scale.mPerFramePx <= 180 * cs).pop() || NICE_STEPS[0];
  const date = printStamp();
  const bannerFrame = {
    x: sheet.leftFrame.x,
    y: sheet.leftFrame.y,
    w: sheet.leftFrame.w + sheet.GUT_X + sheet.rightFrame.w,
    h: sheet.leftFrame.h
  };
  return `<div class="pa3-page pa3-vector pa3-dual" style="width:${sheet.pageW}px; height:${sheet.pageH}px; font-size:${(10 * cs).toFixed(2)}px">
    <div class="pa3-dual-title" style="left:${T.x + pad}px; top:${T.y}px; width:${T.w - 2 * pad}px; height:${T.h}px">
      <div class="pa3-org pa3-dual-org"><div>UBND THÀNH PHỐ HUẾ</div><b>SỞ XÂY DỰNG</b></div>
      <div class="pa3-title">${escapeHtml(title)}</div>
      <div class="pa3-place">${escapeHtml(place)}</div>
    </div>
    ${mapBannerHtml(bannerFrame, title, cs)}
    <div class="pa3-dual-notes" style="left:${N.x + pad}px; top:${N.y + pad * 0.4}px; width:${N.w - 2 * pad}px; height:${N.h - pad * 0.8}px">
      <div class="pa3-legend">
        <div class="pa3-sec">CHÚ GIẢI</div>
        <div class="pa3-lg">${legendRows(cs) || '<div class="pa3-lg-row">Không bật lớp chuyên đề nào</div>'}</div>
      </div>
      <div class="pa3-dual-meta">
        <div class="pa3-scale-block pa3-dual-scale">
          <div class="pa3-north">${NORTH_SVG}</div>
          <div class="pa3-scale">
            <div class="pa3-ratio">Tỷ lệ 1:${dotted(scale.ratio)}</div>
            ${scaleBarHtml(lenM, lenM / scale.mPerFramePx)}
            <div class="pa3-ratio-note">(khi in đúng khổ ${sheet.paper.label})</div>
          </div>
        </div>
        ${notesBoxHtml(note)}
        ${printMetaHtml(sheet, gridStep, date)}
      </div>
    </div>
  </div>`;
}

function plainPageHtml({ title, sheet }) {
  const F = sheet.frame;
  const cs = sheet.cs || 1;
  return `<div class="pa3-page pa3-vector" style="width:${sheet.pageW}px; height:${sheet.pageH}px; font-size:${(12 * cs).toFixed(2)}px">
    ${mapBannerHtml(F, title, cs)}
  </div>`;
}

function pageHtml(kind, pack) {
  if (kind === 'plain') return plainPageHtml(pack);
  return sideHtml(pack);
}

function placeRaster(pdf, canvas, type, F) {
  const data = type === 'JPEG' ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png');
  pdf.addImage(data, type, F.x, F.y, F.w, F.h, undefined, 'FAST');
}

function rasterScale(size, targetW, maxPixels) {
  return Math.max(0.5, Math.min(2, Math.max(1, targetW / size.x), Math.sqrt(maxPixels / (size.x * size.y))));
}

// ================== KHUNG XEM TRƯỚC ==================
function frameBox(frameEl, hostEl) {
  if (!frameEl || !hostEl || frameEl.hidden) return null;
  const fr = frameEl.getBoundingClientRect();
  const hr = hostEl.getBoundingClientRect();
  if (fr.width < 20 || fr.height < 20) return null;
  return { x: fr.left - hr.left, y: fr.top - hr.top, w: fr.width, h: fr.height };
}

function frameRectAgainst(el) {
  return frameBox($('printFrame'), el);
}

function syncLayoutFromView() {
  const dual = dualLayout();
  const right = $('printFrameRight');
  const tag = $('printFrameTag');
  if (right) right.hidden = !dual;
  if (tag) tag.textContent = dual ? 'Hiện trạng' : 'Vùng in';
  const live = $('printLayoutLive');
  if (live) {
    if (dual) live.textContent = 'Bố cục: Hai ô so sánh';
    else {
      const a = previewAspect();
      live.textContent = `Bố cục: ${FRAME_LABEL[frameKind] || FRAME_LABEL.side} · khung ${a.toFixed(2)}:1`;
    }
  }
}

/** Khung mặc định co theo khổ: A3 đầy chỗ trống; A0/4A0 nhỏ hơn để phóng đúng tỷ lệ in và thấy hoa văn TT16 */
function paperFrameScale() {
  const paper = PAPERS.find(p => p.id === paperId) || PAPERS[0];
  const a3 = PAPERS.find(p => p.id === 'a3') || PAPERS[0];
  return Math.min(1, a3.wMm / paper.wMm);
}

function placeFrame() {
  if (!previewOn || busy) return;
  const area = $('mapArea');
  const frame = $('printFrame');
  const right = $('printFrameRight');
  const dock = document.querySelector('.print-dock');
  if (!area || !frame) return;
  syncLayoutFromView();
  const areaRect = area.getBoundingClientRect();
  const panel = $('rightPanel');
  let padR = 16;
  if (dock) {
    const dr = dock.getBoundingClientRect();
    if (dr.width > 40 && dr.left < areaRect.right) padR = Math.max(padR, areaRect.right - dr.left + 12);
  }
  if (panel && !document.body.classList.contains('right-collapsed')) {
    const pr = panel.getBoundingClientRect();
    if (pr.width > 20 && pr.left < areaRect.right) padR = Math.max(padR, areaRect.right - pr.left + 10);
  }
  const padT = 72;
  const padL = 64;
  if (document.body.classList.contains('bottom-collapsed')) padR = Math.max(padR, 72);
  const padB = 20;
  if (dock) {
    dock.style.left = '';
    dock.style.width = '';
    dock.style.right = '';
    dock.style.transform = '';
  }
  const paperScale = paperFrameScale();
  const availH = Math.max(120, area.clientHeight - padT - padB);
  const setBox = (el, x, y, w, h) => {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
  };
  if (dualLayout() && right) {
    const divider = $('swipeDivider');
    const splitX = divider
      ? divider.getBoundingClientRect().left - areaRect.left
      : area.clientWidth / 2;
    const gap = 14;
    const leftW = Math.max(80, splitX - padL - gap);
    const rightX = splitX + gap;
    const rightW = Math.max(80, area.clientWidth - padR - rightX);
    const aspect = previewAspect();
    const maxW = Math.min(leftW, rightW);
    const defW = Math.max(160, maxW * paperScale);
    let w = frameUser ? frameUser.w : defW;
    let h = w / aspect;
    if (h > availH) { h = availH; w = h * aspect; }
    if (w > maxW) { w = maxW; h = w / aspect; }
    const top = frameUser
      ? Math.min(Math.max(padT, frameUser.y), padT + Math.max(0, availH - h))
      : padT + Math.max(0, (availH - h) / 2);
    setBox(frame, padL + (leftW - w) / 2, top, w, h);
    setBox(right, rightX + (rightW - w) / 2, top, w, h);
  } else {
    const availW = Math.max(120, area.clientWidth - padL - padR);
    const aspect = previewAspect();
    const defW = Math.max(160, Math.min(availW, availW * paperScale));
    let w = frameUser ? frameUser.w : defW;
    let h = w / aspect;
    if (h > availH) { h = availH; w = h * aspect; }
    if (w > availW) { w = availW; h = w / aspect; }
    const minW = Math.min(160, availW);
    if (w < minW) { w = minW; h = w / aspect; }
    const x = frameUser
      ? Math.min(Math.max(padL, frameUser.x), padL + Math.max(0, availW - w))
      : padL + (availW - w) / 2;
    const y = frameUser
      ? Math.min(Math.max(padT, frameUser.y), padT + Math.max(0, availH - h))
      : padT + Math.max(0, (availH - h) / 2);
    if (frameUser) frameUser = { x, y, w, h };
    setBox(frame, x, y, w, h);
  }
  updateLiveScale();
}

function updateLiveScale() {
  const el = $('printScaleLive');
  const host = viewMap()?.getContainer();
  if (!el || !previewOn || !host) return;
  const rect = frameRectAgainst(host);
  if (!rect || rect.w < 20) return;
  const sheet = activeSheet();
  const scale = scaleInfo(rect, sheet.frame.w);
  const z = viewMap()?.getZoom?.() ?? 0;
  const needZoom = scale.ratio <= 5000 && !tt16Detailed(z);
  el.textContent = needZoom
    ? `In ${sheet.paper.label} ≈ 1:${dotted(scale.ratio)} · phóng gần hơn để thấy hoa văn`
    : `In ${sheet.paper.label} ≈ 1:${dotted(scale.ratio)}`;
}

function setPaper(id) {
  if (!PAPERS.some(p => p.id === id)) return;
  paperId = id;
  frameUser = null;
  document.querySelectorAll('.print-sizes button[data-paper]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.paper === id));
  });
  if (previewOn) placeFrame();
  else updateLiveScale();
}

function setFrameKind(id) {
  const kind = FRAME_LABEL[id] ? id : 'side';
  frameKind = kind;
  frameUser = null;
  document.querySelectorAll('.print-frames button').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.frame === kind));
  });
  if (previewOn) placeFrame();
}

function bindFrameResize() {
  document.querySelectorAll('#printPreview .print-corner').forEach(corner => {
    if (corner.dataset.bound) return;
    corner.dataset.bound = '1';
    corner.addEventListener('pointerdown', (ev) => {
      if (!previewOn || busy || ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const area = $('mapArea');
      const frame = corner.closest('.print-frame');
      const left = $('printFrame');
      if (!area || !frame || !left) return;
      const areaRect = area.getBoundingClientRect();
      const start = frame.getBoundingClientRect();
      const id = corner.dataset.corner || 'br';
      const anchorX = id.includes('l') ? start.right - areaRect.left : start.left - areaRect.left;
      const anchorY = id.includes('t') ? start.bottom - areaRect.top : start.top - areaRect.top;
      const aspect = previewAspect();
      const move = (e) => {
        const px = e.clientX - areaRect.left;
        const py = e.clientY - areaRect.top;
        let w = Math.max(1, Math.abs(px - anchorX));
        const hPtr = Math.max(1, Math.abs(py - anchorY));
        if (hPtr * aspect > w) w = hPtr * aspect;
        let h = w / aspect;
        const maxW = area.clientWidth - 80;
        const maxH = area.clientHeight - 80;
        if (w > maxW) { w = maxW; h = w / aspect; }
        if (h > maxH) { h = maxH; w = h * aspect; }
        if (w < 140) return;
        const leftBox = left.getBoundingClientRect();
        const x = frame === left
          ? (id.includes('l') ? anchorX - w : anchorX)
          : leftBox.left - areaRect.left;
        const y = id.includes('t') ? anchorY - h : anchorY;
        frameUser = { x, y, w, h };
        placeFrame();
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  });
}

function onPreviewKey(e) {
  if (e.key !== 'Escape' || !previewOn || busy) return;
  e.preventDefault();
  e.stopPropagation();
  closePreview();
}

function onMapView() {
  if (!previewOn || busy) return;
  updateLiveScale();
}

function syncPrintOptsFromDock() {
  const grid = $('printShowGrid');
  const banner = $('printMapBanner');
  if (grid) showGrid = !!grid.checked;
  if (banner) showMapBanner = !!banner.checked;
}

function bindDock() {
  if (dockBound) return;
  dockBound = true;
  document.querySelector('.print-sizes')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-paper]');
    if (btn) setPaper(btn.dataset.paper);
  });
  document.querySelector('.print-frames')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-frame]');
    if (btn) setFrameKind(btn.dataset.frame);
  });
  $('printShowGrid')?.addEventListener('change', syncPrintOptsFromDock);
  $('printMapBanner')?.addEventListener('change', syncPrintOptsFromDock);
  bindFrameResize();
  $('printCancel')?.addEventListener('click', closePreview);
  $('printGo')?.addEventListener('click', runExport);
  $('printTitle')?.addEventListener('input', (e) => { e.target.dataset.touched = '1'; });
}

function openPreview() {
  if (!map || previewOn || busy) return;
  const root = $('printPreview');
  if (!root) return;
  previewOn = true;
  root.hidden = false;
  announceFloat('print');
  const btn = $('btnPrintA3');
  btn?.classList.add('active');
  btn?.setAttribute('aria-pressed', 'true');
  const input = $('printTitle');
  if (input && input.dataset.touched !== '1') input.value = defaultTitle();
  bindDock();
  const gridChk = $('printShowGrid');
  const bannerChk = $('printMapBanner');
  if (gridChk) gridChk.checked = showGrid;
  if (bannerChk) bannerChk.checked = showMapBanner;
  syncPrintOptsFromDock();
  frameUser = null;
  setPaper(paperId);
  setFrameKind(frameKind);
  map.on('move zoom resize', onMapView);
  document.addEventListener('keydown', onPreviewKey, true);
  frameObserver = new ResizeObserver(() => placeFrame());
  frameObserver.observe($('mapArea'));
  const panel = $('rightPanel');
  if (panel) frameObserver.observe(panel);
  classObserver = new MutationObserver(() => placeFrame());
  classObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  placeFrame();
}

function closePreview() {
  if (!previewOn) return;
  previewOn = false;
  const root = $('printPreview');
  if (root) {
    root.hidden = true;
    root.classList.remove('print-capturing');
  }
  const btn = $('btnPrintA3');
  btn?.classList.remove('active');
  btn?.setAttribute('aria-pressed', 'false');
  map?.off('move zoom resize', onMapView);
  document.removeEventListener('keydown', onPreviewKey, true);
  frameObserver?.disconnect();
  frameObserver = null;
  classObserver?.disconnect();
  classObserver = null;
}

/** Nét SVG phác thảo / đo vẽ sau ảnh icon: chữ phác thảo là marker, nằm trong ảnh đó */
function paintVectors(pdf, m, full, F, groups, opts) {
  if (!groups.length) return;
  withClip(pdf, F, () => drawMapPaths(pdf, m, full, F, groups, opts));
}

/** Canvas renderer Leaflet (tô đất / hoa văn TT16) — chụp vào PDF vì jsPDF không vẽ CanvasPattern */
function leafletPathCanvases(m) {
  const seen = new Set();
  const out = [];
  m?.eachLayer(l => {
    if (!(l instanceof L.Path)) return;
    const c = l._renderer?._container;
    if (!c || c.tagName !== 'CANVAS' || seen.has(c)) return;
    seen.add(c);
    const pane = c.closest?.('.leaflet-pane');
    const z = pane ? (parseInt(getComputedStyle(pane).zIndex, 10) || 0) : 0;
    out.push({ canvas: c, z });
  });
  return out.sort((a, b) => a.z - b.z);
}

function placePathCanvases(pdf, m, frameMm, rect) {
  const host = m.getContainer();
  const hr = host.getBoundingClientRect();
  leafletPathCanvases(m).forEach(({ canvas }) => {
    if (!canvas.width || !canvas.height) return;
    try {
      const cr = canvas.getBoundingClientRect();
      const sx = canvas.width / Math.max(1, cr.width);
      const sy = canvas.height / Math.max(1, cr.height);
      const x = Math.max(0, Math.round((hr.left + rect.x - cr.left) * sx));
      const y = Math.max(0, Math.round((hr.top + rect.y - cr.top) * sy));
      const w = Math.max(1, Math.min(Math.round(rect.w * sx), canvas.width - x));
      const h = Math.max(1, Math.min(Math.round(rect.h * sy), canvas.height - y));
      if (w < 2 || h < 2) return;
      const slice = document.createElement('canvas');
      slice.width = w;
      slice.height = h;
      slice.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
      pdf.addImage(slice.toDataURL('image/png'), 'PNG', frameMm.x, frameMm.y, frameMm.w, frameMm.h, undefined, 'FAST');
    } catch (e) { /* canvas khác nguồn */ }
  });
}

/** Vẽ một ô bản đồ (nền + hoa văn canvas + vector + icon) vào framePx */
async function paintMapCell(pdf, m, full, framePx, targetW) {
  const F = toMm(framePx);
  const size = m.getSize();
  const groups = captureVectorGroups(m);
  const hatch = tt16Detailed(m.getZoom());
  const base = await captureOneMap(m, rasterScale(size, targetW, BASE_MAX_PIXELS), 'base');
  placeRaster(pdf, base, 'JPEG', F);
  if (hatch) placePathCanvases(pdf, m, F, full);
  paintVectors(pdf, m, full, F, groups.filter(g => !g.overlay), { patternFromRaster: hatch });
  if (hasTopIcons([m])) {
    const top = await captureOneMap(m, rasterScale(size, targetW, TOP_MAX_PIXELS), 'top');
    placeRaster(pdf, top, 'PNG', F);
  }
  paintVectors(pdf, m, full, F, groups.filter(g => g.overlay), { patternFromRaster: hatch });
}

/**
 * Dual: khung trái = hiện trạng, khung phải = quy hoạch (đúng vùng đang thấy trong từng ô).
 * Chụp lần lượt vì syncMaps kéo bản đồ kia theo; tâm từng ô tính trước khi phóng khung.
 */
async function drawMapFrameDual(pdf, sheet) {
  const leftRect = frameBox($('printFrame'), map.getContainer());
  const rightRect = frameBox($('printFrameRight'), planMap.getContainer());
  if (!leftRect || !rightRect) throw new Error('Thiếu khung in hai ô');
  const leftCenter = map.containerPointToLatLng([leftRect.x + leftRect.w / 2, leftRect.y + leftRect.h / 2]);
  const rightCenter = planMap.containerPointToLatLng([rightRect.x + rightRect.w / 2, rightRect.y + rightRect.h / 2]);
  const zoom0 = map.getZoom();
  const targetW = toMm(sheet.leftFrame).w / 25.4 * RASTER_DPI;
  const want = targetW / leftRect.w;
  const cap = STAGE_MAX_PX / Math.max(leftRect.w, leftRect.h);
  const k = Math.min(Math.max(1, want), cap, STAGE_MAX_GAIN);
  const zoom1 = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), zoom0 + Math.log2(k)));
  const used = 2 ** (zoom1 - zoom0);
  const W = Math.max(2, Math.round(leftRect.w * used));
  const H = Math.max(2, Math.round(leftRect.h * used));
  const area = $('mapArea');
  const saved = { c: map.getCenter(), z: map.getZoom() };
  area.style.setProperty('--print-w', `${W}px`);
  area.style.setProperty('--print-h', `${H}px`);
  area.classList.add('print-staging');
  void area.offsetWidth;
  try {
    map.invalidateSize({ pan: false });
    planMap.invalidateSize({ pan: false });
    setViewExact(map, leftCenter, zoom1);
    await waitTiles([map]);
    const full = { x: 0, y: 0, w: map.getSize().x, h: map.getSize().y };
    await paintMapCell(pdf, map, full, sheet.leftFrame, targetW);
    drawFrameGrid(pdf, computeGrid(full, map), sheet.leftFrame, sheet, {
      ticks: false, gridLines: showGrid
    });

    setViewExact(planMap, rightCenter, zoom1);
    await waitTiles([planMap]);
    const fullR = { x: 0, y: 0, w: planMap.getSize().x, h: planMap.getSize().y };
    await paintMapCell(pdf, planMap, fullR, sheet.rightFrame, targetW);
    drawFrameGrid(pdf, computeGrid(fullR, planMap), sheet.rightFrame, sheet, {
      ticks: false, gridLines: showGrid
    });
    drawMapCornerLabel(pdf, sheet.leftFrame, 'HIỆN TRẠNG', sheet);
    drawMapCornerLabel(pdf, sheet.rightFrame, 'QUY HOẠCH', sheet);
    drawPageChrome(pdf, sheet, { sideSep: false });
    return { grid: computeGrid(full, map) };
  } finally {
    area.classList.remove('print-staging');
    area.style.removeProperty('--print-w');
    area.style.removeProperty('--print-h');
    void area.offsetWidth;
    map.invalidateSize({ pan: false });
    planMap.invalidateSize({ pan: false });
    setViewExact(map, saved.c, saved.z);
    alignPlanView();
  }
}

/** Vùng bản đồ trong khung in → nền + hoa văn canvas + vector; trả về { grid, splitRel } */
async function drawMapFrame(pdf, rect, sheet) {
  const F = toMm(sheet.frame);
  const targetW = F.w / 25.4 * RASTER_DPI;
  const staged = await stageFrame(rect, targetW);
  try {
    const size = staged.size;
    const full = { x: 0, y: 0, w: size.x, h: size.y };
    const groups = captureVectorGroups(staged.map);
    const hatch = tt16Detailed(staged.map.getZoom());
    const base = await captureMapCanvas(rasterScale(size, targetW, BASE_MAX_PIXELS), 'base');
    placeRaster(pdf, base.canvas, 'JPEG', F);
    if (hatch) placePathCanvases(pdf, staged.map, F, full);
    paintVectors(pdf, staged.map, full, F, groups.filter(g => !g.overlay), { patternFromRaster: hatch });
    if (hasTopIcons([staged.map])) {
      const top = await captureMapCanvas(rasterScale(size, targetW, TOP_MAX_PIXELS), 'top');
      placeRaster(pdf, top.canvas, 'PNG', F);
    }
    paintVectors(pdf, staged.map, full, F, groups.filter(g => g.overlay), { patternFromRaster: hatch });
    return { grid: computeGrid(full), splitRel: null };
  } finally {
    staged.restore();
  }
}

async function runExport() {
  if (!map || busy || !previewOn) return;
  const dual = dualLayout();
  const sheet = dual ? sheetOfDual(paperId) : sheetOf(paperId);
  const host = viewMap().getContainer();
  const rect = frameRectAgainst(host);
  if (!rect || rect.w < 40 || rect.h < 40) return;
  syncPrintOptsFromDock();
  const input = $('printTitle');
  const title = input?.value.trim() || defaultTitle();
  const note = $('printNote')?.value.trim() || '';
  const city = !state.selectedWard || state.selectedWard === CITY_NAME;
  const place = city ? 'THÀNH PHỐ HUẾ' : state.selectedWard.toUpperCase();
  busy = true;
  const go = $('printGo');
  if (go) go.disabled = true;
  $('printPreview')?.classList.add('print-capturing');
  let holder = null;
  try {
    showToast(`⏳ Đang dựng bản đồ ${sheet.paper.label}${dual ? ' (hai ô so sánh)' : ''}...`);
    const [fonts] = await Promise.all([loadPrintFonts(), loadJsPdf(), loadHtml2Canvas()]);
    // Ép hoa văn TT16 trước khi phóng khung: khổ lớn + khung màn hình thường dưới zoom 17
    setPrintTt16Detail(true);
    await sleep(80);
    const seen = scaleInfo(rect, sheet.frame.w);
    const pdf = createPdf(sheet.paper, fonts);
    let grid;
    if (dual) {
      ({ grid } = await drawMapFrameDual(pdf, sheet));
    } else {
      ({ grid } = await drawMapFrame(pdf, rect, sheet));
      drawGridPdf(pdf, grid, sheet);
    }

    holder = document.createElement('div');
    holder.className = 'pa3-holder';
    const pack = { title, place, note, gridStep: grid.step, splitX: null, frameW: rect.w, scale: seen, sheet };
    holder.innerHTML = dual ? dualPageHtml(pack) : pageHtml(frameKind, pack);
    document.body.appendChild(holder);
    const page = holder.firstElementChild;
    await document.fonts.ready;
    fitLegend(page, dual);
    await drawDom(pdf, page, page);

    const stamp = new Date().toISOString().slice(0, 10);
    const kind = dual ? 'So-sanh' : (city ? 'TP-Hue' : state.selectedWard);
    pdf.setProperties({ title: cleanText(title), subject: cleanText(place), creator: 'Bản đồ hạ tầng TP. Huế' });
    pdf.save(`Ban-do-${sheet.paper.label}-${String(kind).replace(/\s+/g, '-')}-${stamp}.pdf`);
    showToast(`✓ Đã xuất bản đồ khổ ${sheet.paper.label} (PDF)`, 'success');
    closePreview();
  } catch (err) {
    console.error('In bản đồ lỗi:', err);
    showToast(`❌ Không xuất được bản đồ ${sheet.paper.label}: ${err.message || err}`, 'error');
  } finally {
    setPrintTt16Detail(false);
    holder?.remove();
    busy = false;
    if (go) go.disabled = false;
    $('printPreview')?.classList.remove('print-capturing');
    if (previewOn) placeFrame();
  }
}

/** Mở khung xem trước để căn vùng in, rồi xuất PDF khổ A3 → 4A0 */
document.addEventListener(FLOAT_OPEN_EVENT, (e) => { if (e.detail !== 'print') closePreview(); });

export function exportMapA3() {
  if (!map || busy) return;
  if (previewOn) closePreview();
  else openPreview();
}
