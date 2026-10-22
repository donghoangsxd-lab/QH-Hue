#!/usr/bin/env python3
# Suy luận khối đế và tháp cho nhà cao ở Huế.
# Mái GBA là đỉnh nhà, có thể lệch khỏi chân vì ảnh vệ tinh chụp nghiêng.
# Vectơ nghiêng (mét đông, mét bắc trên mỗi mét chiều cao) lấy từ các mốc
# vừa có polygon chân (OSM) vừa có mái cao: (tâm mái − tâm chân) / chiều cao thô.
# Dịch mái về chân bằng −lean × chiều cao. Hướng lấy trung vị các mốc.
# Đế là polygon chân (OSM) hoặc, khi mái đã là một khối nhỏ hơn đế, không trừ tháp khỏi đế.
# Khi mái GBA gần trùng đế mà công trình có số tầng đế đã công bố, trục tháp là
# vùng sáng hơn bên trong đế trên ảnh Esri z18 (phân vị 72, miền liên thông lớn nhất),
# rồi đơn giản hóa. Không chép nét phác tay.
# Nhà suy luận mới: draw=false, không labelFloors, nên không đổi số lô vượt mật độ.
# Chạy: python3 scripts/infer-tower-podium.py

import json
import math
import os
import subprocess
import urllib.request
from io import BytesIO

import duckdb
import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import MultiPoint, Point, Polygon, shape
from shapely.ops import transform

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OV_PATH = os.path.join(ROOT, 'public', 'data', 'gba', 'bldg-overrides.geojson')
PARQUET = os.environ.get('GBA_PARQUET', '/tmp/gba/e105_n20_e110_n15.parquet')
TILE_CACHE = '/tmp/sat/z18'
REPORT_PATH = '/tmp/gba/tower-infer.json'
ART = '/opt/cursor/artifacts'
Z = 18
N = 2 ** Z

# Số tầng và mét đã công bố. Phần còn lại dùng mái đã dịch.
KNOWN = {
    'vinpearl': {'tower_h': 160, 'tower_floors': 34, 'podium_floors': 5, 'podium_h': 160 * 5 / 39, 'split': True},
    'manor-a': {'tower_h': 74.9, 'tower_floors': 19},
    'manor-b': {'tower_h': 74.9, 'tower_floors': 19},
    'indochine': {'tower_h': 67.2, 'tower_floors': 17},
    'imperial': {'tower_h': 60, 'tower_floors': 16},
    'midtown': {'tower_h': 49.5, 'tower_floors': 15},
}


def js_round(value):
    return int(math.floor(float(value) + 0.5))


def origin_of(geom):
    c = shape(geom).centroid
    return c.x, c.y


def metres(lng, lat, origin):
    olng, olat = origin
    mlat = 110540.0
    mlng = 111320.0 * math.cos(math.radians(olat))
    return (lng - olng) * mlng, (lat - olat) * mlat


def unmetres(x, y, origin):
    olng, olat = origin
    mlat = 110540.0
    mlng = 111320.0 * math.cos(math.radians(olat))
    return olng + x / mlng, olat + y / mlat


def to_m(geom, origin):
    return transform(lambda x, y: metres(x, y, origin), shape(geom))


def to_ll(geom, origin):
    return transform(lambda x, y: unmetres(x, y, origin), geom)


def ring_ll(poly, origin):
    coords = [(round(x, 7), round(y, 7)) for x, y in to_ll(poly, origin).exterior.coords]
    if coords[0] != coords[-1]:
        coords.append(coords[0])
    return coords


def regularize(poly):
    if poly.is_empty:
        return poly
    poly = poly.buffer(0)
    simple = poly.simplify(1.6, preserve_topology=True)
    if simple.geom_type != 'Polygon' or simple.is_empty:
        simple = poly
    nvert = len(list(simple.exterior.coords))
    if nvert <= 7:
        return simple
    rect = poly.minimum_rotated_rectangle
    if rect.area > 0 and poly.area / rect.area >= 0.72 and rect.area <= poly.area * 1.15:
        return rect
    harder = poly.simplify(3.2, preserve_topology=True)
    return harder if not harder.is_empty else simple


