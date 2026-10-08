import { state, BUFFER_COLORS, isNetworkType, NT_KIND_LABELS, layerType, infraLabels } from './state.js';
import { map, renderGroupedPoints, focusWard, zoomToPoint } from './mapEngine.js';
import { geeApi } from './api.js';
import { escapeHtml, isApproved, fmtNum, fmtPct, loadHtml2Pdf, showToast, wardStatHtml, ico, setStatusContent, inlineSpriteIcons } from './utils.js';
import { refreshWardCheck } from './wardCheck.js';
import {
  fillWardRoadLengths, fillCityRoadDensity, loadRoadTypeLengths, ROAD_TYPES, ROADS_META_EVENT, fmtKm,
  densityArea, densityAreaLabel, BUILT_AREA_EVENT
} from './wardRoads.js';
import { refreshRoadPanel } from './customRoads.js';
import { refreshPopPanel } from './popEdits.js';
import { refreshCadRole } from './cadImportUi.js';
import { balanceSlot, balanceScaleHtml, toggleBalanceMap, clearBalanceMap, isBalanceMapOn, BALANCE_REF } from './wardBalance.js';
import { loadNewDevStats, newDevOf, newDevRowHtml } from './newDev.js';
import { renderGreenGrowth, initGreenGrowthEvents, reloadGreenGrowthRoads } from './greenGrowth.js';
import { renderUrbanClass, initUrbanClassEvents, reloadUrbanClassRoads } from './urbanClass.js';

let chartInstance = null;
let infraPieInstance = null;

// ================== ĐĂNG NHẬP QUẢN TRỊ ==================
// Quyền admin do máy chủ xác minh (chữ ký Google + danh sách email), client chỉ giữ token để gửi kèm yêu cầu phê duyệt
const GOOGLE_CLIENT_ID = "409688791128-s7b4uohia2a9n3u27rl0gmkdupiig554.apps.googleusercontent.com";
const ADMIN_SESSION_KEY = 'qh_hue_admin_session';
let googleSignInReady = false;

function setAuthMsg(text, color = 'var(--text-main)') {
  const msg = document.getElementById('authMsg');
  if (!msg) return;
  msg.style.color = color;
  setStatusContent(msg, text);
}

function showGoogleOriginHint() {
  setAuthMsg(`Origin ${window.location.origin} chưa được Google cho phép. Thêm origin này vào Authorized JavaScript origins của Client ID, hoặc chạy npx vercel dev (localhost) thay vì Live Server.`, 'var(--accent-orange)');
}

let googleSignInPending = false;
export function initGoogleSignIn() {
  const container = document.getElementById('googleSignInBtn');
  if (!container || googleSignInReady || googleSignInPending) return;
  googleSignInPending = true;

  const tryInit = (attempt = 0) => {
    if (!window.google?.accounts?.id) {
      if (attempt < 40) setTimeout(() => tryInit(attempt + 1), 150);
      else { googleSignInPending = false; showGoogleOriginHint(); }
      return;
    }
    googleSignInPending = false;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true
    });
    container.innerHTML = "";
    window.google.accounts.id.renderButton(container, {
      type: "standard", size: "large", theme: "filled_black",
      text: "signin_with", shape: "rectangular", logo_alignment: "left"
    });
    googleSignInReady = true;
  };
  tryInit();
}

export function toggleAuthModal() {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  const opening = modal.style.display !== 'block';
  modal.style.display = opening ? 'block' : 'none';
  if (!opening) return;
  if (state.currentUserRole === 'ADMIN' && state.authUser) {
    setAuthMsg(`✓ Đang đăng nhập quản trị: ${state.authUser.email}`, 'var(--accent-green)');
  } else {
    setAuthMsg('');
    initGoogleSignIn();
  }
  updateAuthUi();
}

async function verifyAdminToken(token) {
  const res = await fetch(geeApi('action=verifyAdmin'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.admin) {
    const err = new Error(data.message || `Lỗi xác thực (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function handleGoogleCredentialResponse(response) {
  setAuthMsg('⏳ Đang xác minh quyền quản trị với máy chủ...', 'var(--accent-orange)');
  try {
    const info = await verifyAdminToken(response.credential);
    setAdminSession(response.credential, info);
    setAuthMsg(`✓ Xin chào Admin (${info.name || info.email})`, 'var(--accent-green)');
    setTimeout(() => {
      const modal = document.getElementById('authModal');
      if (modal) modal.style.display = 'none';
    }, 1000);
  } catch (err) {
    setAuthMsg(`❌ ${err.message}`, 'var(--accent-red)');
  }
}

function setAdminSession(token, info) {
  state.currentUserRole = 'ADMIN';
  state.authToken = token;
  state.authUser = { email: info.email, name: info.name || info.email, exp: Number(info.exp) || 0 };
  try {
    sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ token, ...state.authUser }));
  } catch (e) {}
  updateAuthUi();
  renderGroupedPoints();
}

export function signOutAdmin() {
  const wasAdmin = state.currentUserRole === 'ADMIN';
  state.currentUserRole = 'VIEWER';
  state.authToken = null;
  state.authUser = null;
  try { sessionStorage.removeItem(ADMIN_SESSION_KEY); } catch (e) {}
  window.google?.accounts?.id?.disableAutoSelect?.();
  updateAuthUi();
  if (wasAdmin) {
    map.closePopup();
    renderGroupedPoints();
  }
}

// Khôi phục phiên admin khi tải lại trang (token Google còn hạn và máy chủ vẫn xác nhận quyền)
export async function restoreAdminSession() {
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(ADMIN_SESSION_KEY) || 'null'); } catch (e) {}
  if (!saved || !saved.token || !(Number(saved.exp) * 1000 > Date.now() + 60000)) {
    try { sessionStorage.removeItem(ADMIN_SESSION_KEY); } catch (e) {}
    return;
  }
  try {
    const info = await verifyAdminToken(saved.token);
    setAdminSession(saved.token, info);
  } catch (err) {
    if (err.status === 401 || err.status === 403) signOutAdmin();
  }
}

function updateAuthUi() {
  const isAdmin = state.currentUserRole === 'ADMIN' && !!state.authUser;
  const btnAuth = document.getElementById('btnAuth');
  if (btnAuth) {
    btnAuth.classList.toggle('is-admin', isAdmin);
    btnAuth.title = isAdmin ? `Đã đăng nhập: Admin (${state.authUser.name})` : 'Đăng nhập quản trị';
    btnAuth.setAttribute('aria-label', btnAuth.title);
    btnAuth.innerHTML = ico(isAdmin ? 'user' : 'key');
  }
  document.dispatchEvent(new CustomEvent('auth:change'));
  const signOut = document.getElementById('btnSignOut');
  if (signOut) signOut.style.display = isAdmin ? '' : 'none';
  const wardRoadsBtn = document.getElementById('btnWardRoads');
  if (wardRoadsBtn) wardRoadsBtn.style.display = isAdmin ? '' : 'none';
  const roadModeBtn = document.getElementById('btnAddRoadMode');
  if (roadModeBtn) {
    roadModeBtn.style.display = isAdmin ? '' : 'none';
    if (!isAdmin && roadModeBtn.classList.contains('active')) document.querySelector('.add-mode-btn[data-mode="addSingle"]')?.click();
  }
  refreshRoadPanel();
  refreshPopPanel();
  refreshCadRole();
  const gBtn = document.getElementById('googleSignInBtn');
  if (gBtn) gBtn.style.display = isAdmin ? 'none' : '';
  refreshWardCheck();
}

// ================== BIỂU ĐỒ DONUT CƠ CẤU DIỆN TÍCH ==================
function sumAreaByType(list) {
  const totals = {};
  let sum = 0;
  (list || []).forEach(item => {
    const type = item.type || 'Khác';
    if (!isApproved(item.status) || !PIE_LABELS[type]) return;
    const size = Number(item.size || 0);
    // Diện tích = 0 vẫn tính 1 đơn vị để donut không trống
    const weight = size > 0 ? size : 1;
    totals[type] = (totals[type] || 0) + weight;
    sum += weight;
  });
  return { totals, sum };
}

const PIE_COLORS = BUFFER_COLORS;
// 10 loại đất hạ tầng, luôn đủ hàng kể cả khi chưa có công trình; cơ sở chưa sử dụng (12-CSD) không phải hạ tầng nên không tính
const PIE_LABELS = {
  "1-CV": "Công viên", "2-BDX": "Bãi đỗ xe", "3-MN": "Mầm non", "4-TH": "Tiểu học", "5-THCS": "THCS",
  "6-THPT": "THPT", "7-YT": "Y tế", "8-VH": "Văn hóa", "9-TM": "Chợ/TTTM", "11-NT": "Nghĩa trang"
};
const PIE_EMPTY_LABEL = "Chưa có DL";

// ================== MẶT SAU THẺ LẬT: THỐNG KÊ SỐ LƯỢNG 12 LOẠI (4 × 3 Ô) ==================
// Trạm dừng xe buýt (điểm trên vỉa hè, không có khu đất) thống kê ở mặt Hệ thống giao thông (renderBusRow)
const COUNT_CARD_LABELS = {
  "1-CV": "Công viên", "2-BDX": "Bãi đỗ xe", "3-MN": "Mầm non", "4-TH": "Tiểu học",
  "5-THCS": "THCS", "6-THPT": "THPT", "7-YT": "Y tế", "8-VH": "Văn hóa",
  "9-TM": "Chợ, TTTM", "10-PCCC": "Trụ sở PCCC", "11-NT": "Nghĩa trang", "12-CSD": "Chưa sử dụng"
};
// Biểu tượng nét (viewBox 24×24, stroke = màu loại)
const COUNT_CARD_ICONS = {
  "1-CV": '<path d="M12 3l5 7h-3l4 6H6l4-6H7z"/><path d="M12 16v5"/>',
  "2-BDX": '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 17V7h3.2a3 3 0 010 6H10"/>',
  "3-MN": '<rect x="4" y="12" width="7" height="7" rx="1"/><rect x="13" y="12" width="7" height="7" rx="1"/><rect x="8.5" y="4" width="7" height="7" rx="1"/>',
  "4-TH": '<path d="M3 10l9-5 9 5"/><path d="M5 10v9h14v-9"/><path d="M10 19v-5h4v5"/>',
  "5-THCS": '<path d="M4 5h5a3 3 0 013 3v12a2 2 0 00-2-2H4z"/><path d="M20 5h-5a3 3 0 00-3 3v12a2 2 0 012-2h6z"/>',
  "7-YT": '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  "8-VH": '<path d="M3 9l9-5 9 5"/><path d="M5 9v9M9.5 9v9M14.5 9v9M19 9v9"/><path d="M3 20h18"/>',
  "9-TM": '<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2l2.5 11h11l2-8H6.5"/>',
  "12-CSD": '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2.2"/><path d="M12 9v6M9 12h6"/>',
  "6-THPT": '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5"/><path d="M22 9v6"/>',
  "10-PCCC": '<path d="M12 3c1 3 5 5 5 10a5 5 0 01-10 0c0-2.5 1.5-4 2.5-5 .3 1.6 1.2 2.6 2.5 3 0-3-1-5.5 0-8z"/>',
  "11-NT": '<path d="M7 21V10a5 5 0 0110 0v11"/><path d="M4 21h16"/><path d="M12 9v6M9.5 11.5h5"/>'
};
const BUS_ICON = '<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 21v-3M16 21v-3"/><circle cx="8" cy="14.5" r="1"/><circle cx="16" cy="14.5" r="1"/>';

// Hiện trạng: số đã duyệt (cơ sở chưa sử dụng: mọi khu đất, như donut) + số chờ duyệt; quy hoạch: số đã duyệt.
// Dòng THPT cũ còn ở tab 4-TH được layerType đưa về 6-THPT
function countByType(sourceList, planList, keys) {
  const stats = {};
  keys.forEach(k => { stats[k] = { approved: 0, pending: 0, plan: 0 }; });
  (sourceList || []).forEach(it => {
    const s = stats[layerType(it)];
    if (!s) return;
    if (isApproved(it.status)) s.approved++;
    else s.pending++;
  });
  (planList || []).forEach(it => {
    const s = stats[layerType(it)];
    if (s && (isApproved(it.status) || it.type === "12-CSD")) s.plan++;
  });
  return stats;
}

const planDeltaTag = (delta) => (delta === 0 ? '' :
  `<span class="count-plan ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'}${fmtNum(Math.abs(delta))}</span>`);

/** Dòng trạm dừng xe buýt dưới biểu đồ mặt Hệ thống giao thông */
function renderBusRow(sourceList, planList) {
  const el = document.getElementById('roadBusRow');
  if (!el) return;
  const s = countByType(sourceList, planList, ['13-BUS'])['13-BUS'];
  const color = PIE_COLORS['13-BUS'];
  el.dataset.focus = '13-BUS';
  el.classList.toggle('is-focus', state.facilityFocus === '13-BUS');
  el.title = `Trạm dừng xe buýt (QCVN 01:2026 Mục 2.8.3.3: đi bộ tới trạm ≤ 500 m)\nĐã duyệt: ${fmtNum(s.approved)} · Chờ duyệt: ${fmtNum(s.pending)}`
    + `\nQuy hoạch: ${fmtNum(s.plan)} (chênh ${s.plan - s.approved > 0 ? '+' : ''}${fmtNum(s.plan - s.approved)})`
    + `\nBấm để chỉ hiện lớp này, vùng phủ 500 m và ranh 40 phường xã. Bấm lại để khôi phục.`;
  el.style.setProperty('--c', color);
  el.innerHTML = `<span class="road-stat-label"><svg viewBox="0 0 24 24" aria-hidden="true">${BUS_ICON}</svg>Trạm dừng xe buýt</span>`
    + `<span class="road-stat-val"><b>${fmtNum(s.approved)}</b><em>trạm</em>${planDeltaTag(s.plan - s.approved)}`
    + (s.pending ? `<em class="road-bus-pending">+${fmtNum(s.pending)} chờ</em>` : '') + '</span>';
}

function renderInfraCountCards(sourceList, planList) {
  renderBusRow(sourceList, planList);
  const grid = document.getElementById('infraCountGrid');
  if (!grid) return;
  const stats = countByType(sourceList, planList, Object.keys(COUNT_CARD_LABELS));
  grid.innerHTML = Object.keys(COUNT_CARD_LABELS).map(k => {
    const s = stats[k];
    const color = PIE_COLORS[k];
    const isCsd = k === "12-CSD";
    const shown = isCsd ? s.approved + s.pending : s.approved;
    const total = s.approved + s.pending;
    const approvedPct = total > 0 ? (s.approved / total) * 100 : 0;
    const delta = s.plan - shown;
    const tip = `${infraLabels[k] || COUNT_CARD_LABELS[k]}\nĐã duyệt: ${fmtNum(s.approved)} · Chờ duyệt: ${fmtNum(s.pending)}\nQuy hoạch: ${fmtNum(s.plan)} (chênh ${delta > 0 ? '+' : ''}${fmtNum(delta)})\nBấm để chỉ hiện lớp này, vùng phủ và ranh 40 phường xã. Bấm lại để khôi phục.`;
    return `<div class="count-card${state.facilityFocus === k ? ' is-focus' : ''}" data-focus="${k}" style="--c:${color}" title="${escapeHtml(tip)}" role="button" tabindex="0">
      <div class="count-head">
        <span class="count-icon"><svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${COUNT_CARD_ICONS[k]}</svg></span>
        <span class="count-label">${COUNT_CARD_LABELS[k]}</span>
      </div>
      <div class="count-mid"><b class="count-num">${fmtNum(shown)}</b>${planDeltaTag(delta)}</div>
      <div class="count-foot"><span class="count-bar"><i style="width:${approvedPct.toFixed(1)}%"></i></span><span class="count-pct">${fmtPct(approvedPct)}</span></div>
    </div>`;
  }).join('');
}

// Khối lăng trụ 3 mặt: luôn xoay cùng 1 chiều (part1Turn tăng dần), mặt đang xem = part1Turn % 3
const PART1_PAGES = [
  { title: 'CƠ CẤU ĐẤT HẠ TẦNG', short: 'Diện tích', hint: 'cơ cấu đất theo diện tích' },
  { title: 'SỐ LƯỢNG CÔNG TRÌNH', short: 'Số lượng', hint: 'thống kê số lượng công trình' },
  { title: 'HỆ THỐNG GIAO THÔNG', short: 'Giao thông', hint: 'chiều dài các loại đường giao thông' }
];
let part1Turn = 0;

function setPart1Turn(turn) {
  const card = document.getElementById('part1Flip');
  if (!card) return;
  part1Turn = Math.max(0, turn);
  const page = part1Turn % PART1_PAGES.length;
  const next = PART1_PAGES[(page + 1) % PART1_PAGES.length];
  card.dataset.page = String(page);
  card.style.setProperty('--turn', part1Turn);
  const spread = isPart1Spread();
  card.querySelectorAll('.flip-face').forEach(face => face.setAttribute('aria-hidden', String(!spread && Number(face.dataset.page) !== page)));
  const title = document.getElementById('bpPart1Title');
  if (title) title.textContent = PART1_PAGES[page].title;
  const btn = document.getElementById('btnFlipPart1');
  if (btn) {
    btn.innerHTML = `${ico('flip')}${next.short}`;
    btn.title = `Xoay trang: ${next.hint}`;
  }
  document.querySelectorAll('#part1Dots i').forEach(dot => dot.classList.toggle('active', Number(dot.dataset.page) === page));
  if (page === 2) replayRoadDonut();
}

// Hạng màn hình theo bề rộng CSS px (trình duyệt không đo được inch; Windows phóng to 125–150% làm màn Full HD hẹp lại):
// s < 1700 (laptop 14–17"), m < 2300 (21–24" Full HD), l ≥ 2300 (27–32" QHD / 4K)
const SCREEN_TIERS = [[2300, 'l'], [1700, 'm'], [0, 's']];
const TABLE_FIT_MIN_FS = 9;        // px: nhỏ hơn thì để bảng cuộn ngang thay vì co chữ tiếp

// Hệ số bậc màn hình --k trong style.css (chữ, dòng bảng, bề rộng khối cùng nhân hệ số này)
function screenScale() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k')) || 1;
}

const isPart1Spread = () => !!document.getElementById('bpBody')?.classList.contains('bp-spread')
  && !document.body.classList.contains('bottom-max');
// Màn m, l: bảng co chữ cho vừa bề ngang (bảng 40 phường xã) và bảng phường được tách đôi; màn s giữ cỡ chữ, cuộn ngang
const isWideTier = () => document.documentElement.dataset.screen !== 's';

/**
 * Trải panel thành bố cục đối xứng 3 cột (style.css › bp-spread) chỉ ở màn l. Màn m (Full HD) panel chỉ cao ~280 px,
 * mỗi ô cột bên còn ~115 px không đủ cho biểu đồ tròn / thẻ đếm / vận tải công cộng, nên giữ khối xoay như màn s
 */
function updatePart1Spread() {
  const body = document.getElementById('bpBody');
  if (!body) return;
  const tier = SCREEN_TIERS.find(([min]) => window.innerWidth >= min)[1];
  document.documentElement.dataset.screen = tier;
  const spread = tier === 'l';
  if (body.classList.contains('bp-spread') === spread) return;
  body.classList.toggle('bp-spread', spread);
  // Trải ra: tiêu đề cột trái về mặt cơ cấu đất
  setPart1Turn(spread ? part1Turn - (part1Turn % PART1_PAGES.length) : part1Turn);
  const wardData = currentWardData();
  if (wardData) refreshWardQuotaTable(wardData);
}

// ================== TỶ LỆ VẬN TẢI HÀNH KHÁCH CÔNG CỘNG (cột phải khi trải panel) ==================
// SỐ LIỆU MINH HỌA: chưa có khảo sát cơ cấu phương tiện công cộng của TP. Huế; thay bằng số liệu thật khi có nguồn
const TRANSIT_SHARE = [
  { label: 'Xe buýt', pct: 48, color: '#38bdf8', icon: BUS_ICON },
  { label: 'Taxi / xe hợp đồng', pct: 32, color: '#22c55e',
    icon: '<path d="M5 17v-5l2-5h10l2 5v5"/><path d="M3 12h18"/><circle cx="7.5" cy="17" r="1.6"/><circle cx="16.5" cy="17" r="1.6"/><path d="M10 4h4v3h-4z"/>' },
  { label: 'Xích lô', pct: 15, color: '#fb923c',
    icon: '<circle cx="5.5" cy="17" r="3"/><circle cx="18.5" cy="17" r="3"/><path d="M5.5 17 9 9h6l3.5 8"/><path d="M8 9V6h5"/>' },
  { label: 'Xe ôm công nghệ', pct: 5, color: '#a78bfa',
    icon: '<circle cx="5.5" cy="17" r="3"/><circle cx="18.5" cy="17" r="3"/><path d="M5.5 17 10 10h5l3.5 7"/><path d="M14 6h3l1.5 4"/>' }
];

function renderTransitChart() {
  const box = document.getElementById('transitChart');
  if (!box) return;
  const rows = TRANSIT_SHARE.map(m => `<div class="tr-row" style="--c:${m.color}" title="${escapeHtml(m.label)}: ${m.pct}% (số liệu minh họa)">
      <span class="tr-name"><svg viewBox="0 0 24 24" aria-hidden="true">${m.icon}</svg>${escapeHtml(m.label)}</span>
      <span class="tr-track"><i style="--w:${m.pct}%"></i></span>
      <b class="tr-pct">${m.pct}%</b>
    </div>`).join('');
  const ticks = [0, 20, 40, 60, 80, 100].map(v => `<span style="--x:${v}%">${v}%</span>`).join('');
  box.innerHTML = `${rows}<div class="tr-row"><span></span><span class="tr-ticks">${ticks}</span><span></span></div>`;
}

// Màn m, l: co chữ bảng 40 phường/xã đến khi lọt bề ngang khung (panel trải: style.css cho bảng width 100% nên phần dư dàn đều, không hở)
function fitSpreadTable() {
  const box = document.querySelector('#citySummaryView .table-container');
  const table = box && box.querySelector('table.data-table');
  if (!table) return;
  table.style.fontSize = '';
  if (!isWideTier() || !box.clientWidth) return;
  table.style.width = 'max-content';
  let fs = parseFloat(getComputedStyle(table).fontSize);
  // Đệm và viền ô không co theo chữ nên lặp vài lượt
  for (let i = 0; i < 5 && table.offsetWidth > box.clientWidth && fs > TABLE_FIT_MIN_FS; i++) {
    fs = Math.max(TABLE_FIT_MIN_FS, fs * (box.clientWidth / table.offsetWidth) - 0.05);
    table.style.fontSize = `${fs.toFixed(2)}px`;
  }
  table.style.width = '';
}

function watchSpreadTable() {
  const box = document.querySelector('#citySummaryView .table-container');
  if (!box) return;
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; fitSpreadTable(); }); };
  new ResizeObserver(schedule).observe(box);
  const mo = new MutationObserver(schedule);
  ['statTableBody', 'statTableFoot'].forEach(id => {
    const el = document.getElementById(id);
    if (el) mo.observe(el, { childList: true, subtree: true, characterData: true });
  });
}

