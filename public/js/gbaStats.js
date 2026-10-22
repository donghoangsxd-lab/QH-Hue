// Số liệu GBA trên thẻ lô / phường: mật độ và nhóm tương đối, không diễn giải thành mét chiều cao.
export const GBA_CLASSES = ['Thấp', 'Trung bình', 'Cao', 'Rất cao'];
export const GBA_COLORS = ['#fde68a', '#fb923c', '#ea580c', '#9a3412'];

// Bốn lớp số tầng trên bản đồ. Tầng = làm tròn (mét / 3,3). Tầng 10 thuộc 6-10; trên 50 vẫn vào nhóm trên.
export const GBA_FLOOR_CLASSES = ['1-2 tầng', '3-5 tầng', '6-10 tầng', '11-50 tầng'];
export const GBA_FLOOR_COLORS = ['#ffedd5', '#fdba74', '#ea580c', '#9a3412'];

export function floorsFromMetres(h) {
  const n = Number(h);
  if (!(n > 0)) return null;
  return Math.max(1, Math.round(n / 3.3));
}

export function floorClassIndex(h) {
  const f = floorsFromMetres(h);
  if (f == null || f <= 2) return 0;
  if (f <= 5) return 1;
  if (f <= 10) return 2;
  return 3;
}

export const FLOOR_LABEL_ZOOM = 17;

function segDistSq(px, py, a, b) {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = px - x;
  dy = py - y;
  return dx * dx + dy * dy;
}

function pointToPolygonDist(x, y, rings) {
  let inside = false;
  let minSq = Infinity;
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if ((a[1] > y) !== (b[1] > y) && (x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])) inside = !inside;
      const d = segDistSq(x, y, a, b);
      if (d < minSq) minSq = d;
    }
  }
  return (inside ? 1 : -1) * Math.sqrt(minSq);
}

function labelCell(x, y, h, rings) {
  const d = pointToPolygonDist(x, y, rings);
  return { x, y, h, d, max: d + h * Math.SQRT2 };
}

/** Điểm trong vòng xa biên nhất, để số tầng không rơi ra ngoài nhà lõm. d là bán kính nội tiếp. */
export function poleOfInaccessibility(rings, precision = 8) {
  const outer = rings && rings[0];
  if (!outer || outer.length < 3) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < outer.length; i++) {
    const x = outer[i][0];
    const y = outer[i][1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    sx += x;
    sy += y;
    n += 1;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const cellSize = Math.min(width, height);
  if (!(cellSize > 0) || !n) return null;
  let h = cellSize / 2;
  const cells = [];
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) cells.push(labelCell(x + h, y + h, h, rings));
  }
  let best = labelCell(sx / n, sy / n, 0, rings);
  const mid = labelCell(minX + width / 2, minY + height / 2, 0, rings);
  if (mid.d > best.d) best = mid;
  let probes = cells.length;
  while (cells.length && probes < 900) {
    let pick = 0;
    for (let i = 1; i < cells.length; i++) if (cells[i].max > cells[pick].max) pick = i;
    const cell = cells.splice(pick, 1)[0];
    if (cell.d > best.d) best = cell;
    if (cell.max - best.d <= precision) continue;
    h = cell.h / 2;
    cells.push(labelCell(cell.x - h, cell.y - h, h, rings));
    cells.push(labelCell(cell.x + h, cell.y - h, h, rings));
    cells.push(labelCell(cell.x - h, cell.y + h, h, rings));
    cells.push(labelCell(cell.x + h, cell.y + h, h, rings));
    probes += 4;
  }
  if (!(best.d > 0)) return null;
  return { x: best.x, y: best.y, d: best.d };
}

export function floorLabelMinRadiusPx(floors) {
  const digits = String(Math.abs(Math.round(Number(floors)))).length || 1;
  return 4.5 + digits * 3.4;
}

export function floorLabelVisible(zoom, floors, inscribedCssPx) {
  if (!(zoom >= FLOOR_LABEL_ZOOM) || floors == null || !(Number(floors) >= 1)) return false;
  return inscribedCssPx + 1e-9 >= floorLabelMinRadiusPx(floors);
}

export const GBA_NOTE = 'Dữ liệu dấu chân công trình Global Building Atlas (Đại học Kỹ thuật Munich, 2025), từ dấu chân Google, OpenStreetMap và Microsoft khoảng năm 2023. Chiều cao chỉ là ước lượng tương đối để thấy nơi nhà cao hơn hoặc dày hơn, phục vụ nhận định nhu cầu hạ tầng. Không phải số mét đo đạc và không dùng để quản lý, khống chế chiều cao công trình. Dân số phân bổ theo dấu chân nhà ở (thửa đất ở, rồi mới loại công trình công cộng, sản xuất và dấu chân quá lớn; dấu chân quá nhỏ như nhà kho, bếp, mái không tính dù thửa là đất ở) nhân bậc chiều cao tương đối, không phải mét. Giấy phép CC BY-NC 4.0 (atlas) và ODbL (OpenStreetMap).';

