// Tab Chấm điểm trên trục Hành chính. Ô trống lấy số tự tính; bảng ghi đè.
import { escapeHtml } from './utils.js';
import { highlightWardBoundary, highlightWardNames } from './mapEngine.js';
import { state } from './state.js';
import { DVHC_CITY, DVHC_WARDS } from './dvhcStats.js';
import { indexRows, kysOf, loadChamDiemRows, parseKy, valueAt } from './chamDiemData.js';
import { dothiUnits, fullWardName, hueUnit, xaUnits } from './chamDiemUnits.js';
import { buckets, NOTE_CHUNG, passDoThi, scoreDoThi, scoreHue, scoreXa, tieuChuan } from './chamDiemCore.js';
import { clearChamDiemMap, paintChamDiemMap, WARD_BOUNDS_EVENT } from './chamDiemMap.js';
import { chonGiaTri, giaTriTuDong, loadNoxhCounts } from './chamDiemAuto.js';
import { nguonTieuChi, tyLeTuDong } from './chamDiemNguon.js';
import { factsForUrban, factsForWard, htReady, loadHienTrangFacts } from './hienTrangScore.js';
import { densityArea, loadBuiltAreas, loadRoadTypeLengths } from './wardRoads.js';
import { URBANS } from './urbanClass.js';
import { loadPartGeoms } from './urbanPartGeom.js';

const NF = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 });
const fmt = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : NF.format(Number(n)));
const KET = { dat: 'Đạt', khong: 'Không đạt', chua: 'Chưa đánh giá' };
const ketCls = { dat: 'c-green', khong: 'c-red', chua: 'c-muted' };

let rows = [];
let index = new Map();
let nguon = 'trong';
let loaded = false;
let loading = false;
let level = 'hue';
let period = '2030';
let ky = '2026-Q1';
let chartKind = 'quy';
let picked = null;
let chart = null;
let roadLens = null;
let builtReady = false;
let autoStarted = false;

const rootEl = () => document.getElementById('chamDiemRoot');
const paneOn = () => {
  const pane = document.getElementById('adminPaneChamDiem');
  return !!pane && !pane.hidden;
};

function unitsNow() {
  if (level === 'hue') return [hueUnit()];
  if (level === 'dothi') return dothiUnits(period);
  return xaUnits(period);
}

function scopeNames(unit) {
  if (unit.loai === 'xa') return [unit.ten];
  if (unit.loai === 'hue') return Object.keys(DVHC_WARDS);
  if (unit.partial) {
    const host = fullWardName(unit.members[0] && (unit.members[0].ten || unit.members[0].ma));
    return host ? [host] : [];
  }
  return (unit.members || []).map(m => fullWardName(m.ten) || fullWardName(m.ma)).filter(Boolean);
}

function netOf(unit) {
  const names = scopeNames(unit);
  let roadKm = null;
  let bikeKm = null;
  let builtKm2 = null;
  if (roadLens && names.length) {
    let road = 0;
    let bike = 0;
    let ok = true;
    names.forEach(name => {
      const row = roadLens[name];
      if (!row) ok = false;
      else {
        road += (Number(row.main) || 0) + (Number(row.kiet) || 0);
        bike += Number(row.bike) || 0;
      }
    });
    if (ok) { roadKm = road; bikeKm = bike; }
  }
  if (builtReady && names.length) {
    let sum = 0;
    let ok = true;
    names.forEach(name => {
      const area = densityArea(name, DVHC_WARDS[name] ? DVHC_WARDS[name].km2 : 0);
      if (!area || !area.built) ok = false;
      else sum += area.km2;
    });
    if (ok) builtKm2 = sum;
  }
  return { roadKm, bikeKm, builtKm2, builtExact: builtKm2 != null && !unit.partial };
}

function htOf(unit) {
  if (!htReady()) return null;
  if (unit.loai === 'xa') return factsForWard(unit.ten);
  if (unit.loai === 'dothi') return factsForUrban({ id: unit.id });
  return factsForUrban({ id: 'hue' });
}

