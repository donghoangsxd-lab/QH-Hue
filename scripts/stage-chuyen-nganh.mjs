// public/data/chuyen-nganh/{10000,25000} là symlink tới data/chuyen-nganh/.
// Git chỉ giữ symlink. Worker CI (CI=true) đổi thành thư mục thật lúc deploy vì bộ assets có thể không đi vào symlink.
// Chạy tay: node scripts/stage-chuyen-nganh.mjs --materialize
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('public/data/chuyen-nganh');
const scales = ['10000', '25000'];
const materialize = process.argv.includes('--materialize')
  || ['1', 'true'].includes(String(process.env.CI || '').toLowerCase())
  || process.env.WORKERS_CI === '1';

fs.mkdirSync(root, { recursive: true });

for (const scale of scales) {
  const link = path.join(root, scale);
  const target = path.resolve('data/chuyen-nganh', scale);
  const rel = path.relative(root, target);
  if (!fs.existsSync(target)) {
    console.error('Thiếu', target);
    process.exit(1);
  }
  const exists = fs.existsSync(link) || fs.lstatSync(link, { throwIfNoEntry: false });
  if (!exists) {
    fs.symlinkSync(rel, link, 'dir');
    continue;
  }
  const st = fs.lstatSync(link);
  if (materialize && st.isSymbolicLink()) {
    fs.rmSync(link);
    fs.cpSync(target, link, { recursive: true });
    console.log('Đã bung', scale);
  } else if (!st.isSymbolicLink() && !st.isDirectory()) {
    console.error('Không phải symlink hay thư mục:', link);
    process.exit(1);
  }
}

const sample = path.join(root, '10000/giao-thong/hien-trang/hien-trang-cong-trinh-dau-moi-giao-thong.geojson');
if (!fs.existsSync(sample)) {
  console.error('Không đọc được', sample);
  process.exit(1);
}
console.log(materialize ? 'chuyen-nganh: da bung ban sao luc deploy' : 'chuyen-nganh: symlink ok');
