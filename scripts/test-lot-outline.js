// Viền sáng + quầng chỉ cho lô màu tối (độ chói WCAG < OUTLINE_LUMA_MAX) trên nền vệ tinh.
// Nền nhạt và lô màu sáng giữ nét, màu, không quầng như trước khi làm sáng.
import { lightenTone, relativeLuminance, outlineBright, OUTLINE_LUMA_MAX, tt16SymbolStyle, landParcelStyle, isTransportLand, isNarrowStrip, TT16_STYLES } from '../public/js/tt16Symbols.js';
import { selectBasemap, isLightBasemap, basemapLabel, preferVietnameseLabels } from '../public/js/basemap.js';

function hsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h, s, l };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const dark = '#394c26';
const lit = lightenTone(dark);
const a = hsl(dark), b = hsl(lit);
assert(b.l > a.l + 0.2, `quốc phòng phải sáng hơn: ${dark} → ${lit}`);
assert(Math.abs(b.h - a.h) < 0.04, `giữ hue: ${a.h.toFixed(3)} → ${b.h.toFixed(3)}`);
assert(b.l < 0.8, `không trắng hóa: ${lit}`);

assert(relativeLuminance(dark) < OUTLINE_LUMA_MAX, 'quốc phòng dưới ngưỡng');
assert(relativeLuminance('#66cc00') > OUTLINE_LUMA_MAX, 'cây xanh công cộng trên ngưỡng');
assert(relativeLuminance('#00ff00') > OUTLINE_LUMA_MAX, 'nông nghiệp trên ngưỡng');
assert(relativeLuminance('#c0c0c0') > OUTLINE_LUMA_MAX, 'đất chưa sử dụng trên ngưỡng');
assert(relativeLuminance('#009900') > OUTLINE_LUMA_MAX, 'thể thao trên ngưỡng');
assert(relativeLuminance('#3f7f4f') < OUTLINE_LUMA_MAX, 'rừng sản xuất dưới ngưỡng');
assert(!isLightBasemap(), 'mặc định là nền vệ tinh');

