// Số liệu GBA trên thẻ lô / phường: mật độ và nhóm tương đối, không diễn giải thành mét chiều cao.
export const GBA_CLASSES = ['Thấp', 'Trung bình', 'Cao', 'Rất cao'];
export const GBA_COLORS = ['#fde68a', '#fb923c', '#ea580c', '#9a3412'];

export const GBA_NOTE = 'Dữ liệu dấu chân công trình Global Building Atlas (Đại học Kỹ thuật Munich, 2025), từ dấu chân Google, OpenStreetMap và Microsoft khoảng năm 2023. Chiều cao chỉ là ước lượng tương đối để thấy nơi nhà cao hơn hoặc dày hơn, phục vụ nhận định nhu cầu hạ tầng. Không phải số mét đo đạc và không dùng để quản lý, khống chế chiều cao công trình. Dân số phân bổ theo dấu chân nhà ở (thửa đất ở, rồi mới loại công trình công cộng, sản xuất và dấu chân quá lớn) nhân bậc chiều cao tương đối, không phải mét. Giấy phép CC BY-NC 4.0 (atlas) và ODbL (OpenStreetMap).';

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
  large: 'dấu chân lớn'
};

/** Câu mật độ dân số trên sàn nhà ở so với mọi công trình, và công trình bị loại khỏi nhà ở */
export function gbaWardExtra(ward, largeM2) {
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
    const label = key === 'large' ? `lớn hơn ${num(largeM2 || 500, 0)} m²` : DROP_LABEL[key];
    return `${label} ${num(pair[0], 0)} (${num(pair[1], 0)} m²)`;
  }).filter(Boolean);
  const dropNote = parts.length ? `Không tính là nhà ở: ${parts.join('; ')}.` : '';
  return { densityNote, dropNote };
}
