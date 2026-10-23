// Dựng catalog hạ tầng chuyên ngành từ thư mục LOP-mapid* (gserver-to-shp.js).
//   node scripts/build-chuyen-nganh.js "<thư mục chứa LOP-mapid…>"
//   node scripts/build-chuyen-nganh.js --gcs
// Giữ nguyên GeoJSON và zip. EPSG:4326. Không in hình ra stdout.
const fs = require('fs');
const path = require('path');
const { verifyOut } = require('./gserver-to-shp');

const MB5 = 5 * 1024 * 1024;
const GCS_PREFIX = 'chuyen-nganh/v1';
const GCS_PUBLIC = 'https://storage.googleapis.com/hue-infra-data-us/';
const PHONG_DIEN = 'qhc-do-thi-phong-dien-den-nam-2030-tam-nhin-den-nam-2045-5727c5b3';
const KCN = 'qhc-khu-cong-nghiep-phong-dien-f997bd2c';
const SECTORS = [
  ['giao-thong', 'Giao thông'],
  ['cap-nuoc', 'Cấp nước'],
  ['cap-dien', 'Cấp điện'],
  ['san-nen-thoat-mua', 'San nền và thoát nước mưa'],
  ['thoat-nuoc-thai', 'Thoát nước thải'],
  ['chat-thai-ran-nghia-trang', 'Chất thải rắn và nghĩa trang'],
  ['thong-tin-lien-lac', 'Thông tin liên lạc'],
  ['sdd', 'Sử dụng đất, ranh và lớp quy hoạch khác']
];
const SECTOR_LABEL = Object.fromEntries(SECTORS);

// Tách camelCase trước khi bỏ dấu: mangLuoiNghiaTrang → «nghia trang».
// sdd đứng trước hạ tầng để ranh / sử dụng đất không bị nuốt. Thải đứng trước «thoát nước» mưa.
const RULES = [
  [/su dung dat|chuc nang|diem chuc nang|khong gian|ranh gioi|dinh vi ranh|chi gioi|danh gia moi truong|danh gia tong hop|lua chon dat|cong trinh ngam|dinh huong phat trien/, 'sdd'],
  [/chat thai ran|nghia trang/, 'chat-thai-ran-nghia-trang'],
  [/thoat nuoc thai|xu ly nuoc thai/, 'thoat-nuoc-thai'],
  [/thong tin|tram thong tin/, 'thong-tin-lien-lac'],
  [/cap nuoc/, 'cap-nuoc'],
  [/cap dien|phan phoi dien|nang luong|chieu sang|den chieu sang|cot den/, 'cap-dien'],
  [/giao thong|duong bo|duong sat|duong thuy|cau giao thong|bo via|mat duong|mat cat/, 'giao-thong'],
  [/thoat nuoc|thuy loi|luu vuc|phan luu|huong thoat|chieu cao|tieu thoat|do cao thoat|san nen|dong muc/, 'san-nen-thoat-mua']
];

// Slug trùng projects/index.json khi đồ án đã có. Đồ án mới dùng projectSlug(tên).
const SCHEMES = [
  { slug: 'qhc-do-thi-thua-thien-hue-1-25-000-99f3eaf1', name: 'QHC đô thị Thừa Thiên Huế 1/25.000', level: 'QHC', mapid: 21817, scale: 25000, parent: null, overrides: [], priority: 1, gcs: 'add' },
  { slug: 'qhc-do-thi-trung-tam-thua-thien-hue-1-10-000-9406ec72', name: 'QHC đô thị trung tâm Thừa Thiên Huế 1/10.000', level: 'QHC', mapid: 21817, scale: 10000, parent: null, overrides: [], priority: 1, gcs: 'add' },
  { slug: 'qhc-tt-phu-loc-19e96a86', name: 'QHC TT Phú Lộc', level: 'QHC', mapid: 20674, scale: null, parent: null, overrides: [], priority: 1, gcs: 'exists', taskDecision: '3134/QĐ-UBND', taskDecisionDate: '2019-12-16', decision: '1101/QĐ-UBND', decisionDate: '2020-04-17', authority: 'UBND tỉnh' },
  { slug: 'qhc-khe-tre-4a4803cd', name: 'QHC Khe Tre', level: 'QHC', mapid: 20778, scale: 2000, parent: null, overrides: [], priority: 1, gcs: 'exists', taskDecision: '1022/QĐ-UBND', taskDecisionDate: '2016-05-16', decision: '688/QĐ-UBND', decisionDate: '2020-03-13' },
  { slug: 'qhc-do-thi-moi-vinh-hung-8899f27b', name: 'QHC Đô thị mới Vinh Hưng', level: 'QHC', mapid: 22906, scale: null, parent: null, overrides: [], priority: 1, gcs: 'exists', decision: '193/QĐ-UBND', decisionDate: '2025-01-21', authority: 'UBND thành phố Huế' },
  { slug: KCN, name: 'QHC Khu công nghiệp Phong Điền', level: 'QHC', mapid: 22880, scale: null, parent: PHONG_DIEN, overrides: [PHONG_DIEN], overrideArea: 'ranh KCN', priority: 2, gcs: 'add' },
  { slug: PHONG_DIEN, name: 'QHC Đô thị Phong Điền đến năm 2030 tầm nhìn đến năm 2045', level: 'QHC', mapid: null, scale: null, parent: null, overrides: [], priority: 1, gcs: 'exists', skipLayers: true }
];

