// Phân tích sử dụng đất quy hoạch trong vùng đo diện tích. Lấy mẫu lưới đều trong polygon đo (≈ SAMPLE_MAX điểm),
// mỗi điểm mẫu nhận loại đất của lô QH chứa nó; diện tích loại = tỷ lệ điểm mẫu × diện tích đo.
// Các đồ án chồng nhau (quy hoạch phân khu chứa quy hoạch chi tiết, bản điều chỉnh…): ưu tiên đồ án có ranh tổng nhỏ hơn
// (chi tiết hơn), lô QH theo phường xếp cuối. Phần không rơi vào lô nào ghi "Chưa có lô quy hoạch".
// Điểm trong lô tính theo hàng (scanline, chẵn-lẻ): lô hàng nghìn đỉnh chỉ cắt mỗi hàng mẫu 1 lần.
// Một thửa địa chính (analyzeParcelPlan) ít lô nên cắt hình học chính xác thay cho lấy mẫu, cùng thứ tự ưu tiên.
import { state, infraLabels, BUFFER_COLORS, layerType, getPlanScenarioList } from './state.js';
import { planLotsIn } from './projectFiles.js';
import { landLabel, landColor, landPatternKey, infraStyleKey, tt16SwatchCss, TT16_STYLES } from './tt16Symbols.js';
import { escapeHtml, fmtNum, planItems } from './utils.js';
import { landCode } from './mapEngine.js';
import { namesOfProject } from './projectNames.js';
import { planLevelOf } from './generalPlan.js';
import { MIX_NOISE_PCT, presentLandMix } from './planMix.js';

const SAMPLE_MAX = 40000;
// Lưới phủ cả khung bao: vùng đo mảnh, chéo thì khung lớn hơn nhiều polygon, giới hạn số ô để không tràn bộ nhớ
const GRID_MAX = SAMPLE_MAX * 6;
const M_PER_DEG = 111320;
const NONE_COLOR = '#475569';

function polysOf(g) {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  if (g.type === 'GeometryCollection') return (g.geometries || []).flatMap(polysOf);
  return [];
}

// Gọi visit(chỉ số ô) cho các điểm mẫu nằm trong polys (luật chẵn-lẻ trên mọi vòng: lỗ thủng tự trừ ra)
function scanPolys(polys, b, grid, visit) {
  const { x0, y0, dx, dy, nx, ny } = grid;
  const r0 = Math.max(0, Math.ceil((b[1] - y0) / dy - 0.5));
  const r1 = Math.min(ny - 1, Math.floor((b[3] - y0) / dy - 0.5));
  const xs = [];
  for (let r = r0; r <= r1; r++) {
    const y = y0 + (r + 0.5) * dy;
    xs.length = 0;
    polys.forEach(p => p.forEach(ring => {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const yi = ring[i][1];
        const yj = ring[j][1];
        if ((yi > y) !== (yj > y)) xs.push(ring[i][0] + ((ring[j][0] - ring[i][0]) * (y - yi)) / (yj - yi));
      }
    }));
    if (xs.length < 2) continue;
    xs.sort((a, c) => a - c);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - x0) / dx - 0.5));
      const c1 = Math.min(nx - 1, Math.ceil((xs[k + 1] - x0) / dx - 0.5) - 1);
      for (let c = c0; c <= c1; c++) visit(r * nx + c);
    }
  }
}

function boxOf(polys) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  polys.forEach(p => (p[0] || []).forEach(([x, y]) => {
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x;
    if (y > b[3]) b[3] = y;
  }));
  return b;
}

const boxArea = (b) => (Array.isArray(b) ? Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]) : Infinity);

// Loại đất của lô: lô đất đọc như popup lô (nhóm đất, "Đất khác" thì tên ký hiệu TT16); lô công trình theo loại hạ tầng
function lotClass(lot, byId) {
  if (lot.kind !== 'DXF') {
    const item = byId.get(lot.id);
    const code = item ? layerType(item) : '';
    const key = code ? infraStyleKey(code, lot.layer, item.name) : landPatternKey(lot.layer, lot.name);
    const s = key && TT16_STYLES[key];
    if (s || code) return { label: s ? s.label : infraLabels[code] || code, color: s ? s.color : BUFFER_COLORS[code] || '#94a3b8', key: s ? key : '' };
  }
  const key = landPatternKey(lot.layer, lot.name);
  const nhom = lot.nhom || landLabel(lot.layer);
  if (nhom === 'Đất khác' && TT16_STYLES[key]) return { label: TT16_STYLES[key].label, color: TT16_STYLES[key].color, key };
  // Giữ key TT16 để ô hatch trong bảng / chú giải pie, dù nhãn đã gom theo nhóm đất.
  return { label: nhom, color: landColor(lot.layer) || (TT16_STYLES[key] || {}).color || '#94a3b8', key: key || '' };
}

