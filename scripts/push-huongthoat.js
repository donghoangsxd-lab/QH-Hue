// Đẩy mũi tên hướng thoát nước mặt (HuongThoat.geojson do build-huongthoat.js tạo) lên bucket qua Apps Script, chia theo ô
// bản đồ mức TILE_Z để webapp chỉ tải ô trong khung nhìn: drainage/huongthoat/<z_x_y>.json + index.json.
//   node scripts/push-huongthoat.js [HuongThoat.geojson]          → chia ô rồi gửi 1 lô (saveDrainArrows)
//   node scripts/push-huongthoat.js [file] --out thu-muc           → chỉ ghi các ô ra máy để soát, không gửi
// Cần GAS_BASE_URL và GAS_SECRET (xem scripts/gasClient.js).
// Ô: { a: [[x0, y0, dx1, dy1, …], …] } — kinh độ / vĩ độ × 1e5, đỉnh sau ghi độ lệch so với đỉnh trước, đường vẽ xuôi dòng.
const fs = require('fs');
const path = require('path');
const { loadEnv, postToAppsScript } = require('./gasClient');
const { lng2tx, lat2ty } = require('./hydroCommon');

const TILE_Z = 12;
const Q = 1e5;

function tileOf(coords) {
  const [lng, lat] = coords[Math.floor(coords.length / 2)];
  return `${TILE_Z}_${Math.floor(lng2tx(lng, TILE_Z))}_${Math.floor(lat2ty(lat, TILE_Z))}`;
}

function encode(coords) {
  const out = [];
  let px = 0, py = 0;
  coords.forEach(([lng, lat], k) => {
    const x = Math.round(lng * Q), y = Math.round(lat * Q);
    if (k && x === px && y === py) return;
    out.push(k ? x - px : x, k ? y - py : y);
    px = x; py = y;
  });
  return out;
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const outDir = opt('--out');
  const input = args.find(a => !a.startsWith('--') && a !== outDir) || path.join(__dirname, '..', 'HuongThoat.geojson');
  const fc = JSON.parse(fs.readFileSync(input, 'utf8'));
  const tiles = {};
  let n = 0;
  (fc.features || []).forEach(f => {
    const c = f.geometry && f.geometry.type === 'LineString' ? f.geometry.coordinates : null;
    if (!c || c.length < 2) return;
    const a = encode(c);
    if (a.length < 4) return;
    const key = tileOf(c);
    (tiles[key] = tiles[key] || { a: [] }).a.push(a);
    n++;
  });
  const keys = Object.keys(tiles);
  if (!n) throw new Error('Không có mũi tên nào trong file');
  const index = {
    v: 1,
    at: new Date().toISOString(),
    z: TILE_Z,
    n,
    tiles: Object.fromEntries(keys.sort().map(k => [k, tiles[k].a.length]))
  };
  const content = JSON.stringify({ index, tiles });
  const sizes = keys.map(k => JSON.stringify(tiles[k]).length);
  const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
  console.log(`✓ ${n} mũi tên → ${keys.length} ô mức ${TILE_Z} (lớn nhất ${kb(Math.max(...sizes))}, tổng ${kb(content.length)})`);
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    keys.forEach(k => fs.writeFileSync(path.join(outDir, `${k}.json`), JSON.stringify(tiles[k])));
    fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index));
    console.log(`✓ Đã ghi ${keys.length} ô + index.json vào ${outDir}`);
    return;
  }
  const data = await postToAppsScript('saveDrainArrows', content);
  console.log(`✓ Đã ghi gs://hue-infra-data-us/drainage/huongthoat/ (${data.tiles || keys.length} ô + index.json)`);
}

main().catch(err => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
