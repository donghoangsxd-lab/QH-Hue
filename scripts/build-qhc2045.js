// Dữ liệu tĩnh đồ án Quy hoạch chung đô thị Thừa Thiên Huế đến năm 2045, tầm nhìn 2065 (gServer mapid 21817, tải bằng
// gserver-page-fetch.js → gserver-to-shp.js, mỗi lớp một GeoJSON) cho qhc2045Layer.js:
//   node scripts/build-qhc2045.js "<thư mục LOP-mapid21817-…>" [thư-mục-ra] [--boundary ranh40.geojson]
// Ra public/data/qhc2045/: sdd.json (lô sử dụng đất 1/10.000), khung.json (tiểu vùng, phân khu, điểm chức năng 1/10.000 và
// vùng đang điều chỉnh), dinhhuong.json (sơ đồ tổ chức không gian 1/25.000). Hình học rút gọn (~2 m lớp 1/10.000, ~6 m lớp
// 1/25.000), tọa độ 5 chữ số thập phân; thuộc tính chỉ giữ trường dùng trên webapp, chuỗi lặp gom vào bảng cats.
// giaothong10.json / giaothong25.json: mạng lưới đường bộ (L 'b') + đường sắt (L 's') của nhóm "Quy hoạch giao thông" cùng
// tỷ lệ — c: cấp đường / loại đường sắt (qhcRoads.js), t: giai đoạn, n: tên, s: ký hiệu mặt cắt, l: chiều dài (m).
// Vùng đang điều chỉnh = phần phường Hóa Châu, Mỹ Thượng (vùng lõi QHC thành phố Huế mới) nằm ngoài 4 tiểu vùng của đồ án cũ.
const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');
const { loadBoundary } = require('./wardBoundary');
const { union, wardPicker } = require('./urbanGeo');

const TOL_10 = 0.00002;
const TOL_25 = 0.00006;
const MISSING_WARDS = ['Hóa Châu', 'Mỹ Thượng'];
const MISSING_MIN_M2 = 50000;
const STAGES = ['Hiện trạng', 'Ngắn hạn 2030', 'Dài hạn 2040'];
const ZONES = ['DD', 'NDD', 'NNK'];

const DIR_10 = /10[.,]?000/;
const DIR_25 = /25[.,]?000/;

function readLayer(dir, name) {
  const file = fs.readdirSync(dir).find(f => f.normalize('NFC') === `${name}.geojson`.normalize('NFC'));
  if (!file) throw new Error(`Thiếu lớp ${name} trong ${dir}`);
  return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).features.filter(f => f.geometry);
}

function slimGeom(geometry, tol) {
  let g = geometry;
  if (g.type !== 'Point') {
    try { g = turf.simplify(turf.feature(g), { tolerance: tol, highQuality: false }).geometry; } catch (e) { /* giữ hình gốc */ }
  }
  return turf.truncate(turf.feature(g), { precision: 5, coordinates: 2 }).geometry;
}

const num = (v, d = 3) => { const n = Number(v); return Number.isFinite(n) ? +n.toFixed(d) : 0; };
const text = (v) => String(v ?? '').trim();

/** Bảng chuỗi lặp: idx(s) → chỉ số trong list (chuỗi rỗng → -1) */
function table() {
  const list = [];
  const at = new Map();
  return {
    list,
    idx(s) {
      const t = text(s);
      if (!t) return -1;
      if (!at.has(t)) { at.set(t, list.length); list.push(t); }
      return at.get(t);
    }
  };
}

function feature(geometry, properties, tol) {
  return { type: 'Feature', properties, geometry: slimGeom(geometry, tol) };
}

function buildLanduse(dir10) {
  const notes = table();
  const features = readLayer(dir10, 'Chức năng sử dụng đất').map(f => {
    const p = f.properties;
    const props = {
      c: Number(p.chucnangsudungdat) || 0,
      z: Math.max(0, ZONES.indexOf(text(p.kyhieukhuquyhoach))),
      t: Math.max(0, STAGES.indexOf(text(p.thoihanquyhoach))),
      a: num(p.dientich)
    };
    const n = notes.idx(p.ghichu || p.solo || p.kyhieulodat);
    if (n >= 0) props.n = n;
    return feature(f.geometry, props, TOL_10);
  });
  return { type: 'FeatureCollection', zones: ZONES, stages: STAGES, notes: notes.list, features };
}