// Lô QH giao khung box, xếp theo thứ tự ưu tiên (lô đứng trước giữ phần chồng lấn).
// opts.level khác QHPK: không cộng lô phường (lô không gắn đồ án, không thuộc cấp đó)
async function lotsInBox(box, opts = {}) {
  const { projects, wardLots } = await planLotsIn(box, opts);
  projects.sort((a, b) => boxArea(a.bbox) - boxArea(b.bbox));
  const byId = new Map([...state.rawDataList, ...state.planDataList, ...getPlanScenarioList()].map(it => [it.id, it]));
  const seenIds = new Set();
  const lots = [];
  const push = (lot) => {
    const polys = polysOf(lot.geometry);
    if (!polys.length) return;
    const b = boxOf(polys);
    if (b[0] > box[2] || b[2] < box[0] || b[1] > box[3] || b[3] < box[1]) return;
    lots.push({ lot, polys, b });
  };
  projects.forEach(p => p.lots.forEach(lot => {
    if (lot.kind !== 'DXF') seenIds.add(lot.id);
    push(lot);
  }));
  if (!opts.level || opts.level === 'QHPK') {
    wardLots.forEach(lot => { if (lot.kind === 'DXF' || !seenIds.has(lot.id)) push(lot); });
  }
  return { projects, lots, byId };
}

/**
 * ring: vòng polygon đo [[lng, lat], …] (đã khép). → { area, rows: [{ label, color, key, area, pct, lots }], none,
 * lotCount, projects: [tên đồ án có lô trong vùng], step (m) }
 */
export async function analyzePlanLand(ring) {
  const area = turf.area(turf.polygon([ring]));
  const box = boxOf([[ring]]);
  const { projects, lots, byId } = await lotsInBox(box);

  const midLat = (box[1] + box[3]) / 2;
  const mx = M_PER_DEG * Math.cos(midLat * Math.PI / 180);
  const boxM2 = (box[2] - box[0]) * mx * (box[3] - box[1]) * M_PER_DEG;
  const step = Math.max(0.5, Math.sqrt(area / SAMPLE_MAX), Math.sqrt(boxM2 / GRID_MAX));
  const dy = step / M_PER_DEG;
  const dx = step / mx;
  const grid = { x0: box[0], y0: box[1], dx, dy, nx: Math.max(1, Math.ceil((box[2] - box[0]) / dx)), ny: Math.max(1, Math.ceil((box[3] - box[1]) / dy)) };

  // owner: -2 ngoài vùng đo, -1 trong vùng đo chưa có lô, ≥ 0 chỉ số lô (lô ưu tiên cao quét trước, giữ ô)
  const owner = new Int32Array(grid.nx * grid.ny).fill(-2);
  let total = 0;
  scanPolys([[ring]], box, grid, (i) => { owner[i] = -1; total++; });
  if (!total) {
    const [x, y] = turf.pointOnFeature(turf.polygon([ring])).geometry.coordinates;
    const c = Math.min(grid.nx - 1, Math.max(0, Math.floor((x - box[0]) / dx)));
    const r = Math.min(grid.ny - 1, Math.max(0, Math.floor((y - box[1]) / dy)));
    owner[r * grid.nx + c] = -1;
    total = 1;
  }
  lots.forEach((l, idx) => scanPolys(l.polys, l.b, grid, (i) => { if (owner[i] === -1) owner[i] = idx; }));

  const hits = new Map();
  let none = 0;
  owner.forEach(v => {
    if (v === -1) none++;
    else if (v >= 0) hits.set(v, (hits.get(v) || 0) + 1);
  });

  const per = area / total;
  const rows = new Map();
  const files = new Set();
  hits.forEach((n, idx) => {
    const { lot } = lots[idx];
    const c = lotClass(lot, byId);
    const row = rows.get(c.label) || rows.set(c.label, { ...c, n: 0, lots: 0 }).get(c.label);
    row.n += n;
    row.lots++;
    if (lot.file) files.add(lot.file);
  });
  const list = [...rows.values()]
    .map(r => ({ label: r.label, color: r.color, key: r.key, lots: r.lots, area: r.n * per, pct: (r.n / total) * 100 }))
    .sort((a, b) => b.area - a.area);
  return {
    area,
    rows: list,
    none: { area: none * per, pct: (none / total) * 100 },
    lotCount: hits.size,
    projects: projects.map(p => p.tenQH).filter(n => files.has(n)),
    step
  };
}

