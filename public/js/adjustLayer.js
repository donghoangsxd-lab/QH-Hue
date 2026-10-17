// Hồ sơ điều chỉnh cục bộ trên bản đồ quy hoạch (bản đồ chính và khung so sánh): ranh cyan, nét đứt, không tô nền.
// Nét nằm trên ranh và lô đồ án QHPK. Nhịp nét lệch nửa chu kỳ với ranh khu vực QHCT (qhctLayer.js): chỗ trùng ranh hiện xen kẽ cyan / đỏ.
// Mặc định trong ranh là chức năng sau điều chỉnh: ảnh vệ tinh cắt đúng phạm vi che lô gốc, lô mới kẻ hoa văn TT16.
// «Trả lại bản đồ quy hoạch» trong bảng hồ sơ mới hiện lại chức năng gốc. Rê chuột sáng viền; bấm ranh mở bảng, ghim góc trên trái. Bấm 1 lô mở thẻ lô.
// Admin sửa lớp, loại đất, tầng cao, mật độ, hệ số và ranh — ghi vào file hồ sơ, không đụng lô đồ án bên ngoài.
// PDF và ảnh tờ bản vẽ scan đã định vị (scanGeoref.js): thanh nhỏ ở góc ảnh chỉnh độ trong suốt và tắt ảnh.
// Admin ghi thẳng; hồ sơ người dùng nằm trong hàng chờ (khung Thẩm định › Điều chỉnh) tới khi Admin duyệt.
// Trong panel, hồ sơ đã duyệt là lớp phụ «Điều chỉnh cục bộ» của đồ án (projectLayer.js): ẩn theo đồ án / cấp và theo ô lớp.
import { state } from './state.js';
import { map } from './mapEngine.js';
import { planMap, passToolClick, isCompareOn } from './planMap.js';
import { isLayerHidden, projectShown } from './projectFiles.js';
import { geeApi } from './api.js';
import { escapeHtml, fmtNum, ico, planItems, showToast } from './utils.js';
import { basemapTileSpec } from './basemap.js';
import { ScanOverlay, cornersOf, openGeoref, prepareScan, scanProblem } from './scanGeoref.js';
import { tt16SymbolStyle, landPatternKey, landLabel, layerForPattern, tt16SwatchCss, TT16_STYLES, TT16_LAND_KEYS, LAND_LABELS, TT16_PATTERN_ZOOM, LOT_OPACITY_EVENT } from './tt16Symbols.js';
import { startShapeEdit, vertexCount, SHAPE_MAX_VERTICES } from './lotShapeEdit.js';
import { savedLandTag } from './projectReviewCore.js';
import { planLevelOf } from './generalPlan.js';

const CYAN = '#22d3ee';
// Trên ranh đồ án QHPK (overlay 400) và viền sáng đồ án (445), dưới tem đường (450).
// Ảnh vệ tinh cắt theo ranh và lô mới cùng z 446: pane vệ tinh tạo trước nên lô nằm trên nền.
// Ảnh scan ở 447, ranh QHCT ở 448, ranh điều chỉnh ở 449 nên luôn nổi trên đồ án được điều chỉnh.
const SAT_PANE = 'adjustSatPane';
const FILL_PANE = 'adjustFillPane';
const SCAN_PANE = 'adjustScanPane';
const LINE_PANE = 'adjustLinePane';
const SAT_Z = 446;
const FILL_Z = 446;
const SCAN_Z = 447;
const LINE_Z = 449;
const SCAN_TRANSPARENCY = 30;
// Cùng độ dày ranh khu vực QHCT (2 px). Nét 5 px khi thu cả đồ án nuốt góc và trông như đứt đoạn.
const LINE_STYLE = { color: CYAN, weight: 2, opacity: 1, dashArray: '10 6', dashOffset: '8', lineCap: 'butt', lineJoin: 'round', fill: false };
const HOVER_STYLE = { color: '#a5f3fc', weight: 3.5, lineJoin: 'round', fill: false };
export const ADJUST_PDF_MAX_BYTES = 2 * 1024 * 1024;
// Khóa lớp trong state.hiddenProjectLayers ("<Ten_QH>|dieu-chinh"), cùng cách lưu với PROJECT_LAYERS
export const ADJUST_LAYER_KEY = 'dieu-chinh';
export const ADJUST_CHANGE_EVENT = 'qh:adjustments';

