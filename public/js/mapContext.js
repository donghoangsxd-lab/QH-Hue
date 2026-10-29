// Menu chuột phải trên bản đồ (máy tính). Chạm giữ trên màn hình cảm ứng mở cùng menu.
// Mọi mục gọi lại công cụ đã có: thửa, bảng quy hoạch 4 cấp, tra cứu bán kính, đo, Street View.
// Ghi chú nằm trên máy (localStorage), không gửi máy chủ.
import { state } from './state.js';
import { map, wardNameAt, toggleMeasure, handleMeasureClick, inspectAccessAt, consumeMeasureContext } from './mapEngine.js';
import { planMap } from './planMap.js';
import { openParcelAt, openPlanAt, planLevelsAt, parcelFactsAt } from './cadastreLayer.js';
import { LOTS_PROGRESS_EVENT, lotsRevision } from './projectFiles.js';
import { openStreetView } from './streetView.js';
import { escapeHtml, ico, showToast } from './utils.js';

const NOTE_KEY = 'qhhue_map_notes';
const LONG_MS = 1500;
const LONG_SLOP = 12;

let menuEl = null;
let placeEl = null;
let noteEditor = null;
const noteGroups = new Map();
let notes = [];

const mapsOf = () => [map, planMap].filter(Boolean);

function loadNotes() {
  try {
    const raw = JSON.parse(localStorage.getItem(NOTE_KEY) || '[]');
    notes = Array.isArray(raw) ? raw.filter(n => n && Number.isFinite(n.lat) && Number.isFinite(n.lng)) : [];
  } catch {
    notes = [];
  }
}

function saveNotes() {
  try { localStorage.setItem(NOTE_KEY, JSON.stringify(notes)); } catch { /* chế độ riêng tư */ }
}

function closeMenu() {
  if (menuEl?._onLots) document.removeEventListener(LOTS_PROGRESS_EVENT, menuEl._onLots);
  menuEl?._fly?.remove();
  menuEl?.remove();
  menuEl = null;
}

function closePlace() {
  placeEl?.remove();
  placeEl = null;
}

function closeNoteEditor(commit) {
  if (!noteEditor) return;
  const ed = noteEditor;
  noteEditor = null;
  const text = ed.input.value.replace(/\s+$/g, '').trim();
  ed.el.remove();
  if (!commit) return;
  if (ed.id) {
    const row = notes.find(n => n.id === ed.id);
    if (!row) return;
    if (!text) notes = notes.filter(n => n.id !== ed.id);
    else row.text = text;
  } else if (text) {
    notes.push({ id: `n${Date.now().toString(36)}`, lat: ed.lat, lng: ed.lng, text });
  }
  saveNotes();
  drawNotes();
}

function groupFor(m) {
  let g = noteGroups.get(m);
  if (!g) {
    g = L.layerGroup().addTo(m);
    noteGroups.set(m, g);
  }
  return g;
}

function drawNotes() {
  mapsOf().forEach(m => {
    const g = groupFor(m);
    g.clearLayers();
    notes.forEach(n => {
      const marker = L.marker([n.lat, n.lng], {
        keyboard: false,
        zIndexOffset: 800,
        icon: L.divIcon({
          className: 'map-note-pin',
          html: '<span></span>',
          iconSize: [16, 16],
          iconAnchor: [8, 16]
        })
      });
      marker.bindTooltip(escapeHtml(n.text || 'Ghi chú'), { direction: 'top', className: 'dot-tip', opacity: 1 });
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        openNoteEditor({ clientX: e.originalEvent?.clientX || 80, clientY: e.originalEvent?.clientY || 80 }, n);
      });
      g.addLayer(marker);
    });
  });
}

function clampBox(el, x, y) {
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  el.style.maxHeight = `${Math.max(120, vh - pad * 2)}px`;
  el.style.maxWidth = `${Math.max(180, vw - pad * 2)}px`;
  const r = el.getBoundingClientRect();
  let left = x;
  let top = y;
  if (left + r.width > vw - pad) left = vw - pad - r.width;
  if (top + r.height > vh - pad) top = vh - pad - r.height;
  el.style.left = `${Math.max(pad, left)}px`;
  el.style.top = `${Math.max(pad, top)}px`;
}

