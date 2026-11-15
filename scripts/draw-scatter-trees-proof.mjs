/**
 * Ảnh chứng minh cây phố từ pipeline thật (buildModel + scatterTrees).
 * Không sửa thuật toán — chỉ vẽ tọa độ đã gieo.
 * Usage: node scripts/draw-scatter-trees-proof.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildModel,
  scatterTrees,
  treeStats,
  treeCap,
  pathLengthMeters,
  STREET_TREE_PLANT_W,
  isPlantableStreet
} from '../public/js/phanTich3d.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, 'fixtures/osm-3d-thuanhoa.json');
const lat = 16.4705;
const lng = 107.579;
const r = 500;
const mLat = 110540;
const mLng = 111320 * Math.cos((lat * Math.PI) / 180);
const origin = { lat, lng, mLat, mLng };

const osm = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const model = buildModel(
  { gba: [], osm, cadastre: [], localInfra: [], osmError: '', gbaError: '', cadError: 'bỏ qua' },
  origin,
  r,
  null,
  null
);

const roads = (model.roads || []).filter(isPlantableStreet);
const trees = model.trees || [];
const stats = treeStats(trees);
const street = trees.filter((t) => t.source === 'street');
const park = trees.filter((t) => t.source !== 'street');

// Panel 2: đường thẳng giả lập (unit) — chứng minh plantAlong hai bên lề.
const demoRoad = { path: [[-200, 0], [200, 0]], width: 22.5, rank: 'khuvuc' };
const demoTrees = scatterTrees([], 400, 80, [demoRoad]);
const demoStats = treeStats(demoTrees);

const W = 1100;
const H = 720;
const pad = 48;

function worldToSvg(x, y, cx, cy, scale) {
  return [cx + x * scale, cy - y * scale];
}

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
svg += `<rect width="${W}" height="${H}" fill="#0b1220"/>`;
svg += `<text x="${pad}" y="36" fill="#f8fafc" font-family="Segoe UI,sans-serif" font-size="20" font-weight="700">Chứng minh cây phố 3D — tọa độ vừa gieo từ buildModel</text>`;
svg += `<text x="${pad}" y="58" fill="#94a3b8" font-family="Segoe UI,sans-serif" font-size="13">Fixture OSM Thuận Hóa · r=${r}m · PLANT_W=${STREET_TREE_PLANT_W} · street=${stats.street} park=${stats.park} · ${new Date().toISOString()}</text>`;

// —— Panel trái: fixture OSM (đường + tán) ——
const panel1 = { x: pad, y: 80, w: 500, h: 500 };
svg += `<rect x="${panel1.x}" y="${panel1.y}" width="${panel1.w}" height="${panel1.h}" fill="#111827" stroke="#334155"/>`;
svg += `<text x="${panel1.x + 12}" y="${panel1.y + 24}" fill="#e2e8f0" font-family="Segoe UI,sans-serif" font-size="14" font-weight="700">A. buildModel(fixture OSM) — đường trồng được + tán street</text>`;

const cx1 = panel1.x + panel1.w / 2;
const cy1 = panel1.y + panel1.h / 2 + 10;
const scale1 = (panel1.w - 40) / (2 * r);

// disc
svg += `<circle cx="${cx1}" cy="${cy1}" r="${r * scale1}" fill="#0f172a" stroke="#475569" stroke-dasharray="4 4"/>`;

for (const road of roads) {
  const path = road.path;
  if (!path || path.length < 2) continue;
  let d = '';
  for (let i = 0; i < path.length; i++) {
    const [sx, sy] = worldToSvg(path[i][0], path[i][1], cx1, cy1, scale1);
    d += `${i ? 'L' : 'M'}${sx.toFixed(1)},${sy.toFixed(1)}`;
  }
  const stroke = road.width >= 30 ? '#f87171' : road.width >= 20 ? '#fbbf24' : '#60a5fa';
  svg += `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${Math.max(1.5, (road.width || 8) * scale1 * 0.35)}" opacity="0.9"/>`;
}

for (const t of park) {
  const [sx, sy] = worldToSvg(t.position[0], t.position[1], cx1, cy1, scale1);
  svg += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="3.2" fill="#166534" opacity="0.75"/>`;
}
for (const t of street) {
  const [sx, sy] = worldToSvg(t.position[0], t.position[1], cx1, cy1, scale1);
  svg += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="4.2" fill="#4ade80" opacity="0.95"/>`;
}

svg += `<text x="${panel1.x + 12}" y="${panel1.y + panel1.h - 12}" fill="#86efac" font-family="Segoe UI,sans-serif" font-size="12">Xanh sáng = street (${stats.street}) · xanh đậm = park (${stats.park}) · đường màu = plantable (${roads.length})</text>`;

// —— Panel phải: đoạn đường thẳng ——
const panel2 = { x: pad + 520, y: 80, w: 480, h: 500 };
svg += `<rect x="${panel2.x}" y="${panel2.y}" width="${panel2.w}" height="${panel2.h}" fill="#111827" stroke="#334155"/>`;
svg += `<text x="${panel2.x + 12}" y="${panel2.y + 24}" fill="#e2e8f0" font-family="Segoe UI,sans-serif" font-size="14" font-weight="700">B. Đoạn 400m lộ giới 22,5 m — hai hàng lề</text>`;

const cx2 = panel2.x + panel2.w / 2;
const cy2 = panel2.y + panel2.h / 2 + 20;
const scale2 = 1.05;
const roadH = Math.max(10, 22.5 * scale2 * 0.45);
svg += `<rect x="${(cx2 - 200 * scale2).toFixed(1)}" y="${(cy2 - roadH / 2).toFixed(1)}" width="${(400 * scale2).toFixed(1)}" height="${roadH.toFixed(1)}" fill="#334155"/>`;
svg += `<line x1="${(cx2 - 200 * scale2).toFixed(1)}" y1="${cy2}" x2="${(cx2 + 200 * scale2).toFixed(1)}" y2="${cy2}" stroke="#fbbf24" stroke-dasharray="6 5"/>`;

for (const t of demoTrees) {
  const [sx, sy] = worldToSvg(t.position[0], t.position[1], cx2, cy2, scale2);
  const col = t.source === 'street' ? '#4ade80' : '#166534';
  svg += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${Math.max(5, t.radius * 0.4).toFixed(1)}" fill="${col}" opacity="0.92"/>`;
}

const along = demoTrees.filter((t) => Math.abs(t.position[1]) > 1);
svg += `<text x="${panel2.x + 12}" y="${panel2.y + panel2.h - 28}" fill="#86efac" font-family="Segoe UI,sans-serif" font-size="12">Tán street=${demoStats.street} · lệch hai bên lề=${along.length}</text>`;
svg += `<text x="${panel2.x + 12}" y="${panel2.y + panel2.h - 12}" fill="#94a3b8" font-family="Segoe UI,sans-serif" font-size="12">Đây là đúng tọa độ đưa vào deck.gl tree-canopy</text>`;

const ok = stats.street >= 20 && along.length >= 8;
svg += `<rect x="${pad}" y="${H - 56}" width="${W - pad * 2}" height="36" rx="6" fill="${ok ? '#14532d' : '#7f1d1d'}"/>`;
svg += `<text x="${pad + 16}" y="${H - 32}" fill="#f8fafc" font-family="Segoe UI,sans-serif" font-size="15" font-weight="700">${ok ? 'PASS: có hàng cây phố dọc đường (pipeline gieo OK)' : 'FAIL: không đủ cây phố — dừng trồng phố'}</text>`;
svg += '</svg>';

const outDir = 'C:/Users/User/.cursor/projects/c-Users-User-Desktop-DA-HTKT-Hue-T9-CloneGit-Cursor-QH-Hue/assets';
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outSvg = path.join(outDir, `proof-street-trees-${stamp}.svg`);
const outLatest = path.join(outDir, 'proof-street-trees-latest.svg');
fs.writeFileSync(outSvg, svg);
fs.writeFileSync(outLatest, svg);

const plantedM = Math.round(roads.reduce((s, road) => s + pathLengthMeters(road.path), 0));
const report = {
  ok,
  at: new Date().toISOString(),
  fixture: fixturePath,
  treeCap: treeCap(r),
  plantableRoads: roads.length,
  plantedRoadM: plantedM,
  streetTrees: stats.street,
  parkTrees: stats.park,
  demoStreet: demoStats.street,
  demoAlongCurb: along.length,
  outSvg,
  outLatest
};
fs.writeFileSync(path.join(outDir, 'proof-street-trees-latest.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!ok) process.exit(1);
