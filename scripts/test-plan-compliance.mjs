import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as turf from '@turf/turf';
import {
  assessCompliance, classify, CONCLUSION, parentLinkMap, turfOps
} from '../public/js/planComplianceCore.js';

const root = new URL('..', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, root), 'utf8');
const principles = JSON.parse(read('public/data/tuan-thu-lo/principles.json'));
const ops = turfOps(turf);

const found = (input) => classify(principles, input);
const cxcc = found({ code: 5, patternKey: 'C-CXDT', texts: ['Đất cây xanh sử dụng công cộng đô thị'] });
assert.equal(cxcc.primary, 'cay-xanh-cong-cong');
assert.ok(cxcc.categories.includes('cay-xanh'));
assert.equal(found({ patternKey: '1-CV' }).primary, 'cay-xanh');
assert.equal(found({ patternKey: '1-CV' }).categories.includes('cay-xanh-cong-cong'), false);
assert.equal(found({ patternKey: '2-BDX' }).primary, 'bai-do-xe');
assert.equal(found({ patternKey: 'HTK' }).primary, 'ha-tang');
assert.equal(found({ code: 6 }).primary, 'ha-tang');
assert.equal(found({ code: 10 }).primary, 'dich-vu');
assert.equal(found({ patternKey: '9-TM' }).primary, 'dich-vu');
assert.equal(found({ patternKey: 'DL' }).primary, 'dich-vu');
assert.equal(found({ patternKey: 'O-NO' }).identified, true);
assert.equal(found({ patternKey: 'O-NO' }).categories.length, 0);
assert.equal(found({ patternKey: 'CC-DV' }).categories.length, 0);
assert.equal(found({ texts: ['Lô A1'] }).unknown, true);
assert.equal(found({ texts: ['Đất cây xanh sử dụng công cộng đô thị'] }).primary, 'cay-xanh-cong-cong');
assert.equal(found({}).unknown, true);

const rule = principles.rules.find(row => row.id === 'CXCC-01');
assert.ok(rule);
assert.equal(rule.anchor.category, 'cay-xanh-cong-cong');
assert.equal(rule.steps.find(step => step.childLevel === 'QHPK').allow.includes('bai-do-xe'), true);
assert.equal(rule.steps.find(step => step.childLevel === 'QHCT').areaShare.maxRatio, 0.05);
assert.match(principles.categories['cay-xanh-cong-cong'].sources.join('\n'), /LAND_CODES\[5\]/);
assert.deepEqual(CONCLUSION, {
  'phu-hop': 'Phù hợp',
  'chua-phu-hop': 'Chưa phù hợp',
  'chua-du-du-lieu': 'Chưa đủ dữ liệu'
});

const X = 107.55;
const Y = 16.45;
const S = 0.01;
const rect = (x0, y0, x1, y1) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const query = rect(X, Y, X + S, Y + S);
const slice = (width) => rect(X, Y, X + width, Y + S);

function parentQhc(code, display, geometry, slugs) {
  return {
    level: 'QHC10',
    geometry,
    schemeSlugs: slugs,
    schemeName: 'QHC thử',
    ...found({ code, patternKey: code === 5 ? 'C-CXDT' : '', texts: [display] }),
    display
  };
}

function child(patternKey, display, geometry, parentSlugs = [], linkSlugs = []) {
  return {
    geom: geometry,
    parentSlugs,
    linkSlugs,
    anchorSlugs: [],
    ...found({ patternKey, texts: [display] }),
    display
  };
}

const qhpkParent = {
  level: 'QHPK',
  geometry: query,
  schemeSlugs: ['qhpk-a'],
  schemeName: 'QHPK thử',
  ...found({ patternKey: '1-CV', texts: ['Cây xanh'] }),
  display: 'Cây xanh'
};

function run(childLevel, parts, parents, anchors = parents) {
  return assessCompliance({ principles, childLevel, parts, parents, anchors, queryGeom: query, ops });
}

const greenParent = [parentQhc(5, 'Đất cây xanh sử dụng công cộng đô thị', query, ['qhc-trung-tam'])];

