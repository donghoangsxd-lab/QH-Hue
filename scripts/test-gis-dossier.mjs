import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { assessGis, crsIssues, landUseDomain, META_COLUMNS, metaSheetIssues, phanLoaiIssues, planKindOf } from '../public/js/gisDossierCore.js';
import { inspectGisFiles, scanDbf } from '../public/js/gisDossierRead.js';
import { looksLikeMeta, readMetaWorkbook } from '../public/js/gisXlsx.js';

const CODE_QPK = '46QPK1002026';
const CODE_QHC = '46QHC2002026';
const CODE_QCT = '46QCT1002026';

const FIELDS = [
  { name: 'maThongTinQH', type: 'C', len: 15 },
  { name: 'maHoSoQH', type: 'C', len: 15 },
  { name: 'maDoiTuong', type: 'C', len: 100 },
  { name: 'tenDoiTuong', type: 'C', len: 100 },
  { name: 'phanLoai', type: 'C', len: 250 },
  { name: 'ghiChu', type: 'C', len: 250 }
];

function layer(over = {}) {
  return {
    pkg: 'QuyHoach',
    group: 'QuyHoachSuDungDat',
    name: 'ChucNangSuDungDat_A',
    geom: 'A',
    source: 'shp',
    fields: FIELDS,
    crs: 'HUE_3',
    phanLoai: ['DAT_O_Nhomnhao'],
    codes: [CODE_QPK],
    ...over
  };
}

function inventory(layers, extra = {}) {
  return {
    label: 'Thu',
    packages: {
      NenDiaHinh: { found: true, form: 'shp' },
      HienTrang: { found: true, form: 'shp' },
      QuyHoach: { found: true, form: 'shp' },
      MocGioi: { found: true, form: 'shp' }
    },
    layers,
    presentation: [{ name: 'ban-do.qgz' }],
    ...extra
  };
}

function texts(report) {
  return report.issues.map(i => i.text);
}

function has(report, re) {
  return texts(report).some(t => re.test(t));
}

function crsTexts(report) {
  return texts(report).filter(t => /hệ tọa độ|VN-2000|kinh tuyến/.test(t));
}

const qpk = landUseDomain(new Set(['QPK']));
assert.equal(qpk.set.has('LUC'), false);
assert.equal(qpk.set.has('DAT_O_Nhomnhao'), true);
assert.equal(qpk.set.has('DAT_NO_Nhaolienke'), false);
assert.equal(planKindOf(CODE_QCT), 'QCT');
assert.equal(planKindOf('LUC'), '');

const qpkReport = assessGis(inventory([
  layer(),
  layer({ pkg: 'HienTrang', group: 'HienTrangSuDungDat', phanLoai: ['HT_DAT_O_Nhomnhao'] })
]));
assert.equal(qpkReport.issues.some(i => i.layer === 'ChucNangSuDungDat_A' && /phanLoai không thuộc/.test(i.text)), false);
assert.equal(crsTexts(qpkReport).length, 0);
assert.equal(qpkReport.issues.some(i => i.group === 'Siêu dữ liệu'), false);

const luc = assessGis(inventory([
  layer({ phanLoai: ['LUC', 'DAT_O_Nhomnhao'] }),
  layer({ pkg: 'HienTrang', group: 'HienTrangSuDungDat', phanLoai: ['HT_DAT_O_Nhomnhao'] })
]));
assert.equal(has(luc, /phanLoai không thuộc Phụ lục I \(QHPK\): LUC/), true);

const qctOnly = assessGis(inventory([
  layer({ phanLoai: ['DAT_DD_Donvio'], codes: [CODE_QCT] }),
  layer({ pkg: 'HienTrang', group: 'HienTrangSuDungDat', phanLoai: ['HT_DAT_NO_Nhaolienke'], codes: [CODE_QCT] })
]));
assert.equal(has(qctOnly, /DAT_DD_Donvio/), true);
assert.equal(qctOnly.issues.some(i => i.pkg === 'HienTrang' && /phanLoai không thuộc|thiếu tiền tố HT_/.test(i.text)), false);

const htBare = phanLoaiIssues(
  layer({ pkg: 'HienTrang', group: 'HienTrangSuDungDat', phanLoai: ['DAT_O_Nhomnhao'] }),
  qpk
);
assert.equal(htBare.some(i => i.level === 'warn' && /thiếu tiền tố HT_/.test(i.text)), true);
assert.equal(htBare.some(i => i.level === 'fail'), false);

