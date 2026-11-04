import fs from 'fs';
import { createRequire } from 'module';
import { clipPathAtParcel, accessLabelAnchor } from '../public/js/accessRouteGeom.js';

const require = createRequire(import.meta.url);
// Turf UMD không có export ESM; nạp qua createRequire khi có bản CJS, không thì mock tối thiểu.
let turfApi = null;
try {
  turfApi = require('@turf/turf');
} catch (e) {
  turfApi = null;
}

const css = fs.readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../public/js/mapEngine.js', import.meta.url), 'utf8');
const geom = fs.readFileSync(new URL('../public/js/accessRouteGeom.js', import.meta.url), 'utf8');

if (!css.includes('inspect-lot-chip') || !css.includes('rgba(15, 23, 42, 0.78)')) {
  throw new Error('CSS chip nhãn tiếp cận');
}
if (!css.includes('white-space: nowrap') || !css.includes('inspect-pins-tight')) {
  throw new Error('CSS chữ ngang / zoom thấp');
}
if (!js.includes("dashArray: '7,8'") || !js.includes('clipPathAtParcel') || !js.includes('accessLabelAnchor')) {
  throw new Error('JS tuyến đứt hoặc cắt path');
}
if (!js.includes('INSPECT_INNER_OPACITY = 0.42') || !js.includes('soft = false')) {
  throw new Error('opacity âm bản / viền soft');
}
if (!js.includes('bindAccessPinLayout') || !js.includes('layoutAccessPins')) {
  throw new Error('thiếu né va chạm nhãn');
}
if (!js.includes('inspect-lot-chip') || !js.includes('ACCESS_PIN_W')) {
  throw new Error('thiếu chip DivIcon');
}
if (!geom.includes('clipPathAtParcel') || !geom.includes('accessLabelAnchor')) {
  throw new Error('thiếu accessRouteGeom');
}

const square = {
  type: 'Polygon',
  coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]]
};
// [lat, lng]: từ ngoài (tây) vào trong lô
const path = [
  [0.005, -0.005],
  [0.005, 0.002],
  [0.005, 0.008]
];

if (turfApi) {
  const clipped = clipPathAtParcel(path, square, turfApi);
  if (clipped.length < 2) throw new Error(`cắt path quá ngắn ${clipped.length}`);
  if (clipped[clipped.length - 1][1] >= 0.008) {
    throw new Error(`chưa cắt đoạn vào tâm: ${JSON.stringify(clipped)}`);
  }
  if (clipped[clipped.length - 1][1] > 0.002) {
    throw new Error(`điểm cắt lệch mép: ${JSON.stringify(clipped)}`);
  }
  const anchor = accessLabelAnchor(0.005, -0.01, { lat: 0.005, lng: 0.005 }, square, turfApi);
  if (!Number.isFinite(anchor[0]) || !Number.isFinite(anchor[1])) throw new Error('neo nhãn');
} else {
  const same = clipPathAtParcel(path, square, null);
  if (same !== path) throw new Error('không turf phải trả path gốc');
  const a = accessLabelAnchor(1, 2, { lat: 3, lng: 4 }, null, null);
  if (a[0] !== 3 || a[1] !== 4) throw new Error('neo không geometry');
}

console.log('ok');