// Bảng phường tách đôi (wt-split): co chữ cả 2 bảng đến khi không bảng nào phải cuộn ngang;
// phải co dưới WARD_SPLIT_MIN_FS thì về 1 bảng và chỉ thử tách lại khi cột giữa rộng hơn lần thử trước
const WARD_SPLIT_MIN_FS = 10;
let wardSplitMinW = 0;

function currentWardData() {
  const card = document.getElementById('wardSummaryCard');
  return card && !isCityMode() ? state.wardStatsData.find(w => w.Ten_Phuong === card.dataset.ward) : null;
}

function wardSplitWanted() {
  const w = document.getElementById('wardSummaryView')?.clientWidth || 0;
  return isWideTier() && (!w || w > wardSplitMinW);
}

function fitWardSplit() {
  const view = document.getElementById('wardSummaryView');
  const split = view && view.querySelector('.wt-split');
  if (!split || !isWideTier()) {
    const wardData = view && view.clientWidth && (split ? true : wardSplitWanted()) && currentWardData();
    if (wardData) refreshWardQuotaTable(wardData);
    return;
  }
  const tables = [...split.querySelectorAll('table.ward-table')];
  if (tables.length < 2) return;
  tables.forEach(t => { t.style.fontSize = ''; });
  const boxW = tables[0].parentElement.clientWidth;
  if (!boxW) return;
  const overflow = () => Math.max(...tables.map(t => t.offsetWidth - t.parentElement.clientWidth));
  let fs = parseFloat(getComputedStyle(tables[0]).fontSize);
  for (let i = 0; i < 5 && overflow() > 0 && fs > TABLE_FIT_MIN_FS; i++) {
    fs = Math.max(TABLE_FIT_MIN_FS, fs * (boxW / (boxW + overflow())) - 0.05);
    tables.forEach(t => { t.style.fontSize = `${fs.toFixed(2)}px`; });
  }
  if (overflow() > 0 || fs < WARD_SPLIT_MIN_FS) {
    wardSplitMinW = view.clientWidth;
    const wardData = currentWardData();
    if (wardData) refreshWardQuotaTable(wardData);
  }
}

function watchWardSplit() {
  const view = document.getElementById('wardSummaryView');
  if (!view) return;
  let raf = 0;
  const ro = new ResizeObserver(() => schedule());
  // Theo dõi cả 2 bảng: mở danh sách công trình có tên dài làm bảng rộng ra (observe mới gọi lại 1 lần nên chỉ thêm bảng mới)
  const seen = new Set();
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      fitWardSplit();
      seen.forEach(t => { if (!t.isConnected) { ro.unobserve(t); seen.delete(t); } });
      view.querySelectorAll('.wt-split table').forEach(t => {
        if (!seen.has(t)) { seen.add(t); ro.observe(t); }
      });
    });
  };
  ro.observe(view);
  new MutationObserver(schedule).observe(view, { childList: true, subtree: true });
}

function initPart1Flip() {
  renderTransitChart();
  watchSpreadTable();
  watchWardSplit();
  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    if (!resizeRaf) resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; updatePart1Spread(); });
  });
  updatePart1Spread();
  document.getElementById('btnFlipPart1')?.addEventListener('click', () => setPart1Turn(part1Turn + 1));
  document.getElementById('part1Dots')?.addEventListener('click', (e) => {
    const dot = e.target.closest('i[data-page]');
    if (!dot) return;
    const steps = (Number(dot.dataset.page) - (part1Turn % PART1_PAGES.length) + PART1_PAGES.length) % PART1_PAGES.length;
    if (steps) setPart1Turn(part1Turn + steps);
  });
}

// Donut 2 vòng đồng tâm: trong = hiện trạng (sourceList), ngoài = quy hoạch (planList).
// areaLists { ht, qh }: danh sách tính diện tích khi lô vắt ranh chỉ tính phần trong phường đang chọn (số lượng vẫn theo sourceList / planList)
export function updateInfraPieChart(sourceList, planList = [], areaLists = null) {
  renderInfraCountCards(sourceList, planList);
  const legendContainer = document.getElementById('pieLegendDetails');
  const ht = sumAreaByType(areaLists ? areaLists.ht : sourceList);
  const qh = sumAreaByType(areaLists ? areaLists.qh : planList);

  const isEmpty = !ht.sum && !qh.sum;
  const keys = isEmpty ? ['empty'] : Object.keys(PIE_LABELS);
  const htVals = keys.map(k => isEmpty ? 1 : (ht.totals[k] || 0));
  const qhVals = keys.map(k => isEmpty ? 1 : (qh.totals[k] || 0));
  const htPct = keys.map((k, i) => ht.sum > 0 ? (htVals[i] / ht.sum) * 100 : 0);
  const qhPct = keys.map((k, i) => qh.sum > 0 ? (qhVals[i] / qh.sum) * 100 : 0);
  const bgColors = keys.map(k => PIE_COLORS[k] || '#38bdf8');
  const labels = keys.map(k => PIE_LABELS[k] || PIE_EMPTY_LABEL);

  if (legendContainer) {
    legendContainer.innerHTML = `<div class="pie-legend-row pie-legend-head"><span>Ký hiệu</span><span>Hiện trạng</span><span>Quy hoạch</span></div>`
      + keys.map((k, idx) => {
        const delta = qhPct[idx] - htPct[idx];
        const qhCls = delta >= 0.1 ? 'c-green' : (delta <= -0.1 ? 'c-red' : 'c-cyan');
        return `<div class="pie-legend-row">
          <span class="pie-legend-name">
            <i class="pie-dot" style="background:${bgColors[idx]};"></i>
            <span class="pie-legend-text">${escapeHtml(labels[idx])}</span>
          </span>
          <b class="c-cyan">${fmtPct(htPct[idx])}</b>
          <b class="${qhCls}">${fmtPct(qhPct[idx])}</b>
        </div>`;
      }).join('');
  }

  const canvas = document.getElementById('infraPieChart');
  if (!canvas || typeof Chart === 'undefined') return;

  // Cập nhật tại chỗ thay vì hủy/tạo lại chart mỗi lần dữ liệu đổi
  if (infraPieInstance && infraPieInstance.canvas === canvas) {
    infraPieInstance.data.labels = labels;
    const [qhDs, htDs] = infraPieInstance.data.datasets;
    Object.assign(qhDs, { data: qhVals, pct: qhPct, backgroundColor: bgColors });
    Object.assign(htDs, { data: htVals, pct: htPct, backgroundColor: bgColors });
    infraPieInstance.update('none');
    return;
  }

  // Chart.js vẽ dataset đầu tiên ở vòng ngoài cùng
  infraPieInstance = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [
        { label: 'Quy hoạch', data: qhVals, pct: qhPct, backgroundColor: bgColors, borderWidth: 1, borderColor: 'rgba(15, 23, 42, 0.8)' },
        { label: 'Hiện trạng', data: htVals, pct: htPct, backgroundColor: bgColors, borderWidth: 1, borderColor: 'rgba(15, 23, 42, 0.8)' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: 0 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => {
              const pct = context.dataset.pct[context.dataIndex] || 0;
              return ` ${context.dataset.label} – ${context.label}: ${fmtNum(context.raw)} m² (${fmtPct(pct)})`;
            }
          }
        }
      },
      cutout: '62%'
    }
  });
}

// ================== ĐỘ PHỦ: CACHE THEO CHỮ KÝ DỮ LIỆU + TỰ GỌI LẠI ==================
// Mỗi mục cache mang chữ ký (sig) của tập công trình đầu vào; dữ liệu đổi → sig đổi → tự tính lại.
// Kết quả timeout/lỗi không bao giờ được lưu; kết quả 0% bất thường (phường có công trình) được gọi lại có giãn cách.
const COVERAGE_LS_KEY = 'qh_hue_ward_coverage_v5';
const COVERAGE_QH_LS_KEY = 'qh_hue_ward_coverage_qh_v2';
const LEGACY_COVERAGE_KEYS = ['qh_hue_ward_coverage_v4', 'qh_hue_ward_coverage_v3', 'qh_hue_ward_coverage_qh_v1'];
const BACKGROUND_RETRY_DELAYS = [20000, 60000, 180000];
const DETAIL_RETRY_DELAYS = [15000, 45000, 90000];

const COVERAGE_CODES = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "7-YT", "8-VH", "9-TM"];
// Cột bảng 40 phường/xã: 8 mã trên + THPT (độ phủ Ratio_THPT); cột Tổng cộng vẫn bình quân 8 mã
const TABLE_CODES = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "THPT", "7-YT", "8-VH", "9-TM"];
const CHART_COVERAGE_COLOR = '#38bdf8';
const CHART_SCALE_COLOR = '#f59e0b';
const CHART_PLAN_UP_COLOR = '#22c55e';
const CHART_PLAN_DOWN_COLOR = '#ef4444';
const COVERAGE_LEVEL_KEYS = [
  ...COVERAGE_CODES,
  "1-CV_DT", "1-CV_DV", "2-BDX_DT", "2-BDX_DV",
  "7-YT_DT", "7-YT_DV", "8-VH_DT", "8-VH_DV", "9-TM_DT", "9-TM_DV",
  "THPT"
];

try { LEGACY_COVERAGE_KEYS.forEach(k => localStorage.removeItem(k)); } catch (e) {}

function createCoverageStore(lsKey) {
  let mem = null;
  const load = () => {
    if (!mem) {
      try { mem = JSON.parse(localStorage.getItem(lsKey) || '{}') || {}; } catch (e) { mem = {}; }
    }
    return mem;
  };
  return {
    get: (ward, sig) => {
      const hit = load()[ward];
      return hit && sig && hit.sig === sig ? hit : null;
    },
    set: (ward, entry) => {
      load()[ward] = entry;
      const durable = {};
      Object.entries(mem).forEach(([k, v]) => { if (v && !v.tentative && v.sig) durable[k] = v; });
      try { localStorage.setItem(lsKey, JSON.stringify(durable)); } catch (e) {}
    }
  };
}

