// Tiền xử lý khi agent nhập đồ án: bỏ lô sử dụng đất ngoài ranh, cắt lô vắt ranh, ghi nhật ký.
// Không gọi máy chủ. Không ghép và không xóa lô hạ tầng.
// node scripts/clip-scheme-lots.mjs --land <geojson> --boundary <geojson> [--out <geojson>] [--log docs/cat-lo-ngoai-ranh.jsonl]
import fs from 'node:fs';
import path from 'node:path';
import * as turf from '@turf/turf';

globalThis.turf = turf;
const { clipSchemeLots, schemeBoundaryOf, clipSentence, SCHEME_EDGE_M } = await import('../public/js/schemeLotClip.js');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : '';
}

function readFc(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.type === 'FeatureCollection') return data.features || [];
  if (data.type === 'Feature') return [data];
  throw new Error(`Không đọc được GeoJSON: ${file}`);
}

const landFile = arg('--land');
const boundaryFile = arg('--boundary');
const outFile = arg('--out');
const logFile = arg('--log') || 'docs/cat-lo-ngoai-ranh.jsonl';
if (!landFile || !boundaryFile) {
  console.error('Cần --land và --boundary.');
  process.exit(1);
}

const boundary = schemeBoundaryOf(readFc(boundaryFile));
if (!boundary) {
  console.error('Ranh đồ án chưa khép thành vùng. Không cắt.');
  process.exit(1);
}
const clip = clipSchemeLots(readFc(landFile), boundary);
const line = clipSentence(clip.counts);
console.log(`${path.basename(landFile)}: ${line}`);
if (!outFile) {
  console.log('Chưa ghi file. Thêm --out để ghi lớp đã lọc.');
  process.exit(0);
}
const fc = { type: 'FeatureCollection', features: clip.features };
fs.writeFileSync(outFile, JSON.stringify(fc));
const entry = {
  at: new Date().toISOString(),
  land: landFile,
  boundary: boundaryFile,
  out: outFile,
  edgeM: SCHEME_EDGE_M,
  bo: clip.counts.bo,
  cat: clip.counts.cat,
  giu: clip.counts.giu
};
fs.mkdirSync(path.dirname(logFile), { recursive: true });
fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
console.log(`Đã ghi ${outFile}. Nhật ký ${logFile}: bỏ ${clip.counts.bo} lô.`);
