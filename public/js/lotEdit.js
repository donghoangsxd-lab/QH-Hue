// Admin sửa thông tin 1 lô đồ án ngay trên bảng thông tin (nút bút cạnh nút ẩn / nút đóng):
//   lô hạ tầng → ghi đè dòng Sheet theo ID (Apps Script editInfraRow), lô đất QH → su-dung-dat.json, lô đất HT → hien-trang.json.
import { state } from './state.js';
import { geeApi, markDataWritten } from './api.js';
import { escapeHtml, ico, showToast } from './utils.js';
import { signOutAdmin } from './uiComponents.js';
import { patchCachedLand } from './projectFiles.js';
import { LAND_LABELS, landLabel } from './tt16Symbols.js';

let reloadInfra = null;

/** opts.onInfraSaved: tải lại danh sách công trình sau khi Sheet đã ghi */
export function initLotEdit(opts = {}) {
  reloadInfra = opts.onInfraSaved || null;
}

const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;
const URBAN_RE = /do thi|đô thị|urban/i;
const PLAN_FIELDS = [['floors', 'Tầng cao', 'VD 3 hoặc 2-5'], ['coverage', 'Mật độ XD (%)', 'VD 40'], ['far', 'Hệ số SDĐ (lần)', 'VD 1,2']];

function infraValues(p) {
  return {
    name: p.name || '',
    nhom: URBAN_RE.test(String(p.nhomHaTang || p.capCongTrinh || '')) ? 'Cấp đô thị' : 'Cấp đơn vị ở',
    sizeHT: p.sizeHT == null ? '' : String(p.sizeHT),
    sizeQH: p.sizeQH == null ? '' : String(p.sizeQH),
    note: p.note || '',
    plan: { floors: p.plan?.floors || '', coverage: p.plan?.coverage || '', far: p.plan?.far || '' }
  };
}

function landValues(p) {
  return {
    name: p.name || '',
    nhom: p.nhom || landLabel(p.layer),
    plan: { floors: p.plan?.floors || '', coverage: p.plan?.coverage || '', far: p.plan?.far || '' }
  };
}

const input = (key, label, value, extra = '') => `<label class="lot-edit-row"><span>${label}</span>
  <input type="text" data-k="${key}" value="${escapeHtml(value)}"${extra}></label>`;

