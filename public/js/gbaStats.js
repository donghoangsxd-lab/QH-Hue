// Số liệu GBA trên thẻ lô / phường: mật độ và nhóm tương đối, không diễn giải thành mét chiều cao.
export const GBA_CLASSES = ['Thấp', 'Trung bình', 'Cao', 'Rất cao'];
export const GBA_COLORS = ['#fde68a', '#fb923c', '#ea580c', '#9a3412'];

export const GBA_NOTE = 'Dữ liệu dấu chân công trình Global Building Atlas (Đại học Kỹ thuật Munich, 2025), từ dấu chân Google, OpenStreetMap và Microsoft khoảng năm 2023. Chiều cao chỉ là ước lượng tương đối để thấy nơi nhà cao hơn hoặc dày hơn, phục vụ nhận định nhu cầu hạ tầng. Không phải số mét đo đạc và không dùng để quản lý, khống chế chiều cao công trình. Giấy phép CC BY-NC 4.0 (atlas) và ODbL (OpenStreetMap).';

export function gbaLotKey(file, phase, id) {
  return [file || '', phase || '', id || ''].join('|');
}

function num(v, digits) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('vi-VN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/** row: [số công trình, diện tích dấu chân m², mật độ %, nhóm 0–3 hoặc null, chỉ số sàn so với trung vị] */
export function gbaStatsHtml(row) {
  if (!row) return '';
  const n = Number(row[0]) || 0;
  if (n <= 0) {
    return '<div class="gba-stats"><b>Công trình GBA</b><span>Không có dấu chân trong ranh</span></div>';
  }
  const cls = GBA_CLASSES[row[3]] || '';
  const color = GBA_COLORS[row[3]] || '#94a3b8';
  const fai = Number(row[4]);
  const faiText = Number.isFinite(fai) && fai > 0 ? `${num(fai, fai >= 10 ? 0 : 1)} lần mức trung vị` : '';
  return `<div class="gba-stats">
    <b>Công trình GBA</b>
    <span>${num(n, 0)} công trình · dấu chân ${num(row[1], 0)} m²</span>
    <span>Mật độ xây dựng ${num(row[2], 1)}%</span>
    <span class="gba-cls"><i style="background:${color}"></i>Chiều cao tương đối: ${cls}</span>
    ${faiText ? `<span>Chỉ số sàn tương đối: ${faiText}</span>` : ''}
  </div>`;
}
