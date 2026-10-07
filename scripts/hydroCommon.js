// Phần dùng chung của các script dựng lớp thủy văn tĩnh (build-otieunuoc.js, build-luuvuc.js):
// lưới cao độ ghép từ ô Terrarium, sông kênh OpenStreetMap, đổi mặt nạ lưới thành đa giác.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const turf = require('@turf/turf');
const { GEE_API_URL } = require('./wardBoundary');

const ROOT = path.join(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.cache');
const AWS_TERRARIUM = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';
const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const D2R = Math.PI / 180;

const lng2tx = (lng, z) => (lng + 180) / 360 * 2 ** z;
const lat2ty = (lat, z) => {
  const s = Math.sin(lat * D2R);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
};
const tx2lng = (t, z) => t / 2 ** z * 360 - 180;
const ty2lat = (t, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * t / 2 ** z))) / D2R;

/** Nguồn ô cao độ: FABDEM qua getDemTile (cùng lớp địa hình), lỗi thì SRTM AWS. key dùng làm thư mục cache ô */
async function demSource() {
  try {
    const r = await fetch(`${GEE_API_URL}?action=getDemTile&dem=fabdem`, { signal: AbortSignal.timeout(90000) });
    const d = await r.json();
    if (d && d.urlFormat) return { url: d.urlFormat, name: 'FABDEM (cao độ nền)', key: 'fabdem' };
  } catch (e) { /* GEE lỗi → SRTM */ }
  return { url: AWS_TERRARIUM, name: 'SRTM qua AWS (cao độ bề mặt, còn mái nhà và tán cây)', key: 'srtm' };
}

async function fetchTile(url, cacheFile) {
  if (cacheFile && fs.existsSync(cacheFile)) return PNG.sync.read(fs.readFileSync(cacheFile));
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (r.status === 404 || r.status === 400) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const png = PNG.sync.read(buf);
      if (cacheFile) {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, buf);
      }
      return png;
    } catch (e) {
      if (k === 2) throw new Error(`Không tải được ô cao độ ${url}: ${e.message}`);
    }
  }
  return null;
}

/**
 * Ghép ô Terrarium phủ bbox → { elev: Float32Array (NaN = ô trống / không dữ liệu), W, H, tx0, ty0, tiles, empty }.
 * Ô đã tải lưu ở .cache/dem/<nguồn>/<z>/ để chạy lại không phải tải.
 */
async function loadDem(bbox, z, src) {
  const tx0 = Math.floor(lng2tx(bbox[0], z)), tx1 = Math.floor(lng2tx(bbox[2], z));
  const ty0 = Math.floor(lat2ty(bbox[3], z)), ty1 = Math.floor(lat2ty(bbox[1], z));
  const nx = tx1 - tx0 + 1, ny = ty1 - ty0 + 1, W = nx * 256, H = ny * 256;
  const elev = new Float32Array(W * H).fill(NaN);
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
  let done = 0, empty = 0;
  const worker = async () => {
    while (jobs.length) {
      const [tx, ty] = jobs.pop();
      const url = src.url.replace('{z}', z).replace('{x}', tx).replace('{y}', ty);
      const png = await fetchTile(url, path.join(CACHE_DIR, 'dem', src.key || 'dem', String(z), `${tx}_${ty}.png`));
      if (!png) { empty++; } else {
        const ox = (tx - tx0) * 256, oy = (ty - ty0) * 256;
        for (let py = 0; py < 256; py++) {
          for (let px = 0; px < 256; px++) {
            const o = (py * 256 + px) * 4;
            if (png.data[o + 3] === 0) continue;
            elev[(oy + py) * W + ox + px] = png.data[o] * 256 + png.data[o + 1] + png.data[o + 2] / 256 - 32768;
          }
        }
      }
      if (++done % 20 === 0) process.stdout.write(`\r… ô cao độ ${done}/${nx * ny}`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  process.stdout.write('\r');
  return { elev, W, H, tx0, ty0, tiles: nx * ny, empty };
}

/** Kích thước pixel (m) của lưới mức z tại vĩ độ lat */
const cellSizeM = (lat, z) => 40075016 * Math.cos(lat * D2R) / (256 * 2 ** z);

/** Sông, kênh, mặt nước OSM trong bbox (Overpass), lưu .cache/osm-nuoc.json; refresh = tải lại */
async function loadOsm(bbox, refresh) {
  const cacheFile = path.join(CACHE_DIR, 'osm-nuoc.json');
  if (!refresh && fs.existsSync(cacheFile)) {
    console.log(`… Dùng sông, kênh OSM đã lưu: ${path.relative(ROOT, cacheFile)} (--refresh-osm để tải lại)`);
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  }
  const [w, s, e, n] = bbox;
  const b = `${s},${w},${n},${e}`;
  const q = `[out:json][timeout:300];(
    way["natural"="water"](${b});relation["natural"="water"](${b});
    way["waterway"="riverbank"](${b});relation["waterway"="riverbank"](${b});
    way["landuse"="reservoir"](${b});
    way["waterway"~"^(river|canal|stream|drain|ditch)$"](${b});
  );(._;>;);out body qt;`;
  console.log('… Tải sông, kênh, mặt nước từ OpenStreetMap (Overpass, có thể mất vài phút)');
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'qh-hue/hydro-scripts' },
    body: `data=${encodeURIComponent(q)}`,
    signal: AbortSignal.timeout(400000)
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status} — thử lại sau hoặc đặt OVERPASS_URL sang máy chủ khác`);
  const osm = await res.json();
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(osm));
  return osm;
}

const ringAreaPx = (r) => {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(s / 2);
};

/** Bỏ đỉnh thẳng hàng tuyệt đối (đường viền ô lưới có nhiều đoạn ngang / dọc liên tiếp) — không làm hỏng hình học */
function dropCollinear(ring) {
  const out = [];
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n];
    if ((b[0] - a[0]) * (c[1] - b[1]) !== (b[1] - a[1]) * (c[0] - b[0])) out.push(b);
  }
  out.push(out[0]);
  return out;
}

/**
 * Mặt nạ 0/1 (W × H, góc trên trái ở pixel ox, oy của lưới gốc tx0, ty0) → MultiPolygon kinh / vĩ,
 * bỏ mảnh và lỗ nhỏ hơn minPx pixel. Hai mặt nạ kề nhau cho cùng tọa độ cạnh chung (điểm giữa hai tâm pixel).
 */
async function maskToPolygon({ mask, W, H, ox = 0, oy = 0, tx0, ty0 }, z, minPx) {
  const { contours } = await import('d3-contour');
  const mp = contours().size([W, H]).smooth(false).thresholds([0.5])(mask)[0];
  const toLL = ([x, y]) => [tx2lng(tx0 + (x + ox) / 256, z), ty2lat(ty0 + (y + oy) / 256, z)];
  const polys = [];
  mp.coordinates.forEach(poly => {
    if (ringAreaPx(poly[0]) < minPx) return;
    const rings = [poly[0], ...poly.slice(1).filter(r => ringAreaPx(r) >= minPx)]
      .map(dropCollinear).filter(r => r.length >= 4).map(r => r.map(toLL));
    if (rings.length && rings[0].length >= 4) polys.push(rings);
  });
  return turf.multiPolygon(polys);
}

module.exports = {
  ROOT, D2R, lng2tx, lat2ty, tx2lng, ty2lat, demSource, loadDem, cellSizeM, loadOsm, maskToPolygon
};
