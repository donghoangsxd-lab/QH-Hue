import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { unitsForEmail, canBoLabels } from '../public/js/canBoGate.js';

const require = createRequire(import.meta.url);
const { schemeHasLand, loadLandIndex, landsFromFeatures, boundaryFromFeatures, dxfCount } = require('../services/landDedupe.js');
const { stageSpec } = require('../services/reviewPublish.js');

const rows = [
  { name: 'A', email: 'a@hue.gov.vn', unit: 'xa:an-cuu — Phường An Cựu', status: 'TRUE' },
  { name: 'A', email: 'a@hue.gov.vn', unit: 'xa:vy-da — Phường Vỹ Dạ', status: 'FALSE' },
  { name: 'B', email: 'b@hue.gov.vn', unit: 'dothi:khe-tre — Quy hoạch chung đô thị Khe Tre', status: true },
  { name: 'A', email: 'A@hue.gov.vn', unit: 'xa:kim-long — Phường Kim Long', status: 'TRUE' }
];
const a = unitsForEmail(rows, 'a@hue.gov.vn');
assert.deepEqual(a.units, ['xa:an-cuu', 'xa:kim-long']);
assert.equal(a.name, 'A');
assert.deepEqual(unitsForEmail(rows, 'khong@hue.gov.vn').units, []);

const script = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const labels = canBoLabels();
assert.ok(labels.length >= 60);
labels.forEach(label => assert.ok(script.includes(label), label));
assert.ok(script.includes('var CHO_DUYET_SHEET = "ChoDuyet"'));
assert.ok(script.includes('assertCanWrite_'));

const index = loadLandIndex();
assert.equal(schemeHasLand(index, { tenQH: 'QHC Khe Tre', slug: 'qhc-khe-tre-4a4803cd' }, 'quy-hoach'), true);
assert.equal(schemeHasLand(index, { tenQH: 'Đồ án chưa có', slug: 'do-an-chua-co' }, 'quy-hoach'), false);
assert.equal(schemeHasLand(index, { slug: 'qhc-khe-tre-4a4803cd' }, 'hien-trang'), false);
assert.equal(schemeHasLand(index, { slug: 'qhc-do-thi-thua-thien-hue-1-25-000-99f3eaf1' }, 'quy-hoach'), true);

const poly = { type: 'Polygon', coordinates: [[[107.5, 16.4], [107.51, 16.4], [107.51, 16.41], [107.5, 16.4]]] };
const lands = landsFromFeatures([{ name: 'Đất ở', geometry: poly, props: { loai: 'ODT', nhan: 'Đất ở' } }], 'QH');
assert.equal(lands.length, 1);
assert.equal(lands[0].phase, 'QH');
assert.equal(lands[0].layer, 'ODT');
const boundary = boundaryFromFeatures([{ geometry: poly }, { geometry: poly }]);
assert.equal(boundary.type, 'MultiPolygon');
assert.equal(dxfCount({ parcels: [{ kind: 'DXF', phase: 'QH', geometry: poly }, { kind: 'DXF', phase: 'HT', geometry: poly }] }, 'QH'), 1);

const staged = stageSpec({
  kind: 'su-dung-dat',
  unit: 'xa:an-cuu',
  tenQH: 'Đồ án mới',
  summary: 'Quy hoạch sử dụng đất',
  features: [{ name: 'Đất ở', geometry: poly, props: { loai: 'ODT' } }]
});
assert.equal(staged.kind, 'su-dung-dat');
assert.throws(() => stageSpec({
  kind: 'su-dung-dat',
  unit: 'xa:an-cuu',
  tenQH: 'QHC Khe Tre',
  features: [{ name: 'điểm', geometry: { type: 'Point', coordinates: [107.5, 16.4] }, props: {} }]
}), /vùng/);
const storeSrc = fs.readFileSync(new URL('../services/choDuyetStore.js', import.meta.url), 'utf8');
assert.match(storeSrc, /cho-duyet\/\$\{id\}\.json/);
assert.match(storeSrc, /private, no-store/);
assert.ok(script.includes('cho-duyet\\/([a-f0-9]{32})\\.json'));

console.log('canbo publish ok', labels.length);
