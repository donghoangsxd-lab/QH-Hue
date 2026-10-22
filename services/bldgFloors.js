// File nhỏ gba/bldg-floor-edits.json. Không đọc và không ghi bldg-overrides.geojson.
const gcsWrite = require('./gcsWrite');

const NAME = 'gba/bldg-floor-edits.json';

function logic() {
  return import('../public/js/bldgFloorEdits.js');
}

function inHue(lng, lat) {
  return lng >= 106.8 && lng <= 108.4 && lat >= 15.5 && lat <= 17.2;
}

async function readPack() {
  const { parseFloorPack } = await logic();
  const row = await gcsWrite.readJson(NAME);
  if (!row || row.data == null) return { v: 1, saved: 0, edits: {}, generation: '' };
  const pack = parseFloorPack(row.data);
  pack.generation = row.generation || '';
  return pack;
}

async function saveEdit(body) {
  const { mergeFloorEdit } = await logic();
  const lng = Number(body && body.lng);
  const lat = Number(body && body.lat);
  if (!inHue(lng, lat)) {
    const err = new Error('Tọa độ ngoài thành phố Huế');
    err.status = 400;
    throw err;
  }
  const current = await readPack();
  if (Math.round(Number(body.base) || 0) !== current.saved) {
    const err = new Error('Số tầng vừa được sửa ở phiên khác — bấm lại dấu chân');
    err.status = 409;
    throw err;
  }
  const clear = !body || body.floors == null || body.floors === '';
  const next = mergeFloorEdit(current, lng, lat, clear ? null : body.floors);
  if (!next) {
    const err = new Error('Số tầng không hợp lệ (1–80)');
    err.status = 400;
    throw err;
  }
  const text = JSON.stringify({ v: 1, saved: next.saved, edits: next.edits });
  try {
    await gcsWrite.putJson(NAME, text, current.generation || undefined);
  } catch (err) {
    if (err && err.status === 412) {
      const clash = new Error('Số tầng vừa được sửa ở phiên khác — bấm lại dấu chân');
      clash.status = 409;
      throw clash;
    }
    throw err;
  }
  return next;
}

module.exports = { NAME, readPack, saveEdit };
