// Hạn mức PDF và chữ ký URL tải thẳng bucket. Không gọi mạng.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const limits = require('../services/pdfLimits');
const gcs = require('../services/gcsWrite');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pub = publicKey.export({ type: 'spki', format: 'pem' });
const key = { client_email: 'sa@example.iam.gserviceaccount.com', private_key: pem };
const now = new Date('2026-10-19T11:00:00Z');
const bytes = 5 * 1024 * 1024;

const signed = gcs.signPutUrl({
  name: 'projects/_pdf-in/0123456789abcdef0123456789abcdef.pdf',
  contentType: 'application/pdf',
  bytes,
  key,
  now
});
assert.strictEqual(signed.headers['Content-Type'], 'application/pdf');
assert.strictEqual(signed.headers['x-goog-content-length-range'], `${bytes},${bytes}`);
assert.ok(signed.url.startsWith('https://storage.googleapis.com/'));
assert.ok(signed.url.includes('X-Goog-SignedHeaders='));
const sig = signed.url.split('X-Goog-Signature=')[1];
assert.ok(crypto.createVerify('RSA-SHA256').update(signed.stringToSign).verify(pub, Buffer.from(sig, 'hex')));
assert.ok(!signed.stringToSign.includes(sig));

const other = gcs.signPutUrl({
  name: 'projects/_pdf-in/0123456789abcdef0123456789abcdef.pdf',
  contentType: 'application/pdf',
  bytes: bytes + 1,
  key,
  now
});
assert.notStrictEqual(other.headers['x-goog-content-length-range'], signed.headers['x-goog-content-length-range']);
assert.notStrictEqual(other.url, signed.url);

const small = Buffer.from('%PDF-1.4\n');
assert.strictEqual(limits.inlineBuffer(small.toString('base64'), false).slice(0, 4).toString(), '%PDF');

const exact = Buffer.alloc(limits.PDF_USER_MAX_BYTES, 0x20);
exact.write('%PDF', 0);
assert.strictEqual(limits.inlineBuffer(exact.toString('base64'), false).length, limits.PDF_USER_MAX_BYTES);

const overUser = Buffer.alloc(limits.PDF_USER_MAX_BYTES + 1, 0x20);
overUser.write('%PDF', 0);
assert.throws(() => limits.inlineBuffer(overUser.toString('base64'), false), (err) => {
  assert.strictEqual(err.status, 413);
  assert.strictEqual(err.message, 'File PDF tối đa 2 MB.');
  return true;
});
// Admin gửi base64 qua Cloud Run tới 10 MB; vượt 2 MB vẫn hợp lệ.
assert.doesNotThrow(() => limits.inlineBuffer(overUser.toString('base64'), true));
const overAdmin = Buffer.alloc(limits.PDF_ADMIN_MAX_BYTES + 1, 0x20);
overAdmin.write('%PDF', 0);
assert.throws(() => limits.inlineBuffer(overAdmin.toString('base64'), true), (err) => {
  assert.strictEqual(err.status, 413);
  assert.strictEqual(err.message, 'File PDF tối đa 10 MB.');
  return true;
});
assert.throws(() => limits.inlineBuffer('', false), (err) => err.message === 'File PDF rỗng.' && err.status === 400);
assert.strictEqual(limits.tooBigMessage(true), 'File PDF tối đa 10 MB.');
assert.strictEqual(limits.tooBigMessage(false), 'File PDF tối đa 2 MB.');
assert.strictEqual(limits.PDF_ADMIN_MAX_BYTES, 10 * 1024 * 1024);
assert.strictEqual(limits.PDF_USER_MAX_BYTES, 2 * 1024 * 1024);
assert.ok(limits.PDF_PROXY_MAX_BYTES < 4.5 * 1024 * 1024);
assert.ok(limits.b64MaxChars(limits.PDF_ADMIN_MAX_BYTES) < 15 * 1024 * 1024);

const client = fs.readFileSync(path.join(__dirname, '../public/js/pdfLimits.js'), 'utf8');
assert.ok(client.includes('2 * 1024 * 1024'));
assert.ok(client.includes('10 * 1024 * 1024'));
assert.ok(client.includes('Failed to fetch'));
assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../public/js/entryFlows.js'), 'utf8'), /putSignedPdf/);
assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../public/js/decisionViewer.js'), 'utf8'), /putSignedPdf/);
assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../public/js/adjustLayer.js'), 'utf8'), /putSignedPdf/);

console.log('test-pdf-limits: ok');
