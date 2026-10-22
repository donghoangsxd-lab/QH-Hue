// Lớp vệ tinh (bảng lớp dữ liệu): vùng ngập thực tế mùa lũ (radar Sentinel-1), nhiệt độ bề mặt mùa nóng (Landsat 8/9),
// NDVI Sentinel-2,
// và vùng phát triển mới (Dynamic World, newDev.js).
// Ảnh đi qua getSatMeta / getSatTile (services/satTileCache.js): máy chủ giữ map id, thử lại, cache PNG năm đã chốt.
// Vẽ đồng thời trên bản đồ hiện trạng và quy hoạch; thống kê theo phường chỉ tải khi bật lớp, mỗi năm 1 lần.
import { map, flyToVisible } from './mapEngine.js';
import { planMap, shownMaps } from './planMap.js';
import { state, BUFFER_COLORS, layerType } from './state.js';
import { geeApi } from './api.js';
import { popQuery } from './popMethod.js';
import { escapeHtml, fmtNum, startTaskProgress } from './utils.js';
import { devFromYears, loadNewDevStats, devLegend, devStats, DEV_MIN_ZOOM } from './newDev.js';
import { geeTileOpts } from './basemap.js';
import { watchTiles } from './loadProgress.js';
import { geeTileLayer } from './geeTiles.js';

const HUE_TILE_BOUNDS = L.latLngBounds([15.9, 106.9], [16.9, 108.3]);

const $ = (id) => document.getElementById(id);
const MAX_LIST = 150;

// Năm có dữ liệu: khớp sarYears / lstYears trong services/satService.js
export function seasonYears(first, startMMDD, endMMDD) {
  const now = new Date();
  const y = now.getFullYear();
  const last = now >= new Date(`${y}-${startMMDD}T00:00:00`) ? y : y - 1;
  const lastDone = now >= new Date(`${y}-${endMMDD}T00:00:00`) ? y : y - 1;
  const years = [];
  for (let i = last; i >= first; i--) years.push(i);
  return { years, partial: last > lastDone ? last : null, def: Math.max(first, lastDone) };
}

export const sarSeasons = () => seasonYears(2016, '09-15', '12-15');
export const lstSeasons = () => seasonYears(2014, '04-01', '09-01');
export function ndviSeasons() {
  const y = new Date().getFullYear();
  const years = [];
  for (let i = y; i >= 2017; i--) years.push(i);
  return { years, partial: y, def: y - 1 };
}

