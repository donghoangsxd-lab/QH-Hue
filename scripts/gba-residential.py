#!/usr/bin/env python3
# Lọc nhà ở trên dấu chân GBA để phân bổ dân số (dasymetric).
# Thứ tự: (1) mã thửa địa chính — NTD thắng cả khi điểm cũng chạm ODT/ONT,
# (2) vùng OSM hoặc điểm hạ tầng trong 20 m,
# (3) chức năng lô quy hoạch, (4) diện tích dấu chân > ngưỡng (mặc định 500 m²)
# trừ khi thửa là đất ở (giữ chung cư).
# Lô có tên hoặc layer nghĩa trang / nghĩa địa luôn là không phải nhà ở
# (kể cả layer ghi "Đất ở", như Nghĩa trang Phan Bội Châu), trừ đài tưởng niệm.
# Trọng số = diện tích dấu chân nhà ở × bậc chiều cao tương đối (1–4), không ghi mét.
#   python3 scripts/gba-residential.py
# Ngưỡng: GBA_LARGE_M2 (dấu chân lớn), GBA_SMALL_M2 (nhà kho, bếp, mái — không phải nhà ở dù thửa là đất ở).

import json
import math
import os
import re
import time

import duckdb

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.environ.get('GBA_TMP', '/tmp/gba')
AGG_PATH = os.path.join(ROOT, 'public', 'data', 'gba', 'agg.json')
LARGE_M2 = float(os.environ.get('GBA_LARGE_M2', '500'))
SMALL_M2 = float(os.environ.get('GBA_SMALL_M2', '20'))
M_PER_DEG = 111320.0
NEAR_M = 20.0

# Mã Thông tư 28/2014/TT-BTNMT. NTD (nghĩa trang) thắng khi điểm chạm cả NTD và ODT/ONT.
RES_RE = r'(^|[^A-Z])(ODT|ONT)([^A-Z]|$)'
NON_CODES = [
    'TSC', 'DTS', 'DVH', 'DYT', 'DGD', 'DTT', 'DKH', 'DXH', 'DNG', 'DSK', 'DSH', 'DKV', 'DCH',
    'DCK', 'DBV', 'DNL', 'DRA', 'DDT', 'DDL', 'TON', 'TIN', 'NTD', 'CQP', 'CAN',
    'SKK', 'SKN', 'SKT', 'TMD', 'SKC', 'SKS', 'SKX', 'DGT', 'DTL'
]
NON_RE = r'(^|[^A-Z])(' + '|'.join(NON_CODES) + r')([^A-Z]|$)'
NTD_RE = r'(^|[^A-Z])NTD([^A-Z]|$)'
# Tên/layer lô nghĩa trang. Đài tưởng niệm giữ nhãn file (không ép thành nghĩa trang).
CEM_RE = r'nghĩa địa|nghia dia|nghĩa trang|nghia trang|nghĩatrang|nghiatrang'
MEMORIAL_RE = r'tưởng niệm|tuong niem'


def classify_lot(layer, name, file_use):
    """Nhãn lô quy hoạch. Nghĩa trang / nghĩa địa luôn non, kể cả layer Đất ở."""
    if re.search(MEMORIAL_RE, (name or '').lower()):
        return file_use
    if re.search(CEM_RE, f'{layer or ""} {name or ""}'.lower()):
        return 'non'
    return file_use


def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)


def area_sql(geom):
    return (
        f'ST_Area({geom}) * {M_PER_DEG} * ({M_PER_DEG} * cos(radians(ST_Y(ST_Centroid({geom})))))'
    )


