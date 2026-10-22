// File nhỏ gba/bldg-additions.json. Không đọc và không ghi bldg-overrides.geojson.
const gcsWrite = require('./gcsWrite');

const NAME = 'gba/bldg-additions.json';

function logic() {
  return import('../public/js/bldgAdditions.js');
}

async function readPack() {
  const { parseAdditionPack } = await logic();
  const row = await gcsWrite.readJson(NAME);
  if (!row || row.data == null) return { v: 1, saved: 0, features: [], generation: '' };
  const pack = parseAdditionPack(row.data);
  pack.generation = row.generation || '';
  return pack;
}

async function saveChange(body, user) {
  const { applyAddition } = await logic();
  const current = await readPack();
  if (Math.round(Number(body && body.base) || 0) !== current.saved) {
    const err = new Error('Dấu chân vừa được sửa ở phiên khác — tải lại rồi sửa tiếp');
    err.status = 409;
    throw err;
  }
  const actor = {
    email: String((user && user.email) || ''),
    name: String((user && (user.name || user.email)) || '')
  };
  const result = applyAddition(current, body, actor);
  if (!result.pack) {
    const err = new Error(result.message || 'Dấu chân không hợp lệ');
    err.status = result.status || 400;
    throw err;
  }
  const text = JSON.stringify({ v: 1, saved: result.pack.saved, features: result.pack.features });
  if (text.length > 400000) {
    const err = new Error('Danh sách dấu chân quá lớn');
    err.status = 413;
    throw err;
  }
  try {
    await gcsWrite.putJson(NAME, text, current.generation || undefined);
  } catch (err) {
    if (err && err.status === 412) {
      const clash = new Error('Dấu chân vừa được sửa ở phiên khác — tải lại rồi sửa tiếp');
      clash.status = 409;
      throw clash;
    }
    throw err;
  }
  return result.pack;
}

module.exports = { NAME, readPack, saveChange };
