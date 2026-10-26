import { readFileSync } from 'node:fs';
import { parseHeightIndex } from '../public/js/bldgHeight.js';
import { floorsFromHeight, planLimit, screenVerdict, buildupHtml, lotBuildupSlotHtml } from '../public/js/lotScreen.js';

const buf = readFileSync(new URL('../public/data/gba/bldg-hf.bin', import.meta.url));
const idx = parseHeightIndex(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const vin = idx.lookup(107.594238, 16.463008);
if (!(vin >= 150)) throw new Error(`Vinpearl ${vin}`);
if (floorsFromHeight(vin) !== 40) throw new Error(`tầng Vinpearl ${floorsFromHeight(vin)}`);
if (floorsFromHeight(67) !== 17) throw new Error('67 m');
if (planLimit({ coverage: 0.4, floors: '3-5', far: 2.5 }, 'coverage') !== 40) throw new Error('mật độ');
if (planLimit({ floors: '3-5' }, 'floors') !== 5) throw new Error('tầng');
const over = screenVerdict(55, 40, '%');
if (over.state !== 'over' || Math.abs(over.diff - 15) > 0.01) throw new Error('vượt');
const ok = screenVerdict(2, 3, 'tầng');
if (ok.state !== 'ok') throw new Error('đạt');
const html = buildupHtml({
  lotM2: 472.7, footM2: 2019, count: 16, minM: 15.2, maxM: 20.4
});
if (!html.includes('Số công trình trên đất') || !html.includes('16 công trình')) throw new Error(html);
if (!html.includes('Mật độ xây dựng') || !html.includes('Diện tích xây dựng')) throw new Error(html);
if (!html.includes('15') || !html.includes('20')) throw new Error(html);
const partial = buildupHtml({
  lotM2: 500, footM2: 100, count: 2
});
if (!partial.includes('chưa có')) throw new Error('thiếu chiều cao phải ghi chưa có');
const slot = lotBuildupSlotHtml();
if (!slot.includes('data-lot-buildup-run') || !slot.includes('Mật độ xây dựng')) {
  throw new Error('thẻ lô thiếu nút kiểm tra mật độ');
}
if (slot.includes('Đang đối chiếu')) throw new Error('nút không được tự đối chiếu');
const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
for (const rel of ['../public/js/mapEngine.js', '../public/js/qhctLayer.js']) {
  const file = src(rel);
  if (file.includes('Đang đối chiếu dấu chân')) throw new Error(`${rel} vẫn tự đối chiếu khi mở thẻ`);
  if (!file.includes('lotBuildupSlotHtml()')) throw new Error(`${rel} thiếu nút`);
}
const engine = src('../public/js/mapEngine.js');
if (!engine.includes('if (lotGeom) html += lotBuildupSlotHtml()')) throw new Error('lô hạ tầng thiếu nút mật độ');
if (!engine.includes('if (lotGeom) fillLotBuildup(popup, { geometry: lotGeom })')) throw new Error('lô hạ tầng không gắn phép tính mật độ');
const attach = src('../public/js/lotBuildup.js').split('export function attachLotBuildup')[1] || '';
const beforeClick = attach.split("addEventListener('click'")[0];
if (beforeClick.includes('compute(')) throw new Error('đối chiếu chạy trước khi bấm');
if (!attach.includes('el.textContent = LOADING')) throw new Error('thiếu trạng thái đang kiểm tra');
if (!src('../public/js/lotBuildup.js').includes("const LOADING = 'Đang đối chiếu dấu chân công trình…'")) {
  throw new Error('thiếu câu đang đối chiếu');
}
console.log('ok', vin);
