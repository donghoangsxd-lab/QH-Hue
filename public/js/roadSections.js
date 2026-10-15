// Mặt cắt ngang điển hình đồ án QHC đô thị Thừa Thiên Huế 2045 (bản vẽ giao thông 1/10.000), khóa theo trường
// kyhieumatcat của lớp Mạng lưới giao thông đường bộ / đường sắt trên gServer (mapid 21817): "9-9", "7A-7A"…
// Bề rộng (m) ghi đúng bản vẽ: số hoặc [min, max]. b: tổng bề rộng giữa hai chỉ giới đường đỏ theo bản vẽ
// (5-5 ghi 50–60 dù tổng các thành phần 53–66). side: hành lang ngoài chỉ giới (không tính vào b).
// Hình vẽ lại bằng SVG: bề rộng các thành phần theo tỷ lệ giá trị giữa khoảng, hành lang ngoài không theo tỷ lệ.

const KINDS = {
  he: { label: 'Vỉa hè', fill: '#cbd5e1', top: 25 },
  xe: { label: 'Lòng đường', fill: '#52525b', top: 30 },
  gom: { label: 'Đường gom', fill: '#78716c', top: 30 },
  le: { label: 'Lề đường', fill: '#a8a29e', top: 29 },
  pc: { label: 'Dải phân cách', fill: '#4ade80', top: 23 },
  nuoc: { label: 'Mặt nước', fill: '#38bdf8', top: 31 }
};

export const ROAD_SECTIONS = [
  {
    id: '1-1', ten: 'Cao tốc Bắc Nam', loai: 'Đường cao tốc', b: 33,
    parts: [
      { k: 'le', w: 0.75, note: 'Lề đất' }, { k: 'le', w: 3, note: 'Lề gia cố' }, { k: 'xe', w: 11.25 },
      { k: 'pc', w: 3, note: 'Dải phân cách giữa' }, { k: 'xe', w: 11.25 }, { k: 'le', w: 3, note: 'Lề gia cố' },
      { k: 'le', w: 0.75, note: 'Lề đất' }
    ],
    side: { label: 'HLBV', title: 'Hành lang bảo vệ đường bộ' }
  },
  {
    id: '2-2', ten: 'Quốc lộ ngoài đô thị', loai: 'Quốc lộ', b: 22.5,
    parts: [
      { k: 'le', w: 3, note: 'Lề đất 0,5 + lề gia cố 2,5' }, { k: 'xe', w: 7.5, note: '2 làn × 3,75' },
      { k: 'pc', w: 1.5, note: 'Dải an toàn 0,5 + phân cách 0,5 + an toàn 0,5' },
      { k: 'xe', w: 7.5, note: '2 làn × 3,75' }, { k: 'le', w: 3, note: 'Lề gia cố 2,5 + lề đất 0,5' }
    ],
    side: { label: 'HLBV', title: 'Hành lang bảo vệ đường bộ', w: [15, 20] }
  },
  {
    id: '3-3', ten: 'Đường tỉnh ngoài đô thị', loai: 'Đường tỉnh', b: [9, 12],
    parts: [{ k: 'le', w: 1.5 }, { k: 'xe', w: [6, 9] }, { k: 'le', w: 1.5 }],
    side: { label: 'HLBV', title: 'Hành lang bảo vệ đường bộ', w: [10, 15] }
  },
  {
    id: '4-4', ten: 'Đường Võ Nguyên Giáp', loai: 'Đường chính đô thị', b: 100,
    parts: [
      { k: 'he', w: 11 }, { k: 'xe', w: 15.5 }, { k: 'he', w: 11 }, { k: 'nuoc', w: 25, note: 'Kênh, mặt nước giữa' },
      { k: 'he', w: 11.5 }, { k: 'xe', w: 15 }, { k: 'he', w: 11 }
    ]
  },
  {
    id: '5-5', ten: 'Quốc lộ 1 có đường gom 2 bên', loai: 'Quốc lộ', b: [50, 60],
    parts: [
      { k: 'he', w: [5, 8] }, { k: 'gom', w: 8 }, { k: 'pc', w: 3, note: 'Dải phân cách bên' }, { k: 'xe', w: [8, 11.5] },
      { k: 'pc', w: 5, note: 'Dải phân cách giữa' }, { k: 'xe', w: [8, 11.5] }, { k: 'pc', w: 3, note: 'Dải phân cách bên' },
      { k: 'gom', w: 8 }, { k: 'he', w: [5, 8] }
    ]
  },
  {
    id: '6-6', ten: 'Quốc lộ 1 có đường gom 1 bên', loai: 'Quốc lộ', b: [36, 44],
    parts: [
      { k: 'he', w: [5, 8] }, { k: 'xe', w: [8, 11.5] }, { k: 'pc', w: 5, note: 'Dải phân cách giữa' }, { k: 'xe', w: [8, 11.5] },
      { k: 'pc', w: 3, note: 'Dải phân cách bên' }, { k: 'gom', w: 8 }, { k: 'he', w: [5, 8] }
    ]
  },
  {
    id: '7-7', ten: 'Đường trục chính đô thị cấp 1', loai: 'Trục chính đô thị', b: [40, 60],
    parts: [{ k: 'he', w: [4, 8] }, { k: 'xe', w: [11.5, 15] }, { k: 'pc', w: [5, 8] }, { k: 'xe', w: [11.5, 15] }, { k: 'he', w: [4, 8] }]
  },
  {
    id: '7A-7A', ten: 'Đường vành đai 3', loai: 'Trục chính đô thị', b: [43, 60],
    parts: [{ k: 'he', w: [5, 8] }, { k: 'xe', w: [11.5, 15] }, { k: 'pc', w: [5, 8] }, { k: 'xe', w: [11.5, 15] }, { k: 'he', w: [5, 8] }],
    right: { label: 'ĐS tốc độ cao', title: 'Hành lang đường sắt tốc độ cao', w: [45, 85], rail: true }
  },
  {
    id: '7B-7B', ten: 'Trục chính đô thị có đường sắt đô thị', loai: 'Trục chính đô thị', b: [40, 60],
    parts: [
      { k: 'he', w: [4, 8] }, { k: 'xe', w: [11.5, 15] }, { k: 'pc', w: [5, 8], note: 'Dải phân cách, đường sắt đô thị trên cao', rail: true },
      { k: 'xe', w: [11.5, 15] }, { k: 'he', w: [4, 8] }
    ]
  },
  {
    id: '8-8', ten: 'Các trục chính đô thị cấp 2', loai: 'Trục chính đô thị', b: [30, 36],
    parts: [{ k: 'he', w: [4, 6] }, { k: 'xe', w: [9.5, 12.5] }, { k: 'pc', w: [5, 6] }, { k: 'xe', w: [9.5, 12.5] }, { k: 'he', w: [4, 6] }]
  },
  {
    id: '9-9', ten: 'Các trục chính khu vực', loai: 'Đường khu vực', b: [19.5, 26],
    parts: [{ k: 'he', w: [4, 6] }, { k: 'xe', w: [9.5, 15] }, { k: 'he', w: [4, 6] }]
  },
  { id: '10-10', ten: '', loai: '', b: null, parts: [] }
];