export function gbaLotKey(file, phase, id) {
  return [file || '', phase || '', id || ''].join('|');
}

function num(v, digits) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('vi-VN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/** row: [số công trình, dấu chân m², mật độ %, nhóm 0–3 hoặc null, chỉ số sàn,
 *  số nhà ở, dấu chân nhà ở m², mật độ nhà ở %, dân số ước tính theo sàn nhà ở]
 *  extra.densityNote / extra.dropNote: câu trên thẻ phường */
export function gbaStatsHtml(row, extra = {}) {
  if (!row) return '';
  const n = Number(row[0]) || 0;
  if (n <= 0) {
    return '<div class="gba-stats"><b>Công trình GBA</b><span>Không có dấu chân trong ranh</span></div>';
  }
  const cls = GBA_CLASSES[row[3]] || '';
  const color = GBA_COLORS[row[3]] || '#94a3b8';
  const fai = Number(row[4]);
  const faiText = Number.isFinite(fai) && fai > 0 ? `${num(fai, fai >= 10 ? 0 : 1)} lần mức trung vị` : '';
  const hasRes = row.length > 7 && Number.isFinite(Number(row[7]));
  const rn = Number(row[5]) || 0;
  const rp = row[8];
  const cover = hasRes
    ? `<span>Mật độ xây dựng mọi công trình ${num(row[2], 1)}%</span>
    <span>Nhà ở: ${num(rn, 0)} công trình · dấu chân ${num(row[6], 0)} m²</span>
    <span>Mật độ xây dựng nhà ở ${num(row[7], 1)}%</span>`
    : `<span>Mật độ xây dựng ${num(row[2], 1)}%</span>`;
  const people = hasRes && rn > 0 && rp != null && Number.isFinite(Number(rp))
    ? `<span>Ước tính dân số theo sàn nhà ở: ${num(rp, 0)} người</span>` : '';
  const density = extra.densityNote ? `<span>${extra.densityNote}</span>` : '';
  const drop = extra.dropNote ? `<span>${extra.dropNote}</span>` : '';
  return `<div class="gba-stats">
    <b>Công trình GBA</b>
    <span>${num(n, 0)} công trình · dấu chân ${num(row[1], 0)} m²</span>
    ${cover}
    <span class="gba-cls"><i style="background:${color}"></i>Chiều cao tương đối: ${cls}</span>
    ${faiText ? `<span>Chỉ số sàn tương đối: ${faiText}</span>` : ''}
    ${people}
    ${density}
    ${drop}
  </div>`;
}

const DROP_LABEL = {
  cad: 'địa chính',
  osm: 'OSM',
  infra: 'hạ tầng',
  lot: 'lô quy hoạch',
  large: 'dấu chân lớn',
  small: 'dấu chân nhỏ'
};

/** Câu mật độ dân số trên sàn nhà ở so với mọi công trình, và công trình bị loại khỏi nhà ở */
export function gbaWardExtra(ward, limits = {}) {
  const largeM2 = typeof limits === 'number' ? limits : limits.largeM2;
  const smallM2 = typeof limits === 'number' ? 20 : limits.smallM2;
  if (!ward || !Number.isFinite(Number(ward.rn))) return {};
  let densityNote = '';
  if (ward.rw > 0 && ward.tw > 0 && ward.pop > 0 && ward.ratio) {
    densityNote = `Dân số hành chính ${num(ward.pop, 0)} người. Mật độ trên sàn nhà ở tương đối cao hơn ${num(ward.ratio, 1)} lần so với khi chia cho mọi công trình.`;
  } else if (ward.rn === 0) {
    densityNote = 'Không có nhà ở trong ranh để phân bổ dân số.';
  }
  const drop = ward.drop || {};
  const parts = Object.keys(DROP_LABEL).map((key) => {
    const pair = drop[key];
    if (!pair || !pair[0]) return '';
    const label = key === 'large' ? `lớn hơn ${num(largeM2 || 500, 0)} m²`
      : key === 'small' ? `nhỏ hơn ${num(smallM2 || 20, 0)} m²`
      : DROP_LABEL[key];
    return `${label} ${num(pair[0], 0)} (${num(pair[1], 0)} m²)`;
  }).filter(Boolean);
  const dropNote = parts.length ? `Không tính là nhà ở: ${parts.join('; ')}.` : '';
  return { densityNote, dropNote };
}
