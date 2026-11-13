// Ảnh scan bản vẽ sử dụng đất dưới lớp lô SDD đồ án. Chỉ Admin thêm/sửa; nhiều tờ ≤ 5 MB.
// Auto crop lề trắng + stretch khít ranh trong prepareSchemeScan / openGeoref(tightFit).
import { state } from './state.js';
import { map, PARCEL_MIN_ZOOM } from './mapEngine.js';
import { geeApi, gcsUrl } from './api.js';
import { escapeHtml, fmtNum, ico, showToast } from './utils.js';
import { ScanOverlay, cornersOf, openGeoref, prepareSchemeScan, scanProblem, SDD_SCAN_MAX_BYTES } from './scanGeoref.js';
import { PROJECT_INFO_EVENT } from './projectFiles.js';
import { PROJECT_UNFOCUS_EVENT } from './projectLayer.js';

const PANE = 'schemeSddScanPane';
const PANE_Z = 392;
const MAX_ITEMS = 8;

const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;

let openName = '';
let openSlug = '';
let items = [];
let layers = new Map(); // id → ScanOverlay
let busy = false;

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (state.authToken) h.Authorization = `Bearer ${state.authToken}`;
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

function ensurePane(m) {
  if (!m) return null;
  const pane = m.getPane(PANE) || m.createPane(PANE);
  pane.style.zIndex = String(PANE_Z);
  pane.style.pointerEvents = 'none';
  return pane;
}

function clearLayers() {
  layers.forEach(layer => { try { layer.remove(); } catch (e) { /* */ } });
  layers.clear();
}

function scanUrl(it) {
  if (it.url && /^https?:/i.test(it.url)) return it.url;
  if (it.object) return `${gcsUrl(it.object)}?v=${it.at || 0}`;
  return it.url || '';
}

function paintLayers() {
  const m = map;
  clearLayers();
  if (!m || !items.length) return;
  if (m.getZoom() < PARCEL_MIN_ZOOM) return;
  ensurePane(m);
  items.forEach(it => {
    if (it.on === false || !it.tl || !it.tr || !it.bl) return;
    const url = scanUrl(it);
    if (!url || !ScanOverlay) return;
    const layer = new ScanOverlay(url, cornersOf(it), {
      pane: PANE,
      opacity: it.opacity == null ? 0.75 : Number(it.opacity)
    }).addTo(m);
    layers.set(it.id, layer);
  });
}

async function loadFor(name, slug) {
  openName = name || '';
  openSlug = slug || '';
  items = [];
  clearLayers();
  if (!openName && !openSlug) return;
  try {
    const q = openSlug
      ? `action=getSchemeSddScans&slug=${encodeURIComponent(openSlug)}`
      : `action=getSchemeSddScans&tenQH=${encodeURIComponent(openName)}`;
    const data = await readJsonResponse(await fetch(geeApi(q), { cache: 'no-store' }));
    openSlug = data.slug || openSlug;
    openName = data.tenQH || openName;
    items = Array.isArray(data.items) ? data.items : [];
    paintLayers();
  } catch (err) {
    items = [];
    console.warn('Không tải scan SDD:', err.message);
  }
  renderBriefSlot();
}

