// Chấm sáng trên tuyến nối phân tích điểm: 1 chấm/tuyến, ~130 m/s, vẫn 30 khung/giây.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/flowAnimation.js'), 'utf8');

assert.ok(/const DOTS_PER_PATH = 1\b/.test(src), 'một chấm sáng trên mỗi tuyến');
assert.ok(/const SPEED_MPS = 130\b/.test(src), 'tốc độ khoảng 130 m/s');
assert.ok(!/const SPEED_MPS = 260\b/.test(src), 'không còn tốc độ 260');
assert.ok(!/const DOTS_PER_PATH = 3\b/.test(src), 'không còn 3 chấm');
assert.ok(/const FRAME_MS = 1000 \/ 30/.test(src), 'vẫn giới hạn 30 khung/giây');
assert.ok(src.includes("map.on('movestart zoomstart', pause)"), 'tạm dừng khi kéo hoặc phóng');
assert.ok(src.includes('requestAnimationFrame(tick)'), 'vẽ theo khung hình của trình duyệt');
assert.ok(src.includes('L.canvas({ pane: PANE })'), 'canvas riêng, không vẽ lại lớp công trình');

console.log('flow dots: ok');
