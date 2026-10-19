// Dựng public/data/faq.json từ số liệu đã có: công trình trên bucket, danh sách kêu gọi đầu tư,
// lớp chức năng đất QHC 2045 và dân số trên ranh 40 phường xã. Không bịa chỉ tiêu thiếu nguồn.
const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');
const constants = require('../config/constants');

const root = path.join(__dirname, '..');
const INFRA_URL = constants.GCS_URL;
const BOUNDARY_URL = process.env.BOUNDARY_URL || 'https://web-hatang-hue-4.vercel.app/api/gee?action=getBoundaryVector&v=2';
const OUT = path.join(root, 'public/data/faq.json');

const LAND = {
  5: 'Đất cây xanh sử dụng công cộng đô thị',
  23: 'Đất sản xuất nông nghiệp',
  40: 'Đất đơn vị ở',
  forest: 'Đất lâm nghiệp (rừng đặc dụng, phòng hộ, sản xuất)'
};
const FOREST = new Set([24, 25, 26]);

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
const coreName = (s) => fold(s).replace(/^(phuong|xa|thi tran)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const wards = Object.keys(constants.WARD_AREA_KM2);
const byCore = new Map(wards.map(w => [coreName(w), w]));
const num = (n, d = 0) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d, minimumFractionDigits: d }).format(n);
const ha = (m2) => num(m2 / 10000, 2);
const approved = (v) => v === true || String(v).trim().toUpperCase() === 'TRUE' || String(v).trim() === '1';
const areaOf = (v) => {
  const n = Number(String(v == null ? '' : v).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function typeOf(props) {
  const prefix = String(props.ID_DoiTuong || '').split('-')[0];
  return constants.codeMap[prefix]
    || constants.codeMap[prefix.replace(/_DT$/i, '').replace(/_DV$/i, '')]
    || null;
}

function matchWardsInText(text) {
  const f = ` ${fold(text).replace(/[^a-z0-9]+/g, ' ')} `;
  return wards.filter(w => {
    const c = coreName(w);
    return c && f.includes(` ${c} `);
  });
}

function namedWard(raw) {
  const c = coreName(raw);
  return byCore.get(c) || null;
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res.json();
}

function ringCentroid(geom) {
  try {
    const c = turf.centroid({ type: 'Feature', geometry: geom, properties: {} });
    const [lng, lat] = c.geometry.coordinates;
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  } catch (e) {
    return null;
  }
}

function locateFactory(features) {
  const boxes = features.map(f => {
    const name = namedWard((f.properties || {}).tenXa || (f.properties || {}).name || '');
    let bbox = null;
    try { bbox = turf.bbox(f); } catch (e) { bbox = null; }
    return { name, feature: f, bbox };
  }).filter(w => w.name && w.bbox);
  return (lng, lat) => {
    for (const w of boxes) {
      const [x0, y0, x1, y1] = w.bbox;
      if (lng < x0 || lng > x1 || lat < y0 || lat > y1) continue;
      if (turf.booleanPointInPolygon(turf.point([lng, lat]), w.feature)) return w.name;
    }
    return null;
  };
}

function rank(rows) {
  const scored = rows.filter(r => r.value > 0).sort((a, b) => b.value - a.value || a.ward.localeCompare(b.ward, 'vi'));
  return {
    top: scored[0] || null,
    bottom: scored.length ? scored[scored.length - 1] : null,
    n: scored.length,
    zero: rows.filter(r => !(r.value > 0)).map(r => r.ward)
  };
}

function q(id, question, answer, wardNames, source) {
  return { id, q: question, a: answer, wards: wardNames, source };
}

async function main() {
  const gaps = [];
  const [infra, boundary] = await Promise.all([
    getJson(INFRA_URL),
    getJson(BOUNDARY_URL).catch(err => {
      gaps.push({ q: 'Mật độ dân số và gán lô đất QHC theo ranh phường', why: `Không tải được ranh phường xã (${err.message}).` });
      return null;
    })
  ]);
  const features = (infra && infra.features) || [];
  const locate = boundary ? locateFactory(boundary.features || []) : () => null;
  const popByWard = {};
  if (boundary) {
    for (const f of boundary.features || []) {
      const name = namedWard((f.properties || {}).tenXa || '');
      const pop = Number((f.properties || {}).danSoNum || (f.properties || {}).danSo);
      if (name && Number.isFinite(pop) && pop > 0) popByWard[name] = pop;
    }
  }

  const blank = () => Object.fromEntries(wards.map(w => [w, 0]));
  const green = blank();
  const greenN = blank();
  const greenUnknown = blank();
  const schools = blank();
  const bus = blank();
  const csd = blank();
  const csdN = blank();
  let placed = 0;
  let unplaced = 0;

  for (const f of features) {
    const p = f.properties || {};
    if (!approved(p.TrangThai)) continue;
    const coords = f.geometry && f.geometry.type === 'Point' ? f.geometry.coordinates : null;
    const ward = namedWard(p.Ten_XaPhuong) || (coords ? locate(coords[0], coords[1]) : null);
    if (!ward) { unplaced++; continue; }
    placed++;
    const code = typeOf(p);
    const prefix = String(p.ID_DoiTuong || '').split('-')[0];
    const ht = areaOf(p.QuyMo_HT != null ? p.QuyMo_HT : p.QuyMo_S);
    if (code === '1-CV') {
      greenN[ward]++;
      if (ht) green[ward] += ht; else greenUnknown[ward]++;
    }
    if (['MN', 'TH', 'THCS', 'THPT'].includes(prefix) || ['3-MN', '4-TH', '5-THCS'].includes(code)) schools[ward]++;
    if (code === '13-BUS' || prefix === 'BUS') bus[ward]++;
    if (code === '12-CSD') {
      csdN[ward]++;
      if (ht) csd[ward] += ht;
    }
  }

  const land = { 5: blank(), 23: blank(), 40: blank(), forest: blank() };
  const sdd = JSON.parse(fs.readFileSync(path.join(root, 'public/data/qhc2045/sdd.json'), 'utf8'));
  let landHits = 0;
  let landMiss = 0;
  if (boundary) {
    for (const f of sdd.features || []) {
      const props = f.properties || {};
      const pt = f.geometry ? ringCentroid(f.geometry) : null;
      const ward = pt ? locate(pt[0], pt[1]) : null;
      if (!ward) { landMiss++; continue; }
      const code = Number(props.c);
      const a = Number(props.a) || 0;
      if (!(a > 0)) continue;
      if (land[code]) { land[code][ward] += a; landHits++; }
      if (FOREST.has(code)) { land.forest[ward] += a; landHits++; }
    }
  }

  const invest = JSON.parse(fs.readFileSync(path.join(root, 'public/data/invest-sheet.json'), 'utf8'));
  const projects = blank();
  let investMatched = 0;
  let investMiss = 0;
  for (const row of invest.rows || []) {
    const hits = matchWardsInText(row['ĐỊA ĐIỂM'] || '');
    if (!hits.length) { investMiss++; continue; }
    investMatched++;
    hits.forEach(w => { projects[w]++; });
  }

  const rowsOf = (map) => wards.map(ward => ({ ward, value: map[ward] }));
  const questions = [];

  const greenRank = rank(rowsOf(green));
  if (greenRank.top) {
    const w = greenRank.top.ward;
    questions.push(q(
      'green-max',
      'Phường, xã nào có diện tích cây xanh công viên lớn nhất?',
      `${w}: ${ha(green[w])} ha quy mô hiện trạng đã duyệt (${num(greenN[w])} công viên${greenUnknown[w] ? `, ${num(greenUnknown[w])} công trình chưa có QuyMo_HT nên không cộng diện tích` : ''}).`,
      [w],
      'infrastructure_hue.json · TrangThai = TRUE · nhóm 1-CV · QuyMo_HT (m²). Cập nhật bucket 15/10/2026.'
    ));
  } else {
    gaps.push({ q: 'Phường nào có diện tích cây xanh lớn nhất?', why: 'Không có công viên đã duyệt với QuyMo_HT > 0.' });
  }

  const xa = wards.filter(w => /^xã\s/i.test(w));
  const phuong = wards.filter(w => /^phường\s/i.test(w));
  if (Object.keys(popByWard).length >= 30) {
    const dens = (list) => list.map(w => ({ ward: w, value: constants.WARD_AREA_KM2[w] > 0 ? popByWard[w] / constants.WARD_AREA_KM2[w] : 0 }))
      .filter(r => popByWard[r.ward] > 0);
    const low = dens(xa).sort((a, b) => a.value - b.value);
    const high = dens(phuong).sort((a, b) => b.value - a.value);
    if (low[0]) {
      questions.push(q(
        'dens-xa-min',
        'Xã nào có mật độ dân số thấp nhất?',
        `${low[0].ward}: ${num(Math.round(low[0].value))} người/km² (${num(popByWard[low[0].ward])} người / ${num(constants.WARD_AREA_KM2[low[0].ward], 2)} km²).`,
        [low[0].ward],
        'Dân số thuộc tính danSoNum trên ranh phường xã; diện tích bảng WARD_AREA_KM2 trong config/constants.js.'
      ));
    }
    if (high[0]) {
      questions.push(q(
        'dens-phuong-max',
        'Phường nào có mật độ dân số cao nhất?',
        `${high[0].ward}: ${num(Math.round(high[0].value))} người/km² (${num(popByWard[high[0].ward])} người / ${num(constants.WARD_AREA_KM2[high[0].ward], 2)} km²).`,
        [high[0].ward],
        'Dân số thuộc tính danSoNum trên ranh phường xã; diện tích bảng WARD_AREA_KM2 trong config/constants.js.'
      ));
    }
  } else {
    gaps.push({ q: 'Xã nào có mật độ dân số thấp nhất?', why: 'Ranh phường xã không kèm dân số danSoNum.' });
  }

  const landNote = 'public/data/qhc2045/sdd.json · diện tích lô (ha) theo mã chức năng đất QHC 2045, gán phường bằng tâm lô. Chỉ các lô có trong lớp này, không phải kiểm kê toàn địa bàn.';
  if (boundary && landHits) {
    for (const [key, label] of [['5', LAND[5]], ['40', LAND[40]], ['23', LAND[23]], ['forest', LAND.forest]]) {
      const r = rank(rowsOf(land[key]));
      if (!r.top) {
        gaps.push({ q: `Địa bàn nào có ${label} lớn nhất trên QHC 2045?`, why: 'Lớp sdd.json không có lô mã này nằm trong ranh 40 phường xã.' });
        continue;
      }
      questions.push(q(
        `land-${key}-max`,
        `Trên quy hoạch chung 2045, địa bàn nào có ${label.toLowerCase()} lớn nhất?`,
        `${r.top.ward}: ${num(r.top.value, 1)} ha. ${r.n} địa bàn có loại đất này trong lớp.`,
        [r.top.ward],
        landNote
      ));
      if (r.bottom && r.bottom.ward !== r.top.ward) {
        questions.push(q(
          `land-${key}-min`,
          `Trên quy hoạch chung 2045, địa bàn nào có ${label.toLowerCase()} nhỏ nhất (trong số có lô)?`,
          `${r.bottom.ward}: ${num(r.bottom.value, 1)} ha. ${r.zero.length} địa bàn không có lô loại này trong lớp QHC 2045.`,
          [r.bottom.ward],
          landNote
        ));
      }
    }
  } else if (!gaps.some(g => /QHC/.test(g.q))) {
    gaps.push({ q: 'Địa bàn nào đứng đầu hoặc cuối theo nhóm đất QHC 2045?', why: 'Chưa gán được lô đất vào ranh phường xã.' });
  }

  const inv = rank(rowsOf(projects));
  if (inv.top) {
    const top3 = rowsOf(projects).filter(r => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 3);
    questions.push(q(
      'invest-max',
      'Địa bàn nào có nhiều dự án kêu gọi đầu tư nhất?',
      `${top3.map(r => `${r.ward}: ${num(r.value)} dự án`).join('; ')}. ${num(investMatched)} dòng gắn được địa bàn, ${num(investMiss)} dòng không khớp tên phường xã.`,
      top3.map(r => r.ward),
      'public/data/invest-sheet.json · cột ĐỊA ĐIỂM. Một dòng ghi nhiều phường được đếm ở mỗi phường. Đây là danh sách kêu gọi đầu tư, không phải dự án đã cấp phép.'
    ));
    questions.push(q(
      'invest-min',
      'Địa bàn nào có ít dự án kêu gọi đầu tư nhất (trong số có ít nhất một dự án)?',
      `${inv.bottom.ward}: ${num(inv.bottom.value)} dự án. ${num(inv.zero.length)} địa bàn không có dòng nào khớp tên.`,
      [inv.bottom.ward],
      'public/data/invest-sheet.json · cột ĐỊA ĐIỂM.'
    ));
  }

  const schoolRank = rank(rowsOf(schools));
  if (schoolRank.top) {
    const w = schoolRank.top.ward;
    questions.push(q(
      'school-max',
      'Địa bàn nào có nhiều trường mầm non, tiểu học, THCS, THPT đã duyệt nhất?',
      `${w}: ${num(schools[w])} trường.`,
      [w],
      'infrastructure_hue.json · đã duyệt · tiền tố MN, TH, THCS, THPT.'
    ));
  }
  const busRank = rank(rowsOf(bus));
  if (busRank.top) {
    questions.push(q(
      'bus-max',
      'Địa bàn nào có nhiều điểm dừng xe buýt đã duyệt nhất?',
      `${busRank.top.ward}: ${num(bus[busRank.top.ward])} điểm.`,
      [busRank.top.ward],
      'infrastructure_hue.json · đã duyệt · nhóm 13-BUS.'
    ));
  }
  const csdRank = rank(rowsOf(csd));
  if (csdRank.top) {
    const w = csdRank.top.ward;
    questions.push(q(
      'csd-max',
      'Địa bàn nào có quỹ đất chưa sử dụng (quy mô hiện trạng đã duyệt) lớn nhất?',
      `${w}: ${ha(csd[w])} ha (${num(csdN[w])} khu).`,
      [w],
      'infrastructure_hue.json · đã duyệt · nhóm 12-CSD · QuyMo_HT.'
    ));
  }

  const byArea = wards.map(w => ({ ward: w, value: constants.WARD_AREA_KM2[w] })).sort((a, b) => b.value - a.value);
  questions.push(q(
    'area-max',
    'Phường, xã nào có diện tích tự nhiên lớn nhất?',
    `${byArea[0].ward}: ${num(byArea[0].value, 2)} km².`,
    [byArea[0].ward],
    'Bảng diện tích chính thức 40 phường xã trong config/constants.js (WARD_AREA_KM2).'
  ));
  const small = byArea[byArea.length - 1];
  questions.push(q(
    'area-min',
    'Phường, xã nào có diện tích tự nhiên nhỏ nhất?',
    `${small.ward}: ${num(small.value, 2)} km².`,
    [small.ward],
    'Bảng diện tích chính thức 40 phường xã trong config/constants.js (WARD_AREA_KM2).'
  ));

  gaps.push(
    { q: 'Diện tích cây xanh công cộng theo kiểm kê đất đai?', why: 'Bucket chỉ có quy mô từng công viên trên sheet, không có lớp kiểm kê cây xanh toàn ranh.' },
    { q: 'Tỷ lệ nhà kiên cố, nước sạch, chất thải rắn theo phường?', why: 'Không có số liệu điều tra trong webapp hay bucket.' },
    { q: 'Số dự án đầu tư đã cấp phép hoặc đang thi công theo phường?', why: 'Chỉ có danh sách kêu gọi đầu tư (invest-sheet.json), không có sổ dự án đã phê duyệt theo phường.' },
    { q: 'Mật độ xây dựng hoặc tầng cao trung bình theo phường?', why: 'Chưa có lớp công trình nhà (Open Buildings / OSM) trong bộ số liệu đang dùng.' },
    { q: 'Độ che phủ thực vật (NDVI) theo phường?', why: 'Chưa có lớp NDVI trong bộ số liệu tĩnh.' }
  );

  const doc = {
    built: '2026-10-19',
    infraFeatures: features.length,
    placed,
    unplaced,
    landHits,
    landMiss,
    questions,
    unanswered: gaps
  };
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2));
  console.log(`faq: ${questions.length} câu, ${gaps.length} câu chưa trả lời, ${OUT}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
