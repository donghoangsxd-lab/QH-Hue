// Kiểm tra sổ thửa: mã đất, tên, gộp thửa, trùng, và từ chối dòng thiếu diện tích / phường / tên.
const assert = require('assert');
const inv = require('../services/parcelInfraInventory');

assert.deepStrictEqual(inv.parseLandCodes('ODT+DGD'), ['DGD']);
assert.deepStrictEqual(inv.parseLandCodes(' dgd '), ['DGD']);
assert.deepStrictEqual(inv.parseLandCodes('dyt+dgd'), ['DYT', 'DGD']);
assert.strictEqual(inv.primaryCode('ODT+DGD'), 'DGD');
assert.strictEqual(inv.primaryCode(' DYT '), 'DYT');
assert.strictEqual(inv.primaryCode('ODT'), '');

function square(lng, lat, d) {
  return [[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]];
}

function parcel(over) {
  return {
    key: '1|1|1', maxa: '19990', to: '1', thua: '1', codeRaw: 'DGD',
    lat: 16.4601, lng: 107.5801, attrArea: 400, geomArea: 400,
    ring: square(107.58, 16.46, 0.0002),
    ward: 'Phường Thuận Hóa',
    ...over
  };
}

const unnamed = inv.assembleInventory([parcel({})], { existing: [] });
assert.strictEqual(unnamed.rows.length, 1);
assert.strictEqual(unnamed.rows[0].name, 'Trường học chưa xác định tên – Phường Thuận Hóa');
assert.strictEqual(unnamed.rows[0].confidence, 'chua-ten');
assert.strictEqual(unnamed.rows[0].review, true);
assert.strictEqual(unnamed.rows[0].approved, false);
assert.strictEqual(unnamed.rows[0].ward, 'Phường Thuận Hóa');
assert.ok(unnamed.rows[0].areaM2 > 0);
assert.ok(Number(unnamed.rows[0].areaHa) > 0);
assert.ok(unnamed.rows[0].size > 0);
assert.strictEqual(unnamed.stats.validation.ok, true);
assert.strictEqual(unnamed.stats.validation.missingArea, 0);
assert.strictEqual(unnamed.stats.validation.missingWard, 0);
assert.strictEqual(unnamed.stats.validation.missingName, 0);

const attr = inv.assembleInventory([parcel({
  props: { tenchu: 'Trường Tiểu học ABC' }, diachi: 'Số 12 Lê Lợi'
})], { existing: [] });
assert.strictEqual(attr.rows[0].name, 'Trường Tiểu học ABC');
assert.strictEqual(attr.rows[0].confidence, 'ten-thuoc-tinh');
assert.strictEqual(attr.rows[0].type, '4-TH');
assert.strictEqual(attr.rows[0].approved, true);

const addressOnly = inv.assembleInventory([parcel({ diachi: 'Số 12 Lê Lợi' })], { existing: [] });
assert.strictEqual(addressOnly.rows[0].confidence, 'chua-ten');
assert.ok(addressOnly.rows[0].name.includes('Phường Thuận Hóa'));

const mam = inv.assembleInventory([parcel({ diachi: 'Trường mầm non Hoa Sen' })], { existing: [] });
assert.strictEqual(mam.rows[0].type, '3-MN');
assert.strictEqual(mam.rows[0].name, 'Trường mầm non Hoa Sen');

const places = inv.assembleInventory([parcel({
  placesName: 'Trường Tiểu học Google'
})], { existing: [] });
assert.strictEqual(places.rows[0].confidence, 'ten-google');
assert.strictEqual(places.rows[0].name, 'Trường Tiểu học Google');

const osmNamed = {
  ref: 'OSM:way/9', name: 'Trường THPT Chuyên', lat: 16.4601, lng: 107.5801,
  tags: { amenity: 'school' }
};
const byOsm = inv.assembleInventory([parcel({
  props: { tenchu: 'Tên trên thửa' }, osm: osmNamed
})], { existing: [] });
assert.strictEqual(byOsm.rows[0].name, 'Trường THPT Chuyên');
assert.strictEqual(byOsm.rows[0].confidence, 'ten-osm');
assert.strictEqual(byOsm.rows[0].type, '6-THPT');
assert.strictEqual(byOsm.rows[0].nhom, 'Cấp đô thị');

const d = 0.0002;
const merged = inv.assembleInventory([
  parcel({ key: 'a', thua: '1', geomArea: 400, areaM2: 400, lat: 16.4601, lng: 107.5801, ring: square(107.58, 16.46, d) }),
  parcel({ key: 'b', thua: '2', geomArea: 500, attrArea: 500, lat: 16.4601, lng: 107.5803, ring: square(107.58 + d, 16.46, d) })
], { existing: [] });
assert.strictEqual(merged.rows.length, 1);
assert.strictEqual(merged.rows[0].areaM2, 900);
assert.strictEqual(merged.rows[0].memberCount, 2);
assert.ok(Number(merged.rows[0].areaHa) > 0);

