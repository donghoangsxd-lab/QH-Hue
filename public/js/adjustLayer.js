// Hồ sơ điều chỉnh cục bộ trên bản đồ quy hoạch (bản đồ chính và khung so sánh): ranh vàng nét đứt, nền sọc vàng nghiêng 45°.
// Nhịp nét lệch nửa chu kỳ với ranh khu vực QHCT (qhctLayer.js): khu vực vừa có QHCT vừa điều chỉnh hiện xen kẽ vàng / đỏ.
// Rê chuột sáng viền; bấm mở popup để thể hiện theo điều chỉnh (lớp che trắng giấu quy hoạch cũ trong ranh, tắt được;
// lô mới kẻ hoa văn TT16 theo loại đất), xem PDF scan
// hoặc bật ảnh tờ bản vẽ scan đã định vị (scanGeoref.js), thanh nhỏ ở góc ảnh chỉnh độ trong suốt và tắt ảnh.
// Admin ghi thẳng; hồ sơ người dùng nằm trong hàng chờ (khung Thẩm định › Điều chỉnh) tới khi Admin duyệt.
// Trong panel, hồ sơ đã duyệt là lớp phụ «Điều chỉnh cục bộ» của đồ án (projectLayer.js): ẩn theo đồ án / cấp và theo ô lớp.
import { state } from './state.js';
import { map } from './mapEngine.js';
import { planMap, passToolClick, isCompareOn } from './planMap.js';
import { isLayerHidden, projectShown } from './projectFiles.js';
import { geeApi } from './api.js';
import { escapeHtml, fmtNum, ico, showToast } from './utils.js';
import { ScanOverlay, cornersOf, openGeoref, prepareScan, scanProblem } from './scanGeoref.js';
import { tt16SymbolStyle, landPatternKey, TT16_STYLES, TT16_PATTERN_ZOOM, LOT_OPACITY_EVENT } from './tt16Symbols.js';

const YELLOW = '#f5c400';
// Trên viền sáng ranh đồ án (445), dưới tem đường (450): nền che + lô mới ở 446, ảnh scan ở 447, ranh ở 448
const FILL_PANE = 'adjustFillPane';
const SCAN_PANE = 'adjustScanPane';
const LINE_PANE = 'adjustLinePane';
const FILL_Z = 446;
const SCAN_Z = 447;
const LINE_Z = 448;
const SCAN_TRANSPARENCY = 30;
const LINE_STYLE = { color: YELLOW, weight: 2, opacity: 1, dashArray: '3 3', dashOffset: '3', lineCap: 'butt' };
const HOVER_STYLE = { color: '#fff1a8', weight: 4 };
export const ADJUST_PDF_MAX_BYTES = 2 * 1024 * 1024;
// Khóa lớp trong state.hiddenProjectLayers ("<Ten_QH>|dieu-chinh"), cùng cách lưu với PROJECT_LAYERS
export const ADJUST_LAYER_KEY = 'dieu-chinh';
export const ADJUST_CHANGE_EVENT = 'qh:adjustments';

const $ = (id) => document.getElementById(id);
const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;

let items = [];
let pendingItems = [];
const details = new Map();
const active = new Set();
const wipeOff = new Set();     // hồ sơ đang thể hiện nhưng bỏ lớp che: hoa văn lô mới chồng lên quy hoạch cũ
const layers = new Map();
let viewerUrl = '';
const scanOn = new Set();
const scanAlpha = new Map();   // id → độ trong suốt 0–100
const scanUrls = new Map();    // id → { at, url, blob } ảnh hồ sơ chờ duyệt tải qua POST

function headers(admin) {
  const h = { 'Content-Type': 'application/json' };
  if (admin) h.Authorization = `Bearer ${state.authToken}`;
  return h;
}

async function readJsonResponse(res) {
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) throw new Error((data && data.message) || `HTTP ${res.status}`);
  return data;
}

function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || '').split(',')[1] || '');
    r.onerror = () => reject(new Error('Không đọc được file'));
    r.readAsDataURL(file);
  });
}

/** Kiểm tra file PDF scan trước khi gửi; trả thông báo lỗi hoặc '' */
export function pdfProblem(file) {
  if (!file) return '';
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return 'Chỉ nhận file PDF';
  if (file.size >= ADJUST_PDF_MAX_BYTES) return 'File PDF phải nhỏ hơn 2 MB';
  return '';
}

