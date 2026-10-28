// Chuỗi và khung HTML của bảng thông tin lô. Không đụng bản đồ, không gọi mạng.
import { escapeHtml, ico, planItems } from './utils.js';
import { namesOfProject } from './projectNames.js';

function fold(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
}

// QHPK, ĐTM, XD… trong câu chữ. Mã lô (CX14) không khớp các mẫu này.
const ABBREV = [
  ['QHCT', 'quy hoạch chi tiết'],
  ['QHPK', 'quy hoạch phân khu'],
  ['QHC', 'quy hoạch chung'],
  ['ĐTM', 'đô thị mới'],
  ['DTM', 'đô thị mới'],
  ['KĐT', 'khu đô thị'],
  ['KDT', 'khu đô thị'],
  ['KCN', 'khu công nghiệp'],
  ['KDL', 'khu du lịch'],
  ['NOXH', 'nhà ở xã hội'],
  ['PCCC', 'phòng cháy và chữa cháy'],
  ['TTTM', 'trung tâm thương mại'],
  ['TDTT', 'thể dục thể thao'],
  ['THPT', 'trung học phổ thông'],
  ['THCS', 'trung học cơ sở'],
  ['SDĐ', 'sử dụng đất'],
  ['SDD', 'sử dụng đất'],
  ['XD', 'xây dựng'],
  ['QH', 'quy hoạch'],
  ['HT', 'hiện trạng']
];

export function expandPlanWords(value) {
  let s = String(value || '');
  ABBREV.forEach(([from, to]) => {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${from})(?=$|[^\\p{L}\\p{N}])`, 'giu');
    s = s.replace(re, `$1${to}`);
  });
  // TH / MN chỉ khi đứng một mình (không nuốt mã lô TH.1, TH7). PTTH trước TH.
  [['PTTH', 'trung học phổ thông'], ['TH', 'tiểu học'], ['MN', 'mầm non']].forEach(([from, to]) => {
    s = s.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${from}(?=\\s|$)`, 'giu'), `$1${to}`);
  });
  return s.replace(/\s+/g, ' ').trim();
}

function capAfterDash(s) {
  return s.replace(/(^|\s[–—-]\s+)(\p{L})/gu, (m, pre, ch) => pre + ch.toLocaleUpperCase('vi'));
}

/** Tên đồ án viết đủ: QHPK Khu A - ĐTM… → Quy hoạch phân khu Khu A – Đô thị mới… */
export function projectFullName(raw) {
  const source = String(raw || '').trim();
  if (!source) return '';
  const full = namesOfProject({ tenQH: source }).tenDayDu || source;
  // Tiền tố file "QH-QHPK …" thành "Quy hoạch – Quy hoạch phân khu …": bỏ lần lặp.
  const once = expandPlanWords(full).replace(/^quy hoạch\s*[–—-]\s*(?=quy hoạch\b)/i, '');
  return capAfterDash(once);
}

/** Phường Vỹ Dạ → { label: 'Phường', name: 'Vỹ Dạ' } */
export function placeField(ward) {
  const s = String(ward || '').trim();
  const m = s.match(/^(Phường|Xã|Thị trấn)\s+(.+)$/iu);
  if (!m) return { label: 'Địa bàn', name: s };
  const key = fold(m[1]);
  const label = key === 'phuong' ? 'Phường' : key === 'xa' ? 'Xã' : 'Thị trấn';
  return { label, name: m[2].trim() };
}

// Bỏ đuôi " – đồ án #stt" và đoạn sau dấu _ (phụ đề CAD). Nếu đuôi tên trùng đầu loại đất thì cắt đuôi đó.
function dropKindSuffix(head, kind) {
  const words = String(head || '').split(/\s+/).filter(Boolean);
  const kindWords = fold(kind).split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length < 3 || !kindWords.length) return words.join(' ');
  let cut = 0;
  const max = words.length - 2;
  for (let n = 1; n <= max && n <= kindWords.length; n++) {
    const suffix = words.slice(-n).map(fold);
    if (suffix.every((w, i) => w === kindWords[i])) cut = n;
  }
  return words.slice(0, words.length - cut).join(' ');
}