const LAYERS = {
  sar: {
    label: 'ngập thực tế (Sentinel-1)',
    ids: { chk: 'chk_sarflood', box: 'sarFloodBox', opBox: 'sarFloodOpBox', opacity: 'sarFloodOpacity', year: 'sarFloodYear', legend: 'sarFloodLegend', stats: 'sarFloodStats' },
    zIndex: 3,
    seasons: sarSeasons,
    extra: [['all', 'Số mùa lũ bị ngập (mọi năm)']],
    maxNativeZoom: 15,
    tileQuery: (y) => `action=getSatMeta&layer=sar&year=${encodeURIComponent(y)}`,
    statsQuery: (y) => (y === 'all' ? null : `action=getSarFloodStats&year=${y}&dem=fabdem`),
    renderLegend: sarLegend,
    renderStats: sarStats
  },
  lst: {
    label: 'nhiệt độ bề mặt (Landsat)',
    ids: { chk: 'chk_lst', box: 'lstBox', opBox: 'lstOpBox', opacity: 'lstOpacity', year: 'lstYear', legend: 'lstLegend', stats: 'lstStats' },
    zIndex: 1,
    seasons: lstSeasons,
    extra: [],
    maxNativeZoom: 14,
    tileQuery: (y) => `action=getSatMeta&layer=lst&year=${encodeURIComponent(y)}`,
    statsQuery: (y) => `action=getLstStats&year=${y}`,
    renderLegend: lstLegend,
    renderStats: lstStats
  },
  ndvi: {
    label: 'NDVI (Sentinel-2)',
    ids: { chk: 'chk_ndvi', box: 'ndviBox', opBox: 'ndviOpBox', opacity: 'ndviOpacity', year: 'ndviYear', compare: 'ndviCompare', legend: 'ndviLegend', stats: 'ndviStats' },
    zIndex: 2,
    seasons: ndviSeasons,
    extra: [],
    yearKey: ndviYearKey,
    maxNativeZoom: 15,
    tileQuery: (y) => ndviQuery('getSatMeta', y).replace('action=getSatMeta', 'action=getSatMeta&layer=ndvi'),
    statsQuery: (y) => ndviQuery('getNdviStats', y),
    renderLegend: ndviLegend,
    renderStats: ndviStats
  },
  dev: {
    label: 'đất xây dựng (vệ tinh)',
    ids: { chk: 'chk_newdev', box: 'newDevBox', opBox: 'newDevOpBox', opacity: 'newDevOpacity', year: 'newDevYear', legend: 'newDevLegend', stats: 'newDevStats' },
    zIndex: 2,
    minZoom: DEV_MIN_ZOOM,
    seasons: devFromYears,
    extra: [],
    maxNativeZoom: 15,
    tileQuery: (y) => `action=getSatMeta&layer=dev&from=${encodeURIComponent(y)}`,
    statsQuery: (y) => `action=getNewDevStats&from=${y}`,
    loadStats: loadNewDevStats,
    renderLegend: devLegend,
    renderStats: devStats
  },
  forest: {
    label: 'rừng, phủ thực vật',
    ids: { chk: 'chk_forest', box: 'forestBox', opBox: 'forestOpBox', opacity: 'forestOpacity', year: 'forestYear', legend: 'forestLegend', stats: 'forestStats' },
    zIndex: 2,
    seasons: () => ({ years: ['cover', 'loss'], partial: null, def: 'cover' }),
    yearText: (y) => (y === 'loss' ? 'Mất rừng 2001–2025 (Hansen)' : 'Phủ thực vật 2021 (WorldCover)'),
    extra: [],
    maxNativeZoom: 14,
    tileQuery: (y) => `action=getSatMeta&layer=forest&mode=${encodeURIComponent(y)}`,
    statsQuery: (y) => `action=getForestStats&mode=${y}`,
    renderLegend: forestLegend,
    renderStats: forestStats
  }
};

const runtime = {};   // key → { visible, year, left, right, url, task, tiles: Map(năm → Promise), stats: Map(năm → Promise), legend, seq, shown }
// Tiến độ: GEE dựng ảnh (theo thời gian, tới SERVER_PCT) rồi tải ô ảnh trong khung nhìn (theo số ô)
const SERVER_PCT = 50;
const SERVER_TAU_MS = 4000;

async function getJson(query) {
  const r = await fetch(geeApi(query));
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || d.error) throw new Error((d && d.message) || `HTTP ${r.status}`);
  return d;
}

function cached(store, key, load) {
  if (!store.has(key)) store.set(key, load().catch(err => { store.delete(key); throw err; }));
  return store.get(key);
}

// ---------- Chú giải ----------
function rampHtml(palette, ticks, title) {
  return `<div class="sat-legend-title">${title}</div>
    <div class="sat-legend-bar" style="background:linear-gradient(90deg, ${palette.join(', ')})"></div>
    <div class="sat-legend-ticks">${ticks.map(t => `<span>${t}</span>`).join('')}</div>`;
}

function sarLegend(legend, year) {
  if (legend.palette) {
    const ticks = [];
    for (let i = legend.min; i <= legend.max; i++) ticks.push(i === legend.max ? `≥ ${i}` : i);
    return rampHtml(legend.palette, ticks, 'Số mùa lũ bị ngập');
  }
  return `<span class="sat-swatch" style="background:${legend.color}"></span>Bị ngập ít nhất 1 lần chụp, 15/9–15/12/${year}`;
}

function ndviYearKey() {
  const y = $('ndviYear')?.value || '';
  const c = $('ndviCompare')?.value || '';
  return c ? `${y}:${c}` : y;
}

function ndviQuery(action, key) {
  const [year, compare] = String(key).split(':');
  return `action=${action}&year=${encodeURIComponent(year || '')}${compare ? `&compare=${encodeURIComponent(compare)}` : ''}`;
}

function ndviLegend(legend) {
  if (legend.diff) return rampHtml(legend.palette, [legend.min, 0, `+${legend.max}`], `NDVI ${legend.year} trừ ${legend.compare}`);
  return rampHtml(legend.palette, [legend.min, 0.35, legend.max], 'NDVI trung vị cả năm (Sentinel-2)');
}

