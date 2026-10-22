// Quản trị vẽ dấu chân nhà mới trên bản đồ hiện trạng, đặt số tầng (có thể tách đế / tháp).
// Mọi người xem được khi lớp công trình bật. Chỉ người vẽ được sửa hoặc xóa dấu chân của mình.
import { state } from './state.js';
import { geeApi } from './api.js';
import { map } from './mapEngine.js';
import { planMap } from './planMap.js';
import { showToast, announceTool, TOOL_START_EVENT } from './utils.js';
import { setDrawAssist } from './drawAssist.js';
import { GBA_FLOOR_COLORS, FLOOR_LABEL_ZOOM, floorClassIndex } from './gbaStats.js';
import {
  FLOOR_M, additionLabel, applyAddition, coverRings, newAdditionId, normalizeRing, parseAdditionPack, ringIssue
} from './bldgAdditions.js';

const PART_PANE = 'gbaPartPane';
const PART_Z = 409;
const LABEL_ZOOM = FLOOR_LABEL_ZOOM;
const MIN_ZOOM = 13;
const STORE = 'qh_bldg_additions';

const $ = (id) => document.getElementById(id);

let pack = { v: 1, saved: 0, features: [] };
let feetOn = false;
let floorEdit = false;
let phase = null;
let vertices = [];
let draft = null;
let layerL = null;
let layerR = null;
let draftLayer = null;
let guide = null;
let restoreDbl = null;

const isAdmin = () => state.currentUserRole === 'ADMIN' && !!state.authToken;
const drawing = () => state.adminDrawMode === 'bldg';
const mine = (feature) => !feature.by || feature.by === (state.authUser && state.authUser.email);

function pane(m) {
  if (!m.getPane(PART_PANE)) {
    const p = m.createPane(PART_PANE);
    p.style.zIndex = String(PART_Z);
  }
}

function remember(next) {
  pack = next;
  try { sessionStorage.setItem(STORE, JSON.stringify({ v: 1, saved: pack.saved, features: pack.features })); } catch (e) { /* riêng tư */ }
  document.querySelectorAll('.view3d-frame').forEach((frame) => {
    try {
      frame.contentWindow?.postMessage({ type: 'qh-bldg-add', pack: { v: 1, saved: pack.saved, features: pack.features } }, location.origin);
    } catch (err) { /* khung đã đóng */ }
  });
  document.dispatchEvent(new CustomEvent('qh-bldg-covers', { detail: coverRings(pack.features) }));
  paint();
}

async function loadPack() {
  let remote = { v: 1, saved: 0, features: [] };
  try {
    const res = await fetch(geeApi('action=getBldgAdditions'));
    if (res.ok) remote = parseAdditionPack(await res.json());
  } catch (e) { /* máy chủ tĩnh */ }
  try {
    const local = parseAdditionPack(JSON.parse(sessionStorage.getItem(STORE) || 'null'));
    if (local.saved >= remote.saved && local.features.length) remote = local;
  } catch (e) { /* chưa có bản trong phiên */ }
  remember(remote);
}

function ensureFeet() {
  if (feetOn) return;
  const chk = $('chk_gba');
  if (chk && !chk.checked) {
    chk.checked = true;
    chk.dispatchEvent(new Event('change'));
  }
}

function syncBtn() {
  const btn = $('btnGbaDraw');
  if (!btn) return;
  const admin = isAdmin();
  btn.hidden = !admin;
  btn.classList.toggle('active', !!phase);
  btn.setAttribute('aria-pressed', phase ? 'true' : 'false');
  if (!admin && phase) stopDraw(true);
}

function ringLatLngs(ring) {
  return (ring || []).map(([lng, lat]) => [lat, lng]);
}

function wholeStyle(floors) {
  const color = GBA_FLOOR_COLORS[floorClassIndex(null, floors)] || GBA_FLOOR_COLORS[0];
  return { color: '#431407', weight: 1.6, fillColor: color, fillOpacity: 0.72, opacity: 1 };
}

