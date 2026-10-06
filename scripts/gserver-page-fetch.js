// Chạy trong một trang geditor.aspx bất kỳ (cần jQuery và URLSERVICEVECTORMAP của gServer).
// Danh sách lớp lấy từ GET {URLSERVICEVECTORMAP}/map/{mapid}, nên không phải mở trang của từng đồ án.
// Chỉ đọc REST công khai. Không gọi addFeature / updateFeature / deleteFeature.
//
// Máy nhận (node scripts/gserver-to-shp.js --listen <port> --auto --out <thư mục>) phục vụ luôn file này
// tại /fetch.js, nên một lần Runtime.evaluate (awaitPromise) là đủ:
//   eval(await (await fetch('http://127.0.0.1:<port>/fetch.js')).text());
//   await qhFetchMany([22898, 23923], { postUrl: 'http://127.0.0.1:<port>/dump' })
// Chỉ một lớp: { only: ['ranh'] } | ['vung'] | ['diem'] | ['ht']
// Không truyền postUrl thì kết quả đồ án cuối nằm ở window.__qhExport.

function qhStripName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// names: tên lớp theo mẫu mới trước, mẫu cũ (đồ án 2023 trở về trước) sau.
const QH_TARGETS = [
  { key: 'ranh', names: ['ranh gioi quy hoach dang duong', 'duong ranh gioi quy hoach'], shape: 'PolyLine' },
  { key: 'vung', names: ['chuc nang su dung dat'], shape: 'Polygon' },
  { key: 'diem', names: ['diem chuc nang'], shape: 'Point', optional: true },
  { key: 'ht', names: ['hien trang su dung dat'], shape: 'Polygon', optional: true }
];

function qhAjax(url) {
  return new Promise((resolve, reject) => {
    $.ajax({
      url,
      dataType: 'jsonp',
      timeout: 15000,
      success: resolve,
      error: (xhr, status, err) => reject(new Error(status || String(err) || 'ajax'))
    });
  });
}

async function qhMapInfo(mapid) {
  const base = typeof URLSERVICEVECTORMAP !== 'undefined' ? URLSERVICEVECTORMAP : '/gservices/rest/vectormaps/gsv_system';
  const data = await $.ajax({ url: base + '/map/' + mapid, dataType: 'json', timeout: 15000 });
  return { tenBanDo: data.tenBanDo || '', layers: data.cacLopBanDo || [] };
}

