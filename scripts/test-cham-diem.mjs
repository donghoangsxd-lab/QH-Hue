import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PHU_LUC_I, BANG_2A, BANG_2B, DIEM_CONG, KHUNG } from '../public/js/chamDiemCatalog.js';
import { parseCsv, indexRows, valueAt, normMa, kysOf } from '../public/js/chamDiemData.js';
import { scoreStandard, scoreHue, scoreDoThi, scoreXa, passDoThi, PASS_DIEM } from '../public/js/chamDiemCore.js';
import { dothiUnits, xaUnits, hueUnit } from '../public/js/chamDiemUnits.js';
import { CHAM_DIEM_SHEET_CSV } from '../public/js/chamDiemConfig.js';
import { CHAM_DIEM_NGUON, tyLeTuDong } from '../public/js/chamDiemNguon.js';
import { chonGiaTri, giaTriTuDong, installNoxhForTest } from '../public/js/chamDiemAuto.js';
import { DVHC_WARDS } from '../public/js/dvhcStats.js';

const sum = (xs, k) => Math.round(xs.reduce((s, c) => s + Number(c[k] || 0), 0) * 100) / 100;

assert.equal(PHU_LUC_I.length, 15);
assert.equal(BANG_2A.length, 23);
assert.equal(BANG_2B.length, 37);
assert.equal(DIEM_CONG.length, 26);
assert.equal(sum(BANG_2A, 'diemMax'), 100);
assert.equal(sum(BANG_2A, 'diemMin'), 75);
assert.equal(sum(BANG_2B, 'diemMax'), 100);
assert.equal(sum(BANG_2B, 'diemMin'), 75);
assert.equal(KHUNG['2A'].I[0] + KHUNG['2A'].II[0] + KHUNG['2A'].III[0], 75);
assert.equal(KHUNG['2A'].I[1] + KHUNG['2A'].II[1] + KHUNG['2A'].III[1], 100);
assert.equal(KHUNG['2B'].I[0] + KHUNG['2B'].II[0] + KHUNG['2B'].III[0], 75);
assert.equal(KHUNG['2B'].I[1] + KHUNG['2B'].II[1] + KHUNG['2B'].III[1], 100);
assert.equal(DIEM_CONG.filter(c => c.diem !== 0.5).length, 0);

const ids = (xs) => xs.map(c => c.id);
assert.deepEqual(ids(PHU_LUC_I), [
  '1.I.01', '1.I.02', '1.I.03', '1.I.04', '1.I.05', '1.I.06',
  '1.II.07', '1.II.08', '1.II.09', '1.II.10',
  '1.III.11', '1.III.12', '1.III.13', '1.III.14', '1.III.15'
]);
assert.equal(ids(BANG_2A)[0], '2A.I.01');
assert.equal(ids(BANG_2A).at(-1), '2A.III.23');
assert.equal(ids(BANG_2B)[0], '2B.I.01');
assert.equal(ids(BANG_2B).at(-1), '2B.III.37');
assert.equal(ids(DIEM_CONG)[0], '2B.C.01');
assert.equal(ids(DIEM_CONG).at(-1), '2B.C.26');

function at(spec, cls, edge) {
  const key = cls === 'II' ? 'ii' : 'iii';
  const hi = spec.muc[0][key];
  const lo = spec.muc[1][key];
  if (edge === 'max') {
    if (hi.op === 'lt') return String(hi.n / 2);
    if (hi.op === 'range') return String((hi.n + hi.n2) / 2);
    if (hi.op === 'text') return hi.raw;
    return String(hi.n);
  }
  if (hi.op === 'range') return '40';
  if (hi.op === 'lt') return String(lo.n);
  if (lo.op === 'text') return lo.raw;
  return String(lo.n);
}

function valueOf(list, cls, edge) {
  const map = new Map(list.map(spec => [spec.id, at(spec, cls, edge)]));
  return (id) => map.get(id) || '';
}

const xaMin = scoreXa('III', valueOf(BANG_2B, 'III', 'min'));
assert.equal(xaMin.complete, true);
assert.equal(xaMin.total, 75);
assert.equal(xaMin.ketLuan, 'dat');
assert.equal(xaMin.thieu75, 0);
assert.equal(xaMin.nhom.I.diem, 11.5);
assert.equal(xaMin.nhom.II.diem, 15.5);
assert.equal(xaMin.nhom.III.diem, 48);

