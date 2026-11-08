import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, root), 'utf8');

const pick = read('public/js/adminMapPick.js');
assert.match(pick, /export async function resolveAdminHits/);
assert.match(pick, /export async function consumeAdminHybridClick/);
assert.match(pick, /export function adminContextMenuHtml/);
assert.match(pick, /Đơn vị tại điểm/);
assert.match(pick, /admin-ward/);
assert.match(pick, /admin-urban/);
assert.match(pick, /Không có đô thị tại đây/);
assert.match(pick, /if \(isDothiBrowse\(\)\)/);
assert.match(pick, /clearUrbanMapPick\(\)/);
assert.doesNotMatch(pick, /openChooser\(hits/);

const ctx = read('public/js/mapContext.js');
assert.match(ctx, /from '\.\/adminMapPick\.js'/);
assert.match(ctx, /admin-ward/);
assert.match(ctx, /admin-urban/);
assert.match(ctx, /isAdminAxis/);

const app = read('public/js/app.js');
assert.match(app, /consumeAdminHybridClick/);

const vf = read('public/js/viewFlow.js');
assert.match(vf, /urbanMapPicked\(\)/);
assert.match(vf, /clearUrbanMapPick\(\)/);
assert.match(vf, /urbanFocused\(\) \|\| urbanMapPicked\(\)/);

const gp = read('public/js/generalPlanUi.js');
assert.match(gp, /export function urbanMapPicked/);

const spec = read('docs/ui-spec.md');
assert.match(spec, /Chuột trái khóa theo tab/);
assert.match(spec, /chỉ chọn đúng xã\/phường/);
assert.match(spec, /chỉ chọn theo ranh đô thị/);
assert.match(spec, /Esc khi đang chọn đô thị/);
assert.match(spec, /Đơn vị tại điểm/);

const cn = read('public/js/chuyenNganh.js');
assert.match(cn, /export function selectDvhcName/);
assert.match(cn, /export function ensureAdminTab/);

console.log('admin map pick ok');
