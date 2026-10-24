// Quầng sáng chỉ được gắn vào vành thành phố. Ranh phường/xã không có glow, halo, bóng hay nét đôi.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const state = read('../public/js/state.js');
const plan = read('../public/js/planMap.js');
const engine = read('../public/js/mapEngine.js');
const urban = read('../public/js/urbanAreaLayer.js');
const qhc = read('../public/js/qhc2045Layer.js');
const css = read('../public/css/style.css');
const seam = read('../public/js/wardSeam.js');

const focusAt = state.indexOf('export const WARD_FOCUS_STYLE');
assert.ok(focusAt > 0);
const focus = state.slice(focusAt, focusAt + 360);
assert.doesNotMatch(focus, /halo/);
assert.match(focus, /fillOpacity: 0\.1/);
assert.match(focus, /#ff1f1f/);

assert.doesNotMatch(plan, /style: halo/);
assert.doesNotMatch(plan, /WARD_FOCUS_STYLE[\s\S]{0,200}halo/);
const focusFn = plan.slice(plan.indexOf('export function wardFocusLayer'), plan.indexOf('export function highlightPlanWard'));
assert.doesNotMatch(focusFn, /halo/);
assert.equal((focusFn.match(/L\.geoJSON/g) || []).length, 2);

const glowClasses = [...engine.matchAll(/className:\s*'([^']+)'/g)].map(m => m[1]).filter(c => /glow|halo|shadow/i.test(c));
assert.deepEqual(glowClasses, ['city-outline-glow']);
assert.match(engine, /function cityOutlineLines\(\)/);
assert.match(engine, /pack\.outer/);
assert.match(engine, /export function clearWardHighlight/);
const paint = engine.slice(engine.indexOf('function paintWardGroup'), engine.indexOf('function syncWardBoundaryPaint'));
assert.match(paint, /cityOutlineLines\(\)/);
assert.doesNotMatch(paint, /outerWardLines/);

assert.doesNotMatch(urban, /weight \+ 8/);
assert.doesNotMatch(urban, /weight \+ 2\.5/);
assert.doesNotMatch(urban, /ringsOf\(w\.feat/);
assert.doesNotMatch(qhc, /EXT_HALO/);
assert.match(seam, /outer: chainLines\(kept\.filter/);

css.split('}').forEach(rule => {
  if (!/(?<![\w-])filter:\s*blur/.test(rule)) return;
  assert.match(rule, /\.city-outline-glow/, `blur ngoài quầng thành phố: ${rule.slice(0, 80)}`);
});

console.log('test-ward-glow ok');
