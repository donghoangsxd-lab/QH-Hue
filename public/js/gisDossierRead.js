// Đọc lược đồ HoSoGIS trên máy: shapefile (đầu .shp + .dbf + .prj), GeoPackage (lược đồ SQLite),
// tệp trình bày .qgz. Không đọc phần tọa độ. File Geodatabase chỉ ghi nhận thư mục.
import { readZip } from './kmlImport.js';
import { prjToCrs, shpHeaderKind } from './shpImport.js';
import { assessGis, bindFields, checkMaDoiTuong, checkMaHoSo, packageIdOf } from './gisDossierCore.js';

const SKIP_DIR = /^(?:__MACOSX|\.git|node_modules)$/i;
const SYS_TABLE = /^(?:gpkg_|sqlite_|rtree_|idx_)/i;
const PRESENT_EXT = /\.(qgz|aprx|ppkx|mxd|mpk)$/i;
const GPKG_TYPES = [
  ['MULTIPOLYGON', 'A'], ['MULTILINESTRING', 'L'], ['MULTIPOINT', 'P'],
  ['POLYGON', 'A'], ['LINESTRING', 'L'], ['POINT', 'P']
];

function dbfDecoder(cpg, bytes) {
  const s = String(cpg || '').trim().toLowerCase();
  if (/utf-?8|65001/.test(s)) return new TextDecoder('utf-8');
  const cp = s.match(/(\d{3,4})/);
  if (cp) { try { return new TextDecoder(`windows-${cp[1]}`); } catch (e) { /* trình duyệt không có trang mã này */ } }
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return new TextDecoder('utf-8'); } catch (e) { return new TextDecoder('windows-1258'); }
}

function dbfFields(buf) {
  if (!buf || buf.byteLength < 33) throw new Error('File .dbf hỏng');
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = v.getUint32(4, true);
  const headLen = v.getUint16(8, true);
  const recLen = v.getUint16(10, true);
  if (headLen < 33 || recLen < 1) throw new Error('File .dbf hỏng');
  const ascii = new TextDecoder('latin1');
  const fields = [];
  for (let o = 32; o + 32 <= headLen && buf[o] !== 0x0d; o += 32) {
    fields.push({
      name: ascii.decode(buf.subarray(o, o + 11)).replace(/\0.*$/, '').trim(),
      type: String.fromCharCode(buf[o + 11]),
      len: buf[o + 16],
      at: 0
    });
  }
  let at = 1;
  fields.forEach(f => { f.at = at; at += f.len; });
  return { n, headLen, recLen, fields };
}

/** Quét sáu trường bắt buộc. Giữ ví dụ lỗi, không giữ cả bảng. */
export function scanDbf(buf, cpg, layerName) {
  const meta = dbfFields(buf);
  const bound = bindFields(meta.fields);
  const sampleEnd = Math.min(buf.byteLength, meta.headLen + meta.recLen * 40);
  const dec = dbfDecoder(cpg, buf.subarray(meta.headLen, sampleEnd));
  const stats = {};
  const codes = new Set();
  let mojibake = false;
  const badBag = {};
  const warnBag = {};
  for (const spec of Object.keys(bound)) {
    stats[spec] = { empty: 0 };
    badBag[spec] = [];
    warnBag[spec] = [];
  }
  const maxRec = Math.min(meta.n, Math.floor((buf.byteLength - meta.headLen) / meta.recLen));
  for (let i = 0; i < maxRec; i++) {
    const rec = meta.headLen + i * meta.recLen;
    if (buf[rec] === 0x2a) continue;
    const row = {};
    for (const [spec, got] of Object.entries(bound)) {
      const f = got.field;
      let val = dec.decode(buf.subarray(rec + f.at, rec + f.at + f.len)).replace(/\0/g, '').trim();
      if (val.includes('\uFFFD')) mojibake = true;
      if (!val) { stats[spec].empty++; continue; }
      row[spec] = val;
      if (val.length > (spec === 'maThongTinQH' || spec === 'maHoSoQH' ? 15 : spec === 'maDoiTuong' || spec === 'tenDoiTuong' ? 100 : 250)) {
        if (badBag[spec].length < 5) badBag[spec].push(val.slice(0, 40));
      }
    }
    const code = row.maHoSoQH || '';
    if (code) {
      if (!checkMaHoSo(code)) { if (badBag.maHoSoQH && badBag.maHoSoQH.length < 5) badBag.maHoSoQH.push(code); }
      else codes.add(code);
    }
    if (row.maDoiTuong) {
      const err = checkMaDoiTuong(row.maDoiTuong, checkMaHoSo(code) ? code : '', layerName);
      if (err) {
        const bag = err.level === 'fail' ? badBag.maDoiTuong : warnBag.maDoiTuong;
        if (bag && bag.length < 5) bag.push(`${row.maDoiTuong} (${err.text})`);
      }
    }
  }
  for (const spec of Object.keys(stats)) {
    if (badBag[spec] && badBag[spec].length) stats[spec].bad = `${spec}: sai quy cách, ví dụ ${badBag[spec].join('; ')}`;
    if (warnBag[spec] && warnBag[spec].length) stats[spec].warn = `${spec}: ${warnBag[spec].join('; ')}`;
  }
  const partial = maxRec < meta.n;
  return {
    fields: meta.fields.map(({ name, type, len }) => ({ name, type, len })),
    values: stats,
    codes: [...codes],
    mojibake,
    rows: maxRec,
    partial
  };
}

