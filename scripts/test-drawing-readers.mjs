import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wgs84ToVn2000 } from '../public/js/cadImport.js';
import { readDrawingText, tagFeatures } from '../public/js/drawingReaders.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'entry');
fs.mkdirSync(dir, { recursive: true });

class XmlNode {
  constructor(name) {
    this.localName = name;
    this.attributes = {};
    this.children = [];
    this.parentElement = null;
    this.text = '';
  }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
  getElementsByTagName(name) {
    const out = [];
    const walk = (n) => n.children.forEach(c => { if (c.localName === name) out.push(c); walk(c); });
    walk(this);
    return out;
  }
  getElementsByTagNameNS(_ns, name) { return this.getElementsByTagName(name); }
}

function parseXml(text) {
  const root = new XmlNode('#document');
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([^>\s]+)>|<([^\s>/]+)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1]) { stack.pop(); continue; }
    if (m[2]) {
      const node = new XmlNode(m[2].includes(':') ? m[2].split(':').pop() : m[2]);
      const attrs = m[3] || '';
      const ar = /([\w:-]+)="([^"]*)"/g;
      let a;
      while ((a = ar.exec(attrs))) node.attributes[a[1]] = a[2];
      node.parentElement = stack[stack.length - 1];
      stack[stack.length - 1].children.push(node);
      if (!/\/>$/.test(m[0])) stack.push(node);
      continue;
    }
    if (m[4] && stack.length) stack[stack.length - 1].text += m[4];
  }
  return root;
}

globalThis.DOMParser = class {
  parseFromString(text) { return parseXml(text); }
};

function dxfPair(code, value) {
  return `${code}\n${value}\n`;
}

function dxfText(east, north) {
  const poly = [dxfPair(0, 'LWPOLYLINE'), dxfPair(8, 'HT_DAT_ODT'), dxfPair(90, 4), dxfPair(70, 1)];
  [[east, north], [east + 200, north], [east + 200, north + 200], [east, north + 200]].forEach(([x, y]) => {
    poly.push(dxfPair(10, x.toFixed(3)), dxfPair(20, y.toFixed(3)));
  });
  const insert = [
    dxfPair(0, 'INSERT'), dxfPair(8, 'TEM'), dxfPair(2, 'TEM_DAT'),
    dxfPair(10, (east + 100).toFixed(3)), dxfPair(20, (north + 100).toFixed(3)), dxfPair(66, 1),
    dxfPair(0, 'ATTRIB'), dxfPair(8, 'TEM'), dxfPair(2, 'KYHIEU'), dxfPair(1, 'ODT'),
    dxfPair(10, (east + 100).toFixed(3)), dxfPair(20, (north + 100).toFixed(3)),
    dxfPair(0, 'ATTRIB'), dxfPair(8, 'TEM'), dxfPair(2, 'DIENTICH'), dxfPair(1, '40000'),
    dxfPair(10, (east + 100).toFixed(3)), dxfPair(20, (north + 110).toFixed(3)),
    dxfPair(0, 'SEQEND'),
    dxfPair(0, 'LINE'), dxfPair(8, 'DUONG'),
    dxfPair(10, east.toFixed(3)), dxfPair(20, north.toFixed(3)),
    dxfPair(11, (east + 800).toFixed(3)), dxfPair(21, north.toFixed(3)),
    dxfPair(0, 'INSERT'), dxfPair(8, 'TRAM'), dxfPair(2, 'TRAM_BOM'),
    dxfPair(10, (east + 400).toFixed(3)), dxfPair(20, (north + 20).toFixed(3)), dxfPair(66, 1),
    dxfPair(0, 'ATTRIB'), dxfPair(8, 'TRAM'), dxfPair(2, 'TEN'), dxfPair(1, 'Tram bom'),
    dxfPair(10, (east + 400).toFixed(3)), dxfPair(20, (north + 20).toFixed(3)),
    dxfPair(0, 'SEQEND')
  ];
  return `0\nSECTION\n2\nENTITIES\n${poly.join('')}${insert.join('')}0\nENDSEC\n0\nEOF\n`;
}

