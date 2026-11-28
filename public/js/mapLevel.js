// Lớp quy hoạch đang xem (nút trong panel Hành chính và Quy hoạch). Mỗi lớp một luồng tương tác riêng; viewFlow.js định tuyến click
// bản đồ quy hoạch theo lớp đang chọn (không lớp nào chọn phường từ bản đồ; chọn phường ở droplist bảng tổng hợp):
//  urban  Hệ thống đô thị (chk_urban)   bấm đô thị → nổi ranh + phạm vi đã có QHC / QHPK / QHCT (urbanFocus.js), bấm vùng
//                                        đồ án → chi tiết (trục A; không nằm trong hàng tab B)
//  qh756  QH756 (chk_qh756)             QH sử dụng đất mã tỉnh (public/data/qh756/sdd.json), kiểu lớp tĩnh QHC108
//  qhc25  QHC108 (chk_qhc25)            QHC theo QĐ 108 (tỷ lệ 1/25.000): bấm vùng → chức năng khu vực
//  qhc10  QHC 1/10.000 (chk_qhc10)       lô sử dụng đất trung tâm + ranh/tên đồ án QHC khác; ranh mở rộng QĐ 756,
//                                        QHPK lọc theo vùng lõi. Bấm ngoài vùng lõi tạm thu lô về đường bao.
//  qhpk   QHPK 1/2.000 (chk_projects)    ranh mọi đồ án; tick hoặc bấm một đồ án mới hiện lô.
//                                        Ranh điều chỉnh và QHCT chỉ khi đang mở một đồ án. Chọn phường vẫn chỉ ranh.
//  qhct   QHCT 1/500 (chk_qhct)          ranh + tên các đồ án QHCT nhập, tick hoặc bấm đồ án → chi tiết; lô QHCT tĩnh (qhctLayer.js)
// Năm cấp quy hoạch là một nhóm radio: bật một cấp thì tắt các cấp kia. Nền cam là cấp đang bật.
// Muốn xem đồ án cấp khác thì chuyển cấp, rồi bật từng đồ án trong danh sách của cấp đó.
export const LEVELS = [
  { id: 'urban', chk: 'chk_urban', label: 'HỆ THỐNG ĐÔ THỊ' },
  { id: 'qh756', chk: 'chk_qh756', label: 'QH756' },
  { id: 'qhc25', chk: 'chk_qhc25', label: 'QHC108' },
  { id: 'qhc10', chk: 'chk_qhc10', label: 'QHC10K', scope: 'QHC' },
  // scope bắt buộc: leaveScopeFocus / trySwitchProjectAt khi PE ranh tắt (đã mở lô·info).
  { id: 'qhpk', chk: 'chk_projects', label: 'QHPK', scope: 'QHPK' },
  { id: 'qhct', chk: 'chk_qhct', label: 'QHCT', scope: 'QHCT' }
];
export const DEFAULT_LEVEL = 'qhc25';
/** detail: { level, prev, origin } */
export const LEVEL_EVENT = 'qh:level';

const byId = new Map(LEVELS.map(l => [l.id, l]));
const byChk = new Map(LEVELS.map(l => [l.chk, l]));
const PLAN_TABS = ['qh756', 'qhc25', 'qhc10', 'qhpk', 'qhct'];
// Đúng một cấp quy hoạch trong tập này. Danh sách đồ án chỉ hiện cấp đó.
const listed = new Set(['qhc25']);
let level = DEFAULT_LEVEL;
// Lớp đã chuyển sang lớp hiện tại (VD mở QHPK khi đang xem QHC 1/10.000 → 'qhc10') để thoát đồ án thì quay lại
let origin = null;
let applying = false;
// Tab kiểm tra quy hoạch đang tự chọn lớp: mở đồ án giao vùng không được kéo nút cấp sang cấp đồ án kia
let levelLock = 0;

export const getLevel = () => level;
export const listedLevels = () => new Set(listed);
export const levelOrigin = () => origin;
export const levelChk = (id) => byId.get(id)?.chk || null;
/** Cấp đồ án nhập (planLevelOf) hiện ranh theo lớp đang xem dù lớp QHPK (chk_projects) tắt; null = không có */
export const levelScope = () => byId.get(level)?.scope || null;
const isOn = (id) => !!document.getElementById(id)?.checked;

