#!/usr/bin/env python3
# Dấu chân công trình Global Building Atlas (ô e105_n20_e110_n15) cắt theo ranh 40 phường xã TP. Huế.
# Chiều cao chỉ để xếp nhóm tương đối (Thấp / Trung bình / Cao / Rất cao), không ghi mét vào file web.
#   python3 scripts/build-gba.py
# Cần duckdb (pip install duckdb) và tippecanoe. Parquet mặc định /tmp/gba/e105_n20_e110_n15.parquet.
# Đầu ra: public/data/gba/agg.json (nhỏ, đưa vào git) và public/data/gba/buildings.pmtiles (không git).
# Phân loại nhà ở và trọng số dân số: python3 scripts/gba-residential.py (sau khi có jsonl và thửa).
# Đẩy bucket (nếu có quyền): gcloud storage cp public/data/gba/buildings.pmtiles gs://hue-infra-data-us/gba/buildings.pmtiles
#   và agg.json cùng thư mục. Bucket cần CORS cho header Range như lớp thửa đất.

import json
import math
import os
import subprocess
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import duckdb

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.environ.get('GBA_TMP', '/tmp/gba')
PARQUET = os.environ.get('GBA_PARQUET', os.path.join(TMP, 'e105_n20_e110_n15.parquet'))
WARDS = os.environ.get('GBA_WARDS', os.path.join(TMP, 'wards.geojson'))
WARD_URL = 'https://qh-hue.donghoangsxd.workers.dev/api/gee?action=getBoundaryVector&v=2'
INDEX_URL = 'https://qh-hue.donghoangsxd.workers.dev/api/gee?action=getProjectIndex'
OUT_DIR = os.path.join(ROOT, 'public', 'data', 'gba')
AGG_PATH = os.path.join(OUT_DIR, 'agg.json')
PMT_PATH = os.path.join(OUT_DIR, 'buildings.pmtiles')
JSONL = os.path.join(TMP, 'buildings.jsonl')
LOTS = os.path.join(TMP, 'lots.geojson')

# Ô ~150 m tại vĩ độ Huế
CELL_M = 150
LAT0 = 16.45
M_PER_DEG = 111320.0
DLAT = CELL_M / M_PER_DEG
DLNG = CELL_M / (M_PER_DEG * math.cos(math.radians(LAT0)))
CELL_AREA = CELL_M * CELL_M
# Khung trước khi cắt ranh (cùng bbox đã đối chiếu ~1,4 triệu công trình)
BBOX = (107.0, 16.0, 108.2, 16.8)
CLASSES = ['Thấp', 'Trung bình', 'Cao', 'Rất cao']


def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)


