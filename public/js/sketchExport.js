// Xuất/nhập lớp phác thảo: KML·KMZ (WGS84) và DXF R12 (VN-2000 TT-Huế KTT 107°00', mét).
// items: [{ tool: 'line' | 'polyline' | 'polygon' | 'arrow' | 'circle' | 'text', pts: [L.LatLng], color, head?, text?, heightM?, dash? }]
import { wgs84ToVn2000, vn2000ToWgs84 } from './cadImport.js';
import { SKETCH_MAX_SHAPES, touchesHue } from './kmlLoad.js';

const ACI = { '#f43f5e': 1, '#facc15': 2, '#22d3ee': 4, '#a3e635': 3, '#ffffff': 7 };
const ACI_HEX = { 1: '#f43f5e', 2: '#facc15', 3: '#a3e635', 4: '#22d3ee', 7: '#ffffff' };
const LABELS = { line: 'Đường thẳng', polyline: 'Đường gấp khúc', polygon: 'Đa giác', arrow: 'Mũi tên', circle: 'Vòng tròn', text: 'Chữ' };
const CIRCLE_SEGMENTS = 72;
const HUE_XY = { minE: 480000, maxE: 620000, minN: 1750000, maxN: 1900000 };

const stamp = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

function download(content, fileName, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const radiusM = (it) => it.pts[0].distanceTo(it.pts[1]);

function circleRing(it) {
  const c = it.pts[0], r = radiusM(it);
  return turf.circle([c.lng, c.lat], r / 1000, { steps: CIRCLE_SEGMENTS, units: 'kilometers' }).geometry.coordinates[0];
}

// ================== KML / KMZ ==================
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kmlColor = (hex, alpha) => alpha + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3);
const coordsKml = (lls) => lls.map(p => `${p.lng.toFixed(7)},${p.lat.toFixed(7)},0`).join(' ');
const ringKml = (ring) => ring.map(([lng, lat]) => `${lng.toFixed(7)},${lat.toFixed(7)},0`).join(' ');
const polyKml = (coords) => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;

function kmlPlacemark(it, i) {
  const style = `#c${it.color.slice(1)}`;
  const name = it.tool === 'text' ? it.text.replace(/\s*\n\s*/g, ' ') : `${LABELS[it.tool]} ${i + 1}`;
  let geom;
  if (it.tool === 'text') geom = `<Point><coordinates>${coordsKml([it.pts[0]])}</coordinates></Point>`;
  else if (it.tool === 'polygon') geom = polyKml(coordsKml([...it.pts, it.pts[0]]));
  else if (it.tool === 'circle') geom = polyKml(ringKml(circleRing(it)));
  else if (it.tool === 'arrow' && it.head) {
    geom = `<MultiGeometry><LineString><coordinates>${coordsKml(it.pts)}</coordinates></LineString>`
      + `${polyKml(coordsKml([...it.head, it.head[0]]))}</MultiGeometry>`;
  } else geom = `<LineString><coordinates>${coordsKml(it.pts)}</coordinates></LineString>`;
  const desc = it.tool === 'text' ? `<description>${xml(it.text)}</description>` : '';
  return `<Placemark><name>${xml(name)}</name>${desc}<styleUrl>${style}</styleUrl>${geom}</Placemark>`;
}

