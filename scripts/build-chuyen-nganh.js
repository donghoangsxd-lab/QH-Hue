// Dựng bộ hạ tầng chuyên ngành từ thư mục LOP-mapid21817 (gserver-to-shp.js).
//   node scripts/build-chuyen-nganh.js "<thư mục LOP-mapid21817-…>"
// Giữ nguyên GeoJSON và zip (mọi thuộc tính, EPSG:4326). Không đọc hình ra stdout.
// Lớp không thuộc 7 chuyên ngành, hoặc không còn hình sau khi bỏ dòng thiếu geom, không được copy.
const fs = require('fs');
const path = require('path');
const { verifyOut } = require('./gserver-to-shp');

const MB5 = 5 * 1024 * 1024;
const SECTORS = [
  ['giao-thong', 'Giao thông'],
  ['cap-nuoc', 'Cấp nước'],
  ['cap-dien', 'Cấp điện'],
  ['san-nen-thoat-mua', 'San nền và thoát nước mưa'],
  ['thoat-nuoc-thai', 'Thoát nước thải'],
  ['chat-thai-ran-nghia-trang', 'Chất thải rắn và nghĩa trang'],
  ['thong-tin-lien-lac', 'Thông tin liên lạc']
];
const SECTOR_LABEL = Object.fromEntries(SECTORS);

// Thứ tự: cụm hẹp trước (thải, chất thải rắn) để không nuốt «thoát nước» mưa hay «sử dụng đất».
const RULES = [
  [/su dung dat|chuc nang su dung dat|phan khu chuc nang|tieu vung|diem chuc nang|khong gian|dinh huong phat trien|ranh gioi|cong trinh ngam|danh gia tong hop|lua chon dat/, null],
  [/chat thai ran|nghia trang/, 'chat-thai-ran-nghia-trang'],
  [/thoat nuoc thai|xu ly nuoc thai/, 'thoat-nuoc-thai'],
  [/thong tin lien lac|tram thong tin/, 'thong-tin-lien-lac'],
  [/cap nuoc/, 'cap-nuoc'],
  [/cap dien|phan phoi dien|nang luong|chieu sang/, 'cap-dien'],
  [/giao thong|duong bo|duong sat|duong thuy|cau giao thong|bo via|mat duong|mat cat/, 'giao-thong'],
  [/thoat nuoc|thuy loi|luu vuc|phan luu|huong thoat|chieu cao|tieu thoat|do cao thoat|san nen/, 'san-nen-thoat-mua']
];

// Nhóm vector trên cây mapid 21817 không thuộc 7 chuyên ngành (không tải vào bộ này).
const UNMAPPED_GROUPS = [
  { scale: 25000, group: 'Ranh giới quy hoạch (1:25.000)', layers: ['Ranh giới quy hoạch dạng vùng', 'Ranh giới quy hoạch dạng đường'] },
  { scale: 10000, group: 'Ranh giới quy hoạch (1:10.000)', layers: ['Ranh giới quy hoạch dạng vùng', 'Ranh giới quy hoạch dạng đường'] },
  { scale: 10000, group: 'Quy hoạch tổng mặt bằng sử dụng đất (1:10.000)', layers: ['Chức năng sử dụng đất', 'Phân khu chức năng', 'Sơ đồ tiểu vùng', 'Điểm chức năng'] },
  { scale: 25000, group: 'Sơ đồ tổ chức không gian, kiến trúc cảnh quan (1:25.000)', layers: ['Quy hoạch vùng không gian', 'Không gian mặt nước', 'Không gian cây xanh', 'Quy hoạch đường không gian', 'Định hướng phát triển đô thị'] },
  { scale: 10000, group: 'Sơ đồ tổ chức không gian, kiến trúc cảnh quan (1:10.000)', layers: ['Quy hoạch vùng không gian', 'Không gian cây xanh', 'Không gian mặt nước', 'Quy hoạch đường không gian'] },
  { scale: 10000, group: 'Quy hoạch công trình ngầm (1:10.000)', layers: ['Công trình ngầm dạng vùng', 'Công trình ngầm dạng đường', 'Công trình ngầm dạng điểm'] },
  { scale: 25000, group: 'Đánh giá môi trường chiến lược (1:25.000)', layers: ['Đánh giá tổng hợp lựa chọn đất xây dựng dạng vùng', 'Đánh giá tổng hợp lựa chọn đất xây dựng dạng điểm'] }
];

