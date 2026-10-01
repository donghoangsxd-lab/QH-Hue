// Xuất lớp phác thảo ra file: KML (WGS84, mở bằng Google Earth / QGIS) và DXF R12 (VN-2000 TT-Huế KTT 107°00', mét, mở bằng AutoCAD).
// items: [{ tool: 'line' | 'polyline' | 'polygon' | 'arrow' | 'circle' | 'text', pts: [L.LatLng], color, head?, text?, heightM? }]
import { wgs84ToVn2000 } from './cadImport.js';

const ACI = { '#f43f5e': 1, '#facc15': 2, '#22d3ee': 4, '#a3e635': 3, '#ffffff': 7 };
const LABELS = { line: 'Đường thẳng', polyline: 'Đường gấp khúc', polygon: 'Đa giác', arrow: 'Mũi tên', circle: 'Vòng tròn', text: 'Chữ' };
const CIRCLE_SEGMENTS = 72;

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

// ================== KML ==================
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

export function exportKml(items) {
  const colors = [...new Set(items.map(it => it.color))];
  const styles = colors.map(c => `<Style id="c${c.slice(1)}">`
    + `<LineStyle><color>${kmlColor(c, 'ff')}</color><width>3</width></LineStyle>`
    + `<PolyStyle><color>${kmlColor(c, '40')}</color></PolyStyle>`
    + `<IconStyle><scale>0</scale></IconStyle>`
    + `<LabelStyle><color>${kmlColor(c, 'ff')}</color><scale>1.1</scale></LabelStyle></Style>`).join('');
  const name = `Phác thảo TP. Huế ${stamp()}`;
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>`
    + `<name>${xml(name)}</name>${styles}${items.map(kmlPlacemark).join('')}</Document></kml>\n`;
  download(body, `Phac-thao-${stamp()}.kml`, 'application/vnd.google-earth.kml+xml');
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
  const head = (type, it) => { tag(0, type); tag(8, LAYERS[it.tool]); tag(62, ACI[it.color] || 7); };
  const polyline = (it, pts, closed) => {
    head('POLYLINE', it); tag(66, 1); tag(10, '0.0'); tag(20, '0.0'); tag(30, '0.0'); tag(70, closed ? 1 : 0);
    pts.forEach(([x, y]) => { tag(0, 'VERTEX'); tag(8, LAYERS[it.tool]); tag(10, num(x)); tag(20, num(y)); tag(30, '0.0'); });
    tag(0, 'SEQEND'); tag(8, LAYERS[it.tool]);
  };
  items.forEach(it => {
    if (it.tool === 'text') {
      const [x, y] = xy(it.pts[0]);
      const h = Math.max(0.1, it.heightM * 0.72);   // chiều cao chữ hoa ≈ 0,72 cỡ chữ trên màn hình
      it.text.split('\n').forEach((line, i) => {
        if (!line.trim()) return;
        head('TEXT', it);
        tag(10, num(x)); tag(20, num(y - it.heightM * (0.95 + i * 1.25))); tag(30, '0.0');
        tag(40, num(h)); tag(1, dxfText(line)); tag(7, 'VN_ARIAL');
      });
    } else if (it.tool === 'circle') {
      const [x, y] = xy(it.pts[0]);
      head('CIRCLE', it); tag(10, num(x)); tag(20, num(y)); tag(30, '0.0'); tag(40, num(radiusM(it)));
    } else if (it.tool === 'polygon') {
      polyline(it, it.pts.map(xy), true);
    } else {
      polyline(it, it.pts.map(xy), false);
      if (it.tool === 'arrow' && it.head) {
        const [a, b, c] = it.head.map(xy);
        head('SOLID', it);
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
  tag(0, 'TABLE'); tag(2, 'LTYPE'); tag(70, 1);
  tag(0, 'LTYPE'); tag(2, 'CONTINUOUS'); tag(70, 0); tag(3, 'Solid line'); tag(72, 65); tag(73, 0); tag(40, '0.0');
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
