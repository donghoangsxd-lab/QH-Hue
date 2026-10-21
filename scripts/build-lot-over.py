#!/usr/bin/env python3
# Đếm lô quy hoạch có mật độ xây dựng hoặc tầng cao thực tế vượt chỉ tiêu.
# Cùng quy tắc popup lô (lotScreen.js): chiếm đất = dấu chân cắt ranh lô;
# tầng cao = làm tròn (mét / 3,3); chưa kết luận tầng nếu còn nhà chưa có chiều cao.
# Gán phường/xã theo tâm lô nằm trong ranh 40 đơn vị sau sáp nhập.
# Chạy: python3 scripts/build-lot-over.py
# Đọc JSON lớp đồ án đã tải ở GBA_LOT_CACHE (mặc định /tmp/tt16-cache) và screen.duck.

import json
import os
import re
import time

import duckdb

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.environ.get('GBA_TMP', '/tmp/gba')
CACHE = os.environ.get('GBA_LOT_CACHE', '/tmp/tt16-cache')
DB_PATH = os.path.join(TMP, 'screen.duck')
LOTS_PATH = os.path.join(TMP, 'plan-lots.geojson')
OUT_PATH = os.path.join(ROOT, 'public', 'data', 'gba', 'lot-over.json')
OV_PATH = os.path.join(ROOT, 'public', 'data', 'gba', 'bldg-overrides.geojson')
EPS_COVER = 0.05
EPS_FLOOR = 0.01

# Mảnh draw:true được gắn id 900000000 theo thứ tự file, bỏ mảnh < 80 m² (id 900000005).
DRAW_HEIGHT = {
    900000000: 160.0,
    900000001: 67.0,
    900000002: 67.0,
    900000003: 67.2,
    900000004: 60.0,
    900000006: 60.0,
    900000007: 60.0,
    900000008: 60.0,
}


def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)


def plan_limit(plan, key):
    if not plan or plan.get(key) in (None, ''):
        return None
    raw = str(plan[key]).strip().replace(',', '.')
    nums = re.findall(r'\d+(?:\.\d+)?', raw)
    if not nums:
        return None
    n = float(nums[-1])
    if key == 'coverage' and n <= 1:
        n *= 100
    return n


def floors_of(meters):
    if not (meters and meters > 0):
        return None
    return max(1, round(meters / 3.3))


def write_lots():
    features = []
    files = 0
    for name in sorted(os.listdir(CACHE)):
        if not name.endswith('__su-dung-dat.json'):
            continue
        files += 1
        with open(os.path.join(CACHE, name), encoding='utf-8') as handle:
            doc = json.load(handle)
        ten = doc.get('tenQH') or ''
        slug = doc.get('slug') or name.split('__')[1]
        for parcel in doc.get('parcels') or []:
            plan = parcel.get('plan') if isinstance(parcel.get('plan'), dict) else None
            cover = plan_limit(plan, 'coverage')
            floors = plan_limit(plan, 'floors')
            geom = parcel.get('geometry')
            if (cover is None and floors is None) or not geom:
                continue
            features.append({
                'type': 'Feature',
                'properties': {
                    'lid': f'{slug}|{parcel.get("id") or ""}',
                    'lot': parcel.get('id') or '',
                    'qh': ten[:80],
                    'ward': parcel.get('ward') or '',
                    'cover': cover,
                    'floors': floors,
                    'area': parcel.get('area'),
                },
                'geometry': geom,
            })
    with open(LOTS_PATH, 'w', encoding='utf-8') as handle:
        json.dump({'type': 'FeatureCollection', 'features': features}, handle, ensure_ascii=False, separators=(',', ':'))
    log(f'{len(features)} lô có chỉ tiêu, từ {files} đồ án, {os.path.getsize(LOTS_PATH) / 1e6:.1f} MB')
    return len(features)


def connect():
    con = duckdb.connect(DB_PATH)
    con.execute('LOAD spatial')
    con.execute('SET threads=4')
    con.execute("SET memory_limit='6GB'")
    con.execute("SET preserve_insertion_order=false")
    con.execute(f"SET temp_directory='{TMP}/duck'")
    return con


