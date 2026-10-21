// Phân loại lô QH: da_co vào hiện trạng, quyết định quản trị ghi đè, lô mới vào cần kiểm tra.
const assert = require('assert');
const qh = require('../services/qhHienTrang');

const pack = qh.normalize({
  v: 1,
  builtAt: '2026-10-21T00:00:00.000Z',
  auto: {
    'YT-108': ['da_co', 'thửa DYT; GBA 46%'],
    'CV-2671': ['can_kiem_tra', 'NDVI 0.56'],
    'CV-1217': ['chua_co', ''],
    'VH-1': ['da_co', 'thửa DVH']
  }
});

const list = [
  { id: 'YT-108', planChange: 'new', size: 0, sizeQH: 66742, sizeHT: null, note: 'Nhập từ file QH' },
  { id: 'CV-2671', planChange: 'new', size: 0, sizeQH: 1000, note: 'Nhập từ file QH' },
  { id: 'CV-1217', planChange: 'new', size: 0, sizeQH: 500, note: 'Nhập từ file QH' },
  { id: 'HT-1', planChange: 'keep', size: 20, sizeQH: 20, sizeHT: 20, note: '' }
];

const applied = qh.apply(list, pack);
assert.strictEqual(applied[0].planChange, 'keep');
assert.strictEqual(applied[0].qhProven, true);
assert.strictEqual(applied[0].size, 66742);
assert.ok(String(applied[0].qhReason).includes('DYT'));
assert.strictEqual(applied[1].planChange, 'new');
assert.strictEqual(applied[2].planChange, 'new');
assert.strictEqual(applied[3], list[3], 'hiện trạng sẵn có không bị sao chép');
assert.strictEqual(list[0].planChange, 'new', 'không sửa bản gốc');

const overridden = qh.mergePack(pack, qh.normalize({
  builtAt: '2026-10-21T00:00:00.000Z',
  overrides: { 'VH-1': { cls: 'chua_co', at: 't', by: 'a@b' } },
  extra: { 'CV-9': ['can_kiem_tra', 'Lô nhập sau lần phân loại không gian. Cần kiểm tra.'] }
}));
assert.strictEqual(qh.effective(overridden, 'VH-1').cls, 'chua_co');
assert.strictEqual(qh.effective(overridden, 'YT-108').cls, 'da_co');
assert.strictEqual(overridden.auto['CV-9'][0], 'can_kiem_tra');
const held = qh.apply([{ id: 'VH-1', planChange: 'new', sizeQH: 10, note: 'Nhập từ file' }], overridden);
assert.strictEqual(held[0].planChange, 'new');

const again = qh.reclassify(pack, [
  ...list,
  { id: 'MN-9', planChange: 'new', note: 'Nhập từ file QH-x.dxf' },
  { id: 'MN-8', planChange: 'new', note: 'Thêm tay' }
]);
assert.strictEqual(again.added, 1);
assert.strictEqual(again.extra['MN-9'][0], 'can_kiem_tra');
assert.ok(!again.extra['MN-8']);
assert.strictEqual(qh.reclassify(pack, list).added, 0);

const rows = qh.reviewRows(overridden, [
  { id: 'CV-2671', name: 'Công viên', type: '1-CV', lat: 1, lng: 2 },
  { id: 'VH-1', name: 'Nhà văn hóa', type: '8-VH', lat: 1, lng: 2 },
  { id: 'YT-108', name: 'Bệnh viện', type: '7-YT', lat: 1, lng: 2 }
]);
assert.deepStrictEqual(rows.map(r => r.id).sort(), ['CV-2671', 'VH-1']);

const bundledNewer = qh.mergePack(
  { ...pack, builtAt: '2026-11-01T00:00:00.000Z', auto: { 'YT-108': ['da_co', 'mới'] } },
  { builtAt: '2026-10-21T00:00:00.000Z', auto: {}, extra: { 'CV-9': ['can_kiem_tra', 'mới'] }, overrides: { 'YT-108': { cls: 'chua_co' } } }
);
assert.strictEqual(bundledNewer.auto['YT-108'][1], 'mới');
assert.strictEqual(qh.effective(bundledNewer, 'YT-108').cls, 'chua_co');
assert.strictEqual(bundledNewer.auto['CV-9'][0], 'can_kiem_tra');

const bundled = qh.normalize(require('../public/data/gba/qh-hientrang.json'));
assert.strictEqual(Object.keys(bundled.auto).length, 6347);
assert.strictEqual(bundled.auto['YT-108'][0], 'da_co');
assert.strictEqual(qh.countClasses(bundled).da_co, 366);
assert.strictEqual(qh.countClasses(bundled).can_kiem_tra, 1654);
assert.strictEqual(qh.countClasses(bundled).chua_co, 4327);

console.log('qh-hientrang ok');
