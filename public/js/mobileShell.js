// Điện thoại: gợi ý toàn màn hình ngang. requestFullscreen và orientation.lock bắt buộc có cử chỉ người dùng.
// iOS Safari không toàn màn hình được cả trang và không khóa hướng xoay — chỉ hướng dẫn xoay máy và thêm vào Màn hình chính.
const PHONE = window.matchMedia('(max-width: 840px)');
const DISMISS = 'qh_mobile_fs_dismiss';

const $ = (id) => document.getElementById(id);

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

function showPrompt(mode) {
  const box = $('mobileFs');
  const text = $('mobileFsText');
  const go = $('btnMobileFs');
  if (!box || !text || !go) return;
  box.hidden = false;
  box.dataset.mode = mode;
  if (mode === 'ios') {
    text.textContent = 'Safari trên iPhone không mở toàn màn hình và không khóa xoay ngang. Hãy xoay máy ngang, rồi bấm nút Chia sẻ và chọn Thêm vào Màn hình chính. Bản đã cài sẽ mở ngang, toàn màn hình.';
    go.textContent = 'Đã hiểu';
  } else if (mode === 'lock-fail') {
    text.textContent = 'Đã mở toàn màn hình. Trình duyệt này không khóa được xoay ngang — hãy tự xoay máy.';
    go.textContent = 'Đóng';
  } else {
    text.textContent = 'Xem bản đồ ngang, toàn màn hình để lớp quy hoạch dễ đọc hơn.';
    go.textContent = 'Toàn màn hình';
  }
}

function hidePrompt() {
  const box = $('mobileFs');
  if (box) box.hidden = true;
}

async function enterLandscapeFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) {
    showPrompt('ios');
    return;
  }
  try {
    await req.call(el);
  } catch (e) {
    showPrompt('ios');
    return;
  }
  try {
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
    hidePrompt();
  } catch (e) {
    showPrompt('lock-fail');
  }
}

function sync() {
  const phone = PHONE.matches;
  document.documentElement.classList.toggle('is-phone', phone);
  if (!phone || installedApp() || dismissed() || document.fullscreenElement) {
    if (!phone || installedApp() || dismissed()) hidePrompt();
    window.dispatchEvent(new Event('resize'));
    return;
  }
  showPrompt(iosDevice() ? 'ios' : 'ask');
  window.dispatchEvent(new Event('resize'));
}

export function initMobileShell() {
  if (!$('mobileFs')) return;
  PHONE.addEventListener('change', sync);
  $('btnMobileFs')?.addEventListener('click', () => {
    const mode = $('mobileFs')?.dataset.mode;
    if (mode === 'ask') enterLandscapeFullscreen();
    else { rememberDismiss(); hidePrompt(); }
  });
  $('btnMobileFsLater')?.addEventListener('click', () => {
    rememberDismiss();
    hidePrompt();
  });
  document.addEventListener('fullscreenchange', sync);
  sync();
}
