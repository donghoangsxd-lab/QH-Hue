// WKT (WGS84) từ dump gServer → GeoJSON + shapefile (.shp .shx .dbf .prj .cpg) trong từng file .zip.
//
//   node scripts/gserver-to-shp.js --listen 8765 --dir <thư mục dump>
//   node scripts/gserver-to-shp.js --listen 8765 --auto --out <thư mục gốc> --count <số đồ án>
//     (--auto ghi shapefile ngay theo tên đề xuất; --count tự tắt sau đủ số dump;
//      máy nhận phục vụ luôn scripts/gserver-page-fetch.js tại /fetch.js)
//   node scripts/gserver-to-shp.js --dump dump.json
//   node scripts/gserver-to-shp.js --dump dump.json --name "QHPK Kinh thành Huế" --out <thư mục>
//   node scripts/gserver-to-shp.js --selftest
//
// --name là tên đồ án (webapp bỏ tiền tố HT-/QH- trên file lớp sử dụng đất).
// Không truyền --name thì chỉ in tên đề xuất, không ghi shapefile.
// Lớp hiện trạng (ht) có thì ghi HT-<tên>.zip; không có thì bỏ qua.

const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');

const ROLES = {
  vung: { shape: 'Polygon', shapeType: 5, file: (name) => `QH-${name}` },
  diem: { shape: 'Point', shapeType: 1, file: (name) => `${name}-diem-chuc-nang` },
  ranh: { shape: 'PolyLine', shapeType: 3, file: (name) => `${name}-ranh-gioi` },
  ht: { shape: 'Polygon', shapeType: 5, file: (name) => `HT-${name}`, optional: true }
};

const PRJ_WGS84 = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function topGroups(s) {
  const groups = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0 && start >= 0) {
        groups.push(s.slice(start + 1, i));
        start = -1;
      }
    }
  }
  return groups;
}

function parseCoords(text) {
  if (!text || !String(text).trim()) return [];
  return String(text).split(',').map((pair) => {
    const bits = pair.trim().split(/\s+/);
    return [Number(bits[0]), Number(bits[1])];
  }).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

function parseWkt(wkt) {
  const raw = String(wkt || '').trim();
  if (!raw) return null;
  const cut = raw.indexOf('(');
  if (cut < 0) return null;
  const type = raw.slice(0, cut).trim().toUpperCase();
  const body = raw.slice(cut);
  if (type === 'POINT') {
    const xy = body.replace(/[()]/g, '').trim().split(/\s+/).map(Number);
    if (!Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) return null;
    return { type, xy };
  }
  if (type === 'LINESTRING') {
    const inner = topGroups(body)[0];
    return { type, parts: [parseCoords(inner)] };
  }
  if (type === 'MULTILINESTRING') {
    const inner = topGroups(body)[0] || '';
    return { type, parts: topGroups(inner).map(parseCoords) };
  }
  if (type === 'POLYGON') {
    const inner = topGroups(body)[0] || '';
    return { type, polygons: [topGroups(inner).map(parseCoords)] };
  }
  if (type === 'MULTIPOLYGON') {
    const inner = topGroups(body)[0] || '';
    const polygons = topGroups(inner).map((g) => topGroups(g).map(parseCoords));
    return { type, polygons };
  }
  return null;
}

function samePt(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

function closeRing(ring) {
  if (!ring.length) return ring;
  if (!samePt(ring[0], ring[ring.length - 1])) ring.push(ring[0].slice());
  return ring;
}

function signedArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return s / 2;
}

function orientRing(ring, ccw) {
  const copy = ring.map((p) => p.slice());
  closeRing(copy);
  if (copy.length < 4) return copy;
  const ccwNow = signedArea(copy) > 0;
  if (ccwNow !== ccw) {
    const open = copy.slice(0, -1).reverse();
    open.push(open[0].slice());
    return open;
  }
  return copy;
}

function meters(a, b) {
  const R = 6378137;
  const x = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180) * (Math.PI / 180) * R;
  const y = (b[1] - a[1]) * (Math.PI / 180) * R;
  return Math.hypot(x, y);
}