/**
 * Tiêu đề lô: loại đất ngắn + mã lô. kind là dòng cam (cấp công trình) để bỏ cụm trùng.
 * "Đất cây xanh công viên_thể dục thể thao" + CX14 + "Công viên khu vực…" → "Đất cây xanh CX14".
 */
export function lotHeading(name, lotCode, kind) {
  let t = String(name || '').replace(/\s+–\s+[^–]*#\d+$/, '').trim();
  let code = String(lotCode || '').trim();
  if (code && t.toLowerCase().endsWith(code.toLowerCase())) t = t.slice(0, -code.length).trim();
  else if (!code) {
    const m = t.match(/(?:^|[\s_])([A-Za-z]{1,8}\d[\w.-]{0,12})$/);
    if (m) {
      code = m[1];
      t = t.slice(0, m.index).trim();
    }
  }
  const under = t.indexOf('_');
  if (under > 0) t = t.slice(0, under).trim();
  t = expandPlanWords(t.replace(/_/g, ' '));
  t = dropKindSuffix(t, kind);
  t = t.replace(/[\s,;:–—-]+$/g, '').trim();
  if (code && t && !fold(t).includes(fold(code))) t = `${t} ${code}`;
  else if (code && !t) t = code;
  return t;
}

export function limitItems(plan) {
  return planItems(plan).map(s => ({
    label: s.label,
    text: String(s.text || '').replace(/^≤(?=\S)/, '≤ ')
  }));
}

export function limitsHtml(plan) {
  const items = limitItems(plan);
  if (!items.length) return '';
  return `<div class="lp-limits">${items.map(s => `<span class="lp-limit"><span class="lp-limit-k">${escapeHtml(s.label)}</span> <b>${escapeHtml(s.text)}</b></span>`).join('')}</div>`;
}

/** Giá trị chỉ tiêu theo icon planItems (floors/coverage/layers); trống → «—». */
function planMetricText(plan, icon) {
  const raw = planItems(plan).find(s => s.icon === icon);
  if (!raw) return '—';
  return String(raw.text || '').replace(/^≤(?=\S)/, '≤ ');
}

/**
 * Lưới 2×2 chỉ tiêu lô (diện tích + mật độ + tầng cao + hệ số).
 * Luôn bốn ô để dễ đọc; thiếu số thì «—».
 */
export function metricGridHtml(areaText, plan) {
  const cells = [
    { tone: 'area', icon: 'ruler', label: 'Diện tích', value: areaText || '—' },
    { tone: 'cover', icon: 'coverage', label: 'Mật độ XD', value: planMetricText(plan, 'coverage') },
    { tone: 'floors', icon: 'floors', label: 'Chiều cao tối đa', value: planMetricText(plan, 'floors') },
    { tone: 'far', icon: 'layers', label: 'Hệ số sử dụng', value: planMetricText(plan, 'layers') }
  ];
  return `<div class="lp-metrics" role="list">${cells.map(c => `
    <div class="lp-metric lp-metric-${c.tone}" role="listitem">
      <span class="lp-metric-ico" aria-hidden="true">${ico(c.icon)}</span>
      <span class="lp-metric-body"><small>${escapeHtml(c.label)}</small><b>${escapeHtml(c.value)}</b></span>
    </div>`).join('')}</div>`;
}

/** Dải chức năng sử dụng đất dưới lưới chỉ tiêu (một hàng gọn). */
export function landUseBannerHtml(type) {
  const label = String(type || '').trim();
  if (!label) return '';
  return `<div class="lp-landuse">
    <span class="lp-landuse-ico" aria-hidden="true">${ico('home')}</span>
    <span class="lp-landuse-text"><small>Chức năng SDĐ</small><b>${escapeHtml(label)}</b></span>
  </div>`;
}

/** Tab Chỉ tiêu / Quy định: gắn quy chế, quyết định sau. */
export function landCardTabsHtml(active = 'chi-tieu') {
  const on = (id) => (active === id ? ' is-on' : '');
  return `<div class="lp-tabs" role="tablist">
    <button type="button" class="lp-tab${on('chi-tieu')}" role="tab" data-lp-tab="chi-tieu" aria-selected="${active === 'chi-tieu' ? 'true' : 'false'}">Chỉ tiêu</button>
    <button type="button" class="lp-tab${on('quy-dinh')}" role="tab" data-lp-tab="quy-dinh" aria-selected="${active === 'quy-dinh' ? 'true' : 'false'}">Quy định</button>
  </div>`;
}

/** Nội dung tab Quy định: nút hồ sơ đã gắn; chưa có thì một dòng trống ngắn. */
export function regulationsPaneHtml(entry) {
  const btns = dossierButtons(entry);
  const rows = btns.map(b => {
    const icon = DOSSIER_ICON[b.key] || 'file';
    return `<button type="button" class="lp-reg-btn lp-dossier" data-dossier="${b.key}">
      <span class="lp-reg-ico">${ico(icon)}</span>
      <span class="lp-reg-label">${escapeHtml(b.label)}</span>
      <span class="lp-reg-go" aria-hidden="true">→</span>
    </button>`;
  }).join('');
  if (rows) return `<div class="lp-regs">${rows}</div>`;
  return `<div class="lp-regs"><p class="lp-reg-empty">Chưa gắn quy định quản lý / quy chế kiến trúc.</p></div>`;
}

/** Gắn chuyển tab Chỉ tiêu / Quy định trên thẻ lô. */
export function bindLandCardTabs(root) {
  const el = root?.querySelector?.('.land-popup') || root;
  if (!el?.querySelector) return;
  const tabs = el.querySelectorAll('[data-lp-tab]');
  const panes = el.querySelectorAll('[data-lp-pane]');
  if (!tabs.length || !panes.length) return;
  tabs.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-lp-tab');
      tabs.forEach(t => {
        const on = t === btn;
        t.classList.toggle('is-on', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panes.forEach(p => {
        const show = p.getAttribute('data-lp-pane') === id;
        p.hidden = !show;
        p.classList.toggle('is-on', show);
      });
    });
  });
}

