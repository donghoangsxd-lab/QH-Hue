// Ô lớp môi trường (NDVI, nhiệt bề mặt, ngập radar, rừng, đất xây dựng).
// Map id Earth Engine hết hạn sau vài giờ và mỗi ô zoom cao là một phép tính riêng: gọi dày thì 429 / quá hạn.
// Năm đã chốt được ghi PNG lên bucket (cache/sat/v1) và trả Cache-Control dài; lần sau không gọi GEE.
const axios = require('axios');
const constants = require('../config/constants');
const sat = require('./satService');
const gcsWrite = require('./gcsWrite');

const CACHE_V = 'v1';
const MAP_TTL_MS = 20 * 60 * 1000;
const GEE_TIMEOUT_MS = 15000;
const GEE_TRIES = 3;
const READ_TIMEOUT_MS = 6000;

// maxZ theo độ phân giải cảm biến: Sentinel-2 / radar ~10 m → z15, Landsat / Hansen ~30 m → z14.
// Zoom cao hơn phóng ô này, không xin Earth Engine ô z16–z19 (dễ quá hạn, để lỗ trống).
const LAYERS = {
  ndvi: { maxZ: 15, minZ: 8 },
  lst: { maxZ: 14, minZ: 8 },
  sar: { maxZ: 15, minZ: 8 },
  forest: { maxZ: 14, minZ: 8 },
  dev: { maxZ: 15, minZ: 12 }
};

const maps = new Map();
const flights = new Map();

function intIn(raw, min, max) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function parseQuery(query, now = new Date()) {
  const layer = String(query.layer || '');
  const spec = LAYERS[layer];
  if (!spec) return null;
  const meta = String(query.meta || '') === '1';
  let year = null;
  let compare = null;
  let mode = null;
  let from = null;
  if (layer === 'ndvi') {
    const years = sat.ndviYears(now);
    year = sat.parseYear(query.year, years);
    if (query.compare) compare = sat.parseYear(query.compare, years);
    if (year == null || (query.compare && compare == null) || compare === year) return null;
  } else if (layer === 'lst') {
    year = sat.parseYear(query.year, sat.lstYears(now));
    if (year == null) return null;
  } else if (layer === 'sar') {
    if (String(query.year) === 'all') year = 'all';
    else {
      year = sat.parseYear(query.year, sat.sarYears(now));
      if (year == null) return null;
    }
  } else if (layer === 'forest') {
    mode = sat.FOREST_MODES.includes(query.mode) ? query.mode : null;
    if (!mode) return null;
  } else if (layer === 'dev') {
    from = Number(query.from);
    if (!sat.DEV_FROM_YEARS.includes(from)) return null;
  }
  const endYear = layer === 'dev' ? sat.devRecentYears(now)[1] : null;
  let z = null;
  let x = null;
  let y = null;
  if (!meta) {
    z = intIn(query.z, spec.minZ, spec.maxZ);
    if (z == null) return null;
    const n = 2 ** z;
    x = intIn(query.x, 0, n - 1);
    y = intIn(query.y, 0, n - 1);
    if (x == null || y == null) return null;
  }
  const q = { layer, meta, year, compare, mode, from, endYear, z, x, y, maxZ: spec.maxZ, minZ: spec.minZ };
  q.durable = durable(q, now);
  return q;
}

function durable(q, now) {
  const y = now.getFullYear();
  if (q.layer === 'ndvi') return q.year < y && (q.compare == null || q.compare < y);
  if (q.layer === 'lst') return q.year < y || now >= new Date(Date.UTC(y, 8, 1));
  if (q.layer === 'sar') {
    if (q.year === 'all') return true;
    return q.year < y || now >= new Date(Date.UTC(y, 11, 15));
  }
  if (q.layer === 'forest' || q.layer === 'dev') return true;
  return false;
}

function seriesId(q) {
  if (q.layer === 'ndvi') return q.compare == null ? String(q.year) : `${q.year}-${q.compare}`;
  if (q.layer === 'lst') return String(q.year);
  if (q.layer === 'sar') return String(q.year);
  if (q.layer === 'forest') return q.mode;
  return `${q.from}-${q.endYear}`;
}

function objectName(q) {
  const id = seriesId(q);
  if (!/^[\w.-]+$/.test(id) || q.z == null) return null;
  return `cache/sat/${CACHE_V}/${q.layer}/${id}/${q.z}/${q.x}/${q.y}.png`;
}

function template(q) {
  const params = new URLSearchParams({ action: 'getSatTile', layer: q.layer });
  if (q.layer === 'ndvi' || q.layer === 'lst' || q.layer === 'sar') params.set('year', String(q.year));
  if (q.layer === 'ndvi' && q.compare != null) params.set('compare', String(q.compare));
  if (q.layer === 'forest') params.set('mode', q.mode);
  if (q.layer === 'dev') params.set('from', String(q.from));
  return `/api/gee?${params.toString()}&z={z}&x={x}&y={y}`;
}

function meta(query, now) {
  const q = parseQuery({ ...query, meta: '1' }, now);
  if (!q) return null;
  return {
    urlFormat: template(q),
    legend: sat.tileLegend(q.layer, q),
    maxNativeZoom: q.maxZ,
    minZoom: q.minZ
  };
}

function mapKey(q) {
  return `${q.layer}|${seriesId(q)}`;
}

