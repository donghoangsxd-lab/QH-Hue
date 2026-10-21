#!/usr/bin/env python3
# Chiều cao mét. Nền là bldg_attr (cùng lọc var với buildings.pmtiles).
# Chỗ GBA mất tháp hoặc ước quá thấp: bldg-overrides.geojson
# (OSM height, OSM building:levels × 3,3, hoặc số mét / số tầng đã công bố).
# h làm tròn 0,5 m, f = round(h / 3,3).
# Không hạ gai đối với công trình đã có trong bảng overrides.
#   GBA_DUCK=/tmp/gba/screen.duck python3 scripts/build-bldg-hf.py

import json
import math
import os
import struct
from collections import defaultdict

from shapely.geometry import Point, shape
from shapely.ops import unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'data', 'gba', 'bldg-hf.bin')
META = os.path.join(ROOT, 'public', 'data', 'gba', 'bldg-hf.json')
DUCK = os.environ.get('GBA_DUCK', '/tmp/gba/screen.duck')
OVERRIDES = os.path.join(ROOT, 'public', 'data', 'gba', 'bldg-overrides.geojson')
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


def ring_area_m2(geom):
    g = geom
    if g.geom_type == 'GeometryCollection':
        g = unary_union(g)
    lat = g.centroid.y
    m_lng = 111320.0 * math.cos(math.radians(lat))
    m_lat = 110540.0

    def one(poly):
        ring = list(poly.exterior.coords)
        s = 0.0
        for i in range(len(ring) - 1):
            x1, y1 = ring[i][0] * m_lng, ring[i][1] * m_lat
            x2, y2 = ring[i + 1][0] * m_lng, ring[i + 1][1] * m_lat
            s += x1 * y2 - x2 * y1
        holes = 0.0
        for hole in poly.interiors:
            hr = list(hole.coords)
            hs = 0.0
            for i in range(len(hr) - 1):
                x1, y1 = hr[i][0] * m_lng, hr[i][1] * m_lat
                x2, y2 = hr[i + 1][0] * m_lng, hr[i + 1][1] * m_lat
                hs += x1 * y2 - x2 * y1
            holes += abs(hs) / 2.0
        return abs(s) / 2.0 - holes

    if g.geom_type == 'Polygon':
        return one(g)
    if g.geom_type == 'MultiPolygon':
        return sum(one(p) for p in g.geoms)
    return 0.0


def load_overrides():
    fc = json.load(open(OVERRIDES, encoding='utf-8'))
    out = []
    for feat in fc['features']:
        geom = shape(feat['geometry'])
        if not geom.is_valid:
            geom = geom.buffer(0)
        if geom.geom_type == 'MultiPolygon':
            parts = [p for p in geom.geoms if ring_area_m2(p) >= 80]
            geom = unary_union(parts) if parts else geom
        props = feat['properties']
        out.append((geom, props))
    return out


def dist_m(lng, lat, lng0, lat0):
    x = (lng - lng0) * 111320.0 * math.cos(math.radians(lat0))
    y = (lat - lat0) * 110540.0
    return math.hypot(x, y)


def main():
    import duckdb
    if not os.path.exists(DUCK):
        raise SystemExit(f'Thiếu {DUCK}')
    if not os.path.exists(OVERRIDES):
        raise SystemExit(f'Thiếu {OVERRIDES}')
    con = duckdb.connect(DUCK, read_only=True)
    raw = con.execute("""
        SELECT lng, lat, height, area_m2
        FROM bldg_attr
        WHERE height IS NOT NULL AND height > 0 AND lng IS NOT NULL AND lat IS NOT NULL
    """).fetchall()
    rows = [[float(lng), float(lat), float(height), float(area or 0), False, 'gba', ''] for lng, lat, height, area in raw]
    overrides = load_overrides()
    applied = []
    for geom, props in overrides:
        minx, miny, maxx, maxy = geom.bounds
        h_new = float(props['h'])
        min_area = float(props.get('minArea') or 0)
        draw = bool(props.get('draw'))
        source = props.get('source') or 'override'
        name = props.get('name') or ''
        hits = 0
        if not draw:
            for row in rows:
                if row[0] < minx or row[0] > maxx or row[1] < miny or row[1] > maxy:
                    continue
                if row[3] < min_area:
                    continue
                if not geom.covers(Point(row[0], row[1])):
                    continue
                if h_new > row[2] + 0.4:
                    row[2] = h_new
                    row[4] = True
                    row[5] = source
                    row[6] = name
                    hits += 1
        if draw:
            parts = list(geom.geoms) if geom.geom_type == 'MultiPolygon' else [geom]
            for part in parts:
                c = part.centroid
                rows.append([c.x, c.y, h_new, ring_area_m2(part), True, source, name])
                hits += 1
        applied.append({'id': props.get('id'), 'name': name, 'h': h_new, 'source': source, 'hits': hits, 'draw': draw})

    groups = defaultdict(list)
    resets = 0
    kept = []
    for lng, lat, height, area, locked, source, name in rows:
        h = float(height)
        if (not locked) and h >= SPIKE_H and area < SPIKE_AREA:
            h = SPIKE_TO
            resets += 1
            source = 'spike-reset'
        h = quant_h(h)
        f = floors_of(h)
        key, cx, cy = tile_of(lng, lat)
        groups[key].append((cx, cy, int(round(h * 2)), f))
        kept.append((lng, lat, h, f, area, source, name))
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
    cx0, cy0 = 107.5952, 16.4637
    near = [r for r in kept if dist_m(r[0], r[1], cx0, cy0) <= 1000]
    near.sort(key=lambda r: -r[2])
    # Mảnh mái của cùng một tháp (Imperial) gộp một dòng, lấy chiều cao lớn nhất.
    merged = {}
    order = []
    for r in near:
        key = r[6] or f'{r[0]:.5f},{r[1]:.5f}'
        if key not in merged:
            merged[key] = {
                'h': r[2], 'floors': r[3], 'areaM2': round(r[4]),
                'lng': round(r[0], 6), 'lat': round(r[1], 6),
                'source': r[5], 'name': r[6] or 'GBA'
            }
            order.append(key)
        else:
            merged[key]['areaM2'] += round(r[4])
    top = [merged[k] for k in order[:20]]
    meta = {
        'v': 3,
        'buildings': len(recs),
        'tiles': len(index),
        'hStepM': 0.5,
        'floorDiv': 3.3,
        'spikeResets': resets,
        'spikeRule': 'Dấu chân dưới 120 m² và cao từ 40 m đưa về 9 m, trừ công trình trong bldg-overrides.geojson.',
        'overrides': applied,
        'top20Within1kmHungVuong': top,
        'note': 'Nền là chiều cao GBA (mét). Tháp bị lọc var hoặc ước quá thấp lấy OSM height, OSM tầng × 3,3, hoặc số đã công bố. f = round(h / 3,3).'
    }
    with open(META, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False)
    print(json.dumps(meta, ensure_ascii=False), os.path.getsize(OUT))


if __name__ == '__main__':
    main()