function parentPkg(parts) {
  for (let i = parts.length - 2; i >= 0; i--) {
    const id = packageIdOf(parts[i]);
    if (id) return { id, index: i };
  }
  return null;
}

function layerFromPath(path) {
  const parts = path.split('/').filter(Boolean);
  const file = parts[parts.length - 1] || '';
  const base = file.replace(/\.[^.]+$/, '');
  const hit = parentPkg(parts);
  if (!hit) return { pkg: '', group: parts.length > 1 ? parts[parts.length - 2] : '', name: base };
  const between = parts.slice(hit.index + 1, -1).filter(seg => !packageIdOf(seg));
  return { pkg: hit.id, group: between[0] || '', name: base };
}

async function readBytes(file, start, end) {
  return file.read(start, end == null ? file.size : end);
}

async function textOf(file, limit = 8000) {
  const buf = await readBytes(file, 0, Math.min(file.size, limit));
  return new TextDecoder().decode(buf);
}

function crsNote(prj) {
  if (!prj) return 'Thiếu file .prj';
  const crs = prjToCrs(prj);
  if (crs === 'HUE_3' || crs === 'UTM48_6') return '';
  if (crs === 'WGS84') return 'Hệ tọa độ WGS84. Hồ sơ quy hoạch tại Huế thường dùng VN-2000 (kinh tuyến trục 107° hoặc múi 6°).';
  return 'Hệ tọa độ không phải VN-2000 múi Huế (107°) hay UTM 48 (105°).';
}

async function readShapefile(parts) {
  const shp = parts.shp;
  const dbf = parts.dbf;
  const path = (shp || dbf).path;
  const loc = layerFromPath(path);
  if (!dbf) throw new Error(`${loc.name}: thiếu file .dbf`);
  let geom = null;
  let multi = false;
  if (shp) {
    const head = await readBytes(shp, 0, Math.min(shp.size, 100));
    const kind = shpHeaderKind(head);
    if (!kind) throw new Error(`${loc.name}: file .shp hỏng`);
    geom = kind.kind;
    multi = kind.multi;
  }
  const cpg = parts.cpg ? await textOf(parts.cpg, 80) : '';
  const dbfBuf = await readBytes(dbf, 0, dbf.size);
  const scanned = scanDbf(dbfBuf, cpg, loc.name);
  let prjNote = '';
  if (parts.prj) prjNote = crsNote(await textOf(parts.prj, 4000));
  else prjNote = 'Thiếu file .prj';
  if (scanned.mojibake && scanned.values) scanned.values.mojibake = true;
  return {
    ...loc,
    path,
    geom: shp ? geom : null,
    multi,
    source: 'shp',
    fields: scanned.fields,
    values: scanned.values,
    codes: scanned.codes,
    rows: scanned.rows,
    prjNote,
    partial: scanned.partial
  };
}

function gpkgTables(text) {
  const tables = [];
  const re = /CREATE TABLE\s+(?:"([^"]+)"|(\w+))\s*\(/gi;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1] || m[2];
    if (!name || SYS_TABLE.test(name)) continue;
    const from = re.lastIndex;
    let depth = 1;
    let i = from;
    for (; i < text.length && depth; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
    }
    const body = text.slice(from, i - 1);
    const fields = [];
    body.split(',').forEach(piece => {
      const col = piece.trim().match(/^(?:"([^"]+)"|(\w+))\s+([A-Za-z]+)(?:\((\d+)\))?/);
      if (!col) return;
      const colName = col[1] || col[2];
      if (/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)$/i.test(colName)) return;
      fields.push({ name: colName, type: col[3].toUpperCase(), len: col[4] ? Number(col[4]) : 0 });
    });
    tables.push({ name, fields });
    re.lastIndex = i;
  }
  return tables;
}

