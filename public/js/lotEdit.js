// Admin sửa / xóa 1 lô đồ án ngay trên bảng thông tin (nút sọt rác, nút bút cạnh nút ẩn / nút đóng):
//   lô hạ tầng → ghi đè / xóa dòng Sheet theo ID (Apps Script editInfraRow / deleteInfraRow),
//   lô đất QH → su-dung-dat.json, lô đất HT → hien-trang.json.
// Lô đất còn đổi được lớp (loại đất TT16 → layer mới) và kéo đỉnh ranh (diện tích tính lại theo ranh mới).
// Công trình đổi được loại hạ tầng (VD THCS → Tiểu học): Apps Script chuyển dòng sang tab loại mới với mã mới.
// Lô đất thuộc lớp hạ tầng (công viên, trường, y tế, văn hóa, chợ, bãi đỗ xe, nghĩa trang) chuyển được thành công trình trên Sheet.
import { state, infraLabels } from './state.js';
import { geeApi, markDataWritten } from './api.js';
import { escapeHtml, fmtNum, ico, showToast } from './utils.js';
import { signOutAdmin } from './uiComponents.js';
import { wardNameAt } from './mapEngine.js';
import { patchCachedLand, removeCachedLot, retypeCachedInfra, cachedLots, convertCachedLand } from './projectFiles.js';
import { LAND_LABELS, landLabel, landPatternKey, layerForPattern, TT16_LAND_KEYS, TT16_STYLES } from './tt16Symbols.js';
import { startShapeEdit, vertexCount, SHAPE_MAX_VERTICES } from './lotShapeEdit.js';

let reloadInfra = null;

/** opts.onInfraSaved: tải lại danh sách công trình sau khi Sheet đã ghi */
export function initLotEdit(opts = {}) {
  reloadInfra = opts.onInfraSaved || null;
}

const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;
const URBAN_RE = /do thi|đô thị|urban/i;
const PLAN_FIELDS = [['floors', 'Tầng cao', 'VD 3 hoặc 2-5'], ['coverage', 'Mật độ XD (%)', 'VD 40'], ['far', 'Hệ số SDĐ (lần)', 'VD 1,2']];

// Lớp TT16 → tab hạ tầng trên Sheet khi chuyển lô đất thành công trình (TDTT tính chung nhóm văn hóa – thể thao)
const LAND_INFRA_TYPE = {
  '1-CV': '1-CV', '2-BDX': '2-BDX', '3-MN': '3-MN', '4-TH': '4-TH', '5-THCS': '5-THCS', '6-THPT': '6-THPT',
  '7-YT': '7-YT', '8-VH': '8-VH', TDTT: '8-VH', '9-TM': '9-TM', NTR: '11-NT'
};

// THPT dùng chung loại 4-TH khi tính (constants.codeMap), chỉ tiền tố mã cho biết là THPT
const infraTypeOf = (p) => (String(p.id || '').split('-')[0].toUpperCase() === 'THPT' ? '6-THPT' : p.type || '');