// Mảnh giao nhỏ hơn ngưỡng là vệt lệch ranh giữa thửa địa chính và lô CAD, không tính thành loại đất
const SLIVER_M2 = 0.5;

const closeRing = (r) => (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) ? [...r, r[0]] : r);

function geomPieces(feature) {
  if (!feature) return [];
  const g = feature.type === 'Feature' ? feature.geometry : feature;
  if (!g?.type) return [];
  if (g.type === 'GeometryCollection') return (g.geometries || []).flatMap(geomPieces);
  if (g.type === 'FeatureCollection') return (g.features || []).flatMap(geomPieces);
  return [g];
}

function pushGeom(bucket, key, feature) {
  const bits = geomPieces(feature);
  if (!bits.length || !key) return;
  if (!bucket[key]) bucket[key] = [];
  bucket[key].push(...bits);
}

function nonePieces(rest) {
  if (!rest) return [];
  try {
    return turf.area(rest) >= SLIVER_M2 ? geomPieces(rest) : [];
  } catch {
    return [];
  }
}
const toFeature = (polys) => {
  const ps = polys.map(p => p.map(closeRing)).filter(p => p[0] && p[0].length >= 4);
  return ps.length === 1 ? turf.polygon(ps[0]) : turf.multiPolygon(ps);
};

/**
 * Loại đất QH trên 1 thửa, cắt hình học chính xác: phần thửa còn lại lần lượt giao với lô theo thứ tự ưu tiên.
 * geometry: Polygon | MultiPolygon (WGS84). opts.level / includeHidden truyền cho planLotsIn.
 * opts.extras: lô tĩnh cắt sau đồ án nhập [{ geometry, label, color, key, name, sub, file }].
 * → như analyzePlanLand, thêm exact: true và parts từng lô. Cắt theo cấp thì không lấy mẫu lưới (tránh lẫn cấp khác).
 */
export async function analyzeParcelPlan(geometry, opts = {}) {
  const polys = polysOf(geometry);
  if (!polys.length) throw new Error('thửa không có hình');
  const parcel = toFeature(polys);
  const area = turf.area(parcel);
  const box = boxOf(polys);
  const { projects, lots, byId } = await lotsInBox(box, opts);
  const extras = (opts.extras || []).flatMap(extra => {
    const ep = polysOf(extra.geometry);
    if (!ep.length) return [];
    const b = boxOf(ep);
    if (b[0] > box[2] || b[2] < box[0] || b[1] > box[3] || b[3] < box[1]) return [];
    return [{ extra, polys: ep }];
  });

  let rest = parcel;
  const parts = [];
  try {
    for (const { lot, polys: lp } of lots) {
      if (!rest) break;
      const shape = toFeature(lp);
      const inter = turf.intersect(rest, shape);
      const a = inter ? turf.area(inter) : 0;
      if (a < SLIVER_M2) continue;
      parts.push({ lot, area: a, geom: inter });
      rest = turf.difference(rest, shape);
    }
    for (const { extra, polys: lp } of extras) {
      if (!rest) break;
      try {
        const shape = toFeature(lp);
        const inter = turf.intersect(rest, shape);
        const a = inter ? turf.area(inter) : 0;
        if (a < SLIVER_M2) continue;
        parts.push({ extra, area: a, geom: inter });
        rest = turf.difference(rest, shape) || null;
      } catch (err) {
        console.warn('Cắt thửa bỏ qua một lô tĩnh:', err);
      }
    }
  } catch (err) {
    console.warn('Cắt hình thửa với lô QH lỗi, chuyển sang lấy mẫu lưới:', err);
    if (opts.level || extras.length) throw err;
    const res = await analyzePlanLand(closeRing(polys[0][0]));
    return { ...res, exact: false, parts: [], shapes: { byLabel: {}, none: [] } };
  }

  const files = new Set();
  const rows = new Map();
  const byLabel = {};
  const detail = parts.map((part) => {
    const a = part.area;
    if (part.extra) {
      const c = part.extra;
      const row = rows.get(c.label) || rows.set(c.label, { label: c.label, color: c.color, key: c.key || '', area: 0, lots: 0 }).get(c.label);
      row.area += a;
      row.lots++;
      if (c.file) files.add(c.file);
      pushGeom(byLabel, c.label, part.geom);
      return {
        lot: { file: c.file || '', plan: null, layer: c.label || '', name: c.name || '' },
        name: c.name || c.label, label: c.label,
        color: c.color, key: c.key || '', sub: c.sub || '', desc: c.desc || '', area: a, pct: (a / area) * 100,
        geom: part.geom, sourceGeom: c.geometry || null
      };
    }
    const { lot } = part;
    const c = lotClass(lot, byId);
    const row = rows.get(c.label) || rows.set(c.label, { ...c, area: 0, lots: 0 }).get(c.label);
    row.area += a;
    row.lots++;
    pushGeom(byLabel, c.label, part.geom);
    if (lot.file) files.add(lot.file);
    const item = lot.kind !== 'DXF' ? byId.get(lot.id) : null;
    return {
      lot, name: item ? item.name : landCode(lot), ...c, sub: '', area: a, pct: (a / area) * 100,
      geom: part.geom, sourceGeom: lot.geometry || null
    };
  });
  const covered = parts.reduce((s, p) => s + p.area, 0);
  const none = Math.max(0, area - covered);
  return {
    area,
    rows: [...rows.values()].map(r => ({ ...r, pct: (r.area / area) * 100 })).sort((a, b) => b.area - a.area),
    none: { area: none, pct: (none / area) * 100 },
    lotCount: parts.length,
    projects: projects.map(p => p.tenQH).filter(n => files.has(n)),
    exact: true,
    parts: detail.sort((a, b) => b.area - a.area),
    shapes: { byLabel, none: nonePieces(rest) }
  };
}

