// Giới thiệu tổng quan (nút góc trên trái): giới thiệu webapp + mục lục 5 nhóm tính năng, mỗi mục có hướng dẫn và nút mở thẳng tính năng.
// Mục có demo: nút «Xem trên bản đồ» chạy chuỗi thao tác trực tiếp kèm thuyết minh (overviewDemo.js).
// Mở tính năng bằng cách bấm hộ nút / tab / ô tick sẵn có trên giao diện, không đụng trạng thái nội bộ của module khác.
// Tự hiện ở lần mở trang đầu; ô "Không tự hiện" dùng chung khóa với introTour.js.
import { ico, showToast, escapeHtml, fmtNum, fmtPct } from './utils.js';
import { map, handleInspectPointClick, zoomToPoint } from './mapEngine.js';
import { ensureWardStats } from './uiComponents.js';
import { planMap, getViewMode, isSplitOn } from './planMap.js';
import { openIntroTour } from './introTour.js';
import { qhpkCoverRows } from './qhpkCover.js';
import { floodReport } from './floodSim.js';
import { startDemo, flash, openLayerTab } from './overviewDemo.js';

const STORAGE_KEY = 'qhhue_intro_off';
// Khung tọa độ TP. Huế (WGS84): chặn nhập đảo thứ tự hoặc nhập nhầm tọa độ VN-2000
const HUE_BOUNDS = { latMin: 15.9, latMax: 16.85, lngMin: 106.9, lngMax: 108.3 };

const STATUS = {
  trial: 'Thử nghiệm',
  dev: 'Đang phát triển',
  plan: 'Dự kiến'
};
const BUTTONS = {
  guide: ['help', 'Hướng dẫn'],
  report: ['chart', 'Xem báo cáo'],
  map: ['map', 'Xem bản đồ'],
  result: ['bulb', 'Xem kết quả đề xuất']
};

// ---------- Mở tính năng có sẵn ----------
const $ = (id) => document.getElementById(id);

function showLayer(chkId, tabs) {
  openLayerTab(tabs);
  const chk = $(chkId);
  if (!chk) return;
  if (!chk.checked) chk.click();
  const row = chk.closest('.layer-row') || chk;
  row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  flash(row);
}

function pressTool(id, isOn) {
  const btn = $(id);
  if (!btn) return;
  if (!isOn(btn)) btn.click();
  flash(btn);
}
const inspectOn = () => pressTool('btnInspectMode', b => b.classList.contains('active'));
const reviewOn = () => pressTool('btnReviewOpen', b => b.getAttribute('aria-pressed') === 'true');

function showBottomPage(page) {
  if (document.body.classList.contains('bottom-collapsed')) $('btnExpandBottomPanel')?.click();
  document.querySelector(`#part2Dots i[data-page="${page}"]`)?.click();
  flash(document.querySelector('.bp-part2'));
}

function parseLatLng(text) {
  const nums = String(text || '').match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length !== 2) return null;
  let [lat, lng] = nums.map(Number);
  if (lat > 90) [lat, lng] = [lng, lat];
  return { lat, lng };
}

const inHue = ({ lat, lng }) => lat >= HUE_BOUNDS.latMin && lat <= HUE_BOUNDS.latMax
  && lng >= HUE_BOUNDS.lngMin && lng <= HUE_BOUNDS.lngMax;

// Xem quy hoạch (không chia đôi) thì bản đồ quy hoạch phủ kín → tra cứu trên planMap
function lookupAt({ lat, lng }) {
  const target = planMap && getViewMode() === 'QH' && !isSplitOn() ? planMap : map;
  if (!target) return;
  inspectOn();
  target.setView([lat, lng], Math.max(target.getZoom(), 17));
  handleInspectPointClick(lat, lng, target);
}

// ---------- Trình diễn trên bản đồ ----------
const HUE_CENTER = [16.4637, 107.5909];
const DEMO_SPOT = { lat: 16.4615, lng: 107.5955 };
const FLOOD_DEMO_M = 3;
const SCHOOL_CHKS = ['chk_c3', 'chk_c4', 'chk_c5', 'chk_c10'];
const SCHOOL_KINDS = { '3-MN': 'mầm non', '4-TH': 'tiểu học', '5-THCS': 'THCS', '6-THPT': 'THPT' };
const isActive = (b) => b.classList.contains('active');
const meters = (v) => `${fmtNum(Math.round(v * 10) / 10)} m`;
const floodedSchools = (r) => (r ? r.flooded.filter(f => SCHOOL_KINDS[f.kind]) : []);

function floodSchoolsHtml(r) {
  if (!r) return '<p>Chưa lấy được kết quả mô phỏng.</p>';
  const total = r.all.filter(f => SCHOOL_KINDS[f.kind]).length;
  const hit = floodedSchools(r);
  if (!hit.length) return `<p>Ở mực nước ${meters(r.level)} chưa có trường hiện trạng đã duyệt nào trong vùng ngập (tổng ${total} trường).</p>`;
  const byKind = Object.entries(SCHOOL_KINDS)
    .map(([k, label]) => [label, hit.filter(f => f.kind === k).length])
    .filter(([, n]) => n).map(([label, n]) => `${n} ${label}`).join(', ');
  const deepest = hit.slice(0, 3).map(f => `${escapeHtml(f.name)} (sâu ${meters(f.depth)})`).join('; ');
  const pop = r.pop != null
    ? `<li>Khoảng <b>${fmtNum(Math.round(r.pop / 10) * 10)} người</b>${r.popAll ? ` (${fmtPct(r.pop / r.popAll * 100)} dân số)` : ''} sống trong vùng ngập, diện tích ngập ≈ <b>${fmtNum(Math.round(r.area / 1e5) / 10)} km²</b>.</li>`
    : '';
  return `<p>Đây là <b>kịch bản giả định</b>: nước dâng tới cao độ ${meters(r.level)} thì <b class="c-red">${hit.length}/${total} trường</b>
    hiện trạng nằm trong vùng ngập (${byKind}).</p>
    <ul><li>Ngập sâu nhất: ${deepest}.</li>${pop}
    <li>Danh sách đủ ở panel phải › <b>Mô phỏng ngập</b>; bấm từng dòng để phóng tới trường.</li></ul>`;
}

const FLOOD_DEMO = {
  title: `Kịch bản ngập ${FLOOD_DEMO_M} m và trường học`,
  scenes: [
    {
      title: 'Chuyển sang bản đồ hiện trạng',
      run: (d) => { d.view('HT'); d.fly(HUE_CENTER, 12); },
      text: '<p>Kịch bản ngập xét trên các công trình <b>đang hoạt động</b>, nên bản đồ chuyển sang <b>Bản đồ hiện trạng thành phố Huế</b> (tiêu đề giữa phía trên) và đưa về khu vực trung tâm.</p>'
    },
    {
      title: `Giả định mực nước ${FLOOD_DEMO_M} m`,
      run: async (d) => {
        d.check('chk_flood', { pane: 'env' });
        d.range('floodLevel', FLOOD_DEMO_M);
        await d.wait(800);
      },
      text: `<p>Panel phải › <b>Bản đồ môi trường</b> › <b>Mô phỏng ngập</b> đã bật, thanh <b>Mực nước</b> đặt <b>${FLOOD_DEMO_M} m</b>.
        Mọi ô đất có cao độ nền thấp hơn ${FLOOD_DEMO_M} m được tô xanh theo độ sâu: xanh nhạt ngập nông, xanh đậm ngập sâu.</p>
        <p class="ovd-note">Cao độ nền FABDEM (ô 30 m, hệ EGM2008), không phải số đọc mực nước tại trạm thủy văn.</p>`
    },
    {
      title: 'Bật tem các trường học',
      run: (d) => SCHOOL_CHKS.forEach(id => d.check(id, { main: 'infra' })),
      text: '<p>Panel phải › <b>Công trình</b> đã bật 4 nhóm <b>Mầm non, Tiểu học, THCS, THPT</b>. Trường nằm trong vùng ngập được đánh <b class="c-red">chấm đỏ</b> ngay tại tem công trình.</p>'
    },
    {
      title: `Các trường bị ngập khi nước lên ${FLOOD_DEMO_M} m`,
      run: async (d) => { d.data.flood = await floodReport(); },
      text: (d) => floodSchoolsHtml(d.data.flood)
    },
    {
      title: 'Trường ngập sâu nhất',
      run: (d) => { const top = floodedSchools(d.data.flood)[0]; if (top) d.point(top); },
      text: (d) => {
        const top = floodedSchools(d.data.flood)[0];
        if (!top) return '<p>Không có trường nào trong vùng ngập để phóng tới.</p>';
        return `<p><b>${escapeHtml(top.name)}</b>: cao độ nền thấp hơn mực nước giả định khoảng <b>${meters(top.depth)}</b>.
          Bảng thông tin trường mở sẵn (quy mô, bán kính phục vụ) làm cơ sở cân nhắc tôn nền, chống ngập hoặc bố trí điểm trường thay thế.</p>
          <p class="ovd-note">Bấm <b>Kết thúc</b> để trả bản đồ về như trước, hoặc <b>Giữ bản đồ</b> để tự kéo mực nước, xem các trường khác.</p>`;
      }
    }
  ]
};

