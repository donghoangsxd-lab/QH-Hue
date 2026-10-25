// Bố cục ngang theo hướng máy: matchMedia (orientation) và, trên cảm ứng, screen.orientation.
// orientation.lock thường bị chặn ngoài toàn màn hình và trên iOS — khóa chỉ là tùy chọn, không giữ chrome dọc.
// Cài ứng dụng: Android dùng beforeinstallprompt; iOS không có prompt, hướng dẫn Chia sẻ → Thêm vào Màn hình chính.
const PHONE = window.matchMedia('(max-width: 840px), ((pointer: coarse) and (max-height: 560px) and (max-width: 1400px))');
const VIEW_LAND = window.matchMedia('(orientation: landscape)');
const COARSE = window.matchMedia('(pointer: coarse)');
const DISMISS = 'qh_mobile_orient_dismiss';
const FS_OFFER = 'qh_mobile_fs_offer';

const $ = (id) => document.getElementById(id);

let deferredInstall = null;
let lockHeld = false;

function iosDevice() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function installedApp() {
  return window.matchMedia('(display-mode: fullscreen)').matches
    || window.matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;
}

function dismissed() {
  try { return sessionStorage.getItem(DISMISS) === '1'; } catch (e) { return false; }
}

function rememberDismiss() {
  try { sessionStorage.setItem(DISMISS, '1'); } catch (e) { /* chế độ riêng tư */ }
}

function fsAlreadyOffered() {
  try { return sessionStorage.getItem(FS_OFFER) === '1'; } catch (e) { return false; }
}

function rememberFsOffer() {
  try { sessionStorage.setItem(FS_OFFER, '1'); } catch (e) { /* chế độ riêng tư */ }
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
  let w = Math.round((vv && vv.width) || window.innerWidth || 0);
  let h = Math.round((vv && vv.height) || window.innerHeight || 0);
  if (land && h > w && w > 0) {
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
  if (btn) btn.setAttribute('aria-pressed', phone && land && lockHeld ? 'true' : 'false');
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

function showToast(mode) {
  const box = $('mobileFs');
  const text = $('mobileFsText');
  const go = $('btnMobileFs');
  const later = $('btnMobileFsLater');
  if (!box || !text || !go) return;
  box.hidden = false;
  box.dataset.mode = mode;
  if (mode === 'fullscreen') {
    text.textContent = 'Mở toàn màn hình để khóa chiều ngang. Nếu trình duyệt không cho phép, bố cục vẫn theo hướng máy.';
    go.hidden = false;
    go.textContent = 'Toàn màn hình';
    if (later) later.hidden = false;
  } else if (mode === 'lock-blocked') {
    text.textContent = 'Trình duyệt không khóa được chiều xoay. Bố cục vẫn theo hướng máy.';
    go.hidden = false;
    go.textContent = 'Đóng';
    if (later) later.hidden = true;
  } else {
    text.textContent = 'Xoay máy ngang để xem bản đồ. Bố cục đổi theo hướng máy.';
    go.hidden = false;
    go.textContent = 'Đóng';
    if (later) later.hidden = false;
  }
}

function hideToast() {
  const box = $('mobileFs');
  if (box) box.hidden = true;
}

function syncToast() {
  const root = document.documentElement;
  const phone = root.classList.contains('is-phone');
  const land = root.classList.contains('is-landscape');
  const box = $('mobileFs');
  const mode = box && box.dataset.mode;
  if (!phone) {
    hideToast();
    return;
  }
  if (box && !box.hidden && (mode === 'fullscreen' || mode === 'lock-blocked')) return;
  if (land || dismissed() || installedApp()) {
    hideToast();
    return;
  }
  if (box && !box.hidden && mode === 'hint') return;
  showToast('hint');
}

async function tryLockLandscape() {
  if (!screen.orientation || !screen.orientation.lock) return false;
  try {
    await screen.orientation.lock('landscape');
    lockHeld = true;
    const btn = $('btnRotateScreen');
    if (btn) btn.setAttribute('aria-pressed', 'true');
    return true;
  } catch (e) {
    lockHeld = false;
    const btn = $('btnRotateScreen');
    if (btn) btn.setAttribute('aria-pressed', 'false');
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

// PWA đã cài (standalone): xin toàn màn hình để thanh trạng thái và thanh điều hướng không che giao diện.
// Lần gọi lúc tải thường thiếu cử chỉ; lần chạm đầu tiên thử lại. Từ chối thì thôi, không nhắc.
let standaloneFsDone = false;
function requestStandaloneFullscreen() {
  if (standaloneFsDone || !installedApp() || inFullscreen()) return;
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return;
  Promise.resolve(req.call(el)).then(() => { standaloneFsDone = true; }).catch(() => {});
}

async function toggleLandscape() {
  const land = deviceLandscape();
  if (land && lockHeld && screen.orientation && screen.orientation.unlock) {
    try {
      screen.orientation.unlock();
      lockHeld = false;
      const btn = $('btnRotateScreen');
      if (btn) btn.setAttribute('aria-pressed', 'false');
      return;
    } catch (e) { /* thử khóa lại */ }
  }
  if (land) {
    const ok = await tryLockLandscape();
    if (!ok) showToast('lock-blocked');
    else hideToast();
    applyFrame();
    return;
  }
  const el = document.documentElement;
  const canFs = !!(el.requestFullscreen || el.webkitRequestFullscreen);
  if (!inFullscreen() && canFs && !fsAlreadyOffered()) {
    rememberFsOffer();
    showToast('fullscreen');
    return;
  }
  if (canFs && !inFullscreen()) await enterFullscreen();
  const ok = await tryLockLandscape();
  if (!ok) showToast('lock-blocked');
  else hideToast();
  applyFrame();
}

async function onFullscreenAccept() {
  await enterFullscreen();
  const ok = await tryLockLandscape();
  if (!ok) showToast('lock-blocked');
  else hideToast();
  applyFrame();
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
  syncToast();
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
  $('btnMobileFs')?.addEventListener('click', () => {
    const mode = $('mobileFs')?.dataset.mode;
    if (mode === 'fullscreen') onFullscreenAccept();
    else if (mode === 'lock-blocked') hideToast();
    else { rememberDismiss(); hideToast(); }
  });
  $('btnMobileFsLater')?.addEventListener('click', () => {
    rememberDismiss();
    hideToast();
  });
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
  const onStandaloneGesture = () => {
    if (standaloneFsDone || inFullscreen()) {
      document.removeEventListener('pointerdown', onStandaloneGesture, true);
      return;
    }
    requestStandaloneFullscreen();
  };
  document.addEventListener('pointerdown', onStandaloneGesture, true);
  requestStandaloneFullscreen();
  paint();
}
