// Truy vấn OpenStreetMap trong vòng tròn (và bán kính tìm 2 km cho điểm dịch vụ).
// Máy chủ gọi Overpass vì một số máy chỉ mở CORS cho origin rỗng hoặc trả bản không có ngày.
const OVERPASS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];
const SEARCH_M = 2000;

function num(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

function box(lat, lng, meters, mLat, mLng) {
  return {
    south: lat - meters / mLat,
    north: lat + meters / mLat,
    west: lng - meters / mLng,
    east: lng + meters / mLng
  };
}

function queryFor(lat, lng, r) {
  const mLat = 110540;
  const mLng = 111320 * Math.cos((lat * Math.PI) / 180);
  const circle = box(lat, lng, r + 40, mLat, mLng);
  const search = box(lat, lng, SEARCH_M, mLat, mLng);
  const c = `${circle.south},${circle.west},${circle.north},${circle.east}`;
  const s = `${search.south},${search.west},${search.north},${search.east}`;
  return `[out:json][timeout:25];(
way["leisure"~"^(park|garden|nature_reserve|pitch)$"](${c});
way["landuse"~"^(grass|meadow|recreation_ground|village_green|forest|orchard|reservoir|basin)$"](${c});
way["natural"~"^(wood|water|wetland|grassland|scrub)$"](${c});
way["place"="square"](${c});
way["highway"="pedestrian"]["area"="yes"](${c});
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|pedestrian|footway|path|cycleway|steps)$"](${c});
way["railway"~"^(rail|light_rail|subway|tram|narrow_gauge)$"](${c});
way["waterway"~"^(river|stream|canal|drain)$"](${c});
node["amenity"~"^(school|kindergarten|college|university|hospital|clinic|doctors|pharmacy|marketplace|supermarket|library|community_centre|theatre|arts_centre|cinema|parking)$"](${s});
way["amenity"~"^(school|kindergarten|college|university|hospital|clinic|doctors|pharmacy|marketplace|supermarket|library|community_centre|theatre|arts_centre|cinema|parking)$"](${s});
node["highway"="bus_stop"](${s});
node["public_transport"~"^(platform|stop_position)$"](${s});
);out geom;`;
}

function dated(data) {
  return data && Array.isArray(data.elements) && /^\d{4}-\d{2}-\d{2}/.test(String((data.osm3s || {}).timestamp_osm_base || ''));
}

async function fetchOsm(lat, lng, r) {
  const body = new URLSearchParams({ data: queryFor(lat, lng, r) });
  let last = 'Không tải được OpenStreetMap';
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'QH-Hue-planning-map/1.0'
        },
        body,
        signal: AbortSignal.timeout(20000)
      });
      if (!res.ok) { last = `OpenStreetMap HTTP ${res.status}`; continue; }
      const data = await res.json();
      if (!dated(data)) { last = 'OpenStreetMap trả dữ liệu không có ngày'; continue; }
      return data;
    } catch (err) {
      last = err.name === 'TimeoutError' ? 'OpenStreetMap quá thời gian' : 'Không kết nối được OpenStreetMap';
    }
  }
  const error = new Error(last);
  error.status = 502;
  throw error;
}

module.exports = async (req, res) => {
  const lat = num(req.query.lat, 15.5, 17.2, null);
  const lng = num(req.query.lng, 106.8, 108.4, null);
  const r = num(req.query.r, 150, 800, null);
  if (lat == null || lng == null || r == null) {
    return res.status(400).json({ error: true, message: 'Tâm hoặc bán kính không hợp lệ' });
  }
  try {
    const data = await fetchOsm(lat, lng, r);
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json(data);
  } catch (err) {
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=60');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=60');
    return res.status(err.status || 502).json({ error: true, message: err.message });
  }
};

module.exports.fetchOsm = fetchOsm;
module.exports.dated = dated;
