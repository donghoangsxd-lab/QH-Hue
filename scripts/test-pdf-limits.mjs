import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const limits = require('../services/pdfLimits.js');

const tiny = Buffer.from('%PDF-1.4 hi').toString('base64');
assert.equal(limits.inlineBuffer(tiny, false).toString('ascii', 0, 5), '%PDF-');
assert.equal(limits.inlineBuffer(tiny, true).toString('ascii', 0, 5), '%PDF-');

const overUser = Buffer.alloc(limits.PDF_USER_MAX_BYTES + 1, 0x41).toString('base64');
assert.throws(() => limits.inlineBuffer(overUser, false), /2 MB/);
assert.doesNotThrow(() => limits.inlineBuffer(Buffer.alloc(limits.PDF_USER_MAX_BYTES + 1, 0x41).toString('base64'), true));

const almostAdmin = Buffer.alloc(3 * 1024 * 1024, 0x42);
almostAdmin.write('%PDF', 0);
const almostB64 = almostAdmin.toString('base64');
assert.equal(limits.inlineBuffer(almostB64, true).length, almostAdmin.length);
assert.throws(() => limits.inlineBuffer(almostB64, false), /2 MB/);

const overAdmin = Buffer.alloc(limits.PDF_ADMIN_MAX_BYTES + 1, 0x43).toString('base64');
assert.throws(() => limits.inlineBuffer(overAdmin, true), /10 MB/);

assert.equal(limits.inlineMaxBytes(true), limits.PDF_ADMIN_MAX_BYTES);
assert.equal(limits.inlineMaxBytes(false), limits.PDF_USER_MAX_BYTES);

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
assert.match(read('public/js/decisionViewer.js'), /fileToPdfBase64/);
assert.doesNotMatch(read('public/js/decisionViewer.js'), /putSignedPdf/);
assert.doesNotMatch(read('public/js/entryFlows.js'), /putSignedPdf/);
assert.doesNotMatch(read('public/js/adjustLayer.js'), /putSignedPdf/);
assert.match(read('public/js/pdfLimits.js'), /Failed to fetch/);
assert.match(read('services/pdfLimits.js'), /không mở CORS/);

console.log('pdf limits ok');