/**
 * Thửa cắt với lớp vùng QHC (lô 1/10.000, vùng 1/25.000). features theo thứ tự vẽ: vùng vẽ sau nằm trên giữ phần
 * chồng lấn, như khi bấm lô trên bản đồ. classify(f) → { label, color, key, name, sub, desc }.
 * → { area, rows: [{ label, color, key, area, pct, lots }], none, parts: [{ …classify, area, pct }] }
 */
export function analyzeParcelZones(geometry, features, classify) {
  const polys = polysOf(geometry);
  if (!polys.length) throw new Error('thửa không có hình');
  const parcel = toFeature(polys);
  const area = turf.area(parcel);
  const box = boxOf(polys);
  let rest = parcel;
  const parts = [];
  const byLabel = {};
  for (let i = features.length - 1; i >= 0 && rest; i--) {
    const fp = polysOf(features[i].geometry);
    if (!fp.length) continue;
    const b = boxOf(fp);
    if (b[0] > box[2] || b[2] < box[0] || b[1] > box[3] || b[3] < box[1]) continue;
    const shape = toFeature(fp);
    const inter = turf.intersect(rest, shape);
    const a = inter ? turf.area(inter) : 0;
    if (a < SLIVER_M2) continue;
    const info = classify(features[i]);
    parts.push({ ...info, area: a, pct: (a / area) * 100 });
    pushGeom(byLabel, info.label, inter);
    rest = turf.difference(rest, shape);
  }
  const rows = new Map();
  parts.forEach(p => {
    const row = rows.get(p.label) || rows.set(p.label, { label: p.label, color: p.color, key: p.key, area: 0, lots: 0 }).get(p.label);
    row.area += p.area;
    row.lots++;
  });
  const none = Math.max(0, area - parts.reduce((s, p) => s + p.area, 0));
  return {
    area,
    rows: [...rows.values()].map(r => ({ ...r, pct: (r.area / area) * 100 })).sort((a, b) => b.area - a.area),
    none: { area: none, pct: (none / area) * 100 },
    parts: parts.sort((a, b) => b.area - a.area),
    shapes: { byLabel, none: nonePieces(rest) }
  };
}

const fmtArea = (m2) => (m2 >= 10000 ? `${fmtNum(m2 / 10000)} ha` : `${fmtNum(Math.round(m2))} m²`);
const fmtM2 = (m2) => `${fmtNum(Math.round(m2))} m²`;
const fmtPct = (p) => (p > 0 && p < 0.05 ? `<${fmtNum(0.1)}%` : `${fmtNum(Math.round(p * 10) / 10)}%`);