function bboxOfPoints(pts, box) {
  for (const p of pts) {
    if (p[0] < box.minx) box.minx = p[0];
    if (p[1] < box.miny) box.miny = p[1];
    if (p[0] > box.maxx) box.maxx = p[0];
    if (p[1] > box.maxy) box.maxy = p[1];
  }
}

function emptyBox() {
  return { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
}

function featureGeom(parsed, shape) {
  if (!parsed) return null;
  if (shape === 'Point') {
    if (parsed.type !== 'POINT') return null;
    return { kind: 'point', xy: parsed.xy };
  }
  if (shape === 'PolyLine') {
    const parts = (parsed.parts || []).filter((p) => p.length >= 2);
    if (!parts.length) return null;
    return { kind: 'line', parts };
  }
  const polygons = [];
  (parsed.polygons || []).forEach((rings) => {
    if (!rings.length) return;
    const outer = rings[0];
    const holes = rings.slice(1);
    if (outer.length < 3) return;
    polygons.push({ outer, holes: holes.filter((h) => h.length >= 3) });
  });
  if (!polygons.length) return null;
  return { kind: 'polygon', polygons };
}

function toGeojsonGeometry(geom) {
  if (geom.kind === 'point') return { type: 'Point', coordinates: geom.xy };
  if (geom.kind === 'line') {
    if (geom.parts.length === 1) return { type: 'LineString', coordinates: geom.parts[0] };
    return { type: 'MultiLineString', coordinates: geom.parts };
  }
  const polys = geom.polygons.map((p) => {
    const rings = [orientRing(p.outer, true)];
    p.holes.forEach((h) => rings.push(orientRing(h, false)));
    return rings;
  });
  if (polys.length === 1) return { type: 'Polygon', coordinates: polys[0] };
  return { type: 'MultiPolygon', coordinates: polys };
}

function shpParts(geom) {
  if (geom.kind === 'line') return geom.parts.map((p) => p.map((c) => c.slice()));
  const parts = [];
  geom.polygons.forEach((p) => {
    parts.push(orientRing(p.outer, false));
    p.holes.forEach((h) => parts.push(orientRing(h, true)));
  });
  return parts;
}

function allocDbfNames(fields) {
  const used = new Set();
  return fields.map((from) => {
    const base = String(from).replace(/[^A-Za-z0-9_]/g, '') || 'f';
    let name = base.slice(0, 10);
    let n = 2;
    while (used.has(name.toLowerCase())) {
      const suf = String(n);
      name = base.slice(0, 10 - suf.length) + suf;
      n++;
    }
    used.add(name.toLowerCase());
    return { from, to: name };
  });
}

function fitUtf8(str, maxBytes) {
  const buf = Buffer.from(String(str ?? ''), 'utf8');
  if (buf.length <= maxBytes) return buf;
  let n = maxBytes;
  while (n > 0 && (buf[n] & 0xc0) === 0x80) n--;
  return buf.subarray(0, n);
}

function buildDbf(rows, propsList, mapping) {
  const widths = mapping.map((m) => {
    let max = 1;
    let cut = 0;
    for (const props of propsList) {
      const raw = props[m.from];
      const text = raw == null ? '' : String(raw);
      const bytes = Buffer.byteLength(text, 'utf8');
      if (bytes > 254) cut++;
      if (bytes > max) max = bytes;
    }
    return { width: Math.min(254, Math.max(1, max)), cut };
  });
  const headerLen = 32 + 32 * mapping.length + 1;
  const recLen = 1 + widths.reduce((s, w) => s + w.width, 0);
  const now = new Date();
  const header = Buffer.alloc(headerLen);
  header[0] = 0x03;
  header[1] = now.getFullYear() - 1900;
  header[2] = now.getMonth() + 1;
  header[3] = now.getDate();
  header.writeUInt32LE(rows, 4);
  header.writeUInt16LE(headerLen, 8);
  header.writeUInt16LE(recLen, 10);
  mapping.forEach((m, i) => {
    const off = 32 + i * 32;
    const name = Buffer.from(m.to, 'ascii');
    name.copy(header, off, 0, Math.min(10, name.length));
    header[off + 11] = 0x43;
    header[off + 16] = widths[i].width;
  });
  header[headerLen - 1] = 0x0d;
  const records = Buffer.alloc(recLen * rows + 1);
  propsList.forEach((props, r) => {
    const rec = records.subarray(r * recLen, (r + 1) * recLen);
    rec[0] = 0x20;
    let cursor = 1;
    mapping.forEach((m, i) => {
      const width = widths[i].width;
      const raw = props[m.from];
      const fitted = fitUtf8(raw == null ? '' : String(raw), width);
      fitted.copy(rec, cursor);
      rec.fill(0x20, cursor + fitted.length, cursor + width);
      cursor += width;
    });
  });
  records[records.length - 1] = 0x1a;
  return { buf: Buffer.concat([header, records]), truncated: widths.reduce((s, w) => s + w.cut, 0) };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  entries.forEach((e) => {
    const name = Buffer.from(e.name, 'utf8');
    const compressed = zlib.deflateRawSync(e.data);
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const chunk = Buffer.concat([local, name, compressed]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    locals.push(chunk);
    offset += chunk.length;
  });
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

function writeShp(shapeType, geoms) {
  const records = [];
  const shx = [];
  let wordCursor = 50;
  const box = emptyBox();
  geoms.forEach((geom, i) => {
    let content;
    if (shapeType === 1) {
      content = Buffer.alloc(20);
      content.writeInt32LE(1, 0);
      content.writeDoubleLE(geom.xy[0], 4);
      content.writeDoubleLE(geom.xy[1], 12);
      bboxOfPoints([geom.xy], box);
    } else {
      const parts = shpParts(geom);
      let numPoints = 0;
      parts.forEach((p) => {
        bboxOfPoints(p, box);
        numPoints += p.length;
      });
      const contentLen = 44 + 4 * parts.length + 16 * numPoints;
      content = Buffer.alloc(contentLen);
      content.writeInt32LE(shapeType, 0);
      const flatBox = emptyBox();
      parts.forEach((p) => bboxOfPoints(p, flatBox));
      content.writeDoubleLE(flatBox.minx, 4);
      content.writeDoubleLE(flatBox.miny, 12);
      content.writeDoubleLE(flatBox.maxx, 20);
      content.writeDoubleLE(flatBox.maxy, 28);
      content.writeInt32LE(parts.length, 36);
      content.writeInt32LE(numPoints, 40);
      let partStart = 0;
      parts.forEach((p, pi) => {
        content.writeInt32LE(partStart, 44 + pi * 4);
        partStart += p.length;
      });
      let ptOff = 44 + 4 * parts.length;
      parts.forEach((p) => {
        p.forEach((xy) => {
          content.writeDoubleLE(xy[0], ptOff);
          content.writeDoubleLE(xy[1], ptOff + 8);
          ptOff += 16;
        });
      });
    }
    const recHead = Buffer.alloc(8);
    recHead.writeInt32BE(i + 1, 0);
    recHead.writeInt32BE(content.length / 2, 4);
    shx.push({ offset: wordCursor, words: content.length / 2 });
    wordCursor += 4 + content.length / 2;
    records.push(recHead, content);
  });
  const fileWords = wordCursor;
  const header = Buffer.alloc(100);
  header.writeInt32BE(9994, 0);
  header.writeInt32BE(fileWords, 24);
  header.writeInt32LE(1000, 28);
  header.writeInt32LE(shapeType, 32);
  const b = Number.isFinite(box.minx) ? box : { minx: 0, miny: 0, maxx: 0, maxy: 0 };
  header.writeDoubleLE(b.minx, 36);
  header.writeDoubleLE(b.miny, 44);
  header.writeDoubleLE(b.maxx, 52);
  header.writeDoubleLE(b.maxy, 60);
  const shp = Buffer.concat([header, ...records]);
  const shxBody = Buffer.alloc(8 * shx.length);
  shx.forEach((rec, i) => {
    shxBody.writeInt32BE(rec.offset, i * 8);
    shxBody.writeInt32BE(rec.words, i * 8 + 4);
  });
  const shxHead = Buffer.from(header);
  shxHead.writeInt32BE(50 + shx.length * 4, 24);
  return { shp, shx: Buffer.concat([shxHead, shxBody]), bbox: b };
}

function propsOf(row) {
  const props = {};
  Object.keys(row).forEach((k) => {
    if (k === 'geom' || k === 's_geo' || k === 'resultnumber') return;
    const v = row[k];
    props[k] = v == null ? '' : v;
  });
  return props;
}

function layerSummary(key, rows, metaLayer) {
  const role = ROLES[key];
  const types = {};
  const box = emptyBox();
  let verts = 0;
  let skipped = 0;
  let closed = null;
  rows.forEach((row) => {
    const parsed = parseWkt(row.geom);
    const t = parsed ? parsed.type : 'EMPTY';
    types[t] = (types[t] || 0) + 1;
    const geom = featureGeom(parsed, role.shape);
    if (!geom) { skipped++; return; }
    if (geom.kind === 'point') {
      verts++;
      bboxOfPoints([geom.xy], box);
    } else if (geom.kind === 'line') {
      geom.parts.forEach((p) => { verts += p.length; bboxOfPoints(p, box); });
      if (rows.length === 1 && geom.parts.length === 1) {
        const p = geom.parts[0];
        closed = meters(p[0], p[p.length - 1]) <= 1;
      }
    } else {
      geom.polygons.forEach((p) => {
        verts += p.outer.length;
        bboxOfPoints(p.outer, box);
        p.holes.forEach((h) => { verts += h.length; bboxOfPoints(h, box); });
      });
    }
  });
  return {
    key,
    ten: metaLayer && metaLayer.ten,
    bang: metaLayer && metaLayer.bang,
    total: metaLayer && metaLayer.total,
    n: rows.length,
    match: !metaLayer || metaLayer.total == null || Number(metaLayer.total) === rows.length,
    shape: role.shape,
    types,
    skipped,
    verts,
    closed,
    bbox: Number.isFinite(box.minx) ? box : null,
    ms: metaLayer && metaLayer.ms
  };
}

const LOAI_CODES = [
  [/^quy hoạch phân khu/i, 'QHPK'],
  [/^quy hoạch chi tiết/i, 'QHCT'],
  [/^quy hoạch chung/i, 'QHC']
];

function loaiCode(s) {
  const t = String(s || '').trim();
  const hit = LOAI_CODES.find(([re]) => re.test(t));
  return hit ? hit[1] : t;
}

// "khu" chỉ giữ khi là một phần tên loại khu (Khu đô thị mới…, Khu dân cư…).
const KEEP_KHU = /^khu\s+(?:đô thị|dân cư|công nghiệp|du lịch|nhà ở|tái định cư|kinh tế|công nghệ|phức hợp|nghỉ dưỡng)(?=\s|$)/i;

// "Quy hoạch phân khu (tỷ lệ 1/2000) khu vực Thủy Xuân, quận Thuận Hóa, thành phố Huế" → "QHPK Thủy Xuân";
// "… khu trung tâm phía Tây, …" → "QHPK TT phía Tây".
// Dùng (?=\s|,|$) thay cho \b vì \b không khớp sau chữ có dấu (ố, ã).
function proposeName(dump) {
  const r0 = (dump.rows && dump.rows.ranh && dump.rows.ranh[0]) || {};
  const raw = String(r0.tendoan || (dump.meta && dump.meta.tenBanDo) || '').replace(/\s+/g, ' ').trim();
  const loai = loaiCode(r0.loaiquyhoach) || loaiCode(raw);
  let s = raw.replace(/\([^)]*tỷ lệ[^)]*\)/gi, ' ').replace(/\s+/g, ' ').trim();
  s = s.split(/,?\s+(?:quận|huyện|thành phố|thị xã|tỉnh)(?=\s|,|$)/i)[0].trim();
  s = s.replace(/^quy hoạch\s+(?:phân khu|chi tiết|chung)\s*/i, '');
  s = s.replace(/^khu vực\s+/i, '');
  if (!KEEP_KHU.test(s)) s = s.replace(/^khu\s+/i, '');
  s = s.replace(/^trung tâm(?=\s|$)/i, 'TT').trim();
  const place = s ? s.charAt(0).toLocaleUpperCase('vi') + s.slice(1) : '';
  if (loai && place && !place.toUpperCase().startsWith(loai.toUpperCase())) return `${loai} ${place}`;
  return place || loai || 'Do an';
}

function writeLayer(dir, base, role, rows) {
  const features = [];
  const geoms = [];
  const propsList = [];
  let skipped = 0;
  rows.forEach((row) => {
    const parsed = parseWkt(row.geom);
    const geom = featureGeom(parsed, role.shape);
    if (!geom) { skipped++; return; }
    const props = propsOf(row);
    geoms.push(geom);
    propsList.push(props);
    features.push({ type: 'Feature', properties: props, geometry: toGeojsonGeometry(geom) });
  });
  const fieldOrder = [];
  const seen = new Set();
  propsList.forEach((props) => {
    Object.keys(props).forEach((k) => {
      if (seen.has(k)) return;
      seen.add(k);
      fieldOrder.push(k);
    });
  });
  const mapping = allocDbfNames(fieldOrder);
  const { shp, shx, bbox } = writeShp(role.shapeType, geoms);
  const dbf = buildDbf(geoms.length, propsList, mapping);
  const stem = base;
  const zip = zipStore([
    { name: `${stem}.shp`, data: shp },
    { name: `${stem}.shx`, data: shx },
    { name: `${stem}.dbf`, data: dbf.buf },
    { name: `${stem}.prj`, data: Buffer.from(PRJ_WGS84, 'ascii') },
    { name: `${stem}.cpg`, data: Buffer.from('UTF-8', 'ascii') }
  ]);
  fs.writeFileSync(path.join(dir, `${stem}.zip`), zip);
  fs.writeFileSync(path.join(dir, `${stem}.geojson`), JSON.stringify({ type: 'FeatureCollection', features }));
  const dict = mapping.map((m) => `${m.to}\t${m.from}`).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, `${stem}-ten-truong.txt`), dict, 'utf8');
  return { file: `${stem}.zip`, n: geoms.length, skipped, bbox, truncated: dbf.truncated, fields: mapping.length };
}