def prepare(con):
    con.execute('DROP TABLE IF EXISTS plan_lots')
    con.execute(f"""
        CREATE TABLE plan_lots AS
        SELECT lid, lot, qh, ward AS ward_hint,
               cover::DOUBLE AS cover_lim,
               floors::DOUBLE AS floor_lim,
               TRY_CAST(area AS DOUBLE) AS area_attr,
               ST_MakeValid(ST_Transform(ST_SetCRS(geom, 'OGC:CRS84'), 'EPSG:32648')) AS g
        FROM ST_Read('{LOTS_PATH}')
    """)
    before = con.execute('SELECT count(*) FROM plan_lots').fetchone()[0]
    con.execute("""
        DELETE FROM plan_lots
        WHERE g IS NULL OR NOT ST_IsValid(g) OR ST_IsEmpty(g) OR ST_Area(g) < 1
    """)
    after = con.execute('SELECT count(*) FROM plan_lots').fetchone()[0]
    log(f'lô hợp lệ {after} (bỏ {before - after})')
    con.execute("""
        ALTER TABLE plan_lots ADD COLUMN ward VARCHAR;
        UPDATE plan_lots
        SET ward = (
          SELECT w.name FROM wards w
          WHERE ST_Intersects(
            w.geom,
            ST_Transform(ST_SetCRS(ST_Centroid(plan_lots.g), 'EPSG:32648'), 'OGC:CRS84')
          )
          LIMIT 1
        )
    """)
    missing = con.execute("SELECT count(*) FROM plan_lots WHERE ward IS NULL OR ward = ''").fetchone()[0]
    log(f'lô ngoài ranh 40 phường/xã: {missing}')

    con.execute('DROP TABLE IF EXISTS screen_h')
    con.execute('CREATE TABLE screen_h AS SELECT id, height FROM bldg_attr')
    for bid, height in DRAW_HEIGHT.items():
        con.execute('UPDATE screen_h SET height = ? WHERE id = ?', [height, bid])

    fc = json.load(open(OV_PATH, encoding='utf-8'))
    raise_rows = []
    draw_rows = []
    for feat in fc.get('features') or []:
        props = feat.get('properties') or {}
        geom = feat.get('geometry')
        if not geom:
            continue
        raw = json.dumps(geom, separators=(',', ':'))
        if props.get('draw'):
            draw_rows.append(raw)
        else:
            raise_rows.append((float(props.get('h') or 0), float(props.get('minArea') or 0), raw))
    con.execute('DROP TABLE IF EXISTS ov_raise')
    con.execute('CREATE TABLE ov_raise (h DOUBLE, min_area DOUBLE, g GEOMETRY)')
    for height, min_area, raw in raise_rows:
        con.execute("""
            INSERT INTO ov_raise
            SELECT ?, ?, ST_MakeValid(ST_Transform(ST_SetCRS(ST_GeomFromGeoJSON(?), 'OGC:CRS84'), 'EPSG:32648'))
        """, [height, min_area, raw])
    bumped = con.execute("""
        UPDATE screen_h SET height = greatest(coalesce(screen_h.height, 0), u.h)
        FROM (
          SELECT b.id, max(o.h) AS h
          FROM bldg_m b
          JOIN ov_raise o ON ST_Contains(o.g, ST_Centroid(b.g))
          WHERE b.id < 900000000 AND b.area_m2 >= o.min_area AND o.h > 0
          GROUP BY b.id
        ) u
        WHERE screen_h.id = u.id
    """).fetchone()
    log(f'nâng chiều cao khối có sẵn: {bumped[0] if bumped else 0}')

    con.execute('DROP TABLE IF EXISTS ov_draw')
    con.execute('CREATE TABLE ov_draw (g GEOMETRY)')
    for raw in draw_rows:
        con.execute("""
            INSERT INTO ov_draw
            SELECT ST_MakeValid(ST_Transform(ST_SetCRS(ST_GeomFromGeoJSON(?), 'OGC:CRS84'), 'EPSG:32648'))
        """, [raw])


def intersect(con):
    con.execute('DROP TABLE IF EXISTS lot_hit')
    con.execute('CREATE TABLE lot_hit (lid VARCHAR, foot DOUBLE, height DOUBLE)')
    spans = con.execute('SELECT (id // 80000) * 80000 AS lo FROM bldg_m GROUP BY 1 ORDER BY 1').fetchall()
    for (start,) in spans:
        end = int(start) + 80000
        log(f'giao lô với nhà id {int(start)}…{end - 1}')
        con.execute(f"""
            INSERT INTO lot_hit
            SELECT l.lid,
                   ST_Area(ST_Intersection(l.g, b.g)) AS foot,
                   h.height
            FROM plan_lots l
            JOIN bldg_m b ON ST_Intersects(l.g, b.g)
            JOIN screen_h h ON h.id = b.id
            WHERE b.id >= {int(start)} AND b.id < {end}
              AND ST_Area(ST_Intersection(l.g, b.g)) > 1
              AND NOT (
                b.id < 900000000 AND EXISTS (
                  SELECT 1 FROM ov_draw d WHERE ST_Contains(d.g, ST_Centroid(b.g))
                )
              )
        """)
    n = con.execute('SELECT count(*) FROM lot_hit').fetchone()[0]
    log(f'{n} phần cắt')


