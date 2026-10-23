// Duyệt một hồ sơ chờ: ghi vào chỗ công bố. Quản trị bấm Duyệt mới chạy.
// Sử dụng đất / ranh đã có thì bỏ qua, không thêm bản sao.
const { landsFromFeatures, boundaryFromFeatures } = require('./landDedupe');

const NET_ROLES = new Set([
  'ht-giao-thong', 'qh-giao-thong', 'ht-cap-nuoc', 'qh-cap-nuoc', 'ht-thoat-nuoc', 'qh-thoat-nuoc',
  'ht-cap-dien', 'qh-cap-dien', 'ht-san-nen', 'qh-san-nen', 'ht-thoat-thai', 'qh-thoat-thai',
  'ht-chat-thai', 'qh-chat-thai', 'ht-vien-thong', 'qh-vien-thong'
]);

const DRAW_KINDS = new Set(['su-dung-dat', 'hien-trang', 'ranh-gioi', 'ban-ve']);

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function cleanFeatures(features) {
  if (!Array.isArray(features) || !features.length) throw fail(400, 'Thiếu đối tượng bản vẽ');
  if (features.length > 4000) throw fail(400, 'Bản vẽ nhiều hơn 4000 đối tượng');
  const text = JSON.stringify(features);
  if (text.length > 1500000) throw fail(413, 'Bản vẽ lớn hơn 1,5 MB');
  return features;
}

function stageSpec({ kind, unit, tenQH, role, summary, features, fields, point }) {
  const key = String(kind || '');
  const name = String(tenQH || '').trim().slice(0, 120);
  const unitKey = String(unit || '').trim();
  const line = String(summary || '').trim().slice(0, 180);
  if (key === 'chi-tieu') {
    if (!fields || typeof fields !== 'object') throw fail(400, 'Thiếu chỉ tiêu');
    return { kind: key, unit: unitKey, tenQH: '', summary: line || unitKey, fields };
  }
  if (key === 'kien-truc') {
    if (!point || typeof point !== 'object') throw fail(400, 'Thiếu công trình');
    return { kind: key, unit: unitKey, tenQH: '', summary: line || String(point.name || ''), point };
  }
  if (!DRAW_KINDS.has(key)) throw fail(400, 'Loại hồ sơ không hợp lệ');
  if (!name) throw fail(400, 'Thiếu tên đồ án');
  const rows = cleanFeatures(features);
  if (key === 'su-dung-dat' && !landsFromFeatures(rows, 'QH').length) throw fail(400, 'Bản vẽ sử dụng đất cần vùng');
  if (key === 'hien-trang' && !landsFromFeatures(rows, 'HT').length) throw fail(400, 'Bản vẽ sử dụng đất cần vùng');
  if (key === 'ranh-gioi' && !boundaryFromFeatures(rows)) throw fail(400, 'Ranh giới cần vùng');
  if (key === 'ban-ve' && !NET_ROLES.has(String(role || ''))) throw fail(400, 'Lớp bản vẽ không hợp lệ');
  return { kind: key, unit: unitKey, tenQH: name, role: key === 'ban-ve' ? String(role) : '', summary: line || name, features: rows };
}

async function applyPublication(obj, { projects, callAppsScript, publishKienTruc }) {
  const kind = obj && obj.kind;
  if (kind === 'chi-tieu') {
    const fields = obj.fields || {};
    await callAppsScript({ action: 'saveUrbanInputs' }, {
      action: 'saveUrbanInputs',
      admin: true,
      email: obj.email,
      unitKey: fields.unitKey,
      unitType: fields.unitType,
      unitCode: fields.unitCode,
      unitName: fields.unitName,
      officer: fields.officer || obj.name || '',
      fields: fields.fields || {}
    });
    return { published: true, note: '' };
  }
  if (kind === 'kien-truc') {
    if (!publishKienTruc) throw fail(500, 'Thiếu bước ghi công trình');
    await publishKienTruc(obj.point || {}, obj.email);
    return { published: true, note: '' };
  }
  if (kind === 'ban-ve') {
    await projects.saveNet({ tenQH: obj.tenQH, role: obj.role, features: obj.features });
    return { published: true, note: '' };
  }
  if (kind === 'su-dung-dat' || kind === 'hien-trang' || kind === 'ranh-gioi') {
    const done = await projects.publishSchemeDraw({ tenQH: obj.tenQH, kind, features: obj.features });
    if (done.skipped) {
      const note = kind === 'ranh-gioi'
        ? 'Đồ án đã có ranh, không thêm bản sao.'
        : 'Đồ án đã có lớp sử dụng đất, không thêm bản sao.';
      return { published: false, skipped: true, note };
    }
    return { published: true, note: '' };
  }
  throw fail(400, 'Loại hồ sơ không hợp lệ');
}

module.exports = { stageSpec, applyPublication, NET_ROLES, DRAW_KINDS };