function sizeText(n) {
  if (!(n > 0)) return '';
  if (n < 1024 * 1024) return `${fmtNum(Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function rowHtml(it, i) {
  const label = escapeHtml(it.label || `Tờ ${i + 1}`);
  const meta = [sizeText(it.bytes), it.w && it.h ? `${fmtNum(it.w)}×${fmtNum(it.h)}` : ''].filter(Boolean).join(' · ');
  const on = it.on !== false;
  const admin = isAdmin();
  const check = admin
    ? `<label class="sdd-scan-on" title="Hiện trên bản đồ"><input type="checkbox" data-sdd-act="toggle" ${on ? 'checked' : ''}> ${label}</label>`
    : `<span class="sdd-scan-on">${label}</span>`;
  const tools = admin
    ? `<span class="sdd-scan-tools">
      <button type="button" class="project-btn" data-sdd-act="georef" title="Định vị lại">${ico('pin')}</button>
      <button type="button" class="project-btn" data-sdd-act="del" title="Xóa tờ">${ico('trash')}</button>
    </span>`
    : '';
  return `<div class="sdd-scan-row" data-sdd-id="${escapeHtml(it.id)}">
    ${check}
    <span class="sdd-scan-meta">${escapeHtml(meta)}</span>
    ${tools}
  </div>`;
}

export function sddScanBriefHtml() {
  if (!openName && !openSlug) return '<div class="sdd-scan-block" id="sddScanBlock" hidden></div>';
  const admin = isAdmin();
  const list = items.length
    ? items.map((it, i) => rowHtml(it, i)).join('')
    : '<p class="sdd-scan-empty">Chưa có ảnh scan bản vẽ SDD.</p>';
  const add = admin
    ? `<label class="bp-btn adj-primary sdd-scan-add"${busy || items.length >= MAX_ITEMS ? ' aria-disabled="true"' : ''}>
        ${ico('plus')}Thêm tờ
        <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" ${busy || items.length >= MAX_ITEMS ? 'disabled' : ''}>
      </label>`
    : '';
  const note = admin
    ? `<p class="sdd-scan-note">JPG/PNG/WebP ≤ 5 MB/tờ (sau cắt lề trắng). PDF: xuất JPG (vd. iLovePDF) rồi chọn file. Tối đa ${MAX_ITEMS} tờ.</p>`
    : (items.length ? '' : '');
  if (!admin && !items.length) return '<div class="sdd-scan-block" id="sddScanBlock" hidden></div>';
  return `<div class="sdd-scan-block" id="sddScanBlock">
    <h5 class="sdd-scan-h">Bản vẽ SDD (scan)</h5>
    ${list}${add}${note}
  </div>`;
}

function renderBriefSlot() {
  const host = document.getElementById('sddScanBlock');
  if (!host) return;
  host.outerHTML = sddScanBriefHtml();
}

/** Gọi từ projectBrief sau khi vẽ detail — đồng bộ khối scan với đồ án đang mở. */
export function syncSddScanBrief(name) {
  if (!name) {
    openName = '';
    openSlug = '';
    items = [];
    clearLayers();
    renderBriefSlot();
    return;
  }
  if (name === openName) {
    renderBriefSlot();
    return;
  }
  loadFor(name, slugOfName(name));
}

function boundaryOfOpen() {
  const entry = (state.projectCatalog || []).find(p => p && (p.tenQH === openName || p.slug === openSlug));
  return entry && entry.boundary ? entry.boundary : null;
}

async function putScan({ id, blob, name, georef, label, opacity, on }) {
  const body = {
    slug: openSlug || undefined,
    tenQH: openName || undefined,
    id: id || undefined,
    name: name || '',
    georef,
    label,
    opacity,
    on
  };
  if (blob) body.image = await fileBase64(blob);
  const out = await readJsonResponse(await fetch(geeApi('action=putSchemeSddScan'), {
    method: 'POST', headers: headers(), body: JSON.stringify(body)
  }));
  return out.scan;
}

async function addSheet(file) {
  if (!isAdmin() || busy) return;
  const bad = scanProblem(file);
  if (bad) { showToast(bad, 'error'); return; }
  if (items.length >= MAX_ITEMS) { showToast(`Tối đa ${MAX_ITEMS} tờ`, 'error'); return; }
  busy = true;
  renderBriefSlot();
  showToast('Đang cắt lề trắng và nén ảnh…', 'info');
  try {
    const prep = await prepareSchemeScan(file);
    if (prep.blob.size > SDD_SCAN_MAX_BYTES) throw new Error('Ảnh sau nén vẫn lớn hơn 5 MB');
    const url = URL.createObjectURL(prep.blob);
    let georef;
    try {
      georef = await openGeoref({
        url, w: prep.w, h: prep.h,
        boundary: boundaryOfOpen(),
        title: openName || openSlug,
        tightFit: true
      });
    } finally {
      URL.revokeObjectURL(url);
    }
    if (!georef) return;
    showToast(prep.cropped ? 'Đã cắt lề trắng — đang lưu…' : 'Đang lưu…', 'info');
    const scan = await putScan({
      blob: prep.blob,
      name: file.name,
      georef,
      label: `Tờ ${items.length + 1}`,
      opacity: 0.75,
      on: true
    });
    items = items.filter(x => x.id !== scan.id).concat([scan]);
    paintLayers();
    showToast('Đã thêm tờ scan SDD', 'success');
  } catch (err) {
    showToast(err.message || 'Không thêm được tờ scan', 'error');
  } finally {
    busy = false;
    renderBriefSlot();
  }
}

async function georefAgain(id) {
  if (!isAdmin() || busy) return;
  const it = items.find(x => x.id === id);
  if (!it) return;
  busy = true;
  try {
    const src = scanUrl(it);
    const georef = await openGeoref({
      url: src, w: it.w, h: it.h,
      boundary: boundaryOfOpen(),
      title: it.label || openName,
      initial: it,
      tightFit: true
    });
    if (!georef) return;
    const scan = await putScan({ id, georef, opacity: it.opacity, on: it.on, label: it.label });
    items = items.map(x => (x.id === id ? scan : x));
    paintLayers();
    showToast('Đã cập nhật định vị', 'success');
  } catch (err) {
    showToast(err.message || 'Không định vị lại được', 'error');
  } finally {
    busy = false;
    renderBriefSlot();
  }
}

async function removeSheet(id) {
  if (!isAdmin() || busy) return;
  if (!confirm('Xóa tờ scan SDD này?')) return;
  busy = true;
  try {
    await readJsonResponse(await fetch(geeApi('action=deleteSchemeSddScan'), {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ slug: openSlug, tenQH: openName, id })
    }));
    items = items.filter(x => x.id !== id);
    paintLayers();
    showToast('Đã xóa tờ scan', 'success');
  } catch (err) {
    showToast(err.message || 'Không xóa được', 'error');
  } finally {
    busy = false;
    renderBriefSlot();
  }
}

async function toggleSheet(id, on) {
  if (!isAdmin()) return;
  const it = items.find(x => x.id === id);
  if (!it) return;
  try {
    const scan = await putScan({ id, on, opacity: it.opacity, label: it.label });
    items = items.map(x => (x.id === id ? scan : x));
    paintLayers();
  } catch (err) {
    showToast(err.message || 'Không cập nhật được', 'error');
    renderBriefSlot();
  }
}

function onBriefClick(e) {
  const block = e.target.closest('#sddScanBlock');
  if (!block) return;
  if (e.target.closest('input[type="file"]')) return;
  const btn = e.target.closest('[data-sdd-act]');
  if (!btn || btn.matches('input[type="checkbox"]')) return;
  const row = btn.closest('[data-sdd-id]');
  const id = row && row.getAttribute('data-sdd-id');
  const act = btn.dataset.sddAct || btn.getAttribute('data-sdd-act');
  if (act === 'georef' && id) georefAgain(id);
  else if (act === 'del' && id) removeSheet(id);
}

function onBriefChange(e) {
  const block = e.target.closest('#sddScanBlock');
  if (!block) return;
  if (e.target.matches('input[type="checkbox"][data-sdd-act="toggle"]')) {
    const row = e.target.closest('[data-sdd-id]');
    const id = row && row.getAttribute('data-sdd-id');
    if (id) toggleSheet(id, e.target.checked);
    return;
  }
  const input = e.target.closest('input[type="file"]');
  if (!input || !input.files || !input.files[0]) return;
  const file = input.files[0];
  input.value = '';
  addSheet(file);
}

function slugOfName(name) {
  const entry = (state.projectCatalog || []).find(p => p && p.tenQH === name);
  return entry && entry.slug ? entry.slug : '';
}

export function initSchemeSddScan() {
  document.addEventListener(PROJECT_INFO_EVENT, (e) => {
    const name = typeof e.detail === 'string' ? e.detail : (e.detail && e.detail.name) || '';
    if (!name) return;
    loadFor(name, slugOfName(name));
  });
  document.addEventListener(PROJECT_UNFOCUS_EVENT, () => {
    openName = '';
    openSlug = '';
    items = [];
    clearLayers();
  });
  document.addEventListener('click', onBriefClick);
  document.addEventListener('change', onBriefChange);
  if (map) map.on('zoomend', () => paintLayers());
}
