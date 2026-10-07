// Khoanh vùng trong từng phường (logic tạm để thử nghiệm, sau này lấy ranh từ đồ án quy hoạch):
//   vùng hiện trạng (ranh đỏ)       = đất đã xây dựng đến năm gốc (GAIA 30 m 1985–2018 ∪ GHSL 100 m)
//   vùng phát triển mới (ranh xanh) = đất xây dựng hiện nay (Dynamic World 10 m) − vùng hiện trạng
//   đất xây dựng hiện nay = vùng hiện trạng + vùng phát triển mới (cũng là mẫu số mật độ đường, wardRoads.js)
// QCVN 01:2026/BXD Mục 2.2.3.2 (công viên, vườn hoa mỗi đơn vị ở) và Mục 2.2.3.3 (vườn hoa, bãi đỗ xe ≤ 400 m) chỉ áp trong
// vùng phát triển mới của phường bộ chỉ tiêu đô thị, không áp cho cả phường. Số liệu tính trên GEE (api/gee.js › getNewDevStats,
// services/satService.js › newDevImage), bảng chi tiết phường luôn dùng năm gốc DEV_FROM_DEFAULT.
import { geeApi } from './api.js';
import { escapeHtml, fmtNum } from './utils.js';

export const DEV_FROM_DEFAULT = 2020;
export const DEV_REF = 'QCVN 01:2026/BXD Mục 2.2.3.2, 2.2.3.3';
export const DEV_MIN_ZOOM = 12;
const DW_FIRST_YEAR = 2016; // khớp services/satService.js
const HA = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const BASIS = 'Vùng hiện trạng: đất đã xây dựng đến năm gốc (GAIA – ĐH Thanh Hoa, Landsat 30 m, 1985–2018, hợp với GHSL – JRC, '
  + 'ô 100 m có ≥ 15% diện tích công trình; năm gốc từ 2016 hợp thêm Dynamic World năm đó). Vùng phát triển mới: đất xây dựng hiện nay (Google Dynamic World 10 m, nhãn chiếm ưu thế '
  + 'tháng 1–8 của mùa khô gần nhất, gồm cả đất đang san nền sát khu đã xây dựng) nằm ngoài vùng hiện trạng. Bỏ mảng < 0,5 ha. '
  + 'Tổng đất xây dựng = vùng hiện trạng + vùng phát triển mới, cũng là mẫu số mật độ đường. Logic tạm để thử nghiệm, sau này lấy ranh từ đồ án quy hoạch.';
const DW_NOTE = 'Bản đồ Dynamic World gộp chung các đường, khu công nghiệp, nghĩa trang xây dựng mới vào "Đất xây dựng"; đất đang san nền có thể gồm bãi khai thác cát, ruộng bỏ hoang. Cần kiểm tra kỹ hiện trạng trước khi kết luận.';

/** "2026" hoặc "2024–2025" (bản cũ còn trong bộ nhớ đệm trả về 2 năm) */
export const yearsText = (to) => (to[0] === to[1] ? String(to[0]) : `${to[0]}–${to[1]}`);

// Năm gốc so sánh: khớp DEV_FROM_YEARS trong services/satService.js
export const devFromYears = () => ({ years: [2020, 2010, 2000], partial: null, def: DEV_FROM_DEFAULT });

const promises = new Map();
const results = new Map();

export function loadNewDevStats(from = DEV_FROM_DEFAULT) {
  const key = String(from);
  if (!promises.has(key)) {
    promises.set(key, fetch(geeApi(`action=getNewDevStats&from=${key}`))
      .then(async r => {
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || !Array.isArray(d.wards)) throw new Error((d && d.message) || `HTTP ${r.status}`);
        results.set(key, d);
        return d;
      })
      .catch(err => {
        promises.delete(key);
        throw err;
      }));
  }
  return promises.get(key);
}

const periodText = (d) => `${d.from} → ${yearsText(d.to)}`;

/** { d, w } của 1 phường theo năm gốc mặc định; null khi chưa tải hoặc phường không có trong thống kê */
export function newDevOf(wardName) {
  const d = results.get(String(DEV_FROM_DEFAULT));
  const w = d && d.wards.find(x => x.name === wardName);
  return w ? { d, w } : null;
}

const pctClass = (v) => (v == null ? '' : v >= 80 ? 'c-green' : v >= 50 ? 'c-orange' : 'c-red');
const pctText = (v) => (v == null ? '–' : `${HA.format(v)}%`);