/** Hồ sơ đã gắn: quy chế (role quy-dinh), rồi quyết định phê duyệt. Chưa có file thì mảng rỗng. */
export function dossierButtons(entry) {
  if (!entry) return [];
  const out = [];
  const docs = Array.isArray(entry.docs) ? entry.docs : [];
  const reg = docs.find(d => d && d.role === 'quy-dinh' && d.id && (d.slug || d.url || entry.slug));
  if (reg) out.push({ key: 'quy-dinh', label: 'Quy chế' });
  const dec = entry.decision;
  if (dec && (dec.slug || dec.url)) out.push({ key: 'phe-duyet', label: 'Quyết định' });
  return out;
}

const DOSSIER_ICON = { 'quy-dinh': 'book', 'phe-duyet': 'file' };

export function projectValueHtml(rawName, entry) {
  const name = projectFullName(rawName);
  if (!name) return '';
  const btns = dossierButtons(entry).map(b => {
    const icon = DOSSIER_ICON[b.key] || 'file';
    const label = escapeHtml(b.label);
    return `<button type="button" class="lp-dossier" data-dossier="${b.key}" title="${label}" aria-label="${label}">${ico(icon)}</button>`;
  }).join('');
  return `<span class="lp-project-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>${btns}`;
}

export function pointToken(scenario, id) {
  return `p:${scenario === 'QH' ? 'QH' : 'HT'}:${encodeURIComponent(String(id || ''))}`;
}

export function landToken(phase, file, id) {
  return `d:${phase === 'HT' ? 'HT' : 'QH'}:${encodeURIComponent(String(file || ''))}:${encodeURIComponent(String(id || ''))}`;
}

export function parseLotToken(token) {
  const s = String(token || '');
  if (s.startsWith('p:')) {
    const rest = s.slice(2);
    const i = rest.indexOf(':');
    if (i < 1) return null;
    const id = decodeURIComponent(rest.slice(i + 1));
    if (!id) return null;
    return { type: 'point', scenario: rest.slice(0, i) === 'QH' ? 'QH' : 'HT', id };
  }
  if (s.startsWith('d:')) {
    const parts = s.slice(2).split(':');
    if (parts.length < 3) return null;
    const id = decodeURIComponent(parts.slice(2).join(':'));
    if (!id) return null;
    return { type: 'land', phase: parts[0] === 'HT' ? 'HT' : 'QH', file: decodeURIComponent(parts[1]), id };
  }
  return null;
}
