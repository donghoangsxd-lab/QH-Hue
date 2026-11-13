// Kiểm tra detectWhiteMarginBox (cắt lề trắng) — không cần DOM Leaflet.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../public/js/scanGeoref.js', import.meta.url), 'utf8');
assert.match(src, /export async function prepareSchemeScan/);
assert.match(src, /export const SDD_SCAN_MAX_BYTES = 5 \* 1024 \* 1024/);
assert.match(src, /tightFit/);
assert.match(src, /detectWhiteMarginBox/);

// Chạy hàm thuần bằng vm không được vì ES module; nhúng bản tối giản cùng ngưỡng.
function isNearWhite(r, g, b, a) {
  if (a < 12) return true;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max >= 245 && (max - min) <= 20;
}

function detectWhiteMarginBox(data, w, h) {
  const rowWhite = (y) => {
    let n = 0;
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      const i = row + x * 4;
      if (isNearWhite(data[i], data[i + 1], data[i + 2], data[i + 3])) n++;
    }
    return n / w >= 0.96;
  };
  const colWhite = (x) => {
    let n = 0;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      if (isNearWhite(data[i], data[i + 1], data[i + 2], data[i + 3])) n++;
    }
    return n / h >= 0.96;
  };
  let top = 0, bottom = h - 1, left = 0, right = w - 1;
  while (top < bottom && rowWhite(top)) top++;
  while (bottom > top && rowWhite(bottom)) bottom--;
  while (left < right && colWhite(left)) left++;
  while (right > left && colWhite(right)) right--;
  const pad = Math.max(2, Math.round(Math.min(w, h) * 0.01));
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(w - 1, right + pad);
  bottom = Math.min(h - 1, bottom + pad);
  const cw = right - left + 1, ch = bottom - top + 1;
  if (cw < 32 || ch < 32) return null;
  if (cw * ch > w * h * 0.97) return null;
  if (cw * ch < w * h * 0.08) return null;
  return { left, top, width: cw, height: ch };
}

const W = 200, H = 160;
const data = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < data.length; i += 4) {
  data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
}
for (let y = 30; y < 130; y++) {
  for (let x = 40; x < 160; x++) {
    const i = (y * W + x) * 4;
    data[i] = 40; data[i + 1] = 120; data[i + 2] = 200; data[i + 3] = 255;
  }
}
const box = detectWhiteMarginBox(data, W, H);
assert.ok(box, 'phải cắt được lề trắng');
assert.ok(box.left <= 40 && box.top <= 30);
assert.ok(box.width < W && box.height < H);

const solid = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < solid.length; i += 4) {
  solid[i] = 10; solid[i + 1] = 20; solid[i + 2] = 30; solid[i + 3] = 255;
}
assert.equal(detectWhiteMarginBox(solid, W, H), null, 'ảnh không lề → không crop');

const store = readFileSync(new URL('../services/projectStore.js', import.meta.url), 'utf8');
assert.match(store, /putSchemeSddScan/);
assert.match(store, /SDD_SCAN_MAX_BYTES = 5 \* 1024 \* 1024/);
assert.match(store, /sdd-scans\.json/);

const api = readFileSync(new URL('../api/gee.js', import.meta.url), 'utf8');
assert.match(api, /putSchemeSddScan/);
assert.match(api, /getSchemeSddScans/);
assert.match(api, /deleteSchemeSddScan/);

console.log('test-sdd-scan-crop: ok');