function roleStyle(role) {
  return role === 'podium'
    ? { color: '#fdba74', weight: 2, dashArray: '5 4', fillColor: '#ffedd5', fillOpacity: 0.4, opacity: 1 }
    : { color: '#9a3412', weight: 2.5, fillColor: '#9a3412', fillOpacity: 0.35, opacity: 1 };
}

function featureOf(id, role, floors, ring, by) {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: { id, role, floors, by, label: additionLabel(role, floors) }
  };
}

function featuresOf(list) {
  const features = [];
  for (const f of list) {
    if (!f.ring) continue;
    if (f.tower && f.tower.ring) {
      features.push(featureOf(f.id, 'podium', f.floors, f.ring, f.by));
      features.push(featureOf(f.id, 'tower', f.tower.floors, f.tower.ring, f.by));
    } else {
      features.push(featureOf(f.id, '', f.floors, f.ring, f.by));
    }
  }
  return { type: 'FeatureCollection', features };
}

function clickable(feature) {
  return isAdmin() && !phase && !floorEdit && mine({ by: feature.properties.by });
}

function bindLabel(feature, layer, m) {
  const text = feature.properties.label;
  if (!text) return;
  layer.bindTooltip(text, { permanent: true, direction: 'center', className: 'gba-part-label gba-add-label', opacity: 1 });
  const zoom = m.getZoom();
  if (zoom >= LABEL_ZOOM && zoom >= MIN_ZOOM) layer.openTooltip();
}

function addSaved(m, fc) {
  pane(m);
  return L.geoJSON(fc, {
    pane: PART_PANE,
    style: (feature) => {
      const role = feature.properties.role;
      return role === 'podium' || role === 'tower' ? roleStyle(role) : wholeStyle(feature.properties.floors);
    },
    onEachFeature(feature, layer) {
      layer.options.interactive = clickable(feature);
      bindLabel(feature, layer, m);
      layer.on('add', () => {
        const el = layer.getElement?.();
        if (el) el.dataset.bldgAdd = feature.properties.id;
      });
      layer.on('click', (ev) => {
        if (!clickable(feature)) return;
        L.DomEvent.stopPropagation(ev);
        const found = pack.features.find((item) => item.id === feature.properties.id);
        if (found) openForm(m, { ...found, tower: found.tower ? { ...found.tower } : null });
      });
    }
  }).addTo(m);
}

function refreshZoom() {
  [[map, layerL], [planMap, layerR]].forEach(([m, layer]) => {
    if (!m || !layer) return;
    const zoom = m.getZoom();
    const show = feetOn && zoom >= MIN_ZOOM;
    const label = zoom >= LABEL_ZOOM;
    layer.eachLayer((l) => {
      const el = l.getElement?.();
      if (el) el.style.display = show ? '' : 'none';
      if (!l.getTooltip?.()) return;
      if (show && label) l.openTooltip();
      else l.closeTooltip();
    });
  });
}

function paint() {
  [map, planMap].forEach((m) => m?.getContainer()?.querySelectorAll('.gba-add-label').forEach((el) => el.remove()));
  layerL?.remove(); layerL = null;
  layerR?.remove(); layerR = null;
  if (!feetOn) {
    draftLayer?.remove(); draftLayer = null;
    guide?.remove(); guide = null;
    return;
  }
  const hidden = draft && draft.id;
  const list = pack.features.filter((f) => f.id !== hidden);
  const fc = featuresOf(list);
  if (map) layerL = addSaved(map, fc);
  if (planMap) layerR = addSaved(planMap, fc);
  refreshZoom();
  renderDraft();
}

