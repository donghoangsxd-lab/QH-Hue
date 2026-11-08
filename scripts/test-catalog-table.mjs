import assert from 'assert';
import {
  planRowsFromCatalog, planRowsFromSoTay, investRowsFromItems, filterCatalogRows,
  filterKeyFromMapLevel, rowsToCsv, catalogFilterOptions, catalogStatusStats
} from '../public/js/catalogTableCore.js';
import { nameScore, areaScore, classifyPlanStatus, foldPlanName } from '../public/js/soTayMatch.js';

assert.equal(filterKeyFromMapLevel('qhpk'), 'QHPK');
assert.equal(filterKeyFromMapLevel('qhct'), 'QHCT');
assert.equal(filterKeyFromMapLevel('qhc25'), 'QHC');
assert.equal(filterKeyFromMapLevel('urban'), '');

assert.ok(foldPlanName('QHPK phường Hương Hồ').includes('huong'));
assert.ok(nameScore('QHPK phường Hương Hồ', 'QHPK phường Hương Hồ') >= 0.99);
assert.ok(nameScore('QHCTXD (tỷ lệ 1/2000) Đàn Nam Giao', 'QHCT Đàn Nam Giao và vùng phụ cận') >= 0.55);
assert.equal(areaScore(170, 170), 1);
assert.ok(areaScore(170, 200) < 1);

const sheet = [
  {
    ma: 'TH.B.001',
    ten: 'QHCTXD (tỷ lệ 1/2000) Đàn Nam Giao và vùng phụ cận',
    cap: 'QHPK',
    dvhc: 'Quận Thuận Hóa',
    dienTichHa: 170,
    dienTichText: '170,00',
    quyetDinh: '23/QĐ-UBND',
    linkGis: 'http://example',
    soDccb: 6
  },
  {
    ma: 'TH.B.099',
    ten: 'QHPK khu vực chưa lên bản đồ XYZ',
    cap: 'QHPK',
    dvhc: 'Quận Thuận Hóa',
    dienTichHa: 12,
    dienTichText: '12,00',
    quyetDinh: '1/QĐ',
    linkGis: '',
    soDccb: 0
  }
];
const catalog = [
  {
    tenQH: 'QHCT Đàn Nam Giao và vùng phụ cận',
    wards: ['Thuận Hóa'],
    boundary: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    decision: { name: '23/QĐ-UBND' }
  },
  {
    tenQH: 'QHPK chỉ trên bản đồ ABC',
    wards: ['An Cựu'],
    boundary: null,
    legacy: true
  }
];

const merged = planRowsFromSoTay(sheet, catalog, {
  areaHaOf: (p) => (p.tenQH.includes('Nam Giao') ? 170 : null)
});
assert.ok(merged.length >= 3);
const nam = merged.find((r) => r.maDoAn === 'TH.B.001');
assert.ok(nam);
assert.equal(nam.status, 'du');
assert.ok(nam.hasBoundary);
const missingMap = merged.find((r) => r.maDoAn === 'TH.B.099');
assert.equal(missingMap.status, 'chi_so_tay');
const orphan = merged.find((r) => /ABC/.test(r.name));
assert.ok(orphan);
assert.equal(orphan.status, 'chi_ban_do');

const thieu = classifyPlanStatus(sheet[0], { project: catalog[0] }, false);
assert.equal(thieu.status, 'thieu');

const plans = planRowsFromCatalog([
  { tenQH: 'QHPK khu A', wards: ['Thuận Hóa'], boundary: { type: 'Polygon', coordinates: [] }, decision: { name: 'QĐ 1' } },
  { tenQH: 'QHCT lô B', wards: ['An Cựu'], boundary: null, legacy: true }
]);
assert.equal(plans.length, 2);
assert.equal(filterCatalogRows(plans, { level: 'QHPK' }).length, 1);
assert.equal(filterCatalogRows(merged, { status: 'chi_so_tay' }).length, 1);

const invest = investRowsFromItems([
  { id: 'a', title: 'Dự án X', sheet: { 'Địa điểm': 'Phường Đúc', 'Lĩnh vực': 'Du lịch' }, hasBoundary: true, areaText: '12 ha', dtGroup: 'dvtm' },
  { id: 'b', title: 'Dự án Y', sheet: null, hasBoundary: false, sheetOnly: true, areaText: '', dtGroup: 'khac' }
]);
assert.equal(invest.length, 2);
assert.equal(filterCatalogRows(invest, { level: 'dvtm' }).length, 1);

const csv = rowsToCsv(filterCatalogRows(merged, {}), 'plan');
assert.match(csv, /Tên quy hoạch/);
assert.match(csv, /Trạng thái/);
assert.match(csv, /Đàn Nam Giao/);

const stats = catalogStatusStats(merged);
assert.ok(stats.total >= 3);
assert.ok(stats.byStatus.du >= 1);

assert.ok(catalogFilterOptions('plan').some(o => o.value === 'QHPK'));
assert.ok(catalogFilterOptions('invest').some(o => o.value === 'dvtm'));

console.log('test-catalog-table: ok');