function exportDump(dump, name, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  Object.keys(ROLES).forEach((key) => {
    const rows = dump.rows && dump.rows[key];
    if (!rows || !rows.length) return;
    written.push({ key, ...writeLayer(outDir, ROLES[key].file(name), ROLES[key], rows) });
  });
  return written;
}

function readShpHeader(buf) {
  return {
    code: buf.readInt32BE(0),
    words: buf.readInt32BE(24),
    version: buf.readInt32LE(28),
    type: buf.readInt32LE(32),
    minx: buf.readDoubleLE(36),
    miny: buf.readDoubleLE(44),
    maxx: buf.readDoubleLE(52),
    maxy: buf.readDoubleLE(60)
  };
}

function countShpRecords(buf) {
  let off = 100;
  let n = 0;
  while (off + 8 <= buf.length) {
    const words = buf.readInt32BE(off + 4);
    off += 8 + words * 2;
    n++;
  }
  return { n, end: off, len: buf.length };
}

function unzip(buf) {
  const files = {};
  let off = 0;
  while (off + 30 <= buf.length) {
    const sig = buf.readUInt32LE(off);
    if (sig !== 0x04034b50) break;
    const method = buf.readUInt16LE(off + 8);
    const compLen = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extra = buf.readUInt16LE(off + 28);
    const name = buf.slice(off + 30, off + 30 + nameLen).toString('utf8');
    const start = off + 30 + nameLen + extra;
    const comp = buf.slice(start, start + compLen);
    files[name] = method === 0 ? comp : zlib.inflateRawSync(comp);
    off = start + compLen;
  }
  return files;
}

