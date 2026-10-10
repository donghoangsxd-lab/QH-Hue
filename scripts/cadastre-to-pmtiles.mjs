// Gom thửa đất từng xã (đầu ra của cadastre-to-shp.js) thành một file PMTiles + chỉ mục tra tờ/thửa:
//   node --max-old-space-size=5120 scripts/cadastre-to-pmtiles.mjs --in "<Desktop>\ThuaDat-2016" --out "<Desktop>\ThuaDat-2016\_web"
// Đầu ra: thuadat-2016.pmtiles (lớp "thuadat", zoom 15–16, tile MVT nén gzip),
//         index/xa.json (danh mục xã) và index/<maxa>.json (rows: [tờ, thửa, lon, lat, diện tích, loại đất]).
// Thuộc tính trong tile đặt tên ngắn cho nhẹ: m mã xã, t số tờ, s số thửa, a diện tích, l loại đất, d địa chỉ.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { createRequire } from 'module';
import GeoJSONVT from 'geojson-vt';
import { zxyToTileId, PMTiles } from 'pmtiles';
import { pointOnFeature } from '@turf/turf';

const require = createRequire(import.meta.url);
const vtpbf = require('vt-pbf');
const { VectorTile } = require('@mapbox/vector-tile');
const Pbf = require('pbf');

const LAYER = 'thuadat';
const MIN_Z = 15;
const MAX_Z = 16;
const EXTENT = 4096;
const LEAF_SIZE = 4096;
const ROOT_MAX = 16384 - 127;
// Nới khung xã khi xét tile còn chờ: lớn hơn vùng đệm 64/4096 của tile z15 (~19 m)
const BBOX_PAD = 0.001;

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[argv[i].slice(2)] = true;
    else { out[argv[i].slice(2)] = next; i++; }
  }
  return out;
}

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
const x2lon = (x, z) => (x / 2 ** z) * 360 - 180;
const y2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
};

function tileBox(z, x, y) {
  return { minx: x2lon(x, z), maxx: x2lon(x + 1, z), miny: y2lat(y + 1, z), maxy: y2lat(y, z) };
}

const touches = (a, b) => a.minx <= b.maxx + BBOX_PAD && a.maxx >= b.minx - BBOX_PAD
  && a.miny <= b.maxy + BBOX_PAD && a.maxy >= b.miny - BBOX_PAD;

const num = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const round6 = (v) => Math.round(v * 1e6) / 1e6;

function varint(out, n) {
  while (n >= 128) {
    out.push((n % 128) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
}

function serializeDir(entries) {
  const b = [];
  varint(b, entries.length);
  let last = 0;
  entries.forEach((e) => { varint(b, e.tileId - last); last = e.tileId; });
  entries.forEach((e) => varint(b, e.runLength));
  entries.forEach((e) => varint(b, e.length));
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    if (i > 0 && e.offset === prev.offset + prev.length) varint(b, 0);
    else varint(b, e.offset + 1);
  });
  return zlib.gzipSync(Buffer.from(b));
}

function buildDirs(entries) {
  const root = serializeDir(entries);
  if (root.length <= ROOT_MAX) return { root, leaves: Buffer.alloc(0) };
  const leafBufs = [];
  const rootEntries = [];
  let offset = 0;
  for (let i = 0; i < entries.length; i += LEAF_SIZE) {
    const chunk = entries.slice(i, i + LEAF_SIZE);
    const buf = serializeDir(chunk);
    rootEntries.push({ tileId: chunk[0].tileId, offset, length: buf.length, runLength: 0 });
    leafBufs.push(buf);
    offset += buf.length;
  }
  return { root: serializeDir(rootEntries), leaves: Buffer.concat(leafBufs) };
}

function writeU64(buf, v, off) {
  buf.writeBigUInt64LE(BigInt(v), off);
}

