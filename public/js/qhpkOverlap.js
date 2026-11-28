// Giao các đồ án QHPK cùng cấp đang hiện trên bản đồ.
// Tooltip nêu diện tích chồng + tên/năm phê duyệt (sổ tay / schemes.json); không tự xếp đồ án nào thắng.
const SLIVER_M2 = 200;

function bboxOf(geom) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const walk = (c) => {
    if (!c) return;
    if (typeof c[0] === 'number') {
      const x = c[0];
      const y = c[1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    for (let i = 0; i < c.length; i += 1) walk(c[i]);
  };
  walk(geom.coordinates);
  return minX === Infinity ? null : [minX, minY, maxX, maxY];
}

function boxesHit(a, b) {
  return a && b && a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** Bỏ tiền tố cấp để câu tooltip không lặp «QHPK QHPK». */
export function overlapLabel(name) {
  const raw = String(name || '').trim();
  const cut = raw.replace(/^(QHPK|Quy hoạch phân khu)\b[\s.:–—_-]*/i, '').trim();
  return cut || raw;
}

/** Diện tích chồng (m²) → «50ha» / «1,2ha» cho tooltip. */
export function formatOverlapHa(m2) {
  const ha = Number(m2) / 10000;
  if (!(ha > 0)) return '0ha';
  if (ha >= 10) return `${Math.round(ha)}ha`;
  const one = Math.round(ha * 10) / 10;
  if (Number.isInteger(one)) return `${one}ha`;
  return `${String(one).replace('.', ',')}ha`;
}

function schemeClause(label, year) {
  const name = overlapLabel(label);
  const y = Number(year);
  if (Number.isFinite(y) && y >= 1990 && y <= 2035) return `QHPK ${name} (${y})`;
  return `QHPK ${name}`;
}

/**
 * Cả hai đồ án luôn hiện; năm từ bảng tổng hợp / sổ quyết định khi có.
 * opts: { areaM2, yearA, yearB } — không còn rút một tên theo focus.
 */
export function overlapTip(labelA, labelB, opts = {}) {
  const ha = formatOverlapHa(opts.areaM2);
  let first = { label: labelA, year: opts.yearA };
  let second = { label: labelB, year: opts.yearB };
  const ya = Number(opts.yearA);
  const yb = Number(opts.yearB);
  if (Number.isFinite(ya) && Number.isFinite(yb) && ya > yb) {
    first = { label: labelB, year: opts.yearB };
    second = { label: labelA, year: opts.yearA };
  }
  const left = schemeClause(first.label, first.year);
  const right = schemeClause(second.label, second.year);
  return `Phạm vi ${ha} chồng lấn ranh giới ${left} và ${right}. Thực hiện theo đồ án được phê duyệt sau và có hiệu lực thay thế`;
}

function pushOverlap(rows, a, b, intersect, area) {
  if (!boxesHit(a.box, b.box)) return;
  let geom = null;
  try { geom = intersect(a.geom, b.geom); } catch { geom = null; }
  if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) return;
  const m2 = Number(area(geom)) || 0;
  if (!(m2 > SLIVER_M2)) return;
  rows.push({
    geom,
    m2,
    names: [a.name, b.name],
    tip: overlapTip(a.label || a.name, b.label || b.name, {
      areaM2: m2,
      yearA: a.year,
      yearB: b.year
    })
  });
}

/**
 * schemes: [{ name, label, level, geom, year? }]. Chỉ cặp QHPK (hoặc không ghi level).
 * deps.intersect(geomA, geomB) → Polygon | MultiPolygon | null. deps.area(geom) → m².
 * deps.onlyName: chỉ cặp chạm đồ án đó (O(n) thay vì O(n²)) — đủ cho hatch theo hover/focus.
 * Bỏ mảnh vụn ≤ 200 m². Trả về mảnh nhỏ trước để tooltip rê chuột lấy vùng hẹp hơn.
 */
export function sameLevelOverlaps(schemes, deps) {
  const intersect = deps && deps.intersect;
  const area = deps && deps.area;
  const onlyName = (deps && deps.onlyName) || '';
  if (!intersect || !area) return [];
  const list = [];
  (schemes || []).forEach(s => {
    if (!s || !s.geom) return;
    if (s.level && s.level !== 'QHPK') return;
    list.push({ ...s, box: bboxOf(s.geom) });
  });
  const rows = [];
  if (onlyName) {
    const focus = list.find(s => s.name === onlyName);
    if (!focus) return [];
    for (let i = 0; i < list.length; i += 1) {
      const other = list[i];
      if (other.name === onlyName) continue;
      pushOverlap(rows, focus, other, intersect, area);
    }
  } else {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        pushOverlap(rows, list[i], list[j], intersect, area);
      }
    }
  }
  rows.sort((x, y) => x.m2 - y.m2);
  return rows;
}

/**
 * Lô đất quy hoạch (ô đất, kind DXF, giai đoạn QH) chứa điểm. Ưu tiên cấp đang xem,
 * rồi ô nhỏ hơn. Bỏ lô hạ tầng và lô hiện trạng.
 * deps.contains(geom, lng, lat), deps.area(lot) → m², deps.levelOf(file) → QHC | QHPK | QHCT.
 */
export function pickPlanningLot(lots, lng, lat, level, deps) {
  const contains = deps && deps.contains;
  const area = deps && deps.area;
  const levelOf = (deps && deps.levelOf) || (() => '');
  if (!contains || !area || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const hits = [];
  (lots || []).forEach(lot => {
    if (!lot || !lot.geometry) return;
    if (lot.phase && lot.phase !== 'QH') return;
    if (lot.kind !== 'DXF') return;
    const box = bboxOf(lot.geometry);
    if (!box || lng < box[0] || lng > box[2] || lat < box[1] || lat > box[3]) return;
    let inside = false;
    try { inside = contains(lot.geometry, lng, lat); } catch { inside = false; }
    if (inside) hits.push(lot);
  });
  if (!hits.length) return null;
  const prefer = level ? hits.filter(lot => levelOf(lot.file || lot.tenQH || '') === level) : [];
  const pool = prefer.length ? prefer : hits;
  pool.sort((a, b) => (Number(area(a)) || 0) - (Number(area(b)) || 0));
  return pool[0];
}
