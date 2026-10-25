// Hộp tiêu đề không đè cột nút, nút Giới thiệu hay panel trục; rộng vừa chữ, không kéo tới cột nút.
// Không còn nút «>>» góc trên trái. Mỏ bảng tổng hợp cùng bề rộng và cùng mép phải cột nút.
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
    const line = document.querySelector('.map-intro-line');
    const actions = document.querySelector('.map-title-actions');
    const box = el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const hit = (a, b) => a.width > 0 && b.width > 0 && a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
    return states.map(([name, cls]) => {
      document.body.className = cls;
      const t = box(title);
      const text = box(h1);
      const contentRight = Math.max(text.right, box(line).right, box(actions).right);
      const tools = [...document.querySelectorAll('.map-toolbar .ui-btn-format, #btnOverview')]
        .filter(el => hit(t, box(el)) || hit(text, box(el)))
        .map(el => el.id || el.getAttribute('aria-label'));
      const panel = document.querySelector('.right-panel');
      const panelOpen = !document.body.classList.contains('right-collapsed');
      const summaryOn = document.body.classList.contains('bottom-collapsed');
      const summary = document.getElementById('btnExpandBottomPanel');
      const tool = document.querySelector('.map-toolbar .ui-btn-format:not(#btnExpandBottomPanel)');
      const s = summary ? box(summary) : null;
      const tb = tool ? box(tool) : null;
      const expand = document.getElementById('btnExpandRightPanel');
      return {
        name,
        left: t.left,
        right: t.right,
        top: t.top,
        width: t.width,
        text: text.width,
        slack: t.right - contentRight,
        full: h1.textContent.trim(),
        clipped: h1.scrollWidth > h1.clientWidth + 1,
        tools,
        panel: panelOpen && (hit(t, box(panel)) || hit(text, box(panel))),
        expand: !!expand,
        summaryOn,
        summaryWidth: s ? s.width : 0,
        toolWidth: tb ? tb.width : 0,
        summaryRight: s ? s.right : 0,
        toolRight: tb ? tb.right : 0
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
      const slotLeft = 12 + 340 + 16;
      const slotRight = w - (12 + 34 + 16);
      assert.equal(row.full, 'BẢN ĐỒ QUY HOẠCH THÀNH PHỐ HUẾ', `${w} ${row.name}`);
      assert.equal(row.clipped, false, `${w} ${row.name} cụt chữ`);
      assert.ok(row.text >= 240, `${w} ${row.name} tiêu đề rộng ${row.text}`);
      assert.ok(Math.abs(row.left - slotLeft) < 1.5, `${w} ${row.name} mép trái ${row.left}`);
      assert.ok(row.right < slotRight - 8, `${w} ${row.name} mép phải ${row.right} kéo tới ${slotRight}`);
      assert.ok(row.slack < 20, `${w} ${row.name} khoảng trống phải ${row.slack}`);
      assert.ok(row.width > row.text, `${w} ${row.name} hộp ${row.width} hẹp hơn chữ ${row.text}`);
      assert.deepEqual(row.tools, [], `${w} ${row.name} đè nút ${row.tools}`);
      assert.equal(row.panel, false, `${w} ${row.name} đè panel trục`);
      assert.equal(row.expand, false, `${w} ${row.name} còn nút mở góc trái`);
      if (row.summaryOn) {
        assert.ok(Math.abs(row.summaryWidth - row.toolWidth) < 0.6, `${w} ${row.name} mỏ ${row.summaryWidth} ≠ nút ${row.toolWidth}`);
        assert.ok(Math.abs(row.summaryRight - row.toolRight) < 0.6, `${w} ${row.name} mép phải mỏ ${row.summaryRight} ≠ nút ${row.toolRight}`);
      }
    });
    const spread = (key) => Math.max(...rows.map(r => r[key])) - Math.min(...rows.map(r => r[key]));
    assert.ok(spread('left') < 1, `${w} mép trái nhảy ${spread('left')}`);
    assert.ok(spread('right') < 1, `${w} mép phải nhảy ${spread('right')}`);
    assert.ok(spread('width') < 1, `${w} bề rộng nhảy ${spread('width')}`);
    assert.ok(spread('top') < 1, `${w} mép trên nhảy ${spread('top')}`);
    console.log(JSON.stringify({ w, states: rows.map(r => ({ name: r.name, left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), text: Math.round(r.text) })) }));
    await page.close();
  }

  const phone = await browser.newContext({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2
  });
  const phonePage = await phone.newPage();
  await phonePage.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  const coarse = await phonePage.evaluate(() => window.matchMedia('(pointer: coarse) and (max-height: 560px)').matches);
  assert.equal(coarse, true, 'khung điện thoại ngang không vào media pointer coarse');
  for (const withClass of [false, true]) {
    const boxes = await phonePage.evaluate((useClass) => {
      document.documentElement.classList.toggle('is-phone', useClass);
      document.documentElement.classList.toggle('is-landscape', useClass);
      document.body.className = 'right-collapsed bottom-collapsed';
      const host = document.getElementById('mapArea');
      const made = ['cad-card', 'leaflet-popup dock-card', 'project-brief'].map(cls => {
        const el = document.createElement('div');
        el.className = cls;
        el.textContent = 'Thửa 160 · Tờ 14';
        host.appendChild(el);
        return el;
      });
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width };
      };
      const tool = document.querySelector('.map-toolbar');
      const out = { tool: box(tool), panels: made.map(el => ({ cls: el.className, ...box(el) })) };
      made.forEach(el => el.remove());
      return out;
    }, withClass);
    boxes.panels.forEach(panel => {
      assert.ok(panel.width > 80, `${withClass} ${panel.cls} rộng ${panel.width}`);
      assert.ok(panel.left >= boxes.tool.right + 6, `${withClass} ${panel.cls} left ${panel.left} đè cột nút ${boxes.tool.right}`);
    });
    console.log(JSON.stringify({ phone: withClass ? 'class' : 'media', toolRight: Math.round(boxes.tool.right), panels: boxes.panels.map(p => ({ cls: p.cls, left: Math.round(p.left) })) }));
  }
  await phonePage.close();
  await phone.close();
} finally {
  await browser.close();
  server.close();
}
console.log('test-title-layout ok');
