// Mạng lưới giao thông đường bộ + đường sắt đồ án QHC đô thị TT Huế 2045 (giaothong10.json, giaothong25.json dựng bằng
// scripts/build-qhc2045.js): cấp đường, loại đường sắt, kiểu nét theo giai đoạn, popup đoạn tuyến (lộ giới tra theo ký hiệu
// mặt cắt – roadSections.js), thống kê km và chú giải. Không phụ thuộc Leaflet: lớp bản đồ ở qhc2045Layer.js.
import { QHC2045 } from './qhc2045.js';
import { withAssetVersion } from './gbaVersion.js';
import { roadSectionOf, roadSectionSvg, fmtWidth } from './roadSections.js';
import { escapeHtml, fmtNum } from './utils.js';

// rank: thứ tự vẽ (cấp cao nằm trên, hầm nằm dưới mọi đường). label25: nhãn bản vẽ 1/25.000 khi khác 1/10.000.
// short: nhãn gọn cho nút chú giải (một dòng trong nửa cột panel). glow: màu quầng khi làm nổi nếu màu nét quá tối
export const ROAD_CLASSES = {
  ham: { label: 'Hầm đường bộ', color: '#a78bfa', weight: 3.2, rank: -1 },
  kv: { label: 'Đường cấp khu vực', short: 'Đường cấp KV', color: '#cbd5e1', weight: 1.6, rank: 0 },
  dothi: { label: 'Đường cấp đô thị', short: 'Đường cấp ĐT', label25: 'Đường trục chính đô thị', short25: 'Trục chính ĐT', color: '#fde68a', weight: 2.6, rank: 1 },
  dt: { label: 'Đường tỉnh', color: '#facc15', weight: 3.2, rank: 2 },
  ql: { label: 'Quốc lộ', color: '#f97316', weight: 4, rank: 3 },
  ct: { label: 'Đường cao tốc', color: '#dc2626', weight: 5, rank: 4 }
};
export const RAIL_KINDS = {
  qg: { label: 'Đường sắt quốc gia', short: 'Đường sắt QG', color: '#1e293b', glow: '#e2e8f0' },
  tdc: { label: 'Đường sắt tốc độ cao', short: 'Đường sắt CT', color: '#7c3aed' },
  dsdt: { label: 'Đường sắt đô thị', short: 'Đường sắt ĐT', color: '#0891b2' },
  ngam: { label: 'Đường sắt đô thị ngầm', short: 'Đường sắt ngầm', color: '#0891b2', under: true }
};
// Cùng chỉ số giai đoạn với lô sử dụng đất (nút Hiện trạng / Đến 2030 / Đến 2045): hiện trạng nét liền, quy hoạch nét đứt
export const ROAD_STAGES = [
  { label: 'Hiện trạng', dash: null },
  { label: 'Ngắn hạn 2030', dash: '10 6' },
  { label: 'Dài hạn 2045', dash: '3 5' }
];
const CASING = '#0f172a';
const RAIL_TIES = '#f8fafc';

// Bấm ký hiệu ở chú giải → qhc2045Layer.js phóng tới và làm nổi loại tuyến đó (detail { scale, key }, bấm lại để bỏ);
// lớp báo lại trạng thái đang nổi để tô nút (detail { scale, key | null })
export const ROAD_FOCUS_EVENT = 'qh:road-focus';
export const ROAD_FOCUS_STATE = 'qh:road-focus-state';
/** Khóa loại tuyến: 'b:ql', 's:tdc'… */
export const trafficKey = (f) => `${f.properties.L}:${f.properties.c}`;

const cache = {};
/** FeatureCollection giao thông tỷ lệ scale ('10' | '25'), tải một lần */
export function loadTraffic(scale) {
  if (!cache[scale]) {
    cache[scale] = fetch(withAssetVersion(QHC2045.urls[`road${scale}`]))
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .catch(err => { delete cache[scale]; throw err; });
  }
  return cache[scale];
}

export const isRail = (f) => f.properties.L === 's';
export const roadClassOf = (p) => ROAD_CLASSES[p.c] || ROAD_CLASSES.kv;
const railKindOf = (p) => RAIL_KINDS[p.c] || RAIL_KINDS.qg;
const classLabel = (p, scale) => (p.L === 's' ? railKindOf(p).label : (scale === '25' && roadClassOf(p).label25) || roadClassOf(p).label);
const shortLabel = (p, scale) => {
  if (p.L === 's') return railKindOf(p).short || railKindOf(p).label;
  const c = roadClassOf(p);
  return (scale === '25' && c.label25 ? c.short25 : c.short) || classLabel(p, scale);
};
/** Màu quầng khi làm nổi một loại tuyến */
export const trafficGlowColor = (f) => {
  if (!isRail(f)) return roadClassOf(f.properties).color;
  const k = railKindOf(f.properties);
  return k.glow || k.color;
};

