// Chạy trong một trang geditor.aspx bất kỳ (cần jQuery và URLSERVICEVECTORMAP của gServer).
// Danh sách lớp lấy từ GET {URLSERVICEVECTORMAP}/map/{mapid}, nên không phải mở trang của từng đồ án.
// Chỉ đọc REST công khai. Không gọi addFeature / updateFeature / deleteFeature.
//
// Máy nhận (node scripts/gserver-to-shp.js --listen <port> --auto --out <thư mục>) phục vụ luôn file này
// tại /fetch.js, nên một lần Runtime.evaluate (awaitPromise) là đủ:
//   eval(await (await fetch('http://127.0.0.1:<port>/fetch.js')).text());
//   await qhFetchMany([22898, 23923], { postUrl: 'http://127.0.0.1:<port>/dump' })
// Chỉ một lớp: { only: ['ranh'] } | ['vung'] | ['diem'] | ['ht']
// Xem các lớp của đồ án: await qhListLayers(22898)
// Chỉ định lớp khi tên không theo mẫu (tên lớp hoặc tên bảng, nhiều lớp thì gộp):
//   { layers: { vung: ['Sử dụng đất khu A', 'Sử dụng đất khu B'], ranh: 'Ranh giới lập QH' } }
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

// names: tên lớp khớp đúng, mẫu mới trước, mẫu cũ (đồ án 2023 trở về trước) sau.
// keys: không lớp nào khớp đúng tên thì lấy mọi lớp chứa đủ các cụm của bộ đầu tiên có lớp khớp,
// đúng kiểu hình (kinds) và không chứa cụm nào trong not.
const QH_TARGETS = [
  {
    key: 'ranh',
    names: ['ranh gioi quy hoach dang duong', 'duong ranh gioi quy hoach'],
    keys: [['ranh gioi', 'quy hoach'], ['ranh gioi', 'lap'], ['ranh gioi', 'nghien cuu']],
    not: ['hanh chinh'],
    kinds: ['line', 'polygon'],
    shape: 'PolyLine'
  },
  {
    key: 'vung',
    names: ['chuc nang su dung dat'],
    keys: [['su dung dat'], ['tong mat bang'], ['chuc nang', 'dat']],
    not: ['hien trang', 'ranh gioi'],
    kinds: ['polygon'],
    shape: 'Polygon'
  },
  {
    key: 'diem',
    names: ['diem chuc nang'],
    keys: [['diem', 'chuc nang'], ['diem', 'cong trinh']],
    not: ['hien trang'],
    kinds: ['point'],
    shape: 'Point',
    optional: true
  },
  {
    key: 'ht',
    names: ['hien trang su dung dat'],
    keys: [['hien trang', 'dat']],
    not: [],
    kinds: ['polygon'],
    shape: 'Polygon',
    optional: true
  }
];

function qhKind(kieu) {
  const s = qhStripName(kieu);
  if (/point|diem/.test(s)) return 'point';
  if (/line|duong/.test(s)) return 'line';
  if (/polygon|vung|area/.test(s)) return 'polygon';
  return null;
}

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

