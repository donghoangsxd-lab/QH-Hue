import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  HTXH_POINT_TYPES, HTKT_POINT_TYPES, HTKT_POINT_CODES, OSM_TYPE_CODES,
  POINT_DOMAINS, typesForDomain, typeOptionsHtml
} from '../public/js/pointEntrySchema.js';

const require = createRequire(import.meta.url);
const constants = require('../config/constants.js');

assert.equal(POINT_DOMAINS.htxh.types.length, HTXH_POINT_TYPES.length);
assert.equal(HTKT_POINT_CODES.length, 7);
assert.deepEqual(constants.HTKT_POINT_CODES, HTKT_POINT_CODES);
HTKT_POINT_CODES.forEach(code => {
  assert.ok(constants.isHtktPointCode(code), code);
  assert.equal(constants.standardRadius({ type: code }), 0);
});

OSM_TYPE_CODES.forEach(code => {
  assert.ok(HTXH_POINT_TYPES.some(t => t.code === code), `OSM ${code} phải thuộc HTXH`);
});

assert.ok(typeOptionsHtml('htkt').includes('16-CN'));
assert.equal(typesForDomain('htkt').length, HTKT_POINT_TYPES.length);
assert.ok(typesForDomain('htxh').some(t => t.code === '1-CV'));

console.log('test-point-schema: ok');
