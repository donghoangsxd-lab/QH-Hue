// Hỏi đáp số liệu đã tính sẵn (public/data/faq.json, dựng bằng scripts/build-faq.js).
// Bấm câu trả lời thì tô các phường, xã nêu trong câu. Không gọi mô hình ngôn ngữ.
import { highlightWardNames } from './mapEngine.js';
import { escapeHtml, showToast } from './utils.js';

const $ = (id) => document.getElementById(id);
let pack = null;
let loading = null;

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

function render(doc) {
  const list = $('faqList');
  const gap = $('faqGap');
  if (list) {
    list.innerHTML = doc.questions.map((item, i) => `<button type="button" class="faq-item" data-faq="${i}">
      <b>${escapeHtml(item.q)}</b>
      <span>${escapeHtml(item.a)}</span>
      <small>${escapeHtml(item.source || '')}</small>
    </button>`).join('');
  }
  if (gap) {
    gap.innerHTML = (doc.unanswered || []).map(item => `<p><b>${escapeHtml(item.q)}</b> ${escapeHtml(item.why)}</p>`).join('')
      || '<p>Không còn câu nào bị thiếu dữ liệu.</p>';
  }
}

export function initFaqPanel() {
  const btn = $('btnFaq');
  const panel = $('faqPanel');
  if (!btn || !panel) return;
  const setOpen = (on) => {
    panel.hidden = !on;
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-expanded', String(on));
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
  $('faqList')?.addEventListener('click', (e) => {
    const hit = e.target.closest('[data-faq]');
    if (!hit || !pack) return;
    const item = pack.questions[Number(hit.dataset.faq)];
    if (!item) return;
    $('faqList')?.querySelectorAll('.faq-item').forEach(el => el.classList.toggle('is-on', el === hit));
    if (!item.wards || !item.wards.length) {
      showToast('Câu này không gắn với một phường, xã cụ thể.', 'error');
      return;
    }
    highlightWardNames(item.wards);
  });
}