async function qhFetchGserverLayers(options) {
  const opts = options || {};
  const LIMIT = 20;
  const CONC = 6;
  const MAX_TRY = 4;
  const only = opts.only ? new Set([].concat(opts.only)) : null;
  const targets = only ? QH_TARGETS.filter((t) => only.has(t.key)) : QH_TARGETS;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const t0 = Date.now();
  const mapid = Number(opts.mapid || (String(location.href).match(/mapid=(\d+)/i) || [])[1]);
  if (!mapid) throw new Error('Thiếu mapid');
  const info = await qhMapInfo(mapid);
  const infoMs = Date.now() - t0;

  const picked = targets.map((t) => {
    let hit = null;
    for (const name of t.names) {
      hit = info.layers.find((l) => l.lopDuLieu && qhStripName(l.tenLopBanDo) === name);
      if (hit) break;
    }
    return hit
      ? { ...t, ten: hit.tenLopBanDo, bang: hit.lopDuLieu, dv: hit.maDichVu, kieu: hit.kieuKhongGian }
      : { ...t, name: t.names[0], missing: true };
  });
  const absent = picked.filter((p) => p.missing && !p.optional).map((p) => p.name);
  if (absent.length) throw new Error('mapid ' + mapid + ' không có lớp: ' + absent.join(', '));

  async function probe(layer) {
    const url = '/gservices/rest/geodatas/' + layer.dv + '/' + layer.bang + '?outFormat=json&page=1&start=0&limit=1';
    const data = await qhAjax(url);
    const row = (data.searchResult && data.searchResult[0]) || {};
    const fields = Object.keys(row).filter((k) => k !== 's_geo' && k !== 'resultnumber');
    return { total: Number(data.resultCount) || 0, fields };
  }

  // gServer bỏ phản hồi khi quá tải: mọi lớp dùng chung tối đa CONC request đồng thời.
  let active = 0;
  const waiting = [];
  async function limited(fn) {
    if (active >= CONC) await new Promise((r) => waiting.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      if (waiting.length) waiting.shift()();
    }
  }

  async function fetchLayer(layer) {
    const lt0 = Date.now();
    const meta = await limited(() => probe(layer));
    const total = meta.total;
    const pages = total > 0 ? Math.ceil(total / LIMIT) : 0;
    const fieldQ = encodeURIComponent(meta.fields.join(','));
    async function onePage(pi) {
      const url = '/gservices/rest/geodatas/' + layer.dv + '/' + layer.bang
        + '?outFormat=json&page=' + (pi + 1) + '&start=' + (pi * LIMIT) + '&limit=' + LIMIT + '&fields=' + fieldQ;
      let last = 'unknown';
      for (let a = 1; a <= MAX_TRY; a++) {
        try {
          const data = await qhAjax(url);
          const part = data.searchResult || [];
          part.forEach((row) => {
            delete row.s_geo;
            delete row.resultnumber;
          });
          return part;
        } catch (err) {
          last = err.message || String(err);
          await sleep(500);
        }
      }
      throw new Error(layer.key + ' trang ' + (pi + 1) + ': ' + last);
    }
    const chunks = await Promise.all(Array.from({ length: pages }, (_, pi) => limited(() => onePage(pi))));
    const rows = [];
    chunks.forEach((c) => { if (c) c.forEach((r) => rows.push(r)); });
    return { rows, total, fields: meta.fields, ms: Date.now() - lt0 };
  }

  const present = picked.filter((p) => !p.missing);
  const results = await Promise.all(present.map((p) => fetchLayer(p)));
  const rows = {};
  const layers = picked.map((p) => {
    if (p.missing) return { key: p.key, ten: p.name, optional: true, skipped: true };
    const got = results[present.indexOf(p)];
    rows[p.key] = got.rows;
    return {
      key: p.key,
      ten: p.ten,
      bang: p.bang,
      dv: p.dv,
      kieu: p.kieu,
      shape: p.shape,
      total: got.total,
      n: got.rows.length,
      fields: got.fields,
      match: got.rows.length === got.total,
      ms: got.ms
    };
  });
  const fetchMs = Date.now() - t0;
  const dump = { meta: { map: mapid, tenBanDo: info.tenBanDo, ms: fetchMs, infoMs, layers }, rows };
  window.__qhExport = dump;
  let postMs = 0;
  let posted = null;
  if (opts.postUrl) {
    const p0 = Date.now();
    const res = await fetch(opts.postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dump)
    });
    if (!res.ok) throw new Error('POST dump thất bại: ' + res.status);
    posted = await res.json().catch(() => null);
    postMs = Date.now() - p0;
  }
  return { ...dump.meta, postMs, posted };
}

async function qhFetchMany(mapids, options) {
  const out = [];
  const t0 = Date.now();
  for (const mapid of [].concat(mapids)) {
    try {
      const meta = await qhFetchGserverLayers({ ...(options || {}), mapid });
      out.push({
        map: meta.map,
        ok: meta.layers.every((l) => l.skipped || l.match),
        fetchMs: meta.ms,
        postMs: meta.postMs,
        layers: meta.layers.map((l) => (l.skipped ? { key: l.key, skipped: true } : { key: l.key, n: l.n, total: l.total, ms: l.ms })),
        saved: meta.posted
      });
    } catch (err) {
      out.push({ map: mapid, ok: false, error: err.message || String(err) });
    }
  }
  return { totalMs: Date.now() - t0, maps: out };
}

if (typeof window !== 'undefined') {
  window.qhFetchGserverLayers = qhFetchGserverLayers;
  window.qhFetchMany = qhFetchMany;
}
