// Ba droplist HTXH (Loại / Cấp phục vụ / Phạm vi) + bảng công trình theo phường/xã.
// Diện tích lấy QuyMo_HT hoặc QuyMo_QH. Thiếu hoặc 0 (chưa rõ) thì «—», không cộng dồn thiếu.
import { state, getPlanScenarioList, layerType, ntKindOf, parkTierOf } from './state.js';
import { getViewMode, onViewChange } from './planMap.js';
import { zoomToPoint } from './mapEngine.js';
import { WARD_NAMES } from './facetStore.js';
import { escapeHtml } from './utils.js';

export const SOCIAL_TYPES = [
  { id: '1-CV', code: '1-CV', label: 'Công viên', title: 'Công viên, điểm xanh', chk: 'chk_c1' },
  { id: '2-BDX', code: '2-BDX', label: 'Bãi đỗ xe', title: 'Bãi đỗ xe, trạm sạc', chk: 'chk_c2' },
  { id: '3-MN', code: '3-MN', label: 'Mầm non', title: 'Trường mầm non', chk: 'chk_c3' },
  { id: '4-TH', code: '4-TH', label: 'Tiểu học', title: 'Trường tiểu học', chk: 'chk_c4' },
  { id: '5-THCS', code: '5-THCS', label: 'THCS', title: 'Trường THCS', chk: 'chk_c5' },
  { id: '6-THPT', code: '6-THPT', label: 'THPT', title: 'Trường THPT', chk: 'chk_c10' },
  { id: '7-YT', code: '7-YT', label: 'Y tế', title: 'Bệnh viện, trạm y tế', chk: 'chk_c6' },
  { id: '8-VH', code: '8-VH', label: 'Văn hóa', title: 'Nhà văn hóa, thể thao', chk: 'chk_c7' },
  { id: '9-TM', code: '9-TM', label: 'Chợ', title: 'Chợ, trung tâm thương mại', chk: 'chk_c8' },
  { id: '10-PCCC', code: '10-PCCC', label: 'Trụ sở PCCC', title: 'Trụ sở cảnh sát PCCC', chk: 'chk_c12' },
  { id: '13-BUS', code: '13-BUS', label: 'Trạm xe buýt', title: 'Trạm dừng xe buýt', chk: 'chk_c11' },
  { id: '11-NT-grave', code: '11-NT', label: 'Nghĩa trang', title: 'Nghĩa trang', chk: 'chk_nt_grave', nt: 'grave' },
  { id: '11-NT-funeral', code: '11-NT', label: 'Nhà tang lễ', title: 'Nhà tang lễ, cơ sở hỏa táng', chk: 'chk_nt_funeral', nt: 'funeral' }
];

/** @deprecated dùng SOCIAL_TYPES — giữ tên cũ cho test / import cũ */
export const SOCIAL_TABS = SOCIAL_TYPES;

const SERVICE_LEVELS = [
  { id: '', label: 'Tất cả cấp' },
  { id: 'vung', label: 'Cấp vùng' },
  { id: 'dothi', label: 'Cấp đô thị' },
  { id: 'don-vi', label: 'Cấp đơn vị ở' },
  { id: 'nhom-nha', label: 'Cấp nhóm nhà ở' }
];

const AREA = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();

let active = '1-CV';
let level = '';
let ward = '';
let loaded = false;
let booted = false;

function typeOf(id) {
  return SOCIAL_TYPES.find(t => t.id === id) || SOCIAL_TYPES[0];
}

function areaOf(item, qh) {
  const raw = qh ? item.sizeQH : item.sizeHT;
  const n = Number(raw);
  if (raw == null || raw === '' || !Number.isFinite(n) || n <= 0) return null;
  return n;
}

function areaText(n) {
  if (n == null) return '-';
  return `${AREA.format(n)} m²`;
}

function isFuneralKind(kind) {
  return kind === 'funeral' || kind === 'crematorium';
}

