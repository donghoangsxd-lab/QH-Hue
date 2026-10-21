#!/usr/bin/env python3
# Tính sẵn hai lớp sàng lọc từ dấu chân Global Building Atlas (cùng bộ đã cắt ranh phường trong build-gba.py)
# và ô đất quy hoạch (lots-use: tên loại đất).
# public/data/gba/bank-forest.json — công trình giao hành lang 50 m ngoài bờ mặt nước quy hoạch,
# hoặc nằm trên đất rừng phòng hộ / rừng đặc dụng (đúng từ hoặc mã RPH, RDD). Không đệm từ tim tuyến OSM.
# Không ghi bldg-h.bin. Chiều cao mét đã có ở bldg-hf.bin.
# Chạy: python3 scripts/build-gba-screen.py
# Cần duckdb spatial, parquet /tmp/gba/e105_n20_e110_n15.parquet, lots-use.geojson, wards.geojson.
# Ứng dụng đọc file tĩnh khi bật lớp, không có nút nạp lại.

import json
import os
import time
import unicodedata
from collections import Counter

import duckdb

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.environ.get('GBA_TMP', '/tmp/gba')
PARQUET = os.environ.get('GBA_PARQUET', os.path.join(TMP, 'e105_n20_e110_n15.parquet'))
WARDS = os.environ.get('GBA_WARDS', os.path.join(TMP, 'wards.geojson'))
LOTS = os.environ.get('GBA_LOTS_USE', os.path.join(TMP, 'lots-use.geojson'))
OUT_DIR = os.path.join(ROOT, 'public', 'data', 'gba')
OUT_PATH = os.path.join(OUT_DIR, 'bank-forest.json')
DB_PATH = os.path.join(TMP, 'screen.duck')
BBOX = (107.0, 16.0, 108.2, 16.8)
M_PER_DEG = 111320.0


def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)


def fold(value):
    text = unicodedata.normalize('NFD', value or '')
    text = ''.join(ch for ch in text if unicodedata.category(ch) != 'Mn')
    return text.lower().replace('đ', 'd')


def destination(raw):
    for sep in ('→', '->'):
        if sep in (raw or ''):
            return fold(raw.split(sep, 1)[1])
    return None


def is_water(layer, name):
    raw = f'{layer or ""} {name or ""}'
    text = fold(raw)
    dest = destination(raw)
    if dest is not None:
        water_dest = any(token in dest for token in (
            ' mat nuoc', 'mat nuoc', 'song', 'suoi', 'kenh', 'rach', 'nuoc', 'songsuoi', 'matnuoc'
        )) or any(f' {code} ' in f' {dest} ' or dest.strip() == code or dest.strip().startswith(code + ' ')
                  for code in ('ss', 'ho', 'mnb', 'son', 'mnc', 'smn'))
        if not water_dest:
            return False
    blocked = ('cay xanh', 'quang truong', 'giao thong', 'nha o', 'nhom nha', 'san xuat', 'cong nghiep', 'lam nghiep', 'rung ')
    if any(word in text for word in blocked) and 'mat nuoc' not in text and 'songsuoi' not in text and 'song suoi' not in text and 'song, suoi' not in text and 'kenh' not in text:
        return False
    if any(word in text for word in ('cay xanh', 'quang truong', 'giao thong', 'nha o', 'nhom nha')):
        return False
    keys = (
        'mat nuoc', 'matnuoc', 'song suoi', 'songsuoi', 'song ngoi', 'song, suoi',
        'kenh rach', 'kenh, rach', 'kenh muong', 'ho ao', 'ho, ao', 'ao ho', 'ao, ho',
        'song ngoi', 'thuy loi'
    )
    if any(key in text for key in keys):
        return True
    padded = f' {text} '
    for token in (' ss ', ' mnb ', ' son ', ' mnc ', ' smn '):
        if token in padded:
            return True
    for token in (' song ', ' suoi ', ' kenh ', ' rach ', ' ho ', ' ao ', ' dam '):
        if token in padded.replace(',', ' ').replace('_', ' ').replace('-', ' '):
            return True
    return False


def words_of(value):
    text = fold(value or '')
    for ch in (',', '_', '-', '/', '→', '.', '(', ')'):
        text = text.replace(ch, ' ')
    return [part for part in text.split() if part]