function openNoteEditor(ev, note) {
  closeMenu();
  closeNoteEditor(false);
  const el = document.createElement('form');
  el.className = 'note-editor';
  el.innerHTML = `<div class="note-editor-title">${ico('pin')}Đánh dấu và ghi chú</div>
    <textarea maxlength="500" rows="3" placeholder="Nội dung ghi chú" aria-label="Nội dung ghi chú"></textarea>
    <div class="note-editor-acts">
      ${note?.id ? '<button type="button" data-act="del">Xóa</button>' : ''}
      <button type="button" data-act="cancel">Hủy</button>
      <button type="submit" data-act="save">Lưu</button>
    </div>`;
  document.body.appendChild(el);
  const input = el.querySelector('textarea');
  input.value = note?.text || '';
  noteEditor = { el, input, id: note?.id || null, lat: note?.lat, lng: note?.lng };
  clampBox(el, ev.clientX, ev.clientY);
  input.focus();
  el.addEventListener('submit', (e) => { e.preventDefault(); closeNoteEditor(true); });
  el.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'cancel') closeNoteEditor(false);
    else if (act === 'del') {
      notes = notes.filter(n => n.id !== note.id);
      saveNotes();
      drawNotes();
      closeNoteEditor(false);
    }
  });
}

async function copyText(text) {
  const value = String(text || '').trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    showToast('Đã sao chép', 'success');
  } catch {
    showToast('Không sao chép được', 'error');
  }
}

function openPlace(ev, latlng) {
  closePlace();
  const lat = latlng.lat;
  const lng = latlng.lng;
  const coord = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  const ward = wardNameAt(lat, lng) || '';
  const el = document.createElement('aside');
  el.className = 'place-card';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Thông tin địa điểm');
  const row = (key, label, value, pending) => `<button type="button" class="place-row" data-copy="${key}" ${value ? '' : 'disabled'}>
      <span>${label}</span><b>${pending ? 'Đang tra dữ liệu thửa…' : escapeHtml(value || 'Không có trong dữ liệu')}</b></button>`;
  el.innerHTML = `<header class="place-head"><span>${ico('locate')}Thông tin địa điểm</span>
      <button type="button" class="place-x" title="Đóng" aria-label="Đóng">${ico('close')}</button></header>
    ${row('coord', 'Tọa độ', coord)}
    ${row('ward', 'Phường, xã', ward)}
    ${row('addr', 'Địa chỉ', '', true)}
    <a class="place-dir" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}">${ico('pin')}Chỉ đường tới điểm này</a>`;
  document.body.appendChild(el);
  placeEl = el;
  clampBox(el, ev.clientX, ev.clientY);
  el.querySelector('.place-x').addEventListener('click', closePlace);
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn || btn.disabled) return;
    copyText(btn.querySelector('b')?.textContent);
  });
  parcelFactsAt(latlng).then(facts => {
    if (placeEl !== el) return;
    const btn = el.querySelector('[data-copy="addr"]');
    const b = btn?.querySelector('b');
    if (!btn || !b) return;
    const addr = [facts?.address, facts?.oldWard].filter(Boolean).join(' · ');
    b.textContent = addr || 'Không có trong dữ liệu thửa';
    btn.disabled = !addr;
  }).catch(() => {
    if (placeEl !== el) return;
    const btn = el.querySelector('[data-copy="addr"]');
    const b = btn?.querySelector('b');
    if (b) b.textContent = 'Không có trong dữ liệu thửa';
    if (btn) btn.disabled = true;
  });
}

function startMeasure(type, latlng, m) {
  if (state.activeMeasureType !== type) toggleMeasure(type);
  handleMeasureClick(latlng, m);
}

function item(act, icon, label) {
  return `<button type="button" class="map-ctx-item" role="menuitem" data-act="${act}">${ico(icon)}<span>${label}</span></button>`;
}

function planItem() {
  return `<div class="map-ctx-plan"><button type="button" class="map-ctx-item" role="menuitem" data-act="plan">${ico('layers')}<span>Xem thông tin lô đất quy hoạch</span><span class="map-ctx-caret" aria-hidden="true">›</span></button></div>`;
}

function placeFly(anchor, fly) {
  const pad = 8;
  const r = anchor.getBoundingClientRect();
  fly.hidden = false;
  fly.style.left = `${r.right - 4}px`;
  fly.style.top = `${r.top}px`;
  const box = fly.getBoundingClientRect();
  let left = r.right - 4;
  let top = r.top;
  if (left + box.width > window.innerWidth - pad) left = Math.max(pad, r.left - box.width + 4);
  if (top + box.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - pad - box.height);
  fly.style.left = `${left}px`;
  fly.style.top = `${top}px`;
}