let row = run('QHPK', [child('1-CV', 'Cây xanh', query)], greenParent)[0];
assert.equal(row.status, 'phu-hop');
assert.match(row.parentText, /QHC 1\/10\.000/);
assert.match(row.compareText, /CXCC-01/);

row = run('QHPK', [child('2-BDX', 'Bãi đỗ xe', query)], greenParent)[0];
assert.equal(row.status, 'phu-hop');

row = run('QHPK', [child('O-NO', 'Đất ở', query)], greenParent)[0];
assert.equal(row.status, 'chua-phu-hop');
assert.ok(row.failed.includes('chức năng'));
assert.match(row.compareText, /Không đạt: chức năng/);

row = run('QHPK', [child('CC-DV', 'Công cộng - dịch vụ', query)], greenParent)[0];
assert.equal(row.status, 'chua-phu-hop');

row = run('QHPK', [child(null, 'Lô chưa rõ', query)], greenParent)[0];
assert.equal(row.status, 'chua-du-du-lieu');
assert.notEqual(row.status, 'phu-hop');

row = run('QHPK', [child('1-CV', 'Cây xanh', query)], [parentQhc(40, 'Đất đơn vị ở', query, ['qhc-khac'])])[0];
assert.equal(row.status, 'chua-du-du-lieu');
assert.match(row.compareText, /không phải Đất cây xanh công cộng/);
assert.match(row.parentText, /Đất đơn vị ở/);

row = run('QHPK', [child('1-CV', 'Cây xanh', query)], [])[0];
assert.equal(row.status, 'chua-du-du-lieu');
assert.match(row.compareText, /Chưa thấy lô QHC 1\/10\.000/);

row = run('QHPK', [{ ...child('1-CV', 'Cây xanh', query), geom: null }], greenParent)[0];
assert.equal(row.status, 'chua-du-du-lieu');

const house = parentQhc(40, 'Đất đơn vị ở', query, ['qhc-nha']);
const pocket = parentQhc(5, 'Đất cây xanh sử dụng công cộng đô thị', slice(S * 0.2), ['qhc-cx']);
row = run('QHPK', [child('1-CV', 'Cây xanh', query, ['qhc-cx'])], [house, pocket])[0];
assert.equal(row.status, 'phu-hop');
assert.match(row.parentText, /cây xanh sử dụng công cộng/i);
row = run('QHPK', [child('1-CV', 'Cây xanh', query)], [house, pocket])[0];
assert.equal(row.status, 'chua-du-du-lieu');

row = run('QHPK', [child('1-CV', 'Cây xanh', query, [], ['qhc-cx'])], [house, pocket])[0];
assert.equal(row.status, 'phu-hop');
assert.match(row.parentText, /cây xanh sử dụng công cộng/i);

row = run('QHPK', [child('1-CV', 'Cây xanh', query, ['qhc-cx'], ['qhc-nha'])], [house, pocket])[0];
assert.equal(row.status, 'phu-hop');

const qhct = (patternKey, display, geometry) => child(patternKey, display, geometry);
const qhpkLinked = { ...qhpkParent, parentSlugs: [], linkSlugs: ['qhc-cx'] };
row = run('QHCT', [qhct('1-CV', 'Cây xanh', query)], [qhpkLinked], [house, pocket])[0];
assert.equal(row.status, 'phu-hop', row.compareText);
assert.match(row.parentText, /QHPK 1\/2\.000/);

const qhpkSchemeHouse = { ...qhpkParent, parentSlugs: ['qhc-nha'], linkSlugs: ['qhc-cx'] };
row = run('QHCT', [qhct('1-CV', 'Cây xanh', query)], [qhpkSchemeHouse], [house, pocket])[0];
assert.equal(row.status, 'chua-du-du-lieu');
assert.match(row.compareText, /không phải Đất cây xanh công cộng/);

