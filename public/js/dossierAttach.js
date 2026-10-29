// Menu gắn / xem hồ sơ PDF dùng chung: quyết định phê duyệt, quy định quản lý, thuyết minh.
// Đồ án nhập (projectLayer) và lớp tĩnh QHC 2045 (layerDecisions) cùng UI này.
import { escapeHtml } from './utils.js';

export const DOSSIER_ATTACH = [
  { id: 'phe-duyet', label: 'Quyết định phê duyệt', kind: 'decision' },
  { id: 'quy-dinh', label: 'Quy định quản lý', kind: 'doc' },
  { id: 'thuyet-minh', label: 'Thuyết minh', kind: 'doc' }
];

export function latestDocOf(docs, role) {
  return (docs || []).filter(d => d && d.role === role && d.id).sort((a, b) => (b.at || 0) - (a.at || 0))[0] || null;
}

export function dossierAttachState({ decision, docs } = {}) {
  const list = Array.isArray(docs) ? docs : [];
  const by = {
    'phe-duyet': decision || null,
    'quy-dinh': latestDocOf(list, 'quy-dinh'),
    'thuyet-minh': latestDocOf(list, 'thuyet-minh')
  };
  const any = !!(by['phe-duyet'] || by['quy-dinh'] || by['thuyet-minh']);
  return { by, any };
}

/** Nút mở menu + panel 3 lựa chọn. attrs: chuỗi thuộc tính trên nút; ico: hàm icon SVG. */
export function dossierMenuHtml({ attrs, decision, docs, admin, busy, ico }) {
  const { by, any } = dossierAttachState({ decision, docs });
  if (!any && !admin) return '';
  const tip = any
    ? 'Xem hoặc gắn hồ sơ PDF: quyết định phê duyệt, quy định quản lý, thuyết minh'
    : 'Gắn hồ sơ PDF: quyết định phê duyệt, quy định quản lý, thuyết minh';
  const icon = typeof ico === 'function' ? ico(any ? 'file' : 'save') : '';
  const items = DOSSIER_ATTACH.map(opt => {
    const hit = by[opt.id];
    const status = hit ? (hit.name || 'đã gắn') : 'chưa gắn';
    const can = !!hit || admin;
    return `<button type="button" class="dossier-menu-item${hit ? ' has-file' : ''}" data-dossier-pick="${opt.id}"${can ? '' : ' disabled'} title="${escapeHtml(hit ? `Xem: ${status}` : admin ? `Gắn ${opt.label}` : 'Chưa gắn')}">
      <span class="dossier-menu-label">${escapeHtml(opt.label)}</span>
      <span class="dossier-menu-status">${escapeHtml(status)}</span>
    </button>`;
  }).join('');
  return `<span class="dossier-menu-wrap">
    <button type="button" class="project-btn${any ? ' has-decision' : ''}" ${attrs} title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}" aria-haspopup="menu" aria-expanded="false"${busy ? ' disabled' : ''}>${icon}</button>
    <div class="dossier-menu" role="menu" hidden>${items}</div>
  </span>`;
}

export function closeAllDossierMenus(root = document) {
  root.querySelectorAll('.dossier-menu-wrap.is-open').forEach(wrap => {
    wrap.classList.remove('is-open');
    const menu = wrap.querySelector('.dossier-menu');
    const btn = wrap.querySelector('[data-dossier-menu], [data-dossier-layer]');
    if (menu) menu.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
}

export function toggleDossierMenu(btn) {
  const wrap = btn && btn.closest('.dossier-menu-wrap');
  if (!wrap) return false;
  const menu = wrap.querySelector('.dossier-menu');
  if (!menu) return false;
  const open = wrap.classList.contains('is-open');
  closeAllDossierMenus();
  if (open) return true;
  wrap.classList.add('is-open');
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  return true;
}