const BY_ID = new Map(ROAD_SECTIONS.map(s => [s.id.toUpperCase(), s]));

/** Mặt cắt theo ký hiệu kyhieumatcat ("9-9", "7a-7a", "9") → mục ROAD_SECTIONS | null */
export function roadSectionOf(code) {
  const c = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!c) return null;
  return BY_ID.get(c) || BY_ID.get(`${c}-${c}`) || null;
}

const num = (n) => n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
/** Bề rộng số hoặc [min, max] → "11,5–15" */
export const fmtWidth = (w) => (Array.isArray(w) ? (w[0] === w[1] ? num(w[0]) : `${num(w[0])}–${num(w[1])}`) : num(w));
const mid = (w) => (Array.isArray(w) ? (w[0] + w[1]) / 2 : w);

const W = 280;
const PAD = 4;
const SIDE_PX = 32;
const GROUND = 36;
const RED = '#ef4444';

function sideHtml(x0, x1, info, anchorLeft) {
  const y = GROUND + 2;
  const width = info.w ? `${fmtWidth(info.w)} m` : '';
  const tx = anchorLeft ? x0 : x1;
  const anchor = anchorLeft ? 'start' : 'end';
  const rail = info.rail
    ? `<rect x="${(x0 + x1) / 2 - 7}" y="8" width="14" height="6" fill="#f87171"/><line x1="${(x0 + x1) / 2}" y1="14" x2="${(x0 + x1) / 2}" y2="${GROUND}" stroke="#f87171" stroke-width="2"/>`
    : '';
  return `<g><title>${info.title || info.label} ${width} (ngoài chỉ giới đường đỏ)</title>${rail}`
    + `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="#94a3b8" stroke-dasharray="3 2"/>`
    + `<text x="${tx}" y="${GROUND + 10}" text-anchor="${anchor}" class="rs-side">${info.label}</text>`
    + (width ? `<text x="${tx}" y="${GROUND + 18}" text-anchor="${anchor}" class="rs-side">${width}</text>` : '')
    + '</g>';
}

