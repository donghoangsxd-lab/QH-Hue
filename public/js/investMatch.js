// Ghép tên ranh KML với tên dự án sheet 15-DA. Một dòng sheet có thể gắn nhiều ranh (cùng tên, nhiều mảnh).
// Số hiệu khác nhau (Phú Vinh 1 / Phú Vinh 2) không ghép với nhau.
// Hai dòng sheet cùng sát một ranh thì không ghép, trừ khi địa điểm hoặc tên đầy đủ tách được,
// hoặc hai dòng trùng hẳn nhau (chọn dòng đứng trước).

const STOP = new Set(['va', 'tai', 'thuoc', 'khu', 'dat', 'phuong', 'xa', 'thi', 'tran', 'huyen', 'pho', 'tp', 'hue', 'moi', 'du', 'cua', 'cac', 'tren', 'dia', 'ban', 'nay', 'do']);
// "hạ tầng" đã gỡ cả cụm ở foldInvestName, không đưa "ha" vào đây kẻo mất địa danh Tứ Hạ.
// "thanh" không nằm ở đây: cụm "thành phố" đã gỡ, còn "Thanh" là địa danh (Thanh Toàn).
// "thai" / "duong" / "san" cũng là địa danh (Phong Thái, Thủy Dương, sân gôn); cụm đệm gỡ ở foldInvestName.
const GENERIC = new Set([...STOP, 'cong', 'nghe', 'cao', 'xuat', 'dich', 'vu', 'sinh', 'nghi', 'tang', 'ky', 'thuat', 'xay', 'dung', 'dau', 'tu', 'trung', 'tam', 'lien', 'hiep', 'tong', 'hop', 'ket', 'phat', 'trien', 'ung', 'chat', 'luong']);

function deaccent(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase();
}

function openParens(value) {
  return value.replace(/\(([^)]*)\)/g, (_, inner) => (/^\s*thuoc\b/.test(deaccent(inner)) ? ' ' : ` ${inner} `));
}

// Ngoặc «thuộc / mảnh» là chú thích, bỏ. Ngoặc còn lại chỉ giữ mã lô (DV1, DDL3, DTM3)
// và số vị trí/giai đoạn — không giữ tên công ty, công suất, «PA 2».
function parenInner(inner) {
  const flat = deaccent(inner);
  if (/^\s*(?:thuoc|manh)\b/.test(flat)) return ' ';
  const phase = flat.match(/\b(?:vi tri|giai doan)\b[^0-9]*(\d+)/);
  if (phase) return ` ${phase[1]} `;
  const codes = flat.match(/\b(?:dv|dtm|ddl|sn|cxcd|ott)-?\d{1,3}\b/g);
  if (codes) return ` ${codes.map(c => c.replace(/-/g, '')).join(' ')} `;
  return ' ';
}

function foldCore(value, cutComma) {
  let s = deaccent(value);
  s = s.replace(/\(([^)]*)\)/g, (_, inner) => parenInner(inner));
  if (cutComma) s = s.replace(/,\s*(?:phuong|xa|thi xa|thi tran|huyen|thanh pho|tp)\b.*$/, ' ');
  // Mã đầu tờ (A51. / 05. / 1. / B28 -). Số giai đoạn và số nhà đứng sau tên vẫn giữ.
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
    .replace(/\b(do an|du an|dau tu xay dung|dau tu|xay dung|ha tang ky thuat|thanh pho hue|thanh pho|tp hue|tinh thua thien hue|thuong mai dich vu|thuong mai|cong nghe cao|san xuat|sinh thai|nghi duong|du lich|nha may|nang cap|mo rong|khu dan cu)\b/g, ' ')
    .replace(/\bda\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b\d+(?:mw|ha|m2|m|km|kv)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

export function foldInvestName(value) {
  return stripTrailingPlace(foldCore(value, true));
}

// «tại phường/xã …» cuối tên làm loãng tỷ lệ. Cắt khi phần trước còn địa danh (kể cả một token dài như Thủy).
function stripTrailingPlace(folded) {
  const tai = folded.search(/\btai\s+(?:phuong|xa|thi xa|thi tran|huyen|thanh pho|tp|khu vuc)\b/);
  if (tai < 0) return folded;
  const head = folded.slice(0, tai).trim();
  const toks = tokenList(head);
  if (toks.length >= 2) return head;
  if (toks.length === 1 && toks[0].length >= 4) return head;
  return folded;
}

// Tên gọi khác trong ngoặc (cửa hàng Hương Sơ), không phải chú thích địa điểm.
function aliasFolds(value) {
  const out = [];
  const re = /\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(String(value || '')))) {
    const flat = deaccent(m[1]).trim();
    if (/^(?:thuoc|manh|tai|phuong|xa|nay|hoac|tap|ngay|nga)\b/.test(flat)) continue;
    if (flat.length < 12) continue;
    const folded = stripTrailingPlace(foldCore(m[1], true));
    if (tokenList(folded).length >= 4) out.push(folded);
  }
  return out;
}