function verifyOut(dir) {
  const zips = fs.readdirSync(dir).filter((f) => f.endsWith('.zip'));
  return zips.map((z) => {
    const files = unzip(fs.readFileSync(path.join(dir, z)));
    const shpName = Object.keys(files).find((n) => n.endsWith('.shp'));
    const shp = files[shpName];
    const head = readShpHeader(shp);
    const rec = countShpRecords(shp);
    const gj = JSON.parse(fs.readFileSync(path.join(dir, z.replace(/\.zip$/, '.geojson')), 'utf8'));
    const cpg = files[Object.keys(files).find((n) => n.endsWith('.cpg'))].toString('utf8');
    return {
      zip: z,
      entries: Object.keys(files).sort(),
      type: head.type,
      code: head.code,
      records: rec.n,
      walked: rec.end === rec.len,
      geojson: gj.features.length,
      cpg,
      bbox: [head.minx, head.miny, head.maxx, head.maxy]
    };
  });
}

function selftest() {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'qh-shp-'));
  const dump = {
    meta: { map: 0, tenBanDo: 'Quy hoạch phân khu khu vực Thử nghiệm, thành phố Huế', layers: [] },
    rows: {
      ranh: [{ geom: 'LINESTRING (107.5 16.4, 107.6 16.4, 107.6 16.5, 107.5 16.4)', loaiquyhoach: 'QHPK', tendoan: 'Quy hoạch phân khu khu vực Thử nghiệm, thành phố Huế', ghichu: 'Ủ' }],
      vung: [{
        geom: 'POLYGON ((107.5 16.4, 107.5 16.5, 107.6 16.5, 107.6 16.4, 107.5 16.4), (107.52 16.42, 107.55 16.42, 107.55 16.45, 107.52 16.42))',
        chucnangsudungdat: 'Đất ở',
        malienket: 'A'
      }, {
        geom: 'MULTIPOLYGON (((107.1 16.1, 107.1 16.2, 107.2 16.2, 107.2 16.1, 107.1 16.1)))',
        chucnangsudungdat: 'Công viên',
        malienket: 'B'
      }],
      diem: [{ geom: 'POINT (107.55 16.45)', tendoituong: 'Trường' }]
    }
  };
  const name = proposeName(dump);
  exportDump(dump, name, tmp);
  const check = verifyOut(tmp);
  const poly = unzip(fs.readFileSync(path.join(tmp, `QH-${name}.zip`)));
  const shp = poly[Object.keys(poly).find((n) => n.endsWith('.shp'))];
  const recWords = shp.readInt32BE(104);
  const content = shp.subarray(108, 108 + recWords * 2);
  const numParts = content.readInt32LE(36);
  const firstPart = [];
  const pt0 = 44 + 4 * numParts;
  for (let i = 0; i < 4; i++) firstPart.push([content.readDoubleLE(pt0 + i * 16), content.readDoubleLE(pt0 + i * 16 + 8)]);
  const outerCw = signedArea(firstPart.concat([firstPart[0]])) < 0;
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = name === 'QHPK Thử nghiệm' && outerCw && check.every((c) => c.walked && c.records === c.geojson && c.cpg === 'UTF-8' && c.code === 9994);
  return { ok, name, outerCw, check };
}

