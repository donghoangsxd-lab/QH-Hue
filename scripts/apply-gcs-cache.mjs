// Gắn Cache-Control cho object đã chốt. Mặc định chỉ in. Không chạy trong CI.
//   node scripts/apply-gcs-cache.mjs
//   node scripts/apply-gcs-cache.mjs --apply
// Cần GEE_PRIVATE_KEY (service account đang ghi bucket). Mỗi object cần sửa là một Class A.
import { pathToFileURL } from 'node:url';
import { cacheControlFor } from '../config/gcsCachePolicy.mjs';

const PREFIXES = [
  'infrastructure_hue.json',
  'cadastre/thuadat-2016.pmtiles',
  'gba/buildings.pmtiles',
  'cache/sat/v1/',
  'chuyen-nganh/v1/'
];

function parseArgs(argv) {
  const out = { apply: false, prefix: '' };
  for (const arg of argv) {
    if (arg === '--apply') out.apply = true;
    else if (arg.startsWith('--prefix=')) out.prefix = arg.slice('--prefix='.length);
  }
  return out;
}

function plan(name, current) {
  const desired = cacheControlFor(name);
  const cur = String(current || '').trim();
  return { name, desired, change: Boolean(desired) && cur !== desired };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const gcs = await import('../services/gcsWrite.js');
  const prefixes = args.prefix ? [args.prefix] : PREFIXES;
  let seen = 0;
  let todo = 0;
  let done = 0;
  for (const prefix of prefixes) {
    let page = '';
    do {
      const batch = await gcs.listObjects(prefix, page);
      for (const item of batch.items) {
        seen += 1;
        const row = plan(item.name, item.cacheControl);
        if (!row.change) continue;
        todo += 1;
        console.log(`${args.apply ? 'sửa' : 'sẽ sửa'} ${row.name}`);
        console.log(`  ${row.desired}`);
        if (args.apply) {
          await gcs.patchCacheControl(row.name, row.desired);
          done += 1;
        }
      }
      page = batch.nextPageToken;
    } while (page);
  }
  console.log(`Đã xem ${seen}, cần sửa ${todo}${args.apply ? `, đã sửa ${done}` : ' (chưa ghi, thêm --apply)'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

export { parseArgs, plan, PREFIXES };