const [e, n] = wgs84ToVn2000(16.463, 107.585);
const dxf = dxfText(e, n);
fs.writeFileSync(path.join(dir, 'dat-va-tuyen.dxf'), dxf);

const land = readDrawingText(dxf, 'dxf', 'land', { id: 'HUE_3' });
assert.equal(land.error, undefined);
assert.equal(land.features.length, 1);
assert.equal(land.features[0].geometry.type, 'Polygon');
assert.equal(land.features[0].properties.KYHIEU, 'ODT');
assert.equal(land.features[0].properties.DIENTICH, '40000');
assert.equal(land.stats.labelOrphan, 1);
const [lng, lat] = land.features[0].geometry.coordinates[0][0];
assert.ok(Math.abs(lat - 16.463) < 0.02, `lat ${lat}`);
assert.ok(Math.abs(lng - 107.585) < 0.02, `lng ${lng}`);

const net = readDrawingText(dxf, 'dxf', 'network', { id: 'HUE_3' });
assert.ok(net.features.some(f => f.geometry.type === 'LineString'));
const tram = net.features.find(f => f.geometry.type === 'Point' && f.properties.TEN === 'Tram bom');
assert.ok(tram, 'thieu diem cong trinh dau moi');

const bound = readDrawingText(dxf, 'dxf', 'boundary', { id: 'HUE_3' });
assert.ok(bound.features.some(f => f.geometry.type === 'Polygon'));
assert.ok(bound.features.some(f => f.geometry.type === 'LineString'));

const tagged = tagFeatures(land.features, {
  scheme: 'QHPK Thu thap', level: 'QHPK', sector: 'sdd', kind: 'hien-trang',
  area: { type: 'xa', code: 'thuan-hoa', parent: 'TP' }, step: 'dat-ht'
});
assert.equal(tagged[0].properties.level, 'QHPK');
assert.equal(tagged[0].properties.kind, 'hien-trang');
assert.equal(tagged[0].properties.areaCode, 'thuan-hoa');
assert.equal(tagged[0].properties.KYHIEU, 'ODT');

const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>Lo ODT</name>
<ExtendedData><Data name="KYHIEU"><value>ODT</value></Data></ExtendedData>
<Polygon><outerBoundaryIs><LinearRing><coordinates>
107.585,16.463 107.586,16.463 107.586,16.464 107.585,16.464 107.585,16.463
</coordinates></LinearRing></outerBoundaryIs></Polygon>
</Placemark>
<Placemark><name>Tem</name>
<ExtendedData><Data name="KYHIEU"><value>ODT</value></Data><Data name="DIENTICH"><value>1200</value></Data></ExtendedData>
<Point><coordinates>107.5855,16.4635,0</coordinates></Point>
</Placemark>
<Placemark><name>Tuyen</name>
<ExtendedData><Data name="LOAI"><value>Duong khu vuc</value></Data></ExtendedData>
<LineString><coordinates>107.585,16.463 107.587,16.465</coordinates></LineString>
</Placemark>
</Document></kml>`;
fs.writeFileSync(path.join(dir, 'dat-va-tuyen.kml'), kml);

const kLand = readDrawingText(kml, 'kml', 'land', { id: 'auto' });
assert.equal(kLand.features.length, 1);
assert.equal(kLand.features[0].properties.DIENTICH, '1200');
assert.equal(kLand.features[0].properties.KYHIEU, 'ODT');

const kNet = readDrawingText(kml, 'kml', 'network', { id: 'auto' });
assert.ok(kNet.features.some(f => f.geometry.type === 'LineString' && f.properties.LOAI === 'Duong khu vuc'));
assert.ok(kNet.features.some(f => f.geometry.type === 'Point'));

const bad = readDrawingText(dxf, 'dxf', 'land', { id: 'custom', lon0: 50 });
assert.ok(bad.error);

console.log('drawing readers ok', { land: land.features.length, net: net.features.length, kml: kLand.features.length });
