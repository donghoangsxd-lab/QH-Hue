// So sánh mật độ xây dựng thực tế với chỉ tiêu tối đa của lô.
// Icon trên thẻ lô: khi bấm ghi ba dòng — số công trình, diện tích xây dựng, mật độ.
// Không hiện chiều cao ảnh vệ tinh (sai số lớn, không dùng để quản lý).

const EPS = { '%': 0.05, 'lần': 0.005, 'tầng': 0.01 };

export const LOT_BUILDUP_LABEL = 'Xem mật độ xây dựng thực tế';

/** Nút chữ dự phòng (popup không có hàng icon, ví dụ QHCT tĩnh). */
export function lotBuildupButtonHtml() {
  return `<button type="button" class="proof-btn lot-buildup-btn" data-lot-buildup-run title="${LOT_BUILDUP_LABEL}">${LOT_BUILDUP_LABEL}</button>`;
}

/** Khung kết quả mật độ (rỗng đến khi bấm icon / nút). */
export function lotBuildupSlotHtml() {
  return `<div class="lot-buildup" data-lot-buildup></div>`;
}

export function floorsFromHeight(meters) {
  const h = Number(meters);
  if (!(h > 0)) return null;
  return Math.max(1, Math.round(h / 4));
}

/** Chỉ tiêu tối đa. Khoảng "3-5" lấy cận trên. Mật độ ≤ 1 hiểu là tỉ lệ (0,4 = 40%). */
export function planLimit(plan, key) {
  if (!plan || plan[key] == null || plan[key] === '') return null;
  const raw = String(plan[key]).trim().replace(',', '.');
  const nums = raw.match(/\d+(?:\.\d+)?/g);
  if (!nums) return null;
  let n = Number(nums[nums.length - 1]);
  if (!Number.isFinite(n)) return null;
  if (key === 'coverage' && n <= 1) n *= 100;
  return n;
}

export function screenVerdict(actual, limit, unit) {
  if (limit == null || !Number.isFinite(actual)) return { state: 'none', diff: null };
  const diff = actual - limit;
  const eps = EPS[unit] ?? 0.05;
  if (diff > eps) return { state: 'over', diff };
  return { state: 'ok', diff: Math.max(0, -diff) };
}

function num(value, digits) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('vi-VN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/**
 * stats: { lotM2, footM2, count, outM2? }
 * footM2 chỉ phần trong ranh. outM2 = phần chân công trình ngoài ranh (đã gạch đỏ, không tính mật độ).
 * Không ghi chiều cao ảnh vệ tinh (sai số lớn).
 */
export function buildupHtml(stats) {
  const lot = Number(stats.lotM2);
  if (!(lot > 1)) return '<span>Không tính được diện tích lô.</span>';
  const count = Number(stats.count) || 0;
  const foot = Number(stats.footM2) || 0;
  const out = Number(stats.outM2) || 0;
  const cover = lot > 0 ? (100 * foot) / lot : 0;
  const line = (label, value) => `<span class="lot-line"><span>${label}</span><b>${value}</b></span>`;
  const rows = [
    line('Số công trình trên đất', `${num(count, 0)} công trình`),
    line('Diện tích xây dựng', `${num(Math.round(foot), 0)} m²`),
    line('Mật độ xây dựng', `${num(cover, 1)}%`)
  ];
  if (out >= 0.5) {
    rows.push(`<span class="lot-line is-out"><span>Ngoài ranh (không tính)</span><b>${num(Math.round(out), 0)} m²</b></span>`);
  }
  return rows.join('');
}