export function buildKml(items) {
  const colors = [...new Set(items.map(it => it.color))];
  const styles = colors.map(c => `<Style id="c${c.slice(1)}">`
    + `<LineStyle><color>${kmlColor(c, 'ff')}</color><width>3</width></LineStyle>`
    + `<PolyStyle><color>${kmlColor(c, '40')}</color></PolyStyle>`
    + `<IconStyle><scale>0</scale></IconStyle>`
    + `<LabelStyle><color>${kmlColor(c, 'ff')}</color><scale>1.1</scale></LabelStyle></Style>`).join('');
  const name = `Phác thảo TP. Huế ${stamp()}`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>`
    + `<name>${xml(name)}</name>${styles}${items.map(kmlPlacemark).join('')}</Document></kml>\n`;
}

export function exportKml(items) {
  download(buildKml(items), `Phac-thao-${stamp()}.kml`, 'application/vnd.google-earth.kml+xml');
}

/** KMZ = ZIP chứa doc.kml (không nén nội dung — Google Earth / QGIS đọc được, không cần CompressionStream). */
export function exportKmz(items) {
  const kml = new TextEncoder().encode(buildKml(items));
  download(zipStore([{ name: 'doc.kml', data: kml }]), `Phac-thao-${stamp()}.kmz`, 'application/vnd.google-earth.kmz');
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

function u16(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}
function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function zipStore(files) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = f.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    local.set([0x50, 0x4b, 0x03, 0x04], 0);
    local.set(u16(20), 4);
    local.set(u16(0), 8);
    local.set(u32(crc), 14);
    local.set(u32(data.length), 18);
    local.set(u32(data.length), 22);
    local.set(u16(name.length), 26);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    central.set([0x50, 0x4b, 0x01, 0x02], 0);
    central.set(u16(20), 4);
    central.set(u16(20), 6);
    central.set(u16(0), 10);
    central.set(u32(crc), 16);
    central.set(u32(data.length), 20);
    central.set(u32(data.length), 24);
    central.set(u16(name.length), 28);
    central.set(u32(offset), 42);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  end.set([0x50, 0x4b, 0x05, 0x06], 0);
  end.set(u16(files.length), 8);
  end.set(u16(files.length), 10);
  end.set(u32(centralSize), 12);
  end.set(u32(offset), 16);
  const out = new Uint8Array(offset + centralSize + 22);
  let o = 0;
  for (const p of locals) { out.set(p, o); o += p.length; }
  for (const p of centrals) { out.set(p, o); o += p.length; }
  out.set(end, o);
  return out;
}

// ================== DXF R12 (AC1009) ==================
// Chữ tiếng Việt ghi dạng \U+XXXX (AutoCAD / QCAD đọc được), kiểu chữ VN_ARIAL dùng arial.ttf có đủ dấu.
// R12 không có MTEXT: mỗi dòng của khối chữ là 1 TEXT (AutoCAD: lệnh TXT2MTXT để gộp lại nếu cần).
const LAYERS = { line: 'PHAC_THAO_DUONG', polyline: 'PHAC_THAO_DUONG', arrow: 'PHAC_THAO_DUONG', polygon: 'PHAC_THAO_VUNG', circle: 'PHAC_THAO_VUNG', text: 'PHAC_THAO_CHU' };
const dxfText = (s) => [...s].map(ch => {
  const code = ch.codePointAt(0);
  return code < 128 ? ch : `\\U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}).join('');
const num = (v) => (Math.round(v * 1000) / 1000).toFixed(3);

function dxfEntities(items) {
  const out = [];
  const tag = (code, value) => out.push(String(code), String(value));
  const xy = (ll) => wgs84ToVn2000(ll.lat, ll.lng);
  const head = (type, it, dashedLine) => {
    tag(0, type); tag(8, LAYERS[it.tool]); tag(62, ACI[it.color] || 7);
    if (dashedLine && it.dash) tag(6, 'DASHED');
  };
  const polyline = (it, pts, closed) => {
    head('POLYLINE', it, true); tag(66, 1); tag(10, '0.0'); tag(20, '0.0'); tag(30, '0.0'); tag(70, closed ? 1 : 0);
    pts.forEach(([x, y]) => { tag(0, 'VERTEX'); tag(8, LAYERS[it.tool]); tag(10, num(x)); tag(20, num(y)); tag(30, '0.0'); });
    tag(0, 'SEQEND'); tag(8, LAYERS[it.tool]);
  };
  items.forEach(it => {
    if (it.tool === 'text') {
      const [x, y] = xy(it.pts[0]);
      const h = Math.max(0.1, (it.heightM || 16) * 0.72);
      const step = it.heightM || 16;
      String(it.text || '').split('\n').forEach((line, i) => {
        if (!line.trim()) return;
        head('TEXT', it, false);
        tag(10, num(x)); tag(20, num(y - step * (0.95 + i * 1.25))); tag(30, '0.0');
        tag(40, num(h)); tag(1, dxfText(line)); tag(7, 'VN_ARIAL');
      });
    } else if (it.tool === 'circle') {
      const [x, y] = xy(it.pts[0]);
      head('CIRCLE', it, true); tag(10, num(x)); tag(20, num(y)); tag(30, '0.0'); tag(40, num(radiusM(it)));
    } else if (it.tool === 'polygon') {
      polyline(it, it.pts.map(xy), true);
    } else {
      polyline(it, it.pts.map(xy), false);
      if (it.tool === 'arrow' && it.head) {
        const [a, b, c] = it.head.map(xy);
        head('SOLID', it, false);
        tag(10, num(a[0])); tag(20, num(a[1])); tag(30, '0.0');
        tag(11, num(b[0])); tag(21, num(b[1])); tag(31, '0.0');
        tag(12, num(c[0])); tag(22, num(c[1])); tag(32, '0.0');
        tag(13, num(c[0])); tag(23, num(c[1])); tag(33, '0.0');
      }
    }
  });
  return out;
}

