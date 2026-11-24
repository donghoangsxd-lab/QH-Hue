/**
 * Admin gán ranh đồ án từ bảng danh mục: bấm polygon trên bản đồ,
 * so sánh trường lệch, ghi links + patches (không rename bucket).
 */
import { showToast } from './utils.js';
import { setLevel } from './mapLevel.js';
import { projectAreaOf } from './projectFiles.js';
import {
  catalogLinkLevelTab,
  diffLinkFields as diffFieldsCore,
  buildLinkPatch as buildPatchCore,
  resolveFieldsHtml,
  readResolveChoices
} from './catalogLinkCore.js';

export {
  catalogLinkLevelTab,
  resolveFieldsHtml,
  readResolveChoices
};

/** @type {{ ma: string, level: string, relink: boolean } | null} */
let pickSession = null;
/** @type {(payload: { ma: string, tenQH: string, project: object|null }) => void} | null */
let onBoundPicked = null;

function areaHaOf(tenQH) {
  const m2 = projectAreaOf(tenQH);
  if (!Number.isFinite(m2) || m2 === Infinity || m2 <= 0) return null;
  return m2 / 10000;
}

export function diffLinkFields(soTayItem, tenQH, project = null) {
  return diffFieldsCore(soTayItem, tenQH, project, { areaHaOf });
}

export function buildLinkPatch(ma, soTayItem, tenQH, project, choices) {
  return buildPatchCore(ma, soTayItem, tenQH, project, choices, { areaHaOf });
}

export function setCatalogLinkPickHandler(fn) {
  onBoundPicked = typeof fn === 'function' ? fn : null;
}

export function isCatalogLinkPickActive() {
  return !!pickSession?.ma;
}

export function cancelCatalogLinkPick() {
  pickSession = null;
  document.body.classList.remove('catalog-link-pick');
}

/**
 * Bật chế độ Admin bấm ranh trên bản đồ để gán / gán lại mã sổ tay.
 * @param {{ ma: string, level?: string, relink?: boolean }} opts
 */
export function startLinkPick(opts = {}) {
  const ma = String(opts.ma || '').trim();
  if (!ma) return false;
  const level = String(opts.level || 'QHPK').toUpperCase();
  const relink = !!opts.relink;
  pickSession = { ma, level, relink };
  document.body.classList.add('catalog-link-pick');
  setLevel(catalogLinkLevelTab(level), { keepView: true });
  showToast(
    relink
      ? `Gán lại «${ma}»: bấm ranh đúng trên bản đồ. Esc để hủy.`
      : `Bấm ranh đồ án trên bản đồ để gán «${ma}». Esc để hủy.`,
    'info'
  );
  return true;
}

/**
 * Hook click outline (projectLayer). Trả true nếu đã tiêu thụ (không mở đồ án).
 * @param {string} tenQH
 * @param {object} [project]
 */
export function consumeCatalogLinkPick(tenQH, project = null) {
  if (!pickSession?.ma) return false;
  const name = String(tenQH || '').trim();
  if (!name) return false;
  const ma = pickSession.ma;
  pickSession = null;
  document.body.classList.remove('catalog-link-pick');
  try {
    onBoundPicked?.({ ma, tenQH: name, project });
  } catch (err) {
    showToast(err?.message || 'Không gán được ranh', 'error');
  }
  return true;
}

/** Esc hủy pick khi đang gán ranh. */
export function initCatalogLinkPickKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!isCatalogLinkPickActive()) return;
    cancelCatalogLinkPick();
    showToast('Đã hủy gán ranh', 'info');
  });
}
