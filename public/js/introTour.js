// Thuyết minh khi khởi động: thẻ giới thiệu chạy chữ chậm + làm nổi phần giao diện liên quan, cho người dùng không chuyên.
// Tự hiện ở lần mở trang đầu (tắt bằng ô "Không tự hiện"), xem lại bằng nút ? trên thanh công cụ.
import { ico } from './utils.js';

const STORAGE_KEY = 'qhhue_intro_off';
const TYPE_MS = 18;          // tốc độ chạy chữ (ms / ký tự)
const HOLD_MS = 4500;        // dừng đọc sau khi chạy xong chữ rồi mới tự sang bước sau

const STEPS = [
  {
    title: 'Chào mừng đến Bản đồ hạ tầng xã hội TP. Huế',
    text: 'Trang web cho biết các công trình phục vụ đời sống hằng ngày (công viên, trường học, trạm y tế, nhà văn hóa, chợ, bãi đỗ xe…) đang nằm ở đâu và đã phục vụ đủ cho người dân trong khu vực hay chưa.\nPhần giới thiệu tự chạy khoảng 1 phút. Bấm "Tiếp" để đi nhanh hoặc "Bỏ qua" để vào thẳng bản đồ.'
  },
  {
    title: 'Quy chuẩn QCVN 01:2026/BXD',
    text: 'Đây là Quy chuẩn kỹ thuật quốc gia về Quy hoạch xây dựng. Với mỗi loại công trình, quy chuẩn đặt ra 2 yêu cầu chính:\n• Đủ diện tích: tính bằng m² đất trên mỗi người dân, ví dụ cây xanh đô thị 5 m²/người.\n• Đủ gần: người dân đi bộ trong một bán kính hợp lý là tới, ví dụ mầm non, tiểu học, THCS ≤ 1 km; vườn hoa ≤ 400 m; THPT ≤ 2 km.'
  },
  {
    title: 'Hai cấp công trình',
    text: '• Cấp đơn vị ở: phục vụ quanh khu dân cư, như mầm non, tiểu học, THCS, vườn hoa, nhà văn hóa, chợ nhỏ.\n• Cấp đô thị: phục vụ khu vực rộng hơn, như THPT, bệnh viện, công viên khu vực (≥ 1 ha, bán kính 800 m), công viên đô thị (≥ 5 ha, bán kính 2 km).\nTrang web tự xếp cấp và bán kính phục vụ theo loại và quy mô của từng công trình.'
  },
  {
    title: 'Biểu tượng công trình',
    text: 'Mỗi biểu tượng trên bản đồ là 1 công trình. Bấm vào biểu tượng để xem bảng thông tin và vùng phục vụ của công trình đó.\nNút con mắt trên bảng thu gọn bảng về tên công trình để nhìn trọn vùng phục vụ; bấm lại vào công trình để mở lại bảng.'
  },
  {
    target: '#chk_heat',
    title: 'Bản đồ độ phủ hạ tầng',
    text: 'Lớp màu nhiệt thể hiện mức độ được phục vụ: nơi nằm trong tầm đi bộ của càng nhiều loại hạ tầng thì màu càng đậm; nơi màu nhạt là nơi còn thiếu. Khoảng cách được tính bám theo đường giao thông, không chỉ theo đường chim bay.'
  },
  {
    target: '#rightPanel',
    title: 'Bật / tắt lớp dữ liệu',
    text: 'Panel bên phải dùng để chọn nhóm hạ tầng cần xem. Nút chấm tròn ● bật vùng phủ của từng nhóm. Ngoài ra còn lớp phân bố dân cư (ô 30 m × 30 m), ranh giới 40 phường xã, quỹ đất tiềm năng… Thẻ "Chú giải" giải thích các ký hiệu.'
  },
  {
    target: '#btnInspectMode',
    title: 'Tra cứu tại một vị trí',
    text: 'Bật nút này rồi bấm vào một điểm bất kỳ trên bản đồ: trang web cho biết vị trí đó đã nằm trong bán kính phục vụ của những công trình nào, còn thiếu loại nào, kèm tuyến đường đi tới công trình gần nhất.'
  },
  {
    target: '#btnToggleCompare',
    title: 'So sánh Hiện trạng – Quy hoạch',
    text: 'Chia đôi màn hình: bên trái là hiện trạng, bên phải là quy hoạch. Kéo thanh ở giữa để so sánh; chấm màu trên biểu tượng cho biết công trình quy hoạch mới, mở rộng, thu hẹp hay di dời.'
  },
  {
    target: '#bottomPanel',
    title: 'Bảng chỉ tiêu 40 phường xã',
    text: 'Bảng phía dưới so sánh diện tích từng loại hạ tầng với chỉ tiêu m²/người của quy chuẩn, kèm biểu đồ cột. Chọn phường/xã trong danh sách để xem riêng từng địa bàn.'
  },
  {
    target: '.map-toolbar',
    title: 'Công cụ khác',
    text: 'Thanh công cụ bên trái còn có: đo chiều dài, đo diện tích, định vị GPS, chụp ảnh, xuất bản đồ A3 và phác thảo.\nỞ thẻ "Đề xuất", bạn có thể đề xuất công trình mới; đề xuất được đánh dấu "Chờ duyệt" cho đến khi quản trị viên Sở Xây dựng phê duyệt.'
  },
  {
    target: '#btnIntroTour',
    title: 'Xem lại hướng dẫn',
    text: 'Bấm nút ? này bất cứ lúc nào để xem lại phần giới thiệu. Chúc bạn khám phá bản đồ hiệu quả!'
  }
];

