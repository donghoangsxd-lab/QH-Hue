// Nhận thửa đất (lớp tnmt_thuadat của gis21.hue.gov.vn) theo từng xã, ghi shapefile .zip + GeoJSON:
//   node scripts/cadastre-to-shp.js --listen 8800 --out "<Desktop>\ThuaDat-2016"
// Cấu trúc: <out>/<huyện>/<mã xã>-<tên xã>/ThuaDat-<mã xã>-<tên xã>.{zip,geojson}; danh mục ở <out>/danh-muc-xa.json.
// Trang chạy scripts/cadastre-page-fetch.js (phục vụ tại /fetch.js); /have trả các xã đã ghi để chạy tiếp khi đứt.

const fs = require('fs');
const http = require('http');
const path = require('path');
const { writeLayer, verifyOut, safeDirName } = require('./gserver-to-shp');

const ROLE = { shape: 'Polygon', shapeType: 5 };
const PRIVATE_FIELDS = ['tenchu'];

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[argv[i].slice(2)] = true;
    else { out[argv[i].slice(2)] = next; i++; }
  }
  return out;
}

function loadIndex(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

// Phân trang có thể lặp thửa ở biên trang: bỏ trùng theo madoituong
function dedupe(rows) {
  const seen = new Set();
  let dup = 0;
  const kept = rows.filter((r) => {
    const id = r.madoituong;
    if (id == null || id === '') return true;
    if (seen.has(id)) { dup++; return false; }
    seen.add(id);
    return true;
  });
  return { kept, dup };
}

function saveXa(out, index, body) {
  const maxa = String(body.maxa);
  const tenxa = body.tenxa || 'Chua ro xa';
  const dir = path.join(out, safeDirName(body.tenhuyen || 'Chua ro huyen'), safeDirName(`${maxa}-${tenxa}`));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const rows = (body.rows || []).map((r) => {
    PRIVATE_FIELDS.forEach((k) => delete r[k]);
    return r;
  });
  const { kept, dup } = dedupe(rows);
  const w = writeLayer(dir, safeDirName(`ThuaDat-${maxa}-${tenxa}`), ROLE, kept, null);
  const v = verifyOut(dir);
  const ok = v.length === 1 && v[0].walked && v[0].records === v[0].geojson && v[0].code === 9994;
  index[maxa] = {
    maxa,
    tenxa,
    tenhuyen: body.tenhuyen || '',
    total: body.total,
    received: rows.length,
    n: w.n,
    dup,
    noGeom: w.skipped,
    crs: w.crs,
    bbox: w.bbox,
    dir: path.relative(out, dir),
    ok,
    warnings: w.warnings
  };
  return index[maxa];
}

function listen(port, out) {
  fs.mkdirSync(out, { recursive: true });
  const indexFile = path.join(out, 'danh-muc-xa.json');
  const index = loadIndex(indexFile);
  const fetchScript = path.join(__dirname, 'cadastre-page-fetch.js');
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/fetch.js')) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(fs.readFileSync(fetchScript));
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/have')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Object.values(index).filter((x) => x.ok).map((x) => x.maxa)));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(404);
      res.end();
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (req.url.startsWith('/done')) {
          const { issues, failed, ...rest } = body;
          console.log(JSON.stringify({ done: rest, issues, failed }));
          res.writeHead(200);
          res.end('{}');
          setTimeout(() => process.exit(0), 200);
          return;
        }
        const t0 = Date.now();
        const info = saveXa(out, index, body);
        fs.writeFileSync(indexFile, JSON.stringify(index, null, 1));
        const { bbox, ...line } = info;
        console.log(JSON.stringify({ ...line, writeMs: Date.now() - t0 }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(info));
      } catch (err) {
        console.log(JSON.stringify({ error: String(err.message || err) }));
        res.writeHead(400);
        res.end(String(err.message || err));
      }
    });
  });
  server.listen(Number(port), '127.0.0.1');
  console.log(JSON.stringify({ listen: `http://127.0.0.1:${port}`, out, have: Object.keys(index).length }));
}

const args = parseArgs(process.argv);
if (!args.listen || !args.out || args.out === true) {
  console.error('Dùng: node scripts/cadastre-to-shp.js --listen <port> --out <thư mục>');
  process.exit(1);
}
listen(args.listen === true ? 8800 : args.listen, args.out);
