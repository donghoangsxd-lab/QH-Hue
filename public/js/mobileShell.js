// Lần mở ưu tiên chiều ngang thật bằng Screen Orientation API (nhiều trình duyệt cần cử chỉ).
// Không vào chế độ toàn màn hình của trình duyệt: Chrome hiện toast thoát lúc vào và lúc máy xoay.
// Khóa bị chặn thì theo hướng khung nhìn, không xoay html/body bằng CSS. transform: rotate làm clientX/clientY
// và canvas MapLibre/Leaflet lệch khỏi chỗ đang thấy — chạm, kéo bản đồ và cột nút đều trượt.
// Cài ứng dụng: Android dùng beforeinstallprompt; iOS không có prompt, hướng dẫn Chia sẻ → Thêm vào Màn hình chính.
const PHONE = window.matchMedia('(max-width: 840px), ((pointer: coarse) and (max-height: 560px) and (max-width: 1400px))');
const VIEW_LAND = window.matchMedia('(orientation: landscape)');
const COARSE = window.matchMedia('(pointer: coarse)');

const $ = (id) => document.getElementById(id);

let deferredInstall = null;
let lockHeld = false;
// Còn muốn xin khóa ngang sau cử chỉ đầu. Nút xoay tắt cờ này khi người dùng chọn dọc.
let preferLandscape = true;
let lockArmed = false;

function iosDevice() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function installedApp() {
  return window.matchMedia('(display-mode: fullscreen)').matches
    || window.matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;
}

function screenLandscape() {
  const ori = screen.orientation;
  if (ori && typeof ori.type === 'string') {
    if (ori.type.startsWith('landscape')) return true;
    if (ori.type.startsWith('portrait')) return false;
  }
  const angle = ori && typeof ori.angle === 'number' ? ori.angle : window.orientation;
  if (angle === 90 || angle === -90 || angle === 270) return true;
  if (angle === 0 || angle === 180) return false;
  return null;
}

function deviceLandscape() {
  // Bố cục bám cửa sổ (innerWidth/innerHeight), cùng hệ với chạm và canvas bản đồ.
  // Không lấy visualViewport: bàn phím làm chiều cao nhìn thấy tụt xuống, dễ nhận nhầm là ngang.
  // screen.orientation chỉ để khóa chiều, không ép lớp ngang khi cửa sổ vẫn dọc.
  const w = window.innerWidth || 0;
  const h = window.innerHeight || 0;
  if (w > 0 && h > 0 && w !== h) return w > h;
  if (VIEW_LAND.matches) return true;
  return screenLandscape() === true;
}

function phoneNow() {
  if (PHONE.matches) return true;
  if (!COARSE.matches) return false;
  const w = window.innerWidth || 0;
  const h = window.innerHeight || 0;
  return Math.min(w, h) <= 560 && Math.max(w, h) <= 1400;
}

function applyFrame() {
  const phone = phoneNow();
  const land = deviceLandscape();
  const root = document.documentElement;
  root.classList.toggle('is-phone', phone);
  root.classList.toggle('is-landscape', phone && land);
  root.classList.toggle('is-portrait', phone && !land);
  if (!phone) {
    root.style.removeProperty('--vv-w');
    root.style.removeProperty('--vv-h');
    return;
  }
  const vv = window.visualViewport;
  const w = Math.round((vv && vv.width) || window.innerWidth || 0);
  const h = Math.round((vv && vv.height) || window.innerHeight || 0);
  if (w > 0 && h > 0) {
    const nextW = w + 'px';
    const nextH = h + 'px';
    if (root.style.getPropertyValue('--vv-w') !== nextW) root.style.setProperty('--vv-w', nextW);
    if (root.style.getPropertyValue('--vv-h') !== nextH) root.style.setProperty('--vv-h', nextH);
  }
  const btn = $('btnRotateScreen');
  if (btn) btn.setAttribute('aria-pressed', phone && land ? 'true' : 'false');
}

