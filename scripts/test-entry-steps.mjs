import assert from 'node:assert/strict';
import { SECTORS } from '../public/js/facetStore.js';
import { ENTRY_NET_ROLE } from '../public/js/netRoles.js';
import {
  HOSO_STEPS, PUBLISH_KIND, buildNetSteps, allEntrySteps, visibleEntrySteps, DRAW_SUPPORTS
} from '../public/js/entrySteps.js';

assert.equal(HOSO_STEPS.length, 6);
assert.equal(PUBLISH_KIND.ranh, 'ranh-gioi');
const net = buildNetSteps();
assert.equal(net.length, SECTORS.length * 2);
SECTORS.forEach(s => {
  assert.ok(net.some(step => step.sector === s.id && step.role === ENTRY_NET_ROLE[`${s.id}:hien-trang`]));
});
const all = allEntrySteps();
assert.equal(all.length, HOSO_STEPS.length + net.length);
const onlyNet = visibleEntrySteps({ hoMode: 'net', netSector: 'cap-nuoc', stepList: all });
assert.ok(onlyNet.every(s => s.sector === 'cap-nuoc'));
assert.equal(visibleEntrySteps({ hoMode: 'adjust', netSector: 'cap-nuoc', stepList: all }).length, 0);
assert.ok(DRAW_SUPPORTS.dxf.includes('hoso'));
assert.ok(DRAW_SUPPORTS.geojson.includes('batch'));
assert.ok(!DRAW_SUPPORTS.shp.includes('hoso'));
assert.ok(HOSO_STEPS.find(s => s.id === 'ranh')?.hint?.includes('RG'));
assert.ok(HOSO_STEPS.find(s => s.id === 'dat-ht')?.hint?.includes('KH'));
assert.ok(HOSO_STEPS.find(s => s.id === 'dat-qh')?.hint?.includes('QH'));

console.log('test-entry-steps: ok');
