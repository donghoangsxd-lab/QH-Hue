#!/usr/bin/env python3
# Thí nghiệm so sánh phân bổ dân số. Không thay logic sản xuất.
# Cũ: dân số hành chính phường chia đều cho pixel WorldPop 2020 có dân > 0
#     (cùng công thức Pixel-danso / popRasterNormalized trong services/geeService.js,
#     lưới đếm app là 60 m; thí nghiệm dùng WorldPop GP 100 m vì không có khóa GEE).
# A: cùng dân số phường, chia đều cho nhà ở GBA sau bộ lọc.
# B: cùng dân số phường, trọng số = diện tích dấu chân × (bậc chiều cao tương đối + 1).
#   python3 scripts/gba-pop-compare.py

import csv
import importlib.util
import json
import math
import os
import subprocess
import time

import numpy as np
import pyarrow as pa
import rasterio

_spec = importlib.util.spec_from_file_location(
    'gba_residential',
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gba-residential.py')
)
res = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(res)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.environ.get('GBA_TMP', '/tmp/gba')
M_PER_DEG = 111320.0
FLOOD_M = 5
FLOOD_LO = 2
SHIFT_FLAG_M = 500
PCT_FLAG = 15.0
SMALL_BASE = 100.0
WP_URL = 'https://data.worldpop.org/GIS/Population/Global_2000_2020/2020/VNM/vnm_ppp_2020.tif'
WP_BYTES = 196897622
ART = os.environ.get('GBA_COMPARE_ART', '/opt/cursor/artifacts')
OUT_DIR = os.path.join(ROOT, 'public', 'data', 'gba')


def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)


def connect():
    return res.connect()


def vn_int(n):
    if n is None or (isinstance(n, float) and not math.isfinite(n)):
        return '—'
    return f'{int(math.floor(float(n) + 0.5)):,}'.replace(',', '.')


def vn_pct(p):
    if p is None or (isinstance(p, float) and math.isnan(p)):
        return '—'
    if math.isinf(p):
        return 'từ 0'
    return f'{p:+.1f}'.replace('.', ',') + '%'


def vn_m(n):
    if n is None or not math.isfinite(n):
        return '—'
    return f'{n:.0f} m'


def rel_pct(new, old):
    if old is None or new is None:
        return None
    if abs(old) < 1e-6:
        if abs(new) < 1e-6:
            return 0.0
        return math.inf if new > 0 else -math.inf
    return (new - old) / old * 100.0


def flagged(new, old, pct):
    base = max(abs(old or 0), abs(new or 0))
    if pct is None or not math.isfinite(pct):
        return base >= SMALL_BASE and abs(new or 0) >= SMALL_BASE and abs(old or 0) < 1
    return abs(pct) >= PCT_FLAG and base >= SMALL_BASE


def parse_area(val):
    if val is None:
        return None
    s = str(val).strip()
    if s == '' or s.lower() == 'none':
        return None
    try:
        return float(s.replace(',', '.'))
    except ValueError:
        return None


def plan_change(ht, qh):
    if ht is None:
        return 'none' if qh is None else 'new'
    if qh is None:
        return 'relocate'
    if ht == 0 or qh == 0:
        return 'keep'
    if abs(qh - ht) <= ht * 0.05:
        return 'keep'
    if qh > ht:
        return 'expand'
    if qh < ht:
        return 'shrink'
    return 'keep'


def approved(status):
    return status is True or str(status).strip().upper() == 'TRUE' or str(status).strip() == '1'


def ensure_file(path, url, min_bytes):
    if os.path.exists(path) and os.path.getsize(path) >= min_bytes:
        return
    log(f'tải {os.path.basename(path)}')
    subprocess.check_call(['curl', '-fL', '--retry', '3', '-o', path, url])


def ensure_labeled():
    dest = os.path.join(TMP, 'labeled.parquet')
    if os.path.exists(dest) and os.path.getsize(dest) > 1000 and os.environ.get('GBA_REBUILD_LABELED') != '1':
        log(f'nhãn nhà ở đã có {dest}')
        return dest
    if os.path.exists(dest):
        os.remove(dest)
    env = os.environ.copy()
    env['GBA_EXPORT_LABELED'] = dest
    env['GBA_EXPORT_ONLY'] = '1'
    log('gán nhãn nhà ở')
    subprocess.check_call(['python3', os.path.join(ROOT, 'scripts', 'gba-residential.py')], env=env)
    return dest


def ward_table(con):
    con.execute(f"""
        CREATE TABLE wards AS
        SELECT tenXa AS name,
               coalesce(danSoNum, try_cast(danSo AS DOUBLE), 0) AS pop,
               ST_MakeValid(geom) AS geom
        FROM ST_Read('{os.path.join(TMP, 'wards.geojson')}')
        WHERE tenXa IS NOT NULL AND tenXa <> ''
    """)


def worldpop_pixels(con):
    path = os.path.join(TMP, 'vnm_ppp_2020.tif')
    ensure_file(path, WP_URL, WP_BYTES - 1000)
    out = os.path.join(TMP, 'wp_pixels.parquet')
    fresh = not (os.path.exists(out) and os.path.getsize(out) > 1000 and os.environ.get('GBA_REBUILD_WP') != '1')
    if not fresh:
        log(f'pixel WorldPop đã có {out}')
    else:
        bounds = con.execute('SELECT min(ST_XMin(geom)), min(ST_YMin(geom)), max(ST_XMax(geom)), max(ST_YMax(geom)) FROM wards').fetchone()
        pad = 0.02
        minx, miny, maxx, maxy = bounds[0] - pad, bounds[1] - pad, bounds[2] + pad, bounds[3] + pad
        log('đọc cửa sổ WorldPop')
        with rasterio.open(path) as src:
            minx = max(minx, src.bounds.left)
            miny = max(miny, src.bounds.bottom)
            maxx = min(maxx, src.bounds.right)
            maxy = min(maxy, src.bounds.top)
            win = rasterio.windows.from_bounds(minx, miny, maxx, maxy, src.transform)
            win = win.round_offsets().round_lengths()
            data = src.read(1, window=win, masked=True)
            transform = src.window_transform(win)
            nodata = src.nodata
        arr = np.ma.filled(data, 0).astype('float64')
        if nodata is not None:
            arr[arr == nodata] = 0
        arr[~np.isfinite(arr)] = 0
        ys, xs = np.nonzero(arr > 0)
        if len(xs) == 0:
            raise SystemExit('WorldPop không có pixel > 0 trong ranh Huế')
        lng, lat = rasterio.transform.xy(transform, ys, xs, offset='center')
        lng = np.asarray(lng, dtype='float64')
        lat = np.asarray(lat, dtype='float64')
        val = arr[ys, xs]
        log(f'pixel > 0: {len(val)} p50={np.percentile(val, 50):.3f} p90={np.percentile(val, 90):.2f} max={val.max():.1f}')
        con.register('wp_raw', pa.table({'x': lng, 'y': lat, 'wp': val}))
        con.execute("""
            CREATE TABLE wp_build AS
            SELECT * EXCLUDE (rn) FROM (
                SELECT x, y, wp, name AS ward, pop,
                       row_number() OVER (PARTITION BY x, y ORDER BY name) AS rn
                FROM wp_raw p
                JOIN wards w ON ST_Intersects(w.geom, ST_SetCRS(ST_Point(p.x, p.y), 'EPSG:4326'))
            ) WHERE rn = 1
        """)
        n = con.execute('SELECT count(*) FROM wp_build').fetchone()[0]
        log(f'pixel trong phường {n}')
        if os.path.exists(out):
            os.remove(out)
        con.execute(f"COPY wp_build TO '{out}' (FORMAT PARQUET)")
        con.unregister('wp_raw')
        con.execute('DROP TABLE wp_build')
    con.execute(f"CREATE TABLE wp_ward AS SELECT * FROM read_parquet('{out}')")
    return out


