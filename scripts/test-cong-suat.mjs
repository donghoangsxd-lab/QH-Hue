import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CITY_QHC25_ID, CAPACITY_METRICS, parseCapacity, buildCapacityGraph, indexCapacityRows,
  rollupCheck, checksForScheme, combineChecks, assessCapacityWrite, gateCapacityEntries,
  totalSentence, applyCapacityDoc, capacityView, metricFor, commitCapacityResult, activeRows, clearSchemeDraft
} from '../public/js/congSuat.js';

const root = new URL('..', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, root), 'utf8');
const schemes = JSON.parse(read('public/data/chuyen-nganh/schemes.json')).schemes;
const water = metricFor('cap-nuoc');
const doc = JSON.parse(read('public/data/htkt/cong-suat.json'));

assert.equal(doc.tab, 'CongSuatDoAn');
assert.equal(doc.linkTab, 'CongSuatLienKet');
assert.deepEqual(doc.links, []);
assert.equal(doc.rows.length, 2);
const byNhom = Object.fromEntries(doc.rows.map(row => [row.nhom, row]));
assert.equal(byNhom['cap-nuoc'].maDoAn, CITY_QHC25_ID);
assert.equal(byNhom['cap-nuoc'].cap, 'QHC25');
assert.equal(byNhom['cap-nuoc'].chiTieu, 'cong-suat');
assert.equal(byNhom['cap-nuoc'].giaTri, 600000);
assert.equal(byNhom['cap-nuoc'].donVi, 'm³/ngày đêm');
assert.equal(byNhom['cap-nuoc'].tenChiTieu, 'nhu cầu dùng nước');
assert.equal(byNhom['cap-dien'].giaTri, 3000);
assert.equal(byNhom['cap-dien'].donVi, 'MW');
assert.equal(byNhom['cap-dien'].tenChiTieu, 'tổng nhu cầu cấp điện');
for (const nhom of ['giao-thong', 'san-nen-thoat-mua', 'thoat-nuoc-thai', 'chat-thai-ran-nghia-trang', 'thong-tin-lien-lac']) {
  assert.equal(byNhom[nhom], undefined, nhom);
}
const qd = JSON.parse(read('public/data/htkt/qd-108-htkt.json'));
assert.equal(qd.quyetDinh.so, '108/QĐ-TTg');
assert.equal(qd.quyetDinh.ngay, '2024-01-26');
const tran = Object.fromEntries(qd.tran.map(row => [row.nhom, row]));
assert.equal(tran['cap-nuoc'].trangThai, 'da-dien');
assert.equal(tran['cap-nuoc'].giaTri, byNhom['cap-nuoc'].giaTri);
assert.equal(tran['cap-dien'].giaTri, byNhom['cap-dien'].giaTri);
for (const nhom of ['giao-thong', 'san-nen-thoat-mua', 'thoat-nuoc-thai', 'chat-thai-ran-nghia-trang', 'thong-tin-lien-lac']) {
  assert.equal(tran[nhom].trangThai, 'chua-du-du-lieu');
  assert.equal(tran[nhom].giaTri, null);
}
const nuocQd = qd.soLieu.find(row => row.id === 'cap-nuoc-nhu-cau');
assert.equal(nuocQd.moc.find(row => row.nam === 2030).giaTri, 480000);
assert.equal(nuocQd.moc.find(row => row.nam === 2045).giaTri, 600000);
const thaiQd = qd.soLieu.find(row => row.id === 'thoat-nuoc-thai-luong');
assert.equal(thaiQd.duaVaoTran, false);
assert.equal(thaiQd.moc.find(row => row.nam === 2045).giaTri, 530000);
assert.match(thaiQd.lyDo, /ước tính/);
const ctrQd = qd.soLieu.find(row => row.id === 'chat-thai-ran');
assert.equal(ctrQd.duaVaoTran, false);
assert.equal(ctrQd.moc.find(row => row.nam === 2045).giaTri, 5300);
const moQd = qd.soLieu.find(row => row.id === 'nghia-trang');
assert.equal(moQd.duaVaoTran, false);
assert.equal(moQd.moc.find(row => row.nam === 2045).giaTri, 111);
assert.match(read('docs/templates/cong-suat-do-an.csv'), /^Ma_DoAn,Ten_DoAn,Cap,Nhom_HTKT,ChiTieu,Ten_ChiTieu,DonVi,GiaTri,Nguon,GhiChu/);
assert.match(read('docs/templates/cong-suat-lien-ket.csv'), /^Ma_Con,Ma_Cha,GhiChu/);
assert.equal(CAPACITY_METRICS.length, 7);
assert.deepEqual(CAPACITY_METRICS.map(row => row.sector), [
  'giao-thong', 'cap-nuoc', 'cap-dien', 'san-nen-thoat-mua', 'thoat-nuoc-thai',
  'chat-thai-ran-nghia-trang', 'thong-tin-lien-lac'
]);

