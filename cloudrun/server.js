// Máy chủ Cloud Run cho /api/gee, /api/osmClip, /api/pmtilesRange.
// Bắt chước req.query / req.body và res.status().json() để handler api/* chạy trên Cloud Run.
const http = require('http');
const { allow } = require('../services/rateWindow');

const MAX_BODY = 15 * 1024 * 1024;
const GET_WINDOW_MS = 60 * 1000;
const TILE_ACTIONS = new Set(['getSatTile', 'getPopRasterTile']);
const buckets = new Map();

function bucket(name) {
  let store = buckets.get(name);
  if (!store) {
    store = new Map();
    buckets.set(name, store);
  }
  return store;
}

// Trần riêng, không dùng chung Map với services/getRate.js: chung store thì mỗi request bị đếm hai lần.
// QH_GET_LIMIT chỉ hạ trần đọc JSON (để kiểm thử). Ô vệ tinh và Range giữ trần cao.
function limitFor(url) {
  const path = url.pathname;
  if (path === '/api/pmtilesRange') return { name: 'pmtiles', max: 2000 };
  if (path === '/api/osmClip') return { name: 'osm', max: 300 };
  const action = url.searchParams.get('action') || '';
  if (TILE_ACTIONS.has(action)) return { name: 'tile', max: 2000 };
  const n = Number(process.env.QH_GET_LIMIT);
  const max = Number.isFinite(n) && n > 0 ? n : 600;
  return { name: 'read', max };
}

function enhanceRes(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    const body = JSON.stringify(obj == null ? null : obj);
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(body));
    res.end(body);
    return res;
  };
  res.send = (body) => {
    if (body == null) {
      res.end();
      return res;
    }
    if (typeof body === 'object' && !Buffer.isBuffer(body)) return res.json(body);
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', Buffer.isBuffer(body) ? 'application/octet-stream' : 'text/plain; charset=utf-8');
    }
    res.end(body);
    return res;
  };
  return res;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Thân yêu cầu quá lớn'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseBody(buf, contentType) {
  if (!buf || !buf.length) return {};
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('application/json') || ct.includes('+json') || ct.includes('text/plain')) {
    try { return JSON.parse(buf.toString('utf8')); } catch (e) { return {}; }
  }
  return buf;
}

function matchHandler(pathname, handlers) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return handlers[path] || null;
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || 'unknown').split(',')[0].trim() || 'unknown';
}

async function handle(req, res, handlers) {
  enhanceRes(res);
  try {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    // *.run.app giữ /healthz ở frontend của Google và trả 404 trước khi tới container.
    // /api/health trả trước bộ đếm để lần kiểm tra không ăn trần đọc.
    if (req.method === 'GET' && (url.pathname === '/api/health' || url.pathname === '/healthz' || url.pathname === '/')) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, service: 'qh-hue-api' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/api/')) {
      const cap = limitFor(url);
      if (!allow(bucket(cap.name), clientIp(req), Date.now(), cap.max, GET_WINDOW_MS)) {
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Retry-After', '60');
        return res.status(429).json({ error: true, message: 'Quá nhiều yêu cầu, vui lòng chậm lại' });
      }
    }
    const handler = matchHandler(url.pathname, handlers);
    if (!handler) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).json({ error: true, message: 'Không có đường dẫn này' });
    }
    req.query = Object.fromEntries(url.searchParams);
    const buf = await readBody(req);
    req.body = parseBody(buf, req.headers['content-type']);
    return await handler(req, res);
  } catch (err) {
    if (res.headersSent || res.writableEnded) return;
    const status = err.status || 500;
    res.status(status).json({ error: true, message: err.message || 'Lỗi máy chủ' });
  }
}

function createServer(handlers) {
  return http.createServer((req, res) => { handle(req, res, handlers); });
}

function listen() {
  const gee = require('../api/gee');
  const osm = require('../api/osmClip');
  const pm = require('../api/pmtilesRange');
  const handlers = {
    '/api/gee': gee,
    '/api/osmClip': osm,
    '/api/pmtilesRange': pm
  };
  const port = Number(process.env.PORT) || 8080;
  const server = createServer(handlers);
  server.listen(port, '0.0.0.0', () => {
    console.log(`qh-hue-api nghe cổng ${port}`);
  });
  return server;
}

module.exports = { enhanceRes, readBody, parseBody, matchHandler, handle, createServer, limitFor, MAX_BODY, buckets };

if (require.main === module) listen();
