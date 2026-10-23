// Đếm ranh đã vẽ sau khi đổi cấp: QHC 1/10.000, QHPK, QHCT.
// Chạy: node scripts/test-qhc-outlines.mjs
// Cần Chrome (CHROME_PATH hoặc /usr/bin/google-chrome-stable) và playwright-core.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const shotDir = process.env.QHC_SHOT_DIR || '/opt/cursor/artifacts';
const LIVE_ORIGIN = 'https://qh-hue.donghoangsxd.workers.dev';
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

function proxyLive(req, res, url) {
  const target = new URL(url.pathname + url.search, LIVE_ORIGIN);
  fetch(target, { method: req.method, headers: { accept: req.headers.accept || '*/*' } }).then(async (up) => {
    const headers = { 'content-type': up.headers.get('content-type') || 'application/octet-stream' };
    const cc = up.headers.get('cache-control');
    if (cc) headers['cache-control'] = cc;
    res.writeHead(up.status, headers);
    res.end(Buffer.from(await up.arrayBuffer()));
  }).catch((err) => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(err && err.message || err));
  });
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      proxyLive(req, res, url);
      return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  // 8792 ngoài STATIC_DEV_PORTS (api.js): trang gọi /api/gee cùng nguồn, máy tĩnh chuyển sang Worker.
  // Vercel legacy trả 402 nên không dùng làm danh mục.
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(8792, '127.0.0.1', () => resolve(server));
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

async function liveQhcNames() {
  const res = await fetch(`${LIVE_ORIGIN}/api/gee?action=getProjectIndex`);
  if (!res.ok) throw new Error(`getProjectIndex HTTP ${res.status}`);
  const data = await res.json();
  const names = (data.projects || [])
    .map(p => p && p.tenQH)
    .filter(n => typeof n === 'string' && /^\s*QHC(?![A-Z])/i.test(n));
  if (!names.some(n => /Chân Mây/.test(n))) throw new Error('Danh mục không có QHC Chân Mây');
  return names;
}

function seedScript(payload) {
  const qhpk = 'QHPK Thanh Toàn';
  const names = [...payload.qhc, qhpk];
  const layers = [
    ...payload.qhc.map(n => `${n}|ranh-gioi`),
    `${qhpk}|ranh-gioi`
  ];
  localStorage.setItem('qhhue_intro_off', '1');
  sessionStorage.setItem('qh_mobile_fs_dismiss', '1');
  if (sessionStorage.getItem('qh_seed_done') === '1') return;
  sessionStorage.setItem('qh_seed_done', '1');
  if (payload.invalid) {
    localStorage.setItem('qh_hidden_projects', '{"not":"array"}');
    localStorage.setItem('qh_hidden_layers', '[');
  } else {
    localStorage.setItem('qh_hidden_projects', JSON.stringify(names));
    localStorage.setItem('qh_hidden_layers', JSON.stringify(layers));
  }
  localStorage.removeItem('qh_storage_version');
  if (payload.kindFix) localStorage.setItem('qh_hidden_kind_fix', '1');
  else localStorage.removeItem('qh_hidden_kind_fix');
}

async function labelsOnScreen(page) {
  return page.evaluate(() => {
    const host = document.querySelector('#mapPlan')?.offsetParent
      ? document.querySelector('#mapPlan')
      : document.querySelector('#map');
    const box = host.getBoundingClientRect();
    const hits = [...host.querySelectorAll('.project-label span')].map(el => {
      const r = el.getBoundingClientRect();
      const text = el.innerText.replace(/\s+/g, ' ').trim();
      const on = r.width > 0 && r.height > 0
        && r.left < box.right - 2 && r.right > box.left + 2
        && r.top < box.bottom - 2 && r.bottom > box.top + 2;
      return { text, on };
    });
    return {
      chan: hits.some(h => /Chân Mây/.test(h.text) && h.on),
      core: hits.some(h => /TT Huế 2045/.test(h.text) && h.on),
      on: hits.filter(h => h.on).map(h => h.text)
    };
  });
}