/** place 'measure': câu chữ bảng vùng đo; 'point': điểm bấm không có thửa; mặc định bảng thửa */
export function planPlace(place) {
  if (place === 'measure') {
    return { on: 'trong vùng đo', it: 'Vùng đo', cut: 'vùng đo', shape: 'Vùng đo', pie: 'trong vùng đo' };
  }
  if (place === 'invest') {
    return { on: 'trong ranh dự án', it: 'Ranh dự án', cut: 'ranh dự án', shape: 'Ranh dự án', pie: 'trong ranh dự án' };
  }
  if (place === 'point') {
    return { on: 'tại vị trí', it: 'Vị trí', cut: 'vị trí', shape: 'Vị trí', pie: 'tại vị trí' };
  }
  if (place === 'lot') {
    return {
      on: 'trên lô đất quy hoạch',
      it: 'Lô đất quy hoạch',
      cut: 'lô đất quy hoạch',
      shape: 'Lô đất quy hoạch',
      pie: 'trên lô đất quy hoạch'
    };
  }
  return { on: 'trên thửa đất', it: 'Thửa', cut: 'thửa', shape: 'Hình thửa', pie: 'trên thửa' };
}

function rowHtml(label, color, key, area, pct, sub = '', fmt = fmtArea) {
  return `<div class="pls-row" title="${escapeHtml(label)}">
    ${landMarksHtml(color, key)}
    <span class="pls-label">${escapeHtml(label)}${sub ? `<small>${sub}</small>` : ''}</span>
    <b>${fmt(area)}</b><em>${fmtPct(pct)}</em>
    <span class="pls-bar"><span style="width:${Math.min(100, pct)}%;background:${color};"></span></span>
  </div>`;
}

export function planLandHtml(res) {
  const covered = res.area - res.none.area;
  const head = `<div class="pls-head">Sử dụng đất quy hoạch trong vùng đo</div>
    <div class="pp-row"><span>Diện tích vùng đo</span><b>${fmtArea(res.area)}</b></div>
    <div class="pp-row"><span>Có lô quy hoạch</span><b>${fmtArea(covered)} (${fmtPct(100 - res.none.pct)}) · ${fmtNum(res.lotCount)} lô</b></div>`;
  if (!res.rows.length) {
    return `<div class="plan-land-stats">${head}<div class="sug-card ineligible">Vùng đo chưa có lô quy hoạch của đồ án nào đã nhập (hoặc đồ án đang bị ẩn).</div></div>`;
  }
  const rows = mixEntries(res, 'Chưa có lô quy hoạch', 'đường, mặt nước… chưa vẽ lô')
    .map(s => rowHtml(s.label, s.color, s.pattern, s.area, s.pct, s.lots != null ? `${fmtNum(s.lots)} lô` : (s.sub || ''))).join('');
  const shown = res.projects.slice(0, 3).map(escapeHtml).join('; ');
  const more = res.projects.length > 3 ? ` và ${res.projects.length - 3} đồ án khác` : '';
  return `<div class="plan-land-stats">${head}<div class="pls-list">${rows}</div>
    ${shown ? `<div class="pp-sub">Đồ án: ${shown}${more}</div>` : ''}
    <div class="pp-sub">≈ Lấy mẫu lưới ${fmtNum(Math.round(res.step * 10) / 10)} m; đồ án chồng nhau ưu tiên đồ án phạm vi nhỏ hơn (chi tiết hơn). Đồ án đang ẩn không tính.</div>
  </div>`;
}

// Biểu đồ tròn loại đất trên thửa. mountParcelPies đọc .pls-pie-data sau khi gắn HTML
const pieCharts = new Set();

function mixEntries(res, noneLabel, noneSub = '') {
  const slices = (res.rows || []).filter(r => r.area >= SLIVER_M2).map(r => ({
    key: r.label, label: r.label, color: r.color || '#94a3b8', pattern: r.key || '',
    area: r.area, pct: r.pct, lots: r.lots
  }));
  if (res.none && res.none.area >= SLIVER_M2) {
    slices.push({
      key: '__none', label: noneLabel, color: NONE_COLOR, pattern: '',
      area: res.none.area, pct: res.none.pct, lots: null, sub: noneSub
    });
  }
  return presentLandMix(slices);
}

function landMarksHtml(color, pattern) {
  const fill = `background:${color || '#94a3b8'};`;
  const hatch = (pattern && tt16SwatchCss(pattern, 0.55)) || '';
  return `<span class="pls-marks"><i class="pls-mark pls-mark-fill" style="${fill}" title="Màu"></i>${
    hatch ? `<i class="pls-mark pls-mark-hatch" style="${hatch}" title="Ký hiệu hatch"></i>` : ''
  }</span>`;
}

