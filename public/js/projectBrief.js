// Bảng thông tin đồ án: trên máy tính gắn vào #planBriefSlot trong panel Quy hoạch (danh sách đồ án dịch xuống);
// điện thoại vào #phoneInfoSlot. Diện tích ranh, dân số, điều chỉnh cục bộ, phần đã có QHPK / QHCT.
// Diện tích con là hợp các ranh cắt theo đồ án đang mở (chỗ chồng chỉ tính một lần). Ẩn khi bỏ chọn đồ án.
import { state } from './state.js';
import { PLAN_LEVELS, planLevelOf } from './generalPlan.js';
import { PROJECT_INFO_EVENT } from './projectFiles.js';
import { PROJECT_UNFOCUS_EVENT, inspectPeers, inspectHostArea, openInspectDecision } from './projectLayer.js';
import { projectPopulation, PROJECT_POP_EVENT, openProjectInfo } from './projectReview.js';
import { adjustmentsOf, adjustmentsKnown, adjustmentSiteCount, ADJUST_CHANGE_EVENT } from './adjustLayer.js';
import { splitProjectName } from './projectNames.js';
import { escapeHtml, fmtNum, fmtPct, ico } from './utils.js';
import { QHC2045, QHC_CENTER_INFO_EVENT } from './qhc2045.js';
import { loadQhc25Scale, qhcScaleBriefHtml } from './qhc25Scale.js';

const HA = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const WAIT = '<span class="project-brief-wait">…</span>';

let seq = 0;
let openName = '';
const coverCache = new Map();

const ha = (m2) => HA.format((Number(m2) || 0) / 10000);
const peopleHtml = (n) => (n > 0 ? `${fmtNum(n)}<small>người</small>` : '—');

function entryOf(name) {
  return (state.projectCatalog || []).find(p => p && p.tenQH === name) || null;
}

function areaM2(geom) {
  if (!geom || typeof turf === 'undefined') return 0;
  try { return turf.area(turf.feature(geom)); } catch (e) { return 0; }
}

function boxesOverlap(a, b) {
  return a && b && a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

function clipGeom(geom, mask) {
  if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) return null;
  if (!mask) return geom;
  if (typeof turf === 'undefined') return null;
  try {
    const piece = turf.feature(geom);
    const host = turf.feature(mask);
    if (!turf.booleanIntersects(piece, host)) return null;
    const hit = turf.intersect(piece, host);
    return hit && hit.geometry ? hit.geometry : null;
  } catch (e) { return null; }
}

// turf 6 hay vỡ vòng khi hợp ranh chi tiết; làm tròn rồi thử lại, vẫn lỗi thì bỏ mảnh đó
function safeUnion(a, b) {
  try { return turf.union(a, b) || a; } catch (e) { /* thử lại với tọa độ làm tròn */ }
  for (const precision of [6, 5]) {
    try {
      return turf.union(turf.truncate(a, { precision }), turf.truncate(b, { precision })) || a;
    } catch (err) { /* giảm độ chính xác */ }
  }
  return a;
}

