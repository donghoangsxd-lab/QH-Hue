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

function rangeText(min, max, unit) {
  if (min == null || max == null) return '—';
  const a = fmtNum(min);
  const b = fmtNum(max);
  return unit ? `${a} – ${b} ${unit}` : `${a} – ${b}`;
}

function popCell(nam) {
  const dan = mocOf(byId('dan-so'), nam);
  const hoa = mocOf(byId('ty-le-do-thi-hoa'), nam);
  const dl = mocOf(byId('khach-du-lich'), nam);
  if (!dan && !hoa && !dl) return '';
  const danTxt = dan
    ? `${dan.cachGhi === 'có thể dung nạp tối đa khoảng' ? 'tối đa khoảng ' : 'khoảng '}${fmtNum(dan.giaTri)} người`
    : '—';
  const hoaTxt = hoa ? `khoảng ${fmtNum(hoa.giaTri)}%` : '—';
  const dlTxt = dl ? rangeText(dl.min, dl.max, 'triệu lượt') : '—';
  const label = nam === 2065 ? 'Tầm nhìn 2065' : `Năm ${nam}`;
  return `<tr><th scope="row">${label}</th><td>${escapeHtml(danTxt)}</td><td>${escapeHtml(hoaTxt)}</td><td>${escapeHtml(dlTxt)}</td></tr>`;
}

function landCell(nam) {
  const m = mocOf(byId('dat-xay-dung'), nam);
  if (!m) return '';
  const m2 = m.datDanDungM2Nguoi
    ? rangeText(m.datDanDungM2Nguoi.min, m.datDanDungM2Nguoi.max, 'm²/người')
    : '—';
  return `<tr>
    <th scope="row">Năm ${nam}</th>
    <td>khoảng ${fmtNum(m.giaTri)} ha</td>
    <td>khoảng ${fmtNum(m.danDungHa)} ha</td>
    <td>${escapeHtml(m2)}</td>
    <td>khoảng ${fmtNum(m.ngoaiDanDungHa)} ha</td>
    <td>khoảng ${fmtNum(m.diemDanCuNongThonHa)} ha</td>
  </tr>`;
}

export function qhc25ScaleHtml() {
  if (!doc) return '<p class="qhc25-scale-empty">Đang tải chỉ tiêu quy mô…</p>';
  const qd = doc.quyetDinh || {};
  const cite = qd.so && qd.ngay
    ? `Theo ${qd.so} ngày ${String(qd.ngay).slice(8, 10)}/${String(qd.ngay).slice(5, 7)}/${String(qd.ngay).slice(0, 4)}`
    : 'Theo Quyết định 108/QĐ-TTg';
  return `<div class="qhc25-scale-card">
    <h4 class="qhc25-scale-title">Chỉ tiêu quy mô đồ án</h4>
    <p class="qhc25-scale-cite">${escapeHtml(cite)}</p>
    <h5 class="qhc25-scale-h">a) Quy mô dân số, tỷ lệ đô thị hóa</h5>
    <div class="qhc25-scale-scroll">
      <table class="qhc25-scale-table">
        <thead><tr><th scope="col">Giai đoạn</th><th scope="col">Dân số toàn đô thị</th><th scope="col">Đô thị hóa</th><th scope="col">Khách du lịch</th></tr></thead>
        <tbody>${popCell(2030)}${popCell(2045)}${popCell(2065)}</tbody>
      </table>
    </div>
    <p class="qhc25-scale-note">${escapeHtml(POP_NOTE)}</p>
    <h5 class="qhc25-scale-h">b) Quy mô đất đai</h5>
    <p class="qhc25-scale-note">${escapeHtml(LAND_NOTE)}</p>
    <div class="qhc25-scale-scroll">
      <table class="qhc25-scale-table">
        <thead><tr><th scope="col">Giai đoạn</th><th scope="col">Đất xây dựng</th><th scope="col">Đất dân dụng</th><th scope="col">Chỉ tiêu ĐD</th><th scope="col">Ngoài dân dụng</th><th scope="col">Điểm DC nông thôn</th></tr></thead>
        <tbody>${landCell(2030)}${landCell(2045)}</tbody>
      </table>
    </div>
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

/** HTML chỉ tiêu QĐ 108 (đã load). Dùng chung brief QHC 1/25.000 và 1/10.000 — cùng một đồ án. */
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