const qhMarked = phanLoaiIssues(layer({ phanLoai: ['HT_DAT_O_Nhomnhao'] }), qpk);
assert.equal(qhMarked.some(i => i.level === 'warn' && /không dùng tiền tố HT_/.test(i.text)), true);

const gpkgEmpty = phanLoaiIssues(layer({ source: 'gpkg', phanLoai: [] }), qpk);
assert.equal(gpkgEmpty[0].level, 'warn');
assert.match(gpkgEmpty[0].text, /Chưa đọc được giá trị phanLoai/);

const mixed = assessGis(inventory([
  layer(),
  layer({
    pkg: 'HienTrang', group: 'HienTrangSuDungDat', name: 'RanhGioiQuyHoach_A',
    phanLoai: [], codes: [], crs: 'UTM48_6'
  })
]));
assert.equal(has(mixed, /không cùng một hệ tọa độ/), true);
assert.equal(has(mixed, /QuyHoach\/ChucNangSuDungDat_A/), true);
assert.equal(has(mixed, /HienTrang\/RanhGioiQuyHoach_A/), true);
assert.equal(has(mixed, /múi 6°/), true);

const utm = crsIssues([
  { name: 'A_A', source: 'shp', crs: 'UTM48_6' },
  { name: 'B_L', source: 'shp', crs: 'UTM48_6' }
]);
assert.equal(utm.length, 1);
assert.match(utm[0].text, /VN-2000 UTM/);
assert.match(utm[0].text, /kinh tuyến trục 107°, múi 3°/);

const none = crsIssues([{ name: 'A_A', source: 'shp', crs: '' }]);
assert.match(none[0].text, /Chưa đọc được hệ tọa độ VN-2000/);

const skipQgz = crsIssues([
  { name: 'A_A', source: 'shp', crs: 'HUE_3' },
  { name: 'ban.qgz', source: 'qgz', crs: '' }
]);
assert.equal(skipQgz.length, 0);

function sheetBook(patch = {}) {
  const sheets = {};
  for (const [name, cols] of Object.entries(META_COLUMNS)) {
    sheets[name] = { headers: [...cols], maHoSo: [CODE_QPK] };
  }
  if (patch.headers) sheets[patch.sheet].headers = patch.headers;
  if (patch.maHoSo) {
    for (const name of Object.keys(sheets)) sheets[name].maHoSo = patch.maHoSo;
  }
  return { name: `${CODE_QPK}.xlsx`, relevant: true, sheets };
}

assert.equal(metaSheetIssues(sheetBook(), [CODE_QPK]).length, 0);
assert.equal(metaSheetIssues({ name: 'khac.xlsx', relevant: false, sheets: {} }, []).length, 0);

const dropped = [...META_COLUMNS.HoSo];
dropped.pop();
const missingCol = metaSheetIssues(sheetBook({ sheet: 'HoSo', headers: dropped }), [CODE_QPK]);
assert.equal(missingCol.some(i => i.level === 'fail' && /Sheet HoSo thiếu cột: Ghi chú/.test(i.text)), true);

const swapped = [...META_COLUMNS.HoSo];
[swapped[0], swapped[1]] = [swapped[1], swapped[0]];
const order = metaSheetIssues(sheetBook({ sheet: 'HoSo', headers: swapped }), [CODE_QPK]);
assert.equal(order.some(i => i.level === 'warn' && /Sheet HoSo đủ cột nhưng chưa đúng thứ tự/.test(i.text)), true);
assert.equal(order.some(i => i.level === 'fail'), false);

const badCode = metaSheetIssues(sheetBook({ maHoSo: ['KHONG-DUNG'] }), [CODE_QPK]);
assert.equal(badCode.some(i => i.level === 'fail' && /mã hồ sơ chưa đúng mẫu/.test(i.text)), true);

const apart = metaSheetIssues(sheetBook(), [CODE_QHC]);
assert.equal(apart.some(i => i.level === 'warn' && /không trùng mã đọc được/.test(i.text)), true);

const broken = metaSheetIssues({ name: 'a.xlsx', relevant: true, error: 'a.xlsx: không phải sổ Excel hợp lệ.' }, []);
assert.equal(broken[0].level, 'fail');
assert.equal(broken[0].group, 'Siêu dữ liệu');

