// So sánh mật độ, hệ số sử dụng đất và tầng cao thực tế với chỉ tiêu tối đa của lô.
// Tầng cao = làm tròn (mét / 3,3). Chiều cao GBA là ước lượng, sai số khoảng ±1 tầng.

const EPS = { '%': 0.05, 'lần': 0.005, 'tầng': 0.01 };

export function floorsFromHeight(meters) {
  const h = Number(meters);
  if (!(h > 0)) return null;
  return Math.max(1, Math.round(h / 3.3));
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

function verdictHtml(label, actual, limit, unit, digits) {
  const shown = Number.isFinite(actual) ? num(actual, digits) : '';
  const cap = limit == null ? '' : num(limit, digits);
  if (limit == null && !Number.isFinite(actual)) {
    return `<span class="is-miss">${label}: chưa có chỉ tiêu, chưa tính được</span>`;
  }
  if (limit == null) {
    return `<span class="is-miss">${label}: ${shown} ${unit}. Chưa có chỉ tiêu quy hoạch</span>`;
  }
  if (!Number.isFinite(actual)) {
    return `<span class="is-miss">${label}: chưa tính được. Chỉ tiêu ≤ ${cap} ${unit}</span>`;
  }
  const verdict = screenVerdict(actual, limit, unit);
  const gapUnit = unit === '%' ? 'điểm %' : unit;
  const actualText = unit === '%' ? `${shown}%` : `${shown} ${unit}`;
  const capText = unit === '%' ? `${cap}%` : `${cap} ${unit}`;
  if (verdict.state === 'over') {
    return `<span class="is-over">${label}: vượt ${num(verdict.diff, digits)} ${gapUnit} (thực tế ${actualText}, chỉ tiêu ≤ ${capText})</span>`;
  }
  if (verdict.diff > (EPS[unit] ?? 0.05)) {
    return `<span class="is-ok">${label}: đạt, thấp hơn ${num(verdict.diff, digits)} ${gapUnit} (thực tế ${actualText}, chỉ tiêu ≤ ${capText})</span>`;
  }
  return `<span class="is-ok">${label}: đạt (thực tế ${actualText}, chỉ tiêu ≤ ${capText})</span>`;
}

/**
 * stats: { lotM2, footM2, count, maxF, meanF, gfaM2, missingHeight, heightReady, plan }
 * meanF là trung bình theo diện tích chiếm đất của các công trình đã khớp chiều cao.
 * Khi còn công trình chưa khớp chiều cao thì không kết luận hệ số và tầng cao.
 */
export function buildupHtml(stats) {
  const lot = Number(stats.lotM2);
  if (!(lot > 1)) return '<span>Không tính được diện tích lô.</span>';
  const count = Number(stats.count) || 0;
  const foot = Number(stats.footM2) || 0;
  const cover = lot > 0 ? (100 * foot) / lot : 0;
  const heightReady = stats.heightReady !== false;
  const missing = Number(stats.missingHeight) || 0;
  const complete = heightReady && missing === 0 && (count === 0 || Number.isFinite(stats.maxF));
  const maxF = Number.isFinite(stats.maxF) ? stats.maxF : null;
  const meanF = Number.isFinite(stats.meanF) ? stats.meanF : null;
  const gfa = Number(stats.gfaM2);
  const far = complete && lot > 0 ? (Number.isFinite(gfa) ? gfa : 0) / lot : null;
  const plan = stats.plan || null;
  const floorLine = !heightReady
    ? '<span class="is-miss">Tầng cao, diện tích sàn và hệ số sử dụng đất: chưa tính được vì chưa tải được chiều cao mét.</span>'
    : (maxF == null && count > 0)
      ? '<span class="is-miss">Chưa khớp được chiều cao nên chưa tính tầng cao, diện tích sàn và hệ số sử dụng đất.</span>'
      : `<span>Tầng cao cao nhất ${count ? num(maxF || 0, 0) : 0} · trung bình ${count && meanF != null ? num(meanF, 1) : '0,0'}</span>
         <span>Tổng diện tích sàn ≈ ${num(Number.isFinite(gfa) ? gfa : 0, 0)} m²</span>
         <span>Hệ số sử dụng đất thực tế ${complete ? num(far, 2) : 'chưa đủ'} lần</span>`;
  const compare = [
    verdictHtml('Mật độ xây dựng', cover, planLimit(plan, 'coverage'), '%', 1),
    complete
      ? verdictHtml('Hệ số sử dụng đất', far, planLimit(plan, 'far'), 'lần', 2)
      : '<span class="is-miss">Hệ số sử dụng đất: chưa kết luận vì còn công trình chưa khớp chiều cao.</span>',
    complete
      ? verdictHtml('Tầng cao', count ? maxF : 0, planLimit(plan, 'floors'), 'tầng', 0)
      : '<span class="is-miss">Tầng cao: chưa kết luận vì còn công trình chưa khớp chiều cao.</span>'
  ].join('');
  const gap = missing > 0
    ? `<span class="is-miss">${num(missing, 0)} công trình không khớp chiều cao, không tính vào sàn và tầng cao.</span>`
    : '';
  const note = heightReady
    ? '<span class="lot-note">Chiều cao là ước lượng Global Building Atlas, đã chỉnh theo OSM hoặc số công bố ở một số nhà cao. Tầng cao ≈ mét / 3,3, sai số khoảng ±1 tầng, chỉ để sàng lọc.</span>'
    : '';
  return `<b>Kiểm tra mật độ xây dựng thực tế</b>
    ${compare}
    <span>Diện tích lô ${num(lot, 0)} m² · chiếm đất ${num(foot, 0)} m² · ${num(count, 0)} công trình · mật độ ${num(cover, 1)}%</span>
    ${floorLine}
    ${gap}
    <span class="lot-note">Chiếm đất là phần dấu chân cắt trong ranh lô. Sàn ≈ tổng (phần cắt × số tầng). Tầng cao trung bình theo diện tích chiếm đất.</span>
    ${note}`;
}