def write_osm():
    dest = os.path.join(TMP, 'osm-poly.geojson')
    if os.path.exists(dest) and os.path.getsize(dest) > 50:
        return dest
    raw = json.load(open(os.path.join(TMP, 'osm.json'), encoding='utf-8'))
    feats = []

    def ring_of(pts):
        ring = [(p['lon'], p['lat']) for p in pts if 'lon' in p and 'lat' in p]
        if len(ring) < 4:
            return None
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        return ring

    for el in raw.get('elements') or []:
        if el.get('type') == 'way':
            ring = ring_of(el.get('geometry') or [])
            if not ring:
                continue
            geom = {'type': 'Polygon', 'coordinates': [ring]}
        else:
            outers = []
            for mem in el.get('members') or []:
                if mem.get('role') == 'inner':
                    continue
                ring = ring_of(mem.get('geometry') or [])
                if ring:
                    outers.append([ring])
            if not outers:
                continue
            geom = {'type': 'MultiPolygon', 'coordinates': outers} if len(outers) > 1 else {
                'type': 'Polygon', 'coordinates': outers[0]
            }
        feats.append({'type': 'Feature', 'properties': {}, 'geometry': geom})
    with open(dest, 'w', encoding='utf-8') as f:
        json.dump({'type': 'FeatureCollection', 'features': feats}, f)
    log(f'OSM polygon {len(feats)}')
    return dest


def write_infra():
    dest = os.path.join(TMP, 'infra-pts.jsonl')
    if os.path.exists(dest) and os.path.getsize(dest) > 20:
        return dest
    raw = json.load(open(os.path.join(TMP, 'infrastructure_hue.json'), encoding='utf-8'))
    n = 0
    with open(dest, 'w', encoding='utf-8') as f:
        for ft in raw.get('features') or []:
            g = ft.get('geometry') or {}
            if g.get('type') != 'Point':
                continue
            xy = g.get('coordinates') or []
            if len(xy) < 2:
                continue
            lng, lat = float(xy[0]), float(xy[1])
            if not (math.isfinite(lng) and math.isfinite(lat)):
                continue
            f.write(json.dumps({'lng': lng, 'lat': lat}) + '\n')
            n += 1
    log(f'điểm hạ tầng {n}')
    return dest


def connect():
    con = duckdb.connect()
    con.execute('LOAD spatial')
    con.execute('SET preserve_insertion_order=false')
    con.execute('SET threads=3')
    con.execute("SET memory_limit='6GB'")
    os.makedirs(os.path.join(TMP, 'duck'), exist_ok=True)
    con.execute(f"SET temp_directory='{os.path.join(TMP, 'duck')}'")
    return con


def build_points(con):
    out = os.path.join(TMP, 'bldg_pts.parquet')
    if os.path.exists(out) and os.path.getsize(out) > 1000 and os.environ.get('GBA_REBUILD_PTS') != '1':
        log(f'điểm công trình đã có {out}')
        return out
    log('đọc công trình và gán phường')
    con.execute(f"""
        CREATE TABLE wards AS
        SELECT tenXa AS name,
               coalesce(danSoNum, try_cast(danSo AS DOUBLE), 0) AS pop,
               ST_MakeValid(geom) AS geom
        FROM ST_Read('{os.path.join(TMP, 'wards.geojson')}')
        WHERE tenXa IS NOT NULL AND tenXa <> ''
    """)
    geom = "ST_SetCRS(ST_GeomFromGeoJSON(to_json(geometry)::VARCHAR), 'EPSG:4326')"
    con.execute(f"""
        CREATE TABLE bldg AS
        SELECT * EXCLUDE (rn) FROM (
            SELECT id, cls, area_m2, x, y, ward, pop,
                   row_number() OVER (PARTITION BY id ORDER BY ward) AS rn
            FROM (
                SELECT p.id, p.cls, p.area_m2, ST_X(p.pt) AS x, ST_Y(p.pt) AS y, w.name AS ward, w.pop AS pop
                FROM (
                    SELECT
                        row_number() OVER () AS id,
                        cls,
                        {area_sql('geom')} AS area_m2,
                        ST_Centroid(geom) AS pt
                    FROM (
                        SELECT properties.c::INTEGER AS cls, {geom} AS geom
                        FROM read_ndjson('{os.path.join(TMP, 'buildings.jsonl')}',
                            columns={{'properties': 'STRUCT(c BIGINT)', 'geometry': 'JSON'}},
                            ignore_errors=true)
                    )
                ) p
                JOIN wards w ON ST_Intersects(w.geom, p.pt)
            )
        ) WHERE rn = 1
    """)
    n = con.execute('SELECT count(*) FROM bldg').fetchone()[0]
    log(f'{n} công trình có phường')
    con.execute(f"COPY bldg TO '{out}' (FORMAT PARQUET)")
    con.execute('DROP TABLE bldg')
    return out


