// Giới thiệu tổng quan (nút góc trên trái): giới thiệu webapp + mục lục 5 nhóm tính năng, mỗi mục có hướng dẫn và nút mở thẳng tính năng.
// Mở tính năng bằng cách bấm hộ nút / tab / ô tick sẵn có trên giao diện, không đụng trạng thái nội bộ của module khác.
// Tự hiện ở lần mở trang đầu; ô "Không tự hiện" dùng chung khóa với introTour.js.
import { ico, showToast } from './utils.js';
import { map, handleInspectPointClick } from './mapEngine.js';
import { planMap, getViewMode, isSplitOn } from './planMap.js';
import { openIntroTour } from './introTour.js';

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

function flash(el) {
  if (!el) return;
  el.classList.remove('ov-flash');
  void el.offsetWidth;
  el.classList.add('ov-flash');
  setTimeout(() => el.classList.remove('ov-flash'), 2000);
}

function openLayerTab({ main, pane } = {}) {
  document.querySelector('.rp-tabs .tab-btn[data-tab="tabLayers"]')?.click();
  if (main) document.querySelector(`[data-main-tab="${main}"]`)?.click();
  if (pane) document.querySelector(`[data-map-tab="${pane}"]`)?.click();
}

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
        id: 'parcel', btn: 'guide', status: 'dev',
        title: 'Tra cứu thông tin 1 thửa đất',
        note: 'Chưa tích hợp API dữ liệu thửa đất, hiện chỉ tra cứu được theo tọa độ',
        lead: 'Định vị một vị trí theo tọa độ để xem lô quy hoạch tại đó và mức độ tiếp cận hạ tầng. Khi kết nối được cơ sở dữ liệu đất đai, tính năng sẽ tra cứu trực tiếp theo số tờ, số thửa.',
        steps: [
          'Nhập tọa độ (vĩ độ, kinh độ WGS84) vào ô bên dưới rồi bấm <b>Tra cứu</b>: bản đồ phóng tới và ghim vị trí.',
          'Ở panel phải › <b>Quy hoạch</b>, bật đồ án có ranh bao vị trí cần xem.',
          'Phóng to tới mức hiện ranh lô, bấm vào lô tại vị trí ghim để xem loại đất theo Thông tư 16/2025/TT-BXD, diện tích và chỉ tiêu lô (tầng cao, mật độ xây dựng, hệ số sử dụng đất nếu đồ án có).'
        ],
        facts: [
          'Chưa có số tờ, số thửa, thông tin chủ sử dụng: cần API cơ sở dữ liệu đất đai.',
          'Thông tin lô lấy từ các đồ án đã nạp vào webapp, chưa phải toàn bộ đồ án được duyệt.'
        ],
        coord: true,
        actions: [openPlanList]
      },
      {
        id: 'access', btn: 'guide', status: 'trial',
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
        note: 'Chưa tích hợp được file .dwg, cần thêm bước xuất ra file .dxf',
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
        id: 'terrain', btn: 'guide', status: 'dev',
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
        id: 'flood', btn: 'guide', status: 'dev',
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
        id: 'qhpk', btn: 'report', status: 'dev',
        title: 'Tỷ lệ phủ kín quy hoạch phân khu (QHPK)',
        lead: 'Tỷ lệ diện tích đã có quy hoạch phân khu được phê duyệt trên diện tích đất xây dựng đô thị theo quy hoạch chung.',
        stepsTitle: 'Phương pháp tổng hợp', steps: REPORT_STEPS, facts: REPORT_FACTS, cols: AREA_COLS, actions: [openPlanList]
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
        lead: 'Chấm 16 đô thị theo tiêu chí phân loại đô thị của Nghị quyết 111/2025/UBTVQH15, so với mục tiêu 2030 tại Quyết định 756/QĐ-UBND.',
        steps: [
          'Mở bảng tổng hợp phía dưới, chuyển sang trang <b>Tiêu chí phân loại đô thị</b>.',
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
          'Bộ tiêu chí đánh giá mức trưởng thành đô thị riêng đang được xây dựng.'
        ],
        actions: [{ label: 'Xem báo cáo', icon: 'leaf', run: () => showBottomPage(2) }]
      },
      {
        id: 'priority', btn: 'map', status: 'trial',
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
        id: 'csd', btn: 'result', status: 'trial',
        title: 'Đề xuất phương án sử dụng cho từng cơ sở nhà đất dôi dư',
        lead: 'Với mỗi cơ sở dôi dư (nhóm 12. Cơ sở chưa sử dụng), thuật toán thử chuyển đổi sang từng loại hạ tầng xã hội và xếp hạng theo mức bù đắp phần thiếu hụt của phường.',
        steps: [
          'Bật nhóm <b>12. Cơ sở chưa sử dụng</b> ở panel phải › <b>Công trình</b>.',
          'Bấm vào biểu tượng cơ sở đã duyệt: bảng thông tin liệt kê các phương án chuyển đổi, phương án tốt nhất gắn nhãn <b>Ưu tiên hàng đầu</b>.',
          'Mỗi phương án nêu phần quy mô (m²/người) và độ phủ dân số được bổ sung; loại không đủ diện tích tối thiểu bị loại.',
          'Bấm <b>Xem thuyết minh</b> để xem vùng phục vụ, công trình cùng loại lân cận đã trừ, vùng còn trống và pixel dân cư được tính.'
        ],
        facts: [
          'Kết quả là gợi ý kỹ thuật, cần cấp có thẩm quyền xem xét, phê duyệt.',
          'Cơ sở chưa được Admin duyệt không chạy thuật toán.'
        ],
        actions: [{
          label: 'Xem kết quả đề xuất', icon: 'bulb',
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
    <button type="button" class="ov-btn" data-ov-item="${it.id}">${ico(icon)}${label}</button>
  </div>`;
}

function listHtml() {
  return `
    <div class="ov-intro">
      ${ico('info')}
      <p><b>Giới thiệu chung:</b> Trang web có mục đích phi thương mại, được lập phục vụ công tác quản lý chuyên ngành của
      Sở Xây dựng thành phố Huế và đang trong giai đoạn thử nghiệm. Trang hỗ trợ xử lý các nhóm vấn đề chính sau đây:</p>
    </div>
    <div class="ov-legend" aria-label="Chú thích trạng thái">
      <span>Trạng thái:</span>${Object.keys(STATUS).map(badge).join('')}
    </div>
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
    ${it.actions?.length ? `<div class="ov-actions">${it.actions.map((a, i) =>
      `<button type="button" class="${i ? 'ov-ghost' : 'ov-primary'}" data-ov-act="${i}">${ico(a.icon)}${a.label}</button>`).join('')}</div>` : ''}`;
}

function showList() {
  current = null;
  els.body.innerHTML = listHtml();
  els.body.scrollTop = 0;
}

function showDetail(id) {
  const it = ITEMS.get(id);
  if (!it) return;
  current = it;
  els.body.innerHTML = detailHtml(it);
  els.body.scrollTop = 0;
  els.body.querySelector('.ov-back')?.focus({ preventScroll: true });
}

function runAction(idx) {
  const act = current?.actions?.[idx];
  if (!act) return;
  close();
  act.run();
}

function submitCoord(form) {
  const msg = form.querySelector('.ov-coord-msg');
  const pt = parseLatLng(form.querySelector('input').value);
  if (!pt) { msg.textContent = 'Nhập 2 số: vĩ độ, kinh độ (độ thập phân, dấu chấm), VD 16.4637, 107.5909.'; return; }
  if (!inHue(pt)) { msg.textContent = 'Tọa độ nằm ngoài phạm vi TP. Huế, kiểm tra lại hệ tọa độ (cần WGS84).'; return; }
  close();
  lookupAt(pt);
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
        <span class="ov-beta">${ico('clock')}Giai đoạn thử nghiệm</span>
        <button type="button" class="ov-x" title="Đóng" aria-label="Đóng">${ico('close')}</button>
      </header>
      <div class="ov-body"></div>
      <footer class="ov-foot">
        <label class="ov-off"><input type="checkbox"> Không tự hiện khi mở trang</label>
        <div class="ov-foot-btns">
          <button type="button" class="ov-ghost" data-ov-tour>${ico('help')}Hướng dẫn thao tác cơ bản</button>
          <button type="button" class="ov-primary" data-ov-close>${ico('map')}Vào bản đồ</button>
        </div>
      </footer>
    </div>`;
  document.body.appendChild(root);
  els = { body: root.querySelector('.ov-body'), off: root.querySelector('.ov-off input') };

  root.addEventListener('click', (e) => {
    if (e.target === root) { close(); return; }
    const t = e.target.closest('[data-ov-item], [data-ov-back], [data-ov-act], [data-ov-tour], [data-ov-close], .ov-x');
    if (!t) return;
    if (t.dataset.ovItem) showDetail(t.dataset.ovItem);
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
