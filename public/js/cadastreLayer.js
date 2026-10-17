// Lớp "Thửa đất địa chính 2016" (bảng lớp dữ liệu): 686 nghìn thửa lấy từ gis21.hue.gov.vn, không gồm tên chủ sử dụng.
// Tile vector PMTiles (lớp "thuadat", zoom 15–16) đọc thẳng từ bucket bằng HTTP Range; zoom > 16 phóng to từ tile 16.
// Bấm vào thửa khi không bật công cụ nào: tra trong tile z16 đã tải, không gọi máy chủ. Tìm tờ/thửa qua chỉ mục từng xã.
// Popup lô neo giữa khung nhìn nên điểm bấm lấy từ preclick, không lấy tọa độ popup.
// Droplist đang ở lớp quy hoạch: bảng thửa đặt góc trái (4 trang QHC 1/25.000, QHC 1/10.000, QHPK 1/2.000, QHCT 1/500).
// Bấm một trang thì bật đúng lớp đó (tắt các lớp quy hoạch khác), giữ khung nhìn; QHPK/QHCT mở đồ án chứa thửa.
// Nút Phân tích QH của đo diện tích mở cùng 4 trang trên polygon vùng đo.
// Droplist Hệ thống đô thị giữ popup tại thửa.
import { map } from './mapEngine.js';
import { planMap, getViewMode, isSplitOn } from './planMap.js';
import { geeApi } from './api.js';
import { escapeHtml, fmtNum, showToast, ico } from './utils.js';
import { analyzeParcelPlan, parcelPlanHtml, planPlace, mountParcelPies, clearParcelPies } from './planLandStats.js';
import { parcelQhcHtml } from './qhc2045Layer.js';
import { parcelQhctHtml } from './qhctLayer.js';
import { getLevel, LEVEL_EVENT } from './mapLevel.js';
import { applyInspectLevel, geometryPoint, inspectLevelSyncing } from './viewFlow.js';

const LIBS = {
  pmtiles: 'https://cdn.jsdelivr.net/npm/pmtiles@4.5.0/+esm',
  vectorTile: 'https://cdn.jsdelivr.net/npm/@mapbox/vector-tile@2.0.5/+esm',
  pbf: 'https://cdn.jsdelivr.net/npm/pbf@4.0.1/+esm'
};
const LAYER = 'thuadat';
const MIN_ZOOM = 15;
const DATA_ZOOM = 16;
const LABEL_ZOOM = 18;
const PANE = 'cadastrePane';
// Trên lô đồ án (overlayPane 400), dưới viền rê chuột lô (444) và marker công trình (600)
const PANE_Z = 410;
const TILE_CACHE = 96;
const INDEX_CACHE = 8;
const FILL_ALPHA = 0.35;
const STROKE = 'rgba(124, 45, 18, 0.75)';
const STROKE_PLAN = 'rgba(17, 24, 39, 0.8)';
// Thửa đang chọn: trên mọi lớp dữ liệu và marker (600–620), dưới tooltip (650) và popup (700)
const HL_PANE = 'cadastreHighlightPane';
const HL_PANE_Z = 630;
const HIGHLIGHT_HALO = { color: '#111827', weight: 7, opacity: 0.55, fill: false };
const HIGHLIGHT = { color: '#fde047', weight: 3.5, opacity: 1, fillColor: '#facc15', fillOpacity: 0.22 };

// Nhóm loại đất (mã theo Thông tư 28/2014/TT-BTNMT, Phụ lục 01) cho dòng phụ popup; thửa nhiều mục đích lấy mã đầu
const GROUPS = [
  { label: 'Đất ở', codes: ['ODT', 'ONT'] },
  { label: 'Nông nghiệp', codes: ['LUC', 'LUK', 'LUN', 'LUA', 'BHK', 'NHK', 'HNK', 'CLN', 'NKH'] },
  { label: 'Rừng', codes: ['RSX', 'RPH', 'RDD'] },
  { label: 'Mặt nước, thủy sản', codes: ['NTS', 'LMU', 'SON', 'MNC'] },
  { label: 'Cơ quan, công cộng', codes: ['TSC', 'DTS', 'DVH', 'DYT', 'DGD', 'DTT', 'DKH', 'DXH', 'DNG', 'DSK', 'DSH', 'DKV', 'DCH', 'DCK', 'DBV', 'DNL', 'DRA', 'DDT', 'DDL', 'TON', 'TIN', 'NTD', 'CQP', 'CAN'] },
  { label: 'Sản xuất, kinh doanh', codes: ['SKK', 'SKN', 'SKT', 'TMD', 'SKC', 'SKS', 'SKX'] },
  { label: 'Giao thông, thủy lợi', codes: ['DGT', 'DTL'] },
  { label: 'Chưa sử dụng, khác', codes: [] }
];
const GROUP_OF = new Map(GROUPS.flatMap((g) => g.codes.map((c) => [c, g])));
const OTHER = GROUPS[GROUPS.length - 1];

// Màu nền theo mã loại đất, theo bảng màu ký hiệu bản đồ hiện trạng / quy hoạch sử dụng đất ngành TN&MT
const PUBLIC = '#ffaaa0';
const MINE = '#cdaacd';
const LAND_COLORS = {
  LUC: '#ffff64', LUK: '#ffff78', LUN: '#ffff8c', LUA: '#ffff78', BHK: '#fff0b4', NHK: '#fff0b4', HNK: '#fff0b4',
  CLN: '#ffd7aa', NKH: '#f5f08c', RSX: '#b4ffb4', RPH: '#beff1e', RDD: '#6eff64', NTS: '#aaffff', LMU: '#fafafa',
  ODT: '#ffa0ff', ONT: '#ffd0ff', CQP: '#ff5046', CAN: '#ff5046', DGT: '#ffaa32', DTL: '#aaffff',
  SON: '#a0ffff', MNC: '#b4ffff', NTD: '#d2d2d2', SKS: MINE, SKX: MINE, DRA: MINE,
  BCS: '#fafafa', DCS: '#fafafa', NCS: '#e6e6c8'
};
const NO_CODE_COLOR = '#d4d4d4';

