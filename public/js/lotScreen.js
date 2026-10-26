// So sánh mật độ, hệ số sử dụng đất và tầng cao thực tế với chỉ tiêu tối đa của lô.
// Tầng cao = làm tròn (mét / 4). Chiều cao GBA là ước lượng, sai số khoảng ±1 tầng.
// Nút trên thẻ lô chỉ ghi bốn dòng khi bấm: số công trình, diện tích xây dựng, mật độ, khoảng chiều cao mét.

const EPS = { '%': 0.05, 'lần': 0.005, 'tầng': 0.01 };

export const LOT_BUILDUP_LABEL = 'Mật độ xây dựng';

export function lotBuildupButtonHtml() {
  return `<button type="button" class="proof-btn lot-buildup-btn" data-lot-buildup-run title="Kiểm tra mật độ xây dựng thực tế">${LOT_BUILDUP_LABEL}</button>`;
}

export function lotBuildupSlotHtml() {
  return `<div class="lot-buildup" data-lot-buildup>${lotBuildupButtonHtml()}</div>`;
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
 * stats: { lotM2, footM2, count, minM, maxM }
 * minM, maxM là mét chiều cao ảnh vệ tinh của các dấu chân trong ranh. Chưa có mét thì ghi «chưa có».
 */
export function buildupHtml(stats) {
  const lot = Number(stats.lotM2);
  if (!(lot > 1)) return '<span>Không tính được diện tích lô.</span>';
  const count = Number(stats.count) || 0;
  const foot = Number(stats.footM2) || 0;
  const cover = lot > 0 ? (100 * foot) / lot : 0;
  const minM = Number(stats.minM);
  const maxM = Number(stats.maxM);
  let height = 'chưa có';
  if (minM > 0 && maxM > 0) {
    const a = Math.round(minM);
    const b = Math.round(maxM);
    height = a === b ? `${num(a, 0)} m` : `${num(a, 0)} – ${num(b, 0)} m`;
  }
  const line = (label, value) => `<span class="lot-line"><span>${label}</span><b>${value}</b></span>`;
  return [
    line('Số công trình trên đất', `${num(count, 0)} công trình`),
    line('Diện tích xây dựng', `${num(Math.round(foot), 0)} m²`),
    line('Mật độ xây dựng', `${num(cover, 1)}%`),
    line('Chiều cao (ảnh vệ tinh)', height)
  ].join('');
}