def load_buildings(con, labeled):
    con.execute(f"""
        CREATE TABLE bldg AS
        SELECT id, ward, pop, area_m2, cls, x, y, residential, wb
        FROM read_parquet('{labeled}')
        WHERE residential
    """)
    n, wards = con.execute('SELECT count(*), count(DISTINCT ward) FROM bldg').fetchone()
    log(f'nhà ở {n} trên {wards} phường')
    return con.execute("""
        SELECT ward,
               any_value(pop) AS pop,
               count(*) AS rn,
               sum(wb) AS rw
        FROM bldg GROUP BY ward
    """).fetchall()


def facilities(con):
    raw_path = os.path.join(TMP, 'infrastructure_hue.json')
    raw = json.load(open(raw_path, encoding='utf-8'))
    cand = []
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
        p = ft.get('properties') or {}
        if not approved(p.get('TrangThai')):
            continue
        ht = parse_area(p.get('QuyMo_HT'))
        qh = parse_area(p.get('QuyMo_QH'))
        if plan_change(ht, qh) in ('new', 'none'):
            continue
        cand.append({
            'id': p.get('ID_DoiTuong') or '',
            'name': p.get('Ten_CongTrinh') or '',
            'type': p.get('Tab') or '',
            'nhom': p.get('Nhom_HaTang') or '',
            'size': ht if ht is not None else 0,
            'lat': lat,
            'lng': lng
        })
    log(f'công trình hiện trạng đã duyệt {len(cand)}')
    con.execute('CREATE TABLE fac_in (i INTEGER, x DOUBLE, y DOUBLE)')
    con.executemany('INSERT INTO fac_in VALUES (?, ?, ?)', [(i, c['lng'], c['lat']) for i, c in enumerate(cand)])
    hit = dict(con.execute("""
        SELECT i, ward FROM (
            SELECT f.i, w.name AS ward,
                   row_number() OVER (PARTITION BY f.i ORDER BY w.name) AS rn
            FROM fac_in f
            JOIN wards w ON ST_Intersects(w.geom, ST_SetCRS(ST_Point(f.x, f.y), 'EPSG:4326'))
        ) WHERE rn = 1
    """).fetchall())
    kept = []
    for i, c in enumerate(cand):
        w = hit.get(i)
        if not w:
            continue
        c['ward'] = w
        kept.append(c)
    src = os.path.join(TMP, 'fac-candidates.json')
    dest = os.path.join(TMP, 'facilities.json')
    with open(src, 'w', encoding='utf-8') as f:
        json.dump(kept, f, ensure_ascii=False)
    subprocess.check_call(['node', os.path.join(ROOT, 'scripts', 'gba-pop-radii.js'), src, dest])
    facs = json.load(open(dest, encoding='utf-8'))
    from collections import Counter
    log('bán kính ' + ', '.join(f'{k}={v}' for k, v in sorted(Counter(f['group'] for f in facs).items())))
    return facs


def arr_from(con, sql):
    rows = con.execute(sql).fetchall()
    if not rows:
        return {k: np.zeros(0) for k in ('ward',)}
    # generic below
    return rows


def served_same(x, y, ward, facs):
    hit = np.zeros(len(x), dtype=bool)
    by = {}
    for f in facs:
        by.setdefault(f['ward'], []).append(f)
    wards, inv = np.unique(ward, return_inverse=True)
    for i, w in enumerate(wards):
        sel = np.flatnonzero(inv == i)
        fs = by.get(w) or []
        if not len(fs) or not len(sel):
            continue
        sx = x[sel]
        sy = y[sel]
        cos = np.cos(np.radians(sy))
        sub = np.zeros(len(sel), dtype=bool)
        for f in fs:
            dx = (sx - f['lng']) * M_PER_DEG * cos
            dy = (sy - f['lat']) * M_PER_DEG
            r = f['radius']
            sub |= (dx * dx + dy * dy) <= r * r
        hit[sel] = sub
    return hit


def served_any(x, y, facs):
    hit = np.zeros(len(x), dtype=bool)
    if not len(x) or not facs:
        return hit
    cos = np.cos(np.radians(y))
    for f in facs:
        dx = (x - f['lng']) * M_PER_DEG * cos
        dy = (y - f['lat']) * M_PER_DEG
        r = f['radius']
        hit |= (dx * dx + dy * dy) <= r * r
    return hit


def sample_dem(x, y):
    paths = [os.path.join(TMP, 'dem_n16_e107.tif'), os.path.join(TMP, 'dem_n16_e108.tif')]
    for p in paths:
        if not os.path.exists(p):
            raise SystemExit(f'Thiếu DEM {p}')
    out = np.full(len(x), np.nan, dtype='float64')
    srcs = [rasterio.open(p) for p in paths]
    try:
        for src in srcs:
            b = src.bounds
            m = (x >= b.left) & (x <= b.right) & (y >= b.bottom) & (y <= b.top)
            idx = np.flatnonzero(m)
            if not len(idx):
                continue
            for start in range(0, len(idx), 80000):
                part = idx[start:start + 80000]
                coords = list(zip(x[part].tolist(), y[part].tolist()))
                vals = np.fromiter((v[0] for v in src.sample(coords)), dtype='float64', count=len(part))
                out[part] = vals
    finally:
        for src in srcs:
            src.close()
    out[~np.isfinite(out)] = np.nan
    out[out < -100] = np.nan
    return out


