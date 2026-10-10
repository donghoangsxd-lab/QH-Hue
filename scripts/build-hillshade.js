// Đổ bóng địa hình (hillshade) toàn thành phố, tính một lần từ FABDEM rồi ghi lên bucket → terrain/hillshade/
// (<z>_<x>_<y>.png + index.json ghi sau cùng). terrainLayer.js chỉ tải ô và nhân với màu cao độ, không tính lại.
//   node scripts/build-hillshade.js [--exag 2] [--min-zoom 8] [--boundary ranh.geojson]
//     --dry                    chỉ ghi ô ra .cache/hillshade/, không đẩy lên bucket
//     --debug-png toan-tp.png  ghi ảnh màu cao độ + đổ bóng mức 10 toàn thành phố để soát nhanh
// 1. Lưới FABDEM mức 12 (~36 m/pixel, sát độ phân giải 30 m) phủ ranh 40 phường xã + lề MARGIN_DEG; tính trên cả lưới
//    ghép nên không có vết nối giữa các ô. Mức 8–11: gộp trung bình khối 2^(12−z) pixel rồi tính lại, phóng đại cao độ
//    tăng dần (EXAG_STEP mỗi mức) vì lưới thô làm sườn dốc thoải đi.
// 2. Độ dốc, hướng dốc theo Horn (1981) cửa sổ 3×3; chiếu sáng 4 hướng 225°/270°/315°/360° có trọng số, góc cao 45°;
//    chia cho độ sáng mặt phẳng → hệ số f (mặt bằng = 1, sườn khuất < 1, sườn đón sáng > 1).
// 3. Ô PNG xám 256×256, giá trị = round(f × SCALE). Ô toàn mặt bằng / không dữ liệu không ghi (trình duyệt coi f = 1).
// Gửi qua Apps Script (action saveHillshade): cần GAS_BASE_URL và GAS_SECRET (xem scripts/gasClient.js).
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const turf = require('@turf/turf');
const { loadBoundary } = require('./wardBoundary');
const { ROOT, D2R, lng2tx, lat2ty, demSource, loadDem, cellSizeM } = require('./hydroCommon');
const { loadEnv, postToAppsScript } = require('./gasClient');

const DEM_Z = 12;
const MARGIN_DEG = 0.03;
const SCALE = 180;              // f tối đa 1/cos(45°) ≈ 1,414 → 255
const EXAG_STEP = 1.35;
const LIGHTS = [[315, 0.4], [270, 0.2], [360, 0.2], [225, 0.2]];
const ALT = 45;
const FLAT_TOL = 2;             // ô mọi pixel lệch mặt bằng ≤ 2 đơn vị thì bỏ
const BUCKET_DIR = 'terrain/hillshade/';
const BATCH_TILES = 40;
const BATCH_BYTES = 3000000;
const OUT_DIR = path.join(ROOT, '.cache', 'hillshade');

const opt = (args, k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

/** Lưới cao độ mức z gióng theo ô z: gộp trung bình các pixel mức 12 hợp lệ; không có pixel nào → NaN */
function gridAtZoom(dem, z) {
  const f = 2 ** (DEM_Z - z);
  const tx1 = dem.tx0 + dem.W / 256 - 1, ty1 = dem.ty0 + dem.H / 256 - 1;
  const X0 = Math.floor(dem.tx0 / f), Y0 = Math.floor(dem.ty0 / f);
  const nx = Math.floor(tx1 / f) - X0 + 1, ny = Math.floor(ty1 / f) - Y0 + 1;
  const W = nx * 256, H = ny * 256;
  if (f === 1) return { elev: dem.elev, W, H, X0, Y0 };
  const elev = new Float32Array(W * H).fill(NaN);
  const ox = X0 * 256 * f - dem.tx0 * 256, oy = Y0 * 256 * f - dem.ty0 * 256;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, cnt = 0;
      for (let dy = 0; dy < f; dy++) {
        const sy = oy + y * f + dy;
        if (sy < 0 || sy >= dem.H) continue;
        for (let dx = 0; dx < f; dx++) {
          const sx = ox + x * f + dx;
          if (sx < 0 || sx >= dem.W) continue;
          const v = dem.elev[sy * dem.W + sx];
          if (!Number.isNaN(v)) { sum += v; cnt++; }
        }
      }
      if (cnt) elev[y * W + x] = sum / cnt;
    }
  }
  return { elev, W, H, X0, Y0 };
}