assert.equal(parseCapacity(''), null);
assert.equal(parseCapacity('0'), 0);
assert.equal(parseCapacity('1.000,5'), 1000.5);
assert.equal(parseCapacity('10,5'), 10.5);

const graph = buildCapacityGraph(schemes, []);
const city = graph.nodes.get(CITY_QHC25_ID);
assert.equal(city.cap, 'QHC25');
assert.equal(graph.nodes.get('qhc-trung-tam').parent, CITY_QHC25_ID);
assert.equal(graph.nodes.get('qhc-khe-tre').cap, 'QHC10');
assert.equal(graph.nodes.get('qhc-khe-tre').parent, CITY_QHC25_ID);
assert.equal(graph.nodes.get('qhc-xa-thuong-long-3f2c4da4').cap, 'QHC25');
assert.equal(graph.nodes.get('qhc-xa-thuong-long-3f2c4da4').parent, null);
const kcn = graph.nodes.get('qhc-khu-cong-nghiep-phong-dien-f997bd2c');
assert.equal(kcn.cap, 'QHC10');
assert.equal(kcn.parent, CITY_QHC25_ID);
const phuMy = graph.nodes.get('qhct-tdc-phu-my-khu-c-7bfa4d26');
assert.equal(phuMy.cap, 'QHCT');
assert.equal(graph.nodes.get(phuMy.parent).cap, 'QHPK');
assert.equal(graph.nodes.get('qhct-cum-cong-nghiep-binh-thanh-9e1e7dbe').parent, null);
assert.ok(city.children.includes('qhc-trung-tam'));
assert.ok(city.children.includes('qhc-chan-may'));

function row(id, value, unit = 'm³/ngày đêm') {
  return { maDoAn: id, nhom: 'cap-nuoc', chiTieu: 'cong-suat', giaTri: value, donVi: unit };
}

const mini = [
  { slug: 'qhc-hue-2045', name: 'QHC thành phố', cap: 'QHC25', level: 'QHC25' },
  { slug: 'qhc-a', name: 'Đồ án A', cap: 'QHC10', level: 'QHC10' },
  { slug: 'qhc-b', name: 'Đồ án B', cap: 'QHC10', level: 'QHC10' }
];
let g = buildCapacityGraph(mini, []);
let index = indexCapacityRows([row('qhc-hue-2045', 100), row('qhc-a', 40)], g.alias);
let check = rollupCheck({
  title: 'Đối chiếu QHC 1/10.000 với QHC 1/25.000',
  metric: water,
  parent: g.nodes.get(CITY_QHC25_ID),
  children: g.nodes.get(CITY_QHC25_ID).children.map(id => g.nodes.get(id)),
  index
});
assert.equal(check.status, 'thieu');
assert.equal(check.label, 'chưa đủ dữ liệu');
assert.equal(combineChecks([check]).status, 'thieu');

index = indexCapacityRows([row('qhc-hue-2045', 100), row('qhc-a', 70), row('qhc-b', null)], g.alias);
check = rollupCheck({
  title: 'Đối chiếu',
  metric: water,
  parent: g.nodes.get(CITY_QHC25_ID),
  children: g.nodes.get(CITY_QHC25_ID).children.map(id => g.nodes.get(id)),
  index
});
assert.equal(check.status, 'thieu', 'thiếu con dù phần đã biết còn dưới trần');