// opts.out: ghi shapefile ngay khi nhận dump vào <out>/QH-mapid<id>-<tên đề xuất>.
// opts.count: tự tắt sau khi nhận đủ số dump.
function listen(port, dir, opts) {
  const o = opts || {};
  fs.mkdirSync(dir, { recursive: true });
  const fetchScript = path.join(__dirname, 'gserver-page-fetch.js');
  let received = 0;
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/fetch.js')) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(fs.readFileSync(fetchScript));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(404);
      res.end();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 256 * 1024 * 1024) req.destroy();
      else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        const dump = JSON.parse(buf.toString('utf8'));
        const map = (dump.meta && dump.meta.map) || 'unknown';
        const file = path.join(dir, `mapid${map}.json`);
        fs.writeFileSync(file, buf);
        const proposed = proposeName(dump);
        const layers = Object.keys(ROLES).map((key) => {
          const rows = (dump.rows && dump.rows[key]) || [];
          const metaLayer = ((dump.meta && dump.meta.layers) || []).find((l) => l.key === key);
          return rows.length ? layerSummary(key, rows, metaLayer) : { key, skipped: true, n: 0 };
        });
        const info = { file, bytes: buf.length, proposed, tenBanDo: dump.meta && dump.meta.tenBanDo, layers };
        let reply = { ok: true, map, proposed, bytes: buf.length };
        if (o.out) {
          const w0 = Date.now();
          const outDir = path.join(o.out, safeDirName(`QH-mapid${map}-${proposed}`));
          const written = exportDump(dump, proposed, outDir);
          const verified = verifyOut(outDir);
          const ok = verified.every((v) => v.walked && v.records === v.geojson && v.code === 9994);
          info.out = outDir;
          info.written = written.map((w) => ({ key: w.key, file: w.file, n: w.n }));
          info.verified = ok;
          info.writeMs = Date.now() - w0;
          reply = { ...reply, out: outDir, verified: ok, writeMs: info.writeMs };
        }
        console.log(JSON.stringify(info));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(reply));
      } catch (err) {
        res.writeHead(400);
        res.end(String(err.message || err));
        console.log(JSON.stringify({ error: String(err.message || err) }));
      }
      received++;
      if (o.count && received >= o.count) setTimeout(() => process.exit(0), 200);
    });
  });
  server.listen(Number(port), '127.0.0.1');
  console.log(JSON.stringify({ listen: `http://127.0.0.1:${port}/dump`, script: `http://127.0.0.1:${port}/fetch.js`, dir, out: o.out || null, count: o.count || null }));
}