function valueOf(unit) {
  const ctx = { period, points: state.dataVersion > 0 ? state.rawDataList : null, ht: htOf(unit), ...netOf(unit) };
  const used = new Map();
  const fn = (id) => {
    const pickedCell = chonGiaTri(valueAt(index, unit.loai, unit.ma, ky, id), giaTriTuDong(id, unit, ctx));
    used.set(id, pickedCell);
    return pickedCell.value;
  };
  fn.used = used;
  return fn;
}

function packOf(unit) {
  const read = valueOf(unit);
  let pack;
  if (unit.loai === 'hue') pack = scoreHue(read);
  else if (unit.loai === 'xa') pack = scoreXa(unit.cls, read);
  else {
    const bang = scoreDoThi(unit.cls, read);
    const wards = (unit.members || []).map(m => {
      const xu = xaUnits(period).find(u => u.ma === m.ma);
      return scoreXa(unit.cls, xu ? valueOf(xu) : (() => ''));
    });
    pack = { ...bang, pass: passDoThi(bang, wards) };
  }
  pack.nguon = read.used;
  return pack;
}

function headline(unit, pack) {
  if (unit.loai === 'hue') return pack.complete ? `${pack.dat}/15` : '—';
  return fmt(pack.total);
}

function ketOf(unit, pack) {
  return unit.loai === 'dothi' ? pack.pass.ketLuan : pack.ketLuan;
}

function mauOf(unit, pack) {
  if (unit.loai === 'hue') return pack.complete ? (pack.dat / 15) * 100 : null;
  return pack.total;
}

