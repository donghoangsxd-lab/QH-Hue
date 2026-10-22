import fs from 'fs';
import {
  clampRadius, parseCenter, circleRing, squareRing, clipRing, ringArea, shannon, clipSegment, tilesFor,
  floorsFromHeight, floorBin, parseHeightIndex
} from '../public/js/phanTich3d.js';

const clip = circleRing(100, 64);
const cut = clipRing([[-10, -10], [10, -10], [10, 10], [-10, 10]], clip);
const area = ringArea(cut);
if (Math.abs(area - 400) > 1) throw new Error(`diện tích vuông ${area}`);
if (clipRing([[200, 200], [220, 200], [220, 220], [200, 220]], clip)) throw new Error('vòng ngoài vòng tròn vẫn còn');

const h = shannon(new Map([['a', 10], ['b', 10]]));
if (Math.abs(h - Math.log(2)) > 1e-9) throw new Error(`shannon ${h}`);
if (shannon(new Map([['a', 5]])) !== null) throw new Error('một nhóm vẫn có chỉ số');

if (floorsFromHeight(4) !== 1 || floorsFromHeight(8) !== 2 || floorsFromHeight(0) !== null) {
  throw new Error(`số tầng ${floorsFromHeight(4)} ${floorsFromHeight(8)}`);
}
if (floorBin(2) !== 0 || floorBin(5) !== 1 || floorBin(10) !== 2 || floorBin(48) !== 3 || floorBin(61) !== 3) {
  throw new Error('nhóm tầng');
}
const sq = squareRing(100);
if (sq.length !== 4 || ringArea(sq) !== 40000) throw new Error('ô vuông');
const cutSq = clipRing([[-200, -200], [200, -200], [200, 200], [-200, 200]], squareRing(50));
if (Math.abs(ringArea(cutSq) - 10000) > 1) throw new Error(`cắt ô ${ringArea(cutSq)}`);
const cutDisc = clipRing([[-200, -200], [200, -200], [200, 200], [-200, 200]], circleRing(50, 64));
if (Math.abs(ringArea(cutDisc) - Math.PI * 2500) > 40) throw new Error(`cắt tròn ${ringArea(cutDisc)}`);

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
for (const s of ['Tách lớp', 'Gộp khối', 'Khoảng cách lớp', 'phanTich3d.js']) {
  if (!html.includes(s)) throw new Error(`html thiếu ${s}`);
}
for (const s of ['Khối tích', 'Không gian mở', 'Tiếp cận hạ tầng', 'Liên kết', 'Không có số liệu.', 'h / 4', '1-2 tầng', '3-5 tầng', '6-10 tầng', '11-50 tầng', 'fovy: FOV_Y', 'Math.PI * r * r']) {
  if (!js.includes(s)) throw new Error(`js thiếu ${s}`);
}
if (js.includes('CLASS_DRAW') || js.includes('Không tính được.')) throw new Error('vẫn đùn theo nhóm hoặc chưa có mét');
const bin = fs.readFileSync(new URL('../public/data/gba/bldg-hf.bin', import.meta.url));
if (bin.slice(0, 4).toString() !== 'GBH2') throw new Error('thiếu chiều cao');
const idx = parseHeightIndex(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
let found = null;
for (let i = 0; i < 10; i++) {
  const h = idx.lookup(107.5952 + (i - 5) * 0.00035, 16.4637 + ((i % 4) - 1) * 0.00028);
  if (h) found = h;
}
if (found == null || found < 1 || found > 80) throw new Error(`chiều cao Hùng Vương ${found}`);
const vin = idx.lookup(107.594238, 16.463008);
if (vin < 150) throw new Error(`Vinpearl ${vin}`);
if (!js.includes('bldg-overrides.geojson')) throw new Error('thiếu dấu chân tháp bổ sung');
if (!js.includes('min_height') || !js.includes('z0')) throw new Error('thiếu khối đế nổi');
const ov = JSON.parse(fs.readFileSync(new URL('../public/data/gba/bldg-overrides.geojson', import.meta.url), 'utf8'));
const vinFeat = ov.features.find((f) => f.properties.id === 'vinpearl');
const vinParts = vinFeat.properties.parts;
const podium = vinParts.find((p) => p.role === 'podium');
const tower = vinParts.find((p) => p.role === 'tower');
if (vinFeat.properties.publishedFloors !== 39 || podium.floors !== 5 || tower.floors !== 34) {
  throw new Error('số tầng Vinpearl');
}
if (tower.height !== 160 || tower.height <= podium.height) throw new Error('chiều cao tháp bị trần');
if (Math.abs(podium.height - (160 * 5) / 39) > 0.02) throw new Error(`chiều cao đế ${podium.height}`);
const manor = ov.features.find((f) => f.properties.id === 'manor-a');
if (manor.properties.parts[0].height !== 74.9 || manor.properties.parts[0].floors !== 19) {
  throw new Error('Manor vẫn bị trần 67 m');
}
if (!Array.isArray(ov.massing) || ov.massing.length < 13) throw new Error('thiếu bảng khối');
const api = fs.readFileSync(new URL('../api/pmtilesRange.js', import.meta.url), 'utf8');
if (!api.includes('buildings.pmtiles') || !api.includes('thuadat-2016.pmtiles')) throw new Error('thiếu tệp tile');
if (/req\.query\.(u|url|data)\b/.test(api)) throw new Error('proxy nhận URL tự do');
const osm = fs.readFileSync(new URL('../api/osmClip.js', import.meta.url), 'utf8');
if (!osm.includes('queryFor') || /req\.query\.(u|url|data|q)\b/.test(osm)) throw new Error('osm nhận câu truy vấn tự do');
const mapJs = fs.readFileSync(new URL('../public/js/mapEngine.js', import.meta.url), 'utf8');
if (!mapJs.includes('class="proof-btn pp-3d"') || /phan-tich-3d\.html\?[^`]*target="_blank"/.test(mapJs)) {
  throw new Error('nút Xem 3D vẫn mở tab mới');
}
const panel = fs.readFileSync(new URL('../public/js/view3dPanel.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8');
if (!panel.includes('openView3d') || !css.includes('.view3d-panel') || !css.includes('(orientation: landscape) and (max-height: 520px)')) {
  throw new Error('thiếu khung 3D nổi');
}
if (!js.includes('orthographic: false') || !js.includes('WHITE_BLOCK') || !js.includes('openBloom')) {
  throw new Error('thiếu phối cảnh, khối trắng hoặc vầng không gian mở');
}

console.log('ok');
