import assert from 'node:assert/strict';
import {
  isRoadLot, isGreenLot, isRoadLandCode, isGreenLandCode,
  colorOfReason, parseBankRow, packBankRow,
  REASON_CORRIDOR, REASON_ROAD, REASON_GREEN, REASON_RPH
} from './bank-plan-kinds.mjs';
import { readFileSync } from 'node:fs';

assert.equal(isRoadLot('Đất giao thông', ''), true);
assert.equal(isRoadLot('C-GTDT', ''), true);
assert.equal(isRoadLot('Đất bãi đỗ xe', ''), false);
assert.equal(isGreenLot('Đất cây xanh sử dụng công cộng đô thị', ''), true);
assert.equal(isGreenLot('Công viên ven sông', ''), true);
assert.equal(isGreenLot('Rừng phòng hộ', ''), false);
assert.equal(isRoadLandCode(32), true);
assert.equal(isRoadLandCode(41), true);
assert.equal(isGreenLandCode(5), true);
assert.equal(isGreenLandCode(16), true);
assert.equal(isGreenLandCode(40), false);

assert.equal(colorOfReason(REASON_CORRIDOR), '#f87171');
assert.equal(colorOfReason(REASON_ROAD), '#38bdf8');
assert.equal(colorOfReason(REASON_GREEN), '#4ade80');
assert.equal(colorOfReason(REASON_CORRIDOR | REASON_ROAD), '#c084fc');
assert.equal(colorOfReason(REASON_RPH), '#fbbf24');

const old = parseBankRow([107.59, 16.46, 10, 0, 1, 3], 4);
assert.equal(old.reason, 1);
assert.equal(old.ar, 0);
const neo = parseBankRow([107.59, 16.46, 10, 0, 40, 20, 8 | 16, 2], 5);
assert.equal(neo.ar, 40);
assert.equal(neo.ag, 20);
assert.equal(neo.reason, 24);
const packed = packBankRow({ lng: 107.594238, lat: 16.463008, ac: 1, af: 0, ar: 12, ag: 0, reason: 8, ward: 1 });
assert.equal(packed.length, 8);
assert.equal(packed[6], 8);

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
assert.match(html, /chk_violate/);
assert.match(html, /Công trình vi phạm/);
assert.match(html, /mở đường/);
assert.match(html, /cây xanh/);

const layer = readFileSync(new URL('../public/js/violateLayer.js', import.meta.url), 'utf8');
assert.match(layer, /REASON_ROAD = 8/);
assert.match(layer, /REASON_GREEN = 16/);
assert.match(layer, /Quy hoạch mở đường/);
assert.match(layer, /bank-forest\.json\?v=5/);

console.log('test-bank-plan-flags: ok');
