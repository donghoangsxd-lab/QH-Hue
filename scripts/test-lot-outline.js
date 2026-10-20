// Viền lô: quy hoạch 0.8px cùng màu tô; hiện trạng 1px cùng màu tô.
// Chỉ an ninh, quốc phòng và ba loại rừng trên nền vệ tinh có một nét 0.7px sáng hơn cùng hue, không quầng.
import { lightenTone, thinLightOutline, tt16SymbolStyle, landParcelStyle, isTransportLand, isNarrowStrip, TT16_STYLES } from '../public/js/tt16Symbols.js';
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

assert(!isLightBasemap(), 'mặc định là nền vệ tinh');
assert(thinLightOutline('QP') && thinLightOutline('AN') && thinLightOutline('RSX') && thinLightOutline('RPH') && thinLightOutline('RDD'), 'năm nhóm tối trên vệ tinh');
assert(thinLightOutline('C-QP') && thinLightOutline('T-RSX'), 'khóa quy hoạch chung và chi tiết cùng quy tắc');
assert(!thinLightOutline('1-CV') && !thinLightOutline('O-LX') && !thinLightOutline('NN'), 'loại khác không làm sáng');

function noHalo(style, msg) {
  assert(!style.casingColor && !style.casingWeight, msg);
}

const plan = tt16SymbolStyle('QP', dark, 'QHDD_DAT_Quocphong', { scenario: 'QH', detailed: false, approved: true });
assert(plan.fillColor === dark, 'tô giữ màu gốc');
assert(plan.color === lit, `viền quốc phòng trên vệ tinh sáng cùng hue (${plan.color})`);
assert(plan.weight === 0.7, `nét mỏng 0.7 (${plan.weight})`);
noHalo(plan, 'không quầng');
assert(!plan.dashArray, 'QHDD nét liền');

for (const key of ['AN', 'RSX', 'RPH', 'RDD']) {
  const row = tt16SymbolStyle(key, TT16_STYLES[key].color, 'QHDD_x', { scenario: 'QH', detailed: false, approved: true });
  assert(row.weight === 0.7 && row.color === lightenTone(TT16_STYLES[key].color) && row.fillColor === TT16_STYLES[key].color, `${key} nét sáng mỏng`);
  noHalo(row, `${key} không quầng`);
}

const tree = tt16SymbolStyle('1-CV', '#66cc00', 'QHDD_DAT_HTXH_CayxanhCC', { scenario: 'QH', detailed: false });
assert(tree.color === '#66cc00' && tree.weight === 0.8, 'cây xanh nét mảnh cùng màu tô');
noHalo(tree, 'cây xanh không quầng');

const hamlet = tt16SymbolStyle('O-LX', '#7f7f40', 'QHDD_DAT_O_Langxom', { scenario: 'QH', detailed: false });
assert(hamlet.color === '#7f7f40' && hamlet.weight === 0.8, 'làng xóm tối vẫn nét cùng màu tô');

const pending = tt16SymbolStyle('QP', dark, 'QHDD_DAT_Quocphong', { scenario: 'QH', detailed: false, approved: false });
assert(pending.color === '#f87171' && pending.dashArray === '4,4' && pending.weight === 0.8, 'chờ duyệt giữ viền đỏ nét đứt');
noHalo(pending, 'chờ duyệt không quầng');

const ht = tt16SymbolStyle('QP', dark, 'HT_DAT_Quocphong', { scenario: 'HT', detailed: false, approved: true });
assert(ht.weight === 0.7 && ht.color === lit, 'hiện trạng quốc phòng trên vệ tinh vẫn một nét sáng mỏng');
noHalo(ht, 'hiện trạng không quầng');
const htTree = tt16SymbolStyle('1-CV', '#66cc00', 'HT_DAT_HTXH_CayxanhCC', { scenario: 'HT', detailed: false });
assert(htTree.color === '#66cc00' && htTree.weight === 1, 'hiện trạng khác giữ nét 1px cùng màu tô');

const qhdh = tt16SymbolStyle('QP', dark, 'QHDH_DAT_Quocphong', { scenario: 'QH', detailed: false });
assert(qhdh.dashArray === '2.7,1.4' && qhdh.weight === 0.7 && qhdh.color === lit, 'dài hạn quốc phòng: nét đứt mỏng, sáng, không quầng');
noHalo(qhdh, 'dài hạn không quầng');
const qhdhLight = tt16SymbolStyle('1-CV', '#66cc00', 'QHDH_DAT_HTXH_CayxanhCC', { scenario: 'QH', detailed: false });
assert(qhdhLight.dashArray === '3.1,1.6' && qhdhLight.color === '#66cc00' && qhdhLight.weight === 0.8, 'dài hạn khác: nét đứt 0.8px cùng màu tô');

selectBasemap('positron');
assert(basemapLabel() === 'Bản đồ đường phố', 'nhãn nền đường phố');
assert(isLightBasemap() && !thinLightOutline('QP'), 'nền đường phố không viền sáng');
const onLight = tt16SymbolStyle('QP', dark, 'QHDD_DAT_Quocphong', { scenario: 'QH', detailed: false, approved: true });
assert(onLight.color === dark && onLight.weight === 0.8, 'quốc phòng trên nền nhạt: nét cùng màu tô');
noHalo(onLight, 'nền nhạt không quầng');
const htLight = tt16SymbolStyle('QP', dark, 'HT_DAT_Quocphong', { scenario: 'HT', detailed: false });
assert(htLight.color === dark && htLight.weight === 1, 'hiện trạng trên nền nhạt giữ màu gốc');
selectBasemap('google');
const back = tt16SymbolStyle('QP', dark, 'QHDD_DAT_Quocphong', { scenario: 'QH', detailed: false, approved: true });
assert(back.color === lit && back.weight === 0.7, 'đổi lại vệ tinh thì nét sáng mỏng trở lại');
noHalo(back, 'vệ tinh không quầng');

const bare = landParcelStyle('QH_Dat_khac_khong_ma', { phase: 'QH', detailed: false });
assert(bare.weight === 0.8 && bare.color === bare.fillColor, 'lô không khóa: nét mảnh cùng màu tô');
noHalo(bare, 'lô không khóa không quầng');

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
assert(canal.color === '#0066cc' && canal.weight === 0.8, 'mặt nước nét cùng màu tô');
noHalo(canal, 'mặt nước không quầng');

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

console.log('lot-outline: ok');