function armPlanFly(menu, latlng, targetMap) {
  const row = menu.querySelector('.map-ctx-plan');
  if (!row) return;
  const fly = document.createElement('div');
  fly.className = 'map-ctx-fly';
  fly.hidden = true;
  fly.setAttribute('role', 'menu');
  fly.innerHTML = '<div class="map-ctx-note">Đang kiểm tra cấp quy hoạch…</div>';
  fly.addEventListener('contextmenu', (e) => e.preventDefault());
  document.body.appendChild(fly);
  menu._fly = fly;
  let hot = false;
  const show = () => { hot = true; placeFly(row, fly); };
  const hide = () => {
    hot = false;
    setTimeout(() => { if (!hot) fly.hidden = true; }, 160);
  };
  row.addEventListener('pointerenter', show);
  row.addEventListener('pointerleave', hide);
  fly.addEventListener('pointerenter', show);
  fly.addEventListener('pointerleave', hide);
  fly.addEventListener('click', (e) => {
    const id = e.target.closest('[data-level]')?.dataset.level;
    if (!id) return;
    closeMenu();
    openPlanAt(latlng, targetMap, id);
  });
  let shown = '';
  let ticket = 0;
  let watchRev = -1;
  const paint = (list) => {
    const sig = list.map(choice => choice.id).join(',');
    if (sig === shown && fly.childElementCount) {
      if (!fly.hidden) placeFly(row, fly);
      return;
    }
    shown = sig;
    if (!list.length) fly.innerHTML = '<div class="map-ctx-note">Không có lô đất quy hoạch tại vị trí này</div>';
    else {
      fly.innerHTML = list.map(choice =>
        `<button type="button" class="map-ctx-item" role="menuitem" data-level="${choice.id}">${escapeHtml(choice.label)}</button>`).join('');
    }
    if (!fly.hidden) placeFly(row, fly);
  };
  const pull = () => {
    const mine = ++ticket;
    const rev = lotsRevision();
    watchRev = rev;
    planLevelsAt(latlng).then(list => {
      if (menuEl !== menu || mine !== ticket) return;
      if (lotsRevision() !== rev) { pull(); return; }
      paint(list);
    }).catch(() => {
      if (menuEl !== menu || mine !== ticket) return;
      fly.innerHTML = '<div class="map-ctx-note">Không kiểm tra được cấp quy hoạch</div>';
    });
  };
  const onLots = () => {
    if (menuEl !== menu || lotsRevision() === watchRev) return;
    pull();
  };
  menu._onLots = onLots;
  document.addEventListener(LOTS_PROGRESS_EVENT, onLots);
  pull();
}

function openMenu(ev, latlng, targetMap) {
  closeMenu();
  closeNoteEditor(false);
  const el = document.createElement('div');
  el.className = 'map-ctx-menu';
  el.setAttribute('role', 'menu');
  el.innerHTML = [
    item('parcel', 'parcel', 'Xem thông tin thửa đất'),
    planItem(),
    item('access', 'inspect', 'Xem khả năng tiếp cận hạ tầng'),
    item('place', 'locate', 'Xem thông tin địa điểm'),
    '<div class="map-ctx-sep"></div>',
    item('note', 'pin', 'Đánh dấu và ghi chú'),
    '<div class="map-ctx-sep"></div>',
    item('dist', 'ruler', 'Đo khoảng cách'),
    item('area', 'area', 'Đo diện tích'),
    '<div class="map-ctx-sep"></div>',
    item('sv', 'camera', 'Xem Street View')
  ].join('');
  el.style.left = `${ev.clientX}px`;
  el.style.top = `${ev.clientY}px`;
  el.style.visibility = 'hidden';
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  document.body.appendChild(el);
  menuEl = el;
  clampBox(el, ev.clientX, ev.clientY);
  el.style.visibility = '';
  armPlanFly(el, latlng, targetMap);
  el.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (!act) return;
    closeMenu();
    if (act === 'parcel') {
      openParcelAt(latlng, targetMap, { revealPlan: true }).then(ok => {
        if (ok === false) showToast('Không có thửa đất tại vị trí này.', 'info');
      });
    } else if (act === 'plan') {
      openPlanAt(latlng, targetMap);
    } else if (act === 'access') {
      inspectAccessAt(latlng.lat, latlng.lng, targetMap);
    } else if (act === 'place') {
      openPlace(ev, latlng);
    } else if (act === 'note') {
      openNoteEditor(ev, { lat: latlng.lat, lng: latlng.lng });
    } else if (act === 'dist') {
      startMeasure('distance', latlng, targetMap);
    } else if (act === 'area') {
      startMeasure('area', latlng, targetMap);
    } else if (act === 'sv') {
      openStreetView(latlng, targetMap);
    }
  });
}