const $ = (id) => document.getElementById(id);
const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;

let items = [];
let adjustmentsReady = false;
let pendingItems = [];
const details = new Map();
const active = new Set();
const reverted = new Set();    // người dùng chọn «Trả lại bản đồ quy hoạch»: giữ chức năng gốc tới khi bật lại
const arming = new Set();
const armFailed = new Set();
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
  const guess = saved || landPatternKey(lot.layer, lot.name || '') || landPatternKey(lot.srcLayer, '');
  const key = TT16_STYLES[guess] ? guess : null;
  return tt16SymbolStyle(key, key ? TT16_STYLES[key].color : lot.tone || '#94a3b8', 'QH', { scenario: 'QH', detailed });
}

// ============================ NỀN VỆ TINH CẮT THEO RANH ============================
// Mỗi ô ảnh Google (cùng URL, cùng cấp zoom với ảnh nền) vẽ lên canvas rồi destination-in theo ranh:
// trong ranh là đúng ảnh vệ tinh đang xem, ngoài ranh trong suốt nên quy hoạch cũ vẫn hiện.
// Ô nằm ngoài mọi ranh không tải ảnh. Phóng quá cấp 19 thì Leaflet co giãn ô như ảnh nền nên mép không lệch.

const satClips = new WeakMap();
let SatClip = null;

function polysFromGeom(g) {
  const parts = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return parts.map(rings => rings
    .map(ring => ring.map(([lng, lat]) => L.latLng(lat, lng)))
    .filter(ring => ring.length >= 4)).filter(rings => rings.length);
}

function clipClass() {
  if (SatClip) return SatClip;
  SatClip = L.TileLayer.extend({
    initialize(spec, pane) {
      L.TileLayer.prototype.initialize.call(this, spec.url, {
        pane, maxZoom: spec.maxZoom, maxNativeZoom: spec.maxNativeZoom, subdomains: spec.subdomains,
        crossOrigin: 'anonymous', fadeAnimation: false, className: 'adj-sat-clip', zIndex: 1
      });
      this._polys = [];
      this._boxes = [];
    },
    setGeoms(geoms) {
      const polys = [];
      geoms.forEach(g => polys.push(...polysFromGeom(g)));
      this._polys = polys;
      this._boxes = polys.map(rings => {
        const b = L.latLngBounds([]);
        rings.forEach(ring => ring.forEach(ll => b.extend(ll)));
        return b;
      });
      if (this._map) this.redraw();
    },
    _tileBounds(coords, size) {
      const z = coords.z;
      const nw = this._map.unproject(L.point(coords.x * size.x, coords.y * size.y), z);
      const se = this._map.unproject(L.point((coords.x + 1) * size.x, (coords.y + 1) * size.y), z);
      return L.latLngBounds(nw, se);
    },
    _hitPolys(coords, size) {
      const box = this._tileBounds(coords, size);
      const hit = [];
      this._polys.forEach((poly, i) => {
        if (this._boxes[i].isValid() && this._boxes[i].intersects(box)) hit.push(poly);
      });
      return hit;
    },
    _mask(polys, coords, size) {
      const mask = document.createElement('canvas');
      mask.width = size.x;
      mask.height = size.y;
      const ctx = mask.getContext('2d');
      const origin = L.point(coords.x * size.x, coords.y * size.y);
      const trace = (rings) => {
        rings.forEach(ring => {
          ring.forEach((ll, k) => {
            const p = this._map.project(ll, coords.z).subtract(origin);
            if (k) ctx.lineTo(p.x, p.y);
            else ctx.moveTo(p.x, p.y);
          });
          ctx.closePath();
        });
      };
      // Từng polygon một: lỗ dùng evenodd, hai hồ sơ chồng nhau vẫn đặc (không khoét chỗ giao)
      polys.forEach(rings => {
        ctx.beginPath();
        trace(rings);
        ctx.fill('evenodd');
      });
      ctx.beginPath();
      polys.forEach(trace);
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
      return mask;
    },
    createTile(coords, done) {
      const tile = document.createElement('canvas');
      const size = this.getTileSize();
      tile.width = size.x;
      tile.height = size.y;
      const hit = this._map ? this._hitPolys(coords, size) : [];
      if (!hit.length) { done(null, tile); return tile; }
      const url = this.getTileUrl(coords);
      const paint = (image) => {
        if (!this._map) { done(null, tile); return; }
        const ctx = tile.getContext('2d');
        ctx.drawImage(image, 0, 0, size.x, size.y);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(this._mask(hit, coords, size), 0, 0);
        done(null, tile);
      };
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => paint(img);
      img.onerror = () => {
        const plain = new Image();
        plain.onload = () => paint(plain);
        plain.onerror = () => done(null, tile);
        plain.src = url;
      };
      img.src = url;
      return tile;
    }
  });
  return SatClip;
}