function ndviStats(d) {
  const hot = d.wards.slice().sort((a, b) => b.mean - a.mean);
  const chip = (w) => `<span>${escapeHtml(w.name)} <b>${fmtNum(w.mean)}</b></span>`;
  const title = d.compare ? `NDVI trung bình ${d.year} − ${d.compare}` : `NDVI trung bình ${d.year}`;
  const high = d.compare ? 'Tăng nhiều nhất' : 'Cao nhất';
  const low = d.compare ? 'Giảm nhiều nhất' : 'Thấp nhất';
  return `<div class="flood-kpi"><span>${title}</span><b>${d.city == null ? '—' : fmtNum(d.city)}</b></div>
    <div class="flood-sub">${high}</div><div class="flood-wards sat-hot">${hot.slice(0, 5).map(chip).join('')}</div>
    <div class="flood-sub">${low}</div><div class="flood-wards sat-cool">${hot.slice(-3).reverse().map(chip).join('')}</div>
    <div class="flood-muted">Trung vị ảnh Sentinel-2 đã bỏ mây, lưới thống kê 100 m. Nước và đất trống thường thấp hơn cây.</div>`;
}

function forestLegend(legend) {
  if (legend.mode === 'loss' || legend.palette) {
    return rampHtml(legend.palette, [legend.from, Math.round((legend.from + legend.to) / 2), legend.to], legend.title);
  }
  const rows = (legend.classes || []).map(c => `<span><i class="sat-swatch" style="background:${c.color}"></i>${escapeHtml(c.name)}</span>`).join('');
  return `<div class="sat-legend-title">${escapeHtml(legend.title || 'Phủ thực vật')}</div><div class="flood-wards">${rows}</div>`;
}

function forestStats(d) {
  if (!d || !Array.isArray(d.wards)) return '<div class="flood-muted">Máy chủ chưa trả thống kê rừng.</div>';
  if (d.mode === 'loss') {
    const hot = d.wards.slice().sort((a, b) => b.lossHa - a.lossHa).slice(0, 8);
    const chip = (w) => `<span>${escapeHtml(w.name)} <b>${fmtNum(w.lossHa)}</b></span>`;
    return `<div class="flood-kpi"><span>Tán cây năm 2000</span><b>≈ ${fmtNum(d.city.coverHa)} ha</b></div>
      <div class="flood-kpi"><span>Mất rừng 2001–2025</span><b>≈ ${fmtNum(d.city.lossHa)} ha</b></div>
      <div class="flood-sub">Phường, xã mất nhiều nhất (ha)</div><div class="flood-wards">${hot.map(chip).join('')}</div>
      <div class="flood-muted">${escapeHtml(d.source)}. Ước tính vệ tinh, không phải ranh 3 loại rừng. Chưa đối chiếu từng lô đồ án.</div>`;
  }
  const keys = d.classes || [];
  const rows = keys.map(c => `<span>${escapeHtml(c.name)} <b>${fmtNum(d.city[c.key])}</b></span>`).join('');
  const top = d.wards.slice().sort((a, b) => (b.tree || 0) - (a.tree || 0)).slice(0, 6)
    .map(w => `<span>${escapeHtml(w.name)} <b>${fmtNum(w.tree)}</b></span>`).join('');
  return `<div class="flood-kpi"><span>Cây che phủ toàn thành phố</span><b>≈ ${fmtNum(d.city.tree)} ha</b></div>
    <div class="flood-sub">Toàn thành phố (ha)</div><div class="flood-wards">${rows}</div>
    <div class="flood-sub">Phường, xã nhiều cây che phủ nhất (ha)</div><div class="flood-wards">${top}</div>
    <div class="flood-muted">${escapeHtml(d.source)}. Ước tính vệ tinh, không phải ranh 3 loại rừng. Chưa đối chiếu từng lô đồ án.</div>`;
}

function lstLegend(legend) {
  const mid = Math.round((legend.min + legend.max) / 2);
  return rampHtml(legend.palette, [`≤ ${legend.min}`, mid, `≥ ${legend.max} °C`], 'Nhiệt độ bề mặt trung vị tháng 4–8 (°C)');
}

