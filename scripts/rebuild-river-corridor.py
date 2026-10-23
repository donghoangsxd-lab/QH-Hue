#!/usr/bin/env python3
# Hành lang sông: 50 m ngoài mép nước thật, chỉ trên đoạn rộng hơn 100 m tại chỗ.
# Mép nước chỉ lấy sông/kênh OpenStreetMap trong ranh phường. Lô quy hoạch tên sông
# không dùng làm bờ: nhiều lô trùm ruộng hoặc vẽ kênh rộng hơn nước nhìn thấy.
# Bề rộng đo bằng mở hình thái: ăn mòn 50 m rồi đắp lại — đoạn hẹp hơn 100 m biến mất.
# Nhà bị đường trục chính hoặc đường có tên chắn phía bờ thì không tính.
# Rừng phòng hộ / đặc dụng giữ từ tệp bank-forest đã có.
# Chạy: python3 scripts/rebuild-river-corridor.py
# Cần duckdb spatial, /tmp/gba/water-lots.geojson, ô OSM osm-cell-*.json, buildings.pmtiles.

import glob
import gzip
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
WATER_GEO = os.path.join(TMP, 'water-lots.geojson')
PMTILES = os.path.join(TMP, 'buildings.pmtiles')
WARDS_PATH = os.path.join(ROOT, 'public', 'data', 'ward-boundary.json')
OUT_PATH = os.path.join(ROOT, 'public', 'data', 'gba', 'bank-forest.json')
LINE_PATH = os.path.join(ROOT, 'public', 'data', 'gba', 'river-corridor.json')
ROADS_BASE = 'https://storage.googleapis.com/hue-infra-data-us/roads/v2/'
ROAD_DIR = os.path.join(TMP, 'roads')
WIDTH_MIN = 100.0
HALF = WIDTH_MIN / 2.0
PARALLEL = math.sin(math.radians(35))
Z = 16
EXTENT = 4096

USE_XY = True
FLIP = False


def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)


def T(geom, src, dst):
    if USE_XY:
        return f"ST_Transform({geom}, '{src}', '{dst}', true)"
    return f"ST_Transform(ST_SetCRS({geom}, '{src}'), '{dst}')"


def lonlat(geom):
    expr = T(geom, 'EPSG:32648', 'EPSG:4326')
    if FLIP:
        return f'ST_FlipCoordinates({expr})'
    return expr


def fold(value):
    text = unicodedata.normalize('NFD', str(value or '').lower())
    text = ''.join(ch for ch in text if unicodedata.category(ch) != 'Mn').replace('đ', 'd')
    for ch in ',_-()/→.':
        text = text.replace(ch, ' ')
    return f' {" ".join(text.split())} '


def name_kind(layer, name):
    # Tên lô là hồ / ao / đầm thì không phải sông, dù layer gộp chữ sông.
    name_bag = fold(name)
    name_pond = any(tok in name_bag for tok in (' ho ', ' ao ', ' dam '))
    name_river = any(tok in name_bag for tok in (' song ', ' suoi ', ' kenh ', ' rach '))
    if name_pond and not name_river:
        return 'pond'
    # Nhãn gộp «hồ ao, sông suối» không phải một con sông. Nước thật lấy từ OSM.
    if name_pond and name_river:
        return 'generic'
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


def land_label(layer, name):
    bag = fold(f'{layer} {name}')
    return any(tok in bag for tok in (
        ' bai boi ', ' bai cat ', ' thuy san ', ' dat o ', ' nong nghiep ', ' cay xanh '
    ))


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


def connect():
    os.makedirs(TMP, exist_ok=True)
    con = duckdb.connect(DB_PATH)
    con.execute('LOAD spatial')
    con.execute("SET memory_limit='6GB'")
    con.execute('SET threads=4')
    global USE_XY, FLIP
    n = con.execute("SELECT count(*) FROM duckdb_functions() WHERE function_name = 'ST_SetCRS'").fetchone()[0]
    USE_XY = n == 0
    probe = con.execute(f"SELECT ST_AsText({T('ST_Point(777613.0, 1821604.0)', 'EPSG:32648', 'EPSG:4326')})").fetchone()[0]
    first = float(probe.split('(')[1].split()[0])
    FLIP = first < 90
    log(f'phép chiếu {"xy" if USE_XY else "setcrs"}, đảo trục {FLIP}')
    return con


