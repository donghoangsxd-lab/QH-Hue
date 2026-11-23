import fs from 'fs';
import {
  clampRadius, parseCenter, circleRing, squareRing, clipRing, ringArea, shannon, clipSegment, tilesFor,
  floorsFromHeight, floorBin, parseHeightIndex,
  hexToClear, volumeColors, volumeEdgePaths, OPEN_CAMERA, DEFAULT_LIGHT, LIGHT_PRESETS, WALL, ROOF,
  filterMassing, namesMatch, treeCap, scatterTrees, treeStats, STREET_TREE_MIN_W, STREET_TREE_PLANT_W,
  JUNCTION_CLEAR_M, collectRoadJunctions, isPlantableStreet, roadWidthMeters, buildModel, osmDated
} from '../public/js/phanTich3d.js';

const clip = circleRing(100, 64);
const cut = clipRing([[-10, -10], [10, -10], [10, 10], [-10, 10]], clip);
const area = ringArea(cut);
if (Math.abs(area - 400) > 1) throw new Error(`diện tích vuông ${area}`);
if (clipRing([[200, 200], [220, 200], [220, 220], [200, 220]], clip)) throw new Error('vòng ngoài vòng tròn vẫn còn');

const h = shannon(new Map([['a', 10], ['b', 10]]));
if (Math.abs(h - Math.log(2)) > 1e-9) throw new Error(`shannon ${h}`);
if (shannon(new Map([['a', 5]])) !== null) throw new Error('một nhóm vẫn có chỉ số');

if (floorsFromHeight(4) !== 1 || floorsFromHeight(8) !== 2 || floorsFromHeight(0) !== null) {
  throw new Error(`số tầng ${floorsFromHeight(4)} ${floorsFromHeight(8)}`);
}
if (floorBin(2) !== 0 || floorBin(5) !== 1 || floorBin(10) !== 2 || floorBin(48) !== 3 || floorBin(61) !== 3) {
  throw new Error('nhóm tầng');
}
const sq = squareRing(100);
if (sq.length !== 4 || ringArea(sq) !== 40000) throw new Error('ô vuông');
const cutSq = clipRing([[-200, -200], [200, -200], [200, 200], [-200, 200]], squareRing(50));
if (Math.abs(ringArea(cutSq) - 10000) > 1) throw new Error(`cắt ô ${ringArea(cutSq)}`);
const cutDisc = clipRing([[-200, -200], [200, -200], [200, 200], [-200, 200]], circleRing(50, 64));
if (Math.abs(ringArea(cutDisc) - Math.PI * 2500) > 40) throw new Error(`cắt tròn ${ringArea(cutDisc)}`);