/** Hệ số đổ bóng f mỗi pixel (NaN nơi không có cao độ); láng giềng thiếu dữ liệu lấy bằng pixel giữa để mép lưới không thành vách */
function hillshade({ elev, W, H }, cell, exag) {
  const out = new Float32Array(W * H).fill(NaN);
  const zen = (90 - ALT) * D2R;
  const flat = Math.cos(zen);
  const lights = LIGHTS.map(([az, w]) => [(360 - az + 90) * D2R, w]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = elev[y * W + x];
      if (Number.isNaN(c)) continue;
      const at = (dx, dy) => {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) return c;
        const v = elev[yy * W + xx];
        return Number.isNaN(v) ? c : v;
      };
      const a = at(-1, -1), b = at(0, -1), cc = at(1, -1), d = at(-1, 0), f = at(1, 0);
      const g = at(-1, 1), h = at(0, 1), i = at(1, 1);
      const dzdx = ((cc + 2 * f + i) - (a + 2 * d + g)) / (8 * cell) * exag;
      const dzdy = ((g + 2 * h + i) - (a + 2 * b + cc)) / (8 * cell) * exag;
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const cz = Math.cos(zen) * Math.cos(slope), sz = Math.sin(zen) * Math.sin(slope);
      let s = 0;
      for (const [azr, w] of lights) s += w * Math.max(0, cz + sz * Math.cos(azr - aspect));
      out[y * W + x] = s / flat;
    }
  }
  return out;
}

/** Cắt lưới hệ số thành ô PNG xám; trả về { key: Buffer } chỉ gồm ô có địa hình */
function cutTiles(shade, grid, z) {
  const tiles = {};
  const nx = grid.W / 256, ny = grid.H / 256;
  const gray = Buffer.alloc(256 * 256);
  for (let ty = 0; ty < ny; ty++) {
    for (let tx = 0; tx < nx; tx++) {
      let relief = false;
      for (let py = 0; py < 256; py++) {
        for (let px = 0; px < 256; px++) {
          const f = shade[(ty * 256 + py) * grid.W + tx * 256 + px];
          const v = Number.isNaN(f) ? SCALE : Math.min(255, Math.max(0, Math.round(f * SCALE)));
          if (Math.abs(v - SCALE) > FLAT_TOL) relief = true;
          gray[py * 256 + px] = v;
        }
      }
      if (!relief) continue;
      const png = PNG.sync.write({ width: 256, height: 256, data: gray }, {
        colorType: 0, inputColorType: 0, inputHasAlpha: false, deflateLevel: 9
      });
      tiles[`${z}_${grid.X0 + tx}_${grid.Y0 + ty}`] = png;
    }
  }
  return tiles;
}

const STOPS = [
  [0, '#08306b'], [2, '#08519c'], [4, '#2171b5'], [7, '#4292c6'], [10, '#4fb3d9'],
  [15, '#3cb8a0'], [25, '#7ccf6a'], [50, '#c7e35a'], [100, '#ffe14d'], [200, '#fdb240'],
  [400, '#f7772f'], [700, '#e0402a'], [1100, '#b3151b'], [1700, '#67000d']
];
const STOP_RGB = STOPS.map(([, c]) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)));
function tint(e) {
  if (!(e > 0)) return STOP_RGB[0];
  let s = 0;
  while (s < STOPS.length - 2 && e > STOPS[s + 1][0]) s++;
  const t = Math.min(1, Math.max(0, (e - STOPS[s][0]) / (STOPS[s + 1][0] - STOPS[s][0])));
  return STOP_RGB[s].map((v, k) => v + (STOP_RGB[s + 1][k] - v) * t);
}

function writeDebugPng(file, grid, shade) {
  const png = new PNG({ width: grid.W, height: grid.H });
  for (let i = 0; i < grid.W * grid.H; i++) {
    const e = grid.elev[i];
    const f = Number.isNaN(shade[i]) ? 1 : Math.min(1.3, Math.max(0.3, shade[i]));
    const rgb = Number.isNaN(e) ? [30, 30, 30] : tint(e).map(v => Math.min(255, v * f));
    png.data[i * 4] = rgb[0]; png.data[i * 4 + 1] = rgb[1]; png.data[i * 4 + 2] = rgb[2]; png.data[i * 4 + 3] = 255;
  }
  fs.writeFileSync(file, PNG.sync.write(png));
}