const htCoverageStore = createCoverageStore(COVERAGE_LS_KEY);
const qhCoverageStore = createCoverageStore(COVERAGE_QH_LS_KEY);

function planCoverageHit(ward) {
  return ward.planCovSig ? qhCoverageStore.get(ward.Ten_Phuong, ward.planCovSig) : null;
}

// Phường không có công trình mới/di dời: độ phủ QH = HT; chưa tính xong thì tạm lấy HT
function planCoverageOf(ward) {
  const hit = planCoverageHit(ward);
  return hit ? Number(hit.Avg_Coverage_Score || 0) : Number(ward.Avg_Coverage_Score || 0);
}

function planScaleOf(ward) {
  return Number(ward.Avg_Scale_QH ?? ward.Avg_Scale_Score ?? 0);
}

function applyCoverageToWardRow(ward, covPayload) {
  const ratios = (covPayload && covPayload.ratios) || {};
  ward.ratios = {};
  COVERAGE_LEVEL_KEYS.forEach(c => {
    const val = Number(ratios[c] ?? covPayload[`Ratio_${c}`] ?? 0);
    ward[`Ratio_${c}`] = val;
    ward.ratios[c] = val;
  });
  ward.Avg_Coverage_Score = Number(covPayload.Avg_Coverage_Score || 0);
  ward._coverageReady = true;
}

function getCoveragePct(wardData, ratioKey) {
  if (!wardData._coverageReady) return null;
  return Number((wardData.ratios && wardData.ratios[ratioKey]) ?? wardData[`Ratio_${ratioKey}`] ?? 0);
}

// Số công trình đã duyệt trong phường (để nhận biết kết quả 0% bất thường)
function approvedInfraCount(ward) {
  let n = 0;
  [ward.urbanResults, ward.unitResults].forEach(group => {
    Object.values(group || {}).forEach(node => { n += (node.subItems || []).length; });
  });
  return n;
}

function mergeLocalCoverageIntoStats() {
  (state.wardStatsData || []).forEach(w => {
    if (w._coverageReady) {
      // Máy chủ đã có kết quả khớp chữ ký → lưu lại cho lần mở sau
      if (w.covSig && !htCoverageStore.get(w.Ten_Phuong, w.covSig)) {
        htCoverageStore.set(w.Ten_Phuong, { sig: w.covSig, ratios: { ...(w.ratios || {}) }, Avg_Coverage_Score: w.Avg_Coverage_Score });
      }
      return;
    }
    const hit = htCoverageStore.get(w.Ten_Phuong, w.covSig);
    if (hit) applyCoverageToWardRow(w, hit);
  });
}

const inflightCoverage = new Map();

function requestWardCoverage(ward, scenario = 'HT') {
  const key = `${scenario}:${ward.Ten_Phuong}`;
  if (inflightCoverage.has(key)) return inflightCoverage.get(key);
  const qs = `action=getWardCoverage${scenario === 'QH' ? '&scenario=QH' : ''}&ward=${encodeURIComponent(ward.Ten_Phuong)}`;
  const p = (async () => {
    try {
      const res = await fetch(geeApi(qs));
      const cov = await res.json().catch(() => null);
      if (!res.ok || !cov || cov.coverageStatus !== 'ok') return { ok: false };
      const approved = cov.itemCounts ? Number(cov.itemCounts.approved || 0) : approvedInfraCount(ward);
      return { ok: true, cov, suspicious: Number(cov.Avg_Coverage_Score || 0) === 0 && approved > 0 };
    } catch (err) {
      return { ok: false };
    } finally {
      inflightCoverage.delete(key);
    }
  })();
  inflightCoverage.set(key, p);
  return p;
}

function applyCoverageResult(ward, scenario, cov, durable) {
  if (scenario === 'QH') {
    qhCoverageStore.set(ward.Ten_Phuong, {
      sig: cov.sig || ward.planCovSig,
      ratios: { ...(cov.ratios || {}) },
      Avg_Coverage_Score: Number(cov.Avg_Coverage_Score || 0),
      tentative: !durable
    });
  } else {
    applyCoverageToWardRow(ward, cov);
    htCoverageStore.set(ward.Ten_Phuong, {
      sig: cov.sig || ward.covSig,
      ratios: { ...ward.ratios },
      Avg_Coverage_Score: ward.Avg_Coverage_Score,
      tentative: !durable
    });
    patchCombinedTableWardRow(ward);
  }
  scheduleCoverageViewsRefresh();
}

let coverageRefreshTimer = null;
function scheduleCoverageViewsRefresh() {
  if (coverageRefreshTimer) return;
  coverageRefreshTimer = setTimeout(() => {
    coverageRefreshTimer = null;
    if (isCityMode()) {
      renderCombinedChart(false);
      renderSummaryNote(CITY_NAME);
    } else {
      renderSummaryNote(state.selectedWard);
    }
  }, 400);
}

const isWardCurrent = (ward) => state.wardStatsData.includes(ward);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Tính lần lượt; phường lỗi/timeout/0% bất thường được thử lại sau 20s → 60s → 180s (không chặn lượt chính)
async function fillCoverage(wards, scenario, attempt = 0) {
  const failed = [];
  for (const ward of wards) {
    if (!isWardCurrent(ward)) continue;
    if (scenario === 'HT' && ward._coverageReady && !ward._coverageTentative) continue;
    if (scenario === 'QH' && (!ward.planCovSig || (planCoverageHit(ward) && !planCoverageHit(ward).tentative))) continue;
    const r = await requestWardCoverage(ward, scenario);
    if (r.ok) applyCoverageResult(ward, scenario, r.cov, !r.suspicious);
    if (scenario === 'HT') ward._coverageTentative = !r.ok || r.suspicious;
    if (!r.ok || r.suspicious) failed.push(ward);
  }
  if (failed.length && attempt < BACKGROUND_RETRY_DELAYS.length) {
    sleep(BACKGROUND_RETRY_DELAYS[attempt]).then(() => fillCoverage(failed, scenario, attempt + 1));
  }
}

let coverageFillList = null;
let countPendingWards = [];
let candidateFillList = null;

/**
 * Gợi ý độ phủ của khu đất CSD / công trình chờ duyệt máy chủ chưa kịp đếm pixel (đổi dữ liệu hàng loạt) đang là ước lượng:
 * đếm nền từng phường (mỗi lượt máy chủ đếm 1 phần, gọi lại đến khi hết), xong thì nạp lại 2 danh sách gợi ý của bảng.
 */
async function fillCandidateCounts(wardNames) {
  const list = state.wardStatsData;
  if (!wardNames.length || !list.length || candidateFillList === list) return;
  candidateFillList = list;
  try {
    let counted = 0;
    for (const name of wardNames) {
      for (let round = 0; round < 5 && state.wardStatsData === list; round++) {
        const r = await fetch(geeApi(`action=countWardCandidates&ward=${encodeURIComponent(name)}`))
          .then(res => (res.ok ? res.json() : null)).catch(() => null);
        if (!r) break;
        counted += r.counted || 0;
        if (!r.counted || !r.remaining) break;
      }
    }
    if (!counted || state.wardStatsData !== list) return;
    const fresh = await fetch(geeApi('action=getWardStats&fresh=1'))
      .then(res => (res.ok ? res.json() : null)).catch(() => null);
    if (!fresh || state.wardStatsData !== list) return;
    const byName = new Map((fresh.data || []).map(w => [w.Ten_Phuong, w]));
    list.forEach(w => {
      const f = byName.get(w.Ten_Phuong);
      if (f) Object.assign(w, { csdItems: f.csdItems, pendingItems: f.pendingItems });
    });
    countPendingWards = fresh.countPending || [];
    const cur = currentWardData();
    if (cur) refreshWardQuotaTable(cur);
  } finally {
    if (candidateFillList === list) candidateFillList = null;
  }
}

/**
 * Tính độ phủ nền: dân số lớn → nhỏ; hiện trạng trước, quy hoạch sau (chỉ phường có công trình mới/di dời).
 */
export async function startBackgroundCoverageFill() {
  const list = state.wardStatsData;
  if (!list.length || coverageFillList === list) return;
  coverageFillList = list;
  fillCandidateCounts(countPendingWards).catch(err => console.warn('Đếm nền gợi ý độ phủ lỗi:', err));
  try {
    mergeLocalCoverageIntoStats();
    rebuildCombinedTableBody();
    if (isCityMode()) {
      renderCombinedChart();
      renderSummaryNote(CITY_NAME);
    }
    const queue = [...(state.wardStatsData || [])]
      .sort((a, b) => Number(b.Dan_So_Vector || 0) - Number(a.Dan_So_Vector || 0));
    await fillCoverage(queue.filter(w => !w._coverageReady), 'HT');
    await fillCoverage(queue.filter(w => w.planCovSig && !planCoverageHit(w)), 'QH');
  } finally {
    if (coverageFillList === list) coverageFillList = null;
  }
}

// ================== BẢNG 40 PHƯỜNG XÃ ==================
const PENDING_CELL = `<span class="cov-pending" title="Đang tính độ phủ">${ico('clock')}</span>`;
const AREA_FORMAT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const fmtArea = (km2) => AREA_FORMAT.format(Number(km2) || 0);
const NOT_REQUIRED_TITLE = 'QCVN 01:2026/BXD không quy định chỉ tiêu này cho loại địa bàn của phường/xã';
const NOT_REQUIRED_DASH = `<span class="c-muted" title="${NOT_REQUIRED_TITLE}">–</span>`;

// ================== CHIỀU DÀI 4 LOẠI ĐƯỜNG (bảng 40 phường + bảng chi tiết phường) ==================
let roadTypesByWard = null;   // { phường: { trunk, named, kiet, bike } | null }; null = chưa đọc xong chỉ mục mạng lưới đường
let roadTypesPromise = null;
const ROAD_PENDING = `<span class="cov-pending" title="Đang đọc mạng lưới đường">${ico('clock')}</span>`;
const ROAD_MISSING_TITLE = 'Phường/xã chưa có mạng lưới đường — Admin bấm "Tải mạng lưới đường toàn thành phố"';
const ROAD_NOT_SPLIT_TITLE = 'Mạng lưới đường lưu bản cũ chưa tách trục chính / khu vực — Admin bấm "Tải mạng lưới đường toàn thành phố" để tính lại';
const roadDash = (title) => `<span class="c-muted" title="${title}">–</span>`;

const ROAD_EST_TITLE = 'Ước tính: phường/xã có đường trục chính 2 chiều, tạm chia tổng trục chính + khu vực theo tỉ lệ chiều dài 2 nhóm trong mạng lưới đã lưu (trục chính hơi cao) — Admin bấm "Tải mạng lưới đường toàn thành phố" để tải lại phường/xã này lấy số chính xác';
const isEstKey = (types, key) => types.est && (key === 'trunk' || key === 'named');

function roadKmHtml(types, key) {
  if (!types) return roadDash(ROAD_MISSING_TITLE);
  if (types[key] == null) return roadDash(ROAD_NOT_SPLIT_TITLE);
  return isEstKey(types, key) ? `<span title="${ROAD_EST_TITLE}">≈${fmtKm(types[key])}</span>` : fmtKm(types[key]);
}

const roadCellsHtml = (wardName) => ROAD_TYPES.map(t => `<td class="st-num st-road" data-road="${t.key}">`
  + `${roadTypesByWard ? roadKmHtml(roadTypesByWard[wardName], t.key) : ROAD_PENDING}</td>`).join('');

function ensureRoadTypes(force = false) {
  if (!roadTypesPromise || force) {
    const promise = loadRoadTypeLengths()
      .then(m => {
        if (roadTypesPromise === promise) { roadTypesByWard = m; refreshRoadViews(); }
        return m;
      })
      .catch(() => { if (roadTypesPromise === promise) roadTypesPromise = null; return null; });
    roadTypesPromise = promise;
  }
  return roadTypesPromise;
}

function refreshRoadViews() {
  document.querySelectorAll('#statTableBody tr[data-ward-row]').forEach(tr => {
    const types = roadTypesByWard && roadTypesByWard[tr.getAttribute('data-ward-row')];
    tr.querySelectorAll('.st-road').forEach(td => { td.innerHTML = roadTypesByWard ? roadKmHtml(types, td.dataset.road) : ROAD_PENDING; });
  });
  renderCityTableFoot();
  renderRoadChart();
  const card = document.getElementById('wardSummaryCard');
  const body = document.getElementById('wardRoadBody');
  const wardData = card && state.wardStatsData.find(w => w.Ten_Phuong === card.dataset.ward);
  if (body && wardData) body.innerHTML = wardRoadRowsHtml(wardData);
}

/** Tổng chiều dài từng loại các phường đã có mạng lưới; trục chính / khu vực bỏ qua phường chưa tách (đếm vào notSplit) */
function sumRoadTypes(names) {
  const sum = { trunk: 0, named: 0, kiet: 0, bike: 0 };
  let have = 0, notSplit = 0, est = 0;
  names.forEach(name => {
    const t = roadTypesByWard && roadTypesByWard[name];
    if (!t) return;
    have++;
    if (t.trunk == null) notSplit++;
    if (t.est) est++;
    ROAD_TYPES.forEach(({ key }) => { sum[key] += t[key] || 0; });
  });
  return { sum, have, notSplit, est };
}

// Dòng tổng toàn thành phố cuối bảng 40 phường: dân số, diện tích, mật độ và chiều dài 4 loại đường
function renderCityTableFoot() {
  const foot = document.getElementById('statTableFoot');
  if (!foot) return;
  const list = state.wardStatsData;
  if (!list.length) { foot.innerHTML = ''; return; }
  const pop = list.reduce((s, w) => s + (Number(w.Dan_So_Vector) || 0), 0);
  const area = list.reduce((s, w) => s + (Number(w.Dien_Tich_Km2) || 0), 0);
  let roadCells;
  if (!roadTypesByWard) {
    roadCells = ROAD_TYPES.map(() => `<td class="st-num st-road">${ROAD_PENDING}</td>`).join('');
  } else {
    const { sum, have, notSplit, est } = sumRoadTypes(list.map(w => w.Ten_Phuong));
    const scope = `Tổng ${have}/${list.length} phường/xã có mạng lưới đường`;
    roadCells = ROAD_TYPES.map(({ key }) => {
      const splitKey = key === 'trunk' || key === 'named';
      const partial = splitKey && notSplit;
      if (!have || (partial && notSplit === have)) return `<td class="st-num st-road">${roadDash(have ? ROAD_NOT_SPLIT_TITLE : ROAD_MISSING_TITLE)}</td>`;
      let title = partial ? `${scope}, ${notSplit} phường/xã chưa tách trục chính / khu vực (không cộng)` : scope;
      if (splitKey && est) title += `\n${est} phường/xã ước tính — ${ROAD_EST_TITLE}`;
      return `<td class="st-num st-road" title="${title}">${splitKey && est ? '≈' : ''}${fmtKm(sum[key])}${partial ? '*' : ''}</td>`;
    }).join('');
  }
  foot.innerHTML = `<tr class="st-total">
    <td></td>
    <td class="st-name">Toàn thành phố</td>
    <td class="st-num st-pop">${fmtNum(pop)}</td>
    <td class="st-num st-pop-qh" title="Tổng dân số QH các phường/xã (dân số QH toàn TP: ${fmtNum(CITY_POP_QH)} người)">${fmtNum(totalPlanPop())}</td>
    <td class="st-num">${fmtArea(area)}</td>
    <td class="st-num st-dens">${area > 0 ? fmtNum(Math.round(pop / area)) : '-'}</td>
    <td colspan="${TABLE_CODES.length * 2}" class="c-muted st-total-note">Độ phủ / quy mô toàn thành phố: xem thanh tiêu đề</td>
    <td colspan="2"></td>
    ${roadCells}
    <td class="st-num st-bus">${fmtNum(list.reduce((s, w) => s + busCountOf(w), 0))}</td>
  </tr>`;
}

