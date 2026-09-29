import { state } from './state.js';
import { map, renderGroupedPoints, focusWard, zoomToPoint } from './mapEngine.js';
import { geeApi } from './api.js';
import { escapeHtml, isApproved, fmtNum, fmtPct, loadHtml2Pdf, loadHtml2Canvas, showToast } from './utils.js';

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
  msg.textContent = text;
}

function showGoogleOriginHint() {
  setAuthMsg(`Origin ${window.location.origin} chưa được Google cho phép. Thêm origin này vào Authorized JavaScript origins của Client ID, hoặc chạy npx vercel dev (localhost) thay vì Live Server.`, 'var(--accent-orange)');
}

export function initGoogleSignIn() {
  const container = document.getElementById('googleSignInBtn');
  if (!container || googleSignInReady) return;

  const tryInit = (attempt = 0) => {
    if (!window.google?.accounts?.id) {
      if (attempt < 40) setTimeout(() => tryInit(attempt + 1), 150);
      else showGoogleOriginHint();
      return;
    }
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

const AUTH_ICON_DEFAULT = '🔑';
const AUTH_ICON_ADMIN = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent-orange);" aria-hidden="true">
  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;

function updateAuthUi() {
  const isAdmin = state.currentUserRole === 'ADMIN' && !!state.authUser;
  const btnAuth = document.getElementById('btnAuth');
  if (btnAuth) {
    btnAuth.style.borderColor = isAdmin ? 'var(--accent-orange)' : '';
    btnAuth.title = isAdmin ? `Đã đăng nhập: Admin (${state.authUser.name})` : 'Đăng nhập quản trị';
    btnAuth.setAttribute('aria-label', btnAuth.title);
    btnAuth.innerHTML = isAdmin ? AUTH_ICON_ADMIN : AUTH_ICON_DEFAULT;
  }
  const signOut = document.getElementById('btnSignOut');
  if (signOut) signOut.style.display = isAdmin ? '' : 'none';
  const gBtn = document.getElementById('googleSignInBtn');
  if (gBtn) gBtn.style.display = isAdmin ? 'none' : '';
}

// ================== BIỂU ĐỒ DONUT CƠ CẤU DIỆN TÍCH ==================
function sumAreaByType(list) {
  const totals = {};
  let sum = 0;
  (list || []).forEach(item => {
    if (!isApproved(item.status) && item.type !== "9-CSD") return;
    const type = item.type || 'Khác';
    const size = Number(item.size || 0);
    // Diện tích = 0 vẫn tính 1 đơn vị để donut không trống
    const weight = size > 0 ? size : 1;
    totals[type] = (totals[type] || 0) + weight;
    sum += weight;
  });
  return { totals, sum };
}

const PIE_COLORS = {
  "1-CV": "#2ecc71", "2-BDX": "#3498db", "3-MN": "#e67e22", "4-TH": "#e74c3c",
  "5-THCS": "#9b59b6", "6-YT": "#1abc9c", "7-VH": "#f1c40f", "8-TM": "#e91e63", "9-CSD": "#95a5a6"
};
const PIE_LABELS = {
  "1-CV": "Công viên", "2-BDX": "Bãi đỗ xe", "3-MN": "Mầm non", "4-TH": "Tiểu học", "5-THCS": "THCS",
  "6-YT": "Y tế", "7-VH": "Văn hóa", "8-TM": "Chợ/TTTM", "9-CSD": "Chưa sử dụng", "empty": "Chưa có DL"
};

// ================== MẶT SAU THẺ LẬT: THỐNG KÊ SỐ LƯỢNG 9 LOẠI ==================
const COUNT_CARD_LABELS = {
  "1-CV": "Công viên", "2-BDX": "Bãi đỗ xe", "3-MN": "Mầm non", "4-TH": "Tiểu học", "5-THCS": "THCS",
  "6-YT": "Y tế", "7-VH": "Văn hóa", "8-TM": "Chợ, TTTM", "9-CSD": "Chưa sử dụng"
};
// Biểu tượng nét (viewBox 24×24, stroke = màu loại)
const COUNT_CARD_ICONS = {
  "1-CV": '<path d="M12 3l5 7h-3l4 6H6l4-6H7z"/><path d="M12 16v5"/>',
  "2-BDX": '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 17V7h3.2a3 3 0 010 6H10"/>',
  "3-MN": '<rect x="4" y="12" width="7" height="7" rx="1"/><rect x="13" y="12" width="7" height="7" rx="1"/><rect x="8.5" y="4" width="7" height="7" rx="1"/>',
  "4-TH": '<path d="M3 10l9-5 9 5"/><path d="M5 10v9h14v-9"/><path d="M10 19v-5h4v5"/>',
  "5-THCS": '<path d="M4 5h5a3 3 0 013 3v12a2 2 0 00-2-2H4z"/><path d="M20 5h-5a3 3 0 00-3 3v12a2 2 0 012-2h6z"/>',
  "6-YT": '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  "7-VH": '<path d="M3 9l9-5 9 5"/><path d="M5 9v9M9.5 9v9M14.5 9v9M19 9v9"/><path d="M3 20h18"/>',
  "8-TM": '<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2l2.5 11h11l2-8H6.5"/>',
  "9-CSD": '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2.2"/><path d="M12 9v6M9 12h6"/>'
};

// Hiện trạng: số đã duyệt (cơ sở chưa sử dụng: mọi khu đất, như donut) + số chờ duyệt; quy hoạch: số đã duyệt
function countByType(sourceList, planList) {
  const stats = {};
  Object.keys(COUNT_CARD_LABELS).forEach(k => { stats[k] = { approved: 0, pending: 0, plan: 0 }; });
  (sourceList || []).forEach(it => {
    const s = stats[it.type];
    if (!s) return;
    if (isApproved(it.status)) s.approved++;
    else s.pending++;
  });
  (planList || []).forEach(it => {
    const s = stats[it.type];
    if (s && (isApproved(it.status) || it.type === "9-CSD")) s.plan++;
  });
  return stats;
}

function renderInfraCountCards(sourceList, planList) {
  const grid = document.getElementById('infraCountGrid');
  if (!grid) return;
  const stats = countByType(sourceList, planList);
  grid.innerHTML = Object.keys(COUNT_CARD_LABELS).map(k => {
    const s = stats[k];
    const color = PIE_COLORS[k];
    const isCsd = k === "9-CSD";
    const shown = isCsd ? s.approved + s.pending : s.approved;
    const total = s.approved + s.pending;
    const approvedPct = total > 0 ? (s.approved / total) * 100 : 0;
    const delta = s.plan - shown;
    const planTag = delta === 0 ? '' :
      `<span class="count-plan ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'}${fmtNum(Math.abs(delta))}</span>`;
    const tip = `${COUNT_CARD_LABELS[k]}\nĐã duyệt: ${fmtNum(s.approved)} · Chờ duyệt: ${fmtNum(s.pending)}\nQuy hoạch: ${fmtNum(s.plan)} (chênh ${delta > 0 ? '+' : ''}${fmtNum(delta)})`;
    return `<div class="count-card" style="--c:${color}" title="${escapeHtml(tip)}">
      <span class="count-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${COUNT_CARD_ICONS[k]}</svg></span>
      <div class="count-info">
        <span class="count-label">${COUNT_CARD_LABELS[k]}</span>
        <div class="count-mid"><b class="count-num">${fmtNum(shown)}</b>${planTag}</div>
        <div class="count-foot"><span class="count-bar"><i style="width:${approvedPct.toFixed(1)}%"></i></span><span class="count-pct">${fmtPct(approvedPct)}</span></div>
      </div>
    </div>`;
  }).join('');
}

function setPart1Flipped(flipped) {
  const card = document.getElementById('part1Flip');
  if (!card) return;
  card.classList.toggle('flipped', flipped);
  card.querySelector('.flip-front')?.setAttribute('aria-hidden', String(flipped));
  card.querySelector('.flip-back')?.setAttribute('aria-hidden', String(!flipped));
  const title = document.getElementById('bpPart1Title');
  if (title) title.textContent = flipped ? 'SỐ LƯỢNG CÔNG TRÌNH' : 'CƠ CẤU ĐẤT HẠ TẦNG';
  const btn = document.getElementById('btnFlipPart1');
  if (btn) {
    btn.textContent = flipped ? '⟳ Diện tích' : '⟳ Số lượng';
    btn.title = flipped ? 'Lật trang: cơ cấu theo diện tích' : 'Lật trang: thống kê số lượng công trình';
    btn.setAttribute('aria-pressed', String(flipped));
  }
  document.querySelectorAll('.flip-dots i').forEach((dot, i) => dot.classList.toggle('active', i === (flipped ? 1 : 0)));
}

function initPart1Flip() {
  document.getElementById('btnFlipPart1')?.addEventListener('click', () => {
    setPart1Flipped(!document.getElementById('part1Flip').classList.contains('flipped'));
  });
}

// Donut 2 vòng đồng tâm: trong = hiện trạng (sourceList), ngoài = quy hoạch (planList)
export function updateInfraPieChart(sourceList, planList = []) {
  renderInfraCountCards(sourceList, planList);
  const legendContainer = document.getElementById('pieLegendDetails');
  const ht = sumAreaByType(sourceList);
  const qh = sumAreaByType(planList);

  const keys = Object.keys(PIE_LABELS).filter(k => ht.totals[k] || qh.totals[k]);
  const isEmpty = keys.length === 0;
  if (isEmpty) keys.push('empty');
  const htVals = keys.map(k => isEmpty ? 1 : (ht.totals[k] || 0));
  const qhVals = keys.map(k => isEmpty ? 1 : (qh.totals[k] || 0));
  const htPct = keys.map((k, i) => ht.sum > 0 ? (htVals[i] / ht.sum) * 100 : 0);
  const qhPct = keys.map((k, i) => qh.sum > 0 ? (qhVals[i] / qh.sum) * 100 : 0);
  const bgColors = keys.map(k => PIE_COLORS[k] || '#38bdf8');
  const labels = keys.map(k => PIE_LABELS[k] || k);

  if (legendContainer) {
    legendContainer.innerHTML = `<div class="pie-legend-row pie-legend-head"><span>Ký hiệu</span><span>H.Trạng</span><span>QH</span></div>`
      + keys.map((k, idx) => {
        const delta = qhPct[idx] - htPct[idx];
        const qhColor = delta >= 0.1 ? 'var(--accent-green)' : (delta <= -0.1 ? 'var(--accent-red)' : 'var(--accent-cyan)');
        return `<div class="pie-legend-row">
          <span class="pie-legend-name">
            <span style="width:8px; height:8px; background:${bgColors[idx]}; border-radius:50%; display:inline-block; flex-shrink:0;"></span>
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(labels[idx])}</span>
          </span>
          <b style="color:var(--accent-cyan);">${fmtPct(htPct[idx])}</b>
          <b style="color:${qhColor};">${fmtPct(qhPct[idx])}</b>
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

const COVERAGE_CODES = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];
const CHART_COVERAGE_COLOR = '#38bdf8';
const CHART_SCALE_COLOR = '#f59e0b';
const CHART_PLAN_UP_COLOR = '#22c55e';
const CHART_PLAN_DOWN_COLOR = '#ef4444';
const COVERAGE_LEVEL_KEYS = [
  ...COVERAGE_CODES,
  "1-CV_DT", "1-CV_DV", "2-BDX_DT", "2-BDX_DV",
  "6-YT_DT", "6-YT_DV", "7-VH_DT", "7-VH_DV", "8-TM_DT", "8-TM_DV",
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

/**
 * Tính độ phủ nền: dân số lớn → nhỏ; hiện trạng trước, quy hoạch sau (chỉ phường có công trình mới/di dời).
 */
export async function startBackgroundCoverageFill() {
  const list = state.wardStatsData;
  if (!list.length || coverageFillList === list) return;
  coverageFillList = list;
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
const PENDING_CELL = '<span class="cov-pending" title="Đang tính độ phủ">⏳</span>';

function wardRowHtml(w, idx) {
  const ready = !!w._coverageReady;
  const cells = COVERAGE_CODES.map(c => {
    const cov = ready ? fmtPct(w[`Ratio_${c}`]) : PENDING_CELL;
    return `<td class="cov-cell" data-code="${c}" style="color:var(--accent-green);">${cov}</td><td style="color:var(--accent-orange); font-weight:bold;">${fmtPct(w[`Scale_${c}`])}</td>`;
  }).join('');
  const name = escapeHtml(w.Ten_Phuong);
  return `<tr data-ward-row="${name}">
    <td>${idx + 1}</td>
    <td style="text-align:left;">
      <button type="button" class="ward-link link-btn" data-ward="${name}" style="font-weight:bold; color:var(--accent-cyan);">📍 ${name}</button>
    </td>
    <td style="font-weight:bold; color:var(--accent-green); text-align:right;">${fmtNum(w.Dan_So_Vector)}</td>
    ${cells}
    <td class="cov-avg" style="font-weight:bold; color:var(--accent-green); background:rgba(56,189,248,0.05);">${ready ? fmtPct(w.Avg_Coverage_Score) : PENDING_CELL}</td>
    <td style="font-weight:bold; color:var(--accent-orange); background:rgba(245,158,11,0.05);">${fmtPct(w.Avg_Scale_Score)}</td>
  </tr>`;
}

function rebuildCombinedTableBody() {
  const tbody = document.getElementById('statTableBody');
  if (!tbody) return;
  tbody.innerHTML = state.wardStatsData.map(wardRowHtml).join('');
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
  COVERAGE_CODES.forEach(c => {
    const cell = tr.querySelector(`.cov-cell[data-code="${c}"]`);
    if (cell) cell.textContent = fmtPct(ward[`Ratio_${c}`]);
  });
  const avgCell = tr.querySelector('.cov-avg');
  if (avgCell) avgCell.textContent = fmtPct(ward.Avg_Coverage_Score);
}

// ================== PANEL THỐNG KÊ DƯỚI ==================
const CITY_NAME = "Thành phố Huế";
let wardStatsPromise = null;
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
  if (maximized) setPart1Flipped(false);
  const btn = document.getElementById('btnToggleBottomMax');
  if (btn) {
    btn.textContent = maximized ? '🗗' : '⛶';
    btn.title = maximized ? 'Thu về 1/5 màn hình' : 'Phóng to toàn màn hình';
  }
  setBottomPanelHeader(isCityMode() ? CITY_NAME : state.selectedWard);
}

export function toggleBottomPanelMaximized() {
  setBottomPanelMaximized(!document.body.classList.contains('bottom-max'));
}

let cityTableOn = false;

export function toggleStatTable() {
  if (!isCityMode()) return;
  cityTableOn = !cityTableOn;
  setBottomPanelHeader(CITY_NAME);
}

function renderSummaryNote(wardName) {
  const subtitle = document.getElementById('bpSubtitle');
  if (!subtitle) return;
  const city = !wardName || wardName === CITY_NAME;
  const list = city ? state.wardStatsData : state.wardStatsData.filter(w => w.Ten_Phuong === wardName);
  if (!list.length) {
    subtitle.innerHTML = '';
    return;
  }
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
  const qhValue = (ht, qh) => {
    const d = qh - ht;
    const color = d >= 0.05 ? CHART_PLAN_UP_COLOR : (d <= -0.05 ? CHART_PLAN_DOWN_COLOR : 'var(--text-main)');
    return ` → <b style="color:${color};" title="Theo quy hoạch">${fmtPct(qh)}</b>`;
  };
  const covText = readyCount === 0
    ? '<b title="Đang tính độ phủ">⏳</b>'
    : `<b title="Hiện trạng">${fmtPct(cov)}</b>${qhValue(cov, covQH)}`
      + (readyCount < list.length ? ` <span style="color:var(--text-muted);">(đã tính ${readyCount}/${list.length})</span>` : '');
  const units = list.length === 1
    ? ` (${list[0].currentUnits || Math.max(1, Math.round(pop / 20000))} đơn vị ở)`
    : '';
  const popLabel = city ? 'Tổng dân số' : '<span title="Dân số hiện trạng">Dân số HT</span>';
  subtitle.innerHTML = `👥 ${popLabel}: <b>${fmtNum(pop)}</b> người${units}`
    + ` · <span class="bp-swatch" style="background:${CHART_COVERAGE_COLOR};"></span>Độ phủ TB: ${covText}`
    + ` · <span class="bp-swatch" style="background:${CHART_SCALE_COLOR};"></span>Quy mô TB: <b title="Hiện trạng">${fmtPct(scale)}</b>${qhValue(scale, scaleQH)}`
    + ` · <span class="bp-swatch" style="background:${CHART_PLAN_UP_COLOR};"></span>QH tăng`
    + ` <span class="bp-swatch" style="background:${CHART_PLAN_DOWN_COLOR};"></span>QH giảm`;
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
  const planEl = document.getElementById('bpWardPlan');
  if (planEl) planEl.style.display = city ? 'none' : '';
  if (wardView) wardView.style.display = city ? 'none' : 'flex';
}

export async function renderBottomPanel() {
  const seq = ++bottomRenderSeq;
  const wardName = isCityMode() ? CITY_NAME : state.selectedWard;
  const city = wardName === CITY_NAME;
  const planEl = document.getElementById('bpWardPlan');
  if (planEl) planEl.innerHTML = '';
  setBottomPanelHeader(wardName);

  const tbody = document.getElementById('statTableBody');
  const wardView = document.getElementById('wardSummaryView');
  if (state.wardStatsData.length === 0) {
    if (city && tbody) {
      tbody.innerHTML = "<tr><td colspan='21' style='text-align:center; padding:20px;'>🔄 Đang tính toán ma trận quy chuẩn từ GEE...</td></tr>";
    }
    if (!city && wardView) {
      wardView.innerHTML = `<div class="rp-empty">⏳ Đang tổng hợp dữ liệu quy chuẩn cho ${escapeHtml(wardName)}...</div>`;
    }
  }

  try {
    await ensureWardStats();
  } catch (err) {
    if (seq !== bottomRenderSeq) return;
    const msg = `❌ ${escapeHtml(err.message || 'Lỗi nạp dữ liệu từ GEE Server.')}`;
    if (city && tbody) tbody.innerHTML = `<tr><td colspan='21' style='text-align:center; color:var(--accent-red); padding:20px;'>${msg}</td></tr>`;
    if (!city && wardView) wardView.innerHTML = `<div class="rp-empty" style="color:var(--accent-red);">${msg}</div>`;
    return;
  }
  if (seq !== bottomRenderSeq) return;
  setBottomPanelHeader(wardName);

  if (city) {
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

export async function exportBottomPanelPdf() {
  const body = document.getElementById('bpBody');
  if (!body) return;
  try {
    await loadHtml2Pdf();
  } catch (err) {
    showToast('❌ Không tải được thư viện xuất PDF, kiểm tra kết nối mạng.', 'error');
    return;
  }
  const fileName = isCityMode() ? 'Bao-Cao-Ha-Tang-TP-Hue.pdf' : `Bao-Cao-${state.selectedWard}.pdf`;
  body.classList.add('pdf-export');
  window.html2pdf().from(body).set({
    margin: 5,
    filename: fileName,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
  }).save().then(
    () => body.classList.remove('pdf-export'),
    () => body.classList.remove('pdf-export')
  );
}

// Chụp khung bản đồ (kể cả chế độ so sánh) thành ảnh PNG; lỗi thì quay về hộp thoại in của trình duyệt
export async function captureMapScreenshot() {
  const area = document.getElementById('mapArea');
  if (!area) return;
  try {
    await loadHtml2Canvas();
    showToast('⏳ Đang chụp ảnh bản đồ...');
    const canvas = await window.html2canvas(area, {
      useCORS: true,
      logging: false,
      backgroundColor: '#0f172a',
      ignoreElements: el => el.classList?.contains('map-toolbar') || el.classList?.contains('leaflet-control-zoom')
    });
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Không tạo được ảnh');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Ban-do-ha-tang-Hue-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('✓ Đã lưu ảnh bản đồ', 'success');
  } catch (err) {
    console.warn('Chụp ảnh bản đồ lỗi, chuyển sang in:', err);
    window.print();
  }
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
      if (!section) return;
      const opening = section.style.display === 'none';
      section.style.display = opening ? 'table-row-group' : 'none';
      toggle.textContent = opening ? '▲' : '▼';
      toggle.setAttribute('aria-expanded', String(opening));
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
  statusEl.textContent = text;
}

function refreshWardQuotaTable(wardData) {
  const card = document.getElementById('wardSummaryCard');
  if (!card || card.dataset.ward !== wardData.Ten_Phuong) return;
  const container = document.getElementById('wardQuotaTableContainer');
  if (container) container.innerHTML = buildWardQuotaTableHtml(wardData, wardData.projectedPopulation);
}

// Độ phủ phường đang xem: lỗi/timeout/0% bất thường → tự gọi lại sau 15s → 45s → 90s
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
      setTimeout(() => {
        if (state.selectedWard === name && isWardCurrent(wardData)) loadWardDetailCoverage(wardData, attempt + 1);
      }, wait);
    } else {
      setWardCoverageStatus(name, '⚠ Chưa tính được độ phủ, hệ thống sẽ tự cập nhật khi máy chủ rảnh', 'var(--accent-red)');
    }
  });
}

function renderWardSummary(wardData) {
  const popCurrent = wardData.Dan_So_Vector || 45000;
  if (!wardData.projectedPopulation) wardData.projectedPopulation = Math.round(popCurrent * 1.2);
  const popProjected = wardData.projectedPopulation;
  const projectedUnits = wardData.projectedUnits || Math.max(1, Math.round(popProjected / 20000));

  const view = document.getElementById('wardSummaryView');
  if (!view) return;
  view.innerHTML = `<div id="wardSummaryCard" style="display:contents;">
    <div id="wardQuotaTableContainer">${buildWardQuotaTableHtml(wardData, popProjected)}</div>
  </div>`;
  document.getElementById('wardSummaryCard').dataset.ward = wardData.Ten_Phuong;

  // Dân số hiện trạng / độ phủ / quy mô đã có ở #bpSubtitle, dòng tiêu đề chỉ bổ sung dân số quy hoạch
  const planEl = document.getElementById('bpWardPlan');
  if (planEl) {
    planEl.innerHTML = `· <label for="wardPopInput" title="Dân số quy hoạch">Dân số QH</label>:
      <input type="number" id="wardPopInput" value="${Number(popProjected)}" step="1000" min="1000" max="2000000" />
      người (<span id="projectedUnitsLabel">${projectedUnits}</span> đơn vị ở)
      <span id="wardCoverageStatus"></span>`;
  }

  const popInput = document.getElementById('wardPopInput');
  if (popInput) {
    popInput.oninput = (e) => {
      const raw = Number(e.target.value);
      const newProjPop = Number.isFinite(raw) && raw >= 1000 ? Math.min(raw, 2000000) : popProjected;
      const newUnits = Math.max(1, Math.round(newProjPop / 20000));
      const unitsLabel = document.getElementById('projectedUnitsLabel');
      if (unitsLabel) unitsLabel.textContent = newUnits;
      wardData.projectedPopulation = newProjPop;
      wardData.projectedUnits = newUnits;
      [wardData.urbanResults, wardData.unitResults].forEach(group => {
        Object.values(group || {}).forEach(node => { node.requiredArea = (node.quota || 0) * newProjPop; });
      });
      refreshWardQuotaTable(wardData);
    };
  }

  loadWardDetailCoverage(wardData);
}

const DEFAULT_QUOTA = {
  "3-MN": 0.60, "4-TH": 0.65, "5-THCS": 0.55, "CV_DV": 2.00, "BDX_DV": 2.50, "DVCC_TOTAL": 2.00
};

function zoomLinkHtml(item, fallbackName = 'Công trình') {
  const name = escapeHtml(item.name || fallbackName);
  const lat = Number(item.lat), lng = Number(item.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return `<span>${name}</span>`;
  return `<button type="button" class="link-btn" data-action="zoom" data-lat="${lat}" data-lng="${lng}" data-name="${name}" style="color:var(--accent-cyan);">${name}</button>`;
}

function toggleBtnHtml(sectionId) {
  return `<button type="button" class="sub-toggle" data-action="toggle" data-target="${sectionId}" aria-expanded="false" aria-label="Hiện/ẩn danh sách công trình">▼</button>`;
}

function scaleCellHtml(currentArea, reqArea) {
  const pct = reqArea > 0 ? Math.min(100, Math.round((currentArea / reqArea) * 100)) : 100;
  return `<span style="color:${pct >= 100 ? 'var(--accent-green)' : 'var(--accent-red)'}; font-weight:bold;">Đạt ${pct}%</span>`;
}

function coverageCellHtml(wardData, code) {
  const pct = getCoveragePct(wardData, code);
  if (pct == null) return PENDING_CELL;
  return `<span style="color:${pct >= 100 ? 'var(--accent-green)' : 'var(--accent-orange)'}; font-weight:bold;">${fmtPct(pct)}</span>`;
}

function countCellHtml(count, totalUnits) {
  return `<span style="color:${count >= totalUnits ? 'var(--accent-green)' : 'var(--accent-red)'}; font-weight:bold;">${count}/${totalUnits} cơ sở</span>`;
}

function buildWardQuotaTableHtml(wardData, projPop) {
  const urbanRes = wardData.urbanResults || {};
  const unitRes = wardData.unitResults || {};
  const totalUnits = wardData.projectedUnits || Math.max(1, Math.round(projPop / 20000));
  const parts = [];

  const subItemRows = (sectionId, subItems, padLeft = 14) => {
    parts.push(`<tbody id="${sectionId}" style="display:none;">`);
    subItems.forEach(sub => {
      const radiusVal = Number(sub.radius || sub.banKinh || 0);
      parts.push(`<tr style="color:var(--text-muted); font-size:9.5px;">
        <td style="text-align:center;">-</td>
        <td style="text-align:left; padding-left:${padLeft}px;">${zoomLinkHtml(sub)}</td>
        <td style="text-align:right;">${fmtNum(sub.size)} m²</td>
        <td style="text-align:center;">-</td>
        <td style="text-align:right;">-</td>
        <td style="text-align:center;">-</td>
        <td style="text-align:center;">-</td>
        <td style="text-align:center; color:var(--accent-cyan); font-weight:bold;">${radiusVal > 0 ? `${fmtNum(radiusVal)} m` : '-'}</td>
      </tr>`);
    });
    parts.push(`</tbody>`);
  };

  const sectionHeader = (letter, color, bg, title) => parts.push(`<tr style="background:${bg}; font-weight:bold;">
    <td style="text-align:center; color:${color};">${letter}</td>
    <td colspan="7" style="color:${color}; text-align:left; padding-left:8px;">${title}</td>
  </tr>`);

  // Dòng 1 nhóm chỉ tiêu có diện tích, nhu cầu, quy mô, độ phủ
  const quotaRow = ({ stt, label, node, quota, code, sectionId, showCount }) => {
    const currentArea = node ? Number(node.currentArea || 0) : 0;
    const subItems = (node && node.subItems) || [];
    const reqArea = Math.round(quota * projPop);
    const countHtml = showCount ? countCellHtml(subItems.length, totalUnits) : `${subItems.length} cơ sở`;
    parts.push(`<tr>
      <td style="text-align:center; font-weight:bold;">${stt}</td>
      <td style="text-align:left; font-weight:bold;">${escapeHtml(label)} ${subItems.length ? toggleBtnHtml(sectionId) : ''}</td>
      <td style="text-align:right; font-weight:bold;">${fmtNum(currentArea)} m²</td>
      <td style="text-align:center;">≥ ${fmtNum(quota)}</td>
      <td style="text-align:right; color:var(--accent-cyan);">${fmtNum(reqArea)} m²</td>
      <td style="text-align:center;">${countHtml}</td>
      <td style="text-align:center;">${scaleCellHtml(currentArea, reqArea)}</td>
      <td style="text-align:center;">${coverageCellHtml(wardData, code)}</td>
    </tr>`);
    if (subItems.length) subItemRows(sectionId, subItems, 14);
  };

  parts.push(`<div class="ward-table-scroll-container"><table class="ward-table" style="font-size:9.5px;">
    <thead>
      <tr>
        <th style="width:5%; text-align:center;">STT</th>
        <th style="width:31%;">Loại hạ tầng</th>
        <th style="width:12%;">Diện tích</th>
        <th style="width:8%;">Chỉ tiêu</th>
        <th style="width:11%;">Nhu cầu DT</th>
        <th style="width:9%; text-align:center;">Số lượng</th>
        <th style="width:12%; text-align:center;">Quy mô</th>
        <th style="width:12%; text-align:center;">Độ phủ</th>
      </tr>
    </thead>
    <tbody>`);

  // A / CÔNG TRÌNH HẠ TẦNG CẤP ĐÔ THỊ
  sectionHeader('A', 'var(--accent-cyan)', 'rgba(56, 189, 248, 0.18)', 'CÔNG TRÌNH HẠ TẦNG CẤP ĐÔ THỊ');
  const urbanCodes = { THPT: 'THPT', YT_DT: '6-YT_DT', VH_DT: '7-VH_DT', TM_DT: '8-TM_DT', CV_DT: '1-CV_DT', BDX_DT: '2-BDX_DT' };
  let urbanIdx = 1;
  Object.keys(urbanCodes).forEach(key => {
    const node = urbanRes[key];
    if (!node) return;
    quotaRow({ stt: urbanIdx++, label: node.label, node, quota: Number(node.quota || 0), code: urbanCodes[key], sectionId: `urban_sub_${key}`, showCount: false });
  });

  // B / CÔNG TRÌNH HẠ TẦNG CẤP ĐƠN VỊ Ở
  sectionHeader('B', 'var(--accent-green)', 'rgba(74, 222, 128, 0.18)', `CÔNG TRÌNH HẠ TẦNG CẤP ĐƠN VỊ Ở (Quy hoạch: ${totalUnits} đơn vị ở)`);
  const unitSchools = [
    { key: "3-MN", label: "Trường Mầm non" },
    { key: "4-TH", label: "Trường Tiểu học" },
    { key: "5-THCS", label: "Trường THCS" }
  ];
  let unitIdx = 1;
  unitSchools.forEach(item => {
    const node = unitRes[item.key];
    quotaRow({ stt: unitIdx++, label: item.label, node, quota: Number(node?.quota ?? DEFAULT_QUOTA[item.key]), code: item.key, sectionId: `unit_sub_${item.key}`, showCount: true });
  });

  // Mục 4: Đất dịch vụ công cộng đơn vị ở (tổng Y tế + Văn hóa + Chợ)
  const dvccKeys = [
    { key: "YT_DV", label: "Y tế đơn vị ở", code: "6-YT_DV", stt: "4.1" },
    { key: "VH_DV", label: "Văn hóa thể thao đơn vị ở", code: "7-VH_DV", stt: "4.2" },
    { key: "TM_DV", label: "Chợ - TMDV đơn vị ở", code: "8-TM_DV", stt: "4.3" }
  ];
  const dvccQuota = Number(unitRes.DVCC_TOTAL?.quota ?? DEFAULT_QUOTA.DVCC_TOTAL);
  const dvccArea = dvccKeys.reduce((s, c) => s + Number(unitRes[c.key]?.currentArea || 0), 0);
  const dvccCount = dvccKeys.reduce((s, c) => s + (unitRes[c.key]?.subItems?.length || 0), 0);
  const dvccReq = Math.round(dvccQuota * projPop);
  parts.push(`<tr>
    <td style="text-align:center; font-weight:bold;">${unitIdx}</td>
    <td style="text-align:left; font-weight:bold; color:var(--text-main);">Đất dịch vụ công cộng đơn vị ở</td>
    <td style="text-align:right; font-weight:bold;">${fmtNum(dvccArea)} m²</td>
    <td style="text-align:center;">≥ ${fmtNum(dvccQuota)}</td>
    <td style="text-align:right; color:var(--accent-cyan);">${fmtNum(dvccReq)} m²</td>
    <td style="text-align:center;">${countCellHtml(dvccCount, totalUnits)}</td>
    <td style="text-align:center;">${scaleCellHtml(dvccArea, dvccReq)}</td>
    <td style="text-align:center;">-</td>
  </tr>`);

  dvccKeys.forEach(comp => {
    const node = unitRes[comp.key];
    const subItems = (node && node.subItems) || [];
    const sectionId = `comp_sub_${comp.key}`;
    parts.push(`<tr>
      <td style="text-align:center; font-weight:600; font-size:9px;">${comp.stt}</td>
      <td style="text-align:left; padding-left:14px; font-weight:500;">${comp.label} ${subItems.length ? toggleBtnHtml(sectionId) : ''}</td>
      <td style="text-align:right;">${fmtNum(node ? node.currentArea : 0)} m²</td>
      <td style="text-align:center;">-</td>
      <td style="text-align:right;">-</td>
      <td style="text-align:center;">${countCellHtml(subItems.length, totalUnits)}</td>
      <td style="text-align:center;">-</td>
      <td style="text-align:center;">${coverageCellHtml(wardData, comp.code)}</td>
    </tr>`);
    if (subItems.length) subItemRows(sectionId, subItems, 24);
  });

  unitIdx++;
  [
    { key: "CV_DV", label: "Công viên đơn vị ở", code: "1-CV_DV" },
    { key: "BDX_DV", label: "Bãi đỗ xe đơn vị ở", code: "2-BDX_DV" }
  ].forEach(item => {
    const node = unitRes[item.key];
    quotaRow({ stt: unitIdx++, label: item.label, node, quota: Number(node?.quota ?? DEFAULT_QUOTA[item.key]), code: item.code, sectionId: `unit_sub_${item.key}`, showCount: true });
  });

  // C / CÔNG TRÌNH CHƯA DUYỆT (QUY HOẠCH) — nhóm 1–8, TrangThai = FALSE
  sectionHeader('C', 'var(--accent-red)', 'rgba(248, 113, 113, 0.18)', 'CÔNG TRÌNH CHƯA DUYỆT (QUY HOẠCH)');
  const pendingList = wardData.pendingItems || [];
  if (pendingList.length > 0) {
    pendingList.forEach((pItem, pIdx) => {
      const typeNote = pItem.typeLabel ? ` <span style="color:var(--text-muted); font-weight:normal;">(${escapeHtml(pItem.typeLabel)})</span>` : '';
      parts.push(`<tr style="color:var(--text-main); font-size:9.5px;">
        <td style="text-align:center; font-weight:bold;">${pIdx + 1}</td>
        <td style="text-align:left; padding-left:6px; font-weight:bold;">${zoomLinkHtml(pItem)}${typeNote}</td>
        <td style="text-align:right; font-weight:bold;">${fmtNum(pItem.size)} m²</td>
        <td colspan="5" style="text-align:left; color:var(--accent-orange); font-weight:500;">
          Sau khi phê duyệt dự kiến bổ sung <b style="color:var(--accent-green);">${fmtPct(pItem.scaleAddPct)}</b> quy mô, <b style="color:var(--accent-cyan);">${fmtPct(pItem.coverageAddPct)}</b> độ phủ${pItem.coverageMethod === 'estimate' ? ' (ước lượng)' : ''}
        </td>
      </tr>`);
    });
  } else {
    parts.push(`<tr><td style="text-align:center;">-</td><td colspan="7" style="text-align:center; color:var(--text-muted); font-style:italic;">Không có công trình nhóm 1–8 đang chờ duyệt trong phường.</td></tr>`);
  }

  // D / CÁC CƠ SỞ CHƯA SỬ DỤNG
  sectionHeader('D', 'var(--accent-orange)', 'rgba(234, 179, 8, 0.18)', 'CÁC CƠ SỞ CHƯA SỬ DỤNG');
  const csdList = wardData.csdItems || [];
  if (csdList.length > 0) {
    csdList.forEach((csd, csdIdx) => {
      const needApprove = csd.needsApproval || !isApproved(csd.status);
      const needApproveNote = needApprove
        ? `<div style="color:var(--accent-red); font-weight:bold; font-size:9px; margin-top:1px;">(Cần phê duyệt)</div>`
        : '';
      const eligibleSugg = (csd.suggestions || []).filter(s => s.status === 'eligible');
      const suggestionHtml = eligibleSugg.length > 0
        ? eligibleSugg.slice(0, 2).map((s, idx) =>
          `<div style="margin:1px 0;">Ưu tiên ${idx + 1}: ${escapeHtml(s.label)} (bổ sung <b style="color:var(--accent-green);">${fmtPct(s.scaleAddPct)}</b> quy mô, <b style="color:var(--accent-cyan);">${fmtPct(s.coverageAddPct)}</b> độ phủ${s.coverageMethod === 'estimate' ? ', ước lượng' : ''}).</div>`
        ).join('')
        : `<div style="color:var(--text-muted); font-style:italic;">Chưa có gợi ý phù hợp</div>`;

      parts.push(`<tr style="color:var(--text-main); font-size:9.5px;">
        <td style="text-align:center; font-weight:bold; vertical-align:top;">${csdIdx + 1}</td>
        <td style="text-align:left; padding-left:6px; font-weight:bold; vertical-align:top;">${zoomLinkHtml(csd, 'Khu đất chưa sử dụng')}${needApproveNote}</td>
        <td style="text-align:right; font-weight:bold; vertical-align:top;">${fmtNum(csd.size)} m²</td>
        <td colspan="5" style="text-align:left; color:var(--accent-orange); font-weight:500; vertical-align:top; line-height:1.35;">${suggestionHtml}</td>
      </tr>`);
    });
  } else {
    parts.push(`<tr><td style="text-align:center;">-</td><td colspan="7" style="text-align:center; color:var(--text-muted); font-style:italic;">Không có cơ sở chưa sử dụng nào nằm trong ranh giới phường.</td></tr>`);
  }

  parts.push(`</tbody></table></div>`);
  return parts.join('');
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

  // Cập nhật dữ liệu tại chỗ (độ phủ về dần từng phường) thay vì hủy/tạo lại chart
  if (chartInstance && chartInstance.canvas === chartEl) {
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
      layout: { padding: { top: 6 } },
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
            font: { size: 10.5, family: getComputedStyle(document.body).fontFamily }
          },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          max: 100,
          ticks: { color: '#94a3b8' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
}