function onSketchDom(target) {
  return !!target?.closest?.('.sketch-handle, .sketch-menu, .sketch-popup');
}

function onContext(e, m) {
  const raw = e.originalEvent;
  raw?.preventDefault();
  // Chạm ngắn trên điện thoại cũng phát contextmenu. Chỉ nhận cú máy tính hoặc cú giữ yên 1,5 giây.
  if (raw && !raw._qhLong && (raw.pointerType === 'touch' || raw.pointerType === 'pen' || raw._qhTouch)) return;
  const t = raw?.target;
  if (t?.closest?.('.leaflet-popup, .cad-card, .map-ctx-menu, .place-card, .note-editor, .sv-panel')) return;
  if (onSketchDom(t)) return;
  if (e.originalEvent?._sketchHandled || e.originalEvent?._measureHandled) return;
  if (consumeMeasureContext()) return;
  if (state.adminDrawMode || state.lotShapeEdit) return;
  openMenu(e.originalEvent, e.latlng, m);
}

function bindLongPress(m) {
  const box = m.getContainer();
  let timer = 0;
  let x = 0;
  let y = 0;
  let pid = null;
  let armed = false;
  let opened = false;
  let touchGesture = false;
  let touchClear = 0;
  const cancel = () => {
    clearTimeout(timer);
    timer = 0;
    pid = null;
    armed = false;
    window.removeEventListener('pointermove', onMove, true);
  };
  const onMove = (ev) => {
    if (!armed || ev.pointerId !== pid) return;
    if (Math.hypot(ev.clientX - x, ev.clientY - y) > LONG_SLOP) cancel();
  };
  box.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse' || ev.button !== 0) return;
    if (ev.target?.closest?.('.leaflet-popup, .sketch-handle, .sketch-menu, .sketch-popup')) return;
    cancel();
    opened = false;
    armed = true;
    touchGesture = true;
    clearTimeout(touchClear);
    x = ev.clientX;
    y = ev.clientY;
    pid = ev.pointerId;
    window.addEventListener('pointermove', onMove, true);
    timer = setTimeout(() => {
      timer = 0;
      if (!armed) return;
      if (state.adminDrawMode || state.lotShapeEdit || state.activeMeasureType) { cancel(); return; }
      opened = true;
      armed = false;
      const target = document.elementFromPoint(x, y) || box;
      const raw = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        view: window
      });
      raw._qhLong = true;
      target.dispatchEvent(raw);
    }, LONG_MS);
  });
  box.addEventListener('pointerup', (ev) => {
    if (ev.pointerId !== pid) return;
    if (opened) {
      ev.preventDefault();
      ev.stopPropagation();
      const stopClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        box.removeEventListener('click', stopClick, true);
      };
      box.addEventListener('click', stopClick, true);
      setTimeout(() => box.removeEventListener('click', stopClick, true), 400);
    }
    cancel();
    clearTimeout(touchClear);
    touchClear = setTimeout(() => { touchGesture = false; }, 800);
  });
  box.addEventListener('pointercancel', () => {
    cancel();
    clearTimeout(touchClear);
    touchClear = setTimeout(() => { touchGesture = false; }, 800);
  });
  box.addEventListener('contextmenu', (ev) => {
    if (ev._qhLong) return;
    if (!touchGesture && ev.pointerType !== 'touch' && ev.pointerType !== 'pen') return;
    ev._qhTouch = true;
    ev.preventDefault();
    ev.stopPropagation();
  }, true);
  m.on('movestart', cancel);
}

export function initMapContext(list) {
  loadNotes();
  (list || mapsOf()).filter(Boolean).forEach(m => {
    m.on('contextmenu', (e) => onContext(e, m));
    m.on('movestart', closeMenu);
    bindLongPress(m);
  });
  drawNotes();
  document.addEventListener('pointerdown', (e) => {
    if (menuEl && !menuEl.contains(e.target) && !menuEl._fly?.contains(e.target)) closeMenu();
    if (placeEl && !placeEl.contains(e.target)) closePlace();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (menuEl) { closeMenu(); e.stopPropagation(); }
    else if (noteEditor) closeNoteEditor(false);
    else if (placeEl) closePlace();
  });
}
