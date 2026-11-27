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
assert.equal(
  landsFromFeatures([{ geometry: poly, props: { loaidat: '42' } }], 'QH')[0].layer,
  'Khác'
);
assert.equal(
  landsFromFeatures([{ geometry: poly, props: { loaidat: '17', chucnangsudungdat: 'Đất mặt nước' } }], 'QH')[0].layer,
  'Đất mặt nước'
);
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
const invest = stageSpec({
  kind: 'du-an',
  unit: 'tp:TP',
  tenQH: 'Khu đô thị mới',
  fields: { 'Tên dự án': 'Khu đô thị mới' },
  geometry: poly
});
assert.equal(invest.kind, 'du-an');
assert.equal(invest.tenQH, 'Khu đô thị mới');
assert.equal(invest.geometry.type, 'Polygon');
assert.throws(() => stageSpec({ kind: 'du-an', unit: 'tp:TP', fields: {} }), /tên dự án hoặc ranh/);
assert.ok(script.includes('"du-an": true'));
const dccb = stageSpec({
  kind: 'so-tay-dccb',
  unit: 'tp:TP',
  tenQH: 'QHPK thử',
  summary: 'ĐCCB · Khu A',
  fields: {
    ma: 'TH.B.001',
    ten: 'ĐCCB khu A',
    quyetDinh: '1/QĐ',
    ngay: '01/01/2024',
    coQuan: 'UBND',
    adjustId: 'aabbccddeeff0011',
    dccbId: 'TH.B.001.02'
  }
});
assert.equal(dccb.kind, 'so-tay-dccb');
assert.equal(dccb.fields.ma, 'TH.B.001');
assert.equal(dccb.fields.adjustId, 'aabbccddeeff0011');
assert.throws(() => stageSpec({ kind: 'so-tay-dccb', unit: 'tp:TP', fields: { ma: 'X' } }), /mã đồ án hoặc tên/);
assert.ok(script.includes('"so-tay-dccb": true'));
assert.match(fs.readFileSync(new URL('../services/reviewPublish.js', import.meta.url), 'utf8'), /publishSoTayDccb|so-tay-dccb|adjustId/);
assert.match(fs.readFileSync(new URL('../api/gee.js', import.meta.url), 'utf8'), /publishSoTayDccb|ensureAdjustStub|upsertDccbByAdjustId/);
const storeSrc = fs.readFileSync(new URL('../services/choDuyetStore.js', import.meta.url), 'utf8');
assert.match(storeSrc, /cho-duyet\/\$\{id\}\.json/);
assert.match(storeSrc, /private, no-store/);
assert.ok(script.includes('cho-duyet\\/([a-f0-9]{32})\\.json'));

console.log('canbo publish ok', labels.length);
