import { readFileSync } from 'node:fs';
import { parseHeightIndex } from '../public/js/bldgHeight.js';
import { floorsFromHeight, planLimit, screenVerdict, buildupHtml, lotBuildupSlotHtml } from '../public/js/lotScreen.js';

const buf = readFileSync(new URL('../public/data/gba/bldg-hf.bin', import.meta.url));
const idx = parseHeightIndex(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const vin = idx.lookup(107.594238, 16.463008);
if (!(vin >= 150)) throw new Error(`Vinpearl ${vin}`);
if (floorsFromHeight(vin) !== 40) throw new Error(`tầng Vinpearl ${floorsFromHeight(vin)}`);
if (floorsFromHeight(67) !== 17) throw new Error('67 m');
if (planLimit({ coverage: 0.4, floors: '3-5', far: 2.5 }, 'coverage') !== 40) throw new Error('mật độ');
if (planLimit({ floors: '3-5' }, 'floors') !== 5) throw new Error('tầng');
const over = screenVerdict(55, 40, '%');
if (over.state !== 'over' || Math.abs(over.diff - 15) > 0.01) throw new Error('vượt');
const ok = screenVerdict(2, 3, 'tầng');
if (ok.state !== 'ok') throw new Error('đạt');
const html = buildupHtml({
  lotM2: 472.7, footM2: 2019, count: 16, minM: 15.2, maxM: 20.4
});
if (!html.includes('Số công trình trên đất') || !html.includes('16 công trình')) throw new Error(html);
if (!html.includes('Mật độ xây dựng') || !html.includes('Diện tích xây dựng')) throw new Error(html);
if (!html.includes('class="pp-row"') || html.includes('lot-line')) throw new Error('kết quả mật độ phải dùng .pp-row');
if (html.includes('Chiều cao') || html.includes('ảnh vệ tinh')) throw new Error('không được hiện chiều cao ảnh vệ tinh');
const slot = lotBuildupSlotHtml();
if (!slot.includes('data-lot-buildup') || slot.includes('data-lot-buildup-run')) {
  throw new Error('khung kết quả mật độ không được chứa nút chữ (nút nằm trên hàng icon)');
}
if (slot.includes('Đang đối chiếu')) throw new Error('nút không được tự đối chiếu');
const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
for (const rel of ['../public/js/mapEngine.js', '../public/js/qhctLayer.js']) {
  const file = src(rel);
  if (file.includes('Đang đối chiếu dấu chân')) throw new Error(`${rel} vẫn tự đối chiếu khi mở thẻ`);
  if (!file.includes('lotBuildupSlotHtml()')) throw new Error(`${rel} thiếu khung mật độ`);
}
const engine = src('../public/js/mapEngine.js');
if (!engine.includes('if (lotGeom) html += lotBuildupSlotHtml()')) throw new Error('lô hạ tầng thiếu khung mật độ');
if (!engine.includes('if (lotGeom) fillLotBuildup(popup, { geometry: lotGeom })')) throw new Error('lô hạ tầng không gắn phép tính mật độ');
{
  const toolsAt = engine.indexOf('buildup: !!lotGeom');
  const fillAt = engine.lastIndexOf('if (lotGeom) fillLotBuildup(popup, { geometry: lotGeom })');
  if (toolsAt < 0 || fillAt < 0 || toolsAt > fillAt) {
    throw new Error('icon mật độ phải gắn trước fillLotBuildup (tránh nút chữ trùng)');
  }
}
if (!engine.includes('pp-radius-btn') || !engine.includes('pp-buildup-btn')) {
  throw new Error('thiếu icon bán kính / mật độ trên bảng lô');
}
const landChunk = engine.slice(engine.indexOf('function landPopupHtml'), engine.indexOf('function landLotShape'));
if (landChunk.includes('point3dButton') || landChunk.includes('pp-3d') || landChunk.includes('Xem 3D')) {
  throw new Error('thẻ lô đất vẫn còn nút Xem 3D');
}
if (!landChunk.includes('metricGridHtml') || !landChunk.includes('landCardTabsHtml') || !landChunk.includes('regulationsPaneHtml')) {
  throw new Error('thẻ lô đất thiếu lưới 2×2 hoặc tab Chỉ tiêu/Quy định');
}
if (!landChunk.includes('facility') || !landChunk.includes('radiusLabel')) {
  throw new Error('thẻ lô đất chưa hỗ trợ lô hạ tầng / bán kính phục vụ');
}
if (engine.includes('lotActionsHtml(')) throw new Error('còn lotActionsHtml (nút chữ bán kính/3D)');
const infraLand = engine.includes('openLandPopup(lot, m, { facility: item })')
  || engine.includes('openLandPopup(lot, m, { ...opts, facility: item })');
if (!infraLand) throw new Error('lô hạ tầng chưa mở cùng thẻ lô đất');
const infraTools = engine.includes('facilityAnalyzeOpts')
  && (engine.includes('onAnalyze: analyze?.onAnalyze') || engine.includes('onAnalyze: canAnalyze ? runAnalysis : null'));
if (!infraTools) throw new Error('lô hạ tầng chưa gắn icon bán kính / mật độ');
const buildupSrc = src('../public/js/lotBuildup.js');
const attach = buildupSrc.split('export function attachLotBuildup')[1] || '';
const armBody = attach.split('const arm = ')[1] || attach;
const beforeRun = armBody.split('const run =')[0];
if (beforeRun.includes('compute(')) throw new Error('đối chiếu chạy trước khi bấm');
if (!attach.includes('el.textContent = LOADING')) throw new Error('thiếu trạng thái đang kiểm tra');
if (!attach.includes('hasBuildupIcon')) throw new Error('thiếu chặn nút chữ khi đã có icon mật độ');
if (!attach.includes('clearBuildupPanel') || !attach.includes("el.dataset.open === '1'")) {
  throw new Error('thiếu bấm lại icon mật độ để tắt bảng');
}
if (!buildupSrc.includes("const LOADING = 'Đang đối chiếu dấu chân công trình…'")) {
  throw new Error('thiếu câu đang đối chiếu');
}
if (!buildupSrc.includes('turf.difference') || !buildupSrc.includes('paintBuildup')) {
  throw new Error('thiếu cắt phần ngoài ranh và vẽ dấu chân / gạch đỏ');
}
const outNote = buildupHtml({ lotM2: 1000, footM2: 200, count: 2, outM2: 40 });
if (!outNote.includes('Ngoài ranh') || !outNote.includes('40')) throw new Error('thiếu dòng diện tích ngoài ranh');
const ui = src('../docs/ui-spec.md');
if (!ui.includes('không nút «Xem 3D»') || !ui.includes('bán kính phục vụ › mật độ xây dựng')) {
  throw new Error('ui-spec thiếu mô tả hàng icon bảng lô');
}
if (!ui.includes('gạch chéo đỏ') || !ui.includes('không tính vào mật độ')) {
  throw new Error('ui-spec thiếu mô tả cắt chân công trình ngoài ranh');
}
if (!ui.includes('hai tab «Chỉ tiêu» và «Quy định»') || !ui.includes('lưới 2×2')) {
  throw new Error('ui-spec thiếu mô tả tab và lưới chỉ tiêu thẻ lô');
}
console.log('ok', vin);
