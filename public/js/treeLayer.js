// Vùng cần trồng cây: polygon nóng, ít cây, có dân cư. Bảng phường chỉ mở khi bấm.
import { map, flyToVisible } from './mapEngine.js';
import { planMap } from './planMap.js';
import { state } from './state.js';
import { geeApi } from './api.js';
import { popQuery } from './popMethod.js';
import { escapeHtml, fmtNum, isApproved, distanceMeters, startTaskProgress } from './utils.js';
import { seasonYears } from './satLayers.js';

const $ = (id) => document.getElementById(id);
const PANE = 'treePriorityPane';
const PANE_Z = 560;
const NEAR_M = 180;
const NEAR_TYPES = new Set(['3-MN', '4-TH', '5-THCS', '6-THPT', '9-TM', '8-VH', '1-CV', '7-YT']);
const NDVI_FMT = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const LEVELS = {
  3: { label: 'Rất cần', color: '#b91c1c', stroke: '#7f1d1d', fill: 0.62 },
  2: { label: 'Cần', color: '#c2410c', stroke: '#9a3412', fill: 0.55 },
  1: { label: 'Theo dõi', color: '#a16207', stroke: '#713f12', fill: 0.48 }
};

const mapsOf = () => [map, planMap].filter(Boolean);

let visible = false;
let year = null;
let seq = 0;
let task = null;
let zoneData = null;
let wardData = null;
let popup = null;
let polys = [];
let selected = -1;
const cache = new Map();
const renderers = new WeakMap();

function treeYears() {
  const { years } = seasonYears(2017, '04-01', '09-01');
  const list = years.filter(y => y >= 2017).slice(0, 4);
  const partial = new Date().getFullYear();
  const def = list.includes(2025) ? 2025 : (list.find(y => y !== partial) || list[0]);
  return { years: list, partial, def };
}

function lotHead(code) {
  const m = String(code || '').toUpperCase().match(/[A-Z]+/);
  return m ? m[0] : '';
}

function marketName(name) {
  const nm = String(name || '').toUpperCase();
  return nm.includes('CHỢ') || /(^|[^A-Z])CHO([^A-Z]|$)/.test(nm);
}

function landKind({ lotCode, facilityType, name, density, ndvi } = {}) {
  const head = lotHead(lotCode);
  const type = String(facilityType || '');
  if (head === 'DGD' || type === '3-MN' || type === '4-TH' || type === '5-THCS' || type === '6-THPT') return 'sân trường';
  if (head === 'TMD' || type === '9-TM' || marketName(name)) return 'khu chợ';
  if (head === 'DGT' || head === 'GT') return 'dải phố';
  if (head === 'DTT' || type === '8-VH') return 'sân thể thao';
  const dense = Number(density);
  if (head === 'ODT' || head === 'ONT' || (Number.isFinite(dense) && dense >= 40)) return 'khu ở';
  const green = Number(ndvi);
  if (Number.isFinite(dense) && dense >= 15 && Number.isFinite(green) && green < 0.28) return 'sân, bãi';
  return 'khu dân cư';
}

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

function opacity() {
  const el = $('treeOpacity');
  return el ? Number(el.value) / 100 : 1;
}

function styleOf(level, on) {
  const s = LEVELS[level] || LEVELS[1];
  return {
    color: s.stroke,
    weight: on ? 2.5 : 1.5,
    opacity: 0.95,
    fillColor: s.color,
    fillOpacity: s.fill * opacity()
  };
}

function clearLayers() {
  polys.forEach(layer => layer.remove());
  polys = [];
  popup?.remove();
  popup = null;
  selected = -1;
}

function pointInWard(lat, lng) {
  if (lat == null || lng == null || typeof turf === 'undefined') return '';
  const pt = turf.point([Number(lng), Number(lat)]);
  for (const w of state.wardLabelsList || []) {
    if (!w.geometry) continue;
    try {
      if (turf.booleanPointInPolygon(pt, turf.feature(w.geometry))) return w.name || '';
    } catch (e) { /* ranh hỏng thì bỏ qua */ }
  }
  return '';
}

function firstCoord(geom) {
  let c = geom && geom.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  if (!Array.isArray(c) || c.length < 2 || !Number.isFinite(Number(c[0]))) return null;
  return { lng: Number(c[0]), lat: Number(c[1]) };
}

function nearestFacility(lat, lng) {
  if (lat == null || lng == null) return null;
  let best = null;
  let bestD = NEAR_M;
  for (const it of state.rawDataList || []) {
    if (!it || !NEAR_TYPES.has(it.type) || !isApproved(it.status)) continue;
    const ilat = Number(it.lat);
    const ilng = Number(it.lng);
    if (!Number.isFinite(ilat) || !Number.isFinite(ilng)) continue;
    const d = distanceMeters(lat, lng, ilat, ilng);
    if (d < bestD) { bestD = d; best = it; }
  }
  return best;
}

