// Khóa click lớp chi tiết khi đang xem Hệ thống đô thị dưới mức phóng 13.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const flow = fs.readFileSync(path.join(root, 'public/js/viewFlow.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

assert.ok(flow.includes('URBAN_DETAIL_ZOOM = 13'), 'ngưỡng phóng 13');
assert.ok(flow.includes('function detailClickLocked'), 'hàm khóa click');
assert.ok(flow.includes('detail-locked'), 'lớp CSS trên bản đồ');
assert.ok(flow.includes('phóng tới mức 13 để bấm công trình'), 'gợi ý trên lớp đô thị');
assert.ok(html.includes('id="urbanLockHint"'), 'chỗ ghi gợi ý');
assert.ok(css.includes('.leaflet-container.detail-locked .leaflet-pane canvas'), 'canvas lớp phủ không nhận chuột');
assert.ok(css.includes('.leaflet-urbanLine-pane .leaflet-interactive'), 'nét ranh đô thị vẫn bấm được');
assert.ok(css.includes('.leaflet-container.detail-locked .leaflet-marker-pane > .ua-badge-icon'), 'ký hiệu đô thị vẫn bấm được');
assert.ok(app.includes('detailClickLocked(targetMap)'), 'click bản đồ hỏi khóa');
assert.ok(app.includes('!detailLocked && infraClickAt'), 'tem công trình nhường khi khóa');
assert.ok(app.includes('!detailLocked && qhcClick'), 'giao thông, lô QHC nhường khi khóa');

console.log('detail lock: ok');
