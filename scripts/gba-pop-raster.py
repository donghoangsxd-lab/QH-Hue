#!/usr/bin/env python3
# Bảng điểm dân số phương pháp B để nạp asset GEE Pixel-danso-nha.
# Mỗi dòng là một điểm: phần dân số phường còn lại sau khi trừ chung cư,
# chia theo trọng số dấu chân nhà ở × (bậc chiều cao tương đối + 1).
# Điểm chạm thửa NTD bị loại (NTD thắng ODT/ONT). Chung cư là điểm riêng.
#   python3 scripts/gba-pop-raster.py

import csv
import gzip
import json
import os

import duckdb
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.environ.get('GBA_TMP', '/tmp/gba')
OUT_DIR = os.path.join(ROOT, 'public', 'data', 'gba')


def main():
    apt = json.load(open(os.path.join(OUT_DIR, 'apartments.json'), encoding='utf-8'))
    items = apt.get('items') or []
    con = duckdb.connect()
    con.execute('LOAD spatial')
    con.execute('SET threads=2')
    con.execute("SET memory_limit='3GB'")

    con.execute(f"""
        CREATE TABLE ntd AS
        SELECT ST_MakeValid(ST_SetCRS(ST_GeomFromGeoJSON(to_json(geometry)::VARCHAR), 'EPSG:4326')) AS geom
        FROM read_ndjson('{os.path.join(TMP, 'ntd.jsonl')}', columns={{'l': 'VARCHAR', 'geometry': 'JSON'}})
    """)
    con.execute('CREATE INDEX ntd_rt ON ntd USING RTREE (geom)')
    con.execute(f"""
        CREATE TABLE b AS
        SELECT id, ward, pop, area_m2, cls, x, y, wb
        FROM read_parquet('{os.path.join(TMP, 'labeled.parquet')}')
        WHERE residential AND wb > 0
    """)
    n0 = con.execute('SELECT count(*) FROM b').fetchone()[0]
    con.execute("""
        DELETE FROM b
        WHERE EXISTS (
            SELECT 1 FROM ntd g
            WHERE ST_Intersects(g.geom, ST_Point(b.x, b.y))
        )
    """)
    n1 = con.execute('SELECT count(*) FROM b').fetchone()[0]
    print(f'nhà ở {n0}, bỏ NTD {n0 - n1}, còn {n1}')

    rows = con.execute('SELECT id, ward, pop, area_m2, cls, x, y, wb FROM b').fetchall()
    ward = np.array([r[1] for r in rows])
    pop = np.array([r[2] for r in rows], dtype='float64')
    area = np.array([r[3] for r in rows], dtype='float64')
    cls = np.array([r[4] for r in rows], dtype='int64')
    x = np.array([r[5] for r in rows], dtype='float64')
    y = np.array([r[6] for r in rows], dtype='float64')
    wb = np.array([r[7] for r in rows], dtype='float64')

    # Chỉ dấu chân nằm trong ranh chung cư hiện trạng (có polygon) rời khỏi nhà thấp tầng.
    drop_ids = set()
    geoms = []
    for it in items:
        if it.get('status') == 'quy_hoach' or not it.get('geometry'):
            continue
        if float(it.get('pop') or 0) <= 0:
            continue
        geoms.append(json.dumps(it['geometry']))
    if geoms:
        con.execute('CREATE TABLE apt (geom GEOMETRY)')
        con.executemany(
            "INSERT INTO apt VALUES (ST_MakeValid(ST_SetCRS(ST_GeomFromGeoJSON(?), 'EPSG:4326')))",
            [(g,) for g in geoms]
        )
        drop_ids = {r[0] for r in con.execute("""
            SELECT b.id FROM b
            WHERE EXISTS (
                SELECT 1 FROM apt g
                WHERE ST_Intersects(g.geom, ST_SetCRS(ST_Point(b.x, b.y), 'EPSG:4326'))
            )
        """).fetchall()}
    ids = np.array([r[0] for r in rows])
    drop = np.isin(ids, np.fromiter(drop_ids, dtype='int64', count=len(drop_ids))) if drop_ids else np.zeros(len(rows), dtype=bool)
    print(f'bỏ dấu chân trong ranh chung cư hiện trạng {int(drop.sum())} / {len(geoms)} khu')
    keep = ~drop

    apt_pop = {}
    for it in items:
        if it.get('status') == 'quy_hoach':
            continue
        apt_pop[it['ward']] = apt_pop.get(it['ward'], 0.0) + float(it.get('pop') or 0)

    out_rows = []
    people = 0.0
    names = set(ward.tolist()) | {it['ward'] for it in items}
    for name in sorted(names):
        m = (ward == name) & keep
        official = float(pop[m][0]) if np.any(m) else 0.0
        remain = max(0.0, official - apt_pop.get(name, 0.0))
        tw = float(wb[m].sum())
        if tw > 0 and remain > 0:
            share = remain * wb[m] / tw
            for lng, lat, p in zip(x[m], y[m], share):
                if p < 0.0005:
                    continue
                out_rows.append((float(lng), float(lat), float(p)))
                people += float(p)
        for it in items:
            if it['ward'] != name:
                continue
            p = float(it.get('pop') or 0)
            if p <= 0:
                continue
            out_rows.append((float(it['lng']), float(it['lat']), p))
            people += p

    os.makedirs(OUT_DIR, exist_ok=True)
    gz_path = os.path.join(OUT_DIR, 'pop-weights.csv.gz')
    with gzip.open(gz_path, 'wt', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['longitude', 'latitude', 'people'])
        for lng, lat, p in out_rows:
            w.writerow([f'{lng:.6f}', f'{lat:.6f}', f'{p:.4f}'])
    manifest = {
        'v': 1,
        'asset': 'projects/optimistic-yew-488501-s0/assets/Pixel-danso-nha',
        'table': 'projects/optimistic-yew-488501-s0/assets/Pixel-danso-nha-diem',
        'gcs': 'gba/pop-weights.csv',
        'rows': len(out_rows),
        'people': round(people, 1),
        'droppedNtd': int(n0 - n1),
        'droppedAptFootprints': int(drop.sum()),
        'note': 'Điểm nhà ở: dân số phường trừ nhà ở xã hội đã hoàn thành, chia theo diện tích dấu chân × (bậc tương đối + 1). Điểm chạm NTD đã bỏ. Khu quy hoạch không trừ. Chung cư có số dân là điểm riêng.'
    }
    with open(os.path.join(OUT_DIR, 'pop-nha.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f'{len(out_rows)} điểm, {people:,.1f} người, {os.path.getsize(gz_path)/1e6:.1f} MB gz')


if __name__ == '__main__':
    main()
