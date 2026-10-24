// Hỏi đáp số liệu đã tính sẵn (public/data/faq.json, dựng bằng scripts/build-faq.js).
// Bấm câu trả lời thì tô các phường, xã nêu trong câu. Câu ưu tiên đầu tư tô thêm công trình và buffer QCVN.
import { getLeftObstruction, getRightObstruction, highlightWardNames, map } from './mapEngine.js';
import { escapeHtml, showToast, detailDisclosure } from './utils.js';
import { POP_METHOD_EVENT, spatialQuestions } from './popMethod.js';

const $ = (id) => document.getElementById(id);
const vi = (n, d = 0) => Number(n).toLocaleString('vi-VN', { maximumFractionDigits: d, minimumFractionDigits: d });
let pack = null;
let loading = null;
let focusLayer = null;

async function loadFaq() {
  if (pack) return pack;
  if (!loading) {
    loading = fetch('data/faq.json')
      .then(async r => {
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || !Array.isArray(d.questions)) throw new Error('Không tải được bộ hỏi đáp.');
        pack = d;
        return d;
      })
      .catch(err => { loading = null; throw err; });
  }
  return loading;
}

function clearFocus() {
  if (focusLayer) {
    focusLayer.clearLayers();
    if (map) map.removeLayer(focusLayer);
    focusLayer = null;
  }
}

function clearMarks() {
  $('faqList')?.querySelectorAll('.faq-item').forEach(el => el.classList.remove('is-on'));
  $('faqPriorityList')?.querySelectorAll('.faq-item').forEach(el => el.classList.remove('is-on'));
}

function renderPriority(doc) {
  const box = $('faqPriority');
  const select = $('faqWard');
  const priority = doc.priority;
  if (!box || !select || !priority || !priority.wards) return;
  const names = Object.keys(priority.wards).sort((a, b) => a.localeCompare(b, 'vi'));
  select.innerHTML = `<option value="">Chọn phường, xã</option>${names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
  const method = $('faqPriorityMethod');
  if (method) method.innerHTML = priority.method ? detailDisclosure(`<p>${escapeHtml(priority.method)}</p>`) : '';
  const note = $('faqPriorityNote');
  if (note) note.textContent = '';
  const list = $('faqPriorityList');
  if (list) list.innerHTML = '';
  box.hidden = false;
}

function showWardPriority(name) {
  clearFocus();
  clearMarks();
  const ward = pack && pack.priority && pack.priority.wards ? pack.priority.wards[name] : null;
  const note = $('faqPriorityNote');
  const list = $('faqPriorityList');
  if (!ward || !list) return;
  if (note) note.textContent = ward.note || '';
  list.innerHTML = (ward.facilities || []).map((item, i) => {
    const pop = item.popAdded == null
      ? 'Chưa có số liệu dân số để quy đổi'
      : `thêm khoảng ${vi(item.popAdded)} người${item.capacityLimited ? ' (không vượt sức chứa theo chỉ tiêu m²/người)' : ''}`;
    return `<button type="button" class="faq-item" data-priority="${i}">
      <b>${escapeHtml(item.name)}</b>
      <span>${escapeHtml(item.typeLabel)} · thêm ${vi(item.areaHa, 2)} ha (${vi(item.pct, 1)}% diện tích phường) · ${escapeHtml(pop)}</span>
    </button>`;
  }).join('');
  if (name) highlightWardNames([name]);
}

function showFacility(name, item) {
  highlightWardNames([name], { fitView: false });
  clearFocus();
  if (!map || typeof L === 'undefined' || item.lat == null || item.lng == null) return;
  focusLayer = L.layerGroup().addTo(map);
  const circle = L.circle([item.lat, item.lng], {
    radius: Number(item.radius) || 0,
    color: '#fbbf24',
    weight: 2,
    fillColor: '#fbbf24',
    fillOpacity: 0.18
  });
  const marker = L.circleMarker([item.lat, item.lng], {
    radius: 7,
    color: '#fff',
    weight: 2,
    fillColor: '#fbbf24',
    fillOpacity: 1
  });
  marker.bindTooltip(`${item.name} · ${item.typeLabel}`, { sticky: true });
  focusLayer.addLayer(circle);
  focusLayer.addLayer(marker);
  const bounds = circle.getBounds();
  if (bounds && bounds.isValid()) {
    map.fitBounds(bounds, {
      paddingTopLeft: [24 + getLeftObstruction(), 24],
      paddingBottomRight: [24 + getRightObstruction(), 24],
      maxZoom: 16,
      animate: true
    });
  }
}

function shownQuestions(doc) {
  return [...spatialQuestions(), ...(doc.questions || [])];
}

function render(doc) {
  const list = $('faqList');
  const gap = $('faqGap');
  const questions = shownQuestions(doc);
  if (list) {
    list.innerHTML = questions.map((item, i) => `<button type="button" class="faq-item" data-faq="${i}">
      <b>${escapeHtml(item.q)}</b>
      <span>${escapeHtml(item.a)}</span>
      <small>${escapeHtml(item.source || '')}</small>
    </button>`).join('');
  }
  if (gap) {
    gap.innerHTML = (doc.unanswered || []).map(item => `<p><b>${escapeHtml(item.q)}</b> ${escapeHtml(item.why)}</p>`).join('')
      || '<p>Không còn câu nào bị thiếu dữ liệu.</p>';
  }
  renderPriority(doc);
}

export function initFaqPanel() {
  const btn = $('btnFaq');
  const panel = $('faqPanel');
  if (!btn || !panel) return;
  const setOpen = (on) => {
    panel.hidden = !on;
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-expanded', String(on));
    if (!on) clearFocus();
  };
  btn.addEventListener('click', async () => {
    const on = panel.hidden;
    setOpen(on);
    if (!on) return;
    try {
      render(await loadFaq());
    } catch (err) {
      const list = $('faqList');
      if (list) list.innerHTML = `<p class="faq-note">${escapeHtml(err.message || 'Không tải được bộ hỏi đáp.')}</p>`;
    }
  });
  $('faqClose')?.addEventListener('click', () => setOpen(false));
  window.addEventListener(POP_METHOD_EVENT, () => { if (pack && !panel.hidden) render(pack); });
  $('faqWard')?.addEventListener('change', (e) => {
    const name = e.target.value;
    if (!name) {
      clearFocus();
      const note = $('faqPriorityNote');
      const list = $('faqPriorityList');
      if (note) note.textContent = '';
      if (list) list.innerHTML = '';
      return;
    }
    showWardPriority(name);
  });
  $('faqPriorityList')?.addEventListener('click', (e) => {
    const hit = e.target.closest('[data-priority]');
    const name = $('faqWard')?.value;
    const ward = name && pack && pack.priority && pack.priority.wards ? pack.priority.wards[name] : null;
    const item = ward && ward.facilities ? ward.facilities[Number(hit && hit.dataset.priority)] : null;
    if (!hit || !item) return;
    clearMarks();
    hit.classList.add('is-on');
    showFacility(name, item);
  });
  $('faqList')?.addEventListener('click', (e) => {
    const hit = e.target.closest('[data-faq]');
    if (!hit || !pack) return;
    const item = shownQuestions(pack)[Number(hit.dataset.faq)];
    if (!item) return;
    clearFocus();
    clearMarks();
    hit.classList.add('is-on');
    if (!item.wards || !item.wards.length) {
      showToast('Câu trả lời không gắn với một phường, xã cụ thể.', 'error');
      return;
    }
    highlightWardNames(item.wards);
  });
}