def forest_kinds(layer, name):
    # Khớp cả cụm từ, không khớp chuỗi con: "Phong Hòa" không phải "phòng hộ".
    words = words_of(f'{layer or ""} {name or ""}')
    bag = f' {" ".join(words)} '
    rph = ' rph ' in bag or ' phong ho ' in bag
    rdd = ' rdd ' in bag or ' dac dung ' in bag
    sx = ' rsx ' in bag or ' san xuat ' in bag
    if ' lam nghiep ' in bag and not rph and not rdd:
        return []
    if sx and not rph and not rdd:
        return []
    out = []
    if rph:
        out.append('rph')
    if rdd:
        out.append('rdd')
    return out


def self_check():
    assert is_water('Đất mặt nước', '')
    assert is_water('Đất sông, suối, kênh, rạch', '')
    assert is_water('Sông, suối, kênh, rạch', '')
    assert is_water('Đất hồ, ao, đầm', '')
    assert is_water('Mặt nước', '')
    assert is_water('Nước mặt → SS', '')
    assert is_water('HG - H Mat nuoc', '')
    assert is_water('HT_DAT_KHAC_Songsuoi', '')
    assert not is_water('Đất giao thông', '')
    assert not is_water('Đất cây xanh cảnh quan ven sông → CV', '')
    assert not is_water('QH-QHCT Quảng trường ven sông phố cổ Bao Vinh', '')
    assert not is_water('Rừng sản xuất', '')
    assert not is_water('Đất nhóm nhà ở', '')
    assert not is_water('Đất trung tâm thể dục thể thao → VH', '')
    assert forest_kinds('Rừng phòng hộ', '') == ['rph']
    assert forest_kinds('Đất rừng đặc dụng', '') == ['rdd']
    assert forest_kinds('HG - Đất rừng → RDD', '') == ['rdd']
    assert forest_kinds('Rừng sản xuất', '') == []
    assert forest_kinds('Đất rừng sản xuất', '') == []
    assert forest_kinds('Đất lâm nghiệp', '') == []
    assert forest_kinds('Phường Phong Hòa', '') == []
    assert forest_kinds('Đất tín ngưỡng', 'Phong Hòa') == []
    assert forest_kinds('Đất sản xuất nông nghiệp', '') == []
    assert forest_kinds('C-RPH', '') == ['rph']
    assert forest_kinds('T-RDD', '') == ['rdd']
    assert forest_kinds('Đất rừng phòng hộ', 'khu Phong Hòa') == ['rph']


def area_sql(geom):
    return (
        f'ST_Area({geom}) * {M_PER_DEG} * ({M_PER_DEG} * cos(radians(ST_Y(ST_Centroid({geom})))))'
    )


def table_exists(con, name):
    row = con.execute(
        "SELECT count(*) FROM duckdb_tables() WHERE table_name = ?",
        [name]
    ).fetchone()
    return bool(row and row[0])


def connect():
    os.makedirs(TMP, exist_ok=True)
    os.makedirs(os.path.join(TMP, 'duck'), exist_ok=True)
    con = duckdb.connect(DB_PATH)
    con.execute('LOAD spatial')
    con.execute("SET preserve_insertion_order=false")
    con.execute('SET threads=4')
    con.execute("SET memory_limit='4GB'")
    con.execute(f"SET temp_directory='{TMP}/duck'")
    return con