function nameFolds(value) {
  const cut = foldCore(value, true);
  const full = foldCore(value, false);
  const list = [stripTrailingPlace(cut), cut, full, stripTrailingPlace(full), ...aliasFolds(value)];
  return [...new Set(list.filter(Boolean))];
}

function tokensOf(folded) {
  return folded.split(' ').filter(t => t.length >= 2 && !STOP.has(t));
}

function specificOf(folded) {
  return new Set(tokensOf(folded).filter(t => !GENERIC.has(t) && !/^\d+$/.test(t)));
}

function tokenList(folded) {
  // Giữ số nhà và mã lô (40, DV1). Số giai đoạn vẫn bị chặn ở numbersCompatible.
  return tokensOf(folded).filter(t => !GENERIC.has(t));
}

function containsInOrder(shorter, longer) {
  let i = 0;
  for (const t of longer) {
    if (t === shorter[i]) i += 1;
    if (i === shorter.length) return true;
  }
  return shorter.length === 0;
}

function codesOf(folded) {
  return folded.match(/[a-z]{1,6}\d{1,4}/g) || [];
}

function bareNums(folded) {
  return (folded.replace(/[a-z]{1,6}\d{1,4}/g, ' ').match(/\d+/g) || []).map(n => String(Number(n)));
}

// Mã lô (DV1 ≠ DV2) và số giai đoạn (Phú Vinh 1 ≠ 2) phải gặp nhau. Số chỉ có một bên
// (giai đoạn 3 kèm DV1) không chặn nếu hai bên đã chung một mã.
function numbersCompatible(fa, fb) {
  const ca = codesOf(fa);
  const cb = codesOf(fb);
  if (ca.length && cb.length && !ca.some(c => cb.includes(c))) return false;
  const na = bareNums(fa);
  const nb = bareNums(fb);
  if (na.length && nb.length && !na.some(n => nb.includes(n))) return false;
  if (!ca.length && !cb.length && (!na.length !== !nb.length)) return false;
  return true;
}

function listedRatio(shorter, longer) {
  const big = new Set(longer);
  if (!shorter.every(t => big.has(t))) return 0;
  const small = new Set(shorter);
  return small.size / new Set(longer).size;
}

function scoreFolds(fa, fb) {
  if (!fa || !fb) return 0;
  if (!numbersCompatible(fa, fb)) return 0;
  if (fa === fb) return 1;
  const ta = tokenList(fa);
  const tb = tokenList(fb);
  if (!ta.length || !tb.length) return 0;
  const shorter = ta.length <= tb.length ? ta : tb;
  const longer = ta.length <= tb.length ? tb : ta;
  const codeTok = t => /[a-z]/.test(t) && /\d/.test(t);
  if (shorter.length === 1 && shorter[0].length < 6 && !codeTok(shorter[0])) return 0;
  let ratio = 0;
  if (containsInOrder(shorter, longer)) ratio = shorter.length / longer.length;
  else if (new Set(shorter).size >= 3) ratio = listedRatio(shorter, longer);
  if (!ratio) return 0;
  if (shorter.length === longer.length || ratio === 1) return 1;
  const marked = shorter.some(t => codeTok(t) || /^\d+$/.test(t));
  if (ratio < 0.75 && !(marked && ratio >= 0.5 && shorter.length >= 2)) return 0;
  return 0.7 + 0.3 * ratio;
}