index = indexCapacityRows([row('qhc-hue-2045', 100), row('qhc-a', 120), row('qhc-b', null)], g.alias);
check = rollupCheck({
  title: 'Đối chiếu',
  metric: water,
  parent: g.nodes.get(CITY_QHC25_ID),
  children: g.nodes.get(CITY_QHC25_ID).children.map(id => g.nodes.get(id)),
  index
});
assert.equal(check.status, 'vuot');
assert.equal(check.delta, 20);
assert.equal(check.missing.length, 1);

index = indexCapacityRows([row('qhc-hue-2045', 100), row('qhc-a', 40), row('qhc-b', 50)], g.alias);
check = rollupCheck({
  title: 'Đối chiếu',
  metric: water,
  parent: g.nodes.get(CITY_QHC25_ID),
  children: g.nodes.get(CITY_QHC25_ID).children.map(id => g.nodes.get(id)),
  index
});
assert.equal(check.status, 'ok');
assert.equal(check.headroom, 10);

index = indexCapacityRows([row('qhc-hue-2045', 100, 'm³/ngày đêm'), row('qhc-a', 40, 'm³/ngày'), row('qhc-b', 10, 'm³/ngày đêm')], g.alias);
check = rollupCheck({
  title: 'Đối chiếu',
  metric: water,
  parent: g.nodes.get(CITY_QHC25_ID),
  children: g.nodes.get(CITY_QHC25_ID).children.map(id => g.nodes.get(id)),
  index
});
assert.equal(check.status, 'thieu');
assert.equal(check.reason, 'don-vi');

const chain = [
  { slug: 'qhc-hue-2045', name: 'QHC thành phố', cap: 'QHC25', level: 'QHC25' },
  { slug: 'qhc-a', name: 'Đồ án A', cap: 'QHC10', level: 'QHC10' },
  { slug: 'qhpk-a', name: 'Phân khu A', cap: 'QHPK', level: 'QHPK', parent: 'qhc-a' },
  { slug: 'qhct-a', name: 'Chi tiết A', cap: 'QHCT', level: 'QHCT', parent: 'qhpk-a' }
];
const filled = [
  row('qhc-hue-2045', 100),
  row('qhc-a', 40),
  row('qhpk-a', 40),
  row('qhct-a', 10)
];
applyCapacityDoc({ rows: filled, links: [] }, { schemes: chain });
let gate = assessCapacityWrite({
  schemeId: 'qhct-a',
  schemeName: 'Chi tiết A',
  cap: 'QHCT',
  parentId: 'qhpk-a',
  sector: 'cap-nuoc',
  giaTri: 15,
  donVi: 'm³/ngày đêm',
  schemes: chain,
  rows: filled
});
assert.equal(gate.accept, true);
assert.equal(gate.status, 'ok');
assert.match(totalSentence('Đồ án A', water, 40, 'm³/ngày đêm'), /Tổng công suất cấp nước của đồ án Đồ án A: 40 m³\/ngày đêm/);

gate = assessCapacityWrite({
  schemeId: 'qhct-moi',
  schemeName: 'QHCT mới',
  cap: 'QHCT',
  parentId: 'qhpk-a',
  sector: 'cap-nuoc',
  giaTri: 35,
  donVi: 'm³/ngày đêm',
  schemes: chain,
  rows: filled
});
assert.equal(gate.accept, false);
assert.equal(gate.status, 'vuot');
assert.match(gate.sentences.join(' '), /vượt/);
assert.match(gate.sentences.join(' '), /Phân khu A/);
assert.equal(gate.link.parent, 'qhpk-a');

gate = assessCapacityWrite({
  schemeId: 'qhct-moi',
  schemeName: 'QHCT mới',
  cap: 'QHCT',
  parentId: 'qhc-a',
  sector: 'cap-nuoc',
  giaTri: 5,
  donVi: 'm³/ngày đêm',
  schemes: chain,
  rows: filled
});
assert.equal(gate.accept, false);
assert.match(gate.sentences.join(' '), /QHPK 1\/2\.000/);