/** Gắn ảnh scan + định vị cho hồ sơ; scan.blob rỗng: chỉ cập nhật định vị (Admin ghép lại) */
export async function putScan(id, scan) {
  const body = { id, name: scan.name || '', georef: scan.georef };
  if (scan.blob) body.image = await fileBase64(scan.blob);
  const out = await readJsonResponse(await fetch(geeApi('action=putAdjustScan'), {
    method: 'POST', headers: headers(isAdmin()), body: JSON.stringify(body)
  }));
  return out.scan;
}

/**
 * Gửi hồ sơ (Admin ghi thẳng, người dùng vào hàng chờ), rồi gắn PDF và ảnh scan ở các yêu cầu sau.
 * scan: { blob, name, georef } từ prepareScan + openGeoref, không bắt buộc.
 */
export async function sendAdjustment(payload, pdfFile, scan) {
  const admin = isAdmin();
  const data = await readJsonResponse(await fetch(geeApi('action=submitAdjust'), {
    method: 'POST', headers: headers(admin), body: JSON.stringify(payload)
  }));
  let pdfError = '';
  let scanError = '';
  if (pdfFile) {
    try {
      const pdf = await fileBase64(pdfFile);
      const out = await readJsonResponse(await fetch(geeApi('action=putAdjustPdf'), {
        method: 'POST', headers: headers(admin), body: JSON.stringify({ id: data.item.id, name: pdfFile.name, pdf })
      }));
      data.item.pdf = out.pdf;
    } catch (err) {
      pdfError = err.message || 'Chưa gắn được PDF';
    }
  }
  if (scan && scan.blob && scan.georef) {
    try {
      data.item.scan = await putScan(data.item.id, scan);
    } catch (err) {
      scanError = err.message || 'Chưa gắn được ảnh scan';
    }
  }
  if (admin) await reloadAdjustments();
  return { item: data.item, approved: data.item.status === 'approved', pdfError, scanError };
}

// ============================ VẼ LÊN BẢN ĐỒ ============================

const shownMaps = () => [map, planMap].filter(Boolean);

/**
 * Lô điều chỉnh vẽ như lô quy hoạch: thu nhỏ tô màu ký hiệu TT16, từ TT16_PATTERN_ZOOM kẻ hoa văn (CanvasPattern, cần renderer canvas).
 * Hồ sơ cũ chưa lưu pattern thì dò lại từ tên layer; không nhận được loại đất thì tô nhạt màu tone.
 */
export function adjustLotStyle(lot, detailed) {
  const saved = TT16_STYLES[lot.pattern] ? lot.pattern : '';
  const guess = saved || landPatternKey(lot.layer, '') || landPatternKey(lot.srcLayer, '');
  const key = TT16_STYLES[guess] ? guess : null;
  return tt16SymbolStyle(key, key ? TT16_STYLES[key].color : lot.tone || '#94a3b8', 'QH', { scenario: 'QH', detailed });
}

// Lớp che trắng (wipeout) giấu lô quy hoạch cũ trong ranh khi thể hiện theo điều chỉnh
export const WIPEOUT_STYLE = { stroke: false, fillColor: '#ffffff', fillOpacity: 1 };

// Hồ sơ chờ duyệt Admin đang xem trước luôn hiện
const visible = (it) => it.status === 'pending' || (projectShown(it.tenQH) && !isLayerHidden(it.tenQH, ADJUST_LAYER_KEY));

/** Hồ sơ đã duyệt của 1 đồ án, mới nhất trước */
export function adjustmentsOf(tenQH) {
  return items.filter(x => x.status === 'approved' && x.tenQH === tenQH).sort((a, b) => (b.at || 0) - (a.at || 0));
}

/** Ranh + lô của các hồ sơ đã duyệt, cũ trước mới sau, để bảng đất tính cột ĐC cục bộ */
export async function adjustmentPacks(tenQH) {
  if (!items.length) await reloadAdjustments();
  const packs = [];
  for (const it of adjustmentsOf(tenQH).slice().reverse()) {
    try {
      const d = await detailOf(it);
      packs.push({ boundary: d.boundary || it.boundary, lots: Array.isArray(d.lots) ? d.lots : [], at: it.at || 0 });
    } catch (e) { /* bỏ hồ sơ không tải được */ }
  }
  return packs;
}

function hatchDefs(svg, id) {
  if (!svg || svg.querySelector(`#${id}`)) return;
  const ns = 'http://www.w3.org/2000/svg';
  let defs = svg.querySelector('defs');
  if (!defs) { defs = document.createElementNS(ns, 'defs'); svg.insertBefore(defs, svg.firstChild); }
  const p = document.createElementNS(ns, 'pattern');
  p.setAttribute('id', id);
  p.setAttribute('patternUnits', 'userSpaceOnUse');
  p.setAttribute('width', '10');
  p.setAttribute('height', '10');
  p.setAttribute('patternTransform', 'rotate(45)');
  p.innerHTML = `<rect width="10" height="10" fill="${YELLOW}" fill-opacity="0.08"/><line x1="0" y1="0" x2="0" y2="10" stroke="${YELLOW}" stroke-width="4" stroke-opacity="0.9"/>`;
  defs.appendChild(p);
}