/** 0–1. Dưới MATCH_MIN coi là không cùng dự án. Tên ngắn nằm trọn trong tên dài vẫn khớp nếu còn địa danh. */
export function investNameScore(a, b) {
  let best = 0;
  for (const fa of nameFolds(a)) {
    for (const fb of nameFolds(b)) {
      best = Math.max(best, scoreFolds(fa, fb));
      if (best === 1) return 1;
    }
  }
  return best;
}

export function sheetProjectName(row) {
  if (!row) return '';
  const key = Object.keys(row).find(k => /tên dự án/i.test(k));
  return key ? String(row[key] || '').replace(/\s+/g, ' ').trim() : '';
}

function sheetPlace(row) {
  if (!row) return '';
  const key = Object.keys(row).find(k => /địa điểm/i.test(k));
  return key ? String(row[key] || '').replace(/\s+/g, ' ').trim() : '';
}

function richTokens(value) {
  let s = openParens(String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase());
  s = s.replace(/^[a-z]{0,3}\d{1,3}[a-z]?[.\-:\s]+/, '');
  s = s.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.split(' ').filter(t => t.length >= 3 && !STOP.has(t));
}

const OPTIONAL = new Set(['sinh', 'thai', 'nghi', 'lich', 'moi']);

function nameDice(a, b) {
  const keep = list => list.filter(t => !OPTIONAL.has(t));
  const ta = keep(richTokens(a));
  const tb = keep(richTokens(b));
  if (!ta.length || !tb.length) return 0;
  const sb = new Set(tb);
  let inter = 0;
  new Set(ta).forEach(t => { if (sb.has(t)) inter += 1; });
  return (2 * inter) / (new Set(ta).size + sb.size);
}

function wardHits(boundaryName, row) {
  const have = new Set(richTokens(boundaryName));
  return richTokens(sheetPlace(row)).filter(t => t.length >= 4 && have.has(t)).length;
}

// Điểm tên đã sát nhau: chọn dòng trùng tên đầy đủ hoặc đúng phường. Hai dòng giống hệt thì lấy dòng trước.
// Vẫn chưa chắc khi phần khác nhau chỉ là từ đệm (Thanh Toàn / Thanh Toàn sinh thái).
function pickCandidate(boundaryName, scored, rows) {
  const best = scored[0].s;
  const close = scored.filter(c => best - c.s < AMBIGUOUS_MARGIN);
  if (close.length < 2) return close[0] || null;
  const perfect = close.filter(c => c.s === 1);
  if (perfect.length === 1) return perfect[0];
  const ranked = close.map(c => ({
    ...c,
    sim: nameDice(boundaryName, sheetProjectName(rows[c.i])),
    ward: wardHits(boundaryName, rows[c.i]),
    raw: sheetProjectName(rows[c.i]),
    key: foldInvestName(sheetProjectName(rows[c.i]))
  })).sort((a, b) => b.sim - a.sim || b.s - a.s || b.ward - a.ward || a.i - b.i);
  const top = ranked[0];
  const rest = ranked.filter(r => r.i !== top.i);
  if (rest.every(r => r.raw === top.raw)) return top;
  if (top.sim - rest[0].sim >= 0.08) return top;
  if (top.s - rest[0].s >= 0.08 && top.sim + 0.02 >= rest[0].sim) return top;
  if (top.ward > rest[0].ward && top.sim >= rest[0].sim && top.key !== rest[0].key) return top;
  return null;
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
    const chosen = pickCandidate(name, scored, rows);
    if (!chosen) return { index: -1, ambiguous: true, score: scored[0].s };
    return { index: chosen.i, ambiguous: false, score: chosen.s };
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
