/**
 * Xuất public/data/qh-so-tay.json từ merge sổ tay: đồ án cha + cụm ĐCCB/đính chính.
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
  const text = String(raw || '').trim();
  if (!text || text === '-' || text === '–') return null;
  // Chuỗi chú thích (vd. «Hết hiệu lực…») không phải diện tích số.
  if (/[a-zA-ZÀ-ỹ]/.test(text)) return null;
  const s = text.replace(/\s/g, '').replace(/[^\d,.\-]/g, '');
  if (!s) return null;
  const normalized = s.includes(',')
    ? s.replace(/\./g, '').replace(',', '.')
    : s;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 && n < 1e6 ? n : null;
}

function childOf(r) {
  return {
    id: r.Ma_thanh_phan || '',
    loaiDong: r.Loai_dong || '',
    ten: r['Tên quy hoạch'] || '',
    quyetDinh: r['Số quyết định phê duyệt quy hoạch'] || '',
    ngay: r['Ngày phê duyệt'] || '',
    coQuan: r['Cơ quan phê duyệt quy hoạch'] || '',
    dienTichText: r['Quy mô diện tích (ha)'] || '',
    danSo: r['Quy mô dân số dự báo (người)'] || '',
    ghiChu: r.Ghi_chu_nguon || ''
  };
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
let childCount = 0;
for (const [ma, g] of byMa) {
  const p = g.parent;
  if (!p) continue;
  const children = g.children
    .filter((c) => c.Loai_dong === 'dccb' || c.Loai_dong === 'dinh_chinh')
    .map(childOf);
  childCount += children.length;
  const dccb = children.filter((c) => c.loaiDong === 'dccb').length;
  const dinh = children.filter((c) => c.loaiDong === 'dinh_chinh').length;
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
    children,
    sttNguon: p.Stt_nguon || '',
    sheetNguon: p.Sheet_nguon || '',
    ghiChu: p.Ghi_chu_nguon || ''
  });
}

items.sort((a, b) => {
  const ca = String(a.cap || '');
  const cb = String(b.cap || '');
  if (ca !== cb) return ca.localeCompare(cb, 'vi');
  return String(a.ma || '').localeCompare(String(b.ma || ''), 'vi');
});

const payload = {
  generatedAt: new Date().toISOString(),
  source: 'Sổ tay QH Huế (TT24) — merge 9 ĐVHC',
  count: items.length,
  childCount,
  items
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(payload));
console.log(`OK: ${items.length} đồ án + ${childCount} ĐCCB/đính chính → ${path.relative(root, outFile)}`);