// ================== MẶT 3 PANEL TRÁI: HỆ THỐNG GIAO THÔNG (toàn TP hoặc phường đang xem) ==================
// Màu khớp lớp mạng lưới đường (roadNetworkLayer.js); mixed = phường lưu bản cũ chưa tách trục chính / khu vực
// Biểu tượng nét (viewBox 24×24): xe tải = trục chính, ô tô con = khu vực, người đi bộ = nội bộ / kiệt, xe đạp
const ROAD_ICONS = {
  trunk: '<circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M5 17H3V6a1 1 0 011-1h9v12M9 17h6M19 17h2v-6h-8M13 6h5l3 5"/>',
  named: '<circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M5 17H3v-6l2-5h9l4 5h1a2 2 0 012 2v4h-2M15 17H9M3 11h15M12 11V6"/>',
  mixed: '<path d="M4 19L8 5M16 5l4 14M12 8V6M12 13v-2M12 18v-2"/>',
  kiet: '<circle cx="13" cy="4" r="1.2"/><path d="M7 21l3-4M16 21l-2-4-3-3 1-6M6 12l2-3 4-1 3 3 3 1"/>',
  bike: '<circle cx="5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/><circle cx="17" cy="5" r="1"/><path d="M12 19v-4l-3-3 5-4 2 3h3"/>'
};
const ROAD_CHART_TYPES = [
  { key: 'trunk', label: 'Trục chính', color: '#fb923c', title: ROAD_TYPES[0].title },
  { key: 'named', label: 'Khu vực', color: '#60a5fa', title: ROAD_TYPES[1].title },
  { key: 'mixed', label: 'TC + KV', color: '#fde047', title: ROAD_NOT_SPLIT_TITLE },
  { key: 'kiet', label: 'Nội bộ, kiệt', color: '#cbd5e1', title: ROAD_TYPES[2].title },
  { key: 'bike', label: 'Xe đạp', color: '#4ade80', title: ROAD_TYPES[3].title }
];
let roadDonutInstance = null;

function roadChartData() {
  const city = isCityMode();
  const wards = state.wardStatsData;
  const names = city ? (wards.length ? wards.map(w => w.Ten_Phuong) : Object.keys(roadTypesByWard)) : [state.selectedWard];
  const v = { trunk: 0, named: 0, mixed: 0, kiet: 0, bike: 0 };
  let have = 0, est = 0, areaKm2 = 0, natural = 0, pending = false;
  names.forEach(name => {
    const t = roadTypesByWard[name];
    if (!t) return;
    have++;
    if (t.est) est++;
    if (t.trunk == null) v.mixed += t.main;
    else { v.trunk += t.trunk; v.named += t.named; }
    v.kiet += t.kiet;
    v.bike += t.bike;
    const w = wards.find(x => x.Ten_Phuong === name);
    const a = densityArea(name, Number(w && w.Dien_Tich_Km2) || 0);
    if (!a) { pending = true; return; }
    if (!a.built) natural++;
    areaKm2 += a.km2;
  });
  // Mẫu số mật độ: đất xây dựng đô thị; areaLabel mô tả nguồn (tạm diện tích tự nhiên nếu chưa có)
  const areaLabel = pending ? '' : densityAreaLabel(natural < have, natural < have ? natural : 0);
  return { city, v, have, total: names.length, est, areaKm2: pending ? 0 : areaKm2, pending, areaLabel };
}

// Donut cơ cấu chiều dài đường 1+2+3 (không gồm xe đạp, như mật độ đường); types = null → vòng xám chờ dữ liệu
function updateRoadDonut(types, v) {
  const canvas = document.getElementById('roadDonutChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const parts = types ? types.filter(t => t.key !== 'bike') : [];
  const labels = parts.map(t => t.label);
  const data = types ? parts.map(t => v[t.key]) : [1];
  const colors = types ? parts.map(t => t.color) : ['rgba(255, 255, 255, 0.08)'];
  if (roadDonutInstance && roadDonutInstance.canvas === canvas) {
    roadDonutInstance.data.labels = labels;
    Object.assign(roadDonutInstance.data.datasets[0], { data, backgroundColor: colors });
    roadDonutInstance.update();
    return;
  }
  roadDonutInstance = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 1, borderColor: 'rgba(15, 23, 42, 0.8)', hoverOffset: 4 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: 3 },
      cutout: '68%',
      animation: { animateRotate: true, duration: 900 },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: !!types,
          callbacks: {
            label: (ctx) => {
              const sum = ctx.dataset.data.reduce((s, x) => s + x, 0);
              return ` ${ctx.label}: ${fmtKm(ctx.raw)} km (${fmtPct(sum > 0 ? (ctx.raw / sum) * 100 : 0)})`;
            }
          }
        }
      }
    }
  });
}

// Quay lại vòng donut mỗi lần xoay tới trang giao thông
function replayRoadDonut() {
  if (!roadDonutInstance) return;
  roadDonutInstance.reset();
  roadDonutInstance.update();
}

function renderRoadChart() {
  const rowsEl = document.getElementById('roadChartRows');
  const center = document.getElementById('roadDonutCenter');
  const densEl = document.getElementById('roadDensity');
  if (!rowsEl || !center) return;
  const setDensity = (value, tip = '') => {
    if (!densEl) return;
    densEl.title = tip;
    densEl.innerHTML = `<span class="road-stat-label">Mật độ đến đường khu vực:</span><span class="road-stat-val">${value}</span>`;
  };
  const empty = (html) => {
    rowsEl.innerHTML = `<div class="road-chart-msg">${html}</div>`;
    center.innerHTML = '';
    setDensity('<b>–</b><em>km/km²</em>');
    updateRoadDonut(null);
  };
  if (!roadTypesByWard) return empty(`${ico('clock')}Đang đọc mạng lưới đường...`);
  const d = roadChartData();
  if (!d.have) return empty(`<span class="c-muted">${ROAD_MISSING_TITLE}.</span>`);

  const { v } = d;
  const kvKm = v.trunk + v.named + v.mixed;
  const totalKm = kvKm + v.kiet;
  const types = ROAD_CHART_TYPES.filter(t => t.key !== 'mixed' || v.mixed > 0);
  const maxKm = Math.max(...types.map(t => v[t.key]), 0.001);
  const scope = d.city ? `${d.have}/${d.total} phường/xã có mạng lưới đường` : escapeHtml(state.selectedWard);
  const notSplit = v.mixed > 0 && v.trunk + v.named === 0;
  const rows = types.map(t => {
    const km = v[t.key];
    const splitKey = t.key === 'trunk' || t.key === 'named';
    const est = d.est > 0 && splitKey;
    const unsplit = notSplit && splitKey;
    const none = t.key === 'bike' && !km;
    const pct = totalKm > 0 ? (km / totalKm) * 100 : 0;
    const tip = unsplit ? `${t.title}\n${ROAD_NOT_SPLIT_TITLE}`
      : `${t.title}\n${fmtKm(km)} km${t.key === 'bike' ? '' : ` = ${fmtPct(pct)} tổng chiều dài đường (1+2+3)`} — ${scope}`
        + (est ? `\n${d.city ? `${d.est} phường/xã ước tính — ` : ''}${ROAD_EST_TITLE}` : '')
        + (none ? '\nChưa có tuyến xe đạp (OpenStreetMap chưa có — Admin vẽ bổ sung ở tab Đề xuất › Tuyến đường)' : '');
    return `<div class="rc-row${none || unsplit ? ' rc-none' : ''}" style="--c:${t.color}; --w:${((km / maxKm) * 100).toFixed(1)}%" title="${escapeHtml(tip)}">
      <div class="rc-line">
        <span class="rc-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${ROAD_ICONS[t.key]}</svg></span>
        <span class="rc-name">${t.label}</span>
        <b class="rc-km">${unsplit ? '–' : `${est ? '≈' : ''}${fmtKm(km)}<em> km</em>`}</b>
        <span class="rc-pct">${unsplit ? 'chưa tách' : none ? 'chưa có' : (t.key === 'bike' ? '' : fmtPct(pct))}</span>
      </div>
      <div class="rc-road"><i></i></div>
    </div>`;
  }).join('');
  const dens = (km) => (d.areaKm2 > 0 ? (km / d.areaKm2).toFixed(2).replace('.', ',') : '–');
  const densTip = d.pending ? 'Đang tính diện tích đất xây dựng đô thị từ ảnh vệ tinh...'
    : `Mật độ đến đường khu vực = (đường trục chính + đường khu vực) ${fmtKm(kvKm)} km / ${fmtArea(d.areaKm2)} km²`
      + `${d.city ? ` của ${d.have} phường/xã có mạng lưới đường` : ''} — ${scope}`
      + `\nMật độ đường (gồm nội bộ, kiệt): ${fmtKm(totalKm)} km / ${fmtArea(d.areaKm2)} km² = ${dens(totalKm)} km/km²`
      + `\nMẫu số = ${d.areaLabel}`;
  rowsEl.innerHTML = rows;
  setDensity(`<b>${d.pending ? ico('clock') : dens(kvKm)}</b><em>km/km²</em>${d.city && d.have < d.total ? `<em class="road-dens-scope">${d.have}/${d.total} P/X</em>` : ''}`, densTip);
  center.innerHTML = `<b>${fmtKm(totalKm)}</b><small>km đường</small>`;
  updateRoadDonut(types, v);
}

// Nhóm E bảng chi tiết phường: chiều dài, mật độ từng loại đường; tổng 1+2+3 = mật độ đường (không gồm đường xe đạp)
function wardRoadRowsHtml(wardData) {
  const name = wardData.Ten_Phuong;
  const area = densityArea(name, Number(wardData.Dien_Tich_Km2) || 0);
  const areaKm2 = area ? area.km2 : 0;
  const dens = (km) => (areaKm2 > 0 ? `${(km / areaKm2).toFixed(2).replace('.', ',')} km/km²` : ico('clock'));
  if (!roadTypesByWard) return `<tr class="wt-empty"><td>-</td><td colspan="7">${ico('clock')}Đang đọc mạng lưới đường...</td></tr>`;
  const t = roadTypesByWard[name];
  if (!t) return `<tr class="wt-empty"><td>-</td><td colspan="7">${ROAD_MISSING_TITLE}.</td></tr>`;
  const rows = ROAD_TYPES.map((rt, i) => {
    const v = t[rt.key];
    let note;
    if (v == null) note = `<span class="c-muted">${ROAD_NOT_SPLIT_TITLE}</span>`;
    else if (rt.key === 'bike' && !v) note = '<span class="c-muted">Chưa có tuyến xe đạp (OpenStreetMap chưa có — Admin vẽ bổ sung ở tab Đề xuất › Tuyến đường)</span>';
    else note = `Mật độ ${dens(v)}${isEstKey(t, rt.key) ? ` <span class="c-muted" title="${ROAD_EST_TITLE}">(ước tính từ mạng lưới đã lưu)</span>` : ''}`;
    return `<tr class="wt-comp">
      <td>${i + 1}</td>
      <td title="${rt.title}">${rt.label}</td>
      <td>${v == null ? roadDash(ROAD_NOT_SPLIT_TITLE) : `${isEstKey(t, rt.key) ? '≈' : ''}${fmtKm(v)} km`}</td>
      <td colspan="5" class="wt-note wt-road-note">${note}</td>
    </tr>`;
  });
  const totalKm = t.main + t.kiet;
  rows.push(`<tr class="wt-main">
    <td></td>
    <td title="Không gồm đường xe đạp">Tổng đường giao thông (1+2+3)</td>
    <td>${fmtKm(totalKm)} km</td>
    <td colspan="5" class="wt-note wt-road-note"${area ? ` title="Mẫu số mật độ = ${escapeHtml(densityAreaLabel(area.built))}"` : ''}>Mật độ đường ${dens(totalKm)}`
    + `${area ? ` <span class="wt-light">/ ${area.built ? 'đất xây dựng' : 'diện tích tự nhiên'} ${fmtArea(areaKm2)} km²</span>` : ''}</td>
  </tr>`);
  return rows.join('');
}

// Quy mô THPT (cấp đô thị, ngoài 8 mã tính Scale_ ở api/gee.js): diện tích ÷ (chỉ tiêu × dân số QH), như bảng chỉ tiêu phường
function thptScaleOf(w) {
  const node = w.urbanResults && w.urbanResults.THPT;
  const req = node && hasQuota(node.quota) ? Number(node.quota) * planPopOf(w) : 0;
  return req > 0 ? Math.min(100, (Number(node.currentArea || 0) / req) * 100) : null;
}

const busCountOf = (w) => ((w.network && w.network.bus) || []).length;

function wardRowHtml(w, idx) {
  const ready = !!w._coverageReady;
  const cells = TABLE_CODES.map(c => {
    const cov = ready ? fmtPct(w[`Ratio_${c}`]) : PENDING_CELL;
    const scaleVal = c === 'THPT' ? thptScaleOf(w) : w[`Scale_${c}`];
    const scale = scaleVal == null ? NOT_REQUIRED_DASH : fmtPct(scaleVal);
    return `<td class="cov-cell" data-code="${c}">${cov}</td><td class="st-scale">${scale}</td>`;
  }).join('');
  const name = escapeHtml(w.Ten_Phuong);
  return `<tr data-ward-row="${name}">
    <td>${idx + 1}</td>
    <td class="st-name">
      <button type="button" class="ward-link link-btn" data-ward="${name}">${name}</button>
    </td>
    <td class="st-num st-pop">${fmtNum(w.Dan_So_Vector)}</td>
    <td class="st-num st-pop-qh">${fmtNum(planPopOf(w))}</td>
    <td class="st-num">${w.Dien_Tich_Km2 ? fmtArea(w.Dien_Tich_Km2) : '-'}</td>
    <td class="st-num st-dens">${w.Mat_Do_Dan_So ? fmtNum(w.Mat_Do_Dan_So) : '-'}</td>
    ${cells}
    <td class="cov-avg">${ready ? fmtPct(w.Avg_Coverage_Score) : PENDING_CELL}</td>
    <td class="st-scale st-scale-avg">${fmtPct(w.Avg_Scale_Score)}</td>
    ${roadCellsHtml(w.Ten_Phuong)}
    <td class="st-num st-bus">${fmtNum(busCountOf(w))}</td>
  </tr>`;
}

function rebuildCombinedTableBody() {
  const tbody = document.getElementById('statTableBody');
  if (!tbody) return;
  tbody.innerHTML = state.wardStatsData.map(wardRowHtml).join('');
  renderCityTableFoot();
  ensureRoadTypes();
}

function patchCombinedTableWardRow(ward) {
  const tbody = document.getElementById('statTableBody');
  if (!tbody) return;
  const tr = Array.from(tbody.querySelectorAll('tr[data-ward-row]'))
    .find(el => el.getAttribute('data-ward-row') === ward.Ten_Phuong);
  if (!tr) {
    rebuildCombinedTableBody();
    return;
  }
  TABLE_CODES.forEach(c => {
    const cell = tr.querySelector(`.cov-cell[data-code="${c}"]`);
    if (cell) cell.textContent = fmtPct(ward[`Ratio_${c}`]);
  });
  const avgCell = tr.querySelector('.cov-avg');
  if (avgCell) avgCell.textContent = fmtPct(ward.Avg_Coverage_Score);
}

// ================== PANEL THỐNG KÊ DƯỚI ==================
const CITY_NAME = "Thành phố Huế";
// Dân số quy hoạch toàn TP: mẫu số mật độ QH toàn TP và trần tổng dân số QH các phường xã
const CITY_POP_QH = 1850000;
let wardStatsPromise = null;
let popCapExceeded = false;

const planPopOf = (w) => Number(w.projectedPopulation) || Math.round((Number(w.Dan_So_Vector) || 0) * 1.2);
const totalPlanPop = () => state.wardStatsData.reduce((sum, w) => sum + planPopOf(w), 0);
let bottomRenderSeq = 0;

function isCityMode() {
  return !state.selectedWard || state.selectedWard === CITY_NAME;
}

export function ensureWardStats() {
  if (state.wardStatsData.length > 0) return Promise.resolve(state.wardStatsData);
  if (!wardStatsPromise) {
    const promise = fetch(geeApi('action=getWardStats'))
      .then(r => {
        if (!r.ok) {
          throw new Error(r.status === 504
            ? 'Máy chủ GEE quá tải / hết thời gian (504). Thử lại sau ít phút.'
            : `Lỗi máy chủ (${r.status})`);
        }
        return r.json();
      })
      .then(resData => {
        // Bỏ qua kết quả của lượt tải cũ nếu đã có yêu cầu nạp lại
        if (wardStatsPromise !== promise) return state.wardStatsData;
        state.wardStatsData = resData.data || [];
        state.cityNetwork = resData.network || null;
        countPendingWards = resData.countPending || [];
        mergeLocalCoverageIntoStats();
        return state.wardStatsData;
      })
      .catch(err => {
        if (wardStatsPromise === promise) wardStatsPromise = null;
        throw err;
      });
    wardStatsPromise = promise;
  }
  return wardStatsPromise;
}