def main():
    osm = write_osm()
    infra = write_infra()
    con = connect()
    pts = build_points(con)
    con.close()
    con = connect()
    log('nạp điểm')
    con.execute(f"CREATE TABLE bldg AS SELECT * FROM read_parquet('{pts}')")
    nb = con.execute('SELECT count(*) FROM bldg').fetchone()[0]
    log(f'{nb} điểm')

    log('thửa địa chính')
    con.execute(f"""
        CREATE TABLE cad AS
        SELECT
            regexp_matches(upper(l), '{RES_RE}') AS is_res,
            regexp_matches(upper(l), '{NON_RE}') AS is_non,
            regexp_matches(upper(l), '{NTD_RE}') AS is_ntd,
            ST_MakeValid(ST_SetCRS(ST_GeomFromGeoJSON(to_json(geometry)::VARCHAR), 'EPSG:4326')) AS geom
        FROM read_ndjson('{os.path.join(TMP, 'cadastre.jsonl')}',
            columns={{'l': 'VARCHAR', 'geometry': 'JSON'}},
            ignore_errors=true)
        WHERE l IS NOT NULL AND l <> ''
    """)
    con.execute("""
        CREATE TABLE cad_hit AS
            SELECT b.id,
               bool_or(c.is_res) AS is_res,
               bool_or(c.is_non) AS is_non,
               bool_or(c.is_ntd) AS is_ntd
        FROM bldg b
        JOIN cad c ON ST_Intersects(c.geom, ST_SetCRS(ST_Point(b.x, b.y), 'EPSG:4326'))
        GROUP BY b.id
    """)
    con.execute('DROP TABLE cad')
    log(f"thửa trúng {con.execute('SELECT count(*) FROM cad_hit').fetchone()[0]}")

    log('OSM')
    con.execute(f"""
        CREATE TABLE osm AS
        SELECT ST_MakeValid(ST_SetCRS(geom, 'EPSG:4326')) AS geom
        FROM ST_Read('{osm}')
    """)
    con.execute("""
        CREATE TABLE osm_hit AS
        SELECT DISTINCT b.id
        FROM bldg b
        JOIN osm o ON ST_Intersects(o.geom, ST_SetCRS(ST_Point(b.x, b.y), 'EPSG:4326'))
    """)
    con.execute('DROP TABLE osm')
    log(f"OSM trúng {con.execute('SELECT count(*) FROM osm_hit').fetchone()[0]}")

    log('điểm hạ tầng 20 m')
    con.execute(f"""
        CREATE TABLE infra AS
        SELECT lng, lat,
               floor(lng / 0.001)::INTEGER AS cx,
               floor(lat / 0.001)::INTEGER AS cy
        FROM read_ndjson('{infra}')
    """)
    con.execute(f"""
        CREATE TABLE infra_hit AS
        SELECT DISTINCT b.id
        FROM bldg b
        JOIN infra i
          ON i.cx BETWEEN floor(b.x / 0.001)::INTEGER - 1 AND floor(b.x / 0.001)::INTEGER + 1
         AND i.cy BETWEEN floor(b.y / 0.001)::INTEGER - 1 AND floor(b.y / 0.001)::INTEGER + 1
        WHERE pow((b.x - i.lng) * {M_PER_DEG} * cos(radians(b.y)), 2)
            + pow((b.y - i.lat) * {M_PER_DEG}, 2) <= {NEAR_M * NEAR_M}
    """)
    log(f"hạ tầng trúng {con.execute('SELECT count(*) FROM infra_hit').fetchone()[0]}")

    log('lô quy hoạch')
    con.execute(f"""
        CREATE TABLE lots AS
        SELECT k, layer, name,
               ST_MakeValid(ST_SetCRS(geom, 'EPSG:4326')) AS geom,
               {area_sql("ST_SetCRS(geom, 'EPSG:4326')")} AS area_m2
        FROM ST_Read('{os.path.join(TMP, 'lots-use.geojson')}')
        WHERE k IS NOT NULL
    """)
    con.execute(f"""
        CREATE TABLE lot_use AS
        SELECT k, use FROM read_ndjson('{os.path.join(TMP, 'lot-use.jsonl')}')
    """)
    # classify_lot: nghĩa trang / nghĩa địa → non, đài tưởng niệm giữ nhãn file.
    con.execute(f"""
        CREATE TABLE lot_hit AS
        SELECT id, use FROM (
            SELECT id, use, row_number() OVER (
                PARTITION BY id
                ORDER BY (use IS NULL OR use = ''), area_m2
            ) AS rn
            FROM (
                SELECT b.id, l.area_m2,
                       CASE
                           WHEN regexp_matches(lower(coalesce(l.name, '')), '{MEMORIAL_RE}') THEN u.use
                           WHEN regexp_matches(lower(coalesce(l.layer, '') || ' ' || coalesce(l.name, '')), '{CEM_RE}') THEN 'non'
                           ELSE u.use
                       END AS use
                FROM bldg b
                JOIN lots l ON ST_Intersects(l.geom, ST_SetCRS(ST_Point(b.x, b.y), 'EPSG:4326'))
                LEFT JOIN lot_use u ON u.k = l.k
            )
        ) WHERE rn = 1 AND use IN ('res', 'non')
    """)
    log(f"lô quyết định {con.execute('SELECT count(*) FROM lot_hit').fetchone()[0]}")

    log('gán nhãn')
    con.execute(f"""
        CREATE TABLE labeled AS
        SELECT
            b.id, b.ward, b.pop, b.area_m2, b.cls, b.x, b.y,
            coalesce(c.is_res, false) AS cad_res,
            coalesce(c.is_non, false) AS cad_non,
            coalesce(c.is_ntd, false) AS cad_ntd,
            o.id IS NOT NULL AS osm,
            i.id IS NOT NULL AS infra,
            h.use AS lot_use
        FROM bldg b
        LEFT JOIN cad_hit c ON c.id = b.id
        LEFT JOIN osm_hit o ON o.id = b.id
        LEFT JOIN infra_hit i ON i.id = b.id
        LEFT JOIN lot_hit h ON h.id = b.id
    """)
    # Dưới ngưỡng nhỏ: không phải nhà ở dù thửa là đất ở. Chỉ ghi lý do "small" khi quy tắc này
    # mới loại khỏi nhà ở; công trình đã loại bởi địa chính / OSM / hạ tầng / lô giữ lý do cũ.
    con.execute(f"""
        CREATE TABLE cls AS
        SELECT *,
            CASE
                WHEN area_m2 < {SMALL_M2} AND NOT coalesce(cad_ntd, false) AND (
                    coalesce(cad_res, false)
                    OR (
                        NOT coalesce(cad_non, false)
                        AND NOT coalesce(osm, false)
                        AND NOT coalesce(infra, false)
                        AND (lot_use IS NULL OR lot_use <> 'non')
                    )
                ) THEN 'small'
                WHEN cad_ntd THEN 'cad'
                WHEN cad_res THEN 'keep'
                WHEN cad_non THEN 'cad'
                WHEN osm THEN 'osm'
                WHEN infra THEN 'infra'
                WHEN lot_use = 'non' THEN 'lot'
                WHEN area_m2 > {LARGE_M2} THEN 'large'
                WHEN lot_use = 'res' THEN 'keep'
                ELSE 'keep'
            END AS reason,
            CASE
                WHEN area_m2 < {SMALL_M2} THEN false
                WHEN cad_ntd THEN false
                WHEN cad_res THEN true
                WHEN cad_non OR osm OR infra OR lot_use = 'non' THEN false
                WHEN area_m2 > {LARGE_M2} THEN false
                ELSE true
            END AS residential
        FROM labeled
    """)

    def pair(where):
        row = con.execute(f"""
            SELECT count(*), coalesce(sum(area_m2), 0)
            FROM cls WHERE {where}
        """).fetchone()
        return [int(row[0]), round(float(row[1]))]

    rules = ['cad', 'osm', 'infra', 'lot', 'large', 'small']
    mismatch = con.execute("""
        SELECT count(*) FROM cls
        WHERE (residential AND reason <> 'keep') OR (NOT residential AND reason = 'keep')
    """).fetchone()[0]
    if mismatch:
        raise SystemExit(f'Lệch nhãn nhà ở và lý do loại: {mismatch}')
    export = os.environ.get('GBA_EXPORT_LABELED')
    if export:
        con.execute(f"""
            COPY (
                SELECT id, ward, pop, area_m2, cls, x, y, residential, reason,
                       CASE WHEN residential THEN area_m2 * (cls + 1) ELSE 0 END AS wb
                FROM cls
            ) TO '{export}' (FORMAT PARQUET)
        """)
        log(f'xuất nhãn {export}')
        if os.environ.get('GBA_EXPORT_ONLY') == '1':
            con.close()
            return
    summary_drop = {k: pair(f"reason = '{k}'") for k in rules}
    summary_keep = pair('residential')
    summary_apt = pair(f"residential AND cad_res AND area_m2 > {LARGE_M2}")
    log(f'nhà ở {summary_keep} chung cư giữ {summary_apt} loại {summary_drop}')

    ward_sql = con.execute(f"""
        SELECT ward,
               any_value(pop) AS pop,
               count(*) AS n,
               sum(area_m2) AS fp,
               sum(area_m2 * (cls + 1)) AS tw,
               count(*) FILTER (WHERE residential) AS rn,
               coalesce(sum(area_m2) FILTER (WHERE residential), 0) AS rfp,
               coalesce(sum(area_m2 * (cls + 1)) FILTER (WHERE residential), 0) AS rw,
               count(*) FILTER (WHERE reason = 'cad') AS n_cad,
               coalesce(sum(area_m2) FILTER (WHERE reason = 'cad'), 0) AS a_cad,
               count(*) FILTER (WHERE reason = 'osm') AS n_osm,
               coalesce(sum(area_m2) FILTER (WHERE reason = 'osm'), 0) AS a_osm,
               count(*) FILTER (WHERE reason = 'infra') AS n_infra,
               coalesce(sum(area_m2) FILTER (WHERE reason = 'infra'), 0) AS a_infra,
               count(*) FILTER (WHERE reason = 'lot') AS n_lot,
               coalesce(sum(area_m2) FILTER (WHERE reason = 'lot'), 0) AS a_lot,
               count(*) FILTER (WHERE reason = 'large') AS n_large,
               coalesce(sum(area_m2) FILTER (WHERE reason = 'large'), 0) AS a_large,
               count(*) FILTER (WHERE reason = 'small') AS n_small,
               coalesce(sum(area_m2) FILTER (WHERE reason = 'small'), 0) AS a_small,
               count(*) FILTER (WHERE residential AND cad_res AND area_m2 > {LARGE_M2}) AS n_apt,
               coalesce(sum(area_m2) FILTER (WHERE residential AND cad_res AND area_m2 > {LARGE_M2}), 0) AS a_apt
        FROM cls
        GROUP BY ward
    """).fetchall()

    # Dân số lô = dân số phường × trọng số nhà ở của lô / trọng số nhà ở của phường.
    # Dân số lô = tổng phần dân số phường của từng công trình nhà ở (trọng số / trọng số phường).
    lot_rows = con.execute("""
        WITH wr AS (
            SELECT ward,
                   sum(area_m2 * (cls + 1)) FILTER (WHERE residential) AS rw
            FROM cls
            GROUP BY ward
        )
        SELECT l.k,
               count(b.id) FILTER (WHERE b.residential) AS rn,
               coalesce(sum(b.area_m2) FILTER (WHERE b.residential), 0) AS rfp,
               any_value(l.area_m2) AS area,
               coalesce(sum(
                   CASE WHEN b.residential AND w.rw > 0
                        THEN b.pop * b.area_m2 * (b.cls + 1) / w.rw
                        ELSE 0 END
               ), 0) AS rp
        FROM lots l
        LEFT JOIN cls b ON ST_Intersects(l.geom, ST_SetCRS(ST_Point(b.x, b.y), 'EPSG:4326'))
        LEFT JOIN wr w ON w.ward = b.ward
        GROUP BY l.k
    """).fetchall()
    log(f'lô {len(lot_rows)}')

    # Diện tích phường lấy từ agg cũ (cov = 100 * fp / area).
    with open(AGG_PATH, encoding='utf-8') as f:
        agg = json.load(f)
    by_name = {w['name']: w for w in agg['wards']}

    def drop_obj(n, a):
        return [int(n), round(float(a))]

    for row in ward_sql:
        (name, pop, n, fp, tw, rn, rfp, rw,
         n_cad, a_cad, n_osm, a_osm, n_infra, a_infra, n_lot, a_lot, n_large, a_large,
         n_small, a_small, n_apt, a_apt) = row
        w = by_name.get(name)
        if not w:
            continue
        area = (w['fp'] / (w['cov'] / 100.0)) if w.get('cov') else 0
        rcov = round(100.0 * float(rfp) / area, 1) if area else 0
        tw = float(tw or 0)
        rw = float(rw or 0)
        w.update({
            'rn': int(rn),
            'rfp': round(float(rfp)),
            'rcov': rcov,
            'rw': round(rw),
            'tw': round(tw),
            'pop': int(round(float(pop or 0))),
            'ratio': round(tw / rw, 2) if rw > 0 else None,
            'drop': {
                'cad': drop_obj(n_cad, a_cad),
                'osm': drop_obj(n_osm, a_osm),
                'infra': drop_obj(n_infra, a_infra),
                'lot': drop_obj(n_lot, a_lot),
                'large': drop_obj(n_large, a_large),
                'small': drop_obj(n_small, a_small)
            },
            'apt': drop_obj(n_apt, a_apt)
        })

    lots = agg['lots']
    for key, rn, rfp, area, rp in lot_rows:
        old = lots.get(key) or [0, 0, 0, None, 0]
        area = float(area or 0)
        rcov = round(100.0 * float(rfp) / area, 1) if area else 0
        lots[key] = list(old[:5]) + [int(rn or 0), round(float(rfp or 0)), rcov, int(round(float(rp or 0)))]

    total_pop = sum(w.get('pop') or 0 for w in agg['wards'])
    total_tw = sum(w.get('tw') or 0 for w in agg['wards'])
    total_rw = sum(w.get('rw') or 0 for w in agg['wards'])
    agg['v'] = 2
    agg['largeM2'] = LARGE_M2
    agg['smallM2'] = SMALL_M2
    agg['res'] = {
        'largeM2': LARGE_M2,
        'smallM2': SMALL_M2,
        'nearM': NEAR_M,
        'residential': summary_keep,
        'apartmentsKept': summary_apt,
        'drop': summary_drop,
        'pop': total_pop,
        'tw': total_tw,
        'rw': total_rw,
        'ratio': round(total_tw / total_rw, 2) if total_rw else None
    }
    note = agg.get('note') or ''
    extra = (
        ' Nhà ở để phân bổ dân số: mã NTD (nghĩa trang) thắng cả khi điểm cũng chạm ODT/ONT. '
        'Mã thửa khác: ODT/ONT và tổ hợp có chúng là nhà ở; '
        'mã công cộng, sản xuất, giao thông là không phải nhà ở. Rồi vùng OSM (amenity, shop, office, '
        'industrial, religious), điểm hạ tầng trong 20 m, chức năng lô quy hoạch '
        '(lô nghĩa trang, nghĩa địa luôn không phải nhà ở, kể cả layer Đất ở), '
        f'và dấu chân lớn hơn {int(LARGE_M2)} m² trừ thửa đất ở. '
        f'Dấu chân nhỏ hơn {int(SMALL_M2)} m² (nhà kho, bếp, mái) không phải nhà ở dù thửa là đất ở. '
        'Trọng số là diện tích dấu chân nhà ở nhân bậc chiều cao tương đối, không phải mét.'
    )
    marker = ' Nhà ở để phân bổ dân số:'
    base = note.split(marker)[0].rstrip()
    agg['note'] = base + extra
    with open(AGG_PATH, 'w', encoding='utf-8') as f:
        json.dump(agg, f, ensure_ascii=False, separators=(',', ':'))
    log(f"agg {os.path.getsize(AGG_PATH)/1e6:.1f} MB tỷ lệ {agg['res']['ratio']}")
    con.close()


if __name__ == '__main__':
    main()
