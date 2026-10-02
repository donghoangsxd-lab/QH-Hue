// Lớp vệ tinh (bảng lớp dữ liệu): vùng ngập thực tế mùa lũ (radar Sentinel-1), nhiệt độ bề mặt mùa nóng (Landsat 8/9)
// và vùng phát triển mới (Dynamic World, newDev.js).
// Ảnh tính trên Google Earth Engine (api/gee.js › getSarFloodTile / getLstTile, services/satService.js), vẽ đồng thời trên
// bản đồ hiện trạng và quy hoạch; thống kê theo phường chỉ tải khi bật lớp, mỗi năm 1 lần.
import { map, flyToVisible } from './mapEngine.js';
import { planMap } from './planMap.js';
import { state, BUFFER_COLORS, layerType } from './state.js';
import { geeApi } from './api.js';
import { escapeHtml, fmtNum } from './utils.js';
import { devFromYears, loadNewDevStats, devLegend, devStats, DEV_MIN_ZOOM } from './newDev.js';

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

const LAYERS = {
  sar: {
    ids: { chk: 'chk_sarflood', box: 'sarFloodBox', opBox: 'sarFloodOpBox', opacity: 'sarFloodOpacity', year: 'sarFloodYear', legend: 'sarFloodLegend', stats: 'sarFloodStats' },
    zIndex: 3,
    seasons: sarSeasons,
    extra: [['all', 'Số mùa lũ bị ngập (mọi năm)']],
    tileQuery: (y) => `action=getSarFloodTile&year=${y}`,
    statsQuery: (y) => (y === 'all' ? null : `action=getSarFloodStats&year=${y}`),
    renderLegend: sarLegend,
    renderStats: sarStats
  },
  lst: {
    ids: { chk: 'chk_lst', box: 'lstBox', opBox: 'lstOpBox', opacity: 'lstOpacity', year: 'lstYear', legend: 'lstLegend', stats: 'lstStats' },
    zIndex: 1,
    seasons: lstSeasons,
    extra: [],
    tileQuery: (y) => `action=getLstTile&year=${y}`,
    statsQuery: (y) => `action=getLstStats&year=${y}`,
    renderLegend: lstLegend,
    renderStats: lstStats
  },
  dev: {
    ids: { chk: 'chk_newdev', box: 'newDevBox', opBox: 'newDevOpBox', opacity: 'newDevOpacity', year: 'newDevYear', legend: 'newDevLegend', stats: 'newDevStats' },
    zIndex: 2,
    minZoom: DEV_MIN_ZOOM,
    seasons: devFromYears,
    extra: [],
    tileQuery: (y) => `action=getNewDevTile&from=${y}`,
    statsQuery: (y) => `action=getNewDevStats&from=${y}`,
    loadStats: loadNewDevStats,
    renderLegend: devLegend,
    renderStats: devStats
  }
};

const runtime = {};   // key → { visible, year, left, right, tiles: Map(năm → Promise), stats: Map(năm → Promise), legend, seq, shown }

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

function setLayerUrl(cfg, rt, url) {
  const opts = { maxZoom: 19, minZoom: cfg.minZoom || 0, opacity: opacityOf(cfg), zIndex: cfg.zIndex };
  if (rt.left) rt.left.setUrl(url); else rt.left = L.tileLayer(url, opts).addTo(map);
  if (planMap) {
    if (rt.right) rt.right.setUrl(url); else rt.right = L.tileLayer(url, opts).addTo(planMap);
  }
}

async function show(key) {
  const cfg = LAYERS[key], rt = runtime[key];
  const seq = ++rt.seq;
  const year = rt.year;
  const statsEl = $(cfg.ids.stats), legendEl = $(cfg.ids.legend);
  if (statsEl) statsEl.innerHTML = '<div class="flood-muted">Đang tính trên Google Earth Engine...</div>';
  try {
    const tile = await cached(rt.tiles, year, () => getJson(cfg.tileQuery(year)).then(d => {
      if (!d.urlFormat) throw new Error('máy chủ chưa hỗ trợ lớp này');
      return d;
    }));
    if (seq !== rt.seq || !rt.visible) return;
    setLayerUrl(cfg, rt, tile.urlFormat);
    rt.legend = tile.legend;
    if (legendEl) legendEl.innerHTML = cfg.renderLegend(tile.legend, year);
  } catch (err) {
    if (seq === rt.seq && statsEl) statsEl.innerHTML = `<div class="flood-muted">Không tải được ảnh vệ tinh: ${escapeHtml(err.message)}</div>`;
    return;
  }
  const q = cfg.statsQuery(year);
  if (!q) {
    if (statsEl) statsEl.innerHTML = '<div class="flood-muted">Màu càng đậm = càng nhiều mùa lũ bị ngập. Chọn 1 năm để xem số liệu theo phường.</div>';
    return;
  }
  if (statsEl) statsEl.innerHTML = '<div class="flood-muted">Đang thống kê theo phường/xã (có thể mất 10–30 giây lần đầu)...</div>';
  try {
    const d = await cached(rt.stats, year, () => (cfg.loadStats ? cfg.loadStats(year) : getJson(q)));
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
    rt.left?.remove(); rt.left = null;
    rt.right?.remove(); rt.right = null;
  }
}

function fillYears(cfg, rt) {
  const sel = $(cfg.ids.year);
  const { years, partial, def } = cfg.seasons();
  rt.year = String(def);
  if (!sel) return;
  sel.innerHTML = years.map(y => `<option value="${y}"${String(y) === rt.year ? ' selected' : ''}>${y}${y === partial ? ' (đang cập nhật)' : ''}</option>`).join('')
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
  const dev = runtime.dev;
  if (dev?.visible && dev.legend) {
    const l = dev.legend;
    out.push(`<div class="pa3-lg-row"><i class="pa3-lg-sym" style="background:${l.color}"></i>Phát triển mới sau ${l.from} (Dynamic World ${l.to[1]} − GAIA ${l.from})</div>`);
  }
  return out.join('');
}

export function initSatLayers() {
  if (!map) return;
  Object.entries(LAYERS).forEach(([key, cfg]) => {
    const rt = runtime[key] = { visible: false, year: null, left: null, right: null, tiles: new Map(), stats: new Map(), legend: null, seq: 0, shown: [] };
    fillYears(cfg, rt);
    $(cfg.ids.chk)?.addEventListener('change', (e) => setVisible(key, e.target.checked));
    $(cfg.ids.year)?.addEventListener('change', (e) => {
      rt.year = e.target.value;
      if (rt.visible) show(key);
    });
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
