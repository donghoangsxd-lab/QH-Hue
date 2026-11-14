// Bảng danh mục độc lập: trục B mở đồ án quy hoạch (sổ tay + đối soát bản đồ); trục F mở dự án đầu tư.
import { state } from './state.js';
import { escapeHtml, ico, showToast, loadHtml2Pdf, inlineSpriteIcons } from './utils.js';
import {
  setBottomPanelCollapsed, setBottomPanelMaximized, toggleBottomPanelMaximized
} from './uiComponents.js';
import { loadCatalog, projectAreaOf } from './projectFiles.js';
import { zoomToProjectBoundary } from './projectLayer.js';
import {
  listInvestCatalogItems, focusInvest, primeInvestLoad, ensureInvestCatalogLoaded
} from './investLayer.js';
import { postAdmin } from './wardRoads.js';
import { gcsUrl } from './api.js';
import {
  planRowsFromSoTay, investRowsFromItems, filterCatalogRows,
  catalogFilterOptions, catalogStatusOptions, catalogWardFilterOptions,
  catalogStatusStats, catalogWardLevelStats, catalogYearLevelStats,
  groupPlanRowsByLevel, sortPlanRowsByKeys, levelLabelOf, rowsToCsv, downloadCsv,
  STATUS, PLAN_TABLE_COLS, PLAN_SORT_COLUMNS,
  mergeSoTayEdits, emptySoTayEdits, nextDccbId, planYearOf
} from './catalogTableCore.js';

const $ = (id) => document.getElementById(id);
/* ?v= đổi khi rebuild catalog để trình duyệt/SW không giữ bản JSON cũ. */
const SO_TAY_URL = './data/qh-so-tay.json?v=20261109b';
const EDITS_KEY = 'qh-so-tay-edits-v1';
const EDITS_GCS = 'catalog/so-tay-edits.json';

let source = 'plan';
let filterLevel = '';
let filterStatus = '';
let filterWard = '';
let query = '';
let rowsCache = [];
let visibleRows = [];
let soTayBase = null;
let soTayItems = null;
let soTayPromise = null;
let soTayEdits = emptySoTayEdits();
let pdfBusy = false;
let editBusy = false;
let ready = false;
let statusChart = null;
let levelChart = null;
let yearChart = null;
let wardChart = null;
/** 'year' | 'ward' — mặt cột phải; lật bằng #btnCatalogFlipChart. */
let chartPage = 'year';
/** Thứ tự ưu tiên sắp xếp cột (bấm mũi tên header); chỉ xếp đồ án cha. */
let sortKeys = [];

const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;

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

function syncChartPageUi() {
  const bars = $('catalogChartBars');
  const title = $('catalogBarTitle');
  const yearWrap = document.querySelector('#catalogCharts [data-catalog-bar="year"]');
  const wardWrap = document.querySelector('#catalogCharts [data-catalog-bar="ward"]');
  const note = $('catalogWardNote');
  const flip = $('btnCatalogFlipChart');
  const isWard = chartPage === 'ward';
  if (bars) bars.dataset.page = chartPage;
  if (yearWrap) yearWrap.hidden = isWard;
  if (wardWrap) wardWrap.hidden = !isWard;
  if (note) note.hidden = !isWard;
  if (title) {
    title.textContent = isWard
      ? 'Số đồ án theo 40 phường / xã'
      : 'Số đồ án theo năm phê duyệt';
  }
  if (flip) {
    const tip = isWard
      ? 'Xem biểu đồ theo năm phê duyệt'
      : 'Xem biểu đồ theo phường / xã';
    flip.title = tip;
    flip.setAttribute('aria-label', tip);
    flip.setAttribute('aria-pressed', isWard ? 'true' : 'false');
  }
}

function paintChrome() {
  const title = $('catalogTableTitle');
  const colName = $('catalogColName');
  const colScale = $('catalogColScale');
  const statusFilter = $('catalogStatusFilter');
  const wardFilter = $('catalogWardFilter');
  const charts = $('catalogCharts');
  const summary = $('catalogChartSummary');
  const legend = $('catalogChartLegend');
  const flip = $('btnCatalogFlipChart');
  const addBtn = $('btnCatalogAdd');
  const count = $('catalogCount');
  const planOnly = source === 'plan';
  if (statusFilter) statusFilter.hidden = !planOnly;
  if (wardFilter) wardFilter.hidden = !planOnly;
  if (charts) charts.hidden = !planOnly;
  if (summary) summary.hidden = !planOnly;
  if (legend) legend.hidden = !planOnly;
  if (flip) flip.hidden = !planOnly;
  if (addBtn) addBtn.hidden = !(planOnly && isAdmin());
  // Plan: tóm tắt đã có tổng — ẩn chip «N / N đồ án» trùng trên toolbar.
  if (count) count.hidden = planOnly;
  if (!planOnly || !isAdmin()) closeEditPanel();
  if (source === 'invest') {
    if (title) title.textContent = 'DANH MỤC DỰ ÁN ĐẦU TƯ';
    if (colName) colName.textContent = 'Tên dự án';
    if (colScale) colScale.textContent = 'Quy mô';
  } else {
    if (title) title.textContent = 'DANH MỤC ĐỒ ÁN QUY HOẠCH';
    if (colName) colName.textContent = 'Tên quy hoạch';
    if (colScale) colScale.textContent = 'Cấp';
    syncChartPageUi();
  }
  syncPlanColumns(planOnly);
}

function readLocalEdits() {
  try {
    const raw = localStorage.getItem(EDITS_KEY);
    if (!raw) return emptySoTayEdits();
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return emptySoTayEdits();
    return {
      v: 1,
      saved: Number(data.saved) || 0,
      projects: Array.isArray(data.projects) ? data.projects : [],
      dccb: Array.isArray(data.dccb) ? data.dccb : [],
      links: Array.isArray(data.links) ? data.links : [],
      patches: Array.isArray(data.patches) ? data.patches : []
    };
  } catch {
    return emptySoTayEdits();
  }
}