// Nạp lại thống kê sau khi dữ liệu đổi (phê duyệt / thêm điểm)
export function reloadWardStats() {
  state.wardStatsData = [];
  wardStatsPromise = null;
  renderBottomPanel();
  ensureWardStats().then(startBackgroundCoverageFill).catch(err => console.warn('Nạp lại thống kê phường lỗi:', err));
}

export function setBottomPanelMaximized(maximized) {
  document.body.classList.toggle('bottom-max', maximized);
  if (maximized) setPart1Turn(0);
  const btn = document.getElementById('btnToggleBottomMax');
  if (btn) {
    btn.innerHTML = ico(maximized ? 'minimize' : 'maximize');
    btn.title = maximized ? 'Thu về 1/5 màn hình' : 'Phóng to toàn màn hình';
    btn.setAttribute('aria-label', btn.title);
  }
  setBottomPanelHeader(isCityMode() ? CITY_NAME : state.selectedWard);
}

export function toggleBottomPanelMaximized() {
  setBottomPanelMaximized(!document.body.classList.contains('bottom-max'));
}

// Thu gọn cả panel dưới (cơ cấu đất + bảng tổng hợp): bản đồ chiếm hết chiều cao, nút góc phải dưới mở lại
export function setBottomPanelCollapsed(collapsed) {
  if (collapsed && document.body.classList.contains('bottom-max')) setBottomPanelMaximized(false);
  document.body.classList.toggle('bottom-collapsed', collapsed);
}

let cityTableOn = false;

export function toggleStatTable() {
  if (!isCityMode()) return;
  cityTableOn = !cityTableOn;
  setBottomPanelHeader(CITY_NAME);
}

// Chú giải biểu đồ 40 phường: 1 dòng ở góc trên phải khung biểu đồ (chart chừa padding top)
function renderChartLegend() {
  const el = document.getElementById('bpChartLegend');
  if (!el || el.childElementCount) return;
  const sw = (color, label) => `<span class="bp-legend-item"><i class="bp-swatch" style="background:${color};"></i>${label}</span>`;
  el.innerHTML = sw(CHART_COVERAGE_COLOR, 'Độ phủ') + sw(CHART_SCALE_COLOR, 'Quy mô')
    + sw(CHART_PLAN_UP_COLOR, 'QH tăng') + sw(CHART_PLAN_DOWN_COLOR, 'QH giảm');
}

// ================== CHỈ TIÊU TRÊN THANH TIÊU ĐỀ ==================
// Mỗi cột 1 chỉ tiêu: ô trên hiện trạng, ô dưới quy hoạch. Ô mật độ đường HT giữ id cũ để wardRoads.js điền vào.
function buildHeadStats(key, city) {
  const el = document.getElementById('bpHeadStats');
  if (!el) return;
  const col = (ht, qh) => `<div class="hs-col"><div class="hs-cell" id="${ht}"></div><div class="hs-cell hs-qh" id="${qh}"></div></div>`;
  el.dataset.key = key;
  el.classList.toggle('hs-units', !city);
  el.innerHTML = col('hsPopHT', 'hsPopQH') + col('hsArea', 'hsPopCap') + col('hsDensHT', 'hsDensQH')
    + col(city ? 'cityRoadDensity' : 'wardRoadLen', 'hsRoadQH') + col('hsCovHT', 'hsCovQH')
    + (city ? col('hsUrbanHT', 'hsUrbanQH') : '<div class="hs-status" id="wardCoverageStatus"></div>');
  setHeadCell('hsRoadQH', wardStatHtml('Mật độ đến đường KV QH', '–', 'km/km²',
    'Chưa có dữ liệu mạng lưới đường quy hoạch (mạng lưới hiện có: OpenStreetMap + tuyến Admin vẽ bổ sung là đường hiện trạng)'));
}

function clearHeadStats() {
  const el = document.getElementById('bpHeadStats');
  if (el) { el.dataset.key = ''; el.innerHTML = ''; }
}

const headStatsKey = () => document.getElementById('bpHeadStats')?.dataset.key || '';

function setHeadCell(id, html) {
  const cell = document.getElementById(id);
  if (cell) cell.innerHTML = html;
}

// Dân số HT / độ phủ TB / quy mô TB (HT và QH) của toàn TP hoặc phường đang xem
function renderSummaryNote(wardName) {
  const city = !wardName || wardName === CITY_NAME;
  // Kết quả độ phủ đến muộn của phường vừa rời đi không ghi vào tiêu đề phường đang xem
  if (headStatsKey() !== (city ? CITY_NAME : wardName)) return;
  const list = city ? state.wardStatsData : state.wardStatsData.filter(w => w.Ten_Phuong === wardName);
  if (!list.length) return;
  // Toàn thành phố: bình quân gia quyền theo dân số; độ phủ chỉ lấy các phường đã tính xong
  let pop = 0, covPop = 0, covSum = 0, scaleSum = 0, covQHSum = 0, scaleQHSum = 0, readyCount = 0;
  list.forEach(w => {
    const p = Number(w.Dan_So_Vector || 0);
    pop += p;
    scaleSum += Number(w.Avg_Scale_Score || 0) * p;
    scaleQHSum += planScaleOf(w) * p;
    if (w._coverageReady) {
      readyCount++;
      covPop += p;
      covSum += Number(w.Avg_Coverage_Score || 0) * p;
      covQHSum += planCoverageOf(w) * p;
    }
  });
  const cov = covPop ? covSum / covPop : 0;
  const covQH = covPop ? covQHSum / covPop : 0;
  const scale = pop ? scaleSum / pop : 0;
  const scaleQH = pop ? scaleQHSum / pop : 0;
  // Giá trị QH: xanh khi tăng, đỏ khi giảm so với HT
  const qhHtml = (ht, qh) => {
    const d = qh - ht;
    return `<span class="${d >= 0.05 ? 'c-green' : (d <= -0.05 ? 'c-red' : '')}">${fmtPct(qh)}</span>`;
  };
  const partial = readyCount < list.length ? ` <em>· ${readyCount}/${list.length}</em>` : '';
  const covTitle = (city
    ? `Độ phủ: bình quân theo dân số các phường/xã đã tính xong (${readyCount}/${list.length})`
    : 'Độ phủ trung bình 8 nhóm hạ tầng')
    + '\nQuy mô: mức đáp ứng quy mô trung bình theo QCVN 01:2026/BXD';
  setHeadCell('hsPopHT', wardStatHtml('Dân số HT', fmtNum(pop), 'người',
    city ? `Dân số hiện trạng, tổng ${list.length} phường/xã` : 'Dân số hiện trạng'));
  if (city) {
    setHeadCell('hsPopQH', wardStatHtml('Dân số QH', fmtNum(CITY_POP_QH), 'người',
      'Dân số quy hoạch toàn TP: cơ sở tính mật độ QH và trần tổng dân số QH các phường/xã'));
  }
  setHeadCell('hsCovHT', wardStatHtml('Độ phủ/quy mô TB',
    `${readyCount ? fmtPct(cov) : ico('clock')}/${fmtPct(scale)}${partial}`, '', `${covTitle}\n(hiện trạng)`));
  setHeadCell('hsCovQH', wardStatHtml('Độ phủ/quy mô TB QH',
    `${readyCount ? qhHtml(cov, covQH) : ico('clock')}/${qhHtml(scale, scaleQH)}${partial}`, '', `${covTitle}\n(quy hoạch; xanh = tăng, đỏ = giảm so với hiện trạng)`));
}

function setBottomPanelHeader(wardName) {
  const city = !wardName || wardName === CITY_NAME;
  // Toàn màn hình: chart và bảng hiện cùng lúc nên không cần nút chuyển
  const maximized = document.body.classList.contains('bottom-max');
  renderSummaryNote(wardName);

  const btn = document.getElementById('btnToggleStatTable');
  if (btn) {
    btn.style.display = city && !maximized ? '' : 'none';
    btn.classList.toggle('active', cityTableOn);
    btn.setAttribute('aria-pressed', String(cityTableOn));
    btn.title = cityTableOn ? 'Quay lại biểu đồ độ phủ & quy mô' : 'Xem bảng thông tin 40 phường xã';
  }

  const chartView = document.getElementById('cityChartView');
  const cityView = document.getElementById('citySummaryView');
  const wardView = document.getElementById('wardSummaryView');
  if (chartView) chartView.style.display = city && (maximized || !cityTableOn) ? 'flex' : 'none';
  if (cityView) cityView.style.display = city && (maximized || cityTableOn) ? 'flex' : 'none';
  if (wardView) wardView.style.display = city ? 'none' : 'flex';
  renderChartLegend();
  updatePart1Spread();
}

// Chỉ tiêu toàn thành phố trên thanh tiêu đề: diện tích, mật độ dân số, mật độ đường, tỷ lệ đô thị hóa (HT / QH)
function renderCityHeadStats() {
  const list = state.wardStatsData;
  const areas = {};
  let areaKm2 = 0, pop = 0, popQH = 0, urbanPop = 0, urbanPopQH = 0, urbanCount = 0;
  list.forEach(w => {
    const a = Number(w.Dien_Tich_Km2) || 0;
    const p = Number(w.Dan_So_Vector) || 0;
    const pQH = planPopOf(w);
    areas[w.Ten_Phuong] = a;
    areaKm2 += a;
    pop += p;
    popQH += pQH;
    if (/^phường\s/i.test(String(w.Ten_Phuong || '').trim())) {
      urbanPop += p;
      urbanPopQH += pQH;
      urbanCount++;
    }
  });
  buildHeadStats(CITY_NAME, true);
  const urbanRate = (u, total) => fmtPct(total > 0 ? (u / total) * 100 : 0);
  const urbanTitle = `Dân số ${urbanCount} phường chia cho tổng dân số toàn thành phố`;
  const over = popQH - CITY_POP_QH;
  setHeadCell('hsPopCap', wardStatHtml('Tổng DS QH P/X',
    over > 0 ? `<span class="c-red">${ico('alert')}${fmtNum(popQH)}</span>` : fmtNum(popQH), 'người',
    `Tổng dân số QH ${list.length} phường/xã. ` + (over > 0
      ? `Vượt trần dân số QH toàn TP ${fmtNum(over)} người, cần giảm dân số QH của một số phường/xã`
      : `Còn ${fmtNum(-over)} người trước khi chạm trần ${fmtNum(CITY_POP_QH)}`)));
  setHeadCell('hsUrbanHT', wardStatHtml('Đô thị hóa', urbanRate(urbanPop, pop), '', `${urbanTitle} (hiện trạng ${fmtNum(urbanPop)} người)`));
  setHeadCell('hsUrbanQH', wardStatHtml('Đô thị hóa QH', urbanRate(urbanPopQH, popQH), '', `${urbanTitle} (quy hoạch ${fmtNum(urbanPopQH)} người)`));
  if (areaKm2 > 0) {
    setHeadCell('hsArea', wardStatHtml('Diện tích', fmtArea(areaKm2), 'km²', `Tổng diện tích tự nhiên ${list.length} phường/xã`));
    setHeadCell('hsDensHT', wardStatHtml('Mật độ DS', fmtNum(Math.round(pop / areaKm2)), 'người/km²',
      `Dân số hiện trạng ${fmtNum(pop)} người chia cho tổng diện tích tự nhiên`));
    setHeadCell('hsDensQH', wardStatHtml('Mật độ DS QH', fmtNum(Math.round(CITY_POP_QH / areaKm2)), 'người/km²',
      `Dân số quy hoạch toàn TP ${fmtNum(CITY_POP_QH)} người chia cho tổng diện tích tự nhiên`));
    fillCityRoadDensity(document.getElementById('cityRoadDensity'), areas);
  }
  renderSummaryNote(CITY_NAME);
  checkPopCap();
}

export async function renderBottomPanel() {
  const seq = ++bottomRenderSeq;
  const wardName = isCityMode() ? CITY_NAME : state.selectedWard;
  const city = wardName === CITY_NAME;
  // Đổi địa bàn: xóa chỉ tiêu cũ ngay, không để số của địa bàn trước hiện trong lúc chờ dữ liệu
  if (headStatsKey() !== wardName) clearHeadStats();
  setBottomPanelHeader(wardName);
  renderRoadChart();
  ensureRoadTypes();

  const tbody = document.getElementById('statTableBody');
  const wardView = document.getElementById('wardSummaryView');
  if (state.wardStatsData.length === 0) {
    if (city && tbody) {
      tbody.innerHTML = `<tr><td colspan="33" class="st-msg">${ico('clock')}Đang tính toán ma trận quy chuẩn từ GEE...</td></tr>`;
    }
    if (!city && wardView) {
      wardView.innerHTML = `<div class="rp-empty">${ico('clock')}Đang tổng hợp dữ liệu quy chuẩn cho ${escapeHtml(wardName)}...</div>`;
    }
  }

  try {
    await ensureWardStats();
  } catch (err) {
    if (seq !== bottomRenderSeq) return;
    const msg = `${ico('error')}${escapeHtml(err.message || 'Lỗi nạp dữ liệu từ GEE Server.')}`;
    if (city && tbody) tbody.innerHTML = `<tr><td colspan="33" class="st-msg c-red">${msg}</td></tr>`;
    if (!city && wardView) wardView.innerHTML = `<div class="rp-empty c-red">${msg}</div>`;
    return;
  }
  if (seq !== bottomRenderSeq) return;
  setBottomPanelHeader(wardName);
  renderRoadChart();

  renderClass();
  renderGtx();
  if (city) {
    clearBalanceMap();
    renderCityHeadStats();
    rebuildCombinedTableBody();
    renderCombinedChart();
    return;
  }

  const wardData = state.wardStatsData.find(w => w.Ten_Phuong === wardName);
  if (!wardData) {
    if (wardView) wardView.innerHTML = `<div class="rp-empty">Không tìm thấy dữ liệu thống kê cho ${escapeHtml(wardName)}.</div>`;
    return;
  }
  renderWardSummary(wardData);
}

// Bảng 2 có 3 trang: hạ tầng, tiêu chí phân loại đô thị (urbanClass.js), tăng trưởng xanh (greenGrowth.js)
const PART2_PAGES = [
  { title: 'BẢNG TỔNG HỢP HẠ TẦNG', next: 'Phân loại', icon: 'flag', hint: 'Trang sau: tiêu chí phân loại đô thị (Nghị quyết 111/2025/UBTVQH15, mục tiêu 2030 theo Quyết định 756/QĐ-UBND)' },
  { title: 'TIÊU CHÍ PHÂN LOẠI ĐÔ THỊ', next: 'Tăng trưởng xanh', icon: 'leaf', hint: 'Trang sau: chỉ tiêu xây dựng đô thị tăng trưởng xanh (Thông tư 01/2018/TT-BXD, hợp nhất tại VBHN 97/2026/VBHN-TT-BXD)' },
  { title: 'CHỈ TIÊU TĂNG TRƯỞNG XANH', next: 'Hạ tầng', icon: 'table', hint: 'Trang sau: quay lại bảng tổng hợp hạ tầng' }
];
let part2Page = 0;

function renderClass() {
  const el = document.getElementById('classView');
  if (part2Page !== 1 || !el) return;
  if (!state.wardStatsData.length) {
    el.innerHTML = `<div class="rp-empty">${ico('clock')}Đang tổng hợp dữ liệu...</div>`;
    return;
  }
  renderUrbanClass(el, { wardName: isCityMode() ? '' : state.selectedWard, wards: state.wardStatsData });
}

function renderGtx() {
  const el = document.getElementById('gtxView');
  if (part2Page !== 2 || !el) return;
  if (!state.wardStatsData.length) {
    el.innerHTML = `<div class="rp-empty">${ico('clock')}Đang tổng hợp dữ liệu...</div>`;
    return;
  }
  renderGreenGrowth(el, { wardName: isCityMode() ? '' : state.selectedWard, wards: state.wardStatsData });
}

function setPart2Page(page) {
  const flip = document.getElementById('part2Flip');
  if (!flip) return;
  part2Page = (page + PART2_PAGES.length) % PART2_PAGES.length;
  const cur = PART2_PAGES[part2Page];
  flip.dataset.page = String(part2Page);
  flip.querySelectorAll('.p2-face').forEach(face => face.setAttribute('aria-hidden', String(Number(face.dataset.page) !== part2Page)));
  flip.closest('.bp-part2')?.classList.toggle('p2-alt', part2Page !== 0);
  const title = document.getElementById('bpPart2Title');
  if (title) title.textContent = cur.title;
  const btn = document.getElementById('btnFlipPart2');
  if (btn) {
    btn.innerHTML = `${ico(cur.icon)}${cur.next}`;
    btn.classList.toggle('active', part2Page !== 0);
    btn.setAttribute('aria-pressed', String(part2Page !== 0));
    btn.title = cur.hint;
  }
  document.querySelectorAll('#part2Dots i').forEach(dot => dot.classList.toggle('active', Number(dot.dataset.page) === part2Page));
  renderClass();
  renderGtx();
}