def self_check():
    # Sông 140 m và nhánh 138 m giữ. Kênh 50 m và lô quy hoạch (ruộng, kênh vẽ rộng) bỏ.
    con = duckdb.connect()
    con.execute('LOAD spatial')
    con.execute("""
        CREATE TABLE osm_in AS
        SELECT ST_GeomFromText('POLYGON((0 0, 800 0, 800 140, 0 140, 0 0))') g
        UNION ALL SELECT ST_GeomFromText('POLYGON((0 300, 500 300, 500 350, 0 350, 0 300))')
        UNION ALL SELECT ST_GeomFromText('POLYGON((1000 0, 1300 0, 1300 138, 1000 138, 1000 0))')
        UNION ALL SELECT ST_GeomFromText('POLYGON((3000 0, 3600 0, 3600 160, 3000 160, 3000 0))')
    """)
    assemble_wide(con)
    def inside(x, y):
        return con.execute(
            'SELECT count(*) FROM river_keep WHERE ST_Covers(g, ST_Point(?, ?))', [x, y]
        ).fetchone()[0] > 0
    assert inside(400, 70), 'sông 140 m phải còn'
    assert inside(1150, 70), 'nhánh 138 m phải còn'
    assert inside(3300, 80), 'sông 160 m phải còn'
    assert not inside(200, 325), 'kênh 50 m phải mất'
    assert not inside(400, 200), 'phần ngoài mép nước không được nhận hành lang'
    con.close()
    log('tự kiểm tra bề rộng: đạt')


def ring_of(geom):
    if not geom or len(geom) < 4:
        return None
    ring = [(p['lon'], p['lat']) for p in geom]
    if abs(ring[0][0] - ring[-1][0]) > 1e-7 or abs(ring[0][1] - ring[-1][1]) > 1e-7:
        return None
    ring[-1] = ring[0]
    return ring


def osm_skip(tags):
    bag = fold(f"{tags.get('name', '')} {tags.get('water', '')} {tags.get('natural', '')}")
    return any(tok in bag for tok in (
        ' bien ', ' pha ', ' lagoon ', ' wastewater ', ' pond ', ' reservoir ', ' basin ', ' lake ', ' dam pha '
    ))


