// Ghép tên ranh KML với tên dự án sheet 15-DA. Một dòng sheet có thể gắn nhiều ranh (cùng tên, nhiều mảnh).
// Số hiệu khác nhau (Phú Vinh 1 / Phú Vinh 2) không ghép với nhau.
// Hai dòng sheet cùng sát một ranh (cách điểm dưới AMBIGUOUS_MARGIN) thì không ghép, đánh dấu chưa chắc.

const STOP = new Set(['va', 'tai', 'thuoc', 'khu', 'dat', 'phuong', 'xa', 'thi', 'tran', 'huyen', 'pho', 'tp', 'hue', 'moi', 'du', 'cua', 'cac', 'tren', 'dia', 'ban', 'nay', 'do']);
// "hạ tầng" đã gỡ cả cụm ở foldInvestName, không đưa "ha" vào đây kẻo mất địa danh Tứ Hạ.
// "thanh" không nằm ở đây: cụm "thành phố" đã gỡ, còn "Thanh" là địa danh (Thanh Toàn).
// "thai" / "duong" / "san" cũng là địa danh (Phong Thái, Thủy Dương, sân gôn); cụm đệm gỡ ở foldInvestName.
const GENERIC = new Set([...STOP, 'cong', 'nghe', 'cao', 'xuat', 'dich', 'vu', 'sinh', 'nghi', 'tang', 'ky', 'thuat', 'xay', 'dung', 'dau', 'tu', 'trung', 'tam', 'lien', 'hiep', 'tong', 'hop', 'ket', 'phat', 'trien', 'ung', 'chat', 'luong']);

