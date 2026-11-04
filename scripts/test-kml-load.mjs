import assert from 'node:assert/strict';
import { cssFromKmlColor } from '../public/js/kmlImport.js';
import { sketchShapesFromKml } from '../public/js/kmlLoad.js';

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

assert.equal(cssFromKmlColor('ff3e43f4'), '#f4433e');
assert.equal(cssFromKmlColor('#40c0d322'), '#22d3c0');
assert.equal(cssFromKmlColor('a3e635'), '#a3e635');
assert.equal(cssFromKmlColor(''), null);

const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Style id="cf43f5e">
    <LineStyle><color>ff5e3ff4</color><width>3</width></LineStyle>
    <PolyStyle><color>405e3ff4</color></PolyStyle>
  </Style>
  <Style id="cyellow">
    <LineStyle><color>ff15c0fa</color></LineStyle>
  </Style>
  <StyleMap id="mYellow">
    <Pair><key>normal</key><styleUrl>#cyellow</styleUrl></Pair>
    <Pair><key>highlight</key><styleUrl>#cyellow</styleUrl></Pair>
  </StyleMap>
  <Placemark>
    <name>Vung do</name>
    <styleUrl>#cf43f5e</styleUrl>
    <Polygon><outerBoundaryIs><LinearRing>
      <coordinates>107.58,16.46,0 107.581,16.46,0 107.581,16.461,0 107.58,16.46,0</coordinates>
    </LinearRing></outerBoundaryIs></Polygon>
  </Placemark>
  <Placemark>
    <name>Duong vang</name>
    <styleUrl>#mYellow</styleUrl>
    <LineString>
      <coordinates>107.582,16.462,0 107.583,16.463,0</coordinates>
    </LineString>
  </Placemark>
  <Placemark>
    <name>Chu xanh</name>
    <Style>
      <LabelStyle><color>ffe6a3a3</color></LabelStyle>
    </Style>
    <Point><coordinates>107.584,16.464,0</coordinates></Point>
  </Placemark>
</Document></kml>`;

const pack = sketchShapesFromKml(kml);
assert.equal(pack.shapes.length, 3);
assert.equal(pack.shapes[0].tool, 'polygon');
assert.equal(pack.shapes[0].color, '#f43f5e');
assert.equal(pack.shapes[1].tool, 'line');
assert.equal(pack.shapes[1].color, '#fac015');
assert.equal(pack.shapes[2].tool, 'text');
assert.equal(pack.shapes[2].text, 'Chu xanh');
assert.equal(pack.shapes[2].color, '#a3a3e6');

console.log('kml load color ok', pack.shapes.map(s => [s.tool, s.color]));