const xaMax = scoreXa('II', valueOf(BANG_2B, 'II', 'max'), false);
assert.equal(xaMax.total, 100, `tối đa không di sản = ${xaMax.total}`);
assert.equal(xaMax.ketLuan, 'dat');

const aMin = scoreDoThi('II', valueOf(BANG_2A, 'II', 'min'));
assert.equal(aMin.total, 75);
assert.equal(aMin.ketLuan, 'dat');
assert.equal(aMin.nhom.I.diem, 11.5);
assert.equal(aMin.nhom.II.diem, 15.5);
assert.equal(aMin.nhom.III.diem, 48);

const aMax = scoreDoThi('III', valueOf(BANG_2A, 'III', 'max'), false);
assert.equal(aMax.total, 100);

const aHer = scoreDoThi('II', valueOf(BANG_2A, 'II', 'max'), true);
assert.equal(aHer.total, 98.5);
assert.equal(aHer.items.find(it => it.id === '2A.II.04').status, 'mien');
assert.equal(aHer.items.find(it => it.id === '2A.II.04').diem, 4.5);

const emptyXa = scoreXa('II', () => '');
assert.equal(emptyXa.ketLuan, 'chua');
assert.equal(emptyXa.total, null);
assert.equal(emptyXa.thieu75, null);
assert.equal(emptyXa.items.every(it => it.id === '2B.II.04' ? it.status === 'mien' : it.status === 'chua'), true);

const mid = scoreStandard(BANG_2A.find(c => c.id === '2A.II.05'), 'II', '80');
assert.equal(mid.diem, 6.25);
assert.equal(mid.thieuMin, 0);
assert.equal(mid.status, 'mot_phan');
assert.ok(mid.thieuMax > 0);

const adj = scoreStandard(BANG_2A.find(c => c.id === '2A.II.05'), 'II', '64');
assert.equal(adj.status, 'dieu8');
assert.equal(adj.diem, 5.5);
const fail = scoreStandard(BANG_2A.find(c => c.id === '2A.II.05'), 'II', '30');
assert.equal(fail.status, 'khong');
assert.equal(fail.diem, 0);
assert.equal(fail.thieuMin > 0 && fail.thieuMax > 0, true);

const poor = scoreStandard(BANG_2B.find(c => c.id === '2B.I.03'), 'II', '2,75');
assert.equal(poor.diem, 3.75);
assert.equal(poor.thieuMin, 0);
const poorHi = scoreStandard(BANG_2B.find(c => c.id === '2B.I.03'), 'II', '2');
assert.equal(poorHi.status, 'dat');
assert.equal(poorHi.thieuMax, 0);
const poorLo = scoreStandard(BANG_2B.find(c => c.id === '2B.I.03'), 'II', '4');
assert.equal(poorLo.status, 'khong');
assert.equal(poorLo.diem, 0);

const span = BANG_2B.find(c => c.id === '2B.III.22');
assert.equal(scoreStandard(span, 'II', '70').diem, 3);
assert.equal(scoreStandard(span, 'II', '40').diem, 2);
assert.equal(scoreStandard(span, 'II', '100').diem, 0);
assert.equal(scoreStandard(span, 'II', '20').diem, 0);
assert.equal(scoreStandard(span, 'II', '20', { heritage: false }).diem, 2);

const dense = BANG_2B.find(c => c.id === '2B.II.04');
assert.equal(scoreStandard(dense, 'II', '30000', { heritage: false }).diem, 8);
assert.equal(scoreStandard(dense, 'II', '9000', { heritage: false }).status, 'dat');
assert.equal(scoreStandard(dense, 'II', '9000').status, 'mien');

const qual = scoreStandard(BANG_2A.find(c => c.id === '2A.I.01'), 'II', 'Cấp tỉnh');
assert.equal(qual.diem, 5.5);
assert.equal(qual.thieuMin, 0);
assert.equal(qual.thieuMax, 100);
assert.equal(scoreStandard(BANG_2A.find(c => c.id === '2A.I.01'), 'II', 'Cấp vùng').thieuMax, 0);
assert.equal(scoreStandard(BANG_2A.find(c => c.id === '2A.I.01'), 'II', '').status, 'chua');