const LAND_NAMES = {
  LUC: 'Đất chuyên trồng lúa nước', LUK: 'Đất trồng lúa nước còn lại', LUN: 'Đất trồng lúa nương',
  BHK: 'Đất bằng trồng cây hàng năm khác', NHK: 'Đất nương rẫy trồng cây hàng năm khác', CLN: 'Đất trồng cây lâu năm',
  RSX: 'Đất rừng sản xuất', RPH: 'Đất rừng phòng hộ', RDD: 'Đất rừng đặc dụng', NTS: 'Đất nuôi trồng thủy sản',
  LMU: 'Đất làm muối', NKH: 'Đất nông nghiệp khác', ONT: 'Đất ở tại nông thôn', ODT: 'Đất ở tại đô thị',
  TSC: 'Đất xây dựng trụ sở cơ quan', DTS: 'Đất xây dựng trụ sở của tổ chức sự nghiệp', DVH: 'Đất xây dựng cơ sở văn hóa',
  DYT: 'Đất xây dựng cơ sở y tế', DGD: 'Đất xây dựng cơ sở giáo dục và đào tạo', DTT: 'Đất xây dựng cơ sở thể dục thể thao',
  DKH: 'Đất xây dựng cơ sở khoa học và công nghệ', DXH: 'Đất xây dựng cơ sở dịch vụ xã hội', DNG: 'Đất xây dựng cơ sở ngoại giao',
  DSK: 'Đất xây dựng công trình sự nghiệp khác', CQP: 'Đất quốc phòng', CAN: 'Đất an ninh', SKK: 'Đất khu công nghiệp',
  SKN: 'Đất cụm công nghiệp', SKT: 'Đất khu chế xuất', TMD: 'Đất thương mại, dịch vụ', SKC: 'Đất cơ sở sản xuất phi nông nghiệp',
  SKS: 'Đất sử dụng cho hoạt động khoáng sản', SKX: 'Đất sản xuất vật liệu xây dựng, làm đồ gốm', DGT: 'Đất giao thông',
  DTL: 'Đất thủy lợi', DDT: 'Đất có di tích lịch sử - văn hóa', DDL: 'Đất danh lam thắng cảnh', DSH: 'Đất sinh hoạt cộng đồng',
  DKV: 'Đất khu vui chơi, giải trí công cộng', DNL: 'Đất công trình năng lượng', DBV: 'Đất công trình bưu chính, viễn thông',
  DCH: 'Đất chợ', DRA: 'Đất bãi thải, xử lý chất thải', DCK: 'Đất công trình công cộng khác', TON: 'Đất cơ sở tôn giáo',
  TIN: 'Đất cơ sở tín ngưỡng', NTD: 'Đất làm nghĩa trang, nghĩa địa, nhà tang lễ, nhà hỏa táng', SON: 'Đất sông, ngòi, kênh, rạch, suối',
  MNC: 'Đất có mặt nước chuyên dùng', PNK: 'Đất phi nông nghiệp khác', BCS: 'Đất bằng chưa sử dụng',
  DCS: 'Đất đồi núi chưa sử dụng', NCS: 'Núi đá không có rừng cây'
};

const landCode = (l) => (String(l || '').toUpperCase().match(/[A-Z]{3}/) || [''])[0];
const groupOf = (l) => GROUP_OF.get(landCode(l)) || OTHER;
const colorOf = (l) => {
  const code = landCode(l);
  return code ? LAND_COLORS[code] || PUBLIC : NO_CODE_COLOR;
};

const $ = (id) => document.getElementById(id);

let visible = false;
let leftLayer = null, rightLayer = null;
let ready = null;               // Promise<{ archive, VectorTile, Pbf, info }>
let xaList = null;              // Promise<[{ maxa, tenxa, tenhuyen, n, bbox }]>
const xaByCode = new Map();
const tiles = new Map();        // "z/x/y" → Promise<[{ rings, props, bbox, extent }]>
const indexes = new Map();      // maxa → Promise<{ rows }>
let popup = null, highlight = null, landFill = null, clickSeq = 0;
let foreignAt = 0, preclickAt = 0, clickAt = null;
let cardState = null;

const PLAN_TABS = [
  { id: 'qhc25', name: 'QHC', scale: '1/25.000' },
  { id: 'qhc10', name: 'QHC', scale: '1/10.000' },
  { id: 'qhpk', name: 'QHPK', scale: '1/2.000' },
  { id: 'qhct', name: 'QHCT', scale: '1/500' }
];
const isPlanLevel = (id) => PLAN_TABS.some(t => t.id === id);

function setHint(text) {
  const el = $('cadastreHint');
  if (el) el.textContent = text;
}

function updateHint() {
  if (!visible) return setHint('(zoom để xem)');
  setHint(map && map.getZoom() < MIN_ZOOM ? '(phóng to mức 15 để xem)' : '');
}

function setStatus(html) {
  const el = $('cadastreStatus');
  if (el) el.innerHTML = html;
}

function ensureReady() {
  if (!ready) {
    ready = Promise.all([
      fetch(geeApi('action=getCadastreInfo')).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
      import(LIBS.pmtiles), import(LIBS.vectorTile), import(LIBS.pbf)
    ]).then(([info, pm, vt, pbf]) => {
      if (!info || !info.pmtiles) throw new Error('máy chủ chưa cấu hình dữ liệu thửa đất');
      return { info, archive: new pm.PMTiles(info.pmtiles), VectorTile: vt.VectorTile, Pbf: pbf.default };
    });
    ready.catch(() => { ready = null; });
  }
  return ready;
}

function ringBox(rings) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  rings.forEach((r) => r.forEach(([x, y]) => {
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x;
    if (y > b[3]) b[3] = y;
  }));
  return b;
}

function loadTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  let p = tiles.get(key);
  if (p) {
    tiles.delete(key);
    tiles.set(key, p);
    return p;
  }
  p = ensureReady().then(async ({ archive, VectorTile, Pbf }) => {
    const res = await archive.getZxy(z, x, y);
    if (!res || !res.data) return [];
    const layer = new VectorTile(new Pbf(new Uint8Array(res.data))).layers[LAYER];
    const out = [];
    for (let i = 0; layer && i < layer.length; i++) {
      const f = layer.feature(i);
      const rings = f.loadGeometry().map((r) => r.map((pt) => [pt.x, pt.y]));
      out.push({ rings, props: f.properties, bbox: ringBox(rings), extent: layer.extent });
    }
    return out;
  });
  p.catch(() => tiles.delete(key));
  tiles.set(key, p);
  while (tiles.size > TILE_CACHE) tiles.delete(tiles.keys().next().value);
  return p;
}

// Vẽ một ô Leaflet từ tile nguồn (ô z > 16 là một phần của tile z16, phóng 2^dz lần).
// fill = false: chỉ vẽ viền (bản đồ quy hoạch, để không che màu lô đồ án)
function drawTile(canvas, feats, coords, dz, size, dpr, fill) {
  if (!feats.length) return;
  const ctx = canvas.getContext('2d');
  const ext = feats[0].extent;
  const f = 2 ** dz;
  const ox = coords.x - ((coords.x >> dz) << dz);
  const oy = coords.y - ((coords.y >> dz) << dz);
  const k = (size * f * dpr) / ext;
  const view = [(ox * ext) / f, (oy * ext) / f, ((ox + 1) * ext) / f, ((oy + 1) * ext) / f];
  const seen = feats.filter((ft) => ft.bbox[2] >= view[0] && ft.bbox[0] <= view[2] && ft.bbox[3] >= view[1] && ft.bbox[1] <= view[3]);
  const px = (x) => (x - view[0]) * k;
  const py = (y) => (y - view[1]) * k;
  const trace = (ft) => ft.rings.forEach((r) => {
    ctx.moveTo(px(r[0][0]), py(r[0][1]));
    for (let i = 1; i < r.length; i++) ctx.lineTo(px(r[i][0]), py(r[i][1]));
    ctx.closePath();
  });
  if (fill) {
    ctx.globalAlpha = FILL_ALPHA;
    const byColor = new Map();
    seen.forEach((ft) => {
      const c = colorOf(ft.props.l);
      if (!byColor.has(c)) byColor.set(c, []);
      byColor.get(c).push(ft);
    });
    byColor.forEach((list, color) => {
      ctx.beginPath();
      list.forEach(trace);
      ctx.fillStyle = color;
      ctx.fill('evenodd');
    });
    ctx.globalAlpha = 1;
  }
  ctx.beginPath();
  seen.forEach(trace);
  ctx.strokeStyle = fill ? STROKE : STROKE_PLAN;
  ctx.lineWidth = (coords.z >= 18 ? 1.2 : coords.z >= 17 ? 0.9 : 0.6) * dpr;
  ctx.stroke();
  if (coords.z < LABEL_ZOOM) return;
  ctx.font = `${10 * dpr}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#431407';
  seen.forEach((ft) => {
    const cx = (ft.bbox[0] + ft.bbox[2]) / 2;
    const cy = (ft.bbox[1] + ft.bbox[3]) / 2;
    // Mảnh thửa của tile bên cạnh nằm trong vùng đệm có tâm ngoài [0, ext]: không ghi nhãn trùng
    if (cx < 0 || cy < 0 || cx >= ext || cy >= ext) return;
    if ((ft.bbox[2] - ft.bbox[0]) * k < 18) return;
    ctx.fillText(String(ft.props.s ?? ''), px(cx), py(cy));
  });
}

const CadastreGrid = L.GridLayer.extend({
  createTile(coords, done) {
    const canvas = document.createElement('canvas');
    const size = this.getTileSize().x;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const dz = Math.max(0, coords.z - DATA_ZOOM);
    loadTile(coords.z - dz, coords.x >> dz, coords.y >> dz)
      .then((feats) => { drawTile(canvas, feats, coords, dz, size, dpr, this.options.fill); done(null, canvas); })
      .catch((err) => { setHint('chưa tải được dữ liệu thửa'); done(err, canvas); });
    return canvas;
  }
});

function makeLayer(m, fill) {
  if (!m.getPane(PANE)) {
    const pane = m.createPane(PANE);
    pane.style.zIndex = PANE_Z;
    pane.style.pointerEvents = 'none';
  }
  const opacity = Number($('cadastreOpacity')?.value ?? 100) / 100;
  return new CadastreGrid({ pane: PANE, minZoom: MIN_ZOOM, maxZoom: 22, opacity, fill, updateWhenZooming: false, keepBuffer: 1 }).addTo(m);
}

const activeMap = () => (planMap && !isSplitOn() && getViewMode() === 'QH' ? planMap : map);

function insideRings(rings, x, y) {
  let inside = false;
  rings.forEach((r) => {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i];
      const [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  });
  return inside;
}

function tileXY(latlng, z) {
  const n = 2 ** z;
  const rad = (latlng.lat * Math.PI) / 180;
  return [((latlng.lng + 180) / 360) * n, ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n];
}

function toLngLat(z, x, y, ext) {
  const n = 2 ** z;
  return ([px, py]) => {
    const lng = ((x + px / ext) / n) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / ext)) / n))) * 180) / Math.PI;
    return [lng, lat];
  };
}

// Tách vòng thành polygon: vòng ngoài có diện tích ký hiệu dương trong hệ tile (trục y hướng xuống)
function ringsToPolygons(rings, conv) {
  const polys = [];
  rings.forEach((r) => {
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
    const ring = r.map(conv);
    if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push(ring[0]);
    if (ring.length < 4) return;
    if (a > 0 || !polys.length) polys.push([ring]);
    else polys[polys.length - 1].push(ring);
  });
  return polys;
}

const sameParcel = (a, b) => a.m === b.m && a.t === b.t && a.s === b.s;

// Thửa vắt qua mép tile bị cắt theo tile: gom mảnh cùng thửa ở các tile kề rồi hợp lại để viền đúng hình
async function parcelShape(hit, z, x, y) {
  const ext = hit.extent;
  const pieces = [{ ft: hit, x, y }];
  const dxs = [0, ...(hit.bbox[0] < 0 ? [-1] : []), ...(hit.bbox[2] > ext ? [1] : [])];
  const dys = [0, ...(hit.bbox[1] < 0 ? [-1] : []), ...(hit.bbox[3] > ext ? [1] : [])];
  const around = dxs.flatMap((dx) => dys.map((dy) => [dx, dy])).filter(([dx, dy]) => dx || dy);
  const lists = await Promise.all(around.map(([dx, dy]) => loadTile(z, x + dx, y + dy).catch(() => [])));
  lists.forEach((feats, i) => feats.filter((ft) => sameParcel(ft.props, hit.props))
    .forEach((ft) => pieces.push({ ft, x: x + around[i][0], y: y + around[i][1] })));
  const polys = pieces.flatMap((p) => ringsToPolygons(p.ft.rings, toLngLat(z, p.x, p.y, ext)));
  const shape = { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polys } };
  if (pieces.length < 2 || typeof turf === 'undefined') return shape;
  try {
    return polys.slice(1).reduce((acc, p) => turf.union(acc, turf.polygon(p)) || acc, turf.polygon(polys[0]));
  } catch {
    return shape;
  }
}

async function parcelAt(latlng) {
  const [fx, fy] = tileXY(latlng, DATA_ZOOM);
  const x = Math.floor(fx), y = Math.floor(fy);
  const feats = await loadTile(DATA_ZOOM, x, y);
  if (!feats.length) return null;
  const ext = feats[0].extent;
  const px = (fx - x) * ext, py = (fy - y) * ext;
  // Vài vòng cắt mép tile có thể chứa điểm theo luật chẵn-lẻ: lấy thửa khung nhỏ nhất, không lấy thửa lớn vắt mép
  let hit = null;
  let best = Infinity;
  feats.forEach((ft) => {
    if (px < ft.bbox[0] || px > ft.bbox[2] || py < ft.bbox[1] || py > ft.bbox[3]) return;
    if (!insideRings(ft.rings, px, py)) return;
    const area = (ft.bbox[2] - ft.bbox[0]) * (ft.bbox[3] - ft.bbox[1]);
    if (area < best) { best = area; hit = ft; }
  });
  return hit ? { hit, x, y } : null;
}

function parcelFacts(p) {
  const code = landCode(p.l);
  const g = groupOf(p.l);
  const xa = xaByCode.get(String(p.m));
  const info = [
    ['Diện tích', Number(p.a) > 0 ? `${fmtNum(p.a)} m²` : ''],
    ['Loại đất', p.l ? `${p.l}${LAND_NAMES[code] ? ` · ${LAND_NAMES[code]}` : ''}` : ''],
    ['Địa chỉ', p.d],
    ['Xã/phường cũ', xa ? `${xa.tenxa}${xa.tenhuyen ? `, ${xa.tenhuyen}` : ''}` : `Mã ${p.m}`]
  ].filter(([, v]) => v);
  return { g, info };
}

function parcelInfoHtml(p) {
  const { g, info } = parcelFacts(p);
  const rows = info.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}</dd>`).join('');
  return `<div class="lp-head">
      <i class="lp-swatch" style="background:${colorOf(p.l)}"></i>
      <div class="lp-head-main">
        <div class="lp-title-row"><span class="lp-title">Thửa ${escapeHtml(p.s)} · Tờ ${escapeHtml(p.t)}</span><span class="lp-phase lp-phase-ht">Địa chính 2016</span></div>
        <div class="lp-sub">${escapeHtml(g.label)}</div>
      </div>
    </div>
    <dl class="lp-info">${rows}</dl>`;
}

