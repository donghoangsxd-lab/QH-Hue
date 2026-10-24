// Sinh catalog tiêu chuẩn và CSV mẫu từ data/cham-diem/tieu-chi.json.
// Không điền gia_tri. Chạy: node scripts/build-cham-diem.mjs
import fs from 'node:fs';
import path from 'node:path';
import { URBANS } from '../public/js/urbanClass.js';
import { URBANS_VISION } from '../public/js/urbanVision.js';
import { DVHC_WARDS } from '../public/js/dvhcStats.js';
import { areaCodeFromName } from '../public/js/facetStore.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = JSON.parse(fs.readFileSync(path.join(root, 'data/cham-diem/tieu-chi.json'), 'utf8'));

function numVi(token) {
  const t = String(token).trim();
  if (!t) return null;
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseMuc(raw) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return { raw: '', op: 'none' };
  let m = s.match(/^(\d[\d.,]*)\s*đến\s*(\d[\d.,]*)$/i);
  if (m) return { raw: s, op: 'range', n: numVi(m[1]), n2: numVi(m[2]) };
  m = s.match(/^<\s*(\d[\d.,]*)/);
  if (m) return { raw: s, op: 'lt', n: numVi(m[1]) };
  m = s.match(/^>\s*(\d[\d.,]*)/);
  if (m) return { raw: s, op: 'gt', n: numVi(m[1]) };
  m = s.match(/^(?:≥|>=)\s*(\d[\d.,]*)/);
  if (m) return { raw: s, op: 'ge', n: numVi(m[1]) };
  m = s.match(/^(\d[\d.,]*)$/);
  if (m) return { raw: s, op: 'ge', n: numVi(m[1]) };
  return { raw: s, op: 'text' };
}

function nhomOf(tieuChi) {
  if (String(tieuChi).startsWith('III.')) return 'III';
  if (String(tieuChi).startsWith('II.')) return 'II';
  if (String(tieuChi).startsWith('I.')) return 'I';
  throw new Error(`Không nhận tiêu chí: ${tieuChi}`);
}

function subOf(nhom) {
  const m = /^(\d+\.\d+\.\d+)/.exec(String(nhom || ''));
  return m ? m[1] : null;
}

function donVi(s) {
  if (!s) return '';
  return String(s).replace(/km 2/g, 'km²').replace(/m 2/g, 'm²').replace(/\s+/g, ' ').trim();
}

function khungMap(rows) {
  const out = {};
  for (const row of rows) {
    const [lo, hi] = String(row.khung_diem).split('-').map(numVi);
    out[row.ma] = [lo, hi];
  }
  return out;
}

function scored(row, bang) {
  return {
    id: row.id,
    bang,
    nhom: nhomOf(row.tieu_chi),
    sub: subOf(row.nhom),
    ten: row.ten_tieu_chuan,
    donVi: donVi(row.don_vi),
    kind: row.loai_du_lieu === 'dinh_tinh' ? 'chu' : 'so',
    diemMax: row.diem_toi_da,
    diemMin: row.diem_toi_thieu,
    muc: (row.muc || []).map(m => ({
      ii: parseMuc(m.loai_II),
      iii: parseMuc(m.loai_III),
      diem: numVi(String(m.diem).replace(/\s/g, '')),
      gop: !!m.gop_cot_II_III
    })),
    pp: (row.cach_tinh_phu_luc_III || []).filter(Boolean)
  };
}

const phuLucI = src.phu_luc_I_loai_I.map(row => ({
  id: row.id,
  bang: 'I',
  nhom: nhomOf(row.tieu_chi),
  sub: null,
  ten: row.ten_tieu_chuan,
  donVi: '',
  kind: 'dat',
  diemMax: null,
  diemMin: null,
  muc: [],
  pp: (row.cach_tinh_phu_luc_III || []).filter(Boolean)
}));

const bang2A = src.bang_2A.map(row => scored(row, '2A'));
const bang2B = src.bang_2B.map(row => scored(row, '2B'));
const diemCong = src.bang_2B_diem_cong.map((row, i) => ({
  id: `2B.C.${String(i + 1).padStart(2, '0')}`,
  bang: '2B+',
  nhom: nhomOf(row.tieu_chi),
  sub: subOf(row.nhom),
  ten: row.noi_dung,
  donVi: '',
  kind: 'cong',
  diem: row.diem,
  cap: subOf(row.nhom) || nhomOf(row.tieu_chi),
  quyTac: row.quy_tac
}));

const khung = { '2A': khungMap(src.bang_2A_khung_diem_nhom), '2B': khungMap(src.bang_2B_khung_diem_nhom) };

const catalog = `// Sinh bởi scripts/build-cham-diem.mjs từ data/cham-diem/tieu-chi.json (NQ 111/2025/UBTVQH15). Không sửa tay.
export const PHU_LUC_I = ${JSON.stringify(phuLucI)};
export const BANG_2A = ${JSON.stringify(bang2A)};
export const BANG_2B = ${JSON.stringify(bang2B)};
export const DIEM_CONG = ${JSON.stringify(diemCong)};
export const KHUNG = ${JSON.stringify(khung)};
`;

const catalogPath = path.join(root, 'public/js/chamDiemCatalog.js');
fs.writeFileSync(catalogPath, catalog);

function urbanIds() {
  const ids = new Set();
  for (const u of [...URBANS, ...URBANS_VISION]) {
    if (u.id && u.id !== 'hue' && !u.city) ids.add(u.id);
  }
  return [...ids].sort();
}

const wards = Object.keys(DVHC_WARDS).map(name => ({ name, code: areaCodeFromName(name) })).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
const codes = wards.map(w => w.code);
if (new Set(codes).size !== codes.length) throw new Error('Trùng mã phường/xã');

const ky = '2026-Q1';
const lines = ['ma_don_vi,loai_don_vi,ma_tieu_chi,ky,gia_tri,nguon,ghi_chu'];
const push = (ma, loai, id) => lines.push(`${ma},${loai},${id},${ky},,,`);
for (const c of phuLucI) push('hue', 'hue', c.id);
for (const id of urbanIds()) for (const c of bang2A) push(id, 'dothi', c.id);
for (const w of wards) {
  for (const c of bang2B) push(w.code, 'xa', c.id);
  for (const c of diemCong) push(w.code, 'xa', c.id);
}

const csv = lines.join('\n') + '\n';
const csvRel = path.join('data/cham-diem/du-lieu.csv');
const csvPub = path.join('public/data/cham-diem/du-lieu.csv');
fs.mkdirSync(path.dirname(path.join(root, csvRel)), { recursive: true });
fs.mkdirSync(path.dirname(path.join(root, csvPub)), { recursive: true });
fs.writeFileSync(path.join(root, csvRel), csv);
fs.writeFileSync(path.join(root, csvPub), csv);

const sum = (xs, k) => Math.round(xs.reduce((s, c) => s + Number(c[k] || 0), 0) * 100) / 100;
console.log(JSON.stringify({
  I: phuLucI.length,
  A: bang2A.length,
  B: bang2B.length,
  C: diemCong.length,
  maxA: sum(bang2A, 'diemMax'),
  minA: sum(bang2A, 'diemMin'),
  maxB: sum(bang2B, 'diemMax'),
  minB: sum(bang2B, 'diemMin'),
  urbans: urbanIds().length,
  wards: wards.length,
  rows: lines.length - 1
}));
