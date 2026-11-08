/**
 * Xuất public/data/qh-so-tay.json từ kết quả merge sổ tay (chỉ dòng đồ án cha).
 * Usage: node scripts/build-so-tay-catalog.mjs [--in DIR]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const inDir = (() => {
  const i = process.argv.indexOf('--in');
  return i >= 0
    ? process.argv[i + 1]
    : path.join(__dirname, 'data', 'so-tay-qh-merge');
})();
const outFile = path.join(root, 'public', 'data', 'qh-so-tay.json');

function parseHa(raw) {
  const s = String(raw || '')
    .replace(/\s/g, '')
    .replace(/[^\d,.\-]/g, '');
  if (!s || s === '-' || s === '–') return null;
  // 1.850,00 → 1850.00 ; 170,00 → 170
  const normalized = s.includes(',')
    ? s.replace(/\./g, '').replace(',', '.')
    : s;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const dm = JSON.parse(fs.readFileSync(path.join(inDir, 'DANH_MUC.json'), 'utf8'));
const rows = dm.rows || [];
const byMa = new Map();
for (const r of rows) {
  if (!r.Ma_do_an) continue;
  if (!byMa.has(r.Ma_do_an)) byMa.set(r.Ma_do_an, { parent: null, children: [] });
  const g = byMa.get(r.Ma_do_an);
  if (r.Loai_dong === 'do_an') g.parent = r;
  else g.children.push(r);
}

const items = [];
for (const [ma, g] of byMa) {
  const p = g.parent;
  if (!p) continue;
  const dccb = g.children.filter((c) => c.Loai_dong === 'dccb').length;
  const dinh = g.children.filter((c) => c.Loai_dong === 'dinh_chinh').length;
  items.push({
    ma: ma,
    ten: p['Tên quy hoạch'] || '',
    cap: p['Cấp độ quy hoạch'] || '',
    loai: p['Loại quy hoạch'] || '',
    dvhc: p.Don_vi_hanh_chinh || '',
    maDvhc: p.Ma_DVHC_nguon || '',
    diaDiem: p['Địa điểm quy hoạch'] || '',
    dienTichHa: parseHa(p['Quy mô diện tích (ha)']),
    dienTichText: p['Quy mô diện tích (ha)'] || '',
    danSo: p['Quy mô dân số dự báo (người)'] || '',
    quyetDinh: p['Số quyết định phê duyệt quy hoạch'] || '',
    ngay: p['Ngày phê duyệt'] || '',
    coQuan: p['Cơ quan phê duyệt quy hoạch'] || '',
    linkGis: p.Link_GIS || p['Cơ sở dữ liệu số địa lý (GIS)'] || '',
    soDccb: dccb,
    soDinhChinh: dinh,
    sttNguon: p.Stt_nguon || '',
    sheetNguon: p.Sheet_nguon || '',
    ghiChu: p.Ghi_chu_nguon || ''
  });
}

items.sort((a, b) => String(a.ten).localeCompare(String(b.ten), 'vi'));

const payload = {
  generatedAt: new Date().toISOString(),
  source: 'Sổ tay QH Huế (TT24) — merge 9 ĐVHC',
  count: items.length,
  items
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(payload));
console.log(`OK: ${items.length} đồ án → ${path.relative(root, outFile)}`);
