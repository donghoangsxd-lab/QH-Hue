import assert from 'node:assert/strict';
import fs from 'node:fs';
import { floorKey, floorsAt, floorsOnRing, mergeFloorEdit, metresForFloors, parseFloorPack } from '../public/js/bldgFloorEdits.js';

const key = floorKey(107.593952, 16.4632636);
assert.equal(key, '107.59395,16.46326');
const pack = mergeFloorEdit({ saved: 0, edits: { '107.10000,16.20000': 4 } }, 107.593952, 16.4632636, 22);
assert.equal(pack.edits['107.10000,16.20000'], 4);
assert.equal(pack.edits[key], 22);
assert.equal(floorsAt(pack, 107.593952, 16.4632636), 22);
assert.equal(metresForFloors(22), 88);
assert.equal(mergeFloorEdit(pack, 107.593952, 16.4632636, 0), null);
assert.equal(mergeFloorEdit(pack, 107.593952, 16.4632636, 81), null);
const cleared = mergeFloorEdit(pack, 107.593952, 16.4632636, null);
assert.equal(cleared.edits[key], undefined);
assert.equal(cleared.edits['107.10000,16.20000'], 4);

const ring = [[107.59, 16.46], [107.60, 16.46], [107.60, 16.47], [107.59, 16.47]];
assert.equal(floorsOnRing(pack, ring), 22);
assert.equal(floorsOnRing(pack, [[107.1, 16.1], [107.11, 16.1], [107.11, 16.11]]), null);
const parsed = parseFloorPack({ saved: 3, edits: { [key]: 22, bad: 5, '1.00000,2.00000': 90 } });
assert.equal(parsed.saved, 3);
assert.deepEqual(parsed.edits, { [key]: 22 });

const root = new URL('..', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, root), 'utf8');
assert.match(read('services/bldgFloors.js'), /gba\/bldg-floor-edits\.json/);
assert.match(read('services/bldgFloors.js'), /bldg-overrides/);
assert.match(read('api/gee.js'), /action === 'saveBldgFloor'/);
assert.match(read('api/gee.js'), /await requireAdmin\(req\)/);
assert.match(read('public/js/gbaLayer.js'), /redrawFeet\(\)/);
assert.match(read('public/js/phanTich3d.js'), /qh-floor-edit/);
assert.match(read('public/index.html'), /id="btnGbaFloors"/);
console.log('bldg floors: ok');