function header(h) {
  const b = Buffer.alloc(127);
  b.write('PMTiles', 0, 'ascii');
  b[7] = 3;
  writeU64(b, h.rootOffset, 8);
  writeU64(b, h.rootLength, 16);
  writeU64(b, h.metaOffset, 24);
  writeU64(b, h.metaLength, 32);
  writeU64(b, h.leafOffset, 40);
  writeU64(b, h.leafLength, 48);
  writeU64(b, h.dataOffset, 56);
  writeU64(b, h.dataLength, 64);
  writeU64(b, h.tiles, 72);
  writeU64(b, h.tiles, 80);
  writeU64(b, h.tiles, 88);
  b[96] = 1;
  b[97] = 2;
  b[98] = 2;
  b[99] = 1;
  b[100] = MIN_Z;
  b[101] = MAX_Z;
  b.writeInt32LE(Math.round(h.bbox.minx * 1e7), 102);
  b.writeInt32LE(Math.round(h.bbox.miny * 1e7), 106);
  b.writeInt32LE(Math.round(h.bbox.maxx * 1e7), 110);
  b.writeInt32LE(Math.round(h.bbox.maxy * 1e7), 114);
  b[118] = MIN_Z;
  b.writeInt32LE(Math.round(((h.bbox.minx + h.bbox.maxx) / 2) * 1e7), 119);
  b.writeInt32LE(Math.round(((h.bbox.miny + h.bbox.maxy) / 2) * 1e7), 123);
  return b;
}

function encodeTile(features) {
  return zlib.gzipSync(vtpbf.fromGeojsonVt({ [LAYER]: { features } }, { version: 2, extent: EXTENT }));
}

