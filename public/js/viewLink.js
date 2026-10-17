// Link chia sẻ khung nhìn: query trên URL là trạng thái (không ghi máy chủ, không localStorage).
// Gồm tâm bản đồ, mức phóng, lớp droplist, các ô lớp đang bật, vùng phủ, chế độ xem, độ mờ thửa
// và đồ án đang mở (da). Không gồm phác thảo, đồ án khác đang tick để hiện lô, hay danh sách ẩn riêng từng máy.
import { map, layers, toggleBuffer } from './mapEngine.js';
import { getViewMode, setViewMode, isSplitOn, setSplit, getSplitKind, setSplitKind } from './planMap.js';
import { getLevel, setLevel, LEVELS } from './mapLevel.js';
import { labelsOverlayOn, setLabelsOverlay } from './basemap.js';
import { focusedProjectName } from './projectFiles.js';
import { shareOpenProject } from './projectLayer.js';
import { showToast } from './utils.js';

const LEVEL_CODE = { urban: 'dt', qhc25: '25', qhc10: '10', qhpk: 'pk', qhct: 'ct' };
const LEVEL_CHK = new Set(LEVELS.map(l => l.chk));

// Mã ngắn trên URL → id ô chọn. Mã lớp droplist trùng LEVEL_CODE.
const LAYERS = [
  ['bd', 'chk_bound'],
  ['dt', 'chk_urban'],
  ['lo', 'chk_parcel'],
  ['th', 'chk_cadastre'],
  ['pk', 'chk_projects'],
  ['25', 'chk_qhc25'],
  ['10', 'chk_qhc10'],
  ['g25', 'chk_gt25'],
  ['g10', 'chk_gt10'],
  ['ct', 'chk_qhct'],
  ['dg', 'chk_roads'],
  ['ds', 'chk_pop'],
  ['xd', 'chk_newdev'],
  ['ph', 'chk_heat'],
  ['dh', 'chk_terrain'],
  ['tn', 'chk_drainage'],
  ['bs', 'chk_basin'],
  ['ng', 'chk_flood'],
  ['s1', 'chk_sarflood'],
  ['nh', 'chk_lst'],
  ['fr', 'chk_forest'],
  ['rr', 'chk_risk'],
  ['os', 'chk_osmSport'],
  ['or', 'chk_osmRail'],
  ['ow', 'chk_osmWater'],
  ['c1', 'chk_c1'], ['c2', 'chk_c2'], ['c3', 'chk_c3'], ['c4', 'chk_c4'], ['c5', 'chk_c5'],
  ['c6', 'chk_c6'], ['c7', 'chk_c7'], ['c8', 'chk_c8'], ['c9', 'chk_c9'], ['c10', 'chk_c10'],
  ['c11', 'chk_c11'], ['c12', 'chk_c12'], ['c13', 'chk_c13'], ['c14', 'chk_c14']
];

const params = () => new URLSearchParams(location.search);