function enrichZone(z) {
  const spot = (z.lat != null && z.lng != null) ? z : (firstCoord(z.geometry) || z);
  const ward = z.ward || pointInWard(spot.lat, spot.lng);
  const near = nearestFacility(spot.lat, spot.lng);
  const land = landKind({
    lotCode: z.lotCode || (near && near.lotCode),
    facilityType: near && near.type,
    name: near && near.name,
    density: z.popHa,
    ndvi: z.ndvi
  });
  const nearName = near && near.name ? String(near.name).replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  return { ...z, ward, land, near: nearName, spotLat: spot.lat, spotLng: spot.lng };
}

function zoneTitle(z) {
  const ward = z.ward || 'Khu vực';
  let t = `${ward} · ${z.land || 'khu dân cư'}`;
  if (z.near) t += ` · gần ${z.near}`;
  return t;
}

function explain(z) {
  const label = (LEVELS[z.level] || {}).label || '—';
  const gap = z.lstGap;
  const gapTxt = gap == null
    ? ''
    : (gap > 0
      ? `, cao hơn trung bình thành phố ${fmtNum(gap)} °C`
      : (gap < 0 ? `, thấp hơn trung bình thành phố ${fmtNum(Math.abs(gap))} °C` : ', ngang trung bình thành phố'));
  return `<b>${escapeHtml(zoneTitle(z))}</b><br>Mức: ${label}.<br>`
    + `Diện tích khoảng ${z.ha == null ? '—' : fmtNum(z.ha)} ha.<br>`
    + `Nhiệt độ bề mặt ${z.lst == null ? '—' : fmtNum(z.lst)} °C${gapTxt}.<br>`
    + `NDVI ${z.ndvi == null ? '—' : NDVI_FMT.format(z.ndvi)}.<br>`
    + `Dân cư trong vùng khoảng ${z.pop == null ? '—' : fmtNum(z.pop)} người.<br>`
    + `Loại đất ước tính: ${escapeHtml(z.land || 'khu dân cư')}.<br>`
    + 'Đã loại mặt nước, rừng, đất nông nghiệp và nghĩa trang.<br>'
    + 'Kết quả mang tính tham khảo, không thay quy hoạch cây xanh.';
}

function paintSelected() {
  polys.forEach(layer => layer.setStyle(f => styleOf(f.properties.level, f.properties.i === selected)));
}

function openZone(index, latlng, targetMap) {
  const z = zoneData && zoneData.zones && zoneData.zones[index];
  if (!z) return;
  selected = index;
  document.querySelectorAll('#treeZones .tree-zone').forEach(btn => btn.classList.toggle('is-on', Number(btn.dataset.i) === index));
  paintSelected();
  const at = latlng || (z.spotLat != null ? [z.spotLat, z.spotLng] : (z.lat != null ? [z.lat, z.lng] : null));
  if (z.lat != null) flyToVisible([z.lat, z.lng], 16);
  else if (z.spotLat != null) flyToVisible([z.spotLat, z.spotLng], 16);
  const m = targetMap || map;
  if (!m || !at) return;
  popup?.remove();
  popup = L.popup({ maxWidth: 300, className: 'tree-popup' }).setLatLng(at).setContent(explain(z)).openOn(m);
}

function drawZones(zones) {
  const features = zones.map((z, i) => ({
    type: 'Feature',
    properties: { i, level: z.level },
    geometry: z.geometry
  }));
  const fc = { type: 'FeatureCollection', features };
  return mapsOf().map(m => {
    const layer = L.geoJSON(fc, {
      pane: PANE,
      renderer: rendererFor(m),
      interactive: true,
      style: f => styleOf(f.properties.level, f.properties.i === selected),
      onEachFeature: (feat, path) => {
        path.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          openZone(feat.properties.i, e.latlng, m);
        });
      }
    });
    layer.addTo(m);
    return layer;
  });
}

function listHtml(zones) {
  const top = (zones || []).slice(0, 20);
  if (!top.length) return '<div class="flood-muted">Không có vùng đạt ngưỡng trong năm này.</div>';
  return top.map((z, i) => {
    const s = LEVELS[z.level] || LEVELS[1];
    return `<button type="button" class="tree-zone" data-i="${i}">
      <i class="tree-swatch" style="background:${s.color}"></i>
      <span>${escapeHtml(zoneTitle(z))}</span>
      <b>${z.ha == null ? '—' : fmtNum(z.ha)} ha</b>
    </button>`;
  }).join('');
}

