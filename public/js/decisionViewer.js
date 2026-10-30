// Khung xem / gắn quyết định phê duyệt dùng chung cho đồ án (projectLayer.js) và lớp bản đồ (layerDecisions.js).
// Admin: PDF tối đa 10 MB hoặc link đã kiểm tra ghi thẳng (putProjectDecision / putProjectDoc) qua máy chủ.
// Người dùng: PDF tối đa 2 MB gửi chờ duyệt (submitDecisionProposal); admin mở file, đồng ý thì mới thành quyết định.
// target: { key, title, noun, decision, proposal, slug, body: { tenQH } | { layer }, isBusy(), setBusy(on),
//           onSaved(decision | null, data), onProposed(proposal), onResolved(decision | null, data) }
import { state } from './state.js';
import { geeApi } from './api.js';
import { signOutAdmin } from './uiComponents.js';
import { ico, showToast, loadScript, announceFloat, FLOAT_OPEN_EVENT } from './utils.js';
import { PDF_ADMIN_MAX_BYTES, PDF_USER_MAX_BYTES, fileToPdfBase64, pdfSizeError } from './pdfLimits.js';

// PDF.js chỉ tải khi mở khung xem (CDN), không nhúng trình xem PDF của Chrome — toolbar + viền đen hai bên.
const PDFJS_VER = '3.11.174';
const PDFJS_SRC = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.min.js`;
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.worker.min.js`;
let pdfjsReady = null;
let pdfPaintSeq = 0;
let pdfResizeObs = null;
let pdfIo = null;

export const DECISION_MAX_BYTES = PDF_ADMIN_MAX_BYTES;
export const PROPOSE_MAX_BYTES = PDF_USER_MAX_BYTES;
const ASSIGN_HINT = 'PDF tối đa 10 MB: chọn file để xem trước. Link chỉ nhận trang/PDF mở được ngay trong khung (từ chối link phải mở tab mới). Chỉ gán sau khi chấp nhận.';
const PROPOSE_HINT = 'Chọn PDF tối đa 2 MB. Xem trước, rồi bấm «Gửi chờ duyệt». Admin đồng ý thì file mới thành quyết định của đồ án.';

const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;

function isAttachedDoc(t) {
  return !!(t && t.body && t.body.docRole);
}

function kindLabel(t) {
  if (t && t.readOnly) return t.noun || 'Văn bản';
  if (isAttachedDoc(t)) return t.noun || 'Văn bản';
  return 'Quyết định';
}

function viewTitle(t) {
  const name = (t && t.title) || '';
  if (t && t.readOnly) return name || kindLabel(t);
  if (t && t.body && t.body.layer) return name;
  return [kindLabel(t), name].filter(Boolean).join(' · ');
}

function commitLabel(t) {
  return isAttachedDoc(t) ? `Gán ${kindLabel(t)}` : `Gán vào ${t && t.noun || 'đồ án'}`;
}

function paintHeading(el, t) {
  const title = viewTitle(t);
  const head = el.querySelector('[data-decision-title]');
  if (head) head.textContent = title;
  const frame = el.querySelector('iframe');
  if (frame) frame.title = title;
  const pdfHost = el.querySelector('[data-decision-pdf]');
  if (pdfHost) pdfHost.setAttribute('aria-label', title);
  const close = el.querySelector('[data-decision-close]');
  if (close) close.setAttribute('aria-label', `Đóng ${kindLabel(t).toLowerCase()}`);
}

function setDecisionFile(el, text) {
  const label = String(text || '');
  const file = el.querySelector('[data-decision-file]');
  if (file) file.textContent = label;
  const head = el.querySelector('[data-decision-title]');
  if (head) {
    const base = head.textContent || '';
    head.title = label ? `${base} · ${label}` : base;
  }
}

let current = null;
let pickTarget = null;
let fileInput = null;
let pendingReview = null;
let pendingPdf = null;
let pickMode = 'assign';
let proposalBlob = '';

export function decisionUrl(t) {
  const d = t && t.decision;
  if (!d) return '';
  if (d.url && (d.kind === 'link' || d.kind === 'pdf')) return d.url;
  const slug = d.slug || t.slug;
  if (!slug) return '';
  const doc = t.body && t.body.docId ? `&doc=${encodeURIComponent(t.body.docId)}` : '';
  return geeApi(`action=getProjectDecision&slug=${encodeURIComponent(slug)}${doc}&v=${d.at || 0}`);
}