// ---------- Thống kê ----------
function sarStats(d, rt) {
  const byId = new Map(state.rawDataList.map(it => [it.id, it]));
  const list = d.ids.map(id => byId.get(id)).filter(Boolean);
  rt.shown = list;
  const pct = d.popAll ? ` (${fmtNum(Math.round(d.pop / d.popAll * 1000) / 10)}%)` : '';
  const wards = d.wards.slice(0, 5).map(w => `<span>${escapeHtml(w.name)} <b>${fmtNum(Math.round(w.pop / 10) * 10)}</b></span>`).join('');
  const rows = list.slice(0, MAX_LIST).map((it, i) => {
    const color = BUFFER_COLORS[layerType(it)] || '#94a3b8';
    return `<button type="button" class="flood-row" data-i="${i}" title="Phóng tới công trình"><i style="background:${color}"></i><span>${escapeHtml(it.name || 'Công trình')}</span></button>`;
  }).join('');
  return `<div class="flood-kpi"><span>Diện tích ngập</span><b>≈ ${fmtNum(Math.round(d.area / 1e5) / 10)} km²</b></div>
    <div class="flood-kpi"><span>Dân cư trong vùng ngập</span><b>≈ ${fmtNum(Math.round(d.pop / 10) * 10)} người${pct}</b></div>
    ${wards ? `<div class="flood-sub">Phường/xã ảnh hưởng nhiều nhất</div><div class="flood-wards">${wards}</div>` : ''}
    <div class="flood-sub">Công trình hiện trạng trong vùng ngập <b class="sat-count">${list.length}</b></div>
    ${rows ? `<div class="flood-list">${rows}</div>` : '<div class="flood-muted">Không có công trình đã duyệt nằm trong vùng ngập.</div>'}
    ${list.length > MAX_LIST ? `<div class="flood-muted">... và ${list.length - MAX_LIST} công trình khác</div>` : ''}
    <div class="flood-muted">Radar khó thấy ngập giữa nhà cửa dày đặc, số liệu khu đô thị là cận dưới.</div>`;
}

function lstStats(d) {
  const hot = d.wards.slice().sort((a, b) => b.mean - a.mean);
  const chip = (w) => `<span>${escapeHtml(w.name)} <b>${fmtNum(w.mean)}°</b></span>`;
  return `<div class="flood-kpi"><span>Trung bình toàn thành phố</span><b>${d.city == null ? '—' : `${fmtNum(d.city)} °C`}</b></div>
    <div class="flood-sub">Nóng nhất</div><div class="flood-wards sat-hot">${hot.slice(0, 5).map(chip).join('')}</div>
    <div class="flood-sub">Mát nhất</div><div class="flood-wards sat-cool">${hot.slice(-3).reverse().map(chip).join('')}</div>
    <div class="flood-muted">Nhiệt độ mặt đất lúc vệ tinh bay qua (~10 giờ sáng), không phải nhiệt độ không khí.</div>`;
}

// ---------- Hiển thị ----------
function opacityOf(cfg) {
  const el = $(cfg.ids.opacity);
  return el ? el.value / 100 : 0.7;
}

// track(layers): gắn đếm ô cho các layer đổi ảnh trên bản đồ đang thấy, gọi trước khi thêm / đổi URL để không sót ô đầu.
// Cùng URL thì Leaflet không vẽ lại, dưới minZoom không tải ô: không đếm
function setLayerUrl(cfg, rt, tile, track) {
  const url = tile.urlFormat;
  const opts = geeTileOpts({
    minZoom: tile.minZoom || cfg.minZoom || 0,
    maxNativeZoom: tile.maxNativeZoom || cfg.maxNativeZoom,
    opacity: opacityOf(cfg),
    zIndex: cfg.zIndex,
    bounds: HUE_TILE_BOUNDS,
    className: 'gee-sat-tile',
    keepBuffer: 1,
    updateWhenZooming: false
  });
  const changed = rt.url !== url;
  rt.url = url;
  const shown = shownMaps();
  const sides = [['left', map], ['right', planMap]].filter(([, m]) => m)
    .map(([side, m]) => ({ side, m, fresh: !rt[side], layer: rt[side] || watchTiles(geeTileLayer(url, opts), cfg.label) }));
  if (track) track(sides.filter(s => changed && shown.includes(s.m) && s.m.getZoom() >= opts.minZoom).map(s => s.layer));
  sides.forEach(({ side, m, fresh, layer }) => {
    if (fresh) rt[side] = layer.addTo(m);
    else if (changed) layer.setUrl(url);
  });
}