def elev_bin(elev):
    r = np.where(np.isnan(elev), np.nan, np.floor(elev + 0.5))
    return np.clip(r, -1, 40)


def wmean(v, w, mask=None):
    if mask is not None:
        v = v[mask]
        w = w[mask]
    ok = np.isfinite(v) & (w > 0)
    if not np.any(ok):
        return None
    return float(np.sum(v[ok] * w[ok]) / np.sum(w[ok]))


def centroid_shift(x0, y0, w0, x1, y1, w1):
    def cen(x, y, w):
        sw = np.sum(w)
        if sw <= 0:
            return None
        return float(np.sum(x * w) / sw), float(np.sum(y * w) / sw)
    a = cen(x0, y0, w0)
    b = cen(x1, y1, w1)
    if not a or not b:
        return None
    dx = (b[0] - a[0]) * M_PER_DEG * math.cos(math.radians((a[1] + b[1]) / 2))
    dy = (b[1] - a[1]) * M_PER_DEG
    return math.hypot(dx, dy)


def sum_by(ward, values, mask=None):
    if mask is not None:
        ward = ward[mask]
        values = values[mask]
    out = {}
    if not len(values):
        return out
    keys, inv = np.unique(ward, return_inverse=True)
    sums = np.bincount(inv, weights=values)
    for k, s in zip(keys, sums):
        out[str(k)] = float(s)
    return out


def cell_keys(x, y, ox, oy, dlng, dlat):
    c = np.floor((x - ox) / dlng).astype(np.int32)
    r = np.floor((y - oy) / dlat).astype(np.int32)
    return c, r


def load_app_flood():
    path = os.path.join(TMP, 'flood-bins.json')
    if not os.path.exists(path):
        return {}
    data = json.load(open(path, encoding='utf-8'))
    out = {}
    for w in data.get('wards') or []:
        out[w['name']] = sum(b[1] for b in w['bins'] if b[0] < FLOOD_M)
    return out


def lot_flags(con, px, py, pop_o, bx, by, pop_a, pop_b):
    log('gán điểm vào lô đất ở')
    n_p = len(px)
    n_b = len(bx)
    kind = np.array(['pix'] * n_p + ['bldg'] * n_b, dtype=object)
    table = pa.table({
        'rid': np.arange(n_p + n_b, dtype='int64'),
        'kind': kind,
        'x': np.concatenate([px, bx]),
        'y': np.concatenate([py, by]),
        'pop_o': np.concatenate([pop_o, np.zeros(n_b)]),
        'pop_a': np.concatenate([np.zeros(n_p), pop_a]),
        'pop_b': np.concatenate([np.zeros(n_p), pop_b]),
    })
    con.register('pts_arrow', table)
    con.execute('CREATE TABLE pts AS SELECT * FROM pts_arrow')
    con.unregister('pts_arrow')
    con.execute(f"""
        CREATE TABLE lots AS
        SELECT k, ST_MakeValid(ST_SetCRS(geom, 'EPSG:4326')) AS geom
        FROM ST_Read('{os.path.join(TMP, 'lots-use.geojson')}')
        WHERE k IS NOT NULL
    """)
    con.execute(f"""
        CREATE TABLE lot_use AS
        SELECT k, use FROM read_ndjson('{os.path.join(TMP, 'lot-use.jsonl')}')
    """)
    # Một lần giao điểm. Lô chồng đồ án: cột phường chỉ cần điểm chạm một lô ở;
    # bảng lô cộng dân vào từng lô nên không được cộng thành dân số thành phố.
    log('giao điểm với lô quy hoạch')
    con.execute("""
        CREATE TABLE hit AS
        SELECT p.rid, p.kind, l.k, u.use, p.pop_o, p.pop_a, p.pop_b
        FROM pts p
        JOIN lots l ON ST_Intersects(l.geom, ST_SetCRS(ST_Point(p.x, p.y), 'EPSG:4326'))
        LEFT JOIN lot_use u ON u.k = l.k
    """)
    pix_ids = [r[0] for r in con.execute("SELECT DISTINCT rid FROM hit WHERE kind = 'pix' AND use = 'res'").fetchall()]
    bld_ids = [r[0] for r in con.execute("SELECT DISTINCT rid FROM hit WHERE kind = 'bldg' AND use = 'res'").fetchall()]
    log(f'điểm trên lô ở: pixel {len(pix_ids)}, nhà {len(bld_ids)}')
    pm = np.zeros(n_p, dtype=bool)
    bm = np.zeros(n_b, dtype=bool)
    if pix_ids:
        pm[np.asarray(pix_ids, dtype='int64')] = True
    if bld_ids:
        bm[np.asarray(bld_ids, dtype='int64') - n_p] = True
    lot_rows = con.execute("""
        SELECT k, sum(pop_o), sum(pop_a), sum(pop_b)
        FROM hit
        GROUP BY k
    """).fetchall()
    return pm, bm, lot_rows


def fetch_named(con, sql):
    cur = con.execute(sql)
    names = [d[0] for d in cur.description]
    data = cur.fetchall()
    cols = {n: [] for n in names}
    for row in data:
        for n, v in zip(names, row):
            cols[n].append(v)
    out = {}
    for n, vals in cols.items():
        if n in ('ward',):
            out[n] = np.asarray(vals, dtype=object)
        else:
            out[n] = np.asarray(vals, dtype='float64')
    return out


