#!/usr/bin/env python3
# Nền nhà thấp tầng cho asset GEE Pixel-danso-nha. Nạp một lần.
# Mỗi dấu chân nhà ở (trừ thửa NTD) nhận một phần dân số phường theo diện tích × (bậc + 1).
# Không trừ chung cư và không ghi điểm chung cư: tab NOXH được gắn lúc chạy.
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

    # Giữ mọi dấu chân nhà ở còn lại, kể cả mái nằm trong ranh chung cư.
    # Dân phường chia hết cho các dấu chân này. Chung cư gắn lúc chạy từ tab NOXH.
    out_rows = []
    people = 0.0
    peak = 0.0
    for name in sorted(set(ward.tolist())):
        m = ward == name
        official = float(pop[m][0]) if np.any(m) else 0.0
        tw = float(wb[m].sum())
        if tw <= 0 or official <= 0:
            continue
        share = official * wb[m] / tw
        for lng, lat, p in zip(x[m], y[m], share):
            if p < 0.0005:
                continue
            out_rows.append((float(lng), float(lat), float(p)))
            people += float(p)
            if p > peak:
                peak = float(p)

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
        'droppedAptFootprints': 0,
        'base': 'lowrise',
        'note': 'Nền nhà thấp tầng nạp một lần: mọi dấu chân nhà ở trừ thửa NTD, dân số phường chia theo diện tích × (bậc tương đối + 1). Không trừ chung cư và không ghi điểm chung cư. Tab NOXH gắn lúc chạy.'
    }
    with open(os.path.join(OUT_DIR, 'pop-nha.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f'{len(out_rows)} điểm, {people:,.1f} người, điểm lớn nhất {peak:,.1f}, {os.path.getsize(gz_path)/1e6:.1f} MB gz')


if __name__ == '__main__':
    main()
