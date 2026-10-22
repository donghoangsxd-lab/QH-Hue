import assert from 'node:assert/strict';
import fs from 'node:fs';
import { progressColor, combinedProgress } from '../public/js/loadProgress.js';

const steps = [
  [0, '#dc2626'],
  [19, '#dc2626'],
  [20, '#ea580c'],
  [39, '#ea580c'],
  [40, '#f59e0b'],
  [59, '#f59e0b'],
  [60, '#eab308'],
  [79, '#eab308'],
  [80, '#84cc16'],
  [99, '#84cc16'],
  [100, '#16a34a']
];

for (const [pct, color] of steps) {
  assert.equal(progressColor(pct), color, String(pct));
}
assert.equal(progressColor(-4), '#dc2626');
assert.equal(progressColor(140), '#16a34a');
assert.equal(progressColor('80'), '#84cc16');

assert.equal(combinedProgress(10, []), 10);
assert.equal(combinedProgress(40, [{ pending: 20, done: 10, failed: 0 }]), 42);
assert.equal(combinedProgress(null, [{ pending: 4, done: 1, failed: 1 }]), 25);
assert.equal(combinedProgress(100, []), null);
assert.equal(combinedProgress(null, []), null);
assert.equal(combinedProgress(30, [{ pending: 5, done: 2, failed: 3 }]), 30);
assert.equal(combinedProgress(null, [{ pending: 10, done: 8, dropped: 2 }]), null);
assert.equal(combinedProgress(null, [{ pending: 10, done: 9, dropped: 0 }]), 90);
assert.equal(combinedProgress(null, [{ pending: 5, done: 2, failed: 3 }]), 40);
assert.notEqual(combinedProgress(null, [{ pending: 10, done: 9, failed: 1 }]), 100);
assert.equal(combinedProgress(null, [{ pending: 10, done: 9, failed: 1 }]), 90);

const root = new URL('..', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, root), 'utf8');
const html = read('public/index.html');
const css = read('public/css/style.css');
const sw = read('public/sw.js');
const vercel = read('vercel.json');
const version = read('public/js/gbaVersion.js');
const shell = /export const SHELL_V = '([^']+)'/.exec(version)[1];
const gba = /export const GBA_V = '([^']+)'/.exec(version)[1];
assert.equal(html.includes('Bản đồ tải lần đầu mất 30–60 giây. Vui lòng chờ!'), true);
assert.match(html, new RegExp(`css/style.css\\?v=${shell}`));
assert.match(html, new RegExp(`js/app.js\\?v=${shell}`));
assert.match(html, /show-boot-notice/);
assert.match(css, /\.map-title-notice[\s\S]*color:\s*var\(--accent-yellow\)/);
assert.match(css, /\.map-title-progress > i \{[\s\S]*background:\s*var\(--accent-yellow\)/);
assert.doesNotMatch(css, /\.map-title-progress > i \{[^}]*var\(--tone\)/);
assert.match(css, /html\.show-boot-notice \{ --title-h:/);
assert.match(sw, new RegExp(`qh-hue-${gba}`));
assert.match(sw, /skipWaiting/);
assert.match(sw, /function shell/);
assert.match(vercel, /"source": "\/js\/\(\.\*\)"[\s\S]*?"value": "no-store"/);
assert.match(vercel, /"source": "\/css\/\(\.\*\)"[\s\S]*?"value": "no-store"/);
assert.match(read('public/js/qhc2045Layer.js'), /withAssetVersion\(QHC2045\.urls\[kind\]\)/);
assert.match(read('public/js/gbaLayer.js'), /withAssetVersion\('data\/gba\/bldg-overrides\.geojson'\)/);
assert.match(read('public/js/app.js'), /setBootProgress\(pct\)/);
assert.match(read('public/js/app.js'), /setBootProgress\(100\)/);
const progress = read('public/js/loadProgress.js');
assert.match(progress, /tileabort/);
assert.match(progress, /NOTICE_MAX_MS = 90000/);
assert.match(progress, /TILE_STUCK_MS = 20000/);
assert.match(progress, /dropped/);
assert.match(progress, /export function startTaskProgress/);
assert.doesNotMatch(read('public/js/utils.js'), /task-progress-stack/);
assert.doesNotMatch(css, /task-progress-stack/);
assert.match(read('public/js/mapEngine.js'), /geeTileLayer\(url, geeTileOpts/);
assert.match(read('public/js/geeTiles.js'), /fully masked/);
assert.doesNotMatch(read('public/js/mapEngine.js'), /Đã tải bản đồ độ phủ/);
console.log('test-load-progress ok');
