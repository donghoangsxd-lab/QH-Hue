// Đồng bộ công trình hạ tầng trong đồ án quy hoạch sang cột QuyMo_QH trên Sheet.
// Chạy lại được: ô đã đúng diện tích thì không ghi.
//
//   node scripts/sync-plan-infra.js --selftest
//   node scripts/sync-plan-infra.js --project "QHPK TT phía Nam" --type THPT
//   node scripts/sync-plan-infra.js --project "QHPK TT phía Nam" --type THPT --write
//   node scripts/sync-plan-infra.js --sort   (xếp dòng mọi tab hạ tầng theo Ten_QH)
//   --dups: liệt kê dòng Sheet của đồ án trùng tọa độ + quy mô; thêm --delete-dups để xóa dòng thừa (không gắn lô)
//
// --type: mã hạ tầng, cách nhau bởi dấu phẩy (THPT, TH, THCS, MN, CV, CV_DT, ...).
// Không có --write thì chỉ in những dòng sẽ ghi.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const axios = require('axios');
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w && w.code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  console.warn(w);
});
const { loadEnv, postAction } = require('./gasClient');
const sync = require('../services/planInfraSync');

const GCS = 'https://storage.googleapis.com/hue-infra-data-us/';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

async function getJson(name, optional = false) {
  const res = await axios.get(`${GCS}${name}?v=${Date.now()}`, {
    timeout: 60000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true
  });
  if (optional && res.status === 404) return null;
  if (res.status !== 200) throw new Error(`Đọc ${name} lỗi HTTP ${res.status}`);
  return res.data;
}

async function classifyWithCad() {
  const cad = await import(pathToFileURL(path.join(__dirname, '../public/js/cadImport.js')).href);
  const mapping = await import(pathToFileURL(path.join(__dirname, '../public/js/cadTypeMapping.js')).href);
  // Lô đất dịch vụ TT16 (DAT_Dichvu...) chỉ là chợ / TTTM khi tên nói rõ, như lúc nhập CAD (cadImportUi);
  // lô dịch vụ lớn đã gắn «→ Dịch vụ thương mại cấp đô thị» là hạ tầng TM_DT.
  // Lô INFRA đã được xác nhận là công trình khi nhập nên không xét lại.
  // Tên chức năng tiếng Việt (gisHue) đi qua guessCode. TRUONG / CHOTM / đất ở không tự ghép.
  return (layer, name, kind) => {
    const text = String(layer || '');
    let code = '';
    if (text.includes('→')) code = text.split('→').pop().trim().toUpperCase().replace(/_DV$/, '');
    if (text.includes('→') && text.split('→').pop().trim().normalize('NFC') === 'Dịch vụ thương mại cấp đô thị') code = 'TM_DT';
    if (!sync.CODE_META[code]) {
      const tt = cad.tt16Layer(text.split('→')[0]);
      if (tt && tt.prefix) {
        if (tt.marketCheck && kind === 'DXF' && !cad.isMarketName(name)) return null;
        code = tt.prefix.replace(/_DV$/, '');
      } else {
        const t = cad.layerToType(text.split('→')[0]);
        if (t && t.prefix) code = t.prefix.replace(/_DV$/, '');
      }
    }
    if (!sync.CODE_META[code]) {
      const guessed = mapping.guessCode(`${name || ''} ${text}`);
      if (guessed && sync.CODE_META[guessed]) code = guessed;
    }
    const meta = sync.CODE_META[code];
    return meta ? { code, type: meta.type, nhom: meta.nhom } : null;
  };
}

// Tên trống không phải QHPK. planLevelOf coi mọi tên khác QHC/QHCT là QHPK — đúng cách app xếp đồ án.
function levelOf(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  return levelOf.fn ? levelOf.fn(s) : '';
}

function sheetRows(geojson) {
  return ((geojson && geojson.features) || []).map(f => {
    const p = f.properties || {};
    const c = (f.geometry && f.geometry.coordinates) || [];
    return {
      id: String(p.ID_DoiTuong || ''),
      name: String(p.Ten_CongTrinh || ''),
      ward: String(p.Ten_XaPhuong || ''),
      tab: String(p.Tab || ''),
      sizeHT: p.QuyMo_HT,
      sizeQH: p.QuyMo_QH,
      tenQH: String(p.Ten_QH || ''),
      lng: Number(c[0]),
      lat: Number(c[1])
    };
  }).filter(r => r.id);
}