function methodHtml(d) {
  const pop = d.popSource === 'nha'
    ? 'Dân số lấy theo raster nhà ở.'
    : 'Dân cư lấy theo raster pixel vì chưa có raster nhà ở, chỉ để tham khảo.';
  const ndvi = Number(d.year) === new Date().getFullYear() ? ` NDVI năm ${d.year} chưa đủ 12 tháng.` : '';
  const cem = d.cemeteryCount
    ? ` Đã loại ${fmtNum(d.cemeteryCount)} nghĩa trang đã duyệt bằng vùng đệm quanh điểm.`
    : '';
  return `Nhiệt độ bề mặt và NDVI cùng lưới khoảng 60 m. ${pop}${ndvi}${cem}`;
}

function explainWard(w, ranked) {
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

function openWard(index) {
  const w = wardData && wardData.wards && wardData.wards[index];
  if (!w) return;
  document.querySelectorAll('#treeTable tr').forEach(tr => tr.classList.toggle('is-on', Number(tr.dataset.i) === index));
  const geom = (state.wardLabelsList || []).find(g => g.name === w.name);
  const m = map;
  if (geom) flyToVisible([geom.lat, geom.lng], 13);
  if (!m || !geom) return;
  popup?.remove();
  popup = L.popup({ maxWidth: 280, className: 'tree-popup' })
    .setLatLng([geom.lat, geom.lng])
    .setContent(explainWard(w, wardData.ranked || 0))
    .openOn(m);
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

function load(part) {
  const key = `${year}|${popQuery()}|${part}`;
  if (!cache.has(key)) {
    const q = `action=getTreePriority&part=${part}&year=${encodeURIComponent(year)}&pop=${encodeURIComponent(popQuery())}&tv=6`;
    cache.set(key, getJson(q).catch(err => { cache.delete(key); throw err; }));
  }
  return cache.get(key);
}

function refreshNames() {
  if (!zoneData || !zoneData.zones) return;
  zoneData.zones = zoneData.zones.map(enrichZone);
  const box = $('treeZones');
  if (box) box.innerHTML = listHtml(zoneData.zones);
  if (selected >= 0) {
    document.querySelectorAll('#treeZones .tree-zone').forEach(btn => btn.classList.toggle('is-on', Number(btn.dataset.i) === selected));
  }
}

async function loadWards() {
  const my = seq;
  const stats = $('treeStats');
  if (stats) stats.innerHTML = '<div class="flood-muted">Đang tính bảng phường, xã.</div>';
  try {
    const d = await load('stats');
    if (my !== seq || !visible) return;
    await waitWards();
    if (my !== seq || !visible) return;
    wardData = d;
    if (stats) stats.innerHTML = tableHtml(d);
  } catch (err) {
    if (my !== seq) return;
    if (stats) stats.innerHTML = `<div class="flood-muted">Chưa tính được bảng: ${escapeHtml(err.message)}</div>`;
  }
}

async function show() {
  const my = ++seq;
  const box = $('treeZones');
  if (box) box.innerHTML = '<div class="flood-muted">Đang khoanh vùng trên Google Earth Engine.</div>';
  task?.cancel();
  task = startTaskProgress('Đang khoanh vùng ưu tiên trồng cây');
  task.creep(90, 8000);
  try {
    const d = await load('zones');
    if (my !== seq || !visible) { task.cancel(); return; }
    clearLayers();
    const zones = (d.zones || []).map(enrichZone);
    zoneData = { ...d, zones };
    const method = $('treeMethod');
    if (method) method.textContent = methodHtml(d);
    if (box) box.innerHTML = listHtml(zones);
    polys = drawZones(zones);
    task.done(zones.length ? 'Đã có vùng ưu tiên trồng cây' : 'Không có vùng đạt ngưỡng');
    if (!wardsReady()) {
      waitWards().then(() => { if (my === seq && visible) refreshNames(); });
    }
    const details = $('treeWardDetails');
    if (details && details.open) loadWards();
  } catch (err) {
    if (my !== seq) { task?.cancel(); return; }
    task?.fail('Không khoanh được vùng ưu tiên');
    if (box) box.innerHTML = `<div class="flood-muted">Chưa tính được: ${escapeHtml(err.message)}</div>`;
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
  polys.forEach(layer => layer.setStyle(f => styleOf(f.properties.level, f.properties.i === selected)));
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
      wardData = null;
      if (visible) show();
    });
  }
  $('chk_tree').addEventListener('change', (e) => setVisible(e.target.checked));
  $('treeOpacity')?.addEventListener('input', applyOpacity);
  $('treeZones')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.tree-zone');
    if (!btn) return;
    openZone(Number(btn.dataset.i));
  });
  $('treeStats')?.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-i]');
    if (!row) return;
    openWard(Number(row.dataset.i));
  });
  $('treeWardDetails')?.addEventListener('toggle', (e) => {
    if (e.target.open && visible) loadWards();
  });
}
