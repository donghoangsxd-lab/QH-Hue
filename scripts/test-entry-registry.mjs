import assert from 'node:assert/strict';
import { ENTRY_FLOWS, FLOW_IDS, entryFlowOf, plannedSubs } from '../public/js/entryRegistry.js';
import {
  isAdminEntry, allowedEntryKeys, isEntrySignedIn, postEntry, assertOfficerUnit, stageOrPublish
} from '../public/js/entryKernel.js';

assert.deepEqual(FLOW_IDS, [
  'flowPhatTrien', 'flowQuyHoach', 'flowHtkt', 'flowHtxh', 'flowKienTruc', 'flowDuAn'
]);
assert.equal(ENTRY_FLOWS.length, 6);
assert.equal(entryFlowOf('flowHtkt').axis, 'C');
assert.equal(entryFlowOf('flowDuAn').axis, 'F');

const planned = plannedSubs();
assert.equal(planned.length, 0, 'C-điểm và F đề xuất đã ship');
assert.equal(entryFlowOf('flowHtkt').subs.find(s => s.id === 'htkt-diem').adminAction, 'addPoint');
assert.equal(entryFlowOf('flowDuAn').subs.find(s => s.id === 'du-an-de-xuat').adminAction, 'submitInvestProposal');
assert.equal(typeof isAdminEntry, 'function');
assert.equal(typeof allowedEntryKeys, 'function');
assert.equal(typeof isEntrySignedIn, 'function');
assert.equal(typeof postEntry, 'function');
assert.equal(typeof assertOfficerUnit, 'function');
assert.equal(typeof stageOrPublish, 'function');

const c = entryFlowOf('flowHtkt');
assert.ok(c.subs.some(s => s.id === 'htkt-net' && s.sample === 'H'));
assert.ok(c.subs.some(s => s.id === 'htkt-diem' && s.sample === 'P' && !s.planned));

const f = entryFlowOf('flowDuAn');
assert.ok(f.subs.some(s => s.id === 'du-an-de-xuat' && s.stageKind === 'du-an'));
assert.ok(f.subs.some(s => s.id === 'du-an-admin' && s.adminAction === 'saveInvestProject'));

console.log('test-entry-registry: ok');
