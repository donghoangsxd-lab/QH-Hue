// Kiểm định dân số dùng làm mẫu số chỉ tiêu m²/người (QCVN 01:2026/BXD Mục 2.4.3): so số liệu phường với WorldPop, GHSL.
// Hai nguồn mở được quy về cùng tổng dân số toàn TP trước khi so, nên chỉ đánh giá tỷ trọng dân số giữa các phường/xã.
import { geeApi } from './api.js';
import { fmtNum } from './utils.js';

const LEVELS = [
  { max: 15, cls: 'pc-ok', label: 'Khớp' },
  { max: 30, cls: 'pc-warn', label: 'Cần rà soát' },
  { max: Infinity, cls: 'pc-bad', label: 'Lệch lớn' }
];
const PCT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1, signDisplay: 'always' });
const FACTOR = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

let result = null;
let promise = null;

export function loadPopCheck() {
  if (!promise) {
    promise = fetch(geeApi('action=getPopCheck'))
      .then(async r => {
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || !Array.isArray(d.wards)) throw new Error((d && d.message) || `Lỗi máy chủ (${r.status})`);
        return d;
      })
      .then(d => (result = indexResult(d)))
      .catch(err => {
        promise = null;
        throw err;
      });
  }
  return promise;
}

// Độ lệch (%) của số liệu phường so với từng nguồn đã quy đổi; điểm = độ lệch nhỏ nhất khi hai nguồn cùng chiều,
// = 0 khi số liệu phường nằm giữa hai nguồn
function indexResult(d) {
  const sources = d.sources || [];
  const wards = d.wards || [];
  const factor = {};
  sources.forEach(s => {
    let off = 0, ext = 0;
    wards.forEach(w => { if (w[s.key] > 0 && w.pop > 0) { off += w.pop; ext += w[s.key]; } });
    factor[s.key] = ext > 0 ? off / ext : null;
  });
  const byName = new Map();
  wards.forEach(w => {
    const devs = sources.map(s => (factor[s.key] && w[s.key] > 0 && w.pop > 0
      ? (w.pop / (w[s.key] * factor[s.key]) - 1) * 100
      : null));
    const valid = devs.filter(v => v != null);
    if (!valid.length) return;
    const sameSign = valid.every(v => v >= 0) || valid.every(v => v <= 0);
    const score = sameSign ? Math.min(...valid.map(Math.abs)) : 0;
    byName.set(w.name, { w, devs, score, level: LEVELS.find(l => score < l.max) });
  });
  return { sources, factor, byName };
}

function titleOf(r) {
  const lines = [
    'Đối chiếu dân số với nguồn mở (QCVN 01:2026/BXD Mục 2.4.3: mẫu số chỉ tiêu m²/người)',
    `Số liệu phường/xã đang dùng: ${fmtNum(r.w.pop)} người`
  ];
  result.sources.forEach((s, i) => {
    const raw = r.w[s.key];
    if (!(raw > 0) || r.devs[i] == null) return;
    lines.push(`${s.label}: ${fmtNum(raw)} người, quy đổi ${fmtNum(Math.round(raw * result.factor[s.key]))} → số đang dùng ${PCT.format(r.devs[i])}%`);
  });
  lines.push(`Kết luận: ${r.level.label} (${r.score < 15 ? 'lệch < 15%' : r.score < 30 ? 'lệch 15–30%' : 'lệch ≥ 30%'})`);
  const f = result.sources.filter(s => result.factor[s.key]).map(s => `${s.label} ×${FACTOR.format(result.factor[s.key])}`).join(', ');
  lines.push(`Hai nguồn mở đã quy về cùng tổng dân số toàn TP (${f}), chỉ so tỷ trọng giữa các phường/xã; lệch cả hai nguồn cùng chiều mới bị đánh dấu.`);
  return lines.join('\n');
}

/** Chấm màu độ tin cậy dân số của 1 phường/xã ('' khi chưa có kết quả) */
export function popCheckBadgeHtml(wardName, withLabel = false) {
  const r = result && result.byName.get(wardName);
  if (!r) return '';
  return `<span class="pc-badge ${r.level.cls}" title="${titleOf(r)}"><i></i>${withLabel ? r.level.label : ''}</span>`;
}

/** Tóm tắt toàn TP: số phường/xã cần rà soát, lệch lớn ('' khi chưa có kết quả hoặc tất cả khớp) */
export function popCheckCityHtml() {
  if (!result) return '';
  const all = [...result.byName.values()];
  const warn = all.filter(r => r.level.cls === 'pc-warn').length;
  const bad = all.filter(r => r.level.cls === 'pc-bad').length;
  if (!warn && !bad) return '';
  const cls = bad ? 'pc-bad' : 'pc-warn';
  const title = `Đối chiếu dân số ${all.length} phường/xã với WorldPop, GHSL (đã quy về cùng tổng dân số TP): `
    + `${bad} lệch ≥ 30%, ${warn} lệch 15–30%. Xem chấm màu cạnh cột Dân số trong bảng 40 phường xã.`;
  return `<span class="pc-badge ${cls}" title="${title}"><i></i>${bad + warn} P/X</span>`;
}
