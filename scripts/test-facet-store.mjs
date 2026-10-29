import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cacheControlFor, INFRA_JSON } from '../config/gcsCachePolicy.mjs';
import {
  AREA_TP, SCHEME_ALIAS, SECTORS, WARD_NAMES, applyFacetSearch, areaCodeFromName, areaLabel, baseLayers,
  browseState, canonicalSector, facetQuery, findArea, formatKv, getLayers, layerPassesFilter,
  layersFor, listAreas, loadFacetCatalog, normalizeArea, normalizeLayer, parseKv, registerAreas,
  schemesForSector,
  schemesAt, setAreaFilter, setBrowseState, getAreaFilter
} from '../public/js/facetStore.js';

assert.equal(WARD_NAMES.length, 40);
const codes = WARD_NAMES.map(areaCodeFromName);
assert.equal(new Set(codes).size, 40);
assert.equal(areaCodeFromName('Phường Thuận Hóa'), 'thuan-hoa');
assert.equal(areaCodeFromName('Xã Chân Mây - Lăng Cô'), 'chan-may-lang-co');
assert.equal(areaCodeFromName('Xã A Lưới 1'), 'a-luoi-1');
assert.equal(listAreas('xa').length, 40);
assert.ok(listAreas('dothi').some(a => a.code === 'trung-tam' && a.parent === 'TP'));
assert.equal(findArea('dothi', 'hue'), null);
assert.equal(findArea('tp', 'TP').name, 'Toàn thành phố');
assert.ok(listAreas('dothi').length > 10);

assert.deepEqual(normalizeArea({ type: 'tp' }), AREA_TP);
assert.deepEqual(normalizeArea({ type: 'xa', code: 'thuan-hoa' }), { type: 'xa', code: 'thuan-hoa', parent: 'TP' });
assert.equal(normalizeArea({ type: 'tdp', code: 'to-1' }).parent, null);
assert.equal(normalizeArea({ type: 'khac', code: 'a' }), null);

registerAreas([{ type: 'tdp', code: 'to-1', parent: 'thuan-hoa', name: 'Tổ 1' }]);
assert.deepEqual(findArea('tdp', 'to-1'), { type: 'tdp', code: 'to-1', parent: 'thuan-hoa', name: 'Tổ 1' });

assert.equal(formatKv(AREA_TP), 'TP');
assert.deepEqual(parseKv('TP'), AREA_TP);
assert.deepEqual(parseKv('dothi:trung-tam'), { type: 'dothi', code: 'trung-tam', parent: 'TP' });
assert.equal(parseKv('dothi:khong-co').code, 'khong-co');
assert.equal(parseKv(''), null);
assert.equal(areaLabel(parseKv('xa:thuan-hoa')), 'Phường Thuận Hóa');

assert.equal(canonicalSector('giaothong'), 'giao-thong');
assert.equal(canonicalSector('giao-thong'), 'giao-thong');
assert.equal(canonicalSector('ttll'), 'thong-tin-lien-lac');
assert.equal(canonicalSector('khac'), undefined);
assert.equal(SECTORS.map(s => s.id).join(','), 'giao-thong,cap-nuoc,cap-dien,san-nen-thoat-mua,thoat-nuoc-thai,chat-thai-ran-nghia-trang,thong-tin-lien-lac');

const legacy = normalizeLayer({
  sector: 'giaothong', scale: '10000', status: 'QH', name: 'GT', file: 'data/qhc2045/giaothong10.json', scheme: 'qhc-trung-tam'
});
assert.equal(legacy.sector, 'giao-thong');
assert.equal(legacy.level, 'QHC10');
assert.equal(legacy.kind, 'quy-hoach');
assert.equal(legacy.scheme, 'qhc-trung-tam');
assert.equal(legacy.bind, '');