function zipOf(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const raw = Buffer.from(file.data);
    const comp = zlib.deflateRawSync(raw);
    const crc = zlib.crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    const body = Buffer.concat([local, name, comp]);
    locals.push(body);
    centrals.push(Buffer.concat([central, name]));
    offset += body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  const out = Buffer.concat([...locals, cd, eocd]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

function colLetter(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetXml(headers, strings, ma) {
  const cells = headers.map((text, i) => {
    const at = strings.indexOf(text);
    return `<c r="${colLetter(i)}1" t="s"><v>${at}</v></c>`;
  }).join('');
  const data = ma
    ? `<row r="2"><c r="A2" t="inlineStr"><is><t>${ma}</t></is></c></row>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData><row r="1">${cells}</row>${data}</sheetData></worksheet>`;
}

function workbookBytes(ma = CODE_QPK) {
  const strings = [...new Set(Object.values(META_COLUMNS).flat())];
  const shared = `<?xml version="1.0" encoding="UTF-8"?><sst>${strings.map(s => `<si><t>${s}</t></si>`).join('')}</sst>`;
  const book = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet r:id="rId1" name="HoSo"/><sheet name="BanVe" r:id="rId2"/><sheet name="VanBan" r:id="rId3"/></sheets></workbook>`;
  const rels = `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Target="worksheets/sheet3.xml"/></Relationships>`;
  return zipOf([
    { name: 'xl/workbook.xml', data: book },
    { name: 'xl/_rels/workbook.xml.rels', data: rels },
    { name: 'xl/sharedStrings.xml', data: shared },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml(META_COLUMNS.HoSo, strings, ma) },
    { name: 'xl/worksheets/sheet2.xml', data: sheetXml(META_COLUMNS.BanVe, strings, ma) },
    { name: 'xl/worksheets/sheet3.xml', data: sheetXml(META_COLUMNS.VanBan, strings, ma) }
  ]);
}

const parsed = await readMetaWorkbook(workbookBytes(), `HoSoScan/${CODE_QPK}.xlsx`);
assert.equal(parsed.relevant, true);
assert.deepEqual(parsed.sheets.HoSo.headers, META_COLUMNS.HoSo);
assert.deepEqual(parsed.sheets.BanVe.maHoSo, [CODE_QPK]);
assert.equal(metaSheetIssues(parsed, [CODE_QPK]).length, 0);

const decoy = await readMetaWorkbook(zipOf([
  { name: 'xl/workbook.xml', data: '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Khac" r:id="rId1"/></sheets></workbook>' },
  { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
  { name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>A</t></is></c></row></sheetData></worksheet>' }
]), 'ghi-chu.xlsx');
assert.equal(decoy.relevant, false);
assert.equal(looksLikeMeta('HoSoScan/a.xlsx'), true);
assert.equal(looksLikeMeta('ghi-chu.xlsx'), false);

function buildDbf(fields, rows) {
  const recLen = 1 + fields.reduce((sum, f) => sum + f.len, 0);
  const headLen = 32 + 32 * fields.length + 1;
  const buf = Buffer.alloc(headLen + recLen * rows.length);
  buf[0] = 3;
  buf.writeUInt32LE(rows.length, 4);
  buf.writeUInt16LE(headLen, 8);
  buf.writeUInt16LE(recLen, 10);
  fields.forEach((f, i) => {
    const o = 32 + i * 32;
    buf.write(f.name, o, 'latin1');
    buf[o + 11] = 67;
    buf[o + 16] = f.len;
  });
  buf[headLen - 1] = 0x0d;
  rows.forEach((row, i) => {
    let o = headLen + i * recLen + 1;
    buf[headLen + i * recLen] = 0x20;
    fields.forEach(f => {
      buf.write(String(row[f.name] || '').slice(0, f.len), o, 'latin1');
      o += f.len;
    });
  });
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

const dbfFields = [
  { name: 'maHoSoQH', len: 15 },
  { name: 'phanLoai', len: 40 },
  { name: 'maDoiTuong', len: 48 }
];
const scanned = scanDbf(buildDbf(dbfFields, [
  { maHoSoQH: CODE_QPK, phanLoai: 'DAT_O_Nhomnhao', maDoiTuong: `${CODE_QPK}-ChucNangSuDungDat-1` },
  { maHoSoQH: CODE_QPK, phanLoai: 'DAT_O_Nhomnhao', maDoiTuong: `${CODE_QPK}-ChucNangSuDungDat-2` },
  { maHoSoQH: CODE_QPK, phanLoai: 'LUC', maDoiTuong: `${CODE_QPK}-ChucNangSuDungDat-3` }
]), 'UTF-8', 'ChucNangSuDungDat_A');
assert.deepEqual(scanned.phanLoai, ['DAT_O_Nhomnhao', 'LUC']);
assert.deepEqual(scanned.codes, [CODE_QPK]);
assert.deepEqual(scanDbf(buildDbf(dbfFields, [
  { maHoSoQH: CODE_QPK, phanLoai: 'LUC', maDoiTuong: 'x' }
]), '', 'RanhGioiQuyHoach_A').phanLoai, []);

function mem(path, data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return {
    path,
    size: bytes.length,
    read: async (start = 0, end = bytes.length) => bytes.subarray(start, end)
  };
}

function shpHead() {
  const buf = Buffer.alloc(100);
  buf.writeInt32BE(9994, 0);
  buf.writeInt32LE(5, 32);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

const prjHue = 'PROJCS["VN-2000",PARAMETER["Central_Meridian",107]]';
const fullDbf = buildDbf([
  { name: 'maThongTin', len: 15 },
  { name: 'maHoSoQH', len: 15 },
  { name: 'maDoiTuong', len: 48 },
  { name: 'tenDoiTuon', len: 20 },
  { name: 'phanLoai', len: 40 },
  { name: 'ghiChu', len: 20 }
], [
  { maThongTin: '46.QH.0001', maHoSoQH: CODE_QPK, maDoiTuong: `${CODE_QPK}-ChucNangSuDungDat-1`, tenDoiTuon: 'O', phanLoai: 'DAT_O_Nhomnhao', ghiChu: '' },
  { maThongTin: '46.QH.0001', maHoSoQH: CODE_QPK, maDoiTuong: `${CODE_QPK}-ChucNangSuDungDat-2`, tenDoiTuon: 'O', phanLoai: 'LUC', ghiChu: '' }
]);
const xlsx = new Uint8Array(workbookBytes());
const read = await inspectGisFiles([
  mem('QuyHoach/QuyHoachSuDungDat/ChucNangSuDungDat_A.shp', shpHead()),
  mem('QuyHoach/QuyHoachSuDungDat/ChucNangSuDungDat_A.dbf', fullDbf),
  mem('QuyHoach/QuyHoachSuDungDat/ChucNangSuDungDat_A.prj', prjHue),
  mem('HienTrang/HienTrangSuDungDat/ChucNangSuDungDat_A.shp', shpHead()),
  mem('HienTrang/HienTrangSuDungDat/ChucNangSuDungDat_A.dbf', buildDbf([
    { name: 'maHoSoQH', len: 15 },
    { name: 'phanLoai', len: 40 }
  ], [{ maHoSoQH: CODE_QPK, phanLoai: 'DAT_O_Nhomnhao' }])),
  mem('HienTrang/HienTrangSuDungDat/ChucNangSuDungDat_A.prj', prjHue),
  mem(`HoSoScan/${CODE_QPK}.xlsx`, xlsx),
  mem('QuyHoach/ghi-chu.xlsx', new Uint8Array(zipOf([
    { name: 'xl/workbook.xml', data: '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Khac" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', data: '<worksheet/>' }
  ])))
], 'HoSoGIS');
assert.equal(has(read, /LUC/), true);
assert.equal(has(read, /thiếu tiền tố HT_/), true);
assert.equal(crsTexts(read).length, 0);
assert.equal(read.issues.some(i => i.group === 'Siêu dữ liệu' && i.level === 'fail'), false);

const ui = fs.readFileSync(new URL('../public/js/gisDossierUi.js', import.meta.url), 'utf8');
const reader = fs.readFileSync(new URL('../public/js/gisDossierRead.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
assert.match(ui, /import\('\.\/gisDossierRead\.js'\)/);
assert.doesNotMatch(ui, /gisXlsx/);
assert.match(reader, /import\('\.\/gisXlsx\.js'\)/);
assert.doesNotMatch(reader, /from '\.\/gisXlsx\.js'/);
assert.match(html, /id="mapTitleText">BẢN ĐỒ QUY HOẠCH THÀNH PHỐ HUẾ</);
const xlsxSize = fs.statSync(new URL('../public/js/gisXlsx.js', import.meta.url)).size;
assert.ok(xlsxSize < 20000, `gisXlsx.js ${xlsxSize} byte`);

console.log(`gis dossier ok, gisXlsx.js ${xlsxSize} byte`);
