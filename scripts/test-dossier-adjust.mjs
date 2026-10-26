import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { formatDecisionCite, citeFromFileName, pickDecisionCite } from '../public/js/decisionCite.js';

const require = createRequire(import.meta.url);
const { adjustSubmitMode } = require('../services/adjustDraft.js');

assert.equal(formatDecisionCite('1101/QD-UBND', '2020-04-17'), '1101/QĐ-UBND ngày 17/04/2020');
assert.equal(formatDecisionCite('1101/QĐ-UBND', '17/4/2020'), '1101/QĐ-UBND ngày 17/04/2020');
assert.equal(formatDecisionCite('88/QĐ', ''), '88/QĐ-UBND');
assert.equal(formatDecisionCite('Quyết định phê duyệt', '2020-04-17'), '');
assert.equal(formatDecisionCite('32/QĐ-UBND', '32/13/2020'), '32/QĐ-UBND');
assert.equal(citeFromFileName('Quyết định phê duyệt.pdf'), '');
assert.equal(citeFromFileName('221/QD-UBND 21.01.2025.pdf'), '221/QĐ-UBND ngày 21/01/2025');

assert.equal(pickDecisionCite({
  fileName: 'Quyết định phê duyệt.pdf',
  schemeDecision: '1101/QĐ-UBND',
  schemeDate: '2020-04-17'
}), '1101/QĐ-UBND ngày 17/04/2020');
assert.equal(pickDecisionCite({
  fileName: '221/QD-UBND 21.01.2025.pdf',
  schemeDecision: '1101/QĐ-UBND',
  schemeDate: '2020-04-17'
}), '221/QĐ-UBND ngày 21/01/2025');
assert.equal(pickDecisionCite({ fileName: '', schemeDecision: '', schemeDate: '' }), '');

const pdfOnly = adjustSubmitMode({
  pdfOnly: true, hasBoundary: false, lotCount: 0, title: 'Điều chỉnh chiều cao vị trí A'
});
assert.deepEqual(pdfOnly, { ok: true, mode: 'pdf' });
assert.equal(adjustSubmitMode({ pdfOnly: true, title: '  ' }).ok, false);
assert.equal(adjustSubmitMode({ pdfOnly: true, title: '' }).status, 400);
assert.match(adjustSubmitMode({ pdfOnly: true, title: '' }).message, /tóm tắt/);
assert.match(
  adjustSubmitMode({ pdfOnly: false, hasBoundary: false, lotCount: 3, title: '' }).message,
  /Ranh điều chỉnh/
);
assert.match(
  adjustSubmitMode({ pdfOnly: false, hasBoundary: true, lotCount: 0, title: 'x' }).message,
  /lô đất/
);
assert.deepEqual(
  adjustSubmitMode({ hasBoundary: true, lotCount: 2, title: '' }),
  { ok: true, mode: 'draw' }
);

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const layer = read('public/js/projectLayer.js');
const entry = read('public/js/entryFlows.js');
const store = read('services/projectStore.js');
const gee = read('api/gee.js');
const imp = read('public/js/adjustImport.js');
const adj = read('public/js/adjustLayer.js');
const html = read('public/index.html');

for (const label of ['Quyết định phê duyệt', 'Quy định quản lý', 'Hệ thống bản vẽ', 'Điều chỉnh cục bộ']) {
  assert.match(layer, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
assert.match(layer, /bản vẽ/);
assert.match(layer, /\$\{fmtNum\(times\)\} lần/);
assert.match(layer, /Xem PDF/);
assert.match(layer, /Xem QĐ/);
assert.match(layer, /Bản vẽ scan/);
assert.match(layer, /function dossierSearchText/);
assert.match(layer, /it\.title \|\| it\.summary/);
assert.match(layer, /'quy-dinh': \{ short: 'QC', label: 'Quy chế' \}/);
assert.match(layer, /<option value="quy-dinh">Quy chế<\/option>/);
assert.match(layer, /capacityPanelHtml/);
assert.doesNotMatch(entry, /Quy định quản lý/);
assert.match(entry, /Ghi bổ sung hồ sơ điều chỉnh cục bộ/);
assert.match(entry, /pdfOnly: true/);
assert.match(entry, /id="hoAdjSummary"/);
assert.match(store, /pdfOnly/);
assert.match(store, /attachAdjustDraw/);
assert.match(store, /listOwnAdjustments/);
assert.match(store, /summary: title/);
const view = store.slice(store.indexOf('function adjustView'), store.indexOf('async function saveAdjustment'));
assert.doesNotMatch(view, /owner/);
assert.match(gee, /action === 'putAdjustDraw'/);
assert.match(gee, /action === 'listOwnAdjustments'/);
assert.match(gee, /pdfOnly === true/);
assert.match(gee, /private, no-store/);
assert.match(imp, /pdfOnly: true/);
assert.match(imp, /id="adjExisting"|adjExisting/);
assert.match(adj, /function dossierAdjustments/);
assert.match(adj, /payload\.pdfOnly/);
assert.match(html, /id="adjTitle"/);
assert.match(html, /id="adjExisting"/);
assert.match(html, /Tóm tắt/);

console.log('dossier adjust ok');
