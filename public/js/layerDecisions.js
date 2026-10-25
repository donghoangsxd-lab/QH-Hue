// Quyết định phê duyệt của lớp bản đồ dùng chung (Phân loại đô thị hiện trạng / quy hoạch, QHC 2045).
// QHC 1/25.000 và QHC 1/10.000 dùng chung một quyết định (mã qhc-2045).
// Nút [data-layer-decision="<mã>"] ở dòng lớp (tab Đô thị, đồ án QHC); mã khớp LAYER_DECISIONS (projectStore.js).
// Người dùng xem quyết định đã gắn; Admin gắn / thay / gỡ qua decisionViewer.js.
// data-label: nhãn cố định cạnh biểu tượng; data-label-name: nhãn là tên file / trang quyết định.
// QĐ 614 nằm tại public/docs/614-QD-UBND.pdf. Bản bucket (getLayerDecisions) thắng nếu admin đã gắn cùng mã.
import { state } from './state.js';
import { geeApi } from './api.js';
import { escapeHtml, ico } from './utils.js';
import { openOrAssign } from './decisionViewer.js';

const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;

// kind pdf + url cùng origin: khung xem mở file, không gọi getProjectDecision.
const BUNDLED = {
  'do-thi-hien-trang': {
    slug: 'lop-do-thi-hien-trang',
    kind: 'pdf',
    url: '/docs/614-QD-UBND.pdf',
    name: '614-QD-UBND.pdf',
    bytes: 710578,
    at: 1770656400000,
    embed: true
  }
};
const BUNDLED_TITLE = {
  'do-thi-hien-trang': 'Phân loại đô thị · hiện trạng'
};

let titles = {};
let items = {};
let busyId = null;

function decisionFor(id) {
  return items[id] || BUNDLED[id] || null;
}

function titleFor(id) {
  return titles[id] || BUNDLED_TITLE[id] || '';
}

function target(id) {
  return {
    key: `layer:${id}`,
    title: titleFor(id) || id,
    noun: 'lớp',
    decision: decisionFor(id),
    slug: `lop-${id}`,
    body: { layer: id },
    isBusy: () => !!busyId,
    setBusy: (on) => { busyId = on ? id : null; paintLayerDecisions(); },
    onSaved: (decision) => {
      if (decision) items[id] = decision;
      else delete items[id];
      paintLayerDecisions();
      return decision ? target(id) : null;
    }
  };
}

export function paintLayerDecisions(root = document) {
  const admin = isAdmin();
  root.querySelectorAll('[data-layer-decision]').forEach(btn => {
    const id = btn.dataset.layerDecision;
    const d = decisionFor(id);
    const label = btn.hasAttribute('data-label-name')
      ? (d ? d.name : admin ? 'Gắn quyết định' : 'Chưa gắn quyết định')
      : (btn.dataset.label || '');
    btn.hidden = !btn.hasAttribute('data-keep') && !d && !admin && !label;
    btn.disabled = busyId === id;
    btn.classList.toggle('has-decision', !!d);
    btn.classList.toggle('is-empty', !d && !admin);
    btn.innerHTML = `${ico(d ? 'file' : 'save')}${label ? `<span>${escapeHtml(label)}</span>` : ''}`;
    const name = titleFor(id) ? ` · ${titleFor(id)}` : '';
    btn.title = d
      ? `Xem quyết định phê duyệt${name}: ${d.name}`
      : admin ? `Gắn quyết định phê duyệt${name} (PDF tối đa 10 MB hoặc link)` : `Chưa gắn quyết định phê duyệt${name}`;
    btn.setAttribute('aria-label', d ? 'Xem quyết định phê duyệt' : admin ? 'Gắn quyết định phê duyệt' : 'Chưa gắn quyết định phê duyệt');
  });
}

async function load() {
  try {
    const res = await fetch(geeApi('action=getLayerDecisions'), { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
    titles = data.titles || {};
    items = data.items || {};
  } catch (err) {
    console.warn('Không tải được quyết định phê duyệt của lớp bản đồ:', err.message);
  }
  paintLayerDecisions();
}

export function initLayerDecisions() {
  paintLayerDecisions();
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-layer-decision]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const id = btn.dataset.layerDecision;
    if (btn.disabled || (!decisionFor(id) && !isAdmin())) return;
    openOrAssign(target(id));
  });
  document.addEventListener('auth:change', () => paintLayerDecisions());
  load();
}
