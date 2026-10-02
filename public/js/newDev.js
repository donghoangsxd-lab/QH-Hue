// Khoanh vùng trong từng phường (logic tạm để thử nghiệm, sau này lấy ranh từ đồ án quy hoạch):
//   vùng hiện trạng (ranh đỏ)       = đất đã xây dựng đến năm gốc (GAIA 30 m 1985–2018 ∪ GHSL 100 m)
//   vùng phát triển mới (ranh xanh) = đất xây dựng hiện nay (Dynamic World 10 m) − vùng hiện trạng
// QCVN 01:2026/BXD Mục 2.2.3.2 (công viên, vườn hoa mỗi đơn vị ở) và Mục 2.2.3.3 (vườn hoa, bãi đỗ xe ≤ 400 m) chỉ áp trong
// vùng phát triển mới, không áp cho cả phường. Số liệu tính trên GEE (api/gee.js › getNewDevStats,
// services/satService.js › newDevImage), bảng chi tiết phường luôn dùng năm gốc DEV_FROM_DEFAULT.
import { geeApi } from './api.js';
import { escapeHtml, fmtNum } from './utils.js';

export const DEV_FROM_DEFAULT = 2020;
export const DEV_REF = 'QCVN 01:2026/BXD Mục 2.2.3.2, 2.2.3.3';
export const DEV_MIN_ZOOM = 12;
const HA = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const BASIS = 'Vùng hiện trạng: đất đã xây dựng đến năm gốc (GAIA – ĐH Thanh Hoa, Landsat 30 m, 1985–2018, hợp với GHSL – JRC, '
  + 'ô 100 m có ≥ 15% diện tích công trình; năm gốc từ 2016 hợp thêm Dynamic World năm đó). Vùng phát triển mới: đất xây dựng hiện nay (Google Dynamic World 10 m, nhãn chiếm ưu thế '
  + 'tháng 1–8) nằm ngoài vùng hiện trạng. Bỏ mảng < 0,5 ha. Logic tạm để thử nghiệm, sau này lấy ranh từ đồ án quy hoạch.';

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

const periodText = (d) => `${d.from} → ${d.to[0]}–${d.to[1]}`;

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
    + `<div><span class="sat-swatch dev-swatch" style="--c:${legend.color}"></span>Vùng phát triển mới (${legend.from} → ${legend.to[0]}–${legend.to[1]})</div>`
    + `<div class="flood-muted" title="${BASIS}">Phóng to từ mức ${DEV_MIN_ZOOM} để xem ranh. Cơ sở: Dynamic World ${legend.to[0]}–${legend.to[1]} − (GAIA ∪ GHSL) ${legend.from}. Logic tạm, sau này lấy ranh từ quy hoạch.</div>`;
}

export function devStats(d) {
  const sum = (k) => d.wards.reduce((s, w) => s + (Number(w[k]) || 0), 0);
  const devSum = sum('devHa');
  const weighted = (k) => {
    const part = d.wards.reduce((s, w) => s + (w[k] == null ? 0 : w[k] * w.devHa), 0);
    return devSum > 0 ? part / devSum : null;
  };
  const top = d.wards.filter(w => w.devHa > 0);
  const chip = (w) => `<span>${escapeHtml(w.name)} <b>${HA.format(w.devHa)} ha</b></span>`;
  const park = weighted('parkPct'), parking = weighted('parkingPct');
  return `<div class="flood-kpi"><span>Vùng hiện trạng đến ${d.from} (${d.wards.length} phường)</span><b>≈ ${HA.format(sum('baseHa'))} ha</b></div>
    <div class="flood-kpi"><span>Vùng phát triển mới ${d.from} → nay</span><b>≈ ${HA.format(devSum)} ha · ≈ ${fmtNum(sum('devPop'))} người</b></div>
    ${top.length ? `<div class="flood-sub">Phát triển mới nhiều nhất</div><div class="flood-wards">${top.slice(0, 6).map(chip).join('')}</div>` : ''}
    <div class="flood-kpi"><span>Trong ${d.serviceM} m vườn hoa / bãi đỗ xe</span><b><span class="${pctClass(park)}">${pctText(park)}</span> / <span class="${pctClass(parking)}">${pctText(parking)}</span></b></div>
    <div class="flood-muted">Dynamic World gộp cả đường, khu công nghiệp vào "đất xây dựng", cần đối chiếu đồ án quy hoạch trước khi kết luận.</div>`;
}