// Ranh: SVG (nền sọc dùng pattern SVG, viền sáng bằng class). Lớp che + lô mới: canvas để kẻ hoa văn TT16 (CanvasPattern)
function layersOf(m) {
  if (layers.has(m)) return layers.get(m);
  [[FILL_PANE, FILL_Z], [SCAN_PANE, SCAN_Z], [LINE_PANE, LINE_Z]].forEach(([name, z]) => {
    if (!m.getPane(name)) m.createPane(name).style.zIndex = z;
  });
  m.getPane(SCAN_PANE).style.pointerEvents = 'none';
  m.getPane(FILL_PANE).style.pointerEvents = 'none';
  const fillR = L.canvas({ pane: FILL_PANE }).addTo(m);
  const lineR = L.svg({ pane: LINE_PANE }).addTo(m);
  const hatchId = `adjHatch${L.stamp(m)}`;
  hatchDefs(lineR._container, hatchId);
  const entry = {
    map: m, fillR, lineR, hatchId, fills: L.layerGroup().addTo(m), lines: L.layerGroup().addTo(m),
    scans: L.layerGroup().addTo(m), scanById: new Map(), detailed: null
  };
  layers.set(m, entry);
  m.on('zoomend', () => {
    const d = m.getZoom() >= TT16_PATTERN_ZOOM;
    if (d !== entry.detailed && active.size) drawOn(m);
  });
  return entry;
}

function popupHtml(it) {
  const on = active.has(it.id);
  const admin = isAdmin();
  const pending = it.status === 'pending';
  const data = `data-adj-id="${it.id}"`;
  const sw = (act, icon, text, hint, checked) => `<button type="button" class="adj-sw" role="switch" aria-checked="${checked}" data-adj-act="${act}" ${data}>
      <span class="adj-sw-ico">${ico(icon)}</span><span class="adj-sw-text">${text}<small>${hint}</small></span><span class="adj-sw-track"></span>
    </button>`;
  const tool = (act, icon, text, cls = '') => `<button type="button" class="adj-tool ${cls}" data-adj-act="${act}" ${data} title="${text}">${ico(icon)}<span>${text}</span></button>`;
  const facts = [
    ['Lô đất mới', fmtNum(it.lots || 0)],
    ['Cập nhật', escapeHtml(it.stamp || '—')],
    it.sender ? ['Người gửi', escapeHtml(it.sender)] : null,
    it.verdict ? ['Thẩm định', escapeHtml(it.verdict)] : null
  ].filter(Boolean);
  const shows = [
    on ? sw('wipe', wipeOff.has(it.id) ? 'eye' : 'eye-off', 'Che quy hoạch cũ', 'Phủ trắng lô cũ trong ranh điều chỉnh', !wipeOff.has(it.id)) : '',
    it.scan ? sw('scan', 'map', 'Bản vẽ scan', 'Ảnh tờ bản vẽ đã định vị trên bản đồ', scanOn.has(it.id)) : ''
  ].join('');
  const admins = admin ? [
    it.scan ? tool('georef', 'pin', 'Định vị lại') : '',
    tool('scanNew', 'map', it.scan ? 'Thay ảnh' : 'Ghép ảnh scan'),
    !pending ? tool('remove', 'trash', 'Xóa hồ sơ', 'is-danger') : ''
  ].join('') : '';
  return `<div class="adj-pop" data-adj-pop="${it.id}">
    <div class="adj-pop-head">
      <span class="adj-pop-badge">${ico('layers')}Điều chỉnh cục bộ</span>
      <span class="adj-pop-status ${pending ? 'is-wait' : 'is-ok'}">${pending ? 'Chờ duyệt' : 'Đã duyệt'}</span>
    </div>
    <div class="adj-pop-title">${escapeHtml(it.title || 'Hồ sơ điều chỉnh cục bộ')}</div>
    <div class="adj-pop-project">${ico('folder')}${escapeHtml(it.tenQH)}</div>
    <dl class="adj-pop-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    ${it.note ? `<p class="adj-pop-note">${escapeHtml(it.note)}</p>` : ''}
    <button type="button" class="adj-pop-main ${on ? 'is-on' : ''}" data-adj-act="toggle" ${data}>
      ${ico(on ? 'undo' : 'layers')}${on ? 'Trả lại bản đồ quy hoạch' : 'Thể hiện theo điều chỉnh'}
    </button>
    ${shows ? `<div class="adj-pop-sec"><div class="adj-pop-label">Hiển thị</div>${shows}</div>` : ''}
    <div class="adj-pop-sec">
      <div class="adj-pop-label">Tài liệu</div>
      ${it.pdf
        ? `<button type="button" class="adj-doc" data-adj-act="pdf" ${data}>${ico('file')}<span>Quyết định, bản vẽ điều chỉnh<small>${escapeHtml(it.pdf.name || 'PDF')}</small></span>${ico('chev-right')}</button>`
        : '<div class="adj-doc is-empty">' + ico('file') + '<span>Chưa kèm PDF quyết định, bản vẽ</span></div>'}
    </div>
    ${admins ? `<div class="adj-pop-admin"><div class="adj-pop-label">${ico('key')}Quản trị</div><div class="adj-tools">${admins}</div></div>` : ''}
  </div>`;
}

