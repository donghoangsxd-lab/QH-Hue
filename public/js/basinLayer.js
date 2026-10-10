// Lớp "Lưu vực, đường phân thủy": drainage/luuvuc.topojson trên bucket (scripts/push-luuvuc.js, tính từ FABDEM cùng nguồn
// lớp thoát nước). 3 cấp: lưu vực sông (nét đứt trắng viền tối), tiểu lưu vực (nét đứt vàng), ô tiêu nước vùng thấp
// dưới +10 m (chấm xanh) — vùng thấp không có đường phân thủy địa hình đáng tin nên ranh lấy theo sông, kênh bao quanh.
// Cạnh chung của 2 vùng là 1 cung: vẽ 1 lần theo cấp cao nhất dùng cung đó.
// Nét không nhận click để bên trong lưu vực vẫn tra cứu bản đồ bình thường; bấm nhãn tên để xem thông tin và tô sáng lưu vực.
import { map } from './mapEngine.js';
import { planMap } from './planMap.js';
import { geeApi } from './api.js';
import { escapeHtml } from './utils.js';

const $ = (id) => document.getElementById(id);

const LEVELS = {
  1: {
    key: 'major', title: 'Lưu vực', short: 'LV', kind: 'Lưu vực sông', lineZoom: 0, labelZoom: 0,
    line: { color: '#f8fafc', weight: 2.4, dashArray: '9 6' },
    halo: { color: '#0f172a', opacity: 0.55, weight: 5 },
    note: 'Đường phân thủy tính từ cao độ nền FABDEM 30 m.'
  },
  2: {
    key: 'sub', title: 'Tiểu lưu vực', short: 'TLV', kind: 'Tiểu lưu vực', lineZoom: 11, labelZoom: 13,
    line: { color: '#facc15', weight: 1.5, dashArray: '5 5', opacity: 0.9 },
    halo: { color: '#0f172a', opacity: 0.4, weight: 3.5 },
    note: 'Đường phân thủy tính từ cao độ nền FABDEM 30 m.'
  },
  3: {
    key: 'low', title: 'Ô tiêu nước', short: 'Ô', kind: 'Ô tiêu nước vùng thấp', lineZoom: 0, labelZoom: 12,
    line: { color: '#38bdf8', weight: 2, dashArray: '1 5', opacity: 0.95 },
    note: 'Vùng thấp dưới +10 m: ranh theo sông, kênh bao quanh; nước tiêu ra các sông, kênh này qua cống, trạm bơm.'
  }
};

/** TopoJSON → { arcs: [[lat, lng]…], level: cấp cao nhất dùng mỗi cung (1 sông, 2 tiểu, 3 vùng thấp), basins } */
function decodeTopo(topo) {
  const tf = topo.transform;
  const arcs = (topo.arcs || []).map(arc => {
    let x = 0, y = 0;
    return arc.map(p => {
      if (!tf) return [p[1], p[0]];
      x += p[0]; y += p[1];
      return [y * tf.scale[1] + tf.translate[1], x * tf.scale[0] + tf.translate[0]];
    });
  });
  const level = new Array(arcs.length).fill(0);
  const obj = topo.objects && (topo.objects.data || Object.values(topo.objects)[0]);
  const basins = [];
  (obj && obj.geometries || []).forEach(g => {
    const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
    if (!polys.length) return;
    const p = g.properties || {};
    const cap = LEVELS[p.cap] ? Number(p.cap) : 2;
    polys.forEach(rings => rings.forEach(ring => ring.forEach(i => {
      const a = i < 0 ? ~i : i;
      if (!level[a] || cap < level[a]) level[a] = cap;
    })));
    basins.push({
      cap,
      polys,
      name: String(p.ten || ''),
      code: String(p.ma || ''),
      km2: Number(p.km2) || 0,
      parent: String(p.p || ''),
      subs: Number(p.n) || 0,
      zmin: p.z === undefined || p.z === null ? null : Number(p.z),
      lp: Array.isArray(p.lp) ? [p.lp[1], p.lp[0]] : null
    });
  });
  return { arcs, level, basins };
}

function ringLatLngs(arcs, ring) {
  const out = [];
  ring.forEach(i => {
    const a = arcs[i < 0 ? ~i : i];
    const seq = i < 0 ? a.slice().reverse() : a;
    seq.forEach((pt, k) => { if (k || !out.length) out.push(pt); });
  });
  return out;
}

const fmtKm2 = (v) => v.toLocaleString('vi-VN', { maximumFractionDigits: v < 10 ? 2 : 1 });
const titleOf = (b) => b.name || `${LEVELS[b.cap].title} ${b.code}`;
const labelOf = (b) => b.name || `${LEVELS[b.cap].short} ${b.code}`;

