// Nhập hàng loạt › Điều chỉnh cục bộ: một hồ sơ đã có Quyết định gồm DXF (ranh + hatch đất), ảnh tờ bản vẽ scan và PDF Quyết định.
// DXF đọc bằng adjustRecordFromDxf (không chấm QCVN); ảnh phải đặt vào ranh điều chỉnh (kéo, xoay trong scanGeoref.js) trước khi gửi.
// Admin ghi thẳng, người dùng vào hàng chờ (adjustLayer.js). Lô gốc của đồ án giữ nguyên, hồ sơ chỉ vẽ phủ trên bản đồ quy hoạch.
// Mỗi layer hatch trong DXF tự nhận loại đất theo tên (landPatternKey); layer chưa nhận hoặc nhận sai thì chọn tay,
// lựa chọn nhớ theo tên layer cho lần nhập sau.
import { state } from './state.js';
import { map } from './mapEngine.js';
import { CRS_PRESETS } from './cadImport.js';
import { adjustRecordFromDxf } from './localAdjust.js';
import { sendAdjustment, pdfProblem, adjustLotStyle, WIPEOUT_STYLE } from './adjustLayer.js';
import { ScanOverlay, cornersOf, openGeoref, prepareScan, scanProblem } from './scanGeoref.js';
import { TT16_LAND_KEYS, TT16_STYLES, TT16_PATTERN_ZOOM, tt16SwatchCss } from './tt16Symbols.js';
import { escapeHtml, fmtNum, ico, showToast } from './utils.js';

const RANH = '#f5c400';
const FILL_PANE = 'adjImportFillPane';
const SCAN_PANE = 'adjImportScanPane';
const LINE_PANE = 'adjImportLinePane';
const LAYER_MAP_KEY = 'qh_adjust_layer_map_v1';

const $ = (id) => document.getElementById(id);
const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;

// record: kết quả adjustRecordFromDxf; scan: { blob, w, h, url, name, georef } (georef null = chưa định vị)
let files = { dxf: null, image: null, pdf: null };
let record = null;
let recordError = '';
let reading = false;
let readSeq = 0;
let scan = null;
let preparing = false;
let prepSeq = 0;
let submitting = false;
let transparency = 30;
let preview = null;
let scanLayer = null;
let lineRenderer = null;
let fillRenderer = null;
let previewDetailed = null;
// Layer DXF → khóa TT16 chọn tay cho file đang mở
let overrides = {};

const kindOn = () => document.querySelector('input[name="bulkKind"]:checked')?.value === 'adjust';

function sizeText(bytes) {
  if (bytes < 1024) return `${fmtNum(bytes)} B`;
  if (bytes < 1024 * 1024) return `${fmtNum(Math.round(bytes / 1024))} KB`;
  return `${fmtNum(Math.round(bytes / 1024 / 1024 * 10) / 10)} MB`;
}

function rememberedLayers() {
  try {
    const all = JSON.parse(localStorage.getItem(LAYER_MAP_KEY) || '{}');
    return all && typeof all === 'object' ? all : {};
  } catch (e) { return {}; }
}

function rememberLayer(layer, key) {
  const all = rememberedLayers();
  if (key) all[layer] = key;
  else delete all[layer];
  try { localStorage.setItem(LAYER_MAP_KEY, JSON.stringify(all)); } catch (e) { /* chế độ riêng tư */ }
}

function fileKind(f) {
  if (/\.dxf$/i.test(f.name)) return 'dxf';
  if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') return 'pdf';
  if (/\.(jpe?g|png|webp)$/i.test(f.name) || /^image\/(jpeg|png|webp)$/.test(f.type)) return 'image';
  return '';
}

// ============================ XEM TRƯỚC TRÊN BẢN ĐỒ ============================

function clearPreview() {
  if (preview) { preview.remove(); preview = null; }
  if (scanLayer) { scanLayer.remove(); scanLayer = null; }
}

