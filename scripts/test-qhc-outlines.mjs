// Đếm ranh đã vẽ sau khi đổi cấp: QHC 1/10.000, QHPK, QHCT.
// Chạy: node scripts/test-qhc-outlines.mjs
// Cần Chrome (CHROME_PATH hoặc /usr/bin/google-chrome-stable) và playwright-core.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const shotDir = process.env.QHC_SHOT_DIR || '/opt/cursor/artifacts';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.geojson': 'application/geo+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2'
};

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  // Cổng nằm trong STATIC_DEV_PORTS (api.js) để trang gọi API production, không phải /api/gee của máy tĩnh.
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(8791, '127.0.0.1', () => resolve(server));
  });
}

async function loadPlaywright() {
  try {
    return (await import('playwright-core')).default;
  } catch {
    return (await import('/tmp/node_modules/playwright-core/index.js')).default;
  }
}

function chromePath() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  return ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p)) || null;
}

async function waitCatalog(page) {
  for (let i = 0; i < 50; i++) {
    const n = await page.evaluate(async () => {
      try { return (await import('./js/state.js')).state.projectCatalog?.length || 0; } catch { return 0; }
    });
    if (n > 20) return;
    await page.waitForTimeout(400);
  }
  throw new Error('Danh mục đồ án không tải');
}

