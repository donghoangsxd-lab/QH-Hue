import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  HTKT_GROUPS, SNAP_TOLERANCE_M, SYNTH_LABEL, QHPK_HOOK_ID,
  isCotDenLayer, isPipeLine, isHydrantLayer, layerTags, qhpkLayersFromHook, withinSnap
} from '../public/js/htktModel.js';
import { planRadiusM, formatRadius, setPlanRadii } from '../public/js/planRadius.js';
import { shortPlaceName } from '../public/js/dvhcStats.js';
import { createSketchEditSession, minVertices } from '../public/js/sketchEdit.js';

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
  ['hanhchinh', 'A. Quản lý phát triển đô thị'],
  ['quyhoach', 'B. Hệ thống bản đồ quy hoạch'],
  ['hatang', 'C. Hệ thống hạ tầng kỹ thuật'],
  ['xahoi', 'D. Hệ thống hạ tầng xã hội'],
  ['kientruc', 'E. Quản lý về kiến trúc'],
  ['dautu', 'F. Dự án đầu tư']
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
for (const id of ['layerPaneHanhChinh', 'layerPaneQuyHoach', 'layerPaneHaTang', 'layerPaneXaHoi', 'layerPaneKienTruc', 'layerPaneDauTu']) {
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
assert.match(read('public/js/chuyenNganh.js'), /syncViewSwitchVisibility/);
assert.match(read('public/js/chuyenNganh.js'), /sw\.hidden = browseState\(\)\.axis === 'kientruc'/);
assert.match(read('docs/ui-spec.md'), /Kiến trúc không có nút HT\/QH/);

const admin = innerById(html, 'layerPaneHanhChinh');
const tabs = innerById(html, 'adminTabs');
assert.ok(tabs.indexOf('data-admin-tab="dvhc"') < tabs.indexOf('data-admin-tab="dothi"'), 'Đơn vị hành chính đứng trước Đô thị');
assert.match(tabs, />Đơn vị hành chính</);
assert.match(tabs, />Đô thị</);
assert.doesNotMatch(tabs, /\(40\)|\(25\)/);
assert.doesNotMatch(html, /id="levelPickUrban"/);
assert.doesNotMatch(admin, /Hệ thống đô thị/);
assert.match(admin, /id="gpList"/);
assert.match(admin, /id="chk_urban"/);
assert.match(admin, /Phân loại đô thị/);
assert.doesNotMatch(admin, /id="axisScopeAdmin"/);
assert.doesNotMatch(admin, /id="axisTownList"/);
const dock = innerById(html, 'rpDock');
assert.ok(dock.indexOf('id="legendFold"') < dock.indexOf('id="axisBaseFold"'), 'Chú giải đứng trước Lớp nền trong DOM');
assert.match(dock, /role="tablist"/);
assert.match(dock, /id="btnDockLegend"/);
assert.match(dock, /id="btnDockBase"/);
assert.ok(dock.indexOf('id="btnDockLegend"') < dock.indexOf('id="btnDockBase"'), 'Chú giải đứng trước Lớp nền');
assert.ok(dock.indexOf('id="btnDockBase"') < dock.indexOf('id="btnDockEnv"'), 'Lớp nền đứng trước Lớp môi trường');
assert.match(dock, /id="btnDockLegend"[^>]*aria-controls="legendFold"/);
assert.match(dock, /id="btnDockBase"[^>]*aria-controls="axisBaseFold"/);
assert.match(dock, /id="btnDockEnv"[^>]*aria-controls="axisEnvFold"/);
assert.match(dock, />Chú giải</);
assert.match(dock, />Lớp nền</);
assert.match(dock, />Lớp môi trường</);
const switchRow = dock.slice(dock.indexOf('class="dock-switch"'), dock.indexOf('id="legendFold"'));
assert.equal((switchRow.match(/class="dock-tab/g) || []).length, 3, 'Hàng tab đúng ba mục');
assert.ok(switchRow.indexOf('id="btnDockEnv"') < switchRow.indexOf('id="btnDockCollapse"'), 'Nút thu gọn nằm sau ba tab');
assert.match(switchRow, /id="btnDockCollapse"[^>]*aria-expanded="true"/);
assert.doesNotMatch(switchRow, /data-legend-set|QHPK 1\/2\.000/);
assert.match(dock, /id="axisEnvFold"/);
assert.match(dock, /id="btnFloodGap"/);
assert.match(dock, /id="floodGapTip"/);
assert.doesNotMatch(dock, /id="floodGapBox"/);
assert.doesNotMatch(dock, /Số nhà trong vùng ngập/);
assert.match(dock, /id="chk_terrain"/);
assert.match(dock, /id="legendLevelChips"[^>]*hidden/);
assert.match(dock, /id="basemapSelect"/);
assert.match(dock, /id="chk_bound"/);
assert.match(dock, /id="chk_roads"/);
assert.match(dock, /id="chk_cadastre"/);
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
assert.doesNotMatch(plan, /id="axisScopeQuyHoach"/);
assert.doesNotMatch(plan, /id="planPoints"/);
assert.doesNotMatch(plan, /id="baseQuyHoach"/);
assert.doesNotMatch(plan, /Dữ liệu hiện trạng/);
assert.doesNotMatch(plan, /Đồ án QHCT 1\/500/);
assert.match(plan, /id="chk_qhct"/);
const planJs = read('public/js/projectLayer.js');
const axisJs = read('public/js/chuyenNganh.js');
assert.match(planJs, /function paintLevelCounts/);
assert.doesNotMatch(planJs, /data-level-eye|function eyeHtml|class="pl-hrow"/);
assert.match(axisJs, /toggleActivePlanLevel/);
assert.match(axisJs, /browseState\(\)\.axis === 'quyhoach'/);
assert.match(read('public/js/mapLevel.js'), /emit\(prev, \{ keepView: true \}\)/);
const kienPane = innerById(html, 'layerPaneKienTruc');
assert.doesNotMatch(kienPane, /id="baseKienTruc"/);
assert.doesNotMatch(kienPane, /Dữ liệu hiện trạng/);
assert.doesNotMatch(read('public/js/chuyenNganh.js'), /paintBase\('kientruc'/);
assert.doesNotMatch(plan, /Thửa đất địa chính 2016/);
assert.doesNotMatch(plan, /Công trình vi phạm/);
assert.match(plan, /id="projectSearch"[^>]*hidden/);
assert.match(plan, /id="levelSplit"/);
assert.match(plan, /id="splitSideLeft"/);
assert.match(plan, /id="splitSideRight"/);
assert.match(html, /id="tbComparePick"/);
assert.match(html, /id="compareChooser"/);
assert.match(html, /data-split-kind="same"/);
assert.match(html, /data-split-kind="offset"/);
assert.match(html, />Đồng tâm</);
assert.match(html, />Lệch tâm</);
assert.match(read('public/js/app.js'), /function initCompareChooser/);
assert.match(read('public/js/splitPair.js'), /isAdminUrbanSplit/);
assert.match(read('public/js/splitPair.js'), /setClassicSplitSides/);
assert.match(read('public/js/chuyenNganh.js'), /applyAdminUrbanSplit/);
assert.match(read('public/js/chuyenNganh.js'), /setLevel\('urban'/);
assert.match(read('docs/ui-spec.md'), /Đồng tâm/);
assert.match(read('docs/ui-spec.md'), /hệ thống đô thị hiện trạng/);
const planMapJs = read('public/js/planMap.js');
assert.doesNotMatch(planMapJs, /offsetPx|shiftCenter|panBy\(\[offset/);
assert.match(planMapJs, /splitKind === 'offset'/);
assert.match(read('public/css/style.css'), /body\.split-offset\.compare-on #map\s*\{[^}]*right:\s*50%/);
assert.match(read('public/css/style.css'), /body\.split-offset\.compare-on #mapPlan\s*\{[^}]*left:\s*50%/);

function projectLayerAround(src, id) {
  const at = src.indexOf(`id="${id}"`);
  assert.ok(at > 0, id);
  const start = src.lastIndexOf('<div class="project-layer', at);
  assert.ok(start >= 0, `không thấy dòng lớp của ${id}`);
  const token = /<\/?div\b[^>]*>/g;
  const htmlSlice = src.slice(start);
  let depth = 0;
  let m;
  while ((m = token.exec(htmlSlice))) {
    if (m[0].startsWith('</')) depth -= 1;
    else if (!m[0].endsWith('/>')) depth += 1;
    if (depth === 0) return htmlSlice.slice(0, m.index + m[0].length);
  }
  assert.fail(`dòng lớp ${id} không đóng`);
}

for (const [roadId, railId, label] of [
  ['chk_gt25', 'chk_gt25rail', 'QH giao thông (toàn TP)'],
  ['chk_gt10', 'chk_gt10rail', 'QH giao thông (trung tâm)']
]) {
  const row = projectLayerAround(plan, roadId);
  assert.match(row, new RegExp(label.replace(/[()]/g, '\\$&')));
  assert.match(row, new RegExp(`id="${railId}"[^>]*\\bchecked\\b`));
  assert.match(row, /data-qhc-rail=/);
  assert.match(row, /class="project-rail"/);
  assert.match(row, /title="Đường sắt"/);
  assert.match(row, /aria-label="Đường sắt"/);
  assert.match(row, /href="#i-rail"/);
  assert.doesNotMatch(row, /project-layer-sub|<button/);
  assert.ok(row.indexOf('project-layer-name') < row.indexOf('project-rail'), `icon đường sắt phải đứng sau tên ${label}`);
  assert.match(row, /class="project-rail"[\s\S]*<\/label>\s*<\/div>\s*$/, `icon đường sắt phải là phần cuối dòng ${label}`);
}
assert.doesNotMatch(plan, /project-layer-sub/);
assert.doesNotMatch(plan, /id="gt25RailHint"|id="gt10RailHint"/);
assert.match(plan, /id="qhc25Htkt"/);
assert.match(plan, /class="qhc25-htkt"/);
assert.match(plan, /id="qhc25Scale"/);
assert.match(plan, /data-qhc-info="25"/);
assert.match(plan, /data-qhc-info="10"/);
assert.match(read('public/css/style.css'), /\.project-rail \{[^}]*width: 18px/);
assert.match(read('public/css/style.css'), /\.project-rail \.ico \{[^}]*width: 13px/);
assert.match(read('public/css/style.css'), /\.qhc25-htkt \{/);
assert.match(read('docs/ui-spec.md'), /icon «Đường sắt»/);
assert.match(read('docs/ui-spec.md'), /#qhc25Htkt/);
assert.match(read('docs/ui-spec.md'), /Bản đồ hiện trạng tỷ lệ 1\/25\.000/);
assert.match(read('docs/bon-truc.md'), /#qhc25Htkt/);

const tech = innerById(html, 'layerPaneHaTang');
const social = innerById(html, 'layerPaneXaHoi');
assert.doesNotMatch(tech, /id="axisEnvFold"/);
assert.doesNotMatch(tech, /id="chk_terrain"/);
assert.doesNotMatch(tech, /id="isoSlotHaTang"/);
assert.doesNotMatch(tech, /Giả lập bán kính/);
assert.match(social, /id="isoSlotXaHoi"/);
assert.match(social, /id="inputIsoRadius"/);
assert.match(social, /Giả lập bán kính chung/);
assert.match(social, /id="planPoints"/);
assert.match(social, /Quỹ đất và công trình/);
assert.match(social, /id="chk_c9"/);
assert.doesNotMatch(social, /id="chk_c14"/);
assert.doesNotMatch(social, /id="chk_invest"/);
assert.match(social, /id="chk_c1"/);
const dauTu = innerById(html, 'layerPaneDauTu');
assert.ok(main.indexOf('id="layerPaneKienTruc"') < main.indexOf('id="layerPaneDauTu"'), 'Dự án đầu tư đứng sau Kiến trúc');
const dtPick = innerById(html, 'levelPickDt');
assert.match(html, /class="level-pick level-pick-dt"/);
let dtAt = 0;
for (const [id, label] of [
  ['dvtm', 'DVTM'],
  ['congnghiep', 'Công nghiệp'],
  ['nangluong', 'Năng lượng'],
  ['khudothi', 'Đô thị'],
  ['chungcu', 'Chung cư'],
  ['nongnghiep', 'Nông nghiệp'],
  ['vanhoaxahoi', 'VHXH'],
  ['khac', 'Dự án khác']
]) {
  const at = dtPick.indexOf(`data-dt-tab="${id}"`);
  assert.ok(at > dtAt, `sai thứ tự tab ${label}`);
  dtAt = at;
  assert.ok(dtPick.slice(at, at + 280).includes(label), `thiếu nhãn ${label}`);
}
assert.match(dauTu, /id="chk_c14"/);
assert.match(dauTu, /id="chk_invest"/);
assert.match(dauTu, /class="dt-invest-check"/);
assert.doesNotMatch(dauTu, /id="chk_invest"[^>]*\schecked\b/);
assert.match(read('docs/ui-spec.md'), /tắt khi mở trang/);
assert.match(read('public/js/investLayer.js'), /ensureInvestOn/);
assert.match(read('public/js/investLayer.js'), /queueInvestDraw/);
assert.match(read('public/js/investLayer.js'), /planMapLive/);
assert.match(read('public/js/chuyenNganh.js'), /cur === id/);
assert.doesNotMatch(dauTu, /Dự án kêu gọi đầu tư/);
assert.match(html, /id="dtMagLabel"/);
assert.match(dauTu, /id="aptBox"/);
assert.match(dauTu, /id="aptList"/);
assert.match(dauTu, /id="investList-dvtm"/);
assert.match(dauTu, /id="investList-khac"/);
assert.match(dauTu, /id="investList-chungcu"/);
assert.match(dauTu, /id="dtListPane"/);
assert.match(dauTu, /id="investInfoSlot"/);
assert.match(dauTu, /id="investLoad"/);
assert.match(read('public/js/investLayer.js'), /startLoadMeter|showInvestLoad|primeInvestLoad/);
assert.match(read('public/js/loadProgress.js'), /export function startLoadMeter/);
assert.match(read('public/js/app.js'), /primeInvestLoad/);
assert.match(read('public/js/apartmentLayer.js'), /data-apt-expand/);
assert.match(read('public/js/investLayer.js'), /data-invest-expand/);
assert.match(read('public/js/investLayer.js'), /invest-info-open|qh-invest-info/);
assert.match(read('public/js/investLayer.js'), /SELECTED|#fde047/);
assert.match(read('public/js/app.js'), /syncInvestInfoDock|investInfoSlot/);
assert.match(read('public/css/style.css'), /body\.invest-info-open #investInfoSlot/);
assert.match(read('docs/ui-spec.md'), /investInfoSlot|#investCard/);
assert.match(read('public/js/investLayer.js'), /dt-area|areaTextOf/);
assert.match(read('public/js/investLayer.js'), /data-dvtm-fold|DVTM_SUBGROUPS/);
assert.match(read('public/js/investClassify.js'), /classifyDvtmSub/);
assert.match(read('docs/ui-spec.md'), /cuối dòng hiện diện tích/);
assert.match(read('docs/ui-spec.md'), /Tab DVTM chia 5 nhóm con/);
assert.match(read('docs/ui-spec.md'), /cùng kiểu công trình kiến trúc Pháp/);
assert.match(dauTu, /class="level-pick level-pick-dt"/);
assert.doesNotMatch(dauTu, /Dữ liệu hiện trạng/);
assert.match(html, /id="legendDauTu"/);
const axisDock = innerById(html, 'axisDock');
assert.ok(axisDock.indexOf('data-axis-dock="kientruc"') < axisDock.indexOf('data-axis-dock="dautu"'), 'nút Đầu tư đứng sau Kiến trúc');
assert.match(axisDock, /title="F\. Dự án đầu tư"/);
assert.match(read('public/js/facetStore.js'), /F\. Dự án đầu tư/);
assert.match(read('public/js/chuyenNganh.js'), /'dautu'/);
assert.match(read('public/js/legendPanel.js'), /dauTuLegendHtml/);
assert.doesNotMatch(read('public/js/legendPanel.js'), /LEGEND_OFF = new Set\(\[[^\]]*dautu/);
assert.match(read('docs/ui-spec.md'), /F\. Dự án đầu tư/);
assert.match(social, /id="chk_edu"/);
assert.doesNotMatch(admin, /id="inputIsoRadius"/);
assert.doesNotMatch(plan, /id="inputIsoRadius"/);

assert.match(html, /id="legendHtkt"/);
assert.match(html, /data-cn-form="point"/);
assert.match(html, /data-cn-form="line"/);
assert.match(html, /data-cn-form="polygon"/);
assert.match(read('public/js/chuyenNganh.js'), /data-cn-sector-pick/);
assert.match(read('public/js/chuyenNganh.js'), /data-cn-level-pick/);
assert.match(read('public/js/chuyenNganh.js'), /data-cn-area-pick/);
assert.match(read('public/js/chuyenNganh.js'), />Cấp QH</);
assert.doesNotMatch(read('public/js/chuyenNganh.js'), /data-cn-all/);
assert.match(read('public/js/chuyenNganh.js'), /capNuocLegendHtml/);
assert.match(read('public/js/capNuocQhc.js'), /data-cnu-zone-on/);
assert.match(read('public/js/legendPanel.js'), /is-htkt/);
assert.match(read('public/js/legendPanel.js'), /is-xh/);
assert.match(html, /id="legendXh"/);
assert.match(read('public/js/xahoiList.js'), /data-xh-type/);
assert.match(read('public/js/xahoiList.js'), /data-xh-scope/);
assert.match(read('docs/ui-spec.md'), /không ký hiệu chức năng sử dụng đất/);
const legend = innerById(html, 'tabLegend');
assert.match(legend, /id="parcelLegend"/);
assert.doesNotMatch(legend, /id="btnLegendClose"/);
assert.match(legend, /id="lotOpacity"/);
assert.doesNotMatch(legend, /Hiển thị lô đất/);
assert.match(legend, /Viền lô theo giai đoạn/);
assert.match(legend, /Độ trong suốt/);
assert.ok(legend.indexOf('Viền lô theo giai đoạn') < legend.indexOf('id="lotOpacity"'), 'Độ trong suốt phải dưới Viền lô');
assert.ok(legend.indexOf('id="parcelLegend"') < legend.indexOf('id="lotOpacity"'), 'Độ trong suốt phải dưới danh sách ký hiệu');
assert.doesNotMatch(legend, /Quyết định phê duyệt/);
const base = innerById(html, 'layerPaneBase');
assert.doesNotMatch(base, /Quyết định phê duyệt/);
assert.doesNotMatch(base, /id="waybackRelease"/);
assert.doesNotMatch(base, /value="wayback"/);
assert.doesNotMatch(base, /Mốc Wayback/);
for (const value of ['google', 'positron']) {
  assert.match(base, new RegExp(`value="${value}"`), `thiếu nền ${value}`);
}
assert.doesNotMatch(base, /value="esri"|value="s2"|Esri World Imagery|Sentinel-2 Cloudless/);
assert.doesNotMatch(base, /id="lotOpacity"/);
assert.doesNotMatch(base, /Hiển thị lô đất/);
assert.doesNotMatch(base, /Viền lô theo giai đoạn/);
assert.match(base, /id="chk_cadastre"/);
assert.match(base, /Thửa đất địa chính 2016/);
assert.match(base, /id="chk_violate"/);
assert.match(base, /Công trình vi phạm/);
assert.doesNotMatch(base, /id="chk_violate"[^>]*checked/);
assert.match(read('public/js/chuyenNganh.js'), /localStorage\.removeItem\(STORE_KEY\)/);
assert.doesNotMatch(read('public/js/chuyenNganh.js'), /NO_PERSIST/);
assert.match(read('public/js/violateLayer.js'), /chk\.checked = false/);
assert.doesNotMatch(read('public/js/violateLayer.js'), /loadPack\(\)\.then/);

const title = innerById(html, 'mapTitle');
assert.match(html, /<header class="map-title map-intro" id="mapTitle"/);
assert.match(title, /class="map-intro-kicker"/);
assert.match(title, /id="mapTitleText"/);
assert.match(title, /class="map-intro-line"/);
assert.match(html, /id="axisForeignStrip"/);
assert.match(html, /class="axis-foreign-strip"/);
assert.match(read('public/js/chuyenNganh.js'), /paintForeignAxes|clearAxisLayers|axisHasOpenLayers/);
assert.match(read('public/js/chuyenNganh.js'), /isHatangLayerOn|isLayerDrawn/);
assert.match(read('public/js/chuyenNganh.js'), /function isHatangLayerOn[\s\S]*?return isLayerDrawn\(l\.id\)/);
assert.match(read('public/js/projectLayer.js'), /anyPlanLayerOn|clearAllPlanLayers/);
assert.match(
  read('public/js/projectLayer.js'),
  /function anyPlanLayerOn\(\) \{\r?\n  return LIST_LEVELS\.some\(l => eyeState\(l\.key\)\.on\);\r?\n\}/
);
assert.match(html, /id="btnOverview"/);
assert.doesNotMatch(title, /id="btnMapCatalog"/);
assert.doesNotMatch(title, />Mục lục</);
assert.match(title, /id="btnTitleDismiss"/);
assert.doesNotMatch(title, /btnMapLevel|map-title-level/);

const ctx = read('public/js/mapContext.js');
for (const label of [
  'Xem thông tin thửa đất',
  'Xem thông tin lô đất quy hoạch',
  'Xem khả năng tiếp cận hạ tầng',
  'Xem thông tin địa điểm',
  'Đánh dấu và ghi chú',
  'Đo khoảng cách',
  'Đo diện tích',
  'Xem Street View'
]) {
  assert.ok(ctx.includes(label), `menu chuột phải thiếu ${label}`);
}
assert.match(ctx, /map-ctx-menu/);
assert.match(ctx, /openStreetView\(/);
assert.doesNotMatch(ctx, /window\.open\(streetViewUrl|window\.open\([^)]*pano/);
assert.match(read('public/js/streetView.js'), /export function openStreetView/);
assert.match(read('public/js/mediaViewer.js'), /export function openMedia/);
assert.match(read('public/css/style.css'), /\.media-view\s*\{/);
assert.match(read('public/css/style.css'), /\.media-view[\s\S]*?width:\s*fit-content/);
assert.doesNotMatch(read('public/css/style.css'), /\.media-view\s*\{[^}]*background:\s*#0b1220/);
assert.doesNotMatch(ctx, /Xem thông tin quy hoạch/);
assert.match(read('public/js/cadastreLayer.js'), /pickPlanningLot/);
assert.match(read('public/js/cadastreLayer.js'), /QHC 1\/25\.000/);
assert.match(read('public/js/cadastreLayer.js'), /QHC 1\/10\.000/);
assert.match(read('public/js/cadastreLayer.js'), /QHPK 1\/2\.000/);
assert.match(read('public/js/cadastreLayer.js'), /QHCT 1\/500/);
// Menu thửa / lô QH: sang trục B, bật cấp, mở brief đồ án + thẻ.
assert.match(read('public/js/cadastreLayer.js'), /goPlanAxis/);
assert.match(read('public/js/cadastreLayer.js'), /revealPlan/);
assert.match(read('public/js/cadastreLayer.js'), /applyInspectLevel/);
assert.match(ctx, /revealPlan:\s*true/);
assert.match(read('docs/ui-spec.md'), /chuyển sang B\. Hệ thống bản đồ quy hoạch/);
// Bấm ô đất đồ án khác: brief/hồ sơ theo đúng đồ án của lô (keepView).
// QHC / QHPK / QHCT: cùng đồ án vẫn mở lại brief; lớp tĩnh QHC/QHCT cũng gọi sync.
assert.match(read('public/js/mapEngine.js'), /syncFocusedProjectToLot/);
assert.match(read('public/js/mapEngine.js'), /keepView:\s*true/);
assert.match(read('public/js/mapEngine.js'), /PROJECT_INFO_EVENT/);
assert.match(read('public/js/projectLayer.js'), /keepView/);
assert.match(read('public/js/projectLayer.js'), /openSchemeDetail[\s\S]*PROJECT_INFO_EVENT/);
assert.match(read('public/js/qhc2045Layer.js'), /syncQhcCityBrief/);
assert.match(read('public/js/qhc2045Layer.js'), /QHC2045\.short/);
assert.match(read('public/js/projectBrief.js'), /qhcScaleBriefHtml|qhcCity/);
assert.match(read('public/js/qhctLayer.js'), /syncFocusedProjectToLot/);
assert.match(read('public/js/projectLayer.js'), /shareOpenProject\(p\.name\)/);
assert.match(ctx, /map-ctx-fly/);
assert.match(ctx, /data-level/);
assert.match(read('public/js/cadastreLayer.js'), /lotsRevision/);
assert.match(ctx, /LOTS_PROGRESS_EVENT/);
assert.match(read('public/index.html'), /id="planBriefSlot"/);
assert.match(read('public/index.html'), /id="planListPane"/);
assert.match(read('public/index.html'), /id="planInfoSlot"/);
assert.match(read('public/css/style.css'), /body\.plan-brief-open #planBriefSlot/);
assert.match(read('public/css/style.css'), /z-index: 4/);
assert.match(read('public/css/style.css'), /body\.plan-info-open #planInfoSlot/);
assert.match(read('public/css/style.css'), /body\.plan-info-open #planListPane > :not\(#planInfoSlot\)/);
assert.doesNotMatch(read('public/css/style.css'), /planInfoSlot > \.cad-card[\s\S]{0,500}inset 3px 0 0 rgb\(var\(--orange-rgb\)\)/);
assert.match(read('public/css/style.css'), /#layerPaneQuyHoach,\s*#layerPaneDauTu/);
assert.match(read('public/css/style.css'), /body\.plan-info-open #planInfoSlot > \.cad-card[\s\S]{0,400}width: 100% !important/);
assert.match(read('public/css/style.css'), /body\.plan-info-open #planInfoSlot > \.land-lot-popup[\s\S]{0,500}padding-top:\s*2px\s*!important/);
assert.doesNotMatch(read('public/css/style.css'), /body\.plan-info-open #planInfoSlot > \.land-lot-popup[\s\S]{0,500}padding:\s*28px 0 5px/);
assert.match(read('docs/ui-spec.md'), /lp-eyebrow.*cùng hàng với hàng icon|cùng hàng với hàng icon thao tác/);
assert.match(read('docs/ui-spec.md'), /chỉ dòng cấp chừa|Tiêu đề lô \(dòng dưới\) giãn/);
{
  const css = read('public/css/style.css');
  assert.match(css, /\.land-lot-popup\.pp-located \.lp-eyebrow[\s\S]{0,80}padding-right:\s*124px/);
  assert.match(css, /\.land-lot-popup\.pp-located\.pp-collapsible\.pp-has-buildup \.lp-head[\s\S]{0,280}padding-right:\s*4px/);
  assert.doesNotMatch(css, /\.land-lot-popup\.pp-located\.pp-collapsible\.pp-has-buildup \.lp-head \{ padding-right: 200px/);
}
assert.match(read('docs/ui-spec.md'), /không thanh inset \/ dải tối mép trái/);
assert.match(read('public/css/style.css'), /rgba\(var\(--orange-rgb\), 0\.55\)/);
assert.match(read('docs/ui-spec.md'), /không bị bảng lô đè/);
assert.doesNotMatch(read('public/css/style.css'), /body\.plan-info-open #axisQuyHoach > :not\(\.level-host\):not\(#planInfoSlot\)/);
assert.match(read('public/js/mapEngine.js'), /planInfoSlot/);
assert.match(read('public/js/mapEngine.js'), /classList\.contains\('infra-popup'\)/);
assert.match(read('public/js/app.js'), /syncPlanBriefDock/);
assert.match(read('public/js/app.js'), /syncPlanInfoDock/);
assert.match(read('public/js/app.js'), /dock-card\.infra-popup/);
assert.match(read('public/js/app.js'), /dock-card\.qhc-popup/);
assert.match(read('public/js/app.js'), /planningPaneOn\(\) && !!slot && \(cadOn \|\| !!popup\)/);
assert.doesNotMatch(read('public/js/app.js'), /!PHONE_INFO\.matches && planningPaneOn\(\) && !!slot/);
assert.match(read('public/js/mapEngine.js'), /ensureQuyHoachPane/);
assert.match(read('public/js/mapEngine.js'), /qh:axis-tab/);
assert.doesNotMatch(read('public/js/mapEngine.js'), /ensureQuyHoachPane[\s\S]{0,220}layerMagTrack[\s\S]{0,80}\?\.click\(/);
assert.match(read('public/js/mapEngine.js'), /qhc-popup/);
assert.match(read('public/js/qhc2045Layer.js'), /openDockPopup/);
assert.match(read('public/js/qhc2045Layer.js'), /qhc-popup land-lot-popup/);
assert.match(read('public/js/qhc2045Layer.js'), /qhcLotCardHtml|qhcVisionCardHtml/);
assert.doesNotMatch(read('public/js/mapEngine.js'), /phoneInfoSlot/);
assert.match(read('docs/ui-spec.md'), /không đè droplist B hay bốn tab cấp/);
assert.match(read('docs/ui-spec.md'), /QHC 1\/25\.000 hoặc 1\/10\.000/);
assert.match(read('docs/ui-spec.md'), /không xổ droplist sáu trục/);
assert.match(read('docs/ui-spec.md'), /Thông tin quy hoạch:/);
assert.match(read('public/js/planLandStats.js'), /planLotsTable/);
assert.match(read('public/js/planLandStats.js'), /HSSDĐ/);
assert.doesNotMatch(read('public/js/planLandStats.js'), /<th>Stt<\/th>/);
assert.doesNotMatch(read('public/js/planLandStats.js'), /<th>Tỷ lệ<\/th>/);
assert.match(read('public/js/lotBuildup.js'), /_qhLotBuildup/);
assert.match(read('public/js/cadastreLayer.js'), /geomTask/);
assert.match(read('public/js/planLandStats.js'), /pieHtml\(res/);
assert.match(read('public/js/viewFlow.js'), /skipProjects/);
assert.match(read('public/js/viewFlow.js'), /revealLotsCovering/);
assert.match(read('public/js/projectLayer.js'), /export function revealLotsCovering/);
assert.match(read('public/js/planLandStats.js'), /planLotsTable\(res\.parts, res\.area\)\}\$\{pieHtml/);
assert.match(read('public/js/planLandStats.js'), /pls-mark-hatch/);
assert.match(read('docs/ui-spec.md'), /hiện lô đất quy hoạch của đồ án giao thửa/);
assert.match(read('docs/ui-spec.md'), /ô màu \+ ô hatch/);
assert.match(read('public/js/cadastreLayer.js'), /Thông tin quy hoạch:/);
assert.match(read('public/js/cadastreLayer.js'), /mountCadTools/);
assert.match(read('public/js/cadastreLayer.js'), /cad-qh/);
assert.match(read('public/js/cadastreLayer.js'), /kind !== 'INFRA'/);
assert.match(read('docs/ui-spec.md'), /bảng lô thuộc nhóm hạ tầng|ô đất quy hoạch/);
assert.doesNotMatch(read('public/css/style.css'), /body\.plan-info-open \.right-panel,\s*body\.plan-info-open \.axis-dock/);
assert.match(read('public/css/style.css'), /--info-card-w/);
assert.match(read('public/js/projectLayer.js'), /paintQhpkOverlaps/);
assert.match(read('public/js/projectLayer.js'), /OUTLINE_FILL = \{ QHC: 0\.2, QHPK: 0\.14, QHCT: 0\.14 \}/);
assert.match(read('public/js/projectLayer.js'), /#22c55e/);
assert.match(read('public/js/qhc2045Layer.js'), /WASH_FILL = 0\.2/);
assert.match(read('public/js/qhpkOverlap.js'), /cần kiểm tra pháp lý theo đồ án được phê duyệt sau/);
assert.match(read('docs/ui-spec.md'), /plan-info-open/);
assert.match(read('docs/ui-spec.md'), /plan-brief-open/);
assert.match(read('docs/ui-spec.md'), /planBriefSlot/);
assert.match(read('docs/ui-spec.md'), /planListPane/);
assert.doesNotMatch(ctx, /Xóa kết quả đo|Xóa phép đo/);

const engine = read('public/js/mapEngine.js');
assert.match(engine, /function landPopupHtml/);
assert.match(engine, /land-lot-popup/);
assert.match(engine, /class="lp-title"/);

const levelJs = read('public/js/mapLevel.js');
assert.match(levelJs, /data-level-pick/);
assert.match(levelJs, /function togglePlanTab/);
assert.match(levelJs, /setLevel\(id, \{ keepView: true \}\)/);
assert.doesNotMatch(read('public/js/viewFlow.js'), /frameVisibleSchemes/);
assert.doesNotMatch(read('public/js/projectLayer.js'), /frameVisibleSchemes/);
assert.match(read('docs/ui-spec.md'), /Bấm QHC 1\/10\.000 khi đang xem QHC 1\/25\.000 giữ nguyên khung nhìn/);
assert.match(levelJs, /listed\.clear\(\);\s*listed\.add\(id\)/);
assert.doesNotMatch(levelJs, /keepOthers/);
assert.match(levelJs, /ensurePlanTab/);
assert.doesNotMatch(levelJs, /getElementById\('levelPick'\)/);
assert.match(read('public/js/chuyenNganh.js'), /isoSlotXaHoi/);
assert.doesNotMatch(read('public/js/chuyenNganh.js'), /isoSlotHaTang/);

const cn = read('public/js/chuyenNganh.js');
assert.match(cn, /releaseAdminAnchor/);
assert.match(cn, /id !== 'hanhchinh'/);
assert.match(cn, /focusWard/);
assert.match(cn, /axis-area-city/);
assert.match(cn, /axis-area-pop/);
assert.match(cn, /Dân số/);
assert.match(cn, /DVHC_CITY\.name, null/);
assert.doesNotMatch(cn, /paintBase\(\s*['"]quyhoach['"]/);
assert.doesNotMatch(cn, /baseQuyHoach/);
const legendJs = read('public/js/legendPanel.js');
assert.match(legendJs, /new Set\(\['hanhchinh', 'kientruc'\]\)/);
assert.match(legendJs, /legendFoldEl\.hidden = !showLegend/);
assert.match(legendJs, /baseFold\.hidden = mode !== 'base'/);
assert.match(legendJs, /envFold\.hidden = mode !== 'env'/);
assert.match(legendJs, /btnDockLegend/);
assert.match(legendJs, /btnDockBase/);
assert.match(legendJs, /btnDockEnv/);
assert.match(legendJs, /btnDockCollapse/);
assert.match(legendJs, /is-collapsed/);
const css = read('public/css/style.css');
assert.match(css, /--text-title:\s*#fde68a/);
assert.match(css, /\.mag-item\.is-current \.layer-main-label\s*\{[^}]*color:\s*var\(--text-title\)/);
assert.match(css, /\.mag-menu button\s*\{[^}]*color:\s*var\(--text-title\)/);
assert.match(css, /--axis-font:\s*var\(--font-sans\)/);
assert.match(css, /--axis-fs-header:\s*12px/);
assert.match(css, /--axis-fs-row:\s*12px/);
assert.match(css, /--axis-fs-chip:\s*11px/);
assert.match(css, /--axis-row-h:\s*22px/);
assert.match(css, /#legendFold\[hidden\]/);
assert.match(css, /#axisBaseFold\[hidden\]/);
assert.match(css, /#axisEnvFold\[hidden\]/);
assert.match(css, /\.level-pick-btn\.is-on\s*\{[^}]*background:\s*var\(--accent-orange\)/);
assert.doesNotMatch(css, /\.level-pick-btn\.is-current\s*\{[^}]*dashed/);
assert.doesNotMatch(css, /\.level-pick-btn\.is-on\.is-current/);
assert.match(css, /\.dock-switch\s*\{[^}]*flex-wrap:\s*nowrap/);
assert.match(css, /#projectList,\s*\n#gpList,[\s\S]*?#layerPaneEnv\s*\{[^}]*scrollbar-width:\s*thin/);
assert.match(css, /scrollbar-color:\s*#2a3d58\s+#141c2e/);
assert.doesNotMatch(css, /#layerPaneBase::-webkit-scrollbar\s*\{[^}]*width:\s*8px/);
assert.match(css, /#tabLayers \.layer-main-pane:not\(\[hidden\]\)\s*\{[^}]*padding-right:\s*0/);
assert.match(css, /#layerPaneBase,\s*#layerPaneEnv\s*\{[^}]*overflow-y:\s*auto/);
assert.match(css, /\.tt16-group-name\s*\{[^}]*font-size:\s*10px/);
assert.match(css, /\.rp-dock\s*\{[^}]*max-height:\s*33\.333%/);
assert.match(css, /\.right-panel\s*\{[^}]*left:\s*12px/);
assert.match(css, /\.map-toolbar\s*\{[^}]*right:\s*12px/);
assert.match(css, /body\.right-collapsed \.axis-dock\s*\{[^}]*left:\s*max\(8px/);
assert.match(css, /\.axis-area-city\s*\{[^}]*#fef3c7/);
assert.doesNotMatch(read('public/js/basemap.js'), /waybackconfig\.json/);
assert.doesNotMatch(read('public/js/basemap.js'), /waybackRelease/);
const gp = read('public/js/generalPlanUi.js');
assert.match(gp, /Đến 2030/);
assert.match(gp, /Sau 2030/);
assert.match(gp, /export function pickUrbanFromMap/);
assert.match(gp, /export function clearUrbanMapPick/);
assert.match(read('public/js/viewFlow.js'), /pickUrbanFromMap\(u\)/);
assert.match(gp, /function isCityRow/);
assert.match(gp, /const num = `\$\{n\}\.`/);
assert.match(gp, /g\.rows\.map\(item => areaBtn\(item, \+\+n, period\)\)/);
assert.doesNotMatch(gp, /isCityRow\(item\) \? null : \+\+n/);
assert.doesNotMatch(gp, /const num = city \? '' :/);
assert.match(gp, /getViewMode\(\) === 'HT'/);
assert.match(css, /#adminTabs \.admin-tab\s*\{[^}]*min-width:\s*max-content/);
assert.match(read('.cursorrules'), /docs\/ui-spec\.md/);
assert.match(cn, /shortPlaceName/);
assert.match(cn, /Loại HT/);
assert.match(cn, /Loại 2030/);
assert.match(cn, /showUrbanPlanOnBase/);
assert.match(read('public/js/urbanAreaLayer.js'), /planOnBase/);
assert.match(cn, /const loai = htMode \? lvCell\(marks\.ht/);
assert.doesNotMatch(cn, /\$\{lvCell\(marks\.ht[\s\S]{0,40}\$\{lvCell\(marks\.plan/);
assert.match(cn, /clearWardHighlight\(\)/);
const release = cn.slice(cn.indexOf('function releaseAdminAnchor'), cn.indexOf('function showAxis'));
assert.match(release, /clearWardHighlight\(\)/);
assert.match(gp, /if \(htOn\)/);
assert.match(gp, /shortPlaceName/);
assert.doesNotMatch(gp, /\$\{htHtml\}/);
assert.match(css, /left:\s*calc\(12px \+ var\(--right-w\) \+ 16px\)/);
assert.match(css, /12px \+ var\(--tb-btn\) \+ 16px/);
assert.match(css, /\.map-title-text\s*\{[^}]*white-space:\s*nowrap/);
const titleCss = css.slice(css.indexOf('/* Hộp tiêu đề vừa chữ'), css.indexOf('.map-title::before'));
assert.match(titleCss, /\.map-title\s*\{[^}]*width:\s*fit-content/);
assert.match(titleCss, /\.map-title\s*\{[^}]*right:\s*auto/);
assert.match(titleCss, /\.map-title\s*\{[^}]*margin:\s*0/);
assert.match(titleCss, /\.map-title\s*\{[^}]*transform:\s*none/);
assert.doesNotMatch(titleCss, /margin-left:\s*auto/);
const titlePin = css.slice(css.indexOf('body.right-collapsed .map-title,'), css.indexOf('/* Ngay dưới thanh tiêu đề'));
for (const flag of ['right-collapsed', 'bottom-collapsed', 'compare-on']) {
  assert.match(titlePin, new RegExp(`body\\.${flag} \\.map-title`));
}
assert.match(titlePin, /left:\s*calc\(12px \+ var\(--right-w\) \+ 16px\)/);
assert.match(titlePin, /right:\s*auto/);
assert.match(titlePin, /width:\s*fit-content/);
assert.doesNotMatch(css, /bottom-collapsed[^{}]*\{[^}]*\.map-title[^}]*left:\s*(?!calc\(12px \+ var\(--right-w\))/);
const titleJs = read('public/js/app.js');
const titleFn = titleJs.slice(titleJs.indexOf('const VIEW_TITLES'), titleJs.indexOf('async function loadTouchGroups'));
assert.match(titleFn, /BẢN ĐỒ QUY HOẠCH THÀNH PHỐ HUẾ/);
assert.match(titleFn, /VIEW_TITLES\[key\]/);
assert.doesNotMatch(titleFn, /VIEW_TITLES_SHORT|BẢN ĐỒ QUY HOẠCH TP HUẾ/);
assert.doesNotMatch(titleFn, /style\.(?:left|right|width|maxWidth|fontSize)/);
assert.doesNotMatch(titleFn, /observe\(document\.body/);
assert.match(css, /grid-template-columns:\s*2em minmax\(0, 1fr\) 9\.2ch 8\.2ch 9ch/);
assert.doesNotMatch(css, /3\.2ch 6\.6ch/);
assert.match(html, /title="Hiện trạng \(QĐ 614\)"/);
assert.match(html, /title="Quy hoạch \(QĐ 756\)"/);
assert.match(html, /data-layer-decision="do-thi-hien-trang"[^>]*data-label="QĐ 614"/);
const layerDecisionsJs = read('public/js/layerDecisions.js');
assert.match(layerDecisionsJs, /\/gcs\/docs\/614-QD-UBND\.pdf/);
assert.match(layerDecisionsJs, /bytes: 710578/);
assert.match(layerDecisionsJs, /decisionFor\(id\)/);
assert.doesNotMatch(read('public/_headers'), /\/docs\/614-QD-UBND\.pdf/);
assert.equal(fs.existsSync(new URL('public/docs/614-QD-UBND.pdf', root)), false);
assert.equal((html.match(/data-dossier-layer-host="qhc-2045"/g) || []).length, 2);
assert.match(read('public/js/dossierAttach.js'), /Quy định quản lý/);
assert.match(read('public/js/dossierAttach.js'), /Thuyết minh/);
assert.match(read('public/js/layerDecisions.js'), /data-dossier-layer-host/);
assert.match(read('public/js/projectLayer.js'), /data-dossier-menu/);
assert.match(layerDecisionsJs, /\/gcs\/docs\/108-QD-TTg\.pdf/);
assert.match(layerDecisionsJs, /bytes: 3401128/);
assert.equal(fs.existsSync(new URL('public/docs/108-QD-TTg.pdf', root)), false);
assert.match(read('public/js/decisionViewer.js'), /d\.kind === 'pdf'/);
assert.match(read('public/css/style.css'), /\.decision-view\s*\{[^}]*width:\s*min\(210mm/);
assert.doesNotMatch(read('public/css/style.css'), /\.decision-view\s*\{[^}]*left:\s*50%/);
assert.match(read('public/css/style.css'), /\.decision-pdf\s*\{/);
assert.match(read('public/js/decisionViewer.js'), /paintPdf/);
assert.match(read('public/js/decisionViewer.js'), /data-decision-frame/);
assert.match(read('public/js/decisionViewer.js'), /createObjectURL/);
assert.doesNotMatch(read('public/js/decisionViewer.js'), /pdf\.js|pdfjsLib|PDFJS_VER/);
assert.match(read('public/js/decisionViewer.js'), /data-decision-pdf/);
assert.match(read('public/js/decisionViewer.js'), /từ chối link phải mở tab mới/);
assert.match(read('public/js/decisionViewer.js'), /pickFile\(t\)/);
assert.match(read('public/js/decisionViewer.js'), /Cần đăng nhập quản trị để gắn PDF/);
assert.match(read('services/projectStore.js'), /Chỉ chấp nhận link xem trực tiếp được hoặc file PDF/);
assert.doesNotMatch(read('public/_headers'), /\/docs\/108-QD-TTg\.pdf/);
assert.match(read('public/.assetsignore'), /\*\*\/\*\.pdf/);
assert.match(read('public/js/dvhcStats.js'), /export function shortPlaceName/);
assert.match(read('public/js/facetStore.js'), /A\. Quản lý phát triển đô thị/);
assert.doesNotMatch(html, /Quản lý theo đơn vị hành chính/);
assert.match(html, />Đơn vị hành chính</);
assert.match(html, />Đô thị</);
assert.doesNotMatch(html, /Đơn vị hành chính \(40\)|Đô thị \(25\)/);
assert.match(read('public/js/chuyenNganh.js'), /export function consumeDvhcMapClick/);
assert.match(read('public/js/chuyenNganh.js'), /dvhc-browse/);
assert.match(read('public/js/chuyenNganh.js'), /dothi-browse/);
assert.match(read('public/js/chuyenNganh.js'), /export function isDothiBrowse/);
assert.match(read('public/js/app.js'), /consumeDvhcMapClick/);
assert.match(read('public/js/app.js'), /consumeDothiMapClick/);
assert.match(read('public/js/viewFlow.js'), /export async function consumeDothiMapClick/);
assert.match(read('public/js/viewFlow.js'), /browseState\(\)\.axis === 'quyhoach'/);
assert.match(read('public/js/viewFlow.js'), /browseState\(\)\.axis === 'hanhchinh'/);
assert.match(read('public/js/urbanAreaLayer.js'), /export const urbanStatusAt/);
assert.doesNotMatch(read('public/js/urbanAreaLayer.js'), /Đơn vị hành chính nông thôn/);
assert.match(read('docs/ui-spec.md'), /chỉ chọn đúng xã\/phường/);
assert.match(read('docs/ui-spec.md'), /chỉ chọn theo ranh đô thị/);
assert.match(read('docs/ui-spec.md'), /chỉ chọn đồ án \/ lô quy hoạch/);
assert.doesNotMatch(html, /btnExpandRightPanel|rp-expand-btn/);
assert.match(html, /id="axisDock"/);
assert.match(html, /id="btnCollapseRightPanel"/);
assert.match(html, /id="btnExpandBottomPanel"/);
assert.match(cn, /showAxis\(tab\.dataset\.axisDock, \{ openPanel: true \}\)/);
assert.doesNotMatch(read('public/js/app.js'), /btnExpandRightPanel/);
assert.doesNotMatch(css, /#btnExpandBottomPanel[\s\S]{0,320}width:\s*72px/);
assert.match(css, /#btnExpandBottomPanel \{[\s\S]{0,220}width:\s*var\(--tb-btn\)/);
assert.match(css, /#btnExpandBottomPanel \{[\s\S]{0,180}right:\s*12px/);
assert.match(read('docs/ui-spec.md'), /không có nút «>>»/);
assert.match(read('docs/ui-spec.md'), /cùng bề rộng và cùng mép phải/);
assert.equal(shortPlaceName('Thành phố Huế'), 'TP Huế');
assert.equal(shortPlaceName('Phường Thuận An'), 'P. Thuận An');
assert.equal(shortPlaceName('Xã A Lưới 1'), 'X. A Lưới 1');
assert.equal(shortPlaceName('Đô thị Huế'), 'Đô thị Huế');
assert.equal(shortPlaceName('Khu vực đô thị A'), 'Khu vực đô thị A');

const spec = read('docs/ui-spec.md');
assert.match(spec, /## Phác thảo/);
assert.match(spec, /## Đo khoảng cách và diện tích/);
assert.match(spec, /Điều chỉnh/);
assert.match(spec, /Xóa đỉnh/);
assert.match(spec, /Phím Delete xóa hình đó/);
assert.match(spec, /Phím Delete xóa phép đo đang chọn/);
assert.doesNotMatch(spec, /Xóa phép đo|Xóa kết quả đo/);
assert.match(spec, /Esc hủy/);

const handles = read('public/js/vertexHandles.js');
assert.match(handles, /dragging\.disable\(\)/);
assert.match(handles, /insertMidpoint/);
assert.match(handles, /dragVertex/);
assert.match(handles, /Xóa đỉnh/);
assert.match(handles, /Xong/);
assert.match(handles, /}, 1500\)/);
assert.equal((handles.match(/dragging\.disable\(\)/g) || []).length, 1);

const sketch = read('public/js/sketchLayer.js');
assert.match(sketch, /selectShape\(fg\)/);
assert.match(sketch, /Điều chỉnh/);
assert.match(sketch, /Xóa đỉnh/);
assert.match(sketch, /Xong/);
assert.match(sketch, /createVertexHandles/);
assert.doesNotMatch(sketch, /dragging\.disable\(\)/);
assert.match(sketch, /cancelAdjust\(\)/);
assert.match(sketch, /consumeSketchMapClick/);
assert.match(sketch, /createSketchEditSession/);
assert.match(sketch, /e\.key !== 'Delete'/);
assert.match(sketch, /removeShape\(pickFg\)/);
assert.match(sketch, /deleteSelectedMeasure/);
assert.match(sketch, /e\.key === 'Backspace' && pts\.length/);
assert.match(read('public/js/mapContext.js'), /sketch-handle/);
assert.match(read('public/js/app.js'), /consumeSketchMapClick\(e\)/);

const measureJs = read('public/js/mapEngine.js');
assert.match(measureJs, /createVertexHandles/);
assert.match(measureJs, /createSketchEditSession/);
assert.doesNotMatch(measureJs, /dragging\.disable\(\)/);
assert.doesNotMatch(measureJs, /function moveVertex|function insertVertex|function segmentMidpoints/);
assert.match(measureJs, /Điều chỉnh/);
assert.doesNotMatch(measureJs, /Xóa phép đo/);
assert.match(measureJs, /export function deleteSelectedMeasure/);
assert.match(measureJs, /Xong/);
assert.match(measureJs, /cancelMeasureEdit/);
assert.match(measureJs, /finishMeasureEdit/);
assert.match(measureJs, /consumeMeasureMapClick/);
assert.match(measureJs, /measureResults = \[\]/);
assert.match(measureJs, /Đường đo cần ít nhất 2 đỉnh/);
assert.match(measureJs, /Vùng đo cần ít nhất 3 đỉnh/);
assert.match(measureJs, /item\.type === 'area' \? 'polygon' : 'polyline'/);
assert.match(read('public/js/app.js'), /consumeMeasureMapClick\(e\)/);
const ctxNow = read('public/js/mapContext.js');
const onContext = ctxNow.slice(ctxNow.indexOf('function onContext'), ctxNow.indexOf('function bindLongPress'));
assert.match(onContext, /_measureHandled/);
assert.doesNotMatch(onContext, /activeMeasureType/);
assert.doesNotMatch(ctxNow, /Xóa kết quả đo|Xóa phép đo/);
assert.match(read('public/index.html'), /id="btnMeasureDist"[^>]*Điều chỉnh/);
assert.match(read('public/index.html'), /id="btnMeasureArea"[^>]*Điều chỉnh/);

const linePts = [
  { lat: 16.46, lng: 107.58 },
  { lat: 16.47, lng: 107.59 }
];
const line = createSketchEditSession(linePts, 'line');
line.select();
assert.equal(line.isSelected(), true);
const menu = line.openMenu();
assert.ok(menu.includes('Điều chỉnh'), 'menu có Điều chỉnh');
assert.ok(menu.includes('Xóa hình này'));
line.startAdjust();
assert.ok(line.isEditing());
assert.deepEqual(line.vertexMenu(), ['Xóa đỉnh', 'Xong']);
assert.equal(line.deleteVertex(0).removed, false, 'đường giữ ít nhất 2 đỉnh');
assert.equal(minVertices('line'), 2);
assert.equal(line.workingPts().length, 2);
const dragged = line.dragVertex(1, { lat: 16.5, lng: 107.62 });
assert.equal(dragged[1].lat, 16.5);
assert.equal(dragged[1].lng, 107.62);
assert.notEqual(dragged[1].lat, linePts[1].lat);
const restored = line.cancel();
assert.equal(line.isEditing(), false);
assert.equal(restored[1].lat, linePts[1].lat, 'Esc trả lại vĩ độ');
assert.equal(restored[1].lng, linePts[1].lng, 'Esc trả lại kinh độ');
assert.equal(line.savedPts()[1].lat, linePts[1].lat);

const polyPts = [
  { lat: 16.45, lng: 107.55 },
  { lat: 16.46, lng: 107.55 },
  { lat: 16.46, lng: 107.56 }
];
const poly = createSketchEditSession(polyPts, 'polygon');
poly.select();
assert.ok(poly.openMenu().includes('Điều chỉnh'));
poly.startAdjust();
assert.equal(minVertices('polygon'), 3);
assert.equal(poly.deleteVertex(1).removed, false, 'đa giác giữ ít nhất 3 đỉnh');
const mids = poly.midpoints();
assert.equal(mids.length, 3);
poly.insertMidpoint(mids[0].insertAt, mids[0].at);
assert.equal(poly.workingPts().length, 4);
poly.dragVertex(mids[0].insertAt, { lat: 16.455, lng: 107.552 });
assert.equal(poly.workingPts()[mids[0].insertAt].lat, 16.455);
assert.equal(poly.deleteVertex(mids[0].insertAt).removed, true);
assert.equal(poly.workingPts().length, 3);
const kept = poly.finish();
assert.equal(kept.length, 3);
assert.equal(poly.isEditing(), false);
assert.deepEqual(poly.savedPts(), kept);
poly.startAdjust();
poly.dragVertex(0, { lat: 10, lng: 20 });
assert.equal(poly.workingPts()[0].lat, 10);
assert.deepEqual(poly.cancel(), kept);

const distPts = [
  { lat: 16.47, lng: 107.58 },
  { lat: 16.48, lng: 107.60 }
];
const dist = createSketchEditSession(distPts, 'polyline');
dist.select();
assert.ok(dist.openMenu().includes('Điều chỉnh'));
dist.startAdjust();
assert.equal(minVertices('polyline'), 2);
assert.equal(dist.deleteVertex(0).removed, false, 'đo khoảng cách giữ ít nhất 2 đỉnh');
assert.equal(dist.midpoints().length, 1);
dist.insertMidpoint(1, dist.midpoints()[0].at);
assert.equal(dist.workingPts().length, 3);
dist.dragVertex(1, { lat: 16.475, lng: 107.59 });
assert.equal(dist.workingPts()[1].lat, 16.475);
assert.deepEqual(dist.cancel(), distPts, 'Esc trả lại đường đo');
dist.startAdjust();
dist.dragVertex(0, { lat: 16.5, lng: 107.7 });
assert.equal(dist.finish()[0].lat, 16.5);
assert.equal(dist.isEditing(), false);

assert.match(social, /id="xahoiPicks"/);
assert.match(social, /id="xahoiList"/);
assert.match(social, /id="xahoiLayerSource"/);
assert.doesNotMatch(social, /id="xahoiTabs"|data-xh-tab=/);
assert.doesNotMatch(social, /id="xahoiRadiusOverlay"|id="funeralRow"/);
assert.doesNotMatch(social, /Cột đèn|Cấp điện|Giao thông|pointCatalog/);
assert.match(social, /id="chk_c1"/);
assert.match(social, /id="chk_c2"/);
assert.match(social, /id="chk_c11"/);
assert.match(social, /id="chk_c12"/);
assert.match(social, /id="chk_nt_grave"/);
assert.match(social, /id="chk_nt_funeral"/);
assert.match(social, /id="chk_c9"/);
assert.doesNotMatch(social, /id="xahoiHeat"|id="chk_heat"/);
const legendXh = innerById(html, 'legendXh');
assert.match(legendXh, /id="legendXhRows"/);
assert.match(legendXh, /id="xahoiHeat"/);
assert.match(legendXh, /id="chk_heat"/);
assert.match(legendXh, /id="heatLegend"/);
assert.equal((html.match(/id="chk_heat"/g) || []).length, 1);
assert.doesNotMatch(base, /id="chk_heat"/);
assert.match(read('public/js/legendPanel.js'), /data-buffer/);
assert.match(read('public/js/xahoiList.js'), /SOCIAL_TYPES|data-xh-level/);
assert.match(read('public/js/xahoiList.js'), /project-row xh-item/);
assert.match(read('docs/ui-spec.md'), /đánh số thứ tự/);
assert.doesNotMatch(html, /id="pointCatalog"/);
assert.match(html, /css\/style\.css\?v=20261091/);
assert.match(html, /js\/app\.js\?v=20261091/);

assert.equal(HTKT_GROUPS.length, 8);
assert.equal(HTKT_GROUPS[7].id, 'tong-hop-duong-ong');
assert.equal(HTKT_GROUPS[7].label, 'Tổng hợp đường ống');
assert.deepEqual(SNAP_TOLERANCE_M, { QHCT: 0.5, QHPK: 1, QHC10: 10, QHC25: 100 });
assert.equal(SYNTH_LABEL, 'dữ liệu tự tổng hợp');
assert.equal(QHPK_HOOK_ID, 'qhpk-htkt');
assert.equal(withinSnap(0.5, 'QHCT'), true);
assert.equal(withinSnap(0.51, 'QHCT'), false);
assert.equal(withinSnap(100, 'QHC25'), true);
assert.equal(withinSnap(101, 'QHC25'), false);
assert.equal(isCotDenLayer({ name: 'Cột đèn chiếu sáng', file: 'cot-den.geojson' }), true);
assert.equal(isCotDenLayer({ name: 'Mạng lưới điện chiếu sáng', file: 'mang-luoi-dien-chieu-sang.geojson' }), false);
assert.equal(isPipeLine({ sector: 'cap-nuoc', geomType: 'LineString', name: 'Mạng cấp nước', file: 'mang.geojson' }), true);
assert.equal(isPipeLine({ sector: 'cap-dien', geomType: 'LineString', name: 'Cột đèn chiếu sáng(dạng đường)', file: 'cot-den.geojson' }), false);
assert.equal(isPipeLine({ sector: 'giao-thong', geomType: 'LineString', name: 'Mặt đường', file: 'mat-duong.geojson' }), false);
assert.equal(isHydrantLayer({ sector: 'cap-nuoc', name: 'Họng cứu hỏa', file: 'hong.geojson' }), true);
assert.equal(isHydrantLayer({ sector: 'chat-thai-ran-nghia-trang', name: 'Họng cứu hỏa', file: 'hong.geojson' }), false);
const hydrantTags = layerTags({ sector: 'cap-nuoc', geomType: 'Point', name: 'Họng cứu hỏa', file: 'hong.geojson', scheme: 'a', level: 'QHCT', kind: 'quy-hoach' });
assert.ok(hydrantTags.includes('hong-cuu-hoa'));
assert.ok(hydrantTags.includes('nhom:cap-nuoc'));
assert.deepEqual(qhpkLayersFromHook({ layers: [] }), []);
assert.equal(qhpkLayersFromHook({ layers: [{ level: 'QHPK', name: 'Tuyến', file: 't.geojson' }] }).length, 1);

setPlanRadii([]);
assert.equal(planRadiusM([], { scheme: 'a', sector: 'cap-nuoc', file: 'mang.geojson' }), null);
assert.equal(formatRadius(null), '—');
const filled = [{ maDoAn: 'a', nhom: 'cap-nuoc', subtype: 'mang', banKinh: '12,5' }];
setPlanRadii(filled);
assert.equal(planRadiusM(filled, { scheme: 'a', sector: 'cap-nuoc', file: 'mang.geojson' }), 12.5);
setPlanRadii([]);

const radii = JSON.parse(read('public/data/htkt/ban-kinh-quy-hoach.json'));
assert.equal(radii.tab, 'BanKinhQuyHoach');
assert.deepEqual(radii.rows, []);
assert.match(read('docs/templates/ban-kinh-quy-hoach.csv'), /^Ma_DoAn,Ten_DoAn,Cap,Nhom_HTKT,Subtype,Ten_Lop,BanKinh_m,Nguon,GhiChu/);
assert.match(read('docs/ban-kinh-quy-hoach.md'), /BanKinhQuyHoach/);
assert.match(read('public/js/chuyenNganh.js'), /capacityPanelHtml/);
assert.match(read('public/js/entryFlows.js'), /gateHosoCapacity/);
assert.match(read('public/js/entryFlows.js'), /fillHoSchemes/);
assert.match(read('public/js/entryFlows.js'), /id="hoSchemeSearch"/);
assert.match(html, /data-cs-host="qhc-hue-2045"/);
assert.match(read('docs/ui-spec.md'), /chưa đủ dữ liệu/);
assert.match(read('public/data/htkt/cong-suat.json'), /"maDoAn": "qhc-hue-2045"/);
assert.match(read('public/data/htkt/cong-suat.json'), /"giaTri": 600000/);
assert.match(read('public/data/htkt/qd-108-htkt.json'), /chua-du-du-lieu/);
assert.match(read('docs/ui-spec.md'), /Tổng hợp đường ống/);
assert.match(read('docs/ui-spec.md'), /dữ liệu tự tổng hợp/);

assert.match(cn, /tong-hop-duong-ong/);
assert.match(cn, /\/gcs\//);
assert.doesNotMatch(cn, /isPointWork|pointCatalog/);
assert.match(read('public/js/xahoiList.js'), /SOCIAL_TYPES/);
assert.match(read('docs/ui-spec.md'), /Ba droplist cùng kiểu HTKT/);
assert.match(read('docs/ui-spec.md'), /Bản đồ độ phủ hạ tầng/);
assert.match(read('public/js/gbaVersion.js'), /SHELL_V = '20261091'/);
assert.match(read('docs/ui-spec.md'), /Mỗi lúc chỉ một cấp bật/);
assert.match(read('docs/ui-spec.md'), /Không mục «Dữ liệu hiện trạng»/);
assert.match(read('docs/ui-spec.md'), /Thửa đất địa chính 2016 và Công trình vi phạm chỉ ở Lớp nền/);
assert.match(read('docs/ui-spec.md'), /Lớp môi trường/);
assert.match(read('docs/ui-spec.md'), /#fde68a/);
assert.doesNotMatch(read('docs/ui-spec.md'), /viền đứt|bật được nhiều cấp|bật cùng lúc/);
const stateSrc = read('public/js/state.js');
assert.match(stateSrc, /WARD_BOUNDARY_LINE_STYLE = \{[^}]*color: '#fde68a'/);
assert.match(stateSrc, /WARD_BOUNDARY_OUTLINE_STYLE = \{[^}]*color: '#1e293b'/);
assert.doesNotMatch(stateSrc, /WARD_BOUNDARY_SHADOW_STYLE/);
assert.match(read('public/js/mapEngine.js'), /wardRole = 'outline'/);
assert.doesNotMatch(read('public/js/mapEngine.js'), /WARD_BOUNDARY_SHADOW_STYLE/);

const synth = JSON.parse(read('public/data/htkt/synth.json'));
assert.equal(synth.label, 'dữ liệu tự tổng hợp');
assert.deepEqual(synth.snapM, SNAP_TOLERANCE_M);
assert.equal(synth.qhpkHook.status, 'pending');
assert.equal(synth.qhpkHook.id, 'qhpk-htkt');
assert.deepEqual(synth.qhpkHook.layers, []);
assert.ok(synth.qhpkHook.parents.every(slug => slug.startsWith('qhpk-')));
assert.ok(synth.gcs.some(row => row.scheme === 'qhc-chan-may' && row.sector === 'giao-thong' && row.featureCount === 773));
assert.ok(synth.gcs.some(row => String(row.file).includes('binh-thanh') && row.featureCount === 12872));
const index = JSON.parse(read('public/data/chuyen-nganh/index.json'));
const catalogFiles = new Set((index.layers || []).map(layer => layer.file));
for (const row of synth.synth) {
  assert.equal(row.label, 'dữ liệu tự tổng hợp');
  assert.ok(row.files.length > 0, row.scheme);
  for (const file of row.files) {
    assert.equal(catalogFiles.has(file), true, file);
    assert.equal(/cot[-_ ]?den/.test(file), false, file);
  }
}
assert.equal(synth.cotDenHidden, 7);
for (const id of ['qhc-phong-dien', 'qhc-quang-dien', 'qhc-a-luoi', 'qhc-phu-ho', 'qhc-phu-vinh', 'qhc-phu-vang', 'qhc-hung-loc']) {
  assert.ok(synth.synth.some(row => row.scheme === id || (row.aliases || []).includes(id)), id);
}

const manifest = JSON.parse(read('public/manifest.webmanifest'));
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, '/');
assert.equal(manifest.scope, '/');
assert.equal(manifest.orientation, 'landscape');
assert.match(manifest.name, /Sở Xây dựng/);
assert.match(manifest.name, /Bản đồ quy hoạch TP Huế/);
assert.equal(manifest.short_name, 'QH TP Huế');
assert.equal(manifest.theme_color, '#0f172a');
assert.equal(manifest.background_color, '#0f172a');
for (const [size, purpose] of [['192x192', 'any'], ['512x512', 'any'], ['192x192', 'maskable'], ['512x512', 'maskable']]) {
  const icon = manifest.icons.find((item) => item.sizes === size && item.purpose === purpose);
  assert.ok(icon, `${size} ${purpose}`);
  assert.equal(icon.type, 'image/png');
  assert.match(icon.src, /^\/icons\/icon.*\.png$/);
  assert.doesNotMatch(icon.src, /\?/);
  const buf = fs.readFileSync(new URL(`../public${icon.src}`, import.meta.url));
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', icon.src);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  assert.equal(`${w}x${h}`, size, icon.src);
}
const any192 = fs.readFileSync(new URL('../public/icons/icon-192.png', import.meta.url));
const mask192 = fs.readFileSync(new URL('../public/icons/icon-maskable-192.png', import.meta.url));
assert.equal(any192.equals(mask192), false);
assert.match(html, /rel="manifest" href="\/manifest\.webmanifest\?v=20261091"/);
assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
assert.match(html, /apple-touch-icon" href="\/icons\/apple-touch-icon\.png"/);
assert.match(html, /id="btnInstallApp"/);
assert.match(html, /Cài ứng dụng/);
assert.match(html, /id="installGuide"/);
assert.match(html, /Thêm vào Màn hình chính/);
assert.match(html, /id="installGuide"[\s\S]*\/icons\/apple-touch-icon\.png/);
assert.match(html, /Chia sẻ/);
assert.match(html, /register\('\/sw\.js', \{ scope: '\/'/);
assert.match(read('public/js/app.js'), /register\('\/sw\.js', \{ scope: '\/'/);
const mobileJs = read('public/js/mobileShell.js');
assert.match(mobileJs, /screen\.orientation\.lock\(orient\)/);
assert.match(mobileJs, /engage\('landscape'\)/);
assert.match(mobileJs, /beforeinstallprompt/);
assert.match(mobileJs, /classList\.toggle\('is-portrait'/);
assert.match(mobileJs, /classList\.toggle\('is-landscape'/);
assert.match(mobileJs, /classList\.toggle\('is-phone'/);
assert.match(mobileJs, /matchMedia\('\(orientation: landscape\)'\)/);
assert.match(mobileJs, /function deviceLandscape/);
assert.match(mobileJs, /btnInstallApp/);
assert.match(mobileJs, /Thêm vào Màn hình chính/);
assert.doesNotMatch(mobileJs, /qh_mobile_fs_offer/);
assert.doesNotMatch(mobileJs, /không khóa được/);
assert.doesNotMatch(mobileJs, /Mở toàn màn hình để khóa/);
assert.doesNotMatch(mobileJs, /requestFullscreen|webkitRequestFullscreen|enterFullscreen|showToast|mobileFs|mobile-fs/);
assert.match(mobileJs, /const land = deviceLandscape\(\)/);
assert.doesNotMatch(mobileJs, /is-turned|wantLandscape|rotate\(90deg\)/);
assert.doesNotMatch(html, /id="mobileFs"|class="mobile-fs"|Mở toàn màn hình để khóa/);
assert.doesNotMatch(css, /\.mobile-fs/);
assert.match(read('public/sw.js'), /addEventListener\('fetch'/);
assert.doesNotMatch(css, /is-turned/);
assert.match(css, /html\.is-phone\.is-landscape/);
assert.match(read('docs/ui-spec.md'), /không xoay khung bằng CSS/);
assert.doesNotMatch(read('docs/ui-spec.md'), /is-turned/);
assert.match(css, /--vv-w/);
assert.match(css, /height:\s*100dvh/);
assert.match(css, /--phone-dock-h:\s*48px/);
const side = css.slice(css.indexOf('/* phone-side-sheet */'), css.indexOf('/* phone-side-sheet-end */'));
assert.ok(side.includes('min-height'), 'thiếu khối phone-side-sheet');
assert.match(side, /width:\s*var\(--phone-panel-w\)/);
assert.match(side, /translateX\(calc\(-100% - 16px\)\)/);
assert.match(side, /min-height:\s*var\(--tb-btn\)/);
const dockLand = css.slice(css.indexOf('/* dock-landscape */'), css.indexOf('/* dock-landscape-end */'));
assert.match(dockLand, /orientation:\s*landscape/);
assert.match(dockLand, /white-space:\s*normal/);
assert.match(dockLand, /text-overflow:\s*clip/);
const orientFollow = css.slice(css.indexOf('/* orient-follow:'), css.indexOf('/* orient-follow-end */'));
assert.match(orientFollow, /is-landscape \.axis-dock button span\s*\{[^}]*white-space:\s*normal/);
assert.match(read('docs/ui-spec.md'), /sheet góc trái/);
assert.match(read('docs/ui-spec.md'), /không cắt bằng dấu ba chấm/);
assert.match(read('docs/ui-spec.md'), /Xoay màn hình/);
assert.match(read('docs/ui-spec.md'), /`orientation` landscape/);
assert.match(read('docs/ui-spec.md'), /Safari iOS bỏ qua/);
assert.match(read('public/_headers'), /application\/manifest\+json/);
const beforeTools = html.slice(0, html.indexOf('class="map-toolbar"'));
assert.doesNotMatch(beforeTools, /id="btnOverview"/);
const toolbar = html.slice(html.indexOf('class="map-toolbar"'), html.indexOf('id="printPreview"'));
const toolIds = [...toolbar.matchAll(/id="(btn[^"]+)"/g)].map((m) => m[1]);
assert.equal(toolIds[0], 'btnOverview');
assert.equal(toolIds.at(-1), 'btnRotateScreen');
assert.ok(toolIds.indexOf('btnExpandBottomPanel') < toolIds.indexOf('btnRotateScreen'));
assert.match(html, /id="btnRotateScreen"[^>]*title="Xoay màn hình"/);
assert.match(html, /id="i-rotate"/);
assert.match(html, /class="tb-scroll"[\s\S]*id="btnExpandBottomPanel"[\s\S]*<\/div>\s*<button type="button" class="ui-btn-format tb-rotate" id="btnRotateScreen"/);
assert.match(css, /\.tb-rotate\s*\{[^}]*display:\s*none/);
assert.match(css, /\.tb-scroll\s*\{[^}]*display:\s*contents/);
const phoneScroll = css.slice(css.indexOf('/* phone-tool-scroll */'), css.indexOf('/* phone-tool-scroll-end */'));
assert.ok(phoneScroll.includes('overflow-y'), 'thiếu vùng cuộn cột nút điện thoại');
assert.match(phoneScroll, /\.tb-scroll\s*\{[^}]*overflow-y:\s*auto/);
assert.match(phoneScroll, /\.tb-rotate\s*\{[^}]*display:\s*inline-flex/);
assert.match(read('docs/ui-spec.md'), /luôn nằm trong khung nhìn/);
assert.match(mobileJs, /btnRotateScreen/);
assert.match(mobileJs, /screen\.orientation\.unlock/);
assert.match(mobileJs, /toggleLandscape/);

assert.match(read('public/js/mapLevel.js'), /DEFAULT_LEVEL = 'qhc25'/);
assert.match(read('public/js/basemap.js'), /let current = 'google'/);
assert.match(read('public/js/basemap.js'), /localStorage\.removeItem\(STORE_KEY\)/);
assert.doesNotMatch(read('public/js/basemap.js'), /localStorage\.setItem\(STORE_KEY/);
assert.match(html, /<option value="google" selected>/);
assert.doesNotMatch(html, /<option value="positron" selected>/);
assert.match(html, /id="chk_bound"[^>]*checked/);
assert.match(html, /viewport-fit=cover/);
assert.match(read('public/js/app.js'), /Sau khi gắn trục và link chia sẻ/);
assert.match(read('public/js/app.js'), /if \(!hasSharedCamera\(\)\) centerOnCity\(\{ animate: false \}\)/);
assert.match(read('public/js/mapEngine.js'), /CITY_FRAME_SLACK = 0\.16/);
assert.match(read('public/js/mapEngine.js'), /REGION_PAD_KM = 100/);
assert.match(read('public/js/mapEngine.js'), /cityFrameZoom\(L\.latLngBounds\(MAP_BOUNDS\)/);
assert.match(read('public/js/mapEngine.js'), /map\.options\.zoomSnap = 0/);
assert.match(read('public/js/app.js'), /setLevel\(DEFAULT_LEVEL, \{ keepView: true \}\)/);
assert.match(read('public/js/qhc2045Layer.js'), /export function initQhc2045Layer\(\)[\s\S]*syncQhc\(\);\s*\}/);
assert.match(read('public/js/chuyenNganh.js'), /axis: 'quyhoach'/);
assert.match(read('public/js/chuyenNganh.js'), /setLevel\('qhc25', \{ keepView: true \}\)/);
assert.match(read('public/js/chuyenNganh.js'), /QHC25_SCHEME = 'qhc-hue-2045'/);
assert.match(read('public/js/chuyenNganh.js'), /function paintQhc25Htkt\(/);
assert.match(read('public/js/chuyenNganh.js'), /Bản đồ hiện trạng tỷ lệ 1\/25\.000/);
assert.match(read('public/js/chuyenNganh.js'), /Bản đồ quy hoạch tỷ lệ 1\/25\.000/);
assert.match(read('public/js/app.js'), /initQhc25Scale/);
assert.match(read('public/js/qhc25Scale.js'), /Quy mô dân số/);
assert.match(read('docs/ui-spec.md'), /#qhc25Scale/);
assert.match(read('public/js/chuyenNganh.js'), /localStorage\.removeItem\(STORE_KEY\)/);
assert.doesNotMatch(read('public/js/chuyenNganh.js'), /function applySavedLayers|function readSaved|localStorage\.setItem\(STORE_KEY/);
assert.match(read('docs/bon-truc.md'), /Không khôi phục lớp/);
assert.match(css, /33dvh/);
assert.match(css, /body:not\(\.right-collapsed\)\s*\{\s*--phone-axis-w:\s*0px/);
assert.match(css, /body\.right-collapsed\s*\{\s*--info-left:\s*var\(--phone-tool-left\);/);
assert.match(read('docs/ui-spec.md'), /kể cả khi panel trục đang thu/);
assert.match(css, /--safe-top:\s*env\(safe-area-inset-top/);
assert.match(css, /--safe-bottom:\s*env\(safe-area-inset-bottom/);
assert.match(css, /--phone-axis-w:\s*64px/);
const rail = css.slice(css.indexOf('/* phone-axis-rail */'), css.indexOf('/* phone-axis-rail-end */'));
assert.ok(rail.includes('flex-direction'), 'thiếu cột trục điện thoại');
assert.match(rail, /flex-direction:\s*column/);
assert.match(rail, /left:\s*max\(4px,\s*var\(--safe-left\)\)/);
assert.match(rail, /flex:\s*1 1 0/);
assert.doesNotMatch(rail, /flex-direction:\s*row/);
assert.match(side, /var\(--phone-axis-w\)/);
assert.doesNotMatch(css, /\.ov-launch\s*\{[^}]*position:\s*fixed/);
assert.match(read('public/js/mapContext.js'), /LONG_MS = 1500/);
assert.match(read('public/js/mapContext.js'), /_qhLong/);
assert.match(read('public/js/mapContext.js'), /pointermove/);
assert.match(mobileJs, /Không vào chế độ toàn màn hình của trình duyệt/);
assert.match(mobileJs, /display-mode: standalone/);
assert.match(read('docs/ui-spec.md'), /không xin toàn màn hình và không thông báo/);
assert.match(read('docs/ui-spec.md'), /không hiện thông báo, banner hay hộp thoại/);
assert.match(read('docs/ui-spec.md'), /Google vệ tinh/);
assert.match(read('docs/ui-spec.md'), /1,5 giây/);
assert.match(read('docs/ui-spec.md'), /viewport-fit=cover/);
assert.match(read('docs/ui-spec.md'), /không nằm ở đáy/);
assert.match(read('docs/ui-spec.md'), /không nút nổi riêng|Không nút nổi riêng/);

console.log('core ui ok');