/** Cấp phục vụ suy từ Nhom_HaTang / hạng công viên; chỉ lọc khi chọn cấp và mục khớp. */
export function serviceLevelOf(item) {
  const raw = fold(item?.nhomHaTang || item?.capCongTrinh || '');
  if (raw.includes('vung') || raw.includes('cap vung')) return 'vung';
  if (raw.includes('nhom nha')) return 'nhom-nha';
  const code = layerType(item);
  if (code === '1-CV') {
    const park = parkTierOf(item.size, item.nhomHaTang);
    if (park.key === 'garden') return 'nhom-nha';
    if (park.urban) return 'dothi';
    return 'don-vi';
  }
  if (raw.includes('do thi') || /_DT$/i.test(String(item?.id || ''))) return 'dothi';
  if (code === '6-THPT') return 'dothi';
  return 'don-vi';
}

function matchNt(item, tab) {
  if (!tab.nt) return true;
  const kind = ntKindOf(item);
  if (tab.nt === 'funeral') return isFuneralKind(kind);
  return !isFuneralKind(kind);
}

function rowsFor(tab) {
  const qh = getViewMode() === 'QH';
  const src = qh ? getPlanScenarioList() : (state.rawDataList || []);
  const seen = new Set();
  const out = [];
  src.forEach(item => {
    if (!item || layerType(item) !== tab.code) return;
    if (!matchNt(item, tab)) return;
    const id = String(item.id || '');
    if (id && seen.has(id)) return;
    if (id) seen.add(id);
    out.push(item);
  });
  return { qh, rows: out };
}

function levelsPresent(rows) {
  const have = new Set(rows.map(serviceLevelOf));
  return SERVICE_LEVELS.filter(lv => !lv.id || have.has(lv.id));
}

