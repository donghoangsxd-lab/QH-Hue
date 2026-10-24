import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, root), 'utf8');
const html = read('public/index.html');

function innerById(src, id) {
  const open = new RegExp(`<(?<tag>[a-zA-Z0-9:-]+)(?<attrs>[^>]*?)\\bid=["']${id}["'][^>]*>`).exec(src);
  assert.ok(open, `thiếu #${id}`);
  const tag = open.groups.tag.toLowerCase();
  const from = open.index + open[0].length;
  if (open[0].endsWith('/>')) return '';
  const token = /<\/?([a-zA-Z0-9:-]+)(?:\s[^>]*)?>/g;
  token.lastIndex = from;
  let depth = 1;
  let t;
  while ((t = token.exec(src))) {
    if (t[1].toLowerCase() !== tag) continue;
    if (t[0].startsWith('</')) depth -= 1;
    else if (!t[0].endsWith('/>')) depth += 1;
    if (depth === 0) return src.slice(from, t.index);
  }
  assert.fail(`#${id} không đóng`);
}

const TITLES = [
  ['hanhchinh', 'Quản lý đơn vị hành chính'],
  ['quyhoach', 'Hệ thống bản đồ quy hoạch'],
  ['hatang', 'Hệ thống hạ tầng kỹ thuật'],
  ['xahoi', 'Hệ thống hạ tầng xã hội'],
  ['kientruc', 'Quản lý lĩnh vực kiến trúc']
];

assert.match(html, /<body[^>]*\bright-collapsed\b/);
assert.doesNotMatch(html, /id="levelHost"/);
assert.doesNotMatch(html, /id="levelPick"/);
assert.doesNotMatch(html, /id="layerMap"/);
assert.doesNotMatch(html, /id="btnMapLevel"/);
assert.doesNotMatch(html, /Lớp đang xem/);
assert.doesNotMatch(html, /Bản đồ nền và bản đồ môi trường/);
assert.doesNotMatch(html, /data-map-tab=/);

const main = innerById(html, 'layerMain');
for (const id of ['layerPaneHanhChinh', 'layerPaneQuyHoach', 'layerPaneHaTang', 'layerPaneXaHoi', 'layerPaneKienTruc']) {
  assert.ok(main.includes(`id="${id}"`), `#${id} nằm ngoài #layerMain`);
}

const mag = innerById(html, 'layerMag');
const track = innerById(html, 'layerMagTrack');
let cursor = 0;
for (const [id, title] of TITLES) {
  const at = track.indexOf(`data-main-tab="${id}"`);
  assert.ok(at > cursor, `sai thứ tự panel ${id}`);
  cursor = at;
  assert.ok(track.includes(`>${title}<`), `thiếu tiêu đề ${title}`);
  assert.ok(track.includes(`title="${title}"`), `thiếu title ${title}`);
}
assert.match(mag, /id="btnCollapseRightPanel"/);
assert.match(mag, /id="layerMagMenu"/);
assert.match(mag, /data-mag-step="-1"/);
assert.match(mag, /data-mag-step="1"/);

const tools = innerById(html, 'layerTools');
assert.match(tools, /id="layerSearch"/);
assert.match(tools, /data-view-mode="HT"/);
assert.match(tools, /data-view-mode="QH"/);
assert.match(tools, /id="btnAxisAll"/);

const admin = innerById(html, 'layerPaneHanhChinh');
const urban = innerById(html, 'levelPickUrban');
assert.match(admin, /data-admin-tab="dothi"/);
assert.match(admin, /data-admin-tab="dvhc"/);
assert.match(admin, /id="levelPickUrban"/);
assert.match(urban, /data-level="urban"/);
assert.match(urban, /Hệ thống đô thị/);
assert.match(admin, /id="axisBaseFold"/);
assert.match(admin, /id="basemapSelect"/);
assert.match(admin, /id="chk_bound"/);
assert.match(admin, /id="chk_roads"/);
assert.match(admin, /id="chk_cadastre"/);
assert.doesNotMatch(urban, /data-level="qhc25"/);

const plan = innerById(html, 'layerPaneQuyHoach');
const pick = innerById(html, 'levelPickQh');
let levelAt = 0;
for (const [id, label] of [
  ['qhc25', 'QHC 1/25.000'],
  ['qhc10', 'QHC 1/10.000'],
  ['qhpk', 'QHPK 1/2.000'],
  ['qhct', 'QHCT 1/500']
]) {
  const at = pick.indexOf(`data-level="${id}"`);
  assert.ok(at > levelAt, `sai thứ tự cấp ${label}`);
  levelAt = at;
  assert.ok(pick.slice(at, at + 240).includes(label), `thiếu nhãn ${label}`);
}
assert.doesNotMatch(pick, /data-level="urban"/);
assert.match(plan, /id="levelSplit"/);
assert.match(plan, /id="splitSideLeft"/);
assert.match(plan, /id="splitSideRight"/);

const tech = innerById(html, 'layerPaneHaTang');
const social = innerById(html, 'layerPaneXaHoi');
assert.match(tech, /id="axisEnvFold"/);
assert.match(tech, /id="chk_terrain"/);
assert.match(tech, /id="isoSlotHaTang"/);
assert.match(social, /id="isoSlotXaHoi"/);
assert.match(social, /id="inputIsoRadius"/);
assert.match(social, /Giả lập bán kính chung/);
assert.match(social, /id="chk_c1"/);
assert.match(social, /id="chk_edu"/);
assert.doesNotMatch(admin, /id="inputIsoRadius"/);
assert.doesNotMatch(plan, /id="inputIsoRadius"/);

assert.match(html, /<div class="tab-body map-float" id="tabLegend"/);
const legend = innerById(html, 'tabLegend');
assert.match(legend, /id="parcelLegend"/);
assert.match(legend, />Chú giải</);

const title = innerById(html, 'mapTitle');
assert.match(html, /<header class="map-title map-intro" id="mapTitle"/);
assert.match(title, /class="map-intro-kicker"/);
assert.match(title, /id="mapTitleText"/);
assert.match(title, /class="map-intro-line"/);
assert.match(title, /id="btnMapCatalog"/);
assert.match(title, /id="btnTitleDismiss"/);
assert.doesNotMatch(title, /btnMapLevel|map-title-level/);

const ctx = read('public/js/mapContext.js');
for (const label of [
  'Xem thông tin thửa đất',
  'Xem thông tin quy hoạch',
  'Xem khả năng tiếp cận hạ tầng',
  'Xem thông tin địa điểm',
  'Đánh dấu và ghi chú',
  'Đo khoảng cách',
  'Đo diện tích',
  'Xóa kết quả đo',
  'Xem Street View'
]) {
  assert.ok(ctx.includes(label), `menu chuột phải thiếu ${label}`);
}
assert.match(ctx, /map-ctx-menu/);

const engine = read('public/js/mapEngine.js');
assert.match(engine, /function landPopupHtml/);
assert.match(engine, /land-lot-popup/);
assert.match(engine, /class="lp-title"/);

const levelJs = read('public/js/mapLevel.js');
assert.match(levelJs, /data-level-pick/);
assert.doesNotMatch(levelJs, /getElementById\('levelPick'\)/);
assert.match(read('public/js/chuyenNganh.js'), /isoSlotHaTang/);
assert.match(read('public/js/chuyenNganh.js'), /isoSlotXaHoi/);

console.log('core ui ok');
