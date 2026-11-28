// DXF QH tỉnh (hatch theo mã RPH/ONT/…) → GeoJSON nhẹ cho tab QH756.
//   node --max-old-space-size=8192 scripts/build-qh756-sdd.mjs [đường-dẫn.dxf]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as turf from '@turf/turf';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DXF = 'C:/Users/User/Desktop/WEBGIS/QH756.dxf';
const OUT_DIR = path.join(repo, 'public', 'data', 'qh756');
const OUT_FILE = path.join(OUT_DIR, 'sdd.json');
// Bỏ layer còn sót từ DGN / không phải mã đất.
const SKIP_LAYER = /^(0|Level\s*\d+|Defpoints|LAYER)$/i;
// ~2–3 m ở vĩ độ Huế — đủ nhẹ cho web, còn nhận dạng lô.
const SIMPLIFY_DEG = 0.00004;

const dxfPath = path.resolve(process.argv[2] || DEFAULT_DXF);

async function loadCad() {
  const mod = await import(pathToFileURL(path.join(repo, 'public', 'js', 'cadImport.js')).href);
  return mod;
}

function roundCoord(n) {
  return Math.round(n * 1e6) / 1e6;
}

function roundRing(ring) {
  return ring.map(([lng, lat]) => [roundCoord(lng), roundCoord(lat)]);
}

/** parcels.polygons = [poly, …]; mỗi poly = [ringShell, hole…]; ring = [lng,lat][]. */
function simplifyPolygon(polygons) {
  if (!polygons?.length) return null;
  const cleanPoly = (poly) => poly
    .map((ring) => {
      const r = roundRing(ring);
      if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push(r[0]);
      return r;
    })
    .filter((ring) => ring.length >= 4);
  const polys = polygons.map(cleanPoly).filter((poly) => poly.length && poly[0].length >= 4);
  if (!polys.length) return null;
  try {
    const f = polys.length === 1 ? turf.polygon(polys[0]) : turf.multiPolygon(polys);
    const s = turf.simplify(f, { tolerance: SIMPLIFY_DEG, highQuality: false, mutate: false });
    const g = s.geometry;
    if (!g) return null;
    if (g.type === 'Polygon') {
      return { type: 'Polygon', coordinates: g.coordinates.map(roundRing) };
    }
    return {
      type: 'MultiPolygon',
      coordinates: g.coordinates.map((poly) => poly.map(roundRing))
    };
  } catch {
    return polys.length === 1
      ? { type: 'Polygon', coordinates: polys[0] }
      : { type: 'MultiPolygon', coordinates: polys };
  }
}

function mainLabel(ma) {
  const m = String(ma || '').toUpperCase();
  const LABELS = {
    RPH: 'Rừng phòng hộ',
    RDD: 'Rừng đặc dụng',
    RSX: 'Rừng sản xuất',
    ONT: 'Đất ở nông thôn',
    ODT: 'Đất ở đô thị',
    CLN: 'Cây lâu năm',
    LUA: 'Đất lúa',
    LUC: 'Đất lúa nước',
    NKH: 'Nông nghiệp khác',
    NNL: 'Đất nông nghiệp',
    NTD: 'Đất chưa sử dụng',
    DGT: 'Đất giao thông',
    DTL: 'Đất thủy lợi',
    DDD: 'Đất chuyên dùng',
    TMD: 'Thương mại dịch vụ',
    SON: 'Đất sông',
    MNC: 'Mặt nước chuyên dùng',
    SKC: 'Đất sản xuất KD phi nông nghiệp',
    SKN: 'Đất sản xuất KD',
    SKS: 'Đất sản xuất KD',
    CQP: 'Đất quốc phòng',
    CAN: 'Đất an ninh',
    CKS: 'Đất cơ sở',
    CNT: 'Đất công trình',
  };
  return LABELS[m] || m;
}

async function run() {
  if (!fs.existsSync(dxfPath)) throw new Error(`Không thấy DXF: ${dxfPath}`);
  const sizeMb = fs.statSync(dxfPath).size / (1024 * 1024);
  console.log(`Đọc ${dxfPath} (${sizeMb.toFixed(1)} MB)…`);
  const text = fs.readFileSync(dxfPath, 'latin1');
  const { parseDxf, buildParcels, CRS_PRESETS } = await loadCad();
  console.log('Parse DXF…');
  const { entities, stats } = parseDxf(text);
  console.log('stats', stats, 'entities', entities.length);
  const kept = entities.filter(e => e.layer && !SKIP_LAYER.test(e.layer));
  console.log('sau lọc layer', kept.length);
  console.log('Chuyển VN-2000 → WGS84…');
  const built = buildParcels(kept, { crs: CRS_PRESETS.HUE_3 });
  console.log('parcels', built.parcels.length, 'axes', built.axes);
  const byMa = new Map();
  const features = [];
  for (const p of built.parcels) {
    if (!p.land && !p.layer) continue;
    const ma = String(p.layer || '').trim().toUpperCase();
    if (!ma || SKIP_LAYER.test(ma)) continue;
    if (!p.polygons?.length) continue;
    const geom = simplifyPolygon(p.polygons);
    if (!geom) continue;
    byMa.set(ma, (byMa.get(ma) || 0) + 1);
    features.push({
      type: 'Feature',
      properties: {
        ma,
        ten: mainLabel(ma),
        area: p.area
      },
      geometry: geom
    });
  }
  const fc = {
    type: 'FeatureCollection',
    name: 'QH756-SDD',
    crsNote: 'WGS84 từ VN-2000 KTT 107° múi 3° (CRS_PRESETS.HUE_3)',
    source: path.basename(dxfPath),
    counts: Object.fromEntries([...byMa.entries()].sort((a, b) => b[1] - a[1])),
    features
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const json = JSON.stringify(fc);
  fs.writeFileSync(OUT_FILE, json);
  console.log(`Ghi ${OUT_FILE} — ${features.length} lô, ${(json.length / (1024 * 1024)).toFixed(2)} MB`);
  console.log('counts', fc.counts);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
