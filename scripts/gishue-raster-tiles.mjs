// Tải lớp IMAGE (XYZ Web Mercator) từ gisHue map metadata.
// node scripts/gishue-raster-tiles.mjs --mapid 21817 --match "Bản đồ 09" --z 14 [--z 15]
// Giữ nguyên georef: tile XYZ + meta bounds/CRS. Cache: .cache/gishue/raster/<dv>/{z}/{x}/{y}.png
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'https://gissonganh.hue.gov.vn';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function strip(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseArgs(argv) {
  let mapid = 21817;
  let match = 'ban do 09';
  const zooms = [];
  let west = 107.48, south = 16.40, east = 107.65, north = 16.55;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mapid') mapid = Number(argv[++i]);
    else if (a === '--match') match = strip(argv[++i]);
    else if (a === '--z') zooms.push(Number(argv[++i]));
    else if (a === '--west') west = Number(argv[++i]);
    else if (a === '--south') south = Number(argv[++i]);
    else if (a === '--east') east = Number(argv[++i]);
    else if (a === '--north') north = Number(argv[++i]);
  }
  if (!zooms.length) zooms.push(14);
  return { mapid, match, zooms, bbox: { west, south, east, north } };
}

function chromePath() {
  return [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.CHROME_PATH
  ].filter(Boolean).find((p) => fs.existsSync(p)) || '';
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

function openCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let next = 0;
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (!msg.id || !pending.has(msg.id)) return;
      const item = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) item.reject(new Error(msg.error.message));
      else item.resolve(msg.result);
    });
    ws.on('open', () => {
      resolve({
        close: () => ws.close(),
        send(method, params = {}, timeout = 120000) {
          return new Promise((res, rej) => {
            const id = ++next;
            const timer = setTimeout(() => {
              pending.delete(id);
              rej(new Error(`CDP quá hạn: ${method}`));
            }, timeout);
            pending.set(id, {
              resolve: (v) => { clearTimeout(timer); res(v); },
              reject: (e) => { clearTimeout(timer); rej(e); }
            });
            ws.send(JSON.stringify({ id, method, params }));
          });
        }
      });
    });
    ws.on('error', () => reject(new Error('Không nối được Chrome')));
  });
}

async function startChrome() {
  const bin = chromePath();
  if (!bin) throw new Error('Không có Chrome');
  const port = await freePort();
  const dir = path.join(repo, '.cache', 'gishue', `chrome-raster-${process.pid}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const child = spawn(bin, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', `--user-data-dir=${dir}`, `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*'
  ], { stdio: 'ignore' });
  const stop = () => {
    try { process.kill(child.pid); } catch (e) { /* */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ }
  };
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
    } catch { /* */ }
    if (i === 49) { stop(); throw new Error('Chrome không mở'); }
    await sleep(200);
  }
  const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  const target = await created.json();
  const cdp = await openCdp(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: `${HOST}/` });
  for (let i = 0; i < 40; i++) {
    const got = await cdp.send('Runtime.evaluate', { expression: 'location.origin', returnByValue: true });
    if (got.result && got.result.value === HOST) break;
    if (i === 39) { cdp.close(); stop(); throw new Error('Chrome không vào được gisHue'); }
    await sleep(250);
  }
  return {
    stop() { cdp.close(); stop(); },
    async eval(expression, timeout = 120000) {
      const got = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout);
      if (got.exceptionDetails) {
        const d = got.exceptionDetails.exception && got.exceptionDetails.exception.description;
        throw new Error(d || got.exceptionDetails.text || 'eval lỗi');
      }
      return got.result.value;
    }
  };
}

function lon2tile(lon, z) {
  return Math.floor((lon + 180) / 360 * 2 ** z);
}
function lat2tile(lat, z) {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z);
}
function tile2lon(x, z) {
  return x / 2 ** z * 360 - 180;
}
function tile2lat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / 2 ** z;
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