function hex(s) {
  const n = s.replace('#', '');
  return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16));
}
function mix(a, b, t) {
  const pa = hex(a);
  const pb = hex(b);
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
function ramp(score) {
  const x = Math.max(0, Math.min(1, score / 100));
  return x < 0.75 ? mix('#b91c1c', '#d97706', x / 0.75) : mix('#d97706', '#15803d', (x - 0.75) / 0.25);
}
function paint(unit, pack) {
  const ket = ketOf(unit, pack);
  const mau = mauOf(unit, pack);
  return {
    fill: mau == null ? '#94a3b8' : ramp(mau),
    stroke: ket === 'dat' ? '#15803d' : ket === 'khong' ? '#b91c1c' : '#64748b',
    dash: ket === 'chua' ? '4 3' : null
  };
}

function namesOf(unit) {
  if (unit.loai === 'hue') return Object.keys(DVHC_WARDS);
  if (unit.loai === 'xa') return [unit.ten];
  return unit.members.map(m => fullWardName(m.ma)).filter(Boolean);
}

let scoreUnderPlan = false;

function paintMap() {
  if (!paneOn() || scoreUnderPlan) { clearChamDiemMap(); return; }
  const pieces = unitsNow().map(unit => ({ id: unit.id, names: namesOf(unit), ...paint(unit, packOf(unit)) }));
  paintChamDiemMap(pieces, (id) => {
    picked = id;
    render();
  });
}

function fold(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

function gapText(it) {
  const a = it.thieuMin == null ? '—' : `${fmt(it.thieuMin)}%`;
  const b = it.thieuMax == null ? '—' : `${fmt(it.thieuMax)}%`;
  return `thiếu ${a} so với tối thiểu, ${b} so với tối đa`;
}

function badge(pack, id) {
  const cell = pack.nguon && pack.nguon.get(id);
  if (!cell) return '';
  if (cell.nguon === 'tu_tinh') return '<span class="cd-auto">tự tính</span>';
  if (cell.nguon === 'ghi_de') return '<span class="cd-auto">ghi đè</span>';
  return '';
}

function shownValue(raw) {
  if (raw == null || raw === '') return '';
  const text = String(raw).trim();
  if (/^-?\d+(?:[.,]\d+)?$/.test(text)) return fmt(Number(text.replace(',', '.')));
  return text;
}

function rowHtml(it, pack) {
  const spec = tieuChuan(it.id);
  const ten = spec ? spec.ten : it.id;
  const cell = pack.nguon && pack.nguon.get(it.id);
  const val = shownValue(cell && cell.value);
  const unit = val && spec && spec.donVi && /^-?\d/.test(val) ? ` ${spec.donVi.trim()}` : '';
  const valHtml = val ? `<span class="cd-val">${escapeHtml(val + unit)}</span>` : '';
  const note = (it.notes || []).length ? `<small class="cd-mini">${escapeHtml(it.notes[0])}</small>` : '';
  const why = cell && cell.ghiChu ? `<small class="cd-mini">${escapeHtml(cell.ghiChu)}</small>` : '';
  return `<li><b>${escapeHtml(it.id)}</b> ${escapeHtml(ten)} ${badge(pack, it.id)} ${valHtml} <span>${escapeHtml(gapText(it))}</span>${note}${why}</li>`;
}

function section(title, list, open, pack) {
  if (!list.length) return '';
  return `<details class="cd-fold"${open ? ' open' : ''}><summary>${escapeHtml(title)} (${list.length})</summary><ul class="cd-gaps">${list.map(it => rowHtml(it, pack)).join('')}</ul></details>`;
}

function dropChart() {
  if (chart) { chart.destroy(); chart = null; }
}

function drawChart(unit) {
  dropChart();
  const canvas = document.getElementById('chamDiemChart');
  const note = document.getElementById('chamDiemChartNote');
  const ChartLib = globalThis.Chart;
  if (!canvas || typeof ChartLib === 'undefined') {
    if (note) note.textContent = 'Chưa tải được biểu đồ.';
    return;
  }
  const kys = kysOf(rows).filter(k => parseKy(k).kind === chartKind);
  const points = kys.map(k => {
    const prev = ky;
    ky = k;
    let y = null;
    try {
      const pack = packOf(unit);
      y = unit.loai === 'hue' ? (pack.complete ? pack.dat : null) : pack.total;
    } finally { ky = prev; }
    return y;
  });
  if (!kys.length || points.every(y => y == null)) {
    canvas.hidden = true;
    if (note) note.textContent = chartKind === 'quy' ? 'Chưa có kỳ theo quý đã chấm đủ.' : 'Chưa có kỳ theo năm đã chấm đủ.';
    return;
  }
  canvas.hidden = false;
  if (note) note.textContent = '';
  const css = getComputedStyle(document.documentElement);
  const muted = css.getPropertyValue('--axis-color-muted').trim() || '#94a3b8';
  const accent = css.getPropertyValue('--main-accent').trim() || '#22d3ee';
  const mark = unit.loai === 'hue' ? 10 : 75;
  chart = new ChartLib(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: kys,
      datasets: [
        { label: unit.loai === 'hue' ? 'Số tiêu chuẩn đạt' : 'Tổng điểm', data: points, borderColor: accent, backgroundColor: 'transparent', spanGaps: false, tension: 0.15 },
        { label: unit.loai === 'hue' ? 'Mức 10 tiêu chuẩn' : 'Mức 75 điểm', data: kys.map(() => mark), borderColor: muted, borderDash: [4, 3], pointRadius: 0, fill: false }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, suggestedMax: unit.loai === 'hue' ? 15 : 100, ticks: { color: muted, font: { size: 10 } }, grid: { color: 'rgba(148,163,184,.25)' } },
        x: { ticks: { color: muted, font: { size: 10 } }, grid: { display: false } }
      }
    }
  });
}

