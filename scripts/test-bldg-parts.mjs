import fs from 'fs';
import { confirmedPartFeatures, partFloorLabel } from '../public/js/bldgParts.js';

const ov = JSON.parse(fs.readFileSync(new URL('../public/data/gba/bldg-overrides.geojson', import.meta.url), 'utf8'));
const fc = confirmedPartFeatures(ov);
const ids = fc.features.map((f) => f.properties.id);
if (ids.filter((id) => id === 'vinpearl').length !== 2) throw new Error(`Vincom ${ids.filter((id) => id === 'vinpearl').length}`);
const vin = fc.features.filter((f) => f.properties.id === 'vinpearl');
const vinPodium = vin.find((f) => f.properties.role === 'podium');
const vinTower = vin.find((f) => f.properties.role === 'tower');
if (!vinPodium || !vinTower) throw new Error('Vincom thiếu đế hoặc tháp');
if (vinPodium.properties.floors !== 5 || vinTower.properties.floors !== 34) {
  throw new Error(`tầng phần ${vinPodium.properties.floors}/${vinTower.properties.floors}`);
}
if (partFloorLabel('podium', 5) !== 'Đế 5' || partFloorLabel('tower', 34) !== 'Tháp 34') throw new Error('nhãn đế tháp');
const vinPublished = ov.features.find((f) => f.properties.id === 'vinpearl').properties.labelFloors;
if (partFloorLabel('tower', vinPublished) === partFloorLabel('tower', vinTower.properties.floors)) {
  throw new Error('nhãn tháp trùng số tầng cả khối');
}
if (partFloorLabel('', 34) || partFloorLabel('tower', 0)) throw new Error('nhãn rỗng');
for (const id of ['manor-a', 'manor-b', 'indochine']) {
  if (!ids.includes(id)) throw new Error(`thiếu ${id}`);
}
if (ids.filter((id) => id === 'imperial').length !== 4) throw new Error('Imperial');
if (ids.some((id) => id === 'midtown' || String(id).startsWith('infer') || id.startsWith('NOXH'))) {
  throw new Error(`vẽ nhầm ${ids.join(',')}`);
}
const banned = ['La Vela', 'Nera Garden', 'White Lotus', 'Moonlight', 'Đông Dương', 'Prisma', 'West Sky'];
const blob = JSON.stringify(fc.features.map((f) => f.properties));
for (const name of banned) {
  if (blob.includes(name)) throw new Error(`tấm giả ${name}`);
}
const roles = fc.features.map((f) => f.properties.role);
if (roles.lastIndexOf('podium') > roles.indexOf('tower')) throw new Error('đế nằm trên tháp');
if (fc.features.length !== 9) throw new Error(`số tấm ${fc.features.length}`);

const undrawn = (ov.massing || []).filter((row) => !row.drawn);
if (!undrawn.some((row) => row.note && row.note.includes('Không vẽ tấm giả'))) throw new Error('thiếu lý do chưa vẽ');

const js = fs.readFileSync(new URL('../public/js/gbaLayer.js', import.meta.url), 'utf8');
const view = fs.readFileSync(new URL('../public/js/phanTich3d.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/phan-tich-3d.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/css/phan-tich-3d.css', import.meta.url), 'utf8');
if (!js.includes('confirmedPartFeatures') || !js.includes('applyParts') || !js.includes("role === 'podium'")) {
  throw new Error('bản đồ 2D chưa vẽ phần đã xác nhận');
}
if (!js.includes('partFloorLabel') || !js.includes('FLOOR_LABEL_ZOOM') || !js.includes('hidePublished')) {
  throw new Error('bản đồ 2D chưa ghi nhãn đế tháp');
}
if (!view.includes("id: 'part-floors'") || !view.includes('partFloorLabel(feat.role, f)') || !view.includes('dataset.partLabels')) {
  throw new Error('khối 3D chưa ghi nhãn đế tháp');
}
if (!view.includes('fontSettings: { sdf: true }')) throw new Error('nhãn 3D thiếu sdf nên viền cắt mất chữ');
if (!view.includes('if (raw.gba.length)')) throw new Error('lỗi tile làm mất tháp đã công bố');
if (view.includes('partFloorLabel(feat.role, props.labelFloors)')) throw new Error('tháp lấy số tầng cả khối');
if (!html.includes('id="massing"') || !html.includes('id="massingNote"')) throw new Error('thiếu bảng nhà cao');
if (!view.includes('paintMassing(model.massing') || !view.includes('small.textContent = row.note')) {
  throw new Error('bảng chưa ghi lý do chưa vẽ');
}
if (!css.includes('table.massing .off') || !css.includes('.mass-note')) throw new Error('thiếu kiểu bảng');
if (js.includes('La Vela') || fs.readFileSync(new URL('../public/js/bldgParts.js', import.meta.url), 'utf8').includes('La Vela')) {
  throw new Error('mã tự thêm tọa độ nhà chưa định vị');
}

console.log('ok');