// Leaflet chặn click lan ra ngoài popup nên gắn bộ xử lý ngay trên nội dung
function openPopup(m, it, latlng) {
  const box = document.createElement('div');
  box.className = 'adj-pop-box';
  box.innerHTML = popupHtml(it);
  box.addEventListener('click', (e) => { e.stopPropagation(); onAction(e); });
  box._popup = L.popup({ maxWidth: 340, minWidth: 280, className: 'adj-popup', autoPanPaddingTopLeft: [40, 90] }).setLatLng(latlng).setContent(box).openOn(m);
}

// Popup đang mở vẽ lại tại chỗ sau mỗi lần bật / tắt (công tắc đổi trạng thái mà không đóng popup)
function syncPopups() {
  document.querySelectorAll('.adj-pop-box').forEach(box => {
    const id = box.querySelector('[data-adj-pop]')?.dataset.adjPop;
    const it = items.find(x => x.id === id) || pendingItems.find(x => x.id === id);
    if (!it) { box._popup?.close(); return; }
    box.innerHTML = popupHtml(it);
    box._popup?.update();
  });
}

function drawScans(L1) {
  L1.scans.clearLayers();
  L1.scanById.clear();
  if (!ScanOverlay) return;
  items.forEach(it => {
    if (!it.scan || !scanOn.has(it.id) || !visible(it)) return;
    const url = scanSrc(it);
    if (!url) return;
    const layer = new ScanOverlay(url, cornersOf(it.scan), { pane: SCAN_PANE, opacity: 1 - transparencyOf(it.id) / 100 });
    L1.scans.addLayer(layer);
    L1.scanById.set(it.id, layer);
    L1.scans.addLayer(scanChip(L1.map, it));
  });
}

// Góc ảnh nằm trên-phải nhất trên màn hình; phép chiếu bảo giác nên góc này không đổi theo zoom
function chipCorner(m, g) {
  const tl = L.latLng(g.tl), tr = L.latLng(g.tr), bl = L.latLng(g.bl);
  const br = L.latLng(tr.lat + bl.lat - tl.lat, tr.lng + bl.lng - tl.lng);
  return [tl, tr, br, bl].reduce((best, ll) => {
    const p = m.latLngToLayerPoint(ll);
    return p.x - p.y > best.score ? { ll, score: p.x - p.y } : best;
  }, { ll: tr, score: -Infinity }).ll;
}

// Thanh nhỏ ở góc ảnh scan: kéo độ trong suốt, nút tắt ảnh
function scanChip(m, it) {
  const v = transparencyOf(it.id);
  const html = `<div class="adj-scanchip" title="${escapeHtml(it.title || it.tenQH)}">
    <span class="adj-scanchip-ico">${ico('map')}</span>
    <label class="adj-scanchip-range"><span>Trong suốt</span>
      <input type="range" min="0" max="100" step="5" value="${v}" data-adj-op="${it.id}" aria-label="Độ trong suốt bản vẽ scan">
    </label>
    <output data-adj-opv="${it.id}">${v}%</output>
    <button type="button" class="adj-scanchip-x" data-adj-act="scan" data-adj-id="${it.id}" title="Tắt bản vẽ scan" aria-label="Tắt bản vẽ scan">${ico('close')}</button>
  </div>`;
  const chip = L.marker(chipCorner(m, it.scan), {
    icon: L.divIcon({ className: 'adj-scanchip-icon', html, iconSize: null, iconAnchor: [0, 0] }),
    keyboard: false, bubblingMouseEvents: false, zIndexOffset: 1000
  });
  chip.on('add', () => {
    const el = chip.getElement();
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
    el.addEventListener('input', (e) => {
      const r = e.target.closest('[data-adj-op]');
      if (r) setTransparency(r.dataset.adjOp, Number(r.value) || 0);
    });
    el.addEventListener('click', onAction);
  });
  return chip;
}