function detailHtml(unit, pack) {
  const ket = ketOf(unit, pack);
  const parts = buckets(pack);
  const nhomLine = unit.loai === 'hue'
    ? `Tiêu chí I ${pack.complete ? pack.nhomDat.I : '—'} / 4 · II ${pack.complete ? pack.nhomDat.II : '—'} / 2 · III ${pack.complete ? pack.nhomDat.III : '—'} / 4`
    : ['I', 'II', 'III'].map(k => `Tiêu chí ${k}: ${fmt(pack.nhom[k].diem)} (tối thiểu ${fmt(pack.nhom[k].min)})`).join(' · ');
  let extra = '';
  if (unit.loai === 'dothi') {
    extra = `<p>Điểm trung bình mục III của phường, xã: ${fmt(pack.pass.tbMucIII)}. Số phường, xã đạt Bảng 2B: ${pack.pass.xaDat == null ? '—' : pack.pass.xaDat}.</p>`;
    if (unit.partial) extra += '<p class="cd-mini">Đô thị chỉ chiếm một phần xã; điểm Bảng 2B lấy cả xã.</p>';
  }
  if (unit.loai === 'xa' && unit.note) extra += `<p class="cd-mini">${escapeHtml(unit.note)}</p>`;
  if (unit.loai === 'hue') extra = '<p class="cd-mini">Điều 9.3.a, áp Điều 8.2.d: tối thiểu 10/15 tiêu chuẩn, trong đó tiêu chí I ≥ 4, II ≥ 2, III ≥ 4.</p>';
  const thieu = unit.loai === 'hue' ? '' : `<p>Thiếu so với 75 điểm: ${pack.thieu75 == null ? '—' : fmt(pack.thieu75)}.</p>`;
  const bonus = unit.loai === 'xa'
    ? `<details class="cd-fold"><summary>Điểm cộng ${pack.bonusItems.filter(b => b.status === 'dat').length}/26</summary><ul class="cd-gaps">${pack.bonusItems.map(b => {
      const spec = tieuChuan(b.id);
      const label = b.status === 'chua' ? '—' : (b.status === 'dat' ? `+${fmt(b.diemAp)}` : 'Không');
      return `<li><b>${escapeHtml(b.id)}</b> ${escapeHtml(spec ? spec.ten : '')} ${badge(pack, b.id)} <span>${escapeHtml(label)}</span></li>`;
    }).join('')}</ul></details>`
    : '';
  return `<button type="button" class="cd-back" data-cd-back>Danh sách</button>
    <h3 class="cd-title">${escapeHtml(unit.ten)}</h3>
    <p class="cd-score"><b class="${ketCls[ket] || ''}">${escapeHtml(KET[ket] || ket)}</b> · ${unit.loai === 'hue' ? 'Đạt' : 'Tổng điểm'} <b>${escapeHtml(headline(unit, pack))}</b>${unit.cls && unit.loai !== 'hue' ? ` · loại ${escapeHtml(unit.cls)}` : ''}</p>
    <p>${escapeHtml(nhomLine)}</p>
    ${thieu}${extra}
    <div class="cd-chart-switch" role="group" aria-label="Kỳ biểu đồ">
      <button type="button" data-cd-chart="quy" class="${chartKind === 'quy' ? 'active' : ''}">Quý</button>
      <button type="button" data-cd-chart="nam" class="${chartKind === 'nam' ? 'active' : ''}">Năm</button>
    </div>
    <div class="cd-chart"><canvas id="chamDiemChart" aria-label="Tiến độ theo kỳ"></canvas><p id="chamDiemChartNote" class="cd-mini"></p></div>
    ${section('Đạt', parts.dat, false, pack)}
    ${section('Chưa đạt', parts.khong, true, pack)}
    ${section('Điểm tối thiểu theo Điều 8', parts.dieu8, false, pack)}
    ${section('Đạt tối thiểu, chưa tối đa', parts.motPhan, false, pack)}
    ${section('Chưa đánh giá', parts.chua, parts.chua.length > 0 && parts.chua.length <= 12, pack)}
    ${tayHtml(pack)}
    ${parts.mien.length ? `<p class="cd-mini">Không xem xét: ${parts.mien.map(it => escapeHtml(it.id)).join(', ')}. Giá trị để «—», điểm tối thiểu theo Điều 9.4.a.</p>` : ''}
    ${bonus}
    <details class="cd-fold"><summary>Ghi chú cách chấm</summary><p class="cd-mini">${escapeHtml(NOTE_CHUNG)}</p></details>`;
}