function buildFrame(dir10, wards) {
  const tvRe = /Phân Khu\s+(A\d)\s*-\s*(.+)$/i;
  const parseTv = (s) => { const m = text(s).match(tvRe); return m ? { tv: m[1].toUpperCase(), ten: m[2].trim() } : { tv: '', ten: text(s) }; };
  const tvRaw = readLayer(dir10, 'Sơ đồ tiểu vùng');
  const tv = tvRaw.map(f => feature(f.geometry, { k: 'tv', ...parseTv(f.properties.ghichu), a: num(f.properties.dientich, 1) }, TOL_10));
  const pk = readLayer(dir10, 'Phân khu chức năng')
    .map(f => feature(f.geometry, { k: 'pk', tv: parseTv(f.properties.ghichu).tv, a: num(f.properties.dientich, 1) }, TOL_10));
  const pts = readLayer(dir10, 'Điểm chức năng').filter(f => text(f.properties.tendoituong))
    .map(f => feature(f.geometry, { k: 'd', n: text(f.properties.tendoituong), t: Math.max(0, Number(f.properties.trangthaiquyhoach) - 1) }, TOL_10));

  const { pick } = wardPicker(wards);
  const core = union(tvRaw.map(f => turf.feature(f.geometry)));
  const missing = MISSING_WARDS.flatMap(name => {
    const diff = turf.difference(turf.featureCollection([pick([name])[0], core]));
    if (!diff) return [];
    const polys = diff.geometry.type === 'Polygon' ? [diff.geometry.coordinates] : diff.geometry.coordinates;
    return polys.map(c => turf.polygon(c)).filter(p => turf.area(p) >= MISSING_MIN_M2).map(p => {
      const ha = Math.round(turf.area(p) / 1e4);
      console.log(`  vùng điều chỉnh ${name}: ${ha} ha`);
      return feature(p.geometry, { k: 'dc', n: name, a: ha }, TOL_10);
    });
  });
  return { type: 'FeatureCollection', features: [...tv, ...pk, ...missing, ...pts] };
}

function buildVision(dir25) {
  const zones = table(), funcs = table(), lines = table(), lineNotes = table();
  const v = readLayer(dir25, 'Quy hoạch vùng không gian').map(f => {
    const p = f.properties;
    const props = { L: 'v', k: zones.idx(p.khonggianphattrien || 'Khác'), f: funcs.idx(p.chucnangchinh || p.chucnangsudungdat) };
    if (text(p.tencongtrinh)) props.n = text(p.tencongtrinh);
    return feature(f.geometry, props, TOL_25);
  });
  const x = readLayer(dir25, 'Không gian cây xanh')
    .map(f => feature(f.geometry, { L: 'x', k: Number(f.properties.loaikhonggiancayxanh) || 0, a: num(f.properties.dientich) }, TOL_25));
  const n = readLayer(dir25, 'Không gian mặt nước').map(f => {
    const p = f.properties;
    const props = { L: 'n', k: /thủy sản/i.test(p.ghichu) ? 1 : /biển/i.test(`${p.ghichu} ${p.loaimatnuoc}`) ? 2 : 0 };
    if (text(p.ten)) props.n = text(p.ten);
    if (text(p.thoihanquyhoach) === STAGES[1]) props.t = 1;
    return feature(f.geometry, props, TOL_25);
  });
  const r = readLayer(dir25, 'Quy hoạch đường không gian')
    .map(f => feature(f.geometry, { L: 'r', k: lines.idx(f.properties.chucnangsudungdat || 'Ranh giới'), g: lineNotes.idx(f.properties.ghichu) }, TOL_25));
  const d = readLayer(dir25, 'Định hướng phát triển đô thị').map(f => {
    const p = f.properties;
    return feature(f.geometry, { L: 'd', n: text(p.ten), loai: text(p.loaidoituong), cap: text(p.phanloaidothi), g: text(p.ghichu) }, TOL_25);
  });
  return {
    type: 'FeatureCollection',
    cats: { zones: zones.list, funcs: funcs.list, lines: lines.list, lineNotes: lineNotes.list },
    features: [...v, ...n, ...x, ...r, ...d]
  };
}

// ---------- Mạng lưới giao thông đường bộ + đường sắt (thư mục "Quy hoạch giao thông (1-10.000)" / "(1-25.000)") ----------
// 1/10.000: cấp đường theo mã caphangduongbo (chú giải gServer). 1/25.000: mã không nhất quán (mã 3 dùng cho cả đường tỉnh
// và trục chính đô thị) nên lấy theo nhãn trinhbaydulieu ("Đường tỉnh, Hiện trạng").
const ROAD_CODE_10 = { 1: 'ct', 2: 'ql', 3: 'dt', 5: 'dothi', 6: 'kv' };
const ROAD_LABEL_25 = [[/cao tốc/i, 'ct'], [/quốc lộ/i, 'ql'], [/tỉnh/i, 'dt'], [/trục chính/i, 'dothi'], [/hầm/i, 'ham']];
const RAIL_KINDS = [[/tốc độ cao/i, 'tdc'], [/ngầm/i, 'ngam'], [/đô thị/i, 'dsdt'], [/quốc gia|bắc nam/i, 'qg']];
const ROUTE_PREFIX = { ql: 'QL', dt: 'ĐT' };
const ROAD_TRAFFIC_DIR = /giao thông/i;