const TERRAIN_DEMO = {
  title: 'Địa hình và hướng thoát nước',
  scenes: [
    {
      title: 'Phủ lớp cao độ nền',
      run: (d) => { d.view('HT'); d.fly(HUE_CENTER, 11); d.check('chk_terrain', { pane: 'env' }); },
      text: '<p>Panel phải › <b>Bản đồ môi trường</b> › <b>Địa hình (cao độ nền)</b> đã bật: màu thể hiện cao độ, vùng trũng thấp ven phá Tam Giang và hạ lưu sông Hương nổi rõ. Di chuột trên bản đồ để đọc cao độ tại vị trí.</p>'
    },
    {
      title: 'Hướng dòng chảy và lưu vực',
      run: (d) => { d.check('chk_drainage', { pane: 'env' }); d.check('chk_basin', { pane: 'env' }); },
      text: `<p>Bật thêm <b>Thoát nước, khe tụ thủy</b> và <b>Lưu vực, đường phân thủy</b>: nước mặt dồn theo các khe tụ về vùng trũng,
        đường phân thủy chia ranh lưu vực — căn cứ xem xét san nền, hướng tuyến thoát nước khi bố trí quy hoạch.</p>
        <p class="ovd-note">Mô hình FABDEM ô 30 m, sai số khoảng ±1,0 m; không thay thế số liệu đo đạc địa hình.</p>`
    }
  ]
};

const PRIORITY_DEMO = {
  title: 'Vùng cần ưu tiên đầu tư hạ tầng',
  scenes: [
    {
      title: 'Bản đồ độ phủ hạ tầng',
      run: (d) => { d.view('HT'); d.fly(HUE_CENTER, 12); d.check('chk_heat', { pane: 'base' }); },
      text: '<p>Panel phải › <b>Bản đồ nền</b> › <b>Bản đồ độ phủ hạ tầng</b> đã bật: mỗi vị trí tô theo số nhóm hạ tầng tiếp cận được trong bán kính QCVN 01:2026/BXD (1–8 nhóm); màu càng nhạt càng thiếu.</p>'
    },
    {
      title: 'Chồng lớp phân bổ dân cư',
      run: (d) => d.check('chk_pop', { pane: 'base' }),
      text: `<p>Bật thêm <b>Phân bổ dân cư</b>: khu <b>đông dân</b> nằm trên vùng <b>độ phủ thấp</b> là nơi nên ưu tiên bố trí công trình mới.
        Bảng tổng hợp phía dưới cho biết phường, xã còn thiếu chỉ tiêu m²/người.</p>
        <p class="ovd-note">Độ phủ chỉ tính công trình đã được Admin phê duyệt; vùng đệm tròn theo bán kính quy chuẩn.</p>`
    }
  ]
};

const ACCESS_DEMO = {
  title: 'Tra cứu tiếp cận hạ tầng tại 1 vị trí',
  scenes: [
    {
      title: 'Bật chế độ tra cứu',
      run: (d) => { d.view('HT'); d.press('btnInspectMode', isActive); },
      text: '<p>Nút <b>Tra cứu</b> (con trỏ) trên thanh công cụ trái đã bật. Ở chế độ này, bấm vào bất kỳ vị trí nào trên bản đồ để xem vị trí đó được phục vụ bởi những nhóm hạ tầng nào.</p>'
    },
    {
      title: 'Tra một vị trí mẫu',
      run: async (d) => {
        d.fly([DEMO_SPOT.lat, DEMO_SPOT.lng], 16);
        await d.wait(1500);
        if (d.alive()) handleInspectPointClick(DEMO_SPOT.lat, DEMO_SPOT.lng, map);
      },
      text: `<p>Bảng kết quả liệt kê nhóm hạ tầng <b>đã tiếp cận</b> (vị trí nằm trong bán kính phục vụ theo QCVN 01:2026/BXD) và nhóm <b>còn thiếu</b>,
        kèm tuyến đường tới công trình gần nhất.</p>
        <p class="ovd-note">Chỉ tính công trình đã được Admin phê duyệt. Bấm <b>Giữ bản đồ</b> để tự tra các vị trí khác.</p>`
    }
  ]
};

// Cơ sở có phương án tốt nhất, ưu tiên khu đất lớn
async function topCsd() {
  const wards = await ensureWardStats();
  return (wards || []).flatMap(w => (w.csdItems || []).map(c => ({ ...c, ward: w.Ten_Phuong })))
    .filter(c => Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng)) && !c.needsApproval
      && (c.suggestions || []).some(s => s.status === 'eligible'))
    .sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0))[0] || null;
}

const CSD_DEMO = {
  title: 'Đề xuất công năng cơ sở nhà đất dôi dư',
  scenes: [
    {
      title: 'Các cơ sở chưa sử dụng',
      run: (d) => { d.view('HT'); d.fly(HUE_CENTER, 12); d.check('chk_c9', { main: 'infra' }); },
      text: '<p>Panel phải › <b>Công trình</b> › <b>12. Cơ sở chưa sử dụng</b> đã bật: các cơ sở nhà đất dôi dư sau sắp xếp hiện trên bản đồ.</p>'
    },
    {
      title: 'Phương án cho khu đất lớn nhất',
      run: async (d) => {
        d.data.csd = await topCsd();
        const c = d.data.csd;
        if (c) d.point({ lat: Number(c.lat), lng: Number(c.lng), name: c.name });
      },
      text: (d) => {
        const c = d.data.csd;
        if (!c) return '<p>Chưa có cơ sở đã duyệt nào có phương án chuyển đổi phù hợp.</p>';
        const best = c.suggestions.find(s => s.status === 'eligible');
        return `<p><b>${escapeHtml(c.name || 'Khu đất chưa sử dụng')}</b> (${escapeHtml(c.ward)}, ${fmtNum(c.size)} m²): thuật toán thử chuyển sang từng loại hạ tầng xã hội,
          phương án tốt nhất là <b class="c-green">${escapeHtml(best.label)}</b> vì bù được nhiều nhất phần thiếu hụt của phường.</p>
          <p class="ovd-note">Bảng thông tin trên bản đồ liệt kê đủ phương án; bấm <b>Xem thuyết minh</b> để xem vùng phục vụ và dân cư được tính.</p>`;
      }
    }
  ]
};

