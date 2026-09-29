// Mạng đường OSM quanh công trình (phục vụ dựng "phạm vi thực tế" ở trình duyệt), lưu chung trên bucket GCS.
// Đọc: file công khai roads/v1/<key>.json. Ghi: Apps Script (máy chủ Vercel không có quyền ghi bucket).
const axios = require('axios');

// Máy chủ Overpass công cộng hay quá tải (504) → gọi lần lượt có giãn cách, lấy kết quả về trước
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const EXCLUDED_HIGHWAYS = 'motorway|motorway_link|construction|proposed|planned|abandoned|disused|razed|raceway|bus_guideway|platform|corridor|elevator|escape|via_ferrata';
const HEDGE_MS = 4000;
const DEADLINE_MS = 40000;        // Vercel maxDuration 60 s: còn chỗ cho đọc bucket + Apps Script lưu
const RADIUS_STEP = 500;          // bán kính tải làm tròn lên bậc 500 m để dùng lại khi đổi bán kính buffer
const RADIUS_MARGIN = 100;        // tải rộng hơn bán kính phục vụ (đường nối ngay ngoài vòng)
// Lớn hơn thì trình duyệt tự tải: Overpass hay quá thời gian, file có thể vượt 4,5 MB/phản hồi của Vercel
const ROADS_MAX_RADIUS = 3500;

const ROADS_PREFIX = 'roads/v1/';
const ROADS_PUBLIC_BASE = `https://storage.googleapis.com/hue-infra-data-us/${ROADS_PREFIX}`;
const ROADS_STALE_MS = 180 * 86400000; // quá 6 tháng thì tải lại (đường mới)

const round4 = (v) => Math.round(v * 1e4) / 1e4;
const round6 = (v) => Math.round(v * 1e6) / 1e6;

/** Bán kính phục vụ (m) → bán kính tải dữ liệu đường (m); so với ROADS_MAX_RADIUS trước khi lưu */
function roadsRadius(radius) {
  return Math.ceil((Number(radius) + RADIUS_MARGIN) / RADIUS_STEP) * RADIUS_STEP;
}

/** Tên file theo tâm làm tròn ~10 m và bán kính tải: "16.4637_107.5905_1000" */
function roadsKey(lat, lng, r) {
  return `${round4(lat).toFixed(4)}_${round4(lng).toFixed(4)}_${r}`;
}

/** File đã lưu trên bucket → { v, saved, lat, lng, r, ways } hoặc null */
async function readCachedRoads(key) {
  try {
    const res = await axios.get(`${ROADS_PUBLIC_BASE}${key}.json`, { timeout: 5000, validateStatus: () => true });
    const d = res.data;
    return res.status === 200 && d && d.v === 1 && Array.isArray(d.ways) ? d : null;
  } catch (e) {
    return null;
  }
}

// Dạng gọn: [cầu ? 1 : 0, [id nút...], [lat, lon, lat, lon, ...]]
function packWays(elements) {
  return (elements || [])
    .filter(w => Array.isArray(w.nodes) && Array.isArray(w.geometry) && w.nodes.length === w.geometry.length && w.nodes.length > 1)
    .map(w => [
      w.tags && w.tags.bridge && w.tags.bridge !== 'no' ? 1 : 0,
      w.nodes,
      w.geometry.flatMap(p => [round6(p.lat), round6(p.lon)])
    ]);
}

async function queryOverpass(url, q, signal) {
  const res = await axios.post(url, 'data=' + encodeURIComponent(q), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'QH-Hue-webapp' },
    timeout: DEADLINE_MS,
    signal,
    validateStatus: () => true
  });
  if (res.status !== 200 || !res.data || typeof res.data !== 'object') throw new Error(`Overpass HTTP ${res.status}`);
  const d = res.data;
  if (d.remark && /error|timed out|out of memory/i.test(d.remark) && !(d.elements || []).length) throw new Error(d.remark);
  return d;
}

/** Tải đường quanh (lat, lng) bán kính r (m) từ Overpass → ways dạng gọn */
async function fetchOverpassWays(lat, lng, r) {
  const q = `[out:json][timeout:35];way["highway"]["highway"!~"^(${EXCLUDED_HIGHWAYS})$"]["access"!~"^(private|no)$"]["foot"!="no"](around:${r},${lat},${lng});out body geom;`;
  const ctrl = new AbortController();
  const deadline = setTimeout(() => ctrl.abort(), DEADLINE_MS);
  try {
    const data = await new Promise((resolve, reject) => {
      let next = 0, failed = 0, done = false, lastErr = null, hedge = null;
      const finish = (fn, v) => { if (done) return; done = true; clearTimeout(hedge); fn(v); };
      const launch = () => {
        clearTimeout(hedge);
        if (done || next >= OVERPASS_URLS.length) return;
        queryOverpass(OVERPASS_URLS[next++], q, ctrl.signal).then(d => finish(resolve, d), err => {
          lastErr = err;
          if (++failed >= OVERPASS_URLS.length || ctrl.signal.aborted) finish(reject, lastErr);
          else launch();
        });
        hedge = setTimeout(launch, HEDGE_MS);
      };
      ctrl.signal.addEventListener('abort', () => finish(reject, lastErr || new Error('Overpass quá thời gian chờ')));
      launch();
    });
    return packWays(data.elements);
  } finally {
    clearTimeout(deadline);
    ctrl.abort();
  }
}

module.exports = { roadsRadius, roadsKey, readCachedRoads, fetchOverpassWays, packWays, round4, ROADS_PREFIX, ROADS_STALE_MS, ROADS_MAX_RADIUS };