async function main() {
  const opts = parseArgs(process.argv);
  const chrome = await startChrome();
  try {
    const mapUrl = `${HOST}/gservices/rest/vectormaps/gsv_system/map/${opts.mapid}`;
    const info = await chrome.eval(`(async () => {
      const r = await fetch(${JSON.stringify(mapUrl)});
      const t = await r.text();
      let data; try { data = JSON.parse(t); } catch (e) { data = JSON.parse(t.match(/\\{[\\s\\S]*\\}/)[0]); }
      return data.result || data;
    })()`);
    const layers = (info.cacLopBanDo || []).filter((l) => String(l.kieuKhongGian).toUpperCase() === 'IMAGE');
    const layer = layers.find((l) => strip(l.tenLopBanDo).includes(opts.match));
    if (!layer) {
      console.error('Không thấy lớp khớp', opts.match);
      console.error('IMAGE layers:');
      layers.forEach((l) => console.error('-', l.tenLopBanDo));
      process.exit(1);
    }
    const dv = layer.maDichVu;
    const tpl = `${HOST}${layer.duongDan}`;
    const outRoot = path.join(repo, '.cache', 'gishue', 'raster', dv);
    fs.mkdirSync(outRoot, { recursive: true });
    const meta = {
      mapid: opts.mapid,
      name: layer.tenLopBanDo,
      service: dv,
      pathTemplate: layer.duongDan,
      crsDeclared: layer.heQuyChieu,
      crsTiles: 'EPSG:3857',
      zMin: Number(layer.mucXemNhoNhat) || 9,
      zMax: Number(layer.mucXemLonNhat) || 18,
      boundsMeta: typeof layer.vungBaoLonNhat === 'string' ? JSON.parse(layer.vungBaoLonNhat) : layer.vungBaoLonNhat,
      bboxDownload: opts.bbox,
      zooms: opts.zooms,
      tileUrl: tpl,
      note: 'Tile XYZ Web Mercator (thực tế), metadata ghi EPSG:4326 nhưng tọa độ merc khớp nội dung.'
    };
    fs.writeFileSync(path.join(outRoot, 'meta.json'), JSON.stringify(meta, null, 2));
    console.log(layer.tenLopBanDo);
    console.log('service', dv);
    console.log('bbox', opts.bbox);

    for (const z of opts.zooms) {
      const x0 = lon2tile(opts.bbox.west, z);
      const x1 = lon2tile(opts.bbox.east, z);
      const y0 = lat2tile(opts.bbox.north, z);
      const y1 = lat2tile(opts.bbox.south, z);
      const total = (x1 - x0 + 1) * (y1 - y0 + 1);
      let ok = 0, skip = 0, fail = 0, bytes = 0;
      console.log(`z=${z} tiles ${x0}..${x1} × ${y0}..${y1} = ${total}`);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const dest = path.join(outRoot, String(z), String(x), `${y}.png`);
          if (fs.existsSync(dest) && fs.statSync(dest).size > 2000) {
            skip++;
            continue;
          }
          const url = tpl.replace('${z}', z).replace('${x}', x).replace('${y}', y);
          try {
            const b64 = await chrome.eval(`(async () => {
              const r = await fetch(${JSON.stringify(url)});
              if (!r.ok) throw new Error('HTTP ' + r.status);
              const buf = await r.arrayBuffer();
              const u8 = new Uint8Array(buf);
              let s = '';
              const chunk = 0x8000;
              for (let i = 0; i < u8.length; i += chunk) s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
              return btoa(s);
            })()`);
            const buf = Buffer.from(b64, 'base64');
            if (buf.length < 500) {
              fail++;
              continue;
            }
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, buf);
            ok++;
            bytes += buf.length;
          } catch (err) {
            fail++;
            console.warn(`! ${z}/${x}/${y}: ${err.message}`);
          }
        }
      }
      const west = tile2lon(x0, z);
      const east = tile2lon(x1 + 1, z);
      const north = tile2lat(y0, z);
      const south = tile2lat(y1 + 1, z);
      console.log(`z${z}: ok ${ok}, skip ${skip}, fail ${fail}, ${(bytes / 1024 / 1024).toFixed(2)} MB moi; bounds ${west.toFixed(5)},${south.toFixed(5)}..${east.toFixed(5)},${north.toFixed(5)}`);
    }
    console.log('wrote', path.join(outRoot, 'meta.json'));
  } finally {
    chrome.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