def load_osm(con):
    paths = sorted(glob.glob(os.path.join(TMP, 'osm-cell-*.json')))
    extra = os.path.join(TMP, 'osm-river.json')
    if os.path.exists(extra):
        paths.append(extra)
    if not paths:
        raise SystemExit(f'Thiếu OSM trong {TMP}')
    seen = set()
    ways = []
    rel_lines = []
    for path in paths:
        if os.path.getsize(path) < 30:
            continue
        data = json.load(open(path, encoding='utf-8'))
        for el in data.get('elements') or []:
            key = (el.get('type'), el.get('id'))
            if key in seen:
                continue
            seen.add(key)
            tags = el.get('tags') or {}
            if osm_skip(tags):
                continue
            kind = tags.get('water') or tags.get('waterway') or ''
            if el.get('type') == 'way':
                ring = ring_of(el.get('geometry'))
                if ring:
                    ways.append((kind, ring))
                continue
            lines = []
            for mem in el.get('members') or []:
                ring = ring_of(mem.get('geometry'))
                if ring:
                    lines.append(ring)
            if lines:
                rel_lines.append((kind, lines))
    con.execute('CREATE OR REPLACE TABLE osm_way (kind VARCHAR, wkt VARCHAR)')
    con.executemany(
        'INSERT INTO osm_way VALUES (?, ?)',
        [(kind, 'POLYGON((' + ', '.join(f'{x} {y}' for x, y in ring) + '))') for kind, ring in ways]
    )
    con.execute(f"""
        CREATE OR REPLACE TABLE osm_m AS
        SELECT kind, ST_MakeValid({T('ST_GeomFromText(wkt)', 'EPSG:4326', 'EPSG:32648')}) g
        FROM osm_way
        WHERE wkt IS NOT NULL
    """)
    if rel_lines:
        rows = []
        for i, (kind, lines) in enumerate(rel_lines):
            for ring in lines:
                rows.append((i, kind, 'LINESTRING(' + ', '.join(f'{x} {y}' for x, y in ring) + ')'))
        con.execute('CREATE OR REPLACE TABLE rel_line (rid INTEGER, kind VARCHAR, wkt VARCHAR)')
        con.executemany('INSERT INTO rel_line VALUES (?, ?, ?)', rows)
        con.execute(f"""
            INSERT INTO osm_m
            SELECT any_value(kind), ST_MakeValid({T('ST_BuildArea(ST_Collect(list(ST_GeomFromText(wkt))))', 'EPSG:4326', 'EPSG:32648')})
            FROM rel_line GROUP BY rid
        """)
    con.execute("DELETE FROM osm_m WHERE g IS NULL OR ST_IsEmpty(g) OR NOT ST_IsValid(g) OR ST_Area(g) < 200")
    # Phá, mặt nước rất rộng: không phải sông nội đô.
    dropped = con.execute("""
        SELECT count(*) FROM osm_m
        WHERE ST_Area(g) > 8000000 AND 2 * ST_Area(g) / ST_Perimeter(g) > 350
    """).fetchone()[0]
    con.execute("""
        DELETE FROM osm_m
        WHERE ST_Area(g) > 8000000 AND 2 * ST_Area(g) / ST_Perimeter(g) > 350
    """)
    con.execute(f"""
        CREATE OR REPLACE TABLE wards AS
        SELECT tenXa AS name, ST_MakeValid({T('geom', 'EPSG:4326', 'EPSG:32648')}) g
        FROM ST_Read('{WARDS_PATH}')
        WHERE tenXa IS NOT NULL AND tenXa <> ''
    """)
    con.execute('CREATE OR REPLACE TABLE ward_u AS SELECT ST_Union_Agg(g) g FROM wards')
    con.execute("""
        CREATE OR REPLACE TABLE osm_in AS
        SELECT ST_MakeValid(ST_Intersection(o.g, ST_Buffer(w.g, 80))) g
        FROM osm_m o, ward_u w
        WHERE ST_Intersects(o.g, w.g)
    """)
    con.execute("DELETE FROM osm_in WHERE g IS NULL OR ST_IsEmpty(g) OR NOT ST_IsValid(g) OR ST_Area(g) < 200")
    n, km2 = con.execute('SELECT count(*), coalesce(sum(ST_Area(g)), 0) / 1e6 FROM osm_in').fetchone()
    log(f'OSM trong ranh: {n} mảnh, {km2:.2f} km², bỏ {dropped} mặt nước quá rộng')