function writeAction(t) {
  return t && t.body && t.body.docRole ? 'putProjectDoc' : 'putProjectDecision';
}

export function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return v ? `${v} B` : '';
  if (v < 1024 * 1024) return `${Math.round(v / 1024)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

const busyOf = (t) => !!(t && t.isBusy && t.isBusy());
const setBusy = (t, on) => { if (t && t.setBusy) t.setBusy(on); };

async function postJson(action, body, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && state.authToken) headers.Authorization = `Bearer ${state.authToken}`;
  const res = await fetch(geeApi(`action=${action}`), {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (auth && (res.status === 401 || res.status === 403)) signOutAdmin();
  if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
  return data;
}

function ensureViewer() {
  let el = document.getElementById('decisionView');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'decisionView';
  el.className = 'decision-view';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'decisionViewTitle');
  el.innerHTML = `<div class="decision-bar">
      <b id="decisionViewTitle" data-decision-title></b>
      <span data-decision-file></span>
      <a data-decision-open href="#" target="_blank" rel="noopener" title="Mở tab mới">Tab</a>
      <span data-decision-admin hidden>
        <button type="button" data-decision-replace>Thay</button>
        <button type="button" data-decision-remove>Gỡ</button>
      </span>
      <button type="button" data-decision-close aria-label="Đóng quyết định">${ico('close')}</button>
    </div>
    <form class="decision-assign" data-decision-assign hidden>
      <input type="url" data-decision-url placeholder="https://… link xem quyết định" aria-label="Link quyết định phê duyệt" autocomplete="off">
      <button type="submit" data-decision-check>Kiểm tra link</button>
      <button type="button" data-decision-filepick>Chọn PDF tối đa 10 MB</button>
      <p data-decision-review>${ASSIGN_HINT}</p>
      <button type="button" data-decision-commit disabled>Gán quyết định</button>
    </form>
    <form class="decision-assign" data-decision-propose hidden>
      <button type="button" data-propose-filepick>Chọn PDF tối đa 2 MB</button>
      <p data-propose-review>${PROPOSE_HINT}</p>
      <button type="button" data-propose-commit disabled>Gửi chờ duyệt</button>
    </form>
    <div class="decision-assign" data-decision-pending hidden>
      <span data-proposal-note></span>
      <button type="button" data-proposal-approve>Đồng ý</button>
      <button type="button" data-proposal-reject>Từ chối</button>
    </div>
    <div class="decision-note" data-decision-note hidden></div>
    <div class="decision-pdf" data-decision-pdf hidden></div>
    <iframe title="Quyết định phê duyệt" hidden></iframe>`;
  document.body.appendChild(el);
  el.querySelector('[data-decision-close]').addEventListener('click', closeDecision);
  el.querySelector('[data-decision-assign]').addEventListener('submit', (e) => {
    e.preventDefault();
    if (current) checkLink(current);
  });
  el.querySelector('[data-decision-url]').addEventListener('input', () => {
    pendingReview = null;
    el.querySelector('[data-decision-commit]').disabled = true;
  });
  el.querySelector('[data-decision-filepick]').addEventListener('click', () => { if (current) pickFile(current); });
  el.querySelector('[data-decision-commit]').addEventListener('click', () => { if (current) commit(current); });
  el.querySelector('[data-propose-filepick]').addEventListener('click', () => { if (current) pickPropose(current); });
  el.querySelector('[data-propose-commit]').addEventListener('click', () => { if (current) submitPropose(current); });
  el.querySelector('[data-proposal-approve]').addEventListener('click', () => { if (current) approveProposal(current); });
  el.querySelector('[data-proposal-reject]').addEventListener('click', () => { if (current) rejectProposal(current); });
  el.querySelector('[data-decision-replace]').addEventListener('click', () => { if (current) openAssign(current); });
  el.querySelector('[data-decision-remove]').addEventListener('click', () => { if (current) remove(current); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.hidden) { e.preventDefault(); closeDecision(); }
  });
  document.addEventListener('auth:change', () => {
    if (current && current.readOnly) el.querySelector('[data-decision-admin]').hidden = true;
    else el.querySelector('[data-decision-admin]').hidden = !isAdmin();
  });
  document.addEventListener(FLOAT_OPEN_EVENT, (e) => {
    if (e.detail !== 'decision' && !el.hidden) closeDecision();
  });
  return el;
}

function showMode(el, mode) {
  el.querySelector('[data-decision-assign]').hidden = mode !== 'assign';
  el.querySelector('[data-decision-propose]').hidden = mode !== 'propose';
  el.querySelector('[data-decision-pending]').hidden = mode !== 'pending';
}

function isPdfSrc(src) {
  const url = String(src || '').trim();
  if (!url) return false;
  if (/^blob:|^data:application\/pdf/i.test(url)) return true;
  if (/\.pdf(\?|#|$)/i.test(url)) return true;
  return /[?&]action=(getProjectDecision|getChoDuyetPdf|getPendingPdf|getDecisionProposal)\b/i.test(url)
    || /^\/gcs\/.+\.pdf(\?|#|$)/i.test(url);
}

function loadPdfJs() {
  if (pdfjsReady) return pdfjsReady;
  pdfjsReady = loadScript(PDFJS_SRC).then(() => {
    const lib = window.pdfjsLib;
    if (!lib) throw new Error('Không khởi tạo được PDF.js');
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return lib;
  }).catch((err) => {
    pdfjsReady = null;
    throw err;
  });
  return pdfjsReady;
}

function clearPdfHost(host) {
  pdfPaintSeq += 1;
  if (pdfResizeObs) {
    pdfResizeObs.disconnect();
    pdfResizeObs = null;
  }
  if (pdfIo) {
    pdfIo.disconnect();
    pdfIo = null;
  }
  if (host) {
    host.querySelectorAll('.decision-pdf-slot').forEach(cancelPdfTask);
    host.innerHTML = '';
    host.hidden = true;
    delete host.dataset.src;
  }
}

function cancelPdfTask(slot) {
  const task = slot && slot._pdfTask;
  if (!task) return;
  slot._pdfTask = null;
  try { task.cancel(); } catch (_) { /* đã xong */ }
}

function blankPdfSlot(slot, width, ratio) {
  if (!slot) return;
  cancelPdfTask(slot);
  const w = Math.max(120, Math.floor(width) || 120);
  const [aw, ah] = String(ratio || '210 / 297').split('/').map((x) => Number(String(x).trim()) || 0);
  const h = aw > 0 && ah > 0 ? Math.max(1, Math.round(w * ah / aw)) : Math.round(w * 297 / 210);
  slot.style.aspectRatio = ratio || '210 / 297';
  slot.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.className = 'decision-pdf-page';
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  slot.appendChild(canvas);
}

async function renderPdfPage(doc, slot, pageNo, width) {
  const gen = Number(slot.dataset.gen || 0) + 1;
  slot.dataset.gen = String(gen);
  cancelPdfTask(slot);
  // Canvas mới mỗi lần — tránh PDF.js chồng render trên cùng context (trang xoay ngược / đen).
  slot.innerHTML = '';
  const page = await doc.getPage(pageNo);
  if (Number(slot.dataset.gen) !== gen) return;
  const base = page.getViewport({ scale: 1 });
  const scale = Math.max(0.5, width / Math.max(1, base.width));
  const viewport = page.getViewport({ scale });
  const w = Math.max(1, Math.floor(viewport.width));
  const h = Math.max(1, Math.floor(viewport.height));
  const ratio = `${base.width} / ${base.height}`;
  slot.style.aspectRatio = ratio;
  const canvas = document.createElement('canvas');
  canvas.className = 'decision-pdf-page';
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  slot.appendChild(canvas);
  const task = page.render({ canvasContext: ctx, viewport, background: '#ffffff' });
  slot._pdfTask = task;
  try {
    await task.promise;
  } catch (err) {
    if (err && (err.name === 'RenderingCancelledException' || /cancel/i.test(String(err.message || '')))) return;
    // Lỗi / nửa chừng: bỏ trắng trang, không để nền đen hay ảnh xoay dở.
    if (Number(slot.dataset.gen) === gen) blankPdfSlot(slot, width, ratio);
    throw err;
  } finally {
    if (slot._pdfTask === task) slot._pdfTask = null;
  }
}

async function paintPdf(host, src) {
  const seq = ++pdfPaintSeq;
  host.hidden = false;
  host.dataset.src = src;
  host.innerHTML = '<p class="decision-pdf-wait">Đang tải PDF…</p>';
  try {
    const pdfjs = await loadPdfJs();
    if (seq !== pdfPaintSeq) return;
    const res = await fetch(src, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`Không tải được PDF (${res.status})`);
    const data = new Uint8Array(await res.arrayBuffer());
    if (seq !== pdfPaintSeq) return;
    const doc = await pdfjs.getDocument({ data }).promise;
    if (seq !== pdfPaintSeq) return;
    host.innerHTML = '';
    const widthOf = () => Math.max(120, Math.floor(host.clientWidth) || 0);
    const slots = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const slot = document.createElement('div');
      slot.className = 'decision-pdf-slot';
      slot.dataset.page = String(n);
      slot.style.aspectRatio = '210 / 297';
      host.appendChild(slot);
      slots.push(slot);
    }

    const paintSlot = (slot) => {
      if (!slot || seq !== pdfPaintSeq || slot.dataset.ready === '1') return;
      slot.dataset.ready = '1';
      renderPdfPage(doc, slot, Number(slot.dataset.page), widthOf()).catch(() => {
        // Giữ trang trắng nếu vẽ lỗi; cho phép thử lại khi cuộn/resize
        slot.dataset.ready = '';
      });
    };
    // Trang 1: trắng trước, rồi vẽ — nếu lỗi vẫn trắng, không khung đen
    blankPdfSlot(slots[0], widthOf(), '210 / 297');
    paintSlot(slots[0]);

    if (pdfIo) pdfIo.disconnect();
    pdfIo = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || seq !== pdfPaintSeq) return;
        paintSlot(entry.target);
      });
    }, { root: host, rootMargin: '240px 0px' });
    slots.forEach((slot) => pdfIo.observe(slot));

    let resizeTimer = 0;
    let resizeReady = false;
    // Chờ trang 1 xong mới bắt resize — tránh vẽ chồng (PDF.js xoay ngược / đen).
    requestAnimationFrame(() => { resizeReady = true; });
    pdfResizeObs = new ResizeObserver(() => {
      if (!resizeReady || seq !== pdfPaintSeq) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (seq !== pdfPaintSeq) return;
        const w = widthOf();
        slots.forEach((slot) => {
          if (slot.dataset.ready !== '1') return;
          renderPdfPage(doc, slot, Number(slot.dataset.page), w).catch(() => {});
        });
      }, 180);
    });
    pdfResizeObs.observe(host);
  } catch (err) {
    if (seq !== pdfPaintSeq) return;
    host.innerHTML = `<p class="decision-pdf-wait">${escapeMsg(err.message || 'Không xem được PDF trong khung.')}</p>`;
  }
}

function escapeMsg(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function showFrame(el, src, note) {
  const frame = el.querySelector('iframe');
  const pdfHost = el.querySelector('[data-decision-pdf]');
  const box = el.querySelector('[data-decision-note]');
  clearPdfHost(pdfHost);
  if (frame) {
    frame.hidden = true;
    frame.removeAttribute('src');
  }
  if (note) {
    box.hidden = false;
    box.textContent = note;
    return;
  }
  box.hidden = true;
  box.textContent = '';
  if (!src) return;
  if (isPdfSrc(src)) {
    paintPdf(pdfHost, src);
    return;
  }
  if (frame) {
    frame.hidden = false;
    frame.src = src;
  }
}

export function openDecision(t) {
  const url = t && decisionUrl(t);
  if (!url) {
    const what = isAttachedDoc(t) ? kindLabel(t).toLowerCase() : 'quyết định phê duyệt';
    alert(`${t && t.noun === 'lớp' ? 'Lớp' : 'Đồ án'} chưa có ${what}.`);
    return;
  }
  const el = ensureViewer();
  current = t;
  pendingReview = null;
  el.hidden = false;
  showMode(el, 'view');
  paintHeading(el, t);
  const d = t.decision;
  const fallback = isAttachedDoc(t) ? kindLabel(t) : 'Quyết định phê duyệt';
  setDecisionFile(el, [d.name || fallback, d.kind === 'link' ? 'link' : 'PDF', fmtBytes(d.bytes)].filter(Boolean).join(' · '));
  el.querySelector('[data-decision-admin]').hidden = !!(t && t.readOnly) || !isAdmin();
  const open = el.querySelector('[data-decision-open]');
  open.hidden = false;
  open.href = url;
  const embed = d.kind !== 'link' || d.embed === true;
  showFrame(el, embed ? url : '', embed ? '' : `Trang này không xem được trong khung. Bấm «Mở tab mới» để đọc ${kindLabel(t).toLowerCase()}.`);
  announceFloat('decision');
}

/** PDF/link nội bộ chỉ xem (quyết định kiến trúc, quy chế…): không nút Thay/Gỡ. */
export function openInlinePdf(url, title = '', name = '') {
  const src = String(url || '').trim();
  if (!src) return;
  const label = String(title || 'Văn bản').trim();
  openDecision({
    title: label,
    noun: 'văn bản',
    readOnly: true,
    decision: {
      kind: /\.pdf(\?|#|$)/i.test(src) || /^blob:|^data:application\/pdf/i.test(src) ? 'pdf' : 'link',
      url: src,
      name: String(name || label).trim(),
      embed: true
    }
  });
}

function revokePdfPreview() {
  if (pendingPdf && pendingPdf.blobUrl) URL.revokeObjectURL(pendingPdf.blobUrl);
  pendingPdf = null;
}

export function openAssign(t) {
  if (!t) return;
  if (!isAdmin()) {
    showToast('Cần đăng nhập quản trị để gắn PDF.', 'error');
    return;
  }
  const el = ensureViewer();
  current = t;
  pendingReview = null;
  revokePdfPreview();
  el.hidden = false;
  showMode(el, 'assign');
  paintHeading(el, t);
  setDecisionFile(el, t.decision ? `Thay ${kindLabel(t).toLowerCase()}` : 'Chưa gán');
  el.querySelector('[data-decision-admin]').hidden = false;
  const assign = el.querySelector('[data-decision-assign]');
  assign.hidden = false;
  assign.querySelector('[data-decision-url]').value = t.decision && t.decision.kind === 'link' ? t.decision.url : '';
  assign.querySelector('[data-decision-review]').textContent = ASSIGN_HINT;
  const btn = assign.querySelector('[data-decision-commit]');
  btn.disabled = true;
  btn.textContent = commitLabel(t);
  el.querySelector('[data-decision-open]').hidden = !t.decision;
  el.querySelector('[data-decision-open]').href = t.decision ? decisionUrl(t) : '#';
  if (t.decision) {
    const url = decisionUrl(t);
    const embed = t.decision.kind !== 'link' || t.decision.embed === true;
    showFrame(el, embed && url ? url : '', embed ? '' : `Đang gắn thay thế. Bấm «Chọn PDF» hoặc dán link phía trên.`);
  } else {
    showFrame(el, '', `Chọn PDF hoặc dán link ở thanh phía trên để gắn «${kindLabel(t)}», rồi bấm «${commitLabel(t)}».`);
    // Tự mở hộp chọn file — tránh chỉ thấy khung trống bên phải.
    requestAnimationFrame(() => {
      if (current === t && !pendingPdf) pickFile(t);
    });
  }
  announceFloat('decision');
}

/** Có quyết định thì mở xem, chưa có thì Admin mở khung gắn. */
export function openOrAssign(t) {
  if (t && t.decision) openDecision(t);
  else openAssign(t);
}

/** Người dùng gửi PDF tối đa 2 MB. Đang có file chờ thì chỉ báo, không gửi thêm. */
export function openPropose(t) {
  if (!t || isAdmin()) return;
  const el = ensureViewer();
  current = t;
  pendingReview = null;
  revokePdfPreview();
  el.hidden = false;
  paintHeading(el, t);
  el.querySelector('[data-decision-admin]').hidden = true;
  el.querySelector('[data-decision-open]').hidden = true;
  el.querySelector('[data-decision-open]').href = '#';
  if (t.proposal) {
    showMode(el, 'view');
    setDecisionFile(el, `Chờ duyệt · ${t.proposal.name}`);
    showFrame(el, '', `File «${t.proposal.name}» đang chờ admin duyệt nên chưa gắn vào đồ án. Gửi file khác sau khi admin đồng ý hoặc từ chối.`);
    announceFloat('decision');
    return;
  }
  showMode(el, 'propose');
  setDecisionFile(el, 'Gửi chờ duyệt');
  const form = el.querySelector('[data-decision-propose]');
  form.querySelector('[data-propose-review]').textContent = PROPOSE_HINT;
  const btn = form.querySelector('[data-propose-commit]');
  btn.disabled = true;
  btn.textContent = 'Gửi chờ duyệt';
  showFrame(el, '', 'Chọn file PDF quyết định phê duyệt, tối đa 2 MB.');
  announceFloat('decision');
}

/** Admin xem file đang chờ, đồng ý thì ghi thành quyết định của đồ án. */
export async function openProposalReview(t) {
  if (!isAdmin() || !t || !t.proposal) return;
  const el = ensureViewer();
  current = t;
  pendingReview = null;
  revokePdfPreview();
  revokeProposalPreview();
  el.hidden = false;
  showMode(el, 'pending');
  paintHeading(el, t);
  setDecisionFile(el, `Chờ duyệt · ${t.proposal.name}`);
  el.querySelector('[data-decision-admin]').hidden = true;
  el.querySelector('[data-proposal-note]').textContent = [t.proposal.name, fmtBytes(t.proposal.bytes)].filter(Boolean).join(' · ');
  el.querySelector('[data-decision-open]').hidden = true;
  el.querySelector('[data-decision-open]').href = '#';
  showFrame(el, '', 'Đang tải file chờ duyệt…');
  announceFloat('decision');
  setBusy(t, true);
  try {
    const res = await fetch(geeApi('action=getDecisionProposal'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
      body: JSON.stringify(t.body)
    });
    if (res.status === 401 || res.status === 403) signOutAdmin();
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
    }
    proposalBlob = URL.createObjectURL(await res.blob());
    if (current !== t) { revokeProposalPreview(); return; }
    const open = el.querySelector('[data-decision-open]');
    open.hidden = false;
    open.href = proposalBlob;
    showFrame(el, proposalBlob, '');
  } catch (err) {
    if (current === t) showFrame(el, '', err.message || 'Không tải được file chờ duyệt.');
  } finally {
    setBusy(t, false);
  }
}

function revokeProposalPreview() {
  if (proposalBlob) URL.revokeObjectURL(proposalBlob);
  proposalBlob = '';
}

export function closeDecision() {
  const el = document.getElementById('decisionView');
  if (!el || el.hidden) return;
  el.hidden = true;
  clearPdfHost(el.querySelector('[data-decision-pdf]'));
  const frame = el.querySelector('iframe');
  if (frame) {
    frame.hidden = true;
    frame.removeAttribute('src');
  }
  current = null;
  revokePdfPreview();
  revokeProposalPreview();
  pendingReview = null;
}

function ensureFileInput() {
  if (fileInput) return fileInput;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,.pdf';
  input.hidden = true;
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    const t = pickTarget;
    const mode = pickMode;
    input.value = '';
    pickTarget = null;
    pickMode = 'assign';
    if (!file || !t) return;
    if (mode === 'propose') previewPropose(t, file);
    else previewFile(t, file);
  });
  document.body.appendChild(input);
  fileInput = input;
  return input;
}

function pickFile(t) {
  if (!isAdmin() || busyOf(t)) return;
  pickMode = 'assign';
  pickTarget = t;
  ensureFileInput().click();
}

function pickPropose(t) {
  if (isAdmin() || busyOf(t) || (t && t.proposal)) return;
  pickMode = 'propose';
  pickTarget = t;
  ensureFileInput().click();
}

async function checkLink(t) {
  if (!isAdmin() || busyOf(t)) return;
  const el = ensureViewer();
  const input = el.querySelector('[data-decision-url]');
  const review = el.querySelector('[data-decision-review]');
  const btn = el.querySelector('[data-decision-commit]');
  const url = String(input.value || '').trim();
  pendingReview = null;
  revokePdfPreview();
  btn.disabled = true;
  if (!url) { review.textContent = 'Chưa có link.'; return; }
  review.textContent = 'Đang mở link…';
  setBusy(t, true);
  try {
    const data = await postJson('reviewProjectDecision', { url });
    if (data.embed !== true) {
      pendingReview = null;
      btn.disabled = true;
      review.textContent = data.note || 'Link không mở được trong khung (phải mở tab mới). Từ chối — hãy tải PDF lên hoặc dùng link xem trực tiếp được.';
      showFrame(el, '', review.textContent);
      return;
    }
    pendingReview = { key: t.key, url: data.url };
    review.textContent = [data.note, data.name, fmtBytes(data.bytes)].filter(Boolean).join(' · ') + `. Bấm «${commitLabel(t)}» nếu đây đúng ${kindLabel(t).toLowerCase()}.`;
    btn.disabled = false;
    const open = el.querySelector('[data-decision-open]');
    open.hidden = false;
    open.href = data.url;
    showFrame(el, data.url, '');
  } catch (err) {
    pendingReview = null;
    btn.disabled = true;
    review.textContent = err.message;
    showFrame(el, '', '');
  } finally {
    setBusy(t, false);
  }
}

function commit(t) {
  if (pendingPdf && pendingPdf.key === t.key) return uploadPdf(t, pendingPdf.file);
  return commitLink(t);
}

function readPdfError(file, maxBytes = DECISION_MAX_BYTES) {
  if (!file) return 'File PDF rỗng.';
  const sizeErr = pdfSizeError(file.size, maxBytes > PDF_USER_MAX_BYTES);
  if (sizeErr) return sizeErr;
  if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return 'Chỉ nhận file PDF.';
  return '';
}

async function readPdfBytes(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 5 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '%PDF') {
    throw new Error('Nội dung không phải file PDF.');
  }
  return bytes;
}

async function previewFile(t, file) {
  if (!isAdmin() || busyOf(t)) return;
  const el = ensureViewer();
  const review = el.querySelector('[data-decision-review]');
  const btn = el.querySelector('[data-decision-commit]');
  pendingReview = null;
  revokePdfPreview();
  btn.disabled = true;
  const bad = readPdfError(file);
  if (bad) { review.textContent = bad; return; }
  let bytes;
  try { bytes = await readPdfBytes(file); }
  catch (e) { review.textContent = e.message || 'Không đọc được file.'; return; }
  const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  pendingPdf = { key: t.key, file, blobUrl };
  review.textContent = `${file.name} · ${fmtBytes(file.size)}. Đã xem trước. Bấm «${commitLabel(t)}» để ghi PDF lên bucket.`;
  btn.disabled = false;
  const open = el.querySelector('[data-decision-open]');
  open.hidden = false;
  open.href = blobUrl;
  showFrame(el, blobUrl, '');
}

async function previewPropose(t, file) {
  if (isAdmin() || busyOf(t) || t.proposal) return;
  const el = ensureViewer();
  const review = el.querySelector('[data-propose-review]');
  const btn = el.querySelector('[data-propose-commit]');
  revokePdfPreview();
  btn.disabled = true;
  const bad = readPdfError(file, PROPOSE_MAX_BYTES);
  if (bad) { review.textContent = bad; return; }
  let bytes;
  try { bytes = await readPdfBytes(file); }
  catch (e) { review.textContent = e.message || 'Không đọc được file.'; return; }
  const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  pendingPdf = { key: t.key, file, blobUrl };
  review.textContent = `${file.name} · ${fmtBytes(file.size)}. Xem trước rồi bấm «Gửi chờ duyệt». File chưa gắn vào đồ án.`;
  btn.disabled = false;
  const open = el.querySelector('[data-decision-open]');
  open.hidden = false;
  open.href = blobUrl;
  showFrame(el, blobUrl, '');
}

async function submitPropose(t) {
  if (isAdmin() || busyOf(t) || !pendingPdf || pendingPdf.key !== t.key || t.proposal) return;
  const file = pendingPdf.file;
  const bad = readPdfError(file, PROPOSE_MAX_BYTES);
  if (bad) { alert(bad); return; }
  let bytes;
  try { bytes = await readPdfBytes(file); }
  catch (e) { alert(e.message || 'Không đọc được file.'); return; }
  setBusy(t, true);
  try {
    const data = await postJson('submitDecisionProposal', { ...t.body, name: file.name, pdf: bytesToBase64(bytes) }, false);
    revokePdfPreview();
    closeDecision();
    if (t.onProposed) t.onProposed(data.proposal);
    showToast('Đã gửi file quyết định, chờ admin duyệt.', 'success');
  } catch (err) {
    alert(`Không gửi được file: ${err.message}`);
  } finally {
    setBusy(t, false);
  }
}

function decisionFrom(data) {
  return {
    slug: data.slug, kind: 'pdf', url: '', name: data.name, bytes: data.bytes, at: data.at, embed: true
  };
}

async function approveProposal(t) {
  if (!isAdmin() || busyOf(t) || !t.proposal) return;
  const replace = t.decision ? `\nQuyết định đang gắn («${t.decision.name}») sẽ được thay bằng file này.` : '';
  if (!confirm(`Đồng ý gắn «${t.proposal.name}» làm quyết định phê duyệt của ${t.noun || 'đồ án'} «${t.title}»?${replace}`)) return;
  setBusy(t, true);
  try {
    const data = await postJson('approveDecisionProposal', t.body);
    closeDecision();
    const next = t.onResolved ? t.onResolved(decisionFrom(data), data) : null;
    if (next) openDecision(next);
    showToast('Đã duyệt quyết định phê duyệt.', 'success');
  } catch (err) {
    alert(`Không duyệt được: ${err.message}`);
  } finally {
    setBusy(t, false);
  }
}

async function rejectProposal(t) {
  if (!isAdmin() || busyOf(t) || !t.proposal) return;
  if (!confirm(`Từ chối file «${t.proposal.name}» của ${t.noun || 'đồ án'} «${t.title}»?`)) return;
  setBusy(t, true);
  try {
    await postJson('rejectDecisionProposal', t.body);
    closeDecision();
    if (t.onResolved) t.onResolved(null, null);
    showToast('Đã từ chối file quyết định.', 'info');
  } catch (err) {
    alert(`Không từ chối được: ${err.message}`);
  } finally {
    setBusy(t, false);
  }
}

function saved(t, decision, data) {
  const next = t.onSaved ? t.onSaved(decision, data) : null;
  if (next) openDecision(next);
}

async function commitLink(t) {
  if (!isAdmin() || busyOf(t) || !pendingReview || pendingReview.key !== t.key) return;
  const el = ensureViewer();
  if (!String(el.querySelector('[data-decision-url]').value || '').trim()) return;
  setBusy(t, true);
  try {
    const data = await postJson(writeAction(t), { ...t.body, url: pendingReview.url });
    pendingReview = null;
    const decision = t.body && t.body.docRole
      ? data.doc
      : { slug: data.slug, kind: 'link', url: data.url, name: data.name, bytes: data.bytes, at: data.at, embed: data.embed === true };
    saved(t, decision, data);
  } catch (err) {
    alert(`Không gán được link: ${err.message}`);
  } finally {
    setBusy(t, false);
  }
}

function bytesToBase64(bytes) {
  let binary = '';
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + size));
  }
  return btoa(binary);
}

async function uploadPdf(t, file) {
  if (!isAdmin() || busyOf(t)) return;
  const bad = readPdfError(file);
  if (bad) { alert(bad); return; }
  setBusy(t, true);
  try {
    const data = await postJson(writeAction(t), {
      ...t.body,
      name: file.name,
      pdf: await fileToPdfBase64(file)
    });
    revokePdfPreview();
    const decision = t.body && t.body.docRole
      ? data.doc
      : { slug: data.slug, kind: 'pdf', url: '', name: data.name, bytes: data.bytes, at: data.at, embed: true };
    saved(t, decision, data);
  } catch (err) {
    alert(`Không ghi được ${kindLabel(t).toLowerCase()}: ${err.message}`);
  } finally {
    setBusy(t, false);
  }
}

async function remove(t) {
  if (!isAdmin() || busyOf(t) || !t.decision) return;
  const what = t.body && t.body.docId ? (t.decision && t.decision.name) || 'văn bản này' : 'quyết định phê duyệt';
  if (!confirm(`Gỡ «${what}» khỏi đồ án «${t.title}»?`)) return;
  setBusy(t, true);
  try {
    const action = t.body && t.body.docId ? 'deleteProjectDoc' : 'deleteProjectDecision';
    const data = await postJson(action, t.body);
    closeDecision();
    if (t.onSaved) t.onSaved(null, data);
  } catch (err) {
    alert(`Không gỡ được ${kindLabel(t).toLowerCase()}: ${err.message}`);
  } finally {
    setBusy(t, false);
  }
}
