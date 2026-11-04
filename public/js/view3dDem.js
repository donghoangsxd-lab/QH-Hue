// Lấy cao độ nền Terrarium (cùng họ FABDEM/SRTM lớp môi trường) cho khung 3D.
// Lưới thưa: đủ thấy địa hình đặt khối, không đốt GPU.

const AWS_URL = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';
const DEM_Z = 13;
export const DEM_N = 17;

function tileUrl(z, x, y) {
  return AWS_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

function loadElevTile(z, x, y) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) { reject(new Error('canvas')); return; }
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, 256, 256).data;
      const elev = new Float32Array(256 * 256);
      for (let i = 0, q = 0; q < px.length; i++, q += 4) {
        elev[i] = px[q + 3] < 128 ? NaN : Math.round((px[q] * 256 + px[q + 1] + px[q + 2] / 256 - 32768) * 10) / 10;
      }
      resolve(elev);
    };
    img.onerror = () => reject(new Error('dem tile'));
    img.src = tileUrl(z, x, y);
  });
}

function lngLatToTile(lng, lat, z) {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (1 - Math.log((1 + s) / (1 - s)) / (2 * Math.PI)) * n / 2;
  return { x, y, tx: Math.floor(x), ty: Math.floor(y) };
}

function elevAtLngLat(tiles, lng, lat, z) {
  const { x, y, tx, ty } = lngLatToTile(lng, lat, z);
  const elev = tiles.get(`${tx}/${ty}`);
  if (!elev) return NaN;
  const fx = (x - tx) * 256;
  const fy = (y - ty) * 256;
  const ix = Math.min(255, Math.max(0, Math.floor(fx)));
  const iy = Math.min(255, Math.max(0, Math.floor(fy)));
  return elev[iy * 256 + ix];
}

/** Lưới n×n mét địa phương: elev tương đối (trừ min), quads XYZ cho PolygonLayer. */
export async function sampleDemGrid(place, origin, n = DEM_N) {
  const r = place.r;
  const dlat = (r * 1.05) / origin.mLat;
  const dlng = (r * 1.05) / origin.mLng;
  const corners = [
    [place.lng - dlng, place.lat - dlat],
    [place.lng + dlng, place.lat - dlat],
    [place.lng - dlng, place.lat + dlat],
    [place.lng + dlng, place.lat + dlat]
  ];
  const keys = new Set();
  corners.forEach(([lng, lat]) => {
    const t = lngLatToTile(lng, lat, DEM_Z);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) keys.add(`${t.tx + dx}/${t.ty + dy}`);
    }
  });
  const tiles = new Map();
  await Promise.all([...keys].map(async (key) => {
    const [tx, ty] = key.split('/').map(Number);
    try {
      tiles.set(key, await loadElevTile(DEM_Z, tx, ty));
    } catch (e) { /* bỏ ô */ }
  }));
  if (!tiles.size) return null;

  const cell = (r * 2) / (n - 1);
  const elev = new Float32Array(n * n);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -r + i * cell;
      const y = -r + j * cell;
      const lng = origin.lng + x / origin.mLng;
      const lat = origin.lat + y / origin.mLat;
      let e = elevAtLngLat(tiles, lng, lat, DEM_Z);
      if (!Number.isFinite(e)) e = 0;
      elev[j * n + i] = e;
      if (e < min) min = e;
      if (e > max) max = e;
    }
  }
  if (!Number.isFinite(min)) return null;
  const centerElev = elev[Math.floor(n / 2) * n + Math.floor(n / 2)];
  const rel = new Float32Array(n * n);
  for (let i = 0; i < elev.length; i++) rel[i] = elev[i] - min;

  const quads = [];
  const span = Math.max(1, max - min);
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const x0 = -r + i * cell;
      const x1 = -r + (i + 1) * cell;
      const y0 = -r + j * cell;
      const y1 = -r + (j + 1) * cell;
      // Z tương đối tâm ô (cùng offsetAt) để khối nhà đặt khớp mặt đất.
      const z00 = elev[j * n + i] - centerElev;
      const z10 = elev[j * n + i + 1] - centerElev;
      const z01 = elev[(j + 1) * n + i] - centerElev;
      const z11 = elev[(j + 1) * n + i + 1] - centerElev;
      const t = ((rel[j * n + i] + rel[j * n + i + 1] + rel[(j + 1) * n + i] + rel[(j + 1) * n + i + 1]) / 4) / span;
      const g = Math.round(70 + t * 90);
      const b = Math.round(55 + (1 - t) * 40);
      quads.push({
        rings: [[[x0, y0, z00], [x1, y0, z10], [x1, y1, z11], [x0, y1, z01]]],
        fill: [g, Math.round(90 + t * 50), b, 120]
      });
    }
  }

  function atLocal(x, y) {
    const u = (x + r) / cell;
    const v = (y + r) / cell;
    const i0 = Math.min(n - 2, Math.max(0, Math.floor(u)));
    const j0 = Math.min(n - 2, Math.max(0, Math.floor(v)));
    const fu = u - i0;
    const fv = v - j0;
    const e00 = elev[j0 * n + i0];
    const e10 = elev[j0 * n + i0 + 1];
    const e01 = elev[(j0 + 1) * n + i0];
    const e11 = elev[(j0 + 1) * n + i0 + 1];
    return e00 * (1 - fu) * (1 - fv) + e10 * fu * (1 - fv) + e01 * (1 - fu) * fv + e11 * fu * fv;
  }

  return {
    n,
    cell,
    min,
    max,
    centerElev,
    quads,
    /** Mét tuyệt đối tại tọa độ địa phương; trừ centerElev để dựng khối quanh z=0. */
    offsetAt(x, y) {
      return atLocal(x, y) - centerElev;
    },
    relAt(x, y) {
      return atLocal(x, y) - min;
    }
  };
}
