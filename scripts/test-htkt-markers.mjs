import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  htktDropSvg, htktPointLook, htktSectorLook, htktWaterStatusDrop, htktTt16Svg,
  gtTt16Kind, DROP_PATH
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

const gtLayer = {
  sector: 'giao-thong',
  name: 'Công trình đầu mối giao thông',
  file: 'cong-trinh-dau-moi-giao-thong.geojson',
  kind: 'quy-hoach'
};

// TT16 — không dùng giọt nước / icon tự chế cho loại có trong phụ lục.
assert.equal(gtTt16Kind(gtLayer, { loaicongtrinh: '2', tencongtrinh: 'Bến xe phía Nam' }), 'benxe');
assert.equal(gtTt16Kind(gtLayer, { loaicongtrinh: '2', tencongtrinh: 'Bến xe tải container' }), 'benxe_tai');
assert.equal(gtTt16Kind(gtLayer, { loaicongtrinh: '4', tencongtrinh: 'Bãi đỗ xe P15' }), 'parking');
assert.equal(gtTt16Kind(gtLayer, { loaicongtrinh: '18', tencongtrinh: 'Cây xăng' }), 'tramxang');
assert.equal(gtTt16Kind(gtLayer, { tencongtrinh: 'Hầm đường bộ Hải Vân' }), 'tuynen');
assert.equal(gtTt16Kind(gtLayer, { loaicongtrinh: '1', tencongtrinh: 'Ga Huế' }), 'ga');
assert.equal(gtTt16Kind(gtLayer, { loaicongtrinh: '1', tencongtrinh: 'Ga tàu điện ngầm' }), 'ga_ngam');
assert.equal(gtTt16Kind(gtLayer, { loaicongtrinh: '10', tencongtrinh: 'Cảng Chân Mây' }), 'bencang_1');
assert.equal(gtTt16Kind(gtLayer, { loaicongtrinh: '11', tencongtrinh: 'Cảng hành khách' }), 'bencang_2');
assert.equal(gtTt16Kind(gtLayer, { loaicongtrinh: '13', tencongtrinh: 'Cảng cạn Phú Lộc' }), 'bencang_cangcan');
assert.equal(gtTt16Kind(gtLayer, { loaicongtrinh: '15', tencongtrinh: 'Bến thuyền Đông Ba' }), 'bencang_pha');
// Không có ký hiệu điểm TT16 → không gán icon tự chế.
assert.equal(gtTt16Kind(gtLayer, { loaicongtrinh: '17', tencongtrinh: 'Nút giao đồng mức' }), '');
assert.equal(gtTt16Kind(gtLayer, { loaicongtrinh: '8', tencongtrinh: 'Cảng hàng không Phú Bài' }), '');
assert.equal(gtTt16Kind(gtLayer, { loaicongtrinh: '19', tencongtrinh: 'Cửa khẩu A Đớt' }), '');

const parking = htktPointLook(gtLayer, { loaicongtrinh: '4', tencongtrinh: 'Bãi đỗ xe P15' });
assert.equal(parking.tt16, 'parking');
assert.equal(parking.fill, '#1a1a1a');
assert.equal(parking.dashed, true);

const benxe = htktPointLook(
  { ...gtLayer, kind: 'hien-trang' },
  { loaicongtrinh: '2', tencongtrinh: 'Bến xe' }
);
assert.equal(benxe.tt16, 'benxe');
assert.equal(benxe.dashed, false);

const port = htktPointLook(gtLayer, { loaicongtrinh: '10', tencongtrinh: 'Cảng Thuận An' });
assert.equal(port.tt16, 'bencang_1');
assert.equal(port.fill, '#0000ff');
assert.match(htktTt16Svg(port.tt16), /<circle /);
assert.match(htktTt16Svg(port.tt16), />1</);

const dry = htktTt16Svg('bencang_cangcan');
assert.match(dry, /<rect /);
assert.match(dry, /M3\.5 16h25/);

const pha = htktTt16Svg('bencang_pha');
assert.match(pha, /M16 3\.5 28\.5 16 16 28\.5 3\.5 16Z/);

const svg = htktDropSvg(water, 'htkt-drop');
assert.match(svg, /viewBox="0 0 70 96"/);
assert.match(svg, /#0369a1/);
assert.match(svg, /htkt-drop/);

const status = htktWaterStatusDrop('xay-moi');
assert.match(status, /#d97706/);

const markersSrc = fs.readFileSync(new URL('../public/js/htktMarkers.js', import.meta.url), 'utf8');
assert.match(markersSrc, /HTKT_GT_Benxe/);
assert.match(markersSrc, /HTKT_GT_Tramxang/);
assert.match(markersSrc, /HTKT_GT_Bencang/);
assert.match(markersSrc, /gtTt16Kind/);
assert.doesNotMatch(markersSrc, /Thuyền buồm/);

const cn = fs.readFileSync(new URL('../public/js/chuyenNganh.js', import.meta.url), 'utf8');
assert.match(cn, /htktPointIcon/);
assert.match(cn, /L\.marker\(latlng/);
assert.doesNotMatch(
  cn.slice(cn.indexOf('pointToLayer:'), cn.indexOf('onEachFeature:')),
  /circleMarker/
);
assert.match(cn, /TT16_GT_LINE/);
assert.match(cn, /tim-duong[\s\S]*#ff0000/);
assert.match(cn, /long-duong[\s\S]*#1a1a1a/);
assert.match(cn, /he-duong[\s\S]*#0000ff/);
assert.match(cn, /gtRoadRole/);
assert.match(cn, /featureStyle\(/);

const css = fs.readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8');
assert.match(css, /\.htkt-pin/);
assert.match(css, /\.htkt-legend-drop/);
assert.match(css, /\.htkt-tt16/);

console.log('htkt markers ok');