def build_buildings(con):
    if table_exists(con, 'bldg_attr') and table_exists(con, 'bldg_m'):
        n = con.execute('SELECT count(*) FROM bldg_attr').fetchone()[0]
        log(f'dùng bảng công trình đã có: {n}')
        return n
    if not os.path.exists(PARQUET):
        raise SystemExit(f'Thiếu parquet {PARQUET}')
    if not os.path.exists(WARDS):
        raise SystemExit(f'Thiếu ranh phường {WARDS}')
    for name in ('boxed', 'cand', 'kept', 'bldg', 'bldg_attr', 'bldg_m'):
        con.execute(f'DROP TABLE IF EXISTS {name}')
    log('đọc ranh phường')
    con.execute(f"""
        CREATE TABLE wards AS
        SELECT tenXa AS name, ST_MakeValid(geom) AS geom
        FROM ST_Read('{WARDS}')
        WHERE tenXa IS NOT NULL AND tenXa <> ''
    """)
    minx, miny, maxx, maxy = BBOX
    log('lọc khung và chiều cao')
    con.execute(f"""
        CREATE TABLE boxed AS
        SELECT height, var, ST_ReducePrecision(geometry, 1e-6) AS geometry
        FROM read_parquet('{PARQUET}')
        WHERE height IS NOT NULL AND height > 0 AND height <> -999
          AND bbox.xmax > {minx} AND bbox.xmin < {maxx}
          AND bbox.ymax > {miny} AND bbox.ymin < {maxy}
    """)
    var_cut = con.execute('SELECT quantile_cont(var, 0.995) FROM boxed').fetchone()[0]
    log(f'ngưỡng var phân vị 99.5 = {var_cut:.3f}')
    con.execute(f"""
        CREATE TABLE cand AS
        SELECT row_number() OVER () AS id, height,
               {area_sql("ST_SetCRS(geometry, 'EPSG:4326')")} AS area_m2,
               ST_Centroid(ST_SetCRS(geometry, 'EPSG:4326')) AS pt,
               ST_SetCRS(geometry, 'EPSG:4326') AS geometry
        FROM boxed
        WHERE var IS NULL OR var <= {float(var_cut)}
    """)
    con.execute('DROP TABLE boxed')
    log('cắt theo ranh (tâm công trình)')
    con.execute("""
        CREATE TABLE kept AS
        SELECT c.id, c.height, c.area_m2, c.pt, c.geometry, w.name AS ward
        FROM cand c
        JOIN wards w ON ST_Intersects(w.geom, c.pt)
    """)
    con.execute("""
        CREATE TABLE bldg AS
        SELECT * EXCLUDE (rn) FROM (
            SELECT *, row_number() OVER (PARTITION BY id ORDER BY ward) AS rn FROM kept
        ) WHERE rn = 1
    """)
    con.execute('DROP TABLE kept')
    con.execute('DROP TABLE cand')
    n = con.execute('SELECT count(*) FROM bldg').fetchone()[0]
    log(f'{n} công trình trong ranh')
    if n < 1000:
        raise SystemExit('Quá ít công trình sau khi cắt — dừng')
    log('đổi sang mét (EPSG:32648, trục kinh/vĩ)')
    probe = con.execute("""
        SELECT ST_X(ST_Transform(ST_SetCRS(ST_Point(107.6, 16.46), 'OGC:CRS84'), 'EPSG:32648'))
    """).fetchone()[0]
    if not probe or probe < 100000 or probe > 1000000:
        raise SystemExit(f'Phép chiếu mét không hợp lệ: {probe}')
    con.execute("""
        CREATE TABLE bldg_attr AS
        SELECT id, height, area_m2, ST_X(pt) AS lng, ST_Y(pt) AS lat, ward FROM bldg
    """)
    con.execute("""
        CREATE TABLE bldg_m AS
        SELECT id, area_m2,
               ST_MakeValid(ST_Transform(ST_SetCRS(geometry, 'OGC:CRS84'), 'EPSG:32648')) AS g
        FROM bldg
    """)
    con.execute("DELETE FROM bldg_m WHERE g IS NULL OR NOT ST_IsValid(g) OR ST_IsEmpty(g)")
    con.execute('DROP TABLE bldg')
    return n


def write_heights(con):
    log('bỏ qua bldg-h.bin — chiều cao mét dùng bldg-hf.bin')


