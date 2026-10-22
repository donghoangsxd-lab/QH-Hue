#!/usr/bin/env python3
# Hành lang sông: gộp mảnh cùng tên qua ranh đồ án, rồi chỉ giữ sông rộng hơn 100 m.
# Bề rộng = 2×diện tích/chu vi của phần đã gộp, không đo từng lô. Bỏ hồ ao đầm và mặt biển.
# Nhà trong hành lang nhưng bị đường trục chính hoặc đường có tên chắn phía bờ thì không tính.
# Rừng phòng hộ / đặc dụng giữ nguyên bảng forest_hit.
# Chạy: python3 scripts/rebuild-river-corridor.py

import json
import math
import os
import time
import unicodedata
import urllib.request

import duckdb

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.environ.get('GBA_TMP', '/tmp/gba')
DB_PATH = os.path.join(TMP, 'screen.duck')
LOTS = os.path.join(TMP, 'lots-use.geojson')
OUT_PATH = os.path.join(ROOT, 'public', 'data', 'gba', 'bank-forest.json')
LINE_PATH = os.path.join(ROOT, 'public', 'data', 'gba', 'river-corridor.json')
ROADS_BASE = 'https://storage.googleapis.com/hue-infra-data-us/roads/v2/'
ROAD_DIR = os.path.join(TMP, 'roads')
WIDTH_MIN = 100.0
COMPACT_MAX = 0.25
# Đường lệch khỏi hướng bờ quá 35° thì coi là đường cắt ngang, không phải đường ven sông.
PARALLEL = math.sin(math.radians(35))


def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)


def fold(value):
    text = unicodedata.normalize('NFD', str(value or '').lower())
    text = ''.join(ch for ch in text if unicodedata.category(ch) != 'Mn').replace('đ', 'd')
    for ch in ',_-()/→.':
        text = text.replace(ch, ' ')
    return f' {" ".join(text.split())} '


def name_kind(layer, name):
    bag = fold(f'{layer} {name}')
    if ' bien ' in bag or ' cang ' in bag:
        return 'sea'
    pond = any(tok in bag for tok in (' ho ', ' ao ', ' dam '))
    river = any(tok in bag for tok in (' song ', ' suoi ', ' kenh ', ' rach ', ' songsuoi ', ' ss '))
    generic = ' mat nuoc ' in bag or ' matnuoc ' in bag or ' nuoc mat ' in bag
    if pond and not river:
        return 'pond'
    if river:
        return 'river'
    if generic:
        return 'generic'
    return 'other'


def slug(name):
    text = unicodedata.normalize('NFD', str(name or ''))
    text = ''.join(ch for ch in text if unicodedata.category(ch) != 'Mn').replace('đ', 'd').replace('Đ', 'D')
    out = []
    prev = False
    for ch in text.lower():
        ok = ('a' <= ch <= 'z') or ('0' <= ch <= '9')
        if ok:
            out.append(ch)
            prev = False
        elif not prev:
            out.append('-')
            prev = True
    return ''.join(out).strip('-')[:60]


def fetch_json(name):
    os.makedirs(ROAD_DIR, exist_ok=True)
    path = os.path.join(ROAD_DIR, f'{name}.json')
    if not os.path.exists(path) or os.path.getsize(path) < 20:
        url = f'{ROADS_BASE}{name}.json'
        log(f'tải {name}')
        urllib.request.urlretrieve(url, path)
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def unit(dx, dy):
    n = math.hypot(dx, dy)
    if n < 1e-6:
        return None
    return (dx / n, dy / n)


def round_coords(obj):
    if isinstance(obj, list):
        if obj and isinstance(obj[0], (int, float)) and not isinstance(obj[0], bool):
            return [round(float(obj[0]), 5), round(float(obj[1]), 5)]
        return [round_coords(item) for item in obj]
    return obj


def write_lines(con):
    # Viền ngoài của đệm 50 m, cùng hình với vùng gắn cờ. DuckDB ghi EPSG:4326 theo trục vĩ độ–kinh độ.
    geo = con.execute("""
        SELECT ST_AsGeoJSON(
            ST_FlipCoordinates(
                ST_Transform(
                    ST_SetCRS(ST_Simplify(ST_LineMerge(ST_Union_Agg(ST_Boundary(ST_Buffer(g, 50)))), 4), 'EPSG:32648'),
                    'EPSG:4326'
                )
            )
        )
        FROM river_keep
    """).fetchone()[0]
    geom = json.loads(geo)
    geom['coordinates'] = round_coords(geom.get('coordinates'))
    payload = {
        'type': 'FeatureCollection',
        'features': [{
            'type': 'Feature',
            'properties': {'name': 'Hành lang 50 m'},
            'geometry': geom
        }]
    }
    with open(LINE_PATH, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(',', ':'))
    log(f'nét hành lang {os.path.getsize(LINE_PATH) / 1e3:.0f} KB')


