import assert from 'node:assert/strict';
import {
  expandPlanWords, projectFullName, placeField, lotHeading, limitItems, limitsHtml,
  metricGridHtml, landUseBannerHtml, landCardTabsHtml, regulationsPaneHtml,
  dossierButtons, projectValueHtml, pointToken, landToken, parseLotToken
} from '../public/js/lotPopup.js';

const kind = 'Công viên khu vực cấp đô thị';
assert.equal(
  lotHeading('Đất cây xanh công viên_thể dục thể thao CX14', 'CX14', kind),
  'Đất cây xanh CX14'
);
assert.equal(lotHeading('Đất cây xanh công viên_thể dục thể thao CX14 – QHPK Khu A #3', '', kind), 'Đất cây xanh CX14');
assert.equal(lotHeading('Trường tiểu học Nguyễn Du TH.1', 'TH.1', 'Trường tiểu học cấp đơn vị ở'), 'Trường tiểu học Nguyễn Du TH.1');

assert.equal(expandPlanWords('Mật độ XD'), 'Mật độ xây dựng');
assert.equal(expandPlanWords('Diện tích QH'), 'Diện tích quy hoạch');
assert.equal(expandPlanWords('Trường THCS'), 'Trường trung học cơ sở');
assert.equal(expandPlanWords('Trường TH số 2'), 'Trường tiểu học số 2');
assert.equal(expandPlanWords('Trường MN Hoa Hồng'), 'Trường mầm non Hoa Hồng');
assert.equal(expandPlanWords('TH.1'), 'TH.1');
assert.equal(expandPlanWords('CX14'), 'CX14');
assert.equal(expandPlanWords('DAT_HTXH_CayxanhCC'), 'DAT_HTXH_CayxanhCC');

const full = projectFullName('QHPK Khu A - ĐTM An Vân Dương');
assert.match(full, /^Quy hoạch phân khu Khu A/);
assert.match(full, /Đô thị mới An Vân Dương/);
assert.doesNotMatch(full, /QHPK|ĐTM|\bQH\b|\bXD\b/);
assert.equal(
  projectFullName('QH-QHPK Đô thị Vinh Thanh và vùng phụ cận'),
  'Quy hoạch phân khu Đô thị Vinh Thanh và vùng phụ cận'
);

assert.deepEqual(placeField('Phường Vỹ Dạ'), { label: 'Phường', name: 'Vỹ Dạ' });
assert.deepEqual(placeField('Xã Thủy Bằng'), { label: 'Xã', name: 'Thủy Bằng' });
assert.equal(placeField('Thị trấn Phú Lộc').label, 'Thị trấn');

const limits = limitItems({ floors: 1, coverage: 5, far: 0.4 });
assert.deepEqual(limits.map(s => s.label), ['Tầng cao', 'Mật độ xây dựng', 'Hệ số sử dụng đất']);
assert.equal(limits[0].text, '≤ 1 tầng');
assert.equal(limits[1].text, '≤ 5%');
const html = limitsHtml({ floors: 1, coverage: 5 });
assert.equal((html.match(/class="lp-limit"/g) || []).length, 2);
assert.doesNotMatch(html, /Mật độ XD|SDĐ/);

const grid = metricGridHtml('120 m²', { floors: 4, coverage: 60, far: 2.4 });
assert.equal((grid.match(/class="lp-metric /g) || []).length, 4);
assert.match(grid, /Diện tích/);
assert.match(grid, /Mật độ XD/);
assert.match(grid, /Chiều cao tối đa/);
assert.match(grid, /Hệ số sử dụng/);
assert.match(grid, /120 m²/);
assert.match(grid, /≤ 60%/);
assert.match(grid, /≤ 4 tầng/);
assert.match(grid, /≤ 2,4 lần/);
assert.doesNotMatch(grid, /lp-metric-far[\s\S]*?—/);
const emptyGrid = metricGridHtml('', null);
assert.equal((emptyGrid.match(/—/g) || []).length, 4);
assert.match(landUseBannerHtml('Đất ở đô thị'), /Chức năng SDĐ/);
assert.match(landUseBannerHtml('Đất ở đô thị'), /Đất ở đô thị/);
assert.equal(landUseBannerHtml(''), '');
const tabs = landCardTabsHtml();
assert.match(tabs, /data-lp-tab="chi-tieu"/);
assert.match(tabs, /data-lp-tab="quy-dinh"/);
assert.match(regulationsPaneHtml(null), /Chưa gắn quy định/);
assert.doesNotMatch(regulationsPaneHtml(null), /Tab này sẽ mở/);
const regs = regulationsPaneHtml({ slug: 'da', docs: [{ role: 'quy-dinh', id: '1', at: 2 }] });
assert.match(regs, /data-dossier="quy-dinh"/);
assert.doesNotMatch(regs, /lp-reg-hint|Tab này sẽ mở/);

assert.deepEqual(dossierButtons(null), []);
assert.deepEqual(dossierButtons({ proposal: { name: 'chờ' } }), []);
assert.deepEqual(dossierButtons({ decision: { slug: 'a', at: 1 } }).map(b => b.label), ['Quyết định']);
assert.deepEqual(
  dossierButtons({ slug: 'da', decision: { slug: 'a' }, docs: [{ role: 'quy-dinh', id: '1', at: 2 }] }).map(b => b.label),
  ['Quy chế', 'Quyết định']
);
const row = projectValueHtml('QHPK Khu A - ĐTM An Vân Dương', { slug: 'da', docs: [{ role: 'quy-dinh', id: '1', at: 2 }] });
assert.match(row, /Quy hoạch phân khu/);
assert.match(row, /data-dossier="quy-dinh"/);
assert.doesNotMatch(row, /data-dossier="phe-duyet"/);

const token = pointToken('QH', 'CX14');
assert.deepEqual(parseLotToken(token), { type: 'point', scenario: 'QH', id: 'CX14' });
const land = landToken('QH', 'QHPK Khu A', 'lô 1');
assert.equal(parseLotToken(land).file, 'QHPK Khu A');
assert.equal(parseLotToken(land).id, 'lô 1');
assert.equal(parseLotToken(''), null);

console.log('lot popup ok');
