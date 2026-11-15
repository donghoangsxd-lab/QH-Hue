import fs from 'fs';
import { scatterTrees, roadWidthMeters, STREET_TREE_MIN_W } from '../public/js/phanTich3d.js';

const cases = [
  ['A 13.5m', 13.5],
  ['B 36m', 36],
  ['C 5.5m', 5.5]
];

let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="540" viewBox="0 0 900 540">';
svg += '<rect width="900" height="540" fill="#0f172a"/>';
svg += '<text x="24" y="32" fill="#e2e8f0" font-family="Segoe UI,sans-serif" font-size="18" font-weight="700">Test scatterTrees — tọa độ thật từ unit test (không phải screenshot webapp)</text>';
svg += `<text x="24" y="54" fill="#94a3b8" font-family="Segoe UI,sans-serif" font-size="12">MIN=${STREET_TREE_MIN_W} | residential=${roadWidthMeters({ highway: 'residential' })}m | primary=${roadWidthMeters({ highway: 'primary' })}m</text>`;

cases.forEach(([title, w], i) => {
  const trees = scatterTrees([], 200, 40, [{ path: [[-40, 0], [40, 0]], width: w }]);
  const y0 = 90 + i * 145;
  const sx = 450;
  const sy = y0 + 55;
  const scale = 8;
  const roadH = Math.max(8, w * 0.5);
  svg += `<text x="24" y="${y0}" fill="#f8fafc" font-family="Segoe UI,sans-serif" font-size="14" font-weight="700">${title} × 80m → ${trees.length} tán</text>`;
  svg += `<rect x="${sx - 40 * scale}" y="${sy - roadH / 2}" width="${80 * scale}" height="${roadH}" fill="#334155"/>`;
  svg += `<line x1="${sx - 40 * scale}" y1="${sy}" x2="${sx + 40 * scale}" y2="${sy}" stroke="#fbbf24" stroke-dasharray="8 6"/>`;
  for (const t of trees) {
    const x = sx + t.position[0] * scale;
    const y = sy - t.position[1] * scale;
    const col = `rgb(${t.color.slice(0, 3).join(',')})`;
    svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${Math.max(6, t.radius * 0.55).toFixed(1)}" fill="${col}" opacity="0.92"/>`;
  }
  console.log(title, trees.length, 'r0', trees[0]?.radius);
});

svg += '</svg>';
const out = new URL('../../.cursor/projects/c-Users-User-Desktop-DA-HTKT-Hue-T9-CloneGit-Cursor-QH-Hue/assets/test-scatter-trees-coords.svg', import.meta.url);
// Prefer absolute assets path under Cursor project
const abs = 'C:/Users/User/.cursor/projects/c-Users-User-Desktop-DA-HTKT-Hue-T9-CloneGit-Cursor-QH-Hue/assets/test-scatter-trees-coords.svg';
fs.writeFileSync(abs, svg);
console.log('wrote', abs);
