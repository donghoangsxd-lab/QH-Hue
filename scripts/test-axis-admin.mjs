import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const auth = require('../services/authService.js');
const constants = require('../config/constants.js');

assert.ok(constants.AXIS_ADMIN_EMAILS?.dautu?.includes('ncthanhttkt@gmail.com'));
assert.equal(auth.isAdminEmail('donghoangsxd@gmail.com'), true);
assert.equal(auth.isAdminEmail('ncthanhttkt@gmail.com'), false);
assert.deepEqual(auth.axesOf('ncthanhttkt@gmail.com'), ['dautu']);
assert.equal(auth.canAdminAxis('ncthanhttkt@gmail.com', 'dautu'), true);
assert.equal(auth.canAdminAxis('ncthanhttkt@gmail.com', 'quyhoach'), false);
assert.equal(auth.canAdminAxis('donghoangsxd@gmail.com', 'dautu'), true);
assert.equal(auth.canAdminAxis('donghoangsxd@gmail.com', 'htkt'), true);
assert.equal(auth.axisForChoKind('du-an'), 'dautu');
assert.equal(auth.axisForChoKind('ban-ve'), null);
assert.doesNotThrow(() => auth.assertChoKindAccess('ncthanhttkt@gmail.com', 'du-an'));
assert.throws(() => auth.assertChoKindAccess('ncthanhttkt@gmail.com', 'ban-ve'), /quyền/);
console.log('axis admin ok');