function renderDraft() {
  if (draftLayer) draftLayer.clearLayers();
  guide?.remove(); guide = null;
  if (!map || !phase && !(draft && draft.ring)) {
    if (draftLayer) { draftLayer.remove(); draftLayer = null; }
    return;
  }
  pane(map);
  if (!draftLayer) draftLayer = L.layerGroup().addTo(map);
  if (draft && draft.ring && phase !== 'outer') {
    const role = draft.tower ? 'podium' : '';
    L.polygon(ringLatLngs(draft.ring), {
      pane: PART_PANE,
      interactive: false,
      ...(role ? roleStyle(role) : wholeStyle(draft.floors || 1))
    }).addTo(draftLayer);
  }
  if (draft && draft.tower && draft.tower.ring && phase !== 'tower') {
    L.polygon(ringLatLngs(draft.tower.ring), { pane: PART_PANE, interactive: false, ...roleStyle('tower') }).addTo(draftLayer);
  }
  const info = $('bldgDrawInfo');
  if (info && phase) {
    info.textContent = phase === 'tower'
      ? `${vertices.length} đỉnh ranh tháp. Khép khi đủ 3 đỉnh, nằm trong dấu chân.`
      : `${vertices.length} đỉnh. Khép khi đủ 3 đỉnh, hoặc bấm lại đỉnh đầu.`;
  }
  if (!phase || vertices.length < 1) return;
  const latlngs = vertices.map((v) => [v.lat, v.lng]);
  L.polyline(latlngs, {
    pane: PART_PANE, color: phase === 'tower' ? '#9a3412' : '#431407', weight: 2, dashArray: '5 4', interactive: false
  }).addTo(draftLayer);
  vertices.forEach((v, i) => {
    const first = i === 0;
    const marker = L.circleMarker([v.lat, v.lng], {
      pane: PART_PANE,
      radius: first ? 8 : 4,
      color: '#fff',
      weight: 2,
      fillColor: first ? '#ea580c' : '#9a3412',
      fillOpacity: 1,
      interactive: first && vertices.length >= 3
    }).addTo(draftLayer);
    if (first && vertices.length >= 3) {
      marker.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev);
        closeRing();
      });
    }
  });
}

function onGuide(e) {
  if (!phase || !vertices.length || !draftLayer) return;
  guide?.remove();
  const last = vertices[vertices.length - 1];
  guide = L.polyline([[last.lat, last.lng], [e.latlng.lat, e.latlng.lng]], {
    pane: PART_PANE, color: '#fdba74', weight: 1.5, dashArray: '3 4', interactive: false
  }).addTo(draftLayer);
}

function setPhase(next) {
  phase = next;
  if (next) {
    announceTool('bldg');
    state.adminDrawMode = 'bldg';
    if (restoreDbl == null && map) {
      restoreDbl = map.doubleClickZoom.enabled();
      map.doubleClickZoom.disable();
    }
    map?.on('mousemove', onGuide);
    setDrawAssist('bldg', true);
  } else {
    if (drawing()) state.adminDrawMode = null;
    map?.off('mousemove', onGuide);
    guide?.remove(); guide = null;
    setDrawAssist('bldg', false);
    if (restoreDbl != null && map) {
      if (restoreDbl) map.doubleClickZoom.enable();
      restoreDbl = null;
    }
  }
  map?.getContainer()?.classList.toggle('bldg-draw', !!next);
  const box = $('bldgDrawBox');
  if (box) box.hidden = !next;
  syncBtn();
  paint();
}

function stopDraw(discard) {
  vertices = [];
  if (discard) draft = null;
  setPhase(null);
}

function startOuter() {
  const floorBtn = $('btnGbaFloors');
  if (floorBtn?.classList.contains('active')) floorBtn.click();
  ensureFeet();
  vertices = [];
  if (!draft) draft = { id: newAdditionId(), name: '', floors: 4, tower: null, ring: null };
  setPhase('outer');
}

function startTower() {
  readFormIntoDraft();
  vertices = [];
  if (draft.tower && draft.tower.ring) {
    draft.tower.ring.slice(0, -1).forEach(([lng, lat]) => vertices.push({ lng, lat }));
  }
  map?.closePopup();
  setPhase('tower');
}

