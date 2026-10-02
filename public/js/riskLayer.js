// Lọc công trình chịu rủi ro: số mùa lũ bị ngập (Sentinel-1, mọi năm đã có dữ liệu) và nhiệt độ bề mặt mùa nóng gần nhất
// (Landsat) trong vòng 30 m quanh từng công trình, gồm cả đề xuất, quy hoạch mới và quỹ đất (cơ sở chưa sử dụng).
// Máy chủ tính từng năm (api/gee.js › getInfraRisk); trình duyệt gọi song song rồi cộng dồn. Chỉ tải khi bật lớp.
import { map, flyToVisible } from './mapEngine.js';
import { planMap } from './planMap.js';
import { state, infraLabels, BUFFER_COLORS, layerType, getPlanScenarioList } from './state.js';
import { geeApi } from './api.js';
import { escapeHtml, fmtNum, ico, isApproved } from './utils.js';
import { sarSeasons, lstSeasons } from './satLayers.js';

const $ = (id) => document.getElementById(id);
const MAX_LIST = 150;
const RING = { flood: '#38bdf8', heat: '#fb923c', both: '#e879f9' };

let riskPromise = null;
let left = null, right = null;
let shown = [];
let visible = false;

async function getJson(query) {
  const r = await fetch(geeApi(query));
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || d.error) throw new Error((d && d.message) || `HTTP ${r.status}`);
  return d;
}

const median = (arr) => {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** { floodYears: [năm đã tính], flood: Map(id → số mùa ngập), lstYear, lst: Map(id → °C), lstMedian, failed } — tải 1 lần */
export function loadInfraRisk() {
  if (riskPromise) return riskPromise;
  const sar = sarSeasons(), lst = lstSeasons();
  const years = sar.years.filter(y => y <= sar.def).sort((a, b) => a - b);
  riskPromise = Promise.all([
    Promise.allSettled(years.map(y => getJson(`action=getInfraRisk&kind=flood&year=${y}`))),
    getJson(`action=getInfraRisk&kind=lst&year=${lst.def}`).catch(() => null)
  ]).then(([floodRes, lstRes]) => {
    const flood = new Map();
    const floodYears = [];
    floodRes.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      floodYears.push(years[i]);
      r.value.ids.forEach(id => flood.set(id, (flood.get(id) || 0) + 1));
    });
    if (!floodYears.length && !lstRes) throw new Error('máy chủ chưa trả được số liệu rủi ro');
    const lstMap = new Map(Object.entries((lstRes && lstRes.vals) || {}));
    return {
      floodYears, flood, failed: years.length - floodYears.length,
      lstYear: lstRes ? lstRes.year : null, lst: lstMap, lstMedian: median([...lstMap.values()])
    };
  });
  riskPromise.catch(() => { riskPromise = null; });
  return riskPromise;
}

/** Đã bật lọc rủi ro ít nhất 1 lần → Promise số liệu (popup công trình hiện thêm dòng rủi ro), chưa → null */
export const peekInfraRisk = () => riskPromise;

const floodRange = (d) => (d.floodYears.length ? `${d.floodYears[0]}–${d.floodYears[d.floodYears.length - 1]}` : '');

/** Nội dung dòng "Rủi ro khí hậu" trong popup công trình */
export function riskSummaryHtml(p, d) {
  const parts = [];
  if (d.floodYears.length) {
    const n = d.flood.get(p.id) || 0;
    parts.push(n
      ? `<span class="c-red">Ngập ${n}/${d.floodYears.length} mùa lũ</span> <span class="pp-sub">(${floodRange(d)}, trong vòng 30 m)</span>`
      : `<span class="c-green">Không ghi nhận ngập</span> <span class="pp-sub">(${d.floodYears.length} mùa lũ ${floodRange(d)})</span>`);
  }
  const v = d.lst.get(p.id);
  if (v != null) {
    const delta = d.lstMedian == null ? null : Math.round((v - d.lstMedian) * 10) / 10;
    const cls = delta != null && delta >= 2 ? 'c-orange' : '';
    parts.push(`<span class="${cls}">Nhiệt bề mặt ${fmtNum(v)} °C</span>${delta == null ? '' : ` <span class="pp-sub">(${delta >= 0 ? '+' : ''}${fmtNum(delta)} °C so với mức chung các công trình, mùa nóng ${d.lstYear})</span>`}`);
  }
  return parts.join('<br>') || '<span class="pp-sub">Chưa có số liệu tại vị trí này</span>';
}

// ---------- Lọc ----------
function filters() {
  return {
    group: $('riskGroup')?.value || 'all',
    flood: Number($('riskFlood')?.value) || 0,
    heat: Number($('riskHeat')?.value) || 0
  };
}

function riskOf(it, d, f) {
  const n = d.flood.get(it.id) || 0;
  const v = d.lst.get(it.id);
  const delta = v != null && d.lstMedian != null ? v - d.lstMedian : null;
  const isFlood = f.flood > 0 && n >= f.flood;
  const isHeat = f.heat > 0 && delta != null && delta >= f.heat;
  return (isFlood || isHeat) ? { it, n, v, delta, kind: isFlood && isHeat ? 'both' : isFlood ? 'flood' : 'heat' } : null;
}

function matchList(list, d, f) {
  return list
    .filter(it => it.id && Number.isFinite(Number(it.lat)) && Number.isFinite(Number(it.lng)) && (f.group === 'all' || layerType(it) === f.group))
    .map(it => riskOf(it, d, f))
    .filter(Boolean)
    .sort((a, b) => (b.n - a.n) || ((b.delta ?? -99) - (a.delta ?? -99)));
}