const stageOf = (s) => { const t = text(s); return /hiện trạng/i.test(t) ? 0 : /2030/.test(t) ? 1 : /dài hạn/i.test(t) ? 2 : -1; };
const lengthM = (f) => Math.round(Number(f.properties.chieudai) > 0 ? Number(f.properties.chieudai) : turf.length(f) * 1000);

// Tên đường gServer ghi số hiệu trần ("49", "10E (Đường vành đai 3)"): thêm tiền tố theo cấp đường; cấp khác (đường đô thị
// mang số hiệu tuyến cũ) không đoán được QL hay ĐT nên ghi "Tuyến 26"
function routeName(name, cls) {
  const n = text(name);
  if (!/^\d+[A-Z]?\b/i.test(n)) return n;
  return `${ROUTE_PREFIX[cls] || 'Tuyến '}${n}`;
}

function roadClass(p, scale) {
  if (scale === '10') return ROAD_CODE_10[Number(p.caphangduongbo)] || 'kv';
  const label = text(p.trinhbaydulieu).split(',')[0] || text(p.ghichu);
  return (ROAD_LABEL_25.find(([re]) => re.test(label)) || [null, ROAD_CODE_10[Number(p.caphangduongbo)] || 'dt'])[1];
}

function buildTraffic(dir, scale) {
  const tol = scale === '10' ? TOL_10 : TOL_25;
  const common = (f, props) => {
    const p = f.properties;
    const t = stageOf(p.thoihanquyhoach);
    if (t >= 0) props.t = t;
    if (text(p.kyhieumatcat)) props.s = text(p.kyhieumatcat).toUpperCase();
    props.l = lengthM(f);
    return feature(f.geometry, props, tol);
  };
  const roads = readLayer(dir, 'Mạng lưới giao thông đường bộ').map(f => {
    const c = roadClass(f.properties, scale);
    const props = { L: 'b', c };
    const n = routeName(f.properties.tenduong, c);
    if (n) props.n = n;
    return common(f, props);
  });
  const rails = readLayer(dir, 'Mạng lưới giao thông đường sắt').map(f => {
    const p = f.properties;
    const kind = `${p.ghichu} ${p.tenduong} ${p.trinhbaydulieu}`;
    const props = { L: 's', c: (RAIL_KINDS.find(([re]) => re.test(kind)) || [null, 'qg'])[1] };
    if (/nhánh/i.test(kind)) props.nh = 1;
    if (text(p.tenduong)) props.n = text(p.tenduong);
    return common(f, props);
  });
  return { type: 'FeatureCollection', scale, features: [...roads, ...rails] };
}

async function main() {
  const args = process.argv.slice(2);
  const bi = args.indexOf('--boundary');
  const boundaryFile = bi >= 0 ? args.splice(bi, 2)[1] : null;
  const src = args[0];
  if (!src || !fs.existsSync(src)) throw new Error('Cần đường dẫn thư mục LOP-mapid21817-…');
  const dest = args[1] || path.join(__dirname, '..', 'public', 'data', 'qhc2045');
  const sub = fs.readdirSync(src);
  const dirOf = (re, traffic) => {
    const n = sub.find(x => re.test(x) && ROAD_TRAFFIC_DIR.test(x.normalize('NFC')) === traffic);
    return n ? path.join(src, n) : null;
  };
  const dir10 = dirOf(DIR_10, false);
  const dir25 = dirOf(DIR_25, false);
  const gt10 = dirOf(DIR_10, true);
  const gt25 = dirOf(DIR_25, true);

  fs.mkdirSync(dest, { recursive: true });
  const write = (name, fc) => {
    const s = JSON.stringify(fc);
    fs.writeFileSync(path.join(dest, name), s);
    console.log(`${name}: ${fc.features.length} đối tượng, ${(s.length / 1048576).toFixed(2)} MB`);
  };
  // Thiếu thư mục nhóm nào thì giữ nguyên file cũ của nhóm đó (tải lại riêng nhóm giao thông không đụng lớp sử dụng đất)
  const skip = (name) => console.log(`${name}: bỏ qua, không có thư mục nguồn`);
  if (dir10) {
    write('sdd.json', buildLanduse(dir10));
    write('khung.json', buildFrame(dir10, await loadBoundary(boundaryFile)));
  } else ['sdd.json', 'khung.json'].forEach(skip);
  if (dir25) write('dinhhuong.json', buildVision(dir25)); else skip('dinhhuong.json');
  if (gt10) write('giaothong10.json', buildTraffic(gt10, '10')); else skip('giaothong10.json');
  if (gt25) write('giaothong25.json', buildTraffic(gt25, '25')); else skip('giaothong25.json');
}

main().catch(err => { console.error(err); process.exit(1); });