/** Thứ tự vẽ: đường cấp thấp dưới, đường sắt trên cùng */
export const trafficRank = (f) => (isRail(f) ? 10 : roadClassOf(f.properties).rank);

/** [nét viền, nét chính] — mỗi đoạn vẽ 2 lớp để nổi trên ảnh vệ tinh và nền lô */
export function trafficStyles(f) {
  const p = f.properties;
  const dash = ROAD_STAGES[p.t]?.dash || null;
  if (isRail(f)) {
    const k = railKindOf(p);
    const w = p.nh ? 3 : 4;
    if (k.under) {
      return [
        { color: CASING, weight: w + 2, opacity: 0.5, dashArray: null },
        { color: k.color, weight: w, opacity: 1, dashArray: '4 4' }
      ];
    }
    return [
      { color: k.color, weight: w + 1.5, opacity: 1, dashArray: null },
      { color: RAIL_TIES, weight: Math.max(1.5, w - 2), opacity: 0.95, dashArray: '7 7' }
    ];
  }
  const c = roadClassOf(p);
  return [
    { color: CASING, weight: c.weight + 2.2, opacity: 0.55, dashArray: null },
    { color: c.color, weight: c.weight, opacity: 1, dashArray: p.c === 'ham' ? '2 4' : dash }
  ];
}

const lengthText = (m) => (m >= 1000 ? `${fmtNum(m / 1000)} km` : `${Math.round(m)} m`);

/** Mẫu nét (SVG) dùng trong chú giải và đầu popup */
export function trafficSwatch(f, w = 28) {
  const lines = trafficStyles(f).map(s => `<line x1="1" y1="6" x2="${w - 1}" y2="6" stroke="${s.color}" stroke-width="${s.weight}" stroke-opacity="${s.opacity}"${s.dashArray ? ` stroke-dasharray="${s.dashArray}"` : ''}/>`).join('');
  return `<svg class="qr-sw" width="${w}" height="12" viewBox="0 0 ${w} 12" aria-hidden="true">${lines}</svg>`;
}

/** Nội dung popup một đoạn tuyến. ward: phường, xã tại điểm bấm */
export function trafficPopupHtml(f, scale, ward) {
  const p = f.properties;
  const rail = isRail(f);
  const kind = classLabel(p, scale);
  const sec = roadSectionOf(p.s);
  const row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  let secRows = '';
  let secSvg = '';
  if (p.s) {
    const head = sec?.ten ? `${escapeHtml(p.s)} · ${escapeHtml(sec.ten)}` : escapeHtml(p.s);
    secRows = row(rail ? 'Đặt trong mặt cắt' : 'Mặt cắt', head)
      + row('Lộ giới', sec?.b ? `<b>${fmtWidth(sec.b)} m</b>` : '<span class="ua-tip-muted">Chưa có bản vẽ mặt cắt</span>');
    if (sec?.parts.length) secSvg = `<div class="qr-pop-sec">${roadSectionSvg(sec)}</div>`;
  } else if (!rail) {
    secRows = row('Lộ giới', `<span class="ua-tip-muted">Bản vẽ ${scale === '25' ? '1/25.000 không ghi' : 'chưa ghi'} ký hiệu mặt cắt</span>`);
  }
  return `<div class="qhc-pop">
      <div class="qhc-pop-head">${trafficSwatch(f)}<b>${escapeHtml(p.n || kind)}</b></div>
      <table class="qhc-pop-table">
        ${row(rail ? 'Loại' : 'Cấp đường', escapeHtml(p.nh ? `${kind} (nhánh)` : kind))}
        ${row('Giai đoạn', p.t != null ? escapeHtml(ROAD_STAGES[p.t]?.label || '') : '<span class="ua-tip-muted">Không ghi</span>')}
        ${row('Chiều dài', lengthText(p.l))}
        ${secRows}
        ${ward ? row('Phường, xã', escapeHtml(ward)) : ''}
      </table>
      ${secSvg}
      <div class="qhc-pop-src">${escapeHtml(QHC2045.short)} · Giao thông 1/${scale === '25' ? '25.000' : '10.000'} · <span class="qhc-flag">${escapeHtml(QHC2045.status)}</span></div>
    </div>`;
}

/** Tổng chiều dài (m) theo loại × giai đoạn: [{ key, rail, label, sample, m: [HT, 2030, 2045, không ghi], total }].
 *  sample: đối tượng mẫu không mang giai đoạn, vẽ ký hiệu nét liền */
