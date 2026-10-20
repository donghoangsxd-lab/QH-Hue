// Nguồn sự thật «đồ án đang bật của một cấp»: bỏ chọn hoặc tắt lớp ranh thì không còn trong danh sách.
const assert = require('assert');

(async () => {
  const { enabledSchemes } = await import('../public/js/schemeVisibility.js');
  const list = [
    { name: 'QHC Chân Mây - Lăng Cô', level: 'QHC', boundary: { type: 'Polygon' } },
    { name: 'QHC Đô thị Phong Điền đến năm 2030 tầm nhìn đến năm 2045', level: 'QHC', boundary: { type: 'Polygon' } },
    { name: 'QHC Khe Tre', level: 'QHC', boundary: { type: 'Polygon' } },
    { name: 'QHC chưa có ranh', level: 'QHC', boundary: null },
    { name: 'QHPK Thanh Toàn', level: 'QHPK', boundary: { type: 'Polygon' } },
    { name: 'QHCT Thủy Thanh', level: 'QHCT', boundary: { type: 'Polygon' } }
  ];
  const names = (rows) => rows.map(p => p.name).sort();

  assert.deepStrictEqual(
    names(enabledSchemes(list, 'QHC', new Set(), new Set())),
    ['QHC Chân Mây - Lăng Cô', 'QHC Khe Tre', 'QHC Đô thị Phong Điền đến năm 2030 tầm nhìn đến năm 2045'].sort()
  );
  assert.deepStrictEqual(
    names(enabledSchemes(list, 'QHC', new Set(['QHC Chân Mây - Lăng Cô']), new Set())),
    ['QHC Khe Tre', 'QHC Đô thị Phong Điền đến năm 2030 tầm nhìn đến năm 2045'].sort()
  );
  assert.deepStrictEqual(
    names(enabledSchemes(list, 'QHC', new Set(), new Set(['QHC Khe Tre']))),
    ['QHC Chân Mây - Lăng Cô', 'QHC Đô thị Phong Điền đến năm 2030 tầm nhìn đến năm 2045'].sort()
  );
  assert.deepStrictEqual(names(enabledSchemes(list, 'QHPK', new Set(), new Set())), ['QHPK Thanh Toàn']);
  assert.deepStrictEqual(names(enabledSchemes(list, 'QHCT', new Set(), new Set())), ['QHCT Thủy Thanh']);
  assert.deepStrictEqual(enabledSchemes(list, null, new Set(), new Set()), []);
  assert.deepStrictEqual(enabledSchemes(null, 'QHC', [], []), []);
  console.log('schemeVisibility: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