def fetch(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    urllib.request.urlretrieve(url, dest)


def area_sql(geom):
    # ST_Area trên CRS84 là độ vuông; nhân mét/độ theo vĩ độ tâm
    return (
        f'ST_Area({geom}) * {M_PER_DEG} * ({M_PER_DEG} * cos(radians(ST_Y(ST_Centroid({geom})))))'
    )


def download_lots():
    if os.path.exists(LOTS) and os.path.getsize(LOTS) > 1000:
        log(f'lô đã có {LOTS}')
        return
    log('tải danh mục đồ án')
    index = json.load(urllib.request.urlopen(INDEX_URL, timeout=120))
    base = index['base']
    projects = [p for p in index['projects'] if (p.get('lands') or 0) > 0 and p.get('tenQH')]

    def one(p):
        feats = []
        urls = []
        if p.get('dir') and p.get('slug'):
            urls.append(base + p['slug'] + '/su-dung-dat.json')
            urls.append(base + p['slug'] + '/hien-trang.json')
        elif p.get('slug'):
            urls.append(base + p['slug'] + '.json')
        for url in urls:
            try:
                with urllib.request.urlopen(url, timeout=180) as res:
                    if res.status != 200:
                        continue
                    data = json.load(res)
            except Exception:
                continue
            for parcel in data.get('parcels') or []:
                g = parcel.get('geometry')
                if not g or g.get('type') not in ('Polygon', 'MultiPolygon'):
                    continue
                if not parcel.get('id'):
                    continue
                phase = 'QH' if parcel.get('phase') != 'HT' else 'HT'
                key = f"{p['tenQH']}|{phase}|{parcel['id']}"
                feats.append({
                    'type': 'Feature',
                    'properties': {'k': key},
                    'geometry': g
                })
        return feats

    features = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = [pool.submit(one, p) for p in projects]
        done = 0
        for fut in as_completed(futs):
            features.extend(fut.result())
            done += 1
            if done % 20 == 0:
                log(f'đồ án {done}/{len(projects)}, lô {len(features)}')
    with open(LOTS, 'w', encoding='utf-8') as f:
        json.dump({'type': 'FeatureCollection', 'features': features}, f)
    log(f'ghi {len(features)} lô')


def cls_expr(value, q1, q2, q3):
    return f'CASE WHEN {value} <= {q1} THEN 0 WHEN {value} <= {q2} THEN 1 WHEN {value} <= {q3} THEN 2 ELSE 3 END'


def main():
    os.makedirs(TMP, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    if not os.path.exists(PARQUET):
        raise SystemExit(f'Thiếu parquet {PARQUET}')
    fetch(WARD_URL, WARDS)
    download_lots()

    con = duckdb.connect()
    con.execute("LOAD spatial")
    con.execute("SET preserve_insertion_order=false")
    con.execute("SET threads=4")
    con.execute("SET memory_limit='8GB'")
    con.execute(f"SET temp_directory='{TMP}/duck'")
    os.makedirs(os.path.join(TMP, 'duck'), exist_ok=True)

    log('đọc ranh phường')
    con.execute(f"""
        CREATE TABLE wards AS
        SELECT tenXa AS name, ST_MakeValid(geom) AS geom, {area_sql('geom')} AS area_m2
        FROM ST_Read('{WARDS}')
        WHERE tenXa IS NOT NULL AND tenXa <> ''
    """)
    nward = con.execute('SELECT count(*) FROM wards').fetchone()[0]
    log(f'{nward} phường xã')

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
    # Tâm nằm trên ranh chung: giữ một phường
    con.execute("""
        CREATE TABLE bldg AS
        SELECT * EXCLUDE (rn) FROM (
            SELECT *, row_number() OVER (PARTITION BY id ORDER BY ward) AS rn FROM kept
        ) WHERE rn = 1
    """)
    con.execute('DROP TABLE kept')
    con.execute('DROP TABLE cand')
    nb = con.execute('SELECT count(*) FROM bldg').fetchone()[0]
    log(f'{nb} công trình trong ranh')
    if nb < 1000:
        raise SystemExit('Quá ít công trình sau khi cắt — dừng')

    q1, q2, q3 = con.execute('SELECT quantile_cont(height, 0.25), quantile_cont(height, 0.5), quantile_cont(height, 0.75) FROM bldg').fetchone()
    log(f'ngưỡng nhóm chiều cao (m, chỉ log, không ghi file web): {q1:.2f} / {q2:.2f} / {q3:.2f}')
    con.execute(f'ALTER TABLE bldg ADD COLUMN cls INTEGER')
    con.execute(f'UPDATE bldg SET cls = {cls_expr("height", q1, q2, q3)}')

    if not os.path.exists(JSONL) or os.environ.get('GBA_REBUILD_JSONL') == '1':
        log('xuất GeoJSONL (chỉ mã nhóm)')
        if os.path.exists(JSONL):
            os.remove(JSONL)
        con.execute(f"""
            COPY (
                SELECT 'Feature' AS type,
                       json_object('c', cls) AS properties,
                       ST_AsGeoJSON(geometry)::JSON AS geometry
                FROM bldg
            ) TO '{JSONL}' (FORMAT JSON, ARRAY false)
        """)
        log(f'jsonl {os.path.getsize(JSONL)/1e6:.0f} MB')

    log('tổng hợp phường')
    wards = con.execute(f"""
        WITH s AS (
            SELECT ward AS name, count(*) n, sum(area_m2) fp, sum(area_m2 * height) vol
            FROM bldg GROUP BY ward
        )
        SELECT w.name, coalesce(s.n, 0), coalesce(s.fp, 0), w.area_m2,
               CASE WHEN w.area_m2 > 0 THEN coalesce(s.vol, 0) / w.area_m2 ELSE 0 END AS fai
        FROM wards w LEFT JOIN s ON s.name = w.name
        ORDER BY w.name
    """).fetchall()
    fai_pos = sorted(r[4] for r in wards if r[1] > 0)
    def breaks(vals):
        if not vals:
            return (0, 0, 0, 1)
        def q(p):
            i = min(len(vals) - 1, max(0, int(round(p * (len(vals) - 1)))))
            return vals[i]
        med = q(0.5) or 1
        return (q(0.25), q(0.5), q(0.75), med)
    wq1, wq2, wq3, wmed = breaks(fai_pos)

    def pack(n, fp, area, fai, bq1, bq2, bq3, med):
        cov = (100.0 * fp / area) if area else 0
        if cov < 0:
            cov = 0
        rel = (fai / med) if med else 0
        cls = 0 if n <= 0 else (0 if fai <= bq1 else 1 if fai <= bq2 else 2 if fai <= bq3 else 3)
        return [int(n), round(fp), round(cov, 1), (None if n <= 0 else cls), round(rel, 2)]

    ward_rows = []
    for name, n, fp, area, fai in wards:
        n_, fp_, cov, cls, rel = pack(n, fp, area, fai, wq1, wq2, wq3, wmed)
        ward_rows.append({'name': name, 'n': n_, 'fp': fp_, 'cov': cov, 'cls': cls, 'fai': rel})

    log('tổng hợp lô quy hoạch')
    con.execute(f"""
        CREATE TABLE lots AS
        SELECT k, ST_MakeValid(ST_SetCRS(geom, 'EPSG:4326')) AS geom, {area_sql("ST_SetCRS(geom, 'EPSG:4326')")} AS area_m2
        FROM ST_Read('{LOTS}')
        WHERE k IS NOT NULL
    """)
    lot_stats = con.execute("""
        SELECT l.k, count(b.pt) n, coalesce(sum(b.area_m2), 0) fp, any_value(l.area_m2) area,
               coalesce(sum(b.area_m2 * b.height), 0) vol
        FROM lots l
        LEFT JOIN bldg b ON ST_Intersects(l.geom, b.pt)
        GROUP BY l.k
    """).fetchall()
    lot_fai = sorted((r[4] / r[3]) for r in lot_stats if r[1] > 0 and r[3] and r[3] > 0)
    lq1, lq2, lq3, lmed = breaks(lot_fai)
    lots_out = {}
    for key, n, fp, area, vol in lot_stats:
        fai = (vol / area) if area else 0
        lots_out[key] = pack(n, fp, area or 0, fai, lq1, lq2, lq3, lmed)
    log(f'{len(lots_out)} lô')

    log('lưới 150 m')
    origin = con.execute('SELECT min(ST_X(pt)), min(ST_Y(pt)) FROM bldg').fetchone()
    ox = math.floor(origin[0] / DLNG) * DLNG
    oy = math.floor(origin[1] / DLAT) * DLAT
    cells = con.execute(f"""
        SELECT
            floor((ST_X(pt) - {ox}) / {DLNG})::INTEGER AS c,
            floor((ST_Y(pt) - {oy}) / {DLAT})::INTEGER AS r,
            count(*) n,
            sum(area_m2 * height) / {CELL_AREA} AS fai
        FROM bldg
        GROUP BY 1, 2
    """).fetchall()
    cell_fai = sorted(r[3] for r in cells if r[2] > 0)
    cq1, cq2, cq3, _cmed = breaks(cell_fai)
    grid = []
    for col, row, n, fai in cells:
        cls = 0 if fai <= cq1 else 1 if fai <= cq2 else 2 if fai <= cq3 else 3
        grid.append([int(col), int(row), cls])
    log(f'{len(grid)} ô có công trình')

    agg = {
        'v': 1,
        'cellM': CELL_M,
        'origin': [round(ox, 6), round(oy, 6)],
        'dlng': DLNG,
        'dlat': DLAT,
        'classes': CLASSES,
        'buildings': int(nb),
        'note': (
            'Dấu chân Global Building Atlas (TUM 2025; Google, OpenStreetMap, Microsoft khoảng 2023). '
            'Nhóm chiều cao và chỉ số sàn là tương đối trong địa bàn (phân vị), không phải mét, không dùng để quản lý chiều cao. '
            'Giấy phép CC BY-NC 4.0 và ODbL.'
        ),
        'wards': ward_rows,
        'lots': lots_out,
        'grid': grid
    }
    with open(AGG_PATH, 'w', encoding='utf-8') as f:
        json.dump(agg, f, ensure_ascii=False, separators=(',', ':'))
    log(f'agg {os.path.getsize(AGG_PATH)/1e6:.1f} MB')
    con.close()

    if os.environ.get('GBA_SKIP_TILES') == '1' and os.path.exists(PMT_PATH):
        log('giữ pmtiles cũ')
        return
    log('tippecanoe z13–16')
    cmd = [
        'tippecanoe',
        '-o', PMT_PATH,
        '--force',
        '--layer=gba',
        '--attribution=Global Building Atlas, TUM; footprints Google, Microsoft, OpenStreetMap; CC BY-NC 4.0, ODbL',
        '--description=Dấu chân công trình TP. Huế, nhóm chiều cao tương đối',
        '--minimum-zoom=13',
        '--maximum-zoom=16',
        '--drop-smallest-as-needed',
        '--extend-zooms-if-still-dropping',
        '--maximum-tile-bytes=2500000',
        '--no-feature-limit',
        '--simplify-only-low-zooms',
        '--no-tiny-polygon-reduction-at-maximum-zoom',
        '--include=c',
        '--attribute-type=c:int',
        '--read-parallel',
        '--temporary-directory=' + os.path.join(TMP, 'tip'),
        JSONL
    ]
    os.makedirs(os.path.join(TMP, 'tip'), exist_ok=True)
    subprocess.check_call(cmd)
    log(f'pmtiles {os.path.getsize(PMT_PATH)/1e6:.0f} MB')


if __name__ == '__main__':
    main()
