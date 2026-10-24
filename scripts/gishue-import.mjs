// Một lệnh: metadata gisHue → tải lớp → VN-2000 sang WGS84 → cắt lô → catalog tĩnh.
// node scripts/gishue-import.mjs --mapid 20797 [--mapid 20800] [--dry-run]
// --dry-run không ghi catalog, không sửa đồ án đã xuất bản. Cache thô nằm ở .cache/gishue (gitignore).
// REST trước. TLS gServer từ Node hay bị từ chối thì Chrome headless riêng (không đụng tab sẵn có).
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';

const require = createRequire(import.meta.url);
const { parseWkt, detectCrs, writeLayer } = require('./gserver-to-shp.js');
const { classifySector, slug, landUseName, SECTORS, loadGeeKey } = require('./build-chuyen-nganh.js');

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'https://gissonganh.hue.gov.vn';
const LIMIT = 20;
const CONC = 6;
const TRIES = 4;
const MB5 = 5 * 1024 * 1024;
const GCS_PREFIX = 'chuyen-nganh/v1';
const GCS_PUBLIC = 'https://storage.googleapis.com/hue-infra-data-us/';
const SKIP_GEOM = new Set(['geom', 's_geo', 'resultnumber']);

globalThis.turf = turf;
const emit = process.emit.bind(process);
process.emit = (event, warning, ...rest) => {
  if (event === 'warning' && warning && warning.code === 'MODULE_TYPELESS_PACKAGE_JSON') return false;
  return emit(event, warning, ...rest);
};
const { vn2000ToWgs84, CRS_PRESETS } = await import('../public/js/cadImport.js');
const { clipSchemeLots, schemeBoundaryOf, SCHEME_EDGE_M } = await import('../public/js/schemeLotClip.js');
const { CANBO_UNITS } = await import('../public/js/canBoUnits.js');

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

function projectSlug(name) {
  const src = String(name || '').normalize('NFC').trim();
  const ascii = src.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
  let base = ascii.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (base.length > 60) base = base.slice(0, 60).replace(/-+$/g, '');
  if (!base) base = 'do-an';
  const hash = crypto.createHash('sha256').update(src).digest('hex').slice(0, 8);
  return `${base}-${hash}`;
}

function levelOf(loai, title) {
  const t = strip(`${loai || ''} ${title || ''}`);
  if (/qhct|chi tiet|tong mat bang/.test(t)) return 'QHCT';
  if (/qhpk|phan khu/.test(t)) return 'QHPK';
  if (/qhc|quy hoach chung/.test(t)) return 'QHC';
  return '';
}

function scaleFrom(text) {
  const compact = String(text || '').replace(/\s/g, '');
  const m = compact.match(/1\/(\d{1,3}(?:\.\d{3})+|\d{3,6})/i);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, ''));
  if (!Number.isFinite(n) || n < 500 || n > 100000) return null;
  return n;
}

function placePhrase(tendoan) {
  let s = String(tendoan || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\([^)]*tỷ lệ[^)]*\)/gi, ' ');
  s = s.replace(/,?\s*tỷ lệ\s*1\s*\/\s*[\d.]+/gi, ' ');
  s = s.replace(/[\s,–\-]+(?:đến năm|tầm nhìn|định hướng)(?=\s|,|$).*/i, '');
  s = s.split(/,\s*(?:huyện|quận|thành phố|thị xã|tỉnh)(?=\s|,|$)/i)[0];
  s = s.replace(/^(?:bản đồ\s+)/i, '');
  s = s.replace(/^(?:điều chỉnh(?:\s+(?:tổng thể|cục bộ))?[\s,–\-]*)/i, '');
  s = s.replace(/^(?:quy hoạch|qh)\s+(?:chung|phân khu|chi tiết|tổng mặt bằng)(?:\s+xây dựng)?[\s,–\-]*/i, '');
  s = s.replace(/^(?:xây dựng\s+)/i, '');
  s = s.replace(/^[,–\-\s]+|[,–\-\s]+$/g, '').trim();
  if (!s) return '';
  if (/^(?:xã|phường|thị trấn)(?=\s|$)/i.test(s)) {
    return s.replace(/^(xã|phường|thị trấn)/i, (w) => w.toLocaleLowerCase('vi'));
  }
  return s.charAt(0).toLocaleUpperCase('vi') + s.slice(1);
}

function schemeName(level, place) {
  if (level && place && !place.toUpperCase().startsWith(level)) return `${level} ${place}`;
  return place || level || 'Đồ án';
}

function planStatus(layerName, groupName) {
  if (/(^|[^a-z])hien trang/.test(strip(layerName))) return 'hien-trang';
  if (/(^|[^a-z])hien trang/.test(strip(groupName))) return 'hien-trang';
  return 'quy-hoach';
}

function statusLabel(status) {
  return status === 'hien-trang' ? 'HT' : 'QH';
}

function isoDate(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return '';
}

function kindOf(kieu) {
  const s = strip(kieu);
  if (/point|diem/.test(s)) return 'point';
  if (/line|duong/.test(s)) return 'line';
  if (/polygon|vung|area/.test(s)) return 'polygon';
  return '';
}

function geomTypeOf(kind) {
  if (kind === 'point') return 'Point';
  if (kind === 'line') return 'LineString';
  return 'Polygon';
}