function line(row) {
  const size = row.sheetSize === null || row.sheetSize === undefined || row.sheetSize === '' ? 'trống' : row.sheetSize;
  if (row.action === 'same') return `  khớp   ${row.parcelId}  QuyMo_QH ${size} m²`;
  if (row.action === 'update') return `  ghi    ${row.sheetId}  ${size} → ${row.area} m²  (${row.parcelId})`;
  if (row.action === 'create') return `  thêm   ${row.code}  ${row.area} m²  ${row.ward}  ${row.parcelId}`;
  if (row.action === 'rebind' && row.unpair) {
    return `  chuyển ${row.unpair.fromLotId} (${row.unpair.fromProject}) → ${row.parcelId}  ${row.sheetId}  ${row.unpair.infraName}`;
  }
  return `  bỏ    ${row.parcelId || row.layer}  ${row.reason || row.action}`;
}

const PAIR_INDEX = path.join(__dirname, '../public/data/su-dung-dat-index.json');
const UNPAIR_REPORT = path.join(__dirname, '../docs/qhct-unpair.json');

function readPairIndex() {
  if (!fs.existsSync(PAIR_INDEX)) return { v: 1, pairings: [] };
  const data = JSON.parse(fs.readFileSync(PAIR_INDEX, 'utf8'));
  if (!data || typeof data !== 'object') return { v: 1, pairings: [] };
  if (!Array.isArray(data.pairings)) data.pairings = [];
  return data;
}

function writePairIndex(index) {
  const prev = fs.existsSync(PAIR_INDEX) ? JSON.parse(fs.readFileSync(PAIR_INDEX, 'utf8')) : {};
  const next = (prev && typeof prev === 'object' && !Array.isArray(prev)) ? { ...prev } : {};
  next.pairings = (index && index.pairings) || [];
  fs.mkdirSync(path.dirname(PAIR_INDEX), { recursive: true });
  fs.writeFileSync(PAIR_INDEX, JSON.stringify(next, null, 2) + '\n');
}

function writeUnpairReport(moves) {
  fs.mkdirSync(path.dirname(UNPAIR_REPORT), { recursive: true });
  fs.writeFileSync(UNPAIR_REPORT, JSON.stringify({ v: 1, moves }, null, 2) + '\n');
}

function loadUnpairReport() {
  if (!fs.existsSync(UNPAIR_REPORT)) return [];
  const data = JSON.parse(fs.readFileSync(UNPAIR_REPORT, 'utf8'));
  return Array.isArray(data.moves) ? data.moves : [];
}

// Nhiều lô QHCT chứa cùng một điểm Sheet: giữ lô nhỏ hơn (sát thửa hơn), không biến thành conflict.
function preferSpecific(rows) {
  const groups = new Map();
  (rows || []).forEach((r) => {
    if (!r || !r.sheetId || !['update', 'rebind', 'same'].includes(r.action)) return;
    if (!groups.has(r.sheetId)) groups.set(r.sheetId, []);
    groups.get(r.sheetId).push(r);
  });
  const drop = new Set();
  groups.forEach((list) => {
    if (list.length < 2) return;
    list.sort((a, b) => a.area - b.area);
    list.slice(1).forEach((r) => drop.add(r));
  });
  return (rows || []).map((r) => (drop.has(r)
    ? { ...r, action: 'skip', reason: 'lô nhỏ hơn đã ghép cùng dòng', unpair: undefined }
    : r));
}

function rememberPairings(index, rows, tenQH, incoming) {
  let next = index && Array.isArray(index.pairings) ? index : { v: 1, pairings: [] };
  rows.forEach((row) => {
    if (!row.sheetId || !['same', 'update', 'rebind'].includes(row.action)) return;
    if (row.unpair) {
      row.unpair.toProject = tenQH;
      next = sync.movePairing(next, row.unpair, { tenQH });
      return;
    }
    if (incoming !== 'QHCT') return;
    const pairings = (next.pairings || []).filter((p) => String(p.sheetId) !== String(row.sheetId));
    pairings.push({
      sheetId: String(row.sheetId),
      lotId: String(row.parcelId || ''),
      tenQH,
      level: 'QHCT',
      name: String(row.name || '')
    });
    next = { ...next, v: next.v || 1, pairings };
  });
  return next;
}

