import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planUrbanOf } from '../public/js/urbanClass.js';
import { EVAL_URBANS, ENTRY_FIELDS, MANUAL_2A, MANUAL_I, gapCounts, gapMarkdown, gapRows } from '../public/js/urbanEntrySchema.js';

assert.equal(EVAL_URBANS.length, 16);
EVAL_URBANS.forEach(u => {
  const live = planUrbanOf(u.id);
  assert.ok(live, u.id);
  assert.equal(live.cls, u.cls);
  assert.equal(live.partial || '', u.partial || '');
});

assert.equal(MANUAL_2A['2A.II.05'].key, 'ldPhiNong');
assert.equal(MANUAL_2A['2A.I.01'].qual, true);
assert.equal(MANUAL_2A['2A.II.03'], undefined);
assert.equal(MANUAL_I['1.I.01'], 'i01');
assert.equal(MANUAL_I['1.II.10'], undefined);
ENTRY_FIELDS.forEach(f => assert.ok(f.key && f.label && f.scopes.length));

const rows = gapRows();
const counts = gapCounts();
assert.equal(counts.partialDanSo, 6);
assert.equal(counts.wards, 40);
assert.ok(counts.thieu > 100);
const partialPop = rows.filter(r => r.unitKey === 'dothi:vinh-thanh' && r.field === 'Dân số phần đô thị');
assert.equal(partialPop[0].status, 'thieu');
const fullPop = rows.filter(r => r.unitKey === 'dothi:trung-tam' && r.field === 'Dân số phần đô thị');
assert.equal(fullPop[0].status, 'co-san');
const ward = rows.find(r => r.unitKey === 'xa:phu-vinh' && r.field === 'Dân số phần đô thị');
assert.equal(ward.status, 'thieu');
const plain = rows.find(r => r.unitKey === 'xa:thuan-hoa' && r.field === 'Dân số cả xã, phường');
assert.equal(plain.status, 'co-san');
assert.equal(gapMarkdown().includes('ChiTieuDoThi'), true);
assert.equal(gapMarkdown().includes('| Đô thị mới Vinh Thanh |'), true);
const report = readFileSync(new URL('../docs/thieu-chi-tieu-do-thi.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n').trim();
assert.equal(report, gapMarkdown().trim());

console.log('urban entry ok', counts);