def load_plan(con):
    if os.path.exists(WATER_GEO):
        con.execute(f"""
            CREATE OR REPLACE TABLE plan_raw AS
            SELECT row_number() OVER () AS rn, layer, name, geom
            FROM ST_Read('{WATER_GEO}')
        """)
        rows = con.execute("SELECT rn, coalesce(layer, ''), coalesce(name, '') FROM plan_raw").fetchall()
        kept = [(rn, name_kind(layer, name)) for rn, layer, name in rows
                if name_kind(layer, name) == 'river' and not land_label(layer, name)]
        log(f'{len(kept)} lô tên sông / {len(rows)} mặt nước quy hoạch')
        con.execute('CREATE OR REPLACE TABLE plan_id (rn BIGINT)')
        con.executemany('INSERT INTO plan_id VALUES (?)', [(rn,) for rn, _k in kept])
        con.execute(f"""
            CREATE OR REPLACE TABLE plan AS
            SELECT 'river' AS kind,
                   ST_MakeValid({T('r.geom', 'EPSG:4326', 'EPSG:32648')}) g
            FROM plan_raw r
            JOIN plan_id i ON i.rn = r.rn
        """)
    elif table_ok(con, 'water_src') and os.path.exists(LOTS):
        rows = con.execute(f"""
            SELECT s.id, coalesce(l.layer, ''), coalesce(l.name, '')
            FROM water_src s
            JOIN st_read('{LOTS}') l ON l.OGC_FID = s.id
        """).fetchall()
        ids = [int(fid) for fid, layer, name in rows if name_kind(layer, name) == 'river' and not land_label(layer, name)]
        log(f'{len(ids)} lô tên sông từ screen.duck')
        con.execute('CREATE OR REPLACE TABLE plan_id (id BIGINT)')
        con.executemany('INSERT INTO plan_id VALUES (?)', [(i,) for i in ids])
        con.execute("""
            CREATE OR REPLACE TABLE plan AS
            SELECT 'river' AS kind, w.g
            FROM water_src w JOIN plan_id i ON i.id = w.id
            WHERE ST_IsValid(w.g)
        """)
    else:
        raise SystemExit(f'Thiếu {WATER_GEO}')
    con.execute("DELETE FROM plan WHERE g IS NULL OR ST_IsEmpty(g) OR NOT ST_IsValid(g) OR ST_Area(g) < 20")


def table_ok(con, name):
    row = con.execute('SELECT count(*) FROM duckdb_tables() WHERE table_name = ?', [name]).fetchone()
    return bool(row and row[0])


def assemble_wide(con):
    # Đóng khe số hóa < 16 m giữa các mảnh OSM. Bước này không đổi bề rộng sông.
    con.execute("""
        CREATE OR REPLACE TABLE healed AS
        SELECT item.geom AS g FROM (
            SELECT unnest(ST_Dump(ST_MakeValid(ST_Buffer(ST_Union_Agg(ST_Buffer(g, 8)), -8)))) AS item
            FROM osm_in
            WHERE g IS NOT NULL AND NOT ST_IsEmpty(g) AND ST_IsValid(g)
        )
        WHERE item.geom IS NOT NULL AND NOT ST_IsEmpty(item.geom)
          AND ST_GeometryType(item.geom) IN ('POLYGON', 'MULTIPOLYGON')
          AND ST_Area(item.geom) > 400
    """)
    # Ăn mòn nửa bề rộng tối thiểu rồi đắp lại: đoạn hẹp hơn 100 m không còn lõi.
    con.execute(f"""
        CREATE OR REPLACE TABLE river_keep AS
        SELECT row_number() OVER () AS id, g FROM (
            SELECT item.geom AS g FROM (
                SELECT unnest(ST_Dump(ST_MakeValid(ST_Intersection(
                    h.g, ST_Buffer(ST_Buffer(h.g, -{HALF}), {HALF})
                )))) AS item
                FROM healed h
                WHERE ST_Area(ST_Buffer(h.g, -{HALF})) > 1
            )
            WHERE item.geom IS NOT NULL AND NOT ST_IsEmpty(item.geom)
              AND ST_GeometryType(item.geom) IN ('POLYGON', 'MULTIPOLYGON')
              AND ST_Area(item.geom) > 2500
        )
    """)
    kept, km2 = con.execute('SELECT count(*), coalesce(sum(ST_Area(g)),0)/1e6 FROM river_keep').fetchone()
    log(f'{kept} đoạn rộng hơn {WIDTH_MIN:.0f} m, {km2:.2f} km² mặt nước')
    if kept < 3:
        raise SystemExit('quá ít sông — dừng')
    con.execute('CREATE OR REPLACE TABLE corridor AS SELECT id, ST_MakeValid(ST_Difference(ST_Buffer(g, 50), g)) g FROM river_keep')
    con.execute("DELETE FROM corridor WHERE g IS NULL OR ST_IsEmpty(g) OR NOT ST_IsValid(g)")
    ckm = con.execute('SELECT coalesce(sum(ST_Area(g)),0)/1e6 FROM corridor').fetchone()[0]
    log(f'hành lang {ckm:.2f} km²')
    return ckm