// ---------- Nội dung ----------
const REPORT_STEPS = [
  'Tổng hợp ranh các đồ án đã được phê duyệt (panel phải › <b>Quy hoạch</b>) theo cấp độ quy hoạch.',
  'Hợp nhất ranh, loại phần chồng lấn giữa các đồ án, cắt theo ranh 40 phường, xã.',
  'Tính tỷ lệ theo từng địa bàn và toàn thành phố, chốt số liệu tại kỳ báo cáo năm.'
];
const REPORT_FACTS = [
  'Chưa đủ ranh các đồ án được phê duyệt nên chưa công bố số liệu.',
  'Kỳ báo cáo: năm, số liệu tính đến ngày 31/12.'
];
const AREA_COLS = ['Địa bàn', 'Diện tích phải phủ (ha)', 'Diện tích đã phủ (ha)', 'Tỷ lệ (%)'];
const openPlanList = { label: 'Mở danh sách đồ án', icon: 'layers', run: () => openLayerTab({ main: 'plan' }) };

const SECTIONS = [
  {
    icon: 'inspect',
    title: 'Tra cứu thông tin quy hoạch, hạ tầng',
    items: [
      {
        id: 'parcel', btn: 'guide', status: 'trial',
        title: 'Tra cứu thông tin 1 thửa đất',
        note: 'Dữ liệu bản đồ địa chính năm 2016 theo GisHue, chưa có các huyện cũ: Quảng Điền, Phú Lộc, Nam Đông',
        lead: 'Tra một thửa đất theo số tờ, số thửa hoặc bấm trên bản đồ để xem diện tích, loại đất, địa chỉ; kiểm tra quy hoạch trên thửa: diện tích từng loại đất quy hoạch (m²) và chỉ tiêu các lô quy hoạch.',
        steps: [
          'Ở panel phải › <b>Bản đồ nền</b>, bật lớp <b>Thửa đất địa chính 2016</b> (nút bên dưới). Ranh thửa hiện từ mức phóng 15, số thửa hiện từ mức 18.',
          'Tìm thửa: chọn xã/phường (địa giới cũ), nhập số tờ, số thửa rồi bấm <b>Tìm</b>; hoặc phóng tới vị trí (có thể nhập tọa độ vào ô bên dưới) và bấm vào thửa.',
          'Bảng thông tin thửa: diện tích hồ sơ, loại đất theo Thông tư 28/2014/TT-BTNMT, địa chỉ, xã/phường cũ; thửa được viền vàng trên bản đồ.',
          'Kiểm tra quy hoạch: bấm <b>Xem chỉ tiêu quy hoạch</b> trong bảng thửa. Webapp cắt ranh thửa với lô quy hoạch các đồ án đã nạp, trả về diện tích từng loại đất quy hoạch (m², %), phần chưa có lô quy hoạch và từng lô kèm chỉ tiêu tầng cao, mật độ xây dựng, hệ số sử dụng đất (nếu đồ án có).',
          'Đang xem bản đồ quy hoạch: bấm vào thửa nằm trên lô vẫn mở bảng thửa; tắt lớp thửa để xem bảng lô như trước.'
        ],
        facts: [
          'Dữ liệu thửa từ gis21.hue.gov.vn (lập năm 2016), không gồm thông tin chủ sử dụng; chỉ để tham khảo.',
          'Quy hoạch chỉ tính các đồ án đã nạp vào webapp và đang hiện; đồ án chồng nhau ưu tiên đồ án phạm vi nhỏ hơn (chi tiết hơn).',
          'Diện tích quy hoạch tính trên hình thửa (sai số ranh khoảng 0,5 m) nên có thể lệch nhẹ so với diện tích hồ sơ.'
        ],
        coord: true,
        actions: [{ label: 'Bật lớp thửa đất', icon: 'parcel', run: () => showLayer('chk_cadastre', { pane: 'base' }) }, openPlanList]
      },
      {
        id: 'access', btn: 'guide', status: 'trial', demo: ACCESS_DEMO,
        title: 'Tra cứu mức độ tiếp cận hạ tầng tại 1 vị trí theo tọa độ',
        lead: 'Cho biết một vị trí đã nằm trong bán kính phục vụ của những nhóm hạ tầng nào theo QCVN 01:2026/BXD, nhóm nào còn thiếu, kèm tuyến đường tới công trình gần nhất.',
        steps: [
          'Bấm nút <b>Tra cứu</b> (biểu tượng con trỏ) trên thanh công cụ bên trái, hoặc nhập tọa độ vào ô bên dưới.',
          'Bấm vào vị trí cần xem trên bản đồ: bảng kết quả liệt kê nhóm hạ tầng đã tiếp cận và nhóm còn thiếu.',
          'Đang xem bản đồ quy hoạch thì kết quả tính theo công trình quy hoạch, có đối chiếu với hiện trạng.',
          'Bấm lại nút Tra cứu để tắt chế độ.'
        ],
        facts: [
          'Bán kính phục vụ xác định theo QCVN 01:2026/BXD, theo loại, cấp và quy mô từng công trình.',
          'Chỉ tính công trình đã được Admin phê duyệt.'
        ],
        coord: true,
        actions: [{ label: 'Bật chế độ tra cứu', icon: 'inspect', run: inspectOn }]
      },
      {
        id: 'service', btn: 'guide', status: 'trial',
        title: 'Đánh giá khả năng phục vụ của 1 công trình hạ tầng',
        lead: 'Dựng vùng phục vụ thực tế của công trình theo mạng lưới đường và ước tính số dân được phục vụ, đối chiếu với bán kính quy chuẩn.',
        steps: [
          'Ở panel phải › <b>Công trình</b>, bật nhóm công trình cần đánh giá.',
          'Bấm vào biểu tượng công trình để mở bảng thông tin: quy mô hiện trạng, quy hoạch và bán kính phục vụ.',
          'Bấm nút <b>Xem vùng / bán kính phục vụ</b> trong bảng: webapp bật chế độ âm bản, dựng phạm vi đi tới được theo đường giao thông và tính dân số phục vụ.',
          'Nút tròn cạnh tên nhóm bật vùng phủ của cả nhóm để so sánh với các công trình lân cận.'
        ],
        facts: [
          'Vùng phục vụ tính trên mạng đường OpenStreetMap và tuyến Admin bổ sung (thuật toán Dijkstra).',
          'Dân số phục vụ lấy từ lớp phân bổ dân cư đã hiệu chỉnh.'
        ],
        actions: [{ label: 'Mở danh sách công trình', icon: 'layers', run: () => openLayerTab({ main: 'infra' }) }]
      }
    ]
  },
  {
    icon: 'table',
    title: 'Hỗ trợ thẩm định quy hoạch mới, rà soát quy hoạch hiện hành',
    items: [
      {
        id: 'qcvn', btn: 'guide', status: 'dev',
        title: 'Kiểm tra chỉ tiêu theo QCVN 01:2026/BXD',
        note: 'So sánh Hiện trạng sử dụng đất và Quy hoạch sử dụng đất. Tính toán chỉ tiêu dân số. Cần xuất file .dwg thành .dxf để đọc (hatch và ranh giới quy hoạch).',
        lead: 'Đọc bản vẽ hiện trạng và quy hoạch của đồ án, tổng hợp cơ cấu sử dụng đất và đối chiếu chỉ tiêu đất hạ tầng xã hội với QCVN 01:2026/BXD.',
        steps: [
          'Bấm nút <b>Thẩm định đồ án</b> (nút màu cam đầu thanh công cụ bên trái).',
          'Chọn loại hồ sơ QHC 1/10.000 hoặc QHPK 1/2.000, nhập dân số hiện trạng, dân số quy hoạch và hệ tọa độ VN-2000.',
          'Trong AutoCAD, lưu bản vẽ thành 2 file <b>HT-&lt;mã&gt;.dxf</b> và <b>QH-&lt;mã&gt;.dxf</b> (≤ 5 MB), tên layer hatch theo Thông tư 16/2025/TT-BXD.',
          'Bấm <b>Đồng ý gửi thẩm định</b>: bảng kết quả hiện ở nửa dưới màn hình, ranh lô hiện trên bản đồ để đối chiếu.'
        ],
        facts: [
          'Chưa đọc trực tiếp định dạng .dwg; cần xuất bản vẽ sang .dxf.',
          'Layer đặt tên không đúng quy ước phải chọn loại đất thủ công.'
        ],
        actions: [{ label: 'Mở công cụ thẩm định', icon: 'table', run: reviewOn }]
      },
      {
        id: 'local-adjust', btn: 'guide', status: 'trial',
        title: 'Thẩm định điều chỉnh cục bộ',
        note: 'Nhập file .dxf chứa ranh giới điều chỉnh, hatch các loại đất sau khi điều chỉnh.',
        lead: 'Chọn đồ án đang điều chỉnh, nộp ranh khu vực và hatch sử dụng đất mới. Máy kiểm tra phạm vi, bảng tăng giảm và chỉ tiêu cả đồ án. Độ phủ bán kính tính ngầm.',
        steps: [
          'Bấm nút <b>Thẩm định đồ án</b> (nút màu cam đầu thanh công cụ bên trái), chọn <b>Điều chỉnh</b>.',
          'Chọn đồ án trong danh sách, nhập dân số quy hoạch và file DXF (layer ranh có chữ RANH, hatch đất theo Thông tư 16).',
          'Bấm <b>Thẩm định điều chỉnh</b>. Kết quả dựng thành tờ bản vẽ: hai bản vẽ trước / sau, bảng cơ cấu sử dụng đất, bảng chỉ tiêu, cột ký hiệu và khung tên. Chỉ tiêu tụt dưới 100% ghi Không đảm bảo.',
          'Bấm <b>Xuất PDF A3</b> để tải tờ bản vẽ khổ A3 ngang đem in.',
          'Đồng ý kết quả thì bấm <b>Nhập hồ sơ</b> (kèm PDF scan Quyết định, bản vẽ dưới 2 MB nếu có). Admin ghi thẳng, người dùng thường gửi vào hàng chờ duyệt.',
          'Trên bản đồ quy hoạch, ranh điều chỉnh là nét đứt magenta, nền sọc nghiêng. Bấm vào ranh để thể hiện theo điều chỉnh (che nền, vẽ lô mới) hoặc xem PDF.'
        ],
        facts: [
          'Phạm vi nằm ngoài ranh đồ án thì dừng, không tính tiếp.',
          'Độ phủ (đất ở nằm trong bán kính phục vụ) giảm xuống dưới 100% thì có một dòng thông báo. Hai hình chỉ so sánh sử dụng đất.'
        ],
        actions: [{ label: 'Mở công cụ thẩm định', icon: 'table', run: reviewOn }]
      },
      {
        id: 'gis16', btn: 'guide', status: 'trial',
        title: 'Kiểm tra hồ sơ GIS theo Phụ lục II Thông tư 16/2025',
        note: 'Hỗ trợ kiểm tra thư mục hồ sơ trên máy tính.',
        lead: 'Chọn thư mục HoSoGIS để đối chiếu bốn gói dữ liệu, tên lớp, kiểu hình và sáu trường thuộc tính bắt buộc.',
        steps: [
          'Bấm nút <b>Thẩm định đồ án</b> (nút màu cam đầu thanh công cụ bên trái), chọn <b>Hồ sơ GIS</b>.',
          'Bấm <b>Chọn thư mục HoSoGIS</b> (Chrome hoặc Edge). Hộp thoại có thể ghi tải lên — file vẫn chỉ đọc trên máy.',
          'Bấm <b>Kiểm tra thành phần</b>. Bảng ở nửa dưới màn hình ghi Không đạt, Cảnh báo hoặc Đạt.'
        ],
        facts: [
          'Đọc trên máy, không gửi file đi. File Geodatabase (.gdb) chưa mở được bên trong.',
          'Shapefile chỉ đọc đầu file .shp, file .dbf và .prj. Phần tọa độ bỏ qua.',
          'Thiếu chuyên đề trong Phần 3 là cảnh báo, vì danh mục đó là tham khảo.'
        ],
        actions: [{ label: 'Mở công cụ thẩm định', icon: 'table', run: reviewOn }]
      },
      {
        id: 'terrain', btn: 'guide', status: 'dev', demo: TERRAIN_DEMO,
        title: 'Chồng lớp bản đồ địa hình',
        note: 'Dữ liệu vệ tinh kích thước ô 30 m × 30 m, sai số ±1,0 m',
        lead: 'Phủ lớp cao độ nền lên bản đồ để xem xét san nền, hướng thoát nước và khu vực trũng thấp khi bố trí quy hoạch.',
        steps: [
          'Panel phải › <b>Bản đồ môi trường</b> › bật <b>Địa hình (cao độ nền)</b>.',
          'Kéo thanh trượt để chỉnh độ trong suốt; di chuột trên bản đồ để đọc cao độ tại vị trí.',
          'Bật thêm <b>Thoát nước, khe tụ thủy</b> và <b>Lưu vực, đường phân thủy</b> để xem hướng dòng chảy.'
        ],
        facts: [
          'Mô hình cao độ FABDEM ô lưới khoảng 30 m (đã loại nhà và tán cây), hệ cao độ EGM2008.',
          'Sai số khoảng ±1,0 m; là cao độ trung bình ô lưới, không thay thế số liệu đo đạc địa hình.'
        ],
        actions: [{ label: 'Bật lớp địa hình', icon: 'terrain', run: () => showLayer('chk_terrain', { pane: 'env' }) }]
      },
      {
        id: 'flood', btn: 'guide', status: 'dev', demo: FLOOD_DEMO,
        title: 'Chồng lớp bản đồ ngập lụt và giả định kịch bản ngập',
        lead: 'Giả định mực nước để khoanh vùng có nguy cơ ngập, đối chiếu với vùng ngập thực tế qua các mùa lũ từ ảnh radar vệ tinh.',
        steps: [
          'Panel phải › <b>Bản đồ môi trường</b> › bật <b>Mô phỏng ngập</b>, kéo thanh <b>Mực nước</b> (0,5–15 m) để xem vùng ngập và thống kê diện tích.',
          'Bật <b>Ngập thực tế (Sentinel-1)</b> và chọn mùa lũ để xem vùng đã ngập trong thực tế.',
          'Bật <b>Công trình chịu rủi ro ngập / nhiệt</b> để lọc công trình nằm trong vùng ngập nhiều mùa lũ.'
        ],
        facts: [
          'Mực nước giả định theo hệ cao độ EGM2008, không phải số đọc tại trạm thủy văn.',
          'Radar khó nhận diện ngập giữa khu nhà ở dày đặc.'
        ],
        actions: [{ label: 'Bật mô phỏng ngập', icon: 'flood', run: () => showLayer('chk_flood', { pane: 'env' }) }]
      },
      {
        id: 'pop', btn: 'guide', status: 'dev',
        title: 'Chồng lớp bản đồ phân bổ dân cư',
        note: 'Dữ liệu WorldPop kích thước lớn',
        lead: 'Thể hiện phân bổ dân cư theo ô lưới, làm cơ sở tính dân số được phục vụ và đánh giá nhu cầu hạ tầng khi lập quy hoạch.',
        steps: [
          'Panel phải › <b>Bản đồ nền</b> › bật <b>Phân bổ dân cư</b>; kéo thanh trượt để chỉnh độ trong suốt.',
          'Kết hợp với lớp công trình và bản đồ độ phủ để nhận diện khu đông dân còn thiếu hạ tầng.',
          'Admin hiệu chỉnh pixel dân cư (xóa vùng không có dân, thêm khu dân cư mới) tại thẻ <b>Đề xuất › Admin</b>.'
        ],
        facts: [
          'Nguồn WorldPop, dung lượng lớn nên lần tải đầu có thể chậm.',
          'Tổng dân số mỗi phường giữ nguyên khi hiệu chỉnh pixel.'
        ],
        actions: [{ label: 'Bật lớp dân cư', icon: 'users', run: () => showLayer('chk_pop', { pane: 'base' }) }]
      },
      {
        id: 'forest', btn: 'guide', status: 'plan',
        title: 'Chồng lớp phủ thực vật, hiện trạng rừng',
        note: 'Cảnh báo quy hoạch chuyển mục đích sử dụng đất rừng',
        lead: 'Dự kiến bổ sung lớp phủ thực vật và hiện trạng rừng để cảnh báo lô quy hoạch chồng lấn lên đất rừng, cần xem xét khi chuyển mục đích sử dụng đất.',
        stepsTitle: 'Lộ trình dự kiến',
        steps: [
          'Bổ sung lớp hiện trạng rừng (ranh 3 loại rừng) và lớp phủ thực vật từ ảnh vệ tinh.',
          'Chồng ranh lô quy hoạch với lớp rừng, tính diện tích chồng lấn của từng lô.',
          'Cảnh báo trong bảng thẩm định khi đồ án có lô chuyển mục đích từ đất rừng.'
        ],
        facts: ['Hiện có thể tham khảo lớp <b>Đất xây dựng (vệ tinh)</b> để xem biến động đất xây dựng qua các năm.'],
        actions: [{ label: 'Xem lớp Đất xây dựng (vệ tinh)', icon: 'sat', run: () => showLayer('chk_newdev', { pane: 'base' }) }]
      }
    ]
  },
  {
    icon: 'chart',
    title: 'Báo cáo thống kê ngành xây dựng theo năm',
    items: [
      {
        id: 'qhc', btn: 'report', status: 'dev',
        title: 'Tỷ lệ phủ kín quy hoạch chung (QHC)',
        lead: 'Tỷ lệ diện tích đã có quy hoạch chung được phê duyệt trên tổng diện tích phải lập quy hoạch chung.',
        stepsTitle: 'Phương pháp tổng hợp', steps: REPORT_STEPS, facts: REPORT_FACTS, cols: AREA_COLS, actions: [openPlanList]
      },
      {
        id: 'qhpk', btn: 'report', status: 'trial', qhpkCover: true,
        title: 'Tỷ lệ phủ kín quy hoạch phân khu (QHPK)',
        lead: 'Mỗi đô thị có tỷ lệ phủ kín riêng: tổng diện tích đã lập quy hoạch phân khu trong phạm vi đô thị chia cho diện tích đồ án quy hoạch chung của đô thị đó.',
        stepsTitle: 'Phương pháp tổng hợp',
        steps: [
          'Lấy ranh đồ án QHC của từng đô thị (panel phải › <b>Quy hoạch</b> › QHC 1/10.000); đô thị chưa nạp đồ án QHC hoặc đồ án chưa có ranh GIS (ranh tự dựng theo đường bao lô) tạm lấy phạm vi lập QHC: ranh các phường, xã theo nhu cầu lập quy hoạch, riêng Phong Điền theo ranh thị xã Phong Điền cũ (QĐ 614).',
          'Cắt ranh các đồ án QHPK 1/2.000 đã nạp theo ranh đô thị, hợp nhất để phần chồng lấn giữa các đồ án chỉ tính một lần.',
          'Tỷ lệ phủ kín = diện tích QHPK trong đô thị / diện tích đồ án QHC của đô thị. Vùng lõi 1/10.000 và 5 khu vực đô thị xếp dưới QHC thành phố Huế.'
        ],
        facts: [
          'Chỉ tính đồ án đã nạp vào webapp; số liệu tạm tính đến hiện tại, chốt tại kỳ báo cáo năm (31/12).',
          'Đồ án QHPK thuộc phường, xã khi các lô đất có trên 50% diện tích nằm trong phường cộng lại đạt từ 5 ha (lô vắt ranh lớn đã tách theo phường khi nhập); đồ án liên phường đếm ở mỗi đô thị có phường đạt ngưỡng. Phần ranh lấn nhỏ hơn chỉ cộng vào diện tích.',
          'Lần mở đầu cần khoảng 10 giây để hợp nhất ranh các đồ án; các lần sau dùng lại kết quả đến khi danh mục đồ án thay đổi.',
          'Đồ án QHC đã nạp chưa gắn được với đô thị nào được tính riêng trên ranh của chính đồ án.'
        ],
        actions: [openPlanList]
      },
      {
        id: 'qhct', btn: 'report', status: 'dev',
        title: 'Tỷ lệ phủ kín quy hoạch chi tiết (QHCT)',
        lead: 'Tỷ lệ diện tích đã có quy hoạch chi tiết được phê duyệt trên diện tích phải lập quy hoạch chi tiết.',
        stepsTitle: 'Phương pháp tổng hợp', steps: REPORT_STEPS, facts: REPORT_FACTS, cols: AREA_COLS, actions: [openPlanList]
      },
      {
        id: 'qcqlkt', btn: 'report', status: 'dev',
        title: 'Tỷ lệ lập Quy chế quản lý kiến trúc',
        lead: 'Tỷ lệ đô thị, điểm dân cư nông thôn đã ban hành Quy chế quản lý kiến trúc trên tổng số phải lập theo Luật Kiến trúc.',
        stepsTitle: 'Phương pháp tổng hợp',
        steps: [
          'Lập danh mục quy chế quản lý kiến trúc đã ban hành: số, ngày quyết định, phạm vi áp dụng.',
          'Đối chiếu với danh mục đô thị, điểm dân cư phải lập quy chế.',
          'Tính tỷ lệ theo địa bàn và toàn thành phố, chốt số liệu tại kỳ báo cáo năm.'
        ],
        facts: ['Chưa có danh mục quy chế đã ban hành trong webapp nên chưa công bố số liệu.', REPORT_FACTS[1]],
        cols: ['Địa bàn', 'Số phải lập', 'Đã ban hành', 'Tỷ lệ (%)']
      }
    ]
  },
  {
    icon: 'flag',
    title: 'Theo dõi mức trưởng thành đô thị, chỉ tiêu phân loại đô thị',
    items: [
      {
        id: 'urbanClass', btn: 'report', status: 'trial',
        title: 'Kiểm soát mức độ đáp ứng chỉ tiêu hạ tầng hiện tại theo tiêu chí phân loại đô thị',
        lead: 'Hiện trạng 14 đô thị và 21 phường theo Quyết định 614/QĐ-UBND; chấm 16 đô thị theo tiêu chí Nghị quyết 111/2025/UBTVQH15, so với mục tiêu 2030 tại Quyết định 756/QĐ-UBND.',
        steps: [
          'Mở bảng tổng hợp phía dưới, chuyển sang trang <b>Tiêu chí phân loại đô thị</b>; chọn <b>Hiện trạng 2026</b> hoặc <b>Mục tiêu 2030</b>.',
          'Chọn phường, xã trong danh sách để xem chi tiết từng tiêu chuẩn: đạt, chưa đạt, điểm số.',
          'Bấm biểu tượng máy in trên thanh tiêu đề bảng để xuất báo cáo PDF.'
        ],
        facts: [
          'Loại I chấm đạt / không đạt; loại II, III chấm điểm theo Bảng 2A, công nhận khi đạt từ 75 điểm.',
          'Tiêu chuẩn chưa có số liệu trong webapp được để trống chờ cập nhật.'
        ],
        actions: [{ label: 'Xem báo cáo', icon: 'flag', run: () => showBottomPage(1) }]
      },
      {
        id: 'maturity', btn: 'report', status: 'trial',
        title: 'Kiểm soát mức độ trưởng thành đô thị',
        note: 'Tạm theo dõi qua 24 chỉ tiêu đô thị tăng trưởng xanh',
        lead: 'Theo dõi mức độ hoàn thiện của đô thị qua bộ 24 chỉ tiêu xây dựng đô thị tăng trưởng xanh (4 nhóm) theo Thông tư 01/2018/TT-BXD, hợp nhất với Thông tư 09/2025/TT-BXD.',
        steps: [
          'Mở bảng tổng hợp phía dưới, chuyển sang trang <b>Chỉ tiêu tăng trưởng xanh</b>.',
          'Chọn phường, xã để xem riêng; chỉ tiêu có dữ liệu trong webapp được tính tự động.',
          'Chỉ tiêu cần số liệu báo cáo của các ngành được để dạng khung chờ cập nhật.'
        ],
        facts: [
          'Khu vực đô thị tính theo các phường thuộc bộ chỉ tiêu đô thị.',
          'Chỉ số trưởng thành theo từng đô thị đo ở trang Quy hoạch chung (mục dưới).'
        ],
        actions: [{ label: 'Xem báo cáo', icon: 'leaf', run: () => showBottomPage(2) }]
      },
      {
        id: 'generalPlan', btn: 'report', status: 'dev',
        title: 'Quy hoạch chung từng đô thị và chỉ số trưởng thành đô thị',
        lead: 'Quy hoạch chung là cấp trung gian giữa Quyết định 756/QĐ-UBND và QHPK 1/2.000, xác lập chỉ tiêu phân loại, nâng cấp đô thị. QHC thành phố Huế (loại I) lập cho toàn thành phố, vùng lõi 1/10.000 gồm khu vực trung tâm, Hương Thủy, Hương Trà, Hóa Châu, Mỹ Thượng; đô thị vệ tinh Phong Điền, Chân Mây và 7 đô thị loại III lập QHC riêng.',
        steps: [
          'Panel phải › <b>Lớp dữ liệu</b> › tab <b>QHC</b>: bấm một quy hoạch chung hoặc khu vực vùng lõi để vẽ phạm vi trên bản đồ và mở hồ sơ.',
          'Bảng tổng hợp phía dưới, trang <b>Quy hoạch chung</b>: tổng quan 10 QHC theo nhóm (thành phố, đô thị vệ tinh, đô thị loại III), 5 khu vực vùng lõi xếp dưới QHC thành phố Huế; bấm tên để xem hồ sơ, phân vùng 1/10.000 – 1/25.000, các QHPK 1/2.000 triển khai và chỉ số trưởng thành.',
          'Chỉ số trưởng thành = hiện trạng so với chỉ tiêu QHC (khu vực vùng lõi: chỉ tiêu do QHC thành phố Huế quy định); chưa có chỉ tiêu thì so với mức tối đa Bảng 2A Nghị quyết 111/2025/UBTVQH15 của loại đô thị định hướng.'
        ],
        facts: [
          'Hồ sơ QHC (quyết định, thời hạn, chỉ tiêu) đang để khung chờ cập nhật.',
          'Đồ án tên bắt đầu bằng "QHC" được xếp cấp QHC 1/10.000 và tự gắn vào quy hoạch chung tương ứng.'
        ],
        actions: [{ label: 'Xem báo cáo', icon: 'map', run: () => showBottomPage(3) }]
      },
      {
        id: 'priority', btn: 'map', status: 'trial', demo: PRIORITY_DEMO,
        title: 'Đề xuất các vùng cần ưu tiên đầu tư hạ tầng',
        lead: 'Bản đồ độ phủ cho biết mỗi vị trí tiếp cận được bao nhiêu nhóm hạ tầng; vùng màu nhạt mà đông dân là vùng nên ưu tiên đầu tư.',
        steps: [
          'Panel phải › <b>Bản đồ nền</b> › bật <b>Bản đồ độ phủ hạ tầng</b>; thanh màu thể hiện số nhóm hạ tầng tiếp cận được (1–8).',
          'Bật thêm <b>Phân bổ dân cư</b> để nhận diện khu đông dân nằm trong vùng độ phủ thấp.',
          'Dùng ô <b>Giả lập bán kính chung</b> để thử kịch bản bán kính phục vụ khác.',
          'Bảng tổng hợp phía dưới cho biết phường, xã còn thiếu chỉ tiêu m²/người.'
        ],
        facts: [
          'Độ phủ chỉ tính công trình đã được Admin phê duyệt.',
          'Bản đồ độ phủ dùng vùng đệm tròn theo bán kính QCVN; vùng phục vụ bám đường xem ở từng công trình.'
        ],
        actions: [{ label: 'Xem bản đồ độ phủ', icon: 'heat', run: () => showLayer('chk_heat', { pane: 'base' }) }]
      }
    ]
  },
  {
    icon: 'bulb',
    title: 'Thuật toán đề xuất xử lý cho cơ sở dôi dư sau sắp xếp',
    items: [
      {
        id: 'csd', btn: 'result', status: 'trial', csdTable: true, demo: CSD_DEMO,
        title: 'Đề xuất công năng cho Cơ sở nhà đất dôi dư',
        lead: 'Với mỗi cơ sở dôi dư (nhóm 12. Cơ sở chưa sử dụng), thuật toán thử chuyển đổi sang từng loại hạ tầng xã hội và xếp hạng theo mức bù đắp phần thiếu hụt của phường theo quy hoạch. Bảng dưới tổng hợp chức năng đề xuất của từng khu đất, nhóm theo phường, xã.',
        steps: [
          'Bấm tên khu đất trong bảng để phóng tới vị trí và mở bảng thông tin của cơ sở.',
          'Bảng thông tin liệt kê các phương án chuyển đổi, phương án tốt nhất gắn nhãn <b>Ưu tiên hàng đầu</b>.',
          'Mỗi phương án nêu phần quy mô (m²/người) và độ phủ dân số được bổ sung; loại không đủ diện tích tối thiểu bị loại.',
          'Bấm <b>Xem thuyết minh</b> để xem vùng phục vụ, công trình cùng loại lân cận đã trừ, vùng còn trống và pixel dân cư được tính.'
        ],
        facts: [
          'Kết quả là gợi ý kỹ thuật, cần cấp có thẩm quyền xem xét, phê duyệt.',
          'Cơ sở chưa được Admin duyệt gắn nhãn <b>Cần phê duyệt</b>; bảng thông tin trên bản đồ chỉ chạy thuật toán cho cơ sở đã duyệt.'
        ],
        actions: [{
          label: 'Xem trên bản đồ', icon: 'map',
          run: () => {
            showLayer('chk_c9', { main: 'infra' });
            showToast('Bấm vào biểu tượng cơ sở chưa sử dụng trên bản đồ để xem phương án đề xuất', 'info');
          }
        }]
      }
    ]
  }
];

