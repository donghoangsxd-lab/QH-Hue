// Hồ sơ điều chỉnh cục bộ trên bản đồ quy hoạch (bản đồ chính và khung so sánh): ranh xanh dương nét đứt dày, nền sọc nghiêng 45°.
// Nhịp nét lệch nửa chu kỳ với ranh khu vực QHCT (qhctLayer.js): khu vực vừa có QHCT vừa điều chỉnh hiện xen kẽ xanh / đỏ.
// Rê chuột sáng viền; bấm mở popup để thể hiện theo điều chỉnh (che nền trong ranh, vẽ lô mới lên trên), xem PDF scan
// hoặc bật ảnh tờ bản vẽ scan đã định vị (scanGeoref.js), độ trong suốt chỉnh ở thanh góc dưới bản đồ.
// Admin ghi thẳng; hồ sơ người dùng nằm trong hàng chờ (khung Thẩm định › Điều chỉnh) tới khi Admin duyệt.
// Trong panel, hồ sơ đã duyệt là lớp phụ «Điều chỉnh cục bộ» của đồ án (projectLayer.js): ẩn theo đồ án / cấp và theo ô lớp.
import { state } from './state.js';
import { map } from './mapEngine.js';
import { planMap, passToolClick, isCompareOn } from './planMap.js';
import { isLayerHidden, projectShown } from './projectFiles.js';
import { geeApi } from './api.js';
import { escapeHtml, fmtNum, ico, showToast } from './utils.js';
import { ScanOverlay, cornersOf, openGeoref, prepareScan, scanProblem } from './scanGeoref.js';

const BLUE = '#2f80ff';
// Trên viền sáng ranh đồ án (445), dưới tem đường (450): nền che + lô mới ở 446, ảnh scan ở 447, ranh ở 448
const FILL_PANE = 'adjustFillPane';
const SCAN_PANE = 'adjustScanPane';
const LINE_PANE = 'adjustLinePane';
const FILL_Z = 446;
const SCAN_Z = 447;
const LINE_Z = 448;
const SCAN_TRANSPARENCY = 30;
const LINE_STYLE = { color: BLUE, weight: 4, opacity: 1, dashArray: '12 12', dashOffset: '12', lineCap: 'butt' };
const HOVER_STYLE = { color: '#93c5fd', weight: 6 };
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
const layers = new Map();
let viewerUrl = '';
const scanOn = new Set();
const scanAlpha = new Map();   // id → độ trong suốt 0–100
const scanUrls = new Map();    // id → { at, url, blob } ảnh hồ sơ chờ duyệt tải qua POST
let scanBar = null;

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

// Hồ sơ chờ duyệt Admin đang xem trước luôn hiện
const visible = (it) => it.status === 'pending' || (projectShown(it.tenQH) && !isLayerHidden(it.tenQH, ADJUST_LAYER_KEY));

/** Hồ sơ đã duyệt của 1 đồ án, mới nhất trước */
export function adjustmentsOf(tenQH) {
  return items.filter(x => x.status === 'approved' && x.tenQH === tenQH).sort((a, b) => (b.at || 0) - (a.at || 0));
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
  p.innerHTML = `<rect width="10" height="10" fill="${BLUE}" fill-opacity="0.06"/><line x1="0" y1="0" x2="0" y2="10" stroke="${BLUE}" stroke-width="2.2" stroke-opacity="0.75"/>`;
  defs.appendChild(p);
}

// Mỗi bản đồ một cặp renderer SVG riêng: canvas không tô được pattern và không gắn được bóng sáng cho viền
function layersOf(m) {
  if (layers.has(m)) return layers.get(m);
  [[FILL_PANE, FILL_Z], [SCAN_PANE, SCAN_Z], [LINE_PANE, LINE_Z]].forEach(([name, z]) => {
    if (!m.getPane(name)) m.createPane(name).style.zIndex = z;
  });
  m.getPane(SCAN_PANE).style.pointerEvents = 'none';
  const fillR = L.svg({ pane: FILL_PANE }).addTo(m);
  const lineR = L.svg({ pane: LINE_PANE }).addTo(m);
  const hatchId = `adjHatch${L.stamp(m)}`;
  hatchDefs(lineR._container, hatchId);
  const entry = {
    fillR, lineR, hatchId, fills: L.layerGroup().addTo(m), lines: L.layerGroup().addTo(m),
    scans: L.layerGroup().addTo(m), scanById: new Map()
  };
  layers.set(m, entry);
  return entry;
}

