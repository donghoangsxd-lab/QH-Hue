import assert from 'node:assert/strict';
import { progressColor } from '../public/js/loadProgress.js';

const steps = [
  [0, '#dc2626'],
  [19, '#dc2626'],
  [20, '#ea580c'],
  [39, '#ea580c'],
  [40, '#f59e0b'],
  [59, '#f59e0b'],
  [60, '#eab308'],
  [79, '#eab308'],
  [80, '#84cc16'],
  [99, '#84cc16'],
  [100, '#16a34a']
];

for (const [pct, color] of steps) {
  assert.equal(progressColor(pct), color, String(pct));
}
assert.equal(progressColor(-4), '#dc2626');
assert.equal(progressColor(140), '#16a34a');
assert.equal(progressColor('80'), '#84cc16');
console.log('test-load-progress ok');
