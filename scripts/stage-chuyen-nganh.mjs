// public/data/chuyen-nganh/<scheme> là symlink tới data/chuyen-nganh/<scheme>.
// Git chỉ giữ symlink. Worker CI (CI=true) đổi thành thư mục thật lúc deploy vì bộ assets có thể không đi vào symlink.
// Chạy tay: node scripts/stage-chuyen-nganh.mjs --materialize
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('public/data/chuyen-nganh');
const dataRoot = path.resolve('data/chuyen-nganh');
const materialize = process.argv.includes('--materialize')
  || ['1', 'true'].includes(String(process.env.CI || '').toLowerCase())
  || process.env.WORKERS_CI === '1';

fs.mkdirSync(root, { recursive: true });
const schemes = fs.readdirSync(dataRoot).filter((name) => fs.statSync(path.join(dataRoot, name)).isDirectory());
if (!schemes.length) {
  console.error('Thiếu thư mục đồ án trong', dataRoot);
  process.exit(1);
}

for (const name of fs.readdirSync(root)) {
  if (name === 'index.json' || name === 'schemes.json' || schemes.includes(name)) continue;
  const link = path.join(root, name);
  if (fs.lstatSync(link).isSymbolicLink()) fs.rmSync(link);
}

for (const name of schemes) {
  const link = path.join(root, name);
  const target = path.join(dataRoot, name);
  const rel = path.relative(root, target);
  const exists = fs.existsSync(link) || fs.lstatSync(link, { throwIfNoEntry: false });
  if (!exists) {
    fs.symlinkSync(rel, link, 'dir');
    continue;
  }
  const st = fs.lstatSync(link);
  if (materialize && st.isSymbolicLink()) {
    fs.rmSync(link);
    fs.cpSync(target, link, { recursive: true });
    console.log('Đã bung', name);
  } else if (!st.isSymbolicLink() && !st.isDirectory()) {
    console.error('Không phải symlink hay thư mục:', link);
    process.exit(1);
  }
}

const sample = path.join(root, 'qhc-do-thi-trung-tam-thua-thien-hue-1-10-000-9406ec72/giao-thong/hien-trang/hien-trang-cong-trinh-dau-moi-giao-thong.geojson');
if (!fs.existsSync(sample)) {
  console.error('Không đọc được', sample);
  process.exit(1);
}
console.log(materialize ? 'chuyen-nganh: da bung ban sao luc deploy' : 'chuyen-nganh: symlink ok');
