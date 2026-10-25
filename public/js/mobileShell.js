// Điện thoại: ưu tiên chiều ngang. orientation.lock cần cử chỉ và thường cần toàn màn hình.
// iOS Safari không khóa xoay và không có beforeinstallprompt — hướng dẫn Thêm vào Màn hình chính.
// Lời nhắc chỉ khi máy đang dọc. «Để sau» tắt trong phiên, không nhắc lại.
const PHONE = window.matchMedia('(max-width: 840px), ((pointer: coarse) and (max-height: 500px) and (max-width: 1200px))');
const PORTRAIT = window.matchMedia('(orientation: portrait)');
const DISMISS = 'qh_mobile_orient_dismiss';

const $ = (id) => document.getElementById(id);

let deferredInstall = null;
let lockFailed = false;
let landscapeHeld = false;

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

function promptMode() {
  if (installedApp()) return 'installed';
  if (iosDevice()) return 'ios';
  if (deferredInstall) return 'install';
  if (lockFailed) return 'rotate';
  return 'ask';
}

function showPrompt(mode) {
  const box = $('mobileFs');
  const text = $('mobileFsText');
  const go = $('btnMobileFs');
  const install = $('btnMobileInstall');
  if (!box || !text || !go) return;
  box.hidden = false;
  box.dataset.mode = mode;
  if (install) install.hidden = mode !== 'install' && mode !== 'install-land';
  go.hidden = mode === 'install-land';
  if (mode === 'install-land') {
    text.textContent = 'Cài vào màn hình chính để mở bản đồ theo chiều ngang.';
    go.textContent = 'Xoay ngang';
  } else if (mode === 'ios') {
    text.textContent = 'Xoay ngang để xem bản đồ. Trên Safari: Chia sẻ, rồi Thêm vào Màn hình chính.';
    go.textContent = 'Đã hiểu';
  } else if (mode === 'install') {
    text.textContent = 'Xoay ngang để xem bản đồ, hoặc cài vào màn hình chính để mở theo chiều ngang.';
    go.textContent = 'Xoay ngang';
  } else if (mode === 'installed') {
    text.textContent = 'Xoay máy ngang. Bản đồ được bố trí cho chiều ngang.';
    go.textContent = 'Đóng';
  } else if (mode === 'rotate') {
    text.textContent = 'Hãy xoay máy ngang. Trình duyệt này không khóa được chiều xoay.';
    go.textContent = 'Đóng';
  } else if (mode === 'lock-blocked') {
    text.textContent = 'Trình duyệt này không khóa được chiều xoay.';
    go.textContent = 'Đóng';
  } else {
    text.textContent = 'Xoay ngang để xem bản đồ.';
    go.textContent = 'Xoay ngang';
  }
}

function hidePrompt() {
  const box = $('mobileFs');
  if (box) box.hidden = true;
}

function inFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

async function enterLandscapeFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req && !inFullscreen()) {
    try { await req.call(el); } catch (e) { /* iOS không toàn màn hình cả trang */ }
  }
  let locked = false;
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape');
      locked = true;
    }
  } catch (e) {
    locked = false;
  }
  lockFailed = !locked;
  landscapeHeld = locked;
  markRotate(locked && !PORTRAIT.matches);
  if (!PORTRAIT.matches) hidePrompt();
  else sync();
}

function markRotate(on) {
  const btn = $('btnRotateScreen');
  if (!btn) return;
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

async function toggleLandscape() {
  const landscapeNow = !PORTRAIT.matches;
  if (landscapeNow && landscapeHeld && screen.orientation && screen.orientation.unlock) {
    try {
      screen.orientation.unlock();
      landscapeHeld = false;
      markRotate(false);
      return;
    } catch (e) { /* khóa lại chiều ngang */ }
  }
  await enterLandscapeFullscreen();
  if (lockFailed) showPrompt(PORTRAIT.matches ? 'rotate' : 'lock-blocked');
}

async function installApp() {
  const wait = deferredInstall;
  if (!wait) return;
  try {
    await wait.prompt();
    const choice = await wait.userChoice;
    deferredInstall = null;
    if (choice && choice.outcome === 'accepted') hidePrompt();
  } catch (e) {
    deferredInstall = null;
  }
  sync();
}

function sync() {
  const phone = PHONE.matches;
  const portrait = PORTRAIT.matches;
  document.documentElement.classList.toggle('is-phone', phone);
  document.documentElement.classList.toggle('is-portrait', phone && portrait);
  if (!portrait) markRotate(phone && landscapeHeld);
  if (!phone || dismissed()) {
    hidePrompt();
    return;
  }
  if (!portrait) {
    if (deferredInstall && !installedApp()) showPrompt('install-land');
    else hidePrompt();
    return;
  }
  showPrompt(promptMode());
}

window.addEventListener('beforeinstallprompt', (event) => {
  if (!PHONE.matches) return;
  event.preventDefault();
  deferredInstall = event;
  sync();
});

window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  sync();
});

export function initMobileShell() {
  $('btnRotateScreen')?.addEventListener('click', () => { toggleLandscape(); });
  if (!$('mobileFs')) return;
  PHONE.addEventListener('change', sync);
  PORTRAIT.addEventListener('change', sync);
  $('btnMobileFs')?.addEventListener('click', () => {
    const mode = $('mobileFs')?.dataset.mode;
    if (mode === 'ask' || mode === 'install') enterLandscapeFullscreen();
    else { rememberDismiss(); hidePrompt(); }
  });
  $('btnMobileInstall')?.addEventListener('click', () => { installApp(); });
  $('btnMobileFsLater')?.addEventListener('click', () => {
    rememberDismiss();
    hidePrompt();
  });
  document.addEventListener('fullscreenchange', sync);
  sync();
}