function formHtml(target, v) {
  const infra = target.kind === 'INFRA';
  const title = infra
    ? `Sửa công trình ${escapeHtml(target.item.id)} <small>(ghi Sheet)</small>`
    : `Sửa lô ${escapeHtml(target.land.id)} <small>(ghi file đồ án)</small>`;
  let html = `<div class="lot-edit-title">${ico('pen')}${title}</div>`;
  html += input('name', infra ? 'Tên công trình' : 'Tên lô', v.name, ' maxlength="150"');
  if (infra) {
    html += `<label class="lot-edit-row"><span>Cấp công trình</span><select data-k="nhom">
      ${['Cấp đơn vị ở', 'Cấp đô thị'].map(n => `<option${n === v.nhom ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;
    html += input('sizeHT', 'Quy mô HT (m²)', v.sizeHT, ' inputmode="decimal" placeholder="trống = chưa có"');
    html += input('sizeQH', 'Quy mô QH (m²)', v.sizeQH, ' inputmode="decimal" placeholder="trống = không quy hoạch"');
  } else {
    html += input('nhom', 'Loại đất', v.nhom, ' list="lotEditLandTypes" maxlength="40"');
    html += `<datalist id="lotEditLandTypes">${LAND_LABELS.map(l => `<option value="${escapeHtml(l)}">`).join('')}</datalist>`;
  }
  html += PLAN_FIELDS.map(([k, label, ph]) => input(`plan.${k}`, label, v.plan[k], ` maxlength="20" placeholder="${ph}"`)).join('');
  if (infra) {
    html += `<label class="lot-edit-row"><span>Ghi chú</span><textarea data-k="note" rows="2" maxlength="300">${escapeHtml(v.note)}</textarea></label>`;
  }
  html += `<div class="lot-edit-msg"></div>
    <div class="lot-edit-btns"><button type="button" class="proof-btn js-lot-save">${ico('save')}Lưu</button>
    <button type="button" class="proof-btn js-lot-cancel">Hủy</button></div>`;
  return html;
}

// Chỉ gửi trường đã đổi
function changedFields(form, before) {
  const now = {};
  form.querySelectorAll('[data-k]').forEach(el => { now[el.dataset.k] = el.value.trim(); });
  const out = {};
  ['name', 'nhom', 'sizeHT', 'sizeQH', 'note'].forEach(k => {
    if (now[k] !== undefined && now[k] !== String(before[k] ?? '').trim()) out[k] = now[k];
  });
  const plan = {};
  PLAN_FIELDS.forEach(([k]) => {
    const val = now[`plan.${k}`];
    if (val !== undefined && val !== String(before.plan[k] ?? '').trim()) plan[k] = val;
  });
  if (Object.keys(plan).length) out.plan = plan;
  return out;
}

function validate(target, fields) {
  if (fields.name !== undefined && !fields.name) return 'Tên không được để trống';
  if (target.kind !== 'INFRA') return '';
  for (const k of ['sizeHT', 'sizeQH']) {
    const s = fields[k];
    if (s === undefined || s === '') continue;
    const n = Number(s.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return 'Quy mô phải là số ≥ 0 (để trống nếu giai đoạn đó không có công trình)';
  }
  return '';
}

async function postEdit(body) {
  const res = await fetch(geeApi('action=editLot'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    signOutAdmin();
    throw new Error('Phiên Admin hết hạn — đăng nhập lại');
  }
  if (!res.ok || !data.success) throw new Error(data.message || `Lỗi máy chủ (${res.status})`);
  return data;
}

function refit(popup) {
  popup._updateLayout();
  popup._updatePosition();
  popup._adjustPan?.();
}

function openForm(popup, target, onLandSaved) {
  const content = popup.getElement()?.querySelector('.leaflet-popup-content');
  if (!content || content.querySelector('.lot-edit')) return;
  const view = content.firstElementChild;
  const before = target.kind === 'INFRA' ? infraValues(target.item) : landValues(target.land);
  const form = document.createElement('div');
  form.className = 'lot-edit';
  form.innerHTML = formHtml(target, before);
  if (view) view.hidden = true;
  content.appendChild(form);
  L.DomEvent.disableClickPropagation(form);
  L.DomEvent.disableScrollPropagation(form);
  refit(popup);
  form.querySelector('[data-k="name"]')?.focus();

  const msg = form.querySelector('.lot-edit-msg');
  const close = () => {
    form.remove();
    if (view) view.hidden = false;
    refit(popup);
  };
  form.querySelector('.js-lot-cancel').addEventListener('click', close);
  const saveBtn = form.querySelector('.js-lot-save');
  saveBtn.addEventListener('click', async () => {
    const fields = changedFields(form, before);
    if (!Object.keys(fields).length) { close(); return; }
    const problem = validate(target, fields);
    if (problem) { msg.textContent = problem; msg.className = 'lot-edit-msg bad'; return; }
    saveBtn.disabled = true;
    msg.textContent = target.kind === 'INFRA' ? 'Đang ghi Sheet và đồng bộ bucket…' : 'Đang ghi file đồ án…';
    msg.className = 'lot-edit-msg';
    try {
      if (target.kind === 'INFRA') {
        markDataWritten();
        await postEdit({ kind: 'INFRA', id: target.item.id, fields });
        popup.close();
        showToast(`✓ Đã cập nhật ${target.item.id} trên Sheet`, 'success');
        if (reloadInfra) await reloadInfra();
      } else {
        const p = target.land;
        const data = await postEdit({ kind: 'DXF', id: p.id, phase: p.phase, tenQH: p.file, fields });
        patchCachedLand(p.file, data.land, data.saved);
        popup.close();
        showToast(`✓ Đã cập nhật lô ${p.id} trong file đồ án`, 'success');
        if (onLandSaved) onLandSaved();
      }
    } catch (err) {
      saveBtn.disabled = false;
      msg.textContent = err.message;
      msg.className = 'lot-edit-msg bad';
      refit(popup);
    }
  });
}

/**
 * Gắn nút sửa (Admin) vào popup đang mở. target: { kind: 'INFRA', item } | { kind: 'DXF', land };
 * onLandSaved: vẽ lại lô đất sau khi ghi file đồ án
 */
export function addLotEditButton(popup, target, onLandSaved = null) {
  if (!isAdmin()) return;
  if (target.kind === 'INFRA' ? !target.item?.id : !(target.land?.id && target.land.file)) return;
  const container = popup.getElement();
  if (!container) return;
  container.classList.add('pp-editable');
  const btn = L.DomUtil.create('a', 'pp-edit-btn', container);
  btn.href = '#';
  btn.setAttribute('role', 'button');
  btn.innerHTML = ico('pen');
  btn.title = target.kind === 'INFRA' ? 'Sửa thông tin công trình (ghi đè Sheet)' : 'Sửa thông tin lô đất (ghi đè file đồ án trên bucket)';
  btn.setAttribute('aria-label', btn.title);
  L.DomEvent.disableClickPropagation(btn);
  L.DomEvent.on(btn, 'click', (e) => {
    L.DomEvent.stop(e);
    openForm(popup, target, onLandSaved);
  });
}