function shapeRole(kind) {
  if (kind === 'point') return { shape: 'Point', shapeType: 1 };
  if (kind === 'line') return { shape: 'PolyLine', shapeType: 3 };
  return { shape: 'Polygon', shapeType: 5 };
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv) {
  const mapids = [];
  let dry = false;
  let self = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') dry = true;
    else if (a === '--self-test') self = true;
    else if (a === '--mapid') {
      const n = Number(argv[++i]);
      if (!n) throw new Error('--mapid cần số');
      mapids.push(n);
    } else if (a === '--help' || a === '-h') {
      self = false;
      mapids.length = 0;
    } else throw new Error(`Không hiểu ${a}`);
  }
  return { mapids, dry, self };
}

function parsePayload(text) {
  const raw = String(text || '').trim();
  if (raw.startsWith('{') || raw.startsWith('[')) return JSON.parse(raw);
  const wrapped = raw.match(/^[\w$.]+\(([\s\S]*)\)\s*;?\s*$/);
  if (wrapped) return JSON.parse(wrapped[1]);
  throw new Error('Phản hồi không phải JSON');
}

function pool(limit) {
  let active = 0;
  const wait = [];
  return function run(fn) {
    return new Promise((resolve, reject) => {
      const start = () => {
        active += 1;
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            if (wait.length) wait.shift()();
          });
      };
      if (active >= limit) wait.push(start);
      else start();
    });
  };
}

async function nodeText(url) {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try { process.kill(pid); } catch { /* đã tắt */ }
  }
}

// Chrome trên Windows tách process khỏi PID spawn. Chỉ giết profile của lần chạy này.
function killChromeDir(dir) {
  if (process.platform !== 'win32' || !dir) return;
  spawnSync('powershell', [
    '-NoProfile',
    '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name = 'chrome.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:GISHUE_CHROME_DIR) } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }"
  ], { stdio: 'ignore', env: { ...process.env, GISHUE_CHROME_DIR: dir } });
}

function chromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ];
  return candidates.find((p) => fs.existsSync(p)) || '';
}

function openCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let next = 0;
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (!msg.id || !pending.has(msg.id)) return;
      const item = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) item.reject(new Error(msg.error.message));
      else item.resolve(msg.result);
    });
    ws.addEventListener('open', () => {
      resolve({
        close: () => ws.close(),
        send(method, params = {}, timeout = 90000) {
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
    ws.addEventListener('error', () => reject(new Error('Không nối được Chrome')));
  });
}

async function startChrome() {
  const bin = chromePath();
  if (!bin) throw new Error('Không có Chrome để tải gisHue');
  const port = await freePort();
  const dir = path.join(repo, '.cache', 'gishue', `chrome-${process.pid}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const child = spawn(bin, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    `--user-data-dir=${dir}`,
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*'
  ], { stdio: 'ignore' });
  const stop = () => {
    killTree(child.pid);
    killChromeDir(dir);
  };
  try {
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) break;
      } catch { /* đang mở */ }
      if (i === 49) throw new Error('Chrome headless không mở cổng gỡ lỗi');
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
      if (i === 39) throw new Error('Chrome không vào được gisHue');
      await sleep(250);
    }
    return {
      stop() { cdp.close(); stop(); },
      async text(url) {
        const expr = `fetch(${JSON.stringify(url)}).then(async (r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); })`;
        const got = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (got.exceptionDetails) {
          const detail = got.exceptionDetails.exception && got.exceptionDetails.exception.description;
          throw new Error(detail || got.exceptionDetails.text || 'fetch Chrome lỗi');
        }
        return got.result.value;
      }
    };
  } catch (err) {
    stop();
    throw err;
  }
}

function makeTransport(warnings) {
  let mode = 'node';
  let chrome = null;
  return {
    async text(url) {
      if (mode === 'chrome') return chrome.text(url);
      try {
        return await nodeText(url);
      } catch (err) {
        mode = 'chrome';
        warnings.push(`REST trực tiếp lỗi (${err.message}); dùng Chrome headless riêng`);
        chrome = await startChrome();
        return chrome.text(url);
      }
    },
    async close() {
      if (chrome) chrome.stop();
    }
  };
}

async function getJson(transport, url) {
  let last = 'unknown';
  for (let i = 1; i <= TRIES; i++) {
    try {
      return parsePayload(await transport.text(url));
    } catch (err) {
      last = err.message || String(err);
      await sleep(400 * i);
    }
  }
  throw new Error(`${url}: ${last}`);
}

function pageUrl(src, pageIndex, fields) {
  const q = new URLSearchParams({
    outFormat: 'json',
    page: String(pageIndex + 1),
    start: String(pageIndex * LIMIT),
    limit: String(LIMIT)
  });
  if (fields) q.set('fields', fields.join(','));
  return `${HOST}/gservices/rest/geodatas/${src.dv}/${src.bang}?${q}`;
}

function cacheFile(mapid, bang) {
  return path.join(repo, '.cache', 'gishue', String(mapid), `${bang}.json`);
}

function keepGeom(row) {
  const out = { ...row };
  delete out.resultnumber;
  if (out.geom) delete out.s_geo;
  return out;
}

async function fetchLayer(transport, mapid, src) {
  const file = cacheFile(mapid, src.bang);
  if (fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(cached.rows) && cached.rows.length === Number(cached.total)) return cached;
  }
  const first = await getJson(transport, pageUrl(src, 0));
  const total = Number(first.resultCount) || 0;
  const pages = total > 0 ? Math.ceil(total / LIMIT) : 0;
  const sample = (first.searchResult || []).slice();
  if (pages > 1) {
    const last = await getJson(transport, pageUrl(src, pages - 1));
    (last.searchResult || []).forEach((row) => sample.push(row));
  }
  const hasGeom = sample.some((row) => row && row.geom);
  const fields = [];
  sample.forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (key === 'resultnumber') return;
      if (key === 's_geo' && hasGeom) return;
      if (!fields.includes(key)) fields.push(key);
    });
  });
  if (hasGeom && !fields.includes('geom')) fields.push('geom');
  if (!hasGeom && !fields.includes('s_geo')) fields.push('s_geo');
  const run = pool(CONC);
  const chunks = await Promise.all(Array.from({ length: pages }, (_, i) => run(async () => {
    const data = await getJson(transport, pageUrl(src, i, fields));
    return (data.searchResult || []).map(keepGeom);
  })));
  const rows = [];
  chunks.forEach((part) => part.forEach((row) => rows.push(row)));
  if (rows.length !== total) throw new Error(`${src.ten}: tải ${rows.length}/${total}`);
  const doc = { total, fields, rows };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc));
  fs.renameSync(tmp, file);
  return doc;
}

function walkParsed(parsed, fn) {
  if (!parsed) return;
  if (parsed.type === 'POINT') fn(parsed.xy);
  else if (parsed.type === 'MULTIPOINT') parsed.points.forEach(fn);
  else if (parsed.parts) parsed.parts.forEach((part) => part.forEach(fn));
  else if (parsed.polygons) parsed.polygons.forEach((rings) => rings.forEach((ring) => ring.forEach(fn)));
  else if (parsed.members) parsed.members.forEach((member) => walkParsed(member, fn));
}

function mapParsed(parsed, fn) {
  if (!parsed) return null;
  const xy = (p) => fn(p);
  if (parsed.type === 'POINT') return { ...parsed, xy: xy(parsed.xy) };
  if (parsed.type === 'MULTIPOINT') return { ...parsed, points: parsed.points.map(xy) };
  if (parsed.parts) return { ...parsed, parts: parsed.parts.map((part) => part.map(xy)) };
  if (parsed.polygons) {
    return { ...parsed, polygons: parsed.polygons.map((rings) => rings.map((ring) => ring.map(xy))) };
  }
  if (parsed.members) return { ...parsed, members: parsed.members.map((member) => mapParsed(member, fn)) };
  return parsed;
}

function boxOf(parsed) {
  const box = { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
  walkParsed(parsed, (p) => {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
    if (p[0] < box.minx) box.minx = p[0];
    if (p[1] < box.miny) box.miny = p[1];
    if (p[0] > box.maxx) box.maxx = p[0];
    if (p[1] > box.maxy) box.maxy = p[1];
  });
  return Number.isFinite(box.minx) ? box : null;
}

function toGeometry(parsed) {
  if (!parsed) return null;
  if (parsed.type === 'POINT') return { type: 'Point', coordinates: parsed.xy };
  if (parsed.type === 'MULTIPOINT') return { type: 'MultiPoint', coordinates: parsed.points };
  if (parsed.type === 'LINESTRING') return { type: 'LineString', coordinates: parsed.parts[0] || [] };
  if (parsed.type === 'MULTILINESTRING') return { type: 'MultiLineString', coordinates: parsed.parts };
  if (parsed.type === 'POLYGON') return { type: 'Polygon', coordinates: parsed.polygons[0] || [] };
  if (parsed.type === 'MULTIPOLYGON') return { type: 'MultiPolygon', coordinates: parsed.polygons };
  if (parsed.type === 'GEOMETRYCOLLECTION') {
    const geometries = parsed.members.map(toGeometry).filter(Boolean);
    if (geometries.length === 1) return geometries[0];
    return geometries.length ? { type: 'GeometryCollection', geometries } : null;
  }
  return null;
}

function closeRings(geometry) {
  const close = (ring) => {
    if (!ring || ring.length < 3) return ring;
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return ring;
    return ring.concat([[a[0], a[1]]]);
  };
  if (!geometry) return geometry;
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geometry.coordinates.map(close) };
  }
  if (geometry.type === 'MultiPolygon') {
    return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((poly) => poly.map(close)) };
  }
  return geometry;
}

function inHue(geometry) {
  let ok = true;
  const walk = (c) => {
    if (!ok || !Array.isArray(c)) return;
    if (typeof c[0] === 'number') {
      if (c[0] < 106 || c[0] > 110 || c[1] < 15 || c[1] > 18) ok = false;
      return;
    }
    c.forEach(walk);
  };
  walk(geometry && geometry.coordinates);
  return ok;
}

function wktOf(row) {
  const geom = row && row.geom;
  const alt = row && row.s_geo;
  if (geom && String(geom).trim()) return String(geom);
  if (alt && String(alt).trim()) return String(alt);
  return '';
}

function projectLayer(rows) {
  const parsed = rows.map((row) => parseWkt(wktOf(row)));
  const box = { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
  parsed.forEach((item) => {
    const part = boxOf(item);
    if (!part) return;
    box.minx = Math.min(box.minx, part.minx);
    box.miny = Math.min(box.miny, part.miny);
    box.maxx = Math.max(box.maxx, part.maxx);
    box.maxy = Math.max(box.maxy, part.maxy);
  });
  const det = Number.isFinite(box.minx) ? detectCrs(box) : { crs: 'WGS84', swap: false };
  let crs = det.crs;
  const swap = det.swap;
  const preset = crs === 'HUE_3' || crs === 'UTM48_6' ? CRS_PRESETS[crs] : null;
  const fn = (p) => {
    const xy = swap ? [p[1], p[0]] : p;
    if (!preset) return xy;
    const [lat, lng] = vn2000ToWgs84(xy[0], xy[1], preset);
    return [lng, lat];
  };
  if (preset) crs = 'WGS84';
  return { parsed: parsed.map((item) => (item ? mapParsed(item, fn) : null)), crs, projected: !!preset, swapped: swap };
}

function propsOf(row) {
  const props = {};
  Object.keys(row || {}).forEach((key) => {
    if (SKIP_GEOM.has(key)) return;
    props[key] = row[key] == null ? '' : row[key];
  });
  return props;
}

function featuresFrom(rows) {
  const projected = projectLayer(rows);
  const features = [];
  let invalid = 0;
  rows.forEach((row, i) => {
    const geometry = closeRings(toGeometry(projected.parsed[i]));
    if (!geometry || !inHue(geometry) || projected.crs !== 'WGS84') {
      invalid += 1;
      return;
    }
    features.push({ type: 'Feature', properties: propsOf(row), geometry });
  });
  return { features, invalid, projected: projected.projected, swapped: projected.swapped, crs: projected.crs };
}

function isBoundaryName(name) {
  const s = strip(name);
  return /ranh gioi/.test(s) && !/hanh chinh/.test(s);
}

function loadLandIndex() {
  const file = path.join(repo, 'public', 'data', 'su-dung-dat-index.json');
  if (!fs.existsSync(file)) return { layers: [], aliases: [] };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function indexedLand(index, mapid, layerName) {
  if (!landUseName(layerName)) return null;
  const role = planStatus(layerName, '') === 'hien-trang' ? 'hien-trang' : 'quy-hoach';
  if (Number(mapid) === 21817) return { path: 'data/qhc2045', role, reason: 'mapid 21817 đã có file tĩnh' };
  const hit = (index.layers || []).find((row) => Number(row.mapid) === Number(mapid) && row.role === role);
  if (hit) return { path: hit.path, role, reason: 'đã có trong su-dung-dat-index' };
  return null;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writePretty(file, data) {
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const nl = prev.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(file, JSON.stringify(data, null, 2).replace(/\n/g, nl) + nl);
}

function fieldOrder(features) {
  const fields = [];
  features.forEach((feature) => {
    Object.keys(feature.properties || {}).forEach((key) => {
      if (!fields.includes(key)) fields.push(key);
    });
  });
  return fields;
}

function bboxOf(features) {
  let minx = Infinity; let miny = Infinity; let maxx = -Infinity; let maxy = -Infinity;
  const walk = (c) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number') {
      minx = Math.min(minx, c[0]); maxx = Math.max(maxx, c[0]);
      miny = Math.min(miny, c[1]); maxy = Math.max(maxy, c[1]);
      return;
    }
    c.forEach(walk);
  };
  features.forEach((feature) => walk(feature.geometry && feature.geometry.coordinates));
  if (!Number.isFinite(minx)) return null;
  return [minx, miny, maxx, maxy].map(round6);
}

function attr(row, key) {
  if (!row) return '';
  const hit = Object.keys(row).find((k) => k.toLowerCase() === key);
  return hit ? String(row[hit] ?? '').trim() : '';
}

function schemeFrom(metaRow, tenBanDo) {
  const tendoan = attr(metaRow, 'tendoan') || tenBanDo || '';
  const loai = attr(metaRow, 'loaiquyhoach');
  const level = levelOf(loai, tendoan) || levelOf('', tenBanDo);
  const place = placePhrase(tendoan) || placePhrase(tenBanDo);
  const name = schemeName(level, place);
  const scale = scaleFrom(attr(metaRow, 'tyle')) || scaleFrom(tendoan) || scaleFrom(tenBanDo);
  const decision = attr(metaRow, 'soquyetdinhpheduyetquyhoach');
  const task = attr(metaRow, 'soquyetdinhpheduyetnhiemvu');
  const authority = attr(metaRow, 'coquanquyetdinh');
  return {
    name,
    level: level || 'QHC',
    scale,
    decision,
    decisionDate: isoDate(attr(metaRow, 'ngayquyetdinhpheduyetquyhoach')),
    taskDecision: task,
    taskDecisionDate: isoDate(attr(metaRow, 'ngayquyetdinhpheduyetnhiemvu')),
    authority,
    rawDecisionDate: attr(metaRow, 'ngayquyetdinhpheduyetquyhoach'),
    rawTaskDate: attr(metaRow, 'ngayquyetdinhpheduyetnhiemvu')
  };
}

function wardOf(boundary) {
  if (!boundary) return null;
  const file = path.join(repo, 'public', 'data', 'ward-boundary.json');
  const doc = readJson(file);
  const feature = { type: 'Feature', properties: {}, geometry: boundary };
  const point = turf.centroid(feature);
  const wards = doc.features || [];
  let hit = wards.find((ward) => {
    try { return turf.booleanPointInPolygon(point, ward); } catch { return false; }
  });
  if (!hit) {
    let best = 0;
    wards.forEach((ward) => {
      try {
        const cut = turf.intersect(turf.featureCollection([feature, ward]));
        const area = cut ? turf.area(cut) : 0;
        if (area > best) { best = area; hit = ward; }
      } catch { /* ranh không cắt được */ }
    });
  }
  if (!hit) return null;
  const tenXa = hit.properties && hit.properties.tenXa;
  const unit = CANBO_UNITS.find((item) => strip(item.name) === strip(tenXa));
  if (!unit) return { name: tenXa || '', type: '', code: '' };
  const [type, code] = unit.key.split(':');
  return { name: unit.name, type, code };
}

function geomToWkt(geometry) {
  const xy = (c) => `${c[0]} ${c[1]}`;
  const ring = (r) => `(${r.map(xy).join(',')})`;
  if (!geometry) return '';
  if (geometry.type === 'Point') return `POINT (${xy(geometry.coordinates)})`;
  if (geometry.type === 'MultiPoint') return `MULTIPOINT (${geometry.coordinates.map((c) => `(${xy(c)})`).join(',')})`;
  if (geometry.type === 'LineString') return `LINESTRING ${ring(geometry.coordinates)}`;
  if (geometry.type === 'MultiLineString') return `MULTILINESTRING (${geometry.coordinates.map(ring).join(',')})`;
  if (geometry.type === 'Polygon') return `POLYGON (${geometry.coordinates.map(ring).join(',')})`;
  if (geometry.type === 'MultiPolygon') {
    return `MULTIPOLYGON (${geometry.coordinates.map((poly) => `(${poly.map(ring).join(',')})`).join(',')})`;
  }
  return '';
}

function catalogScheme(slugName, mapid, info, area) {
  const priority = info.level === 'QHCT' ? 3 : info.level === 'QHPK' ? 2 : 1;
  const row = {
    slug: slugName,
    name: info.name,
    level: info.level,
    mapid,
    parent: null,
    overrides: [],
    priority
  };
  if (info.scale != null) row.scale = info.scale;
  if (area && area.code) row.area = { type: area.type, code: area.code };
  if (info.taskDecision) row.taskDecision = info.taskDecision;
  if (info.taskDecisionDate) row.taskDecisionDate = info.taskDecisionDate;
  if (info.decision) row.decision = info.decision;
  if (info.decisionDate) row.decisionDate = info.decisionDate;
  if (info.authority) row.authority = info.authority;
  return row;
}

function clipLogKept(slugName) {
  const logFile = path.join(repo, 'docs', 'cat-lo-ngoai-ranh.jsonl');
  if (!fs.existsSync(logFile)) return { logFile, kept: [] };
  const needle = `${path.sep}chuyen-nganh${path.sep}${slugName}${path.sep}`;
  const needlePosix = `/chuyen-nganh/${slugName}/`;
  const kept = [];
  fs.readFileSync(logFile, 'utf8').split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    try {
      const row = JSON.parse(line);
      const land = String(row.land || '');
      const out = String(row.out || '');
      if (land.includes(needle) || land.includes(needlePosix) || out.includes(needle) || out.includes(needlePosix)) return;
    } catch { /* giữ dòng không parse được */ }
    kept.push(line);
  });
  return { logFile, kept };
}

async function putHeavy(uploads) {
  if (!uploads.length) return;
  loadGeeKey(repo);
  const gcs = require('../services/gcsWrite');
  for (const up of uploads) {
    await gcs.putObject(up.object, fs.readFileSync(up.local), up.type, undefined, 180000);
  }
}

async function publish(mapid, scheme, area, built, dry) {
  if (dry) return { wrote: false, uploaded: [] };
  const schemesFile = path.join(repo, 'public', 'data', 'chuyen-nganh', 'schemes.json');
  const indexFile = path.join(repo, 'public', 'data', 'chuyen-nganh', 'index.json');
  const schemes = readJson(schemesFile);
  const index = readJson(indexFile);
  const existing = (schemes.schemes || []).find((row) => Number(row.mapid) === mapid);
  const slugName = existing ? existing.slug : projectSlug(scheme.name);
  const schemeRow = catalogScheme(slugName, mapid, scheme, area);
  if (existing) Object.assign(existing, schemeRow, { slug: existing.slug });
  else schemes.schemes.push(schemeRow);
  const used = new Set();
  const entries = [];
  const uploads = [];
  const clipLogs = [];
  let boundaryAbs = '';
  for (const layer of built) {
    if (!layer.features.length || !layer.sector) continue;
    const base = slug(layer.name);
    let stem = base;
    let n = 2;
    const folder = path.join(repo, 'data', 'chuyen-nganh', slugName, layer.sector, layer.status);
    while (used.has(path.join(folder, stem))) { stem = `${base}-${n}`; n += 1; }
    used.add(path.join(folder, stem));
    const rel = path.posix.join('data/chuyen-nganh', slugName, layer.sector, layer.status, `${stem}.geojson`);
    const fc = { type: 'FeatureCollection', features: layer.features };
    const body = JSON.stringify(fc);
    const geoBytes = Buffer.byteLength(body);
    const geoHeavy = geoBytes > MB5;
    const cacheDir = path.join(repo, '.cache', 'gishue', 'out', String(mapid), stem);
    const work = geoHeavy ? cacheDir : folder;
    fs.mkdirSync(work, { recursive: true });
    fs.mkdirSync(folder, { recursive: true });
    const rows = layer.features.map((feature) => ({ ...feature.properties, geom: geomToWkt(feature.geometry) }));
    writeLayer(work, stem, shapeRole(layer.kind), rows, 'WGS84');
    const geoLocal = path.join(work, `${stem}.geojson`);
    fs.writeFileSync(geoLocal, body);
    let zipLocal = path.join(work, `${stem}.zip`);
    const zipBytes = fs.statSync(zipLocal).size;
    const zipHeavy = zipBytes > MB5;
    if (zipHeavy && work === folder) {
      fs.mkdirSync(cacheDir, { recursive: true });
      const parked = path.join(cacheDir, `${stem}.zip`);
      fs.renameSync(zipLocal, parked);
      zipLocal = parked;
    }
    if (work !== folder) {
      fs.copyFileSync(path.join(work, `${stem}-ten-truong.txt`), path.join(folder, `${stem}-ten-truong.txt`));
      if (!zipHeavy) fs.copyFileSync(zipLocal, path.join(folder, `${stem}.zip`));
    }
    const relDir = path.posix.join(slugName, layer.sector, layer.status);
    let file = rel;
    if (geoHeavy) {
      const object = `${GCS_PREFIX}/${relDir}/${stem}.geojson`;
      uploads.push({ local: geoLocal, object, type: 'application/geojson', name: layer.name, bytes: geoBytes });
      file = GCS_PUBLIC + object;
    }
    if (zipHeavy) {
      uploads.push({
        local: zipLocal,
        object: `${GCS_PREFIX}/${relDir}/${stem}.zip`,
        type: 'application/zip',
        name: layer.name,
        bytes: zipBytes
      });
    }
    const boundaryFile = geoHeavy ? geoLocal : path.join(repo, rel);
    if (isBoundaryName(layer.name) && (!boundaryAbs || layer.kind === 'polygon')) boundaryAbs = boundaryFile;
    entries.push({
      sector: layer.sector,
      scale: scheme.scale,
      status: layer.status,
      scheme: slugName,
      level: scheme.level,
      name: layer.name,
      geomType: geomTypeOf(layer.kind),
      featureCount: layer.features.length,
      fields: fieldOrder(layer.features),
      file,
      bbox: bboxOf(layer.features)
    });
    if (layer.clip) clipLogs.push({ rel, clip: layer.clip });
  }
  const { logFile, kept } = clipLogKept(slugName);
  if (clipLogs.length || kept.length) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const added = clipLogs.map(({ rel, clip }) => JSON.stringify({
      at: new Date().toISOString(),
      land: path.join(repo, rel),
      boundary: boundaryAbs,
      out: path.join(repo, rel),
      edgeM: SCHEME_EDGE_M,
      bo: clip.bo,
      cat: clip.cat,
      giu: clip.giu
    }));
    const next = kept.concat(added);
    if (fs.existsSync(logFile) || next.length) fs.writeFileSync(logFile, next.length ? `${next.join('\n')}\n` : '');
  }
  await putHeavy(uploads);
  const sectorOrder = new Map(SECTORS.map((item, i) => [item[0], i]));
  entries.sort((a, b) => (
    (sectorOrder.get(a.sector) - sectorOrder.get(b.sector))
    || String(a.status).localeCompare(String(b.status))
    || a.name.localeCompare(b.name, 'vi')
  ));
  index.layers = (index.layers || []).filter((row) => row.scheme !== slugName).concat(entries);
  const gaps = [];
  SECTORS.forEach(([sector]) => {
    ['hien-trang', 'quy-hoach'].forEach((status) => {
      if (entries.some((row) => row.sector === sector && row.status === status)) return;
      gaps.push({
        scheme: slugName, sector, scale: scheme.scale, status, level: scheme.level,
        name: '', featureCount: 0, reason: 'Không có lớp'
      });
    });
  });
  index.gaps = (index.gaps || []).filter((row) => row.scheme !== slugName).concat(gaps);
  writePretty(schemesFile, schemes);
  writePretty(indexFile, index);
  const link = path.join(repo, 'public', 'data', 'chuyen-nganh', slugName);
  const target = path.join(repo, 'data', 'chuyen-nganh', slugName);
  if (!fs.existsSync(link) && fs.existsSync(target)) {
    fs.symlinkSync(path.relative(path.dirname(link), target), link, 'dir');
  }
  return {
    wrote: true,
    slug: slugName,
    uploaded: uploads.map((item) => ({ name: item.name, bytes: item.bytes, object: item.object }))
  };
}

function listDataLayers(info) {
  const groups = new Map((info.cacLopBanDo || info.layers || []).map((layer) => [String(layer.maLopBanDo), layer.tenLopBanDo]));
  const seen = new Set();
  const layers = [];
  (info.cacLopBanDo || []).forEach((layer) => {
    if (!layer.lopDuLieu) return;
    const kind = kindOf(layer.kieuKhongGian);
    if (!kind) return;
    const id = `${layer.maDichVu}/${layer.lopDuLieu}`;
    if (seen.has(id)) return;
    seen.add(id);
    layers.push({
      ten: layer.tenLopBanDo,
      bang: layer.lopDuLieu,
      dv: layer.maDichVu,
      kind,
      nhom: layer.nhom ? (groups.get(String(layer.nhom)) || '') : ''
    });
  });
  return layers;
}

function publishedRows(mapid) {
  const schemes = readJson(path.join(repo, 'public', 'data', 'chuyen-nganh', 'schemes.json'));
  const hit = (schemes.schemes || []).find((row) => Number(row.mapid) === mapid);
  if (!hit) return null;
  const index = readJson(path.join(repo, 'public', 'data', 'chuyen-nganh', 'index.json'));
  const layers = (index.layers || []).filter((row) => row.scheme === hit.slug);
  return { scheme: hit, layers };
}

function printMap(mapid, scheme, area, rows, warnings, published) {
  const bits = [String(mapid), scheme.name, scheme.level];
  if (scheme.scale) bits.push(`1/${scheme.scale}`);
  if (area && area.code) bits.push(`${area.type}:${area.code}`);
  else if (area && area.name) bits.push(area.name);
  if (scheme.authority) bits.push(scheme.authority);
  if (scheme.decision) bits.push(scheme.decision);
  console.log(bits.join(' | '));
  console.log('lop | tt | n | bo | cat | hong');
  let features = 0;
  let ht = 0;
  let cn = 0;
  rows.forEach((row) => {
    if (row.skip) {
      console.log(`${row.name} | bo-qua | 0 | bo 0 | cat 0 | hong 0`);
      return;
    }
    features += row.n;
    if (/hien trang su dung dat/.test(strip(row.name))) ht += row.n;
    if (/chuc nang su dung dat/.test(strip(row.name))) cn += row.n;
    console.log(`${row.name} | ${row.tt} | ${row.n} | bo ${row.bo} | cat ${row.cat} | hong ${row.hong}`);
  });
  const counted = rows.filter((row) => !row.skip).length;
  console.log(`${counted} lop, ${features} doi tuong; HT ${ht}; CN ${cn}`);
  if (published) {
    const byName = new Map(published.layers.map((row) => [row.name, row.featureCount]));
    const leaks = rows.filter((row) => !row.skip && byName.get(row.name) !== row.n);
    if (!leaks.length && counted === published.layers.length && features === published.layers.reduce((s, row) => s + (row.featureCount || 0), 0)) {
      console.log(`khop catalog ${published.scheme.slug}`);
    } else {
      leaks.forEach((row) => warnings.push(`${row.name}: catalog ${byName.has(row.name) ? byName.get(row.name) : 'khong co'}, tai ${row.n}`));
      if (counted !== published.layers.length) warnings.push(`so lop ${counted}, catalog ${published.layers.length}`);
    }
  }
  warnings.forEach((text) => console.log(`! ${text}`));
  return { features, counted, ht, cn, mismatch: warnings.some((text) => text.includes('catalog')) };
}

async function importMap(transport, mapid, dry) {
  const warnings = [];
  const info = await getJson(transport, `${HOST}/gservices/rest/vectormaps/gsv_system/map/${mapid}`);
  const tenBanDo = info.tenBanDo || '';
  const listed = listDataLayers(info);
  if (!listed.length) throw new Error(`mapid ${mapid} không có lớp dữ liệu`);
  const index = loadLandIndex();
  const selected = [];
  const summary = [];
  for (const layer of listed) {
    const known = indexedLand(index, mapid, layer.ten);
    if (known) {
      summary.push({ name: layer.ten, tt: 'bo-qua', n: 0, bo: 0, cat: 0, hong: 0, skip: true });
      warnings.push(`bỏ qua ${layer.ten}: ${known.reason} (${known.path})`);
      continue;
    }
    selected.push(layer);
  }
  const loaded = [];
  for (const layer of selected) {
    const doc = await fetchLayer(transport, mapid, layer);
    loaded.push({ layer, doc });
  }
  const boundarySrc = loaded.find((item) => item.layer.kind === 'polygon' && isBoundaryName(item.layer.ten))
    || loaded.find((item) => isBoundaryName(item.layer.ten));
  const boundaryFeatures = boundarySrc ? featuresFrom(boundarySrc.doc.rows).features : [];
  const boundary = schemeBoundaryOf(boundaryFeatures);
  if (!boundary && loaded.some((item) => landUseName(item.layer.ten))) {
    throw new Error(`mapid ${mapid}: không khép được ranh để cắt lô`);
  }
  const metaRow = boundarySrc && boundarySrc.doc.rows[0];
  const scheme = schemeFrom(metaRow, tenBanDo);
  if (!scheme.level) warnings.push('không nhận được cấp đồ án');
  if (scheme.decision && !scheme.decisionDate && scheme.rawDecisionDate) warnings.push('ngày quyết định phê duyệt không đọc được');
  if (scheme.taskDecision && !scheme.taskDecisionDate && scheme.rawTaskDate) warnings.push('ngày quyết định nhiệm vụ không đọc được');
  const area = wardOf(boundary);
  if (!area || !area.code) warnings.push('không gắn được xã/phường hiện hành');
  const built = [];
  for (const item of loaded) {
    const made = featuresFrom(item.doc.rows);
    if (made.projected) warnings.push(`${item.layer.ten}: đã chuyển VN-2000 sang WGS84`);
    if (made.swapped && !made.projected) warnings.push(`${item.layer.ten}: đã đảo trục tọa độ`);
    if (made.crs !== 'WGS84') warnings.push(`${item.layer.ten}: không nhận hệ tọa độ`);
    let features = made.features;
    let bo = 0;
    let cat = 0;
    let giu = features.length;
    let clip = null;
    if (landUseName(item.layer.ten) && item.layer.kind === 'polygon' && boundary) {
      const cut = clipSchemeLots(features, boundary);
      features = cut.features;
      bo = cut.counts ? cut.counts.bo : 0;
      cat = cut.counts ? cut.counts.cat : 0;
      giu = cut.counts ? cut.counts.giu : features.length;
      clip = { bo, cat, giu };
    }
    const sector = classifySector(item.layer.ten);
    if (!sector) warnings.push(`${item.layer.ten}: chưa xếp được ngành`);
    const status = planStatus(item.layer.ten, item.layer.nhom);
    summary.push({
      name: item.layer.ten,
      tt: statusLabel(status),
      n: features.length,
      bo,
      cat,
      hong: made.invalid,
      skip: false
    });
    built.push({
      name: item.layer.ten,
      kind: item.layer.kind,
      sector,
      status,
      features,
      clip,
      boundaryFile: ''
    });
  }
  const unclassified = built.filter((layer) => layer.features.length && !layer.sector).map((layer) => layer.name);
  if (unclassified.length) {
    printMap(mapid, scheme, area, summary, warnings, null);
    throw new Error(`chưa xếp ngành: ${unclassified.join(', ')}`);
  }
  if (dry) {
    const published = publishedRows(mapid);
    const printed = printMap(mapid, scheme, area, summary, warnings, published);
    if (published && printed.mismatch) throw new Error(`mapid ${mapid} lệch catalog`);
    return printed;
  }
  const printed = printMap(mapid, scheme, area, summary, warnings, null);
  const result = await publish(mapid, scheme, area, built, dry);
  (result.uploaded || []).forEach((item) => console.log(`! GCS ${item.bytes} byte ${item.object}`));
  return printed;
}

function selfTest() {
  const tendoan = 'Quy hoạch chung xây dựng xã Thượng Long, huyện Nam Đông, tỉnh Thừa Thiên Huế đến năm 2030';
  const name = schemeName(levelOf('Quy hoạch chung', tendoan), placePhrase(tendoan));
  if (name !== 'QHC xã Thượng Long') throw new Error(`tên ${name}`);
  if (projectSlug(name) !== 'qhc-xa-thuong-long-3f2c4da4') throw new Error('slug');
  if (scaleFrom('1/25000') !== 25000 || scaleFrom('1/2.000') !== 2000) throw new Error('tỷ lệ');
  if (levelOf('Quy hoạch phân khu', '') !== 'QHPK') throw new Error('QHPK');
  if (levelOf('Quy hoạch chi tiết', '') !== 'QHCT') throw new Error('QHCT');
  const row = { geom: '', s_geo: 'POINT (107.6 16.4)', ten: 'a' };
  const made = featuresFrom([row]);
  if (made.features.length !== 1 || made.features[0].geometry.type !== 'Point') throw new Error('s_geo');
  const meters = featuresFrom([{ geom: 'POINT (560000 1770000)' }]);
  if (!meters.projected || meters.invalid !== 0) throw new Error('VN-2000');
  const boundary = { type: 'Polygon', coordinates: [[[107.58, 16.46], [107.59, 16.46], [107.59, 16.47], [107.58, 16.47], [107.58, 16.46]]] };
  const inside = { type: 'Feature', properties: { nhan: 'trong' }, geometry: { type: 'Polygon', coordinates: [[[107.582, 16.462], [107.585, 16.462], [107.585, 16.465], [107.582, 16.465], [107.582, 16.462]]] } };
  const clip = clipSchemeLots([inside], boundary);
  if (clip.counts.giu !== 1 || clip.counts.bo !== 0) throw new Error('cắt lô trong ranh');
  console.log('self-test ok');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.self) {
    selfTest();
    return;
  }
  if (!args.mapids.length) {
    console.error('Dùng: node scripts/gishue-import.mjs --mapid <id> [--mapid <id> ...] [--dry-run]');
    process.exit(1);
  }
  const warnings = [];
  const transport = makeTransport(warnings);
  let failed = false;
  try {
    for (const mapid of args.mapids) {
      try {
        await importMap(transport, mapid, args.dry);
      } catch (err) {
        failed = true;
        console.log(`! mapid ${mapid}: ${err.message || err}`);
      }
    }
    warnings.forEach((text) => console.log(`! ${text}`));
  } finally {
    await transport.close();
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