const byColor = new Map();
Object.values(TT16_STYLES).forEach(s => {
  if (!/^#[0-9a-f]{6}$/i.test(s.color || '')) return;
  const row = byColor.get(s.color) || { color: s.color, y: relativeLuminance(s.color), labels: [] };
  row.labels.push(s.label);
  byColor.set(s.color, row);
});
const qualify = [...byColor.values()].filter(r => r.y < OUTLINE_LUMA_MAX).sort((p, q) => p.y - q.y);
const skip = [...byColor.values()].filter(r => r.y >= OUTLINE_LUMA_MAX);
assert(qualify.some(r => r.color === dark), 'quốc phòng nằm trong danh sách làm sáng');
assert(skip.some(r => r.color.toLowerCase() === '#66cc00'), 'cây xanh không làm sáng');

const plan = tt16SymbolStyle('QP', dark, 'QHDD_DAT_Quocphong', { scenario: 'QH', detailed: false, approved: true });
assert(plan.fillColor === dark, 'tô giữ màu gốc');
assert(plan.color === lit, `viền tối trên vệ tinh là màu đã làm sáng (${plan.color})`);
assert(plan.weight === 2.4, `nét dày 2.4 (${plan.weight})`);
assert(plan.casingColor && plan.casingWeight === 3.4, 'quầng sáng');
assert(!plan.dashArray, 'QHDD nét liền');

const tree = tt16SymbolStyle('1-CV', '#66cc00', 'QHDD_DAT_HTXH_CayxanhCC', { scenario: 'QH', detailed: false });
assert(tree.color === '#66cc00' && tree.weight === 1.8 && !tree.casingColor, 'cây xanh giữ viền gốc');

const pending = tt16SymbolStyle('QP', dark, 'QHDD_DAT_Quocphong', { scenario: 'QH', detailed: false, approved: false });
assert(pending.color === '#f87171' && pending.dashArray === '4,4' && pending.weight === 1.8 && !pending.casingColor, 'chờ duyệt giữ viền đỏ gốc');

const ht = tt16SymbolStyle('QP', dark, 'HT_DAT_Quocphong', { scenario: 'HT', detailed: false, approved: true });
assert(ht.weight === 1 && !ht.casingColor && ht.color === lit, 'hiện trạng tối chỉ sáng màu, nét mảnh, không quầng');

const qhdh = tt16SymbolStyle('QP', dark, 'QHDH_DAT_Quocphong', { scenario: 'QH', detailed: false });
assert(qhdh.dashArray === '9.3,4.7' && qhdh.casingColor, 'dài hạn tối: nét đứt theo nét 2.4 và quầng');
const qhdhLight = tt16SymbolStyle('1-CV', '#66cc00', 'QHDH_DAT_HTXH_CayxanhCC', { scenario: 'QH', detailed: false });
assert(qhdhLight.dashArray === '7,3.5' && qhdhLight.color === '#66cc00' && !qhdhLight.casingColor, 'dài hạn sáng: nét đứt gốc');

selectBasemap('positron');
assert(basemapLabel() === 'Bản đồ đường phố', 'nhãn nền đường phố');
assert(isLightBasemap() && !outlineBright(dark), 'nền đường phố tắt viền sáng');
const onLight = tt16SymbolStyle('QP', dark, 'QHDD_DAT_Quocphong', { scenario: 'QH', detailed: false, approved: true });
assert(onLight.color === dark && onLight.weight === 1.8 && !onLight.casingColor, 'cùng lô tối trên nền nhạt trở lại viền gốc');
const htLight = tt16SymbolStyle('QP', dark, 'HT_DAT_Quocphong', { scenario: 'HT', detailed: false });
assert(htLight.color === dark && htLight.weight === 1 && !htLight.casingColor, 'hiện trạng trên nền nhạt giữ màu gốc');
selectBasemap('google');
const back = tt16SymbolStyle('QP', dark, 'QHDD_DAT_Quocphong', { scenario: 'QH', detailed: false, approved: true });
assert(back.color === lit && back.casingColor, 'đổi lại vệ tinh thì viền sáng trở lại');

const bare = landParcelStyle('QH_Dat_khac_khong_ma', { phase: 'QH', detailed: false });
assert(!bare.casingColor && bare.weight === 1.8, 'lô không khóa, màu nhạt, giữ viền gốc');

function noRoadStroke(style, msg) {
  assert(style.stroke === false && style.weight === 0 && !style.casingColor, msg);
  assert(style.fillOpacity > 0 && style.fillOpacity < 0.5, `${msg}: tô mờ`);
}
const road = tt16SymbolStyle('GT', '#5b5b5b', 'QHDD_DAT_HTKT_DuongGT', { scenario: 'QH', detailed: true, approved: true });
noRoadStroke(road, 'đường giao thông không nét không quầng');
assert(road.color === '#5b5b5b' && road.fillColor === '#5b5b5b', 'đường giữ màu tô');
const alley = landParcelStyle('QHDD_DAT_CTHTKT_DuongGT', { phase: 'QH', detailed: true, name: 'Đất giao thông kiệt' });
noRoadStroke(alley, 'kiệt theo layer không nét');
const urbanGt = tt16SymbolStyle('C-GTDT', '#808080', 'QH_DAT_DD_Giaothongdothi', { scenario: 'QH', detailed: false });
noRoadStroke(urbanGt, 'giao thông đô thị không nét');
const outer = landParcelStyle('DAT_NDD_GiaothongDN', { phase: 'QH', detailed: true });
noRoadStroke(outer, 'giao thông đối ngoại không nét');
assert(isTransportLand('T-GT', '', '') && isTransportLand('', 'Đường giao thông', 'kiệt 12'), 'nhận lớp đường');
assert(!isTransportLand('NTR', 'DAT_HTKT_Nghiatrang', 'Nghĩa trang'), 'nghĩa trang không phải đường');
selectBasemap('positron');
const roadLight = tt16SymbolStyle('GT', '#5b5b5b', 'QHDD_DAT_HTKT_DuongGT', { scenario: 'QH', detailed: true });
noRoadStroke(roadLight, 'đường trên nền nhạt cũng không nét');
selectBasemap('google');

const strip = {
  type: 'Polygon',
  coordinates: [[[107.58, 16.47], [107.582, 16.47], [107.582, 16.47005], [107.58, 16.47005], [107.58, 16.47]]]
};
const block = {
  type: 'Polygon',
  coordinates: [[[107.58, 16.47], [107.581, 16.47], [107.581, 16.471], [107.58, 16.471], [107.58, 16.47]]]
};
assert(isNarrowStrip(strip), 'dải hẹp');
assert(!isNarrowStrip(block), 'lô vuông không phải dải');
const canal = tt16SymbolStyle('SS', '#0066cc', 'QHDD_DAT_KHAC_Songsuoi', { scenario: 'QH', detailed: false, geometry: strip });
assert(!canal.casingColor && canal.weight <= 1, 'kênh hẹp bỏ quầng');
const canalWide = tt16SymbolStyle('SS', '#0066cc', 'QHDD_DAT_KHAC_Songsuoi', { scenario: 'QH', detailed: false, geometry: block });
assert(canalWide.casingColor, 'mặt nước rộng vẫn có quầng');

const viStyle = preferVietnameseLabels({
  layers: [
    { id: 'road', layout: { 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']] } },
    { id: 'shield', layout: { 'text-field': ['get', 'ref'] } },
    { id: 'bg', paint: { 'background-color': '#fff' } }
  ]
});
const roadField = viStyle.layers[0].layout['text-field'];
assert(roadField[0] === 'coalesce' && roadField[1][1] === 'name:vi' && roadField[2][1] === 'name', 'nhãn ưu tiên name:vi rồi name');
assert(JSON.stringify(roadField[3]) === JSON.stringify(['coalesce', ['get', 'name_en'], ['get', 'name']]), 'giữ biểu thức tên sẵn có');
assert(JSON.stringify(viStyle.layers[1].layout['text-field']) === JSON.stringify(['get', 'ref']), 'biển số đường giữ ref');
assert(!viStyle.layers[2].layout, 'lớp không chữ không đổi');

console.log('lot-outline: ok', {
  threshold: OUTLINE_LUMA_MAX,
  dark: qualify.map(r => `${r.color} ${r.y.toFixed(3)} ${r.labels[0]}`),
  light: skip.map(r => `${r.color} ${r.labels[0]}`)
});