function infraValues(p) {
  return {
    type: infraTypeOf(p),
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

const areaText = (area) => (Number(area) > 0 ? `${fmtNum(Math.round(Number(area)))} m²` : '—');

function formHtml(target, v) {
  const infra = target.kind === 'INFRA';
  const title = infra
    ? `Sửa công trình ${escapeHtml(target.item.id)} <small>(ghi Sheet)</small>`
    : `Sửa lô ${escapeHtml(target.land.id)} <small>(ghi file đồ án)</small>`;
  let html = `<div class="lot-edit-title">${ico('pen')}${title}</div>`;
  html += input('name', infra ? 'Tên công trình' : 'Tên lô', v.name, ' maxlength="150"');
  if (infra) {
    html += `<label class="lot-edit-row"><span>Loại hạ tầng</span><select data-k="type" title="Đổi loại: công trình chuyển sang tab loại mới trên Sheet và nhận mã mới">
      ${Object.entries(infraLabels).map(([code, label]) => `<option value="${code}"${code === v.type ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>`;
    html += `<label class="lot-edit-row"><span>Cấp công trình</span><select data-k="nhom">
      ${['Cấp đơn vị ở', 'Cấp đô thị'].map(n => `<option${n === v.nhom ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;
    html += input('sizeHT', 'Quy mô HT (m²)', v.sizeHT, ' inputmode="decimal" placeholder="trống = chưa có"');
    html += input('sizeQH', 'Quy mô QH (m²)', v.sizeQH, ' inputmode="decimal" placeholder="trống = không quy hoạch"');
  } else {
    const land = target.land;
    const key = landPatternKey(land.layer, land.name);
    const keep = key && TT16_STYLES[key] ? '' : '<option value="" selected>— Giữ layer hiện tại —</option>';
    html += `<label class="lot-edit-row"><span>Lớp (TT16)</span><select data-layer-key title="Layer hiện tại: ${escapeHtml(land.layer || '(trống)')}">${keep}
      ${TT16_LAND_KEYS.map(k => `<option value="${k}"${k === key ? ' selected' : ''}>${escapeHtml(TT16_STYLES[k].label)}</option>`).join('')}</select></label>`;
    html += `<div class="lot-edit-infra" hidden>
      <label class="lot-edit-check"><input type="checkbox" data-to-infra><span>Ghi thành công trình hạ tầng trên Sheet <b class="js-infra-label"></b></span></label>
      <label class="lot-edit-row" hidden><span>Cấp công trình</span><select data-infra-nhom>
        ${['Cấp đơn vị ở', 'Cấp đô thị'].map(n => `<option>${n}</option>`).join('')}</select></label></div>`;
    html += input('nhom', 'Loại đất', v.nhom, ' list="lotEditLandTypes" maxlength="40"');
    html += `<datalist id="lotEditLandTypes">${LAND_LABELS.map(l => `<option value="${escapeHtml(l)}">`).join('')}</datalist>`;
    if (land.geometry) {
      html += `<div class="lot-edit-row"><span>Diện tích</span><div class="lot-edit-shape"><b class="js-lot-area">${areaText(land.area)}</b>
        <button type="button" class="proof-btn js-lot-shape" title="Kéo đỉnh ranh lô trên bản đồ">${ico('pen')}Sửa đỉnh</button></div></div>
        <div class="lot-edit-hint js-lot-shape-hint" hidden>Kéo đỉnh vàng để chỉnh · kéo / bấm chấm trắng giữa cạnh để thêm đỉnh · chuột phải vào đỉnh để xóa. Nền lô cũ vẫn hiện bên dưới để đối chiếu.</div>`;
    }
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
  ['type', 'name', 'nhom', 'sizeHT', 'sizeQH', 'note'].forEach(k => {
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

async function postEdit(body, action = 'editLot') {
  const res = await fetch(geeApi(`action=${action}`), {
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

// Lớp TT16 + kéo đỉnh của lô đất. Trong lúc kéo đỉnh: popup dời lên mép trên lô và không đóng khi bấm bản đồ,
// click vào lô khác bị chặn (state.lotShapeEdit); đóng popup là bỏ phần ranh đang sửa.
function bindLandExtras(popup, form, land, msg) {
  const m = popup._map;
  const select = form.querySelector('[data-layer-key]');
  const nhomInput = form.querySelector('[data-k="nhom"]');
  const startKey = select ? select.value : '';
  const infraBox = form.querySelector('.lot-edit-infra');
  const infraCheck = form.querySelector('[data-to-infra]');
  const infraNhom = form.querySelector('[data-infra-nhom]');
  const infraType = () => LAND_INFRA_TYPE[select ? select.value : ''] || '';
  const syncInfra = () => {
    if (!infraBox) return;
    const type = infraType();
    infraBox.hidden = !type;
    if (!type) infraCheck.checked = false;
    else {
      form.querySelector('.js-infra-label').textContent = `(${infraLabels[type] || type})`;
      infraNhom.value = CITY_LEVEL_TYPES.has(type) || type === '11-NT' || URBAN_RE.test(`${land.name || ''} ${land.nhom || ''}`)
        ? 'Cấp đô thị' : 'Cấp đơn vị ở';
    }
    infraNhom.closest('.lot-edit-row').hidden = !infraCheck.checked;
    refit(popup);
  };
  syncInfra();
  infraCheck?.addEventListener('change', syncInfra);
  select?.addEventListener('change', () => {
    syncInfra();
    if (!select.value || !nhomInput) return;
    nhomInput.value = landLabel(layerForPattern(select.value, land.layer));
  });

  const areaEl = form.querySelector('.js-lot-area');
  const shapeBtn = form.querySelector('.js-lot-shape');
  const hint = form.querySelector('.js-lot-shape-hint');
  const original = land.geometry;
  const originalJson = original ? JSON.stringify(original) : '';
  let session = null;
  let edited = null;
  let kinked = false;
  // Ranh CAD gốc có thể sẵn điểm tự cắt (đỉnh trùng, nét chồng): chỉ chặn khi kéo đỉnh làm phát sinh thêm
  const kinksOf = (geom) => turf.kinks(turf.cleanCoords(turf.feature(geom))).features.length;
  let baseKinks = 0;

  const showArea = (geom) => {
    edited = geom;
    let area = 0;
    try {
      area = turf.area(turf.feature(geom));
      kinked = kinksOf(geom) > baseKinks;
    } catch (e) { kinked = true; }
    const before = Number(land.area) || 0;
    const diff = Math.round(area - before);
    const delta = before && diff ? ` <small>(cũ ${fmtNum(Math.round(before))} m², ${diff > 0 ? '+' : ''}${fmtNum(diff)})</small>` : '';
    areaEl.innerHTML = `${areaText(area)}${delta}`;
    areaEl.classList.toggle('bad', kinked);
    msg.textContent = kinked ? 'Ranh đang tự cắt — kéo lại đỉnh trước khi lưu' : '';
    msg.className = kinked ? 'lot-edit-msg bad' : 'lot-edit-msg';
  };

  const stop = () => {
    if (!session) return;
    const s = session;
    session = null;
    state.lotShapeEdit = false;
    if (popup.isOpen()) m.on('preclick', popup.close, popup);
    s.stop();
  };
  popup.once('remove', stop);

  shapeBtn?.addEventListener('click', () => {
    if (session) {
      session.reset(original);
      return;
    }
    if (!m || typeof turf === 'undefined') return;
    const n = vertexCount(original);
    if (n > SHAPE_MAX_VERTICES) {
      msg.textContent = `Lô có ${fmtNum(n)} đỉnh — quá nhiều để kéo tay (tối đa ${SHAPE_MAX_VERTICES}). Sửa trong CAD rồi nhập lại.`;
      msg.className = 'lot-edit-msg bad';
      refit(popup);
      return;
    }
    try { baseKinks = kinksOf(original); } catch (e) { baseKinks = 0; }
    session = startShapeEdit(m, original, showArea);
    state.lotShapeEdit = true;
    m.off('preclick', popup.close, popup);
    const b = L.geoJSON(original).getBounds();
    if (b.isValid()) popup.setLatLng([b.getNorth(), b.getCenter().lng]);
    shapeBtn.innerHTML = `${ico('close')}Khôi phục ranh gốc`;
    shapeBtn.title = 'Bỏ các đỉnh đã kéo, trở về ranh lúc mở form';
    if (hint) hint.hidden = false;
    refit(popup);
  });

  return {
    stop,
    fields() {
      const out = {};
      if (select && select.value && select.value !== startKey) {
        const layer = layerForPattern(select.value, land.layer);
        if (layer && layer !== land.layer) out.layer = layer;
      }
      if (edited && JSON.stringify(edited) !== originalJson) {
        if (kinked) return { error: 'Ranh đang tự cắt — kéo lại đỉnh trước khi lưu' };
        let at = null;
        try { at = turf.pointOnFeature(turf.feature(edited)).geometry.coordinates; } catch (e) { at = null; }
        if (!at) return { error: 'Ranh lô mới không hợp lệ' };
        out.geometry = edited;
        out.lat = at[1];
        out.lng = at[0];
      }
      const type = infraCheck && infraCheck.checked ? infraType() : '';
      if (!type) return { fields: out };
      let at = null;
      try { at = turf.pointOnFeature(turf.feature(out.geometry || original)).geometry.coordinates; } catch (e) { at = null; }
      if (!at) return { error: 'Không lấy được điểm trong lô để ghi tọa độ công trình' };
      const ward = wardNameAt(at[1], at[0]) || land.ward || '';
      if (!ward) return { error: 'Chưa xác định được phường/xã của lô (ranh phường chưa tải xong hoặc lô ngoài 40 phường/xã)' };
      return {
        fields: out,
        toInfra: { type, code: type.split('-')[1], nhom: infraNhom.value, ward, lat: at[1], lng: at[0] }
      };
    }
  };
}

// THPT là công trình cấp đô thị (QCVN 01:2026), các trường còn lại cấp đơn vị ở: đổi loại thì gợi ý lại cấp
const CITY_LEVEL_TYPES = new Set(['6-THPT']);
const UNIT_LEVEL_TYPES = new Set(['3-MN', '4-TH', '5-THCS']);

function bindTypeSelect(form, before) {
  const type = form.querySelector('[data-k="type"]');
  const nhom = form.querySelector('[data-k="nhom"]');
  const msg = form.querySelector('.lot-edit-msg');
  type?.addEventListener('change', () => {
    if (nhom && CITY_LEVEL_TYPES.has(type.value)) nhom.value = 'Cấp đô thị';
    else if (nhom && UNIT_LEVEL_TYPES.has(type.value)) nhom.value = 'Cấp đơn vị ở';
    msg.textContent = type.value !== before.type ? `Lưu sẽ chuyển công trình sang tab ${type.value} trên Sheet và cấp mã mới` : '';
    msg.className = 'lot-edit-msg';
  });
}

function confirmRetype(item, type) {
  const label = infraLabels[type] || type;
  return confirm(`Đổi ${item.id}${item.name ? ` «${item.name}»` : ''} sang loại «${label}»?\n• Dòng Sheet chuyển sang tab ${type} với mã mới (mã ${item.id} không còn dùng).\n• Ranh lô trong file đồ án đổi theo mã mới.\n• Bán kính phục vụ, độ phủ và heatmap tính theo loại mới.`);
}

function confirmToInfra(land, to) {
  const label = infraLabels[to.type] || to.type;
  const phase = land.phase === 'QH' ? 'QH' : 'HT';
  return confirm(`Chuyển lô ${land.id}${land.name ? ` «${land.name}»` : ''} thành công trình «${label}» (${to.nhom}, ${to.ward})?\n• Ghi dòng mới vào tab ${to.type} trên Google Sheet với mã mới, QuyMo_${phase} = ${areaText(land.area)}.\n• Lô đất trong file đồ án đổi thành ranh lô của công trình đó.\n• Công trình được tính vào độ phủ, chỉ tiêu và heatmap.`);
}

// Sửa lô trước (layer, tên, ranh…) nếu có, rồi chuyển: Sheet cấp mã mới, file đồ án thay lô DXF bằng lô INFRA
async function convertLand(land, fields, to) {
  const phase = land.phase === 'QH' ? 'QH' : 'HT';
  const base = { kind: 'DXF', id: land.id, phase, tenQH: land.file };
  if (Object.keys(fields).length) {
    const data = await postEdit({ ...base, fields });
    patchCachedLand(land.file, data.land, data.saved);
  }
  markDataWritten();
  const { type, ...toInfra } = to;
  const data = await postEdit({ ...base, toInfra });
  convertCachedLand(land.file, { id: land.id, phase }, data.lot, data.saved);
  showToast(`✓ Lô ${land.id} → công trình ${data.newId} (${infraLabels[type] || type}) trên Sheet`, 'success');
  if (reloadInfra) await reloadInfra();
}

async function retypeInfra(item, fields) {
  const label = infraLabels[fields.type] || fields.type;
  const tenQH = item.tenQH || '';
  const lot = tenQH ? cachedLots(tenQH).find(l => l && l.kind === 'INFRA' && String(l.id) === item.id) : null;
  const layer = layerForPattern(fields.type, lot?.layer || '');
  markDataWritten();
  const data = await postEdit({ kind: 'INFRA', id: item.id, tenQH, fields: { ...fields, ...(layer ? { layer } : {}) } });
  if (tenQH && data.lots) retypeCachedInfra(tenQH, { id: item.id, newId: data.newId, layer }, data.saved);
  const lost = data.dropped && data.dropped.length ? ` · tab mới thiếu cột: ${data.dropped.join(', ')}` : '';
  showToast(`✓ Đã đổi ${item.id} → ${data.newId} (${label})${lost}`, lost ? 'info' : 'success');
  if (reloadInfra) await reloadInfra();
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
  const extra = target.kind === 'INFRA' ? null : bindLandExtras(popup, form, target.land, msg);
  if (target.kind === 'INFRA') bindTypeSelect(form, before);
  const close = () => {
    if (extra) extra.stop();
    form.remove();
    if (view) view.hidden = false;
    refit(popup);
  };
  form.querySelector('.js-lot-cancel').addEventListener('click', close);
  const saveBtn = form.querySelector('.js-lot-save');
  saveBtn.addEventListener('click', async () => {
    const fields = changedFields(form, before);
    let toInfra = null;
    if (extra) {
      const more = extra.fields();
      if (more.error) { msg.textContent = more.error; msg.className = 'lot-edit-msg bad'; refit(popup); return; }
      Object.assign(fields, more.fields);
      toInfra = more.toInfra || null;
    }
    if (!Object.keys(fields).length && !toInfra) { close(); return; }
    const problem = validate(target, fields);
    if (problem) { msg.textContent = problem; msg.className = 'lot-edit-msg bad'; return; }
    if (target.kind === 'INFRA' && fields.type && !confirmRetype(target.item, fields.type)) return;
    if (toInfra && !confirmToInfra(target.land, toInfra)) return;
    saveBtn.disabled = true;
    msg.textContent = toInfra ? 'Đang ghi Sheet, cấp mã công trình và đồng bộ bucket…'
      : target.kind !== 'INFRA' ? 'Đang ghi file đồ án…'
        : fields.type ? 'Đang chuyển tab, cấp mã mới và đồng bộ bucket…' : 'Đang ghi Sheet và đồng bộ bucket…';
    msg.className = 'lot-edit-msg';
    try {
      if (toInfra) {
        await convertLand(target.land, fields, toInfra);
        popup.close();
        if (onLandSaved) onLandSaved();
      } else if (target.kind === 'INFRA' && fields.type) {
        await retypeInfra(target.item, fields);
        popup.close();
      } else if (target.kind === 'INFRA') {
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

async function deleteLot(popup, target, onLandSaved, btn) {
  const infra = target.kind === 'INFRA';
  const p = infra ? target.item : target.land;
  const label = `${infra ? 'công trình' : 'lô'} ${p.id}${p.name ? ` «${p.name}»` : ''}`;
  const what = infra
    ? `Xóa ${label}?\n• Xóa dòng trên Google Sheet (kể cả dòng phần vắt ranh phường) và ranh lô trong file đồ án.\n• Không hoàn tác được trên webapp (khôi phục bằng lịch sử phiên bản của Sheet).`
    : `Xóa ${label} (${p.phase === 'QH' ? 'quy hoạch' : 'hiện trạng'}) khỏi file đồ án «${p.file}»?\n• Không hoàn tác được trên webapp.`;
  if (!confirm(what)) return;
  btn.classList.add('busy');
  try {
    if (infra) {
      markDataWritten();
      await postEdit({ kind: 'INFRA', id: p.id, tenQH: p.tenQH || '' }, 'deleteLot');
      if (p.tenQH) removeCachedLot(p.tenQH, { kind: 'INFRA', id: p.id });
      popup.close();
      showToast(`✓ Đã xóa ${p.id} khỏi Sheet`, 'success');
      if (reloadInfra) await reloadInfra();
    } else {
      const phase = p.phase === 'QH' ? 'QH' : 'HT';
      const data = await postEdit({ kind: 'DXF', id: p.id, phase, tenQH: p.file }, 'deleteLot');
      removeCachedLot(p.file, { kind: 'DXF', id: p.id, phase }, data.saved);
      popup.close();
      showToast(`✓ Đã xóa lô ${p.id} khỏi file đồ án`, 'success');
      if (onLandSaved) onLandSaved();
    }
  } catch (err) {
    btn.classList.remove('busy');
    showToast(`Không xóa được: ${err.message}`, 'error');
  }
}

/**
 * Gắn nút xóa + nút sửa (Admin) vào popup đang mở. target: { kind: 'INFRA', item } | { kind: 'DXF', land };
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

  const del = L.DomUtil.create('a', 'pp-del-btn', container);
  del.href = '#';
  del.setAttribute('role', 'button');
  del.innerHTML = ico('trash');
  del.title = target.kind === 'INFRA' ? 'Xóa công trình (xóa dòng Sheet và ranh lô)' : 'Xóa lô đất khỏi file đồ án';
  del.setAttribute('aria-label', del.title);
  L.DomEvent.disableClickPropagation(del);
  L.DomEvent.on(del, 'click', (e) => {
    L.DomEvent.stop(e);
    if (!del.classList.contains('busy')) deleteLot(popup, target, onLandSaved, del);
  });
}