function paintPicks(tab, levelOpts) {
  const host = document.getElementById('xahoiPicks');
  if (!host) return;
  if (level && !levelOpts.some(lv => lv.id === level)) level = '';
  if (ward && !WARD_NAMES.includes(ward)) ward = '';
  const opt = (value, label, on) => `<option value="${escapeHtml(value)}"${on ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const types = SOCIAL_TYPES.map(t => opt(t.id, t.label, t.id === tab.id)).join('');
  const levels = levelOpts.map(lv => opt(lv.id, lv.label, lv.id === level)).join('');
  const scopes = [opt('', 'Thành phố Huế', !ward)].concat(
    WARD_NAMES.map(name => opt(name, name, name === ward))
  ).join('');
  host.innerHTML = `<div class="cn-picks xh-picks">
    <label><span>Loại công trình</span><select data-xh-type aria-label="Loại công trình">${types}</select></label>
    <label><span>Cấp phục vụ</span><select data-xh-level aria-label="Cấp phục vụ">${levels}</select></label>
    <label><span>Phạm vi</span><select data-xh-scope aria-label="Phạm vi">${scopes}</select></label>
  </div>`;
}

export function paintXahoiList() {
  const host = document.getElementById('xahoiList');
  if (!host) return;
  const tab = typeOf(active);
  if (!loaded) {
    paintPicks(tab, SERVICE_LEVELS);
    host.innerHTML = `<p class="cn-empty">Chưa tải danh sách công trình.</p>`;
    return;
  }
  const { rows, qh } = rowsFor(tab);
  const levelOpts = levelsPresent(rows);
  const q = fold(document.getElementById('layerSearch')?.value || '');
  let matched = rows.filter(item => !q || fold(`${item.name} ${item.ward}`).includes(q));
  if (level) matched = matched.filter(item => serviceLevelOf(item) === level);
  const groups = new Map();
  matched.forEach(item => {
    const name = String(item.ward || '').trim() || 'Chưa rõ phường, xã';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(item);
  });
  const order = new Map(WARD_NAMES.map((name, i) => [fold(name), i]));
  const wards = [...groups.keys()].sort((a, b) => {
    const ia = order.has(fold(a)) ? order.get(fold(a)) : 1000;
    const ib = order.has(fold(b)) ? order.get(fold(b)) : 1000;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b, 'vi');
  });
  paintPicks(tab, levelOpts.length > 1 ? levelOpts : SERVICE_LEVELS);
  if (!rows.length) {
    host.innerHTML = `<p class="cn-empty">Chưa có công trình ${escapeHtml(tab.title)}.</p>`;
    return;
  }
  if (!matched.length) {
    host.innerHTML = `<p class="cn-empty">${level ? 'Không có công trình ở cấp đã chọn.' : 'Không khớp.'}</p>`;
    return;
  }
  const shown = ward ? wards.filter(name => name === ward) : wards;
  if (ward && !shown.length) {
    host.innerHTML = `<p class="cn-empty">Không có công trình tại ${escapeHtml(ward)}.</p>`;
    return;
  }
  const all = [];
  shown.forEach(name => {
    const items = groups.get(name).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
    items.forEach(item => all.push({ item, wardName: name }));
  });
  let stt = 0;
  const body = all.map(({ item, wardName }) => {
    stt += 1;
    const lat = Number(item.lat);
    const lng = Number(item.lng);
    const ok = Number.isFinite(lat) && Number.isFinite(lng);
    const title = item.name || '-';
    const area = areaOf(item, qh);
    const pending = item.status === false ? ' · Chờ duyệt' : '';
    const tip = [title, wardName, areaText(area)].filter(Boolean).join(' — ');
    return `<button type="button" class="project-row xh-item"${ok ? '' : ' disabled'} data-xh-chk="${escapeHtml(tab.chk)}" ${ok ? `data-lat="${lat}" data-lng="${lng}"` : ''} data-name="${escapeHtml(title)}" title="${escapeHtml(tip)}">
      <span class="project-name"><span class="xh-item-name">${stt}. ${escapeHtml(title)}${pending ? `<small class="xh-pending">${escapeHtml(pending)}</small>` : ''}</span></span>
      <span class="project-meta xh-ward">${escapeHtml(wardName)}</span>
      <span class="project-meta xh-area${area == null ? ' is-miss' : ''}">${escapeHtml(areaText(area))}</span>
    </button>`;
  }).join('');
  const areas = all.map(({ item }) => areaOf(item, qh));
  const sum = areas.every(n => n != null) ? areas.reduce((s, n) => s + n, 0) : null;
  host.innerHTML = `<div class="project-list xh-list"><p class="xh-list-head">${escapeHtml(tab.title)} · ${all.length} công trình · ${escapeHtml(areaText(sum))}</p>${body}</div>`;
}

function ensureLayer(chkId) {
  const chk = chkId && document.getElementById(chkId);
  if (!chk || chk.checked) return;
  chk.checked = true;
  chk.dispatchEvent(new Event('change', { bubbles: true }));
}

export function initXahoiList() {
  if (booted) return;
  booted = true;
  document.getElementById('xahoiPicks')?.addEventListener('change', (e) => {
    if (e.target.matches('[data-xh-type]')) {
      active = e.target.value;
      level = '';
      paintXahoiList();
    }
    if (e.target.matches('[data-xh-level]')) {
      level = e.target.value;
      paintXahoiList();
    }
    if (e.target.matches('[data-xh-scope]')) {
      ward = e.target.value;
      paintXahoiList();
    }
  });
  document.getElementById('xahoiList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.xh-item');
    if (!btn || btn.disabled) return;
    const lat = Number(btn.dataset.lat);
    const lng = Number(btn.dataset.lng);
    ensureLayer(btn.dataset.xhChk);
    zoomToPoint(lat, lng, btn.dataset.name || '');
  });
  document.addEventListener('infra:ready', () => {
    loaded = true;
    paintXahoiList();
  });
  onViewChange(() => paintXahoiList());
  paintXahoiList();
}
