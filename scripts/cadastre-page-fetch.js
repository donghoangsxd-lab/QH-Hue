// Chạy trong trang geditor.aspx của gis21.hue.gov.vn đã mở bằng link có gtoken (cần jQuery của trang).
// Chỉ đọc REST lớp tnmt_thuadat, không lấy tên chủ sử dụng (tenchu).
// Máy nhận (node scripts/cadastre-to-shp.js --listen <port> --out <thư mục>) phục vụ file này tại /fetch.js:
//   eval(await (await fetch('http://127.0.0.1:<port>/fetch.js')).text());
//   qcStart({ base: 'http://127.0.0.1:<port>' })   // chạy nền, tiến độ ở window.__qcProgress
// Chỉ một số xã: { codes: [19803, 19804] }. Xã máy nhận đã ghi thì bỏ qua (chạy lại được khi đứt giữa chừng).

const QC_URL = '/gservices/rest/geodatas/gsv_data/tnmt_thuadat';
const QC_FIELDS = ['madoituong', 'maxa', 'tenxa', 'tenhuyen', 'sohieubando', 'sohieuthua', 'dientich',
  'dientichphaply', 'loaidat', 'diachi', 'tinhtrangphaply', 'daxoa', 'geom'];
const QC_LIMIT = 1000;
const QC_CONC = 4;
// Mã xã của tỉnh Thừa Thiên Huế cũ (danh mục hành chính) nằm trong khoảng này
const QC_SCAN = [19600, 20300];

function qcAjax(query) {
  return new Promise((resolve, reject) => {
    $.ajax({
      url: QC_URL + '?outFormat=json&' + query,
      dataType: 'jsonp',
      timeout: 120000,
      success: resolve,
      error: (xhr, status, err) => reject(new Error(status || String(err) || 'ajax'))
    });
  });
}

let qcActive = 0;
const qcWaiting = [];
async function qcLimited(fn) {
  if (qcActive >= QC_CONC) await new Promise((r) => qcWaiting.push(r));
  qcActive++;
  try {
    return await fn();
  } finally {
    qcActive--;
    if (qcWaiting.length) qcWaiting.shift()();
  }
}

async function qcRetry(query, label) {
  let last = 'unknown';
  for (let a = 1; a <= 4; a++) {
    try {
      return await qcLimited(() => qcAjax(query));
    } catch (err) {
      last = err.message || String(err);
      await new Promise((r) => setTimeout(r, 1000 * a));
    }
  }
  throw new Error(label + ': ' + last);
}

async function qcProbe(code) {
  const r = await qcRetry('page=1&start=0&limit=1&fields=maxa,tenxa,tenhuyen&filter=' + encodeURIComponent('maxa=' + code), 'mã ' + code);
  const total = Number(r.resultCount) || 0;
  if (!total) return null;
  const row = (r.searchResult || [])[0] || {};
  return { maxa: String(code), tenxa: row.tenxa || '', tenhuyen: row.tenhuyen || '', total };
}

async function qcFetchXa(x) {
  const pages = Math.ceil(x.total / QC_LIMIT);
  const filter = encodeURIComponent('maxa=' + x.maxa);
  const fields = encodeURIComponent(QC_FIELDS.join(','));
  const chunks = await Promise.all(Array.from({ length: pages }, (_, pi) => qcRetry(
    'page=' + (pi + 1) + '&start=' + (pi * QC_LIMIT) + '&limit=' + QC_LIMIT + '&fields=' + fields + '&filter=' + filter,
    x.tenxa + ' trang ' + (pi + 1)
  ).then((d) => d.searchResult || [])));
  const rows = [];
  chunks.forEach((part) => part.forEach((row) => {
    delete row.s_geo;
    delete row.resultnumber;
    delete row.tenchu;
    rows.push(row);
  }));
  return rows;
}

async function qcRun(o) {
  const p = window.__qcProgress;
  const base = o.base.replace(/\/$/, '');
  const have = new Set(await (await fetch(base + '/have')).json());
  p.totalAll = Number((await qcRetry('page=1&start=0&limit=1&fields=maxa', 'tổng')).resultCount) || 0;
  const codes = o.codes ? o.codes.map(Number) : [];
  if (!codes.length) for (let c = QC_SCAN[0]; c <= QC_SCAN[1]; c++) codes.push(c);
  p.stage = 'quét mã xã';
  const list = (await Promise.all(codes.map(qcProbe))).filter(Boolean);
  p.xa = list.length;
  p.sumXa = list.reduce((s, x) => s + x.total, 0);
  p.stage = 'tải thửa';
  for (const x of list) {
    if (have.has(x.maxa)) {
      p.skipped++;
      continue;
    }
    p.current = x.maxa + ' ' + x.tenxa;
    const t0 = Date.now();
    try {
      const rows = await qcFetchXa(x);
      const res = await fetch(base + '/xa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...x, rows })
      });
      if (!res.ok) throw new Error('POST ' + res.status + ' ' + (await res.text()).slice(0, 200));
      const saved = await res.json();
      p.done++;
      p.rows += rows.length;
      if (!saved.ok || rows.length !== x.total) p.issues.push({ maxa: x.maxa, tenxa: x.tenxa, total: x.total, n: rows.length, saved });
    } catch (err) {
      p.failed.push({ maxa: x.maxa, tenxa: x.tenxa, error: err.message || String(err) });
    }
    p.lastMs = Date.now() - t0;
  }
  p.current = null;
  p.stage = 'xong';
  p.ms = Date.now() - p.t0;
  await fetch(base + '/done', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).catch(() => null);
  return p;
}

function qcStart(options) {
  const o = options || {};
  if (!o.base) throw new Error('Thiếu base của máy nhận');
  window.__qcProgress = { t0: Date.now(), stage: 'bắt đầu', totalAll: 0, xa: 0, sumXa: 0, done: 0, skipped: 0, rows: 0, issues: [], failed: [], current: null };
  window.__qcRun = qcRun(o).catch((err) => {
    window.__qcProgress.stage = 'lỗi';
    window.__qcProgress.error = err.message || String(err);
  });
  return 'started';
}

if (typeof window !== 'undefined') {
  window.qcStart = qcStart;
}
