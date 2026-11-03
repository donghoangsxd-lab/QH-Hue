import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { ENTRY_FIELDS } from '../public/js/urbanEntrySchema.js';
import { ENTRY_NET_ROLE as clientMap, NET_ROLES as clientRoles } from '../public/js/netRoles.js';
import { SECTORS } from '../public/js/facetStore.js';

const require = createRequire(import.meta.url);
const { ENTRY_NET_ROLE: serverMap, NET_ROLES: serverRoles, NET_ROLE_SET } = require('../services/netRoles.js');

assert.deepEqual(clientMap, serverMap);
assert.deepEqual(clientRoles, serverRoles);
assert.equal(NET_ROLE_SET.size, serverRoles.length);

Object.values(clientMap).forEach(role => {
  assert.ok(NET_ROLE_SET.has(role), `ENTRY_NET_ROLE → ${role} phải nằm trong NET_ROLES`);
});

SECTORS.forEach(s => {
  assert.ok(clientMap[`${s.id}:hien-trang`], `thiếu map HT cho ngành ${s.id}`);
  assert.ok(clientMap[`${s.id}:quy-hoach`], `thiếu map QH cho ngành ${s.id}`);
});

assert.equal(clientMap['san-nen-thoat-mua:hien-trang'], 'ht-san-nen');
assert.equal(clientMap['thoat-nuoc-thai:hien-trang'], 'ht-thoat-thai');
assert.ok(NET_ROLE_SET.has('ht-thoat-nuoc'), 'giữ role thoát mưa cũ trên GCS');
assert.ok(NET_ROLE_SET.has('qh-thoat-nuoc'));

const gee = readFileSync(new URL('../api/gee.js', import.meta.url), 'utf8');
const m = gee.match(/const URBAN_FIELDS = new Set\(\[([\s\S]*?)\]\);/);
assert.ok(m, 'không tìm thấy URBAN_FIELDS trong api/gee.js');
const listed = new Set(
  m[1].match(/'([a-zA-Z0-9]+)'/g).map(s => s.slice(1, -1))
);
ENTRY_FIELDS.forEach(f => {
  assert.ok(listed.has(f.key), `URBAN_FIELDS thiếu key ${f.key} (ENTRY_FIELDS)`);
});

const review = readFileSync(new URL('../services/reviewPublish.js', import.meta.url), 'utf8');
assert.ok(review.includes("require('./netRoles')") || review.includes('require("./netRoles")'));

const steps = readFileSync(new URL('../public/js/entrySteps.js', import.meta.url), 'utf8');
assert.ok(steps.includes("from './netRoles.js'"));
const entry = readFileSync(new URL('../public/js/entryFlows.js', import.meta.url), 'utf8');
assert.ok(entry.includes("from './entrySteps.js'"));

console.log('test-entry-roles: ok');