async function relink(tenQH, row, sheetId) {
  if (!sheetId || sheetId === row.parcelId) return;
  const projects = require('../services/projectStore');
  if (row.kind === 'DXF') {
    await projects.landToInfra({ tenQH, id: row.parcelId, phase: 'QH', newId: sheetId, layer: row.layer });
    return;
  }
  await projects.retypeInfraLot({ tenQH, id: row.parcelId, newId: sheetId, layer: row.layer });
}

async function applyUnpairs(tenQH, rows, moves) {
  const projects = require('../services/projectStore');
  const grouped = new Map();
  rows.filter((r) => r.unpair).forEach((row) => {
    row.unpair.toProject = tenQH;
    const key = row.unpair.fromProject || '';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });
  for (const [fromProject, list] of grouped) {
    let changed = 0;
    let missing = false;
    let newIds = [];
    try {
      const res = await projects.unpairInfraLot({ tenQH: fromProject, ids: list.map((r) => r.unpair.fromLotId) });
      changed = res.changed || 0;
      missing = !!res.missing;
      newIds = res.newIds || [];
    } catch (err) {
      if (err.status === 409 || err.status === 404) missing = true;
      else throw err;
    }
    list.forEach((row) => {
      moves.push({
        qhpkLotId: row.unpair.fromLotId,
        qhpkProject: row.unpair.fromProject,
        qhctLotId: row.parcelId,
        qhctProject: tenQH,
        sheetId: row.sheetId,
        infra: row.unpair.infraName,
        code: row.unpair.code,
        changed,
        missing
      });
      console.log(`Đã gỡ ghép ${row.unpair.fromLotId} (${row.unpair.fromProject}) → ${row.parcelId} / ${row.sheetId}${missing ? ' (đồ án QHPK không có file lô, giữ nguyên)' : ''}`);
    });
  }
  const pairs = rows.filter((r) => (r.action === 'rebind' || r.action === 'update') && r.sheetId && r.parcelId !== r.sheetId);
  if (pairs.length) {
    const linked = await projects.linkInfraLots({
      tenQH,
      pairs: pairs.map((r) => ({ id: r.parcelId, newId: r.sheetId, layer: r.layer }))
    });
    console.log(`Đã ghép ${linked.changed} lô QHCT vào mã Sheet (${tenQH}).`);
  }
}

async function writePlan(tenQH, rows, moves) {
  const updates = rows.filter(r => r.action === 'update');
  const creates = rows.filter(r => r.action === 'create');
  await applyUnpairs(tenQH, rows, moves);
  for (const row of updates) {
    const data = await postAction('editInfraRow', {
      action: 'editInfraRow',
      id: row.sheetId,
      fields: { quyMoQH: row.area }
    });
    console.log(`Đã ghi ${data.id || row.sheetId} trên tab ${data.tab || ''} → QuyMo_QH ${row.area}`);
  }
  for (let i = 0; i < creates.length; i += 80) {
    const chunk = creates.slice(i, i + 80);
    const data = await postAction('importCadBatch', {
      action: 'importCadBatch',
      phase: 'QH',
      fileName: `QH-${tenQH}`,
      sync: true,
      syncCad: false,
      skipDxf: true,
      items: chunk.map(row => ({
        type: row.type,
        idPrefix: row.code,
        nhom: row.nhom,
        name: row.name || `${row.code} – ${tenQH}`,
        ward: row.ward,
        lat: row.lat,
        lng: row.lng,
        size: row.area,
        area: row.area,
        layer: String(row.layer || row.code).slice(0, 60),
        geometry: row.geometry,
        stages: [{ phase: 'QH', size: row.area, area: row.area, layer: row.layer, geometry: row.geometry }]
      })),
      lands: [],
      landsReset: false
    });
    const ids = Array.isArray(data.lotIds) ? data.lotIds : [];
    if (ids.length !== chunk.length) {
      throw new Error(`Apps Script không trả đủ mã lô (${ids.length}/${chunk.length}). ${(data.skipped || []).join('; ')}`);
    }
    for (let k = 0; k < chunk.length; k++) {
      console.log(`Đã thêm ${ids[k]}  QuyMo_QH ${chunk[k].area}  (lô ${chunk[k].parcelId})`);
      if (ids[k] && ids[k] !== chunk[k].parcelId) await relink(tenQH, chunk[k], ids[k]);
    }
  }
}