function safeDirName(s) {
  return String(s).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim();
}

function main() {
  const args = parseArgs(process.argv);
  if (args.selftest) {
    const result = selftest();
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  }
  if (args.listen) {
    listen(args.listen === true ? 8765 : args.listen, args.dir || path.join(require('os').tmpdir(), 'qh-gserver-in'), {
      out: args.auto ? (args.out === true || !args.out ? path.join(require('os').homedir(), 'Desktop') : args.out) : null,
      count: args.count ? Number(args.count) : 0
    });
    return;
  }
  if (!args.dump) {
    console.error('Thiếu --dump, --listen hoặc --selftest');
    process.exit(1);
  }
  const dump = JSON.parse(fs.readFileSync(args.dump, 'utf8'));
  const proposed = proposeName(dump);
  const metaLayers = (dump.meta && dump.meta.layers) || [];
  const layers = Object.keys(ROLES).map((key) => {
    const rows = (dump.rows && dump.rows[key]) || [];
    if (!rows.length) return { key, n: 0, skipped: true };
    return layerSummary(key, rows, metaLayers.find((l) => l.key === key));
  });
  if (!args.name || !args.out) {
    console.log(JSON.stringify({ proposed, tenBanDo: dump.meta && dump.meta.tenBanDo, map: dump.meta && dump.meta.map, layers, wrote: false }));
    return;
  }
  const written = exportDump(dump, args.name, args.out);
  const verified = verifyOut(args.out);
  console.log(JSON.stringify({ proposed, name: args.name, out: args.out, layers, written, verified }));
}

if (require.main === module) main();

module.exports = { parseWkt, proposeName, exportDump, selftest };