def parallel(road, shore, building):
    # road: list of (x, y) in metres. shore/building: (x, y)
    sx, sy = shore
    bx, by = building
    normal = unit(bx - sx, by - sy)
    if not normal:
        return False
    best = None
    best_d = 1e18
    for i in range(len(road) - 1):
        ax, ay = road[i]
        cx, cy = road[i + 1]
        mx, my = (ax + cx) / 2, (ay + cy) / 2
        d = (mx - sx) ** 2 + (my - sy) ** 2
        if d < best_d:
            best_d = d
            best = unit(cx - ax, cy - ay)
    if not best:
        return False
    cos = abs(best[0] * normal[0] + best[1] * normal[1])
    return cos < PARALLEL


def main():
    con = duckdb.connect(DB_PATH)
    con.execute('LOAD spatial')
    con.execute("SET memory_limit='6GB'")
    con.execute('SET threads=4')
    rows = con.execute(f"""
        SELECT s.id, coalesce(l.layer, ''), coalesce(l.name, '')
        FROM water_src s
        JOIN st_read('{LOTS}') l ON l.OGC_FID = s.id
    """).fetchall()
    river_ids = []
    generic_ids = []
    for fid, layer, name in rows:
        kind = name_kind(layer, name)
        if kind == 'river':
            river_ids.append(int(fid))
        elif kind == 'generic':
            generic_ids.append(int(fid))
    log(f'{len(river_ids)} mảnh tên sông / {len(rows)} mặt nước, {len(generic_ids)} mặt nước chung')
    con.execute('DROP TABLE IF EXISTS named')
    con.execute('CREATE TABLE named (id BIGINT)')
    con.executemany('INSERT INTO named VALUES (?)', [(i,) for i in river_ids])
    if generic_ids:
        con.execute('CREATE TEMP TABLE generic (id BIGINT)')
        con.executemany('INSERT INTO generic VALUES (?)', [(i,) for i in generic_ids])
        con.execute("""
            INSERT INTO named
            SELECT g.id FROM generic g
            JOIN water_src gs ON gs.id = g.id
            WHERE EXISTS (
                SELECT 1 FROM named n
                JOIN water_src ns ON ns.id = n.id
                WHERE ST_DWithin(gs.g, ns.g, 15)
            )
        """)
    named_n = con.execute('SELECT count(*) FROM named').fetchone()[0]
    log(f'{named_n} mảnh sau khi gắn mặt nước sát sông')
    log('gộp qua ranh đồ án, rồi đo bề rộng')
    con.execute('DROP TABLE IF EXISTS river_keep')
    con.execute(f"""
        CREATE TABLE river_keep AS
        SELECT row_number() OVER () AS id, g FROM (
            SELECT item.geom AS g
            FROM (
                SELECT unnest(ST_Dump(ST_MakeValid(ST_Buffer(ST_Union_Agg(ST_Buffer(w.g, 8)), -8)))) AS item
                FROM water_src w
                JOIN named n ON n.id = w.id
                WHERE ST_IsValid(w.g)
            )
            WHERE item.geom IS NOT NULL AND NOT ST_IsEmpty(item.geom)
              AND ST_GeometryType(item.geom) IN ('POLYGON', 'MULTIPOLYGON')
        ) s
        WHERE ST_Perimeter(g) > 0
          AND 2 * ST_Area(g) / ST_Perimeter(g) > {WIDTH_MIN}
          AND 4 * pi() * ST_Area(g) / power(ST_Perimeter(g), 2) < {COMPACT_MAX}
    """)
    kept_n = con.execute('SELECT count(*) FROM river_keep').fetchone()[0]
    log(f'{kept_n} sông rộng hơn {WIDTH_MIN:.0f} m sau khi gộp')
    if kept_n < 5:
        raise SystemExit('quá ít sông — dừng')
    con.execute('DROP TABLE IF EXISTS river')
    con.execute('CREATE TABLE river AS SELECT id FROM river_keep')
    log('đệm 50 m ngoài bờ sông')
    con.execute('DROP TABLE IF EXISTS corridor')
    con.execute("""
        CREATE TABLE corridor AS
        SELECT w.id, ST_MakeValid(ST_Difference(ST_Buffer(w.g, 50), w.g)) AS g
        FROM river_keep w
        WHERE ST_IsValid(w.g)
    """)
    con.execute("DELETE FROM corridor WHERE g IS NULL OR ST_IsEmpty(g) OR NOT ST_IsValid(g)")
    km2 = con.execute('SELECT coalesce(sum(ST_Area(g)), 0) / 1e6 FROM corridor').fetchone()[0]
    log(f'hành lang {km2:.2f} km²')
    write_lines(con)

    con.execute('DROP TABLE IF EXISTS corr')
    con.execute('CREATE TABLE corr (id BIGINT, area DOUBLE, flag INTEGER)')
    spans = con.execute('SELECT (id // 80000) * 80000 AS lo FROM bldg_m GROUP BY 1 ORDER BY 1').fetchall()
    for (start,) in spans:
        end = int(start) + 80000
        log(f'giao hành lang id {int(start)}…{end - 1}')
        con.execute(f"""
            INSERT INTO corr
            SELECT b.id,
                   least(any_value(b.area_m2), sum(ST_Area(ST_Intersection(b.g, z.g)))) AS area,
                   1
            FROM bldg_m b
            JOIN corridor z ON ST_Intersects(b.g, z.g)
            WHERE b.id >= {int(start)} AND b.id < {end}
            GROUP BY b.id
        """)
    raw_n = con.execute('SELECT count(*) FROM corr').fetchone()[0]
    log(f'{raw_n} công trình chạm hành lang, trước khi loại đường ven sông')

    log('tải đường trục chính và đường có tên')
    index = fetch_json('index')
    ways = []
    seen = set()
    for name, meta in (index.get('wards') or {}).items():
        for part in range(int(meta.get('parts') or 0)):
            pack = fetch_json(f'net_{slug(name)}_{part}')
            for way in pack.get('ways') or []:
                if len(way) < 4:
                    continue
                wid, bridge, _nodes, flat = way[0], way[1], way[2], way[3]
                group = way[4] if len(way) > 4 else 0
                if bridge or group not in (1, 2) or wid in seen or not isinstance(flat, list) or len(flat) < 4:
                    continue
                seen.add(wid)
                pts = [(flat[i + 1], flat[i]) for i in range(0, len(flat) - 1, 2)]
                if len(pts) >= 2:
                    ways.append(pts)
    log(f'{len(ways)} tuyến đường (không tính cầu, kiệt)')
    con.execute('DROP TABLE IF EXISTS road_w')
    con.execute('CREATE TABLE road_w (id INTEGER, wkt VARCHAR)')
    con.executemany(
        'INSERT INTO road_w VALUES (?, ?)',
        [(i, 'LINESTRING(' + ', '.join(f'{x} {y}' for x, y in pts) + ')') for i, pts in enumerate(ways)]
    )
    con.execute("""
        CREATE OR REPLACE TABLE road_m AS
        SELECT id, ST_Transform(ST_SetCRS(ST_GeomFromText(wkt), 'OGC:CRS84'), 'EPSG:32648') AS g
        FROM road_w
        WHERE wkt IS NOT NULL AND ST_IsValid(ST_GeomFromText(wkt))
    """)
    con.execute('DROP TABLE road_w')
    box = con.execute('SELECT min(ST_X(ST_StartPoint(g))), min(ST_Y(ST_StartPoint(g))), count(*) FROM road_m').fetchone()
    log(f'đường mét {box[2]} tuyến, gốc khoảng {box[0]:.0f}, {box[1]:.0f}')

    log('đoạn từ tâm nhà tới bờ')
    con.execute('DROP TABLE IF EXISTS seg')
    con.execute("""
        CREATE TABLE seg AS
        SELECT id, seg, shore, pt FROM (
            SELECT c.id,
                   ST_MakeLine(ST_Centroid(b.g), ST_ClosestPoint(w.g, ST_Centroid(b.g))) AS seg,
                   ST_ClosestPoint(w.g, ST_Centroid(b.g)) AS shore,
                   ST_Centroid(b.g) AS pt,
                   row_number() OVER (PARTITION BY c.id ORDER BY ST_Distance(ST_Centroid(b.g), w.g)) AS rn
            FROM corr c
            JOIN bldg_m b ON b.id = c.id
            JOIN river_keep w ON ST_DWithin(ST_Centroid(b.g), w.g, 70)
        ) WHERE rn = 1
    """)
    hits = con.execute("""
        SELECT s.id, ST_X(s.shore), ST_Y(s.shore), ST_X(s.pt), ST_Y(s.pt), r.id
        FROM seg s
        JOIN road_m r ON ST_Intersects(s.seg, r.g)
    """).fetchall()
    log(f'{len(hits)} cặp nhà–đường cắt đoạn ra bờ')
    road_pts = {}
    if hits:
        need = sorted({int(h[5]) for h in hits})
        for rid, geom in con.execute(
            'SELECT id, ST_AsText(g) FROM road_m WHERE id IN (SELECT UNNEST(?))', [need]
        ).fetchall():
            body = geom[geom.find('(') + 1:geom.rfind(')')]
            road_pts[int(rid)] = [tuple(float(v) for v in pair.split()) for pair in body.split(',') if pair.strip()]
    exempt = set()
    for bid, sx, sy, bx, by, rid in hits:
        if parallel(road_pts.get(int(rid)) or [], (sx, sy), (bx, by)):
            exempt.add(int(bid))
    log(f'loại {len(exempt)} nhà có đường ven sông chắn phía bờ')
    if exempt:
        con.execute('CREATE TEMP TABLE exempt (id BIGINT)')
        con.executemany('INSERT INTO exempt VALUES (?)', [(i,) for i in exempt])
        con.execute('DELETE FROM corr WHERE id IN (SELECT id FROM exempt)')
    kept = con.execute('SELECT count(*) FROM corr').fetchone()[0]
    log(f'còn {kept} nhà trong hành lang')

    # Ghép lại JSON: rừng lấy từ forest_hit, hành lang từ corr mới.
    log('ghép tệp')
    con.execute('DROP TABLE IF EXISTS hit')
    con.execute("""
        CREATE TABLE hit AS
        SELECT a.id, a.lng, a.lat, a.ward,
               coalesce(c.area, 0) AS ac,
               CASE WHEN f.flag IS NULL THEN 0 ELSE f.flag END AS fflag,
               coalesce(f.area, 0) AS af
        FROM bldg_attr a
        LEFT JOIN corr c ON c.id = a.id
        LEFT JOIN forest_hit f ON f.id = a.id
        WHERE c.id IS NOT NULL OR f.id IS NOT NULL
    """)
    out_rows = con.execute("""
        SELECT h.lng, h.lat, h.ac, least(a.area_m2, h.af) AS af, h.fflag, h.ward
        FROM hit h JOIN bldg_attr a ON a.id = h.id
    """).fetchall()
    wards = {}
    pts = []
    corridor_n = forest_n = both_n = 0
    for lng, lat, ac, af, fflag, ward in out_rows:
        reason = (1 if ac > 0.5 else 0) | (int(fflag or 0) if af > 0.5 else 0)
        if reason == 0:
            continue
        name = ward or 'Chưa rõ phường, xã'
        slot = wards.setdefault(name, [0, 0, 0])
        in_c = bool(reason & 1)
        in_f = bool(reason & 6)
        if in_c and in_f:
            both_n += 1
            slot[2] += 1
            slot[0] += 1
            slot[1] += 1
        elif in_c:
            corridor_n += 1
            slot[0] += 1
        elif in_f:
            forest_n += 1
            slot[1] += 1
        pts.append((name, lng, lat, ac if in_c else 0, af if in_f else 0, reason))
    names = sorted(wards)
    index_of = {name: i for i, name in enumerate(names)}
    packed = [[
        round(lng, 6), round(lat, 6), int(round(ac)), int(round(af)), reason, index_of[name]
    ] for name, lng, lat, ac, af, reason in pts]
    ranked = sorted(names, key=lambda name: -(wards[name][0] + wards[name][1]))
    n_bldg = con.execute('SELECT count(*) FROM bldg_attr').fetchone()[0]
    n_forest = con.execute('SELECT count(*) FROM forest_src').fetchone()[0]
    payload = {
        'v': 3,
        'buildings': int(n_bldg),
        'waterPolygons': int(kept_n),
        'forestPolygons': int(n_forest),
        'totals': {
            'corridor': corridor_n + both_n,
            'forest': forest_n + both_n,
            'both': both_n,
            'flagged': corridor_n + forest_n + both_n,
            'exemptRoad': len(exempt)
        },
        'note': (
            f'Hành lang 50 m chỉ đệm ra ngoài bờ sông rộng hơn {WIDTH_MIN:.0f} m. '
            'Mảnh sông được gộp qua ranh đồ án trước khi đo '
            '(bề rộng = 2 × diện tích / chu vi của phần đã gộp, hình kéo dài). '
            'Không gồm hồ, ao, đầm, mặt biển và kênh nhỏ hơn 100 m. '
            'Nhà bị đường trục chính hoặc đường có tên (không phải cầu, không phải kiệt) chắn giữa nhà và bờ, chạy dọc bờ, không tính vào hành lang. '
            'Rừng chỉ gồm ô quy hoạch có cụm phòng hộ hoặc đặc dụng, hoặc mã RPH / RDD. '
            'Không gồm rừng sản xuất và không khớp tên chỗ như Phong Hòa.'
        ),
        'wards': [{
            'name': name,
            'corridor': wards[name][0],
            'forest': wards[name][1],
            'both': wards[name][2]
        } for name in names],
        'wardRank': ranked,
        'pts': packed
    }
    with open(OUT_PATH, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(',', ':'))
    log(
        f"hành lang {payload['totals']['corridor']}, rừng {payload['totals']['forest']}, "
        f"cả hai {both_n}, loại đường {len(exempt)}, tệp {os.path.getsize(OUT_PATH) / 1e6:.1f} MB, "
        f"hành lang {km2:.2f} km²"
    )
    con.close()


if __name__ == '__main__':
    main()
