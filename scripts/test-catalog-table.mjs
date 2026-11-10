import assert from 'assert';
import {
  planRowsFromCatalog, planRowsFromSoTay, investRowsFromItems, filterCatalogRows,
  filterKeyFromMapLevel, rowsToCsv, catalogFilterOptions, catalogStatusStats,
  catalogWardLevelStats, catalogYearLevelStats, catalogWardFilterOptions,
  groupPlanRowsByLevel, planYearOf, matchCatalogWard, resolvePlanWards,
  mergeSoTayEdits, nextDccbId
} from '../public/js/catalogTableCore.js';
import { nameScore, areaScore, classifyPlanStatus, foldPlanName, matchSoTayToCatalog } from '../public/js/soTayMatch.js';
import { WARD_NAMES } from '../public/js/facetStore.js';

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
    danSo: '5.000',
    quyetDinh: '23/QĐ-UBND',
    ngay: '18/11/2013',
    coQuan: 'UBND tỉnh',
    linkGis: 'http://example',
    soDccb: 1,
    children: [
      {
        id: 'TH.B.001.01',
        loaiDong: 'dccb',
        ten: 'ĐCCB khu đất dự án LK8,9',
        quyetDinh: '3314/QĐ-UBND',
        ngay: '23/12/2016',
        coQuan: 'UBND tỉnh',
        dienTichText: '',
        danSo: ''
      }
    ]
  },
  {
    ma: 'TH.B.099',
    ten: 'QHPK khu vực chưa lên bản đồ XYZ',
    cap: 'QHPK',
    dvhc: 'Quận Thuận Hóa',
    dienTichHa: 12,
    dienTichText: '12,00',
    quyetDinh: '1/QĐ',
    ngay: '04/06/2024',
    linkGis: '',
    soDccb: 0
  },
  {
    ma: 'TH.A.001',
    ten: 'QHC thử nhóm A',
    cap: 'QHC',
    dvhc: 'Phường An Cựu',
    dienTichHa: 50,
    dienTichText: '50,00',
    quyetDinh: '2/QĐ',
    ngay: '01/01/2020',
    linkGis: '',
    soDccb: 0
  }
];
const catalog = [
  {
    tenQH: 'QHCT Đàn Nam Giao và vùng phụ cận',
    wards: ['Phường Thuận Hóa'],
    boundary: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    decision: { name: '23/QĐ-UBND' }
  },
  {
    tenQH: 'QHPK chỉ trên bản đồ ABC',
    wards: ['Phường An Cựu'],
    boundary: null,
    legacy: true
  },
  {
    tenQH: 'QHPK Khu vực An Cựu',
    wards: ['Phường An Cựu'],
    boundary: { type: 'Polygon', coordinates: [[[2, 2], [3, 2], [3, 3], [2, 2]]] }
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
assert.ok(filterCatalogRows(merged, { status: 'chi_so_tay' }).length >= 1);
assert.equal(missingMap.status, 'chi_so_tay');

const invest = investRowsFromItems([
  { id: 'a', title: 'Dự án X', sheet: { 'Địa điểm': 'Phường Đúc', 'Lĩnh vực': 'Du lịch' }, hasBoundary: true, areaText: '12 ha', dtGroup: 'dvtm' },
  { id: 'b', title: 'Dự án Y', sheet: null, hasBoundary: false, sheetOnly: true, areaText: '', dtGroup: 'khac' }
]);
assert.equal(invest.length, 2);
assert.equal(filterCatalogRows(invest, { level: 'dvtm' }).length, 1);

const csv = rowsToCsv(filterCatalogRows(merged, {}), 'plan');
assert.match(csv, /Tên quy hoạch/);
assert.match(csv, /Phường \/ xã/);
assert.match(csv, /Ranh/);
assert.doesNotMatch(csv, /Trạng thái/);
assert.match(csv, /Đàn Nam Giao/);
assert.match(csv, /Phường Thuận Hóa/);
assert.match(csv, /Có \(/);
assert.ok(nam.hasBoundary === true);
assert.ok(Number(nam.layerCount) >= 1);

const stats = catalogStatusStats(merged);
assert.ok(stats.total >= 3);
assert.ok(stats.byStatus.du >= 1);

assert.equal(matchCatalogWard('Phường An Cựu'), 'Phường An Cựu');
assert.equal(matchCatalogWard('An Cựu'), 'Phường An Cựu');
assert.ok(resolvePlanWards({ ten: 'QHPK phường Kim Long' }, null).includes('Phường Kim Long'));
assert.ok(nam.wards.includes('Phường Thuận Hóa'));

const wardStats = catalogWardLevelStats(merged);
assert.equal(wardStats.labels.length, WARD_NAMES.length);
assert.equal(wardStats.qhc.length, WARD_NAMES.length);
const iThuan = WARD_NAMES.indexOf('Phường Thuận Hóa');
const iAnCuu = WARD_NAMES.indexOf('Phường An Cựu');
assert.ok(iThuan >= 0 && iAnCuu >= 0);
assert.ok(wardStats.qhpk[iThuan] >= 1);
assert.ok(wardStats.qhpk[iAnCuu] + wardStats.qhct[iAnCuu] + wardStats.qhc[iAnCuu] >= 1);

assert.ok(catalogFilterOptions('plan').some(o => o.value === 'QHPK'));
assert.ok(catalogFilterOptions('invest').some(o => o.value === 'dvtm'));
assert.equal(planYearOf('18/11/2013'), 2013);
assert.equal(nam.year, 2013);
assert.equal(nam.quyetDinh, '23/QĐ-UBND');
assert.equal(nam.ngay, '18/11/2013');
assert.equal(nam.coQuan, 'UBND tỉnh');
assert.equal(nam.danSo, '5.000');
assert.equal(nam.children.length, 1);
assert.equal(nam.children[0].quyetDinh, '3314/QĐ-UBND');
assert.match(rowsToCsv([nam], 'plan'), /3314\/QĐ-UBND/);
assert.ok(filterCatalogRows(merged, { query: 'LK8' }).some((r) => r.maDoAn === 'TH.B.001'));

const yearStats = catalogYearLevelStats(merged);
assert.ok(yearStats.labels.includes('2013'));
assert.ok(yearStats.qhpk[yearStats.labels.indexOf('2013')] >= 1);

assert.ok(catalogWardFilterOptions().some(o => o.value === 'Phường An Cựu'));
assert.equal(filterCatalogRows(merged, { ward: 'Phường Thuận Hóa' }).length >= 1, true);

const grouped = groupPlanRowsByLevel(merged);
assert.equal(grouped[0].type, 'group');
assert.equal(grouped[0].label, 'A. QHC');
assert.ok(grouped.some(g => g.type === 'group' && g.label === 'B. QHPK'));

const mergedEdits = mergeSoTayEdits(sheet, {
  projects: [{ ma: 'ZZ.B.001', ten: 'QHPK thử admin', cap: 'QHPK', quyetDinh: '1/QĐ', ngay: '01/01/2024', coQuan: 'UBND tỉnh', children: [] }],
  dccb: [{ ma: 'TH.B.001', child: { id: nextDccbId('TH.B.001', nam.children), loaiDong: 'dccb', ten: 'ĐCCB thử', quyetDinh: '2/QĐ', ngay: '02/02/2024', coQuan: 'UBND tỉnh' } }],
  links: [{ ma: 'TH.A.001', tenQH: 'QHPK Khu vực An Cựu' }],
  patches: [{
    ma: 'TH.A.001',
    ten: 'QHC thử nhóm A (đã sửa)',
    dvhc: 'Phường An Đông',
    quyetDinh: '99/QĐ-UBND',
    dienTichHa: 55,
    dienTichText: '55,00',
    danSo: '9.000'
  }]
});
assert.ok(mergedEdits.some((r) => r.ma === 'ZZ.B.001'));
assert.ok(mergedEdits.find((r) => r.ma === 'TH.B.001').children.some((c) => /ĐCCB thử/.test(c.ten)));
assert.equal(mergedEdits.find((r) => r.ma === 'TH.A.001').mapTenQH, 'QHPK Khu vực An Cựu');
const patched = mergedEdits.find((r) => r.ma === 'TH.A.001');
assert.equal(patched.ten, 'QHC thử nhóm A (đã sửa)');
assert.equal(patched.dvhc, 'Phường An Đông');
assert.equal(patched.quyetDinh, '99/QĐ-UBND');
assert.equal(patched.dienTichHa, 55);
assert.equal(patched.danSo, '9.000');

const forced = matchSoTayToCatalog(
  [{ ma: 'TH.A.001', ten: 'Tên lệch hoàn toàn', cap: 'QHPK', mapTenQH: 'QHPK Khu vực An Cựu' }],
  catalog
);
assert.equal(forced.matches.get('TH.A.001')?.project?.tenQH, 'QHPK Khu vực An Cựu');
assert.equal(forced.matches.get('TH.A.001')?.forced, true);

console.log('test-catalog-table: ok');