const ITEMS = new Map();
SECTIONS.forEach((sec, si) => sec.items.forEach(it => ITEMS.set(it.id, { ...it, section: si })));

// ---------- Giao diện ----------
let root = null;
let els = null;
let current = null;

const badge = (status) => `<span class="ov-badge ${status}">${STATUS[status]}</span>`;

function itemHtml(it) {
  const [icon, label] = BUTTONS[it.btn];
  return `<div class="ov-item">
    <div class="ov-item-main">
      <div class="ov-item-title">${it.title}</div>
      <div class="ov-item-meta">${badge(it.status)}${it.note ? `<span class="ov-item-note">${it.note}</span>` : ''}</div>
    </div>
    <div class="ov-item-btns">
      ${it.demo ? `<button type="button" class="ov-btn ov-btn-demo" data-ov-demo="${it.id}" title="Tự thao tác trên bản đồ kèm thuyết minh">${ico('map')}Xem trên bản đồ</button>` : ''}
      <button type="button" class="ov-btn" data-ov-item="${it.id}">${ico(icon)}${label}</button>
    </div>
  </div>`;
}

function listHtml() {
  return `
    <div class="ov-groups">
      ${SECTIONS.map((sec, i) => `<section class="ov-group">
        <header class="ov-group-head">
          <span class="ov-group-no">${i + 1}</span>
          <span class="ov-group-ico">${ico(sec.icon)}</span>
          <h3 class="ov-group-title">${sec.title}</h3>
        </header>
        ${sec.items.map(itemHtml).join('')}
      </section>`).join('')}
    </div>`;
}