function tayHtml(pack) {
  const rows = [...(pack.items || []), ...(pack.bonusItems || [])].filter(it => {
    const cell = pack.nguon && pack.nguon.get(it.id);
    const src = nguonTieuChi(it.id);
    return cell && cell.nguon === 'trong' && src && src.cheDo === 'tay';
  });
  if (!rows.length) return '';
  const body = rows.map(it => {
    const src = nguonTieuChi(it.id);
    return `<li><b>${escapeHtml(it.id)}</b> ${escapeHtml(src.lyDo)}</li>`;
  }).join('');
  return `<details class="cd-fold"><summary>Nhập tay (${rows.length})</summary><ul class="cd-gaps">${body}</ul></details>`;
}

function listHtml() {
  const q = fold(document.getElementById('layerSearch')?.value || '');
  const units = unitsNow().filter(u => !q || fold(u.ten).includes(q) || fold(u.ma).includes(q));
  if (!units.length) return '<p class="cn-empty">Không khớp</p>';
  return `<ul class="cd-list">${units.map(unit => {
    const pack = packOf(unit);
    const ket = ketOf(unit, pack);
    const on = picked === unit.id ? ' active' : '';
    return `<li><button type="button" class="cd-unit${on}" data-cd-unit="${escapeHtml(unit.id)}"><span>${escapeHtml(unit.ten)}</span><b class="${ketCls[ket] || ''}">${escapeHtml(headline(unit, pack))}</b><small class="${ketCls[ket] || ''}">${escapeHtml(KET[ket])}</small></button></li>`;
  }).join('')}</ul>`;
}

function shellHtml(body) {
  const kys = kysOf(rows);
  if (!kys.includes(ky)) ky = kys[kys.length - 1] || '2026-Q1';
  const options = (kys.length ? kys : ['2026-Q1']).map(k => `<option value="${escapeHtml(k)}"${k === ky ? ' selected' : ''}>${escapeHtml(k)}</option>`).join('');
  const src = nguon === 'sheet' ? 'Google Sheet' : (nguon === 'tep' ? 'File trong repo' : 'Chưa đọc được số liệu');
  const periodBtns = level === 'hue' ? '' : `<div class="cd-switch" role="group" aria-label="Danh sách đô thị"><button type="button" data-cd-period="2030" class="${period === '2030' ? 'active' : ''}">Đến 2030</button><button type="button" data-cd-period="vision" class="${period === 'vision' ? 'active' : ''}">Sau 2030</button></div>`;
  return `<div class="cd-switch" role="tablist" aria-label="Mức chấm">
      <button type="button" data-cd-level="hue" class="${level === 'hue' ? 'active' : ''}">Huế</button>
      <button type="button" data-cd-level="dothi" class="${level === 'dothi' ? 'active' : ''}">Đô thị</button>
      <button type="button" data-cd-level="xa" class="${level === 'xa' ? 'active' : ''}">Phường, xã</button>
    </div>
    ${periodBtns}
    <label class="cd-ky">Kỳ <select id="chamDiemKy" aria-label="Kỳ số liệu">${options}</select></label>
    <p class="cd-mini">${escapeHtml(src)}. NQ 111/2025/UBTVQH15. Tự tính ${tyLeTuDong().auto}/${tyLeTuDong().tong} tiêu chuẩn khi ô trống; bảng ghi đè. ${escapeHtml(level === 'dothi' ? 'Danh sách trùng tab Đô thị, trừ Thành phố Huế.' : (level === 'xa' ? '40 phường, xã; loại theo đô thị đang chọn.' : 'Phụ lục I: đạt hoặc không đạt.'))} Thiếu số liệu: «—».</p>
    <div class="cd-ramp" title="Thang điểm trên bản đồ"></div>
    <p class="cd-mini">Bản đồ: xám là chưa đánh giá; nét đứt là chưa đánh giá; màu theo điểm, nét xanh là đạt, nét đỏ là không đạt.</p>
    ${body}`;
}

