// Admin gán hạ tầng hiện trạng cho một thửa địa chính 2016.
// Danh mục khớp constants.PARCEL_INFRA_TYPES / tab HaTangHienTrang.
// Thửa đã gán tô theo màu loại công trình; điểm đồng bộ sang lớp hạ tầng để tính độ phủ.
import { state, bumpDataVersion, BUFFER_COLORS } from './state.js';
import { map, renderGroupedPoints } from './mapEngine.js';
import { planMap } from './planMap.js';
import { geeApi, infraListUrl, markDataWritten } from './api.js';
import { escapeHtml, showToast } from './utils.js';
import { reloadWardStats } from './uiComponents.js';

const PANE = 'htParcelPane';
const PANE_Z = 430;
const TYPES = [
  { code: '1-CV', label: 'Công viên, điểm xanh', unit: 'chỗ', cap: 'auto' },
  { code: '2-BDX', label: 'Bãi đỗ xe, trạm sạc', unit: 'chỗ xe', cap: 'choose' },
  { code: '3-MN', label: 'Trường Mầm non', unit: 'học sinh', cap: 'unit' },
  { code: '4-TH', label: 'Trường Tiểu học', unit: 'học sinh', cap: 'unit' },
  { code: '5-THCS', label: 'Trường THCS', unit: 'học sinh', cap: 'unit' },
  { code: '6-THPT', label: 'Trường THPT', unit: 'học sinh', cap: 'urban' },
  { code: '7-YT', label: 'Bệnh viện, trạm y tế', unit: 'giường', cap: 'choose' },
  { code: '8-VH', label: 'Nhà văn hóa, thể thao', unit: 'chỗ', cap: 'choose' },
  { code: '9-TM', label: 'Chợ, trung tâm thương mại', unit: 'điểm', cap: 'choose' },
  { code: '10-PCCC', label: 'Trụ sở cảnh sát PCCC', unit: 'xe', cap: 'urban', noArea: true },
  { code: '11-NT', label: 'Nhà tang lễ, nghĩa trang', unit: 'ngôi', cap: 'unit' },
  { code: '12-CSD', label: 'Cơ sở chưa sử dụng', unit: '', cap: 'unit' },
  { code: '13-BUS', label: 'Trạm dừng xe buýt', unit: 'điểm', cap: 'urban', noArea: true },
  { code: '14-NOXH', label: 'Chung cư', unit: 'căn', cap: 'unit' }
];
const STATUSES = [
  { id: 'hoatdong', label: 'Đang hoạt động' },
  { id: 'xuongcap', label: 'Xuống cấp' },
  { id: 'ngung', label: 'Ngừng hoạt động' }
];
const typeOf = (code) => TYPES.find(t => t.code === code);
const statusOf = (id) => STATUSES.find(s => s.id === id);

const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;

function htNorm(v) {
  const s = String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
}

function sameParcel(a, b) {
  return htNorm(a.soTo) === htNorm(b.soTo) && htNorm(a.soThua) === htNorm(b.soThua) && htNorm(a.xaPhuong) === htNorm(b.xaPhuong);
}

let rows = [];
let leftLayer = null;
let rightLayer = null;
let loaded = false;
let loadTask = null;

function ensurePane(m) {
  if (!m || m.getPane(PANE)) return;
  const pane = m.createPane(PANE);
  pane.style.zIndex = String(PANE_Z);
  pane.style.pointerEvents = 'none';
}

function drawHighlights() {
  [leftLayer, rightLayer].forEach(g => g?.remove());
  leftLayer = rightLayer = null;
  const draw = (m) => {
    if (!m) return null;
    ensurePane(m);
    const group = L.layerGroup();
    rows.forEach(rec => {
      if (!rec.geometry) return;
      const color = BUFFER_COLORS[rec.loai] || '#38bdf8';
      L.geoJSON(rec.geometry, {
        pane: PANE,
        interactive: false,
        style: { color, weight: 2, fillColor: color, fillOpacity: rec.tinhTrang === 'ngung' ? 0.08 : 0.28 }
      }).addTo(group);
    });
    return group.addTo(m);
  };
  leftLayer = draw(map);
  rightLayer = draw(planMap);
}

