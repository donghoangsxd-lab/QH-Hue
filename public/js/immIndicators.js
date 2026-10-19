// Bảng chỉ tiêu hình thái theo phường (trang chỉ tiêu dưới bản đồ). Số liệu public/data/imm.json,
// dựng bằng scripts/build-imm.js từ OpenStreetMap. Chọn một chỉ tiêu để tô choropleth.
import { map, highlightWardBoundary } from './mapEngine.js';
import { state } from './state.js';
import { escapeHtml, fmtNum } from './utils.js';

const LOW = [254, 243, 199];
const HIGH = [22, 101, 52];
let doc = null;
let load = null;
let indicator = 'bldgCover';
let layer = null;
let active = false;

const $ = (id) => document.getElementById(id);

async function data() {
  if (doc) return doc;
  if (!load) {
    load = fetch('data/imm.json')
      .then(async r => {
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || !Array.isArray(d.wards)) throw new Error('Không tải được chỉ tiêu hình thái.');
        doc = d;
        return d;
      })
      .catch(err => { load = null; throw err; });
  }
  return load;
}

function color(t) {
  const u = Math.min(1, Math.max(0, t));
  const c = LOW.map((v, i) => Math.round(v + (HIGH[i] - v) * u));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function valueOf(row) {
  const v = row[indicator];
  return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
}

function paint() {
  if (layer) { layer.remove(); layer = null; }
  if (!active || !map || !doc) return;
  const values = doc.wards.map(valueOf).filter(v => v != null);
  if (!values.length) return;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const byName = new Map(doc.wards.map(w => [w.name, w]));
  const features = (state.wardLabelsList || []).filter(w => w.geometry && byName.has(w.name)).map(w => ({
    type: 'Feature', geometry: w.geometry, properties: { name: w.name }
  }));
  if (!features.length) return;
  layer = L.geoJSON({ type: 'FeatureCollection', features }, {
    interactive: false,
    style: (f) => {
      const v = valueOf(byName.get(f.properties.name) || {});
      return {
        color: '#14532d', weight: 1, fillOpacity: v == null ? 0 : 0.55,
        fillColor: v == null ? '#94a3b8' : color((v - min) / span)
      };
    }
  }).addTo(map);
}

export function setImmVisible(on) {
  active = !!on;
  if (!active && layer) { layer.remove(); layer = null; }
  if (active) paint();
}

function tableHtml(d) {
  const meta = d.indicators.find(i => i.id === indicator) || d.indicators[0];
  const rows = d.wards.slice().sort((a, b) => (valueOf(b) ?? -1) - (valueOf(a) ?? -1) || a.name.localeCompare(b.name, 'vi'));
  const opts = d.indicators.map(i => `<option value="${i.id}"${i.id === indicator ? ' selected' : ''}>${escapeHtml(i.group)} · ${escapeHtml(i.name)}</option>`).join('');
  const body = rows.map(w => {
    const v = valueOf(w);
    return `<tr data-imm-ward="${escapeHtml(w.name)}"><td>${escapeHtml(w.name)}</td><td class="imm-num">${v == null ? '—' : fmtNum(v)}</td></tr>`;
  }).join('');
  const limits = (d.limits || []).map(t => `<li>${escapeHtml(t)}</li>`).join('');
  return `<div class="imm-bar">
      <label>Chỉ tiêu <select id="immPick">${opts}</select></label>
      <span>${escapeHtml(meta.unit)} · OSM ${escapeHtml(d.osmDate || '')}</span>
    </div>
    <p class="imm-src">${escapeHtml(meta.source)}</p>
    <div class="table-container imm-table"><table class="data-table">
      <thead><tr><th>Phường, xã</th><th>${escapeHtml(meta.unit)}</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    <details class="imm-limits"><summary>Nguồn và giới hạn</summary><p>${escapeHtml(d.framework)}</p><ul>${limits}</ul></details>`;
}

export async function renderImm(el) {
  if (!el) return;
  if (!doc) el.innerHTML = '<div class="rp-empty">Đang tải chỉ tiêu hình thái...</div>';
  try {
    const d = await data();
    if (!el.isConnected) return;
    el.innerHTML = tableHtml(d);
    paint();
  } catch (err) {
    el.innerHTML = `<div class="rp-empty">${escapeHtml(err.message || 'Không tải được chỉ tiêu.')}</div>`;
  }
}

export function initImmEvents(el, rerender) {
  el?.addEventListener('change', (e) => {
    if (e.target.id !== 'immPick') return;
    indicator = e.target.value;
    rerender();
  });
  el?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-imm-ward]');
    if (!row) return;
    highlightWardBoundary(row.dataset.immWard, { fitView: true });
  });
}
