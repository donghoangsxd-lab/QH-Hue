import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  htktDropSvg, htktPointLook, htktSectorLook, htktWaterStatusDrop, DROP_PATH
} from '../public/js/htktMarkers.js';

assert.match(DROP_PATH, /^M35 2C/);

const water = htktSectorLook('cap-nuoc');
assert.equal(water.glyph, 'water');
assert.equal(water.fill, '#0369a1');

const bolt = htktSectorLook('cap-dien');
assert.equal(bolt.glyph, 'bolt');

const look = htktPointLook(
  { sector: 'cap-nuoc', name: 'Công trình đầu mối cấp nước', file: 'cong-trinh-dau-moi-cap-nuoc.geojson' },
  {},
  { fill: '#d97706', radius: 7 }
);
assert.equal(look.glyph, 'water');
assert.equal(look.fill, '#d97706');
assert.ok(look.scale >= 1);

const energy = htktPointLook(
  { sector: 'cap-dien', name: 'Công trình năng lượng', file: 'cong-trinh-nang-luong.geojson' },
  { nhom: 'nang-luong' }
);
assert.equal(energy.glyph, 'energy');

const hydrant = htktPointLook(
  { sector: 'cap-nuoc', name: 'Họng cứu hỏa', file: 'hong-cuu-hoa.geojson' },
  {}
);
assert.equal(hydrant.glyph, 'hydrant');
assert.equal(hydrant.fill, '#dc2626');

const svg = htktDropSvg(water, 'htkt-drop');
assert.match(svg, /viewBox="0 0 70 96"/);
assert.match(svg, /#0369a1/);
assert.match(svg, /htkt-drop/);

const status = htktWaterStatusDrop('xay-moi');
assert.match(status, /#d97706/);

const cn = fs.readFileSync(new URL('../public/js/chuyenNganh.js', import.meta.url), 'utf8');
assert.match(cn, /htktPointIcon/);
assert.match(cn, /L\.marker\(latlng/);
assert.doesNotMatch(
  cn.slice(cn.indexOf('pointToLayer:'), cn.indexOf('onEachFeature:')),
  /circleMarker/
);

const css = fs.readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8');
assert.match(css, /\.htkt-pin/);
assert.match(css, /\.htkt-legend-drop/);

console.log('htkt markers ok');
