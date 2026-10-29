import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MIX_NOISE_PCT, presentLandMix } from '../public/js/planMix.js';

assert.equal(MIX_NOISE_PCT, 1);

const edu = presentLandMix([
  { label: 'Đất đào tạo, nghiên cứu', area: 17184, pct: 98.7 },
  { label: 'Đất ở', area: 52, pct: 0.3 },
  { label: 'Đất dịch vụ, thương mại', area: 17, pct: 0.1 },
  { label: 'Đất khác', area: 157, pct: 0.9 }
]);
assert.equal(edu.length, 1);
assert.equal(edu[0].label, 'Đất đào tạo, nghiên cứu');
assert.ok(Math.abs(edu[0].pct - 100) < 1e-9);
assert.equal(edu[0].rawPct, 98.7);
assert.equal(edu[0].area, 17184);

const kept = presentLandMix([
  { label: 'A', area: 600, pct: 60 },
  { label: 'B', area: 390, pct: 39 },
  { label: 'C', area: 10, pct: 1 },
  { label: 'D', area: 9, pct: 0.9 }
]);
assert.deepEqual(kept.map(s => s.label), ['A', 'B', 'C']);
assert.ok(Math.abs(kept.reduce((n, s) => n + s.pct, 0) - 100) < 1e-6);
assert.equal(kept[2].rawPct, 1);
assert.ok(kept[2].pct >= 1);

const noise = presentLandMix([
  { label: 'A', area: 4, pct: 0.4 },
  { label: 'B', area: 5, pct: 0.5 }
]);
assert.equal(noise.length, 2);
assert.ok(Math.abs(noise.reduce((n, s) => n + s.pct, 0) - 100) < 1e-6);
assert.equal(noise[0].rawPct, 0.4);

const src = fs.readFileSync(new URL('../public/js/planLandStats.js', import.meta.url), 'utf8');
assert.match(src, /presentLandMix/);
assert.match(src, /MIX_NOISE_PCT/);
assert.match(src, /audibleParts/);
assert.match(src, /planLotsTable\(res\.parts, res\.area\)/);
assert.match(src, /mixEntries\(res, noneLabel\)/);
assert.match(src, /fmtPct\(s\.rawPct\)/);
assert.match(src, /s\.rawPct != null \? s\.rawPct : s\.pct/);

console.log('test-plan-mix ok');
