const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { handle, parseBody } = require('../cloudrun/server');
const { allow } = require('../services/rateWindow');

assert.deepEqual(parseBody(Buffer.from(''), 'application/json'), {});
assert.deepEqual(parseBody(Buffer.from('{"a":1}'), 'application/json'), { a: 1 });
assert.ok(Buffer.isBuffer(parseBody(Buffer.from('abc'), 'application/octet-stream')));
const bucket = new Map();
assert.equal(allow(bucket, 'ip', 0, 1, 1000), true);
assert.equal(allow(bucket, 'ip', 1, 1, 1000), false);

function once(handlers, opts) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => { handle(req, res, handlers); });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: opts.path,
        method: opts.method || 'GET',
        headers: opts.headers || {}
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (opts.body) req.write(opts.body);
      req.end();
    });
  });
}

(async () => {
  const health = await once({}, { path: '/api/health' });
  assert.equal(health.status, 200);
  assert.equal(health.body, '{"ok":true,"service":"qh-hue-api"}');
  assert.match(health.headers['cache-control'], /no-store/);
  const legacy = await once({}, { path: '/healthz' });
  assert.equal(legacy.status, 200);

  const gee = await once({
    '/api/gee': (req, res) => res.status(200).json({ action: req.query.action, n: req.body.n })
  }, {
    path: '/api/gee?action=getCadastreInfo',
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify({ n: 2 })
  });
  assert.equal(gee.status, 200);
  assert.deepEqual(JSON.parse(gee.body), { action: 'getCadastreInfo', n: 2 });

  process.env.QH_GET_LIMIT = '1';
  const first = await once({
    '/api/gee': (req, res) => res.status(200).json({ ok: true })
  }, { path: '/api/gee?action=getSatMeta', headers: { 'x-forwarded-for': '203.0.113.10' } });
  const second = await once({
    '/api/gee': (req, res) => res.status(200).json({ ok: true })
  }, { path: '/api/gee?action=getSatMeta', headers: { 'x-forwarded-for': '203.0.113.10' } });
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.match(second.headers['cache-control'], /no-store/);
  assert.equal(second.headers['retry-after'], '60');
  const healthAfter = await once({}, { path: '/api/health', headers: { 'x-forwarded-for': '203.0.113.10' } });
  assert.equal(healthAfter.status, 200);
  const tile = await once({
    '/api/gee': (req, res) => res.status(200).json({ ok: true })
  }, { path: '/api/gee?action=getSatTile', headers: { 'x-forwarded-for': '203.0.113.10' } });
  assert.equal(tile.status, 200);
  delete process.env.QH_GET_LIMIT;

  const missing = await once({}, { path: '/api/khac' });
  assert.equal(missing.status, 404);

  const docker = fs.readFileSync(path.join(__dirname, '../cloudrun/Dockerfile'), 'utf8');
  ['public/js/projectNames.js', 'public/js/bldgAdditions.js', 'public/js/bldgParts.js', 'public/js/bldgFloorEdits.js'].forEach((rel) => {
    assert.match(docker, new RegExp(rel.replace(/[.]/g, '\\.')));
  });
  const { splitProjectName } = await import('../public/js/projectNames.js');
  const named = splitProjectName('QHPK khu trung tâm');
  assert.equal(typeof named.tenDayDu, 'string');
  assert.ok(named.tenRutGon);
  console.log('test-cloudrun ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