let pdfExporting = false;
export async function exportBottomPanelPdf() {
  const body = document.getElementById('bpBody');
  if (!body || pdfExporting) return;
  pdfExporting = true;
  try {
    await loadHtml2Pdf();
  } catch (err) {
    pdfExporting = false;
    showToast('❌ Không tải được thư viện xuất PDF, kiểm tra kết nối mạng.', 'error');
    return;
  }
  const place = isCityMode() ? 'TP-Hue' : state.selectedWard;
  const fileName = part2Page === 2 ? `Chi-Tieu-Tang-Truong-Xanh-${place}.pdf`
    : part2Page === 1 ? `Tieu-chi-Phan-loai-Do-thi-${place}.pdf`
    : (isCityMode() ? 'Bao-Cao-Ha-Tang-TP-Hue.pdf' : `Bao-Cao-${state.selectedWard}.pdf`);
  body.classList.add('pdf-export');
  const done = () => { body.classList.remove('pdf-export'); pdfExporting = false; };
  window.html2pdf().from(body).set({
    margin: 5,
    filename: fileName,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, scrollY: 0, onclone: inlineSpriteIcons },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
  }).save().then(done, done);
}

export function selectWardDetail(wardName) {
  setBottomPanelMaximized(false);
  map.closePopup();
  const focusDone = focusWard(wardName);
  renderBottomPanel();
  return focusDone;
}