async function show(key) {
  const cfg = LAYERS[key], rt = runtime[key];
  const seq = ++rt.seq;
  const year = rt.year;
  const statsEl = $(cfg.ids.stats), legendEl = $(cfg.ids.legend);
  if (statsEl) statsEl.innerHTML = '<div class="flood-muted">Đang tính trên Google Earth Engine...</div>';
  rt.task?.cancel();
  const task = rt.task = startTaskProgress(`Đang tính ${cfg.label} (GEE)`);
  task.creep(SERVER_PCT, SERVER_TAU_MS);
  try {
    const tile = await cached(rt.tiles, year, () => getJson(cfg.tileQuery(year)).then(d => {
      if (!d.urlFormat) throw new Error('máy chủ chưa hỗ trợ lớp này');
      return d;
    }));
    if (seq !== rt.seq || !rt.visible) { task.cancel(); return; }
    task.done();
    setLayerUrl(cfg, rt, tile);
    rt.legend = tile.legend;
    if (legendEl) legendEl.innerHTML = cfg.renderLegend(tile.legend, year);
  } catch (err) {
    if (seq === rt.seq) {
      task.fail(`Không tải được ${cfg.label}`);
      if (statsEl) statsEl.innerHTML = `<div class="flood-muted">Không tải được ảnh vệ tinh: ${escapeHtml(err.message)}</div>`;
    } else {
      task.cancel();
    }
    return;
  }
  let q = cfg.statsQuery(year);
  if (!q) {
    if (statsEl) statsEl.innerHTML = '<div class="flood-muted">Màu càng đậm = càng nhiều mùa lũ bị ngập. Chọn 1 năm để xem số liệu theo phường.</div>';
    return;
  }
  const popStats = key === 'sar' || key === 'dev';
  if (popStats) q += `&pop=${encodeURIComponent(popQuery())}`;
  if (statsEl) statsEl.innerHTML = '<div class="flood-muted">Đang thống kê theo phường/xã (có thể mất 10–30 giây lần đầu)...</div>';
  try {
    const statsKey = popStats ? `${year}|${popQuery()}` : year;
    const d = await cached(rt.stats, statsKey, () => (cfg.loadStats ? cfg.loadStats(year) : getJson(q)));
    if (d && d.rawDataList && !d.wards && !d.city) throw new Error('máy chủ chưa hỗ trợ thống kê này');
    if (seq !== rt.seq || !rt.visible || !statsEl) return;
    statsEl.innerHTML = cfg.renderStats(d, rt);
  } catch (err) {
    if (seq === rt.seq && statsEl) statsEl.innerHTML = `<div class="flood-muted">Chưa thống kê được: ${escapeHtml(err.message)}</div>`;
  }
}

function setVisible(key, on) {
  const cfg = LAYERS[key], rt = runtime[key];
  rt.visible = !!on;
  [cfg.ids.box, cfg.ids.opBox].forEach(id => { const el = $(id); if (el) el.style.display = rt.visible ? '' : 'none'; });
  if (rt.visible) {
    show(key);
  } else {
    rt.seq++;
    rt.task?.cancel(); rt.task = null;
    rt.left?.remove(); rt.left = null;
    rt.right?.remove(); rt.right = null;
    rt.url = null;
  }
}

function fillYears(cfg, rt) {
  const sel = $(cfg.ids.year);
  const { years, partial, def } = cfg.seasons();
  rt.year = String(def);
  if (!sel) return;
  const text = (y) => (cfg.yearText ? cfg.yearText(y) : `${y}${y === partial ? ' (đang cập nhật)' : ''}`);
  sel.innerHTML = years.map(y => `<option value="${y}"${String(y) === rt.year ? ' selected' : ''}>${text(y)}</option>`).join('')
    + cfg.extra.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
}