def append_overrides(con):
    path = os.path.join(OUT_DIR, 'bldg-overrides.geojson')
    con.execute('DELETE FROM bldg_attr WHERE id >= 900000000')
    con.execute('DELETE FROM bldg_m WHERE id >= 900000000')
    if not os.path.exists(path):
        log('không có bảng override')
        return 0
    fc = json.load(open(path, encoding='utf-8'))
    rows = []
    next_id = 900000000
    for feat in fc.get('features') or []:
        props = feat.get('properties') or {}
        if not props.get('draw') or not feat.get('geometry'):
            continue
        geom = feat['geometry']
        parts = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
        if geom['type'] not in ('Polygon', 'MultiPolygon'):
            continue
        for rings in parts:
            rows.append((next_id, json.dumps({'type': 'Polygon', 'coordinates': rings})))
            next_id += 1
    if not rows:
        return 0
    con.execute('CREATE TEMP TABLE ov_raw (id BIGINT, geojson VARCHAR)')
    con.executemany('INSERT INTO ov_raw VALUES (?, ?)', rows)
    con.execute("""
        CREATE TEMP TABLE ov_m AS
        SELECT id,
               ST_MakeValid(ST_Transform(ST_SetCRS(ST_GeomFromGeoJSON(geojson), 'OGC:CRS84'), 'EPSG:32648')) AS g
        FROM ov_raw
    """)
    con.execute("DELETE FROM ov_m WHERE g IS NULL OR NOT ST_IsValid(g) OR ST_IsEmpty(g) OR ST_Area(g) < 80")
    con.execute("""
        INSERT INTO bldg_m
        SELECT id, ST_Area(g) AS area_m2, g FROM ov_m
    """)
    con.execute("""
        INSERT INTO bldg_attr
        SELECT m.id, 0 AS height, m.area_m2,
               ST_X(ST_Transform(ST_SetCRS(ST_Centroid(m.g), 'EPSG:32648'), 'OGC:CRS84')) AS lng,
               ST_Y(ST_Transform(ST_SetCRS(ST_Centroid(m.g), 'EPSG:32648'), 'OGC:CRS84')) AS lat,
               coalesce((
                 SELECT w.name FROM wards w
                 WHERE ST_Intersects(
                   w.geom,
                   ST_Transform(ST_SetCRS(ST_Centroid(m.g), 'EPSG:32648'), 'OGC:CRS84')
                 )
                 LIMIT 1
               ), '') AS ward
        FROM bldg_m m
        WHERE m.id >= 900000000
    """)
    n = con.execute('SELECT count(*) FROM bldg_attr WHERE id >= 900000000').fetchone()[0]
    log(f'thêm {n} mảnh tháp từ bảng override')
    return int(n)


def classify_lots(con):
    if not os.path.exists(LOTS):
        raise SystemExit(f'Thiếu ô đất quy hoạch {LOTS}')
    log('phân loại ô mặt nước và rừng')
    rows = con.execute(f"""
        SELECT OGC_FID, layer, name
        FROM ST_Read('{LOTS}')
    """).fetchall()
    water_layers = Counter()
    forest_layers = Counter()
    water_ids = []
    forest_rows = []
    for fid, layer, name in rows:
        if is_water(layer, name):
            water_ids.append(fid)
            water_layers[layer or ''] += 1
        kinds = forest_kinds(layer, name)
        if kinds:
            forest_rows.append((fid, 'rph' in kinds, 'rdd' in kinds))
            forest_layers[layer or ''] += 1
    log(f'{len(water_ids)} ô mặt nước, {len(forest_rows)} ô rừng phòng hộ / đặc dụng')
    for label, counter in (('mặt nước', water_layers), ('rừng', forest_layers)):
        for name, count in counter.most_common(12):
            log(f'  {label} {count:5d}  {name}')
    water_csv = os.path.join(TMP, 'screen-water.csv')
    forest_csv = os.path.join(TMP, 'screen-forest.csv')
    with open(water_csv, 'w', encoding='utf-8') as handle:
        handle.write('id\n')
        for fid in water_ids:
            handle.write(f'{fid}\n')
    with open(forest_csv, 'w', encoding='utf-8') as handle:
        handle.write('id,rph,rdd\n')
        for fid, rph, rdd in forest_rows:
            handle.write(f'{fid},{1 if rph else 0},{1 if rdd else 0}\n')
    return water_csv, forest_csv, len(water_ids), len(forest_rows), water_layers