function parcelHtml(p) {
  return `<div class="land-popup">${parcelInfoHtml(p)}
    <button type="button" class="proof-btn cad-plan-btn" title="Diện tích từng loại đất quy hoạch trên thửa và chỉ tiêu các lô">${ico('area')}Xem chỉ tiêu quy hoạch</button>
    <div class="cad-plan"></div>
    <div class="pp-sub">Nguồn: gis21.hue.gov.vn (lập năm 2016), chỉ để tham khảo</div>
  </div>`;
}

function clearHighlight() {
  highlight?.remove();
  highlight = null;
}

function clearLandFill() {
  landFill?.remove();
  landFill = null;
  if (cardState) cardState.landKey = null;
  document.getElementById('cadParcelCard')?.querySelectorAll('[data-land].is-on').forEach(n => n.classList.remove('is-on'));
  const canvas = document.querySelector('#cadParcelCard canvas');
  const chart = canvas && typeof Chart !== 'undefined' ? Chart.getChart(canvas) : null;
  if (chart?.$keys && chart.data?.datasets?.[0]) {
    chart.data.datasets[0].offset = chart.$keys.map(() => 0);
    chart.setActiveElements([]);
    chart.update('none');
  }
}

function closeParcel() {
  clickSeq++;
  cardState = null;
  clearHighlight();
  clearLandFill();
  clearParcelPies();
  const card = document.getElementById('cadParcelCard');
  if (card) { card.hidden = true; card.innerHTML = ''; }
  if (popup) {
    const p = popup;
    popup = null;
    p.remove();
  }
}