function esc(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function centroid(ring) {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const p of ring) {
    if (n && p[0] === ring[0][0] && p[1] === ring[0][1]) continue;
    x += p[0];
    y += p[1];
    n += 1;
  }
  return n ? [y / n, x / n] : [ring[0][1], ring[0][0]];
}

function formHtml(item) {
  const split = !!(item.tower && item.tower.ring);
  const podium = split ? item.floors : item.floors;
  const towerFloors = split ? item.tower.floors : '';
  const existing = pack.features.some((f) => f.id === item.id);
  return `<form class="gba-floor-form">
    <b>${existing ? 'Sửa dấu chân' : 'Dấu chân mới'}</b>
    <span>Một tầng = ${FLOOR_M} m. Chiều cao = số tầng × ${FLOOR_M} m.</span>
    <label>Tên<input name="name" maxlength="80" value="${esc(item.name)}"></label>
    <label data-whole>Số tầng<input name="floors" type="number" min="1" max="80" step="1" inputmode="numeric" value="${item.floors || 4}"></label>
    <label class="bldg-split"><input name="split" type="checkbox"${split ? ' checked' : ''}> Tách đế và tháp</label>
    <div data-split${split ? '' : ' hidden'}>
      <label>Số tầng đế<input name="podium" type="number" min="1" max="80" step="1" inputmode="numeric" value="${podium || 2}"></label>
      <label>Số tầng tháp (phần nhô)<input name="towerFloors" type="number" min="1" max="80" step="1" inputmode="numeric" value="${towerFloors || 8}"></label>
      <button type="button" class="bp-btn" data-tower>${item.tower && item.tower.ring ? 'Vẽ lại ranh tháp' : 'Vẽ ranh tháp'}</button>
      <span data-tower-state>${item.tower && item.tower.ring ? 'Đã có ranh tháp.' : 'Chưa có ranh tháp.'}</span>
    </div>
    <span data-height></span>
    <button type="submit" class="bp-btn">Lưu</button>
    <button type="button" class="bp-btn" data-redraw>Vẽ lại ranh</button>
    ${existing ? '<button type="button" class="bp-btn" data-delete>Xóa dấu chân</button>' : ''}
    <button type="button" class="bp-btn" data-cancel>Hủy</button>
  </form>`;
}

function heightNote(form) {
  const el = form.querySelector('[data-height]');
  if (!el) return;
  const split = form.querySelector('[name="split"]')?.checked;
  if (!split) {
    const n = Math.round(Number(form.querySelector('[name="floors"]')?.value));
    el.textContent = n >= 1 ? `Cao ${n * FLOOR_M} m.` : '';
    return;
  }
  const p = Math.round(Number(form.querySelector('[name="podium"]')?.value));
  const t = Math.round(Number(form.querySelector('[name="towerFloors"]')?.value));
  if (p >= 1 && t >= 1) el.textContent = `Đế cao ${p * FLOOR_M} m. Đỉnh tháp ${(p + t) * FLOOR_M} m.`;
  else el.textContent = '';
}

function readFormIntoDraft() {
  const form = document.querySelector('.gba-floor-form');
  if (!form || !draft) return;
  const data = new FormData(form);
  draft.name = String(data.get('name') || '');
  const split = !!form.querySelector('[name="split"]')?.checked;
  if (!split) {
    draft.floors = Math.round(Number(data.get('floors')));
    draft.tower = null;
    return;
  }
  draft.floors = Math.round(Number(data.get('podium')));
  const floors = Math.round(Number(data.get('towerFloors')));
  draft.tower = { ...(draft.tower || {}), floors };
  if (!draft.tower.ring) draft.tower = { floors };
}