function strip(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(s) {
  return strip(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function classifySector(name) {
  const key = strip(name);
  for (const [re, sector] of RULES) {
    if (re.test(key)) return sector;
  }
  return undefined;
}

function scaleOf(dirName) {
  const s = strip(dirName);
  if (/1[:\- ]25/.test(s) || /25[.,]000/.test(s)) return 25000;
  if (/1[:\- ]10/.test(s) || /10[.,]000/.test(s)) return 10000;
  return null;
}

function statusOf(dirName) {
  const s = strip(dirName);
  if (s.startsWith('hien trang')) return 'hien-trang';
  if (s.startsWith('quy hoach')) return 'quy-hoach';
  return null;
}

function geomTypeOf(shpType) {
  if (shpType === 1 || shpType === 11 || shpType === 21) return 'Point';
  if (shpType === 3 || shpType === 13 || shpType === 23) return 'LineString';
  if (shpType === 5 || shpType === 15 || shpType === 25) return 'Polygon';
  return 'Unknown';
}

function fieldsOf(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    const i = line.indexOf('\t');
    return (i === -1 ? line : line.slice(i + 1)).trim();
  });
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

function hueBbox(bbox) {
  const [minx, miny, maxx, maxy] = bbox;
  return minx >= 106 && maxx <= 110 && miny >= 15 && maxy <= 18;
}

function layerStem(zipName) {
  return zipName.replace(/\.zip$/i, '');
}

function collect(src) {
  const layers = [];
  const unmapped = [];
  const gaps = [];
  for (const dirName of fs.readdirSync(src)) {
    const dir = path.join(src, dirName);
    if (!fs.statSync(dir).isDirectory()) continue;
    const scale = scaleOf(dirName);
    const status = statusOf(dirName);
    if (!scale || !status) continue;
    const verified = verifyOut(dir);
    for (const row of verified) {
      const name = layerStem(row.zip);
      const sector = classifySector(name);
      const entry = {
        name,
        scale,
        status,
        group: dirName,
        featureCount: row.geojson,
        records: row.records,
        geomType: geomTypeOf(row.type),
        bbox: row.bbox.map(round6),
        zip: path.join(dir, row.zip)
      };
      if (!row.walked || row.records !== row.geojson || row.code !== 9994) {
        throw new Error(`${dirName}/${row.zip}: shapefile không khớp GeoJSON (${row.records} / ${row.geojson})`);
      }
      if (!entry.featureCount) {
        gaps.push({
          sector: sector || null,
          scale,
          status,
          name,
          featureCount: 0,
          reason: 'Mọi dòng không có hình hợp lệ, đã bỏ'
        });
        continue;
      }
      if (!hueBbox(entry.bbox)) {
        throw new Error(`${dirName}/${name}: bbox ngoài WGS84 vùng Huế ${entry.bbox.join(',')}`);
      }
      if (!sector) {
        unmapped.push({
          scale,
          status,
          group: dirName,
          name,
          geomType: entry.geomType,
          featureCount: entry.featureCount,
          reason: 'Không thuộc 7 chuyên ngành hạ tầng'
        });
        continue;
      }
      const dict = path.join(dir, `${name}-ten-truong.txt`);
      if (!fs.existsSync(dict)) throw new Error(`Thiếu từ điển trường: ${dict}`);
      entry.sector = sector;
      entry.fields = fieldsOf(dict);
      entry.dict = dict;
      entry.geojson = path.join(dir, `${name}.geojson`);
      entry.bytes = {
        geojson: fs.statSync(entry.geojson).size,
        zip: fs.statSync(entry.zip).size
      };
      layers.push(entry);
    }
  }
  return { layers, unmapped, gaps };
}

function place(layers, repo) {
  const used = new Set();
  const heavy = [];
  for (const layer of layers) {
    const base = slug(layer.name);
    let stem = base;
    let n = 2;
    const folder = path.join(repo, 'data', 'chuyen-nganh', String(layer.scale), layer.sector, layer.status);
    while (used.has(path.join(folder, stem))) {
      stem = `${base}-${n}`;
      n += 1;
    }
    used.add(path.join(folder, stem));
    fs.mkdirSync(folder, { recursive: true });
    const geoRel = path.posix.join('data/chuyen-nganh', String(layer.scale), layer.sector, layer.status, `${stem}.geojson`);
    const zipRel = geoRel.replace(/\.geojson$/, '.zip');
    const dictRel = geoRel.replace(/\.geojson$/, '-ten-truong.txt');
    fs.copyFileSync(layer.geojson, path.join(repo, geoRel));
    fs.copyFileSync(layer.zip, path.join(repo, zipRel));
    fs.copyFileSync(layer.dict, path.join(repo, dictRel));
    layer.file = geoRel;
    layer.shp = zipRel;
    layer.heavy = layer.bytes.geojson > MB5 || layer.bytes.zip > MB5;
    if (layer.heavy) heavy.push({ file: geoRel, geojson: layer.bytes.geojson, zip: layer.bytes.zip });
  }
  return heavy;
}

function manifestOf(layers, unmapped, gaps) {
  const items = layers.map((layer) => ({
    sector: layer.sector,
    scale: layer.scale,
    status: layer.status,
    name: layer.name,
    geomType: layer.geomType,
    featureCount: layer.featureCount,
    fields: layer.fields,
    file: layer.file,
    bbox: layer.bbox
  }));
  items.sort((a, b) => (
    SECTORS.findIndex((s) => s[0] === a.sector) - SECTORS.findIndex((s) => s[0] === b.sector)
    || a.scale - b.scale
    || a.status.localeCompare(b.status)
    || a.name.localeCompare(b.name, 'vi')
  ));
  return {
    source: 'https://gissonganh.hue.gov.vn/geditor.aspx?mapid=21817',
    mapid: 21817,
    crs: 'EPSG:4326',
    sectors: SECTOR_LABEL,
    layers: items,
    gaps,
    unmapped: unmapped.concat(UNMAPPED_GROUPS.flatMap((g) => g.layers.map((name) => ({
      scale: g.scale,
      group: g.group,
      name,
      reason: 'Nhóm trên cây lớp không thuộc 7 chuyên ngành, không đưa vào bộ dữ liệu'
    }))))
  };
}

function cellLayers(layers, sector, scale, status) {
  return layers.filter((l) => l.sector === sector && l.scale === scale && l.status === status);
}

function docOf(manifest, heavy) {
  const lines = [];
  lines.push('# Hạ tầng chuyên ngành QHC đô thị Thừa Thiên Huế');
  lines.push('');
  lines.push('Bộ dữ liệu gốc cho các tính năng sau này. Chưa có giao diện.');
  lines.push('');
  lines.push('Nguồn: [mapid 21817](https://gissonganh.hue.gov.vn/geditor.aspx?mapid=21817) (Quy hoạch chung đô thị Thừa Thiên Huế đến năm 2045). Tải bằng `qhFetchLayers` theo nhóm trên cây lớp, máy nhận `gserver-to-shp.js`. Hai nhóm giao thông quy hoạch đã có sẵn trên máy và được dùng lại. CRS **EPSG:4326** (WGS84), cùng hệ Leaflet và `scripts/build-qhc2045.js`.');
  lines.push('');
  lines.push('Mỗi lớp: `data/chuyen-nganh/<tỷ lệ>/<chuyên ngành>/<hien-trang|quy-hoach>/<lớp>.geojson` (đủ thuộc tính), `.zip` shapefile UTF-8, và `-ten-truong.txt` (tên trường DBF 10 ký tự → tên gốc). Manifest: `public/data/chuyen-nganh/index.json`.');
  lines.push('');
  lines.push('## Catalog');
  lines.push('');
  lines.push('| Chuyên ngành | Tỷ lệ | Trạng thái | Lớp | Kiểu | Số đối tượng |');
  lines.push('|---|---:|---|---|---|---:|');
  for (const layer of manifest.layers) {
    const status = layer.status === 'hien-trang' ? 'Hiện trạng' : 'Quy hoạch';
    lines.push(`| ${SECTOR_LABEL[layer.sector]} | 1/${Number(layer.scale).toLocaleString('vi-VN')} | ${status} | ${layer.name} | ${layer.geomType} | ${layer.featureCount} |`);
  }
  lines.push('');
  lines.push('## Khoảng trống');
  lines.push('');
  const partial = [
    '1/25.000 không có lớp cao độ nền hay quy hoạch chiều cao (san nền). Chỉ có hướng thoát nước (quy hoạch) và phân lưu / thủy lợi (hiện trạng).',
    '1/10.000 hiện trạng không có lớp cao độ nền. Quy hoạch chiều cao chỉ có ở nhóm chuẩn bị kỹ thuật 1/10.000.',
    'Không có lớp chiếu sáng riêng trong nhóm điện (cây lớp gộp vào cung cấp năng lượng, điện, chiếu sáng).',
    'Hiện trạng 1/25.000 liệt kê hai lần «Hiện trạng phân lưu thoát nước dạng đường» cùng một bảng; script gộp còn một lớp (8 đối tượng).',
    'Bó vỉa 1/10.000: lần tải trước bỏ 8 dòng không có hình. Catalog đếm số hình đã ghi.',
    'Hiện trạng 1/10.000 không có lớp công trình năng lượng (có ở hiện trạng 1/25.000 và quy hoạch cả hai tỷ lệ).',
    'Hiện trạng 1/25.000 chất thải rắn chỉ có điểm, không có phân khu vùng.',
    'Hiện trạng công trình thủy lợi dạng đường 1/25.000 có 28 dòng trên gServer, tất cả thiếu hình.'
  ];
  partial.forEach((p) => lines.push(`- ${p}`));
  if (!manifest.gaps.length) lines.push('- Không có lớp chuyên ngành nào rỗng sau khi bỏ dòng thiếu hình.');
  manifest.gaps.forEach((g) => {
    const label = g.sector ? SECTOR_LABEL[g.sector] : 'chưa xếp';
    const status = g.status === 'hien-trang' ? 'hiện trạng' : 'quy hoạch';
    lines.push(`- ${label}, 1/${Number(g.scale).toLocaleString('vi-VN')}, ${status}: «${g.name}» — ${g.reason}.`);
  });
  lines.push('');
  lines.push('## Lớp không xếp vào 7 chuyên ngành');
  lines.push('');
  lines.push('| Tỷ lệ | Nhóm / trạng thái | Lớp | Số đối tượng | Lý do |');
  lines.push('|---:|---|---|---:|---|');
  manifest.unmapped.forEach((u) => {
    const where = u.group || '';
    const n = u.featureCount == null ? '—' : String(u.featureCount);
    lines.push(`| 1/${Number(u.scale).toLocaleString('vi-VN')} | ${where} | ${u.name} | ${n} | ${u.reason} |`);
  });
  lines.push('');
  lines.push('Các bản đồ scan (2A–3E, 7A–7F, 10A–10F) là nhóm không có lớp vector. «Hình ảnh các bản vẽ thiết kế đô thị» kiểu DATA, không có hình.');
  lines.push('');
  lines.push('## Lưu trữ');
  lines.push('');
  if (!heavy.length) {
    lines.push('Từng file GeoJSON và zip đều dưới 5 MB nên nằm trong git. Không đẩy GCS, không dựng pmtiles.');
  } else {
    lines.push('File trên 5 MB nằm trên GCS `hue-infra-data-us`, tiền tố `chuyen-nganh/v1/`, `Cache-Control: public, max-age=31536000, immutable`. Không dựng pmtiles (một file GeoJSON đã đủ cho lớp này).');
    heavy.forEach((h) => lines.push(`- ${h.file}`));
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  const src = process.argv[2];
  if (!src) {
    console.error('Thiếu thư mục LOP-mapid21817');
    process.exit(1);
  }
  const repo = path.resolve(process.argv[3] || path.join(__dirname, '..'));
  const { layers, unmapped, gaps } = collect(src);
  const heavy = place(layers, repo);
  const manifest = manifestOf(layers, unmapped, gaps);
  const outJson = path.join(repo, 'public', 'data', 'chuyen-nganh', 'index.json');
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, JSON.stringify(manifest, null, 2) + '\n');
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'chuyen-nganh.md'), docOf(manifest, heavy));
  const by = {};
  layers.forEach((l) => {
    const k = `${l.sector}|${l.scale}|${l.status}`;
    by[k] = (by[k] || 0) + 1;
  });
  console.log(JSON.stringify({
    layers: layers.length,
    features: layers.reduce((s, l) => s + l.featureCount, 0),
    unmapped: unmapped.length,
    gaps: gaps.map((g) => g.name),
    heavy,
    cells: by
  }));
}

module.exports = { classifySector, scaleOf, statusOf, slug, SECTORS, RULES };

if (require.main === module) main();
