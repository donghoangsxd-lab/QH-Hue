// Dữ liệu tĩnh đồ án Quy hoạch chung đô thị Thừa Thiên Huế đến năm 2045, tầm nhìn 2065 (gServer mapid 21817, tải bằng
// gserver-page-fetch.js → gserver-to-shp.js, mỗi lớp một GeoJSON) cho qhc2045Layer.js:
//   node scripts/build-qhc2045.js "<thư mục LOP-mapid21817-…>" [thư-mục-ra] [--boundary ranh40.geojson]
// Ra public/data/qhc2045/: sdd.json (lô sử dụng đất 1/10.000), khung.json (tiểu vùng, phân khu, điểm chức năng 1/10.000 và
// vùng đang điều chỉnh), dinhhuong.json (sơ đồ tổ chức không gian 1/25.000). Hình học rút gọn (~2 m lớp 1/10.000, ~6 m lớp
// 1/25.000), tọa độ 5 chữ số thập phân; thuộc tính chỉ giữ trường dùng trên webapp, chuỗi lặp gom vào bảng cats.
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

async function main() {
  const args = process.argv.slice(2);
  const bi = args.indexOf('--boundary');
  const boundaryFile = bi >= 0 ? args.splice(bi, 2)[1] : null;
  const src = args[0];
  if (!src || !fs.existsSync(src)) throw new Error('Cần đường dẫn thư mục LOP-mapid21817-…');
  const dest = args[1] || path.join(__dirname, '..', 'public', 'data', 'qhc2045');
  const sub = fs.readdirSync(src);
  const dir10 = path.join(src, sub.find(n => DIR_10.test(n)) || '');
  const dir25 = path.join(src, sub.find(n => DIR_25.test(n)) || '');
  const wards = await loadBoundary(boundaryFile);

  fs.mkdirSync(dest, { recursive: true });
  const write = (name, fc) => {
    const s = JSON.stringify(fc);
    fs.writeFileSync(path.join(dest, name), s);
    console.log(`${name}: ${fc.features.length} đối tượng, ${(s.length / 1048576).toFixed(2)} MB`);
  };
  write('sdd.json', buildLanduse(dir10));
  write('khung.json', buildFrame(dir10, wards));
  write('dinhhuong.json', buildVision(dir25));
}

main().catch(err => { console.error(err); process.exit(1); });