function writeLocalEdits(edits) {
  try { localStorage.setItem(EDITS_KEY, JSON.stringify(edits)); } catch { /* private mode */ }
}

function applyEditsToBase() {
  soTayItems = mergeSoTayEdits(soTayBase || [], soTayEdits);
}

async function loadRemoteEdits() {
  try {
    const res = await fetch(gcsUrl(EDITS_GCS), { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object') return null;
    return {
      v: 1,
      saved: Number(data.saved) || 0,
      projects: Array.isArray(data.projects) ? data.projects : [],
      dccb: Array.isArray(data.dccb) ? data.dccb : [],
      links: Array.isArray(data.links) ? data.links : [],
      patches: Array.isArray(data.patches) ? data.patches : []
    };
  } catch {
    return null;
  }
}

async function persistEdits(edits) {
  writeLocalEdits(edits);
  if (!isAdmin()) return { remote: false };
  try {
    await postAdmin('saveSoTayEdits', { edits, base: soTayEdits.saved || 0 });
    return { remote: true };
  } catch (err) {
    // GAS chưa deploy hoặc API chưa có — giữ localStorage.
    return { remote: false, error: err?.message || String(err) };
  }
}

function closeEditPanel() {
  const panel = $('catalogEditPanel');
  if (panel) panel.hidden = true;
}

function boundCatalogOptions() {
  const list = Array.isArray(state.projectCatalog) ? state.projectCatalog : [];
  return list
    .filter((p) => p && p.boundary && p.tenQH && !p.sheetOnly)
    .map((p) => ({ value: p.tenQH, label: p.tenQH }))
    .sort((a, b) => a.label.localeCompare(b.label, 'vi'));
}

/** Droplist mã sổ tay khi ghi ngược đồ án ngoài sổ tay → ghép mapTenQH. */
function soTayPickOptions(excludeTenQH = '') {
  const force = String(excludeTenQH || '').trim();
  const items = Array.isArray(soTayItems) ? soTayItems : [];
  return items
    .filter((it) => it && it.ma && it.ten)
    .map((it) => {
      const linked = String(it.mapTenQH || '').trim();
      const note = linked
        ? (linked === force ? ' · đang gắn ranh này' : ' · đã gắn ranh khác')
        : '';
      return {
        value: it.ma,
        label: `${it.ma} — ${it.ten}${note}`,
        linked
      };
    })
    .sort((a, b) => {
      const aHit = a.linked === force ? 0 : (a.linked ? 2 : 1);
      const bHit = b.linked === force ? 0 : (b.linked ? 2 : 1);
      if (aHit !== bHit) return aHit - bHit;
      return a.label.localeCompare(b.label, 'vi');
    });
}

function syncAdoptKindUi() {
  const kind = $('catalogAdoptKind')?.value || 'link';
  const isNew = kind === 'new';
  const panel = $('catalogEditPanel');
  if (!panel || $('catalogEditMode')?.value !== 'adopt') return;
  panel.querySelectorAll('[data-edit="adopt-link"]').forEach((el) => {
    el.hidden = isNew;
  });
  panel.querySelectorAll('[data-edit="project"]').forEach((el) => {
    el.hidden = !isNew;
  });
  panel.querySelectorAll('[data-edit="project-only"]').forEach((el) => {
    el.hidden = !isNew;
  });
  panel.querySelectorAll('[data-edit="facts"]').forEach((el) => {
    el.hidden = !isNew;
  });
  panel.querySelectorAll('[data-edit="meta"]').forEach((el) => {
    el.hidden = !isNew;
  });
  const maInp = $('catalogEditMa');
  if (maInp) {
    maInp.readOnly = false;
    maInp.required = isNew;
    if (!isNew) maInp.removeAttribute('required');
  }
  const tenInp = $('catalogEditTen');
  if (tenInp) {
    tenInp.required = isNew;
    if (!isNew) tenInp.removeAttribute('required');
  }
  const soTaySel = $('catalogEditSoTayMa');
  if (soTaySel) soTaySel.required = !isNew;
  $('catalogEditHint').textContent = isNew
    ? 'Tạo mã/tên mới trong sổ tay và gắn với ranh đang có trên bản đồ (mapTenQH).'
    : 'Chọn mã sổ tay đã có để gắn ranh đồ án ngoài sổ tay — không đổi file tĩnh, chỉ overlay.';
}

function setEditMode(mode, parentMa = '') {
  const panel = $('catalogEditPanel');
  const form = $('catalogEditForm');
  if (!panel || !form) return;
  form.reset();
  $('catalogEditMode').value = mode;
  $('catalogEditParentMa').value = parentMa || '';
  const tenQHField = $('catalogEditTenQH');
  if (tenQHField) tenQHField.value = mode === 'adopt' ? (parentMa || '') : '';
  const isDccb = mode === 'dccb';
  const isLink = mode === 'link';
  const isAdopt = mode === 'adopt';
  const isEdit = mode === 'edit';
  const isProject = mode === 'project';
  $('catalogEditTitle').textContent = isLink
    ? `Gán ranh · ${parentMa}`
    : (isAdopt
      ? `Ghi sổ tay · ${parentMa}`
      : (isEdit
        ? `Sửa đồ án · ${parentMa}`
        : (isDccb ? `Thêm ĐCCB · ${parentMa}` : 'Thêm đồ án quy hoạch')));
  $('catalogEditHint').textContent = isLink
    ? 'Chọn một ranh đồ án đã có trên bản đồ để gắn với mã sổ tay này.'
    : (isAdopt
      ? 'Đồ án đang có trên bản đồ nhưng chưa có trong sổ tay: ghép mã có sẵn hoặc thêm tên mới.'
      : (isEdit
        ? 'Sửa tên, phường/xã, quyết định, diện tích, dân số — lưu overlay, không đụng file sổ tay gốc.'
        : (isDccb
          ? 'Dòng điều chỉnh cục bộ sẽ nằm dưới mã đồ án cha.'
          : 'Admin ghi thêm đồ án vào sổ tay (đối soát với bản đồ sau).')));

  panel.querySelectorAll('[data-edit="project"]').forEach((el) => {
    el.hidden = !(isProject || isEdit);
  });
  panel.querySelectorAll('[data-edit="project-only"]').forEach((el) => {
    el.hidden = !isProject;
  });
  panel.querySelectorAll('[data-edit="facts"]').forEach((el) => {
    // ĐCCB chỉ cần tên + QĐ (+ meta ngày/cơ quan); ẩn DT / dân số / PX.
    const id = el.querySelector('input,select')?.id || '';
    const dccbHide = id === 'catalogEditArea' || id === 'catalogEditDanSo' || id === 'catalogEditDvhc';
    el.hidden = isDccb ? dccbHide : !(isProject || isEdit);
  });
  panel.querySelectorAll('[data-edit="meta"]').forEach((el) => {
    el.hidden = !(isProject || isDccb);
  });
  panel.querySelectorAll('[data-edit="link"]').forEach((el) => {
    el.hidden = !isLink;
  });
  panel.querySelectorAll('[data-edit="adopt"]').forEach((el) => {
    el.hidden = !isAdopt;
  });
  panel.querySelectorAll('[data-edit="adopt-link"]').forEach((el) => {
    el.hidden = !isAdopt;
  });

  const maInp = $('catalogEditMa');
  if (maInp) {
    maInp.readOnly = isEdit;
    maInp.required = isProject || isEdit;
    if (!(isProject || isEdit)) maInp.removeAttribute('required');
  }
  const tenInp = $('catalogEditTen');
  if (tenInp) {
    tenInp.required = isProject || isEdit || isDccb;
    if (isLink || isAdopt) tenInp.removeAttribute('required');
  }
  const boundSel = $('catalogEditBound');
  if (boundSel) {
    const opts = boundCatalogOptions();
    boundSel.innerHTML = `<option value="">— Chọn ranh đồ án —</option>${
      opts.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('')
    }`;
    boundSel.required = isLink;
  }
  const soTaySel = $('catalogEditSoTayMa');
  if (soTaySel) {
    const opts = soTayPickOptions(isAdopt ? parentMa : '');
    soTaySel.innerHTML = `<option value="">— Chọn mã sổ tay —</option>${
      opts.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('')
    }`;
    soTaySel.required = false;
  }
  if (isAdopt) {
    const kind = $('catalogAdoptKind');
    if (kind) kind.value = 'link';
    if (tenInp) {
      tenInp.placeholder = 'Tên trong sổ tay';
      tenInp.value = parentMa || '';
    }
    syncAdoptKindUi();
  } else if (isDccb) {
    if (tenInp) {
      tenInp.placeholder = 'ĐCCB …';
      tenInp.value = 'ĐCCB ';
    }
  } else if (tenInp) {
    tenInp.placeholder = 'Tên đồ án quy hoạch';
  }
  panel.hidden = false;
  if (isLink) boundSel?.focus();
  else if (isAdopt) ($('catalogEditSoTayMa') || $('catalogAdoptKind'))?.focus();
  else if (isEdit) tenInp?.focus();
  else tenInp?.focus();
}

function openLinkBound(ma) {
  if (!isAdmin()) {
    showToast('Cần đăng nhập Admin để gán ranh', 'info');
    return;
  }
  if (!ma) return;
  if (!boundCatalogOptions().length) {
    showToast('Chưa có ranh đồ án nào trên bản đồ để gán', 'info');
    return;
  }
  setEditMode('link', ma);
}

/** Đồ án ngoài sổ tay (chi_ban_do): ghép mã sổ tay có sẵn hoặc thêm tên mới + mapTenQH. */
function openAdoptSoTay(tenQH) {
  if (!isAdmin()) {
    showToast('Cần đăng nhập Admin để ghi sổ tay', 'info');
    return;
  }
  const name = String(tenQH || '').trim();
  if (!name) return;
  if (!(soTayItems || []).length) {
    showToast('Chưa tải sổ tay — thử mở lại bảng danh mục', 'info');
    return;
  }
  setEditMode('adopt', name);
}

function openAddProject() {
  if (!isAdmin()) {
    showToast('Cần đăng nhập Admin để thêm đồ án', 'info');
    return;
  }
  setEditMode('project');
}

function openAddDccb(ma) {
  if (!isAdmin()) {
    showToast('Cần đăng nhập Admin để thêm ĐCCB', 'info');
    return;
  }
  if (!ma) return;
  setEditMode('dccb', ma);
}

function openEditProject(ma) {
  if (!isAdmin()) {
    showToast('Cần đăng nhập Admin để sửa đồ án', 'info');
    return;
  }
  const code = String(ma || '').trim();
  if (!code) return;
  const item = (soTayItems || []).find((it) => it.ma === code);
  if (!item) {
    showToast('Không tìm thấy đồ án trong sổ tay', 'info');
    return;
  }
  setEditMode('edit', code);
  const maInp = $('catalogEditMa');
  if (maInp) maInp.value = code;
  const tenInp = $('catalogEditTen');
  if (tenInp) tenInp.value = item.ten || '';
  const qd = $('catalogEditQd');
  if (qd) qd.value = item.quyetDinh || '';
  const area = $('catalogEditArea');
  if (area) area.value = item.dienTichText || (item.dienTichHa != null ? String(item.dienTichHa) : '');
  const danSo = $('catalogEditDanSo');
  if (danSo) danSo.value = item.danSo || '';
  const dvhc = $('catalogEditDvhc');
  if (dvhc) dvhc.value = item.dvhc || item.diaDiem || '';
}

function parseAreaHa(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ha: null, text: '' };
  if (/[a-zA-ZÀ-ỹ]/.test(text)) return { ha: null, text };
  const s = text.replace(/\s/g, '').replace(/[^\d,.\-]/g, '');
  if (!s) return { ha: null, text };
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalized);
  return {
    ha: Number.isFinite(n) && n >= 0 && n < 1e6 ? n : null,
    text
  };
}

