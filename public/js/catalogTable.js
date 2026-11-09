// Bảng danh mục độc lập: trục B mở đồ án quy hoạch (sổ tay + đối soát bản đồ); trục F mở dự án đầu tư.
import { state } from './state.js';
import { escapeHtml, ico, showToast, loadHtml2Pdf, inlineSpriteIcons } from './utils.js';
import {
  setBottomPanelCollapsed, toggleBottomPanelMaximized
} from './uiComponents.js';
import { loadCatalog, projectAreaOf } from './projectFiles.js';
import { openProjectByName } from './projectLayer.js';
import {
  listInvestCatalogItems, focusInvest, primeInvestLoad, ensureInvestCatalogLoaded
} from './investLayer.js';
import {
  planRowsFromSoTay, investRowsFromItems, filterCatalogRows,
  catalogFilterOptions, catalogStatusOptions, catalogStatusStats, catalogWardLevelStats,
  rowsToCsv, downloadCsv, STATUS
} from './catalogTableCore.js';

const $ = (id) => document.getElementById(id);
/* ?v= đổi khi rebuild catalog để trình duyệt/SW không giữ bản JSON cũ. */
const SO_TAY_URL = './data/qh-so-tay.json?v=20261108a';

let source = 'plan';
let filterLevel = '';
let filterStatus = '';
let query = '';
let rowsCache = [];
let visibleRows = [];
let soTayItems = null;
let soTayPromise = null;
let pdfBusy = false;
let ready = false;
let statusChart = null;
let levelChart = null;
let wardChart = null;

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
  const statusFilter = $('catalogStatusFilter');
  const charts = $('catalogCharts');
  const planOnly = source === 'plan';
  if (statusFilter) statusFilter.hidden = !planOnly;
  if (charts) charts.hidden = !planOnly;
  if (source === 'invest') {
    if (title) title.textContent = 'DANH MỤC DỰ ÁN ĐẦU TƯ';
    if (colName) colName.textContent = 'Tên dự án';
    if (colScale) colScale.textContent = 'Quy mô';
  } else {
    if (title) title.textContent = 'DANH MỤC ĐỒ ÁN QUY HOẠCH';
    if (colName) colName.textContent = 'Tên quy hoạch';
    if (colScale) colScale.textContent = 'Cấp';
  }
  syncPlanColumns(planOnly);
}

function syncPlanColumns(planOnly) {
  const table = $('catalogTable');
  if (!table) return;
  table.classList.toggle('catalog-plan-mode', !!planOnly);
  const head = table.querySelector('thead tr');
  if (!head) return;
  if (planOnly) {
    head.innerHTML = `<th>STT</th>
      <th id="catalogColName">Tên quy hoạch</th>
      <th>Đơn vị</th>
      <th id="catalogColScale">Cấp</th>
      <th>Diện tích</th>
      <th>Trạng thái</th>
      <th>Ranh</th>
      <th>Ghi chú</th>`;
  } else {
    head.innerHTML = `<th>STT</th>
      <th id="catalogColName">Tên dự án</th>
      <th>Phường / xã</th>
      <th id="catalogColScale">Quy mô</th>
      <th>Ranh giới</th>
      <th>Ghi chú</th>`;
  }
}