gate = assessCapacityWrite({
  schemeId: 'qhct-le',
  schemeName: 'QHCT lẻ',
  cap: 'QHCT',
  parentId: '',
  sector: 'cap-nuoc',
  giaTri: 5,
  donVi: 'm³/ngày đêm',
  schemes: chain,
  rows: filled
});
assert.equal(gate.accept, true);
assert.equal(gate.status, 'thieu');
assert.match(gate.sentences.join(' '), /chưa đủ dữ liệu/);

gate = assessCapacityWrite({
  schemeId: 'qhc-moi',
  schemeName: 'QHC mới',
  cap: 'QHC10',
  sector: 'cap-nuoc',
  giaTri: 70,
  donVi: 'm³/ngày đêm',
  schemes: chain,
  rows: filled
});
assert.equal(gate.accept, false, 'QHC mới làm tổng 1/10.000 vượt trần thành phố');
assert.equal(gate.link.parent, CITY_QHC25_ID);

const many = gateCapacityEntries([
  { schemeId: 'qhct-moi', schemeName: 'QHCT mới', cap: 'QHCT', parentId: 'qhpk-a', sector: 'cap-nuoc', giaTri: '4', donVi: 'm³/ngày đêm' },
  { schemeId: 'qhct-moi', schemeName: 'QHCT mới', cap: 'QHCT', parentId: 'qhpk-a', sector: 'cap-dien', giaTri: '', donVi: '' }
]);
assert.equal(many.accept, true);
assert.equal(many.results.length, 2);
assert.equal(many.status, 'thieu');

clearSchemeDraft('qhct-a');
const saved = assessCapacityWrite({
  schemeId: 'qhct-a',
  schemeName: 'Chi tiết A',
  cap: 'QHCT',
  parentId: 'qhpk-a',
  sector: 'cap-nuoc',
  giaTri: 12,
  donVi: 'm³/ngày đêm',
  schemes: chain,
  rows: filled
});
assert.equal(commitCapacityResult(saved, {
  schemeId: 'qhct-a', schemeName: 'Chi tiết A', cap: 'QHCT', sector: 'cap-nuoc', giaTri: 12, donVi: 'm³/ngày đêm'
}), true);
assert.equal(activeRows().some(row => row.maDoAn === 'qhct-a' && row.giaTri === 12), true);
const refused = assessCapacityWrite({
  schemeId: 'qhct-a',
  cap: 'QHCT',
  parentId: 'qhpk-a',
  sector: 'cap-nuoc',
  giaTri: 99,
  donVi: 'm³/ngày đêm',
  schemes: chain,
  rows: activeRows()
});
assert.equal(refused.accept, false);
assert.equal(commitCapacityResult(refused, { schemeId: 'qhct-a', sector: 'cap-nuoc', giaTri: 99 }), false);
assert.equal(activeRows().some(row => row.giaTri === 99), false);

const local = checksForScheme('qhc-xa-thuong-long-3f2c4da4', graph, indexCapacityRows([], graph.alias), water);
assert.equal(local[0].reason, 'khong-phai-tran');
assert.equal(combineChecks(local).label, 'chưa đủ dữ liệu');

applyCapacityDoc(doc, { schemes });
const view = capacityView(CITY_QHC25_ID, ['cap-nuoc', 'cap-dien', 'thoat-nuoc-thai'], 'QHC đô thị Thừa Thiên Huế 1/25.000');
const waterBlock = view.blocks.find(block => block.metric.sector === 'cap-nuoc');
assert.equal(waterBlock.value, 600000);
assert.match(waterBlock.sentence, /600\.000 m³\/ngày đêm \(nhu cầu dùng nước\)/);
const powerBlock = view.blocks.find(block => block.metric.sector === 'cap-dien');
assert.equal(powerBlock.value, 3000);
assert.match(powerBlock.sentence, /3\.000 MW \(tổng nhu cầu cấp điện\)/);
const wasteBlock = view.blocks.find(block => block.metric.sector === 'thoat-nuoc-thai');
assert.equal(wasteBlock.value, null);
assert.match(wasteBlock.sentence, /chưa có số/);
assert.equal(wasteBlock.label, 'chưa đủ dữ liệu');

console.log('cong suat ok');
