// Giao các đồ án QHPK cùng cấp đang hiện trên bản đồ. Chưa xếp đồ án nào được duyệt sau:
// tooltip chỉ nêu tên đồ án chồng, không suy ngày phê duyệt.
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

/**
 * xxx là đồ án kia nếu một trong hai đang được chọn; không chọn được thì nêu cả hai.
 * focusedName là khóa Ten_QH, không phải câu hiển thị.
 */
export function overlapTip(labelA, labelB, opts = {}) {
  const a = overlapLabel(labelA);
  const b = overlapLabel(labelB);
  let xxx = [a, b].filter(Boolean).join(' và ');
  const focused = opts.focusedName || '';
  if (focused && opts.nameA && opts.nameB) {
    if (focused === opts.nameA) xxx = b;
    else if (focused === opts.nameB) xxx = a;
  }
  return `Phạm vi thuộc đồ án QHPK ${xxx}, cần kiểm tra pháp lý theo đồ án được phê duyệt sau`;
}

/**
 * schemes: [{ name, label, level, geom }]. Chỉ cặp QHPK (hoặc không ghi level).
 * deps.intersect(geomA, geomB) → Polygon | MultiPolygon | null. deps.area(geom) → m².
 * Bỏ mảnh vụn ≤ 200 m². Trả về mảnh nhỏ trước để tooltip rê chuột lấy vùng hẹp hơn.
 */
export function sameLevelOverlaps(schemes, deps) {
  const intersect = deps && deps.intersect;
  const area = deps && deps.area;
  const focusedName = (deps && deps.focusedName) || '';
  if (!intersect || !area) return [];
  const list = [];
  (schemes || []).forEach(s => {
    if (!s || !s.geom) return;
    if (s.level && s.level !== 'QHPK') return;
    list.push({ ...s, box: bboxOf(s.geom) });
  });
  const rows = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      if (!boxesHit(a.box, b.box)) continue;
      let geom = null;
      try { geom = intersect(a.geom, b.geom); } catch { geom = null; }
      if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;
      const m2 = Number(area(geom)) || 0;
      if (!(m2 > SLIVER_M2)) continue;
      rows.push({
        geom,
        m2,
        names: [a.name, b.name],
        tip: overlapTip(a.label || a.name, b.label || b.name, {
          nameA: a.name,
          nameB: b.name,
          focusedName
        })
      });
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