function ensureCard() {
  let el = document.getElementById('cadParcelCard');
  if (el) return el;
  el = document.createElement('aside');
  el.id = 'cadParcelCard';
  el.className = 'cad-card';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Thông tin thửa đất');
  (document.getElementById('mapArea') || document.body).appendChild(el);
  el.addEventListener('click', (e) => {
    const land = e.target.closest('[data-land]');
    if (land) { toggleLand(land.dataset.land, land.dataset.color); return; }
    const tab = e.target.closest('[data-cad-tab]');
    if (tab) { showTab(tab.dataset.cadTab); return; }
    if (e.target.closest('.cad-card-x')) closeParcel();
  });
  el.addEventListener('pls-pick', (e) => toggleLand(e.detail?.key, e.detail?.color));
  return el;
}

function tabsBar(current, label, closeLabel) {
  const tabs = PLAN_TABS.map(t => {
    const on = t.id === current;
    return `<button type="button" class="cad-tab${on ? ' is-on' : ''}" role="tab" data-cad-tab="${t.id}" aria-selected="${on}" title="${t.name} ${t.scale}"><b>${t.name}</b><small>${t.scale}</small></button>`;
  }).join('');
  return `<div class="cad-tabs" role="tablist" aria-label="${label}">${tabs}</div>
    <button type="button" class="cad-card-x" title="Đóng" aria-label="${closeLabel}">${ico('close')}</button>`;
}

function cardHtml(p) {
  return `${tabsBar(getLevel(), 'Lớp quy hoạch trên thửa', 'Đóng bảng thửa')}
    <div class="cad-id">${parcelInfoHtml(p)}</div>
    <div class="cad-page" role="tabpanel"></div>`;
}

function measureCardHtml(tab, areaM2) {
  const area = areaM2 >= 10000 ? `${fmtNum(areaM2 / 10000)} ha` : `${fmtNum(Math.round(areaM2))} m²`;
  return `${tabsBar(tab, 'Lớp quy hoạch trong vùng đo', 'Đóng bảng vùng đo')}
    <div class="cad-id"><div class="lp-head"><div class="lp-head-main">
      <div class="lp-title-row"><span class="lp-title">Vùng đo</span></div>
      <div class="lp-sub">${areaM2 > 0 ? area : ''}</div>
    </div></div></div>
    <div class="cad-page" role="tabpanel"></div>`;
}

// Đẩy bản đồ nếu ranh thửa chui xuống bảng góc trái
function nudgeParcel(targetMap, bounds) {
  const el = document.getElementById('cadParcelCard');
  if (!el || el.hidden || !targetMap || !bounds) return;
  const sw = targetMap.latLngToContainerPoint(bounds.getSouthWest());
  const ne = targetMap.latLngToContainerPoint(bounds.getNorthEast());
  const left = Math.min(sw.x, ne.x);
  const top = Math.min(sw.y, ne.y);
  const bottom = Math.max(sw.y, ne.y);
  const mr = targetMap.getContainer().getBoundingClientRect();
  const cr = el.getBoundingClientRect();
  const limit = cr.right - mr.left + 16;
  const overlapsY = bottom > cr.top - mr.top && top < cr.bottom - mr.top;
  if (overlapsY && left < limit - 8) targetMap.panBy([left - limit, 0], { animate: true, duration: 0.4 });
}

// Thửa nhỏ ở mức phóng vừa nhìn không rõ: phóng tới khi ranh chưa chiếm khung nhìn, không thu nhỏ nếu đang gần hơn
function frameParcel(targetMap, bounds) {
  if (!targetMap || !bounds?.isValid?.()) return;
  const el = document.getElementById('cadParcelCard');
  const cardW = el && !el.hidden ? el.getBoundingClientRect().width + 28 : 48;
  const padTL = L.point(cardW, 80);
  const padBR = L.point(40, 40);
  const fitZ = targetMap.getBoundsZoom(bounds, false, padTL.add(padBR));
  const zoom = Math.min(targetMap.getMaxZoom(), fitZ);
  if (targetMap.getZoom() < zoom - 0.2) {
    targetMap.once('moveend', () => nudgeParcel(targetMap, bounds));
    targetMap.flyToBounds(bounds, {
      paddingTopLeft: padTL, paddingBottomRight: padBR, maxZoom: zoom, duration: 0.55
    });
    return;
  }
  nudgeParcel(targetMap, bounds);
}

function drawHighlight(shape, targetMap) {
  if (!targetMap.getPane(HL_PANE)) {
    const pane = targetMap.createPane(HL_PANE);
    pane.style.zIndex = HL_PANE_Z;
    pane.style.pointerEvents = 'none';
  }
  clearHighlight();
  highlight = L.layerGroup([
    L.geoJSON(shape, { pane: HL_PANE, style: HIGHLIGHT_HALO, interactive: false }),
    L.geoJSON(shape, { pane: HL_PANE, style: HIGHLIGHT, interactive: false })
  ]).addTo(targetMap);
  const bounds = highlight.getLayers()[0]?.getBounds?.();
  if (cardState) {
    cardState.map = targetMap;
    cardState.bounds = bounds;
    requestAnimationFrame(() => frameParcel(targetMap, bounds));
  }
  return bounds;
}

const QHPK_NOTE = 'Cắt hình học thửa với lô các đồ án QHPK 1/2.000 đã nạp, kể cả khi lớp QHPK hoặc đồ án đang tắt. Đồ án chồng nhau ưu tiên đồ án phạm vi nhỏ hơn. Hình thửa từ tile địa chính (sai số ranh khoảng 0,5 m) nên có thể lệch nhẹ so với diện tích hồ sơ.';

