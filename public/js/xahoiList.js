// Tám loại hạ tầng xã hội theo mã Sheet. Danh sách nhóm theo phường/xã.
// Diện tích lấy QuyMo_HT hoặc QuyMo_QH. Thiếu hoặc 0 (chưa rõ) thì «—», không cộng dồn thiếu.
import { state, getPlanScenarioList, layerType } from './state.js';
import { getViewMode, onViewChange } from './planMap.js';
import { zoomToPoint } from './mapEngine.js';
import { WARD_NAMES } from './facetStore.js';
import { escapeHtml } from './utils.js';

export const SOCIAL_TABS = [
  { code: '1-CV', label: 'Công viên', title: 'Công viên, điểm xanh', chk: 'chk_c1' },
  { code: '3-MN', label: 'Mầm non', title: 'Trường mầm non', chk: 'chk_c3' },
  { code: '4-TH', label: 'Tiểu học', title: 'Trường tiểu học', chk: 'chk_c4' },
  { code: '5-THCS', label: 'THCS', title: 'Trường THCS', chk: 'chk_c5' },
  { code: '6-THPT', label: 'THPT', title: 'Trường THPT', chk: 'chk_c10' },
  { code: '7-YT', label: 'Y tế', title: 'Bệnh viện, trạm y tế', chk: 'chk_c6' },
  { code: '8-VH', label: 'Văn hóa', title: 'Nhà văn hóa, thể thao', chk: 'chk_c7' },
  { code: '9-TM', label: 'Chợ', title: 'Chợ, trung tâm thương mại', chk: 'chk_c8' }
];

const AREA = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();

let active = '1-CV';
let loaded = false;
let booted = false;

function areaOf(item, qh) {
  const raw = qh ? item.sizeQH : item.sizeHT;
  const n = Number(raw);
  if (raw == null || raw === '' || !Number.isFinite(n) || n <= 0) return null;
  return n;
}

function areaText(n) {
  if (n == null) return '—';
  return `${AREA.format(n)} m²`;
}

function rowsFor(code) {
  const qh = getViewMode() === 'QH';
  const src = qh ? getPlanScenarioList() : (state.rawDataList || []);
  const seen = new Set();
  const out = [];
  src.forEach(item => {
    if (!item || layerType(item) !== code) return;
    const id = String(item.id || '');
    if (id && seen.has(id)) return;
    if (id) seen.add(id);
    out.push(item);
  });
  return { qh, rows: out };
}

function paintTabs() {
  document.querySelectorAll('#xahoiTabs [data-xh-tab]').forEach(el => {
    const on = el.dataset.xhTab === active;
    el.classList.toggle('is-on', on);
    el.querySelector('.xh-tab-btn')?.setAttribute('aria-selected', String(on));
  });
}

export function paintXahoiList() {
  const host = document.getElementById('xahoiList');
  if (!host) return;
  paintTabs();
  const tab = SOCIAL_TABS.find(t => t.code === active) || SOCIAL_TABS[0];
  if (!loaded) {
    host.innerHTML = `<p class="cn-empty">Chưa tải danh sách công trình.</p>`;
    return;
  }
  const { rows } = rowsFor(tab.code);
  const q = fold(document.getElementById('layerSearch')?.value || '');
  const matched = rows.filter(item => !q || fold(`${item.name} ${item.ward}`).includes(q));
  if (!rows.length) {
    host.innerHTML = `<p class="cn-empty">Chưa có công trình ${escapeHtml(tab.title)}.</p>`;
    return;
  }
  if (!matched.length) {
    host.innerHTML = `<p class="cn-empty">Không khớp.</p>`;
    return;
  }
  const groups = new Map();
  matched.forEach(item => {
    const ward = String(item.ward || '').trim() || 'Chưa rõ phường, xã';
    if (!groups.has(ward)) groups.set(ward, []);
    groups.get(ward).push(item);
  });
  const order = new Map(WARD_NAMES.map((name, i) => [fold(name), i]));
  const wards = [...groups.keys()].sort((a, b) => {
    const ia = order.has(fold(a)) ? order.get(fold(a)) : 1000;
    const ib = order.has(fold(b)) ? order.get(fold(b)) : 1000;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b, 'vi');
  });
  const qh = getViewMode() === 'QH';
  const body = wards.map(ward => {
    const items = groups.get(ward).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
    const areas = items.map(item => areaOf(item, qh));
    const complete = areas.every(n => n != null);
    const sum = complete ? areas.reduce((s, n) => s + n, 0) : null;
    const lines = items.map(item => {
      const lat = Number(item.lat);
      const lng = Number(item.lng);
      const ok = Number.isFinite(lat) && Number.isFinite(lng);
      const name = item.name || '—';
      const area = areaOf(item, qh);
      const pending = item.status === false ? '<small class="xh-pending">Chờ duyệt</small>' : '';
      return `<button type="button" class="xh-item" data-xh-code="${escapeHtml(tab.code)}" ${ok ? `data-lat="${lat}" data-lng="${lng}"` : 'disabled'} data-name="${escapeHtml(name)}"><span class="xh-item-name">${escapeHtml(name)}</span>${pending}<span class="xh-area${area == null ? ' is-miss' : ''}">${escapeHtml(areaText(area))}</span></button>`;
    }).join('');
    return `<section class="xh-ward"><div class="xh-ward-head"><span class="xh-ward-name">${escapeHtml(ward)}</span><span class="xh-ward-n">${items.length}</span><span class="xh-ward-sum${sum == null ? ' is-miss' : ''}" title="Tổng diện tích lô trong phường, xã">${escapeHtml(areaText(sum))}</span></div>${lines}</section>`;
  }).join('');
  host.innerHTML = body;
}

function ensureLayer(code) {
  const tab = SOCIAL_TABS.find(t => t.code === code);
  const chk = tab && document.getElementById(tab.chk);
  if (!chk || chk.checked) return;
  chk.checked = true;
  chk.dispatchEvent(new Event('change', { bubbles: true }));
}

export function initXahoiList() {
  if (booted) return;
  booted = true;
  document.getElementById('xahoiTabs')?.addEventListener('click', (e) => {
    if (e.target.closest('.btn-dot-buffer')) return;
    const tab = e.target.closest('[data-xh-tab]');
    if (!tab) return;
    active = tab.dataset.xhTab;
    paintXahoiList();
  });
  document.getElementById('xahoiList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.xh-item');
    if (!btn || btn.disabled) return;
    const lat = Number(btn.dataset.lat);
    const lng = Number(btn.dataset.lng);
    ensureLayer(btn.dataset.xhCode);
    zoomToPoint(lat, lng, btn.dataset.name || '');
  });
  document.addEventListener('infra:ready', () => {
    loaded = true;
    paintXahoiList();
  });
  onViewChange(() => paintXahoiList());
  paintXahoiList();
}
