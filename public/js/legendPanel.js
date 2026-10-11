// Tab Chú giải: ký hiệu theo cấp đồ án (QHC 1/25.000, QHC 1/10.000, QHPK 1/2.000, QHCT 1/500), mỗi bộ chia nhóm
// (tìm theo tên loại đất / tên layer CAD, thu gọn từng nhóm; tìm và thu gọn chỉ áp lên bộ đang xem).
// Chọn lớp ở droplist (mapLevel.js) thì chuyển sang bộ của cấp đó.
// + mục Hiển thị lô đất: thanh độ trong suốt phần tô lô và chú giải viền theo giai đoạn.
import { renderTt16Legend, getLotOpacity, setLotOpacity, LEGEND_SETS } from './tt16Symbols.js';
import { LEVEL_EVENT } from './mapLevel.js';

const LEVEL_SET = { qhc25: 'QHC25', qhc10: 'QHC', qhpk: 'QHPK', qhct: 'QHCT' };

// Kéo thanh trượt: số % đổi ngay, tô lại lô sau khi dừng kéo một nhịp (vẽ lại hàng nghìn lô mỗi bước rất nặng)
const OPACITY_DELAY_MS = 80;

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

export function initLegendPanel() {
  const list = document.getElementById('parcelLegend');
  if (!list) return;
  renderTt16Legend(list);
  const tabs = [...document.querySelectorAll('[data-legend-set]')];
  tabs.forEach(t => {
    const n = LEGEND_SETS[t.dataset.legendSet]?.count || 0;
    if (n) t.title += ` · ${n} ký hiệu`;
  });
  let active = (tabs.find(t => t.classList.contains('active')) || tabs[0])?.dataset.legendSet || 'QHPK';
  const showPane = () => list.querySelectorAll('[data-legend-pane]').forEach(p => { p.hidden = p.dataset.legendPane !== active; });
  showPane();
  const groupsOf = () => [...list.querySelectorAll(`[data-legend-pane="${active}"] .tt16-group`)];

  const empty = list.querySelector('.tt16-empty');
  const search = document.getElementById('legendSearch');
  // Đang lọc thì mở mọi nhóm có kết quả; xóa từ khóa thì trả lại trạng thái thu / mở người dùng đã chọn
  let savedOpen = null;
  const applySearch = () => {
    const q = fold(search?.value);
    const groups = groupsOf();
    if (q && !savedOpen) savedOpen = groups.map(g => g.open);
    let shown = 0;
    groups.forEach((g, i) => {
      let n = 0;
      g.querySelectorAll('.tt16-row').forEach(row => {
        const hit = !q || row.dataset.search.includes(q);
        row.hidden = !hit;
        if (hit) n++;
      });
      g.hidden = n === 0;
      if (q) g.open = n > 0;
      else if (savedOpen) g.open = savedOpen[i];
      shown += n;
    });
    if (!q) savedOpen = null;
    if (empty) empty.hidden = !q || shown > 0;
  };
  search?.addEventListener('input', applySearch);

  const toggle = document.getElementById('btnLegendFold');
  const syncToggle = () => {
    const allOpen = groupsOf().every(g => g.open || g.hidden);
    toggle?.setAttribute('aria-pressed', String(!allOpen));
    if (toggle) toggle.title = allOpen ? 'Thu gọn mọi nhóm' : 'Mở mọi nhóm';
  };
  toggle?.addEventListener('click', () => {
    const groups = groupsOf();
    const open = !groups.every(g => g.open || g.hidden);
    groups.forEach(g => { if (!g.hidden) g.open = open; });
    syncToggle();
  });
  list.querySelectorAll('.tt16-group').forEach(g => g.addEventListener('toggle', syncToggle));

  // Đổi bộ: trả trạng thái thu / mở của bộ cũ trước khi từ khóa đang gõ lọc bộ mới
  tabs.forEach(t => t.addEventListener('click', () => {
    const set = t.dataset.legendSet;
    if (set === active) return;
    if (savedOpen) groupsOf().forEach((g, i) => { g.open = savedOpen[i]; });
    savedOpen = null;
    active = set;
    tabs.forEach(x => {
      const on = x === t;
      x.classList.toggle('active', on);
      x.setAttribute('aria-selected', String(on));
    });
    showPane();
    applySearch();
    syncToggle();
  }));
  syncToggle();
  document.addEventListener(LEVEL_EVENT, (e) => {
    const set = LEVEL_SET[e.detail?.level];
    if (set && set !== active) tabs.find(t => t.dataset.legendSet === set)?.click();
  });

  const slider = document.getElementById('lotOpacity');
  const out = document.getElementById('lotOpacityValue');
  if (!slider) return;
  const show = (v) => { if (out) out.textContent = `${v}%`; };
  const initial = Math.round(getLotOpacity() * 100);
  slider.value = String(initial);
  show(initial);
  let timer = 0;
  slider.addEventListener('input', () => {
    show(Number(slider.value));
    clearTimeout(timer);
    timer = setTimeout(() => setLotOpacity(Number(slider.value) / 100), OPACITY_DELAY_MS);
  });
  // Bấm số % để trả về mặc định (đúng mẫu ký hiệu)
  out?.addEventListener('click', () => {
    slider.value = '100';
    show(100);
    clearTimeout(timer);
    setLotOpacity(1);
  });
}