function planPage(id, geometry, recorded, place) {
  const w = planPlace(place);
  if (id === 'qhc25' || id === 'qhc10') return parcelQhcHtml(geometry, id, recorded, place);
  if (id === 'qhct') return parcelQhctHtml(geometry, recorded, place);
  const note = place === 'measure'
    ? `Cắt hình học ${w.cut} với lô các đồ án QHPK 1/2.000 đã nạp, kể cả khi lớp QHPK hoặc đồ án đang tắt. Đồ án chồng nhau ưu tiên đồ án phạm vi nhỏ hơn.`
    : QHPK_NOTE;
  return analyzeParcelPlan(geometry, { level: 'QHPK', includeHidden: true }).then(res => ({
    html: parcelPlanHtml(res, recorded, {
      title: `QHPK 1/2.000 ${w.on}`,
      noneLabel: 'Đất khác',
      empty: `${w.it} chưa nằm trong lô QHPK 1/2.000 đã nạp.`,
      place,
      note
    }),
    shapes: res.shapes
  }));
}

function paintLand(geoms, color) {
  const m = cardState?.map;
  if (!m || !geoms?.length) return;
  if (!m.getPane(HL_PANE)) return;
  landFill = L.geoJSON({
    type: 'FeatureCollection',
    features: geoms.map(geometry => ({ type: 'Feature', properties: {}, geometry }))
  }, {
    pane: HL_PANE,
    interactive: false,
    style: { color: '#111827', weight: 2, opacity: 1, fillColor: color || '#94a3b8', fillOpacity: 0.62 }
  }).addTo(m);
  const bounds = landFill.getBounds?.();
  if (bounds?.isValid?.()) frameParcel(m, bounds);
}

function markLand(key) {
  const el = document.getElementById('cadParcelCard');
  el?.querySelectorAll('[data-land]').forEach(n => n.classList.toggle('is-on', n.dataset.land === key));
  const canvas = el?.querySelector('canvas');
  const chart = canvas && typeof Chart !== 'undefined' ? Chart.getChart(canvas) : null;
  if (!chart?.$keys) return;
  const idx = chart.$keys.indexOf(key);
  chart.data.datasets[0].offset = chart.$keys.map((_, i) => i === idx ? 6 : 0);
  chart.setActiveElements(idx >= 0 ? [{ datasetIndex: 0, index: idx }] : []);
  chart.update();
}

function toggleLand(key, color) {
  const st = cardState;
  if (!st || !key) return;
  if (st.landKey === key) { clearLandFill(); return; }
  clearLandFill();
  const pack = st.cache.get(st.tab)?.shapes;
  const geoms = key === '__none' ? pack?.none : pack?.byLabel?.[key];
  if (!geoms?.length) return;
  paintLand(geoms, color);
  st.landKey = key;
  markLand(key);
}

async function showTab(id, { syncMap = true } = {}) {
  const st = cardState;
  if (!st || !isPlanLevel(id)) return;
  st.tab = id;
  if (syncMap) {
    applyInspectLevel(id, geometryPoint(st.geom, st.bounds), st.geom);
    const shown = planMap && !isSplitOn() && getViewMode() === 'QH' ? planMap : st.map;
    if (shown && st.map && shown !== st.map && st.geom) {
      st.map = shown;
      drawHighlight({ type: 'Feature', properties: {}, geometry: st.geom }, shown);
    }
  }
  if (!st.geom) return;
  const el = document.getElementById('cadParcelCard');
  const page = el?.querySelector('.cad-page');
  if (!page) return;
  el.querySelectorAll('[data-cad-tab]').forEach(b => {
    const on = b.dataset.cadTab === id;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', String(on));
  });
  clearLandFill();
  if (st.cache.has(id)) {
    clearParcelPies();
    page.innerHTML = st.cache.get(id).html;
    mountParcelPies(page);
    nudgeParcel(st.map, st.bounds);
    return;
  }
  const tab = PLAN_TABS.find(t => t.id === id);
  clearParcelPies();
  page.innerHTML = `<div class="cad-busy">Đang đối chiếu ${escapeHtml(tab ? `${tab.name} ${tab.scale}` : id)}…</div>`;
  try {
    const pageData = await planPage(id, st.geom, st.recorded, st.place);
    if (cardState !== st) return;
    st.cache.set(id, pageData);
    if (st.tab !== id) return;
    page.innerHTML = pageData.html;
    mountParcelPies(page);
    nudgeParcel(st.map, st.bounds);
  } catch (err) {
    console.warn(st.place === 'measure' ? 'Tra quy hoạch vùng đo lỗi:' : 'Tra quy hoạch thửa lỗi:', err);
    if (cardState !== st || st.tab !== id) return;
    page.innerHTML = `<div class="sug-card ineligible">Không phân tích được: ${escapeHtml(err.message || String(err))}</div>`;
  }
}

function closeDocked() {
  [map, planMap].forEach(m => {
    const cls = m?._popup?.options?.className || '';
    if (cls === 'infra-popup' || cls === 'inspect-popup') m.closePopup();
  });
}

/** Đóng bảng vùng đo; bảng thửa đang mở thì giữ. */
export function closeMeasurePlan() {
  if (cardState?.kind === 'measure') closeParcel();
}

/**
 * ring: vòng polygon đo [[lng, lat], …] đã khép.
 * Mở bảng góc trái với 4 cấp như bảng thửa. Đổi hình đo thì mapEngine gọi closeMeasurePlan.
 */
export function openMeasurePlan(ring, targetMap) {
  if (!targetMap || !ring || ring.length < 4) return;
  document.dispatchEvent(new CustomEvent('qh-dock-card', { detail: 'cadastre' }));
  closeDocked();
  closeParcel();
  const el = ensureCard();
  const tab = isPlanLevel(getLevel()) ? getLevel() : 'qhpk';
  const geom = { type: 'Polygon', coordinates: [ring] };
  let area = 0;
  let bounds = null;
  try { area = turf.area(geom); } catch { area = 0; }
  try { bounds = L.geoJSON(geom).getBounds(); } catch { bounds = null; }
  cardState = {
    kind: 'measure', place: 'measure', tab, cache: new Map(),
    recorded: 0, geom, map: targetMap, bounds, landKey: null
  };
  el.innerHTML = measureCardHtml(tab, area);
  el.hidden = false;
  el.setAttribute('aria-label', 'Quy hoạch sử dụng đất trong vùng đo');
  showTab(tab);
  if (bounds) requestAnimationFrame(() => nudgeParcel(targetMap, bounds));
}

