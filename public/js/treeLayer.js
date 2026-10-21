// Ưu tiên trồng cây xanh: ô nóng ~100 m và bảng hạng phường, xã. Số liệu là mức tương đối.
import { map, flyToVisible } from './mapEngine.js';
import { planMap } from './planMap.js';
import { state } from './state.js';
import { geeApi } from './api.js';
import { popQuery } from './popMethod.js';
import { escapeHtml, fmtNum, startTaskProgress, trackTileLoads } from './utils.js';
import { geeTileOpts } from './basemap.js';
import { seasonYears } from './satLayers.js';

const $ = (id) => document.getElementById(id);
const PANE = 'treePriorityPane';
const PANE_Z = 360;
const NDVI_FMT = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const mapsOf = () => [map, planMap].filter(Boolean);

let visible = false;
let year = null;
let seq = 0;
let task = null;
let data = null;
let popup = null;
let tiles = [];
let choros = [];
const cache = new Map();

function treeYears() {
  const now = new Date();
  const { years, def } = seasonYears(2017, '04-01', '09-01');
  return { years: years.filter(y => y >= 2017).slice(0, 4), partial: now.getFullYear(), def };
}

const renderers = new WeakMap();

function wardsReady() {
  return (state.wardLabelsList || []).some(w => w.geometry);
}

function waitWards() {
  if (wardsReady()) return Promise.resolve();
  return new Promise(resolve => {
    const t0 = Date.now();
    const tick = () => {
      if (wardsReady() || Date.now() - t0 > 20000) resolve();
      else setTimeout(tick, 250);
    };
    tick();
  });
}

function rendererFor(m) {
  if (!m.getPane(PANE)) {
    const pane = m.createPane(PANE);
    pane.style.zIndex = String(PANE_Z);
  }
  if (!renderers.has(m)) renderers.set(m, L.canvas({ pane: PANE }));
  return renderers.get(m);
}

function scoreColor(score) {
  const t = Math.max(0, Math.min(100, Number(score))) / 100;
  const stops = t < 0.5 ? ['#1a9850', '#fee08b'] : ['#fee08b', '#d73027'];
  const u = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const parse = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const a = parse(stops[0]);
  const b = parse(stops[1]);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * u));
  return `#${c.map(n => n.toString(16).padStart(2, '0')).join('')}`;
}

function opacity() {
  const el = $('treeOpacity');
  return el ? Number(el.value) / 100 : 0.7;
}

function styleOf(score, fillScale) {
  if (score == null) {
    return { color: '#64748b', weight: 1, opacity: 0.45, fillColor: '#94a3b8', fillOpacity: 0.05 };
  }
  return {
    color: scoreColor(score),
    weight: 1,
    opacity: 0.85,
    fillColor: scoreColor(score),
    fillOpacity: Math.max(0.12, Math.min(0.34, fillScale))
  };
}

function clearLayers() {
  tiles.forEach(layer => layer.remove());
  choros.forEach(layer => layer.remove());
  tiles = [];
  choros = [];
  popup?.remove();
  popup = null;
}

function wardGeom(name) {
  return (state.wardLabelsList || []).find(w => w.name === name) || null;
}

function explain(w) {
  const ranked = data && data.ranked ? data.ranked : 0;
  if (w.rank == null) {
    return `<b>${escapeHtml(w.name)}</b><br>Đất xây dựng ước tính dưới 15 ha nên không xếp hạng.<br>Kết quả mang tính tham khảo, không thay quy hoạch cây xanh.`;
  }
  const gap = w.lstGap;
  const gapTxt = gap == null
    ? ''
    : (gap > 0
      ? `cao hơn trung bình thành phố ${fmtNum(gap)} °C`
      : (gap < 0 ? `thấp hơn trung bình thành phố ${fmtNum(Math.abs(gap))} °C` : 'ngang trung bình thành phố'));
  return `<b>${escapeHtml(w.name)}</b><br>Xếp hạng ${w.rank}/${ranked}. Điểm ${w.score} là mức tương đối giữa các phường, xã.<br>`
    + `Nhiệt độ bề mặt mùa nóng ${w.lst == null ? '—' : `${fmtNum(w.lst)} °C`}, ${gapTxt}.<br>`
    + `NDVI trên đất xây dựng ${w.ndvi == null ? '—' : NDVI_FMT.format(w.ndvi)}.<br>`
    + `Mật độ khoảng ${w.density == null ? '—' : fmtNum(w.density)} người/ha.<br>`
    + `Đất xây dựng tính toán khoảng ${w.builtHa == null ? '—' : fmtNum(w.builtHa)} ha.<br>`
    + 'Đã loại mặt nước, rừng, đất nông nghiệp và vùng nghĩa trang.<br>'
    + 'Kết quả mang tính tham khảo, không thay quy hoạch cây xanh.';
}

