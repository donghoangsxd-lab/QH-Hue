// Admin: tải trước mạng đường của mọi công trình lên bucket để "phạm vi thực tế" hiện ngay cho mọi người dùng
import { state } from './state.js';
import { preloadServerRoads } from './serviceArea.js';

const WORKERS = 2;             // số công trình tải song song (giữ nhẹ cho máy chủ Overpass công cộng)
const PAUSE_AFTER_NEW_MS = 800;
const MAX_STORED_RADIUS = 3500; // bán kính tải lớn hơn máy chủ không lưu sẵn (services/roadsService.js)

let running = false;
let stopRequested = false;

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Công trình không trùng vị trí (~10 m) + bán kính tải (bậc 500 m, giống máy chủ) → mỗi file bucket chỉ hỏi 1 lần
function uniqueTargets() {
  const seen = new Set();
  const out = [];
  [...state.rawDataList, ...state.planDataList].forEach(it => {
    const lat = Number(it.lat), lng = Number(it.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const radius = Number(it.radius) || Number(it.banKinh) || 500;
    const step = Math.ceil((radius + 100) / 500);
    if (step * 500 > MAX_STORED_RADIUS) return;
    const key = `${lat.toFixed(4)}_${lng.toFixed(4)}_${step}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ lat, lng, radius });
  });
  return out;
}

function setMsg(text, color) {
  const el = $('roadsPreloadMsg');
  if (!el) return;
  el.textContent = text;
  el.style.color = color || '';
}

async function run() {
  const targets = uniqueTargets();
  if (!targets.length) { setMsg('Chưa có dữ liệu công trình.', 'var(--accent-red)'); return; }
  if (!confirm(`Tải trước mạng đường cho ${targets.length} vị trí công trình?\n\nVị trí đã có trên bucket sẽ bỏ qua nhanh; vị trí mới mất vài giây mỗi điểm. Giữ tab mở tới khi xong (có thể bấm Dừng).`)) return;

  running = true;
  stopRequested = false;
  const btn = $('btnPreloadRoads');
  if (btn) btn.textContent = '⏹ Dừng tải trước';
  const count = { done: 0, cache: 0, saved: 0, failed: 0 };
  const show = () => setMsg(`Đã xử lý ${count.done}/${targets.length} · có sẵn ${count.cache} · mới lưu ${count.saved} · lỗi ${count.failed}`, 'var(--accent-orange)');
  show();

  let next = 0;
  const worker = async () => {
    while (!stopRequested && next < targets.length) {
      const t = targets[next++];
      try {
        const result = await preloadServerRoads(t.lat, t.lng, t.radius);
        if (result === 'cache') count.cache++;
        else if (result === 'saved') { count.saved++; await sleep(PAUSE_AFTER_NEW_MS); }
        else count.failed++;
      } catch (err) {
        count.failed++;
      }
      count.done++;
      show();
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));

  running = false;
  if (btn) btn.textContent = '🛣️ Tải trước mạng đường';
  const summary = `có sẵn ${count.cache} · mới lưu ${count.saved} · lỗi ${count.failed}`;
  setMsg(stopRequested
    ? `Đã dừng ở ${count.done}/${targets.length} (${summary}).`
    : `✓ Xong ${targets.length} vị trí (${summary}).${count.failed ? ' Chạy lại để thử các vị trí lỗi.' : ''}`,
    count.failed ? 'var(--accent-orange)' : 'var(--accent-green)');
}

export function initRoadsPreload() {
  $('btnPreloadRoads')?.addEventListener('click', () => {
    if (running) { stopRequested = true; setMsg('Đang dừng sau các vị trí đang tải...', 'var(--accent-orange)'); return; }
    if (state.currentUserRole !== 'ADMIN') return;
    run();
  });
}
