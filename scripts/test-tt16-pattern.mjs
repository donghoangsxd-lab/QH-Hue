import assert from 'node:assert/strict';
import { landPatternKey, TT16_STYLES } from '../public/js/tt16Symbols.js';

const labelOf = (layer, name = '') => TT16_STYLES[landPatternKey(layer, name)]?.label || null;

// QHPK Hương Vinh CXCD.01: gisHue «Đất HTXH-Đất công viên chủ đề» ≠ cây xanh sử dụng công cộng.
assert.equal(landPatternKey('Đất HTXH-Đất công viên chủ đề'), 'CX-CD');
assert.equal(labelOf('Đất HTXH-Đất công viên chủ đề'), 'Cây xanh chuyên dụng');
assert.equal(landPatternKey('Đất HTXH-Đất công viên chủ đề', 'CXCD.01'), 'CX-CD');
assert.equal(landPatternKey('Cây xanh sử dụng công cộng', 'CXCD.01'), 'CX-CD');

// Công viên đô thị / công cộng vẫn là 1-CV.
assert.equal(landPatternKey('Đất HTXH-Đất công viên đô thị'), '1-CV');
assert.equal(landPatternKey('Cây xanh sử dụng công cộng'), '1-CV');
assert.equal(landPatternKey('DAT_HTXH_CayxanhCC'), '1-CV');

// Chuyên dụng theo tên TT16 / ký hiệu lô.
assert.equal(landPatternKey('Cây xanh chuyên dụng'), 'CX-CD');
assert.equal(landPatternKey('DAT_Cayxanhchuyendung'), 'CX-CD');
assert.equal(landPatternKey('42', 'CXCD.01'), 'CX-CD');
assert.equal(landPatternKey('', 'CXCC.02'), '1-CV');

console.log('test-tt16-pattern: ok');