async function submitEdit(e) {
  e.preventDefault();
  if (editBusy || !isAdmin()) return;
  const mode = $('catalogEditMode')?.value || 'project';
  const ten = String($('catalogEditTen')?.value || '').trim();
  const qd = String($('catalogEditQd')?.value || '').trim();
  const ngay = String($('catalogEditNgay')?.value || '').trim();
  const coQuan = String($('catalogEditCoQuan')?.value || '').trim();
  if (mode !== 'link' && mode !== 'adopt') {
    if (!ten) {
      showToast('Nhập tên quy hoạch / ĐCCB', 'info');
      return;
    }
    if (mode !== 'edit' && ngay && !planYearOf(ngay)) {
      showToast('Ngày ban hành cần dạng dd/mm/yyyy', 'info');
      return;
    }
  }
  editBusy = true;
  try {
    const next = {
      v: 1,
      saved: soTayEdits.saved || 0,
      projects: [...(soTayEdits.projects || [])],
      dccb: [...(soTayEdits.dccb || [])],
      links: [...(soTayEdits.links || [])],
      patches: [...(soTayEdits.patches || [])]
    };
    if (mode === 'link') {
      const ma = String($('catalogEditParentMa')?.value || '').trim();
      const tenQH = String($('catalogEditBound')?.value || '').trim();
      if (!ma || !tenQH) {
        showToast('Chọn ranh đồ án trên bản đồ', 'info');
        return;
      }
      const i = next.links.findIndex((x) => String(x?.ma || '') === ma);
      if (i >= 0) next.links[i] = { ma, tenQH };
      else next.links.push({ ma, tenQH });
    } else if (mode === 'adopt') {
      const tenQH = String($('catalogEditTenQH')?.value || $('catalogEditParentMa')?.value || '').trim();
      if (!tenQH) {
        showToast('Thiếu tên đồ án trên bản đồ', 'info');
        return;
      }
      const adoptKind = $('catalogAdoptKind')?.value || 'link';
      let ma = '';
      if (adoptKind === 'new') {
        ma = String($('catalogEditMa')?.value || '').trim().toUpperCase();
        const name = String($('catalogEditTen')?.value || '').trim() || tenQH;
        const cap = String($('catalogEditCap')?.value || 'QHPK').trim();
        if (!ma) {
          showToast('Nhập mã đồ án mới', 'info');
          return;
        }
        if ((soTayItems || []).some((it) => it.ma === ma) || next.projects.some((p) => p.ma === ma)) {
          showToast(`Mã ${ma} đã có trong sổ tay`, 'info');
          return;
        }
        if (ngay && !planYearOf(ngay)) {
          showToast('Ngày ban hành cần dạng dd/mm/yyyy', 'info');
          return;
        }
        const area = parseAreaHa($('catalogEditArea')?.value);
        next.projects.push({
          ma,
          ten: name,
          cap,
          dvhc: String($('catalogEditDvhc')?.value || '').trim(),
          diaDiem: String($('catalogEditDvhc')?.value || '').trim(),
          dienTichHa: area.ha,
          dienTichText: area.text,
          danSo: String($('catalogEditDanSo')?.value || '').trim(),
          quyetDinh: qd,
          ngay,
          coQuan,
          children: [],
          soDccb: 0,
          soDinhChinh: 0,
          sheetNguon: 'admin',
          ghiChu: 'Thêm bởi admin (từ bản đồ)'
        });
      } else {
        ma = String($('catalogEditSoTayMa')?.value || '').trim();
        if (!ma) {
          showToast('Chọn mã sổ tay để ghép', 'info');
          return;
        }
        if (!(soTayItems || []).some((it) => it.ma === ma) && !next.projects.some((p) => p.ma === ma)) {
          showToast('Không tìm thấy mã sổ tay', 'error');
          return;
        }
      }
      const i = next.links.findIndex((x) => String(x?.ma || '') === ma);
      if (i >= 0) next.links[i] = { ma, tenQH };
      else next.links.push({ ma, tenQH });
    } else if (mode === 'edit') {
      const ma = String($('catalogEditParentMa')?.value || $('catalogEditMa')?.value || '').trim();
      if (!ma) {
        showToast('Thiếu mã đồ án', 'info');
        return;
      }
      const area = parseAreaHa($('catalogEditArea')?.value);
      const patch = {
        ma,
        ten,
        quyetDinh: qd,
        dvhc: String($('catalogEditDvhc')?.value || '').trim(),
        dienTichHa: area.ha,
        dienTichText: area.text,
        danSo: String($('catalogEditDanSo')?.value || '').trim()
      };
      const i = next.patches.findIndex((x) => String(x?.ma || '') === ma);
      if (i >= 0) next.patches[i] = patch;
      else next.patches.push(patch);
    } else if (mode === 'dccb') {
      const ma = String($('catalogEditParentMa')?.value || '').trim();
      const parent = (soTayItems || []).find((it) => it.ma === ma);
      if (!parent) {
        showToast('Không tìm thấy đồ án cha', 'error');
        return;
      }
      next.dccb.push({
        ma,
        child: {
          id: nextDccbId(ma, parent.children),
          loaiDong: 'dccb',
          ten,
          quyetDinh: qd,
          ngay,
          coQuan,
          dienTichText: '',
          danSo: '',
          ghiChu: 'Thêm bởi admin'
        }
      });
    } else {
      const ma = String($('catalogEditMa')?.value || '').trim().toUpperCase();
      const cap = String($('catalogEditCap')?.value || 'QHPK').trim();
      if (!ma) {
        showToast('Nhập mã đồ án', 'info');
        return;
      }
      if ((soTayItems || []).some((it) => it.ma === ma) || next.projects.some((p) => p.ma === ma)) {
        showToast(`Mã ${ma} đã có trong sổ tay`, 'info');
        return;
      }
      const area = parseAreaHa($('catalogEditArea')?.value);
      next.projects.push({
        ma,
        ten,
        cap,
        dvhc: String($('catalogEditDvhc')?.value || '').trim(),
        diaDiem: String($('catalogEditDvhc')?.value || '').trim(),
        dienTichHa: area.ha,
        dienTichText: area.text,
        danSo: String($('catalogEditDanSo')?.value || '').trim(),
        quyetDinh: qd,
        ngay,
        coQuan,
        children: [],
        soDccb: 0,
        soDinhChinh: 0,
        sheetNguon: 'admin',
        ghiChu: 'Thêm bởi admin'
      });
    }
    const saved = await persistEdits(next);
    soTayEdits = { ...next, saved: Date.now() };
    writeLocalEdits(soTayEdits);
    applyEditsToBase();
    closeEditPanel();
    await refresh();
    const okRemote = saved.remote ? 'lên máy chủ' : 'trên máy này (chưa đồng bộ bucket)';
    const label = mode === 'link'
      ? 'Đã gán ranh'
      : (mode === 'adopt'
        ? 'Đã ghi sổ tay'
        : (mode === 'edit' ? 'Đã sửa đồ án' : (mode === 'dccb' ? 'Đã ghi ĐCCB' : 'Đã ghi đồ án')));
    showToast(`${label} ${okRemote}`, saved.remote ? 'success' : 'info');
  } finally {
    editBusy = false;
  }
}