// Nhóm quy hoạch 21817 chưa nằm trong thư mục LOP đã tải (chỉ có hạ tầng + hiện trạng sử dụng đất).
const MISSING_21817 = [
  { scale: 25000, sector: 'sdd', status: 'quy-hoach', name: 'Ranh giới quy hoạch dạng vùng / dạng đường' },
  { scale: 25000, sector: 'sdd', status: 'quy-hoach', name: 'Sơ đồ tổ chức không gian, kiến trúc cảnh quan' },
  { scale: 25000, sector: 'sdd', status: 'quy-hoach', name: 'Đánh giá tổng hợp lựa chọn đất xây dựng' },
  { scale: 10000, sector: 'sdd', status: 'quy-hoach', name: 'Ranh giới quy hoạch dạng vùng / dạng đường' },
  { scale: 10000, sector: 'sdd', status: 'quy-hoach', name: 'Chức năng sử dụng đất, phân khu, tiểu vùng, điểm chức năng' },
  { scale: 10000, sector: 'sdd', status: 'quy-hoach', name: 'Sơ đồ tổ chức không gian' },
  { scale: 10000, sector: 'sdd', status: 'quy-hoach', name: 'Công trình ngầm dạng vùng / đường / điểm' }
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

function words(name) {
  return strip(String(name || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
}

function slug(s) {
  return strip(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function classifySector(name) {
  const key = words(name);
  for (const [re, sector] of RULES) {
    if (re.test(key)) return sector;
  }
  return undefined;
}

function scaleOf(dirName) {
  const s = strip(dirName);
  if (/1[:\- ]25/.test(s) || /25[.,]000/.test(s)) return 25000;
  if (/1[:\- ]10/.test(s) || /10[.,]000/.test(s)) return 10000;
  if (/1[:\- ]2/.test(s) || /2[.,]000/.test(s)) return 2000;
  return null;
}

function statusOf(dirName) {
  const s = strip(dirName);
  if (s.startsWith('hien trang')) return 'hien-trang';
  if (s.startsWith('quy hoach') || s.startsWith('ranh gioi') || s.startsWith('so do') || s.startsWith('danh gia')) return 'quy-hoach';
  return null;
}

function schemeFor(mapid, scale) {
  const hits = SCHEMES.filter((s) => s.mapid === mapid && !s.skipLayers);
  if (hits.length === 1) return hits[0];
  return hits.find((s) => s.scale === scale) || null;
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

function lopDirs(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^LOP-mapid\d+/i.test(d.name))
    .map((d) => path.join(root, d.name));
}

function mapidOf(dirName) {
  const m = String(dirName).match(/mapid(\d+)/i);
  return m ? Number(m[1]) : null;
}

function collect(roots) {
  const layers = [];
  const gaps = [];
  const unclassified = [];
  for (const root of roots) {
    for (const lop of lopDirs(root)) {
      const mapid = mapidOf(path.basename(lop));
      for (const dirName of fs.readdirSync(lop)) {
        const dir = path.join(lop, dirName);
        if (!fs.statSync(dir).isDirectory()) continue;
        const scale = scaleOf(dirName);
        const status = statusOf(dirName);
        const scheme = schemeFor(mapid, scale);
        if (!scheme || !status) continue;
        for (const row of verifyOut(dir)) {
          const name = layerStem(row.zip);
          const sector = classifySector(name);
          if (!row.walked || row.records !== row.geojson || row.code !== 9994) {
            throw new Error(`${dirName}/${row.zip}: shapefile không khớp GeoJSON (${row.records} / ${row.geojson})`);
          }
          if (!row.geojson) {
            gaps.push({
              scheme: scheme.slug, sector: sector || null, scale: scheme.scale, status, level: scheme.level,
              name, featureCount: 0, reason: 'Mọi dòng không có hình hợp lệ, đã bỏ'
            });
            continue;
          }
          const bbox = row.bbox.map(round6);
          if (!hueBbox(bbox)) throw new Error(`${dirName}/${name}: bbox ngoài WGS84 vùng Huế ${bbox.join(',')}`);
          if (!sector) {
            unclassified.push({ mapid, name, group: dirName });
            continue;
          }
          const dict = path.join(dir, `${name}-ten-truong.txt`);
          if (!fs.existsSync(dict)) throw new Error(`Thiếu từ điển trường: ${dict}`);
          const geojson = path.join(dir, `${name}.geojson`);
          layers.push({
            scheme: scheme.slug,
            level: scheme.level,
            sector,
            scale: scheme.scale,
            status,
            name,
            geomType: geomTypeOf(row.type),
            featureCount: row.geojson,
            fields: fieldsOf(dict),
            bbox,
            geojson,
            zip: path.join(dir, row.zip),
            dict,
            bytes: { geojson: fs.statSync(geojson).size, zip: fs.statSync(path.join(dir, row.zip)).size }
          });
        }
      }
    }
  }
  return { layers, gaps, unclassified };
}

function place(layers, repo) {
  const root = path.join(repo, 'data', 'chuyen-nganh');
  fs.mkdirSync(root, { recursive: true });
  for (const old of ['10000', '25000']) {
    const p = path.join(root, old);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }
  const slugs = new Set(layers.map((l) => l.scheme));
  slugs.forEach((slugName) => {
    const p = path.join(root, slugName);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  });
  const used = new Set();
  const heavy = [];
  for (const layer of layers) {
    const base = slug(layer.name);
    let stem = base;
    let n = 2;
    const folder = path.join(root, layer.scheme, layer.sector, layer.status);
    while (used.has(path.join(folder, stem))) {
      stem = `${base}-${n}`;
      n += 1;
    }
    used.add(path.join(folder, stem));
    fs.mkdirSync(folder, { recursive: true });
    const relDir = path.posix.join(layer.scheme, layer.sector, layer.status);
    const geoRel = path.posix.join('data/chuyen-nganh', relDir, `${stem}.geojson`);
    const zipRel = geoRel.replace(/\.geojson$/, '.zip');
    fs.copyFileSync(layer.dict, path.join(repo, geoRel.replace(/\.geojson$/, '-ten-truong.txt')));
    const uploads = [];
    if (layer.bytes.geojson > MB5) {
      uploads.push({ local: layer.geojson, object: `${GCS_PREFIX}/${relDir}/${stem}.geojson`, type: 'application/geojson' });
    } else {
      fs.copyFileSync(layer.geojson, path.join(repo, geoRel));
    }
    if (layer.bytes.zip > MB5) {
      uploads.push({ local: layer.zip, object: `${GCS_PREFIX}/${relDir}/${stem}.zip`, type: 'application/zip' });
    } else {
      fs.copyFileSync(layer.zip, path.join(repo, zipRel));
    }
    layer.file = uploads.some((u) => u.type === 'application/geojson')
      ? GCS_PUBLIC + uploads.find((u) => u.type === 'application/geojson').object
      : geoRel;
    layer.heavy = uploads.length > 0;
    if (layer.heavy) heavy.push({ file: layer.file, geojson: layer.bytes.geojson, zip: layer.bytes.zip, uploads });
  }
  return heavy;
}

function emptyCells(layers) {
  const out = [];
  SCHEMES.filter((s) => !s.skipLayers).forEach((scheme) => {
    SECTORS.forEach(([sector]) => {
      ['hien-trang', 'quy-hoach'].forEach((status) => {
        const hit = layers.some((l) => l.scheme === scheme.slug && l.sector === sector && l.status === status);
        if (!hit) {
          out.push({
            scheme: scheme.slug, sector, scale: scheme.scale, status, level: scheme.level,
            name: '', featureCount: 0, reason: 'Không có lớp'
          });
        }
      });
    });
  });
  return out;
}

function missing21817() {
  return MISSING_21817.map((g) => {
    const scheme = SCHEMES.find((s) => s.mapid === 21817 && s.scale === g.scale);
    return {
      scheme: scheme.slug, sector: g.sector, scale: g.scale, status: g.status, level: 'QHC',
      name: g.name, featureCount: null, reason: 'Nhóm có trên cây mapid 21817, lô này chưa tải'
    };
  });
}

function manifestOf(layers, gaps) {
  const items = layers.map((layer) => ({
    sector: layer.sector,
    scale: layer.scale,
    status: layer.status,
    scheme: layer.scheme,
    level: layer.level,
    name: layer.name,
    geomType: layer.geomType,
    featureCount: layer.featureCount,
    fields: layer.fields,
    file: layer.file,
    bbox: layer.bbox
  }));
  items.sort((a, b) => (
    SCHEMES.findIndex((s) => s.slug === a.scheme) - SCHEMES.findIndex((s) => s.slug === b.scheme)
    || SECTORS.findIndex((s) => s[0] === a.sector) - SECTORS.findIndex((s) => s[0] === b.sector)
    || String(a.status).localeCompare(String(b.status))
    || a.name.localeCompare(b.name, 'vi')
  ));
  return {
    source: 'https://gissonganh.hue.gov.vn/geditor.aspx',
    crs: 'EPSG:4326',
    sectors: SECTOR_LABEL,
    relations: [
      { scheme: KCN, overrides: [PHONG_DIEN], overrideArea: 'ranh KCN' }
    ],
    layers: items,
    gaps
  };
}

function schemesDoc() {
  return {
    priority: 'Số lớn hơn được ưu tiên trong overrideArea. Không cắt hình.',
    schemes: SCHEMES.map((s) => ({
      slug: s.slug,
      name: s.name,
      level: s.level,
      mapid: s.mapid,
      parent: s.parent,
      overrides: s.overrides,
      priority: s.priority,
      ...(s.scale != null ? { scale: s.scale } : {}),
      ...(s.overrideArea ? { overrideArea: s.overrideArea } : {}),
      ...(s.decision ? { decision: s.decision, decisionDate: s.decisionDate } : {}),
      ...(s.taskDecision ? { taskDecision: s.taskDecision, taskDecisionDate: s.taskDecisionDate } : {}),
      ...(s.authority ? { authority: s.authority } : {})
    }))
  };
}

function statusLabel(status) {
  return status === 'hien-trang' ? 'Hiện trạng' : 'Quy hoạch';
}

function docOf(manifest, heavy) {
  const lines = [];
  const nameOf = Object.fromEntries(SCHEMES.map((s) => [s.slug, s.name]));
  lines.push('# Hạ tầng chuyên ngành');
  lines.push('');
  lines.push('Bộ dữ liệu hạ tầng chuyên ngành, gắn tab Hạ tầng. Mô hình bốn trục: [docs/bon-truc.md](bon-truc.md). CRS **EPSG:4326**.');
  lines.push('');
  lines.push('Đường dẫn: `data/chuyen-nganh/<scheme>/<sector>/<hien-trang|quy-hoach>/` (GeoJSON đủ thuộc tính, zip shapefile UTF-8, `-ten-truong.txt`). Manifest: `public/data/chuyen-nganh/index.json`. Quan hệ đồ án: `public/data/chuyen-nganh/schemes.json`.');
  lines.push('');
  lines.push('## Đồ án');
  lines.push('');
  lines.push('| Slug | Tên | Cấp | mapid | Ưu tiên |');
  lines.push('|---|---|---|---:|---:|');
  SCHEMES.forEach((s) => {
    lines.push(`| ${s.slug} | ${s.name} | ${s.level} | ${s.mapid == null ? '—' : s.mapid} | ${s.priority} |`);
  });
  lines.push('');
  lines.push('QHC Khu công nghiệp Phong Điền nằm trong QHC đô thị Phong Điền. Trong ranh KCN, KCN ghi đè Phong Điền (`overrides`, `overrideArea: ranh KCN`, priority 2 > 1). Không cắt dữ liệu.');
  lines.push('');
  lines.push('Metadata bản đồ gServer không có số quyết định. Số dưới đây lấy từ thuộc tính lớp ranh (ngày dạng M/D/YYYY của shapefile, đã đổi sang ISO). QHC TT Phú Lộc: nhiệm vụ 3134/QĐ-UBND ngày 2019-12-16, phê duyệt 1101/QĐ-UBND ngày 2020-04-17 (UBND tỉnh; 1/5 vùng ranh có giá trị). QHC Khe Tre: nhiệm vụ 1022/QĐ-UBND ngày 2016-05-16, phê duyệt 688/QĐ-UBND ngày 2020-03-13. QHC Đô thị mới Vinh Hưng: phê duyệt 193/QĐ-UBND ngày 2025-01-21 (UBND thành phố Huế). QHC Khu công nghiệp Phong Điền: trường có trên lớp ranh nhưng để trống. Hai đồ án mapid 21817: lô này chưa có lớp ranh quy hoạch.');
  lines.push('');
  lines.push('## Catalog');
  lines.push('');
  lines.push('| Đồ án | Ngành | Trạng thái | Lớp | Kiểu | Số đối tượng |');
  lines.push('|---|---|---|---|---|---:|');
  manifest.layers.forEach((layer) => {
    lines.push(`| ${nameOf[layer.scheme]} | ${SECTOR_LABEL[layer.sector]} | ${statusLabel(layer.status)} | ${layer.name} | ${layer.geomType} | ${layer.featureCount} |`);
  });
  lines.push('');
  lines.push('## Khoảng trống');
  lines.push('');
  lines.push('- Bó vỉa QHC trung tâm 1/10.000: lần tải trước bỏ 8 dòng không có hình.');
  lines.push('- Bó vỉa QHC Khu công nghiệp Phong Điền: 668 dòng, 2 dòng không có hình, catalog giữ 666.');
  lines.push('- Hiện trạng công trình thủy lợi dạng đường, QHC 1/25.000: 28 dòng trên gServer, tất cả thiếu hình.');
  const shown = manifest.gaps.filter((g) => g.reason !== 'Không có lớp' || g.name);
  const empty = manifest.gaps.filter((g) => g.reason === 'Không có lớp');
  shown.forEach((g) => {
    lines.push(`- ${nameOf[g.scheme] || g.scheme}, ${SECTOR_LABEL[g.sector] || g.sector || 'chưa xếp'}, ${statusLabel(g.status)}: ${g.name || '—'} — ${g.reason}.`);
  });
  if (empty.length) {
    lines.push('');
    lines.push('Ô không có lớp (ngành × hiện trạng/quy hoạch):');
    lines.push('');
    empty.forEach((g) => {
      lines.push(`- ${nameOf[g.scheme]} — ${SECTOR_LABEL[g.sector]} — ${statusLabel(g.status)}`);
    });
  }
  lines.push('');
  lines.push('## Lưu trữ');
  lines.push('');
  if (!heavy.length) {
    lines.push('Từng file GeoJSON và zip đều dưới 5 MB, nằm trong git. Không đẩy file lớp lên GCS, không dựng pmtiles. Đồ án chưa có trong `projects/index.json` được thêm dạng mục danh mục (không có ranh lô).');
  } else {
    lines.push('File trên 5 MB nằm trên GCS `hue-infra-data-us/chuyen-nganh/v1/`, `Cache-Control: public, max-age=31536000, immutable`. Không dựng pmtiles (chưa có tippecanoe; lớp lớn là polygon sử dụng đất).');
    heavy.forEach((h) => lines.push(`- ${h.file} (geojson ${h.geojson}, zip ${h.zip})`));
  }
  lines.push('');
  lines.push('Worker chỉ phục vụ `public/`. `scripts/stage-chuyen-nganh.mjs` symlink từng thư mục đồ án từ `data/chuyen-nganh/` sang `public/data/chuyen-nganh/` (không nhân bản trong git) và bung thành bản sao lúc deploy.');
  lines.push('');
  return lines.join('\n');
}

function writeOutputs(repo, layers, gaps, heavy) {
  const manifest = manifestOf(layers, gaps);
  const outJson = path.join(repo, 'public', 'data', 'chuyen-nganh', 'index.json');
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(repo, 'public', 'data', 'chuyen-nganh', 'schemes.json'), JSON.stringify(schemesDoc(), null, 2) + '\n');
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'chuyen-nganh.md'), docOf(manifest, heavy));
  return manifest;
}

function loadGeeKey(repo) {
  if (process.env.GEE_PRIVATE_KEY) return;
  const file = path.join(repo, '.env.local');
  const text = fs.readFileSync(file, 'utf8');
  const line = text.split(/\r?\n/).find((l) => l.startsWith('GEE_PRIVATE_KEY='));
  if (!line) throw new Error('Thiếu GEE_PRIVATE_KEY');
  let v = line.slice('GEE_PRIVATE_KEY='.length).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).replace(/\\"/g, '"');
  }
  process.env.GEE_PRIVATE_KEY = v;
}

async function addMissingSchemes(repo) {
  loadGeeKey(repo);
  const gcs = require('../services/gcsWrite');
  const { splitProjectName } = require('../services/projectStore');
  const cur = await gcs.readJson('projects/index.json');
  if (!cur || !cur.data || !Array.isArray(cur.data.projects)) throw new Error('Không đọc được projects/index.json');
  const projects = cur.data.projects;
  const have = new Set(projects.map((p) => p && (p.slug || p.tenQH)));
  const added = [];
  for (const scheme of SCHEMES.filter((s) => s.gcs === 'add')) {
    if (have.has(scheme.slug) || projects.some((p) => p && p.tenQH === scheme.name)) continue;
    const pair = await splitProjectName(scheme.name);
    projects.push({
      tenQH: scheme.name,
      slug: scheme.slug,
      tenDayDu: pair.tenDayDu,
      tenRutGon: pair.tenRutGon,
      dir: false,
      file: scheme.name,
      wards: [],
      infra: 0,
      lands: 0,
      time: '',
      boundary: null,
      boundarySource: '',
      bbox: null,
      landArea: {},
      legacy: false,
      sheetOnly: true,
      saved: 0
    });
    added.push(scheme.slug);
  }
  if (!added.length) {
    console.log(JSON.stringify({ gcs: 'none' }));
    return;
  }
  const next = { ...cur.data, v: 1, saved: Date.now(), projects };
  await gcs.putJson('projects/index.json', JSON.stringify(next), cur.generation);
  try {
    await gcs.patchCacheControl('projects/index.json', 'public, max-age=3600');
  } catch (err) {
    console.warn('Cache-Control projects/index.json giữ bucket default public, max-age=3600:', err.message);
  }
  console.log(JSON.stringify({ gcs: 'added', added }));
}

async function main() {
  const repo = path.resolve(path.join(__dirname, '..'));
  const args = process.argv.slice(2);
  if (args.includes('--gcs')) {
    await addMissingSchemes(repo);
    if (args.length === 1) return;
  }
  const roots = args.filter((a) => !a.startsWith('--'));
  if (!roots.length) {
    console.error('Thiếu thư mục chứa LOP-mapid');
    process.exit(1);
  }
  const { layers, gaps, unclassified } = collect(roots);
  if (unclassified.length) {
    console.error(JSON.stringify({ unclassified }));
    process.exit(1);
  }
  const heavy = place(layers, repo);
  const allGaps = gaps.concat(emptyCells(layers), missing21817());
  writeOutputs(repo, layers, allGaps, heavy);
  const by = {};
  layers.forEach((l) => {
    const k = `${l.scheme}|${l.sector}|${l.status}`;
    by[k] = by[k] || { n: 0, features: 0 };
    by[k].n += 1;
    by[k].features += l.featureCount;
  });
  console.log(JSON.stringify({
    layers: layers.length,
    features: layers.reduce((s, l) => s + l.featureCount, 0),
    gaps: gaps.map((g) => g.name),
    heavy,
    cells: by
  }));
}

module.exports = { classifySector, scaleOf, statusOf, slug, words, SECTORS, RULES, SCHEMES };

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
