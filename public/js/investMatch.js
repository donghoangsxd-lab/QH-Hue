// Ghép tên ranh KML với tên dự án sheet 15-DA. Một dòng sheet có thể gắn nhiều ranh (cùng tên, nhiều mảnh).
// Số hiệu khác nhau (Phú Vinh 1 / Phú Vinh 2) không ghép với nhau.

const STOP = new Set(['va', 'tai', 'thuoc', 'khu', 'dat', 'phuong', 'xa', 'thi', 'tran', 'huyen', 'thanh', 'pho', 'tp', 'hue', 'moi', 'du', 'cua', 'cac', 'tren', 'dia', 'ban', 'nay']);
// "hạ tầng" đã gỡ cả cụm ở foldInvestName, không đưa "ha" vào đây kẻo mất địa danh Tứ Hạ
const GENERIC = new Set([...STOP, 'cong', 'nghe', 'cao', 'san', 'xuat', 'dich', 'vu', 'sinh', 'thai', 'nghi', 'duong', 'tang', 'ky', 'thuat', 'xay', 'dung', 'dau', 'tu', 'trung', 'tam', 'lien', 'hiep', 'tong', 'hop', 'ket', 'phat', 'trien', 'ung', 'chat', 'luong']);

export function foldInvestName(value) {
  let s = String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/^[a-z]{0,3}\d{1,3}[a-z]?[.\-:\s]+/, '');
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
    .replace(/\biv\b/g, '4');
  s = s
    .replace(/\b(du an|dau tu xay dung|dau tu|xay dung|ha tang ky thuat|thanh pho hue|tp hue|tinh thua thien hue)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
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

function numsOf(folded) {
  return folded.match(/\d+/g) || [];
}

function isSubset(small, big) {
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

/** 0–1. Dưới 0,62 coi là không cùng dự án. */
export function investNameScore(a, b) {
  const fa = foldInvestName(a);
  const fb = foldInvestName(b);
  if (!fa || !fb) return 0;
  if (numsOf(fa).join(' ') !== numsOf(fb).join(' ')) return 0;
  if (fa === fb) return 1;
  const shorter = fa.length <= fb.length ? fa : fb;
  const longer = fa.length <= fb.length ? fb : fa;
  if (shorter.length >= 12 && longer.includes(shorter)) return 0.74 + 0.26 * (shorter.length / longer.length);
  const core = specificOf(shorter);
  const extra = specificOf(longer);
  if (core.size < 2 || !isSubset(core, extra)) return 0;
  const longNums = numsOf(shorter).filter(n => n.length >= 3);
  if (longNums.length && longNums.join(' ') === numsOf(longer).filter(n => n.length >= 3).join(' ')) return 0.86;
  const ratio = core.size / extra.size;
  if (ratio < 0.8) return 0;
  return 0.7 + 0.3 * ratio;
}

export function sheetProjectName(row) {
  if (!row) return '';
  const key = Object.keys(row).find(k => /tên dự án/i.test(k));
  return key ? String(row[key] || '').replace(/\s+/g, ' ').trim() : '';
}

const MATCH_MIN = 0.62;

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
 * Trả về mảng cùng độ dài: chỉ số dòng sheet hoặc -1.
 * Khớp tên trước. Ranh còn trống thì nhận điểm Google Maps nếu điểm nằm trong ranh nhỏ nhất và tên còn trùng.
 */
export function matchInvestRows(features, rows) {
  const names = rows.map(sheetProjectName);
  const idx = features.map(f => {
    const name = f?.properties?.name || '';
    if (!foldInvestName(name)) return -1;
    const alias = rows.findIndex(r => r && r._alias && r._alias === name);
    if (alias >= 0) return alias;
    let best = -1;
    let score = 0;
    names.forEach((rowName, i) => {
      const s = investNameScore(name, rowName);
      if (s > score) { score = s; best = i; }
    });
    return score >= MATCH_MIN ? best : -1;
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
    if (idx[fi] >= 0) return;
    const agreed = ris.filter(ri => pinAgrees(features[fi]?.properties?.name, names[ri]));
    if (agreed.length === 1) idx[fi] = agreed[0];
  });
  return idx;
}