const city = normalizeLayer({
  sector: 'giao-thong', scale: 25000, status: 'hien-trang', name: 'Đường', file: 'data/chuyen-nganh/25000/giao-thong/hien-trang/a.geojson'
});
assert.equal(city.level, 'QHC25');
assert.equal(city.scheme, 'qhc-hue-2045');
assert.equal(city.area.type, 'tp');
assert.equal(city.kind, 'hien-trang');
assert.equal(city.bind, '');

const core = normalizeLayer({
  sector: 'cap-nuoc', scale: 10000, status: 'quy-hoach', name: 'Mạng', file: 'data/chuyen-nganh/10000/cap-nuoc/quy-hoach/a.geojson'
});
assert.equal(core.level, 'QHC10');
assert.equal(core.scheme, 'qhc-trung-tam');
assert.deepEqual(core.area, { type: 'dothi', code: 'trung-tam', parent: 'TP' });

const qhc25 = normalizeLayer({
  sector: 'giao-thong', level: 'QHC', scale: 25000, status: 'hien-trang',
  scheme: 'qhc-do-thi-thua-thien-hue-1-25-000-99f3eaf1', name: 'Đường'
});
assert.equal(qhc25.level, 'QHC25');
assert.equal(qhc25.scheme, 'qhc-do-thi-thua-thien-hue-1-25-000-99f3eaf1');
const qhcTown = normalizeLayer({
  sector: 'giao-thong', level: 'QHC', scale: 2000, status: 'quy-hoach',
  scheme: 'qhc-khe-tre-4a4803cd', name: 'GT'
});
assert.equal(qhcTown.level, 'QHC10');

assert.equal(normalizeLayer({ sector: 'sdd', level: 'QHPK', status: 'hien-trang', name: 'Đất' }).sector, 'sdd');
assert.equal(normalizeLayer({ sector: 'khac', level: 'QHC25', status: 'hien-trang' }), null);
assert.equal(normalizeLayer({ base: true, sector: '', kind: 'hien-trang', name: 'Thửa', bind: 'chk_cadastre', id: 'base-cadastre' }).level, null);

const src = await loadFacetCatalog(async () => ({ ok: false }));
assert.equal(src, 'fallback');
assert.ok(getLayers().some(l => l.bind === 'chk_gt25'));
assert.ok(getLayers().some(l => l.id === 'sdd25' && l.bind === 'chk_qhc25'));
assert.ok(baseLayers({ axis: 'hatang', sector: 'giao-thong' }).some(l => l.bind === 'chk_roads'));

const manifest = await loadFacetCatalog(async () => ({
  ok: true,
  json: async () => ({
    areas: [{ type: 'tdp', code: 'to-2', parent: 'dan-dien', name: 'Tổ 2' }],
    layers: [{
      sector: 'capnuoc', scale: 25000, status: 'hien-trang', name: 'Mạng cấp nước',
      file: 'data/chuyen-nganh/nuoc.json', featureCount: 4
    }]
  })
}));
assert.equal(manifest, 'manifest');
assert.equal(findArea('tdp', 'to-2').parent, 'dan-dien');
assert.ok(!getLayers().some(l => l.file === 'data/qhc2045/giaothong25.json' || l.bind === 'chk_gt25'));
assert.ok(getLayers().some(l => l.bind === 'chk_qhc25'));
const nuoc = getLayers().find(l => l.file === 'data/chuyen-nganh/nuoc.json');
assert.equal(nuoc.sector, 'cap-nuoc');
assert.equal(nuoc.level, 'QHC25');
assert.equal(nuoc.scheme, 'qhc-hue-2045');
assert.equal(nuoc.kind, 'hien-trang');
assert.ok(layersFor('cap-nuoc', 'QHC25', 'qhc-hue-2045').some(l => l.id === nuoc.id));
assert.equal(layersFor('giao-thong', 'QHC25', 'qhc-hue-2045').length, 0);

