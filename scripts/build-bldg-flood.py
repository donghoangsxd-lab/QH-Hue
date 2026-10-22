#!/usr/bin/env python3
# Đếm nhà theo cao độ nền (FABDEM) và phường, để thanh mực nước giả định cộng số nhà ngập.
# Nhà có cao độ ≤ 0 coi là mặt nước thường xuyên, không đếm. Chỉ lưu bậc 0,5 m đến 15 m (trần thanh trượt).
# Chạy: python3 scripts/build-bldg-flood.py

import json
import os

import duckdb
import numpy as np
import rasterio

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.environ.get('GBA_DB', '/tmp/gba/screen.duck')
OUT = os.path.join(ROOT, 'public', 'data', 'gba', 'bldg-flood.json')
TIFS = ['/tmp/gba/dem_n16_e107.tif', '/tmp/gba/dem_n16_e108.tif']
STEP = 0.5
MAX_M = 15.0
BINS = int(MAX_M / STEP)


def sample(lng, lat, dems):
    out = np.full(len(lng), np.nan, dtype='float32')
    for ds, arr in dems:
        rows, cols = rasterio.transform.rowcol(ds.transform, lng, lat)
        rows = np.asarray(rows)
        cols = np.asarray(cols)
        ok = (rows >= 0) & (cols >= 0) & (rows < ds.height) & (cols < ds.width) & np.isnan(out)
        out[ok] = arr[rows[ok], cols[ok]]
    return out


def main():
    dems = []
    for path in TIFS:
        ds = rasterio.open(path)
        dems.append((ds, ds.read(1)))
    con = duckdb.connect(DB, read_only=True)
    con.execute('LOAD spatial')
    wards, lng, lat = [], [], []
    for name, x, y in con.execute("""
        SELECT coalesce(ward, 'Chưa rõ phường, xã'), lng, lat
        FROM bldg_attr
        WHERE lng IS NOT NULL AND lat IS NOT NULL
    """).fetchall():
        wards.append(name)
        lng.append(x)
        lat.append(y)
    con.close()
    elev = sample(np.asarray(lng), np.asarray(lat), dems)
    counts = {}
    used = 0
    for name, h in zip(wards, elev):
        if not np.isfinite(h) or h <= 0 or h >= MAX_M:
            continue
        slot = counts.setdefault(name, [0] * BINS)
        slot[int(h / STEP)] += 1
        used += 1
    rows = []
    for name in sorted(counts):
        bins = counts[name]
        rows.append({'name': name, 'n': int(sum(bins)), 'bins': bins})
    payload = {
        'v': 1,
        'step': STEP,
        'maxM': MAX_M,
        'buildings': used,
        'note': (
            'Số nhà có cao độ nền FABDEM lớn hơn 0 và thấp hơn mực nước trên thanh giả định. '
            'Cao độ lấy tại tâm dấu chân, bậc 0,5 m. Không phải kịch bản ngập có tên, không phải số dân.'
        ),
        'wards': rows
    }
    with open(OUT, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(',', ':'))
    at5 = 0
    for row in rows:
        at5 += sum(c for i, c in enumerate(row['bins']) if i * STEP < 5)
    print(f'nhà 0–15 m: {used}, dưới 5 m: {at5}, phường {len(rows)}, tệp {os.path.getsize(OUT)}')
    for ds, _arr in dems:
        ds.close()


if __name__ == '__main__':
    main()
