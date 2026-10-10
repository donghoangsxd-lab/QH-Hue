// Phân tích sử dụng đất quy hoạch trong vùng đo diện tích. Lấy mẫu lưới đều trong polygon đo (≈ SAMPLE_MAX điểm),
// mỗi điểm mẫu nhận loại đất của lô QH chứa nó; diện tích loại = tỷ lệ điểm mẫu × diện tích đo.
// Các đồ án chồng nhau (quy hoạch phân khu chứa quy hoạch chi tiết, bản điều chỉnh…): ưu tiên đồ án có ranh tổng nhỏ hơn
// (chi tiết hơn), lô QH theo phường xếp cuối. Phần không rơi vào lô nào ghi "Chưa có lô quy hoạch".
// Điểm trong lô tính theo hàng (scanline, chẵn-lẻ): lô hàng nghìn đỉnh chỉ cắt mỗi hàng mẫu 1 lần.
import { state, infraLabels, BUFFER_COLORS, layerType, getPlanScenarioList } from './state.js';
import { planLotsIn } from './projectFiles.js';
import { landLabel, landColor, landPatternKey, infraStyleKey, tt16SwatchCss, TT16_STYLES } from './tt16Symbols.js';
import { escapeHtml, fmtNum } from './utils.js';

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
  return { label: nhom, color: landColor(lot.layer) || (TT16_STYLES[key] || {}).color || '#94a3b8', key: '' };
}

/**
 * ring: vòng polygon đo [[lng, lat], …] (đã khép). → { area, rows: [{ label, color, key, area, pct, lots }], none,
 * lotCount, projects: [tên đồ án có lô trong vùng], step (m) }
 */
export async function analyzePlanLand(ring) {
  const area = turf.area(turf.polygon([ring]));
  const box = boxOf([[ring]]);
  const { projects, wardLots } = await planLotsIn(box);
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
  wardLots.forEach(lot => { if (lot.kind === 'DXF' || !seenIds.has(lot.id)) push(lot); });

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

const fmtArea = (m2) => (m2 >= 10000 ? `${fmtNum(m2 / 10000)} ha` : `${fmtNum(Math.round(m2))} m²`);
const fmtPct = (p) => (p > 0 && p < 0.05 ? `<${fmtNum(0.1)}%` : `${fmtNum(Math.round(p * 10) / 10)}%`);

function rowHtml(label, color, key, area, pct, sub = '') {
  const swatch = (key && tt16SwatchCss(key, 0.6)) || `background:${color};`;
  return `<div class="pls-row" title="${escapeHtml(label)}">
    <i class="pls-swatch" style="${swatch}"></i>
    <span class="pls-label">${escapeHtml(label)}${sub ? `<small>${sub}</small>` : ''}</span>
    <b>${fmtArea(area)}</b><em>${fmtPct(pct)}</em>
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
  const rows = res.rows.map(r => rowHtml(r.label, r.color, r.key, r.area, r.pct, `${fmtNum(r.lots)} lô`)).join('');
  const none = res.none.area > 0 ? rowHtml('Chưa có lô quy hoạch', NONE_COLOR, '', res.none.area, res.none.pct, 'đường, mặt nước… chưa vẽ lô') : '';
  const shown = res.projects.slice(0, 3).map(escapeHtml).join('; ');
  const more = res.projects.length > 3 ? ` và ${res.projects.length - 3} đồ án khác` : '';
  return `<div class="plan-land-stats">${head}<div class="pls-list">${rows}${none}</div>
    ${shown ? `<div class="pp-sub">Đồ án: ${shown}${more}</div>` : ''}
    <div class="pp-sub">≈ Lấy mẫu lưới ${fmtNum(Math.round(res.step * 10) / 10)} m; đồ án chồng nhau ưu tiên đồ án phạm vi nhỏ hơn (chi tiết hơn). Đồ án đang ẩn không tính.</div>
  </div>`;
}