function openWard(index, latlng, targetMap) {
  const w = data && data.wards && data.wards[index];
  if (!w) return;
  document.querySelectorAll('#treeTable tr').forEach(tr => tr.classList.toggle('is-on', Number(tr.dataset.i) === index));
  const geom = wardGeom(w.name);
  const m = targetMap || map;
  const at = latlng || (geom ? [geom.lat, geom.lng] : null);
  if (geom) flyToVisible([geom.lat, geom.lng], 13);
  if (!m || !at) return;
  popup?.remove();
  popup = L.popup({ maxWidth: 280, className: 'tree-popup' }).setLatLng(at).setContent(explain(w)).openOn(m);
}

function choropleth(wards) {
  const fill = opacity() * 0.35;
  const features = [];
  wards.forEach((w, i) => {
    const g = wardGeom(w.name);
    if (!g || !g.geometry) return;
    features.push({ type: 'Feature', properties: { i, score: w.score }, geometry: g.geometry });
  });
  const fc = { type: 'FeatureCollection', features };
  return mapsOf().map(m => {
    const layer = L.geoJSON(fc, {
      pane: PANE,
      renderer: rendererFor(m),
      interactive: true,
      style: f => styleOf(f.properties.score, fill),
      onEachFeature: (feat, path) => {
        path.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          openWard(feat.properties.i, e.latlng, m);
        });
      }
    });
    layer.addTo(m);
    return layer;
  });
}

function legendHtml(cellM) {
  const palette = ['#1a9850', '#91cf60', '#fee08b', '#fc8d59', '#d73027'];
  return `<div class="sat-legend-title">Mức ưu tiên trên ô khoảng ${cellM || 100} m</div>
    <div class="sat-legend-bar" style="background:linear-gradient(90deg, ${palette.join(', ')})"></div>
    <div class="sat-legend-ticks"><span>Thấp</span><span>Cao</span></div>`;
}

function methodHtml(d) {
  const pop = d.popSource === 'nha'
    ? 'Dân số lấy theo raster nhà ở.'
    : 'Dân số lấy theo raster pixel vì chưa có raster nhà ở.';
  const ndvi = d.ndviPartial ? ` NDVI năm ${d.year} chưa đủ 12 tháng.` : '';
  const cem = d.cemeteryCount
    ? ` Đã loại ${fmtNum(d.cemeteryCount)} nghĩa trang đã duyệt bằng vùng đệm quanh điểm.`
    : ' Chưa có điểm nghĩa trang đã duyệt để loại.';
  return `${pop}${ndvi}${cem} Thang màu trên bản đồ là thang cố định, khác với hạng trong bảng.`;
}