function sortHeaderHtml(label, key, opts = {}) {
  const idAttr = opts.id ? ` id="${escapeHtml(opts.id)}"` : '';
  if (!key) return `<th${idAttr}>${escapeHtml(label)}</th>`;
  const idx = sortKeys.findIndex((s) => s.key === key);
  const on = idx >= 0;
  const pri = on ? String(idx + 1) : '';
  const title = on
    ? `Bỏ sắp xếp «${label}» (ưu tiên ${pri})`
    : `Sắp xếp theo «${label}»`;
  return `<th${idAttr} class="catalog-sort-th">
    <span class="catalog-sort-label">${escapeHtml(label)}</span>
    <button type="button" class="catalog-sort-btn${on ? ' is-on' : ''}" data-catalog-sort="${escapeHtml(key)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" aria-pressed="${on ? 'true' : 'false'}">
      ${pri ? `<span class="catalog-sort-pri" aria-hidden="true">${escapeHtml(pri)}</span>` : ''}
      <span class="catalog-sort-arrow" aria-hidden="true"></span>
    </button>
  </th>`;
}

function togglePlanSort(key) {
  if (!PLAN_SORT_COLUMNS.some((c) => c.key === key)) return;
  const i = sortKeys.findIndex((s) => s.key === key);
  if (i >= 0) sortKeys.splice(i, 1);
  else sortKeys.push({ key });
  syncPlanColumns(true);
  paintTable();
}