/** SVG mặt cắt (chuỗi) */
export function roadSectionSvg(sec) {
  const left = sec.side ? SIDE_PX : 0;
  const right = sec.right ? SIDE_PX * 2 : sec.side ? SIDE_PX : 0;
  const x0 = PAD + left;
  const x1 = W - PAD - right;
  const total = sec.parts.reduce((s, p) => s + mid(p.w), 0);
  const k = (x1 - x0) / total;
  let x = x0;
  const parts = sec.parts.map(p => {
    const kind = KINDS[p.k];
    const w = mid(p.w) * k;
    const label = `${p.note || kind.label} ${fmtWidth(p.w)} m`;
    const px = x;
    x += w;
    const text = w < 17 ? ''
      : p.rail ? `<text x="${px + w - 1}" y="${kind.top - 4}" text-anchor="end" class="rs-w">${fmtWidth(p.w)}</text>`
      : `<text x="${px + w / 2}" y="${kind.top - 4}" text-anchor="middle" class="rs-w">${fmtWidth(p.w)}</text>`;
    const rail = p.rail
      ? `<rect x="${px + w / 2 - 7}" y="5" width="14" height="6" fill="#f87171"/><line x1="${px + w / 2}" y1="11" x2="${px + w / 2}" y2="${kind.top}" stroke="#f87171" stroke-width="2"/>`
      : '';
    return `<g><title>${label}</title><rect x="${px.toFixed(1)}" y="${kind.top}" width="${w.toFixed(1)}" height="${GROUND - kind.top}" fill="${kind.fill}"/>${rail}${text}</g>`;
  }).join('');
  const sides = [
    sec.side ? sideHtml(PAD, x0, sec.side, true) : '',
    sec.side && !sec.right ? sideHtml(x1, W - PAD, sec.side, false) : '',
    sec.right ? sideHtml(x1, W - PAD, sec.right, false) : ''
  ].join('');
  const dim = GROUND + 9;
  return `<svg class="rs-svg" viewBox="0 0 ${W} 60" role="img" aria-label="Mặt cắt ${sec.id}: ${sec.ten}">`
    + `<line x1="${PAD}" y1="${GROUND}" x2="${W - PAD}" y2="${GROUND}" stroke="#64748b"/>`
    + parts + sides
    + `<line x1="${x0}" y1="4" x2="${x0}" y2="${dim + 3}" stroke="${RED}" stroke-dasharray="4 2"/>`
    + `<line x1="${x1}" y1="4" x2="${x1}" y2="${dim + 3}" stroke="${RED}" stroke-dasharray="4 2"/>`
    + `<line x1="${x0}" y1="${dim}" x2="${x1}" y2="${dim}" stroke="${RED}"/>`
    + `<text x="${(x0 + x1) / 2}" y="${dim + 10}" text-anchor="middle" class="rs-b">B = ${fmtWidth(sec.b)} m</text>`
    + '</svg>';
}

function sectionHtml(sec) {
  if (!sec.parts.length) {
    return `<div class="rs-item rs-missing"><div class="rs-head"><b>${sec.id}</b><span>Chưa có bản vẽ mặt cắt</span></div></div>`;
  }
  const seq = `${sec.parts.map(p => `${fmtWidth(p.w)}m`).join(' + ')} = ${fmtWidth(sec.b)}m`;
  return `<div class="rs-item" data-section="${sec.id}">
    <div class="rs-head"><b>${sec.id}</b><span title="${sec.loai}">${sec.ten}</span><em>${fmtWidth(sec.b)} m</em></div>
    ${roadSectionSvg(sec)}
    <div class="rs-seq" style="--rs-n:${seq.length}" title="Bề rộng các thành phần từ trái sang phải">${seq}</div>
  </div>`;
}

/** Nhóm «Mặt cắt ngang đường» trong tab Chú giải (bộ QHC 1/10.000) */
export function renderRoadSections(container) {
  if (!container) return;
  const chips = Object.values(KINDS).map(kd => `<span><i style="background:${kd.fill}"></i>${kd.label}</span>`).join('')
    + `<span><i class="rs-red"></i>Chỉ giới đường đỏ</span>`;
  container.innerHTML = `<details class="tt16-group" open>
    <summary><span class="tt16-group-name">Mặt cắt ngang đường</span><span class="tt16-group-count">${ROAD_SECTIONS.filter(s => s.parts.length).length}</span></summary>
    <div class="rs-kinds">${chips}</div>
    ${ROAD_SECTIONS.map(sectionHtml).join('')}
  </details>`;
}