// Click trong bảng 40 phường và bảng chi tiết phường (thay cho onclick nội tuyến)
export function initBottomPanelEvents() {
  initPart1Flip();
  document.addEventListener(ROADS_META_EVENT, () => {
    ensureRoadTypes(true);
    reloadGreenGrowthRoads().then(renderGtx).catch(err => console.warn('Tăng trưởng xanh – mạng lưới đường lỗi:', err));
    reloadUrbanClassRoads().then(renderClass).catch(err => console.warn('Phân loại đô thị – mạng lưới đường lỗi:', err));
  });
  document.addEventListener(BUILT_AREA_EVENT, () => {
    if (roadTypesByWard) refreshRoadViews();
    renderClass();
  });
  document.getElementById('btnFlipPart2')?.addEventListener('click', () => setPart2Page(part2Page + 1));
  document.getElementById('part2Dots')?.addEventListener('click', (e) => {
    const dot = e.target.closest('i[data-page]');
    if (dot) setPart2Page(Number(dot.dataset.page));
  });
  initGreenGrowthEvents(document.getElementById('gtxView'), renderGtx);
  initUrbanClassEvents(document.getElementById('classView'), renderClass);
  document.getElementById('statTableBody')?.addEventListener('click', (e) => {
    const link = e.target.closest('.ward-link');
    if (link) selectWardDetail(link.dataset.ward);
  });
  document.getElementById('wardSummaryView')?.addEventListener('click', (e) => {
    const zoom = e.target.closest('[data-action="zoom"]');
    if (zoom) {
      const lat = Number(zoom.dataset.lat), lng = Number(zoom.dataset.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      setBottomPanelMaximized(false);
      zoomToPoint(lat, lng, zoom.dataset.name || '');
      return;
    }
    const toggle = e.target.closest('[data-action="toggle"]');
    if (toggle) {
      const section = document.getElementById(toggle.dataset.target);
      if (section) setSubSectionOpen(e.currentTarget, toggle.dataset.target, section.style.display === 'none');
      return;
    }
    const balBtn = e.target.closest('[data-action="balance-map"]');
    if (balBtn && state.selectedWard) {
      if (toggleBalanceMap(state.selectedWard)) setBottomPanelMaximized(false);
      const on = isBalanceMapOn(state.selectedWard);
      balBtn.classList.toggle('active', on);
      balBtn.textContent = on ? 'Ẩn trên bản đồ' : 'Xem trên bản đồ';
    }
  });
}

// ================== CHI TIẾT 1 PHƯỜNG ==================
function setWardCoverageStatus(wardName, text, color = 'var(--accent-orange)') {
  const card = document.getElementById('wardSummaryCard');
  if (!card || card.dataset.ward !== wardName) return;
  const statusEl = document.getElementById('wardCoverageStatus');
  if (!statusEl) return;
  statusEl.style.color = color;
  setStatusContent(statusEl, text);
}

function setSubSectionOpen(root, sectionId, open) {
  const section = document.getElementById(sectionId);
  const toggle = root.querySelector(`[data-action="toggle"][data-target="${sectionId}"]`);
  if (section) section.style.display = open ? 'table-row-group' : 'none';
  if (toggle) {
    toggle.textContent = open ? '▲' : '▼';
    toggle.setAttribute('aria-expanded', String(open));
  }
}

// Dựng lại bảng (gõ dân số QH, có kết quả độ phủ) nhưng giữ các danh sách công trình người dùng đang mở
function refreshWardQuotaTable(wardData) {
  const card = document.getElementById('wardSummaryCard');
  if (!card || card.dataset.ward !== wardData.Ten_Phuong) return;
  const container = document.getElementById('wardQuotaTableContainer');
  if (!container) return;
  const openIds = [...container.querySelectorAll('tbody[id]')].filter(tb => tb.style.display !== 'none').map(tb => tb.id);
  container.innerHTML = buildWardQuotaTableHtml(wardData, wardData.projectedPopulation);
  openIds.forEach(id => setSubSectionOpen(container, id, true));
}

// Độ phủ phường đang xem: lỗi/timeout/0% bất thường → tự gọi lại sau 15s → 45s → 90s (1 chuỗi thử lại tại 1 thời điểm)
let wardRetryTimer = null;
function loadWardDetailCoverage(wardData, attempt = 0) {
  const name = wardData.Ten_Phuong;
  if (wardData._coverageReady && !wardData._coverageTentative) {
    setWardCoverageStatus(name, '');
    return;
  }
  setWardCoverageStatus(name, attempt ? `⏳ Đang tính lại độ phủ (lần ${attempt + 1})...` : '⏳ Đang tính độ phủ...');
  requestWardCoverage(wardData, 'HT').then(r => {
    if (!isWardCurrent(wardData)) return;
    if (r.ok) applyCoverageResult(wardData, 'HT', r.cov, !r.suspicious);
    wardData._coverageTentative = !r.ok || r.suspicious;
    refreshWardQuotaTable(wardData);
    renderSummaryNote(name);

    if (!wardData._coverageTentative) {
      setWardCoverageStatus(name, '');
    } else if (attempt < DETAIL_RETRY_DELAYS.length) {
      const wait = DETAIL_RETRY_DELAYS[attempt];
      setWardCoverageStatus(name, `⏳ Máy chủ GEE đang bận, tự tính lại sau ${wait / 1000}s...`);
      clearTimeout(wardRetryTimer);
      wardRetryTimer = setTimeout(() => {
        if (state.selectedWard === name && isWardCurrent(wardData)) loadWardDetailCoverage(wardData, attempt + 1);
      }, wait);
    } else {
      setWardCoverageStatus(name, '⚠ Chưa tính được độ phủ, hệ thống sẽ tự cập nhật khi máy chủ rảnh', 'var(--accent-red)');
    }
  });
}

const UNIT_POP = 20000;

function renderWardSummary(wardData) {
  const popCurrent = wardData.Dan_So_Vector || 45000;
  if (!wardData.projectedPopulation) wardData.projectedPopulation = Math.round(popCurrent * 1.2);
  const popProjected = wardData.projectedPopulation;
  const projectedUnits = wardData.projectedUnits || Math.max(1, Math.ceil(popProjected / UNIT_POP));

  const view = document.getElementById('wardSummaryView');
  if (!view) return;
  if (!isBalanceMapOn(wardData.Ten_Phuong)) clearBalanceMap();
  const areaKm2 = Number(wardData.Dien_Tich_Km2) || 0;
  view.innerHTML = `<div id="wardSummaryCard">
    <div id="wardQuotaTableContainer">${buildWardQuotaTableHtml(wardData, popProjected)}</div>
  </div>`;
  document.getElementById('wardSummaryCard').dataset.ward = wardData.Ten_Phuong;

  buildHeadStats(wardData.Ten_Phuong, false);
  setHeadCell('hsPopQH', `<div class="ward-stat" title="Dân số quy hoạch của phường/xã, nhập để tính lại nhu cầu diện tích">`
    + `<small><label for="wardPopInput">Dân số QH</label></small><span><b><input type="number" id="wardPopInput" value="${Number(popProjected)}" step="1000" min="1000" max="${CITY_POP_QH}" /></b>`
    + ` <em>người</em></span></div>`);
  setHeadCell('hsPopCap', wardStatHtml('Số đơn vị ở', `<span id="projectedUnitsLabel">${projectedUnits}</span>`, '',
    `Số đơn vị ở theo dân số QH, quy mô tối đa ${fmtNum(UNIT_POP)} người/đơn vị ở`));
  if (areaKm2 > 0) {
    setHeadCell('hsArea', wardStatHtml('Diện tích', fmtArea(areaKm2), 'km²', 'Diện tích tự nhiên theo thuộc tính polygon phường/xã'));
    setHeadCell('hsDensHT', wardStatHtml('Mật độ DS', fmtNum(Math.round(popCurrent / areaKm2)), 'người/km²',
      'Dân số hiện trạng chia cho diện tích tự nhiên'));
    setHeadCell('hsDensQH', wardStatHtml('Mật độ DS QH', `<span id="wardDensityQH">${fmtNum(Math.round(popProjected / areaKm2))}</span>`, 'người/km²',
      'Dân số quy hoạch chia cho diện tích tự nhiên'));
  }
  const roadLenEl = document.getElementById('wardRoadLen');
  roadLenEl.dataset.ward = wardData.Ten_Phuong;
  roadLenEl.dataset.area = String(areaKm2);
  fillWardRoadLengths(wardData.Ten_Phuong);
  ensureRoadTypes();
  renderSummaryNote(wardData.Ten_Phuong);

  const popInput = document.getElementById('wardPopInput');
  if (popInput) {
    popInput.oninput = (e) => {
      const raw = Number(e.target.value);
      const newProjPop = Number.isFinite(raw) && raw >= 1000 ? Math.min(raw, CITY_POP_QH) : popProjected;
      const newUnits = Math.max(1, Math.ceil(newProjPop / UNIT_POP));
      const unitsLabel = document.getElementById('projectedUnitsLabel');
      if (unitsLabel) unitsLabel.textContent = newUnits;
      const densityQH = document.getElementById('wardDensityQH');
      if (densityQH && areaKm2 > 0) densityQH.textContent = fmtNum(Math.round(newProjPop / areaKm2));
      wardData.projectedPopulation = newProjPop;
      wardData.projectedUnits = newUnits;
      [wardData.urbanResults, wardData.unitResults].forEach(group => {
        Object.values(group || {}).forEach(node => { node.requiredArea = (node.quota || 0) * newProjPop; });
      });
      refreshWardQuotaTable(wardData);
      checkPopCap(wardData);
    };
  }
  checkPopCap(wardData);

  clearTimeout(wardRetryTimer);
  loadWardDetailCoverage(wardData);
  loadWardNetworkCoverage(wardData);
  if (wardData.parkRule && !newDevOf(wardData.Ten_Phuong)) {
    loadNewDevStats().then(() => refreshWardQuotaTable(wardData)).catch(err => console.warn('Thống kê vùng phát triển mới lỗi:', err));
  }
}

// Trần dân số QH toàn TP: ô nhập dân số QH của phường tô đỏ + tooltip khi tổng vượt trần; toast mỗi lần tổng chuyển từ trong ngưỡng sang vượt ngưỡng
function checkPopCap(wardData = null) {
  const total = totalPlanPop();
  const over = total - CITY_POP_QH;
  const input = document.getElementById('wardPopInput');
  if (input && wardData && headStatsKey() === wardData.Ten_Phuong) {
    const room = Math.max(0, CITY_POP_QH - (total - planPopOf(wardData)));
    input.classList.toggle('over-cap', over > 0);
    input.closest('.ward-stat').title = 'Dân số quy hoạch của phường/xã, nhập để tính lại nhu cầu diện tích\n'
      + `Tổng dân số QH ${state.wardStatsData.length} phường/xã: ${fmtNum(total)} người${over > 0 ? `, vượt trần ${fmtNum(over)} người` : ''}. `
      + `Trần dân số QH toàn TP ${fmtNum(CITY_POP_QH)} người. Phường/xã này tối đa ${fmtNum(room)} người để tổng không vượt trần`;
  }
  if (over > 0 && !popCapExceeded) {
    showToast(`⚠️ Tổng dân số QH các phường/xã (${fmtNum(total)} người) vượt dân số QH toàn TP ${fmtNum(CITY_POP_QH)} người`, 'error');
  }
  popCapExceeded = over > 0;
}

const DEFAULT_QUOTA = {
  "3-MN": 0.60, "4-TH": 0.65, "5-THCS": 0.55, "CV_DV": 2.00, "BDX_DV": 2.50, "DVCC_TOTAL": 0.20, "DVCC_ALL": 2.00
};

// Chỉ tiêu của nhóm theo dữ liệu máy chủ (null = không quy định cho loại địa bàn); thiếu nhóm thì lấy mặc định
const quotaOf = (node, key) => (node ? node.quota : DEFAULT_QUOTA[key]);
const hasQuota = (quota) => quota != null && Number.isFinite(Number(quota));
const QUOTA_FORMAT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const quotaText = (quota) => `≥ ${QUOTA_FORMAT.format(Number(quota))}`;
// Độ phủ đã bị giới hạn vì diện tích chỉ đáp ứng được số dân = diện tích ÷ chỉ tiêu m²/người
const capacityNote = (s) => (s.capacityLimited
  ? `, quy mô chỉ đáp ứng ~${fmtNum(s.capacity)} người theo ${QUOTA_FORMAT.format(s.quota)} m²/người`
  : '');

// Mục tiêu số cơ sở theo QCVN (THPT khi dân số > 20.000; 1 trạm y tế, 1 chợ mỗi xã); null = không có quy tắc
function countTargetOf(wardData, key, projPop) {
  const rule = (wardData.countRules || {})[key];
  if (!rule) return null;
  if (rule.perWard) return rule.perWard;
  if (rule.minPop != null) return projPop > rule.minPop ? 1 : 0;
  return null;
}

function minSizeBadgeHtml(sub) {
  const min = Number(sub.minSize || 0);
  if (!min) return '';
  const size = Number(sub.size || 0);
  const title = `QCVN 01:2026/BXD ${escapeHtml(sub.minSizeRef || '')}: tối thiểu ${fmtNum(min)} m²/công trình`;
  if (!(size > 0)) return ` <span class="min-size-note" title="${title}">(chưa có diện tích)</span>`;
  return size < min ? ` <span class="min-size-warn" title="${title}">${ico('alert')}&lt; ${fmtNum(min)} m²</span>` : '';
}

function minSizeSummaryHtml(subItems) {
  const below = subItems.filter(s => Number(s.minSize) > 0 && Number(s.size) > 0 && Number(s.size) < Number(s.minSize)).length;
  if (!below) return '';
  const checked = subItems.filter(s => Number(s.minSize) > 0 && Number(s.size) > 0).length;
  return ` <span class="min-size-warn" title="Số công trình nhỏ hơn quy mô tối thiểu theo QCVN 01:2026/BXD">${ico('alert')}${below}/${checked} dưới QM tối thiểu</span>`;
}

function radiusCellHtml(sub) {
  const radiusVal = Number(sub.radius || 0);
  return radiusVal > 0 ? `${fmtNum(radiusVal)} m` : '-';
}

function radiusSummaryHtml() {
  return '';
}

// Mỗi đơn vị ở phát triển mới: ≥ 1 công viên ≥ 5.000 m² hoặc 2 công viên ≥ 2.500 m² (Mục 2.2.3.2)
function parkRuleHtml(subItems, rule, totalUnits) {
  const large = subItems.filter(s => Number(s.size) >= rule.large).length;
  const medium = subItems.filter(s => Number(s.size) >= rule.medium && Number(s.size) < rule.large).length;
  const ok = Math.min(totalUnits, large + Math.floor(medium / 2));
  const title = `QCVN 01:2026/BXD Mục 2.2.3.2: mỗi đơn vị ở phát triển mới có ≥ 1 công viên ≥ ${fmtNum(rule.large)} m² hoặc 2 công viên ≥ ${fmtNum(rule.medium)} m²`;
  return `<b title="${title}" class="${ok >= totalUnits ? 'c-green' : 'c-red'}">${ok}/${totalUnits} ĐVỞ đạt QM</b>`;
}

function zoomLinkHtml(item, fallbackName = 'Công trình') {
  const name = escapeHtml(item.name || fallbackName);
  const lat = Number(item.lat), lng = Number(item.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return `<span>${name}</span>`;
  return `<button type="button" class="link-btn" data-action="zoom" data-lat="${lat}" data-lng="${lng}" data-name="${name}">${name}</button>`;
}

function toggleBtnHtml(sectionId) {
  return `<button type="button" class="sub-toggle" data-action="toggle" data-target="${sectionId}" aria-expanded="false" aria-label="Hiện/ẩn danh sách công trình">▼</button>`;
}

function scaleCellHtml(currentArea, reqArea) {
  const pct = reqArea > 0 ? Math.min(100, Math.round((currentArea / reqArea) * 100)) : 100;
  return `<b class="${pct >= 100 ? 'c-green' : 'c-red'}">Đạt ${pct}%</b>`;
}

function coverageCellHtml(wardData, code) {
  const pct = getCoveragePct(wardData, code);
  if (pct == null) return PENDING_CELL;
  return `<b class="${pct >= 100 ? 'c-green' : 'c-orange'}">${fmtPct(pct)}</b>`;
}

function countCellHtml(count, totalUnits) {
  return `<b class="${count >= totalUnits ? 'c-green' : 'c-red'}">${count}/${totalUnits} cơ sở</b>`;
}

function buildWardQuotaTableHtml(wardData, projPop) {
  const urbanRes = wardData.urbanResults || {};
  const unitRes = wardData.unitResults || {};
  const totalUnits = wardData.projectedUnits || Math.max(1, Math.ceil(projPop / 20000));
  const parts = [];

  const subItemRows = (sectionId, subItems, deep = false) => {
    parts.push(`</tbody><tbody id="${sectionId}" style="display:none;">`);
    subItems.forEach(sub => {
      parts.push(`<tr class="wt-sub${deep ? ' wt-deep' : ''}">
        <td>-</td>
        <td>${zoomLinkHtml(sub)}${minSizeBadgeHtml(sub)}</td>
        <td>${fmtNum(sub.size)} m²</td>
        <td>-</td>
        <td>-</td>
        <td>-</td>
        <td>-</td>
        <td class="wt-radius">${radiusCellHtml(sub)}</td>
      </tr>`);
    });
    parts.push(`</tbody><tbody>`);
  };

  // tone: a (cyan) / b (green) / c (red) / d (orange) — màu tiêu đề nhóm A–D
  const sectionHeader = (letter, tone, title) => parts.push(`<tr class="wt-section wt-${tone}">
    <td>${letter}</td>
    <td colspan="7">${title}</td>
  </tr>`);

  const countHtmlOf = (subItems, target) => (target
    ? countCellHtml(subItems.length, target)
    : `${subItems.length} cơ sở`);

  // Cân đối từ phường/xã lân cận ≤ 2 km (Bảng 6, Chú thích 4): dòng phụ ô Quy mô + danh sách công trình được tính cân đối
  const balanceCellHtml = (key, have, req) => {
    const slot = balanceSlot(wardData.Ten_Phuong, key);
    const links = slot && slot.borrowed >= 1 ? slot.links : [];
    return balanceScaleHtml(slot, have, req) + (links.length ? ` ${toggleBtnHtml(`bal_sub_${key}`)}` : '');
  };
  const balanceRows = (key) => {
    const slot = balanceSlot(wardData.Ten_Phuong, key);
    if (!slot || slot.borrowed < 1 || !slot.links.length) return;
    parts.push(`</tbody><tbody id="bal_sub_${key}" style="display:none;">`);
    slot.links.forEach(l => parts.push(`<tr class="wt-sub wt-bal">
      <td>↳</td>
      <td>${zoomLinkHtml(l)} <span class="wt-light">· ${escapeHtml(l.ward)}</span></td>
      <td>${fmtNum(l.area)} m²</td>
      <td colspan="5" class="wt-note" title="${BALANCE_REF}">Phần dư tính cân đối, cách ranh phường ${fmtNum(l.dist)} m</td>
    </tr>`));
    parts.push(`</tbody><tbody>`);
  };

  // Dòng 1 nhóm chỉ tiêu có diện tích, nhu cầu, quy mô, độ phủ; quota null = không quy định cho loại địa bàn
  const quotaRow = ({ stt, label, node, quota, code, sectionId, countTarget = null, extraCount = '', balanceKey = null }) => {
    const currentArea = node ? Number(node.currentArea || 0) : 0;
    const subItems = (node && node.subItems) || [];
    const required = hasQuota(quota);
    const reqArea = required ? Math.round(Number(quota) * projPop) : 0;
    parts.push(`<tr class="wt-main">
      <td>${stt}</td>
      <td>${escapeHtml(label)} ${subItems.length ? toggleBtnHtml(sectionId) : ''}${minSizeSummaryHtml(subItems)}${radiusSummaryHtml(subItems)}</td>
      <td>${fmtNum(currentArea)} m²</td>
      <td>${required ? quotaText(quota) : NOT_REQUIRED_DASH}</td>
      <td>${required ? `${fmtNum(reqArea)} m²` : NOT_REQUIRED_DASH}</td>
      <td>${countHtmlOf(subItems, countTarget)}${extraCount}</td>
      <td>${required ? scaleCellHtml(currentArea, reqArea) + (balanceKey ? balanceCellHtml(balanceKey, currentArea, reqArea) : '') : `<span class="c-muted" title="${NOT_REQUIRED_TITLE}">Không QĐ</span>`}</td>
      <td>${coverageCellHtml(wardData, code)}</td>
    </tr>`);
    if (subItems.length) subItemRows(sectionId, subItems);
    if (balanceKey && required) balanceRows(balanceKey);
  };

  // Panel trải (màn lớn): A–B và C–F thành 2 bảng cạnh nhau, mỗi bảng cuộn riêng
  const split = wardSplitWanted();
  const head = `<table class="ward-table">
    <thead>
      <tr><th>STT</th><th>Loại hạ tầng</th><th>Diện tích</th><th>Chỉ tiêu</th><th>Nhu cầu DT</th><th>Số lượng</th><th>Quy mô</th><th>Độ phủ</th></tr>
    </thead>
    <tbody>`;
  parts.push(`${split ? '<div class="wt-split">' : ''}<div class="ward-table-scroll-container">${head}`);

  // A / CÔNG TRÌNH HẠ TẦNG CẤP ĐÔ THỊ
  sectionHeader('A', 'a', 'CÔNG TRÌNH HẠ TẦNG CẤP ĐÔ THỊ');
  const urbanCodes = { THPT: 'THPT', YT_DT: '7-YT_DT', VH_DT: '8-VH_DT', TM_DT: '9-TM_DT', CV_DT: '1-CV_DT', BDX_DT: '2-BDX_DT' };
  let urbanIdx = 1;
  Object.keys(urbanCodes).forEach(key => {
    const node = urbanRes[key];
    if (!node) return;
    quotaRow({ stt: urbanIdx++, label: node.label, node, quota: node.quota, code: urbanCodes[key], sectionId: `urban_sub_${key}`, countTarget: countTargetOf(wardData, key, projPop) });
  });

  // B / CÔNG TRÌNH HẠ TẦNG CẤP ĐƠN VỊ Ở
  const isUrbanProfile = !wardData.profile || wardData.profile === 'DT';
  sectionHeader('B', 'b', `CÔNG TRÌNH HẠ TẦNG CẤP ĐƠN VỊ Ở (Quy hoạch: ${totalUnits} đơn vị ở)`);
  const unitSchools = [
    { key: "3-MN", label: "Trường Mầm non" },
    { key: "4-TH", label: "Trường Tiểu học" },
    { key: "5-THCS", label: "Trường THCS" }
  ];
  let unitIdx = 1;
  unitSchools.forEach(item => {
    const node = unitRes[item.key];
    quotaRow({ stt: unitIdx++, label: item.label, node, quota: quotaOf(node, item.key), code: item.key, sectionId: `unit_sub_${item.key}`, countTarget: totalUnits, balanceKey: item.key });
  });

  // Mục 4: Dịch vụ công cộng khác đơn vị ở (Y tế + Văn hóa + Chợ): phường theo m²/người, xã theo số cơ sở (Bảng 30)
  const dvccKeys = [
    { key: "YT_DV", label: "Y tế đơn vị ở", code: "7-YT_DV", stt: "4.1" },
    { key: "VH_DV", label: "Văn hóa thể thao đơn vị ở", code: "8-VH_DV", stt: "4.2" },
    { key: "TM_DV", label: "Chợ - TMDV đơn vị ở", code: "9-TM_DV", stt: "4.3" }
  ];
  const dvccQuota = quotaOf(unitRes.DVCC_TOTAL, 'DVCC_TOTAL');
  const dvccRequired = hasQuota(dvccQuota);
  const dvccArea = dvccKeys.reduce((s, c) => s + Number(unitRes[c.key]?.currentArea || 0), 0);
  const dvccCount = dvccKeys.reduce((s, c) => s + (unitRes[c.key]?.subItems?.length || 0), 0);
  const dvccReq = dvccRequired ? Math.round(Number(dvccQuota) * projPop) : 0;
  parts.push(`<tr class="wt-main">
    <td>${unitIdx}</td>
    <td>Dịch vụ công cộng khác đơn vị ở${dvccRequired ? '' : ' <span class="wt-light">(theo số cơ sở)</span>'}</td>
    <td>${fmtNum(dvccArea)} m²</td>
    <td>${dvccRequired ? quotaText(dvccQuota) : NOT_REQUIRED_DASH}</td>
    <td>${dvccRequired ? `${fmtNum(dvccReq)} m²` : NOT_REQUIRED_DASH}</td>
    <td>${isUrbanProfile ? countCellHtml(dvccCount, totalUnits) : `${dvccCount} cơ sở`}</td>
    <td>${dvccRequired ? scaleCellHtml(dvccArea, dvccReq) + balanceCellHtml('DVCC_TOTAL', dvccArea, dvccReq) : '-'}</td>
    <td>-</td>
  </tr>`);
  if (dvccRequired) balanceRows('DVCC_TOTAL');

  dvccKeys.forEach(comp => {
    const node = unitRes[comp.key];
    const subItems = (node && node.subItems) || [];
    const sectionId = `comp_sub_${comp.key}`;
    const target = countTargetOf(wardData, comp.key, projPop) ?? (isUrbanProfile ? totalUnits : null);
    parts.push(`<tr class="wt-comp">
      <td>${comp.stt}</td>
      <td>${comp.label} ${subItems.length ? toggleBtnHtml(sectionId) : ''}${minSizeSummaryHtml(subItems)}${radiusSummaryHtml(subItems)}</td>
      <td>${fmtNum(node ? node.currentArea : 0)} m²</td>
      <td>-</td>
      <td>-</td>
      <td>${countHtmlOf(subItems, target)}</td>
      <td>-</td>
      <td>${coverageCellHtml(wardData, comp.code)}</td>
    </tr>`);
    if (subItems.length) subItemRows(sectionId, subItems, true);
  });
  unitIdx++;

  // Mục 5: Tổng đất DVCC đơn vị ở gồm cả trường học (Bảng 6 / Bảng 28: ≥ 2,0 m²/người)
  const allNode = unitRes.DVCC_ALL;
  const allQuota = quotaOf(allNode, 'DVCC_ALL');
  const allArea = allNode
    ? Number(allNode.currentArea || 0)
    : ["3-MN", "4-TH", "5-THCS"].reduce((s, k) => s + Number(unitRes[k]?.currentArea || 0), dvccArea);
  const allReq = Math.round(Number(allQuota) * projPop);
  parts.push(`<tr class="wt-main">
    <td>${unitIdx++}</td>
    <td title="QCVN 01:2026/BXD ${isUrbanProfile ? 'Bảng 6' : 'Bảng 28'}">Tổng đất dịch vụ công cộng đơn vị ở (1+2+3+4)</td>
    <td>${fmtNum(allArea)} m²</td>
    <td>${quotaText(allQuota)}</td>
    <td>${fmtNum(allReq)} m²</td>
    <td>-</td>
    <td>${scaleCellHtml(allArea, allReq)}${balanceScaleHtml(balanceSlot(wardData.Ten_Phuong, 'ALL'), allArea, allReq)}</td>
    <td>-</td>
  </tr>`);
  const balAll = balanceSlot(wardData.Ten_Phuong, 'ALL');
  if (balAll && balAll.borrowed >= 1) {
    const on = isBalanceMapOn(wardData.Ten_Phuong);
    parts.push(`<tr class="wt-comp wt-bal-head">
      <td></td>
      <td colspan="7" class="wt-note" title="${BALANCE_REF}: phường không đủ quỹ đất được tính cân đối từ đất dịch vụ công cộng tại khu vực lân cận, bán kính phục vụ ≤ 2 km. Mỗi m² dư chỉ tính cho 1 phường, ưu tiên công trình gần nhất.">
        Cân đối từ phường/xã lân cận (Chú thích 4 Bảng 6): tính thêm <b>${fmtNum(Math.round(balAll.borrowed))} m²</b> từ ${balAll.links.length} lượt công trình
        <button type="button" class="link-btn bal-map-btn${on ? ' active' : ''}" data-action="balance-map">${on ? 'Ẩn trên bản đồ' : 'Xem trên bản đồ'}</button>
      </td>
    </tr>`);
  }

  [
    { key: "CV_DV", label: "Vườn hoa (cây xanh đơn vị ở)", code: "1-CV_DV" },
    { key: "BDX_DV", label: "Bãi đỗ xe đơn vị ở", code: "2-BDX_DV" }
  ].forEach(item => {
    const node = unitRes[item.key];
    const subItems = (node && node.subItems) || [];
    const parkRule = item.key === 'CV_DV' && wardData.parkRule;
    quotaRow({
      stt: unitIdx++, label: item.label, node, quota: quotaOf(node, item.key), code: item.code, sectionId: `unit_sub_${item.key}`,
      countTarget: parkRule || !isUrbanProfile ? null : totalUnits,
      extraCount: parkRule ? `<br>${parkRuleHtml([...subItems, ...(urbanRes.CV_DT?.subItems || [])], parkRule, totalUnits)}` : ''
    });
  });
  if (isUrbanProfile) parts.push(newDevRowHtml(wardData.Ten_Phuong));

  if (split) parts.push(`</tbody></table></div><div class="ward-table-scroll-container wt-right">${head}`);

  // C / CÔNG TRÌNH CHƯA DUYỆT (QUY HOẠCH) — nhóm 1–8, TrangThai = FALSE
  sectionHeader('C', 'c', 'CÔNG TRÌNH CHƯA DUYỆT (QUY HOẠCH)');
  const pendingList = wardData.pendingItems || [];
  if (pendingList.length > 0) {
    pendingList.forEach((pItem, pIdx) => {
      const typeNote = pItem.typeLabel ? ` <span class="wt-light">(${escapeHtml(pItem.typeLabel)})</span>` : '';
      parts.push(`<tr class="wt-item">
        <td>${pIdx + 1}</td>
        <td>${zoomLinkHtml(pItem)}${typeNote}</td>
        <td>${fmtNum(pItem.size)} m²</td>
        <td colspan="5" class="wt-note">
          Sau khi phê duyệt dự kiến bổ sung <b class="c-green">${fmtPct(pItem.scaleAddPct)}</b> quy mô, <b class="c-cyan">${fmtPct(pItem.coverageAddPct)}</b> độ phủ${pItem.coverageMethod === 'estimate' ? ' (ước lượng)' : ''}${capacityNote(pItem)}
        </td>
      </tr>`);
    });
  } else {
    parts.push(`<tr class="wt-empty"><td>-</td><td colspan="7">Không có công trình nhóm 1–8 đang chờ duyệt trong phường.</td></tr>`);
  }

  // D / CÁC CƠ SỞ CHƯA SỬ DỤNG
  sectionHeader('D', 'd', 'CÁC CƠ SỞ CHƯA SỬ DỤNG');
  const csdList = wardData.csdItems || [];
  if (csdList.length > 0) {
    csdList.forEach((csd, csdIdx) => {
      const needApprove = csd.needsApproval || !isApproved(csd.status);
      const needApproveNote = needApprove ? `<div class="wt-need-approve">(Cần phê duyệt)</div>` : '';
      const eligibleSugg = (csd.suggestions || []).filter(s => s.status === 'eligible');
      const suggestionHtml = eligibleSugg.length > 0
        ? eligibleSugg.slice(0, 2).map((s, idx) => s.basis === 'scale'
          ? `<div>Ưu tiên ${idx + 1}: ${escapeHtml(s.label)} (bù thiếu quy mô: phường đạt <b class="c-red">${fmtPct(s.currentScalePct)}</b> → <b class="c-green">${fmtPct(Math.min(100, s.currentScalePct + s.scaleAddPct))}</b>, độ phủ không tăng).</div>`
          : `<div>Ưu tiên ${idx + 1}: ${escapeHtml(s.label)} (bổ sung <b class="c-green">${fmtPct(s.scaleAddPct)}</b> quy mô, <b class="c-cyan">${fmtPct(s.coverageAddPct)}</b> độ phủ${s.coverageMethod === 'estimate' ? ', ước lượng' : ''}${capacityNote(s)}).</div>`
        ).join('')
        : `<div class="c-muted"><i>Chưa có gợi ý phù hợp</i></div>`;

      parts.push(`<tr class="wt-item wt-top">
        <td>${csdIdx + 1}</td>
        <td>${zoomLinkHtml(csd, 'Khu đất chưa sử dụng')}${needApproveNote}</td>
        <td>${fmtNum(csd.size)} m²</td>
        <td colspan="5" class="wt-note">${suggestionHtml}</td>
      </tr>`);
    });
  } else {
    parts.push(`<tr class="wt-empty"><td>-</td><td colspan="7">Không có cơ sở chưa sử dụng nào nằm trong ranh giới phường.</td></tr>`);
  }

  // E / MẠNG LƯỚI ĐƯỜNG GIAO THÔNG — điền lại khi đọc xong chỉ mục mạng lưới đường (refreshRoadViews)
  sectionHeader('E', 'e', 'MẠNG LƯỚI ĐƯỜNG GIAO THÔNG (OpenStreetMap + tuyến Admin bổ sung)');
  parts.push(`</tbody><tbody id="wardRoadBody">${wardRoadRowsHtml(wardData)}</tbody><tbody>`);

  parts.push(networkSectionHtml(wardData));

  parts.push(`</tbody></table></div>${split ? '</div>' : ''}`);
  return parts.join('');
}

// ================== F / MẠNG LƯỚI HẠ TẦNG KHÁC (TRẠM XE BUÝT, PCCC, NHÀ TANG LỄ - NGHĨA TRANG) ==================
// Dân số trong vùng phục vụ / vùng cách ly theo phường (action getNetworkCoverage): "phường|dataVersion" → kết quả | 'error'
const netCoverageCache = new Map();
const netCovInflight = new Set();
const netCovKey = (ward) => `${ward}|${state.dataVersion}`;

function netCovCellHtml(ward, key) {
  const res = netCoverageCache.get(netCovKey(ward));
  if (!res) return PENDING_CELL;
  if (res === 'error') return `<span class="c-muted" title="Chưa tính được (GEE đang bận), mở lại phường sau">–</span>`;
  const g = res[key] || { pop: 0, pct: 0 };
  if (key === 'nt') {
    return g.pop > 0
      ? `<b class="c-red" title="Dân số nằm trong khoảng cách an toàn của nghĩa trang / cơ sở hỏa táng (Bảng 23)">${fmtNum(g.pop)} người</b>`
      : `<b class="c-green" title="Không có dân cư trong khoảng cách an toàn">0 người</b>`;
  }
  return `<b class="${g.pct >= 100 ? 'c-green' : 'c-orange'}" title="${fmtNum(g.pop)}/${fmtNum(res.popTotal)} người trong phạm vi">${fmtPct(g.pct)}</b>`;
}

function loadWardNetworkCoverage(wardData) {
  const ward = wardData.Ten_Phuong;
  const key = netCovKey(ward);
  if (netCoverageCache.has(key) || netCovInflight.has(key)) return;
  const fillCells = () => {
    const card = document.getElementById('wardSummaryCard');
    if (!card || card.dataset.ward !== ward) return;
    card.querySelectorAll('.net-cov').forEach(td => { td.innerHTML = netCovCellHtml(ward, td.dataset.key); });
  };
  // Toàn TP chưa có điểm mạng lưới đã duyệt: mọi phường 0%, không cần gọi GEE
  if (!state.rawDataList.some(it => isNetworkType(it.type) && isApproved(it.status))) {
    const zero = { pop: 0, pct: 0, count: 0 };
    netCoverageCache.set(key, { popTotal: 0, bus: zero, pccc: zero, nt: zero });
    fillCells();
    return;
  }
  netCovInflight.add(key);
  fetch(geeApi(`action=getNetworkCoverage&ward=${encodeURIComponent(ward)}`))
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(res => netCoverageCache.set(key, res))
    .catch(() => netCoverageCache.set(key, 'error'))
    .finally(() => {
      netCovInflight.delete(key);
      fillCells();
      if (netCoverageCache.get(key) === 'error') netCoverageCache.delete(key);
    });
}

const NET_TYPE_SHORT = { "13-BUS": "Trạm xe buýt", "10-PCCC": "Trụ sở PCCC", "11-NT": "Nhà tang lễ, nghĩa trang", "14-NOXH": "Nhà ở xã hội" };

function networkSubRows(sectionId, items, gapMap = null, withType = false) {
  const rows = items.map(it => {
    const gap = gapMap && gapMap.get(it.id);
    const gapBadge = gap
      ? ` <span class="min-size-warn" title="Khoảng cách tới trạm gần nhất (bỏ qua trạm cách < 100 m: cặp trạm 2 chiều đường)">${ico('alert')}${gap.nearestM == null ? 'không có trạm kế cận' : `cách trạm gần nhất ${fmtNum(gap.nearestM)} m`}</span>`
      : '';
    const note = withType ? NET_TYPE_SHORT[it.type] : it.ntKind ? NT_KIND_LABELS[it.ntKind] : '';
    return `<tr class="wt-sub">
      <td>-</td>
      <td>${zoomLinkHtml(it)}${note ? ` <span class="wt-light">(${escapeHtml(note)})</span>` : ''}${gapBadge}</td>
      <td>${Number(it.size) > 0 ? `${fmtNum(it.size)} m²` : '-'}</td>
      <td>-</td><td>-</td><td>-</td><td>-</td>
      <td class="wt-radius">${Number(it.radius) > 0 ? `${fmtNum(it.radius)} m` : '-'}</td>
    </tr>`;
  }).join('');
  return `</tbody><tbody id="${sectionId}" style="display:none;">${rows}</tbody><tbody>`;
}

function networkSectionHtml(wardData) {
  const head = `<tr class="wt-section wt-f"><td>F</td><td colspan="7">MẠNG LƯỚI HẠ TẦNG KHÁC <span class="wt-light">(không tính vào quy mô, độ phủ tổng hợp)</span></td></tr>`;
  const net = wardData.network;
  if (!net) return head + `<tr class="wt-empty"><td>-</td><td colspan="7">Máy chủ chưa trả dữ liệu mạng lưới (tải lại trang).</td></tr>`;
  const ward = wardData.Ten_Phuong;
  const tog = (id, list) => (list.length ? toggleBtnHtml(id) : '');
  const covCell = (key) => `<td class="net-cov" data-key="${key}">${netCovCellHtml(ward, key)}</td>`;
  let html = head;

  const gapMap = new Map((net.busGaps || []).map(g => [g.id, g]));
  const gapNote = !net.busGapCheck
    ? '<span class="c-muted" title="Khoảng cách giữa các trạm ≤ 600 m chỉ áp dụng khu trung tâm đô thị">khoảng cách trạm: không xét (xã)</span>'
    : !net.bus.length ? '' : gapMap.size
      ? `<b class="c-red" title="Trạm cách trạm kế cận > 600 m (Mục 2.8.3.3)">${gapMap.size} trạm cách &gt; 600 m</b>`
      : '<b class="c-green">khoảng cách trạm ≤ 600 m</b>';
  html += `<tr class="wt-main">
    <td>1</td>
    <td title="QCVN 01:2026/BXD Mục 2.8.3.3: cự ly đi bộ tới trạm ≤ 500 m; khu trung tâm khoảng cách trạm ≤ 600 m">Trạm dừng xe buýt ${tog('net_sub_bus', net.bus)}</td>
    <td>-</td>
    <td colspan="2">≤ 500 m đi bộ${gapNote ? `<br>${gapNote}` : ''}</td>
    <td>${net.bus.length} trạm</td>
    <td>-</td>
    ${covCell('bus')}
  </tr>`;
  if (net.bus.length) html += networkSubRows('net_sub_bus', net.bus, gapMap);

  const pcccKm = QUOTA_FORMAT.format((Number(net.pcccRadius) || 0) / 1000);
  html += `<tr class="wt-main">
    <td>2</td>
    <td title="QCVN 01:2026/BXD Mục 2.5.13.1: bán kính phục vụ ≤ 3 km khu trung tâm, ≤ 5 km khu vực khác">Trụ sở cảnh sát PCCC ${tog('net_sub_pccc', net.pccc)}</td>
    <td>-</td>
    <td colspan="2">bán kính ≤ ${pcccKm} km</td>
    <td>${net.pccc.length} trụ sở</td>
    <td>-</td>
    ${covCell('pccc')}
  </tr>`;
  if (net.pccc.length) html += networkSubRows('net_sub_pccc', net.pccc);

  const cemArea = net.nt.filter(it => String(it.ntKind || '').startsWith('cemetery')).reduce((s, it) => s + (Number(it.size) || 0), 0);
  const funerals = net.nt.filter(it => it.ntKind === 'funeral').length;
  html += `<tr class="wt-main">
    <td>3</td>
    <td title="Vùng đệm = khoảng cách an toàn tới khu dân cư (Bảng 23): hung táng 1.000 m, chôn cất một lần 500 m, cát táng 100 m, hỏa táng 500 m">Nhà tang lễ, nghĩa trang ${tog('net_sub_nt', net.nt)}</td>
    <td>${fmtNum(cemArea)} m²</td>
    <td colspan="2">Bảng 23 <span class="wt-light">(dân trong vùng cách ly)</span></td>
    <td>${net.nt.length} cơ sở${funerals ? `<br><span class="wt-light">${funerals} nhà tang lễ</span>` : ''}</td>
    <td>-</td>
    ${covCell('nt')}
  </tr>`;
  if (net.nt.length) html += networkSubRows('net_sub_nt', net.nt);

  const city = state.cityNetwork && state.cityNetwork.HT;
  if (city) {
    const funeralOk = city.funeralCount >= city.funeralRequired;
    const noAreaNote = city.cemeteryNoArea ? `<br><span class="wt-light">${city.cemeteryNoArea} nghĩa trang chưa có diện tích</span>` : '';
    html += `<tr class="wt-comp">
      <td>3.1</td>
      <td title="Mục 2.12.1.1: mỗi nhà tang lễ phục vụ ≤ 250.000 người; Mục 2.12.2.1: đất nghĩa trang ≥ 0,04 ha/1.000 người — tính chung toàn thành phố theo dân số QH ${fmtNum(city.pop)} người">Chỉ tiêu toàn thành phố</td>
      <td>${fmtNum(city.cemeteryArea)} m²${noAreaNote}</td>
      <td colspan="2">nghĩa trang ≥ 0,4 m²/người<br>→ ${fmtNum(city.cemeteryRequired)} m²</td>
      <td><b class="${funeralOk ? 'c-green' : 'c-red'}" title="1 nhà tang lễ / 250.000 người">${city.funeralCount}/${city.funeralRequired} nhà tang lễ</b></td>
      <td>${scaleCellHtml(city.cemeteryArea, city.cemeteryRequired)}</td>
      <td>-</td>
    </tr>`;
  }

  if ((net.pending || []).length) {
    html += `<tr class="wt-comp">
      <td>4</td>
      <td>Điểm mạng lưới chờ duyệt ${toggleBtnHtml('net_sub_pending')}</td>
      <td>-</td>
      <td colspan="5" class="wt-note">${net.pending.length} điểm (người dùng đề xuất hoặc nhập từ OpenStreetMap) — mở điểm trên bản đồ để phê duyệt</td>
    </tr>`;
    html += networkSubRows('net_sub_pending', net.pending, null, true);
  }
  return html;
}

// ================== BIỂU ĐỒ ĐỘ PHỦ & QUY MÔ 40 PHƯỜNG ==================
// Nhãn xoay 45° bị Chart.js giới hạn chiều cao trục X: tên ghép dài (vd "Chân Mây - Lăng Cô") viết tắt vế sau, tooltip vẫn hiện đủ
function shortWardTick(name) {
  if (name.length <= 13) return name;
  const parts = name.split(/\s*-\s*/);
  if (parts.length < 2) return name;
  const tail = parts.pop().split(' ');
  const last = tail.pop();
  return `${parts.join('-')}-${tail.map(w => w[0] + '.').join('')}${last}`;
}

function renderCombinedChart(animate = true) {
  const wards = state.wardStatsData;
  drawCoverageScaleChart(
    wards.map(w => w.Ten_Phuong.replace('Phường ', '').replace('Xã ', '')),
    { ht: wards.map(w => Number(w.Avg_Coverage_Score || 0)), qh: wards.map(planCoverageOf) },
    { ht: wards.map(w => Number(w.Avg_Scale_Score || 0)), qh: wards.map(planScaleOf) },
    animate
  );
}

// Mỗi chỉ số là 1 cột xếp chồng: phần chung = min(HT, QH); QH tăng thêm đoạn xanh lá phía trên,
// QH giảm thì đoạn đỏ là phần mất đi từ mức QH lên tới mức HT
function planStackDatasets(label, stack, color, series) {
  const common = { stack, barPercentage: 0.9, categoryPercentage: 0.8, series };
  return [
    { ...common, label, data: series.ht.map((v, i) => Math.min(v, series.qh[i])), backgroundColor: color },
    { ...common, label: `${label} – QH tăng`, data: series.ht.map((v, i) => Math.max(0, series.qh[i] - v)), backgroundColor: CHART_PLAN_UP_COLOR },
    { ...common, label: `${label} – QH giảm`, data: series.ht.map((v, i) => Math.max(0, v - series.qh[i])), backgroundColor: CHART_PLAN_DOWN_COLOR }
  ];
}

function drawCoverageScaleChart(labels, coverage, scale, animate = true) {
  const chartEl = document.getElementById('infraChart');
  if (!chartEl || typeof Chart === 'undefined') return;
  const datasets = [
    ...planStackDatasets('Độ phủ', 'cov', CHART_COVERAGE_COLOR, coverage),
    ...planStackDatasets('Quy mô', 'scale', CHART_SCALE_COLOR, scale)
  ];

  const k = screenScale();
  const tickSize = 10.5 * k;
  const yTickSize = 12 * k;

  // Cập nhật dữ liệu tại chỗ (độ phủ về dần từng phường) thay vì hủy/tạo lại chart
  if (chartInstance && chartInstance.canvas === chartEl) {
    chartInstance.options.scales.x.ticks.font.size = tickSize;
    chartInstance.options.scales.y.ticks.font.size = yTickSize;
    chartInstance.data.labels = labels;
    chartInstance.data.datasets.forEach((ds, i) => {
      ds.data = datasets[i].data;
      ds.series = datasets[i].series;
    });
    chartInstance.update(animate ? undefined : 'none');
    return;
  }

  chartInstance = new Chart(chartEl.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 16 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          filter: item => item.datasetIndex % 3 === 0,
          callbacks: {
            label: item => {
              const s = item.dataset.series;
              return ` ${item.dataset.label}: HT ${fmtPct(s.ht[item.dataIndex])} → QH ${fmtPct(s.qh[item.dataIndex])}`;
            }
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          ticks: {
            autoSkip: false,
            minRotation: 45,
            maxRotation: 45,
            callback: function(value) { return shortWardTick(this.getLabelForValue(value)); },
            color: getComputedStyle(document.documentElement).getPropertyValue('--text-main').trim() || '#cbd5e1',
            font: { size: tickSize, family: getComputedStyle(document.body).fontFamily }
          },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          max: 100,
          ticks: { color: '#94a3b8', font: { size: yTickSize } },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
}
