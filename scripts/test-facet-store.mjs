import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AREA_TP, SECTORS, WARD_NAMES, applyFacetSearch, areaCodeFromName, areaLabel, baseLayers,
  browseState, canonicalSector, facetQuery, findArea, formatKv, getLayers, layerPassesFilter,
  layersFor, listAreas, loadFacetCatalog, normalizeArea, normalizeLayer, parseKv, registerAreas,
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

const link = 'public/data/chuyen-nganh/10000';
const sample = `${link}/giao-thong/hien-trang/hien-trang-cong-trinh-dau-moi-giao-thong.geojson`;
const st = fs.lstatSync(link);
assert.ok(st.isSymbolicLink() || st.isDirectory());
assert.equal(fs.existsSync(sample), true);
assert.equal(fs.existsSync('public/data/kien-truc/quy-che.json'), true);
assert.equal(fs.existsSync('public/data/kien-truc/cong-trinh.json'), true);
const quyChe = JSON.parse(fs.readFileSync('public/data/kien-truc/quy-che.json', 'utf8'));
const congTrinh = JSON.parse(fs.readFileSync('public/data/kien-truc/cong-trinh.json', 'utf8'));
assert.deepEqual(quyChe.items, []);
assert.deepEqual(congTrinh.items, []);
assert.ok(quyChe.schema);
assert.ok(congTrinh.schema);

console.log('facet store ok');
