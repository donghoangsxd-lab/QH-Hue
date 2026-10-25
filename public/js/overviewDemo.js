// Trình diễn trực tiếp trên bản đồ (Giới thiệu tổng quan): chuỗi cảnh, mỗi cảnh tự thao tác giao diện như người dùng
// (bấm ô tick, kéo thanh trượt, chuyển bản đồ hiện trạng / quy hoạch, phóng tới) kèm thẻ thuyết minh nổi trên bản đồ.
// Kết thúc / thoát / lùi cảnh trả ô tick, thanh trượt, nút công cụ, chế độ bản đồ về như trước khi xem;
// «Giữ bản đồ» đóng thẻ, để nguyên bản đồ cho người dùng tự thao tác tiếp.
// Cảnh: { title, run?(d) — thao tác (có thể async, ghi số liệu vào d.data), text(d) — HTML thuyết minh, chỉ đọc d.data }.
// Lùi cảnh chạy lại run của các cảnh trước nên run phải tự đủ, không dựa vào text.
import { ico, escapeHtml } from './utils.js';
import { getViewMode, isSplitOn, setViewMode, setSplit } from './planMap.js';
import { flyToVisible, zoomToPoint } from './mapEngine.js';

const $ = (id) => document.getElementById(id);

export function flash(el) {
  if (!el) return;
  el.classList.remove('ov-flash');
  void el.offsetWidth;
  el.classList.add('ov-flash');
  setTimeout(() => el.classList.remove('ov-flash'), 2000);
}

const MAIN_TAB = { plan: 'quyhoach', urban: 'hanhchinh', infra: 'hatang' };
const PANE_HOME = { base: { main: 'hanhchinh', fold: 'axisBaseFold' }, env: { main: 'hatang', fold: 'axisEnvFold' } };

export function openLayerTab({ main, pane } = {}) {
  document.body.classList.remove('right-collapsed');
  const home = pane ? PANE_HOME[pane] : null;
  const tab = MAIN_TAB[main] || main || home?.main;
  if (tab) document.querySelector(`[data-main-tab="${tab}"]`)?.click();
  if (home?.fold === 'axisBaseFold') document.getElementById('btnDockBase')?.click();
  else if (home?.fold) {
    const fold = document.getElementById(home.fold);
    if (fold) fold.open = true;
  }
  if (main === 'xahoi' || main === 'infra') document.getElementById('xahoiTabs')?.scrollIntoView({ block: 'nearest' });
  if (main === 'quyhoach') document.getElementById('planPoints')?.scrollIntoView({ block: 'nearest' });
}

let card = null;
let demo = null;    // { def, idx, run, busy, snap, data }

const emptySnap = () => ({ checks: new Map(), ranges: new Map(), tools: new Map(), view: null });

function makeCtx(run) {
  const alive = () => !!demo && demo.run === run;
  const snap = demo.snap;
  return {
    alive,
    data: demo.data,
    wait: (ms) => new Promise(r => setTimeout(r, ms)),
    /** Bật / tắt ô tick lớp (mở đúng tab panel phải, làm nổi dòng) */
    check(id, tabs, on = true) {
      const chk = alive() && $(id);
      if (!chk) return;
      if (tabs) openLayerTab(tabs);
      if (!snap.checks.has(id)) snap.checks.set(id, chk.checked);
      if (chk.checked !== on) chk.click();
      const row = chk.closest('.layer-row') || chk;
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      flash(row);
    },
    /** Đặt thanh trượt như người dùng kéo (phát input + change) */
    range(id, value) {
      const el = alive() && $(id);
      if (!el) return;
      if (!snap.ranges.has(id)) snap.ranges.set(id, el.value);
      el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      flash(el.closest('.flood-box, .layer-row') || el);
    },
    /** Bấm nút công cụ bật / tắt; isOn(btn) đọc trạng thái hiện tại */
    press(id, isOn, on = true) {
      const btn = alive() && $(id);
      if (!btn) return;
      if (!snap.tools.has(id)) snap.tools.set(id, { was: isOn(btn), isOn });
      if (isOn(btn) !== on) btn.click();
      flash(btn);
    },
    /** 'HT' bản đồ hiện trạng / 'QH' bản đồ quy hoạch, tắt chia đôi */
    view(mode) {
      if (!alive()) return;
      if (!snap.view) snap.view = { view: getViewMode(), split: isSplitOn() };
      if (isSplitOn()) setSplit(false);
      if (getViewMode() !== mode) setViewMode(mode);
      flash($('mapTitle'));
    },
    fly(latlng, zoom) { if (alive()) flyToVisible(latlng, zoom, { duration: 1.2 }); },
    /** Phóng tới công trình / vị trí và mở bảng thông tin */
    point({ lat, lng, name }) { if (alive()) zoomToPoint(lat, lng, name || ''); }
  };
}