function openForm(targetMap, item) {
  if (!isAdmin() || !mine(item)) {
    showToast('Chỉ người vẽ được sửa dấu chân này.', 'info');
    return;
  }
  draft = {
    id: item.id,
    name: item.name || '',
    by: item.by || '',
    at: item.at || 0,
    ring: item.ring,
    floors: item.floors,
    tower: item.tower ? { ring: item.tower.ring, floors: item.tower.floors } : null
  };
  vertices = [];
  setPhase(null);
  paint();
  const host = targetMap || map;
  if (!host) return;
  const pop = L.popup({ className: 'gba-floor-pop', closeButton: true, autoPan: true, maxWidth: 260 })
    .setLatLng(centroid(draft.ring))
    .setContent(formHtml(draft))
    .openOn(host);
  const form = pop.getElement()?.querySelector('form');
  if (!form) return;
  const splitBox = form.querySelector('[data-split]');
  const whole = form.querySelector('[data-whole]');
  const syncSplit = () => {
    const on = !!form.querySelector('[name="split"]')?.checked;
    if (splitBox) splitBox.hidden = !on;
    if (whole) whole.hidden = on;
    heightNote(form);
  };
  form.addEventListener('input', () => heightNote(form));
  form.querySelector('[name="split"]')?.addEventListener('change', syncSplit);
  syncSplit();
  form.querySelector('[data-tower]')?.addEventListener('click', () => startTower());
  form.querySelector('[data-redraw]')?.addEventListener('click', () => {
    readFormIntoDraft();
    host.closePopup();
    startOuter();
  });
  form.querySelector('[data-cancel]')?.addEventListener('click', () => {
    host.closePopup();
    draft = null;
    paint();
  });
  form.querySelector('[data-delete]')?.addEventListener('click', () => send({ op: 'delete', id: draft.id }));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    readFormIntoDraft();
    const split = !!form.querySelector('[name="split"]')?.checked;
    if (split && !(draft.tower && draft.tower.ring)) {
      showToast('Vẽ ranh tháp bên trong dấu chân trước khi lưu.', 'error');
      return;
    }
    send({
      op: 'upsert',
      id: draft.id,
      name: draft.name,
      ring: draft.ring,
      floors: draft.floors,
      podiumFloors: split ? draft.floors : undefined,
      tower: split ? { ring: draft.tower.ring, floors: draft.tower.floors } : null
    });
  });
}

