// Lớp "Lưu vực, đường phân thủy": drainage/luuvuc.topojson trên bucket (scripts/push-luuvuc.js, tính từ FABDEM cùng nguồn
// lớp thoát nước). 3 cấp vùng: lưu vực sông, tiểu lưu vực (lồng trong lưu vực sông), ô tiêu nước vùng thấp dưới +10 m —
// vùng thấp không có đường phân thủy địa hình đáng tin nên ranh lấy theo sông, kênh bao quanh.
// Kiểu nét theo vùng ở 2 phía cung, không theo cấp của vùng: chỉ cung giữa 2 lưu vực sông (hoặc 2 tiểu lưu vực) là đường
// phân thủy; mép cắt +10 m giáp ô tiêu nước vẽ như ranh ô, mép ngoài vùng đồi vẽ mảnh mờ.
// Cung làm mềm Chaikin giữ nguyên 2 đầu (điểm nút) nên các vùng vẫn khép kín, không hở.
// Nét không nhận click để bên trong lưu vực vẫn tra cứu bản đồ bình thường; bấm nhãn tên để xem thông tin và tô sáng lưu vực.
import { map } from './mapEngine.js';
import { planMap } from './planMap.js';
import { geeApi } from './api.js';
import { escapeHtml } from './utils.js';

const $ = (id) => document.getElementById(id);

// font: [độ đậm, cỡ chữ px] — khớp .basin-label-* trong style.css để đo bề rộng nhãn khi tránh chồng
const LEVELS = {
  1: {
    key: 'major', title: 'Lưu vực', short: 'LV', kind: 'Lưu vực sông', labelZoom: 0, font: [700, 12.5],
    fill: '#f8fafc',
    note: 'Đường phân thủy tính từ cao độ nền FABDEM 30 m.'
  },
  2: {
    key: 'sub', title: 'Tiểu lưu vực', short: 'TLV', kind: 'Tiểu lưu vực', labelZoom: 12, font: [600, 11],
    fill: '#facc15',
    note: 'Đường phân thủy tính từ cao độ nền FABDEM 30 m.'
  },
  3: {
    key: 'low', title: 'Ô tiêu nước', short: 'Ô', kind: 'Ô tiêu nước vùng thấp', labelZoom: 14, font: [600, 10.5],
    fill: '#38bdf8',
    note: 'Vùng thấp dưới +10 m: ranh theo sông, kênh bao quanh; nước tiêu ra các sông, kênh này qua cống, trạm bơm.'
  }
};

// Thứ tự vẽ dưới → trên
const ARC_STYLES = {
  edge: { zoom: 10, line: { color: '#f8fafc', weight: 1, opacity: 0.35 } },
  low: { zoom: 12, line: { color: '#38bdf8', weight: 1.8, dashArray: '1 5', opacity: 0.85 } },
  sub: {
    zoom: 11,
    halo: { color: '#0f172a', opacity: 0.35, weight: 3.2 },
    line: { color: '#facc15', weight: 1.4, dashArray: '5 5', opacity: 0.95 }
  },
  major: {
    zoom: 0,
    halo: { color: '#0f172a', opacity: 0.4, weight: 4.5 },
    line: { color: '#f8fafc', weight: 2.2, dashArray: '10 6' }
  }
};
const SMOOTH_ITER = 2;
const LABEL_PAD = 4;

