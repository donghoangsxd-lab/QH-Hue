// Hộp tiêu đề không đè cột nút, nút Giới thiệu hay panel trục; bề rộng đủ cả câu tiêu đề.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const html = fs.readFileSync(new URL('public/index.html', root), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  const file = new URL(url.pathname.replace(/^\//, ''), new URL('public/', root));
  const pub = new URL('public/', root);
  if (!file.pathname.startsWith(pub.pathname)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end(); return; }
    const type = file.pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(buf);
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

async function loadChromium() {
  try {
    const mod = await import('playwright-core');
    return mod.chromium || mod.default.chromium;
  } catch { /* cài khi CI chưa có playwright-core */ }
  try {
    const mod = await import('/tmp/node_modules/playwright-core/index.js');
    return mod.default.chromium;
  } catch { /* cài vào /tmp */ }
  const { spawnSync } = await import('node:child_process');
  const inst = spawnSync('npm', ['install', '--prefix', '/tmp', 'playwright-core@1.49.1', '--no-save', '--silent'], { stdio: 'inherit' });
  if (inst.status) throw new Error('không cài được playwright-core');
  const mod = await import('/tmp/node_modules/playwright-core/index.js');
  return mod.default.chromium;
}
const chromium = await loadChromium();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-gpu']
});

const STATES = [
  ['axis-open', ''],
  ['axis-closed', 'right-collapsed'],
  ['summary-open', ''],
  ['summary-closed', 'bottom-collapsed'],
  ['both-open', ''],
  ['both-closed', 'right-collapsed bottom-collapsed']
];

async function measure(page) {
  return page.evaluate(states => {
    const title = document.getElementById('mapTitle');
    const h1 = document.getElementById('mapTitleText');
    const box = el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const hit = (a, b) => a.width > 0 && b.width > 0 && a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
    return states.map(([name, cls]) => {
      document.body.className = cls;
      const t = box(title);
      const text = box(h1);
      const tools = [...document.querySelectorAll('.map-toolbar .ui-btn-format, #btnOverview')]
        .filter(el => hit(t, box(el)) || hit(text, box(el)))
        .map(el => el.id || el.getAttribute('aria-label'));
      const panel = document.querySelector('.right-panel');
      const panelOpen = !document.body.classList.contains('right-collapsed');
      return {
        name,
        width: t.width,
        text: text.width,
        full: h1.textContent.trim(),
        clipped: h1.scrollWidth > h1.clientWidth + 1,
        tools,
        panel: panelOpen && (hit(t, box(panel)) || hit(text, box(panel)))
      };
    });
  }, STATES);
}

try {
  for (const [w, h] of [[1280, 800], [960, 700]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    const rows = await measure(page);
    rows.forEach(row => {
      assert.equal(row.full, 'BẢN ĐỒ QUY HOẠCH THÀNH PHỐ HUẾ', `${w} ${row.name}`);
      assert.equal(row.clipped, false, `${w} ${row.name} cụt chữ`);
      assert.ok(row.text >= 240, `${w} ${row.name} tiêu đề rộng ${row.text}`);
      assert.deepEqual(row.tools, [], `${w} ${row.name} đè nút ${row.tools}`);
      assert.equal(row.panel, false, `${w} ${row.name} đè panel trục`);
    });
    console.log(JSON.stringify({ w, states: rows.map(r => ({ name: r.name, width: Math.round(r.width), text: Math.round(r.text) })) }));
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log('test-title-layout ok');