function drawOn(m) {
  const L1 = layersOf(m);
  L1.fills.clearLayers();
  L1.lines.clearLayers();
  L1.detailed = m.getZoom() >= TT16_PATTERN_ZOOM;
  drawScans(L1);
  items.forEach(it => {
    if (!it.boundary || !visible(it)) return;
    const on = active.has(it.id);
    const detail = on ? details.get(it.id)?.value : null;
    if (on && detail) {
      if (!wipeOff.has(it.id)) {
        L1.fills.addLayer(L.geoJSON(it.boundary, { renderer: L1.fillR, interactive: false, style: WIPEOUT_STYLE }));
      }
      detail.lots.forEach(lot => {
        const shape = L.geoJSON(lot.geometry, {
          renderer: L1.fillR, bubblingMouseEvents: false, style: adjustLotStyle(lot, L1.detailed)
        });
        const src = lot.srcLayer ? `<br><small>Layer DXF: ${escapeHtml(lot.srcLayer)}</small>` : '';
        shape.bindTooltip(`${escapeHtml(lot.label || lot.layer || 'Lô điều chỉnh')} · ${fmtNum(lot.area || 0)} m²${src}`, { sticky: true, className: 'dot-tip' });
        shape.on('click', (e) => { if (!passToolClick(m, e)) openPopup(m, it, e.latlng); });
        L1.fills.addLayer(shape);
      });
    }
    const line = L.geoJSON(it.boundary, {
      renderer: L1.lineR, bubblingMouseEvents: false,
      style: { ...LINE_STYLE, fill: !on, fillColor: `url(#${L1.hatchId})`, fillOpacity: 1 }
    });
    line.bindTooltip(`Điều chỉnh cục bộ · ${escapeHtml(it.tenQH)}`, { sticky: true, direction: 'top', className: 'dot-tip' });
    line.on('mouseover', () => line.eachLayer(l => { l.setStyle(HOVER_STYLE); l.getElement()?.classList.add('adj-glow'); }));
    line.on('mouseout', () => line.eachLayer(l => { l.setStyle(LINE_STYLE); l.getElement()?.classList.remove('adj-glow'); }));
    line.on('click', (e) => { if (!passToolClick(m, e)) openPopup(m, it, e.latlng); });
    L1.lines.addLayer(line);
  });
  syncFillPointer(L1);
}

// Canvas nền che phủ kín khung, nằm trên ranh đồ án. Để pointer-events auto thì vùng trống cũng nuốt click ranh.
// Chỉ bắt chuột khi đang vẽ lô điều chỉnh (bấm lô mở hồ sơ).
function syncFillPointer(L1) {
  const pane = L1.map.getPane(FILL_PANE);
  if (!pane) return;
  let capture = false;
  L1.fills.eachLayer(layer => {
    if (capture || !layer.eachLayer) return;
    layer.eachLayer(l => { if (l.options?.interactive !== false) capture = true; });
  });
  pane.style.pointerEvents = capture ? 'auto' : 'none';
  if (L1.fillR._container) L1.fillR._container.style.pointerEvents = capture ? '' : 'none';
}

export function refreshAdjustLayer() {
  if (typeof L === 'undefined') return;
  shownMaps().forEach(drawOn);
  syncPopups();
}

// ============================ ẢNH SCAN ============================

const transparencyOf = (id) => (scanAlpha.has(id) ? scanAlpha.get(id) : SCAN_TRANSPARENCY);

// Hồ sơ đã duyệt: ảnh GET công khai (trình duyệt cache theo v). Hồ sơ chờ duyệt: tải qua POST kèm token Admin
function scanSrc(it) {
  if (!it.scan) return '';
  if (it.status !== 'pending') return geeApi(`action=getAdjustScan&id=${encodeURIComponent(it.id)}&v=${it.scan.at || 0}`);
  const got = scanUrls.get(it.id);
  return got && got.at === it.scan.at ? got.url : '';
}

async function loadPendingScan(it) {
  const got = scanUrls.get(it.id);
  if (got && got.at === it.scan.at) return got.url;
  const res = await fetch(geeApi('action=getAdjustScan'), { method: 'POST', headers: headers(true), body: JSON.stringify({ id: it.id }) });
  if (!res.ok) await readJsonResponse(res);
  const blob = await res.blob();
  if (got) URL.revokeObjectURL(got.url);
  const url = URL.createObjectURL(blob);
  scanUrls.set(it.id, { at: it.scan.at, url });
  return url;
}

