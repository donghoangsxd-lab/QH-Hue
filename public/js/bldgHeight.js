// Chiều cao mét của dấu chân công trình, tệp public/data/gba/bldg-hf.bin (GBH2).
// Cùng chỉ mục với bản 3D: ô z16, mét = h2 / 2, khớp điểm gần nhất trong khoảng ~23 m.
// PMTiles đã công bố chỉ có nhóm tương đối. Một số nhà cao lấy từ bảng bldg-overrides.geojson.

const HEIGHT_LIM = 160;

let ready = null;
let index = null;

function tileParts(lng, lat) {
  const n = 65536;
  const xf = ((lng + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const yf = (1 - Math.log((1 + s) / (1 - s)) / (2 * Math.PI)) * n / 2;
  const x = Math.floor(xf);
  const y = Math.floor(yf);
  return { x, y, cx: Math.floor((xf - x) * 4096), cy: Math.floor((yf - y) * 4096) };
}

export function parseHeightIndex(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'GBH2') throw new Error('tệp chiều cao không đúng');
  const tiles = dv.getUint32(4, true);
  const rec0 = 12 + tiles * 12;
  const table = new Map();
  let p = 12;
  for (let i = 0; i < tiles; i++) {
    const key = dv.getUint32(p, true);
    const start = dv.getUint32(p + 4, true);
    const count = dv.getUint32(p + 8, true);
    table.set(key, { start, count });
    p += 12;
  }
  function scan(tx, ty, gx, gy, best) {
    const ent = table.get(tx * 65536 + ty);
    if (!ent) return best;
    const base = rec0 + ent.start * 8;
    for (let i = 0; i < ent.count; i++) {
      const o = base + i * 8;
      const dx = tx * 4096 + dv.getUint16(o, true) - gx;
      const dy = ty * 4096 + dv.getUint16(o + 2, true) - gy;
      const d = dx * dx + dy * dy;
      if (d < best.d) best = { d, h: dv.getUint16(o + 4, true) / 2 };
    }
    return best;
  }
  return {
    lookup(lng, lat) {
      const part = tileParts(lng, lat);
      const gx = part.x * 4096 + part.cx;
      const gy = part.y * 4096 + part.cy;
      let best = scan(part.x, part.y, gx, gy, { d: HEIGHT_LIM * HEIGHT_LIM, h: null });
      if (best.d > 70 * 70) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (!dx && !dy) continue;
            best = scan(part.x + dx, part.y + dy, gx, gy, best);
          }
        }
      }
      return best.h;
    }
  };
}

export function loadBuildingHeights() {
  if (index) return Promise.resolve(index);
  if (!ready) {
    const url = new URL('data/gba/bldg-hf.bin', document.baseURI).href;
    ready = fetch(url).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    }).then((buf) => {
      index = parseHeightIndex(buf);
      return index;
    }).catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

/** Mét, hoặc null nếu không có điểm chiều cao đủ gần. */
export function heightAt(lng, lat, idx) {
  if (!idx || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return idx.lookup(lng, lat);
}