function geomOfTable(text, name) {
  let at = 0;
  while ((at = text.indexOf(name, at)) !== -1) {
    const before = at > 0 ? text[at - 1] : '';
    if (/[A-Za-z0-9_]/.test(before)) { at += name.length; continue; }
    const window = text.slice(at, at + name.length + 96).toUpperCase();
    const hit = GPKG_TYPES.find(([token]) => window.includes(token));
    if (hit) return { geom: hit[1], multi: hit[0].startsWith('MULTI') };
    at += name.length;
  }
  return { geom: null, multi: false };
}

async function readGpkg(file) {
  const head = await readBytes(file, 0, Math.min(file.size, 3 * 1024 * 1024));
  const latin = new TextDecoder('latin1').decode(head);
  if (!latin.startsWith('SQLite format 3')) throw new Error(`${file.path}: không phải GeoPackage`);
  const app = head.length > 72 ? String.fromCharCode(head[68], head[69], head[70], head[71]) : '';
  const tables = gpkgTables(latin);
  const locFile = layerFromPath(file.path);
  const pkg = packageIdOf(file.path.split('/').pop()) || locFile.pkg;
  const layers = tables.map(t => {
    const g = geomOfTable(latin, t.name);
    const loc = pkg ? { pkg, group: '', name: t.name } : layerFromPath(`${file.path}/${t.name}.gpkg`);
    return { ...loc, pkg: pkg || loc.pkg, name: t.name, geom: g.geom, multi: g.multi, source: 'gpkg', fields: t.fields, values: null, codes: [], path: file.path };
  });
  const codes = new Set();
  const step = 1024 * 1024;
  const re = /\d{2}(?:QHC|QPK|QCT)\d{7}/g;
  for (let start = 0; start < file.size && start < 256 * 1024 * 1024; start += step) {
    const buf = await readBytes(file, start, Math.min(file.size, start + step + 24));
    const chunk = new TextDecoder('latin1').decode(buf);
    for (const m of chunk.matchAll(re)) codes.add(m[0]);
    if (codes.size > 12) break;
  }
  return { pkg, app, layers, codes: [...codes], partial: file.size > 256 * 1024 * 1024 };
}

function qgzNames(xml) {
  const groups = [...xml.matchAll(/layer-tree-group\b[^>]*\bname="([^"]+)"/gi)].map(m => m[1]);
  const layers = [...xml.matchAll(/layer-tree-layer\b[^>]*\bname="([^"]+)"/gi)].map(m => m[1]);
  return { groups, layers };
}

async function readPresentation(file) {
  const base = file.path.split('/').pop();
  if (!/\.qgz$/i.test(base) && !/\.aprx$/i.test(base)) {
    return { name: base, note: /\.(mxd|mpk)$/i.test(base) ? `${base}: định dạng đóng, mới ghi nhận là đã nộp tệp trình bày` : '' };
  }
  try {
    const buf = await readBytes(file, 0, file.size);
    const entries = readZip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), base);
    if (/\.qgz$/i.test(base)) {
      const qgs = entries.find(e => /\.qgs$/i.test(e.name));
      if (!qgs) return { name: base, note: `${base}: không có file .qgs bên trong` };
      const xml = new TextDecoder().decode(await qgs.read());
      const tree = qgzNames(xml);
      const known = tree.groups.some(g => packageIdOf(g) || /hi[eê]n\s*tr[aạ]ng|quy\s*ho[aạ]ch|n[eề]n\s*[đd][iị]a\s*h[iì]nh|m[oố]c\s*gi[oớ]i/i.test(g));
      return { name: base, groups: tree.groups, note: known ? '' : `${base}: cây nhóm lớp chưa thấy Hiện trạng / Quy hoạch / Nền địa hình / Mốc giới` };
    }
    const xml = entries.find(e => /\.xml$/i.test(e.name));
    if (!xml) return { name: base, note: '' };
    const text = new TextDecoder().decode(await xml.read({ maxBytes: 2 * 1024 * 1024 }));
    const known = /HienTrang|QuyHoach|NenDiaHinh|MocGioi/.test(text);
    return { name: base, note: known ? '' : `${base}: chưa thấy tên bốn cơ sở dữ liệu trong tệp trình bày` };
  } catch (e) {
    return { name: base, note: `${base}: không đọc được nội dung (${e.message})` };
  }
}

