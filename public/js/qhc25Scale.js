// Chỉ tiêu quy mô dân số và đất đai QHC đô thị Thừa Thiên Huế 1/25.000 (QĐ 108/QĐ-TTg).
// Số lấy từ public/data/htkt/qd-108-htkt.json — không tính lại trên máy chủ.
import { withAssetVersion } from './gbaVersion.js';
import { escapeHtml, fmtNum } from './utils.js';
import { setLevel } from './mapLevel.js';
import { planMap, getViewMode, setViewMode, isSplitOn } from './planMap.js';

const DOC_URL = 'data/htkt/qd-108-htkt.json';
const LAND_NOTE = 'Chỉ tiêu sử dụng đất đô thị Thừa Thiên Huế được áp dụng các yếu tố đặc thù của đô thị di sản, văn hoá, cảnh quan, tuân thủ Quy chuẩn kỹ thuật quốc gia về quy hoạch xây dựng cho các khu vực phát triển mới của đô thị.';
const POP_NOTE = 'Dự báo và phân bổ quy mô dân số toàn đô thị Thừa Thiên Huế theo các giai đoạn phát triển xem Phụ lục I.';

let doc = null;
let task = null;

function byId(id) {
  return (doc && doc.soLieu || []).find(row => row.id === id) || null;
}

function mocOf(row, nam) {
  return (row && row.moc || []).find(m => Number(m.nam) === nam) || null;
}

function prefixHtml(prefix) {
  const text = String(prefix || '').trim();
  if (!text) return '';
  const m = text.match(/^(.*\S)\s+(khoảng)$/i);
  const bits = m ? [m[1], m[2]] : [text];
  return `<span class="qhc25-k">${bits.map(bit => `<span>${escapeHtml(bit)}</span>`).join('')}</span>`;
}

function qtyHtml(prefix, value, unit) {
  const pre = prefixHtml(prefix);
  const shown = value == null || value === '' ? '—' : String(value);
  const u = unit ? `<small>${escapeHtml(unit)}</small>` : '';
  return `<span class="qhc25-qty">${pre}<span class="qhc25-n"><b>${escapeHtml(shown)}</b>${u}</span></span>`;
}

const dash = () => qtyHtml('', '—');

function approxPrefix(row) {
  return /tối đa/i.test(String((row && row.cachGhi) || '')) ? 'tối đa khoảng' : 'khoảng';
}

const POP_YEARS = [2030, 2045, 2065];
const LAND_YEARS = [2030, 2045];

function yearHeads(years) {
  return years.map(nam => (
    nam === 2065
      ? '<th scope="col" title="Tầm nhìn đến năm 2065">2065</th>'
      : `<th scope="col">${nam}</th>`
  )).join('');
}

function rowHtml(label, title, cells) {
  const tip = title && title !== label ? ` title="${escapeHtml(title)}"` : '';
  return `<tr><th scope="row"${tip}>${escapeHtml(label)}</th>${cells.map(html => `<td>${html}</td>`).join('')}</tr>`;
}

function popTable() {
  const dan = POP_YEARS.map(nam => {
    const row = mocOf(byId('dan-so'), nam);
    if (!row || row.giaTri == null) return dash();
    return qtyHtml(approxPrefix(row), fmtNum(row.giaTri), 'người');
  });
  const hoa = POP_YEARS.map(nam => {
    const row = mocOf(byId('ty-le-do-thi-hoa'), nam);
    if (!row || row.giaTri == null) return dash();
    return qtyHtml(approxPrefix(row), `${fmtNum(row.giaTri)}%`);
  });
  const dl = POP_YEARS.map(nam => {
    const row = mocOf(byId('khach-du-lich'), nam);
    if (!row || row.min == null || row.max == null) return dash();
    return qtyHtml('', `${fmtNum(row.min)} – ${fmtNum(row.max)}`, 'triệu lượt');
  });
  return `<table class="qhc25-scale-table qhc25-scale-pop">
    <thead><tr><th scope="col">Chỉ tiêu</th>${yearHeads(POP_YEARS)}</tr></thead>
    <tbody>
      ${rowHtml('Dân số', 'Dân số toàn đô thị', dan)}
      ${rowHtml('Đô thị hóa', '', hoa)}
      ${rowHtml('Khách du lịch', '', dl)}
    </tbody>
  </table>`;
}