async function staleDesktop(page, base, { qhc, panel, shot, keepQhpk }) {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await waitCatalog(page);
  if (panel) {
    await page.click('#btnExpandRightPanel');
    await page.waitForFunction(() => !document.body.classList.contains('right-collapsed'));
    await page.waitForTimeout(400);
  }
  await openLevel(page, 'qhc10');
  let seen = null;
  for (let i = 0; i < 30; i++) {
    seen = await labelsOnScreen(page);
    if (seen.chan && seen.core) break;
    await page.waitForTimeout(400);
  }
  if (!seen?.chan || !seen?.core) {
    throw new Error(`${shot}: nhãn không nằm trong khung ${JSON.stringify(seen)}`);
  }
  const stored = await page.evaluate((qhc) => ({
    version: localStorage.getItem('qh_storage_version'),
    kind: localStorage.getItem('qh_hidden_kind_fix'),
    hidden: JSON.parse(localStorage.getItem('qh_hidden_projects') || '[]'),
    layers: JSON.parse(localStorage.getItem('qh_hidden_layers') || '[]'),
    qhc
  }), qhc);
  if (stored.version !== '2') throw new Error(`${shot}: phiên lưu trữ ${stored.version}`);
  if (stored.kind) throw new Error(`${shot}: còn cờ qh_hidden_kind_fix`);
  const still = stored.hidden.filter(n => qhc.includes(n));
  if (still.length) throw new Error(`${shot}: còn ẩn QHC ${still.join(' | ')}`);
  if (stored.layers.some(k => qhc.some(n => k === `${n}|ranh-gioi`))) {
    throw new Error(`${shot}: còn khóa ranh-gioi của QHC`);
  }
  if (keepQhpk) {
    if (!stored.hidden.includes('QHPK Thanh Toàn')) throw new Error(`${shot}: mất ẩn QHPK đã lưu`);
    if (!stored.layers.includes('QHPK Thanh Toàn|ranh-gioi')) throw new Error(`${shot}: mất ranh-gioi QHPK`);
  }
  fs.mkdirSync(shotDir, { recursive: true });
  const file = path.join(shotDir, shot);
  await page.screenshot({ path: file });
  console.log('shot', file, seen.on.join(' | '));
  const chan = qhc.find(n => /Chân Mây/.test(n));
  await page.evaluate((name) => {
    const cur = JSON.parse(localStorage.getItem('qh_hidden_projects') || '[]');
    if (!cur.includes(name)) cur.push(name);
    localStorage.setItem('qh_hidden_projects', JSON.stringify(cur));
  }, chan);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
  await waitCatalog(page);
  const kept = await page.evaluate((name) => {
    const hidden = JSON.parse(localStorage.getItem('qh_hidden_projects') || '[]');
    return { version: localStorage.getItem('qh_storage_version'), hidden: hidden.includes(name) };
  }, chan);
  if (kept.version !== '2' || !kept.hidden) {
    throw new Error(`${shot}: phiên 2 không giữ bỏ chọn ${JSON.stringify(kept)}`);
  }
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
  const qhc = await liveQhcNames();
  console.log('QHC trong danh mục:', qhc.join(' | '));
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

    const seeds = [
      { width: 1920, height: 1080, kindFix: true, invalid: false, panel: true, shot: 'qhc-desk-1920-stuck.png', keepQhpk: true },
      { width: 1536, height: 864, kindFix: false, invalid: false, panel: false, shot: 'qhc-desk-1536-legacy.png', keepQhpk: true },
      { width: 1366, height: 768, kindFix: true, invalid: true, panel: false, shot: 'qhc-desk-1366-invalid.png', keepQhpk: false }
    ];
    for (const seed of seeds) {
      const ctx = await browser.newContext({ viewport: { width: seed.width, height: seed.height } });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.log('ERR', seed.shot, e.message));
      await page.addInitScript(seedScript, { qhc, kindFix: seed.kindFix, invalid: seed.invalid });
      await staleDesktop(page, base, { qhc, panel: seed.panel, shot: seed.shot, keepQhpk: seed.keepQhpk });
      await ctx.close();
    }

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