def write_lines(con):
    geo = con.execute(f"""
        SELECT ST_AsGeoJSON({lonlat('ST_Simplify(ST_LineMerge(ST_Union_Agg(ST_Boundary(ST_Buffer(g, 50)))), 4)')})
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


def dist_to_keep(con, lon, lat):
    return con.execute(f"""
        SELECT ST_Distance(
            {T(f'ST_Point({lon}, {lat})', 'EPSG:4326', 'EPSG:32648')},
            (SELECT ST_Union_Agg(g) FROM river_keep)
        )
    """).fetchone()[0]


def audit(con):
    # Nhánh ~138 m phía đông ngã ba (OSM 217518615) và lõi Sông Hương phải nằm trong mặt nước đã giữ.
    probes = (
        ('nhánh 138 m', 107.6247, 16.5340, 40, True),
        ('lõi sông rộng', 107.576586, 16.514702, 40, True),
        ('ruộng xa bờ', 107.60797, 16.56992, 400, False),
        ('kênh OSM ~48 m', 107.59579, 16.50859, 80, False),
        ('kênh OSM ~56 m', 107.59795, 16.54857, 80, False),
    )
    for label, lon, lat, limit, want_near in probes:
        dist = dist_to_keep(con, lon, lat)
        log(f'{label} cách mặt nước đã giữ {dist:.0f} m')
        if want_near and dist > limit:
            raise SystemExit(f'{label} chưa được tính')
        if not want_near and dist < limit:
            raise SystemExit(f'{label} vẫn nằm trong hành lang')
    # Phần lô quy hoạch cách mép OSM hơn 120 m là ruộng bị gộp nhầm.
    if table_ok(con, 'plan'):
        row = con.execute(f"""
            WITH skirt AS (
                SELECT ST_Difference(p.g, ST_Buffer((SELECT ST_Union_Agg(g) FROM osm_in), 120)) g
                FROM plan p WHERE p.kind = 'river'
            ),
            part AS (
                SELECT item.geom g FROM (
                    SELECT unnest(ST_Dump(ST_MakeValid(g))) item FROM skirt
                    WHERE g IS NOT NULL AND NOT ST_IsEmpty(g)
                )
                WHERE item.geom IS NOT NULL AND ST_Area(item.geom) > 8000
            )
            SELECT count(*),
                   coalesce(min(ST_Distance(ST_Centroid(g), (SELECT ST_Union_Agg(g) FROM river_keep))), 9999)
            FROM part
        """).fetchone()
        log(f'vạt đất cách nước > 120 m: {row[0]} mảnh, gần hành lang nhất {row[1]:.0f} m')
        if row[0] and row[1] < 70:
            raise SystemExit('hành lang vẫn phủ ruộng xa bờ')
    narrow = con.execute(f"""
        SELECT count(*),
               coalesce(sum(ST_Area(ST_Intersection(o.g, ST_Buffer(k.g, 55)))), 0),
               coalesce(sum(ST_Area(o.g)), 0)
        FROM osm_in o, (SELECT ST_Union_Agg(g) g FROM river_keep) k
        WHERE ST_Area(o.g) > 8000 AND ST_Area(ST_Buffer(o.g, -{HALF})) <= 1
          AND ST_Intersects(o.g, ST_Buffer(k.g, 55))
    """).fetchone()
    share = (100.0 * narrow[1] / narrow[2]) if narrow[2] else 0
    log(f'kênh hẹp chạm vành 55 m: {narrow[0]} mảnh, {share:.0f}% diện tích kênh đó')


def tile_xy(lon, lat):
    n = 2 ** Z
    x = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(max(-85.0, min(85.0, lat)))
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return x, y


def walk_tiles(con):
    geo = con.execute(f"""
        SELECT ST_AsGeoJSON({lonlat('ST_Simplify(ST_Boundary(g), 25)')})
        FROM river_keep
    """).fetchall()
    tiles = set()

    def add(lon, lat):
        x, y = tile_xy(lon, lat)
        tiles.add((x, y))
        n = float(2 ** Z)
        fx = (lon + 180.0) / 360.0 * n - x
        lat_rad = math.radians(max(-85.0, min(85.0, lat)))
        fy = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n - y
        if fx < 0.18:
            tiles.add((x - 1, y))
        if fx > 0.82:
            tiles.add((x + 1, y))
        if fy < 0.18:
            tiles.add((x, y - 1))
        if fy > 0.82:
            tiles.add((x, y + 1))

    def walk(obj):
        if isinstance(obj, list):
            if obj and isinstance(obj[0], (int, float)) and not isinstance(obj[0], bool):
                return
            if obj and isinstance(obj[0], list) and obj[0] and isinstance(obj[0][0], (int, float)):
                pts = obj
                for i in range(len(pts) - 1):
                    x0, y0 = pts[i][0], pts[i][1]
                    x1, y1 = pts[i + 1][0], pts[i + 1][1]
                    dist = math.hypot((x1 - x0) * 111320 * math.cos(math.radians(y0)), (y1 - y0) * 111320)
                    steps = max(1, int(dist / 40))
                    for s in range(steps + 1):
                        t = s / steps
                        add(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
            else:
                for item in obj:
                    walk(item)

    for (text,) in geo:
        if text:
            walk(json.loads(text).get('coordinates'))
    log(f'{len(tiles)} ô dấu chân quanh sông')
    return tiles


def pix_ll(tx, ty, px, py):
    n = float(2 ** Z)
    lon = (tx + px / EXTENT) / n * 360.0 - 180.0
    merc = (ty + py / EXTENT) / n
    lat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * merc))))
    return lon, lat


def ring_centroid(ring):
    if not ring:
        return None
    sx = sy = 0.0
    for x, y in ring:
        sx += x
        sy += y
    return sx / len(ring), sy / len(ring)


def load_footprints(con):
    if table_ok(con, 'bldg_m') and table_ok(con, 'bldg_attr'):
        n = con.execute('SELECT count(*) FROM bldg_m').fetchone()[0]
        if n > 100000:
            log(f'dùng {n} dấu chân đã có')
            return
    if not os.path.exists(PMTILES):
        raise SystemExit(f'Thiếu {PMTILES}')
    from pmtiles.reader import MmapSource, Reader
    import mapbox_vector_tile
    tiles = walk_tiles(con)
    handle = open(PMTILES, 'rb')
    reader = Reader(MmapSource(handle))
    wkts = []
    for tx, ty in tiles:
        raw = reader.get(Z, tx, ty)
        if not raw:
            continue
        if raw[:2] == b'\x1f\x8b':
            raw = gzip.decompress(raw)
        layer = mapbox_vector_tile.decode(raw).get('gba') or {}
        for feat in layer.get('features') or []:
            geom = feat.get('geometry') or {}
            polys = []
            if geom.get('type') == 'Polygon':
                polys = [geom.get('coordinates') or []]
            elif geom.get('type') == 'MultiPolygon':
                polys = geom.get('coordinates') or []
            for poly in polys:
                if not poly or not poly[0] or len(poly[0]) < 4:
                    continue
                outer = [(p[0], p[1]) for p in poly[0]]
                cen = ring_centroid(outer)
                if not cen or not (0 <= cen[0] < EXTENT and 0 <= cen[1] < EXTENT):
                    continue
                rings = []
                for ring in poly:
                    ll = [pix_ll(tx, ty, p[0], p[1]) for p in ring]
                    if len(ll) < 4:
                        continue
                    if ll[0] != ll[-1]:
                        ll.append(ll[0])
                    rings.append('(' + ', '.join(f'{x} {y}' for x, y in ll) + ')')
                if rings:
                    wkts.append('POLYGON(' + ', '.join(rings) + ')')
    handle.close()
    log(f'{len(wkts)} dấu chân (tâm trong ô)')
    con.execute('CREATE OR REPLACE TABLE fp (wkt VARCHAR)')
    con.executemany('INSERT INTO fp VALUES (?)', [(w,) for w in wkts])
    con.execute(f"""
        CREATE OR REPLACE TABLE bldg_m AS
        SELECT row_number() OVER () AS id,
               ST_Area(g) AS area_m2,
               g
        FROM (
            SELECT ST_MakeValid({T('ST_GeomFromText(wkt)', 'EPSG:4326', 'EPSG:32648')}) g
            FROM fp WHERE wkt IS NOT NULL
        )
        WHERE g IS NOT NULL AND ST_IsValid(g) AND NOT ST_IsEmpty(g) AND ST_Area(g) > 8
    """)
    con.execute('DROP TABLE fp')
    before = con.execute('SELECT count(*) FROM bldg_m').fetchone()[0]
    con.execute("""
        DELETE FROM bldg_m
        WHERE NOT EXISTS (
            SELECT 1 FROM river_keep r WHERE ST_DWithin(bldg_m.g, r.g, 80)
        )
    """)
    after = con.execute('SELECT count(*) FROM bldg_m').fetchone()[0]
    log(f'dấu chân gần sông {after} (bỏ {before - after})')
    con.execute(f"""
        CREATE OR REPLACE TABLE bldg_attr AS
        SELECT m.id, m.area_m2,
               ST_X(ST_Centroid({lonlat('m.g')})) AS lng,
               ST_Y(ST_Centroid({lonlat('m.g')})) AS lat,
               coalesce((
                   SELECT w.name FROM wards w
                   WHERE ST_Intersects(w.g, ST_Centroid(m.g))
                   LIMIT 1
               ), '') AS ward
        FROM bldg_m m
    """)
    box = con.execute('SELECT min(lng), max(lng), min(lat), max(lat) FROM bldg_attr').fetchone()
    if not box[0] or box[0] < 106 or box[1] > 109:
        raise SystemExit(f'dấu chân lệch khung {box}')


def parallel(road, shore, building):
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


def flag_buildings(con):
    con.execute('CREATE OR REPLACE TABLE corr (id BIGINT, area DOUBLE, flag INTEGER)')
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
    con.execute('CREATE OR REPLACE TABLE road_w (id INTEGER, wkt VARCHAR)')
    con.executemany(
        'INSERT INTO road_w VALUES (?, ?)',
        [(i, 'LINESTRING(' + ', '.join(f'{x} {y}' for x, y in pts) + ')') for i, pts in enumerate(ways)]
    )
    con.execute(f"""
        CREATE OR REPLACE TABLE road_m AS
        SELECT id, {T("ST_GeomFromText(wkt)", "OGC:CRS84", "EPSG:32648")} g
        FROM road_w
        WHERE wkt IS NOT NULL
    """)
    con.execute('DROP TABLE road_w')
    con.execute("""
        CREATE OR REPLACE TABLE seg AS
        SELECT id, seg, shore, pt FROM (
            SELECT c.id,
                   ST_ShortestLine(ST_Centroid(b.g), w.g) AS seg,
                   ST_EndPoint(ST_ShortestLine(ST_Centroid(b.g), w.g)) AS shore,
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
        con.execute('CREATE OR REPLACE TEMP TABLE exempt (id BIGINT)')
        con.executemany('INSERT INTO exempt VALUES (?)', [(i,) for i in exempt])
        con.execute('DELETE FROM corr WHERE id IN (SELECT id FROM exempt)')
    kept = con.execute('SELECT count(*) FROM corr').fetchone()[0]
    log(f'còn {kept} nhà trong hành lang')
    return len(exempt)


def load_forest():
    if not os.path.exists(OUT_PATH):
        return [], 0, 0
    data = json.load(open(OUT_PATH, encoding='utf-8'))
    wards = [w.get('name') or '' for w in data.get('wards') or []]
    forest = []
    for row in data.get('pts') or []:
        reason = int(row[4]) & 6
        if not reason or row[3] <= 0.5:
            continue
        idx = int(row[5])
        forest.append({
            'lng': row[0], 'lat': row[1], 'af': row[3], 'reason': reason,
            'ward': wards[idx] if 0 <= idx < len(wards) else ''
        })
    log(f'giữ {len(forest)} điểm rừng từ tệp cũ')
    return forest, int(data.get('buildings') or 0), int(data.get('forestPolygons') or 0)


def write_payload(con, forest, exempt_n, buildings, forest_polygons):
    rows = con.execute("""
        SELECT a.lng, a.lat, c.area, a.ward
        FROM corr c JOIN bldg_attr a ON a.id = c.id
        WHERE c.area > 0.5
    """).fetchall()
    # Ghép điểm rừng theo tâm gần nhất. Cờ rừng giữ nguyên.
    used = set()
    corridor_pts = []
    for lng, lat, area, ward in rows:
        best_i = -1
        best_d = 10.0 / 111320.0
        for i, item in enumerate(forest):
            if i in used:
                continue
            d = math.hypot(item['lng'] - lng, (item['lat'] - lat) * 1.0)
            if d < best_d:
                best_d = d
                best_i = i
        if best_i >= 0:
            used.add(best_i)
            item = forest[best_i]
            corridor_pts.append((item['lng'], item['lat'], area, item['af'], 1 | item['reason'], item['ward'] or ward))
        else:
            corridor_pts.append((lng, lat, area, 0, 1, ward or ''))
    for i, item in enumerate(forest):
        if i not in used:
            corridor_pts.append((item['lng'], item['lat'], 0, item['af'], item['reason'], item['ward']))
    wards = {}
    corridor_n = forest_n = both_n = 0
    packed_src = []
    for lng, lat, ac, af, reason, ward in corridor_pts:
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
        packed_src.append((name, lng, lat, ac if in_c else 0, af if in_f else 0, reason))
    names = sorted(wards)
    index_of = {name: i for i, name in enumerate(names)}
    packed = [[
        round(lng, 6), round(lat, 6), int(round(ac)), int(round(af)), reason, index_of[name]
    ] for name, lng, lat, ac, af, reason in packed_src]
    ranked = sorted(names, key=lambda name: -(wards[name][0] + wards[name][1]))
    kept_n = con.execute('SELECT count(*) FROM river_keep').fetchone()[0]
    payload = {
        'v': 4,
        'buildings': int(buildings or 0),
        'waterPolygons': int(kept_n),
        'forestPolygons': int(forest_polygons or 0),
        'totals': {
            'corridor': corridor_n + both_n,
            'forest': forest_n + both_n,
            'both': both_n,
            'flagged': corridor_n + forest_n + both_n,
            'exemptRoad': exempt_n
        },
        'note': (
            f'Hành lang 50 m chỉ đệm ra ngoài mép nước của đoạn sông rộng hơn {WIDTH_MIN:.0f} m. '
            'Bề rộng đo tại chỗ (ăn mòn 50 m rồi đắp lại), không lấy trung bình cả khúc đã gộp. '
            'Mép nước là sông và kênh OpenStreetMap trong ranh phường, xã. '
            'Không lấy lô quy hoạch tên sông, vì lô đó hay trùm ruộng hoặc vẽ kênh rộng hơn nước thật. '
            'Không gồm hồ, ao, đầm, mặt biển, bãi bồi và kênh hẹp hơn 100 m. '
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
        f"cả hai {both_n}, loại đường {exempt_n}, tệp {os.path.getsize(OUT_PATH) / 1e6:.1f} MB"
    )
    return payload['totals']


def main():
    self_check()
    con = connect()
    load_osm(con)
    load_plan(con)
    assemble_wide(con)
    audit(con)
    forest, buildings, forest_polygons = load_forest()
    load_footprints(con)
    exempt_n = flag_buildings(con)
    totals = write_payload(con, forest, exempt_n, buildings, forest_polygons)
    write_lines(con)
    con.close()
    print(json.dumps(totals, ensure_ascii=False))


if __name__ == '__main__':
    main()