const splitOsm = inv.assembleInventory([
  parcel({
    thua: '1', geomArea: 400,
    osm: { ref: 'OSM:way/1', name: 'Trường Tiểu học Một', lat: 16.4601, lng: 107.5801, tags: { amenity: 'school' } },
    ring: square(107.58, 16.46, d)
  }),
  parcel({
    thua: '2', geomArea: 500, attrArea: 500, lat: 16.4601, lng: 107.5803,
    osm: { ref: 'OSM:way/2', name: 'Trường Tiểu học Hai', lat: 16.4601, lng: 107.5803, tags: { amenity: 'school' } },
    ring: square(107.58 + d, 16.46, d)
  })
], { existing: [] });
assert.strictEqual(splitOsm.rows.length, 2);
assert.deepStrictEqual(splitOsm.rows.map(r => r.name).sort(), ['Trường Tiểu học Hai', 'Trường Tiểu học Một']);

const inside = inv.assembleInventory([parcel({
  props: { tenchu: 'Trường Tiểu học ABC' }
})], {
  existing: [{ name: 'Trường khác', lat: 16.4601, lng: 107.5801, type: '4-TH', note: '' }]
});
assert.strictEqual(inside.rows.length, 0);
assert.strictEqual(inside.stats.duplicatesSkipped, 1);

const near = inv.assembleInventory([parcel({
  props: { tenchu: 'Trường Tiểu học ABC' },
  ring: square(107.58, 16.46, d)
})], {
  existing: [{ name: 'Trường Tiểu học ABC', lat: 16.460362, lng: 107.5801, type: '4-TH', note: '' }]
});
assert.strictEqual(near.rows.length, 0);
assert.strictEqual(near.stats.duplicatesSkipped, 1);

const unnamedNear = inv.assembleInventory([parcel({
  ring: square(107.58, 16.46, d)
})], {
  existing: [{ name: 'Trường Tiểu học XYZ', lat: 16.460362, lng: 107.5801, type: '4-TH', note: '' }]
});
assert.strictEqual(unnamedNear.rows.length, 1);
assert.strictEqual(unnamedNear.stats.duplicatesSkipped, 0);

const outside = inv.assembleInventory([parcel({ ward: '' })], { existing: [] });
assert.strictEqual(outside.rows.length, 0);
assert.strictEqual(outside.stats.outsideWard, 1);
assert.strictEqual(outside.stats.validation.ok, true);

const noArea = inv.assembleInventory([parcel({ geomArea: 0, attrArea: 0 })], { existing: [] });
assert.strictEqual(noArea.rows.length, 0);
assert.strictEqual(noArea.stats.missingAreaExcluded, 1);

assert.throws(() => inv.validateRows([{ name: '', ward: 'Phường A', areaM2: 12, areaHa: '0.0012', size: 12 }]), /thiếu tên/);
assert.throws(() => inv.validateRows([{ name: 'A', ward: '', areaM2: 12, areaHa: '0.0012', size: 12 }]), /phường/);
assert.throws(() => inv.validateRows([{ name: 'A', ward: 'Phường A', areaM2: 0, areaHa: '', size: 0 }]), /diện tích/);

const partial = inv.chooseArea({ geomArea: 100, attrArea: 1000 });
assert.strictEqual(partial.source, 'attribute-fallback');
assert.strictEqual(partial.areaM2, 1000);
const geomOk = inv.chooseArea({ geomArea: 900, attrArea: 1000 });
assert.strictEqual(geomOk.source, 'geometry');
assert.strictEqual(geomOk.areaM2, 900);

assert.strictEqual(inv.pickPlacesName([{ name: 'Quán cà phê', types: ['cafe'] }, { name: 'Trường A', types: ['school'] }], 'DGD'), 'Trường A');
assert.strictEqual(inv.pickPlacesName([{ name: 'Quán cà phê', types: ['cafe'] }], 'DGD'), '');

const poi = inv.poiFromElement({
  type: 'node', id: 7, lat: 16.4601, lon: 107.5801, tags: { amenity: 'school', name: 'Trường Node' }
});
const idx = inv.buildPoiIndex([poi]);
const hit = inv.bestOsmMatch(parcel({ code: 'DGD' }), idx);
assert.strictEqual(hit.ref, 'OSM:way/7'.replace('way', 'node') && hit.ref, 'OSM:node/7');
assert.strictEqual(hit.name, 'Trường Node');

const training = inv.assembleInventory([parcel({
  props: { tenchu: 'Đại học Khoa học' }
})], { existing: [] });
assert.strictEqual(training.rows.length, 0);
assert.strictEqual(training.training.length, 1);
assert.strictEqual(training.training[0].training, true);
assert.strictEqual(training.training[0].approved, false);
assert.ok(training.training[0].name.includes('Đại học'));

assert.throws(() => inv.prepareParcelImport([
  { type: '4-TH', name: '', ward: 'Phường A', size: 10, areaHa: '0.0010', lat: 16.46, lng: 107.58, ref: 'THUA:1/1/1', code: 'DGD' }
], [], null), /thiếu tên/);

const imported = inv.prepareParcelImport([
  { type: '4-TH', name: 'Trường Tiểu học ABC', ward: 'Thuận Hóa', size: 800, areaM2: 800, areaHa: '0.0800', lat: 16.46, lng: 107.58, ref: 'THUA:1/1/1', code: 'DGD', training: false, confidence: 'ten-thuoc-tinh' }
], [], () => 'Phường Thuận Hóa');
assert.strictEqual(imported.accepted.length, 1);
assert.strictEqual(imported.accepted[0].ward, 'Phường Thuận Hóa');
assert.strictEqual(imported.accepted[0].keepWard, true);
assert.strictEqual(imported.stats.validation.missingName, 0);

console.log('test-parcel-infra: ok');