// replaced: popup lô đồ án mở cùng cú bấm, chỉ đóng khi tìm thấy thửa (không thấy thì giữ popup lô)
async function openParcel(latlng, targetMap, replaced) {
  const seq = ++clickSeq;
  let found;
  try {
    [found] = await Promise.all([parcelAt(latlng), loadXaList().catch(() => null)]);
  } catch (err) {
    if (seq === clickSeq) showToast(`Chưa tải được dữ liệu thửa đất: ${err.message}`, 'error');
    return false;
  }
  if (seq !== clickSeq) return false;
  if (!found) {
    if (cardState) closeParcel();
    return false;
  }
  document.dispatchEvent(new CustomEvent('qh-dock-card', { detail: 'cadastre' }));
  closeDocked();
  if (replaced) targetMap.closePopup(replaced);
  const props = found.hit.props;
  const planning = isPlanLevel(getLevel());
  closeParcel();
  const mySeq = clickSeq;
  const shapeP = parcelShape(found.hit, DATA_ZOOM, found.x, found.y);
  if (planning) {
    const el = ensureCard();
    cardState = { kind: 'parcel', tab: getLevel(), cache: new Map(), recorded: Number(props.a), geom: null, map: targetMap, bounds: null, landKey: null };
    el.setAttribute('aria-label', 'Thông tin thửa đất');
    el.innerHTML = cardHtml(props);
    el.hidden = false;
    const shape = await shapeP;
    if (mySeq !== clickSeq || !cardState) return true;
    cardState.geom = shape.geometry;
    drawHighlight(shape, targetMap);
    showTab(cardState.tab);
    return true;
  }
  // Nội dung là phần tử DOM: popup.update() của Leaflet dựng lại nội dung dạng chuỗi và làm mất sự kiện nút
  const content = document.createElement('div');
  content.innerHTML = parcelHtml(props);
  // Leaflet 1.9 không chặn click trong popup mà dò cha của target lúc click tới bản đồ; nút tự thay nội dung
  // (target bị gỡ khỏi DOM) làm click lọt xuống: đóng popup và mở lại thửa ngay dưới nút
  L.DomEvent.on(content, 'click', L.DomEvent.stopPropagation);
  const own = L.popup({ maxWidth: 320, minWidth: 260, className: 'land-lot-popup cadastre-popup', autoPanPaddingTopLeft: [40, 90], autoPanPaddingBottomRight: [40, 20] })
    .setLatLng(latlng).setContent(content);
  popup = own;
  own.on('remove', () => { if (popup === own) { popup = null; clearHighlight(); clearParcelPies(); } });
  own.openOn(targetMap);
  content.querySelector('.cad-plan-btn')?.addEventListener('click', (e) => showParcelPlan(own, content, e.currentTarget, shapeP, props));
  const shape = await shapeP;
  if (mySeq !== clickSeq || popup !== own) return true;
  drawHighlight(shape, targetMap);
  return true;
}

// Popup tự rộng ra khi có bảng kết quả, giữ nguyên phần thông tin thửa phía trên. Lỗi thì trả nút để bấm lại
async function fillPlan(own, btn, box, busy, task) {
  if (!box || btn.disabled) return;
  const idle = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `${ico('area')}${busy}`;
  try {
    const html = await task();
    if (popup !== own) return;
    btn.remove();
    clearParcelPies();
    box.innerHTML = html;
  } catch (err) {
    console.warn('Tra quy hoạch thửa lỗi:', err);
    if (popup !== own) return;
    btn.disabled = false;
    btn.innerHTML = idle;
    box.innerHTML = `<div class="sug-card ineligible">Không phân tích được: ${escapeHtml(err.message || String(err))}</div>`;
  }
  own.options.maxWidth = 380;
  own.update();
  if (popup === own) mountParcelPies(box);
}

const QHPK_BUSY = 'Đang tải lô quy hoạch các đồ án quanh thửa…';

// Droplist Hệ thống đô thị: một nút đối chiếu đồ án đã nạp (các lớp quy hoạch dùng bảng 4 trang)
function showParcelPlan(own, content, btn, shapeP, props) {
  const box = content.querySelector('.cad-plan');
  const recorded = Number(props.a);
  return fillPlan(own, btn, box, QHPK_BUSY, async () => parcelPlanHtml(await analyzeParcelPlan((await shapeP).geometry), recorded));
}

/** Click bản đồ khi không bật công cụ nào: hiện thửa tại điểm bấm (nếu lớp đang bật và đủ mức phóng) */
/** → true khi click thuộc lớp thửa (đã mở / nhường popup khác), bản đồ không xử lý tiếp */
export function cadastreClick(e, targetMap) {
  if (!visible || !targetMap || targetMap.getZoom() < MIN_ZOOM) return false;
  if (performance.now() - foreignAt < 300) return true;
  openParcel(e.latlng, targetMap, null);
  return true;
}

// Lớp thửa không bắt chuột (vẽ đè lô). Bấm trúng lô thì lô mở popup và chặn click bản đồ.
// Popup lô neo giữa khung nhìn, không phải điểm bấm: lấy latlng của preclick. Công trình, marker vẫn giữ popup của nó
function onPopupOpen(e, m) {
  const cls = e.popup.options.className || '';
  if (e.popup === popup || /\bcadastre-popup\b/.test(cls)) return;
  const now = performance.now();
  foreignAt = now;
  const isLot = /\bland-lot-popup\b/.test(cls);
  if (!visible || !isLot || now - preclickAt > 300 || m.getZoom() < MIN_ZOOM) return;
  openParcel(clickAt || e.popup.getLatLng(), m, e.popup);
}