function nudgeViewport() {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  const content = meta.getAttribute('content');
  if (!content) return;
  meta.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
  void document.documentElement.offsetHeight;
  meta.setAttribute('content', content);
}

async function tryLock(orient) {
  if (!screen.orientation || !screen.orientation.lock) return false;
  try {
    await screen.orientation.lock(orient);
    lockHeld = true;
    return true;
  } catch (e) {
    lockHeld = false;
    return false;
  }
}

// Khóa chiều nếu trình duyệt cho phép mà không cần toàn màn hình. Từ chối thì giữ hướng khung nhìn.
async function engage(orient) {
  if (!phoneNow()) return;
  const ok = await tryLock(orient);
  if (!ok && screen.orientation && screen.orientation.unlock && orient === 'portrait') {
    try { screen.orientation.unlock(); } catch (e) { /* máy giữ hướng thật */ }
    lockHeld = false;
  }
  applyFrame();
  window.dispatchEvent(new Event('resize'));
}

async function toggleLandscape() {
  if (!phoneNow()) return;
  const next = deviceLandscape() ? 'portrait' : 'landscape';
  preferLandscape = next === 'landscape';
  lockArmed = true;
  nudgeViewport();
  await engage(next);
}

function syncInstallButton() {
  const btn = $('btnInstallApp');
  if (!btn) return;
  const phone = document.documentElement.classList.contains('is-phone');
  btn.hidden = !phone || installedApp();
}

function showInstallGuide(kind) {
  const box = $('installGuide');
  const title = $('installGuideTitle');
  const ios = $('installGuideIos');
  const android = $('installGuideAndroid');
  if (!box) return;
  const apple = kind === 'ios';
  if (title) title.textContent = apple ? 'Thêm vào Màn hình chính' : 'Cài ứng dụng';
  if (ios) ios.hidden = !apple;
  if (android) android.hidden = apple;
  box.hidden = false;
}

function hideInstallGuide() {
  const box = $('installGuide');
  if (box) box.hidden = true;
}

async function installApp() {
  if (installedApp()) return;
  if (iosDevice()) {
    showInstallGuide('ios');
    return;
  }
  const wait = deferredInstall;
  if (!wait) {
    showInstallGuide('android');
    return;
  }
  try {
    await wait.prompt();
    const choice = await wait.userChoice;
    deferredInstall = null;
    if (choice && choice.outcome === 'accepted') hideInstallGuide();
  } catch (e) {
    deferredInstall = null;
    showInstallGuide('android');
  }
  syncInstallButton();
}

function paint() {
  applyFrame();
  syncInstallButton();
}

function kick() {
  nudgeViewport();
  paint();
  window.dispatchEvent(new Event('resize'));
  setTimeout(paint, 80);
  setTimeout(paint, 320);
}

export function initMobileShell() {
  $('btnRotateScreen')?.addEventListener('click', () => { toggleLandscape(); });
  $('btnInstallApp')?.addEventListener('click', () => { installApp(); });
  $('btnInstallGuideClose')?.addEventListener('click', hideInstallGuide);
  PHONE.addEventListener('change', kick);
  VIEW_LAND.addEventListener('change', kick);
  window.addEventListener('orientationchange', kick);
  window.addEventListener('resize', paint);
  if (screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener('change', kick);
  }
  if (window.visualViewport) window.visualViewport.addEventListener('resize', paint);
  window.addEventListener('beforeinstallprompt', (event) => {
    if (!phoneNow()) return;
    event.preventDefault();
    deferredInstall = event;
    syncInstallButton();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    hideInstallGuide();
    syncInstallButton();
  });
  const onFirstGesture = (event) => {
    if (lockArmed || !phoneNow() || !preferLandscape) return;
    if (event.target && event.target.closest && event.target.closest('#btnRotateScreen')) return;
    lockArmed = true;
    document.removeEventListener('pointerdown', onFirstGesture, true);
    if (lockHeld) return;
    engage('landscape');
  };
  document.addEventListener('pointerdown', onFirstGesture, true);
  if (phoneNow()) engage('landscape');
  paint();
}
