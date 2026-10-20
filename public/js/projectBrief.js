// Bảng nhỏ khi mở một đồ án (góc dưới trái; panel dưới mở thì lên góc trên trái): diện tích ranh, dân số, số lần và diện tích điều chỉnh cục bộ,
// phần diện tích đã có QHPK (chỉ QHC) và đã có QHCT (QHC, QHPK). Diện tích con là hợp các ranh cắt theo đồ án đang mở,
// nên chỗ chồng nhau chỉ tính một lần. Ẩn khi bỏ chọn đồ án.
import { state } from './state.js';
import { PLAN_LEVELS, planLevelOf } from './generalPlan.js';
import { PROJECT_INFO_EVENT } from './projectFiles.js';
import { PROJECT_UNFOCUS_EVENT, inspectPeers, selectInspectPeer } from './projectLayer.js';
import { projectPopulation, PROJECT_POP_EVENT } from './projectReview.js';
import { adjustmentsOf, adjustmentsKnown, ADJUST_CHANGE_EVENT } from './adjustLayer.js';
import { escapeHtml, fmtNum, fmtPct } from './utils.js';

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

const PHONE_LAYOUT = window.matchMedia('(max-width: 840px), ((pointer: coarse) and (max-height: 500px) and (max-width: 1200px))');

function briefBesideInvest() {
  const invest = document.getElementById('investCard');
  return !PHONE_LAYOUT.matches && !!(invest && !invest.hidden);
}

function syncBriefStack() {
  const host = document.getElementById('mapArea');
  const el = document.getElementById('projectBrief');
  if (!host || !el) return;
  const h = el.hidden || briefBesideInvest() ? 0 : el.offsetHeight;
  host.style.setProperty('--brief-stack', h ? `${h + 8}px` : '0px');
}

function shareLabel(share) {
  if (!share) return WAIT;
  if (share.bare) return share.bare;
  return `${ha(share.used)} ha · ${fmtPct(share.pct)}`;
}

function peerBar(name) {
  const peers = inspectPeers();
  if (peers.length < 2 || !peers.some(p => p.name === name)) return '';
  return `<div class="project-brief-peers">${peers.map(p => {
    const on = p.name === name;
    const label = `${p.level} ${p.short || p.name}`;
    return `<button type="button" class="project-brief-peer${on ? ' is-on' : ''}" data-brief-peer="${escapeHtml(p.name)}" aria-pressed="${on ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
  }).join('<span class="project-brief-peer-sep" aria-hidden="true">·</span>')}</div>`;
}

function render(card) {
  const el = document.getElementById('projectBrief');
  if (!el) return;
  const level = PLAN_LEVELS.find(item => item.key === card.level);
  const area = card.hostM2 > 0 ? `${ha(card.hostM2)}<small>ha</small>` : '—';
  const count = card.adjN == null ? '' : `${fmtNum(card.adjN)} lần · `;
  const adjustShare = card.adjN == null ? null : shareOf(card.adjM2, card.hostM2);
  const adjustValue = card.adjN == null ? WAIT : `${count}${shareLabel(adjustShare)}`;
  const list = [meterRow('Điều chỉnh cục bộ', 'Số lần và tổng diện tích điều chỉnh cục bộ', adjustValue, adjustShare, 'adjust')];
  if (card.level === 'QHC') {
    list.push(meterRow('Đã có QHPK', 'Tổng diện tích khu vực đã có QHPK', shareLabel(shareOf(card.qhpkM2, card.hostM2)), shareOf(card.qhpkM2, card.hostM2), 'cover'));
  }
  if (card.level === 'QHC' || card.level === 'QHPK') {
    list.push(meterRow('Đã có QHCT', 'Tổng diện tích khu vực đã có QHCT', shareLabel(shareOf(card.qhctM2, card.hostM2)), shareOf(card.qhctM2, card.hostM2), 'cover'));
  }
  el.dataset.level = card.level || '';
  el.hidden = false;
  el.innerHTML = `<div class="project-brief-head">
      <h2 class="project-brief-name"><span class="project-brief-level">${escapeHtml(level ? level.label : card.level)}</span>${escapeHtml(card.name)}</h2>
      <button type="button" class="project-brief-close" data-brief-close aria-label="Ẩn bảng thông tin">×</button>
    </div>
    ${peerBar(card.name)}
    <div class="project-brief-hero"><span>Diện tích quy hoạch</span><strong>${area}</strong></div>
    <div class="project-brief-pops"><span>Hiện trạng <b>${peopleHtml(card.pop.ht)}</b></span><span>Quy hoạch <b>${peopleHtml(card.pop.qh)}</b></span></div>
    <div class="project-brief-meters">${list.join('')}</div>`;
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

async function show(name) {
  const project = String(name || '').trim();
  if (!project) { hide(); return; }
  const token = ++seq;
  openName = project;
  const entry = entryOf(project);
  const level = planLevelOf(project);
  const hostM2 = areaM2(entry && entry.boundary);
  const pop = projectPopulation(project);
  const known = adjustmentsKnown();
  const adjs = known ? adjustmentsOf(project) : null;
  const base = {
    name: project, level, hostM2, pop,
    adjN: adjs ? adjs.length : null, adjM2: null, qhpkM2: null, qhctM2: null
  };
  render(base);
  const adjM2 = adjs ? await clippedArea(adjs.map(it => it.boundary), entry && entry.boundary, token, false) : null;
  if (token !== seq) return;
  if (adjs) render({ ...base, adjN: adjs.length, adjM2 });
  const qhpkM2 = level === 'QHC' ? await coveredM2(entry, 'QHPK', token) : null;
  if (token !== seq) return;
  const qhctM2 = level === 'QHC' || level === 'QHPK' ? await coveredM2(entry, 'QHCT', token) : null;
  if (token !== seq) return;
  render({ ...base, adjN: adjs ? adjs.length : null, adjM2, qhpkM2, qhctM2 });
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
    const peer = e.target.closest('[data-brief-peer]');
    if (peer && !peer.classList.contains('is-on')) selectInspectPeer(peer.getAttribute('data-brief-peer'));
  });
  document.addEventListener(PROJECT_INFO_EVENT, (e) => show(e.detail));
  document.addEventListener(PROJECT_UNFOCUS_EVENT, hide);
  document.addEventListener(ADJUST_CHANGE_EVENT, () => { if (openName) show(openName); });
  document.addEventListener(PROJECT_POP_EVENT, (e) => { if (e.detail === openName) show(openName); });
  const syncStack = () => syncBriefStack();
  new ResizeObserver(syncStack).observe(el);
  new MutationObserver(syncStack).observe(host, { subtree: true, attributes: true, attributeFilter: ['hidden'], childList: true });
  PHONE_LAYOUT.addEventListener('change', syncStack);
  syncStack();
}