const funeral = scoreStandard(BANG_2A.find(c => c.id === '2A.III.13'), 'III', 'Có dự án');
assert.equal(funeral.diem, 2.5);
assert.equal(scoreStandard(BANG_2A.find(c => c.id === '2A.III.13'), 'III', '1').diem, 3);

const top = scoreStandard(BANG_2A.find(c => c.id === '2A.II.05'), 'II', '95');
assert.equal(top.status, 'dat');
assert.equal(top.diem, 7);
assert.equal(top.thieuMin, 0);
assert.equal(top.thieuMax, 0);

function hueValues(mode) {
  return (id) => {
    if (mode === 'empty') return '';
    if (mode === 'short') return id === '1.I.06' ? '' : 'Đạt';
    const dat = new Set([
      '1.I.01', '1.I.02', '1.I.03', '1.I.04',
      '1.II.07', '1.II.08',
      '1.III.11', '1.III.12', '1.III.13', '1.III.14'
    ]);
    if (mode === 'low') return dat.has(id) && id !== '1.III.14' ? 'Đạt' : 'Không đạt';
    return dat.has(id) ? 'Đạt' : 'Không đạt';
  };
}
const hueOk = scoreHue(hueValues('ok'));
assert.equal(hueOk.ketLuan, 'dat');
assert.equal(hueOk.dat, 10);
assert.equal(hueOk.nhomDat.I, 4);
assert.equal(hueOk.nhomDat.II, 2);
assert.equal(hueOk.nhomDat.III, 4);
assert.equal(scoreHue(hueValues('low')).ketLuan, 'khong');
assert.equal(scoreHue(hueValues('empty')).ketLuan, 'chua');
assert.equal(scoreHue(hueValues('short')).ketLuan, 'chua');
assert.equal(scoreHue(hueValues('short')).items.find(it => it.id === '1.I.06').thieuMin, null);

const oneWard = scoreXa('III', valueOf(BANG_2B, 'III', 'min'));
const town = passDoThi(aMin, [oneWard]);
assert.equal(town.ketLuan, 'dat');
assert.equal(town.tbMucIII, 48);
assert.equal(town.xaDat, 1);
assert.equal(passDoThi(aMin, [emptyXa]).ketLuan, 'chua');
assert.equal(passDoThi(emptyXa, [oneWard]).ketLuan, 'chua');

const capped = scoreXa('II', (id) => {
  if (id.startsWith('2B.C.')) return id <= '2B.C.03' ? 'Đạt' : '';
  return valueOf(BANG_2B, 'II', 'max')(id);
}, false);
assert.equal(capped.total, 100);
assert.equal(capped.bonusItems.filter(b => b.met).reduce((s, b) => s + b.diemAp, 0), 0);

const lifted = scoreXa('III', (id) => {
  if (id.startsWith('2B.C.')) return id <= '2B.C.03' ? 'Đạt' : 'Không';
  return valueOf(BANG_2B, 'III', 'min')(id);
});
assert.equal(lifted.total, 76.5);
assert.equal(lifted.bonusItems.filter(b => b.diemAp === 0.5).length, 3);

const root = new URL('..', import.meta.url);
const csvA = fs.readFileSync(new URL('data/cham-diem/du-lieu.csv', root), 'utf8');
const csvB = fs.readFileSync(new URL('public/data/cham-diem/du-lieu.csv', root), 'utf8');
assert.equal(csvA, csvB);
const rows = parseCsv(csvA);
const towns = new Set([...dothiUnits('2030'), ...dothiUnits('vision')].map(u => u.ma));
const wards = xaUnits('2030');
assert.equal(wards.length, 40);
assert.equal(hueUnit().ma, 'hue');
const expectRows = 15 + towns.size * 23 + wards.length * (37 + 26);
assert.equal(rows.length, expectRows);
assert.equal(rows.every(r => r.ky === '2026-Q1' && r.gia_tri === '' && r.nguon === '' && r.ghi_chu === ''), true);
const index = indexRows(rows);
assert.equal(valueAt(index, 'hue', 'hue', '2026-Q1', '1.I.01'), '');
assert.equal(valueAt(index, 'xa', 'Phường Kim Long', '2026-Q1', '2B.I.01'), '');
assert.equal(normMa('Phường Kim Long'), normMa('kim-long'));
assert.deepEqual(kysOf(rows), ['2026-Q1']);
assert.equal(CHAM_DIEM_SHEET_CSV, '');