const wardLayer = { area: { type: 'xa', code: 'thuan-hoa', parent: 'TP' } };
const townLayer = { area: { type: 'dothi', code: 'trung-tam', parent: 'TP' } };
const cityLayer = { area: { ...AREA_TP } };
setAreaFilter({ type: 'xa', code: 'thuan-hoa' }, 'user', { url: false });
assert.equal(layerPassesFilter(wardLayer), true);
assert.equal(layerPassesFilter(cityLayer), true);
assert.equal(layerPassesFilter(townLayer), false);
setAreaFilter({ ...AREA_TP }, 'user', { url: false });
assert.equal(getAreaFilter().type, 'tp');
assert.equal(layerPassesFilter(townLayer), true);
assert.equal(facetQuery().kv, undefined);
assert.equal(facetQuery().tt, undefined);

setBrowseState({ axis: 'hatang', sector: 'giaothong', level: 'QHC25' }, { url: false });
assert.equal(browseState().sector, 'giao-thong');
assert.deepEqual(facetQuery(), { truc: 'hatang', nganh: 'giao-thong' });
const fromUrl = applyFacetSearch('?nganh=ttll&tt=hien-trang&truc=kientruc');
assert.equal(fromUrl.droppedTt, true);
assert.equal(fromUrl.nganh, 'thong-tin-lien-lac');
assert.equal(browseState().axis, 'kientruc');
assert.equal(facetQuery().tt, undefined);
assert.equal(facetQuery().truc, 'kientruc');
assert.equal(facetQuery().nganh, undefined);

const qhc10 = schemesAt('QHC10', []);
assert.ok(qhc10.some(s => s.slug === 'qhc-trung-tam'));
assert.ok(qhc10.some(s => s.slug === 'qhc-phong-dien'));
assert.ok(schemesAt('QHC25', []).some(s => s.slug === 'qhc-hue-2045'));
const withProject = schemesAt('QHPK', [{ tenQH: 'QHPK Khu A', slug: 'khu-a', wards: ['Thuận Hóa'] }]);
assert.ok(withProject.some(s => s.slug === 'khu-a'));