async function rendered(page, levelKey) {
  return page.evaluate(async (levelKey) => {
    const { visibleOutlineNames } = await import('./js/projectLayer.js');
    const { planMap, getViewMode } = await import('./js/planMap.js');
    const { map } = await import('./js/mapEngine.js');
    const m = getViewMode() === 'QH' && planMap ? planMap : map;
    const expected = visibleOutlineNames(levelKey);
    const found = new Set();
    const decode = (html) => String(html || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ').trim();
    const walk = (layer) => {
      const tip = layer.getTooltip?.();
      const text = tip ? decode(tip.getContent()) : '';
      if (text) {
        const hit = expected.find(p => p.full === text || p.name === text);
        if (hit) found.add(hit.name);
      }
      layer.eachLayer?.(ch => walk(ch));
    };
    m.eachLayer(walk);
    const missing = expected.filter(p => !found.has(p.name)).map(p => p.name);
    return {
      zoom: m.getZoom(),
      expected: expected.length,
      rendered: found.size,
      missing,
      names: expected.map(p => p.name)
    };
  }, levelKey);
}

function assertCount(label, info) {
  if (!info.expected) throw new Error(`${label}: không có đồ án có ranh`);
  if (info.missing.length) {
    throw new Error(`${label}: vẽ ${info.rendered}/${info.expected}, thiếu ${info.missing.slice(0, 8).join(' | ')}`);
  }
  console.log(`${label}: ${info.rendered} ranh`);
}

async function openLevel(page, id) {
  const current = await page.getAttribute('#btnMapLevel', 'data-level');
  if (current === id) return;
  await page.click('#btnMapLevel');
  await page.locator(`#mapLevelMenu [data-level="${id}"]`).click();
  await page.waitForFunction((want) => document.getElementById('btnMapLevel')?.dataset.level === want, id);
}

async function scene(page, name) {
  await page.goto(page.url().split('#')[0].replace(/\?.*$/, '/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await waitCatalog(page);
  await page.evaluate(async () => {
    const { map } = await import('./js/mapEngine.js');
    const { planMap } = await import('./js/planMap.js');
    const c = [16.4637, 107.5905];
    map.setView(c, 13, { animate: false });
    if (planMap) planMap.setView(c, 13, { animate: false });
  });
  await openLevel(page, 'qhc10');
  let last = null;
  for (let i = 0; i < 24; i++) {
    last = await page.evaluate(async () => {
      const { planMap, getViewMode } = await import('./js/planMap.js');
      const { map } = await import('./js/mapEngine.js');
      const { state } = await import('./js/state.js');
      const m = getViewMode() === 'QH' && planMap ? planMap : map;
      const entry = (state.projectCatalog || []).find(p => /Chân Mây/.test(String(p.tenQH || '')));
      const spans = [...m.getContainer().querySelectorAll('.project-label span')].map(el => el.innerText.replace(/\s+/g, ' ').trim());
      let hit = false;
      if (entry?.boundary && window.L) {
        try { hit = m.getBounds().intersects(L.geoJSON(entry.boundary).getBounds()); } catch { hit = false; }
      }
      return { hit, spans, zoom: m.getZoom(), core: spans.some(t => /TT Huế 2045/.test(t)), chan: spans.some(t => /Chân Mây/.test(t)) };
    });
    if (last.hit && last.core && last.chan) break;
    await page.waitForTimeout(400);
  }
  if (!last?.hit || !last.chan || !last.core) {
    throw new Error(`${name}: Chân Mây hoặc vùng trung tâm không vào khung ${JSON.stringify(last)}`);
  }
  for (const level of ['qhc10', 'qhpk', 'qhc10', 'qhct', 'qhc10']) {
    await openLevel(page, level);
    const key = level === 'qhc10' ? 'QHC' : level === 'qhpk' ? 'QHPK' : 'QHCT';
    let info = null;
    for (let i = 0; i < 16; i++) {
      info = await rendered(page, key);
      if (!info.missing.length && info.expected > 0) break;
      await page.waitForTimeout(400);
    }
    assertCount(`${name} ${level}`, info);
  }
  await page.evaluate(() => document.body.classList.add('right-collapsed'));
  await page.waitForTimeout(200);
  fs.mkdirSync(shotDir, { recursive: true });
  const file = path.join(shotDir, name);
  await page.screenshot({ path: file });
  console.log('shot', file);
  const hidden = await page.evaluate(async () => {
    const row = [...document.querySelectorAll('#projectList .project-row')].find(el => /Chân Mây/.test(el.textContent || ''));
    const box = row?.querySelector('input[data-project]');
    if (!box) return { ok: false, reason: 'không thấy ô Chân Mây' };
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    const { state } = await import('./js/state.js');
    const { lotShown } = await import('./js/projectFiles.js');
    const { visibleOutlineNames } = await import('./js/projectLayer.js');
    const name = [...state.hiddenProjects].find(n => /Chân Mây/.test(n));
    const still = visibleOutlineNames('QHC').some(p => /Chân Mây/.test(p.name));
    return { ok: !!name && !still && lotShown(name) === false, name, still, lots: name ? lotShown(name) : null };
  });
  if (!hidden.ok) throw new Error(`${name}: bỏ chọn không ẩn ranh/lô ${JSON.stringify(hidden)}`);
  const after = await rendered(page, 'QHC');
  assertCount(`${name} sau bỏ chọn`, after);
  if (after.names.some(n => /Chân Mây/.test(n))) throw new Error(`${name}: Chân Mây vẫn trong danh sách ranh`);
}

async function main() {
  const chrome = chromePath();
  if (!chrome) throw new Error('Không thấy Chrome. Đặt CHROME_PATH.');
  const pw = await loadPlaywright();
  const server = await startServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/`;
  const browser = await pw.chromium.launch({
    executablePath: chrome,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const deskPage = await desk.newPage();
    deskPage.on('pageerror', (e) => console.log('ERR', e.message));
    await deskPage.addInitScript(() => {
      localStorage.setItem('qhhue_intro_off', '1');
      sessionStorage.setItem('qh_mobile_fs_dismiss', '1');
    });
    await deskPage.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await scene(deskPage, 'qhc-desktop.png');
    await desk.close();

    const phone = await browser.newContext({
      viewport: { width: 915, height: 412 },
      isMobile: true,
      hasTouch: true
    });
    const phonePage = await phone.newPage();
    phonePage.on('pageerror', (e) => console.log('ERR', e.message));
    await phonePage.addInitScript(() => {
      localStorage.setItem('qhhue_intro_off', '1');
      sessionStorage.setItem('qh_mobile_fs_dismiss', '1');
    });
    await phonePage.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await scene(phonePage, 'qhc-phone-land.png');
    await phone.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('qhc outlines: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