if (clampRadius('x') !== 500 || clampRadius(10) !== 150 || clampRadius(5000) !== 800) throw new Error('bán kính');
const p = parseCenter('?lat=16.4637&lng=107.5952&r=500&view=gop');
if (p.lat !== 16.4637 || p.lng !== 107.5952 || p.r !== 500 || p.view !== 'gop') throw new Error('tham số');
if (parseCenter('?lat=1&lng=1').lat !== 16.4637) throw new Error('tâm mặc định');
if (parseCenter('').view !== 'gop' || parseCenter('?view=tach').view !== 'tach' || parseCenter('?view=nope').view !== 'gop') {
  throw new Error('mặc định phải là gộp khối');
}
const neutral = volumeColors(2, false);
const tinted = volumeColors(2, true);
if (neutral.wall[0] !== WALL[0] || neutral.roof[0] !== ROOF[0]) throw new Error('palette gộp');
if (neutral.roof[0] >= neutral.wall[0] || neutral.roof[1] >= neutral.wall[1] || neutral.roof[2] >= neutral.wall[2]) {
  throw new Error('mái chưa đậm hơn tường');
}
if (tinted.wall[0] < 200 || tinted.roof[0] >= tinted.wall[0]) throw new Error('màu tầng');
const edges = volumeEdgePaths([{ rings: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]], h: 8, z0: 2 }]);
if (edges.length !== 5 || edges[0][0][2] !== 10 || edges[1][0][2] !== 2 || edges[1][1][2] !== 10) {
  throw new Error(`cạnh khối ${edges.length}`);
}
if (OPEN_CAMERA.rotationX !== 42 || OPEN_CAMERA.rotationOrbit !== -50) throw new Error('camera mở');
if (DEFAULT_LIGHT !== 'nhanh' || !LIGHT_PRESETS.nhanh) throw new Error('chế độ render nhanh');
{
  const preset = LIGHT_PRESETS.nhanh;
  if (!preset.css.canvas || !preset.ground.rim) throw new Error('preset nhanh');
  const clear = hexToClear(preset.css.canvas);
  if (Math.abs(clear[0] - 0.91) < 0.01 && Math.abs(clear[1] - 0.933) < 0.01) throw new Error('nền lạnh cũ');
  if ((clear[0] + clear[1] + clear[2]) / 3 > 0.45) throw new Error('nền 3D còn quá sáng');
}
if (!namesMatch('Meliá Vinpearl Huế (Vincom cùng khối)', 'Meliá Vinpearl Huế')) throw new Error('khớp tên Vinpearl');
if (!namesMatch('The Manor Crown A', 'The Manor Crown - Tower A')) throw new Error('khớp tên Manor');
{
  const sites = [
    { name: 'Meliá Vinpearl Huế', lng: 107.5942, lat: 16.4631 },
    { name: 'The Manor Crown - Tower A', lng: 107.6069, lat: 16.4633 }
  ];
  const rows = [
    { name: 'Meliá Vinpearl Huế (Vincom cùng khối)', drawn: true },
    { name: 'The Manor Crown A', drawn: true },
    { name: 'La Vela Hotel', drawn: false }
  ];
  const near = filterMassing(rows, sites, 16.4637, 107.5952, 800);
  if (near.length !== 1 || near[0].name.indexOf('Vinpearl') < 0) throw new Error(`lọc massing ${near.map((r) => r.name)}`);
  if (filterMassing(rows, sites, 16.4637, 107.5952, 150).length !== 1) throw new Error('Vinpearl trong 150 m');
}
const tiles = tilesFor(16.4637, 107.5952, 500);
if (tiles.length < 4 || tiles.length > 12) throw new Error(`số tile ${tiles.length}`);
const seg = clipSegment([-1000, 0], [1000, 0], 500);
const len = Math.hypot(seg[0][1][0] - seg[0][0][0], seg[0][1][1] - seg[0][0][1]);
if (Math.abs(len - 1000) > 1) throw new Error(`cắt đoạn ${len}`);