function pieHtml(res, noneLabel, where = 'trên thửa') {
  const slices = mixEntries(res, noneLabel);
  if (!slices.length) return '';
  const legend = slices.map(s => `<li><button type="button" class="pls-pie-item" data-land="${escapeHtml(s.key)}" data-color="${escapeHtml(s.color)}" title="${escapeHtml(s.label)} · ${fmtM2(s.area)} (${fmtPct(s.rawPct)}) · bấm để tô vùng trên bản đồ">
    ${landMarksHtml(s.color, s.pattern)}<span>${escapeHtml(s.label)}</span><em>${escapeHtml(fmtPct(s.pct))}</em>
  </button></li>`).join('');
  return `<div class="pls-pie-host">
    <div class="pls-pie-box"><canvas aria-label="Tỷ lệ các loại đất ${escapeHtml(where)}"></canvas></div>
    <ul class="pls-pie-legend">${legend}</ul>
    <div class="pls-pie-data" hidden>${escapeHtml(JSON.stringify(slices))}</div>
  </div>`;
}

export function clearParcelPies() {
  pieCharts.forEach(c => { try { c.destroy(); } catch { /* canvas đã gỡ */ } });
  pieCharts.clear();
}

export function mountParcelPies(root) {
  clearParcelPies();
  if (!root || typeof Chart === 'undefined') return;
  root.querySelectorAll('.pls-pie-host').forEach(host => {
    const canvas = host.querySelector('canvas');
    let slices = [];
    try { slices = JSON.parse(host.querySelector('.pls-pie-data')?.textContent || '[]'); } catch { slices = []; }
    if (!canvas || !slices.length) return;
    const chart = new Chart(canvas.getContext('2d'), {
      type: 'pie',
      data: {
        labels: slices.map(s => s.label),
        datasets: [{
          data: slices.map(s => s.area),
          backgroundColor: slices.map(s => s.color),
          borderColor: '#0f172a',
          borderWidth: 1,
          hoverOffset: 6,
          offset: slices.map(() => 0)
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { animateRotate: true, duration: 500 },
        onHover: (evt, els) => { if (evt.native?.target) evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
        onClick: (_evt, els) => {
          const s = slices[els?.[0]?.index];
          if (!s) return;
          host.dispatchEvent(new CustomEvent('pls-pick', { bubbles: true, detail: { key: s.key, color: s.color } }));
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const s = slices[ctx.dataIndex];
                const share = s.rawPct != null ? s.rawPct : s.pct;
                return ` ${s.label}: ${fmtM2(s.area)} (${fmtPct(share)})`;
              }
            }
          }
        }
      }
    });
    chart.$keys = slices.map(s => s.key);
    pieCharts.add(chart);
  });
}

const parcelHead = (title, res, recorded, coverLabel, count, unit, shape = 'Hình thửa') => {
  const covered = res.area - res.none.area;
  const sheet = recorded > 0 ? ` <small>(hồ sơ ${fmtNum(recorded)} m²)</small>` : '';
  return `<div class="pls-head">${escapeHtml(title)}</div>
    <div class="pp-row pls-sheet"><span>${escapeHtml(shape)}</span><b>${fmtM2(res.area)}${sheet}</b></div>
    <div class="pp-row"><span>${escapeHtml(coverLabel)}</span><b>${fmtM2(covered)} (${escapeHtml(fmtPct(100 - res.none.pct))}) · ${fmtNum(count)} ${unit}</b></div>`;
};

function schemeLabel(file) {
  if (!file) return '';
  const entry = (state.projectCatalog || []).find(p => p && p.tenQH === file);
  if (!entry) return file;
  const names = namesOfProject(entry);
  return `${planLevelOf(file)} ${names.tenRutGon || file}`;
}

function schemeGroups(parts) {
  const groups = new Map();
  parts.forEach(p => {
    const file = (p.lot && p.lot.file) || p.file || '';
    if (!groups.has(file)) groups.set(file, []);
    groups.get(file).push(p);
  });
  return [...groups.entries()]
    .map(([file, list]) => ({ file, label: schemeLabel(file), list, area: list.reduce((s, p) => s + p.area, 0) }))
    .sort((a, b) => b.area - a.area);
}

function schemeSummary(groups, area) {
  const named = groups.filter(g => g.label);
  if (named.length < 2 || !(area > 0)) return '';
  return `<div class="pls-scheme-sum">${named.map(g => `<div><b>${escapeHtml(g.label)}</b><span>${fmtArea(g.area)} · ${fmtPct(g.area / area * 100)}</span></div>`).join('')}</div>`;
}