function reportTableHtml(cols) {
  return `<div class="ov-card ov-report">
    <div class="ov-card-title">${ico('table')}Mẫu biểu báo cáo năm ${new Date().getFullYear()}</div>
    <table class="ov-table">
      <thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
      <tbody><tr><td>Toàn thành phố</td>${cols.slice(1).map(() => '<td>—</td>').join('')}</tr></tbody>
    </table>
    <div class="ov-table-note">Chưa có số liệu: biểu sẽ tự điền khi đủ dữ liệu đầu vào.</div>
  </div>`;
}

// Bảng cơ sở dôi dư: csdItems của getWardStats (cùng nguồn mục D bảng tổng hợp phường), gợi ý đã xếp hạng sẵn ở máy chủ
function csdSuggestionHtml(csd) {
  const sugg = csd.suggestions || [];
  const commercial = sugg.find(s => s.status === 'commercial');
  if (commercial) {
    return `<b class="c-orange">${escapeHtml(commercial.label)}</b>${commercial.note ? `<small>${escapeHtml(commercial.note)}</small>` : ''}`;
  }
  const [first, second] = sugg.filter(s => s.status === 'eligible');
  if (!first) return '<i class="c-muted">Chưa có gợi ý phù hợp</i>';
  const gain = first.basis === 'scale'
    ? `bù thiếu quy mô: ${fmtPct(first.currentScalePct)} → ${fmtPct(Math.min(100, first.currentScalePct + first.scaleAddPct))}`
    : `+${fmtPct(first.scaleAddPct)} quy mô · +${fmtPct(first.coverageAddPct)} độ phủ${first.coverageMethod === 'estimate' ? ' (ước lượng)' : ''}`;
  return `<b class="c-green">${escapeHtml(first.label)}</b><small>${gain}</small>${second ? `<small>Phương án 2: ${escapeHtml(second.label)}</small>` : ''}`;
}

