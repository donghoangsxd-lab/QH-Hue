// Cold path trục F: asset tĩnh trước, không chặn getInvestCalls; soft /gcs.
// Vẽ: canvas + cull viewport + signature skip + debounce moveend (cùng nguyên tắc QHPK).
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  sheetSig, parseInvestEditsStore, applyInvestEditsClient, editsWorthApplying
} from '../public/js/investEdits.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const layer = read('public/js/investLayer.js');
const api = read('public/js/api.js');

assert.match(layer, /INVEST_SHEET_URL\s*=\s*'\.\/data\/invest-sheet\.json'/);
assert.match(layer, /INVEST_BOUND_URL\s*=\s*'\.\/data\/invest-boundary\.geojson'/);
assert.match(layer, /softRefreshInvest/);
assert.match(layer, /gcsUrl\(INVEST_GCS_SHEET\)/);
assert.match(layer, /gcsUrl\(INVEST_GCS_EDITS\)/);
assert.doesNotMatch(layer, /getInvestCalls/, 'trục F không còn gọi getInvestCalls trên client');
assert.match(layer, /L\.canvas\(\{ pane: PANE/);
assert.match(layer, /cullInvestForView/);
assert.match(layer, /scheduleInvestForView/);
assert.match(layer, /syncInvestDraw/);
assert.match(layer, /matchCache/);
assert.match(api, /export function gcsUrl/);

const qhct = read('public/js/qhctLayer.js');
assert.match(qhct, /L\.canvas\(\{ pane: OUTLINE_PANE/);
assert.doesNotMatch(qhct, /L\.svg\(\{ pane: OUTLINE_PANE/);

const rowsA = [{ 'Tên dự án': 'A' }, { 'Tên dự án': 'B' }, { 'Tên dự án': 'C' }];
const rowsB = [{ 'Tên dự án': 'A' }, { 'Tên dự án': 'B' }, { 'Tên dự án': 'D' }];
assert.notEqual(sheetSig(rowsA), sheetSig(rowsB));
assert.equal(sheetSig(rowsA), sheetSig(rowsA.slice()));

const empty = parseInvestEditsStore({ v: 1, items: [], groups: [] });
assert.equal(editsWorthApplying(empty), false);

const store = parseInvestEditsStore({
  v: 1,
  items: [{ key: 'Khu đô thị X', match: '', fields: { 'Tên dự án': 'Khu đô thị X', 'Lĩnh vực': 'Đô thị' } }],
  groups: []
});
assert.equal(editsWorthApplying(store), true);
const base = { headers: ['Tên dự án'], rows: [{ 'Tên dự án': 'Khu đô thị X', 'Lĩnh vực': 'Cũ' }] };
const merged = applyInvestEditsClient(base, store.items);
assert.equal(merged.rows[0]['Lĩnh vực'], 'Đô thị');
assert.equal(merged.rows[0]._alias, 'Khu đô thị X');

assert.ok(fs.existsSync(path.join(root, 'scripts/pull-invest-sheet.mjs')));
assert.ok(fs.existsSync(path.join(root, 'public/data/invest-sheet.json')));
assert.ok(fs.existsSync(path.join(root, 'public/data/invest-boundary.geojson')));

console.log('test-invest-load: ok');
