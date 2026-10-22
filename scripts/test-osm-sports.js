// Lọc trùng công trình thể thao OSM: cùng mã OSM, hoặc cùng tên và gần hơn 80 m.
const assert = require('assert');
const sports = require('../services/osmSports');

function item(over) {
  return {
    type: '8-VH', name: 'Sân bóng A', nhom: 'Cấp DVO', lat: 16.46, lng: 107.58,
    size: 0, ref: 'OSM:way/1', note: 'Nguồn: OSM (OSM:way/1). Loại: Sân thể thao', approved: true,
    ...over
  };
}

const named = item({});
const sameNameNear = item({ ref: 'OSM:way/2', lat: 16.4602, lng: 107.5802 });
const sameNameFar = item({ ref: 'OSM:way/3', name: 'Sân bóng A', lat: 16.47, lng: 107.60 });
const otherNear = item({ ref: 'OSM:way/4', name: 'Sân bóng B', lat: 16.4601, lng: 107.5801 });
const sameRef = item({ ref: 'OSM:way/1', name: 'Tên khác', lat: 16.50, lng: 107.70 });
const genericNear = item({ ref: 'OSM:node/9', name: 'Sân thể thao', lat: 16.46005, lng: 107.58005 });

const existing = [{ name: 'Sân bóng A', lat: 16.46, lng: 107.58, note: 'Nguồn: OSM (OSM:way/1)' }];
const { kept, skipped } = sports.dedupeSports(
  [sameNameNear, sameNameFar, otherNear, sameRef, genericNear],
  existing
);

assert.deepStrictEqual(kept.map(it => it.ref), ['OSM:way/3', 'OSM:way/4']);
const reasons = Object.fromEntries(skipped.map(s => [s.item.ref, s.reason]));
assert.strictEqual(reasons['OSM:way/2'], 'name-distance');
assert.strictEqual(reasons['OSM:way/1'], 'osm-id');
assert.strictEqual(reasons['OSM:node/9'], 'generic-near');

const node = sports.itemFromElement({
  type: 'node', id: 42, lat: 16.463, lon: 107.59,
  tags: { leisure: 'pitch', name: 'Sân không tên', 'addr:street': 'Đường Lê Lợi' }
});
assert.strictEqual(node.type, '8-VH');
assert.strictEqual(node.nhom, 'Cấp DVO');
assert.strictEqual(node.name, 'Sân không tên (Sân thể thao)');
assert.ok(node.note.includes('OSM:node/42'));
assert.ok(node.note.includes('Đường Lê Lợi'));
assert.strictEqual(node.size, 0);

const stadium = sports.itemFromElement({
  type: 'node', id: 7, lat: 16.47, lon: 107.58,
  tags: { leisure: 'stadium', 'name:vi': 'Sân vận động Tự Do' }
});
assert.strictEqual(stadium.nhom, 'Cấp đô thị');
assert.strictEqual(stadium.name, 'Sân vận động Tự Do');

const closed = [
  { lat: 16.46, lon: 107.58 },
  { lat: 16.46, lon: 107.581 },
  { lat: 16.461, lon: 107.581 },
  { lat: 16.461, lon: 107.58 },
  { lat: 16.46, lon: 107.58 }
];
const poly = sports.itemFromElement({ type: 'way', id: 8, tags: { leisure: 'pitch' }, geometry: closed });
assert.ok(poly.size > 5000 && poly.size < 20000, `diện tích ${poly.size}`);
assert.strictEqual(poly.name, 'Sân thể thao');

const abandoned = sports.itemFromElement({
  type: 'node', id: 3, lat: 16.46, lon: 107.58, tags: { leisure: 'pitch', abandoned: 'yes', name: 'Sân cũ' }
});
assert.strictEqual(abandoned, null);

assert.strictEqual(sports.looksLikeSport('Nhà văn hóa thể thao'), false);
assert.strictEqual(sports.looksLikeSport('Bể bơi Thành phố'), true);

const fs = require('fs');
const path = require('path');
const osm = fs.readFileSync(path.join(__dirname, '../public/js/osmOpen.js'), 'utf8');
const roads = fs.readFileSync(path.join(__dirname, '../public/js/qhc2045Layer.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
assert.ok(osm.includes('RAIL_MIN_ZOOM = 11') && osm.includes('phóng tới mức 11'), 'gợi ý zoom đường sắt');
assert.ok(html.includes('id="chk_gt25rail"') && html.includes('id="chk_gt10rail"'), 'công tắc đường sắt QHC');
assert.ok(roads.includes('chk_gt${scale}rail'), 'vẽ đường sắt theo công tắc');

console.log('osm sports: ok');
