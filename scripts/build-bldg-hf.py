#!/usr/bin/env python3
# Chiều cao mét cho bản 3D. Nguồn: bảng bldg_attr (cùng lọc var và ranh với buildings.pmtiles)
# hoặc parquet GBA. h làm tròn 0,5 m, f = round(h / 3.3).
# Danh sách 293 tháp sai của máy dựng v2 không còn trên đĩa. Chỉ hạ các dấu chân
# dưới 120 m² mà cao từ 40 m (đỉnh gai, không phải nhà cao tầng).
#   GBA_DUCK=/tmp/gba/screen.duck python3 scripts/build-bldg-hf.py

import json
import math
import os
import struct
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'data', 'gba', 'bldg-hf.bin')
META = os.path.join(ROOT, 'public', 'data', 'gba', 'bldg-hf.json')
DUCK = os.environ.get('GBA_DUCK', '/tmp/gba/screen.duck')
Z = 16
N = 2 ** Z
EXT = 4096
SPIKE_H = 40.0
SPIKE_AREA = 120.0
SPIKE_TO = 9.0


def floors_of(h):
    return max(1, int(round(h / 3.3)))


def quant_h(h):
    return max(0.5, round(float(h) * 2) / 2.0)


def tile_of(lng, lat):
    xf = (lng + 180.0) / 360.0 * N
    s = math.sin(math.radians(lat))
    yf = (1.0 - math.log((1.0 + s) / (1.0 - s)) / (2.0 * math.pi)) * N / 2.0
    x = int(math.floor(xf))
    y = int(math.floor(yf))
    cx = int((xf - x) * EXT)
    cy = int((yf - y) * EXT)
    cx = min(EXT - 1, max(0, cx))
    cy = min(EXT - 1, max(0, cy))
    return x * 65536 + y, cx, cy


def main():
    import duckdb
    if not os.path.exists(DUCK):
        raise SystemExit(f'Thiếu {DUCK}')
    con = duckdb.connect(DUCK, read_only=True)
    rows = con.execute("""
        SELECT lng, lat, height, area_m2
        FROM bldg_attr
        WHERE height IS NOT NULL AND height > 0 AND lng IS NOT NULL AND lat IS NOT NULL
    """).fetchall()
    groups = defaultdict(list)
    resets = 0
    for lng, lat, height, area in rows:
        h = float(height)
        if h >= SPIKE_H and float(area or 0) < SPIKE_AREA:
            h = SPIKE_TO
            resets += 1
        h = quant_h(h)
        f = floors_of(h)
        key, cx, cy = tile_of(float(lng), float(lat))
        groups[key].append((cx, cy, int(round(h * 2)), f))
    keys = sorted(groups)
    recs = []
    index = []
    cursor = 0
    for key in keys:
        pts = groups[key]
        pts.sort()
        index.append((key, cursor, len(pts)))
        recs.extend(pts)
        cursor += len(pts)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'wb') as f:
        f.write(b'GBH2')
        f.write(struct.pack('<II', len(index), len(recs)))
        for key, start, count in index:
            f.write(struct.pack('<III', key, start, count))
        for cx, cy, h2, fl in recs:
            f.write(struct.pack('<HHHBB', cx, cy, h2, fl, 0))
    meta = {
        'v': 2,
        'buildings': len(recs),
        'tiles': len(index),
        'hStepM': 0.5,
        'floorDiv': 3.3,
        'spikeResets': resets,
        'spikeRule': 'Dấu chân dưới 120 m² và cao từ 40 m đưa về 9 m.',
        'note': 'Parquet GBA (google, osm, ms, ours2), cùng lọc var với PMTiles. Không có danh sách 293 tháp đã chỉnh khi dựng v2.'
    }
    with open(META, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False)
    print(json.dumps(meta, ensure_ascii=False), os.path.getsize(OUT))


if __name__ == '__main__':
    main()