const quoted = parseCsv('ma_don_vi,loai_don_vi,ma_tieu_chi,ky,gia_tri,nguon,ghi_chu\nhue,hue,1.I.01,2026,"Đạt, tạm","Sở Xây dựng","ghi ""nháp"""\n');
assert.equal(quoted[0].gia_tri, 'Đạt, tạm');
assert.equal(quoted[0].ghi_chu, 'ghi "nháp"');

const tile = tyLeTuDong();
assert.equal(CHAM_DIEM_NGUON.length, 15 + 23 + 37 + 26);
assert.equal(new Set(CHAM_DIEM_NGUON.map(r => r.id)).size, CHAM_DIEM_NGUON.length);
assert.equal(tile.tong, CHAM_DIEM_NGUON.length);
assert.equal(tile.auto, 35, `tự tính ${tile.auto}/${tile.tong}`);
assert.equal(tile.autoChuan, 28);
CHAM_DIEM_NGUON.forEach(r => {
  if (r.cheDo === 'tu_dong') assert.ok(r.nguon && r.congThuc, r.id);
  else {
    assert.equal(r.cheDo, 'tay');
    assert.equal(r.nguon, 'nhập tay');
    assert.ok(r.lyDo, r.id);
  }
});
const hue = hueUnit();
assert.equal(giaTriTuDong('1.II.07', hue).value, 'Không đạt');
assert.equal(giaTriTuDong('1.II.10', hue).value, 'Không đạt');
const trungTam = dothiUnits('2030').find(u => u.id === 'trung-tam');
const popNghin = trungTam.members.reduce((s, m) => {
  const name = Object.keys(DVHC_WARDS).find(n => normMa(n) === m.ma);
  return s + DVHC_WARDS[name].pop;
}, 0) / 1000;
assert.equal(Number(giaTriTuDong('2A.II.03', trungTam).value), Math.round(popNghin * 1000) / 1000);
assert.equal(giaTriTuDong('2A.III.13', trungTam, { points: null }).value, null);
const funeralAuto = giaTriTuDong('2A.III.13', xaUnits('2030').find(u => u.ma === 'kim-long'), {
  points: [{ type: '11-NT', ntKind: 'funeral', status: true, ward: 'Phường Kim Long', name: 'Nhà tang lễ' }]
});
assert.equal(funeralAuto.value, '1');
assert.equal(chonGiaTri('2', funeralAuto).nguon, 'ghi_de');
assert.equal(chonGiaTri('2', funeralAuto).value, '2');
assert.equal(chonGiaTri('', { value: null }).nguon, 'trong');
installNoxhForTest([{ ward: 'Phường Vỹ Dạ', status: 'hoan_thanh' }, { ward: 'Phường Vỹ Dạ', status: 'quy_hoach' }]);
assert.equal(giaTriTuDong('2B.III.21', xaUnits('2030').find(u => u.ma === 'vy-da'), {}).value, '1');
const kim = xaUnits('2030').find(u => u.ma === 'kim-long');
const schools = (n) => giaTriTuDong('2B.III.25', kim, {
  points: Array.from({ length: n }, () => ({ type: '4-TH', status: true, ward: 'Kim Long', name: 'Trường tiểu học' }))
}).value;
assert.equal(schools(9), 'toi_da');
assert.equal(schools(8), 'toi_thieu');
assert.equal(schools(1), 'khong');

const html = fs.readFileSync(new URL('public/index.html', root), 'utf8');
assert.match(html, /data-admin-tab="chamdiem"/);
assert.match(html, /id="adminPaneChamDiem"/);
assert.match(html, /Chấm điểm/);
assert.match(fs.readFileSync(new URL('docs/ui-spec.md', root), 'utf8'), /Chấm điểm/);
assert.match(fs.readFileSync(new URL('docs/cham-diem.md', root), 'utf8'), /ma_don_vi/);

console.log('cham diem ok');