export function trafficStats(fc, scale) {
  const rows = new Map();
  fc.features.forEach(f => {
    const p = f.properties;
    const key = `${p.L}:${p.c}`;
    let r = rows.get(key);
    if (!r) {
      r = { key, rail: isRail(f), label: classLabel(p, scale), sample: { properties: { L: p.L, c: p.c } }, m: [0, 0, 0, 0], total: 0 };
      rows.set(key, r);
    }
    r.m[p.t != null && p.t >= 0 ? p.t : 3] += p.l || 0;
    r.total += p.l || 0;
  });
  return [...rows.values()].sort((a, b) => (a.rail - b.rail) || trafficRank(b.sample) - trafficRank(a.sample));
}

function statsTable(fc, scale) {
  const rows = trafficStats(fc, scale);
  const cell = (m) => `<td>${m ? fmtNum(m / 1000) : '–'}</td>`;
  const body = rows.map(r => `<tr><th>${escapeHtml(r.label)}${r.m[3] ? '*' : ''}</th>${[0, 1, 2].map(i => cell(r.m[i])).join('')}<td><b>${fmtNum(r.total / 1000)}</b></td></tr>`).join('');
  const note = rows.some(r => r.m[3]) ? '<p class="qr-note">* Bản vẽ không ghi giai đoạn: chỉ tính vào tổng.</p>' : '';
  return `<table class="qr-stats"><thead><tr><th>km</th><th>HT</th><th>2030</th><th>2045</th><th>Tổng</th></tr></thead><tbody>${body}</tbody></table>${note}`;
}

/** Nhóm «Mạng lưới giao thông» trong tab Chú giải (bộ QHC hoặc QHC25): ký hiệu nét + bảng km, tải dữ liệu khi mở nhóm */
export function renderTrafficLegend(container, scale) {
  if (!container) return;
  const sample = (props) => ({ properties: props });
  const classes = scale === '25' ? ['ct', 'ql', 'dt', 'dothi', 'ham'] : ['ct', 'ql', 'dt', 'dothi', 'kv'];
  const rails = Object.keys(RAIL_KINDS);
  // Ô ký hiệu cùng khổ ô «Viền lô theo giai đoạn» (.tt16-frame 28×14): mẫu nét 26×12 vừa trong viền 1px
  const frame = (f) => `<span class="qr-box">${trafficSwatch(f, 26)}</span>`;
  const item = (f, label) => `<span class="qr-row">${frame(f)}<span>${escapeHtml(label)}</span></span>`;
  const btn = (f) => {
    const p = f.properties;
    const full = classLabel(p, scale);
    return `<button type="button" class="qr-row qr-btn" data-road-key="${trafficKey(f)}" aria-pressed="false" title="${escapeHtml(`${full}: phóng tới toàn bộ tuyến và làm nổi; bấm lại để bỏ`)}">${frame(f)}<span>${escapeHtml(shortLabel(p, scale))}</span></button>`;
  };
  const roadItems = classes.map(c => btn(sample({ L: 'b', c }))).join('');
  const railItems = rails.map(c => btn(sample({ L: 's', c }))).join('');
  const stageItems = ROAD_STAGES.map((s, t) => item(sample({ L: 'b', c: 'dothi', t }), s.label)).join('');
  container.innerHTML = `<details class="tt16-group">
    <summary><span class="tt16-group-name">Mạng lưới giao thông</span><span class="tt16-group-count">${classes.length + rails.length}</span></summary>
    <div class="qr-legend">
      <div class="qr-sub">Cấp đường</div><div class="qr-grid">${roadItems}</div>
      <div class="qr-sub">Đường sắt</div><div class="qr-grid">${railItems}</div>
      <div class="qr-sub">Giai đoạn (kiểu nét)</div><div class="qr-grid">${stageItems}</div>
      <div class="qr-stats-box"><span class="ua-tip-muted">Mở nhóm để tính chiều dài…</span></div>
    </div>
  </details>`;
  container.addEventListener('click', (e) => {
    const b = e.target.closest('[data-road-key]');
    if (b) document.dispatchEvent(new CustomEvent(ROAD_FOCUS_EVENT, { detail: { scale, key: b.dataset.roadKey } }));
  });
  document.addEventListener(ROAD_FOCUS_STATE, (e) => {
    if (e.detail?.scale !== scale) return;
    container.querySelectorAll('[data-road-key]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.roadKey === e.detail.key)));
  });
  const details = container.querySelector('details');
  const box = container.querySelector('.qr-stats-box');
  details.addEventListener('toggle', () => {
    if (!details.open || box.dataset.done) return;
    box.dataset.done = '1';
    box.innerHTML = '<span class="ua-tip-muted">Đang tính…</span>';
    loadTraffic(scale)
      .then(fc => { box.innerHTML = statsTable(fc, scale); })
      .catch(() => { delete box.dataset.done; box.innerHTML = '<span class="ua-tip-muted">Không tải được dữ liệu giao thông</span>'; });
  });
}