let root = null;
let els = null;
let step = 0;
let autoplay = true;
let typeTimer = null;
let holdTimer = null;
let typing = false;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function clearTimers() {
  clearInterval(typeTimer);
  clearTimeout(holdTimer);
  typeTimer = holdTimer = null;
}

function build() {
  root = document.createElement('div');
  root.className = 'tour-root';
  root.innerHTML = `
    <div class="tour-backdrop"></div>
    <div class="tour-spot" hidden></div>
    <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tourTitle">
      <div class="tour-head">
        <span class="tour-step"></span>
        <button type="button" class="tour-x" title="Đóng giới thiệu" aria-label="Đóng giới thiệu">${ico('close')}</button>
      </div>
      <div class="tour-title" id="tourTitle"></div>
      <div class="tour-text" aria-live="polite"></div>
      <div class="tour-bar"><i></i></div>
      <div class="tour-foot">
        <label class="tour-off"><input type="checkbox"> Không tự hiện khi mở trang</label>
        <div class="tour-btns">
          <button type="button" class="tour-prev">‹ Trước</button>
          <button type="button" class="tour-play"></button>
          <button type="button" class="tour-next"></button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(root);
  const q = (s) => root.querySelector(s);
  els = {
    spot: q('.tour-spot'), card: q('.tour-card'), stepLbl: q('.tour-step'), title: q('.tour-title'),
    text: q('.tour-text'), bar: q('.tour-bar > i'), off: q('.tour-off input'),
    prev: q('.tour-prev'), play: q('.tour-play'), next: q('.tour-next')
  };
  q('.tour-x').addEventListener('click', close);
  els.prev.addEventListener('click', () => go(step - 1));
  els.next.addEventListener('click', next);
  els.play.addEventListener('click', () => { autoplay = !autoplay; renderPlay(); if (autoplay && !typing) scheduleNext(); else if (!autoplay) clearTimeout(holdTimer); });
  els.off.addEventListener('change', () => {
    try { localStorage.setItem(STORAGE_KEY, els.off.checked ? '1' : '0'); } catch { /* chế độ riêng tư */ }
  });
  q('.tour-backdrop').addEventListener('click', (e) => e.stopPropagation());
  window.addEventListener('resize', () => { if (isOpen()) place(); });
  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') go(step - 1);
  });
}

const isOpen = () => !!root && !root.hidden;

function renderPlay() {
  els.play.textContent = autoplay ? '❚❚ Tạm dừng' : '▶ Tự chạy';
  els.play.title = autoplay ? 'Dừng tự chuyển bước' : 'Tự chuyển sang bước sau';
}

// Ô tick thì làm nổi cả dòng chứa nó; phần đang ẩn / nằm ngoài màn hình (panel thu gọn) → không làm nổi
function targetRect(sel) {
  let el = sel && document.querySelector(sel);
  if (el?.matches('input')) el = el.closest('div') || el;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const visible = r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
  return visible ? r : null;
}

// Đặt thẻ cạnh phần được làm nổi (phía còn nhiều chỗ nhất), không có phần nổi thì đặt giữa màn hình
function place() {
  const r = targetRect(STEPS[step].target);
  const card = els.card;
  root.classList.toggle('tour-dim', !r);
  els.spot.hidden = !r;
  if (!r) {
    card.style.left = `${Math.max(12, (innerWidth - card.offsetWidth) / 2)}px`;
    card.style.top = `${Math.max(12, (innerHeight - card.offsetHeight) / 2)}px`;
    return;
  }
  const pad = 6;
  Object.assign(els.spot.style, {
    left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`
  });
  const cw = card.offsetWidth, ch = card.offsetHeight, gap = 18, m = 12;
  const room = { right: innerWidth - r.right, left: r.left, bottom: innerHeight - r.bottom, top: r.top };
  const side = ['right', 'left', 'bottom', 'top'].find(k => room[k] >= ((k === 'right' || k === 'left') ? cw : ch) + gap + m)
    || Object.keys(room).sort((a, b) => room[b] - room[a])[0];
  let x, y;
  if (side === 'right' || side === 'left') {
    x = side === 'right' ? r.right + gap : r.left - gap - cw;
    y = r.top + r.height / 2 - ch / 2;
  } else {
    x = r.left + r.width / 2 - cw / 2;
    y = side === 'bottom' ? r.bottom + gap : r.top - gap - ch;
  }
  card.style.left = `${Math.min(Math.max(m, x), innerWidth - cw - m)}px`;
  card.style.top = `${Math.min(Math.max(m, y), innerHeight - ch - m)}px`;
}