// Lớp che + lô mới (446) trên lô quy hoạch cũ, dưới ảnh scan (447) và ranh (449)
function ensurePanes() {
  if (!map.getPane(FILL_PANE)) {
    map.createPane(FILL_PANE).style.zIndex = 446;
    map.getPane(FILL_PANE).style.pointerEvents = 'none';
  }
  if (!map.getPane(SCAN_PANE)) {
    map.createPane(SCAN_PANE).style.zIndex = 447;
    map.getPane(SCAN_PANE).style.pointerEvents = 'none';
  }
  if (!map.getPane(LINE_PANE)) map.createPane(LINE_PANE).style.zIndex = 449;
  if (!lineRenderer) lineRenderer = L.svg({ pane: LINE_PANE });
  if (!fillRenderer) fillRenderer = L.canvas({ pane: FILL_PANE });
}

function drawPreview(fit = false) {
  clearPreview();
  if (!map || typeof L === 'undefined' || !record || !kindOn()) return;
  ensurePanes();
  const p = record.payload;
  previewDetailed = map.getZoom() >= TT16_PATTERN_ZOOM;
  preview = L.layerGroup().addTo(map);
  L.geoJSON(p.boundary, { interactive: false, renderer: fillRenderer, style: WIPEOUT_STYLE }).addTo(preview);
  p.lots.forEach(l => {
    L.geoJSON(l.geometry, { interactive: false, renderer: fillRenderer, style: adjustLotStyle(l, previewDetailed) }).addTo(preview);
  });
  const ring = L.geoJSON(p.boundary, {
    interactive: false, renderer: lineRenderer, style: { color: RANH, weight: 2, dashArray: '3 3', dashOffset: '3', fill: false }
  }).addTo(preview);
  if (scan && scan.georef && ScanOverlay) {
    scanLayer = new ScanOverlay(scan.url, cornersOf(scan.georef), { pane: SCAN_PANE, opacity: 1 - transparency / 100 }).addTo(map);
  }
  if (fit) {
    const b = ring.getBounds();
    if (b.isValid()) map.fitBounds(b, { maxZoom: 18, padding: [40, 40] });
  }
}

// ============================ GIAO DIỆN ============================

function fillProjects() {
  const sel = $('adjProject');
  if (!sel) return;
  const cur = sel.value || $('cadPair')?.value || '';
  const all = (state.projectCatalog || []).filter(p => p && p.tenQH);
  const drawable = all.filter(p => !p.sheetOnly);
  const list = [...new Set((drawable.length ? drawable : all).map(p => p.tenQH))].sort((a, b) => a.localeCompare(b, 'vi'));
  sel.innerHTML = `<option value="">Chọn đồ án quy hoạch</option>${list.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}`;
  if (cur && list.includes(cur)) sel.value = cur;
}

function row(kind, label, f, status, extra = '') {
  return `<div class="adj-file">
    <span class="adj-file-kind">${label}</span>
    <span class="adj-file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
    <button type="button" class="adj-file-del" data-adj-imp="del" data-kind="${kind}" title="Bỏ file">×</button>
    <span class="adj-file-status">${status}</span>
    ${extra}
  </div>`;
}

function dxfStatus() {
  if (!$('adjProject')?.value) return '<span class="adj-warn">Chọn đồ án được điều chỉnh</span>';
  if (reading) return 'Đang đọc ranh và lô đất…';
  if (recordError) return `<span class="adj-bad">${escapeHtml(recordError)}</span>`;
  if (!record) return '';
  const notes = [`Ranh ${fmtNum(Math.round(record.area / 100) / 100)} ha · ${fmtNum(record.payload.lots.length)} lô mới`];
  if (record.unknown) notes.push(`<span class="adj-warn">${record.unknown} lô chưa có loại đất — chọn ở bảng layer</span>`);
  if (record.loose) notes.push('<span class="adj-warn">đồ án chưa có ranh, kiểm tra theo khung bao lô</span>');
  return notes.join(' · ');
}