def load_roofs():
    con = duckdb.connect()
    con.execute('LOAD spatial')
    con.execute("SET memory_limit='4GB'")
    rows = con.execute(f"""
        SELECT height,
               ST_Area(ST_Transform(geometry, 'EPSG:32648')) AS area,
               ST_AsGeoJSON(geometry) AS g,
               source
        FROM read_parquet('{PARQUET}')
        WHERE bbox.xmin BETWEEN 107.02 AND 108.20
          AND bbox.ymin BETWEEN 15.99 AND 16.75
          AND height >= 35
          AND ST_Area(ST_Transform(geometry, 'EPSG:32648')) >= 150
    """).fetchall()
    roofs = []
    for height, area, raw, source in rows:
        geom = json.loads(raw)
        roofs.append({'h': float(height), 'area': float(area), 'geom': geom, 'source': source, 'shape': shape(geom)})
    return roofs


def tile_xy(lat, lng):
    x = (lng + 180.0) / 360.0 * N
    latr = math.radians(lat)
    y = (1.0 - math.log(math.tan(latr) + 1.0 / math.cos(latr)) / math.pi) / 2.0 * N
    return x, y


def fetch_tile(x, y):
    os.makedirs(TILE_CACHE, exist_ok=True)
    path = os.path.join(TILE_CACHE, f'{Z}-{x}-{y}.png')
    if not os.path.exists(path) or os.path.getsize(path) < 1000:
        url = f'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{Z}/{y}/{x}'
        req = urllib.request.Request(url, headers={'User-Agent': 'QH-Hue-research/1.0 (planning research)'})
        with urllib.request.urlopen(req, timeout=40) as res:
            data = res.read()
        open(path, 'wb').write(data)
    return Image.open(path).convert('RGB')


def stitch(lat, lng, span=2):
    cx, cy = tile_xy(lat, lng)
    x0, y0 = int(math.floor(cx)) - span, int(math.floor(cy)) - span
    side = span * 2 + 1
    canvas = Image.new('RGB', (256 * side, 256 * side))
    for ix in range(side):
        for iy in range(side):
            canvas.paste(fetch_tile(x0 + ix, y0 + iy), (ix * 256, iy * 256))
    return canvas, x0, y0


def pix_of(lng, lat, x0, y0):
    x, y = tile_xy(lat, lng)
    return (x - x0) * 256.0, (y - y0) * 256.0


def shaft_from_imagery(ground_ll, origin):
    """Vùng mái sáng trong đế. Trả polygon mét, hoặc None."""
    ground_m = to_m(ground_ll, origin)
    if ground_m.is_empty or ground_m.area < 200:
        return None
    c = shape(ground_ll).centroid
    image, x0, y0 = stitch(c.y, c.x, span=1)
    arr = np.asarray(image).astype(np.float32)
    minx, miny, maxx, maxy = ground_m.bounds
    step = 1.0
    cols = int((maxx - minx) / step) + 1
    rows = int((maxy - miny) / step) + 1
    if rows * cols > 40000:
        return None
    bright = np.zeros((rows, cols), np.float32)
    inside = np.zeros((rows, cols), np.uint8)
    olng, olat = origin
    mlat = 110540.0
    mlng = 111320.0 * math.cos(math.radians(olat))
    for r in range(rows):
        north = maxy - r * step
        for col in range(cols):
            east = minx + col * step
            if not ground_m.covers(Point(east, north)):
                continue
            inside[r, col] = 1
            lng = olng + east / mlng
            lat = olat + north / mlat
            px, py = pix_of(lng, lat, x0, y0)
            xi, yi = int(round(px)), int(round(py))
            if 2 <= xi < arr.shape[1] - 2 and 2 <= yi < arr.shape[0] - 2:
                bright[r, col] = arr[yi - 2:yi + 3, xi - 2:xi + 3].mean()
    vals = bright[inside == 1]
    if vals.size < 80:
        return None
    thr = float(np.percentile(vals, 72))
    sel = (inside == 1) & (bright >= thr)
    seen = np.zeros_like(inside)
    best = []
    for r in range(rows):
        for col in range(cols):
            if not sel[r, col] or seen[r, col]:
                continue
            stack = [(r, col)]
            seen[r, col] = 1
            cells = []
            while stack:
                rr, cc = stack.pop()
                cells.append((rr, cc))
                for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    r2, c2 = rr + dr, cc + dc
                    if 0 <= r2 < rows and 0 <= c2 < cols and sel[r2, c2] and not seen[r2, c2]:
                        seen[r2, c2] = 1
                        stack.append((r2, c2))
            if len(cells) >= 80 and len(cells) > len(best):
                best = cells
    if len(best) < 80:
        return None
    pts = [(minx + c * step, maxy - r * step) for r, c in best]
    hull = MultiPoint(pts).convex_hull
    if hull.geom_type != 'Polygon' or hull.area < 200 or hull.area > ground_m.area * 0.72:
        return None
    cut = hull.intersection(ground_m)
    if cut.geom_type == 'MultiPolygon':
        cut = max(cut.geoms, key=lambda g: g.area)
    elif cut.geom_type == 'GeometryCollection':
        polys = [g for g in cut.geoms if g.geom_type == 'Polygon']
        cut = max(polys, key=lambda g: g.area) if polys else cut
    if cut.is_empty or cut.geom_type != 'Polygon' or cut.area < 200:
        return None
    return regularize(cut)


