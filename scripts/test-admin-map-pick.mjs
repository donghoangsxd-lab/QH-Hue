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
assert.match(pick, /openMultiWardInfoCard|admin-info-multi|TỔNG CỘNG|admin-multi-table/);
assert.match(pick, /Phân tích tổng hợp/);
assert.match(pick, /padStart\(2,\s*['"]0['"]\)/);
assert.match(pick, /Đơn vị hành chính/);
assert.match(pick, /Dân số \(ng\)/);
assert.match(pick, /Diện tích \(km2\)/);
assert.doesNotMatch(pick, /Diện tích<br/);
assert.doesNotMatch(pick, /Đã chọn \$\{list\.length\} đơn vị/);
assert.match(pick, /isShiftClick|getSelectedDvhcNames/);
assert.match(pick, /enableInfoCardDrag|admin-info-multi/);
assert.doesNotMatch(pick, /admin-multi-hint|Giữ Shift và bấm phường\/xã để thêm hoặc bỏ chọn/);
assert.doesNotMatch(pick, /openChooser\(hits/);

const ctx = read('public/js/mapContext.js');
assert.match(ctx, /from '\.\/adminMapPick\.js'/);
assert.match(ctx, /admin-ward/);
assert.match(ctx, /admin-urban/);
assert.match(ctx, /isAdminAxis/);
assert.match(ctx, /Xem thông tin phường\/xã/);
assert.match(ctx, /act === 'ward'/);
assert.match(ctx, /selectWardDetail/);

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
assert.match(spec, /Xem thông tin phường\/xã/);
assert.match(spec, /giống droplist|#wardSelector|không chuyển trục/);

const cn = read('public/js/chuyenNganh.js');
assert.match(cn, /export function selectDvhcName/);
assert.match(cn, /export function ensureAdminTab/);
assert.match(cn, /getSelectedDvhcNames|selectedDvhcNames|qh:dvhc-multi/);
assert.match(cn, /highlightWardNames|isShiftClick/);

assert.match(spec, /Shift và bấm|nhiều phường\/xã|admin-info-multi/);
assert.match(spec, /giữ mở khi pan|kéo thanh tiêu đề|wardLabelPane/);
assert.match(spec, /mở trục A thì tắt tem|#btnWardNames|z 650/);

const css = read('public/css/style.css');
assert.match(css, /admin-info-multi|admin-multi-table/);
assert.match(css, /body\.dvhc-browse\s+\.ua-badge-name/);
assert.doesNotMatch(css, /\.admin-multi-hint\s*\{/);

const mapJs = read('public/js/mapEngine.js');
assert.match(mapJs, /wardLabelPane/);
assert.match(mapJs, /zIndex = '650'/);
const planJs = read('public/js/planMap.js');
assert.match(planJs, /wardLabelPane/);
assert.match(planJs, /zIndex = '650'/);
assert.match(cn, /ward-names-off/);
assert.match(cn, /btnWardNames/);
assert.match(read('public/js/basemap.js'), /export function setWardNames/);

console.log('admin map pick ok');
