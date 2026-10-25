// Điện thoại mở sẵn bố cục ngang. Khóa chiều bằng Screen Orientation API khi trình duyệt cho phép
// (thường cần toàn màn hình và một cử chỉ). Bị chặn thì vẫn xoay khung bằng CSS, không hiện lời nhắc.
// Cài ứng dụng: Android dùng beforeinstallprompt; iOS không có prompt, hướng dẫn Chia sẻ → Thêm vào Màn hình chính.
const PHONE = window.matchMedia('(max-width: 840px), ((pointer: coarse) and (max-height: 560px) and (max-width: 1400px))');
const VIEW_LAND = window.matchMedia('(orientation: landscape)');
const COARSE = window.matchMedia('(pointer: coarse)');

const $ = (id) => document.getElementById(id);

let deferredInstall = null;
let lockHeld = false;
// 'landscape' | 'portrait' trên điện thoại. null = máy tính, theo hướng cửa sổ.
let presented = null;
let fsArmed = false;

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
  const viewLand = VIEW_LAND.matches || window.innerWidth > window.innerHeight;
  // Màn hình máy tính luôn ngang dù cửa sổ hẹp. Chỉ tin screen.orientation trên cảm ứng,
  // để điện thoại đã xoay vẫn ra bố cục ngang khi khung nhìn bị kẹt dọc.
  const screenLand = screenLandscape();
  if (COARSE.matches && screenLand !== null) return screenLand;
  return viewLand;
}

function phoneNow() {
  if (PHONE.matches) return true;
  if (!COARSE.matches) return false;
  const w = window.innerWidth || 0;
  const h = window.innerHeight || 0;
  return Math.min(w, h) <= 560 && Math.max(w, h) <= 1400;
}

function wantLandscape() {
  if (!phoneNow()) return deviceLandscape();
  if (presented === 'portrait') return false;
  return true;
}

function applyFrame() {
  const phone = phoneNow();
  const land = wantLandscape();
  const root = document.documentElement;
  root.classList.toggle('is-phone', phone);
  root.classList.toggle('is-landscape', phone && land);
  root.classList.toggle('is-portrait', phone && !land);
  if (!phone) {
    root.classList.remove('is-turned');
    root.style.removeProperty('--vv-w');
    root.style.removeProperty('--vv-h');
    return;
  }
  const vv = window.visualViewport;
  let w = Math.round((vv && vv.width) || window.innerWidth || 0);
  let h = Math.round((vv && vv.height) || window.innerHeight || 0);
  const viewLand = w > h;
  const turned = w > 0 && h > 0 && land !== viewLand;
  root.classList.toggle('is-turned', turned);
  if (turned) {
    const swap = w;
    w = h;
    h = swap;
  }
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

function inFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
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

async function enterFullscreen() {
  if (inFullscreen()) return true;
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return false;
  try {
    await req.call(el);
    return true;
  } catch (e) {
    return false;
  }
}

// Toàn màn hình rồi khóa chiều. Từ chối thì bố cục CSS đã áp, không nhắc.
async function engage(orient) {
  if (orient === 'landscape') await enterFullscreen();
  const ok = await tryLock(orient);
  if (!ok && screen.orientation && screen.orientation.unlock && orient === 'portrait') {
    try { screen.orientation.unlock(); } catch (e) { /* giữ bố cục CSS */ }
    lockHeld = false;
  }
  applyFrame();
  window.dispatchEvent(new Event('resize'));
}

async function toggleLandscape() {
  if (!phoneNow()) return;
  presented = wantLandscape() ? 'portrait' : 'landscape';
  applyFrame();
  nudgeViewport();
  window.dispatchEvent(new Event('resize'));
  await engage(presented);
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
  if (phoneNow()) presented = 'landscape';
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
  document.addEventListener('fullscreenchange', paint);
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
    if (fsArmed || !phoneNow() || presented !== 'landscape') return;
    if (event.target && event.target.closest && event.target.closest('#btnRotateScreen')) return;
    fsArmed = true;
    document.removeEventListener('pointerdown', onFirstGesture, true);
    if (inFullscreen() && lockHeld) return;
    engage('landscape');
  };
  document.addEventListener('pointerdown', onFirstGesture, true);
  if (phoneNow()) engage('landscape');
  paint();
}