const links = parentLinkMap([
  { Ma_Con: 'qhpk-a', Ma_Cha: 'qhc-trung-tam' },
  { child: 'qhpk-a', parent: 'qhc-moi' },
  { child: 'qhct-b', parent: 'qhpk-a', cleared: true },
  { placeholder: true, child: 'qhpk-z', parent: 'qhc-z' }
]);
assert.equal(links.get('qhpk-a'), 'qhc-moi');
assert.equal(links.has('qhct-b'), false);
assert.equal(links.has('qhpk-z'), false);

row = run('QHCT', [qhct('1-CV', 'Cây xanh', query)], [qhpkParent], greenParent)[0];
assert.equal(row.status, 'phu-hop');
assert.match(row.parentText, /QHPK 1\/2\.000/);

row = run('QHCT', [qhct('HTK', 'Hạ tầng kỹ thuật', query)], [qhpkParent], greenParent)[0];
assert.equal(row.status, 'phu-hop');

row = run('QHCT', [qhct('2-BDX', 'Bãi đỗ xe', query)], [qhpkParent], greenParent)[0];
assert.equal(row.status, 'phu-hop');

row = run('QHCT', [qhct('O-NO', 'Đất ở', query)], [qhpkParent], greenParent)[0];
assert.equal(row.status, 'chua-phu-hop');
assert.ok(row.failed.includes('chức năng'));

row = run('QHCT', [qhct('9-TM', 'Khu dịch vụ', slice(S * 0.04))], [qhpkParent], greenParent)[0];
assert.equal(row.status, 'phu-hop', row.compareText);
assert.match(row.compareText, /trần 5%/);

row = run('QHCT', [qhct('9-TM', 'Khu dịch vụ', slice(S * 0.2))], [qhpkParent], greenParent)[0];
assert.equal(row.status, 'chua-phu-hop', row.compareText);
assert.ok(row.failed.includes('dịch vụ'));

const unclear = {
  geom: slice(S * 0.3),
  display: 'Chưa rõ',
  parentSlugs: [],
  categories: [],
  unknown: true,
  ambiguous: false,
  identified: false
};
row = run('QHCT', [qhct('9-TM', 'Khu dịch vụ', slice(S * 0.03)), unclear], [qhpkParent], greenParent)[0];
assert.equal(row.status, 'chua-du-du-lieu');
assert.notEqual(row.status, 'phu-hop');

row = run('QHCT', [qhct('9-TM', 'Khu dịch vụ', slice(S * 0.08)), unclear], [qhpkParent], greenParent)[0];
assert.equal(row.status, 'chua-phu-hop');

row = run('QHCT', [qhct('1-CV', 'Cây xanh', query)], [], greenParent)[0];
assert.equal(row.status, 'chua-du-du-lieu');
assert.match(row.compareText, /Chưa thấy lô QHPK 1\/2\.000/);

row = run('QHCT', [qhct('1-CV', 'Cây xanh', query)], [qhpkParent], [parentQhc(40, 'Đất đơn vị ở', query, ['qhc-nha'])])[0];
assert.equal(row.status, 'chua-du-du-lieu');
assert.match(row.parentText, /QHPK 1\/2\.000/);

const ui = read('public/js/planCompliance.js');
const qhctSrc = read('public/js/qhctLayer.js');
const card = read('public/js/cadastreLayer.js');
const lots = read('public/js/planLandStats.js');
assert.match(ui, /data\/tuan-thu-lo\/principles\.json/);
assert.match(ui, /data\/htkt\/cong-suat\.json/);
assert.match(ui, /parentLinkMap/);
assert.match(ui, /Chức năng cấp trên/);
assert.match(ui, /Chỉ tiêu so sánh/);
assert.match(ui, /Kết luận/);
assert.match(qhctSrc, /annotateCompliance\('QHCT'/);
assert.match(card, /annotateCompliance\('QHPK'/);
assert.match(lots, /complianceHtml/);
assert.match(read('public/js/gbaVersion.js'), /SHELL_V = '20261085'/);
assert.match(read('rules/tuan-thu-lo/README.md'), /Thêm một nguyên tắc/);

console.log('test-plan-compliance: ok');
