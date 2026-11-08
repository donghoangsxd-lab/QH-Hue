import assert from 'assert';
import {
  planRowsFromCatalog, investRowsFromItems, filterCatalogRows,
  filterKeyFromMapLevel, rowsToCsv, catalogFilterOptions
} from '../public/js/catalogTableCore.js';

assert.equal(filterKeyFromMapLevel('qhpk'), 'QHPK');
assert.equal(filterKeyFromMapLevel('qhct'), 'QHCT');
assert.equal(filterKeyFromMapLevel('qhc25'), 'QHC');
assert.equal(filterKeyFromMapLevel('urban'), '');

const plans = planRowsFromCatalog([
  { tenQH: 'QHPK khu A', wards: ['Thuận Hóa'], boundary: { type: 'Polygon', coordinates: [] }, decision: { name: 'QĐ 1' } },
  { tenQH: 'QHCT lô B', wards: ['An Cựu'], boundary: null, legacy: true }
]);
assert.equal(plans.length, 2);
const withBound = plans.find(r => r.hasBoundary);
const noBound = plans.find(r => !r.hasBoundary);
assert.ok(withBound);
assert.ok(noBound);
assert.match(noBound.note, /Chỉ danh sách/);
assert.equal(filterCatalogRows(plans, { level: 'QHPK' }).length, 1);
assert.equal(filterCatalogRows(plans, { query: 'an cựu' }).length, 1);

const invest = investRowsFromItems([
  { id: 'a', title: 'Dự án X', sheet: { 'Địa điểm': 'Phường Đúc', 'Lĩnh vực': 'Du lịch' }, hasBoundary: true, areaText: '12 ha', dtGroup: 'dvtm' },
  { id: 'b', title: 'Dự án Y', sheet: null, hasBoundary: false, sheetOnly: true, areaText: '', dtGroup: 'khac' }
]);
assert.equal(invest.length, 2);
assert.equal(filterCatalogRows(invest, { level: 'dvtm' }).length, 1);
assert.match(invest.find(r => !r.hasBoundary).note, /Chỉ danh sách|chưa có ranh/i);

const csv = rowsToCsv(filterCatalogRows(invest, {}));
assert.match(csv, /^﻿?STT,/);
assert.match(csv, /Dự án X/);
assert.match(csv, /Có/);
assert.match(csv, /Chưa/);

assert.ok(catalogFilterOptions('plan').some(o => o.value === 'QHPK'));
assert.ok(catalogFilterOptions('invest').some(o => o.value === 'dvtm'));

console.log('test-catalog-table: ok');