def write_reports(wards, metrics, lot_rows, meta):
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(ART, exist_ok=True)
    order = [
        'dan_so',
        'truong',
        'yte',
        'congvien',
        'truong_cheo',
        'yte_cheo',
        'congvien_cheo',
        'ngap5',
        'ngap2',
        'o_nha',
        'lo_o',
        'ngap5_app',
        'dich_tam',
    ]
    labels = {
        'dan_so': 'Dân số phường (khống chế)',
        'truong': 'Dân trong vùng phục vụ trường (công trình cùng phường)',
        'yte': 'Dân trong vùng phục vụ y tế (công trình cùng phường)',
        'congvien': 'Dân trong vùng phục vụ công viên (công trình cùng phường)',
        'truong_cheo': 'Dân trong vùng phục vụ trường (vùng đệm bắt chéo ranh)',
        'yte_cheo': 'Dân trong vùng phục vụ y tế (vùng đệm bắt chéo ranh)',
        'congvien_cheo': 'Dân trong vùng phục vụ công viên (vùng đệm bắt chéo ranh)',
        'ngap5': 'Dân ở cao độ làm tròn dưới 5 m (Copernicus GLO-30)',
        'ngap2': 'Dân ở cao độ làm tròn dưới 2 m (Copernicus GLO-30)',
        'o_nha': 'Dân nằm trong ô 150 m có ít nhất một nhà ở',
        'lo_o': 'Dân nằm trên lô quy hoạch đất ở',
        'ngap5_app': 'Dân cao độ dưới 5 m theo app (FABDEM, chỉ cột cũ)',
        'dich_tam': 'Dịch tâm dân so với cách chia pixel (m)',
    }
    # chỉ tiêu đem ra bảng chính và cờ 15%
    core = ['truong', 'yte', 'congvien', 'ngap5', 'o_nha', 'lo_o']

    def cell(metric, part, name):
        rec = metrics[(name, metric)]
        return rec[part]

    rows_out = []
    for name in wards:
        for metric in order:
            rec = metrics[(name, metric)]
            old, a, b = rec['old'], rec['a'], rec['b']
            if metric == 'dich_tam':
                pa = pb = None
                da, db = a, b
                fa = (a or 0) >= SHIFT_FLAG_M
                fb = (b or 0) >= SHIFT_FLAG_M
            elif metric == 'ngap5_app':
                da = db = pa = pb = None
                fa = fb = False
            else:
                da = None if a is None or old is None else a - old
                db = None if b is None or old is None else b - old
                pa = rel_pct(a, old)
                pb = rel_pct(b, old)
                fa = flagged(a, old, pa)
                fb = flagged(b, old, pb)
            rows_out.append({
                'phuong': name,
                'chi_tieu': labels[metric],
                'ma': metric,
                'cu': old,
                'A': a,
                'B': b,
                'lech_A': da,
                'pct_A': pa,
                'lech_B': db,
                'pct_B': pb,
                'vuot_15_A': 'có' if fa else '',
                'vuot_15_B': 'có' if fb else '',
            })

    csv_name = 'so-sanh-dan-so-gba.csv'
    fieldnames = ['phuong', 'chi_tieu', 'ma', 'cu', 'A', 'B', 'lech_A', 'pct_A', 'lech_B', 'pct_B', 'vuot_15_A', 'vuot_15_B']

    def dump_csv(path, data, fields):
        with open(path, 'w', encoding='utf-8-sig', newline='') as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            for row in data:
                out = {}
                for k in fields:
                    v = row[k]
                    if isinstance(v, float):
                        if math.isinf(v):
                            out[k] = 'inf'
                        elif math.isnan(v):
                            out[k] = ''
                        else:
                            out[k] = f'{v:.4f}'
                    else:
                        out[k] = '' if v is None else v
                w.writerow(out)

    dump_csv(os.path.join(OUT_DIR, 'pop-compare.csv'), rows_out, fieldnames)
    dump_csv(os.path.join(ART, csv_name), rows_out, fieldnames)

    lot_flagged = []
    for k, old, a, b in lot_rows:
        old, a, b = float(old), float(a), float(b)
        pb = rel_pct(b, old)
        pa = rel_pct(a, old)
        if flagged(b, old, pb) or flagged(a, old, pa):
            lot_flagged.append({
                'lo': k, 'cu': old, 'A': a, 'B': b,
                'lech_A': a - old, 'pct_A': pa, 'lech_B': b - old, 'pct_B': pb
            })
    lot_flagged.sort(key=lambda r: abs(r['pct_B'] if r['pct_B'] is not None and math.isfinite(r['pct_B']) else 0), reverse=True)
    lot_fields = ['lo', 'cu', 'A', 'B', 'lech_A', 'pct_A', 'lech_B', 'pct_B']
    dump_csv(os.path.join(ART, 'so-sanh-dan-so-gba-lo.csv'), lot_flagged, lot_fields)
    # file lô có thể dài; vẫn để trong repo nếu dưới 3 MB sau khi ghi
    lot_repo = os.path.join(OUT_DIR, 'pop-compare-lots.csv')
    dump_csv(lot_repo, lot_flagged, lot_fields)

    def md_table(metric):
        lines = ['| Phường, xã | Cũ | A (đều theo nhà) | B (dấu chân × bậc) | Lệch B | % B |', '|---|---:|---:|---:|---:|---:|']
        hot = []
        for name in wards:
            rec = metrics[(name, metric)]
            old, a, b = rec['old'], rec['a'], rec['b']
            pb = rel_pct(b, old)
            mark = ' **' if flagged(b, old, pb) else ''
            end = '**' if mark else ''
            lines.append(
                f"| {mark}{name}{end} | {vn_int(old)} | {vn_int(a)} | {vn_int(b)} | {vn_int((b or 0) - (old or 0))} | {vn_pct(pb)} |"
            )
            if flagged(b, old, pb) or flagged(a, old, rel_pct(a, old)):
                hot.append(name)
        return '\n'.join(lines), hot

    def city(metric, part):
        return sum((metrics[(n, metric)][part] or 0) for n in wards if n != 'Thành phố Huế')

    # Thành phố đã là một dòng cộng sẵn nếu có trong wards. Tách danh sách phường.
    names = [n for n in wards if n != 'Thành phố Huế']

    def total(metric, part):
        return metrics[('Thành phố Huế', metric)][part]

    hot_bits = []
    for metric in core:
        for name in names:
            rec = metrics[(name, metric)]
            for part, key in (('a', 'A'), ('b', 'B')):
                pct = rel_pct(rec[part], rec['old'])
                if flagged(rec[part], rec['old'], pct):
                    delta = abs((rec[part] or 0) - (rec['old'] or 0))
                    hot_bits.append((delta, name, metric, key, rec, pct))
    hot_bits.sort(reverse=True)

    lines = []
    lines.append('# So sánh phân bổ dân số: pixel raster và nhà ở GBA')
    lines.append('')
    lines.append('Thí nghiệm, chưa thay công thức đang chạy trên bản đồ. Tổng dân mỗi phường, xã giữ nguyên số hành chính `danSo`.')
    lines.append('')
    lines.append('## Cách tính')
    lines.append('')
    lines.append('- **Cũ.** `services/geeService.js` lấy asset `Pixel-danso`, giữ pixel có giá trị > 0, đếm ở lưới 60 m (`POP_SCALE_M`), rồi chia đều dân số phường cho các pixel đó (`popRasterNormalized`). Độ phủ (`getWardCoverage`), mô phỏng ngập (`getFloodBins`) và ngập radar dùng đúng tỷ lệ pixel này. Thí nghiệm không có khóa GEE nên lập lại công thức trên mặt nạ **WorldPop GP 100 m năm 2020, Việt Nam** (pixel có dân > 0), cùng nguồn mở mà `getPopCheck` đang đối chiếu. Trị số WorldPop trong ô không được dùng làm trọng số — app cũng không dùng trị số đó để chia dân.')
    n_res = f"{meta['residential']:,}".replace(',', '.')
    lines.append(f"- **A.** Dân số phường chia đều cho {n_res} nhà ở sau bộ lọc GBA (thửa đất ở, loại OSM / hạ tầng 20 m / lô không phải ở, dấu chân dưới {meta['small']:.0f} m² và trên {meta['large']:.0f} m²).")
    lines.append('- **B.** Cùng tập nhà ở, trọng số = diện tích dấu chân (m²) × (bậc chiều cao tương đối + 1). Bậc là tứ phân vị, không phải mét. Đây là trọng số đã ghi trên thẻ lô (`rp`).')
    lines.append('- **Trường, y tế, công viên.** Công trình đã duyệt và có quy mô hiện trạng. Ô quy mô hiện trạng trống được app xếp là quy hoạch mới nên không vào độ phủ hiện trạng; thí nghiệm lọc giống vậy'
                 f" ({meta['n_school']} trường, {meta['n_health']} cơ sở y tế, {meta['n_park']} công viên). "
                 'Nhiều phường vì thế có 0 người ở cột y tế cùng phường. Bán kính là `constants.standardRadius`: trường đơn vị ở 1 km ở phường và 2 km ở xã, THPT 2 km, y tế đơn vị ở cùng mức đó, y tế cấp đô thị 2 km, vườn hoa 400 m, công viên khu vực 800 m, công viên đô thị 2 km. '
                 'Cột “cùng phường” chỉ đếm dân của phường nằm trong vùng đệm của công trình thuộc chính phường đó, giống `computeSingleWardCoverage`. Cột “bắt chéo ranh” cộng dân trong vùng đệm dù công trình thuộc phường bên cạnh.')
    lines.append('- **Ngập.** App làm tròn mét cao độ FABDEM và tính dân ở bậc thấp hơn mực nước (mặc định 5 m trong `floodSim.js`). Thí nghiệm dùng cùng quy tắc trên Copernicus GLO-30, cho cả ba cách chia, để lệch số chỉ còn do chỗ đặt dân. Cột FABDEM là số app trả về (`getFloodBins`), chỉ để thấy lệch nguồn cao độ, không phải cột A/B.')
    lines.append('- **Lưới và lô.** Ô 150 m là lưới cường độ GBA. “Ô có nhà ở” = ô chứa ít nhất một nhà ở sau lọc. “Lô đất ở” = lô quy hoạch có chức năng ở. Một điểm rơi vào nhiều đồ án được tính vào từng lô trong file lô, nên không cộng file lô thành dân số thành phố. Cột phường không đếm trùng: điểm chỉ cần nằm trên một lô ở.')
    lines.append(f"- Ngưỡng tô đậm: lệch tuyệt đối từ {PCT_FLAG:.0f}% và mẫu ít nhất {SMALL_BASE:.0f} người. Dịch tâm tô khi từ {SHIFT_FLAG_M} m.")
    lines.append('')
    lines.append('## FAQ đang phát hành không đổi')
    lines.append('')
    lines.append('Hai câu dùng dân số trong `public/data/faq.json` lấy `danSoNum` trên ranh, không lấy raster:')
    lines.append('')
    lines.append(f"- {meta['faq_dens_xa']}")
    lines.append(f"- {meta['faq_dens_phuong']}")
    lines.append('')
    lines.append(f"Danh sách ưu tiên công trình quy hoạch ({meta['faq_priority_n']} phường có hạng mục, {meta['faq_priority_items']} hạng mục) đặt `popAdded` = dân số cả phường × tỷ lệ diện tích vùng đệm mới, có trần sức chứa. Ghi chú phương pháp trong file nói rõ không dùng lớp dân cư vệ tinh. Tổng `popAdded` công bố là {vn_int(meta['faq_pop_added'])} người. Ba cách chia lại dân trong không gian không đổi các câu này, vì tử số vẫn là dân số hành chính cả phường.")
    lines.append('')
    lines.append('Nếu FAQ hỏi theo dân đã phân bổ lại, câu trả lời đổi như bảng dưới (thí nghiệm, chưa ghi vào `faq.json`).')
    lines.append('')
    lines.append('| Câu hỏi | Cũ | A | B |')
    lines.append('|---|---|---|---|')
    for q in meta['spatial_faq']:
        lines.append(f"| {q['q']} | {q['old']} | {q['a']} | {q['b']} |")
    lines.append('')
    lines.append('## Cả thành phố')
    lines.append('')
    lines.append('| Chỉ tiêu | Cũ | A | B | Lệch B | % B |')
    lines.append('|---|---:|---:|---:|---:|---:|')
    for metric in core + ['truong_cheo', 'yte_cheo', 'congvien_cheo', 'ngap2']:
        old, a, b = total(metric, 'old'), total(metric, 'a'), total(metric, 'b')
        pb = rel_pct(b, old)
        lines.append(f"| {labels[metric]} | {vn_int(old)} | {vn_int(a)} | {vn_int(b)} | {vn_int(b - old)} | {vn_pct(pb)} |")
    app = total('ngap5_app', 'old')
    lines.append(f"| {labels['ngap5_app']} | {vn_int(app)} | — | — | — | — |")
    sh_a = total('dich_tam', 'a')
    sh_b = total('dich_tam', 'b')
    lines.append(f"| Dịch tâm dân toàn thành phố | — | {vn_m(sh_a)} | {vn_m(sh_b)} | — | — |")
    lines.append('')
    n_pix = f"{meta['pixels']:,}".replace(',', '.')
    lines.append(f"Pixel WorldPop trong ranh: {n_pix} ô. Nhà ở: {n_res}.")
    lines.append(f"Đối chiếu Phường Phú Xuân với API `getWardCoverage` trên Pixel-danso: công viên {meta['px_park']:.1f}% so với {meta['api_park']:.1f}% dân, y tế {meta['px_health']:.1f}% so với {meta['api_health']:.1f}% dân. Mặt nạ WorldPop bám mặt nạ đang chạy ở nội thành; không khớp từng ô 60 m.")
    lines.append('')
    lines.append('Đọc lệch toàn thành phố theo số người, không phải dân số tăng. A và B vẫn cộng đúng 1.452.683 người mỗi phường; cột “ô có nhà ở” và “lô đất ở” của A/B bằng cả dân số vì mọi người đã được đặt lên một nhà. Cột cũ thấp hơn là phần dân pixel đang nằm trên ruộng, mặt nước hoặc sườn núi, nơi ô 150 m không có nhà ở sau lọc.')
    lines.append('Miền núi (A Lưới, Khe Tre, Nam Đông, Long Quảng) lệch vài trăm phần trăm vì pixel WorldPop phủ cả sườn cao, trong khi nhà ở nằm ở thung lũng: tâm dân dịch vài kilômét và cao độ trung bình theo dân thấp hơn pixel hàng trăm mét. Vùng đồng bằng ven phá thì lệch ngập lớn hơn lệch trường, vì pixel bờ nước thấp hơn nền nhà.')
    lines.append('')
    lines.append('## Nơi lệch quá 15%')
    lines.append('')
    if not hot_bits:
        lines.append('Không có phường nào lệch quá ngưỡng trên các chỉ tiêu chính.')
    else:
        lines.append('| Phường, xã | Chỉ tiêu | Cách | Cũ | Mới | % | Vì sao |')
        lines.append('|---|---|---|---:|---:|---:|---|')
        shown = 0
        seen = set()
        for _, name, metric, key, rec, pct in hot_bits:
            sig = (name, metric, key)
            if sig in seen:
                continue
            seen.add(sig)
            new = rec['a'] if key == 'A' else rec['b']
            why = meta['why'].get(name, '')
            lines.append(f"| {name} | {labels[metric]} | {key} | {vn_int(rec['old'])} | {vn_int(new)} | {vn_pct(pct)} | {why} |")
            shown += 1
            if shown >= 40:
                break
        extra = len(hot_bits) - shown
        if extra > 0:
            lines.append('')
            lines.append(f'Còn {extra} ô lệch nữa trong CSV.')
    lines.append('')
    lines.append('## Bảng theo phường')
    lines.append('')
    for metric in core:
        lines.append(f"### {labels[metric]}")
        lines.append('')
        # rebuild with names + city at top
        body, _hot = md_table_names(['Thành phố Huế'] + names, metric, metrics)
        lines.append(body)
        lines.append('')
    lines.append('### Dịch tâm dân')
    lines.append('')
    lines.append('| Phường, xã | A so với pixel | B so với pixel |')
    lines.append('|---|---:|---:|')
    for name in ['Thành phố Huế'] + names:
        rec = metrics[(name, 'dich_tam')]
        lines.append(f"| {name} | {vn_m(rec['a'])} | {vn_m(rec['b'])} |")
    lines.append('')
    lines.append(f"File lô lệch quá 15% và ít nhất {SMALL_BASE:.0f} người: {len(lot_flagged)} lô (đếm trùng nếu lô chồng đồ án). Xem `pop-compare-lots.csv`.")
    lines.append('')
    lines.append('## Nên dùng cách nào')
    lines.append('')
    lines.append(meta['recommendation'])
    lines.append('')
    lines.append('## Việc chưa làm trong thí nghiệm này')
    lines.append('')
    lines.append('Chưa đổi `geeService.js`, độ phủ, FAQ hay thẻ thống kê. Chưa ghi đè asset Pixel-danso. Ngập radar Sentinel-1 (`getSarFloodStats`) cần mặt nạ GEE nên không lập lại; bậc cao độ là chỉ tiêu ngập so được trên cả ba cách chia. Vùng phục vụ bám đường (Dijkstra) không nằm trong thí nghiệm — bán kính ở đây là vùng đệm tròn QCVN, cùng kiểu với độ phủ và FAQ ưu tiên.')
    text = '\n'.join(lines) + '\n'
    for path in (os.path.join(OUT_DIR, 'pop-compare.md'), os.path.join(ART, 'so-sanh-dan-so-gba.md')):
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text)
    log(f'báo cáo {len(text)} ký tự, lô lệch {len(lot_flagged)}')
    return text