/** Gửi Apps Script theo lô (giới hạn thời gian chạy 6 phút / lần); index.json đi cùng lô cuối */
async function pushTiles(tiles, index) {
  const keys = Object.keys(tiles);
  const batches = [];
  let cur = {}, size = 0;
  keys.forEach(k => {
    const b64 = tiles[k].toString('base64');
    if (Object.keys(cur).length >= BATCH_TILES || size + b64.length > BATCH_BYTES) {
      batches.push(cur);
      cur = {}; size = 0;
    }
    cur[k] = b64;
    size += b64.length;
  });
  batches.push(cur);
  let done = 0;
  for (let i = 0; i < batches.length; i++) {
    const last = i === batches.length - 1;
    const content = JSON.stringify(last ? { tiles: batches[i], index } : { tiles: batches[i] });
    for (let attempt = 0; ; attempt++) {
      try {
        await postToAppsScript('saveHillshade', content);
        break;
      } catch (e) {
        if (attempt === 2 || /Action không hợp lệ|Sai khóa/.test(e.message)) throw e;
        console.warn(`  Lô ${i + 1} lỗi (${e.message}), thử lại…`);
      }
    }
    done += Object.keys(batches[i]).length;
    console.log(`… lô ${i + 1}/${batches.length}: đã ghi ${done}/${keys.length} ô`);
  }
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const exag = Number(opt(args, '--exag') ?? 2);
  const minZoom = Number(opt(args, '--min-zoom') ?? 8);
  const debugPng = opt(args, '--debug-png');
  const dry = args.includes('--dry');
  if (!(exag > 0)) throw new Error('--exag phải > 0');
  if (!Number.isInteger(minZoom) || minZoom < 6 || minZoom > DEM_Z) throw new Error(`--min-zoom từ 6 đến ${DEM_Z}`);

  const wards = await loadBoundary(opt(args, '--boundary'));
  const wb = turf.bbox(wards);
  console.log(`✓ Ranh: ${wards.features.length} phường xã`);
  let src = await demSource();
  // SRTM là cao độ bề mặt (còn mái nhà, tán cây); GEE lỗi thì dùng ô FABDEM đã lưu
  if (src.key !== 'fabdem') {
    if (!fs.existsSync(path.join(ROOT, '.cache', 'dem', 'fabdem', String(DEM_Z)))) {
      throw new Error('Không lấy được FABDEM qua GEE và chưa có bản lưu .cache/dem/fabdem — chạy lại sau');
    }
    src = { url: '', name: 'FABDEM (bản lưu .cache/dem, GEE không phản hồi)', key: 'fabdem' };
  }
  const dem = await loadDem([wb[0] - MARGIN_DEG, wb[1] - MARGIN_DEG, wb[2] + MARGIN_DEG, wb[3] + MARGIN_DEG], DEM_Z, src);
  console.log(`✓ Cao độ: ${src.name}, ${dem.tiles} ô mức ${DEM_Z} (${dem.empty} ô trống)`);

  const lat = (wb[1] + wb[3]) / 2;
  const tiles = {};
  const perZoom = {};
  for (let z = DEM_Z; z >= minZoom; z--) {
    const grid = gridAtZoom(dem, z);
    const ex = exag * EXAG_STEP ** (DEM_Z - z);
    const shade = hillshade(grid, cellSizeM(lat, z), ex);
    const t = cutTiles(shade, grid, z);
    Object.assign(tiles, t);
    perZoom[z] = Object.keys(t).length;
    console.log(`✓ Mức ${z}: ${perZoom[z]} ô, phóng đại cao độ ×${ex.toFixed(2)}`);
    if (debugPng && z === 10) {
      writeDebugPng(debugPng, grid, shade);
      console.log(`  Ảnh soát: ${debugPng}`);
    }
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let bytes = 0;
  Object.entries(tiles).forEach(([k, buf]) => { fs.writeFileSync(path.join(OUT_DIR, `${k}.png`), buf); bytes += buf.length; });
  const index = {
    at: new Date().toISOString(),
    src: 'fabdem',
    scale: SCALE,
    minZoom,
    maxZoom: DEM_Z,
    exag,
    tiles: Object.fromEntries(Object.keys(tiles).sort().map(k => [k, 1]))
  };
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index));
  console.log(`✓ ${Object.keys(tiles).length} ô, ${(bytes / 1048576).toFixed(1)} MB → ${path.relative(ROOT, OUT_DIR)}`);

  if (dry) return;
  await pushTiles(tiles, index);
  console.log(`✓ Đã ghi gs://hue-infra-data-us/${BUCKET_DIR} (${Object.keys(tiles).length} ô + index.json)`);
}

main().catch(err => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