// Mục 2.2.3.2 trong vùng phát triển mới: số đơn vị ở theo dân số ước tính, đạt khi đủ công viên ≥ large hoặc cặp ≥ medium
function zoneParkRule(d, w) {
  const units = w.devPop > 0 ? Math.ceil(w.devPop / d.unitPop) : 1;
  const rule = d.parkRule;
  const large = w.parks.filter(p => p.size >= rule.large).length;
  const medium = w.parks.filter(p => p.size >= rule.medium && p.size < rule.large).length;
  return { units, ok: Math.min(units, large + Math.floor(medium / 2)), rule };
}

/** 2 dòng Mục 2.2.3.2, 2.2.3.3 cho vùng phát triển mới trong bảng phường ('' khi chưa có số liệu) */
export function newDevRowHtml(wardName) {
  const r = newDevOf(wardName);
  if (!r) return '';
  const { d, w } = r;
  const period = escapeHtml(periodText(d));
  const zoneTitle = `Vùng hiện trạng (ranh đỏ) ≈ ${HA.format(w.baseHa)} ha; vùng phát triển mới (ranh xanh) ≈ ${HA.format(w.devHa)} ha, `
    + `≈ ${fmtNum(w.devPop)} người (dân số phường × tỷ lệ ô dân cư nằm trong vùng).\n${BASIS}`;
  if (!(w.devHa > 0)) {
    return `<tr class="wt-comp">
    <td></td>
    <td title="${zoneTitle}">Vùng phát triển mới (Mục 2.2.3.2, 2.2.3.3)</td>
    <td>0 ha</td>
    <td colspan="5" class="wt-note wt-dev-note" title="${zoneTitle}">Không có vùng phát triển mới ${period}: Mục 2.2.3.2, 2.2.3.3 không áp dụng
      <span class="wt-light">(vùng hiện trạng ≈ ${HA.format(w.baseHa)} ha)</span></td>
  </tr>`;
  }
  const { units, ok, rule } = zoneParkRule(d, w);
  const ruleTitle = `${DEV_REF}: mỗi đơn vị ở phát triển mới (${fmtNum(d.unitPop)} người) có ≥ 1 công viên ≥ ${fmtNum(rule.large)} m² `
    + `hoặc 2 công viên ≥ ${fmtNum(rule.medium)} m². Chỉ tính công viên/vườn hoa đã duyệt nằm trong vùng phát triển mới; công viên chưa rõ diện tích (quy mô 0) không được tính.`;
  const parkList = w.parks.length
    ? w.parks.slice(0, 3).map(p => `${escapeHtml(p.name || p.id)} (${p.size > 0 ? `${fmtNum(p.size)} m²` : 'chưa rõ DT'})`).join(', ') + (w.parks.length > 3 ? `, +${w.parks.length - 3}` : '')
    : 'chưa có công viên/vườn hoa trong vùng';
  const covTitle = `${DEV_REF}: vườn hoa, sân chơi, bãi đỗ xe phục vụ nhóm nhà ở phát triển mới ≤ ${d.serviceM} m đến đại đa số dân cư. `
    + `Tỷ lệ = phần diện tích vùng phát triển mới ${periodText(d)} nằm trong ${d.serviceM} m (đường chim bay) quanh công viên/vườn hoa hoặc bãi đỗ xe hiện trạng đã duyệt.`;
  return `<tr class="wt-comp">
    <td></td>
    <td title="${zoneTitle}">Vùng phát triển mới · công viên (Mục 2.2.3.2)</td>
    <td title="${zoneTitle}">≈ ${HA.format(w.devHa)} ha<br><span class="wt-light">≈ ${fmtNum(w.devPop)} người</span></td>
    <td colspan="5" class="wt-note wt-dev-note" title="${ruleTitle}"><b class="${ok >= units ? 'c-green' : 'c-red'}">${ok}/${units} ĐVỞ đạt QM</b>
      · ${parkList} <span class="wt-light">(${period}, bật lớp "Vùng phát triển mới" để xem ranh đỏ/xanh)</span></td>
  </tr>
  <tr class="wt-comp">
    <td></td>
    <td title="${covTitle}">Vùng phát triển mới · ≤ ${d.serviceM} m (Mục 2.2.3.3)</td>
    <td></td>
    <td colspan="5" class="wt-note wt-dev-note" title="${covTitle}">Trong ${d.serviceM} m: vườn hoa <b class="${pctClass(w.parkPct)}">${pctText(w.parkPct)}</b> · bãi đỗ xe <b class="${pctClass(w.parkingPct)}">${pctText(w.parkingPct)}</b> diện tích vùng phát triển mới</td>
  </tr>`;
}

