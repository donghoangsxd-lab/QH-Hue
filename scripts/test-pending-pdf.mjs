import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pendingDecisionObject } = require('../services/pdfPaths.js');
const { stageSpec } = require('../services/reviewPublish.js');

const a = pendingDecisionObject('qhc-hue-2045', 'khoa-thu');
const b = pendingDecisionObject('qhc-hue-2045', 'khoa-thu');
assert.equal(a, b);
assert.match(a, /^cho-duyet\/[a-f0-9]{32}\.pdf$/);
assert.notEqual(a, pendingDecisionObject('qhc-hue-2045', 'khoa-khac'));
assert.throws(() => pendingDecisionObject('Tên có dấu', 'khoa-thu'), /không hợp lệ/);

const object = `cho-duyet/${'a'.repeat(32)}.pdf`;
const quyChe = stageSpec({
  kind: 'quy-che',
  unit: 'dothi:vinh-thanh',
  summary: 'Quy chế',
  pdf: { name: 'quy-che.pdf', bytes: 1200, object }
});
assert.equal(quyChe.kind, 'quy-che');
assert.equal(quyChe.tenQH, '');
assert.equal(quyChe.pdf.object, object);

const vanBan = stageSpec({
  kind: 'van-ban',
  unit: 'xa:an-cuu',
  tenQH: 'Đồ án thử',
  pdf: { name: 'qd.pdf', bytes: 800, role: 'quy-dinh', object }
});
assert.equal(vanBan.pdf.role, 'quy-dinh');
assert.equal(vanBan.summary, 'qd.pdf');
assert.throws(() => stageSpec({
  kind: 'van-ban',
  unit: 'xa:an-cuu',
  tenQH: 'Đồ án thử',
  pdf: { name: 'qd.pdf', bytes: 800, role: 'khac', object }
}), /văn bản/);

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const gee = read('api/gee.js');
const entry = read('public/js/entryFlows.js');
const store = read('services/projectStore.js');
const script = read('apps-script/Code.gs');
const queue = read('public/js/reviewQueue.js');
assert.match(gee, /submitChoDuyetPdf/);
assert.match(gee, /docRoleLabel\(role\)/);
assert.match(gee, /getChoDuyetPdf/);
assert.match(gee, /readPendingPdf/);
assert.match(entry, /submitChoDuyetPdf/);
assert.match(entry, /kind: 'quy-che'/);
assert.match(entry, /kind: 'van-ban'/);
assert.match(entry, /label: 'Quyết định'/);
assert.match(entry, /label: 'Quy chế'/);
assert.match(entry, /docRole: 'quy-dinh'/);
assert.doesNotMatch(entry, /Quy định quản lý/);
const card = read('public/js/projectLayer.js');
assert.match(card, /'quy-dinh': \{ short: 'QC', label: 'Quy chế' \}/);
assert.match(card, /<option value="quy-dinh">Quy chế<\/option>/);
assert.match(card, /<option value="phe-duyet">Quyết định phê duyệt<\/option>/);
assert.match(card, /<option value="dinh-chinh">Quyết định đính chính<\/option>/);
assert.match(store, /'quy-dinh': 'Quy chế'/);
assert.match(store, /function docRoleLabel/);
assert.doesNotMatch(store, /quy-dinh': 'Quy định quản lý'/);
assert.doesNotMatch(entry, /cần quản trị để ghi bucket/);
assert.match(store, /pendingDecisionObject/);
assert.match(store, /rewriteObject/);
assert.match(script, /"van-ban": true/);
assert.match(script, /"quy-che": true/);
assert.ok(script.includes('cho-duyet\\/[a-f0-9]{32}\\.pdf'));
assert.match(queue, /Xem PDF/);
assert.match(read('docs/bon-truc.md'), /cho-duyet\/<32 hex>\.pdf/);
assert.match(read('docs/cong-suat-do-an.md'), /\/gcs\/docs\/108-QD-TTg\.pdf/);
assert.match(read('.github/workflows/upload-docs.yml'), /credentials_json: \$\{\{ secrets\.GCP_SA_KEY \}\}/);
assert.doesNotMatch(read('.github/workflows/upload-docs.yml'), /pull_request:/);
assert.match(read('scripts/upload-app-docs.sh'), /docs\/614-QD-UBND\.pdf/);

console.log('pending pdf ok');