export function exportDxf(items) {
  const layerNames = [...new Set(Object.values(LAYERS))];
  const t = [];
  const tag = (code, value) => t.push(String(code), String(value));
  tag(0, 'SECTION'); tag(2, 'HEADER');
  tag(9, '$ACADVER'); tag(1, 'AC1009');
  tag(9, '$DWGCODEPAGE'); tag(3, 'ANSI_1258');
  tag(0, 'ENDSEC');
  tag(0, 'SECTION'); tag(2, 'TABLES');
  tag(0, 'TABLE'); tag(2, 'LTYPE'); tag(70, 2);
  tag(0, 'LTYPE'); tag(2, 'CONTINUOUS'); tag(70, 0); tag(3, 'Solid line'); tag(72, 65); tag(73, 0); tag(40, '0.0');
  tag(0, 'LTYPE'); tag(2, 'DASHED'); tag(70, 0); tag(3, 'Dashed'); tag(72, 65); tag(73, 2); tag(40, '23.0'); tag(49, '15.0'); tag(49, '-8.0');
  tag(0, 'ENDTAB');
  tag(0, 'TABLE'); tag(2, 'LAYER'); tag(70, layerNames.length);
  layerNames.forEach(n => { tag(0, 'LAYER'); tag(2, n); tag(70, 0); tag(62, 7); tag(6, 'CONTINUOUS'); });
  tag(0, 'ENDTAB');
  tag(0, 'TABLE'); tag(2, 'STYLE'); tag(70, 1);
  tag(0, 'STYLE'); tag(2, 'VN_ARIAL'); tag(70, 0); tag(40, '0.0'); tag(41, '1.0'); tag(50, '0.0'); tag(71, 0); tag(42, '2.5'); tag(3, 'arial.ttf'); tag(4, '');
  tag(0, 'ENDTAB');
  tag(0, 'ENDSEC');
  tag(0, 'SECTION'); tag(2, 'ENTITIES');
  t.push(...dxfEntities(items));
  tag(0, 'ENDSEC');
  tag(0, 'EOF');
  download(t.join('\r\n') + '\r\n', `Phac-thao-${stamp()}-VN2000.dxf`, 'application/dxf');
}

// ================== Nhập DXF (đối xứng với file xuất phác thảo) ==================
function dxfTags(text) {
  const lines = String(text).split(/\r?\n/);
  const tags = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i], 10);
    if (Number.isNaN(code)) continue;
    tags.push([code, lines[i + 1].trim()]);
  }
  return tags;
}

function undxfText(s) {
  return String(s || '')
    .replace(/\\U\+([0-9A-Fa-f]{4,6})/g, (_, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; }
    })
    .replace(/\{\\f[^;]*;|\}|\\P/g, (m) => (m === '\\P' ? '\n' : ''))
    .trim();
}

function xyToWgs(x, y, geographic) {
  if (geographic) return { lat: y, lng: x };
  const [lat, lng] = vn2000ToWgs84(x, y);
  return { lat, lng };
}

function looksGeographicXY(pts) {
  if (!pts.length) return false;
  const geo = pts.filter(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90);
  return geo.length >= pts.length * 0.9;
}

