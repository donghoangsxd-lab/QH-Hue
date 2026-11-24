// Liệt kê lớp IMAGE mapid → JSON (Edge CDP).
// node scripts/gishue-raster-list.mjs --mapid 21817
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
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--mapid') mapid = Number(argv[++i]);
  }
  return { mapid };
}

function chromePath() {
  // Chỉ Microsoft Edge (không dùng Chrome). EDGE_PATH ghi đè đường dẫn.
  return [
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
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
    ws.on('error', () => reject(new Error('Không nối được Edge CDP')));
  });
}

async function startChrome() {
  const bin = chromePath();
  if (!bin) throw new Error('Không có Microsoft Edge (cài Edge hoặc đặt EDGE_PATH)');
  const port = await freePort();
  const dir = path.join(repo, '.cache', 'gishue', `edge-list-${process.pid}`);
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
    if (i === 49) { stop(); throw new Error('Edge không mở'); }
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
    if (i === 39) { cdp.close(); stop(); throw new Error('Edge không vào được gisHue'); }
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

function inferLevel(name) {
  const s = strip(name);
  if (s.includes('1:25n') || s.includes('1/25') || s.includes('toan do thi')) return 'qhc25';
  if (s.includes('1:10n') || s.includes('1/10') || s.includes('trung tam')) return 'qhc10';
  return 'qhc10';
}

function inferPhase(name) {
  const s = strip(name);
  if (s.includes('hien trang') || /^ban do 2[a-z]/.test(s) || /^ban do 3[a-z]/.test(s) || s.includes('ban do 04')) return 'HT';
  return 'QH';
}

function shortName(name) {
  const m = String(name || '').match(/^Bản đồ\s+([0-9]+[A-Za-z]?)\s*(.*)$/i);
  if (!m) return String(name || '').slice(0, 48);
  const code = m[1].toUpperCase();
  const rest = strip(m[2]);
  const ht = rest.includes('hien trang');
  const rules = [
    [/hien trang su dung dat/, 'HT SDD'],
    [/quy hoach su dung dat/, 'QH SDD'],
    [/phat trien khong gian/, ht ? 'HT không gian' : 'ĐH không gian'],
    [/danh gia tong hop/, 'ĐG đất xây dựng'],
    [/cong trinh ngam/, 'ĐH công trình ngầm'],
    [/vien thong/, ht ? 'HT viễn thông' : 'ĐH viễn thông'],
    [/thoat nuoc thai|chat thai ran|nghia trang/, ht ? 'HT TNT/CTR' : 'ĐH TNT/CTR'],
    [/cap nuoc/, ht ? 'HT cấp nước' : 'ĐH cấp nước'],
    [/he thong dien|cap dien|cung cap nang luong|cap nang luong/, ht ? 'HT điện' : 'QH/ĐH điện'],
    [/giao thong/, ht ? 'HT giao thông' : 'ĐH giao thông'],
    [/chuan bi ky thuat/, ht ? 'HT CBKT' : 'QH/ĐH CBKT']
  ];
  for (const [re, label] of rules) {
    if (re.test(rest)) return `Bản đồ ${code} ${label}`;
  }
  const raw = m[2]
    .replace(/\(1:10N\)/gi, '')
    .replace(/\(1:25N\)/gi, '')
    .replace(/khu vực đô thị trung tâm/gi, '')
    .replace(/toàn đô thị/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return raw ? `Bản đồ ${code} ${raw.slice(0, 28)}` : `Bản đồ ${code}`;
}

async function main() {
  const { mapid } = parseArgs(process.argv);
  const chrome = await startChrome();
  try {
    const mapUrl = `${HOST}/gservices/rest/vectormaps/gsv_system/map/${mapid}`;
    const info = await chrome.eval(`(async () => {
      const r = await fetch(${JSON.stringify(mapUrl)});
      const t = await r.text();
      let data; try { data = JSON.parse(t); } catch (e) { data = JSON.parse(t.match(/\\{[\\s\\S]*\\}/)[0]); }
      return data.result || data;
    })()`);
    const skip = new Set(['ve tinh', 'google', 'ban do hanh chinh hue']);
    const raw = (info.cacLopBanDo || []).filter((l) => {
      if (String(l.kieuKhongGian).toUpperCase() !== 'IMAGE') return false;
      return !skip.has(strip(l.tenLopBanDo));
    });
    const layers = raw.map((l, i) => {
      const name = l.tenLopBanDo;
      const level = inferLevel(name);
      const phase = inferPhase(name);
      return {
        id: l.maDichVu,
        name,
        short: shortName(name),
        scale: level === 'qhc25' ? 25000 : 10000,
        path: l.duongDan,
        zMin: Number(l.mucXemNhoNhat) || 9,
        zMax: Number(l.mucXemLonNhat) || 18,
        crsTiles: 'EPSG:3857',
        priority: i + 1,
        level,
        phase
      };
    });
    // Ưu tiên: HT trước, rồi QH; trong nhóm theo mã bản đồ
    const rank = (id) => {
      const m = String(id).match(/(\d+)/);
      return m ? Number(m[1]) : 999;
    };
    layers.sort((a, b) => {
      if (a.level !== b.level) return a.level === 'qhc25' ? -1 : 1;
      if (a.phase !== b.phase) return a.phase === 'HT' ? -1 : 1;
      return rank(a.short) - rank(b.short) || a.short.localeCompare(b.short, 'vi');
    });
    layers.forEach((row, i) => { row.priority = i + 1; });
    const catalog = {
      v: 1,
      mapid,
      source: `${HOST}/geditor.aspx?mapid=${mapid}`,
      host: HOST,
      note: 'Lớp IMAGE XYZ Web Mercator (Leaflet {z}/{x}/{y}). Không crossOrigin (ACAO gisHue lỗi). Phân cấp qhc25 / qhc10 và phase HT / QH.',
      defaultId: 'bando_qhsdd_kvdttt_1_10n',
      layers
    };
    const out = path.join(repo, 'public', 'data', 'qhc-raster', 'catalog.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(catalog, null, 2)}\n`);
    console.log('wrote', out);
    console.log('count', layers.length);
    layers.forEach((l) => console.log(`${l.level}\t${l.phase}\t${l.id}\t${l.short}`));
  } finally {
    chrome.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