function syncPlanColumns(planOnly) {
  const table = $('catalogTable');
  if (!table) return;
  table.classList.toggle('catalog-plan-mode', !!planOnly);
  const head = table.querySelector('thead tr');
  if (!head) return;
  if (planOnly) {
    // colgroup % khớp CSS — 11 cột (thêm Cấp độ sau Tên); PX ngay trước Quyết định.
    let colgroup = table.querySelector('colgroup');
    if (!colgroup) {
      colgroup = document.createElement('colgroup');
      table.insertBefore(colgroup, table.firstChild);
    }
    colgroup.innerHTML = `<col style="width:3%"><col style="width:5%"><col style="width:30%">
      <col style="width:9%"><col style="width:10%"><col style="width:8%"><col style="width:6%">
      <col style="width:6%"><col style="width:5%"><col style="width:5%"><col style="width:8%">`;
    head.innerHTML = `<th>STT</th>
      ${sortHeaderHtml('Mã', 'ma')}
      ${sortHeaderHtml('Tên quy hoạch', 'name', { id: 'catalogColName' })}
      ${sortHeaderHtml('Cấp độ', 'level')}
      ${sortHeaderHtml('Phường / xã', 'ward')}
      ${sortHeaderHtml('Quyết định', 'quyetDinh')}
      ${sortHeaderHtml('Ngày ban hành', 'ngay')}
      ${sortHeaderHtml('Cấp phê duyệt', 'coQuan')}
      ${sortHeaderHtml('Diện tích', 'area')}
      ${sortHeaderHtml('Dân số', 'danSo')}
      ${sortHeaderHtml('Ranh', 'ranh')}`;
  } else {
    const colgroup = table.querySelector('colgroup');
    if (colgroup) colgroup.remove();
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
  const wd = $('catalogWardFilter');
  if (wd && source === 'plan') {
    const opts = catalogWardFilterOptions();
    const cur = filterWard;
    wd.innerHTML = opts.map(o =>
      `<option value="${escapeHtml(o.value)}"${o.value === cur ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
    ).join('');
    if (![...wd.options].some(o => o.value === cur)) {
      filterWard = '';
      wd.value = '';
    }
  }
}

async function loadSoTay() {
  if (soTayItems) return soTayItems;
  if (soTayPromise) return soTayPromise;
  soTayPromise = (async () => {
    try {
      const res = await fetch(SO_TAY_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      soTayBase = Array.isArray(data.items) ? data.items : [];
    } catch (err) {
      console.warn('Không tải được sổ tay QH:', err);
      showToast('Chưa tải được sổ tay đồ án từ sheet — đang hiện danh mục bản đồ', 'info');
      soTayBase = [];
    }
    const remote = await loadRemoteEdits();
    const local = readLocalEdits();
    soTayEdits = (remote && remote.saved >= (local.saved || 0)) ? remote : local;
    if ((soTayEdits.projects?.length || soTayEdits.dccb?.length) && soTayEdits !== remote) {
      writeLocalEdits(soTayEdits);
    }
    applyEditsToBase();
    return soTayItems;
  })().finally(() => { soTayPromise = null; });
  return soTayPromise;
}

/** Cùng nguồn sổ tay với bảng danh mục trục B — droplist Bổ sung / điều chỉnh tái dùng. */
export async function ensureSoTayItems() {
  return loadSoTay();
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

function displayName(r) {
  const name = String(r.name || '').trim();
  if (name) return name;
  const full = String(r.fullName || '').trim();
  if (full) return full;
  const ma = String(r.maDoAn || '').trim();
  return ma || '—';
}

function cellOrDash(v) {
  const s = String(v || '').trim();
  return s ? escapeHtml(s) : '—';
}

function areaCellHtml(text) {
  const s = String(text || '').trim();
  if (!s) return '<td class="catalog-area">—</td>';
  const note = /[a-zA-ZÀ-ỹ]/.test(s);
  const cls = note ? 'catalog-area catalog-area-note' : 'catalog-area';
  return `<td class="${cls}" title="${escapeHtml(s)}">${escapeHtml(s)}</td>`;
}

function nameCellHtml(name, extraClass = '') {
  const s = String(name || '').trim() || '—';
  const cls = extraClass ? `st-name ${extraClass}` : 'st-name';
  return `<td class="${cls}" title="${escapeHtml(s)}"><span class="catalog-name-text">${escapeHtml(s)}</span></td>`;
}

function wardCellHtml(r) {
  const list = Array.isArray(r?.wards) ? r.wards.filter(Boolean) : [];
  const full = list.length ? list.join(', ') : String(r?.ward || '').trim();
  if (!full) return '<td class="catalog-ward">—</td>';
  return `<td class="catalog-ward" title="${escapeHtml(full)}">${escapeHtml(full)}</td>`;
}

/** Cột Ranh gộp: Có (N lớp) | Chưa có — N = số lớp bản đồ đang có trên map.
 *  chi_ban_do (ngoài sổ tay): Admin thêm nút «Sổ tay» để ghép mã có sẵn hoặc ghi tên mới. */
function boundCellHtml(r) {
  const tenQH = String(r.fullName || r.zoomKey || r.name || '').trim();
  if (r.status === 'chi_ban_do') {
    const n = Number(r.layerCount) || 0;
    const zoom = (r.hasBoundary && r.zoomKey)
      ? `<button type="button" class="catalog-bound-yes" data-catalog-zoom="${escapeHtml(r.zoomKey)}" title="Phóng tới ranh · ${n} lớp bản đồ (không mở đồ án)">Có (${n})</button>`
      : '<span class="catalog-bound-no">Chưa có</span>';
    if (isAdmin() && tenQH) {
      return `<span class="catalog-bound-actions">${zoom}<button type="button" class="catalog-bound-link" data-catalog-adopt-tenqh="${escapeHtml(tenQH)}" title="Ghép vào mã sổ tay có sẵn hoặc thêm tên mới">Sổ tay</button></span>`;
    }
    return zoom;
  }
  if (r.hasBoundary && r.zoomKey) {
    const n = Number(r.layerCount) || 0;
    const label = `Có (${n})`;
    return `<button type="button" class="catalog-bound-yes" data-catalog-zoom="${escapeHtml(r.zoomKey)}" title="Phóng tới ranh · ${n} lớp bản đồ (không mở đồ án)">${escapeHtml(label)}</button>`;
  }
  const ma = String(r.maDoAn || '').trim();
  if (isAdmin() && ma) {
    return `<button type="button" class="catalog-bound-link" data-catalog-link-ma="${escapeHtml(ma)}" title="Gán ranh đồ án trên bản đồ">Chưa có</button>`;
  }
  return `<span class="catalog-bound-no">Chưa có</span>`;
}

function levelCellHtml(r) {
  const label = levelLabelOf(r?.level);
  if (!label || label === '—') return '<td class="catalog-level">—</td>';
  return `<td class="catalog-level" title="${escapeHtml(label)}">${escapeHtml(label)}</td>`;
}

function planChildRowHtml(parent, child, isLast) {
  const tag = child.loaiDong === 'dinh_chinh' ? 'Đính chính' : 'ĐCCB';
  const name = String(child.ten || tag).trim() || tag;
  // Đủ 11 <td> giống hàng cha; cấp độ + PX kế thừa đồ án cha (không tách khi sắp xếp).
  return `<tr class="catalog-dccb-row${isLast ? ' is-last' : ''}" data-catalog-parent="${escapeHtml(parent.id)}" data-catalog-child="${escapeHtml(child.id)}">
    <td class="st-num catalog-dccb-empty"></td>
    <td class="catalog-ma catalog-dccb-empty"></td>
    ${nameCellHtml(name, 'catalog-dccb-name')}
    <td class="catalog-level catalog-dccb-empty" title="Theo đồ án cha">—</td>
    ${wardCellHtml(parent)}
    <td class="catalog-qd" title="${escapeHtml(child.quyetDinh || '')}">${cellOrDash(child.quyetDinh)}</td>
    <td class="catalog-date">${cellOrDash(child.ngay)}</td>
    <td class="catalog-agency">${cellOrDash(child.coQuan)}</td>
    ${areaCellHtml(child.dienTichText)}
    <td class="catalog-pop">${cellOrDash(child.danSo)}</td>
    <td class="catalog-bound-no" title="${escapeHtml(tag)}">—</td>
  </tr>`;
}

function planRowHtml(r, stt) {
  const name = displayName(r);
  const ma = String(r.maDoAn || '').trim();
  const addDccb = (isAdmin() && ma)
    ? `<button type="button" class="catalog-add-dccb" data-catalog-add-dccb="${escapeHtml(ma)}" title="Thêm điều chỉnh cục bộ" aria-label="Thêm điều chỉnh cục bộ">${ico('plus')}</button>`
    : '';
  const editBtn = (isAdmin() && ma)
    ? `<button type="button" class="catalog-edit-row" data-catalog-edit-ma="${escapeHtml(ma)}" title="Sửa tên, phường/xã, quyết định, diện tích, dân số" aria-label="Sửa đồ án">${ico('pen')}</button>`
    : '';
  const kids = Array.isArray(r.children) ? r.children : [];
  const hasKids = kids.length > 0;
  const parent = `<tr class="catalog-parent-row${hasKids ? ' has-kids' : ''}" data-catalog-id="${escapeHtml(r.id)}" data-status="${escapeHtml(r.status || '')}">
    <td class="st-num">${stt}</td>
    <td class="catalog-ma" title="${escapeHtml(ma)}">${cellOrDash(ma)}${addDccb}${editBtn}</td>
    ${nameCellHtml(name)}
    ${levelCellHtml(r)}
    ${wardCellHtml(r)}
    <td class="catalog-qd" title="${escapeHtml(r.quyetDinh || '')}">${cellOrDash(r.quyetDinh)}</td>
    <td class="catalog-date">${cellOrDash(r.ngay)}</td>
    <td class="catalog-agency">${cellOrDash(r.coQuan)}</td>
    ${areaCellHtml(r.areaText)}
    <td class="catalog-pop">${cellOrDash(r.danSo)}</td>
    <td>${boundCellHtml(r)}</td>
  </tr>`;
  return parent + kids.map((c, i) => planChildRowHtml(r, c, i === kids.length - 1)).join('');
}

function paintTable() {
  visibleRows = filterCatalogRows(rowsCache, {
    query,
    level: filterLevel,
    status: source === 'plan' ? filterStatus : '',
    ward: source === 'plan' ? filterWard : ''
  });
  if (source === 'plan' && sortKeys.length) {
    visibleRows = sortPlanRowsByKeys(visibleRows, sortKeys);
  }
  const body = $('catalogTableBody');
  const count = $('catalogCount');
  const unit = source === 'invest' ? 'dự án' : 'đồ án';
  if (count) count.textContent = `${visibleRows.length} / ${rowsCache.length} ${unit}`;
  if (!body) return;
  if (!visibleRows.length) {
    const cols = source === 'plan' ? PLAN_TABLE_COLS : 6;
    body.innerHTML = `<tr><td colspan="${cols}" class="catalog-empty st-msg">Không có dòng khớp bộ lọc.</td></tr>`;
    paintCharts();
    return;
  }
  if (source === 'plan') {
    const parts = [];
    let stt = 0;
    // Có sắp xếp cột → danh sách phẳng (không nhóm A/B/C); ĐCCB vẫn gắn ngay dưới cha.
    const items = sortKeys.length
      ? visibleRows.map((row) => ({ type: 'row', row }))
      : groupPlanRowsByLevel(visibleRows);
    for (const item of items) {
      if (item.type === 'group') {
        parts.push(
          `<tr class="catalog-group-row"><td colspan="${PLAN_TABLE_COLS}">${escapeHtml(item.label)} (${item.count})</td></tr>`
        );
        continue;
      }
      stt += 1;
      parts.push(planRowHtml(item.row, stt));
    }
    body.innerHTML = parts.join('');
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
  if (yearChart) { yearChart.destroy(); yearChart = null; }
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

function stackedBarOpts({ tickColor, xTick }) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    // Chừa đáy canvas để nhãn năm/PX không bị cắt khi mở lần đầu (panel dock thấp).
    layout: { padding: { top: 2, right: 4, bottom: 4, left: 0 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index',
        intersect: false,
        callbacks: {
          label: (item) => ` ${item.dataset.label}: ${item.parsed.y || 0}`,
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
          autoSkip: true,
          maxRotation: 0,
          minRotation: 0,
          color: tickColor,
          font: { size: 9 },
          padding: 2,
          ...(xTick || {})
        },
        grid: { color: 'rgba(255,255,255,0.05)' }
      },
      y: {
        stacked: true,
        beginAtZero: true,
        ticks: { color: '#94a3b8', precision: 0, font: { size: 10 }, padding: 2 },
        grid: { color: 'rgba(255,255,255,0.05)' }
      }
    }
  };
}

function levelStackDatasets(stats, extra = {}) {
  return [
    {
      label: 'QHC',
      data: stats.qhc,
      backgroundColor: '#38bdf8',
      stack: 'plan',
      barPercentage: 0.9,
      categoryPercentage: 0.85,
      ...extra
    },
    {
      label: 'QHPK',
      data: stats.qhpk,
      backgroundColor: '#f59e0b',
      stack: 'plan',
      barPercentage: 0.9,
      categoryPercentage: 0.85,
      ...extra
    },
    {
      label: 'QHCT',
      data: stats.qhct,
      backgroundColor: '#a78bfa',
      stack: 'plan',
      barPercentage: 0.9,
      categoryPercentage: 0.85,
      ...extra
    }
  ];
}

function paintCharts() {
  const wrap = $('catalogCharts');
  if (!wrap || source !== 'plan' || typeof Chart === 'undefined') {
    destroyCharts();
    return;
  }
  const chartRows = visibleRows.length ? visibleRows : rowsCache;
  const stats = catalogStatusStats(chartRows);
  const yearStats = catalogYearLevelStats(chartRows);
  const wardStats = catalogWardLevelStats(chartRows);
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
    const shown = visibleRows.length;
    const all = rowsCache.length;
    const head = shown === all
      ? `<b>${all}</b> đồ án`
      : `<b>${shown}</b>/${all} đồ án`;
    sumEl.innerHTML = `${head} ·
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
  syncChartPageUi();

  const sCanvas = $('catalogStatusChart');
  const lCanvas = $('catalogLevelChart');
  const yCanvas = $('catalogYearChart');
  const wCanvas = $('catalogWardChart');
  if (!sCanvas || !lCanvas || !yCanvas) return;

  const common = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: 4 },
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
        datasets: [{ data: statusData, backgroundColor: statusColors, borderWidth: 0, hoverOffset: 2 }]
      },
      options: { ...common, cutout: '62%' }
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
        datasets: [{ data: levelData, backgroundColor: levelColors, borderWidth: 0, hoverOffset: 2 }]
      },
      options: { ...common, cutout: '62%' }
    });
  }

  const tickColor = getComputedStyle(document.documentElement).getPropertyValue('--text-main').trim() || '#cbd5e1';
  const yearDatasets = levelStackDatasets(yearStats);
  const yearOpts = stackedBarOpts({ tickColor });

  if (chartPage === 'year' || !wCanvas) {
    if (yearChart && yearChart.canvas === yCanvas) {
      yearChart.data.labels = yearStats.labels;
      yearChart.data.datasets.forEach((ds, i) => { ds.data = yearDatasets[i].data; });
      yearChart.update();
    } else {
      if (yearChart) yearChart.destroy();
      yearChart = new Chart(yCanvas.getContext('2d'), {
        type: 'bar',
        data: { labels: yearStats.labels, datasets: yearDatasets },
        options: yearOpts
      });
    }
  }

  if (!wCanvas || chartPage !== 'ward') {
    if (chartPage !== 'ward' && wardChart) {
      wardChart.destroy();
      wardChart = null;
    }
    return;
  }

  const wardDatasets = levelStackDatasets(wardStats, { fullNames: wardStats.fullNames });
  const wardOpts = stackedBarOpts({
    tickColor,
    xTick: {
      autoSkip: false,
      minRotation: 45,
      maxRotation: 45,
      callback(value) {
        return shortWardTick(this.getLabelForValue(value));
      }
    }
  });
  wardOpts.plugins.tooltip.callbacks.title = (items) => {
    const i = items[0]?.dataIndex ?? 0;
    return wardStats.fullNames[i] || wardStats.labels[i] || '';
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
  filterWard = '';
  sortKeys = [];
  chartPage = 'year';
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
  // Mặc định dock ~1/5 như bảng HT toàn TP (2 chart); maximize chỉ khi bấm nút phóng.
  setBottomPanelMaximized(false);
  setBottomPanelCollapsed(false);
  await refresh();
  syncMaxBtn();
  // Sau khi panel dock ổn định kích thước — resize lại để nhãn năm không bị cắt lần mở đầu.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      statusChart?.resize();
      levelChart?.resize();
      yearChart?.resize();
      wardChart?.resize();
    });
  });
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
    const ok = zoomToProjectBoundary(key);
    if (!ok) showToast('Chưa phóng được tới ranh (thiếu ranh hoặc chưa tải catalog)', 'info');
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
  $('catalogWardFilter')?.addEventListener('change', (e) => {
    filterWard = e.target.value || '';
    paintTable();
  });
  $('btnCatalogFlipChart')?.addEventListener('click', () => {
    chartPage = chartPage === 'ward' ? 'year' : 'ward';
    syncChartPageUi();
    requestAnimationFrame(() => {
      paintCharts();
      if (chartPage === 'year') yearChart?.resize();
      else wardChart?.resize();
    });
  });
  $('btnCatalogAdd')?.addEventListener('click', openAddProject);
  $('btnCatalogEditClose')?.addEventListener('click', closeEditPanel);
  $('catalogAdoptKind')?.addEventListener('change', syncAdoptKindUi);
  $('catalogEditForm')?.addEventListener('submit', (e) => { void submitEdit(e); });
  $('btnCatalogExportCsv')?.addEventListener('click', exportCsv);
  $('btnCatalogExportPdf')?.addEventListener('click', () => { void exportPdf(); });
  $('btnCatalogMax')?.addEventListener('click', () => {
    toggleBottomPanelMaximized();
    syncMaxBtn();
    requestAnimationFrame(() => {
      statusChart?.resize();
      levelChart?.resize();
      yearChart?.resize();
      wardChart?.resize();
      paintCharts();
    });
  });
  $('btnCatalogClose')?.addEventListener('click', () => {
    closeEditPanel();
    closeCatalogTable();
    setBottomPanelCollapsed(true);
  });
  $('catalogTable')?.querySelector('thead')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-catalog-sort]');
    if (!btn || source !== 'plan') return;
    e.preventDefault();
    togglePlanSort(btn.dataset.catalogSort);
  });
  $('catalogTableBody')?.addEventListener('click', (e) => {
    const add = e.target.closest('[data-catalog-add-dccb]');
    if (add) {
      openAddDccb(add.dataset.catalogAddDccb);
      return;
    }
    const edit = e.target.closest('[data-catalog-edit-ma]');
    if (edit) {
      openEditProject(edit.dataset.catalogEditMa);
      return;
    }
    const link = e.target.closest('[data-catalog-link-ma]');
    if (link) {
      openLinkBound(link.dataset.catalogLinkMa);
      return;
    }
    const adopt = e.target.closest('[data-catalog-adopt-tenqh]');
    if (adopt) {
      openAdoptSoTay(adopt.dataset.catalogAdoptTenqh);
      return;
    }
    const btn = e.target.closest('[data-catalog-zoom]');
    if (!btn) return;
    void onZoom(btn.dataset.catalogZoom);
  });
  document.addEventListener('auth:change', () => {
    if (!document.body.classList.contains('catalog-table-on')) return;
    paintChrome();
    if (source === 'plan') paintTable();
  });
  document.getElementById('btnExpandBottomPanel')?.addEventListener('click', () => {
    if (document.body.classList.contains('catalog-table-on')) closeCatalogTable();
  });
  document.getElementById('btnCollapseBottomPanel')?.addEventListener('click', () => {
    closeCatalogTable();
  });
}
