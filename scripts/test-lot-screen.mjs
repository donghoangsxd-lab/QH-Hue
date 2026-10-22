import { readFileSync } from 'node:fs';
import { parseHeightIndex } from '../public/js/bldgHeight.js';
import { floorsFromHeight, planLimit, screenVerdict, buildupHtml } from '../public/js/lotScreen.js';

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
  lotM2: 472.7, footM2: 100, count: 1, maxF: 2, meanF: 2, gfaM2: 200, missingHeight: 0, heightReady: true,
  plan: { coverage: 40, floors: 3, far: 2 }
});
if (!html.includes('đạt') || !html.includes('Mật độ xây dựng')) throw new Error(html);
const partial = buildupHtml({
  lotM2: 500, footM2: 100, count: 2, maxF: 4, meanF: 4, gfaM2: 200, missingHeight: 1, heightReady: true,
  plan: { coverage: 40, floors: 3 }
});
if (!partial.includes('chưa kết luận')) throw new Error('thiếu chiều cao vẫn kết luận');
console.log('ok', vin);