async function runList(args, index, codes, listFile) {
  const names = fs.readFileSync(listFile, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!levelOf.fn) {
    const gp = await import(pathToFileURL(path.join(__dirname, '../public/js/generalPlan.js')).href);
    levelOf.fn = gp.planLevelOf;
  }
  const classify = await classifyWithCad();
  const infra = await getJson('infrastructure_hue.json');
  const sheet = sheetRows(infra);
  let pairIndex = readPairIndex();
  const allMoves = loadUnpairReport();
  for (const wanted of names) {
    const entry = ((index && index.projects) || [])
      .find(p => p && !p.deleted && String(p.tenQH || '').normalize('NFC') === wanted.normalize('NFC'));
    if (!entry || !entry.slug) throw new Error(`Không thấy đồ án «${wanted}» trong projects/index.json`);
    const tenQH = entry.tenQH;
    const plan = await getJson(`projects/${entry.slug}/su-dung-dat.json`);
    const incoming = levelOf(tenQH) === 'QHCT' ? 'QHCT' : '';
    const rows = preferSpecific(sync.diffPlanInfra(plan.parcels || [], sheet, {
      codes, classify, incomingLevel: incoming, levelOf, index: pairIndex, sameRatio: 0.01
    }));
    console.log(`${tenQH} · ${codes.join(', ')} · ${rows.length} lô quy hoạch`);
    rows.forEach(r => console.log(line(r)));
    const todo = rows.filter(r => r.action === 'update' || r.action === 'rebind' || (r.action === 'create' && !args['no-create']));
    console.log(`Khớp ${rows.filter(r => r.action === 'same').length}, cần ghi ${todo.length}, chuyển ghép ${rows.filter(r => r.unpair).length}, thêm ${rows.filter(r => r.action === 'create').length}, giữ ${rows.filter(r => r.action === 'conflict' || r.action === 'skip').length}.`);
    const moves = [];
    if (args.write && todo.length) await writePlan(tenQH, todo, moves);
    pairIndex = rememberPairings(pairIndex, rows, tenQH, incoming);
    if (args.write) {
      const kept = allMoves.filter(m => m.qhctProject !== tenQH);
      allMoves.length = 0;
      kept.concat(moves).forEach(m => allMoves.push(m));
    } else if (rows.some(r => r.unpair)) {
      rows.filter(r => r.unpair).forEach(r => allMoves.push({
        qhpkLotId: r.unpair.fromLotId, qhpkProject: r.unpair.fromProject,
        qhctLotId: r.parcelId, qhctProject: tenQH, sheetId: r.sheetId, infra: r.unpair.infraName, code: r.unpair.code
      }));
    }
  }
  if (!args.write) {
    console.log('Chưa ghi. Thêm --write để ghi lệch, lô mới, hoặc chuyển ghép QHPK → QHCT.');
    return;
  }
  writePairIndex(pairIndex);
  writeUnpairReport(allMoves);
  console.log(`Đã ghi chỉ mục ghép và báo cáo gỡ ghép (${allMoves.length} dòng).`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.selftest) {
    const n = sync.selftest();
    console.log(`Selftest đạt (${n} lô).`);
    return;
  }
  if (args.sort) {
    loadEnv();
    const data = await postAction('sortInfraSheets', { action: 'sortInfraSheets' });
    console.log(`Đã xếp theo Ten_QH: ${(data.sorted || []).join(', ') || '(không tab nào)'}`);
    if ((data.failed || []).length) console.log(`Không xếp được: ${data.failed.join('; ')}`);
    return;
  }
  const wanted = String(args.project || '').trim().normalize('NFC');
  const listFile = args.list ? String(args.list) : '';
  let codes = String(args.type || 'THPT').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (codes.length === 1 && codes[0] === 'ALL') codes = Object.keys(sync.CODE_META);
  if (!wanted && !listFile) {
    console.error('Thiếu --project "tên đồ án"');
    process.exit(1);
  }
  loadEnv();
  const index = await getJson('projects/index.json');
  if (listFile) {
    await runList(args, index, codes, listFile);
    return;
  }
  // Tên trong index có thể lưu dạng NFD (dấu tách rời): so sau khi chuẩn hóa, dùng lại đúng chuỗi gốc
  const entry = ((index && index.projects) || [])
    .find(p => p && !p.deleted && String(p.tenQH || '').normalize('NFC') === wanted);
  if (!entry || !entry.slug) throw new Error(`Không thấy đồ án «${wanted}» trong projects/index.json`);
  const tenQH = entry.tenQH;
  const [plan, current, infra] = await Promise.all([
    getJson(`projects/${entry.slug}/su-dung-dat.json`),
    getJson(`projects/${entry.slug}/hien-trang.json`, true),
    getJson('infrastructure_hue.json')
  ]);
  if (!levelOf.fn) {
    const gp = await import(pathToFileURL(path.join(__dirname, '../public/js/generalPlan.js')).href);
    levelOf.fn = gp.planLevelOf;
  }
  const classify = await classifyWithCad();
  const sheet = sheetRows(infra);
  const incoming = levelOf(tenQH) === 'QHCT' ? 'QHCT' : '';
  const rows = preferSpecific(sync.diffPlanInfra(plan.parcels || [], sheet, {
    codes, classify, incomingLevel: incoming, levelOf, index: readPairIndex()
  }));
  if (args.dups) {
    const linked = new Set([...(plan.parcels || []), ...((current && current.parcels) || [])]
      .filter(p => p && p.kind === 'INFRA').map(p => String(p.id)));
    const dups = sync.findDuplicates(sheet, tenQH, linked);
    const extra = dups.reduce((n, d) => n + d.extra.length, 0);
    console.log(`Dòng trùng tọa độ: ${dups.length} nhóm, ${extra} dòng thừa`);
    dups.forEach(d => console.log(`  trùng  giữ ${d.keep.join(', ')}  thừa ${d.extra.join(', ')}  (${d.lng}, ${d.lat}, QH ${d.sizeQH ?? 'trống'})`));
    if (args['delete-dups'] && extra) {
      const ids = dups.flatMap(d => d.extra);
      const data = await postAction('deleteInfraRows', { action: 'deleteInfraRows', ids });
      console.log(`Đã xóa ${data.rows} dòng thừa${(data.missing || []).length ? `, không thấy: ${data.missing.join(', ')}` : ''}`);
    }
  }
  console.log(`${tenQH} · ${codes.join(', ')} · ${rows.length} lô quy hoạch`);
  rows.forEach(r => console.log(line(r)));
  const rebinds = rows.filter(r => r.action === 'rebind' || r.unpair);
  const todo = rows.filter(r => r.action === 'update' || r.action === 'create' || r.action === 'rebind');
  const held = rows.filter(r => r.action === 'conflict' || r.action === 'skip');
  console.log(`Khớp ${rows.filter(r => r.action === 'same').length}, cần ghi ${todo.length}, chuyển ghép ${rebinds.length}, giữ lại ${held.length}.`);
  if (!args.write) {
    console.log('Chưa ghi sheet. Thêm --write để ghi những dòng lệch, lô mới, hoặc chuyển ghép QHPK → QHCT.');
    return;
  }
  const moves = [];
  if (todo.length) await writePlan(tenQH, rows, moves);
  else console.log('Không có ô QuyMo_QH hay ghép nào cần ghi.');
  writePairIndex(rememberPairings(readPairIndex(), rows, tenQH, incoming));
  const prev = loadUnpairReport().filter(m => m.qhctProject !== tenQH);
  writeUnpairReport(prev.concat(moves));
  console.log(`Đã ghi chỉ mục ghép và báo cáo gỡ ghép (${moves.length} dòng đồ án này).`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
