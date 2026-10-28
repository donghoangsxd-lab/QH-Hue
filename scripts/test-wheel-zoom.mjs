import { readFileSync } from 'fs';
import {
  wheelNotches, wheelPixels, classifyWheel, notchZoom, trackZoom, snapZoom, NOTCH_PX, TRACK_PX_PER_LEVEL
} from '../public/js/wheelZoom.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(NOTCH_PX === 40 && TRACK_PX_PER_LEVEL === 100, 'ngưỡng nấc');

const cases = [
  [{ deltaMode: 0, deltaY: -100 }, 1],
  [{ deltaMode: 0, deltaY: 100 }, -1],
  [{ deltaMode: 0, deltaY: -39 }, 0],
  [{ deltaMode: 0, deltaY: -40 }, 1],
  [{ deltaMode: 0, deltaY: -149 }, 1],
  [{ deltaMode: 0, deltaY: -150 }, 1],
  [{ deltaMode: 0, deltaY: -240 }, 1],
  [{ deltaMode: 0, deltaY: 240 }, -1],
  [{ deltaMode: 0, deltaY: -10 }, 0],
  [{ deltaMode: 1, deltaY: -1 }, 1],
  [{ deltaMode: 1, deltaY: -3 }, 1],
  [{ deltaMode: 1, deltaY: -6 }, 1],
  [{ deltaMode: 1, deltaY: 3 }, -1],
  [{ deltaMode: 2, deltaY: -1 }, 1],
  [{ deltaMode: 2, deltaY: 2 }, -1]
];
for (const [e, n] of cases) {
  const got = wheelNotches(e);
  assert(got === n, `nấc ${JSON.stringify(e)} = ${got}, muốn ${n}`);
}

assert(wheelPixels({ deltaMode: 0, deltaY: 12 }) === 12, 'pixel');
assert(wheelPixels({ deltaMode: 1, deltaY: 3 }) === 48, 'dòng');
assert(wheelPixels({ deltaMode: 1, deltaY: -3 }) === -48, 'dòng âm');
assert(wheelPixels({ deltaMode: 2, deltaY: 1 }) === 400, 'trang');
assert(wheelPixels({ deltaMode: 2, deltaY: -1 }) === -400, 'trang âm');

assert(classifyWheel({ deltaMode: 0, deltaY: -100, ctrlKey: true }).kind === 'track', 'pinch không thành nấc');
assert(classifyWheel({ deltaMode: 0, deltaY: -10 }).kind === 'track', 'trackpad');
assert(classifyWheel({ deltaMode: 0, deltaY: -100 }).kind === 'notch', 'nấc pixel');
assert(classifyWheel({ deltaMode: 0, deltaY: 0 }).kind === 'ignore', 'không delta');

const snap = { zoomDelta: 1, zoomSnap: 1, minZoom: 0, maxZoom: 22 };
assert(notchZoom(13, 1, snap) === 14, 'một nấc lên');
assert(notchZoom(13, -1, snap) === 12, 'một nấc xuống');
assert(notchZoom(13, 3, snap) === 16, 'ba nấc');
assert(notchZoom(13.4, 1, snap) === 14, 'làm tròn rồi cộng');
assert(notchZoom(13.6, -1, snap) === 13, 'làm tròn rồi trừ');
assert(notchZoom(22, 1, snap) === 22, 'kẹp max');
assert(notchZoom(0, -1, snap) === 0, 'kẹp min');

const deck = { zoomDelta: 1, zoomSnap: 0, minZoom: -4, maxZoom: 0.4 };
assert(Math.abs(notchZoom(-2.4, 1, deck) - -1.4) < 1e-9, '3D không làm tròn');
assert(notchZoom(-2.4, -2, deck) === -4, '3D kẹp min');

assert(Math.abs(trackZoom(13, -25) - 13.25) < 1e-9, 'trackpad 25px');
assert(Math.abs(trackZoom(13, 20) - 12.8) < 1e-9, 'trackpad ngược');
assert(trackZoom(13, -100) === 14, '100px = 1 mức');
assert(snapZoom(13.2, snap) === 13, 'snap xuống');
assert(snapZoom(13.6, snap) === 14, 'snap lên');
assert(snapZoom(13.5, snap) === 14, 'snap giữa');

let z = 12;
for (let i = 0; i < 5; i++) z = notchZoom(z, 1, snap);
assert(z === 17, `năm nấc liền ${z}`);

const mapJs = readFileSync(new URL('../public/js/mapEngine.js', import.meta.url), 'utf8');
const planJs = readFileSync(new URL('../public/js/planMap.js', import.meta.url), 'utf8');
const viewJs = readFileSync(new URL('../public/js/phanTich3d.js', import.meta.url), 'utf8');
const wheelJs = readFileSync(new URL('../public/js/wheelZoom.js', import.meta.url), 'utf8');
assert(mapJs.includes('bindNotchZoom(map)'), 'bản đồ chính chưa gắn');
assert(planJs.includes('bindNotchZoom(planMap)'), 'bản đồ quy hoạch chưa gắn');
assert(viewJs.includes('bindDeckNotchZoom('), 'cửa sổ 3D chưa gắn');
assert(viewJs.includes('scrollZoom: false'), 'deck vẫn tự zoom theo sigmoid');
assert(viewJs.includes('touchZoom: true'), 'pinch chạm 3D bị tắt');
assert(wheelJs.includes('scrollWheelZoom.disable'), 'chưa tắt handler bánh xe của Leaflet');
assert(!readFileSync(new URL('../public/js/localAdjust.js', import.meta.url), 'utf8').includes('bindNotchZoom'), 'đụng zoomSnap 0.25');
assert(!readFileSync(new URL('../public/js/scanGeoref.js', import.meta.url), 'utf8').includes('bindNotchZoom'), 'đụng bản đồ georef');

console.log('wheel zoom ok');
