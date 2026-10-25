// Duyệt một hồ sơ chờ: ghi vào chỗ công bố. Quản trị bấm Duyệt mới chạy.
// Sử dụng đất / ranh đã có thì bỏ qua, không thêm bản sao.
// PDF cán bộ (quy chế, văn bản kèm) nằm ở cho-duyet/<id>.pdf cho tới khi duyệt.
const crypto = require('crypto');
const { landsFromFeatures, boundaryFromFeatures } = require('./landDedupe');

const NET_ROLES = new Set([
  'ht-giao-thong', 'qh-giao-thong', 'ht-cap-nuoc', 'qh-cap-nuoc', 'ht-thoat-nuoc', 'qh-thoat-nuoc',
  'ht-cap-dien', 'qh-cap-dien', 'ht-san-nen', 'qh-san-nen', 'ht-thoat-thai', 'qh-thoat-thai',
  'ht-chat-thai', 'qh-chat-thai', 'ht-vien-thong', 'qh-vien-thong'
]);

const DRAW_KINDS = new Set(['su-dung-dat', 'hien-trang', 'ranh-gioi', 'ban-ve']);
const PDF_KINDS = new Set(['van-ban', 'quy-che']);
const PDF_ROLES = new Set(['phe-duyet', 'dinh-chinh', 'quy-dinh', 'thuyet-minh']);
const PDF_OBJECT_RE = /^cho-duyet\/([a-f0-9]{32})\.pdf$/;
const UNIT_RE = /^(tp:TP|dothi:[a-z0-9]+(?:-[a-z0-9]+)*|xa:[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const PDF_MAX = 2 * 1024 * 1024;

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function cleanFeatures(features, allowEmpty) {
  if (!Array.isArray(features) || (!features.length && !allowEmpty)) throw fail(400, 'Thiếu đối tượng bản vẽ');
  if (features.length > 4000) throw fail(400, 'Bản vẽ nhiều hơn 4000 đối tượng');
  return features;
}

function polyGeom(geometry) {
  return geometry && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') ? geometry : null;
}

function cleanReview(review) {
  if (review == null) return [];
  if (!Array.isArray(review)) throw fail(400, 'Danh sách lô đỏ không hợp lệ');
  if (review.length > 4000) throw fail(400, 'Quá nhiều lô đỏ');
  return review.map(item => {
    const id = String(item && item.id || '').slice(0, 40);
    const status = item && item.status === 'bo' ? 'bo' : item && item.status === 'cat' ? 'cat' : '';
    const geometry = polyGeom(item && item.geometry);
    if (!id || !status || !geometry) throw fail(400, 'Lô đỏ cần mã và vùng');
    const index = item.status === 'cat' && Number.isInteger(item.index) && item.index >= 0 ? item.index : null;
    return {
      id,
      status,
      index,
      name: String(item.name || '').slice(0, 120),
      geometry,
      props: item.props && typeof item.props === 'object' ? item.props : {}
    };
  });
}

function cleanClip(clip) {
  if (!clip || typeof clip !== 'object') return null;
  const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n) : 0;
  };
  return { edgeM: num(clip.edgeM), bo: num(clip.bo), cat: num(clip.cat), giu: num(clip.giu) };
}

function assertSize(features, lotReview) {
  const text = JSON.stringify({ features, lotReview });
  if (text.length > 1500000) throw fail(413, 'Bản vẽ lớn hơn 1,5 MB');
}

// Tick giữ hình gốc: thay phần đã cắt, hoặc thêm lại lô đã bỏ. Không tính hình học.
function applyLotKeep(features, lotReview, keepIds) {
  const keep = new Set((Array.isArray(keepIds) ? keepIds : []).map(id => String(id)));
  const rows = (Array.isArray(features) ? features : []).map(row => ({
    ...row,
    props: { ...(row && row.props || {}) }
  }));
  (Array.isArray(lotReview) ? lotReview : []).forEach(item => {
    if (!item || !keep.has(String(item.id)) || !polyGeom(item.geometry)) return;
    if (item.status === 'cat' && Number.isInteger(item.index) && rows[item.index]) {
      rows[item.index] = { ...rows[item.index], geometry: item.geometry };
      return;
    }
    if (item.status === 'bo') {
      rows.push({ name: item.name || '', geometry: item.geometry, props: { ...(item.props || {}) } });
    }
  });
  return rows;
}