async function scanUrlOf(it) {
  return it.status === 'pending' ? loadPendingScan(it) : scanSrc(it);
}

async function toggleScan(id) {
  const it = items.find(x => x.id === id) || pendingItems.find(x => x.id === id);
  if (!it || !it.scan) return;
  if (scanOn.has(id)) {
    scanOn.delete(id);
    refreshAdjustLayer();
    return;
  }
  try {
    if (!items.some(x => x.id === id)) items.push(it);
    await scanUrlOf(it);
    scanOn.add(id);
    refreshAdjustLayer();
  } catch (err) {
    showToast(`Không tải được ảnh scan: ${err.message}`, 'error');
  }
}

// Bản đồ chính và khung so sánh mỗi bên một thanh ở góc ảnh: kéo bên nào cũng đồng bộ bên kia
function setTransparency(id, value) {
  scanAlpha.set(id, value);
  layers.forEach(L1 => L1.scanById.get(id)?.setOpacity(1 - value / 100));
  document.querySelectorAll(`[data-adj-opv="${id}"]`).forEach(out => { out.textContent = `${value}%`; });
  document.querySelectorAll(`input[data-adj-op="${id}"]`).forEach(r => { if (r !== document.activeElement) r.value = value; });
}

function pickImage() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.jpg,.jpeg,.png,.webp';
    input.addEventListener('change', () => resolve(input.files && input.files[0] ? input.files[0] : null));
    input.click();
  });
}

function updateScan(id, scan) {
  [items, pendingItems].forEach(list => list.forEach(x => { if (x.id === id) x.scan = scan; }));
}

/** Admin: ghép ảnh mới (newImage) hoặc định vị lại ảnh đã có */
async function georefScan(id, newImage) {
  const it = items.find(x => x.id === id) || pendingItems.find(x => x.id === id);
  if (!it || !isAdmin()) return;
  shownMaps().forEach(m => m.closePopup());
  let tempUrl = '';
  try {
    let src, w, h, blob = null, name = '';
    if (newImage || !it.scan) {
      const file = await pickImage();
      if (!file) return;
      const bad = scanProblem(file);
      if (bad) { showToast(bad, 'error'); return; }
      showToast('⏳ Đang chuẩn bị ảnh scan...');
      ({ blob, w, h } = await prepareScan(file));
      name = file.name;
      src = tempUrl = URL.createObjectURL(blob);
    } else {
      src = await scanUrlOf(it);
      ({ w, h } = it.scan);
    }
    const georef = await openGeoref({ url: src, w, h, boundary: it.boundary, title: it.title || it.tenQH, initial: blob ? null : it.scan });
    if (!georef) return;
    showToast('⏳ Đang lưu ảnh scan...');
    const scan = await putScan(id, { blob, name, georef });
    updateScan(id, scan);
    if (it.status === 'pending') await loadPendingScan({ ...it, scan });
    scanOn.add(id);
    refreshAdjustLayer();
    showToast('✓ Đã lưu bản vẽ scan đã định vị', 'success');
  } catch (err) {
    showToast(`Không ghép được ảnh scan: ${err.message}`, 'error');
  } finally {
    if (tempUrl) URL.revokeObjectURL(tempUrl);
  }
}

function detailOf(it) {
  if (!details.has(it.id)) {
    const pending = it.status === 'pending';
    const req = pending
      ? fetch(geeApi('action=getAdjustDetail'), { method: 'POST', headers: headers(true), body: JSON.stringify({ id: it.id }) })
      : fetch(geeApi(`action=getAdjustDetail&id=${encodeURIComponent(it.id)}`), { cache: 'no-store' });
    const entry = { value: null };
    entry.promise = req.then(readJsonResponse).then(d => {
      if (!Array.isArray(d.lots)) throw new Error('Hồ sơ không có lô đất');
      entry.value = d;
      return d;
    }).catch(err => { details.delete(it.id); throw err; });
    details.set(it.id, entry);
  }
  return details.get(it.id).promise;
}

async function toggle(id) {
  const it = items.find(x => x.id === id);
  if (!it) return;
  if (active.has(id)) {
    active.delete(id);
    refreshAdjustLayer();
    return;
  }
  try {
    await detailOf(it);
    active.add(id);
    refreshAdjustLayer();
  } catch (err) {
    showToast(`Không tải được lô điều chỉnh: ${err.message}`, 'error');
  }
}