function rememberPkg(packages, id, form, unreadable) {
  if (!id) return;
  const cur = packages[id] || { found: false, form: '', unreadable: false };
  cur.found = true;
  if (!cur.form) cur.form = form;
  if (unreadable) cur.unreadable = true;
  if (form === 'shp' || form === 'gpkg') cur.unreadable = false;
  packages[id] = cur;
}

/**
 * files: [{ path, size, read(start, end) }]. path dùng dấu /.
 * Trả báo cáo assessGis.
 */
export async function inspectGisFiles(files, label, onProgress) {
  const packages = {};
  const errors = [];
  const warnings = [];
  const presentation = [];
  const byStem = new Map();
  const gpkg = [];
  const present = [];
  const seenGdb = new Set();

  for (const file of files) {
    const path = String(file.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!path || path.split('/').some(seg => SKIP_DIR.test(seg))) continue;
    const parts = path.split('/');
    parts.forEach((seg, i) => {
      if (/\.gdb$/i.test(seg)) {
        const id = packageIdOf(seg);
        const key = parts.slice(0, i + 1).join('/');
        if (!seenGdb.has(key)) {
          seenGdb.add(key);
          rememberPkg(packages, id || packageIdOf(parts[i - 1] || ''), 'gdb', true);
          if (!id) errors.push(`${seg}: thư mục File Geodatabase chưa đặt tên NenDiaHinh / HienTrang / QuyHoach / MocGioi`);
        }
      } else {
        const id = packageIdOf(seg);
        if (id && i < parts.length - 1) rememberPkg(packages, id, '', false);
      }
    });
    const leaf = parts[parts.length - 1];
    const ext = (leaf.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
    if (ext === 'gpkg') { gpkg.push({ ...file, path }); rememberPkg(packages, packageIdOf(leaf), 'gpkg', false); }
    else if (PRESENT_EXT.test(leaf)) present.push({ ...file, path });
    else if (/^(shp|dbf|prj|cpg)$/.test(ext)) {
      const stem = path.slice(0, -(ext.length + 1)).toLowerCase();
      const g = byStem.get(stem) || { path };
      g[ext] = { ...file, path };
      byStem.set(stem, g);
    }
  }

  const layers = [];
  const stems = [...byStem.values()];
  let n = 0;
  for (const g of stems) {
    n += 1;
    if (onProgress && n % 3 === 1) onProgress(`Đang đọc shapefile ${n}/${stems.length}`);
    try {
      const layer = await readShapefile(g);
      if (!layer.pkg) errors.push(`${layer.name}: không nằm trong thư mục NenDiaHinh, HienTrang, QuyHoach hoặc MocGioi`);
      else rememberPkg(packages, layer.pkg, 'shp', false);
      layers.push(layer);
    } catch (e) {
      errors.push(e.message);
    }
    if (n % 8 === 0) await new Promise(r => setTimeout(r, 0));
  }

  for (const file of gpkg) {
    if (onProgress) onProgress(`Đang đọc ${file.path.split('/').pop()}`);
    try {
      const got = await readGpkg(file);
      const leaf = file.path.split('/').pop();
      if (got.app !== 'GPKG') warnings.push(`${leaf}: SQLite chưa khai báo mã GeoPackage`);
      if (!got.pkg) errors.push(`${leaf}: tên tệp chưa phải NenDiaHinh / HienTrang / QuyHoach / MocGioi`);
      else rememberPkg(packages, got.pkg, 'gpkg', false);
      if (got.partial) warnings.push(`${leaf}: mới quét 256 MB đầu để tìm mã hồ sơ`);
      got.layers.forEach(layer => layers.push(layer));
      got.codes.forEach(code => { file._codes = file._codes || []; file._codes.push(code); });
      file._codeList = got.codes;
    } catch (e) {
      errors.push(e.message);
    }
  }

  for (const file of present) {
    if (onProgress) onProgress(`Đang xem ${file.path.split('/').pop()}`);
    presentation.push(await readPresentation(file));
  }

  const codes = [];
  for (const file of gpkg) (file._codeList || []).forEach(c => codes.push(c));

  if (onProgress) onProgress('Đang chấm');
  return assessGis({ label, packages, layers, presentation, errors, warnings, codes });
}