function setChecked(id, on) {
  const el = document.getElementById(id);
  if (!el || el.checked === on) return;
  el.checked = on;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function readCamera() {
  const parts = (params().get('ll') || '').split(',');
  if (parts.length !== 3) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  const z = Number(parts[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(z)) return null;
  if (lat < 15.5 || lat > 17.2 || lng < 106.5 || lng > 108.7 || z < 1 || z > 21) return null;
  return { lat, lng, z };
}

export function hasSharedCamera() {
  return !!readCamera();
}

function applyLayers(q) {
  if (!q.has('ly')) return;
  const on = new Set(q.get('ly').split(',').map(s => s.trim()).filter(Boolean));
  const opEl = document.getElementById('cadastreOpacity');
  const tho = Number(q.get('tho'));
  if (opEl && on.has('th') && q.has('tho') && Number.isFinite(tho)) {
    opEl.value = String(Math.min(100, Math.max(0, Math.round(tho))));
  }
  LAYERS.forEach(([code, id]) => {
    if (LEVEL_CHK.has(id)) return;
    setChecked(id, on.has(code));
  });
  const asked = LEVELS.find(l => l.id === q.get('lv'));
  const levelId = asked?.id || LEVELS.find(l => on.has(LEVEL_CODE[l.id]))?.id || null;
  if (levelId) setLevel(levelId);
  LEVELS.forEach(l => setChecked(l.chk, on.has(LEVEL_CODE[l.id])));
}

function applyBuffers(q) {
  if (!q.has('bf') || !map) return;
  const want = new Set(q.get('bf').split(',').map(s => s.trim()).filter(Boolean));
  document.querySelectorAll('.btn-dot-buffer[data-buffer]').forEach(btn => {
    const key = btn.dataset.buffer;
    const should = want.has(key);
    if (!layers[key] || map.hasLayer(layers[key]) === should) return;
    toggleBuffer(key, btn);
  });
}

function applyChrome(q) {
  if (q.get('m') === 'ht' && getViewMode() !== 'HT') setViewMode('HT');
  if (q.get('sp') === '1') {
    setSplitKind(q.get('sk') === 'off' ? 'offset' : 'same');
    if (!isSplitOn()) setSplit(true);
  }
  if (q.get('lb') === '1' && !labelsOverlayOn()) setLabelsOverlay(true);
  const cam = readCamera();
  if (cam && map) map.setView([cam.lat, cam.lng], cam.z, { animate: false });
}

function holdCamera() {
  const cam = readCamera();
  if (cam && map) map.setView([cam.lat, cam.lng], cam.z, { animate: false });
}

// Danh mục đồ án nạp sau khung nhìn: gắn trạng thái trước, vẽ lại khi catalog có tên
function applyOpenProject(q) {
  const name = (q.get('da') || '').trim();
  if (!name || name.length > 180) return;
  const open = () => {
    const found = shareOpenProject(name);
    if (found) holdCamera();
    return found;
  };
  if (open()) return;
  const once = () => {
    document.removeEventListener('cadparcels:loaded', once);
    open();
  };
  document.addEventListener('cadparcels:loaded', once);
}

/** Khôi phục khung nhìn nếu URL có tham số chia sẻ. Gọi sau khi ô lớp đã gắn sự kiện. */
export function applyViewLink() {
  const q = params();
  if (![...q.keys()].some(k => ['ll', 'ly', 'lv', 'm', 'sp', 'bf', 'lb', 'tho', 'da'].includes(k))) return;
  applyLayers(q);
  applyBuffers(q);
  applyChrome(q);
  applyOpenProject(q);
  const name = (q.get('da') || '').trim();
  showToast(name ? `Đã mở khung nhìn và đồ án «${name}»` : 'Đã mở khung nhìn được chia sẻ', 'info');
}

function buildUrl() {
  const url = new URL(location.href);
  url.hash = '';
  const q = new URLSearchParams();
  if (map) {
    const c = map.getCenter();
    const z = map.getZoom();
    const zStr = Number.isInteger(z) ? String(z) : z.toFixed(2);
    q.set('ll', `${c.lat.toFixed(5)},${c.lng.toFixed(5)},${zStr}`);
  }
  q.set('lv', getLevel());
  if (getViewMode() === 'HT') q.set('m', 'ht');
  if (isSplitOn()) {
    q.set('sp', '1');
    if (getSplitKind() === 'offset') q.set('sk', 'off');
  }
  const on = LAYERS.filter(([, id]) => document.getElementById(id)?.checked).map(([code]) => code);
  q.set('ly', on.join(','));
  const buffers = [...document.querySelectorAll('.btn-dot-buffer[data-buffer]')]
    .map(btn => btn.dataset.buffer)
    .filter(key => map && layers[key] && map.hasLayer(layers[key]));
  if (buffers.length) q.set('bf', buffers.join(','));
  const tho = document.getElementById('cadastreOpacity');
  if (document.getElementById('chk_cadastre')?.checked && tho && tho.value !== '100') q.set('tho', tho.value);
  if (labelsOverlayOn()) q.set('lb', '1');
  const openName = focusedProjectName();
  if (openName) q.set('da', openName);
  url.search = q.toString();
  return url.toString();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export function initViewLink() {
  document.getElementById('btnShareView')?.addEventListener('click', async () => {
    const link = buildUrl();
    history.replaceState(null, '', link);
    const ok = await copyText(link);
    const openName = focusedProjectName();
    const copied = openName
      ? `Đã chép link. Người nhận mở đúng vị trí, lớp đang bật và đồ án «${openName}»`
      : 'Đã chép link khung nhìn. Gửi link này để người khác mở đúng vị trí và lớp đang bật';
    showToast(ok ? copied : 'Chưa chép được. Hãy chép địa chỉ trên thanh trình duyệt', ok ? 'success' : 'error');
  });
  applyViewLink();
}
