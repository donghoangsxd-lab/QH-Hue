import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  additionLabel, applyAddition, coversPoint, newAdditionId, parseAdditionPack, ringIssue, ringSelfIntersects, toExplicitVolumes
} from '../public/js/bldgAdditions.js';

function square(lng, lat, d) {
  return [[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]];
}

const ring = square(107.59, 16.46, 0.0004);
assert.equal(ringIssue(ring), '');
assert.equal(ringIssue(square(107.59, 16.46, 0.00003)), 'Diện tích quá nhỏ (dưới 20 m²)');
assert.equal(ringIssue([[100, 10], [100.01, 10], [100.01, 10.01], [100, 10.01]]), 'Dấu chân ngoài thành phố Huế');
const bow = [[107.59, 16.46], [107.592, 16.462], [107.59, 16.462], [107.592, 16.46], [107.59, 16.46]];
assert.equal(ringSelfIntersects(bow), true);
assert.match(ringIssue(bow), /tự cắt/);

const actor = { email: 'admin@example.com' };
const made = applyAddition({ saved: 1, features: [] }, {
  op: 'upsert', id: 'aadmin0001', name: 'Nhà A', ring, floors: 6
}, actor);
assert.equal(made.pack.features.length, 1);
assert.equal(made.pack.features[0].floors, 6);
assert.equal(made.pack.features[0].by, 'admin@example.com');
assert.equal(made.pack.features[0].tower, null);
assert.equal(additionLabel('', 6), '6');

const other = applyAddition(made.pack, { op: 'upsert', id: 'aadmin0001', ring, floors: 9 }, { email: 'khac@example.com' });
assert.equal(other.status, 403);
assert.match(other.message, /người vẽ/);

const towerRing = square(107.5901, 16.4601, 0.00015);
const split = applyAddition(made.pack, {
  op: 'upsert', id: 'aadmin0001', ring, floors: 2, tower: { ring: towerRing, floors: 10 }
}, actor);
assert.equal(split.pack.features[0].floors, 2);
assert.equal(split.pack.features[0].tower.floors, 10);
assert.equal(additionLabel('podium', 2), 'Đế 2');
assert.equal(additionLabel('tower', 10), 'Tháp 10');
const outside = applyAddition(made.pack, {
  op: 'upsert', id: 'aadmin0001', ring, floors: 2,
  tower: { ring: square(107.595, 16.465, 0.0002), floors: 8 }
}, actor);
assert.match(outside.message, /trong dấu chân/);

const vol = toExplicitVolumes(split.pack.features);
assert.equal(vol.extras.length, 2);
assert.equal(vol.extras[0].explicit, true);
assert.equal(vol.extras[0].added, true);
assert.equal(vol.extras[0].role, 'podium');
assert.equal(vol.extras[0].height, 8);
assert.equal(vol.extras[0].minHeight, 0);
assert.equal(vol.extras[1].role, 'tower');
assert.equal(vol.extras[1].floors, 10);
assert.equal(vol.extras[1].height, 48);
assert.equal(vol.extras[1].minHeight, 8);
assert.equal(vol.extras[1].groundFloors, 2);
assert.equal('lookup' in vol.extras[0], false);
assert.equal(vol.masks.length, 1);
const plain = toExplicitVolumes(made.pack.features);
assert.equal(plain.extras[0].height, 24);
assert.equal(plain.extras[0].role, '');
assert.equal(coversPoint(made.pack.features, 107.5902, 16.4602), true);
assert.equal(coversPoint(made.pack.features, 107.58, 16.45), false);

const removed = applyAddition(split.pack, { op: 'delete', id: 'aadmin0001' }, actor);
assert.equal(removed.pack.features.length, 0);
assert.equal(applyAddition(split.pack, { op: 'delete', id: 'aadmin0001' }, { email: 'khac@example.com' }).status, 403);
assert.match(applyAddition({ saved: 0, features: [] }, { op: 'upsert', ring, floors: 0 }, actor).message, /tầng/);
assert.match(applyAddition({ saved: 0, features: [] }, { op: 'upsert', ring, floors: 81 }, actor).message, /1 đến 80/);

const parsed = parseAdditionPack({
  saved: 4,
  features: [
    { id: 'aadmin0001', ring, floors: 6, by: 'admin@example.com', at: 3 },
    { id: 'bad', ring, floors: 2 },
    { ring, floors: 2 }
  ]
});
assert.equal(parsed.saved, 4);
assert.equal(parsed.features.length, 1);
assert.match(newAdditionId(), /^a[a-z0-9]{8,32}$/);

const root = new URL('..', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, root), 'utf8');
assert.match(read('services/bldgAdditions.js'), /gba\/bldg-additions\.json/);
assert.match(read('services/bldgAdditions.js'), /bldg-overrides/);
assert.match(read('api/gee.js'), /action === 'saveBldgAddition'/);
assert.match(read('api/gee.js'), /await requireAdmin\(req\)/);
assert.match(read('public/js/bldgDraw.js'), /action=saveBldgAddition/);
assert.match(read('public/js/bldgDraw.js'), /adminDrawMode = 'bldg'/);
assert.match(read('public/js/app.js'), /adminDrawMode === 'bldg'/);
assert.match(read('public/js/phanTich3d.js'), /action=getBldgAdditions/);
assert.match(read('public/js/phanTich3d.js'), /feat\.added/);
assert.match(read('public/index.html'), /id="btnGbaDraw"/);
assert.match(read('public/index.html'), /btnGbaDraw" hidden/);
const draw = read('public/js/bldgDraw.js');
assert.match(draw, /isAdmin\(\)/);
assert.doesNotMatch(read('services/bldgAdditions.js'), /putJson\('gba\/bldg-overrides/);
console.log('bldg additions: ok');
