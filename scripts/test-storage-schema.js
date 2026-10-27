// Khóa localStorage các bản cũ ghi để ẩn đồ án. Phiên 3 không còn khôi phục danh sách ẩn.
// enableMaster trước 2f84d44 ghi mọi Ten_QH chưa hiện vào qh_hidden_projects.
// 2f84d44 thêm qh_hidden_kind_fix='1' chỉ lọc một lần; máy đã có cờ thì tên QHC còn lại không bị bỏ.
const assert = require('assert');

const QHC = [
  'QHC Chân Mây - Lăng Cô',
  'QHC Đô thị Phong Điền đến năm 2030 tầm nhìn đến năm 2045',
  'QHC đô thị mới Vinh Hưng',
  'QHC Khe Tre'
];
const QHPK = 'QHPK Thanh Toàn';
const QHCT = 'QHCT Thủy Thanh';

function mem(init) {
  const box = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (box.has(k) ? box.get(k) : null),
    setItem: (k, v) => box.set(k, String(v)),
    removeItem: (k) => box.delete(k)
  };
}

(async () => {
  const {
    STORAGE_VERSION, readStorageVersion, parseNameList, migrateHiddenState,
    durableLayerKeys, isBoundaryLayerKey, HIDDEN_PROJECTS_KEY
  } = await import('../public/js/storageSchema.js');

  const dumped = [...QHC, QHPK, QHCT];
  const layers = [
    'QHC Chân Mây - Lăng Cô|ranh-gioi',
    `${QHPK}|ranh-gioi`,
    'QHC Khe Tre|su-dung-dat'
  ];

  assert.strictEqual(readStorageVersion(mem({})), 0);
  assert.strictEqual(readStorageVersion(mem({ qh_hidden_kind_fix: '1' })), 1);
  assert.strictEqual(readStorageVersion(mem({ qh_storage_version: '2', qh_hidden_kind_fix: '1' })), 2);
  assert.strictEqual(readStorageVersion(mem({ qh_storage_version: '3' })), 3);
  assert.strictEqual(readStorageVersion(mem({ qh_storage_version: 'nope' })), 0);

  const migrated = migrateHiddenState(dumped, layers);
  assert.deepStrictEqual(migrated.projects, [QHPK]);
  assert.deepStrictEqual(migrated.layers, [`${QHPK}|ranh-gioi`, 'QHC Khe Tre|su-dung-dat']);

  assert.deepStrictEqual(parseNameList(null), { ok: true, list: [] });
  assert.deepStrictEqual(parseNameList('{"not":"array"}'), { ok: false, list: [] });
  assert.deepStrictEqual(parseNameList('['), { ok: false, list: [] });
  assert.deepStrictEqual(parseNameList(JSON.stringify(dumped)).list.length, dumped.length);

  assert.ok(isBoundaryLayerKey(`${QHPK}|ranh-gioi`));
  assert.ok(!isBoundaryLayerKey('QHC Khe Tre|su-dung-dat'));
  const durable = durableLayerKeys(JSON.stringify(layers));
  assert.deepStrictEqual(durable.list, ['QHC Khe Tre|su-dung-dat']);
  assert.deepStrictEqual(durableLayerKeys('['), { ok: false, list: [] });

  assert.strictEqual(HIDDEN_PROJECTS_KEY, 'qh_hidden_projects');
  assert.strictEqual(STORAGE_VERSION, 3);
  console.log('storageSchema: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