const LAND_OPTIONS = TT16_LAND_KEYS.map(k => [k, TT16_STYLES[k].label]);

// Mỗi layer hatch một dòng: ô mẫu ký hiệu đang dùng, số lô / diện tích, ô chọn loại đất (để trống = tự nhận theo tên)
function layerTableHtml() {
  if (!record || reading || !record.layers?.length) return '';
  const rows = record.layers.map((g, i) => {
    const picked = TT16_STYLES[overrides[g.layer]] ? overrides[g.layer] : '';
    const key = picked || g.auto;
    const sw = key ? tt16SwatchCss(key, 0.7) || `background:${TT16_STYLES[key].color};` : '';
    const autoText = g.auto ? `Tự nhận: ${TT16_STYLES[g.auto].label}` : '— Chọn loại đất —';
    const opts = LAND_OPTIONS.map(([k, label]) => `<option value="${k}"${k === picked ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
    return `<div class="adj-layer${key ? '' : ' is-unknown'}">
      <i class="adj-layer-sw" style="${sw}"></i>
      <span class="adj-layer-name" title="${escapeHtml(g.layer)}">${escapeHtml(g.layer)}</span>
      <small>${fmtNum(g.count)} lô · ${fmtNum(Math.round(g.area))} m²</small>
      <select data-adj-layer="${i}" aria-label="Loại đất của layer ${escapeHtml(g.layer)}"${picked ? ' class="is-manual"' : ''}>
        <option value="">${escapeHtml(autoText)}</option>${opts}</select>
    </div>`;
  }).join('');
  const bad = record.layers.filter(g => !g.auto && !overrides[g.layer]).length;
  return `<div class="adj-layers">
    <div class="adj-layers-head">Layer DXF → loại đất${bad ? ` · <span class="adj-warn">${bad} layer chưa nhận</span>` : ''}</div>${rows}</div>`;
}

function setLayerKey(idx, key) {
  const g = record?.layers?.[idx];
  if (!g) return;
  if (key) overrides[g.layer] = key;
  else delete overrides[g.layer];
  rememberLayer(g.layer, key);
  const out = record.build(overrides);
  record.payload = out.payload;
  record.unknown = out.unknown;
  render();
  drawPreview();
}

function imageStatus() {
  if (preparing) return 'Đang chuẩn bị ảnh…';
  if (!scan) return '';
  const size = `${fmtNum(scan.w)}×${fmtNum(scan.h)} px · ${sizeText(scan.blob.size)}`;
  if (!scan.georef) return `${size} · <span class="adj-warn">chưa định vị</span>`;
  const g = scan.georef;
  const how = g.mode === 'fit' ? 'kéo, xoay khớp ranh'
    : g.rms > 0 ? `RMS ${fmtNum(Math.round(g.rms * 10) / 10)} m` : `${g.gcps.length} điểm`;
  return `${size} · <span class="adj-ok">đã định vị (${how})</span>`;
}

function imageExtra() {
  if (!scan) return '';
  const btn = `<button type="button" class="bp-btn${scan.georef ? '' : ' adj-primary'}" data-adj-imp="georef" ${record ? '' : 'disabled title="Đọc DXF xong mới ghép ảnh vào ranh được"'}>${ico('pin')}${scan.georef ? 'Chỉnh lại vị trí ảnh' : 'Đặt ảnh vào ranh'}</button>`;
  const op = scan.georef
    ? `<label class="adj-file-op">Độ trong suốt <input type="range" min="0" max="100" step="5" value="${transparency}" data-adj-imp="op"><output>${transparency}%</output></label>`
    : '';
  return `<div class="adj-file-act">${btn}${op}</div>`;
}

function canSubmit() {
  return !!record && !reading && !preparing && !submitting && (!files.image || !!(scan && scan.georef));
}

function render() {
  const box = $('adjFileList');
  if (box) {
    const rows = [];
    if (files.dxf) rows.push(row('dxf', 'DXF', files.dxf, dxfStatus(), layerTableHtml()));
    if (files.image) rows.push(row('image', 'Ảnh', files.image, imageStatus(), imageExtra()));
    if (files.pdf) rows.push(row('pdf', 'PDF', files.pdf, sizeText(files.pdf.size)));
    box.innerHTML = rows.join('');
  }
  const admin = isAdmin();
  const guest = $('adjGuest');
  if (guest) guest.hidden = admin;
  const btn = $('btnAdjSubmit');
  if (btn) {
    btn.disabled = !canSubmit();
    btn.innerHTML = submitting ? `${ico('send')}ĐANG GỬI…`
      : admin ? `${ico('save')}GHI HỒ SƠ ĐIỀU CHỈNH (ADMIN)` : `${ico('send')}GỬI HỒ SƠ CHỜ DUYỆT`;
  }
  const title = $('adjTitle');
  if (title) title.placeholder = record ? record.payload.title : 'Để trống: tự đặt theo ký hiệu lô';
  const status = $('adjStatus');
  if (status) {
    let msg = '';
    if (!files.dxf) msg = 'Thêm file DXF của hồ sơ điều chỉnh.';
    else if (files.image && scan && !scan.georef && record) msg = 'Bấm «Đặt ảnh vào ranh» rồi kéo, xoay ảnh cho khung bản vẽ đã phê duyệt trùng ranh điều chỉnh, hoặc bỏ ảnh.';
    status.textContent = msg;
  }
}

// ============================ XỬ LÝ FILE ============================

async function readRecord() {
  const seq = ++readSeq;
  record = null;
  recordError = '';
  const name = $('adjProject')?.value || '';
  if (!files.dxf || !name) { reading = false; render(); drawPreview(); return; }
  reading = true;
  render();
  try {
    const crs = CRS_PRESETS[$('adjCrs')?.value] || CRS_PRESETS.HUE_3;
    const saved = rememberedLayers();
    const out = await adjustRecordFromDxf(files.dxf, { name, crs, overrides: saved });
    if (seq !== readSeq) return;
    overrides = Object.fromEntries(out.layers.filter(g => TT16_STYLES[saved[g.layer]]).map(g => [g.layer, saved[g.layer]]));
    record = out;
  } catch (err) {
    if (seq !== readSeq) return;
    recordError = err.message || 'Không đọc được DXF';
  }
  reading = false;
  render();
  drawPreview(true);
}

function dropScan() {
  if (scan) URL.revokeObjectURL(scan.url);
  scan = null;
}

async function setImage(f) {
  const seq = ++prepSeq;
  dropScan();
  files.image = f;
  preparing = true;
  render();
  try {
    const prep = await prepareScan(f);
    if (seq !== prepSeq) return;
    scan = { ...prep, name: f.name, url: URL.createObjectURL(prep.blob), georef: null };
  } catch (err) {
    if (seq !== prepSeq) return;
    files.image = null;
    showToast(`Không đọc được ảnh scan: ${err.message}`, 'error');
  }
  preparing = false;
  render();
  drawPreview();
}

function addFiles(list) {
  let dxfChanged = false;
  [...(list || [])].forEach(f => {
    const kind = fileKind(f);
    if (kind === 'dxf') { files.dxf = f; dxfChanged = true; }
    else if (kind === 'pdf') {
      const bad = pdfProblem(f);
      if (bad) showToast(bad, 'error');
      else files.pdf = f;
    } else if (kind === 'image') {
      const bad = scanProblem(f);
      if (bad) showToast(bad, 'error');
      else setImage(f);
    } else showToast(`Bỏ qua ${f.name}: chỉ nhận DXF, ảnh JPG/PNG/WebP và PDF`, 'error');
  });
  if (dxfChanged) readRecord();
  else render();
}

function removeFile(kind) {
  files[kind] = null;
  if (kind === 'image') { prepSeq++; dropScan(); preparing = false; drawPreview(); }
  if (kind === 'dxf') { readSeq++; record = null; overrides = {}; recordError = ''; reading = false; clearPreview(); }
  render();
}

async function georef() {
  if (!scan || !record) return;
  const g = await openGeoref({
    url: scan.url, w: scan.w, h: scan.h, boundary: record.payload.boundary,
    title: $('adjTitle')?.value.trim() || record.payload.title, initial: scan.georef
  });
  if (g && scan) scan.georef = g;
  render();
  drawPreview();
}

function reset() {
  readSeq++;
  prepSeq++;
  dropScan();
  files = { dxf: null, image: null, pdf: null };
  record = null;
  overrides = {};
  recordError = '';
  reading = preparing = false;
  ['adjTitle', 'adjNote'].forEach(id => { const el = $(id); if (el) el.value = ''; });
  clearPreview();
  render();
}

async function submit() {
  if (!canSubmit()) return;
  const admin = isAdmin();
  const sender = $('adjSender')?.value.trim() || '';
  if (!admin && !sender) { showToast('Nhập tên người gửi / đơn vị', 'error'); $('adjSender')?.focus(); return; }
  submitting = true;
  render();
  showToast(admin ? '⏳ Đang ghi hồ sơ điều chỉnh...' : '⏳ Đang gửi hồ sơ điều chỉnh...');
  try {
    const title = $('adjTitle')?.value.trim();
    const payload = { ...record.payload, ...(title ? { title } : {}), sender, note: $('adjNote')?.value.trim() || '' };
    const scanPart = scan && scan.georef ? { blob: scan.blob, name: scan.name, georef: scan.georef } : null;
    const out = await sendAdjustment(payload, files.pdf, scanPart);
    showToast(out.approved ? '✓ Đã ghi hồ sơ điều chỉnh lên bản đồ quy hoạch' : '✓ Đã gửi hồ sơ, chờ Admin duyệt', 'success');
    if (out.pdfError) showToast(`Hồ sơ đã lưu nhưng chưa gắn được PDF: ${out.pdfError}`, 'error');
    if (out.scanError) showToast(`Hồ sơ đã lưu nhưng chưa gắn được ảnh scan: ${out.scanError}`, 'error');
    submitting = false;
    reset();
  } catch (err) {
    showToast(`Không nhập được hồ sơ: ${err.message}`, 'error');
  } finally {
    submitting = false;
    render();
  }
}

function syncKind() {
  const on = kindOn();
  $('addBulk')?.classList.toggle('bulk-adjust', on);
  if (on) { fillProjects(); drawPreview(); } else clearPreview();
  render();
}

export function initAdjustImport() {
  document.querySelectorAll('input[name="bulkKind"]').forEach(r => r.addEventListener('change', syncKind));
  $('adjProject')?.addEventListener('focus', fillProjects);
  $('adjProject')?.addEventListener('change', readRecord);
  $('adjCrs')?.addEventListener('change', readRecord);
  $('adjFiles')?.addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  const drop = $('adjDrop');
  if (drop) {
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  }
  const list = $('adjFileList');
  list?.addEventListener('click', (e) => {
    const el = e.target.closest('[data-adj-imp]');
    if (!el) return;
    if (el.dataset.adjImp === 'del') removeFile(el.dataset.kind);
    else if (el.dataset.adjImp === 'georef') georef();
  });
  list?.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-adj-layer]');
    if (sel) setLayerKey(Number(sel.dataset.adjLayer), sel.value);
  });
  map?.on('zoomend', () => {
    if (preview && (map.getZoom() >= TT16_PATTERN_ZOOM) !== previewDetailed) drawPreview();
  });
  list?.addEventListener('input', (e) => {
    const r = e.target.closest('[data-adj-imp="op"]');
    if (!r) return;
    transparency = Number(r.value) || 0;
    const out = r.parentElement.querySelector('output');
    if (out) out.textContent = `${transparency}%`;
    scanLayer?.setOpacity(1 - transparency / 100);
  });
  $('btnAdjSubmit')?.addEventListener('click', submit);
  document.addEventListener('auth:change', render);
  syncKind();
}