// Lớp có dữ liệu, bỏ lớp trùng (một bảng hiển thị nhiều lần trên bản đồ).
function qhDataLayers(info) {
  const seen = new Set();
  return info.layers.filter((l) => {
    if (!l.lopDuLieu) return false;
    const id = l.maDichVu + '/' + l.lopDuLieu;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function qhListLayers(mapid) {
  const info = await qhMapInfo(mapid);
  return qhDataLayers(info).map((l) => ({ ten: l.tenLopBanDo, bang: l.lopDuLieu, dv: l.maDichVu, kieu: l.kieuKhongGian }));
}

function qhPickLayers(info, targets, override) {
  const data = qhDataLayers(info);
  const used = new Set();
  const take = (hits) => hits.forEach((l) => used.add(l));
  const picks = targets.map((t) => {
    const want = override && override[t.key];
    if (want) {
      const list = [].concat(want).map((w) => String(w));
      const hits = data.filter((l) => list.some((w) => l.lopDuLieu === w || qhStripName(l.tenLopBanDo) === qhStripName(w)));
      const lost = list.filter((w) => !hits.some((l) => l.lopDuLieu === w || qhStripName(l.tenLopBanDo) === qhStripName(w)));
      if (lost.length) throw new Error('Không có lớp chỉ định cho ' + t.key + ': ' + lost.join(', '));
      take(hits);
      return { t, how: 'chi-dinh', hits };
    }
    for (const name of t.names) {
      const hits = data.filter((l) => !used.has(l) && qhStripName(l.tenLopBanDo) === name);
      if (hits.length) {
        take(hits);
        return { t, how: 'ten', hits };
      }
    }
    return { t, how: null, hits: [] };
  });
  picks.forEach((p) => {
    if (p.hits.length) return;
    const fits = data.filter((l) => {
      if (used.has(l)) return false;
      const kind = qhKind(l.kieuKhongGian);
      const name = qhStripName(l.tenLopBanDo);
      return (!kind || p.t.kinds.includes(kind)) && !p.t.not.some((w) => name.includes(w));
    });
    for (const set of p.t.keys) {
      const hits = fits.filter((l) => set.every((w) => qhStripName(l.tenLopBanDo).includes(w)));
      if (hits.length) {
        take(hits);
        p.how = 'tu-khoa';
        p.hits = hits;
        return;
      }
    }
  });
  const absent = picks.filter((p) => !p.hits.length && !p.t.optional).map((p) => p.t.key);
  if (absent.length) {
    const list = data.map((l) => l.tenLopBanDo + ' [' + (l.kieuKhongGian || '?') + ']').join('; ');
    throw new Error('mapid ' + info.mapid + ' không có lớp: ' + absent.join(', ')
      + '. Các lớp hiện có: ' + (list || '(không có)')
      + '. Chỉ định bằng { layers: { ' + absent[0] + ': \'<tên lớp>\' } }');
  }
  return picks.map((p) => ({
    ...p.t,
    how: p.how,
    sources: p.hits.map((l) => ({ ten: l.tenLopBanDo, bang: l.lopDuLieu, dv: l.maDichVu, kieu: l.kieuKhongGian }))
  }));
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
  info.mapid = mapid;
  const infoMs = Date.now() - t0;
  const picked = qhPickLayers(info, targets, opts.layers);

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

  async function ajaxRetry(url, label) {
    let last = 'unknown';
    for (let a = 1; a <= MAX_TRY; a++) {
      try {
        return await qhAjax(url);
      } catch (err) {
        last = err.message || String(err);
        await sleep(500);
      }
    }
    throw new Error(label + ': ' + last);
  }

  function pageUrl(src, pi, fieldQ) {
    return '/gservices/rest/geodatas/' + src.dv + '/' + src.bang
      + '?outFormat=json&page=' + (pi + 1) + '&start=' + (pi * LIMIT) + '&limit=' + LIMIT
      + (fieldQ ? '&fields=' + fieldQ : '');
  }

  // gServer bỏ khóa có giá trị rỗng khỏi từng dòng: lấy hợp các khóa ở trang đầu và trang cuối.
  async function probe(src) {
    const first = await ajaxRetry(pageUrl(src, 0), src.ten + ' thăm dò');
    const total = Number(first.resultCount) || 0;
    const sample = (first.searchResult || []).slice();
    const lastPage = Math.ceil(total / LIMIT) - 1;
    if (lastPage >= 1) {
      const last = await ajaxRetry(pageUrl(src, lastPage), src.ten + ' thăm dò');
      (last.searchResult || []).forEach((r) => sample.push(r));
    }
    const fields = [];
    sample.forEach((row) => Object.keys(row).forEach((k) => {
      if (k !== 's_geo' && k !== 'resultnumber' && !fields.includes(k)) fields.push(k);
    }));
    return { total, fields };
  }

  async function fetchSource(src) {
    const lt0 = Date.now();
    const meta = await limited(() => probe(src));
    const total = meta.total;
    const pages = total > 0 ? Math.ceil(total / LIMIT) : 0;
    const fieldQ = encodeURIComponent(meta.fields.join(','));
    const chunks = await Promise.all(Array.from({ length: pages }, (_, pi) => limited(async () => {
      const data = await ajaxRetry(pageUrl(src, pi, fieldQ), src.ten + ' trang ' + (pi + 1));
      const part = data.searchResult || [];
      part.forEach((row) => {
        delete row.s_geo;
        delete row.resultnumber;
      });
      return part;
    })));
    const rows = [];
    chunks.forEach((c) => { if (c) c.forEach((r) => rows.push(r)); });
    return { rows, total, fields: meta.fields, ms: Date.now() - lt0 };
  }

  const present = picked.filter((p) => p.sources.length);
  const results = await Promise.all(present.map((p) => Promise.all(p.sources.map(fetchSource))));
  const rows = {};
  const layers = picked.map((p) => {
    if (!p.sources.length) return { key: p.key, ten: p.names[0], optional: true, skipped: true };
    const got = results[present.indexOf(p)];
    const merged = got.length > 1;
    rows[p.key] = [];
    got.forEach((g, i) => g.rows.forEach((r) => {
      if (merged) r.lopnguon = p.sources[i].ten;
      rows[p.key].push(r);
    }));
    const fields = [];
    got.forEach((g) => g.fields.forEach((f) => { if (!fields.includes(f)) fields.push(f); }));
    if (merged) fields.push('lopnguon');
    const total = got.reduce((s, g) => s + g.total, 0);
    return {
      key: p.key,
      ten: p.sources.map((s) => s.ten).join(' + '),
      bang: p.sources.map((s) => s.bang).join(','),
      dv: p.sources[0].dv,
      kieu: p.sources[0].kieu,
      shape: p.shape,
      how: p.how,
      sources: p.sources.map((s, i) => ({ ten: s.ten, bang: s.bang, dv: s.dv, total: got[i].total, n: got[i].rows.length, ms: got[i].ms })),
      total,
      n: rows[p.key].length,
      fields,
      match: got.every((g) => g.rows.length === g.total),
      ms: Math.max(...got.map((g) => g.ms))
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

// options.layers theo từng mapid: { layersByMap: { 22898: { vung: '...' } } }
async function qhFetchMany(mapids, options) {
  const out = [];
  const t0 = Date.now();
  const o = options || {};
  for (const mapid of [].concat(mapids)) {
    try {
      const layers = (o.layersByMap && o.layersByMap[mapid]) || o.layers;
      const meta = await qhFetchGserverLayers({ ...o, layers, mapid });
      out.push({
        map: meta.map,
        ok: meta.layers.every((l) => l.skipped || l.match),
        fetchMs: meta.ms,
        postMs: meta.postMs,
        layers: meta.layers.map((l) => (l.skipped
          ? { key: l.key, skipped: true }
          : { key: l.key, how: l.how, ten: l.ten, src: l.sources.length, n: l.n, total: l.total, ms: l.ms })),
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
  window.qhListLayers = qhListLayers;
}