function geomSig(geoms) {
  let h = 2166136261;
  geoms.forEach(g => {
    const full = JSON.stringify(g.coordinates);
    for (let i = 0; i < full.length; i += 64) h = Math.imul(h ^ full.charCodeAt(i), 16777619);
    h ^= full.length;
  });
  return (h >>> 0).toString(36);
}

/** Bật nền vệ tinh cắt theo các polygon trên một pane. Mảng rỗng thì gỡ lớp. Nhiều pane trên cùng một bản đồ không đè nhau */
export function setSatelliteClip(m, pane, zIndex, geoms) {
  if (!m || typeof L === 'undefined') return;
  let byPane = satClips.get(m);
  if (!byPane) { byPane = new Map(); satClips.set(m, byPane); }
  const list = (Array.isArray(geoms) ? geoms : []).filter(g => g && (g.type === 'Polygon' || g.type === 'MultiPolygon'));
  const prev = byPane.get(pane);
  if (!list.length) {
    if (prev) { prev.layer.remove(); byPane.delete(pane); }
    return;
  }
  const sig = geomSig(list);
  if (prev && prev.sig === sig) return;
  if (!m.getPane(pane)) {
    const el = m.createPane(pane);
    el.style.zIndex = String(zIndex);
    el.style.pointerEvents = 'none';
  }
  const layer = prev ? prev.layer : new (clipClass())(basemapTileSpec(), pane);
  layer.setGeoms(list);
  if (!prev) layer.addTo(m);
  byPane.set(pane, { layer, sig });
}

// Hồ sơ chờ duyệt Admin đang xem trước luôn hiện
const visible = (it) => it.status === 'pending' || (projectShown(it.tenQH) && !isLayerHidden(it.tenQH, ADJUST_LAYER_KEY));

/** Đã tải danh sách hồ sơ điều chỉnh ít nhất một lần (kể cả khi lỗi mạng) */
export const adjustmentsKnown = () => adjustmentsReady;

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

