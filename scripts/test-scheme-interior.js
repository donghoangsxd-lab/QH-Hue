// QHC / QHPK / QHCT: có ranh không phải đang mở lô. Tick hoặc đồ án đang chọn mới vẽ nội.
const boxes = new Map();
const el = (id) => {
  if (id && boxes.has(id)) return boxes.get(id);
  const node = {
    checked: false,
    dataset: {},
    style: {},
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {},
    addEventListener() {},
    dispatchEvent() {},
    appendChild() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  if (id) boxes.set(id, node);
  return node;
};
globalThis.L = { layerGroup() { return { addTo() { return this; }, clearLayers() {} }; } };
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.document = {
  getElementById: (id) => el(id),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  dispatchEvent() {},
  createElement: () => el(),
  documentElement: el(),
  body: el()
};

const assert = require('assert');

(async () => {
  const { state } = await import('../public/js/state.js');
  const { setLevel } = await import('../public/js/mapLevel.js');
  const { projectLotsDrawn } = await import('../public/js/projectFiles.js');

  state.showProjects = true;
  state.focusedProject = null;
  state.lotProjects = new Set();
  state.hiddenProjects = new Set();
  state.selectedWard = 'Phường Phú Xuân';
  setLevel('qhpk');
  const qhpk = 'An Tây';
  assert.strictEqual(projectLotsDrawn(qhpk), false, 'QHPK đang chọn phường, chưa tick: không vẽ lô');
  state.lotProjects.add(qhpk);
  assert.strictEqual(projectLotsDrawn(qhpk), true, 'tick QHPK thì vẽ lô');
  state.hiddenProjects.add(qhpk);
  assert.strictEqual(projectLotsDrawn(qhpk), false, 'tắt ranh thì không vẽ lô');
  state.hiddenProjects.clear();
  state.lotProjects.clear();
  state.focusedProject = qhpk;
  assert.strictEqual(projectLotsDrawn(qhpk), true, 'đồ án đang mở thì vẽ lô');

  setLevel('qhct');
  state.focusedProject = null;
  state.lotProjects.clear();
  state.hiddenProjects.clear();
  const qhct = 'QHCT Thủy Thanh';
  assert.strictEqual(projectLotsDrawn(qhct), false, 'QHCT mặc định không vẽ lô');
  state.lotProjects.add(qhct);
  assert.strictEqual(projectLotsDrawn(qhct), true, 'tick QHCT thì vẽ lô');
  assert.strictEqual(projectLotsDrawn(qhpk), false, 'cấp QHCT không kéo lô QHPK');

  setLevel('qhc10');
  state.focusedProject = null;
  state.lotProjects.clear();
  const qhc = 'QHC Chân Mây - Lăng Cô';
  assert.strictEqual(projectLotsDrawn(qhc), false, 'QHC chưa chọn không vẽ lô');
  state.focusedProject = qhc;
  assert.strictEqual(projectLotsDrawn(qhc), true, 'QHC đang chọn thì vẽ lô');
  assert.strictEqual(projectLotsDrawn(qhpk), false, 'QHC không kéo lô QHPK');
  console.log('scheme interior: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