function lotBlock(p, scheme) {
  const stats = planItems(p.lot && p.lot.plan).map(s => `${s.short} ${s.text}`).join(' · ');
  const own = p.sub || '';
  const tag = scheme && !own.includes(scheme) ? scheme : '';
  const sub = [own, p.label && p.label !== p.name ? p.label : '', tag].filter(Boolean).join(' · ');
  return `<div class="pls-lot" data-land="${escapeHtml(p.label)}" data-color="${escapeHtml(p.color || '')}">
      <div class="pls-lot-head"><b>${escapeHtml(p.name || p.label)}</b><span>${fmtM2(p.area)}</span></div>
      ${sub ? `<div class="pls-lot-sub">${escapeHtml(sub)}</div>` : ''}
      ${p.desc ? `<div class="pls-lot-plan">${escapeHtml(p.desc)}</div>` : ''}
      ${stats ? `<div class="pls-lot-plan">${escapeHtml(stats)}</div>` : ''}
      ${p.complianceHtml || ''}
    </div>`;
}

function planFieldText(plan, key) {
  const icon = key === 'far' ? 'layers' : key;
  const hit = planItems(plan).find(s => s.icon === icon);
  if (!hit) return '—';
  return String(hit.text || '—').replace(/\s+/g, ' ').trim();
}

/** Bỏ mảnh < MIX_NOISE_PCT % diện tích thửa (lệch ranh địa chính ↔ lô QH); nếu mọi mảnh đều nhiễu thì giữ nguyên. */
function audibleParts(parts, totalArea) {
  if (!parts?.length) return [];
  const list = parts.map(p => ({
    ...p,
    pct: totalArea > 0 ? (p.area / totalArea) * 100 : Number(p.pct) || 0
  }));
  const kept = list.filter(p => p.pct >= MIX_NOISE_PCT);
  return kept.length ? kept : list;
}

/** Bảng gọn Loại đất / Diện tích / MĐXD / Tầng cao / HSSDĐ (bỏ Stt để đủ chỗ cột HSSDĐ). */
function planLotsTable(parts, totalArea) {
  const list = audibleParts(parts, totalArea);
  if (!list.length) return '';
  const body = list.map((p) => {
    const plan = p.lot && p.lot.plan;
    const pct = p.pct;
    return `<tr class="pls-tr" data-land="${escapeHtml(p.label)}" data-color="${escapeHtml(p.color || '')}" title="${escapeHtml(p.name || p.label)} · ${escapeHtml(fmtPct(pct))}">
      <td class="pls-type">${landMarksHtml(p.color, p.key)}<span>${escapeHtml(p.label)}</span></td>
      <td class="pls-num">${fmtM2(p.area)}</td>
      <td class="pls-num">${escapeHtml(planFieldText(plan, 'coverage'))}</td>
      <td class="pls-num">${escapeHtml(planFieldText(plan, 'floors'))}</td>
      <td class="pls-num">${escapeHtml(planFieldText(plan, 'far'))}</td>
    </tr>`;
  }).join('');
  return `<div class="pls-table-wrap"><table class="pls-table">
    <thead><tr>
      <th>Loại đất</th><th>Diện tích</th><th>MĐXD</th><th>Tầng cao</th><th>HSSDĐ</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function schemeLots(parts, area) {
  const list = audibleParts(parts, area);
  const groups = schemeGroups(list);
  const named = groups.filter(g => g.file).length;
  if (!named) return `<div class="pls-lots">${list.map(p => lotBlock(p, '')).join('')}</div>`;
  return groups.map(g => `<section class="pls-scheme">
      <div class="pls-scheme-head"><b>${escapeHtml(g.label || 'Không gắn đồ án')}</b><span>${fmtArea(g.area)} · ${fmtPct(area > 0 ? g.area / area * 100 : 0)}</span></div>
      <div class="pls-lots">${g.list.map(p => lotBlock(p, g.label)).join('')}</div>
    </section>`).join('');
}

/** Kết quả analyzeParcelPlan. recorded: diện tích hồ sơ địa chính (m²), 0 nếu là vùng đo. opts: title, noneLabel, empty, note, place, extra, compact */
export function parcelPlanHtml(res, recorded, opts = {}) {
  if (!res.exact) return planLandHtml(res).replace('trong vùng đo', 'trên thửa đất');
  const w = planPlace(opts.place);
  const compact = opts.compact === true
    || (opts.compact !== false && opts.place !== 'measure' && opts.place !== 'invest');
  const title = opts.title || (compact ? 'Thông tin quy hoạch:' : `Quy hoạch ${w.on}`);
  const noneLabel = opts.noneLabel || 'Chưa có lô quy hoạch';
  const empty = opts.empty || `${w.it} chưa nằm trong lô quy hoạch của đồ án nào đã nhập.`;
  const note = opts.note || `Cắt hình học ${w.cut} với ranh lô; hình thửa từ tile địa chính (sai số ranh khoảng 0,5 m) nên có thể lệch nhẹ so với diện tích hồ sơ. Đồ án chồng nhau ưu tiên đồ án phạm vi nhỏ hơn; đồ án đang ẩn không tính.`;
  const extra = (opts.extra || []).map(([k, v]) => `<div class="pp-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join('');
  if (compact) {
    // Tiêu đề «Thông tin quy hoạch:» + 4 tab nằm ngoài .cad-page; bảng thành phần đất trước, pie sau.
    const head = extra;
    if (!res.parts?.length && !res.rows.length) {
      return `<div class="plan-land-stats">${head}<div class="sug-card ineligible">${escapeHtml(empty)}</div></div>`;
    }
    return `<div class="plan-land-stats">${head}${planLotsTable(res.parts, res.area)}${pieHtml(res, noneLabel, w.pie)}</div>`;
  }
  const head = parcelHead(title, res, recorded, 'Có lô quy hoạch', res.lotCount, 'lô', w.shape) + extra;
  const foot = `<div class="pp-sub" title="${escapeHtml(note)}">${escapeHtml(note)}</div>`;
  if (!res.rows.length) return `<div class="plan-land-stats">${head}<div class="sug-card ineligible">${escapeHtml(empty)}</div>${foot}</div>`;
  const groups = schemeGroups(res.parts);
  return `<div class="plan-land-stats">${head}${schemeSummary(groups, res.area)}
    <div class="pls-sub-head">Lô quy hoạch và chỉ tiêu</div>
    ${schemeLots(res.parts, res.area)}${pieHtml(res, noneLabel, w.pie)}${foot}
  </div>`;
}