function tableHtml(d) {
  const head = `<tr>
    <th title="Hạng giữa các phường, xã đủ điều kiện">Hạng</th>
    <th>Phường xã</th>
    <th title="Điểm tổng hợp, mức tương đối">Điểm</th>
    <th title="Nhiệt độ bề mặt so với trung bình thành phố, °C">°C</th>
    <th title="NDVI trên đất xây dựng">NDVI</th>
    <th title="Người trên mỗi hecta đất xây dựng">Người/ha</th>
  </tr>`;
  const rows = (d.wards || []).map((w, i) => {
    const gap = w.lstGap == null ? '—' : `${w.lstGap > 0 ? '+' : ''}${fmtNum(w.lstGap)}`;
    return `<tr data-i="${i}">
      <td>${w.rank == null ? '—' : w.rank}</td>
      <td class="tree-name">${escapeHtml(w.name)}</td>
      <td>${w.score == null ? '—' : w.score}</td>
      <td>${gap}</td>
      <td>${w.ndvi == null ? '—' : NDVI_FMT.format(w.ndvi)}</td>
      <td>${w.density == null ? '—' : fmtNum(w.density)}</td>
    </tr>`;
  }).join('');
  const city = d.cityLst == null ? '' : `<div class="flood-kpi"><span>Nhiệt bề mặt trên đất xây dựng</span><b>${fmtNum(d.cityLst)} °C</b></div>`;
  return `${city}
    <div class="flood-kpi"><span>Đã xếp hạng</span><b>${fmtNum(d.ranked)}/${fmtNum((d.wards || []).length)}</b></div>
    <p class="flood-muted">Chỉ số tương đối, mang tính tham khảo.</p>
    <div class="tree-scroll"><table class="tree-table" id="treeTable"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}

async function getJson(query) {
  const r = await fetch(geeApi(query));
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || d.error) throw new Error((d && d.message) || `HTTP ${r.status}`);
  return d;
}

async function show() {
  const my = ++seq;
  const stats = $('treeStats');
  if (stats) stats.innerHTML = '<div class="flood-muted">Đang tính trên Google Earth Engine.</div>';
  task?.cancel();
  task = startTaskProgress('Đang tính ưu tiên trồng cây (GEE)');
  task.creep(50, 4000);
  const load = (part) => {
    const key = `${year}|${popQuery()}|${part}`;
    if (!cache.has(key)) {
      const q = `action=getTreePriority&part=${part}&year=${encodeURIComponent(year)}&pop=${encodeURIComponent(popQuery())}`;
      cache.set(key, getJson(q).catch(err => { cache.delete(key); throw err; }));
    }
    return cache.get(key);
  };
  const tileP = load('tile');
  try {
    const d = await load('stats');
    if (my !== seq || !visible) { task.cancel(); return; }
    await waitWards();
    if (my !== seq || !visible) { task.cancel(); return; }
    task.set(50, 'Đang tải lưới ưu tiên');
    clearLayers();
    data = d;
    const legend = $('treeLegend');
    const method = $('treeMethod');
    if (legend) legend.innerHTML = legendHtml(d.cellM);
    if (method) method.textContent = methodHtml(d);
    if (stats) stats.innerHTML = tableHtml(d);
    choros = choropleth(d.wards || []);
    try {
      const tile = await tileP;
      if (my !== seq || !visible) { task.cancel(); return; }
      if (tile.urlFormat) {
        const opts = geeTileOpts({ opacity: opacity(), zIndex: 2 });
        const layers = mapsOf().map(m => L.tileLayer(tile.urlFormat, opts));
        trackTileLoads(layers, (n, total) => task.set(50 + 48 * (n / Math.max(total, 1))))
          .then(() => { if (task && my === seq) task.done('Đã tải ưu tiên trồng cây'); });
        layers.forEach((layer, i) => layer.addTo(mapsOf()[i]));
        tiles = layers;
        if (tile.cellM && legend) legend.innerHTML = legendHtml(tile.cellM);
      } else if (task) task.done('Đã có bảng xếp hạng');
    } catch (err) {
      if (my === seq && stats) stats.insertAdjacentHTML('beforeend', `<div class="flood-muted">Chưa tải được lưới: ${escapeHtml(err.message)}</div>`);
      task?.done('Đã có bảng xếp hạng');
    }
  } catch (err) {
    tileP.catch(() => {});
    if (my !== seq) { task?.cancel(); return; }
    task?.fail('Không tính được ưu tiên trồng cây');
    if (stats) stats.innerHTML = `<div class="flood-muted">Chưa tính được: ${escapeHtml(err.message)}</div>`;
  }
}

function setVisible(on) {
  visible = !!on;
  ['treeBox', 'treeOpBox'].forEach(id => {
    const el = $(id);
    if (el) el.style.display = visible ? '' : 'none';
  });
  if (visible) show();
  else {
    seq += 1;
    task?.cancel();
    task = null;
    clearLayers();
  }
}

function applyOpacity() {
  const o = opacity();
  tiles.forEach(layer => layer.setOpacity(o));
  const fill = o * 0.35;
  choros.forEach(layer => layer.setStyle(f => styleOf(f.properties.score, fill)));
}

export function initTreeLayer() {
  if (!map || !$('chk_tree')) return;
  const pick = treeYears();
  year = String(pick.def);
  const sel = $('treeYear');
  if (sel) {
    sel.innerHTML = pick.years.map(y => {
      const note = y === pick.partial ? ' (NDVI chưa đủ năm)' : '';
      return `<option value="${y}"${String(y) === year ? ' selected' : ''}>${y}${note}</option>`;
    }).join('');
    sel.addEventListener('change', () => {
      year = sel.value;
      if (visible) show();
    });
  }
  $('chk_tree').addEventListener('change', (e) => setVisible(e.target.checked));
  $('treeOpacity')?.addEventListener('input', applyOpacity);
  $('treeStats')?.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-i]');
    if (!row) return;
    openWard(Number(row.dataset.i));
  });
}