export function foldInvestName(value) {
  let s = String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase();
  s = s.replace(/\(([^)]*)\)/g, (_, inner) => {
    if (!/\b(vi tri|giai doan|phase)\b/.test(inner)) return ' ';
    const n = inner.match(/\d+/);
    return n ? ` ${n[0]} ` : ' ';
  });
  const cut = s.search(/\bthuoc\b/);
  if (cut >= 0) s = s.slice(0, cut);
  s = s.replace(/,\s*(?:phuong|xa|thi xa|thi tran|huyen|thanh pho|tp)\b.*$/, ' ');
  // Mã đầu tờ (A51. / 05. / 1.). Số giai đoạn đứng sau tên (Phú Vinh 1) không nằm ở đầu chuỗi nên giữ.
  s = s.replace(/^[a-z]{0,3}\d{1,3}[a-z]?[.\-:\s]+/, '');
  s = s
    .replace(/\bccn\b/g, 'cum cong nghiep')
    .replace(/\bhtkt\b/g, 'ha tang ky thuat')
    .replace(/\btmdv\b/g, 'thuong mai dich vu')
    .replace(/\bkdt\b/g, 'khu do thi')
    .replace(/\bkdc\b/g, 'khu dan cu')
    .replace(/\bkdl\b/g, 'khu du lich')
    .replace(/\bdmt\b/g, 'dien mat troi')
    .replace(/\bcn\b/g, 'cong nghiep')
    .replace(/\biii\b/g, '3')
    .replace(/\bii\b/g, '2')
    .replace(/\biv\b/g, '4')
    .replace(/\bgon\b/g, 'golf');
  s = s
    .replace(/\b(do an|du an|dau tu xay dung|dau tu|xay dung|ha tang ky thuat|thanh pho hue|thanh pho|tp hue|tinh thua thien hue|thuong mai dich vu|thuong mai|cong nghe cao|san xuat|sinh thai|nghi duong|du lich|nha may|nang cap|mo rong)\b/g, ' ')
    .replace(/\bda\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b\d+(?:mw|ha|m2|m|km|kv)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

function tokensOf(folded) {
  return folded.split(' ').filter(t => t.length >= 2 && !STOP.has(t));
}

function specificOf(folded) {
  return new Set(tokensOf(folded).filter(t => !GENERIC.has(t) && !/^\d+$/.test(t)));
}

function tokenList(folded) {
  return tokensOf(folded).filter(t => !GENERIC.has(t) && !/^\d+$/.test(t));
}

function containsInOrder(shorter, longer) {
  let i = 0;
  for (const t of longer) {
    if (t === shorter[i]) i += 1;
    if (i === shorter.length) return true;
  }
  return shorter.length === 0;
}

// Số thứ tự giai đoạn (Phú Vinh 1 / 2). Bỏ diện tích và công suất (20ha, 50MW) kẻo chặn cặp đúng.
function phaseNums(folded) {
  return folded.replace(/\d+(?:mw|ha|m2|m|km|kv)\b/g, ' ').match(/\d+/g) || [];
}

/** 0–1. Dưới MATCH_MIN coi là không cùng dự án. Tên ngắn nằm trọn trong tên dài vẫn khớp nếu còn địa danh. */
export function investNameScore(a, b) {
  const fa = foldInvestName(a);
  const fb = foldInvestName(b);
  if (!fa || !fb) return 0;
  if (phaseNums(fa).join(' ') !== phaseNums(fb).join(' ')) return 0;
  if (fa === fb) return 1;
  const ta = tokenList(fa);
  const tb = tokenList(fb);
  if (!ta.length || !tb.length) return 0;
  const shorter = ta.length <= tb.length ? ta : tb;
  const longer = ta.length <= tb.length ? tb : ta;
  if (!containsInOrder(shorter, longer)) return 0;
  if (shorter.length === 1 && shorter[0].length < 6) return 0;
  if (shorter.length === longer.length) return 1;
  const ratio = shorter.length / longer.length;
  if (ratio < 0.75) return 0;
  return 0.7 + 0.3 * ratio;
}

export function sheetProjectName(row) {
  if (!row) return '';
  const key = Object.keys(row).find(k => /tên dự án/i.test(k));
  return key ? String(row[key] || '').replace(/\s+/g, ' ').trim() : '';
}

const MATCH_MIN = 0.68;
const AMBIGUOUS_MARGIN = 0.12;

function ringContains(ring, lng, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function geomContains(geom, lng, lat) {
  const polys = geom?.type === 'Polygon' ? [geom.coordinates] : geom?.type === 'MultiPolygon' ? geom.coordinates : [];
  return polys.some(poly => ringContains(poly[0], lng, lat) && poly.slice(1).every(hole => !ringContains(hole, lng, lat)));
}

function geomArea(geom) {
  const polys = geom?.type === 'Polygon' ? [geom.coordinates] : geom?.type === 'MultiPolygon' ? geom.coordinates : [];
  let area = 0;
  polys.forEach(poly => {
    const ring = poly[0];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
  });
  return Math.abs(area);
}

/** Điểm từ cột Google Maps đã giải mã, dạng "vĩ độ,kinh độ". */
export function sheetMapPoint(row) {
  const raw = row && row._map;
  const m = String(raw || '').match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (lat < 15 || lat > 18 || lng < 106 || lng > 109) return null;
  return [lng, lat];
}

function sharedTokens(a, b) {
  const sa = specificOf(foldInvestName(a));
  const sb = specificOf(foldInvestName(b));
  const shared = [];
  sa.forEach(t => {
    if (sb.has(t)) { shared.push(t); return; }
    if (t.length < 7) return;
    for (const u of sb) {
      if (u.length >= 7 && (t.startsWith(u) || u.startsWith(t))) { shared.push(t); break; }
    }
  });
  return shared;
}

// Pin Google chỉ được gán khi tên còn phần riêng trùng, kẻo điểm thả giữa xã rơi vào ranh dự án khác.
function coreText(name) {
  return foldInvestName(name)
    .replace(/\b\d+\b/g, ' ')
    .split(' ')
    .filter(t => t && !STOP.has(t))
    .join(' ');
}

function pinAgrees(polygonName, rowName) {
  const shared = sharedTokens(polygonName, rowName);
  if (shared.some(t => /\d/.test(t) || t.length >= 7)) return true;
  if (shared.length >= 2 && shared.some(t => t.length >= 6)) return true;
  const fa = coreText(polygonName);
  const fb = coreText(rowName);
  if (!fa || !fb) return false;
  const shorter = fa.length <= fb.length ? fa : fb;
  const longer = fa.length <= fb.length ? fb : fa;
  return shorter.length >= 12 && longer.includes(shorter);
}

/**
 * features: [{ properties: { name }, geometry }], rows: [{ header: value, _map? }].
 * Mỗi phần tử: { index, ambiguous, score }. index = -1 khi không ghép.
 * Khớp tên trước; hai dòng sát điểm thì ambiguous, không chọn đại. Ranh còn trống (và không ambiguous)
 * nhận điểm Google Maps nếu điểm nằm trong ranh nhỏ nhất và tên còn trùng.
 */
export function matchInvestDetail(features, rows) {
  const names = rows.map(sheetProjectName);
  const detail = features.map(f => {
    const name = f?.properties?.name || '';
    if (!foldInvestName(name)) return { index: -1, ambiguous: false, score: 0 };
    const alias = rows.findIndex(r => r && r._alias && r._alias === name);
    if (alias >= 0) return { index: alias, ambiguous: false, score: 1 };
    const scored = [];
    names.forEach((rowName, i) => {
      const s = investNameScore(name, rowName);
      if (s >= MATCH_MIN) scored.push({ i, s });
    });
    scored.sort((a, b) => b.s - a.s || a.i - b.i);
    if (!scored.length) return { index: -1, ambiguous: false, score: 0 };
    const best = scored[0];
    const second = scored[1];
    if (second && best.s - second.s < AMBIGUOUS_MARGIN) return { index: -1, ambiguous: true, score: best.s };
    return { index: best.i, ambiguous: false, score: best.s };
  });
  const areas = features.map(f => geomArea(f?.geometry));
  const claims = new Map();
  rows.forEach((row, ri) => {
    const point = sheetMapPoint(row);
    if (!point) return;
    let best = -1;
    features.forEach((f, fi) => {
      if (!geomContains(f?.geometry, point[0], point[1])) return;
      if (best < 0 || areas[fi] < areas[best]) best = fi;
    });
    if (best < 0) return;
    if (!claims.has(best)) claims.set(best, []);
    claims.get(best).push(ri);
  });
  claims.forEach((ris, fi) => {
    if (detail[fi].index >= 0 || detail[fi].ambiguous) return;
    const agreed = ris.filter(ri => pinAgrees(features[fi]?.properties?.name, names[ri]));
    if (agreed.length === 1) detail[fi] = { index: agreed[0], ambiguous: false, score: detail[fi].score };
  });
  return detail;
}

/** Mảng cùng độ dài features: chỉ số dòng sheet hoặc -1. */
export function matchInvestRows(features, rows) {
  return matchInvestDetail(features, rows).map(d => d.index);
}