def metric_lots(con, csv_path, name, extra_cols=''):
    con.execute(f'DROP TABLE IF EXISTS {name}')
    select_extra = f', {extra_cols}' if extra_cols else ''
    con.execute(f"""
        CREATE TABLE {name} AS
        SELECT t.id{select_extra},
               ST_MakeValid(ST_Transform(ST_SetCRS(l.geom, 'OGC:CRS84'), 'EPSG:32648')) AS g
        FROM read_csv('{csv_path}', header=true) t
        JOIN (SELECT OGC_FID AS id, geom FROM ST_Read('{LOTS}')) l ON l.id = t.id
    """)
    before = con.execute(f'SELECT count(*) FROM {name}').fetchone()[0]
    con.execute(f"""
        DELETE FROM {name}
        WHERE g IS NULL OR NOT ST_IsValid(g) OR ST_IsEmpty(g) OR ST_Area(g) < 10
    """)
    after = con.execute(f'SELECT count(*) FROM {name}').fetchone()[0]
    log(f'{name}: {after} đa giác hợp lệ (bỏ {before - after})')
    return after


def build_zones(con, water_csv, forest_csv):
    for name in ('water_src', 'corridor', 'forest_src', 'forest_m'):
        con.execute(f'DROP TABLE IF EXISTS {name}')
    n_water = metric_lots(con, water_csv, 'water_src')
    if n_water:
        log('đệm 50 m ra ngoài bờ')
        con.execute("""
            CREATE TABLE corridor AS
            SELECT id,
                   ST_MakeValid(ST_Difference(ST_Buffer(g, 50), g)) AS g
            FROM water_src
            WHERE ST_IsValid(g)
        """)
        con.execute("DELETE FROM corridor WHERE g IS NULL OR ST_IsEmpty(g) OR NOT ST_IsValid(g)")
        km2 = con.execute('SELECT coalesce(sum(ST_Area(g)), 0) / 1e6 FROM corridor').fetchone()[0]
        log(f'hành lang {km2:.2f} km²')
    else:
        con.execute("CREATE TABLE corridor (id BIGINT, g GEOMETRY)")
        log('không có đa giác mặt nước — không tạo hành lang')
    n_forest = metric_lots(con, forest_csv, 'forest_src', 't.rph, t.rdd')
    con.execute("""
        CREATE TABLE forest_m AS
        SELECT id, rph, rdd, g FROM forest_src WHERE ST_IsValid(g)
    """)
    return n_water, n_forest


def intersect_kind(con, table, zone, flag):
    con.execute(f'DROP TABLE IF EXISTS {table}')
    con.execute(f'CREATE TABLE {table} (id BIGINT, area DOUBLE, flag INTEGER)')
    empty = con.execute(f'SELECT count(*) FROM {zone}').fetchone()[0] == 0
    if empty:
        return 0
    # Id tháp override nằm ở 900000000. Không quét khoảng trống giữa hai nhóm.
    spans = con.execute('SELECT (id // 80000) * 80000 AS lo FROM bldg_m GROUP BY 1 ORDER BY 1').fetchall()
    for (start,) in spans:
        end = int(start) + 80000
        log(f'giao {zone} id {int(start)}…{end - 1}')
        con.execute(f"""
            INSERT INTO {table}
            SELECT b.id,
                   least(any_value(b.area_m2), sum(ST_Area(ST_Intersection(b.g, z.g)))) AS area,
                   any_value({int(flag)}) AS flag
            FROM bldg_m b
            JOIN {zone} z ON ST_Intersects(b.g, z.g)
            WHERE b.id >= {start} AND b.id < {end}
            GROUP BY b.id
        """)
    return con.execute(f'SELECT count(*) FROM {table}').fetchone()[0]