/**
 * Kết quả analyzeParcelZones trong popup thửa.
 * opts: { title, unit ('lô' | 'vùng'), cover, none, empty, partsHead, extra: [[nhãn, giá trị]], note, place }
 */
export function parcelZonesHtml(res, recorded, opts) {
  const w = planPlace(opts.place);
  const compact = opts.compact === true
    || (opts.compact !== false && opts.place !== 'measure' && opts.place !== 'invest');
  const title = opts.title || (compact ? 'Thông tin quy hoạch:' : `Quy hoạch ${w.on}`);
  const covered = res.area - res.none.area;
  const extra = (opts.extra || []).map(([k, v]) => `<div class="pp-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join('');
  if (compact) {
    const head = extra;
    if (!res.parts.length) {
      return `<div class="plan-land-stats">${head}<div class="sug-card ineligible">${escapeHtml(opts.empty)}</div></div>`;
    }
    return `<div class="plan-land-stats">${head}${planLotsTable(res.parts, res.area)}${pieHtml(res, opts.none, w.pie)}</div>`;
  }
  const head = `<div class="pls-head">${escapeHtml(title)}</div>
    <div class="pp-row pls-sheet"><span>${escapeHtml(w.shape)}</span><b>${fmtM2(res.area)}${recorded > 0 ? ` <small>(hồ sơ ${fmtNum(recorded)} m²)</small>` : ''}</b></div>
    <div class="pp-row"><span>${escapeHtml(opts.cover)}</span><b>${fmtM2(covered)} (${escapeHtml(fmtPct(100 - res.none.pct))}) · ${fmtNum(res.parts.length)} ${opts.unit}</b></div>${extra}`;
  const note = opts.note ? `<div class="pp-sub" title="${escapeHtml(opts.note)}">${escapeHtml(opts.note)}</div>` : '';
  if (!res.parts.length) return `<div class="plan-land-stats">${head}<div class="sug-card ineligible">${escapeHtml(opts.empty)}</div>${note}</div>`;
  const groups = schemeGroups(res.parts);
  return `<div class="plan-land-stats">${head}${schemeSummary(groups, res.area)}
    <div class="pls-sub-head">${escapeHtml(opts.partsHead)}</div>
    ${schemeLots(res.parts, res.area)}${pieHtml(res, opts.none, w.pie)}${note}
  </div>`;
}
