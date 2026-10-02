// Vùng phát triển mới = đất xây dựng hiện nay (Dynamic World 10 m) − đất đã xây dựng đến năm gốc (GAIA 30 m, 1985–2018):
// xác định phường có đơn vị ở / nhóm nhà ở phát triển mới để áp đúng QCVN 01:2026/BXD Mục 2.2.3.2 (công viên, vườn hoa
// mỗi đơn vị ở) và Mục 2.2.3.3 (vườn hoa, bãi đỗ xe ≤ 400 m). Số liệu tính trên GEE (api/gee.js › getNewDevStats,
// services/satService.js › newDevImage), bảng chi tiết phường luôn dùng năm gốc DEV_FROM_DEFAULT.
import { geeApi } from './api.js';
import { escapeHtml, fmtNum } from './utils.js';

export const DEV_FROM_DEFAULT = 2000;
export const DEV_REF = 'QCVN 01:2026/BXD Mục 2.2.3.2, 2.2.3.3';
export const DEV_MIN_ZOOM = 12;
const HA = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const BASIS = 'Đất xây dựng hiện nay (Google Dynamic World 10 m, nhãn chiếm ưu thế tháng 1–8) trừ đất đã là bề mặt không thấm nước '
  + 'đến năm gốc (GAIA – ĐH Thanh Hoa, Landsat 30 m, 1985–2018); bỏ mảng < 0,5 ha';

// Năm gốc so sánh: khớp DEV_FROM_YEARS trong services/satService.js
export const devFromYears = () => ({ years: [2010, 2000, 1990], partial: null, def: DEV_FROM_DEFAULT });

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

/** { d, w, applies } của 1 phường theo năm gốc mặc định; null khi chưa tải hoặc phường không có trong thống kê */
export function newDevOf(wardName) {
  const d = results.get(String(DEV_FROM_DEFAULT));
  const w = d && d.wards.find(x => x.name === wardName);
  return w ? { d, w, applies: w.devHa >= d.minHa } : null;
}

/** Hậu tố cho ô Mục 2.2.3.2 trong bảng phường: phường có thuộc diện phát triển mới hay không */
export function parkRuleScopeHtml(wardName) {
  const r = newDevOf(wardName);
  if (!r) return '';
  const title = `${DEV_REF}: chỉ áp cho đơn vị ở phát triển mới. Đất phát triển mới ${periodText(r.d)}: ≈ ${HA.format(r.w.devHa)} ha; `
    + `ngưỡng coi là có khu phát triển mới: ${fmtNum(r.d.minHa)} ha.\n${BASIS}`;
  return r.applies
    ? `<br><span class="dev-tag dev-on" title="${title}">Thuộc diện áp dụng · xây mới ≈ ${HA.format(r.w.devHa)} ha</span>`
    : `<br><span class="dev-tag" title="${title}">Khu hiện hữu, không thuộc diện áp dụng</span>`;
}

const pctClass = (v) => (v == null ? '' : v >= 80 ? 'c-green' : v >= 50 ? 'c-orange' : 'c-red');
const pctText = (v) => (v == null ? '–' : `${HA.format(v)}%`);

/** Dòng Mục 2.2.3.3 trong bảng phường ('' khi chưa có số liệu hoặc phường không có khu phát triển mới) */
export function newDevRowHtml(wardName) {
  const r = newDevOf(wardName);
  if (!r || !r.applies) return '';
  const { d, w } = r;
  const title = `${DEV_REF}: vườn hoa, sân chơi, bãi đỗ xe phục vụ nhóm nhà ở phát triển mới ≤ ${d.serviceM} m đến đại đa số dân cư. `
    + `Tỷ lệ = phần đất xây dựng mới ${periodText(d)} nằm trong ${d.serviceM} m (đường chim bay) quanh công viên/vườn hoa hoặc bãi đỗ xe hiện trạng đã duyệt.`;
  return `<tr class="wt-comp">
    <td></td>
    <td title="${title}">Vùng phát triển mới (Mục 2.2.3.3)</td>
    <td>≈ ${HA.format(w.devHa)} ha</td>
    <td colspan="5" class="wt-note wt-dev-note" title="${title}">Trong ${d.serviceM} m: vườn hoa <b class="${pctClass(w.parkPct)}">${pctText(w.parkPct)}</b> · bãi đỗ xe <b class="${pctClass(w.parkingPct)}">${pctText(w.parkingPct)}</b> diện tích xây mới
      <span class="wt-light">(${escapeHtml(periodText(d))}, bật lớp "Vùng phát triển mới" để xem ranh)</span></td>
  </tr>`;
}

/** Chú giải và thống kê cho bảng lớp vệ tinh (satLayers.js) */
export function devLegend(legend) {
  return `<span class="sat-swatch dev-swatch" style="--c:${legend.color}"></span>Phát triển mới sau ${legend.from} (đất xây dựng ${legend.to[0]}–${legend.to[1]} trừ đất đã xây dựng năm ${legend.from})`
    + `<div class="flood-muted" title="${BASIS}">Phóng to từ mức ${DEV_MIN_ZOOM} để xem ranh. Cơ sở: Dynamic World ${legend.to[0]}–${legend.to[1]} − GAIA ${legend.from}.</div>`;
}

export function devStats(d) {
  const applies = d.wards.filter(w => w.devHa >= d.minHa);
  const total = d.wards.reduce((s, w) => s + w.devHa, 0);
  const devSum = applies.reduce((s, w) => s + w.devHa, 0);
  const weighted = (k) => {
    const part = applies.reduce((s, w) => s + (w[k] == null ? 0 : w[k] * w.devHa), 0);
    return devSum > 0 ? part / devSum : null;
  };
  const chip = (w) => `<span>${escapeHtml(w.name)} <b>${HA.format(w.devHa)} ha</b></span>`;
  const park = weighted('parkPct'), parking = weighted('parkingPct');
  return `<div class="flood-kpi"><span>Phát triển mới sau ${d.from} (${d.wards.length} phường)</span><b>≈ ${HA.format(total)} ha</b></div>
    <div class="flood-kpi"><span>Phường thuộc diện Mục 2.2.3.2</span><b>${applies.length}/${d.wards.length}</b></div>
    ${applies.length ? `<div class="flood-sub">Xây mới nhiều nhất</div><div class="flood-wards">${applies.slice(0, 6).map(chip).join('')}</div>` : ''}
    <div class="flood-kpi"><span>Trong ${d.serviceM} m vườn hoa / bãi đỗ xe</span><b><span class="${pctClass(park)}">${pctText(park)}</span> / <span class="${pctClass(parking)}">${pctText(parking)}</span></b></div>
    <div class="flood-muted">Phường có ≥ ${fmtNum(d.minHa)} ha xây mới được coi là có khu phát triển mới. Dynamic World gộp cả đường, khu công nghiệp vào "đất xây dựng", cần đối chiếu đồ án quy hoạch trước khi kết luận.</div>`;
}
