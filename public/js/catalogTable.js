// Bảng danh mục độc lập: trục B mở đồ án quy hoạch; trục F mở dự án đầu tư (không chung tab nguồn).
// Dùng #bottomPanel + bottom-max; không gọi Cloud Run mới.
import { state } from './state.js';
import { escapeHtml, ico, showToast, loadHtml2Pdf, inlineSpriteIcons } from './utils.js';
import {
  setBottomPanelCollapsed, toggleBottomPanelMaximized
} from './uiComponents.js';
import { loadCatalog } from './projectFiles.js';
import { openProjectByName } from './projectLayer.js';
import { getLevel } from './mapLevel.js';
import {
  listInvestCatalogItems, focusInvest, primeInvestLoad, ensureInvestCatalogLoaded
} from './investLayer.js';
import {
  planRowsFromCatalog, investRowsFromItems, filterCatalogRows,
  catalogFilterOptions, filterKeyFromMapLevel, rowsToCsv, downloadCsv
} from './catalogTableCore.js';

const $ = (id) => document.getElementById(id);

let source = 'plan';
let filterLevel = '';
let query = '';
let rowsCache = [];
let visibleRows = [];
let pdfBusy = false;
let ready = false;

function host() { return $('catalogTableHost'); }

function setCatalogMode(on) {
  document.body.classList.toggle('catalog-table-on', !!on);
  const el = host();
  if (el) el.hidden = !on;
}

function syncMaxBtn() {
  const btn = $('btnCatalogMax');
  if (!btn) return;
  const max = document.body.classList.contains('bottom-max');
  btn.innerHTML = ico(max ? 'minimize' : 'maximize');
  btn.title = max ? 'Thu về 1/5 màn hình' : 'Phóng to toàn màn hình';
  btn.setAttribute('aria-label', btn.title);
}

function paintChrome() {
  const title = $('catalogTableTitle');
  const colName = $('catalogColName');
  const colScale = $('catalogColScale');
  if (source === 'invest') {
    if (title) title.textContent = 'DANH MỤC DỰ ÁN ĐẦU TƯ';
    if (colName) colName.textContent = 'Tên dự án';
    if (colScale) colScale.textContent = 'Quy mô';
  } else {
    if (title) title.textContent = 'DANH MỤC ĐỒ ÁN QUY HOẠCH';
    if (colName) colName.textContent = 'Tên quy hoạch';
    if (colScale) colScale.textContent = 'Cấp';
  }
}