function typeText(text) {
  clearTimers();
  if (reducedMotion()) {
    els.text.textContent = text;
    finishTyping();
    return;
  }
  typing = true;
  let i = 0;
  els.text.textContent = '';
  els.text.classList.add('typing');
  typeTimer = setInterval(() => {
    i += 1;
    els.text.textContent = text.slice(0, i);
    if (i >= text.length) finishTyping();
  }, TYPE_MS);
}

function finishTyping() {
  clearInterval(typeTimer);
  typeTimer = null;
  typing = false;
  els.text.textContent = STEPS[step].text;
  els.text.classList.remove('typing');
  if (autoplay) scheduleNext();
}

function scheduleNext() {
  clearTimeout(holdTimer);
  if (step >= STEPS.length - 1) return;
  els.bar.style.transition = 'none';
  els.bar.style.width = '0';
  void els.bar.offsetWidth;
  els.bar.style.transition = `width ${HOLD_MS}ms linear`;
  els.bar.style.width = '100%';
  holdTimer = setTimeout(() => go(step + 1), HOLD_MS);
}

function next() {
  if (typing) { finishTyping(); return; }   // đang chạy chữ: bấm Tiếp = hiện hết chữ trước
  if (step >= STEPS.length - 1) close();
  else go(step + 1);
}

function go(i) {
  if (i < 0 || i >= STEPS.length) return;
  step = i;
  const s = STEPS[step];
  els.stepLbl.textContent = `Giới thiệu ${step + 1}/${STEPS.length}`;
  els.title.textContent = s.title;
  els.prev.disabled = step === 0;
  els.next.textContent = step === STEPS.length - 1 ? 'Bắt đầu sử dụng' : 'Tiếp ›';
  els.bar.style.transition = 'none';
  els.bar.style.width = '0';
  els.text.style.minHeight = '';
  els.text.textContent = s.text;               // đo chiều cao chữ đầy đủ để thẻ không nhảy khi chạy chữ
  els.text.style.minHeight = `${els.text.offsetHeight}px`;
  place();
  typeText(s.text);
}

export function openIntroTour() {
  if (!root) build();
  let off = false;
  try { off = localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* chế độ riêng tư */ }
  els.off.checked = off;
  autoplay = true;
  renderPlay();
  root.hidden = false;
  go(0);
  els.next.focus({ preventScroll: true });
}

function close() {
  clearTimers();
  typing = false;
  if (root) root.hidden = true;
  document.getElementById('btnIntroTour')?.focus({ preventScroll: true });
}

export function initIntroTour() {
  document.getElementById('btnIntroTour')?.addEventListener('click', openIntroTour);
  let off = false;
  try { off = localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* chế độ riêng tư */ }
  if (!off) setTimeout(openIntroTour, 1200);
}