function restore(snap) {
  snap.tools.forEach(({ was, isOn }, id) => { const b = $(id); if (b && isOn(b) !== was) b.click(); });
  snap.ranges.forEach((value, id) => {
    const el = $(id);
    if (!el || el.value === value) return;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  [...snap.checks].reverse().forEach(([id, was]) => { const c = $(id); if (c && c.checked !== was) c.click(); });
  if (snap.view) {
    if (snap.view.split) {
      setViewMode(snap.view.view);
      setSplit(true);
    } else if (isSplitOn() || getViewMode() !== snap.view.view) {
      setSplit(false);
      setViewMode(snap.view.view);
    }
  }
}

function buildCard() {
  card = document.createElement('section');
  card.className = 'ovd-card';
  card.hidden = true;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-live', 'polite');
  document.body.appendChild(card);
  card.addEventListener('click', (e) => {
    const act = e.target.closest('[data-ovd]')?.dataset.ovd;
    if (!act || !demo) return;
    if (act === 'next') {
      if (demo.idx >= demo.def.scenes.length - 1) stopDemo();
      else play(demo.idx + 1);
    } else if (act === 'prev') goBack(demo.idx - 1);
    else if (act === 'keep') stopDemo({ keep: true });
    else stopDemo();
  });
  document.addEventListener('keydown', (e) => {
    if (!demo || card.hidden || e.target.closest?.('input, textarea, select')) return;
    if (e.key === 'Escape') stopDemo();
    else if (e.key === 'ArrowRight' && !demo.busy) card.querySelector('[data-ovd="next"]')?.click();
  });
}

function render(html) {
  const { def, idx, busy } = demo;
  const scenes = def.scenes;
  const last = idx === scenes.length - 1;
  card.innerHTML = `
    <header class="ovd-head">
      <span class="ovd-kicker">${ico('map')}Minh họa thao tác · ${escapeHtml(def.title)}</span>
      <button type="button" class="ovd-x" data-ovd="exit" title="Đóng và trả bản đồ về như trước (Esc)" aria-label="Đóng minh họa">${ico('close')}</button>
    </header>
    <ol class="ovd-dots" aria-hidden="true">${scenes.map((_, i) => `<li class="${i < idx ? 'done' : i === idx ? 'on' : ''}"></li>`).join('')}</ol>
    <h3 class="ovd-title"><span>Bước ${idx + 1}/${scenes.length}</span>${escapeHtml(scenes[idx].title)}</h3>
    <div class="ovd-text">${busy ? '<p class="ovd-busy">Đang thao tác trên bản đồ…</p>' : html}</div>
    <footer class="ovd-btns">
      <button type="button" class="ov-ghost" data-ovd="keep" title="Đóng chú thích, giữ nguyên bản đồ để tự thao tác">Giữ bản đồ</button>
      <button type="button" class="ov-ghost" data-ovd="prev"${idx && !busy ? '' : ' disabled'}>${ico('chev-left')}Trước</button>
      <button type="button" class="ov-primary" data-ovd="next"${busy ? ' disabled' : ''}
        title="${last ? 'Kết thúc, trả bản đồ về như trước' : 'Cảnh tiếp theo (phím →)'}">${last ? `${ico('check')}Kết thúc` : `Tiếp${ico('chev-right')}`}</button>
    </footer>`;
}

async function runScene(idx, run) {
  const scene = demo.def.scenes[idx];
  if (scene.run) await scene.run(makeCtx(run));
}

async function play(idx, replayFrom = idx) {
  const run = {};
  demo.run = run;
  demo.idx = idx;
  demo.busy = true;
  render('');
  let html;
  try {
    for (let i = replayFrom; i <= idx; i++) {
      await runScene(i, run);
      if (demo?.run !== run) return;
    }
    const { text } = demo.def.scenes[idx];
    html = typeof text === 'function' ? text(makeCtx(run)) : text;
  } catch (err) {
    console.warn('Trình diễn:', err);
    html = `<p class="c-orange">Không thực hiện được bước này: ${escapeHtml(err.message || String(err))}</p>`;
  }
  if (demo?.run !== run) return;
  demo.busy = false;
  render(html);
  card.querySelector('[data-ovd="next"]')?.focus({ preventScroll: true });
}

// Lùi cảnh: trả bản đồ về như trước khi xem rồi chạy lại thao tác các cảnh tới cảnh đích
function goBack(idx) {
  if (idx < 0 || demo.busy) return;
  restore(demo.snap);
  demo.snap = emptySnap();
  demo.data = {};
  play(idx, 0);
}

/** def: { title, scenes: [...] } */
export function startDemo(def) {
  if (!def?.scenes?.length) return;
  if (demo) stopDemo();
  if (!card) buildCard();
  demo = { def, idx: 0, run: null, busy: false, snap: emptySnap(), data: {} };
  card.hidden = false;
  play(0);
}

export function stopDemo({ keep = false } = {}) {
  if (!demo) return;
  const { snap } = demo;
  demo = null;
  if (!keep) restore(snap);
  card.hidden = true;
  card.innerHTML = '';
}