function stagePdf(key, unitKey, name, line, pdf) {
  const fileName = String(pdf && pdf.name || '').replace(/[\u0000-\u001f"\\]/g, '').trim().slice(0, 120);
  const object = String(pdf && pdf.object || '');
  const bytes = Number(pdf && pdf.bytes) || 0;
  if (!fileName) throw fail(400, 'Thiếu file PDF');
  if (!PDF_OBJECT_RE.test(object)) throw fail(400, 'Đường dẫn PDF chờ duyệt không hợp lệ');
  if (bytes < 5 || bytes > PDF_MAX) throw fail(400, 'File PDF chờ duyệt tối đa 2 MB.');
  if (!UNIT_RE.test(unitKey)) throw fail(400, 'Đơn vị không hợp lệ');
  if (key === 'quy-che') {
    return { kind: key, unit: unitKey, tenQH: '', summary: line || fileName, pdf: { name: fileName, bytes, object, role: '' } };
  }
  const role = String(pdf && pdf.role || '');
  if (!PDF_ROLES.has(role)) throw fail(400, 'Loại văn bản không hợp lệ');
  if (!name) throw fail(400, 'Thiếu tên đồ án');
  return { kind: key, unit: unitKey, tenQH: name, summary: line || fileName, pdf: { name: fileName, bytes, object, role } };
}

function stageSpec({ kind, unit, tenQH, role, summary, features, fields, point, lotReview, clip, pdf }) {
  const key = String(kind || '');
  const name = String(tenQH || '').trim().slice(0, 120);
  const unitKey = String(unit || '').trim();
  const line = String(summary || '').trim().slice(0, 180);
  if (PDF_KINDS.has(key)) return stagePdf(key, unitKey, name, line, pdf);
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
  const landKind = key === 'su-dung-dat' || key === 'hien-trang';
  const review = landKind ? cleanReview(lotReview) : [];
  const rows = cleanFeatures(features, review.length > 0);
  assertSize(rows, review);
  if (key === 'su-dung-dat' && !landsFromFeatures(rows, 'QH').length && !review.length) throw fail(400, 'Bản vẽ sử dụng đất cần vùng');
  if (key === 'hien-trang' && !landsFromFeatures(rows, 'HT').length && !review.length) throw fail(400, 'Bản vẽ sử dụng đất cần vùng');
  if (key === 'ranh-gioi' && !boundaryFromFeatures(rows)) throw fail(400, 'Ranh giới cần vùng');
  if (key === 'ban-ve' && !NET_ROLES.has(String(role || ''))) throw fail(400, 'Lớp bản vẽ không hợp lệ');
  const stored = { kind: key, unit: unitKey, tenQH: name, role: key === 'ban-ve' ? String(role) : '', summary: line || name, features: rows };
  if (review.length) stored.lotReview = review;
  const clipInfo = landKind ? cleanClip(clip) : null;
  if (clipInfo) stored.clip = clipInfo;
  return stored;
}

async function applyPublication(obj, { projects, callAppsScript, publishKienTruc, readPendingPdf }) {
  const kind = obj && obj.kind;
  if (kind === 'quy-che' || kind === 'van-ban') {
    const object = obj.pdf && obj.pdf.object;
    const id = PDF_OBJECT_RE.exec(String(object || ''));
    if (!id) throw fail(400, 'Thiếu file PDF chờ duyệt');
    if (typeof readPendingPdf !== 'function') throw fail(500, 'Thiếu bước đọc PDF chờ duyệt');
    const buffer = await readPendingPdf(object);
    if (kind === 'quy-che') {
      await projects.saveKienTrucPdf({ unitKey: obj.unit, fileName: obj.pdf.name, buffer });
      return { published: true, note: 'Đã ghi quy chế.' };
    }
    if (!PDF_ROLES.has(String(obj.pdf.role || ''))) throw fail(400, 'Loại văn bản không hợp lệ');
    const fixedId = crypto.createHash('sha256').update(id[1]).digest('hex').slice(0, 8);
    await projects.saveProjectDoc({
      tenQH: obj.tenQH, role: obj.pdf.role, fileName: obj.pdf.name, buffer, fixedId
    });
    return { published: true, note: 'Đã gắn văn bản.' };
  }
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
    const features = kind === 'ranh-gioi'
      ? obj.features
      : applyLotKeep(obj.features, obj.lotReview, obj.keepIds);
    if ((kind === 'su-dung-dat' || kind === 'hien-trang') && !landsFromFeatures(features, kind === 'hien-trang' ? 'HT' : 'QH').length) {
      return { published: false, skipped: true, note: 'Không còn lô trong ranh. Không ghi lớp.' };
    }
    const done = await projects.publishSchemeDraw({ tenQH: obj.tenQH, kind, features });
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

module.exports = { stageSpec, applyPublication, applyLotKeep, NET_ROLES, DRAW_KINDS, PDF_KINDS };