def write_json(con, n_buildings, n_water, n_forest, water_layers):
    log('ghép kết quả')
    con.execute('DROP TABLE IF EXISTS hit')
    con.execute("""
        CREATE TABLE hit AS
        SELECT a.id, a.lng, a.lat, a.ward,
               coalesce(c.area, 0) AS ac,
               CASE
                 WHEN f.flag IS NULL THEN 0
                 ELSE f.flag
               END AS fflag,
               coalesce(f.area, 0) AS af
        FROM bldg_attr a
        LEFT JOIN corr c ON c.id = a.id
        LEFT JOIN forest_hit f ON f.id = a.id
        WHERE c.id IS NOT NULL OR f.id IS NOT NULL
    """)
    rows = con.execute("""
        SELECT h.lng, h.lat, h.ac, least(a.area_m2, h.af) AS af, h.fflag, h.ward
        FROM hit h
        JOIN bldg_attr a ON a.id = h.id
    """).fetchall()
    # Cờ rừng: 2 = phòng hộ, 4 = đặc dụng, 6 = cả hai. Diện tích rừng là phần cắt, không vượt dấu chân.
    wards = {}
    pts = []
    corridor_n = forest_n = both_n = 0
    for lng, lat, ac, af, fflag, ward in rows:
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
    index = {name: i for i, name in enumerate(names)}
    packed = [[
        round(lng, 6), round(lat, 6),
        int(round(ac)), int(round(af)),
        reason, index[name]
    ] for name, lng, lat, ac, af, reason in pts]
    ranked = sorted(names, key=lambda name: -(wards[name][0] + wards[name][1]))
    payload = {
        'v': 1,
        'buildings': int(n_buildings),
        'waterPolygons': int(n_water),
        'forestPolygons': int(n_forest),
        'totals': {
            'corridor': corridor_n + both_n,
            'forest': forest_n + both_n,
            'both': both_n,
            'flagged': corridor_n + forest_n + both_n
        },
        'waterLayers': [{'name': name, 'n': count} for name, count in water_layers.most_common(15)],
        'note': (
            'Hành lang 50 m đệm ra ngoài bờ các ô đất quy hoạch loại sông, suối, kênh, rạch, hồ, ao, đầm và mặt nước. '
            'Không đệm từ tim tuyến. Lớp đường thủy OSM chỉ là LineString tim sông, kênh nên không dùng. '
            'Rừng chỉ gồm ô quy hoạch có cụm "phòng hộ" hoặc "đặc dụng", hoặc mã RPH / RDD (kể cả C- và T-). '
            'Không gồm rừng sản xuất, đất lâm nghiệp chung, và không khớp tên chỗ như Phong Hòa. '
            'Diện tích là phần dấu chân cắt trong vùng. Dấu chân Global Building Atlas, cộng các tháp vẽ thêm từ bảng override.'
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
        f"cả hai {payload['totals']['both']}, tệp {os.path.getsize(OUT_PATH) / 1e6:.1f} MB"
    )
    return payload['totals']


def main():
    self_check()
    os.makedirs(OUT_DIR, exist_ok=True)
    con = connect()
    build_buildings(con)
    append_overrides(con)
    n_buildings = con.execute('SELECT count(*) FROM bldg_attr').fetchone()[0]
    write_heights(con)
    water_csv, forest_csv, n_water_ids, n_forest_ids, water_layers = classify_lots(con)
    n_water, n_forest = build_zones(con, water_csv, forest_csv)
    log('giao dấu chân với hành lang')
    # Diện tích rừng tách phòng hộ / đặc dụng bằng hai lượt để cờ không bị gộp nhầm khi một công trình gặp cả hai.
    n_corr = intersect_kind(con, 'corr', 'corridor', '1')
    log(f'công trình chạm hành lang (trước lọc diện tích) {n_corr}')
    con.execute('DROP TABLE IF EXISTS forest_rph')
    con.execute("CREATE TABLE forest_rph AS SELECT id, g FROM forest_m WHERE rph = 1")
    con.execute('DROP TABLE IF EXISTS forest_rdd')
    con.execute("CREATE TABLE forest_rdd AS SELECT id, g FROM forest_m WHERE rdd = 1")
    intersect_kind(con, 'hit_rph', 'forest_rph', '2')
    intersect_kind(con, 'hit_rdd', 'forest_rdd', '4')
    con.execute('DROP TABLE IF EXISTS forest_hit')
    con.execute("""
        CREATE TABLE forest_hit AS
        SELECT h.id,
               least(any_value(a.area_m2), sum(h.area)) AS area,
               bit_or(h.flag) AS flag
        FROM (
            SELECT id, area, flag FROM hit_rph
            UNION ALL
            SELECT id, area, flag FROM hit_rdd
        ) h
        JOIN bldg_attr a ON a.id = h.id
        GROUP BY h.id
    """)
    totals = write_json(con, n_buildings, n_water, n_forest, water_layers)
    con.close()
    print(json.dumps({'buildings': n_buildings, 'waterIds': n_water_ids, 'forestIds': n_forest_ids, **totals}, ensure_ascii=False))


if __name__ == '__main__':
    main()