async function send(body) {
  const next = applyAddition(pack, { ...body, base: pack.saved }, { email: state.authUser && state.authUser.email });
  if (!next.pack) {
    showToast(next.message || 'Dấu chân không hợp lệ.', 'error');
    return;
  }
  let res;
  try {
    res = await fetch(geeApi('action=saveBldgAddition'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.authToken}` },
      body: JSON.stringify({ ...body, base: pack.saved || 0 })
    });
  } catch (err) {
    showToast('Chưa lưu được dấu chân.', 'error');
    return;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showToast(data.message || 'Chưa lưu được dấu chân.', 'error');
    if (res.status === 409) loadPack();
    return;
  }
  draft = null;
  vertices = [];
  remember(parseAdditionPack({ v: 1, saved: data.at, features: data.features }));
  map?.closePopup();
  planMap?.closePopup();
  showToast(body.op === 'delete' ? 'Đã xóa dấu chân.' : 'Đã lưu dấu chân.', 'success');
}

function closeRing() {
  const ring = normalizeRing(vertices.map((v) => [v.lng, v.lat]));
  if (phase === 'tower') {
    const issue = ring ? '' : 'Ranh tháp cần ít nhất 3 đỉnh';
    if (issue || !draft || !draft.ring) {
      showToast(issue || 'Chưa có dấu chân ngoài.', 'error');
      return;
    }
    const probe = applyAddition(
      { saved: 0, features: [] },
      { op: 'upsert', ring: draft.ring, floors: draft.floors || 2, tower: { ring, floors: draft.tower?.floors || 1 } },
      { email: 'preview@local' }
    );
    if (!probe.pack) {
      showToast(probe.message, 'error');
      return;
    }
    draft.tower = { ring: probe.pack.features[0].tower.ring, floors: draft.tower?.floors || probe.pack.features[0].tower.floors };
    vertices = [];
    setPhase(null);
    openForm(map, draft);
    return;
  }
  const issue = ringIssue(vertices.map((v) => [v.lng, v.lat]));
  if (issue) {
    showToast(issue, 'error');
    return;
  }
  if (!draft) draft = { id: newAdditionId(), name: '', floors: 4, tower: null };
  draft.ring = ring;
  vertices = [];
  setPhase(null);
  openForm(map, draft);
}

export function handleBldgDrawClick(latlng) {
  if (!isAdmin() || !phase || !latlng) return;
  const first = vertices[0];
  if (first && vertices.length >= 3 && map) {
    const a = map.latLngToContainerPoint(latlng);
    const b = map.latLngToContainerPoint(L.latLng(first.lat, first.lng));
    if (Math.hypot(a.x - b.x, a.y - b.y) <= 10) {
      closeRing();
      return;
    }
  }
  const last = vertices[vertices.length - 1];
  if (last && map) {
    const a = map.latLngToContainerPoint(latlng);
    const b = map.latLngToContainerPoint(L.latLng(last.lat, last.lng));
    if (Math.hypot(a.x - b.x, a.y - b.y) <= 6) return;
  }
  vertices.push({ lat: latlng.lat, lng: latlng.lng });
  renderDraft();
}

export function noteBldgFloorEdit(on) {
  floorEdit = !!on;
  paint();
}

export function syncBldgFeet(on) {
  feetOn = !!on;
  if (!feetOn && phase) stopDraw(true);
  else paint();
}

function ensureBar() {
  if ($('bldgDrawBox') || !map) return;
  const bar = document.createElement('div');
  bar.id = 'bldgDrawBox';
  bar.className = 'bldg-draw-bar';
  bar.hidden = true;
  bar.innerHTML = `<p id="bldgDrawInfo">Bấm bản đồ để đặt đỉnh dấu chân. Khép khi đủ 3 đỉnh.</p>
    <div class="bldg-draw-actions">
      <button type="button" class="layer-mini-btn" id="btnBldgUndo">Xóa đỉnh</button>
      <button type="button" class="layer-mini-btn" id="btnBldgClose">Khép</button>
      <button type="button" class="layer-mini-btn" id="btnBldgCancel">Hủy</button>
    </div>`;
  map.getContainer().appendChild(bar);
  L.DomEvent.disableClickPropagation(bar);
  L.DomEvent.disableScrollPropagation(bar);
}

export function initBldgDraw() {
  if (!map) return;
  ensureBar();
  document.addEventListener('qh-admin-changed', () => { syncBtn(); paint(); });
  syncBtn();
  document.addEventListener(TOOL_START_EVENT, (e) => {
    if (e.detail !== 'bldg' && phase) stopDraw(true);
  });
  map.on('zoomend', refreshZoom);
  planMap?.on('zoomend', refreshZoom);
  $('btnGbaDraw')?.addEventListener('click', () => {
    if (!isAdmin()) return;
    if (phase) stopDraw(true);
    else {
      draft = null;
      startOuter();
    }
  });
  $('btnBldgUndo')?.addEventListener('click', () => {
    vertices.pop();
    renderDraft();
  });
  $('btnBldgClose')?.addEventListener('click', closeRing);
  $('btnBldgCancel')?.addEventListener('click', () => {
    if (phase === 'tower' && draft && draft.ring) {
      vertices = [];
      setPhase(null);
      openForm(map, draft);
      return;
    }
    stopDraw(true);
  });
  document.addEventListener('keydown', (e) => {
    if (!phase || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'Escape') {
      $('btnBldgCancel')?.click();
      return;
    }
    if ((e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) && vertices.length) {
      e.preventDefault();
      vertices.pop();
      renderDraft();
    }
  });
  loadPack();
}