/** Chú giải và thống kê cho bảng lớp vệ tinh (satLayers.js) */
export function devLegend(legend) {
  return `<div><span class="sat-swatch dev-swatch" style="--c:${legend.baseColor}"></span>Vùng hiện trạng (đã xây dựng đến ${legend.from})</div>`
    + `<div><span class="sat-swatch dev-swatch" style="--c:${legend.color}"></span>Vùng phát triển mới (${legend.from} → ${yearsText(legend.to)})</div>`
    + `<div class="flood-muted" title="${BASIS}">Phóng to từ mức ${DEV_MIN_ZOOM} để xem ranh. Cơ sở: Dynamic World ${yearsText(legend.to)} − (GAIA ∪ GHSL${legend.from >= DW_FIRST_YEAR ? ' ∪ Dynamic World' : ''}) ${legend.from}. Logic tạm, sau này lấy ranh từ quy hoạch. ${DW_NOTE}</div>`;
}

const sumOf = (rows, k) => rows.reduce((s, w) => s + (Number(w[k]) || 0), 0);

// Bảng đủ 40 phường/xã, xếp theo tổng đất xây dựng giảm dần
function wardTable(d) {
  const rows = [...d.wards].sort((a, b) => (b.baseHa + b.devHa) - (a.baseHa + a.devHa));
  const row = (w) => `<tr><td>${escapeHtml(w.name)}</td>`
    + `<td>${HA.format(w.baseHa + w.devHa)}</td><td>${HA.format(w.baseHa)}</td><td>${HA.format(w.devHa)}</td></tr>`;
  return `<details class="dev-ward-table"><summary>Chi tiết ${rows.length} phường/xã (ha)</summary>
    <table><thead><tr><th>Phường/xã</th><th>Tổng ${d.to[1]}</th><th>Trước ${d.from}</th><th>Mới</th></tr></thead>
    <tbody>${rows.map(row).join('')}</tbody></table></details>`;
}

export function devStats(d) {
  const baseSum = sumOf(d.wards, 'baseHa'), devSum = sumOf(d.wards, 'devHa');
  const dt = d.wards.filter(w => w.dt !== false);
  const dtDev = sumOf(dt, 'devHa');
  const weighted = (k) => {
    const part = dt.reduce((s, w) => s + (w[k] == null ? 0 : w[k] * w.devHa), 0);
    return dtDev > 0 ? part / dtDev : null;
  };
  const top = [...d.wards].filter(w => w.devHa > 0).sort((a, b) => b.devHa - a.devHa);
  const chip = (w) => `<span>${escapeHtml(w.name)} <b>${HA.format(w.devHa)} ha</b></span>`;
  const park = weighted('parkPct'), parking = weighted('parkingPct');
  return `<div class="flood-kpi" title="${BASIS}"><span>Tổng diện tích đất xây dựng (${yearsText(d.to)}, ${d.wards.length} phường/xã)</span><b>≈ ${HA.format(baseSum + devSum)} ha</b></div>
    <div class="flood-kpi"><span>Đất xây dựng trước ${d.from} (ranh đỏ)</span><b>≈ ${HA.format(baseSum)} ha</b></div>
    <div class="flood-kpi"><span>Đất xây dựng mới từ ${d.from} → nay (ranh xanh)</span><b>≈ ${HA.format(devSum)} ha · ≈ ${fmtNum(sumOf(d.wards, 'devPop'))} người</b></div>
    ${top.length ? `<div class="flood-sub">Phát triển mới nhiều nhất</div><div class="flood-wards">${top.slice(0, 6).map(chip).join('')}</div>` : ''}
    <div class="flood-kpi" title="${DEV_REF}: chỉ xét vùng phát triển mới của ${dt.length} phường bộ chỉ tiêu đô thị"><span>Trong ${d.serviceM} m vườn hoa / bãi đỗ xe (${dt.length} phường đô thị)</span><b><span class="${pctClass(park)}">${pctText(park)}</span> / <span class="${pctClass(parking)}">${pctText(parking)}</span></b></div>
    ${wardTable(d)}
    <div class="flood-muted">Tổng đất xây dựng cũng là mẫu số mật độ đường giao thông. ${DW_NOTE}</div>`;
}