function popupHtml(b) {
  const lv = LEVELS[b.cap];
  const rows = [`${lv.kind} · ${fmtKm2(b.km2)} km²`];
  if (b.cap === 1 && b.subs) rows.push(`Gồm ${b.subs} tiểu lưu vực`);
  if (b.parent) rows.push(`Thuộc lưu vực ${escapeHtml(b.parent)}`);
  if (Number.isFinite(b.zmin)) rows.push(`Cao độ cửa xả ≈ ${b.zmin.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} m`);
  return `<div class="basin-popup"><b>${escapeHtml(titleOf(b))}</b><br>${rows.join('<br>')}`
    + `<div class="basin-note">${lv.note}</div></div>`;
}

let data = null;
let dataPromise = null;

function loadBasins() {
  if (data) return Promise.resolve(data);
  if (!dataPromise) {
    dataPromise = fetch(geeApi('action=getBasins'))
      .then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.message || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then(topo => { data = decodeTopo(topo); return data; })
      .catch(err => { dataPromise = null; throw err; });
  }
  return dataPromise;
}

/** Dựng nét + nhãn trên 1 bản đồ; trả về { remove } gỡ sạch layer và sự kiện */
function createView(m) {
  if (!m.getPane('basinPane')) {
    const pane = m.createPane('basinPane');
    pane.style.zIndex = '375';
    pane.style.pointerEvents = 'none';
  }
  // Dưới markerPane (600): biểu tượng công trình vẫn bấm được khi trùng nhãn
  if (!m.getPane('basinLabelPane')) m.createPane('basinLabelPane').style.zIndex = '590';
  const renderer = L.canvas({ pane: 'basinPane', padding: 0.3 });
  const line = (latlngs, style) => L.polyline(latlngs, { renderer, interactive: false, lineCap: 'round', lineJoin: 'round', ...style });
  const groups = {};
  Object.entries(LEVELS).forEach(([cap, lv]) => {
    const arcs = data.arcs.filter((_, i) => data.level[i] === Number(cap));
    groups[cap] = {
      lv,
      lines: arcs.length ? L.layerGroup([...(lv.halo ? [line(arcs, lv.halo)] : []), line(arcs, lv.line)]) : null,
      labels: L.layerGroup()
    };
  });
  const highlight = L.layerGroup();

  data.basins.forEach(b => {
    if (!b.lp) return;
    const lv = LEVELS[b.cap];
    const marker = L.marker(b.lp, {
      pane: 'basinLabelPane',
      keyboard: false,
      icon: L.divIcon({
        className: `basin-label basin-label-${lv.key}`,
        html: `<span title="${escapeHtml(titleOf(b))}">${escapeHtml(labelOf(b))}</span>`,
        iconSize: null
      })
    });
    marker.bindPopup(() => popupHtml(b), { maxWidth: 260 });
    marker.on('popupopen', () => {
      highlight.clearLayers();
      L.polygon(b.polys.map(rings => rings.map(r => ringLatLngs(data.arcs, r))), {
        renderer, interactive: false, color: lv.line.color, weight: lv.line.weight + 1.5, fillColor: lv.line.color, fillOpacity: 0.14
      }).addTo(highlight);
    });
    marker.on('popupclose', () => highlight.clearLayers());
    groups[b.cap].labels.addLayer(marker);
  });

  const toggle = (layer, on) => {
    if (!layer) return;
    if (on && !m.hasLayer(layer)) layer.addTo(m);
    else if (!on && m.hasLayer(layer)) m.removeLayer(layer);
  };
  const update = () => {
    const z = m.getZoom();
    Object.values(groups).forEach(g => {
      toggle(g.lines, z >= g.lv.lineZoom);
      toggle(g.labels, z >= g.lv.labelZoom);
    });
  };
  highlight.addTo(m);
  update();
  m.on('zoomend', update);

  return {
    remove() {
      m.off('zoomend', update);
      const all = Object.values(groups).flatMap(g => [g.lines, g.labels]).concat(highlight, renderer);
      all.forEach(l => { if (l && m.hasLayer(l)) m.removeLayer(l); });
    }
  };
}

let visible = false;
let leftView = null, rightView = null;

function setStatus(text) {
  const el = $('basinStatus');
  if (el) el.textContent = text;
}

function syncViews() {
  const on = visible && !!data && !!map;
  if (!on) {
    leftView?.remove(); leftView = null;
    rightView?.remove(); rightView = null;
    return;
  }
  if (!leftView) leftView = createView(map);
  if (planMap && !rightView) rightView = createView(planMap);
}

export function setBasinVisible(on) {
  visible = !!on;
  const legend = $('basinLegend');
  if (legend) legend.style.display = visible ? '' : 'none';
  if (!visible || data) {
    syncViews();
    setStatus(data && !data.basins.length ? 'File lưu vực trên bucket không có lưu vực nào' : '');
    return;
  }
  setStatus('Đang tải ranh lưu vực…');
  loadBasins().then(() => {
    setStatus(data.basins.length ? '' : 'File lưu vực trên bucket không có lưu vực nào');
    syncViews();
  }).catch(err => {
    console.warn('Không tải được ranh lưu vực:', err);
    setStatus(`Chưa tải được: ${err.message}`);
  });
}

export function initBasinLayer() {
  $('chk_basin')?.addEventListener('change', (e) => setBasinVisible(e.target.checked));
}