function loadXaList() {
  if (!xaList) {
    xaList = ensureReady()
      .then(({ info }) => fetch(`${info.indexBase}xa.json`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((list) => {
        list.forEach((x) => xaByCode.set(String(x.maxa), x));
        return list;
      });
    xaList.catch(() => { xaList = null; });
  }
  return xaList;
}

function loadIndex(maxa) {
  let p = indexes.get(maxa);
  if (!p) {
    p = ensureReady()
      .then(({ info }) => fetch(`${info.indexBase}${encodeURIComponent(maxa)}.json`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
    p.catch(() => indexes.delete(maxa));
    indexes.set(maxa, p);
    while (indexes.size > INDEX_CACHE) indexes.delete(indexes.keys().next().value);
  }
  return p;
}

function fillXaSelect(list) {
  const sel = $('cadastreXa');
  if (!sel || sel.options.length > 1) return;
  const byHuyen = new Map();
  list.forEach((x) => {
    const h = x.tenhuyen || 'Chưa rõ huyện';
    if (!byHuyen.has(h)) byHuyen.set(h, []);
    byHuyen.get(h).push(x);
  });
  byHuyen.forEach((xs, h) => {
    const og = document.createElement('optgroup');
    og.label = h;
    xs.forEach((x) => {
      const opt = document.createElement('option');
      opt.value = x.maxa;
      opt.textContent = `${x.tenxa === 'Chua ro xa' ? `Mã ${x.maxa} (chưa rõ tên)` : x.tenxa} · ${fmtNum(x.n)} thửa`;
      og.appendChild(opt);
    });
    sel.appendChild(og);
  });
}

const sameNo = (a, b) => {
  const x = String(a ?? '').trim().toLowerCase();
  const y = String(b ?? '').trim().toLowerCase();
  return x === y || (/^\d+$/.test(x) && /^\d+$/.test(y) && Number(x) === Number(y));
};

function flyAndOpen(lat, lng) {
  const m = activeMap();
  const target = L.latLng(lat, lng);
  m.once('moveend', () => openParcel(target, m));
  m.flyTo(target, Math.max(m.getZoom(), 19), { duration: 0.8 });
}

async function findParcel() {
  const maxa = $('cadastreXa')?.value;
  const to = $('cadastreTo')?.value.trim();
  const thua = $('cadastreThua')?.value.trim();
  if (!maxa) return setStatus('Chọn xã/phường (địa giới cũ) trước.');
  const xa = xaByCode.get(maxa);
  if (!to && !thua) {
    if (xa && xa.bbox) activeMap().fitBounds([[xa.bbox[1], xa.bbox[0]], [xa.bbox[3], xa.bbox[2]]]);
    return setStatus(`${escapeHtml(xa ? xa.tenxa : maxa)}: nhập số tờ và số thửa để tìm.`);
  }
  setStatus('Đang tìm...');
  let idx;
  try {
    idx = await loadIndex(maxa);
  } catch (err) {
    return setStatus(`Chưa tải được chỉ mục: ${escapeHtml(err.message)}`);
  }
  const rows = idx.rows || [];
  const hit = rows.find((r) => sameNo(r[0], to) && sameNo(r[1], thua));
  if (!hit) {
    const onSheet = rows.filter((r) => sameNo(r[0], to)).length;
    return setStatus(onSheet
      ? `Tờ ${escapeHtml(to)} có ${fmtNum(onSheet)} thửa nhưng không có thửa ${escapeHtml(thua)}.`
      : `Không có tờ ${escapeHtml(to)} trong ${escapeHtml(xa ? xa.tenxa : maxa)}.`);
  }
  setStatus(`Tờ ${escapeHtml(hit[0])}, thửa ${escapeHtml(hit[1])}${hit[4] ? ` · ${fmtNum(hit[4])} m²` : ''}${hit[5] ? ` · ${escapeHtml(hit[5])}` : ''}`);
  flyAndOpen(hit[3], hit[2]);
}

export function setCadastreVisible(on) {
  visible = !!on;
  const box = $('cadastreBox');
  if (box) box.style.display = visible ? '' : 'none';
  const opBox = $('cadastreOpBox');
  if (opBox) opBox.style.display = visible ? '' : 'none';
  if (!map) return;
  if (visible) {
    if (!leftLayer) leftLayer = makeLayer(map, true);
    if (planMap && !rightLayer) rightLayer = makeLayer(planMap, false);
    loadXaList().then(fillXaSelect).catch((err) => setStatus(`Chưa tải được danh mục xã: ${escapeHtml(err.message)}`));
  } else {
    closeParcel();
    leftLayer?.remove(); leftLayer = null;
    rightLayer?.remove(); rightLayer = null;
  }
  updateHint();
}

export function initCadastreLayer() {
  if (!map) return;
  map.on('zoomend', updateHint);
  document.addEventListener(LEVEL_EVENT, (e) => {
    if (inspectLevelSyncing()) return;
    if (cardState && isPlanLevel(e.detail?.level)) showTab(e.detail.level, { syncMap: false });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !cardState) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    closeParcel();
  });
  [map, planMap].forEach((m) => {
    m?.on('preclick', (e) => { preclickAt = performance.now(); clickAt = e.latlng || clickAt; });
    m?.on('popupopen', (e) => onPopupOpen(e, m));
  });
  document.addEventListener('qh-dock-card', (e) => { if (e.detail !== 'cadastre' && cardState) closeParcel(); });
  $('chk_cadastre')?.addEventListener('change', (e) => setCadastreVisible(e.target.checked));
  $('cadastreOpacity')?.addEventListener('input', (e) => {
    const v = Number(e.target.value) / 100;
    leftLayer?.setOpacity(v);
    rightLayer?.setOpacity(v);
  });
  $('btnCadastreFind')?.addEventListener('click', findParcel);
  ['cadastreTo', 'cadastreThua'].forEach((id) => $(id)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') findParcel(); }));
}