function setChecked(id, on) {
  const el = document.getElementById(id);
  if (!el || el.checked === on) return;
  el.checked = on;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function emit(prev, extra = {}) {
  paint();
  document.dispatchEvent(new CustomEvent(LEVEL_EVENT, { detail: { level, prev, origin, ...extra } }));
}

/** Giữ nguyên lớp đang chọn trong lúc chạy fn. setLevel từ mở đồ án bị bỏ qua; chỉ setLevel(..., { fromHold: true }) được đổi. */
export function withLevelLock(fn) {
  levelLock += 1;
  try { return fn(); } finally { levelLock -= 1; }
}

/** Chọn lớp: bật lớp này, tắt các lớp còn lại.
 *  opts.origin: lớp chuyển sang. opts.keepView: chọn QHC 1/10.000 và 1/25.000 không phóng khung hình.
 *  opts.fromHold: được phép đổi lớp khi đang withLevelLock (tab kiểm tra tự chọn). */
export function setLevel(id, { origin: from = null, keepView = false, fromHold = false } = {}) {
  if (levelLock && !fromHold) return;
  const next = byId.get(id);
  if (!next) return;
  const prev = level;
  level = id;
  origin = from;
  listed.clear();
  listed.add(id);
  applying = true;
  try {
    LEVELS.forEach(l => { if (l.id !== id) setChecked(l.chk, false); });
    setChecked(next.chk, true);
  } finally {
    applying = false;
  }
  emit(prev, keepView ? { keepView: true } : {});
}

/** Bật đúng một cấp quy hoạch. Bấm cấp đang bật thì giữ nguyên. */
export function togglePlanTab(id) {
  if (!PLAN_TABS.includes(id)) return;
  setLevel(id, { keepView: true });
}

/** Mở panel Quy hoạch mà chưa có đúng một cấp thì bật QHC 1/25.000. */
export function ensurePlanTab(id = 'qhc25') {
  const open = PLAN_TABS.filter(x => listed.has(x));
  if (open.length === 1 && level === open[0]) return;
  setLevel(PLAN_TABS.includes(level) ? level : id, { keepView: true });
}

function onLayerChange(e) {
  if (applying || levelLock) {
    if (levelLock) paint();
    return;
  }
  const l = byChk.get(e.target?.id);
  if (!l) return;
  const prev = level;
  if (e.target.checked) {
    if (isOn(levelChk(level))) { paint(); return; }
    level = l.id;
  } else if (l.id === level) {
    const other = LEVELS.find(x => x.id !== level && isOn(x.chk));
    if (!other) { paint(); return; }
    level = other.id;
  } else {
    paint();
    return;
  }
  origin = null;
  // Đổi lớp qua ô checkbox (gồm tắt/bật cả cấp): giữ khung nhìn, không phóng toàn thành phố.
  emit(prev, { keepView: true });
}

function paint() {
  const cur = byId.get(level);
  document.body.dataset.level = level;
  document.querySelectorAll('[data-level-pick]').forEach(host => { host.dataset.level = level; });
  document.querySelectorAll('[data-level-pick] [data-level]').forEach(el => {
    const meta = byId.get(el.dataset.level);
    if (!meta) return;
    const on = el.dataset.level === level;
    const tabOn = listed.has(el.dataset.level) || isOn(meta.chk);
    el.classList.toggle('is-current', on);
    el.setAttribute('aria-selected', String(on));
    el.setAttribute('aria-pressed', String(tabOn));
    el.classList.toggle('is-on', tabOn);
    el.title = on ? `Đang xem: ${cur.label}` : (tabOn ? `Đang mở: ${meta.label}` : `Xem ${meta.label}`);
  });
}

export function initMapLevel() {
  const root = document.getElementById('layerMain');
  root?.addEventListener('click', (e) => {
    const item = e.target.closest('[data-level]');
    if (!item?.closest('[data-level-pick]')) return;
    const id = item.dataset.level;
    if (item.closest('#levelPickQh')) { togglePlanTab(id); return; }
    setLevel(id, { keepView: id === 'qhc10' || id === 'qhc25' || id === 'qh756' });
  });
  document.addEventListener('change', onLayerChange);
  // Mở trang luôn về QHC108 (qhc25). Ô lớp trình duyệt khôi phục từ lần trước không được thắng.
  // keepView: khung do centerOnCity (vừa cả thành phố) không bị lớp mặc định kéo đi.
  // Link chia sẻ (có lv hoặc ly) do viewLink áp sau bước này.
  const shared = new URLSearchParams(location.search);
  if (!shared.has('lv') && !shared.has('ly')) setLevel(DEFAULT_LEVEL, { keepView: true });
  else paint();
}