// Ranh: SVG (viền sáng bằng class). Lô mới: canvas để kẻ hoa văn TT16.
function layersOf(m) {
  if (layers.has(m)) return layers.get(m);
  if (!m.getPane(SAT_PANE)) {
    const pane = m.createPane(SAT_PANE);
    pane.style.zIndex = SAT_Z;
    pane.style.pointerEvents = 'none';
  }
  [[FILL_PANE, FILL_Z], [SCAN_PANE, SCAN_Z], [LINE_PANE, LINE_Z]].forEach(([name, z]) => {
    if (!m.getPane(name)) m.createPane(name).style.zIndex = z;
  });
  m.getPane(SCAN_PANE).style.pointerEvents = 'none';
  m.getPane(FILL_PANE).style.pointerEvents = 'none';
  const fillR = L.canvas({ pane: FILL_PANE }).addTo(m);
  const lineR = L.svg({ pane: LINE_PANE }).addTo(m);
  const entry = {
    map: m, fillR, lineR, fills: L.layerGroup().addTo(m), lines: L.layerGroup().addTo(m),
    scans: L.layerGroup().addTo(m), scanById: new Map(), detailed: null
  };
  layers.set(m, entry);
  // Canvas lô phủ kín khung. pointer-events auto thì chỗ không có lô cũng nuốt click ranh đồ án bên dưới.
  m.getContainer().addEventListener('click', (ev) => onFillClick(m, ev), true);
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
    on ? sw('wipe', wipeOff.has(it.id) ? 'eye' : 'eye-off', 'Che quy hoạch cũ', 'Ảnh vệ tinh cắt theo ranh, giấu lô quy hoạch cũ', !wipeOff.has(it.id)) : '',
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

// Pane bản đồ có transform nên ghim bảng lên #mapArea, cùng cách bảng công trình
function pinAdjPopup(popup) {
  const el = popup.getElement();
  const host = document.getElementById('mapArea');
  if (!el || !host) return;
  if (el.parentElement !== host) host.appendChild(el);
  el.classList.add('adj-dock');
  el.style.left = '';
  el.style.bottom = '';
  el.style.right = '';
  el.style.top = '';
  el.style.transform = '';
}

// Leaflet chặn click lan ra ngoài popup nên gắn bộ xử lý ngay trên nội dung
function openPopup(m, it) {
  const box = document.createElement('div');
  box.className = 'adj-pop-box';
  box.innerHTML = popupHtml(it);
  box.addEventListener('click', (e) => { e.stopPropagation(); onAction(e); });
  const popup = L.popup({ maxWidth: 340, minWidth: 280, className: 'adj-popup', autoPan: false, closeButton: true }).setContent(box);
  box._popup = popup;
  popup._updatePosition = function () { pinAdjPopup(this); };
  popup._animateZoom = function () { pinAdjPopup(this); };
  popup._adjustPan = function () {};
  const layout = popup._updateLayout.bind(popup);
  popup._updateLayout = function () { layout(); pinAdjPopup(this); };
  popup.on('remove', () => popup.getElement()?.remove());
  popup.setLatLng(m.getCenter());
  popup.openOn(m);
  pinAdjPopup(popup);
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
  // Cũ trước, mới sau: chỗ hai hồ sơ chồng nhau, chức năng của quyết định mới nằm trên
  const paint = items.filter(it => it.boundary && visible(it)).sort((a, b) => (a.at || 0) - (b.at || 0));
  const clips = [];
  paint.forEach(it => {
    if (active.has(it.id) && !wipeOff.has(it.id)) clips.push(it.boundary);
  });
  setSatelliteClip(m, SAT_PANE, SAT_Z, clips);
  paint.forEach(it => {
    const on = active.has(it.id);
    const detail = on ? details.get(it.id)?.value : null;
    if (on && detail) {
      detail.lots.forEach((lot, index) => {
        const shape = L.geoJSON(lot.geometry, {
          renderer: L1.fillR, bubblingMouseEvents: false, style: adjustLotStyle(lot, L1.detailed)
        });
        const name = lot.name || lot.label || lot.layer || 'Lô điều chỉnh';
        const kind = lot.nhom && lot.nhom !== name ? ` · ${escapeHtml(lot.nhom)}` : '';
        const src = lot.srcLayer ? `<br><small>Layer DXF: ${escapeHtml(lot.srcLayer)}</small>` : '';
        shape.bindTooltip(`${escapeHtml(name)}${kind} · ${fmtNum(lot.area || 0)} m²${src}`, { sticky: true, className: 'dot-tip' });
        shape.on('click', (e) => { if (!passToolClick(m, e)) openAdjustLot(m, it, lot, index, e.latlng); });
        L1.fills.addLayer(shape);
      });
    }
    const line = L.geoJSON(it.boundary, {
      renderer: L1.lineR, bubblingMouseEvents: false, style: LINE_STYLE
    });
    line.bindTooltip(`Điều chỉnh cục bộ · ${escapeHtml(it.tenQH)}`, { sticky: true, direction: 'top', className: 'dot-tip' });
    line.on('mouseover', () => line.eachLayer(l => { l.setStyle(HOVER_STYLE); l.getElement()?.classList.add('adj-glow'); }));
    line.on('mouseout', () => line.eachLayer(l => { l.setStyle(LINE_STYLE); l.getElement()?.classList.remove('adj-glow'); }));
    line.on('click', (e) => { if (!passToolClick(m, e)) openPopup(m, it); });
    L1.lines.addLayer(line);
  });
  syncFillPointer(L1);
}

// Canvas lô nằm trên ranh đồ án và phủ kín khung. Giữ pointer-events none để click chỗ không có lô
// xuyên xuống ranh QHPK. Click trúng lô bắt ở capture (onFillClick) rồi mở thẻ lô.
function syncFillPointer(L1) {
  const pane = L1.map.getPane(FILL_PANE);
  if (pane) pane.style.pointerEvents = 'none';
  if (L1.fillR._container) L1.fillR._container.style.pointerEvents = 'none';
}

function onFillClick(m, ev) {
  if (ev.button != null && ev.button !== 0) return;
  const L1 = layers.get(m);
  if (!L1 || typeof turf === 'undefined') return;
  let latlng;
  try { latlng = m.mouseEventToLatLng(ev); } catch (e) { return; }
  if (!latlng) return;
  const pt = [latlng.lng, latlng.lat];
  let target = null;
  L1.fills.eachLayer(group => {
    if (!group.eachLayer) return;
    let inside = false;
    group.eachLayer(path => {
      if (inside || path.options?.interactive === false) return;
      const b = path.getBounds?.();
      if (b && b.isValid() && !b.contains(latlng)) return;
      const f = path.feature;
      if (!f?.geometry) return;
      try { if (turf.booleanPointInPolygon(pt, f)) inside = true; } catch (e) { /* lô lỗi */ }
    });
    if (inside) target = group;
  });
  if (!target) return;
  ev.stopPropagation();
  target.fire('click', { latlng, originalEvent: ev });
}

// Hồ sơ đã duyệt đang hiện trên bản đồ thì tải lô và bật chức năng sau điều chỉnh, trừ hồ sơ người dùng đã trả về gốc
function armAdjusted() {
  const todo = items.filter(it => it.status === 'approved' && it.boundary && visible(it)
    && !reverted.has(it.id) && !active.has(it.id) && !arming.has(it.id) && !armFailed.has(it.id));
  if (!todo.length) return;
  todo.forEach(it => arming.add(it.id));
  Promise.all(todo.map(it => detailOf(it).then(() => it).catch(err => {
    armFailed.add(it.id);
    console.warn(`Không tải lô điều chỉnh ${it.id}:`, err.message);
    return null;
  }).finally(() => arming.delete(it.id)))).then(list => {
    let changed = false;
    list.forEach(it => {
      if (!it || reverted.has(it.id) || !visible(it) || active.has(it.id)) return;
      active.add(it.id);
      changed = true;
    });
    if (changed) refreshAdjustLayer();
  });
}

export function refreshAdjustLayer() {
  if (typeof L === 'undefined') return;
  shownMaps().forEach(drawOn);
  syncPopups();
  armAdjusted();
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
    reverted.add(id);
    refreshAdjustLayer();
    return;
  }
  reverted.delete(id);
  armFailed.delete(id);
  try {
    await detailOf(it);
    if (reverted.has(id)) return;
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
  armFailed.clear();
  [...active].forEach(id => { if (!items.some(x => x.id === id)) active.delete(id); });
  [...reverted].forEach(id => { if (!items.some(x => x.id === id)) reverted.delete(id); });
  [...wipeOff].forEach(id => { if (!active.has(id)) wipeOff.delete(id); });
  [...scanOn].forEach(id => { if (!items.some(x => x.id === id && x.scan)) scanOn.delete(id); });
  adjustmentsReady = true;
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
  m.once('moveend', () => openPopup(m, it));
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

const ADJ_PLAN = [['floors', 'Tầng cao', 'VD 3 hoặc 2-5'], ['coverage', 'Mật độ XD (%)', 'VD 40'], ['far', 'Hệ số SDĐ (lần)', 'VD 1,2']];
const lotInput = (key, label, value, extra = '') => `<label class="lot-edit-row"><span>${label}</span>
  <input type="text" data-k="${key}" value="${escapeHtml(value)}"${extra}></label>`;
const areaText = (area) => (Number(area) > 0 ? `${fmtNum(Math.round(Number(area)))} m²` : '—');

function lotPattern(lot) {
  const saved = TT16_STYLES[lot.pattern] ? lot.pattern : '';
  const guess = saved || landPatternKey(lot.layer, lot.name || '') || '';
  return TT16_STYLES[guess] ? guess : '';
}

function lotKindName(lot) {
  const key = lotPattern(lot);
  return lot.nhom || (key && TT16_STYLES[key].label) || lot.label || 'Lô điều chỉnh';
}

function lotPopupHtml(it, lot) {
  const key = lotPattern(lot);
  const typeName = lotKindName(lot);
  const title = lot.lotCode || lot.name || lot.label || typeName;
  const swatch = (key && tt16SwatchCss(key, 0.6)) || `background:${lot.tone || '#94a3b8'};`;
  const stats = planItems(lot.plan);
  const info = [
    ['Diện tích', lot.area ? `${fmtNum(Math.round(lot.area))} m²` : ''],
    lot.stampArea && lot.area && Math.abs(lot.stampArea - lot.area) / lot.area > 0.1 ? ['Diện tích tem', `${fmtNum(Math.round(lot.stampArea))} m²`] : null,
    ['Loại đất', typeName],
    ['Đồ án', it.tenQH],
    ['Layer', lot.layer],
    lot.srcLayer && lot.srcLayer !== lot.layer ? ['Layer DXF', lot.srcLayer] : null
  ].filter(row => row && row[1]);
  const statsHtml = stats.length ? `<div class="lp-stats">${stats.map(s => `<div class="lp-stat" title="${escapeHtml(s.label)}">
      <small>${escapeHtml(s.short)}</small><b>${ico(s.icon)}${escapeHtml(s.value)}${s.unit ? `<em>${escapeHtml(s.unit)}</em>` : ''}</b></div>`).join('')}</div>` : '';
  return `<div class="land-popup">
    <div class="lp-head" title="${escapeHtml(lot.name || title)}">
      <i class="lp-swatch" style="${swatch}"></i>
      <div class="lp-head-main">
        <div class="lp-title-row"><span class="lp-title">${escapeHtml(title)}</span><span class="lp-phase lp-phase-qh">Điều chỉnh</span></div>
        ${title !== typeName ? `<div class="lp-sub">${escapeHtml(typeName)}</div>` : ''}
      </div>
    </div>
    ${statsHtml}
    <dl class="lp-info">${info.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd${k.startsWith('Layer') ? ' class="lp-mono"' : ''}>${escapeHtml(String(v))}</dd>`).join('')}</dl>
    <button type="button" class="proof-btn adj-lot-file" data-adj-lot-file>${ico('layers')}Hồ sơ điều chỉnh</button>
  </div>`;
}

function refitPopup(popup) {
  popup._updateLayout();
  popup._updatePosition();
  popup._adjustPan?.();
}

function lotBefore(lot) {
  return {
    name: lot.name || '',
    nhom: lot.nhom || landLabel(lot.layer) || lot.label || '',
    pattern: lotPattern(lot),
    plan: { floors: lot.plan?.floors || '', coverage: lot.plan?.coverage || '', far: lot.plan?.far || '' }
  };
}

function lotFormHtml(lot, before) {
  const keep = before.pattern ? '' : '<option value="" selected>— Giữ layer hiện tại —</option>';
  const options = TT16_LAND_KEYS.map(k => `<option value="${k}"${k === before.pattern ? ' selected' : ''}>${escapeHtml(TT16_STYLES[k].label)}</option>`).join('');
  return `<div class="lot-edit-title">${ico('pen')}Sửa lô điều chỉnh <small>(ghi hồ sơ)</small></div>
    ${lotInput('name', 'Tên lô', before.name, ' maxlength="150" placeholder="Có thể để trống"')}
    <label class="lot-edit-row"><span>Lớp (TT16)</span><select data-layer-key title="Layer hiện tại: ${escapeHtml(lot.layer || '(trống)')}${lot.srcLayer ? ` · DXF: ${escapeHtml(lot.srcLayer)}` : ''}">${keep}${options}</select></label>
    ${lotInput('nhom', 'Loại đất', before.nhom, ' list="adjLotLandTypes" maxlength="40"')}
    <datalist id="adjLotLandTypes">${LAND_LABELS.map(l => `<option value="${escapeHtml(l)}">`).join('')}</datalist>
    <div class="lot-edit-row"><span>Diện tích</span><div class="lot-edit-shape"><b class="js-lot-area">${areaText(lot.area)}</b>
      <button type="button" class="proof-btn js-lot-shape" title="Kéo đỉnh ranh lô trên bản đồ">${ico('pen')}Sửa đỉnh</button></div></div>
    <div class="lot-edit-hint js-lot-shape-hint" hidden>Kéo đỉnh vàng để chỉnh · kéo / bấm chấm trắng giữa cạnh để thêm đỉnh · chuột phải vào đỉnh để xóa. Nền lô cũ vẫn hiện bên dưới để đối chiếu.</div>
    ${ADJ_PLAN.map(([k, label, ph]) => lotInput(`plan.${k}`, label, before.plan[k], ` maxlength="20" placeholder="${ph}"`)).join('')}
    <div class="lot-edit-msg"></div>
    <div class="lot-edit-btns"><button type="button" class="proof-btn js-lot-save">${ico('save')}Lưu</button>
    <button type="button" class="proof-btn js-lot-cancel">Hủy</button></div>`;
}

function bindLotFile(box, m, it) {
  box.querySelector('[data-adj-lot-file]')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    m.closePopup();
    openPopup(m, it);
  });
}

function applySavedLot(it, index, saved) {
  const detail = details.get(it.id)?.value;
  const lot = detail && detail.lots[index];
  if (lot && saved.lot) {
    Object.keys(lot).forEach(k => { if (!(k in saved.lot)) delete lot[k]; });
    Object.assign(lot, saved.lot);
  }
  if (saved.stamp) {
    [items, pendingItems].forEach(list => list.forEach(x => {
      if (x.id === it.id) { x.stamp = saved.stamp; x.at = saved.at; }
    }));
  }
  refreshAdjustLayer();
  document.dispatchEvent(new CustomEvent(ADJUST_CHANGE_EVENT));
  return lot;
}

function openLotForm(popup, it, lot, index) {
  const box = popup.getContent();
  const m = popup._map;
  if (!box || !m || box.querySelector('.lot-edit') || !isAdmin()) return;
  const view = box.querySelector('.land-popup');
  const before = lotBefore(lot);
  const form = document.createElement('div');
  form.className = 'lot-edit';
  form.innerHTML = lotFormHtml(lot, before);
  if (view) view.hidden = true;
  box.appendChild(form);
  L.DomEvent.disableClickPropagation(form);
  L.DomEvent.disableScrollPropagation(form);
  refitPopup(popup);
  form.querySelector('[data-k="name"]')?.focus();

  const msg = form.querySelector('.lot-edit-msg');
  const select = form.querySelector('[data-layer-key]');
  const nhomInput = form.querySelector('[data-k="nhom"]');
  select?.addEventListener('change', () => {
    if (!select.value || !nhomInput) return;
    nhomInput.value = landLabel(layerForPattern(select.value, lot.layer || lot.srcLayer || ''));
  });

  const areaEl = form.querySelector('.js-lot-area');
  const shapeBtn = form.querySelector('.js-lot-shape');
  const hint = form.querySelector('.js-lot-shape-hint');
  const original = lot.geometry;
  const originalJson = original ? JSON.stringify(original) : '';
  let session = null;
  let edited = null;
  let kinked = false;
  const kinksOf = (geom) => turf.kinks(turf.cleanCoords(turf.feature(geom))).features.length;
  let baseKinks = 0;

  const showArea = (geom) => {
    edited = geom;
    let area = 0;
    try {
      area = turf.area(turf.feature(geom));
      kinked = kinksOf(geom) > baseKinks;
    } catch (e) { kinked = true; }
    const was = Number(lot.area) || 0;
    const diff = Math.round(area - was);
    const delta = was && diff ? ` <small>(cũ ${fmtNum(Math.round(was))} m², ${diff > 0 ? '+' : ''}${fmtNum(diff)})</small>` : '';
    areaEl.innerHTML = `${areaText(area)}${delta}`;
    areaEl.classList.toggle('bad', kinked);
    msg.textContent = kinked ? 'Ranh đang tự cắt — kéo lại đỉnh trước khi lưu' : '';
    msg.className = kinked ? 'lot-edit-msg bad' : 'lot-edit-msg';
  };
  const stop = () => {
    if (!session) return;
    const s = session;
    session = null;
    state.lotShapeEdit = false;
    if (popup.isOpen()) m.on('preclick', popup.close, popup);
    s.stop();
  };
  popup.once('remove', stop);
  shapeBtn?.addEventListener('click', () => {
    if (session) { session.reset(original); return; }
    if (!original || typeof turf === 'undefined') return;
    const n = vertexCount(original);
    if (n > SHAPE_MAX_VERTICES) {
      msg.textContent = `Lô có ${fmtNum(n)} đỉnh — quá nhiều để kéo tay (tối đa ${SHAPE_MAX_VERTICES}). Sửa trong CAD rồi nhập lại.`;
      msg.className = 'lot-edit-msg bad';
      refitPopup(popup);
      return;
    }
    try { baseKinks = kinksOf(original); } catch (e) { baseKinks = 0; }
    session = startShapeEdit(m, original, showArea);
    state.lotShapeEdit = true;
    m.off('preclick', popup.close, popup);
    const b = L.geoJSON(original).getBounds();
    if (b.isValid()) popup.setLatLng([b.getNorth(), b.getCenter().lng]);
    shapeBtn.innerHTML = `${ico('close')}Khôi phục ranh gốc`;
    shapeBtn.title = 'Bỏ các đỉnh đã kéo, trở về ranh lúc mở form';
    if (hint) hint.hidden = false;
    refitPopup(popup);
  });

  const closeForm = () => {
    stop();
    form.remove();
    if (view) view.hidden = false;
    refitPopup(popup);
  };
  form.querySelector('.js-lot-cancel')?.addEventListener('click', closeForm);
  form.querySelector('.js-lot-save')?.addEventListener('click', async () => {
    const fields = {};
    const now = {};
    form.querySelectorAll('[data-k]').forEach(el => { now[el.dataset.k] = el.value.trim(); });
    if (now.name !== undefined && now.name !== before.name) fields.name = now.name;
    if (now.nhom !== undefined && now.nhom !== before.nhom) fields.nhom = now.nhom;
    const plan = {};
    ADJ_PLAN.forEach(([k]) => {
      const val = now[`plan.${k}`];
      if (val !== undefined && val !== before.plan[k]) plan[k] = val;
    });
    if (Object.keys(plan).length) fields.plan = plan;
    if (select && select.value && select.value !== before.pattern) {
      const layer = layerForPattern(select.value, lot.layer || lot.srcLayer || '');
      if (layer && layer !== lot.layer) fields.layer = layer;
      fields.pattern = select.value;
      fields.label = TT16_STYLES[select.value].label;
      fields.tone = TT16_STYLES[select.value].color;
      const tag = savedLandTag(planLevelOf(it.tenQH), select.value, false);
      fields.landKey = tag.landKey || '';
      fields.subKey = tag.subKey || '';
    }
    if (edited && JSON.stringify(edited) !== originalJson) {
      if (kinked) { msg.textContent = 'Ranh đang tự cắt — kéo lại đỉnh trước khi lưu'; msg.className = 'lot-edit-msg bad'; return; }
      fields.geometry = edited;
    }
    if (!Object.keys(fields).length) { closeForm(); return; }
    const btn = form.querySelector('.js-lot-save');
    if (btn) btn.disabled = true;
    msg.textContent = 'Đang ghi hồ sơ…';
    msg.className = 'lot-edit-msg';
    try {
      const saved = await readJsonResponse(await fetch(geeApi('action=editAdjustLot'), {
        method: 'POST', headers: headers(true), body: JSON.stringify({ id: it.id, index, fields })
      }));
      stop();
      const next = applySavedLot(it, index, saved) || lot;
      box.innerHTML = lotPopupHtml(it, next);
      bindLotFile(box, m, it);
      refitPopup(popup);
      showToast('✓ Đã cập nhật lô trong hồ sơ điều chỉnh', 'success');
    } catch (err) {
      if (btn) btn.disabled = false;
      msg.textContent = err.message || 'Không ghi được';
      msg.className = 'lot-edit-msg bad';
      refitPopup(popup);
    }
  });
}

function openAdjustLot(m, it, lot, index, latlng) {
  const box = document.createElement('div');
  box.innerHTML = lotPopupHtml(it, lot);
  bindLotFile(box, m, it);
  const popup = L.popup({ maxWidth: 340, minWidth: 280, className: 'land-lot-popup adj-lot-popup', autoPanPaddingTopLeft: [40, 90] })
    .setLatLng(latlng).setContent(box).openOn(m);
  if (!isAdmin()) return;
  const container = popup.getElement();
  if (!container) return;
  container.classList.add('pp-editable');
  const btn = L.DomUtil.create('a', 'pp-edit-btn', container);
  btn.href = '#';
  btn.setAttribute('role', 'button');
  btn.innerHTML = ico('pen');
  btn.title = 'Sửa thông tin lô trong hồ sơ điều chỉnh';
  btn.setAttribute('aria-label', btn.title);
  L.DomEvent.disableClickPropagation(btn);
  L.DomEvent.on(btn, 'click', (e) => {
    L.DomEvent.stop(e);
    openLotForm(popup, it, lot, index);
  });
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