const link = 'public/data/chuyen-nganh/qhc-do-thi-trung-tam-thua-thien-hue-1-10-000-9406ec72';
const sample = `${link}/giao-thong/hien-trang/hien-trang-cong-trinh-dau-moi-giao-thong.geojson`;
const st = fs.lstatSync(link);
assert.ok(st.isSymbolicLink() || st.isDirectory());
assert.equal(fs.existsSync(sample), true);
assert.equal(fs.existsSync('public/data/kien-truc/quy-che.json'), true);
assert.equal(fs.existsSync('public/data/kien-truc/cong-trinh.json'), true);
const quyChe = JSON.parse(fs.readFileSync('public/data/kien-truc/quy-che.json', 'utf8'));
const congTrinh = JSON.parse(fs.readFileSync('public/data/kien-truc/cong-trinh.json', 'utf8'));
assert.equal(quyChe.items.length, 1);
const qcHue = quyChe.items[0];
assert.equal(qcHue.id, 'qcqlkt-hue-2026');
assert.deepEqual(qcHue.area, { type: 'tp', code: 'TP', parent: null });
assert.equal(qcHue.name, 'Thành phố Huế');
assert.equal(qcHue.doc.title, 'Dự thảo Quy chế quản lý kiến trúc thành phố Huế (2026)');
assert.equal(qcHue.doc.url, '/gcs/kien-truc/tp-tp/quy-che.pdf');
assert.equal(cacheControlFor('kien-truc/tp-tp/quy-che.pdf'), INFRA_JSON);
assert.equal('rules' in qcHue, false);
assert.equal(fs.existsSync('public/docs/du-thao-quy-che-quan-ly-kien-truc-2026.pdf'), false);
assert.doesNotMatch(fs.readFileSync('public/_headers', 'utf8'), /du-thao-quy-che/);
const kienTrucUi = fs.readFileSync('public/js/chuyenNganh.js', 'utf8');
assert.match(kienTrucUi, /item\.doc\?\.url/);
assert.match(kienTrucUi, /data-arch-doc-open/);
assert.match(kienTrucUi, /data-arch-photo-open/);
assert.match(kienTrucUi, /data-arch-pdf-open/);
assert.match(kienTrucUi, /openMedia/);
assert.match(kienTrucUi, /openInlinePdf/);
assert.doesNotMatch(kienTrucUi, /target="_blank"/);
assert.equal(congTrinh.items.length, 27);
assert.equal(congTrinh.quyetDinh.so, '1152/QĐ-UBND');
assert.equal(congTrinh.quyetDinh.ngay, '30/5/2018');
assert.equal(congTrinh.nhom.length, 2);
const gaHue = congTrinh.items.find(it => it.id === 'ct-phap-12');
assert.equal(gaHue.ten, 'Ga Huế');
assert.equal(gaHue.nhom, 'B');
assert.equal(gaHue.stt, 1);
assert.equal(gaHue.lng, 107.5780361);
assert.equal(gaHue.lat, 16.456508);
assert.ok(congTrinh.items.every(it => it.ten && Number.isFinite(it.lng) && Number.isFinite(it.lat) && it.phuong));
assert.match(kienTrucUi, /Danh mục công trình kiến trúc Pháp \(Quyết định số 1152\/QĐ-UBND\)/);
assert.match(kienTrucUi, /data-arch-tab/);
assert.match(kienTrucUi, /data-arch-focus/);
assert.match(kienTrucUi, /data-arch-photo/);
assert.match(kienTrucUi, /archPhotoStrip\(item\)\}\$\{open \? archDossier/);
assert.match(kienTrucUi, /cache: 'no-store'/);
assert.doesNotMatch(kienTrucUi, /putSignedPdf/);
assert.match(kienTrucUi, /geeApi\(`action=\$\{encodeURIComponent\(body\.action/);
assert.match(kienTrucUi, /class="arch-pin/);
assert.doesNotMatch(kienTrucUi, /data-arch-qd/);
assert.doesNotMatch(kienTrucUi, /archPopup|marker\.bindPopup|marker\.bindTooltip/);
assert.doesNotMatch(kienTrucUi, /Phường, xã/);
assert.doesNotMatch(kienTrucUi, /shortPlaceName\(item\.phuong\)/);
assert.match(kienTrucUi, /function archPlace/);
assert.match(kienTrucUi, /\['Địa điểm', archPlace\(item\)\]/);
assert.ok(quyChe.schema);
assert.ok(congTrinh.schema);

const landIndex = JSON.parse(fs.readFileSync('public/data/su-dung-dat-index.json', 'utf8'));
assert.deepEqual(Object.keys(SCHEME_ALIAS).sort(), landIndex.aliases.map(a => a.slug).sort());
const aliased = schemesAt('QHC10', [{
  tenQH: 'QHC đô thị trung tâm Thừa Thiên Huế 1/10.000',
  slug: 'qhc-do-thi-trung-tam-thua-thien-hue-1-10-000-9406ec72',
  wards: []
}]);
assert.equal(aliased.some(s => s.slug === 'qhc-do-thi-trung-tam-thua-thien-hue-1-10-000-9406ec72'), false);
assert.ok(aliased.some(s => s.slug === 'qhc-trung-tam'));

await loadFacetCatalog(async () => ({
  ok: true,
  json: async () => ({
    layers: [
      { sector: 'sdd', scale: 10000, status: 'quy-hoach', scheme: 'qhc-trung-tam', name: 'QH sử dụng đất (trung tâm)', file: 'data/qhc2045/sdd.json', ref: 'data/qhc2045/sdd.json' },
      { sector: 'sdd', scale: 10000, status: 'quy-hoach', scheme: 'qhc-khe-tre-4a4803cd', name: 'Chức năng sử dụng đất', file: 'projects/qhc-khe-tre-4a4803cd/su-dung-dat.json', ref: 'projects/qhc-khe-tre-4a4803cd/su-dung-dat.json' },
      { sector: 'giao-thong', scale: 25000, status: 'hien-trang', scheme: 'qhc-hue-2045', name: 'Đường', file: 'data/chuyen-nganh/a.geojson' }
    ]
  })
}));
assert.equal(getLayers().some(l => l.ref), false);
assert.equal(getLayers().some(l => String(l.file).startsWith('projects/')), false);
assert.equal(getLayers().filter(l => l.file === 'data/qhc2045/sdd.json').length, 1);
assert.ok(getLayers().some(l => l.file === 'data/chuyen-nganh/a.geojson' && l.scheme === 'qhc-hue-2045'));

await loadFacetCatalog(async (url) => {
  if (String(url).includes('schemes.json')) {
    return {
      ok: true,
      json: async () => ({
        schemes: [
          { slug: 'qhc-tt-phu-loc-19e96a86', name: 'QHC TT Phú Lộc', area: { type: 'xa', code: 'phu-loc' } },
          { slug: 'qhc-khe-tre-4a4803cd', name: 'QHC Khe Tre', catalogScheme: 'qhc-khe-tre', area: { type: 'dothi', code: 'khe-tre' } },
          { slug: 'qhc-chan-may-lang-co-a44cfad0', name: 'QHC Chân Mây - Lăng Cô', catalogScheme: 'qhc-chan-may', area: { type: 'dothi', code: 'chan-may' } }
        ]
      })
    };
  }
  return {
    ok: true,
    json: async () => ({
      layers: [
        { sector: 'giao-thong', level: 'QHC', scale: null, status: 'quy-hoach', scheme: 'qhc-tt-phu-loc-19e96a86', name: 'Mạng lưới', file: 'data/phu.geojson' },
        { sector: 'giao-thong', level: 'QHC', scale: 2000, status: 'hien-trang', scheme: 'qhc-khe-tre-4a4803cd', name: 'Đường', file: 'data/khe.geojson' },
        { sector: 'giao-thong', level: 'QHC', scale: null, status: 'quy-hoach', scheme: 'qhc-chan-may-lang-co-a44cfad0', name: 'Quy hoạch giao thông', file: 'https://storage.googleapis.com/hue-infra-data-us/projects/qhc-chan-may-lang-co-a44cfad0/qh-giao-thong.json', area: { type: 'dothi', code: 'chan-may' } }
      ]
    })
  };
});
const phu = getLayers().find(l => l.file === 'data/phu.geojson');
assert.equal(phu.area.code, 'phu-loc');
assert.equal(phu.level, 'QHC10');
const khe = getLayers().find(l => l.file === 'data/khe.geojson');
assert.equal(khe.scheme, 'qhc-khe-tre');
assert.equal(khe.area.type, 'dothi');
const may = getLayers().find(l => l.name === 'Quy hoạch giao thông');
assert.equal(may.scheme, 'qhc-chan-may');
assert.equal(may.area.code, 'chan-may');
const on25 = schemesForSector('giao-thong', 'QHC25', []);
assert.ok(on25.some(s => s.slug === 'qhc-tt-phu-loc-19e96a86' && s.name === 'QHC TT Phú Lộc'));
assert.ok(on25.some(s => s.slug === 'qhc-khe-tre' && s.name === 'QHC Khe Tre'));
assert.ok(on25.some(s => s.slug === 'qhc-chan-may' && s.name === 'QHC Chân Mây - Lăng Cô'));
assert.ok(baseLayers({ axis: 'hatang', sector: 'cap-nuoc' }).some(l => l.id === 'ht-tam-cap-nuoc'));
assert.equal(baseLayers({ axis: 'hatang', sector: 'giao-thong' }).some(l => l.id === 'ht-tam-cap-nuoc'), false);
setAreaFilter({ type: 'xa', code: 'phu-loc' }, 'user', { url: false });
const scoped = schemesForSector('giao-thong', 'QHC25', []);
assert.ok(scoped.some(s => s.slug === 'qhc-tt-phu-loc-19e96a86'));
assert.equal(scoped.some(s => s.slug === 'qhc-khe-tre'), false);
const on10 = schemesForSector('giao-thong', 'QHC10', []);
assert.ok(on10.some(s => s.slug === 'qhc-tt-phu-loc-19e96a86'));
assert.equal(on10.some(s => s.slug === 'qhc-khe-tre'), false);
setAreaFilter({ ...AREA_TP }, 'user', { url: false });

await loadFacetCatalog(async (url) => {
  const text = fs.readFileSync(`public/${String(url)}`, 'utf8');
  return { ok: true, json: async () => JSON.parse(text) };
});
const localSlugs = [
  'qhc-tt-phu-loc-19e96a86',
  'qhc-khe-tre',
  'qhc-do-thi-moi-vinh-hung-8899f27b',
  'qhc-khu-cong-nghiep-phong-dien-f997bd2c'
];
for (const sector of ['giao-thong', 'cap-dien', 'cap-nuoc']) {
  const rows = schemesForSector(sector, 'QHC25', []);
  for (const slug of localSlugs) {
    const scheme = rows.find(s => s.slug === slug);
    assert.ok(scheme, `${sector} ${slug}`);
    const layers = layersFor(sector, scheme.level, slug);
    assert.ok(layers.some(l => l.kind === 'quy-hoach'), `${sector} quy-hoach ${slug}`);
    const needHt = slug === 'qhc-do-thi-moi-vinh-hung-8899f27b'
      || (slug === 'qhc-khu-cong-nghiep-phong-dien-f997bd2c' && sector !== 'cap-nuoc');
    if (needHt) assert.ok(layers.some(l => l.kind === 'hien-trang'), `${sector} hien-trang ${slug}`);
  }
  const may = rows.find(s => s.slug === 'qhc-chan-may');
  if (sector === 'giao-thong') {
    assert.ok(may);
    const layers = layersFor('giao-thong', may.level, may.slug);
    assert.equal(layers.length, 1);
    assert.equal(layers[0].kind, 'quy-hoach');
    assert.equal(layers[0].area.code, 'chan-may');
  } else {
    assert.equal(may, undefined);
  }
  assert.ok(baseLayers({ axis: 'hatang', sector }).some(l => l.name === 'Hiện trạng (tạm thời, tổng hợp từ các đồ án)'));
}
const coastProject = schemesForSector('giao-thong', 'QHC10', [
  { slug: 'qhc-chan-may-lang-co-a44cfad0', tenQH: 'QHC Chân Mây - Lăng Cô' }
]);
const mayRows = coastProject.filter(s => s.slug === 'qhc-chan-may' || s.slug === 'qhc-chan-may-lang-co-a44cfad0');
assert.equal(mayRows.length, 1);
assert.equal(mayRows[0].slug, 'qhc-chan-may');
assert.ok(layersFor('giao-thong', mayRows[0].level, mayRows[0].slug).some(l => l.name === 'Quy hoạch giao thông'));
setAreaFilter({ type: 'dothi', code: 'chan-may' }, 'user', { url: false });
const coast = schemesForSector('giao-thong', 'QHC25', []);
assert.ok(coast.some(s => s.slug === 'qhc-chan-may'));
assert.equal(coast.some(s => s.slug === 'qhc-khe-tre'), false);
assert.ok(coast.some(s => s.slug === 'qhc-hue-2045'));
setAreaFilter({ ...AREA_TP }, 'user', { url: false });

const xaSlugs = [
  'qhc-xa-thuong-long-3f2c4da4',
  'qhc-xa-huong-huu-cb7f4149',
  'qhc-xa-huong-loc-1487608f',
  'qhc-xa-thuong-nhat-550f030f'
];
for (const slug of xaSlugs) {
  assert.ok(schemesForSector('giao-thong', 'QHC10', []).some(s => s.slug === slug), `QHC10 ${slug}`);
  assert.equal(schemesForSector('giao-thong', 'QHC25', []).some(s => s.slug === slug), false, `QHC25 ${slug}`);
}
assert.ok(schemesForSector('giao-thong', 'QHC25', []).some(s => s.slug === 'qhc-tt-phu-loc-19e96a86'));

console.log('facet store ok');