function render() {
  const host = rootEl();
  if (!host) return;
  dropChart();
  if (loading) { host.innerHTML = '<p class="cd-mini">Đang đọc số liệu…</p>'; return; }
  const unit = picked ? unitsNow().find(u => u.id === picked) : null;
  const body = unit ? detailHtml(unit, packOf(unit)) : listHtml();
  host.innerHTML = shellHtml(body);
  if (unit) drawChart(unit);
  paintMap();
}

function focus(unit) {
  if (!unit) return;
  if (unit.loai === 'hue') highlightWardBoundary(DVHC_CITY.name);
  else if (unit.loai === 'xa') highlightWardBoundary(unit.ten);
  else {
    const names = namesOf(unit);
    if (names.length) highlightWardNames(names);
  }
}

function ensureAutoLayers() {
  if (autoStarted) return;
  autoStarted = true;
  const again = () => { if (paneOn()) render(); };
  loadNoxhCounts().then(again).catch(again);
  loadHienTrangFacts(URBANS).then(again).catch(again);
  loadPartGeoms().then(again).catch(again);
  Promise.all([
    loadRoadTypeLengths().then(map => { roadLens = map || {}; }).catch(() => { roadLens = {}; }),
    loadBuiltAreas().catch(() => {})
  ]).then(() => { builtReady = true; again(); });
}

async function openTab() {
  ensureAutoLayers();
  if (!loaded && !loading) {
    loading = true;
    render();
    const got = await loadChamDiemRows();
    rows = got.rows;
    index = indexRows(rows);
    nguon = got.nguon;
    const kys = kysOf(rows);
    if (kys.length) ky = kys.includes(ky) ? ky : kys[kys.length - 1];
    loading = false;
    loaded = true;
  }
  if (paneOn()) render();
}

export function initChamDiem() {
  const host = rootEl();
  if (!host) return;
  host.addEventListener('click', (e) => {
    const levelBtn = e.target.closest('[data-cd-level]');
    if (levelBtn) { level = levelBtn.dataset.cdLevel; picked = null; render(); return; }
    const periodBtn = e.target.closest('[data-cd-period]');
    if (periodBtn) { period = periodBtn.dataset.cdPeriod === 'vision' ? 'vision' : '2030'; picked = null; render(); return; }
    const chartBtn = e.target.closest('[data-cd-chart]');
    if (chartBtn) { chartKind = chartBtn.dataset.cdChart === 'nam' ? 'nam' : 'quy'; render(); return; }
    if (e.target.closest('[data-cd-back]')) { picked = null; render(); return; }
    const unitBtn = e.target.closest('[data-cd-unit]');
    if (unitBtn) {
      picked = unitBtn.dataset.cdUnit;
      const unit = unitsNow().find(u => u.id === picked);
      focus(unit);
      render();
    }
  });
  host.addEventListener('change', (e) => {
    if (e.target.id === 'chamDiemKy') { ky = e.target.value; render(); }
  });
  document.getElementById('layerMain')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-admin-tab]');
    if (!tab) return;
    if (tab.dataset.adminTab === 'chamdiem') openTab();
    else clearChamDiemMap();
  });
  document.addEventListener('qh:axis-tab', (e) => {
    if (e.detail?.id !== 'hanhchinh') clearChamDiemMap();
    else if (paneOn()) paintMap();
  });
  document.addEventListener('qh:view-column', (e) => {
    scoreUnderPlan = e.detail?.mode === 'QH';
    const admin = document.getElementById('layerPaneHanhChinh');
    if (!admin || admin.hidden || !paneOn()) return;
    paintMap();
  });
  document.getElementById('layerSearch')?.addEventListener('input', () => { if (paneOn() && !picked) render(); });
  window.addEventListener(WARD_BOUNDS_EVENT, () => { if (paneOn()) paintMap(); });
}
