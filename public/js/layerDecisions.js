// Quyết định / văn bản hồ sơ của lớp bản đồ dùng chung (Phân loại đô thị, QHC 2045).
// QHC 1/25.000 và 1/10.000 dùng chung khóa qhc-2045: quyết định phê duyệt + quy định quản lý + thuyết minh (menu 3 lựa chọn).
// Phân loại đô thị vẫn một nút quyết định (data-layer-decision).
// QĐ 614, QĐ 756 và QĐ 108 nằm trên bucket docs/ (phục vụ /gcs/docs/…). Không đưa PDF vào git hay asset Worker.
// Bản admin PDF cùng mã (getLayerDecisions) thắng file docs/; link ngoài (STC/review) không thắng file đã gắn sẵn.
import { state } from './state.js';
import { geeApi } from './api.js';
import { escapeHtml, ico } from './utils.js';
import { openOrAssign, openAssign } from './decisionViewer.js';
import {
  dossierMenuHtml, closeAllDossierMenus, toggleDossierMenu, latestDocOf
} from './dossierAttach.js';

const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;

const BUNDLED = {
  'do-thi-hien-trang': {
    slug: 'lop-do-thi-hien-trang',
    kind: 'pdf',
    url: '/gcs/docs/614-QD-UBND.pdf',
    name: '614-QD-UBND.pdf',
    bytes: 710578,
    at: 1770656400000,
    embed: true
  },
  'do-thi-quy-hoach': {
    slug: 'lop-do-thi-quy-hoach',
    kind: 'pdf',
    url: '/gcs/docs/756-QD-UBND.pdf',
    name: '756-QD-UBND.pdf',
    bytes: 795367,
    at: 1772298000000,
    embed: true
  },
  'qhc-2045': {
    slug: 'lop-qhc-2045',
    kind: 'pdf',
    url: '/gcs/docs/108-QD-TTg.pdf',
    name: '108-QD-TTg.pdf',
    bytes: 3401128,
    at: 1706202000000,
    embed: true
  }
};
const BUNDLED_TITLE = {
  'do-thi-hien-trang': 'Phân loại đô thị · hiện trạng',
  'do-thi-quy-hoach': 'Phân loại đô thị · quy hoạch',
  'qhc-2045': 'QHC đô thị Huế 2045'
};

let titles = {};
let items = {};
let docsByLayer = {};
let busyId = null;

function decisionFor(id) {
  const fromApi = items[id];
  const bundled = BUNDLED[id] || null;
  // Admin tải PDF mới vẫn thắng; link ngoài (không embed) không che file docs/.
  if (fromApi && fromApi.kind === 'pdf') return fromApi;
  if (bundled) return bundled;
  return fromApi || null;
}

function docsFor(id) {
  return docsByLayer[id] || [];
}

function titleFor(id) {
  return titles[id] || BUNDLED_TITLE[id] || '';
}

/** Tra mã lớp tĩnh từ id, slug lop-* hoặc tiêu đề (QHC 2045, QĐ 614/756…). */
export function layerIdOfName(name) {
  const wanted = String(name || '').trim();
  if (!wanted) return '';
  const known = (id) => !!(id && (BUNDLED[id] || BUNDLED_TITLE[id] || titles[id]));
  if (wanted.startsWith('lop-')) {
    const id = wanted.slice(4);
    return known(id) ? id : '';
  }
  if (known(wanted)) return wanted;
  const fromTitle = Object.keys(BUNDLED_TITLE).find(id => BUNDLED_TITLE[id] === wanted)
    || Object.keys(titles).find(id => titles[id] === wanted);
  return fromTitle || '';
}

function decisionTarget(id) {
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
      return decision ? decisionTarget(id) : null;
    }
  };
}

