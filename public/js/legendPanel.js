// Khung chú giải nổi trên bản đồ: Phân loại đô thị (ký hiệu + quyết định phê duyệt, phần tĩnh trong index.html), ký hiệu theo cấp đồ án
// và ký hiệu ngành hạ tầng khi bật lớp. Tự mở khi đổi cấp, khi chọn tab Đô thị, khi bật ngành hoặc nhóm điểm.
// (QHC 1/25.000, QHC 1/10.000, QHPK 1/2.000, QHCT 1/500), mỗi bộ chia nhóm (tìm theo tên loại đất / tên layer CAD,
// thu gọn từng nhóm; tìm và thu gọn chỉ áp lên bộ đang xem). Chỉ hiện bộ của lớp đang bật. Mọi phần tử [data-legend-pane] hiện theo bộ đang xem.
// Chọn lớp ở panel phải (mapLevel.js) thì chuyển sang bộ của cấp đó. Bộ QHC 1/25.000 và 1/10.000 kèm nhóm mạng lưới giao thông
// (qhcRoads.js); 1/10.000 thêm nhóm mặt cắt ngang đường (roadSections.js).
// + mục Hiển thị lô đất: thanh độ trong suốt phần tô lô và chú giải viền theo giai đoạn.
import { renderTt16Legend, getLotOpacity, setLotOpacity, LEGEND_SETS } from './tt16Symbols.js';
import { LEVEL_EVENT } from './mapLevel.js';
import { renderRoadSections } from './roadSections.js';
import { renderTrafficLegend } from './qhcRoads.js';

const LEVEL_SET = { qhc25: 'QHC25', qhc10: 'QHC', qhpk: 'QHPK', qhct: 'QHCT' };

// Kéo thanh trượt: số % đổi ngay, tô lại lô sau khi dừng kéo một nhịp (vẽ lại hàng nghìn lô mỗi bước rất nặng)
const OPACITY_DELAY_MS = 80;

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

