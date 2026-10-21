import fs from 'fs';
import {
  clampRadius, parseCenter, circleRing, clipRing, ringArea, shannon, clipSegment, tilesFor
} from '../public/js/phanTich3d.js';

const clip = circleRing(100, 64);
const cut = clipRing([[-10, -10], [10, -10], [10, 10], [-10, 10]], clip);
const area = ringArea(cut);
if (Math.abs(area - 400) > 1) throw new Error(`diện tích vuông ${area}`);
if (clipRing([[200, 200], [220, 200], [220, 220], [200, 220]], clip)) throw new Error('vòng ngoài vòng tròn vẫn còn');

const h = shannon(new Map([['a', 10], ['b', 10]]));
if (Math.abs(h - Math.log(2)) > 1e-9) throw new Error(`shannon ${h}`);
if (shannon(new Map([['a', 5]])) !== null) throw new Error('một nhóm vẫn có chỉ số');

if (clampRadius('x') !== 500 || clampRadius(10) !== 150 || clampRadius(5000) !== 800) throw new Error('bán kính');
const p = parseCenter('?lat=16.4637&lng=107.5952&r=500&view=gop');
if (p.lat !== 16.4637 || p.lng !== 107.5952 || p.r !== 500 || p.view !== 'gop') throw new Error('tham số');
if (parseCenter('?lat=1&lng=1').lat !== 16.4637) throw new Error('tâm mặc định');
const tiles = tilesFor(16.4637, 107.5952, 500);
if (tiles.length < 4 || tiles.length > 12) throw new Error(`số tile ${tiles.length}`);
const seg = clipSegment([-1000, 0], [1000, 0], 500);
const len = Math.hypot(seg[0][1][0] - seg[0][0][0], seg[0][1][1] - seg[0][0][1]);
if (Math.abs(len - 1000) > 1) throw new Error(`cắt đoạn ${len}`);

const html = fs.readFileSync(new URL('../public/phan-tich-3d.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../public/js/phanTich3d.js', import.meta.url), 'utf8');
for (const s of ['Tách lớp', 'Gộp khối', 'phanTich3d.js']) {
  if (!html.includes(s)) throw new Error(`html thiếu ${s}`);
}
for (const s of ['Khối tích', 'Không gian mở', 'Chức năng sử dụng', 'Liên kết', 'Không tính được.', 'Không có.']) {
  if (!js.includes(s)) throw new Error(`js thiếu ${s}`);
}
if (js.includes('tầng =') || js.includes('floors =')) throw new Error('có công thức số tầng');
const api = fs.readFileSync(new URL('../api/pmtilesRange.js', import.meta.url), 'utf8');
if (!api.includes('buildings.pmtiles') || !api.includes('thuadat-2016.pmtiles')) throw new Error('thiếu tệp tile');
if (/req\.query\.(u|url|data)\b/.test(api)) throw new Error('proxy nhận URL tự do');
const osm = fs.readFileSync(new URL('../api/osmClip.js', import.meta.url), 'utf8');
if (!osm.includes('queryFor') || /req\.query\.(u|url|data|q)\b/.test(osm)) throw new Error('osm nhận câu truy vấn tự do');

console.log('ok');
