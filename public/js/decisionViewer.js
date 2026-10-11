// Khung xem / gắn quyết định phê duyệt dùng chung cho đồ án (projectLayer.js) và lớp bản đồ (layerDecisions.js).
// PDF dưới 1 MB ghi lên bucket qua putProjectDecision; link ngoài chỉ gán sau khi máy chủ mở được (reviewProjectDecision).
// target: { key, title, noun, decision, slug, body: { tenQH } | { layer }, isBusy(), setBusy(on),
//           onSaved(decision | null, data) → target sau cập nhật (null: không mở lại) }
import { state } from './state.js';
import { geeApi } from './api.js';
import { signOutAdmin } from './uiComponents.js';
import { ico } from './utils.js';

export const DECISION_MAX_BYTES = 1024 * 1024;
const ASSIGN_HINT = 'PDF dưới 1 MB: chọn file để xem trước. Link: bấm Kiểm tra để webapp mở trang. Chỉ gán sau khi chấp nhận.';

const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;

let current = null;
let pickTarget = null;
let fileInput = null;
let pendingReview = null;
let pendingPdf = null;

export function decisionUrl(t) {
  const d = t && t.decision;
  if (!d) return '';
  if (d.kind === 'link' && d.url) return d.url;
  const slug = d.slug || t.slug;
  if (!slug) return '';
  return geeApi(`action=getProjectDecision&slug=${encodeURIComponent(slug)}&v=${d.at || 0}`);
}