/** Tải lại danh sách hồ sơ đã duyệt (giữ hồ sơ chờ Admin đang xem trước) */
export async function reloadAdjustments() {
  try {
    const data = await readJsonResponse(await fetch(geeApi('action=getAdjustments'), { cache: 'no-store' }));
    const list = Array.isArray(data.items) ? data.items : [];
    const previews = items.filter(x => x.status === 'pending' && (active.has(x.id) || scanOn.has(x.id)) && !list.some(y => y.id === x.id));
    items = [...list, ...previews];
  } catch (err) {
    console.warn('Đọc hồ sơ điều chỉnh cục bộ lỗi:', err.message);
  }
  [...active].forEach(id => { if (!items.some(x => x.id === id)) active.delete(id); });
  [...wipeOff].forEach(id => { if (!active.has(id)) wipeOff.delete(id); });
  [...scanOn].forEach(id => { if (!items.some(x => x.id === id && x.scan)) scanOn.delete(id); });
  refreshAdjustLayer();
  document.dispatchEvent(new CustomEvent(ADJUST_CHANGE_EVENT));
}

/** Phóng tới ranh hồ sơ và mở popup (danh sách hồ sơ trong thư mục đồ án) */
function locate(id) {
  const it = items.find(x => x.id === id);
  const m = isCompareOn() && planMap ? planMap : map;
  if (!it || !it.boundary || !m) return;
  const bounds = L.geoJSON(it.boundary).getBounds();
  if (!bounds.isValid()) return;
  // Đổi zoom không hoạt ảnh thì moveend phát ngay trong fitBounds: gắn trước
  m.once('moveend', () => openPopup(m, it, bounds.getCenter()));
  m.fitBounds(bounds, { maxZoom: 18, padding: [40, 40] });
}

// ============================ XEM PDF ============================

function closeViewer() {
  $('adjViewer')?.remove();
  if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = ''; }
}

// Tải PDF về blob rồi mới nhúng: chạy cả khi trang và API khác nguồn (X-Frame-Options SAMEORIGIN)
async function openPdf(id) {
  const it = items.find(x => x.id === id) || pendingItems.find(x => x.id === id);
  if (!it || !it.pdf) return;
  showToast('⏳ Đang tải PDF...');
  try {
    const pending = it.status === 'pending';
    const res = pending
      ? await fetch(geeApi('action=getAdjustPdf'), { method: 'POST', headers: headers(true), body: JSON.stringify({ id }) })
      : await fetch(geeApi(`action=getAdjustPdf&id=${encodeURIComponent(id)}`));
    if (!res.ok) await readJsonResponse(res);
    const blob = new Blob([await res.blob()], { type: 'application/pdf' });
    closeViewer();
    viewerUrl = URL.createObjectURL(blob);
    const box = document.createElement('div');
    box.id = 'adjViewer';
    box.className = 'adj-viewer';
    box.setAttribute('role', 'dialog');
    box.innerHTML = `<div class="adj-viewer-box">
      <div class="adj-viewer-head">
        <b>${escapeHtml(it.pdf.name || 'Quyết định điều chỉnh.pdf')}</b>
        <span>${escapeHtml(it.tenQH)}</span>
        <a class="bp-btn" href="${viewerUrl}" target="_blank" rel="noopener">${ico('eye')}Mở tab mới</a>
        <button type="button" class="bp-btn" data-adj-close>${ico('close')}Đóng</button>
      </div>
      <iframe title="PDF điều chỉnh cục bộ" src="${viewerUrl}"></iframe>
    </div>`;
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-adj-close]')) closeViewer(); });
    document.body.appendChild(box);
  } catch (err) {
    showToast(`Không mở được PDF: ${err.message}`, 'error');
  }
}

// ============================ HÀNG CHỜ (ADMIN) ============================

function pendingRow(it) {
  const btn = (act, icon, text, cls = '') => `<button type="button" class="bp-btn ${cls}" data-adj-act="${act}" data-adj-id="${it.id}">${ico(icon)}${text}</button>`;
  return `<div class="adj-row">
    <b>${escapeHtml(it.tenQH)}</b>
    ${it.title ? `<span>${escapeHtml(it.title)}</span>` : ''}
    <small>${escapeHtml(it.sender || 'Không tên')} · ${escapeHtml(it.stamp || '')} · ${fmtNum(it.lots || 0)} lô${it.verdict ? ` · ${escapeHtml(it.verdict)}` : ''}${it.note ? ` · ${escapeHtml(it.note)}` : ''}</small>
    <div class="adj-row-btns">
      ${btn('preview', 'locate', 'Xem trên bản đồ')}
      ${it.scan ? btn('scan', 'map', 'Bản vẽ scan') : ''}
      ${it.pdf ? btn('pdf', 'file', 'PDF') : ''}
      ${btn('approve', 'check', 'Duyệt', 'adj-primary')}
      ${btn('reject', 'trash', 'Từ chối', 'adj-danger')}
    </div>
  </div>`;
}