/** Làm mềm Chaikin, giữ điểm đầu và cuối */
function chaikin(pts, iter) {
  let p = pts;
  for (let k = 0; k < iter && p.length > 2; k++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

/** Kiểu nét của cung theo số vùng mỗi cấp dùng cung (vùng lồng nhau nên 1 phía có thể có cả lưu vực sông lẫn tiểu lưu vực) */
function arcClass(n) {
  if (n[1] >= 2) return 'major';
  if (n[2] >= 2) return 'sub';
  if (n[3] >= 1) return 'low';
  return 'edge';
}

/** TopoJSON → { arcs: [[lat, lng]…] đã làm mềm, cls: kiểu nét mỗi cung, basins } */
function decodeTopo(topo) {
  const tf = topo.transform;
  const arcs = (topo.arcs || []).map(arc => {
    let x = 0, y = 0;
    return chaikin(arc.map(p => {
      if (!tf) return [p[1], p[0]];
      x += p[0]; y += p[1];
      return [y * tf.scale[1] + tf.translate[1], x * tf.scale[0] + tf.translate[0]];
    }), SMOOTH_ITER);
  });
  const uses = arcs.map(() => [0, 0, 0, 0]);
  const obj = topo.objects && (topo.objects.data || Object.values(topo.objects)[0]);
  const basins = [];
  (obj && obj.geometries || []).forEach(g => {
    const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
    if (!polys.length) return;
    const p = g.properties || {};
    const cap = LEVELS[p.cap] ? Number(p.cap) : 2;
    const seen = new Set();
    polys.forEach(rings => rings.forEach(ring => ring.forEach(i => {
      const a = i < 0 ? ~i : i;
      if (seen.has(a)) return;
      seen.add(a);
      uses[a][cap]++;
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
  return { arcs, cls: uses.map(arcClass), basins };
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
  const arcGroups = Object.entries(ARC_STYLES).map(([cls, st]) => {
    const arcs = data.arcs.filter((_, i) => data.cls[i] === cls);
    return {
      zoom: st.zoom,
      layer: arcs.length ? L.layerGroup([...(st.halo ? [line(arcs, st.halo)] : []), line(arcs, st.line)]) : null
    };
  });
  const labels = L.layerGroup();
  const highlight = L.layerGroup();

  const family = getComputedStyle(m.getContainer()).fontFamily || 'sans-serif';
  const ctx = document.createElement('canvas').getContext('2d');
  const items = [];
  data.basins.forEach(b => {
    if (!b.lp) return;
    const lv = LEVELS[b.cap];
    const text = labelOf(b);
    ctx.font = `italic ${lv.font[0]} ${lv.font[1]}px ${family}`;
    const marker = L.marker(b.lp, {
      pane: 'basinLabelPane',
      keyboard: false,
      icon: L.divIcon({
        className: `basin-label basin-label-${lv.key}`,
        html: `<span title="${escapeHtml(titleOf(b))}">${escapeHtml(text)}</span>`,
        iconSize: null
      })
    });
    marker.bindPopup(() => popupHtml(b), { maxWidth: 260 });
    marker.on('popupopen', () => {
      highlight.clearLayers();
      L.polygon(b.polys.map(rings => rings.map(r => ringLatLngs(data.arcs, r))), {
        renderer, interactive: false, color: lv.fill, weight: 2.5, fillColor: lv.fill, fillOpacity: 0.14
      }).addTo(highlight);
    });
    marker.on('popupclose', () => highlight.clearLayers());
    items.push({ b, lv, marker, w: ctx.measureText(text).width + 2 * LABEL_PAD, h: lv.font[1] + 2 * LABEL_PAD });
  });
  // Ưu tiên giữ nhãn: lưu vực sông → tiểu lưu vực → ô tiêu nước, cùng cấp thì vùng lớn trước
  items.sort((a, c) => a.b.cap - c.b.cap || c.b.km2 - a.b.km2);

  const toggle = (layer, on, parent = m) => {
    if (!layer) return;
    if (on && !parent.hasLayer(layer)) parent.addLayer(layer);
    else if (!on && parent.hasLayer(layer)) parent.removeLayer(layer);
  };
  /** Nhãn chồng lên nhãn ưu tiên hơn thì ẩn; tính lại mỗi lần đổi mức phóng (tọa độ pixel tuyệt đối không đổi khi kéo) */
  const placeLabels = (z) => {
    const boxes = [];
    items.forEach(it => {
      let show = z >= it.lv.labelZoom;
      if (show) {
        const p = m.project(it.b.lp, z);
        const r = [p.x - it.w / 2, p.y - it.h / 2, p.x + it.w / 2, p.y + it.h / 2];
        show = !boxes.some(o => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1]);
        if (show) boxes.push(r);
      }
      toggle(it.marker, show, labels);
    });
  };
  const update = () => {
    const z = m.getZoom();
    arcGroups.forEach(g => toggle(g.layer, z >= g.zoom));
    placeLabels(z);
  };
  highlight.addTo(m);
  labels.addTo(m);
  update();
  m.on('zoomend', update);

  return {
    remove() {
      m.off('zoomend', update);
      const all = arcGroups.map(g => g.layer).concat(labels, highlight, renderer);
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