function docTarget(id, doc, role) {
  const labels = { 'quy-dinh': 'Quy định quản lý', 'thuyet-minh': 'Thuyết minh' };
  const label = labels[role] || 'Văn bản';
  const docId = doc && doc.id ? doc.id : '';
  return {
    key: `layer-doc:${id}:${docId || 'new'}:${role}`,
    title: titleFor(id) || id,
    noun: label,
    decision: doc || null,
    slug: `lop-${id}`,
    body: { layer: id, docRole: role, docId },
    isBusy: () => !!busyId,
    setBusy: (on) => { busyId = on ? id : null; paintLayerDecisions(); },
    onSaved: (saved, data) => {
      docsByLayer[id] = Array.isArray(data && data.docs) ? data.docs : [];
      paintLayerDecisions();
      if (!saved) return null;
      const fresh = (docsByLayer[id] || []).find(d => d.id === saved.id) || saved;
      return docTarget(id, fresh, fresh.role || role);
    }
  };
}

/** Mở gắn/xem hồ sơ lớp tĩnh (QHC 2045…): luôn gửi body.layer, không dùng tenQH. */
export function openLayerPick(id, pick) {
  const layer = String(id || '').trim();
  if (!layer) return;
  if (pick === 'phe-duyet') {
    // QĐ 108 gắn sẵn (BUNDLED): mở xem; Admin bấm «Thay» trong khung để gắn bản khác.
    openOrAssign(decisionTarget(layer));
    return;
  }
  if (pick !== 'quy-dinh' && pick !== 'thuyet-minh') return;
  const doc = latestDocOf(docsFor(layer), pick);
  if (doc) openOrAssign(docTarget(layer, doc, pick));
  else openAssign(docTarget(layer, null, pick));
}

/** Quyết định / docs đã gắn lớp (thẻ lô QHC đọc). */
export function layerDecisionOf(id) {
  return decisionFor(id);
}

export function layerDocsOf(id) {
  return docsFor(id).slice();
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
  root.querySelectorAll('[data-dossier-layer-host]').forEach(host => {
    const id = host.dataset.dossierLayerHost;
    host.innerHTML = dossierMenuHtml({
      attrs: `data-dossier-layer="${escapeHtml(id)}"`,
      decision: decisionFor(id),
      docs: docsFor(id),
      admin,
      busy: busyId === id,
      ico
    });
  });
}

async function load() {
  try {
    const res = await fetch(geeApi('action=getLayerDecisions'), { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
    titles = data.titles || {};
    items = data.items || {};
    docsByLayer = data.docs || {};
  } catch (err) {
    console.warn('Không tải được quyết định phê duyệt của lớp bản đồ:', err.message);
  }
  paintLayerDecisions();
}

export function initLayerDecisions() {
  paintLayerDecisions();
  document.addEventListener('click', (e) => {
    // Ưu tiên mục menu (Quy định / Thuyết minh) trước nút mở menu — tránh nuốt click.
    const pick = e.target.closest('[data-dossier-pick]');
    const host = pick && pick.closest('[data-dossier-layer-host]');
    if (pick && host) {
      e.preventDefault();
      e.stopPropagation();
      const wrap = pick.closest('.dossier-menu-wrap');
      const layerBtn = wrap && wrap.querySelector('[data-dossier-layer]');
      const id = (layerBtn && layerBtn.dataset.dossierLayer) || host.dataset.dossierLayerHost || '';
      closeAllDossierMenus();
      if (id) openLayerPick(id, pick.dataset.dossierPick);
      return;
    }
    const layerBtn = e.target.closest('[data-dossier-layer]');
    if (layerBtn) {
      e.preventDefault();
      e.stopPropagation();
      toggleDossierMenu(layerBtn);
      return;
    }
    if (!e.target.closest('.dossier-menu-wrap')) closeAllDossierMenus();
    const btn = e.target.closest('[data-layer-decision]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const id = btn.dataset.layerDecision;
    if (btn.disabled || (!decisionFor(id) && !isAdmin())) return;
    openOrAssign(decisionTarget(id));
  });
  document.addEventListener('auth:change', () => paintLayerDecisions());
  load();
}
