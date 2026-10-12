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
  // Lô đất dịch vụ TT16 (DAT_Dichvu...) chỉ là chợ / TTTM khi tên nói rõ, như lúc nhập CAD (cadImportUi);
  // lô INFRA đã được xác nhận là công trình khi nhập nên không xét lại
  return (layer, name, kind) => {
    const text = String(layer || '');
    let code = '';
    if (text.includes('→')) code = text.split('→').pop().trim().toUpperCase().replace(/_DV$/, '');
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
    const meta = sync.CODE_META[code];
    return meta ? { code, type: meta.type, nhom: meta.nhom } : null;
  };
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
  return `  bỏ    ${row.parcelId || row.layer}  ${row.reason || row.action}`;
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

async function writePlan(tenQH, rows) {
  const updates = rows.filter(r => r.action === 'update');
  const creates = rows.filter(r => r.action === 'create');
  for (const row of updates) {
    const data = await postAction('editInfraRow', {
      action: 'editInfraRow',
      id: row.sheetId,
      fields: { quyMoQH: row.area }
    });
    console.log(`Đã ghi ${data.id || row.sheetId} trên tab ${data.tab || ''} → QuyMo_QH ${row.area}`);
    if (row.how === 'inside' && row.parcelId !== row.sheetId) await relink(tenQH, row, row.sheetId);
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
  const codes = String(args.type || 'THPT').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!wanted) {
    console.error('Thiếu --project "tên đồ án"');
    process.exit(1);
  }
  loadEnv();
  const index = await getJson('projects/index.json');
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
  const classify = await classifyWithCad();
  const sheet = sheetRows(infra);
  const rows = sync.diffPlanInfra(plan.parcels || [], sheet, { codes, classify });
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
  const todo = rows.filter(r => r.action === 'update' || r.action === 'create');
  const held = rows.filter(r => r.action === 'conflict' || r.action === 'skip');
  console.log(`Khớp ${rows.filter(r => r.action === 'same').length}, cần ghi ${todo.length}, giữ lại ${held.length}.`);
  if (!args.write) {
    console.log('Chưa ghi sheet. Thêm --write để ghi những dòng lệch hoặc chưa có.');
    return;
  }
  if (!todo.length) {
    console.log('Không có ô QuyMo_QH nào cần ghi.');
    return;
  }
  await writePlan(tenQH, rows);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
