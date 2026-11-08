// Cây a/b trục B + brief icon ?
import assert from 'assert';
import fs from 'fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const html = read('public/index.html');
const layer = read('public/js/projectLayer.js');
const brief = read('public/js/projectBrief.js');
const spec = read('docs/ui-spec.md');
const css = read('public/css/style.css');

assert.match(html, /id="qhc25HtktHt"/);
assert.match(html, /id="qhc25HtktQh"/);
assert.match(html, /id="gt25Children"/);
assert.match(html, /data-gt25-fold/);
assert.match(html, /id="qhc25Layers"(?![^>]*\bhidden\b)/);
assert.match(html, /data-qhc-expand="25"[^>]*aria-expanded="true"/);
assert.match(html, /a\. Các bản đồ hiện trạng/);
assert.match(html, /b\. Các bản đồ quy hoạch/);
assert.doesNotMatch(html, /id="qhc25Scale"/);
assert.doesNotMatch(html, /id="qhc10Brief"/);
assert.match(read('public/js/chuyenNganh.js'), /Hiện trạng giao thông/);
assert.match(read('public/js/chuyenNganh.js'), /qhc25GtChildLayers\('quy-hoach'\)/);
assert.match(read('public/js/chuyenNganh.js'), /level === 'qhc25'\) openQhc25Layers/);

assert.match(layer, /a\. Các bản đồ hiện trạng/);
assert.match(layer, /b\. Các bản đồ quy hoạch/);
assert.match(layer, /projectDossierSummaryHtmlByName/);
assert.doesNotMatch(layer, /capacityPanelHtml/);

assert.match(brief, /data-brief-help/);
assert.match(brief, /detailOpen/);
assert.match(brief, /openProjectBriefDetail/);

assert.match(spec, /data-brief-help/);
assert.match(spec, /#qhc25HtktHt/);
assert.match(spec, /#qhc25HtktQh/);
assert.match(spec, /#gt25Children/);
assert.match(css, /\.gt25-children/);
assert.match(css, /\.project-map-group-title/);
assert.match(css, /\.project-brief-tool\.is-on/);
assert.match(css, /#planListPane > #projectList/);
assert.match(css, /#layerPaneQuyHoach:not\(\[hidden\]\)/);
assert.match(spec, /giãn hết chiều cao phần còn lại phía trên `#rpDock`/);

console.log('axis-b-tree: ok');