/** Dòng chú giải cho khung in A3 (printLayout.js) của các lớp vệ tinh đang bật */
export function satPrintLegend() {
  const out = [];
  const sar = runtime.sar, lst = runtime.lst;
  if (sar?.visible && sar.legend) {
    out.push(sar.legend.palette
      ? `<div class="pa3-lg-ramp"><div class="pa3-lg-ramp-title">Số mùa lũ bị ngập (Sentinel-1)</div><div class="pa3-lg-bar" style="background:linear-gradient(to right, ${sar.legend.palette.join(', ')})"></div></div>`
      : `<div class="pa3-lg-row"><i class="pa3-lg-sym" style="background:${sar.legend.color}"></i>Vùng ngập mùa lũ ${escapeHtml(sar.year)} (Sentinel-1)</div>`);
  }
  if (lst?.visible && lst.legend) {
    const l = lst.legend;
    out.push(`<div class="pa3-lg-ramp"><div class="pa3-lg-ramp-title">Nhiệt độ bề mặt tháng 4–8/${escapeHtml(lst.year)} (Landsat, °C)</div>
      <div class="pa3-lg-bar" style="background:linear-gradient(to right, ${l.palette.join(', ')})"></div>
      <div class="pa3-lg-ticks"><span>≤ ${l.min}</span><span>${Math.round((l.min + l.max) / 2)}</span><span>≥ ${l.max}</span></div></div>`);
  }
  const ndvi = runtime.ndvi;
  if (ndvi?.visible && ndvi.legend) {
    const l = ndvi.legend;
    const title = l.diff ? `NDVI ${l.year} − ${l.compare} (Sentinel-2)` : `NDVI ${ndvi.year} (Sentinel-2)`;
    out.push(`<div class="pa3-lg-ramp"><div class="pa3-lg-ramp-title">${escapeHtml(title)}</div>
      <div class="pa3-lg-bar" style="background:linear-gradient(to right, ${l.palette.join(', ')})"></div></div>`);
  }
  const forest = runtime.forest;
  if (forest?.visible && forest.legend) {
    const l = forest.legend;
    if (l.palette) {
      out.push(`<div class="pa3-lg-ramp"><div class="pa3-lg-ramp-title">${escapeHtml(l.title || 'Mất rừng')}</div>
        <div class="pa3-lg-bar" style="background:linear-gradient(to right, ${l.palette.join(', ')})"></div></div>`);
    } else {
      (l.classes || []).forEach(c => out.push(`<div class="pa3-lg-row"><i class="pa3-lg-sym" style="background:${c.color}"></i>${escapeHtml(c.name)}</div>`));
    }
  }
  const dev = runtime.dev;
  if (dev?.visible && dev.legend) {
    const l = dev.legend;
    out.push(`<div class="pa3-lg-row"><i class="pa3-lg-sym" style="background:${l.baseColor}"></i>Vùng hiện trạng (đã xây dựng đến ${l.from}, GAIA/GHSL)</div>`);
    out.push(`<div class="pa3-lg-row"><i class="pa3-lg-sym" style="background:${l.color}"></i>Vùng phát triển mới ${l.from} → ${l.to[1]} (Dynamic World)</div>`);
  }
  return out.join('');
}

export function initSatLayers() {
  if (!map) return;
  Object.entries(LAYERS).forEach(([key, cfg]) => {
    const rt = runtime[key] = { visible: false, year: null, left: null, right: null, url: null, task: null, tiles: new Map(), stats: new Map(), legend: null, seq: 0, shown: [] };
    fillYears(cfg, rt);
    $(cfg.ids.chk)?.addEventListener('change', (e) => setVisible(key, e.target.checked));
    $(cfg.ids.year)?.addEventListener('change', () => {
      rt.year = cfg.yearKey ? cfg.yearKey() : $(cfg.ids.year).value;
      if (rt.visible) show(key);
    });
    if (cfg.ids.compare) {
      const cmp = $(cfg.ids.compare);
      if (cmp) {
        const { years } = cfg.seasons();
        cmp.innerHTML = '<option value="">Không so sánh</option>' + years.map(y => `<option value="${y}">so với ${y}</option>`).join('');
        cmp.addEventListener('change', () => {
          rt.year = cfg.yearKey();
          if (rt.visible) show(key);
        });
      }
    }
    $(cfg.ids.opacity)?.addEventListener('input', () => {
      const o = opacityOf(cfg);
      rt.left?.setOpacity(o);
      rt.right?.setOpacity(o);
    });
    $(cfg.ids.stats)?.addEventListener('click', (e) => {
      const row = e.target.closest('.flood-row');
      const it = row && rt.shown[Number(row.dataset.i)];
      if (it) flyToVisible([Number(it.lat), Number(it.lng)], 17);
    });
  });
}