function paintFilterOptions() {
  const sel = $('catalogFilter');
  if (sel) {
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
  const st = $('catalogStatusFilter');
  if (st && source === 'plan') {
    const opts = catalogStatusOptions();
    const cur = filterStatus;
    st.innerHTML = opts.map(o =>
      `<option value="${escapeHtml(o.value)}"${o.value === cur ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
    ).join('');
    if (![...st.options].some(o => o.value === cur)) {
      filterStatus = '';
      st.value = '';
    }
  }
}

async function loadSoTay() {
  if (soTayItems) return soTayItems;
  if (soTayPromise) return soTayPromise;
  soTayPromise = fetch(SO_TAY_URL, { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      soTayItems = Array.isArray(data.items) ? data.items : [];
      return soTayItems;
    })
    .catch((err) => {
      console.warn('Không tải được sổ tay QH:', err);
      showToast('Chưa tải được sổ tay đồ án từ sheet — đang hiện danh mục bản đồ', 'info');
      soTayItems = [];
      return soTayItems;
    });
  return soTayPromise;
}

function areaHaOfProject(p) {
  const m2 = projectAreaOf(p.tenQH);
  if (!Number.isFinite(m2) || m2 === Infinity || m2 <= 0) return null;
  return m2 / 10000;
}

async function ensureData() {
  if (source === 'plan') {
    if (!state.projectCatalog?.length) {
      try { await loadCatalog(); } catch (err) {
        showToast(`Chưa tải được danh mục đồ án: ${err.message}`, 'error');
      }
    }
    const sheet = await loadSoTay();
    rowsCache = planRowsFromSoTay(sheet, state.projectCatalog, { areaHaOf: areaHaOfProject });
    return;
  }
  primeInvestLoad();
  await ensureInvestCatalogLoaded();
  rowsCache = investRowsFromItems(listInvestCatalogItems());
}

function statusChip(r) {
  const meta = STATUS[r.status];
  if (!meta) return '—';
  return `<span class="catalog-status catalog-status-${escapeHtml(meta.id)}" title="${escapeHtml(meta.label)}">${escapeHtml(meta.short)}</span>`;
}

function displayName(r) {
  const name = String(r.name || '').trim();
  if (name) return name;
  const full = String(r.fullName || '').trim();
  if (full) return full;
  const ma = String(r.maDoAn || '').trim();
  return ma || '—';
}

function paintTable() {
  visibleRows = filterCatalogRows(rowsCache, {
    query, level: filterLevel, status: source === 'plan' ? filterStatus : ''
  });
  const body = $('catalogTableBody');
  const count = $('catalogCount');
  const unit = source === 'invest' ? 'dự án' : 'đồ án';
  if (count) count.textContent = `${visibleRows.length} / ${rowsCache.length} ${unit}`;
  if (!body) return;
  if (!visibleRows.length) {
    const cols = source === 'plan' ? 8 : 6;
    body.innerHTML = `<tr><td colspan="${cols}" class="catalog-empty st-msg">Không có dòng khớp bộ lọc.</td></tr>`;
    paintCharts();
    return;
  }
  if (source === 'plan') {
    body.innerHTML = visibleRows.map((r, i) => {
      const name = displayName(r);
      const bound = r.hasBoundary
        ? `<button type="button" class="catalog-bound-yes" data-catalog-zoom="${escapeHtml(r.zoomKey)}" title="Phóng tới ranh giới">Có</button>`
        : `<span class="catalog-bound-no">Chưa</span>`;
      return `<tr data-catalog-id="${escapeHtml(r.id)}" data-status="${escapeHtml(r.status || '')}">
        <td class="st-num">${i + 1}</td>
        <td class="st-name" title="${escapeHtml(name)}">${escapeHtml(name)}</td>
        <td class="st-name" title="${escapeHtml(r.ward || '')}">${escapeHtml(r.ward || '—')}</td>
        <td class="catalog-scale">${escapeHtml(r.scale || '—')}</td>
        <td class="catalog-area">${escapeHtml(r.areaText || '—')}</td>
        <td>${statusChip(r)}</td>
        <td>${bound}</td>
        <td class="catalog-note" title="${escapeHtml(r.note || '')}">${escapeHtml(r.note || '')}</td>
      </tr>`;
    }).join('');
  } else {
    body.innerHTML = visibleRows.map((r, i) => {
      const name = displayName(r);
      const bound = r.hasBoundary
        ? `<button type="button" class="catalog-bound-yes" data-catalog-zoom="${escapeHtml(r.zoomKey)}" title="Phóng tới ranh giới">Có</button>`
        : `<span class="catalog-bound-no">Chưa</span>`;
      return `<tr data-catalog-id="${escapeHtml(r.id)}">
        <td class="st-num">${i + 1}</td>
        <td class="st-name" title="${escapeHtml(name)}">${escapeHtml(name)}</td>
        <td class="st-name">${escapeHtml(r.ward || '—')}</td>
        <td class="catalog-scale">${escapeHtml(r.scale || '—')}</td>
        <td>${bound}</td>
        <td class="catalog-note" title="${escapeHtml(r.note || '')}">${escapeHtml(r.note || '')}</td>
      </tr>`;
    }).join('');
  }
  paintCharts();
}

function destroyCharts() {
  if (statusChart) { statusChart.destroy(); statusChart = null; }
  if (levelChart) { levelChart.destroy(); levelChart = null; }
  if (wardChart) { wardChart.destroy(); wardChart = null; }
}

/** Giống shortWardTick ở biểu đồ độ phủ panel dưới: tên dài viết tắt vế sau dấu -. */
function shortWardTick(name) {
  if (name.length <= 13) return name;
  const parts = name.split(/\s*-\s*/);
  if (parts.length < 2) return name;
  const tail = parts.pop().split(' ');
  const last = tail.pop();
  return `${parts.join('-')}-${tail.map((w) => w[0] + '.').join('')}${last}`;
}

function paintCharts() {
  const wrap = $('catalogCharts');
  if (!wrap || source !== 'plan' || typeof Chart === 'undefined') {
    destroyCharts();
    return;
  }
  const stats = catalogStatusStats(rowsCache);
  const wardStats = catalogWardLevelStats(rowsCache);
  const statusOrder = ['du', 'thieu', 'chi_so_tay', 'chi_ban_do'];
  const statusLabels = statusOrder.map((id) => STATUS[id].short);
  const statusColors = statusOrder.map((id) => STATUS[id].color);
  const statusData = statusOrder.map((id) => stats.byStatus[id] || 0);

  const levelOrder = ['QHC', 'QHPK', 'QHCT'];
  const levelLabels = ['QHC', 'QHPK', 'QHCT'];
  const levelColors = ['#38bdf8', '#f59e0b', '#a78bfa'];
  const levelData = levelOrder.map((id) => stats.byLevel[id] || 0);

  const sumEl = $('catalogChartSummary');
  if (sumEl) {
    sumEl.innerHTML = `<b>${stats.total}</b> đồ án ·
      <span class="catalog-sum-ok">${stats.byStatus.du} đủ</span> ·
      <span class="catalog-sum-warn">${stats.byStatus.thieu} thiếu</span> ·
      <span class="catalog-sum-muted">${stats.byStatus.chi_so_tay} chưa lên bản đồ</span> ·
      <span class="catalog-sum-info">${stats.byStatus.chi_ban_do} ngoài sổ tay</span>`;
  }

  const noteEl = $('catalogWardNote');
  if (noteEl) {
    noteEl.textContent = wardStats.unmatched
      ? `${wardStats.unmatched} đồ án chưa gán được vào 40 phường/xã (chỉ có cấp huyện/thị xã cũ hoặc thiếu địa bàn).`
      : '';
  }

  const sCanvas = $('catalogStatusChart');
  const lCanvas = $('catalogLevelChart');
  const wCanvas = $('catalogWardChart');
  if (!sCanvas || !lCanvas || !wCanvas) return;

  const common = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ${ctx.label}: ${ctx.parsed}`
        }
      }
    }
  };

  if (statusChart && statusChart.canvas === sCanvas) {
    statusChart.data.datasets[0].data = statusData;
    statusChart.update();
  } else {
    if (statusChart) statusChart.destroy();
    statusChart = new Chart(sCanvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: statusLabels,
        datasets: [{ data: statusData, backgroundColor: statusColors, borderWidth: 0, hoverOffset: 4 }]
      },
      options: { ...common, cutout: '58%' }
    });
  }

  if (levelChart && levelChart.canvas === lCanvas) {
    levelChart.data.datasets[0].data = levelData;
    levelChart.update();
  } else {
    if (levelChart) levelChart.destroy();
    levelChart = new Chart(lCanvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: levelLabels,
        datasets: [{ data: levelData, backgroundColor: levelColors, borderWidth: 0, hoverOffset: 4 }]
      },
      options: { ...common, cutout: '58%' }
    });
  }

  const wardDatasets = [
    {
      label: 'QHC',
      data: wardStats.qhc,
      backgroundColor: '#38bdf8',
      stack: 'plan',
      barPercentage: 0.9,
      categoryPercentage: 0.85,
      fullNames: wardStats.fullNames
    },
    {
      label: 'QHPK',
      data: wardStats.qhpk,
      backgroundColor: '#f59e0b',
      stack: 'plan',
      barPercentage: 0.9,
      categoryPercentage: 0.85,
      fullNames: wardStats.fullNames
    },
    {
      label: 'QHCT',
      data: wardStats.qhct,
      backgroundColor: '#a78bfa',
      stack: 'plan',
      barPercentage: 0.9,
      categoryPercentage: 0.85,
      fullNames: wardStats.fullNames
    }
  ];

  const tickColor = getComputedStyle(document.documentElement).getPropertyValue('--text-main').trim() || '#cbd5e1';
  const wardOpts = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 8, right: 4, bottom: 2, left: 0 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index',
        intersect: false,
        callbacks: {
          title: (items) => {
            const i = items[0]?.dataIndex ?? 0;
            return wardStats.fullNames[i] || wardStats.labels[i] || '';
          },
          label: (item) => {
            const n = item.parsed.y || 0;
            return ` ${item.dataset.label}: ${n}`;
          },
          footer: (items) => {
            const total = items.reduce((s, it) => s + (it.parsed.y || 0), 0);
            return `Tổng: ${total}`;
          }
        }
      }
    },
    scales: {
      x: {
        stacked: true,
        ticks: {
          autoSkip: false,
          minRotation: 45,
          maxRotation: 45,
          callback(value) {
            return shortWardTick(this.getLabelForValue(value));
          },
          color: tickColor,
          font: { size: 10 }
        },
        grid: { color: 'rgba(255,255,255,0.05)' }
      },
      y: {
        stacked: true,
        beginAtZero: true,
        ticks: {
          color: '#94a3b8',
          precision: 0,
          font: { size: 11 }
        },
        grid: { color: 'rgba(255,255,255,0.05)' }
      }
    }
  };

  if (wardChart && wardChart.canvas === wCanvas) {
    wardChart.data.labels = wardStats.labels;
    wardChart.data.datasets.forEach((ds, i) => {
      ds.data = wardDatasets[i].data;
      ds.fullNames = wardStats.fullNames;
    });
    wardChart.update();
  } else {
    if (wardChart) wardChart.destroy();
    wardChart = new Chart(wCanvas.getContext('2d'), {
      type: 'bar',
      data: { labels: wardStats.labels, datasets: wardDatasets },
      options: wardOpts
    });
  }
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
  filterStatus = '';
  const search = $('catalogSearch');
  if (search) search.value = '';
  if (source === 'plan') {
    // Mặc định «Tất cả cấp» để hiện đủ sổ tay; chỉ lọc khi gọi kèm opts.level.
    filterLevel = opts.level != null ? String(opts.level) : '';
  } else {
    filterLevel = opts.group != null
      ? String(opts.group)
      : '';
  }
  setCatalogMode(true);
  setBottomPanelCollapsed(false);
  await refresh();
  syncMaxBtn();
}

export function closeCatalogTable() {
  if (!document.body.classList.contains('catalog-table-on')) return;
  setCatalogMode(false);
  destroyCharts();
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
  $('catalogStatusFilter')?.addEventListener('change', (e) => {
    filterStatus = e.target.value || '';
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