async function verify(file, sample) {
  const fd = fs.openSync(file, 'r');
  const source = {
    getKey: () => file,
    getBytes: async (offset, length) => {
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, offset);
      return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + length) };
    }
  };
  const p = new PMTiles(source);
  const h = await p.getHeader();
  const meta = await p.getMetadata();
  const checks = [];
  for (const s of sample) {
    const z = MAX_Z;
    const t = await p.getZxy(z, lon2x(s.lon, z), lat2y(s.lat, z));
    if (!t) { checks.push({ ...s, found: false }); continue; }
    // PMTiles.getZxy đã tự giải nén theo tileCompression trong header
    const vt = new VectorTile(new Pbf(Buffer.from(t.data)));
    const layer = vt.layers[LAYER];
    let hit = false;
    for (let i = 0; layer && i < layer.length; i++) {
      const f = layer.feature(i).properties;
      if (String(f.m) === s.maxa && String(f.t) === s.to && String(f.s) === s.thua) { hit = true; break; }
    }
    checks.push({ ...s, found: hit, features: layer ? layer.length : 0 });
  }
  fs.closeSync(fd);
  return { tiles: h.numTileEntries, minZoom: h.minZoom, maxZoom: h.maxZoom, layer: meta.vector_layers[0].id, checks };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.in || !args.out || args.in === true || args.out === true) {
    console.error('Dùng: node scripts/cadastre-to-pmtiles.mjs --in <thư mục ThuaDat-2016> --out <thư mục đầu ra>');
    process.exit(1);
  }
  const t0 = Date.now();
  const catalog = JSON.parse(fs.readFileSync(path.join(args.in, 'danh-muc-xa.json'), 'utf8'));
  const xas = Object.values(catalog).filter((x) => x.ok && x.n).sort((a, b) => a.bbox.minx - b.bbox.minx);
  fs.mkdirSync(path.join(args.out, 'index'), { recursive: true });

  const done = new Map();
  const pending = new Map();
  const box = { minx: 180, miny: 90, maxx: -180, maxy: -90 };
  const xaList = [];
  const sample = [];
  let features = 0;

  const flush = (remaining) => {
    for (const [id, item] of pending) {
      if (remaining.some((x) => touches(item.box, x.bbox))) continue;
      done.set(id, encodeTile(item.features));
      pending.delete(id);
    }
  };

  xas.forEach((x, xi) => {
    const dir = path.join(args.in, x.dir);
    const file = fs.readdirSync(dir).find((f) => f.endsWith('.geojson'));
    const fc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const rows = [];
    fc.features.forEach((f) => {
      const p = f.properties;
      const a = num(p.dientich);
      f.properties = { m: Number(p.maxa), t: String(p.sohieubando ?? ''), s: String(p.sohieuthua ?? ''), a, l: p.loaidat || '', d: p.diachi || '' };
      let pt;
      try {
        pt = pointOnFeature(f).geometry.coordinates;
      } catch {
        return;
      }
      rows.push([f.properties.t, f.properties.s, round6(pt[0]), round6(pt[1]), a, f.properties.l]);
    });
    features += fc.features.length;
    fs.writeFileSync(path.join(args.out, 'index', `${x.maxa}.json`),
      JSON.stringify({ maxa: x.maxa, tenxa: x.tenxa, tenhuyen: x.tenhuyen, rows }));
    const b = x.bbox;
    xaList.push({ maxa: x.maxa, tenxa: x.tenxa, tenhuyen: x.tenhuyen, n: rows.length, bbox: [b.minx, b.miny, b.maxx, b.maxy].map(round6) });
    box.minx = Math.min(box.minx, b.minx); box.miny = Math.min(box.miny, b.miny);
    box.maxx = Math.max(box.maxx, b.maxx); box.maxy = Math.max(box.maxy, b.maxy);
    if (rows.length) {
      const r = rows[Math.floor(rows.length / 2)];
      sample.push({ maxa: String(x.maxa), tenxa: x.tenxa, to: r[0], thua: r[1], lon: r[2], lat: r[3] });
    }

    const index = new GeoJSONVT(fc, { maxZoom: MAX_Z, indexMaxZoom: 5, tolerance: 3, extent: EXTENT, buffer: 64 });
    for (let z = MIN_Z; z <= MAX_Z; z++) {
      const x0 = lon2x(b.minx, z); const x1 = lon2x(b.maxx, z);
      const y0 = lat2y(b.maxy, z); const y1 = lat2y(b.miny, z);
      for (let tx = x0; tx <= x1; tx++) {
        for (let ty = y0; ty <= y1; ty++) {
          const tile = index.getTile(z, tx, ty);
          if (!tile || !tile.features.length) continue;
          const id = zxyToTileId(z, tx, ty);
          const item = pending.get(id);
          if (item) item.features.push(...tile.features);
          else pending.set(id, { box: tileBox(z, tx, ty), features: tile.features.slice() });
        }
      }
    }
    flush(xas.slice(xi + 1));
    console.log(JSON.stringify({ xa: `${xi + 1}/${xas.length}`, maxa: x.maxa, tenxa: x.tenxa, n: rows.length, pending: pending.size, done: done.size, s: Math.round((Date.now() - t0) / 1000) }));
  });
  flush([]);

  const ids = [...done.keys()].sort((a, b) => a - b);
  const entries = [];
  let offset = 0;
  ids.forEach((id) => {
    const len = done.get(id).length;
    entries.push({ tileId: id, offset, length: len, runLength: 1 });
    offset += len;
  });
  const { root, leaves } = buildDirs(entries);
  const meta = zlib.gzipSync(Buffer.from(JSON.stringify({
    name: 'Thửa đất 2016',
    description: 'Thửa đất địa chính tỉnh Thừa Thiên Huế (gis21.hue.gov.vn, lập năm 2016), không gồm tên chủ sử dụng',
    attribution: 'Sở TN&MT Thừa Thiên Huế (2016)',
    vector_layers: [{
      id: LAYER,
      minzoom: MIN_Z,
      maxzoom: MAX_Z,
      fields: { m: 'Number', t: 'String', s: 'String', a: 'Number', l: 'String', d: 'String' }
    }]
  }), 'utf8'));
  const rootOffset = 127;
  const metaOffset = rootOffset + root.length;
  const leafOffset = metaOffset + meta.length;
  const dataOffset = leafOffset + leaves.length;
  const out = path.join(args.out, 'thuadat-2016.pmtiles');
  const fd = fs.openSync(out, 'w');
  fs.writeSync(fd, header({
    rootOffset, rootLength: root.length, metaOffset, metaLength: meta.length,
    leafOffset, leafLength: leaves.length, dataOffset, dataLength: offset, tiles: ids.length, bbox: box
  }));
  fs.writeSync(fd, root);
  fs.writeSync(fd, meta);
  fs.writeSync(fd, leaves);
  ids.forEach((id) => fs.writeSync(fd, done.get(id)));
  fs.closeSync(fd);
  xaList.sort((a, b) => a.tenhuyen.localeCompare(b.tenhuyen, 'vi') || a.tenxa.localeCompare(b.tenxa, 'vi'));
  fs.writeFileSync(path.join(args.out, 'index', 'xa.json'), JSON.stringify(xaList));

  const check = await verify(out, sample);
  const bad = check.checks.filter((c) => !c.found);
  console.log(JSON.stringify({
    out,
    mb: Math.round((fs.statSync(out).size / 1048576) * 10) / 10,
    xa: xaList.length,
    features,
    tiles: ids.length,
    leaves: leaves.length > 0,
    verify: { tiles: check.tiles, zoom: [check.minZoom, check.maxZoom], layer: check.layer, sample: check.checks.length, notFound: bad },
    s: Math.round((Date.now() - t0) / 1000)
  }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