function landTable() {
  const at = (nam) => mocOf(byId('dat-xay-dung'), nam);
  const haCells = (key) => LAND_YEARS.map(nam => {
    const m = at(nam);
    const n = m ? m[key] : null;
    if (n == null) return dash();
    return qtyHtml('khoảng', fmtNum(n), 'ha');
  });
  const chiTieu = LAND_YEARS.map(nam => {
    const r = at(nam) && at(nam).datDanDungM2Nguoi;
    if (!r || r.min == null || r.max == null) return dash();
    return qtyHtml('', `${fmtNum(r.min)} – ${fmtNum(r.max)}`, 'm²/người');
  });
  return `<table class="qhc25-scale-table qhc25-scale-land">
    <thead><tr><th scope="col">Chỉ tiêu</th>${yearHeads(LAND_YEARS)}</tr></thead>
    <tbody>
      ${rowHtml('Đất xây dựng', '', haCells('giaTri'))}
      ${rowHtml('Đất dân dụng', '', haCells('danDungHa'))}
      ${rowHtml('Chỉ tiêu ĐD', 'Chỉ tiêu đất dân dụng', chiTieu)}
      ${rowHtml('Ngoài dân dụng', 'Đất ngoài dân dụng', haCells('ngoaiDanDungHa'))}
      ${rowHtml('Điểm DC nông thôn', 'Điểm dân cư nông thôn', haCells('diemDanCuNongThonHa'))}
    </tbody>
  </table>`;
}

export function qhc25ScaleHtml() {
  if (!doc) return '<p class="qhc25-scale-empty">Đang tải chỉ tiêu quy mô…</p>';
  const qd = doc.quyetDinh || {};
  const cite = qd.so && qd.ngay
    ? `${qd.so} ngày ${String(qd.ngay).slice(8, 10)}/${String(qd.ngay).slice(5, 7)}/${String(qd.ngay).slice(0, 4)}`
    : '108/QĐ-TTg';
  return `<div class="qhc25-scale-card" title="${escapeHtml(cite)}">
    <h5 class="qhc25-scale-h">a) Quy mô dân số, tỷ lệ đô thị hóa</h5>
    ${popTable()}
    <p class="qhc25-scale-note">${escapeHtml(POP_NOTE)}</p>
    <h5 class="qhc25-scale-h">b) Quy mô đất đai</h5>
    <p class="qhc25-scale-note">${escapeHtml(LAND_NOTE)}</p>
    ${landTable()}
  </div>`;
}

function paintHost() {
  const host = document.getElementById('qhc25Scale');
  if (!host) return;
  host.innerHTML = qhc25ScaleHtml();
}

export async function loadQhc25Scale() {
  if (doc) return doc;
  if (task) return task;
  task = fetch(withAssetVersion(DOC_URL))
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(json => {
      doc = json;
      paintHost();
      return doc;
    })
    .catch(err => {
      task = null;
      const host = document.getElementById('qhc25Scale');
      if (host) host.innerHTML = `<p class="qhc25-scale-empty">Không tải được chỉ tiêu quy mô (${escapeHtml(err.message)}).</p>`;
      console.warn('QHC25 scale', err);
      throw err;
    });
  return task;
}

function openLayers() {
  const box = document.getElementById('qhc25Layers');
  const btn = document.querySelector('[data-qhc-expand="25"]');
  if (box) box.hidden = false;
  if (btn) {
    btn.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    btn.title = 'Ẩn các lớp dữ liệu';
  }
}

/** HTML chỉ tiêu QĐ 108 (đã load). Chỉ dùng brief / danh sách lớp QHC 1/25.000. */
export function qhcScaleBriefHtml() {
  return qhc25ScaleHtml();
}

export function revealQhc25Scale() {
  setLevel('qhc25', { keepView: true });
  if (planMap && !isSplitOn() && getViewMode() !== 'QH') setViewMode('QH');
  openLayers();
  paintHost();
  const host = document.getElementById('qhc25Scale');
  if (host) {
    host.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    host.classList.add('is-flash');
    window.setTimeout(() => host.classList.remove('is-flash'), 1200);
  }
}

export function initQhc25Scale() {
  if (!document.getElementById('qhc25Scale')) return;
  paintHost();
  loadQhc25Scale().catch(() => { /* đã hiện lỗi trên host */ });
  document.querySelector('[data-qhc-info="25"]')?.addEventListener('click', () => {
    revealQhc25Scale();
    loadQhc25Scale().catch(() => {});
  });
}