function fillTemplate(url, z, x, y) {
  return String(url).replaceAll('{z}', String(z)).replaceAll('{x}', String(x)).replaceAll('{y}', String(y));
}

function classifyGee(status, body, contentType) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
  const png = buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const ct = String(contentType || '').toLowerCase();
  if (status === 200 && (png || ct.includes('image/'))) return 'ok';
  const text = buf.slice(0, 500).toString('utf8');
  if (status === 429 || status >= 500 || /timeout|timed out|deadline|unavailable|too many|resource exhausted/i.test(text)) return 'retry';
  if (status === 400 || status === 401 || status === 403 || status === 404 || /expired|token|map ?id|not exist|unrecognized/i.test(text)) return 'expired';
  return 'fail';
}

function pngHeaders(durableTile, source) {
  return {
    'Content-Type': 'image/png',
    'Cache-Control': durableTile
      ? 'public, max-age=86400, s-maxage=2592000, immutable'
      : 'public, max-age=300, s-maxage=3600',
    'X-Sat-Tile': source
  };
}

function publicUrl(name) {
  const path = name.split('/').map(encodeURIComponent).join('/');
  return `${constants.GCS_PUBLIC_BASE}${path}`;
}

async function readPublic(name) {
  try {
    const res = await axios.get(publicUrl(name), {
      responseType: 'arraybuffer',
      timeout: READ_TIMEOUT_MS,
      validateStatus: () => true
    });
    if (res.status !== 200 || !res.data) return null;
    const buf = Buffer.from(res.data);
    return classifyGee(200, buf, res.headers['content-type']) === 'ok' ? buf : null;
  } catch (err) {
    return null;
  }
}

function buildVis(ee, wards, q) {
  if (q.layer === 'ndvi') {
    const img = q.compare == null ? sat.ndviImage(ee, wards, q.year) : sat.ndviDiff(ee, wards, q.year, q.compare);
    const vis = q.compare == null ? sat.NDVI_VIS : sat.NDVI_DIFF_VIS;
    return img.visualize(vis);
  }
  if (q.layer === 'lst') return sat.lstImage(ee, wards, q.year).visualize(sat.LST_VIS);
  if (q.layer === 'sar') return sat.sarFloodVis(ee, wards, q.year === 'all' ? null : q.year, sat.sarYears()).image;
  if (q.layer === 'forest') return (q.mode === 'loss' ? sat.forestLossVis(ee, wards) : sat.forestCoverVis(ee, wards)).image;
  return sat.newDevVis(ee, wards, q.from);
}

async function mapTemplate(q, ee, wards) {
  const key = mapKey(q);
  const hit = maps.get(key);
  if (hit && Date.now() - hit.at < MAP_TTL_MS) return hit.url;
  const url = await sat.mapUrl(ee, buildVis(ee, wards, q));
  maps.set(key, { url, at: Date.now() });
  return url;
}

function dropMap(q) {
  maps.delete(mapKey(q));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function render(q, name, ensure) {
  const ctx = await ensure();
  const ee = ctx.ee;
  const wards = ctx.wardVectorParsed;
  let refreshed = false;
  for (let attempt = 0; attempt < GEE_TRIES; attempt++) {
    const templateUrl = await mapTemplate(q, ee, wards);
    const tileUrl = fillTemplate(templateUrl, q.z, q.x, q.y);
    let res;
    try {
      res = await axios.get(tileUrl, {
        responseType: 'arraybuffer',
        timeout: GEE_TIMEOUT_MS,
        validateStatus: () => true
      });
    } catch (err) {
      if (attempt < GEE_TRIES - 1) {
        await sleep(400 * 2 ** attempt);
        continue;
      }
      return { status: 502, message: 'Ô vệ tinh chưa tải được' };
    }
    const body = Buffer.from(res.data || []);
    const kind = classifyGee(res.status, body, res.headers && res.headers['content-type']);
    if (kind === 'ok') {
      if (q.durable && name) {
        try { await gcsWrite.putObject(name, body, 'image/png'); } catch (err) {
          console.warn('Không ghi được ô vệ tinh lên bucket:', name, err.message);
        }
      }
      return { status: 200, body, headers: pngHeaders(q.durable, 'gee') };
    }
    if (kind === 'expired' && !refreshed) {
      dropMap(q);
      refreshed = true;
      continue;
    }
    if ((kind === 'retry' || kind === 'expired') && attempt < GEE_TRIES - 1) {
      await sleep(400 * 2 ** attempt);
      continue;
    }
    break;
  }
  return { status: 502, message: 'Ô vệ tinh chưa tải được' };
}

async function loadTile(q, ensure) {
  const name = objectName(q);
  if (q.durable && name) {
    const hit = await readPublic(name);
    if (hit) return { status: 200, body: hit, headers: pngHeaders(true, 'hit') };
  }
  return render(q, name, ensure);
}

async function serve(query, ensure, now = new Date()) {
  const q = parseQuery(query, now);
  if (!q || q.meta) return { status: 400, message: 'Ô vệ tinh không hợp lệ' };
  const key = `${mapKey(q)}|${q.z}/${q.x}/${q.y}`;
  let job = flights.get(key);
  if (!job) {
    job = loadTile(q, ensure).finally(() => flights.delete(key));
    flights.set(key, job);
  }
  return job;
}

module.exports = {
  LAYERS, parseQuery, objectName, template, meta, classifyGee, pngHeaders, serve, fillTemplate, durable, seriesId
};