function drawRings(group, matches) {
  group.clearLayers();
  matches.forEach(m => group.addLayer(L.circleMarker([Number(m.it.lat), Number(m.it.lng)], {
    radius: 12, color: RING[m.kind], weight: 2.5, opacity: 0.95, dashArray: '4,3', fill: true, fillColor: RING[m.kind], fillOpacity: 0.12, interactive: false
  })));
}

function statsHtml(matches, d, f) {
  const nFlood = matches.filter(m => m.kind !== 'heat').length;
  const nHeat = matches.filter(m => m.kind !== 'flood').length;
  const rows = matches.slice(0, MAX_LIST).map((m, i) => {
    const color = BUFFER_COLORS[layerType(m.it)] || '#94a3b8';
    const badges = [
      m.n ? `<small class="risk-badge risk-flood" title="Số mùa lũ bị ngập">${ico('flood')}${m.n}/${d.floodYears.length}</small>` : '',
      m.v != null && m.delta != null && m.delta >= 1 ? `<small class="risk-badge risk-heat" title="Nhiệt độ bề mặt mùa nóng ${d.lstYear}">${ico('thermo')}${fmtNum(m.v)}°</small>` : ''
    ].join('');
    const pending = isApproved(m.it.status) ? '' : ' <small class="c-muted">(chờ duyệt)</small>';
    return `<button type="button" class="flood-row risk-row" data-i="${i}" title="${escapeHtml(infraLabels[layerType(m.it)] || '')} — phóng tới công trình">
      <i style="background:${color}"></i><span>${escapeHtml(m.it.name || 'Công trình')}${pending}</span>${badges}</button>`;
  }).join('');
  const kpi = [];
  if (f.flood) kpi.push(`<div class="flood-kpi"><span>Ngập ≥ ${f.flood}/${d.floodYears.length} mùa lũ</span><b class="risk-k-flood">${fmtNum(nFlood)} công trình</b></div>`);
  if (f.heat) kpi.push(`<div class="flood-kpi"><span>Nóng hơn mức chung ≥ ${f.heat} °C</span><b class="risk-k-heat">${fmtNum(nHeat)} công trình</b></div>`);
  const notes = [];
  if (d.failed) notes.push(`${d.failed} mùa lũ chưa tải được, số mùa ngập có thể thấp hơn thực tế.`);
  if (d.lstMedian != null) notes.push(`Mức chung = trung vị nhiệt bề mặt các công trình: ${fmtNum(Math.round(d.lstMedian * 10) / 10)} °C (mùa nóng ${d.lstYear}).`);
  notes.push('Vòng xanh: ngập · cam: nóng · tím: cả hai. Radar khó thấy ngập giữa nhà cửa dày đặc, số mùa ngập ở khu đô thị là cận dưới.');
  return `${kpi.join('')}
    ${rows ? `<div class="flood-list">${rows}</div>` : '<div class="flood-muted">Không có công trình vượt ngưỡng đã chọn.</div>'}
    ${matches.length > MAX_LIST ? `<div class="flood-muted">... và ${matches.length - MAX_LIST} công trình khác</div>` : ''}
    ${notes.map(n => `<div class="flood-muted">${escapeHtml(n)}</div>`).join('')}`;
}

async function render() {
  const statsEl = $('riskStats');
  if (!visible) return;
  if (statsEl && !peekInfraRisk()) statsEl.innerHTML = '<div class="flood-muted">Đang tính trên Google Earth Engine (lần đầu có thể mất 30–60 giây)...</div>';
  let d;
  try {
    d = await loadInfraRisk();
  } catch (err) {
    if (statsEl) statsEl.innerHTML = `<div class="flood-muted">Chưa tính được rủi ro: ${escapeHtml(err.message)}</div>`;
    return;
  }
  if (!visible) return;
  const f = filters();
  const byId = new Map();
  [...state.rawDataList, ...state.planDataList].forEach(it => { if (it.id && !byId.has(it.id)) byId.set(it.id, it); });
  const matches = matchList([...byId.values()], d, f);
  shown = matches;
  drawRings(left, matchList(state.rawDataList, d, f));
  if (planMap) {
    if (!right) right = L.layerGroup();
    if (!planMap.hasLayer(right)) right.addTo(planMap);
    drawRings(right, matchList(getPlanScenarioList(), d, f));
  }
  if (statsEl) statsEl.innerHTML = statsHtml(matches, d, f);
}

function setVisible(on) {
  visible = !!on;
  const box = $('riskBox');
  if (box) box.style.display = visible ? '' : 'none';
  if (visible) {
    left.addTo(map);
    render();
  } else {
    left.remove();
    right?.remove();
  }
}

export function initRiskLayer() {
  if (!map) return;
  left = L.layerGroup();
  const sel = $('riskGroup');
  if (sel) {
    const codes = Object.keys(infraLabels).filter(k => !['10-BUS', '11-PCCC', '12-NT'].includes(k));
    sel.innerHTML = `<option value="all">Mọi nhóm hạ tầng</option>`
      + codes.map(k => `<option value="${k}">${escapeHtml(infraLabels[k])}${k === '9-CSD' ? ' (quỹ đất)' : ''}</option>`).join('');
  }
  $('chk_risk')?.addEventListener('change', (e) => setVisible(e.target.checked));
  ['riskGroup', 'riskFlood', 'riskHeat'].forEach(id => $(id)?.addEventListener('change', render));
  $('riskStats')?.addEventListener('click', (e) => {
    const row = e.target.closest('.risk-row');
    const m = row && shown[Number(row.dataset.i)];
    if (m) flyToVisible([Number(m.it.lat), Number(m.it.lng)], 17);
  });
}