async function unionArea(geoms, token, simplify) {
  let acc = null;
  for (let i = 0; i < geoms.length; i += 1) {
    if (token !== seq) return 0;
    let feature = null;
    try {
      feature = simplify
        ? turf.simplify(turf.feature(geoms[i]), { tolerance: 0.00005, highQuality: false })
        : turf.feature(geoms[i]);
    } catch (e) { feature = null; }
    if (!feature || !feature.geometry) continue;
    acc = acc ? safeUnion(acc, feature) : feature;
    if (i % 6 === 5) await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (!acc || token !== seq) return 0;
  try { return turf.area(acc); } catch (e) { return 0; }
}

async function clippedArea(geoms, mask, token, simplify) {
  const parts = [];
  (geoms || []).forEach(geom => {
    const hit = clipGeom(geom, mask);
    if (hit) parts.push(hit);
  });
  if (!parts.length || typeof turf === 'undefined') return 0;
  if (parts.length === 1) return areaM2(parts[0]);
  return unionArea(parts, token, simplify);
}

function childrenOf(host, level) {
  const box = host && host.bbox;
  return (state.projectCatalog || []).filter(p => {
    if (!p || !p.boundary || !host || p.tenQH === host.tenQH) return false;
    if (planLevelOf(p.tenQH) !== level) return false;
    return boxesOverlap(box, p.bbox) || !box || !p.bbox;
  });
}

async function coveredM2(host, level, token) {
  if (!host || !host.boundary) return 0;
  const kids = childrenOf(host, level);
  const key = `${host.tenQH}|${level}|${kids.map(p => `${p.tenQH}:${(p.bbox || []).join(',')}`).join('|')}`;
  if (coverCache.has(key)) return coverCache.get(key);
  const m2 = await clippedArea(kids.map(p => p.boundary), host.boundary, token, true);
  if (token === seq) coverCache.set(key, m2);
  return m2;
}

function shareOf(part, whole) {
  if (part == null) return null;
  if (!(whole > 0)) return { bare: part > 0 ? `${ha(part)} ha` : '—' };
  const used = Math.min(part, whole);
  return { used, whole, pct: used / whole * 100 };
}

function meterBar(share) {
  if (!share || !(share.pct > 0)) return '';
  const width = Math.min(100, Math.max(share.pct, 1.5));
  return `<div class="project-brief-track"><i style="--meter:${width}%"></i></div>`;
}

function meterRow(label, title, value, share, tone) {
  const on = !!(share && share.pct > 0);
  const klass = share ? (on ? ' is-on' : ' is-zero') : '';
  return `<div class="project-brief-meter${klass}" data-tone="${tone}" title="${escapeHtml(title)}">
      <div class="project-brief-meter-top"><span>${label}</span><b>${value}</b></div>${meterBar(share)}</div>`;
}

const PHONE_LAYOUT = window.matchMedia('(max-width: 840px), ((pointer: coarse) and (max-height: 560px) and (max-width: 1400px))');

function briefOnMap(el) {
  const host = el?.parentElement;
  return !!(el && !el.hidden && host && (host.id === 'mapArea' || host.classList?.contains('leaflet-container')));
}

function syncBriefStack() {
  const root = document.documentElement;
  const brief = document.getElementById('projectBrief');
  // Brief đã gắn trong panel trục không đẩy cột bảng nổi trên bản đồ.
  const rows = [
    [document.querySelector('.urban-focus-bar'), '--stack-urban'],
    [document.querySelector('.ovd-card'), '--stack-demo'],
    [briefOnMap(brief) ? brief : null, '--stack-brief']
  ];
  let y = 0;
  rows.forEach(([el, key]) => {
    root.style.setProperty(key, `${y}px`);
    const h = el && !el.hidden ? el.offsetHeight : 0;
    if (h > 2) y += h + 8;
  });
  root.style.setProperty('--brief-stack', `${y}px`);
  const invest = document.getElementById('investCard');
  const investOn = !!(invest && !invest.hidden && invest.offsetHeight > 2);
  const col = PHONE_LAYOUT.matches ? '0px' : (y > 0 || investOn ? (investOn ? '408px' : '336px') : '0px');
  root.style.setProperty('--info-col', col);
}

function shareLabel(share) {
  if (!share) return WAIT;
  if (share.bare) return share.bare;
  return `${ha(share.used)} ha · ${fmtPct(share.pct)}`;
}

/** Tên cạnh tem cấp: bỏ tiền tố trùng QHPK/QHCT; override «QHPK TT phía Nam» → Trung tâm phía Nam TP Huế. */
function briefTitle(name) {
  const split = splitProjectName(name);
  let title = split.tenDayDu || split.tenRutGon || name;
  title = String(title || '')
    .replace(/^Quy hoạch\s+(phân khu|chi tiết|chung)(\s+tỷ lệ\s+1\/[\d.]+)?\s+/i, '')
    .replace(/^(QHPK|QHCT|QHC)\b[\s.:–—-]*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return title || name;
}

function metersOf(card) {
  const count = card.adjN == null ? '' : `${fmtNum(card.adjN)} vị trí · `;
  const adjustShare = card.adjN == null ? null : shareOf(card.adjM2, card.hostM2);
  const adjustValue = card.adjN == null ? WAIT : `${count}${shareLabel(adjustShare)}`;
  const list = [];
  if (card.lookupM2 > 0) {
    const inside = shareOf(card.overlapM2, card.lookupM2);
    list.push(meterRow('Trong vùng tra cứu', 'Phần diện tích vùng đang tra cứu nằm trong đồ án', shareLabel(inside), inside, 'cover'));
  }
  list.push(meterRow(
    'Điều chỉnh cục bộ',
    'Số vị trí và tổng diện tích điều chỉnh cục bộ. Số lần = số quyết định khác nhau; mỗi quyết định có thể gồm nhiều vị trí.',
    adjustValue,
    adjustShare,
    'adjust'
  ));
  if (card.level === 'QHC') {
    list.push(meterRow('Đã có QHPK', 'Tổng diện tích khu vực đã có QHPK', shareLabel(shareOf(card.qhpkM2, card.hostM2)), shareOf(card.qhpkM2, card.hostM2), 'cover'));
  }
  if (card.level === 'QHC' || card.level === 'QHPK') {
    list.push(meterRow('Đã có QHCT', 'Tổng diện tích khu vực đã có QHCT', shareLabel(shareOf(card.qhctM2, card.hostM2)), shareOf(card.qhctM2, card.hostM2), 'cover'));
  }
  return list;
}

function briefTools(card, { pdf = true, info = true } = {}) {
  const hasDecision = !!(card.entry && card.entry.decision);
  const pdfBtn = pdf
    ? `<button type="button" class="project-brief-tool" data-brief-pdf data-brief-name="${escapeHtml(card.name)}"${hasDecision ? '' : ' disabled'} title="${hasDecision ? 'Xem PDF quyết định phê duyệt' : 'Chưa có PDF quyết định'}" aria-label="Xem PDF quyết định">${ico('file')}</button>`
    : '';
  const infoBtn = info
    ? `<button type="button" class="project-brief-tool" data-brief-info data-brief-name="${escapeHtml(card.name)}" title="Xem bảng thông tin đồ án" aria-label="Xem bảng thông tin đồ án">${ico('table')}</button>`
    : '';
  return `<div class="project-brief-tools">
      ${pdfBtn}${infoBtn}
      <button type="button" class="project-brief-close" data-brief-close aria-label="Ẩn bảng thông tin">×</button>
    </div>`;
}

function popRows(pop) {
  const htTip = 'Dân số trong phạm vi đồ án ở thời điểm lập / điều chỉnh (số trong danh mục; nếu đã sửa trên máy này thì lấy số máy này).';
  const qhTip = 'Dân số dự báo theo quy hoạch của đồ án (cơ sở tính nhu cầu hạ tầng và số đơn vị ở).';
  return `<div class="project-brief-pops">
      <div class="project-brief-pop" title="${escapeHtml(htTip)}"><span>Dân số hiện trạng</span><b>${peopleHtml(pop.ht)}</b></div>
      <div class="project-brief-pop" title="${escapeHtml(qhTip)}"><span>Dân số quy hoạch</span><b>${peopleHtml(pop.qh)}</b></div>
    </div>`;
}

/** Brief đồ án QHC đô thị (1/25.000 và 1/10.000 trung tâm): chỉ tiêu QĐ 108/QĐ-TTg — cùng một đồ án, hai lớp bản đồ. */
function renderQhcCity(card) {
  const el = document.getElementById('projectBrief');
  if (!el) return;
  const level = PLAN_LEVELS.find(item => item.key === 'QHC');
  el.dataset.level = 'QHC';
  el.hidden = false;
  el.innerHTML = `<div class="project-brief-head">
      <h2 class="project-brief-name"><span class="project-brief-level">${escapeHtml(level ? level.label : 'QHC')}</span>${escapeHtml(QHC2045.short)}</h2>
      ${briefTools(card, { pdf: false, info: true })}
    </div>
    <p class="project-brief-sub" title="${escapeHtml(QHC2045.name)}">${escapeHtml(QHC2045.status)} · Lớp 1/25.000 và 1/10.000 trung tâm</p>
    <div class="project-brief-scale">${qhcScaleBriefHtml()}</div>`;
  syncBriefStack();
}

function render(card) {
  const el = document.getElementById('projectBrief');
  if (!el) return;
  if (card.qhcCity) {
    renderQhcCity(card);
    return;
  }
  const level = PLAN_LEVELS.find(item => item.key === card.level);
  const area = card.hostM2 > 0 ? `${ha(card.hostM2)}<small>ha</small>` : '—';
  const title = briefTitle(card.name);
  el.dataset.level = card.level || '';
  el.hidden = false;
  el.innerHTML = `<div class="project-brief-head">
      <h2 class="project-brief-name"><span class="project-brief-level">${escapeHtml(level ? level.label : card.level)}</span>${escapeHtml(title)}</h2>
      ${briefTools(card)}
    </div>
    <div class="project-brief-hero"><span>Diện tích quy hoạch</span><strong>${area}</strong></div>
    ${popRows(card.pop)}
    <div class="project-brief-meters">${metersOf(card).join('')}</div>`;
  syncBriefStack();
}

function itemHtml(card) {
  const level = PLAN_LEVELS.find(item => item.key === card.level);
  const area = card.hostM2 > 0 ? `${ha(card.hostM2)}<small>ha</small>` : '—';
  const title = briefTitle(card.name);
  const decision = card.decision
    ? `<button type="button" class="project-brief-decision" data-brief-decision="${escapeHtml(card.name)}">${escapeHtml(card.decision)}</button>`
    : '';
  return `<section class="project-brief-item">
      <h2 class="project-brief-name"><span class="project-brief-level">${escapeHtml(level ? level.label : card.level)}</span>${escapeHtml(title)}</h2>
      <div class="project-brief-hero"><span>Diện tích quy hoạch</span><strong>${area}</strong></div>
      <div class="project-brief-meters">${metersOf(card).join('')}</div>
      ${decision}
    </section>`;
}

function renderStack(cards) {
  const el = document.getElementById('projectBrief');
  if (!el || !cards.length) return;
  el.dataset.level = cards[0].level || '';
  el.hidden = false;
  el.innerHTML = `<div class="project-brief-head">
      <span class="project-brief-count">${fmtNum(cards.length)} đồ án cùng cấp</span>
      <button type="button" class="project-brief-close" data-brief-close aria-label="Ẩn bảng thông tin">×</button>
    </div>
    <div class="project-brief-stack">${cards.map(itemHtml).join('')}</div>`;
  syncBriefStack();
}

function hide() {
  seq += 1;
  openName = '';
  const el = document.getElementById('projectBrief');
  if (!el) return;
  el.hidden = true;
  el.innerHTML = '';
  syncBriefStack();
}

async function fillCover(card, token) {
  const entry = card.entry;
  if (card.adjs) card.adjM2 = await clippedArea(card.adjs.map(it => it.boundary), entry && entry.boundary, token, false);
  if (token !== seq) return;
  if (card.level === 'QHC') card.qhpkM2 = await coveredM2(entry, 'QHPK', token);
  if (token !== seq) return;
  if (card.level === 'QHC' || card.level === 'QHPK') card.qhctM2 = await coveredM2(entry, 'QHCT', token);
}

function cardFromPeer(peer) {
  const entry = entryOf(peer.name);
  const level = peer.level || planLevelOf(peer.name);
  const known = adjustmentsKnown();
  const adjs = known ? adjustmentsOf(peer.name) : null;
  return {
    name: peer.name, level, decision: peer.decision || '', entry, adjs,
    hostM2: areaM2(entry && entry.boundary),
    lookupM2: inspectHostArea(),
    overlapM2: Number(peer.overlapM2) || 0,
    adjN: adjs ? adjustmentSiteCount(adjs) : null, adjM2: null, qhpkM2: null, qhctM2: null
  };
}

async function showStack(peers) {
  const token = ++seq;
  openName = peers.map(p => p.name).join('\0');
  const cards = peers.map(cardFromPeer);
  renderStack(cards);
  await Promise.all(cards.map(card => fillCover(card, token)));
  if (token !== seq) return;
  renderStack(cards);
}

function isQhcStaticName(name) {
  const n = String(name || '').trim();
  if (!n) return false;
  if (n === QHC2045.short || n === QHC2045.name) return true;
  return /qhc đô thị TT\s*Huế 2045/i.test(n) || /qhc đô thị Thừa Thiên Huế/i.test(n);
}

async function show(name) {
  const project = String(name || '').trim();
  const peers = inspectPeers();
  if (project && peers.some(p => p.name === project)) return showStack(peers);
  if (!project) { hide(); return; }
  const token = ++seq;
  openName = project;
  // QHC đô thị 1/25.000 + 1/10.000 trung tâm: cùng đồ án → brief chỉ tiêu QĐ 108 (không đổi cấp bản đồ).
  if (isQhcStaticName(project)) {
    openName = QHC2045.short;
    render({ name: QHC2045.short, level: 'QHC', qhcCity: true, entry: null });
    try { await loadQhc25Scale(); } catch (e) { /* lỗi đã hiện trong khối chỉ tiêu */ }
    if (token !== seq) return;
    render({ name: QHC2045.short, level: 'QHC', qhcCity: true, entry: null });
    return;
  }
  const entry = entryOf(project);
  const level = planLevelOf(project);
  const hostM2 = areaM2(entry && entry.boundary);
  const pop = projectPopulation(project);
  const known = adjustmentsKnown();
  const adjs = known ? adjustmentsOf(project) : null;
  const base = {
    name: project, level, hostM2, pop, entry, adjs,
    adjN: adjs ? adjustmentSiteCount(adjs) : null, adjM2: null, qhpkM2: null, qhctM2: null
  };
  render(base);
  await fillCover(base, token);
  if (token !== seq) return;
  render(base);
}

export function initProjectBrief() {
  const host = document.getElementById('mapArea');
  if (!host || document.getElementById('projectBrief')) return;
  const el = document.createElement('aside');
  el.id = 'projectBrief';
  el.className = 'project-brief';
  el.hidden = true;
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Thông tin đồ án quy hoạch');
  host.appendChild(el);
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-brief-close]')) { hide(); return; }
    const pdf = e.target.closest('[data-brief-pdf]');
    if (pdf && !pdf.disabled) {
      openInspectDecision(pdf.getAttribute('data-brief-name'));
      return;
    }
    const info = e.target.closest('[data-brief-info]');
    if (info) {
      const n = info.getAttribute('data-brief-name');
      if (isQhcStaticName(n)) {
        document.dispatchEvent(new Event(QHC_CENTER_INFO_EVENT));
        return;
      }
      openProjectInfo(n);
      return;
    }
    const decision = e.target.closest('[data-brief-decision]');
    if (decision) openInspectDecision(decision.getAttribute('data-brief-decision'));
  });
  document.addEventListener(PROJECT_INFO_EVENT, (e) => show(e.detail));
  document.addEventListener(PROJECT_UNFOCUS_EVENT, hide);
  document.addEventListener(ADJUST_CHANGE_EVENT, () => {
    const peers = inspectPeers();
    if (peers.length && openName) show(peers[0].name);
    else if (openName) show(openName);
  });
  document.addEventListener(PROJECT_POP_EVENT, (e) => {
    const peers = inspectPeers();
    if (peers.some(p => p.name === e.detail)) show(peers[0].name);
    else if (e.detail === openName) show(openName);
  });
  const syncStack = () => syncBriefStack();
  new ResizeObserver(syncStack).observe(el);
  new MutationObserver(syncStack).observe(host, { subtree: true, attributes: true, attributeFilter: ['hidden'], childList: true });
  new MutationObserver(syncStack).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(syncStack).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  PHONE_LAYOUT.addEventListener('change', syncStack);
  window.addEventListener('resize', syncStack);
  syncStack();
}