def scene_lean(features, roofs):
    samples = []
    for feat in features:
        props = feat.get('properties') or {}
        if props.get('id') not in ('vinpearl', 'indochine', 'manor-a', 'manor-b', 'midtown'):
            continue
        if not feat.get('geometry'):
            continue
        base = shape(feat['geometry'])
        origin = (base.centroid.x, base.centroid.y)
        base_m = to_m(feat['geometry'], origin)
        chosen = None
        for roof in roofs:
            d = roof['shape'].centroid.distance(base.centroid)
            d_m = d * 111320.0 * math.cos(math.radians(origin[1]))
            if d_m > 50:
                continue
            if chosen is None or roof['h'] > chosen['h']:
                chosen = roof
        if not chosen:
            continue
        roof_m = to_m(chosen['geom'], origin)
        dx = roof_m.centroid.x - base_m.centroid.x
        dy = roof_m.centroid.y - base_m.centroid.y
        if math.hypot(dx, dy) > 40 or not (chosen['h'] > 0):
            continue
        samples.append({
            'id': props.get('id'),
            'dx': dx,
            'dy': dy,
            'h': chosen['h'],
            'lean_e': dx / chosen['h'],
            'lean_n': dy / chosen['h'],
        })
    if not samples:
        return (0.0, 0.0), samples
    def median(vals):
        vals = sorted(vals)
        n = len(vals)
        if n % 2:
            return vals[n // 2]
        return (vals[n // 2 - 1] + vals[n // 2]) / 2
    return (median(s['lean_e'] for s in samples), median(s['lean_n'] for s in samples)), samples


def part(role, poly_m, origin, height, floors, min_height=0, ground_floors=0, method=''):
    spec = {
        'role': role,
        'floors': int(floors),
        'height': round(float(height), 3),
        'min_height': round(float(min_height), 3),
        'geometry': {'type': 'Polygon', 'coordinates': [ring_ll(poly_m, origin)]},
    }
    if ground_floors:
        spec['groundFloors'] = int(ground_floors)
    if method:
        spec['method'] = method
    return spec


def iou(a, b):
    if a.is_empty or b.is_empty:
        return 0.0
    inter = a.intersection(b).area
    union = a.union(b).area
    return inter / union if union else 0.0


def apply_known(feat, roofs, lean):
    props = feat['properties']
    fid = props.get('id')
    spec = KNOWN.get(fid)
    if not spec or not feat.get('geometry'):
        return None
    origin = origin_of(feat['geometry'])
    base_m = to_m(feat['geometry'], origin)
    if base_m.geom_type == 'MultiPolygon':
        base_m = max(base_m.geoms, key=lambda g: g.area)
    near = None
    for roof in roofs:
        d_m = roof['shape'].centroid.distance(shape(feat['geometry']).centroid) * 111320 * math.cos(math.radians(origin[1]))
        if d_m <= 60 and (near is None or roof['h'] > near['h']):
            near = roof
    parts = []
    info = {'id': fid, 'roof': None}
    if spec.get('split') and near:
        roof_m = to_m(near['geom'], origin)
        info['roof'] = {'h': round(near['h'], 1), 'area': round(near['area']), 'iou': round(iou(roof_m, base_m), 3)}
        podium = regularize(base_m)
        shaft = None
        if info['roof']['iou'] >= 0.55:
            shaft = shaft_from_imagery(feat['geometry'], origin)
            info['shaft'] = 'imagery' if shaft is not None else 'none'
        if shaft is None:
            shift_e = -lean[0] * near['h']
            shift_n = -lean[1] * near['h']
            moved = transform(lambda x, y: (x + shift_e, y + shift_n), roof_m)
            if moved.area < base_m.area * 0.75:
                shaft = regularize(moved.intersection(base_m) or moved)
                info['shaft'] = 'lean-roof'
        if shaft is not None and shaft.area >= 180:
            info['shaftArea'] = round(shaft.area)
            info['shaftCenter'] = [round(shaft.centroid.x, 1), round(shaft.centroid.y, 1)]
            info['baseCenter'] = [round(base_m.centroid.x, 1), round(base_m.centroid.y, 1)]
            parts.append(part('podium', podium, origin, spec['podium_h'], spec['podium_floors'], method='osm-ground'))
            parts.append(part(
                'tower', shaft, origin, spec['tower_h'], spec['tower_floors'],
                spec['podium_h'], spec['podium_floors'], method=info.get('shaft') or 'shaft'
            ))
        else:
            parts.append(part('tower', regularize(base_m), origin, spec['tower_h'], spec['tower_floors'] + spec.get('podium_floors', 0), method='single'))
    else:
        geom_m = to_m(feat['geometry'], origin)
        if geom_m.geom_type == 'MultiPolygon':
            # Giữ từng mảnh đã có, cùng cao độ công bố, không bịa thêm đế.
            for piece in geom_m.geoms:
                if piece.area < 80:
                    continue
                parts.append(part('tower', regularize(piece), origin, spec['tower_h'], spec['tower_floors'], method='published-plate'))
        else:
            parts.append(part('tower', regularize(geom_m), origin, spec['tower_h'], spec['tower_floors'], method='published-plate'))
        if near:
            info['roof'] = {'h': round(near['h'], 1), 'area': round(near['area'])}
    return parts, info


def draw_overlay(name, lat, lng, polygons):
    image, x0, y0 = stitch(lat, lng, span=1)
    draw = ImageDraw.Draw(image)
    colors = {'podium': (255, 150, 40), 'tower': (0, 220, 255), 'roof': (255, 40, 80), 'plate': (180, 255, 80)}
    for kind, geom in polygons:
        shp = shape(geom)
        polys = [shp] if shp.geom_type == 'Polygon' else list(shp.geoms)
        for poly in polys:
            pts = [pix_of(x, y, x0, y0) for x, y in poly.exterior.coords]
            draw.line(pts, fill=colors.get(kind, (255, 255, 255)), width=3)
    os.makedirs(ART, exist_ok=True)
    path = os.path.join(ART, f'overlay-{name}.png')
    image.save(path)
    return path


def main():
    fc = json.load(open(OV_PATH, encoding='utf-8'))
    fc['features'] = [
        f for f in fc.get('features') or []
        if not str((f.get('properties') or {}).get('id') or '').startswith('infer-')
    ]
    roofs = load_roofs()
    lean, samples = scene_lean(fc['features'], roofs)
    print('lean m/m', [round(v, 4) for v in lean], 'samples', len(samples))
    for sample in samples:
        print(' ', sample['id'], 'offset', round(sample['dx'], 1), round(sample['dy'], 1), 'h', round(sample['h'], 1))

    used = set()
    report_buildings = []
    for feat in fc['features']:
        props = feat.setdefault('properties', {})
        built = apply_known(feat, roofs, lean)
        if not built:
            continue
        parts, info = built
        props['parts'] = parts
        props['auto'] = True
        report_buildings.append(info)
        print(props.get('id'), info.get('shaft'), info.get('shaftArea'), 'parts', len(parts))
        origin = origin_of(feat['geometry'])
        for roof in roofs:
            d_m = roof['shape'].centroid.distance(shape(feat['geometry']).centroid) * 111320 * math.cos(math.radians(origin[1]))
            if d_m <= 60:
                used.add(id(roof))

    extras = []
    for i, roof in enumerate(roofs):
        if id(roof) in used:
            continue
        origin = (roof['shape'].centroid.x, roof['shape'].centroid.y)
        roof_m = to_m(roof['geom'], origin)
        moved = transform(lambda x, y, e=lean[0] * roof['h'], n=lean[1] * roof['h']: (x - e, y - n), roof_m)
        tower = regularize(moved)
        if tower.is_empty or tower.area < 120:
            continue
        floors = max(1, js_round(roof['h'] / 4.0))
        geom = {'type': 'Polygon', 'coordinates': [ring_ll(tower, origin)]}
        extras.append({
            'type': 'Feature',
            'properties': {
                'id': f'infer-{len(extras) + 1}',
                'name': f'Nhà cao suy luận {round(roof["h"], 1)} m',
                'h': round(roof['h'], 1),
                'draw': False,
                'infer': True,
                'auto': True,
                'source': f'gba:{roof["source"]}',
                'note': 'Mái GBA dịch về chân theo vectơ nghiêng trung vị. draw=false, không đưa vào mật độ lô.',
                'roofMask': roof['geom'],
                'parts': [part('tower', tower, origin, roof['h'], floors, method='lean-roof')],
            },
            'geometry': geom,
        })
    fc['features'].extend(extras)

    massing_raw = subprocess.check_output(
        ['git', 'show', 'origin/cursor/phan-tich-3d-df71:public/data/gba/bldg-overrides.geojson']
    )
    massing = json.loads(massing_raw).get('massing') or []
    for row in massing:
        if row.get('name') in ('White Lotus Hotel', 'Moonlight Hotel Huế'):
            row['drawn'] = False
            row['note'] = 'Chưa có dấu chân khảo sát. Không vẽ tấm giả.'
    fc['massing'] = massing
    fc['infer'] = {
        'leanEast': round(lean[0], 5),
        'leanNorth': round(lean[1], 5),
        'samples': [{k: (round(v, 3) if isinstance(v, float) else v) for k, v in s.items()} for s in samples],
        'roofs': len(roofs),
        'added': len(extras),
        'note': 'Vectơ nghiêng là trung vị (tâm mái − tâm chân) / chiều cao thô. Đế không bị trừ phần tháp.',
    }
    with open(OV_PATH, 'w', encoding='utf-8') as handle:
        json.dump(fc, handle, ensure_ascii=False, separators=(',', ':'))
    with open(REPORT_PATH, 'w', encoding='utf-8') as handle:
        json.dump({'lean': lean, 'buildings': report_buildings, 'added': len(extras), 'roofs': len(roofs)}, handle, ensure_ascii=False, indent=2)
    print('added', len(extras), 'features', len(fc['features']))

    by_id = {f['properties'].get('id'): f for f in fc['features']}
    vin = by_id['vinpearl']
    rings = []
    for p in vin['properties']['parts']:
        rings.append((p['role'], p['geometry']))
    c = shape(vin['geometry']).centroid
    draw_overlay('vinpearl', c.y, c.x, rings)
    for fid, kind in (('indochine', 'plate'), ('manor-a', 'plate'), ('manor-b', 'plate'), ('imperial', 'plate')):
        feat = by_id[fid]
        c = shape(feat['geometry']).centroid
        polys = [(kind, p['geometry']) for p in feat['properties'].get('parts') or []]
        if not polys:
            polys = [('plate', feat['geometry'])]
        draw_overlay(fid, c.y, c.x, polys)
    if extras:
        sample = extras[0]
        c = shape(sample['geometry']).centroid
        draw_overlay('infer-1', c.y, c.x, [('tower', sample['geometry']), ('roof', sample['properties']['roofMask'])])
    print('overlays ok')


if __name__ == '__main__':
    main()