function csdTableHtml(wards) {
  const groups = wards
    .map(w => ({ ward: w.Ten_Phuong, items: (w.csdItems || []).slice().sort((a, b) => (b.size || 0) - (a.size || 0)) }))
    .filter(g => g.items.length)
    .sort((a, b) => a.ward.localeCompare(b.ward, 'vi'));
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (!total) return '<div class="ov-table-note">Chưa có cơ sở nhà đất dôi dư nào trong dữ liệu.</div>';
  const area = groups.reduce((s, g) => s + g.items.reduce((t, c) => t + (Number(c.size) || 0), 0), 0);
  let stt = 0;
  const rows = groups.map(g => `<tr class="ov-csd-ward"><td colspan="4">${escapeHtml(g.ward)} <small>· ${g.items.length} cơ sở</small></td></tr>
    ${g.items.map(c => {
      const lat = Number(c.lat), lng = Number(c.lng);
      const name = escapeHtml(c.name || 'Khu đất chưa sử dụng');
      const link = Number.isFinite(lat) && Number.isFinite(lng)
        ? `<button type="button" class="link-btn" data-ov-zoom data-lat="${lat}" data-lng="${lng}" data-name="${name}" title="Phóng tới vị trí khu đất">${name}</button>`
        : name;
      return `<tr><td>${++stt}</td><td>${link}${c.needsApproval ? '<small class="c-orange">Cần phê duyệt</small>' : ''}</td>
        <td>${fmtNum(c.size)}</td><td class="ov-csd-sugg">${csdSuggestionHtml(c)}</td></tr>`;
    }).join('')}`).join('');
  return `<div class="ov-table-note ov-csd-sum">${total} cơ sở · ${groups.length} phường, xã · tổng ${fmtNum(area)} m²</div>
    <div class="ov-csd-wrap"><table class="ov-table ov-csd">
      <thead><tr><th>STT</th><th>Tên khu đất</th><th>Diện tích (m²)</th><th>Chức năng đề xuất</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function fillCsdTable(box) {
  ensureWardStats()
    .then(wards => { if (box.isConnected) box.innerHTML = csdTableHtml(wards || []); })
    .catch(err => { if (box.isConnected) box.innerHTML = `<div class="ov-table-note">Không tải được số liệu: ${escapeHtml(err.message || String(err))}</div>`; });
}

const haText = (m2) => (m2 == null ? '—' : fmtNum(m2 >= 1e6 ? Math.round(m2 / 1e4) : Math.round(m2 / 1e3) / 10));

function qhpkCoverHtml({ rows, qhpkCount }) {
  let group = '';
  const body = rows.map(r => {
    const head = r.group !== group ? `<tr class="ov-cover-group"><td colspan="5">${escapeHtml(group = r.group)}</td></tr>` : '';
    const src = r.total == null ? 'Chưa có ranh phạm vi'
      : r.covered == null ? 'Lỗi hình học khi cắt ranh, chưa tính được'
        : r.source ? `Ranh đồ án ${r.source}` : r.from614 ? 'Tạm theo ranh đô thị hiện trạng (QĐ 614)'
          : r.depth ? 'Phạm vi khu vực' : 'Phạm vi lập QHC';
    const pct = r.ratio == null ? '—' : fmtPct(r.ratio * 100);
    return `${head}<tr class="ov-cover-d${r.depth}"><td>${escapeHtml(r.label)}<small>${escapeHtml(src)}</small></td>
      <td>${haText(r.total)}</td><td>${haText(r.covered)}</td><td>${r.projects == null ? '—' : r.projects}</td>
      <td class="${r.ratio > 0 ? 'c-green' : ''}"><b>${pct}</b></td></tr>`;
  }).join('');
  return `<div class="ov-table-note ov-csd-sum">${qhpkCount} đồ án QHPK 1/2.000 đã nạp · số liệu tạm tính đến ${new Date().toLocaleDateString('vi-VN')}</div>
    <div class="ov-csd-wrap"><table class="ov-table ov-cover">
      <thead><tr><th>Đô thị</th><th>Diện tích đồ án QHC (ha)</th><th>Đã lập QHPK (ha)</th><th>Số đồ án QHPK</th><th>Tỷ lệ phủ kín</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

function fillQhpkCover(box) {
  const note = box.querySelector('.ov-table-note');
  qhpkCoverRows((text) => { if (note && note.isConnected) note.textContent = text; })
    .then(data => { if (box.isConnected) box.innerHTML = qhpkCoverHtml(data); })
    .catch(err => { if (box.isConnected) box.innerHTML = `<div class="ov-table-note">Không tính được số liệu: ${escapeHtml(err.message || String(err))}</div>`; });
}

function zoomCsd(btn) {
  const lat = Number(btn.dataset.lat), lng = Number(btn.dataset.lng);
  close();
  const chk = $('chk_c9');
  if (chk && !chk.checked) chk.click();
  zoomToPoint(lat, lng, btn.dataset.name || '');
}

function detailHtml(it) {
  const sec = SECTIONS[it.section];
  return `
    <nav class="ov-crumb">
      <button type="button" class="ov-back" data-ov-back>${ico('chev-left')}Tổng quan</button>
      <span class="ov-crumb-sec">${it.section + 1}. ${sec.title}</span>
    </nav>
    <h3 class="ov-detail-title">${it.title}${badge(it.status)}</h3>
    ${it.note ? `<p class="ov-detail-note">${ico('alert')}${it.note}</p>` : ''}
    <p class="ov-lead">${it.lead}</p>
    ${it.csdTable ? `<div class="ov-card ov-csd-card">
      <div class="ov-card-title">${ico('table')}Thống kê cơ sở nhà đất dôi dư</div>
      <div data-ov-csd><div class="ov-table-note">Đang tải số liệu các phường, xã…</div></div>
    </div>` : ''}
    ${it.qhpkCover ? `<div class="ov-card ov-csd-card">
      <div class="ov-card-title">${ico('table')}Tỷ lệ phủ kín QHPK theo đô thị</div>
      <div data-ov-qhpk><div class="ov-table-note">Đang tính diện tích các đồ án QHPK trong từng đô thị…</div></div>
    </div>` : ''}
    <div class="ov-detail-grid">
      <div class="ov-card">
        <div class="ov-card-title">${ico('book')}${it.stepsTitle || 'Các bước thực hiện'}</div>
        <ol class="ov-steps">${it.steps.map(s => `<li>${s}</li>`).join('')}</ol>
      </div>
      <div class="ov-card ov-card-warn">
        <div class="ov-card-title">${ico('info')}Dữ liệu và giới hạn</div>
        <ul class="ov-facts">${it.facts.map(f => `<li>${f}</li>`).join('')}</ul>
      </div>
    </div>
    ${it.cols ? reportTableHtml(it.cols) : ''}
    ${it.coord ? `<form class="ov-coord" data-ov-coord novalidate>
      <label for="ovCoord">${ico('pin')}Tọa độ vị trí</label>
      <input type="text" id="ovCoord" placeholder="VD: 16.4637, 107.5909" autocomplete="off" spellcheck="false"
        title="Vĩ độ, kinh độ theo WGS84 (độ thập phân, dấu chấm)">
      <button type="submit" class="ov-primary">${ico('inspect')}Tra cứu</button>
      <span class="ov-coord-msg" role="alert"></span>
    </form>` : ''}
    ${it.actions?.length || it.demo ? `<div class="ov-actions">
      ${it.demo ? `<button type="button" class="ov-primary" data-ov-demo="${it.id}">${ico('map')}Xem trình diễn trên bản đồ</button>` : ''}
      ${(it.actions || []).map((a, i) =>
        `<button type="button" class="${i || it.demo ? 'ov-ghost' : 'ov-primary'}" data-ov-act="${i}">${ico(a.icon)}${a.label}</button>`).join('')}</div>` : ''}`;
}

function showList() {
  current = null;
  root.classList.remove('ov-in-detail');
  els.body.innerHTML = listHtml();
  els.body.scrollTop = 0;
}

function showDetail(id) {
  const it = ITEMS.get(id);
  if (!it) return;
  current = it;
  root.classList.add('ov-in-detail');
  els.body.innerHTML = detailHtml(it);
  const csdBox = els.body.querySelector('[data-ov-csd]');
  if (csdBox) fillCsdTable(csdBox);
  const qhpkBox = els.body.querySelector('[data-ov-qhpk]');
  if (qhpkBox) fillQhpkCover(qhpkBox);
  els.body.scrollTop = 0;
  els.body.querySelector('.ov-back')?.focus({ preventScroll: true });
}

function runAction(idx) {
  const act = current?.actions?.[idx];
  if (!act) return;
  close();
  act.run();
}

function runDemo(id) {
  const def = ITEMS.get(id)?.demo;
  if (!def) return;
  close();
  startDemo(def);
}

function submitCoord(form) {
  const msg = form.querySelector('.ov-coord-msg');
  const pt = parseLatLng(form.querySelector('input').value);
  if (!pt) { msg.textContent = 'Nhập 2 số: vĩ độ, kinh độ (độ thập phân, dấu chấm), VD 16.4637, 107.5909.'; return; }
  if (!inHue(pt)) { msg.textContent = 'Tọa độ nằm ngoài phạm vi TP. Huế, kiểm tra lại hệ tọa độ (cần WGS84).'; return; }
  close();
  lookupAt(pt);
}

// version.json do bước build khi deploy ghi (scripts/write-version.js); chạy local không có file thì ẩn dòng version
function loadVersion(el) {
  fetch('./version.json', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(v => {
      if (!el || !v?.label) return;
      el.textContent = v.label;
      el.title = `Thời điểm triển khai bản web hiện tại${v.commit ? ` (commit ${v.commit})` : ''}`;
      el.hidden = false;
    })
    .catch(() => { /* chưa có version.json */ });
}

function build() {
  root = document.createElement('div');
  root.className = 'ov-root';
  root.hidden = true;
  root.innerHTML = `
    <div class="ov-dialog" role="dialog" aria-modal="true" aria-labelledby="ovTitle">
      <header class="ov-head">
        <span class="ov-mark">${ico('overview')}</span>
        <div class="ov-head-text">
          <div class="ov-kicker">Bản đồ quy hoạch và hạ tầng đô thị TP. Huế · Sở Xây dựng thành phố Huế</div>
          <h2 class="ov-title" id="ovTitle">GIỚI THIỆU TỔNG QUAN</h2>
        </div>
        <div class="ov-stage">
          <span class="ov-beta">${ico('clock')}Giai đoạn thử nghiệm</span>
          <span class="ov-ver" hidden></span>
        </div>
        <button type="button" class="ov-x" title="Đóng" aria-label="Đóng">${ico('close')}</button>
        <p class="ov-head-intro">Trang web có mục đích phi thương mại, được lập phục vụ công tác quản lý chuyên ngành của
        Phòng Quy hoạch Kiến trúc và Phát triển đô thị - Sở Xây dựng thành phố Huế và đang trong giai đoạn thử nghiệm.
        Trang cung cấp giải pháp cho các nhóm nghiệp vụ sau:</p>
      </header>
      <div class="ov-body"></div>
      <footer class="ov-foot">
        <label class="ov-off"><input type="checkbox"> Không tự hiện khi mở trang</label>
        <div class="ov-legend" aria-label="Chú thích trạng thái">
          <span>Trạng thái:</span>${Object.keys(STATUS).map(badge).join('')}
        </div>
        <div class="ov-foot-btns">
          <button type="button" class="ov-ghost" data-ov-tour>${ico('help')}Hướng dẫn thao tác cơ bản</button>
          <button type="button" class="ov-primary" data-ov-close>${ico('map')}Vào bản đồ</button>
        </div>
      </footer>
    </div>`;
  document.body.appendChild(root);
  els = { body: root.querySelector('.ov-body'), off: root.querySelector('.ov-off input') };
  loadVersion(root.querySelector('.ov-ver'));

  root.addEventListener('click', (e) => {
    if (e.target === root) { close(); return; }
    const t = e.target.closest('[data-ov-item], [data-ov-demo], [data-ov-back], [data-ov-act], [data-ov-zoom], [data-ov-tour], [data-ov-close], .ov-x');
    if (!t) return;
    if (t.dataset.ovItem) showDetail(t.dataset.ovItem);
    else if (t.dataset.ovDemo) runDemo(t.dataset.ovDemo);
    else if (t.hasAttribute('data-ov-zoom')) zoomCsd(t);
    else if (t.hasAttribute('data-ov-back')) showList();
    else if (t.dataset.ovAct != null) runAction(Number(t.dataset.ovAct));
    else if (t.hasAttribute('data-ov-tour')) { close(); openIntroTour(); }
    else close();
  });
  root.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-ov-coord]');
    if (!form) return;
    e.preventDefault();
    submitCoord(form);
  });
  els.off.addEventListener('change', () => {
    try { localStorage.setItem(STORAGE_KEY, els.off.checked ? '1' : '0'); } catch { /* chế độ riêng tư */ }
  });
  document.addEventListener('keydown', (e) => {
    if (!isOpen() || e.key !== 'Escape') return;
    if (current) showList();
    else close();
  });
}

const isOpen = () => !!root && !root.hidden;

export function openOverview(itemId) {
  if (!root) build();
  let off = false;
  try { off = localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* chế độ riêng tư */ }
  els.off.checked = off;
  root.hidden = false;
  $('btnOverview')?.setAttribute('aria-expanded', 'true');
  if (itemId && ITEMS.has(itemId)) showDetail(itemId);
  else {
    showList();
    root.querySelector('.ov-x')?.focus({ preventScroll: true });
  }
}

function close() {
  if (!root) return;
  root.hidden = true;
  const btn = $('btnOverview');
  btn?.setAttribute('aria-expanded', 'false');
  btn?.focus({ preventScroll: true });
}

export function initOverview() {
  $('btnOverview')?.addEventListener('click', () => (isOpen() ? close() : openOverview()));
  let off = false;
  try { off = localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* chế độ riêng tư */ }
  if (!off) setTimeout(() => { if (!document.querySelector('.tour-root:not([hidden])')) openOverview(); }, 1200);
}