export function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return v ? `${v} B` : '';
  if (v < 1024 * 1024) return `${Math.round(v / 1024)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

const busyOf = (t) => !!(t && t.isBusy && t.isBusy());
const setBusy = (t, on) => { if (t && t.setBusy) t.setBusy(on); };

async function postJson(action, body) {
  const res = await fetch(geeApi(`action=${action}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) signOutAdmin();
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
      <a data-decision-open href="#" target="_blank" rel="noopener">Mở tab mới</a>
      <span data-decision-admin hidden>
        <button type="button" data-decision-replace>Thay</button>
        <button type="button" data-decision-remove>Gỡ</button>
      </span>
      <button type="button" data-decision-close aria-label="Đóng quyết định">${ico('close')}</button>
    </div>
    <form class="decision-assign" data-decision-assign hidden>
      <input type="url" data-decision-url placeholder="https://… link xem quyết định" aria-label="Link quyết định phê duyệt" autocomplete="off">
      <button type="submit" data-decision-check>Kiểm tra link</button>
      <button type="button" data-decision-filepick>Chọn PDF ≤ 1 MB</button>
      <p data-decision-review>${ASSIGN_HINT}</p>
      <button type="button" data-decision-commit disabled>Gán quyết định</button>
    </form>
    <div class="decision-note" data-decision-note hidden></div>
    <iframe title="Quyết định phê duyệt"></iframe>`;
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
  el.querySelector('[data-decision-replace]').addEventListener('click', () => { if (current) openAssign(current); });
  el.querySelector('[data-decision-remove]').addEventListener('click', () => { if (current) remove(current); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.hidden) { e.preventDefault(); closeDecision(); }
  });
  document.addEventListener('auth:change', () => {
    el.querySelector('[data-decision-admin]').hidden = !isAdmin();
  });
  return el;
}

function showFrame(el, src, note) {
  const frame = el.querySelector('iframe');
  const box = el.querySelector('[data-decision-note]');
  if (note) {
    frame.hidden = true;
    frame.removeAttribute('src');
    box.hidden = false;
    box.textContent = note;
    return;
  }
  box.hidden = true;
  box.textContent = '';
  frame.hidden = false;
  if (src) frame.src = src;
  else frame.removeAttribute('src');
}

export function openDecision(t) {
  const url = t && decisionUrl(t);
  if (!url) { alert(`${t && t.noun === 'lớp' ? 'Lớp' : 'Đồ án'} chưa có quyết định phê duyệt.`); return; }
  const el = ensureViewer();
  current = t;
  pendingReview = null;
  el.hidden = false;
  el.querySelector('[data-decision-assign]').hidden = true;
  el.querySelector('[data-decision-title]').textContent = t.title;
  const d = t.decision;
  el.querySelector('[data-decision-file]').textContent = [d.name || 'Quyết định phê duyệt', d.kind === 'link' ? 'link' : 'PDF', fmtBytes(d.bytes)].filter(Boolean).join(' · ');
  el.querySelector('[data-decision-admin]').hidden = !isAdmin();
  el.querySelector('[data-decision-open]').href = url;
  const embed = d.kind !== 'link' || d.embed === true;
  showFrame(el, embed ? url : '', embed ? '' : 'Trang này không xem được trong khung. Bấm «Mở tab mới» để đọc quyết định.');
}

function revokePdfPreview() {
  if (pendingPdf && pendingPdf.blobUrl) URL.revokeObjectURL(pendingPdf.blobUrl);
  pendingPdf = null;
}

export function openAssign(t) {
  if (!isAdmin() || !t) return;
  const el = ensureViewer();
  current = t;
  pendingReview = null;
  revokePdfPreview();
  el.hidden = false;
  el.querySelector('[data-decision-title]').textContent = t.title;
  el.querySelector('[data-decision-file]').textContent = t.decision ? 'Thay quyết định' : 'Chưa gán';
  el.querySelector('[data-decision-admin]').hidden = false;
  const assign = el.querySelector('[data-decision-assign]');
  assign.hidden = false;
  assign.querySelector('[data-decision-url]').value = t.decision && t.decision.kind === 'link' ? t.decision.url : '';
  assign.querySelector('[data-decision-review]').textContent = ASSIGN_HINT;
  const btn = assign.querySelector('[data-decision-commit]');
  btn.disabled = true;
  btn.textContent = `Gán vào ${t.noun || 'đồ án'}`;
  el.querySelector('[data-decision-open]').href = t.decision ? decisionUrl(t) : '#';
  if (!t.decision) showFrame(el, '', '');
}

/** Có quyết định thì mở xem, chưa có thì Admin mở khung gắn. */
export function openOrAssign(t) {
  if (t && t.decision) openDecision(t);
  else openAssign(t);
}

export function closeDecision() {
  const el = document.getElementById('decisionView');
  if (!el || el.hidden) return;
  el.hidden = true;
  const frame = el.querySelector('iframe');
  if (frame) frame.removeAttribute('src');
  current = null;
  revokePdfPreview();
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
    input.value = '';
    pickTarget = null;
    if (file && t) previewFile(t, file);
  });
  document.body.appendChild(input);
  fileInput = input;
  return input;
}

function pickFile(t) {
  if (!isAdmin() || busyOf(t)) return;
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
    pendingReview = { key: t.key, url: data.url };
    review.textContent = [data.note, data.name, fmtBytes(data.bytes)].filter(Boolean).join(' · ') + `. Bấm «Gán vào ${t.noun || 'đồ án'}» nếu đây đúng quyết định.`;
    btn.disabled = false;
    el.querySelector('[data-decision-open]').href = data.url;
    showFrame(el, data.embed ? data.url : '', data.embed ? '' : 'Đã mở được link, nhưng trang không cho nhúng. Bấm «Mở tab mới» để xem trước khi gán.');
  } catch (err) {
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

function readPdfError(file) {
  if (!file || file.size > DECISION_MAX_BYTES) return 'File quyết định phải là PDF nhỏ hơn 1 MB.';
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
  review.textContent = `${file.name} · ${fmtBytes(file.size)}. Đã xem trước. Bấm «Gán vào ${t.noun || 'đồ án'}» để ghi PDF lên bucket.`;
  btn.disabled = false;
  el.querySelector('[data-decision-open]').href = blobUrl;
  showFrame(el, blobUrl, '');
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
    const data = await postJson('putProjectDecision', { ...t.body, url: pendingReview.url });
    pendingReview = null;
    saved(t, { slug: data.slug, kind: 'link', url: data.url, name: data.name, bytes: data.bytes, at: data.at, embed: data.embed === true }, data);
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
  let bytes;
  try { bytes = await readPdfBytes(file); }
  catch (e) { alert(e.message || 'Không đọc được file.'); return; }
  setBusy(t, true);
  try {
    const data = await postJson('putProjectDecision', { ...t.body, name: file.name, pdf: bytesToBase64(bytes) });
    revokePdfPreview();
    saved(t, { slug: data.slug, kind: 'pdf', url: '', name: data.name, bytes: data.bytes, at: data.at, embed: true }, data);
  } catch (err) {
    alert(`Không ghi được quyết định: ${err.message}`);
  } finally {
    setBusy(t, false);
  }
}

async function remove(t) {
  if (!isAdmin() || busyOf(t) || !t.decision) return;
  if (!confirm(`Gỡ file quyết định phê duyệt của ${t.noun || 'đồ án'} «${t.title}»?`)) return;
  setBusy(t, true);
  try {
    await postJson('deleteProjectDecision', t.body);
    closeDecision();
    if (t.onSaved) t.onSaved(null, null);
  } catch (err) {
    alert(`Không gỡ được quyết định: ${err.message}`);
  } finally {
    setBusy(t, false);
  }
}
