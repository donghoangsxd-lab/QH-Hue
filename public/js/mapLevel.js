// Lớp quy hoạch đang xem (nút trong panel Hành chính và Quy hoạch). Mỗi lớp một luồng tương tác riêng; viewFlow.js định tuyến click
// bản đồ quy hoạch theo lớp đang chọn (không lớp nào chọn phường từ bản đồ; chọn phường ở droplist bảng tổng hợp):
//  urban  Hệ thống đô thị (chk_urban)   bấm đô thị → nổi ranh + phạm vi đã có QHC / QHPK / QHCT (urbanFocus.js), bấm vùng
//                                        đồ án → chi tiết
//  qhc25  QHC 1/25.000 (chk_qhc25)       bấm vùng → chức năng khu vực; bấm bản đồ không đổi địa bàn
//  qhc10  QHC 1/10.000 (chk_qhc10)       ranh + tên các đồ án QHC, bấm đồ án mới hiện lô; ranh mở rộng QĐ 756,
//                                        QHPK lọc theo vùng lõi
//  qhpk   QHPK 1/2.000 (chk_projects)    ranh mọi đồ án; bấm ranh hoặc tick đồ án mới hiện lô.
//                                        Ranh điều chỉnh và QHCT chỉ khi đang mở một đồ án. Chọn phường: lô cả phường
//  qhct   QHCT 1/500 (chk_qhct)          ranh + tên các đồ án QHCT nhập, bấm đồ án → chi tiết; lô QHCT tĩnh (qhctLayer.js)
// Chọn một nút trong panel: bật lớp đó, tắt 4 lớp còn lại. Bật thêm lớp ở danh sách để so sánh: lớp đang chọn giữ nguyên;
// lớp đang chọn bị tắt mà còn lớp khác bật thì chuyển sang lớp đó.
export const LEVELS = [
  { id: 'urban', chk: 'chk_urban', label: 'HỆ THỐNG ĐÔ THỊ' },
  { id: 'qhc25', chk: 'chk_qhc25', label: 'QHC 1/25.000' },
  { id: 'qhc10', chk: 'chk_qhc10', label: 'QHC 1/10.000', scope: 'QHC' },
  { id: 'qhpk', chk: 'chk_projects', label: 'QHPK 1/2.000' },
  { id: 'qhct', chk: 'chk_qhct', label: 'QHCT 1/500', scope: 'QHCT' }
];
export const DEFAULT_LEVEL = 'urban';
/** detail: { level, prev, origin } */
export const LEVEL_EVENT = 'qh:level';

const byId = new Map(LEVELS.map(l => [l.id, l]));
const byChk = new Map(LEVELS.map(l => [l.chk, l]));
let level = DEFAULT_LEVEL;
// Lớp đã chuyển sang lớp hiện tại (VD mở QHPK khi đang xem QHC 1/10.000 → 'qhc10') để thoát đồ án thì quay lại
let origin = null;
let applying = false;
// Tab kiểm tra quy hoạch đang tự chọn lớp: mở đồ án giao vùng không được kéo nút cấp sang cấp đồ án kia
let levelLock = 0;

export const getLevel = () => level;
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

/** Chọn lớp: bật lớp này, tắt 4 lớp còn lại (gọi lại cùng lớp để đặt lại về chỉ một lớp).
 *  opts.origin: lớp chuyển sang. opts.keepView: chọn QHC 1/10.000 và 1/25.000 không phóng khung hình.
 *  opts.fromHold: được phép đổi lớp khi đang withLevelLock (tab kiểm tra tự chọn). */
export function setLevel(id, { origin: from = null, keepView = false, fromHold = false } = {}) {
  if (levelLock && !fromHold) return;
  const next = byId.get(id);
  if (!next) return;
  const prev = level;
  level = id;
  origin = from;
  applying = true;
  try {
    LEVELS.forEach(l => { if (l.id !== id) setChecked(l.chk, false); });
    setChecked(next.chk, true);
  } finally {
    applying = false;
  }
  emit(prev, keepView ? { keepView: true } : {});
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
  emit(prev);
}

function paint() {
  const cur = byId.get(level);
  document.body.dataset.level = level;
  document.querySelectorAll('[data-level-pick]').forEach(host => { host.dataset.level = level; });
  document.querySelectorAll('[data-level-pick] [data-level]').forEach(el => {
    const meta = byId.get(el.dataset.level);
    if (!meta) return;
    const on = el.dataset.level === level;
    el.classList.toggle('is-current', on);
    el.setAttribute('aria-selected', String(on));
    el.classList.toggle('is-on', isOn(meta.chk));
    el.title = on ? `Đang xem: ${cur.label}` : `Xem ${meta.label}`;
  });
}

export function initMapLevel() {
  const root = document.getElementById('layerMain');
  root?.addEventListener('click', (e) => {
    const item = e.target.closest('[data-level]');
    if (!item?.closest('[data-level-pick]')) return;
    const id = item.dataset.level;
    setLevel(id, { keepView: id === 'qhc10' || id === 'qhc25' });
  });
  document.addEventListener('change', onLayerChange);
  // Mở trang luôn về Hệ thống đô thị. Ô lớp trình duyệt khôi phục từ lần trước không được thắng.
  // Link chia sẻ (có lv hoặc ly) do viewLink áp sau bước này.
  const shared = new URLSearchParams(location.search);
  if (!shared.has('lv') && !shared.has('ly')) setLevel(DEFAULT_LEVEL);
  else paint();
}
