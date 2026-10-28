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
import { BUFFER_COLORS, BUFFER_KEYS } from './state.js';

const LEVEL_SET = { qhc25: 'QHC25', qhc10: 'QHC', qhpk: 'QHPK', qhct: 'QHCT' };

// Kéo thanh trượt: số % đổi ngay, tô lại lô sau khi dừng kéo một nhịp (vẽ lại hàng nghìn lô mỗi bước rất nặng)
const OPACITY_DELAY_MS = 80;

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

// [chkId, icon, label, bufferType|null] — ● vùng phủ theo BUFFER_KEYS; nhà tang lễ không có bán kính
const SOCIAL_LEGEND = [
  ['chk_c1', 'Park.png', 'Công viên', '1-CV'],
  ['chk_c3', 'Mamnon.png', 'Mầm non', '3-MN'],
  ['chk_c4', 'Tieuhoc.png', 'Tiểu học', '4-TH'],
  ['chk_c5', 'THCS.png', 'THCS', '5-THCS'],
  ['chk_c10', 'THPT.png', 'THPT', '6-THPT'],
  ['chk_c6', 'Yte.png', 'Y tế', '7-YT'],
  ['chk_c7', 'Vanhoa.png', 'Văn hóa', '8-VH'],
  ['chk_c8', 'Cho.png', 'Chợ', '9-TM'],
  ['chk_nt_funeral', 'Nghiatrang.svg', 'Nhà tang lễ', null],
  ['chk_c2', 'Parking.png', 'Bãi đỗ xe', '2-BDX'],
  ['chk_c11', 'Bus.svg', 'Trạm xe buýt', '13-BUS'],
  ['chk_c12', 'Pccc.svg', 'Trụ sở PCCC', '10-PCCC'],
  ['chk_nt_grave', 'Nghiatrang.svg', 'Nghĩa trang', '11-NT'],
  ['chk_c9', 'Unused.png', 'Cơ sở chưa sử dụng', '12-CSD']
];

const DAU_TU_LEGEND = [
  ['chk_c14', 'Noxh.svg', 'Chung cư'],
  ['chk_invest', '', 'Dự án kêu gọi đầu tư']
];

function dauTuLegendHtml() {
  const rows = DAU_TU_LEGEND.filter(([id]) => document.getElementById(id)?.checked).map(([id, file, label]) => {
    const mark = file
      ? `<img class="layer-type-icon" src="./icons/${file}" alt="" width="14" height="16">`
      : `<svg class="ico" aria-hidden="true"><use href="#i-coverage"/></svg>`;
    return `<label class="htkt-legend-row">${mark}<span>${label}</span><input type="checkbox" data-xh-mirror="${id}" checked aria-label="${label}"></label>`;
  }).join('');
  if (!rows) return '<p class="cn-empty">Bật lớp trong tab đang chọn để xem ký hiệu.</p>';
  const apt = document.getElementById('chk_c14')?.checked
    ? (document.querySelector('#aptBox .apt-legend')?.outerHTML || '')
    : '';
  return rows + apt;
}

function bufferPressed(bufKey) {
  const src = document.querySelector(`#xahoiLayerSource .btn-dot-buffer[data-buffer="${bufKey}"]`);
  return src?.classList.contains('active') || src?.getAttribute('aria-pressed') === 'true';
}

function socialLegendHtml() {
  const rows = SOCIAL_LEGEND.map(([id, file, label, type]) => {
    const on = !!document.getElementById(id)?.checked;
    const mark = file
      ? `<img class="layer-type-icon" src="./icons/${file}" alt="" width="14" height="16">`
      : `<svg class="ico" aria-hidden="true"><use href="#i-coverage"/></svg>`;
    const bufKey = type ? BUFFER_KEYS[type] : '';
    const bufOn = bufKey && bufferPressed(bufKey);
    const buf = bufKey
      ? `<button type="button" class="btn-dot-buffer${bufOn ? ' active' : ''}" data-buffer="${bufKey}" style="--buf:${BUFFER_COLORS[type]}" title="Bật/tắt vùng phủ" aria-label="Bật/tắt vùng phủ ${label}" aria-pressed="${bufOn ? 'true' : 'false'}">●</button>`
      : '<span class="htkt-legend-buf-slot" aria-hidden="true"></span>';
    return `<div class="htkt-legend-row">${mark}<span>${label}</span>${buf}<input type="checkbox" data-xh-mirror="${id}"${on ? ' checked' : ''} aria-label="${label}"></div>`;
  }).join('');
  const status = `<div class="legend-status"><span><img class="layer-type-icon" src="./icons/Park.png" alt="" width="14" height="16">Đã phê duyệt</span><span><img class="layer-type-icon" src="./icons/Park2.png" alt="" width="14" height="16">Chờ duyệt</span></div>`;
  return rows + status;
}

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
    const axisNow = document.getElementById('layerMain')?.dataset.active || '';
    const hatang = axisNow === 'hatang';
    const xahoi = axisNow === 'xahoi';
    const dautu = axisNow === 'dautu';
    frame.classList.toggle('is-htkt', hatang);
    frame.classList.toggle('is-xh', xahoi);
    frame.classList.toggle('is-dt', dautu);
    const htktLegend = document.getElementById('legendHtkt');
    if (htktLegend) htktLegend.hidden = !hatang;
    const xhLegend = document.getElementById('legendXh');
    if (xhLegend) {
      xhLegend.hidden = !xahoi;
      const rows = document.getElementById('legendXhRows');
      if (xahoi && rows) rows.innerHTML = socialLegendHtml();
    }
    const dtLegend = document.getElementById('legendDauTu');
    if (dtLegend) {
      dtLegend.hidden = !dautu;
      if (dautu) dtLegend.innerHTML = dauTuLegendHtml();
    }
    const main = frame.querySelector('.legend-main');
    if (main) main.hidden = (xahoi || dautu) ? true : (hatang ? false : !symbols);
    const display = document.querySelector('#tabLegend .legend-display');
    if (display) display.hidden = hatang || xahoi || dautu || !land;
    const pointHost = document.getElementById('legendPoints');
    const pointList = document.getElementById('legendPointList');
    const pointRows = [...document.querySelectorAll('.infra-point input[type="checkbox"]:checked')]
      .filter(inp => inp.id !== 'chk_c13' && inp.id !== 'chk_c14' && inp.id !== 'chk_invest');
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
      pointHost.hidden = xahoi || dautu || pointRows.length === 0;
    }
    const roads = document.getElementById('legendRoads');
    if (roads) roads.hidden = !checked('chk_roads');
    const extra = document.getElementById('legendExtra');
    const extraOn = !xahoi && !dautu && (pointRows.length > 0 || checked('chk_roads'));
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
    // File input kiến trúc không đổi chú giải; sync lúc này dễ kéo lệch cuộn panel/dock.
    if (e.target?.type === 'file' || e.target?.closest?.('.arch-file, [data-arch-photo], [data-arch-pdf-file]')) return;
    const mirror = e.target?.dataset?.xhMirror;
    if (mirror) {
      const src = document.getElementById(mirror);
      if (src && src.checked !== e.target.checked) {
        src.checked = e.target.checked;
        src.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }
    const id = e.target?.id || '';
    if (e.target?.checked && (/^chk_c\d+$/.test(id) || id === 'chk_invest' || id === 'chk_nt_funeral' || id === 'chk_nt_grave')) delete frame?.dataset.userHide;
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
