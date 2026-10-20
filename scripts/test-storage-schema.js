// Khóa localStorage các bản cũ ghi để ẩn đồ án. Cửa sổ ẩn danh không có khóa nên QHC vẫn đủ.
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
    STORAGE_VERSION, readStorageVersion, parseNameList, migrateHiddenState
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
  assert.strictEqual(readStorageVersion(mem({ qh_storage_version: 'nope' })), 0);

  const migrated = migrateHiddenState(dumped, layers);
  assert.deepStrictEqual(migrated.projects, [QHPK]);
  assert.deepStrictEqual(migrated.layers, [`${QHPK}|ranh-gioi`, 'QHC Khe Tre|su-dung-dat']);

  assert.deepStrictEqual(parseNameList(null), { ok: true, list: [] });
  assert.deepStrictEqual(parseNameList('{"not":"array"}'), { ok: false, list: [] });
  assert.deepStrictEqual(parseNameList('['), { ok: false, list: [] });
  assert.deepStrictEqual(parseNameList(JSON.stringify(dumped)).list.length, dumped.length);

  const stuck = mem({
    qh_hidden_projects: JSON.stringify(dumped),
    qh_hidden_layers: JSON.stringify(layers),
    qh_hidden_kind_fix: '1'
  });
  assert.strictEqual(readStorageVersion(stuck), 1);
  const again = migrateHiddenState(
    parseNameList(stuck.getItem('qh_hidden_projects')).list,
    parseNameList(stuck.getItem('qh_hidden_layers')).list
  );
  assert.deepStrictEqual(again.projects, [QHPK]);
  assert.ok(!again.projects.some(n => n.startsWith('QHC')));
  assert.ok(again.layers.some(k => k.startsWith(`${QHPK}|`)));
  assert.ok(!again.layers.some(k => k.startsWith('QHC ') && k.endsWith('|ranh-gioi')));

  const kept = migrateHiddenState(
    parseNameList(JSON.stringify([QHPK, QHC[0]])).list,
    []
  );
  assert.deepStrictEqual(kept.projects, [QHPK]);
  assert.strictEqual(STORAGE_VERSION, 2);
  console.log('storageSchema: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