function popupHtml(it) {
  const on = active.has(it.id);
  const admin = isAdmin();
  const scanShown = scanOn.has(it.id);
  const btn = (act, icon, text, cls = '') => `<button type="button" class="bp-btn ${cls}" data-adj-act="${act}" data-adj-id="${it.id}">${ico(icon)}${text}</button>`;
  return `<div class="adj-pop">
    <div class="adj-pop-kind">ĐIỀU CHỈNH CỤC BỘ${it.status === 'pending' ? ' · <span class="adj-wait">chờ duyệt</span>' : ''}</div>
    <b>${escapeHtml(it.tenQH)}</b>
    ${it.title ? `<div class="adj-pop-title">${escapeHtml(it.title)}</div>` : ''}
    <div class="adj-pop-meta">${fmtNum(it.lots || 0)} lô đất mới · ${escapeHtml(it.stamp || '')}${it.sender ? ` · ${escapeHtml(it.sender)}` : ''}${it.verdict ? ` · thẩm định: ${escapeHtml(it.verdict)}` : ''}</div>
    ${it.note ? `<div class="adj-pop-meta">${escapeHtml(it.note)}</div>` : ''}
    <div class="adj-pop-btns">
      ${btn('toggle', on ? 'close' : 'layers', on ? 'Trả lại bản đồ quy hoạch' : 'Thể hiện theo điều chỉnh', on ? '' : 'adj-primary')}
      ${it.scan ? btn('scan', scanShown ? 'close' : 'map', scanShown ? 'Ẩn bản vẽ scan' : 'Bản vẽ scan') : ''}
      ${it.pdf ? btn('pdf', 'file', 'Xem QĐ, bản vẽ (PDF)') : '<span class="adj-pop-meta">Không kèm PDF scan</span>'}
      ${admin && it.scan ? btn('georef', 'pin', 'Định vị lại scan') : ''}
      ${admin ? btn('scanNew', 'map', it.scan ? 'Thay ảnh scan' : 'Ghép ảnh scan') : ''}
      ${admin && it.status === 'approved' ? btn('remove', 'trash', 'Xóa hồ sơ', 'adj-danger') : ''}
    </div>
  </div>`;
}

// Leaflet chặn click lan ra ngoài popup nên gắn bộ xử lý ngay trên nội dung
function openPopup(m, it, latlng) {
  const box = document.createElement('div');
  box.innerHTML = popupHtml(it);
  box.addEventListener('click', (e) => { e.stopPropagation(); onAction(e); });
  L.popup({ maxWidth: 320, className: 'adj-popup' }).setLatLng(latlng).setContent(box).openOn(m);
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
  });
}

function drawOn(m) {
  const L1 = layersOf(m);
  L1.fills.clearLayers();
  L1.lines.clearLayers();
  drawScans(L1);
  items.forEach(it => {
    if (!it.boundary || !visible(it)) return;
    const on = active.has(it.id);
    const detail = on ? details.get(it.id)?.value : null;
    if (on && detail) {
      L1.fills.addLayer(L.geoJSON(it.boundary, {
        renderer: L1.fillR, interactive: false, style: { stroke: false, fillColor: '#ffffff', fillOpacity: 1 }
      }));
      detail.lots.forEach(lot => {
        const shape = L.geoJSON(lot.geometry, {
          renderer: L1.fillR, bubblingMouseEvents: false,
          style: { color: '#1f2937', weight: 0.9, fillColor: lot.tone || '#94a3b8', fillOpacity: 0.88 }
        });
        shape.bindTooltip(`${escapeHtml(lot.label || lot.layer || 'Lô điều chỉnh')} · ${fmtNum(lot.area || 0)} m²`, { sticky: true, className: 'dot-tip' });
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
}

export function refreshAdjustLayer() {
  if (typeof L === 'undefined') return;
  shownMaps().forEach(drawOn);
  renderScanBar();
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
  shownMaps().forEach(m => m.closePopup());
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

function setTransparency(id, value) {
  scanAlpha.set(id, value);
  layers.forEach(L1 => L1.scanById.get(id)?.setOpacity(1 - value / 100));
  const out = scanBar?.getContainer().querySelector(`[data-adj-opv="${id}"]`);
  if (out) out.textContent = `${value}%`;
}

// Thanh độ trong suốt góc dưới trái bản đồ chính: mỗi ảnh đang bật một dòng, áp cho cả bản đồ chính và khung so sánh
function renderScanBar() {
  if (!map || typeof L === 'undefined') return;
  const shown = items.filter(it => it.scan && scanOn.has(it.id) && visible(it));
  if (!shown.length) {
    if (scanBar) { scanBar.remove(); scanBar = null; }
    return;
  }
  if (!scanBar) {
    const Bar = L.Control.extend({
      options: { position: 'bottomleft' },
      onAdd() {
        const el = L.DomUtil.create('div', 'adj-scanbar');
        L.DomEvent.disableClickPropagation(el);
        L.DomEvent.disableScrollPropagation(el);
        el.addEventListener('input', (e) => {
          const r = e.target.closest('[data-adj-op]');
          if (r) setTransparency(r.dataset.adjOp, Number(r.value) || 0);
        });
        el.addEventListener('click', onAction);
        return el;
      }
    });
    scanBar = new Bar().addTo(map);
  }
  scanBar.getContainer().innerHTML = shown.map(it => {
    const v = transparencyOf(it.id);
    return `<div class="adj-scanrow">
      <span class="adj-scanname" title="${escapeHtml(it.title || it.tenQH)}">Bản vẽ scan · ${escapeHtml(it.tenQH)}</span>
      <label>Độ trong suốt <input type="range" min="0" max="100" step="5" value="${v}" data-adj-op="${it.id}"><output data-adj-opv="${it.id}">${v}%</output></label>
      <button type="button" class="bp-btn" data-adj-act="scan" data-adj-id="${it.id}" title="Ẩn bản vẽ scan">${ico('close')}</button>
    </div>`;
  }).join('');
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
  shownMaps().forEach(m => m.closePopup());
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
  if (act === 'toggle') toggle(id);
  else if (act === 'scan') toggleScan(id);
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
  reloadAdjustments();
}