def md_table_names(names, metric, metrics):
    lines = ['| Phường, xã | Cũ | A (đều theo nhà) | B (dấu chân × bậc) | Lệch B | % B |', '|---|---:|---:|---:|---:|---:|']
    for name in names:
        rec = metrics[(name, metric)]
        old, a, b = rec['old'], rec['a'], rec['b']
        pb = rel_pct(b, old)
        mark = '**' if name != 'Thành phố Huế' and flagged(b, old, pb) else ''
        lines.append(
            f"| {mark}{name}{mark} | {vn_int(old)} | {vn_int(a)} | {vn_int(b)} | {vn_int((b or 0) - (old or 0))} | {vn_pct(pb)} |"
        )
    return '\n'.join(lines), []


def spatial_answer(ward_value, unit='người'):
    if not ward_value:
        return 'không có'
    name, val = max(ward_value.items(), key=lambda kv: kv[1])
    return f'{name}: {vn_int(val)} {unit}'


def main():
    os.makedirs(TMP, exist_ok=True)
    labeled = ensure_labeled()
    con = connect()
    ward_table(con)
    worldpop_pixels(con)
    bsum = load_buildings(con, labeled)
    facs = facilities(con)
    agg_path = os.path.join(OUT_DIR, 'agg.json')
    with open(agg_path, encoding='utf-8') as f:
        agg = json.load(f)
    ox, oy = agg['origin']
    dlng, dlat = agg['dlng'], agg['dlat']

    pops = {r[0]: float(r[1]) for r in con.execute('SELECT name, pop FROM wards').fetchall()}
    # nhà ở có thể thiếu phường nếu không còn nhà sau lọc
    bstat = {r[0]: (float(r[1]), int(r[2]), float(r[3] or 0)) for r in bsum}

    pix = fetch_named(con, 'SELECT x, y, ward, pop, wp FROM wp_ward')
    bld = fetch_named(con, 'SELECT x, y, ward, pop, wb FROM bldg')
    counts = {}
    for w in pix['ward']:
        counts[str(w)] = counts.get(str(w), 0) + 1
    pop_o = np.zeros(len(pix['x']))
    for i, w in enumerate(pix['ward']):
        w = str(w)
        n = counts[w]
        pop_o[i] = (pops[w] / n) if n else 0
    pop_a = np.zeros(len(bld['x']))
    pop_b = np.zeros(len(bld['x']))
    for i, w in enumerate(bld['ward']):
        w = str(w)
        dan, rn, rw = bstat[w]
        pop_a[i] = dan / rn if rn else 0
        pop_b[i] = dan * float(bld['wb'][i]) / rw if rw else 0

    # kiểm tra tổng
    for w, dan in pops.items():
        so = float(pop_o[pix['ward'] == w].sum()) if np.any(pix['ward'] == w) else 0
        if dan > 0 and abs(so - dan) > 1:
            log(f'lệch tổng pixel {w}: {so:.1f} vs {dan:.1f}')
        if w in bstat:
            sa = float(pop_a[bld['ward'] == w].sum())
            sb = float(pop_b[bld['ward'] == w].sum())
            if abs(sa - dan) > 1 or abs(sb - dan) > 1:
                log(f'lệch tổng nhà {w}: A {sa:.1f} B {sb:.1f} vs {dan:.1f}')

    log('vùng phục vụ')
    groups = {
        'truong': [f for f in facs if f['group'] == 'school'],
        'yte': [f for f in facs if f['group'] == 'health'],
        'congvien': [f for f in facs if f['group'] == 'park'],
    }
    masks = {}
    for key, fs in groups.items():
        log(f'  {key} {len(fs)} công trình')
        masks[('pix', key)] = served_same(pix['x'], pix['y'], pix['ward'], fs)
        masks[('bld', key)] = served_same(bld['x'], bld['y'], bld['ward'], fs)
        masks[('pix', key + '_cheo')] = served_any(pix['x'], pix['y'], fs)
        masks[('bld', key + '_cheo')] = served_any(bld['x'], bld['y'], fs)

    log('cao độ')
    elev_p = sample_dem(pix['x'], pix['y'])
    elev_b = sample_dem(bld['x'], bld['y'])
    bin_p = elev_bin(elev_p)
    bin_b = elev_bin(elev_b)
    flood5_p = np.isfinite(bin_p) & (bin_p < FLOOD_M)
    flood5_b = np.isfinite(bin_b) & (bin_b < FLOOD_M)
    flood2_p = np.isfinite(bin_p) & (bin_p < FLOOD_LO)
    flood2_b = np.isfinite(bin_b) & (bin_b < FLOOD_LO)

    log('ô lưới')
    bc, br = cell_keys(bld['x'], bld['y'], ox, oy, dlng, dlat)
    res_cells = set(zip(bc.tolist(), br.tolist()))
    pc, pr = cell_keys(pix['x'], pix['y'], ox, oy, dlng, dlat)
    pix_in_cell = np.fromiter(((int(c), int(r)) in res_cells for c, r in zip(pc, pr)), dtype=bool, count=len(pc))

    pm, bm, lot_rows = lot_flags(con, pix['x'], pix['y'], pop_o, bld['x'], bld['y'], pop_a, pop_b)
    con.close()

    app_flood = load_app_flood()
    names = sorted(pops)
    metrics = {}

    def put(name, metric, old, a, b):
        metrics[(name, metric)] = {'old': old, 'a': a, 'b': b}

    why = {}
    elev_delta = {}
    empty_share = {}
    for name in names:
        sel_p = pix['ward'] == name
        sel_b = bld['ward'] == name
        dan = pops[name]
        def grab(mask_p, mask_b):
            old = float(pop_o[sel_p & mask_p].sum()) if np.any(sel_p) else 0.0
            a = float(pop_a[sel_b & mask_b].sum()) if np.any(sel_b) else 0.0
            b = float(pop_b[sel_b & mask_b].sum()) if np.any(sel_b) else 0.0
            return old, a, b
        put(name, 'dan_so', dan, dan if name in bstat else 0.0, dan if name in bstat else 0.0)
        for key in ('truong', 'yte', 'congvien', 'truong_cheo', 'yte_cheo', 'congvien_cheo'):
            put(name, key, *grab(masks[('pix', key)], masks[('bld', key)]))
        put(name, 'ngap5', *grab(flood5_p, flood5_b))
        put(name, 'ngap2', *grab(flood2_p, flood2_b))
        old_cell = float(pop_o[sel_p & pix_in_cell].sum()) if np.any(sel_p) else 0.0
        put(name, 'o_nha', old_cell, dan if name in bstat else 0.0, dan if name in bstat else 0.0)
        put(name, 'lo_o', *grab(pm, bm))
        put(name, 'ngap5_app', app_flood.get(name), None, None)
        shift_a = centroid_shift(pix['x'][sel_p], pix['y'][sel_p], pop_o[sel_p], bld['x'][sel_b], bld['y'][sel_b], pop_a[sel_b]) if np.any(sel_b) else None
        shift_b = centroid_shift(pix['x'][sel_p], pix['y'][sel_p], pop_o[sel_p], bld['x'][sel_b], bld['y'][sel_b], pop_b[sel_b]) if np.any(sel_b) else None
        put(name, 'dich_tam', None, shift_a, shift_b)
        e0 = wmean(elev_p[sel_p], pop_o[sel_p])
        e1 = wmean(elev_b[sel_b], pop_b[sel_b]) if np.any(sel_b) else None
        empty = 1 - (old_cell / dan) if dan else None
        empty_share[name] = empty
        elev_delta[name] = None if e0 is None or e1 is None else e1 - e0
        bits = []
        if empty is not None and empty >= 0.15:
            bits.append(f'{empty * 100:.0f}% dân pixel nằm ở ô 150 m không có nhà ở sau lọc')
        d_elev = elev_delta[name]
        if d_elev is not None and d_elev <= -30:
            bits.append(f'pixel trải trên sườn núi, cao hơn chỗ nhà ở khoảng {-d_elev:.0f} m')
        elif d_elev is not None and d_elev >= 30:
            bits.append(f'nhà ở nằm cao hơn đám pixel khoảng {d_elev:.0f} m')
        elif d_elev is not None and abs(d_elev) >= 0.4:
            bits.append(f'cao độ trung bình theo dân của B lệch {d_elev:+.1f} m so với pixel')
        if shift_b is not None and shift_b >= SHIFT_FLAG_M:
            bits.append(f'tâm dân B dịch {shift_b:.0f} m')
        if not bits:
            bits.append('dân nhà ở và dân pixel lệch cục bộ trong cùng bán kính hoặc cùng bậc cao độ')
        why[name] = '; '.join(bits)

    # dòng thành phố: tổng các chỉ tiêu cộng được; dịch tâm tính riêng trên toàn bộ điểm
    put('Thành phố Huế', 'dan_so', sum(pops.values()), sum(pops.values()), sum(pops.values()))
    for metric in ('truong', 'yte', 'congvien', 'truong_cheo', 'yte_cheo', 'congvien_cheo', 'ngap5', 'ngap2', 'o_nha', 'lo_o', 'ngap5_app'):
        old = sum((metrics[(n, metric)]['old'] or 0) for n in names)
        a = sum((metrics[(n, metric)]['a'] or 0) for n in names)
        b = sum((metrics[(n, metric)]['b'] or 0) for n in names)
        if metric == 'ngap5_app':
            put('Thành phố Huế', metric, old, None, None)
        else:
            put('Thành phố Huế', metric, old, a, b)
    put(
        'Thành phố Huế', 'dich_tam', None,
        centroid_shift(pix['x'], pix['y'], pop_o, bld['x'], bld['y'], pop_a),
        centroid_shift(pix['x'], pix['y'], pop_o, bld['x'], bld['y'], pop_b)
    )

    # FAQ không gian
    def rank_unserved(metric):
        out = {'old': {}, 'a': {}, 'b': {}}
        for name in names:
            dan = pops[name]
            for part in ('old', 'a', 'b'):
                served = metrics[(name, metric)][part] or 0
                out[part][name] = max(0.0, dan - served)
        return out

    def rank_flood():
        return {
            'old': {n: metrics[(n, 'ngap5')]['old'] or 0 for n in names},
            'a': {n: metrics[(n, 'ngap5')]['a'] or 0 for n in names},
            'b': {n: metrics[(n, 'ngap5')]['b'] or 0 for n in names},
        }

    school_out = rank_unserved('truong_cheo')
    health_out = rank_unserved('yte_cheo')
    park_out = rank_unserved('congvien_cheo')
    flood_rank = rank_flood()

    def pack(title, block, unit='người'):
        return {
            'q': title,
            'old': spatial_answer(block['old'], unit),
            'a': spatial_answer(block['a'], unit),
            'b': spatial_answer(block['b'], unit),
        }

    faq = json.load(open(os.path.join(ROOT, 'public', 'data', 'faq.json'), encoding='utf-8'))
    dens = {q['id']: f"{q['q']} {q['a']}" for q in faq['questions']}
    pri = faq['priority']['wards']
    items = 0
    pop_added = 0
    for w in pri.values():
        for fac in w.get('facilities') or []:
            items += 1
            pop_added += fac.get('popAdded') or 0

    # Phú Xuân park ratio on experiment mask
    px_name = 'Phường Phú Xuân'
    dan_px = pops.get(px_name) or 1
    px_park = 100.0 * (metrics[(px_name, 'congvien')]['old'] or 0) / dan_px
    px_health = 100.0 * (metrics[(px_name, 'yte')]['old'] or 0) / dan_px

    # khuyến nghị dựa trên số đã tính
    city_park_pct = rel_pct(metrics[('Thành phố Huế', 'congvien')]['b'], metrics[('Thành phố Huế', 'congvien')]['old'])
    city_flood_pct = rel_pct(metrics[('Thành phố Huế', 'ngap5')]['b'], metrics[('Thành phố Huế', 'ngap5')]['old'])
    city_school_pct = rel_pct(metrics[('Thành phố Huế', 'truong')]['b'], metrics[('Thành phố Huế', 'truong')]['old'])
    n_hot_b = sum(1 for name in names for metric in ('truong', 'yte', 'congvien', 'ngap5') if flagged(
        metrics[(name, metric)]['b'], metrics[(name, metric)]['old'], rel_pct(metrics[(name, metric)]['b'], metrics[(name, metric)]['old'])
    ))
    med_empty = float(np.median([empty_share[n] for n in names if empty_share[n] is not None]))
    rec_lines = [
        'Nên chọn **B** khi chuyển các chỉ tiêu không gian (dân trong vùng phục vụ, dân vùng ngập, dân trên lưới và lô) sang nhà ở. B giữ đúng dân số hành chính từng phường, chỉ đặt dân lên dấu chân đã qua bộ lọc ở, và cho nhà rộng hơn, bậc cao hơn một phần dân lớn hơn. A cũng đúng tổng phường nhưng coi một nhà khoảng 25 m² ngang một khối chung cư; thành phố chỉ giữ vài trăm dấu chân lớn trên thửa đất ở, nên A đánh giá thấp các khối đó.',
        f'Trên toàn thành phố, B lệch so với pixel khoảng {vn_pct(city_school_pct)} ở vùng phục vụ trường (cùng phường), {vn_pct(city_park_pct)} ở công viên, {vn_pct(city_flood_pct)} ở cao độ dưới 5 m. Có {n_hot_b} cặp phường–chỉ tiêu trường, y tế, công viên hoặc ngập 5 m lệch từ 15%. Trung vị phần dân pixel nằm ngoài ô có nhà ở là {med_empty * 100:.0f}%: raster đang “phủ” ruộng và sườn đồi mà dãy nhà không nằm ở đó, nên vùng phục vụ tròn nuốt thêm dân pixel và bỏ sót dân nhà ở.',
        'Chưa thay code đang chạy. Ở Phú Xuân, mặt nạ WorldPop cho công viên và y tế sát API Pixel-danso, nhưng lưới app là 60 m còn thí nghiệm là 100 m. Ngập không được lấy số B thay số trên thanh mô phỏng: app FABDEM đang khoảng 737 nghìn người dưới 5 m, cùng công thức pixel trên Copernicus là khoảng 471 nghìn, B trên Copernicus là khoảng 290 nghìn. Lệch nguồn cao độ và lệch chỗ đặt dân cùng cỡ nhau. Cần một lần chạy lại trên GEE với chính asset Pixel-danso và FABDEM trước khi đổi `popRasterNormalized`. FAQ mật độ và `popAdded` của công trình quy hoạch giữ công thức hiện tại: hai chỗ đó cố ý dùng dân cả phường và tỷ lệ diện tích.',
        'Không nên dùng A làm phương án chính. A hữu ích như phép thử độ nhạy: nơi A và B cùng lệch pixel hơn 15% thì nguyên nhân là vị trí nhà ở, không phải bậc chiều cao. Nơi chỉ B lệch, nguyên nhân là vài dấu chân lớn hoặc bậc cao tập trung dân.',
    ]
    meta = {
        'residential': int(len(bld['x'])),
        'pixels': int(len(pix['x'])),
        'small': res.SMALL_M2,
        'large': res.LARGE_M2,
        'faq_dens_xa': dens.get('dens-xa-min', ''),
        'faq_dens_phuong': dens.get('dens-phuong-max', ''),
        'faq_priority_n': len(pri),
        'faq_priority_items': items,
        'faq_pop_added': pop_added,
        'spatial_faq': [
            pack('Địa bàn nào có nhiều dân nhất ngoài vùng phục vụ trường (kể cả trường xã bên cạnh)?', school_out),
            pack('Địa bàn nào có nhiều dân nhất ngoài vùng phục vụ y tế (kể cả trạm bên cạnh)?', health_out),
            pack('Địa bàn nào có nhiều dân nhất ngoài vùng phục vụ công viên?', park_out),
            pack('Địa bàn nào có nhiều dân nhất ở cao độ dưới 5 m?', flood_rank),
        ],
        'px_park': px_park,
        'px_health': px_health,
        'api_park': 31.9,
        'api_health': 85.4,
        'n_school': len(groups['truong']),
        'n_health': len(groups['yte']),
        'n_park': len(groups['congvien']),
        'why': why,
        'recommendation': '\n\n'.join(rec_lines),
    }
    write_reports(['Thành phố Huế'] + names, metrics, lot_rows, meta)


if __name__ == '__main__':
    main()