function looksHueMeters(pts) {
  return pts.some(([x, y]) => x >= HUE_XY.minE && x <= HUE_XY.maxE && y >= HUE_XY.minN && y <= HUE_XY.maxN);
}

/**
 * DXF phác thảo → { shapes, dropped }.
 * Đọc LINE, POLYLINE/LWPOLYLINE, CIRCLE, TEXT/MTEXT, SOLID (đầu mũi tên).
 * Mặc định VN-2000 TT-Huế; nếu tọa độ giống kinh-vĩ độ thì coi WGS84.
 */
export function sketchShapesFromDxf(text) {
  if (!text || !/\bENTITIES\b/i.test(text)) throw new Error('File không phải DXF (thiếu phần ENTITIES).');
  const tags = dxfTags(text);
  const lines = [];
  const polys = [];
  const circles = [];
  const texts = [];
  const solids = [];
  const samples = [];
  let section = null;

  const colorOf = (aci) => ACI_HEX[aci] || null;
  const takeUntil0 = (i, fn) => {
    let aci = 7, layer = '0', ltype = '';
    const g = {};
    for (; i < tags.length && tags[i][0] !== 0; i++) {
      const [code, v] = tags[i];
      if (code === 8) layer = v;
      else if (code === 62) aci = parseInt(v, 10) || 7;
      else if (code === 6) ltype = v;
      else if (g[code] === undefined) g[code] = v;
      if (fn) fn(code, v, g);
    }
    return { i, aci, layer, ltype, g };
  };

  for (let i = 0; i < tags.length;) {
    const [code, v] = tags[i];
    if (code !== 0) { i++; continue; }
    if (v === 'SECTION') { section = tags[i + 1] && tags[i + 1][1]; i += 2; continue; }
    if (v === 'ENDSEC') { section = null; i++; continue; }
    if (section !== 'ENTITIES') { i++; continue; }

    if (v === 'LINE') {
      const { i: j, aci, ltype, g } = takeUntil0(i + 1);
      const x1 = parseFloat(g[10]), y1 = parseFloat(g[20]), x2 = parseFloat(g[11]), y2 = parseFloat(g[21]);
      if ([x1, y1, x2, y2].every(Number.isFinite)) {
        samples.push([x1, y1], [x2, y2]);
        lines.push({ pts: [[x1, y1], [x2, y2]], color: colorOf(aci), dash: /DASH/i.test(ltype) });
      }
      i = j;
      continue;
    }
    if (v === 'CIRCLE') {
      const { i: j, aci, ltype, g } = takeUntil0(i + 1);
      const x = parseFloat(g[10]), y = parseFloat(g[20]), r = parseFloat(g[40]);
      if ([x, y, r].every(Number.isFinite) && r > 0) {
        samples.push([x, y], [x + r, y]);
        circles.push({ c: [x, y], r, color: colorOf(aci), dash: /DASH/i.test(ltype) });
      }
      i = j;
      continue;
    }
    if (v === 'TEXT' || v === 'MTEXT') {
      const { i: j, aci, g } = takeUntil0(i + 1);
      const x = parseFloat(g[10]), y = parseFloat(g[20]);
      const raw = undxfText(g[1] || g[3] || '');
      if ([x, y].every(Number.isFinite) && raw) {
        samples.push([x, y]);
        texts.push({ pt: [x, y], text: raw.slice(0, 200), color: colorOf(aci) });
      }
      i = j;
      continue;
    }
    if (v === 'SOLID') {
      const { i: j, aci, g } = takeUntil0(i + 1);
      const pts = [[parseFloat(g[10]), parseFloat(g[20])], [parseFloat(g[11]), parseFloat(g[21])], [parseFloat(g[12]), parseFloat(g[22])]]
        .filter(p => p.every(Number.isFinite));
      if (pts.length >= 3) {
        samples.push(...pts);
        solids.push({ pts, color: colorOf(aci) });
      }
      i = j;
      continue;
    }
    if (v === 'LWPOLYLINE') {
      const verts = [];
      let closed = false, aci = 7, ltype = '';
      for (i++; i < tags.length && tags[i][0] !== 0; i++) {
        const [c, val] = tags[i];
        if (c === 62) aci = parseInt(val, 10) || 7;
        else if (c === 6) ltype = val;
        else if (c === 70) closed = (parseInt(val, 10) & 1) === 1;
        else if (c === 10) verts.push([parseFloat(val), NaN]);
        else if (c === 20 && verts.length) verts[verts.length - 1][1] = parseFloat(val);
      }
      const ok = verts.filter(p => p.every(Number.isFinite));
      if (ok.length >= 2) {
        samples.push(...ok);
        (closed && ok.length >= 3 ? polys : lines).push({ pts: ok, color: colorOf(aci), dash: /DASH/i.test(ltype) });
      }
      continue;
    }
    if (v === 'POLYLINE') {
      let closed = false, aci = 7, ltype = '';
      for (i++; i < tags.length && tags[i][0] !== 0; i++) {
        if (tags[i][0] === 62) aci = parseInt(tags[i][1], 10) || 7;
        else if (tags[i][0] === 6) ltype = tags[i][1];
        else if (tags[i][0] === 70) closed = (parseInt(tags[i][1], 10) & 1) === 1;
      }
      const verts = [];
      while (i < tags.length && tags[i][1] === 'VERTEX') {
        let x = NaN, y = NaN;
        for (i++; i < tags.length && tags[i][0] !== 0; i++) {
          if (tags[i][0] === 10) x = parseFloat(tags[i][1]);
          else if (tags[i][0] === 20) y = parseFloat(tags[i][1]);
        }
        if (Number.isFinite(x) && Number.isFinite(y)) verts.push([x, y]);
      }
      if (i < tags.length && tags[i][1] === 'SEQEND') {
        for (i++; i < tags.length && tags[i][0] !== 0; i++);
      }
      if (verts.length >= 2) {
        samples.push(...verts);
        (closed && verts.length >= 3 ? polys : lines).push({
          pts: verts, color: colorOf(aci), dash: /DASH/i.test(ltype)
        });
      }
      continue;
    }
    for (i++; i < tags.length && tags[i][0] !== 0; i++);
  }

  if (!samples.length) throw new Error('File DXF không có đường, vùng, vòng tròn hoặc chữ.');
  const geographic = looksGeographicXY(samples) && !looksHueMeters(samples);
  if (!geographic && !looksHueMeters(samples)) {
    throw new Error('Tọa độ DXF không khớp VN-2000 quanh Huế và cũng không phải kinh-vĩ độ.');
  }

  const shapes = [];
  let dropped = 0;
  const ringsSeen = [];
  const push = (tool, xyPts, extra = {}) => {
    if (shapes.length >= SKETCH_MAX_SHAPES) { dropped++; return; }
    const pts = xyPts.map(([x, y]) => xyToWgs(x, y, geographic));
    ringsSeen.push(pts.map(p => [p.lng, p.lat]));
    shapes.push({ tool, pts, ...extra });
  };

  const usedSolid = new Set();
  const near = (a, b, tol = 2.5) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

  lines.forEach(ln => {
    if (ln.pts.length === 2) {
      const tip = ln.pts[1];
      const si = solids.findIndex((s, idx) => !usedSolid.has(idx) && s.pts.some(p => near(p, tip)));
      if (si >= 0) {
        usedSolid.add(si);
        push('arrow', ln.pts, { color: ln.color || solids[si].color, dash: ln.dash });
        return;
      }
    }
    push(ln.pts.length === 2 ? 'line' : 'polyline', ln.pts, { color: ln.color, dash: ln.dash });
  });
  polys.forEach(p => push('polygon', p.pts, { color: p.color, dash: p.dash }));
  circles.forEach(c => push('circle', [c.c, [c.c[0] + c.r, c.c[1]]], { color: c.color, dash: c.dash }));
  texts.forEach(t => push('text', [t.pt], { text: t.text, color: t.color }));
  solids.forEach((s, idx) => {
    if (usedSolid.has(idx)) return;
    if (s.pts.length >= 3) push('polygon', s.pts, { color: s.color });
  });

  if (!shapes.length) throw new Error('File DXF không có hình hợp lệ để nhập phác thảo.');
  if (!touchesHue(ringsSeen)) throw new Error('Tọa độ không nằm quanh Huế.');
  return { shapes, dropped };
}