const html = fs.readFileSync(new URL('../public/phan-tich-3d.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../public/js/phanTich3d.js', import.meta.url), 'utf8');
for (const s of ['Tách lớp', 'Gộp khối', 'Khoảng cách lớp', 'phanTich3d.js']) {
  if (!html.includes(s)) throw new Error(`html thiếu ${s}`);
}
for (const s of ['Khối tích', 'Không gian mở', 'Tiếp cận hạ tầng', 'Liên kết', 'Không có số liệu.', 'h / 4', '1-2 tầng', '3-5 tầng', '6-10 tầng', '11-50 tầng', 'fovy: FOV_Y', 'Math.PI * r * r']) {
  if (!js.includes(s)) throw new Error(`js thiếu ${s}`);
}
if (js.includes('CLASS_DRAW') || js.includes('Không tính được.')) throw new Error('vẫn đùn theo nhóm hoặc chưa có mét');
const bin = fs.readFileSync(new URL('../public/data/gba/bldg-hf.bin', import.meta.url));
if (bin.slice(0, 4).toString() !== 'GBH2') throw new Error('thiếu chiều cao');
const idx = parseHeightIndex(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
let found = null;
for (let i = 0; i < 10; i++) {
  const h = idx.lookup(107.5952 + (i - 5) * 0.00035, 16.4637 + ((i % 4) - 1) * 0.00028);
  if (h) found = h;
}
if (found == null || found < 1 || found > 80) throw new Error(`chiều cao Hùng Vương ${found}`);
const vin = idx.lookup(107.594238, 16.463008);
if (vin < 150) throw new Error(`Vinpearl ${vin}`);
if (!js.includes('bldg-overrides.geojson')) throw new Error('thiếu dấu chân tháp bổ sung');
if (!js.includes('min_height') || !js.includes('z0')) throw new Error('thiếu khối đế nổi');
const ov = JSON.parse(fs.readFileSync(new URL('../public/data/gba/bldg-overrides.geojson', import.meta.url), 'utf8'));
const vinFeat = ov.features.find((f) => f.properties.id === 'vinpearl');
const vinParts = vinFeat.properties.parts;
const podium = vinParts.find((p) => p.role === 'podium');
const tower = vinParts.find((p) => p.role === 'tower');
if (vinFeat.properties.publishedFloors !== 39 || podium.floors !== 5 || tower.floors !== 34) {
  throw new Error('số tầng Vinpearl');
}
if (tower.height !== 160 || tower.height <= podium.height) throw new Error('chiều cao tháp bị trần');
if (Math.abs(podium.height - (160 * 5) / 39) > 0.02) throw new Error(`chiều cao đế ${podium.height}`);
const manor = ov.features.find((f) => f.properties.id === 'manor-a');
if (manor.properties.parts[0].height !== 74.9 || manor.properties.parts[0].floors !== 19) {
  throw new Error('Manor vẫn bị trần 67 m');
}
if (!Array.isArray(ov.massing) || ov.massing.length < 13) throw new Error('thiếu bảng khối');
const api = fs.readFileSync(new URL('../api/pmtilesRange.js', import.meta.url), 'utf8');
if (!api.includes('buildings.pmtiles') || !api.includes('thuadat-2016.pmtiles')) throw new Error('thiếu tệp tile');
if (/req\.query\.(u|url|data)\b/.test(api)) throw new Error('proxy nhận URL tự do');
const osm = fs.readFileSync(new URL('../api/osmClip.js', import.meta.url), 'utf8');
if (!osm.includes('queryFor') || /req\.query\.(u|url|data|q)\b/.test(osm)) throw new Error('osm nhận câu truy vấn tự do');
const mapJs = fs.readFileSync(new URL('../public/js/mapEngine.js', import.meta.url), 'utf8');
if (!mapJs.includes('class="proof-btn pp-3d"') || /phan-tich-3d\.html\?[^`]*target="_blank"/.test(mapJs)) {
  throw new Error('nút Xem 3D vẫn mở tab mới');
}
const panel = fs.readFileSync(new URL('../public/js/view3dPanel.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8');
if (!panel.includes('openView3d') || !css.includes('.view3d-panel') || !css.includes('(orientation: landscape) and (max-height: 520px)')) {
  throw new Error('thiếu khung 3D nổi');
}
if (!panel.includes('qh-3d-infra') || !panel.includes('packLocalInfra') || !panel.includes('packLocalLots')) {
  throw new Error('chưa gửi hạ tầng / ranh lô vào iframe 3D');
}
if (!js.includes('qh-3d-infra') || !js.includes('localInfra') || !js.includes('localLots') || !js.includes('sampleDemGrid') || !js.includes('tower-pin') || !js.includes('towerPinUrl') || !js.includes('infra-lot-edge')) {
  throw new Error('thiếu nhận hạ tầng nội bộ / ranh lô / DEM / ghim tháp');
}
if (js.includes('hatchInRing') || js.includes('infra-lot-hatch') || js.includes('tower-beacon') || js.includes('tickBeacon') || js.includes("id: 'dem-mesh'")) {
  throw new Error('hatch/đèn/lưới DEM vẫn còn — dễ trắng màn hình 3D');
}
if (!js.includes('webglcontextlost') || !js.includes('queueShow') || !js.includes('boundSat')) {
  throw new Error('thiếu chặn mất GPU / gộp vẽ lại / giữ ảnh nền');
}
const dem = fs.readFileSync(new URL('../public/js/view3dDem.js', import.meta.url), 'utf8');
if (!dem.includes('sampleDemGrid') || !dem.includes('terrarium') || !dem.includes('offsetAt')) {
  throw new Error('view3dDem thiếu lưới cao độ');
}
if (!dem.includes('getDemTile&dem=fabdem') || !dem.includes("source = template === AWS_URL ? 'srtm' : 'fabdem'")) {
  throw new Error('view3dDem chưa lấy FABDEM, SRTM chỉ là dự phòng');
}
if (!js.includes('sampleDemGrid(') || !js.includes('Cao độ nền FABDEM 30 m') || js.includes("id: 'dem-mesh'")) {
  throw new Error('khung 3D chưa đọc FABDEM hoặc vẫn dựng mesh DEM');
}
if (!js.includes('orthographic: false') || !js.includes('WHITE_BLOCK') || !js.includes('openBloom')) {
  throw new Error('thiếu phối cảnh, khối trắng hoặc vầng không gian mở');
}
if (js.includes('0.91, 0.933, 0.953') || js.includes('#e8eef3') || !js.includes('_full3d: true') || !js.includes('volume-edge')) {
  throw new Error('thiếu nền nhanh, mái hoặc cạnh khối');
}
if (js.includes('new deck.LightingEffect') || js.includes('new deck.DirectionalLight') || js.includes('material: SOFT') || js.includes('ROOF_MAT')) {
  throw new Error('vẫn còn giả lập ánh sáng / material nặng');
}
if (!js.includes('composeGoogleGround') || !js.includes('google-sat') || !js.includes('street-names') || !js.includes('filterMassing')) {
  throw new Error('thiếu nền Google hoặc tên đường OSM');
}
if (js.includes('GOOGLE_LBL(') && js.includes('loadTileImage(GOOGLE_LBL')) {
  throw new Error('vẫn tải nhãn Google POI — chỉ giữ sat + tên đường OSM');
}
if (!js.includes('lot.wall') || !js.includes('contextmenu') || !html.includes('id="orbitHint"') || !html.includes('orbit-hint')) {
  throw new Error('thiếu tô lô hạ tầng / chặn menu chuột phải / tooltip quỹ đạo');
}
if (js.includes('groundPack.sat && !showStack')) {
  throw new Error('sat vẫn ẩn khi tách lớp');
}
{
  const startIdx = js.indexOf('async function start()');
  const startBlock = js.slice(startIdx, js.indexOf('if (typeof document', startIdx));
  const firstShow = startBlock.indexOf('showBuilt()');
  if (firstShow < 0) throw new Error('start thiếu showBuilt');
  if (startBlock.slice(0, firstShow).includes('composeGoogleGround')) {
    throw new Error('sat vẫn trên đường nóng trước first paint');
  }
  if (startBlock.indexOf('composeGoogleGround', firstShow) < 0) {
    throw new Error('sat chưa gắn sau first paint');
  }
}
if (!js.includes('LOD_RADIUS_M') || !js.includes('TREE_CAP_MAX') || !js.includes('treeCap') || !js.includes('tree-canopy')) {
  throw new Error('thiếu LOD / tán cây có trần');
}
if (js.includes('showStack && !coarse && model.volumes.length <= EDGE_VOLUME_CAP && (model.trees')) {
  throw new Error('tán cây vẫn gắn trần số khối — 800 m sẽ không thấy cây');
}
if (!js.includes('infraFill') || !js.includes('Tường trắng clay')) {
  throw new Error('thiếu whitebox / tô màu công trình công cộng trên volumes');
}
if (WALL[0] < 240 || ROOF[0] >= WALL[0]) throw new Error('palette clay chưa trắng / mái chưa đậm hơn');
if (treeCap(200) !== 50 || treeCap(800) !== 200 || treeCap(100) !== 25 || treeCap('x') !== 0) {
  throw new Error(`treeCap ${treeCap(200)} ${treeCap(800)}`);
}
if (STREET_TREE_MIN_W !== 13.5) throw new Error(`STREET_TREE_MIN_W ${STREET_TREE_MIN_W}`);
{
  // Lộ giới Huế: residential/tertiary ≥ 13,5; primary ~36; service/ngõ hẹp.
  if (roadWidthMeters({ highway: 'residential' }, 'noibo') < 13.5) throw new Error('residential phải ≥ 13.5m');
  if (roadWidthMeters({ highway: 'tertiary' }, 'tertiary') < 13.5) throw new Error('tertiary phải ≥ 13.5m');
  if (roadWidthMeters({ highway: 'primary' }, 'truc') < 30) throw new Error('primary phải ~36m');
  if (roadWidthMeters({ highway: 'service' }, 'noibo') >= 13.5) throw new Error('service phải là ngõ hẹp');
  if (roadWidthMeters({ highway: 'residential', width: '36' }, 'noibo') !== 36) throw new Error('tag width=36');
  if (roadWidthMeters({ highway: 'residential', lanes: '4' }, 'noibo') < 13.5) throw new Error('lanes=4');
  // Tag width OSM hẹp không được kéo residential/primary dưới ngưỡng Huế.
  if (roadWidthMeters({ highway: 'residential', width: '6' }, 'noibo') < 13.5) {
    throw new Error('residential width=6 phải sàn ≥ 13.5m');
  }
  if (roadWidthMeters({ highway: 'primary', width: '6' }, 'truc') < 30) {
    throw new Error('primary width=6 phải về bảng Huế ~36m');
  }
  if (roadWidthMeters({ highway: 'service', width: '4' }, 'noibo') >= 13.5) {
    throw new Error('service vẫn là ngõ hẹp dù có width tag');
  }

  const park = [[-40, -40], [40, -40], [40, 40], [-40, 40], [-40, -40]];
  const fromPark = scatterTrees([park], 200, 40, []);
  if (fromPark.length < 3) throw new Error(`cây trong công viên ${fromPark.length}`);
  if (treeStats(fromPark).park < 3 || treeStats(fromPark).street !== 0) {
    throw new Error('cây công viên phải gắn source=park');
  }
  // Cổng cứng: đoạn 80m lộ giới 13,5 / 36 — phải ra cây hai bên trước khi đưa lên web.
  const short135 = scatterTrees([], 200, 40, [{ path: [[-40, 0], [40, 0]], width: 13.5 }]);
  if (short135.length < 4) throw new Error(`đoạn 13.5m × 80m phải có ≥4 tán (got ${short135.length})`);
  if ((short135[0].radius || 0) < 9) throw new Error(`bán kính tán quá nhỏ khi camera xa (${short135[0].radius})`);
  if (treeStats(short135).street < 4) throw new Error('cây phố phải gắn source=street');
  const short36 = scatterTrees([], 200, 40, [{ path: [[-40, 0], [40, 0]], width: 36 }]);
  if (short36.length < 4) throw new Error(`đoạn 36m × 80m phải có ≥4 tán (got ${short36.length})`);
  if (!js.includes('radiusMinPixels') || !js.includes('Math.max(9, d.radius')) {
    throw new Error('tree-canopy chưa kẹp pixel / bán kính đủ lớn trên màn hình');
  }
  const sides = short135.filter((t) => Math.abs(t.position[1]) > 1);
  const pos = sides.filter((t) => t.position[1] > 0).length;
  const neg = sides.filter((t) => t.position[1] < 0).length;
  if (pos < 1 || neg < 1) throw new Error(`phải trồng hai bên lề (pos=${pos} neg=${neg})`);
  const alley = scatterTrees([], 200, 40, [{ path: [[-80, 0], [80, 0]], width: 5.5, rank: 'noibo' }]);
  if (alley.length !== 0) throw new Error(`ngõ 5.5m không được có cây hàng lộ giới (${alley.length})`);
  if (isPlantableStreet({ path: [[0, 0], [10, 0]], width: 7.5, rank: 'noibo' }) !== true) {
    throw new Error('living_street 7.5m phải trồng được');
  }
  if (isPlantableStreet({ path: [[0, 0], [10, 0]], width: 5.5, rank: 'noibo' }) !== false) {
    throw new Error('service 5.5m không trồng');
  }
  const living = scatterTrees([], 200, 40, [{ path: [[-80, 0], [80, 0]], width: 7.5, rank: 'noibo' }]);
  if (living.length < 4) throw new Error(`living_street 7.5m phải có cây phố (got ${living.length})`);
  // tree_row không được chiếm budget trước đường.
  const parkRow = [[-20, -20], [20, -20], [20, 20], [-20, 20], [-20, -20]];
  const rowFirst = scatterTrees([parkRow], 300, 60, [
    { path: [[-120, 0], [120, 0]], width: 22.5, rank: 'khuvuc' }
  ], [{ path: [[0, -15], [0, 15]] }]);
  const alongRoad = rowFirst.filter((t) => t.source === 'street' && Math.abs(t.position[1]) < 12);
  if (alongRoad.length < 8) throw new Error(`đường phải trồng trước tree_row (ven đường ${alongRoad.length})`);
  const empty = scatterTrees([], 200, 40, []);
  if (empty.length !== 0) throw new Error(`không được phủ vòng dự phòng cả đĩa (${empty.length})`);
  const bigPark = [[-120, -120], [120, -120], [120, 120], [-120, 120], [-120, -120]];
  const mix = scatterTrees([bigPark], 800, 200, [{ path: [[-300, 0], [300, 0]], width: 13.5, rank: 'tertiary' }]);
  const nearRoad = mix.filter((t) => Math.abs(t.position[1]) < 18 && Math.abs(t.position[0]) > 130);
  if (nearRoad.length < 20) throw new Error(`ưu tiên ven đường trước công viên (ven đường ${nearRoad.length})`);
  const multi = scatterTrees([], 500, 80, [
    { path: [[-200, -40], [200, -40]], width: 13.5, rank: 'tertiary' },
    { path: [[-200, 0], [200, 0]], width: 36, rank: 'truc' },
    { path: [[-200, 40], [200, 40]], width: 22.5, rank: 'khuvuc' },
    { path: [[-200, 80], [200, 80]], width: 5.5, rank: 'noibo' }
  ]);
  const multiStats = treeStats(multi);
  if (multiStats.street < 28) throw new Error(`đa đường phải có cây phố (got ${multiStats.street})`);
  const near36 = multi.filter((t) => Math.abs(t.position[1]) < 25);
  if (near36.length < 8) throw new Error('budget phải ưu tiên đường rộng (36m) trước');
  // Ngã tư: không trồng trong JUNCTION_CLEAR_M quanh giao điểm.
  if (JUNCTION_CLEAR_M < 10) throw new Error(`JUNCTION_CLEAR_M ${JUNCTION_CLEAR_M}`);
  const crossRoads = [
    { path: [[-120, 0], [120, 0]], width: 22.5, rank: 'khuvuc' },
    { path: [[0, -120], [0, 120]], width: 22.5, rank: 'khuvuc' }
  ];
  const juncs = collectRoadJunctions(crossRoads);
  if (!juncs.length || Math.hypot(juncs[0][0], juncs[0][1]) > 8) {
    throw new Error(`phải nhận nút giao tại gốc (got ${JSON.stringify(juncs)})`);
  }
  const crossTrees = scatterTrees([], 300, 80, crossRoads);
  const inJunction = crossTrees.filter((t) => Math.hypot(t.position[0], t.position[1]) < JUNCTION_CLEAR_M);
  if (inJunction.length) {
    throw new Error(`còn ${inJunction.length} tán trong nút giao (phải = 0)`);
  }
  if (treeStats(crossTrees).street < 8) {
    throw new Error(`ngã tư vẫn phải có cây trên đoạn giữa (got ${treeStats(crossTrees).street})`);
  }
  if (!js.includes('JUNCTION_CLEAR_M') || !js.includes('collectRoadJunctions')) {
    throw new Error('thiếu skip nút giao khi trồng cây phố');
  }
  // Tuyến bao công viên phải được trồng trước đường xa (nearGreen ưu tiên).
  const parkRing = [[-30, -30], [30, -30], [30, 30], [-30, 30], [-30, -30]];
  const aroundPark = scatterTrees([parkRing], 400, 60, [
    { path: [[-200, 180], [200, 180]], width: 36, rank: 'truc' },
    { path: [[-40, -40], [40, -40]], width: 13.5, rank: 'tertiary' }
  ]);
  const nearParkCurb = aroundPark.filter((t) => t.source === 'street' && Math.abs(t.position[1] + 40) < 12);
  if (nearParkCurb.length < 2) {
    throw new Error(`đường bao công viên phải có cây phố (got ${nearParkCurb.length})`);
  }
  if (!js.includes('roadNearGreen') || !js.includes('nearGreen')) {
    throw new Error('thiếu ưu tiên đường bao quanh công viên');
  }
  if (!js.includes('depthTest: false') || !js.includes('canopyZ')) {
    throw new Error('tán khi Gộp chưa tắt depth — sẽ bị nhà che');
  }
  if (!js.includes('baseZ') || !js.includes('groundPack && groundPack.sat ? 0.02')) {
    throw new Error('khối chưa neo sát nền sat (baseZ 0.02)');
  }
  if (!js.includes('dataset.streetTrees') || !js.includes('STREET_TREE_PLANT_W') || !js.includes('DRIVE_FLOOR_HW')) {
    throw new Error('thiếu đếm streetTrees / PLANT_W / sàn width Huế');
  }
  if (STREET_TREE_PLANT_W !== 7.5) throw new Error(`STREET_TREE_PLANT_W ${STREET_TREE_PLANT_W}`);
  if (!osmDated({ osm3s: { timestamp_osm_base: '2026-01-01T00:00:00Z' }, elements: [{ tags: { highway: 'residential' } }] })) {
    throw new Error('osmDated phải nhận bản có highway');
  }
  if (osmDated({ remark: 'timeout', osm3s: { timestamp_osm_base: '2026-01-01T00:00:00Z' }, elements: [] })) {
    throw new Error('osmDated phải từ chối remark/timeout');
  }
  if (osmDated({ osm3s: { timestamp_osm_base: '2026-01-01T00:00:00Z' }, elements: [] })) {
    throw new Error('osmDated phải từ chối elements rỗng');
  }
  {
    const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/osm-3d-thuanhoa.json', import.meta.url), 'utf8'));
    const origin = { lat: 16.4705, lng: 107.579, mLat: 110540, mLng: 111320 * Math.cos((16.4705 * Math.PI) / 180) };
    const model = buildModel(
      { gba: [], osm: fixture, cadastre: [], localInfra: [], osmError: '', gbaError: '', cadError: 'bỏ qua' },
      origin,
      500,
      null,
      null
    );
    if (!(model.wideRoads >= 4) || !(model.streetTrees >= 20)) {
      throw new Error(`fixture width-tag phải ra cây phố (wide=${model.wideRoads} street=${model.streetTrees})`);
    }
  }
  {
    const bare = buildModel(
      {
        gba: [],
        osm: { osm3s: { timestamp_osm_base: '2026-01-01T00:00:00Z' }, elements: [{ type: 'way', tags: { leisure: 'park' }, geometry: [] }] },
        cadastre: [],
        localInfra: [],
        osmError: '',
        gbaError: '',
        cadError: 'bỏ qua'
      },
      { lat: 16.47, lng: 107.58, mLat: 110540, mLng: 106000 },
      300,
      null,
      null
    );
    if (!(bare.gaps || []).some((g) => /đường giao thông|≥ 13\.5/i.test(g))) {
      throw new Error('thiếu gap khi OSM không có đường trồng cây');
    }
  }
}
if (!osm.includes('hasMapFeatures') || !osm.includes('highwayN < 1')) {
  throw new Error('api/osmClip chưa từ chối/cache ngắn bản OSM rỗng');
}
if (!js.includes('dataset.trees') || !js.includes('tree-canopy') || !js.includes('billboard: true')) {
  throw new Error('thiếu đếm tán / tán billboard (sphere-like)');
}
if (!js.includes('STREET_TREE_MIN_W') || !js.includes('osmGeomRings') || !js.includes('relation["type"="multipolygon"]') || !js.includes('tree_row')) {
  throw new Error('thiếu ngưỡng đường lớn / parse relation OSM / tree_row');
}
if (js.includes('applyFloorTint(exploded)')) throw new Error('Màu theo tầng vẫn gắn Gộp/Tách');
if (!html.includes('id="floorColors" type="checkbox" checked')) throw new Error('checkbox Màu theo tầng chưa checked mặc định');
if (!js.includes('school_mn') || !js.includes('FAC_COUNT_IDS') || !panel.includes('school_mn') || !panel.includes('school_thpt') || !panel.includes("'10-PCCC': 'pccc'")) {
  throw new Error('thiếu tách cấp trường TT16 (3D + view3dPanel)');
}
if (!js.includes('r <= 250 ? 19') || !js.includes('SAT_MAX_TILES') || !js.includes('SAT_MAX_CANVAS') || !js.includes('scale=2')) {
  throw new Error('composeGoogleGround chưa nâng zoom/canvas/tile cap');
}
if (!osm.includes('tree_row') || !osm.includes('relation["type"="multipolygon"]')) {
  throw new Error('api/osmClip chưa có relation/tree_row');
}
if (!js.includes('raw.osm && Array.isArray(raw.osm.elements)')) {
  throw new Error('buildModel chưa chịu osm=null khi tải dần');
}
if (!js.includes('effects: []') || !js.includes('useDevicePixels: 1')) {
  throw new Error('chưa tắt effects / chưa kẹp devicePixelRatio');
}
if (!html.includes('id="btnGop" aria-pressed="true"') || html.includes('aria-pressed="true">Tách lớp')) {
  throw new Error('nút gộp chưa là mặc định');
}
if (html.includes('data-light=') || html.includes('Hoàng hôn') || html.includes('btnSang')) {
  throw new Error('còn nút giả lập ánh sáng');
}
for (const s of ['Màu theo tầng', '>Gộp một khối<', 'id="gapRow" class="gap" hidden']) {
  if (!html.includes(s)) throw new Error(`html thiếu ${s}`);
}
const css3 = fs.readFileSync(new URL('../public/css/phan-tich-3d.css', import.meta.url), 'utf8');
if (css3.includes('#e8eef3') || !css3.includes('--vignette') || !css3.includes('--sky-wash')) {
  throw new Error('nền trang 3D');
}
if (css.includes('background: #e8eef3')) throw new Error('khung 3D còn nền lạnh');

console.log('ok');
