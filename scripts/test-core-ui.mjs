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
const tabs = innerById(html, 'adminTabs');
assert.ok(tabs.indexOf('data-admin-tab="dvhc"') < tabs.indexOf('data-admin-tab="dothi"'), 'Đơn vị hành chính đứng trước Đô thị');
assert.match(tabs, /Đơn vị hành chính/);
assert.match(tabs, /Đô thị/);
const urban = innerById(html, 'levelPickUrban');
assert.match(admin, /id="levelPickUrban"/);
assert.match(urban, /data-level="urban"/);
assert.match(urban, /Hệ thống đô thị/);
assert.match(admin, /id="gpList"/);
assert.match(admin, /id="chk_urban"/);
assert.match(admin, /Phân loại đô thị/);
assert.doesNotMatch(admin, /id="axisScopeAdmin"/);
assert.doesNotMatch(admin, /id="axisTownList"/);
const dock = innerById(html, 'rpDock');
assert.ok(dock.indexOf('id="legendFold"') < dock.indexOf('id="axisBaseFold"'), 'Chú giải nằm trên Lớp nền');
assert.match(dock, />Chú giải</);
assert.match(dock, />Lớp nền</);
assert.match(dock, /id="basemapSelect"/);
assert.match(dock, /id="chk_bound"/);
assert.match(dock, /id="chk_roads"/);
assert.match(dock, /id="chk_cadastre"/);
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

assert.match(html, /id="tabLegend"/);
const legend = innerById(html, 'tabLegend');
assert.match(legend, /id="parcelLegend"/);
assert.doesNotMatch(legend, /id="btnLegendClose"/);
assert.doesNotMatch(legend, /id="lotOpacity"/);
assert.doesNotMatch(legend, /Quyết định phê duyệt/);
const base = innerById(html, 'layerPaneBase');
assert.match(base, /id="lotOpacity"/);
assert.match(base, /Hiển thị lô đất/);
assert.match(base, /Quyết định phê duyệt/);

const title = innerById(html, 'mapTitle');
assert.match(html, /<header class="map-title map-intro" id="mapTitle"/);
assert.match(title, /class="map-intro-kicker"/);
assert.match(title, /id="mapTitleText"/);
assert.match(title, /class="map-intro-line"/);
assert.match(html, /id="btnOverview"/);
assert.doesNotMatch(title, /id="btnMapCatalog"/);
assert.doesNotMatch(title, />Mục lục</);
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

const cn = read('public/js/chuyenNganh.js');
assert.match(cn, /axis-area-city/);
assert.match(cn, /axis-area-pop/);
assert.match(cn, /Dân số/);
assert.match(cn, /DVHC_CITY\.name, null/);
const legendJs = read('public/js/legendPanel.js');
assert.match(legendJs, /new Set\(\['hanhchinh', 'kientruc'\]\)/);
assert.match(legendJs, /legendFoldEl\.hidden = legendOff\(\)/);
const css = read('public/css/style.css');
assert.match(css, /--axis-font:\s*var\(--font-sans\)/);
assert.match(css, /--axis-fs-header:\s*12px/);
assert.match(css, /--axis-fs-row:\s*12px/);
assert.match(css, /--axis-fs-chip:\s*11px/);
assert.match(css, /--axis-row-h:\s*22px/);
assert.match(css, /#legendFold\[hidden\]/);

console.log('core ui ok');