/** Danh sách hồ sơ chờ duyệt trong khung Thẩm định › Điều chỉnh (chỉ Admin) */
export async function loadAdjustPending() {
  const box = $('adjustPendingBox');
  if (!box) return;
  box.hidden = !isAdmin();
  if (!isAdmin()) { box.innerHTML = ''; pendingItems = []; return; }
  box.innerHTML = '<div class="adj-pending-head">Hồ sơ điều chỉnh chờ duyệt</div><div class="adj-pending-note">Đang tải…</div>';
  try {
    const data = await readJsonResponse(await fetch(geeApi('action=getAdjustments'), { method: 'POST', headers: headers(true), body: '{}' }));
    pendingItems = (data.items || []).filter(x => x.status === 'pending').sort((a, b) => (b.at || 0) - (a.at || 0));
    box.innerHTML = `<div class="adj-pending-head">Hồ sơ điều chỉnh chờ duyệt (${pendingItems.length})</div>${pendingItems.length
      ? pendingItems.map(pendingRow).join('')
      : '<div class="adj-pending-note">Không có hồ sơ nào đang chờ.</div>'}`;
  } catch (err) {
    box.innerHTML = `<div class="adj-pending-head">Hồ sơ điều chỉnh chờ duyệt</div><div class="adj-pending-note">Không tải được: ${escapeHtml(err.message)}</div>`;
  }
}

async function preview(id) {
  const it = pendingItems.find(x => x.id === id) || items.find(x => x.id === id);
  if (!it) return;
  if (!items.some(x => x.id === id)) items.push(it);
  try {
    await detailOf(it);
    active.add(id);
    refreshAdjustLayer();
    const b = it.bbox;
    if (map && Array.isArray(b)) map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { maxZoom: 18, padding: [40, 40] });
  } catch (err) {
    showToast(`Không tải được hồ sơ: ${err.message}`, 'error');
  }
}

async function adminCall(action, id, okText) {
  try {
    await readJsonResponse(await fetch(geeApi(`action=${action}`), { method: 'POST', headers: headers(true), body: JSON.stringify({ id }) }));
    details.delete(id);
    active.delete(id);
    scanOn.delete(id);
    const cached = scanUrls.get(id);
    if (cached) { URL.revokeObjectURL(cached.url); scanUrls.delete(id); }
    items = items.filter(x => x.id !== id);
    showToast(okText, 'success');
    await Promise.all([reloadAdjustments(), loadAdjustPending()]);
  } catch (err) {
    showToast(`Không thực hiện được: ${err.message}`, 'error');
  }
}

function onAction(e) {
  const el = e.target.closest('[data-adj-act]');
  if (!el) return;
  const id = el.dataset.adjId;
  const act = el.dataset.adjAct;
  if (act === 'toggle' || act === 'scan') {
    if (el.classList.contains('is-busy')) return;
    el.classList.add('is-busy');
    (act === 'toggle' ? toggle(id) : toggleScan(id)).finally(() => { el.classList.remove('is-busy'); syncPopups(); });
  }
  else if (act === 'wipe') {
    if (wipeOff.has(id)) wipeOff.delete(id); else wipeOff.add(id);
    refreshAdjustLayer();
  }
  else if (act === 'georef') georefScan(id, false);
  else if (act === 'scanNew') georefScan(id, true);
  else if (act === 'pdf') openPdf(id);
  else if (act === 'preview') preview(id);
  else if (act === 'locate') locate(id);
  else if (act === 'approve') adminCall('approveAdjust', id, 'Đã duyệt, ranh điều chỉnh hiện trên bản đồ quy hoạch');
  else if (act === 'reject' && confirm('Từ chối và xóa hồ sơ điều chỉnh này?')) adminCall('removeAdjust', id, 'Đã từ chối hồ sơ');
  else if (act === 'remove' && confirm('Xóa hồ sơ điều chỉnh cục bộ này khỏi bản đồ quy hoạch?')) {
    shownMaps().forEach(m => m.closePopup());
    adminCall('removeAdjust', id, 'Đã xóa hồ sơ điều chỉnh');
  }
}

export function initAdjustLayer() {
  document.addEventListener('click', onAction);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('adjViewer')) closeViewer(); });
  document.addEventListener('auth:change', () => { loadAdjustPending(); refreshAdjustLayer(); });
  window.addEventListener('qh:local-adjust-open', loadAdjustPending);
  window.addEventListener(LOT_OPACITY_EVENT, () => { if (active.size) refreshAdjustLayer(); });
  reloadAdjustments();
}