export function initLegendPanel() {
  const list = document.getElementById('parcelLegend');
  if (!list) return;
  renderTt16Legend(list);
  renderRoadSections(document.getElementById('roadSections'));
  renderTrafficLegend(document.getElementById('roadNet10'), '10');
  renderTrafficLegend(document.getElementById('roadNet25'), '25');
  const tabs = [...document.querySelectorAll('[data-legend-set]')];
  tabs.forEach(t => {
    const n = LEGEND_SETS[t.dataset.legendSet]?.count || 0;
    if (n) t.title += ` · ${n} ký hiệu`;
  });
  let active = (tabs.find(t => t.classList.contains('active')) || tabs[0])?.dataset.legendSet || 'QHPK';
  const search = document.getElementById('legendSearch');
  const toggle = document.getElementById('btnLegendFold');
  const host = document.getElementById('tabLegend') || list;
  const showPane = () => {
    host.querySelectorAll('[data-legend-pane]').forEach(p => { p.hidden = p.dataset.legendPane !== active; });
    const symbols = !!LEGEND_SETS[active];
    if (search) search.hidden = !symbols;
    if (toggle) toggle.style.visibility = symbols ? '' : 'hidden';
  };
  showPane();
  const groupsOf = () => [...list.querySelectorAll(`[data-legend-pane="${active}"] .tt16-group`)];

  const empty = list.querySelector('.tt16-empty');
  // Đang lọc thì mở mọi nhóm có kết quả; xóa từ khóa thì trả lại trạng thái thu / mở người dùng đã chọn
  let savedOpen = null;
  const applySearch = () => {
    const q = LEGEND_SETS[active] ? fold(search?.value) : '';
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
  const frame = document.getElementById('tabLegend');
  const legendFoldEl = document.getElementById('legendFold');
  const baseFold = document.getElementById('axisBaseFold');
  const envFold = document.getElementById('axisEnvFold');
  const legendTab = document.getElementById('btnDockLegend');
  const baseTab = document.getElementById('btnDockBase');
  const envTab = document.getElementById('btnDockEnv');
  // Hành chính và kiến trúc không có ký hiệu lớp: ẩn tab Chú giải. Lớp nền và Lớp môi trường vẫn dùng được.
  const LEGEND_OFF = new Set(['hanhchinh', 'kientruc']);
  const legendOff = () => LEGEND_OFF.has(document.getElementById('layerMain')?.dataset.active || '');
  const applyDock = () => {
    const off = legendOff();
    if (legendTab) legendTab.hidden = off;
    let mode = frame?.dataset.dock || 'legend';
    if (off && mode === 'legend') mode = 'base';
    if (frame) frame.dataset.dock = mode;
    const showLegend = mode === 'legend' && !off;
    if (legendFoldEl) legendFoldEl.hidden = !showLegend;
    if (baseFold) baseFold.hidden = mode !== 'base';
    if (envFold) envFold.hidden = mode !== 'env';
    const mark = (btn, on) => {
      if (!btn) return;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
    };
    mark(legendTab, showLegend);
    mark(baseTab, mode === 'base');
    mark(envTab, mode === 'env');
  };
  const dock = document.getElementById('rpDock');
  const collapseBtn = document.getElementById('btnDockCollapse');
  const setDockCollapsed = (collapsed) => {
    if (!dock || !collapseBtn) return;
    dock.classList.toggle('is-collapsed', collapsed);
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    const label = collapsed ? 'Mở chú giải, lớp nền và lớp môi trường' : 'Thu gọn chú giải, lớp nền và lớp môi trường';
    collapseBtn.title = collapsed ? 'Mở lại' : 'Thu gọn xuống cuối panel';
    collapseBtn.setAttribute('aria-label', label);
    collapseBtn.querySelector('use')?.setAttribute('href', collapsed ? '#i-chev-up' : '#i-chev-down');
  };
  collapseBtn?.addEventListener('click', () => setDockCollapsed(!dock.classList.contains('is-collapsed')));
  const chip = document.getElementById('legendChip');
  const checked = (id) => !!document.getElementById(id)?.checked;
  const anyOn = (ids) => ids.some(checked);
  const SET_ON = {
    URBAN: ['chk_urban'],
    QHC25: ['chk_qhc25', 'chk_gt25', 'chk_qhc25head'],
    QHC: ['chk_qhc10', 'chk_gt10', 'chk_qhc10head'],
    QHPK: ['chk_projects'],
    QHCT: ['chk_qhct']
  };
  const LAND = ['chk_qhc25', 'chk_qhc10', 'chk_projects', 'chk_qhct', 'chk_parcel'];
  let sectorOn = false;
  let prefer = null;
  const selectSet = (set) => {
    const t = tabs.find(x => x.dataset.legendSet === set && !x.hidden);
    if (!t) return false;
    if (set !== active) {
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
    }
    return true;
  };
  const reveal = (set) => {
    if (!frame) return;
    if (legendOff()) {
      applyDock();
      return;
    }
    if (frame.dataset.userHide === '1') {
      if (set) prefer = set;
      syncLegend();
      return;
    }
    if (set) prefer = set;
    syncLegend();
  };
  const syncLegend = () => {
    if (!frame) return;
    applyDock();
    const visible = new Set();
    tabs.forEach(t => {
      const set = t.dataset.legendSet;
      const show = set === 'SECTOR' ? sectorOn : (anyOn(SET_ON[set] || []) || prefer === set);
      t.hidden = !show;
      if (show) visible.add(set);
    });
    if (prefer && visible.has(prefer)) selectSet(prefer);
    else if (!visible.has(active)) selectSet([...visible][0]);
    const symbols = visible.size > 0;
    const land = anyOn(LAND);
    const hatang = document.getElementById('layerMain')?.dataset.active === 'hatang';
    frame.classList.toggle('is-htkt', hatang);
    const htktLegend = document.getElementById('legendHtkt');
    if (htktLegend) htktLegend.hidden = !hatang;
    const main = frame.querySelector('.legend-main');
    if (main) main.hidden = hatang ? false : !symbols;
    const display = document.querySelector('#tabLegend .legend-display');
    if (display) display.hidden = hatang || !land;
    const pointHost = document.getElementById('legendPoints');
    const pointList = document.getElementById('legendPointList');
    const pointRows = [...document.querySelectorAll('.infra-point input[type="checkbox"]:checked')]
      .filter(inp => inp.id !== 'chk_c13');
    if (pointHost && pointList) {
      pointList.replaceChildren();
      pointRows.forEach(inp => {
        const row = document.createElement('div');
        row.className = 'legend-point';
        const img = inp.closest('.layer-row')?.querySelector('img.layer-type-icon, img');
        if (img) row.append(img.cloneNode(true));
        const name = (inp.closest('.layer-row')?.querySelector('label')?.textContent || '').replace(/\s+/g, ' ').trim();
        row.append(document.createTextNode(name));
        pointList.append(row);
      });
      if (checked('chk_c14')) {
        const apt = document.querySelector('#aptBox .apt-legend');
        if (apt) pointList.append(apt.cloneNode(true));
      }
      pointHost.hidden = pointRows.length === 0;
    }
    const roads = document.getElementById('legendRoads');
    if (roads) roads.hidden = !checked('chk_roads');
    const extra = document.getElementById('legendExtra');
    const extraOn = pointRows.length > 0 || checked('chk_roads');
    if (extra) extra.hidden = !extraOn;
    if (chip) chip.hidden = true;
  };
  legendTab?.addEventListener('click', () => {
    delete frame?.dataset.userHide;
    if (frame) frame.dataset.dock = 'legend';
    syncLegend();
  });
  baseTab?.addEventListener('click', () => {
    if (frame && !legendOff()) frame.dataset.userHide = '1';
    if (frame) frame.dataset.dock = 'base';
    syncLegend();
  });
  envTab?.addEventListener('click', () => {
    if (frame && !legendOff()) frame.dataset.userHide = '1';
    if (frame) frame.dataset.dock = 'env';
    syncLegend();
  });
  chip?.addEventListener('click', () => {
    delete frame.dataset.userHide;
    frame.dataset.dock = 'legend';
    syncLegend();
  });
  tabs.forEach(t => t.addEventListener('click', () => { prefer = t.dataset.legendSet; }));
  document.addEventListener('change', (e) => {
    const id = e.target?.id || '';
    if (e.target?.checked && (/^chk_c\d+$/.test(id) || id === 'chk_invest')) delete frame?.dataset.userHide;
    syncLegend();
  });
  document.addEventListener('qh:legend-sync', syncLegend);
  document.addEventListener('qh:legend-open', (e) => reveal(e.detail?.set));
  document.addEventListener('qh:sector-legend', (e) => {
    const d = e.detail || {};
    sectorOn = !!d.on;
    const name = document.getElementById('legendSectorName');
    if (name && d.label) name.textContent = d.label;
    const host = document.getElementById('legendSector');
    if (host && d.html != null) host.innerHTML = d.html;
    if (d.open) reveal('SECTOR');
    else syncLegend();
  });
  document.addEventListener(LEVEL_EVENT, (e) => {
    const set = LEVEL_SET[e.detail?.level];
    if (set) reveal(set);
    else syncLegend();
  });
  syncLegend();

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