def aggregate(con):
    rows = con.execute("""
        SELECT l.lid, l.lot, l.qh, coalesce(l.ward, '') AS ward,
               l.cover_lim, l.floor_lim,
               ST_Area(l.g) AS lot_m2,
               ST_X(ST_Transform(ST_SetCRS(ST_Centroid(l.g), 'EPSG:32648'), 'OGC:CRS84')) AS lng,
               ST_Y(ST_Transform(ST_SetCRS(ST_Centroid(l.g), 'EPSG:32648'), 'OGC:CRS84')) AS lat,
               coalesce(sum(t.foot), 0) AS foot,
               count(t.lid) AS n,
               count(t.lid) FILTER (WHERE t.height IS NULL OR t.height <= 0) AS missing,
               max(t.height) FILTER (WHERE t.height > 0) AS max_h
        FROM plan_lots l
        LEFT JOIN lot_hit t ON t.lid = l.lid
        GROUP BY l.lid, l.lot, l.qh, l.ward, l.cover_lim, l.floor_lim, l.g
    """).fetchall()
    wards = {}
    totals = {'cover': 0, 'floors': 0, 'lots': 0, 'withCover': 0, 'withFloors': 0, 'outside': 0}
    for lid, lot, qh, ward, cover_lim, floor_lim, lot_m2, lng, lat, foot, n, missing, max_h in rows:
        totals['lots'] += 1
        name = ward or 'Ngoài ranh'
        if not ward:
            totals['outside'] += 1
        slot = wards.setdefault(name, {'cover': 0, 'floors': 0, 'withCover': 0, 'withFloors': 0, 'items': []})
        cover = (100.0 * foot / lot_m2) if lot_m2 and lot_m2 > 1 else None
        complete = missing == 0
        max_f = floors_of(max_h) if complete and n else (0 if complete and n == 0 else None)
        over_c = cover is not None and cover_lim is not None and (cover - cover_lim) > EPS_COVER
        over_f = max_f is not None and floor_lim is not None and (max_f - floor_lim) > EPS_FLOOR
        if cover_lim is not None:
            totals['withCover'] += 1
            slot['withCover'] += 1
        if floor_lim is not None:
            totals['withFloors'] += 1
            slot['withFloors'] += 1
        if over_c:
            totals['cover'] += 1
            slot['cover'] += 1
        if over_f:
            totals['floors'] += 1
            slot['floors'] += 1
        if over_c or over_f:
            slot['items'].append({
                'id': lot,
                'qh': qh,
                'lng': round(lng, 6),
                'lat': round(lat, 6),
                'c': round(cover, 1) if cover is not None else None,
                'cl': round(cover_lim, 1) if cover_lim is not None else None,
                'f': max_f,
                'fl': round(floor_lim, 1) if floor_lim is not None else None,
                'oc': bool(over_c),
                'of': bool(over_f),
            })
    for slot in wards.values():
        slot['items'].sort(key=lambda it: (-(it['c'] or 0) if it['oc'] else 0, -(it['f'] or 0)))
    ordered = sorted(wards, key=lambda name: -(wards[name]['cover'] + wards[name]['floors']))
    payload = {
        'v': 1,
        'totals': totals,
        'note': (
            'Số lô có chỉ tiêu mật độ hoặc tầng cao mà phần xây thực tế vượt chỉ tiêu. '
            'Mật độ = diện tích dấu chân công trình cắt trong ranh lô, chia diện tích lô. '
            'Tầng cao = làm tròn chiều cao mét / 3,3; không kết luận nếu còn công trình chưa khớp chiều cao. '
            'Phường, xã theo tâm lô trong ranh 40 đơn vị sau sáp nhập.'
        ),
        'wards': [{
            'name': name,
            'cover': wards[name]['cover'],
            'floors': wards[name]['floors'],
            'withCover': wards[name]['withCover'],
            'withFloors': wards[name]['withFloors'],
            'items': wards[name]['items'],
        } for name in ordered]
    }
    with open(OUT_PATH, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(',', ':'))
    log(
        f"vượt mật độ {totals['cover']}/{totals['withCover']}, "
        f"vượt tầng {totals['floors']}/{totals['withFloors']}, "
        f"tệp {os.path.getsize(OUT_PATH) / 1e6:.2f} MB"
    )
    return totals


def main():
    if not os.path.isdir(CACHE):
        raise SystemExit(f'Thiếu {CACHE}')
    write_lots()
    con = connect()
    prepare(con)
    intersect(con)
    aggregate(con)


if __name__ == '__main__':
    main()