function paintFilterOptions() {
  const sel = $('catalogFilter');
  if (!sel) return;
  const opts = catalogFilterOptions(source);
  const cur = filterLevel;
  sel.innerHTML = opts.map(o =>
    `<option value="${escapeHtml(o.value)}"${o.value === cur ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
  ).join('');
  if (![...sel.options].some(o => o.value === cur)) {
    filterLevel = '';
    sel.value = '';
  }
}

async function ensureData() {
  if (source === 'plan') {
    if (!state.projectCatalog?.length) {
      try { await loadCatalog(); } catch (err) {
        showToast(`Chưa tải được danh mục đồ án: ${err.message}`, 'error');
      }
    }
    rowsCache = planRowsFromCatalog(state.projectCatalog);
    return;
  }
  primeInvestLoad();
  await ensureInvestCatalogLoaded();
  rowsCache = investRowsFromItems(listInvestCatalogItems());
}

function paintTable() {
  visibleRows = filterCatalogRows(rowsCache, { query, level: filterLevel });
  const body = $('catalogTableBody');
  const count = $('catalogCount');
  const unit = source === 'invest' ? 'dự án' : 'đồ án';
  if (count) count.textContent = `${visibleRows.length} / ${rowsCache.length} ${unit}`;
  if (!body) return;
  if (!visibleRows.length) {
    body.innerHTML = `<tr><td colspan="6" class="catalog-empty">Không có dòng khớp bộ lọc.</td></tr>`;
    return;
  }
  body.innerHTML = visibleRows.map((r, i) => {
    const bound = r.hasBoundary
      ? `<button type="button" class="catalog-bound-yes" data-catalog-zoom="${escapeHtml(r.zoomKey)}" title="Phóng tới ranh giới">Có</button>`
      : `<span class="catalog-bound-no">Chưa</span>`;
    return `<tr data-catalog-id="${escapeHtml(r.id)}">
      <td class="catalog-stt">${i + 1}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.ward || '—')}</td>
      <td>${escapeHtml(r.scale || '—')}</td>
      <td>${bound}</td>
      <td>${escapeHtml(r.note || '')}</td>
    </tr>`;
  }).join('');
}

async function refresh() {
  paintChrome();
  paintFilterOptions();
  await ensureData();
  paintTable();
}

export async function openCatalogTable(opts = {}) {
  source = opts.source === 'invest' ? 'invest' : 'plan';
  query = '';
  const search = $('catalogSearch');
  if (search) search.value = '';
  if (source === 'plan') {
    filterLevel = opts.level != null ? String(opts.level) : filterKeyFromMapLevel(getLevel());
  } else {
    filterLevel = opts.group != null
      ? String(opts.group)
      : (document.querySelector('#levelPickDt .level-pick-btn.is-on')?.dataset?.dtTab || '');
  }
  setCatalogMode(true);
  setBottomPanelCollapsed(false);
  await refresh();
  syncMaxBtn();
}

export function closeCatalogTable() {
  if (!document.body.classList.contains('catalog-table-on')) return;
  setCatalogMode(false);
  syncMaxBtn();
}

function exportCsv() {
  if (!visibleRows.length) {
    showToast('Không có dòng để xuất CSV', 'info');
    return;
  }
  const name = source === 'invest' ? 'danh-muc-du-an-dau-tu.csv' : 'danh-muc-do-an-quy-hoach.csv';
  downloadCsv(name, rowsToCsv(visibleRows, source));
}

async function exportPdf() {
  const scroll = $('catalogTableScroll');
  if (!scroll || pdfBusy) return;
  if (!visibleRows.length) {
    showToast('Không có dòng để xuất PDF', 'info');
    return;
  }
  pdfBusy = true;
  try {
    await loadHtml2Pdf();
  } catch {
    pdfBusy = false;
    showToast('Không tải được thư viện xuất PDF', 'error');
    return;
  }
  const fileName = source === 'invest' ? 'Danh-muc-du-an-dau-tu.pdf' : 'Danh-muc-do-an-quy-hoach.pdf';
  const done = () => { pdfBusy = false; };
  window.html2pdf().from(scroll).set({
    margin: 8,
    filename: fileName,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, scrollY: 0, onclone: inlineSpriteIcons },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
  }).save().then(done, done);
}

async function onZoom(key) {
  if (!key) return;
  if (source === 'plan') {
    const ok = openProjectByName(key);
    if (!ok) showToast('Chưa phóng được tới đồ án (thiếu ranh hoặc chưa tải catalog)', 'info');
    return;
  }
  try {
    await focusInvest(key);
  } catch {
    showToast('Chưa phóng được tới dự án', 'info');
  }
}

export function initCatalogTable() {
  if (ready) return;
  ready = true;
  $('btnOpenCatalogPlan')?.addEventListener('click', () => {
    void openCatalogTable({ source: 'plan' });
  });
  $('btnOpenCatalogInvest')?.addEventListener('click', () => {
    void openCatalogTable({ source: 'invest' });
  });
  $('catalogSearch')?.addEventListener('input', (e) => {
    query = e.target.value || '';
    paintTable();
  });
  $('catalogFilter')?.addEventListener('change', (e) => {
    filterLevel = e.target.value || '';
    paintTable();
  });
  $('btnCatalogExportCsv')?.addEventListener('click', exportCsv);
  $('btnCatalogExportPdf')?.addEventListener('click', () => { void exportPdf(); });
  $('btnCatalogMax')?.addEventListener('click', () => {
    toggleBottomPanelMaximized();
    syncMaxBtn();
  });
  $('btnCatalogClose')?.addEventListener('click', () => {
    closeCatalogTable();
    setBottomPanelCollapsed(true);
  });
  $('catalogTableBody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-catalog-zoom]');
    if (!btn) return;
    void onZoom(btn.dataset.catalogZoom);
  });
  document.getElementById('btnExpandBottomPanel')?.addEventListener('click', () => {
    if (document.body.classList.contains('catalog-table-on')) closeCatalogTable();
  });
  document.getElementById('btnCollapseBottomPanel')?.addEventListener('click', () => {
    closeCatalogTable();
  });
}
