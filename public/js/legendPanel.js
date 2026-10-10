// Tab Chú giải: danh sách ký hiệu TT16 theo nhóm (tìm theo tên loại đất / tên layer CAD, thu gọn từng nhóm)
// + mục Hiển thị lô đất: thanh độ trong suốt phần tô lô và chú giải viền theo giai đoạn.
import { renderTt16Legend, getLotOpacity, setLotOpacity, LEGEND_COUNT } from './tt16Symbols.js';

// Kéo thanh trượt: số % đổi ngay, tô lại lô sau khi dừng kéo một nhịp (vẽ lại hàng nghìn lô mỗi bước rất nặng)
const OPACITY_DELAY_MS = 80;

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

export function initLegendPanel() {
  const list = document.getElementById('parcelLegend');
  if (!list) return;
  renderTt16Legend(list);
  const count = document.getElementById('legendCount');
  if (count) count.textContent = String(LEGEND_COUNT);

  const groups = [...list.querySelectorAll('.tt16-group')];
  const empty = list.querySelector('.tt16-empty');
  const search = document.getElementById('legendSearch');
  // Đang lọc thì mở mọi nhóm có kết quả; xóa từ khóa thì trả lại trạng thái thu / mở người dùng đã chọn
  let savedOpen = null;
  search?.addEventListener('input', () => {
    const q = fold(search.value);
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
    if (empty) empty.hidden = shown > 0;
  });

  const toggle = document.getElementById('btnLegendFold');
  const syncToggle = () => {
    const allOpen = groups.every(g => g.open || g.hidden);
    toggle?.setAttribute('aria-pressed', String(!allOpen));
    if (toggle) toggle.title = allOpen ? 'Thu gọn mọi nhóm' : 'Mở mọi nhóm';
  };
  toggle?.addEventListener('click', () => {
    const open = !groups.every(g => g.open || g.hidden);
    groups.forEach(g => { if (!g.hidden) g.open = open; });
    syncToggle();
  });
  groups.forEach(g => g.addEventListener('toggle', syncToggle));
  syncToggle();

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