function loadRows() {
  if (loaded || loadTask) return loadTask;
  loadTask = (async () => {
    try {
      const res = await fetch(geeApi('action=getParcelInfra'), { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      if (!Array.isArray(data.rows)) return;
      rows = data.rows;
      loaded = true;
      drawHighlights();
      document.querySelectorAll('.ht-assign').forEach(paintHost);
    } catch (err) {
      console.warn('Chưa tải được hạ tầng hiện trạng trên thửa:', err);
    }
  })();
  return loadTask;
}

function findRec(ctx) {
  return rows.find(r => sameParcel(r, { soTo: ctx.soTo, soThua: ctx.soThua, xaPhuong: ctx.xa }));
}

function slimGeom(geometry) {
  let g = geometry && geometry.type === 'Feature' ? geometry.geometry : geometry;
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return null;
  const shrink = (tol) => {
    try {
      const f = turf.simplify({ type: 'Feature', properties: {}, geometry: g }, { tolerance: tol, highQuality: false });
      return f.geometry || f;
    } catch (e) {
      return g;
    }
  };
  g = shrink(0.00003);
  if (JSON.stringify(g).length > 40000) g = shrink(0.00012);
  return JSON.stringify(g).length > 45000 ? null : g;
}

function centroidOf(geometry, fallback) {
  try {
    const c = turf.centroid({ type: 'Feature', properties: {}, geometry });
    const [lng, lat] = c.geometry.coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  } catch (e) { /* dùng điểm bấm */ }
  return fallback;
}

function badgeHtml(rec) {
  if (!rec) return '';
  const type = typeOf(rec.loai);
  const st = statusOf(rec.tinhTrang);
  return `<div class="ht-badge">Đã gán hạ tầng hiện trạng: ${escapeHtml(type ? type.label : rec.loai)}${st ? ` · ${escapeHtml(st.label)}` : ''}</div>`;
}

function formHtml(ctx, rec) {
  const type = typeOf(rec?.loai) || TYPES[2];
  const opts = TYPES.map(t => `<option value="${t.code}"${t.code === (rec?.loai || type.code) ? ' selected' : ''}>${escapeHtml(t.label)}</option>`).join('');
  const stOpts = STATUSES.map(s => `<option value="${s.id}"${s.id === (rec?.tinhTrang || 'hoatdong') ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('');
  const cap = rec?.nhom && /đô thị/i.test(rec.nhom) ? 'urban' : 'unit';
  const area = rec?.dienTich > 0 ? rec.dienTich : (ctx.dienTich > 0 ? ctx.dienTich : '');
  return `<form class="ht-form" novalidate>
    <label>Loại công trình<select name="loai">${opts}</select></label>
    <label class="ht-cap">Cấp hạ tầng<select name="cap">
      <option value="unit"${cap === 'unit' ? ' selected' : ''}>Cấp đơn vị ở</option>
      <option value="urban"${cap === 'urban' ? ' selected' : ''}>Cấp đô thị</option>
    </select></label>
    <p class="ht-cap-note pp-sub"></p>
    <label>Tên công trình<input name="ten" maxlength="150" required value="${escapeHtml(rec?.ten || '')}" placeholder="Tên cơ sở"></label>
    <div class="ht-row">
      <label class="ht-quymo">Quy mô <span class="ht-unit"></span><input name="quyMo" inputmode="decimal" value="${rec?.quyMo ?? ''}"></label>
      <label>Diện tích (m²)<input name="dienTich" inputmode="decimal" value="${area}"></label>
    </div>
    <label>Tình trạng<select name="tinhTrang">${stOpts}</select></label>
    <label>Ghi chú<textarea name="ghiChu" maxlength="300" rows="2">${escapeHtml(rec?.ghiChuNguoi || '')}</textarea></label>
    <p class="ht-msg" role="status"></p>
    <div class="ht-actions">
      <button type="submit" class="proof-btn">${rec ? 'Cập nhật' : 'Lưu vào Sheet'}</button>
      ${rec ? '<button type="button" class="proof-btn ht-del">Xóa gán</button>' : ''}
      <button type="button" class="proof-btn ht-back">Đóng</button>
    </div>
  </form>`;
}

function syncCapFields(form) {
  const type = typeOf(form.loai.value);
  const cap = form.querySelector('.ht-cap');
  const note = form.querySelector('.ht-cap-note');
  const unit = form.querySelector('.ht-unit');
  const quy = form.querySelector('.ht-quymo');
  if (!type) return;
  cap.hidden = type.cap !== 'choose';
  if (type.cap === 'auto') note.textContent = 'Công viên từ 10.000 m² tính cấp đô thị, nhỏ hơn tính vườn hoa đơn vị ở.';
  else if (type.cap === 'urban') note.textContent = 'Loại này thuộc cấp đô thị.';
  else if (type.cap === 'unit') note.textContent = 'Loại này thuộc cấp đơn vị ở.';
  else note.textContent = '';
  if (unit) unit.textContent = type.unit ? `(${type.unit})` : '';
  if (quy) quy.hidden = !type.unit;
}

function readForm(form) {
  const type = typeOf(form.loai.value);
  const quyRaw = String(form.quyMo.value || '').trim().replace(',', '.');
  const areaRaw = String(form.dienTich.value || '').trim().replace(',', '.');
  const quyMo = quyRaw === '' ? NaN : Number(quyRaw);
  const dienTich = areaRaw === '' ? NaN : Number(areaRaw);
  const ten = form.ten.value.trim();
  if (!type) return { error: 'Chọn loại công trình' };
  if (ten.length < 2) return { error: 'Tên công trình cần ít nhất 2 ký tự' };
  if (type.unit && (!Number.isFinite(quyMo) || quyMo < 0)) return { error: `Nhập quy mô (${type.unit})` };
  if (!Number.isFinite(dienTich) || dienTich < 0) return { error: 'Diện tích không hợp lệ' };
  if (!(dienTich > 0) && !type.noArea) return { error: 'Diện tích phải lớn hơn 0' };
  return {
    loai: type.code,
    cap: type.cap === 'choose' ? form.cap.value : type.cap,
    ten,
    quyMo: type.unit ? quyMo : 0,
    dienTich,
    tinhTrang: form.tinhTrang.value,
    ghiChu: form.ghiChu.value.trim()
  };
}

async function reloadPoints(expectId) {
  markDataWritten();
  const res = await fetch(infraListUrl());
  if (!res.ok) throw new Error('Đã lưu Sheet nhưng chưa tải lại được danh sách công trình');
  const data = await res.json();
  state.rawDataList = data.rawDataList || [];
  state.planDataList = data.planDataList || [];
  bumpDataVersion();
  const found = !expectId || state.rawDataList.some(it => it.id === expectId);
  renderGroupedPoints();
  if (state.wardStatsData?.length) {
    try { await reloadWardStats(); } catch (err) { console.warn(err); }
  }
  return found;
}

async function post(action, payload) {
  const res = await fetch(geeApi(`action=${action}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error || data.success === false) {
    throw new Error(data.message || `Không ghi được (${res.status})`);
  }
  return data;
}

function openForm(host) {
  const ctx = host._htCtx;
  const rec = findRec(ctx);
  host.innerHTML = badgeHtml(rec) + formHtml(ctx, rec);
  const form = host.querySelector('.ht-form');
  syncCapFields(form);
  form.loai.addEventListener('change', () => syncCapFields(form));
  form.querySelector('.ht-back')?.addEventListener('click', () => paintHost(host));
  form.querySelector('.ht-del')?.addEventListener('click', () => removeAssign(host));
  form.addEventListener('submit', (e) => { e.preventDefault(); saveAssign(host, form); });
  relayoutPopup(host);
}

function relayoutPopup(host) {
  [map, planMap].forEach(m => {
    const p = m?._popup;
    if (!p?.getElement?.()?.contains(host)) return;
    p.options.maxWidth = 380;
    p.update();
  });
}

async function saveAssign(host, form) {
  const ctx = host._htCtx;
  const msg = form.querySelector('.ht-msg');
  const parsed = readForm(form);
  if (parsed.error) { msg.textContent = parsed.error; msg.className = 'ht-msg is-err'; return; }
  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true;
  msg.textContent = 'Đang lưu…';
  msg.className = 'ht-msg';
  try {
    const shape = await ctx.geomTask;
    const geometry = slimGeom(shape);
    if (!geometry) throw new Error('Chưa lấy được ranh thửa. Phóng gần thửa rồi thử lại.');
    const c = centroidOf(geometry, { lat: ctx.lat, lng: ctx.lng });
    const data = await post('saveParcelInfra', {
      ...parsed,
      soTo: ctx.soTo,
      soThua: ctx.soThua,
      xaPhuong: ctx.xa,
      maXa: ctx.maXa,
      diaChi: ctx.diaChi,
      lat: c.lat,
      lng: c.lng,
      geometry
    });
    const idx = rows.findIndex(r => sameParcel(r, { soTo: ctx.soTo, soThua: ctx.soThua, xaPhuong: ctx.xa }));
    const rec = {
      id: data.id, soTo: ctx.soTo, soThua: ctx.soThua, xaPhuong: ctx.xa, maXa: ctx.maXa, diaChi: ctx.diaChi,
      loai: parsed.loai, ten: parsed.ten, quyMo: parsed.quyMo, dienTich: parsed.dienTich,
      tinhTrang: parsed.tinhTrang, ghiChuNguoi: parsed.ghiChu, geometry, lat: c.lat, lng: c.lng,
      nhom: data.nhom || '', xaMoi: data.xaMoi || ''
    };
    if (idx >= 0) rows[idx] = rec; else rows.push(rec);
    drawHighlights();
    let onLayer = false;
    try { onLayer = await reloadPoints(data.id); } catch (err) { console.warn(err); }
    paintHost(host);
    const where = data.xaMoi ? ` Phường/xã hiện nay: ${data.xaMoi}.` : '';
    showToast(onLayer
      ? `Đã ${data.updated ? 'cập nhật' : 'gán'} hạ tầng hiện trạng${data.id ? ` (${data.id})` : ''}.${where}`
      : `Đã ghi Sheet${data.id ? ` (${data.id})` : ''}. Điểm trên lớp hạ tầng hiện sau khi Apps Script được deploy bản mới.${where}`,
    onLayer ? 'success' : 'info');
  } catch (err) {
    msg.textContent = err.message || 'Không lưu được';
    msg.className = 'ht-msg is-err';
    btn.disabled = false;
  }
}

async function removeAssign(host) {
  const ctx = host._htCtx;
  const rec = findRec(ctx);
  if (!rec) return paintHost(host);
  if (!window.confirm(`Xóa gán hạ tầng của thửa ${ctx.soThua}, tờ ${ctx.soTo}?`)) return;
  try {
    await post('deleteParcelInfra', { soTo: ctx.soTo, soThua: ctx.soThua, xaPhuong: ctx.xa });
    rows = rows.filter(r => !sameParcel(r, { soTo: ctx.soTo, soThua: ctx.soThua, xaPhuong: ctx.xa }));
    drawHighlights();
    try { await reloadPoints(rec.id); } catch (err) { console.warn(err); }
    paintHost(host);
    showToast('Đã xóa gán hạ tầng hiện trạng của thửa này', 'success');
  } catch (err) {
    showToast(err.message || 'Không xóa được', 'error');
  }
}

function paintHost(host) {
  const ctx = host?._htCtx;
  if (!ctx) return;
  const rec = findRec(ctx);
  const btn = isAdmin()
    ? `<button type="button" class="proof-btn ht-open">${rec ? 'Sửa hạ tầng hiện trạng' : 'Gán hạ tầng hiện trạng'}</button>`
    : '';
  host.innerHTML = badgeHtml(rec) + btn;
  host.querySelector('.ht-open')?.addEventListener('click', () => openForm(host));
}

/** Gắn vào popup / bảng thửa. ctx.geomTask là Promise hình thửa. */
export function mountParcelAssign(host, ctx) {
  if (!host || !ctx) return;
  host._htCtx = ctx;
  paintHost(host);
  if (!loaded) loadRows();
}

export function initParcelInfra() {
  document.addEventListener('qh-admin-changed', () => {
    document.querySelectorAll('.ht-assign').forEach(paintHost);
  });
  loadRows();
}
